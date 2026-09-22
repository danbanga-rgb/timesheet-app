// Domain types for the timesheet system. Every top-level interface / type
// alias consumed by more than one file lives here. Runtime helpers stay in
// TimesheetSystem.tsx and role/component files; this module is types-only.
//
// Moved out of TimesheetSystem.tsx as Slice X0 of the accountant
// modularization arc (2026-09-16). See .claude/plans/accountant-modularization.md.

import type { InvoiceEditEntry } from '../supabase/functions/_shared/edit-history';
import type { MatchProvenance } from './lib/matchProvenance';

export type { InvoiceEditEntry, MatchProvenance };

// ─── Core domain ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  username: string;
  name: string;
  role: 'timesheetuser' | 'manager' | 'accountant' | 'admin' | 'vendormanager' | 'contract_admin' | 'external_payee';
  managerId: string | null;
  email: string;
  country: string;
  region: string;
  projectId: number | null;
  startDate: string | null;
  endDate: string | null;
  phone: string | null;
  emailApprovalsEnabled: boolean;
  invoiceEnabled: boolean;
  remindersEnabled: boolean;
  vendorManagerId: string | null;
  lastLogin: string | null;
  paymentTerms: string | null;
  locationType: 'onshore' | 'offshore' | null;
}

export interface Project {
  id: number;
  name: string;
  code: string;
  status: 'active' | 'inactive';
  description: string;
}

export interface TimeEntry {
  hours: string;
  isHoliday?: boolean | { date: string; name: string };
  holidayName?: string;
  isWeekend?: boolean;
}

export interface Timesheet {
  id: number;
  userId: string;
  userName: string;
  projectId: number | null;
  weekStart: string;
  entries: Record<string, TimeEntry>;
  status: 'pending' | 'approved' | 'rejected';
  source: 'direct' | 'imported' | null;
  submittedAt: string;
  approvedAt?: string | null;
  lockedDays: string[] | null; // set on invoice approval; non-null/non-empty = week is locked
}

export interface PaymentProfile {
  id: number;
  userId: string;
  profileName: string;       // user-facing label e.g. "My UK Account"
  companyName: string;
  companyAddress: string;
  country: string;
  bankName: string;
  bankAddress: string;
  bankBranch: string;
  accountNumber: string;
  iban: string;
  swift: string;
  paymentEmail: string;
  isDefault: boolean;
  combinePayments: boolean | null; // null = not yet decided; true = combine wires for this IBAN
  converaBeneficiaryId: number | null;
  converaMatchOverride: boolean;
  qbVendorName: string | null;      // QuickBooks vendor name for IIF export; NULL = unmapped
}

export type ProfileForm = Omit<PaymentProfile, 'id' | 'userId'>;

export interface ConveraBeneficiary {
  id: number;
  beneficiaryId: string;
  shortName: string;
  beneficiaryName: string;
  beneficiaryCountry: string | null;
  currency: string;
  defaultPaymentMethod: string;
  vendorId: string | null;           // SYN-XXXX code used in Convera batch upload CSV
  bankName: string | null;
  bankCountry: string | null;
  bankAccount: string;
  ibanUnique: boolean;
  deprecated: boolean;
  replacementBeneficiaryId: number | null;
  deprecatedReason: string | null;
  forceCombine: boolean;  // Umbrella beneficiaries (e.g. Bimosoft UK ALT) always combine into one wire.
}

export interface InvoiceLine {
  weekStart: string;
  weekEndingFri: string;
  hours: number | null;
  rate: number | null;
  amount: number;
  userId?: string;
  userName?: string;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;     // user-editable alphanumeric
  userId: string;
  userName: string;
  projectId: number | null;
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLine[];
  totalHours: number | null;
  rate: number | null;
  totalAmount: number;
  currency: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid';
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  notes: string;
  paymentProfile: PaymentProfile | null;
  payOnDate: string | null;          // scheduled/expected payment date set by accountant
  paidDate: string | null;           // actual date payment was made
  attachmentPath: string | null;     // Supabase Storage path for PDF attachment
  paymentMethodOverride: string | null; // accountant-editable: 'Intuit' or 'Convera'
  isVendorInvoice: boolean;
  vendorManagerId: string | null;
  source: 'direct' | 'imported' | 'manual' | null;
  createdBy: string | null;  // profiles.id of accountant who created a source='manual' invoice; NULL otherwise
  reconciliationStatus: 'matched' | 'mismatch' | 'unverifiable' | null;
  reconciliationDelta: number | null;
  reconciliationNotes: string | null;
  groupKey: string | null;  // shared key for multi-contractor invoices from same attachment
  corrected: boolean;        // re-submitted with different values; reset to submitted for re-approval
  paymentTerms: string | null; // NET15 / NET30 / NET45 / NET60
  qbExportStatus: 'not_exported' | 'exported' | 'confirmed' | 'skipped';
  qbExportStatusAt: string | null;
  qbBillTxnId: string | null;  // set by bill_add drain handler when a Bill exists in QB
  matcherIgnore: boolean;  // pre-2026-04-28 historical invoices — hidden from matchPaymentToInvoice
  editHistory: InvoiceEditEntry[];
}

// ─── Payments tab (2026-07-10) ───────────────────────────────────────────────

