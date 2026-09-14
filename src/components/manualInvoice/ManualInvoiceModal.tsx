// ManualInvoiceModal — Accountant creates an invoices row (source='manual')
// for one of three cases:
//   1. Contractor who submits timesheets but not invoices (auto-fills from TS)
//   2. Payee not in timesheet system (lump-sum)
//   3. True one-off (Monolith) — lump-sum against an external_payee
//
// Slice M3 covers the lump-sum path + save. M4 wires the timesheet auto-populate.

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import PayeePicker from './PayeePicker';
import type { PayeeCandidate } from './types';
import { supabase } from '../../supabaseClient';
import { buildInvoiceLines, type InvoiceLine } from '../../lib/invoiceLines';

// Types imported/duplicated from TimesheetSystem — kept minimal so the module
// is standalone. Full Invoice/PaymentProfile shapes live in the monolith.
interface PaymentProfileLite {
  id: number;
  userId: string;
  profileName: string;
  companyName: string;
  iban: string;
  swift: string;
  bankName: string;
  qbVendorName: string | null;
  isDefault: boolean;
  paymentEmail?: string | null;
  bankAddress?: string | null;
  bankBranch?: string | null;
  companyAddress?: string | null;
  country?: string | null;
  converaBeneficiaryId?: number | null;
}

interface ConveraBeneficiaryLite {
  id: number;
  shortName: string;
  beneficiaryName: string;
  vendorId: string | null;
  bankName: string | null;
  bankAccount: string;
  currency: string;
}

interface InvoiceLite {
  id: number;
  userId: string;
  periodStart: string;
  invoiceNumber: string;
  status: string;
}

interface UserLite {
  id: string;
  name: string;
  email: string;
  role: string;
  countryCode: string | null;
  projectId: number | null;
  invoiceEnabled: boolean;
  paymentTerms: string | null;
}

interface TimesheetLite {
  id: number;
  userId: string;
  weekStart: string;                        // YYYY-MM-DD Monday
  status: string;                           // 'pending' | 'approved' | 'rejected'
  entries: Record<string, { hours: string }>;  // dateKey → { hours }
}

interface Props {
  open: boolean;
  onClose: () => void;
  users: UserLite[];
  paymentProfiles: PaymentProfileLite[];
  invoices: InvoiceLite[];
  timesheets: TimesheetLite[];
  converaBeneficiaries: ConveraBeneficiaryLite[];
  currentAccountantId: string;
  onCreated: () => void;
  paymentMethodFromProfile: (profile: PaymentProfileLite | null) => 'Intuit' | 'Convera' | '';
}

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

// Builds the canonical lines[] to write on the invoice row. When the
// accountant's total matches the timesheet sum (within a 0.02h tolerance),
// preserves the per-week breakdown so the review modal and reconciler show
// the same weekly pattern as contractor-submitted invoices. When accountant
// has overridden the total, collapses to a single line at period end.
function buildLinesForSave(args: {
  timesheetLines: InvoiceLine[];
  totalHours: number;
  rate: number;
  periodEnd: string;
}): InvoiceLine[] {
  const tsSum = args.timesheetLines.reduce((s, l) => s + (l.hours ?? 0), 0);
  if (args.timesheetLines.length > 0 && Math.abs(args.totalHours - tsSum) <= 0.02) {
    return args.timesheetLines.map(l => ({
      ...l,
      rate: args.rate,
      amount: parseFloat(((l.hours ?? 0) * args.rate).toFixed(2)),
    }));
  }
  return [{
    weekStart: args.periodEnd,
    weekEndingFri: args.periodEnd,
    hours: args.totalHours,
    rate: args.rate,
    amount: parseFloat((args.totalHours * args.rate).toFixed(2)),
  }];
}
const PAY_TERMS = ['NET15', 'NET30', 'NET45', 'NET60'] as const;

