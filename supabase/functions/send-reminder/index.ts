// Supabase Edge Function: send-reminder
//
// Reminder schedule:
//   Timesheet users:  Friday 5pm (local time) first reminder, then daily Mon-Fri 9am
//   Managers:         Daily Mon-Fri 9am — pending timesheet approvals for their team
//   Accountants:      Daily Mon-Fri 9am — pending invoice approvals
//   Skip if nothing pending. Never mix contexts.
//
// Also handles invite emails (action: 'invite')

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const tzMap: Record<string, string> = {
  'US-California': 'America/Los_Angeles', 'US-New York': 'America/New_York',
  'US-Texas': 'America/Chicago', 'US-Florida': 'America/New_York',
  'GB-England': 'Europe/London', 'GB-Scotland': 'Europe/London', 'GB-Wales': 'Europe/London',
  'CA-Ontario': 'America/Toronto', 'CA-Quebec': 'America/Toronto', 'CA-British Columbia': 'America/Vancouver',
  'HR-Croatia': 'Europe/Zagreb', 'RS-Serbia': 'Europe/Belgrade',
  'BA-Bosnia and Herzegovina': 'Europe/Sarajevo', 'SI-Slovenia': 'Europe/Ljubljana',
  'MK-North Macedonia': 'Europe/Skopje',
  'IN-': 'Asia/Kolkata',
  'NL-': 'Europe/Amsterdam',
};

function getUserLocalTime(country: string, region: string): Date {
  const tz = tzMap[`${country}-${region}`] || tzMap[`${country}-`] || 'America/New_York';
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

function formatDate(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function getMissingWeeks(startDate: string, submittedWeeks: Set<string>, localTime: Date, includeCurrentWeek = false): string[] {
  const start = getWeekMonday(parseLocalDate(startDate));
  const thisWeekMonday = getWeekMonday(localTime);
  // On Mon-Thu 9am reminders: only flag weeks fully in the past (stop before this week)
  // On Friday 5pm reminder: also include current week
  const limit = includeCurrentWeek ? thisWeekMonday : (() => {
    const prev = new Date(thisWeekMonday);
    prev.setDate(prev.getDate() - 7);
    return prev;
  })();
  const missing: string[] = [];
  const cursor = new Date(start);
  while (cursor <= limit) {
    const weekKey = formatDate(cursor);
    if (!submittedWeeks.has(weekKey)) missing.push(weekKey);
    cursor.setDate(cursor.getDate() + 7);
  }
  return missing;
}

async function sendEmail(
  apiKey: string, fromEmail: string, fromName: string,
  to: string, toName: string, subject: string, bodyText: string, bodyHtml: string,
  attachments?: Array<{ content: string; name: string }>,
): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to, name: toName }],
    subject, textContent: bodyText, htmlContent: bodyHtml,
  };
  if (attachments && attachments.length > 0) body.attachment = attachments;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return res.ok ? { ok: true } : { ok: false, error: JSON.stringify(data) };
}

