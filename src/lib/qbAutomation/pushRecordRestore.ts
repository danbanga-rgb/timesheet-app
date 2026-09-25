// Rebuild live push-status records from in-flight qb_sync_jobs after a page
// reload. Pure: callers fetch the rows.
//
// Pay jobs identify their wire in two ways:
//   - payload.sourceIngestEventId   (Intuit pay, checks, G7b chained pay)
//   - payload.sourceConveraTxnId    (Convera C-1 pay) → event via
//     qb_ingest_events.raw_data.convera_transaction_id
// 2026-09-25 pilot: only the first was handled, so Convera pushes vanished
// from the panel on reload. The verify bill_query (depends_on = [payJobId])
// is re-attached too.

export interface RestoreJobRow {
  id: number;
  kind: string;
  created_at: string;
  payload: Record<string, unknown> | null;
}

export interface RestoreEventRow {
  id: number;
  amount: number | string;
  resolved_bill_txn_id: string | null;
}

export interface RestoredPushRecord {
  eventId: number;
  payJobId: number;
  verifyJobId: number | null;
  billTxnId: string;
  expectedAmount: number;
  expectedVendor: string;
  pushedAt: string;
  kind: 'pay_bill' | 'check';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Event id for a pay job, or null when it can't be tied to a wire. */
export function eventIdForJob(job: RestoreJobRow, eventIdByConveraTxnId: ReadonlyMap<number, number>): number | null {
  const direct = num(job.payload?.sourceIngestEventId);
  if (direct != null) return direct;
  const ctx = num(job.payload?.sourceConveraTxnId);
  return ctx != null ? (eventIdByConveraTxnId.get(ctx) ?? null) : null;
}

export function buildRestoredPushRecords(
  jobs: readonly RestoreJobRow[],
  eventById: ReadonlyMap<number, RestoreEventRow>,
  eventIdByConveraTxnId: ReadonlyMap<number, number>,
  verifyJobIdByPayJobId: ReadonlyMap<number, number>,
  displayNameFor: (eventId: number, job: RestoreJobRow) => string,
): RestoredPushRecord[] {
  const out: RestoredPushRecord[] = [];
  for (const j of jobs) {
    const eventId = eventIdForJob(j, eventIdByConveraTxnId);
    if (eventId == null) continue;
    const event = eventById.get(eventId);
    if (!event) continue;
    const apps = Array.isArray(j.payload?.applications) ? (j.payload!.applications as Array<{ billTxnId?: string }>) : [];
    out.push({
      eventId,
      payJobId: j.id,
      verifyJobId: verifyJobIdByPayJobId.get(j.id) ?? null,
      billTxnId: event.resolved_bill_txn_id ?? apps[0]?.billTxnId ?? '',
      expectedAmount: Number(event.amount),
      expectedVendor: displayNameFor(eventId, j),
      pushedAt: j.created_at,
      kind: j.kind === 'check_add' ? 'check' : 'pay_bill',
    });
  }
  return out;
}
