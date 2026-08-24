// Provenance classifier for qb_ingest_events.matched_invoice_ids.
//
// One invariant, applied consistently across reconciler, push consumer, and UI:
// every non-empty matched_invoice_ids value must be classifiable into one of
// four provenance buckets, and per-action gates in downstream code refuse to
// act on weak-provenance links.
//
//   exact-txn  — event.resolved_bill_txn_id matches an invoice's qb_bill_txn_id.
//                Deterministic 1:1 link. Overrides whatever the matcher produced.
//   exact-ref  — the event memo names (by invoice number) at least one of the
//                matched invoices. Semantic match with INV-prefix stripped so
//                "Inv# 12" ↔ "INV 12" ↔ "12" all agree.
//   fuzzy      — matched invoice(s) exist but memo doesn't name any of them
//                (matcher chose by vendor+amount or subset-sum).
//   empty      — no matched invoice, or event has no invoice concept
//                (targetQbTxnKind='check' or 'ignore').

import { normalizeRef } from './intuit/reconcile';

export type MatchProvenance = 'exact-txn' | 'exact-ref' | 'fuzzy' | 'empty';

export interface ProvenanceInput {
  /** From qb_ingest_events.resolved_bill_txn_id. Null when reconciler hasn't
   *  resolved a QB bill for this event yet (or when we're creating the bill). */
  eventResolvedBillTxnId: string | null;
  /** Current matched_invoice_ids on the event. */
  matchedInvoiceIds: number[];
  /** True if the event's memo names at least one of the matched invoices by
   *  invoice_number (INV-prefix-agnostic). Compute via memoNamesMatchedInvoice()
   *  below or equivalent. */
  memoNamesMatchedInvoice: boolean;
  /** From qb_ingest_events.target_qb_txn_kind. When 'check' or 'ignore', the
   *  event has no invoice concept and provenance is always 'empty'. */
  targetQbTxnKind?: string | null;
  /** Map of invoices.qb_bill_txn_id → invoices.id, filtered to
   *  matcher_ignore=false. Used for the exact-txn deterministic lookup. */
  invoiceIdByBillTxnId: Map<string, number>;
}

export interface ProvenanceResult {
  provenance: MatchProvenance;
  /** Set only when provenance='exact-txn'. Callers should force
   *  matched_invoice_ids = [authoritativeInvoiceId], overriding whatever the
   *  matcher produced. */
  authoritativeInvoiceId?: number;
}

export function computeMatchProvenance(input: ProvenanceInput): ProvenanceResult {
  if (input.eventResolvedBillTxnId) {
    const invId = input.invoiceIdByBillTxnId.get(input.eventResolvedBillTxnId);
    if (invId != null) {
      return { provenance: 'exact-txn', authoritativeInvoiceId: invId };
    }
  }
  if (input.targetQbTxnKind === 'check' || input.targetQbTxnKind === 'ignore') {
    return { provenance: 'empty' };
  }
  if (input.matchedInvoiceIds.length > 0) {
    return { provenance: input.memoNamesMatchedInvoice ? 'exact-ref' : 'fuzzy' };
  }
  return { provenance: 'empty' };
}

/** Does the event memo (as parsed refs, or the raw memo text) name at least
 *  one of the matched invoices by invoice_number? Applies INV-prefix-agnostic
 *  normalization to both sides so "Inv# 12", "INV 12", "12", "INV-000046",
 *  "000046" all agree with each other appropriately.
 *
 *  memoRefs: pass the already-parsed refs from raw_data.invoice_refs OR the
 *  raw memo text — either works; each item is normalized via normalizeRef
 *  which strips INV#/dash runs, uppercases, etc. */
export function memoNamesMatchedInvoice(
  memoRefs: string[],
  matchedInvoices: Array<{ invoiceNumber: string | null }>,
): boolean {
  if (memoRefs.length === 0 || matchedInvoices.length === 0) return false;
  const refSet = new Set(memoRefs.filter(Boolean).map(normalizeRef));
  return matchedInvoices.some(
    inv => inv.invoiceNumber != null && refSet.has(normalizeRef(inv.invoiceNumber)),
  );
}
