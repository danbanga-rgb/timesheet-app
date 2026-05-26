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
  // Invoice ingestion — INVOICE_INGEST_ENABLED must be explicitly 'true' to write to DB.
  // Leave unset for dry-run mode: invoices are parsed and reported but not stored.
  invoiceIngestUrl:     process.env.INVOICE_INGEST_URL || null,
  invoiceIngestEnabled: process.env.INVOICE_INGEST_ENABLED === 'true',
  internalForwarders: (process.env.INTERNAL_FORWARDERS ||
    'contracts@synergietechsolutions.com,accounting@synergietechsolutions.com,lpinto@synergietechsolutions.com,helpdesk@synergietechsolutions.com'
  ).split(',').map(s => s.trim().toLowerCase()),
  fallbackEmail: process.env.IMPORT_FALLBACK_EMAIL || 'helpdesk@synergietechsolutions.com',
  brevoApiKey:   process.env.BREVO_API_KEY,
  fromEmail:     process.env.FROM_EMAIL || 'timesheets@mysynergie.net',
  fromName:      process.env.FROM_NAME || 'Synergie Timesheet System',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  timesheetReportUrl: process.env.TIMESHEET_REPORT_URL || 'https://mimlatvdwxqtgxrgcins.supabase.co/functions/v1/send-timesheet-report',
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
const DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun'];

const DMARC_PATTERNS = [/dmarc/i, /noreply@.*dmarc/i, /dmarcreport@/i, /postmaster@/i];

const MAX_EMAILS_PER_RUN    = 30;        // layer 3: volume cap
const MAX_ATTACHMENT_BYTES  = 10 * 1024 * 1024; // layer 4: 10 MB per attachment

// Derived from ingestUrl — same Supabase project
const SUPABASE_REST_URL  = (CONFIG.ingestUrl || '').replace(/\/functions\/v1\/.*$/, '/rest/v1');
const SUPABASE_ANON_KEY  = 'sb_publishable_qYa4tmVYu2zsIZfUhvT7hg_UaGgAgKc';

// Filenames that are never timesheets — filter silently so they don't appear as failures.
// No outer \b wrappers — many patterns appear mid-word or before digits (e.g. "SOW002", "AUP.pdf").
const NON_TIMESHEET_DOC_RE = /agreement|acceptable.use|genworth|acknowledgem[ae]nt|aup|sow\b|sow\d|statement.of.work|confirmation.letter|account.confirmation|consolidated.report|_signed\.pdf$/i;

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

// ─── MIME encoded-word decoder (RFC 2047) ─────────────────────────────────────
// Forwarded email bodies contain raw MIME words like =?UTF-8?Q?Name?= as plain
// text — mailparser only decodes these in real headers, not in body text.

function decodeMimeWords(str) {
  if (!str || !str.includes('=?')) return str;
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        bytes = Buffer.from(text, 'base64');
      } else {
        // Quoted-printable: _ → space, =XX → byte
        const qp = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16))
        );
        bytes = Buffer.from(qp, 'binary');
      }
      return bytes.toString(charset.toLowerCase().replace('utf-8', 'utf8'));
    } catch {
      return text; // leave undecoded rather than crash
    }
  });
}

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

// Layer 1: check if a resolved contractor email exists in profiles.
// Fails open (returns true) on network errors so legitimate timesheets
// are never silently dropped due to a transient Supabase hiccup.
async function isKnownContractor(email) {
  if (!SUPABASE_REST_URL || !email) return true;
  try {
    // Use a SECURITY DEFINER RPC so the anon key can check existence
    // without being blocked by RLS on the profiles table.
    const res = await fetch(
      `${SUPABASE_REST_URL}/rpc/profile_email_exists`,
      {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_email: email }),
      }
    );
    if (!res.ok) return true; // fail open on API error
    const data = await res.json();
    return data === true;
  } catch {
    return true;
  }
}

