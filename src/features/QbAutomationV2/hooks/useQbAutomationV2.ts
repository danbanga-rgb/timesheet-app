import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Invoice, PaymentProfile, QbIngestEvent, QbResolvedAction, QbVendorMapping, UserProfile } from '../../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../../lib/qbStateSync/types';
import { computeVerdict, type Verdict } from '../../../lib/qbAutomation/verdict';
import { normalizeRef } from '../../../lib/intuit/reconcile';
import { buildHistoryByUser, resolveVendorCandidates, type Candidate } from '../../../lib/qbAutomation/vendorMappingResolver';
import { getEffectiveMatchedInvoiceIds, isUmbrellaEvent } from '../../../lib/qbAutomation/umbrella';
import { derivePushedRowDisplay, deriveSyntheticPushedRowDisplay } from '../../../lib/qbAutomation/pushedRowDerivation';
import { isTestAccount } from '../../../lib/isTestAccount';

// Lifted from TS.tsx:7246, tightened for v2 Pushed card (Inv → Bill vs V1's Invoice → Bill).
const SOURCE_LABEL_MAP: Record<string, string> = {
  intuit_xlsx: 'Intuit',
  convera: 'Convera',
  manual: 'Manual',
  invoice_g75: 'Inv → Bill (Intuit)',
  invoice_g76: 'Inv → Bill (Convera)',
};
export function sourceLabel(s: string): string {
  return SOURCE_LABEL_MAP[s] || s;
}

export type ReadyGroup = 'pay' | 'create';

function groupForVerdict(v: Verdict): ReadyGroup {
  return v === 'will_create_bill' ? 'create' : 'pay';
}

export interface UmbrellaChildRow {
  invoiceId: number;
  contractorName: string;
  contractorUserId: string | null;
  invoiceNumber: string;
  hours: number | null;
  rate: number | null;
  currency: string;
  share: number;                    // amount_share from convera_transaction_invoices, or invoice total as fallback
  // 'convera_link' = post-wire slice pulled from convera_transaction_invoices.
  // 'invoice_total' = post-wire slice where the link is missing → invoice total as fallback (renders * marker).
  // 'pre_wire'      = no wire yet; invoice total is the authoritative amount (no marker).
  shareSource: 'convera_link' | 'invoice_total' | 'pre_wire';
  qbVendorName: string;              // per-child (multi-vendor umbrellas like Bimosoft)
  qbVendorListId: string | null;
}

export interface ReadyRow {
  rowKey: string;
  eventId: number | null;
  invoiceId: number | null;
  contractorName: string;
  contractorUserId: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  hours: number | null;
  rate: number | null;
  periodStart: string;
  periodEnd: string;
  monthKey: string;
  monthLabel: string;
  qbVendorName: string;
  qbVendorMapped: boolean;
  qbVendorListId: string | null;
  verdict: Verdict;
  group: ReadyGroup;
  // For inline vendor override (V8-B): pp_id keys the mapping upsert; source
  // + counterpartyPattern are needed by the SaveMappingArgs contract;
  // ppLabel drives the tier-3 token-overlap candidate resolver.
  ppId: number;
  ppLabel: string;
  ppSource: string;
  ppCounterpartyPattern: string;
  candidates: Candidate[];
  // V9.5: umbrella event → children present. Parent shows aggregate; expand
  // to see per-contractor slices. Push is atomic per wire.
  children?: UmbrellaChildRow[];
  distinctVendorCount?: number;      // > 1 for multi-vendor umbrella (Bimosoft/NT)
  // V9.9 item 5: attached when a recent qb_sync_jobs row for this source
  // finished with status='failed'. Card renders a red pill; the row is
  // still selectable + pushable (retry = re-select and push).
  lastFailedPush?: FailedPushJob;
}

export type NeedsMappingReason =
  | 'event_needs_vendor'          // pending/ready event, counterparty_qb_vendor_list_id null
  | 'invoice_pp_no_qb_vendor'     // approved invoice, pp has no qb_vendor_name
  | 'invoice_pp_vendor_not_synced' // pp has qb_vendor_name but not in qb_vendors mirror
  | 'invoice_no_pp';               // approved invoice, no pp snapshot

export interface NeedsMappingRow {
  rowKey: string;
  reason: NeedsMappingReason;
  eventId: number | null;
  invoiceId: number | null;
  source: string;
  counterpartyRaw: string;
  contractorName: string;
  contractorUserId: string | null;
  invoiceNumber: string;
  amount: number;
  currency: string;
  monthKey: string;
  monthLabel: string;
  ppLabel: string;
  ppId: number;
  ppQbVendorName: string | null;   // for invoice_pp_vendor_not_synced
  candidates: Candidate[];
}

// V9.9 item 5: recent failed push job, surfaced as a red pill on the
// affected Ready row. The pill click opens a small diagnostic with the
// error text + a Retry button.
export interface FailedPushJob {
  jobId: number;
  kind: string;                       // 'bill_pmt_add' | 'bill_add' | 'check_add'
  errorMsg: string;
  completedAt: string | null;
  sourceIngestEventId: number | null;
  sourceInvoiceId: number | null;
}

