import type { Invoice } from '../../types';
import { formatDate } from '../dates';

// Convera batch payment file (CSV) — uploaded to Convera GlobalPay portal to
// initiate a batch. The behavior locks here are Ale's format contract from
// 2026-07-11 plus the CRLF/BOM constraints learned by comparing our rejected
// file to their working file 2026-07-15. Any drift breaks money movement.

export type InvoiceWithIban = { inv: Invoice; iban: string };

export type ConveraBatchGroup = {
  key: string;                  // benef.id.toString()
  vendorId: string;
  shortName: string;
  fullName: string;
  entries: InvoiceWithIban[];
  distinctIbans: number;
  anyIndia: boolean;
};

export type ConveraBatchManualRow = {
  id: string;
  beneficiaryId: number;
  shortName: string;
  vendorId: string;
  country: string;
  amount: number;
  ref1: string;
};

export type ConveraBatchOutRow = {
  vendorId: string;
  beneName: string;
  amount: number;
  ref1: string;
  ref2: string;
};

export const CONVERA_INDIA_REF2 = 'PURPOSE OF FUNDS P0802';
export const CONVERA_MULTI_INVOICE_REF1 = 'Multiple Invoices';
export const CONVERA_BENENAME_MAX = 100;
export const CONVERA_REF1_MAX = 100;
export const CONVERA_POP = 'Trade Related';
export const CONVERA_CSV_HEADER = 'VendorID,BeneName,TargetAmount,Ref1,Ref2,POP';

export function csvEscape(v: string): string {
  return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Convera integers for whole dollars, .XX only for real cents (their parser
// rejects trailing ".00" on some file variants).
export function fmtConveraAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// Build the CSV row list from groups + combine choices + manual rows.
// Ref1 rules:
//   - Non-combined group: one row per entry, ref1 = invoice.invoiceNumber (100-char cap)
//   - Combined group with single distinct invoice_number → that shared number (TEAL umbrella)
//   - Combined group with N distinct invoice_numbers → 'Multiple Invoices'
// Ref2 rules:
//   - Group with any India entry → 'PURPOSE OF FUNDS P0802'
//   - Manual row with country === 'India' → same
export function buildConveraBatchRows(
  groups: ConveraBatchGroup[],
  combineChoices: Record<string, boolean>,
  manualRows: ConveraBatchManualRow[],
): ConveraBatchOutRow[] {
  const out: ConveraBatchOutRow[] = [];

  for (const g of groups) {
    const combined = g.entries.length > 1 && !!combineChoices[g.key];
    const beneName = (g.shortName || g.fullName).slice(0, CONVERA_BENENAME_MAX);
    const ref2 = g.anyIndia ? CONVERA_INDIA_REF2 : '';
    if (combined) {
      const amount = g.entries.reduce((s, e) => s + e.inv.totalAmount, 0);
      const distinctInvNums = new Set(g.entries.map(e => e.inv.invoiceNumber));
      const ref1 = distinctInvNums.size === 1
        ? [...distinctInvNums][0].slice(0, CONVERA_REF1_MAX)
        : CONVERA_MULTI_INVOICE_REF1;
      out.push({ vendorId: g.vendorId, beneName, amount, ref1, ref2 });
    } else {
      for (const e of g.entries) {
        out.push({
          vendorId: g.vendorId,
          beneName,
          amount: e.inv.totalAmount,
          ref1: e.inv.invoiceNumber.slice(0, CONVERA_REF1_MAX),
          ref2,
        });
      }
    }
  }

  for (const r of manualRows) {
    out.push({
      vendorId: r.vendorId,
      beneName: r.shortName.slice(0, CONVERA_BENENAME_MAX),
      amount: r.amount,
      ref1: r.ref1.slice(0, CONVERA_REF1_MAX),
      ref2: r.country === 'India' ? CONVERA_INDIA_REF2 : '',
    });
  }

  return out;
}

// Convera CSV format contract (2026-07-15 correction after their parser rejected
// our first file):
//   - CRLF line endings (\r\n) — LF-only is rejected
//   - No trailing newline
//   - No UTF-8 BOM
//   - TargetAmount: integer for whole dollars, .XX only for cents (fmtConveraAmount)
//   - POP hardcoded 'Trade Related' for all contractor payments
export function buildConveraBatchCsv(rows: ConveraBatchOutRow[]): string {
  const lines = [CONVERA_CSV_HEADER];
  for (const r of rows) {
    lines.push([
      csvEscape(r.vendorId),
      csvEscape(r.beneName),
      fmtConveraAmount(r.amount),
      csvEscape(r.ref1),
      csvEscape(r.ref2),
      csvEscape(CONVERA_POP),
    ].join(','));
  }
  return lines.join('\r\n');
}

// Filename date = most-common pay_on_date across all invoices in the batch.
// Falls back to today when no invoice has a pay_on_date set.
export function computeConveraBatchFilename(invoices: Invoice[]): string {
  const dates = invoices.map(i => i.payOnDate).filter((d): d is string => !!d);
  const counts: Record<string, number> = {};
  for (const d of dates) counts[d] = (counts[d] || 0) + 1;
  const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return (mostCommon || formatDate(new Date())).replace(/-/g, '');
}