export default function ManualInvoiceModal({
  open, onClose, users, paymentProfiles, invoices, timesheets, converaBeneficiaries,
  currentAccountantId, onCreated, paymentMethodFromProfile,
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [paymentMethodOverride, setPaymentMethodOverride] = useState<'Intuit' | 'Convera' | ''>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [paymentTerms, setPaymentTerms] = useState<string>('NET30');
  // Simplified line model: single total hours + flat rate at the invoice
  // level. Weekly breakdown for timesheetuser payees is generated at save
  // time from timesheetLines with the accountant-supplied rate. If accountant
  // overrides hours away from the timesheet sum, lines collapse to one lump
  // row dated to period end. This mirrors what the contractor Invoice Approval
  // modal shows read-only, minus the per-week editing (which adds no value).
  const [totalHoursInput, setTotalHoursInput] = useState<string>('');
  const [rateInput, setRateInput] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceNumberEdited, setInvoiceNumberEdited] = useState(false);
  const [payOnDate, setPayOnDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoreDupWarning, setIgnoreDupWarning] = useState(false);

  const selectedUser = users.find(u => u.id === selectedUserId) ?? null;
  const userProfiles = paymentProfiles.filter(p => p.userId === selectedUserId);
  const selectedProfile = userProfiles.find(p => p.id === selectedProfileId) ?? userProfiles.find(p => p.isDefault) ?? userProfiles[0] ?? null;

  // Candidate list for the picker.
  const candidates = useMemo<PayeeCandidate[]>(() => {
    return users
      .filter(u => u.role !== 'admin')
      .map(u => {
        const profile = paymentProfiles.find(p => p.userId === u.id && p.isDefault)
          ?? paymentProfiles.find(p => p.userId === u.id)
          ?? null;
        const method = paymentMethodFromProfile(profile);
        const section: PayeeCandidate['section'] =
          u.role === 'external_payee' ? 'one-off'
          : (u.role === 'timesheetuser' && !u.invoiceEnabled) ? 'contractor-no-invoice'
          : 'other';
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          section,
          hasDefaultProfile: profile !== null,
          defaultPaymentMethod: method || null,
          currency: null,
          countryCode: u.countryCode,
        };
      });
  }, [users, paymentProfiles, paymentMethodFromProfile]);

  // Period computed from month/year selection.
  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Slice M4 — timesheet auto-populate. Reuses the canonical buildInvoiceLines
  // (extracted from TimesheetSystem.buildInvoiceLines) so partial-week
  // splitting matches contractor-submitted invoices exactly. A week spanning
  // Jul 27–Aug 2 contributes only its Aug 1–2 day-cells to an Aug 2026 invoice.
  const timesheetLines = useMemo<InvoiceLine[]>(() => {
    if (!selectedUser || selectedUser.role !== 'timesheetuser') return [];
    return buildInvoiceLines(timesheets, selectedUser.id, periodStart, periodEnd, 0);
  }, [selectedUser, timesheets, periodStart, periodEnd]);

  const [defaultPayRate, setDefaultPayRate] = useState<number | null>(null);

  // Fetch the payee's current pay rate from rate_history when they change.
  useEffect(() => {
    if (!selectedUser) { setDefaultPayRate(null); return; }
    let cancelled = false;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('rate_history')
        .select('rate')
        .eq('user_id', selectedUser.id)
        .eq('rate_kind', 'pay')
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gt.${today}`)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setDefaultPayRate((data?.rate as number | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [selectedUser]);

  // Timesheet-based total for variance calculation.
  const timesheetTotalHours = useMemo(
    () => timesheetLines.reduce((s, l) => s + (l.hours ?? 0), 0),
    [timesheetLines],
  );

  // Reset dependent state when payee changes. Prefill hours from TS sum,
  // rate from rate_history.
  useEffect(() => {
    if (!selectedUser) return;
    setSelectedProfileId(null);
    setPaymentMethodOverride('');
    setInvoiceNumberEdited(false);
    setError(null);
  }, [selectedUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-prefill hours from the timesheet sum when it changes (payee/period).
  useEffect(() => {
    setTotalHoursInput(timesheetTotalHours > 0 ? timesheetTotalHours.toFixed(2) : '');
  }, [timesheetTotalHours]);

  // Prefill rate from rate_history once resolved.
  useEffect(() => {
    if (defaultPayRate != null) setRateInput(defaultPayRate.toFixed(2));
  }, [defaultPayRate]);

  // Default currency + payment terms + payment method from resolved profile.
  useEffect(() => {
    if (!selectedProfile || !selectedUser) return;
    if (!paymentMethodOverride) {
      const m = paymentMethodFromProfile(selectedProfile);
      if (m === 'Intuit' || m === 'Convera') setPaymentMethodOverride(m);
    }
    if (selectedUser.paymentTerms && PAY_TERMS.includes(selectedUser.paymentTerms as typeof PAY_TERMS[number])) {
      setPaymentTerms(selectedUser.paymentTerms);
    }
  }, [selectedProfile, selectedUser, paymentMethodOverride, paymentMethodFromProfile]);

  // Auto-generate invoice_number MAN-{userShort}-{YYYYMM}. Only if accountant
  // hasn't manually edited it.
  useEffect(() => {
    if (invoiceNumberEdited || !selectedUser) return;
    const shortRaw = selectedUser.name.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6) || 'PAYEE';
    const period = `${year}${String(month).padStart(2, '0')}`;
    let candidate = `MAN-${shortRaw}-${period}`;
    let n = 1;
    while (invoices.some(inv => inv.invoiceNumber === candidate)) {
      n += 1;
      candidate = `MAN-${shortRaw}-${period}-${n}`;
    }
    setInvoiceNumber(candidate);
  }, [selectedUser, year, month, invoices, invoiceNumberEdited]);

  const totalHours = Number(totalHoursInput) || 0;
  const flatRate = Number(rateInput) || 0;
  const totalAmount = parseFloat((totalHours * flatRate).toFixed(2));
  const variance = timesheetTotalHours > 0 ? totalHours - timesheetTotalHours : 0;

  const dupInvoices = useMemo(() => {
    if (!selectedUser) return [];
    return invoices.filter(inv =>
      inv.userId === selectedUser.id
      && inv.periodStart >= periodStart
      && inv.periodStart <= periodEnd);
  }, [invoices, selectedUser, periodStart, periodEnd]);

  const canSave =
    !!selectedUser
    && !!selectedProfile
    && (paymentMethodOverride === 'Intuit' || paymentMethodOverride === 'Convera')
    && invoiceNumber.trim().length > 0
    && totalAmount > 0
    && (dupInvoices.length === 0 || ignoreDupWarning);

  async function handleSave() {
    if (!canSave || !selectedUser || !selectedProfile) return;
    setSaving(true);
    setError(null);

    const paymentProfileSnapshot = {
      id: selectedProfile.id,
      userId: selectedProfile.userId,
      profileName: selectedProfile.profileName,
      companyName: selectedProfile.companyName,
      iban: selectedProfile.iban,
      swift: selectedProfile.swift,
      bankName: selectedProfile.bankName,
      bankAddress: selectedProfile.bankAddress ?? '',
      bankBranch: selectedProfile.bankBranch ?? '',
      companyAddress: selectedProfile.companyAddress ?? '',
      country: selectedProfile.country ?? '',
      paymentEmail: selectedProfile.paymentEmail ?? '',
      qbVendorName: selectedProfile.qbVendorName ?? '',
      isDefault: selectedProfile.isDefault,
    };

    const payload = {
      invoice_number: invoiceNumber.trim(),
      user_id: selectedUser.id,
      project_id: selectedUser.projectId,
      period_start: periodStart,
      period_end: periodEnd,
      // Canonical InvoiceLine shape — matches contractor-submitted invoices so
      // the accountant review modal, reconciler, and Convera/Intuit exports all
      // read these lines with zero special-casing.
      // If the accountant left hours == timesheet sum, use the per-week TS
      // breakdown at the accountant's rate. If he overrode hours, collapse to
      // one lump line (weekly split is meaningless once total is manual).
      lines: buildLinesForSave({
        timesheetLines,
        totalHours,
        rate: flatRate,
        periodEnd,
      }),
      total_hours: totalHours || null,
      rate: flatRate || null,
      total_amount: totalAmount,
      currency,
      status: 'approved',
      submitted_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentAccountantId,
      notes,
      payment_profile: paymentProfileSnapshot,
      pay_on_date: payOnDate || null,
      attachment_path: null,
      payment_method: paymentMethodOverride || null,
      is_vendor_invoice: false,
      vendor_manager_id: null,
      source: 'manual',
      created_by: currentAccountantId,
      payment_terms: paymentTerms,
      corrected: false,
      matcher_ignore: false,
      qb_export_status: 'not_exported',
    };

    const { error: insErr } = await supabase.from('invoices').insert(payload);
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    onCreated();
    // Reset local state ready for next open.
    setSelectedUserId('');
    setTotalHoursInput('');
    setRateInput('');
    setInvoiceNumberEdited(false);
    setPayOnDate('');
    setNotes('');
    setIgnoreDupWarning(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center px-5 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-800">+ Manual Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Payee picker */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Payee</label>
            <PayeePicker
              candidates={candidates}
              selectedUserId={selectedUserId || null}
              onSelect={setSelectedUserId}
              onNewPayeeCreated={(userId) => {
                setSelectedUserId(userId);
                onCreated(); // Refresh users + profiles in parent.
              }}
            />
          </div>

          {selectedUser && (
            <>
              {/* Payment target — surfaces the beneficiary details so the accountant
                  is unambiguously routing the money to the right entity. Especially
                  important when payee name != beneficiary name (Himavath → Enugala). */}
              {selectedProfile && (() => {
                const method = paymentMethodOverride || paymentMethodFromProfile(selectedProfile);
                const bene = selectedProfile.converaBeneficiaryId
                  ? converaBeneficiaries.find(b => b.id === selectedProfile.converaBeneficiaryId)
                  : null;
                const beneNameDiffers = bene && bene.beneficiaryName
                  && bene.beneficiaryName.toLowerCase() !== selectedUser.name.toLowerCase();
                const accent = method === 'Intuit' ? 'green' : method === 'Convera' ? 'purple' : 'gray';
                const borderCls = accent === 'green' ? 'border-green-200 bg-green-50/50' : accent === 'purple' ? 'border-purple-200 bg-purple-50/50' : 'border-gray-200 bg-gray-50';
                const labelCls = accent === 'green' ? 'text-green-700' : accent === 'purple' ? 'text-purple-700' : 'text-gray-600';
                const valueCls = accent === 'green' ? 'text-green-900' : accent === 'purple' ? 'text-purple-900' : 'text-gray-800';
                return (
                  <div className={`rounded-lg border p-3 ${borderCls} text-sm`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold uppercase tracking-wide ${labelCls}`}>
                        Payment target · {method || 'Unassigned'}
                      </span>
                      {userProfiles.length > 1 && (
                        <select
                          value={selectedProfile.id}
                          onChange={e => setSelectedProfileId(Number(e.target.value))}
                          className="text-xs px-2 py-0.5 border border-gray-300 rounded bg-white"
                        >
                          {userProfiles.map(p => (
                            <option key={p.id} value={p.id}>{p.profileName}{p.isDefault ? ' (default)' : ''}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div>
                        <span className="text-gray-500">Company: </span>
                        <span className={`font-medium ${valueCls}`}>{selectedProfile.companyName || selectedProfile.profileName || '—'}</span>
                      </div>
                      {bene && (
                        <div>
                          <span className="text-gray-500">Bene: </span>
                          <span className={`font-medium ${valueCls}`}>{bene.shortName || bene.beneficiaryName}</span>
                          {bene.vendorId && <span className="ml-1 text-gray-400">({bene.vendorId})</span>}
                        </div>
                      )}
                      {selectedProfile.iban && (
                        <div className="col-span-2 font-mono">
                          <span className="text-gray-500">IBAN: </span>
                          <span className={valueCls}>{selectedProfile.iban}</span>
                          {selectedProfile.swift && <span className="ml-2 text-gray-500">SWIFT </span>}
                          {selectedProfile.swift && <span className={valueCls}>{selectedProfile.swift}</span>}
                        </div>
                      )}
                      {(selectedProfile.bankName || bene?.bankName) && (
                        <div className="col-span-2">
                          <span className="text-gray-500">Bank: </span>
                          <span className={valueCls}>{selectedProfile.bankName || bene?.bankName}</span>
                        </div>
                      )}
                      {method === 'Intuit' && selectedProfile.paymentEmail && (
                        <div className="col-span-2">
                          <span className="text-gray-500">Email: </span>
                          <span className={valueCls}>{selectedProfile.paymentEmail}</span>
                        </div>
                      )}
                    </div>
                    {beneNameDiffers && (
                      <div className="mt-2 text-xs text-amber-700 flex items-start gap-1">
                        <span>⚠</span>
                        <span>Payee is <span className="font-medium">{selectedUser.name}</span> but Convera beneficiary is <span className="font-medium">{bene?.beneficiaryName}</span>. Confirm this is the intended routing.</span>
                      </div>
                    )}
                    {!selectedProfile.qbVendorName && (
                      <div className="mt-2 text-xs text-yellow-800">
                        No QB vendor mapping on this profile — invoice will save but won't push to QB until mapped in Payment Profiles.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Period */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Month</label>
                  <select
                    value={month}
                    onChange={e => setMonth(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Year</label>
                  <select
                    value={year}
                    onChange={e => setYear(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Payment method + currency + terms + pay-on-date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Payment method</label>
                  <select
                    value={paymentMethodOverride}
                    onChange={e => setPaymentMethodOverride(e.target.value as 'Intuit' | 'Convera' | '')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">— pick —</option>
                    <option value="Intuit">Intuit</option>
                    <option value="Convera">Convera</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Currency</label>
                  <select
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Payment terms</label>
                  <select
                    value={paymentTerms}
                    onChange={e => setPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    {PAY_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Pay on date <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="date"
                    value={payOnDate}
                    onChange={e => setPayOnDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Read-only timesheet summary — mirrors the Invoice Approval modal */}
              {selectedUser?.role === 'timesheetuser' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-semibold text-gray-600">Timesheets in period</label>
                    {timesheetLines.length > 0 ? (
                      <span className="text-xs text-indigo-600">{timesheetLines.length} approved · {timesheetTotalHours.toFixed(2)}h total</span>
                    ) : (
                      <span className="text-xs text-amber-600">No approved timesheets for {new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                    )}
                  </div>
                  {timesheetLines.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-600">
                          <tr>
                            <th className="px-3 py-1.5 text-left">Week Ending</th>
                            <th className="px-3 py-1.5 text-center">Status</th>
                            <th className="px-3 py-1.5 text-right">Hrs in Period</th>
                          </tr>
                        </thead>
                        <tbody>
                          {timesheetLines.map((line, i) => (
                            <tr key={i} className="border-t border-gray-100">
                              <td className="px-3 py-1.5 text-gray-700 font-mono">
                                W/E {new Date(line.weekEndingFri + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Approved</span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">{(line.hours ?? 0).toFixed(2)}h</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t border-gray-200 font-semibold text-sm">
                          <tr>
                            <td className="px-3 py-2 text-right" colSpan={2}>Sum</td>
                            <td className="px-3 py-2 text-right font-mono text-indigo-700">{timesheetTotalHours.toFixed(2)}h</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Invoice values — single hours + rate + computed amount */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Invoice values</label>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">Total hours</div>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={totalHoursInput}
                      onChange={e => setTotalHoursInput(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right font-mono"
                      placeholder="0.00"
                    />
                    {Math.abs(variance) > 0.01 && (
                      <div className="text-xs text-amber-700 mt-0.5 text-right">
                        Δ {variance >= 0 ? '+' : ''}{variance.toFixed(2)}h vs timesheets
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">
                      Rate {defaultPayRate != null && <span className="text-gray-400">· last: ${defaultPayRate.toFixed(2)}/hr</span>}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={rateInput}
                      onChange={e => setRateInput(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right font-mono"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-0.5">Amount</div>
                    <div className="px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm text-right font-mono font-semibold text-indigo-700">
                      ${totalAmount.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Invoice number */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Invoice number</label>
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={e => { setInvoiceNumber(e.target.value); setInvoiceNumberEdited(true); }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Notes <span className="text-gray-400">(optional)</span></label>
                  <input
                    type="text"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Warnings */}
              {dupInvoices.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                  <div className="font-semibold text-amber-900 mb-1">⚠ {selectedUser.name} already has {dupInvoices.length} invoice{dupInvoices.length === 1 ? '' : 's'} in this period:</div>
                  <ul className="text-xs text-amber-800 space-y-0.5">
                    {dupInvoices.slice(0, 5).map(i => (
                      <li key={i.id}>• {i.invoiceNumber} ({i.status})</li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 mt-2 text-xs">
                    <input
                      type="checkbox"
                      checked={ignoreDupWarning}
                      onChange={e => setIgnoreDupWarning(e.target.checked)}
                      className="rounded"
                    />
                    Create anyway
                  </label>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create manual invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
