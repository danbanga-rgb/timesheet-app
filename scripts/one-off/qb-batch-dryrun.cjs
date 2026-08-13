// qbXML batch dry-run — DOES NOT WRITE. Prints the plan for a Convera import_batch_id
// as (a) bill_query jobs (one per unique invoice_number to fetch missing qb_bill_txn_id),
// and (b) bill_pmt_add jobs (one per (wire, qb_vendor_name) group).
//
// Model — discovered 2026-08-13 from qb_vendors + IIF payment builder + payment_profiles:
//   - payment_profiles.qb_vendor_name is the source of truth for each invoice's QB vendor.
//   - Umbrella payments group differently per umbrella:
//       * Bimosoft has per-contractor QB vendors ("Bimosoft - <Name>") → one wire may
//         yield multiple BillPaymentChecks (one per contractor vendor).
//       * Teal Crossroads has ONE umbrella QB vendor → all contractor bills roll up to
//         one BillPaymentCheck.
//   - Grouping happens after per-invoice vendor lookup, so it's data-driven, not per-umbrella.
//
// BillPaymentCheck payload:
//   - BankAccountRef.FullName = 'BANK/CASH:8220 - Key Point Checking' (all payments direct
//     from Key Point; bank fees handled by accountant as a separate manual item).
//   - PayeeEntityRef.FullName = the grouped qb_vendor_name.
//   - AppliedToTxnAdd[].TxnID = invoices.qb_bill_txn_id (populated by prerequisite bill_query).
//   - AppliedToTxnAdd[].PaymentAmount = per-invoice share (bridge amount_share OR full invoice
//     amount if single-matched).
//   - RefNumber = confirmation_number (max 11 chars).
//   - Memo = "Convera wire <conf> — <n> bill(s) — <vendor>"
//   - TxnDate = date_of_order.
//
// Dependencies:
//   - Each bill_pmt_add depends on ALL its constituent invoices' bill_query jobs.
//   - Same invoice referenced by multiple wires shares one bill_query job.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/one-off/qb-batch-dryrun.cjs [batch_id]
//
// Default batch_id = 15.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, key);

const BATCH_ID = Number(process.argv[2] || 15);
const BANK_ACCOUNT_FULL_NAME = 'BANK/CASH:8220 - Key Point Checking';
const REF_NUMBER_MAX = 11;

// ─── Data loading ───────────────────────────────────────────────────────────

async function loadBatch(batchId) {
  const { data: txns, error: e1 } = await supabase
    .from('convera_transactions')
    .select('id, confirmation_number, date_of_order, beneficiary_name, subtotal, grand_total, ref1, matched_invoice_id, match_state, matcher_ignore, qb_billpmt_txn_id, import_batch_id')
    .eq('import_batch_id', batchId)
    .order('id');
  if (e1) throw e1;

  const txnIds = txns.map(t => t.id);
  const { data: bridge, error: e2 } = await supabase
    .from('convera_transaction_invoices')
    .select('transaction_id, invoice_id, amount_share')
    .in('transaction_id', txnIds);
  if (e2) throw e2;

  // Collect all invoice ids we need to load
  const invIds = new Set();
  for (const t of txns) if (t.matched_invoice_id) invIds.add(t.matched_invoice_id);
  for (const b of bridge) if (b.invoice_id) invIds.add(b.invoice_id);

  const { data: invoices, error: e3 } = await supabase
    .from('invoices')
    .select('id, user_id, invoice_number, total_amount, currency, payment_profile, qb_bill_txn_id, qb_export_status, status, paid_date')
    .in('id', Array.from(invIds));
  if (e3) throw e3;

  // Load payment_profiles for LIVE lookup (invoice.payment_profile snapshot may have
  // stale/null qb_vendor_name — see the Aug 2026 pre-batch-15 investigation).
  const userIds = Array.from(new Set(invoices.map(i => i.user_id)));
  const { data: profiles, error: e4 } = await supabase
    .from('payment_profiles')
    .select('id, user_id, qb_vendor_name, is_default, company_name');
  if (e4) throw e4;

  const { data: users, error: e5 } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', userIds);
  if (e5) throw e5;

  // Load qb_vendors for final verification (name must exist in QB).
  // Supabase caps single .select() at 1000 rows — paginate manually since we
  // have 1,165 vendors.
  const qbVendors = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: e6 } = await supabase
      .from('qb_vendors')
      .select('list_id, name, is_active')
      .order('list_id')
      .range(from, from + PAGE - 1);
    if (e6) throw e6;
    if (!page || page.length === 0) break;
    qbVendors.push(...page);
    if (page.length < PAGE) break;
  }

  return { txns, bridge, invoices, profiles, users, qbVendors };
}

