// Supabase Edge Function: monitor-health
//
// Runs hourly via pg_cron. Checks 5 Tier 1 SLOs and sends a Brevo alert email
// when a threshold is breached, subject to per-SLO frequency caps.
//
// SLOs:
//   1. poller_heartbeat     — gap > 90 min during weekday 9am-5pm ET     cap: 1/day
//   2. claude_usage         — any Claude invoice call this week           cap: 1/week
//   4. recon_mismatch       — any reconciliation mismatch in last 24h     cap: 1/day
//   6. unprocessed_count    — any full parse miss (no DB record) in 7 days cap: 1/day
//   7. edge_5xx             — any edge function 5xx in last 6h            cap: 1/6h
//   8. zero_hour_timesheet  — 0h approved timesheet for completed week    cap: 1/day
//                              from a contractor with non-zero history
//   9. auto_yes_zero_hour   — auto-YES submission resulted in 0h           cap: 4h
//                              (CRITICAL — sanity gate should prevent this)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SloResult {
  key: string;
  ok: boolean;
  current: string;
  threshold: string;
  details: string;
  capMinutes: number; // frequency cap in minutes
  actionSuggestion: string;
}

// ─── SLO checks ────────────────────────────────────────────────────────────

async function checkPollerHeartbeat(supabase: ReturnType<typeof createClient>): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'poller_heartbeat',
    threshold: '90 min gap',
    capMinutes: 24 * 60,
    actionSuggestion: 'Check GitHub Actions → poll-timesheets.yml. Re-run the job manually if stalled.',
  };

  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = etNow.getHours();
  const day = etNow.getDay(); // 0=Sun, 6=Sat

  // Only alert during weekday business hours ET
  if (day === 0 || day === 6 || hour < 9 || hour >= 17) {
    return { ...base, ok: true, current: 'outside business hours', details: 'Check skipped outside 9am–5pm ET weekdays' };
  }

  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'poller_last_run')
    .single();

  const rawVal = data?.value;
  const val = rawVal ? (typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal) : null;

  if (error || !val?.ran_at) {
    return { ...base, ok: false, current: 'no heartbeat found', details: 'system_settings.poller_last_run is missing or empty' };
  }

  const lastRun = new Date(val.ran_at as string);
  const gapMinutes = (now.getTime() - lastRun.getTime()) / 60000;

  return {
    ...base,
    ok: gapMinutes <= 90,
    current: `${Math.round(gapMinutes)} min since last run`,
    details: `Last run: ${lastRun.toISOString()}`,
  };
}

async function checkClaudeUsage(supabase: ReturnType<typeof createClient>): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'claude_usage',
    threshold: '0 Claude calls this week',
    capMinutes: 7 * 24 * 60,
    actionSuggestion: 'See email_invoice_log for this week\'s Claude calls. Run monthly-invoice-analysis.js to identify which contractor needs a regex template.',
  };

  // Use REST API with PostgREST JSON filter on the JSONB column
  const weekStart = getWeekMonday(new Date()).toISOString();
  const { data, error } = await supabase
    .from('email_invoice_log')
    .select('id, raw_extracted, created_at')
    .gte('created_at', weekStart)
    .not('raw_extracted', 'is', null);

  if (error) {
    return { ...base, ok: true, current: 'query error', details: `Could not check: ${error.message}` };
  }

  const claudeRows = (data ?? []).filter((r: { raw_extracted: { parseMethod?: string } | null }) =>
    r.raw_extracted?.parseMethod === 'claude_full' || r.raw_extracted?.parseMethod === 'claude_vision'
  );

  return {
    ...base,
    ok: claudeRows.length === 0,
    current: `${claudeRows.length} Claude call(s) this week`,
    details: claudeRows.length > 0
      ? `Invoice log IDs: ${claudeRows.map((r: { id: number }) => r.id).join(', ')}`
      : 'No Claude calls this week',
  };
}