// Extract email + name from forwarded body headers
// Returns { email, name } — name may be null
function extractSenderFromBody(text) {
  const skip = [CONFIG.imapUser.toLowerCase()];

  // Pattern 1: From: Display Name <email@domain>
  const namedPattern = /from:\s*([^<\n\r]{1,120}?)\s*<([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/gi;
  namedPattern.lastIndex = 0;
  let m;
  while ((m = namedPattern.exec(text)) !== null) {
    const name  = decodeMimeWords(m[1].replace(/["']/g, '').trim());
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
    // Title case — use Unicode-aware split so accented first chars (Č, Š, Đ...) capitalise correctly
    return name.split(' ').map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
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

// Convert European dot format: 26.4.2026. → 4/26/2026
function normaliseDate(str) {
  if (!str) return str;
  // Match DD.MM.YYYY. or D.M.YYYY. (trailing dot optional)
  const euroMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (euroMatch) {
    return `${euroMatch[2]}/${euroMatch[1]}/${euroMatch[3]}`;
  }
  return str;
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
  const m3 = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m3) {
    // Use local-noon construction to avoid UTC-midnight timezone shift
    const d = new Date(+m3[1], +m3[2] - 1, +m3[3], 12, 0, 0);
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
          const raw = expandTwoDigitYear(normaliseDate(m[1]));
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

// Convert Excel serial number to JS Date (Excel epoch = Jan 1 1900, 1-indexed, with leap year bug)
function xlsxSerialToDate(serial) {
  if (typeof serial !== 'number' || serial < 40000 || serial > 60000) return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d;
}

function parseXlsx(buffer, filename) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const results = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      // Get raw values (numbers) AND formatted (dates as strings) in parallel
      const jsonRaw  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      const json     = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      let weekStartDate = null;
      let dayLabelRowIdx = -1;
      const hours = {};
      let total = null;
      let nameFromSheet = null;

      for (let i = 0; i < json.length; i++) {
        const rawCells = jsonRaw[i] || [];
        const cells = json[i].map((c, ci) => {
          // If raw cell is a number in plausible Excel date range → convert to date string
          if (typeof rawCells[ci] === 'number') {
            const asDate = xlsxSerialToDate(rawCells[ci]);
            if (asDate) return (asDate.getUTCMonth() + 1) + '/' + asDate.getUTCDate() + '/' + asDate.getUTCFullYear();
          }
          return String(c instanceof Date ? c.toLocaleDateString() : c).trim();
        });
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
        // Require >= 1 date (not 5) so partial-week templates (e.g. Fri–Sun only) still work.
        if (!weekStartDate && dayLabelRowIdx === -1) {
          const dateCells = cells.filter(c => {
            const d = new Date(c);
            return !isNaN(d.getTime()) &&
              (c.includes('/') || c.includes('-')) &&
              c.match(/\d{4}/) &&
              d.getFullYear() >= 2020;
          });
          if (dateCells.length >= 1) {
            const d = new Date(dateCells[0]);
            if (!isNaN(d.getTime())) weekStartDate = getMondayOf(d);
          }
        }

        // Week Ending Date fallback — requires 4-digit year to avoid version numbers
        if (!weekStartDate && rowText.includes('week ending date')) {
          for (const cell of cells) {
            const normalised = normaliseDate(cell);
            if (!normalised.includes('/') || normalised.split('/').length < 3) continue;
            const d = new Date(normalised);
            if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
              const end = new Date(d);
              end.setDate(end.getDate() - 6);
              weekStartDate = end.toISOString().split('T')[0];
              break;
            }
          }
        }

        // Day label row → scan forward for hours row
        // Require >= 3 day labels (not Mon+Fri specifically) so partial-week templates work.
        const dayLabelCount = DAY_ORDER.filter(d => lowers.includes(d) || lowers.includes(d + 'day')).length;
        if (dayLabelCount >= 3 && dayLabelRowIdx === -1) {
          dayLabelRowIdx = i;
          for (let offset = 1; offset <= 5; offset++) {
            const dataRow = json[i + offset];
            if (!dataRow) break;
            const dataCells = dataRow.map(c =>
              String(c instanceof Date ? c.toLocaleDateString() : c).trim()
            );
            const numericCount = dataCells.filter(c => {
              // Exclude date strings (contain / or - or .) — parseFloat('4/27/2026') = 4 which is a false positive
              if (/[\/\-]/.test(c) || (c.includes('.') && c.length > 4)) return false;
              const n = parseFloat(c);
              return !isNaN(n) && n >= 0 && n <= 24 && c !== '';
            }).length;
            if (numericCount >= 3) {
              for (const dk of DAY_ORDER) {
                const colIdx = lowers.findIndex(l => l === dk || l === dk + 'day');
                if (colIdx >= 0) {
                  // Strip non-numeric artifacts like '4800%' before parsing
                  const raw = String(dataCells[colIdx]).replace(/[^0-9.]/g, '');
                  const val = parseFloat(raw);
                  if (!isNaN(val) && val >= 0 && val <= 24) hours[dk] = val;
                }
              }
              const totalIdx = lowers.findIndex(l => l === 'total');
              if (totalIdx >= 0) {
                const raw = String(dataCells[totalIdx]).replace(/[^0-9.]/g, '');
                const t = parseFloat(raw);
                if (!isNaN(t) && t <= 168) total = t; // max 24h * 7 days
              }
              break;
            }
          }
        }
      }

      // If the XLSX-derived week is more than 6 months in the past, the template
      // likely has stale dates from a prior year. Fall back to the filename date.
      if (weekStartDate) {
        const weekAge = (Date.now() - new Date(weekStartDate).getTime()) / 86400000;
        if (weekAge > 180) {
          const filenameWeek = weekFromFilename(filename);
          if (filenameWeek) {
            console.warn(`XLSX: stale template date (${weekStartDate}), using filename date: ${filenameWeek}`);
            weekStartDate = filenameWeek;
          }
        }
      }

      // No date found anywhere in the sheet — try filename as last resort
      if (!weekStartDate) {
        const filenameWeek = weekFromFilename(filename);
        if (filenameWeek) {
          console.warn(`XLSX: no date in sheet, using filename: ${filenameWeek} (${filename})`);
          weekStartDate = filenameWeek;
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
        // Ensure all 7 days have entries (default 0 for missing days)
        const base7 = new Date(weekStartDate + 'T12:00:00Z');
        const fullEntries = {};
        ['mon','tue','wed','thu','fri','sat','sun'].forEach((d, i) => {
          const dt = new Date(base7);
          dt.setUTCDate(base7.getUTCDate() + i);
          const key = dt.toISOString().split('T')[0];
          fullEntries[key] = hours[d] !== undefined ? hours[d] : (entries[key] || 0);
        });
        results.push({
          weekStart: weekStartDate,
          entries: fullEntries,
          total: total || Object.values(fullEntries).reduce((s, h) => s + h, 0),
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

// ─── PDF parser — Synergie template ─────────────────────────────────────────────
// Handles concatenated hours in PDF text extraction, including 4800% artifact and
// European dot date formats. Uses total as constraint to backtrack-solve day values.

function parseSynergiePdfText(text, filename) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let weekEndingStr = null;
  let name = null;
  let total = null;
  let inHoursSection = false;

  // Section tracking: each complete "Mgr Name Signature → Total" block is one section.
  // When a PDF contains multiple timesheet tables (e.g. remnant from prior week + current
  // week), we collect all sections then pick the one matching the identified weekStart.
  const sections = [];      // [{ headerDates: Date[], hoursLines: [], total: null }]
  let currentSection = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Name: field
    if (!name && lower.startsWith('name:')) {
      const n = line.slice(5).trim();
      if (n && n.length > 1 && !/^\d/.test(n)) {
        name = n;
      } else if (lines[i + 1] && !/^\d/.test(lines[i + 1]) &&
                 !lines[i + 1].toLowerCase().startsWith('project')) {
        name = lines[i + 1].trim();
      }
    }

    // Week Ending Date — same line or next line
    // Handles: 4/19/2026, 12/4/2026, 3. 5. 2026., 3.5.2026.
    // Also handles reversed layout: "Remote4/19/2026Week Ending Date:"
    if (!weekEndingStr && lower.includes('week ending date')) {
      // Normal: date after keyword
      const m = line.match(/(\d{1,2}[\s]*[\/.][\s]*\d{1,2}[\s]*[\/.][\s]*\d{2,4}\.?)\s*$/);
      if (m) weekEndingStr = m[1].replace(/\s+/g, '');
      else {
        // Reversed: date before keyword on same line
        const m3 = line.match(/(\d{1,2}[\s]*[\/.][\s]*\d{1,2}[\s]*[\/.][\s]*\d{2,4}\.?)/);
        if (m3) weekEndingStr = m3[1].replace(/\s+/g, '');
        else if (lines[i + 1]) {
          const m2 = lines[i + 1].match(/^(\d{1,2}[\s]*[\/.][\s]*\d{1,2}[\s]*[\/.][\s]*\d{2,4}\.?)$/);
          if (m2) weekEndingStr = m2[1].replace(/\s+/g, '');
        }
      }
    }

    // "Client Billable Hours" date header — marks the start of a new timesheet section.
    // Format: "Client Billable Hours5/4/265/5/265/6/265/7/265/8/265/9/265/10/26"
    // Dates are M/D/YY concatenated (no spaces), so we derive the year from the end of the
    // line and use a lookahead to separate each date from the next date's leading month digit.
    if (lower.startsWith('client billable hours') && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) {
      const yrMatch = line.match(/\/(\d{2,4})$/);
      const yrStr   = yrMatch?.[1] ?? null;
      const year    = yrStr ? (yrStr.length <= 2 ? 2000 + +yrStr : +yrStr) : null;
      let headerDates = [];
      if (year && year >= 2020) {
        const re = new RegExp(`(\\d{1,2})\\/(\\d{1,2})\\/${yrStr}(?=\\d|$)`, 'g');
        headerDates = [...line.matchAll(re)].map(m => new Date(year, +m[1] - 1, +m[2]))
          .filter(d => !isNaN(d.getTime()) && d.getFullYear() >= 2020);
      }
      currentSection = { headerDates, hoursLines: [], total: null };
      inHoursSection = false;
    }

    // Total Client Billable Hours — closes the current section
    if (lower.includes('total client billable hours')) {
      const cleaned = line.replace(/[^0-9.%]/g, '');
      let t = parseFloat(cleaned.replace(/%/g, ''));
      // 4800% artifact: divide by 100 if result > 168 and divisible cleanly
      if (!isNaN(t) && t > 168) t = t / 100;
      if (!isNaN(t) && t > 0 && t <= 168) {
        total = t; // keep for downstream use
        if (!currentSection) currentSection = { headerDates: [], hoursLines: [], total: null };
        currentSection.total = t;
        sections.push(currentSection);
        currentSection = null;
      }
      inHoursSection = false;
    }

    // Hours section: between "Mgr Name Signature" and "Total Client Billable"
    if ((lower.includes('mgr name') || lower.includes('client manager name')) &&
        lower.includes('signature')) {
      // Ensure a section exists even when no "Client Billable Hours" date header was found
      // (PDFs where that header has no concatenated dates, or uses a different format).
      if (!currentSection) currentSection = { headerDates: [], hoursLines: [], total: null };
      inHoursSection = true;
      continue;
    }
    if (inHoursSection) {
      if (lower.includes('total client billable') || lower.includes('certify') ||
          lower.startsWith('signature:')) {
        inHoursSection = false;
        continue;
      }
      if (currentSection) currentSection.hoursLines.push(line);
    }
  }

  // Select which section to use for hours extraction.
  // weekStart is computed later but we need it here — compute it early from weekEndingStr.
  let earlyWeekStart = null;
  if (weekEndingStr) {
    let wes = weekEndingStr
      .replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/, (_, d, m, y) => `${m}/${d}/${y}`)
      .replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, a, b, y) =>
        parseInt(a) > 12 ? `${b}/${a}/${y}` : `${a}/${b}/${y}`
      )
      .replace(/(\d{1,2}\/\d{1,2}\/)(\d{2})$/, (_, pre, yy) =>
        pre + (parseInt(yy) < 50 ? `20${yy}` : `19${yy}`)
      );
    const d = new Date(wes);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
      const x = new Date(d);
      x.setDate(x.getDate() - (x.getDay() === 0 ? 6 : x.getDay() - 1));
      earlyWeekStart = x.toISOString().split('T')[0];
    }
  }

  // Pick the section matching earlyWeekStart; fall back to the last section.
  let chosenSection = sections.at(-1) ?? null;
  if (sections.length > 1 && earlyWeekStart) {
    const ws = new Date(earlyWeekStart + 'T12:00:00');
    const we = new Date(earlyWeekStart + 'T12:00:00');
    we.setDate(we.getDate() + 6);
    for (const s of sections) {
      if (s.headerDates.some(d => d >= ws && d <= we)) {
        chosenSection = s;
        break;
      }
    }
  }

  // Use chosen section's data
  const hoursLinesCandidates = chosenSection?.hoursLines ?? [];
  if (chosenSection?.total != null) total = chosenSection.total;

  // Fallback: if total > 168 (4800% artifact), find standalone number in hoursLines
  if (!total || total > 168) {
    for (const hl of hoursLinesCandidates) {
      if (/^\d+$/.test(hl)) {
        const t = parseFloat(hl);
        if (t > 0 && t <= 168) { total = t; break; }
      }
    }
  }

  // PDF text extraction can reorder sections — if we found no hours candidates via
  // section detection, scan ALL lines for a manager-name + hours pattern
  if (hoursLinesCandidates.length === 0 && total !== null && total <= 168) {
    for (const line of lines) {
      const nums = line.match(/\b(\d{1,2})\b/g);
      if (nums && nums.length >= 5) {
        const vals = nums.map(Number).filter(n => n <= 24);
        if (vals.length >= 5) hoursLinesCandidates.push(line);
      }
    }
  }

  // Parse hours using backtracking constrained by total
  let hours = null;
  if (hoursLinesCandidates.length > 0 && total !== null && total <= 168) {
    const combined = hoursLinesCandidates.join('');
    // Strip leading manager name (letters, spaces, unicode accents, punctuation)
    const numStr = combined.replace(/^[\p{L}\s.,\-]+/u, '').replace(/[^0-9]/g, '');

    if (numStr.length >= 5) {
      function solve(pos, remaining, vals) {
        if (vals.length === 7) return Math.abs(remaining) < 0.01 ? vals : null;
        if (pos >= numStr.length) return null;
        if (pos + 1 < numStr.length) {
          const two = parseInt(numStr.slice(pos, pos + 2));
          if (two <= 24) {
            const r = solve(pos + 2, remaining - two, [...vals, two]);
            if (r) return r;
          }
        }
        const one = parseInt(numStr[pos]);
        if (one <= 24) return solve(pos + 1, remaining - one, [...vals, one]);
        return null;
      }
      const result = solve(0, total, []);
      if (result) {
        hours = { mon: result[0], tue: result[1], wed: result[2], thu: result[3],
                  fri: result[4], sat: result[5] || 0, sun: result[6] || 0 };
      }
    }
  }

  // Try to extract dates from task log rows — these are often more reliable than
  // the Week Ending Date field for European-format PDFs where DD/MM is ambiguous
  let taskLogWeekStart = null;
  {
    const extractDates = (interpretation) => {
      const taskDates = [];
      for (const line of lines) {
        const m = line.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
        if (m) {
          const a = parseInt(m[1]), b = parseInt(m[2]), y = parseInt(m[3]);
          if (y >= 2020 && a >= 1 && b >= 1) {
            let date;
            if (interpretation === 'eu') {
              // DD/MM — a is day, b is month
              if (b > 12) continue; // invalid month
              date = new Date(y, b - 1, a);
            } else {
              // MM/DD — a is month, b is day
              if (a > 12) continue; // invalid month
              date = new Date(y, a - 1, b);
            }
            if (!isNaN(date.getTime())) taskDates.push(date);
          }
        }
      }
      return taskDates;
    };
    for (const interp of ['us', 'eu']) {
      const dates = extractDates(interp);
      if (dates.length >= 1) {
        dates.sort((a, b) => a - b);
        const span = (dates[dates.length - 1] - dates[0]) / 86400000;
        if (span <= 6) { taskLogWeekStart = getMondayOf(dates[0]); break; }
      }
    }
  }

  // Normalise week ending date → Monday week start
  let weekStart = null;
  if (weekEndingStr) {
    // European dot: 26.4.2026. or 3.5.2026. → M/D/YYYY
    weekEndingStr = weekEndingStr.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/, (_, d, m, y) => `${m}/${d}/${y}`);
    // European slash DD/MM/YYYY: if first number > 12, must be day (e.g. 13/4/2026 = April 13)
    weekEndingStr = weekEndingStr.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, a, b, y) =>
      parseInt(a) > 12 ? `${b}/${a}/${y}` : `${a}/${b}/${y}`
    );
    // 2-digit year
    weekEndingStr = weekEndingStr.replace(/(\d{1,2}\/\d{1,2}\/)(\d{2})$/, (_, pre, yy) =>
      pre + (parseInt(yy) < 50 ? `20${yy}` : `19${yy}`)
    );
    const d = new Date(weekEndingStr);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) {
      const day = d.getDay();
      d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      weekStart = d.toISOString().split('T')[0];
    }
  }

  // Prefer task-log dates over week-ending-date, but only when they agree
  // within 21 days. If they diverge further the task log likely has copy-pasted
  // dates from a prior week/month and the Week Ending Date header is more reliable.
  if (taskLogWeekStart) {
    if (!weekStart) {
      weekStart = taskLogWeekStart;
    } else {
      const drift = Math.abs(new Date(taskLogWeekStart) - new Date(weekStart)) / 86400000;
      if (drift <= 21) weekStart = taskLogWeekStart;
      // else: task log dates are stale — keep weekStart from Week Ending Date
    }
  }

  // If task-log dates weren't available, prefer column header dates over the
  // Week Ending Date field — the header columns are explicit day-by-day dates
  // and are more reliable than a single "Week Ending Date" field that users
  // frequently fill in incorrectly (e.g. Mek's PDF: header says 5/17 but
  // columns are 5/18–5/24).
  if (!taskLogWeekStart && chosenSection?.headerDates?.length > 0) {
    const sorted = [...chosenSection.headerDates].sort((a, b) => a - b);
    const headerWeekStart = getMondayOf(sorted[0]);
    if (!weekStart) {
      weekStart = headerWeekStart;
    } else {
      const drift = Math.abs(new Date(headerWeekStart) - new Date(weekStart)) / 86400000;
      if (drift <= 21) weekStart = headerWeekStart;
    }
  }

  // Fallback week from filename if not found in text
  if (!weekStart) weekStart = weekFromFilename(filename);

  return { name, weekStart, hours, total };
}

// ─── PDF attachment classifier ────────────────────────────────────────────────
// Returns { type: 'timesheet'|'invoice'|'both'|'unknown', pdfText: string, isImagePdf: boolean }

function classifyByFilename(name) {
  const n = name.toLowerCase();
  const isInvoice   = /invoice|billing|\binv\b|\bpaymentrequest\b/.test(n);
  const isTimesheet = /timesheet|timesheets?|weekly.?time|time.?sheet/.test(n);
  if (isInvoice && isTimesheet) return 'both';
  if (isInvoice)   return 'invoice';
  if (isTimesheet) return 'timesheet';
  return null; // ambiguous
}

async function classifyPdf(buffer, filename) {
  // Extract text once — used for both content scoring and downstream parsing.
  // Keeping original case in rawText; scoring uses lowercased version.
  let rawText    = '';
  let isImagePdf = true;
  try {
    const pdfParse = require('pdf-parse');
    const data     = await pdfParse(buffer);
    const wordChars = (data.text?.match(/[a-zA-Z0-9]/g) || []).length;
    if (wordChars > 30) { rawText = data.text; isImagePdf = false; }
  } catch {}

  // Strong filename signals — skip content scoring but keep extracted text
  const byCName = classifyByFilename(filename);
  if (byCName === 'invoice' || byCName === 'timesheet' || byCName === 'both') {
    return { type: byCName, pdfText: rawText, isImagePdf };
  }

  const text = rawText.toLowerCase();
  if (!text || text.replace(/\s/g, '').length < 20) {
    return { type: 'unknown', pdfText: rawText, isImagePdf };
  }

  // Score invoice signals
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

  let invoiceScore   = 0;
  let timesheetScore = 0;
  for (const re of invoiceSignals)   if (re.test(text)) invoiceScore++;
  for (const re of timesheetSignals) if (re.test(text)) timesheetScore++;

  let type;
  if (invoiceScore >= 2 && timesheetScore >= 2) type = 'both';
  else if (invoiceScore >= 2)                    type = 'invoice';
  else if (timesheetScore >= 2)                  type = 'timesheet';
  else if (invoiceScore > timesheetScore)         type = 'invoice';
  else if (timesheetScore > invoiceScore)         type = 'timesheet';
  else                                            type = 'unknown';

  return { type, pdfText: rawText, isImagePdf };
}

// ─── Claude API ───────────────────────────────────────────────────────────────

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
  "isMultiContractor": boolean,
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
- isMultiContractor: set to true if the invoice lists multiple contractors/consultants with individual line items; false for a single contractor invoice.
- periodStart / periodEnd: the BILLING PERIOD (dates the work was performed), not the invoice issue date and not dates embedded in the invoice number. If only a month is given (e.g. "April 2026"), use the first and last day of that month. IMPORTANT: invoice numbers often contain date-like components (e.g. "002/05/2026", "2026-04-0007") — do NOT use these as the period; look for explicit "period", "billing period", "services rendered", or a clear date range in the description.
- totalHours: hours worked — a number (e.g. 160, 144.5). Ignore text like "h" or "hrs" suffix.
- rate: hourly rate as a plain number (e.g. 40, 35.50). Ignore currency symbols. If the invoice shows rates in multiple currencies (e.g. both EUR and USD columns), extract the USD rate.
- totalAmount: total invoice amount as a plain number. Ignore currency symbols. If the invoice shows amounts in multiple currencies, extract the USD amount.
- currency: 3-letter ISO code (USD, EUR, GBP, etc.). Set to the currency of the amounts you extracted — if you found USD amounts, set "USD".
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
- If no explicit billing period is stated but an invoice date is present: determine whether this is an invoice for the PREVIOUS month's work. Contractors routinely invoice in the first days of month N for work completed in month N-1. Use the PREVIOUS calendar month when EITHER condition holds: (a) the invoice date is on or before the 10th of the month, OR (b) the total hours claimed are implausibly high for the days elapsed since the start of the invoice month (e.g. 176h on May 7 — only 7 working days elapsed, impossible). Otherwise use the invoice date's own calendar month. Examples: invoice date 07 May 2026, 176h → previous month → periodStart: 2026-04-01, periodEnd: 2026-04-30. Invoice date 25 May 2026, 160h → same month → periodStart: 2026-05-01, periodEnd: 2026-05-31.
- parseNotes: one sentence summarising what was found and what was missing.`;

const CLAUDE_TIMESHEET_SYSTEM = `You are a timesheet data extractor. Extract the weekly timesheet from the document.
Return ONLY a valid JSON object — no markdown, no explanation. Use null for any field not found.

Required shape:
{
  "weekStart": "YYYY-MM-DD",
  "contractorName": string | null,
  "dailyHours": { "mon": 0, "tue": 0, "wed": 0, "thu": 0, "fri": 0, "sat": 0, "sun": 0 },
  "totalHours": number | null
}

Rules:
- weekStart must be the Monday of the work week (ISO YYYY-MM-DD).
- dailyHours: plain numbers (e.g. 8, 0, 4.5). Use 0 for non-working or absent days.
- Partial weeks (e.g. only Mon–Wed worked) still get 0 for the unused days.
- If the document shows multiple contractors, extract the primary / only one.
- European dates: DD/MM/YYYY or DD.MM.YYYY. US dates: MM/DD/YYYY.`;

async function claudeExtractTimesheet(pdfBuffer, textContent) {
  if (!CONFIG.anthropicApiKey) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });

    // Prefer plain text (much cheaper) when available; fall back to PDF document
    // block only for image PDFs where no text could be extracted.
    let userContent;
    if (textContent) {
      userContent = `Extract the weekly timesheet data:\n\n${textContent}`;
    } else if (pdfBuffer) {
      userContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') },
        },
        { type: 'text', text: 'Extract the weekly timesheet data from this document.' },
      ];
    } else {
      return null; // nothing to send
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: CLAUDE_TIMESHEET_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    const raw = (response.content[0]?.text ?? '').trim();
    // Extract first JSON object — handles markdown fences and trailing text after the object
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in Claude response');
    const parsed = JSON.parse(jsonMatch[0]);

    // Coerce dailyHours values to numbers
    if (parsed.dailyHours) {
      for (const k of Object.keys(parsed.dailyHours)) {
        const v = parsed.dailyHours[k];
        parsed.dailyHours[k] = typeof v === 'number' ? v : (parseFloat(v) || 0);
      }
    }

    // Reject if all hours are zero — Claude likely couldn't identify timesheet content
    const totalFromDays = Object.values(parsed.dailyHours || {}).reduce((s, v) => s + v, 0);
    if (totalFromDays === 0) {
      console.warn(`  ⚠️  Claude: all daily hours are 0 — not a timesheet, ignoring`);
      return null;
    }

    // Ensure weekStart is a Monday
    if (parsed.weekStart) {
      const d = new Date(parsed.weekStart + 'T12:00:00');
      if (!isNaN(d.getTime())) parsed.weekStart = getMondayOf(d);
    }

    // Reject implausible weekStart (> 180 days ago or > 14 days in the future)
    if (parsed.weekStart) {
      const daysAgo = (Date.now() - new Date(parsed.weekStart + 'T12:00:00').getTime()) / 86400000;
      if (daysAgo < -14 || daysAgo > 180) {
        console.warn(`  ⚠️  Claude: implausible weekStart ${parsed.weekStart} — rejecting`);
        return null;
      }
    }

    return parsed;
  } catch (e) {
    console.warn(`Claude timesheet extraction failed: ${e.message}`);
    return null;
  }
}

// ─── Filename period fallback (same logic as invoice-parser/run.js) ──────────

const INVOICE_MONTH_ABBR = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function parsePeriodFromFilename(filename) {
  // Three failure modes in the original regex, all fixed here:
  //   1. \b fails when an underscore precedes the month name (_February) — use [^a-zA-Z] instead.
  //   2. Partial/variant month names ("Februar", "Aprr") — extend feb/apr patterns + slice(0,3) lookup.
  //   3. Month-only filenames with no year ("Invoice-April.pdf") — second pass extracts year elsewhere.

  const MONTH_RE = /(?:^|[^a-zA-Z])(jan(?:uary)?|feb(?:r(?:uary?)?)?|mar(?:ch)?|apr{1,2}(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)/i;

  // Pass 1: month + separator + explicit year (e.g. "Apr'26", "_February_26", "April 2026")
  let m = filename.match(
    /(?:^|[^a-zA-Z])(jan(?:uary)?|feb(?:r(?:uary?)?)?|mar(?:ch)?|apr{1,2}(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)['\s\-_.]*(\d{2,4})\b/i
  );
  let year;
  if (m) {
    year = parseInt(m[2], 10);
  } else {
    // Pass 2: month name alone — find year elsewhere in filename
    m = filename.match(MONTH_RE);
    if (!m) return null;
    const yearM = filename.match(/\b(20\d{2})\b/);
    year = yearM ? parseInt(yearM[1], 10) : new Date().getFullYear();
  }

  const raw = m[1].toLowerCase().replace(/r+/, 'r'); // normalise "aprr" → "apr"
  const month = INVOICE_MONTH_ABBR[raw] ?? INVOICE_MONTH_ABBR[raw.slice(0, 3)];
  if (!month) return null;
  if (year < 100) year += 2000;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    periodStart: `${year}-${String(month).padStart(2, '0')}-01`,
    periodEnd:   `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function applyFilenamePeriodFallback(parsed, filename) {
  const { periodStart, periodEnd } = parsed;
  const fallback = parsePeriodFromFilename(filename);

  if (periodStart && periodEnd) {
    const span = (new Date(periodEnd) - new Date(periodStart)) / 86400000;
    const plausible = span >= 5 && span <= 45;
    if (plausible && fallback) {
      // If Claude extracted a plausible span but the filename names a different month,
      // the filename wins — Claude commonly picks up the invoice date instead of billing period.
      const extractedYM = periodStart.slice(0, 7);
      const filenameYM  = fallback.periodStart.slice(0, 7);
      if (extractedYM === filenameYM) return parsed; // agree — trust Claude
      return { ...parsed, periodStart: fallback.periodStart, periodEnd: fallback.periodEnd };
    }
    if (plausible) return parsed;
  }

  if (!fallback) return parsed;
  return { ...parsed, periodStart: fallback.periodStart, periodEnd: fallback.periodEnd };
}

// ─── Invoice extraction — regex-first, Claude fallback ───────────────────────

// Truncate + normalize whitespace before sending to Claude (reduces input tokens).
// Regex parser always gets the full original text.
function prepareInvoiceText(text) {
  return text.replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
}

// Shared post-processing: EUR→USD override + rate cross-validation.
// Applied to both regex and Claude results before returning.
function postProcessInvoice(result, pdfText) {
  if (!result) return result;

  // Croatian/Bosnian templates show EUR total prominently but USD is billing currency.
  if (result.currency === 'EUR' && pdfText) {
    const usdRateM = pdfText.match(/(\d+(?:[.,]\d+)?)\s*USD\s*per\s*h/i);
    if (usdRateM) {
      const usdRate   = parseFloat(usdRateM[1].replace(',', '.'));
      const usdTotalM = pdfText.match(/T\s*O\s*T\s*A\s*L\s*:?\s*\(?USD\)?\s*[:\s]*([\d.,]+)\s*USD/i)
                     || pdfText.match(/([\d.,]+)USD/i);
      let usdTotal = null;
      if (usdTotalM) {
        const raw = usdTotalM[1].trim();
        usdTotal = /^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(raw)
          ? parseFloat(raw.replace(/\./g, '').replace(',', '.'))
          : parseFloat(raw.replace(/,/g, ''));
      }
      result = { ...result, rate: usdRate, currency: 'USD' };
      if (usdTotal && usdTotal > usdRate) result = { ...result, totalAmount: usdTotal };
    }
  }

  // Rate cross-validation: rate × hours off from total by >10% → recompute from total ÷ hours.
  const h = result.totalHours, r = result.rate, t = result.totalAmount;
  if (h != null && r != null && t != null && t > 0 && Math.abs(h * r - t) / t > 0.10) {
    result = { ...result, rate: null };
  }
  if (result.totalHours != null && result.rate == null && result.totalAmount != null) {
    const derived = result.totalAmount / result.totalHours;
    if (derived >= 1 && derived < 10000) result = { ...result, rate: Math.round(derived * 100) / 100 };
  }

  return result;
}

// Merge regex and Claude results: regex wins on every field it found (deterministic);
// Claude fills in whatever regex missed.
function mergeInvoiceResults(regex, claude) {
  const merged = { ...claude, paymentDetails: { ...(claude.paymentDetails || {}) } };
  if (!regex) return merged;
  for (const f of ['invoiceNumber', 'periodStart', 'periodEnd', 'totalHours', 'rate', 'totalAmount', 'currency']) {
    if (regex[f] != null) merged[f] = regex[f];
  }
  for (const f of ['iban', 'swift', 'accountNumber', 'sortCode', 'routingNumber', 'bankName', 'companyName']) {
    if (regex.paymentDetails?.[f] != null) merged.paymentDetails[f] = regex.paymentDetails[f];
  }
  return merged;
}

// Claude: payment details only — much smaller prompt + response (~100 vs ~300 output tokens).
const CLAUDE_PAYMENT_SYSTEM = `Extract bank/payment details from this invoice document.
Return ONLY a valid JSON object — no markdown, no explanation. Use null for any field not found.

{
  "iban": string | null,
  "swift": string | null,
  "accountNumber": string | null,
  "sortCode": string | null,
  "routingNumber": string | null,
  "bankName": string | null,
  "companyName": string | null
}

Rules:
- iban: compact format, NO spaces (e.g. "HR1234567890123456789")
- swift: SWIFT/BIC code (8 or 11 chars)
- accountNumber: bank account number if not an IBAN
- sortCode: UK sort code (XX-XX-XX format)
- routingNumber: US ABA routing number (9 digits)
- bankName: name of the bank (not the account holder)
- companyName: name of the invoice issuer / contractor company`;

async function claudeExtractPaymentOnly(text, pdfBuffer, isImagePdf) {
  if (!CONFIG.anthropicApiKey) return null;
  try {
    const Anthropic   = require('@anthropic-ai/sdk');
    const client      = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
    const userContent = text
      ? `Extract payment/bank details:\n\n${text}`
      : (isImagePdf && pdfBuffer)
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
            { type: 'text', text: 'Extract payment/bank details from this document.' },
          ]
        : null;
    if (!userContent) return null;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 256,
      system: CLAUDE_PAYMENT_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });
    const raw = (response.content[0]?.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const pd  = JSON.parse(raw);
    if (pd.iban) pd.iban = pd.iban.replace(/\s+/g, '').toUpperCase();
    return pd;
  } catch (e) {
    console.warn(`  Claude payment-only extraction failed: ${e.message}`);
    return null;
  }
}

