import { useState, useEffect } from 'react';
import { Calendar, CheckCircle, XCircle, Edit2, Save, DollarSign, AlertTriangle, Paperclip, FileText, ExternalLink, X } from 'lucide-react';
import type { Invoice, PaymentProfile, ConveraBeneficiary, ConveraTransaction, Timesheet, Project, UserProfile } from '../../../types';
import { parseLocalDate } from '../../../lib/dates';
import { reconcileInvoiceLive } from '../../../lib/reconcileInvoice';
import { calculatePayOn } from '../../../lib/invoiceDates';

interface PeriodPreview {
  collisions: Invoice[];
  willChangeLocks: boolean;
  toUnlock: string[];
  toLock: string[];
  nextRecon: { status: string; timesheetHours: number | null; delta: number | null };
  converaMatch: ConveraTransaction | undefined;
}

export interface InvoiceDetailModalProps {
  invoice: Invoice;
  onClose: () => void;
  currentUser: UserProfile;
  users: UserProfile[];
  paymentProfiles: PaymentProfile[];
  converaBeneficiaries: ConveraBeneficiary[];
  invoices: Invoice[];
  timesheets: Timesheet[];
  projects: Project[];
  attachmentUploading: boolean;
  beneficiaryOverrideProfileId: number | null;
  setBeneficiaryOverrideProfileId: (id: number | null) => void;
  beneficiaryOverrideSearch: string;
  setBeneficiaryOverrideSearch: (v: string) => void;
  paymentMethod: (inv: Invoice) => string;
  handleInvoiceAction: (invoiceId: number, status: 'approved' | 'rejected' | 'paid', payOnDate?: string, paidDate?: string, pmOverride?: string, paymentTerms?: string) => Promise<void> | void;
  saveInvoiceEdits: (invoiceId: number, fields: { status?: 'approved' | 'rejected'; payOnDate?: string; paymentMethod?: string; paymentTerms?: string; invoiceNumber?: string }) => Promise<void> | void;
  savePeriodEdit: (inv: Invoice, newStart: string, newEnd: string, reason: string) => Promise<void> | void;
  saveValueEdit: (inv: Invoice, newHours: number, newRate: number, reason: string) => Promise<void> | void;
  applyUsdRate: (inv: Invoice, usdRate: number) => Promise<void> | void;
  previewPeriodChange: (inv: Invoice, newStart: string, newEnd: string) => PeriodPreview;
  handleAttachmentUploadForExisting: (inv: Invoice, file: File) => Promise<void>;
  deletePaymentProfile: (profileId: number, profileName?: string) => Promise<void> | void;
  loadConveraBeneficiaries: () => Promise<void> | void;
  openAttachment: (inv: Invoice) => Promise<void> | void;
  switchInvoicePaymentProfile: (invoiceId: number, newProfile: PaymentProfile) => Promise<void> | void;
  setConveraOverride: (profileId: number, beneficiaryId: number | null) => Promise<void> | void;
}

