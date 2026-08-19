// Intuit BillPay payment report parser.
//
// Parses the spreadsheet Intuit exports of payments they've sent on our behalf.
// NOT a QuickBooks export — column labels and layout are Intuit-specific.
// Output feeds qb_ingest_events (source='intuit_xlsx') as the source of truth
// for what Intuit paid; downstream slices classify and push corresponding
// entries into QuickBooks.
//
// Format notes (verified against 2026-08-19 sample):
//   - Column A is EMPTY on data rows (indentation for the vendor-grouping
//     structure). Section-header rows put the vendor name in A instead.
//     Data columns start at B:
//       B=Date, C=Transaction Type, D=Num, E=Name, F=Memo/Description,
//       G=Split, H=Amount, I=Balance
//   - Each payment appears TWICE — once viewed from each account (positive-
//     amount side has the memo; negative-amount side is the mirror). Dedupe
//     by taking positive-amount rows only.
//   - Memo carries "Inv# XXX" for single-invoice; "Inv# 03, 04" for multi-invoice.
//   - Section-header rows (vendor name in A) and "Total for X" rows separate
//     groups — skip.

import * as XLSX from 'xlsx';
import { excelDateToIso, sha256Hex } from './xlsxHelpers';

export interface IntuitXlsxRow {
  date: string;              // YYYY-MM-DD
  transactionType: string;   // 'Expense' | 'Bill Payment' | ...
  num: string;               // e.g. 'DD' (direct debit)
  name: string;              // vendor/counterparty as Intuit shows it
  memo: string;
  split: string;             // offsetting account name (e.g. 'Business Checking')
  amount: number;            // absolute value (positive)
  invoiceRefs: string[];     // parsed from memo (e.g. ['03', '04'] from 'Inv# 03, 04')
  matchedInvoiceIds: number[]; // populated by caller via matchQbIngestEvents
  sourceRef: string;         // sha256(date|type|num|name|memo|amount) — stable across re-imports
}

/** Extract invoice number refs from a memo cell.
 *  "Inv# 05"          → ["05"]
 *  "Inv# 03, 04"      → ["03", "04"]
 *  "Invoice Payment"  → []
 */
export function extractIntuitInvoiceRefs(memo: string): string[] {
  const m = memo.match(/Inv#\s+([^\s,][^,]*(?:,\s*[^,]+)*)/i);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}

/** Read a buffer of an Intuit BillPay payment report XLSX and yield one
 *  IntuitXlsxRow per payment. Filters out section headers, "Total" rows,
 *  and the negative-amount mirror rows via positive-amount dedup. */
export async function parseIntuitXlsxBuffer(buffer: ArrayBuffer): Promise<IntuitXlsxRow[]> {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number)[][];
  const out: IntuitXlsxRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    // Data columns are B..I (indices 1..8). Column A is empty on data rows.
    const date = excelDateToIso(r[1]);
    if (!date) continue;
    const amount = typeof r[7] === 'number' ? r[7] : parseFloat(String(r[7] ?? '0'));
    // Two-sides-of-split dedup: keep only the positive-amount row.
    if (!(amount > 0)) continue;
    const memo = String(r[5] ?? '').trim();
    const row: IntuitXlsxRow = {
      date,
      transactionType: String(r[2] ?? '').trim(),
      num: String(r[3] ?? '').trim(),
      name: String(r[4] ?? '').trim(),
      memo,
      split: String(r[6] ?? '').trim(),
      amount,
      invoiceRefs: extractIntuitInvoiceRefs(memo),
      matchedInvoiceIds: [],
      sourceRef: '',
    };
    row.sourceRef = await sha256Hex([row.date, row.transactionType, row.num, row.name, row.memo, String(row.amount)].join('|'));
    out.push(row);
  }
  if (out.length === 0) {
    const preview = raw.slice(0, 5).map(r => r.map(c => String(c ?? '').slice(0, 40)).join(' | ')).join('\n  ');
    throw new Error(`No payment rows found in the file (${raw.length} total rows scanned). Expected rows with a date in column B and a positive amount in column H. First rows saw:\n  ${preview}`);
  }
  return out;
}
