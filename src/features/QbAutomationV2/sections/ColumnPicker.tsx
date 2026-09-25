import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Columns3 } from 'lucide-react';
import type { OptionalColumn } from '../hooks/useColumnPrefs';

interface Props<K extends string> {
  columns: readonly OptionalColumn<K>[];
  isOn: (key: K) => boolean;
  onToggle: (key: K) => void;
  onReset: () => void;
}

// V9.10: "Columns ▾" dropdown shared by every V2 table view.
export default function ColumnPicker<K extends string>({ columns, isOn, onToggle, onReset }: Props<K>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onCount = columns.filter(c => isOn(c.key)).length;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-600 border border-gray-200 rounded hover:bg-gray-50"
      >
        <Columns3 className="w-3.5 h-3.5" />
        Columns{onCount > 0 && <span className="text-indigo-700"> +{onCount}</span>}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-xs">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400">Extra columns</div>
          {columns.map(c => (
            <label key={c.key} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={isOn(c.key)} onChange={() => onToggle(c.key)} className="rounded" />
              <span className="text-gray-700">{c.label}</span>
            </label>
          ))}
          {onCount > 0 && (
            <button
              type="button"
              onClick={onReset}
              className="w-full text-left px-3 py-1 mt-1 border-t border-gray-100 text-gray-500 hover:text-gray-800"
            >
              Hide all extras
            </button>
          )}
        </div>
      )}
    </div>
  );
}
