import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushRecord } from '../../components/QbPushStatusPane';

export interface CancelPushJobsInput {
  supabase: SupabaseClient;
  records: PushRecord[];
}

export interface CancelPushJobsResult {
  cancelledJobIds: number[];
  alreadyInFlightJobIds: number[];
  revertedEventIds: number[];
  cancelledPayJobIds: number[];
}

// Best-effort cancellation of pending qb_sync_jobs.
//
// Guardrail: the UPDATE is scoped to `status='pending'` so a job QBWC has
// already flipped to 'in_flight' (or completed) is left alone — that write
// will finish and the pane's polling loop will surface the actual outcome.
//
// For records whose PAY job was actually cancelled AND the source is an
// ingest event, we also revert `qb_ingest_events.status` back to 'ready'
// so the row re-appears in the Ready card (Q3 in V8-B item 4 open questions,
// 2026-09-23). Events that were already 'ready' or already 'posted' are
// skipped by the guard so re-push flows and completed pushes stay intact.
export async function cancelPushJobs({
  supabase,
  records,
}: CancelPushJobsInput): Promise<CancelPushJobsResult> {
  if (records.length === 0) {
    return { cancelledJobIds: [], alreadyInFlightJobIds: [], revertedEventIds: [], cancelledPayJobIds: [] };
  }

  const payJobIds = records.map(r => r.payJobId);
  const verifyJobIds = records
    .map(r => r.verifyJobId)
    .filter((v): v is number => v != null);
  const allJobIds = Array.from(new Set([...payJobIds, ...verifyJobIds]));

  const { data: updatedRows, error: updateErr } = await supabase
    .from('qb_sync_jobs')
    .update({ status: 'skipped' })
    .in('id', allJobIds)
    .eq('status', 'pending')
    .select('id');
  if (updateErr) throw updateErr;

  const cancelledJobIds = ((updatedRows ?? []) as Array<{ id: number }>).map(r => r.id);
  const cancelledSet = new Set(cancelledJobIds);
  const alreadyInFlightJobIds = allJobIds.filter(id => !cancelledSet.has(id));
  const cancelledPayJobIds = payJobIds.filter(id => cancelledSet.has(id));

  const eventIdsToRevert = records
    .filter(r => (r.sourceKind ?? 'event') === 'event' && cancelledSet.has(r.payJobId))
    .map(r => r.eventId);
  const uniqueEventIds = Array.from(new Set(eventIdsToRevert));

  let revertedEventIds: number[] = [];
  if (uniqueEventIds.length > 0) {
    const { data: revertedRows, error: revertErr } = await supabase
      .from('qb_ingest_events')
      .update({ status: 'ready' })
      .in('id', uniqueEventIds)
      .not('status', 'in', '(ready,posted)')
      .select('id');
    if (revertErr) throw revertErr;
    revertedEventIds = ((revertedRows ?? []) as Array<{ id: number }>).map(r => r.id);
  }

  return { cancelledJobIds, alreadyInFlightJobIds, revertedEventIds, cancelledPayJobIds };
}