function wrapHtml(accentColor: string, headerTitle: string, innerHtml: string, appUrl: string, buttonLabel = 'Open Timesheet App →'): string {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px">
    <div style="background:${accentColor};color:white;padding:20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">${headerTitle}</h2>
    </div>
    <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
      ${innerHtml}
      <div style="margin-top:24px">
        <a href="${appUrl}" style="background:${accentColor};color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">${buttonLabel}</a>
      </div>
      <p style="margin-top:24px;font-size:12px;color:#9ca3af">This is an automated reminder from the Synergie Timesheet System.</p>
    </div>
  </div>`;
}

function currSym(c: string): string {
  return ({ USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' } as Record<string,string>)[c] || '$';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';

  const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
  const FROM_EMAIL    = Deno.env.get('FROM_EMAIL');
  const FROM_NAME     = Deno.env.get('FROM_NAME') || 'Timesheet System';
  const APP_URL       = Deno.env.get('APP_URL') || 'https://time.mysynergie.net';
  const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  if (!BREVO_API_KEY || !FROM_EMAIL) {
    return new Response(JSON.stringify({ error: 'Missing BREVO_API_KEY or FROM_EMAIL' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── INVITE EMAIL ───────────────────────────────────────────────────────────
  let reqBody: Record<string, string> = {};
  try { reqBody = await req.json(); } catch { /* no body */ }

  if (reqBody.action === 'invite') {
    const { toEmail, toName } = reqBody;
    if (!toEmail || !toName) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    // Generate a password-recovery link server-side so no raw password is sent
    const adminClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: toEmail,
      options: { redirectTo: APP_URL },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      return new Response(JSON.stringify({ error: linkErr?.message || 'Failed to generate invite link' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const inviteLink = linkData.properties.action_link;
    const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#4f46e5;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">You're invited to the Timesheet Portal</h2></div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        <p style="color:#374151">Hi ${toName},</p>
        <p style="color:#374151">Your account on the Synergie Timesheet Portal is ready. Click the button below to set your password and log in.</p>
        <div style="margin-top:24px;margin-bottom:24px"><a href="${inviteLink}" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Set Password &amp; Log In →</a></div>
        <p style="color:#6b7280;font-size:13px">This link expires in 24 hours. If you weren't expecting this, you can safely ignore it.</p>
        <p style="margin-top:16px;font-size:12px;color:#9ca3af">Questions? Reply to this email or contact your administrator.</p>
      </div>
    </div>`;
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: toEmail, name: toName }],
        subject: `You're invited to the Synergie Timesheet Portal`,
        htmlContent: html,
        textContent: `Hi ${toName},\n\nYour Synergie Timesheet Portal account is ready. Set your password here:\n${inviteLink}\n\nThis link expires in 24 hours.`,
      }),
    });
    const r = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ error: r }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ sent: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  // ──────────────────────────────────────────────────────────────────────────

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── TIMESHEET SUBMITTED — send per-timesheet approval email to manager ──────
  if (reqBody.action === 'timesheet_submitted') {
    const { timesheetId, timesheetUserName, weekStart, totalHours, projectName, projectCode, managerId, managerName, managerEmail } = reqBody;

    if (!timesheetId || !managerId || !managerEmail) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate signed token and store in DB
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: tokenError } = await supabase.from('email_approval_tokens').insert({
      timesheet_id: parseInt(timesheetId as string),
      manager_id: managerId,
      token,
      expires_at: expiresAt,
      used: false,
    });

    if (tokenError) {
      return new Response(JSON.stringify({ error: 'Failed to create token: ' + tokenError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build week ending date
    const [y, m, d] = (weekStart as string).split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    const weekEndingStr = fri.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const approveUrl = `${APP_URL}?email_action=approve&token=${token}`;
    const rejectUrl  = `${APP_URL}?email_action=reject&token=${token}`;

    const subject = `Timesheet Pending Approval: ${timesheetUserName} — W/E ${fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const bodyText = `Hi ${managerName},

${timesheetUserName} has submitted their timesheet for the week ending ${weekEndingStr}.

Project: ${projectName} (${projectCode})
Total Hours: ${Number(totalHours).toFixed(1)}h

To approve: ${approveUrl}
To reject: ${rejectUrl}

These links are valid for 7 days and are single-use.`;

    const bodyHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">&#x23F1; Timesheet Pending Approval</h2>
      </div>
      <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        <p style="color:#374151">Hi ${managerName},</p>
        <p style="color:#374151"><strong>${timesheetUserName}</strong> has submitted their timesheet for your approval.</p>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Week Ending</td><td style="padding:6px 0;font-weight:600;color:#111827">${weekEndingStr}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Project</td><td style="padding:6px 0;font-weight:600;color:#4f46e5">${projectName} (${projectCode})</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:14px">Total Hours</td><td style="padding:6px 0;font-weight:600;color:#111827">${Number(totalHours).toFixed(1)} hours</td></tr>
          </table>
        </div>
        <p style="color:#374151;font-size:14px">Click a button below to approve or reject this timesheet:</p>
        <div style="display:flex;gap:12px;margin:24px 0">
          <a href="${approveUrl}" style="flex:1;display:inline-block;text-align:center;background:#16a34a;color:white;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">&#x2705; Approve</a>
          <a href="${rejectUrl}" style="flex:1;display:inline-block;text-align:center;background:#dc2626;color:white;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">&#x274C; Reject</a>
        </div>
        <p style="color:#9ca3af;font-size:12px;margin-top:16px">These links are valid for 7 days and can only be used once. If you need to change your decision after using a link, please log in to the app directly.</p>
      </div>
    </div>`;

    const emailRes = await sendEmail(BREVO_API_KEY, FROM_EMAIL, FROM_NAME, managerEmail as string, managerName as string, subject, bodyText, bodyHtml);
    if (!emailRes.ok) {
      return new Response(JSON.stringify({ error: 'Email failed', detail: emailRes.error }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ sent: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── PROCESS EMAIL APPROVAL — validate token and apply approval/rejection ────
  if (reqBody.action === 'process_approval') {
    const { token, decision } = reqBody;

    if (!token || !['approve', 'reject'].includes(decision as string)) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up token
    const { data: tokenRow, error: tokenLookupError } = await supabase
      .from('email_approval_tokens')
      .select('*')
      .eq('token', token)
      .single();

    if (tokenLookupError || !tokenRow) {
      return new Response(JSON.stringify({ ok: false, reason: 'invalid_token' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (tokenRow.used) {
      return new Response(JSON.stringify({ ok: false, reason: 'already_used' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      return new Response(JSON.stringify({ ok: false, reason: 'expired' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch timesheet details for confirmation message
    const { data: tsRow } = await supabase
      .from('timesheets')
      .select('id, user_name, week_start, status')
      .eq('id', tokenRow.timesheet_id)
      .single();

    if (!tsRow) {
      return new Response(JSON.stringify({ ok: false, reason: 'timesheet_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (tsRow.status !== 'pending') {
      return new Response(JSON.stringify({ ok: false, reason: 'already_actioned', current_status: tsRow.status }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected';

    // Apply the decision
    const { error: updateError } = await supabase
      .from('timesheets')
      .update({ status: newStatus, approved_at: new Date().toISOString() })
      .eq('id', tokenRow.timesheet_id);

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, reason: 'update_failed', error: updateError.message }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Mark token as used
    await supabase.from('email_approval_tokens').update({ used: true, used_at: new Date().toISOString() }).eq('token', token);

    const [y, m, d] = (tsRow.week_start as string).split('T')[0].split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    const weekStr = fri.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    return new Response(JSON.stringify({
      ok: true,
      decision: newStatus,
      employee: tsRow.user_name,
      weekEnding: weekStr,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const results: unknown[] = [];

  // Fetch all profiles once
  const { data: allProfiles } = await supabase
    .from('profiles')
    .select('id, name, email, role, country, region, start_date, manager_id, reminders_enabled');
  if (!allProfiles) return new Response(JSON.stringify({ error: 'Failed to fetch profiles' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  // Only remind timesheetusers who have a start_date and have reminders enabled.
  // reminders_enabled defaults to true; only false explicitly opts out.
  const timesheetUsers = allProfiles.filter((p: Record<string,unknown>) =>
    p.role === 'timesheetuser' && p.start_date && p.reminders_enabled !== false
  );
  const managers       = allProfiles.filter((p: Record<string,unknown>) => p.role === 'manager');
  const accountants    = allProfiles.filter((p: Record<string,unknown>) => p.role === 'accountant');

  // ══════════════════════════════════════════════════════════════════════════
  // 1. TIMESHEET USER REMINDERS
  // ══════════════════════════════════════════════════════════════════════════
  for (const user of timesheetUsers) {
    const lt   = getUserLocalTime(user.country as string, user.region as string);
    const dow  = lt.getDay();
    const hour = lt.getHours();

    const isFriday5pm  = dow === 5 && hour >= 17 && hour <= 18;
    const isWeekday9am = dow >= 1 && dow <= 5 && hour >= 9 && hour <= 10;
    if (!force && !isFriday5pm && !isWeekday9am) {
      results.push({ role: 'timesheetuser', user: user.name, action: `skipped (dow=${dow} hour=${hour})` });
      continue;
    }

    const { data: ts } = await supabase.from('timesheets').select('week_start').eq('user_id', user.id).neq('status', 'rejected');
    const submitted = new Set((ts || []).map((t: { week_start: string }) => t.week_start.split('T')[0]));
    const allMissing = getMissingWeeks(user.start_date as string, submitted, lt, isFriday5pm);
    // Only remind for weeks on or after 2026-04-27 (the Monday containing 2026-05-01).
    // Pre-May weeks are backfill and should not generate automated reminders.
    const REMINDER_CUTOFF = '2026-04-27';
    const missing = allMissing.filter(w => w >= REMINDER_CUTOFF);

    if (missing.length === 0) { results.push({ role: 'timesheetuser', user: user.name, action: 'all submitted' }); continue; }

    const isFirst = force ? true : isFriday5pm;
    const weekListText = missing.map(w => {
      const mon = parseLocalDate(w); const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      const isCurrent = formatDate(mon) === formatDate(getWeekMonday(lt));
      return `  \u2022 Week ending ${fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${isCurrent ? ' (current week)' : ''}`;
    }).join('\n');
    const weekListHtml = missing.map(w => {
      const mon = parseLocalDate(w); const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      const isCurrent = formatDate(mon) === formatDate(getWeekMonday(lt));
      return `<li style="margin:6px 0">Week ending <strong>${fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>${isCurrent ? ' <span style="color:#f59e0b;font-size:12px">(current week)</span>' : ''}</li>`;
    }).join('');

    const TIMESHEET_EMAIL = 'timesheets@mysynergie.net';
    const HELPDESK_EMAIL  = 'helpdesk@synergietechsolutions.com';

    const subject = isFirst
      ? `Reminder: ${missing.length} Timesheet${missing.length > 1 ? 's' : ''} Pending`
      : `URGENT: ${missing.length} Timesheet${missing.length > 1 ? 's' : ''} Overdue`;

    const helpdeskLine = isFirst
      ? `First time logging in? Contact ${HELPDESK_EMAIL} for your account password.`
      : `For account access issues, contact ${HELPDESK_EMAIL}.`;

    const bodyText = isFirst
      ? `Hi ${user.name},\n\nJust a heads-up — we're missing your timesheet${missing.length > 1 ? 's' : ''} for:\n\n${weekListText}\n\nYou have a few ways to submit:\n  1. Log into the app: ${APP_URL}\n  2. Reply to this email with your timesheet file attached\n  3. Email your timesheet to ${TIMESHEET_EMAIL}\n\n${helpdeskLine}`
      : `Hi ${user.name},\n\nWe still haven't received your timesheet${missing.length > 1 ? 's' : ''} for:\n\n${weekListText}\n\nPlease submit as soon as possible:\n  1. Log into the app: ${APP_URL}\n  2. Reply to this email with your timesheet file attached\n  3. Email your timesheet to ${TIMESHEET_EMAIL}\n\n${helpdeskLine}`;

    const submitOptionsHtml = `
      <p style="color:#374151;font-weight:600;margin-top:20px">${isFirst ? 'You have a few ways to submit:' : 'Please submit as soon as possible:'}</p>
      <ol style="color:#374151;line-height:2.2;padding-left:20px;margin:0">
        <li>Use the button below to log into the app</li>
        <li>Reply to this email with your timesheet file attached</li>
        <li>Email your timesheet directly to <a href="mailto:${TIMESHEET_EMAIL}" style="color:#4f46e5">${TIMESHEET_EMAIL}</a></li>
      </ol>
      <p style="color:#6b7280;font-size:13px;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:16px">
        ${isFirst
          ? `First time logging in? Contact <a href="mailto:${HELPDESK_EMAIL}" style="color:#4f46e5">${HELPDESK_EMAIL}</a> for your account password.`
          : `For account access issues, contact <a href="mailto:${HELPDESK_EMAIL}" style="color:#4f46e5">${HELPDESK_EMAIL}</a>.`
        }
      </p>`;

    const bodyHtml = wrapHtml(
      isFirst ? '#4f46e5' : '#dc2626',
      isFirst ? '\u23f1 Timesheet Reminder' : '\u26a0\ufe0f Timesheets Overdue',
      `<p style="color:#374151">Hi ${user.name},</p>
       <p style="color:#374151">${isFirst ? `Just a heads-up \u2014 we're missing your timesheet${missing.length > 1 ? 's' : ''} for:` : `We still haven't received your timesheet${missing.length > 1 ? 's' : ''} for:`}</p>
       <ul style="color:#374151;line-height:1.8;padding-left:20px">${weekListHtml}</ul>
       ${submitOptionsHtml}`,
      APP_URL,
      'Submit via App →',
    );

    const r = await sendEmail(BREVO_API_KEY, FROM_EMAIL, FROM_NAME, user.email as string, user.name as string, subject, bodyText, bodyHtml);
    results.push({ role: 'timesheetuser', user: user.name, action: r.ok ? 'email sent' : 'email failed', missing: missing.length, ...(r.error && { error: r.error }) });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. MANAGER REMINDERS — pending timesheet approvals for their team only
  // ══════════════════════════════════════════════════════════════════════════
  for (const manager of managers) {
    const lt   = getUserLocalTime(manager.country as string, manager.region as string);
    const dow  = lt.getDay();
    const hour = lt.getHours();

    if (!force && !(dow >= 1 && dow <= 5 && hour >= 9 && hour <= 10)) {
      results.push({ role: 'manager', user: manager.name, action: `skipped (dow=${dow} hour=${hour}, tz=${(manager.country as string) || 'unknown'}-${(manager.region as string) || 'unknown'})` });
      continue;
    }

    const managedIds = allProfiles
      .filter((p: Record<string,unknown>) => p.manager_id === manager.id)
      .map((p: Record<string,unknown>) => p.id as string);

    if (managedIds.length === 0) { results.push({ role: 'manager', user: manager.name, action: 'no managed users' }); continue; }

    const { data: pending } = await supabase
      .from('timesheets')
      .select('id, user_name, week_start, project_id')
      .in('user_id', managedIds)
      .eq('status', 'pending')
      .order('week_start', { ascending: true });

    if (!pending || pending.length === 0) { results.push({ role: 'manager', user: manager.name, action: 'no pending timesheets' }); continue; }

    const { data: projects } = await supabase.from('projects').select('id, name, code');
    const projMap: Record<number, string> = {};
    (projects || []).forEach((p: { id: number; name: string; code: string }) => { projMap[p.id] = `${p.name} (${p.code})`; });

    const count = pending.length;
    const subject = `Action Required: ${count} Timesheet${count > 1 ? 's' : ''} Awaiting Your Approval`;

    const rowsText = pending.map((t: Record<string,unknown>) => {
      const mon = parseLocalDate((t.week_start as string).split('T')[0]);
      const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      return `  \u2022 ${t.user_name} | W/E ${fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} | ${t.project_id ? (projMap[t.project_id as number] || 'Unknown project') : 'No project'}`;
    }).join('\n');

    const rowsHtml = pending.map((t: Record<string,unknown>) => {
      const mon = parseLocalDate((t.week_start as string).split('T')[0]);
      const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
      const proj = t.project_id ? (projMap[t.project_id as number] || 'Unknown') : 'No project';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827">${t.user_name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151">W/E ${fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6366f1;font-size:13px">${proj}</td>
      </tr>`;
    }).join('');

    const bodyText = `Hi ${manager.name},\n\nYou have ${count} timesheet${count > 1 ? 's' : ''} awaiting your approval:\n\n${rowsText}\n\nPlease log in to review them.`;
    const bodyHtml = wrapHtml(
      '#2563eb', '\u2705 Timesheets Awaiting Approval',
      `<p style="color:#374151">Hi ${manager.name},</p>
       <p style="color:#374151">You have <strong>${count} timesheet${count > 1 ? 's' : ''}</strong> awaiting your approval:</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;background:white;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
         <thead><tr style="background:#2563eb;color:white">
           <th style="padding:10px 12px;text-align:left">Employee</th>
           <th style="padding:10px 12px;text-align:left">Week Ending</th>
           <th style="padding:10px 12px;text-align:left">Project</th>
         </tr></thead>
         <tbody>${rowsHtml}</tbody>
       </table>
       <p style="color:#374151">Please log in to approve or reject them.</p>`,
      APP_URL,
    );

    const r = await sendEmail(BREVO_API_KEY, FROM_EMAIL, FROM_NAME, manager.email as string, manager.name as string, subject, bodyText, bodyHtml);
    results.push({ role: 'manager', user: manager.name, action: r.ok ? 'email sent' : 'email failed', pending: count, ...(r.error && { error: r.error }) });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. ACCOUNTANT REMINDERS — disabled for now; covered by send-timesheet-report
  // ══════════════════════════════════════════════════════════════════════════
  for (const accountant of accountants) {
    results.push({ role: 'accountant', user: accountant.name, action: 'skipped (disabled)' });
    continue;
    const lt   = getUserLocalTime(accountant.country as string, accountant.region as string);
    const dow  = lt.getDay();
    const hour = lt.getHours();

    if (!force && !(dow >= 1 && dow <= 5 && hour === 9)) {
      results.push({ role: 'accountant', user: accountant.name, action: `skipped (dow=${dow} hour=${hour}, tz=${(accountant.country as string) || 'unknown'}-${(accountant.region as string) || 'unknown'})` });
      continue;
    }

    // ── Pending invoices ───────────────────────────────────────────────────
    const { data: pendingInvoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, user_name, period_start, period_end, total_hours, total_amount, currency, submitted_at')
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: true });
    const invCount = pendingInvoices?.length ?? 0;

    // ── Completed weeks since reminder cutoff ──────────────────────────────
    const CUTOFF_W = '2026-04-27';
    const lastCompMon = (() => {
      const d = new Date(lt); d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - 7);
      return formatDate(d);
    })();
    const completedWeeks: string[] = [];
    const wCur = parseLocalDate(CUTOFF_W);
    const wEnd = parseLocalDate(lastCompMon);
    while (wCur <= wEnd) {
      completedWeeks.push(formatDate(wCur));
      wCur.setDate(wCur.getDate() + 7);
    }

    // ── Timesheets for completed weeks (non-rejected) ──────────────────────
    let weekTimesheets: Record<string, unknown>[] = [];
    if (completedWeeks.length > 0) {
      const { data: wts } = await supabase
        .from('timesheets')
        .select('id, user_id, user_name, week_start, status, entries, project_id')
        .in('week_start', completedWeeks)
        .neq('status', 'rejected')
        .order('user_name');
      weekTimesheets = wts || [];
    }

    const { data: projRows } = await supabase.from('projects').select('id, code');
    const projMap: Record<number, string> = {};
    (projRows || []).forEach((p: { id: number; code: string }) => { projMap[p.id] = p.code; });

    const emailById: Record<string, string> = {};
    allProfiles.forEach((p: Record<string, unknown>) => { emailById[p.id as string] = p.email as string; });

    // ── Build per-week sections (only weeks with pending/submitted timesheets) ─
    type WeekSection = { label: string; html: string; text: string; csv: string; csvName: string };
    const weekSections: WeekSection[] = [];

    for (const weekStart of completedWeeks) {
      const weekTs = weekTimesheets.filter(
        (t: Record<string, unknown>) => (t.week_start as string).slice(0, 10) === weekStart
      );
      const hasPending = weekTs.some(
        (t: Record<string, unknown>) => ['pending', 'submitted'].includes(t.status as string)
      );
      if (!hasPending) continue;

      const monDate = parseLocalDate(weekStart);
      const sunDate = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
      const label = `Week ending ${sunDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

      // Day columns Mon–Sun
      const dayDates: Date[] = [];
      for (let i = 0; i < 7; i++) { const d = new Date(monDate); d.setDate(monDate.getDate() + i); dayDates.push(d); }
      const dayKeys   = dayDates.map(d => formatDate(d));
      const dayLabels = dayDates.map(d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

      const approvedCount = weekTs.filter((t: Record<string, unknown>) => t.status === 'approved').length;
      const pendingCount  = weekTs.filter((t: Record<string, unknown>) => ['pending', 'submitted'].includes(t.status as string)).length;

      const csvLines = [`Name,Email,Project,${dayLabels.join(',')},Total,Status`];
      const htmlRows: string[] = [];
      const textRows: string[] = [];

      const sorted = [...weekTs].sort((a, b) => (a.user_name as string).localeCompare(b.user_name as string));
      for (const ts of sorted) {
        const proj = ts.project_id ? (projMap[ts.project_id as number] || '') : '';
        const raw  = ts.entries;
        const entries: Record<string, { hours?: string | number }> =
          typeof raw === 'string' ? JSON.parse(raw as string) : ((raw as Record<string, { hours?: string | number }>) || {});
        const dayHours = dayKeys.map(k => parseFloat(String(entries[k]?.hours || 0)) || 0);
        const total    = dayHours.reduce((s, h) => s + h, 0);
        const email    = emailById[ts.user_id as string] || '';

        csvLines.push(`"${ts.user_name}","${email}","${proj}",${dayHours.map(h => h || '').join(',')},${total.toFixed(1)},"${ts.status}"`);

        const statusLabel = ts.status === 'approved' ? '✅ Approved' : ts.status === 'submitted' ? '⏳ Submitted' : '🕐 Pending';
        const statusColor = ts.status === 'approved' ? '#16a34a'        : ts.status === 'submitted' ? '#2563eb'          : '#f59e0b';
        htmlRows.push(`<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#111827">${ts.user_name}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:#4f46e5;font-size:13px">${proj}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600">${total.toFixed(1)}h</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:${statusColor};font-size:12px;white-space:nowrap">${statusLabel}</td>
        </tr>`);
        textRows.push(`  ${(ts.user_name as string).padEnd(28)}${proj.padEnd(10)}${total.toFixed(1).padStart(6)}h  ${ts.status}`);
      }

      const sunTag = sunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        .replace(',', '').replace(/ /g, '_');
      weekSections.push({
        label,
        html: `<div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <div style="background:#374151;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
            <strong>${label}</strong>
            <span style="font-size:12px;opacity:.8">${approvedCount} approved &middot; ${pendingCount} pending</span>
          </div>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f9fafb">
              <th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">Employee</th>
              <th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">Project</th>
              <th style="padding:7px 10px;text-align:right;font-size:12px;color:#6b7280">Hours</th>
              <th style="padding:7px 10px;text-align:left;font-size:12px;color:#6b7280">Status</th>
            </tr></thead>
            <tbody>${htmlRows.join('')}</tbody>
          </table>
        </div>`,
        text: `${label}:\n${textRows.join('\n')}`,
        csv: csvLines.join('\n'),
        csvName: `timesheets_WE_${sunTag}.csv`,
      });
    }

    if (invCount === 0 && weekSections.length === 0) {
      results.push({ role: 'accountant', user: accountant.name, action: 'nothing to report' });
      continue;
    }

    // ── Assemble invoice HTML/text block ──────────────────────────────────
    let invHtml = '';
    let invText = '';
    if (invCount > 0) {
      const totalAmount = (pendingInvoices || []).reduce((s: number, inv: Record<string, unknown>) => s + Number(inv.total_amount), 0);
      const invRowsHtml = (pendingInvoices || []).map((inv: Record<string, unknown>) => {
        const start = parseLocalDate((inv.period_start as string).split('T')[0]);
        const end   = parseLocalDate((inv.period_end   as string).split('T')[0]);
        const sym   = currSym(inv.currency as string);
        const sub   = inv.submitted_at ? new Date(inv.submitted_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:13px">${inv.invoice_number}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${inv.user_name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#059669">${sym}${Number(inv.total_amount).toFixed(2)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#9ca3af;font-size:12px">${sub}</td>
        </tr>`;
      }).join('');
      invHtml = `<p style="color:#374151;font-weight:600;margin-bottom:8px">Invoices Awaiting Review (${invCount})</p>
        <table style="width:100%;border-collapse:collapse;background:white;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
          <thead><tr style="background:#059669;color:white">
            <th style="padding:10px 12px;text-align:left">Invoice #</th>
            <th style="padding:10px 12px;text-align:left">Employee</th>
            <th style="padding:10px 12px;text-align:left">Period</th>
            <th style="padding:10px 12px;text-align:left">Amount</th>
            <th style="padding:10px 12px;text-align:left">Submitted</th>
          </tr></thead>
          <tbody>${invRowsHtml}</tbody>
          <tfoot><tr style="background:#f0fdf4">
            <td colspan="3" style="padding:10px 12px;font-weight:700">Total (${invCount} invoice${invCount > 1 ? 's' : ''})</td>
            <td style="padding:10px 12px;font-weight:700;color:#059669">$${totalAmount.toFixed(2)}</td><td></td>
          </tr></tfoot>
        </table>`;
      invText = (pendingInvoices || []).map((inv: Record<string, unknown>) => {
        const start = parseLocalDate((inv.period_start as string).split('T')[0]);
        const end   = parseLocalDate((inv.period_end   as string).split('T')[0]);
        const sym   = currSym(inv.currency as string);
        const sub   = inv.submitted_at ? new Date(inv.submitted_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
        return `  • ${inv.invoice_number} | ${inv.user_name} | ${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}–${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} | ${sym}${Number(inv.total_amount).toFixed(2)} | Submitted ${sub}`;
      }).join('\n');
    }

    const subjectParts = [
      invCount > 0            ? `${invCount} Invoice${invCount > 1 ? 's' : ''} Awaiting Review`                             : '',
      weekSections.length > 0 ? `${weekSections.length} Week${weekSections.length > 1 ? 's' : ''} Pending Timesheets` : '',
    ].filter(Boolean);

    const bodyText = [
      `Hi ${accountant.name},`,
      invCount > 0 ? `INVOICES AWAITING REVIEW (${invCount}):\n${invText}` : '',
      weekSections.length > 0 ? `TIMESHEET SUMMARY BY WEEK:\n\n${weekSections.map(s => s.text).join('\n\n')}\n\n(CSV files attached for each week with pending timesheets)` : '',
    ].filter(Boolean).join('\n\n');

    const bodyHtml = wrapHtml(
      '#059669', '📄 Timesheet & Invoice Report',
      `<p style="color:#374151">Hi ${accountant.name},</p>
       ${invHtml}
       ${weekSections.length > 0 ? `
         <p style="color:#374151;font-weight:600;margin-top:${invCount > 0 ? '32px' : '0'};margin-bottom:4px">Timesheet Summary by Week</p>
         <p style="color:#6b7280;font-size:13px;margin-top:0">CSV files for each week with pending timesheets are attached.</p>
         ${weekSections.map(s => s.html).join('')}
       ` : ''}`,
      APP_URL,
    );

    const attachments = weekSections.map(s => {
      const bytes = new TextEncoder().encode(s.csv);
      let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
      return { content: btoa(bin), name: s.csvName };
    });

    const r = await sendEmail(
      BREVO_API_KEY, FROM_EMAIL, FROM_NAME,
      accountant.email as string, accountant.name as string,
      subjectParts.join(' · '), bodyText, bodyHtml,
      attachments.length > 0 ? attachments : undefined,
    );
    results.push({ role: 'accountant', user: accountant.name, action: r.ok ? 'email sent' : 'email failed', pendingInvoices: invCount, weekSections: weekSections.length, ...(r.error && { error: r.error }) });
  }

  return new Response(JSON.stringify({ results }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
