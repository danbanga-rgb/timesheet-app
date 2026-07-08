// Supabase Edge Function: send-project-consolidation
//
// Emails a per-project consolidated month view (one HTML table per project).
// Query params:
//   projects=APFM,GNW-104,5   comma-separated project identifiers (REQUIRED).
//                             Each item can be a project code (APFM-061), name (APFM), or numeric ID.
//   month=YYYY-MM             override month (default: current month with split-week fallback)
//   force=true                bypass PT-noon-Wednesday hour guard
//   to=a@x,b@x                comma-separated recipient emails (default: dbanga@synergietechsolutions.com)
//
// Schedule: pg_cron 0 19,20 * * 3 (Wed 19:00 & 20:00 UTC → noon PT year-round; hour-guard skips wrong one).
// Auth:     x-ingest-secret header (same as ingest-timesheet).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
};

const DEFAULT_RECIPIENT = 'dbanga@synergietechsolutions.com';
const FROM = { name: 'Synergie Timesheet System', email: 'timesheets@mysynergie.net' };

// ─── Country helpers ─────────────────────────────────────────────────────────
const COUNTRY_NAME: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', UK: 'United Kingdom',
  IN: 'India', HR: 'Croatia', RS: 'Serbia', BA: 'Bosnia and Herzegovina',
  SI: 'Slovenia', MK: 'North Macedonia', AU: 'Australia', UA: 'Ukraine',
  MK2: 'North Macedonia', ME: 'Montenegro',
};
const countryName = (c: string | null) => c ? (COUNTRY_NAME[c] || c) : '—';

const isTestAccount = (name: string) => {
  const l = (name || '').toLowerCase().trim();
  return l === 'test' || /\b(hotmail|yahoo)\b/.test(l);
};

// ─── Date helpers ────────────────────────────────────────────────────────────
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getMondayOf(d: Date): Date {
  const dow = d.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m;
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(d.getDate() + n); return r; }

// ─── Consolidated report builder (one project) ───────────────────────────────
interface EmployeeRow {
  name: string;
  country: string;
  project: string;
  hours: Record<string, number | null>;
  statuses: Record<string, string>;
  rowTotal: number;
}
interface ConsolidatedReport {
  projectName: string;
  projectCode: string;
  weekEndings: string[]; // week_start (Monday) date strings
  partialWeeks: Set<string>;
  employeeRows: EmployeeRow[];
  colTotals: Record<string, number>;
  grandTotal: number;
}

