import { describe, it, expect } from 'vitest';
import type { Invoice, QbIngestEvent } from '../../../../types';
import type { QbVendorRow } from '../../../../lib/qbStateSync/types';
import { derivePushedByMonth, todayLocalDateKey } from '../useQbAutomationV2';

function event(overrides: Partial<QbIngestEvent> = {}): QbIngestEvent {
  return {
    id: 1,
    source: 'convera',
    sourceIngestKey: 'src-1',
    ingestedAt: '2026-09-23T09:00:00Z',
    amount: 2400,
    currency: 'USD',
    counterpartyRaw: 'Anela Kaltak',
    counterpartyQbVendorListId: '80000001-1',
    targetQbTxnKind: 'bill_pmt',
    qbBankAccountListId: null,
    qbExpenseAccountListId: null,
    matchedInvoiceIds: [42],
    status: 'posted',
    qbSyncJobIds: [],
    postedQbRefs: { bill: 'TXN-BILL-1', bill_pmt: 'TXN-PMT-1', posted_source: 'v2-push' },
    lastError: null,
    rawData: null,
    notes: null,
    resolvedAction: null,
    resolvedBillTxnId: null,
    resolvedPaymentTxnId: null,
    resolvedReason: null,
    reconciledAt: null,
    matchProvenance: null,
    statusUpdatedAt: '2026-09-24T09:00:00Z',
    ...overrides,
  } as QbIngestEvent;
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 42,
    userId: 'u1',
    userName: 'Anela Kaltak',
    invoiceNumber: 'INV-1042',
    lines: [],
    totalAmount: 2400,
    totalHours: 40,
    rate: 60,
    currency: 'USD',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    createdAt: '2026-09-30T00:00:00Z',
    status: 'approved',
    paymentMethodOverride: null,
    paymentProfile: null,
    ...overrides,
  } as Invoice;
}

function vendor(overrides: Partial<QbVendorRow> = {}): QbVendorRow {
  return {
    listId: '80000001-1',
    name: 'Anela Kaltak',
    ...overrides,
  } as QbVendorRow;
}

