// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { QbOpenBillRow } from '../../../../lib/qbStateSync/types';
import { useQbSyncState } from '../useQbSyncState';

function bill(queriedAt: string): QbOpenBillRow {
  return {
    vendorListId: 'V1', vendorName: 'V', refNumber: 'R', txnId: 'T',
    txnDate: null, dueDate: null, amount: 0, openAmount: 0, isPaid: false,
    queriedAt,
  };
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('useQbSyncState', () => {
  it('mirror: green when < 15min old', () => {
    const { result } = renderHook(() => useQbSyncState({
      openBills: [bill(iso(5 * 60_000))],
      vendorsLastQueriedAt: iso(2 * 60_000),
      qbWcLastSeen: iso(3 * 60_000),
      qbBillQueryPending: 0,
      qbVendorQueryPending: 0,
    }));
    expect(result.current.mirror.status).toBe('green');
    expect(result.current.vendors.status).toBe('green');
    expect(result.current.qbwc.status).toBe('green');
  });

  it('mirror: amber when 15-60min old', () => {
    const { result } = renderHook(() => useQbSyncState({
      openBills: [bill(iso(30 * 60_000))],
      vendorsLastQueriedAt: iso(30 * 60_000),
      qbWcLastSeen: iso(3 * 60_000),
      qbBillQueryPending: 0,
      qbVendorQueryPending: 0,
    }));
    expect(result.current.mirror.status).toBe('amber');
    expect(result.current.vendors.status).toBe('amber');
  });

  it('mirror: red when > 60min old', () => {
    const { result } = renderHook(() => useQbSyncState({
      openBills: [bill(iso(2 * 60 * 60_000))],
      vendorsLastQueriedAt: iso(2 * 60 * 60_000),
      qbWcLastSeen: iso(3 * 60_000),
      qbBillQueryPending: 0,
      qbVendorQueryPending: 0,
    }));
    expect(result.current.mirror.status).toBe('red');
    expect(result.current.vendors.status).toBe('red');
  });

  it('status is based on freshness age, NOT pending count', () => {
    // Fresh mirror + a routine sync in flight → still green.
    const { result } = renderHook(() => useQbSyncState({
      openBills: [bill(iso(2 * 60_000))],
      vendorsLastQueriedAt: iso(2 * 60_000),
      qbWcLastSeen: iso(3 * 60_000),
      qbBillQueryPending: 3,
      qbVendorQueryPending: 2,
    }));
    expect(result.current.mirror.status).toBe('green');
    expect(result.current.mirror.pendingCount).toBe(3);
    expect(result.current.vendors.status).toBe('green');
    expect(result.current.vendors.pendingCount).toBe(2);
  });

  it('unknown when never synced', () => {
    const { result } = renderHook(() => useQbSyncState({
      openBills: [],
      vendorsLastQueriedAt: null,
      qbWcLastSeen: null,
      qbBillQueryPending: 0,
      qbVendorQueryPending: 0,
    }));
    expect(result.current.mirror.status).toBe('unknown');
    expect(result.current.vendors.status).toBe('unknown');
    expect(result.current.qbwc.status).toBe('red');   // never-seen QBWC is a fault, not unknown
  });

  it('qbwc: amber 20-30min, red > 30min', () => {
    const amber = renderHook(() => useQbSyncState({
      openBills: [bill(iso(1 * 60_000))],
      vendorsLastQueriedAt: iso(1 * 60_000),
      qbWcLastSeen: iso(25 * 60_000),
      qbBillQueryPending: 0,
      qbVendorQueryPending: 0,
    }));
    expect(amber.result.current.qbwc.status).toBe('amber');
    const red = renderHook(() => useQbSyncState({
      openBills: [bill(iso(1 * 60_000))],
      vendorsLastQueriedAt: iso(1 * 60_000),
      qbWcLastSeen: iso(45 * 60_000),
      qbBillQueryPending: 0,
      qbVendorQueryPending: 0,
    }));
    expect(red.result.current.qbwc.status).toBe('red');
  });

  it('qbwc is not clickable (external process)', () => {
    const { result } = renderHook(() => useQbSyncState({
      openBills: [], vendorsLastQueriedAt: null, qbWcLastSeen: iso(5 * 60_000),
      qbBillQueryPending: 0, qbVendorQueryPending: 0,
    }));
    expect(result.current.qbwc.clickable).toBe(false);
    expect(result.current.mirror.clickable).toBe(true);
    expect(result.current.vendors.clickable).toBe(true);
  });
});
