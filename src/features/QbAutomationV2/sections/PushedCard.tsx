import { Fragment, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import type { PushedMonthGroup, PushedRow } from '../hooks/useQbAutomationV2';
import { formatActionLabel } from '../../../lib/qbAutomation/pushedRowDerivation';
import { useColumnPrefs, type OptionalColumn } from '../hooks/useColumnPrefs';
import ColumnPicker from './ColumnPicker';

interface Props {
  byMonth: PushedMonthGroup[];
  total: number;
  count: number;
}

type ExtraKey = 'billRef' | 'sourceRef';
type SortKey = 'src' | 'date' | 'counterparty' | 'vendor' | 'amount' | 'memo' | 'action' | 'when' | ExtraKey;

// V9.10: optional columns — event-side fields only (never invoice-derived,
// per the Pushed-row rule).
const EXTRA_COLUMNS: readonly OptionalColumn<ExtraKey>[] = [
  { key: 'billRef',   label: 'QB bill #' },
  { key: 'sourceRef', label: 'Bank ref' },
];
type SortDir = 'asc' | 'desc';

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact timestamp: "9/17 10:09a". Year is implicit from the month section
// header ("Sep 2026"); 12h w/ lowercase am/pm shaves the widest column ~30%.
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hr24 = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = hr24 >= 12 ? 'p' : 'a';
  const hr = hr24 % 12 || 12;
  return `${m}/${day} ${hr}:${min}${ampm}`;
}

// Normalize for the Counterparty vs QB Vendor equivalence check. Strips
// non-alphanumeric so "FLAWLESS APPS LLC" ≡ "Flawless APPS LLC" ≡ "flawless-apps-llc".
function sameEntity(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b) && a.length > 0;
}

function actionChip(row: PushedRow) {
  const label = formatActionLabel({
    resolvedAction: row.resolvedAction,
    resolvedRefLabel: row.resolvedRefLabel,
    isG75Source: row.isG75Source,
    matchProvenance: null,   // no marker; kept for the derivation input shape
  });
  if (!label) return <span className="text-gray-300">—</span>;
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200"
      title={row.billTxnId ? `QB TxnID: ${row.billTxnId}` : undefined}
    >
      {label}
    </span>
  );
}

function useSortedRows(rows: PushedRow[], sortKey: SortKey, sortDir: SortDir): PushedRow[] {
  return useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'src':          return a.src.localeCompare(b.src) * dir;
        case 'date':         return (a.date || '').localeCompare(b.date || '') * dir;
        case 'counterparty': return a.counterpartyRaw.localeCompare(b.counterpartyRaw) * dir;
        case 'vendor':       return a.qbVendorName.localeCompare(b.qbVendorName) * dir;
        case 'amount':       return (a.amount - b.amount) * dir;
        case 'memo':         return (a.memo || '').localeCompare(b.memo || '', undefined, { numeric: true }) * dir;
        case 'action':       return (a.resolvedAction || '').localeCompare(b.resolvedAction || '') * dir;
        case 'when':         return (a.statusUpdatedAt || '').localeCompare(b.statusUpdatedAt || '') * dir;
        case 'billRef':      return (a.qbBillRef || '').localeCompare(b.qbBillRef || '', undefined, { numeric: true }) * dir;
        case 'sourceRef':    return (a.sourceRef || '').localeCompare(b.sourceRef || '') * dir;
      }
    });
    return copy;
  }, [rows, sortKey, sortDir]);
}

interface MonthSectionProps {
  group: PushedMonthGroup;
  isOpen: boolean;
  onToggle: () => void;
  extras: readonly OptionalColumn<ExtraKey>[];
}

