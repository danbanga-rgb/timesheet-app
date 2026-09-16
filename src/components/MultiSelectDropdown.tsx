import { useState, type ReactNode } from 'react';

// A generic multi-select dropdown with search, "Select all" / "Clear" quick
// actions, per-option meta text, and a Done button that closes the panel.
// The caller owns the `selected` array (the data); the component owns the
// UI-local `open` + `search` state internally.
//
// Extracted from the Timesheet-Only tab as Slice T1 of the accountant
// modularization arc (2026-09-16). Additional planned consumers: Invoice
// contractor picker (Chunk 6), Convera Matching picker (Chunk 7), Payment
// Import unmatched picker (Chunk 9 modals sweep).

export interface MultiSelectOption {
  id: string;
  label: string;
  meta?: string; // right-aligned subtitle (e.g. country name)
}

export interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** noun for "X of Y {noun} selected" header. Default: 'items'. */
  itemNoun?: string;
  /** default true. */
  searchable?: boolean;
  searchPlaceholder?: string;
  doneLabel?: string;
  emptyLabel?: string;
  className?: string;
  /** Accent color; matches MonthRangePicker convention. Default 'indigo'. */
  variant?: 'indigo' | 'teal';
}

export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  itemNoun = 'items',
  searchable = true,
  searchPlaceholder = 'Search...',
  doneLabel = 'Done',
  emptyLabel = 'No matches',
  className,
  variant = 'indigo',
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const accentText = variant === 'teal' ? 'text-teal-600' : 'text-indigo-600';
  const accentBg = variant === 'teal' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-indigo-600 hover:bg-indigo-700';
  const accentBorder = variant === 'teal' ? 'hover:border-teal-400 focus:ring-teal-500' : 'hover:border-indigo-400 focus:ring-indigo-500';
  const accentHoverRow = variant === 'teal' ? 'hover:bg-teal-50' : 'hover:bg-indigo-50';
  const accentSearchRing = variant === 'teal' ? 'focus:ring-teal-400' : 'focus:ring-indigo-400';
  const accentCheckbox = variant === 'teal' ? 'text-teal-600' : 'text-indigo-600';

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(x => x !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const headerLabel: ReactNode = selected.length === options.length
    ? `All ${itemNoun} selected`
    : `${selected.length} of ${options.length} ${itemNoun} selected`;

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 ${accentBorder}`}
      >
        <span className="text-gray-700">{headerLabel}</span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        // z-40 is the canonical dropdown layer for this codebase. Clears
        // sticky table headers (`sticky top-0 z-20`) AND frozen first
        // columns (`sticky left-0 z-30`) across every accountant table.
        // Stays below modals (`z-50`).
        <div className="absolute z-40 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className={`w-full px-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 ${accentSearchRing}`}
                autoFocus
              />
            </div>
          )}
          <div className="flex gap-2 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
            <button
              type="button"
              onClick={() => onChange(options.map(o => o.id))}
              className={`text-xs ${accentText} hover:underline font-medium`}
            >Select all</button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-gray-500 hover:underline"
            >Clear</button>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">{emptyLabel}</p>
            ) : (
              filtered.map(o => (
                <label key={o.id} className={`flex items-center gap-3 px-3 py-2 ${accentHoverRow} cursor-pointer`}>
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={() => toggle(o.id)}
                    className={`w-4 h-4 rounded ${accentCheckbox}`}
                  />
                  <span className="text-sm text-gray-800">{o.label}</span>
                  {o.meta && <span className="text-xs text-gray-400 ml-auto">{o.meta}</span>}
                </label>
              ))
            )}
          </div>
          <div className="p-2 border-t border-gray-100 bg-gray-50 text-right">
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(''); }}
              className={`px-3 py-1.5 ${accentBg} text-white text-xs rounded-lg`}
            >{doneLabel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
