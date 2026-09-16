// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SortableHeader from '../SortableHeader';

describe('SortableHeader (B4)', () => {
  it('renders children + indicator', () => {
    render(<table><thead><tr><SortableHeader onClick={() => {}} indicator={<span>▲</span>}>Date</SortableHeader></tr></thead></table>);
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(<table><thead><tr><SortableHeader onClick={onClick}>Amount</SortableHeader></tr></thead></table>);
    fireEvent.click(screen.getByText('Amount'));
    expect(onClick).toHaveBeenCalled();
  });

  it('respects align + hoverClass overrides', () => {
    render(
      <table><thead><tr>
        <SortableHeader onClick={() => {}} align="center" hoverClass="hover:bg-amber-50">Ctr</SortableHeader>
        <SortableHeader onClick={() => {}} align="right">R</SortableHeader>
      </tr></thead></table>
    );
    const ctr = screen.getByText('Ctr').closest('th')!;
    expect(ctr.className).toMatch(/text-center/);
    expect(ctr.className).toMatch(/hover:bg-amber-50/);
    const r = screen.getByText('R').closest('th')!;
    expect(r.className).toMatch(/text-right/);
    expect(r.className).toMatch(/hover:bg-gray-100/); // default hover
  });
});
