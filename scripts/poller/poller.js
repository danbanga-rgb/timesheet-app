// ============================================================
// poller.js — Synergie Timesheet Email Poller
// Runs hourly via GitHub Actions cron.
// Fetches UNSEEN emails, parses XLSX/PDF, posts to edge function.
// ============================================================

'use strict';

const Imap             = require('imap');
const { simpleParser } = require('mailparser');
const XLSX             = require('xlsx');
const https            = require('https');
const http             = require('http');

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  imapUser:     process.env.IMAP_USER || 'timesheets@mysynergie.net',
  imapPass:     process.env.IMAP_PASS,
  imapHost:     process.env.IMAP_HOST || 'imap.ionos.com',
  imapPort:     parseInt(process.env.IMAP_PORT || '993'),
  ingestUrl:    process.env.INGEST_URL,
  ingestSecret: process.env.INGEST_SECRET,
  internalForwarders: (process.env.INTERNAL_FORWARDERS ||
    'contracts@synergietechsolutions.com,accounting@synergietechsolutions.com,lpinto@synergietechsolutions.com,helpdesk@synergietechsolutions.com'
  ).split(',').map(s => s.trim().toLowerCase()),
  fallbackEmail: process.env.IMPORT_FALLBACK_EMAIL || 'helpdesk@synergietechsolutions.com',
  // These addresses are never treated as contractors (internal staff / system)
  blockedContractorDomains: ['synergietechsolutions.com', 'ionos.com'],
  blockedContractorEmails: (process.env.BLOCKED_CONTRACTOR_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
};

