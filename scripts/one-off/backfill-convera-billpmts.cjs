// Backfill convera_transaction_billpmts from legacy convera_transactions.qb_billpmt_txn_id.
//
// The single-value column was populated one payment at a time (last-wins for
// umbrella wires). This script inserts one link row per (wire, vendor) using
// the vendor derivation logic from qb-batch-enqueue-payments:
//   - Read wire's matched invoices via bridge (convera_transaction_invoices)
//     or fall back to matched_invoice_id
//   - Resolve each invoice's qb_vendor_name via payment_profile snapshot →
//     is_default → sole-vendor
//   - Group invoices by vendor, sum payment_amount per vendor
//   - For single-vendor wires: (wire, vendor, existing_txnid, sum) → clean
//   - For umbrella wires: only ONE vendor's TxnID was retained (last-persisted).
//     We can't recover which vendor that was, so we log and skip, requiring the
//     accountant to re-verify manually.
//
// Usage:
//   Dry-run:  SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/backfill-convera-billpmts.cjs
//   Apply:    SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/backfill-convera-billpmts.cjs --apply

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
  const names = new Set(profiles.filter(p => p.user_id === invoice.user_id && p.qb_vendor_name).map(p => p.qb_vendor_name));
  if (names.size === 1) return [...names][0];
  return null;
}

(async () => {
  // Load all wires with a legacy single-value TxnID.
  const { data: wires } = await supabase
    .from('convera_transactions')
    .select('id, confirmation_number, matched_invoice_id, qb_billpmt_txn_id')
    .not('qb_billpmt_txn_id', 'is', null);
  console.log(`Legacy-linked wires: ${wires.length}`);

  const wireIds = wires.map(w => w.id);
  const { data: bridge } = await supabase
    .from('convera_transaction_invoices')
    .select('transaction_id, invoice_id, amount_share')
    .in('transaction_id', wireIds);

  const invIds = new Set();
  for (const w of wires) if (w.matched_invoice_id) invIds.add(w.matched_invoice_id);
  for (const b of bridge) if (b.invoice_id) invIds.add(b.invoice_id);

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, user_id, total_amount, payment_profile')
    .in('id', Array.from(invIds));
  const invById = new Map(invoices.map(i => [i.id, i]));

  const { data: profiles } = await supabase
    .from('payment_profiles')
    .select('id, user_id, qb_vendor_name, is_default');

  const singleVendorRows = [];
  const umbrellaWires = [];
  const unmappedWires = [];

  for (const w of wires) {
    const bridgeRows = bridge.filter(b => b.transaction_id === w.id);
    const perInvoice = [];
    if (bridgeRows.length > 0) {
      for (const b of bridgeRows) {
        const inv = invById.get(b.invoice_id);
        if (inv) perInvoice.push({ inv, share: Number(b.amount_share) });
      }
    } else if (w.matched_invoice_id) {
      const inv = invById.get(w.matched_invoice_id);
      if (inv) perInvoice.push({ inv, share: Number(inv.total_amount) });
    }
    if (perInvoice.length === 0) { unmappedWires.push({ w, reason: 'no invoices linked' }); continue; }

    // Group by vendor
    const vendorMap = new Map();
    let anyUnmapped = false;
    for (const item of perInvoice) {
      const vendor = resolveQbVendorName(item.inv, profiles);
      if (!vendor) { anyUnmapped = true; continue; }
      vendorMap.set(vendor, (vendorMap.get(vendor) || 0) + item.share);
    }
    if (vendorMap.size === 0) { unmappedWires.push({ w, reason: 'no invoice yields a qb_vendor_name' }); continue; }
    if (anyUnmapped) unmappedWires.push({ w, reason: 'some invoices unmapped — partial vendor coverage' });

    if (vendorMap.size === 1) {
      const [vendor, amount] = [...vendorMap.entries()][0];
      singleVendorRows.push({
        convera_transaction_id: w.id,
        qb_vendor_name:         vendor,
        qb_billpmt_txn_id:      w.qb_billpmt_txn_id,
        payment_amount:         amount,
      });
    } else {
      umbrellaWires.push({ w, vendors: [...vendorMap.entries()] });
    }
  }

  console.log(`\n─── Backfill plan ───`);
  console.log(`Single-vendor (backfillable):  ${singleVendorRows.length}`);
  console.log(`Umbrella (partial — skip):     ${umbrellaWires.length}`);
  console.log(`Unmapped (skip):               ${unmappedWires.length}`);

  if (umbrellaWires.length > 0) {
    console.log(`\n─── Umbrella wires (only 1-of-N TxnIDs retained by legacy column — MANUAL RECONCILE) ───`);
    for (const u of umbrellaWires) {
      console.log(`  wire.id=${u.w.id}  conf=${u.w.confirmation_number}  legacy_txnid=${u.w.qb_billpmt_txn_id}`);
      for (const [v, a] of u.vendors) console.log(`    vendor="${v}"  amount=$${a.toFixed(2)}`);
    }
  }
  if (unmappedWires.length > 0) {
    console.log(`\n─── Unmapped wires ───`);
    for (const u of unmappedWires) console.log(`  wire.id=${u.w.id}  conf=${u.w.confirmation_number}  reason: ${u.reason}`);
  }

  if (!APPLY) {
    console.log(`\nDry-run. Re-run with --apply to insert ${singleVendorRows.length} link rows.`);
    return;
  }

  console.log(`\n⚠️  --apply set. Inserting ${singleVendorRows.length} rows into convera_transaction_billpmts...`);
  // Chunk to avoid Postgrest limits
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < singleVendorRows.length; i += CHUNK) {
    const chunk = singleVendorRows.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('convera_transaction_billpmts')
      .upsert(chunk, { onConflict: 'convera_transaction_id,qb_vendor_name' })
      .select('id');
    if (error) { console.error('Insert failed:', error); process.exit(1); }
    inserted += (data || []).length;
  }
  console.log(`✅ Inserted/updated ${inserted} link rows.`);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
