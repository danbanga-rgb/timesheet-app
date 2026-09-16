// @vitest-environment jsdom
//
// Slice T2 smoke test.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SourceBadge from '../SourceBadge';

describe('SourceBadge (T2)', () => {
  it('renders green "Portal" pill for direct source', () => {
    render(<SourceBadge source="direct" />);
    const pill = screen.getByText('Portal');
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/bg-green-100/);
    expect(pill.className).toMatch(/text-green-700/);
  });

  it('renders indigo "Email" pill for imported source', () => {
    render(<SourceBadge source="imported" />);
    const pill = screen.getByText('Email');
    expect(pill).toBeInTheDocument();
    expect(pill.className).toMatch(/bg-indigo-100/);
    expect(pill.className).toMatch(/text-indigo-700/);
  });

  it('renders em-dash fallback when source is null', () => {
    render(<SourceBadge source={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('respects custom fallback prop when source is null', () => {
    render(<SourceBadge source={null} fallback={<span>Manual</span>} />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