async function checkReconMismatch(supabase: ReturnType<typeof createClient>): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'recon_mismatch',
    threshold: '0 new mismatches in 24h',
    capMinutes: 24 * 60,
    actionSuggestion: 'Open the Invoices tab in the accountant view and filter by reconciliation_status = mismatch. Review hours vs timesheet.',
  };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('reconciliation_status', 'mismatch')
    .gte('created_at', since);

  if (error) {
    return { ...base, ok: true, current: 'query error', details: `Could not check: ${error.message}` };
  }

  return {
    ...base,
    ok: (count ?? 0) === 0,
    current: `${count ?? 0} new mismatch(es) in last 24h`,
    details: count ? `${count} invoice(s) have reconciliation_status = 'mismatch' since ${since}` : 'No new mismatches',
  };
}

async function checkUnprocessedCount(supabase: ReturnType<typeof createClient>): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'unprocessed_count',
    threshold: '0 full parse misses in 7 days',
    capMinutes: 24 * 60,
    actionSuggestion: 'Check email_import_log and email_invoice_log for failed/partial rows with no resulting record. Re-process or investigate the raw email.',
  };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [tsResult, invResult] = await Promise.all([
    supabase
      .from('email_import_log')
      .select('*', { count: 'exact', head: true })
      .in('parse_status', ['failed', 'partial'])
      .is('timesheet_id', null)
      .gte('received_at', since),  // email_import_log uses received_at not created_at
    supabase
      .from('email_invoice_log')
      .select('*', { count: 'exact', head: true })
      .in('parse_status', ['failed', 'partial'])
      .is('invoice_id', null)
      .gte('created_at', since),
  ]);

  if (tsResult.error || invResult.error) {
    return { ...base, ok: true, current: 'query error', details: `Could not check: ${tsResult.error?.message || invResult.error?.message}` };
  }

  const tsCount = tsResult.count ?? 0;
  const invCount = invResult.count ?? 0;
  const total = tsCount + invCount;

  return {
    ...base,
    ok: total === 0,
    current: `${total} unprocessed (${tsCount} timesheet, ${invCount} invoice)`,
    details: total > 0
      ? `email_import_log: ${tsCount} misses, email_invoice_log: ${invCount} misses in last 7 days`
      : 'All emails successfully produced a DB record',
  };
}

