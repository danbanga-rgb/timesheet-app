import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushRecord } from '../../../components/QbPushStatusPane';
import { cancelPushJobs } from '../cancelPushJobs';

// ─── Test harness — narrow mock of the two supabase call chains this fn uses ──

interface UpdateCall {
  table: string;
  patch: Record<string, unknown>;
  inFilter?: { col: string; values: unknown[] };
  eqFilter?: { col: string; value: unknown };
  notFilter?: { col: string; op: string; values: string };
  returned: Array<{ id: number }>;
}

function makeMockSupabase(
  tables: {
    qb_sync_jobs: Array<{ id: number; status: string }>;
    qb_ingest_events?: Array<{ id: number; status: string }>;
  },
  opts: { throwOn?: 'qb_sync_jobs' | 'qb_ingest_events' } = {},
): { supabase: SupabaseClient; updateCalls: UpdateCall[] } {
  const updateCalls: UpdateCall[] = [];
  const client = {
    from(table: string) {
      return {
        _table: table,
        _patch: {} as Record<string, unknown>,
        _in: undefined as { col: string; values: unknown[] } | undefined,
        _eq: undefined as { col: string; value: unknown } | undefined,
        _not: undefined as { col: string; op: string; values: string } | undefined,
        update(patch: Record<string, unknown>) { this._patch = patch; return this; },
        in(col: string, values: unknown[]) { this._in = { col, values }; return this; },
        eq(col: string, value: unknown) { this._eq = { col, value }; return this; },
        not(col: string, op: string, values: string) { this._not = { col, op, values }; return this; },
        select(_cols: string) {
          const table = this._table;
          const patch = this._patch;
          const inFilter = this._in;
          const eqFilter = this._eq;
          const notFilter = this._not;
          if (opts.throwOn === table) {
            return Promise.resolve({ data: null, error: { message: `mock error on ${table}` } });
          }
          const source = table === 'qb_sync_jobs'
            ? tables.qb_sync_jobs
            : (tables.qb_ingest_events ?? []);
          const matched = source.filter(row => {
            if (inFilter && !inFilter.values.includes(row.id)) return false;
            if (eqFilter && row[eqFilter.col as 'status'] !== eqFilter.value) return false;
            if (notFilter) {
              const parsed = notFilter.values.replace(/^\(|\)$/g, '').split(',');
              const rowVal = row[notFilter.col as 'status'];
              if (notFilter.op === 'in' && parsed.includes(String(rowVal))) return false;
            }
            return true;
          });
          for (const row of matched) Object.assign(row, patch);
          const returned = matched.map(r => ({ id: r.id }));
          const call: UpdateCall = { table, patch, inFilter, eqFilter, notFilter, returned };
          updateCalls.push(call);
          return Promise.resolve({ data: returned, error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { supabase: client, updateCalls };
}

function record(overrides: Partial<PushRecord> = {}): PushRecord {
  return {
    eventId: 1,
    sourceKind: 'event',
    payJobId: 100,
    verifyJobId: 101,
    billTxnId: 'TXN-1',
    expectedAmount: 500,
    expectedVendor: 'Vendor A',
    pushedAt: '2026-09-23T10:00:00Z',
    kind: 'pay_bill',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('cancelPushJobs', () => {
  it('returns empty result and makes no DB calls when records is empty', async () => {
    const { supabase, updateCalls } = makeMockSupabase({ qb_sync_jobs: [] });
    const res = await cancelPushJobs({ supabase, records: [] });
    expect(res).toEqual({ cancelledJobIds: [], alreadyInFlightJobIds: [], revertedEventIds: [], cancelledPayJobIds: [] });
    expect(updateCalls).toHaveLength(0);
  });

  it('flips pending pay + verify jobs to skipped and reports them', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      qb_sync_jobs: [
        { id: 100, status: 'pending' },
        { id: 101, status: 'pending' },
      ],
      qb_ingest_events: [{ id: 1, status: 'ready' }],
    });
    const res = await cancelPushJobs({ supabase, records: [record()] });
    expect(res.cancelledJobIds.sort()).toEqual([100, 101]);
    expect(res.cancelledPayJobIds).toEqual([100]);
    expect(res.alreadyInFlightJobIds).toEqual([]);
    expect(updateCalls[0]?.patch).toEqual({ status: 'skipped' });
    expect(updateCalls[0]?.eqFilter).toEqual({ col: 'status', value: 'pending' });
  });

  it('leaves in_flight jobs alone (pending-only guard) and reports them as alreadyInFlight', async () => {
    const { supabase } = makeMockSupabase({
      qb_sync_jobs: [
        { id: 100, status: 'in_flight' },
        { id: 101, status: 'pending' },
      ],
      qb_ingest_events: [{ id: 1, status: 'ready' }],
    });
    const res = await cancelPushJobs({ supabase, records: [record()] });
    expect(res.cancelledJobIds).toEqual([101]);
    expect(res.alreadyInFlightJobIds).toEqual([100]);
    expect(res.cancelledPayJobIds).toEqual([]);
    // Pay job WASN'T cancelled → don't touch the event.
    expect(res.revertedEventIds).toEqual([]);
  });

  it('reverts qb_ingest_events.status to ready ONLY when the pay job was cancelled AND event is not already ready/posted', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      qb_sync_jobs: [
        { id: 100, status: 'pending' },  // event 1 pay job — cancellable
        { id: 200, status: 'pending' },  // event 2 pay job — cancellable
        { id: 300, status: 'pending' },  // event 3 pay job — cancellable
      ],
      qb_ingest_events: [
        { id: 1, status: 'queued' },   // should revert
        { id: 2, status: 'ready' },    // already ready → no-op (guarded)
        { id: 3, status: 'posted' },   // already posted → do NOT revert
      ],
    });
    const res = await cancelPushJobs({
      supabase,
      records: [
        record({ eventId: 1, payJobId: 100, verifyJobId: null }),
        record({ eventId: 2, payJobId: 200, verifyJobId: null }),
        record({ eventId: 3, payJobId: 300, verifyJobId: null }),
      ],
    });
    expect(res.cancelledPayJobIds.sort()).toEqual([100, 200, 300]);
    expect(res.revertedEventIds).toEqual([1]);
    // The events-update call should have the not-in guard.
    const eventUpdate = updateCalls.find(c => c.table === 'qb_ingest_events');
    expect(eventUpdate?.notFilter).toEqual({ col: 'status', op: 'in', values: '(ready,posted)' });
    expect(eventUpdate?.patch).toEqual({ status: 'ready' });
  });

  it('does not touch qb_ingest_events for source=invoice records (G7.5 proactive)', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      qb_sync_jobs: [{ id: 100, status: 'pending' }],
      qb_ingest_events: [{ id: -42, status: 'queued' }],  // wouldn't match anyway
    });
    const res = await cancelPushJobs({
      supabase,
      records: [record({ eventId: -42, sourceKind: 'invoice', invoiceId: 42, payJobId: 100, verifyJobId: null })],
    });
    expect(res.cancelledPayJobIds).toEqual([100]);
    expect(res.revertedEventIds).toEqual([]);
    // Only qb_sync_jobs was touched.
    expect(updateCalls.map(c => c.table)).toEqual(['qb_sync_jobs']);
  });

  it('handles missing verify jobs gracefully (verifyJobId=null)', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      qb_sync_jobs: [{ id: 100, status: 'pending' }],
      qb_ingest_events: [{ id: 1, status: 'ready' }],
    });
    await cancelPushJobs({ supabase, records: [record({ verifyJobId: null })] });
    expect(updateCalls[0]?.inFilter?.values).toEqual([100]);
  });

  it('dedupes event IDs across records that share an event (umbrella multi-record case)', async () => {
    const { supabase, updateCalls } = makeMockSupabase({
      qb_sync_jobs: [
        { id: 100, status: 'pending' },
        { id: 200, status: 'pending' },
      ],
      qb_ingest_events: [{ id: 1, status: 'queued' }],
    });
    await cancelPushJobs({
      supabase,
      records: [
        record({ eventId: 1, payJobId: 100, verifyJobId: null }),
        record({ eventId: 1, payJobId: 200, verifyJobId: null }),
      ],
    });
    const eventUpdate = updateCalls.find(c => c.table === 'qb_ingest_events');
    expect(eventUpdate?.inFilter?.values).toEqual([1]);
  });

  it('propagates DB errors on the jobs update', async () => {
    const { supabase } = makeMockSupabase(
      { qb_sync_jobs: [{ id: 100, status: 'pending' }] },
      { throwOn: 'qb_sync_jobs' },
    );
    await expect(cancelPushJobs({ supabase, records: [record()] })).rejects.toBeTruthy();
  });
});
