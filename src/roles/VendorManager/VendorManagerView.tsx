import { useState } from 'react';
import { LogOut, Users, Plus, Receipt, Settings, Clock, DollarSign, Edit2, Save, X, Eye, EyeOff } from 'lucide-react';
import { parseLocalDate, formatDate, getWeekDates } from '../../lib/dates';
import MonthRangePicker, { buildMonthPresets } from '../../components/MonthRangePicker';
import { supabase } from '../../supabaseClient';
import type {
  UserProfile,
  Timesheet,
  Project,
  Invoice,
  InvoiceLine,
  PaymentProfile,
  TimeEntry,
} from '../../types';

// Vendor Manager dashboard.
//
// Extracted from TimesheetSystem.tsx as Slice 5 of the modularization arc.
// VM role is currently DORMANT — the role exists in the codebase but no one
// has actually logged in per Dan 2026-09-15 (extends the [[manager-role-dormant]]
// pattern). Refactoring here is low-risk.
//
// This view still renders a minimal Payment Profile modal inline (a subset of
// the accountant's full modal). Consolidating into the shared A6 component
// is a separate slice — see audit for candidate details.

interface ProfileForm {
  profileName: string;
  companyName: string;
  companyAddress: string;
  country: string;
  bankName: string;
  bankAddress: string;
  bankBranch: string;
  accountNumber: string;
  iban: string;
  swift: string;
  paymentEmail: string;
  isDefault: boolean;
  combinePayments: boolean | null;
  converaBeneficiaryId: number | null;
  converaMatchOverride: boolean;
  qbVendorName: string | null;
}

export interface VendorManagerViewProps {
  currentUser: UserProfile;
  users: UserProfile[];
  timesheets: Timesheet[];
  invoices: Invoice[];
  projects: Project[];
  paymentProfiles: PaymentProfile[];

  // Handlers
  onLogout: () => void;
  fetchInvoices: () => Promise<void>;
  setCurrentUser: (u: UserProfile) => void;

  // Shared Payment Profile modal state (rendered inline inside this view)
  showProfileModal: boolean;
  setShowProfileModal: (b: boolean) => void;
  editingProfile: PaymentProfile | null;
  setEditingProfile: (p: PaymentProfile | null) => void;
  profileForm: ProfileForm;
  setProfileForm: (f: ProfileForm) => void;
  setProfileEditUserId: (id: string | null) => void;
  emptyProfileForm: () => ProfileForm;
  savePaymentProfile: () => Promise<void>;

  // Password change state (inline in Profile tab)
  profileNewPassword: string;
  setProfileNewPassword: (s: string) => void;
  profileConfirmPassword: string;
  setProfileConfirmPassword: (s: string) => void;
  profileShowNewPw: boolean;
  setProfileShowNewPw: (b: boolean) => void;
  profileShowConfirmPw: boolean;
  setProfileShowConfirmPw: (b: boolean) => void;
  profilePwLoading: boolean;
  setProfilePwLoading: (b: boolean) => void;
}