function resolveQbVendorName(invoice, profiles) {
  const pp = invoice.payment_profile;
  const profileId = pp && pp.id ? Number(pp.id) : 0;
  // Preferred: exact profile_id lookup on live payment_profiles
  if (profileId > 0) {
    const live = profiles.find(p => p.id === profileId);
    if (live && live.qb_vendor_name) return { source: 'profile_id', name: live.qb_vendor_name };
    if (live) return { source: 'profile_id_no_qb_name', name: null };
  }
  // Fallback 1: contractor's default profile
  const def = profiles.find(p => p.user_id === invoice.user_id && p.is_default);
  if (def && def.qb_vendor_name) return { source: 'user_default', name: def.qb_vendor_name };
  // Fallback 2: user has profiles with qb_vendor_names, and they all agree on ONE name
  // (Deniz Kesten case: 2 profiles, no default marked, both share qb_vendor_name)
  const userNames = new Set(
    profiles
      .filter(p => p.user_id === invoice.user_id && p.qb_vendor_name)
      .map(p => p.qb_vendor_name),
  );
  if (userNames.size === 1) {
    return { source: 'user_unanimous', name: [...userNames][0] };
  }
  if (userNames.size > 1) {
    return { source: 'user_ambiguous', name: null, options: [...userNames] };
  }
  if (def) return { source: 'user_default_no_qb_name', name: null };
  return { source: 'unresolved', name: null };
}

// ─── Plan generation ────────────────────────────────────────────────────────

function buildPlan(data) {
  const { txns, bridge, invoices, profiles, users, qbVendors } = data;
  const invById = new Map(invoices.map(i => [i.id, i]));
  const userById = new Map(users.map(u => [u.id, u]));
  const qbVendorSet = new Set(qbVendors.filter(v => v.is_active).map(v => v.name));

  const anomalies = [];
  const paymentGroups = [];  // { wire: txn, vendorName, invoices: [{ inv, share, user }] }
  const uniqueInvoiceIds = new Set();  // for bill_query prerequisites

  for (const txn of txns) {
    if (txn.matcher_ignore) {
      anomalies.push({ severity: 'info', txn: txn.id, msg: `Skipped: matcher_ignore` });
      continue;
    }
    if (txn.qb_billpmt_txn_id) {
      anomalies.push({ severity: 'info', txn: txn.id, msg: `Skipped: already has qb_billpmt_txn_id=${txn.qb_billpmt_txn_id}` });
      continue;
    }
    if (txn.match_state !== 'matched') {
      anomalies.push({ severity: 'warn', txn: txn.id, msg: `Skipped: match_state=${txn.match_state}` });
      continue;
    }

    // Collect invoices this txn pays: bridge takes precedence when present
    const bridgeRows = bridge.filter(b => b.transaction_id === txn.id);
    const perInvoice = [];
    if (bridgeRows.length > 0) {
      for (const b of bridgeRows) {
        const inv = invById.get(b.invoice_id);
        if (!inv) { anomalies.push({ severity: 'error', txn: txn.id, msg: `Bridge invoice_id=${b.invoice_id} not found` }); continue; }
        perInvoice.push({ inv, share: Number(b.amount_share) });
      }
    } else if (txn.matched_invoice_id) {
      const inv = invById.get(txn.matched_invoice_id);
      if (!inv) { anomalies.push({ severity: 'error', txn: txn.id, msg: `matched_invoice_id=${txn.matched_invoice_id} not found` }); continue; }
      perInvoice.push({ inv, share: Number(inv.total_amount) });
    } else {
      anomalies.push({ severity: 'warn', txn: txn.id, msg: `No invoice linkage (matched_invoice_id=null, no bridge rows). Wire ${txn.confirmation_number} beneficiary=${txn.beneficiary_name}` });
      continue;
    }

    // Resolve QB vendor per invoice; group within this wire by vendor
    const vendorMap = new Map();  // vendor name → [{ inv, share, user }]
    for (const item of perInvoice) {
      const { name: vendor, source } = resolveQbVendorName(item.inv, profiles);
      if (!vendor) {
        anomalies.push({ severity: 'error', txn: txn.id, invoice: item.inv.id, msg: `qb_vendor_name unresolved (source=${source}); wire ${txn.confirmation_number} contractor=${userById.get(item.inv.user_id)?.name}` });
        continue;
      }
      if (!qbVendorSet.has(vendor)) {
        anomalies.push({ severity: 'error', txn: txn.id, invoice: item.inv.id, msg: `qb_vendor_name '${vendor}' not found in qb_vendors (active). Rename in QB or update payment_profiles.qb_vendor_name.` });
        continue;
      }
      if (!item.inv.invoice_number) {
        anomalies.push({ severity: 'error', txn: txn.id, invoice: item.inv.id, msg: `Invoice has no invoice_number` });
        continue;
      }
      if (item.inv.qb_export_status !== 'exported') {
        anomalies.push({ severity: 'warn', txn: txn.id, invoice: item.inv.id, msg: `Invoice qb_export_status='${item.inv.qb_export_status}' — bill may not exist in QB yet` });
      }
      uniqueInvoiceIds.add(item.inv.id);
      if (!vendorMap.has(vendor)) vendorMap.set(vendor, []);
      vendorMap.get(vendor).push({ inv: item.inv, share: item.share, user: userById.get(item.inv.user_id) });
    }

    for (const [vendorName, items] of vendorMap) {
      paymentGroups.push({ wire: txn, vendorName, items });
    }
  }

  // Bill_query prerequisites: one per unique invoice_number (only those with qb_bill_txn_id NULL)
  const billQueryPlan = [];
  for (const invId of uniqueInvoiceIds) {
    const inv = invById.get(invId);
    if (!inv) continue;
    if (inv.qb_bill_txn_id) continue;  // already known — no query needed
    billQueryPlan.push({ invoiceId: inv.id, invoiceNumber: inv.invoice_number });
  }

  return { paymentGroups, billQueryPlan, anomalies };
}

