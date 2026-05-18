'use strict';

// Usage:
//   node run.js samples/              — parse all PDFs/DOCX/MSG, print results table
//   node run.js samples/ --dump-text  — also print raw text + Claude response per file
//   node run.js samples/foo.pdf       — run a single file
//   node run.js samples/ --no-claude  — skip Claude, use regex parser only (PDF text files)

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const { extractText }                                                    = require('./extract');
const { extractFromText, extractFromImages, extractFromDocx, extractFromMsg, pdfToImages } = require('./claude-extract');
const { parseInvoice }                                                   = require('./parser');

const FIELDS    = ['invoiceNumber', 'periodStart', 'periodEnd', 'totalHours', 'rate', 'totalAmount', 'currency'];
const PD_FIELDS = ['iban', 'swift', 'accountNumber', 'sortCode', 'routingNumber', 'bankName', 'companyName'];

const SUPPORTED_EXTS = ['.pdf', '.docx', '.msg'];

// ─── Per-file processing ──────────────────────────────────────────────────────

async function processFile(filePath, dumpText, noClaude) {
  const filename = path.basename(filePath);
  const ext      = path.extname(filename).toLowerCase();

  try {
    const buffer = fs.readFileSync(filePath);
    let result;
    let method;

    if (ext === '.docx') {
      result = await extractFromDocx(buffer);
      method = 'claude-docx';
    } else if (ext === '.msg') {
      result = await extractFromMsg(buffer);
      method = 'claude-msg';
    } else {
      // PDF path
      if (noClaude) {
        // Legacy: regex parser only
        const { text, method: m } = await extractText(buffer);
        result = parseInvoice(text, filename);
        method = m;
      } else {
        // Try pdf-parse for text first (cheap)
        let pdfText = '';
        let textOk  = false;
        try {
          const pdfParse = require('pdf-parse');
          const data     = await pdfParse(buffer);
          // Require at least 30 real alphanumeric characters — guards against
          // PDFs that have a text layer but it's all whitespace/control chars.
          const wordChars = (data.text?.match(/[a-zA-Z0-9]/g) || []).length;
          if (wordChars > 30) {
            pdfText = data.text;
            textOk  = true;
          }
        } catch (_) {}

        if (textOk) {
          // Text-based Claude extraction
          result = await extractFromText(pdfText);
          method = 'claude-text';

          // Override EUR→USD when invoice has both currencies but Claude picked EUR.
          // Croatian/Bosnian templates list EUR prominently in the footer; the USD rate
          // is the billing currency and appears as "N USD per h" in the line item.
          if (result.currency === 'EUR') {
            const usdRateM = pdfText.match(/(\d+(?:[.,]\d+)?)\s*USD\s*per\s*h/i);
            if (usdRateM) {
              const usdRate = parseFloat(usdRateM[1].replace(',', '.'));
              const usdTotalM = pdfText.match(/T\s*O\s*T\s*A\s*L\s*:?\s*\(?USD\)?\s*[:\s]*([\d.,]+)\s*USD/i)
                             || pdfText.match(/([\d.,]+)USD/i);
              let usdTotal = null;
              if (usdTotalM) {
                const raw = usdTotalM[1].trim();
                usdTotal = /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(raw)
                  ? parseFloat(raw.replace(/\./g, '').replace(',', '.'))
                  : parseFloat(raw.replace(/,/g, ''));
              }
              result.rate     = usdRate;
              result.currency = 'USD';
              if (usdTotal && usdTotal > usdRate) result.totalAmount = usdTotal;
            }
          }

          if (dumpText) {
            console.log(`\n${'═'.repeat(80)}`);
            console.log(`FILE: ${filename}  [${method}]`);
            console.log('─'.repeat(80));
            console.log(pdfText.trim().slice(0, 3000));
            console.log('─'.repeat(80));
            console.log('PARSED:', JSON.stringify(result, null, 2));
          }
        } else {
          // Vision-based Claude extraction (image PDF)
          const images = await pdfToImages(buffer);
          result = await extractFromImages(images);
          method = 'claude-vision';

          if (dumpText) {
            console.log(`\n${'═'.repeat(80)}`);
            console.log(`FILE: ${filename}  [${method}]  ${images.length} page(s)`);
            console.log('─'.repeat(80));
            console.log('(image-based — no raw text)');
            console.log('PARSED:', JSON.stringify(result, null, 2));
          }
        }
      }
    }

    return { filename, method, error: null, ...flattenResult(result, filename) };
  } catch (e) {
    const fallback = parsePeriodFromFilename(filename) || {};
    return {
      filename, method: 'error', error: e.message,
      ...Object.fromEntries(FIELDS.map(f => [f, null])),
      ...fallback,
      paymentDetails: Object.fromEntries(PD_FIELDS.map(f => [f, null])),
    };
  }
}

