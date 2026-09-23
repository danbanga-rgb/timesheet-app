import { useMemo, useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import type { PushedTodayRow } from '../hooks/useQbAutomationV2';

interface Props {
  rows: PushedTodayRow[];
  total: number;
}

type SortKey = 'contractor' | 'period' | 'vendor' | 'total' | 'when';
type SortDir = 'asc' | 'desc';

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function TxnBadge({ label, txnId, cls }: { label: string; txnId: string; cls: string }) {
  const short = txnId.length > 12 ? `${txnId.slice(0, 12)}…` : txnId;
  const copy = () => { void navigator.clipboard.writeText(txnId); };
  return (
    <button
      type="button"
      onClick={copy}
      title={`${label} TxnID · click to copy full`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] border ${cls} hover:brightness-95`}
    >
      <span className="font-semibold">{label}</span>
      <span>{short}</span>
      <Copy className="w-2.5 h-2.5 opacity-60" />
    </button>
  );
}

export default function PushedTodayCard({ rows, total }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('when');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const clickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'when' ? 'desc' : 'asc'); }
  };
  const sortArrow = (key: SortKey) => sortKey !== key ? '' : sortDir === 'asc' ? ' ▲' : ' ▼';

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const rowsCopy = [...rows];
    rowsCopy.sort((a, b) => {
      switch (sortKey) {
        case 'contractor': return a.contractorName.localeCompare(b.contractorName) * dir;
        case 'period':     return (a.monthKey || '').localeCompare(b.monthKey || '') * dir;
        case 'vendor':     return a.qbVendorName.localeCompare(b.qbVendorName) * dir;
        case 'total':      return (a.amount - b.amount) * dir;
        case 'when':       return (a.statusUpdatedAt || '').localeCompare(b.statusUpdatedAt || '') * dir;
      }
    });
    return rowsCopy;
  }, [rows, sortKey, sortDir]);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <h3 className="text-base font-semibold text-gray-800">Pushed today</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            {total > 0 && <span className="ml-1">· {fmtMoney(total)}</span>}
          </span>
        </div>
        <span className="text-xs text-gray-500">Session failures live in the status pane above.</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">
          Nothing has been pushed today. Successful pushes appear here after QBWC drains.
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
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
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('vendor')}>
                  QB Vendor{sortArrow('vendor')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('total')}>
                  Total{sortArrow('total')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Actuals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRows.map(r => (
                <tr key={r.eventId} className="hover:bg-emerald-50/40">
                  <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{fmtTime(r.statusUpdatedAt)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap font-medium text-gray-800">{r.contractorName}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.monthLabel || '(no period)'}</td>
                  <td className="px-2 py-1.5">{r.qbVendorName}</td>
                  <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap font-semibold">
                    {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.billTxnId && (
                        <TxnBadge label="Bill" txnId={r.billTxnId} cls="bg-blue-50 text-blue-800 border-blue-200" />
                      )}
                      {r.billPmtTxnId && (
                        <TxnBadge label="Pmt" txnId={r.billPmtTxnId} cls="bg-emerald-50 text-emerald-800 border-emerald-200" />
                      )}
                      {r.checkTxnId && (
                        <TxnBadge label="Chk" txnId={r.checkTxnId} cls="bg-purple-50 text-purple-800 border-purple-200" />
                      )}
                      {r.postedSource && (
                        <span className="text-[10px] text-gray-500 font-mono">{r.postedSource}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
