'use strict';

// Batch invoice ingestion — two phases:
//   Phase 1: IMAP re-scan (all emails, or since --since date)
//   Phase 2: local PDF folder (default: ../invoice-parser/samples/)
//
// Usage:
//   node ingest-batch.js
//   node ingest-batch.js --since 2026-01-01
//   node ingest-batch.js --samples-dir /path/to/pdfs
//   node ingest-batch.js --dry-run          # parse only, no DB writes
//   node ingest-batch.js --skip-imap        # local samples only
//   node ingest-batch.js --skip-samples     # IMAP only
//
// .env (scripts/poller/.env):
//   IMAP_USER, IMAP_PASS, IMAP_HOST, IMAP_PORT
//   ANTHROPIC_API_KEY
//   INVOICE_INGEST_URL   (edge function URL)
//   INGEST_SECRET

require('dotenv').config();

const Imap             = require('imap');
const { simpleParser } = require('mailparser');
const https            = require('https');
const http             = require('http');
const fs               = require('fs');
const path             = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const dryRun      = args.includes('--dry-run');
const skipImap    = args.includes('--skip-imap');
const skipSamples = args.includes('--skip-samples');

const sinceArg    = args[args.indexOf('--since') + 1];
const sinceDate   = sinceArg ? new Date(sinceArg) : null;

const samplesArg  = args[args.indexOf('--samples-dir') + 1];
const SAMPLES_DIR = samplesArg
  ? path.resolve(samplesArg)
  : path.resolve(__dirname, '../invoice-parser/samples');

const CONFIG = {
  imapUser:     process.env.IMAP_USER     || 'timesheets@mysynergie.net',
  imapPass:     process.env.IMAP_PASS,
  imapHost:     process.env.IMAP_HOST     || 'imap.ionos.com',
  imapPort:     parseInt(process.env.IMAP_PORT || '993'),
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  ingestUrl:    process.env.INVOICE_INGEST_URL,
  ingestSecret: process.env.INGEST_SECRET,
};

if (!CONFIG.anthropicKey) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
if (!dryRun && !CONFIG.ingestUrl) {
  console.error('INVOICE_INGEST_URL not set — use --dry-run to parse without ingesting');
  process.exit(1);
}
if (!dryRun && !CONFIG.ingestSecret) { console.error('INGEST_SECRET not set'); process.exit(1); }
if (!skipImap && !CONFIG.imapPass) { console.error('IMAP_PASS not set (use --skip-imap to skip IMAP phase)'); process.exit(1); }

// ─── PDF classifier ───────────────────────────────────────────────────────────

function classifyByFilename(name) {
  const n = name.toLowerCase();
  const isInvoice   = /invoice|billing|\binv[-_]?\d|\bpaymentrequest\b/.test(n);
  const isTimesheet = /timesheet|timesheets?|weekly.?time|time.?sheet/.test(n);
  if (isInvoice && isTimesheet) return 'both';
  if (isInvoice)   return 'invoice';
  if (isTimesheet) return 'timesheet';
  return null;
}

