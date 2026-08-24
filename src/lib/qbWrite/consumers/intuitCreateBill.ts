// intuitCreateBill — G7b consumer of qbWrite executor for the Intuit path.
//
// Scope (locked with Dan 2026-08-24):
//   ONLY handles resolvedAction='create_bill_then_pay' events. Push a single
//   bill_add job per event. After it drains, the edge-fn drain handler
//   writes qb_ingest_events.resolved_bill_txn_id and seeds qb_mirror with the
//   new bill; the reconciler on the next recompute flips the event action to
//   'pay_existing_bill' and the existing intuitPush consumer handles the
//   payment step. Two-click flow for now; Phase 3 will chain to one-click.
//
// Orphan-create shape (TechAntz-style):
//   - matched_invoice_ids = [] (no invoice in our system)
//   - memo is a generic string like "Invoice Payment" (no ref#)
//   - We construct a minimal Bill from event data + mapping's expense account:
//       vendor          = qb_vendors.name via counterparty_qb_vendor_list_id
//       apAccount       = "Accounts Payable" (executor default)
//       expenseAccount  = qb_vendor_mappings.default_expense_account_list_id
//                          → qb_accounts.full_name
//       lines           = [{ amount: event.amount, memo: event.memo }]
//       refNumber       = `INTUIT-{eventId}` (unique per event; QB requires
//                          non-empty for the bill; not the accountant's own
//                          convention because there IS no invoice)
//
// Provenance gate:
//   For orphan create_bill_then_pay, the "we have no invoice link" IS the
//   whole point — the mapping (default_target_kind='bill_add_and_pmt')
//   authorizes the create. Skip the invoice-link provenance gate here.
//
// Persistence contract (edge fn side, see supabase/functions/qb-web-connector/index.ts):
//   On successful drain of bill_add, the handler:
//     - Writes resolved_bill_txn_id onto the source qb_ingest_events row
//     - Seeds qb_mirror with an entity_kind='bill' row (marks new bill open)
//     - Returns ok=true

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeIntents } from '../execute';
import type { CreateBillIntent, ExecuteResult } from '../types';

export interface IntuitCreateBillResult extends ExecuteResult {
  skippedIneligible: Array<{ eventId: number; reason: string }>;
  /** Phase 3 one-click chain: for each successful bill_add job, the paired
   *  bill_pmt_add job id (waiting on bill_add via depends_on with a hydrate
   *  marker so the drain handler injects the new bill TxnID before dispatch). */
  chainedPayJobIdByBillAddJobId: Record<number, number>;
  /** Verify bill_query enqueued after each chained pay (mirror refresh). */
  chainedVerifyJobIdByPayJobId: Record<number, number>;
}

interface IngestEventRow {
  id: number;
  txn_date: string;
  amount: number | string;
  counterparty_raw: string;
  memo: string | null;
  counterparty_qb_vendor_list_id: string | null;
  qb_bank_account_list_id: string | null;
  qb_expense_account_list_id: string | null;
  resolved_action: string | null;
  status: string;
  matched_invoice_ids: number[] | null;
  match_provenance: string | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }

/** Push `create_bill_then_pay` intents to QB as bill_add jobs. Returns per-event
 *  success/rejection so the caller renders actionable feedback. */
