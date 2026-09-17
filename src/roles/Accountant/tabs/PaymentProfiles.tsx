import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, UploadCloud, X } from 'lucide-react';
import { isTestAccount } from '../../../lib/isTestAccount';
import QbVendorNameEditor from '../../../components/QbVendorNameEditor';
import type { UserProfile, PaymentProfile, Invoice, ConveraBeneficiary, ProfileForm } from '../../../types';

export interface TemplateProfileParsed {
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
}

type ProfileFilter = 'all' | 'multiple' | 'unmatched' | 'no-qb-vendor';

interface PaymentProfilesTabProps {
  users: UserProfile[];
  paymentProfiles: PaymentProfile[];
  invoices: Invoice[];
  converaBeneficiaries: ConveraBeneficiary[];
  profileTabSearch: string;
  setProfileTabSearch: (v: string) => void;
  profileTabFilter: ProfileFilter;
  setProfileTabFilter: (v: ProfileFilter) => void;
  qbVendorEditingId: number | null;
  setQbVendorEditingId: (v: number | null) => void;
  setSelectedInvoice: (inv: Invoice) => void;
  setShowInvoiceModal: (v: boolean) => void;
  setEditingProfile: (p: PaymentProfile | null) => void;
  setProfileEditUserId: (id: string | null) => void;
  setProfileForm: (f: ProfileForm) => void;
  setShowProfileModal: (v: boolean) => void;
  setBeneficiaryOverrideProfileId: (id: number | null) => void;
  setShowConveraImport: (v: boolean) => void;
  loadConveraBeneficiaries: () => void;
  saveQbVendorName: (id: number, name: string) => void;
  deletePaymentProfile: (id: number, name: string) => void;
  openTemplateProfileModal: (userId: string) => void;
  emptyProfileForm: () => ProfileForm;
}

