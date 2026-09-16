// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../StatusBadge';

describe('StatusBadge (A10)', () => {
  it('renders tone class + children', () => {
    render(<StatusBadge tone="green">Approved</StatusBadge>);
    const el = screen.getByText('Approved');
    expect(el.className).toMatch(/bg-green-100/);
    expect(el.className).toMatch(/text-green-800/);
  });

  it('sizes: sm/md/lg', () => {
    const { unmount: u1 } = render(<StatusBadge tone="red" size="sm">a</StatusBadge>);
    expect(screen.getByText('a').className).toMatch(/px-1\.5/);
    u1();
    const { unmount: u2 } = render(<StatusBadge tone="red" size="md">b</StatusBadge>);
    expect(screen.getByText('b').className).toMatch(/px-2\b/);
    u2();
    render(<StatusBadge tone="red" size="lg">c</StatusBadge>);
    expect(screen.getByText('c').className).toMatch(/px-3/);
  });

  it('shape: pill vs rounded', () => {
    const { unmount } = render(<StatusBadge tone="blue" shape="pill">x</StatusBadge>);
    expect(screen.getByText('x').className).toMatch(/rounded-full/);
    unmount();
    render(<StatusBadge tone="blue" shape="rounded">y</StatusBadge>);
    expect(screen.getByText('y').className).not.toMatch(/rounded-full/);
    expect(screen.getByText('y').className).toMatch(/rounded/);
  });
});