async function classifyPdf(buffer, filename) {
  const byName = classifyByFilename(filename);
  if (byName === 'invoice' || byName === 'timesheet' || byName === 'both') return byName;

  let text = '';
  try {
    const data = await require('pdf-parse')(buffer);
    text = (data.text || '').toLowerCase();
  } catch {}

  if (!text || text.replace(/\s/g, '').length < 20) return 'unknown';

  const invoiceSignals = [
    /invoice\s*(number|no\.?|#)/,
    /\bamount\s+due\b/,
    /\btotal\s+amount\b/,
    /\biban\b/,
    /\bswift\b/,
    /\bbill\s+to\b/,
    /\bpayment\s+(terms|details|instructions)\b/,
    /\bremit\s+to\b/,
    /\binvoice\s+date\b/,
    /\bdue\s+date\b/,
  ];
  const timesheetSignals = [
    /week\s+ending\s+(date)?/,
    /client\s+billable\s+hours/,
    /\bmon(day)?\b.*\btue(sday)?\b/,
    /\bmanager\s+(name|signature)\b/,
    /\bdaily\s+hours\b/,
    /\btimesheet\b/,
    /\bproject\s+(code|name)\b.*hours/,
  ];

  let invoiceScore = 0, timesheetScore = 0;
  for (const re of invoiceSignals)   if (re.test(text)) invoiceScore++;
  for (const re of timesheetSignals) if (re.test(text)) timesheetScore++;

  if (invoiceScore >= 2 && timesheetScore >= 2) return 'both';
  if (invoiceScore >= 2) return 'invoice';
  if (timesheetScore >= 2) return 'timesheet';
  if (invoiceScore > timesheetScore) return 'invoice';
  if (timesheetScore > invoiceScore) return 'timesheet';
  return 'unknown';
}

// ─── Claude invoice extraction ────────────────────────────────────────────────

const CLAUDE_INVOICE_SYSTEM = `You are an invoice data extractor. Extract structured fields from invoice documents.
Return ONLY a valid JSON object — no markdown, no explanation. Use null for any field not found.

Required JSON shape:
{
  "invoiceNumber": string | null,
  "periodStart": "YYYY-MM-DD" | null,
  "periodEnd": "YYYY-MM-DD" | null,
  "totalHours": number | null,
  "rate": number | null,
  "totalAmount": number | null,
  "currency": "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "CHF" | string | null,
  "paymentDetails": {
    "iban": string | null,
    "swift": string | null,
    "accountNumber": string | null,
    "sortCode": string | null,
    "routingNumber": string | null,
    "bankName": string | null,
    "companyName": string | null
  },
  "parseNotes": string
}

Rules:
- periodStart / periodEnd: the BILLING PERIOD (dates the work was performed), not the invoice issue date and not dates embedded in the invoice number. If only a month is given (e.g. "April 2026"), use the first and last day of that month. IMPORTANT: invoice numbers often contain date-like components (e.g. "002/05/2026", "2026-04-0007") — do NOT use these as the period; look for explicit "period", "billing period", "services rendered", or a clear date range in the description.
- totalHours: hours worked — a number (e.g. 160, 144.5). Ignore text like "h" or "hrs" suffix.
- rate: hourly rate as a plain number (e.g. 40, 35.50). Ignore currency symbols.
- totalAmount: total invoice amount as a plain number. Ignore currency symbols.
- currency: 3-letter ISO code only (USD, EUR, GBP, etc.).
- iban: compact electronic format, NO spaces (e.g. "HR1234567890123456789" not "HR12 3456 7890").
- swift: SWIFT/BIC code (8 or 11 chars).
- accountNumber: bank account number if not an IBAN.
- sortCode: UK sort code (XX-XX-XX format).
- routingNumber: US ABA routing number (9 digits).
- bankName: name of the bank (not the account holder).
- companyName: name of the invoice issuer / contractor company.
- If the invoice is multi-contractor (multiple people with individual hours listed), set totalHours and rate to null.
- Date format: many invoices use European DD/MM/YYYY, not US MM/DD/YYYY. Determine the format from context:
  * If the IBAN starts with HR, RS, BA, SI, MK, DE, AT, NL, FR, IT, ES, BE, SE, NO, FI, DK, PL, or other EU/EEA country codes → use DD/MM/YYYY.
  * If the document uses a routing number (US ABA), or amounts are clearly in USD with no IBAN → use MM/DD/YYYY.
  * When truly ambiguous (both components ≤ 12 and no country signal), prefer DD/MM/YYYY as most contractors are European.
  * Cross-check: these are monthly billing periods. If periodEnd is in month M, periodStart must also be in month M. If they differ wildly, you have the date format wrong — flip DD and MM and re-derive.
- parseNotes: one sentence summarising what was found and what was missing.`;

async function claudeExtractInvoice(pdfBuffer, filename) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: CONFIG.anthropicKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: CLAUDE_INVOICE_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') },
        },
        { type: 'text', text: 'Extract invoice data from this document.' },
      ],
    }],
  });

  const raw = (response.content[0]?.text ?? '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');
  const parsed = JSON.parse(jsonMatch[0]);

  for (const f of ['periodStart', 'periodEnd']) {
    const s = parsed[f];
    if (s && typeof s === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
      if (m) {
        const [, a, b, y] = m;
        parsed[f] = parseInt(a, 10) > 12
          ? `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
          : `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
      }
    }
  }

  if (parsed.paymentDetails?.iban) {
    parsed.paymentDetails.iban = parsed.paymentDetails.iban.replace(/\s+/g, '').toUpperCase();
  }

  return parsed;
}

// ─── HTTP POST to ingest-invoice ──────────────────────────────────────────────

function postInvoice(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url  = new URL(CONFIG.ingestUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':     'application/json',
        'Content-Length':   Buffer.byteLength(body),
        'x-ingest-secret':  CONFIG.ingestSecret,
      },
    };
    const req = (isHttps ? https : http).request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Process one PDF buffer as a potential invoice ────────────────────────────

