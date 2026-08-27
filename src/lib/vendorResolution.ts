// Vendor resolution for approval-time and push-time QB routing.
//
// The invoice.paymentProfile snapshot captures the payment_profile the
// accountant chose at ingest. The live payment_profiles row (identified by
// the snapshot's id field) is the source of truth for downstream QB routing.
//
// When a contractor uses multiple beneficiaries (Marta Sušek — OBAI vs IT
// STUFF, both routing to "Native Team Ltd. - Marta Susek"), the accountant
// tags each pp with the same qb_vendor_name so bills post consistently to
// one QB vendor. When a contractor genuinely changes to a new entity
// (Tomislav Škoda — Ponny → Fat Struct d.o.o), the new pp is created without
// a qb_vendor_name until the accountant decides whether the new entity maps
// to an existing QB vendor or requires a fresh one.
//
// This resolver runs at APPROVAL TIME (fresh from DB) so the accountant hits
// the decision point in context. It runs again at push time via the QB
// Automation "Needs vendor decision" bucket to catch invoices whose pps
// changed after approval.
//
// Contract:
//   'no-action'   snap pp already has qb_vendor_name; nothing to fill in.
//   'auto'        snap pp is null; sibling pps unambiguously agree on ONE
//                 vendor name; safe to auto-fill (Marta pattern).
//   'ambiguous'   snap pp is null AND sibling pps disagree OR none have a
//                 vendor name; must be resolved manually via picker.

export interface ResolverPaymentProfile {
  id: number;
  userId: string;
  qbVendorName: string | null;
  companyName: string | null;
  isDefault: boolean | null;
}

export interface ResolverInvoiceSnapshot {
  /** From invoice.payment_profile JSONB snapshot. May be missing on legacy pre-2026 invoices. */
  snapPaymentProfileId: number | null;
  /** From invoice.payment_profile.qbVendorName snapshot. If set, resolver returns 'no-action'. */
  snapQbVendorName: string | null;
  /** invoice.user_id — used to find sibling pps. */
  userId: string;
}

export type ResolverResult =
  | { mode: 'no-action' }
  | { mode: 'auto'; vendorName: string; targetPaymentProfileId: number; snapCompany: string }
  | { mode: 'ambiguous'; reason: string; targetPaymentProfileId: number | null; snapCompany: string | null; conflictNames?: string[] };

/**
 * Resolve the QB vendor for an invoice at approval or push time.
 *
 * @param inv    Snapshot fields pulled from the invoice row.
 * @param pps    All payment_profiles rows for the invoice's user (fresh from DB).
 */
export function resolveNewProfileVendor(
  inv: ResolverInvoiceSnapshot,
  pps: ResolverPaymentProfile[],
): ResolverResult {
  // Case 0: snapshot already carries a vendor name. Trust it, no work needed.
  if (inv.snapQbVendorName && inv.snapQbVendorName.trim()) {
    return { mode: 'no-action' };
  }

  // Find the target pp (the one this invoice's payment snapshot points at).
  // Legacy invoices may not have snap_pp_id — treat as "no target known".
  const targetPp = inv.snapPaymentProfileId != null
    ? pps.find(p => p.id === inv.snapPaymentProfileId)
    : undefined;

  // Also case 0: target pp has a live qb_vendor_name (snapshot was stale but
  // the pp itself was tagged later). Trust the live value, no work needed.
  if (targetPp?.qbVendorName?.trim()) {
    return { mode: 'no-action' };
  }

  const snapCompany = targetPp?.companyName ?? null;
  const targetPpId = targetPp?.id ?? null;

  // Gather sibling pps for the same user with non-empty qb_vendor_name.
  const siblings = pps.filter(p =>
    p.userId === inv.userId
    && p.id !== targetPp?.id
    && p.qbVendorName
    && p.qbVendorName.trim().length > 0
  );

  if (siblings.length === 0) {
    // No signal at all — must be resolved manually.
    return {
      mode: 'ambiguous',
      reason: targetPp
        ? `Payment profile "${snapCompany ?? 'unnamed'}" has no QB vendor mapping and no other profile has one either — accountant must pick a QB vendor.`
        : 'Invoice snapshot has no payment profile id and no sibling profiles have a QB vendor mapping — accountant must pick a QB vendor.',
      targetPaymentProfileId: targetPpId,
      snapCompany,
    };
  }

  // Do the siblings agree on ONE vendor name?
  const distinctNames = new Set(siblings.map(s => s.qbVendorName!.trim()));
  if (distinctNames.size === 1) {
    const vendorName = [...distinctNames][0];
    // Auto-resolvable only if we know which target pp to update. Legacy
    // invoices without snap_pp_id can't be auto-updated because we don't
    // know which pp to write qb_vendor_name onto.
    if (targetPpId == null) {
      return {
        mode: 'ambiguous',
        reason: `Invoice snapshot has no payment profile id (legacy invoice) — accountant must pick a QB vendor even though sibling profiles agree on "${vendorName}".`,
        targetPaymentProfileId: null,
        snapCompany,
      };
    }
    return {
      mode: 'auto',
      vendorName,
      targetPaymentProfileId: targetPpId,
      snapCompany: snapCompany ?? '',
    };
  }

  // Conflicting signal — Juran-class.
  return {
    mode: 'ambiguous',
    reason: `Sibling payment profiles for this contractor map to different QB vendors (${[...distinctNames].join(', ')}). Accountant must pick which one applies to this invoice, or map to a different vendor entirely.`,
    targetPaymentProfileId: targetPpId,
    snapCompany,
    conflictNames: [...distinctNames],
  };
}
