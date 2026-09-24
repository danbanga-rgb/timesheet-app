import { describe, it, expect } from 'vitest';
import type { Invoice, QbIngestEvent } from '../../../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../../../lib/qbStateSync/types';
import { derivePushedByMonth, todayLocalDateKey } from '../useQbAutomationV2';

function event(overrides: Partial<QbIngestEvent> = {}): QbIngestEvent {
  return {
    id: 1,
    source: 'convera',
    sourceIngestKey: 'src-1',
    ingestedAt: '2026-09-23T09:00:00Z',
    amount: 2400,
    txnDate: '2026-09-15',
    memo: 'INV-1042',
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
    resolvedAction: 'pay_existing_bill',
    resolvedBillTxnId: 'TXN-BILL-1',
    resolvedPaymentTxnId: null,
    resolvedReason: null,
    reconciledAt: null,
    matchProvenance: 'exact-txn',
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
    name: 'Flawless APPS LLC',
    ...overrides,
  } as QbVendorRow;
}

describe('derivePushedByMonth', () => {
  const venById = new Map<string, QbVendorRow>([['80000001-1', vendor()]]);
  const billById = new Map<string, QbOpenBillRow>();

  it('returns empty when no events are posted', () => {
    const groups = derivePushedByMonth([event({ status: 'ready' })], [], venById, billById, new Set(), new Set());
    expect(groups).toEqual([]);
  });

  it('carries counterpartyRaw and memo straight from the event (no invoice lookup)', () => {
    const groups = derivePushedByMonth([event()], [], venById, billById, new Set(), new Set());
    expect(groups[0].rows[0]).toMatchObject({
      counterpartyRaw: 'Anela Kaltak',
      qbVendorName: 'Flawless APPS LLC',
      memo: 'INV-1042',
      src: 'Convera',
      date: '2026-09-15',
    });
  });

  it('excludes events with null statusUpdatedAt', () => {
    const groups = derivePushedByMonth([event({ statusUpdatedAt: null })], [], venById, billById, new Set(), new Set());
    expect(groups).toEqual([]);
  });

  it('resolvedRefLabel comes from the resolved bill in mirror', () => {
    const groups = derivePushedByMonth(
      [event({ resolvedBillTxnId: 'TXN-BILL-9' })],
      [],
      venById,
      new Map([['TXN-BILL-9', { txnId: 'TXN-BILL-9', refNumber: 'INV 58', vendorListId: '80000001-1', vendorName: 'Flawless', txnDate: '2026-09-01', dueDate: null, amount: 2400, openAmount: 0, isPaid: true, queriedAt: '2026-09-24T10:00:00Z' }]]),
      new Set(),
      new Set(),
    );
    expect(groups[0].rows[0].resolvedRefLabel).toBe('INV 58');
    expect(groups[0].rows[0].resolvedAction).toBe('pay_existing_bill');
  });

  it('handles unmapped vendor gracefully', () => {
    const groups = derivePushedByMonth(
      [event({ counterpartyQbVendorListId: null })],
      [],
      venById,
      billById,
      new Set(),
      new Set(),
    );
    expect(groups[0].rows[0].qbVendorName).toBe('(unmapped)');
  });

  it('buckets events into multiple months, newest month first', () => {
    const augEvent = event({ id: 10, statusUpdatedAt: '2026-08-15T12:00:00Z', amount: 100 });
    const sepEvent = event({ id: 11, statusUpdatedAt: '2026-09-05T12:00:00Z', amount: 200 });
    const groups = derivePushedByMonth([augEvent, sepEvent], [], venById, billById, new Set(), new Set());
    expect(groups.map(g => g.monthKey)).toEqual(['2026-09', '2026-08']);
  });

  it('sorts rows within a month newest first', () => {
    const early = event({ id: 10, statusUpdatedAt: '2026-09-24T08:00:00Z' });
    const late = event({ id: 11, statusUpdatedAt: '2026-09-24T14:00:00Z' });
    const groups = derivePushedByMonth([early, late], [], venById, billById, new Set(), new Set());
    expect(groups[0].rows.map(r => r.eventId)).toEqual([11, 10]);
  });

  it('includes synthetic G7.5 rows with counterpartyRaw = user, qbVendorName = pp company', () => {
    const inv = invoice({
      id: 500,
      invoiceNumber: 'INV 500',
      qbBillTxnId: 'TXN-BILL-500',
      qbExportStatusAt: '2026-09-20T10:00:00Z',
      userName: 'Rumiya Hasnutdinova',
      paymentProfile: { id: 1, companyName: 'FLAWLESS APPS LLC' },
    } as Partial<Invoice>);
    const groups = derivePushedByMonth([], [inv], venById, billById, new Set([inv.id]), new Set());
    const row = groups[0].rows[0];
    expect(row.counterpartyRaw).toBe('Rumiya Hasnutdinova');
    expect(row.qbVendorName).toBe('FLAWLESS APPS LLC');
    expect(row.memo).toBe('INV INV 500');
    expect(row.src).toBe('Invoice → Bill (Intuit)');
    expect(row.resolvedAction).toBe('create_bill_then_pay');
    expect(row.isG75Source).toBe(true);
    expect(row.billTxnId).toBe('TXN-BILL-500');
  });

  it('synthetic G7.6 rows carry Convera source label + isG75Source=false', () => {
    const inv = invoice({
      id: 501,
      invoiceNumber: 'INV 501',
      qbBillTxnId: 'TXN-BILL-501',
      qbExportStatusAt: '2026-09-20T10:00:00Z',
    } as Partial<Invoice>);
    const groups = derivePushedByMonth([], [inv], venById, billById, new Set(), new Set([inv.id]));
    const row = groups[0].rows[0];
    expect(row.src).toBe('Invoice → Bill (Convera)');
    expect(row.isG75Source).toBe(false);
  });

  it('does NOT dedupe synthetic G7.5 rows against covering events (matches V1 count)', () => {
    const inv = invoice({ id: 502, qbBillTxnId: 'TXN-BILL-502', qbExportStatusAt: '2026-09-20T10:00:00Z' } as Partial<Invoice>);
    const coveringEvent = event({ id: 42, matchedInvoiceIds: [inv.id], statusUpdatedAt: '2026-09-20T10:00:00Z' });
    const groups = derivePushedByMonth([coveringEvent], [inv], venById, billById, new Set([inv.id]), new Set());
    expect(groups[0].rows.map(r => r.eventId).sort()).toEqual([-502, 42]);
  });
});

describe('todayLocalDateKey', () => {
  it('returns YYYY-MM-DD in local time for a specific date', () => {
    const noon = new Date(2026, 8, 23, 12, 0, 0);
    expect(todayLocalDateKey(noon)).toBe('2026-09-23');
  });

  it('zero-pads month and day', () => {
    const early = new Date(2026, 0, 5, 12, 0, 0);
    expect(todayLocalDateKey(early)).toBe('2026-01-05');
  });
});
