// Post-batch reconciliation / self-heal for qbXML payments.
//
// Given a batch_id, for every `matched` convera_transaction in the batch:
//   1. Determine the QB bill TxnID(s) it should be paid by (via bridge or matched_invoice_id → invoice.qb_bill_txn_id).
//   2. Look up which done bill_pmt_add job covered those bill(s) (parse response for AppliedToTxnRet.TxnID).
//   3. Compare the payment TxnID we should have vs what's in convera_transactions.qb_billpmt_txn_id:
//        - Matches → verified clean.
//        - Missing → heal by writing the payment TxnID.
//        - Mismatch → discrepancy (loud warning, no auto-fix).
//        - No covering job → unresolvable (payment never happened OR bill_txnid drift).
//
// SAFE to re-run. Only writes when a NULL qb_billpmt_txn_id can be filled in from
// existing job responses — never overwrites an existing value. Reads across all
// time so old jobs still contribute.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-batch-verify.cjs <batch_id> [--heal]
//
// Default is DRY-RUN — reports would-heal / would-fix rows without writing.
// Pass --heal to actually perform DB writes. Design intent: reading is safe;
// writing is explicit so nobody silently mutates state during an audit.
//
// Origin: 2026-08-14 post-mortem after batch 17 silent-drop incident where the
// bill_pmt_add persist logic no-op'd due to a payload key mismatch, forcing manual
// SQL archaeology to recover state. This script automates that recovery + prevents
// future silent drops from festering.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

const args = process.argv.slice(2);
const BATCH_ID = Number(args[0]);
const DO_HEAL = args.includes('--heal');
if (!Number.isFinite(BATCH_ID)) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-batch-verify.cjs <batch_id> [--heal]');
  process.exit(1);
}
console.log(`Mode: ${DO_HEAL ? 'HEAL (will write to DB)' : 'DRY-RUN (read-only report; pass --heal to write)'}`);

// Parse a bill_pmt_add response to extract { paymentTxnId, appliedBillTxnIds }.
// The payment's own TxnID is the first <TxnID> inside <BillPaymentCheckRet>
// (before any AppliedToTxnRet). Each AppliedToTxnRet block contains ONE bill TxnID.
function parseBillPmtAddResponse(xml) {
  if (!xml) return null;
  const ret = xml.match(/<BillPaymentCheckRet>([\s\S]*?)<\/BillPaymentCheckRet>/);
  if (!ret) return null;
  const inner = ret[1];
  const beforeApplied = inner.split('<AppliedToTxnRet>')[0];
  const paymentTxnMatch = beforeApplied.match(/<TxnID>([^<]+)<\/TxnID>/);
  if (!paymentTxnMatch) return null;
  const paymentTxnId = paymentTxnMatch[1];
  const appliedBlocks = inner.match(/<AppliedToTxnRet>[\s\S]*?<\/AppliedToTxnRet>/g) || [];
  const appliedBillTxnIds = appliedBlocks.map(b => {
    const m = b.match(/<TxnID>([^<]+)<\/TxnID>/);
    return m ? m[1] : null;
  }).filter(Boolean);
  return { paymentTxnId, appliedBillTxnIds };
}