function buildConsolidatedReport(
  project: { id: number; name: string; code: string },
  users: Array<{ id: string; name: string; country: string | null; projectId: number | null; startDate: string | null; endDate: string | null }>,
  timesheets: Array<{ userId: string; weekStart: string; entries: Record<string, unknown>; status: string; projectId: number | null }>,
  projects: Array<{ id: number; name: string; code: string }>,
  monthStart: string,
  monthEnd: string,
): ConsolidatedReport {
  const startD = parseLocalDate(monthStart);
  const endD   = parseLocalDate(monthEnd);

  // Timesheets whose Mon-Sun overlaps the month
  const inRange = timesheets.filter(t => {
    const weekMon = parseLocalDate(t.weekStart);
    const weekSun = addDays(weekMon, 6);
    return weekMon <= endD && weekSun >= startD;
  });

  const weekEndings = [...new Set(inRange.map(t => t.weekStart))].sort();
  const partialWeeks = new Set<string>();
  weekEndings.forEach(we => {
    const weekMon = parseLocalDate(we);
    const weekSun = addDays(weekMon, 6);
    if (weekMon < startD || weekSun > endD) partialWeeks.add(we);
  });

  // Filter users assigned to this project, excluding test accounts
  const projectUsers = users.filter(u => u.projectId === project.id && !isTestAccount(u.name));

  const employeeRows: EmployeeRow[] = projectUsers.map(user => {
    const hours: Record<string, number | null> = {};
    const statuses: Record<string, string> = {};
    let rowTotal = 0;
    weekEndings.forEach(we => {
      const weMonday = parseLocalDate(we);
      const weSunday = addDays(weMonday, 6);
      const weEnd = formatDate(weSunday);
      const ts = inRange.find(t => t.userId === user.id && t.weekStart === we);
      if (ts) {
        // Sum only entries whose date is within the month
        let h = 0;
        Object.entries(ts.entries).forEach(([dateKey, entry]) => {
          const d = parseLocalDate(dateKey);
          if (d >= startD && d <= endD) {
            const raw = typeof entry === 'number' ? entry
              : (entry && typeof entry === 'object' && 'hours' in (entry as Record<string, unknown>))
                ? parseFloat(String((entry as { hours: string }).hours || '0')) || 0
                : 0;
            h += raw;
          }
        });
        hours[we] = h; statuses[we] = ts.status; rowTotal += h;
      } else if (!user.startDate || user.startDate > weEnd || (user.endDate && user.endDate < we)) {
        hours[we] = null; statuses[we] = 'n/a';
      } else {
        hours[we] = null; statuses[we] = 'not submitted';
      }
    });
    const latestTs = inRange.filter(t => t.userId === user.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    const projectRef = projects.find(p => p.id === (latestTs?.projectId ?? user.projectId));
    return {
      name: user.name,
      country: countryName(user.country),
      project: projectRef ? `${projectRef.name} (${projectRef.code})` : 'Not Assigned',
      hours, statuses, rowTotal,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const colTotals: Record<string, number> = {};
  weekEndings.forEach(we => { colTotals[we] = employeeRows.reduce((s, r) => s + (r.hours[we] || 0), 0); });
  const grandTotal = employeeRows.reduce((s, r) => s + r.rowTotal, 0);

  return { projectName: project.name, projectCode: project.code, weekEndings, partialWeeks, employeeRows, colTotals, grandTotal };
}

// ─── HTML renderer (matches the accountant Consolidated view visual) ────────
function renderReportHtml(report: ConsolidatedReport, monthLabel: string): string {
  const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal } = report;

  const partialBanner = partialWeeks.size > 0 ? `
    <tr><td colspan="${3 + weekEndings.length + 1}" style="padding:10px 14px;background:#fffbeb;border:1px solid #fed7aa;color:#b45309;font-size:13px;border-radius:6px">
      <span style="font-weight:700">Partial</span> weeks include only the working days that fall within the selected date range.
    </td></tr>` : '';

  const weekHeaderCells = weekEndings.map(we => {
    const weekMon = parseLocalDate(we);
    const weekSun = addDays(weekMon, 6);
    const isPartial = partialWeeks.has(we);
    const bg    = isPartial ? '#d97706' : '#16a34a';
    const label = isPartial ? 'Partial' : 'W/E';
    const dateStr = weekSun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `<th style="background:${bg};border:1px solid #15803d;padding:8px 12px;color:#fff;text-align:center;white-space:nowrap;font-size:13px">
      <div style="font-size:11px;opacity:.9">${label}</div><div>${dateStr}</div>
    </th>`;
  }).join('');

  const bodyRows = employeeRows.map((row, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    const cells = weekEndings.map(we => {
      const h = row.hours[we];
      const isPartial = partialWeeks.has(we);
      const cellBg = isPartial ? '#fef3c7' : (i % 2 === 0 ? '#f0fdf4' : '#dcfce7');
      const cellColor = isPartial ? '#b45309' : '#166534';
      const display = h == null ? '<span style="color:#9ca3af">–</span>' : h.toFixed(1);
      return `<td style="background:${cellBg};border:1px solid #e5e7eb;padding:8px 12px;text-align:center;color:${cellColor};font-weight:${h != null && h > 0 ? '600' : '400'};font-size:13px">${display}</td>`;
    }).join('');
    const totalCellBg = (i % 2 === 0 ? '#f0fdf4' : '#dcfce7');
    return `<tr>
      <td style="background:${bg};border:1px solid #e5e7eb;padding:8px 12px;font-weight:700;font-size:13px">${escapeHtml(row.name)}</td>
      <td style="background:${bg};border:1px solid #e5e7eb;padding:8px 12px;color:#6b7280;font-size:13px">${escapeHtml(row.country)}</td>
      <td style="background:${bg};border:1px solid #e5e7eb;padding:8px 12px;color:#4f46e5;font-size:12px">${escapeHtml(row.project)}</td>
      ${cells}
      <td style="background:${totalCellBg};border:1px solid #e5e7eb;padding:8px 12px;text-align:center;color:#166534;font-weight:700;font-size:13px">${row.rowTotal.toFixed(1)}</td>
    </tr>`;
  }).join('');

  const totalRow = `<tr style="background:#16a34a;color:#fff">
    <td colspan="3" style="border:1px solid #15803d;padding:10px 12px;font-weight:700;font-size:13px">Total</td>
    ${weekEndings.map(we => {
      const isPartial = partialWeeks.has(we);
      const cellBg = isPartial ? '#d97706' : '#16a34a';
      return `<td style="background:${cellBg};border:1px solid #15803d;padding:10px 12px;text-align:center;font-weight:700;font-size:14px">${colTotals[we].toFixed(1)}</td>`;
    }).join('')}
    <td style="background:#15803d;border:1px solid #14532d;padding:10px 12px;text-align:center;font-weight:700;font-size:14px">${grandTotal.toFixed(1)}</td>
  </tr>`;

  return `
    <h2 style="font-family:system-ui,sans-serif;color:#111;margin:24px 0 12px">
      ${escapeHtml(report.projectName)} <span style="color:#6b7280;font-weight:400;font-size:14px">(${escapeHtml(report.projectCode)}) — ${escapeHtml(monthLabel)}</span>
    </h2>
    <table style="border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;margin-bottom:32px">
      <thead>
        ${partialBanner}
        <tr>
          <th style="background:#16a34a;border:1px solid #15803d;padding:10px 12px;color:#fff;text-align:left;font-size:13px">Employee</th>
          <th style="background:#16a34a;border:1px solid #15803d;padding:10px 12px;color:#fff;text-align:left;font-size:13px">Country</th>
          <th style="background:#16a34a;border:1px solid #15803d;padding:10px 12px;color:#fff;text-align:left;font-size:13px">Project</th>
          ${weekHeaderCells}
          <th style="background:#15803d;border:1px solid #14532d;padding:10px 12px;color:#fff;text-align:center;font-size:13px">Total</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
        ${totalRow}
      </tbody>
    </table>
  `;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Month resolution ────────────────────────────────────────────────────────
// Returns YYYY-MM. Default: current month. Fallback: if the current PT week starts in the prior month, use prior month.
function resolveMonth(override: string | null, nowInPt: Date): string {
  if (override && /^\d{4}-\d{2}$/.test(override)) return override;
  const weekMon = getMondayOf(nowInPt);
  return `${weekMon.getFullYear()}-${String(weekMon.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(monthKey: string): { start: string; end: string; label: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last  = new Date(y, m, 0);
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return { start: formatDate(first), end: formatDate(last), label };
}

// ─── Main handler ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const INGEST_SECRET = Deno.env.get('INGEST_SECRET') ?? '';
  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY') ?? '';
  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const authHeader = req.headers.get('x-ingest-secret') ?? '';
  if (!INGEST_SECRET || authHeader !== INGEST_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const url = new URL(req.url);
  const projectsParam = url.searchParams.get('projects');
  const monthOverride = url.searchParams.get('month');
  const force         = url.searchParams.get('force') === 'true';
  const recipientsParam = url.searchParams.get('to') || DEFAULT_RECIPIENT;
  const recipients = recipientsParam.split(',').map(e => e.trim()).filter(e => e.includes('@'));

  if (!projectsParam) {
    return new Response(JSON.stringify({ ok: false, error: 'missing projects query param' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  // Each project token can be a numeric ID, a code (APFM-061), or a name (APFM). Case-insensitive.
  const projectTokens = projectsParam.split(',').map(s => s.trim()).filter(s => s.length > 0);

  // PT noon Wednesday guard (cron fires at both 19:00 and 20:00 UTC; only the one matching noon PT proceeds)
  const nowUtc = new Date();
  const ptStr  = nowUtc.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric' });
  // Parse PT hour and weekday
  const ptHour = parseInt(nowUtc.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }), 10);
  const ptWeekday = nowUtc.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });
  if (!force) {
    if (ptWeekday !== 'Wed' || ptHour !== 12) {
      return new Response(JSON.stringify({ ok: true, skipped: `not Wed noon PT (weekday=${ptWeekday}, hour=${ptHour})` }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // Compute month bounds in PT context
  const ptDateStr = nowUtc.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [ptM, ptD, ptY] = ptDateStr.split(/\D+/).filter(Boolean).map(Number);
  const nowInPt = new Date(ptY, ptM - 1, ptD);
  const monthKey = resolveMonth(monthOverride, nowInPt);
  const { start: monthStart, end: monthEnd, label: monthLabel } = monthBounds(monthKey);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Fetch all projects, then resolve tokens (id | code | name → row)
  const { data: allProjectRows, error: pErr } = await supabase.from('projects').select('id, name, code, status');
  if (pErr) return errorResponse(pErr.message);
  const allProjects = (allProjectRows ?? []).map(p => ({ id: p.id as number, name: (p.name as string) || '', code: (p.code as string) || '', status: (p.status as string) || '' }));
  const projects: Array<{ id: number; name: string; code: string }> = [];
  const unresolved: string[] = [];
  for (const token of projectTokens) {
    const lower = token.toLowerCase();
    const asId = parseInt(token, 10);
    const match = allProjects.find(p =>
      (Number.isFinite(asId) && p.id === asId)
      || p.code.toLowerCase() === lower
      || p.name.toLowerCase() === lower
    );
    if (match) projects.push({ id: match.id, name: match.name, code: match.code });
    else unresolved.push(token);
  }
  if (projects.length === 0) return errorResponse(`no projects resolved from tokens [${projectTokens.join(', ')}]. Available: ${allProjects.map(p => `${p.name}(${p.code}/#${p.id})`).join(', ')}`);
  if (unresolved.length > 0) console.warn(`Unresolved project tokens skipped: ${unresolved.join(', ')}`);

  const projectIds = projects.map(p => p.id);

  // Fetch users assigned to any of the target projects (and users on OTHER projects — used for reference lookup only in `project` column)
  const { data: userRows, error: uErr } = await supabase.from('profiles').select('id, name, country, project_id, start_date, end_date, role');
  if (uErr) return errorResponse(uErr.message);
  const users = (userRows ?? []).filter(u => u.role === 'timesheetuser').map(u => ({
    id: u.id as string, name: (u.name as string) || '', country: (u.country as string) || null,
    projectId: (u.project_id as number) ?? null,
    startDate: (u.start_date as string) || null, endDate: (u.end_date as string) || null,
  }));

  // Fetch timesheets for any user assigned to a target project. Extended range to catch weeks whose Monday is before month start.
  const userIdsInProjects = users.filter(u => u.projectId != null && projectIds.includes(u.projectId!)).map(u => u.id);
  if (userIdsInProjects.length === 0) return errorResponse('no users found in any of the specified projects');

  const monthStartD = parseLocalDate(monthStart);
  const rangeStartD = addDays(monthStartD, -6); // catch weeks whose Monday is up to 6 days before month start
  const { data: tsRows, error: tErr } = await supabase.from('timesheets')
    .select('user_id, week_start, entries, status, project_id')
    .in('user_id', userIdsInProjects)
    .gte('week_start', formatDate(rangeStartD))
    .lte('week_start', monthEnd);
  if (tErr) return errorResponse(tErr.message);

  const timesheets = (tsRows ?? []).map(t => ({
    userId: t.user_id as string, weekStart: t.week_start as string,
    entries: (t.entries || {}) as Record<string, unknown>, status: (t.status as string) || 'submitted',
    projectId: (t.project_id as number) ?? null,
  }));

  // Build one report per project
  const reports = projects.map(project => buildConsolidatedReport(project, users, timesheets, projects, monthStart, monthEnd));

  // Compose email
  const subject = `[Consolidated Monthly Report] ${projects.map(p => p.name).join(', ')} — ${monthLabel}`;
  const introHtml = `
    <p style="font-family:system-ui,sans-serif;color:#374151;font-size:14px;margin:0 0 20px">
      Consolidated hours for ${projects.length === 1 ? 'project' : 'projects'} <strong>${projects.map(p => `${escapeHtml(p.name)} (${escapeHtml(p.code)})`).join(', ')}</strong> — <strong>${escapeHtml(monthLabel)}</strong>.
    </p>`;
  const html = `<html><body style="margin:0;padding:0;background:#f9fafb"><div style="max-width:1200px;margin:0 auto;padding:24px">
    ${introHtml}
    ${reports.map(r => renderReportHtml(r, monthLabel)).join('')}
    <p style="font-family:system-ui,sans-serif;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:24px">
      ${new Date().toISOString()} · timesheets@mysynergie.net
    </p>
  </div></body></html>`;
  const text = `Consolidated Monthly Report — ${monthLabel}\n\n${reports.map(r => {
    return `${r.projectName} (${r.projectCode})\n${'─'.repeat(60)}\n${r.employeeRows.map(row => `  ${row.name.padEnd(28)} ${row.country.padEnd(18)} ${row.rowTotal.toFixed(1)}h`).join('\n')}\n  Total: ${r.grandTotal.toFixed(1)}h\n`;
  }).join('\n')}\n\n${new Date().toISOString()} · timesheets@mysynergie.net`;

  // Send via Brevo — one Brevo call with multiple `to` addresses
  if (!BREVO_API_KEY) return errorResponse('BREVO_API_KEY not configured');
  const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: FROM,
      to: recipients.map(email => ({ email })),
      subject, textContent: text, htmlContent: html,
    }),
  });

  const brevoBody = await brevoRes.text();
  if (!brevoRes.ok) return errorResponse(`Brevo ${brevoRes.status}: ${brevoBody.slice(0, 300)}`);

  return new Response(JSON.stringify({
    ok: true,
    month: monthKey,
    monthLabel,
    recipients,
    unresolvedProjects: unresolved,
    projects: reports.map(r => ({ name: r.projectName, code: r.projectCode, employees: r.employeeRows.length, totalHours: r.grandTotal, weeks: r.weekEndings.length })),
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});

function errorResponse(msg: string): Response {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
