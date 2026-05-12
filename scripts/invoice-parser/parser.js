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

// ─── Number cleaning ──────────────────────────────────────────────────────────
// Handles: US thousands (13,200.00), European decimal (4.320,00 or 4320,00),
// space-thousands (4 800,00), currency symbols, % OCR artifacts.

function cleanNum(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/[%$€£¥]/g, '').trim();
  // Collapse space-based thousands separators (e.g. "4 800,00" → "4800,00")
  s = s.replace(/(\d)\s(\d)/g, '$1$2');
  // European format detection:
  //   - Comma + 1-2 digits at end → clearly European decimal ("4320,00", "4,50")
  //   - Period thousands + comma decimal → European ("4.320,00")
  //   - Comma + exactly 3 digits without period prefix → US thousands ("5,040" → 5040)
  const hasEuro12 = /^[\d.]+,\d{1,2}$/.test(s);
  const hasPeriodThousands = /\d\.\d/.test(s) && /,\d{1,3}$/.test(s);
  if (hasEuro12 || hasPeriodThousands) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Hours-specific cleaner: tries both standard and European interpretation,
// returns whichever lands in a plausible hours range (1–999).
function cleanHours(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/[%$€£¥\s]/g, '');
  const standard = parseFloat(s.replace(/,/g, ''));
  if (!isNaN(standard) && standard >= 1 && standard < 1000) return standard;
  // Try European (comma as decimal)
  const euro = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (!isNaN(euro) && euro >= 1 && euro < 1000) return euro;
  return null;
}

// ─── Field extractors ─────────────────────────────────────────────────────────

