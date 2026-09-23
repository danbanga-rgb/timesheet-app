import { useMemo, useState, Fragment } from 'react';
import { ChevronRight, ChevronDown, Users } from 'lucide-react';
import type { ReadyRow, ReadyGroup } from '../hooks/useQbAutomationV2';
import type { Verdict } from '../../../lib/qbAutomation/verdict';
import type { CategoryKey } from './KpiStrip';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import type { SaveMappingArgs } from './NeedsMappingCard';
import InlineVendorPicker from './InlineVendorPicker';

interface Props {
  category: CategoryKey;
  rows: ReadyRow[];
  selectedKeys: Set<string>;
  selectionCount: number;
  onToggle: (rowKey: string) => void;
  onSelectAll: () => void;
  onSelectGroup: (group: ReadyGroup) => void;
  onClearSelection: () => void;
  onSkip: (rowKey: string) => void;
  onUnskip: (rowKey: string) => void;
  // V8-B: inline vendor override. Reuses the pp_id-primary onSaveMapping
  // wrapper — same handler NeedsMappingCard uses.
  vendors: QbVendorRow[];
  onSaveMapping: (args: SaveMappingArgs) => Promise<void>;

  payCount: number;
  createCount: number;
  payTotal: number;
  createTotal: number;
}

type SortKey = 'contractor' | 'period' | 'vendor' | 'hrs' | 'rate' | 'total' | 'status';
type SortDir = 'asc' | 'desc';

const verdictOrder: Record<Verdict, number> = {
  will_pay: 0,
  will_create_and_pay: 1,
  will_create_bill: 2,
};

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function verdictBadge(v: Verdict) {
  if (v === 'will_create_and_pay') {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">Will Create + Pay</span>;
  }
  if (v === 'will_create_bill') {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800">Will Create Bill</span>;
  }
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-800">Will Pay</span>;
}

function skippedBadge() {
  return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-700">Skipped</span>;
}

