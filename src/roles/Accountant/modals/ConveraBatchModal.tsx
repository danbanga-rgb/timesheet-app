import { Download, AlertTriangle, X } from 'lucide-react';
import type { ConveraBeneficiary } from '../../../types';
import type { ConveraBatchGroup, ConveraBatchManualRow } from '../../../lib/convera/batchFile';
import { sanitizeIban, transliterateAscii, checkIbanLength } from '../../../lib/iban';
import CopyChip from '../../../components/CopyChip';

// Skip/excluded types kept inline (used only by this modal's props).
export type ConveraBatchSkip = {
  invoice: { id: number; userName: string; invoiceNumber: string; totalAmount: number };
  reason: 'no vendor code assigned' | 'no Convera beneficiary linked' | string;
  companyName: string;
  country: string;
  bankCountry?: string;
  bankName: string;
  bankAddress: string;
  iban: string;
  swift: string;
  accountNumber: string;
  paymentEmail: string;
  contractorEmail?: string;
  contractorName: string;
  linkedBeneficiary?: { id: number; shortName: string; fullName: string };
  suggestedBeneficiary?: { id: number; shortName: string; vendorId: string };
  suggestedVendorId?: string;
};

export type ConveraBatchExcluded = {
  invoice: { id: number; userName: string; invoiceNumber: string; totalAmount: number };
  reason: 'not approved' | 'not Convera';
};

export type ConveraBatchManualEditor = {
  open: boolean;
  search: string;
  benef: ConveraBeneficiary | null;
  amount: string;
  ref1: string;
};

export interface ConveraBatchModalProps {
  open: boolean;
  onClose: () => void;
  groups: ConveraBatchGroup[];
  combine: Record<string, boolean>;
  setCombine: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  skipped: ConveraBatchSkip[];
  excluded: ConveraBatchExcluded[];
  manualRows: ConveraBatchManualRow[];
  setManualRows: React.Dispatch<React.SetStateAction<ConveraBatchManualRow[]>>;
  manualEditor: ConveraBatchManualEditor;
  setManualEditor: React.Dispatch<React.SetStateAction<ConveraBatchManualEditor>>;
  converaBeneficiaries: ConveraBeneficiary[];
  copiedIntuitField: string | null;
  copyIntuitField: (fieldKey: string, value: string) => void;
  onDownload: () => void;
}

