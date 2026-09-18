import { Copy, X, AlertTriangle, Printer } from 'lucide-react';
import type { Invoice } from '../../../types';
import CopyChip from '../../../components/CopyChip';

export interface IntuitBatchModalProps {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
  copiedIntuitField: string | null;
  copyIntuitField: (fieldKey: string, value: string) => void;
}

export default function IntuitBatchModal(props: IntuitBatchModalProps) {
  const { open, onClose, invoices, copiedIntuitField, copyIntuitField } = props;
  if (!open) return null;

  const totalByCurrency = invoices.reduce<Record<string, number>>((acc, inv) => {
    const cur = inv.currency || 'USD';
    acc[cur] = (acc[cur] || 0) + inv.totalAmount;
    return acc;
  }, {});
  const totalDisplay = Object.entries(totalByCurrency)
    .map(([cur, sum]) => `${cur} ${sum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(' · ');

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Copy className="w-5 h-5 text-emerald-600" /> Intuit Batch</h3>
            <p className="text-sm text-gray-600 mt-1"><strong>{invoices.length}</strong> approved unpaid Intuit invoice{invoices.length === 1 ? '' : 's'} · Total <strong>{totalDisplay}</strong></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pt-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
            Intuit Online Payment has no upload integration — enter these field-by-field into Intuit's UI. Click any <strong>Invoice #</strong> or <strong>Amount</strong> to copy that value to your clipboard. Paid status will auto-reconcile when Intuit's confirmation email is imported.
          </div>
        </div>
        <div className="p-5 overflow-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Payee (Intuit)</th>
                <th className="text-left px-3 py-2 font-medium">Invoice #</th>
                <th className="text-right px-3 py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => {
                const pp = inv.paymentProfile;
                const payee = pp?.companyName || pp?.qbVendorName || inv.userName || '';
                const payeeKey = `payee-${inv.id}`;
                const invKey = `inv-${inv.id}`;
                const amtKey = `amt-${inv.id}`;
                const payeeCopied = copiedIntuitField === payeeKey;
                const invCopied = copiedIntuitField === invKey;
                const amtCopied = copiedIntuitField === amtKey;
                const amountRaw = inv.totalAmount.toFixed(2);
                const amountDisplay = inv.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const missingPayee = !payee;
                const acctTail = pp?.accountNumber ? pp.accountNumber.replace(/\s/g, '').slice(-4) : null;
                return (
                  <tr key={inv.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 align-top">
                      {missingPayee ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700">
                          <AlertTriangle className="w-3 h-3" /> no payment profile
                        </span>
                      ) : (
                        <CopyChip
                          label={payee}
                          copied={payeeCopied}
                          onCopy={() => copyIntuitField(payeeKey, payee)}
                          title="Click to copy payee name as it should appear in Intuit"
                        />
                      )}
                      <div className="text-xs text-gray-500 mt-1 leading-tight">
                        <div>{inv.userName || '—'}</div>
                        {pp && (
                          <div className="text-gray-400">
                            {pp.profileName && pp.profileName !== payee ? pp.profileName : null}
                            {pp.profileName && pp.profileName !== payee && (pp.bankName || acctTail) ? ' · ' : ''}
                            {pp.bankName || ''}
                            {pp.bankName && acctTail ? ' ' : ''}
                            {acctTail ? `…${acctTail}` : ''}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <CopyChip
                        label={inv.invoiceNumber}
                        copied={invCopied}
                        onCopy={() => copyIntuitField(invKey, inv.invoiceNumber)}
                        monospace
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <CopyChip
                        label={`${inv.currency || 'USD'} ${amountDisplay}`}
                        copied={amtCopied}
                        onCopy={() => copyIntuitField(amtKey, amountRaw)}
                        title={`Click to copy ${amountRaw}`}
                        monospace
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                <td className="px-3 py-2 text-gray-700">Total ({invoices.length})</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-gray-800">{totalDisplay}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={onClose} className="px-4 py-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
