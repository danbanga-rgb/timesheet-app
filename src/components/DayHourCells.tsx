import type { ReactNode } from 'react';
import { getWeekDates, formatDate } from '../lib/dates';
import type { TimeEntry } from '../types';

export const WEEKDAY_LABELS_MON_SUN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const DEFAULT_CELL_CLASS = 'border border-gray-200 px-3 py-2 text-center';
const DEFAULT_TOTAL_CLASS = 'border border-gray-200 px-3 py-2 text-center font-bold text-indigo-600';

type Entries = Record<string, TimeEntry>;

export function computeDailyHours(entries: Entries, weekStart: Date): { dailyHours: number[]; total: number } {
  const dates = getWeekDates(weekStart);
  const dailyHours = dates.map(d => parseFloat(entries[formatDate(d)]?.hours || '0'));
  const total = dailyHours.reduce((s, h) => s + h, 0);
  return { dailyHours, total };
}

type Props = {
  entries: Entries;
  weekStart: Date;
  cellClassName?: string;
  totalClassName?: string;
  emptyPlaceholder?: ReactNode;
  onCellClick?: () => void;
};

export default function DayHourCells({
  entries,
  weekStart,
  cellClassName = DEFAULT_CELL_CLASS,
  totalClassName = DEFAULT_TOTAL_CLASS,
  emptyPlaceholder = <span className="text-gray-300">—</span>,
  onCellClick,
}: Props) {
  const { dailyHours, total } = computeDailyHours(entries, weekStart);
  return (
    <>
      {dailyHours.map((h, i) => (
        <td key={i} className={cellClassName} onClick={onCellClick}>
          {h > 0 ? h.toFixed(1) : emptyPlaceholder}
        </td>
      ))}
      <td className={totalClassName} onClick={onCellClick}>{total.toFixed(1)}</td>
    </>
  );
}
