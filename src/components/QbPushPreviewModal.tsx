// ============================================================
// QbPushPreviewModal — Slice F of QB Automation Layer.
// Read-only preview of what will be enqueued when accountant
// pushes ingest events to QuickBooks. Confirm is a no-op in
// Slice F; Slice G wires the real enqueue.
// ============================================================

import { useMemo, useState } from 'react';
import { X, Send, AlertTriangle } from 'lucide-react';

// ─── Types (subset of QbIngestEvent + collaborators) ─────────────────────────

export type QbIngestKind = 'bill_pmt' | 'bill_add_and_pmt' | 'check' | 'ignore';
export type QbIngestStatus = 'pending' | 'ready' | 'queued' | 'posted' | 'failed' | 'ignored';

export interface PreviewEvent {
  id: number;
  source: string;
  txnDate: string;
  amount: number;
  counterpartyRaw: string;
  memo: string | null;
  counterpartyQbVendorListId: string | null;
  targetQbTxnKind: QbIngestKind | null;
  qbBankAccountListId: string | null;
  qbExpenseAccountListId: string | null;
  matchedInvoiceIds: number[];
  status: QbIngestStatus;
}

export interface PreviewVendor { listId: string; name: string; }
export interface PreviewAccount { listId: string; fullName: string; }
export interface PreviewInvoice { id: number; invoiceNumber: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  events: PreviewEvent[];
  qbVendors: PreviewVendor[];
  qbAccounts: PreviewAccount[];
  invoices: PreviewInvoice[];
  /**
   * Called with the event ids that would be pushed. In Slice F this is a no-op
   * (parent shows an alert). Slice G wires the real enqueue.
   */
  onConfirm: (readyEventIds: number[]) => void;
  /** Jump back to the Slice D mapping widget for a counterparty. */
  onFixMapping?: (counterparty: string, source: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<QbIngestKind, string> = {
  bill_pmt: 'Pay Bill',
  bill_add_and_pmt: 'Create Bill + Pay Bill',
  check: 'Check',
  ignore: 'Ignore',
};

const SOURCE_LABEL: Record<string, string> = {
  intuit_xlsx: 'Intuit',
  convera: 'Convera',
  manual: 'Manual',
};

// Rough drain-time heuristic. Batch 15 drained 28 jobs in 44s ⇒ ~1.6s/job.
// Round up to the nearest 15s so the estimate reads honestly.
const SECS_PER_JOB = 1.6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

const drainEstimate = (jobs: number): string => {
  if (jobs === 0) return '—';
  const secs = Math.max(15, Math.ceil((jobs * SECS_PER_JOB) / 15) * 15);
  if (secs < 60) return `~${secs}s`;
  const mins = Math.round(secs / 60);
  return `~${mins}m`;
};

// Jobs-per-event: bill_add_and_pmt is a chained pair, everything else is one.
const jobsForEvent = (e: PreviewEvent): number =>
  e.targetQbTxnKind === 'bill_add_and_pmt' ? 2 : 1;

// Reasons an event is not ready to push. Empty array = ready.
const heldBackReasons = (e: PreviewEvent): string[] => {
  const reasons: string[] = [];
  if (!e.targetQbTxnKind) {
    reasons.push('needs classification');
    return reasons;  // rest of checks not meaningful without a kind
  }
  if (e.targetQbTxnKind === 'ignore') return reasons;  // ignore is a valid non-push terminal state
  if (!e.counterpartyQbVendorListId) reasons.push('missing QB vendor');
  if (!e.qbBankAccountListId) reasons.push('missing bank account');
  if ((e.targetQbTxnKind === 'check' || e.targetQbTxnKind === 'bill_add_and_pmt')
      && !e.qbExpenseAccountListId) reasons.push('missing expense account');
  if ((e.targetQbTxnKind === 'bill_pmt' || e.targetQbTxnKind === 'bill_add_and_pmt')
      && e.matchedInvoiceIds.length === 0) reasons.push('no matched invoice');
  return reasons;
};

// Partition events into buckets for the preview.
function partition(events: PreviewEvent[]) {
  const heldBack: Array<{ event: PreviewEvent; reasons: string[] }> = [];
  const ready: PreviewEvent[] = [];
  const ignored: PreviewEvent[] = [];
  const posted: PreviewEvent[] = [];

  for (const e of events) {
    if (e.status === 'posted') { posted.push(e); continue; }
    if (e.status === 'ignored' || e.targetQbTxnKind === 'ignore') { ignored.push(e); continue; }
    const reasons = heldBackReasons(e);
    if (reasons.length > 0) heldBack.push({ event: e, reasons });
    else ready.push(e);
  }
  return { heldBack, ready, ignored, posted };
}

// Sub-group ignored/held events by (source, counterparty_raw) — same shape
// Slice C uses in the pending group at TimesheetSystem.tsx:9773.
// keyOf returns identity + amount so we can accumulate totals per group.
function groupByCounterparty<T>(items: T[], keyOf: (t: T) => { source: string; counterparty: string; amount: number }) {
  const m = new Map<string, { source: string; counterparty: string; items: T[]; total: number }>();
  for (const t of items) {
    const { source, counterparty, amount } = keyOf(t);
    const k = `${source}||${counterparty}`;
    const cur = m.get(k) ?? { source, counterparty, items: [], total: 0 };
    cur.items.push(t);
    cur.total += amount;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => a.counterparty.localeCompare(b.counterparty));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QbPushPreviewModal({
  open, onClose, events, qbVendors, qbAccounts, invoices, onConfirm, onFixMapping,
}: Props) {
  // Snapshot the events prop at open-time so a mid-review recompute in the parent
  // doesn't shift numbers under the accountant's feet.
  const [snapshot, setSnapshot] = useState<PreviewEvent[] | null>(null);
  const activeEvents = snapshot ?? events;

  // Take snapshot on first render after open transitions to true.
  if (open && snapshot === null) setSnapshot(events);
  // Clear snapshot on close so next open takes a fresh one.
  if (!open && snapshot !== null) setSnapshot(null);

  const { heldBack, ready, ignored, posted } = useMemo(
    () => partition(activeEvents),
    [activeEvents],
  );

  const [readyExpanded, setReadyExpanded] = useState<Record<QbIngestKind, boolean>>({
    bill_pmt: false, bill_add_and_pmt: false, check: false, ignore: false,
  });
  const [ignoredExpanded, setIgnoredExpanded] = useState(false);
  const [postedExpanded, setPostedExpanded] = useState(false);
  const [heldBackExpanded, setHeldBackExpanded] = useState(true);

  const vendorById = useMemo(() => new Map(qbVendors.map(v => [v.listId, v])), [qbVendors]);
  const accountById = useMemo(() => new Map(qbAccounts.map(a => [a.listId, a])), [qbAccounts]);
  const invoiceById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);

  if (!open) return null;

  const readyGroups: Array<{ kind: QbIngestKind; events: PreviewEvent[] }> = (
    ['bill_pmt', 'bill_add_and_pmt', 'check'] as QbIngestKind[]
  ).map(k => ({ kind: k, events: ready.filter(e => e.targetQbTxnKind === k) }))
   .filter(g => g.events.length > 0);

  const totalJobs = ready.reduce((n, e) => n + jobsForEvent(e), 0);
  const readyCount = ready.length;
  const readyTotal = ready.reduce((n, e) => n + e.amount, 0);
  const heldTotal = heldBack.reduce((n, x) => n + x.event.amount, 0);

  const handleConfirm = () => {
    if (readyCount === 0) return;
    onConfirm(ready.map(e => e.id));
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Send className="w-5 h-5 text-indigo-500" /> Push to QuickBooks — preview
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              <strong>{totalJobs}</strong> qbXML job{totalJobs === 1 ? '' : 's'}
              {' · '}est. drain {drainEstimate(totalJobs)}
              {' · '}<strong>{readyCount}</strong> event{readyCount === 1 ? '' : 's'} ready ({money(readyTotal)})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-auto flex-1 space-y-3">

          {/* Held back — needs mapping */}
          {heldBack.length > 0 && (
            <div className="border border-amber-300 rounded-lg overflow-hidden bg-amber-50">
              <button
                onClick={() => setHeldBackExpanded(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-100/60"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                  <span className="font-semibold text-amber-900">Held back — needs classification / mapping</span>
                  <span className="text-sm text-amber-800">
                    · {heldBack.length} event{heldBack.length === 1 ? '' : 's'} · {money(heldTotal)}
                  </span>
                </div>
                <span className="text-xs text-amber-700">{heldBackExpanded ? '▼' : '▶'}</span>
              </button>
              {heldBackExpanded && (
                <div className="px-4 pb-3 pt-1">
                  <p className="text-xs text-amber-800 italic mb-2">
                    These stay in the queue. They won't be pushed until each is mapped.
                  </p>
                  <ul className="space-y-1.5">
                    {groupByCounterparty(heldBack, x => ({
                      source: x.event.source, counterparty: x.event.counterpartyRaw, amount: x.event.amount,
                    })).map(grp => {
                      const uniqueReasons = Array.from(new Set(
                        grp.items.flatMap(x => x.reasons),
                      ));
                      return (
                        <li
                          key={`${grp.source}::${grp.counterparty}`}
                          className="flex items-center justify-between gap-3 text-sm bg-white/70 border border-amber-200 rounded px-3 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-gray-800">{grp.counterparty}</span>
                            <span className="ml-2 text-xs text-gray-500">
                              {sourceLabel(grp.source)} · {grp.items.length} event{grp.items.length === 1 ? '' : 's'} · {money(grp.total)}
                            </span>
                            <div className="text-xs text-amber-800 mt-0.5">
                              {uniqueReasons.join(' · ')}
                            </div>
                          </div>
                          {onFixMapping && (
                            <button
                              onClick={() => {
                                onFixMapping(grp.counterparty, grp.source);
                                onClose();
                              }}
                              className="text-xs px-2 py-1 border border-amber-400 text-amber-800 rounded hover:bg-amber-100 flex-shrink-0"
                            >
                              Fix mapping
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Ready to push — grouped */}
          {readyGroups.length === 0 && heldBack.length === 0 && ignored.length === 0 && posted.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg">
              Nothing to push right now.
            </div>
          )}

          {readyGroups.map(g => {
            const total = g.events.reduce((n, e) => n + e.amount, 0);
            const jobs = g.events.reduce((n, e) => n + jobsForEvent(e), 0);
            const bankId = g.events.find(e => e.qbBankAccountListId)?.qbBankAccountListId;
            const bank = bankId ? accountById.get(bankId) : null;
            const expanded = readyExpanded[g.kind];
            return (
              <div key={g.kind} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setReadyExpanded(prev => ({ ...prev, [g.kind]: !prev[g.kind] }))}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
                >
                  <div>
                    <span className="font-semibold text-gray-800">{KIND_LABEL[g.kind]}</span>
                    <span className="ml-2 text-sm text-gray-500">
                      × {g.events.length} = {money(total)}
                      {bank && <> · <span className="font-mono text-xs">{bank.fullName}</span></>}
                      {jobs !== g.events.length && <> · {jobs} qbXML jobs</>}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{expanded ? '▼' : '▶'}</span>
                </button>
                {expanded && (
                  <table className="w-full text-xs">
                    <thead className="bg-white text-gray-500 border-t border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-1.5 text-left">Date</th>
                        <th className="px-3 py-1.5 text-left">Counterparty</th>
                        <th className="px-3 py-1.5 text-left">QB vendor</th>
                        <th className="px-3 py-1.5 text-right">Amount</th>
                        <th className="px-3 py-1.5 text-left">Invoice(s) / account</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.events.map(e => {
                        const vendor = e.counterpartyQbVendorListId ? vendorById.get(e.counterpartyQbVendorListId) : null;
                        const expense = e.qbExpenseAccountListId ? accountById.get(e.qbExpenseAccountListId) : null;
                        const invs = e.matchedInvoiceIds.map(id => invoiceById.get(id)).filter(Boolean);
                        return (
                          <tr key={e.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 font-mono">{e.txnDate}</td>
                            <td className="px-3 py-1.5">{e.counterpartyRaw}</td>
                            <td className="px-3 py-1.5">
                              {vendor
                                ? <span className="font-mono text-[11px] px-1.5 py-0.5 bg-indigo-50 text-indigo-800 rounded">{vendor.name}</span>
                                : <span className="text-red-500">— unmapped —</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{money(e.amount)}</td>
                            <td className="px-3 py-1.5">
                              {g.kind === 'check' && expense && (
                                <span className="font-mono text-[11px] text-gray-600">{expense.fullName}</span>
                              )}
                              {(g.kind === 'bill_pmt' || g.kind === 'bill_add_and_pmt') && (
                                invs.length === 0
                                  ? <span className="text-red-500">— none —</span>
                                  : invs.map(i => (
                                      <span key={i!.id} className="inline-block mr-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-mono">
                                        {i!.invoiceNumber}
                                      </span>
                                    ))
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}

          {/* Ignored */}
          {ignored.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setIgnoredExpanded(v => !v)}
                className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-left text-sm"
              >
                <div className="text-gray-600">
                  <span className="font-medium">Ignored:</span>{' '}
                  <span className="text-xs">
                    {(() => {
                      const grp = groupByCounterparty(ignored, e => ({
                        source: e.source, counterparty: e.counterpartyRaw, amount: e.amount,
                      }));
                      return grp
                        .map(g => `${g.counterparty} × ${g.items.length}`)
                        .join(', ');
                    })()}
                  </span>
                </div>
                <span className="text-xs text-gray-400">{ignoredExpanded ? '▼' : '▶'}</span>
              </button>
              {ignoredExpanded && (
                <ul className="px-4 py-2 text-xs text-gray-600 space-y-0.5">
                  {ignored.map(e => (
                    <li key={e.id} className="flex justify-between">
                      <span>{e.txnDate} · {e.counterpartyRaw}</span>
                      <span className="font-mono">{money(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Already posted (idempotency) */}
          {posted.length > 0 && (
            <div>
              {!postedExpanded ? (
                <button
                  onClick={() => setPostedExpanded(true)}
                  className="text-xs text-gray-500 hover:text-indigo-600 hover:underline"
                >
                  Show {posted.length} previously posted (idempotency) →
                </button>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 flex items-center justify-between text-sm">
                    <span className="text-gray-600 font-medium">Previously posted · {posted.length}</span>
                    <button
                      onClick={() => setPostedExpanded(false)}
                      className="text-xs text-gray-500 hover:underline"
                    >
                      hide
                    </button>
                  </div>
                  <ul className="px-4 py-2 text-xs text-gray-600 space-y-0.5">
                    {posted.map(e => (
                      <li key={e.id} className="flex justify-between">
                        <span>{e.txnDate} · {e.counterpartyRaw}</span>
                        <span className="font-mono">{money(e.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={readyCount === 0}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            {readyCount === 0 ? 'Nothing to push' : `Push ${readyCount} to QB`}
          </button>
        </div>
      </div>
    </div>
  );
}
