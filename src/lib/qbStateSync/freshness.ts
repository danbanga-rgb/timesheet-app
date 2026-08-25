// qbStateSync/freshness — pure helpers over mirror rows. No I/O.

import type { MirrorFreshness, QbOpenBillRow } from './types';

/**
 * Compute freshness metadata over a set of open-bill rows.
 * Newest = most recently synced. Oldest = staleness driver.
 * Per-vendor ages = MAX(queried_at) per vendor_list_id.
 */
export function snapshotAge(rows: QbOpenBillRow[]): MirrorFreshness {
  if (rows.length === 0) {
    return { newestQueriedAt: null, oldestQueriedAt: null, perVendorAges: new Map(), rowCount: 0 };
  }
  let newest = rows[0].queriedAt;
  let oldest = rows[0].queriedAt;
  const perVendor = new Map<string, string>();
  for (const r of rows) {
    if (r.queriedAt > newest) newest = r.queriedAt;
    if (r.queriedAt < oldest) oldest = r.queriedAt;
    const cur = perVendor.get(r.vendorListId);
    if (!cur || r.queriedAt > cur) perVendor.set(r.vendorListId, r.queriedAt);
  }
  return { newestQueriedAt: newest, oldestQueriedAt: oldest, perVendorAges: perVendor, rowCount: rows.length };
}

/**
 * True iff the mirror is fresher than `ttlSeconds` ago. `ttlSeconds` defaults
 * to 3600 (1 hour) — the periodic-sync cadence Slice G1.5 will target.
 */
export function isFresh(freshness: MirrorFreshness, ttlSeconds: number = 3600, now: Date = new Date()): boolean {
  if (!freshness.newestQueriedAt) return false;
  const age = (now.getTime() - Date.parse(freshness.newestQueriedAt)) / 1000;
  return age <= ttlSeconds;
}

/**
 * Vendors in `vendorListIds` that need re-sync — either never queried
 * (missing from perVendorAges) or last-queried more than `ttlSeconds` ago.
 */
export function vendorsNeedingSync(
  vendorListIds: string[],
  freshness: MirrorFreshness,
  ttlSeconds: number = 3600,
  now: Date = new Date(),
): string[] {
  const stale: string[] = [];
  const cutoffMs = now.getTime() - ttlSeconds * 1000;
  for (const id of vendorListIds) {
    const last = freshness.perVendorAges.get(id);
    if (!last || Date.parse(last) < cutoffMs) stale.push(id);
  }
  return stale;
}

/**
 * Human-readable age. "3m ago", "2h ago", "never synced".
 */
export function humanizeAge(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'never synced';
  const secs = Math.floor((now.getTime() - Date.parse(iso)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
