// Admin surface: live view of QBWC health + recent qb_sync_jobs traffic.
// Also carries the shrunk Web Connector setup section (download .qwc + link
// to docs/qb-web-connector-setup.md) — the long-form guide used to live
// inline here but was moved to the docs file.

import { useEffect, useState, type ReactElement } from 'react';
import { Download, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import {
  getLatestQbWcSession,
  listRecentQbSyncJobs,
  summarizeJobs,
  type QbSyncJobRow,
  type QbWcSession,
} from './api';

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

function durationSec(job: QbSyncJobRow): string {
  if (!job.started_at || !job.completed_at) return '—';
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at);
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<QbSyncJobRow['status'] | 'all'>('all');
  const [refreshTick, setRefreshTick] = useState(0);

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
                  onClick={() => setStatusFilter(s)}
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
        {jobs && filtered.length === 0 && <div className="mt-4 text-sm text-gray-500 py-6 text-center">No jobs in the last 24h.</div>}

        {filtered.length > 0 && (
          <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8"></th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Created</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Kind</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Duration</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((j) => {
                  const isOpen = expandedId === j.id;
                  return (
                    <>
                      <tr key={j.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedId(isOpen ? null : j.id)}>
                        <td className="px-2">
                          {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        </td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatWhen(j.created_at)}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-800">{j.kind}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {STATUS_ICON[j.status]}
                            <span className="text-xs text-gray-700">{j.status}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{durationSec(j)}</td>
                        <td className="px-3 py-2 text-red-700 text-xs truncate max-w-md">{j.error_msg ?? ''}</td>
                      </tr>
                      {isOpen && (
                        <tr key={j.id + '-x'} className="bg-gray-50">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Payload</div>
                            <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-64">
{JSON.stringify(j.payload, null, 2)}
                            </pre>
                            {j.error_msg && (
                              <>
                                <div className="text-xs uppercase tracking-wide text-gray-500 mt-3 mb-1">Error</div>
                                <pre className="text-xs bg-red-50 border border-red-200 rounded p-2 overflow-x-auto text-red-900">{j.error_msg}</pre>
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
