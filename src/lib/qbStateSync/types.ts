// qbStateSync — shared types.
//
// This module is the local mirror of QuickBooks Desktop state (vendors,
// accounts, open bills). Consumers read from the mirror; writes happen
// via qb_sync_jobs → qb-web-connector edge fn → persist.

export type QbEntityKind = 'vendors' | 'accounts' | 'bills';

export interface QbVendorRow {
  listId: string;
  name: string;
  isActive: boolean;
}

export interface QbAccountRow {
  listId: string;
  fullName: string;
  accountType: string;
  isActive: boolean;
}

export interface QbOpenBillRow {
  vendorListId: string;
  vendorName: string;
  refNumber: string;
  txnId: string;
  txnDate: string | null;
  dueDate: string | null;
  amount: number;
  openAmount: number;
  isPaid: boolean;
  queriedAt: string;   // ISO timestamp
}

export interface QbBillPaymentRow {
  vendorListId: string;
  vendorName: string | null;
  txnId: string;
  refNumber: string | null;
  txnDate: string | null;
  amount: number;
  bankListId: string | null;
  bankFullName: string | null;
  memo: string | null;
  /** Bills this payment settled. Present only when the source bill_pmt_query
   *  set IncludeLineItems=true. Empty otherwise. */
  appliedToBills: Array<{ billTxnId: string; amount: number; refNumber?: string }>;
  queriedAt: string;
}

/**
 * Freshness metadata computed from a set of mirror rows. Used by UI to
 * decide whether to show "fresh" / "stale" and by callers to gate sync.
 */
export interface MirrorFreshness {
  newestQueriedAt: string | null;  // ISO — most recently seen row
  oldestQueriedAt: string | null;  // ISO — least recently seen row (staleness driver)
  perVendorAges: Map<string, string>;  // vendorListId → newest queried_at for that vendor
  rowCount: number;
}

/**
 * Options for enqueueing a bill_query. Two mutually exclusive modes:
 *   - iterator: enumerate all bills for a vendor (optional date filter)
 *   - targeted: fetch specific refNumbers or txnIds
 */
export type EnqueueBillQueryOpts =
  | {
      mode: 'iterator';
      vendorName: string;
      fromTxnDate?: string;   // YYYY-MM-DD
      toTxnDate?: string;
      maxReturned?: number;
      auditTag?: string;      // stored in payload.__audit_tag for provenance
    }
  | {
      mode: 'targeted';
      refNumbers?: string[];
      txnIds?: string[];
      auditTag?: string;
    };

/**
 * Result of an enqueue call. jobIds is the list of newly-inserted qb_sync_jobs
 * ids. skippedInFlight counts vendor names for which a pending/in-flight job
 * already existed and we did not enqueue a duplicate.
 */
export interface EnqueueResult {
  jobIds: number[];
  skippedInFlight: string[];  // vendor names or refNumber sets that were skipped
}
