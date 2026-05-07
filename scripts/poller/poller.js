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
  brevoApiKey:   process.env.BREVO_API_KEY,
  fromEmail:     process.env.FROM_EMAIL || 'timesheets@mysynergie.net',
  fromName:      process.env.FROM_NAME || 'Synergie Timesheet System',
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
  const hoursLinesCandidates = [];
  let inHoursSection = false;

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
    if (!weekEndingStr && lower.includes('week ending date')) {
      const m = line.match(/(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\.?)\s*$/);
      if (m) weekEndingStr = m[1];
      else if (lines[i + 1]) {
        const m2 = lines[i + 1].match(/^(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\.?)$/);
        if (m2) weekEndingStr = m2[1];
      }
    }

    // Total Client Billable Hours — strip artifacts like 4800%
    if (lower.includes('total client billable hours')) {
      const cleaned = line.replace(/[^0-9.]/g, '');
      const t = parseFloat(cleaned);
      if (!isNaN(t) && t <= 168) total = t;
      inHoursSection = false;
    }

    // Hours section: between "Mgr Name Signature" and "Total Client Billable"
    if ((lower.includes('mgr name') || lower.includes('client manager name')) &&
        lower.includes('signature')) {
      inHoursSection = true;
      continue;
    }
    if (inHoursSection) {
      if (lower.includes('total client billable') || lower.includes('certify') ||
          lower.startsWith('signature:')) {
        inHoursSection = false;
        continue;
      }
      hoursLinesCandidates.push(line);
    }
  }

  // Fallback: if total > 168 (4800% artifact), find standalone number in hoursLines
  if (!total || total > 168) {
    for (const hl of hoursLinesCandidates) {
      if (/^\d+$/.test(hl)) {
        const t = parseFloat(hl);
        if (t > 0 && t <= 168) { total = t; break; }
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

  // Normalise week ending date → Monday week start
  let weekStart = null;
  if (weekEndingStr) {
    // European dot: 26.4.2026. → 4/26/2026
    weekEndingStr = weekEndingStr.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/, (_, d, m, y) => `${m}/${d}/${y}`);
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

  // Fallback week from filename if not found in text
  if (!weekStart) weekStart = weekFromFilename(filename);

  return { name, weekStart, hours, total };
}

async function parsePdf(buffer, filename) {
  try {
    const pdfParse = require('pdf-parse');
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const data = await pdfParse(buf);
    const text = data.text || '';
    if (!text || text.length < 10) return [];

    const { name, weekStart, hours, total } = parseSynergiePdfText(text, filename);

    if (!hours || !weekStart) return [];

    const entries = {};
    const base = new Date(weekStart + 'T12:00:00Z');
    DAY_ORDER.forEach((d, i) => {
      const dt = new Date(base);
      dt.setUTCDate(base.getUTCDate() + i);
      entries[dt.toISOString().split('T')[0]] = hours[d] !== undefined ? hours[d] : 0;
    });

    return [{ weekStart, entries, total: total || Object.values(entries).reduce((s, h) => s + h, 0), nameFromSheet: name, notes: `PDF: ${filename}` }];
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
  // Mark invoice attachments
  invoiceAtts.forEach(a => results.push({ contractor: contractorEmail, attachmentName: a.name, action: 'invoice_skipped' }));

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
    // Detect by contentType OR filename — covers inline attachments too
    isXlsx: !!(a.contentType?.includes('spreadsheet') || a.contentType?.includes('excel') ||
               (a.filename||'').match(/\.(xlsx|xls)$/i)),
    isPdf:  !!(a.contentType?.includes('pdf') ||
               (a.filename||'').match(/\.pdf$/i) ||
               // Some clients send PDFs with generic octet-stream content type
               (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
    isEml:  !!(a.contentType?.includes('message/rfc822') || a.contentType?.includes('message/rfc') ||
               (a.filename||'').match(/\.eml$/i)),
  }));

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
          // Also check related/alternative content parts that may contain PDFs
          const isXlsx = !!(ctype.includes('spreadsheet') || ctype.includes('excel') ||
                            fname.match(/\.(xlsx|xls)$/i));
          const isPdf  = !!(ctype.includes('pdf') ||
                            fname.match(/\.pdf$/i) ||
                            (ctype.includes('octet-stream') && fname.match(/\.pdf$/i)));
          return { name: fname || ctype.split('/')[1] || 'unnamed', buffer: a.content, isXlsx, isPdf, isEml: false };
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

          console.log(`Found ${uids.length} unseen email(s)`);
          const messages = [];
          // markSeen: true — mark all as seen on fetch (reliable)
          // DMARC emails will be deleted in a separate pass after processing
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
⚠️  Parse failures : ${summary.failures.length} (${leftUnseen} left unseen for retry)
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
  const successUids   = [];
  const failedUids    = [];

  const summary = {
    total: rawMessages.length, dmarc: 0, forwarded: 0,
    created: 0, duplicates: 0, corrections: 0,
    newUsers: [], failures: [],
  };

  for (const raw of rawMessages) {
    const uid = raw.uid;
    let parsed;
    try {
      parsed = await simpleParser(raw.buffer);
    } catch (e) {
      console.error(`Parse error uid=${uid}: ${e.message}`);
      failedUids.push(uid);
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
      isXlsx: !!(a.contentType?.includes('spreadsheet') || a.contentType?.includes('excel') ||
                 (a.filename||'').match(/\.(xlsx|xls)$/i)),
      isPdf:  !!(a.contentType?.includes('pdf') || (a.filename||'').match(/\.pdf$/i) ||
                 (a.contentType?.includes('octet-stream') && (a.filename||'').match(/\.pdf$/i))),
      isEml:  !!(a.contentType?.includes('message/rfc822') || (a.filename||'').match(/\.eml$/i)),
    }));

    const hasTimesheetContent = attachments.some(a => a.isXlsx || a.isPdf || a.isEml);

    // No timesheet content: forward to helpdesk, mark seen
    if (!hasTimesheetContent) {
      const reason = isInternal(fromEmail)
        ? 'Internal sender with no timesheet attachments'
        : 'No timesheet attachments — possible human reply or notification';
      await forwardToHelpdesk(subject, bodyText, fromEmail, reason);
      successUids.push(uid);
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
      else if (r.action === 'invoice_skipped') { /* ignore */ }
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

    // Only mark email as SEEN if every attachment was processed successfully
    // Any parse failure → leave unseen so it gets retried
    const hasParseFailure = emailFailedAtts.length > 0;
    const hasIngestError = emailResults.some(r => r.error && r.action !== 'invoice_skipped');
    if (hasParseFailure || hasIngestError) {
      failedUids.push(uid);
    } else {
      successUids.push(uid);
    }
  }

  // IMAP operations
  if (dmarcUids.length > 0) {
    try { await deleteDmarcEmails(dmarcUids); console.log(`  🗑️  Deleted ${dmarcUids.length} DMARC emails`); }
    catch (e) { console.warn(`DMARC delete failed: ${e.message}`); }
  }
  if (successUids.length > 0) {
    try { await markEmailsSeen(successUids); }
    catch (e) { console.warn(`markSeen failed: ${e.message}`); }
  }
  if (failedUids.length > 0) {
    console.log(`  ⚠️  ${failedUids.length} email(s) left unseen for retry`);
  }

  // Console summary
  console.log('\n─── Summary ──────────────────────────────────────────────');
  console.log(`  Emails found     : ${summary.total}`);
  console.log(`  DMARC deleted    : ${summary.dmarc}`);
  console.log(`  Forwarded        : ${summary.forwarded}`);
  console.log(`  Created          : ${summary.created}`);
  console.log(`  Duplicates       : ${summary.duplicates}`);
  console.log(`  Corrections      : ${summary.corrections}`);
  console.log(`  Failures (retry) : ${summary.failures.length}`);
  console.log(`  Left unseen      : ${failedUids.length}`);

  // Summary email — only if something actionable happened
  const actionable = summary.created + summary.duplicates + summary.corrections +
                     summary.forwarded + summary.failures.length + summary.newUsers.length;
  if (actionable > 0) {
    await sendSummaryEmail(summary, failedUids.length);
  }

  const reportableFailures = summary.failures.filter(f => f.attemptCount <= RETRY_SILENT_AFTER);
  if (reportableFailures.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
