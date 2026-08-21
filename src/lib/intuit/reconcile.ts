// ============================================================
// intuit/reconcile.ts — pure reconciler for Intuit ingest events.
//
// For each classified qb_ingest_event (kind + vendor resolved), consult the
// qb_mirror snapshot to decide the concrete write action:
//
//   already_done         — bill in mirror + matching payment in mirror
//                          → skip push, auto-close
//   pay_existing_bill    — bill in mirror, no matching payment
//                          → push bill_pmt_add against resolvedBillTxnId
//   create_bill_then_pay — nothing in mirror for (vendor, refNumber, amount)
//                          → push bill_add then bill_pmt_add (chained)
//   check                — event kind is 'check' (Case E: Lucien direct expense)
//                          → push check_add
//   held                 — vendor snapshot missing, or ambiguous match
//                          → surface in UI, don't push
//
// Batch variant uses CLAIM RESERVATION: a snapshot bill/payment can be
// consumed by only ONE event. Fixes the "same INV 12 matched to two events"
// class of matcher over-match by disambiguating at the QB-side truth layer.
// ============================================================

export type QbResolvedAction =
  | 'already_done'
  | 'pay_existing_bill'
  | 'create_bill_then_pay'
  | 'check'
  | 'held'
  | 'pre_our_system';   // Slice G4d: predates cutoff; QB handled manually, we skip

export type QbIngestKind = 'bill_pmt' | 'bill_add_and_pmt' | 'check' | 'ignore';

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface ReconcilableEvent {
  id: number;
  counterpartyRaw: string;
  memo: string | null;                 // "Inv# 12" or "Inv# 03, 04" etc.
  amount: number;
  txnDate: string;                     // YYYY-MM-DD
  counterpartyQbVendorListId: string | null;
  targetQbTxnKind: QbIngestKind | null;
  matchedInvoiceIds: number[];         // for advisory display; not used by matcher
  status: 'pending' | 'ready' | 'queued' | 'posted' | 'failed' | 'ignored';
}

export interface MirrorBill {
  txnId: string;
  vendorListId: string;
  refNumber: string;
  amount: number;
  isPaid: boolean;
  txnDate: string | null;
}

export interface MirrorPayment {
  txnId: string;
  vendorListId: string;
  amount: number;
  txnDate: string | null;
  appliedToBills: Array<{ billTxnId: string; amount: number }>;
}

export interface ReconcileContext {
  billsByVendor: Map<string, MirrorBill[]>;
  paymentsByVendor: Map<string, MirrorPayment[]>;
  /** ISO date. Events with txn_date < cutoff → action='pre_our_system' and skip.
   *  Undefined = no cutoff applied. Per-source config lives outside this pure
   *  module (see src/lib/intuit/config.ts for the Intuit value). */
  preOurSystemCutoff?: string;
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  action: QbResolvedAction;
  billTxnId?: string;
  paymentTxnId?: string;
  reason?: string;         // for `held` — human-readable
}

// ─── refNumber normalization ─────────────────────────────────────────────────

/**
 * Canonicalize a refNumber for cross-source matching. QB stores "INV 12" or
 * "INV-000046"; Intuit memo says "Inv# 12" or "In# INV 000046"; contractors
 * use "Inv#12", "INV#12", etc.
 * Rule: uppercase, strip stacked leading "INV" runs plus any of #/space/hyphen
 * between them, then any leading "#". Handles the doubled-prefix case where a
 * QB bill ref is literally "INV-000046" (strip "INV" once → "-000046" would
 * fail to match memo "INV 000046" → "000046"; the stacked strip fixes this).
 */
