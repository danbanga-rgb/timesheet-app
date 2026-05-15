'use strict';

// attach-samples.js
//
// For each PDF in --samples-dir: calls Claude to extract invoice metadata,
// finds the matching imported invoice in the DB, uploads the PDF to Storage,
// and sets attachment_path. Does NOT create or modify any invoice records.
//
// Matching priority:
//   1. IBAN (unique per contractor — most reliable)
//   2. invoice_number + period_start
//   3. invoice_number + period_start + company_name substring in user_name
//
// Usage:
//   node attach-samples.js --samples-dir ../invoice-parser/samples

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const argIdx      = process.argv.indexOf('--samples-dir');
const SAMPLES_DIR = argIdx !== -1 ? path.resolve(process.argv[argIdx + 1]) : null;

if (!SAMPLES_DIR) { console.error('Usage: node attach-samples.js --samples-dir <path>'); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const missing = [];
if (!SUPABASE_URL)   missing.push('SUPABASE_URL');
if (!SUPABASE_KEY)   missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (!ANTHROPIC_KEY)  missing.push('ANTHROPIC_API_KEY');
if (missing.length)  { console.error(`Missing env: ${missing.join(', ')}`); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MIME_MAP = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
};

// ─── Claude extraction (reuses claude-extract logic inline) ──────────────────

const Anthropic = require('@anthropic-ai/sdk');
const client    = new Anthropic({ apiKey: ANTHROPIC_KEY });

const SYSTEM_PROMPT = `You are an invoice data extractor. Extract structured fields from invoice documents.
Return ONLY a valid JSON object — no markdown, no explanation. Use null for any field not found.

Required JSON shape:
{
  "invoiceNumber": string | null,
  "periodStart": "YYYY-MM-DD" | null,
  "periodEnd": "YYYY-MM-DD" | null,
  "totalHours": number | null,
  "iban": string | null,
  "companyName": string | null,
  "contractorEmail": string | null
}

Rules:
- invoiceNumber: the invoice or payment request number.
- periodStart / periodEnd: the billing period (not the invoice issue date).
- iban: compact format, NO spaces (e.g. "HR1234567890123456789"). null if not present.
- companyName: name of the invoice issuer / contractor company.
- contractorEmail: email address of the invoice issuer if shown on the invoice. null if not present.
- Date format: use DD/MM/YYYY for EU/EEA contractors (HR, RS, BA, SI, DE, NL, etc.), MM/DD/YYYY for US.`;

async function extractFromPdf(buffer, filename) {
  // Try text extraction first
  const pdfParse = require('pdf-parse');
  let text = '';
  try {
    const result = await pdfParse(buffer);
    text = result.text?.trim() || '';
  } catch (_) {}

  const ext = (filename.match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || 'pdf';

  if (text.length > 50 && ext !== 'docx' && ext !== 'doc') {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: `Extract invoice fields:\n\n${text}` }],
    });
    return parseResponse(response, buffer);
  }

  // Fallback: send PDF/DOCX directly to Claude as a document
  if (ext === 'pdf') {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
        { type: 'text', text: 'Extract invoice fields from this PDF.' },
      ]}],
    });
    return parseResponse(response, buffer);
  }

  // DOCX: try sending as text if pdf-parse gave us something, else skip
  if (text.length > 0) {
    const response = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: `Extract invoice fields:\n\n${text}` }],
    });
    return parseResponse(response, buffer);
  }

  return null;
}

function parseResponse(response, buffer) {
  const raw  = response.content[0]?.text?.trim() ?? '';
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let parsed;
  try { parsed = JSON.parse(json); } catch { return null; }
  // Strip ALL non-alphanumeric chars (handles zero-width spaces and other Unicode)
  if (parsed.iban) parsed.iban = parsed.iban.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return parsed;
}

// ─── DB: load all unattached imported invoices ────────────────────────────────

async function loadUnattachedInvoices() {
  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, user_name, period_start, period_end, payment_profile')
    .eq('source', 'imported')
    .is('attachment_path', null);

  if (error) throw new Error(`DB error: ${error.message}`);
  return data || [];
}

