// QbPushStatusPane — G7a live read-after-write verifier.
//
// Renders a small pane above the QB Automation inbox showing the status of
// pushes fired this session. For each push:
//   pay_bill job:  pending → in_flight → done/failed
//   verify job:    pending → in_flight → done/failed  (bill_query, chained via depends_on)
//   verify state:  ok / silent-drop / mismatch / awaiting
//
// Polls every 10s while any push has non-terminal state. Records live in
// component state — ephemeral by design; the QB Automation buckets are the
// source of truth after the fact.
//
// INVARIANTS #36 — verify via mirror after every push. This pane surfaces
// that signal live so the accountant sees within one QBWC drain cycle
// (up to 15 min) whether the payment landed where expected.

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CheckCircle, AlertTriangle, Clock, X, Copy } from 'lucide-react';

export interface PushRecord {
  eventId: number;
  payJobId: number;
  verifyJobId: number | null;
  billTxnId: string;
  expectedAmount: number;
  expectedVendor: string;
  pushedAt: string;                 // ISO
  /** Push shape — determines verification path. 'pay_bill' + 'create' both
   *  read qb_mirror is_settled after drain; 'check' has no bill so its
   *  terminal state is just the check_add job succeeding. */
  kind?: 'pay_bill' | 'create' | 'check';
}

type JobStatus = 'pending' | 'in_flight' | 'done' | 'failed' | 'cancelled';

interface JobRow { id: number; status: JobStatus; error_msg: string | null }
interface MirrorRow { entity_ref: string; is_settled: boolean | null; data: { open_amount?: number } | null }
interface EventRow { id: number; status: string; posted_qb_refs: Record<string, unknown> | null; resolved_bill_txn_id: string | null }

interface LiveState {
  payStatus: JobStatus | 'unknown';
  payError: string | null;
  verifyStatus: JobStatus | 'unknown' | 'not-enqueued';
  verifyError: string | null;
  billPmtTxnId: string | null;       // read from qb_ingest_events.posted_qb_refs.bill_pmt
  mirrorSettled: boolean | null;     // read from qb_mirror.is_settled
  overall: 'awaiting-drain' | 'draining' | 'verifying' | 'verified-ok' | 'silent-drop' | 'pay-failed' | 'verify-failed';
}

function classify(pay: JobRow | null, verify: JobRow | null, event: EventRow | null, mirror: MirrorRow | null, kind: PushRecord['kind'] = 'pay_bill'): LiveState {
  const payStatus = pay?.status ?? 'unknown';
  const verifyStatus = verify == null ? 'not-enqueued' : verify.status;
  const billPmtTxnId = (event?.posted_qb_refs as { bill_pmt?: string } | null)?.bill_pmt ?? null;
  const mirrorSettled = mirror?.is_settled ?? null;

  let overall: LiveState['overall'];
  if (payStatus === 'failed') overall = 'pay-failed';
  else if (payStatus === 'pending') overall = 'awaiting-drain';
  else if (payStatus === 'in_flight') overall = 'draining';
  else if (payStatus === 'done') {
    if (kind === 'check') {
      // Check pushes: no bill mirror, no verify chain. check_add drain success
      // IS the terminal state. Accountant eyeballs QB for the actual check.
      overall = 'verified-ok';
    } else if (verifyStatus === 'failed') overall = 'verify-failed';
    else if (verifyStatus === 'pending' || verifyStatus === 'in_flight') overall = 'verifying';
    else if (verifyStatus === 'done') {
      // Both jobs done. Mirror should show is_settled=true AND event should have bill_pmt TxnID.
      if (billPmtTxnId != null && mirrorSettled === true) overall = 'verified-ok';
      else overall = 'silent-drop';
    } else overall = 'verifying';       // unknown → assume verifying
  } else overall = 'awaiting-drain';

  return {
    payStatus, payError: pay?.error_msg ?? null,
    verifyStatus, verifyError: verify?.error_msg ?? null,
    billPmtTxnId, mirrorSettled, overall,
  };
}

interface Props {
  supabase: SupabaseClient;
  records: PushRecord[];
  onDismiss: (eventId: number) => void;
  pollIntervalMs?: number;
}

