// ============================================================
// QbPushPreviewModal — Slice G5: consumes reconciler output.
//
// Displays 5 buckets based on qb_ingest_events.resolved_action:
//   Auto-closed (already_done)  — bill+payment both in QB; nothing to push
//   Pay Bill (pay_existing_bill) — push bill_pmt_add against resolved_bill_txn_id
//   Create + Pay (create_bill_then_pay) — push bill_add then bill_pmt_add
//   Check (check)                — push check_add (Lucien-style direct expense)
//   Held back (held | null)      — reconciler couldn't resolve; requires action
//
// G7a (2026-08-21): per-row checkboxes on pay_existing_bill rows, default OFF.
// create_bill_then_pay + check rows show disabled checkboxes with a "coming in
// G7.5" tooltip — the intent is to visually communicate the full picture while
// keeping the first live-push scope small. Push button = "Push N selected to QB".
// ============================================================

import { useMemo, useState } from 'react';
import { X, Send, AlertTriangle, CheckCircle } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type QbIngestKind = 'bill_pmt' | 'bill_add_and_pmt' | 'check' | 'ignore';
export type QbIngestStatus = 'pending' | 'ready' | 'queued' | 'posted' | 'failed' | 'ignored';
export type QbResolvedAction =
  | 'already_done'
  | 'pay_existing_bill'
  | 'create_bill_then_pay'
  | 'check'
  | 'held'
  | 'pre_our_system';
export type MatchProvenance = 'exact-txn' | 'exact-ref' | 'fuzzy' | 'empty';

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
  // Slice G4c reconciler output — added by G5 modal consumption
  resolvedAction: QbResolvedAction | null;
  resolvedBillTxnId: string | null;
  resolvedPaymentTxnId: string | null;
  resolvedReason: string | null;
  postedQbRefs: Record<string, unknown> | null;   // { posted_source: 'qb_probe' | 'push' | ... }
  matchProvenance: MatchProvenance | null;        // 2026-08-24 — invoice-link strength gate
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
  onConfirm: (readyEventIds: number[]) => void;
  onFixMapping?: (counterparty: string, source: string) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Only the actions rendered as expandable Ready-group headers need labels here.
// held + pre_our_system have their own dedicated sections below.
const ACTION_LABEL: Record<Exclude<QbResolvedAction, 'held' | 'pre_our_system'>, string> = {
  already_done: 'Already done in QB (auto-closed)',
  pay_existing_bill: 'Pay existing Bill',
  create_bill_then_pay: 'Create Bill + Pay Bill',
  check: 'Check (direct expense)',
};

const SOURCE_LABEL: Record<string, string> = {
  intuit_xlsx: 'Intuit', convera: 'Convera', manual: 'Manual',
};

const SECS_PER_JOB = 1.6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

const drainEstimate = (jobs: number): string => {
  if (jobs === 0) return '—';
  const secs = Math.max(15, Math.ceil((jobs * SECS_PER_JOB) / 15) * 15);
  if (secs < 60) return `~${secs}s`;
  return `~${Math.round(secs / 60)}m`;
};

// Jobs per event by resolved action:
//   pay_existing_bill    → 1 (bill_pmt_add only)
//   create_bill_then_pay → 2 (bill_add + bill_pmt_add chained)
//   check                → 1 (check_add)
//   already_done         → 0 (auto-closed, nothing to push)
//   held                 → 0 (not pushed)
const jobsForEvent = (e: PreviewEvent): number => {
  if (e.resolvedAction === 'create_bill_then_pay') return 2;
  if (e.resolvedAction === 'pay_existing_bill' || e.resolvedAction === 'check') return 1;
  return 0;
};

// Ready-action = pushable
const READY_ACTIONS: QbResolvedAction[] = ['pay_existing_bill', 'create_bill_then_pay', 'check'];
const isReady = (e: PreviewEvent) => e.resolvedAction != null && READY_ACTIONS.includes(e.resolvedAction);

// A held reason for an unreconciled or explicitly-held event.
const heldReason = (e: PreviewEvent): string => {
  if (e.resolvedAction === 'held') return e.resolvedReason ?? 'reconciler held';
  if (e.resolvedAction == null) {
    if (!e.targetQbTxnKind) return 'needs classification (map counterparty)';
    return 'not yet reconciled — click Recompute or Sync QB state';
  }
  return 'unknown state';
};