// Claude: full invoice extraction — only called when regex lacks period or hours.
async function claudeFullExtractInvoice(text, pdfBuffer, isImagePdf, filename) {
  if (!CONFIG.anthropicApiKey) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
    let userContent;
    if (text) {
      userContent = `Extract invoice data from this document:\n\n${text}`;
    } else if (isImagePdf && pdfBuffer) {
      console.log(`  📄 ${filename}: image PDF — using vision (costs more)`);
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBuffer.toString('base64') } },
        { type: 'text', text: 'Extract invoice data from this document.' },
      ];
    } else {
      return null;
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1024,
      system: CLAUDE_INVOICE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    });

    const raw      = (response.content[0]?.text ?? '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude invoice response');
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

    // Date consistency: if span > 40 days, start date likely has day/month swapped.
    if (parsed.periodStart && parsed.periodEnd) {
      const start = new Date(parsed.periodStart), end = new Date(parsed.periodEnd);
      if ((end - start) / 86400000 > 40) {
        const [y, m, d] = parsed.periodStart.split('-');
        const swapped   = `${y}-${d.padStart(2, '0')}-${m.padStart(2, '0')}`;
        const newSpan   = (end - new Date(swapped)) / 86400000;
        if (!isNaN(new Date(swapped)) && newSpan >= 0 && newSpan <= 40) parsed.periodStart = swapped;
      }
    }

    if (parsed.paymentDetails?.iban) {
      parsed.paymentDetails.iban = parsed.paymentDetails.iban.replace(/\s+/g, '').toUpperCase();
    }
    return parsed;
  } catch (e) {
    console.warn(`  Claude full invoice extraction failed for ${filename}: ${e.message}`);
    return null;
  }
}

