// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DayHourCells, { computeDailyHours, WEEKDAY_LABELS_MON_SUN } from '../DayHourCells';
import type { TimeEntry } from '../../types';

const weekStart = new Date(2026, 8, 14); // 2026-09-14 (Mon)

function wrap(el: React.ReactNode) {
  // <td> must live in <table><tbody><tr>...
  return render(<table><tbody><tr>{el}</tr></tbody></table>);
}

describe('DayHourCells (T3)', () => {
  it('renders 7 day cells + 1 total cell', () => {
    const entries: Record<string, TimeEntry> = {
      '2026-09-14': { hours: '8' },
      '2026-09-20': { hours: '6' },
    };
    wrap(<DayHourCells entries={entries} weekStart={weekStart} />);
    const cells = document.querySelectorAll('td');
    expect(cells.length).toBe(8);
    expect(cells[0].textContent).toBe('8.0');
    expect(cells[6].textContent).toBe('6.0');
    expect(cells[7].textContent).toBe('14.0'); // total
  });

  it('empty cells render default placeholder (— in text-gray-300)', () => {
    wrap(<DayHourCells entries={{}} weekStart={weekStart} />);
    const cells = document.querySelectorAll('td');
    // 7 day cells all empty
    for (let i = 0; i < 7; i++) {
      const span = cells[i].querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('—');
      expect(span!.className).toMatch(/text-gray-300/);
    }
    expect(cells[7].textContent).toBe('0.0');
  });

  it('emptyPlaceholder override renders custom node (Manager uses literal "-")', () => {
    wrap(<DayHourCells entries={{}} weekStart={weekStart} emptyPlaceholder="-" />);
    const cells = document.querySelectorAll('td');
    for (let i = 0; i < 7; i++) {
      expect(cells[i].textContent).toBe('-');
      expect(cells[i].querySelector('span')).toBeNull();
    }
  });

  it('cellClassName override applies to all 7 day cells', () => {
    wrap(
      <DayHourCells
        entries={{}}
        weekStart={weekStart}
        cellClassName="border border-gray-300 px-4 py-2 text-center"
      />
    );
    const cells = document.querySelectorAll('td');
    for (let i = 0; i < 7; i++) {
      expect(cells[i].className).toBe('border border-gray-300 px-4 py-2 text-center');
    }
  });

  it('totalClassName override applies to the total cell only', () => {
    wrap(
      <DayHourCells
        entries={{}}
        weekStart={weekStart}
        totalClassName="border border-gray-200 px-3 py-2 text-center font-bold text-teal-700"
      />
    );
    const cells = document.querySelectorAll('td');
    expect(cells[7].className).toBe('border border-gray-200 px-3 py-2 text-center font-bold text-teal-700');
  });

  it('onCellClick fires once per clicked cell (all 8 cells clickable)', () => {
    const onCellClick = vi.fn();
    wrap(
      <DayHourCells
        entries={{ '2026-09-14': { hours: '8' } }}
        weekStart={weekStart}
        onCellClick={onCellClick}
      />
    );
    const cells = document.querySelectorAll('td');
    fireEvent.click(cells[0]); // day 1
    fireEvent.click(cells[7]); // total
    expect(onCellClick).toHaveBeenCalledTimes(2);
  });

  it('undefined onCellClick leaves cells with no click handler', () => {
    wrap(<DayHourCells entries={{}} weekStart={weekStart} />);
    // No throw when clicking with no handler
    const cells = document.querySelectorAll('td');
    fireEvent.click(cells[0]);
    // just verifying no crash
    expect(cells.length).toBe(8);
  });

  it('missing entry hours treated as 0 (safe on partial-week data)', () => {
    const entries: Record<string, TimeEntry> = {
      // hours is required in TimeEntry, but the site code uses `?.hours || '0'`
      // so verify the component tolerates whole-day gaps
    };
    wrap(<DayHourCells entries={entries} weekStart={weekStart} />);
    expect(document.querySelectorAll('td')[7].textContent).toBe('0.0');
  });
});

describe('computeDailyHours (T3 helper)', () => {
  it('sums hours across Mon–Sun', () => {
    const { dailyHours, total } = computeDailyHours(
      {
        '2026-09-14': { hours: '8' },
        '2026-09-15': { hours: '7.5' },
        '2026-09-20': { hours: '4' },
      },
      weekStart
    );
    expect(dailyHours).toEqual([8, 7.5, 0, 0, 0, 0, 4]);
    expect(total).toBe(19.5);
  });

  it('handles empty entries', () => {
    const { dailyHours, total } = computeDailyHours({}, weekStart);
    expect(dailyHours).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(total).toBe(0);
  });
});

describe('WEEKDAY_LABELS_MON_SUN', () => {
  it('exposes the canonical Mon–Sun label array', () => {
    expect([...WEEKDAY_LABELS_MON_SUN]).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});
