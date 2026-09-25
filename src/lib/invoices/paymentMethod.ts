// Effective payment method for an invoice: 'Intuit' | 'Convera' | ''.
//
// Lifted verbatim from TimesheetSystem.tsx so the V2 Source column and the
// push router use ONE rule. Order:
//   1. the invoice's own saved payment_method (accountant override)
//   2. the accountant's most recent explicit choice for this contractor
//   3. location_type invariant: offshore → Convera, onshore → Intuit
//      (never country — see [[offshore-100-convera]] / profile.country trap)

export interface PaymentMethodInvoice {
  id: number;
  userId: string;
  paymentMethodOverride: string | null;
}

export interface PaymentMethodUser {
  id: string;
  locationType?: string | null;
}

/** Older data has lowercase 'intuit'/'convera'; canonicalise so === matches. */
export function canonicalPaymentMethod(raw: string | null | undefined): string {
  if (!raw) return '';
  const lc = raw.toLowerCase();
  if (lc === 'intuit') return 'Intuit';
  if (lc === 'convera') return 'Convera';
  return raw;
}

export function resolvePaymentMethod(
  inv: PaymentMethodInvoice,
  invoices: readonly PaymentMethodInvoice[],
  users: readonly PaymentMethodUser[],
): string {
  const own = canonicalPaymentMethod(inv.paymentMethodOverride);
  if (own) return own;
  const prior = invoices
    .filter(i => i.userId === inv.userId && i.id !== inv.id && i.paymentMethodOverride)
    .sort((a, b) => b.id - a.id)[0];
  if (prior) return canonicalPaymentMethod(prior.paymentMethodOverride);
  const contractor = users.find(u => u.id === inv.userId);
  if (contractor?.locationType === 'offshore') return 'Convera';
  if (contractor?.locationType === 'onshore') return 'Intuit';
  return '';
}
