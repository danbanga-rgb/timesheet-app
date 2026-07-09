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
  // Imran's format: "7/IN:906/01/2026" — N/IN:M value merged with date (two groups)
  const imranM = text.match(/\b(\d{1,4})\/IN:?(\d{1,4})(?=\d{2}\/\d{2}\/\d{4})/i);
  if (imranM) return `${imranM[1]}/IN${imranM[2]}`;
  const patterns = [
    // ── PDF text-extraction quirks: field labels and values get smushed together ──
    // "INVOICE NUMBER...DATE OF ISSUE" header with no column separator on value line
    // e.g. Tarik: "INVOICE NUMBERDATE OF ISSUEDUE DATE\n...\n707/06/202622/06/2026"
    // → capture digits BEFORE the first DD/MM/YYYY date on the value line
    /INVOICE\s+NUMBER[\s\S]{0,80}?DATE\s+OF\s+ISSUE[\s\S]{0,200}?\n\s*(\d{1,5})(?=\d{2}\/\d{2}\/\d{4})/i,
    // "005-202606/01/2026" — SD IT USLUGE template: INVOICE and DATE headers merge into
    // "INVOICEDATE" with the invoice number and date run together on one line.
    // Capture NNN-YYYY before a DD/MM/YYYY date (which immediately follows with no space).
    /INVOICEDATE\s*(\d{3}-\d{4})(?=\d{2}\/\d{2}\/\d{4})/i,
    // "IN:806/01/2026" — value smushed with date of issue (Imran's template)
    /\bIN[:\s]+(\d{1,4})(?=\d{2}\/\d{2}\/\d{4})/i,
    // Number on a line by itself directly above "INVOICE NO." (Antonio's template — visual layout
    // places the number next to the label but text extraction reads them on separate lines)
    /(?:^|\n)\s*(\d{2,5})\s*\n\s*INVOICE\s+NO/im,
    // ── Standard patterns ──
    // "Invoice Number: 016/26" — NNN/YY format (Amar Cakic: sequential number / 2-digit year)
    // Must come before the general invoice-number pattern so the /YY suffix is included.
    /invoice\s*(?:number|num|no\.?)(?!\w)[:\s#]*(\d{1,5}\/\d{2})\b/i,
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
    // [:\s]* allows zero separator — e.g. "Račun br.6-1-1" (no space before number)
    /ra[cčćéç¢g]un\s*(?:br\.?|broj)[:\s]*([A-Z0-9][\w\-\/]{1,25})/i,
    // "PR NO.: 177551992948" — payment request number (used as invoice ID)
    /\bPR\s*NO\.?\s*:\s*(\d[\d\-]{1,25})/i,
    // "Reference No: 177811194162" — reference number in payment request docs
    /\breference\s+no\.?\s*:\s*(\d[\d\-\/\.]{1,25})/i,
    // NET SCALE / Croatian multi-column format: "R1 račun br." label, value 3 rows below
    // e.g. "R1 račun br.\nDatum računa\nDatum isporuke\nRok plaćanja\n10-1-1"
    /R1\s+ra[cčćéç¢g]un\s+br\.\s*\n(?:[^\n]*\n){3}(\d+(?:-\d+){1,4})\b/im,
    // "Poziv na broj: 2026-24-1-1" (Croatian payment reference, last resort)
    // Exclude bank-reference format \d-\d{1,2}-YYYY which is never an invoice number
    /poziv\s+na\s+broj[:\s]+(?!\d-\d{1,2}-20\d\d)([A-Z0-9][\w\-\/]{1,25})/i,
    // "Invoice5/V01/0" — no space between "Invoice" and number, must contain "/" or "-"
    /invoice([0-9][\w]*[\/\-][\/\w\-\.]+)/i,
    // "000025\nFaktura" — Bosnian template where number precedes "Faktura" keyword
    /(\d{4,10})\s*\n\s*Faktura/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && !SKIP.test(m[1]) && hasDigit(m[1])) {
      return m[1].trim()
        .replace(/\s*([\/\-\.])\s*/g, '$1')
        // Strip trailing non-numeric bleed (e.g. "15-1-1Mjesto" → "15-1-1" when next PDF field
        // runs into the captured number with no separator). Only strips letters AFTER a digit.
        .replace(/(\d)[^\d\-\/]+$/, '$1')
        // CSV-safety: prepend "INV " for purely-numeric invoice numbers so Excel doesn't
        // strip leading zeros or treat them as numbers.
        .replace(/^(\d+)$/, 'INV $1');
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
    // "per hour × 176" or "per h x 176" — rate-first formula (moved early: fires before broad HOURS)
    [/per\s*h(?:our|r)?\s*[x×*]\s*(\d+[\.,]?\d*)/i,    s => cleanHours(s)],
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
    // "176 HOURS30.00" — concatenated OCR columns; (?<!:) prevents matching "09:20 hours CET"
    [/(?<!:)(\d+[\.,]?\d*)\s*HOURS/i,                   s => cleanHours(s)],
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

// Fallback: derive hours from a "hours rate amount" table row where hours × rate == total.
// Haris Balavac's PDF: "QA Contractor Services...   176   $20.00   $3,520.00" — a tabular
// row with no textual cue ("hours"/"rate"/"qty"). None of the ~19 hour-labelled patterns
// match, but the arithmetic identifies it unambiguously: 176 × 20 = 3520.
//
// Called ONLY after extractTotal succeeded — cross-checks against the known total. Any
// {hours, rate} candidate whose product equals total wins. Prevents false matches on
// unrelated same-line number triples.
function deriveHoursRateFromTotal(text, knownTotal) {
  if (!knownTotal || knownTotal <= 0) return null;
  // Match any line with three numeric-looking tokens: N $N.NN $N,NNN.NN (in any $-optional order)
  const tripleRe = /(\d+(?:[.,]\d+)?)\s+\$?\s*(\d+(?:[.,]\d+)?)\s+\$?\s*(\d+(?:[.,]\d+)?)/g;
  let m;
  while ((m = tripleRe.exec(text)) !== null) {
    const [n1, n2, n3] = [cleanNum(m[1]), cleanNum(m[2]), cleanNum(m[3])];
    if (n1 == null || n2 == null || n3 == null) continue;
    // Try (hours, rate, total) in most-likely positions
    for (const [hCand, rCand, tCand] of [[n1, n2, n3], [n2, n3, n1]]) {
      if (hCand < 1 || hCand > 1000) continue;              // plausible hours range
      if (rCand < 1 || rCand > 500) continue;               // plausible rate range
      if (Math.abs(hCand * rCand - knownTotal) < 0.5) {     // arithmetic checks out
        return { hours: hCand, rate: rCand };
      }
      if (Math.abs(hCand * rCand - tCand) < 0.5 && Math.abs(tCand - knownTotal) < 0.5) {
        return { hours: hCand, rate: rCand };
      }
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

// IBAN mod-97 checksum validator (ISO 13616). Used to strip trailing PDF-field-name bleed
// like "HR5223600001102675840ACC" → "HR5223600001102675840" (where ACC was the next field).
function ibanChecksumValid(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) || iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, c => (c.charCodeAt(0) - 55).toString());
  let r = 0;
  for (const d of numeric) r = (r * 10 + parseInt(d, 10)) % 97;
  return r === 1;
}
// Strip trailing alphabetic bleed by progressively shortening until checksum validates.
function ibanStripBleed(candidate) {
  if (ibanChecksumValid(candidate)) return candidate;
  for (let trim = 1; trim <= 12; trim++) {
    const shorter = candidate.slice(0, -trim);
    if (shorter.length >= 15 && ibanChecksumValid(shorter)) return shorter;
  }
  return candidate; // keep as-is; caller may still accept on length grounds
}

function extractIban(text) {
  // Labeled: "IBAN:", "IBAN/IFSC:", "IBAN/BIC:" — allow horizontal whitespace only (no newline crossing)
  // Lookahead (?=...) stops greedy match before adjacent words (e.g. "Acc. No." after IBAN)
  const labeled = text.match(/IBAN(?:\/[A-Z]+)?[:\s#]+([A-Z]{2}[ \t]*\d{2}(?:[ \t]*[A-Z0-9]){11,30})(?=[ \t\n\r]|[^A-Za-z0-9]|$)/i);
  if (labeled) {
    const candidate = labeled[1].replace(/[ \t]/g, '').toUpperCase();
    if (candidate.length >= 15 && candidate.length <= 34) return ibanStripBleed(candidate);
  }
  // Bare IBAN: compact (no spaces)
  const bare = text.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/);
  if (bare) {
    const candidate = bare[1];
    if (candidate.length >= 15 && candidate.length <= 34) return ibanStripBleed(candidate);
  }
  // Bare IBAN: space-grouped like "LT60 3250 0022 8875 3177"
  const spaceGrouped = text.match(/\b([A-Z]{2}\d{2}(?:\s[A-Z0-9]{4}){2,8})\b/);
  if (spaceGrouped) {
    const candidate = spaceGrouped[1].replace(/\s/g, '').toUpperCase();
    if (candidate.length >= 15 && candidate.length <= 34) return ibanStripBleed(candidate);
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

// ─── Known templates ──────────────────────────────────────────────────────────
// Returns { invoiceNumber, periodStart, periodEnd, totalHours, rate, totalAmount,
// currency, template } when a known invoice format matches, or null. These bypass
// the generic regex chain for the small set of contractors using these templates,
// keeping them on the cheap parse path forever.

function parseBimosoftTemplate(text) {
  if (!/Bimosoft\s*E\s*O[ÜU]/i.test(text)) return null;
  const out = { template: 'bimosoft', currency: 'USD' };
  const prNo = text.match(/PR\s*NO\.?\s*[:\s]+(\d{8,14})/i);
  if (prNo) out.invoiceNumber = 'INV ' + prNo[1];
  const prDate = text.match(/PR\s*DATE\s*[:\s]+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (prDate) {
    const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
      january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
    const m = months[prDate[1].toLowerCase()];
    if (m !== undefined) {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? parseInt(prDate[3]) - 1 : parseInt(prDate[3]);
      const lastDay = new Date(py, pm + 1, 0).getDate();
      const mm = String(pm + 1).padStart(2, '0');
      out.periodStart = py + '-' + mm + '-01';
      out.periodEnd = py + '-' + mm + '-' + String(lastDay).padStart(2, '0');
    }
  }
  // SUBTOTAL is the authoritative total
  const sub = text.match(/SUBTOTAL\s*([\d,]+\.\d{2})\s*USD/i);
  if (sub) out.totalAmount = parseFloat(sub[1].replace(/,/g, ''));
  // Inline rate USD qty total USD — greedy match may bleed adjacent year digits
  // into rate. Validate rate × qty ≈ total, fall back to rate % 100 if not.
  const inline = text.match(/(\d+\.\d{2})\s*USD\s*(\d+\.\d{2})([\d,]+\.\d{2})\s*USD(?=\s*\n?\s*SUBTOTAL)/i);
  if (inline) {
    let rate = parseFloat(inline[1]);
    const qty = parseFloat(inline[2]);
    const inlineTotal = parseFloat(inline[3].replace(/,/g, ''));
    const match = (r, q, t) => Math.abs(r * q - t) < 0.5;
    if (!match(rate, qty, inlineTotal) && rate > 99) {
      const corrected = rate % 100;
      if (corrected >= 1 && match(corrected, qty, inlineTotal)) rate = corrected;
    }
    if (match(rate, qty, inlineTotal)) {
      out.rate = rate;
      out.totalHours = qty;
    }
  }
  return out;
}

function parseNativeTeamsTemplate(text) {
  if (!/Native\s*Teams\s*Limited/i.test(text)) return null;
  const out = { template: 'nativeteams', currency: 'USD' };
  const inv = text.match(/Invoice\s*#?(NT-[a-z0-9]+)/i);
  if (inv) out.invoiceNumber = inv[1];
  // Issue date is DD/MM/YYYY (EU format). Work period = previous calendar month.
  const issue = text.match(/Issue\s*date\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (issue) {
    const m = parseInt(issue[2]) - 1;
    const y = parseInt(issue[3]);
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const lastDay = new Date(py, pm + 1, 0).getDate();
    const mm = String(pm + 1).padStart(2, '0');
    out.periodStart = py + '-' + mm + '-01';
    out.periodEnd = py + '-' + mm + '-' + String(lastDay).padStart(2, '0');
  }
  // "Total" label line is clean
  const total = text.match(/(?:^|\n)\s*Total\s*\n?\s*USD\s*([\d,]+\.\d{2})/i);
  if (total) out.totalAmount = parseFloat(total[1].replace(/,/g, ''));
  // Item-line rate appears as "-USD<rate>"
  const rate = text.match(/-USD(\d+\.\d{2})/);
  if (rate) out.rate = parseFloat(rate[1]);
  // Qty has no decimal on inline so derive hours = total / rate
  if (out.totalAmount && out.rate && out.rate > 0) {
    out.totalHours = Math.round((out.totalAmount / out.rate) * 100) / 100;
  }
  return out;
}

// Croatian bilingual DOCX template used by SANCODE (Slaven Konforta) and FIX-IT (Nikolina
// Radošević). Signature: "Račun br." label + "X USD per h x NNN" line item format.
// These DOCX files contain absolute-position noise values and a EUR parallel column that
// confuse Claude, so a targeted regex is much more reliable.
function parseCroatianHrvatskiTemplate(text) {
  // Both use "Invoice no. / Račun br." but so might others — require the rate line too
  if (!/\bUSD per h(?:our)?\s+x\s+\d/.test(text)) return null;

  const out = { template: 'croatian_hr', currency: 'USD' };

  // Invoice number: "Invoice no. / Račun br.6-1-1" (no space before number)
  const inv = text.match(/ra[cčćéç¢g]un\s*br\.?\s*([A-Z0-9][\w\-\/]{1,20})/i);
  if (inv) out.invoiceNumber = inv[1].trim();

  // Rate, hours, total from "35 USD per h x 168 = 5,880.00 USD" or
  // "-35 USD per h x 168 = 5,880.00 USD" (the dash is a bullet artifact from extractDocxText)
  const line = text.match(/-?(\d+(?:\.\d+)?)\s*USD per h(?:our)?\s*x\s*(\d+(?:\.\d+)?)\s*h?\s*=\s*([\d,]+\.?\d*)\s*USD/i);
  if (line) {
    out.rate       = parseFloat(line[1]);
    out.totalHours = parseFloat(line[2]);
    out.totalAmount = parseFloat(line[3].replace(/,/g, ''));
  }

  // Period: FIX-IT has an explicit range in the description that the generic extractor finds.
  // SANCODE only shows the invoice issue date (e.g. "06/01/2026") with no billing period label.
  // For SANCODE, infer period = previous calendar month relative to the invoice date.
  // Only apply if the generic extractor would come up empty (no range in text).
  const hasRange = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\s*(?:to|through|[-–—])\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/i.test(text);
  if (!hasRange) {
    // Look for invoice date in MM/DD/YYYY format (US variant present in SANCODE text alongside DD.MM.YYYY)
    const issueDateMatch = text.match(/(?:place and time of invoice|invoice\s+issued)[^]*?(\d{2}\/\d{2}\/\d{4})/i);
    if (issueDateMatch) {
      const [mm, dd, yyyy] = issueDateMatch[1].split('/').map(Number);
      const issueDate = new Date(yyyy, mm - 1, dd);
      const pm = issueDate.getMonth() === 0 ? 11 : issueDate.getMonth() - 1;
      const py = issueDate.getMonth() === 0 ? issueDate.getFullYear() - 1 : issueDate.getFullYear();
      const lastDay = new Date(py, pm + 1, 0).getDate();
      const pmStr = String(pm + 1).padStart(2, '0');
      out.periodStart = `${py}-${pmStr}-01`;
      out.periodEnd   = `${py}-${pmStr}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  return out.rate ? out : null;
}

// Hooksoft template used by Mirza Hukić. PDF text-extraction merges columns:
// "Software developmentUSD 4800.0030.00\n(hrs)\n160" where 4800.00 = total and 30.00 = rate.
function parseHooksoftTemplate(text) {
  if (!/Hooksoft/i.test(text)) return null;
  const out = { template: 'hooksoft', currency: 'USD' };

  const inv = text.match(/Invoice\s+No\.\s*\n\s*(\S+)/i);
  if (inv) out.invoiceNumber = inv[1];

  // Date field is "DD-MM-YYYY"; derive full calendar month as billing period.
  const dt = text.match(/\bDate\s*\n\s*(\d{2})-(\d{2})-(\d{4})/i);
  if (dt) {
    const mm = dt[2];
    const yyyy = dt[3];
    const lastDay = new Date(+yyyy, +mm, 0).getDate();
    out.periodStart = `${yyyy}-${mm}-01`;
    out.periodEnd   = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
  }

  // Rate: last decimal value on the concatenated amount+rate line, right before the "(hrs)" line.
  const rateM = text.match(/(\d+\.\d{2})\s*\n\s*\(hrs\)/i);
  if (rateM) out.rate = parseFloat(rateM[1]);

  const hrsM = text.match(/\(hrs\)\s*\n\s*(\d+)/i);
  if (hrsM) out.totalHours = parseFloat(hrsM[1]);

  // "TotalUSD 4,800.00"
  const totalM = text.match(/TotalUSD\s*([\d,]+\.?\d*)/i);
  if (totalM) out.totalAmount = cleanNum(totalM[1]);

  return out.totalAmount ? out : null;
}

// VEB PORTALI template used by Vladimir Simsic. Header line encodes period and invoice number;
// rate line uses European decimal format with "$/HOUR" unit.
function parseVebPortaliTemplate(text) {
  if (!/VEB\s+PORTALI/i.test(text)) return null;
  const out = { template: 'veb_portali', currency: 'USD' };

  // "INVOICE SYNERGIE 06/01-30/2026." → invoice number = "06/01-30/2026"
  const inv = text.match(/INVOICE\s+SYNERGIE\s+([^\s.]+)/i);
  if (inv) out.invoiceNumber = inv[1];

  // Period: MM/startDay-endDay/YYYY
  const period = text.match(/INVOICE\s+SYNERGIE\s+(\d{2})\/(\d{2})-(\d{2})\/(\d{4})/i);
  if (period) {
    const [, mm, sd, ed, yyyy] = period;
    out.periodStart = `${yyyy}-${mm}-${sd}`;
    out.periodEnd   = `${yyyy}-${mm}-${ed}`;
  }

  // "20 $/HOUR 176 3.520,00 USD" — rate precedes $/HOUR, hours follow it, total in European format
  const rateM = text.match(/(\d+)\s*\$\/HOUR/i);
  if (rateM) out.rate = parseFloat(rateM[1]);

  const hrsM = text.match(/\$\/HOUR\s+(\d+)/i);
  if (hrsM) out.totalHours = parseFloat(hrsM[1]);

  const totalM = text.match(/([\d.]+,\d{2})\s*USD/i);
  if (totalM) out.totalAmount = cleanNum(totalM[1]);

  return out.totalAmount ? out : null;
}

function tryTemplateParsers(text) {
  return parseBimosoftTemplate(text)
    || parseNativeTeamsTemplate(text)
    || parseCroatianHrvatskiTemplate(text)
    || parseHooksoftTemplate(text)
    || parseVebPortaliTemplate(text)
    || null;
}

function parseInvoice(text, filename) {
  const found   = [];
  const missing = [];

  function track(name, value) {
    if (value != null) found.push(name); else missing.push(name);
    return value;
  }

  // Known-template fast path: when a template signature matches, prefer its
  // field values over the generic extractors. Payment details still come from
  // the generic extractor since IBAN/SWIFT live in different layouts.
  const tpl = tryTemplateParsers(text);

  const invoiceNumber = track('invoiceNumber', tpl?.invoiceNumber ?? extractInvoiceNumber(text));
  // eslint-disable-next-line prefer-const
  let { periodStart, periodEnd } = (tpl?.periodStart && tpl?.periodEnd)
    ? { periodStart: tpl.periodStart, periodEnd: tpl.periodEnd }
    : extractPeriod(text);
  // Cap period_end to last day of period_start's month when period_start is the first
  // of a month and the parser inferred a period_end in a later month. Contractors almost
  // always invoice for a calendar month; templates that only show an "issue date"
  // (e.g. OBAI's Croatian template) cause the parser to bleed into the next month.
  // Mid-month period_start values are left alone — those are legitimate partial periods.
  if (periodStart && periodEnd && /^\d{4}-\d{2}-01$/.test(periodStart)) {
    const [psY, psM] = periodStart.split('-').map(Number);
    const [peY, peM] = periodEnd.split('-').map(Number);
    if (peY > psY || (peY === psY && peM > psM)) {
      const capped = new Date(psY, psM, 0); // day 0 of next month = last day of current month
      const newEnd = `${capped.getFullYear()}-${String(capped.getMonth() + 1).padStart(2, '0')}-${String(capped.getDate()).padStart(2, '0')}`;
      track('parseNotes', `period_end capped from ${periodEnd} to ${newEnd} (calendar-month invoice guard)`);
      periodEnd = newEnd;
    }
  }
  track('periodStart', periodStart);
  track('periodEnd',   periodEnd);

  let totalHours  = tpl?.totalHours  ?? extractHours(text);
  let rate        = tpl?.rate        ?? extractRate(text);
  let totalAmount = tpl?.totalAmount ?? extractTotal(text);

  // Table-row derivation: for tabular PDFs with no labelled hours/rate cues
  // (Haris Balavac 145 case), search for a "hours rate amount" triple whose
  // arithmetic matches the already-extracted total.
  if ((totalHours == null || rate == null) && totalAmount != null) {
    const derived = deriveHoursRateFromTotal(text, totalAmount);
    if (derived) {
      if (totalHours == null) totalHours = derived.hours;
      if (rate == null)       rate       = derived.rate;
    }
  }

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
  const currency      = track('currency',    tpl?.currency ?? extractCurrency(text));

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
