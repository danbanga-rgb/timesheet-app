// converaCreateBillFromEvent — Slice C-4 consumer.
//
// Handles Convera wires with NO invoice in our system — Case C from
// [[intuit-qb-layer-spec]]: contractors like Bhavani/Arpit/Himavath whose
// timesheets we track but who don't submit invoices via our pipeline (or
// non-timesheet vendors that fold into this shape via Move-from-Ignore).
//
// Flow (mirrors intuitCreateBill.ts but Convera bank + RefNumber):
//   1. Create Bill in QB with a synthesized RefNumber (CONV-<eventId>) —
//      no invoice_number to source. amount + expense account come from
//      the event (accountant sets via mapping or Move-from-Ignore modal).
//   2. Chain bill_pmt_add via depends_on + __hydrate_bill_txn_id_from_dep
//      so the freshly-created bill's TxnID drops into applications[0] on
//      parent drain. Same pattern as intuitCreateBill.ts.
//   3. Chain verify bill_query on the pay job for mirror refresh.
//
// Bank: Western Union Holding (Convera-side) — looked up fresh, overrides
// any Intuit-side default from the classifier.
//
// Filter: source='convera', status='ready', target_qb_txn_kind='bill_add_and_pmt',
// matched_invoice_ids EMPTY. Non-empty matched_invoice_ids means it's a
// pay-existing-invoice case that pushConveraCreateBillAndPay handles.
//
// Persistence: sourceIngestEventId set on the create_bill intent so the
// QBWC edge fn's orphan-create path writes resolved_bill_txn_id back onto
// the event row and seeds qb_mirror (see qb-web-connector/index.ts:395).

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeIntents } from '../execute';
import type { CreateBillIntent, ExecuteResult } from '../types';

export interface ConveraCreateBillFromEventResult extends ExecuteResult {
  skippedIneligible: Array<{ eventId: number; reason: string }>;
  chainedPayJobIdByBillAddJobId: Record<number, number>;
  chainedVerifyJobIdByPayJobId: Record<number, number>;
}

interface IngestEventRow {
  id: number;
  source: string;
  txn_date: string;
  amount: number | string;
  counterparty_raw: string;
  memo: string | null;
  counterparty_qb_vendor_list_id: string | null;
  qb_bank_account_list_id: string | null;
  qb_expense_account_list_id: string | null;
  target_qb_txn_kind: string | null;
  status: string;
  matched_invoice_ids: number[] | null;
  raw_data: { convera_transaction_id?: number; confirmation_number?: string } | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }

const CONVERA_BANK_PATTERN = 'western union holding';

function findConveraBank(accounts: AccountRow[]): AccountRow | null {
  const target = CONVERA_BANK_PATTERN.toLowerCase();
  return accounts.find(a => a.full_name.toLowerCase().includes(target)) ?? null;
}

