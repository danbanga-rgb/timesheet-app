// converaBillPmt — G7 consumer of qbWrite executor for the Convera pay path.
//
// Slice C-1: pushes BillPaymentCheckAdd for Convera qb_ingest_events that
// are (a) classified ready with target_qb_txn_kind='bill_pmt' and (b) whose
// matched invoices ALL have a QB Bill (invoice.qb_bill_txn_id set). Umbrella
// wires (1..N invoices per wire) produce ONE BillPmt with N applications.
//
// Events with any matched invoice lacking a QB Bill are skipped with a clear
// reason directing the accountant to run Convera Create Bills (G7.6) first.
// Slice C-2 will replace that skip with an automatic bill_add + hydrate + pay
// chain.
//
// Bank account: Convera uses "Western Union Holding" (per
// [[qb-payment-iif-export]] pre-cutover convention and the qb_accounts probe
// 2026-09-02). The classifier defaults bill_pmt bank to 8220 Key Point which
// is Intuit-only — this consumer looks up WU Holding fresh and OVERRIDES.
//
// RefNumber: Convera confirmation_number (10 chars — fits INVARIANTS #5).
// Traceable back to the Convera XLS row without check-number-sequence
// collision on the shared bank.
//
// Idempotency: executor de-dupes on (sourceConveraTxnId, payeeVendorName)
// via convera_transaction_billpmts. Re-push is a no-op with a skip reason.
//
// Verify chain: bill_query per pay_bill job, txnIds = every applied bill's
// TxnID. Mirrors Intuit's read-after-write pattern (INVARIANTS #36).

import type { SupabaseClient } from '@supabase/supabase-js';
import { executeIntents } from '../execute';
import type { ExecuteResult, PayBillIntent } from '../types';

