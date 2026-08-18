// Vendor-mismatch audit for invoices.qb_bill_txn_id.
//
// Motivation: prior to commit 4caef92 (2026-08-14), bill_query and bill_add
// persist paths used .eq('invoice_number', refNumber) — vendor-blind. Croatian
// contractors routinely share invoice numbers ("INV 04/26", "INV 7-1-1"), so
// TxnIDs may have been written to the wrong contractor's invoice row. OBAI +
// Ravi were the two collisions we caught live; this script scans all remaining
// qb_bill_txn_id NOT NULL rows to catch any silent stragglers.
//
// Approach: enqueue one bill_query per unique TxnID (Mode 1 — unambiguous
// per-bill lookup), then after WC drains the queue, compare each response's
// VendorRef.FullName against the expected vendor derived from the invoice's
// payment_profile.qb_vendor_name.
//
// Usage:
//   Phase A (enqueue):
//     SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-billtxn-audit.cjs
//
//   Phase B (report after WC drains — safe, read-only):
//     SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-billtxn-audit.cjs --report
//
//   Phase B with auto-clear (destructive — clears qb_bill_txn_id on mismatch):
//     SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-billtxn-audit.cjs --report --apply
//
// Idempotent: enqueue skips TxnIDs that already have a pending/done audit job.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

const MODE_REPORT = process.argv.includes('--report');
const MODE_APPLY  = process.argv.includes('--apply');
// Tag audit jobs so we can find them independently of batch-15 / phase-1 queries.
const AUDIT_TAG = 'audit:qb_bill_txn_id';

function decodeXmlEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractVendorAndTxnFromResponse(xml) {
  if (!xml) return null;
  const billRets = xml.match(/<BillRet>[\s\S]*?<\/BillRet>/g) || [];
  if (billRets.length === 0) return null;
  // TxnID mode returns exactly one BillRet per matched TxnID.
  const b = billRets[0];
  const vendorMatch = b.match(/<VendorRef>[\s\S]*?<FullName>([^<]+)<\/FullName>/);
  const txnMatch    = b.match(/<TxnID>([^<]+)<\/TxnID>/);
  return {
    vendorFullName: vendorMatch ? decodeXmlEntities(vendorMatch[1]) : null,
    txnId:          txnMatch ? txnMatch[1] : null,
  };
}

function resolveExpectedVendor(invoice, profiles) {
  // Mirror qb-batch-enqueue-payments.resolveQbVendorName order-of-preference:
  //   1. Live vendor of the invoice's snapshotted payment_profile.id
  //   2. is_default profile for the user
  //   3. Sole qb_vendor_name across the user's profiles
  const pp = invoice.payment_profile;
  const profileId = pp && pp.id ? Number(pp.id) : 0;
  if (profileId > 0) {
    const live = profiles.find(p => p.id === profileId);
    if (live && live.qb_vendor_name) return live.qb_vendor_name;
  }
  const def = profiles.find(p => p.user_id === invoice.user_id && p.is_default);
  if (def && def.qb_vendor_name) return def.qb_vendor_name;
  const names = new Set(profiles.filter(p => p.user_id === invoice.user_id && p.qb_vendor_name).map(p => p.qb_vendor_name));
  if (names.size === 1) return [...names][0];
  return null;
}

