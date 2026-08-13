// qbXML batch dry-run — DOES NOT WRITE. Prints the plan for a Convera import_batch_id
// as (a) bill_query jobs (unique per QB bill, populates invoices.qb_bill_txn_id), and
// (b) bill_pmt_add jobs (one per (wire, qb_vendor_name) with one Application per QB bill).
//
// Model — discovered 2026-08-13 from qb_vendors + IIF bill/payment builders + probe of
// QB bill 4137C-1784758977 (RefNumber=MULTI-2026-05, Teal Crossroads, $32k):
//
//   - payment_profiles.qb_vendor_name is the source of truth for each invoice's QB vendor.
//   - QB bills are grouped by (qb_vendor_name, period_end YYYY-MM) at IIF export time:
//       * Group size >  1 → one QB bill with RefNumber="MULTI-<YYYY-MM>", N line items,
//         AmountDue = sum of all lines.
//       * Group size == 1 → one QB bill with RefNumber=<invoice_number>.
//     Verified live: 6 Teal Crossroads May 2026 invoices → ONE bill MULTI-2026-05.
//   - Umbrella wires may fan out across multiple vendors within one Convera confirmation
//     (e.g. Bimosoft wire → "Bimosoft - Bojan" + "Bimosoft - Edin" as distinct vendors).
//     Each vendor sub-group emits its own BillPaymentCheck.
//
// BillPaymentCheck payload:
//   - BankAccountRef.FullName = 'BANK/CASH:8220 - Key Point Checking' (all payments direct
//     from Key Point; bank fees handled by accountant as a separate manual item).
//   - PayeeEntityRef.FullName = the grouped qb_vendor_name.
//   - AppliedToTxnAdd[]: one entry per unique QB bill covered by this wire+vendor combo.
//     TxnID from prerequisite bill_query; PaymentAmount = SUM of invoice shares that
//     belong to this QB bill (supports partial-MULTI payment where only some line items
//     from a MULTI bill are being paid in this batch).
//   - RefNumber = confirmation_number (max 11 chars).
//   - Memo = "Convera wire <conf> — <n> bill(s) — <vendor>"
//   - TxnDate = date_of_order.
//
// Dependencies:
//   - Each bill_pmt_add depends on ALL bill_query jobs whose RefNumbers it references.
//   - Same (vendor, RefNumber) referenced by multiple wires shares one bill_query job.
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

  const { data: batchInvoices, error: e3 } = await supabase
    .from('invoices')
    .select('id, user_id, invoice_number, total_amount, currency, period_start, period_end, payment_profile, qb_bill_txn_id, qb_export_status, status, paid_date')
    .in('id', Array.from(invIds));
  if (e3) throw e3;

  // Load payment_profiles for LIVE lookup (invoice.payment_profile snapshot may have
  // stale/null qb_vendor_name — see the Aug 2026 pre-batch-15 investigation).
  const { data: profiles, error: e4 } = await supabase
    .from('payment_profiles')
    .select('id, user_id, qb_vendor_name, is_default, company_name');
  if (e4) throw e4;

  // Load ALL exported invoices — needed to compute (vendor, month) group sizes
  // and thus determine whether each batch invoice's QB bill uses RefNumber=<invoice_number>
  // or RefNumber=MULTI-<YYYY-MM>. See project_qb_web_connector_design; verified via
  // job 18 probe against MULTI-2026-05 which returned TxnID 4137C-1784758977.
  //
  // Paginate: invoices table can exceed the 1000-row default cap.
  const allExported = [];
  const INV_PAGE_SIZE = 1000;
  for (let from = 0; ; from += INV_PAGE_SIZE) {
    const { data: page, error: eE } = await supabase
      .from('invoices')
      .select('id, user_id, invoice_number, period_end, payment_profile, qb_bill_txn_id')
      .eq('qb_export_status', 'exported')
      .order('id')
      .range(from, from + INV_PAGE_SIZE - 1);
    if (eE) throw eE;
    if (!page || page.length === 0) break;
    allExported.push(...page);
    if (page.length < INV_PAGE_SIZE) break;
  }

  const userIds = Array.from(new Set(batchInvoices.map(i => i.user_id)));
  const { data: users, error: e5 } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', userIds);
  if (e5) throw e5;

  // Load qb_vendors for final verification (name must exist in QB).
  // Supabase caps single .select() at 1000 rows — paginate manually since we
  // have 1,165 vendors.
  const PAGE_SIZE = 1000;
  const qbVendors = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: e6 } = await supabase
      .from('qb_vendors')
      .select('list_id, name, is_active')
      .order('list_id')
      .range(from, from + PAGE_SIZE - 1);
    if (e6) throw e6;
    if (!page || page.length === 0) break;
    qbVendors.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return { txns, bridge, batchInvoices, allExported, profiles, users, qbVendors };
}

