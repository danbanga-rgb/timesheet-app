// NewOneOffPayeePanel — inline mini-form embedded in the PayeePicker for
// creating a role='external_payee' profile + default payment_profile.
//
// The external_payee is a persona, not a login. We create an auth user with a
// random password and no invite email; the row is a shell needed by the
// profiles.id → auth.users.id foreign key. Accountant never sees the email.

import { useState } from 'react';
import type { OneOffPayeeDraft } from './types';

interface Props {
  onCancel: () => void;
  onCreated: (userId: string) => void;
  createPayee: (draft: OneOffPayeeDraft) => Promise<{ userId: string; error?: string }>;
}

const initialDraft: OneOffPayeeDraft = {
  name: '',
  email: '',
  iban: '',
  swift: '',
  bankName: '',
  countryCode: 'US',
  paymentMethod: 'Convera',
  qbVendorName: '',
  currency: 'USD',
};

export default function NewOneOffPayeePanel({ onCancel, onCreated, createPayee }: Props) {
  const [draft, setDraft] = useState<OneOffPayeeDraft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = draft.name.trim().length >= 2
    && (draft.paymentMethod === 'Intuit' || draft.iban.trim().length >= 8);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    const { userId, error: err } = await createPayee(draft);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    onCreated(userId);
  }

  return (
    <form onSubmit={handleSubmit} className="border border-indigo-200 bg-indigo-50/40 rounded-lg p-3 space-y-2.5 text-sm">
      <div className="flex justify-between items-center mb-1">
        <div className="font-semibold text-indigo-800">New one-off payee</div>
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:underline">Cancel</button>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-0.5">Name *</label>
        <input
          type="text"
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          placeholder="Monolith LLC"
          required
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">Country</label>
          <input
            type="text"
            value={draft.countryCode}
            onChange={e => setDraft({ ...draft, countryCode: e.target.value.toUpperCase().slice(0, 2) })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm uppercase"
            placeholder="US"
            maxLength={2}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-0.5">Method *</label>
          <select
            value={draft.paymentMethod}
            onChange={e => setDraft({ ...draft, paymentMethod: e.target.value as 'Intuit' | 'Convera' })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
          >
            <option value="Convera">Convera</option>
            <option value="Intuit">Intuit</option>
          </select>
        </div>
      </div>

      {draft.paymentMethod === 'Convera' && (
        <>
          <div>
            <label className="block text-xs text-gray-600 mb-0.5">IBAN / Account *</label>
            <input
              type="text"
              value={draft.iban}
              onChange={e => setDraft({ ...draft, iban: e.target.value.replace(/\s+/g, '').toUpperCase() })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono"
              placeholder="HR39234000..."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">SWIFT / BIC</label>
              <input
                type="text"
                value={draft.swift}
                onChange={e => setDraft({ ...draft, swift: e.target.value.toUpperCase() })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-mono"
                placeholder="PBZGHR2X"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Bank name</label>
              <input
                type="text"
                value={draft.bankName}
                onChange={e => setDraft({ ...draft, bankName: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                placeholder="Privredna Banka Zagreb"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-0.5">Currency</label>
            <select
              value={draft.currency}
              onChange={e => setDraft({ ...draft, currency: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm bg-white"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </>
      )}

      <div>
        <label className="block text-xs text-gray-600 mb-0.5">QB vendor name (optional)</label>
        <input
          type="text"
          value={draft.qbVendorName}
          onChange={e => setDraft({ ...draft, qbVendorName: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
          placeholder="Leave blank to set later in Payment Profiles"
        />
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded"
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create payee'}
        </button>
      </div>
    </form>
  );
}
