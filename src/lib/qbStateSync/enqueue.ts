// qbStateSync/enqueue — shared enqueuers for bill_query / vendor_query /
// account_query. Each function INSERTs a row into qb_sync_jobs; QBWC drains
// on its poll cycle; qb-web-connector edge fn persists results back into
// mirror tables.
//
// Dedup: before enqueueing, check for pending/in-flight jobs of the same
// (kind, payload-key) and skip. Prevents accidental duplicate queries when
// the sync button is spam-clicked or two syncs race.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EnqueueBillQueryOpts, EnqueueResult } from './types';

type SB = SupabaseClient;

const INFLIGHT_STATUSES = ['pending', 'in_flight'];

/**
 * Enqueue one bill_query job. Iterator mode is per-vendor; targeted mode
 * carries specific refNumbers/txnIds.
 *
 * Dedup: iterator jobs are deduped by (kind='bill_query', payload.entityVendorName).
 * Targeted jobs are NOT deduped — the caller controls exact ids.
 */
export async function enqueueBillQuery(
  supabase: SB,
  opts: EnqueueBillQueryOpts,
): Promise<EnqueueResult> {
  if (opts.mode === 'iterator') {
    // Dedup on vendor name for iterator mode.
    const { data: inflight } = await supabase
      .from('qb_sync_jobs')
      .select('id, payload')
      .eq('kind', 'bill_query')
      .in('status', INFLIGHT_STATUSES);
    const alreadyRunning = (inflight ?? []).some((j: { payload: Record<string, unknown> }) =>
      j.payload?.entityVendorName === opts.vendorName,
    );
    if (alreadyRunning) {
      return { jobIds: [], skippedInFlight: [opts.vendorName] };
    }
    const payload: Record<string, unknown> = { entityVendorName: opts.vendorName };
    if (opts.fromTxnDate) payload.fromTxnDate = opts.fromTxnDate;
    if (opts.toTxnDate) payload.toTxnDate = opts.toTxnDate;
    if (opts.maxReturned) payload.maxReturned = opts.maxReturned;
    if (opts.auditTag) payload.__audit_tag = opts.auditTag;
    const { data, error } = await supabase
      .from('qb_sync_jobs')
      .insert({ kind: 'bill_query', payload, status: 'pending' })
      .select('id')
      .single();
    if (error) throw error;
    return { jobIds: [data.id as number], skippedInFlight: [] };
  }

  // targeted mode — no dedup; caller controls ids
  const payload: Record<string, unknown> = {};
  if (opts.refNumbers) payload.refNumbers = opts.refNumbers;
  if (opts.txnIds) payload.txnIds = opts.txnIds;
  if (opts.auditTag) payload.__audit_tag = opts.auditTag;
  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert({ kind: 'bill_query', payload, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;
  return { jobIds: [data.id as number], skippedInFlight: [] };
}

/**
 * Enqueue a vendor_query job. Dedup: at most one pending/in-flight at a time.
 */
export async function enqueueVendorQuery(supabase: SB, auditTag?: string): Promise<EnqueueResult> {
  const { data: inflight } = await supabase
    .from('qb_sync_jobs')
    .select('id')
    .eq('kind', 'vendor_query')
    .in('status', INFLIGHT_STATUSES);
  if ((inflight ?? []).length > 0) {
    return { jobIds: [], skippedInFlight: ['vendor_query'] };
  }
  const payload: Record<string, unknown> = auditTag ? { __audit_tag: auditTag } : {};
  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert({ kind: 'vendor_query', payload, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;
  return { jobIds: [data.id as number], skippedInFlight: [] };
}

/**
 * Enqueue an account_query job. Dedup: at most one pending/in-flight at a time.
 */
export async function enqueueAccountQuery(supabase: SB, auditTag?: string): Promise<EnqueueResult> {
  const { data: inflight } = await supabase
    .from('qb_sync_jobs')
    .select('id')
    .eq('kind', 'account_query')
    .in('status', INFLIGHT_STATUSES);
  if ((inflight ?? []).length > 0) {
    return { jobIds: [], skippedInFlight: ['account_query'] };
  }
  const payload: Record<string, unknown> = auditTag ? { __audit_tag: auditTag } : {};
  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert({ kind: 'account_query', payload, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;
  return { jobIds: [data.id as number], skippedInFlight: [] };
}

/**
 * Enqueue one bill_pmt_query job (iterator-mode) for a vendor over a date range.
 * Builds the qbXML request inline (no shared builder yet — the qb_sync_jobs
 * job kind takes `rawQbxmlRequest` per its current contract).
 *
 * IncludeLineItems=true gets AppliedToTxnRet[] blocks in the response —
 * essential for the reconciler to know which bills each payment settled.
 *
 * Dedup on vendorName per the same pattern as enqueueBillQuery iterator mode.
 */
export async function enqueueBillPmtQuery(
  supabase: SB,
  opts: {
    vendorName: string;
    fromTxnDate?: string;
    toTxnDate?: string;
    includeLineItems?: boolean;  // default true — needed for reconciliation
    auditTag?: string;
  },
): Promise<EnqueueResult> {
  const { data: inflight } = await supabase
    .from('qb_sync_jobs')
    .select('id, payload')
    .eq('kind', 'bill_pmt_query')
    .in('status', INFLIGHT_STATUSES);
  const alreadyRunning = (inflight ?? []).some((j: { payload: Record<string, unknown> }) => {
    const raw = String(j.payload?.rawQbxmlRequest ?? '');
    return raw.includes(`<FullName>${opts.vendorName}</FullName>`);
  });
  if (alreadyRunning) {
    return { jobIds: [], skippedInFlight: [opts.vendorName] };
  }

  const includeLine = opts.includeLineItems !== false;
  // qbXML BillPaymentCheckQueryRq XSD element order (SDK 13):
  //   TxnID* | RefNumber* | (TxnDateRangeFilter | ModifiedDateRangeFilter)?
  //   → EntityFilter → AccountFilter → RefNumberFilter → IncludeLineItems?
  //   → IncludeRetElement*
  // We emit iterator style: EntityFilter + optional TxnDateRangeFilter.
  const parts: string[] = ['<BillPaymentCheckQueryRq>'];
  if (opts.fromTxnDate || opts.toTxnDate) {
    parts.push('<TxnDateRangeFilter>');
    if (opts.fromTxnDate) parts.push(`<FromTxnDate>${opts.fromTxnDate}</FromTxnDate>`);
    if (opts.toTxnDate)   parts.push(`<ToTxnDate>${opts.toTxnDate}</ToTxnDate>`);
    parts.push('</TxnDateRangeFilter>');
  }
  parts.push('<EntityFilter>');
  parts.push(`<FullName>${opts.vendorName}</FullName>`);
  parts.push('</EntityFilter>');
  if (includeLine) parts.push('<IncludeLineItems>true</IncludeLineItems>');
  parts.push('</BillPaymentCheckQueryRq>');
  const rawQbxmlRequest = parts.join('');

  const payload: Record<string, unknown> = { rawQbxmlRequest };
  if (opts.auditTag) payload.__audit_tag = opts.auditTag;

  const { data, error } = await supabase
    .from('qb_sync_jobs')
    .insert({ kind: 'bill_pmt_query', payload, status: 'pending' })
    .select('id')
    .single();
  if (error) throw error;
  return { jobIds: [data.id as number], skippedInFlight: [] };
}

/**
 * Compute a per-vendor delta cursor from qb_mirror. Returns the ISO date
 * `MAX(bill.txn_date) - 1 day` (one-day overlap for safety against clock skew
 * or in-flight bills), or null if no bills yet exist for the vendor.
 *
 * G3 fallback: cursors on TxnDate rather than TimeModified because we haven't
 * yet verified whether QB bumps TimeModified when a bill's IsPaid flips.
 * TxnDate cursor is safe (only cost is re-querying already-known bills within
 * the overlap window) — swap for ModifiedDateRangeFilter later once probed.
 */
export async function getBillQueryCursor(
  supabase: SB,
  vendorListId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('qb_mirror')
    .select('data')
    .eq('entity_kind', 'bill')
    .eq('vendor_list_id', vendorListId)
    .not('data->>txn_date', 'is', null)
    .order('data->>txn_date', { ascending: false })
    .limit(1);
  const txnDate = (data && data[0]?.data as Record<string, unknown> | null)?.txn_date as string | undefined;
  if (!txnDate) return null;
  // Roll back one day for overlap safety.
  const d = new Date(txnDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Bulk-enqueue bill_query iterator jobs for a set of vendors, with dedup
 * per vendor. Convenience wrapper for the "Sync QB state" button.
 *
 * `deltaFrom` controls the fromTxnDate cursor:
 *   - 'auto' (default): per-vendor cursor from qb_mirror (`MAX(txn_date) - 1d`)
 *                       — falls back to no filter if no prior bills for vendor.
 *   - 'off': no fromTxnDate filter (full history — bootstrap or reset).
 *   - <ISO date>: fixed date applied to all vendors.
 */
export async function enqueueBillQueryForVendors(
  supabase: SB,
  vendors: Array<{ name: string; listId: string }>,
  opts?: {
    deltaFrom?: 'auto' | 'off' | string;
    toTxnDate?: string;
    auditTag?: string;
  },
): Promise<EnqueueResult & { deltaCursorsUsed: Record<string, string | 'none'> }> {
  const jobIds: number[] = [];
  const skipped: string[] = [];
  const cursorsUsed: Record<string, string | 'none'> = {};
  const delta = opts?.deltaFrom ?? 'auto';

  for (const v of vendors) {
    let fromTxnDate: string | undefined;
    if (delta === 'off') {
      fromTxnDate = undefined;
    } else if (delta === 'auto') {
      const cursor = await getBillQueryCursor(supabase, v.listId);
      fromTxnDate = cursor ?? undefined;
    } else {
      fromTxnDate = delta;
    }
    cursorsUsed[v.name] = fromTxnDate ?? 'none';

    const r = await enqueueBillQuery(supabase, {
      mode: 'iterator',
      vendorName: v.name,
      ...(fromTxnDate ? { fromTxnDate } : {}),
      ...(opts?.toTxnDate ? { toTxnDate: opts.toTxnDate } : {}),
      ...(opts?.auditTag ? { auditTag: opts.auditTag } : {}),
    });
    jobIds.push(...r.jobIds);
    skipped.push(...r.skippedInFlight);
  }
  return { jobIds, skippedInFlight: skipped, deltaCursorsUsed: cursorsUsed };
}