// V1-aligned shape (TS.tsx:8599-8611 Already Posted columns, minus Provenance).
// Row is centered on the qb_ingest_event, not on a fuzzily-matched invoice —
// counterparty_raw + memo are the source of truth. When the reconciler picked
// the wrong invoice via fuzzy match, the raw event fields still read correctly.
export interface PushedRow {
  eventId: number;                    // React key
  src: string;                        // sourceLabel(e.source) chip
  date: string;                       // e.txnDate — QB transaction date
  counterpartyRaw: string;            // e.counterparty_raw — always raw, never invoice-derived
  qbVendorName: string;               // vendor mapped via counterparty_qb_vendor_list_id
  amount: number;
  currency: string;
  memo: string;                       // e.memo — source of truth (e.g. "Inv# 09")
  resolvedAction: QbResolvedAction | null;
  resolvedRefLabel: string | null;    // feeds formatActionLabel — "INV 51" when known
  isG75Source: boolean;
  billTxnId: string | null;           // QB TxnID for optional Action badge tooltip
  statusUpdatedAt: string;
}

export interface MappingRow {
  mappingId: number;
  ppId: number | null;
  source: string;
  counterpartyPattern: string;
  contractorName: string;
  ppLabel: string;
  qbVendorListId: string;
  qbVendorName: string;
  billsPushedCount: number;
  isLegacy: boolean;
}