async function loadAllInvoicesWithTxnId() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('invoices')
      .select('id, user_id, invoice_number, qb_bill_txn_id, payment_profile')
      .not('qb_bill_txn_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function enqueuePhase() {
  const invoices = await loadAllInvoicesWithTxnId();
  console.log(`Loaded ${invoices.length} invoices with qb_bill_txn_id NOT NULL.`);

  // Unique TxnIDs — multiple invoices may share one TxnID (MULTI-YYYY-MM bills).
  const uniqueTxnIds = [...new Set(invoices.map(i => i.qb_bill_txn_id))];
  console.log(`Unique TxnIDs to audit: ${uniqueTxnIds.length}`);

  // Skip TxnIDs that already have an audit job (pending or done) so re-running
  // is idempotent.
  const { data: existing } = await supabase
    .from('qb_sync_jobs')
    .select('id, payload')
    .eq('kind', 'bill_query')
    .in('status', ['pending', 'in_flight', 'done']);
  const alreadyAudited = new Set();
  for (const j of (existing || [])) {
    if (j.payload && j.payload.__audit_tag === AUDIT_TAG && Array.isArray(j.payload.txnIds)) {
      for (const t of j.payload.txnIds) alreadyAudited.add(t);
    }
  }
  const toEnqueue = uniqueTxnIds.filter(t => !alreadyAudited.has(t));
  console.log(`Already-audited (skipped): ${uniqueTxnIds.length - toEnqueue.length}. New to enqueue: ${toEnqueue.length}.`);
  if (toEnqueue.length === 0) {
    console.log(`Nothing to do. Run again with --report once WC has drained the queue.`);
    return;
  }

  const rows = toEnqueue.map(txnId => ({
    kind: 'bill_query',
    payload: { txnIds: [txnId], __audit_tag: AUDIT_TAG },
    depends_on: [],
    status: 'pending',
  }));
  const { data: inserted, error } = await supabase.from('qb_sync_jobs').insert(rows).select('id');
  if (error) { console.error('Insert failed:', error); process.exit(1); }
  console.log(`\n✅ Enqueued ${inserted.length} bill_query-by-TxnID audit jobs. IDs: ${inserted.map(r => r.id).join(', ')}`);
  console.log(`\nWait for QBWC to drain (auto-poll or "Update Selected"), then re-run with --report.`);
}