async function processPdf(buffer, filename, messageId, contractorEmail, stats) {
  const cls = await classifyPdf(buffer, filename);

  if (cls === 'timesheet') {
    console.log(`  ⏭️  ${filename}  → timesheet (skipped)`);
    stats.skipped++;
    return;
  }
  if (cls === 'unknown') {
    console.log(`  ❓ ${filename}  → unknown type (skipped)`);
    stats.skipped++;
    return;
  }

  // cls is 'invoice' or 'both'
  console.log(`  🧾 ${filename}  → ${cls} — extracting…`);

  let parsed;
  try {
    parsed = await claudeExtractInvoice(buffer, filename);
  } catch (e) {
    console.log(`     ❌ Extraction failed: ${e.message}`);
    stats.failed++;
    return;
  }

  const pd = parsed?.paymentDetails || {};
  const canIngest = parsed?.periodStart && parsed?.periodEnd && parsed?.totalHours != null;

  console.log(`     Invoice #  : ${parsed?.invoiceNumber ?? '—'}`);
  console.log(`     Period     : ${parsed?.periodStart ?? '—'} → ${parsed?.periodEnd ?? '—'}`);
  console.log(`     Hours      : ${parsed?.totalHours ?? '—'}   Rate: ${parsed?.rate ?? '—'}   Amount: ${parsed?.totalAmount ?? '—'} ${parsed?.currency ?? ''}`);
  console.log(`     Company    : ${pd.companyName ?? '—'}   IBAN: ${pd.iban ?? '—'}   SWIFT: ${pd.swift ?? '—'}`);
  if (parsed?.parseNotes) console.log(`     Notes      : ${parsed.parseNotes}`);

  if (!canIngest) {
    console.log(`     ⚠️  Missing required fields (period or hours) — not ingested`);
    stats.missing++;
    return;
  }

  if (dryRun) {
    console.log(`     ℹ️  Dry run — not ingested`);
    stats.dryRun++;
    return;
  }

  try {
    const res = await postInvoice({
      messageId,
      contractorEmail,
      attachmentName:  filename,
      invoiceNumber:   parsed.invoiceNumber  ?? null,
      periodStart:     parsed.periodStart,
      periodEnd:       parsed.periodEnd,
      totalHours:      parsed.totalHours,
      rate:            parsed.rate           ?? null,
      totalAmount:     parsed.totalAmount    ?? null,
      currency:        parsed.currency       ?? null,
      paymentDetails:  parsed.paymentDetails ?? null,
      parseNotes:      parsed.parseNotes     ?? '',
      pdfBase64:       buffer.toString('base64'),
      rawExtracted:    parsed,
      source:          'batch',
    });

    const action = res.body?.action || `http-${res.status}`;
    if (action === 'duplicate') {
      console.log(`     🔁 Duplicate — already ingested`);
      stats.duplicates++;
    } else {
      console.log(`     ✅ Ingested → ${action} (id: ${res.body?.invoiceId ?? '?'})`);
      stats.ingested++;
    }
  } catch (e) {
    console.log(`     ❌ POST failed: ${e.message}`);
    stats.failed++;
  }
}

// ─── Phase 1: IMAP re-scan ────────────────────────────────────────────────────

function imapDateStr(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fetchAllEmails(since) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user:       CONFIG.imapUser,
      password:   CONFIG.imapPass,
      host:       CONFIG.imapHost,
      port:       CONFIG.imapPort,
      tls:        true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 15000,
    });

    imap.once('error', reject);
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) return reject(err);

        const criteria = since ? ['SINCE', imapDateStr(since)] : ['ALL'];
        imap.search(criteria, (err, uids) => {
          if (err) return reject(err);
          if (!uids || uids.length === 0) { imap.end(); return resolve([]); }

          console.log(`  Found ${uids.length} email(s) matching search criteria`);
          const messages = [];
          const fetch = imap.fetch(uids, { bodies: '', markSeen: false });

          fetch.on('message', (msg) => {
            const chunks = [];
            let uid;
            msg.once('attributes', attrs => { uid = attrs.uid; });
            msg.on('body', stream => {
              stream.on('data', c => chunks.push(c));
              stream.once('end', () => messages.push({ buffer: Buffer.concat(chunks), uid }));
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => { imap.end(); resolve(messages); });
        });
      });
    });

    imap.connect();
  });
}

