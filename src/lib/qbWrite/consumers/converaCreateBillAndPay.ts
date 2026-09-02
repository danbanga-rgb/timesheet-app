// converaCreateBillAndPay — Slice C-2 consumer for the Convera pay path.
//
// Handles the "bill doesn't exist in QB yet" gap that Slice C-1 skipped:
// enqueues bill_add for each missing bill, then chains a bill_pmt_add
// (BillPaymentCheckAdd) with __hydrate_bill_txn_id_from_dep so the pay
// dispatches with the freshly-created bill's TxnID hydrated at drain time.
//
// Scope for C-2 (single-slot hydration mechanism):
//   ✅ Single-invoice Convera events (matched_invoice_ids.length === 1) —
//      one bill_add → one pay_bill.
//   ❌ Multi-vendor umbrella (Bimosoft-style: one wire, N vendors) —
//      skipped with a clear reason. Requires N BillPmts (one per vendor),
//      each linked to the same wire. Slice C-3.
//   ❌ Same-vendor multi-invoice — skipped for the same reason: the
//      single-slot __hydrate_bill_txn_id_from_dep only fills
//      applications[0]. Multi-slot hydration is a future qb-web-connector
//      extension when the case actually appears (zero rows in current
//      data 2026-09-02).
//
// Delegation: reuses pushConveraInvoiceCreateBill for the bill_add step
// so all the vendor-resolution / eligibility / ASCII / expense-account
// logic stays in one place. This consumer wires the pay chain on top of
// the returned perIntent metadata.
//
// Bypasses executeIntents for the pay leg (mirror intuitCreateBill.ts
// pattern): the INVARIANT #11 vendor-scoped-TxnID check would fail on a
// nascent bill (no qb_mirror row yet). Vendor-scope is satisfied by
// construction — we're paying our own newly-created bill for the
// resolved payee vendor.

import type { SupabaseClient } from '@supabase/supabase-js';
import { pushConveraInvoiceCreateBill } from './converaInvoiceCreateBill';
import type { ExecuteResult } from '../types';

export interface ConveraCreateBillAndPayResult extends ExecuteResult {
  skippedIneligible: Array<{ eventId: number; reason: string }>;
  /** bill_add job ids enqueued via the delegated create_bill consumer.
   *  Order-parallel to eligible events (same length as chainedPayJobIds). */
  billAddJobIds: number[];
  /** bill_pmt_add job ids chained on top of the bill_add jobs. */
  chainedPayJobIds: number[];
  /** bill_query verify job ids chained on top of the chained pay jobs.
   *  Keyed by the pay job id that spawned them. */
  verifyJobIdByPayJobId: Record<number, number>;
}

interface IngestEventRow {
  id: number;
  source: string;
  amount: number | string;
  counterparty_qb_vendor_list_id: string | null;
  status: string;
  target_qb_txn_kind: string | null;
  matched_invoice_ids: number[] | null;
  raw_data: { convera_transaction_id?: number } | null;
}

interface InvoiceRow {
  id: number;
  user_id: string;
  qb_bill_txn_id: string | null;
  total_amount: number | string;
  invoice_number: string | null;
}

interface ConveraTxnRow {
  id: number;
  confirmation_number: string;
  date_of_order: string | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }

const CONVERA_BANK_PATTERN = 'western union holding';

function findConveraBank(accounts: AccountRow[]): AccountRow | null {
  const target = CONVERA_BANK_PATTERN.toLowerCase();
  return accounts.find(a => a.full_name.toLowerCase().includes(target)) ?? null;
}

