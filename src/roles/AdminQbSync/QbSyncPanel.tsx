// Admin surface: live view of QBWC health + recent qb_sync_jobs traffic.
// Also carries the shrunk Web Connector setup section (download .qwc + link
// to docs/qb-web-connector-setup.md) — the long-form guide used to live
// inline here but was moved to the docs file.

import { useEffect, useState, type ReactElement } from 'react';
import { Download, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import {
  getLatestQbWcSession,
  listRecentQbSyncJobs,
  summarizeJobs,
  type QbSyncJobRow,
  type QbWcSession,
} from './api';

const PAGE_SIZE = 25;

const STATUS_ICON: Record<QbSyncJobRow['status'], ReactElement> = {
  pending: <Clock className="w-4 h-4 text-amber-600" />,
  in_progress: <Clock className="w-4 h-4 text-blue-600" />,
  done: <CheckCircle className="w-4 h-4 text-green-600" />,
  skipped: <AlertTriangle className="w-4 h-4 text-gray-400" />,
  failed: <XCircle className="w-4 h-4 text-red-600" />,
};

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function durationMs(job: QbSyncJobRow): number | null {
  if (!job.started_at || !job.completed_at) return null;
  return Date.parse(job.completed_at) - Date.parse(job.started_at);
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// A group is a bag of jobs sharing (created-minute, kind, status).
// A group of size 1 renders identically to the previous single-row shape.
interface JobGroup {
  key: string;              // stable id for expand toggle
  minuteIso: string;        // the shared created_at truncated to minute
  kind: string;
  status: QbSyncJobRow['status'];
  jobs: QbSyncJobRow[];     // ordered newest → oldest, matching input order
  errorCount: number;
  minDurationMs: number | null;
  maxDurationMs: number | null;
}

// Truncate to minute for grouping. Uses raw ISO (before locale formatting).
function truncateToMinute(iso: string): string {
  const d = new Date(iso);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function groupJobs(rows: QbSyncJobRow[]): JobGroup[] {
  const map = new Map<string, JobGroup>();
  for (const j of rows) {
    const minuteIso = truncateToMinute(j.created_at);
    const key = `${minuteIso}|${j.kind}|${j.status}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key, minuteIso, kind: j.kind, status: j.status,
        jobs: [], errorCount: 0,
        minDurationMs: null, maxDurationMs: null,
      };
      map.set(key, g);
    }
    g.jobs.push(j);
    if (j.error_msg) g.errorCount++;
    const d = durationMs(j);
    if (d != null) {
      g.minDurationMs = g.minDurationMs == null ? d : Math.min(g.minDurationMs, d);
      g.maxDurationMs = g.maxDurationMs == null ? d : Math.max(g.maxDurationMs, d);
    }
  }
  // Preserve original ordering (newest first) — sort by minuteIso desc.
  return Array.from(map.values()).sort((a, b) => b.minuteIso.localeCompare(a.minuteIso));
}

function QbwcHealth({ session }: { session: QbWcSession | null }) {
  if (!session) {
    return (
      <div className="p-4 border border-gray-300 bg-gray-50 rounded-lg text-sm text-gray-600">
        QBWC · never seen. Set up the Web Connector below.
      </div>
    );
  }
  const ageMs = Date.now() - Date.parse(session.last_seen_at);
  const alive = ageMs < 20 * 60_000;
  const down = ageMs > 30 * 60_000;
  const nextPollMs = Date.parse(session.last_seen_at) + 15 * 60_000 - Date.now();
  const nextLabel = nextPollMs > 0
    ? `next poll in ~${Math.max(1, Math.round(nextPollMs / 60_000))}m`
    : 'next poll due';
  const color = down ? 'red' : alive ? 'green' : 'amber';
  const bgClass = down ? 'bg-red-50 border-red-200' : alive ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200';
  const textClass = down ? 'text-red-800' : alive ? 'text-green-800' : 'text-amber-800';

  return (
    <div className={`p-4 border rounded-lg ${bgClass}`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${textClass}`}>
        {down ? <XCircle className="w-5 h-5" /> : alive ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
        <span>QBWC {down ? 'not running' : alive ? 'alive' : 'delayed'}</span>
        <span className="text-xs opacity-70">· {nextLabel}</span>
      </div>
      <div className="mt-2 text-xs text-gray-600 grid grid-cols-2 gap-x-4 gap-y-1">
        <div>Last seen</div><div>{formatWhen(session.last_seen_at)}</div>
        <div>Session started</div><div>{formatWhen(session.started_at)}</div>
        {session.qb_company && (<><div>Company file</div><div className="font-mono text-[11px] truncate">{session.qb_company}</div></>)}
      </div>
      <div className="sr-only">{color}</div>
    </div>
  );
}

export default function QbSyncPanel() {
  const [jobs, setJobs] = useState<QbSyncJobRow[] | null>(null);
  const [session, setSession] = useState<QbWcSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QbSyncJobRow['status'] | 'all'>('all');
  const [refreshTick, setRefreshTick] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([listRecentQbSyncJobs(24, 100), getLatestQbWcSession()])
      .then(([j, s]) => { if (!cancelled) { setJobs(j); setSession(s); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const filtered = (jobs ?? []).filter((j) => statusFilter === 'all' || j.status === statusFilter);
  const stats = jobs ? summarizeJobs(jobs) : null;
  const grouped = groupJobs(filtered);
  const totalPages = Math.max(1, Math.ceil(grouped.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = grouped.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Live health + traffic */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-800">QuickBooks Sync — Live</h2>
            <p className="text-sm text-gray-600 mt-1">
              QBWC heartbeat and recent qb_sync_jobs traffic (last 24h, cap 100).
            </p>
          </div>
          <button
            onClick={() => setRefreshTick((t) => t + 1)}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        <QbwcHealth session={session} />

        {stats && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {(['all', 'done', 'pending', 'failed', 'skipped'] as const).map((s) => {
              const count = s === 'all' ? stats.total : (stats.byStatus[s] ?? 0);
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setPage(0); }}
                  className={`px-3 py-1 rounded-full font-medium ${active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {s === 'all' ? `All (${count})` : `${s} (${count})`}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">{error}</div>
        )}

        {!jobs && !error && <div className="mt-4 text-sm text-gray-500 py-6 text-center">Loading…</div>}
        {jobs && grouped.length === 0 && <div className="mt-4 text-sm text-gray-500 py-6 text-center">No jobs in the last 24h.</div>}

        {grouped.length > 0 && (
          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8"></th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Created</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Kind</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-600">Jobs</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pageRows.map((g) => {
                  const isOpen = expandedKey === g.key;
                  const n = g.jobs.length;
                  const durationLabel = g.minDurationMs == null
                    ? '—'
                    : g.minDurationMs === g.maxDurationMs
                      ? formatMs(g.minDurationMs)
                      : `${formatMs(g.minDurationMs)}–${formatMs(g.maxDurationMs)}`;
                  const errorLabel = g.errorCount === 0
                    ? ''
                    : n === 1
                      ? (g.jobs[0].error_msg ?? '')
                      : `${g.errorCount} of ${n} failed`;
                  return (
                    <>
                      <tr key={g.key} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedKey(isOpen ? null : g.key)}>
                        <td className="px-2">
                          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        </td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatWhen(g.minuteIso)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-800">{g.kind}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {STATUS_ICON[g.status]}
                            <span className="text-xs text-gray-700">{g.status}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                          {n === 1 ? '1' : <span className="font-medium">× {n}</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{durationLabel}</td>
                        <td className="px-3 py-2 text-red-700 text-xs truncate max-w-md">{errorLabel}</td>
                      </tr>
                      {isOpen && (
                        <tr key={g.key + '-x'} className="bg-gray-50">
                          <td colSpan={7} className="px-4 py-4">
                            {n === 1 ? (
                              <>
                                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Payload</div>
                                <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-64">
{JSON.stringify(g.jobs[0].payload, null, 2)}
                                </pre>
                                {g.jobs[0].error_msg && (
                                  <>
                                    <div className="text-xs uppercase tracking-wide text-gray-500 mt-3 mb-1">Error</div>
                                    <pre className="text-xs bg-red-50 border border-red-200 rounded p-2 overflow-x-auto text-red-900">{g.jobs[0].error_msg}</pre>
                                  </>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">{n} jobs in this minute</div>
                                <div className="max-h-64 overflow-y-auto bg-white border border-gray-200 rounded">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-gray-100 sticky top-0">
                                      <tr>
                                        <th className="px-2 py-1 text-left font-medium text-gray-600">Job #</th>
                                        <th className="px-2 py-1 text-left font-medium text-gray-600">Duration</th>
                                        <th className="px-2 py-1 text-left font-medium text-gray-600">Payload summary</th>
                                        <th className="px-2 py-1 text-left font-medium text-gray-600">Error</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                      {g.jobs.map((j) => {
                                        const p = j.payload as Record<string, unknown> | null;
                                        const summary = p ? (typeof p.vendorName === 'string' ? p.vendorName : typeof p.name === 'string' ? p.name : Object.keys(p).slice(0, 2).join(', ')) : '';
                                        return (
                                          <tr key={j.id}>
                                            <td className="px-2 py-1 tabular-nums text-gray-700">{j.id}</td>
                                            <td className="px-2 py-1 tabular-nums text-gray-700">{formatMs(durationMs(j))}</td>
                                            <td className="px-2 py-1 text-gray-700 truncate max-w-xs">{summary}</td>
                                            <td className="px-2 py-1 text-red-700 truncate max-w-xs">{j.error_msg ?? ''}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-200 text-sm">
                <div className="text-gray-600">
                  Showing {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, grouped.length)} of {grouped.length} groups
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={clampedPage === 0}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" /> Prev
                  </button>
                  <span className="text-gray-700 tabular-nums">Page {clampedPage + 1} of {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={clampedPage >= totalPages - 1}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup — shrunk from the full guide (now in docs/qb-web-connector-setup.md) */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-2">Web Connector Setup</h2>
        <p className="text-sm text-gray-600 mb-4">
          One-time setup for the accountant's Windows machine. Full step-by-step guide:
          {' '}<code className="text-xs">docs/qb-web-connector-setup.md</code>.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qb-web-connector/qwc`}
            download="synergie-timesheet.qwc"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            <Download className="w-4 h-4" /> Download synergie-timesheet.qwc
          </a>
          <span className="text-xs text-gray-500">
            Hand this to the accountant with the Web Connector password from your password manager.
          </span>
        </div>
        <div className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
          <strong>Before the first live run:</strong> test against a copy of the QuickBooks company file (right-click the <code>.QBW</code> → Copy → rename with <code>TEST</code>). Only switch to the real file after a clean test run.
        </div>
      </div>
    </div>
  );
}
