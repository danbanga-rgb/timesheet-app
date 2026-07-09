#!/usr/bin/env node
// Retrospective invoice shadow parse: runs Groq vision + independent signals
// against last 3 months of invoices, compares to live DB, writes to parser_shadow_log.
//
// Uses existing groqVisionExtractInvoice + PDF rendering pipeline from poller.
// Zero production impact — only READ from invoices/storage, WRITE to shadow log.

const https  = require('https');
const path   = require('path');
const fs     = require('fs');

const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.error('Missing SUPABASE_PAT in scripts/poller/.env — see reference-supabase-pat memory for the value'); process.exit(1); }
const PROJECT_REF = 'mimlatvdwxqtgxrgcins';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

// Load .env from scripts/poller for keys (use poller's node_modules copy)
require(path.join(__dirname, '../../poller/node_modules/dotenv')).config({ path: path.join(__dirname, '../../poller/.env') });
const GROQ_KEY = process.env.GROQ_API_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLAUDE_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
const BREVO_KEY = process.env.BREVO_API_KEY;

if (!GROQ_KEY)    { console.error('Missing GROQ_API_KEY'); process.exit(1); }
if (!SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

// ─── DB helper ────────────────────────────────────────────────────────────────
function pgQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Storage download ─────────────────────────────────────────────────────────
function downloadPdf(pathInBucket) {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/storage/v1/object/invoice-attachments/${pathInBucket}`;
    https.get(url, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY },
    }, res => {
      if (res.statusCode !== 200) return reject(new Error(`Storage ${res.statusCode} for ${pathInBucket}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// ─── PDF → JPEG rendering (matches poller invoice-vision pipeline) ───────────
const { createCanvas, Image } = require(path.join(__dirname, '../../poller/node_modules/@napi-rs/canvas'));
globalThis.Image = Image;
let _pdfjsLib = null;
async function getPdfjs() {
  if (_pdfjsLib) return _pdfjsLib;
  _pdfjsLib = await import(path.join(__dirname, '../../poller/node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  return _pdfjsLib;
}

async function renderPdfFirstPageJpeg(pdfBuffer) {
  const pdfjs = await getPdfjs();
  const uint8 = new Uint8Array(pdfBuffer);
  const doc   = await pdfjs.getDocument({ data: uint8 }).promise;
  const page  = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx    = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.encode('jpeg', 85);
}

// ─── Groq vision extraction ───────────────────────────────────────────────────
// Prompt v2 (2026-07-08 pm) — retrospective revealed most "critical" disagreements
// were Groq confusing INVOICE DATE (top of doc) with BILLING PERIOD (work rendered).
// Added rules 1a (invoice-date-vs-billing-period), 1b (year hallucination guard),
// tightened rule 6 (month-long periods, no single-day when ambiguous).
const GROQ_INVOICE_PROMPT = `You are extracting invoice data from an image. Return EXACTLY one JSON object on a single line, no markdown, no explanation.

TARGET SCHEMA:
{"contractor_name":"","period_start":"YYYY-MM-DD","period_end":"YYYY-MM-DD","total_hours":0,"rate":0,"total_amount":0,"currency":"USD","invoice_number":"","payment_details":{"iban":"","swift":"","bank_name":"","company_name":""},"safeguards_applied":[],"confidence":"high","conflicts":[]}

CRITICAL PARSING RULES — apply BEFORE returning. Note in "safeguards_applied" which you used:

1a. **INVOICE DATE ≠ BILLING PERIOD.** This is the most important rule.
    The date at the top of the invoice (labeled "Invoice Date", "Date of Issue", "Date", or shown next to the invoice number) is WHEN the invoice was issued — NOT the services period.
    Contractors typically invoice in month N+1 for services rendered in month N.
    Example: "Invoice Date: 07/05/2026" with description "Software development services" and no other period info → the BILLING PERIOD IS JUNE 2026, not July.
    Look for explicit "Period", "Billing Period", "Service Period", "For services rendered", "Timesheet for [month]", or column headers with dates. THAT is the billing period.
    Only fall back to (invoice date - 1 month) if no explicit period is stated.

1b. **NEVER INVENT A YEAR.** If a year isn't clearly stated on the invoice or in the filename, use the year context from other dates you see in the document. If the invoice shows only "May" with no year, and you see "2026" elsewhere on the doc, use 2026. Never output a year that has no textual basis. When unsure, prefer the current-invoice year visible on the doc.

2. FILENAME AS SECONDARY SIGNAL.
   The filename often clarifies the billing period (e.g. "Invoice_June_2026.pdf" → June 2026, "05_2026" → May 2026, "Timesheet 22-28 June - name.xlsx" → June).
   If the filename contains a clear month/year AND the invoice content is ambiguous, use the filename.
   BUT be careful: some invoice numbers use digits that LOOK like months but are just sequence numbers.
   - "INV 4/1/1" → probably "4th invoice, version 1" — NOT April. Do NOT extract month from this.
   - "INV 7-1-1" → probably 7th invoice — NOT July.
   - "INV 002/07/2026" → contains YYYY, so 07/2026 IS a date reference (July 2026 issue date — remember rule 1a).
   - "INV NT-207bdc" → hash-style, no month info at all.
   Only treat digits as month if they're paired with a valid year (like "07/2026") OR the filename has an unambiguous month name.

3. CURRENCY: EUR shown does not mean EUR billing.
   Many EU contractors' templates show EUR totals prominently but bill in USD.
   If you see any "USD per hour," "TOTAL USD," "$" prefix, or a rate that's a clean USD-like whole number (25, 30, 35, 45, 50, 75), use currency=USD and the USD amount.

4. CLEAN RATE PREFERENCE + AMOUNT SNAP.
   If total_amount ÷ total_hours produces 24.997 or 25.003 or similar, use rate = 25 (whole number).
   Rates are almost always whole dollars (20, 25, 30, 35, 45, 50, 55, 65, 75, 100). Never fractional cents.
   Also sanity-check: rate × hours ≈ total_amount (within 2%). If not, one of the three fields is wrong — flag in conflicts.

5. DATE FORMAT DD/MM vs MM/DD:
   European contractors use DD/MM/YYYY. US/QuickBooks uses MM/DD/YYYY.
   If a date parses to > 14 days in the future OR the day > 12, it's DD/MM.
   Look at OTHER dates on the invoice to identify the format used. Be consistent across the whole document.

6. VALID DATES ONLY.
   Return null for any date that's invalid (like "2026-06-39" or "2026-13-05"). Do not guess.

7. FULL-MONTH BILLING PERIODS ARE THE DEFAULT.
   Most contractor invoices bill for a full calendar month of work.
   If the invoice covers a full month (any of: "May 2026", "01/06/2026 to 30/06/2026", "June services", monthly-timesheet context, or ~4 weeks of daily hours listed),
   set period_start = first day of month, period_end = last day of that month.
   **DO NOT use single-day periods** like "2026-07-06 to 2026-07-06" unless the invoice EXPLICITLY bills one day (rare, e.g., "for services rendered on 2026-07-06").
   If unsure, expand to the full month.

8. MULTI-CONTRACTOR BILLS (Teal Crossroads, Cloudygon, TJ Consultancy pattern):
   If the invoice lists MULTIPLE contractors with individual line totals, that's a multi-contractor bill.
   Set is_multi_contractor=true and return the CONTRACTOR LINE SUB-TOTALS in a "contractors" array like:
   "contractors": [{"name":"", "hours":N, "rate":N, "amount":N}, ...]
   total_amount should still be the sum for the whole bill.

confidence=high only if you'd bet money on every field. Otherwise medium or low.
conflicts=short strings describing ambiguities you couldn't fully resolve.
Missing field → JSON null, not empty string, not 0.`;

async function groqVisionExtract(jpegBuffer, filename) {
  const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
  const body = {
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      { role: 'system', content: GROQ_INVOICE_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: `Filename: ${filename}\nExtract the invoice fields as JSON.` },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ],
    max_tokens: 800,
    temperature: 0,
    response_format: { type: 'json_object' },
  };

  const res = await new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => resolve({ status: r.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });

  if (res.status !== 200) throw new Error(`Groq ${res.status}: ${res.body.slice(0, 200)}`);
  const parsed = JSON.parse(res.body);
  const content = parsed.choices?.[0]?.message?.content?.trim() || '';
  try { return JSON.parse(content); }
  catch (e) { throw new Error(`Groq returned non-JSON: ${content.slice(0, 200)}`); }
}

// ─── Independent signals from meta ────────────────────────────────────────────
const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function extractSignals(inv, filename) {
  const signals = {};
  const name = (filename || '').toLowerCase();

  // Filename date signals
  const m1 = name.match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (m1) signals.filename_month = MONTH_MAP[m1[2].toLowerCase()] + 1;
  const m2 = name.match(/(20\d{2})-(\d{2})-(\d{2})/);
  if (m2) signals.filename_iso_date = `${m2[1]}-${m2[2]}-${m2[3]}`;
  const m3 = name.match(/(\d{2})\.(\d{2})\.(20\d{2})/);
  if (m3) signals.filename_dotted_date = `${m3[3]}-${m3[2]}-${m3[1]}`;

  // DB context
  signals.db_period_start = inv.period_start;
  signals.db_period_end = inv.period_end;
  signals.db_total_amount = inv.total_amount != null ? Number(inv.total_amount) : null;
  signals.db_total_hours = inv.total_hours != null ? Number(inv.total_hours) : null;
  signals.db_rate = inv.rate != null ? Number(inv.rate) : null;
  signals.db_currency = inv.currency;
  signals.db_status = inv.status;

  return signals;
}

// ─── Comparison + severity ────────────────────────────────────────────────────
function compareInvoice(prod, shadow) {
  const cmp = (a, b, tolerance = 0.005) => {
    if (a == null && b == null) return 'both_null';
    if (a == null) return 'prod_null_shadow_has';
    if (b == null) return 'prod_has_shadow_null';
    if (typeof a === 'number' && typeof b === 'number') {
      return Math.abs(a - b) / Math.max(1, Math.abs(a)) < tolerance ? 'agree' : 'disagree';
    }
    return String(a) === String(b) ? 'agree' : 'disagree';
  };
  const agreement = {
    period_start: cmp(prod.period_start, shadow.period_start),
    period_end:   cmp(prod.period_end,   shadow.period_end),
    total_hours:  cmp(Number(prod.total_hours ?? null), shadow.total_hours),
    rate:         cmp(Number(prod.rate ?? null), shadow.rate),
    total_amount: cmp(Number(prod.total_amount ?? null), shadow.total_amount, 0.01),
    currency:     cmp(prod.currency, shadow.currency),
  };

  // Severity
  const critical = ['period_start', 'period_end', 'total_amount'].some(f => agreement[f] === 'disagree');
  const medium   = ['total_hours', 'rate'].some(f => agreement[f] === 'disagree');
  const nullDiff = Object.values(agreement).some(v => v.includes('_null_') || v.includes('_null'));
  let severity = 'none';
  if (critical) severity = 'critical';
  else if (medium) severity = 'medium';
  else if (nullDiff) severity = 'low';
  else if (Object.values(agreement).every(v => v === 'agree' || v === 'both_null')) severity = 'none';

  const summary = Object.entries(agreement)
    .filter(([, v]) => v !== 'agree' && v !== 'both_null')
    .map(([k, v]) => `${k}: ${v} (prod=${prod[k]}, shadow=${shadow[k]})`)
    .join(' | ') || 'all fields agree';

  return { agreement, severity, summary };
}

// ─── Alert (Brevo) ────────────────────────────────────────────────────────────
async function sendAlert(subject, body) {
  if (!BREVO_KEY) { console.warn('BREVO_API_KEY missing — alert skipped'); return; }
  const payload = JSON.stringify({
    sender: { name: 'Parser Shadow', email: 'timesheets@mysynergie.net' },
    to: [{ email: 'dbanga@synergietechsolutions.com', name: 'Dan' }],
    subject,
    textContent: body,
  });
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => { r.on('data', () => {}); r.on('end', resolve); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Shadow log writer ────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/'/g, "''"); }
async function writeShadowLog(row) {
  const cols = ['kind', 'source', 'reference_id', 'file_path', 'filename', 'prod_result', 'shadow_result', 'signals', 'agreement', 'disagreement_severity', 'disagreement_summary'];
  const vals = [
    `'${row.kind}'`,
    `'${row.source}'`,
    row.reference_id ?? 'NULL',
    row.file_path ? `'${esc(row.file_path)}'` : 'NULL',
    row.filename ? `'${esc(row.filename)}'` : 'NULL',
    `'${esc(JSON.stringify(row.prod_result))}'::jsonb`,
    `'${esc(JSON.stringify(row.shadow_result))}'::jsonb`,
    `'${esc(JSON.stringify(row.signals))}'::jsonb`,
    `'${esc(JSON.stringify(row.agreement))}'::jsonb`,
    `'${row.disagreement_severity}'`,
    row.disagreement_summary ? `'${esc(row.disagreement_summary)}'` : 'NULL',
  ];
  const sql = `INSERT INTO parser_shadow_log (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id`;
  const r = await pgQuery(sql);
  return r[0]?.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const MONTHS = 3;
  const arg = process.argv[2] || '5';
  // Support "--ids=140,151,168" for targeted reruns of specific invoices
  const idsMatch = arg.match(/^--ids=([\d,]+)$/);
  const targetIds = idsMatch ? idsMatch[1].split(',').map(Number) : null;
  const LIMIT = targetIds ? targetIds.length : parseInt(arg, 10);

  console.log(`\n═══ Retrospective invoice shadow parse ═══`);
  if (targetIds) console.log(`  Targeting IDs: ${targetIds.join(', ')}`);
  else {
    console.log(`  Lookback:      ${MONTHS} months`);
    console.log(`  Limit:         ${LIMIT} invoices`);
  }
  console.log();

  // Fetch invoices — either by target IDs or by lookback window
  // Multi-contractor invoices (Teal Crossroads etc.) are skipped: their PDF is one
  // bill but prod stores per-contractor split rows; shadow can't fairly compare.
  const invoices = targetIds
    ? await pgQuery(`
        SELECT id, invoice_number, user_id, user_name, period_start, period_end,
               total_hours, rate, total_amount, currency, status, attachment_path
        FROM invoices
        WHERE id IN (${targetIds.join(',')}) AND attachment_path IS NOT NULL
        ORDER BY id`)
    : await pgQuery(`
        SELECT id, invoice_number, user_id, user_name, period_start, period_end,
               total_hours, rate, total_amount, currency, status, attachment_path
        FROM invoices
        WHERE attachment_path IS NOT NULL
          AND group_key IS NULL   -- skip multi-contractor umbrella bills
          AND period_end >= (CURRENT_DATE - INTERVAL '${MONTHS} months')
        ORDER BY period_end DESC
        LIMIT ${LIMIT}`);

  console.log(`  Fetched:       ${invoices.length} invoices\n`);

  let criticalCount = 0;
  const results = { none: 0, low: 0, medium: 0, critical: 0, error: 0 };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let idx = 0;
  for (const inv of invoices) {
    idx++;
    if (idx > 1) await sleep(10000); // ~6 req/min throttle — safe for Groq free tier vision model
    const filename = path.basename(inv.attachment_path);
    process.stdout.write(`  #${inv.id} ${inv.user_name.padEnd(24).slice(0,24)} ${(inv.invoice_number||'').slice(0,20).padEnd(20)} → `);
    try {
      const pdfBuf   = await downloadPdf(inv.attachment_path);
      const jpegBuf  = await renderPdfFirstPageJpeg(pdfBuf);
      const shadow   = await groqVisionExtract(jpegBuf, filename);
      const signals  = extractSignals(inv, filename);
      const cmp      = compareInvoice(inv, shadow);
      const id = await writeShadowLog({
        kind: 'invoice',
        source: 'retrospective',
        reference_id: inv.id,
        file_path: inv.attachment_path,
        filename,
        prod_result: {
          period_start: inv.period_start,
          period_end:   inv.period_end,
          total_hours:  Number(inv.total_hours ?? 0),
          rate:         Number(inv.rate ?? 0),
          total_amount: Number(inv.total_amount ?? 0),
          currency:     inv.currency,
        },
        shadow_result: shadow,
        signals,
        agreement: cmp.agreement,
        disagreement_severity: cmp.severity,
        disagreement_summary:  cmp.summary,
      });
      results[cmp.severity]++;
      if (cmp.severity === 'critical') criticalCount++;
      const badge = { none: '✅', low: '·', medium: '⚠', critical: '🚨', error: '❌' }[cmp.severity];
      console.log(`${badge} ${cmp.severity}  (log #${id})  ${cmp.summary.slice(0, 80)}`);
    } catch (e) {
      results.error++;
      console.log(`❌ ${e.message.slice(0, 100)}`);
    }
  }

  console.log(`\n═══ Summary ═══`);
  console.log(`  ✅ Agree:      ${results.none}`);
  console.log(`  · Low diff:    ${results.low}`);
  console.log(`  ⚠  Medium:     ${results.medium}`);
  console.log(`  🚨 Critical:   ${results.critical}`);
  console.log(`  ❌ Errors:     ${results.error}\n`);

  if (criticalCount > 0) {
    console.log(`Sending alert for ${criticalCount} critical disagreements...`);
    await sendAlert(
      `[Parser Shadow] ${criticalCount} critical disagreement(s) in retrospective run`,
      `Retrospective shadow parse of ${invoices.length} invoices from last ${MONTHS} months found ${criticalCount} critical disagreements between production parser and Groq vision.\n\nReview: SELECT * FROM parser_shadow_log WHERE source='retrospective' AND disagreement_severity='critical' ORDER BY at DESC;\n\nTotal: agree ${results.none}, low ${results.low}, medium ${results.medium}, critical ${results.critical}, errors ${results.error}`
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
