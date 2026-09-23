// Umbrella detection heuristics for QB Automation v2.
//
// Two independent signals:
//
//   isUmbrellaEvent — the wire event's matched invoices span >1 distinct
//     contractor (userId). Triggers group-row rendering in Ready + Preview
//     so the accountant sees the full breakdown, not just matchedInvoiceIds[0].
//     Fires for Teal, Bimosoft, Native Teams, and one-off cases like
//     "Faruk paying self + Ajdin."
//
//   isUmbrellaVendor — the QB vendor is referenced by >1 payment_profile in
//     `qb_vendor_mappings`. Triggers hiding invoice-driven "Will Create Bill"
//     rows whose vendor is umbrella (Teal): pre-creating a bill for a slice
//     before the wire lands is semantically wrong (QB books one Bill for the
//     wire total). Does NOT fire for Bimosoft/Native Teams per-contractor
//     vendors (each Bimosoft-<X> vendor is referenced by exactly one pp).

interface EventLike {
  id: number;
  matchedInvoiceIds: number[];
}

interface InvoiceLike {
  userId: string | null;
}

interface MappingLike {
  qbVendorListId: string;
  ppId: number | null;
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

export function buildUmbrellaVendorSet(mappings: MappingLike[]): Set<string> {
  const ppsByVendor = new Map<string, Set<number>>();
  for (const m of mappings) {
    if (m.ppId == null) continue;
    let set = ppsByVendor.get(m.qbVendorListId);
    if (!set) { set = new Set(); ppsByVendor.set(m.qbVendorListId, set); }
    set.add(m.ppId);
  }
  const umbrella = new Set<string>();
  for (const [vendor, pps] of ppsByVendor) {
    if (pps.size > 1) umbrella.add(vendor);
  }
  return umbrella;
}

export function isUmbrellaVendor(
  qbVendorListId: string | null,
  umbrellaVendors: Set<string>,
): boolean {
  if (!qbVendorListId) return false;
  return umbrellaVendors.has(qbVendorListId);
}
