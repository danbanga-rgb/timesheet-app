// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInvoiceFilters } from '../useInvoiceFilters';
import type { Invoice } from '../../types';

const inv = (extra: Partial<Invoice>): Invoice => ({
  id: 0, userId: 'u', userName: 'U', invoiceNumber: 'INV-000',
  status: 'submitted', currency: 'USD', totalAmount: 100, totalHours: 10, rate: 10,
  periodStart: '2026-09-01', periodEnd: '2026-09-30', submittedAt: '2026-09-15',
  lines: [], paymentProfile: null, source: 'contractor',
  ...extra,
} as Invoice);

const pmIntuit = () => 'Intuit';
const pmMixed = (i: Invoice) => (i.userId === 'u1' ? 'Intuit' : 'Convera');

describe('useInvoiceFilters', () => {
  it('defaults invoiceMonthPreset to latest month on first invoice load', () => {
    const invoices = [
      inv({ id: 1, periodEnd: '2026-07-31' }),
      inv({ id: 2, periodEnd: '2026-09-30' }),
      inv({ id: 3, periodEnd: '2026-08-31' }),
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.invoiceMonthPreset).toEqual(new Set(['2026-09']));
  });

  it('invoiceMonths returns distinct months sorted desc, capped at 12', () => {
    const invoices = Array.from({ length: 15 }, (_, i) =>
      inv({ id: i, periodEnd: `2026-${String((i % 12) + 1).padStart(2, '0')}-15` }),
    );
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.invoiceMonths.length).toBe(12);
    // sorted desc
    const months = result.current.invoiceMonths;
    for (let i = 0; i < months.length - 1; i++) {
      expect(months[i] >= months[i + 1]).toBe(true);
    }
  });

  it('invoiceUsers dedupes by userId and sorts by name', () => {
    const invoices = [
      inv({ id: 1, userId: 'b', userName: 'Bob' }),
      inv({ id: 2, userId: 'a', userName: 'Alice' }),
      inv({ id: 3, userId: 'a', userName: 'Alice' }), // dup
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.invoiceUsers).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });

  it('effectiveInvoiceUsers falls back to all when invoiceSelectedUsers is null', () => {
    const invoices = [inv({ id: 1, userId: 'a' }), inv({ id: 2, userId: 'b' })];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.effectiveInvoiceUsers).toEqual(['a', 'b']);
  });

  it('effectiveInvoiceUsers reflects invoiceSelectedUsers when explicitly set', () => {
    const invoices = [inv({ id: 1, userId: 'a' }), inv({ id: 2, userId: 'b' })];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    act(() => result.current.setInvoiceSelectedUsers(['a']));
    expect(result.current.effectiveInvoiceUsers).toEqual(['a']);
  });

  it('status filter narrows filtered array', () => {
    const invoices = [
      inv({ id: 1, status: 'submitted' }),
      inv({ id: 2, status: 'approved' }),
      inv({ id: 3, status: 'paid' }),
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    // Latest-month default fires and month is '2026-09' — all 3 match.
    act(() => result.current.setAccountantInvoiceFilter(new Set(['approved'])));
    expect(result.current.filtered.map(i => i.id)).toEqual([2]);
  });

  it('paymentMethodPreset filters via paymentMethod callback', () => {
    const invoices = [
      inv({ id: 1, userId: 'u1' }),
      inv({ id: 2, userId: 'u2' }),
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmMixed }));
    act(() => result.current.setInvoicePaymentMethodPreset(new Set(['Convera'])));
    expect(result.current.filtered.map(i => i.id)).toEqual([2]);
  });

  it('sourceFilter=manual keeps only source=manual invoices', () => {
    const invoices = [
      inv({ id: 1, source: 'contractor' }),
      inv({ id: 2, source: 'manual' }),
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    act(() => result.current.setInvoiceSourceFilter('manual'));
    expect(result.current.filtered.map(i => i.id)).toEqual([2]);
  });

  it('payOnPreset "none" sentinel matches invoices without payOnDate', () => {
    const invoices = [
      inv({ id: 1, payOnDate: '2026-09-10' }),
      inv({ id: 2, payOnDate: null }),
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    act(() => result.current.setInvoicePayOnPreset(new Set(['none'])));
    expect(result.current.preStatusFiltered.map(i => i.id)).toEqual([2]);
  });

  it('nonUsdByCurrency aggregates non-USD invoice counts', () => {
    const invoices = [
      inv({ id: 1, currency: 'GBP' }),
      inv({ id: 2, currency: 'GBP' }),
      inv({ id: 3, currency: 'EUR' }),
      inv({ id: 4 }), // USD (default)
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.nonUsdByCurrency).toEqual({ GBP: 2, EUR: 1 });
  });

  it('totalFilteredUsd sums USD invoices only', () => {
    const invoices = [
      inv({ id: 1, totalAmount: 100 }),
      inv({ id: 2, totalAmount: 200 }),
      inv({ id: 3, totalAmount: 500, currency: 'GBP' }),
    ];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.totalFilteredUsd).toBe(300);
  });

  it('totalLabel varies by selected status count', () => {
    const invoices = [inv({ id: 1 })];
    const { result } = renderHook(() => useInvoiceFilters({ invoices, paymentMethod: pmIntuit }));
    expect(result.current.totalLabel).toBe('Total (USD)');
    act(() => result.current.setAccountantInvoiceFilter(new Set(['approved'])));
    expect(result.current.totalLabel).toBe('Approved (USD)');
    act(() => result.current.setAccountantInvoiceFilter(new Set(['approved', 'paid'])));
    expect(result.current.totalLabel).toBe('Selected (USD)');
  });
});
