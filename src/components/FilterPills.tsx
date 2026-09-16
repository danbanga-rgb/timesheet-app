// FilterPills — horizontal row of clickable filter pills, one active at a
// time. Active pill gets a ring; inactive gets hover:opacity-80.
//
// Common pattern in TS.tsx across Admin user-role filter, Payments state
// filter, and Convera beneficiary filter. Extracted as Slice PP1 of the
// accountant modularization arc (2026-09-16). Base API is minimum useful;
// extend retroactively (Q9.3) with optionRenderer / renderExtra / grouped
// variant as later consumers reveal needs.

export interface FilterPillOption<T extends string> {
  value: T;
  /** Consumer builds the full display string, incl. any "(n)" / ": n" count. */
  label: string;
  /** Tailwind color classes, e.g. 'bg-yellow-100 text-yellow-700'. */
  tone: string;
}

export interface FilterPillsProps<T extends string> {
  options: FilterPillOption<T>[];
  selected: T;
  onChange: (next: T) => void;
  className?: string;
  /** Extra tone applied to the ring on the active pill. Default indigo. */
  ringTone?: 'indigo' | 'teal';
}

export default function FilterPills<T extends string>({
  options,
  selected,
  onChange,
  className,
  ringTone = 'indigo',
}: FilterPillsProps<T>) {
  const ringCls = ringTone === 'teal' ? 'ring-teal-400' : 'ring-indigo-400';
  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ''}`.trim()}>
      {options.map(opt => {
        const isActive = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${opt.tone} ${isActive ? `ring-2 ring-offset-1 ${ringCls}` : 'hover:opacity-80'}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