export default function PaymentProfilesTab({
  users,
  paymentProfiles,
  invoices,
  converaBeneficiaries,
  profileTabSearch,
  setProfileTabSearch,
  profileTabFilter,
  setProfileTabFilter,
  qbVendorEditingId,
  setQbVendorEditingId,
  setSelectedInvoice,
  setShowInvoiceModal,
  setEditingProfile,
  setProfileEditUserId,
  setProfileForm,
  setShowProfileModal,
  setBeneficiaryOverrideProfileId,
  setShowConveraImport,
  loadConveraBeneficiaries,
  saveQbVendorName,
  deletePaymentProfile,
  openTemplateProfileModal,
  emptyProfileForm,
}: PaymentProfilesTabProps) {
  const [profileTabExcludeTest, setProfileTabExcludeTest] = useState(true);
  const [expandedProfileUsers, setExpandedProfileUsers] = useState<Set<string>>(new Set());

  const accountantManagedRoles = ['timesheetuser', 'vendormanager'];
  const allManagedUsers = users
    .filter(u => accountantManagedRoles.includes(u.role))
    .filter(u => !profileTabExcludeTest || !isTestAccount(u.name));
  const groups = allManagedUsers.map(u => {
    const profs = paymentProfiles
      .filter(p => p.userId === u.id)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.profileName.localeCompare(b.profileName));
    const lastUsedById = new Map<number, Invoice>();
    profs.forEach(p => {
      const used = invoices
        .filter(i => i.userId === u.id && i.paymentProfile?.id === p.id)
        .sort((a, b) => (b.periodStart || '').localeCompare(a.periodStart || ''))[0];
      if (used) lastUsedById.set(p.id, used);
    });
    return { user: u, profiles: profs, lastUsedById };
  });
  let displayed = groups;
  if (profileTabSearch) {
    const q = profileTabSearch.toLowerCase();
    displayed = displayed.filter(g => g.user.name.toLowerCase().includes(q));
  }
  if (profileTabFilter === 'multiple') displayed = displayed.filter(g => g.profiles.length > 1);
  else if (profileTabFilter === 'unmatched') displayed = displayed.filter(g => g.profiles.length === 0 || g.profiles.some(p => !p.converaBeneficiaryId));
  else if (profileTabFilter === 'no-qb-vendor') displayed = displayed.filter(g => g.profiles.length === 0 || g.profiles.some(p => !p.qbVendorName));
  displayed = displayed.slice().sort((a, b) => a.user.name.localeCompare(b.user.name));
  const qbVendorSuggestions = Array.from(new Set(paymentProfiles.map(p => p.qbVendorName).filter((v): v is string => !!v))).sort();
  const counts = {
    all: groups.length,
    multiple: groups.filter(g => g.profiles.length > 1).length,
    unmatched: groups.filter(g => g.profiles.length === 0 || g.profiles.some(p => !p.converaBeneficiaryId)).length,
    'no-qb-vendor': groups.filter(g => g.profiles.length === 0 || g.profiles.some(p => !p.qbVendorName)).length,
  };
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={profileTabSearch}
          onChange={e => setProfileTabSearch(e.target.value)}
          placeholder="Search contractor..."
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 min-w-[200px] focus:ring-2 focus:ring-indigo-500"
        />
        {(['all', 'multiple', 'unmatched', 'no-qb-vendor'] as const).map(f => (
          <button key={f} onClick={() => setProfileTabFilter(f)}
            className={'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ' + (profileTabFilter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400')}>
            {f === 'all' ? 'All' : f === 'multiple' ? 'Multiple profiles' : f === 'unmatched' ? 'Needs benef' : 'Needs QB vendor'}
            <span className="opacity-70 ml-1">({counts[f]})</span>
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-auto cursor-pointer select-none">
          <input type="checkbox" checked={profileTabExcludeTest} onChange={e => setProfileTabExcludeTest(e.target.checked)} className="rounded" />
          Exclude test accounts
        </label>
        <button onClick={() => setExpandedProfileUsers(new Set(allManagedUsers.map(u => u.id)))} className="text-xs text-indigo-600 hover:underline">Expand all</button>
        <button onClick={() => setExpandedProfileUsers(new Set())} className="text-xs text-gray-500 hover:underline">Collapse all</button>
        <button
          onClick={() => { setShowConveraImport(true); loadConveraBeneficiaries(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
        >
          <UploadCloud className="w-3.5 h-3.5" />
          Import Beneficiaries
        </button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Contractor / Profile</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Bank / Acct</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Convera Benef</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">QB Vendor</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Last Used</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-right font-semibold text-gray-600">Actions</th>
            </tr>
            <datalist id="qb-vendor-suggestions">
              {qbVendorSuggestions.map(v => <option key={v} value={v} />)}
            </datalist>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {displayed.map(g => {
              const expanded = expandedProfileUsers.has(g.user.id) || g.profiles.length === 0;
              const hasUnmatched = g.profiles.some(p => !p.converaBeneficiaryId);
              return (
                <Fragment key={g.user.id}>
                  <tr className="bg-indigo-50 hover:bg-indigo-100 cursor-pointer" onClick={() => {
                    const next = new Set(expandedProfileUsers);
                    if (next.has(g.user.id)) next.delete(g.user.id); else next.add(g.user.id);
                    setExpandedProfileUsers(next);
                  }}>
                    <td className="px-4 py-2 font-semibold text-indigo-900" colSpan={6}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        <span>{g.user.name}</span>
                        <span className="text-xs text-indigo-600 font-normal">({g.profiles.length})</span>
                        {g.user.role === 'vendormanager' && (() => {
                          const team = users.filter(u => u.vendorManagerId === g.user.id);
                          return (
                            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium uppercase tracking-wide" title={team.map(t => t.name).join(', ') || 'no contractors assigned'}>
                              Vendor Mgr{team.length > 0 ? ` · ${team.length}` : ''}
                            </span>
                          );
                        })()}
                        {g.profiles.length === 0 && <span className="text-xs text-amber-700 font-normal ml-2">⚠ No profile</span>}
                        {g.profiles.length > 0 && hasUnmatched && <span className="text-xs text-amber-700 font-normal ml-2">⚠ Needs benef</span>}
                      </div>
                    </td>
                  </tr>
                  {expanded && g.profiles.map(p => {
                    const isLinked = !!p.converaBeneficiaryId;
                    const benef = isLinked ? converaBeneficiaries.find(b => b.id === p.converaBeneficiaryId) : null;
                    const lastInv = g.lastUsedById.get(p.id);
                    const acctTail = p.iban ? `IBAN ····${p.iban.slice(-4)}` : (p.accountNumber ? `acct ····${p.accountNumber.slice(-4)}` : '—');
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 pl-10">
                          {p.isDefault && <span className="text-amber-500 mr-1" title="Default">★</span>}
                          <span className="font-medium text-gray-800">{p.profileName}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-700">
                          <div className="text-gray-500">{p.bankName || '—'}</div>
                          <div className="font-mono">{acctTail}</div>
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {!isLinked ? (
                            <span className="text-amber-600">⚠ Needs benef</span>
                          ) : benef ? (
                            <span className="text-green-700">✓ {benef.shortName}</span>
                          ) : (
                            <span className="text-gray-500">✓ linked (#{p.converaBeneficiaryId})</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {qbVendorEditingId === p.id ? (
                            <QbVendorNameEditor
                              initialValue={p.qbVendorName || ''}
                              suggestions={qbVendorSuggestions}
                              onSave={(v) => { saveQbVendorName(p.id, v); setQbVendorEditingId(null); }}
                              onCancel={() => setQbVendorEditingId(null)}
                            />
                          ) : (
                            <button
                              onClick={() => setQbVendorEditingId(p.id)}
                              className={'text-left hover:underline ' + (p.qbVendorName ? 'text-gray-700' : 'text-amber-600')}
                              title="Click to edit QB vendor mapping"
                            >
                              {p.qbVendorName || '⚠ Not mapped'}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600">
                          {lastInv ? (
                            <button onClick={() => { setSelectedInvoice(lastInv); setShowInvoiceModal(true); }} className="hover:underline text-indigo-600">
                              {new Date(lastInv.periodStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} (#{lastInv.id})
                            </button>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap text-xs">
                          <button onClick={() => {
                            setEditingProfile(p);
                            setProfileEditUserId(p.userId);
                            setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride, qbVendorName: p.qbVendorName });
                            setShowProfileModal(true);
                          }} className="px-2 py-1 text-indigo-700 hover:underline">Edit</button>
                          <button onClick={() => { setBeneficiaryOverrideProfileId(p.id); loadConveraBeneficiaries(); }} className="px-2 py-1 text-blue-600 hover:underline">Re-link</button>
                          <button onClick={() => deletePaymentProfile(p.id, p.profileName)} className="px-2 py-1 text-red-600 hover:underline">Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                  {expanded && (
                    <tr className="bg-gray-50">
                      <td colSpan={6} className="px-4 py-2 pl-10">
                        <button onClick={() => {
                          setEditingProfile(null);
                          setProfileEditUserId(g.user.id);
                          setProfileForm(emptyProfileForm());
                          setShowProfileModal(true);
                        }} className="text-xs text-indigo-600 hover:underline">+ New profile for {g.user.name}</button>
                        <span className="text-xs text-gray-400 mx-2">·</span>
                        <button onClick={() => openTemplateProfileModal(g.user.id)} className="text-xs text-indigo-600 hover:underline" title="Paste the contractor's bank-details reply from the template form">From template ▾</button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {displayed.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">No contractors match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Template Profile Modal (bundled per plan §5g) ───────────────────────────

interface TemplateProfileModalProps {
  open: boolean;
  onClose: () => void;
  users: UserProfile[];
  templateProfileUserId: string | null;
  templateProfileText: string;
  setTemplateProfileText: (v: string) => void;
  templateProfilePreview: TemplateProfileParsed | null;
  setTemplateProfilePreview: (v: TemplateProfileParsed | null) => void;
  templateProfileError: string;
  templateProfileSaving: boolean;
  onParse: () => void;
  onSave: () => void;
}

export function TemplateProfileModal({
  open,
  onClose,
  users,
  templateProfileUserId,
  templateProfileText,
  setTemplateProfileText,
  templateProfilePreview,
  setTemplateProfilePreview,
  templateProfileError,
  templateProfileSaving,
  onParse,
  onSave,
}: TemplateProfileModalProps) {
  if (!open) return null;
  const user = users.find(u => u.id === templateProfileUserId);
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">New profile from template — {user?.name}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <p className="text-sm text-gray-600 mb-3">Paste the contractor's bank-details reply. The parser accepts <code>Label: value</code> and <code>Label :- value</code>. Empty values are fine.</p>
          <textarea
            value={templateProfileText}
            onChange={e => setTemplateProfileText(e.target.value)}
            rows={12}
            placeholder={`Full Company Name: ...\nCompany Address: ...\nCountry: ...\nBank Name: ...\nBank Address: ...\nBank Branch:\nAccount Number:\nIBAN/IFSC: ...\nSWIFT: ...\nEmail Address for Payment Notification: ...`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-indigo-500 mb-3"
          />
          {!templateProfilePreview && (
            <div className="flex justify-end mb-3">
              <button onClick={onParse} disabled={!templateProfileText.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium">Parse</button>
            </div>
          )}
          {templateProfileError && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">{templateProfileError}</div>}
          {templateProfilePreview && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-gray-500 mb-2">PARSED — edit before saving if needed</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {([
                  ['Company Name *', 'companyName'],
                  ['Company Address', 'companyAddress'],
                  ['Country', 'country'],
                  ['Bank Name', 'bankName'],
                  ['Bank Address', 'bankAddress'],
                  ['Bank Branch', 'bankBranch'],
                  ['Account Number', 'accountNumber'],
                  ['IBAN / IFSC *', 'iban'],
                  ['SWIFT *', 'swift'],
                  ['Payment Email', 'paymentEmail'],
                ] as const).map(([label, key]) => (
                  <label key={key} className="block">
                    <span className="text-xs text-gray-500">{label}</span>
                    <input
                      type="text"
                      value={templateProfilePreview[key]}
                      onChange={e => setTemplateProfilePreview({ ...templateProfilePreview, [key]: e.target.value })}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm mt-0.5 font-mono focus:ring-1 focus:ring-indigo-400"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setTemplateProfilePreview(null)} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Re-parse</button>
                <button onClick={onSave} disabled={templateProfileSaving} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium">
                  {templateProfileSaving ? 'Saving…' : 'Create profile'}
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-400">After saving, the profile appears in the "Awaiting Convera setup" panel (Import Payments → Convera Beneficiaries) with a generated SYN vendor code. Enter that in Convera when adding the beneficiary, then re-import to close the loop.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
