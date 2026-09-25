import { describe, it, expect } from 'vitest';
import { buildRestoredPushRecords, type RestoreJobRow } from '../pushRecordRestore';

const events = new Map([
  [456, { id: 456, amount: '2880.00', resolved_bill_txn_id: '41AE3-1788463211' }],
  [42, { id: 42, amount: 5000, resolved_bill_txn_id: null }],
]);

describe('buildRestoredPushRecords', () => {
  it('restores a Convera C-1 pay job via sourceConveraTxnId and re-attaches its verify job (pilot job 2077)', () => {
    const job: RestoreJobRow = {
      id: 2077, kind: 'bill_pmt_add', created_at: '2026-09-25T20:12:39Z',
      payload: { sourceConveraTxnId: 1017, applications: [{ billTxnId: '41AE3-1788463211', paymentAmount: 2880 }] },
    };
    const [r] = buildRestoredPushRecords([job], events, new Map([[1017, 456]]), new Map([[2077, 2080]]), () => 'D-KODE');
    expect(r).toMatchObject({ eventId: 456, payJobId: 2077, verifyJobId: 2080, billTxnId: '41AE3-1788463211', expectedAmount: 2880, expectedVendor: 'D-KODE', kind: 'pay_bill' });
  });

  it('still restores jobs keyed by sourceIngestEventId; bill falls back to the application', () => {
    const job: RestoreJobRow = { id: 9, kind: 'bill_pmt_add', created_at: 't', payload: { sourceIngestEventId: 42, applications: [{ billTxnId: 'B' }] } };
    const [r] = buildRestoredPushRecords([job], events, new Map(), new Map(), () => 'X');
    expect(r).toMatchObject({ eventId: 42, billTxnId: 'B', verifyJobId: null });
  });

  it('skips jobs that cannot be tied to a known event', () => {
    const job: RestoreJobRow = { id: 1, kind: 'bill_pmt_add', created_at: 't', payload: { sourceConveraTxnId: 999 } };
    expect(buildRestoredPushRecords([job], events, new Map(), new Map(), () => 'X')).toEqual([]);
  });
});
