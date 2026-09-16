import type { Invoice, PaymentProfile } from '../types';

// resolveLivePaymentProfile — recover the live payment profile that best
// matches an invoice's snapshot. The snapshot on `invoice.paymentProfile`
// can become stale (invoice may have been created before a profile was
// re-linked or before a new profile shipped), so consumers that need
// current banking / vendor / QB-mapping data walk this chain instead of
// trusting the snapshot alone.
//
// Lookup order:
//   1. snapshot pp.id → live profile with that id
//   2. snapshot pp.iban → live profile for same user with same iban
//   3. user's default profile
//   4. null (no profile findable)
//
// Extracted from two byte-identical copies inside `buildIifContent` and
// the QB Export modal as Slice I4 of the accountant modularization arc
// (2026-09-16).

export function resolveLivePaymentProfile(
  invoice: Invoice,
  paymentProfiles: PaymentProfile[],
): PaymentProfile | null {
  const pp = invoice.paymentProfile;
  if (!pp) return null;
  if (pp.id) {
    const byId = paymentProfiles.find(p => p.id === pp.id);
    if (byId) return byId;
  }
  if (pp.iban) {
    const byIban = paymentProfiles.find(p => p.userId === invoice.userId && p.iban === pp.iban);
    if (byIban) return byIban;
  }
  return paymentProfiles.find(p => p.userId === invoice.userId && p.isDefault) ?? null;
}