export interface UseQbAutomationV2Args {
  events: QbIngestEvent[];
  openBills: QbOpenBillRow[];
  vendors: QbVendorRow[];
  invoices: Invoice[];
  paymentProfiles: PaymentProfile[];
  users: UserProfile[];
  mappings: QbVendorMapping[];
  /** Per-invoice share for umbrella wires, keyed by `${eventId}::${invoiceId}`.
   *  Populated from convera_transaction_invoices.amount_share. Empty map is
   *  fine — children fall back to invoice total with shareSource='invoice_total'. */
  umbrellaShares?: Map<string, number>;
  /** V9.9 item 3: persist Skip to invoices.qb_export_status via the v1
   *  wrapper. Called with all invoice IDs belonging to the row. */
  onSaveInvoiceExportStatus?: (invoiceIds: number[], next: 'skipped' | 'not_exported') => Promise<void>;
  /** V9.9 item 5: recent failed qb_sync_jobs (status='failed'), scoped
   *  by the parent to the last ~30 days. Loaded once alongside events. */
  failedPushJobs?: FailedPushJob[];
  /** V9.9 followup 2026-09-24: invoice IDs whose G7.5 (Intuit) or G7.6
   *  (Convera) bill_add job drained successfully. These pushes write
   *  qb_bill_txn_id to invoices, not events — the event stays 'ready'
   *  forever. Included as synthetic Pushed rows to match V1's
   *  "Already posted" bucket. */
  g75PostedInvoiceIds?: Set<number>;
  g76PostedInvoiceIds?: Set<number>;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabelFromKey(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return key;
  return `${MONTH_NAMES[idx]} ${y}`;
}

// Returns "today" as a YYYY-MM-DD string in local time. Used to bucket
// qb_ingest_events into "Pushed today" — statusUpdatedAt is compared
// prefix-wise against this.
export function todayLocalDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Local ISO date prefix of an ISO timestamp (e.g. "2026-09-23T14:22:00Z" →
// "2026-09-23" in the browser's local zone). Two-step conversion because
// server timestamps are UTC but "today" is a local-day concept.
export function localDateKeyOfIso(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  void now;
  return todayLocalDateKey(d);
}

// Local month prefix ("YYYY-MM") of an ISO timestamp. Used to bucket
// older pushed rows into month rollups (v1 month-rollup pattern).
export function localMonthKeyOfIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildPushedRow(
  e: QbIngestEvent,
  vendorsById: Map<string, QbVendorRow>,
  billByTxnId: Map<string, QbOpenBillRow>,
): PushedRow | null {
  if (!e.statusUpdatedAt) return null;
  const qbVendorName = e.counterpartyQbVendorListId
    ? (vendorsById.get(e.counterpartyQbVendorListId)?.name ?? '(unmapped)')
    : '(unmapped)';
  const refs = (e.postedQbRefs ?? {}) as Record<string, unknown>;
  const billTxnId = (typeof refs.bill === 'string' ? refs.bill : null)
    ?? e.resolvedBillTxnId
    ?? null;
  const display = derivePushedRowDisplay(
    { resolvedAction: e.resolvedAction, resolvedBillTxnId: e.resolvedBillTxnId, matchProvenance: e.matchProvenance, source: e.source },
    billByTxnId,
  );
  return {
    eventId: e.id,
    src: sourceLabel(e.source),
    date: e.txnDate ?? '',
    counterpartyRaw: e.counterpartyRaw || '(unknown)',
    qbVendorName,
    amount: e.amount,
    currency: 'USD',                    // event has no currency field; USD hardcoded matches V1
    memo: e.memo ?? '',
    resolvedAction: display.resolvedAction,
    resolvedRefLabel: display.resolvedRefLabel,
    isG75Source: display.isG75Source,
    billTxnId,
    statusUpdatedAt: e.statusUpdatedAt,
  };
}

export interface PushedMonthGroup {
  monthKey: string;         // YYYY-MM of statusUpdatedAt (local)
  monthLabel: string;       // "Aug 2026"
  rows: PushedRow[];        // sorted desc by statusUpdatedAt
  total: number;
}

// V9.9 item 4 + Dan's follow-up: unified "Pushed" card. All posted
// events grouped by push-month (statusUpdatedAt), newest month first.
// Today's rows naturally fall into the current-month bucket; no
// separate "today" concept.
//
// 2026-09-24 correction: V1's "Already posted" bucket also includes
// synthetic rows for G7.5/G7.6 invoice-driven pushes — bill_add on
// those flows writes qb_bill_txn_id to invoices, not events, so the
// event stays 'ready' forever. Mirror V1's approach here (see
// TS.tsx:7449+) so v2's count matches V1's exactly.
export function derivePushedByMonth(
  events: QbIngestEvent[],
  invoices: Invoice[],
  vendorsById: Map<string, QbVendorRow>,
  billByTxnId: Map<string, QbOpenBillRow>,
  g75PostedInvoiceIds: Set<number>,
  g76PostedInvoiceIds: Set<number>,
): PushedMonthGroup[] {
  const byMonth = new Map<string, PushedRow[]>();
  for (const e of events) {
    if (e.status !== 'posted') continue;
    if (!e.statusUpdatedAt) continue;
    const row = buildPushedRow(e, vendorsById, billByTxnId);
    if (!row) continue;
    const mk = localMonthKeyOfIso(e.statusUpdatedAt);
    if (!mk) continue;
    const bucket = byMonth.get(mk);
    if (bucket) bucket.push(row);
    else byMonth.set(mk, [row]);
  }
  // Synthetic G7.5/G7.6 rows (invoice-driven create-bill pushes).
  // V1 pattern (TS.tsx:7461-7488): synthesize a QbIngestEvent-shaped row so
  // the same rendering path handles both real and invoice-driven pushes.
  // No dedup vs covering events — mirrors V1's Already Posted count exactly
  // per [[match-v1-during-coexistence]]. Fix at V12 cutover.
  for (const inv of invoices) {
    const isG75 = g75PostedInvoiceIds.has(inv.id);
    const isG76 = g76PostedInvoiceIds.has(inv.id);
    if (!isG75 && !isG76) continue;
    if (!inv.qbBillTxnId) continue;
    const when = inv.qbExportStatusAt ?? inv.periodEnd ?? '';
    if (!when) continue;
    const mk = localMonthKeyOfIso(when) || (inv.periodEnd?.slice(0, 7) ?? '');
    if (!mk) continue;
    const display = deriveSyntheticPushedRowDisplay(isG75 ? 'g75' : 'g76', inv.invoiceNumber || null);
    const row: PushedRow = {
      eventId: -inv.id,                              // negative avoids collision with real events
      src: sourceLabel(isG75 ? 'invoice_g75' : 'invoice_g76'),
      date: inv.periodEnd ?? '',
      counterpartyRaw: inv.userName || '(unknown)',
      qbVendorName: inv.paymentProfile?.companyName || inv.userName || '(unmapped)',
      amount: inv.totalAmount,
      currency: inv.currency || 'USD',
      memo: inv.invoiceNumber ? `INV ${inv.invoiceNumber}` : '',
      resolvedAction: display.resolvedAction,
      resolvedRefLabel: display.resolvedRefLabel,
      isG75Source: display.isG75Source,
      billTxnId: inv.qbBillTxnId,
      statusUpdatedAt: when,
    };
    const bucket = byMonth.get(mk);
    if (bucket) bucket.push(row);
    else byMonth.set(mk, [row]);
  }
  const groups: PushedMonthGroup[] = [];
  for (const [monthKey, rows] of byMonth) {
    rows.sort((a, b) => (b.statusUpdatedAt || '').localeCompare(a.statusUpdatedAt || ''));
    const total = rows.reduce((s, r) => s + r.amount, 0);
    groups.push({ monthKey, monthLabel: monthLabelFromKey(monthKey), rows, total });
  }
  groups.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  return groups;
}

export function useQbAutomationV2({
  events,
  openBills,
  vendors,
  invoices,
  paymentProfiles,
  users,
  mappings,
  umbrellaShares,
  onSaveInvoiceExportStatus,
  failedPushJobs,
  g75PostedInvoiceIds,
  g76PostedInvoiceIds,
}: UseQbAutomationV2Args) {
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const vendorsById = useMemo(() => new Map(vendors.map(v => [v.listId, v])), [vendors]);
  const billByTxnId = useMemo(() => new Map(openBills.map(b => [b.txnId, b])), [openBills]);
  const ppById = useMemo(() => new Map(paymentProfiles.map(p => [p.id, p])), [paymentProfiles]);
  const userById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);
  const mappingByPpId = useMemo(() => {
    const m = new Map<number, QbVendorMapping>();
    for (const row of mappings) if (row.ppId != null) m.set(row.ppId, row);
    return m;
  }, [mappings]);

  // Build once per render; used by both allReadyRows (V8-B inline override
  // candidate chips) and needsMappingRows (existing tier-2 history tier).
  const historyByUser = useMemo(() => {
    const invoiceUserIdById = new Map<number, string>();
    for (const inv of invoices) if (inv.userId) invoiceUserIdById.set(inv.id, inv.userId);
    return buildHistoryByUser(
      events.map(e => ({
        status: e.status,
        counterpartyQbVendorListId: e.counterpartyQbVendorListId,
        matchedInvoiceIds: e.matchedInvoiceIds,
      })),
      invoiceUserIdById,
    );
  }, [events, invoices]);

  const resolverVendors = useMemo(
    () => vendors.map(v => ({ listId: v.listId, name: v.name })),
    [vendors],
  );

  // V9.9 item 5: index recent failed pushes by source. Prefer the most
  // recent failure per source (jobs sorted by completedAt desc first).
  const { failedByEventId, failedByInvoiceId } = useMemo(() => {
    const byEvent = new Map<number, FailedPushJob>();
    const byInvoice = new Map<number, FailedPushJob>();
    const sorted = [...(failedPushJobs ?? [])].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    for (const j of sorted) {
      if (j.sourceIngestEventId != null && !byEvent.has(j.sourceIngestEventId)) byEvent.set(j.sourceIngestEventId, j);
      if (j.sourceInvoiceId != null && !byInvoice.has(j.sourceInvoiceId)) byInvoice.set(j.sourceInvoiceId, j);
    }
    return { failedByEventId: byEvent, failedByInvoiceId: byInvoice };
  }, [failedPushJobs]);

  const allReadyRows: ReadyRow[] = useMemo(() => {
    const rows: ReadyRow[] = [];
    const invoiceIdsCoveredByEvents = new Set<number>();

    const attachFailure = (row: ReadyRow): ReadyRow => {
      let hit: FailedPushJob | undefined;
      if (row.eventId != null) hit = failedByEventId.get(row.eventId);
      if (!hit && row.invoiceId != null) hit = failedByInvoiceId.get(row.invoiceId);
      if (!hit && row.children) {
        for (const c of row.children) {
          hit = failedByInvoiceId.get(c.invoiceId);
          if (hit) break;
        }
      }
      if (hit) row.lastFailedPush = hit;
      return row;
    };

    for (const e of events) {
      if (e.status !== 'ready') continue;
      if (e.targetQbTxnKind !== 'bill_pmt' && e.targetQbTxnKind !== 'bill_add_and_pmt') continue;
      if (e.rawData?.__backfill) continue;

      // ── V9.5: umbrella wire → group row + children ─────────────────────────
      if (isUmbrellaEvent(e, invoicesById, umbrellaShares)) {
        const childRows: UmbrellaChildRow[] = [];
        const distinctVendorListIds = new Set<string>();
        let periodStart = '';
        let periodEnd = '';
        let monthKey = '';
        let currency = 'USD';

        // Use effective invoice ids (matched_invoice_ids ∪ umbrella-share
        // invoice ids) so slices only reconciled via convera_transaction_invoices
        // still surface as child rows.
        const effectiveInvoiceIds = getEffectiveMatchedInvoiceIds(e, umbrellaShares);
        for (const invId of effectiveInvoiceIds) {
          const inv = invoicesById.get(invId);
          if (!inv) continue;
          const childPpId = inv.paymentProfile?.id ?? 0;
          const childMapping = childPpId > 0 ? mappingByPpId.get(childPpId) : undefined;
          const childVendorListId = childMapping?.qbVendorListId ?? null;
          const childVendorName = childVendorListId
            ? (vendorsById.get(childVendorListId)?.name ?? '(unmapped)')
            : '(unmapped)';
          if (childVendorListId) distinctVendorListIds.add(childVendorListId);

          const shareKey = `${e.id}::${inv.id}`;
          const linkedShare = umbrellaShares?.get(shareKey);
          const share = linkedShare != null && linkedShare > 0 ? linkedShare : inv.totalAmount;
          const shareSource: UmbrellaChildRow['shareSource'] = linkedShare != null && linkedShare > 0
            ? 'convera_link'
            : 'invoice_total';

          childRows.push({
            invoiceId: inv.id,
            contractorName: inv.userName || '(unknown)',
            contractorUserId: inv.userId ?? null,
            invoiceNumber: inv.invoiceNumber,
            hours: inv.totalHours ?? null,
            rate: inv.rate ?? null,
            currency: inv.currency || 'USD',
            share,
            shareSource,
            qbVendorName: childVendorName,
            qbVendorListId: childVendorListId,
          });
          invoiceIdsCoveredByEvents.add(inv.id);
          if (!periodStart && inv.periodStart) periodStart = inv.periodStart;
          if (!periodEnd && inv.periodEnd) periodEnd = inv.periodEnd;
          if (!monthKey && inv.periodEnd) monthKey = inv.periodEnd.slice(0, 7);
          if (inv.currency) currency = inv.currency;
        }
        childRows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));

        // Verdict for a group row: use the first child's invoice number as
        // the mirror lookup key; if that yields null (e.g. empty refNumber
        // path), fall back to 'will_create_and_pay' — the default for any
        // umbrella event we haven't already booked. Never skip a group row
        // just because the verdict input is thin, or the whole umbrella
        // event disappears from Ready.
        const firstChildRef = childRows[0]?.invoiceNumber ?? '';
        const verdict = computeVerdict(
          { kind: e.targetQbTxnKind, vendorListId: e.counterpartyQbVendorListId, refNumber: firstChildRef, month: monthKey },
          openBills,
        ) ?? 'will_create_and_pay';

        const parentVendorName = distinctVendorListIds.size === 1
          ? (vendorsById.get([...distinctVendorListIds][0])?.name ?? '(unmapped)')
          : (e.counterpartyQbVendorListId
              ? (vendorsById.get(e.counterpartyQbVendorListId)?.name ?? '(multi-vendor)')
              : '(multi-vendor)');

        rows.push({
          rowKey: `evt-${e.id}`,
          eventId: e.id,
          invoiceId: null,
          contractorName: parentVendorName,
          contractorUserId: null,
          invoiceNumber: '',
          amount: e.amount,
          currency,
          hours: null,
          rate: null,
          periodStart,
          periodEnd,
          monthKey,
          monthLabel: monthLabelFromKey(monthKey),
          qbVendorName: parentVendorName,
          qbVendorMapped: distinctVendorListIds.size >= 1 || !!e.counterpartyQbVendorListId,
          qbVendorListId: distinctVendorListIds.size === 1 ? [...distinctVendorListIds][0] : (e.counterpartyQbVendorListId ?? null),
          verdict,
          group: groupForVerdict(verdict),
          ppId: 0,                          // no single pp — inline vendor override disabled at parent
          ppLabel: '',
          ppSource: e.source,
          ppCounterpartyPattern: e.counterpartyRaw,
          candidates: [],
          children: childRows,
          distinctVendorCount: distinctVendorListIds.size,
        });
        continue;
      }

      const invoice: Invoice | null = e.matchedInvoiceIds.length > 0
        ? (invoicesById.get(e.matchedInvoiceIds[0]) ?? null)
        : null;

      const refNumber = invoice?.invoiceNumber ?? '';
      const monthKey = invoice?.periodEnd?.slice(0, 7) ?? '';

      const verdict = computeVerdict(
        { kind: e.targetQbTxnKind, vendorListId: e.counterpartyQbVendorListId, refNumber, month: monthKey },
        openBills,
      );
      if (!verdict) continue;

      const vendorMapped = !!e.counterpartyQbVendorListId;
      const qbVendorName = vendorMapped
        ? (vendorsById.get(e.counterpartyQbVendorListId!)?.name ?? '(unmapped)')
        : '(unmapped)';

      if (invoice) invoiceIdsCoveredByEvents.add(invoice.id);

      const ppId = invoice?.paymentProfile?.id ?? 0;
      const ppLabel = invoice?.paymentProfile?.companyName
        || invoice?.paymentProfile?.bankName
        || e.counterpartyRaw
        || '';
      const contractorName = invoice?.userName || e.counterpartyRaw || '(unknown)';
      const contractorUserId = invoice?.userId ?? null;
      const candidates = ppId > 0
        ? resolveVendorCandidates(
            { contractorName, contractorUserId, ppLabel },
            { vendors: resolverVendors, historyByUser },
          )
        : [];

      rows.push({
        rowKey: `evt-${e.id}`,
        eventId: e.id,
        invoiceId: invoice?.id ?? null,
        contractorName,
        contractorUserId,
        invoiceNumber: refNumber,
        amount: e.amount,
        currency: invoice?.currency || 'USD',
        hours: invoice?.totalHours ?? null,
        rate: invoice?.rate ?? null,
        periodStart: invoice?.periodStart ?? '',
        periodEnd: invoice?.periodEnd ?? '',
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        qbVendorName,
        qbVendorMapped: vendorMapped,
        qbVendorListId: e.counterpartyQbVendorListId ?? null,
        verdict,
        group: groupForVerdict(verdict),
        ppId,
        ppLabel,
        ppSource: e.source,
        ppCounterpartyPattern: e.counterpartyRaw,
        candidates,
      });
    }

    // Loose-invoice loop: collect eligible approved invoices, then group by
    // (qbVendorListId, monthKey) so pre-wire umbrella (Teal 8 contractors,
    // Faruk-covers-Ajdin) surfaces as a single group row instead of N solo
    // rows. Single-vendor-single-invoice cases stay as solo rows.
    interface LooseCandidate { inv: Invoice; ppId: number; mapping: QbVendorMapping; monthKey: string; qbVendorName: string; qbVendorListId: string; ppLabel: string; contractorName: string; contractorUserId: string | null; }
    const looseCandidates: LooseCandidate[] = [];
    for (const inv of invoices) {
      if (inv.status !== 'approved') continue;
      if (invoiceIdsCoveredByEvents.has(inv.id)) continue;
      if (isTestAccount(inv.userName || '')) continue;

      const ppId = inv.paymentProfile?.id ?? 0;
      if (!ppId || ppId <= 0) continue;
      const mapping = mappingByPpId.get(ppId);
      if (!mapping?.qbVendorListId) continue;

      const wantRef = normalizeRef(inv.invoiceNumber);
      if (!wantRef) continue;
      const monthKey = inv.periodEnd?.slice(0, 7) ?? '';
      if (!monthKey) continue;

      const hasBill = openBills.some(b =>
        b.vendorListId === mapping.qbVendorListId
        && normalizeRef(b.refNumber) === wantRef
        && (b.txnDate ?? '').slice(0, 7) === monthKey,
      );
      if (hasBill) continue;

      const qbVendorName = vendorsById.get(mapping.qbVendorListId)?.name ?? '(unmapped)';
      const ppLabel = inv.paymentProfile?.companyName || inv.paymentProfile?.bankName || '';
      const contractorName = inv.userName || '(unknown)';
      const contractorUserId = inv.userId ?? null;
      looseCandidates.push({ inv, ppId, mapping, monthKey, qbVendorName, qbVendorListId: mapping.qbVendorListId, ppLabel, contractorName, contractorUserId });
    }

    // Group by (qbVendorListId, monthKey). Bucket size > 1 → group row.
    const looseByVendorMonth = new Map<string, LooseCandidate[]>();
    for (const c of looseCandidates) {
      const key = `${c.qbVendorListId}::${c.monthKey}`;
      const bucket = looseByVendorMonth.get(key);
      if (bucket) bucket.push(c);
      else looseByVendorMonth.set(key, [c]);
    }

    for (const bucket of looseByVendorMonth.values()) {
      if (bucket.length === 1) {
        const { inv, ppId, mapping, monthKey, qbVendorName, qbVendorListId, ppLabel, contractorName, contractorUserId } = bucket[0];
        const candidates = resolveVendorCandidates(
          { contractorName, contractorUserId, ppLabel },
          { vendors: resolverVendors, historyByUser },
        );
        rows.push({
          rowKey: `inv-${inv.id}`,
          eventId: null,
          invoiceId: inv.id,
          contractorName,
          contractorUserId,
          invoiceNumber: inv.invoiceNumber,
          amount: inv.totalAmount,
          currency: inv.currency || 'USD',
          hours: inv.totalHours,
          rate: inv.rate,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          monthKey,
          monthLabel: monthLabelFromKey(monthKey),
          qbVendorName,
          qbVendorMapped: true,
          qbVendorListId,
          verdict: 'will_create_bill',
          group: 'create',
          ppId,
          ppLabel,
          ppSource: mapping.source || 'invoice',
          ppCounterpartyPattern: mapping.counterpartyPattern || ppLabel,
          candidates,
        });
      } else {
        // Pre-wire umbrella group row.
        const first = bucket[0];
        const childRows: UmbrellaChildRow[] = bucket.map(c => ({
          invoiceId: c.inv.id,
          contractorName: c.contractorName,
          contractorUserId: c.contractorUserId,
          invoiceNumber: c.inv.invoiceNumber,
          hours: c.inv.totalHours ?? null,
          rate: c.inv.rate ?? null,
          currency: c.inv.currency || 'USD',
          share: c.inv.totalAmount,
          shareSource: 'pre_wire',
          qbVendorName: c.qbVendorName,
          qbVendorListId: c.qbVendorListId,
        }));
        childRows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
        const totalAmount = bucket.reduce((s, c) => s + c.inv.totalAmount, 0);
        rows.push({
          rowKey: `inv-group-${first.qbVendorListId}-${first.monthKey}`,
          eventId: null,
          invoiceId: null,
          contractorName: first.qbVendorName,
          contractorUserId: null,
          invoiceNumber: '',
          amount: totalAmount,
          currency: first.inv.currency || 'USD',
          hours: null,
          rate: null,
          periodStart: first.inv.periodStart,
          periodEnd: first.inv.periodEnd,
          monthKey: first.monthKey,
          monthLabel: monthLabelFromKey(first.monthKey),
          qbVendorName: first.qbVendorName,
          qbVendorMapped: true,
          qbVendorListId: first.qbVendorListId,
          verdict: 'will_create_bill',
          group: 'create',
          ppId: 0,
          ppLabel: '',
          ppSource: 'invoice',
          ppCounterpartyPattern: '',
          candidates: [],
          children: childRows,
          distinctVendorCount: 1,
        });
      }
    }

    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    for (const r of rows) attachFailure(r);
    return rows;
  }, [events, invoices, invoicesById, vendorsById, openBills, mappingByPpId, resolverVendors, historyByUser, umbrellaShares, failedByEventId, failedByInvoiceId]);

  // Vendor lookup by lowercase name — used by needsMappingRows to detect
  // "pp has qb_vendor_name but doesn't resolve to a qb_vendors row" (needs
  // Sync Vendors).
  const vendorByLowerName = useMemo(() => {
    const m = new Map<string, QbVendorRow>();
    for (const v of vendors) m.set(v.name.toLowerCase().trim(), v);
    return m;
  }, [vendors]);

  const needsMappingRows: NeedsMappingRow[] = useMemo(() => {
    const rows: NeedsMappingRow[] = [];

    // Reason 1: events with no counterparty_qb_vendor_list_id (unclassified).
    for (const e of events) {
      if (e.status === 'posted' || e.status === 'ignored') continue;
      if (e.rawData?.__backfill) continue;
      if (e.resolvedAction === 'already_done' || e.resolvedAction === 'pre_our_system') continue;
      if (e.counterpartyQbVendorListId) continue;

      const invoice: Invoice | null = e.matchedInvoiceIds.length > 0
        ? (invoicesById.get(e.matchedInvoiceIds[0]) ?? null)
        : null;

      const ppId = invoice?.paymentProfile?.id ?? 0;
      if (!ppId || ppId <= 0) continue;

      const contractorName = invoice?.userName || e.counterpartyRaw || '(unknown)';
      if (isTestAccount(contractorName)) continue;

      const monthKey = invoice?.periodEnd?.slice(0, 7) ?? '';
      const ppLabel = invoice?.paymentProfile?.companyName
        || invoice?.paymentProfile?.bankName
        || e.counterpartyRaw || '(no pp label)';
      const contractorUserId = invoice?.userId ?? null;
      const candidates = resolveVendorCandidates(
        { contractorName, contractorUserId, ppLabel },
        { vendors: resolverVendors, historyByUser },
      );

      rows.push({
        rowKey: `nm-evt-${e.id}`,
        reason: 'event_needs_vendor',
        eventId: e.id,
        invoiceId: invoice?.id ?? null,
        source: e.source,
        counterpartyRaw: e.counterpartyRaw,
        contractorName,
        contractorUserId,
        invoiceNumber: invoice?.invoiceNumber ?? '',
        amount: e.amount,
        currency: invoice?.currency || 'USD',
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        ppLabel,
        ppId,
        ppQbVendorName: null,
        candidates,
      });
    }

    // Reasons 2/3/4: approved invoices that can't reach Ready due to a data gap.
    for (const inv of invoices) {
      if (inv.status !== 'approved') continue;
      if (inv.qbBillTxnId) continue;
      const pm = inv.paymentMethodOverride;
      if (pm !== 'Convera' && pm !== 'Intuit') continue;
      if (isTestAccount(inv.userName || '')) continue;

      const ppId = inv.paymentProfile?.id ?? 0;
      const monthKey = inv.periodEnd?.slice(0, 7) ?? '';
      const monthLabel = monthLabelFromKey(monthKey);
      const contractorName = inv.userName || '(unknown)';
      const contractorUserId = inv.userId ?? null;
      const ppLabel = inv.paymentProfile?.companyName || inv.paymentProfile?.bankName || '';
      const base = {
        rowKey: `nm-inv-${inv.id}`,
        eventId: null,
        invoiceId: inv.id,
        source: 'invoice',
        counterpartyRaw: '',
        contractorName,
        contractorUserId,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.totalAmount,
        currency: inv.currency || 'USD',
        monthKey,
        monthLabel,
        ppLabel,
        ppId,
        candidates: [] as Candidate[],
      };

      // Reason 4: no pp snapshot at all → InvoiceDetailModal cross-contractor picker.
      if (ppId <= 0) {
        rows.push({ ...base, reason: 'invoice_no_pp', ppQbVendorName: null });
        continue;
      }
      const pp = ppById.get(ppId);
      const mapping = mappingByPpId.get(ppId);
      if (mapping?.qbVendorListId) continue; // Already ready-eligible; handled in Ready loop.

      // Reason 3: pp has qb_vendor_name but doesn't resolve to a qb_vendors row → Sync Vendors.
      if (pp?.qbVendorName && !vendorByLowerName.has(pp.qbVendorName.toLowerCase().trim())) {
        rows.push({ ...base, reason: 'invoice_pp_vendor_not_synced', ppQbVendorName: pp.qbVendorName });
        continue;
      }

      // Reason 2: no mapping AND pp has no qb_vendor_name → inline picker → reconciler heals.
      const candidates = resolveVendorCandidates(
        { contractorName, contractorUserId, ppLabel },
        { vendors: resolverVendors, historyByUser },
      );
      rows.push({ ...base, reason: 'invoice_pp_no_qb_vendor', ppQbVendorName: null, candidates });
    }

    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    return rows;
  }, [events, invoices, invoicesById, ppById, mappingByPpId, vendorByLowerName, resolverVendors, historyByUser]);

  const needsMappingTotal = useMemo(
    () => needsMappingRows.reduce((s, r) => s + r.amount, 0),
    [needsMappingRows],
  );

  const mappingRows: MappingRow[] = useMemo(() => {
    const postedCountByVendor = new Map<string, number>();
    for (const e of events) {
      if (e.status !== 'posted') continue;
      if (!e.counterpartyQbVendorListId) continue;
      postedCountByVendor.set(
        e.counterpartyQbVendorListId,
        (postedCountByVendor.get(e.counterpartyQbVendorListId) ?? 0) + 1,
      );
    }

    return mappings.map(m => {
      const pp = m.ppId != null ? ppById.get(m.ppId) ?? null : null;
      const contractor = pp ? userById.get(pp.userId) ?? null : null;
      const contractorName = contractor?.name || (m.counterpartyPattern || '(no contractor)');
      const ppLabel = pp?.companyName || pp?.bankName || (m.counterpartyPattern || '(legacy)');
      const qbVendorName = vendorsById.get(m.qbVendorListId)?.name || '(vendor not in mirror)';
      return {
        mappingId: m.id,
        ppId: m.ppId,
        source: m.source,
        counterpartyPattern: m.counterpartyPattern,
        contractorName,
        ppLabel,
        qbVendorListId: m.qbVendorListId,
        qbVendorName,
        billsPushedCount: postedCountByVendor.get(m.qbVendorListId) ?? 0,
        isLegacy: m.ppId == null,
      };
    });
  }, [mappings, ppById, userById, vendorsById, events]);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // V9.9 item 3: Skip persists via invoices.qb_export_status='skipped'
  // (v1 pattern via saveInvoiceExportStatus). A row is skipped iff every
  // underlying invoice it represents is skipped — atomic on push, atomic
  // on skip. Falls back to false when the row has no invoice ids (rare
  // edge case; skip becomes a no-op there).
  const skippedInvoiceIds = useMemo(() => {
    const s = new Set<number>();
    for (const inv of invoices) if (inv.qbExportStatus === 'skipped') s.add(inv.id);
    return s;
  }, [invoices]);

  const getRowInvoiceIds = useCallback((r: ReadyRow): number[] => {
    if (r.children && r.children.length > 0) return r.children.map(c => c.invoiceId);
    if (r.invoiceId != null) return [r.invoiceId];
    return [];
  }, []);

  const isRowSkipped = useCallback((r: ReadyRow): boolean => {
    const ids = getRowInvoiceIds(r);
    if (ids.length === 0) return false;
    return ids.every(id => skippedInvoiceIds.has(id));
  }, [getRowInvoiceIds, skippedInvoiceIds]);

  const readyRows = useMemo(() => allReadyRows.filter(r => !isRowSkipped(r)), [allReadyRows, isRowSkipped]);
  const skippedRows = useMemo(() => allReadyRows.filter(r => isRowSkipped(r)), [allReadyRows, isRowSkipped]);

  const payCount = useMemo(() => readyRows.filter(r => r.group === 'pay').length, [readyRows]);
  const createCount = useMemo(() => readyRows.filter(r => r.group === 'create').length, [readyRows]);
  const payTotal = useMemo(() => readyRows.filter(r => r.group === 'pay').reduce((s, r) => s + r.amount, 0), [readyRows]);
  const createTotal = useMemo(() => readyRows.filter(r => r.group === 'create').reduce((s, r) => s + r.amount, 0), [readyRows]);

  // Auto-select all Pay rows on first Ready population. Once initialized,
  // stay out of the user's way — new Pay rows arriving are auto-added; new
  // Create rows are NOT auto-added (user opts in via includeBillCreations).
  const initializedRef = useRef(false);
  const prevPayKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentPayKeys = new Set(readyRows.filter(r => r.group === 'pay').map(r => r.rowKey));
    if (!initializedRef.current && currentPayKeys.size > 0) {
      setSelectedKeys(new Set(currentPayKeys));
      initializedRef.current = true;
      prevPayKeysRef.current = currentPayKeys;
      return;
    }
    if (initializedRef.current) {
      // Add any newly-appearing Pay rows to selection.
      const newlyAppeared = Array.from(currentPayKeys).filter(k => !prevPayKeysRef.current.has(k));
      if (newlyAppeared.length > 0) {
        setSelectedKeys(prev => {
          const next = new Set(prev);
          newlyAppeared.forEach(k => next.add(k));
          return next;
        });
      }
      prevPayKeysRef.current = currentPayKeys;
    }
  }, [readyRows]);

  const visibleSelectedKeys = useMemo(() => {
    const visible = new Set(readyRows.map(r => r.rowKey));
    return new Set(Array.from(selectedKeys).filter(k => visible.has(k)));
  }, [readyRows, selectedKeys]);

  const toggle = useCallback((rowKey: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(new Set(readyRows.map(r => r.rowKey)));
  }, [readyRows]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const selectGroup = useCallback((group: ReadyGroup) => {
    // Replace-semantics: selecting a group discards other selections.
    // Matches Dan's mental model — "Select Payments" = "show me only Payments in selection".
    setSelectedKeys(new Set(readyRows.filter(r => r.group === group).map(r => r.rowKey)));
  }, [readyRows]);

  const skip = useCallback(async (rowKey: string) => {
    const row = allReadyRows.find(r => r.rowKey === rowKey);
    if (!row) return;
    const ids = getRowInvoiceIds(row);
    if (ids.length === 0) {
      alert('This row has no persistent invoice to skip.');
      return;
    }
    if (!onSaveInvoiceExportStatus) {
      console.warn('skip: onSaveInvoiceExportStatus not wired');
      return;
    }
    try {
      await onSaveInvoiceExportStatus(ids, 'skipped');
      setSelectedKeys(prev => {
        if (!prev.has(rowKey)) return prev;
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
    } catch (e) {
      alert('Failed to skip: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [allReadyRows, getRowInvoiceIds, onSaveInvoiceExportStatus]);

  const unskip = useCallback(async (rowKey: string) => {
    const row = allReadyRows.find(r => r.rowKey === rowKey);
    if (!row) return;
    const ids = getRowInvoiceIds(row);
    if (ids.length === 0) return;
    if (!onSaveInvoiceExportStatus) {
      console.warn('unskip: onSaveInvoiceExportStatus not wired');
      return;
    }
    try {
      await onSaveInvoiceExportStatus(ids, 'not_exported');
    } catch (e) {
      alert('Failed to unskip: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [allReadyRows, getRowInvoiceIds, onSaveInvoiceExportStatus]);

  const selectionTotal = useMemo(() => {
    let sum = 0;
    for (const r of readyRows) if (visibleSelectedKeys.has(r.rowKey)) sum += r.amount;
    return sum;
  }, [readyRows, visibleSelectedKeys]);

  const readyTotal = useMemo(() => readyRows.reduce((s, r) => s + r.amount, 0), [readyRows]);

  const pushedByMonth = useMemo(
    () => derivePushedByMonth(
      events,
      invoices,
      vendorsById,
      billByTxnId,
      g75PostedInvoiceIds ?? new Set(),
      g76PostedInvoiceIds ?? new Set(),
    ),
    [events, invoices, vendorsById, billByTxnId, g75PostedInvoiceIds, g76PostedInvoiceIds],
  );
  const pushedCount = useMemo(
    () => pushedByMonth.reduce((s, g) => s + g.rows.length, 0),
    [pushedByMonth],
  );
  const pushedTotal = useMemo(
    () => pushedByMonth.reduce((s, g) => s + g.total, 0),
    [pushedByMonth],
  );

  return {
    readyRows,
    skippedRows,
    needsMappingRows,
    needsMappingTotal,
    mappingRows,
    pushedByMonth,
    pushedCount,
    pushedTotal,
    payCount,
    createCount,
    payTotal,
    createTotal,
    selectedKeys: visibleSelectedKeys,
    selectionCount: visibleSelectedKeys.size,
    selectionTotal,
    readyTotal,
    toggle,
    selectAll,
    selectGroup,
    clearSelection,
    skip,
    unskip,
  };
}