// ─── Bill grouping ──────────────────────────────────────────────────────────
//
// For each exported invoice, determine which QB bill it belongs to. The bill's
// RefNumber is MULTI-<YYYY-MM> if the (vendor, month) group has >1 exported
// invoice, else the invoice_number itself. Returns Map<invoice_id, { vendor,
// refNumber, groupSize }>.

function computeBillIndex(allExported, profiles) {
  // Step 1: resolve vendor for each exported invoice
  const invVendor = new Map();  // inv_id → vendor name (or null)
  const invMonth  = new Map();  // inv_id → period_end YYYY-MM (or null)
  for (const inv of allExported) {
    const { name: vendor } = resolveQbVendorName(inv, profiles);
    invVendor.set(inv.id, vendor);
    const month = (inv.period_end || '').slice(0, 7);
    invMonth.set(inv.id, month || null);
  }
  // Step 2: count invoices per (vendor, month)
  const groupCount = new Map();  // "vendor::month" → count
  for (const inv of allExported) {
    const vendor = invVendor.get(inv.id);
    const month = invMonth.get(inv.id);
    if (!vendor || !month) continue;
    const key = `${vendor}::${month}`;
    groupCount.set(key, (groupCount.get(key) || 0) + 1);
  }
  // Step 3: assign RefNumber per invoice
  const billIndex = new Map();  // inv_id → { vendor, refNumber, groupSize }
  for (const inv of allExported) {
    const vendor = invVendor.get(inv.id);
    const month = invMonth.get(inv.id);
    if (!vendor || !month) { billIndex.set(inv.id, { vendor, refNumber: null, groupSize: 0 }); continue; }
    const key = `${vendor}::${month}`;
    const size = groupCount.get(key);
    const refNumber = size > 1 ? `MULTI-${month}` : inv.invoice_number;
    billIndex.set(inv.id, { vendor, refNumber, groupSize: size });
  }
  return billIndex;
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
  const { txns, bridge, batchInvoices, allExported, profiles, users, qbVendors } = data;
  const invById = new Map(batchInvoices.map(i => [i.id, i]));
  const userById = new Map(users.map(u => [u.id, u]));
  const qbVendorSet = new Set(qbVendors.filter(v => v.is_active).map(v => v.name));

  // Compute bill index from ALL exported invoices, so batch invoices can look up
  // their QB bill's RefNumber (which may be MULTI-<YYYY-MM> if part of a group).
  const billIndex = computeBillIndex(allExported, profiles);
  // Also index by RefNumber for known-txn-id lookup (we already have qb_bill_txn_id
  // populated on some rows from earlier probes)
  const knownTxnByBillRef = new Map();  // "vendor::refNumber" → qb_bill_txn_id
  for (const inv of allExported) {
    const bi = billIndex.get(inv.id);
    if (!bi || !bi.refNumber || !inv.qb_bill_txn_id) continue;
    const key = `${bi.vendor}::${bi.refNumber}`;
    if (!knownTxnByBillRef.has(key)) knownTxnByBillRef.set(key, inv.qb_bill_txn_id);
  }

  const anomalies = [];
  const paymentGroups = [];  // { wire, vendorName, bills: Map<refNumber, { items:[{inv, share, user}], knownTxnId }> }

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

    // Group items in this wire by (vendor, billRefNumber)
    // vendorMap: vendor → Map<refNumber, { items: [{inv, share, user}], knownTxnId }>
    const vendorMap = new Map();
    for (const item of perInvoice) {
      const bi = billIndex.get(item.inv.id);
      if (!bi || !bi.vendor) {
        const { source } = resolveQbVendorName(item.inv, profiles);
        anomalies.push({ severity: 'error', txn: txn.id, invoice: item.inv.id, msg: `qb_vendor_name unresolved (source=${source}); wire ${txn.confirmation_number} contractor=${userById.get(item.inv.user_id)?.name}` });
        continue;
      }
      if (!qbVendorSet.has(bi.vendor)) {
        anomalies.push({ severity: 'error', txn: txn.id, invoice: item.inv.id, msg: `qb_vendor_name '${bi.vendor}' not found in qb_vendors (active).` });
        continue;
      }
      if (!bi.refNumber) {
        anomalies.push({ severity: 'error', txn: txn.id, invoice: item.inv.id, msg: `Invoice not part of any exported QB bill (missing invoice_number or period_end)` });
        continue;
      }
      if (item.inv.qb_export_status !== 'exported') {
        anomalies.push({ severity: 'warn', txn: txn.id, invoice: item.inv.id, msg: `Invoice qb_export_status='${item.inv.qb_export_status}' — bill may not exist in QB yet` });
      }
      if (!vendorMap.has(bi.vendor)) vendorMap.set(bi.vendor, new Map());
      const billMap = vendorMap.get(bi.vendor);
      if (!billMap.has(bi.refNumber)) {
        billMap.set(bi.refNumber, { items: [], knownTxnId: knownTxnByBillRef.get(`${bi.vendor}::${bi.refNumber}`) || null, groupSize: bi.groupSize });
      }
      billMap.get(bi.refNumber).items.push({ inv: item.inv, share: item.share, user: userById.get(item.inv.user_id) });
    }

    for (const [vendorName, billMap] of vendorMap) {
      paymentGroups.push({ wire: txn, vendorName, bills: billMap });
    }
  }

  // Deduplicate bill_query jobs by (vendor, refNumber). Only queue ones without known TxnID.
  const billQuerySet = new Map();  // key "vendor::refNumber" → { vendor, refNumber, dependents: [] }
  for (const g of paymentGroups) {
    for (const [refNumber, bill] of g.bills) {
      if (bill.knownTxnId) continue;  // already known — no query needed
      const key = `${g.vendorName}::${refNumber}`;
      if (!billQuerySet.has(key)) {
        billQuerySet.set(key, { vendor: g.vendorName, refNumber, groupSize: bill.groupSize });
      }
    }
  }
  const billQueryPlan = Array.from(billQuerySet.values());

  return { paymentGroups, billQueryPlan, anomalies };
}