// ─── Main invoice orchestrator ────────────────────────────────────────────────
// 1. Regex (free, always runs on text PDFs) via parser.js
// 2a. Regex has period + hours + payment → done, zero Claude calls
// 2b. Regex has period + hours, missing payment → Claude for payment details only
// 2c. Regex missing period or hours → full Claude extract, merge regex on top
async function extractInvoice(pdfText, isImagePdf, pdfBuffer, filename) {
  // ── Step 1: regex parser ───────────────────────────────────────────────────
  let regexResult = null;
  if (pdfText && pdfText.length > 30) {
    try {
      const { parseInvoice } = require('../invoice-parser/parser.js');
      regexResult = parseInvoice(pdfText, filename);
      regexResult = applyFilenamePeriodFallback(regexResult, filename);
    } catch (_) {}
  }

  const regexHasPeriod  = !!(regexResult?.periodStart && regexResult?.periodEnd);
  const regexHasHours   = regexResult?.totalHours != null;
  const regexSufficient = regexHasPeriod && regexHasHours;

  // ── Step 2a: regex complete ────────────────────────────────────────────────
  if (regexSufficient) {
    const pd         = regexResult.paymentDetails || {};
    const hasPayment = !!(pd.iban || pd.swift || pd.accountNumber || pd.routingNumber);

    if (hasPayment || !CONFIG.anthropicApiKey) {
      if (hasPayment) console.log(`  ✅ Regex: ${filename}`);
      return postProcessInvoice(regexResult, pdfText);
    }

    // ── Step 2b: regex has numbers, Claude fills payment details only ────────
    console.log(`  💳 Claude payment-only: ${filename}`);
    const claudePd = await claudeExtractPaymentOnly(
      pdfText ? prepareInvoiceText(pdfText) : null, pdfBuffer, isImagePdf
    );
    return postProcessInvoice(
      { ...regexResult, paymentDetails: claudePd ?? regexResult.paymentDetails },
      pdfText
    );
  }

  // ── Step 2c: regex insufficient — full Claude extract ─────────────────────
  if (!CONFIG.anthropicApiKey) {
    return regexResult ? postProcessInvoice(regexResult, pdfText) : null;
  }

  console.log(`  🤖 Claude: ${filename}`);
  const claudeResult = await claudeFullExtractInvoice(
    pdfText ? prepareInvoiceText(pdfText) : null, pdfBuffer, isImagePdf, filename
  );

  if (!claudeResult) return regexResult ? postProcessInvoice(regexResult, pdfText) : null;

  const merged = mergeInvoiceResults(regexResult, claudeResult);
  return postProcessInvoice(applyFilenamePeriodFallback(merged, filename), pdfText);
}

