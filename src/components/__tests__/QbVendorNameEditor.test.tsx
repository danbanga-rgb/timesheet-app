// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QbVendorNameEditor from '../QbVendorNameEditor';

const SUG = ['Acme Corp', 'Bimosoft', 'TCode'];

describe('QbVendorNameEditor (PP2)', () => {
  it('pre-fills the input from initialValue', () => {
    render(<QbVendorNameEditor initialValue="Acme Corp" suggestions={SUG} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('Acme Corp');
  });

  it('fires onSave with the current value when ✓ is clicked', () => {
    const onSave = vi.fn();
    render(<QbVendorNameEditor initialValue="" suggestions={SUG} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TCode' } });
    fireEvent.click(screen.getByText('✓'));
    expect(onSave).toHaveBeenCalledWith('TCode');
  });

  it('fires onSave when Enter is pressed', () => {
    const onSave = vi.fn();
    render(<QbVendorNameEditor initialValue="Bimosoft" suggestions={SUG} onSave={onSave} onCancel={() => {}} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('Bimosoft');
  });

  it('fires onCancel when ✕ is clicked', () => {
    const onCancel = vi.fn();
    render(<QbVendorNameEditor initialValue="x" suggestions={SUG} onSave={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('fires onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(<QbVendorNameEditor initialValue="x" suggestions={SUG} onSave={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