async function checkZeroHourTimesheet(supabase: ReturnType<typeof createClient>): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'zero_hour_timesheet',
    threshold: '0 zero-hour timesheets for completed weeks (excluding known-inactive contractors)',
    capMinutes: 24 * 60,
    actionSuggestion: 'Query: SELECT id,user_id,user_name,week_start,entries FROM timesheets WHERE status IN (approved,correction_pending) AND week_start >= NOW()-INTERVAL \'30 days\'. Inspect entries JSON — likely parser or auto-YES bug (empty {} entries mean hours were silently dropped). Repair the timesheet and file a bug for the ingest path.',
  };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const historyStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Pull recent timesheets (approved or correction_pending) whose week has completed.
  // Exclude verified_zero_hours — accountant has already confirmed those as legitimate 0h weeks.
  const { data: recent, error } = await supabase
    .from('timesheets')
    .select('id, user_id, user_name, week_start, entries, source, status')
    .in('status', ['approved', 'correction_pending'])
    .eq('verified_zero_hours', false)
    .gte('week_start', since);

  if (error) {
    return { ...base, ok: true, current: 'query error', details: `Could not query timesheets: ${error.message}` };
  }

  const sumHours = (entries: unknown): number => {
    if (!entries || typeof entries !== 'object') return 0;
    return Object.values(entries as Record<string, unknown>).reduce((acc: number, e) => {
      if (typeof e === 'number') return acc + e;
      if (e && typeof e === 'object') {
        const h = (e as { hours?: string | number }).hours;
        const n = typeof h === 'number' ? h : parseFloat(String(h ?? 0));
        return acc + (isFinite(n) ? n : 0);
      }
      return acc;
    }, 0);
  };

  // Filter: completed weeks (week_start + 6 days < today) with 0 total hours
  const zeros = (recent || []).filter((t: { week_start: string; entries: unknown }) => {
    const weekEnd = new Date(t.week_start);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    if (weekEnd.toISOString().slice(0, 10) >= todayIso) return false; // week not complete
    return sumHours(t.entries) === 0;
  });

  if (zeros.length === 0) {
    return { ...base, ok: true, current: '0 zero-hour timesheets flagged', details: 'All recent completed-week timesheets have hours' };
  }

  // Filter out contractors with legitimately-zero history (LOA users) — only flag if they have
  // ≥1 timesheet in the prior 90 days with non-zero hours
  const userIds = [...new Set(zeros.map((t) => t.user_id))];
  const { data: history } = await supabase
    .from('timesheets')
    .select('user_id, entries')
    .in('user_id', userIds)
    .gte('week_start', historyStart);

  const usersWithHistory = new Set<string>();
  for (const h of history || []) {
    if (sumHours((h as { entries: unknown }).entries) > 0) {
      usersWithHistory.add((h as { user_id: string }).user_id);
    }
  }

  const suspicious = zeros.filter((t) => usersWithHistory.has(t.user_id));

  if (suspicious.length === 0) {
    return { ...base, ok: true, current: `${zeros.length} zero-hour timesheet(s), all from inactive contractors`, details: 'No flags (contractors have no non-zero history — likely LOA)' };
  }

  const preview = suspicious.slice(0, 5)
    .map((t) => `${t.user_name} (id ${t.id}, week ${t.week_start})`)
    .join('; ');

  return {
    ...base,
    ok: false,
    current: `${suspicious.length} zero-hour timesheet(s) flagged`,
    details: `Contractors with non-zero recent history submitted 0h for a completed week: ${preview}${suspicious.length > 5 ? ` (+${suspicious.length - 5} more)` : ''}`,
  };
}

async function checkAutoYesZeroHour(supabase: ReturnType<typeof createClient>): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'auto_yes_zero_hour',
    threshold: '0 auto-YES timesheets with 0 total hours (last 30d)',
    capMinutes: 4 * 60,
    actionSuggestion: 'CRITICAL. Auto-YES is meant to replicate a proven pattern — 0h means the sanity gate failed or was bypassed. Marta 902 + Nikolina 1047 caused client under-invoicing. Query: SELECT l.id, l.timesheet_id, l.from_email, l.raw_hours FROM email_import_log l JOIN timesheets t ON t.id=l.timesheet_id WHERE l.message_id LIKE \'reply-yes-%\' AND t.verified_zero_hours=FALSE. Repair the timesheet immediately; check if a client invoice has already gone out for that period.',
  };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: yesLogs, error } = await supabase
    .from('email_import_log')
    .select('id, timesheet_id, from_email, raw_hours, received_at')
    .like('message_id', 'reply-yes-%')
    .not('timesheet_id', 'is', null)
    .gte('received_at', since);

  if (error) {
    return { ...base, ok: true, current: 'query error', details: `Could not query import log: ${error.message}` };
  }

  const flagged: Array<{ id: number; ts: number; email: string; total: number }> = [];
  const tsIds = (yesLogs || []).map((l: { timesheet_id: number }) => l.timesheet_id);

  if (tsIds.length === 0) {
    return { ...base, ok: true, current: '0 auto-YES submissions in last 30d', details: 'No auto-YES traffic to check' };
  }

  const { data: tsRows } = await supabase
    .from('timesheets')
    .select('id, entries, verified_zero_hours')
    .in('id', tsIds)
    .eq('verified_zero_hours', false);

  const tsMap = new Map<number, unknown>();
  for (const r of tsRows || []) tsMap.set((r as { id: number }).id, (r as { entries: unknown }).entries);

  const sumHours = (entries: unknown): number => {
    if (!entries || typeof entries !== 'object') return 0;
    return Object.values(entries as Record<string, unknown>).reduce((acc: number, e) => {
      if (typeof e === 'number') return acc + e;
      if (e && typeof e === 'object') {
        const h = (e as { hours?: string | number }).hours;
        const n = typeof h === 'number' ? h : parseFloat(String(h ?? 0));
        return acc + (isFinite(n) ? n : 0);
      }
      return acc;
    }, 0);
  };

  for (const l of yesLogs || []) {
    const log = l as { id: number; timesheet_id: number; from_email: string };
    if (!tsMap.has(log.timesheet_id)) continue; // verified or missing
    const total = sumHours(tsMap.get(log.timesheet_id));
    if (total === 0) flagged.push({ id: log.id, ts: log.timesheet_id, email: log.from_email, total });
  }

  if (flagged.length === 0) {
    return { ...base, ok: true, current: `0 zero-hour auto-YES (of ${tsIds.length} auto-YES in 30d)`, details: 'All auto-YES submissions have non-zero hours' };
  }

  const preview = flagged.slice(0, 5).map((f) => `${f.email} (ts ${f.ts})`).join('; ');
  return {
    ...base,
    ok: false,
    current: `${flagged.length} auto-YES with 0h`,
    details: `🚨 CRITICAL: Auto-YES submission(s) resulted in 0h — client under-invoicing risk: ${preview}${flagged.length > 5 ? ` (+${flagged.length - 5} more)` : ''}`,
  };
}