// ─── Filename period fallback ──────────────────────────────────────────────────

const MONTH_ABBR = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parsePeriodFromFilename(filename) {
  // Matches "Apr'26", "April'26", "Apr'2026", "Aprr'26" (typo), "Apr 2026", "Apr-2026"
  const m = filename.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr{1,2}(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)['\s\-](\d{2,4})\b/i
  );
  if (!m) return null;

  const month = MONTH_ABBR[m[1].toLowerCase().replace(/r+/, 'r')]; // normalise "aprr" → "apr"
  if (!month) return null;

  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;

  const lastDay = new Date(year, month, 0).getDate(); // day 0 of next month = last of this
  return {
    periodStart: `${year}-${String(month).padStart(2, '0')}-01`,
    periodEnd:   `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function applyFilenamePeriodFallback(result, filename) {
  const { periodStart, periodEnd } = result;
  const fallback = parsePeriodFromFilename(filename);

  if (periodStart && periodEnd) {
    const span = (new Date(periodEnd) - new Date(periodStart)) / 86400000;
    const plausible = span >= 5 && span <= 45;

    if (plausible && fallback) {
      // Span looks valid but check month against filename.
      // Invoice numbers often contain date components (e.g. "002/05/2026", "2026-04-0007")
      // which Claude misreads as the billing period. If the filename clearly names a different
      // month, the filename wins.
      const extractedYM  = periodStart.slice(0, 7); // YYYY-MM
      const filenameYM   = fallback.periodStart.slice(0, 7);
      if (extractedYM === filenameYM) return result; // months agree — trust Claude
      return { ...result, periodStart: fallback.periodStart, periodEnd: fallback.periodEnd };
    }

    if (plausible) return result; // plausible and no filename fallback — keep
  }

  // Implausible or missing period — use filename if available
  if (!fallback) return result;
  return { ...result, periodStart: fallback.periodStart, periodEnd: fallback.periodEnd };
}

// Claude returns a flat-ish object; normalise to the shape run.js expects
function flattenResult(r, filename) {
  const rawIban = r.paymentDetails?.iban ?? null;
  const pd = {
    iban:          rawIban ? rawIban.replace(/\s+/g, '').toUpperCase() : null,
    swift:         r.paymentDetails?.swift         ?? null,
    accountNumber: r.paymentDetails?.accountNumber ?? null,
    sortCode:      r.paymentDetails?.sortCode      ?? null,
    routingNumber: r.paymentDetails?.routingNumber ?? null,
    bankName:      r.paymentDetails?.bankName      ?? null,
    companyName:   r.paymentDetails?.companyName   ?? null,
  };

  const invoiceFields = ['invoiceNumber', 'periodStart', 'periodEnd', 'totalHours', 'rate', 'totalAmount'];
  const hasInvoiceData = invoiceFields.some(f => r[f] != null);
  const hasPaymentData = Object.values(pd).some(v => v != null);
  const paymentOnly    = !hasInvoiceData && hasPaymentData;

  const base = {
    invoiceNumber: r.invoiceNumber ?? null,
    periodStart:   r.periodStart   ?? null,
    periodEnd:     r.periodEnd     ?? null,
    totalHours:    r.totalHours    ?? null,
    rate:          r.rate          ?? null,
    totalAmount:   r.totalAmount   ?? null,
    currency:      r.currency      ?? null,
    paymentDetails: pd,
    parseNotes:    paymentOnly ? 'PAYMENT DETAILS ONLY — no invoice fields' : (r.parseNotes ?? null),
    paymentOnly,
    rawText:       null,
  };

  return applyFilenamePeriodFallback(base, filename);
}

// ─── Output helpers (unchanged from original) ─────────────────────────────────

function printTable(results) {
  const COLS = ['File', 'Method', 'InvNum', 'Start', 'End', 'Hours', 'Rate', 'Total', 'Curr'];

  const rows = results.map(r => [
    r.filename,
    r.method || '—',
    r.error          ? `ERR: ${r.error.slice(0, 25)}` : (r.invoiceNumber || '—'),
    r.periodStart    || '—',
    r.periodEnd      || '—',
    r.totalHours  != null ? String(r.totalHours)  : '—',
    r.rate        != null ? String(r.rate)        : '—',
    r.totalAmount != null ? String(r.totalAmount) : '—',
    r.currency       || '—',
  ]);

  const widths = COLS.map((c, i) => Math.max(c.length, ...rows.map(r => r[i].length)));
  const sep    = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const fmt    = row => row.map((v, i) => ` ${v.padEnd(widths[i])} `).join('│');

  console.log('\n' + sep);
  console.log(fmt(COLS));
  console.log(sep);
  rows.forEach(r => console.log(fmt(r)));
  console.log(sep);
}

function printPaymentDetails(results) {
  const PD_LABELS = {
    iban: 'IBAN', swift: 'SWIFT/BIC', accountNumber: 'Account #',
    sortCode: 'Sort Code', routingNumber: 'Routing #', bankName: 'Bank', companyName: 'Company',
  };

  const rows = results.map(r => PD_FIELDS.map(f => r.paymentDetails?.[f] || '—'));
  const hasAny = rows.some(row => row.some(v => v !== '—'));
  if (!hasAny) { console.log('\nPayment details: none extracted'); return; }

  const COLS   = ['File', ...PD_FIELDS.map(f => PD_LABELS[f])];
  const allRows = results.map((r, i) => [r.filename, ...rows[i]]);
  const widths  = COLS.map((c, i) => Math.max(c.length, ...allRows.map(r => r[i].length)));
  const sep     = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const fmt     = row => row.map((v, i) => ` ${v.padEnd(widths[i])} `).join('│');

  console.log('\nPayment details:');
  console.log(sep);
  console.log(fmt(COLS));
  console.log(sep);
  allRows.forEach(r => console.log(fmt(r)));
  console.log(sep);
}

function printNotes(results) {
  const paymentOnly = results.filter(r => r.paymentOnly);
  if (paymentOnly.length) {
    console.log('\nPayment-details-only files (no invoice fields — bank info to store against contractor):');
    paymentOnly.forEach(r => {
      const pd = r.paymentDetails;
      const parts = [
        pd.companyName && `Company: ${pd.companyName}`,
        pd.iban        && `IBAN: ${pd.iban}`,
        pd.swift       && `SWIFT: ${pd.swift}`,
        pd.bankName    && `Bank: ${pd.bankName}`,
        pd.accountNumber && `Account: ${pd.accountNumber}`,
        pd.routingNumber && `Routing: ${pd.routingNumber}`,
      ].filter(Boolean);
      console.log(`  ${r.filename}`);
      parts.forEach(p => console.log(`    ${p}`));
    });
  }

  const withNotes = results.filter(r => (r.parseNotes || r.error) && !r.paymentOnly);
  if (!withNotes.length) return;
  console.log('\nErrors / notes:');
  withNotes.forEach(r => {
    const note = r.error ? `ERROR: ${r.error}` : r.parseNotes;
    console.log(`  ${r.filename}: ${note}`);
  });
}

function printSummary(results) {
  const total = results.length;
  console.log(`\nExtraction rate (${total} file${total === 1 ? '' : 's'}):`);
  FIELDS.forEach(f => {
    const found = results.filter(r => r[f] != null).length;
    const pct   = total ? Math.round(found / total * 100) : 0;
    const bar   = '█'.repeat(Math.round(pct / 5)).padEnd(20);
    console.log(`  ${f.padEnd(16)} ${bar} ${found}/${total} (${pct}%)`);
  });
  console.log('  ' + '─'.repeat(55));
  PD_FIELDS.forEach(f => {
    const found = results.filter(r => r.paymentDetails?.[f] != null).length;
    const pct   = total ? Math.round(found / total * 100) : 0;
    const bar   = '█'.repeat(Math.round(pct / 5)).padEnd(20);
    console.log(`  payment.${f.padEnd(14)} ${bar} ${found}/${total} (${pct}%)`);
  });

  console.log('\nExtraction methods:');
  const methods = {};
  results.forEach(r => { methods[r.method] = (methods[r.method] || 0) + 1; });
  Object.entries(methods).sort().forEach(([m, n]) => console.log(`  ${m}: ${n}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const dumpText = args.includes('--dump-text');
  const noClaude = args.includes('--no-claude');
  const target   = args.find(a => !a.startsWith('--'));

  if (!target) {
    console.error('Usage: node run.js <pdf-file-or-folder> [--dump-text] [--no-claude]');
    process.exit(1);
  }

  if (!noClaude && !process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set. Add it to .env or use --no-claude for regex-only mode.');
    process.exit(1);
  }

  const stat = fs.statSync(target);
  let files;

  if (stat.isDirectory()) {
    files = fs.readdirSync(target)
      .filter(f => SUPPORTED_EXTS.includes(path.extname(f).toLowerCase()))
      .sort()
      .map(f => path.join(target, f));
  } else {
    files = [target];
  }

  if (!files.length) {
    console.log('No supported files found in', target);
    return;
  }

  console.log(`\nProcessing ${files.length} file(s)…`);

  const results = [];
  for (const f of files) {
    const r = await processFile(f, dumpText, noClaude);
    if (!dumpText) process.stdout.write('.');
    results.push(r);
  }
  if (!dumpText) process.stdout.write('\n');

  printTable(results);
  printPaymentDetails(results);
  printNotes(results);
  printSummary(results);
}

main().catch(e => { console.error(e); process.exit(1); });
