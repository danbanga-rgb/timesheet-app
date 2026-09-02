// converaCreateBillFromEvent — Slice C-4 consumer for orphan Convera wires.
//
// Handles Convera wires with NO invoice in our system. Covers both:
//   Case C — Bhavani/Arpit/Himavath: contractors we don't invoice through
//            our system. No QB bill exists → create + pay.
//   Case D — Monolith and other non-timesheet vendors: the accountant
//            entered the bill directly in QB → pay the existing bill.
//
// Simple 3-gate model (Dan 2026-09-02): the consumer doesn't care which
// case the accountant tagged in the widget. It checks reality:
//   Gate 1 (vendor mapped): event.counterparty_qb_vendor_list_id set?
//                            → set via classifier or Move-from-Ignore.
//   Gate 2 (bill exists?):  query qb_mirror for open bills for the vendor.
//                            → exactly-one (or amount-unique among many) → Case D pay
//                            → none                                       → Case C create+pay
//                            → many with no amount match                  → skip (accountant disambiguates)
//   Gate 3 (paid):          emit pay_bill (Case D) or create_bill+chained pay (Case C).
//
// The target_qb_txn_kind on the event is advisory — it seeds the classifier
// mapping so future wires from the same beneficiary auto-classify to the
// accountant's preferred flavor. But the consumer's real decision is
// qb_mirror-driven, so misroutes self-correct if the accountant picks the
// wrong kind at Move-from-Ignore time.
//
// Bank: Western Union Holding (Convera-side).
// RefNumber (pay): confirmation_number (fits INVARIANTS #5).
// RefNumber (create bill): CONV-<eventId>.
//
// Persistence:
//   Case C: sourceIngestEventId on create_bill intent → QBWC edge fn's
//           orphan-create path writes resolved_bill_txn_id + seeds qb_mirror.
//   Case D: sourceConveraTxnId on pay_bill intent → convera_transaction_billpmts
//           idempotency + persistence.

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeIntents } from '../execute';
import type { CreateBillIntent, ExecuteResult, PayBillIntent } from '../types';

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
interface MirrorBillRow { entity_ref: string; vendor_list_id: string; amount: number | string | null; is_settled: boolean | null }

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
    if (e.target_qb_txn_kind !== 'bill_add_and_pmt' && e.target_qb_txn_kind !== 'bill_pmt') { skippedIneligible.push({ eventId: e.id, reason: `target_qb_txn_kind='${e.target_qb_txn_kind ?? 'null'}' — this consumer handles bill_add_and_pmt (Case C) or bill_pmt (Case D) only` }); continue; }
    if (!e.counterparty_qb_vendor_list_id) { skippedIneligible.push({ eventId: e.id, reason: 'counterparty_qb_vendor_list_id missing — set QB vendor via mapping or Move-from-Ignore' }); continue; }
    // Expense account only enforced for Case C (create_bill). If qb_mirror shows
    // an existing open bill for the vendor, the consumer will pay it instead —
    // no expense account needed for pay. Deferred check happens after Gate 2.
    if ((e.matched_invoice_ids ?? []).length > 0) { skippedIneligible.push({ eventId: e.id, reason: `matched_invoice_ids populated — event has an invoice, route via pushConveraCreateBillAndPay instead` }); continue; }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // ─── Load vendor + expense + bank names + qb_mirror open bills ─────────
  const vendorIds = Array.from(new Set(eligible.map(e => e.counterparty_qb_vendor_list_id!)));
  const expenseIds = Array.from(new Set(eligible.map(e => e.qb_expense_account_list_id).filter((x): x is string => !!x)));
  const [vendorRes, expenseRes, bankRes, mirrorRes] = await Promise.all([
    supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds),
    expenseIds.length > 0
      ? supabase.from('qb_accounts').select('list_id, full_name').in('list_id', expenseIds)
      : Promise.resolve({ data: [] as AccountRow[] }),
    supabase.from('qb_accounts').select('list_id, full_name').eq('account_type', 'Bank').eq('is_active', true),
    supabase.from('qb_mirror').select('entity_ref, vendor_list_id, amount, is_settled').eq('entity_kind', 'bill').in('vendor_list_id', vendorIds).eq('is_settled', false),
  ]);
  const vendorName = new Map(((vendorRes.data ?? []) as VendorRow[]).map(r => [r.list_id, r.name]));
  const expenseName = new Map(((expenseRes.data ?? []) as AccountRow[]).map(r => [r.list_id, r.full_name]));
  const bank = findConveraBank((bankRes.data ?? []) as AccountRow[]);

  const openBillsByVendor = new Map<string, MirrorBillRow[]>();
  for (const row of ((mirrorRes.data ?? []) as MirrorBillRow[])) {
    const arr = openBillsByVendor.get(row.vendor_list_id) ?? [];
    arr.push(row);
    openBillsByVendor.set(row.vendor_list_id, arr);
  }

  // ─── Gate 2 (bill exists?) → route each event to Case C or Case D ──────
  const createIntents: CreateBillIntent[] = [];
  const createEventIds: number[] = [];
  const payDIntents: PayBillIntent[] = [];
  const payDEventIds: number[] = [];
  const eventById = new Map(eligible.map(e => [e.id, e]));

  for (const e of eligible) {
    const vendor = vendorName.get(e.counterparty_qb_vendor_list_id!);
    if (!vendor) { skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for list_id='${e.counterparty_qb_vendor_list_id}' — sync qb_vendors` }); continue; }
    if (!bank) { skippedIneligible.push({ eventId: e.id, reason: `bank account matching '${CONVERA_BANK_PATTERN}' not found in qb_accounts` }); continue; }

    const eventAmount = Number(e.amount);
    const openBills = openBillsByVendor.get(e.counterparty_qb_vendor_list_id!) ?? [];

    // Case D: existing bill found → pay it. If multiple, filter by amount.
    let existingBill: MirrorBillRow | null = null;
    if (openBills.length === 1) {
      existingBill = openBills[0];
    } else if (openBills.length > 1) {
      const amountMatches = openBills.filter(b => Math.abs(Number(b.amount ?? 0) - eventAmount) < 0.01);
      if (amountMatches.length === 1) existingBill = amountMatches[0];
      else if (amountMatches.length === 0) {
        skippedIneligible.push({ eventId: e.id, reason: `${openBills.length} open bills for vendor '${vendor}' in QB, none amount-matches wire ($${eventAmount.toFixed(2)}). Close extras in QB, or reclassify to Create Bill + Pay.` });
        continue;
      } else {
        skippedIneligible.push({ eventId: e.id, reason: `${openBills.length} open bills for vendor '${vendor}' in QB, ${amountMatches.length} match wire amount ($${eventAmount.toFixed(2)}). Manual disambiguation needed in QB.` });
        continue;
      }
    }

    if (existingBill) {
      // Case D — direct pay against known TxnID.
      payDIntents.push({
        kind: 'pay_bill',
        auditTag,
        payeeVendorName: vendor,
        bankAccountName: bank.full_name,
        txnDate: e.txn_date,
        refNumber: e.raw_data?.confirmation_number ?? `CONV-${e.id}`,
        memo: `Convera wire ${e.raw_data?.confirmation_number ?? `event ${e.id}`}`,
        applications: [{ billTxnId: existingBill.entity_ref, paymentAmount: eventAmount }],
        // Case D always has a Convera txn backing it (orphan events are
        // still Convera-sourced). sourceConveraTxnId → convera_transaction_billpmts.
        sourceConveraTxnId: e.raw_data?.convera_transaction_id ?? undefined,
        // If no convera_transaction_id (shouldn't happen for source='convera' but
        // guard anyway), fall back to sourceIngestEventId to satisfy INVARIANTS #14.
        sourceIngestEventId: e.raw_data?.convera_transaction_id != null ? undefined : e.id,
      });
      payDEventIds.push(e.id);
      continue;
    }

    // Case C — no open bill in QB. Create + chained pay. Requires expense account.
    const expense = expenseName.get(e.qb_expense_account_list_id ?? '');
    if (!e.qb_expense_account_list_id) {
      skippedIneligible.push({ eventId: e.id, reason: `no open bill in QB for vendor '${vendor}' — Case C create+pay path needs qb_expense_account_list_id (set via mapping or Move-from-Ignore)` });
      continue;
    }
    if (!expense) { skippedIneligible.push({ eventId: e.id, reason: `qb_accounts row missing for list_id='${e.qb_expense_account_list_id}' — sync qb_accounts` }); continue; }

    createIntents.push({
      kind: 'create_bill',
      auditTag,
      vendorName: vendor,
      txnDate: e.txn_date,
      refNumber: `CONV-${e.id}`,
      memo: `Convera wire ${e.raw_data?.confirmation_number ?? `event ${e.id}`}`,
      defaultExpenseAccountName: expense,
      lines: [{ amount: eventAmount, memo: e.memo ?? undefined, expenseAccountName: expense }],
      sourceInvoiceIds: [],
      sourceIngestEventId: e.id,
    });
    createEventIds.push(e.id);
  }

  // ─── Case D pay_bill (direct, no chain) ─────────────────────────────────
  if (payDIntents.length > 0) {
    const dResult = await executeIntents(supabase, payDIntents);
    dResult.jobIds.forEach((jobId, idx) => {
      if (jobId != null) {
        // Report on Case D pays in the chainedPayJobIdByBillAddJobId map keyed by
        // -eventId (negative to avoid collision with real bill_add job ids).
        // Callers that care about the actual TxnID should read the qb_sync_jobs
        // row directly.
        chainedPayJobIdByBillAddJobId[-payDEventIds[idx]] = jobId;
      }
    });
    for (const rej of dResult.rejected) {
      const evId = payDEventIds[rej.index] ?? -1;
      skippedIneligible.push({ eventId: evId, reason: `Case D pay_bill rejected: ${rej.invariant} — ${rej.reason}` });
    }
    for (const dup of dResult.skippedDuplicate) {
      const evId = payDEventIds[dup.index] ?? -1;
      skippedIneligible.push({ eventId: evId, reason: `Case D pay_bill duplicate: ${dup.reason}` });
    }
  }

  // ─── Case C: rename local vars back for the existing chain flow ─────────
  const intents = createIntents;
  const eventIdByIntentIndex = createEventIds;

  if (intents.length === 0) {
    // Case D may have enqueued pays. Return with those tracked.
    return {
      jobIds: Object.values(chainedPayJobIdByBillAddJobId).filter((x): x is number => x != null),
      rejected: [], skippedDuplicate: [], skippedIneligible,
      chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId,
    };
  }

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
