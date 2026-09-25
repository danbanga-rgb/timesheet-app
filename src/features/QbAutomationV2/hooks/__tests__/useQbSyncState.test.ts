// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { qbwcNextCheck, useQbSyncState } from '../useQbSyncState';
import type { SyncCheck } from '../useLastSyncChecks';

const MIN = 60_000;
const HR = 60 * MIN;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const ok = (msAgo: number): SyncCheck => ({ lastDoneAt: iso(msAgo), lastFailedAt: null, lastError: null });

function run(bills: SyncCheck | null, vendors: SyncCheck | null, qbwcAgoMs: number | null = 3 * MIN, pending = [0, 0]) {
  return renderHook(() => useQbSyncState({
    bills,
    vendors,
    qbWcLastSeen: qbwcAgoMs == null ? null : iso(qbwcAgoMs),
    qbBillQueryPending: pending[0],
    qbVendorQueryPending: pending[1],
  })).result.current;
}

describe('useQbSyncState', () => {
  it('bills pill follows the hourly cadence (+20 min grace)', () => {
    expect(run(ok(55 * MIN), ok(MIN)).mirror.status).toBe('green');
    expect(run(ok(75 * MIN), ok(MIN)).mirror.status).toBe('green');
    expect(run(ok(90 * MIN), ok(MIN)).mirror.status).toBe('amber');
    expect(run(ok(3 * HR), ok(MIN)).mirror.status).toBe('red');
  });

  it('vendors pill follows the 6-hour cadence (+20 min grace)', () => {
    expect(run(ok(MIN), ok(5 * HR)).vendors.status).toBe('green');
    expect(run(ok(MIN), ok(7 * HR)).vendors.status).toBe('amber');
    expect(run(ok(MIN), ok(13 * HR)).vendors.status).toBe('red');
  });

  it('a failed latest check forces at least amber and carries the error', () => {
    const failing: SyncCheck = { lastDoneAt: iso(10 * MIN), lastFailedAt: iso(2 * MIN), lastError: 'QBWC timeout' };
    const s = run(failing, ok(MIN));
    expect(s.mirror.status).toBe('amber');
    expect(s.mirror.lastError).toBe('QBWC timeout');
    const oldAndFailing: SyncCheck = { lastDoneAt: iso(5 * HR), lastFailedAt: iso(2 * MIN), lastError: null };
    expect(run(oldAndFailing, ok(MIN)).mirror.status).toBe('red');
  });

  it('label shows age of the last successful check', () => {
    expect(run(ok(5 * MIN), ok(MIN)).mirror.label).toMatch(/^QB Mirror · /);
    expect(run(null, null).mirror.label).toBe('QB Mirror · never synced');
  });

  it('status is based on age, NOT pending count', () => {
    const s = run(ok(2 * MIN), ok(2 * MIN), 3 * MIN, [3, 2]);
    expect(s.mirror.status).toBe('green');
    expect(s.mirror.pendingCount).toBe(3);
    expect(s.vendors.pendingCount).toBe(2);
  });

  it('unknown when never synced; never-seen connector is red', () => {
    const s = run(null, null, null);
    expect(s.mirror.status).toBe('unknown');
    expect(s.vendors.status).toBe('unknown');
    expect(s.qbwc.status).toBe('red');
  });

  it('qbwc: amber 20-30min, red > 30min, not clickable', () => {
    expect(run(ok(MIN), ok(MIN), 25 * MIN).qbwc.status).toBe('amber');
    expect(run(ok(MIN), ok(MIN), 45 * MIN).qbwc.status).toBe('red');
    expect(run(ok(MIN), ok(MIN)).qbwc.clickable).toBe(false);
  });
});

describe('qbwcNextCheck (connector checks in every 15 min)', () => {
  const now = new Date('2026-09-25T20:19:20Z');
  it('pilot: last seen 20:09:35 → next check ~6m', () => {
    expect(qbwcNextCheck('2026-09-25T20:09:35Z', now)).toEqual({ label: '~6m', overdue: false });
  });
  it('within a minute either side → due now', () => {
    expect(qbwcNextCheck('2026-09-25T20:04:40Z', now)?.label).toBe('due now');
  });
  it('more than 5 min late → overdue', () => {
    expect(qbwcNextCheck('2026-09-25T19:52:00Z', now)).toEqual({ label: 'overdue 12m', overdue: true });
  });
  it('never seen → null', () => {
    expect(qbwcNextCheck(null, now)).toBeNull();
  });
});
