// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InlineVendorPicker from '../InlineVendorPicker';
import type { QbVendorRow } from '../../../../lib/qbStateSync/types';
import type { Candidate } from '../../../../lib/qbAutomation/vendorMappingResolver';

const VENDORS: QbVendorRow[] = [
  { listId: 'v1', name: 'Acme Corp', isActive: true },
  { listId: 'v2', name: 'Bimosoft — Ajdin', isActive: true },
  { listId: 'v3', name: 'TCode LLC', isActive: true },
];

const CANDIDATES: Candidate[] = [
  { qbVendorListId: 'v2', qbVendorName: 'Bimosoft — Ajdin', confidence: 'high', tier: 'history', reason: 'prior bills' },
  { qbVendorListId: 'v3', qbVendorName: 'TCode LLC', confidence: 'medium', tier: 'token_overlap', reason: 'token overlap' },
];

describe('InlineVendorPicker (V8-B)', () => {
  it('pre-fills the input with initialValue', () => {
    render(
      <InlineVendorPicker
        initialValue="Acme Corp"
        vendors={VENDORS}
        candidates={[]}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('Acme Corp');
  });

  it('calls onSave with the matched vendor listId + name when Save clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineVendorPicker
        initialValue=""
        vendors={VENDORS}
        candidates={[]}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'TCode LLC' } });
    fireEvent.click(screen.getByText('Save mapping'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ qbVendorListId: 'v3', qbVendorName: 'TCode LLC' }));
  });

  it('commits on Enter', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineVendorPicker
        initialValue="Acme Corp"
        vendors={VENDORS}
        candidates={[]}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ qbVendorListId: 'v1', qbVendorName: 'Acme Corp' }));
  });

  it('shows error when value does not match any vendor', async () => {
    const onSave = vi.fn();
    render(
      <InlineVendorPicker
        initialValue=""
        vendors={VENDORS}
        candidates={[]}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Nonexistent' } });
    fireEvent.click(screen.getByText('Save mapping'));
    expect(await screen.findByText(/No QB vendor with that name/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows error when input is empty on save', async () => {
    const onSave = vi.fn();
    render(
      <InlineVendorPicker
        initialValue=""
        vendors={VENDORS}
        candidates={[]}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Save mapping'));
    expect(await screen.findByText(/Pick a QB vendor/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('fires onCancel when Cancel clicked', () => {
    const onCancel = vi.fn();
    render(
      <InlineVendorPicker
        initialValue="x"
        vendors={VENDORS}
        candidates={[]}
        onSave={async () => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('fires onCancel on Escape', () => {
    const onCancel = vi.fn();
    render(
      <InlineVendorPicker
        initialValue="x"
        vendors={VENDORS}
        candidates={[]}
        onSave={async () => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicking a candidate chip fills the input', () => {
    render(
      <InlineVendorPicker
        initialValue=""
        vendors={VENDORS}
        candidates={CANDIDATES}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Bimosoft — Ajdin'));
    expect(screen.getByRole('combobox')).toHaveValue('Bimosoft — Ajdin');
  });

  it('disables Save + Cancel while saving', () => {
    render(
      <InlineVendorPicker
        initialValue="Acme Corp"
        vendors={VENDORS}
        candidates={[]}
        onSave={async () => {}}
        onCancel={() => {}}
        saving
      />,
    );
    const save = screen.getByText('Saving…');
    expect(save).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('clears prior error when user edits the input', async () => {
    render(
      <InlineVendorPicker
        initialValue=""
        vendors={VENDORS}
        candidates={[]}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Save mapping'));
    expect(await screen.findByText(/Pick a QB vendor/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'A' } });
    expect(screen.queryByText(/Pick a QB vendor/i)).not.toBeInTheDocument();
  });
});
