import { useMemo } from 'react';
import { X } from 'lucide-react';
import type { ReadyRow } from '../hooks/useQbAutomationV2';

interface Props {
  rows: ReadyRow[];
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function verdictLabel(v: ReadyRow['verdict']): string {
  if (v === 'will_pay') return 'Will Pay';
  if (v === 'will_create_and_pay') return 'Will Create + Pay';
  return 'Will Create Bill';
}

function verdictBadgeCls(v: ReadyRow['verdict']): string {
  if (v === 'will_create_and_pay') return 'bg-emerald-100 text-emerald-800';
  if (v === 'will_create_bill') return 'bg-purple-100 text-purple-800';
  return 'bg-blue-100 text-blue-800';
}

export default function PushPreviewModal({ rows, onCancel, onConfirm, busy }: Props) {
  const groups = useMemo(() => {
    const pay = rows.filter(r => r.verdict === 'will_pay');
    const createPay = rows.filter(r => r.verdict === 'will_create_and_pay');
    const createBill = rows.filter(r => r.verdict === 'will_create_bill');
    return {
      pay: { rows: pay, total: pay.reduce((s, r) => s + r.amount, 0) },
      createPay: { rows: createPay, total: createPay.reduce((s, r) => s + r.amount, 0) },
      createBill: { rows: createBill, total: createBill.reduce((s, r) => s + r.amount, 0) },
    };
  }, [rows]);

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-gray-800">Push Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {rows.length} {rows.length === 1 ? 'item' : 'items'} · {fmtMoney(grandTotal)} — review before pushing to QuickBooks
            </p>
          </div>
          <button onClick={onCancel} disabled={busy} className="text-gray-500 hover:text-gray-800 disabled:opacity-40" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-3 gap-3 text-xs">
          <div className="rounded border border-blue-200 bg-blue-50 p-2">
            <div className="uppercase font-semibold text-blue-700">Will Pay</div>
            <div className="text-lg font-bold text-blue-900">{groups.pay.rows.length}</div>
            <div className="text-blue-700">{fmtMoney(groups.pay.total)}</div>
          </div>
          <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
            <div className="uppercase font-semibold text-emerald-700">Will Create + Pay</div>
            <div className="text-lg font-bold text-emerald-900">{groups.createPay.rows.length}</div>
            <div className="text-emerald-700">{fmtMoney(groups.createPay.total)}</div>
          </div>
          <div className="rounded border border-purple-200 bg-purple-50 p-2">
            <div className="uppercase font-semibold text-purple-700">Will Create Bill</div>
            <div className="text-lg font-bold text-purple-900">{groups.createBill.rows.length}</div>
            <div className="text-purple-700">{fmtMoney(groups.createBill.total)}</div>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">Nothing selected.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Contractor</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Period</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Invoice #</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">QB Vendor</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <tr key={r.rowKey} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap">{r.contractorName}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{r.monthLabel || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{r.invoiceNumber || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-700">{r.qbVendorName}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap">
                      {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ' + verdictBadgeCls(r.verdict)}>
                        {verdictLabel(r.verdict)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || rows.length === 0}
            className={
              'px-4 py-2 text-sm font-medium rounded ' +
              (busy || rows.length === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-emerald-600 text-white hover:bg-emerald-700')
            }
          >
            {busy ? 'Pushing…' : `Push ${rows.length} to QuickBooks · ${fmtMoney(grandTotal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