// Returns a multi-line string showing every field as PARSED, NOT FOUND, or ASSUMED.
function formatInvoiceReport(filename, contractorEmail, parsed) {
  const tag = (val, assumedLabel) => {
    if (val != null && val !== '') return '[PARSED]';
    return assumedLabel ? `[NOT FOUND → assumed ${assumedLabel}]` : '[NOT FOUND]';
  };
  const pd = parsed?.paymentDetails || {};
  const canIngest = parsed?.periodStart && parsed?.periodEnd && parsed?.totalHours != null;

  return [
    `  ┌─ Invoice: ${filename}  (${contractorEmail})`,
    `  │  Invoice #   : ${parsed?.invoiceNumber   ?? '—'}  ${tag(parsed?.invoiceNumber,   'auto-generated')}`,
    `  │  Period      : ${parsed?.periodStart ?? '—'} → ${parsed?.periodEnd ?? '—'}  start:${tag(parsed?.periodStart)}  end:${tag(parsed?.periodEnd)}`,
    `  │  Hours       : ${parsed?.totalHours   ?? '—'}  ${tag(parsed?.totalHours)}`,
    `  │  Rate        : ${parsed?.rate         ?? '—'}  ${tag(parsed?.rate,         '$0')}`,
    `  │  Amount      : ${parsed?.totalAmount  ?? '—'}  ${tag(parsed?.totalAmount,  'hours × rate')}`,
    `  │  Currency    : ${parsed?.currency     ?? '—'}  ${tag(parsed?.currency,     'USD')}`,
    `  │  ── Payment Details ──────────────────────────────────────`,
    `  │  Company     : ${pd.companyName   ?? '—'}  ${tag(pd.companyName)}`,
    `  │  Bank        : ${pd.bankName      ?? '—'}  ${tag(pd.bankName)}`,
    `  │  Account #   : ${pd.accountNumber ?? '—'}  ${tag(pd.accountNumber)}`,
    `  │  IBAN        : ${pd.iban          ?? '—'}  ${tag(pd.iban)}`,
    `  │  SWIFT       : ${pd.swift         ?? '—'}  ${tag(pd.swift)}`,
    `  │  Sort Code   : ${pd.sortCode      ?? '—'}  ${tag(pd.sortCode)}`,
    `  │  Routing #   : ${pd.routingNumber ?? '—'}  ${tag(pd.routingNumber)}`,
    parsed?.parseNotes ? `  │  Notes       : ${parsed.parseNotes}` : null,
    `  └─ ${canIngest ? '✅ Sufficient data to ingest' : '⚠️  Missing required fields (period or hours) — would skip ingestion'}`,
  ].filter(Boolean).join('\n');
}

// ─── PDF parser ───────────────────────────────────────────────────────────────

async function parsePdf(buffer, filename, cachedText, cachedIsImagePdf) {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    // Use text cached by classifyPdf if available — avoids a second pdf-parse call
    let text     = cachedText ?? '';
    let hasText  = (text.match(/[a-zA-Z0-9]/g) || []).length > 30;
    if (!hasText && !cachedIsImagePdf) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buf);
        text    = data.text || '';
        hasText = (text.match(/[a-zA-Z0-9]/g) || []).length > 30;
      } catch {}
    }

    // ── 1. Regex parser (fast, free) ──────────────────────────────────────────
    if (hasText) {
      const { name, weekStart, hours, total } = parseSynergiePdfText(text, filename);
      if (hours && weekStart) {
        const entries = {};
        const base = new Date(weekStart + 'T12:00:00Z');
        DAY_ORDER.forEach((d, i) => {
          const dt = new Date(base);
          dt.setUTCDate(base.getUTCDate() + i);
          entries[dt.toISOString().split('T')[0]] = hours[d] !== undefined ? hours[d] : 0;
        });
        return [{ weekStart, entries, total: total || Object.values(entries).reduce((s, h) => s + h, 0), nameFromSheet: name, notes: `PDF: ${filename}` }];
      }
    }

    // ── 2. Claude fallback ────────────────────────────────────────────────────
    if (CONFIG.anthropicApiKey) {
      console.log(`  🤖 Claude fallback: ${filename}`);
      const result = await claudeExtractTimesheet(buf, hasText ? text : null);
      if (result?.weekStart && result?.dailyHours) {
        const entries = {};
        const base = new Date(result.weekStart + 'T12:00:00Z');
        DAY_ORDER.forEach((d, i) => {
          const dt = new Date(base);
          dt.setUTCDate(base.getUTCDate() + i);
          entries[dt.toISOString().split('T')[0]] = result.dailyHours[d] ?? 0;
        });
        const total = result.totalHours ?? Object.values(entries).reduce((s, h) => s + h, 0);
        return [{ weekStart: result.weekStart, entries, total, nameFromSheet: result.contractorName || null, notes: `PDF(claude): ${filename}` }];
      }
      // Claude was tried but could not extract timesheet data.
      // Return a sentinel so the caller treats this attachment as "done" and does NOT retry it.
      console.log(`  ⏭️  Claude found no timesheet in ${filename} — will not retry`);
      return [{ claudeAttempted: true, weekStart: null, entries: null, total: null, notes: `PDF(claude-gave-up): ${filename}` }];
    }

    return [];
  } catch (e) {
    console.warn(`PDF parse error for ${filename}: ${e.message}`);
    return [];
  }
}

