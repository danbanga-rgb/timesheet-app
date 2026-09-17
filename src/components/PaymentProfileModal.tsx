import { X, Save } from 'lucide-react';
import type { PaymentProfile, ProfileForm } from '../types';
import { WORLD_COUNTRIES } from '../lib/countries';

// Payment profile create/edit modal. Shared by 3 consumers:
// - Accountant (Payment Profiles tab: New / Edit for any contractor) — mode='full'
// - TimesheetUser (contractor's own management page: New / Edit self) — mode='full'
// - VendorManager (VM's own management page) — mode='basic'
//
// Extracted as slice PP3 of the accountant modularization arc (2026-09-17).
// Fixes shipping bug #1 (§1b-G): accountant "+ New" / "Edit" clicks used to
// be inert because the JSX only existed inside the TSU branch. Now mounted
// at the accountant wrapper too.
//
// mode='basic' drops (companyAddress, country, bankAddress, bankBranch,
// paymentEmail, section headers, helper text) and swaps indigo → teal accent
// to preserve VendorManagerView's existing look.

interface PaymentProfileModalProps {
  open: boolean;
  mode: 'full' | 'basic';
  form: ProfileForm;
  setForm: (form: ProfileForm) => void;
  editingProfile: PaymentProfile | null;
  onSave: () => void;
  onCancel: () => void;
}

export default function PaymentProfileModal({
  open,
  mode,
  form,
  setForm,
  editingProfile,
  onSave,
  onCancel,
}: PaymentProfileModalProps) {
  if (!open) return null;

  const isFull = mode === 'full';
  const ring = isFull ? 'focus:ring-indigo-500' : 'focus:ring-teal-500';
  const saveBg = isFull ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-teal-600 hover:bg-teal-700';
  const sectionText = 'text-indigo-600'; // section headers are indigo in the only mode (full) that renders them
  const checkboxAccent = isFull ? 'accent-indigo-600' : 'accent-teal-600';
  const checkboxId = isFull ? 'isDefault' : 'vmIsDefault';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
          <h3 className="text-lg font-bold text-gray-800">
            {editingProfile ? 'Edit Payment Profile' : 'New Payment Profile'}
          </h3>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isFull ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Profile Label *</label>
                <input
                  type="text"
                  value={form.profileName}
                  onChange={e => setForm({...form, profileName: e.target.value})}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                  placeholder="e.g. My UK Account, US Corp Account"
                />
                <p className="text-xs text-gray-400 mt-1">A short name to identify this profile</p>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className={`text-xs font-semibold ${sectionText} uppercase tracking-wide mb-3`}>Company Details (as per bank account)</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Full Company Name *</label>
                    <input
                      type="text"
                      value={form.companyName}
                      onChange={e => setForm({...form, companyName: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                      placeholder="As per bank account"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Company Address</label>
                    <textarea
                      value={form.companyAddress}
                      onChange={e => setForm({...form, companyAddress: e.target.value})}
                      rows={2}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                      placeholder="As per bank account"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                    <select
                      value={form.country}
                      onChange={e => setForm({...form, country: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm bg-white`}
                    >
                      <option value="">Select country…</option>
                      {WORLD_COUNTRIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <p className={`text-xs font-semibold ${sectionText} uppercase tracking-wide mb-3`}>Bank Details</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name *</label>
                    <input
                      type="text"
                      value={form.bankName}
                      onChange={e => setForm({...form, bankName: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                      placeholder="e.g. HSBC, Barclays"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bank Address</label>
                    <input
                      type="text"
                      value={form.bankAddress}
                      onChange={e => setForm({...form, bankAddress: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                      placeholder="Bank branch address"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Bank Branch</label>
                    <input
                      type="text"
                      value={form.bankBranch}
                      onChange={e => setForm({...form, bankBranch: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                      placeholder="Branch name or sort code"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Account Number *</label>
                    <input
                      type="text"
                      value={form.accountNumber}
                      onChange={e => setForm({...form, accountNumber: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm font-mono`}
                      placeholder="Bank account number"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
                      <input
                        type="text"
                        value={form.iban}
                        onChange={e => setForm({...form, iban: e.target.value.toUpperCase()})}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm font-mono`}
                        placeholder="e.g. GB29 NWBK..."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">SWIFT / BIC *</label>
                      <input
                        type="text"
                        value={form.swift}
                        onChange={e => setForm({...form, swift: e.target.value.toUpperCase()})}
                        className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm font-mono`}
                        placeholder="e.g. NWBKGB2L"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email Address for Payment Notification</label>
                    <input
                      type="email"
                      value={form.paymentEmail}
                      onChange={e => setForm({...form, paymentEmail: e.target.value})}
                      className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                      placeholder="payments@yourcompany.com"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Profile Label *</label>
                <input
                  type="text"
                  value={form.profileName}
                  onChange={e => setForm({...form, profileName: e.target.value})}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                  placeholder="e.g. Vendor Account"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company Name *</label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={e => setForm({...form, companyName: e.target.value})}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name *</label>
                <input
                  type="text"
                  value={form.bankName}
                  onChange={e => setForm({...form, bankName: e.target.value})}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Account Number *</label>
                <input
                  type="text"
                  value={form.accountNumber}
                  onChange={e => setForm({...form, accountNumber: e.target.value})}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm font-mono`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
                  <input
                    type="text"
                    value={form.iban}
                    onChange={e => setForm({...form, iban: e.target.value.toUpperCase()})}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm font-mono`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">SWIFT / BIC *</label>
                  <input
                    type="text"
                    value={form.swift}
                    onChange={e => setForm({...form, swift: e.target.value.toUpperCase()})}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg ${ring} text-sm font-mono`}
                  />
                </div>
              </div>
            </>
          )}

          <div className={`flex items-center gap-2 ${isFull ? 'pt-2' : ''}`}>
            <input
              type="checkbox"
              id={checkboxId}
              checked={form.isDefault}
              onChange={e => setForm({...form, isDefault: e.target.checked})}
              className={`${checkboxAccent} w-4 h-4`}
            />
            <label htmlFor={checkboxId} className="text-sm text-gray-700 cursor-pointer">
              {isFull ? 'Set as default payment profile' : 'Set as default'}
            </label>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onSave}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 ${saveBg} text-white rounded-lg font-medium`}
            >
              <Save className="w-4 h-4" /> Save Profile
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
