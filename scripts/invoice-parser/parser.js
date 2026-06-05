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

  // MM/DD/YYYY or DD/MM/YYYY (or with - or . separators).
  // If the first component exceeds 12 it cannot be a month, so treat as DD/MM/YYYY.
  // Otherwise assume MM/DD/YYYY (US-style default for ambiguous cases).
  m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[1] > 12) return new Date(year, +m[2] - 1, +m[1]); // unambiguous DD/MM
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
    // "Invoice - 02/26" — dash-separated label (no colon)
    /invoice\s*[-–]\s*([A-Z0-9][\w\/\-\.]{1,25})/i,
    /inv[.\-#\s]+([A-Z0-9][\w\-]{1,25})/i,
    // "No 002/05/2026" — bare "No" label before numeric invoice number
    /\bNo\.?[ \t]+(\d[\d\/\-\.]{2,20})/i,
    // "# STS 04/2026" — hash at line-start or mid-line (after whitespace), letters+digits form
    /(?:^|\n)\s*#[ \t]*([A-Z0-9][\w\-\/\.]+(?:[ \t]+[A-Z0-9][\w\-\/\.]+)?)/m,
    /(?:^|[ \t])#[ \t]*([A-Z]{2,6}[ \t]+\d{2}[\/\-]\d{4})/m,
    // "INVOICE NUMBER DATE OF ISSUE\n6" — number on next line after column header
    /invoice\s+number\s+date\s+of\s+issue[^\n]*\n[ \t]*(\d[\d\-]{0,10})\b/i,
    // "BROJ RACUNA/RAČUNA" (Croatian "invoice number", noun first order)
    // [cčćéç¢g] covers OCR variants of č/ć (e.g. 'é', 'ç', '¢')
    /(?:broj|br\.?)\s*ra[cčćéç¢g]una?[:\s]+([A-Z0-9][\w\-\/]{1,25})/i,
    // "Racun BR." / "RACUN BR." (Bosnian/Serbian/Croatian, verb first order)
    /ra[cčćéç¢g]un\s*(?:br\.?|broj)[:\s]+([A-Z0-9][\w\-\/]{1,25})/i,
    // "PR NO.: 177551992948" — payment request number (used as invoice ID)
    /\bPR\s*NO\.?\s*:\s*(\d[\d\-]{1,25})/i,
    // "Reference No: 177811194162" — reference number in payment request docs
    /\breference\s+no\.?\s*:\s*(\d[\d\-\/\.]{1,25})/i,
    // "Poziv na broj: 2026-24-1-1" (Croatian payment reference, last resort)
    /poziv\s+na\s+broj[:\s]+([A-Z0-9][\w\-\/]{1,25})/i,
    // "Invoice5/V01/0" — no space between "Invoice" and number, must contain "/" or "-"
    /invoice([0-9][\w]*[\/\-][\/\w\-\.]+)/i,
    // "000025\nFaktura" — Bosnian template where number precedes "Faktura" keyword
    /(\d{4,10})\s*\n\s*Faktura/i,
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

  // Croatian bilingual invoice: "CREATION & DELIVERY DATE DD/MM/YYYY" = period start,
  // "DUE DATE DD/MM/YYYY" = period end. Only valid when span is 20–35 days (monthly billing).
  const creationDate = text.match(/(?:creation\s*&?\s*delivery\s*date|datum\s+izrade\s+i\s+isporuke)[^\n]*?(\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4})/i);
  const dueDate      = text.match(/(?:due\s*date|datum\s+dospije[ćc]a)[^\n]*?(\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4})/i);
  if (creationDate && dueDate) {
    const start = parseDate(creationDate[1]);
    const end   = parseDate(dueDate[1]);
    if (start && end) {
      const span = (end - start) / 86400000;
      if (span >= 20 && span <= 35) {
        return { periodStart: fmtDate(start), periodEnd: fmtDate(end) };
      }
    }
  }

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
  // OCR commonly maps "o"→"0" and "t"→"1", so "to" can appear as "10" or "t0"
  const yearEnd = text.match(
    /from\s+(\d{1,2}[\/\-]\d{1,2})\s+(?:to|10|t0)\s+(\d{1,2}[\/\-]\d{1,2})[\s,\-]+(\d{4})/i
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

  // "FROM 01/04/-30/04/2026" — start date has no year; end date provides full date with year.
  // The separator between dates can include a mix of "/" and "-" (common in European templates).
  // Start/end use the same date format, so if end is DD/MM/YYYY, start is also DD/MM.
  const sharedYear = text.match(
    /from\s+(\d{1,2})[\/\.](\d{1,2})[\/\-]+(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{2,4})/i
  );
  if (sharedYear) {
    const [, sd, sm, ed, em, ey] = sharedYear.map((v, i) => i === 0 ? v : +v);
    const year = ey < 100 ? 2000 + ey : ey;
    // Determine format from end date: if ed > 12 it must be DD (day-first)
    const endMo  = ed > 12 ? em - 1 : ed - 1;
    const endDay = ed > 12 ? ed      : em;
    const startMo  = ed > 12 ? sm - 1 : sd - 1;
    const startDay = ed > 12 ? sd      : sm;
    const start = new Date(year, startMo, startDay);
    const end   = new Date(year, endMo,   endDay);
    if (!isNaN(start) && !isNaN(end) && start <= end) {
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

  // "04.2026" — European MM.YYYY month+year in service/description context → full month period
  // Require a service keyword nearby (same line) to avoid false matches on phone/ID numbers
  const mmYYYY = text.match(
    /(?:service[s]?|development|consulting|programming|engineering|maintenance|testing|management)[^\n]{0,80}?\b(0[1-9]|1[0-2])\.(20\d{2})\b/i
  ) || text.match(/\b(0[1-9]|1[0-2])\.(20\d{2})\b[^\n]{0,80}?(?:service[s]?|development|consulting|programming)/i);
  if (mmYYYY) {
    const mo   = +mmYYYY[1] - 1;
    const year = +mmYYYY[2];
    return { periodStart: fmtDate(new Date(year, mo, 1)), periodEnd: fmtDate(new Date(year, mo + 1, 0)) };
  }

  // "April 2026" — month + year on the same line in service context
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

  // Last resort: month name in a service line (no year on same line), year found anywhere in doc.
  // The negative lookahead prevents matching "April 6, 2026" (a date, not a billing month).
  const docYear = (text.match(/\b(20\d{2})\b/) || [])[1];
  if (docYear) {
    const svcMonth = text.match(
      /(?:service[s]?|engineering|development|consulting|programming|maintenance|testing|management)\b[^\n]{0,80}?\b(January|February|March|April|May|June|July|August|September|October|November|December)\b(?!\s*\d{1,2}[,\s]\s*\d{4})/i
    ) || text.match(
      /\bfor\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b(?!\s*\d{1,2}[,\s]\s*\d{4})/i
    ) || text.match(
      /[-–]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\b(?!\s*\d{1,2}[,\s]\s*\d{4})/i
    );
    if (svcMonth) {
      const mo = MONTH_MAP[svcMonth[1].toLowerCase()];
      if (mo !== undefined) {
        const year = +docYear;
        return { periodStart: fmtDate(new Date(year, mo, 1)), periodEnd: fmtDate(new Date(year, mo + 1, 0)) };
      }
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
    // Croatian "SATI" or "HOURS" column header, value on next line in table row
    // Matches: "SATI PRICE IZNOS\nHOURS PRICE AMOUNT\n1 168 €27.91"
    [/\b(?:SATI|HOURS)\b[^\n]*\n(?:[^\n]*\n)?\s*\d+\s+(\d{2,3})\s/i, s => cleanHours(s)],
    // Numbered table row: "1  168  €27.91  €4,689.11" (line-item rows in bilingual invoices)
    [/^\s*\d\s+(\d{2,3})\s+[€$][\d,.]/m,               s => cleanHours(s)],
    // "160 hrs" abbreviation
    [/(\d+[\.,]?\d*)\s*hrs?\b/i,                         s => cleanHours(s)],
    // "176 HOURS30.00" — concatenated columns, no word boundary after HOURS
    [/(\d+[\.,]?\d*)\s*HOURS/i,                          s => cleanHours(s)],
    // "160 h" or "160h" as standalone unit
    [/\b(\d+[\.,]?\d*)[ \t]*h\b/,                        s => cleanHours(s)],
    // "Quantity: 80" near "hour" context
    [/quantity[:\s]+(\d+[\.,]?\d*)(?=[\s\S]{0,80}hour)/i, s => cleanHours(s)],
    // QuickBooks/Intuit: "Qty 168" or "Qty: 168" column header/label
    [/\bqty\.?[:\s]+(\d+[\.,]?\d*)/i,                     s => cleanHours(s)],
    // QB table row: qty at line start, /hr rate on same line
    // "168  Software Development  $70.00/hr  $11,760.00"
    [/^[ \t]*(\d{2,3}[\.,]?\d*)[ \t]+\w[^\n]*\/hr\b/im,   s => cleanHours(s)],
    // "hour 176 30.00" — unit column precedes qty (table format where label comes first)
    [/\bhours?[ \t]+(\d{2,3}[\.,]?\d*)\b/i,             s => cleanHours(s)],
    // "sat 176" / "sata 176" — Croatian/Bosnian word for hour(s) used as unit label
    [/\bsat[ai]?\s+(\d{2,3}[\.,]?\d*)\b/i,              s => cleanHours(s)],
    // "per hour × 176" or "per h x 176" — rate-first formula where hours follows the multiplier
    [/per\s*h(?:our|r)?\s*[x×*]\s*(\d+[\.,]?\d*)/i,    s => cleanHours(s)],
    // Table line with European-format quantity: service keyword + short unit + N,NNN or N.NNN
    // Handles templates where unit label (e.g. "Pon", "kom") precedes qty in European notation.
    // Only matches 2–3 digit numbers before the separator (rules out prices like "6,500").
    [/(?:software|development|consulting|programming|maintenance|testing|engineering|management|services?)\b[^\n]{0,60}\b[a-z]{2,5}\s+(\d{2,3}[,\.]\d{3})\b/i, s => cleanHours(s)],
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
    // "176 HOURS30.00 USD" — OCR concatenation: rate immediately follows HOURS
    /\bHOURS([\d,\.]+)/i,
    // "hour 176 30.00" / "sat 176 30.00" — unit+qty in first two columns, rate in third
    /\bhours?[ \t]+\d+[\.,]?\d*[ \t]+([\d,\.]+)/i,
    /\bsat[ai]?\s+\d+[\.,]?\d*\s+([\d,\.]+)/i,
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
  // Use [ ,\.]+ (no \s — no newline) in all captures to prevent greedy match crossing lines.
  const patterns = [
    /total\s+amount\s+due[:\s]+\$?([\d ,\.]+)/i,
    /amount\s+due[:\s]+\$?([\d ,\.]+)/i,
    /balance\s+due[:\s\n]+\$?([\d ,\.]+)/i,
    /total\s+due[:\s]+\$?([\d ,\.]+)/i,
    /grand\s+total[:\s]+\$?([\d ,\.]+)/i,
    // "Total - $4800.00"
    /total\s*[-–—]\s*\$?([\d ,\.]+)/i,
    // "Total amount (USD) 5280.00" — optional currency in parens
    /total\s+amount\s*(?:\([^)]*\))?\s*[:\s]+\$?([\d ,\.]+)/i,
    // "Invoice Amount: 5280.00"
    /invoice\s+amount[:\s\n]+\$?([\d ,\.]+)/i,
    // "INVOICE TOTAL\nUS$ 5,040" — total on next line with $ prefix
    /invoice\s+total\s+(?:US)?\$\s*([\d,\.]+)/i,
    // "Total (USD) 4.320,00" — currency in parens, amount follows (possibly with trailing $)
    /total\s*\(USD\)\s*([\d ,\.]+)/i,
    // "Ukupno / Total: 4320,00" (Croatian/Bosnian)
    /ukupno\s*\/\s*total[:\s]+\$?([\d ,\.]+)/i,
    // "Ukupno bez poreza: 5.280,00 $" — value before trailing $ symbol
    /(?:ukupno|total)[^$\n]*?:[ \t]*([\d][\d ,\.]+)\s*\$/i,
    // "Total Price | 37,171.14 BAM $22,240.00" — prefer $-prefixed USD amount over pipe amount
    /(?:total|ukupno)[^\n$]{0,80}\$\s*([\d,\.]+)/i,
    // "Total USD 5,070.00" — bare currency code between label and amount
    /\btotal\s+[A-Z]{3}\s+([\d ,\.]+)/i,
    // "UKUPNO CIJENA/TOTAL PRICE [] | 5280,00" — table-pipe format (after $ check)
    /total[^|\n]{0,50}\|\s*([\d,\.]+)/i,
    // Generic last-resort: "Total: 5280.00" anywhere in text
    /\btotal[:\s]+\$?([\d ,\.]+)/i,
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
  const upper = text.toUpperCase();
  // Labeled: "SWIFT:", "BIC:", "SWIFT/BIC:", "BIC/SWIFT:", "Swift Code:"
  // Restrict separator to [ \t:#] so the pattern cannot cross a newline into a table header.
  // Space-split BICs ("UNCRBA 22") are handled by stripping spaces from the capture.
  // Always return the 8-char prefix: OCR noise can make the suffix ambiguous ("NOBIBA22A Vat").
  // SWIFT\s+CODE must come before SWIFT(?:\/BIC)? so "SWIFT CODE RZBABA2S" isn't
  // greedily matched as label="SWIFT" + BIC="CODE RZBABA2S"
  const labeled = upper.match(/(?:SWIFT\s+CODE|SWIFT(?:\/BIC)?|BIC(?:\/SWIFT)?)[ \t:#]*([A-Z0-9][A-Z0-9 ]{7,13})/);
  if (labeled) {
    const s = labeled[1].replace(/\s+/g, '');
    const m = s.match(/^([A-Z]{4}[A-Z]{2}[A-Z0-9]{2})/);
    if (m) return m[1];
  }
  // Bare 8/11-char BIC fallback — require at least one digit in location code (chars 6-7)
  // to filter English words like "ACTIVITY". Also skip if first 6 chars spell a document
  // keyword (e.g. "INVOIC" from "Invoice5/V01/0" → "INVOIC" + "E5" → false BIC).
  const bare = upper.match(/\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g);
  if (bare) {
    const bic = bare.find(b => /\d/.test(b.slice(6, 8)) && b.slice(0, 6) !== 'INVOIC');
    if (bic) return bic;
  }
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
    // Require explicit colon to avoid matching "Company Details:" as "Details:"
    /(?:^|\n)\s*company\s*(?:name)?\s*:[ \t]*([^\n]{3,60})/im,
    // "Issued by:" — only grab same-line content (don't cross newline)
    /(?:issued\s+by)\s*:[ \t]*([^\n]{3,60})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = m[1].trim();
      // Reject obvious non-names: section labels, digits, known client/boilerplate names
      if (val.length > 3 && !/^\d/.test(val) && !/^\d+$/.test(val) &&
          !/^(synergie|llc|ltd|signature|details|invoice|date|number|payment|bank|achinformation)/i.test(val)) return val;
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

  let totalHours  = extractHours(text);
  let rate        = extractRate(text);
  let totalAmount = extractTotal(text);

  // Multi-contractor detection: if the text contains 3+ distinct person+hours patterns
  // (e.g. "Sancanin 160h $35"), the invoice covers multiple contractors. Hours extracted
  // from the first matching line do not correspond to the aggregate total, so derivation
  // would produce a meaningless blended rate. Clear both fields in this case.
  const contractorLines = (text.match(/\b[A-Z][a-z]+\s+\d+h\b/g) || []);
  const isMultiContractor = contractorLines.length >= 3;
  if (isMultiContractor) {
    totalHours = null;
    rate       = null;
  }

  // Mathematical derivation: if any 2 of {hours, rate, total} are known, compute the 3rd.
  // Only accept derived hours/rate when the result is close to an integer (0.5% tolerance),
  // which rules out false derivations from unrelated rate/total values.
  // Also cross-validate: if all three are known but rate × hours is inconsistent with total
  // (off by more than 10%), the extracted rate is likely wrong — clear it so it can be derived.
  const nearInt = n => Math.abs(n - Math.round(n)) / Math.max(1, Math.abs(n)) < 0.005;
  if (totalHours != null && rate != null && totalAmount != null) {
    if (Math.abs(totalHours * rate - totalAmount) / totalAmount > 0.10) rate = null;
  }
  if (totalHours == null && rate != null && totalAmount != null) {
    const h = totalAmount / rate;
    if (h >= 1 && h <= 720 && nearInt(h)) totalHours = Math.round(h);
  }
  if (rate == null && totalHours != null && totalAmount != null) {
    const r = totalAmount / totalHours;
    if (r >= 1 && r < 5000 && nearInt(r)) rate = Math.round(r * 100) / 100;
  }
  if (totalAmount == null && totalHours != null && rate != null) {
    totalAmount = Math.round(totalHours * rate * 100) / 100;
  }

  track('totalHours',  totalHours);
  track('rate',        rate);
  track('totalAmount', totalAmount);
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
