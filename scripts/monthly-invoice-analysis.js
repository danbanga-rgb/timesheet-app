#!/usr/bin/env node
// Monthly invoice parser analysis — runs on the 8th of each month via GitHub Actions.
// Queries last month's email_invoice_log for claude_full/groq calls, groups by contractor,
// and emails a structured report so regex patterns can be written to cut Claude spend.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mimlatvdwxqtgxrgcins.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BREVO_KEY    = process.env.BREVO_API_KEY;
const TO_EMAIL     = process.env.REPORT_TO_EMAIL || 'danbanga@gmail.com';
const FROM_EMAIL   = process.env.FROM_EMAIL      || 'timesheets@mysynergie.net';
const FROM_NAME    = process.env.FROM_NAME       || 'Synergie Timesheet System';

if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1); }
if (!BREVO_KEY)    { console.error('BREVO_API_KEY missing'); process.exit(1); }

// ── Date range: previous calendar month (or MONTH_OVERRIDE=YYYY-MM) ───────────
const now = new Date();
let monthStart, monthEnd;
const override = process.env.MONTH_OVERRIDE; // e.g. "2026-05"
if (override && /^\d{4}-\d{2}$/.test(override)) {
  const [y, m] = override.split('-').map(Number);
  monthStart = new Date(Date.UTC(y, m - 1, 1));
  monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
} else {
  monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
}
const monthLabel = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ── REST helper ───────────────────────────────────────────────────────────────
async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Analysing invoice parse calls for ${monthLabel}…`);

  // 1. Fetch all successful invoice log entries from last month
  const startISO = monthStart.toISOString();
  const endISO   = monthEnd.toISOString();
  const logs = await restGet(
    `email_invoice_log?created_at=gte.${startISO}&created_at=lte.${endISO}` +
    `&parse_status=eq.success` +
    `&select=id,from_email,attachment_name,parse_notes,period_start,period_end,raw_extracted,invoice_id,user_id`
  );
  console.log(`  Total successful invoice logs: ${logs.length}`);

  // 2. Filter for AI-assisted parses (claude_full, groq) — these are the ones worth improving
  const aiLogs = logs.filter(l => {
    const m = l.raw_extracted?.parseMethod;
    return m === 'claude_full' || m === 'groq' || m === 'claude_vision';
  });
  const regexLogs = logs.filter(l => {
    const m = l.raw_extracted?.parseMethod || '';
    return m.startsWith('regex');
  });
  console.log(`  AI-assisted: ${aiLogs.length}, Regex: ${regexLogs.length}, Other: ${logs.length - aiLogs.length - regexLogs.length}`);

  if (aiLogs.length === 0) {
    console.log('No AI-assisted invoices last month — nothing to report.');
    await sendEmail(buildNoActionEmail(monthLabel, logs.length), monthLabel, 0);
    return;
  }

  // 3. Look up profile names + current template for each contractor
  const uniqueUserIds = [...new Set(aiLogs.map(l => l.user_id).filter(Boolean))];
  let profileMap = {};
  if (uniqueUserIds.length > 0) {
    const profiles = await restGet(
      `profiles?id=in.(${uniqueUserIds.join(',')})&select=id,name,email,invoice_template`
    );
    for (const p of profiles) profileMap[p.id] = p;
  }

  // 4. Group by contractor
  const byContractor = {};
  for (const log of aiLogs) {
    const email = log.from_email;
    if (!byContractor[email]) {
      const profile = profileMap[log.user_id] || {};
      byContractor[email] = {
        email,
        name:             profile.name  || email,
        invoice_template: profile.invoice_template || 'unknown',
        calls:            [],
      };
    }
    byContractor[email].calls.push(log);
  }

  // 5. Sort by call count descending (most Claude-heavy first)
  const contractors = Object.values(byContractor).sort((a, b) => b.calls.length - a.calls.length);

  // 6. Build and send email
  const html = buildReportHtml(monthLabel, logs.length, regexLogs.length, aiLogs.length, contractors);
  await sendEmail(html, monthLabel, contractors.length);
  console.log(`Report sent for ${contractors.length} contractors.`);
}

// ── Email builder ─────────────────────────────────────────────────────────────
function buildReportHtml(month, total, regexCount, aiCount, contractors) {
  const pct = total > 0 ? Math.round((aiCount / total) * 100) : 0;

  const contractorRows = contractors.map(c => {
    const latest       = c.calls[c.calls.length - 1];
    const rx           = latest.raw_extracted || {};
    const pd           = rx.paymentDetails   || {};
    const hasPayment   = !!(pd.iban || pd.swift || pd.accountNumber || pd.routingNumber);
    const methods      = [...new Set(c.calls.map(l => l.raw_extracted?.parseMethod).filter(Boolean))].join(', ');
    const invoiceIds   = [...new Set(c.calls.map(l => l.invoice_id).filter(Boolean))].join(', ');
    const regexHint    = hasPayment
      ? 'Regex + payment block needed'
      : 'Regex only (no payment section)';

    return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${c.name}</strong><br><small style="color:#666">${c.email}</small></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${c.calls.length}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${methods}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">
        ${rx.periodStart || '?'} → ${rx.periodEnd || '?'}<br>
        ${rx.totalHours != null ? rx.totalHours + 'h' : '—'} @ ${rx.rate != null ? '$' + rx.rate : '—'} = ${rx.totalAmount != null ? '$' + rx.totalAmount : '—'} ${rx.currency || ''}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${hasPayment ? '✅ Yes' : '❌ No'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;font-size:12px">${regexHint}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#888">Invoice IDs: ${invoiceIds || '—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:900px;margin:0 auto;padding:20px">
  <h2 style="color:#1a73e8">📊 Invoice Parser Monthly Review — ${month}</h2>

  <table style="border-collapse:collapse;margin-bottom:24px">
    <tr>
      <td style="padding:8px 20px 8px 0"><strong>Total invoices processed</strong></td>
      <td style="padding:8px 0"><strong>${total}</strong></td>
    </tr>
    <tr>
      <td style="padding:8px 20px 8px 0">Handled by regex (no AI)</td>
      <td>${regexCount} (${total > 0 ? Math.round((regexCount / total) * 100) : 0}%)</td>
    </tr>
    <tr>
      <td style="padding:8px 20px 8px 0;color:#d32f2f">Needed AI (Claude/Groq) ⚠️</td>
      <td style="color:#d32f2f"><strong>${aiCount} (${pct}%)</strong></td>
    </tr>
  </table>

  <h3 style="margin-top:0">Contractors that need regex patterns added</h3>
  <p style="color:#555;font-size:14px">Sorted by number of AI calls. Adding regex patterns for these contractors will eliminate their Claude spend.</p>

  <table style="border-collapse:collapse;width:100%;font-size:14px">
    <thead>
      <tr style="background:#f5f5f5">
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Contractor</th>
        <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #ddd">Calls</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Parse method</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">What was extracted</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Payment block</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Regex approach</th>
        <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #ddd">Invoice IDs</th>
      </tr>
    </thead>
    <tbody>${contractorRows}</tbody>
  </table>

  <hr style="margin:32px 0;border:none;border-top:1px solid #eee">
  <h3>What to do</h3>
  <ol style="color:#444;line-height:1.8">
    <li>Open a Claude Code session in <code>timesheet-app</code></li>
    <li>For each contractor above, pull their PDF from Supabase Storage (<code>invoice-attachments/{invoice_id}/original.pdf</code>) and review the layout</li>
    <li>Add regex patterns in <code>scripts/invoice-parser/parser.js</code> — targeting period, hours, rate, total, and (if applicable) payment details</li>
    <li>Commit and push — <code>profiles.invoice_template</code> will auto-update to <code>regex</code> on the next successful parse, eliminating future AI calls for that contractor</li>
  </ol>

  <p style="color:#888;font-size:12px;margin-top:32px">Generated by monthly-invoice-analysis.js on ${new Date().toISOString()}</p>
</body></html>`;
}

function buildNoActionEmail(month, total) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#222;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#2e7d32">✅ Invoice Parser Monthly Review — ${month}</h2>
  <p>All <strong>${total}</strong> invoices processed last month were handled by regex — no AI calls needed.</p>
  <p style="color:#888;font-size:12px">Generated by monthly-invoice-analysis.js on ${new Date().toISOString()}</p>
</body></html>`;
}

// ── Email sender ──────────────────────────────────────────────────────────────
async function sendEmail(html, month, contractorCount) {
  const subject = contractorCount > 0
    ? `📊 Invoice Parser Review — ${month} | ${contractorCount} contractor(s) need regex attention`
    : `✅ Invoice Parser Review — ${month} | All regex, no AI calls`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender:  { email: FROM_EMAIL, name: FROM_NAME },
      to:      [{ email: TO_EMAIL }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo send failed ${res.status}: ${body}`);
  }
  console.log(`Email sent: "${subject}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