// ─── Report printing ────────────────────────────────────────────────────────

function fmt$(n) { return `$${Number(n).toFixed(2)}`; }

function printReport(batchId, plan, data) {
  const { txns, invoices } = data;
  const { paymentGroups, billQueryPlan, anomalies } = plan;

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`   qbXML BATCH DRY-RUN — import_batch_id = ${batchId}`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // ── Summary ──
  console.log('┌─ SUMMARY ─────────────────────────────────────────────────────────────────');
  console.log(`│ Total convera_transactions in batch:  ${txns.length}`);
  console.log(`│ Unique invoices to be paid:           ${new Set(paymentGroups.flatMap(g => g.items.map(i => i.inv.id))).size}`);
  console.log(`│ Payment groups (BillPaymentCheck):    ${paymentGroups.length}`);
  console.log(`│ Prerequisite bill_query jobs:         ${billQueryPlan.length}`);
  console.log(`│ Total jobs to enqueue:                ${billQueryPlan.length + paymentGroups.length}`);
  console.log(`│ Anomalies flagged:                    ${anomalies.length}`);
  const totalDollar = paymentGroups.reduce((s, g) => s + g.items.reduce((ss, i) => ss + i.share, 0), 0);
  console.log(`│ Sum of payment amounts:               ${fmt$(totalDollar)}`);
  console.log(`│ BankAccountRef:                       ${BANK_ACCOUNT_FULL_NAME}`);
  console.log('└───────────────────────────────────────────────────────────────────────────\n');

  // ── Anomalies ──
  if (anomalies.length > 0) {
    console.log('┌─ ANOMALIES ───────────────────────────────────────────────────────────────');
    for (const a of anomalies) {
      const tag = a.severity === 'error' ? '❌ ERROR' : a.severity === 'warn' ? '⚠️  WARN' : 'ℹ️  INFO';
      const loc = a.invoice ? `txn ${a.txn} inv ${a.invoice}` : `txn ${a.txn}`;
      console.log(`│ ${tag}  [${loc}]  ${a.msg}`);
    }
    console.log('└───────────────────────────────────────────────────────────────────────────\n');
  }

  // ── Bill query plan ──
  console.log('┌─ BILL_QUERY JOBS (prerequisite — populate invoices.qb_bill_txn_id) ───────');
  console.log(`│ ${billQueryPlan.length} unique invoice_numbers to query. Each job depends on nothing;`);
  console.log(`│ payment jobs depend on these. Enqueue all together — WC processes in one session.`);
  console.log('│');
  console.log('│ RefNumbers to send in BillQueryRq requests:');
  for (const q of billQueryPlan) {
    console.log(`│   • inv_id=${q.invoiceId}  →  RefNumber='${q.invoiceNumber}'`);
  }
  console.log('└───────────────────────────────────────────────────────────────────────────\n');

  // ── Payment groups ──
  // Pre-compute per-wire totals across ALL vendor groups so multi-vendor wires
  // (e.g. Bimosoft split across Bojan + Edin) reconcile against the wire
  // subtotal correctly. Per-group sum vs wire is only meaningful when the wire
  // has ONE vendor group; multi-vendor wires reconcile at the wire level.
  const wireTotalPaid = new Map();  // txn_id → sum of all shares across all groups
  const wireGroupCount = new Map(); // txn_id → group count
  for (const g of paymentGroups) {
    wireTotalPaid.set(g.wire.id, (wireTotalPaid.get(g.wire.id) || 0) + g.items.reduce((s, it) => s + it.share, 0));
    wireGroupCount.set(g.wire.id, (wireGroupCount.get(g.wire.id) || 0) + 1);
  }

  console.log('┌─ BILL_PMT_ADD JOBS (one per (wire × vendor) group) ───────────────────────');
  let totalCheck = 0;
  for (let i = 0; i < paymentGroups.length; i++) {
    const g = paymentGroups[i];
    const w = g.wire;
    const wireDate = w.date_of_order;
    const conf = w.confirmation_number;
    const refNumberOk = conf.length <= REF_NUMBER_MAX;
    const sumShare = g.items.reduce((s, it) => s + it.share, 0);
    totalCheck += sumShare;
    const wireTotal = wireTotalPaid.get(w.id);
    const groupsInWire = wireGroupCount.get(w.id);
    const wireReconciled = Math.abs(Number(w.subtotal) - wireTotal) < 0.01;
    console.log(`│`);
    console.log(`│ [${i + 1}/${paymentGroups.length}]  vendor: ${g.vendorName}`);
    console.log(`│        txn_id=${w.id}  wire=${conf}${refNumberOk ? '' : ' ⚠ EXCEEDS 11-CHAR REFNUMBER LIMIT'}  date=${wireDate}`);
    console.log(`│        Applications (${g.items.length}):`);
    for (const it of g.items) {
      const inv = it.inv;
      const knownTxnId = inv.qb_bill_txn_id || '<await bill_query>';
      console.log(`│          - ${inv.invoice_number}  (${it.user?.name || '?'})  ${fmt$(it.share)}  bill_txn=${knownTxnId}`);
    }
    console.log(`│        Group share: ${fmt$(sumShare)}   Wire subtotal: ${fmt$(w.subtotal)}   Wire total paid (${groupsInWire} group${groupsInWire === 1 ? '' : 's'}): ${fmt$(wireTotal)}${wireReconciled ? ' ✅' : ' ⚠ MISMATCH'}`);
    console.log(`│        Payload preview:`);
    console.log(`│          PayeeEntityRef.FullName = "${g.vendorName}"`);
    console.log(`│          BankAccountRef.FullName = "${BANK_ACCOUNT_FULL_NAME}"`);
    console.log(`│          TxnDate = ${wireDate}    RefNumber = "${conf}"`);
    console.log(`│          Memo = "Convera wire ${conf} — ${g.items.length} bill${g.items.length === 1 ? '' : 's'} — ${g.vendorName}"`);
    console.log(`│          depends_on = <${g.items.length} bill_query job id${g.items.length === 1 ? '' : 's'}>`);
  }
  console.log(`│`);
  console.log(`│ Total across all payment groups: ${fmt$(totalCheck)}`);
  console.log('└───────────────────────────────────────────────────────────────────────────\n');

  console.log('DRY-RUN COMPLETE. No writes performed. Review above, then approve to enqueue.\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Loading batch ${BATCH_ID}...`);
  const data = await loadBatch(BATCH_ID);
  console.log(`Loaded ${data.txns.length} transactions, ${data.invoices.length} invoices, ${data.profiles.length} payment profiles, ${data.qbVendors.length} qb_vendors.`);
  const plan = buildPlan(data);
  printReport(BATCH_ID, plan, data);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
