import { useEffect, useState } from 'react';
import { formatDate } from '../lib/dates';

export interface PresetOption {
  label: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

export interface PresetGroup {
  group?: string;         // optional section label above the button row
  options: PresetOption[];
}

export interface MonthRangePickerProps {
  value: { start: string; end: string };
  onChange: (range: { start: string; end: string }) => void;
  presets?: PresetGroup[];     // default: one group "Quick Select — Month" with last 6 months
  variant?: 'indigo' | 'teal'; // accent color (VendorManager is teal, everyone else indigo)
  showCustomRange?: boolean;   // default true; custom-range inputs auto-apply when both dates valid
  className?: string;          // override outer container class
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isValidIsoDate = (s: string): boolean => ISO_DATE.test(s) && !isNaN(new Date(s).getTime());

// Last N months as PresetOptions (month=long label, YYYY-MM-DD start/end).
export function buildMonthPresets(count = 6): PresetOption[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      start: formatDate(firstDay),
      end: formatDate(lastDay),
    };
  });
}

export default function MonthRangePicker({
  value,
  onChange,
  presets,
  variant = 'indigo',
  showCustomRange = true,
  className,
}: MonthRangePickerProps) {
  const groups: PresetGroup[] = presets ?? [
    { group: 'Quick Select — Month', options: buildMonthPresets(6) },
  ];

  // Local mirror of the custom-range inputs. Uncommitted until both are valid;
  // then we auto-fire onChange. Presets bypass this and fire onChange directly.
  const [customStart, setCustomStart] = useState(value.start);
  const [customEnd, setCustomEnd] = useState(value.end);

  useEffect(() => {
    setCustomStart(value.start);
    setCustomEnd(value.end);
  }, [value.start, value.end]);

  const tryCommitCustom = (nextStart: string, nextEnd: string): void => {
    if (nextStart === '' && nextEnd === '') {
      onChange({ start: '', end: '' });
      return;
    }
    if (isValidIsoDate(nextStart) && isValidIsoDate(nextEnd)) {
      onChange({ start: nextStart, end: nextEnd });
    }
    // else: user is mid-edit; hold silently
  };

  const isActive = (opt: PresetOption): boolean =>
    value.start === opt.start && value.end === opt.end;

  const activeBg = variant === 'teal' ? 'bg-teal-600 border-teal-600' : 'bg-indigo-600 border-indigo-600';
  const hover = variant === 'teal' ? 'hover:border-teal-400 hover:text-teal-600' : 'hover:border-indigo-400 hover:text-indigo-600';
  const focusRing = variant === 'teal' ? 'focus:ring-teal-500' : 'focus:ring-indigo-500';

  return (
    <div className={className ?? 'bg-gray-50 border border-gray-200 rounded-lg p-4'}>
      {groups.map((g, gi) => (
        <div key={gi} className={gi === 0 ? 'mb-4' : 'mb-4 pt-3 border-t border-gray-200'}>
          {g.group && (
            <label className="block text-sm font-semibold text-gray-700 mb-2">{g.group}</label>
          )}
          <div className="flex flex-wrap gap-2">
            {g.options.map(opt => (
              <button
                key={`${opt.start}-${opt.end}-${opt.label}`}
                onClick={() => onChange({ start: opt.start, end: opt.end })}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  isActive(opt)
                    ? `${activeBg} text-white`
                    : `bg-white text-gray-700 border-gray-300 ${hover}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {showCustomRange && (
        <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-gray-200">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
            <input
              type="date"
              value={customStart}
              onChange={e => { setCustomStart(e.target.value); tryCommitCustom(e.target.value, customEnd); }}
              className={`px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 ${focusRing}`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
            <input
              type="date"
              value={customEnd}
              onChange={e => { setCustomEnd(e.target.value); tryCommitCustom(customStart, e.target.value); }}
              className={`px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 ${focusRing}`}
            />
          </div>
          {(value.start || value.end) && (
            <button
              onClick={() => onChange({ start: '', end: '' })}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
