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
  currentAccountantId: string;
  onCreated: () => void;
  paymentMethodFromProfile: (profile: PaymentProfileLite | null) => 'Intuit' | 'Convera' | '';
}

interface ManualLine {
  periodStart: string;   // YYYY-MM-DD
  hours: number;
  rate: number;
}

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;
const PAY_TERMS = ['NET15', 'NET30', 'NET45', 'NET60'] as const;

export default function ManualInvoiceModal({
  open, onClose, users, paymentProfiles, invoices, timesheets, currentAccountantId, onCreated,
  paymentMethodFromProfile,
}: Props) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [paymentMethodOverride, setPaymentMethodOverride] = useState<'Intuit' | 'Convera' | ''>('');
  const [currency, setCurrency] = useState<string>('USD');
  const [paymentTerms, setPaymentTerms] = useState<string>('NET30');
  const [lines, setLines] = useState<ManualLine[]>([]);
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

  // Slice M4 — timesheet auto-populate. Weeks whose Sunday-end falls within
  // the selected month are pulled in; sum(hours) across the week's entries is
  // the week's total. Consistent with the consolidation monthly rollup.
  const timesheetLines = useMemo<ManualLine[]>(() => {
    if (!selectedUser || selectedUser.role !== 'timesheetuser') return [];
    const monthNum = month;
    const yearNum = year;
    return timesheets
      .filter(ts => ts.userId === selectedUser.id && ts.status === 'approved')
      .filter(ts => {
        const [y, m, d] = ts.weekStart.split('-').map(Number);
        const monday = new Date(y, m - 1, d);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return sunday.getFullYear() === yearNum && sunday.getMonth() + 1 === monthNum;
      })
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(ts => {
        const total = Object.values(ts.entries ?? {}).reduce((s, e) => {
          const h = Number(e.hours);
          return s + (Number.isFinite(h) ? h : 0);
        }, 0);
        return { periodStart: ts.weekStart, hours: total, rate: 0 };
      });
  }, [selectedUser, timesheets, year, month]);

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
    () => timesheetLines.reduce((s, l) => s + l.hours, 0),
    [timesheetLines],
  );

  // Reset dependent state when payee changes. Prefill from timesheets if available.
  useEffect(() => {
    if (!selectedUser) return;
    setSelectedProfileId(null);
    setPaymentMethodOverride('');
    setInvoiceNumberEdited(false);
    setError(null);
    if (timesheetLines.length > 0) {
      const rate = defaultPayRate ?? 0;
      setLines(timesheetLines.map(l => ({ ...l, rate })));
    } else {
      setLines([{ periodStart: periodEnd, hours: 0, rate: defaultPayRate ?? 0 }]);
    }
  }, [selectedUserId, defaultPayRate, timesheetLines.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // When month/year changes for a timesheetuser payee, re-populate.
  useEffect(() => {
    if (!selectedUser || selectedUser.role !== 'timesheetuser') return;
    if (timesheetLines.length > 0) {
      const rate = defaultPayRate ?? lines[0]?.rate ?? 0;
      setLines(timesheetLines.map(l => ({ ...l, rate })));
    }
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const totalHours = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);
  const totalAmount = lines.reduce((s, l) => s + (Number(l.hours) || 0) * (Number(l.rate) || 0), 0);
  const flatRate = totalHours > 0 ? totalAmount / totalHours : (lines[0]?.rate ?? 0);

  const dupInvoices = useMemo(() => {
    if (!selectedUser) return [];
    return invoices.filter(inv =>
      inv.userId === selectedUser.id
      && inv.periodStart >= periodStart
      && inv.periodStart <= periodEnd);
  }, [invoices, selectedUser, periodStart, periodEnd]);

  const noQbVendor = selectedProfile && !selectedProfile.qbVendorName;

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
      lines: lines.map(l => ({ period_start: l.periodStart, hours: Number(l.hours), rate: Number(l.rate) })),
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
    setLines([]);
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

              {/* Payment profile picker (when multiple) + method + currency */}
              <div className="grid grid-cols-2 gap-3">
                {userProfiles.length > 1 && (
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Payment profile</label>
                    <select
                      value={selectedProfile?.id ?? ''}
                      onChange={e => setSelectedProfileId(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    >
                      {userProfiles.map(p => (
                        <option key={p.id} value={p.id}>{p.profileName}{p.isDefault ? ' (default)' : ''}{p.iban ? ` — ${p.iban.slice(0, 10)}…` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
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

              {/* Lines editor */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-gray-600">Line items</label>
                  {timesheetLines.length > 0 && (
                    <span className="text-xs text-indigo-600">
                      Auto-filled from {timesheetLines.length} approved timesheet{timesheetLines.length === 1 ? '' : 's'} ({timesheetTotalHours.toFixed(2)}h)
                    </span>
                  )}
                  {selectedUser?.role === 'timesheetuser' && timesheetLines.length === 0 && (
                    <span className="text-xs text-amber-600">
                      No approved timesheets for {new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  )}
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-1.5 text-left">Date</th>
                        <th className="px-3 py-1.5 text-right w-24">Hours</th>
                        <th className="px-3 py-1.5 text-right w-24">Rate</th>
                        <th className="px-3 py-1.5 text-right w-28">Amount</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-3 py-1.5">
                            <input
                              type="date"
                              value={line.periodStart}
                              min={periodStart}
                              max={periodEnd}
                              onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, periodStart: e.target.value } : l))}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              step="0.25"
                              min="0"
                              value={line.hours || ''}
                              onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, hours: Number(e.target.value) } : l))}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.rate || ''}
                              onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, rate: Number(e.target.value) } : l))}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium">
                            ${((line.hours || 0) * (line.rate || 0)).toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            {lines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}
                                className="text-gray-400 hover:text-red-600 text-lg leading-none"
                                title="Remove line"
                              >×</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200 font-semibold text-sm">
                      <tr>
                        <td className="px-3 py-2 text-right" colSpan={1}>Total</td>
                        <td className="px-3 py-2 text-right">
                          {totalHours.toFixed(2)}h
                          {timesheetTotalHours > 0 && Math.abs(totalHours - timesheetTotalHours) > 0.01 && (
                            <span className="ml-1 text-xs font-normal text-amber-700">
                              (Δ {(totalHours - timesheetTotalHours) >= 0 ? '+' : ''}{(totalHours - timesheetTotalHours).toFixed(2)} vs timesheets)
                            </span>
                          )}
                        </td>
                        <td />
                        <td className="px-3 py-2 text-right text-indigo-700">${totalAmount.toFixed(2)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() => setLines(ls => [...ls, { periodStart: periodEnd, hours: 0, rate: ls[ls.length - 1]?.rate ?? 0 }])}
                  className="mt-2 text-xs text-indigo-600 hover:underline"
                >
                  + Add line
                </button>
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

              {noQbVendor && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-yellow-900">
                  This payee has no QB vendor mapping — invoice will save, but won't push to QB until you set qb_vendor_name in Payment Profiles.
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
