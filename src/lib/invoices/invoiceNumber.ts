// Invoice-number uniqueness per contractor.
//
// QuickBooks identifies a bill by (vendor, RefNumber) and we push the invoice
// number as the RefNumber, so two invoices from the same contractor must never
// share a number. 2026-09-25: four contractors reused last month's number
// (Izet INV 20260801, Nikolina INV 1-1-11, Mensur INV 01/07/2026, Stefan
// INV 32). The later invoice inherited the earlier month's QB bill, its own
// bill was never created, and one wire was closed against an already-paid bill.
//
// Rule (Dan): a duplicate is caught at approval and must be renamed; suggest
// "-1" (then "-2", ...).

export interface InvoiceNumberRow {
  id: number;
  userId: string | null;
  invoiceNumber: string | null;
  status: string;
  periodEnd?: string | null;
}

/** Case/whitespace-insensitive comparison key. */
export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Other non-rejected invoices of the same contractor that use `invoiceNumber`. */
export function findSameNumberInvoices<T extends InvoiceNumberRow>(
  target: { id: number; userId: string | null; invoiceNumber: string | null },
  all: readonly T[],
): T[] {
  const key = normalizeInvoiceNumber(target.invoiceNumber);
  if (!key || !target.userId) return [];
  return all.filter(o =>
    o.id !== target.id
    && o.userId === target.userId
    && o.status !== 'rejected'
    && normalizeInvoiceNumber(o.invoiceNumber) === key,
  );
}

/** First of `<num>-1`, `<num>-2`, ... not already in `taken`. */
export function suggestUniqueInvoiceNumber(invoiceNumber: string, taken: Iterable<string | null | undefined>): string {
  const base = invoiceNumber.trim();
  const used = new Set(Array.from(taken, t => normalizeInvoiceNumber(t)));
  for (let n = 1; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(normalizeInvoiceNumber(candidate))) return candidate;
  }
}
