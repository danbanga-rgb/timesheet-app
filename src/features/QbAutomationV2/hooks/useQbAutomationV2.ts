import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Invoice, PaymentProfile, QbIngestEvent, QbVendorMapping, UserProfile } from '../../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../../lib/qbStateSync/types';
import { computeVerdict, type Verdict } from '../../../lib/qbAutomation/verdict';
import { normalizeRef } from '../../../lib/intuit/reconcile';

export type ReadyGroup = 'pay' | 'create';

function groupForVerdict(v: Verdict): ReadyGroup {
  return v === 'will_create_bill' ? 'create' : 'pay';
}

export interface ReadyRow {
  rowKey: string;
  eventId: number | null;
  invoiceId: number | null;
  contractorName: string;
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
  verdict: Verdict;
  group: ReadyGroup;
}

export interface NeedsMappingRow {
  eventId: number;
  source: string;
  counterpartyRaw: string;
  contractorName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  monthKey: string;
  monthLabel: string;
  ppLabel: string;
  ppId: number;
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
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabelFromKey(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return key;
  return `${MONTH_NAMES[idx]} ${y}`;
}

export function useQbAutomationV2({
  events,
  openBills,
  vendors,
  invoices,
  paymentProfiles,
  users,
  mappings,
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

  const allReadyRows: ReadyRow[] = useMemo(() => {
    const rows: ReadyRow[] = [];
    const invoiceIdsCoveredByEvents = new Set<number>();

    for (const e of events) {
      if (e.status !== 'ready') continue;
      if (e.targetQbTxnKind !== 'bill_pmt' && e.targetQbTxnKind !== 'bill_add_and_pmt') continue;
      if (e.rawData?.__backfill) continue;

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

      rows.push({
        rowKey: `evt-${e.id}`,
        eventId: e.id,
        invoiceId: invoice?.id ?? null,
        contractorName: invoice?.userName || e.counterpartyRaw || '(unknown)',
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
        verdict,
        group: groupForVerdict(verdict),
      });
    }

    for (const inv of invoices) {
      if (inv.status !== 'approved') continue;
      if (invoiceIdsCoveredByEvents.has(inv.id)) continue;

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

      rows.push({
        rowKey: `inv-${inv.id}`,
        eventId: null,
        invoiceId: inv.id,
        contractorName: inv.userName || '(unknown)',
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
        verdict: 'will_create_bill',
        group: 'create',
      });
    }

    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    return rows;
  }, [events, invoices, invoicesById, vendorsById, openBills, mappingByPpId]);

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

      rows.push({
        eventId: e.id,
        source: e.source,
        counterpartyRaw: e.counterpartyRaw,
        contractorName: invoice?.userName || e.counterpartyRaw || '(unknown)',
        invoiceNumber: invoice?.invoiceNumber ?? '',
        amount: e.amount,
        currency: invoice?.currency || 'USD',
        monthKey,
        monthLabel: monthLabelFromKey(monthKey),
        ppLabel,
        ppId,
      });
    }
    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    return rows;
  }, [events, invoicesById]);

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

  const includeBillCreations = useCallback(() => {
    const createKeys = readyRows.filter(r => r.group === 'create').map(r => r.rowKey);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      createKeys.forEach(k => next.add(k));
      return next;
    });
  }, [readyRows]);

  const excludeBillCreations = useCallback(() => {
    const createKeys = new Set(readyRows.filter(r => r.group === 'create').map(r => r.rowKey));
    setSelectedKeys(prev => {
      const next = new Set(prev);
      createKeys.forEach(k => next.delete(k));
      return next;
    });
  }, [readyRows]);

  const createSelectedCount = useMemo(
    () => readyRows.filter(r => r.group === 'create' && visibleSelectedKeys.has(r.rowKey)).length,
    [readyRows, visibleSelectedKeys],
  );
  const allCreateSelected = createCount > 0 && createSelectedCount === createCount;

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

  return {
    readyRows,
    skippedRows,
    needsMappingRows,
    mappingRows,
    payCount,
    createCount,
    payTotal,
    createTotal,
    createSelectedCount,
    allCreateSelected,
    selectedKeys: visibleSelectedKeys,
    selectionCount: visibleSelectedKeys.size,
    selectionTotal,
    readyTotal,
    toggle,
    selectAll,
    clearSelection,
    includeBillCreations,
    excludeBillCreations,
    skip,
    unskip,
  };
}
