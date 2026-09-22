import type { ReadyRow } from '../hooks/useQbAutomationV2';

interface Props {
  rows: ReadyRow[];
  selectedIds: Set<number>;
  selectionCount: number;
  selectionTotal: number;
  onToggle: (eventId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onPushSelected: () => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function verdictChip(v: ReadyRow['verdict']) {
  if (v === 'will_create_and_pay') {
    return <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded bg-emerald-100 text-emerald-800">Will Create + Pay</span>;
  }
  return <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded bg-blue-100 text-blue-800">Will Pay</span>;
}

export default function ReadyCard(props: Props) {
  const { rows, selectedIds, selectionCount, selectionTotal, onToggle, onSelectAll, onClearSelection, onPushSelected } = props;
  const allSelected = rows.length > 0 && selectionCount === rows.length;

  return (
    <div className="bg-white rounded-lg shadow-md border border-emerald-200">
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border-b border-emerald-200 rounded-t-lg">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-emerald-900">Ready to Push</h3>
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-white text-emerald-800 border border-emerald-200">
            {rows.length} {rows.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        {rows.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            {allSelected ? (
              <button onClick={onClearSelection} className="text-emerald-700 hover:text-emerald-900 font-medium">Clear</button>
            ) : (
              <button onClick={onSelectAll} className="text-emerald-700 hover:text-emerald-900 font-medium">Select All</button>
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          Nothing to push right now. Approve invoices in the Invoices tab to see them here.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(r => {
            const checked = selectedIds.has(r.eventId);
            return (
              <li key={r.eventId} className="px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(r.eventId)}
                  className="w-4 h-4 accent-emerald-600 cursor-pointer"
                  aria-label={`Select ${r.contractorName} ${r.invoiceNumber}`}
                />
                <div className="flex-1 min-w-0 text-sm">
                  <span className="font-medium text-gray-900">{r.contractorName}</span>
                  <span className="text-gray-400 mx-1.5">·</span>
                  <span className="text-gray-700">{r.invoiceNumber || '(no #)'}</span>
                  <span className="text-gray-400 mx-1.5">·</span>
                  <span className="text-gray-900 font-medium">{fmtMoney(r.amount)}</span>
                  <span className="text-gray-400 mx-1.5">·</span>
                  <span className="text-gray-600">{r.monthLabel || '(no period)'}</span>
                  <span className="text-gray-400 mx-1.5">→</span>
                  <span className={r.qbVendorName === '(unmapped)' ? 'text-amber-700 italic' : 'text-gray-800'}>{r.qbVendorName}</span>
                  {verdictChip(r.verdict)}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-end bg-gray-50 rounded-b-lg">
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
