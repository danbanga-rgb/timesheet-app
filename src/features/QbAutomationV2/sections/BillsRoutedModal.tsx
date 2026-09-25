import { useMemo } from 'react';
import { X } from 'lucide-react';
import type { QbIngestEvent } from '../../../types';
import { sourceLabel } from '../hooks/useQbAutomationV2';

interface Props {
  qbVendorListId: string;
  qbVendorName: string;
  events: QbIngestEvent[];
  onClose: () => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function extractQbRefs(refs: Record<string, unknown> | null): { bill: string; pmt: string; source: string } {
  if (!refs) return { bill: '', pmt: '', source: '' };
  const bill = String(refs.bill ?? refs.bill_txn_id ?? refs.billTxnId ?? refs.txn_id ?? '');
  const pmt = String(refs.bill_pmt ?? refs.bill_pmt_txn_id ?? refs.billPmtTxnId ?? refs.payment_txn_id ?? '');
  const source = String(refs.posted_source ?? '');
  return { bill, pmt, source };
}

export default function BillsRoutedModal({ qbVendorListId, qbVendorName, events, onClose }: Props) {
  const rows = useMemo(() => {
    // Only posted events — matches the "Bills pushed" column semantic.
    // Ignored / pending events are visible in other views.
    // Row fields come from the event itself, never from matched_invoice_ids[0]:
    // a fuzzy match can attach the wrong invoice ([[pushed-row-event-not-invoice]]).
    const matches = events.filter(e => e.counterpartyQbVendorListId === qbVendorListId && e.status === 'posted');
    return matches
      .map(e => {
        const refs = extractQbRefs(e.postedQbRefs);
        return {
          eventId: e.id,
          date: e.statusUpdatedAt || e.txnDate,
          txnDate: e.txnDate,
          paidTo: e.counterpartyRaw || '(unknown)',
          memo: e.memo ?? '',
          amount: e.amount,
          currency: 'USD',                  // event has no currency field; matches Pushed card
          source: sourceLabel(e.source),
          status: e.status,
          billTxnId: refs.bill,
          qbRefsDisplay: [refs.bill && `Bill ${refs.bill}`, refs.pmt && `Pmt ${refs.pmt}`].filter(Boolean).join(' · '),
          postedSource: refs.source,
        };
      })
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [events, qbVendorListId]);

  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  // Real duplicate signal = two posted events landing on the SAME QB Bill
  // TxnID (posted_qb_refs.bill). Invoice-number collision is often a
  // matching-data artifact (see Mek Attoh INV-000048 2026-09-23 finding
  // in [[qb-automation-v2-pivot]]) — different Bills for the same
  // invoice number just means the invoice→event matcher over-matched.
  const dupeBillTxnIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.billTxnId) continue;
      counts.set(r.billTxnId, (counts.get(r.billTxnId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, c]) => c > 1).map(([id]) => id));
  }, [rows]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-gray-800">Bills pushed to this QB vendor</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              QB Vendor: <span className="font-medium">{qbVendorName}</span>
              <span className="mx-2">·</span>
              {rows.length} posted · {fmtMoney(totalAmount)}
              {dupeBillTxnIds.size > 0 && (
                <span className="ml-2 text-red-700 font-semibold">
                  ⚠ {dupeBillTxnIds.size} QB Bill has more than one push event — likely duplicate push
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">
              No bills have been pushed to QB via this vendor yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Paid to</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Memo</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Amount</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Source</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">QB IDs</th>
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
                  const isDupe = r.billTxnId && dupeBillTxnIds.has(r.billTxnId);
                  const isFuzzy = r.postedSource === 'manual_accept_fuzzy';
                  return (
                    <tr key={r.eventId} className={isDupe ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}>
                      <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                      <td className="px-3 py-1.5 font-medium text-gray-800 whitespace-nowrap">{r.paidTo}</td>
                      <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap font-mono">
                        {r.memo || '—'}
                        {isFuzzy && <span className="ml-1 text-[10px] text-indigo-700" title="The accountant entered this bill in QuickBooks. We matched it to an invoice by vendor and amount.">fuzzy</span>}
                        {isDupe && <span className="ml-1 text-[10px] text-red-700 font-semibold">dupe</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold whitespace-nowrap">
                        {fmtMoney(r.amount)} <span className="text-gray-500 font-normal">{r.currency}</span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.source}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <span className={'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ' + statusCls}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 font-mono text-[11px]">{r.qbRefsDisplay || '—'}</td>
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
