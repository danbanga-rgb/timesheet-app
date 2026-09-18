// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import InvoiceReconBadge from '../InvoiceReconBadge';

describe('InvoiceReconBadge (I6)', () => {
  it('renders green Matched pill for matched status', () => {
    render(<InvoiceReconBadge status="matched" delta={0} tsHours={40} />);
    const pill = screen.getByText('✓ Matched');
    expect(pill.className).toMatch(/bg-green-100/);
    expect(pill.className).toMatch(/text-green-700/);
  });

  it('renders red pill with ▲ + Nh when delta > 0 (invoice over TS)', () => {
    render(<InvoiceReconBadge status="mismatch" delta={5} tsHours={35} />);
    const pill = screen.getByText('▲ +5h');
    expect(pill.className).toMatch(/bg-red-100/);
    expect(pill.className).toMatch(/text-red-700/);
  });

  it('renders amber pill with ▽ Nh when delta <= 0 (invoice under TS)', () => {
    render(<InvoiceReconBadge status="mismatch" delta={-3} tsHours={43} />);
    const pill = screen.getByText('▽ -3h');
    expect(pill.className).toMatch(/bg-amber-100/);
    expect(pill.className).toMatch(/text-amber-700/);
  });

  it('renders amber Mismatch pill when status=mismatch but delta is null', () => {
    render(<InvoiceReconBadge status="mismatch" delta={null} tsHours={40} />);
    const pill = screen.getByText('⚠ Mismatch');
    expect(pill.className).toMatch(/bg-amber-100/);
  });

  it('renders gray unverifiable pill when tsHours null', () => {
    render(<InvoiceReconBadge status="unverifiable" delta={null} tsHours={null} />);
    const pill = screen.getByText('? —');
    expect(pill.className).toMatch(/bg-gray-100/);
    expect(pill.className).toMatch(/text-gray-500/);
  });

  it('shows TS: line when tsHours is non-null and showTsHours default (true)', () => {
    render(<InvoiceReconBadge status="matched" delta={0} tsHours={40} />);
    expect(screen.getByText(/TS: 40h/)).toBeInTheDocument();
  });

  it('hides TS: line when showTsHours=false (row-compact)', () => {
    render(<InvoiceReconBadge status="matched" delta={0} tsHours={40} showTsHours={false} />);
    expect(screen.queryByText(/TS:/)).not.toBeInTheDocument();
  });

  it('hides TS: line when tsHours is null', () => {
    render(<InvoiceReconBadge status="unverifiable" delta={null} tsHours={null} />);
    expect(screen.queryByText(/TS:/)).not.toBeInTheDocument();
  });

  it('renders missingText in red when provided', () => {
    render(
      <InvoiceReconBadge
        status="mismatch"
        delta={5}
        tsHours={35}
        missingText="2 weeks with no TS"
      />
    );
    const note = screen.getByText('2 weeks with no TS');
    expect(note.className).toMatch(/text-red-400/);
  });

  it('omits missingText slot when missingText is null', () => {
    render(<InvoiceReconBadge status="matched" delta={0} tsHours={40} missingText={null} />);
    expect(screen.queryByText(/wk|week|missing/)).not.toBeInTheDocument();
  });

  it('applies tooltip via title attribute on the outer div', () => {
    const { container } = render(
      <InvoiceReconBadge
        status="matched"
        delta={0}
        tsHours={40}
        tooltip="Timesheet: 40h · Invoice: 40h"
      />
    );
    const outer = container.querySelector('div');
    expect(outer?.getAttribute('title')).toBe('Timesheet: 40h · Invoice: 40h');
  });
});
