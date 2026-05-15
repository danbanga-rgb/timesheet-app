'use strict';

// reattach-invoices.js
//
// Attaches original invoice files to imported invoices that have no attachment_path.
// No Claude calls, no re-ingestion — only uploads to Storage and sets attachment_path.
//
// Strategy:
//   1. Samples directory — match by invoice number extracted from "Inv# {num} - Month.ext"
//   2. IMAP full scan   — scans every IMAP folder, builds attachment-name index,
//                         resolves remaining invoices from that index.
//
// Usage:
//   node reattach-invoices.js --samples-dir ../invoice-parser/samples
//
// Diagnostic flags:
//   --list-folders          List all IMAP folders and exit
//   --dump-attachments      After IMAP scan, print all attachment names found (for debugging)

require('dotenv').config();

const fs               = require('fs');
const path             = require('path');
const Imap             = require('imap');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IMAP_USER    = process.env.IMAP_USER || 'timesheets@mysynergie.net';
const IMAP_PASS    = process.env.IMAP_PASS;
const IMAP_HOST    = process.env.IMAP_HOST || 'imap.ionos.com';
const IMAP_PORT    = parseInt(process.env.IMAP_PORT || '993');

const args         = new Set(process.argv.slice(2));
const argIdx       = process.argv.indexOf('--samples-dir');
const SAMPLES_DIR  = argIdx !== -1 ? path.resolve(process.argv[argIdx + 1]) : null;
const LIST_FOLDERS = args.has('--list-folders');
const DUMP_ATTS    = args.has('--dump-attachments');

