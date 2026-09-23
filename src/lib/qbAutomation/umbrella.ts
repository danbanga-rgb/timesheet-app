// Umbrella detection for QB Automation v2.
//
// isUmbrellaEvent — the wire event's matched invoices span >1 distinct
// contractor (userId). Triggers group-row rendering in Ready + Preview
// so the accountant sees the full breakdown, not just matchedInvoiceIds[0].
// Fires for Teal, Bimosoft, Native Teams, and Faruk-covers-Ajdin wires
// once they land as events.
//
// Pre-wire umbrella grouping (approved invoices before the wire arrives)
// is handled directly in useQbAutomationV2 by grouping loose invoices
// on (qbVendorListId, monthKey). The old `isUmbrellaVendor` filter that
// hid umbrella-vendor slices from Ready pre-wire was scope creep and got
// deleted in V9.8 — Dan's model is "if it's approved and mapped, it's
// Ready."

interface EventLike {
  id: number;
  matchedInvoiceIds: number[];
}

interface InvoiceLike {
  userId: string | null;
}


// Union of matched_invoice_ids and umbrella-share-derived invoice IDs.
// The classifier's matched_invoice_ids can be a strict subset when the
// per-invoice matcher only found one contractor's invoice but the
// convera_transaction_invoices reconciler linked several. Group rendering
// and child-row building must reflect the full umbrella. Discovered
// 2026-09-23 on event 451 (Teal Jul wire — matched_invoice_ids=[227] but
// convera_transaction_invoices has 6 slices summing to $37,400).
export function getEffectiveMatchedInvoiceIds(
  event: EventLike,
  umbrellaShares?: Map<string, number>,
): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of event.matchedInvoiceIds) {
    if (!seen.has(id)) { seen.add(id); out.push(id); }
  }
  if (umbrellaShares) {
    const prefix = `${event.id}::`;
    for (const key of umbrellaShares.keys()) {
      if (key.startsWith(prefix)) {
        const invId = Number(key.slice(prefix.length));
        if (Number.isFinite(invId) && !seen.has(invId)) {
          seen.add(invId);
          out.push(invId);
        }
      }
    }
  }
  return out;
}

export function isUmbrellaEvent(
  event: EventLike,
  invoicesById: Map<number, InvoiceLike>,
  umbrellaShares?: Map<string, number>,
): boolean {
  const ids = getEffectiveMatchedInvoiceIds(event, umbrellaShares);
  if (ids.length <= 1) return false;
  const userIds = new Set<string>();
  for (const id of ids) {
    const inv = invoicesById.get(id);
    if (inv?.userId) userIds.add(inv.userId);
    if (userIds.size > 1) return true;
  }
  return false;
}