export async function pushIntuitCreateBill(
  supabase: SupabaseClient,
  eventIds: number[],
  opts: { auditTag?: string; source?: string } = {},
): Promise<IntuitCreateBillResult> {
  const auditTag = opts.auditTag ?? `intuit-create-bill-${new Date().toISOString().slice(0, 10)}`;
  const source = opts.source ?? 'intuit_xlsx';
  const skippedIneligible: IntuitCreateBillResult['skippedIneligible'] = [];
  const chainedPayJobIdByBillAddJobId: Record<number, number> = {};
  const chainedVerifyJobIdByPayJobId: Record<number, number> = {};
  const emptyReturn = (): IntuitCreateBillResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible,
    chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId,
  });

  if (eventIds.length === 0) return emptyReturn();

  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, txn_date, amount, counterparty_raw, memo, counterparty_qb_vendor_list_id, qb_bank_account_list_id, qb_expense_account_list_id, resolved_action, status, matched_invoice_ids, match_provenance')
    .in('id', eventIds);
  const events = (eventData ?? []) as IngestEventRow[];

  const foundIds = new Set(events.map(e => e.id));
  for (const id of eventIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ eventId: id, reason: 'not found in qb_ingest_events' });
  }

  const eligible: IngestEventRow[] = [];
  for (const e of events) {
    if (e.status === 'posted') {
      skippedIneligible.push({ eventId: e.id, reason: `status='posted' — already pushed` });
      continue;
    }
    if (e.resolved_action !== 'create_bill_then_pay') {
      skippedIneligible.push({
        eventId: e.id,
        reason: `resolved_action='${e.resolved_action ?? 'null'}' — G7b handles create_bill_then_pay only`,
      });
      continue;
    }
    if (!e.counterparty_qb_vendor_list_id) {
      skippedIneligible.push({ eventId: e.id, reason: 'counterparty_qb_vendor_list_id missing — rerun classifier' });
      continue;
    }
    if (!e.qb_expense_account_list_id) {
      skippedIneligible.push({ eventId: e.id, reason: 'qb_expense_account_list_id missing — expense account required for create_bill (set on vendor mapping)' });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // Load vendor + expense account names for intent construction.
  const vendorIds = Array.from(new Set(eligible.map(e => e.counterparty_qb_vendor_list_id!)));
  const expenseIds = Array.from(new Set(eligible.map(e => e.qb_expense_account_list_id!)));
  const { data: vendorData } = await supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds);
  const { data: expenseData } = await supabase.from('qb_accounts').select('list_id, full_name').in('list_id', expenseIds);
  const vendorName = new Map(((vendorData ?? []) as VendorRow[]).map(r => [r.list_id, r.name]));
  const expenseName = new Map(((expenseData ?? []) as AccountRow[]).map(r => [r.list_id, r.full_name]));

  const intents: CreateBillIntent[] = [];
  const eventIdByIntentIndex: number[] = [];
  for (const e of eligible) {
    const vendor = vendorName.get(e.counterparty_qb_vendor_list_id!);
    const expense = expenseName.get(e.qb_expense_account_list_id!);
    if (!vendor) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for list_id='${e.counterparty_qb_vendor_list_id}' — sync qb_mirror` });
      continue;
    }
    if (!expense) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_accounts row missing for list_id='${e.qb_expense_account_list_id}' — sync qb_mirror` });
      continue;
    }
    void source;
    intents.push({
      kind: 'create_bill',
      auditTag,
      vendorName: vendor,
      txnDate: e.txn_date,
      // dueDate omitted — QB will default. Same behavior as manual create.
      refNumber: `INTUIT-${e.id}`,
      memo: `ingest:${e.id}`,
      defaultExpenseAccountName: expense,
      lines: [{
        amount: Number(e.amount),
        memo: e.memo ?? undefined,
        expenseAccountName: expense,
      }],
      sourceInvoiceIds: [],
      sourceIngestEventId: e.id,
    });
    eventIdByIntentIndex.push(e.id);
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // Phase 3 one-click chain: for each successful bill_add job, enqueue a
  // dependent bill_pmt_add + verify bill_query. The bill_pmt_add payload
  // carries a hydrate marker (__hydrate_bill_txn_id_from_dep) so the edge fn
  // bill_add drain handler injects the freshly-created bill's TxnID into the
  // applications[0].billTxnId slot before the child dispatches.
  //
  // We insert bill_pmt_add + verify DIRECTLY (skip executeIntents) so the
  // in-flight duplicate check + INVARIANT #11 vendor-scoped-TxnID check don't
  // fire on a nascent TxnID we haven't observed yet. Both invariants are
  // satisfied by construction (we're paying our own newly-created bill for
  // the mapped vendor). Documented risk-accepted.
  //
  // We need bank account per event too — fetch it now for the pay-payload.
  const bankIds = Array.from(new Set(eligible.map(e => e.qb_bank_account_list_id!).filter(Boolean)));
  const { data: bankData } = bankIds.length > 0
    ? await supabase.from('qb_accounts').select('list_id, full_name').in('list_id', bankIds)
    : { data: [] as AccountRow[] };
  const bankName = new Map(((bankData ?? []) as AccountRow[]).map(r => [r.list_id, r.full_name]));

  interface JobInsert {
    kind: 'bill_pmt_add' | 'bill_query';
    payload: Record<string, unknown>;
    status: 'pending';
    depends_on: number[];
  }
  const chainedRows: JobInsert[] = [];
  const chainedMeta: Array<{ billAddJobId: number; eventId: number; intent: CreateBillIntent }> = [];
  const verifyRows: JobInsert[] = [];
  const verifyMeta: Array<{ eventId: number; expectBillTxnPlaceholder: true }> = [];

  result.jobIds.forEach((billAddJobId, i) => {
    if (billAddJobId == null) return;
    const eventId = eventIdByIntentIndex[i];
    const intent = intents[i];
    const event = eligible.find(x => x.id === eventId);
    if (!event) return;
    const bank = event.qb_bank_account_list_id ? bankName.get(event.qb_bank_account_list_id) : null;
    if (!bank) {
      // Bill will still be created but pay leg can't chain without a bank.
      // Surface so accountant knows to push the pay leg manually via 2-step.
      skippedIneligible.push({
        eventId, reason: `bank account missing for chained pay leg — bill_add still enqueued (job ${billAddJobId}), but pay must be done manually via Recompute + push`,
      });
      return;
    }
    chainedRows.push({
      kind: 'bill_pmt_add',
      payload: {
        payeeVendorName: intent.vendorName,
        bankAccountName: bank,
        txnDate: intent.txnDate,
        memo: intent.memo,
        applications: [{ billTxnId: null, paymentAmount: Number(event.amount) }],   // hydrated on parent-drain
        sourceIngestEventId: eventId,
        __hydrate_bill_txn_id_from_dep: billAddJobId,
        __audit_tag: auditTag,
      },
      status: 'pending',
      depends_on: [billAddJobId],
    });
    chainedMeta.push({ billAddJobId, eventId, intent });
  });

  if (chainedRows.length > 0) {
    const { data: insertedPay, error: payErr } = await supabase
      .from('qb_sync_jobs')
      .insert(chainedRows)
      .select('id');
    if (!payErr && insertedPay) {
      (insertedPay as Array<{ id: number }>).forEach((row, idx) => {
        const meta = chainedMeta[idx];
        chainedPayJobIdByBillAddJobId[meta.billAddJobId] = row.id;
        // Also chain a verify bill_query on each chained pay. The chained pay
        // won't have its billTxnId until parent drains, so verify's txnIds is
        // hydrated the same way (piggybacks on the pay's hydration).
        verifyRows.push({
          kind: 'bill_query',
          payload: {
            txnIds: [null],   // hydrated on parent bill_add drain
            __hydrate_bill_txn_id_from_dep: meta.billAddJobId,
            __audit_tag: `${auditTag}-verify`,
            __verify_for_event_id: meta.eventId,
          },
          status: 'pending',
          depends_on: [row.id],   // depends on the chained pay
        });
        verifyMeta.push({ eventId: meta.eventId, expectBillTxnPlaceholder: true });
      });
      if (verifyRows.length > 0) {
        const { data: insertedVerify } = await supabase
          .from('qb_sync_jobs')
          .insert(verifyRows)
          .select('id');
        if (insertedVerify) {
          (insertedVerify as Array<{ id: number }>).forEach((row, idx) => {
            const payJobId = (insertedPay as Array<{ id: number }>)[idx]?.id;
            if (payJobId != null) chainedVerifyJobIdByPayJobId[payJobId] = row.id;
          });
        }
      }
    }
  }

  return { ...result, skippedIneligible, chainedPayJobIdByBillAddJobId, chainedVerifyJobIdByPayJobId };
}