// ─── Match sample → invoice ───────────────────────────────────────────────────

function normalise(s) {
  return (s || '').toLowerCase().replace(/[\/\s]+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// Convert DD/MM/YYYY or MM/DD/YYYY to YYYY-MM-DD ISO string.
// For EU/EEA we trust DD/MM/YYYY. Also accepts already-ISO strings.
function toIsoDate(raw) {
  if (!raw) return null;
  raw = raw.trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // DD/MM/YYYY or DD.MM.YYYY
  const m = raw.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})/);
  if (m) {
    const [, a, b, y] = m;
    // Heuristic: if first part > 12 it must be a day; otherwise assume DD/MM
    const day = parseInt(a);
    // EU/EEA default: DD/MM/YYYY (a=day, b=month)
    if (day > 12) return `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
    return `${y}-${b.padStart(2,'0')}-${a.padStart(2,'0')}`;
  }
  return null;
}

// Month abbreviation from filename (e.g. "Apr'26" → "2026-04-01")
function periodFromFilename(filename) {
  const monthMap = {
    jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
  };
  const m = filename.match(/['\s\-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^']*'(\d{2,4})/i);
  if (!m) return null;
  const mon = monthMap[m[1].toLowerCase()];
  const yr  = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${yr}-${mon}-01`;
}

