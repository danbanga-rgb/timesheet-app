// ============================================================
// poller.js — Synergie Timesheet Email Poller
// Runs hourly via GitHub Actions cron.
// Fetches UNSEEN emails, parses XLSX/PDF, posts to edge function.
// ============================================================

'use strict';

const Imap               = require('imap');
const { simpleParser }   = require('mailparser');
const XLSX               = require('xlsx');
const AdmZip             = require('adm-zip');
const { randomUUID, createHash } = require('crypto');
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
  fallbackEmail:    process.env.IMPORT_FALLBACK_EMAIL || 'helpdesk@synergietechsolutions.com',
  accountingEmail:  process.env.ACCOUNTING_EMAIL     || 'accounting@synergietechsolutions.com',
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

const CORRECTION_KEYWORDS = /\b(correction|corrected|correcting|re-?submit(?:ted)?|resubmit(?:ted)?|amended|amendment|revised|revision|replacing|fixed)\b/i;

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

// Look up a contractor profile by name via SECURITY DEFINER RPC (bypasses RLS).
// Returns { id, email, name } or null if not found.
async function findProfileByName(name) {
  if (!SUPABASE_REST_URL || !name) return null;
  try {
    const res = await fetch(
      `${SUPABASE_REST_URL}/rpc/find_profile_by_name`,
      {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_name: name }),
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

// Returns true for QuickBooks / Intuit automated notification senders.
// These emails carry real attachments (timesheets + invoices) but are sent by
// Intuit's notification infrastructure, not by the contractor directly. We
// resolve the contractor from attachment filenames instead of the From header.
function isIntuitNotification(email) {
  const domain = (email || '').toLowerCase().split('@')[1] || '';
  return domain === 'notification.intuit.com' || domain === 'intuit.com';
}

// Look up a contractor by first name. Returns { id, email, name } if exactly
// one timesheetuser matches, null if zero or ambiguous.
async function findProfileByFirstName(firstName) {
  if (!SUPABASE_REST_URL || !firstName) return null;
  try {
    const res = await fetch(
      `${SUPABASE_REST_URL}/rpc/find_profile_by_first_name`,
      {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_first_name: firstName }),
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows || rows.length !== 1) {
      console.warn(`  ⚠️  First name '${firstName}' matched ${rows?.length ?? 0} profiles (need exactly 1)`);
      return null;
    }
    return rows[0];
  } catch {
    return null;
  }
}

// Returns true if this invoice attachment was already successfully ingested.
// Checked before calling extractInvoice() to avoid burning Claude credits on reruns.
// Fail-open: returns false on any network/DB error so the invoice is still processed.
async function invoiceAlreadyProcessed(messageIdPrefix) {
  if (!SUPABASE_REST_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_REST_URL}/rpc/check_invoice_already_processed`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_message_id_prefix: messageIdPrefix }),
    });
    if (!res.ok) return false;
    return await res.json(); // boolean
  } catch {
    return false;
  }
}

// Extract text content from a DOCX buffer. DOCX files are ZIP archives;
// word/document.xml holds the document body as XML.
function extractDocxText(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return '';
    const xml = entry.getData().toString('utf-8');

    // Concatenate <w:t> runs WITHOUT separators — legitimate spaces are explicit
    // characters inside <w:t> content in DOCX. Only insert breaks at paragraph/cell
    // boundaries. This prevents spaces being inserted within numbers and diacritics.
    let text = xml
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<\/w:tc>/gi, ' ')
      .replace(/<w:t(?:[^>]*)?>([^<]*)<\/w:t>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Safety net: collapse any remaining spaces that split numbers across runs
    // (covers cases where space characters are in <w:t> content itself).
    let prev;
    do { prev = text; text = text.replace(/(\d) (\d)/g, '$1$2'); } while (text !== prev);
    text = text.replace(/(\d) ([,\.]) (\d)/g, '$1$2$3');
    text = text.replace(/(\d) ([,\.])/g,      '$1$2');
    text = text.replace(/([,\.]) (\d)/g,      '$1$2');
    text = text.replace(/(\d) ([-\/])/g,      '$1$2');
    text = text.replace(/([-\/]) (\d)/g,      '$1$2');

    return text;
  } catch (e) {
    console.warn(`  ⚠️  DOCX text extraction failed: ${e.message}`);
    return '';
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
  let name = filename.replace(/\.(xlsx|xls|csv|pdf)$/i, '');
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
  // Content (body) is checked before subject — subject lines are often stale
  // copy-paste artefacts from forwarded threads. If both have a date, body wins.
  const sources = [
    { text: (body || '').slice(0, 2000), src: 'body' },
    { text: subject, src: 'subject' },
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

// Extract a week-start date from the email subject only (no body, no filename).
// Returns an ISO Monday string or null. Used as the second candidate in week resolution.
function parseWeekFromSubject(subject) {
  if (!subject) return null;
  for (const pat of WEEK_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(subject);
    if (m) {
      try {
        const raw = expandTwoDigitYear(normaliseDate(m[1]));
        for (const ds of [`${raw} ${new Date().getFullYear()}`, raw]) {
          const d = new Date(ds);
          if (!isNaN(d.getTime())) return getMondayOf(d);
        }
      } catch {}
    }
  }
  return null;
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

      // ── Portal export format (timesheets_export_*.csv) ───────────────────────
      // Header: Employee Name, Week Start, Project, Mon–Sun, Total Hours, Status…
      // One row per timesheet week; parse each row and skip the template scanner.
      const hdr = (json[0] || []).map(c => String(c).toLowerCase().trim());
      if (hdr.includes('employee name') && hdr.includes('week start') &&
          ['mon','tue','wed','thu','fri'].filter(d => hdr.includes(d)).length >= 5) {
        const nameIdx = hdr.indexOf('employee name');
        const weekIdx = hdr.indexOf('week start');
        const dayIdxMap = {};
        ['mon','tue','wed','thu','fri','sat','sun'].forEach(d => {
          const i = hdr.indexOf(d); if (i >= 0) dayIdxMap[d] = i;
        });
        for (let r = 1; r < json.length; r++) {
          const row = json[r] || [];
          if (row.every(c => !String(c).trim())) continue;
          const weekCell = row[weekIdx];
          let weekStart = null;
          if (weekCell instanceof Date && !isNaN(weekCell.getTime())) {
            weekStart = getMondayOf(weekCell);
          } else {
            const weekRaw = String(weekCell || '').trim();
            const mdy = weekRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (mdy) {
              weekStart = getMondayOf(new Date(Date.UTC(+mdy[3], +mdy[1]-1, +mdy[2])));
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(weekRaw)) {
              weekStart = getMondayOf(new Date(weekRaw + 'T12:00:00Z'));
            }
          }
          if (!weekStart) continue;
          const base = new Date(weekStart + 'T12:00:00Z');
          const fullEntries = {};
          ['mon','tue','wed','thu','fri','sat','sun'].forEach((d, i) => {
            const dt = new Date(base); dt.setUTCDate(base.getUTCDate() + i);
            const raw = String(row[dayIdxMap[d]] ?? '').replace(/[^0-9.]/g, '');
            const val = parseFloat(raw);
            fullEntries[dt.toISOString().split('T')[0]] = (!isNaN(val) && val >= 0 && val <= 24) ? val : 0;
          });
          const total = Object.values(fullEntries).reduce((s, h) => s + h, 0);
          results.push({
            weekStart,
            entries: fullEntries,
            total,
            nameFromSheet: String(row[nameIdx] || '').trim() || null,
            notes: `Sheet: ${sheetName} (portal export)`,
          });
        }
        continue;
      }

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
        // Future-date guard: > 14 days ahead = almost certainly a MM/DD↔DD/MM swap.
        // Try swapping month and day; if the swapped date is plausible, use it.
        if (weekStartDate) {
          const daysAhead = (new Date(weekStartDate).getTime() - Date.now()) / 86400000;
          if (daysAhead > 14) {
            const [y, m, d] = weekStartDate.split('-').map(Number);
            if (m !== d) { // only swap if month ≠ day (otherwise swapping changes nothing)
              const swapped = getMondayOf(new Date(Date.UTC(y, d - 1, m)));
              const swappedAge = (Date.now() - new Date(swapped).getTime()) / 86400000;
              if (swappedAge >= -7 && swappedAge <= 180) {
                console.warn(`XLSX: future date ${weekStartDate} looks like MM/DD↔DD/MM swap — using ${swapped}`);
                weekStartDate = swapped;
              } else {
                console.warn(`XLSX: implausible future weekStart ${weekStartDate} — skipping sheet`);
                weekStartDate = null;
              }
            }
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

  // Stale template check: if the parsed week is more than 90 days old, the PDF
  // is likely a copy of an old template. Fall back to filename date if available.
  if (weekStart) {
    const weekAge = (Date.now() - new Date(weekStart).getTime()) / 86400000;
    if (weekAge > 90) {
      const filenameWeek = weekFromFilename(filename);
      if (filenameWeek) {
        console.warn(`PDF: stale template date (${weekStart}), using filename date: ${filenameWeek}`);
        weekStart = filenameWeek;
      }
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
  "contractors": [
    { "name": string, "hours": number, "rate": number | null, "amount": number | null }
  ] | null,
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
- contractors: when isMultiContractor is true, populate this array with one entry per contractor line. Each entry: name (full name as printed on the invoice), hours (their individual hours), rate (their hourly rate or null), amount (their line-item total or null). Set to null when isMultiContractor is false.
- periodStart / periodEnd: the BILLING PERIOD (dates the work was performed), not the invoice issue date and not dates embedded in the invoice number. If only a month is given (e.g. "April 2026"), use the first and last day of that month. IMPORTANT: invoice numbers often contain date-like components (e.g. "002/05/2026", "2026-04-0007") — do NOT use these as the period; look for explicit "period", "billing period", "services rendered", or a clear date range in the description.
- totalHours: hours worked — a number (e.g. 160, 144.5). Ignore text like "h", "hrs", "hours" suffix. If the quantity is expressed as "pcs", "pieces", or "units" in a service/consulting invoice, treat it as hours worked (contractors sometimes invoice in units rather than hours).
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
- If no explicit billing period is stated but an invoice date is present: determine whether this is an invoice for the PREVIOUS month's work. Contractors routinely invoice in the first days of month N for work completed in month N-1. Use the PREVIOUS calendar month when EITHER condition holds: (a) the invoice date is on or before the 10th of the month, OR (b) the total hours claimed are implausibly high for the days elapsed since the start of the invoice month (e.g. 176h on May 7 — only 7 working days elapsed, impossible). Otherwise use the invoice date's own calendar month. Examples: invoice date 07 May 2026, 176h → previous month → periodStart: 2026-04-01, periodEnd: 2026-04-30. Invoice date 01 Jun 2026, 160h → condition (a) met → previous month → periodStart: 2026-05-01, periodEnd: 2026-05-31. Invoice date 25 May 2026, 160h → same month → periodStart: 2026-05-01, periodEnd: 2026-05-31.
- IMPORTANT: Do NOT use the PDF filename to infer the billing period. Filenames like "6-1-1.pdf" or "5-2-3.pdf" are invoice sequence numbers, not dates.
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

// Parses billing month from email subjects like "[Invoice 05/26]" or "[Invoice 05/2026]".
// This is the highest-priority period signal — forwarder explicitly labels the month.
function parsePeriodFromSubject(subject) {
  if (!subject) return null;
  const m = subject.match(/\[Invoice\s+(\d{1,2})\/(\d{2,4})\]/i);
  if (!m) return null;
  let month = parseInt(m[1], 10);
  let year  = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return null;
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

// Deterministic period correction for early-month invoices.
// When a full calendar-month period lands in the current month and we're in the
// first 10 days, assume it's for the PREVIOUS month — contractors frequently
// label their June invoice "June 2026" even when billing for May work.
// This is a hard post-parse override; it does NOT rely on Claude heuristics.
function applyEarlyMonthPeriodFix(result) {
  if (!result?.periodStart || !result?.periodEnd) return result;
  const today = new Date();
  if (today.getUTCDate() > 10) return result;

  // Only applies to full calendar months (1st → last day of same month)
  const [py, pm] = result.periodStart.split('-').map(Number);
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const isFullMonth = result.periodStart.endsWith('-01')
    && result.periodEnd === `${py}-${String(pm).padStart(2, '0')}-${lastDay}`;
  if (!isFullMonth) return result;

  // Only applies when the period is the CURRENT month
  const todayYM = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
  if (result.periodStart.slice(0, 7) !== todayYM) return result;

  // Shift back one month
  const prevStart = new Date(Date.UTC(py, pm - 2, 1));
  const prevEnd   = new Date(Date.UTC(py, pm - 1, 0));
  const newStart  = prevStart.toISOString().slice(0, 10);
  const newEnd    = prevEnd.toISOString().slice(0, 10);
  console.warn(`  📅 Early-month period fix: ${result.periodStart}–${result.periodEnd} → ${newStart}–${newEnd} (day ${today.getUTCDate()} of month)`);
  return { ...result, periodStart: newStart, periodEnd: newEnd };
}

// Shared post-processing: EUR→USD override + rate/hours derivation.
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

  // Derive missing rate or hours from the other two — but never override explicitly found values.
  // If both rate and hours are found, trust them as-is even if rate × hours ≠ total.
  const h = result.totalHours, r = result.rate, t = result.totalAmount;
  if (h == null && r != null && r > 0 && t != null) {
    const derived = t / r;
    if (derived >= 1 && derived < 10000) result = { ...result, totalHours: Math.round(derived * 100) / 100 };
  } else if (r == null && h != null && h > 0 && t != null) {
    const derived = t / h;
    // Sanity cap: derived rate > $120/hr means totalAmount was a false regex match — discard.
    if (derived >= 1 && derived <= 120) result = { ...result, rate: Math.round(derived * 100) / 100 };
  }

  // Sanity cap on any rate value (derived or explicit) — $120/hr is the ceiling.
  // If exceeded, null it out so Claude or a human can supply the correct value.
  if (result.rate != null && result.rate > 120) {
    const capNote = `Rate $${result.rate}/hr exceeded $120 cap — likely parse error`;
    result = { ...result, rate: null, parseNotes: [capNote, result.parseNotes].filter(Boolean).join(' | ') };
  }

  return result;
}

// Merge regex and Claude results.
// Financial fields (totalHours, rate, totalAmount): Claude wins when available — regex is
// prone to false matches on large numbers. Regex fills in only what Claude missed.
// Non-financial fields (invoiceNumber, periodStart, periodEnd): regex wins (deterministic).
// Exception: currency — Claude wins over regex when they conflict (EUR templates with USD billing).
function mergeInvoiceResults(regex, claude) {
  const merged = { ...claude, paymentDetails: { ...(claude.paymentDetails || {}) } };
  if (!regex) return merged;
  // Non-financial: regex wins
  for (const f of ['invoiceNumber', 'periodStart', 'periodEnd']) {
    if (regex[f] != null) merged[f] = regex[f];
  }
  // Financial: Claude wins; regex only fills gaps
  for (const f of ['totalHours', 'rate', 'totalAmount']) {
    if (merged[f] == null && regex[f] != null) merged[f] = regex[f];
  }
  // Currency: regex wins only when Claude has no opinion, or both agree.
  if (regex.currency != null) {
    if (claude?.currency == null || claude.currency === regex.currency) merged.currency = regex.currency;
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
async function claudeFullExtractInvoice(text, pdfBuffer, isImagePdf, filename, emailBodyText = '') {
  if (!CONFIG.anthropicApiKey) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
    let userContent;
    if (text) {
      const bodyPrefix = emailBodyText
        ? `Email body (may contain invoice breakdown):\n${emailBodyText.slice(0, 1000)}\n\n`
        : '';
      userContent = `${bodyPrefix}Extract invoice data from this document:\n\n${text}`;
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

// Extract total hours from email body prose (e.g. "amounting to 192h" or "total is 192h").
// Used to supplement PDF parsing when the invoice spans two months but PDF only captured one.
function extractTotalHoursFromBodyProse(text) {
  const patterns = [
    /amounting\s+to[^.\n,]{0,30}?(\d+(?:\.\d+)?)\s*h\b/i,
    /total\s+(?:is\s+)?[^.\n,]{0,20}?(\d+(?:\.\d+)?)\s*h\b/i,
    /(\d+(?:\.\d+)?)\s*h(?:ours?)?\s+total/i,
    /total[:\s]+(\d+(?:\.\d+)?)\s*h(?:ours?)?/i,
  ];
  for (const pat of patterns) {
    const m = pat.exec(text);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

// ─── Main invoice orchestrator ────────────────────────────────────────────────
// 1. Regex (free, always runs on text PDFs) via parser.js
// 2a. Regex has period + hours + payment → done, zero Claude calls
// 2b. Regex has period + hours, missing payment → Claude for payment details only
// 2c. Regex missing period or hours → full Claude extract, merge regex on top
async function extractInvoice(pdfText, isImagePdf, pdfBuffer, filename, emailBodyText = '') {
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
      const r = postProcessInvoice(regexResult, pdfText);
      if (r) r.parseMethod = hasPayment ? 'regex' : 'regex_partial';
      return r;
    }

    // ── Step 2b: regex has numbers, Claude fills payment details only ────────
    // Skip if no payment-related keywords appear in the text — Claude would return all nulls.
    const paymentKeywords = /iban|swift|bic\b|account\s*(no|number|#)|sort\s*code|routing|bank\s*(name|details|transfer)/i;
    if (!paymentKeywords.test(pdfText)) {
      console.log(`  ✅ Regex (no payment section): ${filename}`);
      const r = postProcessInvoice(regexResult, pdfText);
      if (r) r.parseMethod = 'regex_no_payment';
      return r;
    }

    console.log(`  💳 Claude payment-only: ${filename}`);
    const claudePd = await claudeExtractPaymentOnly(
      pdfText ? prepareInvoiceText(pdfText) : null, pdfBuffer, isImagePdf
    );
    const r2b = postProcessInvoice(
      { ...regexResult, paymentDetails: claudePd ?? regexResult.paymentDetails },
      pdfText
    );
    if (r2b) r2b.parseMethod = 'regex+claude_payment';
    return r2b;
  }

  // ── Step 2c: regex insufficient — full Claude extract ─────────────────────
  if (!CONFIG.anthropicApiKey) {
    const r = regexResult ? postProcessInvoice(regexResult, pdfText) : null;
    if (r) r.parseMethod = 'regex_partial';
    return r;
  }

  console.log(`  🤖 Claude: ${filename}`);
  const claudeResult = await claudeFullExtractInvoice(
    pdfText ? prepareInvoiceText(pdfText) : null, pdfBuffer, isImagePdf, filename, emailBodyText
  );

  if (!claudeResult) {
    const r = regexResult ? postProcessInvoice(regexResult, pdfText) : null;
    if (r) r.parseMethod = 'regex_partial';
    return r;
  }

  const merged = mergeInvoiceResults(regexResult, claudeResult);
  const r2c = postProcessInvoice(applyFilenamePeriodFallback(merged, filename), pdfText);
  if (r2c) r2c.parseMethod = isImagePdf && !pdfText ? 'claude_vision' : 'claude_full';
  return r2c;
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

async function ingestContractor(contractorEmail, displayName, subject, bodyText, attachments, messageId, runId = null, forwardedBy = null) {
  // Strip non-timesheet documents silently — agreements, AUPs, SOWs, etc.
  const nonTimesheetAtts = attachments.filter(a => (a.isPdf || a.isXlsx) && NON_TIMESHEET_DOC_RE.test(a.name));
  if (nonTimesheetAtts.length) {
    nonTimesheetAtts.forEach(a => console.log(`  ⏭️  Non-timesheet doc skipped: ${a.name}`));
  }
  const relevantAtts = attachments.filter(a => !NON_TIMESHEET_DOC_RE.test(a.name));

  // Classify each PDF as timesheet / invoice / both / unknown via content scoring.
  // XLSX is always treated as a timesheet (no invoice XLSX path exists).
  // DOCX is always treated as an invoice (contractors use Word for invoice templates).
  const xlsxAtts    = relevantAtts.filter(a => a.isXlsx || a.isCsv);
  const pdfQueue    = relevantAtts.filter(a => a.isPdf);
  const docxQueue   = relevantAtts.filter(a => a.isDocx);

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

  // DOCX attachments are treated as invoices — extract text from the ZIP/XML structure
  for (const att of docxQueue) {
    console.log(`  📄 DOCX invoice attachment: ${att.name}`);
    att.pdfText    = extractDocxText(att.buffer);
    att.isImagePdf = false;
    invoiceAtts.push(att);
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

  // Week resolution candidates: content-derived week (from attachment/body) is always
  // first. Subject-derived week is the second candidate for the edge function to compare.
  const weekFromSubject = parseWeekFromSubject(subject);
  const correctionHint  = CORRECTION_KEYWORDS.test(subject || '') ||
                          CORRECTION_KEYWORDS.test((bodyText || '').slice(0, 500));

  const results = [];
  for (const ts of timesheets) {
    if (ts.claudeAttempted || ts.xlsxParseFailed) continue; // sentinels — don't post, don't retry
    const weekCandidates = [...new Set([ts.weekStart, weekFromSubject].filter(Boolean))];
    try {
      const res = await postToIngest({
        messageId:       `${messageId}::${ts.attachmentName || 'body'}`,
        contractorEmail,
        contractorName:  ts.resolvedName,
        subject,
        weekStart:       ts.weekStart,
        weekCandidates,
        correctionHint,
        entries:         ts.entries,
        total:           ts.total,
        attachmentName:  ts.attachmentName,
        attachmentType:  ts.attachmentType,
        parseNotes:      ts.notes || '',
        source:          'imported',
        run_id:          runId,
        forwardedBy:     forwardedBy || null,
      });
      const action = res.body?.action || String(res.status);
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
    const attHash   = createHash('sha256').update(att.buffer).digest('hex');
    const attMsgKey = `${messageId}::${att.name}`;
    if (await invoiceAlreadyProcessed(attMsgKey)) {
      console.log(`  ⚡ Invoice skip — already processed: ${att.name}`);
      results.push({ contractor: contractorEmail, attachmentName: att.name, action: 'invoice_duplicate' });
      continue;
    }
    let parsed = await extractInvoice(att.pdfText || '', att.isImagePdf || false, att.buffer, att.name, bodyText || '');
    if (parsed) parsed = applyEarlyMonthPeriodFix(parsed);
    // Supplement/extend from email body:
    // - fills missing fields (totalHours, rate, totalAmount)
    // - extends period if body shows a wider date range than the PDF extracted
    // - takes body prose total hours when larger than PDF (invoice spanning two months)
    if (parsed && bodyText) {
      const changed = [];
      // Prose total hours runs first, outside require try/catch — no external dependency
      const proseHours = extractTotalHoursFromBodyProse(bodyText);
      console.log(`  🔍 Body supplement: bodyLen=${bodyText.length}, proseHours=${proseHours}, snippet=${JSON.stringify(bodyText.slice(0, 200))}`);
      if (proseHours != null && proseHours > (parsed.totalHours ?? 0)) {
        const oldHours = parsed.totalHours;
        parsed.totalHours = proseHours;
        changed.push(`hours ${oldHours}→${proseHours} (prose)`);
        if (parsed.totalAmount != null) {
          const derivedRate = Math.round((parsed.totalAmount / proseHours) * 100) / 100;
          if (derivedRate >= 1 && derivedRate < 10000) { parsed.rate = derivedRate; changed.push(`rate re-derived→${derivedRate}`); }
        }
      }
      // Regex parser for period extension and missing structured fields
      try {
        const { parseInvoice } = require('../invoice-parser/parser.js');
        const bodyResult = parseInvoice(bodyText.slice(0, 3000), 'email-body');
        if (parsed.totalHours == null && bodyResult?.totalHours != null) { parsed.totalHours = bodyResult.totalHours; changed.push(`hours→${bodyResult.totalHours}`); }
        if (parsed.rate == null && bodyResult?.rate != null) { parsed.rate = bodyResult.rate; changed.push(`rate→${bodyResult.rate}`); }
        if (parsed.totalAmount == null && bodyResult?.totalAmount != null) { parsed.totalAmount = bodyResult.totalAmount; changed.push(`amount→${bodyResult.totalAmount}`); }
        // Extend period if body has wider range (e.g. invoice spans two months but PDF only extracted one)
        if (bodyResult?.periodStart && parsed.periodStart && bodyResult.periodStart < parsed.periodStart) {
          parsed.periodStart = bodyResult.periodStart; changed.push(`periodStart→${bodyResult.periodStart}`);
        }
        if (bodyResult?.periodEnd && parsed.periodEnd && bodyResult.periodEnd > parsed.periodEnd) {
          parsed.periodEnd = bodyResult.periodEnd; changed.push(`periodEnd→${bodyResult.periodEnd}`);
        }
      } catch {}
      if (changed.length) {
        console.log(`  📧 Body supplement for ${att.name}: ${changed.join(', ')}`);
        parsed.parseMethod = (parsed.parseMethod || 'unknown') + '+body';
      }
    }
    // Subject hint overrides extracted period — e.g. "[Invoice 05/26]" beats a June date
    // parsed from the PDF when the contractor invoices for the previous month.
    if (parsed) {
      const subjectPeriod = parsePeriodFromSubject(subject);
      if (subjectPeriod) {
        const extractedYM = parsed.periodStart?.slice(0, 7);
        const subjectYM   = subjectPeriod.periodStart.slice(0, 7);
        if (extractedYM !== subjectYM) {
          console.warn(`  📧 Period override from subject: ${extractedYM} → ${subjectYM} (${subject})`);
          parsed.periodStart = subjectPeriod.periodStart;
          parsed.periodEnd   = subjectPeriod.periodEnd;
        }
      }
    }
    console.log(formatInvoiceReport(att.name, contractorEmail, parsed));

    // ── Multi-contractor invoice (e.g. Teal Crossroads) ──────────────────────
    if (CONFIG.invoiceIngestEnabled && CONFIG.invoiceIngestUrl &&
        parsed?.isMultiContractor && Array.isArray(parsed?.contractors) && parsed.contractors.length > 0) {
      const groupKey = `${messageId}::${att.name}`;
      console.log(`  🔀 Multi-contractor (${parsed.contractors.length} lines): splitting`);
      for (let ci = 0; ci < parsed.contractors.length; ci++) {
        const line = parsed.contractors[ci];
        const profile = await findProfileByName(line.name);
        if (!profile) {
          console.warn(`    ⚠️  No profile for "${line.name}" — skipping`);
          results.push({
            contractor:    line.name,
            attachmentName: att.name,
            action:        'invoice_partial',
            error:         `No profile found for: "${line.name}"`,
            parsed,
          });
          continue;
        }
        try {
          const res = await postToIngest({
            messageId:      `${messageId}::${att.name}::${ci}`,
            contractorEmail: profile.email,
            contractorName:  profile.name,
            subject,
            attachmentName:  att.name,
            invoiceNumber:   parsed.invoiceNumber  || null,
            periodStart:     parsed.periodStart,
            periodEnd:       parsed.periodEnd,
            totalHours:      line.hours,
            rate:            line.rate             || null,
            totalAmount:     line.amount           || null,
            currency:        parsed.currency       || null,
            paymentDetails:  parsed.paymentDetails || null,
            parseNotes:      `[multi-contractor ${ci+1}/${parsed.contractors.length}: ${line.name}] [${parsed.parseMethod || 'unknown'}]`,
            pdfBase64:       att.buffer.toString('base64'),
            rawExtracted:    parsed,
            forwardedBy:     forwardedBy || null,
            groupKey,
            attachmentHash:  attHash,
          }, CONFIG.invoiceIngestUrl);
          const action = res.body?.action || res.body?.error || String(res.status);
          console.log(`    [${ci+1}] ${profile.name} → ${action}`);
          results.push({
            contractor:           profile.email,
            attachmentName:       att.name,
            action:               `invoice_${action}`,
            ingestOk:             res.body?.ok === true,
            invoiceNumber:        res.body?.invoiceNumber || null,
            reconciliationStatus: res.body?.reconciliationStatus || null,
            reconciliationDelta:  res.body?.reconciliationDelta ?? null,
            parsed: { ...parsed, totalHours: line.hours, rate: line.rate, totalAmount: line.amount },
          });
        } catch (e) {
          console.error(`    ❌ Ingest failed for ${profile.name}: ${e.message}`);
          results.push({ contractor: profile.email, attachmentName: att.name, action: 'invoice_error', error: e.message, parsed });
        }
      }
      continue; // skip single-contractor path
    }

    // Hours are optional — amount-only invoices (no hourly breakdown) are valid.
    const canIngest = !!(parsed?.periodStart && parsed?.periodEnd);

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
          parseNotes:      `[${parsed.parseMethod || 'unknown'}] ` + (parsed.parseNotes || ''),
          pdfBase64:       att.buffer.toString('base64'),
          rawExtracted:    parsed,
          forwardedBy:     forwardedBy || null,
          groupKey:        null,
          attachmentHash:  attHash,
        }, CONFIG.invoiceIngestUrl);
        const action = res.body?.action || res.body?.error || String(res.status);
        console.log(`     ✅ Ingested → ${action}`);
        results.push({
          contractor:          contractorEmail,
          attachmentName:      att.name,
          action:              `invoice_${action}`,
          ingestOk:            res.body?.ok === true,
          invoiceNumber:       res.body?.invoiceNumber || null,
          reconciliationStatus: res.body?.reconciliationStatus || null,
          reconciliationDelta:  res.body?.reconciliationDelta ?? null,
          ingestNotes:         res.body?.notes || null,
          parsed,
        });
      } catch (e) {
        console.error(`     ❌ Ingest failed: ${e.message}`);
        results.push({ contractor: contractorEmail, attachmentName: att.name, action: 'invoice_error', error: e.message, parsed });
      }
    } else {
      const reason = !CONFIG.invoiceIngestEnabled ? 'dry-run mode' : !canIngest ? 'missing fields' : 'no INVOICE_INGEST_URL';
      console.log(`     ℹ️  Not ingested (${reason})`);
      const reportAction = !canIngest ? 'invoice_partial' : 'invoice_reported';
      results.push({ contractor: contractorEmail, attachmentName: att.name, action: reportAction, parsed });
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

async function processEmail(parsed, messageId, results, failedAtts, summary, runId = null) {
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
    isCsv:  !!(a.contentType?.includes('text/csv') || a.contentType?.includes('csv') ||
               (a.filename||'').match(/\.csv$/i)),
    isPdf:  !!(a.contentType?.includes('pdf') ||
               (a.filename||'').match(/\.pdf$/i) ||
               // Some clients send PDFs with generic octet-stream content type
               (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
    isDocx: !!(a.contentType?.includes('wordprocessingml') || a.contentType?.includes('msword') ||
               (a.filename||'').match(/\.docx?$/i)),
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
  const hasTimesheetContent = attachments.some(a => a.isXlsx || a.isCsv || a.isPdf || a.isDocx || a.isEml);

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
          const isCsv  = !!(ctype.includes('text/csv') || ctype.includes('csv') ||
                            fname.match(/\.csv$/i));
          const isPdf  = !!(ctype.includes('pdf') ||
                            fname.match(/\.pdf$/i) ||
                            (ctype.includes('octet-stream') && fname.match(/\.pdf$/i)));
          const isDocx = !!(ctype.includes('wordprocessingml') || ctype.includes('msword') ||
                            fname.match(/\.docx?$/i));
          return { name: fname || ctype.split('/')[1] || 'unnamed', buffer: a.content, size, isXlsx, isCsv, isPdf, isDocx, isEml: false };
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
          contractor, contractorName, inner.subject || subject, innerBody, innerAtts, messageId, runId, fromEmail
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
    // Internal forwarder forwarded a QuickBooks/Intuit notification — the extracted
    // "contractor" is Intuit's sending address, not a real contractor. Resolve by
    // attachment filename instead (same logic as direct Intuit emails).
    if (isIntuitNotification(contractor)) {
      const firstNameMatch = attachments
        .map(a => a.name?.match(/^([A-Za-z]{3,})_/))
        .find(m => m && m[1].toLowerCase() !== 'invoice');
      if (!firstNameMatch) {
        console.warn(`  ⚠️  Intuit notification (forwarded) — cannot extract first name from attachments: ${subject}`);
        results.push({ type: 'skipped', subject, reason: 'intuit_no_name_in_attachment' });
        return;
      }
      const firstName = firstNameMatch[1];
      const profile = await findProfileByFirstName(firstName);
      if (!profile) {
        console.warn(`  ⚠️  Intuit notification (forwarded) — no unique profile for '${firstName}': ${subject}`);
        results.push({ type: 'skipped', subject, reason: `intuit_unresolved_contractor: ${firstName}` });
        return;
      }
      contractor = profile.email;
      contractorName = profile.name;
      console.log(`  🔔 Intuit notification (forwarded by ${fromEmail}) resolved to: ${contractor}`);
    }
  } else if (isIntuitNotification(fromEmail)) {
    // QuickBooks/Intuit payment notification — attachments are real but the sender is Intuit's
    // infrastructure. Resolve the contractor from the first attachment filename (pattern: "{FirstName}_...").
    const firstNameMatch = attachments
      .map(a => a.name?.match(/^([A-Za-z]{3,})_/))
      .find(m => m && m[1].toLowerCase() !== 'invoice');
    if (!firstNameMatch) {
      console.warn(`  ⚠️  Intuit notification — cannot extract contractor first name from attachments: ${subject}`);
      results.push({ type: 'skipped', subject, reason: 'intuit_no_name_in_attachment' });
      return;
    }
    const firstName = firstNameMatch[1];
    const profile = await findProfileByFirstName(firstName);
    if (!profile) {
      console.warn(`  ⚠️  Intuit notification — no unique profile for first name '${firstName}': ${subject}`);
      results.push({ type: 'skipped', subject, reason: `intuit_unresolved_contractor: ${firstName}` });
      return;
    }
    contractor = profile.email;
    contractorName = profile.name;
    console.log(`  🔔 Intuit notification resolved to: ${contractor} (via first name '${firstName}')`);
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

  // Layer 1: sender allowlist — only enforce for DIRECT emails (not forwarded by internal staff).
  // When an accountant forwards an invoice, the extracted contractor email may belong to an
  // agency/umbrella (e.g. Teal Crossroads) not in profiles; the multi-contractor pipeline
  // resolves each line by name, and ingest-invoice's forwardedBy gate provides security.
  if (!isInternal(fromEmail) && !await isKnownContractor(contractor)) {
    console.warn(`  ⚠️  Unknown contractor: ${contractor} — skipping (not in profiles)`);
    results.push({ type: 'skipped', subject, reason: `unknown_contractor: ${contractor}` });
    await forwardToHelpdesk(subject, bodyText, fromEmail, `Unknown contractor email not in system: ${contractor}`);
    summary.unknownContractors = (summary.unknownContractors || 0) + 1;
    return;
  }

  console.log(`\n📧 ${subject}`);
  console.log(`   Contractor: ${contractor}${contractorName ? ` (${contractorName})` : ''}`);
  const forwardedBy = isInternal(fromEmail) ? fromEmail : null;
  const { results: r, failedAttachments: fa } = await ingestContractor(
    contractor, contractorName, subject, bodyText,
    attachments.filter(a => !a.isEml), messageId, runId, forwardedBy
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

async function writePollerHeartbeat(data) {
  if (!SUPABASE_REST_URL || !SUPABASE_ANON_KEY) return;
  try {
    await fetch(`${SUPABASE_REST_URL}/system_settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: 'poller_last_run', value: JSON.stringify(data) }),
    });
    console.log(`  💓 Heartbeat written (run_id=${data.run_id})`);
  } catch (e) {
    console.warn(`Heartbeat write failed: ${e.message}`);
  }
}

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

