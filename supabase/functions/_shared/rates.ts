// rates.ts — read helpers around rate_history.
//
// rate_history is the single source of truth for pay/bill rates. Callers that
// need "what does user X currently pay/bill?" call currentPayRate/currentBillRate
// instead of joining invoices or client_engagements themselves.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface RateHistoryRow {
  id: number;
  user_id: string;
  rate_kind: 'pay' | 'bill';
  rate: number;
  effective_from: string;
  effective_to: string | null;
  client_engagement_id: number | null;
  source: string;
  created_at: string;
  notes: string | null;
}

async function currentRate(
  admin: SupabaseClient,
  userId: string,
  kind: 'pay' | 'bill',
): Promise<RateHistoryRow | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin
    .from('rate_history')
    .select('*')
    .eq('user_id', userId)
    .eq('rate_kind', kind)
    .lte('effective_from', today)
    .or(`effective_to.is.null,effective_to.gt.${today}`)
    .order('effective_from', { ascending: false })
    .limit(1);
  return (data?.[0] as RateHistoryRow | undefined) ?? null;
}

export async function currentPayRate(admin: SupabaseClient, userId: string): Promise<RateHistoryRow | null> {
  return currentRate(admin, userId, 'pay');
}

export async function currentBillRate(admin: SupabaseClient, userId: string): Promise<RateHistoryRow | null> {
  return currentRate(admin, userId, 'bill');
}

// Inserts a new rate row and closes the previous current row atomically-ish.
// Not a true transaction (PostgREST doesn't expose one), but close: we look up
// the current row, close it, then insert the new one. Race window is short.
export async function setRate(
  admin: SupabaseClient,
  args: {
    userId: string;
    kind: 'pay' | 'bill';
    rate: number;
    effectiveFrom: string;             // YYYY-MM-DD
    source: string;
    createdBy?: string | null;
    notes?: string | null;
    clientEngagementId?: number | null;
  },
): Promise<RateHistoryRow> {
  const current = await currentRate(admin, args.userId, args.kind);

  if (current && current.effective_from >= args.effectiveFrom) {
    throw new Error(
      `New ${args.kind} rate effective_from ${args.effectiveFrom} must be after current row's effective_from ${current.effective_from}`,
    );
  }

  if (current) {
    const { error: updErr } = await admin
      .from('rate_history')
      .update({ effective_to: args.effectiveFrom })
      .eq('id', current.id);
    if (updErr) throw new Error(`Failed to close current ${args.kind} rate: ${updErr.message}`);
  }

  const { data: inserted, error: insErr } = await admin
    .from('rate_history')
    .insert({
      user_id: args.userId,
      rate_kind: args.kind,
      rate: args.rate,
      effective_from: args.effectiveFrom,
      effective_to: null,
      client_engagement_id: args.clientEngagementId ?? null,
      source: args.source,
      created_by: args.createdBy ?? null,
      notes: args.notes ?? null,
    })
    .select('*')
    .single();
  if (insErr || !inserted) throw new Error(`Failed to insert new ${args.kind} rate: ${insErr?.message ?? 'no row'}`);
  return inserted as RateHistoryRow;
}