export type ImportBatchState  = 'pending' | 'processed' | 'rolled_back';
export type MatchState        = 'unreviewed' | 'matched' | 'no_invoice' | 'flagged';
export type MatchConfidence   = 'strong' | 'weak' | 'none';

export interface ImportBatch {
  id: number;
  source: string;                    // 'convera_xls' for MVP
  sourceFilename: string | null;
  importedAt: string;
  importedBy: string | null;
  rowCount: number;
  state: ImportBatchState;
}

export interface ConveraTransaction {
  id: number;
  confirmationNumber: string;
  lineItem: number;
  dateOfOrder: string;               // YYYY-MM-DD
  beneficiaryName: string;
  subtotal: number | null;
  serviceCharges: number | null;
  grandTotal: number | null;
  foreignAmount: number | null;
  ref1: string | null;
  itemType: string | null;
  converaBeneficiaryId: number | null;
  // Payments tab match state
  importBatchId: number | null;
  matchedInvoiceId: number | null;
  matchState: MatchState;
  matchConfidence: MatchConfidence | null;
  matchLevel: number | null;
  matchedAt: string | null;
  matchedBy: string | null;
  notes: string | null;
  // For umbrella payments (many-to-many)
  matchedInvoiceIds?: number[];
  matcherIgnore: boolean;  // pre-2026-06-20 historical Convera transactions
  qbPaymentExportStatus: 'not_exported' | 'exported' | 'confirmed' | 'skipped';
  qbPaymentExportStatusAt: string | null;
  qbBillpmtTxnId: string | null;
}

export interface ReminderEmail {
  id: number;
  userId: string;
  userName: string;
  userEmail: string;
  reminderType: 'first' | 'second';
  weekStart: string;
  sentDate: string;
  sentTime: string;
  subject: string;
  message: string;
}

export interface UserForm {
  email: string;
  password: string;
  name: string;
  role: string;
  manager_id: string | null;
  country: string;
  region: string;
  project_id: number | null;
  start_date: string;
  end_date: string;
  phone: string;
  email_approvals_enabled: boolean;
  invoice_enabled: boolean;
  reminders_enabled: boolean;
  vendor_manager_id: string | null;
  payment_terms: string;
  location_type: string;
}

export interface ProjectForm {
  name: string;
  code: string;
  status: string;
  description: string;
}

// ─── QB Automation Layer types (Slice C onward) ──────────────────────────────
// Frontend-facing shape of qb_ingest_events rows. Camel-case; DB is snake_case.
// See supabase/migrations/20260819000000_qb_ingest_events.sql for the source of
// truth on columns and enums.

export type QbIngestKind = 'bill_pmt' | 'bill_add_and_pmt' | 'check' | 'ignore';
export type QbIngestStatus = 'pending' | 'ready' | 'queued' | 'posted' | 'failed' | 'ignored';

export interface QbVendor { listId: string; name: string; isActive: boolean; }
export interface QbAccount { listId: string; fullName: string; accountType: string; isActive: boolean; }
export type QbPayeeListKind = 'Vendor' | 'OtherName' | 'Employee' | 'Customer';

export interface QbVendorMapping {
  id: number;
  ppId: number | null;                 // primary key since Slice V1 migration. NULL = legacy row.
  source: string;
  counterpartyPattern: string;
  qbVendorListId: string;              // '' when payee is not in Vendors list (OtherName etc.)
  defaultTargetKind: QbIngestKind | null;
  defaultBankAccountListId: string | null;
  defaultExpenseAccountListId: string | null;
  payeeFullName: string | null;        // populated for non-Vendor payees (Lucien-style)
  payeeListKind: QbPayeeListKind | null;
}

export type QbResolvedAction = 'already_done' | 'pay_existing_bill' | 'create_bill_then_pay' | 'check' | 'held' | 'pre_our_system';

export interface QbIngestEvent {
  id: number;
  ingestedAt: string;
  source: string;                       // 'intuit_xlsx' | 'convera' | 'manual' | ...
  sourceRef: string;
  txnDate: string;                      // YYYY-MM-DD
  amount: number;                       // positive = money out
  counterpartyRaw: string;
  memo: string | null;
  counterpartyQbVendorListId: string | null;
  targetQbTxnKind: QbIngestKind | null;
  qbBankAccountListId: string | null;
  qbExpenseAccountListId: string | null;
  matchedInvoiceIds: number[];
  status: QbIngestStatus;
  qbSyncJobIds: number[];
  postedQbRefs: Record<string, unknown> | null;
  lastError: string | null;
  rawData: Record<string, unknown> | null;
  notes: string | null;
  // Slice G4a — reconciler output. NULL until Slice G4c orchestrator runs.
  resolvedAction: QbResolvedAction | null;
  resolvedBillTxnId: string | null;
  resolvedPaymentTxnId: string | null;
  resolvedReason: string | null;
  reconciledAt: string | null;
  matchProvenance: MatchProvenance | null;
  statusUpdatedAt: string | null;       // when status last flipped (posted, ignored, etc.)
}

// ─── Live invoice reconciliation ─────────────────────────────────────────────

export interface ReconTimesheetRow {
  ts: Timesheet;
  hoursInPeriod: number;
  weekEnd: string; // Sunday of the week
}
