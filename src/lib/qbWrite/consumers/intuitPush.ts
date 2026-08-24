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
//   #27 — State vs fresh fetch: consumer reads events + qb_vendors +
//         qb_accounts + qb_mirror freshly, never from React state.
//   #36 — Verify via mirror after every push: consumer chains a bill_query
//         (depends_on the pay_bill job) so mirror re-reads the paid bill's
//         IsPaid flip; the live status pane consumes that signal.
//
// Amount-equality gate (first-live-push safety, 2026-08-21):
//   The reconciler paired the event with a specific qb_mirror bill. We refuse
//   to push if event.amount ≠ mirror bill's open_amount (or the bill is
//   already settled). Partial payments are legal QB but they're not what any
//   Hover/Procal backlog case needs; require exact match on first cutover
//   and relax later once trust is established.
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
  /** Follow-up bill_query job ids enqueued for read-after-write verification,
   *  keyed by the pay_bill jobId that spawned them. INVARIANTS #36. */
  verifyJobIdByPayJobId: Record<number, number>;
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
  matched_invoice_ids: number[] | null;
  match_provenance: string | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }
interface MirrorBillRow {
  entity_ref: string;
  amount: number | string | null;
  is_settled: boolean | null;
  data: { open_amount?: number | string; vendor_name?: string } | null;
}

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
  const emptyReturn = (): IntuitPushResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible, verifyJobIdByPayJobId: {},
  });

  if (eventIds.length === 0) return emptyReturn();

  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, txn_date, amount, counterparty_qb_vendor_list_id, qb_bank_account_list_id, resolved_action, resolved_bill_txn_id, status, matched_invoice_ids, match_provenance')
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
    // Provenance gate (pay_existing_bill class): require exact-txn or exact-ref
    // so we know our matched invoice is the right one. Fuzzy / empty stays
    // out until the accountant human-verifies in the UI (future: override flag).
    const provenance = e.match_provenance;
    if (provenance !== 'exact-txn' && provenance !== 'exact-ref') {
      skippedIneligible.push({
        eventId: e.id,
        reason: `match_provenance='${provenance ?? 'null'}' — pay_existing_bill requires exact-txn or exact-ref (invoice link too weak; verify in UI first)`,
      });
      continue;
    }
    const matchedIds = e.matched_invoice_ids ?? [];
    if (matchedIds.length === 0) {
      skippedIneligible.push({
        eventId: e.id,
        reason: 'matched_invoice_ids is empty — no invoice to reconcile against',
      });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // Dupe guard: if two eligible events map to the same primary invoice
  // (matched_invoice_ids[0]), both are ambiguous — refuse both. exact-txn
  // provenance makes this collision statistically impossible (bill TxnID is
  // unique per QB bill) but keep the guard for exact-ref which relies on
  // memo naming and could plausibly collide.
  const primaryInvoiceCount = new Map<number, number>();
  for (const e of eligible) {
    const primary = (e.matched_invoice_ids ?? [])[0];
    if (primary != null) primaryInvoiceCount.set(primary, (primaryInvoiceCount.get(primary) ?? 0) + 1);
  }
  const collided = new Set<number>();
  for (const [invId, n] of primaryInvoiceCount) if (n > 1) collided.add(invId);
  const eligibleAfterDupe: IngestEventRow[] = [];
  for (const e of eligible) {
    const primary = (e.matched_invoice_ids ?? [])[0];
    if (primary != null && collided.has(primary)) {
      skippedIneligible.push({
        eventId: e.id,
        reason: `duplicate invoice-mapping: invoice.id=${primary} claimed by multiple ready events — human review before push`,
      });
      continue;
    }
    eligibleAfterDupe.push(e);
  }
  if (eligibleAfterDupe.length === 0) return emptyReturn();

  // Amount-equality gate — fetch mirror rows for the resolved bills.
  const billTxnIds = Array.from(new Set(eligibleAfterDupe.map(e => e.resolved_bill_txn_id!)));
  const { data: mirrorData } = await supabase
    .from('qb_mirror')
    .select('entity_ref, amount, is_settled, data')
    .eq('entity_kind', 'bill')
    .in('entity_ref', billTxnIds);
  const mirrorByTxnId = new Map(((mirrorData ?? []) as MirrorBillRow[]).map(m => [m.entity_ref, m]));

  const vendorIds = Array.from(new Set(eligibleAfterDupe.map(e => e.counterparty_qb_vendor_list_id!)));
  const bankIds = Array.from(new Set(eligibleAfterDupe.map(e => e.qb_bank_account_list_id!)));
  const { data: vendorData } = await supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds);
  const { data: bankData } = await supabase.from('qb_accounts').select('list_id, full_name').in('list_id', bankIds);
  const vendorName = new Map(((vendorData ?? []) as VendorRow[]).map(r => [r.list_id, r.name]));
  const bankName = new Map(((bankData ?? []) as AccountRow[]).map(r => [r.list_id, r.full_name]));

  const intents: PayBillIntent[] = [];
  const eventIdByIntentIndex: number[] = [];  // for mapping executor jobIds back to events
  for (const e of eligibleAfterDupe) {
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
    const mirror = mirrorByTxnId.get(e.resolved_bill_txn_id!);
    if (!mirror) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_mirror bill missing for TxnID=${e.resolved_bill_txn_id} — enqueue bill_query first` });
      continue;
    }
    if (mirror.is_settled === true) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_mirror bill TxnID=${e.resolved_bill_txn_id} is already settled (IsPaid=true) — rerun reconciler` });
      continue;
    }
    const eventAmount = Number(e.amount);
    // QB Desktop quirk (verified 2026-08-24 across 6 open bills, 3 vendors):
    // <OpenAmount> in BillRet returns the VENDOR's aggregate AP balance across
    // all unsettled bills, NOT the per-bill open amount. Both Hover bills
    // ($12,600 + $13,200) returned OpenAmount=$25,800; same pattern on Flawless
    // and Procal. Not usable for per-bill parity.
    //
    // Use <AmountDue> (mirror.amount) as the per-bill worth. Combined with
    // is_settled=false (checked above), this is a sound "full bill is still
    // owed" signal. Partial-payment support (subtracting LinkedTxn
    // AppliedToTxnRet amounts) is future work — no such case in the backlog.
    const billAmount = Number(mirror.amount ?? 0);
    // Compare to 2dp — accountant amounts are always penny-precise; float noise
    // is a code smell here anyway.
    if (Math.abs(eventAmount - billAmount) > 0.005) {
      skippedIneligible.push({
        eventId: e.id,
        reason: `amount-mismatch: event.amount=${eventAmount.toFixed(2)} but qb_mirror bill TxnID=${e.resolved_bill_txn_id} AmountDue=${billAmount.toFixed(2)}. Refuse until parity or explicit override.`,
      });
      continue;
    }
    intents.push({
      kind: 'pay_bill',
      auditTag,
      payeeVendorName: payee,
      bankAccountName: bank,
      txnDate: e.txn_date,
      memo: `ingest:${e.id}`,
      applications: [{ billTxnId: e.resolved_bill_txn_id!, paymentAmount: eventAmount }],
      sourceIngestEventId: e.id,
    });
    eventIdByIntentIndex.push(e.id);
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // INVARIANTS #36 — chain a bill_query verification job per successful pay_bill.
  // Runs AFTER the pay_bill drains (depends_on) so mirror re-reads the paid
  // bill's IsPaid flip. The status pane looks at qb_mirror after both jobs
  // are done to render green/red/amber.
  const verifyJobIdByPayJobId: Record<number, number> = {};
  const verifyRows: Array<{ kind: 'bill_query'; payload: Record<string, unknown>; status: 'pending'; depends_on: number[] }> = [];
  const verifyMeta: Array<{ payJobId: number; eventId: number }> = [];
  result.jobIds.forEach((payJobId, i) => {
    if (payJobId == null) return;
    const eventId = eventIdByIntentIndex[i];
    const intent = intents[i];
    const billTxnId = intent.applications[0].billTxnId;
    verifyRows.push({
      kind: 'bill_query',
      payload: {
        txnIds: [billTxnId],
        __audit_tag: `${auditTag}-verify`,
        __verify_for_event_id: eventId,
      },
      status: 'pending',
      depends_on: [payJobId],
    });
    verifyMeta.push({ payJobId, eventId });
  });
  if (verifyRows.length > 0) {
    const { data: inserted, error } = await supabase
      .from('qb_sync_jobs')
      .insert(verifyRows)
      .select('id');
    if (!error && inserted) {
      (inserted as Array<{ id: number }>).forEach((row, idx) => {
        const meta = verifyMeta[idx];
        if (meta) verifyJobIdByPayJobId[meta.payJobId] = row.id;
      });
    }
    // Silent-fail here is intentional: the pay_bill is enqueued; missing the
    // verify chain just means the UI can't auto-verify. The push itself is
    // fine — silent-drop detection is a UX affordance, not a correctness one.
  }

  return { ...result, skippedIneligible, verifyJobIdByPayJobId };
}
