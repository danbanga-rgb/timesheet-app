// qbStateSync/read — read the unified qb_mirror.
//
// Slice G1.1: all queries now go through qb_mirror with entity_kind filter.
// Function signatures unchanged from Slice G1 — callers see no diff.
//
// All queries pass .range(0, 4999) because PostgREST default cap is 1000
// and qb_vendors is 1165+ rows in prod (see [[feedback-no-hardcoded-cutoff]]).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { QbAccountRow, QbOpenBillRow, QbVendorRow } from './types';

type SB = SupabaseClient;

const MAX = 4999;

export async function getVendors(supabase: SB): Promise<QbVendorRow[]> {
  const { data, error } = await supabase
    .from('qb_mirror')
    .select('entity_ref, is_active, data')
    .eq('entity_kind', 'vendor')
    .range(0, MAX);
  if (error) throw error;
  // Sort in JS — PostgREST doesn't reliably sort on JSONB->>'name' with anon key.
  return (data ?? [])
    .map((r: Record<string, unknown>) => ({
      listId: (r.entity_ref as string) ?? '',
      name: ((r.data as Record<string, unknown> | null)?.name as string) ?? '',
      isActive: Boolean(r.is_active),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAccounts(supabase: SB): Promise<QbAccountRow[]> {
  const { data, error } = await supabase
    .from('qb_mirror')
    .select('entity_ref, is_active, data')
    .eq('entity_kind', 'account')
    .range(0, MAX);
  if (error) throw error;
  return (data ?? [])
    .map((r: Record<string, unknown>) => ({
      listId: (r.entity_ref as string) ?? '',
      fullName: ((r.data as Record<string, unknown> | null)?.full_name as string) ?? '',
      accountType: ((r.data as Record<string, unknown> | null)?.account_type as string) ?? '',
      isActive: Boolean(r.is_active),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Fetch open-bills snapshot rows for a specific vendor. Includes paid rows too —
 * callers filter by isPaid depending on need (reconciliation needs both; UI
 * "open bills only" filters isPaid=false).
 */
export async function getVendorBills(supabase: SB, vendorListId: string): Promise<QbOpenBillRow[]> {
  const { data, error } = await supabase
    .from('qb_mirror')
    .select('*')
    .eq('entity_kind', 'bill')
    .eq('vendor_list_id', vendorListId)
    .range(0, MAX);
  if (error) throw error;
  return (data ?? [])
    .map(mapBillRow)
    .sort((a, b) => (b.txnDate ?? '').localeCompare(a.txnDate ?? ''));
}

/**
 * Fetch entire bills snapshot. Used for global freshness display.
 */
export async function getAllOpenBills(supabase: SB): Promise<QbOpenBillRow[]> {
  const { data, error } = await supabase
    .from('qb_mirror')
    .select('*')
    .eq('entity_kind', 'bill')
    .range(0, MAX);
  if (error) throw error;
  return (data ?? []).map(mapBillRow);
}

function mapBillRow(r: Record<string, unknown>): QbOpenBillRow {
  const d = (r.data as Record<string, unknown> | null) ?? {};
  return {
    vendorListId: (r.vendor_list_id as string) ?? '',
    vendorName: (d.vendor_name as string) ?? '',
    refNumber: (r.ref_number as string) ?? '',
    txnId: (r.entity_ref as string) ?? '',
    txnDate: (d.txn_date as string | null) ?? null,
    dueDate: (d.due_date as string | null) ?? null,
    amount: Number(r.amount ?? 0),
    openAmount: Number(d.open_amount ?? 0),
    isPaid: Boolean(r.is_settled),
    queriedAt: (r.queried_at as string) ?? '',
  };
}
