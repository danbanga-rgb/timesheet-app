// Phase 2 of batch qbXML enqueue: insert bill_pmt_add jobs for a given batch_id.
// Prerequisite: Phase 1 (qb-batch-enqueue-queries.cjs) must have run and all
// bill_query jobs must be status='done'. This script:
//   1. Rebuilds the plan (matches qb-batch-dryrun.cjs logic).
//   2. For each unique (vendor, refNumber), reads the TxnID from the
//      completed bill_query job's qbxml_response.
//   3. Bakes TxnID into bill_pmt_add payload and inserts.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-batch-enqueue-payments.cjs [batch_id]

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);
const BATCH_ID = Number(process.argv[2] || 15);
const BANK_ACCOUNT_FULL_NAME = 'BANK/CASH:8220 - Key Point Checking';

function resolveQbVendorName(invoice, profiles) {
  const pp = invoice.payment_profile;
  const profileId = pp && pp.id ? Number(pp.id) : 0;
  if (profileId > 0) {
    const live = profiles.find(p => p.id === profileId);
    if (live && live.qb_vendor_name) return { name: live.qb_vendor_name };
  }
  const def = profiles.find(p => p.user_id === invoice.user_id && p.is_default);
  if (def && def.qb_vendor_name) return { name: def.qb_vendor_name };
  const userNames = new Set(profiles.filter(p => p.user_id === invoice.user_id && p.qb_vendor_name).map(p => p.qb_vendor_name));
  if (userNames.size === 1) return { name: [...userNames][0] };
  return { name: null };
}

// Decode common XML entities QB Xerces emits. Vendor names with quotes (e.g.
// `Obrtnicka djelatnost "ENCODE"vl. Enis Ba`) come back with `&quot;` in the
// response XML. Our DB's payment_profiles.qb_vendor_name has real quotes, so
// map keys must match after decoding. Bit us 2026-08-14 (5 stragglers on batch 17).
function decodeXmlEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Extract TxnIDs from a bill_query response XML, indexed by VendorRef.FullName.
// Multiple bills can share a RefNumber across different vendors (e.g. "INV 03/26"
// exists for BIT-IO AND Zex Network) — this bit us on the 2026-08-13 batch 15
// rollout. Return a Map<vendorFullName, txnId> so callers can disambiguate by
// vendor. Naive first-BillRet extraction is wrong when the response has multiple.
function extractTxnIdsFromResponseByVendor(xml) {
  const out = new Map();
  if (!xml) return out;
  const billRets = xml.match(/<BillRet>[\s\S]*?<\/BillRet>/g) || [];
  for (const b of billRets) {
    const txnMatch = b.match(/<TxnID>([^<]+)<\/TxnID>/);
    const vendorMatch = b.match(/<VendorRef>[\s\S]*?<FullName>([^<]+)<\/FullName>/);
    if (txnMatch && vendorMatch) {
      const vendor = decodeXmlEntities(vendorMatch[1]);
      if (!out.has(vendor)) out.set(vendor, txnMatch[1]);
    }
  }
  return out;
}