interface Partition {
  autoClosed: PreviewEvent[];           // status='posted' with posted_source='qb_probe' OR resolvedAction='already_done'
  ready: PreviewEvent[];                // resolvedAction ∈ {pay_existing_bill, create_bill_then_pay, check}
  heldBack: PreviewEvent[];             // resolvedAction='held' OR null (and status='pending')
  ignored: PreviewEvent[];              // status='ignored' OR resolvedAction='held' with targetQbTxnKind='ignore'
  postedByPush: PreviewEvent[];         // status='posted' with posted_source!='qb_probe' (previously pushed by us)
  preOurSystem: PreviewEvent[];         // resolvedAction='pre_our_system' — QB handled manually before we came online
}

function partition(events: PreviewEvent[]): Partition {
  const p: Partition = { autoClosed: [], ready: [], heldBack: [], ignored: [], postedByPush: [], preOurSystem: [] };
  for (const e of events) {
    const postedSource = (e.postedQbRefs as Record<string, unknown> | null)?.posted_source as string | undefined;
    if (e.status === 'posted') {
      if (postedSource === 'qb_probe' || e.resolvedAction === 'already_done') p.autoClosed.push(e);
      else p.postedByPush.push(e);
      continue;
    }
    if (e.resolvedAction === 'pre_our_system') { p.preOurSystem.push(e); continue; }
    if (e.status === 'ignored' || e.targetQbTxnKind === 'ignore') { p.ignored.push(e); continue; }
    if (e.resolvedAction === 'already_done') { p.autoClosed.push(e); continue; }
    if (isReady(e)) { p.ready.push(e); continue; }
    // 'held' or null → held back
    p.heldBack.push(e);
  }
  return p;
}

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
  const [snapshot, setSnapshot] = useState<PreviewEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const activeEvents = snapshot ?? events;
  if (open && snapshot === null) { setSnapshot(events); setSelected(new Set()); }
  if (!open && snapshot !== null) { setSnapshot(null); setSelected(new Set()); }

  const parts = useMemo(() => partition(activeEvents), [activeEvents]);

  // G7a: only pay_existing_bill is pushable through the executor today.
  // The other actions render as disabled with a "coming in G7.5" tooltip.
  const PUSHABLE_ACTIONS: QbResolvedAction[] = ['pay_existing_bill'];
  const isPushable = (e: PreviewEvent) => e.resolvedAction != null && PUSHABLE_ACTIONS.includes(e.resolvedAction);
  // 2026-08-24 provenance gate — mirrors intuitPush.ts consumer.
  // Only exact-txn / exact-ref events are eligible to select. Weaker provenance
  // means the invoice link is not trustworthy enough to auto-push; the human
  // must resolve the ambiguity (backlog: add per-row "verified" override).
  const isProvenanceStrong = (e: PreviewEvent) => e.matchProvenance === 'exact-txn' || e.matchProvenance === 'exact-ref';
  const isSelectable = (e: PreviewEvent) => isPushable(e) && isProvenanceStrong(e);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    heldBack: true, pay_existing_bill: true, create_bill_then_pay: false, check: false,
    autoClosed: false, ignored: false, postedByPush: false, preOurSystem: false,
  });
  const toggle = (k: string) => setExpanded(prev => ({ ...prev, [k]: !prev[k] }));

  const toggleSelected = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const vendorById = useMemo(() => new Map(qbVendors.map(v => [v.listId, v])), [qbVendors]);
  const accountById = useMemo(() => new Map(qbAccounts.map(a => [a.listId, a])), [qbAccounts]);
  const invoiceById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);

  if (!open) return null;

  type PushableAction = Exclude<QbResolvedAction, 'held' | 'already_done' | 'pre_our_system'>;
  const readyGroups: Array<{ action: PushableAction; events: PreviewEvent[] }> = (
    ['pay_existing_bill', 'create_bill_then_pay', 'check'] as PushableAction[]
  ).map(a => ({ action: a, events: parts.ready.filter(e => e.resolvedAction === a) }))
   .filter(g => g.events.length > 0);

  const totalJobs = parts.ready.reduce((n, e) => n + jobsForEvent(e), 0);
  const readyCount = parts.ready.length;
  const readyTotal = parts.ready.reduce((n, e) => n + e.amount, 0);
  const heldTotal = parts.heldBack.reduce((n, e) => n + e.amount, 0);
  const autoClosedTotal = parts.autoClosed.reduce((n, e) => n + e.amount, 0);

  const pushableEvents = parts.ready.filter(isPushable);
  const selectableEvents = pushableEvents.filter(isSelectable);
  const selectedTotal = selectableEvents.filter(e => selected.has(e.id)).reduce((n, e) => n + e.amount, 0);
  const selectPushableAll = () => setSelected(new Set(selectableEvents.map(e => e.id)));
  const clearSelected = () => setSelected(new Set());
  const allPushableSelected = selectableEvents.length > 0 && selectableEvents.every(e => selected.has(e.id));

  const handleConfirm = () => {
    if (selected.size === 0) return;
    // Soft second-confirm on any live push while we're still gaining trust.
    const ok = window.confirm(
      `First live-push safety check.\n\n` +
      `You're about to push ${selected.size} pay_existing_bill event${selected.size === 1 ? '' : 's'} to QuickBooks (${money(selectedTotal)}).\n\n` +
      `Continue?`,
    );
    if (!ok) return;
    onConfirm(Array.from(selected));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
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
              {parts.autoClosed.length > 0 && (
                <>{' · '}<span className="text-green-700"><CheckCircle className="w-3 h-3 inline mr-0.5" />{parts.autoClosed.length} already done ({money(autoClosedTotal)})</span></>
              )}
            </p>
            {pushableEvents.length > 0 && (
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                <span>
                  G7a: only <em>pay_existing_bill</em> is wired to QB. Others show for context.
                </span>
                {selectableEvents.length < pushableEvents.length && (
                  <span className="text-amber-700">
                    · {pushableEvents.length - selectableEvents.length} row{pushableEvents.length - selectableEvents.length === 1 ? '' : 's'} disabled (weak invoice link)
                  </span>
                )}
                {selectableEvents.length > 0 && (
                  <button
                    onClick={allPushableSelected ? clearSelected : selectPushableAll}
                    className="text-indigo-700 hover:text-indigo-900 hover:underline"
                  >
                    {allPushableSelected
                      ? `Clear (${selected.size})`
                      : `Select all ${selectableEvents.length} eligible`}
                  </button>
                )}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-auto flex-1 space-y-3">

          {/* Held back — reconciler flagged or not-yet-reconciled */}
          {parts.heldBack.length > 0 && (
            <div className="border border-amber-300 rounded-lg overflow-hidden bg-amber-50">
              <button onClick={() => toggle('heldBack')} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-100/60">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                  <span className="font-semibold text-amber-900">Held back</span>
                  <span className="text-sm text-amber-800">
                    · {parts.heldBack.length} event{parts.heldBack.length === 1 ? '' : 's'} · {money(heldTotal)}
                  </span>
                </div>
                <span className="text-xs text-amber-700">{expanded.heldBack ? '▼' : '▶'}</span>
              </button>
              {expanded.heldBack && (
                <div className="px-4 pb-3 pt-1">
                  <p className="text-xs text-amber-800 italic mb-2">
                    These won't be pushed until the underlying issue is resolved.
                  </p>
                  <ul className="space-y-1.5">
                    {groupByCounterparty(parts.heldBack, e => ({
                      source: e.source, counterparty: e.counterpartyRaw, amount: e.amount,
                    })).map(grp => {
                      const reasons = Array.from(new Set(grp.items.map(e => heldReason(e))));
                      return (
                        <li key={`${grp.source}::${grp.counterparty}`} className="flex items-center justify-between gap-3 text-sm bg-white/70 border border-amber-200 rounded px-3 py-1.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-gray-800">{grp.counterparty}</span>
                            <span className="ml-2 text-xs text-gray-500">
                              {sourceLabel(grp.source)} · {grp.items.length} event{grp.items.length === 1 ? '' : 's'} · {money(grp.total)}
                            </span>
                            <div className="text-xs text-amber-800 mt-0.5">
                              {reasons.join(' · ')}
                            </div>
                          </div>
                          {onFixMapping && (
                            <button
                              onClick={() => { onFixMapping(grp.counterparty, grp.source); onClose(); }}
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

          {/* Empty state */}
          {readyGroups.length === 0 && parts.heldBack.length === 0 && parts.ignored.length === 0 && parts.autoClosed.length === 0 && parts.postedByPush.length === 0 && parts.preOurSystem.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg">
              Nothing to push right now.
            </div>
          )}

          {/* Ready to push — grouped by resolved action */}
          {readyGroups.map(g => {
            const total = g.events.reduce((n, e) => n + e.amount, 0);
            const jobs = g.events.reduce((n, e) => n + jobsForEvent(e), 0);
            const bankId = g.events.find(e => e.qbBankAccountListId)?.qbBankAccountListId;
            const bank = bankId ? accountById.get(bankId) : null;
            const isExpanded = expanded[g.action];
            const groupPushable = PUSHABLE_ACTIONS.includes(g.action);
            const groupSelectedCount = groupPushable ? g.events.filter(e => selected.has(e.id)).length : 0;
            return (
              <div key={g.action} className={`border rounded-lg overflow-hidden ${groupPushable ? 'border-indigo-200' : 'border-gray-200'}`}>
                <button onClick={() => toggle(g.action)} className={`w-full flex items-center justify-between px-4 py-3 text-left ${groupPushable ? 'bg-indigo-50/40 hover:bg-indigo-50/70' : 'bg-gray-50 hover:bg-gray-100'}`}>
                  <div>
                    <span className="font-semibold text-gray-800">{ACTION_LABEL[g.action]}</span>
                    {!groupPushable && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                        coming in G7.5
                      </span>
                    )}
                    <span className="ml-2 text-sm text-gray-500">
                      × {g.events.length} = {money(total)}
                      {bank && <> · <span className="font-mono text-xs">{bank.fullName}</span></>}
                      {jobs !== g.events.length && <> · {jobs} qbXML jobs</>}
                      {groupPushable && (
                        <> · <span className="font-medium text-indigo-700">{groupSelectedCount} selected</span></>
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                </button>
                {isExpanded && (
                  <table className="w-full text-xs">
                    <thead className="bg-white text-gray-500 border-t border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-1.5 text-left w-8">
                          {groupPushable && (
                            <input
                              type="checkbox"
                              checked={allPushableSelected && groupSelectedCount === g.events.length}
                              onChange={() => {
                                const allInGroupSelected = g.events.every(e => selected.has(e.id));
                                setSelected(prev => {
                                  const next = new Set(prev);
                                  if (allInGroupSelected) g.events.forEach(e => next.delete(e.id));
                                  else g.events.forEach(e => next.add(e.id));
                                  return next;
                                });
                              }}
                              aria-label={`Select all ${g.action} rows`}
                            />
                          )}
                        </th>
                        <th className="px-3 py-1.5 text-left">Date</th>
                        <th className="px-3 py-1.5 text-left">Counterparty</th>
                        <th className="px-3 py-1.5 text-left">QB vendor</th>
                        <th className="px-3 py-1.5 text-right">Amount</th>
                        <th className="px-3 py-1.5 text-left">Target</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.events.map(e => {
                        const vendor = e.counterpartyQbVendorListId ? vendorById.get(e.counterpartyQbVendorListId) : null;
                        const expense = e.qbExpenseAccountListId ? accountById.get(e.qbExpenseAccountListId) : null;
                        const invs = e.matchedInvoiceIds.map(id => invoiceById.get(id)).filter(Boolean);
                        const provStrong = e.matchProvenance === 'exact-txn' || e.matchProvenance === 'exact-ref';
                        const canSelect = groupPushable && provStrong;
                        return (
                          <tr key={e.id} className={`border-t border-gray-100 ${groupPushable && selected.has(e.id) ? 'bg-indigo-50/50' : ''} ${groupPushable && !provStrong ? 'opacity-60' : ''}`}>
                            <td className="px-3 py-1.5">
                              {canSelect ? (
                                <input
                                  type="checkbox"
                                  checked={selected.has(e.id)}
                                  onChange={() => toggleSelected(e.id)}
                                  aria-label={`Select event ${e.id}`}
                                />
                              ) : groupPushable ? (
                                <input
                                  type="checkbox"
                                  disabled
                                  title={`match_provenance='${e.matchProvenance ?? 'null'}' — invoice link too weak to auto-push; verify manually`}
                                />
                              ) : (
                                <input type="checkbox" disabled title="Coming in G7.5 — pay_existing_bill only for now" />
                              )}
                            </td>
                            <td className="px-3 py-1.5 font-mono">{e.txnDate}</td>
                            <td className="px-3 py-1.5">{e.counterpartyRaw}</td>
                            <td className="px-3 py-1.5">
                              {vendor
                                ? <span className="font-mono text-[11px] px-1.5 py-0.5 bg-indigo-50 text-indigo-800 rounded">{vendor.name}</span>
                                : <span className="text-red-500">— unmapped —</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{money(e.amount)}</td>
                            <td className="px-3 py-1.5">
                              {g.action === 'pay_existing_bill' && (
                                e.resolvedBillTxnId
                                  ? <span className="font-mono text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded" title="QB Bill TxnID we'll pay against">{e.resolvedBillTxnId.slice(0, 12)}…</span>
                                  : <span className="text-red-500">— no TxnID —</span>
                              )}
                              {g.action === 'create_bill_then_pay' && (
                                <>
                                  <span className="text-[11px] text-gray-500">create new bill</span>
                                  {invs.length > 0 && (
                                    <span className="ml-1">{invs.map(i => (
                                      <span key={i!.id} className="inline-block mr-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-mono">{i!.invoiceNumber}</span>
                                    ))}</span>
                                  )}
                                </>
                              )}
                              {/* Invoice link chip + provenance badge — visible for all pushable actions */}
                              {groupPushable && invs.length > 0 && (
                                <span className="ml-2 inline-flex items-center gap-1">
                                  {invs.map(i => (
                                    <span key={i!.id} className="inline-block px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px] font-mono" title={`Our invoice → will be marked paid`}>
                                      {i!.invoiceNumber}
                                    </span>
                                  ))}
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                      e.matchProvenance === 'exact-txn' ? 'bg-emerald-100 text-emerald-800' :
                                      e.matchProvenance === 'exact-ref' ? 'bg-teal-100 text-teal-800' :
                                      e.matchProvenance === 'fuzzy'     ? 'bg-amber-100 text-amber-800' :
                                                                          'bg-gray-100 text-gray-600'
                                    }`}
                                    title={
                                      e.matchProvenance === 'exact-txn' ? 'exact-txn: invoice qb_bill_txn_id matches — deterministic link' :
                                      e.matchProvenance === 'exact-ref' ? 'exact-ref: memo names this invoice by number' :
                                      e.matchProvenance === 'fuzzy'     ? 'fuzzy: matched by vendor+amount only — verify before pushing' :
                                                                          'no invoice link'
                                    }
                                  >
                                    {e.matchProvenance === 'exact-txn' ? '🔒 exact-txn' :
                                     e.matchProvenance === 'exact-ref' ? '✓ exact-ref' :
                                     e.matchProvenance === 'fuzzy'     ? '~ fuzzy' :
                                                                          '— empty'}
                                  </span>
                                </span>
                              )}
                              {g.action === 'check' && expense && (
                                <span className="font-mono text-[11px] text-gray-600">{expense.fullName}</span>
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

          {/* Auto-closed by QB (already_done — reconciler saw bill+payment already in QB) */}
          {parts.autoClosed.length > 0 && (
            <div className="border border-green-200 rounded-lg overflow-hidden bg-green-50/40">
              <button onClick={() => toggle('autoClosed')} className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-green-50">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-700" />
                  <span className="font-medium text-green-900">Already done in QB (auto-closed)</span>
                  <span className="text-xs text-green-800">
                    · {parts.autoClosed.length} event{parts.autoClosed.length === 1 ? '' : 's'} · {money(autoClosedTotal)}
                  </span>
                </div>
                <span className="text-xs text-green-700">{expanded.autoClosed ? '▼' : '▶'}</span>
              </button>
              {expanded.autoClosed && (
                <div className="px-4 pb-2">
                  <p className="text-xs text-green-800 italic mb-2">
                    QB already has both a bill and a matching payment for these — no push needed.
                  </p>
                  <table className="w-full text-xs">
                    <thead className="text-gray-500 border-b border-green-200">
                      <tr>
                        <th className="px-2 py-1 text-left">Date</th>
                        <th className="px-2 py-1 text-left">Counterparty</th>
                        <th className="px-2 py-1 text-right">Amount</th>
                        <th className="px-2 py-1 text-left">QB Bill</th>
                        <th className="px-2 py-1 text-left">QB Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parts.autoClosed.map(e => (
                        <tr key={e.id} className="border-t border-green-100/50">
                          <td className="px-2 py-1 font-mono">{e.txnDate}</td>
                          <td className="px-2 py-1">{e.counterpartyRaw}</td>
                          <td className="px-2 py-1 text-right font-mono">{money(e.amount)}</td>
                          <td className="px-2 py-1 font-mono text-[10px]">{e.resolvedBillTxnId ? `${e.resolvedBillTxnId.slice(0,12)}…` : '—'}</td>
                          <td className="px-2 py-1 font-mono text-[10px]">{e.resolvedPaymentTxnId ? `${e.resolvedPaymentTxnId.slice(0,12)}…` : <span className="text-gray-400">(inferred via IsPaid)</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Pre-our-system — QB handled manually before we existed */}
          {parts.preOurSystem.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50/50">
              <button onClick={() => toggle('preOurSystem')} className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-100 text-left text-sm">
                <div className="text-gray-600">
                  <span className="font-medium">Pre-our-system (handled directly in QB):</span>{' '}
                  <span className="text-xs">
                    {parts.preOurSystem.length} event{parts.preOurSystem.length === 1 ? '' : 's'} · {money(parts.preOurSystem.reduce((n, e) => n + e.amount, 0))}
                  </span>
                </div>
                <span className="text-xs text-gray-400">{expanded.preOurSystem ? '▼' : '▶'}</span>
              </button>
              {expanded.preOurSystem && (
                <div className="px-4 py-2">
                  <p className="text-xs text-gray-500 italic mb-1">
                    These predate our confidence window — accountant already reconciled them manually in QB. Never pushed.
                  </p>
                  <ul className="text-xs text-gray-600 space-y-0.5">
                    {parts.preOurSystem.map(e => (
                      <li key={e.id} className="flex justify-between">
                        <span>{e.txnDate} · {e.counterpartyRaw} · <span className="text-gray-400">{e.memo}</span></span>
                        <span className="font-mono">{money(e.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Ignored */}
          {parts.ignored.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => toggle('ignored')} className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 text-left text-sm">
                <div className="text-gray-600">
                  <span className="font-medium">Ignored:</span>{' '}
                  <span className="text-xs">
                    {(() => {
                      const grp = groupByCounterparty(parts.ignored, e => ({
                        source: e.source, counterparty: e.counterpartyRaw, amount: e.amount,
                      }));
                      return grp.map(g => `${g.counterparty} × ${g.items.length}`).join(', ');
                    })()}
                  </span>
                </div>
                <span className="text-xs text-gray-400">{expanded.ignored ? '▼' : '▶'}</span>
              </button>
              {expanded.ignored && (
                <ul className="px-4 py-2 text-xs text-gray-600 space-y-0.5">
                  {parts.ignored.map(e => (
                    <li key={e.id} className="flex justify-between">
                      <span>{e.txnDate} · {e.counterpartyRaw}</span>
                      <span className="font-mono">{money(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Previously pushed (by us — distinct from auto-closed) */}
          {parts.postedByPush.length > 0 && (
            <div>
              {!expanded.postedByPush ? (
                <button onClick={() => toggle('postedByPush')} className="text-xs text-gray-500 hover:text-indigo-600 hover:underline">
                  Show {parts.postedByPush.length} previously pushed by us (idempotency) →
                </button>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-gray-50 flex items-center justify-between text-sm">
                    <span className="text-gray-600 font-medium">Previously pushed · {parts.postedByPush.length}</span>
                    <button onClick={() => toggle('postedByPush')} className="text-xs text-gray-500 hover:underline">hide</button>
                  </div>
                  <ul className="px-4 py-2 text-xs text-gray-600 space-y-0.5">
                    {parts.postedByPush.map(e => (
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
        <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {selected.size > 0
              ? <>Selected: <strong className="text-gray-700">{selected.size}</strong> event{selected.size === 1 ? '' : 's'} · <span className="font-mono">{money(selectedTotal)}</span></>
              : pushableEvents.length > 0
                ? 'Select rows above to push'
                : ''}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              {selected.size === 0 ? 'Nothing selected' : `Push ${selected.size} selected to QB`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