// ─── HTTP POST to edge function ───────────────────────────────────────────────

function postToIngest(payload, targetUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(targetUrl || CONFIG.ingestUrl);
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
  // Strip non-timesheet documents silently — agreements, AUPs, SOWs, etc.
  const nonTimesheetAtts = attachments.filter(a => (a.isPdf || a.isXlsx) && NON_TIMESHEET_DOC_RE.test(a.name));
  if (nonTimesheetAtts.length) {
    nonTimesheetAtts.forEach(a => console.log(`  ⏭️  Non-timesheet doc skipped: ${a.name}`));
  }
  const relevantAtts = attachments.filter(a => !NON_TIMESHEET_DOC_RE.test(a.name));

  // Classify each PDF as timesheet / invoice / both / unknown via content scoring.
  // XLSX is always treated as a timesheet (no invoice XLSX path exists).
  const xlsxAtts    = relevantAtts.filter(a => a.isXlsx);
  const pdfQueue    = relevantAtts.filter(a => a.isPdf);

  const invoiceAtts   = [];
  const timesheetPdfs = [];
  const unknownPdfs   = [];

  for (const att of pdfQueue) {
    const { type, pdfText, isImagePdf } = await classifyPdf(att.buffer, att.name);
    att._classification = type;
    att.pdfText         = pdfText;    // cached — no second pdf-parse downstream
    att.isImagePdf      = isImagePdf;
    if (type === 'invoice')   { invoiceAtts.push(att); }
    else if (type === 'both') { invoiceAtts.push(att); timesheetPdfs.push(att); }
    else if (type === 'unknown') {
      console.log(`  ❓ Unknown PDF type (will not retry): ${att.name}`);
      unknownPdfs.push(att);
    } else {
      timesheetPdfs.push(att); // 'timesheet'
    }
  }

  const pdfAtts = timesheetPdfs;
  const timesheets  = [];

  for (const att of xlsxAtts) {
    const parsed = parseXlsx(att.buffer, att.name);
    if (parsed.length === 0) {
      // XLSX could not be parsed — push a sentinel so this attachment does NOT land in
      // failedAttachments (which would cause the email to be retried every hour forever).
      const fallbackWeek = weekFromFilename(att.name);
      timesheets.push({
        weekStart: fallbackWeek || null, entries: null, total: null,
        attachmentName: att.name, attachmentType: 'xlsx',
        resolvedName: displayName,
        xlsxParseFailed: true,
        notes: `XLSX parse failed: ${att.name}`,
      });
      console.log(`  ⚠️  XLSX parse failed for ${att.name} — will not retry`);
      continue;
    }
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

  // Weeks already covered by a successful XLSX parse — skip timesheet PDFs for those weeks
  // to avoid a redundant (and potentially costly) Claude call for the same data.
  const xlsxWeeks    = new Set(
    timesheets.filter(t => t.attachmentType === 'xlsx' && !t.xlsxParseFailed && t.weekStart)
              .map(t => t.weekStart)
  );
  const skippedAttNames = new Set(); // intentionally skipped — must be excluded from failedAttachments

  for (const att of pdfAtts) {
    // Quick week check from filename before doing any parsing work.
    const filenameWeek = weekFromFilename(att.name);
    if (filenameWeek && xlsxWeeks.has(filenameWeek)) {
      console.log(`  ⏭️  PDF skipped — week ${filenameWeek} already covered by XLSX: ${att.name}`);
      skippedAttNames.add(att.name);
      continue;
    }

    const parsed = await parsePdf(att.buffer, att.name, att.pdfText, att.isImagePdf);

    // Post-parse week check for PDFs where the week came from content rather than filename.
    const covered = parsed.length > 0 && parsed.every(ts => ts.weekStart && xlsxWeeks.has(ts.weekStart));
    if (covered) {
      console.log(`  ⏭️  PDF skipped — week already covered by XLSX: ${att.name}`);
      skippedAttNames.add(att.name);
      continue;
    }

    for (const ts of parsed) {
      const name = bestName([
        { name: ts.nameFromSheet },
        { name: displayName },
        { name: extractNameFromFilename(att.name) },
      ]);
      timesheets.push({ ...ts, attachmentName: att.name, attachmentType: 'pdf', resolvedName: name });
    }
  }

  // No attachments parsed but we have a contractor — log partial.
  // Skip the body fallback when every attachment was a non-timesheet doc or invoice
  // (nothing to process, not a real failure).
  const hadRealAttachments = xlsxAtts.length > 0 || pdfAtts.length > 0;
  if (timesheets.length === 0 && hadRealAttachments) {
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
    if (ts.claudeAttempted || ts.xlsxParseFailed) continue; // sentinels — don't post, don't retry
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
  // ── Invoice PDFs — parse and report (ingest if enabled) ──────────────────
  for (const att of invoiceAtts) {
    console.log(`  🧾 Invoice attachment: ${att.name}`);
    const parsed = await extractInvoice(att.pdfText || '', att.isImagePdf || false, att.buffer, att.name);
    console.log(formatInvoiceReport(att.name, contractorEmail, parsed));
    const canIngest = parsed?.periodStart && parsed?.periodEnd && parsed?.totalHours != null;

    if (CONFIG.invoiceIngestEnabled && CONFIG.invoiceIngestUrl && canIngest) {
      try {
        const res = await postToIngest({
          messageId:       `${messageId}::${att.name}`,
          contractorEmail,
          contractorName:  displayName,
          subject,
          attachmentName:  att.name,
          invoiceNumber:   parsed.invoiceNumber   || null,
          periodStart:     parsed.periodStart,
          periodEnd:       parsed.periodEnd,
          totalHours:      parsed.totalHours,
          rate:            parsed.rate            || null,
          totalAmount:     parsed.totalAmount     || null,
          currency:        parsed.currency        || null,
          paymentDetails:  parsed.paymentDetails  || null,
          parseNotes:      parsed.parseNotes      || '',
          pdfBase64:       att.buffer.toString('base64'),
          rawExtracted:    parsed,
        }, CONFIG.invoiceIngestUrl);
        const action = res.body?.action || res.status;
        console.log(`     ✅ Ingested → ${action}`);
        results.push({ contractor: contractorEmail, attachmentName: att.name, action: `invoice_${action}`, parsed });
      } catch (e) {
        console.error(`     ❌ Ingest failed: ${e.message}`);
        results.push({ contractor: contractorEmail, attachmentName: att.name, action: 'invoice_error', error: e.message, parsed });
      }
    } else {
      const reason = !CONFIG.invoiceIngestEnabled ? 'dry-run mode' : !canIngest ? 'missing fields' : 'no INVOICE_INGEST_URL';
      console.log(`     ℹ️  Not ingested (${reason})`);
      results.push({ contractor: contractorEmail, attachmentName: att.name, action: 'invoice_reported', parsed });
    }
  }

  const parsedAttachmentNames = new Set(timesheets.map(ts => ts.attachmentName).filter(Boolean));
  // Invoice and unknown PDFs are handled separately — don't count as timesheet failures.
  const invoiceAttNames = new Set(invoiceAtts.map(a => a.name));
  const unknownAttNames = new Set(unknownPdfs.map(a => a.name));
  const failedAttachments = [...xlsxAtts, ...pdfAtts].filter(a =>
    !parsedAttachmentNames.has(a.name) && !invoiceAttNames.has(a.name) &&
    !unknownAttNames.has(a.name) && !skippedAttNames.has(a.name)
  );

  return { results, failedAttachments };
}

// ─── Process one parsed email ─────────────────────────────────────────────────

async function processEmail(parsed, messageId, results, failedAtts, summary) {
  const fromAddr  = parsed.from?.value?.[0];
  const fromEmail = (fromAddr?.address || '').toLowerCase();
  const fromName  = fromAddr?.name || null;
  const subject   = parsed.subject || '(no subject)';
  const bodyText  = parsed.text || (parsed.html || '').replace(/<[^>]+>/g, ' ');

  const attachments = (parsed.attachments || []).map(a => ({
    name:   a.filename || a.contentType?.split('/')[1] || 'unnamed',
    buffer: a.content,
    size:   a.size || a.content?.length || 0,
    // Detect by contentType OR filename — covers inline attachments too
    isXlsx: !!(a.contentType?.includes('spreadsheet') || a.contentType?.includes('excel') ||
               (a.filename||'').match(/\.(xlsx|xls)$/i)),
    isPdf:  !!(a.contentType?.includes('pdf') ||
               (a.filename||'').match(/\.pdf$/i) ||
               // Some clients send PDFs with generic octet-stream content type
               (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
    isEml:  !!(a.contentType?.includes('message/rfc822') || a.contentType?.includes('message/rfc') ||
               (a.filename||'').match(/\.eml$/i)),
  })).filter(a => {
    if (a.size > MAX_ATTACHMENT_BYTES) {
      console.warn(`  ⚠️  Attachment too large (${(a.size / 1024 / 1024).toFixed(1)}MB), skipping: ${a.name}`);
      return false;
    }
    return true;
  });

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
        // Log all inner attachments for debugging
        if (inner.attachments?.length > 0) {
          inner.attachments.forEach(a => {
            if (a.size > 1000) { // Only log substantial attachments
              console.log(`     📎 Inner att: "${a.filename || 'unnamed'}" | type: ${a.contentType} | disp: ${a.contentDisposition} | size: ${a.size}`);
            }
          });
        }

        const innerAtts = (inner.attachments || []).map(a => {
          const fname = a.filename || a.name || '';
          const ctype = a.contentType || '';
          const size  = a.size || a.content?.length || 0;
          // Also check related/alternative content parts that may contain PDFs
          const isXlsx = !!(ctype.includes('spreadsheet') || ctype.includes('excel') ||
                            fname.match(/\.(xlsx|xls)$/i));
          const isPdf  = !!(ctype.includes('pdf') ||
                            fname.match(/\.pdf$/i) ||
                            (ctype.includes('octet-stream') && fname.match(/\.pdf$/i)));
          return { name: fname || ctype.split('/')[1] || 'unnamed', buffer: a.content, size, isXlsx, isPdf, isEml: false };
        }).filter(a => {
          if (a.size > MAX_ATTACHMENT_BYTES) {
            console.warn(`  ⚠️  Inner attachment too large (${(a.size / 1024 / 1024).toFixed(1)}MB), skipping: ${a.name}`);
            return false;
          }
          return true;
        });

        // Also check related parts (some email clients embed PDFs in related/alternative parts)
        const relatedParts = inner.attachments?.filter(a =>
          !a.filename && (a.contentType?.includes('pdf') || a.contentType?.includes('octet-stream'))
          && a.size > 1000
        ) || [];
        relatedParts.forEach(part => {
          if (!innerAtts.find(a => a.buffer === part.content)) {
            innerAtts.push({
              name: `embedded_${part.contentType?.split('/')[1] || 'file'}.pdf`,
              buffer: part.content,
              isXlsx: false,
              isPdf: true,
              isEml: false,
            });
          }
        });

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
          console.warn(`  ⚠️  Cannot identify contractor in ${emlAtt.name} — skipping`);
          results.push({ type: 'eml', emlName: emlAtt.name, action: 'skipped_unidentified' });
          continue;
        }

        if (isInternal(contractor)) {
          console.warn(`  ⚠️  Extracted contractor is internal address (${contractor}) in ${emlAtt.name} — skipping`);
          results.push({ type: 'eml', emlName: emlAtt.name, action: 'skipped_internal' });
          continue;
        }

        if (isBlockedContractor(contractor)) {
          console.log(`  ⏭️  Blocked contractor in ${emlAtt.name}: ${contractor}`);
          results.push({ type: 'skipped', reason: `blocked: ${contractor}` });
          continue;
        }

        // Layer 1: sender allowlist
        if (!await isKnownContractor(contractor)) {
          console.warn(`  ⚠️  Unknown contractor in ${emlAtt.name}: ${contractor} — skipping`);
          results.push({ type: 'skipped', reason: `unknown_contractor: ${contractor}` });
          summary.unknownContractors = (summary.unknownContractors || 0) + 1;
          continue;
        }

        console.log(`  📧 ${contractor}${contractorName ? ` (${contractorName})` : ''}`);
        const { results: r, failedAttachments: fa } = await ingestContractor(
          contractor, contractorName, inner.subject || subject, innerBody, innerAtts, messageId
        );
        results.push(...r);
        fa.forEach(a => failedAtts.push({ ...a, contractor }));
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
      console.warn(`  ⚠️  Cannot extract contractor from: ${subject} — skipping`);
      results.push({ type: 'forward', subject, action: 'skipped_unidentified' });
      return;
    }
    contractor = extracted.email;
    contractorName = extracted.name;
    if (isInternal(contractor)) {
      console.warn(`  ⚠️  Extracted contractor is internal address (${contractor}) — skipping: ${subject}`);
      results.push({ type: 'forward', subject, action: 'skipped_internal' });
      return;
    }
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

  // Layer 1: sender allowlist — skip unknown contractors, forward to helpdesk
  if (!await isKnownContractor(contractor)) {
    console.warn(`  ⚠️  Unknown contractor: ${contractor} — skipping (not in profiles)`);
    results.push({ type: 'skipped', subject, reason: `unknown_contractor: ${contractor}` });
    await forwardToHelpdesk(subject, bodyText, fromEmail, `Unknown contractor email not in system: ${contractor}`);
    summary.unknownContractors = (summary.unknownContractors || 0) + 1;
    return;
  }

  console.log(`\n📧 ${subject}`);
  console.log(`   Contractor: ${contractor}${contractorName ? ` (${contractorName})` : ''}`);
  const { results: r, failedAttachments: fa } = await ingestContractor(
    contractor, contractorName, subject, bodyText,
    attachments.filter(a => !a.isEml), messageId
  );
  results.push(...r);
  fa.forEach(a => failedAtts.push({ ...a, contractor }));
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

          if (uids.length > MAX_EMAILS_PER_RUN) {
            console.warn(`⚠️  VOLUME CAP: ${uids.length} unseen emails — processing oldest ${MAX_EMAILS_PER_RUN} only. Possible flood.`);
            uids = uids.slice(0, MAX_EMAILS_PER_RUN);
          }
          console.log(`Found ${uids.length} unseen email(s)`);
          const messages = [];
          // markSeen: true — mark as seen on fetch so emails are never re-processed.
          // Retry for parse failures is handled via attempt_count in the DB log,
          // not by leaving emails unseen (which caused duplicate Claude API calls).
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

// ─── Delete DMARC emails via fresh connection ────────────────────────────────

function deleteDmarcEmails(uids) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user:       CONFIG.imapUser,
      password:   CONFIG.imapPass,
      host:       CONFIG.imapHost,
      port:       CONFIG.imapPort,
      tls:        true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });
    imap.once('error', reject);
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);
        imap.addFlags(uids, '\\Deleted', (err) => {
          if (err) { imap.end(); return reject(err); }
          imap.expunge((err) => {
            imap.end();
            if (err) return reject(err);
            resolve();
          });
        });
      });
    });
    imap.connect();
  });
}

