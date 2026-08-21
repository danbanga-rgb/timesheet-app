// intuitPush — G7a consumer of qbWrite executor for the Intuit path.
//
// Scope (locked with Dan 2026-08-21):
//   ONLY handles resolvedAction='pay_existing_bill' events. Other reconciler
//   outputs (create_bill_then_pay, check) are deliberately out-of-scope for
//   this slice — they land in G7b / G7.5 with dependent-job machinery and
//   proactive-create paths.
//
// Per-invariant handling (see src/lib/qbWrite/INVARIANTS.md):
//   #11 — Vendor-scoped TxnID: executor cross-checks qb_mirror. Consumer
//         just supplies (payeeVendorName, billTxnId); mismatch surfaces as
//         a rejection with a clear reason.
//   #14 — Payload contract: validatePayload enforced inside executor.
//   #18/#19 — Idempotency: executor rejects re-push (status='posted') and
//         in-flight duplicate jobs.
//   #22 — Live payment_profiles fallback: N/A here. By the time an event
//         has resolvedAction='pay_existing_bill', the classifier already
//         populated counterparty_qb_vendor_list_id — vendor name comes from
//         qb_vendors table via that list_id, not from an invoice snapshot.
//   #27 — State vs fresh fetch: consumer reads events + qb_vendors + qb_accounts
//         freshly, never from React state.
//
// RefNumber decision for the Intuit path (see [[intuit-push-context]]):
//   Accountant's historic convention is BLANK RefNumber on Intuit payments.
//   We preserve that — job-payloads makes refNumber optional when
//   sourceIngestEventId is set. Traceability lives in memo=`ingest:{id}`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeIntents } from '../execute';
import type { ExecuteResult, PayBillIntent } from '../types';

export interface IntuitPushResult extends ExecuteResult {
  /** Events skipped up-front — never reached the executor. Distinct from
   *  `rejected` (validated but rejected) and `skippedDuplicate` (idempotency). */
  skippedIneligible: Array<{ eventId: number; reason: string }>;
}

interface IngestEventRow {
  id: number;
  txn_date: string;
  amount: number | string;
  counterparty_qb_vendor_list_id: string | null;
  qb_bank_account_list_id: string | null;
  resolved_action: string | null;
  resolved_bill_txn_id: string | null;
  status: string;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }

/** Push `pay_existing_bill` intents to QB for the given qb_ingest_events ids.
 *  Returns per-intent success/rejection/skip so the caller can render
 *  actionable feedback (job ids for successes, reasons for the rest). */
export async function pushIntuitPayBill(
  supabase: SupabaseClient,
  eventIds: number[],
  opts: { auditTag?: string } = {},
): Promise<IntuitPushResult> {
  const auditTag = opts.auditTag
    ?? `intuit-push-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: IntuitPushResult['skippedIneligible'] = [];

  if (eventIds.length === 0) {
    return { jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible };
  }

  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, txn_date, amount, counterparty_qb_vendor_list_id, qb_bank_account_list_id, resolved_action, resolved_bill_txn_id, status')
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
    if (e.resolved_action !== 'pay_existing_bill') {
      skippedIneligible.push({
        eventId: e.id,
        reason: `resolved_action='${e.resolved_action ?? 'null'}' — G7a handles pay_existing_bill only`,
      });
      continue;
    }
    if (!e.resolved_bill_txn_id) {
      skippedIneligible.push({ eventId: e.id, reason: 'resolved_bill_txn_id missing — rerun reconciler' });
      continue;
    }
    if (!e.counterparty_qb_vendor_list_id) {
      skippedIneligible.push({ eventId: e.id, reason: 'counterparty_qb_vendor_list_id missing — rerun classifier' });
      continue;
    }
    if (!e.qb_bank_account_list_id) {
      skippedIneligible.push({ eventId: e.id, reason: 'qb_bank_account_list_id missing — set bank account before push' });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) {
    return { jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible };
  }

  const vendorIds = Array.from(new Set(eligible.map(e => e.counterparty_qb_vendor_list_id!)));
  const bankIds = Array.from(new Set(eligible.map(e => e.qb_bank_account_list_id!)));
  const { data: vendorData } = await supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds);
  const { data: bankData } = await supabase.from('qb_accounts').select('list_id, full_name').in('list_id', bankIds);
  const vendorName = new Map(((vendorData ?? []) as VendorRow[]).map(r => [r.list_id, r.name]));
  const bankName = new Map(((bankData ?? []) as AccountRow[]).map(r => [r.list_id, r.full_name]));

  const intents: PayBillIntent[] = [];
  for (const e of eligible) {
    const payee = vendorName.get(e.counterparty_qb_vendor_list_id!);
    const bank = bankName.get(e.qb_bank_account_list_id!);
    if (!payee) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for list_id='${e.counterparty_qb_vendor_list_id}' — sync qb_mirror` });
      continue;
    }
    if (!bank) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_accounts row missing for list_id='${e.qb_bank_account_list_id}' — sync qb_mirror` });
      continue;
    }
    intents.push({
      kind: 'pay_bill',
      auditTag,
      payeeVendorName: payee,
      bankAccountName: bank,
      txnDate: e.txn_date,
      memo: `ingest:${e.id}`,
      applications: [{ billTxnId: e.resolved_bill_txn_id!, paymentAmount: Number(e.amount) }],
      sourceIngestEventId: e.id,
    });
  }

  if (intents.length === 0) {
    return { jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible };
  }

  const result = await executeIntents(supabase, intents);
  return { ...result, skippedIneligible };
}