async function reportPhase() {
  const invoices = await loadAllInvoicesWithTxnId();
  const { data: profiles } = await supabase.from('payment_profiles').select('id, user_id, qb_vendor_name, is_default');

  // Load all done audit jobs and build TxnID → response-vendor map.
  const { data: doneJobs } = await supabase
    .from('qb_sync_jobs')
    .select('id, status, error_msg, payload, qbxml_response')
    .eq('kind', 'bill_query')
    .in('status', ['done', 'error']);
  const txnToVendor = new Map();       // txnId → { vendorFullName, jobId, status, notes }
  for (const j of (doneJobs || [])) {
    if (!j.payload || j.payload.__audit_tag !== AUDIT_TAG) continue;
    const txnIds = j.payload.txnIds || [];
    if (j.status === 'error') {
      for (const t of txnIds) txnToVendor.set(t, { vendorFullName: null, jobId: j.id, status: 'error', notes: j.error_msg });
      continue;
    }
    const parsed = extractVendorAndTxnFromResponse(j.qbxml_response);
    for (const t of txnIds) {
      if (!parsed) {
        // Empty response (statusCode=500 self-closing = "TxnID not found in QB").
        txnToVendor.set(t, { vendorFullName: null, jobId: j.id, status: 'not_in_qb', notes: 'TxnID not in QB' });
      } else {
        txnToVendor.set(t, { vendorFullName: parsed.vendorFullName, jobId: j.id, status: 'ok', notes: null });
      }
    }
  }

  const results = {
    match:       [],   // vendor matches — TxnID belongs to the right contractor
    mismatch:    [],   // vendor mismatch — pre-4caef92 cross-vendor collision
    unmapped:    [],   // no expected vendor derivable (profiles missing qb_vendor_name)
    not_in_qb:   [],   // TxnID doesn't resolve to any bill in QB
    error:       [],   // audit job failed
    pending:     [],   // audit job not yet done
  };
  for (const inv of invoices) {
    const audit = txnToVendor.get(inv.qb_bill_txn_id);
    if (!audit) { results.pending.push({ invoice: inv }); continue; }
    if (audit.status === 'error')     { results.error.push({ invoice: inv, audit }); continue; }
    if (audit.status === 'not_in_qb') { results.not_in_qb.push({ invoice: inv, audit }); continue; }
    const expected = resolveExpectedVendor(inv, profiles);
    if (!expected) { results.unmapped.push({ invoice: inv, audit }); continue; }
    if (expected === audit.vendorFullName) {
      results.match.push({ invoice: inv, audit, expected });
    } else {
      results.mismatch.push({ invoice: inv, audit, expected });
    }
  }

  console.log(`\n─── Vendor-mismatch audit report ───`);
  console.log(`Total invoices with qb_bill_txn_id:   ${invoices.length}`);
  console.log(`Matched (correct):                    ${results.match.length}`);
  console.log(`MISMATCH (cross-vendor collision):    ${results.mismatch.length}`);
  console.log(`Unmapped (no expected vendor):        ${results.unmapped.length}`);
  console.log(`TxnID not in QB (bill deleted?):      ${results.not_in_qb.length}`);
  console.log(`Audit job errored:                    ${results.error.length}`);
  console.log(`Audit job pending (WC not drained):   ${results.pending.length}`);

  if (results.mismatch.length > 0) {
    console.log(`\n─── MISMATCHES (need cleanup) ───`);
    for (const m of results.mismatch) {
      console.log(`  invoice.id=${m.invoice.id}  invoice_number="${m.invoice.invoice_number}"  user_id=${m.invoice.user_id}`);
      console.log(`    qb_bill_txn_id=${m.invoice.qb_bill_txn_id}`);
      console.log(`    expected vendor:  "${m.expected}"`);
      console.log(`    QB says vendor:   "${m.audit.vendorFullName}"  (audit job ${m.audit.jobId})`);
    }
  }
  if (results.unmapped.length > 0) {
    console.log(`\n─── UNMAPPED (cannot verify — payment_profiles missing qb_vendor_name for user) ───`);
    for (const u of results.unmapped) {
      console.log(`  invoice.id=${u.invoice.id}  user_id=${u.invoice.user_id}  QB says: "${u.audit.vendorFullName}"`);
    }
  }
  if (results.not_in_qb.length > 0) {
    console.log(`\n─── NOT IN QB (TxnID resolves to nothing — bill was deleted?) ───`);
    for (const n of results.not_in_qb) {
      console.log(`  invoice.id=${n.invoice.id}  invoice_number="${n.invoice.invoice_number}"  qb_bill_txn_id=${n.invoice.qb_bill_txn_id}`);
    }
  }
  if (results.pending.length > 0) {
    console.log(`\n─── PENDING (audit job not yet complete — WC may still be draining) ───`);
    console.log(`  ${results.pending.length} invoice(s) waiting. Retry --report after next QBWC poll.`);
  }

  if (MODE_APPLY) {
    if (results.mismatch.length === 0 && results.not_in_qb.length === 0) {
      console.log(`\n✔ Nothing to clear.`);
      return;
    }
    const toClear = [...results.mismatch, ...results.not_in_qb].map(r => r.invoice.id);
    console.log(`\n⚠️  --apply set. Clearing qb_bill_txn_id on ${toClear.length} invoice(s) (${results.mismatch.length} mismatch + ${results.not_in_qb.length} not-in-qb).`);
    const { error, count } = await supabase
      .from('invoices')
      .update({ qb_bill_txn_id: null, qb_export_status: 'not_exported' }, { count: 'exact' })
      .in('id', toClear);
    if (error) { console.error('Update failed:', error); process.exit(1); }
    console.log(`✅ Cleared ${count} row(s). Re-enqueue bill_add for these invoices in the next batch.`);
  } else if (results.mismatch.length > 0 || results.not_in_qb.length > 0) {
    console.log(`\nRe-run with --apply to auto-clear qb_bill_txn_id on ${results.mismatch.length + results.not_in_qb.length} row(s).`);
  }
}

(async () => {
  if (MODE_REPORT) await reportPhase();
  else await enqueuePhase();
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
