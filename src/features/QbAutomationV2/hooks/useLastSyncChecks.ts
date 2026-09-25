import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

// Pill freshness = when QuickBooks last FINISHED answering a query job,
// read from qb_sync_jobs. Not qb_mirror.queried_at: the hourly delta query
// only rewrites rows that changed, so a quiet day leaves mirror timestamps
// hours old even though every hourly check succeeded (17h-old pill on
// 2026-09-25 with the mirror fully current).
//
// Read-only. Never enqueues anything — sync cadence belongs to pg_cron.

export interface SyncCheck {
  lastDoneAt: string | null;     // latest completed_at with status='done'
  lastFailedAt: string | null;   // set only when the most recent finished job errored
  lastError: string | null;
}

export type SyncKind = 'bill_query' | 'vendor_query';

async function loadCheck(supabase: SupabaseClient, kind: SyncKind): Promise<SyncCheck> {
  const [latestRes, doneRes] = await Promise.all([
    supabase.from('qb_sync_jobs')
      .select('status, completed_at, error_msg')
      .eq('kind', kind)
      .in('status', ['done', 'error'])
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1),
    supabase.from('qb_sync_jobs')
      .select('completed_at')
      .eq('kind', kind)
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1),
  ]);
  const latest = (latestRes.data?.[0] ?? null) as { status: string; completed_at: string; error_msg: string | null } | null;
  const lastDoneAt = (doneRes.data?.[0]?.completed_at as string | undefined) ?? null;
  const failing = latest?.status === 'error';
  return {
    lastDoneAt,
    lastFailedAt: failing ? latest!.completed_at : null,
    lastError: failing ? (latest!.error_msg || null) : null,
  };
}

/** `refreshKey` should change whenever a job may have finished (e.g. the
 *  pending-job count). The hook re-reads on mount and on every change. */
export function useLastSyncChecks(supabase: SupabaseClient, refreshKey: unknown): {
  bills: SyncCheck | null;
  vendors: SyncCheck | null;
} {
  const [bills, setBills] = useState<SyncCheck | null>(null);
  const [vendors, setVendors] = useState<SyncCheck | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadCheck(supabase, 'bill_query'), loadCheck(supabase, 'vendor_query')])
      .then(([b, v]) => {
        if (cancelled) return;
        setBills(b);
        setVendors(v);
      })
      .catch(e => console.warn('useLastSyncChecks failed', e));
    return () => { cancelled = true; };
  }, [supabase, refreshKey]);

  return { bills, vendors };
}
