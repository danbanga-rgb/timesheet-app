// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImportIntuitPaymentsXlsx from '../ImportIntuitPaymentsXlsx';
import type { IntuitXlsxRow } from '../../../../lib/parseIntuitXlsx';

const baseProps = {
  open: true,
  onClose: () => {},
  file: null,
  onFileChange: () => {},
  preview: null,
  onCancelPreview: () => {},
  importing: false,
  result: null,
  error: '',
  onParse: () => {},
  onCommit: () => {},
};

describe('ImportIntuitPaymentsXlsx (M0)', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<ImportIntuitPaymentsXlsx {...baseProps} open={false} />);
    expect(container.textContent).toBe('');
  });

  it('renders title + upload card when open', () => {
    render(<ImportIntuitPaymentsXlsx {...baseProps} />);
    expect(screen.getByText('Import Intuit Payments')).toBeInTheDocument();
    expect(screen.getByText(/Click to select .xlsx file/)).toBeInTheDocument();
  });

  it('Parse & Preview button disabled without a file', () => {
    render(<ImportIntuitPaymentsXlsx {...baseProps} />);
    const parseBtn = screen.getByRole('button', { name: /Parse & Preview/ });
    expect(parseBtn).toBeDisabled();
  });

  it('Parse & Preview click calls onParse when file present', () => {
    const onParse = vi.fn();
    const fakeFile = new File(['x'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    render(<ImportIntuitPaymentsXlsx {...baseProps} file={fakeFile} onParse={onParse} />);
    fireEvent.click(screen.getByRole('button', { name: /Parse & Preview/ }));
    expect(onParse).toHaveBeenCalledTimes(1);
  });

  it('error prop renders red banner', () => {
    render(<ImportIntuitPaymentsXlsx {...baseProps} error="Parse failed: bad file" />);
    const banner = screen.getByText(/Parse failed: bad file/);
    expect(banner).toBeInTheDocument();
    expect(banner.className).toMatch(/text-red-600/);
  });

  it('result prop renders success banner with inserted + skipped counts', () => {
    render(<ImportIntuitPaymentsXlsx {...baseProps} result={{ inserted: 5, skipped: 2 }} />);
    expect(screen.getByText(/Imported/)).toBeInTheDocument();
    expect(screen.getByText(/5/)).toBeInTheDocument();
    expect(screen.getByText(/skipped/)).toBeInTheDocument();
  });

  it('preview mode shows Cancel + Import buttons (parse button hidden)', () => {
    const preview: IntuitXlsxRow[] = [
      { date: '2026-09-01', name: 'Vendor A', amount: 100, memo: 'Inv# 123', matchedInvoiceIds: [1], invoiceRefs: ['123'], sourceRef: 'x', transactionType: 't', num: 'n', split: 's' },
    ];
    render(<ImportIntuitPaymentsXlsx {...baseProps} preview={preview} />);
    expect(screen.queryByRole('button', { name: /Parse & Preview/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import 1 to Inbox/ })).toBeInTheDocument();
  });

  it('Import to Inbox click calls onCommit', () => {
    const onCommit = vi.fn();
    const preview: IntuitXlsxRow[] = [
      { date: '2026-09-01', name: 'V', amount: 10, memo: '', matchedInvoiceIds: [], invoiceRefs: [], sourceRef: 'x', transactionType: 't', num: 'n', split: 's' },
    ];
    render(<ImportIntuitPaymentsXlsx {...baseProps} preview={preview} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole('button', { name: /Import 1 to Inbox/ }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
