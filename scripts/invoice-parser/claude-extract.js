'use strict';

// Claude-based invoice extraction.
// Sends invoice content to claude-haiku-4-5 (vision or text) and gets back
// structured JSON for all invoice fields in one shot — no regex needed.

require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an invoice data extractor. Extract structured fields from invoice documents.
Return ONLY a valid JSON object — no markdown, no explanation. Use null for any field not found.

Required JSON shape:
{
  "invoiceNumber": string | null,
  "periodStart": "YYYY-MM-DD" | null,
  "periodEnd": "YYYY-MM-DD" | null,
  "totalHours": number | null,
  "rate": number | null,
  "totalAmount": number | null,
  "currency": "USD" | "EUR" | "GBP" | "CAD" | "AUD" | "CHF" | ... | null,
  "paymentDetails": {
    "iban": string | null,
    "swift": string | null,
    "accountNumber": string | null,
    "sortCode": string | null,
    "routingNumber": string | null,
    "bankName": string | null,
    "companyName": string | null
  }
}

Rules:
- periodStart / periodEnd: the billing period (first and last day of the work period). If only a month is given (e.g. "April 2026"), use the first and last day of that month.
- totalHours: hours worked — a number (e.g. 160, 144.5). Ignore text like "h" or "hrs" suffix.
- rate: hourly rate as a plain number (e.g. 40, 35.50). Ignore currency symbols.
- totalAmount: total invoice amount as a plain number. Ignore currency symbols.
- currency: 3-letter ISO code only (USD, EUR, GBP, etc.).
- iban: full IBAN string, preserve spaces/formatting.
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
  * A date like "01/04/2026" for a Croatian contractor (HR IBAN) is April 1st, not January 4th.
  * Cross-check for logical consistency: these are monthly billing periods. If periodEnd is in month M of year Y, then periodStart must also be in month M (or possibly the last few days of month M-1). If your initial parse gives a start month wildly different from the end month (e.g. start=January, end=April) for a single-page invoice, you almost certainly have the date format wrong — flip DD and MM and re-derive.`;

const USER_PROMPT = 'Extract all invoice fields from this document:';

// ─── Text-based extraction (cheapest — for PDFs where text is available) ─────

async function extractFromText(text) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `${USER_PROMPT}\n\n${text}`,
    }],
  });

  return parseClaudeResponse(response);
}

// ─── Vision-based extraction (for image PDFs) ─────────────────────────────────

async function extractFromImages(imageBuffers) {
  // Build content array: prompt + one image block per page
  const content = [{ type: 'text', text: USER_PROMPT }];

  for (const buf of imageBuffers) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: buf.toString('base64'),
      },
    });
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  return parseClaudeResponse(response);
}

// ─── Parse and validate Claude's JSON response ────────────────────────────────

function parseClaudeResponse(response) {
  const raw = response.content[0]?.text?.trim() ?? '';

  // Strip accidental markdown code fences
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${raw.slice(0, 200)}`);
  }

  // Normalise: ensure paymentDetails exists
  if (!parsed.paymentDetails) parsed.paymentDetails = {};

  // Coerce numeric fields to numbers (Claude occasionally returns strings)
  for (const f of ['totalHours', 'rate', 'totalAmount']) {
    if (typeof parsed[f] === 'string') {
      const n = parseFloat(parsed[f].replace(/[^\d.\-]/g, ''));
      parsed[f] = isNaN(n) ? null : n;
    }
  }

  // Date consistency fix: contractor invoices cover one calendar month (~28–31 days).
  // If the extracted span is > 40 days, the start date likely has day/month swapped
  // (European DD/MM read as US MM/DD). Try swapping and accept if the new span ≤ 40 days.
  if (parsed.periodStart && parsed.periodEnd) {
    const start = new Date(parsed.periodStart);
    const end   = new Date(parsed.periodEnd);
    const spanDays = (end - start) / 86400000;

    if (spanDays > 40) {
      const [y, m, d] = parsed.periodStart.split('-');
      // Swap month and day components
      const swappedStr  = `${y}-${d.padStart(2, '0')}-${m.padStart(2, '0')}`;
      const swappedDate = new Date(swappedStr);
      const swappedSpan = (end - swappedDate) / 86400000;

      // Accept swap only if the result is a valid date, positive, and ≤ 40 days
      if (!isNaN(swappedDate) && swappedSpan >= 0 && swappedSpan <= 40) {
        parsed.periodStart = swappedStr;
      }
    }
  }

  return parsed;
}

// ─── Render PDF pages to PNG buffers (reuses pdfjs-dist + canvas) ─────────────

async function pdfToImages(pdfBuffer) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  const { createCanvas } = require('canvas');

  pdfjsLib.GlobalWorkerOptions.workerSrc = false;

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const images = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page     = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas   = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(canvas.toBuffer('image/png'));
  }

  return images;
}

// ─── DOCX extraction ──────────────────────────────────────────────────────────

async function extractFromDocx(buffer) {
  const mammoth = require('mammoth');
  const { value: text } = await mammoth.extractRawText({ buffer });
  return extractFromText(text);
}

// ─── MSG extraction ───────────────────────────────────────────────────────────

async function extractFromMsg(buffer) {
  const MsgReader = require('@kenjiuno/msgreader').default;
  const reader    = new MsgReader(buffer);
  const info      = reader.getFileData();

  // Prefer the email body text
  let text = info.body || info.bodyHtml?.replace(/<[^>]+>/g, ' ') || '';

  // Also include any PDF/DOCX attachments as text if present
  const pdfParse = require('pdf-parse');
  if (info.attachments?.length) {
    for (const att of info.attachments) {
      const attBuf = reader.getAttachment(att);
      if (!attBuf?.content) continue;
      const name = (att.fileName || '').toLowerCase();
      if (name.endsWith('.pdf')) {
        try {
          const { text: t } = await pdfParse(Buffer.from(attBuf.content));
          if (t?.trim().length > 20) text += '\n\n--- Attachment: ' + att.fileName + ' ---\n' + t;
        } catch (_) {}
      }
      if (name.endsWith('.docx')) {
        try {
          const mammoth = require('mammoth');
          const { value: t } = await mammoth.extractRawText({ buffer: Buffer.from(attBuf.content) });
          if (t?.trim().length > 20) text += '\n\n--- Attachment: ' + att.fileName + ' ---\n' + t;
        } catch (_) {}
      }
    }
  }

  return extractFromText(text);
}

module.exports = { extractFromText, extractFromImages, extractFromDocx, extractFromMsg, pdfToImages };
