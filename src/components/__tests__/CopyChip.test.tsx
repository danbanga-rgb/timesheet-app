// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CopyChip from '../CopyChip';

describe('CopyChip (B6)', () => {
  it('renders the label when not copied', () => {
    render(<CopyChip label="hello" copied={false} onCopy={() => {}} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.queryByText('✓ copied')).not.toBeInTheDocument();
  });

  it('renders "✓ copied" when copied is true', () => {
    render(<CopyChip label="hello" copied={true} onCopy={() => {}} />);
    expect(screen.getByText('✓ copied')).toBeInTheDocument();
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('fires onCopy when clicked', () => {
    const onCopy = vi.fn();
    render(<CopyChip label="click me" copied={false} onCopy={onCopy} />);
    fireEvent.click(screen.getByText('click me'));
    expect(onCopy).toHaveBeenCalled();
  });

  it('applies monospace + size classes', () => {
    render(<CopyChip label="x" copied={false} onCopy={() => {}} size="sm" monospace />);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/font-mono/);
    expect(btn.className).toMatch(/text-\[11px\]/);
  });
});
