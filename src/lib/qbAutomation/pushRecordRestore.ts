// Build live push-status records from in-flight qb_sync_jobs. Used right
// after a push AND after a page reload, so the panel, the popup and the
// pending chip all count the same thing: one record per pushed ITEM.
// Pure: callers fetch the rows.
//
// Item shapes (pilot 2026-09-25):
//   - pay a wire:           bill_pmt_add (+ verify bill_query)
//   - create + pay a wire:  bill_add → bill_pmt_add (depends_on) → verify
//   - check:                check_add
//   - invoice → bill:       bill_add (+ verify), no pay job depends on it
//
// Pay jobs identify their wire by payload.sourceIngestEventId or, for Convera
// C-1/C-2, payload.sourceConveraTxnId → event via
// qb_ingest_events.raw_data.convera_transaction_id.

export interface RestoreJobRow {
  id: number;
  kind: string;
  created_at: string;
  payload: Record<string, unknown> | null;
  depends_on?: Array<number | string> | null;
}

export interface RestoreEventRow {
  id: number;
  amount: number | string;
  resolved_bill_txn_id: string | null;
}

export interface RestoredPushRecord {
  eventId: number;                 // for invoice items: -invoiceId
  sourceKind?: 'event' | 'invoice';
  invoiceId?: number;
  createJobId?: number | null;     // bill_add that a pay job waits on
  payJobId: number;                // the item's main job (pay, check, or bill_add for invoice items)
  verifyJobId: number | null;
  billTxnId: string;
  expectedAmount: number;
  expectedVendor: string;
  pushedAt: string;
  kind: 'pay_bill' | 'check' | 'create' | 'invoice_create_bill';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Event id for a pay/check job, or null when it can't be tied to a wire. */
export function eventIdForJob(job: RestoreJobRow, eventIdByConveraTxnId: ReadonlyMap<number, number>): number | null {
  const direct = num(job.payload?.sourceIngestEventId);
  if (direct != null) return direct;
  const ctx = num(job.payload?.sourceConveraTxnId);
  return ctx != null ? (eventIdByConveraTxnId.get(ctx) ?? null) : null;
}

function deps(job: RestoreJobRow): number[] {
  return (job.depends_on ?? []).map(d => Number(d)).filter(n => Number.isFinite(n));
}

function billAddAmount(job: RestoreJobRow): number {
  const lines = Array.isArray(job.payload?.lines) ? (job.payload!.lines as Array<{ amount?: number | string }>) : [];
  return lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

export function buildRestoredPushRecords(
  jobs: readonly RestoreJobRow[],
  eventById: ReadonlyMap<number, RestoreEventRow>,
  eventIdByConveraTxnId: ReadonlyMap<number, number>,
  verifyJobIdByJobId: ReadonlyMap<number, number>,
  displayNameFor: (eventId: number, job: RestoreJobRow) => string,
): RestoredPushRecord[] {
  const out: RestoredPushRecord[] = [];
  const billAddIds = new Set(jobs.filter(j => j.kind === 'bill_add').map(j => j.id));
  const billAddUsedByPay = new Set<number>();

  for (const j of jobs) {
    if (j.kind !== 'bill_pmt_add' && j.kind !== 'check_add') continue;
    const eventId = eventIdForJob(j, eventIdByConveraTxnId);
    if (eventId == null) continue;
    const event = eventById.get(eventId);
    if (!event) continue;
    const createJobId = deps(j).find(d => billAddIds.has(d)) ?? null;
    if (createJobId != null) billAddUsedByPay.add(createJobId);
    const apps = Array.isArray(j.payload?.applications) ? (j.payload!.applications as Array<{ billTxnId?: string }>) : [];
    out.push({
      eventId,
      sourceKind: 'event',
      createJobId,
      payJobId: j.id,
      verifyJobId: verifyJobIdByJobId.get(j.id) ?? null,
      billTxnId: event.resolved_bill_txn_id ?? apps[0]?.billTxnId ?? '',
      expectedAmount: Number(event.amount),
      expectedVendor: displayNameFor(eventId, j),
      pushedAt: j.created_at,
      kind: j.kind === 'check_add' ? 'check' : 'pay_bill',
    });
  }

  for (const j of jobs) {
    if (j.kind !== 'bill_add' || billAddUsedByPay.has(j.id)) continue;
    const vendor = String(j.payload?.vendorName ?? '');
    const eventSource = num(j.payload?.sourceIngestEventId);
    if (eventSource != null) {
      // G7b: create a bill from a wire with no invoice (no pay chained in this batch).
      const event = eventById.get(eventSource);
      out.push({
        eventId: eventSource, sourceKind: 'event', createJobId: null, payJobId: j.id,
        verifyJobId: verifyJobIdByJobId.get(j.id) ?? null, billTxnId: event?.resolved_bill_txn_id ?? '',
        expectedAmount: event ? Number(event.amount) : billAddAmount(j),
        expectedVendor: vendor, pushedAt: j.created_at, kind: 'create',
      });
      continue;
    }
    const invIds = Array.isArray(j.payload?.sourceInvoiceIds) ? (j.payload!.sourceInvoiceIds as unknown[]).map(num).filter((n): n is number => n != null) : [];
    if (invIds.length === 0) continue;
    out.push({
      eventId: -invIds[0], sourceKind: 'invoice', invoiceId: invIds[0], createJobId: null, payJobId: j.id,
      verifyJobId: verifyJobIdByJobId.get(j.id) ?? null, billTxnId: '',
      expectedAmount: billAddAmount(j),
      expectedVendor: invIds.length > 1 ? `${vendor} (${invIds.length} invoices)` : vendor,
      pushedAt: j.created_at, kind: 'invoice_create_bill',
    });
  }
  return out;
}

/** Merge freshly rebuilt records into the session list: new jobs replace
 *  their entry, finished records from earlier pushes stay visible. */
export function mergePushRecords<T extends { payJobId: number }>(prev: readonly T[], next: readonly T[]): T[] {
  const nextIds = new Set(next.map(r => r.payJobId));
  return [...prev.filter(r => !nextIds.has(r.payJobId)), ...next];
}