export default function ConveraBatchModal(props: ConveraBatchModalProps) {
  const {
    open, onClose,
    groups, combine, setCombine,
    skipped, excluded,
    manualRows, setManualRows,
    manualEditor, setManualEditor,
    converaBeneficiaries,
    copiedIntuitField, copyIntuitField,
    onDownload,
  } = props;

  if (!open) return null;

  const invoiceRowCount = groups.reduce((n, g) =>
    n + ((g.entries.length > 1 && combine[g.key]) ? 1 : g.entries.length), 0);
  const rowCount = invoiceRowCount + manualRows.length;
  const grandTotal = groups.reduce((s, g) => s + g.entries.reduce((si, e) => si + e.inv.totalAmount, 0), 0)
    + manualRows.reduce((s, r) => s + r.amount, 0);
  const skippedTotal = skipped.reduce((s, k) => s + k.invoice.totalAmount, 0);
  const excludedTotal = excluded.reduce((s, e) => s + (e.invoice.totalAmount || 0), 0);

  const handleClose = () => {
    onClose();
    setManualRows([]);
    setManualEditor({ open: false, search: '', benef: null, amount: '', ref1: '' });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Download className="w-5 h-5 text-indigo-500" /> Preview Convera Batch</h3>
            <p className="text-sm text-gray-600 mt-1"><strong>{rowCount}</strong> payment {rowCount === 1 ? 'row' : 'rows'} will be exported.</p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 overflow-auto flex-1 space-y-2.5">
          {groups.map(g => {
            const isMulti = g.entries.length > 1;
            const combined = isMulti && combine[g.key];
            const total = g.entries.reduce((s, e) => s + e.inv.totalAmount, 0);
            const mixedIbans = g.distinctIbans > 1;
            const groupBene = converaBeneficiaries.find(b => b.id.toString() === g.key);
            const forceCombine = !!groupBene?.forceCombine;
            return (
              <div key={g.key} className={`p-3 rounded-lg border ${combined ? 'bg-indigo-50 border-indigo-200' : mixedIbans ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                <div className="flex items-start gap-3">
                  {isMulti ? (
                    <label
                      className={`flex items-center gap-2 flex-shrink-0 mt-0.5 ${forceCombine ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                      title={forceCombine ? 'This umbrella beneficiary always settles as one wire' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={!!combine[g.key]}
                        disabled={forceCombine}
                        onChange={e => setCombine(prev => ({ ...prev, [g.key]: e.target.checked }))}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-medium text-indigo-700">Combine{forceCombine ? ' (locked)' : ''}</span>
                    </label>
                  ) : (
                    <div className="w-16 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold text-gray-800">{g.shortName || g.fullName}</div>
                      <div className="text-xs text-gray-500 font-mono">{g.vendorId}</div>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {combined && <>Sum: <strong>${total.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong> · Ref1: <span className="font-mono">Multiple Invoices</span></>}
                      {!combined && isMulti && <>Will split into <strong>{g.entries.length}</strong> separate rows (total <strong>${total.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong>)</>}
                      {!isMulti && <>${g.entries[0].inv.totalAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} · Ref1: <span className="font-mono">{g.entries[0].inv.invoiceNumber}</span></>}
                      {g.anyIndia && <> · <span className="text-amber-700">Ref2: PURPOSE OF FUNDS P0802</span></>}
                    </div>
                    {isMulti && mixedIbans && (
                      <div className="mt-1.5 text-xs text-amber-800 bg-amber-100/60 rounded px-2 py-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Multiple IBANs on file — enable "Combine" only if this beneficiary really settles as one payment.</div>
                    )}
                    {isMulti && (
                      <ul className="mt-2 text-xs text-gray-700 space-y-0.5 pl-3 border-l-2 border-gray-200">
                        {g.entries.map(e => {
                          const ibanTail = e.iban ? `${e.iban.slice(0, 6)}…${e.iban.slice(-4)}` : '(no IBAN)';
                          return (
                            <li key={e.inv.id} className="flex justify-between gap-2">
                              <span className="truncate">{e.inv.userName} · <span className="font-mono">{e.inv.invoiceNumber}</span></span>
                              <span className="flex items-center gap-2 flex-shrink-0">
                                <span className="font-mono text-[10px] text-gray-400">{ibanTail}</span>
                                <span className="text-gray-500">${e.inv.totalAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Manual rows — for beneficiaries paid outside the invoice flow (Monolith, Arpit one-offs, etc.) */}
          {manualRows.map(r => (
            <div key={r.id} className="p-3 rounded-lg border bg-yellow-50 border-yellow-300">
              <div className="flex items-start gap-3">
                <div className="w-16 flex-shrink-0 text-xs font-medium text-yellow-800 mt-0.5">Manual</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-semibold text-gray-800">{r.shortName}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-500 font-mono">{r.vendorId}</div>
                      <button onClick={() => setManualRows(rows => rows.filter(x => x.id !== r.id))}
                        className="text-xs text-red-500 hover:underline">Remove</button>
                    </div>
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    ${r.amount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} · Ref1: <span className="font-mono">{r.ref1}</span>
                    {r.country === 'India' && <> · <span className="text-amber-700">Ref2: PURPOSE OF FUNDS P0802</span></>}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {manualEditor.open ? (
            <div className="p-3 rounded-lg border border-yellow-300 bg-yellow-50 space-y-2">
              <div className="text-xs font-semibold text-yellow-800">Add manual row</div>
              <input type="text" value={manualEditor.search}
                onChange={e => setManualEditor(prev => ({ ...prev, search: e.target.value, benef: null }))}
                placeholder="Search beneficiary by name or vendor ID…"
                className="w-full px-2 py-1.5 border border-yellow-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400" />
              {!manualEditor.benef && manualEditor.search && (() => {
                const q = manualEditor.search.toLowerCase();
                const matches = converaBeneficiaries
                  .filter(b => (b.shortName || '').toLowerCase().includes(q)
                    || (b.beneficiaryName || '').toLowerCase().includes(q)
                    || (b.vendorId || '').toLowerCase().includes(q))
                  .filter(b => !!b.vendorId)
                  .slice(0, 8);
                if (matches.length === 0) return <div className="text-xs text-gray-500 px-1">No beneficiaries with a vendor ID match "{manualEditor.search}".</div>;
                return (
                  <div className="max-h-40 overflow-y-auto divide-y divide-yellow-100 border border-yellow-200 rounded bg-white">
                    {matches.map(b => (
                      <button key={b.id} onClick={() => setManualEditor(prev => ({ ...prev, benef: b, search: b.shortName }))}
                        className="w-full text-left px-2 py-1.5 hover:bg-yellow-50 text-xs">
                        <span className="font-medium text-gray-800">{b.shortName}</span>
                        <span className="text-gray-400 font-mono ml-2">{b.vendorId}</span>
                        <div className="text-gray-400 font-mono">{b.bankAccount}</div>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {manualEditor.benef && (() => {
                const b = manualEditor.benef;
                const isIndia = b.beneficiaryCountry === 'India';
                return (
                  <div className="text-xs bg-white border border-yellow-200 rounded px-2 py-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-800">{b.shortName}</span>
                        <span className="text-gray-400 font-mono ml-2">{b.vendorId}</span>
                      </div>
                      <button onClick={() => setManualEditor(prev => ({ ...prev, benef: null, search: '' }))}
                        className="text-xs text-gray-500 hover:underline">Change</button>
                    </div>
                    <div className="flex items-center gap-3 text-gray-500">
                      <span>Country: <span className={isIndia ? 'text-amber-700 font-medium' : 'text-gray-700'}>{b.beneficiaryCountry || '(unknown)'}</span></span>
                      <span>·</span>
                      <span>Ref2: {isIndia
                        ? <span className="text-amber-700 font-mono">PURPOSE OF FUNDS P0802 (auto)</span>
                        : <span className="text-gray-400">(none)</span>}</span>
                    </div>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input type="number" step="0.01" value={manualEditor.amount}
                    onChange={e => setManualEditor(prev => ({ ...prev, amount: e.target.value }))}
                    placeholder="Amount"
                    className="w-full pl-5 pr-2 py-1.5 border border-yellow-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400" />
                </div>
                <input type="text" value={manualEditor.ref1}
                  onChange={e => setManualEditor(prev => ({ ...prev, ref1: e.target.value }))}
                  placeholder="Invoice reference (Ref1)"
                  className="px-2 py-1.5 border border-yellow-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-yellow-400" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setManualEditor({ open: false, search: '', benef: null, amount: '', ref1: '' })}
                  className="text-xs text-gray-500 hover:underline px-2 py-1">Cancel</button>
                <button
                  disabled={!manualEditor.benef || !parseFloat(manualEditor.amount) || !manualEditor.ref1.trim()}
                  onClick={() => {
                    const b = manualEditor.benef!;
                    const amount = parseFloat(manualEditor.amount);
                    setManualRows(rows => [...rows, {
                      id: `manual-${Date.now()}`,
                      beneficiaryId: b.id,
                      shortName: b.shortName || b.beneficiaryName || '',
                      vendorId: b.vendorId || '',
                      country: b.beneficiaryCountry || '',
                      amount,
                      ref1: manualEditor.ref1.trim(),
                    }]);
                    setManualEditor({ open: false, search: '', benef: null, amount: '', ref1: '' });
                  }}
                  className="text-xs bg-yellow-500 text-white px-3 py-1 rounded hover:bg-yellow-600 disabled:bg-gray-300 disabled:cursor-not-allowed">Add row</button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <button onClick={() => setManualEditor({ open: true, search: '', benef: null, amount: '', ref1: '' })}
                className="w-full py-2 border border-dashed border-yellow-400 rounded-lg text-sm text-yellow-700 hover:bg-yellow-50 transition-colors">
                + Add manual row (for beneficiaries outside the invoice flow)
              </button>
              <p className="text-xs text-gray-500 text-center">
                Tip: for a persistent record, create a <span className="font-medium">+ Manual Invoice</span> on the Invoices tab first — it lands in the batch here automatically.
              </p>
            </div>
          )}

          {excluded.length > 0 && (() => {
            const byReason: Record<string, ConveraBatchExcluded[]> = {};
            for (const e of excluded) (byReason[e.reason] ||= []).push(e);
            return (
              <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="text-xs font-semibold text-gray-700 mb-2">
                  {excluded.length} excluded from batch — total ${excludedTotal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
                  <span className="font-normal text-gray-500 ml-1">(not approved, or not a Convera payment)</span>
                </div>
                {Object.entries(byReason).map(([reason, rows]) => (
                  <div key={reason} className="mt-1.5">
                    <div className="text-[11px] font-medium text-gray-600 uppercase tracking-wide">{reason} · {rows.length}</div>
                    <ul className="text-xs text-gray-700 mt-0.5 space-y-0.5 pl-3 border-l-2 border-gray-200">
                      {rows.map((e, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">{e.invoice.userName} · <span className="font-mono">{e.invoice.invoiceNumber}</span></span>
                          <span className="font-mono text-gray-500 flex-shrink-0">${(e.invoice.totalAmount || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })()}
          {skipped.length > 0 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {skipped.length} SKIPPED (won't be exported) — total ${skippedTotal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
              <div className="space-y-2.5">
                {skipped.map((s, i) => (
                  <div key={i} className="text-xs bg-white rounded-lg p-2.5 border border-amber-200">
                    <div className="flex justify-between items-baseline gap-2 mb-1">
                      <div className="font-semibold text-gray-800">{s.invoice.userName} · <span className="font-mono">{s.invoice.invoiceNumber}</span></div>
                      <div className="font-mono text-gray-700">${s.invoice.totalAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                    </div>

                    {s.reason === 'no vendor code assigned' && (
                      <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded">
                        <div className="text-amber-900">
                          <strong>Verify beneficiary selection.</strong> Linked to <span className="font-mono">{s.linkedBeneficiary?.shortName}</span> which has no Convera vendor code.
                        </div>
                        {s.suggestedBeneficiary ? (
                          <div className="mt-1.5 p-2 bg-emerald-50 border border-emerald-300 rounded">
                            <div className="text-emerald-900 flex items-center gap-1"><strong>Suggested match:</strong> <span className="font-mono">{s.suggestedBeneficiary.shortName}</span> · <span className="font-mono text-emerald-700">{s.suggestedBeneficiary.vendorId}</span></div>
                            <div className="text-emerald-800 mt-0.5 italic">Same beneficiary name, has a vendor code — the accountant may have picked an older record. Re-link this contractor's payment profile in the Payment Profiles tab.</div>
                          </div>
                        ) : (
                          <div className="mt-1.5 text-amber-800 italic">
                            Either assign a vendor code to <span className="font-mono">{s.linkedBeneficiary?.shortName}</span> in Convera, or verify this is the correct beneficiary.
                          </div>
                        )}
                      </div>
                    )}

                    {s.reason === 'no Convera beneficiary linked' && (() => {
                      const suggestedShort = transliterateAscii(`${(s.contractorName || '').toUpperCase()}${s.companyName ? ' ' + s.companyName.split(/\s+/).slice(0, 2).join(' ').toUpperCase() : ''}`).trim().slice(0, 40);
                      const cleanIban = sanitizeIban(s.iban || '');
                      const ibanCheck = cleanIban ? checkIbanLength(cleanIban) : null;
                      const copyChip = (fieldKey: string, display: string, copyValue?: string) => (
                        <CopyChip
                          label={display}
                          copied={copiedIntuitField === fieldKey}
                          onCopy={() => copyIntuitField(fieldKey, copyValue ?? display)}
                          size="sm"
                          monospace
                        />
                      );
                      return (
                        <div className="mt-1.5 p-2 bg-indigo-50 border border-indigo-200 rounded">
                          <div className="text-indigo-900 mb-1.5"><strong>Create Convera beneficiary with these details:</strong></div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-indigo-900 font-mono text-[11px] items-baseline">
                            <div className="flex items-baseline gap-1.5 flex-wrap"><span className="text-indigo-500 not-italic">Short Name:</span> {suggestedShort ? copyChip(`bene-short-${i}`, suggestedShort) : <span className="text-indigo-400 italic">—</span>}</div>
                            <div className="flex items-baseline gap-1.5 flex-wrap"><span className="text-indigo-500 not-italic">Long Name:</span> {s.companyName ? copyChip(`bene-long-${i}`, s.companyName) : <span className="text-indigo-400 italic">—</span>}</div>
                            <div><span className="text-indigo-500 not-italic">Country:</span> {
                              s.bankCountry ? (
                                <>
                                  {s.bankCountry}
                                  <span className="text-indigo-400 not-italic ml-1">(from IBAN)</span>
                                </>
                              ) : s.country
                                ? s.country
                                : <span className="text-indigo-400 italic">—</span>
                            }</div>
                            <div><span className="text-indigo-500 not-italic">Currency:</span> USD</div>
                            <div className="col-span-2 flex items-baseline gap-1.5 flex-wrap"><span className="text-indigo-500 not-italic">Bank:</span> {s.bankName ? copyChip(`bene-bank-${i}`, s.bankName) : <span className="text-indigo-400 italic">—</span>}</div>
                            {s.bankAddress && <div className="col-span-2 flex items-baseline gap-1.5 flex-wrap"><span className="text-indigo-500 not-italic">Bank Address:</span> {copyChip(`bene-bankaddr-${i}`, s.bankAddress)}</div>}
                            <div className="col-span-2 flex items-baseline gap-1.5 flex-wrap">
                              <span className="text-indigo-500 not-italic">IBAN:</span>
                              {cleanIban ? copyChip(`bene-iban-${i}`, cleanIban) : <span className="text-indigo-400 italic">—</span>}
                              {ibanCheck && !ibanCheck.ok && (
                                <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                                  ⚠ length {ibanCheck.actual}, expected {ibanCheck.expected} for {cleanIban.slice(0, 2)} — profile IBAN is broken, fix it before pasting
                                </span>
                              )}
                              {cleanIban && cleanIban !== (s.iban || '').trim() && (
                                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">stored value had non-alphanumeric chars — copy cleaned</span>
                              )}
                            </div>
                            {s.swift && <div className="flex items-baseline gap-1.5 flex-wrap"><span className="text-indigo-500 not-italic">SWIFT:</span> {copyChip(`bene-swift-${i}`, s.swift.trim().toUpperCase())}</div>}
                            {s.accountNumber && <div className="flex items-baseline gap-1.5 flex-wrap"><span className="text-indigo-500 not-italic">Acct#:</span> {copyChip(`bene-acct-${i}`, s.accountNumber.trim())}</div>}
                            <div className="col-span-2 flex items-baseline gap-1.5 flex-wrap">
                              <span className="text-indigo-500 not-italic">Notification Email:</span>
                              {s.paymentEmail
                                ? copyChip(`bene-email-${i}`, s.paymentEmail)
                                : s.contractorEmail ? (
                                  <>
                                    {copyChip(`bene-email-${i}`, s.contractorEmail)}
                                    <span className="text-indigo-400 not-italic">(contractor login)</span>
                                  </>
                                )
                                : <span className="text-indigo-400 italic">—</span>}
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-indigo-200 text-indigo-900 flex items-baseline gap-2 flex-wrap">
                            <strong>Vendor ID:</strong>
                            {s.suggestedVendorId ? copyChip(`bene-vid-${i}`, s.suggestedVendorId) : <span className="font-mono text-base bg-white px-2 py-0.5 rounded border border-indigo-300">SYN-XXXX</span>}
                            <div className="text-indigo-700 italic text-[11px] basis-full">Enter exactly this code in Convera's UI. If two skipped rows share the same IBAN they'll show the same suggested code (same beneficiary). If Convera says the code is taken on submit, increment by one and try again — the collision will be reconciled when we re-import beneficiaries.</div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-200 flex justify-between items-center gap-2">
          <div className="text-sm">
            <span className="text-gray-500">Total to export:</span> <strong className="text-gray-800 text-base">${grandTotal.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</strong>
            <span className="text-gray-400 ml-2">({rowCount} {rowCount === 1 ? 'row' : 'rows'})</span>
          </div>
          <div className="flex gap-2">
            <button onClick={handleClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Cancel</button>
            <button onClick={onDownload} className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm flex items-center gap-2"><Download className="w-4 h-4" /> Download CSV</button>
          </div>
        </div>
      </div>
    </div>
  );
}