// Strip all non-alphanumeric from IBAN for comparison
function cleanIban(s) {
  return (s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function editDist(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function findMatch(extracted, invoices, filename) {
  const iban    = extracted.iban ? cleanIban(extracted.iban) : null;
  const invNum  = normalise(extracted.invoiceNumber);
  const company = (extracted.companyName || '').toLowerCase();

  // Build a set of candidate period_starts to try: Claude's date, first-of-same-month, filename month
  const pStartCandidates = new Set();
  const claudePeriod = toIsoDate(extracted.periodStart);
  if (claudePeriod) {
    pStartCandidates.add(claudePeriod);
    pStartCandidates.add(claudePeriod.slice(0, 7) + '-01');
  }
  const filenamePeriod = periodFromFilename(filename || '');
  if (filenamePeriod) pStartCandidates.add(filenamePeriod);

  // Primary period for single-value use (prefer filename since DB always stores first-of-month)
  const pStart = filenamePeriod || claudePeriod || null;

  function ibanLookup(exact) {
    return invoices.filter(inv => {
      const pp = inv.payment_profile;
      if (!pp?.iban) return false;
      const db = cleanIban(pp.iban);
      return exact ? db === iban : editDist(db, iban) <= 2;
    });
  }

  function tryIban(candidates, suffix) {
    if (candidates.length === 1) return [{ invoice: candidates[0], method: `IBAN${suffix}` }];
    if (candidates.length > 1 && pStartCandidates.size > 0) {
      // Require same-contractor (same user_name) to avoid cross-contractor fuzzy matches
      const names = new Set(candidates.map(i => i.user_name));
      if (names.size > 1) return null; // Multiple different contractors — too risky
      for (const ps of pStartCandidates) {
        const withPeriod = candidates.filter(inv => inv.period_start === ps);
        if (withPeriod.length >= 1) return withPeriod.map(inv => ({ invoice: inv, method: `IBAN${suffix}+period` }));
      }
    }
    return null;
  }

  // 1. Exact IBAN match
  if (iban) {
    const res = tryIban(ibanLookup(true), '');
    if (res) return res;
  }

  // 2. Invoice number + period_start (try all candidate period dates)
  if (invNum && pStartCandidates.size > 0) {
    for (const ps of pStartCandidates) {
      const byNumPeriod = invoices.filter(inv =>
        normalise(inv.invoice_number) === invNum && inv.period_start === ps
      );
      if (byNumPeriod.length >= 1) return byNumPeriod.map(inv => ({ invoice: inv, method: 'inv#+period' }));
    }
  }

  // 3. Invoice number only (if unique across all invoices)
  if (invNum) {
    const byNum = invoices.filter(inv => normalise(inv.invoice_number) === invNum);
    if (byNum.length === 1) return [{ invoice: byNum[0], method: 'inv# only' }];
  }

  // 4. Fuzzy IBAN (OCR off-by-1/2) — only when same contractor throughout
  if (iban && iban.length >= 15) {
    const res = tryIban(ibanLookup(false), '~');
    if (res) return res;
  }

  // 5. Company name + period
  if (company && pStart) {
    const words = company.split(/\s+/).filter(w => w.length > 3);
    if (words.length) {
      const byCompany = invoices.filter(inv =>
        inv.period_start === pStart &&
        words.some(w => (inv.user_name || '').toLowerCase().includes(w))
      );
      if (byCompany.length === 1) return [{ invoice: byCompany[0], method: 'company+period' }];
    }
  }

  return null;
}

// ─── Upload and attach ────────────────────────────────────────────────────────

async function attachPdf(invoiceId, buffer, filename) {
  const ext         = (filename.match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || 'pdf';
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  const storagePath = `${invoiceId}/original.${ext}`;

  let err;
  for (let i = 1; i <= 3; i++) {
    const { error } = await supabase.storage
      .from('invoice-attachments')
      .upload(storagePath, buffer, { contentType, upsert: true });
    if (!error) { err = null; break; }
    err = error;
    if (i < 3) await new Promise(r => setTimeout(r, i * 2000));
  }
  if (err) throw new Error(`Upload failed: ${err.message}`);

  const { error: dbErr } = await supabase
    .from('invoices')
    .update({ attachment_path: storagePath })
    .eq('id', invoiceId);
  if (dbErr) throw new Error(`DB update failed: ${dbErr.message}`);

  return storagePath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Samples dir: ${SAMPLES_DIR}\n`);

  const files = fs.readdirSync(SAMPLES_DIR)
    .filter(f => /\.(pdf|docx)$/i.test(f))
    .sort();

  console.log(`Loading unattached invoices from DB…`);
  let invoices = await loadUnattachedInvoices();
  console.log(`Found ${invoices.length} unattached invoice(s) | ${files.length} sample file(s)\n`);

  let ok = 0, noMatch = 0, failed = 0, skipped = 0;

  for (const filename of files) {
    process.stdout.write(`→ ${filename}\n  Extracting… `);
    const buffer = fs.readFileSync(path.join(SAMPLES_DIR, filename));

    let extracted;
    try {
      extracted = await extractFromPdf(buffer, filename);
    } catch (e) {
      console.log(`❌ extraction failed: ${e.message}`);
      failed++;
      continue;
    }

    if (!extracted) {
      console.log('❌ Claude returned no data');
      failed++;
      continue;
    }

    process.stdout.write(`inv#=${extracted.invoiceNumber || '?'}  period=${extracted.periodStart}→${extracted.periodEnd}  IBAN=${extracted.iban || '—'}\n  Matching… `);

    const matches = findMatch(extracted, invoices, filename);
    if (!matches) {
      console.log(`⚠ no DB match`);
      noMatch++;
      continue;
    }

    let anyOk = false;
    for (const { invoice, method } of matches) {
      // Check if already attached (could happen if same invoice matched by two samples)
      if (invoice.attachment_path) {
        console.log(`⏭ already attached (invoice ${invoice.id})`);
        skipped++;
        continue;
      }

      try {
        const storagePath = await attachPdf(invoice.id, buffer, filename);
        console.log(`✅ [${method}] → invoice ${invoice.id} (${invoice.user_name}) → ${storagePath}`);
        ok++;
        anyOk = true;

        // Mark as attached locally so duplicate samples don't overwrite
        invoice.attachment_path = storagePath;
      } catch (e) {
        console.log(`❌ ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Attached : ${ok}`);
  console.log(`No match : ${noMatch}  (invoice already has attachment or no DB record for this period)`);
  console.log(`Skipped  : ${skipped}`);
  console.log(`Errors   : ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
