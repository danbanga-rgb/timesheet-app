// @vitest-environment jsdom
//
// Smoke test proving the X1 component-test scaffold works end-to-end:
// jsdom environment loads, @testing-library/react renders a real component,
// @testing-library/jest-dom matchers register on Vitest's expect, user
// interactions dispatch to React handlers.
//
// Added as Slice X1 of the accountant modularization arc (2026-09-16).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MonthRangePicker from '../MonthRangePicker';

describe('MonthRangePicker (X1 smoke)', () => {
  it('renders the default "Quick Select — Month" group with 6 preset buttons', () => {
    render(
      <MonthRangePicker
        value={{ start: '', end: '' }}
        onChange={() => {}}
      />
    );
    expect(screen.getByText(/Quick Select — Month/)).toBeInTheDocument();
    // buildMonthPresets(6) → 6 buttons in the default group.
    const buttons = screen.getAllByRole('button');
    // 6 preset buttons + no Clear button (start/end both empty).
    expect(buttons).toHaveLength(6);
  });

  it('fires onChange with the preset range when a preset is clicked', () => {
    const onChange = vi.fn();
    render(
      <MonthRangePicker
        value={{ start: '', end: '' }}
        onChange={onChange}
        presets={[{
          group: 'Custom presets',
          options: [{ label: 'March 2026', start: '2026-03-01', end: '2026-03-31' }],
        }]}
      />
    );
    fireEvent.click(screen.getByText('March 2026'));
    expect(onChange).toHaveBeenCalledWith({ start: '2026-03-01', end: '2026-03-31' });
  });

  it('shows a Clear button once a range is applied', () => {
    render(
      <MonthRangePicker
        value={{ start: '2026-03-01', end: '2026-03-31' }}
        onChange={() => {}}
      />
    );
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });
});
