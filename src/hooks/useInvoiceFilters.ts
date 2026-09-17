// I3: Invoice filter state + derived pipeline as a single hook.
// Owns 9 filter/dropdown state hooks + default-latest-month effect + all
// derived arrays (users, months, payOnDates, prePayOnFiltered, preStatusFiltered,
// filtered, USD/nonUSD splits, totals, totalLabel).
//
// Copied verbatim from TS.tsx Invoices tab IIFE (as of 7d66426). Any behavior
// change here needs the same change in existing consumers.

import { useEffect, useMemo, useState } from 'react';
import type { Invoice } from '../types';

interface UseInvoiceFiltersArgs {
  invoices: Invoice[];
  paymentMethod: (inv: Invoice) => string;
}

export function useInvoiceFilters({ invoices, paymentMethod }: UseInvoiceFiltersArgs) {
  const [accountantInvoiceFilter, setAccountantInvoiceFilter] = useState<Set<string>>(new Set());
  const [invoiceDateRange, setInvoiceDateRange] = useState({ start: '', end: '' });
  const [invoicePayDateRange, setInvoicePayDateRange] = useState({ start: '', end: '' });
  const [invoicePaidDateRange, setInvoicePaidDateRange] = useState({ start: '', end: '' });
  const [invoiceMonthPreset, setInvoiceMonthPreset] = useState<Set<string>>(new Set());
  const [invoicePayOnPreset, setInvoicePayOnPreset] = useState<Set<string>>(new Set());
  const [invoicePaymentMethodPreset, setInvoicePaymentMethodPreset] = useState<Set<string>>(new Set());
  const [invoiceSourceFilter, setInvoiceSourceFilter] = useState<'all' | 'contractor' | 'manual'>('all');
  const [invoiceSelectedUsers, setInvoiceSelectedUsers] = useState<string[] | null>(null);

  // Default to latest month once invoices first load. Matches previous behavior
  // at TS.tsx ~1040.
  useEffect(() => {
    if (invoices.length > 0 && invoiceMonthPreset.size === 0) {
      const latest = [...new Set(invoices.map(i => i.periodEnd?.slice(0, 7)).filter(Boolean) as string[])]
        .sort((a, b) => b.localeCompare(a))[0];
      if (latest) setInvoiceMonthPreset(new Set([latest]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices.length]);

  const invoiceUsers = useMemo(
    () =>
      [...new Map(invoices.map(i => [i.userId, { id: i.userId, name: i.userName }])).values()].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [invoices],
  );

  const effectiveInvoiceUsers = useMemo(
    () => invoiceSelectedUsers ?? invoiceUsers.map(u => u.id),
    [invoiceSelectedUsers, invoiceUsers],
  );

  const invoiceMonths = useMemo(
    () =>
      [...new Set(invoices.map(i => i.periodEnd?.slice(0, 7)).filter(Boolean) as string[])]
        .sort((a, b) => b.localeCompare(a))
        .slice(0, 12),
    [invoices],
  );

  const prePayOnFiltered = useMemo(() => {
    let r = invoices;
    if (invoiceSelectedUsers !== null) r = r.filter(i => invoiceSelectedUsers.includes(i.userId));
    if (invoiceDateRange.start && invoiceDateRange.end)
      r = r.filter(i => i.periodStart >= invoiceDateRange.start && i.periodStart <= invoiceDateRange.end);
    if (invoicePayDateRange.start && invoicePayDateRange.end)
      r = r.filter(i => i.payOnDate && i.payOnDate >= invoicePayDateRange.start && i.payOnDate <= invoicePayDateRange.end);
    if (invoicePaidDateRange.start && invoicePaidDateRange.end)
      r = r.filter(i => i.paidDate && i.paidDate >= invoicePaidDateRange.start && i.paidDate <= invoicePaidDateRange.end);
    if (invoiceMonthPreset.size > 0) r = r.filter(i => invoiceMonthPreset.has(i.periodEnd?.slice(0, 7) ?? ''));
    return r;
  }, [invoices, invoiceSelectedUsers, invoiceDateRange, invoicePayDateRange, invoicePaidDateRange, invoiceMonthPreset]);

  const payOnDates = useMemo(
    () => [...new Set(prePayOnFiltered.map(i => i.payOnDate).filter(Boolean) as string[])].sort(),
    [prePayOnFiltered],
  );

  const preStatusFiltered = useMemo(() => {
    let r = invoices;
    if (invoiceSelectedUsers !== null) r = r.filter(i => invoiceSelectedUsers.includes(i.userId));
    if (invoiceDateRange.start && invoiceDateRange.end)
      r = r.filter(i => i.periodStart >= invoiceDateRange.start && i.periodStart <= invoiceDateRange.end);
    if (invoicePayDateRange.start && invoicePayDateRange.end)
      r = r.filter(i => i.payOnDate && i.payOnDate >= invoicePayDateRange.start && i.payOnDate <= invoicePayDateRange.end);
    if (invoicePaidDateRange.start && invoicePaidDateRange.end)
      r = r.filter(i => i.paidDate && i.paidDate >= invoicePaidDateRange.start && i.paidDate <= invoicePaidDateRange.end);
    if (invoiceMonthPreset.size > 0) r = r.filter(i => invoiceMonthPreset.has(i.periodEnd?.slice(0, 7) ?? ''));
    if (invoicePayOnPreset.size > 0)
      r = r.filter(i => {
        if (invoicePayOnPreset.has('none') && !i.payOnDate) return true;
        return i.payOnDate != null && invoicePayOnPreset.has(i.payOnDate);
      });
    return r;
  }, [invoices, invoiceSelectedUsers, invoiceDateRange, invoicePayDateRange, invoicePaidDateRange, invoiceMonthPreset, invoicePayOnPreset]);

  const filtered = useMemo(() => {
    let r = [...preStatusFiltered];
    if (accountantInvoiceFilter.size > 0) r = r.filter(i => accountantInvoiceFilter.has(i.status));
    if (invoicePaymentMethodPreset.size > 0) r = r.filter(i => invoicePaymentMethodPreset.has(paymentMethod(i)));
    if (invoiceSourceFilter === 'manual') r = r.filter(i => i.source === 'manual');
    else if (invoiceSourceFilter === 'contractor') r = r.filter(i => i.source !== 'manual');
    return r.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  }, [preStatusFiltered, accountantInvoiceFilter, invoicePaymentMethodPreset, invoiceSourceFilter, paymentMethod]);

  const usdFiltered = useMemo(() => filtered.filter(i => !i.currency || i.currency === 'USD'), [filtered]);
  const nonUsdFiltered = useMemo(() => filtered.filter(i => i.currency && i.currency !== 'USD'), [filtered]);
  const totalFilteredUsd = useMemo(() => usdFiltered.reduce((s, i) => s + i.totalAmount, 0), [usdFiltered]);
  const nonUsdByCurrency = useMemo(
    () =>
      nonUsdFiltered.reduce((acc, i) => {
        if (!acc[i.currency]) acc[i.currency] = 0;
        acc[i.currency]++;
        return acc;
      }, {} as Record<string, number>),
    [nonUsdFiltered],
  );

  const totalLabel = useMemo(
    () =>
      accountantInvoiceFilter.size === 0
        ? 'Total (USD)'
        : accountantInvoiceFilter.size === 1
          ? `${[...accountantInvoiceFilter][0].charAt(0).toUpperCase() + [...accountantInvoiceFilter][0].slice(1)} (USD)`
          : 'Selected (USD)',
    [accountantInvoiceFilter],
  );

  return {
    // state
    accountantInvoiceFilter, setAccountantInvoiceFilter,
    invoiceDateRange, setInvoiceDateRange,
    invoicePayDateRange, setInvoicePayDateRange,
    invoicePaidDateRange, setInvoicePaidDateRange,
    invoiceMonthPreset, setInvoiceMonthPreset,
    invoicePayOnPreset, setInvoicePayOnPreset,
    invoicePaymentMethodPreset, setInvoicePaymentMethodPreset,
    invoiceSourceFilter, setInvoiceSourceFilter,
    invoiceSelectedUsers, setInvoiceSelectedUsers,
    // derived
    invoiceUsers, effectiveInvoiceUsers, invoiceMonths, payOnDates,
    prePayOnFiltered, preStatusFiltered, filtered,
    usdFiltered, nonUsdFiltered, totalFilteredUsd, nonUsdByCurrency,
    totalLabel,
  };
}
