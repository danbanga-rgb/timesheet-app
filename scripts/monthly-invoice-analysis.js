#!/usr/bin/env node
// Monthly invoice parser analysis — outputs structured report to stdout.
// Intended to be run by Claude Code's monthly cron on the 8th of each month.
// Claude reads this output, fetches PDFs for top candidates, writes regex patterns.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/monthly-invoice-analysis.js [YYYY-MM]

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mimlatvdwxqtgxrgcins.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

// ── Date range ─────────────────────────────────────────────────────────────────
const now = new Date();
const override = process.argv[2]; // optional YYYY-MM argument
let monthStart, monthEnd;
if (override && /^\d{4}-\d{2}$/.test(override)) {
  const [y, m] = override.split('-').map(Number);
  monthStart = new Date(Date.UTC(y, m - 1, 1));
  monthEnd   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
} else {
  monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  monthEnd   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
}
const monthLabel = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`REST ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const startISO = monthStart.toISOString();
  const endISO   = monthEnd.toISOString();

  // All successful invoice log entries for the month
  const logs = await restGet(
    `email_invoice_log?created_at=gte.${startISO}&created_at=lte.${endISO}` +
    `&parse_status=eq.success` +
    `&select=id,from_email,attachment_name,parse_notes,period_start,period_end,raw_extracted,invoice_id,user_id`
  );

  // Bucket by parse method
  const byMethod = {};
  for (const log of logs) {
    const m = log.raw_extracted?.parseMethod || 'unknown';
    byMethod[m] = (byMethod[m] || 0) + 1;
  }

  const aiLogs = logs.filter(l => {
    const m = l.raw_extracted?.parseMethod;
    return m === 'claude_full' || m === 'groq' || m === 'claude_vision';
  });
  const claudeCount = logs.filter(l => l.raw_extracted?.parseMethod === 'claude_full').length;
  const groqCount   = logs.filter(l => l.raw_extracted?.parseMethod === 'groq').length;
  const visionCount = logs.filter(l => l.raw_extracted?.parseMethod === 'claude_vision').length;
  const regexCount  = logs.filter(l => (l.raw_extracted?.parseMethod || '').startsWith('regex')).length;

  // Profile lookup for AI-using contractors
  const uniqueUserIds = [...new Set(aiLogs.map(l => l.user_id).filter(Boolean))];
  const profileMap = {};
  if (uniqueUserIds.length > 0) {
    const profiles = await restGet(
      `profiles?id=in.(${uniqueUserIds.join(',')})&select=id,name,email,invoice_template`
    );
    for (const p of profiles) profileMap[p.id] = p;
  }

  // Group AI logs by contractor
  const byContractor = {};
  for (const log of aiLogs) {
    const key = log.from_email;
    if (!byContractor[key]) {
      const p = profileMap[log.user_id] || {};
      byContractor[key] = { email: key, name: p.name || key, template: p.invoice_template || '?', calls: [] };
    }
    byContractor[key].calls.push(log);
  }
  const contractors = Object.values(byContractor).sort((a, b) => b.calls.length - a.calls.length);

  // ── Output ───────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  console.log(`MONTHLY INVOICE PARSER ANALYSIS: ${monthLabel}`);
  console.log(`${'='.repeat(60)}\n`);

  console.log('SUMMARY');
  console.log(`  Total invoices:  ${logs.length}`);
  console.log(`  Regex (no AI):   ${regexCount} (${pct(regexCount, logs.length)}%)`);
  console.log(`  Claude full:     ${claudeCount} (${pct(claudeCount, logs.length)}%)  ← $`);
  console.log(`  Groq:            ${groqCount} (${pct(groqCount, logs.length)}%)  ← free`);
  console.log(`  Claude vision:   ${visionCount} (${pct(visionCount, logs.length)}%)  ← $ (image PDFs)`);
  console.log(`  Other:           ${logs.length - regexCount - claudeCount - groqCount - visionCount}\n`);

  if (contractors.length === 0) {
    console.log('✅ No AI-assisted invoices last month. Nothing to improve.\n');
    return;
  }

  console.log(`CONTRACTORS NEEDING REGEX PATTERNS (${contractors.length} total, sorted by call count)\n`);

  for (const c of contractors) {
    const latest = c.calls[c.calls.length - 1];
    const rx     = latest.raw_extracted || {};
    const pd     = rx.paymentDetails   || {};
    const hasPayment = !!(pd.iban || pd.swift || pd.accountNumber || pd.routingNumber || pd.sortCode);
    const methods    = [...new Set(c.calls.map(l => l.raw_extracted?.parseMethod).filter(Boolean))].join(', ');
    const invoiceIds = [...new Set(c.calls.map(l => l.invoice_id).filter(Boolean))];

    console.log(`  ── ${c.name} <${c.email}>`);
    console.log(`     Calls:    ${c.calls.length}x  [${methods}]`);
    console.log(`     Period:   ${rx.periodStart || '?'} → ${rx.periodEnd || '?'}`);
    console.log(`     Billing:  ${rx.totalHours != null ? rx.totalHours + 'h' : '—'} @ ${rx.rate != null ? '$' + rx.rate + '/h' : '—'} = ${rx.totalAmount != null ? '$' + rx.totalAmount : '—'} ${rx.currency || ''}`);
    console.log(`     Payment:  ${hasPayment ? 'YES (IBAN/SWIFT/account present)' : 'NO payment block'}`);
    console.log(`     Template: ${c.template}`);
    console.log(`     PDF IDs:  ${invoiceIds.join(', ')} → invoice-attachments/{id}/original.pdf`);
    console.log(`     Regex:    ${hasPayment ? 'Need period+hours+amount+payment block' : 'Need period+hours+amount only (simpler)'}\n`);
  }

  console.log('ACTION');
  console.log(`  1. Focus on claude_full contractors first (actual $cost)`);
  console.log(`  2. For each: GET /storage/v1/object/invoice-attachments/{id}/original.pdf`);
  console.log(`     with service-role key to download PDF, extract text, write regex in`);
  console.log(`     scripts/invoice-parser/parser.js`);
  console.log(`  3. Once regex covers a contractor → their template auto-updates to 'regex'`);
  console.log(`     on next successful parse; Claude never called again for them\n`);

  console.log('RAW EXTRACTED (for regex pattern writing)');
  for (const c of contractors.filter(c => c.calls.some(l => l.raw_extracted?.parseMethod === 'claude_full'))) {
    const latest = c.calls.find(l => l.raw_extracted?.parseMethod === 'claude_full') || c.calls[c.calls.length - 1];
    console.log(`\n  ${c.name}:`);
    console.log('  ' + JSON.stringify(latest.raw_extracted, null, 2).split('\n').join('\n  '));
  }

  console.log(`\n${'='.repeat(60)}\n`);
}

function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0; }

main().catch(e => { console.error(e); process.exit(1); });
