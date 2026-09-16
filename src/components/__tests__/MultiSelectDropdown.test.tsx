// @vitest-environment jsdom
//
// Slice T1: locks the observable behaviors that 3 upcoming call sites
// (Invoice contractor picker, Convera Matching, Payment Import unmatched)
// will rely on when they replace their inline pickers with this component.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MultiSelectDropdown, { type MultiSelectOption } from '../MultiSelectDropdown';

const OPTIONS: MultiSelectOption[] = [
  { id: 'u1', label: 'Aleksandar Aleksic', meta: 'Serbia' },
  { id: 'u2', label: 'Arpit Sharma',       meta: 'India' },
  { id: 'u3', label: 'Iskra Kochova',      meta: 'North Macedonia' },
];

describe('MultiSelectDropdown (T1)', () => {
  it('renders header with "X of Y {noun} selected" copy', () => {
    render(
      <MultiSelectDropdown
        options={OPTIONS}
        selected={['u1']}
        onChange={() => {}}
        itemNoun="users"
      />
    );
    expect(screen.getByText('1 of 3 users selected')).toBeInTheDocument();
  });

  it('renders header with "All {noun} selected" copy when selected covers all options', () => {
    render(
      <MultiSelectDropdown
        options={OPTIONS}
        selected={['u1', 'u2', 'u3']}
        onChange={() => {}}
        itemNoun="users"
      />
    );
    expect(screen.getByText('All users selected')).toBeInTheDocument();
  });

  it('opens on trigger click and closes on Done', () => {
    render(
      <MultiSelectDropdown
        options={OPTIONS}
        selected={[]}
        onChange={() => {}}
      />
    );
    // Not open: search box absent
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('0 of 3 items selected'));
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Done'));
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
  });

  it('filters options by search substring (case-insensitive)', () => {
    render(
      <MultiSelectDropdown
        options={OPTIONS}
        selected={[]}
        onChange={() => {}}
      />
    );
    fireEvent.click(screen.getByText('0 of 3 items selected'));
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'arp' } });
    expect(screen.getByText('Arpit Sharma')).toBeInTheDocument();
    expect(screen.queryByText('Aleksandar Aleksic')).not.toBeInTheDocument();
    expect(screen.queryByText('Iskra Kochova')).not.toBeInTheDocument();
  });

  it('Select all fires onChange with every option id', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown options={OPTIONS} selected={[]} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('0 of 3 items selected'));
    fireEvent.click(screen.getByText('Select all'));
    expect(onChange).toHaveBeenCalledWith(['u1', 'u2', 'u3']);
  });

  it('Clear fires onChange with an empty array', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown options={OPTIONS} selected={['u1', 'u2']} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('2 of 3 items selected'));
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('checkbox toggle adds an unselected id via onChange', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown options={OPTIONS} selected={['u1']} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('1 of 3 items selected'));
    // Click Arpit's row → adds u2 to selection
    fireEvent.click(screen.getByText('Arpit Sharma'));
    expect(onChange).toHaveBeenCalledWith(['u1', 'u2']);
  });

  it('checkbox toggle removes an already-selected id via onChange', () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown options={OPTIONS} selected={['u1', 'u2']} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('2 of 3 items selected'));
    fireEvent.click(screen.getByText('Aleksandar Aleksic'));
    expect(onChange).toHaveBeenCalledWith(['u2']);
  });

  it('shows meta subtitle on each option row when present', () => {
    render(
      <MultiSelectDropdown options={OPTIONS} selected={[]} onChange={() => {}} />
    );
    fireEvent.click(screen.getByText('0 of 3 items selected'));
    expect(screen.getByText('Serbia')).toBeInTheDocument();
    expect(screen.getByText('India')).toBeInTheDocument();
    expect(screen.getByText('North Macedonia')).toBeInTheDocument();
  });
});
