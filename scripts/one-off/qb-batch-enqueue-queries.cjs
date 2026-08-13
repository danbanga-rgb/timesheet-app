// Phase 1 of batch qbXML enqueue: insert bill_query jobs for a given batch_id.
// Uses the same plan-building logic as qb-batch-dryrun.cjs.
//
// After WC drains these, run qb-batch-enqueue-payments.cjs to insert the
// bill_pmt_add jobs (TxnIDs baked in from bill_query responses).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-batch-enqueue-queries.cjs [batch_id]

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);
const BATCH_ID = Number(process.argv[2] || 15);

// Reuse plan logic — inline the pieces we need. Kept in sync with qb-batch-dryrun.cjs.

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

async function loadAndPlan(batchId) {
  const { data: txns } = await supabase
    .from('convera_transactions')
    .select('id, matched_invoice_id, match_state, matcher_ignore, qb_billpmt_txn_id')
    .eq('import_batch_id', batchId);
  const txnIds = txns.map(t => t.id);
  const { data: bridge } = await supabase
    .from('convera_transaction_invoices')
    .select('transaction_id, invoice_id')
    .in('transaction_id', txnIds);
  const invIds = new Set();
  for (const t of txns) if (t.matched_invoice_id) invIds.add(t.matched_invoice_id);
  for (const b of bridge) if (b.invoice_id) invIds.add(b.invoice_id);
  const { data: batchInvoices } = await supabase
    .from('invoices')
    .select('id, user_id, invoice_number, period_end, payment_profile, qb_bill_txn_id, qb_export_status')
    .in('id', Array.from(invIds));
  const { data: profiles } = await supabase
    .from('payment_profiles')
    .select('id, user_id, qb_vendor_name, is_default');
  // Load all exported invoices for MULTI grouping
  const allExported = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page } = await supabase.from('invoices').select('id, user_id, invoice_number, period_end, payment_profile, qb_bill_txn_id').eq('qb_export_status', 'exported').order('id').range(from, from + PAGE_SIZE - 1);
    if (!page || page.length === 0) break;
    allExported.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  // Build bill index
  const groupCount = new Map();
  for (const inv of allExported) {
    const { name: vendor } = resolveQbVendorName(inv, profiles);
    const month = (inv.period_end || '').slice(0, 7);
    if (!vendor || !month) continue;
    const key = `${vendor}::${month}`;
    groupCount.set(key, (groupCount.get(key) || 0) + 1);
  }
  const billIndex = new Map();
  for (const inv of allExported) {
    const { name: vendor } = resolveQbVendorName(inv, profiles);
    const month = (inv.period_end || '').slice(0, 7);
    if (!vendor || !month) { billIndex.set(inv.id, { vendor: null, refNumber: null }); continue; }
    const key = `${vendor}::${month}`;
    const refNumber = groupCount.get(key) > 1 ? `MULTI-${month}` : inv.invoice_number;
    billIndex.set(inv.id, { vendor, refNumber });
  }
  const knownTxnByBillRef = new Map();
  for (const inv of allExported) {
    const bi = billIndex.get(inv.id);
    if (!bi || !bi.refNumber || !inv.qb_bill_txn_id) continue;
    knownTxnByBillRef.set(`${bi.vendor}::${bi.refNumber}`, inv.qb_bill_txn_id);
  }
  // Compute unique (vendor, refNumber) bills needing queries — from batch invoices only
  const invById = new Map(batchInvoices.map(i => [i.id, i]));
  const needed = new Map();  // key → { vendor, refNumber }
  for (const t of txns) {
    if (t.matcher_ignore || t.qb_billpmt_txn_id || t.match_state !== 'matched') continue;
    const bridgeRows = bridge.filter(b => b.transaction_id === t.id);
    const targetInvIds = bridgeRows.length > 0 ? bridgeRows.map(b => b.invoice_id) : (t.matched_invoice_id ? [t.matched_invoice_id] : []);
    for (const iid of targetInvIds) {
      const inv = invById.get(iid);
      if (!inv) continue;
      const bi = billIndex.get(iid);
      if (!bi || !bi.vendor || !bi.refNumber) continue;
      const key = `${bi.vendor}::${bi.refNumber}`;
      if (knownTxnByBillRef.has(key)) continue;  // already known
      if (!needed.has(key)) needed.set(key, { vendor: bi.vendor, refNumber: bi.refNumber });
    }
  }
  return Array.from(needed.values());
}

(async () => {
  console.log(`Building bill_query plan for batch ${BATCH_ID}...`);
  const queries = await loadAndPlan(BATCH_ID);
  console.log(`${queries.length} unique bill_query jobs to insert.\n`);
  for (const q of queries) console.log(`  vendor="${q.vendor}"  RefNumber="${q.refNumber}"`);
  console.log(`\nInserting into qb_sync_jobs...`);
  const rows = queries.map(q => ({
    kind: 'bill_query',
    payload: { refNumbers: [q.refNumber] },
    status: 'pending',
  }));
  const { data: inserted, error } = await supabase.from('qb_sync_jobs').insert(rows).select('id, kind, payload');
  if (error) { console.error('Insert failed:', error); process.exit(1); }
  console.log(`\n✅ Enqueued ${inserted.length} bill_query jobs. IDs: ${inserted.map(r => r.id).join(', ')}`);
  console.log(`\nHit "Update Selected" in QBWC to trigger immediate poll, or wait for the :~28 auto-poll.`);
  console.log(`Once all are 'done', run: node scripts/one-off/qb-batch-enqueue-payments.cjs ${BATCH_ID}`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
