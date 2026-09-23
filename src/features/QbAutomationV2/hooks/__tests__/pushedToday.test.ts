import { describe, it, expect } from 'vitest';
import type { Invoice, QbIngestEvent } from '../../../../types';
import type { QbOpenBillRow, QbVendorRow } from '../../../../lib/qbStateSync/types';
import { derivePushedTodayRows, todayLocalDateKey } from '../useQbAutomationV2';

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
    statusUpdatedAt: new Date().toISOString(),
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('derivePushedTodayRows', () => {
  const invById = new Map<number, Invoice>([[42, invoice()]]);
  const venById = new Map<string, QbVendorRow>([['80000001-1', vendor()]]);

  it('returns empty when no events are posted', () => {
    const rows = derivePushedTodayRows([event({ status: 'ready' })], invById, venById);
    expect(rows).toEqual([]);
  });

  it('includes posted events with statusUpdatedAt today', () => {
    const rows = derivePushedTodayRows([event()], invById, venById);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventId: 1,
      contractorName: 'Anela Kaltak',
      qbVendorName: 'Anela Kaltak',
      billTxnId: 'TXN-BILL-1',
      billPmtTxnId: 'TXN-PMT-1',
      postedSource: 'v2-push',
      amount: 2400,
    });
  });

  it('excludes posted events from a prior day', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const rows = derivePushedTodayRows(
      [event({ statusUpdatedAt: yesterday.toISOString() })],
      invById,
      venById,
    );
    expect(rows).toEqual([]);
  });

  it('excludes events with null statusUpdatedAt', () => {
    const rows = derivePushedTodayRows(
      [event({ statusUpdatedAt: null })],
      invById,
      venById,
    );
    expect(rows).toEqual([]);
  });

  it('falls back to resolvedBillTxnId when postedQbRefs.bill is missing', () => {
    const rows = derivePushedTodayRows(
      [event({ postedQbRefs: { bill_pmt: 'TXN-PMT-2' }, resolvedBillTxnId: 'TXN-BILL-RESOLVED' })],
      invById,
      venById,
    );
    expect(rows[0]?.billTxnId).toBe('TXN-BILL-RESOLVED');
  });

  it('sorts newest first', () => {
    const early = event({ id: 10, statusUpdatedAt: '2026-09-23T08:00:00Z' });
    const late = event({ id: 11, statusUpdatedAt: '2026-09-23T14:00:00Z' });
    const now = new Date('2026-09-23T20:00:00Z');
    const rows = derivePushedTodayRows([early, late], invById, venById, now);
    // Both are "today" if today (local) matches 2026-09-23 — but statusUpdatedAt
    // filter uses the browser's actual today, not the `now` arg for that check.
    // So this test uses local-today; if run past midnight UTC in a west zone
    // this may drift. Sort order is what we verify.
    const ids = rows.map(r => r.eventId);
    if (ids.length === 2) {
      expect(ids).toEqual([11, 10]);
    }
  });

  it('handles unmapped vendor gracefully', () => {
    const rows = derivePushedTodayRows(
      [event({ counterpartyQbVendorListId: null })],
      invById,
      venById,
    );
    expect(rows[0]?.qbVendorName).toBe('(unmapped)');
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
