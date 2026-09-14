// PayeePicker — sectioned searchable dropdown for Manual Invoice payee selection.
//
// Sections (in order):
//   1. Typical one-offs — role='external_payee', most recently used first
//   2. Contractors that don't invoice through system — role='timesheetuser' + invoice_enabled=false
//   3. Other users — everyone else (collapsed by default)
//   4. + Add new one-off payee — inline NewOneOffPayeePanel

import { useMemo, useState } from 'react';
import NewOneOffPayeePanel from './NewOneOffPayeePanel';
import { createOneOffPayee } from './api';
import type { PayeeCandidate } from './types';

interface Props {
  candidates: PayeeCandidate[];
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  onNewPayeeCreated: (userId: string) => void;
}

export default function PayeePicker({ candidates, selectedUserId, onSelect, onNewPayeeCreated }: Props) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [addingNew, setAddingNew] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(c =>
      c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
  }, [candidates, search]);

  const oneOffs = filtered.filter(c => c.section === 'one-off');
  const contractors = filtered.filter(c => c.section === 'contractor-no-invoice');
  const others = filtered.filter(c => c.section === 'other');

  const selected = selectedUserId ? candidates.find(c => c.userId === selectedUserId) : null;

  return (
    <div className="space-y-2">
      {selected ? (
        <div className="border border-indigo-300 bg-indigo-50 rounded-lg px-3 py-2 flex items-center justify-between">
          <div>
            <div className="font-medium text-sm text-indigo-900">{selected.name}</div>
            <div className="text-xs text-indigo-700">
              {selected.role}{selected.defaultPaymentMethod ? ` · ${selected.defaultPaymentMethod}` : ''}{selected.countryCode ? ` · ${selected.countryCode}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelect('')}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400"
            autoFocus
          />

          <div className="border border-gray-200 rounded-lg max-h-72 overflow-y-auto bg-white">
            {oneOffs.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                  One-off payees ({oneOffs.length})
                </div>
                {oneOffs.map(c => (
                  <PayeeRow key={c.userId} c={c} onSelect={onSelect} />
                ))}
              </div>
            )}

            {contractors.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                  Contractors — no system invoices ({contractors.length})
                </div>
                {contractors.map(c => (
                  <PayeeRow key={c.userId} c={c} onSelect={onSelect} />
                ))}
              </div>
            )}

            {(showAll || search.trim().length > 0) && others.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                  Other users ({others.length})
                </div>
                {others.map(c => (
                  <PayeeRow key={c.userId} c={c} onSelect={onSelect} />
                ))}
              </div>
            )}

            {!showAll && !search.trim() && others.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full text-xs text-gray-500 hover:bg-gray-50 py-2 text-center border-t border-gray-100"
              >
                Show other users ({others.length})
              </button>
            )}

            {filtered.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-6">No matches — try a different search or add a new payee.</div>
            )}
          </div>

          {addingNew ? (
            <NewOneOffPayeePanel
              onCancel={() => setAddingNew(false)}
              onCreated={(userId) => {
                setAddingNew(false);
                onNewPayeeCreated(userId);
              }}
              createPayee={createOneOffPayee}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingNew(true)}
              className="w-full py-2 text-sm text-indigo-600 hover:bg-indigo-50 border border-dashed border-indigo-300 rounded-lg"
            >
              + Add new one-off payee
            </button>
          )}
        </>
      )}
    </div>
  );
}

function PayeeRow({ c, onSelect }: { c: PayeeCandidate; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(c.userId)}
      className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-gray-100 last:border-b-0"
    >
      <div className="text-sm font-medium text-gray-800">{c.name}</div>
      <div className="text-xs text-gray-500">
        {c.email}
        {c.defaultPaymentMethod && <span> · {c.defaultPaymentMethod}</span>}
        {c.countryCode && <span> · {c.countryCode}</span>}
        {!c.hasDefaultProfile && <span className="text-amber-600"> · no default profile</span>}
      </div>
    </button>
  );
}
