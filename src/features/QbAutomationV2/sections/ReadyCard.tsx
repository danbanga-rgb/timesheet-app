import type { ReadyRow } from '../hooks/useQbAutomationV2';
import type { CategoryKey } from './KpiStrip';

interface Props {
  category: CategoryKey;
  rows: ReadyRow[];
  selectedIds: Set<number>;
  selectionCount: number;
  selectionTotal: number;
  onToggle: (eventId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onPushSelected: () => void;
  onSkip: (eventId: number) => void;
  onUnskip: (eventId: number) => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function verdictBadge(v: ReadyRow['verdict']) {
  if (v === 'will_create_and_pay') {
    return <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">Will Create + Pay</span>;
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
    selectedIds,
    selectionCount,
    selectionTotal,
    onToggle,
    onSelectAll,
    onClearSelection,
    onPushSelected,
    onSkip,
    onUnskip,
  } = props;

  const isSkippedView = category === 'skipped';
  const allSelected = rows.length > 0 && selectionCount === rows.length;

  const emptyMsg = isSkippedView
    ? 'No skipped rows in this session.'
    : 'Nothing to push right now. Approve invoices in the Invoices tab to see them here.';

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-800">
            {isSkippedView ? 'Skipped this session' : 'Ready to Push'}
          </h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700 border border-gray-200">
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        {!isSkippedView && rows.length > 1 && (
          <div className="flex items-center gap-3 text-xs">
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
                const isChecked = selectedIds.has(r.eventId);
                const rowCls = isSkippedView
                  ? 'text-gray-400 bg-gray-50'
                  : isChecked
                    ? 'bg-blue-50 hover:bg-blue-100'
                    : 'hover:bg-gray-50';
                return (
                  <tr key={r.eventId} className={rowCls}>
                    <td className="px-2 py-1.5 text-center">
                      {isSkippedView ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggle(r.eventId)}
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
                    <td className={'px-2 py-1.5 text-right font-mono whitespace-nowrap font-semibold'}>
                      {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {isSkippedView ? skippedBadge() : verdictBadge(r.verdict)}
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {isSkippedView ? (
                        <button onClick={() => onUnskip(r.eventId)} className="text-xs text-blue-600 hover:underline">Unskip</button>
                      ) : (
                        <button onClick={() => onSkip(r.eventId)} className="text-xs text-gray-600 hover:text-red-700 hover:underline">Skip</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isSkippedView && rows.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-end bg-gray-50">
          <button
            onClick={onPushSelected}
            disabled={selectionCount === 0}
            className={
              'px-4 py-2 text-sm font-medium rounded ' +
              (selectionCount === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700')
            }
          >
            {selectionCount === 0
              ? 'Select rows to push'
              : `Push ${selectionCount} ${selectionCount === 1 ? 'item' : 'items'} · ${fmtMoney(selectionTotal)}`}
          </button>
        </div>
      )}
    </div>
  );
}