const missing = [];
if (!SUPABASE_URL) missing.push('SUPABASE_URL');
if (!SUPABASE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (!IMAP_PASS)    missing.push('IMAP_PASS');
if (missing.length) { console.error(`Missing env: ${missing.join(', ')}`); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MIME_MAP = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  msg:  'application/vnd.ms-outlook',
};

// ─── IMAP helpers ─────────────────────────────────────────────────────────────

function imapConnect() {
  return new Imap({
    user:        IMAP_USER,
    password:    IMAP_PASS,
    host:        IMAP_HOST,
    port:        IMAP_PORT,
    tls:         true,
    tlsOptions:  { rejectUnauthorized: false },
    connTimeout: 30000,
    authTimeout: 15000,
  });
}

function listAllBoxes() {
  return new Promise((resolve, reject) => {
    const imap = imapConnect();
    imap.once('error', reject);
    imap.once('ready', () => {
      imap.getBoxes('', (err, boxes) => {
        imap.end();
        if (err) return reject(err);
        const names = [];
        function walk(obj, prefix) {
          for (const [name, box] of Object.entries(obj)) {
            const full = prefix ? `${prefix}${box.delimiter}${name}` : name;
            names.push(full);
            if (box.children) walk(box.children, full);
          }
        }
        walk(boxes, '');
        resolve(names);
      });
    });
    imap.connect();
  });
}

// Scan one folder, add found attachments (whose names are in wantedNames) to index.
function scanFolder(folderName, wantedNames, index, dumpAll) {
  return new Promise((resolve) => {
    const imap = imapConnect();
    const foundInFolder = [];

    imap.once('error', () => resolve(0));   // skip inaccessible folders silently
    imap.once('ready', () => {
      imap.openBox(folderName, true, (err) => {
        if (err) { imap.end(); return resolve(0); }

        imap.search(['ALL'], (err, uids) => {
          if (err || !uids?.length) { imap.end(); return resolve(0); }

          process.stdout.write(`  ${folderName}: ${uids.length} messages`);

          const parseQueue = [];

          const f = imap.fetch(uids, { bodies: '', markSeen: false });

          f.on('message', (msg) => {
            const chunks = [];
            msg.on('body', (stream) => {
              stream.on('data', c => chunks.push(c));
            });
            msg.once('end', () => {
              const raw = Buffer.concat(chunks);
              parseQueue.push(
                simpleParser(raw, { skipHtmlToText: true, skipImageLinks: true })
                  .then(parsed => {
                    for (const att of (parsed.attachments || [])) {
                      if (!att.filename || !att.content) continue;
                      if (dumpAll) foundInFolder.push(att.filename);
                      const key = att.filename.toLowerCase();
                      if (wantedNames.has(key) && !index[key]) {
                        index[key] = att.content;
                      }
                    }
                  })
                  .catch(() => {})
              );
            });
          });

          f.once('error', () => { imap.end(); resolve(0); });
          f.once('end', () => {
            Promise.all(parseQueue).then(() => {
              imap.end();
              const found = Object.keys(index).length;
              if (dumpAll && foundInFolder.length) {
                console.log(`\n    Attachments in ${folderName}:`);
                foundInFolder.forEach(n => console.log(`      ${n}`));
              } else {
                process.stdout.write('\n');
              }
              resolve(found);
            }).catch(() => { imap.end(); resolve(0); });
          });
        });
      });
    });

    imap.connect();
  });
}

// Scan ALL IMAP folders, building a complete attachment index.
async function buildImapIndex(wantedNames, dumpAll = false) {
  if (!wantedNames.size) return {};

  const folders = await listAllBoxes();
  console.log(`  IMAP folders: ${folders.join(', ')}\n`);

  const index = {};

  for (const folder of folders) {
    await scanFolder(folder, wantedNames, index, dumpAll);
    // Stop early once every wanted attachment is found
    if (!dumpAll && Object.keys(index).length >= wantedNames.size) break;
  }

  console.log(`\n  Total: ${Object.keys(index).length}/${wantedNames.size} attachments found across all folders\n`);
  return index;
}

// ─── DB ───────────────────────────────────────────────────────────────────────

async function getInvoicesNeedingAttachment() {
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, user_name, period_start')
    .eq('source', 'imported')
    .is('attachment_path', null);

  if (error) throw new Error(`DB query failed: ${error.message}`);
  if (!invoices?.length) return [];

  const ids = invoices.map(i => i.id);
  const { data: logs, error: logErr } = await supabase
    .from('email_invoice_log')
    .select('invoice_id, attachment_name')
    .in('invoice_id', ids);

  if (logErr) throw new Error(`Log query failed: ${logErr.message}`);

  const logMap = {};
  for (const l of (logs || [])) {
    if (!logMap[l.invoice_id]) logMap[l.invoice_id] = l;
  }

  return invoices.map(inv => ({
    id:             inv.id,
    invoiceNumber:  inv.invoice_number,
    userName:       inv.user_name,
    periodStart:    inv.period_start,
    attachmentName: logMap[inv.id]?.attachment_name || null,
  }));
}

// ─── Samples directory matching ───────────────────────────────────────────────

function extractInvoiceNumberFromSample(filename) {
  const noExt = filename.replace(/\.[^.]+$/, '');
  if (!/^[Ii]nv#/i.test(noExt)) return null;
  const withoutPrefix = noExt.replace(/^[Ii]nv#\s*-?\s*/i, '').trim();
  const stopRe = /\s*[-–]?\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;
  return withoutPrefix.split(stopRe)[0].trim() || null;
}

function normaliseInvNum(n) {
  return (n || '').replace(/\//g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildSamplesIndex(dir) {
  if (!dir) return {};
  const index = {};
  for (const f of fs.readdirSync(dir)) {
    const rawNum = extractInvoiceNumberFromSample(f);
    if (!rawNum) continue;
    const key = normaliseInvNum(rawNum);
    if (!index[key]) index[key] = [];
    index[key].push({ filepath: path.join(dir, f), filename: f });
  }
  return index;
}

function findViaSamples(inv, index) {
  const key = normaliseInvNum(inv.invoiceNumber);
  const candidates = index[key];
  if (!candidates?.length) return null;
  if (candidates.length === 1) return candidates[0];
  if (inv.userName) {
    const parts = inv.userName.toLowerCase().split(/\s+/).filter(p => p.length > 2);
    const match = candidates.find(c => parts.some(p => c.filename.toLowerCase().includes(p)));
    if (match) return match;
  }
  return [...candidates].sort((a, b) => a.filename.length - b.filename.length)[0];
}

// ─── Storage upload with retry ────────────────────────────────────────────────

async function attachToInvoice(invoiceId, buffer, filename) {
  const ext         = (filename.match(/\.([a-zA-Z0-9]+)$/) || [])[1]?.toLowerCase() || 'pdf';
  const contentType = MIME_MAP[ext] || 'application/octet-stream';
  const storagePath = `${invoiceId}/original.${ext}`;

  let uploadErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.storage
      .from('invoice-attachments')
      .upload(storagePath, buffer, { contentType, upsert: true });
    if (!error) { uploadErr = null; break; }
    uploadErr = error;
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
  }
  if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

  const { error: updateErr } = await supabase
    .from('invoices')
    .update({ attachment_path: storagePath })
    .eq('id', invoiceId);

  if (updateErr) throw new Error(`DB update failed: ${updateErr.message}`);
  return storagePath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Diagnostic: just list folders and exit
  if (LIST_FOLDERS) {
    const folders = await listAllBoxes();
    console.log('IMAP folders:\n' + folders.map(f => `  ${f}`).join('\n'));
    return;
  }

  if (SAMPLES_DIR) console.log(`Samples dir : ${SAMPLES_DIR}`);
  const samplesIndex = buildSamplesIndex(SAMPLES_DIR);
  console.log(`Sample index: ${Object.keys(samplesIndex).length} distinct invoice numbers\n`);

  console.log('Fetching invoices with missing attachments…');
  const invoices = await getInvoicesNeedingAttachment();
  if (!invoices.length) { console.log('Nothing to do.'); return; }
  console.log(`Found ${invoices.length} invoice(s)\n`);

  // Phase 1: resolve from samples
  const resolved  = new Map();
  const needsImap = [];

  for (const inv of invoices) {
    const match = findViaSamples(inv, samplesIndex);
    if (match) {
      const count = samplesIndex[normaliseInvNum(inv.invoiceNumber)]?.length || 1;
      resolved.set(inv.id, {
        buffer:   fs.readFileSync(match.filepath),
        filename: match.filename,
        source:   count > 1 ? `samples→${match.filename}` : 'samples',
        inv,
      });
    } else {
      needsImap.push(inv);
    }
  }

  console.log(`Samples resolved: ${resolved.size}  |  Need IMAP: ${needsImap.length}\n`);

  // Phase 2: IMAP full scan across all folders
  if (needsImap.length) {
    const wantedNames = new Set(
      needsImap.map(i => (i.attachmentName || '').toLowerCase()).filter(Boolean)
    );

    console.log(`Looking for attachments:\n${[...wantedNames].slice(0, 5).map(n => `  ${n}`).join('\n')}${wantedNames.size > 5 ? `\n  … (${wantedNames.size} total)` : ''}\n`);

    const imapIndex = await buildImapIndex(wantedNames, DUMP_ATTS);

    for (const inv of needsImap) {
      const key    = (inv.attachmentName || '').toLowerCase();
      const buffer = imapIndex[key];
      if (buffer) {
        resolved.set(inv.id, { buffer, filename: inv.attachmentName, source: 'IMAP', inv });
      }
    }
  }

  // Phase 3: upload
  let ok = 0, notFound = 0, failed = 0;

  for (const inv of invoices) {
    const label = `[${inv.id}] ${inv.invoiceNumber} | ${inv.userName} | ${inv.periodStart}`;
    process.stdout.write(`→ ${label} … `);

    const entry = resolved.get(inv.id);
    if (!entry) {
      console.log(`⚠ not found  (wanted: ${inv.attachmentName || 'unknown'})`);
      notFound++;
      continue;
    }

    try {
      const p = await attachToInvoice(inv.id, entry.buffer, entry.filename);
      console.log(`✅ ${p}  [${entry.source}]`);
      ok++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      failed++;
    }
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Attached : ${ok}`);
  console.log(`Not found: ${notFound}`);
  console.log(`Errors   : ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
