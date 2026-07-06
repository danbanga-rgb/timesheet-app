// Supabase Edge Function: send-timesheet-report
//
// Generates a per-week timesheet summary and emails it to
// accounting@synergietechsolutions.com via Brevo after each poller run.
//
// Covers all completed weeks since 2026-04-27 (the cutoff).
// Only includes weeks where at least one eligible contractor is missing.
// Attaches a separate CSV for each such week.
//
// Auth: x-ingest-secret header (same secret as ingest-timesheet)
// Request: POST with empty body — everything computed server-side.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
};

const ACCOUNTING_EMAIL = 'accounting@synergietechsolutions.com';
const LEADERSHIP_EMAIL = 'dbanga@synergietechsolutions.com';
const FROM_EMAIL       = 'timesheets@mysynergie.net';
const FROM_NAME        = 'Synergie Timesheet System';
const CUTOFF           = '2026-04-27';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function lastCompletedMonday(): string {
  const today = todayUtc();
  const dow   = today.getUTCDay();                    // 0=Sun … 6=Sat
  const daysToThisMonday = dow === 0 ? 6 : dow - 1;
  const lastMonday = new Date(today);
  lastMonday.setUTCDate(today.getUTCDate() - daysToThisMonday - 7);
  return lastMonday.toISOString().slice(0, 10);
}

function currentMonday(): string {
  const today = todayUtc();
  const dow   = today.getUTCDay();
  const daysToThisMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - daysToThisMonday);
  return monday.toISOString().slice(0, 10);
}

function isFridayOrLaterUtc(): boolean {
  const dow = todayUtc().getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  return dow === 5 || dow === 6 || dow === 0;
}

function completedWeeksSince(cutoff: string): string[] {
  const weeks: string[] = [];
  let cur = cutoff;
  const end = lastCompletedMonday();
  while (cur <= end) {
    weeks.push(cur);
    cur = addDays(cur, 7);
  }
  return weeks;
}

function weekLabel(weekStart: string): string {
  const weekEnd      = addDays(weekStart, 6);
  const [sy, sm, sd] = weekStart.split('-').map(Number);
  const [,  em, ed]  = weekEnd.split('-').map(Number);
  const months       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return sm === em
    ? `${months[sm - 1]} ${sd}–${ed}, ${sy}`
    : `${months[sm - 1]} ${sd} – ${months[em - 1]} ${ed}, ${sy}`;
}