export async function pushConveraCreateBillFromEvent(
  supabase: SupabaseClient,
  eventIds: number[],
  opts: { auditTag?: string } = {},
): Promise<ConveraCreateBillFromEventResult> {
  const auditTag = opts.auditTag ?? `convera-create-from-event-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: ConveraCreateBillFromEventResult['skippedIneligible'] = [];
  const chainedPayJobIdByBillAddJobId: Record<number, number> = {};
  const chainedVerifyJobIdByPayJobId: Record<number, number> = {};
  const emptyReturn = (): ConveraCreateBillFromEventResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible,
    chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId,
  });

  if (eventIds.length === 0) return emptyReturn();

  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, source, txn_date, amount, counterparty_raw, memo, counterparty_qb_vendor_list_id, qb_bank_account_list_id, qb_expense_account_list_id, target_qb_txn_kind, status, matched_invoice_ids, raw_data')
    .in('id', eventIds);
  const events = (eventData ?? []) as IngestEventRow[];

  const foundIds = new Set(events.map(e => e.id));
  for (const id of eventIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ eventId: id, reason: 'not found in qb_ingest_events' });
  }

  const eligible: IngestEventRow[] = [];
  for (const e of events) {
    if (e.source !== 'convera') { skippedIneligible.push({ eventId: e.id, reason: `source='${e.source}' — pushConveraCreateBillFromEvent handles source='convera' only` }); continue; }
    if (e.status === 'posted') { skippedIneligible.push({ eventId: e.id, reason: `status='posted' — already pushed` }); continue; }
    if (e.status !== 'ready') { skippedIneligible.push({ eventId: e.id, reason: `status='${e.status}' — classifier must resolve to 'ready' before push` }); continue; }
    if (e.target_qb_txn_kind !== 'bill_add_and_pmt') { skippedIneligible.push({ eventId: e.id, reason: `target_qb_txn_kind='${e.target_qb_txn_kind ?? 'null'}' — this consumer handles bill_add_and_pmt only` }); continue; }
    if (!e.counterparty_qb_vendor_list_id) { skippedIneligible.push({ eventId: e.id, reason: 'counterparty_qb_vendor_list_id missing — set QB vendor via mapping or Move-from-Ignore' }); continue; }
    if (!e.qb_expense_account_list_id) { skippedIneligible.push({ eventId: e.id, reason: 'qb_expense_account_list_id missing — expense account required for create_bill (set via mapping)' }); continue; }
    if ((e.matched_invoice_ids ?? []).length > 0) { skippedIneligible.push({ eventId: e.id, reason: `matched_invoice_ids populated — event has an invoice, route via pushConveraCreateBillAndPay instead` }); continue; }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // ─── Load vendor + expense + bank names ─────────────────────────────────
  const vendorIds = Array.from(new Set(eligible.map(e => e.counterparty_qb_vendor_list_id!)));
  const expenseIds = Array.from(new Set(eligible.map(e => e.qb_expense_account_list_id!)));
  const [vendorRes, expenseRes, bankRes] = await Promise.all([
    supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds),
    supabase.from('qb_accounts').select('list_id, full_name').in('list_id', expenseIds),
    supabase.from('qb_accounts').select('list_id, full_name').eq('account_type', 'Bank').eq('is_active', true),
  ]);
  const vendorName = new Map(((vendorRes.data ?? []) as VendorRow[]).map(r => [r.list_id, r.name]));
  const expenseName = new Map(((expenseRes.data ?? []) as AccountRow[]).map(r => [r.list_id, r.full_name]));
  const bank = findConveraBank((bankRes.data ?? []) as AccountRow[]);

  // ─── Build create_bill intents ──────────────────────────────────────────
  const intents: CreateBillIntent[] = [];
  const eventIdByIntentIndex: number[] = [];
  const eventById = new Map(eligible.map(e => [e.id, e]));
  for (const e of eligible) {
    const vendor = vendorName.get(e.counterparty_qb_vendor_list_id!);
    const expense = expenseName.get(e.qb_expense_account_list_id!);
    if (!vendor) { skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for list_id='${e.counterparty_qb_vendor_list_id}' — sync qb_vendors` }); continue; }
    if (!expense) { skippedIneligible.push({ eventId: e.id, reason: `qb_accounts row missing for list_id='${e.qb_expense_account_list_id}' — sync qb_accounts` }); continue; }
    if (!bank) { skippedIneligible.push({ eventId: e.id, reason: `bank account matching '${CONVERA_BANK_PATTERN}' not found in qb_accounts` }); continue; }
    intents.push({
      kind: 'create_bill',
      auditTag,
      vendorName: vendor,
      txnDate: e.txn_date,
      refNumber: `CONV-${e.id}`,
      memo: `Convera wire ${e.raw_data?.confirmation_number ?? `event ${e.id}`}`,
      defaultExpenseAccountName: expense,
      lines: [{ amount: Number(e.amount), memo: e.memo ?? undefined, expenseAccountName: expense }],
      sourceInvoiceIds: [],
      sourceIngestEventId: e.id,
    });
    eventIdByIntentIndex.push(e.id);
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // ─── Chain bill_pmt_add + verify per successful bill_add ────────────────
  interface JobInsert {
    kind: 'bill_pmt_add' | 'bill_query';
    payload: Record<string, unknown>;
    status: 'pending';
    depends_on: number[];
  }
  const chainedRows: JobInsert[] = [];
  const chainedMeta: Array<{ billAddJobId: number; eventId: number; amount: number }> = [];

  result.jobIds.forEach((billAddJobId, i) => {
    if (billAddJobId == null) return;
    const eventId = eventIdByIntentIndex[i];
    const event = eventById.get(eventId);
    if (!event) return;
    if (!bank) return;
    chainedRows.push({
      kind: 'bill_pmt_add',
      payload: {
        payeeVendorName: vendorName.get(event.counterparty_qb_vendor_list_id!)!,
        bankAccountName: bank.full_name,
        txnDate: event.txn_date,
        refNumber: event.raw_data?.confirmation_number ?? `CONV-${event.id}`,
        memo: `Convera wire ${event.raw_data?.confirmation_number ?? `event ${event.id}`}`,
        applications: [{ billTxnId: null, paymentAmount: Number(event.amount) }],   // hydrated on parent drain
        sourceIngestEventId: eventId,
        __hydrate_bill_txn_id_from_dep: billAddJobId,
        __audit_tag: auditTag,
      },
      status: 'pending',
      depends_on: [billAddJobId],
    });
    chainedMeta.push({ billAddJobId, eventId, amount: Number(event.amount) });
  });

  if (chainedRows.length === 0) {
    return { ...result, skippedIneligible, chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId };
  }

  const { data: insertedPay, error: payErr } = await supabase
    .from('qb_sync_jobs')
    .insert(chainedRows)
    .select('id');
  if (payErr || !insertedPay) {
    for (const meta of chainedMeta) {
      skippedIneligible.push({ eventId: meta.eventId, reason: `chained pay_bill insert failed: ${payErr?.message ?? 'unknown'}. Bill_add already enqueued (job ${meta.billAddJobId}); push pay manually after drain.` });
    }
    return { ...result, skippedIneligible, chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId };
  }

  // ─── Chain verify bill_query per chained pay ────────────────────────────
  const verifyRows: JobInsert[] = [];
  const verifyMeta: Array<{ payJobId: number }> = [];

  (insertedPay as Array<{ id: number }>).forEach((row, idx) => {
    const meta = chainedMeta[idx];
    chainedPayJobIdByBillAddJobId[meta.billAddJobId] = row.id;
    verifyRows.push({
      kind: 'bill_query',
      payload: {
        txnIds: [null],
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
        chainedVerifyJobIdByPayJobId[verifyMeta[idx].payJobId] = row.id;
      });
    }
    // Silent-fail: pay chain enqueued; missing verify only affects auto-confirm.
  }

  return { ...result, skippedIneligible, chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId };
}
