import { useId, useMemo, useState } from 'react';
import type { QbVendorRow } from '../../../lib/qbStateSync/types';
import type { Candidate, Confidence } from '../../../lib/qbAutomation/vendorMappingResolver';

// V8-B inline QB-vendor override for Ready rows. Click-to-edit shows this
// inline in place of the static vendor name. Save-as-mapping only (Dan
// chose Option A over the "just this push" secondary mode — pp is 1:1
// with contractor so a real fix is almost always permanent). If we ever
// add a per-push override, extend here + thread through onPushRows.

export interface InlineVendorPickerProps {
  initialValue: string;
  vendors: QbVendorRow[];
  candidates: Candidate[];
  onSave: (args: { qbVendorListId: string; qbVendorName: string }) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

function confidenceChipClass(c: Confidence): string {
  return c === 'high'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200'
    : c === 'medium'
      ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
      : 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200';
}

export default function InlineVendorPicker({
  initialValue,
  vendors,
  candidates,
  onSave,
  onCancel,
  saving = false,
}: InlineVendorPickerProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const vendorByLowerName = useMemo(
    () => new Map(vendors.map(v => [v.name.toLowerCase().trim(), v])),
    [vendors],
  );

  const commit = async () => {
    const name = value.trim();
    if (!name) {
      setError('Pick a QB vendor.');
      return;
    }
    const vendor = vendorByLowerName.get(name.toLowerCase());
    if (!vendor) {
      setError('No QB vendor with that name. Sync Vendors first if it was just added.');
      return;
    }
    setError(null);
    await onSave({ qbVendorListId: vendor.listId, qbVendorName: vendor.name });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 flex-wrap">
        <input
          type="text"
          list={listId}
          value={value}
          autoFocus
          disabled={saving}
          onChange={e => { setValue(e.target.value); if (error) setError(null); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { void commit(); }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="Type or pick a QB vendor…"
          style={{ minWidth: 220 }}
          className="px-2 py-1 border border-indigo-400 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
        />
        <datalist id={listId}>
          {vendors.map(v => <option key={v.listId} value={v.name} />)}
        </datalist>
        <button
          onClick={() => { void commit(); }}
          disabled={saving}
          className="px-2 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save mapping'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[10px] uppercase text-gray-400 mr-1">Suggested:</span>
          {candidates.map(c => (
            <button
              key={c.qbVendorListId}
              type="button"
              disabled={saving}
              onClick={() => { setValue(c.qbVendorName); if (error) setError(null); }}
              className={
                'px-2 py-0.5 text-[11px] rounded-full border cursor-pointer disabled:opacity-50 ' +
                confidenceChipClass(c.confidence)
              }
              title={`${c.reason} · ${c.confidence}`}
            >
              {c.qbVendorName}
              <span className="ml-1 opacity-70 text-[10px]">{c.confidence}</span>
            </button>
          ))}
        </div>
      )}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
