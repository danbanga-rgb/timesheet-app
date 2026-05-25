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

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ─── Weeks to cover ───────────────────────────────────────────────────────────

  const weeks = completedWeeksSince(CUTOFF);
  if (weeks.length === 0) {
    return new Response(JSON.stringify({ ok: true, message: 'No completed weeks yet' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ─── Fetch profiles ───────────────────────────────────────────────────────────

  const { data: allProfiles, error: profErr } = await db
    .from('profiles')
    .select('id, name, start_date, role')
    .in('role', ['timesheetuser', 'vendormanager'])
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

  // ─── Fetch all non-rejected timesheets for all covered weeks ─────────────────

  const { data: allTimesheets, error: tsErr } = await db
    .from('timesheets')
    .select('user_id, week_start, entries')
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

    // Eligible: contractors whose start_date is on or before this week
    const eligible = profiles.filter(p => p.start_date && p.start_date <= weekStart);
    if (eligible.length === 0) continue;

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

    const label = weekLabel(weekStart);
    const total = eligible.length;

    const missingChips = missingNames.map(n =>
      `<span style="display:inline-block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:4px;padding:3px 10px;margin:3px 4px 3px 0;font-size:13px;font-weight:600">${n}</span>`
    ).join('');

    const htmlSection = `
      <div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e40af;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
          <strong>Week ending ${label.split('–')[1]?.trim() ?? label}</strong>
          <span style="font-size:12px;opacity:.85">${submitted}/${total} submitted · <span style="color:#fca5a5">${missingNames.length} missing</span></span>
        </div>
        <div style="padding:12px 16px">
          ${missingChips}
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
    bodyHtml = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
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
