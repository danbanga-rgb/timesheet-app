import { describe, it, expect } from 'vitest';
import { buildRestoredPushRecords, mergePushRecords, type RestoreJobRow } from '../pushRecordRestore';

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

describe('item shapes (pilot batch 2, 2026-09-25)', () => {
  const ev = new Map([[474, { id: 474, amount: '5520.00', resolved_bill_txn_id: null }]]);
  const jobs: RestoreJobRow[] = [
    { id: 2150, kind: 'bill_add', created_at: 't', payload: { vendorName: 'FIX IT', sourceInvoiceIds: [205], lines: [{ amount: 5520 }] } },
    { id: 2151, kind: 'bill_add', created_at: 't', payload: { vendorName: 'Yara Solutions Inc.', sourceInvoiceIds: [312], lines: [{ amount: 11760 }] } },
    { id: 2154, kind: 'bill_pmt_add', created_at: 't', depends_on: ['2150'], payload: { sourceConveraTxnId: 1035, payeeVendorName: 'FIX IT' } },
  ];
  const verify = new Map([[2150, 2152], [2151, 2153], [2154, 2155]]);
  const records = buildRestoredPushRecords(jobs, ev, new Map([[1035, 474]]), verify, () => 'FIX IT');

  it('2 items, not 3 jobs', () => {
    expect(records).toHaveLength(2);
  });

  it('Nikolina: create → pay → confirm is ONE item', () => {
    expect(records.find(r => r.eventId === 474)).toMatchObject({ createJobId: 2150, payJobId: 2154, verifyJobId: 2155, kind: 'pay_bill' });
  });

  it('YARA: invoice → bill is its own item with its confirm job', () => {
    expect(records.find(r => r.invoiceId === 312)).toMatchObject({ eventId: -312, sourceKind: 'invoice', payJobId: 2151, verifyJobId: 2153, kind: 'invoice_create_bill', expectedAmount: 11760 });
  });
});

describe('mergePushRecords', () => {
  it('keeps finished records from earlier pushes and replaces re-read ones', () => {
    const merged = mergePushRecords([{ payJobId: 1, v: 'old' }, { payJobId: 2, v: 'old' }], [{ payJobId: 2, v: 'new' }, { payJobId: 3, v: 'new' }]);
    expect(merged).toEqual([{ payJobId: 1, v: 'old' }, { payJobId: 2, v: 'new' }, { payJobId: 3, v: 'new' }]);
  });
});
