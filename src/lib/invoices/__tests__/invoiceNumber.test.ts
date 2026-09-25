import { describe, it, expect } from 'vitest';
import { findSameNumberInvoices, normalizeInvoiceNumber, suggestUniqueInvoiceNumber } from '../invoiceNumber';

const inv = (id: number, userId: string, invoiceNumber: string, status = 'approved') => ({ id, userId, invoiceNumber, status });

describe('invoice number uniqueness', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeInvoiceNumber('  inv   20260801 ')).toBe('INV 20260801');
  });

  it('Izet: August reuses July number → found', () => {
    const all = [inv(192, 'izet', 'INV 20260801', 'paid'), inv(256, 'izet', 'INV 20260801')];
    expect(findSameNumberInvoices(all[1], all).map(o => o.id)).toEqual([192]);
  });

  it('ignores other contractors, rejected invoices, and itself', () => {
    const all = [
      inv(1, 'izet', 'INV 20260801'),
      inv(2, 'qace', 'INV 20260801'),
      inv(3, 'izet', 'INV 20260801', 'rejected'),
    ];
    expect(findSameNumberInvoices(all[0], all)).toEqual([]);
  });

  it('suggests -1, then the next free suffix', () => {
    expect(suggestUniqueInvoiceNumber('INV 20260801', ['INV 20260801'])).toBe('INV 20260801-1');
    expect(suggestUniqueInvoiceNumber('INV 32', ['INV 32', 'inv 32-1'])).toBe('INV 32-2');
  });
});
