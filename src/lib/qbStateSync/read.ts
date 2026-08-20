// qbStateSync/read — read the local mirror of QuickBooks state.
//
// All queries pass .range(0, 4999) because PostgREST default cap is 1000
// and qb_vendors is already 1165 rows in prod (see [[feedback-no-hardcoded-cutoff]]).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { QbAccountRow, QbOpenBillRow, QbVendorRow } from './types';

type SB = SupabaseClient;

const MAX = 4999;

export async function getVendors(supabase: SB): Promise<QbVendorRow[]> {
  const { data, error } = await supabase
    .from('qb_vendors')
    .select('list_id, name, is_active')
    .order('name')
    .range(0, MAX);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    listId: (r.list_id as string) ?? '',
    name: (r.name as string) ?? '',
    isActive: Boolean(r.is_active),
  }));
}

export async function getAccounts(supabase: SB): Promise<QbAccountRow[]> {
  const { data, error } = await supabase
    .from('qb_accounts')
    .select('list_id, full_name, account_type, is_active')
    .order('full_name')
    .range(0, MAX);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    listId: (r.list_id as string) ?? '',
    fullName: (r.full_name as string) ?? '',
    accountType: (r.account_type as string) ?? '',
    isActive: Boolean(r.is_active),
  }));
}

/**
 * Fetch open-bills snapshot rows for a specific vendor. Includes paid rows too —
 * callers filter by is_paid depending on need (reconciliation cares about
 * both; UI "open bills only" filters is_paid=false).
 */
export async function getVendorBills(supabase: SB, vendorListId: string): Promise<QbOpenBillRow[]> {
  const { data, error } = await supabase
    .from('qb_open_bills_snapshot')
    .select('*')
    .eq('vendor_list_id', vendorListId)
    .order('txn_date', { ascending: false })
    .range(0, MAX);
  if (error) throw error;
  return (data ?? []).map(mapSnapshotRow);
}

/**
 * Fetch entire snapshot. Use for global freshness display; scope by
 * vendor otherwise.
 */
export async function getAllOpenBills(supabase: SB): Promise<QbOpenBillRow[]> {
  const { data, error } = await supabase
    .from('qb_open_bills_snapshot')
    .select('*')
    .range(0, MAX);
  if (error) throw error;
  return (data ?? []).map(mapSnapshotRow);
}

function mapSnapshotRow(r: Record<string, unknown>): QbOpenBillRow {
  return {
    vendorListId: (r.vendor_list_id as string) ?? '',
    vendorName: (r.vendor_name as string) ?? '',
    refNumber: (r.ref_number as string) ?? '',
    txnId: (r.txn_id as string) ?? '',
    txnDate: (r.txn_date as string | null) ?? null,
    dueDate: (r.due_date as string | null) ?? null,
    amount: Number(r.amount ?? 0),
    openAmount: Number(r.open_amount ?? 0),
    isPaid: Boolean(r.is_paid),
    queriedAt: (r.queried_at as string) ?? '',
  };
}
