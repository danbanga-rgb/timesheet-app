// Supabase Edge Function: send-timesheet-report
//
// Generates a CSV of all contractors vs last week's timesheets and emails it
// to accounting@synergietechsolutions.com via Brevo.
//
// Auth: x-ingest-secret header (same secret as ingest-timesheet)
// Request: POST with empty body — everything computed server-side.
// Response: { ok, week, submitted, total, missing, recipient }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
};

const ACCOUNTING_EMAIL = 'accounting@synergietechsolutions.com';
const FROM_EMAIL       = 'timesheets@mysynergie.net';
const FROM_NAME        = 'Synergie Timesheet System';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function lastWeekMonday(): string {
  const now   = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow   = today.getUTCDay();                    // 0=Sun … 6=Sat
  const daysToThisMonday = dow === 0 ? 6 : dow - 1;
  const lastMonday = new Date(today);
  lastMonday.setUTCDate(today.getUTCDate() - daysToThisMonday - 7);
  return lastMonday.toISOString().slice(0, 10);
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function formatWeekRange(weekStart: string): { label: string; filename: string } {
  const weekEnd      = addDays(weekStart, 6);
  const [sy, sm, sd] = weekStart.split('-').map(Number);
  const [,  em, ed]  = weekEnd.split('-').map(Number);
  const months       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const rangeStr     = sm === em
    ? `${months[sm - 1]} ${sd}–${ed}, ${sy}`
    : `${months[sm - 1]} ${sd} – ${months[em - 1]} ${ed}, ${sy}`;
  return {
    label:    rangeStr,
    filename: `Timesheet Report - ${months[sm - 1]} ${sd}-${ed} ${sy}.csv`,
  };
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function isTestAccount(name: string): boolean {
  const lower = (name || '').toLowerCase().trim();
  return lower === 'test' || /\b(hotmail|yahoo|gmail|outlook)\b/.test(lower);
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
  if (h <= 0) return '';
  return h % 1 === 0 ? String(h) : String(h);
}

// ─── CSV builder (handles quoting; prepends UTF-8 BOM for Excel) ──────────────

function buildCsv(rows: string[][]): string {
  const lines = rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  return '﻿' + lines.join('\r\n');
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

  // ─── Compute week ────────────────────────────────────────────────────────────

  const weekStart                    = lastWeekMonday();
  const { label: weekLabel, filename: csvFilename } = formatWeekRange(weekStart);

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayKeys: string[]   = [];
  const dayLabels: string[] = [];
  for (let i = 0; i < 7; i++) {
    const dk     = addDays(weekStart, i);
    const [, mm, dd] = dk.split('-');
    dayKeys.push(dk);
    dayLabels.push(`${DAY_NAMES[i]} ${mm}/${dd}`);
  }

  // ─── Fetch profiles ───────────────────────────────────────────────────────────

  const { data: allProfiles, error: profErr } = await db
    .from('profiles')
    .select('id, name, role')
    .in('role', ['timesheetuser', 'vendormanager'])
    .order('name');

  if (profErr) {
    return new Response(JSON.stringify({ error: `Profile query: ${profErr.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const seenNames = new Set<string>();
  const profiles  = (allProfiles ?? []).filter(p => {
    if (isTestAccount(p.name)) return false;
    const key = (p.name || '').toLowerCase().trim();
    if (seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  // ─── Fetch last week's timesheets ─────────────────────────────────────────────

  const { data: timesheets, error: tsErr } = await db
    .from('timesheets')
    .select('user_id, entries')
    .eq('week_start', weekStart);

  if (tsErr) {
    return new Response(JSON.stringify({ error: `Timesheet query: ${tsErr.message}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tsMap = new Map((timesheets ?? []).map(t => [t.user_id, t.entries ?? {}]));

  // ─── Build CSV ────────────────────────────────────────────────────────────────

  const csvRows: string[][] = [['Contractor', ...dayLabels, 'Total Hours']];
  const missing: string[]   = [];
  let submitted = 0;

  for (const p of profiles) {
    const entries = tsMap.get(p.id);
    if (entries !== undefined) {
      submitted++;
      const dayHours = dayKeys.map(dk => fmtHours(getHours(entries[dk])));
      const total    = dayKeys.reduce((sum, dk) => sum + getHours(entries[dk]), 0);
      csvRows.push([p.name, ...dayHours, fmtHours(total)]);
    } else {
      missing.push(p.name);
      csvRows.push([p.name, ...Array(7).fill(''), '']);
    }
  }

  // ─── Encode CSV as base64 ─────────────────────────────────────────────────────

  const csvContent = buildCsv(csvRows);
  const bytes      = new TextEncoder().encode(csvContent);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64Csv = btoa(binary);

  // ─── Compose email ────────────────────────────────────────────────────────────

  const total = profiles.length;

  const missingItemsHtml = missing
    .map(n => `<li style="padding:2px 0">${n}</li>`)
    .join('');

  const bodyHtml = `
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
  <div style="background:#1e40af;color:white;padding:20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0">Timesheet Report — ${weekLabel}</h2>
  </div>
  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
    <p style="margin-top:0">Please find the weekly timesheet summary attached.</p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Week</td><td><strong>${weekLabel}</strong></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Submitted</td><td><strong>${submitted} of ${total}</strong></td></tr>
      <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Missing</td><td><strong style="color:${missing.length ? '#dc2626' : 'inherit'}">${missing.length}</strong></td></tr>
    </table>
    ${missing.length ? `
    <p style="margin-top:20px;margin-bottom:6px;font-weight:bold;color:#dc2626">Missing timesheets (${missing.length}):</p>
    <ul style="margin:0;padding-left:20px;columns:2;column-gap:32px">${missingItemsHtml}</ul>` : `
    <p style="color:#16a34a;font-weight:bold">✓ All contractors submitted.</p>`}
    <p style="margin-top:24px;font-size:12px;color:#9ca3af">Automated report from the Synergie Timesheet System.</p>
  </div>
</div>`;

  const missingListText = missing.length
    ? `\nMissing contractors:\n${missing.map(n => `  • ${n}`).join('\n')}`
    : '\nAll contractors submitted.';

  const bodyText =
    `Timesheet Report — ${weekLabel}\n\n` +
    `Week:      ${weekLabel}\n` +
    `Submitted: ${submitted} of ${total}\n` +
    `Missing:   ${missing.length}` +
    missingListText +
    '\n\nSee attached CSV for full details.';

  // ─── Send via Brevo ───────────────────────────────────────────────────────────

  const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender:      { name: FROM_NAME, email: FROM_EMAIL },
      to:          [{ email: ACCOUNTING_EMAIL, name: 'Accounting' }],
      subject:     `Timesheet Report — Week of ${weekLabel}`,
      textContent: bodyText,
      htmlContent: bodyHtml,
      attachment:  [{ content: base64Csv, name: csvFilename }],
    }),
  });

  if (!emailRes.ok) {
    const errBody = await emailRes.text();
    return new Response(JSON.stringify({ error: `Brevo send failed: ${errBody}` }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, week: weekStart, submitted, total, missing: missing.length, recipient: ACCOUNTING_EMAIL }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