async function checkEdge5xx(supabasePat: string, projectRef: string): Promise<SloResult> {
  const base: Omit<SloResult, 'ok' | 'current' | 'details'> = {
    key: 'edge_5xx',
    threshold: '0 edge function 5xx in 6h',
    capMinutes: 6 * 60,
    actionSuggestion: 'Check edge function logs in the Supabase dashboard → Logs → Edge Functions. Look for the failing function and fix the underlying error.',
  };

  if (!supabasePat) {
    return { ...base, ok: true, current: 'skipped', details: 'SUPABASE_PAT not set — edge log check disabled' };
  }

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const sql = `SELECT count(*) as cnt FROM edge_logs WHERE timestamp >= '${sixHoursAgo.toISOString()}' AND metadata->>'status' >= '500'`;

  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all?sql=${encodeURIComponent(sql)}`,
      { headers: { 'Authorization': `Bearer ${supabasePat}` } }
    );

    if (!res.ok) {
      return { ...base, ok: true, current: 'query error', details: `Analytics API returned ${res.status}` };
    }

    const body = await res.json() as { result?: Array<{ cnt: string }> };
    const count = parseInt(body?.result?.[0]?.cnt ?? '0', 10);

    return {
      ...base,
      ok: count === 0,
      current: `${count} 5xx error(s) in last 6h`,
      details: count > 0 ? `${count} edge function requests returned 5xx since ${sixHoursAgo.toISOString()}` : 'No 5xx errors in last 6h',
    };
  } catch (e) {
    return { ...base, ok: true, current: 'query error', details: `Analytics fetch failed: ${String(e)}` };
  }
}

// ─── Alerting state & Brevo ────────────────────────────────────────────────

// Returns current state and whether cap allows alerting
async function getBreachState(supabase: ReturnType<typeof createClient>, sloKey: string, capMinutes: number): Promise<{
  consecutiveBreaches: number;
  canAlert: boolean;
}> {
  const { data } = await supabase
    .from('system_alerts_state')
    .select('last_alerted_at, consecutive_breaches')
    .eq('slo_key', sloKey)
    .single();

  const lastAlerted = data?.last_alerted_at ? new Date(data.last_alerted_at).getTime() : 0;
  const capMs = capMinutes * 60 * 1000;
  return {
    consecutiveBreaches: data?.consecutive_breaches ?? 0,
    canAlert: !lastAlerted || (Date.now() - lastAlerted) >= capMs,
  };
}

async function recordBreach(supabase: ReturnType<typeof createClient>, sloKey: string, newCount: number, alerted: boolean): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('system_alerts_state').upsert({
    slo_key: sloKey,
    last_breached_at: now,
    consecutive_breaches: newCount,
    ...(alerted ? { last_alerted_at: now } : {}),
  }, { onConflict: 'slo_key' });
}

async function recordOk(supabase: ReturnType<typeof createClient>, sloKey: string): Promise<void> {
  // Reset consecutive_breaches; preserve last_alerted_at so cap stays meaningful
  await supabase.from('system_alerts_state')
    .update({ consecutive_breaches: 0 })
    .eq('slo_key', sloKey);
}

async function sendAlert(
  brevoKey: string,
  fromEmail: string,
  slo: SloResult,
  consecutiveBreaches: number
): Promise<{ ok: boolean; error?: string }> {
  const subject = `[Synergie ALERT] ${slo.key.replace(/_/g, ' ')} — ${slo.current}`;
  const body = [
    `SLO: ${slo.key}`,
    `Status: BREACHED (${consecutiveBreaches} consecutive check(s))`,
    `Current: ${slo.current}`,
    `Threshold: ${slo.threshold}`,
    `Details: ${slo.details}`,
    ``,
    `Action: ${slo.actionSuggestion}`,
    ``,
    `Time: ${new Date().toISOString()}`,
    `App: https://time.mysynergie.net`,
  ].join('\n');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Synergie Monitor', email: fromEmail },
      to: [{ email: 'dbanga@synergietechsolutions.com', name: 'Dan' }],
      subject,
      textContent: body,
    }),
  });

  const data = await res.json();
  return res.ok ? { ok: true } : { ok: false, error: JSON.stringify(data) };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

