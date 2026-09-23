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
  matchedInvoiceIds: number[];
}

interface InvoiceLike {
  userId: string | null;
}

interface MappingLike {
  qbVendorListId: string;
  ppId: number | null;
}

export function isUmbrellaEvent(
  event: EventLike,
  invoicesById: Map<number, InvoiceLike>,
): boolean {
  if (event.matchedInvoiceIds.length <= 1) return false;
  const userIds = new Set<string>();
  for (const id of event.matchedInvoiceIds) {
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
