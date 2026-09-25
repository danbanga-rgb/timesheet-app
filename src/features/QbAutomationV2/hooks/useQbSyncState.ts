import { useEffect, useState } from 'react';
import { humanizeAge } from '../../../lib/qbStateSync/freshness';
import type { SyncCheck } from './useLastSyncChecks';

// Freshness thresholds follow each pg_cron cadence plus ~20 min for the
// connector to pick the job up. Green = on schedule; amber = one run
// missed; red = more than one missed.
const GRACE_SEC = 20 * 60;
const BILLS_CADENCE_SEC = 60 * 60;          // qb-delta-bills: hourly at :17
const VENDORS_CADENCE_SEC = 6 * 60 * 60;    // qb-delta-vendors: every 6h at :37
export const BILLS_GREEN_SEC = BILLS_CADENCE_SEC + GRACE_SEC;
export const BILLS_AMBER_SEC = 2 * BILLS_CADENCE_SEC + GRACE_SEC;
export const VENDORS_GREEN_SEC = VENDORS_CADENCE_SEC + GRACE_SEC;
export const VENDORS_AMBER_SEC = 2 * VENDORS_CADENCE_SEC + GRACE_SEC;
const QBWC_POLL_SEC = 15 * 60;            // Web Connector checks in every 15 min
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
  lastError?: string | null;              // most recent check errored (pill forced to at least amber)
}

export interface UseQbSyncStateArgs {
  bills: SyncCheck | null;               // last finished bill_query job (null = not loaded yet)
  vendors: SyncCheck | null;             // last finished vendor_query job
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

export interface NextCheck {
  label: string;        // "~5m" | "due now" | "overdue 12m"
  overdue: boolean;
}

/** When the Web Connector should next pick up queued jobs: last check-in + 15 min. */
export function qbwcNextCheck(lastSeen: string | null, now: Date): NextCheck | null {
  if (!lastSeen) return null;
  const last = Date.parse(lastSeen);
  if (Number.isNaN(last)) return null;
  const secsLeft = Math.round((last + QBWC_POLL_SEC * 1000 - now.getTime()) / 1000);
  if (secsLeft > 60) return { label: `~${Math.ceil(secsLeft / 60)}m`, overdue: false };
  if (secsLeft > -5 * 60) return { label: 'due now', overdue: false };
  return { label: `overdue ${Math.round(-secsLeft / 60)}m`, overdue: true };
}

export function useQbSyncState(args: UseQbSyncStateArgs): {
  mirror: PillState;
  vendors: PillState;
  qbwc: PillState;
  nextCheck: NextCheck | null;
} {
  // Tick every 30s so "3m ago" ages update without a full parent re-render.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const checkPill = (check: SyncCheck | null, name: string, greenCap: number, amberCap: number) => {
    const doneAt = check?.lastDoneAt ?? null;
    let status = ageStatus(doneAt, greenCap, amberCap, now);
    // A failed latest check can't hide behind an older success.
    if (check?.lastFailedAt && (status === 'green' || status === 'unknown')) status = 'amber';
    const label = doneAt ? `${name} · ${humanizeAge(doneAt, now)}` : `${name} · never synced`;
    return { status, label, lastError: check?.lastFailedAt ? (check.lastError || 'no reason given') : null };
  };
  const mirrorPill = checkPill(args.bills, 'QB Mirror', BILLS_GREEN_SEC, BILLS_AMBER_SEC);
  const vendorsPill = checkPill(args.vendors, 'QB Vendors', VENDORS_GREEN_SEC, VENDORS_AMBER_SEC);

  const qbwcAgeSec = ageSeconds(args.qbWcLastSeen, now);
  let qbwcStatus: PillStatus;
  let qbwcLabel: string;
  if (!args.qbWcLastSeen) {
    qbwcStatus = 'red';
    qbwcLabel = 'QB connector · never connected';
  } else if (qbwcAgeSec < QBWC_ALIVE_SEC) {
    qbwcStatus = 'green';
    qbwcLabel = 'QB connector · running';
  } else if (qbwcAgeSec < QBWC_DOWN_SEC) {
    qbwcStatus = 'amber';
    qbwcLabel = `QB connector · late (${humanizeAge(args.qbWcLastSeen, now).replace(/ ago$/, '')})`;
  } else {
    qbwcStatus = 'red';
    qbwcLabel = `QB connector · stopped (${humanizeAge(args.qbWcLastSeen, now).replace(/ ago$/, '')})`;
  }

  return {
    mirror: { kind: 'mirror', ...mirrorPill, pendingCount: args.qbBillQueryPending, clickable: true },
    vendors: { kind: 'vendors', ...vendorsPill, pendingCount: args.qbVendorQueryPending, clickable: true },
    qbwc: { kind: 'qbwc', status: qbwcStatus, label: qbwcLabel, pendingCount: 0, clickable: false },
    nextCheck: qbwcNextCheck(args.qbWcLastSeen, now),
  };
}

// V10 auto-refresh (mount + periodic + visibility) REMOVED — pg_cron handles
// the baseline (bill_query hourly, vendor_query every 6h) and the push flow
// silently refreshes on completion. Pills are pure status indicators; only
// explicit user action (Sync Now link) enqueues syncs from the UI.
