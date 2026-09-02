// Vendor resolution for approval-time and push-time QB routing.
//
// The invoice.paymentProfile snapshot captures the payment_profile the
// accountant chose at ingest. The live payment_profiles row (identified by
// the snapshot's id field) is the source of truth for downstream QB routing.
//
// Rule (2026-08-27): the check is PER-PP, not across pps. If this specific
// payment_profile has never been explicitly mapped to a QB vendor (snapshot
// null AND live null), it holds for accountant confirmation — regardless
// of what sibling pps look like.
//
//   - Marta Sušek OBAI pp + IT STUFF pp — both already tagged to
//     "Native Team Ltd. - Marta Susek" → invoices using either resolve to
//     no-action.
//   - Marta hypothetical new pp 57 (untagged) → holds even though her
//     siblings agree, because pp 57 itself has never been confirmed.
//   - Tomislav Škoda pp 104 (Fat Struct, untagged) → holds despite pp 69
//     (Ponny) being tagged, because pp 104 itself has never been confirmed.
//   - Juran Dadić — his pps already have distinct vendors set → invoices
//     using either pp use its snapshot directly.
//
// No auto-inference across pps. Every FIRST use of an untagged pp opens
// the picker modal so the accountant explicitly maps it. Once mapped, the
// pp is tagged in the DB and future invoices with that pp are no-action.
//
// Contract:
//   'no-action'   snap pp (or its live row) already has qb_vendor_name.
//   'ambiguous'   snap pp has never been mapped; requires accountant decision.

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
  | { mode: 'ambiguous'; reason: string; targetPaymentProfileId: number | null; snapCompany: string | null; siblingHint?: string; conflictNames?: string[] };

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

  // Snap pp has never been mapped. Always ambiguous. We surface sibling
  // context (hint or conflict) so the picker modal can prefill or warn,
  // but we NEVER decide automatically. Every new pp requires explicit
  // accountant confirmation the first time it's used.
  const distinctNames = new Set(siblings.map(s => s.qbVendorName!.trim()));
  if (siblings.length === 0) {
    return {
      mode: 'ambiguous',
      reason: targetPp
        ? `Payment profile "${snapCompany ?? 'unnamed'}" has no QB vendor mapping and no other profile has one either — accountant must pick a QB vendor.`
        : 'Invoice snapshot has no payment profile id and no sibling profiles have a QB vendor mapping — accountant must pick a QB vendor.',
      targetPaymentProfileId: targetPpId,
      snapCompany,
    };
  }
  if (distinctNames.size > 1) {
    return {
      mode: 'ambiguous',
      reason: `Payment profile "${snapCompany ?? 'unnamed'}" has no QB vendor mapping. Sibling profiles map to different QB vendors (${[...distinctNames].join(', ')}) — accountant must pick which one applies, or map to a new vendor entirely.`,
      targetPaymentProfileId: targetPpId,
      snapCompany,
      conflictNames: [...distinctNames],
    };
  }
  const siblingHint = [...distinctNames][0];
  return {
    mode: 'ambiguous',
    reason: `Payment profile "${snapCompany ?? 'unnamed'}" has no QB vendor mapping. Sibling profiles are tagged to "${siblingHint}" but that isn't proof this new beneficiary belongs to the same vendor — accountant must confirm or pick a different vendor.`,
    targetPaymentProfileId: targetPpId,
    snapCompany,
    siblingHint,
  };
}

/**
 * Resolve the effective QB vendor NAME for an invoice using pp-scoped priority.
 *
 * Chain (first hit wins):
 *   1. snapshot.qbVendorName        — invoice.payment_profile JSONB snapshot
 *   2. LIVE pps[snap_pp_id].qb_vendor_name — snap was stale but the pp is tagged now
 *   3. LIVE default pp for the user — ONLY when snap_pp_id is absent (legacy invoices)
 *   4. LIVE any pp with non-empty qb_vendor_name — last resort for legacy invoices
 *
 * Critical: when snap_pp_id IS set but that specific pp has no vendor, this
 * returns null rather than falling through to the user-default pp. The snap
 * intentionally points at that pp — silently rerouting to a sibling's vendor
 * is the class of bug this exists to prevent (2026-09-02: Branimir OKTAXART
 * default masked TCODE pp; Tomislav Ponny default masked Fat Struct pp).
 */
export function resolveInvoiceQbVendorName(
  inv: ResolverInvoiceSnapshot,
  pps: ResolverPaymentProfile[],
): string | null {
  const snapName = inv.snapQbVendorName?.trim();
  if (snapName) return snapName;

  if (inv.snapPaymentProfileId != null) {
    const specific = pps.find(p => p.id === inv.snapPaymentProfileId);
    const name = specific?.qbVendorName?.trim();
    return name || null;
  }

  const userPps = pps.filter(p => p.userId === inv.userId);
  const defaultPp = userPps.find(p => p.isDefault && p.qbVendorName?.trim());
  if (defaultPp) return defaultPp.qbVendorName!.trim();
  const anyPp = userPps.find(p => p.qbVendorName?.trim());
  return anyPp?.qbVendorName?.trim() ?? null;
}

/**
 * Extract the payment_profile snapshot's pp_id from an invoice.payment_profile
 * JSONB blob. Handles number-typed id and numeric-string id (both observed in
 * production due to JSONB casting drift). Returns null when absent, zero, or
 * unparseable.
 */
export function extractSnapPpId(paymentProfile: unknown): number | null {
  if (!paymentProfile || typeof paymentProfile !== 'object') return null;
  const raw = (paymentProfile as { id?: unknown }).id;
  if (typeof raw === 'number' && raw > 0) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) > 0) return Number(raw);
  return null;
}
