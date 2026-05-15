// Supabase Edge Function: reconcile-invoices
//
// Re-runs reconciliation for all imported invoices in place.
// No Claude calls — pure DB logic.
//
// Usage:
//   curl -X POST https://<ref>.supabase.co/functions/v1/reconcile-invoices \
//     -H "x-ingest-secret: <INGEST_SECRET>"
//
// Optional body (JSON):
//   { "invoiceIds": [1, 2, 3] }  — limit to specific IDs
//   { "since": "2026-01-01" }    — limit to invoices with period_start >= date

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
};

async function reconcile(
  userId: string,
  periodStart: string,
  periodEnd: string,
  invoiceHours: number,
  supabase: ReturnType<typeof createClient>
): Promise<{
  status: 'matched' | 'mismatch' | 'unverifiable';
  delta: number | null;
  notes: string;
}> {
  const rangeStart = new Date(periodStart + 'T12:00:00');
  rangeStart.setDate(rangeStart.getDate() - 6);
  const rangeStartStr = rangeStart.toISOString().slice(0, 10);

  // Status filter intentionally omitted — all timesheets count.
  const { data: timesheets, error } = await supabase
    .from('timesheets')
    .select('entries')
    .eq('user_id', userId)
    .gte('week_start', rangeStartStr)
    .lte('week_start', periodEnd);

  if (error) {
    return { status: 'unverifiable', delta: null, notes: `DB error: ${error.message}` };
  }

  if (!timesheets || timesheets.length === 0) {
    return { status: 'unverifiable', delta: null, notes: 'No timesheets found for period' };
  }

  let timesheetHours = 0;
  for (const ts of timesheets) {
    const entries = ts.entries as Record<string, { hours: string | number }>;
    for (const [date, entry] of Object.entries(entries)) {
      if (date >= periodStart && date <= periodEnd) {
        const h = parseFloat(String(entry.hours));
        if (!isNaN(h) && h > 0) timesheetHours += h;
      }
    }
  }

  if (timesheetHours === 0) {
    return { status: 'unverifiable', delta: null, notes: `Timesheet: 0h · Invoice: ${invoiceHours}h · Zero hours in period` };
  }

  const delta = Math.round((invoiceHours - timesheetHours) * 100) / 100;
  const matched = Math.abs(delta) < 0.01;

  return {
    status: matched ? 'matched' : 'mismatch',
    delta: matched ? 0 : delta,
    notes: `Timesheet: ${timesheetHours}h · Invoice: ${invoiceHours}h`,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const ingestSecret = Deno.env.get('INGEST_SECRET');
  const provided     = req.headers.get('x-ingest-secret');
  if (!ingestSecret || provided !== ingestSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body is fine */ }

  const invoiceIds = body.invoiceIds as number[] | undefined;
  const since      = body.since      as string   | undefined;

  // ── Fetch target invoices ─────────────────────────────────────────────────
  let query = supabase
    .from('invoices')
    .select('id, user_id, period_start, period_end, total_hours')
    .eq('source', 'imported')
    .not('period_start', 'is', null)
    .not('total_hours', 'is', null);

  if (invoiceIds?.length) query = query.in('id', invoiceIds);
  if (since)             query = query.gte('period_start', since);

  const { data: invoices, error: fetchErr } = await query;

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!invoices?.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: 'No invoices matched' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Reconcile each invoice ────────────────────────────────────────────────
  const results = { matched: 0, mismatch: 0, unverifiable: 0, errors: 0 };

  for (const inv of invoices) {
    try {
      const recon = await reconcile(
        inv.user_id,
        (inv.period_start as string).slice(0, 10),
        (inv.period_end   as string).slice(0, 10),
        inv.total_hours as number,
        supabase,
      );

      await supabase
        .from('invoices')
        .update({
          reconciliation_status: recon.status,
          reconciliation_delta:  recon.delta,
          reconciliation_notes:  recon.notes,
        })
        .eq('id', inv.id);

      results[recon.status]++;
    } catch (e) {
      console.error(`Invoice ${inv.id}: ${String(e)}`);
      results.errors++;
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: invoices.length,
    ...results,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