// ─── Mark emails as seen via fresh IMAP connection ────────────────────────────

function markEmailsSeen(uids) {
  return new Promise((resolve, reject) => {
    if (!uids || uids.length === 0) return resolve();
    const imap = new Imap({
      user: CONFIG.imapUser, password: CONFIG.imapPass,
      host: CONFIG.imapHost, port: CONFIG.imapPort,
      tls: true, tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000, authTimeout: 10000,
    });
    imap.once('error', reject);
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) return reject(err);
        imap.addFlags(uids, '\\Seen', (err) => {
          imap.end();
          if (err) return reject(err);
          resolve();
        });
      });
    });
    imap.connect();
  });
}

// ─── Trigger weekly timesheet report ─────────────────────────────────────────

async function triggerTimesheetReport() {
  if (!CONFIG.timesheetReportUrl || !CONFIG.ingestSecret) return;
  try {
    const res = await fetch(CONFIG.timesheetReportUrl, {
      method: 'POST',
      headers: { 'x-ingest-secret': CONFIG.ingestSecret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  📊 Timesheet report sent — ${data.submitted}/${data.total} submitted, ${data.missing} missing`);
    } else {
      const err = await res.text();
      console.log(`  ⚠️  Timesheet report error: ${res.status} ${err.slice(0, 120)}`);
    }
  } catch (e) {
    console.log(`  ⚠️  Timesheet report failed: ${e.message}`);
  }
}

// ─── Send run summary email via Brevo ─────────────────────────────────────────

const RETRY_SILENT_AFTER = 10;

// ─── Send email via Brevo ────────────────────────────────────────────────────

async function sendEmail(to, subject, textContent) {
  if (!CONFIG.brevoApiKey) { console.warn('BREVO_API_KEY not set — skipping email'); return; }
  try {
    const body = JSON.stringify({
      sender: { name: CONFIG.fromName, email: CONFIG.fromEmail },
      to: [{ email: to }],
      subject,
      textContent,
    });
    await new Promise((resolve, reject) => {
      const req = require('https').request({
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': CONFIG.brevoApiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (e) {
    console.warn(`Email send failed: ${e.message}`);
  }
}

// ─── Forward unrecognised email to helpdesk ───────────────────────────────────

async function forwardToHelpdesk(subject, bodyText, fromEmail, reason) {
  const fwdSubject = `[timesheets@ fwd] ${subject || '(no subject)'}`;
  const fwdBody = `This email was received at timesheets@mysynergie.net and could not be automatically processed.

Reason: ${reason}
Original From: ${fromEmail}
Original Subject: ${subject || '(no subject)'}

--- Original Message ---
${(bodyText || '').slice(0, 2000)}`;
  await sendEmail(CONFIG.fallbackEmail, fwdSubject, fwdBody);
  console.log(`  📨 Forwarded to helpdesk: ${reason}`);
}

async function sendSummaryEmail(summary, leftUnseen) {
  const hasFailures = summary.failures.filter(f => f.attemptCount <= RETRY_SILENT_AFTER).length > 0;
  const status = hasFailures ? '⚠️ PARTIAL' : '✅ OK';
  const subject = `[Timesheet Poller] ${status} — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`;

  let body = `Synergie Timesheet Poller — Run Summary
${'='.repeat(50)}
Run time   : ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
Emails found: ${summary.total}

RESULTS
-------
✅ Created        : ${summary.created}
🔁 Duplicates     : ${summary.duplicates}
✏️  Corrections    : ${summary.corrections}
📨 Forwarded      : ${summary.forwarded}
🗑️  DMARC deleted  : ${summary.dmarc}
⚠️  Parse failures : ${summary.failures.length}
🧾 Invoices parsed : ${summary.invoiceReports.length}${CONFIG.invoiceIngestEnabled ? ' (ingested)' : ' (dry-run — not ingested)'}
`;

  if (summary.newUsers.length > 0) {
    body += `
NEW USERS CREATED (${summary.newUsers.length})
${'─'.repeat(30)}
`;
    summary.newUsers.forEach(u => { body += `  • ${u.name} <${u.email}>
`; });
  }

  const reportableFailures = summary.failures.filter(f => f.attemptCount <= RETRY_SILENT_AFTER);
  const silentFailures     = summary.failures.filter(f => f.attemptCount > RETRY_SILENT_AFTER);

  if (reportableFailures.length > 0) {
    body += `
FAILURES — NEEDS ATTENTION (${reportableFailures.length})
${'─'.repeat(30)}
`;
    reportableFailures.forEach(f => {
      body += `  • ${f.contractor || '?'} | ${f.attachment || 'body'}`;
      if (f.attemptCount > 1) body += ` (attempt ${f.attemptCount})`;
      body += `
    Error: ${f.error || 'parse returned no hours'}
`;
    });
  }

  if (silentFailures.length > 0) {
    body += `
${silentFailures.length} failure(s) suppressed after ${RETRY_SILENT_AFTER}+ attempts (still retrying silently).
`;
  }

  if (summary.invoiceReports.length > 0) {
    body += `
INVOICE PARSE REPORTS (${summary.invoiceReports.length})${CONFIG.invoiceIngestEnabled ? '' : ' — DRY RUN, nothing written to DB'}
${'─'.repeat(50)}
`;
    for (const inv of summary.invoiceReports) {
      const p = inv.parsed;
      const pd = p?.paymentDetails || {};
      const canIngest = p?.periodStart && p?.periodEnd && p?.totalHours != null;
      const tag = (val, assumed) => val != null && val !== '' ? `${val}` : (assumed ? `(assumed: ${assumed})` : '—');

      body += `
  ${inv.email}  |  ${inv.filename}
  Invoice #  : ${tag(p?.invoiceNumber, 'auto-generated')}
  Period     : ${tag(p?.periodStart)} → ${tag(p?.periodEnd)}
  Hours      : ${tag(p?.totalHours)}   Rate: ${tag(p?.rate, '0')}   Amount: ${tag(p?.totalAmount, 'hours × rate')}   Currency: ${tag(p?.currency, 'USD')}
  Company    : ${tag(pd.companyName)}
  Bank       : ${tag(pd.bankName)}   Account: ${tag(pd.accountNumber)}   IBAN: ${tag(pd.iban)}
  SWIFT      : ${tag(pd.swift)}   Sort Code: ${tag(pd.sortCode)}   Routing: ${tag(pd.routingNumber)}
  ${p?.parseNotes ? `Notes: ${p.parseNotes}` : ''}
  ${canIngest ? '>> OK to ingest' : '>> MISSING required fields (period or hours)'}
`;
    }
  }

  body += `
${'='.repeat(50)}
This is an automated message from timesheets@mysynergie.net`;

  await sendEmail(CONFIG.fallbackEmail, subject, body);
  console.log(`  📧 Summary email sent to ${CONFIG.fallbackEmail}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Synergie Timesheet Poller');
  console.log(`   IMAP: ${CONFIG.imapUser}@${CONFIG.imapHost}`);
  console.log(`   Ingest: ${CONFIG.ingestUrl}\n`);

  const rawMessages = await fetchEmails();
  if (!rawMessages || rawMessages.length === 0) {
    console.log('No unseen emails. Done.');
    return;
  }

  const dmarcUids     = [];

  const summary = {
    total: rawMessages.length, dmarc: 0, forwarded: 0,
    created: 0, duplicates: 0, corrections: 0,
    newUsers: [], failures: [], invoiceReports: [],
  };

  for (const raw of rawMessages) {
    const uid = raw.uid;
    let parsed;
    try {
      parsed = await simpleParser(raw.buffer);
    } catch (e) {
      console.error(`Parse error uid=${uid}: ${e.message}`);
      summary.failures.push({ contractor: '?', attachment: null, error: `Parse error: ${e.message}`, attemptCount: 1 });
      continue;
    }

    const fromAddr  = parsed.from?.value?.[0];
    const fromEmail = (fromAddr?.address || '').toLowerCase();
    const subject   = parsed.subject || '(no subject)';
    const bodyText  = parsed.text || (parsed.html || '').replace(/<[^>]+>/g, ' ');
    const messageId = parsed.messageId || `uid-${uid}-${Date.now()}`;

    // DMARC: delete
    if (isDmarc(fromEmail, subject)) {
      dmarcUids.push(uid);
      summary.dmarc++;
      console.log(`  🗑️  DMARC: ${subject}`);
      continue;
    }

    const attachments = (parsed.attachments || []).map(a => ({
      name:   a.filename || a.name || (a.contentType?.split('/')[1]) || 'unnamed',
      buffer: a.content,
      size:   a.size || a.content?.length || 0,
      isXlsx: !!(a.contentType?.includes('spreadsheet') || a.contentType?.includes('excel') ||
                 (a.filename||'').match(/\.(xlsx|xls)$/i)),
      isPdf:  !!(a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i) ||
                 (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
      isEml:  !!(a.contentType?.includes('message/rfc822') || (a.filename||'').match(/\.eml$/i)),
    })).filter(a => {
      if (a.size > MAX_ATTACHMENT_BYTES) {
        console.warn(`  ⚠️  Attachment too large (${(a.size / 1024 / 1024).toFixed(1)}MB), skipping: ${a.name}`);
        return false;
      }
      return true;
    });

    const hasTimesheetContent = attachments.some(a => a.isXlsx || a.isPdf || a.isEml);

    // No timesheet content: forward to helpdesk, mark seen
    if (!hasTimesheetContent) {
      const reason = isInternal(fromEmail)
        ? 'Internal sender with no timesheet attachments'
        : 'No timesheet attachments — possible human reply or notification';
      await forwardToHelpdesk(subject, bodyText, fromEmail, reason);
      summary.forwarded++;
      continue;
    }

    // Process email — collect results and failed attachments
    const emailResults = [];
    const emailFailedAtts = [];
    await processEmail(parsed, messageId, emailResults, emailFailedAtts, summary);

    // Accumulate summary counts
    emailResults.forEach(r => {
      if (r.action === 'created') summary.created++;
      else if (r.action === 'duplicate') summary.duplicates++;
      else if (r.action === 'correction_imported') summary.corrections++;
      else if (r.action === 'invoice_skipped') { /* no anthropic key — ignore */ }
      else if (r.action?.startsWith('invoice_')) {
        summary.invoiceReports.push({ email: r.contractor, filename: r.attachmentName, parsed: r.parsed, action: r.action });
      }
      if (r.wasCreated && r.userName) {
        summary.newUsers.push({ name: r.userName, email: r.contractor });
      }
      if (r.error) {
        summary.failures.push({
          contractor: r.contractor,
          attachment: r.attachmentName,
          error: r.error,
          attemptCount: r.attemptCount || 1
        });
      }
    });
    emailFailedAtts.forEach(att => {
      summary.failures.push({
        contractor: att.contractor || '?',
        attachment: att.name,
        error: 'parse returned no hours',
        attemptCount: att.attemptCount || 1
      });
    });

  }

  // IMAP operations — only DMARC deletes needed (emails already marked seen on fetch)
  if (dmarcUids.length > 0) {
    try { await deleteDmarcEmails(dmarcUids); console.log(`  🗑️  Deleted ${dmarcUids.length} DMARC emails`); }
    catch (e) { console.warn(`DMARC delete failed: ${e.message}`); }
  }

  // Console summary
  console.log('\n─── Summary ──────────────────────────────────────────────');
  console.log(`  Emails found     : ${summary.total}`);
  console.log(`  DMARC deleted    : ${summary.dmarc}`);
  console.log(`  Forwarded        : ${summary.forwarded}`);
  console.log(`  Unknown senders  : ${summary.unknownContractors || 0}`);
  console.log(`  Created          : ${summary.created}`);
  console.log(`  Duplicates       : ${summary.duplicates}`);
  console.log(`  Corrections      : ${summary.corrections}`);
  console.log(`  Invoices parsed  : ${summary.invoiceReports.length}${CONFIG.invoiceIngestEnabled ? '' : ' (dry-run)'}`);
  console.log(`  Failures         : ${summary.failures.length}`);

  // Summary email — only if something actionable happened
  const actionable = summary.created + summary.duplicates + summary.corrections +
                     summary.forwarded + summary.failures.length + summary.newUsers.length +
                     summary.invoiceReports.length;
  if (actionable > 0) {
    await sendSummaryEmail(summary, 0);
    await triggerTimesheetReport();
  }

  const reportableFailures = summary.failures.filter(f => f.attemptCount <= RETRY_SILENT_AFTER);
  if (reportableFailures.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
