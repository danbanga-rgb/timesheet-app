// Phase 1a of Intuit → QB push: enqueue bill_query for each Intuit-marked invoice
// that doesn't yet have a bill in QB.
//
// The purpose is "query-then-add" — before creating bills in QB, check whether
// QB already has one under the same RefNumber (which could happen if the
// accountant historically IIF-imported this invoice's bill). The existing
// bill_query persist path (post-4caef92) writes qb_bill_txn_id back to invoices
// whose (vendor, invoice_number) matches — so after WC drains these queries,
// any invoice with a real QB bill will have qb_bill_txn_id populated. Phase 1b
// (qb-intuit-enqueue-bills.cjs) then only enqueues bill_add for the still-NULL ones.
//
// Only pushes:
//   - explicit payment_method='Intuit' (accountant opted in)
//   - status='approved' (forward-only; not historical 'paid')
//   - qb_bill_txn_id IS NULL
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-intuit-enqueue-queries.cjs [--apply]

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);
const APPLY = process.argv.includes('--apply');

function resolveQbVendorName(invoice, profiles) {
  const pp = invoice.payment_profile;
  const profileId = pp && pp.id ? Number(pp.id) : 0;
  if (profileId > 0) {
    const live = profiles.find(p => p.id === profileId);
    if (live && live.qb_vendor_name) return live.qb_vendor_name;
  }
  const def = profiles.find(p => p.user_id === invoice.user_id && p.is_default);
  if (def && def.qb_vendor_name) return def.qb_vendor_name;
  const userNames = new Set(profiles.filter(p => p.user_id === invoice.user_id && p.qb_vendor_name).map(p => p.qb_vendor_name));
  if (userNames.size === 1) return [...userNames][0];
  return null;
}

(async () => {
  console.log('\n=== Intuit → QB push, Phase 1a (bill_query enqueue) ===');
  console.log(APPLY ? '*** APPLY MODE — will insert bill_query jobs ***' : 'Dry-run (pass --apply to insert)\n');

  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, user_id, user_name, invoice_number, period_end, payment_method, payment_profile, qb_bill_txn_id, status')
    .eq('payment_method', 'Intuit')
    .eq('status', 'approved')
    .is('qb_bill_txn_id', null)
    .order('id');
  if (error) { console.error('Invoice query failed:', error); process.exit(1); }
  console.log(`Candidate invoices (Intuit, approved, no QB bill): ${invoices.length}`);
  if (invoices.length === 0) { console.log('Nothing to query.'); return; }

  const { data: profiles } = await supabase
    .from('payment_profiles')
    .select('id, user_id, qb_vendor_name, is_default');

  // Collect unique invoice_numbers (bill_query is refNumber-only; vendor scoping happens on persist)
  const uniqueRefs = new Map(); // refNumber → [invoiceIds]
  const skipped = [];
  for (const inv of invoices) {
    const vendorName = resolveQbVendorName(inv, profiles);
    if (!vendorName) { skipped.push({ inv, reason: 'no qb_vendor_name' }); continue; }
    if (!inv.invoice_number) { skipped.push({ inv, reason: 'no invoice_number' }); continue; }
    if (!uniqueRefs.has(inv.invoice_number)) uniqueRefs.set(inv.invoice_number, []);
    uniqueRefs.get(inv.invoice_number).push(inv.id);
  }

  console.log('\n=== PLAN ===');
  for (const [ref, ids] of uniqueRefs) {
    console.log(`  bill_query refNumber="${ref}"  covers invoice ids: ${ids.join(', ')}`);
  }
  if (skipped.length > 0) {
    console.log('\n=== SKIPPED ===');
    for (const s of skipped) console.log(`  inv ${s.inv.id} (${s.inv.user_name}): ${s.reason}`);
  }

  if (!APPLY) {
    console.log(`\n(dry-run — no writes. Pass --apply to insert ${uniqueRefs.size} bill_query job(s))`);
    return;
  }

  const rows = [...uniqueRefs.keys()].map(ref => ({
    kind: 'bill_query',
    payload: { refNumbers: [ref] },
    status: 'pending',
  }));
  const { data: inserted, error: insErr } = await supabase.from('qb_sync_jobs').insert(rows).select('id, payload');
  if (insErr) { console.error('Insert failed:', insErr); process.exit(1); }
  console.log(`\n✅ Enqueued ${inserted.length} bill_query jobs. IDs: ${inserted.map(r => r.id).join(', ')}`);
  console.log(`\nHit "Update Selected" in QBWC, or wait for the next auto-poll (:13/:28/:43/:58 PT).`);
  console.log(`After WC drains, run: node scripts/one-off/qb-intuit-enqueue-bills.cjs`);
  console.log(`That will re-check qb_bill_txn_id state and only enqueue bill_add for invoices QB doesn't have yet.`);
})().catch(err => { console.error(err); process.exit(1); });
