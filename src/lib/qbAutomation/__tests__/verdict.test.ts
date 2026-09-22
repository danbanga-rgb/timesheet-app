import { describe, it, expect } from 'vitest';
import { computeVerdict } from '../verdict';
import type { QbOpenBillRow } from '../../qbStateSync/types';

function bill(overrides: Partial<QbOpenBillRow> = {}): QbOpenBillRow {
  return {
    vendorListId: '80000001-1',
    vendorName: 'Anela Kaltak',
    refNumber: 'INV-1042',
    txnId: 'TXN-1',
    txnDate: '2026-09-15',
    dueDate: null,
    amount: 2400,
    openAmount: 2400,
    isPaid: false,
    queriedAt: '2026-09-22T00:00:00Z',
    ...overrides,
  };
}

describe('computeVerdict', () => {
  it('returns will_pay when bill_pmt event has a matching bill in mirror', () => {
    const v = computeVerdict(
      { kind: 'bill_pmt', vendorListId: '80000001-1', refNumber: 'INV-1042', month: '2026-09' },
      [bill()],
    );
    expect(v).toBe('will_pay');
  });

  it('returns will_create_and_pay when bill_add_and_pmt event has no matching bill', () => {
    const v = computeVerdict(
      { kind: 'bill_add_and_pmt', vendorListId: '80000001-1', refNumber: 'INV-1042', month: '2026-09' },
      [],
    );
    expect(v).toBe('will_create_and_pay');
  });

  it('flips bill_add_and_pmt to will_pay when the bill actually exists in mirror', () => {
    // Classifier said "no bill" at classification time; live mirror now has one.
    // Verdict is live truth, not the stale classifier snapshot.
    const v = computeVerdict(
      { kind: 'bill_add_and_pmt', vendorListId: '80000001-1', refNumber: 'INV-1042', month: '2026-09' },
      [bill()],
    );
    expect(v).toBe('will_pay');
  });

  it('returns null for check kind', () => {
    const v = computeVerdict(
      { kind: 'check', vendorListId: '80000001-1', refNumber: 'INV-1042', month: '2026-09' },
      [bill()],
    );
    expect(v).toBeNull();
  });

  it('returns null for ignore kind', () => {
    const v = computeVerdict(
      { kind: 'ignore', vendorListId: '80000001-1', refNumber: 'INV-1042', month: '2026-09' },
      [],
    );
    expect(v).toBeNull();
  });

  it('returns null when vendorListId is missing', () => {
    const v = computeVerdict(
      { kind: 'bill_pmt', vendorListId: null, refNumber: 'INV-1042', month: '2026-09' },
      [],
    );
    expect(v).toBeNull();
  });

  it('returns null when refNumber is blank', () => {
    const v = computeVerdict(
      { kind: 'bill_pmt', vendorListId: '80000001-1', refNumber: '', month: '2026-09' },
      [],
    );
    expect(v).toBeNull();
  });

  it('period-scopes the match — same vendor+ref in a different month is not a hit', () => {
    // Croatian contractors reset invoice numbers annually — "INV 12" for 2026-07
    // collides with "INV 12" from 2023-12. See TS.tsx:6986 rationale.
    const v = computeVerdict(
      { kind: 'bill_add_and_pmt', vendorListId: '80000001-1', refNumber: 'INV-1042', month: '2026-09' },
      [bill({ txnDate: '2023-12-15' })],
    );
    expect(v).toBe('will_create_and_pay');
  });

  it('normalizes ref numbers — "Inv# INV-1042" matches "INV-1042"', () => {
    const v = computeVerdict(
      { kind: 'bill_pmt', vendorListId: '80000001-1', refNumber: 'Inv# INV-1042', month: '2026-09' },
      [bill()],
    );
    expect(v).toBe('will_pay');
  });

  it('does not match across vendors', () => {
    const v = computeVerdict(
      { kind: 'bill_add_and_pmt', vendorListId: '80000001-2', refNumber: 'INV-1042', month: '2026-09' },
      [bill()],
    );
    expect(v).toBe('will_create_and_pay');
  });
});
