import { X } from 'lucide-react';
import { jobKindLabel } from './jobKindLabel';

// V2-owned inspector for pending qb_sync_jobs. Opens from a HeaderPill click
// when the mirror or vendors pill is in the "syncing… N pending" state.
// Owning this here (rather than sharing V1's popup) means V2 survives V1
// deletion at V12 cutover.

export interface PendingJobRow {
  id: number;
  kind: string;                           // 'bill_query' | 'vendor_query' | 'bill_add' | ...
  createdAt: string;                      // ISO
  payload: Record<string, unknown> | null;
}

interface Props {
  jobs: PendingJobRow[];
  onClose: () => void;
  nextCheckLabel?: string | null;   // "~5m" | "due now" | "overdue 12m"
}

function agoMinutes(iso: string): string {
  const secs = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function PendingJobsInspector({ jobs, onClose, nextCheckLabel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
          <div>
            <div className="font-semibold text-gray-800">Pending QB jobs</div>
            <div className="text-xs text-gray-600 mt-0.5">
              {jobs.length} job{jobs.length === 1 ? '' : 's'} · {nextCheckLabel ? `connector's next check ${nextCheckLabel}` : 'the connector picks them up within about 15 min'}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {jobs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No pending jobs.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Job</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map(j => (
                  <tr key={j.id}>
                    <td className="px-3 py-1.5">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                        {jobKindLabel(j.kind)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gray-500">#{j.id}</td>
                    <td className="px-3 py-1.5 text-gray-600">{agoMinutes(j.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