export interface ConveraBillPmtResult extends ExecuteResult {
  skippedIneligible: Array<{ eventId: number; reason: string }>;
  /** Follow-up bill_query job ids for read-after-write verification, keyed
   *  by the pay_bill job id that spawned them (INVARIANTS #36). */
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

interface ConveraTxnRow {
  id: number;
  confirmation_number: string;
  date_of_order: string | null;
}

interface InvoiceRow {
  id: number;
  qb_bill_txn_id: string | null;
  total_amount: number | string;
  invoice_number: string | null;
}

interface UmbrellaLinkRow {
  transaction_id: number;
  invoice_id: number;
  amount_share: number | string | null;
}

interface VendorRow { list_id: string; name: string }
interface AccountRow { list_id: string; full_name: string }
interface MirrorBillRow { entity_ref: string; is_settled: boolean | null }

const CONVERA_BANK_PATTERN = 'western union holding';

/** Resolve the QB bank account by full_name substring match (case-insensitive).
 *  Returns null when not found — caller records this as a fatal skip since we
 *  can't build a BillPmt without a bank account. */
function findConveraBank(accounts: AccountRow[]): AccountRow | null {
  const target = CONVERA_BANK_PATTERN.toLowerCase();
  return accounts.find(a => a.full_name.toLowerCase().includes(target)) ?? null;
}

export async function pushConveraBillPmt(
  supabase: SupabaseClient,
  eventIds: number[],
  opts: { auditTag?: string } = {},
): Promise<ConveraBillPmtResult> {
  const auditTag = opts.auditTag
    ?? `convera-billpmt-${new Date().toISOString().slice(0, 10)}`;
  const skippedIneligible: ConveraBillPmtResult['skippedIneligible'] = [];
  const emptyReturn = (): ConveraBillPmtResult => ({
    jobIds: [], rejected: [], skippedDuplicate: [], skippedIneligible, verifyJobIdByPayJobId: {},
  });

  if (eventIds.length === 0) return emptyReturn();

  const { data: eventData } = await supabase
    .from('qb_ingest_events')
    .select('id, source, amount, counterparty_qb_vendor_list_id, status, target_qb_txn_kind, matched_invoice_ids, raw_data')
    .in('id', eventIds);
  const events = (eventData ?? []) as IngestEventRow[];

  const foundIds = new Set(events.map(e => e.id));
  for (const id of eventIds) {
    if (!foundIds.has(id)) skippedIneligible.push({ eventId: id, reason: 'not found in qb_ingest_events' });
  }

  // ─── First-pass eligibility ─────────────────────────────────────────────
  const eligible: IngestEventRow[] = [];
  for (const e of events) {
    if (e.source !== 'convera') {
      skippedIneligible.push({ eventId: e.id, reason: `source='${e.source}' — pushConveraBillPmt handles source='convera' only` });
      continue;
    }
    if (e.status === 'posted') {
      skippedIneligible.push({ eventId: e.id, reason: `status='posted' — already pushed` });
      continue;
    }
    if (e.status !== 'ready') {
      skippedIneligible.push({ eventId: e.id, reason: `status='${e.status}' — classifier must resolve to 'ready' before push` });
      continue;
    }
    if (e.target_qb_txn_kind !== 'bill_pmt') {
      skippedIneligible.push({ eventId: e.id, reason: `target_qb_txn_kind='${e.target_qb_txn_kind ?? 'null'}' — C-1 handles bill_pmt only` });
      continue;
    }
    if (!e.counterparty_qb_vendor_list_id) {
      skippedIneligible.push({ eventId: e.id, reason: 'counterparty_qb_vendor_list_id missing — rerun classifier' });
      continue;
    }
    const matched = e.matched_invoice_ids ?? [];
    if (matched.length === 0) {
      skippedIneligible.push({ eventId: e.id, reason: 'matched_invoice_ids is empty — nothing to pay against' });
      continue;
    }
    const converaTxnId = e.raw_data?.convera_transaction_id;
    if (converaTxnId == null) {
      skippedIneligible.push({ eventId: e.id, reason: 'raw_data.convera_transaction_id missing — shadow-write drift; re-import Convera row' });
      continue;
    }
    eligible.push(e);
  }

  if (eligible.length === 0) return emptyReturn();

  // ─── Load supporting data (bulk) ────────────────────────────────────────
  const invoiceIds = Array.from(new Set(eligible.flatMap(e => e.matched_invoice_ids ?? [])));
  const converaTxnIds = Array.from(new Set(eligible.map(e => e.raw_data!.convera_transaction_id!)));
  const vendorIds = Array.from(new Set(eligible.map(e => e.counterparty_qb_vendor_list_id!)));

  const [invoicesRes, converaTxnsRes, umbrellaRes, vendorsRes, accountsRes] = await Promise.all([
    supabase.from('invoices').select('id, qb_bill_txn_id, total_amount, invoice_number').in('id', invoiceIds),
    supabase.from('convera_transactions').select('id, confirmation_number, date_of_order').in('id', converaTxnIds),
    supabase.from('convera_transaction_invoices').select('transaction_id, invoice_id, amount_share').in('transaction_id', converaTxnIds),
    supabase.from('qb_vendors').select('list_id, name').in('list_id', vendorIds),
    supabase.from('qb_accounts').select('list_id, full_name').eq('account_type', 'Bank').eq('is_active', true),
  ]);

  const invoiceById = new Map(((invoicesRes.data ?? []) as InvoiceRow[]).map(i => [i.id, i]));
  const converaTxnById = new Map(((converaTxnsRes.data ?? []) as ConveraTxnRow[]).map(t => [t.id, t]));
  const umbrellaByKey = new Map<string, number>();
  for (const row of ((umbrellaRes.data ?? []) as UmbrellaLinkRow[])) {
    const amt = Number(row.amount_share ?? 0);
    if (amt > 0) umbrellaByKey.set(`${row.transaction_id}::${row.invoice_id}`, amt);
  }
  const vendorNameById = new Map(((vendorsRes.data ?? []) as VendorRow[]).map(v => [v.list_id, v.name]));
  const bank = findConveraBank((accountsRes.data ?? []) as AccountRow[]);

  // Defensive: cross-check every candidate bill's is_settled state in qb_mirror
  // before push. If ANY bill was already paid (via IIF or manual QB entry), we
  // refuse the entire event — duplicating a BillPmt in QB is worse than
  // holding the wire for accountant triage. Mirror intuitPush.ts:222 pattern.
  const billTxnIds = Array.from(new Set(
    (invoicesRes.data ?? [])
      .map((i: InvoiceRow) => i.qb_bill_txn_id)
      .filter((x): x is string => !!x),
  ));
  const mirrorSettledByTxnId = new Map<string, boolean | null>();
  if (billTxnIds.length > 0) {
    const { data: mirrorRows } = await supabase
      .from('qb_mirror')
      .select('entity_ref, is_settled')
      .eq('entity_kind', 'bill')
      .in('entity_ref', billTxnIds);
    for (const m of (mirrorRows ?? []) as MirrorBillRow[]) {
      mirrorSettledByTxnId.set(m.entity_ref, m.is_settled);
    }
  }

  // ─── Second-pass: build intents ─────────────────────────────────────────
  const intents: PayBillIntent[] = [];
  const eventIdByIntentIndex: number[] = [];

  for (const e of eligible) {
    const payee = vendorNameById.get(e.counterparty_qb_vendor_list_id!);
    if (!payee) {
      skippedIneligible.push({ eventId: e.id, reason: `qb_vendors row missing for list_id='${e.counterparty_qb_vendor_list_id}' — sync qb_vendors` });
      continue;
    }
    if (!bank) {
      skippedIneligible.push({ eventId: e.id, reason: `bank account matching '${CONVERA_BANK_PATTERN}' not found in qb_accounts — verify QB account list is synced` });
      continue;
    }

    const converaTxn = converaTxnById.get(e.raw_data!.convera_transaction_id!);
    if (!converaTxn) {
      skippedIneligible.push({ eventId: e.id, reason: `convera_transactions row ${e.raw_data!.convera_transaction_id} not found — data drift` });
      continue;
    }
    if (!converaTxn.date_of_order) {
      skippedIneligible.push({ eventId: e.id, reason: `convera_transactions.date_of_order missing for wire ${converaTxn.confirmation_number}` });
      continue;
    }

    // Preflight: every matched invoice must have a QB Bill. Slice C-1 refuses
    // partial-bill events; C-2 will auto-chain bill_add for the missing ones.
    const matched = e.matched_invoice_ids ?? [];
    const missing: number[] = [];
    const alreadySettled: string[] = [];
    const notInMirror: string[] = [];
    const applications: PayBillIntent['applications'] = [];
    let applicationsTotal = 0;
    let breakSkip = false;
    for (const invId of matched) {
      const inv = invoiceById.get(invId);
      if (!inv) {
        skippedIneligible.push({ eventId: e.id, reason: `matched invoice ${invId} not found in invoices table` });
        breakSkip = true;
        break;
      }
      if (!inv.qb_bill_txn_id) { missing.push(invId); continue; }
      // is_settled defensive guard — refuse if bill already paid in QB.
      // Prevents duplicate BillPmt when a wire's bills were IIF-paid pre-cutover.
      const settled = mirrorSettledByTxnId.get(inv.qb_bill_txn_id);
      if (settled === true) { alreadySettled.push(inv.qb_bill_txn_id); continue; }
      if (settled === undefined) { notInMirror.push(inv.qb_bill_txn_id); continue; }
      // Umbrella allocation first; fall back to invoice total for single-match.
      const share = umbrellaByKey.get(`${converaTxn.id}::${invId}`);
      const paymentAmount = share ?? Number(inv.total_amount);
      applications.push({ billTxnId: inv.qb_bill_txn_id, paymentAmount });
      applicationsTotal += paymentAmount;
    }
    if (breakSkip) continue;
    if (missing.length > 0) {
      skippedIneligible.push({
        eventId: e.id,
        reason: `Slice C-1 requires ALL matched invoices to have a QB Bill. Missing bills for invoice ids [${missing.join(', ')}]. Run Convera Create Bills (Push to QB → Invoice → Bill (Convera)) for these invoices first, then re-push. C-2 will automate this.`,
      });
      continue;
    }
    if (alreadySettled.length > 0) {
      skippedIneligible.push({
        eventId: e.id,
        reason: `qb_mirror shows bill TxnID(s) [${alreadySettled.join(', ')}] already settled (IsPaid=true) — pushing would create a duplicate BillPmt. If this is legitimate (partial pay etc.), override manually.`,
      });
      continue;
    }
    if (notInMirror.length > 0) {
      skippedIneligible.push({
        eventId: e.id,
        reason: `qb_mirror missing bill TxnID(s) [${notInMirror.join(', ')}] — can't confirm settled state. Run Sync QB state (qb-delta-bills) then retry.`,
      });
      continue;
    }

    // Amount parity: sum(applications) should equal the wire's foreign_amount
    // (event.amount) within 1c. Mismatch usually means (a) manual umbrella
    // edit, (b) currency drift, (c) partial invoice pay. Refuse rather than
    // silently push mis-allocated amounts — accountant reviews.
    const eventAmount = Number(e.amount);
    if (Math.abs(eventAmount - applicationsTotal) > 0.01) {
      skippedIneligible.push({
        eventId: e.id,
        reason: `amount-mismatch: wire amount=${eventAmount.toFixed(2)} but sum(applications)=${applicationsTotal.toFixed(2)}. Reconcile umbrella allocation on convera_transaction_invoices.amount_share, or verify invoice totals.`,
      });
      continue;
    }

    intents.push({
      kind: 'pay_bill',
      auditTag,
      payeeVendorName: payee,
      bankAccountName: bank.full_name,
      txnDate: converaTxn.date_of_order,
      refNumber: converaTxn.confirmation_number,
      memo: `Convera wire ${converaTxn.confirmation_number}`,
      applications,
      sourceConveraTxnId: converaTxn.id,
    });
    eventIdByIntentIndex.push(e.id);
  }

  if (intents.length === 0) return emptyReturn();

  const result = await executeIntents(supabase, intents);

  // INVARIANTS #36 — chain a bill_query verification job per successful pay_bill.
  // txnIds covers EVERY bill this pay_bill applied to (umbrella-safe). Mirror
  // re-reads the IsPaid flip; status pane consumes.
  const verifyJobIdByPayJobId: Record<number, number> = {};
  const verifyRows: Array<{ kind: 'bill_query'; payload: Record<string, unknown>; status: 'pending'; depends_on: number[] }> = [];
  const verifyMeta: Array<{ payJobId: number; eventId: number }> = [];
  result.jobIds.forEach((payJobId, i) => {
    if (payJobId == null) return;
    const eventId = eventIdByIntentIndex[i];
    const intent = intents[i];
    const billTxnIds = intent.applications.map(a => a.billTxnId);
    verifyRows.push({
      kind: 'bill_query',
      payload: {
        txnIds: billTxnIds,
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
    // Silent-fail: pay_bill is enqueued; missing verify chain only affects
    // status-pane auto-verify. Push correctness unaffected.
  }

  return { ...result, skippedIneligible, verifyJobIdByPayJobId };
}
