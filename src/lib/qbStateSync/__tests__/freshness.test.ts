import { describe, it, expect } from 'vitest';
import { snapshotAge, isFresh, vendorsNeedingSync, humanizeAge } from '../freshness';
import type { QbOpenBillRow } from '../types';

const row = (overrides: Partial<QbOpenBillRow> = {}): QbOpenBillRow => ({
  vendorListId: 'V1',
  vendorName: 'Vendor 1',
  refNumber: 'INV 1',
  txnId: 'T1',
  txnDate: '2026-06-01',
  dueDate: '2026-07-01',
  amount: 1000,
  openAmount: 1000,
  isPaid: false,
  queriedAt: '2026-08-20T10:00:00.000Z',
  ...overrides,
});

describe('snapshotAge', () => {
  it('returns nulls + empty map for empty input', () => {
    const f = snapshotAge([]);
    expect(f.newestQueriedAt).toBe(null);
    expect(f.oldestQueriedAt).toBe(null);
    expect(f.perVendorAges.size).toBe(0);
    expect(f.rowCount).toBe(0);
  });

  it('finds newest and oldest queried_at across rows', () => {
    const f = snapshotAge([
      row({ queriedAt: '2026-08-20T09:00:00Z' }),
      row({ queriedAt: '2026-08-20T11:00:00Z' }),
      row({ queriedAt: '2026-08-20T10:00:00Z' }),
    ]);
    expect(f.newestQueriedAt).toBe('2026-08-20T11:00:00Z');
    expect(f.oldestQueriedAt).toBe('2026-08-20T09:00:00Z');
    expect(f.rowCount).toBe(3);
  });

  it('per-vendor age is MAX(queried_at) grouped by vendorListId', () => {
    const f = snapshotAge([
      row({ vendorListId: 'V1', queriedAt: '2026-08-20T09:00:00Z' }),
      row({ vendorListId: 'V1', queriedAt: '2026-08-20T11:00:00Z' }),
      row({ vendorListId: 'V2', queriedAt: '2026-08-20T10:00:00Z' }),
    ]);
    expect(f.perVendorAges.get('V1')).toBe('2026-08-20T11:00:00Z');
    expect(f.perVendorAges.get('V2')).toBe('2026-08-20T10:00:00Z');
  });
});

describe('isFresh', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('false when no rows', () => {
    expect(isFresh(snapshotAge([]), 3600, now)).toBe(false);
  });

  it('true when newest is within TTL', () => {
    const f = snapshotAge([row({ queriedAt: '2026-08-20T11:30:00Z' })]);  // 30m ago
    expect(isFresh(f, 3600, now)).toBe(true);
  });

  it('false when newest is older than TTL', () => {
    const f = snapshotAge([row({ queriedAt: '2026-08-20T10:30:00Z' })]);  // 90m ago
    expect(isFresh(f, 3600, now)).toBe(false);
  });

  it('respects custom TTL', () => {
    const f = snapshotAge([row({ queriedAt: '2026-08-20T11:55:00Z' })]);  // 5m ago
    expect(isFresh(f, 60, now)).toBe(false);   // TTL 60s → stale
    expect(isFresh(f, 600, now)).toBe(true);   // TTL 10m → fresh
  });
});

describe('vendorsNeedingSync', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('returns vendors never queried', () => {
    // V1 is fresh so we only expect V2/V3 (never queried) to be stale.
    const f = snapshotAge([row({ vendorListId: 'V1', queriedAt: '2026-08-20T11:55:00Z' })]);
    const stale = vendorsNeedingSync(['V1', 'V2', 'V3'], f, 3600, now);
    expect(stale.sort()).toEqual(['V2', 'V3']);
  });

  it('returns vendors last-queried past TTL', () => {
    const f = snapshotAge([
      row({ vendorListId: 'V1', queriedAt: '2026-08-20T11:55:00Z' }),  // 5m
      row({ vendorListId: 'V2', queriedAt: '2026-08-20T09:00:00Z' }),  // 3h
    ]);
    const stale = vendorsNeedingSync(['V1', 'V2'], f, 3600, now);
    expect(stale).toEqual(['V2']);
  });

  it('empty input list returns empty', () => {
    expect(vendorsNeedingSync([], snapshotAge([]), 3600, now)).toEqual([]);
  });
});

describe('humanizeAge', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('null → "never synced"', () => {
    expect(humanizeAge(null, now)).toBe('never synced');
  });

  it('seconds', () => {
    expect(humanizeAge('2026-08-20T11:59:30Z', now)).toBe('30s ago');
  });

  it('minutes', () => {
    expect(humanizeAge('2026-08-20T11:45:00Z', now)).toBe('15m ago');
  });

  it('hours', () => {
    expect(humanizeAge('2026-08-20T09:00:00Z', now)).toBe('3h ago');
  });

  it('days', () => {
    expect(humanizeAge('2026-08-17T12:00:00Z', now)).toBe('3d ago');
  });
});