// ─── Report printing ────────────────────────────────────────────────────────

function fmt$(n) { return `$${Number(n).toFixed(2)}`; }

function printReport(batchId, plan, data) {
  const { txns } = data;
  const { paymentGroups, billQueryPlan, anomalies } = plan;

  // Aggregations
  const uniqueInvIds = new Set();
  const wireTotalPaid = new Map();  // txn_id → sum across all vendor groups + bills
  const wireGroupCount = new Map(); // txn_id → # vendor groups
  let grandTotal = 0;
  for (const g of paymentGroups) {
    let groupTotal = 0;
    for (const [, bill] of g.bills) {
      for (const it of bill.items) {
        uniqueInvIds.add(it.inv.id);
        groupTotal += it.share;
      }
    }
    wireTotalPaid.set(g.wire.id, (wireTotalPaid.get(g.wire.id) || 0) + groupTotal);
    wireGroupCount.set(g.wire.id, (wireGroupCount.get(g.wire.id) || 0) + 1);
    grandTotal += groupTotal;
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════');
  console.log(`   qbXML BATCH DRY-RUN — import_batch_id = ${batchId}`);
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // ── Summary ──
  console.log('┌─ SUMMARY ─────────────────────────────────────────────────────────────────');
  console.log(`│ Total convera_transactions in batch:  ${txns.length}`);
  console.log(`│ Unique invoices to be paid:           ${uniqueInvIds.size}`);
  console.log(`│ Payment groups (BillPaymentCheck):    ${paymentGroups.length}`);
  console.log(`│ Prerequisite bill_query jobs:         ${billQueryPlan.length}`);
  console.log(`│ Total jobs to enqueue:                ${billQueryPlan.length + paymentGroups.length}`);
  console.log(`│ Anomalies flagged:                    ${anomalies.length}`);
  console.log(`│ Sum of payment amounts:               ${fmt$(grandTotal)}`);
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
  console.log('┌─ BILL_QUERY JOBS (prerequisite — populate qb_bill_txn_id per QB bill) ────');
  console.log(`│ ${billQueryPlan.length} unique QB bill(s) to query. MULTI-* refs cover N invoices in one QB bill;`);
  console.log(`│ single-invoice refs cover exactly one. Each payment job depends on the bill_query`);
  console.log(`│ for the QB bills it references. WC drains all in one session.`);
  console.log('│');
  for (let i = 0; i < billQueryPlan.length; i++) {
    const q = billQueryPlan[i];
    const multi = q.refNumber.startsWith('MULTI-') ? `  (grouped: ${q.groupSize} line items)` : '';
    console.log(`│   [${i + 1}] vendor="${q.vendor}"  RefNumber="${q.refNumber}"${multi}`);
  }
  console.log('└───────────────────────────────────────────────────────────────────────────\n');

  // ── Payment groups ──
  console.log('┌─ BILL_PMT_ADD JOBS (one per (wire × vendor) group) ───────────────────────');
  let totalCheck = 0;
  for (let i = 0; i < paymentGroups.length; i++) {
    const g = paymentGroups[i];
    const w = g.wire;
    const wireDate = w.date_of_order;
    const conf = w.confirmation_number;
    const refNumberOk = conf.length <= REF_NUMBER_MAX;
    let groupTotal = 0;
    for (const [, bill] of g.bills) for (const it of bill.items) groupTotal += it.share;
    totalCheck += groupTotal;
    const wireTotal = wireTotalPaid.get(w.id);
    const groupsInWire = wireGroupCount.get(w.id);
    const wireReconciled = Math.abs(Number(w.subtotal) - wireTotal) < 0.01;
    const applicationCount = g.bills.size;
    const invoiceCount = Array.from(g.bills.values()).reduce((s, b) => s + b.items.length, 0);

    console.log(`│`);
    console.log(`│ [${i + 1}/${paymentGroups.length}]  vendor: ${g.vendorName}`);
    console.log(`│        txn_id=${w.id}  wire=${conf}${refNumberOk ? '' : ' ⚠ EXCEEDS 11-CHAR REFNUMBER LIMIT'}  date=${wireDate}`);
    console.log(`│        ${applicationCount} application${applicationCount === 1 ? '' : 's'} covering ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}:`);
    for (const [refNumber, bill] of g.bills) {
      const billShare = bill.items.reduce((s, it) => s + it.share, 0);
      const txnIdShown = bill.knownTxnId || '<await bill_query>';
      const partial = bill.items.length < bill.groupSize ? `  [PARTIAL: paying ${bill.items.length} of ${bill.groupSize} MULTI line items]` : '';
      console.log(`│          Bill RefNumber="${refNumber}"  TxnID=${txnIdShown}  PaymentAmount=${fmt$(billShare)}${partial}`);
      for (const it of bill.items) {
        console.log(`│             ↳ ${it.inv.invoice_number}  (${it.user?.name || '?'})  share=${fmt$(it.share)}  inv_id=${it.inv.id}`);
      }
    }
    console.log(`│        Group share: ${fmt$(groupTotal)}   Wire subtotal: ${fmt$(w.subtotal)}   Wire total paid (${groupsInWire} vendor group${groupsInWire === 1 ? '' : 's'}): ${fmt$(wireTotal)}${wireReconciled ? ' ✅' : ' ⚠ MISMATCH'}`);
    console.log(`│        Payload preview:`);
    console.log(`│          PayeeEntityRef.FullName = "${g.vendorName}"`);
    console.log(`│          BankAccountRef.FullName = "${BANK_ACCOUNT_FULL_NAME}"`);
    console.log(`│          TxnDate = ${wireDate}    RefNumber = "${conf}"`);
    console.log(`│          Memo = "Convera wire ${conf} — ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} — ${g.vendorName}"`);
    console.log(`│          depends_on = <${applicationCount} bill_query job id${applicationCount === 1 ? '' : 's'}>`);
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
  console.log(`Loaded ${data.txns.length} transactions, ${data.batchInvoices.length} batch invoices, ${data.allExported.length} exported invoices (for MULTI grouping), ${data.profiles.length} payment profiles, ${data.qbVendors.length} qb_vendors.`);
  const plan = buildPlan(data);
  printReport(BATCH_ID, plan, data);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
