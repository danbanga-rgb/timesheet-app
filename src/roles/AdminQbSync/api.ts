// Live QB sync status queries. Admin-only reads over qb_wc_sessions +
// qb_sync_jobs. Everything here is admin-authenticated via existing RLS.

import { supabase } from '../../supabaseClient';

export interface QbSyncJobRow {
  id: number;
  kind: string;
  status: 'pending' | 'done' | 'skipped' | 'failed' | 'in_progress';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_msg: string | null;
  payload: Record<string, unknown> | null;
}

export interface QbWcSession {
  ticket: string;
  qb_company: string | null;
  last_seen_at: string;
  started_at: string;
  job_id: number | null;
}

export interface QbSyncJobStats {
  total: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
}

export async function getLatestQbWcSession(): Promise<QbWcSession | null> {
  const { data, error } = await supabase
    .from('qb_wc_sessions')
    .select('ticket, qb_company, last_seen_at, started_at, job_id')
    .order('last_seen_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to load QBWC session: ${error.message}`);
  return (data?.[0] as QbWcSession | undefined) ?? null;
}

// Fetch the most recent jobs across all kinds. Default window: last 24h, cap 100.
export async function listRecentQbSyncJobs(sinceHours = 24, limit = 100): Promise<QbSyncJobRow[]> {
  const sinceIso = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .select('id, kind, status, created_at, started_at, completed_at, error_msg, payload')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load qb_sync_jobs: ${error.message}`);
  return (data ?? []) as QbSyncJobRow[];
}

export function summarizeJobs(rows: QbSyncJobRow[]): QbSyncJobStats {
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  }
  return { total: rows.length, byStatus, byKind };
}