export default function QbPushStatusPane({ supabase, records, onDismiss, pollIntervalMs = 10_000 }: Props) {
  const [liveByEventId, setLiveByEventId] = useState<Map<number, LiveState>>(new Map());
  const [voidFor, setVoidFor] = useState<PushRecord | null>(null);

  const poll = useCallback(async () => {
    if (records.length === 0) return;
    const jobIds = records.flatMap(r => [r.payJobId, ...(r.verifyJobId != null ? [r.verifyJobId] : [])]);
    const eventIds = records.map(r => r.eventId);
    // For chained-create events (G7b Phase 3), rec.billTxnId is empty at push
    // time — TxnID becomes known only after bill_add drains and gets persisted
    // on qb_ingest_events.resolved_bill_txn_id. We do a first mirror pass for
    // known-billTxnId records, then a second pass for chained records using
    // the event's resolved_bill_txn_id.
    const billTxnIds = Array.from(new Set(records.map(r => r.billTxnId).filter(Boolean)));

    const [jobsRes, eventsRes, mirrorRes] = await Promise.all([
      supabase.from('qb_sync_jobs').select('id, status, error_msg').in('id', jobIds),
      supabase.from('qb_ingest_events').select('id, status, posted_qb_refs, resolved_bill_txn_id').in('id', eventIds),
      supabase.from('qb_mirror').select('entity_ref, is_settled, data').eq('entity_kind', 'bill').in('entity_ref', billTxnIds),
    ]);
    const jobById = new Map(((jobsRes.data ?? []) as JobRow[]).map(r => [r.id, r]));
    const eventById = new Map(((eventsRes.data ?? []) as EventRow[]).map(r => [r.id, r]));
    const mirrorByTxn = new Map(((mirrorRes.data ?? []) as MirrorRow[]).map(r => [r.entity_ref, r]));

    // Second mirror pass: fetch mirror rows for chained-create events whose
    // rec.billTxnId was empty at push time but now have resolved_bill_txn_id
    // set on the event (post bill_add drain).
    const backfillTxnIds = Array.from(new Set(
      records
        .filter(r => !r.billTxnId)
        .map(r => (eventById.get(r.eventId)?.resolved_bill_txn_id ?? null))
        .filter((v): v is string => !!v && !mirrorByTxn.has(v)),
    ));
    if (backfillTxnIds.length > 0) {
      const { data: extraMirror } = await supabase
        .from('qb_mirror').select('entity_ref, is_settled, data')
        .eq('entity_kind', 'bill').in('entity_ref', backfillTxnIds);
      for (const m of ((extraMirror ?? []) as MirrorRow[])) mirrorByTxn.set(m.entity_ref, m);
    }

    const next = new Map<number, LiveState>();
    for (const rec of records) {
      const pay = jobById.get(rec.payJobId) ?? null;
      const verify = rec.verifyJobId != null ? (jobById.get(rec.verifyJobId) ?? null) : null;
      const event = eventById.get(rec.eventId) ?? null;
      const lookupKey = rec.billTxnId || event?.resolved_bill_txn_id || '';
      const mirror = lookupKey ? (mirrorByTxn.get(lookupKey) ?? null) : null;
      next.set(rec.eventId, classify(pay, verify, event, mirror, rec.kind));
    }
    setLiveByEventId(next);
  }, [records, supabase]);

  useEffect(() => {
    if (records.length === 0) return;
    void poll();
    const anyNonTerminal = Array.from(liveByEventId.values()).some(s =>
      s.overall === 'awaiting-drain' || s.overall === 'draining' || s.overall === 'verifying'
    );
    // Keep polling if we haven't seen state yet (fresh push) or anything is in flight.
    if (liveByEventId.size < records.length || anyNonTerminal) {
      const t = setInterval(() => void poll(), pollIntervalMs);
      return () => clearInterval(t);
    }
  }, [records, liveByEventId, poll, pollIntervalMs]);

  if (records.length === 0) return null;

  return (
    <div className="mb-4 border border-indigo-200 rounded-lg overflow-hidden bg-indigo-50/30">
      <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-200 text-sm font-semibold text-indigo-900">
        Push status — this session ({records.length})
      </div>
      <ul className="divide-y divide-indigo-100">
        {records.map(rec => {
          const live = liveByEventId.get(rec.eventId);
          const overall = live?.overall ?? 'awaiting-drain';
          return (
            <li key={rec.eventId} className="px-4 py-2 text-sm flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusBadge overall={overall} />
                  <span className="font-mono text-xs text-gray-500">event {rec.eventId}</span>
                  <span className="text-gray-800 font-medium">{rec.expectedVendor}</span>
                  <span className="font-mono text-gray-600">${rec.expectedAmount.toFixed(2)}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
                  <span>pay job <span className="font-mono">{rec.payJobId}</span>: {live?.payStatus ?? '…'}</span>
                  {rec.verifyJobId != null && (
                    <span>verify <span className="font-mono">{rec.verifyJobId}</span>: {live?.verifyStatus ?? '…'}</span>
                  )}
                  {live?.billPmtTxnId && (
                    <span className="text-green-700">BillPmt <span className="font-mono">{live.billPmtTxnId.slice(0, 12)}…</span></span>
                  )}
                </div>
                {(live?.payError || live?.verifyError) && (
                  <div className="text-xs text-red-700 mt-0.5">
                    {live?.payError && <div>pay err: {live.payError}</div>}
                    {live?.verifyError && <div>verify err: {live.verifyError}</div>}
                  </div>
                )}
                {overall === 'silent-drop' && (
                  <div className="text-xs text-amber-800 mt-0.5">
                    Verify job done but mirror shows bill not settled (or missing BillPmt ref). Silent-drop suspected — inspect QB manually.
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {(overall === 'verified-ok' || overall === 'silent-drop' || overall === 'pay-failed' || overall === 'verify-failed') && (
                  <button
                    onClick={() => setVoidFor(rec)}
                    className="text-xs text-red-700 hover:text-red-900 hover:underline"
                    title="Show void SQL"
                  >
                    void…
                  </button>
                )}
                <button
                  onClick={() => onDismiss(rec.eventId)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {voidFor && <VoidModal record={voidFor} live={liveByEventId.get(voidFor.eventId) ?? null} onClose={() => setVoidFor(null)} />}
    </div>
  );
}

function StatusBadge({ overall }: { overall: LiveState['overall'] }) {
  const map: Record<LiveState['overall'], { label: string; cls: string; Icon: typeof Clock }> = {
    'awaiting-drain': { label: 'pending',      cls: 'bg-gray-100 text-gray-700 border-gray-200',   Icon: Clock },
    'draining':       { label: 'draining',     cls: 'bg-blue-50 text-blue-800 border-blue-200',    Icon: Clock },
    'verifying':      { label: 'verifying',    cls: 'bg-blue-50 text-blue-800 border-blue-200',    Icon: Clock },
    'verified-ok':    { label: 'verified',     cls: 'bg-green-50 text-green-800 border-green-200', Icon: CheckCircle },
    'silent-drop':    { label: 'silent-drop',  cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertTriangle },
    'pay-failed':     { label: 'pay failed',   cls: 'bg-red-50 text-red-800 border-red-200',       Icon: AlertTriangle },
    'verify-failed':  { label: 'verify failed',cls: 'bg-red-50 text-red-800 border-red-200',       Icon: AlertTriangle },
  };
  const { label, cls, Icon } = map[overall];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 border rounded ${cls}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
}

function VoidModal({ record, live, onClose }: { record: PushRecord; live: LiveState | null; onClose: () => void }) {
  const billPmtTxnId = live?.billPmtTxnId ?? '<check qb_sync_jobs.qbxml_response for TxnID>';
  const sql = `-- Void a mistaken push (event ${record.eventId})
--
-- 1. In QB Desktop: find BillPmt with TxnID '${billPmtTxnId}'
--    (Vendors → Vendor Center → ${record.expectedVendor} → find the BillPmt)
--    Right-click → VOID (keeps audit trail — DO NOT DELETE).
--
-- 2. Then run this SQL to reopen the event for re-push:
UPDATE qb_ingest_events
SET status = 'ready',
    posted_qb_refs = COALESCE(posted_qb_refs, '{}'::jsonb) - 'bill_pmt' - 'posted_source'
WHERE id = ${record.eventId};
--
-- 3. Enqueue a bill_query to refresh qb_mirror with the voided bill's
--    IsPaid=false state:
INSERT INTO qb_sync_jobs (kind, payload, status)
VALUES ('bill_query', jsonb_build_object('txnIds', jsonb_build_array('${record.billTxnId}')), 'pending');`;

  const copy = () => { void navigator.clipboard.writeText(sql); };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-800">Void push — event {record.eventId}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 flex-1 overflow-auto">
          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 whitespace-pre-wrap font-mono text-gray-800">{sql}</pre>
        </div>
        <div className="p-3 border-t border-gray-200 flex items-center justify-end gap-2">
          <button onClick={copy} className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1.5">
            <Copy className="w-3.5 h-3.5" /> Copy
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-900">Close</button>
        </div>
      </div>
    </div>
  );
}