export default function ReadyCard(props: Props) {
  const {
    category,
    rows,
    selectedKeys,
    selectionCount,
    onToggle,
    onSelectAll,
    onSelectGroup,
    onClearSelection,
    onSkip,
    onUnskip,
    vendors,
    onSaveMapping,
    payCount,
    createCount,
    payTotal,
    createTotal,
  } = props;

  const [sortKey, setSortKey] = useState<SortKey>('contractor');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());

  const toggleExpanded = (rowKey: string) => {
    setExpandedRowKeys(prev => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const isSkippedView = category === 'skipped';

  const handleSaveVendor = async (row: ReadyRow, args: { qbVendorListId: string; qbVendorName: string }) => {
    if (row.ppId <= 0) {
      alert('This row has no payment profile — cannot save mapping.');
      return;
    }
    setSavingRowKey(row.rowKey);
    try {
      await onSaveMapping({
        eventId: row.eventId ?? null,
        ppId: row.ppId,
        source: row.ppSource,
        counterpartyPattern: row.ppCounterpartyPattern,
        qbVendorListId: args.qbVendorListId,
        qbVendorName: args.qbVendorName,
      });
      setEditingRowKey(null);
    } catch (e) {
      console.error('inline saveMapping failed', e);
      alert('Failed to save mapping: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingRowKey(null);
    }
  };

  const clickSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
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
        case 'hrs':        return ((a.hours ?? -1) - (b.hours ?? -1)) * dir;
        case 'rate':       return ((a.rate ?? -1) - (b.rate ?? -1)) * dir;
        case 'total':      return (a.amount - b.amount) * dir;
        case 'status':     return (verdictOrder[a.verdict] - verdictOrder[b.verdict]) * dir;
      }
    });
    return rowsCopy;
  }, [rows, sortKey, sortDir]);

  const emptyMsg = isSkippedView
    ? 'No skipped rows in this session.'
    : 'Nothing to push right now. Approve invoices in the Invoices tab to see them here.';

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-base font-semibold text-gray-800">
            {isSkippedView ? 'Skipped this session' : 'Ready to Push'}
          </h3>
          {!isSkippedView && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-medium">
                {payCount} {payCount === 1 ? 'Payment' : 'Payments'}
                {payTotal > 0 && <span className="ml-1 text-blue-600">· {fmtMoney(payTotal)}</span>}
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200 font-medium">
                {createCount} Bill {createCount === 1 ? 'Creation' : 'Creations'}
                {createTotal > 0 && <span className="ml-1 text-purple-600">· {fmtMoney(createTotal)}</span>}
              </span>
            </div>
          )}
          {isSkippedView && (
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700 border border-gray-200">
              {rows.length} {rows.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
        {!isSkippedView && rows.length > 0 && (
          <div className="flex items-center gap-3 text-xs">
            <button onClick={onSelectAll} className="text-emerald-700 hover:text-emerald-900 font-medium">Select all</button>
            {payCount > 0 && (
              <button onClick={() => onSelectGroup('pay')} className="text-blue-700 hover:text-blue-900 font-medium">Select Payments</button>
            )}
            {createCount > 0 && (
              <button onClick={() => onSelectGroup('create')} className="text-purple-700 hover:text-purple-900 font-medium">Select Bill Creations</button>
            )}
            <button onClick={onClearSelection} disabled={selectionCount === 0} className={selectionCount === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:text-gray-900 font-medium'}>
              Clear selection
            </button>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-gray-500">{emptyMsg}</div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-2 text-center font-semibold text-gray-600 w-10">Inc</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('contractor')}>
                  Contractor{sortArrow('contractor')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap cursor-pointer select-none" onClick={() => clickSort('period')}>
                  Period{sortArrow('period')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('vendor')}>
                  QB Vendor{sortArrow('vendor')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('hrs')}>
                  Hrs{sortArrow('hrs')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('rate')}>
                  Rate{sortArrow('rate')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('total')}>
                  Total{sortArrow('total')}
                </th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 cursor-pointer select-none" onClick={() => clickSort('status')}>
                  Status{sortArrow('status')}
                </th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRows.map(r => {
                const isChecked = selectedKeys.has(r.rowKey);
                const isGroup = !!r.children && r.children.length > 0;
                const isExpanded = expandedRowKeys.has(r.rowKey);
                const rowCls = isSkippedView
                  ? 'text-gray-400 bg-gray-50'
                  : isChecked
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : isGroup
                      ? 'bg-teal-50/40 hover:bg-teal-50'
                      : r.group === 'create'
                        ? 'bg-purple-50/40 hover:bg-purple-50'
                        : 'hover:bg-gray-50';
                return (
                  <Fragment key={r.rowKey}>
                    <tr className={rowCls}>
                      <td className="px-2 py-1.5 text-center">
                        {isSkippedView ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggle(r.rowKey)}
                            className="rounded"
                            aria-label={`Select ${r.contractorName}`}
                          />
                        )}
                      </td>
                      <td className={'px-2 py-1.5 font-medium whitespace-nowrap ' + (isSkippedView ? '' : 'text-gray-800')}>
                        {isGroup ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(r.rowKey)}
                            className="inline-flex items-center gap-1 hover:text-teal-800"
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? 'Collapse contractors' : 'Expand contractors'}
                          >
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <Users className="w-3.5 h-3.5 text-teal-700" />
                            <span>{r.contractorName}</span>
                            <span className="text-[10px] font-normal text-teal-800 bg-teal-100 border border-teal-200 rounded px-1 py-0.5 ml-1">
                              {r.children!.length} contractors
                            </span>
                          </button>
                        ) : (
                          r.contractorName
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.monthLabel || '(no period)'}</td>
                      <td className="px-2 py-1.5" style={{ minWidth: 260 }}>
                        {isGroup ? (
                          <span className="text-gray-700">
                            {r.distinctVendorCount && r.distinctVendorCount > 1
                              ? <span className="text-teal-800">{r.distinctVendorCount} vendors <span className="text-[10px] text-teal-600">(expand for detail)</span></span>
                              : r.qbVendorName}
                          </span>
                        ) : editingRowKey === r.rowKey ? (
                          <InlineVendorPicker
                            initialValue={r.qbVendorMapped ? r.qbVendorName : ''}
                            vendors={vendors}
                            candidates={r.candidates}
                            saving={savingRowKey === r.rowKey}
                            onSave={args => handleSaveVendor(r, args)}
                            onCancel={() => setEditingRowKey(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={isSkippedView || r.ppId <= 0}
                            onClick={() => setEditingRowKey(r.rowKey)}
                            title={r.ppId <= 0 ? 'No payment profile — cannot re-map' : 'Click to change QB vendor mapping'}
                            className={
                              'text-left w-full px-1 py-0.5 rounded ' +
                              (r.ppId <= 0
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 cursor-pointer')
                            }
                          >
                            <span className={r.qbVendorMapped ? '' : 'text-amber-600 italic'}>
                              {r.qbVendorName}
                            </span>
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{r.hours ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{r.rate != null ? `$${r.rate}` : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap font-semibold">
                        {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {isSkippedView ? skippedBadge() : verdictBadge(r.verdict)}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {isSkippedView ? (
                          <button onClick={() => onUnskip(r.rowKey)} className="text-xs text-blue-600 hover:underline">Unskip</button>
                        ) : (
                          <button onClick={() => onSkip(r.rowKey)} className="text-xs text-gray-600 hover:text-red-700 hover:underline">Skip</button>
                        )}
                      </td>
                    </tr>
                    {isGroup && isExpanded && r.children!.map(c => (
                      <tr key={`${r.rowKey}-child-${c.invoiceId}`} className="bg-teal-50/20 text-xs text-gray-700">
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1 pl-8 whitespace-nowrap italic">{c.contractorName}</td>
                        <td className="px-2 py-1 text-gray-500 font-mono">{c.invoiceNumber}</td>
                        <td className="px-2 py-1">{c.qbVendorName}</td>
                        <td className="px-2 py-1 text-right font-mono">{c.hours ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-mono">{c.rate != null ? `$${c.rate}` : '—'}</td>
                        <td className="px-2 py-1 text-right font-mono">
                          {fmtMoney(c.share)}{' '}
                          {c.shareSource === 'invoice_total' && (
                            <span title="Share from convera_transaction_invoices not available — using invoice total as fallback" className="text-amber-600">*</span>
                          )}
                        </td>
                        <td className="px-2 py-1"></td>
                        <td className="px-2 py-1"></td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
