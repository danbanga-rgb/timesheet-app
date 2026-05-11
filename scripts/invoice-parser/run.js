'use strict';

// Usage:
//   node run.js samples/              — parse all PDFs, print results table
//   node run.js samples/ --dump-text  — also print the raw extracted text per PDF (useful for debugging patterns)
//   node run.js samples/foo.pdf       — run a single file

const fs       = require('fs');
const path     = require('path');
const pdfParse = require('pdf-parse');
const { parseInvoice } = require('./parser');

const FIELDS = ['invoiceNumber', 'periodStart', 'periodEnd', 'totalHours', 'rate', 'totalAmount', 'currency'];

async function processFile(filePath, dumpText) {
  const filename = path.basename(filePath);
  try {
    const buffer    = fs.readFileSync(filePath);
    const { text }  = await pdfParse(buffer);
    const result    = parseInvoice(text, filename);

    if (dumpText) {
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`FILE: ${filename}`);
      console.log('─'.repeat(80));
      console.log(text.trim());
      console.log('─'.repeat(80));
      console.log('PARSED:', JSON.stringify(result, null, 2));
    }

    return { filename, ...result, rawText: text, error: null };
  } catch (e) {
    return { filename, error: e.message, rawText: null, ...Object.fromEntries(FIELDS.map(f => [f, null])), parseNotes: null };
  }
}

function printTable(results) {
  const COLS = ['File', 'InvNum', 'Start', 'End', 'Hours', 'Rate', 'Total', 'Curr'];

  const rows = results.map(r => [
    r.filename,
    r.error          ? `ERR: ${r.error.slice(0, 30)}` : (r.invoiceNumber || '—'),
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

function printNotes(results) {
  const withNotes = results.filter(r => r.parseNotes || r.error);
  if (!withNotes.length) return;
  console.log('\nParse notes:');
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
    console.log(`  ${f.padEnd(15)} ${bar} ${found}/${total} (${pct}%)`);
  });
}

async function main() {
  const args     = process.argv.slice(2);
  const dumpText = args.includes('--dump-text');
  const target   = args.find(a => !a.startsWith('--'));

  if (!target) {
    console.error('Usage: node run.js <pdf-file-or-folder> [--dump-text]');
    process.exit(1);
  }

  const stat = fs.statSync(target);
  let files;

  if (stat.isDirectory()) {
    files = fs.readdirSync(target)
      .filter(f => f.toLowerCase().endsWith('.pdf'))
      .map(f => path.join(target, f));
  } else {
    files = [target];
  }

  if (!files.length) {
    console.log('No PDF files found in', target);
    return;
  }

  console.log(`\nProcessing ${files.length} PDF(s)…`);

  const results = [];
  for (const f of files) {
    const r = await processFile(f, dumpText);
    if (!dumpText) process.stdout.write('.');
    results.push(r);
  }
  if (!dumpText) process.stdout.write('\n');

  printTable(results);
  printNotes(results);
  printSummary(results);
}

main().catch(e => { console.error(e); process.exit(1); });
