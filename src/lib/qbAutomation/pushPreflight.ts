// Push preflight — "would the push refuse this row?"
//
// Ready must never show Will Pay / Will Create for a row the push consumers
// would refuse. 2026-09-25: Bimosoft (wire covers 2 invoices, only 1 linked →
// amount mismatch), Izet / Mensur / Stefan (invoice number reused, last month's
// QB bill copied onto the new invoice) all looked pushable and were not.
//
// These checks mirror the refusals in src/lib/qbWrite/consumers/*
// (converaBillPmt C-1, converaInvoiceCreateBill G7.6, intuitInvoiceCreateBill
// G7.5) plus the invoice-number uniqueness rule. Pure: no DB access. If a
// consumer gains a new refusal, add it here too.

import { findSameNumberInvoices, type InvoiceNumberRow } from '../invoices/invoiceNumber';
import { CONVERA_PRE_OUR_SYSTEM_CUTOFF } from '../convera/config';
import { INTUIT_PRE_OUR_SYSTEM_CUTOFF } from '../intuit/config';

export interface PreflightInvoice extends InvoiceNumberRow {
  totalAmount: number;
  qbBillTxnId: string | null;
  paymentMethodOverride: string | null;
  matcherIgnore?: boolean;
  /** Multi-contractor invoice group (e.g. Teal): members intentionally share ONE QB bill. */
  groupKey?: string | null;
}

export interface PreflightBill {
  txnId: string;
  vendorListId: string;
  refNumber: string;
  isPaid: boolean;
}

export interface PreflightContext {
  allInvoices: readonly PreflightInvoice[];
  billsByTxnId: ReadonlyMap<string, PreflightBill>;
  bills: readonly PreflightBill[];
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function reusedNumberReason(inv: PreflightInvoice, ctx: PreflightContext): string | null {
  const dupes = findSameNumberInvoices(inv, ctx.allInvoices);
  if (dupes.length === 0) return null;
  return `Invoice number "${inv.invoiceNumber}" is also used on this contractor's invoice #${dupes[0].id}. Rename one (add "-1") so each has its own QB bill.`;
}

// One QB bill on several invoices is correct for a multi-contractor group
// (Teal: 6 contractors, one group_key, one combined bill). It is wrong when the
// same contractor holds it twice (reused invoice number) or when unrelated
// invoices share it.
function sharedBillReason(inv: PreflightInvoice, ctx: PreflightContext): string | null {
  if (!inv.qbBillTxnId) return null;
  const other = ctx.allInvoices.find(o =>
    o.id !== inv.id
    && o.qbBillTxnId === inv.qbBillTxnId
    && (o.userId === inv.userId || !inv.groupKey || o.groupKey !== inv.groupKey));
  return other ? `QB bill ${inv.qbBillTxnId} is also linked to invoice #${other.id}.` : null;
}

/** Convera wire (bill_pmt). Mirrors routing in TS.tsx onPushRows + converaBillPmt (C-1). */
export function converaWirePreflight(
  event: { amount: number; matchedInvoiceIds: number[] },
  linkedInvoiceIds: readonly number[],          // convera_transaction_invoices for this wire (umbrella links)
  shareByInvoiceId: ReadonlyMap<number, number>,
  ctx: PreflightContext,
): string | null {
  const byId = new Map(ctx.allInvoices.map(i => [i.id, i]));
  const matched = event.matchedInvoiceIds.map(id => byId.get(id)).filter((i): i is PreflightInvoice => !!i);

  for (const inv of matched) {
    const r = reusedNumberReason(inv, ctx) ?? sharedBillReason(inv, ctx);
    if (r) return r;
  }

  const unlinked = linkedInvoiceIds.filter(id => !event.matchedInvoiceIds.includes(id));
  if (unlinked.length > 0) {
    return `This wire covers ${linkedInvoiceIds.length} invoices but only ${event.matchedInvoiceIds.length} is matched to it, so the push would stop on an amount mismatch.`;
  }

  // C-1 route: exactly one matched invoice that already has a QB bill.
  if (matched.length === 1 && matched[0].qbBillTxnId) {
    const inv = matched[0];
    const bill = ctx.billsByTxnId.get(inv.qbBillTxnId!);
    if (!bill) return `QB bill ${inv.qbBillTxnId} isn't in the QB Mirror yet. Sync Now, then retry.`;
    if (bill.isPaid) return `The linked QB bill ${inv.qbBillTxnId} is already paid. Pushing would pay it twice.`;
    const expected = shareByInvoiceId.get(inv.id) ?? inv.totalAmount;
    if (Math.abs(expected - event.amount) > 0.01) {
      return `Wire ${fmtUsd(event.amount)} doesn't match invoice #${inv.id} (${fmtUsd(expected)}).`;
    }
  }
  return null;
}

/** Invoice → Bill (G7.5 Intuit / G7.6 Convera). Mirrors the consumers' eligibility + mirror idempotency. */
export function invoiceCreateBillPreflight(
  members: readonly PreflightInvoice[],
  method: string,                               // effective method used by the router
  vendorListId: string | null,
  ctx: PreflightContext,
): string | null {
  if (method !== 'Intuit' && method !== 'Convera') return 'No payment method (Intuit or Convera) on this invoice.';
  const cutoff = method === 'Intuit' ? INTUIT_PRE_OUR_SYSTEM_CUTOFF : CONVERA_PRE_OUR_SYSTEM_CUTOFF;
  for (const inv of members) {
    const r = reusedNumberReason(inv, ctx);
    if (r) return r;
    if (inv.qbBillTxnId) {
      return sharedBillReason(inv, ctx)
        ?? `Invoice #${inv.id} is already linked to QB bill ${inv.qbBillTxnId}.`;
    }
    if (inv.matcherIgnore) return `Invoice #${inv.id} is pre-system history and is never pushed.`;
    if (inv.paymentMethodOverride !== method) return `Payment method isn't saved on invoice #${inv.id}. Open it and set ${method}.`;
    if (!inv.periodEnd || inv.periodEnd < cutoff) return `Invoice #${inv.id} is before the ${method} cutoff (${cutoff}).`;
    if (!inv.invoiceNumber?.trim()) return `Invoice #${inv.id} has no invoice number.`;
    if (vendorListId) {
      const want = inv.invoiceNumber.trim();
      if (ctx.bills.some(b => b.vendorListId === vendorListId && b.refNumber === want)) {
        return `QB already has a bill "${want}" for this vendor.`;
      }
    }
  }
  return null;
}