function MonthSection({ group, isOpen, onToggle, extras }: MonthSectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>('when');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const sortedRows = useSortedRows(group.rows, sortKey, sortDir);
  const clickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'when' ? 'desc' : 'asc'); }
  };
  const sortArrow = (key: SortKey) => sortKey !== key ? '' : sortDir === 'asc' ? ' ▲' : ' ▼';
  const th = (key: SortKey, label: string, extra = '') => (
    <th
      className={`px-1.5 py-1.5 text-left font-semibold text-gray-600 cursor-pointer select-none whitespace-nowrap ${extra}`}
      onClick={() => clickSort(key)}
    >
      {label}{sortArrow(key)}
    </th>
  );

  return (
    <div className="border-t border-gray-100">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-2 flex items-center justify-between text-left hover:bg-gray-50"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
          {group.monthLabel}
          <span className="text-xs font-normal text-gray-500">
            {group.rows.length} {group.rows.length === 1 ? 'row' : 'rows'} · {fmtMoney(group.total)}
          </span>
        </span>
      </button>
      {isOpen && (
        <div className="overflow-auto border-t border-gray-100">
          <table className="w-full text-[11px]">
            <thead className="bg-gray-50/60">
              <tr className="divide-x divide-gray-100">
                {th('src', 'Source')}
                {th('date', 'Date')}
                {th('counterparty', 'Paid to')}
                {th('vendor', 'QB Vendor')}
                <th className="px-1.5 py-1.5 text-right font-semibold text-gray-600 cursor-pointer select-none whitespace-nowrap" onClick={() => clickSort('amount')}>
                  Amount{sortArrow('amount')}
                </th>
                {th('memo', 'Memo')}
                {th('action', 'Action')}
                {th('when', 'Posted at')}
                {extras.map(c => <Fragment key={c.key}>{th(c.key, c.label)}</Fragment>)}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, idx) => {
                const same = sameEntity(r.counterpartyRaw, r.qbVendorName);
                return (
                  <tr key={r.eventId} className={`divide-x divide-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-emerald-50/40`}>
                    <td className="px-1.5 py-1 whitespace-nowrap">
                      <span className="inline-block px-1 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 font-medium">{r.src}</span>
                    </td>
                    <td className="px-1.5 py-1 whitespace-nowrap font-mono text-gray-600">{r.date || '—'}</td>
                    <td className="px-1.5 py-1 truncate max-w-[195px]" title={r.counterpartyRaw}>{r.counterpartyRaw}</td>
                    <td className="px-1.5 py-1 truncate max-w-[235px]" title={same ? undefined : r.qbVendorName}>
                      {same
                        ? <span className="text-[10px] italic text-emerald-600/80">same QB vendor</span>
                        : r.qbVendorName}
                    </td>
                    <td className="px-1.5 py-1 text-right font-mono whitespace-nowrap font-semibold">
                      {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                    </td>
                    <td className="px-1.5 py-1 truncate max-w-[150px] font-mono text-gray-700" title={r.memo}>{r.memo || '—'}</td>
                    <td className="px-1.5 py-1 whitespace-nowrap">{actionChip(r)}</td>
                    <td className="px-1.5 py-1 whitespace-nowrap font-mono text-gray-500">{fmtWhen(r.statusUpdatedAt)}</td>
                    {extras.map(c => {
                      const v = c.key === 'billRef' ? r.qbBillRef : r.sourceRef;
                      return (
                        <td key={c.key} className="px-1.5 py-1 truncate max-w-[160px] font-mono text-gray-600" title={v ?? undefined}>
                          {v || <span className="text-gray-300">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PushedCard({ byMonth, total, count }: Props) {
  // Current-month bucket is expanded by default; older stays collapsed.
  const defaultOpen = useMemo(() => {
    const s = new Set<string>();
    if (byMonth.length > 0) s.add(byMonth[0].monthKey);
    return s;
  }, [byMonth]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(defaultOpen);
  const columnPrefs = useColumnPrefs<ExtraKey>('pushed', EXTRA_COLUMNS);
  const extras = EXTRA_COLUMNS.filter(c => columnPrefs.isOn(c.key));
  const toggleMonth = (monthKey: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <h3 className="text-base font-semibold text-gray-800">Pushed</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
            {count} {count === 1 ? 'row' : 'rows'}
            {total > 0 && <span className="ml-1">· {fmtMoney(total)}</span>}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Failed pushes show in the status panel below.</span>
          {byMonth.length > 0 && (
            <ColumnPicker columns={EXTRA_COLUMNS} isOn={columnPrefs.isOn} onToggle={columnPrefs.toggle} onReset={columnPrefs.reset} />
          )}
        </div>
      </div>

      {byMonth.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Nothing pushed yet. Pushes show up here once QuickBooks confirms them.
        </div>
      ) : (
        byMonth.map(group => (
          <MonthSection
            key={group.monthKey}
            group={group}
            isOpen={expandedMonths.has(group.monthKey)}
            onToggle={() => toggleMonth(group.monthKey)}
            extras={extras}
          />
        ))
      )}
    </div>
  );
}
