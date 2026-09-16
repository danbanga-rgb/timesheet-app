// mirrorDeviationCheck — consults qb_mirror bill_payment history for a vendor
// and flags when a proposed BillPmt's bank account diverges from the vendor's
// established convention. Prevents silent routing regressions like the 2026-08-31
// batch that landed on Western Union Holding while every prior payment for the
// same vendors was on 8220 Key Point Checking.
//
// Design:
//   • Sample: vendor's most-recent N (default 10) qb_mirror bill_payment rows,
//     ordered by queried_at desc so recent QB activity wins.
//   • Require ≥ MIN_SAMPLE rows to form a "convention"; below that we return
//     null (no signal — don't block).
//   • Mode must be ≥ DOMINANCE of the sample; below that we treat the vendor
//     as "mixed" and return null (accountant deliberately splits banks).
//   • If the proposed bank_list_id matches the mode, no deviation. Otherwise
//     return the historical bank details for the caller to surface.
//
// Called from every qbWrite consumer that enqueues bill_pmt intents.

import type { SupabaseClient } from '@supabase/supabase-js';

const MIN_SAMPLE = 3;
const DOMINANCE = 0.8;
const LOOKBACK = 10;

export interface MirrorBankDeviation {
  historicalBankListId: string;
  historicalBankFullName: string;
  sampleSize: number;
  modeCount: number;
}

interface BillPaymentMirrorRow {
  data: {
    bank_list_id?: string;
    bank_full_name?: string;
    txn_date?: string;
  } | null;
  queried_at?: string;
}

/** Returns non-null when the vendor has a clear historical bank in qb_mirror
 *  and the proposed bank diverges. Null means either no signal or aligned. */
export async function findMirrorBankDeviation(
  supabase: SupabaseClient,
  vendorListId: string,
  proposedBankListId: string,
): Promise<MirrorBankDeviation | null> {
  const { data } = await supabase
    .from('qb_mirror')
    .select('data, queried_at')
    .eq('entity_kind', 'bill_payment')
    .eq('vendor_list_id', vendorListId)
    .order('queried_at', { ascending: false })
    .limit(LOOKBACK);

  const rows = (data ?? []) as BillPaymentMirrorRow[];
  const banks: Array<{ listId: string; fullName: string }> = [];
  for (const r of rows) {
    const id = r.data?.bank_list_id;
    const name = r.data?.bank_full_name;
    if (id && name) banks.push({ listId: id, fullName: name });
  }
  if (banks.length < MIN_SAMPLE) return null;

  const counts = new Map<string, { count: number; fullName: string }>();
  for (const b of banks) {
    const cur = counts.get(b.listId);
    if (cur) cur.count++;
    else counts.set(b.listId, { count: 1, fullName: b.fullName });
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const [modeListId, modeEntry] = sorted[0];
  if (modeEntry.count / banks.length < DOMINANCE) return null;
  if (modeListId === proposedBankListId) return null;

  return {
    historicalBankListId: modeListId,
    historicalBankFullName: modeEntry.fullName,
    sampleSize: banks.length,
    modeCount: modeEntry.count,
  };
}
