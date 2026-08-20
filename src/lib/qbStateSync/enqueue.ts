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
 * Bulk-enqueue bill_query iterator jobs for a set of vendors, with dedup
 * per vendor. Convenience wrapper for the "Sync QB state" button.
 */
export async function enqueueBillQueryForVendors(
  supabase: SB,
  vendorNames: string[],
  opts?: { fromTxnDate?: string; toTxnDate?: string; auditTag?: string },
): Promise<EnqueueResult> {
  const jobIds: number[] = [];
  const skipped: string[] = [];
  for (const name of vendorNames) {
    const r = await enqueueBillQuery(supabase, {
      mode: 'iterator',
      vendorName: name,
      ...(opts?.fromTxnDate ? { fromTxnDate: opts.fromTxnDate } : {}),
      ...(opts?.toTxnDate ? { toTxnDate: opts.toTxnDate } : {}),
      ...(opts?.auditTag ? { auditTag: opts.auditTag } : {}),
    });
    jobIds.push(...r.jobIds);
    skipped.push(...r.skippedInFlight);
  }
  return { jobIds, skippedInFlight: skipped };
}