async function sendInvoiceAccountingEmail(invoiceReports) {
  const ingested   = invoiceReports.filter(r => r.ingestOk && r.action !== 'invoice_corrected' && r.action !== 'invoice_duplicate' && r.action !== 'invoice_reattached');
  const corrected  = invoiceReports.filter(r => r.action === 'invoice_corrected');
  const failed     = invoiceReports.filter(r => !r.ingestOk && r.action !== 'invoice_reported');
  const skipped    = invoiceReports.filter(r => r.action === 'invoice_duplicate' || r.action === 'invoice_reattached');

  // Plain-English reason for each failure action code
  function failReason(r) {
    if (r.error) return `Processing error: ${r.error}`;
    const a = r.action || '';
    if (a.includes('unknown_contractor'))          return 'Contractor not in system — add via admin panel first';
    if (a.includes('direct_invoice_not_accepted')) return 'Email not forwarded by accounting — direct submissions not accepted';
    if (a.includes('partial'))                     return `Missing required fields — could not parse billing period from PDF (${r.parsed?.parseNotes || 'no detail'})`;
    if (a.includes('failed'))                      return `Processing error — check import log`;
    return `Unexpected status: ${a}`;
  }

  function formatPeriod(start, end) {
    if (!start || !end) return '—';
    const fmt = d => { const [y,m,dy] = d.split('-'); return `${parseInt(dy)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]} ${y}`; };
    return `${fmt(start)} – ${fmt(end)}`;
  }

  function reconBadge(status, delta) {
    if (status === 'matched')      return '✓ Matched';
    if (status === 'mismatch')     return `⚠ Mismatch (${delta != null ? (delta > 0 ? '+' : '') + delta + 'h' : '?'})`;
    if (status === 'unverifiable') return '? No timesheets found for period';
    return '—';
  }

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
  const totalIngested = ingested.length + corrected.length;
  const statusLine = `${totalIngested} ingested${corrected.length > 0 ? ` (${corrected.length} corrected)` : ''}${failed.length > 0 ? `, ${failed.length} failed` : ''}${skipped.length > 0 ? `, ${skipped.length} skipped` : ''}`;
  const subject = `[Invoice Report] ${statusLine} — ${now}`;

  let body = `Invoice Report — ${now} ET\n${'='.repeat(52)}\n`;

  function formatInvoiceBlock(inv, label) {
    const p = inv.parsed || {};
    const sym = p.currency === 'USD' ? '$' : (p.currency || '');
    let s = `\n${inv.email}${label ? '  ✎ ' + label : ''}\n`;
    s += `  Invoice  : ${inv.invoiceNumber || '—'}\n`;
    s += `  File     : ${inv.filename}\n`;
    s += `  Period   : ${formatPeriod(p.periodStart, p.periodEnd)}\n`;
    s += `  Hours    : ${p.totalHours != null ? p.totalHours + 'h' : '—'}`;
    if (p.rate)        s += `  |  Rate: ${sym}${p.rate}`;
    if (p.totalAmount) s += `  |  Total: ${sym}${p.totalAmount} ${p.currency || 'USD'}`;
    s += '\n';
    return s;
  }

  if (ingested.length > 0 || corrected.length > 0) {
    body += `\nINGESTED (${totalIngested})\n${'─'.repeat(40)}\n`;
    for (const inv of ingested)   body += formatInvoiceBlock(inv, null);
    for (const inv of corrected)  body += formatInvoiceBlock(inv, 'CORRECTED — awaiting re-approval');
  }

  if (skipped.length > 0) {
    body += `\nSKIPPED — ALREADY ON FILE (${skipped.length})\n${'─'.repeat(40)}\n`;
    for (const inv of skipped) {
      body += `\n  ${inv.email}  |  ${inv.filename}  (${inv.action.replace('invoice_', '')})\n`;
    }
  }

  if (failed.length > 0) {
    body += `\nFAILED — ACTION NEEDED (${failed.length})\n${'─'.repeat(40)}\n`;
    for (const inv of failed) {
      body += `\n  ${inv.email}  |  ${inv.filename}\n`;
      body += `  Reason   : ${failReason(inv)}\n`;
    }
  }

  body += `\n${'='.repeat(52)}\nThis is an automated message from ${CONFIG.fromEmail}`;

  await sendEmail(CONFIG.accountingEmail, subject, body);
  console.log(`  📧 Invoice report sent to ${CONFIG.accountingEmail}`);
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
    const methodCounts = {};
    for (const inv of summary.invoiceReports) {
      const m = inv.parseMethod || 'unknown';
      methodCounts[m] = (methodCounts[m] || 0) + 1;
    }
    const claudeCalls = (methodCounts['regex+claude_payment'] || 0) + (methodCounts['claude_full'] || 0) + (methodCounts['claude_vision'] || 0);
    const regexOnly   = (methodCounts['regex'] || 0) + (methodCounts['regex_no_payment'] || 0) + (methodCounts['regex_partial'] || 0);

    body += `
INVOICE PARSE REPORTS (${summary.invoiceReports.length})${CONFIG.invoiceIngestEnabled ? '' : ' — DRY RUN, nothing written to DB'}
${'─'.repeat(50)}
Parse method breakdown:
  Regex-only          : ${regexOnly}  (0 Claude calls)
  Regex + Claude pay  : ${methodCounts['regex+claude_payment'] || 0}  (payment details only, ~256 tokens each)
  Claude full         : ${(methodCounts['claude_full'] || 0) + (methodCounts['claude_vision'] || 0)}  ${methodCounts['claude_vision'] ? `(${methodCounts['claude_vision']} vision)` : ''}
  Claude calls total  : ${claudeCalls}
`;
    for (const inv of summary.invoiceReports) {
      const p = inv.parsed;
      const pd = p?.paymentDetails || {};
      const canIngest = p?.periodStart && p?.periodEnd;
      const tag = (val, assumed) => val != null && val !== '' ? `${val}` : (assumed ? `(assumed: ${assumed})` : '—');

      body += `
  ${inv.email}  |  ${inv.filename}  [${inv.parseMethod || '—'}]
  Invoice #  : ${tag(p?.invoiceNumber, 'auto-generated')}
  Period     : ${tag(p?.periodStart)} → ${tag(p?.periodEnd)}
  Hours      : ${tag(p?.totalHours)}   Rate: ${tag(p?.rate, '0')}   Amount: ${tag(p?.totalAmount, 'hours × rate')}   Currency: ${tag(p?.currency, 'USD')}
  Company    : ${tag(pd.companyName)}
  Bank       : ${tag(pd.bankName)}   Account: ${tag(pd.accountNumber)}   IBAN: ${tag(pd.iban)}
  SWIFT      : ${tag(pd.swift)}   Sort Code: ${tag(pd.sortCode)}   Routing: ${tag(pd.routingNumber)}
  ${p?.parseNotes ? `Notes: ${p.parseNotes}` : ''}
  ${canIngest ? '>> OK to ingest' : '>> MISSING required fields (billing period not found)'}
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

  const RUN_ID = randomUUID();

  const rawMessages = await fetchEmails();
  if (!rawMessages || rawMessages.length === 0) {
    console.log('No unseen emails. Done.');
    await writePollerHeartbeat({ ran_at: new Date().toISOString(), run_id: RUN_ID, created: 0, duplicates: 0, corrections: 0, failures: 0, forwarded: 0, invoices: 0 });
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
      isCsv:  !!(a.contentType?.includes('text/csv') || a.contentType?.includes('csv') ||
                 (a.filename||'').match(/\.csv$/i)),
      isPdf:  !!(a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i) ||
                 (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
      isDocx: !!(a.contentType?.includes('wordprocessingml') || a.contentType?.includes('msword') ||
                 (a.filename||'').match(/\.docx?$/i)),
      isEml:  !!(a.contentType?.includes('message/rfc822') || (a.filename||'').match(/\.eml$/i)),
    })).filter(a => {
      if (a.size > MAX_ATTACHMENT_BYTES) {
        console.warn(`  ⚠️  Attachment too large (${(a.size / 1024 / 1024).toFixed(1)}MB), skipping: ${a.name}`);
        return false;
      }
      return true;
    });

    const hasTimesheetContent = attachments.some(a => a.isXlsx || a.isCsv || a.isPdf || a.isDocx || a.isEml);

    // No timesheet content: forward to helpdesk, mark seen
    if (!hasTimesheetContent) {
      // Log unsupported file types so they're visible in the import log
      if (!isInternal(fromEmail) && attachments.length > 0) {
        const unsupported = attachments.filter(a =>
          a.name && a.name !== 'unnamed' &&
          /\.\w+$/.test(a.name) &&
          !a.name.match(/\.(jpg|jpeg|png|gif|bmp|tiff|heic|webp|txt|html|htm|ics|vcf)$/i)
        );
        for (const att of unsupported) {
          const ext = (att.name.split('.').pop() || 'unknown').toLowerCase();
          await postToIngest({
            logOnly:         true,
            messageId:       `${messageId}::${att.name}`,
            contractorEmail: fromEmail,
            attachmentName:  att.name,
            subject,
            parseNotes:      `Unsupported file type: .${ext} — please resubmit as XLSX, PDF, or DOCX`,
            run_id:          RUN_ID,
          });
          console.log(`  ⚠️  Unsupported attachment logged: ${att.name} from ${fromEmail}`);
        }
      }
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
    await processEmail(parsed, messageId, emailResults, emailFailedAtts, summary, RUN_ID);

    // Accumulate summary counts
    emailResults.forEach(r => {
      if (r.action === 'created') summary.created++;
      else if (r.action === 'duplicate') summary.duplicates++;
      else if (r.action === 'correction_imported') summary.corrections++;
      else if (r.action === 'invoice_skipped') { /* no anthropic key — ignore */ }
      else if (r.action?.startsWith('invoice_')) {
        summary.invoiceReports.push({
          email:               r.contractor,
          filename:            r.attachmentName,
          parsed:              r.parsed,
          action:              r.action,
          parseMethod:         r.parsed?.parseMethod || 'unknown',
          ingestOk:            r.ingestOk,
          invoiceNumber:       r.invoiceNumber || null,
          reconciliationStatus: r.reconciliationStatus || null,
          reconciliationDelta:  r.reconciliationDelta ?? null,
          ingestNotes:         r.ingestNotes || null,
          error:               r.error || null,
        });
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
  if (summary.invoiceReports.length > 0) {
    const mc = {};
    for (const inv of summary.invoiceReports) { const m = inv.parseMethod || 'unknown'; mc[m] = (mc[m] || 0) + 1; }
    for (const [m, n] of Object.entries(mc)) console.log(`    ${m.padEnd(24)}: ${n}`);
  }
  console.log(`  Failures         : ${summary.failures.length}`);

  await writePollerHeartbeat({
    ran_at:      new Date().toISOString(),
    run_id:      RUN_ID,
    created:     summary.created,
    duplicates:  summary.duplicates,
    corrections: summary.corrections,
    failures:    summary.failures.length,
    forwarded:   summary.forwarded,
    invoices:    summary.invoiceReports.length,
  });

  // Summary email — only if something actionable happened
  const actionable = summary.created + summary.duplicates + summary.corrections +
                     summary.forwarded + summary.failures.length + summary.newUsers.length +
                     summary.invoiceReports.length;
  if (actionable > 0) {
    await sendSummaryEmail(summary, 0);
    if (summary.created + summary.corrections > 0) {
      await triggerTimesheetReport();
    }
    const invoicesIngested = summary.invoiceReports.filter(r => r.ingestOk);
    if (invoicesIngested.length > 0) {
      await sendInvoiceAccountingEmail(summary.invoiceReports);
    }
  }

  const reportableFailures = summary.failures.filter(f => f.attemptCount <= RETRY_SILENT_AFTER);
  if (reportableFailures.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
