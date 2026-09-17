import { FileText, X } from 'lucide-react';
import { FileUploadCard } from '../../../components/FileUploadCard';
import type { IntuitXlsxRow } from '../../../lib/parseIntuitXlsx';

interface ImportIntuitPaymentsXlsxProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  preview: IntuitXlsxRow[] | null;
  onCancelPreview: () => void;
  importing: boolean;
  result: { inserted: number; skipped: number } | null;
  error: string;
  onParse: () => void;
  onCommit: () => void;
}

export default function ImportIntuitPaymentsXlsx({
  open,
  onClose,
  file,
  onFileChange,
  preview,
  onCancelPreview,
  importing,
  result,
  error,
  onParse,
  onCommit,
}: ImportIntuitPaymentsXlsxProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Import Intuit Payments</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <div>
            <p className="text-sm text-gray-600 mb-1">Upload the <strong>Intuit BillPay payment report</strong> (.xlsx) — the list of payments Intuit sent on your behalf. Rows land in the <strong>QB Automation Inbox</strong> for classification and push into QuickBooks.</p>
            <p className="text-xs text-gray-400 mb-4">Source: Intuit (not QuickBooks). Each row is a payment Intuit made; we don't require anything to be in QB yet.</p>
            <FileUploadCard
              file={file}
              accept=".xlsx"
              helpText="Click to select .xlsx file"
              onFileChange={onFileChange}
            />
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            {result && (
              <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                ✓ Imported <strong>{result.inserted}</strong> event{result.inserted === 1 ? '' : 's'} to the Inbox
                {result.skipped > 0 && <> · skipped <strong>{result.skipped}</strong> duplicate{result.skipped === 1 ? '' : 's'} (already ingested)</>}.
              </div>
            )}
            {preview && preview.length > 0 && (() => {
              const matched = preview.filter(r => r.matchedInvoiceIds.length > 0).length;
              const unmatched = preview.length - matched;
              return (
                <div className="mb-3">
                  <div className="text-sm text-gray-700 mb-2">
                    <strong>{preview.length}</strong> payment row{preview.length === 1 ? '' : 's'} detected · <span className="text-green-700">{matched} matched to invoices</span>{unmatched > 0 && <> · <span className="text-amber-700">{unmatched} unmatched</span></>}
                  </div>
                  <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Date</th>
                          <th className="px-2 py-1.5 text-left">Vendor</th>
                          <th className="px-2 py-1.5 text-right">Amount</th>
                          <th className="px-2 py-1.5 text-left">Memo</th>
                          <th className="px-2 py-1.5 text-left">Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((r, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1 font-mono">{r.date}</td>
                            <td className="px-2 py-1">{r.name}</td>
                            <td className="px-2 py-1 text-right font-mono">${r.amount.toFixed(2)}</td>
                            <td className="px-2 py-1 text-gray-600 truncate max-w-xs" title={r.memo}>{r.memo || '—'}</td>
                            <td className="px-2 py-1">
                              {r.matchedInvoiceIds.length > 0
                                ? <span className="text-green-700">✓ {r.matchedInvoiceIds.length} invoice{r.matchedInvoiceIds.length === 1 ? '' : 's'}</span>
                                : r.invoiceRefs.length > 0
                                  ? <span className="text-amber-700">? {r.invoiceRefs.join(', ')} not found</span>
                                  : <span className="text-gray-400">no invoice ref</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            <div className="flex justify-end gap-2">
              {preview ? (
                <>
                  <button onClick={onCancelPreview} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                  <button onClick={onCommit} disabled={importing} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
                    {importing ? 'Importing…' : `Import ${preview.length} to Inbox`}
                  </button>
                </>
              ) : (
                <button onClick={onParse} disabled={!file} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
                  <FileText className="w-4 h-4" /> Parse & Preview
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
