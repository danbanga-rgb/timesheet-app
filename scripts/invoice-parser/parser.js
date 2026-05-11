'use strict';

// ─── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_MAP = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7,
  sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function parseDate(str) {
  if (!str) return null;
  str = str.trim().replace(/\s+/g, ' ');

  // YYYY-MM-DD
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // MM/DD/YYYY or MM-DD-YYYY or MM.DD.YYYY
  m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(year, +m[1] - 1, +m[2]);
  }

  // Month DD, YYYY  or  Month DD YYYY
  m = str.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (m) {
    const mo = MONTH_MAP[m[1].toLowerCase()];
    if (mo !== undefined) return new Date(+m[3], mo, +m[2]);
  }

  // DD Month YYYY
  m = str.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_MAP[m[2].toLowerCase()];
    if (mo !== undefined) return new Date(+m[3], mo, +m[1]);
  }

  return null;
}

function fmtDate(d) {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanNum(str) {
  if (str == null) return null;
  const n = parseFloat(String(str).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// ─── Field extractors ─────────────────────────────────────────────────────────

function extractInvoiceNumber(text) {
  const patterns = [
    /invoice\s*(?:number|num|no\.?|#)[:\s#]*([A-Z0-9][\w\-\/]{1,25})/i,
    /inv[.\-#\s]+([A-Z0-9][\w\-]{2,25})/i,
    /(?:^|\n)\s*#\s*([A-Z0-9][\w\-]{2,25})/m,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function extractPeriod(text) {
  // Date token patterns — ordered most specific → least
  const D = String.raw`(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Za-z]+ \d{4})`;
  const SEP = String.raw`\s*(?:to|through|[-–—])\s*`;

  const rangePatterns = [
    // "for the period MM/DD – MM/DD", "billing period: ...", "services rendered from ... to ..."
    new RegExp(`(?:billing\\s+period|for\\s+(?:the\\s+)?period|services?\\s+rendered(?:\\s+for)?|period(?:\\s+of)?|from)[:\\s]+${D}${SEP}${D}`, 'i'),
    // Generic date range anywhere in text
    new RegExp(`${D}${SEP}${D}`, 'i'),
  ];

  for (const p of rangePatterns) {
    const m = text.match(p);
    if (m) {
      const start = parseDate(m[1]);
      const end   = parseDate(m[2]);
      if (start && end && start <= end) {
        return { periodStart: fmtDate(start), periodEnd: fmtDate(end) };
      }
    }
  }
  return { periodStart: null, periodEnd: null };
}

function extractHours(text) {
  const patterns = [
    // "80 hours @ $50" or "80 hours x $50"
    /(\d+\.?\d*)\s*hours?\s*[@x×*]\s*\$?[\d,]+/i,
    // "Total Hours: 80"
    /total\s+hours?[:\s]+(\d+\.?\d*)/i,
    // "Hours Worked: 80"
    /hours?\s+(?:worked|billed|rendered)[:\s]+(\d+\.?\d*)/i,
    // "Quantity: 80" in an hours context (check nearby text for "hour")
    /quantity[:\s]+(\d+\.?\d*)(?=[\s\S]{0,80}hour)/i,
    // Last resort: bare "X hours" not in a day-column context
    /\b(\d+\.?\d*)\s*hours?\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = cleanNum(m[1]);
      // Sanity check: 1–999 hours is plausible for an invoice
      if (n !== null && n >= 1 && n < 1000) return n;
    }
  }
  return null;
}

function extractRate(text) {
  const patterns = [
    /(?:hourly\s+)?rate[:\s]+\$?([\d,]+\.?\d*)/i,
    /\$\s*([\d,]+\.?\d*)\s*(?:per\s+hour|\/\s*hr\.?|\/\s*hour)/i,
    /([\d,]+\.?\d*)\s*(?:per\s+hour|\/\s*hr\.?|\/\s*hour)/i,
    /unit\s+price[:\s]+\$?([\d,]+\.?\d*)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = cleanNum(m[1]);
      // Sanity check: $1–$999/hr is plausible
      if (n !== null && n >= 1 && n < 1000) return n;
    }
  }
  return null;
}

function extractTotal(text) {
  // Try most-specific patterns first to avoid grabbing a subtotal
  const patterns = [
    /total\s+amount\s+due[:\s]+\$?([\d,]+\.?\d*)/i,
    /amount\s+due[:\s]+\$?([\d,]+\.?\d*)/i,
    /balance\s+due[:\s]+\$?([\d,]+\.?\d*)/i,
    /total\s+due[:\s]+\$?([\d,]+\.?\d*)/i,
    /grand\s+total[:\s]+\$?([\d,]+\.?\d*)/i,
    /(?:^|\n)\s*total[:\s]+\$?([\d,]+\.?\d*)/im,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = cleanNum(m[1]);
      if (n !== null && n > 0) return n;
    }
  }
  return null;
}

function extractCurrency(text) {
  if (/\bUSD\b/.test(text)) return 'USD';
  if (/\bGBP\b/.test(text)) return 'GBP';
  if (/\bEUR\b/.test(text)) return 'EUR';
  if (/\bCAD\b/.test(text)) return 'CAD';
  if (/£/.test(text)) return 'GBP';
  if (/€/.test(text)) return 'EUR';
  if (/\$/.test(text)) return 'USD';
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

function parseInvoice(text, filename) {
  const found   = [];
  const missing = [];

  function track(name, value) {
    if (value != null) found.push(name); else missing.push(name);
    return value;
  }

  const invoiceNumber = track('invoiceNumber', extractInvoiceNumber(text));
  const { periodStart, periodEnd } = extractPeriod(text);
  track('periodStart', periodStart);
  track('periodEnd',   periodEnd);
  const totalHours  = track('totalHours',  extractHours(text));
  const rate        = track('rate',        extractRate(text));
  const totalAmount = track('totalAmount', extractTotal(text));
  const currency    = track('currency',    extractCurrency(text));

  const parseNotes = [
    found.length   ? `Found: ${found.join(', ')}`   : null,
    missing.length ? `Missing: ${missing.join(', ')}` : null,
  ].filter(Boolean).join(' | ');

  return { invoiceNumber, periodStart, periodEnd, totalHours, rate, totalAmount, currency, parseNotes };
}

module.exports = { parseInvoice };
