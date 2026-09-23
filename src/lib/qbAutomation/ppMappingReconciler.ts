// Self-healing reconciler for payment_profiles → qb_vendor_mappings.
//
// Detects pps that already have `qb_vendor_name` set to a name matching an
// existing qb_vendors row but no `qb_vendor_mappings` row. These pps are
// otherwise fully wired up on the app side (contractor has a QB vendor
// picked in the Payment Profiles tab) but v2's Ready view can't route
// them because the mapping row is what the classifier + hook read.
//
// Discovered 2026-09-23 when 9 approved invoices were invisible in v2
// Ready (Harun, Fadil, Naretena, Edin, Iskra, Anela, Amar, Edo,
// Himavath). All had qb_vendor_name set but no mapping row.
//
// Called from `loadQbVendorMappings` in TS.tsx — runs on every v2 load,
// picks up any newly-created pp within one refresh cycle. Retroactive +
// prospective in one path.

interface PaymentProfileLike {
  id: number;
  qbVendorName: string | null;
  companyName: string | null;
}

interface MappingLike {
  ppId: number | null;
}

interface VendorLike {
  listId: string;
  name: string;
}

export interface MissingMappingInsert {
  pp_id: number;
  source: string;
  counterparty_pattern: string;
  qb_vendor_list_id: string;
  default_target_kind: string;
  default_bank_account_list_id: string;
  default_expense_account_list_id: string;
}

// Defaults match the classifier's Pass 2 seed (see classifyQbIngestEvent.ts).
// Bank = 8220 Key Point Checking, expense = Vendor Consultants
// (600000-1142369998) per [[qb-expense-account-conventions]].
const DEFAULT_BANK_ACCOUNT_LIST_ID = '800000F5-1529957073';
const DEFAULT_EXPENSE_ACCOUNT_LIST_ID = '600000-1142369998';

export function computeMissingPpMappings(input: {
  paymentProfiles: PaymentProfileLike[];
  mappings: MappingLike[];
  vendors: VendorLike[];
}): MissingMappingInsert[] {
  const mappedPpIds = new Set<number>();
  for (const m of input.mappings) {
    if (m.ppId != null) mappedPpIds.add(m.ppId);
  }
  const vendorByLowerName = new Map<string, VendorLike>();
  for (const v of input.vendors) {
    vendorByLowerName.set(v.name.toLowerCase().trim(), v);
  }
  const inserts: MissingMappingInsert[] = [];
  for (const pp of input.paymentProfiles) {
    if (mappedPpIds.has(pp.id)) continue;
    const name = (pp.qbVendorName || '').trim();
    if (!name) continue;
    const v = vendorByLowerName.get(name.toLowerCase());
    if (!v) continue;
    inserts.push({
      pp_id: pp.id,
      source: 'convera',
      counterparty_pattern: (pp.companyName || '').trim(),
      qb_vendor_list_id: v.listId,
      default_target_kind: 'bill_pmt',
      default_bank_account_list_id: DEFAULT_BANK_ACCOUNT_LIST_ID,
      default_expense_account_list_id: DEFAULT_EXPENSE_ACCOUNT_LIST_ID,
    });
  }
  return inserts;
}