function csvFilename(weekStart: string): string {
  const weekEnd      = addDays(weekStart, 6);
  const [sy, sm, sd] = weekStart.split('-').map(Number);
  const [,   , ed]   = weekEnd.split('-').map(Number);
  const months       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `Timesheet Report - ${months[sm - 1]} ${sd}-${ed} ${sy}.csv`;
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function isTestAccount(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  return lower === 'test' || /\b(hotmail|yahoo)\b/.test(lower);
}

function getHours(entry: unknown): number {
  if (entry == null) return 0;
  if (typeof entry === 'number') return entry;
  if (typeof entry === 'string') return parseFloat(entry) || 0;
  if (typeof entry === 'object') {
    const h = (entry as Record<string, unknown>).hours;
    return h != null ? parseFloat(String(h)) || 0 : 0;
  }
  return 0;
}

function fmtHours(h: number): string {
  return h > 0 ? String(h) : '';
}

// ─── CSV builder (UTF-8 BOM for Excel) ───────────────────────────────────────

function buildCsv(rows: string[][]): string {
  const lines = rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  return '﻿' + lines.join('\r\n');
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

// ─── Timing section ───────────────────────────────────────────────────────────

function buildTimingSection(
  allTimesheets: Array<{ id: number; user_id: string; week_start: string; submitted_at: string | null; source: string }>,
  profileIds: Set<string>,
  completedWeeks: string[],
  profiles: Array<{ id: string; start_date: string | null; end_date: string | null }>,
  channelMap: Map<number, 'portal' | 'direct' | 'forwarded' | 'auto_yes'>,
  currentWeekForTimeliness: string | null = null,
): string {
  const timingWeeks = completedWeeks.slice(-6);
  if (currentWeekForTimeliness && !timingWeeks.includes(currentWeekForTimeliness)) {
    timingWeeks.push(currentWeekForTimeliness);
  }
  if (timingWeeks.length === 0) return '';

  const profileStartDate = new Map<string, string>();
  const profileEndDate   = new Map<string, string>();
  for (const p of profiles) {
    profileStartDate.set(p.id, p.start_date ?? '');
    profileEndDate.set(p.id, p.end_date ?? '');
  }

  type WeekStat = { total: number; portal: number; direct: number; forwarded: number; autoYes: number; within1d: number; within3d: number; sumDays: number };
  const stats = new Map<string, WeekStat>();
  for (const wk of timingWeeks) stats.set(wk, { total: 0, portal: 0, direct: 0, forwarded: 0, autoYes: 0, within1d: 0, within3d: 0, sumDays: 0 });

  for (const ts of allTimesheets) {
    const wk = ts.week_start.slice(0, 10);
    if (!stats.has(wk) || !profileIds.has(ts.user_id) || !ts.submitted_at) continue;
    const sd = profileStartDate.get(ts.user_id) ?? '';
    if (sd && sd > addDays(wk, 6)) continue;
    const ed = profileEndDate.get(ts.user_id) ?? '';
    if (ed && ed < wk) continue;
    const [y, m, d]  = wk.split('-').map(Number);
    const weekEndMs  = Date.UTC(y, m - 1, d + 6);
    const daysAfter  = (new Date(ts.submitted_at).getTime() - weekEndMs) / 86400000;
    const st         = stats.get(wk)!;
    st.total++;
    const channel = channelMap.get(ts.id) ?? (ts.source === 'direct' ? 'portal' : 'direct');
    if (channel === 'portal')    st.portal++;
    else if (channel === 'forwarded') st.forwarded++;
    else if (channel === 'auto_yes')  st.autoYes++;
    else                              st.direct++;
    if (daysAfter <= 1) st.within1d++;
    if (daysAfter <= 3) st.within3d++;
    st.sumDays += Math.max(daysAfter, 0);
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TD = 'padding:4px 8px;border-bottom:1px solid #e5e7eb;white-space:nowrap';
  const rows = timingWeeks.map(wk => {
    const st = stats.get(wk)!;
    if (st.total === 0) return '';
    const pct1d = Math.round(100 * st.within1d / st.total);
    const pct3d = Math.round(100 * st.within3d / st.total);
    const avg   = (st.sumDays / st.total).toFixed(1);
    const [, em, ed] = addDays(wk, 6).split('-').map(Number);
    const c1d  = pct1d >= 50 ? '#15803d' : pct1d >= 25 ? '#b45309' : '#dc2626';
    const c3d  = pct3d >= 90 ? '#15803d' : pct3d >= 70 ? '#b45309' : '#dc2626';
    const cYes = st.autoYes > 0 ? '#15803d' : '#9ca3af';
    const inProg = wk === currentWeekForTimeliness
      ? ' <span style="font-size:9px;color:#9ca3af;font-weight:400">●</span>' : '';
    return `<tr>
      <td style="${TD}">${MONTHS[em-1]} ${ed}${inProg}</td>
      <td style="${TD};text-align:center">${st.total}</td>
      <td style="${TD};text-align:center;color:#6b7280">${st.portal}</td>
      <td style="${TD};text-align:center;color:#6b7280">${st.direct}</td>
      <td style="${TD};text-align:center;color:#6b7280">${st.forwarded}</td>
      <td style="${TD};text-align:center;font-weight:600;color:${cYes}">${st.autoYes}</td>
      <td style="${TD};text-align:center;font-weight:600;color:${c1d}">${pct1d}%</td>
      <td style="${TD};text-align:center;font-weight:600;color:${c3d}">${pct3d}%</td>
      <td style="${TD};text-align:center">${avg}d</td>
    </tr>`;
  }).filter(Boolean).join('');

  if (!rows) return '';

  const TH = 'padding:6px 8px;white-space:nowrap;font-weight:600';
  return `
    <div style="margin-bottom:20px">
      <h3 style="margin:0 0 6px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Submission Timeliness — last ${timingWeeks.length} weeks</h3>
      <table style="border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;font-size:13px">
        <thead><tr style="background:#1e40af;color:white">
          <th style="${TH};text-align:left">W/E</th>
          <th style="${TH};text-align:center">Total</th>
          <th style="${TH};text-align:center">Portal</th>
          <th style="${TH};text-align:center">Email</th>
          <th style="${TH};text-align:center">Fwd</th>
          <th style="${TH};text-align:center">Auto-YES</th>
          <th style="${TH};text-align:center">≤1d</th>
          <th style="${TH};text-align:center">≤3d</th>
          <th style="${TH};text-align:center">Avg</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:4px 0 0;font-size:11px;color:#9ca3af">≤1d = by Mon · ≤3d = by Wed · Avg = days after week-end · ● = in progress</p>
    </div>`;
}

// ─── Contractor trend table ───────────────────────────────────────────────────

function buildContractorTrendSection(
  allTimesheets: Array<{ id: number; user_id: string; week_start: string; submitted_at: string | null; source: string }>,
  profiles: Array<{ id: string; name: string; start_date: string | null; end_date: string | null }>,
  channelMap: Map<number, 'portal' | 'direct' | 'forwarded' | 'auto_yes'>,
  timingWeeks: string[],
  currentWeekForTimeliness: string | null,
): string {
  if (timingWeeks.length === 0) return '';

  // Index: userId → weekStart → timesheet
  const tsIdx = new Map<string, Map<string, { id: number; submittedAt: string | null; source: string }>>();
  for (const ts of allTimesheets) {
    const wk = ts.week_start.slice(0, 10);
    if (!tsIdx.has(ts.user_id)) tsIdx.set(ts.user_id, new Map());
    tsIdx.get(ts.user_id)!.set(wk, { id: ts.id, submittedAt: ts.submitted_at, source: ts.source });
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const CH_LABEL: Record<string, string> = { portal: 'P', direct: 'E', forwarded: 'F', auto_yes: 'A' };
  const CH_COLOR: Record<string, string> = { portal: '#15803d', direct: '#2563eb', forwarded: '#9ca3af', auto_yes: '#0891b2' };
  const TD = 'padding:3px 7px;border-bottom:1px solid #f3f4f6;white-space:nowrap';

  const weekHeaders = timingWeeks.map(wk => {
    const [, em, ed] = addDays(wk, 6).split('-').map(Number);
    return `${MONTHS[em-1]} ${ed}${wk === currentWeekForTimeliness ? '●' : ''}`;
  });

  const rowHtml: string[] = [];

  for (const p of profiles) {
    // Only show contractors active in at least one of the timing weeks
    const activeSomeWeek = timingWeeks.some(wk => {
      const sun = addDays(wk, 6);
      return (!p.start_date || p.start_date <= sun) && (!p.end_date || p.end_date >= wk);
    });
    if (!activeSomeWeek) continue;

    const cells = timingWeeks.map(wk => {
      const sun = addDays(wk, 6);
      const eligible = (!p.start_date || p.start_date <= sun) && (!p.end_date || p.end_date >= wk);
      if (!eligible) return `<td style="${TD}"></td>`;

      const ts = tsIdx.get(p.id)?.get(wk);
      const inProg = wk === currentWeekForTimeliness;

      if (!ts) {
        // Eligible but not submitted
        const style = inProg ? `${TD};color:#d1d5db` : `${TD};color:#dc2626`;
        return `<td style="${style};text-align:center">${inProg ? '' : '–'}</td>`;
      }

      const channel = channelMap.get(ts.id) ?? (ts.source === 'direct' ? 'portal' : 'direct');
      const label = CH_LABEL[channel] ?? '?';
      const color = CH_COLOR[channel] ?? '#374151';

      let daysStr = '';
      if (ts.submittedAt && !inProg) {
        const [y, m, d] = wk.split('-').map(Number);
        const weekEndMs = Date.UTC(y, m - 1, d + 6);
        const days = Math.max(0, Math.round((new Date(ts.submittedAt).getTime() - weekEndMs) / 86400000));
        daysStr = ` ${days}d`;
      }

      return `<td style="${TD};text-align:center;color:${color};font-weight:600">${label}${daysStr}</td>`;
    }).join('');

    const zebra = rowHtml.length % 2 === 1 ? 'background:#f9fafb' : '';
    rowHtml.push(`<tr style="${zebra}"><td style="${TD};min-width:140px">${p.name}</td>${cells}</tr>`);
  }

  if (rowHtml.length === 0) return '';

  const TH = 'padding:5px 7px;white-space:nowrap;font-weight:600;text-align:center';
  return `
    <div style="margin-bottom:20px">
      <h3 style="margin:0 0 6px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">Contractor Trend</h3>
      <table style="border-collapse:collapse;background:white;border-radius:6px;overflow:hidden;border:1px solid #e5e7eb;font-size:12px">
        <thead><tr style="background:#374151;color:white">
          <th style="${TH};text-align:left;min-width:140px">Contractor</th>
          ${weekHeaders.map(h => `<th style="${TH}">${h}</th>`).join('')}
        </tr></thead>
        <tbody>${rowHtml.join('')}</tbody>
      </table>
      <p style="margin:4px 0 0;font-size:11px;color:#9ca3af">P=Portal · E=Email · F=Fwd · A=Auto-YES · –=missing · blank=inactive · ●=in progress</p>
    </div>`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const INGEST_SECRET = Deno.env.get('INGEST_SECRET') ?? '';
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const secret = req.headers.get('x-ingest-secret') ?? '';
  if (!INGEST_SECRET || secret !== INGEST_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: 'BREVO_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db   = createClient(SUPABASE_URL, SERVICE_KEY);
  const mode = new URL(req.url).searchParams.get('mode') ?? '';

  // ─── Weeks to cover ───────────────────────────────────────────────────────────

  const completedWeeks           = completedWeeksSince(CUTOFF);
  const currentWeekStart         = currentMonday();
  const fetchCurrentWeek         = isFridayOrLaterUtc();   // fetch data Fri/Sat/Sun
  const weeks                    = [...completedWeeks];
  if (fetchCurrentWeek && !weeks.includes(currentWeekStart)) {
    weeks.push(currentWeekStart);
  }
  // Current week shown in timeliness table (Fri/Sat/Sun, data-gated by >0 submissions).
  // Never shown as a detail card — by Monday it's a completed week and handled normally.
  const currentWeekForTimeliness = fetchCurrentWeek ? currentWeekStart : null;

  if (weeks.length === 0) {
    return new Response(JSON.stringify({ ok: true, message: 'No completed weeks yet' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ─── Fetch profiles ───────────────────────────────────────────────────────────

  const { data: allProfiles, error: profErr } = await db
    .from('profiles')
    .select('id, name, start_date, end_date, role')
    .eq('role', 'timesheetuser')
    .order('name');

  if (profErr) {
    return new Response(JSON.stringify({ error: `Profile query: ${profErr.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Deduplicate by name, exclude test accounts
  const seenNames = new Set<string>();
  const profiles = (allProfiles ?? []).filter(p => {
    if (isTestAccount(p.name)) return false;
    const key = (p.name || '').toLowerCase().trim();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });
  const profileIds = new Set(profiles.map(p => p.id));

  // ─── Fetch all non-rejected timesheets for all covered weeks ─────────────────

  const { data: allTimesheets, error: tsErr } = await db
    .from('timesheets')
    .select('id, user_id, week_start, entries, submitted_at, source')
    .in('week_start', weeks)
    .neq('status', 'rejected');

  if (tsErr) {
    return new Response(JSON.stringify({ error: `Timesheet query: ${tsErr.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Index: weekStart → userId → entries
  const tsByWeek = new Map<string, Map<string, Record<string, unknown>>>();
  for (const ts of (allTimesheets ?? [])) {
    const wk = ts.week_start.slice(0, 10);
    if (!tsByWeek.has(wk)) tsByWeek.set(wk, new Map());
    tsByWeek.get(wk)!.set(ts.user_id, ts.entries ?? {});
  }

  // ─── Build channel map from email_import_log ────────────────────────────────

  const allTimesheetIds = (allTimesheets ?? []).map(ts => ts.id);
  const channelMap = new Map<number, 'portal' | 'direct' | 'forwarded' | 'auto_yes'>();

  if (allTimesheetIds.length > 0) {
    const { data: logRows } = await db
      .from('email_import_log')
      .select('timesheet_id, from_email, resolved_email, message_id')
      .in('timesheet_id', allTimesheetIds);

    for (const row of (logRows ?? [])) {
      if (!row.timesheet_id) continue;
      let channel: 'portal' | 'direct' | 'forwarded' | 'auto_yes';
      if (row.message_id && String(row.message_id).startsWith('reply-yes-')) {
        channel = 'auto_yes';
      } else if (row.from_email && row.resolved_email && row.from_email !== row.resolved_email) {
        channel = 'forwarded';
      } else {
        channel = 'direct';
      }
      channelMap.set(row.timesheet_id, channel);
    }
  }

  // ─── Digest mode: timeliness-only email to leadership ────────────────────────

  if (mode === 'digest') {
    // Guard: only send at 9am PT (handles both PDT UTC-7 and PST UTC-8 automatically)
    // pg_cron fires at both 16:00 and 17:00 UTC; exactly one of those is 9am PT year-round.
    const force = new URL(req.url).searchParams.get('force') === 'true';
    const ptHour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }), 10);
    if (!force && ptHour !== 9) {
      return new Response(JSON.stringify({ ok: true, skipped: 'not 9am PT', ptHour }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const timingWeeks = completedWeeks.slice(-6);
    if (currentWeekForTimeliness && !timingWeeks.includes(currentWeekForTimeliness)) timingWeeks.push(currentWeekForTimeliness);

    const timingHtml     = buildTimingSection(allTimesheets ?? [], profileIds, completedWeeks, profiles, channelMap, currentWeekForTimeliness);
    const contractorHtml = buildContractorTrendSection(allTimesheets ?? [], profiles, channelMap, timingWeeks, currentWeekForTimeliness);

    const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'long' });
    const subject = `Timesheet Submission Digest — ${now}`;
    const bodyHtml = `<div style="font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:20px">
      <div style="background:#1e40af;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Timesheet Submission Digest</h2>
        <p style="margin:6px 0 0;opacity:.85;font-size:14px">${now}</p>
      </div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        ${timingHtml || '<p style="color:#6b7280">No completed weeks with data yet.</p>'}
        ${contractorHtml}
      </div>
    </div>`;

    const digestRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender:      { name: FROM_NAME, email: FROM_EMAIL },
        to:          [{ email: LEADERSHIP_EMAIL, name: 'Dan' }],
        subject,
        htmlContent: bodyHtml,
        textContent: `Timesheet Submission Digest — ${now}\n\nOpen in an HTML email client to view the timeliness table.`,
      }),
    });

    if (!digestRes.ok) {
      const errBody = await digestRes.text();
      return new Response(JSON.stringify({ error: `Brevo send failed: ${errBody}` }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, mode: 'digest', recipient: LEADERSHIP_EMAIL }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ─── Build per-week report sections ──────────────────────────────────────────

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  type WeekReport = {
    weekStart: string;
    label: string;
    submitted: number;
    total: number;
    missingNames: string[];
    htmlSection: string;
    csvContent: string;
    csvName: string;
  };

  const weekReports: WeekReport[] = [];

  for (const weekStart of weeks) {
    const dayKeys: string[]   = [];
    const dayLabels: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dk      = addDays(weekStart, i);
      const [, mm, dd] = dk.split('-');
      dayKeys.push(dk);
      dayLabels.push(`${DAY_NAMES[i]} ${mm}/${dd}`);
    }

    const tsMap = tsByWeek.get(weekStart) ?? new Map();
    const weekSunday = addDays(weekStart, 6);

    // Eligible: started on or before this week's Sunday AND not ended before this week's Monday
    const eligible = profiles.filter(p =>
      p.start_date && p.start_date <= weekSunday &&
      (!p.end_date || p.end_date >= weekStart)
    );
    if (eligible.length === 0) continue;

    // Changes note: new starters this week, or contractors who became inactive last week
    const WK_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const newStarters = profiles.filter(p =>
      p.start_date && p.start_date >= weekStart && p.start_date <= weekSunday
    );
    const newlyInactive = profiles.filter(p =>
      p.end_date && p.end_date >= addDays(weekStart, -7) && p.end_date < weekStart
    );
    let changesNote = '';
    if (newStarters.length > 0 || newlyInactive.length > 0) {
      const parts: string[] = [];
      if (newStarters.length > 0) {
        parts.push('New: ' + newStarters.map(p => {
          const [, em, ed] = p.start_date!.split('-').map(Number);
          return `${p.name} (started ${WK_MONTHS[em - 1]} ${ed})`;
        }).join(', '));
      }
      if (newlyInactive.length > 0) {
        parts.push('Inactive: ' + newlyInactive.map(p => {
          const [, em, ed] = p.end_date!.split('-').map(Number);
          return `${p.name} (end date ${WK_MONTHS[em - 1]} ${ed})`;
        }).join(', '));
      }
      changesNote = `<p style="margin:8px 0 0;padding:6px 10px;background:#f8f9fa;border-left:3px solid #9ca3af;font-size:12px;color:#6b7280;font-style:italic">${parts.join(' · ')}</p>`;
    }

    const missingNames: string[] = [];
    let submitted = 0;

    const csvRows: string[][] = [['Contractor', ...dayLabels, 'Total Hours']];

    for (const p of eligible) {
      const entries = tsMap.get(p.id);
      if (entries !== undefined) {
        submitted++;
        const dayHours = dayKeys.map(dk => fmtHours(getHours(entries[dk])));
        const total    = dayKeys.reduce((sum, dk) => sum + getHours(entries[dk]), 0);
        csvRows.push([p.name, ...dayHours, fmtHours(total)]);
      } else {
        missingNames.push(p.name);
        csvRows.push([p.name, ...Array(7).fill(''), '']);
      }
    }

    // Skip weeks where everyone submitted
    if (missingNames.length === 0) continue;

    // Never show current week as a detail card — noisy before the week ends.
    // It appears in the timeliness table on Fri/Sat/Sun; on Monday it's a completed week.
    if (weekStart === currentWeekStart) continue;

    const label = weekLabel(weekStart);
    const total = eligible.length;

    const missingChips = missingNames.map(n =>
      `<span style="display:inline-block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:4px;padding:3px 10px;margin:3px 4px 3px 0;font-size:13px;font-weight:600">${n}</span>`
    ).join('');

    const weekTitle = `Week ending ${label.split('–')[1]?.trim() ?? label}`;

    const htmlSection = `
      <div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e40af;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
          <strong>${weekTitle}</strong>
          <span style="font-size:12px;opacity:.85">${submitted}/${total} submitted · <span style="color:#fca5a5">${missingNames.length} missing</span></span>
        </div>
        <div style="padding:12px 16px">
          ${missingChips}
          ${changesNote}
        </div>
      </div>`;

    weekReports.push({
      weekStart, label, submitted, total,
      missingNames,
      htmlSection,
      csvContent: buildCsv(csvRows),
      csvName: csvFilename(weekStart),
    });
  }

  // ─── Compose email ────────────────────────────────────────────────────────────

  const totalMissingWeeks = weekReports.length;

  let bodyHtml: string;
  let bodyText: string;
  let subject: string;

  if (totalMissingWeeks === 0) {
    subject  = `Timesheet Report — All Weeks Submitted ✓`;
    bodyText = `All contractors have submitted their timesheets for all weeks since ${CUTOFF}. Nothing outstanding.`;
    bodyHtml = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px">
      <div style="background:#1e40af;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Timesheet Report</h2>
      </div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        <p style="color:#16a34a;font-weight:bold;font-size:16px">✓ All contractors are up to date.</p>
        <p style="color:#6b7280;font-size:13px">No outstanding timesheets for any week since ${CUTOFF}.</p>
      </div>
    </div>`;
  } else {
    const totalMissing = weekReports.reduce((s, r) => s + r.missingNames.length, 0);
    subject = `Timesheet Report — ${totalMissingWeeks} Week${totalMissingWeeks > 1 ? 's' : ''} Outstanding`;

    const summaryRows = weekReports.map(r =>
      `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${r.label}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${r.submitted}/${r.total}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:700">${r.missingNames.length}</td>
      </tr>`
    ).join('');

    bodyHtml = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:20px">
      <div style="background:#1e40af;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">Timesheet Report</h2>
        <p style="margin:6px 0 0;opacity:.85;font-size:14px">${totalMissingWeeks} week${totalMissingWeeks > 1 ? 's' : ''} with outstanding timesheets · ${totalMissing} missing in total</p>
      </div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        <p style="color:#374151;margin-top:0">Summary of all weeks with missing timesheets. CSV files attached for each week.</p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;margin-bottom:8px">
          <thead><tr style="background:#1e40af;color:white">
            <th style="padding:8px 12px;text-align:left">Week</th>
            <th style="padding:8px 12px;text-align:center">Submitted</th>
            <th style="padding:8px 12px;text-align:center">Missing</th>
          </tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>
        ${weekReports.map(r => r.htmlSection).join('')}
        <p style="margin-top:24px;font-size:12px;color:#9ca3af">Automated report from the Synergie Timesheet System. CSV files for each week are attached.</p>
      </div>
    </div>`;

    bodyText = [
      `Timesheet Report — ${totalMissingWeeks} week${totalMissingWeeks > 1 ? 's' : ''} outstanding\n`,
      ...weekReports.map(r =>
        `${r.label}: ${r.submitted}/${r.total} submitted, ${r.missingNames.length} missing\n` +
        r.missingNames.map(n => `  • ${n}`).join('\n')
      ),
      '\nCSV files attached for each week.',
    ].join('\n');
  }

  // ─── Send via Brevo ───────────────────────────────────────────────────────────

  const attachments = weekReports.map(r => ({ content: toBase64(r.csvContent), name: r.csvName }));

  const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender:      { name: FROM_NAME, email: FROM_EMAIL },
      to:          [{ email: ACCOUNTING_EMAIL, name: 'Accounting' }],
      subject,
      textContent: bodyText,
      htmlContent: bodyHtml,
      ...(attachments.length > 0 ? { attachment: attachments } : {}),
    }),
  });

  if (!emailRes.ok) {
    const errBody = await emailRes.text();
    return new Response(JSON.stringify({ error: `Brevo send failed: ${errBody}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const totalSubmitted = weekReports.reduce((s, r) => s + r.submitted, 0);
  const totalEligible  = weekReports.reduce((s, r) => s + r.total, 0);
  const totalMissing   = weekReports.reduce((s, r) => s + r.missingNames.length, 0);

  return new Response(JSON.stringify({
    ok: true,
    weeksChecked:  weeks.length,
    weeksReported: totalMissingWeeks,
    submitted:     totalSubmitted,
    total:         totalEligible,
    missing:       totalMissing,
    recipient:     ACCOUNTING_EMAIL,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