export function normalizeRef(raw: string | null): string {
  if (!raw) return '';
  let s = raw.toUpperCase().trim();
  // Repeated group so "INV# INV-000046" strips both INV runs → "000046".
  s = s.replace(/^(INV[\s#\-]*)+/, '').replace(/^#\s*/, '');
  return s.trim();
}

/**
 * Extract all invoice refs from an event memo. Handles "Inv# 12", "Inv# 03, 04",
 * "INV#12 INV#13", "Inv# INV-000046" (Hover-style stacked prefix), etc.
 * Returns normalized forms.
 */
export function extractRefsFromMemo(memo: string | null): string[] {
  if (!memo) return [];
  const out = new Set<string>();
  // [\s#\-]* allows the INV prefix to be followed by any of space/hash/hyphen
  // before the capture group, so patterns like "INV-000046" (no space) match.
  const rex = /INV[\s#\-]*([A-Z0-9][A-Z0-9\-/.]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = rex.exec(memo)) !== null) {
    const ref = normalizeRef(m[0]);
    if (ref) out.add(ref);
  }
  return Array.from(out);
}

// ─── Match scoring ───────────────────────────────────────────────────────────

/**
 * Score how well an event matches a snapshot bill. Higher = better.
 * Only bills of the SAME vendor should be scored (caller pre-filters).
 * Returns null for zero match (amount off by >5% AND ref doesn't match).
 */
export function scoreBillMatch(
  eventRefs: string[],
  eventAmount: number,
  eventDate: string,
  bill: MirrorBill,
): number | null {
  const billRef = normalizeRef(bill.refNumber);
  const refHit = eventRefs.includes(billRef);
  const amountExact = Math.abs(bill.amount - eventAmount) < 0.01;
  const amountClose = Math.abs(bill.amount - eventAmount) / Math.max(bill.amount, eventAmount) < 0.01;
  // Date proximity in days (unbounded → less weight; primarily as tiebreak)
  const daysApart = bill.txnDate
    ? Math.abs((Date.parse(eventDate) - Date.parse(bill.txnDate)) / 86_400_000)
    : Infinity;
  const dateBonus = daysApart < 60 ? Math.max(0, 30 - daysApart) : 0;

  let score = 0;
  if (refHit) score += 100;
  if (amountExact) score += 50; else if (amountClose) score += 30;
  score += dateBonus;
  // Require SOMETHING (ref or amount within 5%) to consider it a match.
  const amountWithinTolerance = Math.abs(bill.amount - eventAmount) / Math.max(bill.amount, eventAmount) < 0.05;
  if (!refHit && !amountWithinTolerance) return null;
  return score;
}

// ─── Payment matching ────────────────────────────────────────────────────────

/**
 * Given a matched bill, decide if any snapshot payment ALREADY settled it.
 * Returns the payment TxnID if so.
 *
 * Preferred signal: payment.appliedToBills contains billTxnId (present when
 * bill_pmt_query used IncludeLineItems=true).
 * Fallback: bill.isPaid === true (we know it's settled but not by which payment).
 */
export function findSettlingPayment(
  bill: MirrorBill,
  paymentsForVendor: MirrorPayment[],
): { paymentTxnId?: string; alreadySettled: boolean } {
  // Explicit link via appliedToBills
  for (const p of paymentsForVendor) {
    if (p.appliedToBills.some(a => a.billTxnId === bill.txnId)) {
      return { paymentTxnId: p.txnId, alreadySettled: true };
    }
  }
  // Fallback — bill is paid but we don't know which payment
  if (bill.isPaid) return { alreadySettled: true };
  return { alreadySettled: false };
}

// ─── Per-event reconcile (used by batch with reservation) ────────────────────

export function reconcileEvent(
  event: ReconcilableEvent,
  ctx: ReconcileContext,
  claimedBillTxnIds: Set<string>,   // bills already reserved by another event in this batch
): ReconciliationResult {
  // Pre-our-system cutoff (Slice G4d) — mirrors [[matcher-ignore]] pattern.
  // Skip terminal-outcome reconciliation for events QB already handled before
  // we came online. Runs BEFORE vendor/kind guardrails because the cutoff
  // decision doesn't depend on whether we've classified the counterparty.
  if (ctx.preOurSystemCutoff && event.txnDate < ctx.preOurSystemCutoff) {
    return { action: 'pre_our_system', reason: `txn_date < ${ctx.preOurSystemCutoff}` };
  }

  // Guardrails: unresolved kind/vendor → held
  if (!event.counterpartyQbVendorListId) {
    return { action: 'held', reason: 'no QB vendor mapped' };
  }
  if (event.targetQbTxnKind === 'ignore') {
    return { action: 'held', reason: 'kind=ignore (not reconcilable)' };
  }

  // Check kind (Lucien-style direct expense) — no bill matching
  if (event.targetQbTxnKind === 'check') {
    return { action: 'check' };
  }

  const bills = ctx.billsByVendor.get(event.counterpartyQbVendorListId) ?? [];
  const payments = ctx.paymentsByVendor.get(event.counterpartyQbVendorListId) ?? [];
  const eventRefs = extractRefsFromMemo(event.memo);

  // If vendor is entirely missing from mirror, we don't yet know QB state → held.
  // (Reconciler assumes an empty bills[] means "confirmed vendor has no bills",
  // not "vendor not synced." Callers must ensure a sync has completed before
  // treating empty as authoritative.)
  //
  // Detection heuristic: if we have ZERO bills AND ZERO payments for the vendor,
  // we're uncertain. Prefer 'held' with a nudge to sync.
  if (bills.length === 0 && payments.length === 0) {
    return { action: 'held', reason: 'vendor not synced (no QB state for this vendor)' };
  }

  // Score all bills; pick best unclaimed. For terminal-state actions
  // (already_done, pay_existing_bill) we REQUIRE a refNumber match — amount-only
  // matches are too weak and produced silently wrong assignments when mirror
  // was partially seeded (bug surfaced 2026-08-20). Amount-only matches fall
  // through to create_bill_then_pay, which is the safe fallback.
  const scored = bills
    .filter(b => !claimedBillTxnIds.has(b.txnId))
    .map(b => ({
      bill: b,
      score: scoreBillMatch(eventRefs, event.amount, event.txnDate, b),
      refHit: eventRefs.includes(normalizeRef(b.refNumber)),
    }))
    .filter(x => x.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Restrict "already_done" / "pay_existing_bill" to bills where the event
  // memo's ref actually matches. Otherwise we'd loose-match by amount and
  // claim the wrong bill.
  const refMatch = scored.find(s => s.refHit);
  if (!refMatch) {
    return { action: 'create_bill_then_pay' };
  }

  const best = refMatch.bill;
  const settlement = findSettlingPayment(best, payments);

  if (settlement.alreadySettled) {
    return {
      action: 'already_done',
      billTxnId: best.txnId,
      ...(settlement.paymentTxnId ? { paymentTxnId: settlement.paymentTxnId } : {}),
    };
  }

  return { action: 'pay_existing_bill', billTxnId: best.txnId };
}

// ─── Batch reconcile with claim reservation ──────────────────────────────────

/**
 * Reconcile a batch of events. Each bill in the snapshot can be claimed by
 * at most ONE event — subsequent events for the same vendor+ref get pushed
 * to `create_bill_then_pay` (they'll get their own new bill) or `held` if
 * their amount doesn't match anything unclaimed.
 *
 * Processing order matters for reservation: sort events by (vendor, then
 * best-match strength descending) so the strongest matches claim first.
 * Simplified here: process in txnDate order for stable behavior.
 */
export function reconcileBatch(
  events: ReconcilableEvent[],
  ctx: ReconcileContext,
): Array<{ event: ReconcilableEvent; result: ReconciliationResult }> {
  const claimed = new Set<string>();
  // Sort chronologically so older events get first crack at matching bills.
  const sorted = [...events].sort((a, b) => a.txnDate.localeCompare(b.txnDate));
  const results: Array<{ event: ReconcilableEvent; result: ReconciliationResult }> = [];
  for (const e of sorted) {
    const r = reconcileEvent(e, ctx, claimed);
    if (r.billTxnId) claimed.add(r.billTxnId);
    results.push({ event: e, result: r });
  }
  return results;
}
