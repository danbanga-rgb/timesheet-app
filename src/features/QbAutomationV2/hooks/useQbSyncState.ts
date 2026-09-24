import { useEffect, useState } from 'react';
import type { QbOpenBillRow } from '../../../lib/qbStateSync/types';
import { snapshotAge, humanizeAge } from '../../../lib/qbStateSync/freshness';

// Freshness thresholds (V1-aligned, TS.tsx:7559-7561 for QBWC).
const MIRROR_GREEN_SEC = 15 * 60;         // < 15min: green
const MIRROR_AMBER_SEC = 60 * 60;         // 15-60min: amber; >60min: red
const QBWC_ALIVE_SEC = 20 * 60;           // < 20min: alive
const QBWC_DOWN_SEC = 30 * 60;            // > 30min: down; 20-30min: delayed

export type PillStatus = 'green' | 'amber' | 'red' | 'unknown';
export type PillKind = 'mirror' | 'vendors' | 'qbwc';

export interface PillState {
  kind: PillKind;
  status: PillStatus;                     // color — driven by DATA freshness, not pending queue
  label: string;                          // "Mirror · 3m ago"
  pendingCount: number;                   // shown as subtle spinner "⟳ 2 syncing"
  clickable: boolean;                     // false for QBWC (info-only)
}

export interface UseQbSyncStateArgs {
  openBills: QbOpenBillRow[];
  vendorsLastQueriedAt: string | null;    // MAX(queried_at) from qb_mirror WHERE entity_kind='vendor'
  qbWcLastSeen: string | null;
  qbBillQueryPending: number;
  qbVendorQueryPending: number;
}

function ageSeconds(iso: string | null, now: Date): number {
  if (!iso) return Infinity;
  return Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
}

function ageStatus(iso: string | null, greenCap: number, amberCap: number, now: Date): PillStatus {
  if (!iso) return 'unknown';
  const s = ageSeconds(iso, now);
  if (s < greenCap) return 'green';
  if (s < amberCap) return 'amber';
  return 'red';
}

export function useQbSyncState(args: UseQbSyncStateArgs): {
  mirror: PillState;
  vendors: PillState;
  qbwc: PillState;
} {
  // Tick every 30s so "3m ago" ages update without a full parent re-render.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const mirrorFreshness = snapshotAge(args.openBills);
  const mirrorStatus = ageStatus(mirrorFreshness.newestQueriedAt, MIRROR_GREEN_SEC, MIRROR_AMBER_SEC, now);
  const mirrorLabel = mirrorFreshness.newestQueriedAt
    ? `Mirror · ${humanizeAge(mirrorFreshness.newestQueriedAt, now)}`
    : 'Mirror · never synced';

  const vendorsStatus = ageStatus(args.vendorsLastQueriedAt, MIRROR_GREEN_SEC, MIRROR_AMBER_SEC, now);
  const vendorsLabel = args.vendorsLastQueriedAt
    ? `Vendors · ${humanizeAge(args.vendorsLastQueriedAt, now)}`
    : 'Vendors · never synced';

  const qbwcAgeSec = ageSeconds(args.qbWcLastSeen, now);
  let qbwcStatus: PillStatus;
  let qbwcLabel: string;
  if (!args.qbWcLastSeen) {
    qbwcStatus = 'red';
    qbwcLabel = 'QBWC · never seen';
  } else if (qbwcAgeSec < QBWC_ALIVE_SEC) {
    qbwcStatus = 'green';
    qbwcLabel = 'QBWC · active';
  } else if (qbwcAgeSec < QBWC_DOWN_SEC) {
    qbwcStatus = 'amber';
    qbwcLabel = `QBWC · delayed (${humanizeAge(args.qbWcLastSeen, now)})`;
  } else {
    qbwcStatus = 'red';
    qbwcLabel = `QBWC · down (${humanizeAge(args.qbWcLastSeen, now)})`;
  }

  return {
    mirror: { kind: 'mirror', status: mirrorStatus, label: mirrorLabel, pendingCount: args.qbBillQueryPending, clickable: true },
    vendors: { kind: 'vendors', status: vendorsStatus, label: vendorsLabel, pendingCount: args.qbVendorQueryPending, clickable: true },
    qbwc: { kind: 'qbwc', status: qbwcStatus, label: qbwcLabel, pendingCount: 0, clickable: false },
  };
}

// Auto-refresh coordinator: enqueues mirror + vendor syncs on a cadence that
// matches QBWC's ~15-min drain. Guardrails against stacking: skips if a job
// of that kind is already pending. Also fires on visibility-change so a tab
// that's been backgrounded picks up fresh data on refocus.
//
// Callers pass the sync functions; hook owns timing + gating.
export interface UseQbAutoRefreshArgs {
  onSyncMirror: () => Promise<void>;
  onSyncVendors: () => Promise<void>;
  mirrorPendingCount: number;
  vendorsPendingCount: number;
  mirrorStatus: PillStatus;
  vendorsStatus: PillStatus;
  /** Test hook — inject a shorter interval when testing. Default 15min. */
  intervalMs?: number;
}

export function useQbAutoRefresh({
  onSyncMirror,
  onSyncVendors,
  mirrorPendingCount,
  vendorsPendingCount,
  mirrorStatus,
  vendorsStatus,
  intervalMs = 15 * 60 * 1000,
}: UseQbAutoRefreshArgs): void {
  // Mount: auto-sync anything amber/red or never-synced. Fire-and-forget.
  useEffect(() => {
    if (mirrorPendingCount === 0 && (mirrorStatus === 'amber' || mirrorStatus === 'red' || mirrorStatus === 'unknown')) {
      void onSyncMirror().catch(() => {});
    }
    if (vendorsPendingCount === 0 && (vendorsStatus === 'amber' || vendorsStatus === 'red' || vendorsStatus === 'unknown')) {
      void onSyncVendors().catch(() => {});
    }
    // Intentionally mount-only; periodic + visibility timers handle drift after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic: every intervalMs, enqueue a routine sync. Guard against stacking.
  useEffect(() => {
    const id = setInterval(() => {
      if (mirrorPendingCount === 0) void onSyncMirror().catch(() => {});
      if (vendorsPendingCount === 0) void onSyncVendors().catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, mirrorPendingCount, vendorsPendingCount, onSyncMirror, onSyncVendors]);

  // Visibility: when tab regains focus, top up if stale (amber/red) and nothing pending.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (mirrorPendingCount === 0 && (mirrorStatus === 'amber' || mirrorStatus === 'red')) {
        void onSyncMirror().catch(() => {});
      }
      if (vendorsPendingCount === 0 && (vendorsStatus === 'amber' || vendorsStatus === 'red')) {
        void onSyncVendors().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [mirrorPendingCount, vendorsPendingCount, mirrorStatus, vendorsStatus, onSyncMirror, onSyncVendors]);
}
