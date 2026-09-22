// ============================================================
// TimesheetSystem.tsx — Supabase-integrated version
// Phase 3 of the Production Deployment Guide
// ============================================================

// ConsolidatedTable moved to src/components/ (Slice C2, 2026-09-16).

import { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, CheckCircle, LogOut, LogIn, Users, Mail, FileText, Download, Plus, Edit2, Trash2, Save, X, Settings, MapPin, DollarSign, Receipt, Paperclip, ExternalLink, UploadCloud, Eye, EyeOff, AlertTriangle, CreditCard, Building2, MessageSquare } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import { tzMap } from '../supabase/functions/_shared/tz-map';
import {
  normalizeEditEntry,
  periodEditEntry,
  valueEditEntry,
  vendorMapEntry,
} from '../supabase/functions/_shared/edit-history';
import { resolveNewProfileVendor, resolveInvoiceQbVendorName, extractSnapPpId, type ResolverPaymentProfile } from './lib/vendorResolution';
import { resolveLivePaymentProfile } from './lib/paymentProfileResolver';
import ContractAdminDashboard from './roles/ContractAdmin';
import AdminChatActivity from './roles/AdminChat/AdminChatActivity';
import ManualInvoiceModal from './components/manualInvoice/ManualInvoiceModal';
import { buildInvoiceLines as sharedBuildInvoiceLines } from './lib/invoiceLines';
import QbSyncPanel from './roles/AdminQbSync/QbSyncPanel';
import { parseLocalDate, formatDate, getWeekDates, isWeekend } from './lib/dates';
import { triggerDownload } from './lib/csv';
import { COUNTRIES as countries, countryName } from './lib/countries';
import CountrySelect from './components/CountrySelect';
import MonthRangePicker from './components/MonthRangePicker';
import StatusBadge, { type BadgeTone } from './components/StatusBadge';
import FilterPills from './components/FilterPills';
import PasswordResetForm from './components/auth/PasswordResetForm';
import ImportIntuitPaymentsXlsx from './roles/Accountant/modals/ImportIntuitPaymentsXlsx';
import ImportConveraBeneficiaries from './roles/Accountant/modals/ImportConveraBeneficiaries';
import QbVendorNameEditor from './components/QbVendorNameEditor';
import SortableHeader from './components/SortableHeader';
import PaymentProfileModal from './components/PaymentProfileModal';
import ConsolidatedTab from './roles/Accountant/tabs/Consolidated';
import WeeklyTab from './roles/Accountant/tabs/Weekly';
import TimesheetOnlyTab from './roles/Accountant/tabs/TimesheetOnly';
import ClientEstimationTab from './roles/Accountant/tabs/ClientEstimation';
import PaymentProfilesTab, { TemplateProfileModal } from './roles/Accountant/tabs/PaymentProfiles';
import InvoicesTab from './roles/Accountant/tabs/Invoices';
import { useInvoiceFilters } from './hooks/useInvoiceFilters';
import { reconcileInvoiceLive } from './lib/reconcileInvoice';
import InvoiceDetailModal from './roles/Accountant/modals/InvoiceDetailModal';
import QbAutomationV2 from './features/QbAutomationV2';
import {
  buildConveraBatchRows,
  buildConveraBatchCsv,
  computeConveraBatchFilename,
  type ConveraBatchGroup,
  type ConveraBatchManualRow,
} from './lib/convera/batchFile';
import ConveraBatchModal from './roles/Accountant/modals/ConveraBatchModal';
import IntuitBatchModal from './roles/Accountant/modals/IntuitBatchModal';
import TimesheetDetailModal from './components/TimesheetDetailModal';
import ManagerView from './roles/Manager/ManagerView';
import VendorManagerView from './roles/VendorManager/VendorManagerView';
import { excelDateToIso } from './lib/xlsxHelpers';
import { parseIntuitXlsxBuffer, type IntuitXlsxRow } from './lib/parseIntuitXlsx';
import {
  matchEventsToInvoices,
  type MatchableEvent,
  type MatcherInvoice,
} from './lib/matchQbIngestEvents';
import {
  classifyBatch,
  resolveBankAccount,
  type ClassifiableEvent,
  type ClassifiableInvoice,
  type ClassifiableMapping,
} from './lib/classifyQbIngestEvent';
import { enqueueBillQueryForVendors, enqueueVendorQuery } from './lib/qbStateSync/enqueue';
import { getAllOpenBills, getAllPayments } from './lib/qbStateSync/read';
import { snapshotAge, humanizeAge, vendorsNeedingSync } from './lib/qbStateSync/freshness';
import type { QbOpenBillRow } from './lib/qbStateSync/types';
import {
  normalizeRef,
  reconcileBatch,
  extractRefsFromMemo,
  type MirrorBill,
  type MirrorPayment,
  type ReconcilableEvent,
} from './lib/intuit/reconcile';
import {
  computeMatchProvenance,
  memoNamesMatchedInvoice,
  type MatchProvenance,
} from './lib/matchProvenance';
import { INTUIT_PRE_OUR_SYSTEM_CUTOFF } from './lib/intuit/config';
import { CONVERA_PRE_OUR_SYSTEM_CUTOFF } from './lib/convera/config';
import QbPushPreviewModal from './components/QbPushPreviewModal';
import QbPushStatusPane, { type PushRecord } from './components/QbPushStatusPane';
import { pushIntuitPayBill } from './lib/qbWrite/consumers/intuitPush';
import { pushIntuitCreateBill } from './lib/qbWrite/consumers/intuitCreateBill';
import { pushIntuitCheck } from './lib/qbWrite/consumers/intuitCheck';
import { pushIntuitInvoiceCreateBill } from './lib/qbWrite/consumers/intuitInvoiceCreateBill';
import { pushConveraInvoiceCreateBill } from './lib/qbWrite/consumers/converaInvoiceCreateBill';
import { pushConveraBillPmt } from './lib/qbWrite/consumers/converaBillPmt';
import { pushConveraCreateBillAndPay } from './lib/qbWrite/consumers/converaCreateBillAndPay';
import { pushConveraCreateBillFromEvent } from './lib/qbWrite/consumers/converaCreateBillFromEvent';
import { insertConveraShadowEvents, updateConveraShadowMatch, type ConveraShadowInput, type ConveraShadowMatchUpdate } from './lib/qbIngest/converaShadow';
import VendorDecisionModal from './components/VendorDecisionModal';

// ─── Domain types ────────────────────────────────────────────────────────────
// All top-level interfaces and type aliases moved to src/types.ts as Slice X0
// of the accountant modularization arc. Re-exported here so any file still
// importing from './TimesheetSystem' resolves.
export type {
  UserProfile,
  Project,
  TimeEntry,
  Timesheet,
  PaymentProfile,
  ConveraBeneficiary,
  InvoiceLine,
  Invoice,
  InvoiceEditEntry,
  ImportBatchState,
  MatchState,
  MatchConfidence,
  ImportBatch,
  ConveraTransaction,
  ReminderEmail,
  UserForm,
  ProjectForm,
  QbIngestKind,
  QbIngestStatus,
  QbVendor,
  QbAccount,
  QbPayeeListKind,
  QbVendorMapping,
  QbResolvedAction,
  QbIngestEvent,
  ReconTimesheetRow,
} from './types';

import type {
  UserProfile,
  Project,
  TimeEntry,
  Timesheet,
  PaymentProfile,
  ConveraBeneficiary,
  InvoiceLine,
  Invoice,
  ImportBatch,
  ImportBatchState,
  ConveraTransaction,
  MatchState,
  MatchConfidence,
  ReminderEmail,
  UserForm,
  ProjectForm,
  QbIngestKind,
  QbIngestStatus,
  QbVendor,
  QbAccount,
  QbPayeeListKind,
  QbVendorMapping,
  QbResolvedAction,
  QbIngestEvent,
} from './types';

function normaliseQbIngestEvent(r: Record<string, unknown>): QbIngestEvent {
  return {
    id: r.id as number,
    ingestedAt: (r.ingested_at as string) ?? '',
    source: (r.source as string) ?? '',
    sourceRef: (r.source_ref as string) ?? '',
    txnDate: (r.txn_date as string) ?? '',
    amount: Number(r.amount ?? 0),
    counterpartyRaw: (r.counterparty_raw as string) ?? '',
    memo: (r.memo as string) ?? null,
    counterpartyQbVendorListId: (r.counterparty_qb_vendor_list_id as string) ?? null,
    targetQbTxnKind: (r.target_qb_txn_kind as QbIngestKind) ?? null,
    qbBankAccountListId: (r.qb_bank_account_list_id as string) ?? null,
    qbExpenseAccountListId: (r.qb_expense_account_list_id as string) ?? null,
    matchedInvoiceIds: Array.isArray(r.matched_invoice_ids) ? (r.matched_invoice_ids as number[]) : [],
    status: (r.status as QbIngestStatus) ?? 'pending',
    qbSyncJobIds: Array.isArray(r.qb_sync_job_ids) ? (r.qb_sync_job_ids as number[]) : [],
    postedQbRefs: (r.posted_qb_refs as Record<string, unknown>) ?? null,
    lastError: (r.last_error as string) ?? null,
    rawData: (r.raw_data as Record<string, unknown>) ?? null,
    notes: (r.notes as string) ?? null,
    resolvedAction: (r.resolved_action as QbResolvedAction) ?? null,
    resolvedBillTxnId: (r.resolved_bill_txn_id as string) ?? null,
    resolvedPaymentTxnId: (r.resolved_payment_txn_id as string) ?? null,
    resolvedReason: (r.resolved_reason as string) ?? null,
    reconciledAt: (r.reconciled_at as string) ?? null,
    matchProvenance: (r.match_provenance as MatchProvenance) ?? null,
    statusUpdatedAt: (r.status_updated_at as string) ?? null,
  };
}

import { sanitizeIban, ibanChecksumValid, checkIbanLength } from './lib/iban';

// Deterministic vendor code Dan enters in Convera when creating a beneficiary.
// Shared-IBAN groups (Bimosoft, etc.) share ONE code so Dan only enters one SYN
// in Convera; on beneficiary import the matcher then SYN-links whichever profile's
// id matches the code, and every other profile in the group is linked via IBAN
// fallback. Empty IBAN → per-profile code.
function computeSynVendorCode(profileId: number, iban: string, allProfiles: { id: number; iban: string }[]): string {
  const cleanIban = (iban || '').trim();
  if (!cleanIban) return `SYN-${String(profileId).padStart(4, '0')}`;
  const sameIbanIds = allProfiles.filter(p => (p.iban || '').trim() === cleanIban).map(p => p.id);
  const minId = sameIbanIds.length ? Math.min(...sameIbanIds) : profileId;
  return `SYN-${String(minId).padStart(4, '0')}`;
}

// Parses a contractor's pasted bank-details reply into structured fields.
// Two real-world variants seen (see memory: project_template_form_profile_creation):
//   - `Label:- Value` (Bhavani / India)
//   - `Label: Value` (Enis / Bosnia, follows Lucien's exact label list)
// Fields may be empty. Labels vary in wording; we match a small set of aliases per field.
function parseProfileTemplate(text: string): {
  companyName: string; companyAddress: string; country: string;
  bankName: string; bankAddress: string; bankBranch: string;
  accountNumber: string; iban: string; swift: string; paymentEmail: string;
} {
  const out = {
    companyName: '', companyAddress: '', country: '',
    bankName: '', bankAddress: '', bankBranch: '',
    accountNumber: '', iban: '', swift: '', paymentEmail: '',
  };
  const patterns: [RegExp, keyof typeof out][] = [
    [/^\s*(full\s+company\s+name|account\s+holder'?s?\s+name|company\s+name)\s*$/i, 'companyName'],
    [/^\s*company\s+address\s*$/i, 'companyAddress'],
    [/^\s*country\s*$/i, 'country'],
    [/^\s*bank\s+name\s*$/i, 'bankName'],
    [/^\s*bank\s+address\s*$/i, 'bankAddress'],
    [/^\s*bank\s+branch\s*$/i, 'bankBranch'],
    [/^\s*account\s+(number|no\.?|#)\s*$/i, 'accountNumber'],
    [/^\s*(iban(\s*\/\s*ifsc)?|ifsc(\s+code)?)\s*$/i, 'iban'],
    [/^\s*(swift(\s+code)?|bic)\s*$/i, 'swift'],
    [/^\s*(email\s+address\s+for\s+payment\s+notification|payment\s+notification\s+email|payment\s+email)\s*$/i, 'paymentEmail'],
  ];
  for (const rawLine of text.split(/\r?\n/)) {
    // Accept "Label:- value", "Label: value", "Label : value" (any whitespace / dash after colon)
    const m = rawLine.match(/^([^:]+?)\s*:\s*-?\s*(.*?)\s*$/);
    if (!m) continue;
    const label = m[1];
    const value = m[2];
    for (const [pat, field] of patterns) {
      if (pat.test(label)) {
        if (value) out[field] = value;
        break;
      }
    }
  }
  return out;
}

const TimesheetSystem = () => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const loadedUserIdRef = useRef<string | null>(null); // guard against duplicate SIGNED_IN from gotrue lock recovery
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const holidaysByYear: Record<string, Record<string, { date: string; name: string }[]>> = {
    '2026': {
      US: [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
        { date: '2026-02-16', name: "Presidents' Day" },
        { date: '2026-05-25', name: 'Memorial Day' },
        { date: '2026-07-03', name: 'Independence Day (Observed)' },
        { date: '2026-09-07', name: 'Labor Day' },
        { date: '2026-11-26', name: 'Thanksgiving' },
        { date: '2026-12-25', name: 'Christmas Day' }
      ],
      GB: [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-04-03', name: 'Good Friday' },
        { date: '2026-04-06', name: 'Easter Monday' },
        { date: '2026-05-04', name: 'Early May Bank Holiday' },
        { date: '2026-08-31', name: 'Summer Bank Holiday' },
        { date: '2026-12-25', name: 'Christmas Day' }
      ],
      CA: [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-07-01', name: 'Canada Day' },
        { date: '2026-09-07', name: 'Labour Day' },
        { date: '2026-12-25', name: 'Christmas Day' }
      ],
      HR: [
        { date: '2026-01-01', name: "Nova godina (New Year's Day)" },
        { date: '2026-01-06', name: 'Sveta tri kralja (Epiphany)' },
        { date: '2026-04-05', name: 'Uskrs (Easter Sunday)' },
        { date: '2026-04-06', name: 'Uskrsni ponedjeljak (Easter Monday)' },
        { date: '2026-05-01', name: 'Međunarodni praznik rada (Labour Day)' },
        { date: '2026-05-30', name: 'Dan državnosti (National Day)' },
        { date: '2026-06-04', name: 'Tijelovo (Corpus Christi)' },
        { date: '2026-06-22', name: 'Dan antifašističke borbe (Anti-Fascist Struggle Day)' },
        { date: '2026-08-05', name: 'Dan domovinske zahvalnosti (Victory & Thanksgiving Day)' },
        { date: '2026-08-15', name: 'Velika Gospa (Assumption of Mary)' },
        { date: '2026-10-08', name: 'Dan neovisnosti (Independence Day)' },
        { date: '2026-11-01', name: 'Svi sveti (All Saints\' Day)' },
        { date: '2026-12-25', name: 'Božić (Christmas Day)' },
        { date: '2026-12-26', name: 'Sveti Stjepan (St. Stephen\'s Day)' }
      ],
      RS: [
        { date: '2026-01-01', name: "Nova godina (New Year's Day)" },
        { date: '2026-01-02', name: "Nova godina (New Year's Day 2)" },
        { date: '2026-01-07', name: 'Božić (Orthodox Christmas)' },
        { date: '2026-02-15', name: 'Dan državnosti (Statehood Day)' },
        { date: '2026-02-16', name: 'Dan državnosti (Statehood Day 2)' },
        { date: '2026-04-10', name: 'Veliki petak (Orthodox Good Friday)' },
        { date: '2026-04-12', name: 'Vaskrs (Orthodox Easter Sunday)' },
        { date: '2026-04-13', name: 'Vaskrsni ponedeljak (Orthodox Easter Monday)' },
        { date: '2026-05-01', name: 'Praznik rada (Labour Day)' },
        { date: '2026-05-02', name: 'Praznik rada (Labour Day 2)' },
        { date: '2026-11-11', name: 'Dan primirja (Armistice Day)' }
      ],
      BA: [
        { date: '2026-01-01', name: "Nova godina (New Year's Day)" },
        { date: '2026-01-07', name: 'Božić (Orthodox Christmas)' },
        { date: '2026-04-06', name: 'Dan neovisnosti (Independence Day)' },
        { date: '2026-04-12', name: 'Vaskrs (Orthodox Easter Sunday)' },
        { date: '2026-04-13', name: 'Uskrsni ponedjeljak (Easter Monday)' },
        { date: '2026-05-01', name: 'Međunarodni dan rada (Labour Day)' },
        { date: '2026-11-25', name: 'Dan državnosti (Statehood Day)' },
        { date: '2026-12-25', name: 'Božić (Christmas Day)' }
      ],
      SI: [
        { date: '2026-01-01', name: "Novo leto (New Year's Day)" },
        { date: '2026-01-02', name: "Novo leto (New Year's Day 2)" },
        { date: '2026-02-08', name: 'Prešernov dan (Prešeren Day)' },
        { date: '2026-04-05', name: 'Velika noč (Easter Sunday)' },
        { date: '2026-04-06', name: 'Velikonočni ponedeljek (Easter Monday)' },
        { date: '2026-04-27', name: 'Dan upora proti okupatorju (Resistance Day)' },
        { date: '2026-05-01', name: 'Praznik dela (Labour Day)' },
        { date: '2026-05-02', name: 'Praznik dela (Labour Day 2)' },
        { date: '2026-06-25', name: 'Dan državnosti (Statehood Day)' },
        { date: '2026-08-15', name: 'Marijino vnebovzetje (Assumption of Mary)' },
        { date: '2026-10-31', name: 'Dan reformacije (Reformation Day)' },
        { date: '2026-11-01', name: 'Dan spomina na mrtve (All Saints\' Day)' },
        { date: '2026-12-25', name: 'Božič (Christmas Day)' },
        { date: '2026-12-26', name: 'Dan samostojnosti in enotnosti (Independence Day)' }
      ],
      MK: [
        { date: '2026-01-01', name: "Нова Година (New Year's Day)" },
        { date: '2026-01-07', name: 'Божиќ (Orthodox Christmas)' },
        { date: '2026-04-12', name: 'Велигден (Orthodox Easter Sunday)' },
        { date: '2026-04-13', name: 'Велигден (Orthodox Easter Monday)' },
        { date: '2026-05-01', name: 'Ден на трудот (Labour Day)' },
        { date: '2026-05-24', name: 'Св. Кирил и Методиј (Sts. Cyril & Methodius)' },
        { date: '2026-08-02', name: 'Илинден (Ilinden - National Day)' },
        { date: '2026-09-08', name: 'Ден на независноста (Independence Day)' },
        { date: '2026-10-11', name: 'Ден на народното востание (National Uprising Day)' },
        { date: '2026-10-23', name: 'Ден на македонската револуционерна борба (Revolution Day)' },
        { date: '2026-12-08', name: 'Св. Климент Охридски (St. Clement of Ohrid)' },
        { date: '2026-12-25', name: 'Божиќ (Christmas Day)' }
      ]
    },
    '2027': {
      US: [
        { date: '2027-01-01', name: "New Year's Day" },
        { date: '2027-01-18', name: 'Martin Luther King Jr. Day' },
        { date: '2027-02-15', name: "Presidents' Day" },
        { date: '2027-05-31', name: 'Memorial Day' },
        { date: '2027-07-05', name: 'Independence Day (Observed)' },
        { date: '2027-09-06', name: 'Labor Day' },
        { date: '2027-11-25', name: 'Thanksgiving' },
        { date: '2027-12-24', name: 'Christmas Day (Observed)' }
      ],
      GB: [
        { date: '2027-01-01', name: "New Year's Day" },
        { date: '2027-03-26', name: 'Good Friday' },
        { date: '2027-03-29', name: 'Easter Monday' },
        { date: '2027-05-03', name: 'Early May Bank Holiday' },
        { date: '2027-08-30', name: 'Summer Bank Holiday' },
        { date: '2027-12-27', name: 'Christmas Day (substitute)' }
      ],
      CA: [
        { date: '2027-01-01', name: "New Year's Day" },
        { date: '2027-07-01', name: 'Canada Day' },
        { date: '2027-09-06', name: 'Labour Day' },
        { date: '2027-12-27', name: 'Christmas Day (Observed)' }
      ],
      HR: [
        { date: '2027-01-01', name: "Nova godina (New Year's Day)" },
        { date: '2027-01-06', name: 'Sveta tri kralja (Epiphany)' },
        { date: '2027-03-28', name: 'Uskrs (Easter Sunday)' },
        { date: '2027-03-29', name: 'Uskrsni ponedjeljak (Easter Monday)' },
        { date: '2027-05-01', name: 'Međunarodni praznik rada (Labour Day)' },
        { date: '2027-05-30', name: 'Dan državnosti (National Day)' },
        { date: '2027-05-27', name: 'Tijelovo (Corpus Christi)' },
        { date: '2027-06-22', name: 'Dan antifašističke borbe (Anti-Fascist Struggle Day)' },
        { date: '2027-08-05', name: 'Dan domovinske zahvalnosti (Victory & Thanksgiving Day)' },
        { date: '2027-08-15', name: 'Velika Gospa (Assumption of Mary)' },
        { date: '2027-10-08', name: 'Dan neovisnosti (Independence Day)' },
        { date: '2027-11-01', name: 'Svi sveti (All Saints\' Day)' },
        { date: '2027-12-25', name: 'Božić (Christmas Day)' },
        { date: '2027-12-26', name: 'Sveti Stjepan (St. Stephen\'s Day)' }
      ],
      RS: [
        { date: '2027-01-01', name: "Nova godina (New Year's Day)" },
        { date: '2027-01-02', name: "Nova godina (New Year's Day 2)" },
        { date: '2027-01-07', name: 'Božić (Orthodox Christmas)' },
        { date: '2027-02-15', name: 'Dan državnosti (Statehood Day)' },
        { date: '2027-02-16', name: 'Dan državnosti (Statehood Day 2)' },
        { date: '2027-04-30', name: 'Veliki petak (Orthodox Good Friday)' },
        { date: '2027-05-02', name: 'Vaskrs (Orthodox Easter Sunday)' },
        { date: '2027-05-03', name: 'Vaskrsni ponedeljak (Orthodox Easter Monday)' },
        { date: '2027-05-01', name: 'Praznik rada (Labour Day)' },
        { date: '2027-11-11', name: 'Dan primirja (Armistice Day)' }
      ],
      BA: [
        { date: '2027-01-01', name: "Nova godina (New Year's Day)" },
        { date: '2027-01-07', name: 'Božić (Orthodox Christmas)' },
        { date: '2027-04-06', name: 'Dan neovisnosti (Independence Day)' },
        { date: '2027-05-02', name: 'Vaskrs (Orthodox Easter Sunday)' },
        { date: '2027-05-03', name: 'Uskrsni ponedjeljak (Easter Monday)' },
        { date: '2027-05-01', name: 'Međunarodni dan rada (Labour Day)' },
        { date: '2027-11-25', name: 'Dan državnosti (Statehood Day)' },
        { date: '2027-12-25', name: 'Božić (Christmas Day)' }
      ],
      SI: [
        { date: '2027-01-01', name: "Novo leto (New Year's Day)" },
        { date: '2027-01-02', name: "Novo leto (New Year's Day 2)" },
        { date: '2027-02-08', name: 'Prešernov dan (Prešeren Day)' },
        { date: '2027-03-28', name: 'Velika noč (Easter Sunday)' },
        { date: '2027-03-29', name: 'Velikonočni ponedeljek (Easter Monday)' },
        { date: '2027-04-27', name: 'Dan upora proti okupatorju (Resistance Day)' },
        { date: '2027-05-01', name: 'Praznik dela (Labour Day)' },
        { date: '2027-05-02', name: 'Praznik dela (Labour Day 2)' },
        { date: '2027-06-25', name: 'Dan državnosti (Statehood Day)' },
        { date: '2027-08-15', name: 'Marijino vnebovzetje (Assumption of Mary)' },
        { date: '2027-10-31', name: 'Dan reformacije (Reformation Day)' },
        { date: '2027-11-01', name: 'Dan spomina na mrtve (All Saints\' Day)' },
        { date: '2027-12-25', name: 'Božič (Christmas Day)' },
        { date: '2027-12-26', name: 'Dan samostojnosti in enotnosti (Independence Day)' }
      ],
      MK: [
        { date: '2027-01-01', name: "Нова Година (New Year's Day)" },
        { date: '2027-01-07', name: 'Божиќ (Orthodox Christmas)' },
        { date: '2027-05-02', name: 'Велигден (Orthodox Easter Sunday)' },
        { date: '2027-05-03', name: 'Велигден (Orthodox Easter Monday)' },
        { date: '2027-05-01', name: 'Ден на трудот (Labour Day)' },
        { date: '2027-05-24', name: 'Св. Кирил и Методиј (Sts. Cyril & Methodius)' },
        { date: '2027-08-02', name: 'Илинден (Ilinden - National Day)' },
        { date: '2027-09-08', name: 'Ден на независноста (Independence Day)' },
        { date: '2027-10-11', name: 'Ден на народното востание (National Uprising Day)' },
        { date: '2027-10-23', name: 'Ден на македонската револуционерна борба (Revolution Day)' },
        { date: '2027-12-08', name: 'Св. Климент Охридски (St. Clement of Ohrid)' },
        { date: '2027-12-25', name: 'Божиќ (Christmas Day)' }
      ]
    }
  };

  const paymentMethod = (inv: Invoice) => {
    // Older data has lowercase 'intuit'/'convera'; canonicalise so downstream === matches.
    const canonicalise = (raw: string | null | undefined): string => {
      if (!raw) return '';
      const lc = raw.toLowerCase();
      if (lc === 'intuit') return 'Intuit';
      if (lc === 'convera') return 'Convera';
      return raw;
    };
    const own = canonicalise(inv.paymentMethodOverride);
    if (own) return own;
    // Fall back to the accountant's most recent explicit choice for this contractor.
    // Country/location_type can't capture anomalies (offshore contractor billed at onshore
    // rate, umbrella switches, etc.); prior accountant choices can.
    const prior = invoices
      .filter(i => i.userId === inv.userId && i.id !== inv.id && i.paymentMethodOverride)
      .sort((a, b) => b.id - a.id)[0];
    if (prior) return canonicalise(prior.paymentMethodOverride);
    // Location-type invariant (last resort): offshore → Convera, onshore → Intuit.
    // MUST key on location_type, not country: profiles.country is auto-prefilled
    // from the admin's browser timezone at user-create time, so US-based admins
    // create every profile with country='US' regardless of the contractor's real
    // location. location_type is admin-curated and correct. See [[offshore-100-convera]]
    // — 18 profiles today have country='US' but location_type='offshore'.
    const contractor = users.find(u => u.id === inv.userId);
    if (contractor?.locationType === 'offshore') return 'Convera';
    if (contractor?.locationType === 'onshore')  return 'Intuit';
    return '';
  };
  // Colour classes for the payment-method chip. '' → gray (Unassigned).
  const paymentMethodChipClass = (inv: Invoice) => {
    const pm = paymentMethod(inv);
    if (pm === 'Intuit') return 'bg-green-50 text-green-700';
    if (pm === 'Convera') return 'bg-purple-50 text-purple-700';
    return 'bg-gray-100 text-gray-500';
  };
  const paymentMethodLabel = (inv: Invoice) => paymentMethod(inv) || 'Unassigned';

  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const timesheetsRef = useRef<Timesheet[]>([]);
  const [accountantTab, setAccountantTab] = useState('weekly');
  const [profileTabSearch, setProfileTabSearch] = useState('');
  const [profileTabFilter, setProfileTabFilter] = useState<'all'|'multiple'|'unmatched'|'no-qb-vendor'>('all');
  const [qbVendorEditingId, setQbVendorEditingId] = useState<number | null>(null);
  const [showQbExportModal, setShowQbExportModal] = useState(false);
  const [qbExportSelectedIds, setQbExportSelectedIds] = useState<Set<number>>(new Set());
  const [qbExportSnapshot, setQbExportSnapshot] = useState<Invoice[]>([]);
  const [qbExportCategoryFilter, setQbExportCategoryFilter] = useState<'selected' | 'ready' | 'no_vendor' | 'already_sent' | 'skipped' | null>(null);

  // Convera Batch preview modal — one card per beneficiary. Each invoice inside carries its own IBAN.
  // Same-IBAN groups auto-default to combined; mixed-IBAN groups surface as candidates the accountant
  // can force-combine (e.g., Bimosoft contractors whose old IBANs are still on file but who all now
  // route through the same Convera account).
  type ConveraBatchSkip = {
    invoice: Invoice;
    reason: 'no vendor code assigned' | 'no Convera beneficiary linked' | string;  // guardrail may inject deprecation reason
    // Payment profile fields (used for the "Create Convera Beneficiary" panel)
    companyName: string;      // Beneficiary long name
    country: string;          // payment_profile.country (rarely set)
    bankCountry?: string;     // Derived from IBAN prefix — Convera requires bank country to match IBAN
    bankName: string;
    bankAddress: string;
    iban: string;
    swift: string;
    accountNumber: string;
    paymentEmail: string;      // payment_profile.payment_email (rarely set — will come from template form)
    contractorEmail?: string;  // users.email fallback so accountant has *something* to enter
    contractorName: string;   // used to seed a suggested short name
    // Set when the linked beneficiary lacks a vendor_id but a sibling record with same
    // beneficiary_name DOES have one — accountant likely picked the wrong beneficiary
    linkedBeneficiary?: { id: number; shortName: string; fullName: string };
    suggestedBeneficiary?: { id: number; shortName: string; vendorId: string };
    // Pre-computed SYN-XXXX for new beneficiaries (grouped by IBAN → same suggested number)
    suggestedVendorId?: string;
  };
  const [showConveraBatchModal, setShowConveraBatchModal] = useState(false);
  const [converaBatchGroups, setConveraBatchGroups] = useState<ConveraBatchGroup[]>([]);
  const [converaBatchCombine, setConveraBatchCombine] = useState<Record<string, boolean>>({});
  const [converaBatchSkipped, setConveraBatchSkipped] = useState<ConveraBatchSkip[]>([]);
  // Invoices from the caller's filter view that were excluded from the batch outright
  // (not approved, or not Convera). Shown as a compact info panel so the accountant can
  // see why the batch total differs from the on-screen filter total.
  type ConveraBatchExcluded = { invoice: Invoice; reason: 'not approved' | 'not Convera' };
  const [converaBatchExcluded, setConveraBatchExcluded] = useState<ConveraBatchExcluded[]>([]);
  // Manual rows appended to the batch export for beneficiaries paid outside the invoice flow
  // (e.g. Monolith, Arpit one-offs). Not persisted — cleared when the modal closes.
  const [converaBatchManualRows, setConveraBatchManualRows] = useState<ConveraBatchManualRow[]>([]);
  const [converaBatchManualEditor, setConveraBatchManualEditor] = useState<{ open: boolean; search: string; benef: ConveraBeneficiary | null; amount: string; ref1: string }>({ open: false, search: '', benef: null, amount: '', ref1: '' });
  // Intuit Batch popup — copy-paste aid for accountant manually entering approved unpaid US
  // invoices into Intuit Online Payment (which has no upload integration). Filters to
  // status=approved + paymentMethod=Intuit + !paidDate. Field-level copy buttons.
  // Paid status auto-reconciles via parseIntuitEmails when Intuit's confirmation email arrives.
  const [showIntuitBatchModal, setShowIntuitBatchModal] = useState(false);
  const [intuitBatchInvoices, setIntuitBatchInvoices] = useState<Invoice[]>([]);
  const [copiedIntuitField, setCopiedIntuitField] = useState<string | null>(null);
  // When accountant edits/creates a profile for another contractor, this overrides currentUser
  // in savePaymentProfile. Null = save against currentUser (contractor's own management page).
  const [profileEditUserId, setProfileEditUserId] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekStart());
  const [timeEntries, setTimeEntries] = useState<Record<string, TimeEntry>>({});
  const [detectedLocation, setDetectedLocation] = useState<{ country: string; region: string; timezone: string } | null>(null);
  const [reminderEmails, setReminderEmails] = useState<ReminderEmail[]>([]);
  const [showReminderLog, setShowReminderLog] = useState(false);
  const [adminView, setAdminView] = useState('users');
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminUserRoleFilter, setAdminUserRoleFilter] = useState('all');
  const [allocationsProjectFilter, setAllocationsProjectFilter] = useState<number | null>(null);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>({
    email: '', password: '', name: '', role: 'timesheetuser', manager_id: null, country: 'US', region: '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '', phone: '', email_approvals_enabled: false, invoice_enabled: false, reminders_enabled: true, vendor_manager_id: null, payment_terms: '', location_type: ''
  });
  const [projectForm, setProjectForm] = useState<ProjectForm>({
    name: '', code: '', status: 'active', description: ''
  });
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedTimesheetForView, setSelectedTimesheetForView] = useState<Timesheet | null>(null);
  const [showWeekendHours, setShowWeekendHours] = useState(false);
  const [showTimesheetModal, setShowTimesheetModal] = useState(false);
  const [selectedTimesheetIds, setSelectedTimesheetIds] = useState<number[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentProfiles, setPaymentProfiles] = useState<PaymentProfile[]>([]);
  const [userTab, setUserTab] = useState<'timesheet' | 'invoices' | 'payment' | 'profile'>('timesheet');
  const [invoiceView, setInvoiceView] = useState<'list' | 'create'>('list');
  const [invoiceMonth, setInvoiceMonth] = useState({ start: '', end: '', label: '' });
  const [invoiceRate, setInvoiceRate] = useState('');
  const [invoiceCurrency, setInvoiceCurrency] = useState('USD');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [selectedPaymentProfileId, setSelectedPaymentProfileId] = useState<number | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  // I3: Invoice filter state + derived pipeline moved to useInvoiceFilters hook.
  // I6: whole return spread into <InvoicesTab {...invoiceFilters} />.
  const invoiceFilters = useInvoiceFilters({ invoices, paymentMethod });
  const [showConveraMatchingModal, setShowConveraMatchingModal] = useState(false);
  const [showManualInvoiceModal, setShowManualInvoiceModal] = useState(false);
  const [converaMatchingSearch, setConveraMatchingSearch] = useState('');
  const [converaMatchingView, setConveraMatchingView] = useState<'profiles' | 'beneficiaries'>('profiles');
  const [copiedVendorId, setCopiedVendorId] = useState<string | null>(null);
  type BeneficiaryFilter = 'all' | 'with_vendor' | 'without_vendor';
  const [beneficiaryFilter, setBeneficiaryFilter] = useState<BeneficiaryFilter>('all');
  type BeneficiarySortKey = 'shortName' | 'vendorId' | 'bankAccount' | 'country' | 'lastUsed' | 'linked';
  const [beneficiarySort, setBeneficiarySort] = useState<{ key: BeneficiarySortKey; dir: 'asc' | 'desc' }>({ key: 'shortName', dir: 'asc' });
  // Payment import (QuickBooks XLSX + Intuit emails + Intuit XLSX + Convera Beneficiaries)
  const [showIntuitImport, setShowIntuitImport] = useState(false);
  const [showConveraImport, setShowConveraImport] = useState(false);
  const [intuitXlsxError, setIntuitXlsxError] = useState('');
  // Intuit XLSX → qb_ingest_events (Slice B of QB Automation Layer)
  const [intuitXlsxFile, setIntuitXlsxFile] = useState<File | null>(null);
  const [intuitXlsxPreview, setIntuitXlsxPreview] = useState<IntuitXlsxRow[] | null>(null);
  const [intuitXlsxImporting, setIntuitXlsxImporting] = useState(false);
  const [intuitXlsxResult, setIntuitXlsxResult] = useState<{ inserted: number; skipped: number } | null>(null);

  // QB Automation Inbox (Slice C — read-only view of qb_ingest_events)
  const [qbIngestEvents, setQbIngestEvents] = useState<QbIngestEvent[]>([]);
  // Slice C: sort state — one per bucket "class" (posted / non-posted / missing-bills).
  type PostedSortKey = 'src' | 'date' | 'counterparty' | 'amount' | 'memo' | 'posted_at';
  const [postedSortKey, setPostedSortKey] = useState<PostedSortKey>('posted_at');
  const [postedSortDir, setPostedSortDir] = useState<'asc' | 'desc'>('desc');
  const togglePostedSort = (k: PostedSortKey) => {
    if (postedSortKey === k) setPostedSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setPostedSortKey(k); setPostedSortDir(k === 'date' || k === 'posted_at' || k === 'amount' ? 'desc' : 'asc'); }
  };
  type NonPostedSortKey = 'src' | 'date' | 'counterparty' | 'amount' | 'memo' | 'status';
  const [nonPostedSortKey, setNonPostedSortKey] = useState<NonPostedSortKey>('date');
  const [nonPostedSortDir, setNonPostedSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleNonPostedSort = (k: NonPostedSortKey) => {
    if (nonPostedSortKey === k) setNonPostedSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setNonPostedSortKey(k); setNonPostedSortDir(k === 'date' || k === 'amount' ? 'desc' : 'asc'); }
  };
  type MissingBillsSortKey = 'period_end' | 'contractor' | 'invoice_number' | 'amount' | 'path' | 'qb_vendor';
  const [missingBillsSortKey, setMissingBillsSortKey] = useState<MissingBillsSortKey>('period_end');
  const [missingBillsSortDir, setMissingBillsSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleMissingBillsSort = (k: MissingBillsSortKey) => {
    if (missingBillsSortKey === k) setMissingBillsSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMissingBillsSortKey(k); setMissingBillsSortDir(k === 'period_end' || k === 'amount' ? 'desc' : 'asc'); }
  };
  // Slice A: invoice IDs that were pushed via G7.5 (proactive Intuit create_bill).
  // Rendered as synthetic rows in the Already Posted bucket so accountant sees
  // both event-driven and invoice-driven pushes in one place with a Resolved
  // column ("created bill: <ref>"). Loaded by loadQbIngestEvents.
  const [qbG75PostedInvoiceIds, setQbG75PostedInvoiceIds] = useState<Set<number>>(new Set());
  // G7.6: parallel to G7.5 but for Convera invoices. Same rendering pattern —
  // synthetic posted rows so accountant sees Convera proactive-create pushes
  // in the same posted bucket. MULTI-YYYY-MM pushes carry N invoice ids each.
  const [qbG76PostedInvoiceIds, setQbG76PostedInvoiceIds] = useState<Set<number>>(new Set());
  // Slice 2: VendorDecisionModal state. Opened by the approval flow when
  // the resolver returns 'ambiguous', or by the Slice 3 "Needs vendor
  // decision" bucket's Resolve button. `afterResolve` re-runs the caller's
  // upstream flow (e.g., the blocked approval) once the vendor is set.
  const [vendorDecisionState, setVendorDecisionState] = useState<{
    invoice: Invoice;
    targetPaymentProfileId: number;
    targetPaymentProfileCompany: string;
    targetPaymentProfileIban: string | null;
    siblingVendorHint?: string;
    conflictNames?: string[];
    afterResolve?: () => Promise<void> | void;
  } | null>(null);
  const [qbIngestLoading, setQbIngestLoading] = useState(false);
  const [qbInboxExpanded, setQbInboxExpanded] = useState<Record<string, boolean>>({
    pending: true, bill_pmt: true, bill_add_and_pmt: true, check: true, ignore: false, posted: false,
  });
  // (Slice B) posted month filter replaced by per-month expandable groups.
  // qbInboxExpanded['posted_month_YYYY-MM'] tracks each month's expand state.
  // Slice F — push preview modal
  const [showQbPushPreview, setShowQbPushPreview] = useState(false);
  const [qbPushRecords, setQbPushRecords] = useState<PushRecord[]>([]);
  // Push-result modal state (replaces the huge browser alert). Sections
  // (ineligible / duplicate / rejected) are each collapsible so a 20+
  // Convera-wire batch doesn't dump an unreadable static wall of text.
  const [pushResult, setPushResult] = useState<{
    summary: string;
    ineligible: string[];
    duplicate: string[];
    rejected: string[];
  } | null>(null);
  // Slice G1 — qbStateSync mirror of QB open bills
  const [qbOpenBills, setQbOpenBills] = useState<QbOpenBillRow[]>([]);
  const [qbSyncingBills, setQbSyncingBills] = useState(false);
  // Slice G1 — QBWC heartbeat: most recent qb_wc_sessions.last_seen_at
  const [qbWcLastSeen, setQbWcLastSeen] = useState<string | null>(null);
  // Slice G1 — count of in-flight bill_query jobs (pending or in_flight status).
  // Polled every 30s while the QB Automation tab is open + > 0 pending. Falls
  // to 0 when QBWC finishes draining; UI auto-refreshes snapshot at that point.
  const [qbBillQueryPending, setQbBillQueryPending] = useState(0);
  // All pending qb_sync_jobs (any kind) for the "N pending" click-to-inspect
  // popup. Loaded alongside the bill_query count on the same poll interval.
  const [qbPendingJobDetails, setQbPendingJobDetails] = useState<Array<{ id: number; kind: string; created_at: string; payload: Record<string, unknown> | null }>>([]);
  const [showPendingJobsPopup, setShowPendingJobsPopup] = useState(false);
  const [qbSyncingVendors, setQbSyncingVendors] = useState(false);
  const [qbVendorQueryPending, setQbVendorQueryPending] = useState(0);
  // Slice D — vendor mapping widget state
  const [qbVendorsList, setQbVendorsList] = useState<QbVendor[]>([]);
  const [qbAccountsList, setQbAccountsList] = useState<QbAccount[]>([]);
  const [qbVendorMappings, setQbVendorMappings] = useState<QbVendorMapping[]>([]);
  // Widget context — carries source + event count so the widget can render
  // as a floating modal at the tab level (opened from Needs Classification
  // OR from the All Mappings management panel below).
  const [mapVendorOpenFor, setMapVendorOpenFor] = useState<{ counterparty: string; source: string; eventCount: number } | null>(null);
  const [mapForm, setMapForm] = useState<{ kind: QbIngestKind; vendorListId: string; bankListId: string; expenseListId: string; vendorSearch: string; payeeFullName: string; payeeListKind: QbPayeeListKind; }>({ kind: 'bill_pmt', vendorListId: '', bankListId: '', expenseListId: '', vendorSearch: '', payeeFullName: '', payeeListKind: 'OtherName' });
  const [mapSaving, setMapSaving] = useState(false);
  // Convera beneficiaries
  const [converaBeneficiaries, setConveraBeneficiaries] = useState<ConveraBeneficiary[]>([]);

  // ── Payments tab state ──────────────────────────────────────────────────────
  const [converaTransactions, setConveraTransactions] = useState<ConveraTransaction[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | 'all'>('all');
  const [paymentsStateFilter, setPaymentsStateFilter] = useState<MatchState | 'all' | 'processed'>('all');
  const [paymentsSortKey, setPaymentsSortKey] = useState<'date' | 'beneficiary' | 'amount' | 'confidence'>('date');
  const [paymentsSortDir, setPaymentsSortDir] = useState<'asc' | 'desc'>('desc');
  const [paymentsImportFile, setPaymentsImportFile] = useState<File | null>(null);
  const [paymentsImporting, setPaymentsImporting] = useState(false);
  const [paymentsImportError, setPaymentsImportError] = useState('');
  const [showHistoricalTxns, setShowHistoricalTxns] = useState(false);
  // Per-row toggle: when true, dropdown also shows wider cross-beneficiary matches
  const [showWiderForTxn, setShowWiderForTxn] = useState<Record<number, boolean>>({});
  const [showProcessPreview, setShowProcessPreview] = useState(false);
  // Staged edits (transient — only committed to DB on Process): map txn id → chosen invoice id(s) or 'no_invoice'
  const [stagedMatches, setStagedMatches] = useState<Record<number, number[] | 'no_invoice'>>({});
  // Notes edited in-place per row (saves directly to convera_transactions.notes on blur;
  // not staged through Process — notes are metadata, no downstream effect on invoices).
  const [notesDrafts, setNotesDrafts] = useState<Record<number, string>>({});
  // Which transaction row currently has the "+ Add invoice" picker open (single popover at a time)
  const [addInvoicePickerFor, setAddInvoicePickerFor] = useState<number | null>(null);
  // Search text for the "+ Add invoice" dropdown. Global (only one picker open at a time
  // per addInvoicePickerFor). Reset on each open. Filters candidate list by userName +
  // invoiceNumber substring — helps with beneficiaries like Bimosoft that have many months
  // of invoices across multiple contractors.
  const [addInvoicePickerSearch, setAddInvoicePickerSearch] = useState<string>('');
  // Disables the Confirm & Process button while handleProcess is running to prevent
  // double-click, and gives clear visual feedback so the UI doesn't look frozen during
  // the 5-15s of sequential DB updates.
  const [processCommitting, setProcessCommitting] = useState<boolean>(false);
  const [paymentsImportSummary, setPaymentsImportSummary] = useState<{
    newCount: number;
    refreshedCount: number;
    skippedCount: number;
    intoHoldingSkipped: number;
    amountChangedRows: { key: string; oldAmount: number; newAmount: number; state: string }[];
    batchId: number | null;
  } | null>(null);
  const [paymentsProcessResult, setPaymentsProcessResult] = useState<{
    matchedCount: number;
    noInvoiceCount: number;
    invoicesPaid: number;
    batchFullyProcessed: boolean;
  } | null>(null);
  // Bumped after every import/rollback to force the file <input> to re-mount fresh —
  // avoids the "browser suppresses onChange for same file" problem without touching the DOM.
  const [paymentsFileInputKey, setPaymentsFileInputKey] = useState(0);
  const [converaLastPaymentDates, setConveraLastPaymentDates] = useState<Map<number, string>>(new Map());
  const [beneficiaryImportFile, setBeneficiaryImportFile] = useState<File | null>(null);
  const [beneficiaryImporting, setBeneficiaryImporting] = useState(false);
  const [beneficiaryImportResult, setBeneficiaryImportResult] = useState<{
    imported: number; matched: number;
    unmatched: { profileId: number; userId: string; userName: string; suggested?: { beneficiaryId: number; level: 'iban' | 'name'; shortName: string; incomingVendorId: string | null } }[];
  } | null>(null);
  const [beneficiaryOverrideProfileId, setBeneficiaryOverrideProfileId] = useState<number | null>(null);
  const [beneficiaryOverrideSearch, setBeneficiaryOverrideSearch] = useState('');
  // PDF attachment
  const [invoiceAttachmentFile, setInvoiceAttachmentFile] = useState<File | null>(null);
  const [invoicePhoneConfirm, setInvoicePhoneConfirm] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileConfirmPassword, setProfileConfirmPassword] = useState('');
  const [bannerPhone, setBannerPhone] = useState('');
  const [bannerCountry, setBannerCountry] = useState('');
  const [bannerCountryOther, setBannerCountryOther] = useState('');
  const [bannerRegion, setBannerRegion] = useState('');
  const [bannerRegionOther, setBannerRegionOther] = useState('');
  const [bannerSaving, setBannerSaving] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [profileShowNewPw, setProfileShowNewPw] = useState(false);
  const [profileShowConfirmPw, setProfileShowConfirmPw] = useState(false);
  const [profilePwLoading, setProfilePwLoading] = useState(false);
  const [profilePhone, setProfilePhone] = useState('');
  const [profilePhoneSaving, setProfilePhoneSaving] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentSignedUrls, setAttachmentSignedUrls] = useState<Record<number, string>>({});
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PaymentProfile | null>(null);
  const emptyProfileForm = (): Omit<PaymentProfile, 'id' | 'userId'> => ({
    profileName: '', companyName: '', companyAddress: '', country: '', bankName: '',
    bankAddress: '', bankBranch: '', accountNumber: '', iban: '', swift: '', paymentEmail: '', isDefault: false, combinePayments: null,
    converaBeneficiaryId: null, converaMatchOverride: false, qbVendorName: null,
  });
  const [profileForm, setProfileForm] = useState(emptyProfileForm());
  // Template-form profile creation (2026-07-15). Parses contractor's pasted bank-details
  // reply into a payment_profile. Convera beneficiary is NOT inserted here — accountant
  // creates it in Convera using the surfaced SYN vendor code, then next beneficiary
  // import closes the loop via SYN match (or IBAN+name fallback).
  const [showTemplateProfileModal, setShowTemplateProfileModal] = useState(false);
  const [templateProfileText, setTemplateProfileText] = useState('');
  const [templateProfileUserId, setTemplateProfileUserId] = useState<string | null>(null);
  const [templateProfilePreview, setTemplateProfilePreview] = useState<ReturnType<typeof parseProfileTemplate> | null>(null);
  const [templateProfileError, setTemplateProfileError] = useState('');
  const [templateProfileSaving, setTemplateProfileSaving] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState(false);

  // ─── On mount: restore session + load data ───────────────────────────────
  useEffect(() => {
    detectUserLocation();

    // Restore existing Supabase session (so page refresh keeps you logged in)
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        if (session.user.id === loadedUserIdRef.current) return;
        loadedUserIdRef.current = session.user.id;
        await loadProfileAndData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked reset link — show set-new-password form
        setPasswordResetMode(true);
        setLoading(false);
      } else if (event === 'SIGNED_IN' && session?.user) {
        if (passwordResetMode) return; // don't redirect while resetting password
        // Guard: gotrue-js can re-fire SIGNED_IN after lock recovery (React StrictMode / tab focus).
        // Skip if we already have data loaded for this user.
        if (session.user.id === loadedUserIdRef.current) return;
        loadedUserIdRef.current = session.user.id;
        await loadProfileAndData(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        loadedUserIdRef.current = null;
        setCurrentUser(null);
        setPasswordResetMode(false);
        setUsers([]);
        setProjects([]);
        setTimesheets([]);
        setInvoices([]);
        setPaymentProfiles([]);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { timesheetsRef.current = timesheets; }, [timesheets]);

  // ─── Reminder interval ────────────────────────────────────────────────────
  useEffect(() => {
    if (users.length > 0) {
      checkAndSendReminders();
      const interval = setInterval(checkAndSendReminders, 3600000);
      return () => clearInterval(interval);
    }
  }, [users.length, timesheets.length]);

  // ─── Real-time: listen for timesheet changes (managers see live updates) ──
  useEffect(() => {
    if (currentUser?.country) setBannerCountry(currentUser.country);
    if (currentUser?.region) setBannerRegion(currentUser.region);
  }, [currentUser?.id]);


  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase.channel('timesheets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timesheets' }, () => {
        fetchTimesheets();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.id]);


  // ─── Data loading helpers ─────────────────────────────────────────────────
  async function loadProfileAndData(userId: string) {
    setLoading(true);
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error || !profile) { setLoading(false); return; }

      // Normalise DB column names → camelCase used in the UI
      const normalisedProfile = normaliseProfile(profile);
      setCurrentUser(normalisedProfile);

      await Promise.all([fetchUsers(), fetchProjects(), fetchTimesheets(), fetchInvoices(), fetchPaymentProfiles()]);

      // Accountants and admins need the Convera beneficiary list pre-loaded for the
      // Payment Profiles tab and CSV export — otherwise everything reads as "Needs benef"
      // until they open the matching modal.
      if (normalisedProfile.role === 'accountant' || normalisedProfile.role === 'admin') {
        loadConveraBeneficiaries();
      }

      if (normalisedProfile.role === 'timesheetuser') {
        loadTimesheetForWeek(normalisedProfile.id, getCurrentWeekStart(), timesheetsRef.current);
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    const [{ data, error }, { data: loginData }] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase.rpc('get_user_last_logins'),
    ]);
    if (error) console.error('fetchUsers failed:', error.message);
    if (data) {
      const loginMap = new Map<string, string>((loginData ?? []).map((r: { id: string; last_sign_in_at: string }) => [r.id, r.last_sign_in_at]));
      setUsers(data.map(p => ({ ...normaliseProfile(p), lastLogin: loginMap.get(p.id) ?? null })));
    }
  }

  // Applies a single-field profile update with RLS-block detection and optimistic UI.
  async function updateProfileField(userId: string, field: string, value: unknown) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, [field === 'reminders_enabled' ? 'remindersEnabled' : field === 'invoice_enabled' ? 'invoiceEnabled' : field]: value } : u));
    const { data: updated, error } = await supabase.from('profiles').update({ [field]: value }).eq('id', userId).select('id');
    if (error) { alert('Error: ' + error.message); await fetchUsers(); return; }
    if (!updated || updated.length === 0) { alert('Update failed — your session may have expired. Please refresh the page.'); await fetchUsers(); return; }
    await fetchUsers();
  }

  function isBannerDismissed(): boolean {
    if (bannerDismissed) return true;
    if (!currentUser) return true;
    const key = `profile_reminder_${currentUser.id}`;
    const stored = localStorage.getItem(key);
    if (!stored) return false;
    const ts = parseInt(stored, 10);
    return Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
  }

  function dismissBanner() {
    if (!currentUser) return;
    localStorage.setItem(`profile_reminder_${currentUser.id}`, String(Date.now()));
    setBannerDismissed(true);
  }

  function handleBannerCountryChange(newCountry: string) {
    setBannerCountry(newCountry);
    setBannerRegionOther('');
    if (newCountry === '__other__') {
      setBannerRegion(''); // unknown country — can't auto-fill region
      return;
    }
    setBannerCountryOther('');
    const countryData = countries.find(c => c.code === newCountry);
    if (countryData && countryData.regions.length === 1) {
      setBannerRegion(countryData.regions[0]); // auto-fill single-region countries
    } else {
      setBannerRegion(''); // reset so user picks a region
    }
  }

  async function saveBannerProfile() {
    if (!currentUser) return;
    setBannerSaving(true);
    const resolvedCountry = bannerCountry === '__other__' ? bannerCountryOther.trim() : bannerCountry;
    const resolvedRegion = bannerRegion === '__other__' ? bannerRegionOther.trim() : bannerRegion;
    const updates: Record<string, string> = {};
    if (bannerPhone.trim()) updates.phone = bannerPhone.trim();
    if (resolvedCountry && resolvedCountry !== currentUser.country) updates.country = resolvedCountry;
    if (resolvedRegion && resolvedRegion !== currentUser.region) updates.region = resolvedRegion;
    if (Object.keys(updates).length === 0) { setBannerSaving(false); return; }
    const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);
    if (error) { alert('Save failed: ' + error.message); setBannerSaving(false); return; }
    setCurrentUser(prev => prev ? { ...prev, phone: updates.phone ?? prev.phone, country: updates.country ?? prev.country, region: updates.region ?? prev.region } : prev);
    setBannerDismissed(true);
    setBannerSaving(false);
  }

  async function fetchProjects() {
    const { data } = await supabase.from('projects').select('*').order('name');
    if (data) setProjects(data);
  }

  async function fetchTimesheets() {
    // GOTCHA: unbounded wholesale fetch. Supabase PostgREST caps responses at
    // max_rows (currently 10000, raised from 1000 on 2026-08-26). At ~65
    // contractors × ~1 week, we hit 10k in ~2 years. When admin view starts
    // dropping rows, paginate here or add a rolling-window filter.
    const { data } = await supabase
      .from('timesheets')
      .select('*')
      .order('week_start', { ascending: false });
    if (data) {
      const normalised = data.map(normaliseTimesheet);
      setTimesheets(normalised);
      timesheetsRef.current = normalised;
    }
  }

  // ─── Normalise DB snake_case → camelCase for UI compatibility ─────────────
  function normaliseProfile(p: Record<string, unknown>): UserProfile {
    return {
      id: p.id as string,
      username: (p.username as string) || (p.email as string)?.split('@')[0] || '',
      name: p.name as string,
      role: p.role as UserProfile['role'],
      managerId: (p.manager_id as string) || null,
      email: p.email as string,
      country: (p.country as string) || 'US',
      region: (p.region as string) || '',
      projectId: (p.project_id as number) || null,
      startDate: (p.start_date as string) || null,
      endDate: (p.end_date as string) || null,
      phone: (p.phone as string) || null,
      emailApprovalsEnabled: !!(p.email_approvals_enabled as boolean),
      invoiceEnabled: p.invoice_enabled === undefined ? true : !!(p.invoice_enabled as boolean),
      remindersEnabled: p.reminders_enabled === undefined ? true : !!(p.reminders_enabled as boolean),
      vendorManagerId: (p.vendor_manager_id as string) || null,
      lastLogin: null,
      paymentTerms: (p.payment_terms as string) || null,
      locationType: (p.location_type as 'onshore' | 'offshore' | null) || null,
    };
  }

  function normaliseTimesheet(t: Record<string, unknown>): Timesheet {
    // Entries from imported timesheets are flat { date: number }
    // Native timesheets use { date: { hours: string } }
    // Normalise both to { date: { hours: string } }
    const rawEntries = (t.entries as Record<string, unknown>) || {};
    const normalisedEntries: Record<string, TimeEntry> = {};
    Object.entries(rawEntries).forEach(([date, val]) => {
      if (typeof val === 'number') {
        normalisedEntries[date] = { hours: String(val) };
      } else if (typeof val === 'object' && val !== null && 'hours' in val) {
        normalisedEntries[date] = val as TimeEntry;
      } else if (typeof val === 'object') {
        normalisedEntries[date] = { hours: '0' };
      } else {
        normalisedEntries[date] = { hours: String(val ?? 0) };
      }
    });
    return {
      id: t.id as number,
      userId: t.user_id as string,
      userName: t.user_name as string,
      projectId: (t.project_id as number) || null,
      weekStart: (t.week_start as string).split('T')[0],
      entries: normalisedEntries,
      status: t.status as Timesheet['status'],
      source: (t.source as Timesheet['source']) || null,
      submittedAt: t.submitted_at as string,
      approvedAt: (t.approved_at as string) || null,
      lockedDays: (t.locked_days as string[]) || null,
    };
  }

  // ─── Pure utility functions ───────────────────────────────────────────────
  function getCurrentWeekStart() {
    const today = new Date();
    const day = today.getDay();
    // Week identified by its Monday; display will show W/E Friday
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(today.getFullYear(), today.getMonth(), diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  function detectUserLocation() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let detectedCountry = 'US', detectedRegion = '';
    if (timezone.includes('America/Los_Angeles')) { detectedCountry = 'US'; detectedRegion = 'California'; }
    else if (timezone.includes('America/New_York')) { detectedCountry = 'US'; detectedRegion = 'New York'; }
    else if (timezone.includes('Europe/London')) { detectedCountry = 'GB'; detectedRegion = 'England'; }
    else if (timezone.includes('America/Toronto')) { detectedCountry = 'CA'; detectedRegion = 'Ontario'; }
    else if (timezone.includes('Europe/Zagreb')) { detectedCountry = 'HR'; detectedRegion = 'Croatia'; }
    else if (timezone.includes('Europe/Belgrade')) { detectedCountry = 'RS'; detectedRegion = 'Serbia'; }
    else if (timezone.includes('Europe/Sarajevo')) { detectedCountry = 'BA'; detectedRegion = 'Bosnia and Herzegovina'; }
    else if (timezone.includes('Europe/Ljubljana')) { detectedCountry = 'SI'; detectedRegion = 'Slovenia'; }
    else if (timezone.includes('Europe/Skopje')) { detectedCountry = 'MK'; detectedRegion = 'North Macedonia'; }
    setDetectedLocation({ country: detectedCountry, region: detectedRegion, timezone });
  }

  function getUserLocalTime(user: UserProfile): Date {
    const tz = tzMap[user.country + '-' + user.region]
      || tzMap[user.country + '-']
      || 'America/New_York';
    return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  }

  function getMissingWeeksSince(startDate: string, timesheets: Timesheet[], userId: string, endDate?: string | null): string[] {
    const start = parseLocalDate(startDate);
    // Align to Monday of the week containing start date
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);

    const thisWeekStart = getCurrentWeekStart();

    let ceiling = thisWeekStart;
    if (endDate) {
      const end = parseLocalDate(endDate);
      end.setHours(0, 0, 0, 0);
      const endDay = end.getDay();
      const endDiff = endDay === 0 ? -6 : 1 - endDay;
      const endWeekStart = new Date(end);
      endWeekStart.setDate(end.getDate() + endDiff);
      endWeekStart.setHours(0, 0, 0, 0);
      const endCeiling = new Date(endWeekStart);
      endCeiling.setDate(endWeekStart.getDate() + 7);
      if (endCeiling < thisWeekStart) ceiling = endCeiling;
    }

    const missing: string[] = [];
    const cursor = new Date(start);

    while (cursor < ceiling) {
      const weekKey = formatDate(cursor);
      const submitted = timesheets.some(
        t => t.userId === userId && t.weekStart === weekKey && t.status !== 'rejected'
      );
      if (!submitted) missing.push(weekKey);
      cursor.setDate(cursor.getDate() + 7);
    }

    return missing;
  }

  async function sendReminderEmail(user: UserProfile, subject: string, body: string) {
    const userLocalTime = getUserLocalTime(user);
    const today = formatDate(userLocalTime);

    // Avoid duplicate in-app reminders
    setReminderEmails(prev => {
      const alreadySent = prev.some(r => r.userId === user.id && r.sentDate === today);
      if (alreadySent) return prev;
      return [...prev, {
        id: Date.now() + Math.random(),
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        reminderType: subject.includes('URGENT') ? 'second' : 'first',
        weekStart: formatDate(getCurrentWeekStart()),
        sentDate: today,
        sentTime: userLocalTime.toLocaleString(),
        subject,
        message: body,
      }];
    });

    // Send real email via Supabase Edge Function
    try {
      const { error } = await supabase.functions.invoke('send-reminder', {
        body: { to: user.email, subject, body, userName: user.name },
      });
      if (error) console.warn('Email send failed for', user.email, error);
    } catch (err) {
      console.warn('Edge function not available — in-app reminder only:', err);
    }
  }

  function checkAndSendReminders() {
    const timesheetUsers = users.filter(u => u.role === 'timesheetuser' && u.startDate);
    const allTimesheets = timesheetsRef.current;

    timesheetUsers.forEach(user => {
      // Skip if user's end date has passed
      if (user.endDate) {
        const end = parseLocalDate(user.endDate);
        end.setHours(23, 59, 59, 999);
        if (new Date() > end) return;
      }

      const userLocalTime = getUserLocalTime(user);
      const dayOfWeek = userLocalTime.getDay();
      const hour = userLocalTime.getHours();

      const isTriggerTime = (dayOfWeek === 5 && hour === 17) || (dayOfWeek === 1 && hour === 11);
      if (!isTriggerTime) return;

      const missingWeeks = getMissingWeeksSince(user.startDate!, allTimesheets, user.id, user.endDate);
      if (missingWeeks.length === 0) return;

      const isUrgent = dayOfWeek === 1;
      const weekList = missingWeeks.map(w => {
        const fri = new Date(parseLocalDate(w)); fri.setDate(parseLocalDate(w).getDate() + 4);
        return `  • Week ending ${fri.toLocaleDateString()}`;
      }).join('\n');

      const subject = isUrgent
        ? `URGENT: ${missingWeeks.length} Timesheet(s) Overdue`
        : `Reminder: ${missingWeeks.length} Timesheet(s) Need Submission`;

      const body = isUrgent
        ? `Hi ${user.name},\n\nYou have ${missingWeeks.length} timesheet(s) that have not been submitted:\n\n${weekList}\n\nPlease log in and submit them as soon as possible.`
        : `Hi ${user.name},\n\nThis is a reminder that the following timesheet(s) are missing:\n\n${weekList}\n\nPlease submit them by end of day Friday.`;

      sendReminderEmail(user, subject, body);
    });
  }

  function isHoliday(date: Date, country: string) {
    const dateStr = formatDate(date);
    const year = dateStr.slice(0, 4);
    return (holidaysByYear[year]?.[country] || []).find(h => h.date === dateStr);
  }


  // ─── AUTH ─────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginForm.email,
      password: loginForm.password,
    });
    if (error || !data.user) {
      alert('Invalid email or password. Please try again.');
      setLoading(false);
      return;
    }
    // onAuthStateChange will call loadProfileAndData automatically
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // onAuthStateChange handles state cleanup
  };

  // ─── TIMESHEET USER OPERATIONS ────────────────────────────────────────────
  const loadTimesheetForWeek = (userId: string, weekStart: Date, tsList?: Timesheet[]) => {
    const weekKey = formatDate(weekStart);
    const list = tsList !== undefined ? tsList : timesheetsRef.current;
    const existing = list.find(t => t.userId === userId && t.weekStart === weekKey);
    const user = users.find(u => u.id === userId) || currentUser;

    if (existing) {
      setTimeEntries(existing.entries);
      // Show weekend rows if any weekend hours exist
      const hasWeekendHours = Object.entries(existing.entries).some(([dateKey, entry]) => {
        const d = parseLocalDate(dateKey);
        const dayOfWeek = d.getDay();
        return (dayOfWeek === 0 || dayOfWeek === 6) && parseFloat((entry as TimeEntry)?.hours || '0') > 0;
      });
      setShowWeekendHours(hasWeekendHours);
    } else {
      const entries: Record<string, TimeEntry> = {};
      getWeekDates(weekStart).forEach(date => {
        const dateKey = formatDate(date);
        const holiday = user && isHoliday(date, user.country);
        const weekend = isWeekend(date);
        entries[dateKey] = {
          hours: '0',
          isHoliday: holiday || undefined,
          holidayName: holiday?.name,
          isWeekend: weekend
        };
      });
      setTimeEntries(entries);
      setShowWeekendHours(false);
    }
  };

  const handleTimeEntry = (date: string, hours: string) => {
    setTimeEntries(prev => ({ ...prev, [date]: { ...prev[date], hours } }));
  };

  const submitTimesheet = async () => {
    if (!currentUser!.projectId) {
      alert('Please select a project before submitting your timesheet.');
      return;
    }
    const totalHoursForWeek = Object.values(timeEntries).reduce(
      (sum, entry) => sum + (parseFloat(entry?.hours || '0') || 0),
      0,
    );
    if (totalHoursForWeek === 0) {
      const weekDates = getWeekDates(selectedWeek);
      const sundayLabel = weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const confirmed = window.confirm(
        `You're about to submit a timesheet with 0 hours for W/E ${sundayLabel}.\n\n` +
        `Common reasons: PTO, sick leave, holiday, or leave of absence.\n\n` +
        `If this is a mistake, cancel and add your hours before submitting.\n\n` +
        `Continue with 0-hour submission?`,
      );
      if (!confirmed) return;
    }
    const weekKey = formatDate(selectedWeek);
    const now = new Date().toISOString();
    const hasManager = !!currentUser!.managerId;
    const { error } = await supabase.from('timesheets').upsert({
      user_id: currentUser!.id,
      user_name: currentUser!.name,
      project_id: currentUser!.projectId,
      week_start: weekKey,
      entries: timeEntries,
      status: hasManager ? 'pending' : 'approved',
      submitted_at: now,
      ...(hasManager ? {} : { approved_at: now, approved_by: 'self-submit' }),
    }, { onConflict: 'user_id,week_start' });

    if (error) { alert('Error submitting timesheet: ' + error.message); return; }
    await fetchTimesheets();
    alert('Timesheet submitted successfully!');
  };

  // ─── MANAGER / APPROVAL OPERATIONS ───────────────────────────────────────
  const handleApproval = async (timesheetId: number, status: string) => {
    const { error } = await supabase.from('timesheets')
      .update({ status, approved_at: new Date().toISOString() })
      .eq('id', timesheetId);
    if (error) { alert('Error updating timesheet: ' + error.message); return; }
    setTimesheets(prev => prev.map(t => t.id === timesheetId ? { ...t, status: status as Timesheet['status'], approvedAt: new Date().toISOString() } : t));
  };

  const bulkApproveTimesheets = async (status: string) => {
    if (selectedTimesheetIds.length === 0) { alert('Please select at least one timesheet'); return; }
    const action = status === 'approved' ? 'approve' : 'reject';
    if (!window.confirm(`Are you sure you want to ${action} ${selectedTimesheetIds.length} timesheet(s)?`)) return;

    const { error } = await supabase.from('timesheets')
      .update({ status, approved_at: new Date().toISOString() })
      .in('id', selectedTimesheetIds);
    if (error) { alert('Error: ' + error.message); return; }
    await fetchTimesheets();
    setSelectedTimesheetIds([]);
    alert(`Successfully ${action}d ${selectedTimesheetIds.length} timesheet(s)!`);
  };

  // ─── ADMIN: USER MANAGEMENT ───────────────────────────────────────────────
  const generatePassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*';
    const all = upper + lower + digits + symbols;
    const required = [
      upper[Math.floor(Math.random() * upper.length)],
      lower[Math.floor(Math.random() * lower.length)],
      digits[Math.floor(Math.random() * digits.length)],
      symbols[Math.floor(Math.random() * symbols.length)],
    ];
    const rest = Array.from({ length: 8 }, () => all[Math.floor(Math.random() * all.length)]);
    return [...required, ...rest].sort(() => Math.random() - 0.5).join('');
  };

  const openUserModal = (user?: UserProfile) => {
    if (user) {
      setEditingUser(user ?? null);
      setUserForm({ email: user.email, password: '', name: user.name, role: user.role, manager_id: user.managerId, country: user.country, region: user.region, project_id: user.projectId, start_date: user.startDate || '', end_date: user.endDate || '', phone: user.phone || '', email_approvals_enabled: user.emailApprovalsEnabled || false, invoice_enabled: user.invoiceEnabled !== false, reminders_enabled: user.remindersEnabled !== false, vendor_manager_id: user.vendorManagerId || null, payment_terms: user.paymentTerms || '', location_type: user.locationType || '' });
    } else {
      setEditingUser(null);
      const autoPassword = generatePassword();
      setUserForm({ email: '', password: autoPassword, name: '', role: 'timesheetuser', manager_id: null, country: detectedLocation?.country || 'US', region: detectedLocation?.region || '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '', phone: '', email_approvals_enabled: false, invoice_enabled: false, reminders_enabled: true, vendor_manager_id: null, payment_terms: '', location_type: '' });
    }
    setShowUserModal(true);
  };

  const openQuickAddModal = () => {
    setEditingUser(null);
    setUserForm({ email: '', password: generatePassword(), name: '', role: 'timesheetuser', manager_id: null, country: detectedLocation?.country || 'US', region: detectedLocation?.region || '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '', phone: '', email_approvals_enabled: false, invoice_enabled: false, reminders_enabled: true, vendor_manager_id: null, payment_terms: '', location_type: '' });
    setShowQuickAddModal(true);
  };

  const saveUser = async () => {
    if (!userForm.name || !userForm.email || !userForm.country) {
      alert('Please fill in all required fields'); return;
    }
    const emailRegex = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
    if (!emailRegex.test(userForm.email.trim())) {
      alert(`"${userForm.email}" doesn't look like a valid email address. Please check for typos (e.g. .om instead of .com).`); return;
    }

    if (editingUser) {
      const updates = {
        name: userForm.name,
        role: userForm.role,
        manager_id: userForm.manager_id,
        country: userForm.country,
        region: userForm.region,
        project_id: userForm.project_id,
        start_date: userForm.start_date || null,
        end_date: userForm.end_date || null,
        phone: userForm.phone || null,
        email_approvals_enabled: userForm.email_approvals_enabled,
        invoice_enabled: userForm.invoice_enabled,
        reminders_enabled: userForm.reminders_enabled,
        vendor_manager_id: userForm.vendor_manager_id || null,
        payment_terms: userForm.payment_terms || null,
        location_type: userForm.role === 'timesheetuser' ? (userForm.location_type || null) : null,
      };
      const { data: updated, error } = await supabase.from('profiles').update(updates).eq('id', editingUser.id).select('id');
      if (error) { alert('Error updating user: ' + error.message); return; }
      if (!updated || updated.length === 0) { alert('Save failed — your session may have expired. Please refresh the page and try again.'); return; }
      await fetchUsers();
      setShowUserModal(false);
      setEditingUser(null);
    } else {
      // Create new user via admin edge function (no public signups required)
      if (!userForm.password) { alert('Password is required for new users'); return; }
      if (userForm.password.length < 6) { alert('Password must be at least 6 characters'); return; }

      const { data: { session } } = await supabase.auth.getSession();
      const fnUrl = `${(supabase as any).supabaseUrl}/functions/v1/create-user`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': (supabase as any).supabaseKey,
        },
        body: JSON.stringify({
          email: userForm.email,
          password: userForm.password,
          name: userForm.name,
          role: userForm.role,
          country: userForm.country,
          region: userForm.region,
          manager_id: userForm.manager_id,
          project_id: userForm.project_id,
          start_date: userForm.start_date || null,
          end_date: userForm.end_date || null,
          phone: userForm.phone || null,
          email_approvals_enabled: userForm.email_approvals_enabled,
          invoice_enabled: userForm.invoice_enabled,
          reminders_enabled: userForm.reminders_enabled,
          vendor_manager_id: userForm.vendor_manager_id || null,
          payment_terms: userForm.payment_terms || null,
          location_type: userForm.role === 'timesheetuser' ? (userForm.location_type || null) : null,
        }),
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        alert('Error creating user: ' + (result.error || res.statusText));
        return;
      }

      const createdName = userForm.name;

      await fetchUsers();
      setShowUserModal(false);
      setShowQuickAddModal(false);
      setEditingUser(null);

      alert(`User "${createdName}" created. Use Send Invite to email them portal access when ready.`);
    }
  };

  const sendInvite = async (user: UserProfile) => {
    if (!window.confirm(`Send a portal invite to ${user.name} (${user.email})?`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fnUrl = `${(supabase as any).supabaseUrl}/functions/v1/send-reminder`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || (supabase as any).supabaseKey}`,
          'apikey': (supabase as any).supabaseKey,
        },
        body: JSON.stringify({ action: 'invite', toEmail: user.email, toName: user.name }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Invite failed: ${JSON.stringify(data)}`); return; }
      alert(`Invite sent to ${user.email}.`);
    } catch (err: unknown) {
      alert(`Invite failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const loginAsUser = async (user: UserProfile) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fnUrl = `${(supabase as any).supabaseUrl}/functions/v1/impersonate-user`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || (supabase as any).supabaseKey}`,
          'apikey': (supabase as any).supabaseKey,
        },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`Could not impersonate user: ${data.error}`); return; }
      window.open(data.url, '_blank');
    } catch (err: unknown) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const deleteUser = async (userId: string) => {
    if (userId === currentUser!.id) { alert('You cannot delete your own account.'); return; }
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    // Delete profile (timesheets cascade automatically per schema)
    const { error } = await supabase.from('profiles').delete().eq('id', userId);
    if (error) { alert('Error deleting user: ' + error.message); return; }
    await fetchUsers();
    await fetchTimesheets();
  };

  // ─── ADMIN: PROJECT MANAGEMENT ────────────────────────────────────────────
  const openProjectModal = (project?: Project) => {
    if (project) {
      setEditingProject(project ?? null);
      setProjectForm({ name: project.name, code: project.code, status: project.status, description: project.description || '' });
    } else {
      setEditingProject(null);
      setProjectForm({ name: '', code: '', status: 'active', description: '' });
    }
    setShowProjectModal(true);
  };

  const saveProject = async () => {
    if (!projectForm.name || !projectForm.code) { alert('Please fill in all required fields'); return; }
    if (editingProject) {
      const { error } = await supabase.from('projects').update(projectForm).eq('id', editingProject.id);
      if (error) { alert('Error updating project: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('projects').insert(projectForm);
      if (error) { alert('Error creating project: ' + error.message); return; }
    }
    await fetchProjects();
    setShowProjectModal(false);
    setEditingProject(null);
  };

  const deleteProject = async (projectId: number) => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) { alert('Error deleting project: ' + error.message); return; }
    // Clear project_id from affected profiles
    await supabase.from('profiles').update({ project_id: null }).eq('project_id', projectId);
    await fetchProjects();
    await fetchUsers();
  };

  // ─── INVOICE & PAYMENT PROFILE OPERATIONS ────────────────────────────────
  async function fetchInvoices() {
    const { data } = await supabase.from('invoices').select('*').order('submitted_at', { ascending: false });
    if (data) setInvoices(data.map(normaliseInvoice));
  }

  async function fetchPaymentProfiles() {
    const { data } = await supabase.from('payment_profiles').select('*').order('is_default', { ascending: false });
    if (data) setPaymentProfiles(data.map(normalisePaymentProfile));
  }

  function normaliseConveraBeneficiary(r: Record<string, unknown>): ConveraBeneficiary {
    return {
      id: r.id as number,
      beneficiaryId: r.beneficiary_id as string,
      shortName: r.short_name as string,
      beneficiaryName: r.beneficiary_name as string,
      beneficiaryCountry: r.beneficiary_country as string | null ?? null,
      vendorId: (r.vendor_id as string | null) ?? null,
      currency: (r.currency as string) || '',
      defaultPaymentMethod: (r.default_payment_method as string) || '',
      bankName: r.bank_name as string | null ?? null,
      bankCountry: r.bank_country as string | null ?? null,
      bankAccount: (r.bank_account as string) || '',
      ibanUnique: !!(r.iban_unique as boolean),
      deprecated: !!(r.deprecated as boolean),
      replacementBeneficiaryId: (r.replacement_beneficiary_id as number | null) ?? null,
      deprecatedReason: (r.deprecated_reason as string | null) ?? null,
      forceCombine: !!(r.force_combine as boolean),
    };
  }

  async function loadConveraBeneficiaries() {
    if (converaBeneficiaries.length > 0) return;
    const { data } = await supabase.from('convera_beneficiaries').select('*').order('short_name');
    if (data) setConveraBeneficiaries(data.map(normaliseConveraBeneficiary));
  }

  // ── Payments tab loaders ────────────────────────────────────────────────────
  function normaliseConveraTransaction(r: Record<string, unknown>, umbrellaMap?: Record<number, number[]>): ConveraTransaction {
    return {
      id:                   r.id as number,
      confirmationNumber:   r.confirmation_number as string,
      lineItem:             r.line_item as number,
      dateOfOrder:          r.date_of_order as string,
      beneficiaryName:      r.beneficiary_name as string,
      subtotal:             (r.subtotal as number) ?? null,
      serviceCharges:       (r.service_charges as number) ?? null,
      grandTotal:           (r.grand_total as number) ?? null,
      foreignAmount:        (r.foreign_amount as number) ?? null,
      ref1:                 (r.ref1 as string) ?? null,
      itemType:             (r.item_type as string) ?? null,
      converaBeneficiaryId: (r.convera_beneficiary_id as number) ?? null,
      importBatchId:        (r.import_batch_id as number) ?? null,
      matchedInvoiceId:     (r.matched_invoice_id as number) ?? null,
      matchState:           (r.match_state as MatchState) ?? 'unreviewed',
      matchConfidence:      (r.match_confidence as MatchConfidence) ?? null,
      matchLevel:           (r.match_level as number) ?? null,
      matchedAt:            (r.matched_at as string) ?? null,
      matchedBy:            (r.matched_by as string) ?? null,
      notes:                (r.notes as string) ?? null,
      matchedInvoiceIds:    umbrellaMap?.[r.id as number],
      matcherIgnore:        Boolean(r.matcher_ignore),
      qbPaymentExportStatus: ((r.qb_payment_export_status as string) || 'not_exported') as ConveraTransaction['qbPaymentExportStatus'],
      qbPaymentExportStatusAt: (r.qb_payment_export_status_at as string) || null,
      qbBillpmtTxnId: (r.qb_billpmt_txn_id as string) ?? null,
    };
  }

  function normaliseImportBatch(r: Record<string, unknown>): ImportBatch {
    return {
      id:              r.id as number,
      source:          r.source as string,
      sourceFilename:  (r.source_filename as string) ?? null,
      importedAt:      r.imported_at as string,
      importedBy:      (r.imported_by as string) ?? null,
      rowCount:        (r.row_count as number) ?? 0,
      state:           (r.state as ImportBatchState) ?? 'pending',
    };
  }

  async function fetchImportBatches() {
    const { data } = await supabase.from('import_batches').select('*').order('imported_at', { ascending: false });
    if (data) setImportBatches(data.map(normaliseImportBatch));
  }

  async function fetchConveraTransactions() {
    const [txnRes, umbrellaRes] = await Promise.all([
      supabase.from('convera_transactions').select('*').order('date_of_order', { ascending: false }),
      supabase.from('convera_transaction_invoices').select('transaction_id, invoice_id'),
    ]);
    const umbrellaMap: Record<number, number[]> = {};
    (umbrellaRes.data || []).forEach((r: { transaction_id: number; invoice_id: number }) => {
      (umbrellaMap[r.transaction_id] ||= []).push(r.invoice_id);
    });
    if (txnRes.data) setConveraTransactions(txnRes.data.map((r: Record<string, unknown>) => normaliseConveraTransaction(r, umbrellaMap)));
  }

  // Load Payments tab data lazily when tab is opened
  useEffect(() => {
    if (accountantTab !== 'payments') return;
    if (currentUser?.role !== 'accountant') return;
    fetchImportBatches();
    fetchConveraTransactions();
    loadConveraBeneficiaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountantTab, currentUser?.role]);

  // Load QB Automation Inbox lazily when tab is opened
  const loadQbIngestEvents = async () => {
    setQbIngestLoading(true);
    const [eventsRes, proactiveJobsRes] = await Promise.all([
      supabase.from('qb_ingest_events').select('*').order('ingested_at', { ascending: false }),
      // Slice A + G7.6: identify proactive-create pushes so the posted bucket
      // can include them alongside event-driven posts. Two audit-tag prefixes:
      //   'intuit-invoice-create-bill'   → G7.5 (Intuit invoices)
      //   'convera-invoice-create-bill'  → G7.6 (Convera invoices)
      supabase.from('qb_sync_jobs').select('payload, status').eq('kind', 'bill_add').eq('status', 'done'),
    ]);
    if (!eventsRes.error) setQbIngestEvents((eventsRes.data ?? []).map(normaliseQbIngestEvent));
    if (!proactiveJobsRes.error) {
      const g75Ids = new Set<number>();
      const g76Ids = new Set<number>();
      for (const row of (proactiveJobsRes.data ?? []) as Array<{ payload: { __audit_tag?: string; sourceInvoiceIds?: number[] } | null }>) {
        const tag = row.payload?.__audit_tag ?? '';
        const ids = row.payload?.sourceInvoiceIds ?? [];
        if (tag.startsWith('intuit-invoice-create-bill')) {
          for (const id of ids) g75Ids.add(id);
        } else if (tag.startsWith('convera-invoice-create-bill')) {
          for (const id of ids) g76Ids.add(id);
        }
      }
      setQbG75PostedInvoiceIds(g75Ids);
      setQbG76PostedInvoiceIds(g76Ids);
    }
    setQbIngestLoading(false);
  };
  // Option 4: recompute matched_invoice_ids for all pending events in DB using the
  // current matcher + current invoices state. Never touches ready/ignored/posted.
  // Silent no-op for events whose matches didn't change. Called automatically on
  // Inbox tab load, and manually via the "Recompute matches" button.
  const recomputeMatchesForPending = async (): Promise<{ scanned: number; updated: number; skipped?: string }> => {
    // Guard: if invoices haven't loaded yet, DO NOT run the matcher. An empty
    // invoices set would produce empty matches and diff-write them back over
    // whatever good matches are already stored — real destructive bug.
    if (invoices.length === 0) {
      console.warn('QB Automation recompute: invoices state empty — skipping to avoid clobbering matched_invoice_ids');
      return { scanned: 0, updated: 0, skipped: 'invoices-not-loaded' };
    }
    const { data: pendingRows } = await supabase
      .from('qb_ingest_events')
      .select('id, source, txn_date, counterparty_raw, amount, matched_invoice_ids, raw_data')
      .eq('status', 'pending')
      // Only Intuit XLS uses matchEventsToInvoices (needs raw_data.invoice_refs).
      // Convera events matched via the Payments-tab matcher; their matched_invoice_ids
      // are authoritative — recomputing here would overwrite [1,2,3] with [] because
      // Convera raw_data has no invoice_refs.
      .eq('source', 'intuit_xlsx');
    const events = (pendingRows ?? []) as Array<{ id: number; source: string; txn_date: string; counterparty_raw: string; amount: number; matched_invoice_ids: number[]; raw_data: Record<string, unknown> | null }>;
    if (events.length === 0) return { scanned: 0, updated: 0 };
    const matcherInvoices: MatcherInvoice[] = invoices.map(i => ({
      id: i.id, invoiceNumber: i.invoiceNumber, totalAmount: i.totalAmount,
      periodEnd: i.periodEnd, userName: i.userName, companyName: i.paymentProfile?.companyName ?? null,
    }));
    const inputs: MatchableEvent[] = events.map(e => ({
      date: e.txn_date,
      counterpartyRaw: e.counterparty_raw,
      amount: Number(e.amount),
      invoiceRefs: Array.isArray(e.raw_data?.invoice_refs) ? (e.raw_data!.invoice_refs as string[]) : [],
    }));
    const results = matchEventsToInvoices(inputs, matcherInvoices);
    // Diff — only PATCH rows whose match set actually changed. Sort for order-agnostic compare.
    const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    let updated = 0;
    for (let i = 0; i < events.length; i++) {
      const oldIds = [...(events[i].matched_invoice_ids ?? [])].sort((a, b) => a - b);
      const newIds = [...results[i]].sort((a, b) => a - b);
      if (eq(oldIds, newIds)) continue;
      const { error } = await supabase.from('qb_ingest_events').update({ matched_invoice_ids: newIds }).eq('id', events[i].id);
      if (!error) updated++;
    }
    return { scanned: events.length, updated };
  };
  // Slice F.5 — auto-classification pass. Applies two passes to all pending events:
  //   1. Explicit qb_vendor_mappings row → apply.
  //   2. Profile-chain (event → matched invoice → profile.qbVendorName → qb_vendors) → apply + seed mapping.
  // Idempotent — only PATCHes events whose classification actually changes.
  //
  // Fetches vendors/accounts/mappings FRESH from Supabase rather than reading React
  // state, so callers don't hit the "setState just fired, closure still stale" trap
  // when this runs immediately after a load. Invoices come from React state (already
  // populated app-wide by the time any accountant hits this tab).
  const applyClassificationPass = async (): Promise<{ classified: number; seeded: number; skipReason?: string }> => {
    if (invoices.length === 0) return { classified: 0, seeded: 0, skipReason: 'invoices-not-loaded' };

    // .range(0, 4999) — PostgREST default cap is 1000. qb_vendors has 1165+ rows;
    // without an explicit range Yara/late-alphabetical vendors get silently dropped
    // and their events stay held-back forever. Same rule as [[feedback-no-hardcoded-cutoff]].
    const [pendingRes, vendorsRes, accountsRes, mappingsRes] = await Promise.all([
      supabase
        .from('qb_ingest_events')
        .select('id, source, counterparty_raw, matched_invoice_ids, status, counterparty_qb_vendor_list_id, target_qb_txn_kind, qb_bank_account_list_id, qb_expense_account_list_id')
        .eq('status', 'pending')
        .range(0, 4999),
      // .eq('is_active', true) + .range(0, 4999) — PostgREST server-side max-rows
      // cap is 1000 on this project, so .range alone is not enough for qb_vendors
      // (1165+ rows total, 997 inactive). Filter inactive server-side to bring
      // the row count under the cap. Silent truncation dropped alphabetical tail
      // (Y* vendors like Yara, T* like TechAntz) before 2026-08-24.
      supabase.from('qb_vendors').select('list_id, name').eq('is_active', true).range(0, 4999),
      supabase.from('qb_accounts').select('list_id, full_name, account_type').range(0, 4999),
      supabase.from('qb_vendor_mappings').select('*').range(0, 4999),
    ]);

    const vendorRows = (vendorsRes.data ?? []) as Array<{ list_id: string; name: string }>;
    const accountRows = (accountsRes.data ?? []) as Array<{ list_id: string; full_name: string; account_type: string }>;
    const mappingRows = (mappingsRes.data ?? []) as Array<Record<string, unknown>>;
    if (vendorRows.length === 0) return { classified: 0, seeded: 0, skipReason: 'qb-vendors-empty (check RLS + qb_vendors sync)' };
    if (accountRows.length === 0) return { classified: 0, seeded: 0, skipReason: 'qb-accounts-empty (check RLS + qb_accounts sync)' };

    const events: ClassifiableEvent[] = (pendingRes.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      source: (r.source as string) ?? '',
      counterpartyRaw: (r.counterparty_raw as string) ?? '',
      matchedInvoiceIds: Array.isArray(r.matched_invoice_ids) ? (r.matched_invoice_ids as number[]) : [],
      status: 'pending',
      counterpartyQbVendorListId: (r.counterparty_qb_vendor_list_id as string | null) ?? null,
      targetQbTxnKind: (r.target_qb_txn_kind as ClassifiableEvent['targetQbTxnKind']) ?? null,
      qbBankAccountListId: (r.qb_bank_account_list_id as string | null) ?? null,
      qbExpenseAccountListId: (r.qb_expense_account_list_id as string | null) ?? null,
    }));
    if (events.length === 0) return { classified: 0, seeded: 0 };

    // Invoice.paymentProfile is a JSONB SNAPSHOT taken at invoice creation.
    // If qbVendorName was set on the profile AFTER the invoice was created,
    // the snapshot won't have it. resolveInvoiceQbVendorName walks:
    // snap.qbVendorName → live pps[snap_pp_id].qb_vendor_name → user-default
    // (legacy invoices only). Critical: it does NOT fall through to
    // user-default when snap_pp_id is set — see [[vendor-resolver-no-auto-inference]].
    const resolverPps: ResolverPaymentProfile[] = paymentProfiles.map(p => ({
      id: p.id, userId: p.userId, qbVendorName: p.qbVendorName, companyName: p.companyName, isDefault: p.isDefault,
    }));
    const invoicesById = new Map<number, ClassifiableInvoice>(
      invoices.map(i => [i.id, {
        id: i.id,
        paymentProfileId: extractSnapPpId(i.paymentProfile),
        paymentProfileQbVendorName: resolveInvoiceQbVendorName(
          { snapPaymentProfileId: extractSnapPpId(i.paymentProfile), snapQbVendorName: i.paymentProfile?.qbVendorName ?? null, userId: i.userId },
          resolverPps,
        ),
      }]),
    );
    const vendorsByLowerName = new Map(vendorRows.map(v => [v.name.toLowerCase().trim(), { listId: v.list_id, name: v.name }]));
    const bankAccount = resolveBankAccount(accountRows.map(a => ({ listId: a.list_id, fullName: a.full_name })));
    const mappings: ClassifiableMapping[] = mappingRows.map(r => ({
      source: (r.source as string) ?? '',
      counterpartyPattern: (r.counterparty_pattern as string) ?? '',
      ppId: (r.pp_id as number | null) ?? null,
      qbVendorListId: (r.qb_vendor_list_id as string) ?? '',
      defaultTargetKind: (r.default_target_kind as ClassifiableMapping['defaultTargetKind']) ?? null,
      defaultBankAccountListId: (r.default_bank_account_list_id as string | null) ?? null,
      defaultExpenseAccountListId: (r.default_expense_account_list_id as string | null) ?? null,
    }));

    const { results, seedMappings } = classifyBatch(events, {
      mappings, invoicesById, vendorsByLowerName, bankAccount,
    });

    let classified = 0;
    for (const { event, result } of results) {
      if (Object.keys(result.patch).length === 0) continue;
      const { error } = await supabase.from('qb_ingest_events').update(result.patch).eq('id', event.id);
      if (!error) classified++;
      else console.warn('classification PATCH failed for event', event.id, error);
    }

    let seeded = 0;
    if (seedMappings.length > 0) {
      const rows = seedMappings.filter((s): s is NonNullable<typeof s> => !!s).map(s => ({
        ...s, updated_at: new Date().toISOString(),
      }));
      // v2 (Slice V1): seed rows are keyed by pp_id (classifier only emits
      // single-pp seeds now). UNIQUE(pp_id) constraint handles conflicts.
      const { error } = await supabase.from('qb_vendor_mappings').upsert(rows, { onConflict: 'pp_id' });
      if (!error) seeded = rows.length;
      else console.warn('seed mappings upsert failed', error);
    }

    return { classified, seeded };
  };

  // Slice G4c — reconciliation pass. For every event that's been classified
  // (has vendor + kind), consult qb_mirror to decide the concrete resolved_action:
  //   already_done | pay_existing_bill | create_bill_then_pay | check | held
  //
  // Fetches mirror fresh (avoids closure trap per [[feedback-state-vs-fresh-fetch]]).
  // Idempotent — only PATCHes events whose resolved_action actually changes.
  const applyReconciliationPass = async (): Promise<{ reconciled: number; skipReason?: string }> => {
    // Load fresh mirror bills + payments across all vendors we care about,
    // plus the invoice→bill link table for provenance classification.
    // .range(0, 4999) — PostgREST default cap is 1000; some invoice tables
    // exceed that. Mirrors the pattern in applyClassificationPass.
    const [bills, payments, invoiceLinkRes] = await Promise.all([
      getAllOpenBills(supabase),
      getAllPayments(supabase),
      supabase
        .from('invoices')
        .select('id, invoice_number, qb_bill_txn_id, matcher_ignore')
        .not('qb_bill_txn_id', 'is', null)
        .range(0, 4999),
    ]);

    // Build maps for provenance classification (see src/lib/matchProvenance.ts):
    //   invoiceIdByBillTxnId — for the exact-txn deterministic override
    //   invoicesById         — for memoNamesMatchedInvoice() lookup by matched id
    const invoiceIdByBillTxnId = new Map<string, number>();
    const invoicesById = new Map<number, { invoiceNumber: string | null; qbBillTxnId: string | null }>();
    for (const inv of (invoiceLinkRes.data ?? []) as Array<{
      id: number; invoice_number: string | null; qb_bill_txn_id: string | null; matcher_ignore: boolean | null;
    }>) {
      if (inv.matcher_ignore === true) continue;
      if (inv.qb_bill_txn_id) invoiceIdByBillTxnId.set(inv.qb_bill_txn_id, inv.id);
      invoicesById.set(inv.id, { invoiceNumber: inv.invoice_number, qbBillTxnId: inv.qb_bill_txn_id });
    }
    // Fetch events that need reconciliation. Include:
    //   - status IN (pending, ready) — normal reconcile path
    //   - status='posted' WITH posted_qb_refs.posted_source='qb_probe' —
    //     events we auto-closed based on mirror state; re-reconcile so that
    //     a wrong auto-close (e.g. amount-only match on partial-seed mirror)
    //     self-heals when mirror becomes complete.
    // Human-pushed events (posted_source='push') stay OUT of scope — they're
    // final. Ignored/failed also stay out.
    const { data: rows } = await supabase
      .from('qb_ingest_events')
      .select('id, counterparty_raw, memo, amount, txn_date, counterparty_qb_vendor_list_id, target_qb_txn_kind, matched_invoice_ids, status, resolved_action, resolved_bill_txn_id, resolved_payment_txn_id, resolved_reason, posted_qb_refs, match_provenance')
      .or('status.in.(pending,ready),and(status.eq.posted,posted_qb_refs->>posted_source.eq.qb_probe)')
      .not('target_qb_txn_kind', 'is', null);

    // Backfill invoicesById with any matched invoices we don't already have
    // (matched_invoice_ids can reference invoices whose qb_bill_txn_id is
    // still null — those weren't picked up by the qb_bill_txn_id NOT NULL
    // filter above but are needed for the memo-name provenance check).
    const missingIds = new Set<number>();
    for (const r of (rows ?? []) as Array<{ matched_invoice_ids: number[] | null }>) {
      for (const id of r.matched_invoice_ids ?? []) if (!invoicesById.has(id)) missingIds.add(id);
    }
    if (missingIds.size > 0) {
      const { data: extra } = await supabase
        .from('invoices')
        .select('id, invoice_number, qb_bill_txn_id')
        .in('id', Array.from(missingIds));
      for (const inv of (extra ?? []) as Array<{ id: number; invoice_number: string | null; qb_bill_txn_id: string | null }>) {
        invoicesById.set(inv.id, { invoiceNumber: inv.invoice_number, qbBillTxnId: inv.qb_bill_txn_id });
      }
    }
    const events: ReconcilableEvent[] = (rows ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      counterpartyRaw: (r.counterparty_raw as string) ?? '',
      memo: (r.memo as string | null) ?? null,
      amount: Number(r.amount ?? 0),
      txnDate: (r.txn_date as string) ?? '',
      counterpartyQbVendorListId: (r.counterparty_qb_vendor_list_id as string | null) ?? null,
      targetQbTxnKind: (r.target_qb_txn_kind as ReconcilableEvent['targetQbTxnKind']) ?? null,
      matchedInvoiceIds: Array.isArray(r.matched_invoice_ids) ? (r.matched_invoice_ids as number[]) : [],
      status: (r.status as ReconcilableEvent['status']) ?? 'pending',
      resolvedBillTxnId: (r.resolved_bill_txn_id as string | null) ?? null,
    }));
    if (events.length === 0) return { reconciled: 0 };

    // Group mirror rows by vendor for O(1) lookup in reconciler.
    const billsByVendor = new Map<string, MirrorBill[]>();
    for (const b of bills) {
      const arr = billsByVendor.get(b.vendorListId) ?? [];
      arr.push({
        txnId: b.txnId,
        vendorListId: b.vendorListId,
        refNumber: b.refNumber,
        amount: b.amount,
        isPaid: b.isPaid,
        txnDate: b.txnDate,
      });
      billsByVendor.set(b.vendorListId, arr);
    }
    const paymentsByVendor = new Map<string, MirrorPayment[]>();
    for (const p of payments) {
      const arr = paymentsByVendor.get(p.vendorListId) ?? [];
      arr.push({
        txnId: p.txnId,
        vendorListId: p.vendorListId,
        amount: p.amount,
        txnDate: p.txnDate,
        appliedToBills: p.appliedToBills.map(a => ({ billTxnId: a.billTxnId, amount: a.amount })),
      });
      paymentsByVendor.set(p.vendorListId, arr);
    }

    // Intuit-source events use the Intuit cutoff; other sources (Convera —
    // future retrofit) will pass their own cutoff. For now pass Intuit's
    // — safe because our only current source IS intuit_xlsx, and reconciler
    // uses cutoff only as a per-event compare (skips it if not applicable).
    const rawResults = reconcileBatch(events, {
      billsByVendor,
      paymentsByVendor,
      preOurSystemCutoff: INTUIT_PRE_OUR_SYSTEM_CUTOFF,
    });

    // Convera umbrella-aware post-pass. The core reconciler is single-vendor
    // (looks up bills by event.counterpartyQbVendorListId). For Convera
    // umbrella wires (Bimosoft, Teal) that match N invoices spanning N
    // sub-vendors, it misses N-1 sub-vendors and keeps events at
    // create_bill_then_pay even when every sub-vendor's bill is settled.
    // See [[convera-push-routing]] "Reconciler is single-vendor only".
    //
    // Cure: for events with matched_invoice_ids.length > 1 that came out of
    // reconcileBatch as create_bill_then_pay OR held, look up each matched
    // invoice's bill via its qb_bill_txn_id (already loaded above into
    // invoicesById). Aggregate the settled state:
    //   all bills exist + all settled → already_done (posted)
    //   all bills exist + some settled → held (partial)
    //   all bills exist + none settled → pay_existing_bill (bills ready to pay)
    //   some bills missing → keep original (create_bill_then_pay is right)
    const billsByTxnId = new Map<string, MirrorBill>();
    for (const arr of billsByVendor.values()) {
      for (const b of arr) billsByTxnId.set(b.txnId, b);
    }
    const results = rawResults.map(({ event, result }) => {
      if (event.matchedInvoiceIds.length <= 1) return { event, result };
      if (result.action !== 'create_bill_then_pay' && result.action !== 'held') return { event, result };
      const perInvoice = event.matchedInvoiceIds.map(invId => {
        const inv = invoicesById.get(invId);
        const billTxnId = inv?.qbBillTxnId ?? null;
        const bill = billTxnId ? billsByTxnId.get(billTxnId) : null;
        return { invId, billTxnId, isPaid: bill?.isPaid ?? null };
      });
      const anyMissing = perInvoice.some(p => !p.billTxnId || !billsByTxnId.has(p.billTxnId!));
      if (anyMissing) return { event, result };
      const settledCount = perInvoice.filter(p => p.isPaid === true).length;
      const total = perInvoice.length;
      const firstBillTxnId = perInvoice[0].billTxnId ?? undefined;
      if (settledCount === total) {
        return { event, result: {
          action: 'already_done' as const,
          billTxnId: firstBillTxnId,
          reason: `Convera umbrella: all ${total} sub-vendor bills settled in QB`,
        }};
      }
      if (settledCount > 0) {
        return { event, result: {
          action: 'held' as const,
          reason: `Convera umbrella: ${settledCount}/${total} sub-vendor bills settled — partial. Sync QB state + Recompute after next push.`,
        }};
      }
      return { event, result: {
        action: 'pay_existing_bill' as const,
        billTxnId: firstBillTxnId,
        reason: `Convera umbrella: all ${total} sub-vendor bills exist in QB, none settled — ready for BillPmt push`,
      }};
    });
    const nowIso = new Date().toISOString();
    let reconciled = 0;
    // We track events whose action becomes 'already_done' so we can also flip
    // their status to 'posted' with posted_source note. Others just update
    // resolved_* fields and keep status.
    for (const { event, result } of results) {
      const currentRow = (rows ?? []).find((r: Record<string, unknown>) => r.id === event.id) as Record<string, unknown> | undefined;
      const prevAction = (currentRow?.resolved_action as string | null) ?? null;
      const prevBillTxnId = (currentRow?.resolved_bill_txn_id as string | null) ?? null;
      const prevPaymentTxnId = (currentRow?.resolved_payment_txn_id as string | null) ?? null;
      const prevReason = (currentRow?.resolved_reason as string | null) ?? null;
      const prevMatchedIds = Array.isArray(currentRow?.matched_invoice_ids)
        ? [...(currentRow!.matched_invoice_ids as number[])].sort((a, b) => a - b)
        : [];
      const prevProvenance = (currentRow?.match_provenance as MatchProvenance | null) ?? null;

      const nextBillTxnId = result.billTxnId ?? null;
      const nextPaymentTxnId = result.paymentTxnId ?? null;
      const nextReason = result.reason ?? null;

      // ─── Provenance classification ────────────────────────────────────────
      // Compute match_provenance from (event.resolved_bill_txn_id, matched
      // invoices, memo refs) using the smarter normalizeRef normalization.
      // On exact-txn, force matched_invoice_ids = [authoritativeInvoiceId]
      // — this is where wrong fuzzy matches get corrected.
      const matchedInvoiceRecords = event.matchedInvoiceIds
        .map(id => invoicesById.get(id))
        .filter((v): v is { invoiceNumber: string | null; qbBillTxnId: string | null } => v != null);
      const memoRefs = extractRefsFromMemo(event.memo);
      const provResult = computeMatchProvenance({
        eventResolvedBillTxnId: nextBillTxnId,
        matchedInvoiceIds: event.matchedInvoiceIds,
        memoNamesMatchedInvoice: memoNamesMatchedInvoice(memoRefs, matchedInvoiceRecords),
        targetQbTxnKind: event.targetQbTxnKind,
        invoiceIdByBillTxnId,
      });
      const nextMatchedIds: number[] = provResult.provenance === 'exact-txn' && provResult.authoritativeInvoiceId != null
        ? [provResult.authoritativeInvoiceId]
        : [...event.matchedInvoiceIds];
      const nextMatchedIdsSorted = [...nextMatchedIds].sort((a, b) => a - b);
      const nextProvenance = provResult.provenance;

      const matchedIdsChanged = prevMatchedIds.length !== nextMatchedIdsSorted.length
        || prevMatchedIds.some((v, i) => v !== nextMatchedIdsSorted[i]);
      const provenanceChanged = prevProvenance !== nextProvenance;

      // Skip PATCH if nothing changed
      if (
        prevAction === result.action
        && prevBillTxnId === nextBillTxnId
        && prevPaymentTxnId === nextPaymentTxnId
        && prevReason === nextReason
        && !matchedIdsChanged
        && !provenanceChanged
      ) continue;

      const patch: Record<string, unknown> = {
        resolved_action: result.action,
        resolved_bill_txn_id: nextBillTxnId,
        resolved_payment_txn_id: nextPaymentTxnId,
        resolved_reason: nextReason,
        reconciled_at: nowIso,
        match_provenance: nextProvenance,
      };
      if (matchedIdsChanged) patch.matched_invoice_ids = nextMatchedIds;

      // Status transitions driven by reconciliation:
      //   pending/ready + already_done + exact-txn provenance → posted
      //     (auto-close only when the invoice link is deterministic; fuzzy
      //     matches must be human-verified even for auto-close)
      //   posted(qb_probe) + (NOT already_done OR provenance dropped from
      //     exact-txn) → back to pending (self-heal)
      //   ready + already_done + weak provenance → pending
      //     (classifier promotes any classified event to ready, but an
      //     already_done event with fuzzy invoice link shouldn't LOOK
      //     ready-to-push in the Inbox — surface it for review)
      const wasQbProbePosted = event.status === 'posted'
        && ((currentRow?.posted_qb_refs as Record<string, unknown> | null)?.posted_source === 'qb_probe');
      const autoCloseEligible = result.action === 'already_done' && nextProvenance === 'exact-txn';
      if (autoCloseEligible && event.status !== 'posted') {
        patch.status = 'posted';
        patch.status_updated_at = nowIso;
        patch.posted_qb_refs = {
          bill_txn_id: nextBillTxnId,
          payment_txn_id: nextPaymentTxnId,
          posted_source: 'qb_probe',
        };
      } else if (!autoCloseEligible && wasQbProbePosted) {
        // Auto-close was wrong (action changed OR provenance no longer
        // exact-txn) — revert to pending so the accountant sees the case.
        patch.status = 'pending';
        patch.status_updated_at = nowIso;
        patch.posted_qb_refs = null;
      } else if (result.action === 'already_done' && nextProvenance !== 'exact-txn' && event.status === 'ready') {
        // Classifier promoted event to ready, but reconciler says "QB already
        // has this + weak invoice link" — this isn't push-ready, revert to
        // pending so it lands in the review bucket, not the pushable group.
        patch.status = 'pending';
        patch.status_updated_at = nowIso;
      } else if (result.action === 'pre_our_system' && event.status !== 'ignored' && event.status !== 'posted') {
        // Terminal: predates our cutoff; QB handled these before we came online.
        // Flip to ignored so they don't clutter the pushable Inbox or inflate
        // the "Ready to push" counter. resolved_action='pre_our_system' preserved
        // for audit; they land in the Ignore bucket.
        patch.status = 'ignored';
        patch.status_updated_at = nowIso;
      }
      const { error } = await supabase.from('qb_ingest_events').update(patch).eq('id', event.id);
      if (!error) reconciled++;
      else console.warn('reconciliation PATCH failed for event', event.id, error);
    }
    return { reconciled };
  };

  const [recomputeBusy, setRecomputeBusy] = useState(false);
  const runRecomputeButton = async () => {
    setRecomputeBusy(true);
    try {
      const result = await recomputeMatchesForPending();
      const cls = await applyClassificationPass();
      const rec = await applyReconciliationPass();
      await loadQbVendorMappings();
      await loadQbIngestEvents();
      if (result.skipped === 'invoices-not-loaded') {
        alert('Cannot recompute yet — invoices are still loading. Wait a moment and try again.');
      } else {
        const clsSummary = cls.skipReason
          ? ` · classification skipped (${cls.skipReason})`
          : ` · auto-classified ${cls.classified}${cls.seeded > 0 ? `, seeded ${cls.seeded} mapping${cls.seeded === 1 ? '' : 's'}` : ''}`;
        const recSummary = rec.skipReason
          ? ` · reconciliation skipped (${rec.skipReason})`
          : ` · reconciled ${rec.reconciled}`;
        alert(`Recomputed matches: scanned ${result.scanned} pending event${result.scanned === 1 ? '' : 's'}, updated ${result.updated}${clsSummary}${recSummary}.`);
      }
    } finally { setRecomputeBusy(false); }
  };

  const loadQbVendorMappings = async () => {
    const { data } = await supabase.from('qb_vendor_mappings').select('*');
    setQbVendorMappings((data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as number,
      ppId: (r.pp_id as number | null) ?? null,
      source: (r.source as string) ?? '',
      counterpartyPattern: (r.counterparty_pattern as string) ?? '',
      qbVendorListId: (r.qb_vendor_list_id as string) ?? '',
      defaultTargetKind: (r.default_target_kind as QbIngestKind | null) ?? null,
      defaultBankAccountListId: (r.default_bank_account_list_id as string) ?? null,
      defaultExpenseAccountListId: (r.default_expense_account_list_id as string) ?? null,
      payeeFullName: (r.payee_full_name as string) ?? null,
      payeeListKind: (r.payee_list_kind as QbPayeeListKind | null) ?? null,
    })));
  };
  const loadQbVendorsAndAccounts = async () => {
    // Lists rarely change during a session — only fetch if empty.
    // .range(0, 4999) — qb_vendors is 1165+ rows and PostgREST default cap is
    // 1000, silently dropping the alphabetical tail (e.g. Yara). See
    // [[feedback-no-hardcoded-cutoff]].
    if (qbVendorsList.length === 0) {
      // .eq('is_active', true) + .range — see comment in applyClassificationPass.
      // PostgREST project-level max-rows=1000 silently truncates otherwise.
      const { data } = await supabase.from('qb_vendors').select('list_id, name, is_active').eq('is_active', true).order('name').range(0, 4999);
      setQbVendorsList((data ?? []).map((r: Record<string, unknown>) => ({
        listId: (r.list_id as string) ?? '', name: (r.name as string) ?? '', isActive: Boolean(r.is_active),
      })));
    }
    if (qbAccountsList.length === 0) {
      const { data } = await supabase.from('qb_accounts').select('list_id, full_name, account_type, is_active').order('full_name').range(0, 4999);
      setQbAccountsList((data ?? []).map((r: Record<string, unknown>) => ({
        listId: (r.list_id as string) ?? '', fullName: (r.full_name as string) ?? '', accountType: (r.account_type as string) ?? '', isActive: Boolean(r.is_active),
      })));
    }
  };
  // Slice G1 — load qb_open_bills_snapshot into React state for freshness UI.
  const loadQbOpenBills = async () => {
    try {
      const rows = await getAllOpenBills(supabase);
      setQbOpenBills(rows);
    } catch (e) {
      console.warn('loadQbOpenBills failed', e);
    }
  };
  // Slice G1 — MAX(qb_wc_sessions.last_seen_at) as QBWC heartbeat.
  const loadQbWcLastSeen = async () => {
    try {
      const { data } = await supabase
        .from('qb_wc_sessions')
        .select('last_seen_at')
        .order('last_seen_at', { ascending: false })
        .limit(1);
      setQbWcLastSeen((data && data[0]?.last_seen_at) || null);
    } catch (e) {
      console.warn('loadQbWcLastSeen failed', e);
    }
  };
  // Slice G1 — count in-flight bill_query jobs. Used to disable the Sync button
  // and show live progress. Called by the polling effect below.
  const loadQbBillQueryPending = async () => {
    try {
      // Fetch ALL pending/in-flight jobs (any kind) so the "N pending" chip
      // can expand into a detail popup. Bill_query count is derived from
      // this list — one fetch, one poll interval.
      const { data } = await supabase
        .from('qb_sync_jobs')
        .select('id, kind, created_at, payload')
        .in('status', ['pending', 'in_flight'])
        .order('created_at', { ascending: true });
      const all = (data ?? []) as Array<{ id: number; kind: string; created_at: string; payload: Record<string, unknown> | null }>;
      setQbPendingJobDetails(all);
      const prev = qbBillQueryPending;
      const next = all.filter(j => j.kind === 'bill_query').length;
      setQbBillQueryPending(next);
      // Transition from >0 → 0 = QBWC just finished draining; refresh snapshot,
      // heartbeat, and re-reconcile since mirror is now fresher.
      if (prev > 0 && next === 0) {
        await loadQbOpenBills();
        await loadQbWcLastSeen();
        try {
          const rec = await applyReconciliationPass();
          if (rec.reconciled > 0) await loadQbIngestEvents();
        } catch (e) {
          console.warn('post-drain reconciliation failed', e);
        }
      }
    } catch (e) {
      console.warn('loadQbBillQueryPending failed', e);
    }
  };
  // Force-refresh qb_vendors from Supabase, bypassing the "only if empty" guard
  // in loadQbVendorsAndAccounts. Called after a vendor_query drain so newly-
  // added QB vendors surface immediately in pickers.
  const refreshQbVendors = async () => {
    const { data } = await supabase.from('qb_vendors').select('list_id, name, is_active').eq('is_active', true).order('name').range(0, 4999);
    setQbVendorsList((data ?? []).map((r: Record<string, unknown>) => ({
      listId: (r.list_id as string) ?? '', name: (r.name as string) ?? '', isActive: Boolean(r.is_active),
    })));
  };
  // Count in-flight vendor_query jobs. Same pattern as loadQbBillQueryPending:
  // polled every 30s; when the count drops from >0 to 0 (QBWC just drained),
  // force-refresh the vendors list so newly-added QB vendors appear in pickers.
  const loadQbVendorQueryPending = async () => {
    try {
      const { data } = await supabase
        .from('qb_sync_jobs')
        .select('id')
        .eq('kind', 'vendor_query')
        .in('status', ['pending', 'in_flight']);
      const prev = qbVendorQueryPending;
      const next = (data ?? []).length;
      setQbVendorQueryPending(next);
      if (prev > 0 && next === 0) {
        await refreshQbVendors();
      }
    } catch (e) {
      console.warn('loadQbVendorQueryPending failed', e);
    }
  };
  // Sync Vendors button handler. Enqueues one vendor_query job (dedup lives in
  // enqueueVendorQuery — at most one pending/in-flight at a time). QBWC drains
  // on next poll; refreshQbVendors runs on drain-to-zero.
  const runSyncQbVendors = async () => {
    setQbSyncingVendors(true);
    try {
      const result = await enqueueVendorQuery(supabase, 'manual-sync-vendors');
      await loadQbVendorQueryPending();
      if (result.jobIds.length === 0) {
        alert('A vendor_query is already pending/in-flight. Wait for it to drain (~15 min).');
      } else {
        alert('Enqueued vendor_query. QBWC drains on next poll (~15 min). Vendors list refreshes automatically when complete.');
      }
    } catch (e) {
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err?.message, err?.details, err?.hint, err?.code ? `(code ${err.code})` : null]
        .filter((s): s is string => !!s);
      const msg = parts.length ? parts.join(' — ') : (e instanceof Error ? e.message : JSON.stringify(e));
      alert('Sync Vendors failed: ' + msg);
    } finally {
      setQbSyncingVendors(false);
    }
  };
  // Slice G1 — Sync button handler. Broad seed strategy per Dan's ask:
  // enqueue iterator-mode bill_query for EVERY QB vendor we care about, not
  // just event-classified ones. "Care about" =
  //   (a) any qb_vendor_name set on any payment_profiles row, AND
  //   (b) any event-resolvable vendor (via mapping or profile chain).
  // Then filter out vendors that already have a fresh snapshot (< 1h) or an
  // in-flight bill_query job (dedup lives in enqueueBillQuery).
  const runSyncQbBills = async () => {
    setQbSyncingBills(true);
    try {
      const vendorsByLowerName = new Map(qbVendorsList.map(v => [v.name.toLowerCase().trim(), v]));
      const vendorNamesByListId = new Map(qbVendorsList.map(v => [v.listId, v.name]));

      // Set (a): mapped-in-profiles vendors. These are the ~40 contractors
      // whose qbVendorName we've curated. Resolve to canonical qb_vendors.name
      // for exact QBWC lookup.
      const profileVendorNames = new Set<string>();
      for (const pp of paymentProfiles) {
        const name = pp.qbVendorName?.trim();
        if (!name) continue;
        const canonical = vendorsByLowerName.get(name.toLowerCase())?.name ?? name;
        profileVendorNames.add(canonical);
      }

      // Set (b): event-resolvable vendors. Classified events carry a listId
      // directly; unclassified events with matched_invoice_ids resolve via
      // invoice → paymentProfile.qbVendorName.
      const invById = new Map(invoices.map(i => [i.id, i]));
      const eventVendorNames = new Set<string>();
      for (const e of qbIngestEvents) {
        if (e.counterpartyQbVendorListId) {
          const name = vendorNamesByListId.get(e.counterpartyQbVendorListId);
          if (name) eventVendorNames.add(name);
          continue;
        }
        // profile-chain resolution
        if (e.matchedInvoiceIds.length === 0) continue;
        const inv = invById.get(e.matchedInvoiceIds[0]);
        const qvn = inv?.paymentProfile?.qbVendorName?.trim();
        if (!qvn) continue;
        const canonical = vendorsByLowerName.get(qvn.toLowerCase())?.name;
        if (canonical) eventVendorNames.add(canonical);
      }

      const allVendorNames = Array.from(new Set([...profileVendorNames, ...eventVendorNames])).sort();
      if (allVendorNames.length === 0) {
        alert('No vendors need syncing — no payment profiles have qb_vendor_name set and no events resolve to a QB vendor.');
        return;
      }

      // Filter by freshness — skip vendors synced within TTL. Fresh snapshot first.
      await loadQbOpenBills();
      const freshness = snapshotAge(qbOpenBills);
      const listIdByName = new Map(qbVendorsList.map(v => [v.name, v.listId]));
      const staleListIds = vendorsNeedingSync(
        allVendorNames.map(n => listIdByName.get(n)).filter((x): x is string => !!x),
        freshness,
      );
      const staleVendors = staleListIds
        .map(id => ({ listId: id, name: vendorNamesByListId.get(id) ?? '' }))
        .filter(v => v.name !== '');
      // If nothing is stale, we're up-to-date — no-op with a helpful message.
      if (staleVendors.length === 0) {
        alert(`All ${allVendorNames.length} vendors have fresh snapshots (< 1h). Nothing to enqueue.`);
        return;
      }

      // Slice G3: delta cursor per vendor. First call for a vendor pulls all
      // history; subsequent calls pull only bills since MAX(txn_date) - 1d.
      const result = await enqueueBillQueryForVendors(supabase, staleVendors, {
        deltaFrom: 'auto',
        auditTag: 'slice-g1-manual-sync',
      });
      await loadQbBillQueryPending();  // update pending counter immediately
      const deltaCount = Object.values(result.deltaCursorsUsed).filter(c => c !== 'none').length;
      alert(
        `Enqueued ${result.jobIds.length} bill_query job${result.jobIds.length === 1 ? '' : 's'} `
        + `across ${staleVendors.length} vendor${staleVendors.length === 1 ? '' : 's'} `
        + `(${deltaCount} delta / ${staleVendors.length - deltaCount} full-history)`
        + (result.skippedInFlight.length > 0 ? `; skipped ${result.skippedInFlight.length} already in flight` : '')
        + `. QBWC drains the full queue in one session; wait up to 15 min for the next poll, then ~${Math.max(1, Math.ceil(result.jobIds.length * 1 / 60))} min of drain time. `
        + `This UI updates automatically as they complete.`,
      );
    } catch (e) {
      // Supabase errors come as { message, details, hint, code } — String(e)
      // renders these as "[object Object]" (session-2026-08-19 post-mortem #4).
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err?.message, err?.details, err?.hint, err?.code ? `(code ${err.code})` : null]
        .filter((s): s is string => !!s);
      const msg = parts.length ? parts.join(' — ') : (e instanceof Error ? e.message : JSON.stringify(e));
      alert('Sync failed: ' + msg);
    } finally {
      setQbSyncingBills(false);
    }
  };

  // Rehydrate the status pane from in-flight qb_sync_jobs. Called on tab
  // load so a page refresh mid-drain doesn't lose the pane (and doesn't
  // let the preview modal re-offer events with pending pushes). Only
  // rebuilds bill_pmt_add + check_add rows (verify chain not reconstructed —
  // acceptable degradation for a refresh; correctness data stays in DB).
  const loadInflightPushRecords = async () => {
    const { data: jobs } = await supabase
      .from('qb_sync_jobs')
      .select('id, kind, status, payload, created_at')
      .in('status', ['pending', 'in_flight'])
      .in('kind', ['bill_pmt_add', 'check_add']);
    const jobRows = (jobs ?? []) as Array<{ id: number; kind: string; status: string; payload: Record<string, unknown> | null; created_at: string }>;
    const eventIds = new Set<number>();
    for (const j of jobRows) {
      const eid = (j.payload as { sourceIngestEventId?: number } | null)?.sourceIngestEventId;
      if (eid != null) eventIds.add(eid);
    }
    if (eventIds.size === 0) {
      setQbPushRecords([]);
      return;
    }
    // Fetch fresh — the tab-load useEffect fires loadInflightPushRecords in
    // the same tick as loadQbVendorMappings + loadQbVendorsAndAccounts, so
    // React state is stale in this closure. INVARIANTS #27 / [[state-vs-fresh-fetch]].
    const [eventDataRes, freshMappings, freshVendors] = await Promise.all([
      supabase
        .from('qb_ingest_events')
        .select('id, source, amount, counterparty_raw, counterparty_qb_vendor_list_id, resolved_bill_txn_id')
        .in('id', Array.from(eventIds)),
      supabase.from('qb_vendor_mappings').select('source, counterparty_pattern, payee_full_name'),
      supabase.from('qb_vendors').select('list_id, name'),
    ]);
    const eventById = new Map(((eventDataRes.data ?? []) as Array<{ id: number; source: string; amount: number|string; counterparty_raw: string; counterparty_qb_vendor_list_id: string | null; resolved_bill_txn_id: string | null }>).map(r => [r.id, r]));
    const vendorNameById = new Map(((freshVendors.data ?? []) as Array<{ list_id: string; name: string }>).map(v => [v.list_id, v.name]));
    const payeeByKey = new Map<string, string>();
    for (const m of ((freshMappings.data ?? []) as Array<{ source: string; counterparty_pattern: string; payee_full_name: string | null }>)) {
      if (m.payee_full_name) payeeByKey.set(`${m.source} ${m.counterparty_pattern}`, m.payee_full_name);
    }
    const records: PushRecord[] = [];
    for (const j of jobRows) {
      const eid = (j.payload as { sourceIngestEventId?: number } | null)?.sourceIngestEventId;
      if (eid == null) continue;
      const event = eventById.get(eid);
      if (!event) continue;
      const displayName = (event.counterparty_qb_vendor_list_id && vendorNameById.get(event.counterparty_qb_vendor_list_id))
        ?? payeeByKey.get(`${event.source} ${event.counterparty_raw}`)
        ?? event.counterparty_raw;
      records.push({
        eventId: eid,
        payJobId: j.id,
        verifyJobId: null,
        billTxnId: event.resolved_bill_txn_id ?? '',
        expectedAmount: Number(event.amount),
        expectedVendor: displayName,
        pushedAt: j.created_at,
        kind: j.kind === 'check_add' ? 'check' : 'pay_bill',
      });
    }
    setQbPushRecords(records);
  };

  useEffect(() => {
    const onAccountantQb = accountantTab === 'qb-automation' && currentUser?.role === 'accountant';
    const onAdminQbV2 = adminView === 'qbautov2' && currentUser?.role === 'admin';
    if (!onAccountantQb && !onAdminQbV2) return;
    (async () => {
      await loadQbIngestEvents();
      await loadQbVendorMappings();
      await loadQbVendorsAndAccounts();
      await loadQbOpenBills();
      await loadQbWcLastSeen();
      await loadQbBillQueryPending();
      await loadQbVendorQueryPending();
      await loadInflightPushRecords();
      // Auto-recompute matches for pending events using current invoices.
      // Guarded — skips silently if invoices state is empty (see the guard in
      // recomputeMatchesForPending). The invoices.length dependency below
      // ensures we re-run once invoices actually load.
      try {
        const { updated } = await recomputeMatchesForPending();
        // Then auto-classify using mappings + profile chain. Slice F.5.
        const cls = await applyClassificationPass();
        // Then reconcile against qb_mirror. Slice G4c.
        const rec = await applyReconciliationPass();
        if (updated > 0 || cls.classified > 0 || rec.reconciled > 0) await loadQbIngestEvents();
        if (cls.seeded > 0) await loadQbVendorMappings();
      } catch (e) {
        console.warn('QB Automation: auto-recompute failed', e);
      }
    })();
    // Depend on invoices.length so tab-opens-before-invoices-load still triggers
    // the recompute when they arrive. Recompute is idempotent (only writes when
    // matches actually change) so re-firing on later invoice changes is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountantTab, adminView, currentUser?.role, invoices.length]);

  // Slice G1 — poll qb_sync_jobs while on the QB Automation tab AND there are
  // pending bill_query jobs. 30s cadence — QBWC drains every 15 min so this
  // just tracks whether the queue is empty (=> ready to refresh snapshot).
  useEffect(() => {
    const onAccountantQb = accountantTab === 'qb-automation' && currentUser?.role === 'accountant';
    const onAdminQbV2 = adminView === 'qbautov2' && currentUser?.role === 'admin';
    if (!onAccountantQb && !onAdminQbV2) return;
    // Poll every 30s regardless of current count. Background inserts (pg_cron
    // qb-delta-bills, manual probes) can appear at any time; a 0→N transition
    // needs to be visible in the UI without the accountant having to refresh.
    const iv = setInterval(() => { loadQbBillQueryPending(); loadQbVendorQueryPending(); }, 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountantTab, adminView, currentUser?.role]);

  // Already-done bucket row actions. These update OUR tracking (qb_ingest_events
  // + invoices), NOT QB. Bill + payment already exist in QB per the reconciler.
  const markAlreadyDonePreOurSystem = async (eventId: number) => {
    const { error } = await supabase
      .from('qb_ingest_events')
      .update({ resolved_action: 'pre_our_system', resolved_reason: 'manually marked pre-our-system' })
      .eq('id', eventId);
    if (error) { alert('Failed: ' + error.message); return; }
    await loadQbIngestEvents();
  };
  const markAlreadyDoneOrphan = async (eventId: number) => {
    const { error } = await supabase
      .from('qb_ingest_events')
      .update({ status: 'ignored', notes: 'marked orphan (unrelated to our invoices)' })
      .eq('id', eventId);
    if (error) { alert('Failed: ' + error.message); return; }
    await loadQbIngestEvents();
  };
  const acceptAlreadyDoneFuzzyMatch = async (eventId: number) => {
    const e = qbIngestEvents.find(x => x.id === eventId);
    if (!e) return;
    if (!e.resolvedBillTxnId) { alert('No resolved bill TxnID on event — cannot accept.'); return; }
    const invoiceIds = e.matchedInvoiceIds ?? [];
    const linkDetail = invoiceIds.length > 0
      ? `Will also link invoice${invoiceIds.length === 1 ? '' : 's'} ${invoiceIds.join(', ')} → qb_bill_txn_id = ${e.resolvedBillTxnId}.`
      : 'No linked invoices (accepting without writeback).';
    if (!window.confirm(`Accept fuzzy match for ${e.counterpartyRaw} $${e.amount.toFixed(2)}?\n\n${linkDetail}\n\nMarks event as posted. QB is not touched.`)) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('qb_ingest_events')
      .update({
        status: 'posted',
        status_updated_at: nowIso,
        posted_qb_refs: { bill: e.resolvedBillTxnId, ...(e.resolvedPaymentTxnId ? { bill_pmt: e.resolvedPaymentTxnId } : {}), posted_source: 'manual_accept_fuzzy' },
      })
      .eq('id', eventId);
    if (error) { alert('Failed: ' + error.message); return; }
    if (invoiceIds.length > 0 && e.resolvedBillTxnId) {
      const { error: invErr } = await supabase
        .from('invoices')
        .update({ qb_bill_txn_id: e.resolvedBillTxnId, qb_export_status: 'exported', qb_export_status_at: nowIso })
        .in('id', invoiceIds)
        .is('qb_bill_txn_id', null);   // only if not already set
      if (invErr) console.warn('invoice link writeback failed:', invErr.message);
    }
    await Promise.all([loadQbIngestEvents(), fetchInvoices()]);
  };

  // Slice D — save a vendor mapping and apply it to all pending events with the same counterparty.
  const openMapWidget = (counterparty: string, source: string, eventCount: number = 0) => {
    // Prefill from existing mapping if one exists for this (source, counterparty).
    const existing = qbVendorMappings.find(m => m.source === source && m.counterpartyPattern === counterparty);
    // eventCount defaults to 0 for edit-from-mappings-panel path (we don't know
    // how many pending events exist; save-path applies to all matching rows anyway).
    setMapForm({
      kind: existing?.defaultTargetKind ?? 'bill_pmt',
      vendorListId: existing?.qbVendorListId ?? '',
      bankListId: existing?.defaultBankAccountListId ?? '',
      expenseListId: existing?.defaultExpenseAccountListId ?? '',
      vendorSearch: '',
      payeeFullName: existing?.payeeFullName ?? '',
      payeeListKind: existing?.payeeListKind ?? 'OtherName',
    });
    setMapVendorOpenFor({ counterparty, source, eventCount });
  };
  const saveVendorMapping = async (counterparty: string, source: string) => {
    const kind = mapForm.kind;
    // For kind='check' the payee can be an OtherName / Employee / Customer that
    // is NOT in the Vendors list — accept either a QB vendor OR a free-text
    // payee_full_name. qbXML CheckAdd resolves <PayeeEntityRef><FullName>
    // across all payee-eligible lists. Other kinds require a Vendor.
    if (kind === 'bill_pmt' || kind === 'bill_add_and_pmt') {
      if (!mapForm.vendorListId) { alert('Pick a QB vendor.'); return; }
    }
    if (kind === 'check') {
      if (!mapForm.vendorListId && !mapForm.payeeFullName.trim()) {
        alert('Pick a QB vendor OR enter a payee full name (for OtherName/Employee/Customer payees).');
        return;
      }
    }
    if (kind !== 'ignore' && !mapForm.bankListId) { alert('Pick a bank account.'); return; }
    if ((kind === 'check' || kind === 'bill_add_and_pmt') && !mapForm.expenseListId) { alert('Pick an expense account.'); return; }
    setMapSaving(true);
    try {
      // Upsert the mapping row so future imports auto-classify.
      // Migration 20260825 relaxed qb_vendor_list_id to nullable + added
      // payee_full_name / payee_list_kind for OtherName-style payees.
      const usePayeeName = kind === 'check' && !mapForm.vendorListId && !!mapForm.payeeFullName.trim();
      const mappingRow = {
        source,
        counterparty_pattern: counterparty,
        qb_vendor_list_id: kind === 'ignore' ? null : (mapForm.vendorListId || null),
        default_target_kind: kind,
        default_bank_account_list_id: kind === 'ignore' ? null : mapForm.bankListId,
        default_expense_account_list_id: (kind === 'check' || kind === 'bill_add_and_pmt') ? mapForm.expenseListId : null,
        payee_full_name: usePayeeName ? mapForm.payeeFullName.trim() : null,
        payee_list_kind: usePayeeName ? mapForm.payeeListKind : null,
        updated_at: new Date().toISOString(),
      };
      // v2 (Slice V1): old UNIQUE(source, counterparty_pattern) was dropped
      // (multiple contractors can share a wire memo). The widget path here
      // doesn't have a pp_id (user is mapping a wire memo directly), so we
      // write a "legacy" row with pp_id=NULL. Insert-or-update by looking up
      // existing legacy row for this (source, counterparty_pattern) first.
      const { data: existingLegacy } = await supabase
        .from('qb_vendor_mappings')
        .select('id')
        .eq('source', source)
        .eq('counterparty_pattern', counterparty)
        .is('pp_id', null)
        .maybeSingle();
      const upsertErr = existingLegacy
        ? (await supabase.from('qb_vendor_mappings').update(mappingRow).eq('id', existingLegacy.id)).error
        : (await supabase.from('qb_vendor_mappings').insert(mappingRow)).error;
      if (upsertErr) throw upsertErr;

      // Retroactively apply to all pending AND ignored events for this
      // counterparty. Including 'ignored' powers the Move-from-Ignore self-
      // serve flow: accountant opens the map widget on an ignored event
      // (Bhavani-style) and pick Create+Pay — same save path flips the
      // event(s) back into the appropriate ready bucket.
      // kind='ignore' → status='ignored' (won't appear in push preview)
      // kind='bill_pmt'/'bill_add_and_pmt'/'check' → status='ready'
      const nextStatus = kind === 'ignore' ? 'ignored' : 'ready';
      const eventUpdate = {
        counterparty_qb_vendor_list_id: kind === 'ignore' ? null : (mapForm.vendorListId || null),
        target_qb_txn_kind: kind,
        qb_bank_account_list_id: kind === 'ignore' ? null : mapForm.bankListId,
        qb_expense_account_list_id: (kind === 'check' || kind === 'bill_add_and_pmt') ? mapForm.expenseListId : null,
        status: nextStatus,
        status_updated_at: new Date().toISOString(),
      };
      const { error: updErr } = await supabase.from('qb_ingest_events').update(eventUpdate)
        .eq('source', source).eq('counterparty_raw', counterparty).in('status', ['pending', 'ignored']);
      if (updErr) throw updErr;

      await loadQbIngestEvents();
      await loadQbVendorMappings();
      setMapVendorOpenFor(null);
    } catch (e) {
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err?.message, err?.details, err?.hint, err?.code ? `(code ${err.code})` : null].filter((s): s is string => !!s);
      alert(`Save failed: ${parts.length ? parts.join(' — ') : JSON.stringify(e)}`);
    } finally {
      setMapSaving(false);
    }
  };

  async function loadConveraLastPaymentDates() {
    if (converaLastPaymentDates.size > 0) return;
    const { data } = await supabase
      .from('convera_transactions')
      .select('convera_beneficiary_id, date_of_order')
      .not('convera_beneficiary_id', 'is', null);
    if (!data) return;
    const map = new Map<number, string>();
    for (const row of data) {
      const bid = row.convera_beneficiary_id as number;
      const d = (row.date_of_order as string).slice(0, 10);
      if (!map.has(bid) || d > map.get(bid)!) map.set(bid, d);
    }
    setConveraLastPaymentDates(map);
  }

  function normBenefName(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function autoMatchBeneficiary(contractorName: string, profileIban: string, beneficiaries: ConveraBeneficiary[], expectedSynCode?: string): { beneficiary: ConveraBeneficiary; level: 'syn' | 'iban' | 'name' } | null {
    // 1. SYN vendor code match — deliberate no-ambiguity primary link. When present,
    // auto-linked silently. IBAN/name matches are downgraded to "suggested" and
    // surfaced as amber rows so the accountant confirms before the FK is written.
    // Guardrail (Fat Struct incident, 2026-08-30): when the profile has an IBAN AND
    // the SYN-matched beneficiary has a bank_account, the two must agree. Convera
    // Vendor IDs can be entered wrong on the Convera side (or reuse a stale SYN
    // number from a deleted-and-recreated profile), and a silent SYN link would
    // route a live payment to the wrong contractor. If they disagree, fall through
    // to IBAN/name matching — the accountant confirms via the amber "suggested" flow.
    if (expectedSynCode) {
      const bySyn = beneficiaries.find(b => (b.vendorId || '').trim().toUpperCase() === expectedSynCode.toUpperCase());
      if (bySyn) {
        const pIban = sanitizeIban(profileIban);
        const bIban = sanitizeIban(bySyn.bankAccount);
        if (!pIban || !bIban || pIban === bIban) return { beneficiary: bySyn, level: 'syn' };
      }
    }
    if (!contractorName) return null;
    // 2. Unique IBAN match
    if (profileIban) {
      const ibanMatches = beneficiaries.filter(b => b.bankAccount === profileIban);
      if (ibanMatches.length === 1 && ibanMatches[0].ibanUnique) return { beneficiary: ibanMatches[0], level: 'iban' };
    }
    // 3. Short name prefix or contains match (handles "BIMOSOFT AMAR PLJEVLJAK" for contractor "Amar Pljevljak")
    const normName = normBenefName(contractorName);
    const byName = beneficiaries.find(b => {
      const sn = normBenefName(b.shortName);
      return sn.startsWith(normName) || sn.includes(normName);
    });
    return byName ? { beneficiary: byName, level: 'name' } : null;
  }

  async function importConveraBeneficiaries(file: File) {
    setBeneficiaryImporting(true);
    setBeneficiaryImportResult(null);
    try {
      // Convera exports the file as cp1250 (Central European) so Croatian/Bosnian
      // diacritics (Ž Š Ć Đ Č) survive. file.text() assumes UTF-8 and mangles them
      // to U+FFFD. Sniff: try UTF-8, fall back to cp1250, then cp1252.
      const buffer = await file.arrayBuffer();
      const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      let text: string;
      if (!utf8.includes('�')) {
        text = utf8;
      } else {
        try { text = new TextDecoder('windows-1250').decode(buffer); }
        catch { text = new TextDecoder('windows-1252').decode(buffer); }
      }
      // Convera exports TSV (.xls) or CSV — auto-detect delimiter from header row
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      const delim = lines[0].includes('\t') ? '\t' : ',';
      const headers = lines[0].split(delim);
      const col = (r: string[], name: string) => { const i = headers.indexOf(name); return i >= 0 ? r[i]?.trim() || '' : ''; };
      const raw = lines.slice(1).map(l => l.split(delim));
      const rows = raw.map(r => ({
        beneficiary_id: col(r, 'Beneficiary ID'),
        short_name: col(r, 'Short Name'),
        beneficiary_name: col(r, 'Beneficiary Name'),
        beneficiary_country: col(r, 'Beneficiary Country') || null,
        currency: col(r, 'Currency') || null,
        default_payment_method: col(r, 'Default Payment Method') || null,
        vendor_id: col(r, 'Vendor ID') || null,
        bank_name: col(r, 'Bank Name') || null,
        bank_country: col(r, 'Bank Country') || null,
        bank_account: col(r, 'Bank Account') || null,
        iban_unique: true,
        updated_by: col(r, 'Updated By') || null,
        updated_date: col(r, 'Updated Date') || null,
      })).filter(r => r.beneficiary_id);
      // Upsert in batches of 50
      for (let i = 0; i < rows.length; i += 50) {
        await supabase.from('convera_beneficiaries').upsert(rows.slice(i, i + 50), { onConflict: 'beneficiary_id' });
      }
      // Reload beneficiaries
      const { data: benefs } = await supabase.from('convera_beneficiaries').select('*').order('short_name');
      const normBenefs = (benefs || []).map(normaliseConveraBeneficiary);
      setConveraBeneficiaries(normBenefs);
      // Auto-match payment profiles (skip manual overrides and already-linked profiles)
      const { data: profiles } = await supabase.from('payment_profiles').select('id, user_id, iban, convera_match_override, convera_beneficiary_id');
      // TODO(modularization): 4 sibling `isTestAccount` copies extracted to src/lib/isTestAccount.ts. This variant lacks `.trim()` — likely
      // an oversight (regex uses word boundaries so trim doesn't affect the hotmail/yahoo branch, but `l === 'test'` would miss `'test '`).
      // Left inline in this slice; migrating to the shared helper is a follow-up behavior-change slice.
      const isTestName = (name: string) => { const l = (name || '').toLowerCase(); return l === 'test' || /\b(hotmail|yahoo)\b/.test(l); };
      const intuitUserIds = new Set(invoices.filter(inv => paymentMethod(inv).toLowerCase() === 'intuit').map(inv => inv.userId));
      const unmatched: { profileId: number; userId: string; userName: string; suggested?: { beneficiaryId: number; level: 'iban' | 'name'; shortName: string; incomingVendorId: string | null } }[] = [];
      let matchedCount = 0;
      const allForSyn = (profiles || []).map(pp => ({ id: pp.id as number, iban: (pp.iban as string) || '' }));
      for (const profile of profiles || []) {
        if (profile.convera_match_override) continue;
        const user = users.find(u => u.id === profile.user_id);
        // Skip test/admin accounts and Intuit-paid contractors (not in Convera)
        if (!user || isTestName(user.name) || intuitUserIds.has(profile.user_id)) continue;
        // Already linked via vendor code / previous import — re-confirm the link is still valid, keep it
        if (profile.convera_beneficiary_id) {
          const stillExists = normBenefs.find(b => b.id === profile.convera_beneficiary_id);
          if (stillExists) { matchedCount++; continue; }
        }
        const expectedSyn = computeSynVendorCode(profile.id as number, (profile.iban as string) || '', allForSyn);
        const match = autoMatchBeneficiary(user.name, profile.iban || '', normBenefs, expectedSyn);
        if (match?.level === 'syn') {
          // Deliberate primary match — auto-link.
          await supabase.from('payment_profiles').update({ convera_beneficiary_id: match.beneficiary.id }).eq('id', profile.id);
          matchedCount++;
        } else if (match) {
          // IBAN or name fallback — surface for accountant confirmation before writing FK.
          // Guards against silent auto-link of shared-IBAN cases where SYN would have been the
          // definitive signal but Convera returned a different code (collision or manual edit).
          unmatched.push({
            profileId: profile.id, userId: profile.user_id, userName: user.name,
            suggested: {
              beneficiaryId: match.beneficiary.id,
              level: match.level,
              shortName: match.beneficiary.shortName || match.beneficiary.beneficiaryName || '(unnamed)',
              incomingVendorId: (match.beneficiary.vendorId || '').trim() || null,
            },
          });
        } else {
          unmatched.push({ profileId: profile.id, userId: profile.user_id, userName: user.name });
        }
      }
      await fetchPaymentProfiles();
      setBeneficiaryImportResult({ imported: rows.length, matched: matchedCount, unmatched });
    } catch (e) {
      console.error('Beneficiary import error:', e);
    } finally {
      setBeneficiaryImporting(false);
    }
  }

  async function setConveraOverride(profileId: number, beneficiaryId: number | null) {
    const update: Record<string, unknown> = {
      convera_beneficiary_id: beneficiaryId,
      convera_match_override: beneficiaryId !== null,
    };
    // Cascade banking fields from the canonical profile for this beneficiary so that
    // IBAN/bank/swift/country on the profile always reflect what Convera actually pays to,
    // not the contractor's personal account from their PDF.
    if (beneficiaryId !== null) {
      const canonical = paymentProfiles.find(p => p.id !== profileId && p.converaBeneficiaryId === beneficiaryId && !!p.iban);
      if (canonical) {
        update.iban = canonical.iban;
        update.bank_name = canonical.bankName;
        update.swift = canonical.swift;
        update.country = canonical.country;
      }
    }
    await supabase.from('payment_profiles').update(update).eq('id', profileId);
    await fetchPaymentProfiles();
    setBeneficiaryOverrideProfileId(null);
    setBeneficiaryOverrideSearch('');
    // Also drop this profile from the last-import unmatched snapshot so the amber
    // row disappears immediately. Without this, the frozen snapshot keeps showing
    // the profile as unmatched even after the DB is updated.
    if (beneficiaryId !== null) {
      setBeneficiaryImportResult(prev => {
        if (!prev) return prev;
        const wasUnmatched = prev.unmatched.some(u => u.profileId === profileId);
        if (!wasUnmatched) return prev;
        return {
          ...prev,
          matched: prev.matched + 1,
          unmatched: prev.unmatched.filter(u => u.profileId !== profileId),
        };
      });
    }
  }

  function normalisePaymentProfile(r: Record<string, unknown>): PaymentProfile {
    return {
      id: r.id as number,
      userId: r.user_id as string,
      profileName: (r.profile_name as string) || '',
      companyName: (r.company_name as string) || '',
      companyAddress: (r.company_address as string) || '',
      country: (r.country as string) || '',
      bankName: (r.bank_name as string) || '',
      bankAddress: (r.bank_address as string) || '',
      bankBranch: (r.bank_branch as string) || '',
      accountNumber: (r.account_number as string) || '',
      iban: (r.iban as string) || '',
      swift: (r.swift as string) || '',
      paymentEmail: (r.payment_email as string) || '',
      isDefault: !!(r.is_default as boolean),
      combinePayments: r.combine_payments != null ? !!(r.combine_payments as boolean) : null,
      converaBeneficiaryId: r.convera_beneficiary_id as number | null ?? null,
      converaMatchOverride: !!(r.convera_match_override as boolean),
      qbVendorName: (r.qb_vendor_name as string) || null,
    };
  }

  function normaliseInvoice(r: Record<string, unknown>): Invoice {
    return {
      id: r.id as number,
      invoiceNumber: (r.invoice_number as string) || String(r.id),
      userId: r.user_id as string,
      userName: r.user_name as string,
      projectId: (r.project_id as number) || null,
      periodStart: (r.period_start as string)?.split('T')[0],
      periodEnd: (r.period_end as string)?.split('T')[0],
      lines: (r.lines as InvoiceLine[]) || [],
      totalHours: r.total_hours != null ? (r.total_hours as number) : null,
      rate: r.rate != null ? (r.rate as number) : null,
      totalAmount: r.total_amount as number,
      currency: (r.currency as string) || 'USD',
      status: r.status as Invoice['status'],
      submittedAt: (r.submitted_at as string) || null,
      reviewedAt: (r.reviewed_at as string) || null,
      reviewedBy: (r.reviewed_by as string) || null,
      notes: (r.notes as string) || '',
      paymentProfile: r.payment_profile ? (r.payment_profile as PaymentProfile) : null,
      payOnDate: (r.pay_on_date as string) || null,
      paidDate: (r.paid_date as string) || null,
      attachmentPath: (r.attachment_path as string) || null,
      paymentMethodOverride: (r.payment_method as string) || null,
      isVendorInvoice: !!(r.is_vendor_invoice as boolean),
      vendorManagerId: (r.vendor_manager_id as string) || null,
      source: (r.source as Invoice['source']) || null,
      createdBy: (r.created_by as string) || null,
      reconciliationStatus: (r.reconciliation_status as 'matched' | 'mismatch' | 'unverifiable') || null,
      reconciliationDelta: r.reconciliation_delta != null ? Number(r.reconciliation_delta) : null,
      reconciliationNotes: (r.reconciliation_notes as string) || null,
      groupKey: (r.group_key as string) || null,
      corrected: !!(r.corrected as boolean),
      paymentTerms: (r.payment_terms as string) || null,
      qbExportStatus: ((r.qb_export_status as string) || 'not_exported') as Invoice['qbExportStatus'],
      qbBillTxnId: (r.qb_bill_txn_id as string) || null,
      matcherIgnore: Boolean(r.matcher_ignore),
      qbExportStatusAt: (r.qb_export_status_at as string) || null,
      editHistory: Array.isArray(r.edit_history) ? (r.edit_history as unknown[]).map(normalizeEditEntry) : [],
    };
  }

  // Generate default invoice number: INV-USERID_PREFIX-YYYYMM-NNN
  function generateInvoiceNumber(userId: string, periodStart: string): string {
    const prefix = userId.slice(0, 4).toUpperCase();
    const period = periodStart.replace(/-/g, '').slice(0, 6);
    const existing = invoices.filter(i => i.invoiceNumber.includes(`${prefix}-${period}`)).length + 1;
    return `INV-${prefix}-${period}-${String(existing).padStart(3, '0')}`;
  }

  function buildInvoiceLines(userId: string, periodStart: string, periodEnd: string, rate: number): InvoiceLine[] {
    // Delegates to the shared lib. TimeEntry.hours is stringly-typed here but
    // the lib accepts { hours: string }, matching.
    return sharedBuildInvoiceLines(
      timesheets.map(t => ({ userId: t.userId, weekStart: t.weekStart, status: t.status, entries: t.entries as Record<string, { hours: string }> })),
      userId,
      periodStart,
      periodEnd,
      rate,
    );
  }

  const submitInvoice = async () => {
    const rate = parseFloat(invoiceRate);
    if (!invoiceMonth.start || !invoiceMonth.end) { alert('Please select a period.'); return; }
    if (!rate || rate <= 0) { alert('Please enter a valid hourly rate.'); return; }
    if (!invoiceNumber.trim()) { alert('Please enter an invoice number.'); return; }

    // Validate invoice number uniqueness (exclude rejected)
    const invNumTrimmed = invoiceNumber.trim().toUpperCase();
    const duplicate = invoices.find(i => i.invoiceNumber.toUpperCase() === invNumTrimmed && i.status !== 'rejected');
    if (duplicate) { alert(`Invoice number "${invNumTrimmed}" is already used by invoice #${duplicate.id}. Please use a unique number.`); return; }

    if (!invoicePhoneConfirm.trim()) { alert('Please confirm your contact phone number.'); return; }

    const lines = buildInvoiceLines(currentUser!.id, invoiceMonth.start, invoiceMonth.end, rate);
    if (lines.length === 0) { alert('No approved timesheets found in this period.'); return; }

    const totalHours = lines.reduce((s, l) => s + (l.hours ?? 0), 0);
    const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

    // Attach selected payment profile snapshot
    const profile = paymentProfiles.find(p => p.id === selectedPaymentProfileId) || null;

    const payload = {
      invoice_number: invNumTrimmed,
      user_id: currentUser!.id,
      user_name: currentUser!.name,
      project_id: currentUser!.projectId,
      period_start: invoiceMonth.start,
      period_end: invoiceMonth.end,
      lines,
      total_hours: totalHours,
      rate,
      total_amount: totalAmount,
      currency: invoiceCurrency,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      notes: invoiceNotes,
      payment_profile: profile,
    };

    const { data: insertData, error } = await supabase.from('invoices').insert(payload).select('id').single();
    if (error) { alert('Error submitting invoice: ' + error.message); return; }

    // Upload attachment if one was selected
    if (invoiceAttachmentFile && insertData?.id) {
      setAttachmentUploading(true);
      const path = await uploadInvoiceAttachment(insertData.id, invoiceAttachmentFile);
      if (path) {
        await supabase.from('invoices').update({ attachment_path: path }).eq('id', insertData.id);
      }
      setAttachmentUploading(false);
    }

    // Save phone back to profile if changed
    const trimmedPhone = invoicePhoneConfirm.trim();
    if (trimmedPhone && trimmedPhone !== currentUser!.phone) {
      await supabase.from('profiles').update({ phone: trimmedPhone }).eq('id', currentUser!.id);
      setCurrentUser({ ...currentUser!, phone: trimmedPhone });
    }

    await fetchInvoices();
    setInvoiceView('list');
    setInvoiceRate('');
    setInvoiceNotes('');
    setInvoiceNumber('');
    setInvoicePhoneConfirm('');
    setSelectedPaymentProfileId(null);
    setInvoiceAttachmentFile(null);
    alert('Invoice submitted successfully!');
  };

  const deleteInvoice = async (invoiceId: number) => {
    if (!window.confirm('Delete this rejected invoice? This cannot be undone.')) return;
    const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
    if (error) { alert('Error deleting invoice: ' + error.message); return; }
    await fetchInvoices();
  };

  const applyUsdRate = async (inv: Invoice, usdRate: number) => {
    const totalAmount = Math.round((inv.totalHours ?? 0) * usdRate * 100) / 100;
    const newLines = inv.lines.map(l => ({ ...l, rate: usdRate, amount: Math.round((l.hours ?? 0) * usdRate * 100) / 100 }));
    const { error } = await supabase.from('invoices').update({
      rate: usdRate, total_amount: totalAmount, currency: 'USD', lines: newLines,
    }).eq('id', inv.id);
    if (error) { alert('Error updating rate: ' + error.message); return; }
    await fetchInvoices();
  };

  async function lockTimesheetDaysForInvoice(userId: string, periodStart: string, periodEnd: string) {
    const ps = new Date(periodStart + 'T00:00:00Z');
    const pe = new Date(periodEnd + 'T23:59:59Z');
    // Fetch weeks that overlap the period (week could start up to 6 days before period_start)
    const windowStart = new Date(ps.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const { data: tsList } = await supabase
      .from('timesheets')
      .select('id, week_start')
      .eq('user_id', userId)
      .gte('week_start', windowStart)
      .lte('week_start', periodEnd);
    if (!tsList?.length) return;
    for (const ts of tsList) {
      const days: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(ts.week_start + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + i);
        if (d >= ps && d <= pe) days.push(d.toISOString().slice(0, 10));
      }
      if (days.length > 0) {
        await supabase.from('timesheets').update({ locked_days: days }).eq('id', ts.id);
      }
    }
  }

  // Slice 1: at approval time, ensure the invoice's snap payment_profile is
  // explicitly mapped to a QB vendor. NO auto-inference across siblings —
  // every first use of an untagged pp opens the picker modal for confirmation.
  // Reasoning captured in [[invoice-snapshot-vs-live]] correction 2026-08-27:
  // Marta's siblings agreeing is not proof that a NEW pp routes there;
  // Tomislav's Fat Struct should never be silently mapped to Ponny based on
  // his one prior tag.
  //
  // Only fires when the effective payment method is Intuit or Convera —
  // non-QB paths don't need vendor resolution.
  //
  // Fresh-fetch pattern (feedback_state_vs_fresh_fetch): the paymentProfiles
  // React state may not reflect the latest DB write (e.g., an admin just
  // added qb_vendor_name to a pp seconds ago); read from Supabase directly.
  const tryResolveVendorForApproval = async (
    invoice: Invoice,
    effectivePaymentMethod: string,
    _onAmbiguousRetry?: () => Promise<void> | void,
  ): Promise<'proceed' | 'blocked'> => {
    // Approval only blocks when the contractor has NO payment profile at all
    // (can't route the payment anywhere). Missing QB vendor mapping does NOT
    // block approval any more -- push time handles that via the
    // "Needs vendor decision" panel on QB Automation + the push preview
    // filters those invoices out until resolved (TS.tsx ~9339, ~8895).
    if (!['Intuit', 'Convera'].includes(effectivePaymentMethod)) return 'proceed';
    const { data: liveData, error } = await supabase
      .from('payment_profiles')
      .select('id, user_id')
      .eq('user_id', invoice.userId)
      .limit(1);
    if (error) {
      alert('Cannot approve: failed to fetch payment profiles — ' + error.message);
      return 'blocked';
    }
    if (!liveData || liveData.length === 0) {
      alert(`Cannot approve: contractor has no payment profile. Add one on the Payments tab first.`);
      return 'blocked';
    }
    return 'proceed';
  };

  // Opens the InvoiceDetail modal for edit/approve/mark-paid actions. Resets
  // the pending* fields (payOn / paid) so a previous edit doesn't leak into
  // the new invoice. Row-click opens (which don't reset) use the 2-call form
  // — the reset effect at ~1583 clears pending* on selectedInvoice.id change,
  // so the explicit resets here are belt-and-braces for the action buttons.
  // See §1b-C X3.
  const openInvoiceDetail = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setShowInvoiceModal(true);
  };

  const handleInvoiceAction = async (invoiceId: number, status: 'approved' | 'rejected' | 'paid', payOnDate?: string, paidDate?: string, pmOverride?: string, paymentTerms?: string) => {
    const invoice = invoices.find(i => i.id === invoiceId);
    // QB Bill.RefNumber cap 20 chars (INVARIANTS #5b). Refuse approval when
    // invoice_number is too long for a QB-bound payment method — QB would
    // reject the push anyway. Only fires on approve→push-path transitions;
    // reject/paid still work regardless.
    if (status === 'approved') {
      const nextPM = pmOverride !== undefined ? pmOverride : (invoice?.paymentMethodOverride ?? '');
      const num = invoice?.invoiceNumber ?? '';
      if (nextPM && ['Intuit', 'Convera'].includes(nextPM) && num.length > 20) {
        alert(`Cannot approve: invoice number "${num}" is ${num.length} chars. QuickBooks caps Bill.RefNumber at 20. Edit the invoice number on the Invoices tab first, then approve.`);
        return;
      }
      // Slice 1/2: vendor resolution guard. Ambiguous cases open the picker
      // modal (Slice 2); the modal's afterResolve re-runs this approval action
      // which now succeeds because the resolver returns 'no-action' or 'auto'.
      if (invoice) {
        const outcome = await tryResolveVendorForApproval(invoice, nextPM, async () => {
          await handleInvoiceAction(invoiceId, status, payOnDate, paidDate, pmOverride, paymentTerms);
        });
        if (outcome === 'blocked') return;
      }
    }
    const update: Record<string, unknown> = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser!.name,
    };
    if (payOnDate !== undefined) update.pay_on_date = payOnDate || null;
    if (status === 'paid' && paidDate) update.paid_date = paidDate;
    if (pmOverride !== undefined) update.payment_method = pmOverride || null;
    if (paymentTerms !== undefined) update.payment_terms = paymentTerms || null;
    const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId);
    if (error) { alert('Error updating invoice: ' + error.message); return; }
    // Cascade payment terms to profile default on approval:
    //   - explicit accountant change → overwrite profile
    //   - parser-populated on invoice, profile still null → seed-once
    if (status === 'approved' && invoice?.userId) {
      let cascadeTerms: string | null = null;
      if (paymentTerms) {
        cascadeTerms = paymentTerms;
      } else if (invoice.paymentTerms) {
        const currentProfile = users.find(u => u.id === invoice.userId);
        if (!currentProfile?.paymentTerms) cascadeTerms = invoice.paymentTerms;
      }
      if (cascadeTerms) {
        const terms = cascadeTerms;
        await supabase.from('profiles').update({ payment_terms: terms }).eq('id', invoice.userId);
        setUsers(prev => prev.map(u => u.id === invoice.userId ? { ...u, paymentTerms: terms } : u));
      }
    }
    if (status === 'approved' && invoice?.userId && invoice?.periodStart && invoice?.periodEnd) {
      await lockTimesheetDaysForInvoice(invoice.userId, invoice.periodStart, invoice.periodEnd);
    }
    await fetchInvoices();
    setShowInvoiceModal(false);
  };

  const toggleCombinePayments = async (profileId: number, current: boolean | null) => {
    const next = current === true ? false : true;
    const { error } = await supabase.from('payment_profiles').update({ combine_payments: next }).eq('id', profileId);
    if (error) { alert('Error updating profile: ' + error.message); return; }
    setPaymentProfiles(prev => prev.map(p => p.id === profileId ? { ...p, combinePayments: next } : p));
    setInvoices(prev => prev.map(inv =>
      inv.paymentProfile?.id === profileId
        ? { ...inv, paymentProfile: { ...inv.paymentProfile!, combinePayments: next } }
        : inv
    ));
  };

  // Save QB vendor name inline edit. Empty string → NULL (unmap).
  const saveQbVendorName = async (profileId: number, raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : trimmed;
    const { error } = await supabase.from('payment_profiles').update({ qb_vendor_name: next }).eq('id', profileId);
    if (error) { alert('Error saving QB vendor: ' + error.message); return; }
    setPaymentProfiles(prev => prev.map(p => p.id === profileId ? { ...p, qbVendorName: next } : p));
    // Caller resets qbVendorEditingId in its own onSave handler (F2).
  };

  // Set invoice qb_export_status (used for Skip/Unskip in modal).
  const saveInvoiceExportStatus = async (invoiceId: number, next: Invoice['qbExportStatus']) => {
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('invoices').update({ qb_export_status: next, qb_export_status_at: nowIso }).eq('id', invoiceId);
    if (error) { alert('Error updating export status: ' + error.message); return; }
    setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, qbExportStatus: next, qbExportStatusAt: nowIso } : i));
    setQbExportSnapshot(prev => prev.map(i => i.id === invoiceId ? { ...i, qbExportStatus: next, qbExportStatusAt: nowIso } : i));
    // If we just skipped a currently-selected invoice, drop it from selection
    if (next === 'skipped') setQbExportSelectedIds(prev => { const n = new Set(prev); n.delete(invoiceId); return n; });
  };

  // Save approval status and/or pay on date without closing modal
  const saveInvoiceEdits = async (invoiceId: number, fields: { status?: 'approved' | 'rejected'; payOnDate?: string; paymentMethod?: string; paymentTerms?: string; invoiceNumber?: string }) => {
    const invoice = invoices.find(i => i.id === invoiceId);
    // QB Bill.RefNumber cap 20 chars (INVARIANTS #5b, 2026-08-27 Vladimir
    // "INV SYNERGIE 07/01-31/2026" rejection). Refuse approval when the
    // effective invoice_number would exceed QB's limit and the invoice
    // is Intuit/Convera-bound. Editing invoice_number alone at any status
    // is warned but not blocked.
    const nextInvoiceNumber = fields.invoiceNumber !== undefined ? fields.invoiceNumber : (invoice?.invoiceNumber ?? '');
    const nextPaymentMethod = fields.paymentMethod !== undefined ? fields.paymentMethod : (invoice?.paymentMethodOverride ?? '');
    const willBeApproved = fields.status === 'approved' || (fields.status === undefined && invoice?.status === 'approved');
    const pushablePM = nextPaymentMethod && ['Intuit', 'Convera'].includes(nextPaymentMethod);
    if (willBeApproved && pushablePM && nextInvoiceNumber && nextInvoiceNumber.length > 20) {
      alert(`Cannot approve: invoice number "${nextInvoiceNumber}" is ${nextInvoiceNumber.length} chars. QuickBooks caps Bill.RefNumber at 20. Shorten the invoice number first (edit inline on the Invoices tab or in this modal).`);
      return;
    }
    if (fields.invoiceNumber !== undefined && fields.invoiceNumber.length > 20 && !confirm(`Invoice number "${fields.invoiceNumber}" is ${fields.invoiceNumber.length} chars. QuickBooks caps Bill.RefNumber at 20 and will refuse any push. Continue anyway?`)) {
      return;
    }
    // Slice 1/2: vendor resolution guard on approval transitions.
    if (fields.status === 'approved' && invoice && pushablePM) {
      const outcome = await tryResolveVendorForApproval(invoice, nextPaymentMethod, async () => {
        await saveInvoiceEdits(invoiceId, fields);
      });
      if (outcome === 'blocked') return;
    }
    const update: Record<string, unknown> = {};
    if (fields.status !== undefined) {
      update.status = fields.status;
      update.reviewed_at = new Date().toISOString();
      update.reviewed_by = currentUser!.name;
    }
    if (fields.payOnDate !== undefined) update.pay_on_date = fields.payOnDate || null;
    if (fields.paymentMethod !== undefined) update.payment_method = fields.paymentMethod || null;
    if (fields.paymentTerms !== undefined) update.payment_terms = fields.paymentTerms || null;
    if (fields.invoiceNumber !== undefined) update.invoice_number = fields.invoiceNumber || null;
    const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId);
    if (error) { alert('Error saving changes: ' + error.message); return; }
    // Cascade payment terms to profile default when approving
    //   - explicit accountant change → overwrite profile
    //   - parser-populated on invoice, profile still null → seed-once
    if (fields.status === 'approved' && invoice?.userId) {
      let cascadeTerms: string | null = null;
      if (fields.paymentTerms) {
        cascadeTerms = fields.paymentTerms;
      } else if (invoice.paymentTerms) {
        const currentProfile = users.find(u => u.id === invoice.userId);
        if (!currentProfile?.paymentTerms) cascadeTerms = invoice.paymentTerms;
      }
      if (cascadeTerms) {
        const terms = cascadeTerms;
        await supabase.from('profiles').update({ payment_terms: terms }).eq('id', invoice.userId);
        setUsers(prev => prev.map(u => u.id === invoice.userId ? { ...u, paymentTerms: terms } : u));
      }
    }
    if (fields.status === 'approved' && invoice?.userId && invoice?.periodStart && invoice?.periodEnd) {
      await lockTimesheetDaysForInvoice(invoice.userId, invoice.periodStart, invoice.periodEnd);
    }
    await fetchInvoices();
    setSelectedInvoice(prev => prev ? {
      ...prev,
      ...(fields.status ? { status: fields.status, reviewedBy: currentUser!.name, reviewedAt: new Date().toISOString() } : {}),
      ...(fields.payOnDate !== undefined ? { payOnDate: fields.payOnDate || null } : {}),
      ...(fields.paymentMethod !== undefined ? { paymentMethodOverride: fields.paymentMethod || null } : {}),
      ...(fields.paymentTerms !== undefined ? { paymentTerms: fields.paymentTerms || null } : {}),
      ...(fields.invoiceNumber !== undefined ? { invoiceNumber: fields.invoiceNumber || '' } : {}),
    } : prev);
  };

  // Preview what happens when the invoice period is edited: collision with an existing
  // invoice, timesheet-lock diff (only meaningful once approved), recon change under the
  // new period, and any Convera payment already matched to this invoice.
  function previewPeriodChange(inv: Invoice, newStart: string, newEnd: string) {
    // Collision: any other non-rejected invoice for the same contractor whose period overlaps.
    const collisions = invoices.filter(o =>
      o.id !== inv.id &&
      o.userId === inv.userId &&
      o.status !== 'rejected' &&
      o.periodStart && o.periodEnd &&
      o.periodStart <= newEnd && o.periodEnd >= newStart
    );

    // Recon under the new period — pure eval, no DB.
    const nextInv: Invoice = { ...inv, periodStart: newStart, periodEnd: newEnd };
    const nextRecon = reconcileInvoiceLive(nextInv, timesheets);

    // Lock diff: only relevant when status is approved or paid (period locks days on approve).
    // Compute set of dates in old range vs new range.
    const dateSet = (s: string, e: string) => {
      const out = new Set<string>();
      const cur = new Date(s + 'T12:00:00Z');
      const end = new Date(e + 'T12:00:00Z');
      while (cur <= end) { out.add(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
      return out;
    };
    const willChangeLocks = inv.status === 'approved' || inv.status === 'paid';
    const oldDays = willChangeLocks ? dateSet(inv.periodStart, inv.periodEnd) : new Set<string>();
    const newDays = willChangeLocks ? dateSet(newStart, newEnd) : new Set<string>();
    const toUnlock = [...oldDays].filter(d => !newDays.has(d)).sort();
    const toLock = [...newDays].filter(d => !oldDays.has(d)).sort();

    // Convera payment already matched to this invoice (direct or umbrella).
    const converaMatch = converaTransactions.find(t =>
      t.matchedInvoiceId === inv.id ||
      (t.matchedInvoiceIds || []).includes(inv.id)
    );

    return { collisions, nextRecon, willChangeLocks, toUnlock, toLock, converaMatch };
  }

  const savePeriodEdit = async (inv: Invoice, newStart: string, newEnd: string, reason: string) => {
    if (!newStart || !newEnd) { alert('Both period start and end are required.'); return; }
    if (newEnd < newStart) { alert('Period end must be on or after period start.'); return; }
    if (!reason.trim()) { alert('Please enter a reason for this change.'); return; }
    if (inv.status === 'paid') { alert('Cannot edit period of a paid invoice. Revert to approved first.'); return; }

    const nextInv: Invoice = { ...inv, periodStart: newStart, periodEnd: newEnd };
    const nextRecon = reconcileInvoiceLive(nextInv, timesheets);
    const newEntry = periodEditEntry({
      by: currentUser!.name,
      reason: reason.trim(),
      beforePeriodStart: inv.periodStart,
      beforePeriodEnd: inv.periodEnd,
      afterPeriodStart: newStart,
      afterPeriodEnd: newEnd,
    });
    const nextHistory = [...(inv.editHistory || []), newEntry];

    const reconNotes = nextRecon.timesheetHours != null
      ? `Timesheet: ${nextRecon.timesheetHours}h · Invoice: ${inv.totalHours ?? '—'}h`
      : 'No timesheets in period';

    const { error } = await supabase.from('invoices').update({
      period_start: newStart,
      period_end: newEnd,
      edit_history: nextHistory,
      reconciliation_status: nextRecon.status,
      reconciliation_delta: nextRecon.delta,
      reconciliation_notes: reconNotes,
    }).eq('id', inv.id);
    if (error) { alert('Error saving period change: ' + error.message); return; }

    // Re-run timesheet locking if the invoice already carries locks (approved).
    if (inv.status === 'approved') {
      const dateSet = (s: string, e: string) => {
        const out = new Set<string>();
        const cur = new Date(s + 'T12:00:00Z');
        const end = new Date(e + 'T12:00:00Z');
        while (cur <= end) { out.add(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
        return out;
      };
      const oldDays = dateSet(inv.periodStart, inv.periodEnd);
      const newDays = dateSet(newStart, newEnd);
      // Union of old + new range determines which timesheets to touch.
      const unionStart = inv.periodStart < newStart ? inv.periodStart : newStart;
      const unionEnd = inv.periodEnd > newEnd ? inv.periodEnd : newEnd;
      const windowStart = new Date(new Date(unionStart + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10);
      const { data: tsList } = await supabase
        .from('timesheets')
        .select('id, week_start, locked_days')
        .eq('user_id', inv.userId)
        .gte('week_start', windowStart)
        .lte('week_start', unionEnd);
      for (const ts of tsList || []) {
        const existing: string[] = Array.isArray(ts.locked_days)
          ? (ts.locked_days as string[]).map(d => (d + '').slice(0, 10))
          : [];
        // Strip any day that was locked because of THIS invoice's old range (and no other
        // reason we can detect) and add any day newly inside the new range.
        const kept = existing.filter(d => !oldDays.has(d));
        for (let i = 0; i < 7; i++) {
          const d = new Date(ts.week_start + 'T12:00:00Z');
          d.setUTCDate(d.getUTCDate() + i);
          const dStr = d.toISOString().slice(0, 10);
          if (newDays.has(dStr) && !kept.includes(dStr)) kept.push(dStr);
        }
        await supabase.from('timesheets').update({ locked_days: kept.length ? kept : null }).eq('id', ts.id);
      }
    }

    await fetchInvoices();
    setSelectedInvoice(prev => prev && prev.id === inv.id ? {
      ...prev,
      periodStart: newStart,
      periodEnd: newEnd,
      editHistory: nextHistory,
      reconciliationStatus: nextRecon.status,
      reconciliationDelta: nextRecon.delta,
      reconciliationNotes: reconNotes,
    } : prev);
    alert('Period updated.');
  };

  const saveValueEdit = async (inv: Invoice, newHours: number, newRate: number, reason: string) => {
    // Single-line invariant. Multi-line invoices force the accountant to reject
    // and re-request from the contractor — silent line-collapse or rescale would
    // hide the mismatch from QB export and downstream reports.
    if (inv.lines.length !== 1) { alert('Multi-line invoice — value editing not supported. Reject and ask contractor to re-submit.'); return; }
    if (inv.status === 'paid') { alert('Cannot edit values on a paid invoice. Revert to approved first.'); return; }
    if (!(newHours >= 0) || !(newRate >= 0)) { alert('Hours and rate must be non-negative numbers.'); return; }
    if (!reason.trim()) { alert('Please enter a reason for this change.'); return; }

    const newTotal = Math.round(newHours * newRate * 100) / 100;
    const line0 = inv.lines[0];
    const newLines = [{ ...line0, hours: newHours, rate: newRate, amount: newTotal }];

    const nextInv: Invoice = { ...inv, totalHours: newHours, rate: newRate, totalAmount: newTotal, lines: newLines };
    const nextRecon = reconcileInvoiceLive(nextInv, timesheets);
    const reconNotes = nextRecon.timesheetHours != null
      ? `Timesheet: ${nextRecon.timesheetHours}h · Invoice: ${newHours}h`
      : 'No timesheets in period';

    const newEntry = valueEditEntry({
      by: currentUser!.name,
      reason: reason.trim(),
      beforeHours: inv.totalHours,
      beforeRate: inv.rate,
      beforeTotal: inv.totalAmount,
      afterHours: newHours,
      afterRate: newRate,
      afterTotal: newTotal,
    });
    const nextHistory = [...(inv.editHistory || []), newEntry];

    const { error } = await supabase.from('invoices').update({
      total_hours: newHours,
      rate: newRate,
      total_amount: newTotal,
      lines: newLines,
      edit_history: nextHistory,
      reconciliation_status: nextRecon.status,
      reconciliation_delta: nextRecon.delta,
      reconciliation_notes: reconNotes,
    }).eq('id', inv.id);
    if (error) { alert('Error saving value change: ' + error.message); return; }

    await fetchInvoices();
    setSelectedInvoice(prev => prev && prev.id === inv.id ? {
      ...prev,
      totalHours: newHours,
      rate: newRate,
      totalAmount: newTotal,
      lines: newLines,
      editHistory: nextHistory,
      reconciliationStatus: nextRecon.status,
      reconciliationDelta: nextRecon.delta,
      reconciliationNotes: reconNotes,
    } : prev);
    alert('Invoice values updated.');
  };

  const switchInvoicePaymentProfile = async (invoiceId: number, newProfile: PaymentProfile) => {
    // Guardrail: if the selected profile links to a deprecated Convera beneficiary
    // (e.g. one of the retired Bimosoft aux benes), auto-redirect to the contractor's
    // profile linked to the resolved replacement bene. Accountant is notified but does
    // not need to re-pick — the correct route is chosen for them.
    let profileToSave = newProfile;
    if (newProfile.converaBeneficiaryId) {
      const bene = converaBeneficiaries.find(b => b.id === newProfile.converaBeneficiaryId);
      if (bene?.deprecated) {
        const replBeneId = bene.replacementBeneficiaryId;
        const replBene = replBeneId ? converaBeneficiaries.find(b => b.id === replBeneId) : null;
        if (replBene) {
          // Find the contractor's OWN profile that links to the replacement bene.
          const inv = invoices.find(i => i.id === invoiceId);
          const userId = inv?.userId;
          const replProfile = userId
            ? paymentProfiles.find(p => p.userId === userId && p.converaBeneficiaryId === replBene.id)
            : null;
          if (replProfile) {
            alert(
              `⚠ Auto-switched to "${replProfile.profileName}" (bene ${replBene.shortName || replBene.beneficiaryName}).\n\n` +
              `You picked "${newProfile.profileName}", which links to DEPRECATED bene "${bene.shortName || bene.beneficiaryName}" (${bene.deprecatedReason || 'deprecated'}).`
            );
            profileToSave = replProfile;
          } else {
            alert(
              `❌ Cannot switch: profile "${newProfile.profileName}" links to DEPRECATED bene "${bene.shortName || bene.beneficiaryName}".\n\n` +
              `Recommended replacement bene: "${replBene.shortName || replBene.beneficiaryName}" (${replBene.id}).\n\n` +
              `No profile for this contractor links to the replacement bene. Create/link a profile first, then re-try.`
            );
            return;
          }
        } else {
          alert(
            `❌ Cannot switch: profile "${newProfile.profileName}" links to DEPRECATED bene "${bene.shortName || bene.beneficiaryName}" with no replacement configured.\n\n` +
            `Manual review required.`
          );
          return;
        }
      }
    }
    const { error } = await supabase.from('invoices').update({ payment_profile: profileToSave }).eq('id', invoiceId);
    if (error) { alert('Error switching profile: ' + error.message); return; }
    setSelectedInvoice(prev => prev ? { ...prev, paymentProfile: profileToSave } : prev);
    setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, paymentProfile: profileToSave } : i));
  };


  const savePaymentProfile = async () => {
    if (!profileForm.profileName || !profileForm.companyName || !profileForm.bankName || !profileForm.accountNumber || !profileForm.swift) {
      alert('Please fill in all required fields: Profile Label, Company Name, Bank Name, Account Number and SWIFT/BIC.'); return;
    }
    // IBAN validation — same rule as parser/ingest-invoice. If the IBAN fails checksum
    // OR its length is wrong for its country prefix, force the accountant to confirm.
    // See pp #105 incident: a length-20 HR IBAN silently landed from PDF parse and
    // was pasted into Convera before anyone noticed.
    if (profileForm.iban) {
      const cleaned = sanitizeIban(profileForm.iban);
      const lenCheck = checkIbanLength(cleaned);
      const csValid = ibanChecksumValid(cleaned);
      if (!csValid || !lenCheck.ok) {
        const reasons: string[] = [];
        if (!lenCheck.ok) reasons.push(`length is ${lenCheck.actual} but ${cleaned.slice(0, 2)} IBANs are ${lenCheck.expected} chars`);
        if (!csValid) reasons.push(`fails ISO 13616 checksum`);
        const proceed = window.confirm(
          `IBAN "${cleaned}" looks invalid:\n · ${reasons.join('\n · ')}\n\nSaving a bad IBAN causes Convera payments to silently mis-route or be dropped.\n\nSave anyway?`
        );
        if (!proceed) return;
      }
      if (cleaned !== profileForm.iban) profileForm.iban = cleaned;
    }
    // Use profileEditUserId when set (accountant editing another contractor); fall back to currentUser
    const targetUserId = profileEditUserId || currentUser!.id;
    const payload = {
      user_id: targetUserId,
      profile_name: profileForm.profileName,
      company_name: profileForm.companyName,
      company_address: profileForm.companyAddress,
      country: profileForm.country,
      bank_name: profileForm.bankName,
      bank_address: profileForm.bankAddress,
      bank_branch: profileForm.bankBranch,
      account_number: profileForm.accountNumber,
      iban: profileForm.iban,
      swift: profileForm.swift,
      payment_email: profileForm.paymentEmail,
      is_default: profileForm.isDefault,
    };
    if (editingProfile) {
      const { error } = await supabase.from('payment_profiles').update(payload).eq('id', editingProfile.id);
      if (error) { alert('Error updating profile: ' + error.message); return; }
    } else {
      const { error } = await supabase.from('payment_profiles').insert(payload);
      if (error) { alert('Error saving profile: ' + error.message); return; }
    }
    // If marked default, unset others for the target user
    if (profileForm.isDefault && editingProfile) {
      await supabase.from('payment_profiles').update({ is_default: false }).eq('user_id', targetUserId).neq('id', editingProfile.id);
    } else if (profileForm.isDefault) {
      const { data: last } = await supabase.from('payment_profiles').select('id').eq('user_id', targetUserId).order('id', { ascending: false }).limit(1);
      if (last && last[0]) await supabase.from('payment_profiles').update({ is_default: false }).eq('user_id', targetUserId).neq('id', last[0].id);
    }
    await fetchPaymentProfiles();
    setShowProfileModal(false); setProfileEditUserId(null);
    setEditingProfile(null);
    setProfileEditUserId(null);
    setProfileForm(emptyProfileForm());
  };

  const deletePaymentProfile = async (profileId: number, profileName?: string) => {
    const msg = profileName
      ? `Delete payment profile "${profileName}"?\n\nHistorical invoices using this profile keep their snapshot (no data loss), but this option is removed from the dropdown going forward.`
      : 'Delete this payment profile?';
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from('payment_profiles').delete().eq('id', profileId);
    if (error) { alert('Error: ' + error.message); return; }
    setPaymentProfiles(prev => prev.filter(p => p.id !== profileId));
    // If the currently-open invoice was using this profile, strip its JSONB so the
    // dropdown shows the re-pick prompt.
    if (selectedInvoice?.paymentProfile?.id === profileId) {
      await supabase.from('invoices').update({ payment_profile: null }).eq('id', selectedInvoice.id);
      setSelectedInvoice(prev => prev ? { ...prev, paymentProfile: null } : prev);
      setInvoices(prev => prev.map(i => i.id === selectedInvoice.id ? { ...i, paymentProfile: null } : i));
    }
  };

  // ─── Template-form profile creation ──────────────────────────────────────
  // Accountant pastes the contractor's bank-details reply; parser extracts fields.
  // A new payment_profiles row is inserted; convera_beneficiary_id stays NULL.
  // Accountant then creates the beneficiary in Convera using the surfaced SYN code,
  // and the next beneficiary import closes the loop via SYN match.
  const openTemplateProfileModal = (userId: string) => {
    setTemplateProfileUserId(userId);
    setTemplateProfileText('');
    setTemplateProfilePreview(null);
    setTemplateProfileError('');
    setShowTemplateProfileModal(true);
  };

  const parseTemplateForPreview = () => {
    setTemplateProfileError('');
    const parsed = parseProfileTemplate(templateProfileText);
    if (!parsed.companyName && !parsed.iban && !parsed.swift) {
      setTemplateProfileError('Could not find Company Name, IBAN, or SWIFT in the pasted text. Check the format and try again.');
      setTemplateProfilePreview(null);
      return;
    }
    setTemplateProfilePreview(parsed);
  };

  const saveTemplateProfile = async () => {
    if (!templateProfilePreview || !templateProfileUserId) return;
    const p = templateProfilePreview;
    // Minimum required per feature spec: Company + IBAN + SWIFT.
    if (!p.companyName || !p.iban || !p.swift) {
      setTemplateProfileError('Company Name, IBAN, and SWIFT are required. Fill in any missing fields before saving.');
      return;
    }
    setTemplateProfileSaving(true);
    const user = users.find(u => u.id === templateProfileUserId);
    const payload = {
      user_id: templateProfileUserId,
      profile_name: p.companyName.slice(0, 60) || (user?.name ?? 'Imported'),
      company_name: p.companyName,
      company_address: p.companyAddress,
      country: p.country,
      bank_name: p.bankName,
      bank_address: p.bankAddress,
      bank_branch: p.bankBranch,
      account_number: p.accountNumber,
      iban: p.iban,
      swift: p.swift,
      payment_email: p.paymentEmail,
      is_default: paymentProfiles.filter(pp => pp.userId === templateProfileUserId).length === 0,
      convera_beneficiary_id: null,
    };
    const { error } = await supabase.from('payment_profiles').insert(payload);
    setTemplateProfileSaving(false);
    if (error) { setTemplateProfileError('Save failed: ' + error.message); return; }
    await fetchPaymentProfiles();
    setShowTemplateProfileModal(false);
    setTemplateProfileText('');
    setTemplateProfilePreview(null);
    setTemplateProfileUserId(null);
  };

  // ─── PDF Attachment helpers ───────────────────────────────────────────────
  const uploadInvoiceAttachment = async (invoiceId: number, file: File): Promise<string | null> => {
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `invoices/${currentUser!.id}/${invoiceId}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('invoice-attachments').upload(path, file, { upsert: true, contentType: file.type });
    if (error) { alert('Upload failed: ' + error.message); return null; }
    return path;
  };

  const getAttachmentSignedUrl = async (path: string): Promise<{ url: string | null; error: string | null }> => {
    const { data, error } = await supabase.storage.from('invoice-attachments').createSignedUrl(path, 3600);
    if (error) return { url: null, error: error.message };
    if (!data?.signedUrl) return { url: null, error: 'No URL returned' };
    return { url: data.signedUrl, error: null };
  };

  const openAttachment = async (inv: Invoice) => {
    if (!inv.attachmentPath) return;
    // Use cached blob URL if available (avoids re-fetching)
    if (attachmentSignedUrls[inv.id]) {
      window.open(attachmentSignedUrls[inv.id], '_blank', 'noopener');
      return;
    }
    const { url: signedUrl, error } = await getAttachmentSignedUrl(inv.attachmentPath);
    if (!signedUrl) { alert(`Could not open attachment: ${error || 'Unknown error'}`); return; }
    // Open the signed URL directly — it's a short-lived HTTPS URL that the browser
    // can display natively. No blob fetch needed; re-render is prevented by loadedUserIdRef.
    setAttachmentSignedUrls(prev => ({ ...prev, [inv.id]: signedUrl }));
    window.open(signedUrl, '_blank', 'noopener');
  };

  const handleAttachmentUploadForExisting = async (inv: Invoice, file: File) => {
    setAttachmentUploading(true);
    const path = await uploadInvoiceAttachment(inv.id, file);
    if (path) {
      const { error } = await supabase.from('invoices').update({ attachment_path: path }).eq('id', inv.id);
      if (error) { alert('Could not save attachment reference: ' + error.message); }
      else {
        await fetchInvoices();
        // Bust cached URL so next open re-fetches
        setAttachmentSignedUrls(prev => { const n = { ...prev }; delete n[inv.id]; return n; });
      }
    }
    setAttachmentUploading(false);
  };

  // ─── Convera import ───────────────────────────────────────────────────────────

  function normaliseRef(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/^inv(oice)?/, '');   // strip the common "INV" / "Invoice" prefix so
                                     // "07" (Convera ref) matches "INV 07" (invoice number)
  }

  function normaliseBeneficiaryName(s: string): string {
    return (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Resolve beneficiary: vendor code (SYN-XXXX etc.) first via the stored vendor_id
  // column, then name fallback. Vendor codes are NOT SYN-{db_id:04d} — Convera assigns
  // them independently; the number in "SYN-0164" is a Convera counter, not our DB id.
  function resolveBeneficiary(beneficiary: string, vendorCode?: string): ConveraBeneficiary | null {
    if (vendorCode) {
      const vc = vendorCode.trim().toUpperCase();
      const byCode = converaBeneficiaries.find(b => (b.vendorId || '').toUpperCase() === vc);
      if (byCode) return byCode;
    }
    const norm = normaliseBeneficiaryName(beneficiary);
    return norm ? (converaBeneficiaries.find(b =>
      normaliseBeneficiaryName(b.shortName) === norm ||
      normaliseBeneficiaryName(b.beneficiaryName) === norm) ?? null) : null;
  }

  // Group match: beneficiary_id → all contractors sharing that Convera account → invoices
  // within 7 days of txnDate whose sum equals amount exactly.
  // Tries unpaid invoices first; falls back to paid ones so re-imports show "already paid" not "no match".
  function matchPaymentGroup(beneficiary: string, amount: number, txnDate: string, vendorCode?: string, invoicesOverride?: Invoice[], profilesOverride?: PaymentProfile[]): Invoice[] | null {
    const invs = invoicesOverride ?? invoices;
    const profs = profilesOverride ?? paymentProfiles;
    const matchedBenef = resolveBeneficiary(beneficiary, vendorCode);
    if (!matchedBenef) return null;
    const userIds = new Set(
      profs.filter(p => p.converaBeneficiaryId === matchedBenef.id).map(p => p.userId)
    );
    if (!userIds.size) return null;
    const parseYMD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
    const txMs = parseYMD(txnDate);
    // Same period-floor + approval-guard safeguards as matchPaymentToInvoice.
    const inWindow = invs.filter(inv =>
      userIds.has(inv.userId) &&
      inv.paymentProfile !== null &&
      !inv.matcherIgnore &&
      inv.payOnDate != null &&
      inv.periodStart >= '2026-05-01' &&
      Math.abs(parseYMD(inv.payOnDate) - txMs) / 86400000 <= 7
    );
    // Prefer unpaid; fall back to paid (re-import detection)
    for (const statusFilter of [
      (inv: Invoice) => inv.status !== 'paid',
      (inv: Invoice) => inv.status === 'paid',
    ]) {
      const group = inWindow.filter(statusFilter);
      if (!group.length) continue;
      const total = group.reduce((s, inv) => s + inv.totalAmount, 0);
      if (Math.abs(total - amount) < 0.02) return group;
    }
    return null;
  }

  // 5-level payment matching:
  // Resolves Convera beneficiary name → converaBeneficiaryId → user IDs → candidate invoices.
  // Then applies: L1=ref, L2=+amount, L3=+date proximity, L4=amount-only, L5=flag (null).
  // Only invoices from May 2026 onward participate in Payments matching.
  // Pre-May was reconciled by a one-off historical script (scripts/poller/mark-invoices-paid.js).
  // Anything below this floor in the auto-match path is noise.
  const PAYMENTS_INVOICE_PERIOD_FLOOR = '2026-05-01';

  function matchPaymentToInvoice(
    invoiceRef: string,
    beneficiary: string,
    amount: number,
    paymentDate?: string,  // YYYY-MM-DD; undefined for PDF/QB where date isn't available
    vendorCode?: string,
    invoicesOverride?: Invoice[],
    profilesOverride?: PaymentProfile[],
    claimedInvoiceIds?: Set<number>,  // matched_invoice_id already used by another convera_transaction
  ): { invoice: Invoice; level: number; confidence: MatchConfidence } | null {
    const invs = invoicesOverride ?? invoices;
    const profs = profilesOverride ?? paymentProfiles;
    const claimed = claimedInvoiceIds ?? new Set<number>();
    const normRef = normaliseRef(invoiceRef);

    // Resolve beneficiary: vendor code (SYN-XXXX) first, then name fallback
    const matchedBenef = resolveBeneficiary(beneficiary, vendorCode);

    // ── Candidate pools ───────────────────────────────────────────────────
    // isBroadEligible: invoice has a payment_profile snapshot AND is not fenced off as
    //   historical (matcher_ignore) AND is not already claimed by another transaction.
    // isStrictEligible: additionally requires unpaid + pay_on_date set + period floor.
    //   Used for amount-only matching where the safeguards matter most.
    //
    // matcher_ignore fences off pre-2026-04-28 invoices (Submitted->Paid legacy that
    // pre-dated the Submitted->Approved->Paid workflow). Those records stay visible on
    // invoice pages and exports; they're only invisible to the payment matcher.
    //
    // Cross-txn double-attribution guard: an invoice already the matched_invoice_id of
    // ANOTHER convera_transaction is excluded from every pool. Prevents silently attributing
    // two payments to one invoice (which would also overwrite the invoice's paid_date on
    // Process). Idempotent re-imports of the SAME transaction are handled upstream by the
    // dedup path — that never re-enters the matcher.
    const isBroadEligible = (inv: Invoice): boolean =>
      inv.paymentProfile !== null && !inv.matcherIgnore && !claimed.has(inv.id);
    const isStrictEligible = (inv: Invoice): boolean =>
      isBroadEligible(inv) &&
      inv.status !== 'paid' &&
      inv.payOnDate !== null &&
      inv.periodStart >= PAYMENTS_INVOICE_PERIOD_FLOOR;

    let broadPool: Invoice[];
    if (matchedBenef) {
      const userIds = new Set(
        profs
          .filter(p => p.converaBeneficiaryId === matchedBenef.id)
          .map(p => p.userId)
      );
      broadPool = invs.filter(inv => userIds.has(inv.userId) && isBroadEligible(inv));
    } else {
      broadPool = invs.filter(isBroadEligible);
    }
    const strictPool = broadPool.filter(isStrictEligible);

    const parseYMD = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
    // Asymmetric date windows around invoice pay_on_date, derived from real payment data:
    // payments almost always arrive ON or BEFORE pay_on_date, rarely later.
    //   Tight (-7/+3): on-time payment — used for Level 4 strong (no ref, amount + close date)
    //   Wide  (-14/+7): mild early/late — used for Level 5 weak (no ref, amount + broader date)
    //   Legacy withinWindow (±15) — used for ref-based tiebreaks only
    const dateDelta = (inv: Invoice): number | null => {
      if (!paymentDate || !inv.payOnDate) return null;
      return (parseYMD(paymentDate) - parseYMD(inv.payOnDate)) / 86400000;
    };
    const withinTight = (inv: Invoice): boolean => {
      const d = dateDelta(inv);
      return d !== null && d >= -7 && d <= 3;
    };
    const withinWide = (inv: Invoice): boolean => {
      const d = dateDelta(inv);
      return d !== null && d >= -14 && d <= 7;
    };
    // For ref-based tiebreak (Level 3) — permissive, no auto-reject if a date is missing
    const withinRefWindow = (inv: Invoice): boolean => {
      const d = dateDelta(inv);
      return d === null || (d >= -15 && d <= 15);
    };
    const closestDate = (a: Invoice, b: Invoice): number => {
      const da = dateDelta(a);
      const db = dateDelta(b);
      if (da !== null && db !== null && da !== db) return Math.abs(da) - Math.abs(db);
      return a.periodStart.localeCompare(b.periodStart);
    };

    if (normRef) {
      // Ref-based matches (L1-L3) use the BROAD pool; ref is the strong signal.
      // Prefer unpaid within any tie — a paid invoice ref-matching means the underlying
      // invoice has already been reconciled; another matching payment is either a duplicate
      // (very rare) or the ref is wrong on the incoming side. Better to leave it unreviewed
      // for human eyes than to overwrite the invoice's paid_date on Process.
      //
      // Date sanity on the ref match: if the payment lands >14 days BEFORE the invoice's
      // pay_on_date, that's suspicious — Convera does not pay a month early. Downgrade the
      // confidence to 'weak' so the accountant reviews before Process. Late payments are
      // common (contractors defer) so we don't gate on the upper side; only guard the
      // "paid way too early" case which is what caused the historic June 16 -> INV 07
      // (pay_on_date July 15) mis-match. Invoices with no pay_on_date get a pass.
      const refPassesDateSanity = (inv: Invoice): boolean => {
        const d = dateDelta(inv);
        return d === null || d >= -14;
      };
      const refConfidence = (inv: Invoice): MatchConfidence =>
        refPassesDateSanity(inv) ? 'strong' : 'weak';

      const byRef = broadPool.filter(inv => normaliseRef(inv.invoiceNumber) === normRef);
      const preferUnpaid = (arr: Invoice[]) => {
        const unpaid = arr.filter(inv => inv.status !== 'paid');
        return unpaid.length > 0 ? unpaid : arr;
      };

      if (byRef.length === 1) return { invoice: byRef[0], level: 1, confidence: refConfidence(byRef[0]) };

      if (byRef.length > 1) {
        const byRefUnpaid = preferUnpaid(byRef);
        if (byRefUnpaid.length === 1) return { invoice: byRefUnpaid[0], level: 1, confidence: refConfidence(byRefUnpaid[0]) };

        const byRefAmt = byRefUnpaid.filter(inv => Math.abs(inv.totalAmount - amount) < 0.02);
        if (byRefAmt.length === 1) return { invoice: byRefAmt[0], level: 2, confidence: refConfidence(byRefAmt[0]) };

        if (byRefAmt.length > 1) {
          const byRefAmtDate = byRefAmt.filter(withinRefWindow);
          if (byRefAmtDate.length >= 1) {
            const pick = [...byRefAmtDate].sort(closestDate)[0];
            return { invoice: pick, level: 3, confidence: refConfidence(pick) };
          }
        }
      }
    }

    // Non-ref path uses the STRICT pool (period floor + not paid + payment approval snapshot).
    // Split by date proximity into strong (tight) vs weak (wide).
    const amountCandidates = strictPool.filter(inv => Math.abs(inv.totalAmount - amount) < 0.02);

    // Level 4 STRONG: amount + tight date window (-7/+3 days). Requires both dates present.
    const tight = amountCandidates.filter(withinTight);
    if (tight.length === 1) return { invoice: tight[0], level: 4, confidence: 'strong' };
    if (tight.length > 1)  return { invoice: [...tight].sort(closestDate)[0], level: 4, confidence: 'strong' };

    // Level 5 WEAK: amount + wide date window (-14/+7). Requires both dates present.
    const wide = amountCandidates.filter(withinWide);
    if (wide.length === 1) return { invoice: wide[0], level: 5, confidence: 'weak' };
    if (wide.length > 1)  return { invoice: [...wide].sort(closestDate)[0], level: 5, confidence: 'weak' };

    return null;
  }

  // ─── Payments tab: XLS import → DB ────────────────────────────────────────
  // Parses a Convera transaction XLS and upserts every row into convera_transactions
  // as a new batch. Runs 5-level match once per row and stores the result — no invoice
  // status changes yet. Accountant reviews and hits Process to commit.
  const handlePaymentsImport = async () => {
    if (!paymentsImportFile) return;
    setPaymentsImporting(true);
    setPaymentsImportError('');
    try {
      // Always fetch fresh invoices + payment_profiles so matching uses current DB state,
      // not React state that could be stale (e.g., after a direct DB fix outside the UI).
      // Also fetch every invoice already claimed as matched_invoice_id by some other
      // convera_transaction (any state) — the matcher uses this to prevent double-attribution.
      const [invsRes, profsRes, claimedRes] = await Promise.all([
        supabase.from('invoices').select('*').order('submitted_at', { ascending: false }),
        supabase.from('payment_profiles').select('*'),
        supabase.from('convera_transactions').select('matched_invoice_id').not('matched_invoice_id', 'is', null),
      ]);
      const freshInvoices: Invoice[] = (invsRes.data || []).map(normaliseInvoice);
      const freshProfiles: PaymentProfile[] = (profsRes.data || []).map(normalisePaymentProfile);
      const claimedInvoiceIds = new Set<number>((claimedRes.data || []).map((r: { matched_invoice_id: number }) => r.matched_invoice_id));
      // Also push into state so the rest of the UI reflects the latest data
      setInvoices(freshInvoices);
      setPaymentProfiles(freshProfiles);
      const buffer = await paymentsImportFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Convera exports are ambiguous — "xls" extension can mean:
      //   • Real BIFF binary (starts D0 CF) — SheetJS handles encoding
      //   • Real XLSX zip (starts PK)      — SheetJS handles encoding
      //   • TSV text file with .xls extension — needs manual decoding
      //
      // For the TSV case we don't know the encoding. Try UTF-8 first; if that produces
      // Unicode replacement chars (U+FFFD), the file isn't UTF-8 — fall back to cp1250
      // (Central European, covers Croatian Ž Š Ć Đ Č) before defaulting to cp1252.
      const isBinaryXls  = bytes[0] === 0xD0 && bytes[1] === 0xCF;
      const isBinaryXlsx = bytes[0] === 0x50 && bytes[1] === 0x4B;

      let wb;
      if (isBinaryXls || isBinaryXlsx) {
        wb = XLSX.read(buffer, { type: 'array' });
      } else {
        // Text file — sniff encoding
        const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        const hasReplChar = utf8.includes('�');
        let text: string;
        if (!hasReplChar) {
          text = utf8;
        } else {
          // Try cp1250 (Central European — covers Ž Š Ć Đ Č)
          try {
            const cp1250 = new TextDecoder('windows-1250').decode(buffer);
            text = cp1250;
          } catch {
            // Fall back to cp1252
            text = new TextDecoder('windows-1252').decode(buffer);
          }
        }
        wb = XLSX.read(text, { type: 'string' });
      }

      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as (string | number)[][];

      // Excel date conversion is imported from ./lib/xlsxHelpers — same function
      // used by the Intuit XLSX parser and the QB Automation matcher.

      const hdrs = rawRows[0].map(h => String(h).trim().toLowerCase());
      // Flexible column resolver — first tries exact match, then falls back to substring match
      // (avoids the silent-synthetic-key bug when Convera tweaks column names)
      const col = (...aliases: string[]): number => {
        const lowered = aliases.map(a => a.toLowerCase());
        // Pass 1: exact match
        for (const a of lowered) {
          const i = hdrs.indexOf(a);
          if (i >= 0) return i;
        }
        // Pass 2: header includes any alias as a substring (only for the LONGEST alias
        // — avoids "line" false-matching "settlement line" etc.)
        const longest = lowered.slice().sort((a, b) => b.length - a.length)[0];
        for (let i = 0; i < hdrs.length; i++) {
          if (hdrs[i] && hdrs[i].includes(longest)) return i;
        }
        return -1;
      };
      const iConf       = col('confirmation number', 'confirmation no', 'confirmation #', 'payment order number', 'order number', 'order no', 'otr number', 'otr #');
      const iLine       = col('line item number', 'line item', 'line number', 'item number', 'line', 'item');
      const iDate       = col('date of order', 'order date', 'transaction date', 'date');
      const iBenef      = col('beneficiary name', 'beneficiary', 'payee');
      const iAmount     = col('foreign amount', 'amount', 'payment amount');
      const iSubtotal   = col('subtotal');
      const iCharges    = col('service charges', 'service charge', 'fees');
      const iGrand      = col('grand total', 'total');
      const iType       = col('item type', 'type');
      const iRef1       = col('ref 1', 'reference 1', 'reference', 'memo');
      const iVendorId   = col('your id number for beneficiary', 'vendor id', 'vendor code');

      const missing: string[] = [];
      if (iDate   < 0) missing.push('Date of Order');
      if (iBenef  < 0) missing.push('Beneficiary Name');
      if (iAmount < 0) missing.push('Foreign Amount');
      if (missing.length) {
        setPaymentsImportError(`Missing required columns: ${missing.join(', ')}. Found columns: ${hdrs.filter(h => h).join(' | ')}`);
        return;
      }
      // Confirmation + Line are optional — if missing, synthesize a stable key from row content
      // so re-import of the same file remains idempotent.
      const synthesizeKey = iConf < 0 || iLine < 0;
      if (synthesizeKey) {
        console.warn('Payments import: no Confirmation/Line columns found. Using synthetic keys derived from row content.');
      }

      // Build parsed rows (unchanged fields regardless of new/refresh/skip decision)
      type IncomingRow = {
        confirmation_number: string;
        line_item: number;
        date_of_order: string | null;
        beneficiary_name: string;
        foreign_amount: number | null;
        subtotal: number | null;
        service_charges: number | null;
        grand_total: number | null;
        item_type: string | null;
        ref1: string | null;
        convera_beneficiary_id: number | null;
        matched_invoice_id: number | null;
        match_confidence: MatchConfidence | null;
        match_level: number | null;
        umbrellaGroup?: Invoice[];
      };
      const incomingRows: IncomingRow[] = [];
      let intoHoldingSkipped = 0;

      // Simple stable string hash for synthetic keys
      const strHash = (s: string): number => {
        let h = 0;
        for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
        return Math.abs(h);
      };

      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        const dateOfOrder  = excelDateToIso(r[iDate]);
        const beneficiary  = String(r[iBenef] ?? '').trim();
        const amount       = parseFloat(String(r[iAmount]));
        const rawRef       = iRef1 >= 0 ? String(r[iRef1] ?? '').trim() : '';
        if (!beneficiary || isNaN(amount) || amount <= 0) continue;

        // "Into Holding" rows are Convera funds-purchase transfers that pre-fund the
        // Holding account — not vendor payments. Filter them out so they never enter
        // convera_transactions or produce qb_ingest_events. Accountant used to click
        // Ignore on each one manually; automating that here.
        const rowItemType = iType >= 0 ? String(r[iType] ?? '').trim() : '';
        if (rowItemType.toLowerCase() === 'into holding') { intoHoldingSkipped++; continue; }

        // Confirmation + Line: real if present, otherwise synthesized from stable row content
        let confirmation: string;
        let lineItem: number;
        if (synthesizeKey) {
          confirmation = `SYN-${paymentsImportFile!.name}`;
          lineItem = strHash(`${dateOfOrder}|${beneficiary}|${amount}|${rawRef}`) % 2_000_000_000;
        } else {
          confirmation = String(r[iConf] ?? '').trim();
          lineItem     = parseInt(String(r[iLine] ?? ''));
          if (!confirmation || isNaN(lineItem)) continue;
        }

        const subtotal = iSubtotal >= 0 ? parseFloat(String(r[iSubtotal])) || null : null;
        const charges  = iCharges  >= 0 ? parseFloat(String(r[iCharges]))  || null : null;
        const grand    = iGrand    >= 0 ? parseFloat(String(r[iGrand]))    || null : null;
        const itemType = iType     >= 0 ? String(r[iType] ?? '').trim()    || null : null;
        const ref1     = iRef1     >= 0 ? String(r[iRef1] ?? '').trim()    || null : null;
        const vendorCode = iVendorId >= 0 ? String(r[iVendorId] ?? '').trim() : '';

        // Convera's XLS ref1 comes back verbatim from what we exported (typically an
        // invoice_number like "INV 1" or "INV 21/2026"). Older rows use the legacy
        // "Inv# 12345" convention. Both feed matchPaymentToInvoice → normaliseRef which
        // strips inv/invoice prefixes + non-alphanum, so we can hand ref1 in as-is.
        const invoiceRef = ref1?.trim() ?? '';

        const groupMatch  = dateOfOrder ? matchPaymentGroup(beneficiary, amount, dateOfOrder, vendorCode, freshInvoices, freshProfiles) : null;
        const isUmbrella  = !!groupMatch && groupMatch.length > 1;
        const m = isUmbrella ? null : matchPaymentToInvoice(invoiceRef, beneficiary, amount, dateOfOrder || undefined, vendorCode, freshInvoices, freshProfiles, claimedInvoiceIds);

        const resolvedBenef = resolveBeneficiary(beneficiary, vendorCode);

        incomingRows.push({
          confirmation_number: confirmation,
          line_item: lineItem,
          date_of_order: dateOfOrder || null,
          beneficiary_name: beneficiary,
          foreign_amount: amount,
          subtotal, service_charges: charges, grand_total: grand, item_type: itemType, ref1,
          convera_beneficiary_id: resolvedBenef?.id ?? null,
          matched_invoice_id: isUmbrella ? null : (m?.invoice.id ?? null),
          match_confidence: isUmbrella ? 'strong' : (m?.confidence ?? null),
          match_level: isUmbrella ? 1 : (m?.level ?? null),
          umbrellaGroup: isUmbrella ? groupMatch! : undefined,
        });
      }

      if (!incomingRows.length) {
        setPaymentsImportError('No payment rows found in the XLS.');
        return;
      }

      // ── Dedup: fetch existing rows and partition into new / refresh / skip ──
      const uniqueConfs = [...new Set(incomingRows.map(r => r.confirmation_number))];
      const { data: existingRowsRaw, error: fetchErr } = await supabase
        .from('convera_transactions')
        .select('id, confirmation_number, line_item, foreign_amount, match_state, import_batch_id')
        .in('confirmation_number', uniqueConfs);
      if (fetchErr) { setPaymentsImportError(`Failed to check for existing rows: ${fetchErr.message}`); return; }

      type ExistingRow = { id: number; confirmation_number: string; line_item: number; foreign_amount: number | null; match_state: MatchState; import_batch_id: number | null };
      const existingMap = new Map<string, ExistingRow>();
      for (const r of (existingRowsRaw || []) as ExistingRow[]) {
        existingMap.set(`${r.confirmation_number}::${r.line_item}`, r);
      }

      const newRows: IncomingRow[] = [];
      const refreshRows: { id: number; incoming: IncomingRow }[] = [];
      let skippedCount = 0;
      const amountChanged: { key: string; oldAmount: number; newAmount: number; state: string }[] = [];

      for (const inc of incomingRows) {
        const key = `${inc.confirmation_number}::${inc.line_item}`;
        const existing = existingMap.get(key);
        if (!existing) { newRows.push(inc); continue; }

        const oldAmt = Number(existing.foreign_amount) || 0;
        const newAmt = inc.foreign_amount || 0;
        if (Math.abs(oldAmt - newAmt) > 0.01) {
          amountChanged.push({ key, oldAmount: oldAmt, newAmount: newAmt, state: existing.match_state });
        }

        if (existing.match_state !== 'unreviewed') {
          skippedCount++;
          continue;
        }
        refreshRows.push({ id: existing.id, incoming: inc });
      }

      // ── Only create a batch if there are truly new rows ──
      let batchId: number | null = null;
      if (newRows.length > 0) {
        const { data: batchRow, error: batchErr } = await supabase
          .from('import_batches')
          .insert({
            source: 'convera_xls',
            source_filename: paymentsImportFile.name,
            imported_by: currentUser?.name || 'unknown',
            row_count: newRows.length,
            state: 'pending',
          })
          .select('id')
          .single();
        if (batchErr || !batchRow) { setPaymentsImportError(`Failed to create batch: ${batchErr?.message || 'unknown'}`); return; }
        batchId = batchRow.id as number;

        // Insert new rows
        const insertPayload = newRows.map(inc => ({
          confirmation_number: inc.confirmation_number,
          line_item: inc.line_item,
          date_of_order: inc.date_of_order,
          beneficiary_name: inc.beneficiary_name,
          foreign_amount: inc.foreign_amount,
          subtotal: inc.subtotal,
          service_charges: inc.service_charges,
          grand_total: inc.grand_total,
          item_type: inc.item_type,
          ref1: inc.ref1,
          convera_beneficiary_id: inc.convera_beneficiary_id,
          import_batch_id: batchId,
          match_state: 'unreviewed' as const,
          matched_invoice_id: inc.matched_invoice_id,
          match_confidence: inc.match_confidence,
          match_level: inc.match_level,
        }));

        const { data: insertedRows, error: insertErr } = await supabase
          .from('convera_transactions')
          .insert(insertPayload)
          .select('id, confirmation_number, line_item');
        if (insertErr) {
          await supabase.from('import_batches').delete().eq('id', batchId);
          setPaymentsImportError(`Insert failed: ${insertErr.message}`);
          return;
        }

        // Write umbrella links for newly inserted umbrella rows
        const umbrellaLinks: { transaction_id: number; invoice_id: number; amount_share: number }[] = [];
        for (const inserted of (insertedRows || [])) {
          const key = `${inserted.confirmation_number}::${inserted.line_item}`;
          const inc = newRows.find(r => `${r.confirmation_number}::${r.line_item}` === key);
          if (inc?.umbrellaGroup) {
            for (const invUm of inc.umbrellaGroup) {
              umbrellaLinks.push({ transaction_id: inserted.id, invoice_id: invUm.id, amount_share: invUm.totalAmount });
            }
          }
        }
        if (umbrellaLinks.length) {
          const { error: linkErr } = await supabase.from('convera_transaction_invoices').insert(umbrellaLinks);
          if (linkErr) { setPaymentsImportError(`Umbrella link insert failed: ${linkErr.message}`); return; }
        }

        // Phase 2 shadow-write: mirror the new Convera rows into qb_ingest_events
        // so the QB Automation Inbox surfaces Convera activity. Failure here
        // does NOT abort the import — shadow write is additive, and the
        // primary convera_transactions rows are already committed.
        try {
          const shadowInputs: ConveraShadowInput[] = (insertedRows ?? []).map(inserted => {
            const key = `${inserted.confirmation_number}::${inserted.line_item}`;
            const inc = newRows.find(r => `${r.confirmation_number}::${r.line_item}` === key)!;
            const umbrella = inc.umbrellaGroup ?? [];
            const matchedIds = umbrella.length > 0
              ? umbrella.map(inv => inv.id)
              : (inc.matched_invoice_id != null ? [inc.matched_invoice_id] : []);
            return {
              converaTransactionId: inserted.id,
              confirmationNumber: inc.confirmation_number,
              lineItem: inc.line_item,
              txnDate: inc.date_of_order ?? '',
              amount: inc.foreign_amount ?? 0,
              beneficiaryName: inc.beneficiary_name,
              ref1: inc.ref1,
              matchedInvoiceIds: matchedIds,
              matchState: 'unreviewed',
              matcherIgnore: false,
            };
          });
          await insertConveraShadowEvents(supabase, shadowInputs);
          // Slice B: auto-classify freshly-inserted Convera events. Pass 2
          // profile-chain resolves any wires whose auto-match already carries
          // matched_invoice_ids + resolvable qb_vendor_name — same primitive
          // Intuit uses post-import. Also seeds qb_vendor_mappings rows with
          // source='convera' so future wires from the same beneficiary hit
          // Pass 1 (fast path).
          try {
            await loadQbVendorMappings();
            await loadQbVendorsAndAccounts();
            await applyClassificationPass();
          } catch (clsErr) {
            console.warn('[qbIngest] Post-Convera-import classification failed', clsErr);
          }
        } catch (shadowErr) {
          console.warn('[qbIngest] Convera shadow-write failed', shadowErr);
        }
      }

      // ── Refresh existing unreviewed rows in place (keep their original batch_id) ──
      for (const rr of refreshRows) {
        const { error } = await supabase
          .from('convera_transactions')
          .update({
            date_of_order: rr.incoming.date_of_order,
            foreign_amount: rr.incoming.foreign_amount,
            subtotal: rr.incoming.subtotal,
            service_charges: rr.incoming.service_charges,
            grand_total: rr.incoming.grand_total,
            item_type: rr.incoming.item_type,
            ref1: rr.incoming.ref1,
            convera_beneficiary_id: rr.incoming.convera_beneficiary_id,
            matched_invoice_id: rr.incoming.matched_invoice_id,
            match_confidence: rr.incoming.match_confidence,
            match_level: rr.incoming.match_level,
          })
          .eq('id', rr.id);
        if (error) { console.warn(`Refresh row ${rr.id} failed: ${error.message}`); }
        // Refresh umbrella links too
        if (rr.incoming.umbrellaGroup) {
          await supabase.from('convera_transaction_invoices').delete().eq('transaction_id', rr.id);
          const links = rr.incoming.umbrellaGroup.map(inv => ({ transaction_id: rr.id, invoice_id: inv.id, amount_share: inv.totalAmount }));
          await supabase.from('convera_transaction_invoices').insert(links);
        }
      }

      // Refresh state
      await fetchImportBatches();
      await fetchConveraTransactions();
      if (batchId !== null) {
        setSelectedBatchId(batchId);
        setPaymentsStateFilter('unreviewed');
      }
      setPaymentsImportFile(null);
      setPaymentsFileInputKey(k => k + 1);
      setPaymentsImportSummary({
        newCount: newRows.length,
        refreshedCount: refreshRows.length,
        skippedCount,
        intoHoldingSkipped,
        amountChangedRows: amountChanged,
        batchId,
      });
    } catch (e: unknown) {
      setPaymentsImportError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setPaymentsImporting(false);
    }
  };

  // ─── Payments tab: commit staged matches ────────────────────────────────────
  // Reads stagedMatches, applies to convera_transactions + invoices in DB, then clears.
  // Also marks the batch (if a single batch is selected) as 'processed' when all its rows
  // in the visible view are covered.
  const handleProcess = async () => {
    const stagedIds = Object.keys(stagedMatches).map(Number);
    if (!stagedIds.length) return;
    if (processCommitting) return;
    setProcessCommitting(true);
    try {
    const now = new Date().toISOString();
    const actor = currentUser?.name || 'unknown';

    // Split into matched (with invoice id) and no_invoice
    const matchedUpdates: { id: number; matched_invoice_id: number | null; }[] = [];
    const noInvoiceIds: number[] = [];
    const umbrellaLinksToWrite: { transaction_id: number; invoice_id: number; amount_share: number }[] = [];
    const invoicesToMarkPaid: { id: number; paid_date: string }[] = [];

    for (const tid of stagedIds) {
      const t = converaTransactions.find(x => x.id === tid);
      if (!t) continue;
      const staged = stagedMatches[tid];
      if (staged === 'no_invoice') {
        noInvoiceIds.push(tid);
        continue;
      }
      if (Array.isArray(staged) && staged.length > 0) {
        // Multiple → umbrella. Single → simple match.
        if (staged.length === 1) {
          matchedUpdates.push({ id: tid, matched_invoice_id: staged[0] });
        } else {
          matchedUpdates.push({ id: tid, matched_invoice_id: null });
          for (const invId of staged) {
            const inv = invoices.find(i => i.id === invId);
            umbrellaLinksToWrite.push({ transaction_id: tid, invoice_id: invId, amount_share: inv?.totalAmount ?? 0 });
          }
        }
        // Every matched invoice → mark paid at date_of_order
        for (const invId of staged) {
          if (!invoicesToMarkPaid.find(i => i.id === invId)) {
            invoicesToMarkPaid.push({ id: invId, paid_date: t.dateOfOrder });
          }
        }
      }
    }

    try {
      // 1. Update transaction states
      for (const upd of matchedUpdates) {
        const { error } = await supabase
          .from('convera_transactions')
          .update({ match_state: 'matched', matched_invoice_id: upd.matched_invoice_id, matched_at: now, matched_by: actor })
          .eq('id', upd.id);
        if (error) { alert(`Failed to update transaction #${upd.id}: ${error.message}`); return; }
      }
      if (noInvoiceIds.length) {
        const { error } = await supabase
          .from('convera_transactions')
          .update({ match_state: 'no_invoice', matched_invoice_id: null, matched_at: now, matched_by: actor })
          .in('id', noInvoiceIds);
        if (error) { alert(`Failed to update no-invoice transactions: ${error.message}`); return; }
      }

      // 2. Rewrite umbrella links: clear any existing links on every touched txn
      // (covers umbrella→single-invoice edits and no_invoice edits, not just umbrella→umbrella),
      // then insert the new set.
      const touchedTxnIds = [
        ...matchedUpdates.map(u => u.id),
        ...noInvoiceIds,
      ];
      if (touchedTxnIds.length) {
        await supabase.from('convera_transaction_invoices').delete().in('transaction_id', touchedTxnIds);
      }
      if (umbrellaLinksToWrite.length) {
        const { error } = await supabase.from('convera_transaction_invoices').insert(umbrellaLinksToWrite);
        if (error) { alert(`Failed to write umbrella links: ${error.message}`); return; }
      }

      // Phase 2 shadow-write: propagate match transitions to qb_ingest_events.
      // Non-fatal — shadow lag doesn't corrupt the primary write.
      try {
        const shadowUpdates: ConveraShadowMatchUpdate[] = [];
        for (const upd of matchedUpdates) {
          const t = converaTransactions.find(x => x.id === upd.id);
          if (!t) continue;
          const staged = stagedMatches[upd.id];
          const ids = Array.isArray(staged) ? staged : [];
          shadowUpdates.push({
            confirmationNumber: t.confirmationNumber,
            lineItem: t.lineItem,
            matchedInvoiceIds: ids,
            matchState: 'matched',
          });
        }
        for (const noId of noInvoiceIds) {
          const t = converaTransactions.find(x => x.id === noId);
          if (!t) continue;
          shadowUpdates.push({
            confirmationNumber: t.confirmationNumber,
            lineItem: t.lineItem,
            matchedInvoiceIds: [],
            matchState: 'no_invoice',
          });
        }
        await updateConveraShadowMatch(supabase, shadowUpdates);
        // Slice B: re-run the classifier now that matched_invoice_ids are
        // populated. Newly-matched Convera wires transition pending → ready
        // and seed a source='convera' mapping row for the beneficiary.
        try {
          await applyClassificationPass();
        } catch (clsErr) {
          console.warn('[qbIngest] Post-Convera-match classification failed', clsErr);
        }
      } catch (shadowErr) {
        console.warn('[qbIngest] Convera shadow match update failed', shadowErr);
      }

      // 3. Mark invoices paid
      for (const inv of invoicesToMarkPaid) {
        const { error } = await supabase
          .from('invoices')
          .update({ status: 'paid', paid_date: inv.paid_date, reviewed_at: now, reviewed_by: actor })
          .eq('id', inv.id);
        if (error) { alert(`Failed to mark invoice #${inv.id} paid: ${error.message}`); return; }
      }

      // 4. If a batch is selected and all its pending rows are now processed, mark batch processed
      let batchFullyProcessed = false;
      if (selectedBatchId !== 'all') {
        const batchRows = converaTransactions.filter(t => t.importBatchId === selectedBatchId);
        const unreviewedIdsInBatch = batchRows.filter(t => t.matchState === 'unreviewed').map(t => t.id);
        const processedIds = new Set([...matchedUpdates.map(u => u.id), ...noInvoiceIds]);
        const allProcessed = unreviewedIdsInBatch.every(id => processedIds.has(id));
        if (allProcessed) {
          await supabase.from('import_batches').update({ state: 'processed' }).eq('id', selectedBatchId);
          batchFullyProcessed = true;
        }
      }

      // Refresh
      setStagedMatches({});
      setShowProcessPreview(false);
      setPaymentsImportSummary(null);
      setPaymentsProcessResult({
        matchedCount: matchedUpdates.length,
        noInvoiceCount: noInvoiceIds.length,
        invoicesPaid: invoicesToMarkPaid.length,
        batchFullyProcessed,
      });
      // If the accountant was viewing 'unreviewed' (the default pending workflow),
      // reset to 'all' — otherwise the pill they were on now has zero rows after
      // Process and the listing goes blank with no obvious way to recover.
      if (paymentsStateFilter === 'unreviewed') setPaymentsStateFilter('all');
      await fetchImportBatches();
      await fetchConveraTransactions();
      await fetchInvoices();
    } catch (e: unknown) {
      alert(`Process failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    } finally {
      setProcessCommitting(false);
    }
  };

  // ─── Payments tab: reopen a processed batch ─────────────────────────────────
  // Reverses invoice paid status for all matched rows in this batch, sets rows back
  // to 'unreviewed', and marks the batch 'pending' so edits are allowed again.
  const handleReopenBatch = async (batchId: number) => {
    if (!window.confirm('Reopen this batch? All invoices marked paid from this batch will be reverted to approved status, and rows will be editable again.')) return;
    setPaymentsImportSummary(null);
    setPaymentsProcessResult(null);
    setPaymentsImportError('');
    setPaymentsImportFile(null);
    setPaymentsFileInputKey(k => k + 1);
    setShowProcessPreview(false);
    setStagedMatches({});
    const rows = converaTransactions.filter(t => t.importBatchId === batchId && t.matchState === 'matched');
    const invoiceIds = new Set<number>();
    for (const r of rows) {
      if (r.matchedInvoiceId) invoiceIds.add(r.matchedInvoiceId);
      (r.matchedInvoiceIds || []).forEach(id => invoiceIds.add(id));
    }
    try {
      // Revert invoice statuses
      if (invoiceIds.size) {
        const { error } = await supabase
          .from('invoices')
          .update({ status: 'approved', paid_date: null })
          .in('id', [...invoiceIds]);
        if (error) { alert(`Failed to revert invoices: ${error.message}`); return; }
      }
      // Reset transaction states in this batch
      await supabase
        .from('convera_transactions')
        .update({ match_state: 'unreviewed', matched_at: null, matched_by: null })
        .eq('import_batch_id', batchId);
      // Clear umbrella links for this batch's transactions
      const txnIds = rows.map(r => r.id);
      if (txnIds.length) await supabase.from('convera_transaction_invoices').delete().in('transaction_id', txnIds);
      // Batch back to pending
      await supabase.from('import_batches').update({ state: 'pending' }).eq('id', batchId);
      await fetchImportBatches();
      await fetchConveraTransactions();
      await fetchInvoices();
    } catch (e: unknown) {
      alert(`Reopen failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // ─── Payments tab: full rollback (delete batch and its rows) ────────────────
  // First reverses any invoice paid status (same as Reopen), then deletes the batch
  // record and all its transaction rows from the ledger. Use with care.
  const handleRollbackBatch = async (batchId: number) => {
    if (!window.confirm('Rollback & DELETE this batch? This will revert any invoices paid via this batch AND remove all its transaction rows from the ledger. Cannot be undone.')) return;
    // Clear any transient UI that could block or confuse the next interaction
    setPaymentsImportSummary(null);
    setPaymentsProcessResult(null);
    setPaymentsImportError('');
    setPaymentsImportFile(null);
    setPaymentsFileInputKey(k => k + 1);
    setShowProcessPreview(false);
    setStagedMatches({});
    const rows = converaTransactions.filter(t => t.importBatchId === batchId && t.matchState === 'matched');
    const invoiceIds = new Set<number>();
    for (const r of rows) {
      if (r.matchedInvoiceId) invoiceIds.add(r.matchedInvoiceId);
      (r.matchedInvoiceIds || []).forEach(id => invoiceIds.add(id));
    }
    try {
      if (invoiceIds.size) {
        const { error } = await supabase
          .from('invoices')
          .update({ status: 'approved', paid_date: null })
          .in('id', [...invoiceIds]);
        if (error) { alert(`Failed to revert invoices: ${error.message}`); return; }
      }
      // Delete transactions (cascades to convera_transaction_invoices)
      await supabase.from('convera_transactions').delete().eq('import_batch_id', batchId);
      // Delete batch
      await supabase.from('import_batches').delete().eq('id', batchId);
      if (selectedBatchId === batchId) setSelectedBatchId('all');
      await fetchImportBatches();
      await fetchConveraTransactions();
      await fetchInvoices();
    } catch (e: unknown) {
      alert(`Rollback failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  };

  // ─── Intuit XLSX → qb_ingest_events (Slice B of QB Automation Layer) ────────
  const parseIntuitXlsxPreview = async () => {
    if (!intuitXlsxFile) return;
    setIntuitXlsxError('');
    setIntuitXlsxResult(null);
    try {
      const buffer = await intuitXlsxFile.arrayBuffer();
      const rows = await parseIntuitXlsxBuffer(buffer);
      if (rows.length === 0) {
        setIntuitXlsxError('No payment rows found in this file. Positive-amount rows in the expense/AP account (with "Inv# XXX" memos) are what we look for.');
        return;
      }
      // Layered invoice matcher — see matchEventsToInvoices at top of file for
      // the algorithm. Same function used by the on-load / manual recompute path
      // so an improvement propagates to already-imported events without re-ingest.
      const matcherInvoices: MatcherInvoice[] = invoices.map(i => ({
        id: i.id, invoiceNumber: i.invoiceNumber, totalAmount: i.totalAmount,
        periodEnd: i.periodEnd, userName: i.userName, companyName: i.paymentProfile?.companyName ?? null,
      }));
      const matchInputs: MatchableEvent[] = rows.map(r => ({
        date: r.date, counterpartyRaw: r.name, amount: r.amount, invoiceRefs: r.invoiceRefs,
      }));
      const matchResults = matchEventsToInvoices(matchInputs, matcherInvoices);
      rows.forEach((r, i) => { r.matchedInvoiceIds = matchResults[i]; });
      setIntuitXlsxPreview(rows);
    } catch (e) {
      setIntuitXlsxError(`Parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const commitIntuitXlsxToInbox = async () => {
    if (!intuitXlsxPreview || intuitXlsxPreview.length === 0) return;
    setIntuitXlsxImporting(true);
    setIntuitXlsxError('');
    try {
      const inserts = intuitXlsxPreview.map(r => ({
        source: 'intuit_xlsx' as const,
        source_ref: r.sourceRef,
        txn_date: r.date,
        amount: r.amount,
        counterparty_raw: r.name,
        memo: r.memo || null,
        matched_invoice_ids: r.matchedInvoiceIds,
        status: 'pending' as const,
        raw_data: { transaction_type: r.transactionType, num: r.num, split: r.split, invoice_refs: r.invoiceRefs },
      }));
      // Upsert with ignoreDuplicates so (source, source_ref) UNIQUE quietly skips
      // rows we've already seen from a prior import of the same date range.
      const { data, error } = await supabase
        .from('qb_ingest_events')
        .upsert(inserts, { onConflict: 'source,source_ref', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      const inserted = data?.length ?? 0;
      const skipped = intuitXlsxPreview.length - inserted;
      // Slice F.5 — run auto-classification pass over the freshly-inserted
      // pending events (also picks up any prior pending events, which is fine).
      // Silent skip if prereq state is missing; accountant can hit Recompute later.
      try {
        await loadQbVendorMappings();
        await loadQbVendorsAndAccounts();
        await applyClassificationPass();
      } catch (e) {
        console.warn('Post-ingest classification failed', e);
      }
      setIntuitXlsxResult({ inserted, skipped });
      setIntuitXlsxPreview(null);
      setIntuitXlsxFile(null);
    } catch (e) {
      // Format Supabase/PostgREST errors ({ message, details, hint, code }) as well
      // as regular Error instances. Prior String(e) rendered them as "[object Object]".
      const err = e as { message?: string; details?: string; hint?: string; code?: string };
      const parts = [err?.message, err?.details, err?.hint, err?.code ? `(code ${err.code})` : null]
        .filter((s): s is string => !!s);
      const msg = parts.length ? parts.join(' — ') : (e instanceof Error ? e.message : JSON.stringify(e));
      setIntuitXlsxError(`Import failed: ${msg}`);
    } finally {
      setIntuitXlsxImporting(false);
    }
  };

  const exportInvoicesCSV = (list: Invoice[]) => {
    const headers = [
      'Convera Short Name','Employee','Invoice No',
      'Period Start','Period End','Total Hours','Rate','Total Amount','Currency',
      'Status','Pay On Date','Payment Method','IBAN','SWIFT/BIC','Bank Name',
      'Banking Note','Payment Email','Paid Date',
      'Country','Bank Address','Bank Branch','Account Number','Project'
    ];
    let csv = '﻿' + headers.join(',') + '\n';
    // Find the live payment_profiles record for an invoice — snapshot may have id:0 (Imported)
    // so fall back to IBAN match, then default profile for the contractor.
    const findLiveProfile = (inv: Invoice): typeof paymentProfiles[0] | null => {
      const pp = inv.paymentProfile;
      if (!pp) return null;
      if (pp.id) {
        const byId = paymentProfiles.find(p => p.id === pp.id);
        if (byId) return byId;
      }
      if (pp.iban) {
        const byIban = paymentProfiles.find(p => p.userId === inv.userId && p.iban === pp.iban);
        if (byIban) return byIban;
      }
      return paymentProfiles.find(p => p.userId === inv.userId && p.isDefault) ?? null;
    };
    const priorMonthKey = (periodEnd: string): string => {
      const d = parseLocalDate(periodEnd);
      d.setMonth(d.getMonth() - 1);
      return formatDate(d).slice(0, 7);
    };
    const fmtDate = (s: string | null) => s ? s.slice(5, 7) + '/' + s.slice(8, 10) + '/' + s.slice(0, 4) : '';
    list.forEach(inv => {
      const project = projects.find(p => p.id === inv.projectId);
      const pp = inv.paymentProfile;
      const liveProfile = findLiveProfile(inv);
      const converaShortName = liveProfile?.converaBeneficiaryId
        ? (converaBeneficiaries.find(b => b.id === liveProfile.converaBeneficiaryId)?.shortName || '')
        : '';
      // Banking note: NEW COMPANY = no Convera beneficiary linked; NEW = first invoice; CHANGE COMPANY = beneficiary changed from prior month
      const currentBenefId = liveProfile?.converaBeneficiaryId ?? null;
      const prevKey = priorMonthKey(inv.periodEnd);
      const priorInv = invoices.find(o => o.userId === inv.userId && o.id !== inv.id && o.periodEnd?.slice(0,7) === prevKey);
      const priorLiveProfile = priorInv ? findLiveProfile(priorInv) : null;
      const priorBenefId = priorLiveProfile?.converaBeneficiaryId ?? null;
      let bankingNote = '';
      if (!currentBenefId) bankingNote = 'NEW COMPANY';
      else if (!priorInv) bankingNote = 'NEW';
      else if (priorBenefId && priorBenefId !== currentBenefId) bankingNote = 'CHANGE COMPANY';
      const row = [
        `"${converaShortName}"`,
        `"${inv.userName}"`,
        `"${inv.invoiceNumber}"`,
        `"${inv.periodStart}"`,
        `"${inv.periodEnd}"`,
        inv.totalHours != null ? inv.totalHours.toFixed(2) : '',
        inv.rate ?? '',
        inv.totalAmount.toFixed(2),
        `"${inv.currency}"`,
        `"${inv.status}"`,
        `"${fmtDate(inv.payOnDate)}"`,
        `"${(inv.paymentProfile || inv.paymentMethodOverride) ? paymentMethod(inv) : ''}"`,
        `"${liveProfile?.iban || pp?.iban || ''}"`,
        `"${liveProfile?.swift || pp?.swift || ''}"`,
        `"${liveProfile?.bankName || pp?.bankName || ''}"`,
        `"${bankingNote}"`,
        `"${liveProfile?.paymentEmail || pp?.paymentEmail || ''}"`,
        `"${fmtDate(inv.paidDate)}"`,
        `"${liveProfile?.country || pp?.country || ''}"`,
        `"${liveProfile?.bankAddress || pp?.bankAddress || ''}"`,
        `"${liveProfile?.bankBranch || pp?.bankBranch || ''}"`,
        `"${liveProfile?.accountNumber || pp?.accountNumber || ''}"`,
        `"${project?.name || ''}"`,
      ];
      csv += row.join(',') + '\n';
    });
    triggerDownload(csv, `invoices_export_${Date.now()}.csv`);
  };

  // ─── Convera Batch Payment File export ─────────────────────────────────────
  // Generates the CSV that gets uploaded to Convera's GlobalPay portal to initiate
  // a batch payment. Uses the SAME filters as the current invoice view, further
  // restricted to status='approved' + payment method = Convera (excludes Intuit).
  //
  // Column layout per Convera's Ale (2026-07-11):
  //   VendorID       required — must exactly match the beneficiary code we assigned
  //   BeneName       optional but recommended (troubleshooting aid)
  //   TargetAmount   required
  //   Ref1           optional; we use invoice number
  //   Ref2           optional; reserved for per-contractor regulatory notes (e.g. India P0802)
  //   POP            optional; always "Trade Related" for our contractor payments
  // Step 1: build the preview groups and open the modal. Groups are formed by
  // (convera_beneficiary_id + IBAN) — profiles sharing the same shared IBAN under the same
  // beneficiary are candidates for combining. Multi-invoice groups get a "Combine" checkbox
  // in the modal (default checked); accountant unchecks to split back to per-invoice rows.
  const openConveraBatchPreview = async (list: Invoice[]) => {
    const eligible: Invoice[] = [];
    const excluded: ConveraBatchExcluded[] = [];
    for (const inv of list) {
      if (inv.status !== 'approved') { excluded.push({ invoice: inv, reason: 'not approved' }); continue; }
      if (paymentMethod(inv) !== 'Convera') { excluded.push({ invoice: inv, reason: 'not Convera' }); continue; }
      eligible.push(inv);
    }
    if (eligible.length === 0) {
      alert('No approved Convera invoices in the current filter view.');
      return;
    }

    // Fetch fresh payment_profiles + convera_beneficiaries so vendor codes and beneficiary
    // links are current even if the accountant just edited them without a page refresh.
    const [profsRes, benefsRes] = await Promise.all([
      supabase.from('payment_profiles').select('*'),
      supabase.from('convera_beneficiaries').select('*'),
    ]);
    const freshProfiles: PaymentProfile[] = (profsRes.data || []).map(normalisePaymentProfile);
    const freshBenefs: ConveraBeneficiary[] = (benefsRes.data || []).map(normaliseConveraBeneficiary);
    setPaymentProfiles(freshProfiles);
    setConveraBeneficiaries(freshBenefs);

    const findLiveProfile = (inv: Invoice) => {
      const pp = inv.paymentProfile;
      if (!pp) return null;
      if (pp.id) {
        const byId = freshProfiles.find(p => p.id === pp.id);
        if (byId) return byId;
      }
      if (pp.iban) {
        const byIban = freshProfiles.find(p => p.userId === inv.userId && p.iban === pp.iban);
        if (byIban) return byIban;
      }
      return freshProfiles.find(p => p.userId === inv.userId && p.isDefault) ?? null;
    };

    // IBAN prefix → full country name. Covers everywhere our beneficiaries actually bank.
    // Convera enforces bank country = IBAN country; showing anything else on the setup form
    // would produce a beneficiary Convera then rejects on submit.
    const IBAN_COUNTRY: Record<string, string> = {
      GB: 'United Kingdom', IE: 'Ireland',       NL: 'Netherlands',    DE: 'Germany',
      BA: 'Bosnia and Herzegovina',              HR: 'Croatia',         RS: 'Serbia',
      SI: 'Slovenia',       MK: 'North Macedonia', ME: 'Montenegro',   LT: 'Lithuania',
      LV: 'Latvia',         EE: 'Estonia',       AT: 'Austria',        CH: 'Switzerland',
      FR: 'France',         IT: 'Italy',         ES: 'Spain',          PT: 'Portugal',
      SE: 'Sweden',         NO: 'Norway',        DK: 'Denmark',        FI: 'Finland',
      PL: 'Poland',         CZ: 'Czech Republic',SK: 'Slovakia',       HU: 'Hungary',
      BG: 'Bulgaria',       RO: 'Romania',       GR: 'Greece',         UA: 'Ukraine',
      MD: 'Moldova',
    };
    const countryFromIban = (iban: string): string | undefined => {
      const p = (iban || '').replace(/\s+/g, '').slice(0, 2).toUpperCase();
      return p && IBAN_COUNTRY[p] ? IBAN_COUNTRY[p] : undefined;
    };

    const groups = new Map<string, ConveraBatchGroup>();
    const skipped: ConveraBatchSkip[] = [];

    const beneRedirects: Array<{ invoiceId: number; from: string; to: string }> = [];
    for (const inv of eligible) {
      const liveProfile = findLiveProfile(inv);
      const contractorUser = users.find(u => u.id === inv.userId);
      let benef = liveProfile?.converaBeneficiaryId
        ? freshBenefs.find(b => b.id === liveProfile.converaBeneficiaryId)
        : null;

      // Guardrail: if the linked bene is deprecated, auto-redirect the outbound wire
      // to the resolved replacement bene (walk the chain). Convera routes by VendorID,
      // so as long as the replacement has a vendor code, the wire lands at the correct
      // account. Accountant is shown a summary banner. If replacement is missing or has
      // no vendor code, invoice is still skipped for manual review.
      if (benef?.deprecated) {
        // Walk the replacement chain (defensive — supports multi-hop)
        let cur: ConveraBeneficiary | undefined = benef;
        let hops = 0;
        while (cur?.deprecated && hops < 10) {
          const nextId: number | null = cur.replacementBeneficiaryId;
          cur = nextId != null ? freshBenefs.find(b => b.id === nextId) : undefined;
          hops++;
        }
        const repl: ConveraBeneficiary | null = cur && !cur.deprecated ? cur : null;
        if (repl && (repl.vendorId || '').trim()) {
          beneRedirects.push({
            invoiceId: inv.id,
            from: benef.shortName || benef.beneficiaryName || `bene ${benef.id}`,
            to: repl.shortName || repl.beneficiaryName || `bene ${repl.id}`,
          });
          benef = repl;  // route the wire via replacement
        } else {
          skipped.push({
            invoice: inv,
            reason: `linked bene "${benef.shortName || benef.beneficiaryName}" is deprecated and replacement is missing or has no vendor code`,
            companyName: liveProfile?.companyName || '',
            country: liveProfile?.country || '',
            bankCountry: countryFromIban(liveProfile?.iban || ''),
            bankName: liveProfile?.bankName || '',
            bankAddress: liveProfile?.bankAddress || '',
            iban: liveProfile?.iban || '',
            swift: liveProfile?.swift || '',
            accountNumber: liveProfile?.accountNumber || '',
            paymentEmail: liveProfile?.paymentEmail || '',
            contractorEmail: contractorUser?.email || '',
            contractorName: inv.userName || '',
            linkedBeneficiary: { id: benef.id, shortName: benef.shortName || '', fullName: benef.beneficiaryName || '' },
          });
          continue;
        }
      }

      const vendorId = (benef?.vendorId || '').trim();

      if (!vendorId) {
        // If a sibling beneficiary with the SAME beneficiary_name exists and has a vendor_id,
        // it's a strong signal the accountant linked the wrong (older) beneficiary record.
        let suggested: ConveraBatchSkip['suggestedBeneficiary'] | undefined;
        if (benef) {
          const targetName = (benef.beneficiaryName || '').trim().toLowerCase();
          const siblings = freshBenefs.filter(b =>
            b.id !== benef.id &&
            (b.vendorId || '').trim() &&
            (b.beneficiaryName || '').trim().toLowerCase() === targetName
          );
          if (siblings.length === 1) {
            suggested = { id: siblings[0].id, shortName: siblings[0].shortName || '', vendorId: siblings[0].vendorId!.trim() };
          }
        }
        skipped.push({
          invoice: inv,
          reason: benef ? 'no vendor code assigned' : 'no Convera beneficiary linked',
          companyName: liveProfile?.companyName || '',
          country: liveProfile?.country || '',
          bankCountry: countryFromIban(liveProfile?.iban || ''),
          bankName: liveProfile?.bankName || '',
          bankAddress: liveProfile?.bankAddress || '',
          iban: liveProfile?.iban || '',
          swift: liveProfile?.swift || '',
          accountNumber: liveProfile?.accountNumber || '',
          paymentEmail: liveProfile?.paymentEmail || '',
          contractorEmail: contractorUser?.email || '',
          contractorName: inv.userName || '',
          linkedBeneficiary: benef ? { id: benef.id, shortName: benef.shortName || '', fullName: benef.beneficiaryName || '' } : undefined,
          suggestedBeneficiary: suggested,
        });
        continue;
      }

      const country = (liveProfile?.country || '').toLowerCase();
      const isIndia = country === 'india' || country === 'in';
      const iban = liveProfile?.iban || '';
      const key = benef!.id.toString();

      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          vendorId,
          shortName: benef?.shortName || '',
          fullName: benef?.beneficiaryName || '',
          entries: [],
          distinctIbans: 0,
          anyIndia: false,
        };
        groups.set(key, group);
      }
      group.entries.push({ inv, iban });
      if (isIndia) group.anyIndia = true;
    }

    // Finalise distinct IBAN counts per group
    for (const g of groups.values()) {
      g.distinctIbans = new Set(g.entries.map(e => e.iban)).size;
    }

    // Suggested vendor code for "no Convera beneficiary linked" skips. Uses the
    // shared computeSynVendorCode helper so the same profile shows one consistent
    // SYN code across every surface (Convera Batch export, Payment Profiles
    // Awaiting-Convera-setup panel, and the beneficiary-import matcher).
    for (const s of skipped) {
      if (s.reason !== 'no Convera beneficiary linked') continue;
      const liveProfile = findLiveProfile(s.invoice);
      if (!liveProfile) continue;
      s.suggestedVendorId = computeSynVendorCode(liveProfile.id, liveProfile.iban, paymentProfiles);
    }

    const groupList = [...groups.values()].sort((a, b) =>
      (b.entries.length - a.entries.length) || a.shortName.localeCompare(b.shortName)
    );
    // Default combine choice:
    //   • Multi-invoice, all same IBAN → CHECKED (safe auto-combine, e.g. Bimosoft CurrencyCloud four)
    //   • Multi-invoice, mixed IBANs   → UNCHECKED (accountant reviews; enable only if beneficiary
    //                                    actually settles as one payment despite the stale IBANs on file)
    //   • Single invoice               → not eligible
    const combineChoices: Record<string, boolean> = {};
    for (const g of groupList) {
      // force_combine benes (umbrella payments like Bimosoft UK ALT) always combine
      // regardless of entry count or distinct IBANs. The checkbox for these is disabled
      // in the modal so accountant can't split by accident.
      const groupBene = freshBenefs.find(b => b.id.toString() === g.key);
      if (groupBene?.forceCombine) {
        combineChoices[g.key] = true;
      } else if (g.entries.length > 1) {
        combineChoices[g.key] = g.distinctIbans === 1;
      }
    }

    setConveraBatchGroups(groupList);
    setConveraBatchCombine(combineChoices);
    setConveraBatchSkipped(skipped);
    setConveraBatchExcluded(excluded);
    setShowConveraBatchModal(true);

    if (beneRedirects.length > 0) {
      const summary = beneRedirects.slice(0, 5).map(r =>
        `  • Invoice ${r.invoiceId}: routed via "${r.to}" instead of deprecated "${r.from}"`
      ).join('\n');
      const more = beneRedirects.length > 5 ? `\n  … and ${beneRedirects.length - 5} more` : '';
      alert(`ℹ ${beneRedirects.length} invoice(s) auto-redirected from deprecated Convera beneficiaries to their replacements:\n\n${summary}${more}\n\nThe outbound wire will land at the correct account. Consider fixing each invoice's payment profile so the redirect isn't needed next time.`);
    }
  };

  // Intuit Batch popup — approved unpaid US invoices for manual entry into Intuit Online Payment.
  // Also auto-applies the payment-method filter chip to Intuit so the underlying invoice list
  // matches what's inside the modal (no cross-pollution with Convera invoices left in view).
  const openIntuitBatchPreview = (list: Invoice[]) => {
    invoiceFilters.setInvoicePaymentMethodPreset(new Set(['Intuit']));
    const eligible = list.filter(inv =>
      inv.status === 'approved'
      && paymentMethod(inv) === 'Intuit'
      && !inv.paidDate
    );
    if (eligible.length === 0) {
      alert('No approved unpaid Intuit invoices in the current filter view.');
      return;
    }
    // Sort by vendor name for scan-ability
    eligible.sort((a, b) => (a.userName || '').localeCompare(b.userName || ''));
    setIntuitBatchInvoices(eligible);
    setShowIntuitBatchModal(true);
  };

  const copyIntuitField = (fieldKey: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => { /* clipboard may fail in insecure contexts */ });
    setCopiedIntuitField(fieldKey);
    setTimeout(() => setCopiedIntuitField(prev => prev === fieldKey ? null : prev), 1500);
  };

  // Step 2: called by the modal's "Download CSV" button. Thin wrapper around
  // src/lib/convera/batchFile.ts (behavior locked by 34 tests there).
  const downloadConveraBatchCSV = () => {
    const outRows = buildConveraBatchRows(converaBatchGroups, converaBatchCombine, converaBatchManualRows);
    if (outRows.length === 0) { alert('Nothing to export.'); return; }
    const allInvoices = converaBatchGroups.flatMap(g => g.entries.map(e => e.inv));
    const filenameDate = computeConveraBatchFilename(allInvoices);
    triggerDownload(buildConveraBatchCsv(outRows), `SynergiePayments_${filenameDate}.csv`);
    setShowConveraBatchModal(false);
    setConveraBatchManualRows([]);
    setConveraBatchManualEditor({ open: false, search: '', benef: null, amount: '', ref1: '' });
  };

  // ─── WEEK NAVIGATION ──────────────────────────────────────────────────────
  const changeWeek = (direction: number) => {
    const newWeek = new Date(selectedWeek);
    newWeek.setDate(newWeek.getDate() + (direction * 7));
    setSelectedWeek(newWeek);
    if (currentUser?.role === 'timesheetuser') loadTimesheetForWeek(currentUser!.id, newWeek, timesheetsRef.current);
  };

  const copyPreviousWeekTimesheet = () => {
    const currentWeekKey = formatDate(selectedWeek);
    const past = timesheetsRef.current
      .filter(t => t.userId === currentUser!.id && t.weekStart < currentWeekKey)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    if (past.length === 0) { alert('No previous timesheet found.'); return; }
    const prev = past[0];
    const [py, pm, pd] = prev.weekStart.split('-').map(Number);
    const prevWeek = new Date(py, pm - 1, pd);
    const newEntries: Record<string, TimeEntry> = {};
    const prevWeekDates = getWeekDates(prevWeek);
    getWeekDates(selectedWeek).forEach((date, i) => {
      const curKey = formatDate(date);
      const prevDate = prevWeekDates[i];
      const prevKey = prevDate ? formatDate(prevDate) : null;
      const e = prevKey ? prev.entries[prevKey] : undefined;
      const holiday = isHoliday(date, currentUser!.country);
      const weekend = isWeekend(date);
      const raw = e ? (typeof e === 'object' ? e.hours : String(e)) : '0';
      newEntries[curKey] = {
        hours: String(raw != null ? raw : '0'),
        isHoliday: holiday || undefined,
        holidayName: holiday ? holiday.name : undefined,
        isWeekend: weekend
      };
    });
    // Show weekend rows if previous week had weekend hours
    const hasWeekendHours = Object.entries(newEntries).some(([k, e]) => {
      const d = parseLocalDate(k); const day = d.getDay();
      return (day === 0 || day === 6) && parseFloat(e?.hours || '0') > 0;
    });
    setShowWeekendHours(hasWeekendHours);
    setTimeEntries(newEntries);
    alert('Copied from week of ' + prevWeek.toLocaleDateString());
  };

  const exportTimesheetList = (filtered: Timesheet[]) => {
    let csv = 'Employee Name,Week Start,Project,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Total Hours,Status,Submitted Date\n';
    filtered.forEach(ts => {
      const tsUser = users.find(u => u.id === ts.userId);
      const project = projects.find(p => p.id === (ts.projectId ?? tsUser?.projectId));
      const weekDates = getWeekDates(parseLocalDate(ts.weekStart));
      const dailyHours = weekDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
      const total = dailyHours.reduce((s, h) => s + h, 0);
      csv += `"${ts.userName}","${parseLocalDate(ts.weekStart).toLocaleDateString()}","${project ? `${project.name} (${project.code})` : 'N/A'}",`;
      dailyHours.forEach(h => { csv += h + ','; });
      csv += `${total},"${ts.status}","${new Date(ts.submittedAt).toLocaleDateString()}"\n`;
    });
    triggerDownload(csv, `timesheets_export_${Date.now()}.csv`);
  };

  // ─── FILTER / MODAL HELPERS ───────────────────────────────────────────────
  const getFilteredTimesheets = (userId: string | null = null) => {
    let filtered = userId ? timesheets.filter(t => t.userId === userId) : timesheets;
    if (dateRange.start && dateRange.end) {
      const start = new Date(dateRange.start), end = new Date(dateRange.end);
      filtered = filtered.filter(t => { const d = parseLocalDate(t.weekStart); return d >= start && d <= end; });
    }
    return filtered.sort((a, b) => parseLocalDate(b.weekStart).getTime() - parseLocalDate(a.weekStart).getTime());
  };

  const openTimesheetModal = (ts: Timesheet) => { setSelectedTimesheetForView(ts); setShowTimesheetModal(true); };
  const closeTimesheetModal = () => { setSelectedTimesheetForView(null); setShowTimesheetModal(false); };
  const dismissReminder = (id: number) => { setReminderEmails(prev => prev.filter(r => r.id !== id)); };

  const toggleTimesheetSelection = (id: number) => {
    setSelectedTimesheetIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = (filtered: Timesheet[]) => {
    const pendingIds = filtered.filter(t => t.status === 'pending').map(t => t.id);
    setSelectedTimesheetIds(selectedTimesheetIds.length === pendingIds.length && pendingIds.length > 0 ? [] : pendingIds);
  };

  // ─── LOADING SCREEN ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <Clock className="w-12 h-12 text-indigo-600 mx-auto mb-4 animate-spin" />
          <p className="text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // ─── PASSWORD RESET SCREEN ────────────────────────────────────────────────
  if (passwordResetMode) {
    return <PasswordResetForm onDone={() => setPasswordResetMode(false)} />;
  }

  // ─── LOGIN SCREEN ─────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <Clock className="w-16 h-16 text-indigo-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-800">Timesheet System</h1>
            <p className="text-gray-600 mt-2">Please log in to continue</p>
            {detectedLocation && (
              <div className="flex items-center justify-center gap-2 mt-3 text-sm text-indigo-600 bg-indigo-50 py-2 px-4 rounded">
                <MapPin className="w-4 h-4" />
                <span>Detected: {countries.find(c => c.code === detectedLocation.country)?.name}</span>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input type="email" value={loginForm.email} onChange={e => setLoginForm({ ...loginForm, email: e.target.value })} onKeyPress={e => e.key === 'Enter' && handleLogin()} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input type="password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })} onKeyPress={e => e.key === 'Enter' && handleLogin()} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent" placeholder="Enter password" />
            </div>
            <button onClick={handleLogin} className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium">Log In</button>
            <button
              onClick={async () => {
                if (!loginForm.email) { alert('Enter your email address first'); return; }
                const { error } = await supabase.auth.resetPasswordForEmail(loginForm.email, { redirectTo: window.location.origin });
                if (error) { alert('Error: ' + error.message); return; }
                alert(`Password reset email sent to ${loginForm.email}`);
              }}
              className="w-full text-sm text-indigo-600 hover:text-indigo-800 py-1"
            >
              Forgot password?
            </button>
          </div>
          <div className="mt-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
            <p className="font-semibold mb-1">ℹ️ Login uses your email address</p>
            <p>Users are managed in Supabase → Authentication → Users</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── CONTRACT ADMIN VIEW ──────────────────────────────────────────────────
  // CA's primary surface is /chat. This landing renders when they open the
  // main app URL. Kept minimal — see roles/ContractAdmin/index.tsx.
  if (currentUser!.role === 'contract_admin') {
    return <ContractAdminDashboard userName={currentUser!.name} />;
  }

  // ─── ADMIN VIEW ───────────────────────────────────────────────────────────
  if (currentUser!.role === 'admin') {
    const managers = users.filter(u => u.role === 'manager');
    return (
      <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
                <p className="text-gray-600">Welcome, {currentUser!.name}</p>
                <p className="text-sm text-purple-600 font-medium">Role: Administrator</p>
              </div>
              <div className="flex items-center gap-2">
                <a href="/chat" className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors" title="Open Synergie Chat">
                  <MessageSquare className="w-4 h-4" /> Chat
                </a>
                <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"><LogOut className="w-4 h-4" /> Logout</button>
              </div>
            </div>
          </div>

          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
            <p className="text-yellow-800"><strong>Admin Features:</strong> Create users directly in the app. Set each user's <strong>Start Date</strong> to enable automatic missing-timesheet reminders from that date onward.</p>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Quick Stats</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Total Users</p>
                <p className="text-2xl font-bold text-blue-600 mb-3">{users.length}</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { role: 'timesheetuser', label: 'Contractors', color: 'bg-gray-100 text-gray-700' },
                    { role: 'manager',       label: 'Managers',    color: 'bg-blue-100 text-blue-700' },
                    { role: 'accountant',    label: 'Accountants', color: 'bg-green-100 text-green-700' },
                    { role: 'vendormanager', label: 'Vendor Mgrs', color: 'bg-teal-100 text-teal-700' },
                    { role: 'admin',         label: 'Admins',      color: 'bg-purple-100 text-purple-700' },
                  ].map(({ role, label, color }) => {
                    const count = users.filter(u => u.role === role).length;
                    if (count === 0) return null;
                    return (
                      <button
                        key={role}
                        onClick={() => setAdminUserRoleFilter(adminUserRoleFilter === role ? 'all' : role)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${color} ${adminUserRoleFilter === role ? 'ring-2 ring-offset-1 ring-indigo-400' : 'hover:opacity-80'}`}
                      >
                        {label}: {count}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Active Projects</p><p className="text-2xl font-bold text-green-600">{projects.filter(p => p.status === 'active').length}</p></div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Timesheets Submitted</p>
                <p className="text-2xl font-bold text-purple-600 mb-3">{timesheets.length}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const portal  = timesheets.filter(t => t.source === 'direct').length;
                    const email   = timesheets.filter(t => t.source === 'imported').length;
                    const unknown = timesheets.filter(t => !t.source).length;
                    return <>
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Portal: {portal}</span>
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">Email: {email}</span>
                      {unknown > 0 && <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Unknown: {unknown}</span>}
                    </>;
                  })()}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md mb-6">
            <div className="flex border-b">
              <button onClick={() => setAdminView('users')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (adminView === 'users' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <Users className="w-5 h-5" /> User Management
              </button>
              <button onClick={() => setAdminView('projects')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (adminView === 'projects' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <Settings className="w-5 h-5" /> Project Management
              </button>
              <button onClick={() => setAdminView('allocations')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (adminView === 'allocations' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <FileText className="w-5 h-5" /> Project Allocations
              </button>
              <button onClick={() => setAdminView('qbsync')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (adminView === 'qbsync' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <Download className="w-5 h-5" /> QB Sync
              </button>
              <button onClick={() => setAdminView('chatactivity')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (adminView === 'chatactivity' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <MessageSquare className="w-5 h-5" /> Chat Activity
              </button>
              <button onClick={() => setAdminView('qbautov2')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (adminView === 'qbautov2' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <UploadCloud className="w-5 h-5" /> QB Auto v2
                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-700">PREVIEW</span>
              </button>

            </div>
          </div>

          {adminView === 'qbautov2' && (
            <QbAutomationV2
              events={qbIngestEvents}
              openBills={qbOpenBills}
              vendors={qbVendorsList}
              invoices={invoices}
              paymentProfiles={paymentProfiles}
              users={users}
              mappings={qbVendorMappings}
              pushRecords={qbPushRecords}
              supabase={supabase}
              onDismissPushRecord={(eventId) => setQbPushRecords(prev => prev.filter(r => r.eventId !== eventId))}
              onSyncVendors={runSyncQbVendors}
              onPushRows={async ({ eventIds, invoiceIds }) => {
                // Route selected event/invoice IDs to the 8 v1 pushers based on
                // source + resolvedAction + bill-state. Same logic as v1's
                // TS.tsx:7660+ push handler, distilled for v2's clean inputs.
                const eventById = new Map(qbIngestEvents.map(e => [e.id, e]));
                const events = eventIds.map(id => eventById.get(id)).filter((e): e is QbIngestEvent => !!e);

                const intuitPay = events
                  .filter(e => e.source === 'intuit_xlsx' && e.resolvedAction === 'pay_existing_bill')
                  .map(e => e.id);
                const intuitCreate = events
                  .filter(e => e.source === 'intuit_xlsx' && e.resolvedAction === 'create_bill_then_pay')
                  .map(e => e.id);

                const converaBillPmtCandidates = events.filter(e =>
                  e.source === 'convera'
                  && e.targetQbTxnKind === 'bill_pmt'
                  && (e.matchedInvoiceIds ?? []).length > 0
                );
                const converaBillExists = converaBillPmtCandidates.filter(e => {
                  const ids = e.matchedInvoiceIds ?? [];
                  return ids.length === 1 && ids.every(iid => invoices.find(inv => inv.id === iid)?.qbBillTxnId);
                }).map(e => e.id);
                const converaMissingBills = converaBillPmtCandidates
                  .filter(e => !converaBillExists.includes(e.id))
                  .map(e => e.id);
                const converaOrphan = events.filter(e =>
                  e.source === 'convera'
                  && (e.targetQbTxnKind === 'bill_add_and_pmt' || e.targetQbTxnKind === 'bill_pmt')
                  && (e.matchedInvoiceIds ?? []).length === 0
                ).map(e => e.id);

                const g75Ids: number[] = [];
                const g76Ids: number[] = [];
                for (const invId of invoiceIds) {
                  const inv = invoices.find(i => i.id === invId);
                  if (!inv) continue;
                  const pm = paymentMethod(inv);
                  if (pm === 'Intuit') g75Ids.push(invId);
                  else if (pm === 'Convera') g76Ids.push(invId);
                }

                const [payRes, createRes, g75Res, g76Res, converaPayRes, converaCreatePayRes, converaOrphanRes] = await Promise.all([
                  intuitPay.length ? pushIntuitPayBill(supabase, intuitPay) : Promise.resolve(null),
                  intuitCreate.length ? pushIntuitCreateBill(supabase, intuitCreate) : Promise.resolve(null),
                  g75Ids.length ? pushIntuitInvoiceCreateBill(supabase, g75Ids) : Promise.resolve(null),
                  g76Ids.length ? pushConveraInvoiceCreateBill(supabase, g76Ids) : Promise.resolve(null),
                  converaBillExists.length ? pushConveraBillPmt(supabase, converaBillExists) : Promise.resolve(null),
                  converaMissingBills.length ? pushConveraCreateBillAndPay(supabase, converaMissingBills) : Promise.resolve(null),
                  converaOrphan.length ? pushConveraCreateBillFromEvent(supabase, converaOrphan) : Promise.resolve(null),
                ]);

                const merged = {
                  jobIds: [payRes, createRes, g75Res, g76Res, converaPayRes, converaCreatePayRes, converaOrphanRes]
                    .flatMap(r => (r?.jobIds ?? []) as (number | null)[]).filter((x): x is number => x != null),
                  rejected: [payRes, createRes, g75Res, g76Res, converaPayRes, converaCreatePayRes, converaOrphanRes]
                    .flatMap(r => (r?.rejected ?? []) as unknown[]),
                  skippedDuplicate: [payRes, createRes, g75Res, g76Res, converaPayRes, converaCreatePayRes, converaOrphanRes]
                    .flatMap(r => (r?.skippedDuplicate ?? []) as unknown[]),
                  skippedIneligible: [payRes, createRes, g75Res, g76Res, converaPayRes, converaCreatePayRes, converaOrphanRes]
                    .flatMap(r => (r?.skippedIneligible ?? []) as unknown[]),
                };

                // Build status-pane records for the pay-bill jobs (Intuit + all 3
                // Convera pay paths). bill_add-only pushes (Create-Bill verdict,
                // g75/g76) don't get pane records — the pane's state machine
                // models pay+verify only. Same policy as v1 (see TS.tsx:7735).
                const vendorByListId = new Map(qbVendorsList.map(v => [v.listId, v]));
                const newRecords: PushRecord[] = [];
                const buildFor = (
                  pushRes: { jobIds: (number | null)[]; rejected: Array<{ intent?: { kind?: string; sourceIngestEventId?: number } }>; skippedDuplicate: Array<{ intent?: { kind?: string; sourceIngestEventId?: number } }>; skippedIneligible: Array<{ eventId?: number }>; verifyJobIdByPayJobId?: Record<number, number> } | null,
                  requestedIds: number[],
                ) => {
                  if (!pushRes) return;
                  const inelig = new Set((pushRes.skippedIneligible ?? []).map(s => s.eventId));
                  const rej = new Set((pushRes.rejected ?? [])
                    .map(rj => rj.intent?.kind === 'pay_bill' ? rj.intent.sourceIngestEventId : undefined)
                    .filter((x): x is number => x != null));
                  const dup = new Set((pushRes.skippedDuplicate ?? [])
                    .map(s => s.intent?.kind === 'pay_bill' ? s.intent.sourceIngestEventId : undefined)
                    .filter((x): x is number => x != null));
                  const eligibleInOrder = requestedIds.filter(id => !inelig.has(id) && !rej.has(id) && !dup.has(id));
                  (pushRes.jobIds ?? []).forEach((jobId, i) => {
                    if (jobId == null) return;
                    const eventId = eligibleInOrder[i];
                    if (eventId == null) return;
                    const event = eventById.get(eventId);
                    if (!event) return;
                    const vendor = event.counterpartyQbVendorListId ? vendorByListId.get(event.counterpartyQbVendorListId) : null;
                    newRecords.push({
                      eventId,
                      payJobId: jobId,
                      verifyJobId: pushRes.verifyJobIdByPayJobId?.[jobId] ?? null,
                      billTxnId: event.resolvedBillTxnId ?? '',
                      expectedAmount: event.amount,
                      expectedVendor: vendor?.name ?? event.counterpartyRaw,
                      pushedAt: new Date().toISOString(),
                      kind: 'pay_bill',
                    });
                  });
                };
                buildFor(payRes as never, intuitPay);
                buildFor(converaPayRes as never, converaBillExists);
                buildFor(converaCreatePayRes as never, converaMissingBills);
                buildFor(converaOrphanRes as never, converaOrphan);
                if (newRecords.length > 0) setQbPushRecords(prev => [...prev, ...newRecords]);

                await loadQbIngestEvents();
                await loadQbOpenBills();

                return {
                  pushed: merged.jobIds.length,
                  rejected: merged.rejected.length,
                  skippedDuplicate: merged.skippedDuplicate.length,
                  skippedIneligible: merged.skippedIneligible.length,
                };
              }}
              onMappingChangeSubscribe={(cb) => {
                const ch = supabase
                  .channel('qbautov2-mappings')
                  .on('postgres_changes', { event: '*', schema: 'public', table: 'qb_vendor_mappings' }, async () => {
                    await loadQbVendorMappings();
                    await loadQbIngestEvents();
                    cb();
                  })
                  .subscribe();
                return () => { supabase.removeChannel(ch); };
              }}
              onUpdateMappingVendor={async ({ mappingId, qbVendorListId }) => {
                const { error } = await supabase
                  .from('qb_vendor_mappings')
                  .update({ qb_vendor_list_id: qbVendorListId, updated_at: new Date().toISOString() })
                  .eq('id', mappingId);
                if (error) throw error;
                await loadQbVendorMappings();
                // Downstream events keyed by this pp will re-resolve on next
                // classification pass. Kick one off so Ready view reflects the
                // edit without waiting for the next auto-run.
                await applyClassificationPass();
                await loadQbIngestEvents();
              }}
              onDeleteMapping={async (mappingId) => {
                const { error } = await supabase.from('qb_vendor_mappings').delete().eq('id', mappingId);
                if (error) throw error;
                await loadQbVendorMappings();
              }}
              onSaveMapping={async ({ eventId, ppId, source, counterpartyPattern, qbVendorListId }) => {
                // pp_id-primary mapping upsert (Slice V1 architecture).
                // default_target_kind = 'bill_add_and_pmt' — safe default for
                // 99% of contractor cases; classifier fallbacks cover bank +
                // expense per [[qb-expense-account-conventions]].
                const nowIso = new Date().toISOString();
                const { error: mapErr } = await supabase
                  .from('qb_vendor_mappings')
                  .upsert(
                    {
                      pp_id: ppId,
                      source,
                      counterparty_pattern: counterpartyPattern,
                      qb_vendor_list_id: qbVendorListId,
                      default_target_kind: 'bill_add_and_pmt',
                      updated_at: nowIso,
                    },
                    { onConflict: 'pp_id' },
                  );
                if (mapErr) throw mapErr;
                // Flip THIS event to ready immediately for real-time UX;
                // sibling pp events get picked up by applyClassificationPass.
                // eventId is null for V8-B Ready-row inline overrides on
                // invoice-driven rows (no event exists); mapping alone is enough.
                if (eventId != null) {
                  const { error: evtErr } = await supabase
                    .from('qb_ingest_events')
                    .update({
                      counterparty_qb_vendor_list_id: qbVendorListId,
                      target_qb_txn_kind: 'bill_add_and_pmt',
                      status: 'ready',
                      status_updated_at: nowIso,
                    })
                    .eq('id', eventId);
                  if (evtErr) throw evtErr;
                }
                await applyClassificationPass();
                await loadQbIngestEvents();
                await loadQbVendorMappings();
              }}
            />
          )}

          {adminView === 'users' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                <h2 className="text-xl font-bold text-gray-800">Users ({users.length})</h2>
                <div className="flex gap-2">
                  <button onClick={openQuickAddModal} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm sm:text-base"><Plus className="w-4 h-4" /> Quick Add</button>
                  <button onClick={() => openUserModal()} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm sm:text-base">Full Form</button>
                </div>
              </div>
              {/* Search + role filter */}
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <input
                  type="text"
                  placeholder="Search by name or email…"
                  value={adminUserSearch}
                  onChange={e => setAdminUserSearch(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <select
                  value={adminUserRoleFilter}
                  onChange={e => setAdminUserRoleFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                >
                  <option value="all">All roles</option>
                  <option value="timesheetuser">Contractors</option>
                  <option value="manager">Managers</option>
                  <option value="accountant">Accountants</option>
                  <option value="vendormanager">Vendor Managers</option>
                  <option value="admin">Admins</option>
                </select>
                {(adminUserSearch || adminUserRoleFilter !== 'all') && (
                  <button onClick={() => { setAdminUserSearch(''); setAdminUserRoleFilter('all'); }} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Clear</button>
                )}
              </div>
              {(() => {
                const filteredUsers = users.filter(u => {
                  const matchesSearch = !adminUserSearch ||
                    u.name.toLowerCase().includes(adminUserSearch.toLowerCase()) ||
                    u.email.toLowerCase().includes(adminUserSearch.toLowerCase());
                  const matchesRole = adminUserRoleFilter === 'all' || u.role === adminUserRoleFilter;
                  return matchesSearch && matchesRole;
                });
                const showingAll = filteredUsers.length === users.length;
                return <>
                  {!showingAll && <p className="text-sm text-gray-500 mb-3">Showing {filteredUsers.length} of {users.length} users</p>}
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Phone</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Location</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Start Date</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">End Date</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Manager</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Invoices</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Reminders</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Last Login</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredUsers.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-800">{user.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{user.phone || <span className="text-gray-400 italic">—</span>}</td>
                        <td className="px-4 py-3 text-sm">
                          <StatusBadge tone={(user.role === 'admin' ? 'purple' : user.role === 'manager' ? 'blue' : user.role === 'vendormanager' ? 'teal' : user.role === 'accountant' ? 'green' : 'gray') as BadgeTone}>
                            {user.role === 'timesheetuser' ? 'TimesheetUser' : user.role === 'vendormanager' ? 'Vendor Manager' : user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {countryName(user.country)}{user.region ? ', ' + user.region : ''}
                            {!tzMap[user.country + '-' + user.region] && !tzMap[user.country + '-'] && (
                              <span title="Timezone not mapped — add to tzMap" className="text-amber-500"><AlertTriangle className="w-3 h-3 inline" /></span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {user.role === 'timesheetuser' ? (
                            user.locationType === 'onshore' ? (
                              <StatusBadge tone="indigo">Onshore</StatusBadge>
                            ) : user.locationType === 'offshore' ? (
                              <StatusBadge tone="amber">Offshore</StatusBadge>
                            ) : (
                              <span className="text-gray-400 italic">Unclassified</span>
                            )
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{user.startDate ? parseLocalDate(user.startDate).toLocaleDateString() : <span className="text-gray-400 italic">Not set</span>}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {user.endDate ? (
                            <span className={new Date() > parseLocalDate(user.endDate) ? 'text-red-600 font-medium' : 'text-gray-600'}>
                              {parseLocalDate(user.endDate).toLocaleDateString()}
                              {new Date() > parseLocalDate(user.endDate) && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Inactive</span>}
                            </span>
                          ) : <span className="text-gray-400 italic">No end date</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{user.managerId ? users.find(u => u.id === user.managerId)?.name : '-'}</td>
                        <td className="px-4 py-3 text-center">
                          {user.role === 'timesheetuser' ? (
                            <button
                              onClick={() => updateProfileField(user.id, 'invoice_enabled', !user.invoiceEnabled)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${user.invoiceEnabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                              title={user.invoiceEnabled ? 'Click to disable invoices' : 'Click to enable invoices'}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${user.invoiceEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {user.role === 'timesheetuser' ? (
                            <button
                              onClick={() => updateProfileField(user.id, 'reminders_enabled', !user.remindersEnabled)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${user.remindersEnabled ? 'bg-green-500' : 'bg-gray-300'}`}
                              title={user.remindersEnabled ? 'Click to disable reminders' : 'Click to enable reminders'}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${user.remindersEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {user.lastLogin
                            ? <span title={new Date(user.lastLogin).toLocaleString()}>{new Date(user.lastLogin).toLocaleDateString()}</span>
                            : <span className="text-gray-400 italic">Never</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => openUserModal(user)} className="p-1 text-indigo-600 hover:text-indigo-800" title="Edit"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => sendInvite(user)} className="p-1 text-indigo-400 hover:text-indigo-600" title="Send Portal Invite"><Mail className="w-4 h-4" /></button>
                            {user.id !== currentUser?.id && (
                              <button onClick={() => loginAsUser(user)} className="p-1 text-emerald-600 hover:text-emerald-800" title="Login as this user"><LogIn className="w-4 h-4" /></button>
                            )}
                            <button onClick={() => deleteUser(user.id)} className="p-1 text-red-600 hover:text-red-800" title="Delete"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                </>; })()}
            </div>
          )}

          {adminView === 'projects' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h2 className="text-xl font-bold text-gray-800">Projects ({projects.length})</h2>
                <button onClick={() => openProjectModal()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Plus className="w-4 h-4" /> Add Project</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {projects.map(project => (
                  <div key={project.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800 text-lg">{project.name}</h3>
                        <p className="text-sm text-gray-600 mb-2">Code: {project.code}</p>
                        <p className="text-sm text-gray-700">{project.description}</p>
                      </div>
                      <StatusBadge tone={project.status === 'active' ? 'green' : 'gray'} size="lg">{project.status.charAt(0).toUpperCase() + project.status.slice(1)}</StatusBadge>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => openProjectModal(project)} className="flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 text-sm"><Edit2 className="w-3 h-3" /> Edit</button>
                      <button onClick={() => deleteProject(project.id)} className="flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"><Trash2 className="w-3 h-3" /> Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {adminView === 'allocations' && (() => {
            const timesheetUsers = users.filter(u => u.role === 'timesheetuser');
            const visibleProjects = allocationsProjectFilter
              ? projects.filter(p => p.id === allocationsProjectFilter)
              : projects;

            const exportAllocations = () => {
              let csv = 'Project,Project Code,Status,Employee Name,Email,Country,Region,Start Date,End Date,Active\n';
              visibleProjects.forEach(project => {
                const allocated = timesheetUsers.filter(u => u.projectId === project.id);
                if (allocated.length === 0) {
                  csv += `"${project.name}","${project.code}","${project.status}","(no users)","","","","","",""\n`;
                } else {
                  allocated.forEach(user => {
                    const isInactive = !!(user.endDate && new Date() > parseLocalDate(user.endDate));
                    csv += `"${project.name}","${project.code}","${project.status}","${user.name}","${user.email}","${countryName(user.country)}","${user.region || ''}","${user.startDate || ''}","${user.endDate || ''}","${isInactive ? 'No' : 'Yes'}"\n`;
                  });
                }
              });
              // Unallocated users — only include when showing all projects
              if (!allocationsProjectFilter) {
                const unallocated = timesheetUsers.filter(u => !u.projectId);
                unallocated.forEach(user => {
                  const isInactive = !!(user.endDate && new Date() > parseLocalDate(user.endDate));
                  csv += `"(No Project)","","","${user.name}","${user.email}","${countryName(user.country)}","${user.region || ''}","${user.startDate || ''}","${user.endDate || ''}","${isInactive ? 'No' : 'Yes'}"\n`;
                });
              }
              const selectedProject = allocationsProjectFilter ? projects.find(p => p.id === allocationsProjectFilter) : null;
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = (selectedProject ? selectedProject.code + '_allocations_' : 'project_allocations_') + new Date().toISOString().split('T')[0] + '.csv';
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            };

            return (
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Project Allocations</h2>
                    <p className="text-sm text-gray-500 mt-1">Timesheet users grouped by assigned project</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={allocationsProjectFilter ?? ''}
                      onChange={e => setAllocationsProjectFilter(e.target.value ? parseInt(e.target.value) : null)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">All Projects</option>
                      {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                    </select>
                    <button onClick={exportAllocations} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  </div>
                </div>

                {visibleProjects.map(project => {
                  const allocated = timesheetUsers.filter(u => u.projectId === project.id);
                  return (
                    <div key={project.id} className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
                      <div className={`flex items-center justify-between px-5 py-3 ${project.status === 'active' ? 'bg-indigo-600' : 'bg-gray-400'} text-white`}>
                        <div>
                          <span className="font-semibold text-lg">{project.name}</span>
                          <span className="ml-3 text-indigo-200 text-sm font-mono">{project.code}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-indigo-100">{allocated.length} user{allocated.length !== 1 ? 's' : ''}</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${project.status === 'active' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200 text-gray-700'}`}>
                            {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                          </span>
                        </div>
                      </div>
                      {allocated.length === 0 ? (
                        <p className="px-5 py-4 text-sm text-gray-400 italic">No users allocated to this project</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                            <tr>
                              <th className="px-4 py-2 text-left">Name</th>
                              <th className="px-4 py-2 text-left">Email</th>
                              <th className="px-4 py-2 text-left">Location</th>
                              <th className="px-4 py-2 text-left">Start Date</th>
                              <th className="px-4 py-2 text-left">End Date</th>
                              <th className="px-4 py-2 text-left">Status</th>
                              <th className="px-4 py-2 text-center">Edit</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {allocated.map(user => {
                              const isInactive = !!(user.endDate && new Date() > parseLocalDate(user.endDate));
                              return (
                                <tr key={user.id} className={isInactive ? 'bg-red-50' : 'bg-white hover:bg-gray-50'}>
                                  <td className="px-4 py-3 font-medium text-gray-800">{user.name}</td>
                                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                                  <td className="px-4 py-3 text-gray-600">
                                    <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{countryName(user.country)}{user.region ? ', ' + user.region : ''}</div>
                                  </td>
                                  <td className="px-4 py-3 text-gray-600">{user.startDate ? parseLocalDate(user.startDate).toLocaleDateString() : <span className="text-gray-400 italic">Not set</span>}</td>
                                  <td className="px-4 py-3">
                                    {user.endDate ? (
                                      <span className={isInactive ? 'text-red-600 font-medium' : 'text-gray-600'}>
                                        {parseLocalDate(user.endDate).toLocaleDateString()}
                                        {isInactive && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Past</span>}
                                      </span>
                                    ) : <span className="text-gray-400 italic">No end date</span>}
                                  </td>
                                  <td className="px-4 py-3">
                                    <StatusBadge tone={isInactive ? 'red' : 'green'}>{isInactive ? 'Inactive' : 'Active'}</StatusBadge>
                                  </td>
                                  <td className="px-4 py-3 text-center">
                                    <button onClick={() => openUserModal(user)} className="p-1 text-indigo-600 hover:text-indigo-800" title="Edit user"><Edit2 className="w-4 h-4" /></button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}

                {/* Unallocated users — hidden when a specific project is filtered */}
                {!allocationsProjectFilter && (() => {
                  const unallocated = timesheetUsers.filter(u => !u.projectId);
                  if (unallocated.length === 0) return null;
                  return (
                    <div className="border border-orange-200 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-3 bg-orange-500 text-white">
                        <span className="font-semibold text-lg">Unallocated Users</span>
                        <span className="text-sm text-orange-100">{unallocated.length} user{unallocated.length !== 1 ? 's' : ''} — no project assigned</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                          <tr>
                            <th className="px-4 py-2 text-left">Name</th>
                            <th className="px-4 py-2 text-left">Email</th>
                            <th className="px-4 py-2 text-left">Location</th>
                            <th className="px-4 py-2 text-left">Start Date</th>
                            <th className="px-4 py-2 text-left">End Date</th>
                            <th className="px-4 py-2 text-left">Status</th>
                            <th className="px-4 py-2 text-center">Edit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {unallocated.map(user => {
                            const isInactive = !!(user.endDate && new Date() > parseLocalDate(user.endDate));
                            return (
                              <tr key={user.id} className={isInactive ? 'bg-red-50' : 'bg-white hover:bg-gray-50'}>
                                <td className="px-4 py-3 font-medium text-gray-800">{user.name}</td>
                                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                                <td className="px-4 py-3 text-gray-600">
                                  <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{countryName(user.country)}{user.region ? ', ' + user.region : ''}</div>
                                </td>
                                <td className="px-4 py-3 text-gray-600">{user.startDate ? parseLocalDate(user.startDate).toLocaleDateString() : <span className="text-gray-400 italic">Not set</span>}</td>
                                <td className="px-4 py-3">
                                  {user.endDate ? (
                                    <span className={isInactive ? 'text-red-600 font-medium' : 'text-gray-600'}>
                                      {parseLocalDate(user.endDate).toLocaleDateString()}
                                      {isInactive && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Past</span>}
                                    </span>
                                  ) : <span className="text-gray-400 italic">No end date</span>}
                                </td>
                                <td className="px-4 py-3">
                                  <StatusBadge tone={isInactive ? 'red' : 'green'}>{isInactive ? 'Inactive' : 'Active'}</StatusBadge>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <button onClick={() => openUserModal(user)} className="p-1 text-indigo-600 hover:text-indigo-800" title="Edit user"><Edit2 className="w-4 h-4" /></button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {adminView === 'qbsync' && (
            <QbSyncPanel />
          )}


          {/* Quick Add Modal */}
          {showQuickAddModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
              <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-sm">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-5">
                    <h3 className="text-xl font-bold text-gray-800">Quick Add User</h3>
                    <button onClick={() => setShowQuickAddModal(false)} className="text-gray-500 hover:text-gray-700"><X className="w-6 h-6" /></button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                      <input
                        type="text"
                        value={userForm.name}
                        onChange={e => setUserForm({...userForm, name: e.target.value})}
                        className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                        placeholder="Jane Doe"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                      <input
                        type="email"
                        value={userForm.email}
                        onChange={e => setUserForm({...userForm, email: e.target.value})}
                        className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                        placeholder="jane@company.com"
                        autoCapitalize="none"
                        autoCorrect="off"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                      <CountrySelect
                        value={userForm.country}
                        onChange={code => {
                          const c = countries.find(x => x.code === code);
                          const autoRegion = c && c.regions.length === 1 ? c.regions[0] : '';
                          setUserForm({...userForm, country: code, region: autoRegion});
                        }}
                        className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                      <input
                        type="date"
                        value={userForm.start_date}
                        onChange={e => setUserForm({...userForm, start_date: e.target.value})}
                        className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white"
                      />
                    </div>
                  </div>
                  <div className="mt-6 space-y-3">
                    <button
                      onClick={saveUser}
                      className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-indigo-600 text-white text-lg font-semibold rounded-xl hover:bg-indigo-700 active:bg-indigo-800"
                    >
                      <Plus className="w-5 h-5" /> Add User
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() => { setShowQuickAddModal(false); setShowUserModal(true); }}
                        className="flex-1 px-4 py-3 text-indigo-600 font-medium rounded-xl border border-indigo-200 hover:bg-indigo-50"
                      >
                        More Options →
                      </button>
                      <button
                        onClick={() => setShowQuickAddModal(false)}
                        className="px-4 py-3 text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {adminView === 'chatactivity' && (
            <AdminChatActivity />
          )}

          {/* User Modal */}
          {showUserModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
              <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">{editingUser ? 'Edit User' : 'Add New User'}</h3>
                    <button onClick={() => setShowUserModal(false)} className="text-gray-500 hover:text-gray-700"><X className="w-6 h-6" /></button>
                  </div>
                  <div className="space-y-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label><input type="text" value={userForm.name} onChange={e => setUserForm({...userForm, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="John Doe" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label><input type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} disabled={!!editingUser} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100" placeholder="john@company.com" /></div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone (international format)</label>
                      <input type="tel" value={userForm.phone} onChange={e => setUserForm({...userForm, phone: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="+44 7700 900123" />
                      <p className="text-xs text-gray-400 mt-1">Include country code, e.g. +1 555 123 4567</p>
                    </div>
                    {!editingUser ? (
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <p className="text-xs text-gray-500">A secure password is auto-generated. Use <strong>Send Portal Invite</strong> from the user list when you're ready to give them access — they'll set their own password via a link.</p>
                      </div>
                    ) : (
                      <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                        <p className="text-sm text-indigo-800 font-medium mb-2">Portal Access</p>
                        <p className="text-xs text-indigo-700 mb-3">Send a set-password link so the user can access the portal for the first time (or regain access).</p>
                        <button
                          onClick={() => { setShowUserModal(false); sendInvite(editingUser!); }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
                        >
                          <Mail className="w-4 h-4" /> Send Portal Invite
                        </button>
                      </div>
                    )}
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                      <select value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        <option value="timesheetuser">TimesheetUser</option><option value="manager">Manager</option><option value="vendormanager">Vendor Manager</option><option value="accountant">Accountant</option><option value="admin">Admin</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-indigo-50 border-2 border-indigo-200 rounded-lg">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">Invoice Module</p>
                        <p className="text-xs text-gray-500 mt-0.5">Allow this user to create and submit invoices</p>
                        <p className="text-xs font-semibold mt-1 text-indigo-700">{userForm.invoice_enabled ? '✓ Enabled' : '✗ Disabled'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUserForm({...userForm, invoice_enabled: !userForm.invoice_enabled})}
                        className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${userForm.invoice_enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${userForm.invoice_enabled ? 'translate-x-8' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-green-50 border-2 border-green-200 rounded-lg">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">Reminder Emails</p>
                        <p className="text-xs text-gray-500 mt-0.5">Send automated reminders for missing timesheets</p>
                        <p className="text-xs font-semibold mt-1 text-green-700">{userForm.reminders_enabled ? '✓ Enabled' : '✗ Disabled'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUserForm({...userForm, reminders_enabled: !userForm.reminders_enabled})}
                        className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${userForm.reminders_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${userForm.reminders_enabled ? 'translate-x-8' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                      <CountrySelect
                        value={userForm.country}
                        onChange={code => {
                          const c = countries.find(x => x.code === code);
                          const autoRegion = c && c.regions.length === 1 ? c.regions[0] : '';
                          setUserForm({...userForm, country: code, region: autoRegion});
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    {(countries.find(c => c.code === userForm.country)?.regions.length ?? 0) > 1 && (
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                      <select value={userForm.region} onChange={e => setUserForm({...userForm, region: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        <option value="">Select Region</option>
                        {countries.find(c => c.code === userForm.country)?.regions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    )}
                    {userForm.role === 'timesheetuser' && (
                      <>
                        <div><label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
                          <select value={userForm.manager_id || ''} onChange={e => setUserForm({...userForm, manager_id: e.target.value || null})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">Select Manager</option>
                            {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>
                        <div><label className="block text-sm font-medium text-gray-700 mb-1">Vendor Manager <span className="text-gray-400 font-normal">(optional)</span></label>
                          <select value={userForm.vendor_manager_id || ''} onChange={e => setUserForm({...userForm, vendor_manager_id: e.target.value || null})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">None</option>
                            {users.filter(u => u.role === 'vendormanager').map(vm => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
                          </select>
                        </div>
                        <div><label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                          <select value={userForm.project_id || ''} onChange={e => setUserForm({...userForm, project_id: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">Select Project</option>
                            {projects.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Location Type</label>
                          <select value={userForm.location_type} onChange={e => setUserForm({...userForm, location_type: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">— unclassified —</option>
                            <option value="onshore">Onshore</option>
                            <option value="offshore">Offshore</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms <span className="text-gray-400 font-normal">(default for invoices)</span></label>
                          <select value={userForm.payment_terms} onChange={e => setUserForm({...userForm, payment_terms: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">— not set —</option>
                            <option value="NET15">NET15</option>
                            <option value="NET30">NET30</option>
                            <option value="NET45">NET45</option>
                            <option value="NET60">NET60</option>
                          </select>
                        </div>
                        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg space-y-3">
                          <p className="text-sm font-semibold text-indigo-800">Employment Dates</p>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="text-gray-400 font-normal">(used for timesheet reminders)</span></label>
                            <input type="date" value={userForm.start_date} onChange={e => setUserForm({...userForm, start_date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white" />
                            <p className="text-xs text-gray-500 mt-1">Reminders will flag missing timesheets from this date onward</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">End Date <span className="text-gray-400 font-normal">(optional — leave blank if still active)</span></label>
                            <input type="date" value={userForm.end_date} onChange={e => setUserForm({...userForm, end_date: e.target.value})} min={userForm.start_date || undefined} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white" />
                            <p className="text-xs text-gray-500 mt-1">No timesheets or reminders after this date. Login access remains.</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button onClick={saveUser} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Save className="w-4 h-4" /> Save User</button>
                    <button onClick={() => setShowUserModal(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Project Modal */}
          {showProjectModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
              <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-md">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">{editingProject ? 'Edit Project' : 'Add New Project'}</h3>
                    <button onClick={() => setShowProjectModal(false)} className="text-gray-500 hover:text-gray-700"><X className="w-6 h-6" /></button>
                  </div>
                  <div className="space-y-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Project Name *</label><input type="text" value={projectForm.name} onChange={e => setProjectForm({...projectForm, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="Website Redesign" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Project Code *</label><input type="text" value={projectForm.code} onChange={e => setProjectForm({...projectForm, code: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="WEB-001" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea value={projectForm.description} onChange={e => setProjectForm({...projectForm, description: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" rows={3} placeholder="Project description" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                      <select value={projectForm.status} onChange={e => setProjectForm({...projectForm, status: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        <option value="active">Active</option><option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button onClick={saveProject} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Save className="w-4 h-4" /> Save Project</button>
                    <button onClick={() => setShowProjectModal(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── MANAGER VIEW ─────────────────────────────────────────────────────────
  if (currentUser!.role === 'manager') {
    return (
      <ManagerView
        currentUser={currentUser!}
        timesheets={timesheets}
        users={users}
        projects={projects}
        dateRange={dateRange}
        setDateRange={setDateRange}
        selectedTimesheetIds={selectedTimesheetIds}
        showTimesheetModal={showTimesheetModal}
        timesheetDetailModal={selectedTimesheetForView ? (
          <TimesheetDetailModal
            timesheet={selectedTimesheetForView}
            users={users}
            projects={projects}
            currentUser={currentUser!}
            countries={countries}
            isHoliday={isHoliday}
            onClose={closeTimesheetModal}
            onApproval={handleApproval}
          />
        ) : null}
        onLogout={handleLogout}
        onApproval={handleApproval}
        bulkApproveTimesheets={bulkApproveTimesheets}
        toggleSelectAll={toggleSelectAll}
        toggleTimesheetSelection={toggleTimesheetSelection}
        openTimesheetModal={openTimesheetModal}
        exportTimesheetList={exportTimesheetList}
        getFilteredTimesheets={getFilteredTimesheets}
        countryName={countryName}
      />
    );
  }


  // ─── VENDOR MANAGER VIEW ──────────────────────────────────────────────────
  if (currentUser!.role === 'vendormanager') {
    return (
      <VendorManagerView
        currentUser={currentUser!}
        users={users}
        timesheets={timesheets}
        invoices={invoices}
        projects={projects}
        paymentProfiles={paymentProfiles}
        onLogout={handleLogout}
        fetchInvoices={fetchInvoices}
        setCurrentUser={setCurrentUser}
        showProfileModal={showProfileModal}
        setShowProfileModal={setShowProfileModal}
        editingProfile={editingProfile}
        setEditingProfile={setEditingProfile}
        profileForm={profileForm}
        setProfileForm={setProfileForm}
        setProfileEditUserId={setProfileEditUserId}
        emptyProfileForm={emptyProfileForm}
        savePaymentProfile={savePaymentProfile}
        profileNewPassword={profileNewPassword}
        setProfileNewPassword={setProfileNewPassword}
        profileConfirmPassword={profileConfirmPassword}
        setProfileConfirmPassword={setProfileConfirmPassword}
        profileShowNewPw={profileShowNewPw}
        setProfileShowNewPw={setProfileShowNewPw}
        profileShowConfirmPw={profileShowConfirmPw}
        setProfileShowConfirmPw={setProfileShowConfirmPw}
        profilePwLoading={profilePwLoading}
        setProfilePwLoading={setProfilePwLoading}
      />
    );
  }

  // ─── ACCOUNTANT VIEW ──────────────────────────────────────────────────────
  if (currentUser!.role === 'accountant') {
    // Weekly report + tab moved to src/roles/Accountant/tabs/Weekly.tsx (W3).
    // Consolidated report + tab moved to src/roles/Accountant/tabs/Consolidated.tsx (C5).

    return (
      <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
        {vendorDecisionState && (
          <VendorDecisionModal
            open={true}
            contractorName={vendorDecisionState.invoice.userName || ''}
            invoiceNumber={vendorDecisionState.invoice.invoiceNumber || ''}
            invoiceAmount={vendorDecisionState.invoice.totalAmount}
            invoicePeriodEnd={vendorDecisionState.invoice.periodEnd || null}
            targetPaymentProfileCompany={vendorDecisionState.targetPaymentProfileCompany}
            targetPaymentProfileIban={vendorDecisionState.targetPaymentProfileIban}
            siblingVendorHint={vendorDecisionState.siblingVendorHint}
            conflictNames={vendorDecisionState.conflictNames}
            qbVendors={qbVendorsList.map(v => ({ listId: v.listId, name: v.name }))}
            onCancel={() => setVendorDecisionState(null)}
            onConfirm={async (vendorName) => {
              const st = vendorDecisionState;
              const { error: ppErr } = await supabase
                .from('payment_profiles')
                .update({ qb_vendor_name: vendorName })
                .eq('id', st.targetPaymentProfileId);
              if (ppErr) throw new Error(`Failed to save vendor: ${ppErr.message}`);
              const entry = vendorMapEntry({
                by: currentUser?.name || 'unknown',
                mode: 'manual',
                reason: `Accountant picked QB vendor "${vendorName}" for payment profile "${st.targetPaymentProfileCompany || 'unnamed'}" via vendor decision modal.`,
                paymentProfileId: st.targetPaymentProfileId,
                paymentProfileCompany: st.targetPaymentProfileCompany,
                beforeVendorName: null,
                afterVendorName: vendorName,
                siblingSignal: st.conflictNames ? { conflictNames: st.conflictNames } : (st.siblingVendorHint ? { agreesOn: st.siblingVendorHint } : undefined),
              });
              const nextHistory = [...(st.invoice.editHistory || []), entry];
              const { error: histErr } = await supabase
                .from('invoices')
                .update({ edit_history: nextHistory })
                .eq('id', st.invoice.id);
              if (histErr) console.warn('vendor-map edit_history write failed', histErr);
              setPaymentProfiles(prev => prev.map(p => p.id === st.targetPaymentProfileId ? { ...p, qbVendorName: vendorName } : p));
              const cb = st.afterResolve;
              setVendorDecisionState(null);
              if (cb) await cb();
            }}
          />
        )}
        <PaymentProfileModal
          open={showProfileModal}
          mode="full"
          form={profileForm}
          setForm={setProfileForm}
          editingProfile={editingProfile}
          onSave={savePaymentProfile}
          onCancel={() => { setShowProfileModal(false); setProfileEditUserId(null); }}
        />
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Accountant Dashboard</h1>
                <p className="text-gray-600">Welcome, {currentUser!.name}</p>
                <p className="text-sm text-green-600 font-medium">Role: Accountant</p>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md mb-6">
            <div className="flex border-b">
              <button onClick={() => setAccountantTab('weekly')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'weekly' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <Calendar className="w-5 h-5 flex-shrink-0" />
                <span>Weekly</span>
              </button>
              <button onClick={() => setAccountantTab('consolidated')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'consolidated' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <FileText className="w-5 h-5 flex-shrink-0" />
                <span>Consolidated</span>
              </button>
              <button onClick={() => setAccountantTab('timesheet-only')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'timesheet-only' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <Users className="w-5 h-5 flex-shrink-0" />
                <span className="hidden sm:inline">Timesheet </span><span>Only</span>
              </button>
              <button onClick={() => setAccountantTab('client-estimation')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'client-estimation' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <Building2 className="w-5 h-5 flex-shrink-0" />
                <span className="hidden sm:inline">Client </span><span>Estimation</span>
              </button>
              <button onClick={() => setAccountantTab('invoices')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors relative ' + (accountantTab === 'invoices' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <span className="relative">
                  <Receipt className="w-5 h-5 flex-shrink-0" />
                  {invoices.filter(i => i.status === 'submitted').length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-yellow-400 text-white rounded-full text-[10px] font-bold flex items-center justify-center leading-none">
                      {invoices.filter(i => i.status === 'submitted').length}
                    </span>
                  )}
                </span>
                <span>Invoices</span>
              </button>
              <button onClick={() => setAccountantTab('payments')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors relative ' + (accountantTab === 'payments' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <span className="relative">
                  <DollarSign className="w-5 h-5 flex-shrink-0" />
                  {converaTransactions.filter(t => t.matchState === 'unreviewed' && importBatches.find(b => b.id === t.importBatchId)?.state === 'pending').length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-yellow-400 text-white rounded-full text-[10px] font-bold flex items-center justify-center leading-none">
                      {converaTransactions.filter(t => t.matchState === 'unreviewed' && importBatches.find(b => b.id === t.importBatchId)?.state === 'pending').length}
                    </span>
                  )}
                </span>
                <span>Payments</span>
              </button>
              <button onClick={() => setAccountantTab('qb-automation')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'qb-automation' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <UploadCloud className="w-5 h-5 flex-shrink-0" />
                <span className="hidden sm:inline">QB </span><span>Automation</span>
              </button>
              <button onClick={() => setAccountantTab('profiles')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'profiles' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <CreditCard className="w-5 h-5 flex-shrink-0" />
                <span>Payment Profiles</span>
              </button>
            </div>
          </div>

          {accountantTab === 'weekly' && (
            <WeeklyTab timesheets={timesheets} users={users} projects={projects} />
          )}

          {accountantTab === 'consolidated' && (
            <ConsolidatedTab
              timesheets={timesheets}
              users={users}
              projects={projects}
              countryName={countryName}
            />
          )}

          {accountantTab === 'client-estimation' && (
            <ClientEstimationTab
              users={users}
              projects={projects}
              timesheets={timesheets}
              currentUser={currentUser!}
            />
          )}

          {accountantTab === 'invoices' && (
            <InvoicesTab
              {...invoiceFilters}
              invoices={invoices}
              projects={projects}
              paymentProfiles={paymentProfiles}
              timesheets={timesheets}
              paymentMethod={paymentMethod}
              paymentMethodLabel={paymentMethodLabel}
              paymentMethodChipClass={paymentMethodChipClass}
              handleInvoiceAction={handleInvoiceAction}
              openInvoiceDetail={openInvoiceDetail}
              openAttachment={openAttachment}
              exportInvoicesCSV={exportInvoicesCSV}
              openConveraBatchPreview={openConveraBatchPreview}
              openIntuitBatchPreview={openIntuitBatchPreview}
              loadConveraBeneficiaries={loadConveraBeneficiaries}
              loadConveraLastPaymentDates={loadConveraLastPaymentDates}
              toggleCombinePayments={toggleCombinePayments}
              setSelectedInvoice={setSelectedInvoice}
              setShowInvoiceModal={setShowInvoiceModal}
              setShowConveraMatchingModal={setShowConveraMatchingModal}
              setShowManualInvoiceModal={setShowManualInvoiceModal}
              setShowQbExportModal={setShowQbExportModal}
              setQbExportSnapshot={setQbExportSnapshot}
              setQbExportSelectedIds={setQbExportSelectedIds}
            />
          )}

          {/* Timesheet Only Tab */}
          {accountantTab === 'timesheet-only' && (
            <TimesheetOnlyTab
              timesheets={timesheets}
              users={users}
              projects={projects}
              openTimesheetModal={openTimesheetModal}
              countryName={countryName}
            />
          )}

          {accountantTab === 'payments' && (() => {
            // Filter rows by batch + state.
            // matcher_ignore rows are pre-2026-06-20 historical transactions (already
            // reconciled by pre-launch scripts). Hidden by default; user opts in via toggle.
            let rows = converaTransactions;
            if (!showHistoricalTxns) rows = rows.filter(t => !t.matcherIgnore);
            if (selectedBatchId !== 'all') rows = rows.filter(t => t.importBatchId === selectedBatchId);
            // Effective state = staged edits applied over DB state; keeps filter pills
            // consistent with what the row's State column displays.
            const effStateOf = (t: ConveraTransaction): MatchState => {
              const staged = stagedMatches[t.id];
              if (staged === 'no_invoice') return 'no_invoice';
              if (Array.isArray(staged) && staged.length > 0) return 'matched';
              return t.matchState;
            };
            if (paymentsStateFilter === 'processed') {
              rows = rows.filter(t => { const s = effStateOf(t); return s === 'matched' || s === 'no_invoice'; });
            } else if (paymentsStateFilter !== 'all') {
              // Keep staged rows visible in their original pill even after the stage
              // pushes them into a different effective state — otherwise the accountant
              // stages a match and the row vanishes mid-workflow.
              rows = rows.filter(t => t.matchState === paymentsStateFilter || stagedMatches[t.id] !== undefined);
            }
            const historicalCount = converaTransactions.filter(t => t.matcherIgnore).length;

            // Set of invoice IDs already claimed by any convera_transaction — used to
            // downrank the dropdown so an already-claimed invoice appears last with a
            // "(already claimed)" badge instead of being offered as a fresh candidate.
            const claimedByOther = new Set<number>();
            for (const t of converaTransactions) {
              if (t.matchedInvoiceId) claimedByOther.add(t.matchedInvoiceId);
              for (const id of (t.matchedInvoiceIds || [])) claimedByOther.add(id);
            }

            // Candidate invoices for a transaction. Same-beneficiary is always shown;
            // "wider" cross-beneficiary matches (same amount, nearby pay_on_date) live
            // under an opt-in toggle since they're noise for the common case.
            const parseYMDLocal = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
            const candidatesFor = (t: ConveraTransaction): { same: Invoice[]; wider: Invoice[] } => {
              const samePool = new Map<number, Invoice>();
              const widerPool = new Map<number, Invoice>();

              // Same-beneficiary invoices
              if (t.converaBeneficiaryId) {
                const userIds = new Set(paymentProfiles.filter(p => p.converaBeneficiaryId === t.converaBeneficiaryId).map(p => p.userId));
                for (const inv of invoices) if (userIds.has(inv.userId)) samePool.set(inv.id, inv);
              }

              // Currently matched invoices (own claims) — always in same-pool
              const alreadyMatched = [
                ...(t.matchedInvoiceId ? [t.matchedInvoiceId] : []),
                ...(t.matchedInvoiceIds || []),
              ];
              for (const id of alreadyMatched) {
                if (samePool.has(id)) continue;
                const inv = invoices.find(i => i.id === id);
                if (inv) samePool.set(inv.id, inv);
              }

              // Wider fallback: any invoice with matching amount AND pay_on_date within ±30 days
              if (t.dateOfOrder && t.foreignAmount) {
                const txnMs = parseYMDLocal(t.dateOfOrder);
                for (const inv of invoices) {
                  if (samePool.has(inv.id)) continue;
                  if (!inv.payOnDate) continue;
                  if (Math.abs(parseYMDLocal(inv.payOnDate) - txnMs) / 86400000 > 30) continue;
                  if (Math.abs(inv.totalAmount - t.foreignAmount) < 0.02) {
                    widerPool.set(inv.id, inv);
                  }
                }
              }

              // Sort each bucket: fresh > claimed > paid, then newest period first.
              const sortFn = (a: Invoice, b: Invoice) => {
                const aOwn = alreadyMatched.includes(a.id);
                const bOwn = alreadyMatched.includes(b.id);
                const aClaimedRank = aOwn ? 0 : (claimedByOther.has(a.id) ? 1 : 0);
                const bClaimedRank = bOwn ? 0 : (claimedByOther.has(b.id) ? 1 : 0);
                const aPaidRank = a.status === 'paid' ? 1 : 0;
                const bPaidRank = b.status === 'paid' ? 1 : 0;
                if (aClaimedRank !== bClaimedRank) return aClaimedRank - bClaimedRank;
                if (aPaidRank !== bPaidRank) return aPaidRank - bPaidRank;
                return b.periodStart.localeCompare(a.periodStart);
              };

              return {
                same: [...samePool.values()].sort(sortFn),
                wider: [...widerPool.values()].sort(sortFn),
              };
            };

            // Contractor name(s) linked to this beneficiary — informational, shown even when no invoices exist
            const contractorsFor = (t: ConveraTransaction): string[] => {
              if (!t.converaBeneficiaryId) return [];
              const userIds = paymentProfiles.filter(p => p.converaBeneficiaryId === t.converaBeneficiaryId).map(p => p.userId);
              return [...new Set(userIds.map(uid => users.find(u => u.id === uid)?.name).filter(Boolean) as string[])];
            };

            // Effective selection: staged if present, else DB.
            // Prefer umbrella links (multi-invoice) over single matched_invoice_id if both exist.
            const effectiveMatch = (t: ConveraTransaction): number[] | 'no_invoice' | null => {
              if (stagedMatches[t.id] !== undefined) return stagedMatches[t.id];
              if (t.matchState === 'no_invoice') return 'no_invoice';
              if (t.matchedInvoiceIds?.length) return t.matchedInvoiceIds;
              if (t.matchedInvoiceId) return [t.matchedInvoiceId];
              return null;
            };

            // A row is editable if its batch is pending
            const batchOf = (bid: number | null) => bid ? importBatches.find(b => b.id === bid) : null;
            const isEditable = (t: ConveraTransaction): boolean => {
              const b = batchOf(t.importBatchId);
              return b?.state === 'pending' && t.matchState !== 'matched';
            };

            const sortedRows = [...rows].sort((a, b) => {
              const dir = paymentsSortDir === 'asc' ? 1 : -1;
              if (paymentsSortKey === 'date') return (a.dateOfOrder || '').localeCompare(b.dateOfOrder || '') * dir;
              if (paymentsSortKey === 'beneficiary') return (a.beneficiaryName || '').localeCompare(b.beneficiaryName || '') * dir;
              if (paymentsSortKey === 'amount') return ((a.foreignAmount ?? 0) - (b.foreignAmount ?? 0)) * dir;
              const rank = (c: MatchConfidence | null) => c === 'strong' ? 0 : c === 'weak' ? 1 : 2;
              return (rank(a.matchConfidence) - rank(b.matchConfidence)) * dir;
            });

            // Effective state = staged edits applied over DB state — same rule the row
            // renderer + filter use so pill counts always match the visible State column.
            const stateCounts = rows.reduce<Record<string, number>>((acc, t) => {
              acc[effStateOf(t)] = (acc[effStateOf(t)] || 0) + 1;
              return acc;
            }, {});

            const invById = (id: number | null) => id ? invoices.find(i => i.id === id) ?? null : null;

            const toggleSort = (k: typeof paymentsSortKey) => {
              if (paymentsSortKey === k) setPaymentsSortDir(paymentsSortDir === 'asc' ? 'desc' : 'asc');
              else { setPaymentsSortKey(k); setPaymentsSortDir('desc'); }
            };

            const sortArrow = (k: typeof paymentsSortKey) => paymentsSortKey === k ? (paymentsSortDir === 'asc' ? ' ↑' : ' ↓') : '';

            const stagedChangeCount = Object.keys(stagedMatches).length;

            return (
              <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-6 h-6" /> Contractor Payments</h2>
                    <p className="text-xs text-gray-500 mt-1">Convera transaction ledger — review, match, and process payments.</p>
                  </div>
                  <div className="flex gap-2 items-center">
                    <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm cursor-pointer">
                      <UploadCloud className="w-4 h-4" />
                      Import Convera XLS
                      <input
                        key={paymentsFileInputKey}
                        type="file"
                        accept=".xls,.xlsx"
                        className="hidden"
                        onChange={e => setPaymentsImportFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button
                      onClick={() => setShowIntuitImport(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm"
                    >
                      <UploadCloud className="w-4 h-4" />
                      Import Intuit Payments XLS
                    </button>
                  </div>
                </div>

                {paymentsImportFile && (
                  <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
                    <span className="text-sm text-indigo-900 flex items-center gap-2"><Paperclip className="w-4 h-4" /> {paymentsImportFile.name}</span>
                    <div className="flex gap-2">
                      <button onClick={() => { setPaymentsImportFile(null); setPaymentsImportError(''); }} className="text-xs px-3 py-1 text-gray-600 hover:text-gray-800">Cancel</button>
                      <button onClick={handlePaymentsImport} disabled={paymentsImporting} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">{paymentsImporting ? 'Importing…' : 'Import'}</button>
                    </div>
                  </div>
                )}
                {paymentsImportError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{paymentsImportError}</div>}

                {/* Post-import summary */}
                {paymentsImportSummary && (
                  <div className="mb-4 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-semibold text-indigo-900 text-sm">Import complete</div>
                      <button onClick={() => setPaymentsImportSummary(null)} className="text-indigo-500 hover:text-indigo-700 text-xs">✕</button>
                    </div>
                    <ul className="space-y-1 text-sm text-indigo-900">
                      {paymentsImportSummary.batchId !== null && (
                        <li>✅ <strong>{paymentsImportSummary.newCount}</strong> new row{paymentsImportSummary.newCount === 1 ? '' : 's'} added to batch #{paymentsImportSummary.batchId}</li>
                      )}
                      {paymentsImportSummary.batchId === null && paymentsImportSummary.newCount === 0 && (
                        <li className="text-indigo-700">ℹ️ No new rows in this file — no batch created</li>
                      )}
                      {paymentsImportSummary.refreshedCount > 0 && (
                        <li>🔄 <strong>{paymentsImportSummary.refreshedCount}</strong> row{paymentsImportSummary.refreshedCount === 1 ? '' : 's'} already existed as <em>unreviewed</em> — match data refreshed in place (kept in original batch)</li>
                      )}
                      {paymentsImportSummary.skippedCount > 0 && (
                        <li>⏭️ <strong>{paymentsImportSummary.skippedCount}</strong> row{paymentsImportSummary.skippedCount === 1 ? '' : 's'} already processed (matched / no-invoice / flagged) — skipped. Reopen their original batch to change them.</li>
                      )}
                      {paymentsImportSummary.intoHoldingSkipped > 0 && (
                        <li>💧 <strong>{paymentsImportSummary.intoHoldingSkipped}</strong> <em>Into Holding</em> row{paymentsImportSummary.intoHoldingSkipped === 1 ? '' : 's'} auto-ignored (Convera funds-purchase transfers, not vendor payments).</li>
                      )}
                      {paymentsImportSummary.amountChangedRows.length > 0 && (
                        <li className="text-amber-700">
                          ⚠️ <strong>{paymentsImportSummary.amountChangedRows.length}</strong> row{paymentsImportSummary.amountChangedRows.length === 1 ? '' : 's'} had a <strong>changed amount</strong> since last import:
                          <ul className="ml-6 mt-1 text-xs list-disc">
                            {paymentsImportSummary.amountChangedRows.slice(0, 8).map((c, i) => (
                              <li key={i}>{c.key.split('::')[0]} line {c.key.split('::')[1]}: ${c.oldAmount.toFixed(2)} → ${c.newAmount.toFixed(2)} ({c.state})</li>
                            ))}
                            {paymentsImportSummary.amountChangedRows.length > 8 && <li>… and {paymentsImportSummary.amountChangedRows.length - 8} more</li>}
                          </ul>
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Post-process summary */}
                {paymentsProcessResult && (
                  <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div className="font-semibold text-green-900 text-sm flex items-center gap-1.5"><CheckCircle className="w-4 h-4" /> Process complete</div>
                      <button onClick={() => setPaymentsProcessResult(null)} className="text-green-600 hover:text-green-800 text-xs">✕</button>
                    </div>
                    <ul className="space-y-1 text-sm text-green-900">
                      {paymentsProcessResult.matchedCount > 0 && (
                        <li>✅ <strong>{paymentsProcessResult.matchedCount}</strong> transaction{paymentsProcessResult.matchedCount === 1 ? '' : 's'} matched · <strong>{paymentsProcessResult.invoicesPaid}</strong> invoice{paymentsProcessResult.invoicesPaid === 1 ? '' : 's'} marked paid</li>
                      )}
                      {paymentsProcessResult.noInvoiceCount > 0 && (
                        <li>➖ <strong>{paymentsProcessResult.noInvoiceCount}</strong> transaction{paymentsProcessResult.noInvoiceCount === 1 ? '' : 's'} set to <em>no invoice</em></li>
                      )}
                      {paymentsProcessResult.batchFullyProcessed && (
                        <li className="text-green-700">🎉 Batch fully processed — moved to processed state.</li>
                      )}
                      {!paymentsProcessResult.batchFullyProcessed && selectedBatchId !== 'all' && (
                        <li className="text-green-700">Batch stays <em>pending</em> — unreviewed rows remain. Use the state filter pills to see what's left.</li>
                      )}
                    </ul>
                  </div>
                )}

                {/* Batch selector */}
                <div className="mb-3 flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs font-semibold text-gray-500 mr-1">Batch:</span>
                  <button onClick={() => setSelectedBatchId('all')} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${selectedBatchId === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>All ({showHistoricalTxns ? converaTransactions.length : converaTransactions.filter(t => !t.matcherIgnore).length})</button>
                  {importBatches
                    .filter(b => showHistoricalTxns || converaTransactions.some(t => t.importBatchId === b.id && !t.matcherIgnore))
                    .map(b => {
                    const stateBadge = b.state === 'pending' ? 'bg-yellow-100 text-yellow-700' : b.state === 'processed' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600';
                    return (
                      <button key={b.id} onClick={() => setSelectedBatchId(b.id)} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${selectedBatchId === b.id ? 'ring-2 ring-indigo-400 bg-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
                        <span>#{b.id}</span>
                        <span className="text-gray-500 max-w-[180px] truncate">{b.sourceFilename || b.source}</span>
                        <span className={`px-1.5 py-0.5 rounded ${stateBadge}`}>{b.state}</span>
                        <span className="text-gray-400">·  {b.rowCount}</span>
                      </button>
                    );
                  })}
                  {historicalCount > 0 && (
                    <button
                      onClick={() => setShowHistoricalTxns(v => !v)}
                      className={`ml-2 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${showHistoricalTxns ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}
                      title="Pre-2026-06-20 transactions from the Submitted->Paid legacy workflow; fenced off from the matcher"
                    >
                      {showHistoricalTxns ? 'Hide' : 'Show'} historical ({historicalCount})
                    </button>
                  )}
                </div>

                {/* Batch action buttons — only when a specific batch is selected */}
                {selectedBatchId !== 'all' && (() => {
                  const b = importBatches.find(x => x.id === selectedBatchId);
                  if (!b) return null;
                  return (
                    <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-slate-700">
                        <strong>Batch #{b.id}</strong> · {b.sourceFilename || b.source} · imported {b.importedAt.slice(0, 10)}{b.importedBy ? ` by ${b.importedBy}` : ''} · <span className="font-semibold">{b.state}</span>
                      </div>
                      <div className="flex gap-2">
                        {b.state === 'processed' && (
                          <button onClick={() => handleReopenBatch(b.id)} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 font-medium border border-amber-200">Reopen batch</button>
                        )}
                        {b.state === 'pending' && (() => {
                          const autoMatchable = converaTransactions.filter(t =>
                            t.importBatchId === b.id &&
                            t.matchState === 'unreviewed' &&
                            stagedMatches[t.id] === undefined &&
                            ((t.matchedInvoiceIds?.length ?? 0) > 0 || t.matchedInvoiceId != null)
                          );
                          const count = autoMatchable.length;
                          return (
                            <button
                              onClick={() => {
                                setStagedMatches(prev => {
                                  const next = { ...prev };
                                  for (const t of autoMatchable) {
                                    const ids = t.matchedInvoiceIds?.length
                                      ? t.matchedInvoiceIds
                                      : (t.matchedInvoiceId ? [t.matchedInvoiceId] : []);
                                    if (ids.length) next[t.id] = ids;
                                  }
                                  return next;
                                });
                              }}
                              disabled={count === 0}
                              className={`px-3 py-1 text-xs rounded font-medium border ${count > 0 ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-indigo-200' : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}`}
                              title={count > 0 ? `Stage ${count} auto-matched row${count === 1 ? '' : 's'} for processing. Rows without an auto-match still need manual review.` : 'No unreviewed rows with auto-matches available'}
                            >Accept auto-matches ({count})</button>
                          );
                        })()}
                        {b.state === 'pending' && (
                          <button onClick={() => handleRollbackBatch(b.id)} className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 font-medium border border-red-200">Rollback & Delete</button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* State filter pills — grouped by lifecycle stage (Pending · Processed · Issues) */}
                {(() => {
                  const pillClass = (key: typeof paymentsStateFilter, color: string) =>
                    `px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${paymentsStateFilter === key ? 'ring-2 ring-indigo-400 ' + color : color + ' hover:opacity-80'}`;
                  const groupLabel = <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-0.5">&nbsp;</span>;
                  const divider = <div className="h-6 w-px bg-gray-300 self-end mb-1.5" aria-hidden="true" />;
                  return (
                    <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-2">
                      <span className="text-xs font-semibold text-gray-500 mr-1 self-end mb-1.5">Show:</span>
                      <div className="flex flex-col items-start">
                        {groupLabel}
                        <button onClick={() => setPaymentsStateFilter('all')} className={pillClass('all', 'bg-gray-100 text-gray-700')}>All ({rows.length})</button>
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-0.5 pl-2">Pending</span>
                        <button onClick={() => setPaymentsStateFilter('unreviewed')} className={pillClass('unreviewed', 'bg-yellow-100 text-yellow-700')}>Unreviewed ({stateCounts.unreviewed || 0})</button>
                      </div>
                      {divider}
                      <div className="flex flex-col items-start">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-0.5 pl-2">Processed</span>
                        <div className="flex gap-1.5">
                          <button onClick={() => setPaymentsStateFilter('matched')} className={pillClass('matched', 'bg-green-100 text-green-700')}>Matched ({stateCounts.matched || 0})</button>
                          <button onClick={() => setPaymentsStateFilter('no_invoice')} className={pillClass('no_invoice', 'bg-gray-100 text-gray-700')}>No invoice ({stateCounts.no_invoice || 0})</button>
                        </div>
                      </div>
                      {divider}
                      <div className="flex flex-col items-start">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-0.5 pl-2">Issues</span>
                        <button onClick={() => setPaymentsStateFilter('flagged')} className={pillClass('flagged', 'bg-red-100 text-red-700')}>Flagged ({stateCounts.flagged || 0})</button>
                      </div>
                    </div>
                  );
                })()}

                {/* Table */}
                {sortedRows.length === 0 ? (
                  <div className="p-12 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                    <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">No transactions in this view</p>
                    <p className="text-xs mt-1">Import a Convera XLS to add transactions to the ledger</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <SortableHeader onClick={() => toggleSort('date')}        className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap" indicator={sortArrow('date')}>Date</SortableHeader>
                          <SortableHeader onClick={() => toggleSort('beneficiary')} className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap" indicator={sortArrow('beneficiary')}>Beneficiary</SortableHeader>
                          <SortableHeader onClick={() => toggleSort('amount')}      className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap" align="right" indicator={sortArrow('amount')}>Amount</SortableHeader>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Ref</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600 min-w-[220px]">Match</th>
                          <SortableHeader onClick={() => toggleSort('confidence')}  className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap" align="center" indicator={sortArrow('confidence')}>Confidence</SortableHeader>
                          <th className="px-3 py-2 text-center font-medium text-gray-600">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map(t => {
                          const dbState  = t.matchState;
                          const editable = isEditable(t);
                          const effMatch = effectiveMatch(t);
                          const staged   = stagedMatches[t.id] !== undefined;

                          // Effective color reflects staged edits when present
                          const effState: MatchState =
                            effMatch === 'no_invoice' ? 'no_invoice' :
                            Array.isArray(effMatch) && effMatch.length > 0 ? 'matched' :
                            dbState;

                          const conf = t.matchConfidence;
                          const bg = effState === 'matched'    ? 'bg-green-50'  :
                                     effState === 'no_invoice' ? 'bg-gray-50'   :
                                     effState === 'flagged'    ? 'bg-red-50'    :
                                     conf === 'strong'         ? 'bg-green-50'  :
                                     conf === 'weak'           ? 'bg-yellow-50' :
                                     'bg-white';

                          const cands = candidatesFor(t);
                          const contractors = contractorsFor(t);
                          const selectedIds = Array.isArray(effMatch) ? effMatch : [];
                          const selectedInvs = selectedIds.map(id => invById(id)).filter(Boolean) as Invoice[];

                          // Current staged/effective invoice id list — helper for chip mutations
                          const currentIdsFor = (): number[] => {
                            const s = stagedMatches[t.id];
                            if (Array.isArray(s)) return s;
                            if (s === 'no_invoice') return [];
                            return Array.isArray(effMatch) ? effMatch : [];
                          };

                          // Stacked-chip delta: helps accountant see whether picked invoices sum to the payment.
                          // Small deltas (≤ $50) are typically per-wire fees Convera passes through — treated as OK.
                          const selectedSum = selectedInvs.reduce((s, inv) => s + inv.totalAmount, 0);
                          const payAmount = t.foreignAmount ?? 0;
                          const delta = selectedSum - payAmount;
                          const deltaAbs = Math.abs(delta);
                          const deltaOk = deltaAbs <= 50;
                          const showDelta = selectedInvs.length > 0;
                          const fmt$ = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                          // Match cell content
                          const matchCell = editable ? (
                            effMatch === 'no_invoice' ? (
                              <div className={`flex items-center gap-2 ${staged ? 'ring-1 ring-indigo-200 rounded p-1' : ''}`}>
                                <span className="text-xs text-gray-600 italic">— No invoice (leave in ledger) —</span>
                                <button
                                  onClick={() => setStagedMatches(prev => { const next = { ...prev }; delete next[t.id]; return next; })}
                                  className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                                >Undo</button>
                              </div>
                            ) : (
                              <div className={`space-y-1 ${staged ? 'ring-1 ring-indigo-200 rounded p-1' : ''}`}>
                                {selectedInvs.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {selectedInvs.map(inv => (
                                      <span
                                        key={inv.id}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${inv.status === 'paid' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800'}`}
                                        title={`${inv.userName} · ${inv.invoiceNumber} · ${inv.periodStart.slice(0,7)} · $${inv.totalAmount.toLocaleString()}${inv.status === 'paid' ? ' · already paid' : ''}`}
                                      >
                                        {inv.userName} · {inv.invoiceNumber} · ${inv.totalAmount.toLocaleString()}{inv.status === 'paid' ? ' (paid)' : ''}
                                        <button
                                          onClick={() => {
                                            setStagedMatches(prev => {
                                              const nextIds = currentIdsFor().filter(id => id !== inv.id);
                                              const next = { ...prev };
                                              if (nextIds.length === 0) delete next[t.id];
                                              else next[t.id] = nextIds;
                                              return next;
                                            });
                                          }}
                                          className="hover:text-red-700 font-bold leading-none"
                                          title="Remove this invoice from the match"
                                        >×</button>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {showDelta && (
                                  <div className={`text-xs px-2 py-0.5 rounded inline-flex items-center gap-1.5 ${deltaOk ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                    <span>Selected <strong>${fmt$(selectedSum)}</strong> vs Payment <strong>${fmt$(payAmount)}</strong></span>
                                    <span className="opacity-80">·</span>
                                    <span>
                                      {delta === 0 ? 'exact match'
                                        : delta > 0 ? `over by $${fmt$(deltaAbs)}${deltaOk ? ' (within fee tolerance)' : ''}`
                                        : `short by $${fmt$(deltaAbs)}${deltaOk ? ' (likely wire fee)' : ''}`}
                                    </span>
                                  </div>
                                )}
                                <div className="flex items-center gap-3 relative">
                                  {(() => {
                                    const sameAvailable  = cands.same.filter(inv => !selectedIds.includes(inv.id));
                                    const widerAvailable = cands.wider.filter(inv => !selectedIds.includes(inv.id));
                                    const alreadyMatchedForRow = new Set<number>([
                                      ...(t.matchedInvoiceId ? [t.matchedInvoiceId] : []),
                                      ...(t.matchedInvoiceIds || []),
                                    ]);
                                    if (sameAvailable.length === 0 && widerAvailable.length === 0 && selectedIds.length === 0) {
                                      if (contractors.length > 0) return <span className="text-xs text-gray-500 italic">Beneficiary → {contractors.join(', ')} (no invoices yet)</span>;
                                      return <span className="text-xs text-gray-500 italic">No candidates — beneficiary unresolved</span>;
                                    }
                                    if (sameAvailable.length === 0 && widerAvailable.length === 0) return null;
                                    const showWider = !!showWiderForTxn[t.id];
                                    const renderInv = (inv: Invoice, wider = false) => {
                                      const isClaimed = !alreadyMatchedForRow.has(inv.id) && claimedByOther.has(inv.id);
                                      const labels: string[] = [inv.status];
                                      if (isClaimed) labels.push('already claimed');
                                      return (
                                        <button
                                          key={inv.id}
                                          onClick={() => {
                                            setStagedMatches(prev => ({ ...prev, [t.id]: [...currentIdsFor(), inv.id] }));
                                            setAddInvoicePickerFor(null);
                                          }}
                                          className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-indigo-50 ${isClaimed ? 'bg-amber-50' : ''} ${wider ? 'text-gray-500' : ''}`}
                                        >
                                          {inv.userName} · {inv.invoiceNumber} · {inv.periodStart.slice(0,7)} · ${inv.totalAmount.toLocaleString()} ({labels.join(' · ')})
                                        </button>
                                      );
                                    };
                                    const q = addInvoicePickerSearch.trim().toLowerCase();
                                    const matchesQ = (inv: Invoice) =>
                                      !q
                                      || inv.userName.toLowerCase().includes(q)
                                      || inv.invoiceNumber.toLowerCase().includes(q)
                                      || String(inv.totalAmount).includes(q);
                                    const sameFiltered  = sameAvailable.filter(matchesQ);
                                    const widerFiltered = widerAvailable.filter(matchesQ);
                                    return (
                                      <>
                                        <button
                                          onClick={() => {
                                            const opening = addInvoicePickerFor !== t.id;
                                            setAddInvoicePickerFor(opening ? t.id : null);
                                            if (opening) setAddInvoicePickerSearch('');
                                          }}
                                          className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                                        >
                                          + Add invoice ▾
                                        </button>
                                        {addInvoicePickerFor === t.id && (
                                          <div className="absolute left-0 top-6 z-20 bg-white border border-gray-300 rounded shadow-lg max-h-72 overflow-hidden min-w-[340px] flex flex-col">
                                            {(sameAvailable.length + widerAvailable.length) > 8 && (
                                              <input
                                                type="text"
                                                autoFocus
                                                value={addInvoicePickerSearch}
                                                onChange={e => setAddInvoicePickerSearch(e.target.value)}
                                                placeholder="Search name, invoice #, or amount…"
                                                className="w-full px-2.5 py-1.5 text-xs border-b border-gray-200 focus:outline-none focus:bg-indigo-50 placeholder:text-gray-400"
                                              />
                                            )}
                                            <div className="overflow-y-auto">
                                              {sameFiltered.map(inv => renderInv(inv))}
                                              {sameFiltered.length === 0 && sameAvailable.length > 0 && (
                                                <div className="px-3 py-1.5 text-xs italic text-gray-500">No same-beneficiary matches for "{addInvoicePickerSearch}".</div>
                                              )}
                                              {sameAvailable.length === 0 && !showWider && widerAvailable.length > 0 && (
                                                <div className="px-3 py-1.5 text-xs italic text-gray-500">No same-beneficiary candidates.</div>
                                              )}
                                              {widerAvailable.length > 0 && (
                                                <>
                                                  {!showWider ? (
                                                    <button
                                                      onClick={(e) => { e.stopPropagation(); setShowWiderForTxn(prev => ({ ...prev, [t.id]: true })); }}
                                                      className="block w-full text-left px-3 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50 border-t border-gray-200"
                                                    >
                                                      Show wider matches ({widerFiltered.length}{q ? ` filtered / ${widerAvailable.length}` : ''})
                                                    </button>
                                                  ) : (
                                                    <>
                                                      <div className="px-3 py-1 text-[10px] uppercase tracking-wider font-semibold text-gray-400 border-t border-gray-200 bg-gray-50">Wider matches (other beneficiaries)</div>
                                                      {widerFiltered.map(inv => renderInv(inv, true))}
                                                      {widerFiltered.length === 0 && widerAvailable.length > 0 && (
                                                        <div className="px-3 py-1.5 text-xs italic text-gray-500">No wider matches for "{addInvoicePickerSearch}".</div>
                                                      )}
                                                    </>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </>
                                    );
                                  })()}
                                  <button
                                    onClick={() => setStagedMatches(prev => ({ ...prev, [t.id]: 'no_invoice' }))}
                                    className="text-xs text-gray-500 hover:text-gray-700 ml-auto"
                                    title="Leave this transaction in the ledger without a matched invoice"
                                  >No invoice</button>
                                </div>
                              </div>
                            )
                          ) : (
                            selectedInvs.length > 0
                              ? (
                                <div className="flex flex-wrap gap-1">
                                  {selectedInvs.map(inv => (
                                    <span key={inv.id} className="inline-flex px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                                      {inv.userName} · {inv.invoiceNumber}
                                    </span>
                                  ))}
                                </div>
                              )
                              : dbState === 'no_invoice' ? <span className="text-xs text-gray-500 italic">No invoice</span>
                              : <span className="text-gray-400">—</span>
                          );

                          return (
                            <tr key={t.id} className={`${bg} border-t border-gray-100 transition-all ${staged ? 'ring-1 ring-inset ring-indigo-300' : ''}`}>
                              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{t.dateOfOrder}</td>
                              <td className="px-3 py-2 text-gray-800">{t.beneficiaryName}</td>
                              <td className="px-3 py-2 text-right font-medium text-gray-800 whitespace-nowrap">${(t.foreignAmount ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                              <td className="px-3 py-2 text-gray-600 font-mono text-xs">{t.ref1 || '—'}</td>
                              <td className="px-3 py-2 text-gray-800 min-w-[240px]">
                                {matchCell}
                                <textarea
                                  value={notesDrafts[t.id] !== undefined ? notesDrafts[t.id] : (t.notes || '')}
                                  onChange={e => setNotesDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                                  onBlur={async () => {
                                    const draft = notesDrafts[t.id];
                                    if (draft === undefined) return;
                                    const trimmed = draft.trim();
                                    const nextValue = trimmed || null;
                                    if (nextValue === (t.notes || null)) {
                                      setNotesDrafts(prev => { const n = { ...prev }; delete n[t.id]; return n; });
                                      return;
                                    }
                                    const { error } = await supabase
                                      .from('convera_transactions')
                                      .update({ notes: nextValue })
                                      .eq('id', t.id);
                                    if (error) { alert(`Failed to save note: ${error.message}`); return; }
                                    setConveraTransactions(prev => prev.map(x => x.id === t.id ? { ...x, notes: nextValue } : x));
                                    setNotesDrafts(prev => { const n = { ...prev }; delete n[t.id]; return n; });
                                  }}
                                  placeholder="Note (optional) — saves on blur"
                                  rows={1}
                                  className="mt-1.5 w-full text-xs px-2 py-1 border border-gray-200 rounded resize-y focus:ring-1 focus:ring-indigo-400 focus:border-indigo-300 text-gray-700 placeholder:text-gray-400"
                                />
                              </td>
                              <td className="px-3 py-2 text-center">
                                {conf === 'strong' && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">strong</span>}
                                {conf === 'weak'   && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">weak</span>}
                                {!conf             && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">—</span>}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={'px-2 py-0.5 rounded-full text-xs font-medium ' + (
                                  effState === 'matched'    ? 'bg-green-100 text-green-800' :
                                  effState === 'no_invoice' ? 'bg-gray-200 text-gray-700'   :
                                  effState === 'flagged'    ? 'bg-red-100 text-red-800'     :
                                  'bg-yellow-100 text-yellow-800'
                                )}>{effState.replace('_', ' ')}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Sticky bottom bar — Process action (only when there are staged changes) */}
                {stagedChangeCount > 0 && (
                  <div className="sticky bottom-0 mt-4 -mx-3 sm:-mx-6 px-3 sm:px-6 py-3 bg-white border-t-2 border-indigo-200 shadow-lg flex items-center justify-between">
                    <span className="text-sm text-gray-700"><strong>{stagedChangeCount}</strong> staged change{stagedChangeCount > 1 ? 's' : ''}</span>
                    <div className="flex gap-2">
                      <button onClick={() => setStagedMatches({})} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Discard</button>
                      <button onClick={() => setShowProcessPreview(true)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Process</button>
                    </div>
                  </div>
                )}

                {/* Process preview modal */}
                {showProcessPreview && (() => {
                  const stagedIds = Object.keys(stagedMatches).map(Number);
                  const previewMatched: { t: ConveraTransaction; invIds: number[] }[] = [];
                  const previewNoInvoice: ConveraTransaction[] = [];
                  for (const tid of stagedIds) {
                    const t = converaTransactions.find(x => x.id === tid);
                    if (!t) continue;
                    const s = stagedMatches[tid];
                    if (s === 'no_invoice') previewNoInvoice.push(t);
                    else if (Array.isArray(s) && s.length > 0) previewMatched.push({ t, invIds: s });
                  }
                  const invById2 = (id: number) => invoices.find(i => i.id === id);
                  const alreadyPaidWarnings = previewMatched.flatMap(({ t, invIds }) =>
                    invIds
                      .map(id => invById2(id))
                      .filter((inv): inv is Invoice => !!inv && inv.status === 'paid')
                      .map(inv => ({ txn: t, inv }))
                  );

                  return (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowProcessPreview(false)}>
                      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-gray-200">
                          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Confirm Process</h3>
                          <p className="text-sm text-gray-600 mt-1">Review before committing. This will mark invoices paid and update the transaction ledger.</p>
                        </div>
                        <div className="p-6 space-y-4">
                          <div className="grid grid-cols-3 gap-3">
                            <div className="p-3 bg-green-50 border border-green-200 rounded"><div className="text-xs text-green-600">Invoices to mark paid</div><div className="text-2xl font-bold text-green-800">{new Set(previewMatched.flatMap(p => p.invIds)).size}</div></div>
                            <div className="p-3 bg-gray-50 border border-gray-200 rounded"><div className="text-xs text-gray-600">Rows → No invoice</div><div className="text-2xl font-bold text-gray-800">{previewNoInvoice.length}</div></div>
                            <div className="p-3 bg-indigo-50 border border-indigo-200 rounded"><div className="text-xs text-indigo-600">Total transactions</div><div className="text-2xl font-bold text-indigo-800">{stagedIds.length}</div></div>
                          </div>

                          {alreadyPaidWarnings.length > 0 && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                              <div className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> {alreadyPaidWarnings.length} invoice(s) already have paid_date set:</div>
                              <ul className="ml-5 list-disc text-xs space-y-1">
                                {alreadyPaidWarnings.map(({ inv }, i) => <li key={i}>{inv.userName} · {inv.invoiceNumber} · paid {inv.paidDate}</li>)}
                              </ul>
                              <div className="mt-2 text-xs">Confirm will overwrite their paid_date with this transaction's date.</div>
                            </div>
                          )}

                          {previewMatched.length > 0 && (
                            <div>
                              <div className="text-xs font-semibold text-gray-500 mb-2">MATCHES</div>
                              <div className="border border-gray-200 rounded max-h-64 overflow-auto">
                                <table className="w-full text-xs">
                                  <tbody>
                                    {previewMatched.map(({ t, invIds }) => (
                                      <tr key={t.id} className="border-b border-gray-100">
                                        <td className="px-2 py-1.5 text-gray-500">{t.dateOfOrder}</td>
                                        <td className="px-2 py-1.5">{t.beneficiaryName}</td>
                                        <td className="px-2 py-1.5 text-right font-medium">${(t.foreignAmount ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                                        <td className="px-2 py-1.5 text-gray-700">→ {invIds.map(id => { const inv = invById2(id); return inv ? `${inv.userName}·${inv.invoiceNumber}` : `#${id}`; }).join(' + ')}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="p-6 border-t border-gray-200 flex justify-end gap-2">
                          <button
                            onClick={() => setShowProcessPreview(false)}
                            disabled={processCommitting}
                            className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          >Cancel</button>
                          <button
                            onClick={handleProcess}
                            disabled={processCommitting}
                            className={`px-6 py-2 rounded-lg font-medium text-white ${processCommitting ? 'bg-indigo-400 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                          >
                            {processCommitting ? (
                              <span className="inline-flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                                </svg>
                                Processing…
                              </span>
                            ) : 'Confirm & Process'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {accountantTab === 'qb-automation' && (() => {
            // Read-only Inbox — Slice C of QB Automation Layer.
            // Groups qb_ingest_events by target_qb_txn_kind. Nothing pushes to QB yet;
            // that arrives with Slice F (preview modal) and Slice G (real enqueue).
            const sourceLabel = (s: string) => ({ intuit_xlsx: 'Intuit', convera: 'Convera', manual: 'Manual', invoice_g75: 'Invoice → Bill (Intuit)', invoice_g76: 'Invoice → Bill (Convera)' }[s] || s);
            // Thousands separator + 2dp everywhere in this tab.
            const fmtMoney = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            // Reconciler bill lookup by TxnID for the "Resolved" column (replaces the
            // legacy matched_invoice_ids display, which over-matched by amount alone).
            const billByTxnId = new Map(qbOpenBills.map(b => [b.txnId, b]));
            const isPreOur = (e: QbIngestEvent) => e.resolvedAction === 'pre_our_system';

            // "Missing QB bills" audit — approved invoices in our system that have
            // no matching Bill in qb_mirror. Read-only visibility so Dan can see the
            // total pending QB work per contractor, not just Intuit payment events.
            // Matches invoice.paymentProfile.qbVendorName → vendor listId → any
            // bill in qbOpenBills with normalizeRef(refNumber) === normalizeRef(invoice_number).
            //
            // The invoice.paymentProfile is a JSONB snapshot at invoice creation, so
            // qbVendorName can be stale if the accountant added it to the profile after
            // the invoice was created. resolveInvoiceQbVendorName walks the pp-scoped
            // chain (snap → live pps[snap_pp_id] → user-default only if no snap_pp_id).
            // liveVendorNameByUserId is retained ONLY for the group-vendor fallback
            // below (multi-member umbrella groups); the per-invoice fallback uses
            // the primitive.
            const vendorByName = new Map(qbVendorsList.map(v => [v.name, v]));
            const resolverPps: ResolverPaymentProfile[] = paymentProfiles.map(p => ({
              id: p.id, userId: p.userId, qbVendorName: p.qbVendorName, companyName: p.companyName, isDefault: p.isDefault,
            }));
            const liveVendorNameByUserId = new Map<string, string>();
            for (const pp of paymentProfiles) {
              const name = pp.qbVendorName?.trim();
              if (!name) continue;
              if (!liveVendorNameByUserId.has(pp.userId) || pp.isDefault) {
                liveVendorNameByUserId.set(pp.userId, name);
              }
            }
            // Slice 3: needs-vendor-decision set. Approved Intuit/Convera
            // invoices whose snap payment_profile has no QB vendor mapping AND
            // the contractor's other pps don't unambiguously agree on one.
            // These invoices are filtered OUT of the Missing QB Bills panel
            // and the Push modal, and rendered in their own bucket instead
            // so the accountant can resolve first. Marta-friendly cases don't
            // land here (they auto-resolve at approval time via Slice 1).
            const needsVendorDecisionByInvoiceId = new Map<number, { snapCompany: string | null; conflictNames?: string[]; targetPaymentProfileId: number | null }>();
            for (const inv of invoices) {
              // Include paid invoices too — a Convera-matched invoice flips to
              // 'paid' but its QB Bill may still not exist (only IIF-exported
              // BillPayments push today). See Missing QB Bills panel below.
              if (inv.status !== 'approved' && inv.status !== 'paid') continue;
              // Skip pre-our-system legacy invoices — matcher_ignore=true means
              // the invoice pre-dates the pipeline (paid via IIF, never in QB
              // qbXML flow). Surfacing them creates noise.
              if (inv.matcherIgnore) continue;
              if (inv.qbBillTxnId) continue;
              const pm = paymentMethod(inv);
              if (!['Intuit', 'Convera'].includes(pm)) continue;
              const cutoff = pm === 'Convera' ? CONVERA_PRE_OUR_SYSTEM_CUTOFF : INTUIT_PRE_OUR_SYSTEM_CUTOFF;
              if ((inv.periodEnd || '') < cutoff) continue;
              const userPps: ResolverPaymentProfile[] = paymentProfiles
                .filter(p => p.userId === inv.userId)
                .map(p => ({ id: p.id, userId: p.userId, qbVendorName: p.qbVendorName, companyName: p.companyName, isDefault: p.isDefault }));
              const snap = inv.paymentProfile ?? null;
              const rawSnapId = snap && typeof (snap as { id?: unknown }).id !== 'undefined' ? (snap as { id?: unknown }).id : null;
              const snapPpId = typeof rawSnapId === 'number' && rawSnapId > 0
                ? rawSnapId
                : (typeof rawSnapId === 'string' && /^\d+$/.test(rawSnapId) && Number(rawSnapId) > 0 ? Number(rawSnapId) : null);
              const result = resolveNewProfileVendor(
                { snapPaymentProfileId: snapPpId, snapQbVendorName: snap?.qbVendorName ?? null, userId: inv.userId },
                userPps,
              );
              if (result.mode === 'ambiguous') {
                needsVendorDecisionByInvoiceId.set(inv.id, {
                  snapCompany: result.snapCompany,
                  conflictNames: result.conflictNames,
                  targetPaymentProfileId: result.targetPaymentProfileId,
                });
              }
            }
            // G7.6 group_key resolution: for umbrella members whose own
            // snapshot+live payment_profile both lack qb_vendor_name (Iskra
            // Kochova / Teal), inherit the vendor from any sibling that DOES
            // resolve. Same primitive the modal + consumer use. Without this,
            // this panel would show umbrella orphans as "⚠ unmapped" even
            // though they're pushable via the group.
            const groupVendorByKey = new Map<string, string>();
            const groupMembersByKey = new Map<string, Invoice[]>();
            for (const inv of invoices) {
              if (!inv.groupKey) continue;
              const arr = groupMembersByKey.get(inv.groupKey) ?? [];
              arr.push(inv);
              groupMembersByKey.set(inv.groupKey, arr);
            }
            for (const [key, members] of groupMembersByKey) {
              const candidates = new Set<string>();
              for (const m of members) {
                const s = m.paymentProfile?.qbVendorName?.trim();
                if (s) candidates.add(s);
              }
              if (candidates.size === 0) {
                for (const m of members) {
                  const l = liveVendorNameByUserId.get(m.userId);
                  if (l) candidates.add(l);
                }
              }
              if (candidates.size === 1) groupVendorByKey.set(key, [...candidates][0]);
            }
            type MissingBill = {
              invoice: Invoice;
              paymentPath: string;
              qbVendorName: string | null;
              vendorMapped: boolean;
            };
            const missingBills: MissingBill[] = invoices
              // Include 'paid' too: Convera match flips invoice to 'paid' but
              // the QB Bill may still not exist (Convera BillPayments push via
              // IIF export today, not qb_ingest_events). Without this, paid-
              // but-no-Bill-in-QB invoices become invisible.
              .filter(inv => inv.status === 'approved' || inv.status === 'paid')
              // Exclude pre-our-system legacy invoices — matcher_ignore=true.
              .filter(inv => !inv.matcherIgnore)
              // Cutoff differs by payment path: Intuit June 2026+, Convera April 2026+.
              // Unassigned falls back to Intuit's cutoff (stricter) so unclassified
              // rows aren't over-surfaced.
              .filter(inv => {
                const pm = paymentMethod(inv);
                const cutoff = pm === 'Convera' ? CONVERA_PRE_OUR_SYSTEM_CUTOFF : INTUIT_PRE_OUR_SYSTEM_CUTOFF;
                return (inv.periodEnd || '') >= cutoff;
              })
              // G7.5 fix (2026-08-26): if invoices.qb_bill_txn_id is already set,
              // we've recorded the QB Bill from our own push response — instant
              // "has bill" without waiting for qb_mirror to refresh. Prevents just-
              // pushed invoices from re-appearing until the next bill_query drains.
              .filter(inv => !inv.qbBillTxnId)
              // Slice 3: skip invoices that need a vendor decision first — they
              // render in their own bucket, not as "missing bills".
              .filter(inv => !needsVendorDecisionByInvoiceId.has(inv.id))
              .map((inv): MissingBill | null => {
                const resolved = resolveInvoiceQbVendorName(
                  { snapPaymentProfileId: extractSnapPpId(inv.paymentProfile), snapQbVendorName: inv.paymentProfile?.qbVendorName ?? null, userId: inv.userId },
                  resolverPps,
                );
                const groupName = inv.groupKey ? (groupVendorByKey.get(inv.groupKey) ?? null) : null;
                const qbVendorName = resolved ?? groupName;
                const vendor = qbVendorName ? vendorByName.get(qbVendorName) : undefined;
                const vendorListId = vendor?.listId ?? null;
                const invRef = normalizeRef(inv.invoiceNumber);
                // Period-scope the match: same (vendor, refNumber) but a different
                // yyyy-mm is NOT the same bill. Croatian contractors reset invoice
                // numbers annually — "INV 12" for 2026-07 collides with "Inv# 12"
                // from 2023-12 (Yara Solutions Inc.), silently hiding legitimate
                // unpushed invoices from this panel (2026-08-27).
                const invMonth = (inv.periodEnd ?? '').slice(0, 7);
                const hasBill = vendorListId != null && invRef !== '' && invMonth !== '' && qbOpenBills.some(b => {
                  if (b.vendorListId !== vendorListId) return false;
                  if (normalizeRef(b.refNumber) !== invRef) return false;
                  const bMonth = (b.txnDate ?? '').slice(0, 7);
                  return bMonth === invMonth;
                });
                if (hasBill) return null;
                return {
                  invoice: inv,
                  paymentPath: paymentMethod(inv) || 'Unassigned',
                  qbVendorName,
                  vendorMapped: vendorListId != null,
                };
              })
              .filter((x): x is MissingBill => x !== null)
              // Sort Intuit first (fewer rows, more critical — bill gets created at
              // next payment push, no batch script involved), then by period, contractor.
              .sort((a, b) => {
                const pathOrder = (p: string) => p === 'Intuit' ? 0 : p === 'Convera' ? 1 : 2;
                const p = pathOrder(a.paymentPath) - pathOrder(b.paymentPath);
                if (p !== 0) return p;
                const d = (a.invoice.periodEnd || '').localeCompare(b.invoice.periodEnd || '');
                if (d !== 0) return d;
                return (a.invoice.userName || '').localeCompare(b.invoice.userName || '');
              });
            // Section color palette — semantic per bucket. Same colors used
            // for border + header bg + hover so the tab reads at a glance.
            const sectionColors: Record<string, { border: string; head: string; hover: string; title: string }> = {
              pending:          { border: 'border-amber-200',  head: 'bg-amber-50',   hover: 'hover:bg-amber-100/60',   title: 'text-amber-900' },
              bill_pmt:         { border: 'border-sky-200',    head: 'bg-sky-50',     hover: 'hover:bg-sky-100/60',     title: 'text-sky-900' },
              already_done:     { border: 'border-yellow-200', head: 'bg-yellow-50',  hover: 'hover:bg-yellow-100/60',  title: 'text-yellow-900' },
              bill_add_and_pmt: { border: 'border-violet-200', head: 'bg-violet-50',  hover: 'hover:bg-violet-100/60',  title: 'text-violet-900' },
              check:            { border: 'border-indigo-200', head: 'bg-indigo-50',  hover: 'hover:bg-indigo-100/60',  title: 'text-indigo-900' },
              ignore:           { border: 'border-gray-200',   head: 'bg-gray-50',    hover: 'hover:bg-gray-100/60',    title: 'text-gray-700' },
              ignore_backfill:  { border: 'border-gray-100',   head: 'bg-gray-50/60', hover: 'hover:bg-gray-100/40',    title: 'text-gray-500' },
              posted:           { border: 'border-emerald-200',head: 'bg-emerald-50', hover: 'hover:bg-emerald-100/60', title: 'text-emerald-900' },
            };
            // Bucket by reconciler-decided reality (resolvedAction) when set,
            // else fall back to classifier target. Splits by whether the QB bill
            // ACTUALLY exists — matches Dan's "check bill exists → route
            // accordingly" model. Events with matched invoices whose QB bills
            // haven't been created yet fall into Create Bill + Pay Bill.
            const routeToBillPmt = (e: QbIngestEvent) =>
              e.resolvedAction === 'pay_existing_bill' ||
              (e.resolvedAction == null && e.targetQbTxnKind === 'bill_pmt' && (e.matchedInvoiceIds ?? []).length > 0 && (e.matchedInvoiceIds ?? []).every(iid => invoices.find(inv => inv.id === iid)?.qbBillTxnId));
            const routeToCreatePay = (e: QbIngestEvent) =>
              e.resolvedAction === 'create_bill_then_pay' ||
              (e.resolvedAction == null && e.targetQbTxnKind === 'bill_add_and_pmt') ||
              // Fallback for target=bill_pmt where any bill is missing → route to create+pay
              (e.resolvedAction == null && e.targetQbTxnKind === 'bill_pmt' && (e.matchedInvoiceIds ?? []).length > 0 && (e.matchedInvoiceIds ?? []).some(iid => !invoices.find(inv => inv.id === iid)?.qbBillTxnId));
            const activeGate = (e: QbIngestEvent) => e.status !== 'posted' && e.status !== 'ignored' && !isPreOur(e) && e.resolvedAction !== 'already_done' && e.resolvedAction !== 'held';
            const groups: { key: string; title: string; hint: string; events: QbIngestEvent[] }[] = [
              { key: 'pending',          title: 'Needs classification',          hint: 'Not yet mapped to a QB vendor or push action. Map each counterparty once — future imports auto-classify.', events: qbIngestEvents.filter(e => e.status === 'pending' && !e.targetQbTxnKind) },
              { key: 'bill_pmt',         title: 'Pay existing Bill',             hint: 'Bill already exists in QB — push BillPmt to close it.', events: qbIngestEvents.filter(e => activeGate(e) && routeToBillPmt(e)) },
              { key: 'already_done',     title: 'Already done in QB — needs verification', hint: 'QB already has bill+payment; the invoice link is fuzzy. Actions below update OUR tracking only — QB is not touched. Choose per row: mark pre-our-system, orphan (unrelated to us), or accept the fuzzy match (writes back to our invoice).', events: qbIngestEvents.filter(e => e.resolvedAction === 'already_done' && e.status !== 'posted' && e.status !== 'ignored' && !isPreOur(e)) },
              { key: 'bill_add_and_pmt', title: 'Create Bill + Pay Bill',        hint: 'No matching Bill in QB yet — chain bill_add + bill_pmt_add at push time. Covers no-invoice contractors (Arpit, Himavath) and invoiced wires whose Bills haven\'t been created yet.', events: qbIngestEvents.filter(e => activeGate(e) && routeToCreatePay(e)) },
              { key: 'check',            title: 'Check (direct expense)',        hint: 'Push CheckAdd. Direct-expense passthroughs (Lucien → Administration salaries).',                       events: qbIngestEvents.filter(e => e.targetQbTxnKind === 'check' && e.status !== 'posted' && e.status !== 'ignored' && !isPreOur(e)) },
              { key: 'ignore',           title: 'Ignore (deliberate skip)',      hint: 'Deliberately never pushed. Advance-payment cases (US Signature), retired vendors (CLOUDYGON), fee/holding wires.', events: qbIngestEvents.filter(e => (e.targetQbTxnKind === 'ignore' || e.status === 'ignored') && !e.rawData?.__backfill) },
              { key: 'ignore_backfill',  title: 'Pre-our-system backfill',       hint: 'Convera wires paid via IIF pre-cutover (2026-04-28) and matcher_ignore=true legacy. Backfilled to shadow qb_ingest_events for auditability. Never re-push. Collapsed by default.', events: qbIngestEvents.filter(e => (e.targetQbTxnKind === 'ignore' || e.status === 'ignored') && !!e.rawData?.__backfill) },
              { key: 'posted',           title: 'Already posted (idempotency)',  hint: 'Previously pushed to QB — surfaced here for audit.',                                                   events: [
                ...qbIngestEvents.filter(e => e.status === 'posted'),
                // Slice A: G7.5 invoice-driven pushes rendered as synthetic events
                // so they share the posted bucket with event-driven pushes. Same
                // row shape + Resolved column. See qb_automation_ux_contract rule #4.
                ...invoices
                  .filter(inv => qbG75PostedInvoiceIds.has(inv.id) && inv.qbBillTxnId)
                  .map((inv): QbIngestEvent => ({
                    id: -inv.id,   // negative ID avoids collision with real qb_ingest_events
                    ingestedAt: inv.qbExportStatusAt ?? '',
                    source: 'invoice_g75',
                    sourceRef: `invoice:${inv.id}`,
                    txnDate: inv.periodEnd,
                    amount: inv.totalAmount,
                    counterpartyRaw: inv.userName,
                    memo: `INV ${inv.invoiceNumber}`,
                    counterpartyQbVendorListId: null,
                    targetQbTxnKind: 'bill_add_and_pmt',
                    qbBankAccountListId: null,
                    qbExpenseAccountListId: null,
                    matchedInvoiceIds: [inv.id],
                    status: 'posted',
                    qbSyncJobIds: [],
                    postedQbRefs: { bill: inv.qbBillTxnId },
                    lastError: null,
                    rawData: null,
                    notes: null,
                    resolvedAction: 'create_bill_then_pay',
                    resolvedBillTxnId: inv.qbBillTxnId,
                    resolvedPaymentTxnId: null,
                    resolvedReason: 'Bill created ahead of payment — payment ingest will link later',
                    reconciledAt: null,
                    matchProvenance: 'exact-ref',
                    statusUpdatedAt: inv.qbExportStatusAt,
                  })),
                // G7.6: proactive Convera create_bill pushes. Same shape as G7.5;
                // MULTI groups render as one synthetic row per invoice in the group
                // (each carries the shared bill TxnID via inv.qbBillTxnId).
                ...invoices
                  .filter(inv => qbG76PostedInvoiceIds.has(inv.id) && inv.qbBillTxnId)
                  .map((inv): QbIngestEvent => ({
                    id: -inv.id,
                    ingestedAt: inv.qbExportStatusAt ?? '',
                    source: 'invoice_g76',
                    sourceRef: `invoice:${inv.id}`,
                    txnDate: inv.periodEnd,
                    amount: inv.totalAmount,
                    counterpartyRaw: inv.userName,
                    memo: `INV ${inv.invoiceNumber}`,
                    counterpartyQbVendorListId: null,
                    targetQbTxnKind: 'bill_add_and_pmt',
                    qbBankAccountListId: null,
                    qbExpenseAccountListId: null,
                    matchedInvoiceIds: [inv.id],
                    status: 'posted',
                    qbSyncJobIds: [],
                    postedQbRefs: { bill: inv.qbBillTxnId },
                    lastError: null,
                    rawData: null,
                    notes: null,
                    resolvedAction: 'create_bill_then_pay',
                    resolvedBillTxnId: inv.qbBillTxnId,
                    resolvedPaymentTxnId: null,
                    resolvedReason: 'Bill created — Convera payment step handled outside our system for now',
                    reconciledAt: null,
                    matchProvenance: 'exact-ref',
                    statusUpdatedAt: inv.qbExportStatusAt,
                  })),
              ] },
            ];
            const total = qbIngestEvents.length;
            const ready = qbIngestEvents.filter(e => e.status === 'ready').length;
            const needsMapping = groups.find(g => g.key === 'pending')?.events.length ?? 0;
            const toggle = (k: string) => setQbInboxExpanded(prev => ({ ...prev, [k]: !prev[k] }));
            return (
              <div className="p-6 max-w-6xl mx-auto">
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800">QB Automation — Inbox</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Financial events pending classification and push to QuickBooks. Import via Invoices → Import Payments.</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex gap-2">
                      <button onClick={runRecomputeButton} disabled={recomputeBusy || qbIngestLoading} className="text-sm px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-50" title="Re-run the invoice matcher for all pending events. Use after creating/importing invoices, or after a matcher upgrade ships.">{recomputeBusy ? 'Recomputing…' : 'Recompute matches'}</button>
                      <button onClick={() => { loadQbIngestEvents(); loadQbOpenBills(); loadQbWcLastSeen(); }} disabled={qbIngestLoading} className="text-sm px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">{qbIngestLoading ? 'Loading…' : 'Refresh'}</button>
                      <button
                        onClick={() => setShowQbPushPreview(true)}
                        disabled={qbIngestLoading || qbIngestEvents.length === 0}
                        className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                        title="Preview what will be pushed to QuickBooks."
                      >
                        Push to QB
                      </button>
                    </div>
                    {/* Slice G1 — QB state freshness + QBWC heartbeat */}
                    {(() => {
                      const freshness = snapshotAge(qbOpenBills);
                      const snapshotLabel = freshness.newestQueriedAt
                        ? `QB state · ${humanizeAge(freshness.newestQueriedAt)}`
                        : 'QB state · not synced yet';
                      const snapshotStale = !freshness.newestQueriedAt
                        || (Date.now() - Date.parse(freshness.newestQueriedAt)) > 3600 * 1000;

                      // QBWC heartbeat. Poll cadence is 15 min; consider alive if
                      // last contact < 20 min, delayed 20–30 min, down > 30 min.
                      const qbwcAgeMs = qbWcLastSeen ? Date.now() - Date.parse(qbWcLastSeen) : Infinity;
                      const qbwcAlive = qbwcAgeMs < 20 * 60_000;
                      const qbwcDown = qbwcAgeMs > 30 * 60_000;
                      const nextPollMs = qbWcLastSeen ? Date.parse(qbWcLastSeen) + 15 * 60_000 - Date.now() : 0;
                      // "next poll due" is non-alarming when we're past the 15-min mark
                      // but QBWC is still classified alive (<20m). Only the qbwcDown/delayed
                      // branches signal a real fault — see qbwcLabel below.
                      const nextPollLabel = nextPollMs > 0
                        ? `next poll in ~${Math.max(1, Math.round(nextPollMs / 60_000))}m`
                        : 'next poll due';
                      const qbwcLabel = !qbWcLastSeen
                        ? 'QBWC · never seen'
                        : qbwcDown
                          ? `⚠ QBWC not running (last seen ${humanizeAge(qbWcLastSeen)})`
                          : qbwcAlive
                            ? `QBWC alive · ${nextPollLabel}`
                            : `QBWC delayed · last seen ${humanizeAge(qbWcLastSeen)}`;
                      const qbwcColor = qbwcDown ? 'text-red-700' : (qbwcAlive ? 'text-green-700' : 'text-amber-700');

                      const syncPending = qbBillQueryPending > 0;
                      const syncLabel = qbSyncingBills
                        ? 'Enqueuing…'
                        : syncPending
                          ? `Syncing… ${qbBillQueryPending} pending`
                          : 'Sync QB state';
                      const vendorSyncPending = qbVendorQueryPending > 0;
                      const vendorSyncDisabled = qbSyncingVendors || vendorSyncPending;
                      const vendorSyncLabel = qbSyncingVendors
                        ? 'Enqueuing…'
                        : vendorSyncPending
                          ? 'Syncing vendors…'
                          : 'Sync vendors';
                      return (
                        <div className="flex flex-col items-end gap-0.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className={snapshotStale ? 'text-amber-700' : 'text-gray-500'}>
                              {snapshotStale && '⚠ '}{snapshotLabel}
                            </span>
                            <button
                              onClick={syncPending ? () => setShowPendingJobsPopup(true) : runSyncQbBills}
                              disabled={qbSyncingBills}
                              className={qbSyncingBills
                                ? 'text-gray-400 cursor-not-allowed'
                                : syncPending
                                  ? 'text-amber-700 hover:underline cursor-pointer'
                                  : 'text-indigo-600 hover:underline'}
                              title={syncPending
                                ? `Click to see what's pending (${qbBillQueryPending} bill_query job${qbBillQueryPending === 1 ? '' : 's'} + ${qbPendingJobDetails.length - qbBillQueryPending} other job${qbPendingJobDetails.length - qbBillQueryPending === 1 ? '' : 's'} draining via QBWC).`
                                : 'Enqueue bill_query jobs for all mapped vendors that need refresh. QBWC drains on next poll (~15 min).'}
                            >
                              {syncLabel}
                            </button>
                            <span className="text-gray-300">·</span>
                            <button
                              onClick={runSyncQbVendors}
                              disabled={vendorSyncDisabled}
                              className={vendorSyncDisabled
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-indigo-600 hover:underline'}
                              title={vendorSyncPending
                                ? 'vendor_query still draining via QBWC (~15 min).'
                                : 'Enqueue a vendor_query to refresh the QB vendor list. QBWC drains on next poll (~15 min). Auto-runs every 2h.'}
                            >
                              {vendorSyncLabel}
                            </button>
                          </div>
                          <div className={qbwcColor}>
                            {qbwcLabel}
                            {qbwcDown && (
                              <span className="ml-1 text-gray-500">— start QBWC on accountant's laptop</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <QbPushStatusPane
                  supabase={supabase}
                  records={qbPushRecords}
                  onDismiss={(eventId) => setQbPushRecords(prev => prev.filter(r => r.eventId !== eventId))}
                />

                {/* Mapping widget — floating modal. Opened from Needs Classification cards
                    OR from the All Mappings panel below. Single source of truth for edit UI. */}
                {mapVendorOpenFor && (() => {
                  const bankAccounts = qbAccountsList.filter(a => a.accountType === 'Bank' && a.isActive);
                  const expenseAccounts = qbAccountsList.filter(a => (a.accountType === 'Expense' || a.accountType === 'CostOfGoodsSold' || a.accountType === 'OtherExpense') && a.isActive);
                  const vendorMatches = qbVendorsList
                    .filter(v => v.isActive && (!mapForm.vendorSearch || v.name.toLowerCase().includes(mapForm.vendorSearch.toLowerCase())))
                    .slice(0, 20);
                  const chosenVendor = qbVendorsList.find(v => v.listId === mapForm.vendorListId);
                  const ctx = mapVendorOpenFor;
                  return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMapVendorOpenFor(null)}>
                      <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-gray-800">Map counterparty → QB</div>
                            <div className="text-xs text-gray-600 mt-0.5">
                              <span className="font-mono">{ctx.counterparty}</span> · {sourceLabel(ctx.source)}
                            </div>
                          </div>
                          <button onClick={() => setMapVendorOpenFor(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
                            <div className="flex flex-wrap gap-2 text-xs">
                              {(['bill_pmt','bill_add_and_pmt','check','ignore'] as QbIngestKind[]).map(k => (
                                <label key={k} className={`px-2 py-1 border rounded cursor-pointer ${mapForm.kind === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                                  <input type="radio" className="hidden" checked={mapForm.kind === k} onChange={() => setMapForm(f => ({ ...f, kind: k }))} />
                                  {({ bill_pmt: 'Pay Bill', bill_add_and_pmt: 'Create Bill + Pay', check: 'Check', ignore: 'Ignore' } as Record<string, string>)[k]}
                                </label>
                              ))}
                            </div>
                          </div>
                          {mapForm.kind !== 'ignore' && (
                            <>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  QB vendor{mapForm.kind === 'check' ? ' (optional — leave blank if payee is OtherName/Employee)' : ''}
                                </label>
                                {chosenVendor ? (
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-1 bg-indigo-50 border border-indigo-200 rounded text-xs font-mono">{chosenVendor.name}</span>
                                    <button onClick={() => setMapForm(f => ({ ...f, vendorListId: '', vendorSearch: '' }))} className="text-xs text-red-500 hover:underline">clear</button>
                                  </div>
                                ) : (
                                  <>
                                    <input type="text" placeholder="Search vendors…" value={mapForm.vendorSearch} onChange={e => setMapForm(f => ({ ...f, vendorSearch: e.target.value }))} className="w-full px-2 py-1 border border-gray-300 rounded text-xs mb-1" />
                                    <div className="max-h-32 overflow-y-auto border border-gray-200 rounded text-xs divide-y divide-gray-100">
                                      {vendorMatches.length === 0 && <div className="p-2 text-gray-400">no matches</div>}
                                      {vendorMatches.map(v => (
                                        <button key={v.listId} onClick={() => setMapForm(f => ({ ...f, vendorListId: v.listId, vendorSearch: '' }))} className="w-full text-left px-2 py-1 hover:bg-indigo-50">{v.name}</button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                              {mapForm.kind === 'check' && !mapForm.vendorListId && (
                                <div className="p-2 bg-amber-50 border border-amber-200 rounded space-y-2">
                                  <div className="text-xs text-amber-800 font-medium">Payee not in Vendors list</div>
                                  <div className="text-xs text-amber-700">
                                    For Write-Check payees like OtherName / Employee / Customer entities. qbXML resolves the name across all QB payee lists — enter the exact FullName as it appears in QB.
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Payee full name</label>
                                    <input
                                      type="text"
                                      placeholder="e.g. Lucien Pinto"
                                      value={mapForm.payeeFullName}
                                      onChange={e => setMapForm(f => ({ ...f, payeeFullName: e.target.value }))}
                                      className="w-full px-2 py-1 border border-amber-300 rounded text-xs bg-white"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Which QB list?</label>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      {(['OtherName','Employee','Customer'] as QbPayeeListKind[]).map(k => (
                                        <label key={k} className={`px-2 py-1 border rounded cursor-pointer ${mapForm.payeeListKind === k ? 'bg-amber-600 text-white border-amber-600' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                                          <input type="radio" className="hidden" checked={mapForm.payeeListKind === k} onChange={() => setMapForm(f => ({ ...f, payeeListKind: k }))} />
                                          {k}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">Bank account</label>
                                <select value={mapForm.bankListId} onChange={e => setMapForm(f => ({ ...f, bankListId: e.target.value }))} className="w-full px-2 py-1 border border-gray-300 rounded text-xs">
                                  <option value="">— pick a bank —</option>
                                  {bankAccounts.map(a => <option key={a.listId} value={a.listId}>{a.fullName}</option>)}
                                </select>
                              </div>
                              {(mapForm.kind === 'check' || mapForm.kind === 'bill_add_and_pmt') && (
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Expense account</label>
                                  <select value={mapForm.expenseListId} onChange={e => setMapForm(f => ({ ...f, expenseListId: e.target.value }))} className="w-full px-2 py-1 border border-gray-300 rounded text-xs">
                                    <option value="">— pick an expense account —</option>
                                    {expenseAccounts.map(a => <option key={a.listId} value={a.listId}>{a.fullName}</option>)}
                                  </select>
                                </div>
                              )}
                            </>
                          )}
                          {mapForm.kind === 'ignore' && (
                            <div className="p-2 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
                              Ignore means events for this counterparty will never be pushed to QB. Accountant handles them separately.
                            </div>
                          )}
                          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                            <button onClick={() => setMapVendorOpenFor(null)} className="text-xs px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
                            <button onClick={() => saveVendorMapping(ctx.counterparty, ctx.source)} disabled={mapSaving} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
                              {mapSaving ? 'Saving…' : (ctx.eventCount > 0 ? `Save & apply to ${ctx.eventCount}` : 'Save mapping')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* All Vendor Mappings — management panel. Collapsible; edit reopens the widget above. */}
                {qbVendorMappings.length > 0 && (
                  <details className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
                    <summary className="px-4 py-2 bg-gray-50 hover:bg-gray-100 cursor-pointer text-sm font-medium text-gray-700">
                      All Vendor Mappings ({qbVendorMappings.length})
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-500">
                          <tr>
                            <th className="px-3 py-1.5 text-left">Counterparty</th>
                            <th className="px-3 py-1.5 text-left">Source</th>
                            <th className="px-3 py-1.5 text-left">Kind</th>
                            <th className="px-3 py-1.5 text-left">QB payee</th>
                            <th className="px-3 py-1.5 text-left">Bank</th>
                            <th className="px-3 py-1.5 text-left">Expense</th>
                            <th className="px-3 py-1.5 text-right w-16">Edit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {[...qbVendorMappings]
                            .sort((a, b) => a.counterpartyPattern.localeCompare(b.counterpartyPattern))
                            .map(m => {
                              const vendor = m.qbVendorListId ? qbVendorsList.find(v => v.listId === m.qbVendorListId) : null;
                              const bank = m.defaultBankAccountListId ? qbAccountsList.find(a => a.listId === m.defaultBankAccountListId) : null;
                              const expense = m.defaultExpenseAccountListId ? qbAccountsList.find(a => a.listId === m.defaultExpenseAccountListId) : null;
                              const kindLabel = m.defaultTargetKind ? ({ bill_pmt: 'Pay Bill', bill_add_and_pmt: 'Create+Pay', check: 'Check', ignore: 'Ignore' } as Record<string, string>)[m.defaultTargetKind] ?? m.defaultTargetKind : '—';
                              const payeeDisplay = vendor
                                ? vendor.name
                                : m.payeeFullName
                                  ? `${m.payeeFullName}${m.payeeListKind ? ` (${m.payeeListKind})` : ''}`
                                  : '—';
                              return (
                                <tr key={m.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-1.5 font-medium text-gray-800">{m.counterpartyPattern}</td>
                                  <td className="px-3 py-1.5 text-gray-600">{sourceLabel(m.source)}</td>
                                  <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px]">{kindLabel}</span></td>
                                  <td className="px-3 py-1.5 font-mono text-[11px]">{payeeDisplay}</td>
                                  <td className="px-3 py-1.5 text-gray-600 text-[11px]">{bank?.fullName ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-gray-600 text-[11px]">{expense?.fullName ?? '—'}</td>
                                  <td className="px-3 py-1.5 text-right">
                                    <button onClick={() => openMapWidget(m.counterpartyPattern, m.source, 0)} className="text-xs px-2 py-0.5 border border-indigo-300 text-indigo-700 rounded hover:bg-indigo-50">Edit</button>
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="p-3 border border-gray-200 rounded-lg bg-white">
                    <div className="text-xs text-gray-500">Total events</div>
                    <div className="text-2xl font-bold text-gray-800">{total}</div>
                  </div>
                  <div className={`p-3 border rounded-lg ${needsMapping > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                    <div className="text-xs text-gray-500">Need classification</div>
                    <div className={`text-2xl font-bold ${needsMapping > 0 ? 'text-amber-800' : 'text-gray-800'}`}>{needsMapping}</div>
                  </div>
                  <div className="p-3 border border-gray-200 rounded-lg bg-white">
                    <div className="text-xs text-gray-500">Ready to push</div>
                    <div className="text-2xl font-bold text-gray-800">{ready}</div>
                  </div>
                </div>

                {total === 0 && !qbIngestLoading && (
                  <div className="p-8 border border-dashed border-gray-300 rounded-lg text-center text-gray-500">
                    <UploadCloud className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                    <p className="text-sm">Inbox is empty. Import Intuit payments via <strong>Invoices → Import Payments → Intuit XLSX</strong>.</p>
                  </div>
                )}

                <QbPushPreviewModal
                  open={showQbPushPreview}
                  onClose={() => setShowQbPushPreview(false)}
                  events={(() => {
                    // Slice A: fold G7.5-eligible invoices into the modal as
                    // synthetic ready events so accountant selects them via the
                    // same checkbox UX as event-driven candidates.
                    // Eligibility mirrors intuitInvoiceCreateBill.ts.
                    const mappingByVendor = new Map(qbVendorMappings.map(m => [m.qbVendorListId, m]));
                    const vendorByName = new Map(qbVendorsList.map(v => [v.name.toLowerCase().trim(), v]));
                    const bankAcct = qbAccountsList.find(a => a.fullName.toLowerCase().includes('8220'));
                    const resolverPps: ResolverPaymentProfile[] = paymentProfiles.map(p => ({
                      id: p.id, userId: p.userId, qbVendorName: p.qbVendorName, companyName: p.companyName, isDefault: p.isDefault,
                    }));
                    // Retained for the group-vendor fallback below (multi-member umbrella).
                    const liveVendorNameByUserId = new Map<string, string>();
                    for (const pp of paymentProfiles) {
                      const n = pp.qbVendorName?.trim();
                      if (!n) continue;
                      if (!liveVendorNameByUserId.has(pp.userId) || pp.isDefault) liveVendorNameByUserId.set(pp.userId, n);
                    }
                    // Precompute: for each group_key, resolve vendor from ANY member's
                    // snapshot or live payment_profile. This lets umbrella members
                    // whose OWN qb_vendor_name is null (e.g. Iskra Kochova in Teal
                    // group_key) inherit the group's vendor and render as pushable.
                    // Non-grouped invoices resolve per-invoice as before.
                    const groupVendorByKey = new Map<string, string>();
                    const invoicesByGroupKey = new Map<string, typeof invoices>();
                    for (const inv of invoices) {
                      if (!inv.groupKey) continue;
                      const arr = invoicesByGroupKey.get(inv.groupKey) ?? [];
                      arr.push(inv);
                      invoicesByGroupKey.set(inv.groupKey, arr);
                    }
                    for (const [key, members] of invoicesByGroupKey) {
                      const candidates = new Set<string>();
                      for (const m of members) {
                        const s = m.paymentProfile?.qbVendorName?.trim();
                        if (s) candidates.add(s);
                      }
                      if (candidates.size === 0) {
                        for (const m of members) {
                          const l = liveVendorNameByUserId.get(m.userId);
                          if (l) candidates.add(l);
                        }
                      }
                      // Only pin the group when members agree. Disagreement is a
                      // data anomaly the consumer will hold — same UX in the modal.
                      if (candidates.size === 1) groupVendorByKey.set(key, [...candidates][0]);
                    }
                    const g75Ready: QbIngestEvent[] = [];
                    const g76Ready: QbIngestEvent[] = [];
                    for (const inv of invoices) {
                      // Include 'paid' — Convera-matched invoices need their
                      // Bill in QB even after our-side reconciliation.
                      if (inv.status !== 'approved' && inv.status !== 'paid') continue;
                      // Skip pre-our-system legacy invoices.
                      if (inv.matcherIgnore) continue;
                      if (inv.qbBillTxnId) continue;
                      if (!inv.periodEnd) continue;
                      if (!inv.invoiceNumber?.trim()) continue;
                      // Slice 3: skip invoices in the "Needs vendor decision"
                      // bucket — accountant must resolve those first before
                      // they show up as pushable.
                      if (needsVendorDecisionByInvoiceId.has(inv.id)) continue;
                      const pm = paymentMethod(inv);
                      const isIntuit = pm === 'Intuit';
                      const isConvera = pm === 'Convera';
                      if (!isIntuit && !isConvera) continue;
                      if (isIntuit && inv.periodEnd < INTUIT_PRE_OUR_SYSTEM_CUTOFF) continue;
                      if (isConvera && inv.periodEnd < CONVERA_PRE_OUR_SYSTEM_CUTOFF) continue;
                      // Vendor resolution: snapshot → live pps[snap_pp_id] → group_key sibling.
                      // pp-scoped chain avoids silently rerouting multi-pp contractors' invoices
                      // to their user-default vendor (2026-09-02 fix).
                      let vName = resolveInvoiceQbVendorName(
                        { snapPaymentProfileId: extractSnapPpId(inv.paymentProfile), snapQbVendorName: inv.paymentProfile?.qbVendorName ?? null, userId: inv.userId },
                        resolverPps,
                      ) ?? undefined;
                      if (!vName && inv.groupKey) vName = groupVendorByKey.get(inv.groupKey);
                      if (!vName) continue;
                      // No Bimosoft filter here (or in the consumer, as of 2026-08-27).
                      // The UK ALT rule governs wire routing (payment side), not bill
                      // vendor identity. Bills correctly post against per-contractor
                      // "Bimosoft - X" sub-vendors per accountant's QB convention.
                      const vendor = vendorByName.get(vName.toLowerCase().trim());
                      if (!vendor) continue;
                      const mapping = mappingByVendor.get(vendor.listId);
                      if (!mapping?.defaultExpenseAccountListId) continue;
                      const row: QbIngestEvent = {
                        id: -inv.id,
                        ingestedAt: '',
                        source: isIntuit ? 'invoice_g75' : 'invoice_g76',
                        sourceRef: `invoice:${inv.id}`,
                        txnDate: inv.periodEnd,
                        amount: inv.totalAmount,
                        counterpartyRaw: inv.userName,
                        memo: `INV ${inv.invoiceNumber}`,
                        counterpartyQbVendorListId: vendor.listId,
                        targetQbTxnKind: 'bill_add_and_pmt',
                        qbBankAccountListId: bankAcct?.listId ?? null,
                        qbExpenseAccountListId: mapping.defaultExpenseAccountListId,
                        matchedInvoiceIds: [inv.id],
                        status: 'ready',
                        qbSyncJobIds: [],
                        postedQbRefs: null,
                        lastError: null,
                        rawData: null,
                        notes: null,
                        resolvedAction: 'create_bill_then_pay',
                        resolvedBillTxnId: null,
                        resolvedPaymentTxnId: null,
                        resolvedReason: isIntuit
                          ? 'Bill created ahead of payment — payment ingest will link later'
                          : (inv.groupKey
                              ? 'Bill created — part of umbrella invoice group (pushing any row pushes the whole group)'
                              : 'Bill created — Convera payment step handled outside our system for now'),
                        reconciledAt: null,
                        matchProvenance: 'exact-ref',
                        statusUpdatedAt: null,
                      };
                      if (isIntuit) g75Ready.push(row); else g76Ready.push(row);
                    }
                    // Sort G7.5 + G7.6 synthetic rows by contractor name so accountant
                    // can scan alphabetically. Real qb_ingest_events keep their order
                    // (grouped by kind in the modal component itself). Case-insensitive.
                    const byName = (a: QbIngestEvent, b: QbIngestEvent) =>
                      (a.counterpartyRaw || '').localeCompare(b.counterpartyRaw || '', undefined, { sensitivity: 'base' });
                    g75Ready.sort(byName);
                    g76Ready.sort(byName);
                    return [...qbIngestEvents, ...g75Ready, ...g76Ready];
                  })()}
                  inflightEventIds={new Set(qbPushRecords.map(r => r.eventId))}
                  qbVendors={qbVendorsList}
                  qbAccounts={qbAccountsList}
                  invoices={invoices}
                  qbMappings={qbVendorMappings.map(m => ({ source: m.source, counterpartyPattern: m.counterpartyPattern, payeeFullName: m.payeeFullName }))}
                  onConfirm={async (selectedIds) => {
                    setShowQbPushPreview(false);
                    try {
                      // Slice A + G7.6: split by id sign — positive = qb_ingest_events,
                      // negative = invoice ids (invert sign). Then split negatives by
                      // paymentMethod: Intuit → G7.5 pusher, Convera → G7.6 pusher.
                      const invoiceById = new Map(invoices.map(i => [i.id, i]));
                      const negativeInvoiceIds = selectedIds.filter(id => id < 0).map(id => -id);
                      const g75InvoiceIds: number[] = [];
                      const g76InvoiceIds: number[] = [];
                      for (const invId of negativeInvoiceIds) {
                        const inv = invoiceById.get(invId);
                        if (!inv) continue;
                        const pm = paymentMethod(inv);
                        if (pm === 'Intuit') g75InvoiceIds.push(invId);
                        else if (pm === 'Convera') g76InvoiceIds.push(invId);
                      }
                      const eventIds = selectedIds.filter(id => id > 0);
                      // Route by resolved_action: pay_existing_bill → intuitPush,
                      // create_bill_then_pay → intuitCreateBill, check → intuitCheck.
                      // Run all in parallel; merge results for the alert + status pane.
                      const selectedEvents = eventIds.map(id => qbIngestEvents.find(e => e.id === id)).filter((e): e is QbIngestEvent => !!e);
                      const payEventIds = selectedEvents.filter(e => e.source === 'intuit_xlsx' && e.resolvedAction === 'pay_existing_bill').map(e => e.id);
                      const createEventIds = selectedEvents.filter(e => e.source === 'intuit_xlsx' && e.resolvedAction === 'create_bill_then_pay').map(e => e.id);
                      const checkEventIds = selectedEvents.filter(e => e.source === 'intuit_xlsx' && e.resolvedAction === 'check').map(e => e.id);
                      // Slice C-1/C-2: split Convera bill_pmt events by whether the
                      // matched invoice already has qb_bill_txn_id. If yes → straight
                      // pay via pushConveraBillPmt (C-1). If no → chained create+pay
                      // via pushConveraCreateBillAndPay (C-2). Multi-invoice events
                      // hit C-2's skip path with a Slice C-3 direction.
                      // Convera routing for bill_pmt / bill_add_and_pmt targets:
                      //   1 invoice + bill exists                  → pushConveraBillPmt (C-1: single-vendor)
                      //   >1 invoice OR some bills missing         → pushConveraCreateBillAndPay (C-2/C-3: per-invoice vendor resolution)
                      //   NO invoice link (orphan)                 → pushConveraCreateBillFromEvent (C-4)
                      //
                      // Why multi-invoice always goes to C-2: umbrella wires (Bimosoft) match
                      // N invoices spanning N sub-vendors. C-1 uses one payee per event
                      // (event.counterparty_qb_vendor_list_id) and would lump all bills
                      // under one payee → INVARIANT #11 vendor-mismatch reject. C-2
                      // resolves vendor per invoice and emits one pay_bill per sub-vendor.
                      const converaBillPmtCandidates = selectedEvents.filter(e => e.source === 'convera' && e.targetQbTxnKind === 'bill_pmt' && (e.matchedInvoiceIds ?? []).length > 0);
                      const converaAllBillsExist = converaBillPmtCandidates.filter(e => {
                        const ids = e.matchedInvoiceIds ?? [];
                        return ids.length === 1 && ids.every(iid => invoices.find(inv => inv.id === iid)?.qbBillTxnId);
                      }).map(e => e.id);
                      const converaMissingBills = converaBillPmtCandidates.filter(e => !converaAllBillsExist.includes(e.id)).map(e => e.id);
                      // Orphan events (no matched invoice): both bill_pmt and
                      // bill_add_and_pmt targets flow through C-4. Consumer
                      // check-then-act: existing bill in qb_mirror → pay, else create+pay.
                      const converaCreateFromEvent = selectedEvents.filter(e =>
                        e.source === 'convera'
                        && (e.targetQbTxnKind === 'bill_add_and_pmt' || e.targetQbTxnKind === 'bill_pmt')
                        && (e.matchedInvoiceIds ?? []).length === 0
                      ).map(e => e.id);
                      const [payRes, createRes, checkRes, g75Res, g76Res, converaPayRes, converaCreatePayRes, converaCreateFromEventRes] = await Promise.all([
                        payEventIds.length > 0 ? pushIntuitPayBill(supabase, payEventIds) : Promise.resolve(null),
                        createEventIds.length > 0 ? pushIntuitCreateBill(supabase, createEventIds) : Promise.resolve(null),
                        checkEventIds.length > 0 ? pushIntuitCheck(supabase, checkEventIds) : Promise.resolve(null),
                        g75InvoiceIds.length > 0 ? pushIntuitInvoiceCreateBill(supabase, g75InvoiceIds) : Promise.resolve(null),
                        g76InvoiceIds.length > 0 ? pushConveraInvoiceCreateBill(supabase, g76InvoiceIds) : Promise.resolve(null),
                        converaAllBillsExist.length > 0 ? pushConveraBillPmt(supabase, converaAllBillsExist) : Promise.resolve(null),
                        converaMissingBills.length > 0 ? pushConveraCreateBillAndPay(supabase, converaMissingBills) : Promise.resolve(null),
                        converaCreateFromEvent.length > 0 ? pushConveraCreateBillFromEvent(supabase, converaCreateFromEvent) : Promise.resolve(null),
                      ]);
                      const r = {
                        jobIds: [...(payRes?.jobIds ?? []), ...(createRes?.jobIds ?? []), ...(checkRes?.jobIds ?? []), ...(g75Res?.jobIds ?? []), ...(g76Res?.jobIds ?? []), ...(converaPayRes?.jobIds ?? []), ...(converaCreatePayRes?.jobIds ?? []), ...(converaCreateFromEventRes?.jobIds ?? [])],
                        rejected: [...(payRes?.rejected ?? []), ...(createRes?.rejected ?? []), ...(checkRes?.rejected ?? []), ...(g75Res?.rejected ?? []), ...(g76Res?.rejected ?? []), ...(converaPayRes?.rejected ?? []), ...(converaCreatePayRes?.rejected ?? []), ...(converaCreateFromEventRes?.rejected ?? [])],
                        skippedDuplicate: [...(payRes?.skippedDuplicate ?? []), ...(createRes?.skippedDuplicate ?? []), ...(checkRes?.skippedDuplicate ?? []), ...(g75Res?.skippedDuplicate ?? []), ...(g76Res?.skippedDuplicate ?? []), ...(converaPayRes?.skippedDuplicate ?? []), ...(converaCreatePayRes?.skippedDuplicate ?? []), ...(converaCreateFromEventRes?.skippedDuplicate ?? [])],
                        skippedIneligible: [
                          ...(payRes?.skippedIneligible ?? []),
                          ...(createRes?.skippedIneligible ?? []),
                          ...(checkRes?.skippedIneligible ?? []),
                          // G7.5/G7.6 shape is { invoiceId, reason }; project to { eventId, reason } for the shared alert.
                          ...((g75Res?.skippedIneligible ?? []).map(s => ({ eventId: -s.invoiceId, reason: s.reason }))),
                          ...((g76Res?.skippedIneligible ?? []).map(s => ({ eventId: -s.invoiceId, reason: s.reason }))),
                          ...(converaPayRes?.skippedIneligible ?? []),
                          ...(converaCreatePayRes?.skippedIneligible ?? []),
                          ...(converaCreateFromEventRes?.skippedIneligible ?? []),
                        ],
                        verifyJobIdByPayJobId: { ...(payRes?.verifyJobIdByPayJobId ?? {}), ...(converaPayRes?.verifyJobIdByPayJobId ?? {}), ...(converaCreatePayRes?.verifyJobIdByPayJobId ?? {}), ...(converaCreateFromEventRes?.chainedVerifyJobIdByPayJobId ?? {}) },
                      };
                      const enqueued = r.jobIds.filter((id): id is number => id != null).length;
                      const payJobIds = payRes?.jobIds ?? [];
                      const createJobIds = createRes?.jobIds ?? [];
                      void createJobIds;

                      // Build push records for the live status pane. Only successful
                      // pay_bill jobs get an entry — status pane's pay+verify state
                      // machine doesn't model bill_add. bill_add drain success is
                      // observable via the event's resolved_bill_txn_id flipping
                      // + subsequent recompute; alert covers the immediate feedback.
                      const eventById = new Map(qbIngestEvents.map(e => [e.id, e]));
                      const vendorByListId = new Map(qbVendorsList.map(v => [v.listId, v]));
                      const newRecords: PushRecord[] = [];
                      const inelig = new Set(r.skippedIneligible.map(s => s.eventId));
                      const rejPayEventIds = new Set((payRes?.rejected ?? []).map(rj => (rj.intent.kind === 'pay_bill' ? rj.intent.sourceIngestEventId : undefined)).filter((id): id is number => id != null));
                      const dupPayEventIds = new Set((payRes?.skippedDuplicate ?? []).map(s => (s.intent.kind === 'pay_bill' ? s.intent.sourceIngestEventId : undefined)).filter((id): id is number => id != null));
                      const eligiblePayInOrder = payEventIds.filter(id => !inelig.has(id) && !rejPayEventIds.has(id) && !dupPayEventIds.has(id));
                      payJobIds.forEach((jobId, i) => {
                        if (jobId == null) return;
                        const eventId = eligiblePayInOrder[i];
                        if (eventId == null) return;
                        const event = eventById.get(eventId);
                        if (!event) return;
                        const vendor = event.counterpartyQbVendorListId ? vendorByListId.get(event.counterpartyQbVendorListId) : null;
                        newRecords.push({
                          eventId,
                          payJobId: jobId,
                          verifyJobId: r.verifyJobIdByPayJobId[jobId] ?? null,
                          billTxnId: event.resolvedBillTxnId ?? '',
                          expectedAmount: event.amount,
                          expectedVendor: vendor?.name ?? event.counterpartyRaw,
                          pushedAt: new Date().toISOString(),
                        });
                      });
                      // Phase 3 one-click chain: also track the chained pay+verify
                      // jobs from intuitCreateBill so the status pane surfaces the
                      // whole flow (bill_add is upstream but the pay job is what
                      // shows the money-moved state — same UX shape).
                      const chainedPay = createRes?.chainedPayJobIdByBillAddJobId ?? {};
                      const chainedVerify = createRes?.chainedVerifyJobIdByPayJobId ?? {};
                      const inelig2 = new Set(r.skippedIneligible.map(s => s.eventId));
                      const eligibleCreateInOrder = createEventIds.filter(id => !inelig2.has(id));
                      createJobIds.forEach((billAddJobId, i) => {
                        if (billAddJobId == null) return;
                        const eventId = eligibleCreateInOrder[i];
                        if (eventId == null) return;
                        const event = eventById.get(eventId);
                        if (!event) return;
                        const chainedPayId = chainedPay[billAddJobId];
                        if (chainedPayId == null) return;
                        const vendor = event.counterpartyQbVendorListId ? vendorByListId.get(event.counterpartyQbVendorListId) : null;
                        newRecords.push({
                          eventId,
                          payJobId: chainedPayId,
                          verifyJobId: chainedVerify[chainedPayId] ?? null,
                          billTxnId: '',   // hydrated on parent bill_add drain
                          expectedAmount: event.amount,
                          expectedVendor: vendor?.name ?? event.counterpartyRaw,
                          pushedAt: new Date().toISOString(),
                        });
                      });
                      // Check pushes: enqueue status-pane records too. No bill mirror
                      // or verify chain — status pane branches on kind='check' so the
                      // record flips to verified-ok as soon as check_add drains.
                      const checkJobIds = checkRes?.jobIds ?? [];
                      const inelig3 = new Set((checkRes?.skippedIneligible ?? []).map(s => s.eventId));
                      const rejCheckEventIds = new Set((checkRes?.rejected ?? []).map(rj => (rj.intent.kind === 'check_expense' ? rj.intent.sourceIngestEventId : undefined)).filter((id): id is number => id != null));
                      const dupCheckEventIds = new Set((checkRes?.skippedDuplicate ?? []).map(s => (s.intent.kind === 'check_expense' ? s.intent.sourceIngestEventId : undefined)).filter((id): id is number => id != null));
                      const eligibleCheckInOrder = checkEventIds.filter(id => !inelig3.has(id) && !rejCheckEventIds.has(id) && !dupCheckEventIds.has(id));
                      const checkPayeeByKey = new Map<string, string>();
                      for (const m of qbVendorMappings) {
                        if (m.payeeFullName) checkPayeeByKey.set(`${m.source} ${m.counterpartyPattern}`, m.payeeFullName);
                      }
                      checkJobIds.forEach((jobId, i) => {
                        if (jobId == null) return;
                        const eventId = eligibleCheckInOrder[i];
                        if (eventId == null) return;
                        const event = eventById.get(eventId);
                        if (!event) return;
                        const displayName = checkPayeeByKey.get(`${event.source} ${event.counterpartyRaw}`) ?? event.counterpartyRaw;
                        newRecords.push({
                          eventId,
                          payJobId: jobId,
                          verifyJobId: null,
                          billTxnId: '',
                          expectedAmount: event.amount,
                          expectedVendor: displayName,
                          pushedAt: new Date().toISOString(),
                          kind: 'check',
                        });
                      });
                      // Slice A: G7.5 invoice-driven records for the live pane.
                      // Each pushed invoice → one record (bill_add job + chained verify).
                      const g75JobIds = g75Res?.jobIds ?? [];
                      const g75VerifyByBillAdd = g75Res?.verifyJobIdByBillAddJobId ?? {};
                      const g75InvRejected = new Set((g75Res?.rejected ?? []).map(rj => (rj.intent.kind === 'create_bill' ? (rj.intent.sourceInvoiceIds?.[0] ?? null) : null)).filter((v): v is number => v != null));
                      const g75InvSkipped = new Set((g75Res?.skippedDuplicate ?? []).map(s => (s.intent.kind === 'create_bill' ? (s.intent.sourceInvoiceIds?.[0] ?? null) : null)).filter((v): v is number => v != null));
                      const g75IneligIds = new Set((g75Res?.skippedIneligible ?? []).map(s => s.invoiceId));
                      const g75EligibleInOrder = g75InvoiceIds.filter(id => !g75IneligIds.has(id) && !g75InvRejected.has(id) && !g75InvSkipped.has(id));
                      g75JobIds.forEach((jobId, i) => {
                        if (jobId == null) return;
                        const invoiceId = g75EligibleInOrder[i];
                        if (invoiceId == null) return;
                        const inv = invoiceById.get(invoiceId);
                        if (!inv) return;
                        newRecords.push({
                          eventId: -invoiceId,   // negative so React keys don't collide with real events
                          sourceKind: 'invoice',
                          invoiceId,
                          payJobId: jobId,
                          verifyJobId: g75VerifyByBillAdd[jobId] ?? null,
                          billTxnId: '',   // filled by poll from invoices.qb_bill_txn_id after drain
                          expectedAmount: inv.totalAmount,
                          expectedVendor: (inv.paymentProfile?.qbVendorName || inv.userName || '').trim(),
                          pushedAt: new Date().toISOString(),
                          kind: 'invoice_create_bill',
                        });
                      });
                      // G7.6 Convera invoice-driven records for the live pane.
                      // Now uses the consumer's perIntent[] contract (introduced
                      // 2026-08-27) which returns one entry per emitted intent
                      // with (sourceInvoiceIds, vendorName, refNumber, totalAmount,
                      // jobId, verifyJobId). No index-into-jobIds guessing that
                      // could scramble records if the consumer's iteration order
                      // and this rebuild disagreed (2026-08-27 bug: Vladimir/Liya
                      // swapped, Naretena dropped from pane despite being enqueued).
                      for (const pi of (g76Res?.perIntent ?? [])) {
                        if (pi.jobId == null) continue;
                        const firstInv = invoiceById.get(pi.sourceInvoiceIds[0]);
                        newRecords.push({
                          eventId: -(firstInv?.id ?? pi.sourceInvoiceIds[0]),
                          sourceKind: 'invoice',
                          invoiceId: firstInv?.id ?? pi.sourceInvoiceIds[0],
                          payJobId: pi.jobId,
                          verifyJobId: pi.verifyJobId,
                          billTxnId: '',
                          expectedAmount: pi.totalAmount,
                          expectedVendor: pi.vendorName,
                          pushedAt: new Date().toISOString(),
                          kind: 'invoice_create_bill',
                        });
                      }
                      setQbPushRecords(prev => [...prev, ...newRecords]);

                      const payEnqueued = payJobIds.filter((id): id is number => id != null).length;
                      const createEnqueued = createJobIds.filter((id): id is number => id != null).length;
                      const checkEnqueued = checkJobIds.filter((id): id is number => id != null).length;
                      const g75Enqueued = (g75Res?.jobIds ?? []).filter((id): id is number => id != null).length;
                      const g76Enqueued = (g76Res?.jobIds ?? []).filter((id): id is number => id != null).length;
                      // Convera event-driven counters were previously missing from the
                      // summary, so a successful Convera push (e.g. Bimosoft C-2 → 3
                      // pay_bill jobs) showed "0 jobs enqueued." Fixed 2026-09-03.
                      const converaPayEnqueued = (converaPayRes?.jobIds ?? []).filter((id): id is number => id != null).length;
                      const converaCreatePayEnqueued = (converaCreatePayRes?.jobIds ?? []).filter((id): id is number => id != null).length;
                      const converaCreateFromEventEnqueued = (converaCreateFromEventRes?.jobIds ?? []).filter((id): id is number => id != null).length;
                      const parts: string[] = [];
                      if (payEnqueued > 0) parts.push(`${payEnqueued} Intuit pay_bill job${payEnqueued === 1 ? '' : 's'} enqueued.`);
                      if (createEnqueued > 0) parts.push(`${createEnqueued} Intuit bill_add job${createEnqueued === 1 ? '' : 's'} enqueued — wait for QuickBooks drain, then Recompute, then push payment step.`);
                      if (checkEnqueued > 0) parts.push(`${checkEnqueued} check_add job${checkEnqueued === 1 ? '' : 's'} enqueued (direct expense — verify in QB after drain).`);
                      if (g75Enqueued > 0) parts.push(`${g75Enqueued} Intuit invoice bill_add job${g75Enqueued === 1 ? '' : 's'} enqueued (created from approved Intuit invoice).`);
                      if (g76Enqueued > 0) parts.push(`${g76Enqueued} Convera invoice bill_add job${g76Enqueued === 1 ? '' : 's'} enqueued (created from approved Convera invoice — payment handled separately).`);
                      if (converaPayEnqueued > 0) parts.push(`${converaPayEnqueued} Convera pay_bill job${converaPayEnqueued === 1 ? '' : 's'} enqueued (bill already existed).`);
                      if (converaCreatePayEnqueued > 0) parts.push(`${converaCreatePayEnqueued} Convera chained pay_bill job${converaCreatePayEnqueued === 1 ? '' : 's'} enqueued (per sub-vendor for umbrella wires + bill_add chain where needed).`);
                      if (converaCreateFromEventEnqueued > 0) parts.push(`${converaCreateFromEventEnqueued} Convera orphan job${converaCreateFromEventEnqueued === 1 ? '' : 's'} enqueued (no invoice link — create+pay or pay-existing decided at push time).`);
                      if (parts.length === 0) parts.push(`0 jobs enqueued.`);
                      void enqueued;
                      if (r.skippedIneligible.length > 0) parts.push(`${r.skippedIneligible.length} skipped (ineligible).`);
                      if (r.skippedDuplicate.length > 0) parts.push(`${r.skippedDuplicate.length} skipped (already done or in-flight).`);
                      if (r.rejected.length > 0) parts.push(`${r.rejected.length} rejected by invariants.`);
                      setPushResult({
                        summary: parts.join(' '),
                        ineligible: r.skippedIneligible.map(s => `event ${s.eventId}: ${s.reason}`),
                        duplicate: r.skippedDuplicate.map(s => s.reason),
                        rejected: r.rejected.map(rj => `${rj.invariant}: ${rj.reason}`),
                      });
                      void loadQbIngestEvents();
                    } catch (e) {
                      console.error('[G7a] pushIntuitPayBill failed', e);
                      setPushResult({ summary: `Push failed: ${(e as Error).message}`, ineligible: [], duplicate: [], rejected: [] });
                    }
                  }}
                  onFixMapping={(counterparty, source) => {
                    setQbInboxExpanded(prev => ({ ...prev, pending: true }));
                    openMapWidget(counterparty, source);
                  }}
                />

                {/* Push-result modal: replaces the legacy browser alert.
                    Sections collapse independently so a 20+ event batch
                    doesn't blast a static wall of text. */}
                {pushResult && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPushResult(null)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                      <div className="p-5 border-b border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-800">Pushed to QuickBooks queue</h3>
                        <p className="text-sm text-gray-700 mt-1.5">{pushResult.summary}</p>
                      </div>
                      <div className="p-4 overflow-auto flex-1 space-y-2">
                        {[
                          { key: 'rejected',   label: 'Rejected by invariants', color: 'red',    items: pushResult.rejected },
                          { key: 'ineligible', label: 'Skipped (ineligible)',   color: 'amber',  items: pushResult.ineligible },
                          { key: 'duplicate',  label: 'Skipped (already done or in-flight)', color: 'gray', items: pushResult.duplicate },
                        ].map(sec => sec.items.length === 0 ? null : (
                          <details key={sec.key} className={`border border-${sec.color}-200 rounded-lg overflow-hidden bg-${sec.color}-50`} open={sec.key === 'rejected'}>
                            <summary className={`cursor-pointer px-4 py-2.5 text-sm font-medium text-${sec.color}-900 hover:bg-${sec.color}-100/60 select-none`}>
                              {sec.label} · <span className="font-mono">{sec.items.length}</span>
                            </summary>
                            <ul className="px-4 pb-3 pt-1 space-y-1 max-h-64 overflow-y-auto">
                              {sec.items.map((line, i) => (
                                <li key={i} className="text-xs text-gray-700 leading-snug"><span className="text-gray-400 mr-1">•</span>{line}</li>
                              ))}
                            </ul>
                          </details>
                        ))}
                        {pushResult.rejected.length + pushResult.ineligible.length + pushResult.duplicate.length === 0 && (
                          <p className="text-sm text-gray-500 italic text-center py-6">No details.</p>
                        )}
                      </div>
                      <div className="p-4 border-t border-gray-200 flex justify-end">
                        <button onClick={() => setPushResult(null)} className="px-4 py-2 text-sm text-indigo-700 hover:text-indigo-900 font-medium">Close</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pending jobs popup — click-to-inspect for "N pending" chip.
                    Every unexplained "Syncing... N pending" trains distrust;
                    this exposes what's actually queued so the accountant knows
                    whether to wait, cancel, or ignore. */}
                {showPendingJobsPopup && (
                  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPendingJobsPopup(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                      <div className="p-5 border-b border-gray-200 flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-800">Pending QBWC jobs</h3>
                          <p className="text-sm text-gray-600 mt-1">{qbPendingJobDetails.length} job{qbPendingJobDetails.length === 1 ? '' : 's'} waiting for QBWC to pick up (polls every ~15 min).</p>
                        </div>
                        <button onClick={() => setShowPendingJobsPopup(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
                      </div>
                      <div className="p-4 overflow-auto flex-1">
                        {qbPendingJobDetails.length === 0 ? (
                          <p className="text-sm text-gray-500 italic text-center py-6">Nothing pending — all drained.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead className="text-gray-500 border-b border-gray-200">
                              <tr>
                                <th className="px-2 py-1.5 text-left">Job</th>
                                <th className="px-2 py-1.5 text-left">Kind</th>
                                <th className="px-2 py-1.5 text-left">Source / audit tag</th>
                                <th className="px-2 py-1.5 text-left">Target</th>
                                <th className="px-2 py-1.5 text-right">Age</th>
                              </tr>
                            </thead>
                            <tbody>
                              {qbPendingJobDetails.map(j => {
                                const p = j.payload ?? {};
                                const source = (p.__source as string | undefined) ?? (p.__audit_tag as string | undefined) ?? '—';
                                const vendor = (p.entityVendorName as string | undefined) ?? (p.vendorName as string | undefined) ?? (p.payeeVendorName as string | undefined) ?? '';
                                const ref = (p.refNumber as string | undefined) ?? '';
                                const target = vendor || ref || (p.__source === 'pg_cron_delta_bills' ? '(all modified bills)' : '—');
                                const ageMs = Date.now() - new Date(j.created_at).getTime();
                                const ageMin = Math.floor(ageMs / 60000);
                                const ageLabel = ageMin < 1 ? '<1 min' : ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin/60)}h ${ageMin%60}m`;
                                return (
                                  <tr key={j.id} className="border-t border-gray-100">
                                    <td className="px-2 py-1 font-mono text-gray-500">{j.id}</td>
                                    <td className="px-2 py-1 font-mono text-gray-700">{j.kind}</td>
                                    <td className="px-2 py-1 text-gray-600">{source}</td>
                                    <td className="px-2 py-1 text-gray-700 truncate max-w-xs" title={target}>{target}</td>
                                    <td className="px-2 py-1 text-right text-gray-500">{ageLabel}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <div className="p-4 border-t border-gray-200 flex justify-between items-center">
                        <span className="text-xs text-gray-500">Refresh cadence: polled every 30s while this tab is open.</span>
                        <button onClick={() => setShowPendingJobsPopup(false)} className="px-4 py-2 text-sm text-indigo-700 hover:text-indigo-900 font-medium">Close</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slice 3: Needs vendor decision — approved invoices whose
                    payment profile isn't mapped to a QB vendor AND the
                    contractor's other profiles don't unambiguously agree on
                    one. Blocker: these are filtered out of Missing QB Bills
                    + Push modal until resolved. Click "Resolve" to open the
                    picker (Slice 2 modal). */}
                {needsVendorDecisionByInvoiceId.size > 0 && (() => {
                  const rows = [...needsVendorDecisionByInvoiceId.entries()]
                    .map(([invId, info]) => {
                      const inv = invoices.find(i => i.id === invId);
                      return inv ? { inv, info } : null;
                    })
                    .filter((x): x is { inv: Invoice; info: { snapCompany: string | null; conflictNames?: string[]; targetPaymentProfileId: number | null } } => x !== null)
                    .sort((a, b) => {
                      const d = (a.inv.periodEnd || '').localeCompare(b.inv.periodEnd || '');
                      if (d !== 0) return d;
                      return (a.inv.userName || '').localeCompare(b.inv.userName || '');
                    });
                  const total = rows.reduce((s, r) => s + r.inv.totalAmount, 0);
                  return (
                    <div className="mb-4 border border-red-300 rounded-lg overflow-hidden bg-red-50/40">
                      <button
                        onClick={() => toggle('needs_vendor_decision')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-red-100/40 text-left"
                      >
                        <div>
                          <span className="font-semibold text-red-900">Needs vendor decision — approved/paid invoices missing QB vendor mapping</span>
                          <span className="ml-2 text-sm text-red-800">· {rows.length} invoice{rows.length === 1 ? '' : 's'}</span>
                          {rows.length > 0 && <span className="ml-2 text-sm text-red-800">· {fmtMoney(total)}</span>}
                        </div>
                        <span className="text-xs text-red-700">{qbInboxExpanded['needs_vendor_decision'] ? '▼' : '▶'}</span>
                      </button>
                      {qbInboxExpanded['needs_vendor_decision'] && (
                        <div>
                          <p className="px-4 pt-3 text-xs text-gray-700 italic">
                            These invoices can't be pushed to QuickBooks yet — their payment profile isn't linked to a QB vendor and we can't infer one automatically. Click <strong>Resolve</strong> to pick an existing QB vendor (or create a new one, once that flow ships).
                          </p>
                          <table className="w-full text-xs mt-2">
                            <thead>
                              <tr className="bg-red-100/60 text-red-900">
                                <th className="px-3 py-1.5 text-left">Period end</th>
                                <th className="px-3 py-1.5 text-left">Contractor</th>
                                <th className="px-3 py-1.5 text-left">Invoice #</th>
                                <th className="px-3 py-1.5 text-right">Amount</th>
                                <th className="px-3 py-1.5 text-left">Payment profile</th>
                                <th className="px-3 py-1.5 text-left">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(({ inv, info }) => {
                                const targetPp = info.targetPaymentProfileId != null
                                  ? paymentProfiles.find(p => p.id === info.targetPaymentProfileId)
                                  : paymentProfiles.find(p => p.userId === inv.userId && p.isDefault);
                                const siblings = paymentProfiles.filter(p =>
                                  p.userId === inv.userId
                                  && p.id !== targetPp?.id
                                  && p.qbVendorName && p.qbVendorName.trim().length > 0
                                );
                                const distinct = new Set(siblings.map(s => s.qbVendorName!.trim()));
                                const hint = distinct.size === 1 ? [...distinct][0] : undefined;
                                return (
                                  <tr key={inv.id} className="border-t border-red-100 hover:bg-red-50/60">
                                    <td className="px-3 py-1.5">{inv.periodEnd || '—'}</td>
                                    <td className="px-3 py-1.5">{inv.userName}</td>
                                    <td className="px-3 py-1.5 font-mono">{inv.invoiceNumber}</td>
                                    <td className="px-3 py-1.5 text-right">{fmtMoney(inv.totalAmount)}</td>
                                    <td className="px-3 py-1.5">{info.snapCompany || targetPp?.companyName || '(no company)'}</td>
                                    <td className="px-3 py-1.5">
                                      <button
                                        onClick={() => {
                                          const finalTargetId = info.targetPaymentProfileId ?? targetPp?.id;
                                          if (!finalTargetId) {
                                            alert(`Contractor has no payment profile — add one on the Payments tab first.`);
                                            return;
                                          }
                                          const finalTargetPp = paymentProfiles.find(p => p.id === finalTargetId);
                                          setVendorDecisionState({
                                            invoice: inv,
                                            targetPaymentProfileId: finalTargetId,
                                            targetPaymentProfileCompany: info.snapCompany || finalTargetPp?.companyName || '',
                                            targetPaymentProfileIban: finalTargetPp?.iban ?? null,
                                            siblingVendorHint: hint,
                                            conflictNames: info.conflictNames,
                                            // No afterResolve — invoice will just fall out of this
                                            // bucket into Missing QB Bills / Push modal on next render.
                                            afterResolve: undefined,
                                          });
                                        }}
                                        className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-xs font-medium"
                                      >
                                        Resolve
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Missing QB bills — approved invoices lacking a QB Bill.
                    Read-only visibility. Actual push happens via the top-right
                    "Push to QB" button; G7.5 rows appear in the modal alongside
                    event-driven candidates for checkbox selection (Slice A). */}
                {(() => {
                  const totalAmt = missingBills.reduce((s, m) => s + m.invoice.totalAmount, 0);
                  return (
                    <div className="mb-4 border border-amber-200 rounded-lg overflow-hidden bg-amber-50/40">
                      <button
                        onClick={() => toggle('missing_bills')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100/40 text-left"
                      >
                        <div>
                          <span className="font-semibold text-amber-900">Missing QB bills — approved/paid invoices without a Bill in QB</span>
                          <span className="ml-2 text-sm text-amber-800">· {missingBills.length} invoice{missingBills.length === 1 ? '' : 's'}</span>
                          {missingBills.length > 0 && (
                            <span className="ml-2 text-sm text-amber-800">· {fmtMoney(totalAmt)}</span>
                          )}
                        </div>
                        <span className="text-xs text-amber-700">{qbInboxExpanded['missing_bills'] ? '▼' : '▶'}</span>
                      </button>
                      {qbInboxExpanded['missing_bills'] && (
                        <div>
                          {missingBills.length === 0 ? (
                            <p className="p-4 text-sm text-gray-500 italic">All approved invoices past their pre-our-system cutoff (Intuit {INTUIT_PRE_OUR_SYSTEM_CUTOFF} / Convera {CONVERA_PRE_OUR_SYSTEM_CUTOFF}) have a matching Bill in QB.</p>
                          ) : (
                            <>
                              <p className="px-4 pt-3 text-xs text-gray-600 italic">
                                Approved invoices in our system with no matching Bill in <code>qb_mirror</code>.
                                Intuit path: bill gets created on next payment push. Convera path: bill gets created by the batch script.
                              </p>
                              {(() => {
                                const chev = (k: MissingBillsSortKey) => missingBillsSortKey === k
                                  ? <span className="text-gray-600">{missingBillsSortDir === 'asc' ? '▲' : '▼'}</span>
                                  : <span className="text-gray-300">↕</span>;
                                const sTh = (k: MissingBillsSortKey, label: string, align: 'left' | 'right' = 'left') => (
                                  <SortableHeader onClick={() => toggleMissingBillsSort(k)} className="px-3 py-1.5" hoverClass="hover:bg-amber-50" align={align} indicator={<> {chev(k)}</>}>
                                    {label}
                                  </SortableHeader>
                                );
                                const dir = missingBillsSortDir === 'asc' ? 1 : -1;
                                const key = missingBillsSortKey;
                                const val = (m: typeof missingBills[0]): string | number => {
                                  if (key === 'period_end') return m.invoice.periodEnd ?? '';
                                  if (key === 'contractor') return (m.invoice.userName ?? '').toLowerCase();
                                  if (key === 'invoice_number') return (m.invoice.invoiceNumber ?? '').toLowerCase();
                                  if (key === 'amount') return m.invoice.totalAmount ?? 0;
                                  if (key === 'path') return m.paymentPath ?? '';
                                  if (key === 'qb_vendor') return (m.qbVendorName ?? '').toLowerCase();
                                  return '';
                                };
                                const sortedMissing = [...missingBills].sort((a, b) => {
                                  const va = val(a); const vb = val(b);
                                  if (va < vb) return -1 * dir;
                                  if (va > vb) return 1 * dir;
                                  return 0;
                                });
                                return (
                              <table className="w-full text-xs">
                                <thead className="bg-white text-gray-500 border-t border-b border-amber-200">
                                  <tr>
                                    {sTh('period_end', 'Period end')}
                                    {sTh('contractor', 'Contractor')}
                                    {sTh('invoice_number', 'Invoice #')}
                                    {sTh('amount', 'Amount', 'right')}
                                    {sTh('path', 'Path')}
                                    {sTh('qb_vendor', 'QB vendor')}
                                    <th className="px-3 py-1.5 text-left">Next action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortedMissing.map(m => {
                                    const pathClass = m.paymentPath === 'Intuit' ? 'bg-green-50 text-green-700'
                                                    : m.paymentPath === 'Convera' ? 'bg-purple-50 text-purple-700'
                                                    : 'bg-gray-100 text-gray-500';
                                    const nextAction = !m.vendorMapped
                                      ? <span className="text-red-600">map QB vendor first</span>
                                      : m.paymentPath === 'Intuit'
                                        ? <span className="text-gray-600">bill created at next Intuit payment</span>
                                        : m.paymentPath === 'Convera'
                                          ? <span className="text-gray-600">bill created by Convera batch</span>
                                          : <span className="text-red-600">assign payment method</span>;
                                    return (
                                      <tr key={m.invoice.id} className="border-t border-amber-100 hover:bg-amber-100/30">
                                        <td className="px-3 py-1.5 font-mono">{m.invoice.periodEnd}</td>
                                        <td className="px-3 py-1.5">{m.invoice.userName}</td>
                                        <td className="px-3 py-1.5 font-mono">{m.invoice.invoiceNumber}</td>
                                        <td className="px-3 py-1.5 text-right font-mono">{fmtMoney(m.invoice.totalAmount)}</td>
                                        <td className="px-3 py-1.5"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${pathClass}`}>{m.paymentPath}</span></td>
                                        <td className="px-3 py-1.5 text-gray-600">{m.qbVendorName || <span className="text-red-500">— unmapped —</span>}</td>
                                        <td className="px-3 py-1.5">{nextAction}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                                );
                              })()}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {groups.filter(g => g.events.length > 0 || (g.key !== 'posted' && g.key !== 'ignore')).map(g => {
                  // Slice B: posted section is month-rolled up. Each YYYY-MM is a
                  // clickable group. Current month expanded by default, older collapsed.
                  const postedMonthOf = (e: QbIngestEvent): string => {
                    const iso = e.statusUpdatedAt ?? e.txnDate;
                    return iso ? iso.slice(0, 7) : '';
                  };
                  const postedMonths = g.key === 'posted'
                    ? [...new Set(g.events.map(postedMonthOf).filter(Boolean))].sort().reverse()
                    : [];
                  const currentMonth = new Date().toISOString().slice(0, 7);
                  const postedEventsByMonth = new Map<string, QbIngestEvent[]>();
                  if (g.key === 'posted') {
                    for (const e of g.events) {
                      const m = postedMonthOf(e);
                      if (!m) continue;
                      const list = postedEventsByMonth.get(m) ?? [];
                      list.push(e);
                      postedEventsByMonth.set(m, list);
                    }
                  }
                  const totalAmt = g.events.reduce((s, e) => s + e.amount, 0);
                  const postedMonthLabel = (m: string) => {
                    if (!m) return '—';
                    const [y, mo] = m.split('-');
                    const d = new Date(Number(y), Number(mo) - 1, 1);
                    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
                  };
                  const monthExpanded = (m: string): boolean => {
                    const key = `posted_month_${m}`;
                    const explicit = qbInboxExpanded[key];
                    if (explicit != null) return explicit;
                    return m === currentMonth;   // default: current month expanded
                  };
                  const toggleMonth = (m: string) => setQbInboxExpanded(prev => ({ ...prev, [`posted_month_${m}`]: !monthExpanded(m) }));

                  // Row + header helpers — shared between per-month posted tables
                  // and the single-table non-posted buckets.
                  const badge = (bg: string, fg: string, text: string, title?: string) => (
                    <span title={title} className={`inline-block mr-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${bg} ${fg}`}>{text}</span>
                  );
                  const sortChevron = (k: PostedSortKey) => postedSortKey === k
                    ? <span className="text-gray-600">{postedSortDir === 'asc' ? '▲' : '▼'}</span>
                    : <span className="text-gray-300">↕</span>;
                  const sortableTh = (k: PostedSortKey, label: string, align: 'left' | 'right' = 'left') => (
                    <SortableHeader onClick={() => togglePostedSort(k)} className="px-3 py-1.5" hoverClass="hover:bg-gray-50" align={align} indicator={<> {sortChevron(k)}</>}>
                      {label}
                    </SortableHeader>
                  );
                  const renderPostedHeader = () => (
                    <thead className="bg-white text-gray-500 border-t border-b border-gray-200">
                      <tr>
                        {sortableTh('src', 'Src')}
                        {sortableTh('date', 'Date')}
                        {sortableTh('counterparty', 'Counterparty')}
                        {sortableTh('amount', 'Amount', 'right')}
                        {sortableTh('memo', 'Memo')}
                        <th className="px-3 py-1.5 text-left" title="Reconciler decision.">Resolved</th>
                        <th className="px-3 py-1.5 text-left" title="Invoice-link strength.">Provenance</th>
                        {sortableTh('posted_at', 'Posted at')}
                      </tr>
                    </thead>
                  );
                  const sortPosted = (events: QbIngestEvent[]): QbIngestEvent[] => {
                    const dir = postedSortDir === 'asc' ? 1 : -1;
                    const key = postedSortKey;
                    const val = (e: QbIngestEvent): string | number => {
                      if (key === 'src') return sourceLabel(e.source);
                      if (key === 'date') return e.txnDate ?? '';
                      if (key === 'counterparty') return (e.counterpartyRaw ?? '').toLowerCase();
                      if (key === 'amount') return e.amount ?? 0;
                      if (key === 'memo') return (e.memo ?? '').toLowerCase();
                      if (key === 'posted_at') return e.statusUpdatedAt ?? '';
                      return '';
                    };
                    return [...events].sort((a, b) => {
                      const va = val(a); const vb = val(b);
                      if (va < vb) return -1 * dir;
                      if (va > vb) return  1 * dir;
                      return 0;
                    });
                  };
                  const renderPostedRow = (e: QbIngestEvent): React.ReactNode => {
                    const resolvedBill = e.resolvedBillTxnId ? billByTxnId.get(e.resolvedBillTxnId) : undefined;
                    const isPosted = e.status === 'posted';
                    let resolvedCell: React.ReactNode = <span className="text-gray-400">—</span>;
                    if (e.resolvedAction === 'already_done') {
                      resolvedCell = badge('bg-green-100', 'text-green-700', resolvedBill ? `paid: ${resolvedBill.refNumber}` : 'paid', e.resolvedBillTxnId ?? undefined);
                    } else if (e.resolvedAction === 'pay_existing_bill') {
                      const label = isPosted
                        ? (resolvedBill ? `paid: ${resolvedBill.refNumber}` : 'paid bill')
                        : (resolvedBill ? `will pay: ${resolvedBill.refNumber}` : 'will pay bill');
                      resolvedCell = badge(isPosted ? 'bg-green-100' : 'bg-yellow-100', isPosted ? 'text-green-700' : 'text-yellow-700', label, e.resolvedBillTxnId ?? undefined);
                    } else if (e.resolvedAction === 'create_bill_then_pay') {
                      if (e.source === 'invoice_g75') {
                        resolvedCell = badge('bg-green-100', 'text-green-700', resolvedBill ? `created bill: ${resolvedBill.refNumber}` : 'created bill', e.resolvedBillTxnId ?? undefined);
                      } else {
                        const label = isPosted
                          ? (resolvedBill ? `created bill + paid: ${resolvedBill.refNumber}` : 'created bill + paid')
                          : 'will create bill + pay';
                        resolvedCell = badge(isPosted ? 'bg-green-100' : 'bg-blue-100', isPosted ? 'text-green-700' : 'text-blue-700', label, e.resolvedBillTxnId ?? undefined);
                      }
                    } else if (e.resolvedAction === 'check') {
                      const label = isPosted ? 'wrote check' : 'will write check';
                      resolvedCell = badge(isPosted ? 'bg-green-100' : 'bg-blue-100', isPosted ? 'text-green-700' : 'text-blue-700', label);
                    }
                    const provCell: React.ReactNode = e.matchProvenance
                      ? badge(
                          e.matchProvenance === 'exact-txn'   ? 'bg-emerald-100' :
                          e.matchProvenance === 'exact-ref'   ? 'bg-teal-100' :
                          e.matchProvenance === 'created-pay' ? 'bg-violet-100' :
                          e.matchProvenance === 'fuzzy'       ? 'bg-amber-100' : 'bg-gray-100',
                          e.matchProvenance === 'exact-txn'   ? 'text-emerald-800' :
                          e.matchProvenance === 'exact-ref'   ? 'text-teal-800' :
                          e.matchProvenance === 'created-pay' ? 'text-violet-800' :
                          e.matchProvenance === 'fuzzy'       ? 'text-amber-800' : 'text-gray-600',
                          e.matchProvenance === 'exact-txn'   ? '🔒 exact-txn' :
                          e.matchProvenance === 'exact-ref'   ? '✓ exact-ref' :
                          e.matchProvenance === 'created-pay' ? '🆕 created-pay' :
                          e.matchProvenance === 'fuzzy'       ? '~ fuzzy' : '— empty',
                        )
                      : <span className="text-gray-300">—</span>;
                    return (
                      <tr key={e.id} className="border-t border-gray-100 hover:bg-indigo-50/40">
                        <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 font-medium">{sourceLabel(e.source)}</span></td>
                        <td className="px-3 py-1.5 font-mono">{e.txnDate}</td>
                        <td className="px-3 py-1.5">{e.counterpartyRaw}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtMoney(e.amount)}</td>
                        <td className="px-3 py-1.5 text-gray-600 truncate max-w-xs" title={e.memo ?? ''}>{e.memo || '—'}</td>
                        <td className="px-3 py-1.5">{resolvedCell}</td>
                        <td className="px-3 py-1.5">{provCell}</td>
                        <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">
                          {e.statusUpdatedAt
                            ? new Date(e.statusUpdatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </td>
                      </tr>
                    );
                  };
                  const c = sectionColors[g.key] ?? sectionColors['ignore'];
                  return (
                  <div key={g.key} className={`mb-4 border ${c.border} rounded-lg overflow-hidden`}>
                    <button onClick={() => toggle(g.key)} className={`w-full flex items-center justify-between px-4 py-3 ${c.head} ${c.hover} text-left`}>
                      <div>
                        <span className={`font-semibold ${c.title}`}>{g.title}</span>
                        <span className="ml-2 text-sm text-gray-500">· {g.events.length} event{g.events.length === 1 ? '' : 's'}</span>
                        {g.events.length > 0 && (
                          <span className="ml-2 text-sm text-gray-500">· {fmtMoney(totalAmt)}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{qbInboxExpanded[g.key] ? '▼' : '▶'}</span>
                    </button>
                    {qbInboxExpanded[g.key] && (
                      <div>
                        {g.events.length === 0 ? (
                          <div className="p-4 text-sm text-gray-500 italic">{g.hint}</div>
                        ) : g.key === 'pending' ? (
                          <>
                            <p className="px-4 pt-3 text-xs text-gray-500 italic">{g.hint} Map each counterparty once — future imports auto-classify.</p>
                            <div className="p-3 space-y-2">
                              {(() => {
                                // Sub-group pending events by (source, counterpartyRaw) so accountant maps once per vendor.
                                const groupsByCp = new Map<string, { source: string; counterparty: string; events: QbIngestEvent[]; total: number }>();
                                for (const e of g.events) {
                                  const key = `${e.source}||${e.counterpartyRaw}`;
                                  const cur = groupsByCp.get(key) ?? { source: e.source, counterparty: e.counterpartyRaw, events: [], total: 0 };
                                  cur.events.push(e);
                                  cur.total += e.amount;
                                  groupsByCp.set(key, cur);
                                }
                                const list = [...groupsByCp.values()].sort((a, b) => a.counterparty.localeCompare(b.counterparty));
                                return list.map(grp => {
                                  return (
                                    <div key={grp.counterparty} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-100">
                                        <div>
                                          <span className="font-medium text-gray-800">{grp.counterparty}</span>
                                          <span className="ml-2 text-xs text-gray-500">{sourceLabel(grp.source)} · {grp.events.length} event{grp.events.length === 1 ? '' : 's'} · {fmtMoney(grp.total)}</span>
                                        </div>
                                        <button onClick={() => openMapWidget(grp.counterparty, grp.source, grp.events.length)} className="text-xs px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700">Map vendor</button>
                                      </div>
                                      <details className="text-xs">
                                        <summary className="px-3 py-1.5 cursor-pointer text-gray-500 hover:bg-gray-50">Show {grp.events.length} event{grp.events.length === 1 ? '' : 's'}</summary>
                                        <table className="w-full">
                                          <tbody>
                                            {grp.events.map(e => (
                                              <tr key={e.id} className="border-t border-gray-100">
                                                <td className="px-3 py-1 font-mono w-24">{e.txnDate}</td>
                                                <td className="px-3 py-1 text-right font-mono w-24">{fmtMoney(e.amount)}</td>
                                                <td className="px-3 py-1 text-gray-600">{e.memo || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </details>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </>
                        ) : g.key === 'posted' && postedMonths.length > 0 ? (
                          <>
                            <p className="px-4 pt-3 pb-2 text-xs text-gray-500 italic">{g.hint}</p>
                            {postedMonths.map(m => {
                              const monthEvents = postedEventsByMonth.get(m) ?? [];
                              const monthTotal = monthEvents.reduce((s, e) => s + e.amount, 0);
                              const isOpen = monthExpanded(m);
                              return (
                                <div key={m} className="border-t border-gray-100">
                                  <button onClick={() => toggleMonth(m)} className="w-full flex items-center justify-between px-4 py-2 bg-white hover:bg-gray-50 text-left text-sm">
                                    <div>
                                      <span className="font-semibold text-gray-700">{postedMonthLabel(m)}</span>
                                      <span className="ml-2 text-xs text-gray-500">· {monthEvents.length} event{monthEvents.length === 1 ? '' : 's'}</span>
                                      <span className="ml-2 text-xs text-gray-500">· <span className="font-mono">{fmtMoney(monthTotal)}</span></span>
                                    </div>
                                    <span className="text-xs text-gray-400">{isOpen ? '▼' : '▶'}</span>
                                  </button>
                                  {isOpen && (
                                    <table className="w-full text-xs">
                                      {renderPostedHeader()}
                                      <tbody>
                                        {sortPosted(monthEvents).map(e => renderPostedRow(e))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            <p className="px-4 pt-3 text-xs text-gray-500 italic">{g.hint}</p>
                            {(() => {
                              const chev = (k: NonPostedSortKey) => nonPostedSortKey === k
                                ? <span className="text-gray-600">{nonPostedSortDir === 'asc' ? '▲' : '▼'}</span>
                                : <span className="text-gray-300">↕</span>;
                              const sTh = (k: NonPostedSortKey, label: string, align: 'left' | 'right' = 'left') => (
                                <th className={`px-3 py-1.5 text-${align} cursor-pointer select-none hover:bg-gray-50`} onClick={() => toggleNonPostedSort(k)}>
                                  <span className="inline-flex items-center gap-1">{label} {chev(k)}</span>
                                </th>
                              );
                              const dir = nonPostedSortDir === 'asc' ? 1 : -1;
                              const key = nonPostedSortKey;
                              const val = (e: QbIngestEvent): string | number => {
                                if (key === 'src') return sourceLabel(e.source);
                                if (key === 'date') return e.txnDate ?? '';
                                if (key === 'counterparty') return (e.counterpartyRaw ?? '').toLowerCase();
                                if (key === 'amount') return e.amount ?? 0;
                                if (key === 'memo') return (e.memo ?? '').toLowerCase();
                                if (key === 'status') return e.status ?? '';
                                return '';
                              };
                              const sortedEvents = [...g.events].sort((a, b) => {
                                const va = val(a); const vb = val(b);
                                if (va < vb) return -1 * dir;
                                if (va > vb) return  1 * dir;
                                return 0;
                              });
                              return (
                            <table className="w-full text-xs">
                              <thead className="bg-white text-gray-500 border-t border-b border-gray-200">
                                <tr>
                                  {sTh('src', 'Src')}
                                  {sTh('date', 'Date')}
                                  {sTh('counterparty', 'Counterparty')}
                                  {sTh('amount', 'Amount', 'right')}
                                  {sTh('memo', 'Memo')}
                                  <th className="px-3 py-1.5 text-left" title="Reconciler decision.">Resolved</th>
                                  <th className="px-3 py-1.5 text-left" title="Invoice-link strength.">Provenance</th>
                                  {sTh('status', 'Status')}
                                  {g.key === 'already_done' && <th className="px-3 py-1.5 text-left">Actions (our system only)</th>}
                                  {(g.key === 'ignore' || g.key === 'ignore_backfill') && <th className="px-3 py-1.5 text-left">Actions</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {sortedEvents.map(e => {
                                  const resolvedBill = e.resolvedBillTxnId ? billByTxnId.get(e.resolvedBillTxnId) : undefined;
                                  const badge = (bg: string, fg: string, text: string, title?: string) => (
                                    <span title={title} className={`inline-block mr-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${bg} ${fg}`}>{text}</span>
                                  );
                                  // Tense-aware: use PAST for posted rows, FUTURE for everything else.
                                  // Rule per feedback_ux_consistency: every state variant of every column
                                  // must be considered together, not per-slice.
                                  const isPosted = e.status === 'posted';
                                  let resolvedCell: React.ReactNode = <span className="text-gray-400">—</span>;
                                  if (e.resolvedAction === 'pre_our_system') {
                                    resolvedCell = badge('bg-gray-100', 'text-gray-500', 'pre-cutoff · in QB', e.resolvedReason ?? undefined);
                                  } else if (e.resolvedAction === 'already_done') {
                                    resolvedCell = badge('bg-green-100', 'text-green-700', resolvedBill ? `paid: ${resolvedBill.refNumber}` : 'paid', e.resolvedBillTxnId ?? undefined);
                                  } else if (e.resolvedAction === 'pay_existing_bill') {
                                    const label = isPosted
                                      ? (resolvedBill ? `paid: ${resolvedBill.refNumber}` : 'paid bill')
                                      : (resolvedBill ? `will pay: ${resolvedBill.refNumber}` : 'will pay bill');
                                    resolvedCell = badge(isPosted ? 'bg-green-100' : 'bg-yellow-100', isPosted ? 'text-green-700' : 'text-yellow-700', label, e.resolvedBillTxnId ?? undefined);
                                  } else if (e.resolvedAction === 'create_bill_then_pay') {
                                    // G7.5 posted (source='invoice_g75'): bill created; pay comes via ingest event later.
                                    if (e.source === 'invoice_g75') {
                                      resolvedCell = badge('bg-green-100', 'text-green-700', resolvedBill ? `created bill: ${resolvedBill.refNumber}` : 'created bill', e.resolvedBillTxnId ?? undefined);
                                    } else {
                                      const label = isPosted
                                        ? (resolvedBill ? `created bill + paid: ${resolvedBill.refNumber}` : 'created bill + paid')
                                        : 'will create bill + pay';
                                      resolvedCell = badge(isPosted ? 'bg-green-100' : 'bg-blue-100', isPosted ? 'text-green-700' : 'text-blue-700', label, e.resolvedBillTxnId ?? undefined);
                                    }
                                  } else if (e.resolvedAction === 'check') {
                                    const label = isPosted ? 'wrote check' : 'will write check';
                                    resolvedCell = badge(isPosted ? 'bg-green-100' : 'bg-blue-100', isPosted ? 'text-green-700' : 'text-blue-700', label);
                                  } else if (e.resolvedAction === 'held') {
                                    resolvedCell = badge('bg-red-100', 'text-red-700', 'held', e.resolvedReason ?? undefined);
                                  }
                                  // Provenance chip — shown for events with an invoice concept.
                                  // Mirrors QbPushPreviewModal so accountant sees the invoice-link
                                  // strength in the same view where they'd trigger a push.
                                  const provRelevant = e.resolvedAction != null && e.resolvedAction !== 'pre_our_system' && e.resolvedAction !== 'check' && e.resolvedAction !== 'held';
                                  const provCell: React.ReactNode = provRelevant && e.matchProvenance
                                    ? badge(
                                        e.matchProvenance === 'exact-txn'   ? 'bg-emerald-100' :
                                        e.matchProvenance === 'exact-ref'   ? 'bg-teal-100' :
                                        e.matchProvenance === 'created-pay' ? 'bg-violet-100' :
                                        e.matchProvenance === 'fuzzy'       ? 'bg-amber-100' :
                                                                              'bg-gray-100',
                                        e.matchProvenance === 'exact-txn'   ? 'text-emerald-800' :
                                        e.matchProvenance === 'exact-ref'   ? 'text-teal-800' :
                                        e.matchProvenance === 'created-pay' ? 'text-violet-800' :
                                        e.matchProvenance === 'fuzzy'       ? 'text-amber-800' :
                                                                              'text-gray-600',
                                        e.matchProvenance === 'exact-txn'   ? '🔒 exact-txn' :
                                        e.matchProvenance === 'exact-ref'   ? '✓ exact-ref' :
                                        e.matchProvenance === 'created-pay' ? '🆕 created-pay' :
                                        e.matchProvenance === 'fuzzy'       ? '~ fuzzy' :
                                                                              '— empty',
                                        e.matchProvenance === 'exact-txn'   ? 'invoice.qb_bill_txn_id matches — deterministic 1:1 link' :
                                        e.matchProvenance === 'exact-ref'   ? 'memo names this invoice by number' :
                                        e.matchProvenance === 'created-pay' ? 'We created this bill (no matching invoice in our system) and paid it — vendor mapping authorizes this' :
                                        e.matchProvenance === 'fuzzy'       ? 'matched by vendor+amount only — verify before pushing' :
                                                                              'no invoice link',
                                      )
                                    : <span className="text-gray-300">—</span>;
                                  return (
                                    <tr key={e.id} className="border-t border-gray-100 hover:bg-indigo-50/40">
                                      <td className="px-3 py-1.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 font-medium">{sourceLabel(e.source)}</span></td>
                                      <td className="px-3 py-1.5 font-mono">{e.txnDate}</td>
                                      <td className="px-3 py-1.5">{e.counterpartyRaw}</td>
                                      <td className="px-3 py-1.5 text-right font-mono">{fmtMoney(e.amount)}</td>
                                      <td className="px-3 py-1.5 text-gray-600 truncate max-w-xs" title={e.memo ?? ''}>{e.memo || '—'}</td>
                                      <td className="px-3 py-1.5">{resolvedCell}</td>
                                      <td className="px-3 py-1.5">{provCell}</td>
                                      {g.key !== 'posted' && (
                                        <td className="px-3 py-1.5">
                                          {e.resolvedAction === 'pre_our_system'
                                            ? <span className="text-gray-500 italic">will not push</span>
                                            : <span className="text-gray-500">{e.status}</span>}
                                        </td>
                                      )}
                                      {g.key === 'already_done' && (
                                        <td className="px-3 py-1.5">
                                          <div className="flex gap-1">
                                            <button
                                              onClick={() => markAlreadyDonePreOurSystem(e.id)}
                                              className="text-[10px] px-2 py-0.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
                                              title="Predates our system's involvement. Moves to pre-cutoff bucket."
                                            >Pre-our-system</button>
                                            <button
                                              onClick={() => markAlreadyDoneOrphan(e.id)}
                                              className="text-[10px] px-2 py-0.5 border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
                                              title="Not related to any of our invoices. Moves to Ignore bucket."
                                            >Orphan</button>
                                            <button
                                              onClick={() => acceptAlreadyDoneFuzzyMatch(e.id)}
                                              className="text-[10px] px-2 py-0.5 border border-emerald-300 rounded text-emerald-700 hover:bg-emerald-50"
                                              title="Accept the fuzzy match. Marks event posted + writes qb_bill_txn_id back to our invoice(s)."
                                            >Accept match</button>
                                          </div>
                                        </td>
                                      )}
                                      {(g.key === 'ignore' || g.key === 'ignore_backfill') && (
                                        <td className="px-3 py-1.5">
                                          <button
                                            onClick={() => openMapWidget(e.counterpartyRaw, e.source, 0)}
                                            className="text-[10px] px-2 py-0.5 border border-indigo-300 rounded text-indigo-700 hover:bg-indigo-50"
                                            title="Reclassify: pick a new QB action + vendor. Applies to ALL events matching this counterparty (all future events too)."
                                          >Reclassify</button>
                                        </td>
                                      )}
                                      {g.key === 'posted' && (
                                        <td className="px-3 py-1.5 text-gray-500 font-mono text-[11px]">
                                          {e.statusUpdatedAt
                                            ? new Date(e.statusUpdatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                            : '—'}
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            );
          })()}


          {accountantTab === 'profiles' && (
            <PaymentProfilesTab
              users={users}
              paymentProfiles={paymentProfiles}
              invoices={invoices}
              converaBeneficiaries={converaBeneficiaries}
              profileTabSearch={profileTabSearch}
              setProfileTabSearch={setProfileTabSearch}
              profileTabFilter={profileTabFilter}
              setProfileTabFilter={setProfileTabFilter}
              qbVendorEditingId={qbVendorEditingId}
              setQbVendorEditingId={setQbVendorEditingId}
              setSelectedInvoice={setSelectedInvoice}
              setShowInvoiceModal={setShowInvoiceModal}
              setEditingProfile={setEditingProfile}
              setProfileEditUserId={setProfileEditUserId}
              setProfileForm={setProfileForm}
              setShowProfileModal={setShowProfileModal}
              setBeneficiaryOverrideProfileId={setBeneficiaryOverrideProfileId}
              setShowConveraImport={setShowConveraImport}
              loadConveraBeneficiaries={loadConveraBeneficiaries}
              saveQbVendorName={saveQbVendorName}
              deletePaymentProfile={deletePaymentProfile}
              openTemplateProfileModal={openTemplateProfileModal}
              emptyProfileForm={emptyProfileForm}
            />
          )}

          <TemplateProfileModal
            open={showTemplateProfileModal}
            onClose={() => setShowTemplateProfileModal(false)}
            users={users}
            templateProfileUserId={templateProfileUserId}
            templateProfileText={templateProfileText}
            setTemplateProfileText={setTemplateProfileText}
            templateProfilePreview={templateProfilePreview}
            setTemplateProfilePreview={setTemplateProfilePreview}
            templateProfileError={templateProfileError}
            templateProfileSaving={templateProfileSaving}
            onParse={parseTemplateForPreview}
            onSave={saveTemplateProfile}
          />

          {/* Convera Batch Preview Modal */}
          <ConveraBatchModal
            open={showConveraBatchModal}
            onClose={() => setShowConveraBatchModal(false)}
            groups={converaBatchGroups}
            combine={converaBatchCombine}
            setCombine={setConveraBatchCombine}
            skipped={converaBatchSkipped}
            excluded={converaBatchExcluded}
            manualRows={converaBatchManualRows}
            setManualRows={setConveraBatchManualRows}
            manualEditor={converaBatchManualEditor}
            setManualEditor={setConveraBatchManualEditor}
            converaBeneficiaries={converaBeneficiaries}
            copiedIntuitField={copiedIntuitField}
            copyIntuitField={copyIntuitField}
            onDownload={downloadConveraBatchCSV}
          />

          {/* Intuit Batch popup — copy-paste aid for manual entry into Intuit Online Payment */}
          <IntuitBatchModal
            open={showIntuitBatchModal}
            onClose={() => setShowIntuitBatchModal(false)}
            invoices={intuitBatchInvoices}
            copiedIntuitField={copiedIntuitField}
            copyIntuitField={copyIntuitField}
          />

          {/* QB Export Modal (Chunk 2a — read-only preview) */}
          {showQbExportModal && (() => {
            // Build rows from the current invoice filter
            const findLivePp = (inv: Invoice) => resolveLivePaymentProfile(inv, paymentProfiles);
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const fmtPeriod = (start: string, end: string) => {
              if (!start) return '—';
              const [sy, sm] = start.split('-').map(Number);
              const em = (end || start).split('-').map(Number)[1];
              return sm === em ? `${months[sm-1]} ${sy}` : `${months[sm-1]}–${months[em-1]} ${sy}`;
            };
            type Row = { inv: Invoice; livePp: PaymentProfile | null; vendorName: string | null; category: 'ready' | 'no_vendor' | 'exported' | 'confirmed' | 'skipped' };
            const rows: Row[] = qbExportSnapshot.map(inv => {
              const livePp = findLivePp(inv);
              const vendorName = livePp?.qbVendorName || null;
              let category: Row['category'] = 'ready';
              if (inv.qbExportStatus === 'skipped') category = 'skipped';
              else if (inv.qbExportStatus === 'confirmed') category = 'confirmed';
              else if (inv.qbExportStatus === 'exported') category = 'exported';
              else if (!vendorName) category = 'no_vendor';
              return { inv, livePp, vendorName, category };
            });
            const selectedRows = rows.filter(r => qbExportSelectedIds.has(r.inv.id));
            const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.inv.totalAmount || 0), 0);
            const counts = {
              ready: rows.filter(r => r.category === 'ready').length,
              no_vendor: rows.filter(r => r.category === 'no_vendor').length,
              exported: rows.filter(r => r.category === 'exported').length,
              confirmed: rows.filter(r => r.category === 'confirmed').length,
              skipped: rows.filter(r => r.category === 'skipped').length,
            };
            const skippedButExcludable = rows.filter(r => r.category !== 'ready' && r.category !== 'skipped');
            const includeAllSkipped = () => {
              const next = new Set(qbExportSelectedIds);
              for (const r of skippedButExcludable) next.add(r.inv.id);
              setQbExportSelectedIds(next);
            };
            const toggleOne = (id: number) => {
              const next = new Set(qbExportSelectedIds);
              if (next.has(id)) next.delete(id); else next.add(id);
              setQbExportSelectedIds(next);
            };
            // Apply category filter for the visible rows
            const visibleRows = rows.filter(r => {
              if (!qbExportCategoryFilter) return true;
              if (qbExportCategoryFilter === 'selected')     return qbExportSelectedIds.has(r.inv.id);
              if (qbExportCategoryFilter === 'ready')        return r.category === 'ready';
              if (qbExportCategoryFilter === 'no_vendor')    return r.category === 'no_vendor';
              if (qbExportCategoryFilter === 'already_sent') return r.category === 'exported' || r.category === 'confirmed';
              if (qbExportCategoryFilter === 'skipped')      return r.category === 'skipped';
              return true;
            });
            const toggleCategoryFilter = (cat: typeof qbExportCategoryFilter) => {
              setQbExportCategoryFilter(prev => prev === cat ? null : cat);
            };
            // Distinct QB vendor suggestions from all payment profiles (autocomplete source)
            const qbVendorSuggestions = Array.from(new Set(paymentProfiles.map(p => p.qbVendorName).filter((v): v is string => !!v))).sort();
            const cardCls = (cat: typeof qbExportCategoryFilter, bg: string, border: string) =>
              `text-left rounded-lg p-3 border-2 transition-all cursor-pointer ${
                qbExportCategoryFilter === cat
                  ? `${bg} ${border} ring-2 ring-offset-1 ring-blue-400`
                  : `${bg} ${border} hover:brightness-95`
              }`;
            const CATEGORY_BADGE: Record<Row['category'], { label: string; color: string }> = {
              ready:     { label: 'Ready',       color: 'bg-green-100 text-green-800' },
              no_vendor: { label: 'No QB vendor', color: 'bg-amber-100 text-amber-800' },
              exported:  { label: 'Exported',    color: 'bg-blue-100 text-blue-800' },
              confirmed: { label: 'Confirmed',   color: 'bg-indigo-100 text-indigo-800' },
              skipped:   { label: 'Skipped',     color: 'bg-gray-200 text-gray-700' },
            };
            return (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowQbExportModal(false)}>
                <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  {/* Sticky header with running tally */}
                  <div className="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-lg font-bold text-gray-800">Export to QuickBooks (IIF)</h2>
                      <button onClick={() => setShowQbExportModal(false)} className="text-gray-500 hover:text-gray-700 text-xl leading-none">✕</button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                      <button type="button" onClick={() => toggleCategoryFilter('selected')} className={cardCls('selected', 'bg-blue-50', 'border-blue-200')}>
                        <div className="text-xs uppercase font-semibold text-blue-700">Selected</div>
                        <div className="text-2xl font-bold text-blue-900">{qbExportSelectedIds.size}<span className="text-sm font-normal text-blue-500"> / {rows.length}</span></div>
                        <div className="text-xs text-blue-600 mt-1">${selectedTotal.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                      </button>
                      <button type="button" onClick={() => toggleCategoryFilter('ready')} className={cardCls('ready', 'bg-green-50', 'border-green-200')}>
                        <div className="text-xs uppercase font-semibold text-green-700">Ready</div>
                        <div className="text-2xl font-bold text-green-900">{counts.ready}</div>
                      </button>
                      <button type="button" onClick={() => toggleCategoryFilter('no_vendor')} className={cardCls('no_vendor', 'bg-amber-50', 'border-amber-200')}>
                        <div className="text-xs uppercase font-semibold text-amber-700">No QB Vendor</div>
                        <div className="text-2xl font-bold text-amber-900">{counts.no_vendor}</div>
                      </button>
                      <button type="button" onClick={() => toggleCategoryFilter('already_sent')} className={cardCls('already_sent', 'bg-indigo-50', 'border-indigo-200')}>
                        <div className="text-xs uppercase font-semibold text-indigo-700">Already Sent</div>
                        <div className="text-2xl font-bold text-indigo-900">{counts.exported + counts.confirmed}</div>
                        <div className="text-xs text-indigo-600 mt-1">{counts.exported} exported · {counts.confirmed} confirmed</div>
                      </button>
                      <button type="button" onClick={() => toggleCategoryFilter('skipped')} className={cardCls('skipped', 'bg-gray-50', 'border-gray-200')}>
                        <div className="text-xs uppercase font-semibold text-gray-600">Skipped</div>
                        <div className="text-2xl font-bold text-gray-800">{counts.skipped}</div>
                      </button>
                    </div>
                    {qbExportCategoryFilter && (
                      <div className="mt-2 text-xs text-gray-600 italic">
                        Showing {visibleRows.length} of {rows.length} — filtered by <strong>{qbExportCategoryFilter.replace('_', ' ')}</strong>.
                        <button onClick={() => setQbExportCategoryFilter(null)} className="ml-2 text-blue-600 hover:underline">Clear</button>
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button onClick={includeAllSkipped} className="text-xs px-3 py-1.5 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 text-gray-700">Include Skipped/Already-Sent</button>
                      <button onClick={() => setQbExportSelectedIds(new Set())} className="text-xs px-3 py-1.5 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 text-gray-700">Clear selection</button>
                    </div>
                  </div>
                  {/* Table */}
                  <div className="overflow-auto flex-1">
                    <datalist id="qb-vendor-suggestions-modal">
                      {qbVendorSuggestions.map(v => <option key={v} value={v} />)}
                    </datalist>
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-center font-semibold text-gray-600 w-10">Inc</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Contractor</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-gray-600 whitespace-nowrap">Period</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-gray-600">QB Vendor</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Hrs</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Rate</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-gray-600">Total</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-gray-600">Status</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-gray-600 w-16">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleRows.map(r => {
                          const badge = CATEGORY_BADGE[r.category];
                          const isChecked = qbExportSelectedIds.has(r.inv.id);
                          const isEditingVendor = r.livePp && qbVendorEditingId === r.livePp.id;
                          const jumpToPaymentProfiles = () => {
                            setProfileTabSearch(r.inv.userName);
                            setProfileTabFilter('all');
                            setShowQbExportModal(false);
                            setAccountantTab('profiles');
                          };
                          return (
                            <tr key={r.inv.id} className={isChecked ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}>
                              <td className="px-2 py-1 text-center">
                                <input type="checkbox" checked={isChecked} onChange={() => toggleOne(r.inv.id)} className="rounded" />
                              </td>
                              <td className="px-2 py-1 font-medium text-gray-800 whitespace-nowrap">{r.inv.userName}</td>
                              <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{fmtPeriod(r.inv.periodStart, r.inv.periodEnd)}</td>
                              <td className="px-2 py-1">
                                {isEditingVendor && r.livePp ? (
                                  <QbVendorNameEditor
                                    initialValue={r.vendorName || ''}
                                    suggestions={qbVendorSuggestions}
                                    placeholder="Type or pick..."
                                    inputMinWidth={180}
                                    onSave={(v) => { if (r.livePp) { saveQbVendorName(r.livePp.id, v); } setQbVendorEditingId(null); }}
                                    onCancel={() => setQbVendorEditingId(null)}
                                  />
                                ) : r.livePp ? (
                                  <button
                                    onClick={() => setQbVendorEditingId(r.livePp!.id)}
                                    className={'text-left hover:underline ' + (r.vendorName ? 'text-gray-700' : 'text-amber-600 italic')}
                                    title="Click to edit (persistent — updates payment profile)"
                                  >
                                    {r.vendorName || '(unmapped — click to set)'}
                                  </button>
                                ) : (
                                  <button
                                    onClick={jumpToPaymentProfiles}
                                    className="text-left text-red-600 italic hover:underline"
                                    title="No payment profile for this invoice. Click to jump to Payment Profiles tab and create one."
                                  >
                                    ⚠ create payment profile →
                                  </button>
                                )}
                              </td>
                              <td className="px-2 py-1 text-right font-mono text-gray-700 whitespace-nowrap">{r.inv.totalHours ?? '—'}</td>
                              <td className="px-2 py-1 text-right font-mono text-gray-700 whitespace-nowrap">{r.inv.rate != null ? `$${r.inv.rate}` : '—'}</td>
                              <td className="px-2 py-1 text-right font-mono font-semibold text-gray-800 whitespace-nowrap">${Number(r.inv.totalAmount).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})} {r.inv.currency}</td>
                              <td className="px-2 py-1 whitespace-nowrap"><span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.color}`}>{badge.label}</span></td>
                              <td className="px-2 py-1 text-right whitespace-nowrap">
                                {r.category === 'skipped' ? (
                                  <button onClick={() => saveInvoiceExportStatus(r.inv.id, 'not_exported')} className="text-xs text-blue-600 hover:underline">Unskip</button>
                                ) : r.category === 'exported' ? (
                                  <button onClick={() => saveInvoiceExportStatus(r.inv.id, 'confirmed')} className="text-xs text-indigo-700 font-semibold hover:underline">Confirm</button>
                                ) : r.category === 'confirmed' ? (
                                  <span className="text-xs text-gray-400">done</span>
                                ) : r.category === 'ready' || r.category === 'no_vendor' ? (
                                  <button onClick={() => { if (confirm(`Skip invoice ${r.inv.invoiceNumber} for ${r.inv.userName}? It will be permanently excluded from future QB exports until you unskip it.`)) saveInvoiceExportStatus(r.inv.id, 'skipped'); }} className="text-xs text-gray-600 hover:text-red-700 hover:underline">Skip</button>
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {visibleRows.length === 0 && (
                          <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">{qbExportCategoryFilter ? `No rows match the ${qbExportCategoryFilter.replace('_', ' ')} filter.` : 'No invoices in the current filter.'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {/* Footer */}
                  <div className="p-3 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
                    <button onClick={() => setShowQbExportModal(false)} className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 text-sm">Close</button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Manual Invoice Modal — Slice M3 */}
          <ManualInvoiceModal
            open={showManualInvoiceModal}
            onClose={() => setShowManualInvoiceModal(false)}
            users={users.map(u => ({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              countryCode: u.country || null,
              projectId: u.projectId,
              invoiceEnabled: u.invoiceEnabled,
              paymentTerms: u.paymentTerms,
            }))}
            paymentProfiles={paymentProfiles.map(p => ({
              id: p.id,
              userId: p.userId,
              profileName: p.profileName,
              companyName: p.companyName,
              iban: p.iban,
              swift: p.swift,
              bankName: p.bankName,
              qbVendorName: p.qbVendorName,
              isDefault: p.isDefault,
              paymentEmail: p.paymentEmail,
              bankAddress: p.bankAddress,
              bankBranch: p.bankBranch,
              companyAddress: p.companyAddress,
              country: p.country,
              converaBeneficiaryId: p.converaBeneficiaryId ?? null,
            }))}
            converaBeneficiaries={converaBeneficiaries.map(b => ({
              id: b.id,
              shortName: b.shortName,
              beneficiaryName: b.beneficiaryName,
              vendorId: b.vendorId,
              bankName: b.bankName,
              bankAccount: b.bankAccount,
              currency: b.currency,
            }))}
            invoices={invoices.map(i => ({
              id: i.id,
              userId: i.userId,
              periodStart: i.periodStart,
              invoiceNumber: i.invoiceNumber,
              status: i.status,
            }))}
            timesheets={timesheets.map(t => ({
              id: t.id,
              userId: t.userId,
              weekStart: t.weekStart,
              status: t.status,
              entries: Object.fromEntries(Object.entries(t.entries).map(([k, v]) => [k, { hours: v.hours }])),
            }))}
            currentAccountantId={currentUser.id}
            onCreated={() => { fetchUsers(); fetchPaymentProfiles(); fetchInvoices(); }}
            paymentMethodFromProfile={(profile) => {
              if (!profile) return '';
              // Simplified — no full invoice context here, so we do a country-based fallback
              // consistent with paymentMethod() elsewhere.
              const c = (profile.country || '').toUpperCase();
              return c === 'US' ? 'Intuit' : 'Convera';
            }}
          />

          {/* Convera Matching Modal */}
          {showConveraMatchingModal && (() => {
            // Build contractor groups; last payment date from convera_transactions via converaLastPaymentDates
            type ProfileRow = { profile: PaymentProfile; benef: ConveraBeneficiary | undefined; lastUsed: string | undefined };
            const groupMap = new Map<string, { userName: string; rows: ProfileRow[] }>();
            for (const p of paymentProfiles) {
              const user = users.find(u => u.id === p.userId);
              const userName = user?.name || '(unknown)';
              const benef = converaBeneficiaries.find(b => b.id === p.converaBeneficiaryId);
              // Last payment date = most recent Convera transaction date for this profile's beneficiary
              const lastUsed = p.converaBeneficiaryId != null
                ? converaLastPaymentDates.get(p.converaBeneficiaryId)
                : undefined;
              if (!groupMap.has(p.userId)) groupMap.set(p.userId, { userName, rows: [] });
              groupMap.get(p.userId)!.rows.push({ profile: p, benef, lastUsed });
            }

            // Sort within each group: default first, then by last used desc
            for (const g of groupMap.values()) {
              g.rows.sort((a, b) => {
                if (a.profile.isDefault !== b.profile.isDefault) return a.profile.isDefault ? -1 : 1;
                const da = a.lastUsed || '';
                const db = b.lastUsed || '';
                return db.localeCompare(da);
              });
            }

            // Filter and sort groups
            const q = converaMatchingSearch.toLowerCase();
            const groups = [...groupMap.values()]
              .filter(g => {
                if (!q) return true;
                if (g.userName.toLowerCase().includes(q)) return true;
                return g.rows.some(r =>
                  (r.profile.iban || '').toLowerCase().includes(q) ||
                  (r.benef?.shortName || '').toLowerCase().includes(q) ||
                  (r.profile.profileName || '').toLowerCase().includes(q)
                );
              })
              .sort((a, b) => a.userName.localeCompare(b.userName));

            const totalProfiles = groups.reduce((n, g) => n + g.rows.length, 0);
            const unmatchedProfiles = groups.reduce((n, g) => n + g.rows.filter(r => !r.benef).length, 0);
            const overrideProfiles = groups.reduce((n, g) => n + g.rows.filter(r => r.profile.converaMatchOverride).length, 0);

            const fmtDate = (d: string | undefined) => {
              if (!d) return null;
              const dt = new Date(d);
              return isNaN(dt.getTime()) ? null : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
            };

            return (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
                onClick={() => { setShowConveraMatchingModal(false); setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); setConveraMatchingSearch(''); }}>
                <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Convera Beneficiary Matching</h2>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {groups.length} contractors · {totalProfiles} profiles
                        {unmatchedProfiles > 0
                          ? <span className="text-amber-600 font-medium ml-1">· {unmatchedProfiles} unmatched</span>
                          : <span className="text-green-600 font-medium ml-1">· all matched</span>}
                        {overrideProfiles > 0 && <span className="text-violet-600 font-medium ml-1">· {overrideProfiles} manual</span>}
                      </p>
                    </div>
                    <button onClick={() => { setShowConveraMatchingModal(false); setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); setConveraMatchingSearch(''); }}
                      className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>

                  <div className="px-6 pt-3 pb-2 border-b border-gray-100 flex items-center gap-1">
                    <button onClick={() => setConveraMatchingView('profiles')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${converaMatchingView === 'profiles' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>
                      Profile Matching
                    </button>
                    <button onClick={() => setConveraMatchingView('beneficiaries')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${converaMatchingView === 'beneficiaries' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>
                      All Beneficiaries
                    </button>
                  </div>

                  <div className="px-6 py-3 border-b border-gray-100">
                    <input type="text" value={converaMatchingSearch} onChange={e => setConveraMatchingSearch(e.target.value)}
                      placeholder={converaMatchingView === 'profiles'
                        ? 'Search by contractor, profile name, short name, or IBAN…'
                        : 'Search by short name, beneficiary name, vendor ID, or bank account…'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>

                  <div className="overflow-y-auto flex-1">
                    {converaMatchingView === 'profiles' && (
                    <table className="w-full text-sm border-collapse">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 border-b border-gray-200 w-48">Profile / IBAN</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 border-b border-gray-200">Convera Short Name</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 border-b border-gray-200">Beneficiary Name</th>
                          <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600 border-b border-gray-200 w-20">Last Used</th>
                          <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600 border-b border-gray-200 w-20">Match</th>
                          <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-600 border-b border-gray-200 w-24">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map(({ userName, rows }) => (
                          <>
                            {/* Contractor group header */}
                            <tr key={`hdr-${rows[0].profile.userId}`} className="bg-gray-100 border-t-2 border-gray-200">
                              <td colSpan={6} className="px-4 py-2">
                                <span className="font-semibold text-gray-800 text-sm">{userName}</span>
                                {rows.length > 1 && (
                                  <span className="ml-2 text-xs text-gray-400">{rows.length} profiles</span>
                                )}
                                {rows.some(r => !r.benef) && (
                                  <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                                    {rows.filter(r => !r.benef).length} unmatched
                                  </span>
                                )}
                              </td>
                            </tr>
                            {/* Profile sub-rows */}
                            {rows.map(({ profile, benef, lastUsed }) => (
                              <tr key={profile.id}
                                className={`border-b border-gray-100 ${profile.isDefault ? 'bg-green-50 border-l-4 border-l-green-400' : 'hover:bg-gray-50'}`}>
                                <td className="px-4 py-2.5 pl-8">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs text-gray-700">{profile.profileName || '—'}</span>
                                    {profile.isDefault && (
                                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Default</span>
                                    )}
                                  </div>
                                  {(() => {
                                    const ibanCheck = profile.iban ? checkIbanLength(profile.iban) : null;
                                    return (
                                      <div className="flex items-baseline gap-1.5 flex-wrap mt-0.5">
                                        <span className="font-mono text-xs text-gray-400">{profile.iban || profile.accountNumber || '—'}</span>
                                        {ibanCheck && !ibanCheck.ok && (
                                          <span className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1 py-0.5" title="Edit this profile — IBAN length is wrong for its country">
                                            ⚠ IBAN len {ibanCheck.actual}/{ibanCheck.expected}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </td>
                                <td className="px-4 py-2.5">
                                  {benef
                                    ? <span className="font-mono text-xs text-gray-700">{benef.shortName}</span>
                                    : <span className="text-amber-600 text-xs font-medium">Not matched</span>}
                                  {benef && !profile.converaMatchOverride && (() => {
                                    const pIban = sanitizeIban(profile.iban || '');
                                    const bIban = sanitizeIban(benef.bankAccount || '');
                                    if (pIban && bIban && pIban !== bIban) {
                                      return (
                                        <div className="mt-0.5 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1 py-0.5 inline-block" title="Profile IBAN does not match this beneficiary's bank account. Verify before paying — a wrong link routes payment to the wrong contractor.">
                                          ⚠ IBAN mismatch — verify
                                        </div>
                                      );
                                    }
                                    return null;
                                  })()}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-500">{benef?.beneficiaryName || '—'}</td>
                                <td className="px-4 py-2.5 text-center text-xs text-gray-400">
                                  {fmtDate(lastUsed) || <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  {!benef
                                    ? <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">None</span>
                                    : profile.converaMatchOverride
                                      ? <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-xs">⚡ Manual</span>
                                      : <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">✓ Auto</span>}
                                </td>
                                <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                  {beneficiaryOverrideProfileId === profile.id ? (
                                    <div className="text-left border border-indigo-200 rounded-lg p-2 bg-indigo-50 w-72 -ml-32">
                                      <input type="text" value={beneficiaryOverrideSearch} onChange={e => setBeneficiaryOverrideSearch(e.target.value)}
                                        placeholder="Search…" autoFocus
                                        className="w-full px-2 py-1 border border-indigo-200 rounded text-xs mb-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                                      <div className="max-h-32 overflow-y-auto divide-y divide-indigo-100">
                                        {converaBeneficiaries
                                          .filter(b => !beneficiaryOverrideSearch || b.shortName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()) || b.beneficiaryName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()))
                                          .slice(0, 12)
                                          .map(b => (
                                            <button key={b.id} onClick={() => setConveraOverride(profile.id, b.id)}
                                              className="w-full text-left px-2 py-1 hover:bg-indigo-100 text-xs">
                                              <span className="font-mono text-indigo-700 block">{b.shortName}</span>
                                              <span className="text-gray-400">{b.bankAccount}</span>
                                            </button>
                                          ))}
                                      </div>
                                      <div className="flex gap-2 mt-1.5 pt-1.5 border-t border-indigo-100">
                                        {benef && <button onClick={() => setConveraOverride(profile.id, null)} className="text-xs text-red-500 hover:underline">Clear</button>}
                                        <button onClick={() => { setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); }} className="text-xs text-gray-500 hover:underline ml-auto">Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button onClick={() => { setBeneficiaryOverrideProfileId(profile.id); setBeneficiaryOverrideSearch(''); }}
                                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-100 text-gray-600">
                                      {benef ? 'Change' : 'Link'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </>
                        ))}
                      </tbody>
                    </table>
                    )}

                    {converaMatchingView === 'beneficiaries' && (() => {
                      const q = converaMatchingSearch.toLowerCase();
                      // Total counts (pre-filter) for the pills
                      const totalAll = converaBeneficiaries.length;
                      const totalWithVendor = converaBeneficiaries.filter(b => !!b.vendorId).length;
                      const totalWithoutVendor = totalAll - totalWithVendor;
                      const beneRows = converaBeneficiaries
                        .filter(b => {
                          if (beneficiaryFilter === 'with_vendor' && !b.vendorId) return false;
                          if (beneficiaryFilter === 'without_vendor' && b.vendorId) return false;
                          if (!q) return true;
                          return (b.shortName || '').toLowerCase().includes(q)
                            || (b.beneficiaryName || '').toLowerCase().includes(q)
                            || (b.vendorId || '').toLowerCase().includes(q)
                            || (b.bankAccount || '').toLowerCase().includes(q)
                            || (b.beneficiaryCountry || '').toLowerCase().includes(q);
                        })
                        .map(b => {
                          const linkedProfiles = paymentProfiles.filter(p => p.converaBeneficiaryId === b.id);
                          const lastUsed = converaLastPaymentDates.get(b.id);
                          return { b, linkedProfiles, lastUsed };
                        });
                      // Sort by the column the user selected
                      const dir = beneficiarySort.dir === 'asc' ? 1 : -1;
                      const vendorNum = (v: string | null) => {
                        const m = (v || '').match(/^SYN-(\d+)$/i);
                        return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; // unvendored sorts last on asc
                      };
                      beneRows.sort((a, b) => {
                        switch (beneficiarySort.key) {
                          case 'shortName': return dir * (a.b.shortName || '').localeCompare(b.b.shortName || '');
                          case 'vendorId':  return dir * (vendorNum(a.b.vendorId) - vendorNum(b.b.vendorId));
                          case 'bankAccount': return dir * (a.b.bankAccount || '').localeCompare(b.b.bankAccount || '');
                          case 'country':   return dir * (a.b.beneficiaryCountry || '').localeCompare(b.b.beneficiaryCountry || '');
                          case 'lastUsed':  return dir * ((a.lastUsed || '').localeCompare(b.lastUsed || ''));
                          case 'linked':    return dir * (a.linkedProfiles.length - b.linkedProfiles.length);
                        }
                      });
                      const toggleSort = (key: BeneficiarySortKey) => {
                        setBeneficiarySort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'lastUsed' || key === 'linked' ? 'desc' : 'asc' });
                      };
                      const sortIndicator = (key: BeneficiarySortKey) => beneficiarySort.key === key ? (beneficiarySort.dir === 'asc' ? ' ↑' : ' ↓') : '';
                      return (
                        <div>
                          <div className="px-6 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2 flex-wrap">
                            <FilterPills<BeneficiaryFilter>
                              options={[
                                { value: 'all',            label: `All: ${totalAll}`,                       tone: 'bg-gray-100 text-gray-700' },
                                { value: 'with_vendor',    label: `With Vendor ID: ${totalWithVendor}`,     tone: 'bg-indigo-100 text-indigo-700' },
                                { value: 'without_vendor', label: `Without: ${totalWithoutVendor}`,         tone: 'bg-amber-100 text-amber-700' },
                              ]}
                              selected={beneficiaryFilter}
                              onChange={setBeneficiaryFilter}
                            />
                            <span className="ml-auto text-xs text-gray-500">Showing {beneRows.length}</span>
                          </div>
                          <table className="w-full text-sm border-collapse">
                            <thead className="bg-gray-50 sticky top-0 z-10">
                              <tr>
                                <SortableHeader onClick={() => toggleSort('shortName')}   className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-200"      indicator={sortIndicator('shortName')}>Short Name / Beneficiary</SortableHeader>
                                <SortableHeader onClick={() => toggleSort('vendorId')}    className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-200 w-32" indicator={sortIndicator('vendorId')}>Vendor ID</SortableHeader>
                                <SortableHeader onClick={() => toggleSort('bankAccount')} className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-200 w-56" indicator={sortIndicator('bankAccount')}>Bank Account</SortableHeader>
                                <SortableHeader onClick={() => toggleSort('country')}     className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-200 w-40" indicator={sortIndicator('country')}>Country / Currency</SortableHeader>
                                <SortableHeader onClick={() => toggleSort('lastUsed')}    className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-200 w-20" align="center" indicator={sortIndicator('lastUsed')}>Last Used</SortableHeader>
                                <SortableHeader onClick={() => toggleSort('linked')}      className="px-4 py-2.5 text-xs font-semibold text-gray-600 border-b border-gray-200 w-24" align="center" indicator={sortIndicator('linked')}>Linked</SortableHeader>
                              </tr>
                            </thead>
                            <tbody>
                              {beneRows.map(({ b, linkedProfiles, lastUsed }) => (
                                <tr key={b.id} className={`border-b border-gray-100 ${lastUsed ? 'hover:bg-gray-50' : 'bg-gray-50/40 hover:bg-gray-100'}`}>
                                  <td className="px-4 py-2.5">
                                    <div className="font-medium text-gray-800 text-sm">{b.shortName || '—'}</div>
                                    {b.beneficiaryName && b.beneficiaryName !== b.shortName && (
                                      <div className="text-xs text-gray-500 mt-0.5">{b.beneficiaryName}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {b.vendorId ? (
                                      <button
                                        onClick={() => {
                                          navigator.clipboard.writeText(b.vendorId!);
                                          setCopiedVendorId(b.vendorId);
                                          setTimeout(() => setCopiedVendorId(prev => prev === b.vendorId ? null : prev), 1500);
                                        }}
                                        className="font-mono text-xs px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors"
                                        title="Click to copy">
                                        {copiedVendorId === b.vendorId ? '✓ copied' : b.vendorId}
                                      </button>
                                    ) : (
                                      <span className="text-xs text-gray-400">—</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{b.bankAccount || '—'}</td>
                                  <td className="px-4 py-2.5 text-xs text-gray-600">
                                    <div>{b.beneficiaryCountry || '—'}</div>
                                    <div className="text-gray-400">{b.currency}</div>
                                  </td>
                                  <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                                    {fmtDate(lastUsed) || <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-4 py-2.5 text-center">
                                    {linkedProfiles.length > 0 ? (
                                      <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs" title={linkedProfiles.map(p => users.find(u => u.id === p.userId)?.name || p.userId).join(', ')}>
                                        {linkedProfiles.length}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gray-300">0</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {beneRows.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No beneficiaries match your search.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })()}


          <ImportIntuitPaymentsXlsx
            open={showIntuitImport}
            onClose={() => { setShowIntuitImport(false); setIntuitXlsxError(''); }}
            file={intuitXlsxFile}
            onFileChange={f => {
              setIntuitXlsxFile(f);
              setIntuitXlsxPreview(null);
              if (f !== null) setIntuitXlsxResult(null);
            }}
            preview={intuitXlsxPreview}
            onCancelPreview={() => setIntuitXlsxPreview(null)}
            importing={intuitXlsxImporting}
            result={intuitXlsxResult}
            error={intuitXlsxError}
            onParse={parseIntuitXlsxPreview}
            onCommit={commitIntuitXlsxToInbox}
          />

          <ImportConveraBeneficiaries
            open={showConveraImport}
            onClose={() => setShowConveraImport(false)}
            file={beneficiaryImportFile}
            onFileChange={f => {
              setBeneficiaryImportFile(f);
              if (f !== null) setBeneficiaryImportResult(null);
            }}
            importing={beneficiaryImporting}
            result={beneficiaryImportResult}
            paymentProfiles={paymentProfiles}
            users={users}
            converaBeneficiaries={converaBeneficiaries}
            beneficiaryOverrideProfileId={beneficiaryOverrideProfileId}
            setBeneficiaryOverrideProfileId={setBeneficiaryOverrideProfileId}
            beneficiaryOverrideSearch={beneficiaryOverrideSearch}
            setBeneficiaryOverrideSearch={setBeneficiaryOverrideSearch}
            setConveraOverride={setConveraOverride}
            computeSynVendorCode={computeSynVendorCode}
            onImport={importConveraBeneficiaries}
          />

          {/* Invoice Detail Modal (accountant view, extracted I7) */}
          {showInvoiceModal && selectedInvoice && (
            <InvoiceDetailModal
              invoice={selectedInvoice}
              onClose={() => setShowInvoiceModal(false)}
              currentUser={currentUser!}
              users={users}
              paymentProfiles={paymentProfiles}
              converaBeneficiaries={converaBeneficiaries}
              invoices={invoices}
              timesheets={timesheets}
              projects={projects}
              attachmentUploading={attachmentUploading}
              beneficiaryOverrideProfileId={beneficiaryOverrideProfileId}
              setBeneficiaryOverrideProfileId={setBeneficiaryOverrideProfileId}
              beneficiaryOverrideSearch={beneficiaryOverrideSearch}
              setBeneficiaryOverrideSearch={setBeneficiaryOverrideSearch}
              paymentMethod={paymentMethod}
              handleInvoiceAction={handleInvoiceAction}
              saveInvoiceEdits={saveInvoiceEdits}
              savePeriodEdit={savePeriodEdit}
              saveValueEdit={saveValueEdit}
              applyUsdRate={applyUsdRate}
              previewPeriodChange={previewPeriodChange}
              handleAttachmentUploadForExisting={handleAttachmentUploadForExisting}
              deletePaymentProfile={deletePaymentProfile}
              loadConveraBeneficiaries={loadConveraBeneficiaries}
              openAttachment={openAttachment}
              switchInvoicePaymentProfile={switchInvoicePaymentProfile}
              setConveraOverride={setConveraOverride}
            />
          )}
        </div>
        <style>{`@media print { body * { visibility: hidden; } .bg-white.rounded-lg.shadow-md.p-6, .bg-white.rounded-lg.shadow-md.p-6 * { visibility: visible; } .bg-white.rounded-lg.shadow-md.p-6 { position: absolute; left: 0; top: 0; width: 100%; } button { display: none !important; } }`}</style>
        {showTimesheetModal && selectedTimesheetForView && (
          <TimesheetDetailModal
            timesheet={selectedTimesheetForView}
            users={users}
            projects={projects}
            currentUser={currentUser!}
            countries={countries}
            isHoliday={isHoliday}
            onClose={closeTimesheetModal}
            onApproval={handleApproval}
          />
        )}
      </div>
    );
  }

  // ─── TIMESHEET USER VIEW ──────────────────────────────────────────────────
  const weekDates = getWeekDates(selectedWeek);
  const currentTimesheet = timesheets.find(t => t.userId === currentUser!.id && t.weekStart === formatDate(selectedWeek));
  const totalHours = Object.values(timeEntries).reduce((s, e) => s + parseFloat(e?.hours || '0'), 0);
  const currentProject = projects.find(p => p.id === currentUser!.projectId);
  const userReminders = reminderEmails.filter(r => r.userId === currentUser!.id);
  const currentWeekKey = formatDate(selectedWeek);
  const hasPreviousWeekTimesheet = timesheetsRef.current.some(t => t.userId === currentUser!.id && t.weekStart < currentWeekKey);
  const filteredUserTimesheets = getFilteredTimesheets(currentUser!.id);
  const isUserInactive = !!(currentUser!.endDate && new Date() > parseLocalDate(currentUser!.endDate));

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800">My Timesheet</h1>
              <p className="text-gray-600">Welcome, {currentUser!.name}</p>
              <div className="flex items-center gap-2 mt-2 text-sm text-indigo-600">
                <MapPin className="w-4 h-4" />
                <span>{countries.find(c => c.code === currentUser!.country)?.name}{currentUser!.region ? ' – ' + currentUser!.region : ''}</span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {userReminders.length > 0 && (
                <button onClick={() => setShowReminderLog(!showReminderLog)} className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 border border-amber-300">
                  <Mail className="w-4 h-4" /> Reminders ({userReminders.length})
                </button>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Project</label>
                {currentProject ? (
                  <div className="px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-sm font-medium text-indigo-800 sm:min-w-[200px]">
                    {currentProject.name} <span className="text-indigo-500 font-mono text-xs">({currentProject.code})</span>
                  </div>
                ) : (
                  <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 sm:min-w-[200px]">
                    No project assigned — contact your manager
                  </div>
                )}
              </div>
              <button onClick={handleLogout} className="flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
            </div>
          </div>
        </div>

        {showReminderLog && userReminders.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Timesheet Reminders</h2>
              <button onClick={() => setShowReminderLog(false)} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {userReminders.map(r => (
                <div key={r.id} className={'p-4 rounded-lg border-2 ' + (r.reminderType === 'second' ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300')}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800">{r.subject}</h3>
                      <p className="text-sm text-gray-600 mt-1">Sent: {r.sentTime}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={'px-3 py-1 rounded-full text-xs font-medium ' + (r.reminderType === 'second' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800')}>{r.reminderType === 'first' ? '1st Reminder' : '2nd Reminder'}</span>
                      <button onClick={() => dismissReminder(r.id)} className="p-1 text-gray-500 hover:text-gray-700"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700">{r.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Profile completion banner */}
        {(() => {
          if (currentUser?.role !== 'timesheetuser') return null;
          const needsPhone = !currentUser.phone;
          const multiRegionCountries = ['US', 'GB', 'CA'];
          const isMultiRegion = multiRegionCountries.includes(currentUser.country);
          if (!needsPhone && !isMultiRegion) return null;
          if (isBannerDismissed()) return null;
          // Use bannerCountry for all region logic so changing country updates region picker live
          const selectedCountry = bannerCountry || currentUser.country;
          const selectedIsMultiRegion = multiRegionCountries.includes(selectedCountry);
          const regionOptions = countries.find(c => c.code === selectedCountry)?.regions || [];
          const resolvedCountry = bannerCountry === '__other__' ? bannerCountryOther.trim() : bannerCountry;
          const resolvedRegion = bannerRegion === '__other__' ? bannerRegionOther.trim() : bannerRegion;
          const countryChanged = resolvedCountry && resolvedCountry !== currentUser.country;
          const regionChanged = resolvedRegion && resolvedRegion !== currentUser.region;
          const canSave = !bannerSaving && (
            (needsPhone && bannerPhone.trim()) ||
            countryChanged ||
            (selectedIsMultiRegion && regionChanged)
          );
          const label = needsPhone && !currentUser.region
            ? 'Complete your profile — phone & location'
            : needsPhone
            ? 'Complete your profile — phone number missing'
            : 'Verify your location is correct';
          return (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div className="flex-1 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
                <span className="text-sm text-amber-800 font-medium">{label}</span>
                <div className="flex flex-wrap items-center gap-2">
                  {needsPhone && (
                    <input
                      type="tel"
                      placeholder="Phone number"
                      value={bannerPhone}
                      onChange={e => setBannerPhone(e.target.value)}
                      className="border border-amber-300 rounded px-2 py-1 text-sm w-36 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  )}
                  <select
                    value={selectedCountry}
                    onChange={e => handleBannerCountryChange(e.target.value)}
                    className="border border-amber-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                  >
                    {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    <option value="__other__">Other (specify)…</option>
                  </select>
                  {bannerCountry === '__other__' && (
                    <input
                      type="text"
                      placeholder="e.g. Germany"
                      value={bannerCountryOther}
                      onChange={e => setBannerCountryOther(e.target.value)}
                      className="border border-amber-300 rounded px-2 py-1 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                  )}
                  {selectedIsMultiRegion && regionOptions.length > 0 && (
                    <>
                      <select
                        value={bannerRegion}
                        onChange={e => { setBannerRegion(e.target.value); if (e.target.value !== '__other__') setBannerRegionOther(''); }}
                        className="border border-amber-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                      >
                        <option value="">— region —</option>
                        {regionOptions.map(r => <option key={r} value={r}>{r}</option>)}
                        <option value="__other__">Other (specify)…</option>
                      </select>
                      {bannerRegion === '__other__' && (
                        <input
                          type="text"
                          placeholder="e.g. Oregon"
                          value={bannerRegionOther}
                          onChange={e => setBannerRegionOther(e.target.value)}
                          className="border border-amber-300 rounded px-2 py-1 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-amber-400"
                        />
                      )}
                    </>
                  )}
                  <button
                    onClick={saveBannerProfile}
                    disabled={!canSave}
                    className="px-3 py-1 bg-amber-500 text-white rounded text-sm hover:bg-amber-600 disabled:opacity-50"
                  >
                    {bannerSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setUserTab('profile')} className="text-sm text-amber-700 underline hover:text-amber-900">Full Profile →</button>
                </div>
              </div>
              <button onClick={dismissBanner} className="self-start sm:self-auto text-amber-400 hover:text-amber-600" title="Remind me in 30 days">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })()}

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow-md mb-6">
          {/* Tab bar — compact icon+label on mobile, full text on sm+ */}
          <div className="flex border-b bg-white">
            <button
              onClick={() => setUserTab('timesheet')}
              className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm transition-colors border-b-2 ' +
                (userTab === 'timesheet' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}
            >
              <Clock className="w-5 h-5 flex-shrink-0" />
              <span>Timesheets</span>
            </button>
            {currentUser!.invoiceEnabled && (
              <button
                onClick={() => setUserTab('invoices')}
                className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm transition-colors border-b-2 relative ' +
                  (userTab === 'invoices' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}
              >
                <span className="relative">
                  <Receipt className="w-5 h-5 flex-shrink-0" />
                  {invoices.filter(i => i.userId === currentUser!.id && i.status === 'submitted').length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-400 text-white rounded-full text-[10px] font-bold flex items-center justify-center leading-none">
                      {invoices.filter(i => i.userId === currentUser!.id && i.status === 'submitted').length}
                    </span>
                  )}
                </span>
                <span>Invoices</span>
              </button>
            )}
            {currentUser!.invoiceEnabled && (
              <button
                onClick={() => setUserTab('payment')}
                className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm transition-colors border-b-2 relative ' +
                  (userTab === 'payment' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}
              >
                <span className="relative">
                  <DollarSign className="w-5 h-5 flex-shrink-0" />
                  {paymentProfiles.filter(p => p.userId === currentUser!.id).length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-indigo-400 text-white rounded-full text-[10px] font-bold flex items-center justify-center leading-none">
                      {paymentProfiles.filter(p => p.userId === currentUser!.id).length}
                    </span>
                  )}
                </span>
                <span className="hidden xs:inline sm:inline">Payment </span><span>Profiles</span>
              </button>
            )}
            <button
              onClick={() => setUserTab('profile')}
              className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm transition-colors border-b-2 ' +
                (userTab === 'profile' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}
            >
              <Settings className="w-5 h-5 flex-shrink-0" />
              <span>Profile</span>
            </button>
          </div>
        </div>

        {userTab === 'timesheet' && (<div>
          <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
          {isUserInactive && (
            <div className="mb-6 p-4 bg-orange-50 border-2 border-orange-300 rounded-lg flex items-center gap-3">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                <X className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <p className="font-semibold text-orange-800">Account Inactive</p>
                <p className="text-sm text-orange-700">Your end date was {parseLocalDate(currentUser!.endDate!).toLocaleDateString()}. You can view past timesheets but cannot submit new ones.</p>
              </div>
            </div>
          )}
          <div className="flex justify-between items-center mb-6">
            <button onClick={() => changeWeek(-1)} className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">← <span className="hidden sm:inline">Previous </span>Week</button>
            <div className="text-center">
              <h2 className="text-base sm:text-lg font-semibold text-gray-800">Week of {selectedWeek.toLocaleDateString()}</h2>
              {currentTimesheet && (
                <span className={'inline-block mt-1 px-3 py-1 rounded-full text-sm font-medium ' + (currentTimesheet.status === 'approved' ? 'bg-green-100 text-green-800' : currentTimesheet.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')}>
                  {currentTimesheet.status.charAt(0).toUpperCase() + currentTimesheet.status.slice(1)}
                </span>
              )}
            </div>
            <button onClick={() => changeWeek(1)} className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm"><span className="hidden sm:inline">Next </span>Week →</button>
          </div>

          {(() => {
            const locked = (currentTimesheet?.lockedDays?.length ?? 0) > 0;
            if (!locked) return null;
            return (
              <div className="mb-4 p-4 bg-amber-50 border-2 border-amber-300 rounded-lg flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-amber-900">This week is locked</p>
                  <p className="text-sm text-amber-800">The invoice covering this period has been approved. Contact the accountant to make corrections.</p>
                </div>
              </div>
            );
          })()}

          {hasPreviousWeekTimesheet && (!currentTimesheet || currentTimesheet.status !== 'approved') && (
            <div className="mb-4 p-4 bg-indigo-50 border-2 border-indigo-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-600" />
                  <div>
                    <p className="font-medium text-indigo-800">Copy from Previous Week</p>
                    <p className="text-sm text-indigo-600">Save time by copying last week's timesheet</p>
                  </div>
                </div>
                <button onClick={copyPreviousWeekTimesheet} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><FileText className="w-4 h-4" /> Copy Previous Week</button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {weekDates.slice(0, 5).map(date => {
              const dateKey = formatDate(date);
              const entry = timeEntries[dateKey] || { hours: '0' };
              const isDisabled = isUserInactive || (currentTimesheet?.lockedDays?.length ?? 0) > 0;
              const holiday = isHoliday(date, currentUser!.country);
              return (
                <div key={dateKey} className={'p-4 rounded-lg ' + (holiday ? 'bg-red-50 border-2 border-red-200' : 'bg-blue-50')}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-gray-800">{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                        {holiday && <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Holiday: {holiday.name}</span>}
                      </div>
                      <div className="text-sm text-gray-600">{date.toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-700 font-medium">Hours:</label>
                      <input type="number" min="0" max="24" step="0.5" value={entry.hours} onChange={e => handleTimeEntry(dateKey, e.target.value)} disabled={isDisabled} className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100" placeholder="0" />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Weekend hours — shown when data exists or user clicks button */}
            {showWeekendHours ? (
              weekDates.slice(5).map(date => {
                const dateKey = formatDate(date);
                const entry = timeEntries[dateKey] || { hours: '0' };
                const isDisabled = isUserInactive || (currentTimesheet?.lockedDays?.length ?? 0) > 0;
                return (
                  <div key={dateKey} className="p-4 rounded-lg bg-gray-100 border-2 border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-gray-800">{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                          <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full font-medium">Weekend</span>
                        </div>
                        <div className="text-sm text-gray-600">{date.toLocaleDateString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-700 font-medium">Hours:</label>
                        <input type="number" min="0" max="24" step="0.5" value={entry.hours} onChange={e => handleTimeEntry(dateKey, e.target.value)} disabled={isDisabled} className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100" placeholder="0" />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (!isUserInactive && (!currentTimesheet || currentTimesheet.status !== 'approved')) ? (
              <button
                onClick={() => setShowWeekendHours(true)}
                className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Weekend Hours
              </button>
            ) : null}
          </div>

          <div className="mt-6 p-4 bg-indigo-50 rounded-lg border-2 border-indigo-200">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold text-gray-800">Total Hours for Week:</span>
              <span className="text-2xl font-bold text-indigo-600">{totalHours.toFixed(1)}h</span>
            </div>
            <div className="mt-2 text-sm text-gray-600">
              Standard: 40h | Current: {totalHours.toFixed(1)}h
              {totalHours > 40 && <span className="text-amber-600 font-medium ml-2">(+{(totalHours - 40).toFixed(1)} overtime)</span>}
              {totalHours < 40 && <span className="text-blue-600 font-medium ml-2">({(40 - totalHours).toFixed(1)} under)</span>}
            </div>
          </div>

          {isUserInactive ? (
            <div className="mt-6 p-4 bg-orange-50 border-2 border-orange-200 rounded-lg text-center">
              <p className="text-orange-800 font-medium">Timesheet submission is disabled after your end date.</p>
            </div>
          ) : (currentTimesheet?.lockedDays?.length ?? 0) > 0 ? (
            <div className="mt-6 p-4 bg-gray-100 border-2 border-gray-300 rounded-lg text-center">
              <p className="text-gray-700 font-medium">This week is locked — contact the accountant to make changes.</p>
            </div>
          ) : (
            <div>
              <button onClick={submitTimesheet} className="w-full mt-6 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2">
                <CheckCircle className="w-5 h-5" /> {currentTimesheet?.status === 'approved' ? 'Update Timesheet' : 'Submit for Approval'}
              </button>
              {(() => {
                const missing = currentUser!.startDate
                  ? getMissingWeeksSince(currentUser!.startDate, timesheets, currentUser!.id, currentUser!.endDate)
                  : [];
                return missing.length > 0 ? (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-semibold text-red-800 mb-2">⚠️ {missing.length} Missing Timesheet{missing.length > 1 ? 's' : ''}</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {missing.map(w => (
                        <button key={w} onClick={() => { const d = parseLocalDate(w); setSelectedWeek(d); loadTimesheetForWeek(currentUser!.id, d); }} className="block w-full text-left text-xs text-red-700 hover:text-red-900 hover:underline">
                          → Week of {parseLocalDate(w).toLocaleDateString()}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-red-600 mt-2">Click a week to navigate to it and submit.</p>
                  </div>
                ) : (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">✓ All timesheets submitted since your start date.</p>
                  </div>
                );
              })()}
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800"><strong>Reminder Schedule:</strong> Automated reminders are sent Friday at 5 PM and Monday at 11 AM (your local time) for any missing timesheets.</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mt-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
            <h2 className="text-xl font-bold text-gray-800">Timesheet History</h2>
            <button onClick={() => exportTimesheetList(filteredUserTimesheets)} className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
          </div>

          {/* Filters */}
          <div className="mb-5">
            <MonthRangePicker value={dateRange} onChange={setDateRange} />
          </div>

          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <table className="w-full border-collapse">
              <thead className="bg-indigo-600 text-white">
                <tr>
                  <th className="border border-indigo-700 px-4 py-3 text-left">W/E Date</th>
                  <th className="border border-indigo-700 px-4 py-3 text-left">Project</th>
                  {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <th key={d} className="border border-indigo-700 px-4 py-3 text-center">{d}</th>)}
                  <th className="border border-indigo-700 px-4 py-3 text-center">Total</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center">Status</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center whitespace-nowrap">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {filteredUserTimesheets.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-8 text-gray-500">No timesheets found</td></tr>
                ) : filteredUserTimesheets.map((ts, idx) => {
                  const project = projects.find(p => p.id === (ts.projectId ?? currentUser!.projectId));
                  const wDates = getWeekDates(parseLocalDate(ts.weekStart));
                  const weekFri = wDates[4]; // W/E Friday label
                  const dailyHours = wDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                  const total = dailyHours.reduce((s, h) => s + h, 0);
                  return (
                    <tr key={ts.id} className={'cursor-pointer ' + (idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50')} onClick={() => openTimesheetModal(ts)}>
                      <td className="border border-gray-300 px-4 py-2 text-indigo-600 font-medium whitespace-nowrap">{weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="border border-gray-300 px-4 py-2 text-sm text-indigo-600">{project ? `${project.name} (${project.code})` : 'N/A'}</td>
                      {dailyHours.map((h, i) => <td key={i} className="border border-gray-300 px-4 py-2 text-center">{h > 0 ? h.toFixed(1) : '-'}</td>)}
                      <td className="border border-gray-300 px-4 py-2 text-center font-bold text-indigo-600">{total.toFixed(1)}</td>
                      <td className="border border-gray-300 px-4 py-2 text-center">
                        <StatusBadge tone={ts.status === 'approved' ? 'green' : ts.status === 'rejected' ? 'red' : 'yellow'}>{ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}</StatusBadge>
                      </td>
                      <td className="border border-gray-300 px-4 py-2 text-center text-xs text-gray-500 whitespace-nowrap">
                        {ts.submittedAt ? new Date(ts.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </div>)}

        {userTab === 'invoices' && (() => {
          const userInvoices = invoices.filter(i => i.userId === currentUser!.id).sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
          const approvedTimesheets = timesheets.filter(t => t.userId === currentUser!.id && t.status === 'approved');
          const userProfiles = paymentProfiles.filter(p => p.userId === currentUser!.id);
          const now = new Date();
          const monthOptions = Array.from({ length: 6 }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const start = formatDate(new Date(d.getFullYear(), d.getMonth(), 1));
            const end = formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
            return { label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), value: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, start, end };
          });

          const previewLines = invoiceMonth.start && invoiceMonth.end && parseFloat(invoiceRate) > 0
            ? buildInvoiceLines(currentUser!.id, invoiceMonth.start, invoiceMonth.end, parseFloat(invoiceRate))
            : [];
          const previewTotal = previewLines.reduce((s, l) => s + l.amount, 0);
          const previewHours = previewLines.reduce((s, l) => s + (l.hours ?? 0), 0);

          const currencies = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];
          const currencySymbols: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' };
          const sym = currencySymbols[invoiceCurrency] || '$';

          const statusColors: Record<string, string> = {
            draft: 'bg-gray-100 text-gray-700',
            submitted: 'bg-yellow-100 text-yellow-800',
            approved: 'bg-green-100 text-green-800',
            rejected: 'bg-red-100 text-red-800',
            paid: 'bg-blue-100 text-blue-800',
          };

          // Auto-generate invoice number when period selected
          const suggestedInvNum = invoiceMonth.start
            ? generateInvoiceNumber(currentUser!.id, invoiceMonth.start)
            : '';

          return (
            <div>
              {/* Header */}
              <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Receipt className="w-6 h-6 text-indigo-600" /> My Invoices</h2>
                    <p className="text-sm text-gray-500 mt-1">Generate invoices from your approved timesheets</p>
                  </div>
                  <button
                    onClick={() => {
                      setInvoiceView(invoiceView === 'list' ? 'create' : 'list');
                      if (invoiceView === 'list') { setInvoiceNumber(''); setInvoicePhoneConfirm(currentUser?.phone || ''); }
                    }}
                    className={'flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium ' + (invoiceView === 'create' ? 'bg-gray-200 text-gray-700' : 'bg-indigo-600 text-white hover:bg-indigo-700')}
                  >
                    {invoiceView === 'create' ? (<><X className="w-4 h-4" /> Cancel</>) : (<><Plus className="w-4 h-4" /> Create Invoice</>)}
                  </button>
                </div>
              </div>

              {/* Create Invoice Form */}
              {invoiceView === 'create' && (
                <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2"><DollarSign className="w-5 h-5 text-indigo-600" /> New Invoice</h3>

                  {approvedTimesheets.length === 0 && (
                    <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-amber-800 text-sm font-medium">⚠️ No approved timesheets found. Your timesheets must be approved by your manager before you can invoice them.</p>
                    </div>
                  )}

                  {/* Invoice Number */}
                  <div className="mb-6 p-3 sm:p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice Number *</label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={e => setInvoiceNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, ''))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                      placeholder="e.g. INV-2026-001"
                      maxLength={40}
                    />
                    {suggestedInvNum && !invoiceNumber && (
                      <button
                        onClick={() => setInvoiceNumber(suggestedInvNum)}
                        className="mt-2 w-full px-3 py-2 text-sm bg-white border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 text-left truncate"
                      >
                        Use suggested: <span className="font-mono">{suggestedInvNum}</span>
                      </button>
                    )}
                    <p className="text-xs text-gray-500 mt-1">Letters, numbers, hyphens and underscores only. Rejected invoice numbers can be reused.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Period Selection */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Billing Period *</label>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {monthOptions.map(opt => {
                          const hasApproved = approvedTimesheets.some(t => {
                            const weekSun = new Date(parseLocalDate(t.weekStart)); weekSun.setDate(weekSun.getDate() + 6);
                            return parseLocalDate(t.weekStart) <= parseLocalDate(opt.end) && weekSun >= parseLocalDate(opt.start);
                          });
                          return (
                            <button
                              key={opt.value}
                              onClick={() => { setInvoiceMonth({ start: opt.start, end: opt.end, label: opt.label }); if (!invoiceNumber) setInvoiceNumber(''); }}
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors relative ${
                                invoiceMonth.start === opt.start ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
                              }`}
                            >
                              {opt.label}
                              {hasApproved && <span className="ml-1.5 w-1.5 h-1.5 bg-green-400 rounded-full inline-block" title="Has approved timesheets" />}
                            </button>
                          );
                        })}
                      </div>
                      {invoiceMonth.label && <p className="text-sm text-green-700 font-medium">✓ Period: {invoiceMonth.label}</p>}
                    </div>

                    {/* Rate */}
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Hourly Rate *</label>
                        <div className="flex gap-2">
                          <select value={invoiceCurrency} onChange={e => setInvoiceCurrency(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm">
                            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">{sym}</span>
                            <input type="number" min="0" step="0.01" value={invoiceRate} onChange={e => setInvoiceRate(e.target.value)} className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="0.00 per hour" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optional)</label>
                        <textarea value={invoiceNotes} onChange={e => setInvoiceNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Add any notes for the accountant..." />
                      </div>
                    </div>
                  </div>

                  {/* Payment Profile Picker */}
                  <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                      <span className="font-semibold text-gray-700 text-sm">Payment Profile (optional)</span>
                      <button
                        onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }}
                        className="flex items-center gap-1 px-3 py-1 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      >
                        <Plus className="w-3 h-3" /> New Profile
                      </button>
                    </div>
                    {userProfiles.length === 0 ? (
                      <div className="p-4 text-center text-gray-400 text-sm">
                        No payment profiles yet. <button onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }} className="text-indigo-600 underline hover:text-indigo-800">Create one</button> to include bank details on your invoice.
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        <label className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                          <input type="radio" name="payProfile" checked={selectedPaymentProfileId === null} onChange={() => setSelectedPaymentProfileId(null)} className="accent-indigo-600" />
                          <span className="text-sm text-gray-500 italic">None (no payment details on invoice)</span>
                        </label>
                        {userProfiles.map(p => (
                          <label key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 cursor-pointer">
                            <input type="radio" name="payProfile" checked={selectedPaymentProfileId === p.id} onChange={() => setSelectedPaymentProfileId(p.id)} className="accent-indigo-600" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 text-sm flex items-center gap-2">
                                {p.profileName}
                                {p.isDefault && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded font-normal">Default</span>}
                              </div>
                              <div className="text-xs text-gray-500 truncate">{p.companyName} · {p.bankName}{p.accountNumber ? ' · Acct: ' + p.accountNumber : ''}</div>
                            </div>
                            <button
                              onClick={e => { e.preventDefault(); setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride, qbVendorName: p.qbVendorName }); setShowProfileModal(true); }}
                              className="p-1 text-gray-400 hover:text-indigo-600"
                            ><Edit2 className="w-3.5 h-3.5" /></button>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preview */}
                  {previewLines.length > 0 && (
                    <div className="border border-indigo-200 rounded-lg overflow-hidden mb-5">
                      <div className="bg-indigo-600 text-white px-5 py-3 flex justify-between items-center">
                        <span className="font-semibold">Invoice Preview — {invoiceMonth.label}</span>
                        <span className="text-sm opacity-80">Only approved timesheets are included</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-gray-700">Week Ending</th>
                            <th className="px-4 py-2 text-center font-semibold text-gray-700">Hours</th>
                            <th className="px-4 py-2 text-center font-semibold text-gray-700">Rate</th>
                            <th className="px-4 py-2 text-right font-semibold text-gray-700">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {previewLines.map((line, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-4 py-2 text-gray-700">W/E {parseLocalDate(line.weekEndingFri).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                              <td className="px-4 py-2 text-center font-medium">{line.hours?.toFixed(2) ?? '—'}</td>
                              <td className="px-4 py-2 text-center text-gray-500">{line.rate != null ? `${sym}${line.rate.toFixed(2)}/hr` : '—'}</td>
                              <td className="px-4 py-2 text-right font-semibold text-gray-800">{sym}{line.amount.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-indigo-50 font-bold">
                          <tr>
                            <td className="px-4 py-3 text-gray-800">Total</td>
                            <td className="px-4 py-3 text-center text-indigo-700">{previewHours.toFixed(2)} hrs</td>
                            <td className="px-4 py-3"></td>
                            <td className="px-4 py-3 text-right text-indigo-700 text-lg">{sym}{previewTotal.toFixed(2)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {previewLines.length === 0 && invoiceMonth.start && (
                    <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-lg text-center text-gray-500 text-sm">
                      {parseFloat(invoiceRate) > 0 ? 'No approved timesheets found in this period.' : 'Enter an hourly rate to see a preview.'}
                    </div>
                  )}

                  {/* PDF Attachment */}
                  <div className="mb-5 border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-gray-500" />
                      <span className="font-semibold text-gray-700 text-sm">Attach PDF (optional)</span>
                    </div>
                    <div className="p-4">
                      {invoiceAttachmentFile ? (
                        <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                            <span className="text-sm font-medium text-indigo-800 truncate">{invoiceAttachmentFile.name}</span>
                            <span className="text-xs text-indigo-500 flex-shrink-0">({(invoiceAttachmentFile.size / 1024).toFixed(0)} KB)</span>
                          </div>
                          <button onClick={() => setInvoiceAttachmentFile(null)} className="ml-2 text-gray-400 hover:text-red-500 flex-shrink-0"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                          <UploadCloud className="w-8 h-8 text-gray-400" />
                          <span className="text-sm text-gray-600">Click to attach a PDF</span>
                          <span className="text-xs text-gray-400">Supporting document, timesheet printout, etc.</span>
                          <input type="file" accept="application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setInvoiceAttachmentFile(f); }} />
                        </label>
                      )}
                    </div>
                  </div>

                  {/* Phone confirmation */}
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Contact Phone Number *
                    </label>
                    <input
                      type="tel"
                      value={invoicePhoneConfirm}
                      onChange={e => setInvoicePhoneConfirm(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm"
                      placeholder={currentUser?.phone || '+1 555 123 4567'}
                    />
                    <p className="text-xs text-gray-400 mt-1">Please confirm your number in case we need to contact you about this invoice. Updates your profile if changed.</p>
                  </div>

                  <button
                    onClick={submitInvoice}
                    disabled={previewLines.length === 0 || !invoiceNumber.trim() || attachmentUploading || !invoicePhoneConfirm.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {attachmentUploading ? <><span className="animate-spin">⏳</span> Uploading…</> : <><Receipt className="w-5 h-5" /> Submit Invoice for Review</>}
                  </button>
                </div>
              )}

              {/* Invoice List */}
              <div className="bg-white rounded-lg shadow-md p-3 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
                  <h3 className="text-lg font-bold text-gray-800">Invoice History</h3>
                  {userInvoices.length > 0 && (
                    <button onClick={() => exportInvoicesCSV(userInvoices)} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
                  )}
                </div>
                {userInvoices.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No invoices yet</p>
                    <p className="text-sm mt-1">Create your first invoice from approved timesheets</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {userInvoices.map(inv => {
                      const project = projects.find(p => p.id === inv.projectId);
                      const sym2 = currencySymbols[inv.currency] || '$';
                      return (
                        <div key={inv.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 cursor-pointer" onClick={() => { setSelectedInvoice(inv); setShowInvoiceModal(true); }}>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{inv.invoiceNumber}</span>
                                <span className="font-semibold text-gray-800">{parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                              </div>
                              {project && <p className="text-sm text-indigo-600">{project.name} ({project.code})</p>}
                              <p className="text-sm text-gray-500 mt-1">{inv.lines.length} week{inv.lines.length !== 1 ? 's' : ''} · {inv.totalHours != null ? `${inv.totalHours.toFixed(1)} hrs` : '—'} · {sym2}{inv.rate ?? '—'}/hr</p>
                              {inv.paymentProfile && <p className="text-xs text-gray-400 mt-0.5">💳 {inv.paymentProfile.profileName} — {inv.paymentProfile.bankName}</p>}
                              {inv.status === 'approved' && (
                                inv.payOnDate
                                  ? <p className="text-xs font-semibold mt-1 text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1 inline-block">📅 Expected payment: {parseLocalDate(inv.payOnDate!).toLocaleDateString()}</p>
                                  : <p className="text-xs text-amber-600 mt-0.5">📅 Payment date not yet scheduled</p>
                              )}
                              {inv.status !== 'approved' && inv.payOnDate && <p className="text-xs text-blue-600 mt-0.5 font-medium">📅 Pay on date: {parseLocalDate(inv.payOnDate!).toLocaleDateString()}</p>}
                              {inv.paidDate && <p className="text-xs text-green-600 mt-0.5 font-medium">✅ Paid: {parseLocalDate(inv.paidDate!).toLocaleDateString()}</p>}
                              {/* PDF attachment badge */}
                              {inv.attachmentPath && (
                                <button
                                  onClick={e => { e.stopPropagation(); openAttachment(inv); }}
                                  className="inline-flex items-center gap-1 mt-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                                >
                                  <Paperclip className="w-3 h-3" /> View attachment <ExternalLink className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            <div className="text-right ml-3 flex flex-col items-end gap-2">
                              <div className="text-2xl font-bold text-indigo-600">{sym2}{inv.totalAmount.toFixed(2)}</div>
                              <div className="text-xs text-gray-400">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : ''}</div>
                              {/* Upload / replace attachment */}
                              {inv.status !== 'paid' && (
                                <label className="flex items-center gap-1 px-2 py-1 text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 rounded cursor-pointer hover:bg-indigo-100">
                                  <Paperclip className="w-3 h-3" />
                                  {inv.attachmentPath ? 'Replace PDF' : 'Attach PDF'}
                                  <input type="file" accept="application/pdf" className="hidden" onChange={async e => {
                                    const f = e.target.files?.[0];
                                    if (f) await handleAttachmentUploadForExisting(inv, f);
                                    e.target.value = '';
                                  }} />
                                </label>
                              )}
                              {inv.status === 'rejected' && (
                                <button
                                  onClick={() => deleteInvoice(inv.id)}
                                  className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
                                >
                                  <Trash2 className="w-3 h-3" /> Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Payment Profiles Tab */}
        {userTab === 'payment' && (() => {
          const userProfiles = paymentProfiles.filter(p => p.userId === currentUser!.id);
          return (
            <div>
              <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-2">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-6 h-6 text-indigo-600" /> Payment Profiles</h2>
                    <p className="text-sm text-gray-500 mt-1">Bank and company details attached to your invoices</p>
                  </div>
                  <button
                    onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                  >
                    <Plus className="w-4 h-4" /> Add Profile
                  </button>
                </div>
              </div>

              {userProfiles.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-400">
                  <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-gray-600">No payment profiles yet</p>
                  <p className="text-sm mt-1 mb-5">Add your bank details so they appear on your invoices</p>
                  <button onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }} className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Add First Profile</button>
                </div>
              ) : (
                <div className="space-y-4">
                  {userProfiles.map(p => (
                    <div key={p.id} className="bg-white rounded-lg shadow-md p-5">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-gray-800 text-lg">{p.profileName}</h3>
                            {p.isDefault && <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-medium">Default</span>}
                          </div>
                          <p className="text-sm text-gray-500 mt-0.5">{p.companyName}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride, qbVendorName: p.qbVendorName }); setShowProfileModal(true); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 text-sm"
                          ><Edit2 className="w-3.5 h-3.5" /> Edit</button>
                          <button onClick={() => deletePaymentProfile(p.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 text-sm"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm border-t border-gray-100 pt-4">
                        <div><span className="text-gray-500 w-40 inline-block">Company Name</span><span className="font-medium text-gray-800">{p.companyName || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Company Address</span><span className="font-medium text-gray-800">{p.companyAddress || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Country</span><span className="font-medium text-gray-800">{p.country || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Bank Name</span><span className="font-medium text-gray-800">{p.bankName || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Bank Address</span><span className="font-medium text-gray-800">{p.bankAddress || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Bank Branch</span><span className="font-medium text-gray-800">{p.bankBranch || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Account Number</span><span className="font-medium text-gray-800 font-mono">{p.accountNumber || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">IBAN</span><span className="font-medium text-gray-800 font-mono">{p.iban || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">SWIFT / BIC</span><span className="font-medium text-gray-800 font-mono">{p.swift || '—'}</span></div>
                        <div><span className="text-gray-500 w-40 inline-block">Payment Email</span><span className="font-medium text-gray-800">{p.paymentEmail || '—'}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Invoice Detail Modal — user view */}
        {showInvoiceModal && selectedInvoice && userTab === 'invoices' && (() => {
          const inv = selectedInvoice;
          const project = projects.find(p => p.id === inv.projectId);
          const sym = ({ USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' })[inv.currency] || '$';
          const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={() => setShowInvoiceModal(false)}>
              <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-start z-10">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 font-mono">{inv.invoiceNumber}</h2>
                    <p className="text-gray-600 text-sm">{inv.userName} · {parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                  </div>
                  <button onClick={() => setShowInvoiceModal(false)} className="text-gray-500 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                    {project && <span className="text-sm text-indigo-600 font-medium">{project.name} ({project.code})</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
                    <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Period</div><div className="font-medium">{parseLocalDate(inv.periodStart).toLocaleDateString()} – {parseLocalDate(inv.periodEnd).toLocaleDateString()}</div></div>
                    <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Rate</div><div className="font-medium">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)} / hour (${inv.currency})` : `— (${inv.currency})`}</div></div>
                    <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Total Hours</div><div className="font-medium">{inv.totalHours?.toFixed(2) ?? '—'}</div></div>
                    <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Submitted</div><div className="font-medium">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : '—'}</div></div>
                    {inv.payOnDate && (
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><div className="text-blue-500 mb-0.5">Pay On Date</div><div className="font-medium text-blue-800">{parseLocalDate(inv.payOnDate!).toLocaleDateString()}</div></div>
                    )}
                    {inv.paidDate && (
                      <div className="bg-green-50 rounded-lg p-3 border border-green-200"><div className="text-green-600 mb-0.5">Paid Date</div><div className="font-medium text-green-800">{parseLocalDate(inv.paidDate!).toLocaleDateString()}</div></div>
                    )}
                  </div>
                  <table className="w-full text-sm border-collapse mb-5">
                    <thead className="bg-indigo-600 text-white">
                      <tr>
                        <th className="px-4 py-2 text-left border border-indigo-700">Week Ending</th>
                        <th className="px-4 py-2 text-center border border-indigo-700">Hours</th>
                        <th className="px-4 py-2 text-center border border-indigo-700">Rate</th>
                        <th className="px-4 py-2 text-right border border-indigo-700">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((line, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2 border border-gray-200">W/E {parseLocalDate(line.weekEndingFri || inv.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                          <td className="px-4 py-2 border border-gray-200 text-center">{line.hours?.toFixed(2) ?? '—'}</td>
                          <td className="px-4 py-2 border border-gray-200 text-center text-gray-500">{line.rate != null ? `${sym}${line.rate.toFixed(2)}` : '—'}</td>
                          <td className="px-4 py-2 border border-gray-200 text-right font-medium">{sym}{line.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-indigo-600 text-white font-bold">
                      <tr>
                        <td className="px-4 py-3 border border-indigo-700">Total</td>
                        <td className="px-4 py-3 border border-indigo-700 text-center">{inv.totalHours != null ? `${inv.totalHours.toFixed(2)} hrs` : '—'}</td>
                        <td className="px-4 py-3 border border-indigo-700"></td>
                        <td className="px-4 py-3 border border-indigo-700 text-right text-lg">{sym}{inv.totalAmount.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {inv.notes && <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 mb-4"><span className="font-medium">Notes: </span>{inv.notes}</div>}
                  {inv.reviewedBy && <p className="text-sm text-gray-500 mb-4">Reviewed by {inv.reviewedBy} on {inv.reviewedAt ? new Date(inv.reviewedAt).toLocaleDateString() : '—'}</p>}
                  {/* PDF Attachment panel — user modal */}
                  <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-gray-500" />
                      <span className="font-semibold text-gray-700 text-sm">Attachment</span>
                    </div>
                    <div className="p-4">
                      {inv.attachmentPath ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                            <span className="text-sm text-gray-700 truncate">{inv.attachmentPath.split('/').pop()}</span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => openAttachment(inv)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium">
                              <ExternalLink className="w-3.5 h-3.5" /> Open PDF
                            </button>
                            {inv.status !== 'paid' && (
                              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 cursor-pointer font-medium border border-gray-200">
                                <UploadCloud className="w-3.5 h-3.5" /> Replace
                                <input type="file" accept="application/pdf" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { await handleAttachmentUploadForExisting(inv, f); setShowInvoiceModal(false); } e.target.value = ''; }} />
                              </label>
                            )}
                          </div>
                        </div>
                      ) : (
                        inv.status !== 'paid' ? (
                          <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-colors">
                            <UploadCloud className="w-7 h-7 text-gray-400" />
                            <span className="text-sm text-gray-600">Click to attach a PDF to this invoice</span>
                            <input type="file" accept="application/pdf" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { await handleAttachmentUploadForExisting(inv, f); setShowInvoiceModal(false); } e.target.value = ''; }} />
                          </label>
                        ) : (
                          <p className="text-sm text-gray-400 text-center py-3">No attachment</p>
                        )
                      )}
                    </div>
                  </div>
                  {inv.paymentProfile && (
                    <div className="mt-4 border border-green-200 rounded-lg overflow-hidden">
                      <div className="bg-green-50 px-4 py-2 border-b border-green-200"><span className="font-semibold text-green-800 text-sm">💳 Payment Details — {inv.paymentProfile.profileName}</span></div>
                      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                        {[['Company Name', inv.paymentProfile.companyName],['Company Address', inv.paymentProfile.companyAddress],['Country', inv.paymentProfile.country],['Bank Name', inv.paymentProfile.bankName],['Bank Address', inv.paymentProfile.bankAddress],['Bank Branch', inv.paymentProfile.bankBranch],['Account Number', inv.paymentProfile.accountNumber],['IBAN', inv.paymentProfile.iban],['SWIFT / BIC', inv.paymentProfile.swift],['Payment Email', inv.paymentProfile.paymentEmail]].filter(([,v]) => v).map(([label, value]) => (
                          <div key={label as string}><span className="text-gray-500">{label}: </span><span className="font-medium text-gray-800 font-mono">{value}</span></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {showTimesheetModal && selectedTimesheetForView && (
          <TimesheetDetailModal
            timesheet={selectedTimesheetForView}
            users={users}
            projects={projects}
            currentUser={currentUser!}
            countries={countries}
            isHoliday={isHoliday}
            onClose={closeTimesheetModal}
            onApproval={handleApproval}
          />
        )}

        {/* Profile Tab */}
        {userTab === 'profile' && (
          <div className="space-y-6">
            {/* Contact Info */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-indigo-600" /> Contact Information
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input type="text" value={currentUser!.name} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={currentUser!.email} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone (international format)</label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={profilePhone || currentUser!.phone || ''}
                      onChange={e => setProfilePhone(e.target.value)}
                      onFocus={() => { if (!profilePhone) setProfilePhone(currentUser!.phone || ''); }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      placeholder="+44 7700 900123"
                    />
                    <button
                      onClick={async () => {
                        setProfilePhoneSaving(true);
                        const val = profilePhone.trim() || null;
                        const { error } = await supabase.from('profiles').update({ phone: val }).eq('id', currentUser!.id);
                        setProfilePhoneSaving(false);
                        if (error) { alert('Error saving phone: ' + error.message); return; }
                        setCurrentUser({ ...currentUser!, phone: val });
                        alert('Phone number saved!');
                      }}
                      disabled={profilePhoneSaving}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium text-sm"
                    >
                      {profilePhoneSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Include country code, e.g. +1 555 123 4567</p>
                </div>
              </div>
            </div>

            {/* Change Password */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" /> Change Password
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <div className="relative">
                    <input
                      type={profileShowNewPw ? 'text' : 'password'}
                      value={profileNewPassword}
                      onChange={e => setProfileNewPassword(e.target.value)}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      placeholder="Min. 8 characters"
                    />
                    <button type="button" onClick={() => setProfileShowNewPw(!profileShowNewPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {profileShowNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={profileShowConfirmPw ? 'text' : 'password'}
                      value={profileConfirmPassword}
                      onChange={e => setProfileConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                      placeholder="Re-enter new password"
                    />
                    <button type="button" onClick={() => setProfileShowConfirmPw(!profileShowConfirmPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {profileShowConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {profileConfirmPassword && profileNewPassword !== profileConfirmPassword && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                  )}
                  {profileConfirmPassword && profileNewPassword === profileConfirmPassword && (
                    <p className="text-xs text-green-600 mt-1">✓ Passwords match</p>
                  )}
                </div>
                <button
                  onClick={async () => {
                    if (!profileNewPassword) { alert('Please enter a new password.'); return; }
                    if (profileNewPassword.length < 8) { alert('Password must be at least 8 characters.'); return; }
                    if (profileNewPassword !== profileConfirmPassword) { alert('Passwords do not match.'); return; }
                    setProfilePwLoading(true);
                    const { error } = await supabase.auth.updateUser({ password: profileNewPassword });
                    setProfilePwLoading(false);
                    if (error) { alert('Error updating password: ' + error.message); return; }
                    setProfileNewPassword(''); setProfileConfirmPassword('');
                    alert('Password updated successfully!');
                  }}
                  disabled={profilePwLoading || !profileNewPassword || profileNewPassword !== profileConfirmPassword}
                  className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium"
                >
                  {profilePwLoading ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>


    </div>
  );
};

export default TimesheetSystem;