// ─── Main handler ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL    = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const BREVO_API_KEY   = Deno.env.get('BREVO_API_KEY')!;
  const FROM_EMAIL      = Deno.env.get('FROM_EMAIL') || 'timesheets@mysynergie.net';
  const SUPABASE_PAT    = Deno.env.get('SB_ANALYTICS_PAT') || '';
  const PROJECT_REF     = 'mimlatvdwxqtgxrgcins';
  const DRY_RUN         = new URL(req.url).searchParams.get('dry_run') === 'true';

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Run all SLO checks in parallel
  const results = await Promise.all([
    checkPollerHeartbeat(supabase),
    checkClaudeUsage(supabase),
    checkReconMismatch(supabase),
    checkUnprocessedCount(supabase),
    checkZeroHourTimesheet(supabase),
    checkAutoYesZeroHour(supabase),
    checkEdge5xx(SUPABASE_PAT, PROJECT_REF),
  ]);

  const report: Array<{ slo: string; ok: boolean; current: string; alerted?: boolean; skipped?: string }> = [];

  for (const slo of results) {
    if (slo.ok) {
      await recordOk(supabase, slo.key);
      report.push({ slo: slo.key, ok: true, current: slo.current });
      continue;
    }

    // Breach — single read for state + cap check
    const { consecutiveBreaches, canAlert } = await getBreachState(supabase, slo.key, slo.capMinutes);
    const newCount = consecutiveBreaches + 1;

    if (canAlert && !DRY_RUN) {
      const emailResult = await sendAlert(BREVO_API_KEY, FROM_EMAIL, slo, newCount);
      await recordBreach(supabase, slo.key, newCount, true);
      report.push({ slo: slo.key, ok: false, current: slo.current, alerted: emailResult.ok });
    } else {
      await recordBreach(supabase, slo.key, newCount, false);
      report.push({
        slo: slo.key, ok: false, current: slo.current, alerted: false,
        skipped: DRY_RUN ? 'dry_run' : `within ${slo.capMinutes}min cap`,
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, checked_at: new Date().toISOString(), slos: report }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
