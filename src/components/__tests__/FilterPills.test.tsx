// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterPills from '../FilterPills';

const OPTS = [
  { value: 'all',  label: 'All: 10', tone: 'bg-gray-100 text-gray-700' },
  { value: 'red',  label: 'Red: 3',  tone: 'bg-red-100 text-red-700' },
  { value: 'blue', label: 'Blue: 7', tone: 'bg-blue-100 text-blue-700' },
] as const;

describe('FilterPills (PP1)', () => {
  it('renders each option with its tone class', () => {
    render(<FilterPills options={[...OPTS]} selected="all" onChange={() => {}} />);
    expect(screen.getByText('All: 10').className).toMatch(/bg-gray-100/);
    expect(screen.getByText('Red: 3').className).toMatch(/bg-red-100/);
    expect(screen.getByText('Blue: 7').className).toMatch(/bg-blue-100/);
  });

  it('applies ring class to the selected pill only', () => {
    render(<FilterPills options={[...OPTS]} selected="red" onChange={() => {}} />);
    expect(screen.getByText('Red: 3').className).toMatch(/ring-2/);
    expect(screen.getByText('All: 10').className).not.toMatch(/ring-2/);
  });

  it('fires onChange when a non-active pill is clicked', () => {
    const onChange = vi.fn();
    render(<FilterPills options={[...OPTS]} selected="all" onChange={onChange} />);
    fireEvent.click(screen.getByText('Blue: 7'));
    expect(onChange).toHaveBeenCalledWith('blue');
  });
});