export default function VendorManagerView({
  currentUser,
  users,
  timesheets,
  invoices,
  projects,
  paymentProfiles,
  onLogout,
  fetchInvoices,
  setCurrentUser,
  showProfileModal,
  setShowProfileModal,
  editingProfile,
  setEditingProfile,
  profileForm,
  setProfileForm,
  setProfileEditUserId,
  emptyProfileForm,
  savePaymentProfile,
  profileNewPassword,
  setProfileNewPassword,
  profileConfirmPassword,
  setProfileConfirmPassword,
  profileShowNewPw,
  setProfileShowNewPw,
  profileShowConfirmPw,
  setProfileShowConfirmPw,
  profilePwLoading,
  setProfilePwLoading,
}: VendorManagerViewProps) {
  const [vmTab, setVmTab] = useState<'timesheets' | 'create' | 'invoices' | 'profile'>('timesheets');
  const [vmPeriod, setVmPeriod] = useState({ start: '', end: '' });
  const [vmInvoiceType, setVmInvoiceType] = useState<'consolidated' | 'per-user'>('consolidated');
  const [vmRates, setVmRates] = useState<Record<string, string>>({});
  const [vmCurrency, setVmCurrency] = useState('USD');
  const [vmPaymentProfileId, setVmPaymentProfileId] = useState<number | null>(null);
  const [vmInvoiceNumber, setVmInvoiceNumber] = useState('');
  const [vmNotes, setVmNotes] = useState('');
  const [vmPhoneConfirm, setVmPhoneConfirm] = useState('');

  const myUsers = users.filter(u => u.vendorManagerId === currentUser.id);
  const myTimesheets = timesheets.filter(t => myUsers.some(u => u.id === t.userId));
  const myInvoices = invoices.filter(i => i.vendorManagerId === currentUser.id);
  const myPaymentProfiles = paymentProfiles.filter(p => p.userId === currentUser.id);

  const currencySymbols: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' };
  const sym = currencySymbols[vmCurrency] || '$';

  const buildVmLines = (userId: string, rate: number): InvoiceLine[] => {
    if (!vmPeriod.start || !vmPeriod.end || !rate) return [];
    const startD = parseLocalDate(vmPeriod.start), endD = parseLocalDate(vmPeriod.end);
    const user = users.find(u => u.id === userId);
    return timesheets
      .filter(t => {
        if (t.userId !== userId || t.status !== 'approved') return false;
        const mon = parseLocalDate(t.weekStart);
        const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
        return mon <= endD && fri >= startD;
      })
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(ts => {
        const mon = parseLocalDate(ts.weekStart);
        const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
        let hours = 0;
        Object.entries(ts.entries).forEach(([dk, entry]) => {
          const d = parseLocalDate(dk);
          if (d >= startD && d <= endD) hours += parseFloat((entry as TimeEntry)?.hours || '0');
        });
        return { weekStart: ts.weekStart, weekEndingFri: formatDate(fri), hours: parseFloat(hours.toFixed(2)), rate, amount: parseFloat((hours * rate).toFixed(2)), userId, userName: user?.name || ts.userName };
      })
      .filter(l => l.hours > 0);
  };

  const allVmLines = myUsers.map(u => buildVmLines(u.id, parseFloat(vmRates[u.id] || '0'))).flat();

  const submitVmInvoice = async () => {
    if (!vmPeriod.start || !vmPeriod.end) { alert('Please select a period.'); return; }
    if (!vmInvoiceNumber.trim()) { alert('Please enter an invoice number.'); return; }
    if (!vmPhoneConfirm.trim()) { alert('Please confirm your phone number.'); return; }
    const usersWithRates = myUsers.filter(u => parseFloat(vmRates[u.id] || '0') > 0);
    if (usersWithRates.length === 0) { alert('Please enter a rate for at least one user.'); return; }

    const profile = myPaymentProfiles.find(p => p.id === vmPaymentProfileId) || null;
    if (!profile) { alert('Please select a payment profile.'); return; }

    const lines = allVmLines;
    if (lines.length === 0) { alert('No approved timesheets found for any user in this period.'); return; }

    const totalHours = lines.reduce((s, l) => s + (l.hours ?? 0), 0);
    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

    const trimmedPhone = vmPhoneConfirm.trim();
    if (trimmedPhone && trimmedPhone !== currentUser.phone) {
      await supabase.from('profiles').update({ phone: trimmedPhone }).eq('id', currentUser.id);
      setCurrentUser({ ...currentUser, phone: trimmedPhone });
    }

    const payload = {
      invoice_number: vmInvoiceNumber.trim().toUpperCase(),
      user_id: currentUser.id,
      user_name: currentUser.name,
      project_id: null,
      period_start: vmPeriod.start,
      period_end: vmPeriod.end,
      lines,
      total_hours: totalHours,
      rate: 0,
      total_amount: totalAmount,
      currency: vmCurrency,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      notes: vmNotes,
      payment_profile: profile,
      is_vendor_invoice: true,
      vendor_manager_id: currentUser.id,
    };

    const { error } = await supabase.from('invoices').insert(payload);
    if (error) { alert('Error submitting invoice: ' + error.message); return; }
    await fetchInvoices();
    setVmTab('invoices');
    setVmInvoiceNumber(''); setVmNotes(''); setVmRates({});
    alert('Invoice submitted successfully!');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Vendor Manager Dashboard</h1>
              <p className="text-gray-600">Welcome, {currentUser.name}</p>
              <p className="text-sm text-teal-600 font-medium">Role: Vendor Manager — {myUsers.length} user{myUsers.length !== 1 ? 's' : ''}</p>
            </div>
            <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="flex border-b">
            {([
              { key: 'timesheets', label: 'Timesheets', icon: <Clock className="w-5 h-5 flex-shrink-0" /> },
              { key: 'create', label: 'Create Invoice', icon: <Plus className="w-5 h-5 flex-shrink-0" /> },
              { key: 'invoices', label: 'Invoices', icon: <Receipt className="w-5 h-5 flex-shrink-0" /> },
              { key: 'profile', label: 'Profile', icon: <Settings className="w-5 h-5 flex-shrink-0" /> },
            ] as { key: typeof vmTab; label: string; icon: React.ReactNode }[]).map(tab => (
              <button key={tab.key} onClick={() => setVmTab(tab.key)}
                className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (vmTab === tab.key ? 'text-teal-600 border-teal-600 bg-teal-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                {tab.icon}<span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* TIMESHEETS TAB */}
        {vmTab === 'timesheets' && (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Users className="w-6 h-6 text-teal-600" /> Team Timesheets</h2>
            {myUsers.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No users assigned to you yet. Contact your administrator.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                  {myUsers.map(u => {
                    const uTs = myTimesheets.filter(t => t.userId === u.id);
                    const pending = uTs.filter(t => t.status === 'pending').length;
                    const approved = uTs.filter(t => t.status === 'approved').length;
                    const project = projects.find(p => p.id === u.projectId);
                    return (
                      <div key={u.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                        <div className="font-semibold text-gray-800">{u.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{project ? project.name : 'No project'}</div>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          {pending > 0 && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">{pending} pending</span>}
                          {approved > 0 && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">{approved} approved</span>}
                          {uTs.length === 0 && <span className="text-xs text-gray-400">No timesheets</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-teal-600 text-white">
                      <tr>
                        <th className="border border-teal-700 px-3 py-2 text-left">Employee</th>
                        <th className="border border-teal-700 px-3 py-2 text-left">Week Ending</th>
                        <th className="border border-teal-700 px-3 py-2 text-left">Project</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Mon</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Tue</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Wed</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Thu</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Fri</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Total</th>
                        <th className="border border-teal-700 px-3 py-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myTimesheets.length === 0 ? (
                        <tr><td colSpan={10} className="text-center py-6 text-gray-400">No timesheets submitted yet</td></tr>
                      ) : (
                        myTimesheets.sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map((ts, idx) => {
                          const tsUser = users.find(u => u.id === ts.userId);
                          const project = projects.find(p => p.id === (ts.projectId ?? tsUser?.projectId));
                          const weekDates = getWeekDates(parseLocalDate(ts.weekStart));
                          const dailyHours = weekDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                          const total = dailyHours.reduce((s, h) => s + h, 0);
                          const fri = weekDates[4];
                          return (
                            <tr key={ts.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{ts.userName}</td>
                              <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">{fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                              <td className="border border-gray-200 px-3 py-2 text-teal-600 text-xs">{project ? `${project.name} (${project.code})` : '—'}</td>
                              {dailyHours.map((h, i) => <td key={i} className="border border-gray-200 px-3 py-2 text-center">{h > 0 ? h.toFixed(1) : <span className="text-gray-300">—</span>}</td>)}
                              <td className="border border-gray-200 px-3 py-2 text-center font-bold text-teal-700">{total.toFixed(1)}</td>
                              <td className="border border-gray-200 px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ts.status === 'approved' ? 'bg-green-100 text-green-800' : ts.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                  {ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* CREATE INVOICE TAB */}
        {vmTab === 'create' && (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 space-y-6">
            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-6 h-6 text-teal-600" /> Create Invoice</h2>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice Type</label>
              <div className="flex gap-3">
                {(['consolidated', 'per-user'] as const).map(type => (
                  <button key={type} onClick={() => setVmInvoiceType(type)}
                    className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium text-sm transition-colors ${vmInvoiceType === type ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 bg-white text-gray-600 hover:border-teal-300'}`}>
                    {type === 'consolidated' ? '📄 One consolidated invoice' : '📋 Separate invoice per user'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">{vmInvoiceType === 'consolidated' ? 'One invoice covering all users with a line per employee per week.' : 'Individual invoices submitted for each user separately.'}</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Billing Period</label>
              <MonthRangePicker
                value={vmPeriod}
                onChange={setVmPeriod}
                variant="teal"
                presets={[{ options: buildMonthPresets(6) }]}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Hourly Rates per Employee</label>
              <div className="space-y-2">
                {myUsers.map(u => {
                  const rate = parseFloat(vmRates[u.id] || '0');
                  const lines = buildVmLines(u.id, rate);
                  const total = lines.reduce((s, l) => s + l.amount, 0);
                  return (
                    <div key={u.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex-1 font-medium text-gray-800 text-sm">{u.name}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-sm">{sym}</span>
                        <input type="number" min="0" step="0.01" value={vmRates[u.id] || ''} onChange={e => setVmRates(r => ({...r, [u.id]: e.target.value}))}
                          className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder="0.00" />
                        <span className="text-gray-400 text-xs">/hr</span>
                      </div>
                      {rate > 0 && lines.length > 0 && (
                        <div className="text-right text-xs text-teal-700 font-medium whitespace-nowrap">
                          {lines.reduce((s,l) => s+(l.hours ?? 0),0).toFixed(1)}h = {sym}{total.toFixed(2)}
                        </div>
                      )}
                      {rate > 0 && lines.length === 0 && vmPeriod.start && (
                        <span className="text-xs text-amber-500 whitespace-nowrap">No approved timesheets</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Currency</label>
              <select value={vmCurrency} onChange={e => setVmCurrency(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                {['USD','GBP','EUR','CAD','AUD'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Profile *</label>
              {myPaymentProfiles.length === 0 ? (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">No payment profiles yet. Go to the Profile tab to add one.</p>
              ) : (
                <select value={vmPaymentProfileId || ''} onChange={e => setVmPaymentProfileId(e.target.value ? parseInt(e.target.value) : null)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500">
                  <option value="">Select payment profile…</option>
                  {myPaymentProfiles.map(p => <option key={p.id} value={p.id}>{p.profileName} — {p.bankName}</option>)}
                </select>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice Number *</label>
                <input type="text" value={vmInvoiceNumber} onChange={e => setVmInvoiceNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, ''))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-teal-500" placeholder="e.g. VENDOR-2026-001" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optional)</label>
                <input type="text" value={vmNotes} onChange={e => setVmNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder="Any additional notes" />
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Contact Phone Number *</label>
              <input type="tel" value={vmPhoneConfirm} onChange={e => setVmPhoneConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder={currentUser.phone || '+1 555 123 4567'} />
              <p className="text-xs text-gray-400 mt-1">Confirm your number in case of invoice queries.</p>
            </div>

            {allVmLines.length > 0 && (
              <div className="bg-teal-600 text-white rounded-lg p-4">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm opacity-90">Total Hours</div>
                    <div className="text-2xl font-bold">{allVmLines.reduce((s,l) => s+(l.hours ?? 0), 0).toFixed(1)}h</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm opacity-90">Total Amount</div>
                    <div className="text-2xl font-bold">{sym}{allVmLines.reduce((s,l) => s+l.amount, 0).toFixed(2)}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm opacity-80">
                  {[...new Set(allVmLines.map(l => l.userName))].map(name => {
                    const userLines = allVmLines.filter(l => l.userName === name);
                    const hrs = userLines.reduce((s,l) => s+(l.hours ?? 0), 0);
                    const amt = userLines.reduce((s,l) => s+l.amount, 0);
                    return <div key={name}>{name}: {hrs.toFixed(1)}h = {sym}{amt.toFixed(2)}</div>;
                  })}
                </div>
              </div>
            )}

            <button
              onClick={submitVmInvoice}
              disabled={allVmLines.length === 0 || !vmInvoiceNumber.trim() || !vmPaymentProfileId || !vmPhoneConfirm.trim()}
              className="w-full py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Receipt className="w-5 h-5" /> Submit Invoice for Review
            </button>
          </div>
        )}

        {/* INVOICES TAB */}
        {vmTab === 'invoices' && (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Receipt className="w-6 h-6 text-teal-600" /> Invoice History</h2>
            {myInvoices.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No invoices submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {myInvoices.sort((a,b) => (b.submittedAt || '').localeCompare(a.submittedAt || '')).map(inv => {
                  const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
                  const invSym = currencySymbols[inv.currency] || '$';
                  const employees = [...new Set(inv.lines.map(l => l.userName).filter(Boolean))];
                  return (
                    <div key={inv.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{inv.invoiceNumber}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                            {inv.corrected && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Corrected</span>}
                          </div>
                          <p className="text-sm text-gray-600">{parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} – {parseLocalDate(inv.periodEnd).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                          <p className="text-xs text-gray-500 mt-1">{inv.lines.length} line{inv.lines.length !== 1 ? 's' : ''} · {inv.totalHours != null ? inv.totalHours.toFixed(1) + ' hrs' : '—'} · {employees.join(', ')}</p>
                          {inv.payOnDate && <p className="text-xs text-blue-600 mt-0.5 font-medium">📅 Expected payment: {parseLocalDate(inv.payOnDate!).toLocaleDateString()}</p>}
                          {inv.paidDate && <p className="text-xs text-green-600 mt-0.5 font-medium">✅ Paid: {parseLocalDate(inv.paidDate!).toLocaleDateString()}</p>}
                        </div>
                        <div className="text-right ml-4">
                          <div className="text-xl font-bold text-teal-700">{invSym}{inv.totalAmount.toFixed(2)}</div>
                          <div className="text-xs text-gray-400">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : ''}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PROFILE TAB */}
        {vmTab === 'profile' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-5 h-5 text-teal-600" /> Payment Profiles</h3>
                <button onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }}
                  className="flex items-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">
                  <Plus className="w-4 h-4" /> Add Profile
                </button>
              </div>
              {myPaymentProfiles.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No payment profiles yet. Add your vendor company bank details.</p>
              ) : (
                <div className="space-y-2">
                  {myPaymentProfiles.map(p => (
                    <div key={p.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div>
                        <div className="font-medium text-gray-800 text-sm">{p.profileName}</div>
                        <div className="text-xs text-gray-500">{p.bankName}{p.accountNumber ? ` · ···${p.accountNumber.slice(-4)}` : ''}</div>
                      </div>
                      <div className="flex gap-2">
                        {p.isDefault && <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full">Default</span>}
                        <button onClick={() => { setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride, qbVendorName: p.qbVendorName }); setShowProfileModal(true); }}
                          className="p-1 text-indigo-600 hover:text-indigo-800"><Edit2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Settings className="w-5 h-5 text-teal-600" /> Change Password</h3>
              <div className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <div className="relative">
                    <input type={profileShowNewPw ? 'text' : 'password'} value={profileNewPassword} onChange={e => setProfileNewPassword(e.target.value)} className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Min. 8 characters" />
                    <button type="button" onClick={() => setProfileShowNewPw(!profileShowNewPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">{profileShowNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                  <div className="relative">
                    <input type={profileShowConfirmPw ? 'text' : 'password'} value={profileConfirmPassword} onChange={e => setProfileConfirmPassword(e.target.value)} className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Re-enter new password" />
                    <button type="button" onClick={() => setProfileShowConfirmPw(!profileShowConfirmPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">{profileShowConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  </div>
                  {profileConfirmPassword && profileNewPassword !== profileConfirmPassword && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
                  {profileConfirmPassword && profileNewPassword === profileConfirmPassword && <p className="text-xs text-green-600 mt-1">✓ Passwords match</p>}
                </div>
                <button onClick={async () => {
                  if (!profileNewPassword || profileNewPassword.length < 8) { alert('Min. 8 characters.'); return; }
                  if (profileNewPassword !== profileConfirmPassword) { alert('Passwords do not match.'); return; }
                  setProfilePwLoading(true);
                  const { error } = await supabase.auth.updateUser({ password: profileNewPassword });
                  setProfilePwLoading(false);
                  if (error) { alert('Error: ' + error.message); return; }
                  setProfileNewPassword(''); setProfileConfirmPassword('');
                  alert('Password updated!');
                }} disabled={profilePwLoading || !profileNewPassword || profileNewPassword !== profileConfirmPassword}
                  className="w-full py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 font-medium">
                  {profilePwLoading ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Payment profile modal (minimal — VM-specific subset) */}
        {showProfileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }}>
            <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                <h3 className="text-lg font-bold text-gray-800">{editingProfile ? 'Edit Payment Profile' : 'New Payment Profile'}</h3>
                <button onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Profile Label *</label>
                  <input type="text" value={profileForm.profileName} onChange={e => setProfileForm({...profileForm, profileName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" placeholder="e.g. Vendor Account" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Company Name *</label>
                  <input type="text" value={profileForm.companyName} onChange={e => setProfileForm({...profileForm, companyName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Bank Name *</label>
                  <input type="text" value={profileForm.bankName} onChange={e => setProfileForm({...profileForm, bankName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Account Number *</label>
                  <input type="text" value={profileForm.accountNumber} onChange={e => setProfileForm({...profileForm, accountNumber: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
                    <input type="text" value={profileForm.iban} onChange={e => setProfileForm({...profileForm, iban: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono" /></div>
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">SWIFT / BIC *</label>
                    <input type="text" value={profileForm.swift} onChange={e => setProfileForm({...profileForm, swift: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono" /></div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="vmIsDefault" checked={profileForm.isDefault} onChange={e => setProfileForm({...profileForm, isDefault: e.target.checked})} className="accent-teal-600 w-4 h-4" />
                  <label htmlFor="vmIsDefault" className="text-sm text-gray-700 cursor-pointer">Set as default</label>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={savePaymentProfile} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium"><Save className="w-4 h-4" /> Save Profile</button>
                  <button onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }} className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