(async () => {
  // Load ALL prior completed bill_query jobs (recent ones) to build a
  // (refNumber → TxnID) lookup. We use payload.refNumbers[0] since we
  // always insert one RefNumber per job in Phase 1.
  const { data: doneQueries } = await supabase
    .from('qb_sync_jobs')
    .select('id, kind, status, payload, qbxml_response')
    .eq('kind', 'bill_query')
    .eq('status', 'done')
    .order('id', { ascending: false })
    .limit(500);
  // Key by (vendor, refNumber) so cross-vendor RefNumber collisions don't
  // produce wrong TxnID assignments. See 2026-08-13 batch 15 incident:
  // "INV 03/26", "INV 20260601", "INV 6-1-1" each matched 2-3 different
  // vendors' bills; naive first-match lookup paired 3 payments with the
  // wrong TxnID → statusCode=3120 "Object cannot be found" from QB.
  const refToTxnId = new Map();  // "vendor::refNumber" → { txnId, jobId }
  for (const j of doneQueries) {
    const ref = j.payload?.refNumbers?.[0];
    if (!ref) continue;
    const byVendor = extractTxnIdsFromResponseByVendor(j.qbxml_response);
    for (const [vendor, txnId] of byVendor) {
      const key = `${vendor}::${ref}`;
      if (!refToTxnId.has(key)) refToTxnId.set(key, { txnId, jobId: j.id });
    }
  }
  console.log(`Loaded ${refToTxnId.size} (vendor, refNumber) → TxnID mappings from bill_query results.`);

  // Rebuild the plan (same as dry-run / phase 1)
  const { data: txns } = await supabase
    .from('convera_transactions')
    .select('id, confirmation_number, date_of_order, subtotal, matched_invoice_id, match_state, matcher_ignore, qb_billpmt_txn_id')
    .eq('import_batch_id', BATCH_ID)
    .order('id');
  const txnIds = txns.map(t => t.id);
  const { data: bridge } = await supabase.from('convera_transaction_invoices').select('transaction_id, invoice_id, amount_share').in('transaction_id', txnIds);
  const invIds = new Set();
  for (const t of txns) if (t.matched_invoice_id) invIds.add(t.matched_invoice_id);
  for (const b of bridge) if (b.invoice_id) invIds.add(b.invoice_id);
  const { data: batchInvoices } = await supabase.from('invoices').select('id, user_id, invoice_number, total_amount, period_end, payment_profile, qb_bill_txn_id').in('id', Array.from(invIds));
  const { data: profiles } = await supabase.from('payment_profiles').select('id, user_id, qb_vendor_name, is_default');

  // Bill index (matches dry-run)
  const allExported = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await supabase.from('invoices').select('id, user_id, invoice_number, period_end, payment_profile, qb_bill_txn_id').eq('qb_export_status', 'exported').order('id').range(from, from + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    allExported.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const groupCount = new Map();
  for (const inv of allExported) {
    const { name: vendor } = resolveQbVendorName(inv, profiles);
    const month = (inv.period_end || '').slice(0, 7);
    if (!vendor || !month) continue;
    groupCount.set(`${vendor}::${month}`, (groupCount.get(`${vendor}::${month}`) || 0) + 1);
  }
  const billIndex = new Map();
  for (const inv of allExported) {
    const { name: vendor } = resolveQbVendorName(inv, profiles);
    const month = (inv.period_end || '').slice(0, 7);
    if (!vendor || !month) { billIndex.set(inv.id, { vendor: null, refNumber: null }); continue; }
    const refNumber = groupCount.get(`${vendor}::${month}`) > 1 ? `MULTI-${month}` : inv.invoice_number;
    billIndex.set(inv.id, { vendor, refNumber });
  }

  const invById = new Map(batchInvoices.map(i => [i.id, i]));

  // Per-(wire, vendor) skip gate. convera_transaction_billpmts is the umbrella-safe
  // link table introduced 2026-08-18. Presence of a row means "QB payment already
  // created for this (wire, vendor) pair" — skip that group. The old boolean gate
  // (`t.qb_billpmt_txn_id` set → skip whole wire) is retained ONLY for wires that
  // pre-date the link table AND aren't in the link table yet — in that case we
  // conservatively skip to avoid double-paying, since we can't tell which vendor
  // the legacy TxnID belongs to (last-persisted wins for umbrella wires).
  const { data: existingLinks } = await supabase
    .from('convera_transaction_billpmts')
    .select('convera_transaction_id, qb_vendor_name')
    .in('convera_transaction_id', txnIds);
  const alreadyPaidPairs = new Set();  // "wire::vendor" for already-recorded payments
  const wiresWithAnyLink = new Set();  // wires that have any link row (used to override legacy gate)
  for (const l of (existingLinks || [])) {
    alreadyPaidPairs.add(`${l.convera_transaction_id}::${l.qb_vendor_name}`);
    wiresWithAnyLink.add(l.convera_transaction_id);
  }

  // Build payment groups
  const paymentGroups = [];  // { wire, vendorName, bills: Map<refNumber, { items:[{inv, share}], txnId, jobId }> }
  const missingTxnIds = [];
  const skippedAlreadyPaid = [];  // { wire, vendor } — logged for visibility
  for (const t of txns) {
    if (t.matcher_ignore || t.match_state !== 'matched') continue;
    // Legacy skip: qb_billpmt_txn_id set BUT no link rows exist yet → pre-link-table
    // legacy state, conservatively skip (see comment above).
    if (t.qb_billpmt_txn_id && !wiresWithAnyLink.has(t.id)) continue;
    const bridgeRows = bridge.filter(b => b.transaction_id === t.id);
    const perInvoice = [];
    if (bridgeRows.length > 0) {
      for (const b of bridgeRows) { const inv = invById.get(b.invoice_id); if (inv) perInvoice.push({ inv, share: Number(b.amount_share) }); }
    } else if (t.matched_invoice_id) {
      const inv = invById.get(t.matched_invoice_id); if (inv) perInvoice.push({ inv, share: Number(inv.total_amount) });
    }
    if (perInvoice.length === 0) continue;

    const vendorMap = new Map();
    for (const item of perInvoice) {
      const bi = billIndex.get(item.inv.id);
      if (!bi || !bi.vendor || !bi.refNumber) continue;
      const cached = refToTxnId.get(`${bi.vendor}::${bi.refNumber}`);
      // Response map now decodes XML entities in vendor names — no fallback needed.
      // (Prior fallback to invoices.qb_bill_txn_id was UNSAFE: that DB value could
      // hold a cross-vendor collision from the pre-vendor-scoped persist bug, and
      // silently paying the wrong bill would be worse than erroring out.)
      const txnId = cached?.txnId || null;
      const jobId = cached?.jobId || null;
      if (!txnId) {
        missingTxnIds.push({ vendor: bi.vendor, refNumber: bi.refNumber, invoiceId: item.inv.id });
        continue;
      }
      if (!vendorMap.has(bi.vendor)) vendorMap.set(bi.vendor, new Map());
      const billMap = vendorMap.get(bi.vendor);
      if (!billMap.has(bi.refNumber)) billMap.set(bi.refNumber, { items: [], txnId, jobId });
      billMap.get(bi.refNumber).items.push({ inv: item.inv, share: item.share });
    }
    for (const [vendorName, billMap] of vendorMap) {
      if (alreadyPaidPairs.has(`${t.id}::${vendorName}`)) {
        skippedAlreadyPaid.push({ wire: t.confirmation_number, vendor: vendorName });
        continue;
      }
      paymentGroups.push({ wire: t, vendorName, bills: billMap });
    }
  }
  if (skippedAlreadyPaid.length > 0) {
    console.log(`\nSkipped ${skippedAlreadyPaid.length} (wire, vendor) pair(s) — already recorded in convera_transaction_billpmts:`);
    for (const s of skippedAlreadyPaid) console.log(`   wire=${s.wire}  vendor="${s.vendor}"`);
  }

  if (missingTxnIds.length > 0) {
    console.warn(`\n⚠️  ${missingTxnIds.length} bill(s) missing TxnID — will be SKIPPED from this Phase 2 run:`);
    for (const m of missingTxnIds) console.warn(`   vendor="${m.vendor}"  RefNumber="${m.refNumber}"  invoiceId=${m.invoiceId}`);
    console.warn(`\nEither the bill_query is not yet done, or the bill doesn't exist in QB under that RefNumber.`);
    console.warn(`Payment groups depending exclusively on missing TxnIDs are dropped. Investigate + re-run to include them.\n`);
    // Drop payment groups that have any bill with missing TxnID (partial-fill would produce a wrong-amount payment)
    for (let i = paymentGroups.length - 1; i >= 0; i--) {
      const g = paymentGroups[i];
      const anyMissing = Array.from(g.bills.values()).some(b => !b.txnId);
      if (anyMissing) {
        console.warn(`   Dropping payment group: wire ${g.wire.confirmation_number} vendor="${g.vendorName}"`);
        paymentGroups.splice(i, 1);
      }
    }
    if (paymentGroups.length === 0) {
      console.error(`No payment groups left after dropping. Aborting.`);
      process.exit(1);
    }
    console.warn('');
  }

  console.log(`Building ${paymentGroups.length} bill_pmt_add payloads...`);
  const rows = paymentGroups.map(g => {
    const invoiceCount = Array.from(g.bills.values()).reduce((s, b) => s + b.items.length, 0);
    const dependsOn = Array.from(new Set(Array.from(g.bills.values()).map(b => b.jobId).filter(Boolean)));
    return {
      kind: 'bill_pmt_add',
      payload: {
        payeeVendorName: g.vendorName,
        bankAccountName: BANK_ACCOUNT_FULL_NAME,
        txnDate: g.wire.date_of_order,
        refNumber: g.wire.confirmation_number,
        // Source convera_transaction id — used by the edge fn to persist qb_billpmt_txn_id
        // back to the specific row after the payment succeeds. Without this, the persist
        // step no-ops and re-enqueues will produce duplicate payments (2026-08-14 incident).
        sourceConveraTxnId: g.wire.id,
        // NOTE: use ASCII hyphens, not em-dashes. project_qbxml_ascii_rule.
        memo: `Convera wire ${g.wire.confirmation_number} - ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} - ${g.vendorName}`,
        applications: Array.from(g.bills.entries()).map(([refNumber, bill]) => ({
          billTxnId: bill.txnId,
          paymentAmount: bill.items.reduce((s, it) => s + it.share, 0),
        })),
      },
      depends_on: dependsOn,
      status: 'pending',
    };
  });

  const totalDollar = rows.reduce((s, r) => s + r.payload.applications.reduce((ss, a) => ss + a.paymentAmount, 0), 0);
  console.log(`Inserting ${rows.length} bill_pmt_add jobs. Total $${totalDollar.toFixed(2)}.`);
  const { data: inserted, error } = await supabase.from('qb_sync_jobs').insert(rows).select('id, kind');
  if (error) { console.error('Insert failed:', error); process.exit(1); }
  console.log(`\n✅ Enqueued ${inserted.length} bill_pmt_add jobs. IDs: ${inserted.map(r => r.id).join(', ')}`);
  console.log(`\nHit "Update Selected" in QBWC to trigger immediate poll, or wait for the auto-poll.`);
  console.log(`WC will drain all ${inserted.length} payments in one session (~3-5 min).`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