export async function pushConveraCreateBillAndPay(
  supabase: SupabaseClient,
  eventIds: number[],
  opts: { auditTag?: string } = {},
): Promise<ConveraCreateBillAndPayResult> {
  const auditTag = opts.auditTag
    ?? `convera-create-and-pay-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: ConveraCreateBillAndPayResult['skippedIneligible'] = [];
  const emptyReturn = (): ConveraCreateBillAndPayResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible,
    billAddJobIds: [], chainedPayJobIds: [], verifyJobIdByPayJobId: {},
  });

  if (eventIds.length === 0) return emptyReturn();

  // ─── Fetch events + qualify ─────────────────────────────────────────────
  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, source, amount, counterparty_qb_vendor_list_id, status, target_qb_txn_kind, matched_invoice_ids, raw_data')
    .in('id', eventIds);
  const events = (eventData ?? []) as IngestEventRow[];

  const foundIds = new Set(events.map(e => e.id));
  for (const id of eventIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ eventId: id, reason: 'not found in qb_ingest_events' });
  }

  const eligible: IngestEventRow[] = [];
  for (const e of events) {
    if (e.source !== 'convera') { skippedIneligible.push({ eventId: e.id, reason: `source='${e.source}' — pushConveraCreateBillAndPay handles source='convera' only` }); continue; }
    if (e.status === 'posted') { skippedIneligible.push({ eventId: e.id, reason: `status='posted' — already pushed` }); continue; }
    if (e.status !== 'ready') { skippedIneligible.push({ eventId: e.id, reason: `status='${e.status}' — classifier must resolve to 'ready' before push` }); continue; }
    if (e.target_qb_txn_kind !== 'bill_pmt') { skippedIneligible.push({ eventId: e.id, reason: `target_qb_txn_kind='${e.target_qb_txn_kind ?? 'null'}' — C-2 handles bill_pmt only` }); continue; }
    if (!e.counterparty_qb_vendor_list_id) { skippedIneligible.push({ eventId: e.id, reason: 'counterparty_qb_vendor_list_id missing — rerun classifier' }); continue; }
    const matched = e.matched_invoice_ids ?? [];
    if (matched.length === 0) { skippedIneligible.push({ eventId: e.id, reason: 'matched_invoice_ids is empty — nothing to pay against' }); continue; }
    if (matched.length > 1) {
      // Multi-invoice case: could be same-vendor umbrella (rare — needs
      // multi-slot hydration) or multi-vendor umbrella (Bimosoft — needs
      // N BillPmts). Both punted to future slice.
      skippedIneligible.push({
        eventId: e.id,
        reason: `matched_invoice_ids has ${matched.length} entries — C-2 handles single-invoice events only. Multi-invoice chains (same-vendor umbrella needs multi-slot hydration; multi-vendor umbrella needs per-vendor sub-pushes) are Slice C-3.`,
      });
      continue;
    }
    if (e.raw_data?.convera_transaction_id == null) {
      skippedIneligible.push({ eventId: e.id, reason: 'raw_data.convera_transaction_id missing — shadow-write drift' });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // ─── Load invoices + partition by bill-exists ───────────────────────────
  const invoiceIds = Array.from(new Set(eligible.flatMap(e => e.matched_invoice_ids ?? [])));
  const converaTxnIds = Array.from(new Set(eligible.map(e => e.raw_data!.convera_transaction_id!)));
  const vendorIds = Array.from(new Set(eligible.map(e => e.counterparty_qb_vendor_list_id!)));

  const [invoicesRes, converaTxnsRes, vendorsRes, accountsRes] = await Promise.all([
    supabase.from('invoices').select('id, user_id, qb_bill_txn_id, total_amount, invoice_number').in('id', invoiceIds),
    supabase.from('convera_transactions').select('id, confirmation_number, date_of_order').in('id', converaTxnIds),
    supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds),
    supabase.from('qb_accounts').select('list_id, full_name').eq('account_type', 'Bank').eq('is_active', true),
  ]);

  const invoiceById = new Map(((invoicesRes.data ?? []) as InvoiceRow[]).map(i => [i.id, i]));
  const converaTxnById = new Map(((converaTxnsRes.data ?? []) as ConveraTxnRow[]).map(t => [t.id, t]));
  const vendorNameById = new Map(((vendorsRes.data ?? []) as VendorRow[]).map(v => [v.list_id, v.name]));
  const bank = findConveraBank((accountsRes.data ?? []) as AccountRow[]);

  // Filter: only events whose one matched invoice actually LACKS a QB Bill
  // (C-2 territory). Events whose bill already exists should go through
  // pushConveraBillPmt directly — the modal router routes on the split.
  const c2Eligible: Array<{ event: IngestEventRow; invoice: InvoiceRow; converaTxn: ConveraTxnRow; payeeVendorName: string }> = [];
  for (const e of eligible) {
    const invoiceId = (e.matched_invoice_ids ?? [])[0];
    const invoice = invoiceById.get(invoiceId);
    if (!invoice) { skippedIneligible.push({ eventId: e.id, reason: `matched invoice ${invoiceId} not found in invoices table` }); continue; }
    if (invoice.qb_bill_txn_id) {
      skippedIneligible.push({ eventId: e.id, reason: `invoice ${invoiceId} already has qb_bill_txn_id — route via pushConveraBillPmt (C-1) instead of C-2` });
      continue;
    }
    const converaTxn = converaTxnById.get(e.raw_data!.convera_transaction_id!);
    if (!converaTxn) { skippedIneligible.push({ eventId: e.id, reason: `convera_transactions row ${e.raw_data!.convera_transaction_id} not found` }); continue; }
    if (!converaTxn.date_of_order) { skippedIneligible.push({ eventId: e.id, reason: `convera_transactions.date_of_order missing for wire ${converaTxn.confirmation_number}` }); continue; }
    const payeeVendorName = vendorNameById.get(e.counterparty_qb_vendor_list_id!);
    if (!payeeVendorName) { skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for list_id='${e.counterparty_qb_vendor_list_id}'` }); continue; }
    if (!bank) { skippedIneligible.push({ eventId: e.id, reason: `bank account matching '${CONVERA_BANK_PATTERN}' not found in qb_accounts` }); continue; }
    c2Eligible.push({ event: e, invoice, converaTxn, payeeVendorName });
  }

  if (c2Eligible.length === 0) return emptyReturn();

  // ─── Enqueue bill_add via delegated consumer ────────────────────────────
  const missingInvoiceIds = c2Eligible.map(x => x.invoice.id);
  const createResult = await pushConveraInvoiceCreateBill(supabase, missingInvoiceIds, { auditTag });

  // Map invoice_id → bill_add job id via perIntent (single-invoice per intent
  // for our case since each event carries one invoice).
  const billAddJobIdByInvoiceId = new Map<number, number>();
  for (const p of createResult.perIntent) {
    if (p.jobId == null) continue;
    for (const invId of p.sourceInvoiceIds) {
      billAddJobIdByInvoiceId.set(invId, p.jobId);
    }
  }

  // Absorb create_bill's skips into ours so caller sees full picture.
  for (const s of createResult.skippedIneligible) {
    const event = c2Eligible.find(x => x.invoice.id === s.invoiceId)?.event;
    if (event) skippedIneligible.push({ eventId: event.id, reason: `bill_add skipped: ${s.reason}` });
  }
  for (const r of createResult.rejected) {
    // rejected intents by index — map to our event via invoice id (single-invoice per intent)
    const intent = r.intent as { sourceInvoiceIds?: number[] } | undefined;
    const invId = intent?.sourceInvoiceIds?.[0];
    const event = invId != null ? c2Eligible.find(x => x.invoice.id === invId)?.event : undefined;
    if (event) skippedIneligible.push({ eventId: event.id, reason: `bill_add rejected: ${r.invariant} — ${r.reason}` });
  }

  // ─── Chain bill_pmt_add per successful bill_add ─────────────────────────
  const billAddJobIds: number[] = [];
  const chainedPayJobIds: number[] = [];
  const verifyJobIdByPayJobId: Record<number, number> = {};

  interface PayRow {
    kind: 'bill_pmt_add';
    payload: Record<string, unknown>;
    status: 'pending';
    depends_on: number[];
  }
  interface VerifyRow {
    kind: 'bill_query';
    payload: Record<string, unknown>;
    status: 'pending';
    depends_on: number[];
  }

  const payRows: PayRow[] = [];
  const payMeta: Array<{ eventId: number; billAddJobId: number }> = [];

  for (const c2 of c2Eligible) {
    const billAddJobId = billAddJobIdByInvoiceId.get(c2.invoice.id);
    if (billAddJobId == null) continue;   // create_bill was skipped; reason already recorded
    billAddJobIds.push(billAddJobId);
    payRows.push({
      kind: 'bill_pmt_add',
      payload: {
        payeeVendorName: c2.payeeVendorName,
        bankAccountName: bank!.full_name,
        txnDate: c2.converaTxn.date_of_order!,
        refNumber: c2.converaTxn.confirmation_number,
        memo: `Convera wire ${c2.converaTxn.confirmation_number}`,
        applications: [{ billTxnId: null, paymentAmount: Number(c2.invoice.total_amount) }],  // hydrated on parent-drain
        sourceConveraTxnId: c2.converaTxn.id,
        __hydrate_bill_txn_id_from_dep: billAddJobId,
        __audit_tag: auditTag,
      },
      status: 'pending',
      depends_on: [billAddJobId],
    });
    payMeta.push({ eventId: c2.event.id, billAddJobId });
  }

  if (payRows.length === 0) {
    return {
      jobIds: [...createResult.jobIds],
      rejected: [...createResult.rejected],
      skippedDuplicate: [...createResult.skippedDuplicate],
      skippedIneligible,
      billAddJobIds,
      chainedPayJobIds: [],
      verifyJobIdByPayJobId: {},
    };
  }

  const { data: insertedPay, error: payErr } = await supabase
    .from('qb_sync_jobs')
    .insert(payRows)
    .select('id');
  if (payErr) {
    // bill_adds already enqueued — surface but don't abort. Accountant can
    // manually push pay later once bills drain.
    for (const meta of payMeta) {
      skippedIneligible.push({ eventId: meta.eventId, reason: `chained pay_bill insert failed after bill_add ${meta.billAddJobId} enqueued: ${payErr.message}. Push manually after bill drains.` });
    }
    return {
      jobIds: [...createResult.jobIds],
      rejected: [...createResult.rejected],
      skippedDuplicate: [...createResult.skippedDuplicate],
      skippedIneligible,
      billAddJobIds,
      chainedPayJobIds: [],
      verifyJobIdByPayJobId: {},
    };
  }

  const verifyRows: VerifyRow[] = [];
  const verifyMeta: Array<{ payJobId: number }> = [];

  (insertedPay as Array<{ id: number }>).forEach((row, idx) => {
    const meta = payMeta[idx];
    chainedPayJobIds.push(row.id);
    verifyRows.push({
      kind: 'bill_query',
      payload: {
        txnIds: [null],   // hydrated on parent bill_add drain (piggybacks on same marker)
        __hydrate_bill_txn_id_from_dep: meta.billAddJobId,
        __audit_tag: `${auditTag}-verify`,
        __verify_for_event_id: meta.eventId,
      },
      status: 'pending',
      depends_on: [row.id],
    });
    verifyMeta.push({ payJobId: row.id });
  });

  if (verifyRows.length > 0) {
    const { data: insertedVerify, error: verifyErr } = await supabase
      .from('qb_sync_jobs')
      .insert(verifyRows)
      .select('id');
    if (!verifyErr && insertedVerify) {
      (insertedVerify as Array<{ id: number }>).forEach((row, idx) => {
        verifyJobIdByPayJobId[verifyMeta[idx].payJobId] = row.id;
      });
    }
    // Silent-fail: pay chain is enqueued; missing verify just means the
    // status pane can't auto-confirm. Push correctness unaffected.
  }

  return {
    jobIds: [...createResult.jobIds, ...chainedPayJobIds],
    rejected: [...createResult.rejected],
    skippedDuplicate: [...createResult.skippedDuplicate],
    skippedIneligible,
    billAddJobIds,
    chainedPayJobIds,
    verifyJobIdByPayJobId,
  };
}
