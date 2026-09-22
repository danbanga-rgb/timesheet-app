import type { ReadyRow } from '../hooks/useQbAutomationV2';
import type { CategoryKey } from './KpiStrip';

interface Props {
  category: CategoryKey;
  rows: ReadyRow[];
  selectedKeys: Set<string>;
  selectionCount: number;
  onToggle: (rowKey: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onSkip: (rowKey: string) => void;
  onUnskip: (rowKey: string) => void;

  // Group summary + Bill Creations opt-in
  payCount: number;
  createCount: number;
  payTotal: number;
  createTotal: number;
  allCreateSelected: boolean;
  onIncludeBillCreations: () => void;
  onExcludeBillCreations: () => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function verdictBadge(v: ReadyRow['verdict']) {
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
    onClearSelection,
    onSkip,
    onUnskip,
    payCount,
    createCount,
    payTotal,
    createTotal,
    allCreateSelected,
    onIncludeBillCreations,
    onExcludeBillCreations,
  } = props;

  const isSkippedView = category === 'skipped';
  const allSelected = rows.length > 0 && selectionCount === rows.length;

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
            {createCount > 0 && (
              allCreateSelected ? (
                <button onClick={onExcludeBillCreations} className="text-purple-700 hover:text-purple-900 font-medium">
                  Exclude Bill Creations
                </button>
              ) : (
                <button onClick={onIncludeBillCreations} className="text-purple-700 hover:text-purple-900 font-medium">
                  Include {createCount} Bill {createCount === 1 ? 'Creation' : 'Creations'}
                </button>
              )
            )}
            {allSelected ? (
              <button onClick={onClearSelection} className="text-gray-700 hover:text-gray-900 font-medium">Clear selection</button>
            ) : (
              <button onClick={onSelectAll} className="text-emerald-700 hover:text-emerald-900 font-medium">Select all</button>
            )}
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
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Contractor</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Period</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">QB Vendor</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600">Hrs</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600">Rate</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600">Total</th>
                <th className="px-2 py-2 text-left font-semibold text-gray-600">Status</th>
                <th className="px-2 py-2 text-right font-semibold text-gray-600 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const isChecked = selectedKeys.has(r.rowKey);
                const rowCls = isSkippedView
                  ? 'text-gray-400 bg-gray-50'
                  : isChecked
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : r.group === 'create'
                      ? 'bg-purple-50/40 hover:bg-purple-50'
                      : 'hover:bg-gray-50';
                return (
                  <tr key={r.rowKey} className={rowCls}>
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
                      {r.contractorName}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.monthLabel || '(no period)'}</td>
                    <td className="px-2 py-1.5">
                      <span className={r.qbVendorMapped ? '' : 'text-amber-600 italic'}>
                        {r.qbVendorName}
                      </span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
