import { useCallback, useMemo, useState } from 'react';
import type { Invoice, QbIngestEvent } from '../../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../../lib/qbStateSync/types';
import { computeVerdict, type Verdict } from '../../../lib/qbAutomation/verdict';

export interface ReadyRow {
  eventId: number;
  contractorName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  hours: number | null;
  rate: number | null;
  periodStart: string;
  periodEnd: string;
  monthKey: string;      // 'YYYY-MM'
  monthLabel: string;    // 'Sep 2026'
  qbVendorName: string;  // '(unmapped)' if vendorListId doesn't resolve
  qbVendorMapped: boolean;
  verdict: Verdict;
}

export interface UseQbAutomationV2Args {
  events: QbIngestEvent[];
  openBills: QbOpenBillRow[];
  vendors: QbVendorRow[];
  invoices: Invoice[];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabelFromKey(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  if (!y || Number.isNaN(idx) || idx < 0 || idx > 11) return key;
  return `${MONTH_NAMES[idx]} ${y}`;
}

export function useQbAutomationV2({ events, openBills, vendors, invoices }: UseQbAutomationV2Args) {
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const vendorsById = useMemo(() => new Map(vendors.map(v => [v.listId, v])), [vendors]);

  const allReadyRows: ReadyRow[] = useMemo(() => {
    const rows: ReadyRow[] = [];
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

      rows.push({
        eventId: e.id,
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
      });
    }
    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName));
    return rows;
  }, [events, invoicesById, vendorsById, openBills]);

  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const readyRows = useMemo(() => allReadyRows.filter(r => !skippedIds.has(r.eventId)), [allReadyRows, skippedIds]);
  const skippedRows = useMemo(() => allReadyRows.filter(r => skippedIds.has(r.eventId)), [allReadyRows, skippedIds]);

  const visibleSelectedIds = useMemo(() => {
    const visible = new Set(readyRows.map(r => r.eventId));
    return new Set(Array.from(selectedIds).filter(id => visible.has(id)));
  }, [readyRows, selectedIds]);

  const toggle = useCallback((eventId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(readyRows.map(r => r.eventId)));
  }, [readyRows]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const skip = useCallback((eventId: number) => {
    setSkippedIds(prev => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
    setSelectedIds(prev => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  const unskip = useCallback((eventId: number) => {
    setSkippedIds(prev => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  const selectionTotal = useMemo(() => {
    let sum = 0;
    for (const r of readyRows) if (visibleSelectedIds.has(r.eventId)) sum += r.amount;
    return sum;
  }, [readyRows, visibleSelectedIds]);

  const readyTotal = useMemo(() => readyRows.reduce((s, r) => s + r.amount, 0), [readyRows]);

  return {
    readyRows,
    skippedRows,
    selectedIds: visibleSelectedIds,
    selectionCount: visibleSelectedIds.size,
    selectionTotal,
    readyTotal,
    toggle,
    selectAll,
    clearSelection,
    skip,
    unskip,
  };
}