const missing = ['imapPass','ingestUrl','ingestSecret'].filter(k => !CONFIG[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.map(k => k.toUpperCase()).join(', ')}`);
  process.exit(1);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
const DAY_ORDER = ['mon','tue','wed','thu','fri'];

const DMARC_PATTERNS = [/dmarc/i, /noreply@.*dmarc/i, /dmarcreport@/i, /postmaster@/i];

const FWD_PATTERNS = [
  /from:\s*([^<\n]*?)\s*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/gi,
  /from:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi,
  /\[mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\]/gi,
];

const WEEK_PATTERNS = [
  /week\s+of\s+([a-z]+ \d{1,2}(?:,?\s*\d{4})?)/gi,
  /w\/e\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi,
  /week\s+ending\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi,
  /week\s+ending\s+([a-z]+ \d{1,2}(?:,?\s*\d{4})?)/gi,
  /(\d{1,2}[\/\-]\d{1,2})\s*[-to]+\s*(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi,
  /([a-z]+ \d{1,2})\s*[-]\s*([a-z]+ \d{1,2},?\s*\d{4})/gi,
  /client\s+billable\s+hours\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
];

const HOURS_PATTERNS = [
  /(mon(?:day)?)[:\s\-]+(\d+\.?\d*)/gi,
  /(tue(?:sday)?)[:\s\-]+(\d+\.?\d*)/gi,
  /(wed(?:nesday)?)[:\s\-]+(\d+\.?\d*)/gi,
  /(thu(?:rsday)?)[:\s\-]+(\d+\.?\d*)/gi,
  /(fri(?:day)?)[:\s\-]+(\d+\.?\d*)/gi,
];

// ─── Sender / name helpers ────────────────────────────────────────────────────

function getMondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function isDmarc(email, subject) {
  return DMARC_PATTERNS.some(p => p.test(email) || p.test(subject));
}

function isInternal(email) {
  const lower = (email || '').toLowerCase();
  if (CONFIG.internalForwarders.includes(lower)) return true;
  return (lower.split('@')[1] || '') === 'synergietechsolutions.com';
}

function isBlockedContractor(email) {
  const lower = (email || '').toLowerCase();
  if (CONFIG.blockedContractorEmails.includes(lower)) return true;
  const domain = lower.split('@')[1] || '';
  return CONFIG.blockedContractorDomains.includes(domain);
}

// Extract email + name from forwarded body headers
// Returns { email, name } — name may be null
function extractSenderFromBody(text) {
  const skip = [CONFIG.imapUser.toLowerCase()];

  // Pattern 1: From: Display Name <email@domain>
  const namedPattern = /from:\s*([^<\n\r]{1,60}?)\s*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/gi;
  namedPattern.lastIndex = 0;
  let m;
  while ((m = namedPattern.exec(text)) !== null) {
    const name  = m[1].replace(/["']/g, '').trim();
    const email = m[2].toLowerCase();
    if (!isInternal(email) && !isBlockedContractor(email) && !skip.includes(email)) {
      return { email, name: name || null };
    }
  }

  // Pattern 2: From: email@domain (no display name)
  const barePattern = /from:\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  barePattern.lastIndex = 0;
  while ((m = barePattern.exec(text)) !== null) {
    const email = m[1].toLowerCase();
    if (!isInternal(email) && !isBlockedContractor(email) && !skip.includes(email)) {
      return { email, name: null };
    }
  }

  // Pattern 3: [mailto:email]
  const mailtoPattern = /\[mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\]/gi;
  mailtoPattern.lastIndex = 0;
  while ((m = mailtoPattern.exec(text)) !== null) {
    const email = m[1].toLowerCase();
    if (!isInternal(email) && !isBlockedContractor(email) && !skip.includes(email)) {
      return { email, name: null };
    }
  }

  return null;
}

// Extract name from XLSX Name: cell (row 3, col 2 in Synergie template)
function extractNameFromXlsx(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    for (let i = 0; i < Math.min(json.length, 6); i++) {
      const row = json[i].map(c => String(c).trim());
      const lowers = row.map(c => c.toLowerCase());
      // Find "Name:" label — value is usually 2 cells to the right
      const nameIdx = lowers.findIndex(c => c === 'name:' || c === 'name');
      if (nameIdx >= 0) {
        for (let j = nameIdx + 1; j < row.length; j++) {
          const val = row[j].trim();
          // Must look like a real name: has a space, not a date/number
          if (val && val.includes(' ') && !/^\d/.test(val) && val.length > 3) {
            return val;
          }
        }
      }
    }
  } catch {}
  return null;
}

// Extract name from XLSX filename (strip dates and common suffixes)
function extractNameFromFilename(filename) {
  // Remove extension
  let name = filename.replace(/\.(xlsx|xls|pdf)$/i, '');
  // Remove date-like patterns: 27apr, 03may, 2026, 27Apr-03May, 05032026 etc
  name = name.replace(/\d{1,2}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\d*/gi, '');
  name = name.replace(/\d{4}/g, '');
  name = name.replace(/\d{1,2}[\/\-]\d{1,2}/g, '');
  // Remove common prefixes/suffixes
  name = name.replace(/^(timesheet|timesheets?|synergie\s*timesheet|weekly\s*timesheet|apfm_timesheet)[_\s\-]*/i, '');
  name = name.replace(/[_\s\-]*(timesheet|timesheets?|kopija|copy)$/i, '');
  // Remove leading numbers like "6. "
  name = name.replace(/^\d+\.\s*/, '');
  // Clean up separators
  name = name.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Must have a space (first + last name) and be reasonable length
  if (name && name.includes(' ') && name.length > 3 && name.length < 60) {
    // Title case
    return name.replace(/\b\w/g, c => c.toUpperCase());
  }
  return null;
}

// Derive best possible name from all available sources
// Returns best name string
function bestName(sources) {
  // sources is array of { name, priority } — pick highest priority non-null
  // Priority: xlsx_content > email_display > filename > email_prefix
  for (const { name } of sources) {
    if (name && name.trim() && name.includes(' ') && name.length > 3) {
      return name.trim();
    }
  }
  // Fallback: use first non-null name even if no space
  for (const { name } of sources) {
    if (name && name.trim() && name.length > 1) return name.trim();
  }
  return null;
}

// Detect if a stored name looks auto-generated from email prefix
// (worth replacing with a better name)
function isAutoGeneratedName(name, email) {
  if (!name) return true;
  const prefix = (email || '').split('@')[0].toLowerCase();
  const nameLower = name.toLowerCase().replace(/\s/g, '');
  // Exact match with email prefix (no spaces)
  if (nameLower === prefix) return true;
  // No space = single word = likely auto-generated
  if (!name.includes(' ')) return true;
  // All same case (all lower or all upper)
  if (name === name.toLowerCase() || name === name.toUpperCase()) return true;
  return false;
}

// ─── Week detection ───────────────────────────────────────────────────────────

function expandTwoDigitYear(str) {
  return str.replace(/(\d{1,2}\/\d{1,2}\/)(\d{2})$/, (_, pre, yy) =>
    pre + (parseInt(yy) < 50 ? `20${yy}` : `19${yy}`)
  );
}

function weekFromFilename(name) {
  const m = name.match(/(\d{1,2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (m) {
    const d = new Date(new Date().getFullYear(), MONTH_MAP[m[2].toLowerCase()], parseInt(m[1]));
    if (!isNaN(d.getTime())) return getMondayOf(d);
  }
  const m2 = name.match(/(\d{2})(\d{2})(\d{4})/);
  if (m2) {
    const d = new Date(`${m2[3]}-${m2[1]}-${m2[2]}`);
    if (!isNaN(d.getTime())) return getMondayOf(d);
  }
  const m3 = name.match(/(\d{4}-\d{2}-\d{2})/);
  if (m3) {
    const d = new Date(m3[1]);
    if (!isNaN(d.getTime())) return getMondayOf(d);
  }
  return null;
}

function detectWeek(subject, body, xlsxNames) {
  const sources = [
    { text: subject, src: 'subject' },
    { text: (body || '').slice(0, 2000), src: 'body' },
  ];
  for (const { text, src } of sources) {
    for (const pat of WEEK_PATTERNS) {
      pat.lastIndex = 0;
      const m = pat.exec(text);
      if (m) {
        try {
          const raw = expandTwoDigitYear(m[1]);
          for (const ds of [`${raw} ${new Date().getFullYear()}`, raw]) {
            const d = new Date(ds);
            if (!isNaN(d.getTime())) return { week: getMondayOf(d), by: src };
          }
        } catch {}
      }
    }
  }
  for (const name of (xlsxNames || [])) {
    const w = weekFromFilename(name);
    if (w) return { week: w, by: `filename(${name})` };
  }
  return { week: getMondayOf(new Date()), by: 'fallback' };
}

// ─── XLSX parser ──────────────────────────────────────────────────────────────

function parseXlsx(buffer, filename) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const results = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      let weekStartDate = null;
      let dayLabelRowIdx = -1;
      const hours = {};
      let total = null;
      let nameFromSheet = null;

      for (let i = 0; i < json.length; i++) {
        const cells = json[i].map(c =>
          String(c instanceof Date ? c.toLocaleDateString() : c).trim()
        );
        const lowers = cells.map(c => c.toLowerCase());
        const rowText = lowers.join(' ');

        // Extract name from Name: row (rows 0-6)
        if (!nameFromSheet && i < 7) {
          const nameIdx = lowers.findIndex(c => c === 'name:' || c === 'name');
          if (nameIdx >= 0) {
            for (let j = nameIdx + 1; j < cells.length; j++) {
              const val = cells[j].trim();
              if (val && val.includes(' ') && !/^\d/.test(val) && val.length > 3) {
                nameFromSheet = val;
                break;
              }
            }
          }
        }

        // Date row — week start from first valid date
        if (!weekStartDate && dayLabelRowIdx === -1) {
          const dateCells = cells.filter(c => {
            const d = new Date(c);
            return !isNaN(d.getTime()) &&
              (c.includes('/') || c.includes('-')) &&
              c.match(/\d{4}/) &&
              d.getFullYear() >= 2020;
          });
          if (dateCells.length >= 5) {
            const d = new Date(dateCells[0]);
            if (!isNaN(d.getTime())) weekStartDate = getMondayOf(d);
          }
        }

        // Week Ending Date fallback — requires 4-digit year to avoid version numbers
        if (!weekStartDate && rowText.includes('week ending date')) {
          for (const cell of cells) {
            if (!cell.includes('/') || cell.split('/').length < 3) continue;
            const d = new Date(cell);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
              const end = new Date(d);
              end.setDate(end.getDate() - 6);
              weekStartDate = end.toISOString().split('T')[0];
              break;
            }
          }
        }

        // Day label row → scan forward for hours row
        const hasMon = lowers.includes('mon') || lowers.includes('monday');
        const hasFri = lowers.includes('fri') || lowers.includes('friday');
        if (hasMon && hasFri && dayLabelRowIdx === -1) {
          dayLabelRowIdx = i;
          for (let offset = 1; offset <= 5; offset++) {
            const dataRow = json[i + offset];
            if (!dataRow) break;
            const dataCells = dataRow.map(c =>
              String(c instanceof Date ? c.toLocaleDateString() : c).trim()
            );
            const numericCount = dataCells.filter(c => {
              const n = parseFloat(c);
              return !isNaN(n) && n >= 0 && n <= 24 && c !== '';
            }).length;
            if (numericCount >= 5) {
              for (const dk of DAY_ORDER) {
                const colIdx = lowers.findIndex(l => l === dk || l === dk + 'day');
                if (colIdx >= 0) {
                  const val = parseFloat(dataCells[colIdx]);
                  if (!isNaN(val) && val >= 0 && val <= 24) hours[dk] = val;
                }
              }
              const totalIdx = lowers.findIndex(l => l === 'total');
              if (totalIdx >= 0) {
                const t = parseFloat(dataCells[totalIdx]);
                if (!isNaN(t)) total = t;
              }
              break;
            }
          }
        }
      }

      if (Object.keys(hours).length > 0 && weekStartDate) {
        if (!total) total = Object.values(hours).reduce((s, h) => s + h, 0);
        const entries = {};
        const base = new Date(weekStartDate + 'T12:00:00Z');
        DAY_ORDER.forEach((d, i) => {
          const dt = new Date(base);
          dt.setUTCDate(base.getUTCDate() + i);
          entries[dt.toISOString().split('T')[0]] = hours[d] || 0;
        });
        results.push({
          weekStart: weekStartDate,
          entries,
          total,
          nameFromSheet,
          notes: `Sheet: ${sheetName}`,
        });
      }
    }
    return results;
  } catch (e) {
    console.warn(`XLSX parse error: ${e.message}`);
    return [];
  }
}

// ─── PDF parser ───────────────────────────────────────────────────────────────

async function parsePdf(buffer, filename) {
  try {
    const pdfPkg = require('pdf-parse');
    const PDFParse = pdfPkg.PDFParse || (pdfPkg.default && pdfPkg.default.PDFParse);
    if (!PDFParse) {
      console.warn(`PDF parsing unavailable for ${filename}`);
      return [];
    }
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const parser = new PDFParse({ data: buf, verbosity: 0 });
    await parser.load();
    const textResult = await parser.getText();
    const text = textResult?.text || '';
    if (!text || text.length < 10) return [];

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const hours = {};
    let total = null;
    let weekStartDate = null;
    let nameFromPdf = null;

    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();

      // Extract name — look for "Signature: Name" or "Signature/Name: Name"
      if (!nameFromPdf && (lower.includes('signature') && lower.includes('name'))) {
        const next = lines[i + 1] || '';
        if (next && next.includes(' ') && !/^\d/.test(next) && next.length > 3 && next.length < 60) {
          nameFromPdf = next.trim();
        }
      }

      // Week start from date header
      if (!weekStartDate && lower.includes('client billable hours')) {
        const dateMatch = lines[i].match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (dateMatch) {
          const raw = expandTwoDigitYear(dateMatch[1]);
          const d = new Date(raw);
          if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
            weekStartDate = getMondayOf(d);
          }
        }
      }

      // Day label row → scan forward for hours
      if (lower.includes('mon') && lower.includes('fri') && Object.keys(hours).length === 0) {
        for (let offset = 1; offset <= 5; offset++) {
          const nextLine = lines[i + offset] || '';
          const nums = (nextLine.match(/\d+\.?\d*/g) || []).map(parseFloat)
            .filter(n => !isNaN(n) && n >= 0 && n <= 24);
          if (nums.length >= 5) {
            DAY_ORDER.forEach((d, idx) => { hours[d] = nums[idx]; });
            if (nums.length >= 8) total = nums[7];
            break;
          }
        }
      }
    }

    // Named day patterns fallback
    if (Object.keys(hours).length === 0) {
      for (const pat of HOURS_PATTERNS) {
        pat.lastIndex = 0;
        let m;
        while ((m = pat.exec(text)) !== null) {
          hours[m[1].toLowerCase().slice(0, 3)] = parseFloat(m[2]);
        }
      }
    }

    if (!weekStartDate) weekStartDate = weekFromFilename(filename);

    if (Object.keys(hours).length > 0 && weekStartDate) {
      if (!total) total = Object.values(hours).reduce((s, h) => s + h, 0);
      const entries = {};
      const base = new Date(weekStartDate + 'T12:00:00Z');
      DAY_ORDER.forEach((d, i) => {
        const dt = new Date(base);
        dt.setUTCDate(base.getUTCDate() + i);
        entries[dt.toISOString().split('T')[0]] = hours[d] || 0;
      });
      return [{ weekStart: weekStartDate, entries, total, nameFromSheet: nameFromPdf, notes: `PDF: ${filename}` }];
    }
    return [];
  } catch (e) {
    console.warn(`PDF parse error for ${filename}: ${e.message}`);
    return [];
  }
}

// ─── HTTP POST to edge function ───────────────────────────────────────────────

function postToIngest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(CONFIG.ingestUrl);
    const isHttps = url.protocol === 'https:';
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-ingest-secret': CONFIG.ingestSecret,
      },
    };
    const req = (isHttps ? https : http).request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

// ─── Process one contractor's attachments ─────────────────────────────────────

async function ingestContractor(contractorEmail, displayName, subject, bodyText, attachments, messageId) {
  const xlsxAtts = attachments.filter(a => a.isXlsx);
  const pdfAtts  = attachments.filter(a => a.isPdf && !a.name.toLowerCase().match(/invoice|billing/i));
  const timesheets = [];

  for (const att of xlsxAtts) {
    const parsed = parseXlsx(att.buffer, att.name);
    for (const ts of parsed) {
      // Best name: XLSX sheet > email display name > filename > email prefix
      const name = bestName([
        { name: ts.nameFromSheet },
        { name: displayName },
        { name: extractNameFromFilename(att.name) },
      ]);
      timesheets.push({ ...ts, attachmentName: att.name, attachmentType: 'xlsx', resolvedName: name });
    }
  }

  for (const att of pdfAtts) {
    const parsed = await parsePdf(att.buffer, att.name);
    for (const ts of parsed) {
      const name = bestName([
        { name: ts.nameFromSheet },
        { name: displayName },
        { name: extractNameFromFilename(att.name) },
      ]);
      timesheets.push({ ...ts, attachmentName: att.name, attachmentType: 'pdf', resolvedName: name });
    }
  }

  // No attachments parsed but we have a contractor — log partial
  if (timesheets.length === 0) {
    const { week, by } = detectWeek(subject, bodyText, []);
    timesheets.push({
      weekStart: week,
      entries: null,
      total: null,
      attachmentName: null,
      attachmentType: 'body',
      resolvedName: displayName,
      notes: `No attachment parsed — week from ${by}`,
    });
  }

  const results = [];
  for (const ts of timesheets) {
    try {
      const res = await postToIngest({
        messageId:       `${messageId}::${ts.attachmentName || 'body'}`,
        contractorEmail,
        contractorName:  ts.resolvedName,
        subject,
        weekStart:       ts.weekStart,
        entries:         ts.entries,
        total:           ts.total,
        attachmentName:  ts.attachmentName,
        attachmentType:  ts.attachmentType,
        parseNotes:      ts.notes || '',
        source:          'imported',
      });
      const action = res.body?.action || res.status;
      results.push({ contractor: contractorEmail, week: ts.weekStart, status: res.status, action });
      console.log(`  ✅ ${contractorEmail} | ${ts.weekStart} | ${ts.attachmentName || 'body'} → ${action}`);
    } catch (e) {
      results.push({ contractor: contractorEmail, week: ts.weekStart, error: e.message });
      console.error(`  ❌ ${contractorEmail} | ${ts.weekStart} → ${e.message}`);
    }
  }
  return results;
}

// ─── Process one parsed email ─────────────────────────────────────────────────

async function processEmail(parsed, messageId, results) {
  const fromAddr  = parsed.from?.value?.[0];
  const fromEmail = (fromAddr?.address || '').toLowerCase();
  const fromName  = fromAddr?.name || null;
  const subject   = parsed.subject || '(no subject)';
  const bodyText  = parsed.text || (parsed.html || '').replace(/<[^>]+>/g, ' ');

  const attachments = (parsed.attachments || []).map(a => ({
    name:   a.filename || 'unnamed',
    buffer: a.content,
    isXlsx: !!(a.contentType?.includes('spreadsheet') || (a.filename||'').match(/\.(xlsx|xls)$/i)),
    isPdf:  !!(a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i)),
    isEml:  !!(a.contentType?.includes('message/rfc822') || (a.filename||'').match(/\.eml$/i)),
  }));

  // ── DMARC ──────────────────────────────────────────────────────────────────
  if (isDmarc(fromEmail, subject)) {
    console.log(`  🗑️  DMARC: ${subject} — skipped`);
    results.push({ type: 'dmarc', subject, action: 'skipped' });
    return;
  }

  const emlAtts = attachments.filter(a => a.isEml);
  const hasTimesheetContent = attachments.some(a => a.isXlsx || a.isPdf || a.isEml);

  // ── No timesheet content — skip ────────────────────────────────────────────
  if (!hasTimesheetContent) {
    console.log(`  ⏭️  Skipped (no attachments): ${subject}`);
    results.push({ type: 'skipped', subject, reason: 'no timesheet attachments' });
    return;
  }

  // ── BATCH: .eml attachments ────────────────────────────────────────────────
  if (emlAtts.length > 0) {
    console.log(`\n📬 Batch email: ${subject} (${emlAtts.length} .eml attachments)`);
    for (const emlAtt of emlAtts) {
      try {
        const inner      = await simpleParser(emlAtt.buffer);
        const innerAddr  = inner.from?.value?.[0];
        const innerEmail = (innerAddr?.address || '').toLowerCase();
        const innerName  = innerAddr?.name || null;
        const innerBody  = inner.text || '';
        const innerAtts  = (inner.attachments || []).map(a => ({
          name:   a.filename || 'unnamed',
          buffer: a.content,
          isXlsx: !!(a.contentType?.includes('spreadsheet') || (a.filename||'').match(/\.(xlsx|xls)$/i)),
          isPdf:  !!(a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i)),
          isEml:  false,
        }));

        // Contractor = inner From: (unless internal/blocked, then extract from body)
        let contractor = null;
        let contractorName = null;

        if (innerEmail && !isInternal(innerEmail) && !isBlockedContractor(innerEmail)) {
          contractor = innerEmail;
          contractorName = innerName;
        } else {
          const extracted = extractSenderFromBody(innerBody);
          if (extracted) {
            contractor = extracted.email;
            contractorName = extracted.name;
          }
        }

        if (!contractor) {
          console.warn(`  ⚠️  Cannot identify contractor in ${emlAtt.name}`);
          results.push({ type: 'eml', emlName: emlAtt.name, error: 'could not identify contractor' });
          continue;
        }

        if (isBlockedContractor(contractor)) {
          console.log(`  ⏭️  Blocked contractor in ${emlAtt.name}: ${contractor}`);
          results.push({ type: 'skipped', reason: `blocked: ${contractor}` });
          continue;
        }

        console.log(`  📧 ${contractor}${contractorName ? ` (${contractorName})` : ''}`);
        const r = await ingestContractor(
          contractor, contractorName, inner.subject || subject, innerBody, innerAtts, messageId
        );
        results.push(...r);
      } catch (e) {
        console.error(`  ❌ Error parsing ${emlAtt.name}: ${e.message}`);
        results.push({ type: 'eml', emlName: emlAtt.name, error: e.message });
      }
    }
    return;
  }

  // ── Single forward / direct email ─────────────────────────────────────────
  let contractor = null;
  let contractorName = null;

  if (isInternal(fromEmail)) {
    // Extract contractor from forwarded body
    const extracted = extractSenderFromBody(bodyText);
    if (!extracted) {
      console.warn(`  ⚠️  Cannot extract contractor from: ${subject}`);
      results.push({ type: 'forward', subject, error: 'could not identify contractor' });
      return;
    }
    contractor = extracted.email;
    contractorName = extracted.name;
  } else {
    // Direct email from contractor
    contractor = fromEmail;
    contractorName = fromName;
  }

  if (isBlockedContractor(contractor)) {
    console.log(`  ⏭️  Blocked contractor: ${contractor} — ${subject}`);
    results.push({ type: 'skipped', subject, reason: `blocked: ${contractor}` });
    return;
  }

  console.log(`\n📧 ${subject}`);
  console.log(`   Contractor: ${contractor}${contractorName ? ` (${contractorName})` : ''}`);
  const r = await ingestContractor(
    contractor, contractorName, subject, bodyText,
    attachments.filter(a => !a.isEml), messageId
  );
  results.push(...r);
}

// ─── IMAP fetch ───────────────────────────────────────────────────────────────

function fetchEmails() {
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
      imap.openBox('INBOX', false, (err, box) => {
        if (err) return reject(err);
        imap.search(['UNSEEN'], (err, uids) => {
          if (err) return reject(err);
          if (!uids || uids.length === 0) { imap.end(); return resolve([]); }

          console.log(`Found ${uids.length} unseen email(s)`);
          const messages = [];
          const fetch = imap.fetch(uids, { bodies: '', markSeen: true });

          fetch.on('message', (msg, seq) => {
            const chunks = [];
            let uid = seq;
            msg.once('attributes', attrs => { uid = attrs.uid || seq; });
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Synergie Timesheet Poller');
  console.log(`   IMAP: ${CONFIG.imapUser}@${CONFIG.imapHost}`);
  console.log(`   Ingest: ${CONFIG.ingestUrl}\n`);

  const rawMessages = await fetchEmails();
  if (rawMessages.length === 0) {
    console.log('No unseen emails. Done.');
    return;
  }

  const results = [];
  for (const raw of rawMessages) {
    try {
      const parsed = await simpleParser(raw.buffer);
      const messageId = parsed.messageId || `uid-${raw.uid}-${Date.now()}`;
      await processEmail(parsed, messageId, results);
    } catch (e) {
      console.error(`Error processing uid=${raw.uid}: ${e.message}`);
      results.push({ error: e.message, uid: raw.uid });
    }
  }

  console.log('\n─── Summary ──────────────────────────────────────────────');
  const success = results.filter(r => r.status >= 200 && r.status < 300).length;
  const failed  = results.filter(r => r.error || (r.status && r.status >= 400)).length;
  const skipped = results.filter(r => r.type === 'skipped' || r.type === 'dmarc').length;
  console.log(`  Emails processed : ${rawMessages.length}`);
  console.log(`  Timesheets sent  : ${success}`);
  console.log(`  Skipped          : ${skipped}`);
  console.log(`  Errors           : ${failed}`);
  if (failed > 0) {
    results.filter(r => r.error || (r.status && r.status >= 400))
      .forEach(r => console.error(`  ❌ ${r.contractor || r.emlName || '?'}: ${r.error || r.status}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