describe('derivePushedByMonth', () => {
  const invById = new Map<number, Invoice>([[42, invoice()]]);
  const venById = new Map<string, QbVendorRow>([['80000001-1', vendor()]]);

  it('returns empty when no events are posted', () => {
    const groups = derivePushedByMonth([event({ status: 'ready' })], [], invById, venById, new Set(), new Set());
    expect(groups).toEqual([]);
  });

  it('groups a single posted event by push-month', () => {
    const groups = derivePushedByMonth([event()], [], invById, venById, new Set(), new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0]).toMatchObject({
      eventId: 1,
      contractorName: 'Anela Kaltak',
      qbVendorName: 'Anela Kaltak',
      billTxnId: 'TXN-BILL-1',
      billPmtTxnId: 'TXN-PMT-1',
      postedSource: 'v2-push',
    });
    expect(groups[0].total).toBe(2400);
  });

  it('excludes events with null statusUpdatedAt', () => {
    const groups = derivePushedByMonth(
      [event({ statusUpdatedAt: null })],
      [],
      invById,
      venById,
      new Set(),
      new Set(),
    );
    expect(groups).toEqual([]);
  });

  it('falls back to resolvedBillTxnId when postedQbRefs.bill is missing', () => {
    const groups = derivePushedByMonth(
      [event({ postedQbRefs: { bill_pmt: 'TXN-PMT-2' }, resolvedBillTxnId: 'TXN-BILL-RESOLVED' })],
      [],
      invById,
      venById,
      new Set(),
      new Set(),
    );
    expect(groups[0]?.rows[0]?.billTxnId).toBe('TXN-BILL-RESOLVED');
  });

  it('buckets events into multiple months, newest month first', () => {
    const augEvent = event({ id: 10, statusUpdatedAt: '2026-08-15T12:00:00Z', amount: 100 });
    const sepEvent = event({ id: 11, statusUpdatedAt: '2026-09-05T12:00:00Z', amount: 200 });
    const groups = derivePushedByMonth([augEvent, sepEvent], [], invById, venById, new Set(), new Set());
    expect(groups.map(g => g.monthKey)).toEqual(['2026-09', '2026-08']);
    expect(groups[0].total).toBe(200);
    expect(groups[1].total).toBe(100);
  });

  it('sorts rows within a month newest first', () => {
    const early = event({ id: 10, statusUpdatedAt: '2026-09-24T08:00:00Z' });
    const late = event({ id: 11, statusUpdatedAt: '2026-09-24T14:00:00Z' });
    const groups = derivePushedByMonth([early, late], [], invById, venById, new Set(), new Set());
    expect(groups[0].rows.map(r => r.eventId)).toEqual([11, 10]);
  });

  it('handles unmapped vendor gracefully', () => {
    const groups = derivePushedByMonth(
      [event({ counterpartyQbVendorListId: null })],
      [],
      invById,
      venById,
      new Set(),
      new Set(),
    );
    expect(groups[0]?.rows[0]?.qbVendorName).toBe('(unmapped)');
  });

  it('includes synthetic G7.5/G7.6 rows from invoice sets', () => {
    const inv: Invoice = invoice({ id: 500, invoiceNumber: 'INV 500', qbBillTxnId: 'TXN-BILL-500', qbExportStatusAt: '2026-09-20T10:00:00Z' } as Partial<Invoice>);
    const groups = derivePushedByMonth(
      [],
      [inv],
      new Map([[inv.id, inv]]),
      venById,
      new Set([inv.id]),
      new Set(),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rows[0].billTxnId).toBe('TXN-BILL-500');
    expect(groups[0].rows[0].postedSource).toBe('push');
  });

  it('marks G7.5/G7.6 rows as push_paid_outside when invoice is paid', () => {
    const inv: Invoice = invoice({ id: 501, invoiceNumber: 'INV 501', qbBillTxnId: 'TXN-BILL-501', qbExportStatusAt: '2026-09-20T10:00:00Z', status: 'paid' } as Partial<Invoice>);
    const groups = derivePushedByMonth(
      [],
      [inv],
      new Map([[inv.id, inv]]),
      venById,
      new Set(),
      new Set([inv.id]),
    );
    expect(groups[0].rows[0].postedSource).toBe('push_paid_outside');
  });

  it('does NOT dedupe synthetic G7.5 rows against covering events (matches V1 count)', () => {
    // V1's Already-posted bucket concatenates without dedup — we mirror
    // that here so V2's Pushed count equals V1's exactly. Fix at V12
    // cutover, not per surface.
    const inv: Invoice = invoice({ id: 502, qbBillTxnId: 'TXN-BILL-502', qbExportStatusAt: '2026-09-20T10:00:00Z' } as Partial<Invoice>);
    const coveringEvent = event({ id: 42, matchedInvoiceIds: [inv.id], statusUpdatedAt: '2026-09-20T10:00:00Z' });
    const groups = derivePushedByMonth(
      [coveringEvent],
      [inv],
      new Map([[inv.id, inv]]),
      venById,
      new Set([inv.id]),
      new Set(),
    );
    expect(groups[0].rows.map(r => r.eventId).sort()).toEqual([-502, 42]);
  });
});

describe('todayLocalDateKey', () => {
  it('returns YYYY-MM-DD in local time for a specific date', () => {
    const noon = new Date(2026, 8, 23, 12, 0, 0);  // Sep 23 2026 noon local
    expect(todayLocalDateKey(noon)).toBe('2026-09-23');
  });

  it('zero-pads month and day', () => {
    const early = new Date(2026, 0, 5, 12, 0, 0);  // Jan 5 2026
    expect(todayLocalDateKey(early)).toBe('2026-01-05');
  });
});