async function runImapPhase(stats) {
  console.log('\n━━━ Phase 1: IMAP re-scan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Mailbox : ${CONFIG.imapUser}@${CONFIG.imapHost}`);
  if (sinceDate) console.log(`  Since   : ${sinceDate.toDateString()}`);
  else           console.log(`  Range   : ALL emails`);

  let rawMessages;
  try {
    rawMessages = await fetchAllEmails(sinceDate);
  } catch (e) {
    console.error(`  IMAP error: ${e.message}`);
    return;
  }

  if (!rawMessages.length) {
    console.log('  No emails found.');
    return;
  }

  for (const raw of rawMessages) {
    let parsed;
    try { parsed = await simpleParser(raw.buffer); }
    catch (e) { console.warn(`  Skip uid=${raw.uid}: parse error ${e.message}`); continue; }

    const fromAddr     = parsed.from?.value?.[0];
    const fromEmail    = (fromAddr?.address || '').toLowerCase();
    const subject      = parsed.subject || '(no subject)';
    const messageId    = parsed.messageId || `uid-${raw.uid}`;

    const attachments = (parsed.attachments || []).map(a => ({
      name:   a.filename || a.contentType?.split('/')[1] || 'unnamed',
      buffer: a.content,
      isPdf:  !!(a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i) ||
                 (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
      isEml:  !!(a.contentType?.includes('message/rfc822') || (a.filename||'').match(/\.eml$/i)),
    }));

    const pdfAtts = attachments.filter(a => a.isPdf);
    const emlAtts = attachments.filter(a => a.isEml);

    // Unpack .eml attachments (batch/forwarded emails) and collect their PDFs
    const allPdfs = [...pdfAtts.map(a => ({ ...a, email: fromEmail }))];
    for (const eml of emlAtts) {
      try {
        const inner = await simpleParser(eml.buffer);
        const innerEmail = (inner.from?.value?.[0]?.address || '').toLowerCase() || fromEmail;
        const innerPdfs = (inner.attachments || [])
          .filter(a => a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i))
          .map(a => ({
            name:   a.filename || 'attachment.pdf',
            buffer: a.content,
            isPdf:  true,
            email:  innerEmail,
          }));
        allPdfs.push(...innerPdfs);
      } catch {}
    }

    if (!allPdfs.length) continue;

    console.log(`\n📧 ${subject}  [${fromEmail}]`);
    for (const att of allPdfs) {
      const attMsgId = `${messageId}::${att.name}`;
      await processPdf(att.buffer, att.name, attMsgId, att.email || fromEmail, stats);
    }
  }
}

// ─── Phase 2: Local samples folder ───────────────────────────────────────────

async function runSamplesPhase(stats) {
  console.log('\n━━━ Phase 2: Local samples ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Dir: ${SAMPLES_DIR}`);

  if (!fs.existsSync(SAMPLES_DIR)) {
    console.log('  Directory not found — skipping');
    return;
  }

  const files = fs.readdirSync(SAMPLES_DIR)
    .filter(f => /\.pdf$/i.test(f))
    .sort();

  if (!files.length) {
    console.log('  No PDF files found.');
    return;
  }

  console.log(`  Found ${files.length} PDF(s)\n`);
  for (const filename of files) {
    const buffer    = fs.readFileSync(path.join(SAMPLES_DIR, filename));
    // Stable synthetic message ID — same file always maps to same ID so re-runs are safe
    const messageId = `local-batch::${filename}`;
    await processPdf(buffer, filename, messageId, 'unknown@local', stats);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Synergie Invoice Batch Ingest');
  if (dryRun) console.log('   ⚠️  DRY RUN — nothing will be written to the database');
  console.log(`   Ingest URL: ${CONFIG.ingestUrl || '(dry-run, not needed)'}\n`);

  const stats = {
    ingested: 0, duplicates: 0, dryRun: 0,
    missing: 0, skipped: 0, failed: 0,
  };

  if (!skipImap)    await runImapPhase(stats);
  if (!skipSamples) await runSamplesPhase(stats);

  console.log('\n━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ Ingested          : ${stats.ingested}`);
  console.log(`  🔁 Duplicates        : ${stats.duplicates}`);
  if (dryRun)
  console.log(`  ℹ️  Dry-run (parsed)  : ${stats.dryRun}`);
  console.log(`  ⚠️  Missing fields    : ${stats.missing}`);
  console.log(`  ⏭️  Skipped (non-inv) : ${stats.skipped}`);
  console.log(`  ❌ Errors            : ${stats.failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
