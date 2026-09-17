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

describe('FilterPills (I2 extensions)', () => {
  const multiOpts = [
    { value: 'a', label: 'A', activeTone: 'bg-indigo-600', inactiveTone: 'bg-white' },
    { value: 'b', label: 'B', activeTone: 'bg-indigo-600', inactiveTone: 'bg-white' },
    { value: 'c', label: 'C', activeTone: 'bg-indigo-600', inactiveTone: 'bg-white' },
  ];

  it('multi mode: toggles inclusion in Set on click', () => {
    const onChange = vi.fn();
    render(<FilterPills multi shape="button" options={multiOpts} selected={new Set(['a'])} onChange={onChange} />);
    fireEvent.click(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith(new Set(['a', 'b']));
  });

  it('multi mode: click on active pill removes it', () => {
    const onChange = vi.fn();
    render(<FilterPills multi shape="button" options={multiOpts} selected={new Set(['a'])} onChange={onChange} />);
    fireEvent.click(screen.getByText('A'));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('multi mode: reset button clears the set', () => {
    const onChange = vi.fn();
    render(
      <FilterPills
        multi shape="button" options={multiOpts}
        selected={new Set(['a', 'b'])} onChange={onChange}
        resetLabel="All" resetActiveTone="active" resetInactiveTone="inactive"
      />
    );
    fireEvent.click(screen.getByText('All'));
    expect(onChange).toHaveBeenCalledWith(new Set());
  });

  it('multi mode: reset shows active tone when set is empty', () => {
    render(
      <FilterPills
        multi shape="button" options={multiOpts}
        selected={new Set()} onChange={() => {}}
        resetLabel="All" resetActiveTone="bg-active-tone" resetInactiveTone="bg-inactive-tone"
      />
    );
    expect(screen.getByText('All').className).toMatch(/bg-active-tone/);
  });

  it('multi mode: active pills use activeTone', () => {
    render(<FilterPills multi shape="button" options={multiOpts} selected={new Set(['a'])} onChange={() => {}} />);
    expect(screen.getByText('A').className).toMatch(/bg-indigo-600/);
    expect(screen.getByText('B').className).toMatch(/bg-white/);
  });

  it('prefix renders before pills', () => {
    render(<FilterPills options={[...OPTS]} selected="all" onChange={() => {}} prefix="Status:" />);
    expect(screen.getByText('Status:')).toBeInTheDocument();
  });

  it('extra slot renders after last pill', () => {
    render(<FilterPills options={[...OPTS]} selected="all" onChange={() => {}} extra={<span>trailing</span>} />);
    expect(screen.getByText('trailing')).toBeInTheDocument();
  });

  it('shape="button" omits ring on active (uses tone-based active state)', () => {
    render(<FilterPills shape="button" options={multiOpts.map(o => ({ ...o, tone: 'x' }))} selected="a" onChange={() => {}} />);
    expect(screen.getByText('A').className).not.toMatch(/ring-2/);
  });

  it('size="md" uses larger padding/text', () => {
    render(<FilterPills size="md" options={[...OPTS]} selected="all" onChange={() => {}} />);
    expect(screen.getByText('All: 10').className).toMatch(/text-sm/);
    expect(screen.getByText('All: 10').className).toMatch(/py-1\.5/);
  });
});
