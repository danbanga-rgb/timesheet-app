import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Invoice, PaymentProfile, QbIngestEvent, QbVendorMapping, UserProfile } from '../../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../../lib/qbStateSync/types';
import { computeVerdict, type Verdict } from '../../../lib/qbAutomation/verdict';
import { normalizeRef } from '../../../lib/intuit/reconcile';
import { buildHistoryByUser, resolveVendorCandidates, type Candidate } from '../../../lib/qbAutomation/vendorMappingResolver';
import { buildUmbrellaVendorSet, getEffectiveMatchedInvoiceIds, isUmbrellaEvent, isUmbrellaVendor } from '../../../lib/qbAutomation/umbrella';

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
  shareSource: 'convera_link' | 'invoice_total';
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
}

export interface NeedsMappingRow {
  eventId: number;
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
  candidates: Candidate[];
}

export interface PushedTodayRow {
  eventId: number;
  contractorName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  monthKey: string;
  monthLabel: string;
  qbVendorName: string;
  billTxnId: string | null;
  billPmtTxnId: string | null;
  checkTxnId: string | null;
  postedSource: string | null;
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

export function derivePushedTodayRows(
  events: QbIngestEvent[],
  invoicesById: Map<number, Invoice>,
  vendorsById: Map<string, QbVendorRow>,
  now: Date = new Date(),
): PushedTodayRow[] {
  const today = todayLocalDateKey(now);
  const rows: PushedTodayRow[] = [];
  for (const e of events) {
    if (e.status !== 'posted') continue;
    if (!e.statusUpdatedAt) continue;
    if (localDateKeyOfIso(e.statusUpdatedAt) !== today) continue;

    const invoice = e.matchedInvoiceIds.length > 0
      ? (invoicesById.get(e.matchedInvoiceIds[0]) ?? null)
      : null;
    const monthKey = invoice?.periodEnd?.slice(0, 7) ?? '';
    const qbVendorName = e.counterpartyQbVendorListId
      ? (vendorsById.get(e.counterpartyQbVendorListId)?.name ?? '(unmapped)')
      : '(unmapped)';
    const refs = (e.postedQbRefs ?? {}) as Record<string, unknown>;
    const billTxnId = (typeof refs.bill === 'string' ? refs.bill : null)
      ?? e.resolvedBillTxnId
      ?? null;
    const billPmtTxnId = typeof refs.bill_pmt === 'string' ? refs.bill_pmt : null;
    const checkTxnId = typeof refs.check === 'string' ? refs.check : null;
    const postedSource = typeof refs.posted_source === 'string' ? refs.posted_source : null;

    rows.push({
      eventId: e.id,
      contractorName: invoice?.userName || e.counterpartyRaw || '(unknown)',
      invoiceNumber: invoice?.invoiceNumber ?? '',
      amount: e.amount,
      currency: invoice?.currency || 'USD',
      monthKey,
      monthLabel: monthLabelFromKey(monthKey),
      qbVendorName,
      billTxnId,
      billPmtTxnId,
      checkTxnId,
      postedSource,
      statusUpdatedAt: e.statusUpdatedAt,
    });
  }
  rows.sort((a, b) => (b.statusUpdatedAt || '').localeCompare(a.statusUpdatedAt || ''));
  return rows;
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
}: UseQbAutomationV2Args) {
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const vendorsById = useMemo(() => new Map(vendors.map(v => [v.listId, v])), [vendors]);
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

  const umbrellaVendors = useMemo(
    () => buildUmbrellaVendorSet(mappings.map(m => ({ qbVendorListId: m.qbVendorListId, ppId: m.ppId }))),
    [mappings],
  );

  const allReadyRows: ReadyRow[] = useMemo(() => {
    const rows: ReadyRow[] = [];
    const invoiceIdsCoveredByEvents = new Set<number>();

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

        const verdict = computeVerdict(
          { kind: e.targetQbTxnKind, vendorListId: e.counterpartyQbVendorListId, refNumber: '', month: monthKey },
          openBills,
        );
        if (!verdict) continue;

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

    for (const inv of invoices) {
      if (inv.status !== 'approved') continue;
      if (invoiceIdsCoveredByEvents.has(inv.id)) continue;

      const ppId = inv.paymentProfile?.id ?? 0;
      if (!ppId || ppId <= 0) continue;
      const mapping = mappingByPpId.get(ppId);
      if (!mapping?.qbVendorListId) continue;
      // V9.5: skip invoice-driven "Will Create Bill" when the vendor is
      // umbrella (Teal, Faruk-covers-Ajdin). Pre-creating a bill for one slice
      // before the wire lands is semantically wrong — QB books one Bill for
      // the wire total. The row will surface as an umbrella group after the
      // Convera event arrives and gets classified.
      if (isUmbrellaVendor(mapping.qbVendorListId, umbrellaVendors)) continue;

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
      const ppLabel = inv.paymentProfile?.companyName
        || inv.paymentProfile?.bankName
        || '';
      const contractorName = inv.userName || '(unknown)';
      const contractorUserId = inv.userId ?? null;
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
        qbVendorListId: mapping.qbVendorListId,
        verdict: 'will_create_bill',
        group: 'create',
        ppId,
        ppLabel,
        ppSource: mapping.source || 'invoice',
        ppCounterpartyPattern: mapping.counterpartyPattern || ppLabel,
        candidates,
      });
    }

    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    return rows;
  }, [events, invoices, invoicesById, vendorsById, openBills, mappingByPpId, resolverVendors, historyByUser, umbrellaShares, umbrellaVendors]);

  const needsMappingRows: NeedsMappingRow[] = useMemo(() => {
    const rows: NeedsMappingRow[] = [];
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

      const monthKey = invoice?.periodEnd?.slice(0, 7) ?? '';
      const ppLabel = invoice?.paymentProfile?.companyName
        || invoice?.paymentProfile?.bankName
        || e.counterpartyRaw
        || '(no pp label)';

      const contractorName = invoice?.userName || e.counterpartyRaw || '(unknown)';
      const contractorUserId = invoice?.userId ?? null;
      const candidates = resolveVendorCandidates(
        { contractorName, contractorUserId, ppLabel },
        { vendors: resolverVendors, historyByUser },
      );

      rows.push({
        eventId: e.id,
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
        candidates,
      });
    }
    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    return rows;
  }, [events, invoices, invoicesById, resolverVendors, historyByUser]);

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

  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const readyRows = useMemo(() => allReadyRows.filter(r => !skippedKeys.has(r.rowKey)), [allReadyRows, skippedKeys]);
  const skippedRows = useMemo(() => allReadyRows.filter(r => skippedKeys.has(r.rowKey)), [allReadyRows, skippedKeys]);

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

  const skip = useCallback((rowKey: string) => {
    setSkippedKeys(prev => {
      const next = new Set(prev);
      next.add(rowKey);
      return next;
    });
    setSelectedKeys(prev => {
      if (!prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.delete(rowKey);
      return next;
    });
  }, []);

  const unskip = useCallback((rowKey: string) => {
    setSkippedKeys(prev => {
      if (!prev.has(rowKey)) return prev;
      const next = new Set(prev);
      next.delete(rowKey);
      return next;
    });
  }, []);

  const selectionTotal = useMemo(() => {
    let sum = 0;
    for (const r of readyRows) if (visibleSelectedKeys.has(r.rowKey)) sum += r.amount;
    return sum;
  }, [readyRows, visibleSelectedKeys]);

  const readyTotal = useMemo(() => readyRows.reduce((s, r) => s + r.amount, 0), [readyRows]);

  const pushedTodayRows = useMemo(
    () => derivePushedTodayRows(events, invoicesById, vendorsById),
    [events, invoicesById, vendorsById],
  );
  const pushedTodayTotal = useMemo(
    () => pushedTodayRows.reduce((s, r) => s + r.amount, 0),
    [pushedTodayRows],
  );

  return {
    readyRows,
    skippedRows,
    needsMappingRows,
    mappingRows,
    pushedTodayRows,
    pushedTodayTotal,
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