function extractInvoiceNumber(text) {
  // Reject values that are clearly not invoice numbers (common column headers or words without digits)
  const SKIP = /^(?:date|number|amount|due|total|description|details?|page|copy)\b/i;
  const hasDigit = (s) => /\d/.test(s);
  const patterns = [
    // "Invoice Number:", "Invoice No.", "Invoice #" — (?!\w) prevents "NUM" matching in "NUMBER"
    /invoice\s*(?:number|num|no\.?)(?!\w)[:\s#]*(?!(?:date|of\s+issue|number|due)\b)([A-Z0-9][\w\-\/]{1,25})/i,
    /invoice\s*#[:\s#]*(?!(?:date|of\s+issue|number|due)\b)([A-Z0-9][\w\-\/]{1,25})/i,
    // "Invoice NO. 5 / 1 / 1" — space-separated invoice number components
    /invoice\s*(?:number|num|no\.?)(?!\w)\s*(\d+(?:\s*[\/\-\.]\s*\d+)+)/i,
    // "Invoice number Num.29" — double prefix before the actual number
    /invoice\s*(?:number|num)\s*num\.?\s*(\d[\w\-\/\.]{0,20})/i,
    // Bare "Invoice: CI-STS-22" — negative lookahead to skip date/number/no labels
    /invoice[:\s]+(?!(?:date|number|num|no|#)\b)([A-Z0-9][\w\-\/]{2,25})/i,
    /inv[.\-#\s]+([A-Z0-9][\w\-]{1,25})/i,
    // "BROJ RACUNA/RAČUNA" (Croatian "invoice number", noun first order)
    /(?:broj|br\.?)\s*ra[cčg]una?[:\s]+([A-Z0-9][\w\-\/]{1,25})/i,
    // "Racun BR." / "RACUN BR." (Bosnian/Serbian/Croatian, verb first order)
    /ra[cčg]un\s*(?:br\.?|broj)[:\s]+([A-Z0-9][\w\-\/]{1,25})/i,
    // "PR NO.: 177551992948" — payment request number (used as invoice ID)
    /\bPR\s*NO\.?\s*:\s*(\d[\d\-]{1,25})/i,
    // "Reference No: 177811194162" — reference number in payment request docs
    /\breference\s+no\.?\s*:\s*(\d[\d\-\/\.]{1,25})/i,
    // "Poziv na broj: 2026-24-1-1" (Croatian payment reference, last resort)
    /poziv\s+na\s+broj[:\s]+([A-Z0-9][\w\-\/]{1,25})/i,
    // Bare "#07" or "#INV-001" at start of line
    /(?:^|\n)\s*#\s*([A-Z0-9][\w\-]{1,25})/m,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && !SKIP.test(m[1]) && hasDigit(m[1])) {
      return m[1].trim().replace(/\s*([\/\-\.])\s*/g, '$1');
    }
  }
  return null;
}

function extractPeriod(text) {
  const D   = String.raw`(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Za-z]+ \d{4})`;
  const SEP = String.raw`\s*(?:to|through|[-–—])\s*`;

  const rangePatterns = [
    // "billing period:", "for the period:", "services rendered from ... to ..." with full dates
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

  // "from MM/DD to MM/DD - YYYY" or "from MM/DD to MM/DD, YYYY" (year at end)
  const yearEnd = text.match(
    /from\s+(\d{1,2}[\/\-]\d{1,2})\s+to\s+(\d{1,2}[\/\-]\d{1,2})[\s,\-]+(\d{4})/i
  );
  if (yearEnd) {
    const start = parseDate(`${yearEnd[1]}/${yearEnd[3]}`);
    const end   = parseDate(`${yearEnd[2]}/${yearEnd[3]}`);
    if (start && end && start <= end) {
      return { periodStart: fmtDate(start), periodEnd: fmtDate(end) };
    }
  }

  // "From 04/01-04/30 2026" — dash separator between MM/DD dates, year at end
  const yearEndDash = text.match(
    /from\s+(\d{1,2}\/\d{1,2})[-–](\d{1,2}\/\d{1,2})\s+(\d{4})/i
  );
  if (yearEndDash) {
    const start = parseDate(`${yearEndDash[1]}/${yearEndDash[3]}`);
    const end   = parseDate(`${yearEndDash[2]}/${yearEndDash[3]}`);
    if (start && end && start <= end) {
      return { periodStart: fmtDate(start), periodEnd: fmtDate(end) };
    }
  }

  // "April 01-30" or "April 1-30" inline in description
  const monthRange = text.match(/\b([A-Za-z]+)\s+(\d{1,2})[-–]\s*(\d{1,2})(?:[,\s]+(\d{4}))?/);
  if (monthRange) {
    const mo = MONTH_MAP[monthRange[1].toLowerCase()];
    if (mo !== undefined) {
      // Guess year: look for a 4-digit year near this match, else use current year
      const yearMatch = text.match(/\b(20\d{2})\b/);
      const year = monthRange[4] ? +monthRange[4] : (yearMatch ? +yearMatch[1] : new Date().getFullYear());
      const start = new Date(year, mo, +monthRange[2]);
      const end   = new Date(year, mo, +monthRange[3]);
      if (start <= end) return { periodStart: fmtDate(start), periodEnd: fmtDate(end) };
    }
  }

  // "April 2026" as last resort — infer full month period (avoids invoice date false positives)
  // Only match in service description context, not immediately after a date-label
  const monthYear = text.match(/(?:for|service[s]?|engineering|development|consulting|programming|services?|period)[^\n]{0,40}?(?:\b|\s)([A-Za-z]+)\s+(20\d{2})\b/i);
  if (monthYear) {
    const mo = MONTH_MAP[monthYear[1].toLowerCase()];
    if (mo !== undefined) {
      const year = +monthYear[2];
      const start = new Date(year, mo, 1);
      const end   = new Date(year, mo + 1, 0);
      if (start <= end) return { periodStart: fmtDate(start), periodEnd: fmtDate(end) };
    }
  }

  return { periodStart: null, periodEnd: null };
}

function extractHours(text) {
  const patterns = [
    // Explicit multiplication: "80 hours @ $50" or "80h = 4000"
    [/(\d+[\.,]?\d*)\s*hours?\s*[@x×*]\s*\$?[\d,]+/i,  s => cleanHours(s)],
    [/(\d+[\.,]?\d*)\s*h\s*[=x×]\s*[\d,]+/i,            s => cleanHours(s)],
    // Labelled totals
    [/total\s+hours?[:\s]+(\d+[\.,]?\d*)/i,              s => cleanHours(s)],
    [/hours?\s+(?:worked|billed|rendered|approved)[:\s]+(\d+[\.,]?\d*)/i, s => cleanHours(s)],
    [/approved\s+hrs?[:\s]+(\d+[\.,]?\d*)/i,             s => cleanHours(s)],
    // "164.00 work hours"
    [/(\d+[\.,]?\d*)\s*work\s*hours?\b/i,                s => cleanHours(s)],
    // "144 sata" (Croatian for hours)
    [/(\d+[\.,]?\d*)\s*sata\b/i,                         s => cleanHours(s)],
    // "160 hrs" abbreviation
    [/(\d+[\.,]?\d*)\s*hrs?\b/i,                         s => cleanHours(s)],
    // "176 HOURS30.00" — concatenated columns, no word boundary after HOURS
    [/(\d+[\.,]?\d*)\s*HOURS/i,                          s => cleanHours(s)],
    // "160 h" or "160h" as standalone unit
    [/\b(\d+[\.,]?\d*)[ \t]*h\b/,                        s => cleanHours(s)],
    // "Quantity: 80" near "hour" context
    [/quantity[:\s]+(\d+[\.,]?\d*)(?=[\s\S]{0,80}hour)/i, s => cleanHours(s)],
    // Last resort: bare "X hours"
    [/\b(\d+[\.,]?\d*)\s*hours?\b/i,                    s => cleanHours(s)],
  ];
  for (const [p, clean] of patterns) {
    const m = text.match(p);
    if (m) {
      const n = clean(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

function extractRate(text) {
  const patterns = [
    // "30 USD/h" or "30 EUR/hr" or "30 USD per hour"
    /(\d+[\.,]?\d*)\s*(?:USD|EUR|GBP|CAD)[/\s]*(?:per\s+)?h(?:our|r)?\b/i,
    // "per hour" / "/hr" with $ amount before
    /\$\s*(\d+[\.,]?\d*)\s*(?:per\s+hour|\/\s*hr\.?|\/\s*hour)/i,
    /(\d+[\.,]?\d*)\s*(?:per\s+hour|\/\s*hr\.?|\/\s*hour)/i,
    // "hourly rate: 30" or "rate: 30"
    /(?:hourly\s+)?rate[:\s]+\$?(\d+[\.,]?\d*)/i,
    // "unit price: 30"
    /unit\s+(?:price|cost)[:\s]+\$?(\d+[\.,]?\d*)/i,
    // "price per h" label followed by value on same/next line
    /price\s+per\s+h\w*[:\s]+(\d+[\.,]?\d*)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const n = cleanNum(m[1]);
      if (n !== null && n >= 1 && n < 10000) return n;
    }
  }
  return null;
}

function extractTotal(text) {
  const patterns = [
    /total\s+amount\s+due[:\s]+\$?([\d\s,\.]+)/i,
    /amount\s+due[:\s]+\$?([\d\s,\.]+)/i,
    /balance\s+due[:\s\n]+\$?([\d\s,\.]+)/i,
    /total\s+due[:\s]+\$?([\d\s,\.]+)/i,
    /grand\s+total[:\s]+\$?([\d\s,\.]+)/i,
    // "Total - $4800.00"
    /total\s*[-–—]\s*\$?([\d\s,\.]+)/i,
    // "Total amount (USD) 5280.00" — optional currency in parens
    /total\s+amount\s*(?:\([^)]*\))?\s*[:\s]+\$?([\d\s,\.]+)/i,
    // "Invoice Amount: 5280.00"
    /invoice\s+amount[:\s\n]+\$?([\d\s,\.]+)/i,
    // "INVOICE TOTAL\nUS$ 5,040" — total on next line with $ prefix
    /invoice\s+total\s+(?:US)?\$\s*([\d,\.]+)/i,
    // "Total (USD) 4.320,00" — currency in parens, amount follows (possibly with trailing $)
    /total\s*\(USD\)\s*([\d\s,\.]+)/i,
    // "Ukupno / Total: 4320,00" (Croatian/Bosnian)
    /ukupno\s*\/\s*total[:\s]+\$?([\d\s,\.]+)/i,
    // "Total Price | 37,171.14 BAM $22,240.00" — prefer $-prefixed USD amount over pipe amount
    /(?:total|ukupno)[^\n$]{0,80}\$\s*([\d,\.]+)/i,
    // "Total USD 5,070.00" — bare currency code between label and amount
    /\btotal\s+[A-Z]{3}\s+([\d\s,\.]+)/i,
    // "UKUPNO CIJENA/TOTAL PRICE [] | 5280,00" — table-pipe format (after $ check)
    /total[^|\n]{0,50}\|\s*([\d,\.]+)/i,
    // Generic last-resort: "Total: 5280.00" anywhere in text
    /\btotal[:\s]+\$?([\d\s,\.]+)/i,
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

// ─── Payment detail extractors ────────────────────────────────────────────────

function extractIban(text) {
  // Labeled: "IBAN:", "IBAN/IFSC:", "IBAN/BIC:" — allow horizontal whitespace only (no newline crossing)
  const labeled = text.match(/IBAN(?:\/[A-Z]+)?[:\s#]+([A-Z]{2}[ \t]*\d{2}(?:[ \t]*[A-Z0-9]){11,30})/i);
  if (labeled) {
    const candidate = labeled[1].replace(/[ \t]/g, '').toUpperCase();
    if (candidate.length >= 15 && candidate.length <= 34) return candidate;
  }
  // Bare IBAN: compact (no spaces)
  const bare = text.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/);
  if (bare) {
    const candidate = bare[1];
    if (candidate.length >= 15 && candidate.length <= 34) return candidate;
  }
  // Bare IBAN: space-grouped like "LT60 3250 0022 8875 3177"
  const spaceGrouped = text.match(/\b([A-Z]{2}\d{2}(?:\s[A-Z0-9]{4}){2,8})\b/);
  if (spaceGrouped) {
    const candidate = spaceGrouped[1].replace(/\s/g, '').toUpperCase();
    if (candidate.length >= 15 && candidate.length <= 34) return candidate;
  }
  return null;
}

function extractSwift(text) {
  // Labeled: "SWIFT:", "BIC:", "SWIFT/BIC:", "Swift Code:", "BIC/SWIFT:"
  const labeled = text.match(/(?:swift(?:\/bic)?|bic(?:\/swift)?|swift\s+code)[:\s#]*([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/i);
  if (labeled) return labeled[1].toUpperCase();
  // Bare 8/11-char BIC as fallback
  const bare = text.match(/\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/);
  if (bare) return bare[1].toUpperCase();
  return null;
}

function extractAccountNumber(text) {
  const patterns = [
    // "Account Number: 123", "Account #123", "Account#123" (no required separator after #)
    /account\s*(?:number|num|no\.?|#)\s*[:\s#]*(\d[\d\s\-]{4,24}\d)/i,
    /a\/c\s*(?:no\.?|#)?\s*[:\s]*(\d[\d\s\-]{4,24}\d)/i,
    /acct\.?\s*(?:no\.?|#)?\s*[:\s]*(\d[\d\s\-]{4,24}\d)/i,
    // Serbian/Croatian format: "ZR: :555-000-0065-6214-88"
    /\bZR[:\s]+:?(\d[\d\-]{4,28}\d)/i,
    // "Bank Account 265-1000000299385-19"
    /bank\s+account\s+(\d[\d\-]{4,28}\d)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].replace(/[\s\-]/g, '');
  }
  return null;
}

function extractSortCode(text) {
  const m = text.match(/(?:sort\s*code|sc)[:\s]*(\d{2}[-\s]\d{2}[-\s]\d{2})/i)
         || text.match(/\b(\d{2}-\d{2}-\d{2})\b/);
  if (m) return m[1].replace(/\s/g, '-');
  return null;
}

function extractRoutingNumber(text) {
  const m = text.match(/(?:routing\s*(?:number|num|no\.?|#)|aba|routing\s*#)[:\s#]*(\d{9})\b/i);
  return m ? m[1] : null;
}

function extractBankName(text) {
  const patterns = [
    /bank\s*name[:\s]+([^\n,]{3,60})/i,
    // Require colon after "bank" to avoid matching "Bank transfer" etc.
    /(?:^|\n)\s*bank\s*:\s*([^\n,]{3,60})/im,
    // "Pay to: Bank Name" or "Payable to:"
    /(?:payable\s+(?:to|through)|pay\s+(?:to|via))[:\s]+([^\n,]{3,60})/i,
    // "Name: Raiffeisen Bank DD..." in bank details section
    /(?:bank\s+details?|payment\s+instructions?|remit\s+to)[\s\S]{0,60}name[:\s]+([^\n,]{3,60})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = m[1].trim();
      if (val.length > 3 && !/^\d+$/.test(val)) return val;
    }
  }
  return null;
}

function extractCompanyName(text) {
  const patterns = [
    /(?:bill(?:ed)?\s+from|remit\s+to|pay(?:able)?\s+to)[:\s]+([^\n]{3,60})/i,
    /(?:^|\n)\s*company\s*(?:name)?[:\s]+([^\n]{3,60})/im,
    // "Issued by:" — only grab same-line content (don't cross newline)
    /(?:issued\s+by)\s*:[ \t]*([^\n]{3,60})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = m[1].trim();
      // Reject obvious non-names
      if (val.length > 3 && !/^\d/.test(val) && !/^\d+$/.test(val) && !/^(synergie|llc|ltd|signature)/i.test(val)) return val;
    }
  }
  return null;
}

function extractPaymentDetails(text) {
  return {
    iban:          extractIban(text),
    swift:         extractSwift(text),
    accountNumber: extractAccountNumber(text),
    sortCode:      extractSortCode(text),
    routingNumber: extractRoutingNumber(text),
    bankName:      extractBankName(text),
    companyName:   extractCompanyName(text),
  };
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
  const totalHours    = track('totalHours',  extractHours(text));
  const rate          = track('rate',        extractRate(text));
  const totalAmount   = track('totalAmount', extractTotal(text));
  const currency      = track('currency',    extractCurrency(text));

  const paymentDetails = extractPaymentDetails(text);
  const pdFields = ['iban', 'swift', 'accountNumber', 'sortCode', 'routingNumber', 'bankName', 'companyName'];
  pdFields.forEach(f => track(`payment.${f}`, paymentDetails[f]));

  const parseNotes = [
    found.length   ? `Found: ${found.join(', ')}`    : null,
    missing.length ? `Missing: ${missing.join(', ')}` : null,
  ].filter(Boolean).join(' | ');

  return { invoiceNumber, periodStart, periodEnd, totalHours, rate, totalAmount, currency, paymentDetails, parseNotes };
}

module.exports = { parseInvoice };
