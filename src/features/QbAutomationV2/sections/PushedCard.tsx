import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import type { PushedMonthGroup, PushedRow } from '../hooks/useQbAutomationV2';

interface Props {
  byMonth: PushedMonthGroup[];
  total: number;
  count: number;
}

type SortKey = 'contractor' | 'period' | 'inv' | 'vendor' | 'total' | 'when';
type SortDir = 'asc' | 'desc';

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// posted_source taxonomy → user-facing chip. Pushed by definition only
// contains status='posted' rows. Three variants:
//  - 'push'                → Pushed (we did everything)
//  - 'push_paid_outside'   → Pushed + paid outside (we created the bill,
//                            payment came from a source we didn't push)
//  - anything else         → Manual (accountant did it in QB;
//                            includes 'qb_probe', 'manual_accept_fuzzy', null)
function sourceChip(postedSource: string | null) {
  if (postedSource === 'push') {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">Pushed</span>;
  }
  if (postedSource === 'push_paid_outside') {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200" title="We created the bill; payment came from outside our push queue">Pushed + paid outside</span>;
  }
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">Manual</span>;
}

function useSortedRows(rows: PushedRow[], sortKey: SortKey, sortDir: SortDir): PushedRow[] {
  return useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sortKey) {
        case 'contractor': return a.contractorName.localeCompare(b.contractorName) * dir;
        case 'period':     return (a.monthKey || '').localeCompare(b.monthKey || '') * dir;
        case 'inv':        return (a.invoiceNumber || '').localeCompare(b.invoiceNumber || '', undefined, { numeric: true }) * dir;
        case 'vendor':     return a.qbVendorName.localeCompare(b.qbVendorName) * dir;
        case 'total':      return (a.amount - b.amount) * dir;
        case 'when':       return (a.statusUpdatedAt || '').localeCompare(b.statusUpdatedAt || '') * dir;
      }
    });
    return copy;
  }, [rows, sortKey, sortDir]);
}

interface MonthSectionProps {
  group: PushedMonthGroup;
  isOpen: boolean;
  onToggle: () => void;
}

function MonthSection({ group, isOpen, onToggle }: MonthSectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>('when');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const sortedRows = useSortedRows(group.rows, sortKey, sortDir);
  const clickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'when' ? 'desc' : 'asc'); }
  };
  const sortArrow = (key: SortKey) => sortKey !== key ? '' : sortDir === 'asc' ? ' ▲' : ' ▼';

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
          <table className="w-full text-xs">
            <thead className="bg-gray-50/60">
              <tr>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('when')}>
                  When{sortArrow('when')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('contractor')}>
                  Contractor{sortArrow('contractor')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap cursor-pointer select-none" onClick={() => clickSort('period')}>
                  Period{sortArrow('period')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap cursor-pointer select-none" onClick={() => clickSort('inv')}>
                  Inv #{sortArrow('inv')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('vendor')}>
                  QB Vendor{sortArrow('vendor')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('total')}>
                  Total{sortArrow('total')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRows.map(r => (
                <tr key={r.eventId} className="hover:bg-emerald-50/40">
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{fmtWhen(r.statusUpdatedAt)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-medium text-gray-800">{r.contractorName}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.monthLabel || '(no period)'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-mono text-gray-600">{r.invoiceNumber || '—'}</td>
                  <td className="px-2 py-1.5">{r.qbVendorName}</td>
                  <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap font-semibold">
                    {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{sourceChip(r.postedSource)}</td>
                </tr>
              ))}
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
        <span className="text-xs text-gray-500">Session failures live in the status pane above.</span>
      </div>

      {byMonth.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Nothing has been pushed yet. Successful pushes appear here after QBWC drains.
        </div>
      ) : (
        byMonth.map(group => (
          <MonthSection
            key={group.monthKey}
            group={group}
            isOpen={expandedMonths.has(group.monthKey)}
            onToggle={() => toggleMonth(group.monthKey)}
          />
        ))
      )}
    </div>
  );
}
