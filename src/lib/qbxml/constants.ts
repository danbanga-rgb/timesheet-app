// Hardcoded QB chart-of-accounts paths for Synergie's setup.
//
// These are the ACCOUNT PATHS as they appear in QB. They must match
// exactly — QB does not tolerate abbreviations, missing colons, or
// mis-capitalized segments.
//
// Confirmed in prod against the existing IIF bill export
// (buildIifContent in TimesheetSystem.tsx) — do not change without
// re-verifying against QB.

/** Accounts Payable — top-level, no parent path. */
export const DEFAULT_AP_ACCOUNT = 'Accounts Payable';

/** Full chart path for the contractor expense account.
 *  Note: does NOT start with "Cost of Goods Sold:" — that's the account
 *  TYPE, not a level in the chart hierarchy (see commit 005a4c9 for the
 *  IIF fix that established this). */
export const DEFAULT_EXPENSE_ACCOUNT =
  'Project Related Costs:Personnel Expenses:Consulting:Vendor Consultants';

/** Bank / clearing / fees accounts for the payment side (used by
 *  buildBillPaymentCheckAddRq in Session 3). */
export const KEY_POINT_CHECKING   = 'BANK/CASH:8220 - Key Point Checking';
export const WU_HOLDING           = 'BANK/CASH:Western Union Holding';
export const BANK_SERVICE_CHARGES = 'Bank Charges:Bank Service Charges';

/** Convera as a payee in QB. */
export const CONVERA_PAYEE = 'Convera';
