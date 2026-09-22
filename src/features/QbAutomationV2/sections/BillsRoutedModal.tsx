import { useMemo } from 'react';
import { X } from 'lucide-react';
import type { Invoice, QbIngestEvent } from '../../../types';

interface Props {
  qbVendorListId: string;
  qbVendorName: string;
  events: QbIngestEvent[];
  invoices: Invoice[];
  onClose: () => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function extractQbRefs(refs: Record<string, unknown> | null): string {
  if (!refs) return '';
  const bill = refs.bill_txn_id ?? refs.billTxnId ?? refs.txn_id ?? '';
  const pmt = refs.bill_pmt_txn_id ?? refs.billPmtTxnId ?? refs.payment_txn_id ?? '';
  const parts: string[] = [];
  if (bill) parts.push(`Bill ${bill}`);
  if (pmt) parts.push(`Pmt ${pmt}`);
  return parts.join(' · ');
}

export default function BillsRoutedModal({ qbVendorListId, qbVendorName, events, invoices, onClose }: Props) {
  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);

  const rows = useMemo(() => {
    const matches = events.filter(e => e.counterpartyQbVendorListId === qbVendorListId);
    return matches
      .map(e => {
        const inv = e.matchedInvoiceIds.length > 0 ? invoicesById.get(e.matchedInvoiceIds[0]) ?? null : null;
        return {
          eventId: e.id,
          date: e.statusUpdatedAt || e.txnDate,
          txnDate: e.txnDate,
          contractor: inv?.userName || e.counterpartyRaw || '(unknown)',
          invoiceNumber: inv?.invoiceNumber || '',
          amount: e.amount,
          currency: inv?.currency || 'USD',
          source: e.source,
          status: e.status,
          qbRefs: extractQbRefs(e.postedQbRefs),
        };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [events, qbVendorListId, invoicesById]);

  const postedCount = rows.filter(r => r.status === 'posted').length;
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-gray-800">Bills routed via this mapping</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              QB Vendor: <span className="font-medium">{qbVendorName}</span>
              <span className="mx-2">·</span>
              {rows.length} events ({postedCount} posted) · {fmtMoney(totalAmount)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              No events have been routed via this vendor yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Contractor</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Invoice #</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Source</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">QB Refs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => {
                  const statusCls =
                    r.status === 'posted' ? 'bg-emerald-100 text-emerald-800'
                    : r.status === 'ready' ? 'bg-blue-100 text-blue-800'
                    : r.status === 'failed' ? 'bg-red-100 text-red-800'
                    : r.status === 'ignored' ? 'bg-gray-200 text-gray-700'
                    : 'bg-gray-100 text-gray-700';
                  return (
                    <tr key={r.eventId} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap">{r.contractor}</td>
                      <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{r.invoiceNumber || '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap">
                        {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.source}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className={'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ' + statusCls}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 font-mono text-[11px]">{r.qbRefs || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-100 text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
