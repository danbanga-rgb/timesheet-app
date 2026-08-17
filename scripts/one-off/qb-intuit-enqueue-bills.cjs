// Phase 1b of Intuit → QB push: enqueue bill_add jobs for Intuit-marked invoices
// that still don't have a QB bill after Phase 1a (qb-intuit-enqueue-queries.cjs).
//
// Query-then-add safety: Phase 1a fires bill_query for each ref. QB's bill_query
// persist path writes qb_bill_txn_id back to matching invoices via (vendor,
// refNumber). So by the time this script runs (after Phase 1a's WC drain), any
// invoice that has a pre-existing bill in QB — e.g. from a historic IIF import —
// will have qb_bill_txn_id populated and gets filtered out here. Prevents
// duplicate bills in QB from bill_add creating what already exists.
//
// Mirrors the Convera bill_add pattern (per-invoice bill, grouped as MULTI-YYYY-MM
// when a single QB vendor has multiple invoices in the same period_end month).
// For Intuit vendors MULTI is unexpected — each vendor (Flawless, Yara, Procal,
// Hovercloud) has a single contractor billing through them — but the logic is
// symmetric so we support it.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-intuit-enqueue-bills.cjs [--apply]
//
// Default is DRY-RUN. Pass --apply to insert bill_add jobs into qb_sync_jobs.
//
// See [[intuit-push-context]] memory for vendor + bank + refnumber decisions.
// Bank account is NOT used at this stage — bill_add doesn't touch cash.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);
const APPLY = process.argv.includes('--apply');

// Same defaults as Convera bill_add.
const DEFAULT_TERMS_DAYS = 30;
const termsMap = { NET15: 15, NET30: 30, NET45: 45, NET60: 60 };

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function lastDayOfMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function addDays(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

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
  console.log('\n=== Intuit → QB push, Phase 1 (bill_add enqueue) ===');
  console.log(APPLY ? '*** APPLY MODE — will insert jobs ***' : 'Dry-run (pass --apply to insert)\n');

  // Only push:
  //   - explicit payment_method='Intuit' (accountant opted in)
  //   - status='approved' (not draft/submitted/rejected)
  //   - qb_bill_txn_id IS NULL (not already in QB)
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, user_id, user_name, invoice_number, period_start, period_end, total_hours, rate, total_amount, payment_method, payment_terms, payment_profile, qb_bill_txn_id, qb_export_status, status')
    .eq('payment_method', 'Intuit')
    .eq('status', 'approved')
    .is('qb_bill_txn_id', null)
    .order('id');
  if (error) { console.error('Invoice query failed:', error); process.exit(1); }
  console.log(`Candidate invoices (Intuit, approved, no QB bill): ${invoices.length}`);
  if (invoices.length === 0) { console.log('Nothing to enqueue.'); return; }

  const { data: profiles } = await supabase
    .from('payment_profiles')
    .select('id, user_id, qb_vendor_name, is_default');

  // Resolve vendor per invoice + partition
  const enqueueable = [];
  const skipped = [];
  for (const inv of invoices) {
    const vendorName = resolveQbVendorName(inv, profiles);
    if (!vendorName) { skipped.push({ inv, reason: 'no qb_vendor_name on profile' }); continue; }
    if (!inv.period_end) { skipped.push({ inv, reason: 'missing period_end' }); continue; }
    if (!inv.total_amount) { skipped.push({ inv, reason: 'missing total_amount' }); continue; }
    enqueueable.push({ inv, vendorName });
  }

  // Group by (vendorName, period_end month) — MULTI-YYYY-MM when >1 in group
  const groups = new Map();
  for (const item of enqueueable) {
    const month = item.inv.period_end.slice(0, 7);
    const key = `${item.vendorName}::${month}`;
    if (!groups.has(key)) groups.set(key, { vendorName: item.vendorName, month, items: [] });
    groups.get(key).items.push(item);
  }

  // Build bill_add payloads
  const jobs = [];
  for (const [key, group] of groups) {
    const { vendorName, month, items } = group;
    const isMulti = items.length > 1;
    const [y, m] = month.split('-').map(Number);
    const monthLabel = `${MONTHS_FULL[m - 1]} ${y}`;
    const txnDate = lastDayOfMonth(month);
    // Due date: use the earliest invoice's terms (they should all match for a group)
    const termsDays = items.map(i => termsMap[i.inv.payment_terms] ?? DEFAULT_TERMS_DAYS);
    const dueDate = addDays(txnDate, Math.max(...termsDays));
    const refNumber = isMulti ? `MULTI-${month}` : items[0].inv.invoice_number;
    const totalHours = items.reduce((s, i) => s + (Number(i.inv.total_hours) || 0), 0);
    const memo = isMulti
      ? `${monthLabel} - ${items.length} contractors - ${totalHours}h total`
      : `${monthLabel} - ${items[0].inv.total_hours || '?'}h @ $${items[0].inv.rate || '?'} - ${items[0].inv.user_name}`;
    const lines = items.map(i => ({
      amount: Number(i.inv.total_amount),
      memo: `${monthLabel} - ${i.inv.total_hours || '?'}h @ $${i.inv.rate || '?'} - ${i.inv.user_name} - ${i.inv.invoice_number}`,
    }));
    jobs.push({
      kind: 'bill_add',
      payload: { vendorName, refNumber, txnDate, dueDate, memo, lines },
      _preview: { invoiceIds: items.map(i => i.inv.id), invoiceNumbers: items.map(i => i.inv.invoice_number) },
    });
  }

  console.log('\n=== PLAN ===');
  for (const j of jobs) {
    const p = j.payload;
    console.log(`  vendor="${p.vendorName}"  ref="${p.refNumber}"  txn=${p.txnDate}  due=${p.dueDate}  lines=${p.lines.length}  total=$${p.lines.reduce((s, l) => s + l.amount, 0).toFixed(2)}`);
    console.log(`    invoices: ${j._preview.invoiceNumbers.join(', ')} (ids ${j._preview.invoiceIds.join(', ')})`);
  }

  if (skipped.length > 0) {
    console.log('\n=== SKIPPED ===');
    for (const s of skipped) {
      console.log(`  inv ${s.inv.id} (${s.inv.invoice_number} / ${s.inv.user_name}): ${s.reason}`);
    }
  }

  if (!APPLY) {
    console.log(`\n(dry-run — no writes. Pass --apply to insert ${jobs.length} bill_add job(s))`);
    return;
  }

  const rows = jobs.map(j => ({ kind: j.kind, payload: j.payload, status: 'pending' }));
  const { data: inserted, error: insErr } = await supabase.from('qb_sync_jobs').insert(rows).select('id, payload');
  if (insErr) { console.error('Insert failed:', insErr); process.exit(1); }
  console.log(`\n✅ Enqueued ${inserted.length} bill_add jobs. IDs: ${inserted.map(r => r.id).join(', ')}`);
  console.log(`\nHit "Update Selected" in QBWC, or wait for the next auto-poll (:13/:28/:43/:58 PT).`);
  console.log(`After WC drains, invoices will have qb_bill_txn_id populated. Phase 2 (bill_pmt_add) is a separate script.`);
})().catch(err => { console.error(err); process.exit(1); });
