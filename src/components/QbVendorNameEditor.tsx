import { useEffect, useId, useState } from 'react';

// Inline editor for a QB vendor name: text input with datalist autocomplete
// suggestions + ✓ / ✕ buttons. Component owns its edit-value state; caller
// owns the "is this row being edited?" state and mounts/unmounts the editor
// per row.
//
// Extracted as Slice PP2 of the accountant modularization arc (2026-09-16).
// Consumers: Payment Profiles tab QB vendor cell, QbExport modal per-invoice
// vendor override.

export interface QbVendorNameEditorProps {
  /** Initial input value (pre-populated when the caller enters edit mode). */
  initialValue: string;
  /** Autocomplete suggestions (rendered inside an internal datalist). */
  suggestions: string[];
  /** Called with the current input value when the user commits (Enter or ✓). */
  onSave: (value: string) => void;
  /** Called when the user cancels (Escape or ✕). */
  onCancel: () => void;
  /** Optional placeholder. Default: "Type or pick a vendor..." */
  placeholder?: string;
  /** Optional min-width for the input. Default: 220px. */
  inputMinWidth?: number;
}

export default function QbVendorNameEditor({
  initialValue,
  suggestions,
  onSave,
  onCancel,
  placeholder = 'Type or pick a vendor...',
  inputMinWidth = 220,
}: QbVendorNameEditorProps) {
  const [value, setValue] = useState(initialValue);
  const listId = useId();

  // Track initialValue changes across remounts of the same row.
  useEffect(() => { setValue(initialValue); }, [initialValue]);

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        list={listId}
        value={value}
        autoFocus
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSave(value);
          if (e.key === 'Escape') onCancel();
        }}
        placeholder={placeholder}
        style={{ minWidth: inputMinWidth }}
        className="px-2 py-1 border border-indigo-400 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
      />
      <datalist id={listId}>
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
      <button onClick={() => onSave(value)} className="text-green-600 hover:underline text-xs">✓</button>
      <button onClick={onCancel} className="text-gray-500 hover:underline text-xs">✕</button>
    </div>
  );
}