export default function InvoiceDetailModal(props: InvoiceDetailModalProps) {
  const {
    invoice: inv,
    onClose,
    currentUser,
    users,
    paymentProfiles,
    converaBeneficiaries,
    invoices,
    timesheets,
    projects,
    attachmentUploading,
    beneficiaryOverrideProfileId,
    setBeneficiaryOverrideProfileId,
    beneficiaryOverrideSearch,
    setBeneficiaryOverrideSearch,
    paymentMethod,
    handleInvoiceAction,
    saveInvoiceEdits,
    savePeriodEdit,
    saveValueEdit,
    applyUsdRate,
    previewPeriodChange,
    handleAttachmentUploadForExisting,
    deletePaymentProfile,
    loadConveraBeneficiaries,
    openAttachment,
    switchInvoicePaymentProfile,
    setConveraOverride,
  } = props;

  const [pendingPayOnDate, setPendingPayOnDate] = useState('');
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState('');
  const [pendingPaymentTerms, setPendingPaymentTerms] = useState('');
  const [pendingInvoiceNumber, setPendingInvoiceNumber] = useState('');
  const [pendingPaidDate, setPendingPaidDate] = useState('');
  const [pendingUsdRate, setPendingUsdRate] = useState('');
  const [pendingPeriodStart, setPendingPeriodStart] = useState('');
  const [pendingPeriodEnd, setPendingPeriodEnd] = useState('');
  const [pendingEditReason, setPendingEditReason] = useState('');
  const [periodEditOpen, setPeriodEditOpen] = useState(false);
  const [periodEditPreviewShown, setPeriodEditPreviewShown] = useState(false);
  const [pendingHours, setPendingHours] = useState('');
  const [pendingRate, setPendingRate] = useState('');
  const [pendingValueReason, setPendingValueReason] = useState('');
  const [valueEditOpen, setValueEditOpen] = useState(false);
  const [valueEditPreviewShown, setValueEditPreviewShown] = useState(false);

  // Reset all "pending" form state when switching invoices to prevent leak between modals
  // (e.g. seeing "Intuit" on Rumiya because they just saved Intuit for Mek).
  useEffect(() => {
    setPendingPaymentMethod('');
    setPendingPayOnDate('');
    setPendingPaidDate('');
    setPendingUsdRate('');
    setPendingInvoiceNumber('');
    const profileTerms = users.find(u => u.id === inv.userId)?.paymentTerms || '';
    const terms = inv.paymentTerms || profileTerms;
    setPendingPaymentTerms(terms);
    if (terms && !inv.payOnDate) {
      setPendingPayOnDate(calculatePayOn(inv.periodEnd, terms));
    }
  }, [inv.id]);

  const project = projects.find(p => p.id === inv.projectId);
  const sym = ({ USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' } as Record<string, string>)[inv.currency] || '$';
  const recon = reconcileInvoiceLive(inv, timesheets);
  const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-start z-10">
          <div>
            <h2 className="text-xl font-bold text-gray-800 font-mono">{inv.invoiceNumber}</h2>
            <p className="text-gray-600 text-sm">{inv.userName} · {parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
            {project && <span className="text-sm text-indigo-600 font-medium">{project.name} ({project.code})</span>}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Period</div><div className="font-medium">{parseLocalDate(inv.periodStart).toLocaleDateString()} – {parseLocalDate(inv.periodEnd).toLocaleDateString()}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Rate</div><div className="font-medium">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)} / hour (${inv.currency})` : `— (${inv.currency})`}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Total Hours</div><div className="font-medium">{inv.totalHours != null ? inv.totalHours.toFixed(2) : recon.timesheetHours != null ? <span>{recon.timesheetHours.toFixed(2)} <span className="text-xs text-gray-400 font-normal">from TS</span></span> : '—'}</div></div>
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Submitted</div><div className="font-medium">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : '—'}</div></div>
            {inv.payOnDate && (
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><div className="text-blue-500 mb-0.5">Pay On Date</div><div className="font-medium text-blue-800">{parseLocalDate(inv.payOnDate!).toLocaleDateString()}</div></div>
            )}
            {inv.paidDate && (
              <div className="bg-green-50 rounded-lg p-3 border border-green-200"><div className="text-green-600 mb-0.5">Paid Date</div><div className="font-medium text-green-800">{parseLocalDate(inv.paidDate!).toLocaleDateString()}</div></div>
            )}
            {inv.paymentProfile && (() => {
              const pm = paymentMethod(inv);
              const border = pm === 'Intuit' ? 'bg-green-50 border-green-200' : pm === 'Convera' ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-300';
              const labelClr = pm === 'Intuit' ? 'text-green-600' : pm === 'Convera' ? 'text-purple-600' : 'text-gray-500';
              const valueClr = pm === 'Intuit' ? 'text-green-800' : pm === 'Convera' ? 'text-purple-800' : 'text-gray-600';
              return (
                <div className={`rounded-lg p-3 border col-span-2 ${border}`}>
                  <div className={`mb-0.5 text-xs ${labelClr}`}>Payment Method</div>
                  <div className={`font-bold text-lg ${valueClr}`}>{pm || 'Unassigned'}</div>
                </div>
              );
            })()}
          </div>
          <table className="w-full text-sm border-collapse mb-5">
            <thead className="bg-indigo-600 text-white">
              <tr>
                <th className="px-4 py-2 text-left border border-indigo-700">Week Ending</th>
                <th className="px-4 py-2 text-center border border-indigo-700">Hours</th>
                <th className="px-4 py-2 text-center border border-indigo-700">Rate</th>
                <th className="px-4 py-2 text-right border border-indigo-700">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((line, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2 border border-gray-200">W/E {parseLocalDate(line.weekEndingFri || inv.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-4 py-2 border border-gray-200 text-center">{line.hours?.toFixed(2) ?? '—'}</td>
                  <td className="px-4 py-2 border border-gray-200 text-center text-gray-500">{line.rate != null ? `${sym}${line.rate.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-2 border border-gray-200 text-right font-medium">{sym}{line.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-indigo-600 text-white font-bold">
              <tr>
                <td className="px-4 py-3 border border-indigo-700">Total</td>
                <td className="px-4 py-3 border border-indigo-700 text-center">{inv.totalHours != null ? `${inv.totalHours.toFixed(2)} hrs` : '—'}</td>
                <td className="px-4 py-3 border border-indigo-700"></td>
                <td className="px-4 py-3 border border-indigo-700 text-right text-lg">{sym}{inv.totalAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          {(() => {
            const contractorProfiles = paymentProfiles.filter(p => p.userId === inv.userId);
            const selectedId = inv.paymentProfile?.id ?? 0;
            const snapshotMissingFromList = inv.paymentProfile && !contractorProfiles.find(p => p.id === selectedId);
            const accent = inv.paymentProfile ? 'green' : 'amber';
            const headerText = inv.paymentProfile
              ? `💳 Payment Details — ${inv.paymentProfile.profileName}`
              : (contractorProfiles.length > 0 ? '⚠ No payment profile attached — pick one' : '⚠ No payment profile and no saved options for this contractor');
            return (
              <div className={`mb-5 border border-${accent}-200 rounded-lg overflow-hidden`}>
                <div className={`bg-${accent}-50 px-4 py-2 border-b border-${accent}-200`}>
                  <span className={`font-semibold text-${accent}-800 text-sm`}>{headerText}</span>
                </div>
                {contractorProfiles.length > 0 && (
                  <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center gap-2">
                    <label className="text-xs text-gray-600 whitespace-nowrap">Profile:</label>
                    <select
                      value={selectedId || ''}
                      onChange={e => {
                        const p = contractorProfiles.find(pp => pp.id === Number(e.target.value));
                        if (p) switchInvoicePaymentProfile(inv.id, p);
                      }}
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                    >
                      {!inv.paymentProfile && <option value="">— pick a profile —</option>}
                      {snapshotMissingFromList && inv.paymentProfile && (
                        <option value={selectedId}>(detached) {inv.paymentProfile.profileName}{inv.paymentProfile.iban ? ` · ···${inv.paymentProfile.iban.slice(-6)}` : ''}</option>
                      )}
                      {contractorProfiles.map(p => (
                        <option key={p.id} value={p.id}>{p.profileName}{p.iban ? ` · ···${p.iban.slice(-6)}` : ''}</option>
                      ))}
                    </select>
                    {inv.paymentProfile && contractorProfiles.find(p => p.id === selectedId) && (
                      <button
                        onClick={() => deletePaymentProfile(selectedId, inv.paymentProfile!.profileName)}
                        className="text-xs px-2 py-1.5 border border-red-300 text-red-600 rounded hover:bg-red-50 whitespace-nowrap"
                        title="Delete this payment profile from the contractor's list"
                      >Delete</button>
                    )}
                  </div>
                )}
                {inv.paymentProfile && (
                  <>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                    {[['Company Name', inv.paymentProfile.companyName],['Company Address', inv.paymentProfile.companyAddress],['Country', inv.paymentProfile.country],['Bank Name', inv.paymentProfile.bankName],['Bank Address', inv.paymentProfile.bankAddress],['Bank Branch', inv.paymentProfile.bankBranch],['Account Number', inv.paymentProfile.accountNumber],['IBAN', inv.paymentProfile.iban],['SWIFT / BIC', inv.paymentProfile.swift],['Payment Email', inv.paymentProfile.paymentEmail]].filter(([,v]) => v).map(([label, value]) => (
                      <div key={label as string}><span className="text-gray-500">{label}: </span><span className="font-medium text-gray-800 font-mono">{value}</span></div>
                    ))}
                  </div>
                  {(() => {
                    const profile = paymentProfiles.find(p => p.id === inv.paymentProfile?.id);
                    if (!profile) return null;
                    const benef = converaBeneficiaries.find(b => b.id === profile.converaBeneficiaryId);
                    return (
                      <div className="px-4 pb-4">
                        <div className="mt-3 pt-3 border-t border-gray-100">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium text-gray-500 mb-0.5">Convera Beneficiary</p>
                              {benef ? (
                                <div>
                                  <p className="text-sm font-medium text-gray-800">{benef.shortName}</p>
                                  <p className="text-xs text-gray-500">{benef.beneficiaryName}</p>
                                  {profile.converaMatchOverride && <span className="text-xs text-amber-600">&#9889; Manual override</span>}
                                </div>
                              ) : (
                                <p className="text-sm text-amber-600">Not matched</p>
                              )}
                            </div>
                            <button
                              onClick={() => { setBeneficiaryOverrideProfileId(profile.id); loadConveraBeneficiaries(); }}
                              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
                            >Change</button>
                          </div>
                          {beneficiaryOverrideProfileId === profile.id && (
                            <div className="mt-2 border border-indigo-200 rounded-lg p-2 bg-indigo-50">
                              <input
                                type="text" value={beneficiaryOverrideSearch}
                                onChange={e => setBeneficiaryOverrideSearch(e.target.value)}
                                placeholder="Search beneficiary..." autoFocus
                                className="w-full px-2 py-1 border border-indigo-200 rounded text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                              />
                              <div className="max-h-36 overflow-y-auto divide-y divide-indigo-100">
                                {converaBeneficiaries
                                  .filter(b => !beneficiaryOverrideSearch || b.shortName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()) || b.beneficiaryName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()))
                                  .sort((a, b) => (a.vendorId ? 0 : 1) - (b.vendorId ? 0 : 1))
                                  .slice(0, 15)
                                  .map(b => {
                                    const hasVendorCode = !!(b.vendorId && b.vendorId.trim());
                                    return (
                                    <button key={b.id} onClick={() => setConveraOverride(profile.id, b.id)}
                                      className={`w-full text-left px-2 py-1 hover:bg-indigo-100 text-xs ${hasVendorCode ? '' : 'opacity-60'}`}>
                                      <span className={`font-mono mr-2 ${hasVendorCode ? 'text-indigo-600' : 'text-gray-500'}`}>{b.shortName}</span>
                                      <span className="text-gray-500">{b.bankAccount}</span>
                                      {!hasVendorCode && <span className="ml-2 text-[10px] text-amber-600 font-medium">(no Convera code)</span>}
                                    </button>);
                                  })}
                              </div>
                              <div className="flex gap-2 mt-1">
                                {benef && <button onClick={() => setConveraOverride(profile.id, null)} className="text-xs text-red-500 hover:underline">Clear match</button>}
                                <button onClick={() => { setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); }} className="text-xs text-gray-500 hover:underline ml-auto">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  </>
                )}
              </div>
            );
          })()}
          {inv.notes && <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 mb-4"><span className="font-medium">Notes: </span>{inv.notes}</div>}
          {inv.reviewedBy && <p className="text-sm text-gray-500 mb-4">Reviewed by {inv.reviewedBy} on {inv.reviewedAt ? new Date(inv.reviewedAt).toLocaleDateString() : '—'}</p>}

          {/* USD rate override — only for non-USD imported invoices */}
          {inv.source === 'imported' && inv.currency !== 'USD' && (() => {
            const historicalRate = invoices
              .filter(i => i.userId === inv.userId && i.currency === 'USD' && (i.rate ?? 0) > 0 && i.id !== inv.id)
              .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0]?.rate ?? null;
            const rateVal = parseFloat(pendingUsdRate);
            const previewAmt = rateVal > 0 ? Math.round((inv.totalHours ?? 0) * rateVal * 100) / 100 : null;
            return (
              <div className="mb-5 border border-amber-200 rounded-lg overflow-hidden">
                <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-200">
                  <span className="font-semibold text-amber-800 text-sm">⚠ Invoice extracted in {inv.currency} — set USD rate to approve</span>
                </div>
                <div className="p-4 space-y-2">
                  <p className="text-sm text-gray-600">
                    Parsed rate: {inv.currency === 'EUR' ? '€' : inv.currency}{inv.rate?.toFixed(2) ?? '—'}/hr.
                    {historicalRate != null && <span className="ml-1 text-gray-500">Last known USD rate for this contractor: <strong>${historicalRate.toFixed(2)}/hr</strong>.</span>}
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-sm text-gray-600">USD Rate:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-gray-500">$</span>
                      <input type="number" step="0.01" min="0"
                        placeholder={historicalRate != null ? String(historicalRate) : 'e.g. 40.00'}
                        value={pendingUsdRate}
                        onChange={e => setPendingUsdRate(e.target.value)}
                        className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-400"
                      />
                      <span className="text-sm text-gray-500">/hr</span>
                    </div>
                    {previewAmt != null && <span className="text-sm font-medium text-gray-700">→ ${previewAmt.toFixed(2)} total</span>}
                    <button
                      disabled={!(rateVal > 0)}
                      onClick={async () => { await applyUsdRate(inv, rateVal); setPendingUsdRate(''); }}
                      className="px-3 py-1.5 bg-amber-500 text-white rounded text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
                    >Apply USD Rate</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* PDF Attachment — accountant view (read-only open) */}
          <div className="mb-5 border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
              <Paperclip className="w-4 h-4 text-gray-500" />
              <span className="font-semibold text-gray-700 text-sm">Attachment</span>
            </div>
            <div className="p-4">
              {inv.attachmentPath ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                    <span className="text-sm text-gray-700 truncate">Inv# {inv.invoiceNumber}.{inv.attachmentPath!.split('.').pop()}</span>
                  </div>
                  <button onClick={() => openAttachment(inv)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium flex-shrink-0">
                    <ExternalLink className="w-3.5 h-3.5" /> Open PDF
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-400 mb-2">No attachment on file.</p>
                  <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 border border-dashed border-gray-300 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition-colors w-fit">
                    <Paperclip className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600">{attachmentUploading ? 'Uploading…' : 'Upload PDF / DOCX'}</span>
                    <input type="file" accept=".pdf,.doc,.docx,.msg" className="hidden"
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (file) await handleAttachmentUploadForExisting(inv, file);
                        e.target.value = '';
                      }} />
                  </label>
                </div>
              )}
            </div>
          </div>
          {/* ── Edit invoice period (accountant override) ── */}
          {currentUser?.role === 'accountant' && inv.status !== 'paid' && (
            <div className="mb-5 border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => {
                  const opening = !periodEditOpen;
                  setPeriodEditOpen(opening);
                  if (opening) {
                    setPendingPeriodStart(inv.periodStart);
                    setPendingPeriodEnd(inv.periodEnd);
                    setPendingEditReason('');
                    setPeriodEditPreviewShown(false);
                  }
                }}
                className="w-full px-4 py-2.5 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-sm"
              >
                <span className="font-semibold text-gray-700 flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit invoice period</span>
                <span className="text-xs text-gray-500">{periodEditOpen ? 'Hide' : `Current: ${inv.periodStart} → ${inv.periodEnd}`}</span>
              </button>
              {periodEditOpen && (() => {
                const newStart = pendingPeriodStart || inv.periodStart;
                const newEnd = pendingPeriodEnd || inv.periodEnd;
                const changed = newStart !== inv.periodStart || newEnd !== inv.periodEnd;
                const preview = changed ? previewPeriodChange(inv, newStart, newEnd) : null;
                const reconLabel = { matched: '✓ matched', mismatch: '⚠ mismatch', unverifiable: '· unverifiable' } as Record<string, string>;
                return (
                  <div className="p-4 space-y-3 bg-white">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Period Start</label>
                        <input type="date" value={newStart} onChange={e => { setPendingPeriodStart(e.target.value); setPeriodEditPreviewShown(false); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Period End</label>
                        <input type="date" value={newEnd} onChange={e => { setPendingPeriodEnd(e.target.value); setPeriodEditPreviewShown(false); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reason for change <span className="text-red-500">*</span></label>
                      <textarea
                        value={pendingEditReason}
                        onChange={e => setPendingEditReason(e.target.value)}
                        rows={2}
                        placeholder="e.g. Parser assigned July but the invoice covers June — confirmed with contractor"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                    </div>
                    {changed && preview && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
                        <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Preview of changes</div>
                        <div>Period will move from <span className="font-mono">{inv.periodStart} → {inv.periodEnd}</span> to <span className="font-mono">{newStart} → {newEnd}</span>.</div>
                        {preview.collisions.length > 0 && (
                          <div className="text-red-700">
                            ⚠ Overlaps with {preview.collisions.length} other invoice{preview.collisions.length > 1 ? 's' : ''} for {inv.userName}: {preview.collisions.map(c => `${c.invoiceNumber} (${c.status}, ${c.periodStart}→${c.periodEnd})`).join('; ')}. Both will coexist unless you reject one.
                          </div>
                        )}
                        {preview.willChangeLocks && (preview.toUnlock.length > 0 || preview.toLock.length > 0) && (
                          <div>
                            Timesheet locks: {preview.toUnlock.length} day{preview.toUnlock.length === 1 ? '' : 's'} will be <strong>unlocked</strong>{preview.toUnlock.length ? ` (${preview.toUnlock[0]}${preview.toUnlock.length > 1 ? ` … ${preview.toUnlock[preview.toUnlock.length - 1]}` : ''})` : ''}; {preview.toLock.length} day{preview.toLock.length === 1 ? '' : 's'} will be <strong>locked</strong>{preview.toLock.length ? ` (${preview.toLock[0]}${preview.toLock.length > 1 ? ` … ${preview.toLock[preview.toLock.length - 1]}` : ''})` : ''}.
                          </div>
                        )}
                        <div>
                          Reconciliation will become <strong>{reconLabel[preview.nextRecon.status] || preview.nextRecon.status}</strong>
                          {preview.nextRecon.timesheetHours != null && ` (TS ${preview.nextRecon.timesheetHours}h`}
                          {preview.nextRecon.delta != null && preview.nextRecon.delta !== 0 && `, Δ ${preview.nextRecon.delta > 0 ? '+' : ''}${preview.nextRecon.delta}h`}
                          {preview.nextRecon.timesheetHours != null && ')'}.
                        </div>
                        {preview.converaMatch && (
                          <div className="text-red-700">
                            ⚠ Matched to Convera payment (conf {preview.converaMatch.confirmationNumber || '—'}, dated {preview.converaMatch.dateOfOrder?.slice(0, 10) || '—'}). Date-fit window will change; consider unmatching if it no longer makes sense.
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPeriodEditPreviewShown(true)}
                        disabled={!changed}
                        className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >Preview</button>
                      <button
                        onClick={async () => {
                          await savePeriodEdit(inv, newStart, newEnd, pendingEditReason);
                          setPendingPeriodStart('');
                          setPendingPeriodEnd('');
                          setPendingEditReason('');
                          setPeriodEditPreviewShown(false);
                          setPeriodEditOpen(false);
                        }}
                        disabled={!changed || !pendingEditReason.trim() || !periodEditPreviewShown}
                        className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!periodEditPreviewShown ? 'Click Preview first' : !pendingEditReason.trim() ? 'Reason required' : ''}
                      >Confirm change</button>
                    </div>
                  </div>
                );
              })()}
              {(inv.editHistory || []).length > 0 && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
                  <details>
                    <summary className="text-xs font-medium text-gray-600 cursor-pointer">Edit history ({inv.editHistory.length})</summary>
                    <ul className="mt-2 space-y-1.5 text-xs text-gray-700">
                      {[...inv.editHistory].reverse().map((h, i) => {
                        const kindBadge = { period_edit: 'Period', value_edit: 'Values', guardrail: 'Guardrail', anomaly: 'Anomaly', manual_repair: 'Manual repair', auto_vendor_map: 'Auto vendor map', manual_vendor_map: 'Vendor map', other: 'Edit' }[h.kind] || 'Edit';
                        const kindColor = { period_edit: 'bg-indigo-100 text-indigo-700', value_edit: 'bg-emerald-100 text-emerald-700', guardrail: 'bg-amber-100 text-amber-700', anomaly: 'bg-rose-100 text-rose-700', manual_repair: 'bg-blue-100 text-blue-700', auto_vendor_map: 'bg-teal-100 text-teal-700', manual_vendor_map: 'bg-cyan-100 text-cyan-700', other: 'bg-gray-100 text-gray-600' }[h.kind] || 'bg-gray-100 text-gray-600';
                        const bps = (h.before as { period_start?: string })?.period_start;
                        const bpe = (h.before as { period_end?: string })?.period_end;
                        const aps = (h.after as { period_start?: string })?.period_start;
                        const ape = (h.after as { period_end?: string })?.period_end;
                        const bh  = (h.before as { total_hours?: number | null })?.total_hours;
                        const br  = (h.before as { rate?: number | null })?.rate;
                        const bt  = (h.before as { total_amount?: number })?.total_amount;
                        const ah  = (h.after  as { total_hours?: number | null })?.total_hours;
                        const ar  = (h.after  as { rate?: number | null })?.rate;
                        const at2 = (h.after  as { total_amount?: number })?.total_amount;
                        return (
                          <li key={i} className="border-l-2 border-gray-300 pl-2">
                            <div className="text-gray-500 flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${kindColor}`}>{kindBadge}</span>
                              <span>{new Date(h.at).toLocaleString()} · {h.by}</span>
                            </div>
                            {h.kind === 'period_edit' && bps && aps && (
                              <div className="font-mono">{bps}→{bpe || '?'}  ⇒  {aps}→{ape || '?'}</div>
                            )}
                            {h.kind === 'value_edit' && ah != null && (
                              <div className="font-mono">{bh ?? '—'}h @ ${br ?? '—'} = ${bt?.toFixed(2) ?? '—'}  ⇒  {ah}h @ ${ar ?? '—'} = ${at2?.toFixed(2) ?? '—'}</div>
                            )}
                            {h.reason && <div className="italic text-gray-600">{h.reason}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </div>
              )}
            </div>
          )}
          {/* ── Edit invoice values (hours / rate) — accountant override ── */}
          {currentUser?.role === 'accountant' && inv.status !== 'paid' && (
            <div className="mb-5 border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => {
                  const opening = !valueEditOpen;
                  setValueEditOpen(opening);
                  if (opening) {
                    setPendingHours(inv.totalHours != null ? String(inv.totalHours) : '');
                    setPendingRate(inv.rate != null ? String(inv.rate) : '');
                    setPendingValueReason('');
                    setValueEditPreviewShown(false);
                  }
                }}
                className="w-full px-4 py-2.5 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-sm"
              >
                <span className="font-semibold text-gray-700 flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit invoice values</span>
                <span className="text-xs text-gray-500">{valueEditOpen ? 'Hide' : `Current: ${inv.totalHours ?? '—'}h @ ${inv.rate != null ? `$${inv.rate}` : '—'} = ${sym}${inv.totalAmount.toFixed(2)}`}</span>
              </button>
              {valueEditOpen && (() => {
                if (inv.lines.length !== 1) {
                  return (
                    <div className="p-4 bg-white text-sm text-gray-700">
                      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-amber-900">Multi-line invoice ({inv.lines.length} lines) — value editing not supported.</p>
                          <p className="text-xs text-amber-800 mt-1">Editing here would silently discard the per-line breakdown that downstream QB export relies on. Reject the invoice and ask the contractor to re-submit with the corrected totals.</p>
                        </div>
                      </div>
                    </div>
                  );
                }
                const parsedHours = parseFloat(pendingHours);
                const parsedRate = parseFloat(pendingRate);
                const hoursValid = pendingHours !== '' && !isNaN(parsedHours) && parsedHours >= 0;
                const rateValid = pendingRate !== '' && !isNaN(parsedRate) && parsedRate >= 0;
                const changed = (hoursValid && parsedHours !== (inv.totalHours ?? -1)) || (rateValid && parsedRate !== (inv.rate ?? -1));
                const newTotal = hoursValid && rateValid ? Math.round(parsedHours * parsedRate * 100) / 100 : null;
                const nextInv: Invoice = { ...inv, totalHours: hoursValid ? parsedHours : inv.totalHours, rate: rateValid ? parsedRate : inv.rate };
                const nextRecon = changed && hoursValid ? reconcileInvoiceLive(nextInv, timesheets) : null;
                const reconLabel = { matched: '✓ matched', mismatch: '⚠ mismatch', unverifiable: '· unverifiable' } as Record<string, string>;
                return (
                  <div className="p-4 space-y-3 bg-white">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Hours</label>
                        <input type="number" step="0.01" min="0" value={pendingHours} onChange={e => { setPendingHours(e.target.value); setValueEditPreviewShown(false); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Rate ({inv.currency})</label>
                        <input type="number" step="0.01" min="0" value={pendingRate} onChange={e => { setPendingRate(e.target.value); setValueEditPreviewShown(false); }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reason for change <span className="text-red-500">*</span></label>
                      <textarea
                        value={pendingValueReason}
                        onChange={e => setPendingValueReason(e.target.value)}
                        rows={2}
                        placeholder="e.g. Contractor invoiced 176h but timesheet shows 152h — corrected to match TS after confirmation"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                    </div>
                    {changed && newTotal != null && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
                        <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Preview of changes</div>
                        <div>Values will move from <span className="font-mono">{inv.totalHours ?? '—'}h @ {inv.rate != null ? `$${inv.rate}` : '—'} = {sym}{inv.totalAmount.toFixed(2)}</span> to <span className="font-mono">{parsedHours}h @ ${parsedRate} = {sym}{newTotal.toFixed(2)}</span>.</div>
                        {nextRecon && (
                          <div>
                            Reconciliation will become <strong>{reconLabel[nextRecon.status] || nextRecon.status}</strong>
                            {nextRecon.timesheetHours != null && ` (TS ${nextRecon.timesheetHours}h`}
                            {nextRecon.delta != null && nextRecon.delta !== 0 && `, Δ ${nextRecon.delta > 0 ? '+' : ''}${nextRecon.delta}h`}
                            {nextRecon.timesheetHours != null && ')'}.
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setValueEditPreviewShown(true)}
                        disabled={!changed || !hoursValid || !rateValid}
                        className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >Preview</button>
                      <button
                        onClick={async () => {
                          await saveValueEdit(inv, parsedHours, parsedRate, pendingValueReason);
                          setPendingHours('');
                          setPendingRate('');
                          setPendingValueReason('');
                          setValueEditPreviewShown(false);
                          setValueEditOpen(false);
                        }}
                        disabled={!changed || !hoursValid || !rateValid || !pendingValueReason.trim() || !valueEditPreviewShown}
                        className="flex-1 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!valueEditPreviewShown ? 'Click Preview first' : !pendingValueReason.trim() ? 'Reason required' : ''}
                      >Confirm change</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {/* ── Timesheet reconciliation section ── */}
          {(() => {
            const statusBg: Record<string, string> = {
              matched:      'bg-green-50 border-green-200',
              mismatch:     'bg-red-50 border-red-200',
              unverifiable: 'bg-gray-50 border-gray-200',
            };
            const statusText: Record<string, string> = {
              matched:      'text-green-700',
              mismatch:     'text-red-700',
              unverifiable: 'text-gray-500',
            };
            const unverifiableLabel = recon.timesheetHours != null && inv.totalHours == null
              ? '— Hours from timesheets'
              : '— No timesheets found';
            const statusLabel: Record<string, string> = {
              matched:      '✓ Matched',
              mismatch:     '⚠ Mismatch',
              unverifiable: unverifiableLabel,
            };
            return (
              <div className={`mb-5 border rounded-lg overflow-hidden ${statusBg[recon.status]}`}>
                <div className={`px-4 py-2.5 border-b flex items-center justify-between ${statusBg[recon.status]}`} style={{borderColor: 'inherit'}}>
                  <span className={`font-semibold text-sm ${statusText[recon.status]}`}>
                    Timesheets · {statusLabel[recon.status]}
                  </span>
                  {recon.timesheetHours != null && (
                    <span className={`text-sm font-mono ${statusText[recon.status]}`}>
                      {inv.totalHours != null ? `Invoice ${inv.totalHours.toFixed(2)} h · TS ${recon.timesheetHours.toFixed(2)} h` : `TS ${recon.timesheetHours.toFixed(2)} h`}
                      {recon.delta != null && recon.delta !== 0 && (
                        <span className="ml-2 font-semibold">
                          ({recon.delta > 0 ? '+' : ''}{recon.delta.toFixed(2)} h)
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="p-3">
                  {recon.rows.length === 0 ? (
                    <p className="text-sm text-gray-400 py-1">
                      {inv.totalHours == null ? 'No timesheets found to derive hours from.' : `No approved or pending timesheets found for ${inv.userName} covering ${parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`}
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-200">
                          <th className="text-left pb-1.5 pr-3 font-medium">Week</th>
                          <th className="text-center pb-1.5 px-2 font-medium">Status</th>
                          <th className="text-right pb-1.5 font-medium">Hrs in Period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recon.rows.map(({ ts, hoursInPeriod, weekEnd }) => {
                          const tsStatusColors: Record<string, string> = {
                            approved: 'bg-green-100 text-green-700',
                            pending:  'bg-yellow-100 text-yellow-700',
                            rejected: 'bg-red-100 text-red-700',
                          };
                          return (
                            <tr key={ts.id} className="border-b border-gray-100 last:border-0">
                              <td className="py-1.5 pr-3 text-gray-700 font-mono text-xs">
                                {parseLocalDate(ts.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{parseLocalDate(weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tsStatusColors[ts.status] || 'bg-gray-100 text-gray-600'}`}>
                                  {ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}
                                </span>
                              </td>
                              <td className={`py-1.5 text-right font-mono font-medium ${hoursInPeriod === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                                {hoursInPeriod > 0 ? `${hoursInPeriod.toFixed(2)} h` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}

          {inv.status === 'submitted' && (
            <div className="mt-5 space-y-3">
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Number</label>
                  <input
                    type="text"
                    value={pendingInvoiceNumber !== '' ? pendingInvoiceNumber : inv.invoiceNumber}
                    onChange={e => setPendingInvoiceNumber(e.target.value)}
                    onBlur={async e => {
                      const v = e.target.value.trim();
                      if (v && v !== inv.invoiceNumber) await saveInvoiceEdits(inv.id, { invoiceNumber: v });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm bg-white font-mono"
                    placeholder="e.g. 016/26"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
                  <select
                    value={pendingPaymentTerms}
                    onChange={e => {
                      setPendingPaymentTerms(e.target.value);
                      if (e.target.value) setPendingPayOnDate(calculatePayOn(inv.periodEnd, e.target.value));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                  >
                    <option value="">— select —</option>
                    <option value="NET15">NET15</option>
                    <option value="NET30">NET30</option>
                    <option value="NET45">NET45</option>
                    <option value="NET60">NET60</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Pay On Date (optional)</label>
                  <input
                    type="date"
                    value={pendingPayOnDate}
                    onChange={e => setPendingPayOnDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                  <select
                    value={pendingPaymentMethod !== '' ? pendingPaymentMethod : paymentMethod(inv)}
                    onChange={async e => {
                      const v = e.target.value;
                      setPendingPaymentMethod(v);
                      await saveInvoiceEdits(inv.id, { paymentMethod: v });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                  >
                    <option value="" disabled>— Select —</option>
                    <option value="Intuit">Intuit</option>
                    <option value="Convera">Convera</option>
                  </select>
                </div>
              </div>
              {inv.periodStart && inv.periodEnd && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Approving will LOCK timesheets</strong> for {inv.userName} covering {inv.periodStart} → {inv.periodEnd}. After approval, {inv.userName} will not be able to edit these weeks via the portal — they'll need to email you the correction.
                  </div>
                </div>
              )}
              {(!pendingPaymentMethod && !paymentMethod(inv)) && (
                <div className="mb-3 p-3 bg-gray-100 border border-gray-300 rounded-lg text-xs text-gray-700">
                  No payment method on file for this contractor. Select Intuit or Convera above before approving.
                </div>
              )}
              <div className="flex gap-3">
                <button
                  disabled={!pendingPaymentMethod && !paymentMethod(inv)}
                  onClick={() => handleInvoiceAction(inv.id, 'approved', pendingPayOnDate || undefined, undefined, pendingPaymentMethod || paymentMethod(inv), pendingPaymentTerms || undefined)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"><CheckCircle className="w-5 h-5" /> Approve</button>
                <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium"><XCircle className="w-5 h-5" /> Reject</button>
              </div>
            </div>
          )}

          {/* ── Rejected: re-approve option ── */}
          {inv.status === 'rejected' && (
            <div className="mt-5">
              {inv.periodStart && inv.periodEnd && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div><strong>Re-approving will LOCK timesheets</strong> for {inv.userName} covering {inv.periodStart} → {inv.periodEnd}.</div>
                </div>
              )}
              <button
                onClick={() => handleInvoiceAction(inv.id, 'approved', inv.payOnDate || undefined, undefined, paymentMethod(inv), undefined)}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"
              >
                <CheckCircle className="w-5 h-5" /> Re-approve Invoice
              </button>
            </div>
          )}

          {/* ── Approved: edit approval details + separate mark-paid panel ── */}
          {inv.status === 'approved' && (() => {
            const editPayOn = pendingPayOnDate !== '' ? pendingPayOnDate : (inv.payOnDate || '');
            const editTerms = pendingPaymentTerms !== '' ? pendingPaymentTerms : (inv.paymentTerms || '');
            return (
              <div className="mt-5 space-y-4">
                {/* Edit panel */}
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                  <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit Approval Details</p>
                  <div>
                    <label className="block text-xs font-medium text-amber-700 mb-1">Invoice Number</label>
                    <input
                      type="text"
                      value={pendingInvoiceNumber !== '' ? pendingInvoiceNumber : inv.invoiceNumber}
                      onChange={e => setPendingInvoiceNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white font-mono"
                      placeholder="e.g. 016/26"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-amber-700 mb-1">Payment Terms</label>
                    <select
                      value={editTerms}
                      onChange={e => {
                        setPendingPaymentTerms(e.target.value);
                        if (e.target.value) setPendingPayOnDate(calculatePayOn(inv.periodEnd, e.target.value));
                      }}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white"
                    >
                      <option value="">— select —</option>
                      <option value="NET15">NET15</option>
                      <option value="NET30">NET30</option>
                      <option value="NET45">NET45</option>
                      <option value="NET60">NET60</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-amber-700 mb-1">Pay On Date (expected)</label>
                    <input
                      type="date"
                      value={editPayOn}
                      onChange={e => setPendingPayOnDate(e.target.value)}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-amber-700 mb-1">Payment Method</label>
                    <select
                      value={pendingPaymentMethod !== '' ? pendingPaymentMethod : paymentMethod(inv)}
                      onChange={e => setPendingPaymentMethod(e.target.value)}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white"
                    >
                      <option value="" disabled>— Select —</option>
                      <option value="Intuit">Intuit</option>
                      <option value="Convera">Convera</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        const editInvNum = pendingInvoiceNumber.trim() || inv.invoiceNumber;
                        await saveInvoiceEdits(inv.id, { payOnDate: editPayOn, paymentMethod: pendingPaymentMethod || paymentMethod(inv), paymentTerms: editTerms, invoiceNumber: editInvNum });
                        setPendingPayOnDate('');
                        setPendingPaymentMethod('');
                        setPendingPaymentTerms('');
                        setPendingInvoiceNumber('');
                        alert('Changes saved.');
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium text-sm"
                    >
                      <Save className="w-4 h-4" /> Save Changes
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm('Change this invoice back to Rejected?')) return;
                        await saveInvoiceEdits(inv.id, { status: 'rejected' });
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-sm border border-red-200"
                    >
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>

                {/* Mark as Paid panel */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                  <p className="text-sm font-semibold text-blue-800 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Mark as Paid</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-blue-600 mb-1">Pay On Date (confirm)</label>
                      <input
                        type="date"
                        value={editPayOn}
                        onChange={e => setPendingPayOnDate(e.target.value)}
                        className="w-full px-3 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-green-700 mb-1">Paid Date (actual) *</label>
                      <input
                        type="date"
                        value={pendingPaidDate}
                        onChange={e => setPendingPaidDate(e.target.value)}
                        className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-400 text-sm bg-white"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!pendingPaidDate) { alert('Please enter the actual Paid Date.'); return; }
                      handleInvoiceAction(inv.id, 'paid', editPayOn || undefined, pendingPaidDate);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                  >
                    <DollarSign className="w-4 h-4" /> Confirm Payment
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── Paid: summary only ── */}
          {inv.status === 'paid' && (inv.payOnDate || inv.paidDate) && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {inv.payOnDate && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-center gap-2">
                  <Calendar className="w-4 h-4 flex-shrink-0" />
                  <div><div className="text-xs text-blue-500">Pay On Date</div><strong>{parseLocalDate(inv.payOnDate!).toLocaleDateString()}</strong></div>
                </div>
              )}
              {inv.paidDate && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <div><div className="text-xs text-green-600">Paid Date</div><strong>{parseLocalDate(inv.paidDate!).toLocaleDateString()}</strong></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