(async () => {
  console.log(`Verifying batch ${BATCH_ID}...\n`);

  const { data: txns, error: txErr } = await supabase.from('convera_transactions')
    .select('id, beneficiary_name, confirmation_number, match_state, matched_invoice_id, qb_billpmt_txn_id, matcher_ignore')
    .eq('import_batch_id', BATCH_ID)
    .order('id');
  if (txErr) { console.error('Load txns failed:', txErr); process.exit(1); }
  if (!txns || txns.length === 0) {
    console.log(`No convera_transactions found for batch ${BATCH_ID}. Nothing to verify.`);
    process.exit(0);
  }
  const txnIds = txns.map(t => t.id);

  const { data: bridge } = await supabase.from('convera_transaction_invoices')
    .select('transaction_id, invoice_id')
    .in('transaction_id', txnIds);

  const invIds = new Set();
  for (const t of txns) if (t.matched_invoice_id) invIds.add(t.matched_invoice_id);
  for (const b of (bridge || [])) invIds.add(b.invoice_id);
  const { data: invoices } = await supabase.from('invoices')
    .select('id, qb_bill_txn_id')
    .in('id', Array.from(invIds));
  const invById = new Map((invoices || []).map(i => [i.id, i]));

  // Load done bill_pmt_add jobs, ORDERED by created_at DESC so newer coverage wins
  // on any bill_txnid that appears in multiple responses (e.g. a TEST payment that
  // was later voided in QB and then re-paid for real — the newer job represents
  // current reality).
  const { data: pmtJobs } = await supabase.from('qb_sync_jobs')
    .select('id, payload, qbxml_response, created_at')
    .eq('kind', 'bill_pmt_add')
    .eq('status', 'done')
    .order('created_at', { ascending: false });

  const paymentByBillTxnId = new Map();
  const duplicateCoverage = [];
  for (const j of (pmtJobs || [])) {
    // Skip TEST payments — they were experimental and typically voided in QB after
    // accountant validation. Their responses are historical, not current state.
    const conf = j.payload?.refNumber || '';
    if (conf.startsWith('TEST-')) continue;
    const parsed = parseBillPmtAddResponse(j.qbxml_response);
    if (!parsed) continue;
    for (const billTxnId of parsed.appliedBillTxnIds) {
      const existing = paymentByBillTxnId.get(billTxnId);
      if (!existing) {
        // First (=newest) wins because we ordered DESC.
        paymentByBillTxnId.set(billTxnId, { paymentTxnId: parsed.paymentTxnId, jobId: j.id });
      } else if (existing.paymentTxnId !== parsed.paymentTxnId) {
        // Older job also covers this bill with a different payment TxnID. If not TEST,
        // this is a genuine double-pay OR two intentional partial payments — flag it.
        duplicateCoverage.push({ billTxnId, current: existing, older: { paymentTxnId: parsed.paymentTxnId, jobId: j.id } });
      }
    }
  }
  console.log(`Loaded ${paymentByBillTxnId.size} bill→payment mappings from ${(pmtJobs || []).length} done bill_pmt_add jobs.`);
  if (duplicateCoverage.length > 0) {
    console.warn(`\n⚠️  ${duplicateCoverage.length} bill(s) appear in MULTIPLE bill_pmt_add responses — possible double-pay:`);
    for (const d of duplicateCoverage.slice(0, 5)) {
      console.warn(`   bill ${d.billTxnId}: covered by payment ${d.first.paymentTxnId} (job ${d.first.jobId}) AND ${d.second.paymentTxnId} (job ${d.second.jobId})`);
    }
  }
  console.log('');

  const results = {
    verifiedClean: 0,
    healed: [],       // populated only when DO_HEAL
    wouldHeal: [],    // populated in dry-run mode
    unresolvable: [],
    discrepancies: [],
    multiPaymentUmbrella: [], // umbrella wires covered by >1 QB payment; ct.qb_billpmt_txn_id captures only one — expected today, schema gap tracked
    skippedNonMatched: 0,
    skippedIgnored: 0,
  };

  for (const t of txns) {
    if (t.matcher_ignore) { results.skippedIgnored++; continue; }
    if (t.match_state !== 'matched') { results.skippedNonMatched++; continue; }

    const bridgeRows = (bridge || []).filter(b => b.transaction_id === t.id);
    const invIdsForCt = bridgeRows.length > 0
      ? bridgeRows.map(b => b.invoice_id)
      : (t.matched_invoice_id ? [t.matched_invoice_id] : []);
    const billTxnIds = invIdsForCt.map(id => invById.get(id)?.qb_bill_txn_id).filter(Boolean);
    if (billTxnIds.length === 0) {
      results.unresolvable.push({ ctId: t.id, benef: t.beneficiary_name, reason: 'linked invoice(s) have no qb_bill_txn_id — bill_query never ran for them' });
      continue;
    }

    const payments = billTxnIds.map(btid => paymentByBillTxnId.get(btid)?.paymentTxnId).filter(Boolean);
    const uniquePayments = [...new Set(payments)];
    if (uniquePayments.length === 0) {
      results.unresolvable.push({ ctId: t.id, benef: t.beneficiary_name, reason: `no bill_pmt_add job covers bill_txnid(s): ${billTxnIds.join(', ')}` });
      continue;
    }
    // Umbrella wires (BIMOSOFT, Native Teams) can cover MULTIPLE QB payments because
    // each covered contractor is a distinct QB vendor and each vendor gets its own
    // bill_pmt_add. That's expected, not a discrepancy. Note the limitation: our
    // convera_transactions.qb_billpmt_txn_id column holds ONE TxnID, so we lose the
    // others — a real schema gap to fix later (make it array or add a link table).
    // For now: if ct's stored value is one of the covering payments, accept as clean;
    // note the extras as info.
    if (uniquePayments.length > 1) {
      if (t.qb_billpmt_txn_id && uniquePayments.includes(t.qb_billpmt_txn_id)) {
        results.multiPaymentUmbrella.push({ ctId: t.id, benef: t.beneficiary_name, stored: t.qb_billpmt_txn_id, allPayments: uniquePayments });
        continue;
      }
      results.discrepancies.push({ ctId: t.id, benef: t.beneficiary_name, issue: 'multiple payment TxnIDs cover this txn\'s bills AND stored value doesn\'t match any', payments: uniquePayments, dbValue: t.qb_billpmt_txn_id });
      continue;
    }
    const expected = uniquePayments[0];
    if (t.qb_billpmt_txn_id === expected) {
      results.verifiedClean++;
    } else if (t.qb_billpmt_txn_id == null) {
      if (DO_HEAL) {
        const { error } = await supabase.from('convera_transactions')
          .update({ qb_billpmt_txn_id: expected })
          .eq('id', t.id);
        if (error) {
          results.discrepancies.push({ ctId: t.id, benef: t.beneficiary_name, issue: `heal write failed: ${error.message}` });
        } else {
          results.healed.push({ ctId: t.id, benef: t.beneficiary_name, paymentTxnId: expected });
        }
      } else {
        results.wouldHeal.push({ ctId: t.id, benef: t.beneficiary_name, paymentTxnId: expected });
      }
    } else {
      results.discrepancies.push({ ctId: t.id, benef: t.beneficiary_name, issue: 'mismatch: existing qb_billpmt_txn_id differs from expected', dbValue: t.qb_billpmt_txn_id, expected });
    }
  }

  console.log(`Verified clean:              ${results.verifiedClean}`);
  if (DO_HEAL) {
    console.log(`Healed (backfilled NULL):    ${results.healed.length}`);
    for (const h of results.healed) console.log(`  ct ${h.ctId} ${h.benef} → paymentTxnId=${h.paymentTxnId}`);
  } else {
    console.log(`Would heal (NULL backfill):  ${results.wouldHeal.length}  (dry-run; pass --heal to write)`);
    for (const h of results.wouldHeal) console.log(`  ct ${h.ctId} ${h.benef} → paymentTxnId=${h.paymentTxnId}`);
  }
  console.log(`Umbrella (multi-payment):    ${results.multiPaymentUmbrella.length}`);
  for (const m of results.multiPaymentUmbrella) console.log(`  ct ${m.ctId} ${m.benef}: stored ${m.stored} — ALSO covered by ${m.allPayments.filter(p => p !== m.stored).join(', ')}`);
  console.log(`Unresolvable (no coverage):  ${results.unresolvable.length}`);
  for (const u of results.unresolvable) console.log(`  ct ${u.ctId} ${u.benef}: ${u.reason}`);
  console.log(`Discrepancies (mismatch):    ${results.discrepancies.length}`);
  for (const d of results.discrepancies) console.log(`  ct ${d.ctId} ${d.benef}: ${d.issue}${d.dbValue ? ` — db=${d.dbValue} vs expected=${d.expected}` : ''}${d.payments ? ` — payments=${d.payments.join(', ')}` : ''}`);
  console.log(`Skipped (non-matched state): ${results.skippedNonMatched}`);
  console.log(`Skipped (matcher_ignore):    ${results.skippedIgnored}`);

  const hasIssues = results.unresolvable.length > 0 || results.discrepancies.length > 0 || duplicateCoverage.length > 0;
  process.exit(hasIssues ? 1 : 0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
