// ============================================================
// TimesheetSystem.tsx — Supabase-integrated version
// Phase 3 of the Production Deployment Guide
// ============================================================

// Provides overflow-x scroll + a sticky mirror scrollbar that floats at the
// bottom of the viewport so users don't have to scroll to the page bottom to
// drag the scrollbar horizontally.
const StickyScrollWrapper = ({ children, className, maxHeight }: { children: React.ReactNode; className?: string; maxHeight?: string }) => {
  const outerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const [tableWidth, setTableWidth] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const mirror = mirrorRef.current;
    if (!outer || !mirror) return;
    const onOuter = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      mirror.scrollLeft = outer.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    const onMirror = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      outer.scrollLeft = mirror.scrollLeft;
      requestAnimationFrame(() => { syncingRef.current = false; });
    };
    outer.addEventListener('scroll', onOuter);
    mirror.addEventListener('scroll', onMirror);
    const ro = new ResizeObserver(() => setTableWidth(outer.scrollWidth));
    ro.observe(outer);
    setTableWidth(outer.scrollWidth);
    return () => {
      outer.removeEventListener('scroll', onOuter);
      mirror.removeEventListener('scroll', onMirror);
      ro.disconnect();
    };
  }, []);

  // When maxHeight is set, the outer container also handles vertical scrolling so that
  // sticky-top table headers stay anchored as the user scrolls the rows.
  const outerStyle = maxHeight ? { maxHeight } : undefined;
  const outerOverflow = maxHeight ? 'overflow-auto' : 'overflow-x-auto';
  return (
    <div>
      <div ref={outerRef} style={outerStyle} className={`${outerOverflow} -mx-3 sm:mx-0 px-3 sm:px-0 ${className ?? ''}`}>
        {children}
      </div>
      <div ref={mirrorRef} className="overflow-x-scroll sticky bottom-0 -mx-3 sm:mx-0 bg-white border-t border-gray-100" style={{ height: 14 }}>
        <div style={{ width: tableWidth, height: 1 }} />
      </div>
    </div>
  );
};

const ConsolidatedTable = ({ report, parseLocalDate, testAccounts = [] }: { report: { weekEndings: string[]; partialWeeks: Set<string>; employeeRows: { name: string; country: string; project: string; hours: Record<string, number | null>; statuses: Record<string, string>; rowTotal: number }[]; colTotals: Record<string, number>; grandTotal: number; sourceCounts?: { portal: number; email: number } }; parseLocalDate: (s: string) => Date; testAccounts?: string[] }) => {
  const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal, sourceCounts } = report;
  const allStatuses = employeeRows.flatMap(r => Object.values(r.statuses));
  const approvedCells  = allStatuses.filter(s => s === 'approved').length;
  const pendingCells   = allStatuses.filter(s => s === 'pending').length;
  const notSubCells    = allStatuses.filter(s => s === 'not submitted').length;
  const rejectedCells  = allStatuses.filter(s => s === 'rejected').length;
  return (
    <div>
      <div className={`grid grid-cols-2 ${sourceCounts ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4 mb-6`}>
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600">Weeks</div>
          <div className="text-2xl font-bold text-blue-600">{weekEndings.length}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Total Hours</div><div className="text-2xl font-bold text-green-600">{grandTotal.toFixed(1)}h</div></div>
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600 mb-1">Employees</div>
          <div className="text-2xl font-bold text-purple-600 mb-2">{employeeRows.length}</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-green-700">Approved</span><span className="font-semibold text-green-700">{approvedCells}</span></div>
            {pendingCells  > 0 && <div className="flex justify-between"><span className="text-yellow-700">Pending</span><span className="font-semibold text-yellow-700">{pendingCells}</span></div>}
            {notSubCells   > 0 && <div className="flex justify-between"><span className="text-red-600">Not Submitted</span><span className="font-semibold text-red-600">{notSubCells}</span></div>}
            {rejectedCells > 0 && <div className="flex justify-between"><span className="text-gray-500">Rejected</span><span className="font-semibold text-gray-500">{rejectedCells}</span></div>}
          </div>
          {testAccounts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-purple-200">
              <div className="text-xs text-gray-400 mb-1">Test (excluded)</div>
              <div className="flex flex-wrap gap-1">
                {testAccounts.map(name => <span key={name} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">{name}</span>)}
              </div>
            </div>
          )}
        </div>
        <div className="bg-amber-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Avg Hrs/Employee</div><div className="text-2xl font-bold text-amber-600">{employeeRows.length > 0 ? (grandTotal / employeeRows.length).toFixed(1) : 0}h</div></div>
        {sourceCounts && (() => {
          const total = sourceCounts.portal + sourceCounts.email;
          return (
            <div className="bg-indigo-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Submission Channels</div>
              <div className="text-2xl font-bold text-indigo-600 mb-3">{total} <span className="text-sm font-normal text-gray-400">submitted</span></div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-indigo-700">Portal</span>
                  <span className="font-semibold text-indigo-700">
                    {sourceCounts.portal}
                    {total > 0 && <span className="text-gray-400 font-normal ml-1">({Math.round(sourceCounts.portal / total * 100)}%)</span>}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-blue-700">Email</span>
                  <span className="font-semibold text-blue-700">
                    {sourceCounts.email}
                    {total > 0 && <span className="text-gray-400 font-normal ml-1">({Math.round(sourceCounts.email / total * 100)}%)</span>}
                  </span>
                </div>
                {total > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-blue-200 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(sourceCounts.portal / total * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      {partialWeeks.size > 0 && (
        <div className="flex items-center gap-2 mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">Partial</span> weeks include only the working days that fall within the selected date range.
        </div>
      )}
      <StickyScrollWrapper maxHeight="calc(100vh - 320px)">
        <table className="border-collapse text-sm w-full">
          <thead className="sticky top-0 z-20">
            <tr className="bg-green-600 text-white">
              <th className="border border-green-700 px-3 py-2 text-left sticky left-0 z-30 bg-green-600">Employee</th>
              <th className="border border-green-700 px-3 py-2 text-left bg-green-600">Country</th>
              <th className="border border-green-700 px-3 py-2 text-left bg-green-600">Project</th>
              {weekEndings.map((we: string) => {
                const isPartial = partialWeeks.has(we);
                const weekMon = parseLocalDate(we);
                const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4); // Keep for label
                const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
                return (
                  <th key={we} className={`border border-green-700 px-3 py-2 text-center whitespace-nowrap ${isPartial ? 'bg-amber-600' : 'bg-green-600'}`}>
                    <div className="text-xs opacity-80">{isPartial ? 'Partial' : 'W/E'}</div>
                    <div>{weekSun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </th>
                );
              })}
              <th className="border border-green-700 px-3 py-2 text-center bg-green-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {employeeRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className={`border border-gray-300 px-3 py-2 font-semibold sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{row.name}</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-500">{row.country}</td>
                <td className="border border-gray-300 px-3 py-2 text-indigo-600 text-xs">{row.project}</td>
                {weekEndings.map((we: string) => {
                  const h = row.hours[we];
                  const st = row.statuses[we];
                  const isPartial = partialWeeks.has(we);
                  return (
                    <td key={we} className={`border border-gray-300 px-3 py-2 text-center ${isPartial ? 'bg-amber-50' : ''}`}>
                      {h !== null ? <span className={h > 0 ? 'font-semibold text-gray-800' : 'text-gray-400'}>{h.toFixed(1)}</span> : <span className="text-gray-300">-</span>}
                      {h !== null && st !== 'approved' && st !== 'not submitted' && (
                        <div className={'text-xs ' + (st === 'rejected' ? 'text-red-500' : 'text-amber-500')}>{st === 'pending' ? 'pend' : 'rej'}</div>
                      )}
                    </td>
                  );
                })}
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-green-700 bg-green-50">{row.rowTotal.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="bg-green-600 text-white font-bold">
              <td className="border border-green-700 px-3 py-2 sticky left-0 z-10 bg-green-600" colSpan={3}>Total</td>
              {weekEndings.map((we: string) => (
                <td key={we} className={`border border-green-700 px-3 py-2 text-center ${partialWeeks.has(we) ? 'bg-amber-600' : ''}`}>{colTotals[we].toFixed(1)}</td>
              ))}
              <td className="border border-green-700 px-3 py-2 text-center bg-green-700">{grandTotal.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </StickyScrollWrapper>
    </div>
  );
};

import { useState, useEffect, useRef, Fragment } from 'react';
import { Calendar, Clock, CheckCircle, XCircle, LogOut, LogIn, Users, Mail, FileText, Download, Printer, Plus, Edit2, Trash2, Save, X, Settings, MapPin, DollarSign, Receipt, Paperclip, ExternalLink, UploadCloud, BarChart2, Eye, EyeOff, AlertTriangle, CreditCard, ChevronDown, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';

// ─── TypeScript interfaces ────────────────────────────────────────────────────
interface UserProfile {
  id: string;
  username: string;
  name: string;
  role: 'timesheetuser' | 'manager' | 'accountant' | 'admin' | 'vendormanager';
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
}

interface Project {
  id: number;
  name: string;
  code: string;
  status: 'active' | 'inactive';
  description: string;
}

interface TimeEntry {
  hours: string;
  isHoliday?: boolean | { date: string; name: string };
  holidayName?: string;
  isWeekend?: boolean;
}

interface Timesheet {
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
}

interface PaymentProfile {
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
}

interface ConveraBeneficiary {
  id: number;
  beneficiaryId: string;
  shortName: string;
  beneficiaryName: string;
  beneficiaryCountry: string | null;
  currency: string;
  defaultPaymentMethod: string;
  bankName: string | null;
  bankCountry: string | null;
  bankAccount: string;
  ibanUnique: boolean;
}

interface InvoiceLine {
  weekStart: string;
  weekEndingFri: string;
  hours: number | null;
  rate: number | null;
  amount: number;
  userId?: string;
  userName?: string;
}

interface Invoice {
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
  source: 'direct' | 'imported' | null;
  reconciliationStatus: 'matched' | 'mismatch' | 'unverifiable' | null;
  reconciliationDelta: number | null;
  reconciliationNotes: string | null;
  groupKey: string | null;  // shared key for multi-contractor invoices from same attachment
  corrected: boolean;        // re-submitted with different values; reset to submitted for re-approval
  paymentTerms: string | null; // NET15 / NET30 / NET45 / NET60
}

interface ConveraPaymentRow {
  source: 'convera' | 'quickbooks' | 'intuit';
  itemNumber: string;       // OTR ref for Convera; empty for Intuit
  beneficiary: string;
  amount: number;
  currency: string;
  invoiceRef: string;       // from "Re: Inv#" for Convera; empty for Intuit
  suggestedDate: string;    // date from Intuit email; empty for Convera
  matchedInvoice: Invoice | null;
  selected: boolean;
}

interface ReminderEmail {
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

interface UserForm {
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
}

interface ProjectForm {
  name: string;
  code: string;
  status: string;
  description: string;
}

const tzMap: Record<string, string> = {
  'US-California': 'America/Los_Angeles', 'US-New York': 'America/New_York',
  'US-Texas': 'America/Chicago', 'US-Florida': 'America/New_York',
  'GB-England': 'Europe/London', 'GB-Scotland': 'Europe/London', 'GB-Wales': 'Europe/London',
  'CA-Ontario': 'America/Toronto', 'CA-Quebec': 'America/Toronto', 'CA-British Columbia': 'America/Vancouver',
  'HR-': 'Europe/Zagreb', 'RS-': 'Europe/Belgrade', 'BA-': 'Europe/Sarajevo',
  'SI-': 'Europe/Ljubljana', 'MK-': 'Europe/Skopje',
  'HR-Croatia': 'Europe/Zagreb', 'RS-Serbia': 'Europe/Belgrade',
  'BA-Bosnia and Herzegovina': 'Europe/Sarajevo', 'SI-Slovenia': 'Europe/Ljubljana',
  'MK-North Macedonia': 'Europe/Skopje',
  'IN-': 'Asia/Kolkata',
  'NL-': 'Europe/Amsterdam',
};


// World countries for payment profile (excludes sanctioned countries)
const WORLD_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
  "Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo (Brazzaville)",
  "Congo (Kinshasa)","Costa Rica","Croatia","Cyprus","Czech Republic","Denmark",
  "Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador",
  "Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland",
  "France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada",
  "Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary",
  "Iceland","India","Indonesia","Iraq","Ireland","Israel","Italy","Jamaica",
  "Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Liechtenstein","Lithuania",
  "Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta",
  "Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova",
  "Monaco","Mongolia","Montenegro","Morocco","Mozambique","Namibia","Nauru",
  "Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Macedonia",
  "Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea",
  "Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa",
  "San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia",
  "Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands",
  "South Africa","South Korea","Spain","Sri Lanka","Suriname","Sweden","Switzerland",
  "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga",
  "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda",
  "Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay",
  "Uzbekistan","Vanuatu","Vatican City","Vietnam","Zambia"
].sort();

// ─── Live invoice reconciliation (pure, no DB writes) ────────────────────────
// Called on every render so it always reflects the latest loaded timesheets.
interface ReconTimesheetRow {
  ts: Timesheet;
  hoursInPeriod: number;
  weekEnd: string; // Sunday of the week
}

function reconcileInvoiceLive(
  invoice: Invoice,
  allTimesheets: Timesheet[]
): { status: 'matched' | 'mismatch' | 'unverifiable'; delta: number | null; timesheetHours: number | null; rows: ReconTimesheetRow[]; missingWeeks: number } {
  const { userId, periodStart, periodEnd, totalHours } = invoice;

  // Week range: week_start can be up to 6 days before periodStart and still contain period days
  const rangeStart = new Date(periodStart + 'T12:00:00');
  rangeStart.setDate(rangeStart.getDate() - 6);
  const rangeStartStr = rangeStart.toISOString().slice(0, 10);

  const relevant = allTimesheets.filter(ts =>
    ts.userId === userId && ts.weekStart >= rangeStartStr && ts.weekStart <= periodEnd
  );

  // All Mondays whose week overlaps the invoice period (to detect missing weeks).
  // Start from Monday of periodStart (not rangeStart) — weeks before periodStart don't count.
  const expectedWeeks: string[] = [];
  const firstDay = new Date(periodStart + 'T12:00:00');
  const firstDow = firstDay.getDay();
  firstDay.setDate(firstDay.getDate() - (firstDow === 0 ? 6 : firstDow - 1));
  const cur = new Date(firstDay.getTime());
  while (cur.toISOString().slice(0, 10) <= periodEnd) {
    expectedWeeks.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 7);
  }

  if (!relevant.length) return { status: 'unverifiable', delta: null, timesheetHours: null, rows: [], missingWeeks: expectedWeeks.length };

  const rows: ReconTimesheetRow[] = [];
  let tsHours = 0;
  for (const ts of relevant) {
    let hoursInPeriod = 0;
    for (const [date, entry] of Object.entries(ts.entries)) {
      if (date >= periodStart && date <= periodEnd) {
        const h = parseFloat(entry.hours);
        if (!isNaN(h) && h > 0) hoursInPeriod += h;
      }
    }
    // weekEnd = weekStart + 6 days (Sunday)
    const sun = new Date(ts.weekStart + 'T12:00:00');
    sun.setDate(sun.getDate() + 6);
    rows.push({ ts, hoursInPeriod: Math.round(hoursInPeriod * 100) / 100, weekEnd: sun.toISOString().slice(0, 10) });
    tsHours += hoursInPeriod;
  }
  tsHours = Math.round(tsHours * 100) / 100;

  const weeksWithHours = new Set(rows.filter(r => r.hoursInPeriod > 0).map(r => r.ts.weekStart));
  const missingWeeks = expectedWeeks.filter(w => !weeksWithHours.has(w)).length;

  if (tsHours === 0) return { status: 'unverifiable', delta: null, timesheetHours: 0, rows, missingWeeks };
  if (totalHours == null) return { status: 'unverifiable', delta: null, timesheetHours: tsHours, rows, missingWeeks };

  const delta = Math.round((totalHours - tsHours) * 100) / 100;
  const matched = Math.abs(delta) < 0.01;
  return { status: matched ? 'matched' : 'mismatch', delta: matched ? 0 : delta, timesheetHours: tsHours, rows, missingWeeks };
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

  const countries = [
    { code: 'US', name: 'United States', regions: ['California', 'New York', 'Texas', 'Florida'] },
    { code: 'GB', name: 'United Kingdom', regions: ['England', 'Scotland', 'Wales'] },
    { code: 'CA', name: 'Canada', regions: ['Ontario', 'Quebec', 'British Columbia'] },
    { code: 'HR', name: 'Croatia', regions: ['Croatia'] },
    { code: 'RS', name: 'Serbia', regions: ['Serbia'] },
    { code: 'BA', name: 'Bosnia and Herzegovina', regions: ['Bosnia and Herzegovina'] },
    { code: 'SI', name: 'Slovenia', regions: ['Slovenia'] },
    { code: 'MK', name: 'North Macedonia', regions: ['North Macedonia'] },
    { code: 'IN', name: 'India', regions: ['India'] },
    { code: 'NL', name: 'Netherlands', regions: ['Netherlands'] },
  ];

  const countryName = (code: string) => countries.find(c => c.code === code)?.name || code;
  const paymentMethod = (inv: Invoice) => {
    if (inv.paymentMethodOverride) return inv.paymentMethodOverride;
    const country = inv.paymentProfile?.country || '';
    return (country === 'United States' || country === 'US') ? 'Intuit' : 'Convera';
  };

  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const timesheetsRef = useRef<Timesheet[]>([]);
  const [accountantTab, setAccountantTab] = useState('weekly');
  const [profileTabSearch, setProfileTabSearch] = useState('');
  const [profileTabFilter, setProfileTabFilter] = useState<'all'|'multiple'|'unmatched'>('all');
  const [profileTabExcludeTest, setProfileTabExcludeTest] = useState(true);
  const [expandedProfileUsers, setExpandedProfileUsers] = useState<Set<string>>(new Set());
  // When accountant edits/creates a profile for another contractor, this overrides currentUser
  // in savePaymentProfile. Null = save against currentUser (contractor's own management page).
  const [profileEditUserId, setProfileEditUserId] = useState<string | null>(null);
  const [consolidatedRange, setConsolidatedRange] = useState({ start: '', end: '' });
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [consolidatedMonthPreset, setConsolidatedMonthPreset] = useState('');
  const [consolidatedProjectFilter, setConsolidatedProjectFilter] = useState('all');
  const [excludeTestAccounts, setExcludeTestAccounts] = useState(true);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekStart());
  const [timeEntries, setTimeEntries] = useState<Record<string, TimeEntry>>({});
  const [detectedLocation, setDetectedLocation] = useState<{ country: string; region: string; timezone: string } | null>(null);
  const [reminderEmails, setReminderEmails] = useState<ReminderEmail[]>([]);
  const [showReminderLog, setShowReminderLog] = useState(false);
  const [reportWeek, setReportWeek] = useState(getCurrentWeekStart());
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
    email: '', password: '', name: '', role: 'timesheetuser', manager_id: null, country: 'US', region: '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '', phone: '', email_approvals_enabled: false, invoice_enabled: true, reminders_enabled: true, vendor_manager_id: null, payment_terms: ''
  });
  const [projectForm, setProjectForm] = useState<ProjectForm>({
    name: '', code: '', status: 'active', description: ''
  });
  const [viewMode, setViewMode] = useState('form');
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
  const [accountantInvoiceFilter, setAccountantInvoiceFilter] = useState('all');
  const [showConsolidatedExportMenu, setShowConsolidatedExportMenu] = useState(false);
  const [invoiceDateRange, setInvoiceDateRange] = useState({ start: '', end: '' });
  const [invoicePayDateRange, setInvoicePayDateRange] = useState({ start: '', end: '' });
  const [invoicePaidDateRange, setInvoicePaidDateRange] = useState({ start: '', end: '' });
  const [pendingPayOnDate, setPendingPayOnDate] = useState('');
  const [pendingPaymentMethod, setPendingPaymentMethod] = useState('');
  const [pendingPaymentTerms, setPendingPaymentTerms] = useState('');
  const [pendingPaidDate, setPendingPaidDate] = useState('');     // actual paid date (set when marking paid)
  const [pendingUsdRate, setPendingUsdRate] = useState('');
  const [invoiceMonthPreset, setInvoiceMonthPreset] = useState('');
  const [invoicePayOnPreset, setInvoicePayOnPreset] = useState(''); // '' = all, 'none' = not assigned, or 'YYYY-MM-DD'
  const [invoicePaymentMethodPreset, setInvoicePaymentMethodPreset] = useState(''); // '' = all, 'Intuit', or 'Convera'
  const [showConveraMatchingModal, setShowConveraMatchingModal] = useState(false);
  const [converaMatchingSearch, setConveraMatchingSearch] = useState('');
  // Payment import (Convera PDF + QuickBooks XLSX + Intuit emails)
  const [showConveraModal, setShowConveraModal] = useState(false);
  const [converaTab, setConveraTab] = useState<'convera' | 'quickbooks' | 'intuit' | 'beneficiaries'>('quickbooks');
  const [converaFile, setConveraFile] = useState<File | null>(null);
  const [qbFile, setQbFile] = useState<File | null>(null);
  const [intuitText, setIntuitText] = useState('');
  const [converaRows, setConveraRows] = useState<ConveraPaymentRow[]>([]);
  const [converaParsing, setConveraParsing] = useState(false);
  const [converaApplying, setConveraApplying] = useState(false);
  const [converaPaidDate, setConveraPaidDate] = useState('');
  const [converaError, setConveraError] = useState('');
  // Convera beneficiaries
  const [converaBeneficiaries, setConveraBeneficiaries] = useState<ConveraBeneficiary[]>([]);
  const [converaLastPaymentDates, setConveraLastPaymentDates] = useState<Map<number, string>>(new Map());
  const [beneficiaryImportFile, setBeneficiaryImportFile] = useState<File | null>(null);
  const [beneficiaryImporting, setBeneficiaryImporting] = useState(false);
  const [beneficiaryImportResult, setBeneficiaryImportResult] = useState<{
    imported: number; matched: number;
    unmatched: { profileId: number; userId: string; userName: string }[];
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
  const [vmTab, setVmTab] = useState<'timesheets' | 'create' | 'invoices' | 'profile'>('timesheets');
  const [vmPeriod, setVmPeriod] = useState({ start: '', end: '' });
  const [vmInvoiceType, setVmInvoiceType] = useState<'consolidated' | 'per-user'>('consolidated');
  const [vmRates, setVmRates] = useState<Record<string, string>>({});
  const [vmCurrency, setVmCurrency] = useState('USD');
  const [vmPaymentProfileId, setVmPaymentProfileId] = useState<number | null>(null);
  const [vmInvoiceNumber, setVmInvoiceNumber] = useState('');
  const [vmNotes, setVmNotes] = useState('');
  const [vmPhoneConfirm, setVmPhoneConfirm] = useState('');
  const [tsOnlyRange, setTsOnlyRange] = useState({ start: '', end: '' });
  const [tsOnlyApplied, setTsOnlyApplied] = useState({ start: '', end: '' });
  const [tsOnlySelectedUsers, setTsOnlySelectedUsers] = useState<string[] | null>(null);
  const [tsOnlySearch, setTsOnlySearch] = useState('');
  const [tsOnlyDropdownOpen, setTsOnlyDropdownOpen] = useState(false);
  const [invoiceSelectedUsers, setInvoiceSelectedUsers] = useState<string[] | null>(null);
  const [invoiceUserSearch, setInvoiceUserSearch] = useState('');
  const [invoiceUserDropdownOpen, setInvoiceUserDropdownOpen] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentSignedUrls, setAttachmentSignedUrls] = useState<Record<number, string>>({});
  // Manager consolidated view
  const [managerConsolidatedRange, setManagerConsolidatedRange] = useState({ start: '', end: '' });
  const [managerAppliedRange, setManagerAppliedRange] = useState({ start: '', end: '' });
  const [managerMonthPreset, setManagerMonthPreset] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PaymentProfile | null>(null);
  const emptyProfileForm = (): Omit<PaymentProfile, 'id' | 'userId'> => ({
    profileName: '', companyName: '', companyAddress: '', country: '', bankName: '',
    bankAddress: '', bankBranch: '', accountNumber: '', iban: '', swift: '', paymentEmail: '', isDefault: false, combinePayments: null,
    converaBeneficiaryId: null, converaMatchOverride: false,
  });
  const [profileForm, setProfileForm] = useState(emptyProfileForm());
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);

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

  // Pre-fill payment terms + auto-calculate pay-on when invoice modal opens.
  // Also reset all "pending" form state — otherwise values leak between invoices when
  // the accountant switches modals (e.g. seeing "Intuit" on Rumiya because they just
  // saved Intuit for Mek).
  useEffect(() => {
    if (!selectedInvoice) return;
    setPendingPaymentMethod('');
    setPendingPayOnDate('');
    setPendingPaidDate('');
    setPendingUsdRate('');
    const profileTerms = users.find(u => u.id === selectedInvoice.userId)?.paymentTerms || '';
    const terms = selectedInvoice.paymentTerms || profileTerms;
    setPendingPaymentTerms(terms);
    if (terms && !selectedInvoice.payOnDate) {
      setPendingPayOnDate(calculatePayOn(selectedInvoice.periodEnd, terms));
    }
  }, [selectedInvoice?.id]);

  useEffect(() => {
    if (!currentUser) return;
    const channel = supabase.channel('timesheets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'timesheets' }, () => {
        fetchTimesheets();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.id]);

  // Auto-default invoices tab to latest month when data first loads
  useEffect(() => {
    if (invoices.length > 0 && invoiceMonthPreset === '') {
      const latest = [...new Set(invoices.map(i => i.periodEnd?.slice(0, 7)).filter(Boolean) as string[])]
        .sort((a, b) => b.localeCompare(a))[0];
      if (latest) setInvoiceMonthPreset(latest);
    }
  }, [invoices.length]);

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

  function parseLocalDate(dateStr: string): Date {
    // Handle full ISO strings like '2026-02-23T00:00:00.000Z' by taking just the date part
    const clean = dateStr.split('T')[0];
    const [y, m, d] = clean.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function calculatePayOn(periodEnd: string, terms: string): string {
    const daysMap: Record<string, number> = { NET15: 15, NET30: 30, NET45: 45, NET60: 60 };
    const n = daysMap[terms];
    if (!n || !periodEnd) return '';
    const due = parseLocalDate(periodEnd);
    due.setDate(due.getDate() + n);
    // Find the first payment run (15th or EOM) on or after the due date
    let payRun: Date | null = null;
    for (let mo = 0; mo <= 3 && !payRun; mo++) {
      const y = due.getFullYear() + Math.floor((due.getMonth() + mo) / 12);
      const m = (due.getMonth() + mo) % 12;
      for (const candidate of [new Date(y, m, 15), new Date(y, m + 1, 0)]) {
        if (candidate >= due) { payRun = candidate; break; }
      }
    }
    if (!payRun) return '';
    const dow = payRun.getDay();
    if (dow === 6) payRun.setDate(payRun.getDate() - 1); // Sat → Fri
    if (dow === 0) payRun.setDate(payRun.getDate() + 1); // Sun → Mon
    return `${payRun.getFullYear()}-${String(payRun.getMonth() + 1).padStart(2, '0')}-${String(payRun.getDate()).padStart(2, '0')}`;
  }

  function formatDate(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getWeekDates(startDate: Date): Date[] {
    // startDate is Monday; returns Mon–Sun (7 days)
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);
      dates.push(date);
    }
    return dates;
  }

  function getWeekSunday(weekStart: Date): Date {
    const sun = new Date(weekStart);
    sun.setDate(sun.getDate() + 6);
    return sun;
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

  function isWeekend(date: Date): boolean { const d = date.getDay(); return d === 0 || d === 6; }

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
      setUserForm({ email: user.email, password: '', name: user.name, role: user.role, manager_id: user.managerId, country: user.country, region: user.region, project_id: user.projectId, start_date: user.startDate || '', end_date: user.endDate || '', phone: user.phone || '', email_approvals_enabled: user.emailApprovalsEnabled || false, invoice_enabled: user.invoiceEnabled !== false, reminders_enabled: user.remindersEnabled !== false, vendor_manager_id: user.vendorManagerId || null, payment_terms: user.paymentTerms || '' });
    } else {
      setEditingUser(null);
      const autoPassword = generatePassword();
      setUserForm({ email: '', password: autoPassword, name: '', role: 'timesheetuser', manager_id: null, country: detectedLocation?.country || 'US', region: detectedLocation?.region || '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '', phone: '', email_approvals_enabled: false, invoice_enabled: true, reminders_enabled: true, vendor_manager_id: null, payment_terms: '' });
    }
    setShowUserModal(true);
  };

  const openQuickAddModal = () => {
    setEditingUser(null);
    setUserForm({ email: '', password: generatePassword(), name: '', role: 'timesheetuser', manager_id: null, country: detectedLocation?.country || 'US', region: detectedLocation?.region || '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '', phone: '', email_approvals_enabled: false, invoice_enabled: true, reminders_enabled: true, vendor_manager_id: null, payment_terms: '' });
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
      currency: (r.currency as string) || '',
      defaultPaymentMethod: (r.default_payment_method as string) || '',
      bankName: r.bank_name as string | null ?? null,
      bankCountry: r.bank_country as string | null ?? null,
      bankAccount: (r.bank_account as string) || '',
      ibanUnique: !!(r.iban_unique as boolean),
    };
  }

  async function loadConveraBeneficiaries() {
    if (converaBeneficiaries.length > 0) return;
    const { data } = await supabase.from('convera_beneficiaries').select('*').order('short_name');
    if (data) setConveraBeneficiaries(data.map(normaliseConveraBeneficiary));
  }

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

  function autoMatchBeneficiary(contractorName: string, profileIban: string, beneficiaries: ConveraBeneficiary[]): ConveraBeneficiary | null {
    if (!contractorName) return null;
    // 1. Unique IBAN match
    if (profileIban) {
      const ibanMatches = beneficiaries.filter(b => b.bankAccount === profileIban);
      if (ibanMatches.length === 1 && ibanMatches[0].ibanUnique) return ibanMatches[0];
    }
    // 2. Short name prefix match
    const normName = normBenefName(contractorName);
    return beneficiaries.find(b => normBenefName(b.shortName).startsWith(normName)) ?? null;
  }

  async function importConveraBeneficiaries(file: File) {
    setBeneficiaryImporting(true);
    setBeneficiaryImportResult(null);
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Record<string, unknown>[];
      const rows = raw.map(r => ({
        beneficiary_id: String(r['Beneficiary ID'] || ''),
        short_name: String(r['Short Name'] || ''),
        beneficiary_name: String(r['Beneficiary Name'] || ''),
        beneficiary_country: r['Beneficiary Country'] ? String(r['Beneficiary Country']) : null,
        currency: r['Currency'] ? String(r['Currency']) : null,
        default_payment_method: r['Default Payment Method'] ? String(r['Default Payment Method']) : null,
        vendor_id: r['Vendor ID'] ? String(r['Vendor ID']) : null,
        bank_name: r['Bank Name'] ? String(r['Bank Name']) : null,
        bank_country: r['Bank Country'] ? String(r['Bank Country']) : null,
        bank_account: r['Bank Account'] ? String(r['Bank Account']) : null,
        iban_unique: r['iban_unique'] !== false,
        updated_by: r['Updated By'] ? String(r['Updated By']) : null,
        updated_date: r['Updated Date'] ? String(r['Updated Date']) : null,
      })).filter(r => r.beneficiary_id);
      // Upsert in batches of 50
      for (let i = 0; i < rows.length; i += 50) {
        await supabase.from('convera_beneficiaries').upsert(rows.slice(i, i + 50), { onConflict: 'beneficiary_id' });
      }
      // Reload beneficiaries
      const { data: benefs } = await supabase.from('convera_beneficiaries').select('*').order('short_name');
      const normBenefs = (benefs || []).map(normaliseConveraBeneficiary);
      setConveraBeneficiaries(normBenefs);
      // Auto-match payment profiles (skip manual overrides)
      const { data: profiles } = await supabase.from('payment_profiles').select('id, user_id, iban, convera_match_override');
      const unmatched: { profileId: number; userId: string; userName: string }[] = [];
      let matchedCount = 0;
      for (const profile of profiles || []) {
        if (profile.convera_match_override) continue;
        const user = users.find(u => u.id === profile.user_id);
        const match = autoMatchBeneficiary(user?.name || '', profile.iban || '', normBenefs);
        if (match) {
          await supabase.from('payment_profiles').update({ convera_beneficiary_id: match.id }).eq('id', profile.id);
          matchedCount++;
        } else {
          unmatched.push({ profileId: profile.id, userId: profile.user_id, userName: user?.name || profile.user_id });
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
    await supabase.from('payment_profiles').update({
      convera_beneficiary_id: beneficiaryId,
      convera_match_override: beneficiaryId !== null,
    }).eq('id', profileId);
    await fetchPaymentProfiles();
    setBeneficiaryOverrideProfileId(null);
    setBeneficiaryOverrideSearch('');
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
      source: (r.source as 'direct' | 'imported') || null,
      reconciliationStatus: (r.reconciliation_status as 'matched' | 'mismatch' | 'unverifiable') || null,
      reconciliationDelta: r.reconciliation_delta != null ? Number(r.reconciliation_delta) : null,
      reconciliationNotes: (r.reconciliation_notes as string) || null,
      groupKey: (r.group_key as string) || null,
      corrected: !!(r.corrected as boolean),
      paymentTerms: (r.payment_terms as string) || null,
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
    const startD = parseLocalDate(periodStart), endD = parseLocalDate(periodEnd);
    const userTimesheets = timesheets.filter(t => {
      if (t.userId !== userId || t.status !== 'approved') return false;
      const weekMon = parseLocalDate(t.weekStart);
      const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
      return weekMon <= endD && weekSun >= startD;
    });
    return userTimesheets
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(ts => {
        const weekMon = parseLocalDate(ts.weekStart);
        const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4); // Keep Fri for invoice label
        let hours = 0;
        Object.entries(ts.entries).forEach(([dateKey, entry]) => {
          const d = parseLocalDate(dateKey);
          if (d >= startD && d <= endD) hours += parseFloat((entry as TimeEntry)?.hours || '0');
        });
        return { weekStart: ts.weekStart, weekEndingFri: formatDate(weekFri), hours: parseFloat(hours.toFixed(2)), rate, amount: parseFloat((hours * rate).toFixed(2)) };
      })
      .filter(l => l.hours > 0);
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
    setPendingUsdRate('');
  };

  const handleInvoiceAction = async (invoiceId: number, status: 'approved' | 'rejected' | 'paid', payOnDate?: string, paidDate?: string, pmOverride?: string, paymentTerms?: string) => {
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
    // Cascade non-empty terms to the contractor's profile default
    if (paymentTerms && selectedInvoice?.userId) {
      await supabase.from('profiles').update({ payment_terms: paymentTerms }).eq('id', selectedInvoice.userId);
      setUsers(prev => prev.map(u => u.id === selectedInvoice.userId ? { ...u, paymentTerms } : u));
    }
    await fetchInvoices();
    setShowInvoiceModal(false);
    setPendingPayOnDate('');
    setPendingPaidDate('');
    setPendingPaymentMethod('');
    setPendingPaymentTerms('');
    setPendingUsdRate('');
    
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

  // Save approval status and/or pay on date without closing modal
  const saveInvoiceEdits = async (invoiceId: number, fields: { status?: 'approved' | 'rejected'; payOnDate?: string; paymentMethod?: string; paymentTerms?: string }) => {
    const update: Record<string, unknown> = {};
    if (fields.status !== undefined) {
      update.status = fields.status;
      update.reviewed_at = new Date().toISOString();
      update.reviewed_by = currentUser!.name;
    }
    if (fields.payOnDate !== undefined) update.pay_on_date = fields.payOnDate || null;
    if (fields.paymentMethod !== undefined) update.payment_method = fields.paymentMethod || null;
    if (fields.paymentTerms !== undefined) update.payment_terms = fields.paymentTerms || null;
    const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId);
    if (error) { alert('Error saving changes: ' + error.message); return; }
    // Cascade non-empty terms to the contractor's profile default
    if (fields.paymentTerms && selectedInvoice?.userId) {
      await supabase.from('profiles').update({ payment_terms: fields.paymentTerms }).eq('id', selectedInvoice.userId);
      setUsers(prev => prev.map(u => u.id === selectedInvoice.userId ? { ...u, paymentTerms: fields.paymentTerms! } : u));
    }
    await fetchInvoices();
    setSelectedInvoice(prev => prev ? {
      ...prev,
      ...(fields.status ? { status: fields.status, reviewedBy: currentUser!.name, reviewedAt: new Date().toISOString() } : {}),
      ...(fields.payOnDate !== undefined ? { payOnDate: fields.payOnDate || null } : {}),
      ...(fields.paymentMethod !== undefined ? { paymentMethodOverride: fields.paymentMethod || null } : {}),
      ...(fields.paymentTerms !== undefined ? { paymentTerms: fields.paymentTerms || null } : {}),
    } : prev);
  };

  const switchInvoicePaymentProfile = async (invoiceId: number, newProfile: PaymentProfile) => {
    const { error } = await supabase.from('invoices').update({ payment_profile: newProfile }).eq('id', invoiceId);
    if (error) { alert('Error switching profile: ' + error.message); return; }
    setSelectedInvoice(prev => prev ? { ...prev, paymentProfile: newProfile } : prev);
    setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, paymentProfile: newProfile } : i));
    
  };


  const savePaymentProfile = async () => {
    if (!profileForm.profileName || !profileForm.companyName || !profileForm.bankName || !profileForm.accountNumber || !profileForm.swift) {
      alert('Please fill in all required fields: Profile Label, Company Name, Bank Name, Account Number and SWIFT/BIC.'); return;
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
    return (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  const parseConveraPdf = async () => {
    if (!converaFile) return;
    setConveraParsing(true);
    setConveraError('');
    setConveraRows([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.append('pdf', converaFile);
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-convera`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${session?.access_token}` }, body: form }
      );
      const json = await resp.json();
      if (!resp.ok || json.error) { setConveraError(json.error || 'Parse failed'); return; }
      const rows: ConveraPaymentRow[] = (json.payments || []).map((p: { itemNumber: string; beneficiary: string; amount: number; currency: string; invoiceRef: string }) => {
        const ref = (p.invoiceRef || '').trim();
        const match = invoices.find(inv => normaliseRef(inv.invoiceNumber) === normaliseRef(ref));
        return { source: 'convera' as const, suggestedDate: '', ...p, matchedInvoice: match ?? null, selected: !!match && match.status !== 'paid' };
      });
      setConveraRows(rows);
      if (!converaPaidDate) setConveraPaidDate(new Date().toISOString().slice(0, 10));
    } catch (e: unknown) {
      setConveraError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConveraParsing(false);
    }
  };

  function normaliseCompany(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/\b(inc|corp|llc|ltd|d\.?o\.?o\.?|s\.?r\.?o\.?|gmbh|co|technologies|solutions|services|agency|group|digital|labs?|tech)\b\.?/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseIntuitDateStr(s: string): string {
    const months: Record<string, string> = {
      january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
      july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
    };
    const m = s.match(/(\w+)\s+(\d+)/);
    if (!m) return '';
    const mon = months[m[1].toLowerCase()];
    const day = m[2].padStart(2, '0');
    if (!mon) return '';
    return `${new Date().getFullYear()}-${mon}-${day}`;
  }

  const parseQbXlsx = async () => {
    if (!qbFile) return;
    setConveraError('');
    setConveraRows([]);
    try {
      const buffer = await qbFile.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

      // Find header row: look for a row containing "Date" and "Name"
      let headerIdx = -1;
      for (let i = 0; i < rawRows.length; i++) {
        const r = rawRows[i] as string[];
        if (r.some(c => String(c).trim() === 'Date') && r.some(c => String(c).trim() === 'Name')) {
          headerIdx = i;
          break;
        }
      }
      if (headerIdx < 0) { setConveraError('Could not find header row. Expected columns: Date, Name, Memo/Description, Split, Amount.'); return; }

      const headers = (rawRows[headerIdx] as string[]).map(h => String(h).trim().toLowerCase());
      const col = (name: string) => headers.indexOf(name);
      const iDate = col('date'), iName = col('name'), iMemo = col('memo/description'), iSplit = col('split'), iAmt = col('amount');

      if ([iDate, iName, iAmt].some(i => i < 0)) { setConveraError('Missing required columns: Date, Name, Amount.'); return; }

      // Extract payments: take "Business Checking" split rows (have invoice memo + positive amount = the offset entry)
      // OR take "Contractor Payment" rows (negative amount = the actual outgoing payment)
      // We use Business Checking rows because they carry the Inv# memo.
      const payments: ConveraPaymentRow[] = [];
      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const r = rawRows[i] as (string | number)[];
        const split  = iSplit >= 0 ? String(r[iSplit]).trim() : '';
        const amt    = parseFloat(String(r[iAmt]));
        if (isNaN(amt) || amt <= 0) continue; // skip negatives, totals, empty rows
        if (split !== 'Business Checking') continue; // only take the memo-bearing row

        const dateRaw = String(r[iDate]).trim();
        const name    = String(r[iName]).trim();
        const memo    = iMemo >= 0 ? String(r[iMemo]).trim() : '';

        // Parse date MM/DD/YYYY → YYYY-MM-DD
        const dm = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        const paidDate = dm ? `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}` : '';

        // Extract invoice ref from memo ("Inv# XXX" or "Invoice# XXX")
        const invMatch = memo.match(/Inv#?\s*([A-Za-z0-9][\w\-\/\.]+)/i);
        const invoiceRef = invMatch?.[1]?.trim() ?? '';

        // Match: try invoice number first, then company name + amount
        let matchedInvoice: Invoice | null = null;
        if (invoiceRef) {
          matchedInvoice = invoices.find(inv => normaliseRef(inv.invoiceNumber) === normaliseRef(invoiceRef)) ?? null;
        }
        if (!matchedInvoice) {
          const normName = normaliseCompany(name);
          matchedInvoice = invoices.find(inv => {
            const invComp = normaliseCompany(inv.paymentProfile?.companyName || inv.userName);
            return (invComp.includes(normName) || normName.includes(invComp)) && Math.abs(inv.totalAmount - amt) < 0.02;
          }) ?? null;
        }

        payments.push({
          source: 'quickbooks',
          itemNumber: '',
          beneficiary: name,
          amount: amt,
          currency: 'USD',
          invoiceRef,
          suggestedDate: paidDate,
          matchedInvoice,
          selected: !!matchedInvoice && matchedInvoice.status !== 'paid',
        });
      }

      if (!payments.length) { setConveraError('No outgoing payments found. Make sure this is a QuickBooks Transaction Detail export with a "Split" column.'); return; }

      setConveraRows(payments);
      // Pre-fill paid date from most common date in the export
      const dates = payments.map(p => p.suggestedDate).filter(Boolean);
      const dateFreq = dates.reduce<Record<string, number>>((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
      const mostCommon = Object.entries(dateFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      if (!converaPaidDate && mostCommon) setConveraPaidDate(mostCommon);
    } catch (e: unknown) {
      setConveraError(e instanceof Error ? e.message : 'Failed to parse file');
    }
  };

  const parseIntuitEmails = () => {
    if (!intuitText.trim()) return;
    setConveraError('');
    // Each email: "payment of $X.XX to COMPANY has been scheduled. ...paid on Month Nth"
    const pattern = /payment\s+of\s+\$([\d,]+\.?\d*)\s+to\s+(.+?)\s+has\s+been\s+scheduled[\s\S]*?paid\s+on\s+(\w+\s+\d+(?:st|nd|rd|th)?)/gi;
    const matches = [...intuitText.matchAll(pattern)];
    if (!matches.length) {
      setConveraError('No payment entries found. Make sure the pasted text includes "payment of $X.XX to COMPANY has been scheduled".');
      return;
    }
    const rows: ConveraPaymentRow[] = matches.map(m => {
      const amount    = parseFloat(m[1].replace(/,/g, ''));
      const beneficiary = m[2].trim();
      const dateStr   = m[3].trim();
      const suggestedDate = parseIntuitDateStr(dateStr);

      // Match by: (normalised company name ≈ userName or paymentProfile.companyName) AND amount
      const normBenef = normaliseCompany(beneficiary);
      const match = invoices.find(inv => {
        const invComp = normaliseCompany(inv.paymentProfile?.companyName || inv.userName);
        const nameOk = invComp.includes(normBenef) || normBenef.includes(invComp);
        const amtOk  = Math.abs(inv.totalAmount - amount) < 0.02;
        return nameOk && amtOk && inv.status !== 'paid';
      }) ?? null;

      return {
        source: 'intuit' as const,
        itemNumber: '',
        beneficiary,
        amount,
        currency: 'USD',
        invoiceRef: '',
        suggestedDate,
        matchedInvoice: match,
        selected: !!match,
      };
    });
    setConveraRows(rows);
    // Pre-populate paid date from first entry if all same
    const dates = [...new Set(rows.map(r => r.suggestedDate).filter(Boolean))];
    if (dates.length === 1 && !converaPaidDate) setConveraPaidDate(dates[0]);
  };

  const applyConveraPayments = async () => {
    const selected = converaRows.filter(r => r.selected && r.matchedInvoice);
    if (!selected.length) return;
    if (!converaPaidDate) { alert('Please enter the payment date.'); return; }
    setConveraApplying(true);
    let ok = 0, failed = 0;
    for (const row of selected) {
      const inv = row.matchedInvoice!;
      const paidDate = converaPaidDate || row.suggestedDate;
      const { error } = await supabase.from('invoices').update({
        status: 'paid',
        paid_date: paidDate,
        reviewed_at: new Date().toISOString(),
        reviewed_by: currentUser!.name,
      }).eq('id', inv.id);
      if (error) failed++; else ok++;
    }
    await fetchInvoices();
    setConveraApplying(false);
    if (failed) {
      alert(`${ok} invoices marked paid, ${failed} failed.`);
    } else {
      alert(`${ok} invoice${ok !== 1 ? 's' : ''} marked as paid on ${converaPaidDate}.`);
      setShowConveraModal(false);
      setConveraRows([]);
      setConveraFile(null);
      setIntuitText('');
      setConveraError('');
    }
  };

  const exportInvoicesCSV = (list: Invoice[]) => {
    const headers = [
      'Invoice No','Employee','Project','Period Start','Period End',
      'Total Hours','Rate','Total Amount','Currency','Status','Submitted','Pay On Date','Paid Date','Payment Method',
      'Company Name','Company Address','Country',
      'Bank Name','Bank Address','Bank Branch',
      'Account Number','IBAN','SWIFT/BIC','Payment Email','Convera Short Name','Banking Note'
    ];
    let csv = headers.join(',') + '\n';
    // Pre-compute prior-month convera_beneficiary_id per contractor for the CHANGE COMPANY signal
    const profileBenefId = (profileId: number | null | undefined): number | null => {
      if (!profileId) return null;
      return paymentProfiles.find(p => p.id === profileId)?.converaBeneficiaryId ?? null;
    };
    const priorMonthKey = (periodStart: string): string => {
      const d = parseLocalDate(periodStart);
      d.setMonth(d.getMonth() - 1);
      return formatDate(d).slice(0, 7);
    };
    list.forEach(inv => {
      const project = projects.find(p => p.id === inv.projectId);
      const pp = inv.paymentProfile;
      const profile = pp ? paymentProfiles.find(p => p.id === pp.id) : null;
      const converaShortName = profile?.converaBeneficiaryId
        ? (converaBeneficiaries.find(b => b.id === profile.converaBeneficiaryId)?.shortName || '')
        : '';
      // Banking note: NEW COMPANY when current profile has no benef OR no prior invoice;
      // CHANGE COMPANY when prior month's benef differs from current. Blank otherwise.
      const currentBenefId = profileBenefId(pp?.id);
      const prevKey = priorMonthKey(inv.periodEnd);
      const priorInv = invoices.find(o => o.userId === inv.userId && o.id !== inv.id && o.periodEnd?.slice(0,7) === prevKey);
      const priorBenefId = profileBenefId(priorInv?.paymentProfile?.id);
      let bankingNote = '';
      if (!currentBenefId) bankingNote = 'NEW COMPANY';
      else if (!priorInv) bankingNote = 'NEW';
      else if (priorBenefId && priorBenefId !== currentBenefId) bankingNote = 'CHANGE COMPANY';
      const row = [
        `"${inv.invoiceNumber}"`,
        `"${inv.userName}"`,
        `"${project?.name || 'N/A'}"`,
        `"${inv.periodStart}"`,
        `"${inv.periodEnd}"`,
        inv.totalHours != null ? inv.totalHours.toFixed(2) : '',
        inv.rate ?? '',
        inv.totalAmount.toFixed(2),
        `"${inv.currency}"`,
        `"${inv.status}"`,
        `"${inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : ''}"`,
        `"${inv.payOnDate ? new Date(inv.payOnDate).toLocaleDateString() : ''}"`,
        `"${inv.paidDate ? new Date(inv.paidDate).toLocaleDateString() : ''}"`,
        `"${inv.paymentProfile ? paymentMethod(inv) : ''}"`,
        `"${pp?.companyName || ''}"`,
        `"${pp?.companyAddress || ''}"`,
        `"${pp?.country || ''}"`,
        `"${pp?.bankName || ''}"`,
        `"${pp?.bankAddress || ''}"`,
        `"${pp?.bankBranch || ''}"`,
        `"${pp?.accountNumber || ''}"`,
        `"${pp?.iban || ''}"`,
        `"${pp?.swift || ''}"`,
        `"${pp?.paymentEmail || ''}"`,
        `"${converaShortName}"`,
        `"${bankingNote}"`,
      ];
      csv += row.join(',') + '\n';
    });
    triggerDownload(csv, `invoices_export_${Date.now()}.csv`);
  };

  // ─── WEEK NAVIGATION ──────────────────────────────────────────────────────
  const changeWeek = (direction: number) => {
    const newWeek = new Date(selectedWeek);
    newWeek.setDate(newWeek.getDate() + (direction * 7));
    setSelectedWeek(newWeek);
    if (currentUser?.role === 'timesheetuser') loadTimesheetForWeek(currentUser!.id, newWeek, timesheetsRef.current);
  };

  const changeReportWeek = (direction: number) => {
    const newWeek = new Date(reportWeek);
    newWeek.setDate(newWeek.getDate() + (direction * 7));
    setReportWeek(newWeek);
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

  // ─── REPORT / CSV ─────────────────────────────────────────────────────────
  const generateReport = () => {
    const weekKey = formatDate(reportWeek);
    const weekTimesheets = timesheets.filter(t => t.weekStart === weekKey);
    const isTestAccount = (name: string) => { const l = (name || '').toLowerCase().trim(); return l === 'test' || /\b(hotmail|yahoo)\b/.test(l); };
    const weekEndKey = formatDate(new Date(parseLocalDate(weekKey).getTime() + 6 * 86400000));
    return users.filter(u => u.role === 'timesheetuser' && u.startDate && u.startDate <= weekEndKey && (!u.endDate || u.endDate >= weekKey) && !isTestAccount(u.name)).map(user => {
      const timesheet = weekTimesheets.find(t => t.userId === user.id);
      const entries = timesheet ? timesheet.entries : {};
      const project = projects.find(p => p.id === (timesheet?.projectId ?? user.projectId)) ?? null;
      const dailyHours = getWeekDates(reportWeek).map(date => parseFloat(entries[formatDate(date)]?.hours || '0'));
      return { name: user.name, source: timesheet?.source ?? null, project: project ? `${project.name} (${project.code})` : 'Not Assigned', dailyHours, total: dailyHours.reduce((s, h) => s + h, 0), status: timesheet ? timesheet.status : 'not submitted', timesheetId: timesheet?.id ?? null };
    });
  };

  const downloadCSV = () => {
    const reportData = generateReport();
    const weekDates = getWeekDates(reportWeek);
    let csv = 'ID,Employee Name,Source,Project,';
    weekDates.forEach(d => { csv += `"${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}",`; });
    csv += 'Total Hours,Status\n';
    reportData.forEach(row => {
      const sourceLabel = row.source === 'imported' ? 'Email' : row.source === 'direct' ? 'Portal' : '';
      csv += `"${row.timesheetId ? '#' + row.timesheetId : ''}","${row.name}","${sourceLabel}","${row.project}",`;
      row.dailyHours.forEach(h => { csv += h + ','; });
      csv += `${row.total},"${row.status}"\n`;
    });
    const grandTotal = reportData.reduce((s, r) => s + r.total, 0);
    csv += `\n"","Grand Total","","",`; weekDates.forEach(() => { csv += ','; }); csv += `${grandTotal},\n`;
    triggerDownload(csv, `timesheet_report_${formatDate(reportWeek)}.csv`);
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

  function triggerDownload(csv: string, filename: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none';
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

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

  // ─── SHARED TIMESHEET DETAIL MODAL ───────────────────────────────────────
  const TimesheetDetailModal = () => {
    if (!selectedTimesheetForView) return null;
    const user = users.find(u => u.id === selectedTimesheetForView.userId);
    const project = projects.find(p => p.id === (selectedTimesheetForView.projectId ?? user?.projectId));
    const weekDates = getWeekDates(parseLocalDate(selectedTimesheetForView.weekStart));
    const dailyData = weekDates.map(date => {
      const dateKey = formatDate(date);
      const entry = selectedTimesheetForView.entries[dateKey];
      return { date, dateKey, dayName: date.toLocaleDateString('en-US', { weekday: 'long' }), hours: parseFloat(entry?.hours || '0'), holiday: entry?.isHoliday, holidayName: entry?.holidayName, weekend: entry?.isWeekend };
    });
    const totalHours = dailyData.reduce((s, d) => s + d.hours, 0);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={closeTimesheetModal}>
        <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-white border-b p-6 z-10">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Timesheet Details</h2>
                <div className="mt-2 space-y-1">
                  <p className="text-gray-600"><span className="font-medium">Employee:</span> {selectedTimesheetForView.userName}</p>
                  <p className="text-gray-600"><span className="font-medium">Week:</span> {parseLocalDate(selectedTimesheetForView.weekStart).toLocaleDateString()} – {getWeekSunday(parseLocalDate(selectedTimesheetForView.weekStart)).toLocaleDateString()}</p>
                  {project && <p className="text-indigo-600"><span className="font-medium">Project:</span> {project.name} ({project.code})</p>}
                  {user && (
                    <p className="text-gray-600 flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      <span className="font-medium">Location:</span> {countries.find(c => c.code === user.country)?.name}{user.region ? ', ' + user.region : ''}
                    </p>
                  )}
                  <p className="text-gray-600"><span className="font-medium">Submitted:</span> {new Date(selectedTimesheetForView.submittedAt).toLocaleString()}</p>
                </div>
              </div>
              <button onClick={closeTimesheetModal} className="text-gray-500 hover:text-gray-700 p-1"><X className="w-6 h-6" /></button>
            </div>
          </div>
          <div className="p-6">
            <span className={'inline-block mb-4 px-4 py-2 rounded-full text-sm font-medium ' + (selectedTimesheetForView.status === 'approved' ? 'bg-green-100 text-green-800' : selectedTimesheetForView.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')}>
              Status: {selectedTimesheetForView.status.charAt(0).toUpperCase() + selectedTimesheetForView.status.slice(1)}
            </span>
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Daily Breakdown</h3>
            <div className="space-y-3">
              {dailyData.map(day => (
                <div key={day.dateKey} className={'p-4 rounded-lg border-2 ' + (day.holiday ? 'bg-red-50 border-red-200' : day.weekend ? 'bg-gray-100 border-gray-200' : 'bg-blue-50 border-blue-200')}>
                  <div className="flex justify-between items-center">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800">{day.dayName}</span>
                        {day.holiday && <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Holiday: {day.holidayName}</span>}
                        {day.weekend && <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full font-medium">Weekend</span>}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{day.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-indigo-600">{day.hours > 0 ? day.hours.toFixed(1) : '0'}</div>
                      <div className="text-sm text-gray-600">hours</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 p-6 bg-indigo-600 text-white rounded-lg">
              <div className="flex justify-between items-center">
                <div><div className="text-sm opacity-90">Total Hours for Week</div><div className="text-4xl font-bold mt-1">{totalHours.toFixed(1)}h</div></div>
                <div className="text-right"><div className="text-sm opacity-90">Standard Week</div><div className="text-2xl font-semibold mt-1">40h</div>{totalHours !== 40 && <div className="text-sm mt-1">{totalHours > 40 ? '+' : ''}{(totalHours - 40).toFixed(1)}h</div>}</div>
              </div>
            </div>
            {(currentUser?.role === 'manager' || currentUser?.role === 'accountant') && selectedTimesheetForView.status !== 'rejected' && (
              <div className="mt-6 flex gap-3">
                {selectedTimesheetForView.status === 'pending' && (
                  <button onClick={async () => { await handleApproval(selectedTimesheetForView.id, 'approved'); closeTimesheetModal(); alert('Timesheet approved!'); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium">
                    <CheckCircle className="w-5 h-5" /> Approve Timesheet
                  </button>
                )}
                <button onClick={async () => { if (!window.confirm('Reject this timesheet? The employee will need to resubmit.')) return; await handleApproval(selectedTimesheetForView.id, 'rejected'); closeTimesheetModal(); alert('Timesheet rejected.'); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">
                  <XCircle className="w-5 h-5" /> {selectedTimesheetForView.status === 'approved' ? 'Revoke & Reject' : 'Reject Timesheet'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
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
    const handleSetNewPassword = async () => {
      if (!newPassword || newPassword.length < 6) {
        alert('Password must be at least 6 characters'); return;
      }
      if (newPassword !== newPasswordConfirm) {
        alert('Passwords do not match'); return;
      }
      setPasswordResetLoading(true);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      setPasswordResetLoading(false);
      if (error) { alert('Error setting password: ' + error.message); return; }
      setPasswordResetMode(false);
      setNewPassword('');
      setNewPasswordConfirm('');
      alert('Password updated successfully! You can now log in.');
      await supabase.auth.signOut();
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Save className="w-8 h-8 text-indigo-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Set New Password</h1>
            <p className="text-gray-600 mt-2">Choose a new password for your account</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="Min. 6 characters"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
              <input
                type="password"
                value={newPasswordConfirm}
                onChange={e => setNewPasswordConfirm(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleSetNewPassword()}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                placeholder="Re-enter password"
              />
            </div>
            {newPassword && newPasswordConfirm && newPassword !== newPasswordConfirm && (
              <p className="text-sm text-red-600">Passwords do not match</p>
            )}
            <button
              onClick={handleSetNewPassword}
              disabled={passwordResetLoading}
              className="w-full bg-indigo-600 text-white py-2 rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-50"
            >
              {passwordResetLoading ? 'Saving...' : 'Set Password & Log In'}
            </button>
          </div>
        </div>
      </div>
    );
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
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"><LogOut className="w-4 h-4" /> Logout</button>
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

            </div>
          </div>

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
                          <span className={'px-2 py-1 rounded-full text-xs font-medium ' + (user.role === 'admin' ? 'bg-purple-100 text-purple-800' : user.role === 'manager' ? 'bg-blue-100 text-blue-800' : user.role === 'vendormanager' ? 'bg-teal-100 text-teal-800' : user.role === 'accountant' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800')}>
                            {user.role === 'timesheetuser' ? 'TimesheetUser' : user.role === 'vendormanager' ? 'Vendor Manager' : user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                          </span>
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
                      <span className={'px-3 py-1 rounded-full text-xs font-medium ' + (project.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800')}>{project.status.charAt(0).toUpperCase() + project.status.slice(1)}</span>
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
                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${isInactive ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                      {isInactive ? 'Inactive' : 'Active'}
                                    </span>
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
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${isInactive ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                    {isInactive ? 'Inactive' : 'Active'}
                                  </span>
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
                      <select
                        value={userForm.country}
                        onChange={e => {
                          const c = countries.find(x => x.code === e.target.value);
                          const autoRegion = c && c.regions.length === 1 ? c.regions[0] : '';
                          setUserForm({...userForm, country: e.target.value, region: autoRegion});
                        }}
                        className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 bg-white"
                      >
                        {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
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
                      <select value={userForm.country} onChange={e => {
                        const c = countries.find(x => x.code === e.target.value);
                        const autoRegion = c && c.regions.length === 1 ? c.regions[0] : '';
                        setUserForm({...userForm, country: e.target.value, region: autoRegion});
                      }} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
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
    const pendingTimesheets = timesheets.filter(t => t.status === 'pending');
    const managedUsers = users.filter(u => u.managerId === currentUser!.id);
    const filteredTimesheets = getFilteredTimesheets().filter(t => managedUsers.some(u => u.id === t.userId));

    return (
      <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Manager Dashboard</h1>
                <p className="text-gray-600">Welcome, {currentUser!.name}</p>
                <p className="text-sm text-blue-600 font-medium">Role: Manager — {managedUsers.length} team member(s)</p>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md mb-6">
            <div className="flex border-b">
              <button onClick={() => setViewMode('cards')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (viewMode === 'cards' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
                <span>Pending <span className="hidden sm:inline">Approvals </span>({pendingTimesheets.filter(t => managedUsers.some(u => u.id === t.userId)).length})</span>
              </button>
              <button onClick={() => setViewMode('table')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (viewMode === 'table' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <FileText className="w-5 h-5 flex-shrink-0" />
                <span>All <span className="hidden sm:inline">Timesheets</span></span>
              </button>
              <button onClick={() => setViewMode('consolidated')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (viewMode === 'consolidated' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <BarChart2 className="w-5 h-5 flex-shrink-0" />
                <span>Consolidated</span>
              </button>
            </div>
          </div>

          {viewMode === 'cards' ? (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Users className="w-6 h-6" /> Pending Approvals</h2>
              {pendingTimesheets.filter(t => managedUsers.some(u => u.id === t.userId)).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No pending timesheets to review</p>
              ) : (
                <div className="space-y-4">
                  {pendingTimesheets.filter(t => managedUsers.some(u => u.id === t.userId)).map(timesheet => {
                    const tsUser = managedUsers.find(u => u.id === timesheet.userId);
                    const project = projects.find(p => p.id === (timesheet.projectId ?? tsUser?.projectId));
                    const totalHrs = Object.values(timesheet.entries).reduce((s, e) => s + (parseFloat((e as TimeEntry)?.hours || '0')), 0);
                    return (
                      <div key={timesheet.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h3 className="font-semibold text-gray-800">{timesheet.userName}</h3>
                            <p className="text-sm text-gray-600">Week of {parseLocalDate(timesheet.weekStart).toLocaleDateString()}</p>
                            {project && <p className="text-sm text-indigo-600 font-medium">Project: {project.name} ({project.code})</p>}
                            <p className="text-sm text-gray-600">Total: {totalHrs.toFixed(1)} hours</p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { openTimesheetModal(timesheet); }} className="flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 text-sm">View</button>
                            <button onClick={async () => { await handleApproval(timesheet.id, 'approved'); alert('Approved!'); }} className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"><CheckCircle className="w-4 h-4" /> Approve</button>
                            <button onClick={async () => { await handleApproval(timesheet.id, 'rejected'); alert('Rejected!'); }} className="flex items-center gap-1 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"><XCircle className="w-4 h-4" /> Reject</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : viewMode === 'table' ? (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h2 className="text-xl font-bold text-gray-800">All Team Timesheets</h2>
                <div className="flex flex-wrap gap-2">
                  {selectedTimesheetIds.length > 0 && (
                    <>
                      <button onClick={() => bulkApproveTimesheets('approved')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><CheckCircle className="w-4 h-4" /> Approve ({selectedTimesheetIds.length})</button>
                      <button onClick={() => bulkApproveTimesheets('rejected')} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"><XCircle className="w-4 h-4" /> Reject ({selectedTimesheetIds.length})</button>
                    </>
                  )}
                  <button onClick={() => exportTimesheetList(filteredTimesheets)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap gap-3 items-end">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label><input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
                <button onClick={() => setDateRange({start: '', end: ''})} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Clear</button>
              </div>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full border-collapse">
                  <thead className="bg-indigo-600 text-white">
                    <tr>
                      <th className="border border-indigo-700 px-4 py-3"><input type="checkbox" checked={selectedTimesheetIds.length > 0 && selectedTimesheetIds.length === filteredTimesheets.filter(t => t.status === 'pending').length} onChange={() => toggleSelectAll(filteredTimesheets)} className="w-4 h-4 cursor-pointer" /></th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Employee</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Week Start</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Project</th>
                      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => <th key={d} className="border border-indigo-700 px-4 py-3 text-center">{d}</th>)}
                      <th className="border border-indigo-700 px-4 py-3 text-center">Total</th>
                      <th className="border border-indigo-700 px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTimesheets.length === 0 ? (
                      <tr><td colSpan={13} className="text-center py-8 text-gray-500">No timesheets found</td></tr>
                    ) : filteredTimesheets.map((ts, idx) => {
                      const tsUser = managedUsers.find(u => u.id === ts.userId);
                      const project = projects.find(p => p.id === (ts.projectId ?? tsUser?.projectId));
                      const weekDates = getWeekDates(parseLocalDate(ts.weekStart));
                      const dailyHours = weekDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                      const total = dailyHours.reduce((s, h) => s + h, 0);
                      return (
                        <tr key={ts.id} className={'cursor-pointer ' + (idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50')}>
                          <td className="border border-gray-300 px-4 py-2 text-center" onClick={e => e.stopPropagation()}>{ts.status === 'pending' && <input type="checkbox" checked={selectedTimesheetIds.includes(ts.id)} onChange={() => toggleTimesheetSelection(ts.id)} className="w-4 h-4 cursor-pointer" />}</td>
                          <td className="border border-gray-300 px-4 py-2 font-medium text-indigo-600" onClick={() => openTimesheetModal(ts)}>{ts.userName}</td>
                          <td className="border border-gray-300 px-4 py-2 text-sm" onClick={() => openTimesheetModal(ts)}>{parseLocalDate(ts.weekStart).toLocaleDateString()}</td>
                          <td className="border border-gray-300 px-4 py-2 text-sm text-indigo-600" onClick={() => openTimesheetModal(ts)}>{project ? `${project.name} (${project.code})` : 'N/A'}</td>
                          {dailyHours.map((h, i) => <td key={i} className="border border-gray-300 px-4 py-2 text-center" onClick={() => openTimesheetModal(ts)}>{h > 0 ? h.toFixed(1) : '-'}</td>)}
                          <td className="border border-gray-300 px-4 py-2 text-center font-bold text-indigo-600" onClick={() => openTimesheetModal(ts)}>{total.toFixed(1)}</td>
                          <td className="border border-gray-300 px-4 py-2 text-center" onClick={() => openTimesheetModal(ts)}>
                            <span className={'px-2 py-1 rounded-full text-xs font-medium ' + (ts.status === 'approved' ? 'bg-green-100 text-green-800' : ts.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')}>{ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {showTimesheetModal && <TimesheetDetailModal />}

          {/* Manager Consolidated View */}
          {viewMode === 'consolidated' && (() => {
            // Build month options: last 12 months
            const mgMonthOptions: { label: string; value: string; start: string; end: string }[] = [];
            const now = new Date();
            for (let i = 0; i < 12; i++) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const monthVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
              const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
              mgMonthOptions.push({ label, value: monthVal, start: formatDate(firstDay), end: formatDate(lastDay) });
            }

            // Build report — same logic as accountant but scoped to managed users only
            const generateMgrReport = () => {
              if (!managerAppliedRange.start || !managerAppliedRange.end) return null;
              const startD = parseLocalDate(managerAppliedRange.start);
              const endD = parseLocalDate(managerAppliedRange.end);
              const teamTimesheets = timesheets.filter(t => managedUsers.some(u => u.id === t.userId));
              const inRange = teamTimesheets.filter(t => {
                const weekMon = parseLocalDate(t.weekStart);
                const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
                return weekMon <= endD && weekSun >= startD;
              });
              const weekEndings = [...new Set(inRange.map(t => t.weekStart))].sort() as string[];
              const partialWeeks = new Set<string>();
              weekEndings.forEach(we => {
                const weekMon = parseLocalDate(we);
                const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
                if (weekMon < startD || weekSun > endD) partialWeeks.add(we);
              });
              const employeeRows = managedUsers.map(user => {
                const hours: Record<string, number | null> = {};
                const statuses: Record<string, string> = {};
                let rowTotal = 0;
                weekEndings.forEach(we => {
                  const weEnd = formatDate(new Date(parseLocalDate(we).getTime() + 6 * 86400000));
                  const ts = inRange.find(t => t.userId === user.id && t.weekStart === we);
                  if (ts) {
                    let h = 0;
                    Object.entries(ts.entries).forEach(([dateKey, entry]) => {
                      const d = parseLocalDate(dateKey);
                      if (d >= startD && d <= endD) h += parseFloat((entry as TimeEntry)?.hours || '0') || 0;
                    });
                    hours[we] = h; statuses[we] = ts.status; rowTotal += h;
                  } else if (!user.startDate || user.startDate > weEnd || (user.endDate && user.endDate < we)) {
                    hours[we] = null; statuses[we] = 'n/a';
                  } else { hours[we] = null; statuses[we] = 'not submitted'; }
                });
                const latestTs = inRange.filter(t => t.userId === user.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
                const project = projects.find(p => p.id === (latestTs?.projectId ?? user.projectId));
                return { name: user.name, country: countryName(user.country), project: project ? `${project.name} (${project.code})` : 'Not Assigned', hours, statuses, rowTotal };
              });
              const colTotals: Record<string, number> = {};
              weekEndings.forEach(we => { colTotals[we] = employeeRows.reduce((s, r) => s + (r.hours[we] || 0), 0); });
              return { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal: employeeRows.reduce((s, r) => s + r.rowTotal, 0) };
            };

            const mgrReport = generateMgrReport();

            const downloadMgrCSV = () => {
              if (!mgrReport) return;
              const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal: gt } = mgrReport;
              let csv = 'Employee,Country,Project';
              weekEndings.forEach(we => {
                const weekMon = parseLocalDate(we);
                const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
                const label = partialWeeks.has(we)
                  ? `Partial W/E ${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : `W/E ${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                csv += `,"${label}","Status"`;
              });
              csv += ',Total Hours\n';
              employeeRows.forEach(row => {
                csv += `"${row.name}","${countryName(row.country)}","${row.project}"`;
                weekEndings.forEach(we => { csv += `,"${row.hours[we] !== null ? row.hours[we]!.toFixed(1) : '-'}","${row.statuses[we]}"`; });
                csv += `,"${row.rowTotal.toFixed(1)}"\n`;
              });
              csv += '"TOTAL","",""';
              weekEndings.forEach(we => { csv += `,"${colTotals[we as string].toFixed(1)}",""`; });
              csv += `,"${gt.toFixed(1)}"\n`;
              triggerDownload(csv, `team_consolidated_${managerAppliedRange.start}_to_${managerAppliedRange.end}.csv`);
            };

            return (
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
                  <h2 className="text-xl font-bold text-gray-800">Team Consolidated Report</h2>
                  {mgrReport && (
                    <button onClick={downloadMgrCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  )}
                </div>

                {/* Controls */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Quick Select — Month</label>
                    <div className="flex flex-wrap gap-2">
                      {mgMonthOptions.slice(0, 6).map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setManagerMonthPreset(opt.value);
                            setManagerConsolidatedRange({ start: opt.start, end: opt.end });
                            setManagerAppliedRange({ start: opt.start, end: opt.end });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            managerMonthPreset === opt.value
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-gray-200">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                      <input type="date" value={managerConsolidatedRange.start}
                        onChange={e => { setManagerConsolidatedRange(r => ({...r, start: e.target.value})); setManagerMonthPreset(''); }}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                      <input type="date" value={managerConsolidatedRange.end}
                        onChange={e => { setManagerConsolidatedRange(r => ({...r, end: e.target.value})); setManagerMonthPreset(''); }}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
                    </div>
                    <button
                      onClick={() => setManagerAppliedRange({ ...managerConsolidatedRange })}
                      disabled={!managerConsolidatedRange.start || !managerConsolidatedRange.end}
                      className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      <CheckCircle className="w-4 h-4" /> Apply
                    </button>
                    {managerAppliedRange.start && (
                      <button
                        onClick={() => { setManagerAppliedRange({ start: '', end: '' }); setManagerConsolidatedRange({ start: '', end: '' }); setManagerMonthPreset(''); }}
                        className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 underline"
                      >Clear</button>
                    )}
                    {managerAppliedRange.start && managerAppliedRange.end && (
                      <span className="text-sm text-green-700 font-medium bg-green-50 px-3 py-2 rounded-lg border border-green-200">
                        Showing: {parseLocalDate(managerAppliedRange.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – {parseLocalDate(managerAppliedRange.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>

                {mgrReport
                  ? <ConsolidatedTable report={mgrReport} parseLocalDate={parseLocalDate} />
                  : (
                    <div className="text-center py-12 text-gray-400">
                      <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-base">Select a month or custom date range, then click <strong className="text-gray-500">Apply</strong>.</p>
                      <p className="text-sm mt-1">Shows consolidated hours for your {managedUsers.length} team member(s).</p>
                    </div>
                  )
                }
              </div>
            );
          })()}
        </div>
      </div>
    );
  }


  // ─── VENDOR MANAGER VIEW ──────────────────────────────────────────────────
  if (currentUser!.role === 'vendormanager') {
    const myUsers = users.filter(u => u.vendorManagerId === currentUser!.id);
    const myTimesheets = timesheets.filter(t => myUsers.some(u => u.id === t.userId));
    const myInvoices = invoices.filter(i => i.vendorManagerId === currentUser!.id);
    const myPaymentProfiles = paymentProfiles.filter(p => p.userId === currentUser!.id);

    // Invoice creation state — per-user rates


    const currencySymbols: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' };
    const sym = currencySymbols[vmCurrency] || '$';

    // Build invoice lines per user for the selected period
    const buildVmLines = (userId: string, rate: number): InvoiceLine[] => {
      if (!vmPeriod.start || !vmPeriod.end || !rate) return [];
      const startD = parseLocalDate(vmPeriod.start), endD = parseLocalDate(vmPeriod.end);
      const user = users.find(u => u.id === userId);
      return timesheets
        .filter(t => {
          if (t.userId !== userId || t.status !== 'approved') return false;
          const mon = parseLocalDate(t.weekStart);
          const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
          return mon <= endD && fri >= startD;
        })
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
        .map(ts => {
          const mon = parseLocalDate(ts.weekStart);
          const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
          let hours = 0;
          Object.entries(ts.entries).forEach(([dk, entry]) => {
            const d = parseLocalDate(dk);
            if (d >= startD && d <= endD) hours += parseFloat((entry as TimeEntry)?.hours || '0');
          });
          return { weekStart: ts.weekStart, weekEndingFri: formatDate(fri), hours: parseFloat(hours.toFixed(2)), rate, amount: parseFloat((hours * rate).toFixed(2)), userId, userName: user?.name || ts.userName };
        })
        .filter(l => l.hours > 0);
    };

    const allVmLines = myUsers.map(u => buildVmLines(u.id, parseFloat(vmRates[u.id] || '0'))).flat();

    const submitVmInvoice = async () => {
      if (!vmPeriod.start || !vmPeriod.end) { alert('Please select a period.'); return; }
      if (!vmInvoiceNumber.trim()) { alert('Please enter an invoice number.'); return; }
      if (!vmPhoneConfirm.trim()) { alert('Please confirm your phone number.'); return; }
      const usersWithRates = myUsers.filter(u => parseFloat(vmRates[u.id] || '0') > 0);
      if (usersWithRates.length === 0) { alert('Please enter a rate for at least one user.'); return; }

      const profile = myPaymentProfiles.find(p => p.id === vmPaymentProfileId) || null;
      if (!profile) { alert('Please select a payment profile.'); return; }

      const lines = allVmLines;
      if (lines.length === 0) { alert('No approved timesheets found for any user in this period.'); return; }

      const totalHours = lines.reduce((s, l) => s + (l.hours ?? 0), 0);
      const totalAmount = lines.reduce((s, l) => s + l.amount, 0);

      // Save phone if changed
      const trimmedPhone = vmPhoneConfirm.trim();
      if (trimmedPhone && trimmedPhone !== currentUser!.phone) {
        await supabase.from('profiles').update({ phone: trimmedPhone }).eq('id', currentUser!.id);
        setCurrentUser({ ...currentUser!, phone: trimmedPhone });
      }

      const payload = {
        invoice_number: vmInvoiceNumber.trim().toUpperCase(),
        user_id: currentUser!.id,
        user_name: currentUser!.name,
        project_id: null,
        period_start: vmPeriod.start,
        period_end: vmPeriod.end,
        lines,
        total_hours: totalHours,
        rate: 0,
        total_amount: totalAmount,
        currency: vmCurrency,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        notes: vmNotes,
        payment_profile: profile,
        is_vendor_invoice: true,
        vendor_manager_id: currentUser!.id,
      };

      const { error } = await supabase.from('invoices').insert(payload);
      if (error) { alert('Error submitting invoice: ' + error.message); return; }
      await fetchInvoices();
      setVmTab('invoices');
      setVmInvoiceNumber(''); setVmNotes(''); setVmRates({});
      alert('Invoice submitted successfully!');
    };

    return (
      <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Vendor Manager Dashboard</h1>
                <p className="text-gray-600">Welcome, {currentUser!.name}</p>
                <p className="text-sm text-teal-600 font-medium">Role: Vendor Manager — {myUsers.length} user{myUsers.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="bg-white rounded-lg shadow-md mb-6">
            <div className="flex border-b">
              {([
                { key: 'timesheets', label: 'Timesheets', icon: <Clock className="w-5 h-5 flex-shrink-0" /> },
                { key: 'create', label: 'Create Invoice', icon: <Plus className="w-5 h-5 flex-shrink-0" /> },
                { key: 'invoices', label: 'Invoices', icon: <Receipt className="w-5 h-5 flex-shrink-0" /> },
                { key: 'profile', label: 'Profile', icon: <Settings className="w-5 h-5 flex-shrink-0" /> },
              ] as { key: typeof vmTab; label: string; icon: React.ReactNode }[]).map(tab => (
                <button key={tab.key} onClick={() => setVmTab(tab.key)}
                  className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (vmTab === tab.key ? 'text-teal-600 border-teal-600 bg-teal-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                  {tab.icon}<span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* TIMESHEETS TAB — read-only view */}
          {vmTab === 'timesheets' && (
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Users className="w-6 h-6 text-teal-600" /> Team Timesheets</h2>
              {myUsers.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No users assigned to you yet. Contact your administrator.</p>
              ) : (
                <>
                  {/* User summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
                    {myUsers.map(u => {
                      const uTs = myTimesheets.filter(t => t.userId === u.id);
                      const pending = uTs.filter(t => t.status === 'pending').length;
                      const approved = uTs.filter(t => t.status === 'approved').length;
                      const project = projects.find(p => p.id === u.projectId);
                      return (
                        <div key={u.id} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                          <div className="font-semibold text-gray-800">{u.name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{project ? project.name : 'No project'}</div>
                          <div className="flex gap-2 mt-2 flex-wrap">
                            {pending > 0 && <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">{pending} pending</span>}
                            {approved > 0 && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">{approved} approved</span>}
                            {uTs.length === 0 && <span className="text-xs text-gray-400">No timesheets</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Timesheets table */}
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-teal-600 text-white">
                        <tr>
                          <th className="border border-teal-700 px-3 py-2 text-left">Employee</th>
                          <th className="border border-teal-700 px-3 py-2 text-left">Week Ending</th>
                          <th className="border border-teal-700 px-3 py-2 text-left">Project</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Mon</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Tue</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Wed</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Thu</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Fri</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Total</th>
                          <th className="border border-teal-700 px-3 py-2 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myTimesheets.length === 0 ? (
                          <tr><td colSpan={10} className="text-center py-6 text-gray-400">No timesheets submitted yet</td></tr>
                        ) : (
                          myTimesheets.sort((a, b) => b.weekStart.localeCompare(a.weekStart)).map((ts, idx) => {
                            const tsUser = users.find(u => u.id === ts.userId);
                            const project = projects.find(p => p.id === (ts.projectId ?? tsUser?.projectId));
                            const weekDates = getWeekDates(parseLocalDate(ts.weekStart));
                            const dailyHours = weekDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                            const total = dailyHours.reduce((s, h) => s + h, 0);
                            const fri = weekDates[4]; // W/E Friday label for CSV // Keep Fri for W/E label on invoices
                            return (
                              <tr key={ts.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{ts.userName}</td>
                                <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">{fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                <td className="border border-gray-200 px-3 py-2 text-teal-600 text-xs">{project ? `${project.name} (${project.code})` : '—'}</td>
                                {dailyHours.map((h, i) => <td key={i} className="border border-gray-200 px-3 py-2 text-center">{h > 0 ? h.toFixed(1) : <span className="text-gray-300">—</span>}</td>)}
                                <td className="border border-gray-200 px-3 py-2 text-center font-bold text-teal-700">{total.toFixed(1)}</td>
                                <td className="border border-gray-200 px-3 py-2 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ts.status === 'approved' ? 'bg-green-100 text-green-800' : ts.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                    {ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* CREATE INVOICE TAB */}
          {vmTab === 'create' && (
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 space-y-6">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-6 h-6 text-teal-600" /> Create Invoice</h2>

              {/* Invoice type */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice Type</label>
                <div className="flex gap-3">
                  {(['consolidated', 'per-user'] as const).map(type => (
                    <button key={type} onClick={() => setVmInvoiceType(type)}
                      className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium text-sm transition-colors ${vmInvoiceType === type ? 'border-teal-600 bg-teal-50 text-teal-700' : 'border-gray-200 bg-white text-gray-600 hover:border-teal-300'}`}>
                      {type === 'consolidated' ? '📄 One consolidated invoice' : '📋 Separate invoice per user'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">{vmInvoiceType === 'consolidated' ? 'One invoice covering all users with a line per employee per week.' : 'Individual invoices submitted for each user separately.'}</p>
              </div>

              {/* Period selection */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Billing Period</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {Array.from({ length: 6 }, (_, i) => {
                    const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
                    const start = formatDate(new Date(d.getFullYear(), d.getMonth(), 1));
                    const end = formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
                    const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    return (
                      <button key={start} onClick={() => setVmPeriod({ start, end })}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${vmPeriod.start === start ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:border-teal-400'}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-3 items-end flex-wrap">
                  <div><label className="block text-xs text-gray-500 mb-1">From</label>
                    <input type="date" value={vmPeriod.start} onChange={e => setVmPeriod(p => ({...p, start: e.target.value}))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">To</label>
                    <input type="date" value={vmPeriod.end} onChange={e => setVmPeriod(p => ({...p, end: e.target.value}))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" /></div>
                </div>
              </div>

              {/* Per-user rates */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Hourly Rates per Employee</label>
                <div className="space-y-2">
                  {myUsers.map(u => {
                    const rate = parseFloat(vmRates[u.id] || '0');
                    const lines = buildVmLines(u.id, rate);
                    const total = lines.reduce((s, l) => s + l.amount, 0);
                    return (
                      <div key={u.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex-1 font-medium text-gray-800 text-sm">{u.name}</div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-sm">{sym}</span>
                          <input type="number" min="0" step="0.01" value={vmRates[u.id] || ''} onChange={e => setVmRates(r => ({...r, [u.id]: e.target.value}))}
                            className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder="0.00" />
                          <span className="text-gray-400 text-xs">/hr</span>
                        </div>
                        {rate > 0 && lines.length > 0 && (
                          <div className="text-right text-xs text-teal-700 font-medium whitespace-nowrap">
                            {lines.reduce((s,l) => s+(l.hours ?? 0),0).toFixed(1)}h = {sym}{total.toFixed(2)}
                          </div>
                        )}
                        {rate > 0 && lines.length === 0 && vmPeriod.start && (
                          <span className="text-xs text-amber-500 whitespace-nowrap">No approved timesheets</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Currency */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Currency</label>
                <select value={vmCurrency} onChange={e => setVmCurrency(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  {['USD','GBP','EUR','CAD','AUD'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Payment profile */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Profile *</label>
                {myPaymentProfiles.length === 0 ? (
                  <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">No payment profiles yet. Go to the Profile tab to add one.</p>
                ) : (
                  <select value={vmPaymentProfileId || ''} onChange={e => setVmPaymentProfileId(e.target.value ? parseInt(e.target.value) : null)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500">
                    <option value="">Select payment profile…</option>
                    {myPaymentProfiles.map(p => <option key={p.id} value={p.id}>{p.profileName} — {p.bankName}</option>)}
                  </select>
                )}
              </div>

              {/* Invoice number & notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice Number *</label>
                  <input type="text" value={vmInvoiceNumber} onChange={e => setVmInvoiceNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, ''))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-teal-500" placeholder="e.g. VENDOR-2026-001" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optional)</label>
                  <input type="text" value={vmNotes} onChange={e => setVmNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder="Any additional notes" />
                </div>
              </div>

              {/* Phone confirmation */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Contact Phone Number *</label>
                <input type="tel" value={vmPhoneConfirm} onChange={e => setVmPhoneConfirm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder={currentUser!.phone || '+1 555 123 4567'} />
                <p className="text-xs text-gray-400 mt-1">Confirm your number in case of invoice queries.</p>
              </div>

              {/* Total summary */}
              {allVmLines.length > 0 && (
                <div className="bg-teal-600 text-white rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-sm opacity-90">Total Hours</div>
                      <div className="text-2xl font-bold">{allVmLines.reduce((s,l) => s+(l.hours ?? 0), 0).toFixed(1)}h</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm opacity-90">Total Amount</div>
                      <div className="text-2xl font-bold">{sym}{allVmLines.reduce((s,l) => s+l.amount, 0).toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-sm opacity-80">
                    {[...new Set(allVmLines.map(l => l.userName))].map(name => {
                      const userLines = allVmLines.filter(l => l.userName === name);
                      const hrs = userLines.reduce((s,l) => s+(l.hours ?? 0), 0);
                      const amt = userLines.reduce((s,l) => s+l.amount, 0);
                      return <div key={name}>{name}: {hrs.toFixed(1)}h = {sym}{amt.toFixed(2)}</div>;
                    })}
                  </div>
                </div>
              )}

              <button
                onClick={submitVmInvoice}
                disabled={allVmLines.length === 0 || !vmInvoiceNumber.trim() || !vmPaymentProfileId || !vmPhoneConfirm.trim()}
                className="w-full py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Receipt className="w-5 h-5" /> Submit Invoice for Review
              </button>
            </div>
          )}

          {/* INVOICES TAB */}
          {vmTab === 'invoices' && (
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Receipt className="w-6 h-6 text-teal-600" /> Invoice History</h2>
              {myInvoices.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No invoices submitted yet.</p>
              ) : (
                <div className="space-y-3">
                  {myInvoices.sort((a,b) => (b.submittedAt || '').localeCompare(a.submittedAt || '')).map(inv => {
                    const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
                    const invSym = currencySymbols[inv.currency] || '$';
                    const employees = [...new Set(inv.lines.map(l => l.userName).filter(Boolean))];
                    return (
                      <div key={inv.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{inv.invoiceNumber}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                              {inv.corrected && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Corrected</span>}
                            </div>
                            <p className="text-sm text-gray-600">{parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} – {parseLocalDate(inv.periodEnd).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                            <p className="text-xs text-gray-500 mt-1">{inv.lines.length} line{inv.lines.length !== 1 ? 's' : ''} · {inv.totalHours != null ? inv.totalHours.toFixed(1) + ' hrs' : '—'} · {employees.join(', ')}</p>
                            {inv.payOnDate && <p className="text-xs text-blue-600 mt-0.5 font-medium">📅 Expected payment: {new Date(inv.payOnDate).toLocaleDateString()}</p>}
                            {inv.paidDate && <p className="text-xs text-green-600 mt-0.5 font-medium">✅ Paid: {new Date(inv.paidDate).toLocaleDateString()}</p>}
                          </div>
                          <div className="text-right ml-4">
                            <div className="text-xl font-bold text-teal-700">{invSym}{inv.totalAmount.toFixed(2)}</div>
                            <div className="text-xs text-gray-400">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : ''}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* PROFILE TAB */}
          {vmTab === 'profile' && (
            <div className="space-y-6">
              {/* Payment Profiles */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-5 h-5 text-teal-600" /> Payment Profiles</h3>
                  <button onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }}
                    className="flex items-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">
                    <Plus className="w-4 h-4" /> Add Profile
                  </button>
                </div>
                {myPaymentProfiles.length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-4">No payment profiles yet. Add your vendor company bank details.</p>
                ) : (
                  <div className="space-y-2">
                    {myPaymentProfiles.map(p => (
                      <div key={p.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div>
                          <div className="font-medium text-gray-800 text-sm">{p.profileName}</div>
                          <div className="text-xs text-gray-500">{p.bankName}{p.accountNumber ? ` · ···${p.accountNumber.slice(-4)}` : ''}</div>
                        </div>
                        <div className="flex gap-2">
                          {p.isDefault && <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded-full">Default</span>}
                          <button onClick={() => { setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride }); setShowProfileModal(true); }}
                            className="p-1 text-indigo-600 hover:text-indigo-800"><Edit2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Change Password */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Settings className="w-5 h-5 text-teal-600" /> Change Password</h3>
                <div className="space-y-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                    <div className="relative">
                      <input type={profileShowNewPw ? 'text' : 'password'} value={profileNewPassword} onChange={e => setProfileNewPassword(e.target.value)} className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Min. 8 characters" />
                      <button type="button" onClick={() => setProfileShowNewPw(!profileShowNewPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">{profileShowNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                    <div className="relative">
                      <input type={profileShowConfirmPw ? 'text' : 'password'} value={profileConfirmPassword} onChange={e => setProfileConfirmPassword(e.target.value)} className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Re-enter new password" />
                      <button type="button" onClick={() => setProfileShowConfirmPw(!profileShowConfirmPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">{profileShowConfirmPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                    {profileConfirmPassword && profileNewPassword !== profileConfirmPassword && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
                    {profileConfirmPassword && profileNewPassword === profileConfirmPassword && <p className="text-xs text-green-600 mt-1">✓ Passwords match</p>}
                  </div>
                  <button onClick={async () => {
                    if (!profileNewPassword || profileNewPassword.length < 8) { alert('Min. 8 characters.'); return; }
                    if (profileNewPassword !== profileConfirmPassword) { alert('Passwords do not match.'); return; }
                    setProfilePwLoading(true);
                    const { error } = await supabase.auth.updateUser({ password: profileNewPassword });
                    setProfilePwLoading(false);
                    if (error) { alert('Error: ' + error.message); return; }
                    setProfileNewPassword(''); setProfileConfirmPassword('');
                    alert('Password updated!');
                  }} disabled={profilePwLoading || !profileNewPassword || profileNewPassword !== profileConfirmPassword}
                    className="w-full py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-40 font-medium">
                    {profilePwLoading ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Reuse the payment profile modal */}
          {showProfileModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }}>
              <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                  <h3 className="text-lg font-bold text-gray-800">{editingProfile ? 'Edit Payment Profile' : 'New Payment Profile'}</h3>
                  <button onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <div className="p-6 space-y-4">
                  <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Profile Label *</label>
                    <input type="text" value={profileForm.profileName} onChange={e => setProfileForm({...profileForm, profileName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" placeholder="e.g. Vendor Account" /></div>
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">Company Name *</label>
                    <input type="text" value={profileForm.companyName} onChange={e => setProfileForm({...profileForm, companyName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">Bank Name *</label>
                    <input type="text" value={profileForm.bankName} onChange={e => setProfileForm({...profileForm, bankName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">Account Number *</label>
                    <input type="text" value={profileForm.accountNumber} onChange={e => setProfileForm({...profileForm, accountNumber: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
                      <input type="text" value={profileForm.iban} onChange={e => setProfileForm({...profileForm, iban: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono" /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">SWIFT / BIC *</label>
                      <input type="text" value={profileForm.swift} onChange={e => setProfileForm({...profileForm, swift: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 text-sm font-mono" /></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="vmIsDefault" checked={profileForm.isDefault} onChange={e => setProfileForm({...profileForm, isDefault: e.target.checked})} className="accent-teal-600 w-4 h-4" />
                    <label htmlFor="vmIsDefault" className="text-sm text-gray-700 cursor-pointer">Set as default</label>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={savePaymentProfile} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium"><Save className="w-4 h-4" /> Save Profile</button>
                    <button onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }} className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── ACCOUNTANT VIEW ──────────────────────────────────────────────────────
  if (currentUser!.role === 'accountant') {
    const reportData = generateReport();
    const weekDates = getWeekDates(reportWeek);
    const grandTotal = reportData.reduce((s, r) => s + r.total, 0);

    const generateConsolidatedReport = () => {
      if (!appliedRange.start || !appliedRange.end) return null;
      const startD = parseLocalDate(appliedRange.start), endD = parseLocalDate(appliedRange.end);

      // Include any week (Mon–Sun) that overlaps the range
      const inRange = timesheets.filter(t => {
        const weekMon = parseLocalDate(t.weekStart);
        const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
        return weekMon <= endD && weekSun >= startD;
      });

      const weekEndings = [...new Set(inRange.map(t => t.weekStart))].sort();
      const partialWeeks = new Set<string>();

      // A week is partial if its Monday or Sunday falls outside the range
      weekEndings.forEach(we => {
        const weekMon = parseLocalDate(we);
        const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
        if (weekMon < startD || weekSun > endD) partialWeeks.add(we);
      });

      const isTestAccount = (name: string) => { const l = (name || '').toLowerCase().trim(); return l === 'test' || /\b(hotmail|yahoo)\b/.test(l); };
      const allTimesheetUsers = users.filter(u => {
        if (u.role !== 'timesheetuser') return false;
        if (consolidatedProjectFilter === 'all') return true;
        if (consolidatedProjectFilter === 'unassigned') return !u.projectId;
        return String(u.projectId) === consolidatedProjectFilter;
      });
      const excludedTestNames = excludeTestAccounts ? allTimesheetUsers.filter(u => isTestAccount(u.name)).map(u => u.name) : [];
      const timesheetUsers = excludeTestAccounts ? allTimesheetUsers.filter(u => !isTestAccount(u.name)) : allTimesheetUsers;
      const employeeRows = timesheetUsers.map(user => {
        const hours: Record<string, number | null> = {}, statuses: Record<string, string> = {};
        let rowTotal = 0;
        weekEndings.forEach(we => {
          const weEnd = formatDate(new Date(parseLocalDate(we).getTime() + 6 * 86400000));
          const ts = inRange.find(t => t.userId === user.id && t.weekStart === we);
          if (ts) {
            // Sum only the days that fall within the applied range
            let h = 0;
            Object.entries(ts.entries).forEach(([dateKey, entry]) => {
              const d = parseLocalDate(dateKey);
              if (d >= startD && d <= endD) h += parseFloat((entry as TimeEntry)?.hours || '0') || 0;
            });
            hours[we] = h; statuses[we] = ts.status; rowTotal += h;
          } else if (!user.startDate || user.startDate > weEnd || (user.endDate && user.endDate < we)) {
            hours[we] = null; statuses[we] = 'n/a';
          } else { hours[we] = null; statuses[we] = 'not submitted'; }
        });
        const latestTs = inRange.filter(t => t.userId === user.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
        const project = projects.find(p => p.id === (latestTs?.projectId ?? user.projectId));
        return { name: user.name, country: countryName(user.country), project: project ? `${project.name} (${project.code})` : 'Not Assigned', hours, statuses, rowTotal };
      });

      const colTotals: Record<string, number> = {};
      weekEndings.forEach(we => { colTotals[we] = employeeRows.reduce((s, r) => s + (r.hours[we] || 0), 0); });
      const sourceCounts = {
        portal: inRange.filter(t => t.source === 'direct' && !isTestAccount(users.find(u => u.id === t.userId)?.name ?? '')).length,
        email:  inRange.filter(t => t.source === 'imported' && !isTestAccount(users.find(u => u.id === t.userId)?.name ?? '')).length,
      };
      return { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal: employeeRows.reduce((s, r) => s + r.rowTotal, 0), excludedTestNames, sourceCounts };
    };

    const consolidatedReport = generateConsolidatedReport();

    return (
      <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
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
              <button onClick={() => setAccountantTab('profiles')} className={'flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 px-2 sm:px-6 font-medium text-xs sm:text-sm border-b-2 transition-colors ' + (accountantTab === 'profiles' ? 'text-indigo-600 border-indigo-600 bg-indigo-50' : 'text-gray-500 border-transparent hover:bg-gray-50 hover:text-gray-700')}>
                <CreditCard className="w-5 h-5 flex-shrink-0" />
                <span>Payment Profiles</span>
              </button>
            </div>
          </div>

          {accountantTab === 'weekly' && (
            <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><FileText className="w-6 h-6" /> Weekly Timesheet Report</h2>
                <div className="flex gap-2">
                  <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> CSV</button>
                  <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"><Printer className="w-4 h-4" /> Print</button>
                </div>
              </div>
              {(() => {
                const isTestAccount = (name: string) => { const l = (name || '').toLowerCase().trim(); return l === 'test' || /\b(hotmail|yahoo)\b/.test(l); };
                const weekKey = formatDate(reportWeek);
                const testAccounts = users.filter(u => u.role === 'timesheetuser' && u.startDate && u.startDate <= weekKey && (!u.endDate || u.endDate >= weekKey) && isTestAccount(u.name));
                const submitted = reportData.filter(r => r.status === 'approved').length;
                const pending   = reportData.filter(r => r.status === 'pending').length;
                const notSub    = reportData.filter(r => r.status === 'not submitted').length;
                const rejected  = reportData.filter(r => r.status === 'rejected').length;
                const portalCount = reportData.filter(r => r.source === 'direct').length;
                const emailCount  = reportData.filter(r => r.source === 'imported').length;
                const totalSubmitted = portalCount + emailCount;
                return (
                  <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Total Employees</div>
                      <div className="text-2xl font-bold text-blue-600 mb-3">{reportData.length}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span className="text-green-700">Approved</span><span className="font-semibold text-green-700">{submitted}</span></div>
                        {pending > 0   && <div className="flex justify-between"><span className="text-yellow-700">Pending</span><span className="font-semibold text-yellow-700">{pending}</span></div>}
                        {notSub > 0    && <div className="flex justify-between"><span className="text-red-600">Not Submitted</span><span className="font-semibold text-red-600">{notSub}</span></div>}
                        {rejected > 0  && <div className="flex justify-between"><span className="text-gray-500">Rejected</span><span className="font-semibold text-gray-500">{rejected}</span></div>}
                      </div>
                      {testAccounts.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-blue-200">
                          <div className="text-xs text-gray-400 mb-1">Test (excluded)</div>
                          <div className="flex flex-wrap gap-1">
                            {testAccounts.map(u => (
                              <span key={u.id} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">{u.name}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Total Hours</div>
                      <div className="text-2xl font-bold text-green-600">{grandTotal.toFixed(1)}h</div>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Avg Hours/Employee</div>
                      <div className="text-2xl font-bold text-purple-600">{reportData.length > 0 ? (grandTotal / reportData.length).toFixed(1) : 0}h</div>
                    </div>
                    <div className="bg-indigo-50 p-4 rounded-lg">
                      <div className="text-sm text-gray-600 mb-1">Submission Channels</div>
                      <div className="text-2xl font-bold text-indigo-600 mb-3">{totalSubmitted} <span className="text-sm font-normal text-gray-400">of {reportData.length}</span></div>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-indigo-700">Portal</span>
                          <span className="font-semibold text-indigo-700">
                            {portalCount}
                            {totalSubmitted > 0 && <span className="text-xs font-normal text-gray-400 ml-1">({Math.round(portalCount / totalSubmitted * 100)}%)</span>}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-blue-700">Email</span>
                          <span className="font-semibold text-blue-700">
                            {emailCount}
                            {totalSubmitted > 0 && <span className="text-xs font-normal text-gray-400 ml-1">({Math.round(emailCount / totalSubmitted * 100)}%)</span>}
                          </span>
                        </div>
                        {totalSubmitted > 0 && (
                          <div className="mt-2 h-1.5 rounded-full bg-blue-200 overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(portalCount / totalSubmitted * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div className="flex justify-between items-center mb-6 p-4 bg-gray-50 rounded-lg">
                <button onClick={() => changeReportWeek(-1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">← Prev</button>
                <div className="text-center">
                  <h3 className="text-lg font-semibold text-gray-800">Week of {reportWeek.toLocaleDateString()}</h3>
                  <p className="text-sm text-gray-600">{weekDates[0].toLocaleDateString()} – {weekDates[6].toLocaleDateString()}</p>
                </div>
                <button onClick={() => changeReportWeek(1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Next →</button>
              </div>
              <StickyScrollWrapper maxHeight="calc(100vh - 360px)">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-indigo-600 text-white">
                      <th className="border border-indigo-700 px-2 py-3 text-center text-xs sticky left-0 z-30 bg-indigo-600">ID</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left sticky z-30 bg-indigo-600 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.18)]" style={{ left: 53 }}>Employee</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left bg-indigo-600">Source</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left bg-indigo-600">Project</th>
                      {weekDates.map((d, i) => <th key={i} className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600"><div>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div><div className="text-xs font-normal">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></th>)}
                      <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Total</th>
                      <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className={`border border-gray-300 px-2 py-3 text-center text-xs text-gray-400 whitespace-nowrap sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{row.timesheetId ? `#${row.timesheetId}` : '—'}</td>
                        <td className={`border border-gray-300 px-4 py-3 font-medium sticky z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`} style={{ left: 53 }}>{row.name}</td>
                        <td className="border border-gray-300 px-4 py-3">
                          {row.source === 'imported'
                            ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">Email</span>
                            : row.source === 'direct'
                            ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Portal</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="border border-gray-300 px-4 py-3 text-sm text-indigo-600">{row.project}</td>
                        {row.dailyHours.map((h, i) => <td key={i} className="border border-gray-300 px-4 py-3 text-center"><span className={h > 0 ? 'font-semibold' : 'text-gray-400'}>{h > 0 ? h.toFixed(1) : '-'}</span></td>)}
                        <td className="border border-gray-300 px-4 py-3 text-center font-bold text-indigo-600">{row.total.toFixed(1)}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center"><span className={'inline-block px-3 py-1 rounded-full text-xs font-medium ' + (row.status === 'approved' ? 'bg-green-100 text-green-800' : row.status === 'rejected' ? 'bg-red-100 text-red-800' : row.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600')}>{row.status === 'not submitted' ? 'Not Submitted' : row.status.charAt(0).toUpperCase() + row.status.slice(1)}</span></td>
                      </tr>
                    ))}
                    <tr className="bg-indigo-50 font-bold">
                      <td className="border border-gray-300 px-4 py-3 text-gray-800 sticky left-0 z-10 bg-indigo-50" colSpan={4}>TOTAL</td>
                      {weekDates.map((_, i) => <td key={i} className="border border-gray-300 px-4 py-3 text-center">{reportData.reduce((s, r) => s + r.dailyHours[i], 0).toFixed(1)}</td>)}
                      <td className="border border-gray-300 px-4 py-3 text-center text-indigo-600 text-lg">{grandTotal.toFixed(1)}</td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                    </tr>
                  </tbody>
                </table>
              </StickyScrollWrapper>
              <div className="flex justify-between items-center mt-4 pt-4 border-t border-gray-200">
                <button onClick={() => changeReportWeek(-1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">← Prev</button>
                <span className="text-sm text-gray-600">{weekDates[0].toLocaleDateString()} – {weekDates[6].toLocaleDateString()}</span>
                <button onClick={() => changeReportWeek(1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Next →</button>
              </div>
            </div>
          )}

          {accountantTab === 'consolidated' && (() => {
            // Build month preset options: last 12 months
            const monthOptions: { label: string; value: string; start: string; end: string }[] = [];
            const now = new Date();
            for (let i = 0; i < 12; i++) {
              const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
              const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const monthVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
              const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
              monthOptions.push({ label, value: monthVal, start: formatDate(firstDay), end: formatDate(lastDay) });
            }

            const downloadConsolidatedCSV = (includeStatus: boolean) => {
              if (!consolidatedReport) return;
              const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal: gt } = consolidatedReport;
              let csv = 'Employee,Country,Project';
              weekEndings.forEach(we => {
                const weekMon = parseLocalDate(we);
                const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
                const label = partialWeeks.has(we)
                  ? `Partial W/E ${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : `W/E ${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                csv += includeStatus ? `,"${label}","Status"` : `,"${label}"`;
              });
              csv += ',Total Hours\n';
              employeeRows.forEach(row => {
                csv += `"${row.name}","${countryName(row.country)}","${row.project}"`;
                weekEndings.forEach(we => {
                  const h = row.hours[we];
                  const st = row.statuses[we];
                  csv += includeStatus
                    ? `,"${h !== null ? h.toFixed(1) : '-'}","${st}"`
                    : `,"${h !== null ? h.toFixed(1) : '-'}"`;
                });
                csv += `,"${row.rowTotal.toFixed(1)}"\n`;
              });
              csv += `"TOTAL","",""`;
              weekEndings.forEach(we => {
                csv += includeStatus ? `,"${colTotals[we].toFixed(1)}",""` : `,"${colTotals[we].toFixed(1)}"`;
              });
              csv += `,"${gt.toFixed(1)}"\n`;
              const rangeLabel = appliedRange.start && appliedRange.end
                ? `${appliedRange.start}_to_${appliedRange.end}`
                : 'consolidated';
              const suffix = includeStatus ? '' : '_hours_only';
              triggerDownload(csv, `consolidated_report${suffix}_${rangeLabel}.csv`);
            };

            return (
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-5">
                  <h2 className="text-xl font-bold text-gray-800">Consolidated Report</h2>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={excludeTestAccounts}
                        onChange={e => setExcludeTestAccounts(e.target.checked)}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      Exclude test accounts
                    </label>
                    <select
                      value={consolidatedProjectFilter}
                      onChange={e => setConsolidatedProjectFilter(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="all">All Projects</option>
                      <option value="unassigned">Not Assigned</option>
                      {projects.filter(p => p.status === 'active').map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {consolidatedReport && (
                      <div className="relative">
                        <button
                          onClick={() => setShowConsolidatedExportMenu(v => !v)}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                        >
                          <Download className="w-4 h-4" /> Export CSV
                        </button>
                        {showConsolidatedExportMenu && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowConsolidatedExportMenu(false)} />
                            <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                              <button
                                onClick={() => { downloadConsolidatedCSV(true); setShowConsolidatedExportMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                With approval status
                              </button>
                              <button
                                onClick={() => { downloadConsolidatedCSV(false); setShowConsolidatedExportMenu(false); }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                Hours only
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                  {/* Month presets */}
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Quick Select — Month</label>
                    <div className="flex flex-wrap gap-2">
                      {monthOptions.slice(0, 6).map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setConsolidatedMonthPreset(opt.value);
                            setConsolidatedRange({ start: opt.start, end: opt.end });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            consolidatedMonthPreset === opt.value
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom date range + Apply */}
                  <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-gray-200">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={consolidatedRange.start}
                        onChange={e => { setConsolidatedRange({...consolidatedRange, start: e.target.value}); setConsolidatedMonthPreset(''); }}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                      <input
                        type="date"
                        value={consolidatedRange.end}
                        onChange={e => { setConsolidatedRange({...consolidatedRange, end: e.target.value}); setConsolidatedMonthPreset(''); }}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <button
                      onClick={() => setAppliedRange({ ...consolidatedRange })}
                      disabled={!consolidatedRange.start || !consolidatedRange.end}
                      className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      <CheckCircle className="w-4 h-4" /> Apply
                    </button>
                    {appliedRange.start && (
                      <button
                        onClick={() => { setAppliedRange({ start: '', end: '' }); setConsolidatedRange({ start: '', end: '' }); setConsolidatedMonthPreset(''); }}
                        className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 underline"
                      >
                        Clear
                      </button>
                    )}
                    {appliedRange.start && appliedRange.end && (
                      <span className="text-sm text-green-700 font-medium bg-green-50 px-3 py-2 rounded-lg border border-green-200">
                        Showing: {parseLocalDate(appliedRange.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – {parseLocalDate(appliedRange.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>

                {consolidatedReport
                  ? <ConsolidatedTable report={consolidatedReport} parseLocalDate={parseLocalDate} testAccounts={consolidatedReport.excludedTestNames} />
                  : (
                    <div className="text-center py-12 text-gray-400">
                      <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-base">Select a month or custom date range, then click <strong className="text-gray-500">Apply</strong>.</p>
                    </div>
                  )
                }
              </div>
            );
          })()}

          {accountantTab === 'invoices' && (() => {
            const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
            const currencySymbols: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' };

            // Distinct users who have at least one invoice — sorted by name
            const invoiceUsers = [...new Map(invoices.map(i => [i.userId, { id: i.userId, name: i.userName }])).values()]
              .sort((a, b) => a.name.localeCompare(b.name));
            const effectiveInvoiceUsers = invoiceSelectedUsers ?? invoiceUsers.map(u => u.id);

            // Full group sizes (before user filter) for "Filtered" badge
            const fullGroupSizes = new Map<string, number>();
            for (const inv of invoices) {
              if (inv.groupKey) fullGroupSizes.set(inv.groupKey, (fullGroupSizes.get(inv.groupKey) || 0) + 1);
            }

            // Build month pills from distinct months in loaded invoices
            const invoiceMonths = [...new Set(
              invoices.map(i => i.periodEnd?.slice(0, 7)).filter(Boolean) as string[]
            )].sort((a, b) => b.localeCompare(a)).slice(0, 12);

            // Build pay-on-date pills from invoices matching all filters except payOnPreset itself
            let prePayOnFiltered = invoices;
            if (invoiceSelectedUsers !== null) prePayOnFiltered = prePayOnFiltered.filter(i => invoiceSelectedUsers.includes(i.userId));
            if (invoiceDateRange.start && invoiceDateRange.end) prePayOnFiltered = prePayOnFiltered.filter(i => i.periodStart >= invoiceDateRange.start && i.periodStart <= invoiceDateRange.end);
            if (invoicePayDateRange.start && invoicePayDateRange.end) prePayOnFiltered = prePayOnFiltered.filter(i => i.payOnDate && i.payOnDate >= invoicePayDateRange.start && i.payOnDate <= invoicePayDateRange.end);
            if (invoicePaidDateRange.start && invoicePaidDateRange.end) prePayOnFiltered = prePayOnFiltered.filter(i => i.paidDate && i.paidDate >= invoicePaidDateRange.start && i.paidDate <= invoicePaidDateRange.end);
            if (invoiceMonthPreset) prePayOnFiltered = prePayOnFiltered.filter(i => i.periodEnd?.slice(0, 7) === invoiceMonthPreset);
            const payOnDates = [...new Set(
              prePayOnFiltered.map(i => i.payOnDate).filter(Boolean) as string[]
            )].sort();

            // Pre-status filtered: all filters except status — used for status pill counts and KPIs
            let preStatusFiltered = invoices;
            if (invoiceSelectedUsers !== null) preStatusFiltered = preStatusFiltered.filter(i => invoiceSelectedUsers.includes(i.userId));
            if (invoiceDateRange.start && invoiceDateRange.end) preStatusFiltered = preStatusFiltered.filter(i => i.periodStart >= invoiceDateRange.start && i.periodStart <= invoiceDateRange.end);
            if (invoicePayDateRange.start && invoicePayDateRange.end) preStatusFiltered = preStatusFiltered.filter(i => i.payOnDate && i.payOnDate >= invoicePayDateRange.start && i.payOnDate <= invoicePayDateRange.end);
            if (invoicePaidDateRange.start && invoicePaidDateRange.end) preStatusFiltered = preStatusFiltered.filter(i => i.paidDate && i.paidDate >= invoicePaidDateRange.start && i.paidDate <= invoicePaidDateRange.end);
            if (invoiceMonthPreset) preStatusFiltered = preStatusFiltered.filter(i => i.periodEnd?.slice(0, 7) === invoiceMonthPreset);
            if (invoicePayOnPreset === 'none') preStatusFiltered = preStatusFiltered.filter(i => !i.payOnDate);
            else if (invoicePayOnPreset) preStatusFiltered = preStatusFiltered.filter(i => i.payOnDate === invoicePayOnPreset);

            let filtered = [...preStatusFiltered];
            if (accountantInvoiceFilter !== 'all') filtered = filtered.filter(i => i.status === accountantInvoiceFilter);
            if (invoicePaymentMethodPreset) filtered = filtered.filter(i => paymentMethod(i) === invoicePaymentMethodPreset);
            filtered = filtered.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

            const usdFiltered = filtered.filter(i => !i.currency || i.currency === 'USD');
            const nonUsdFiltered = filtered.filter(i => i.currency && i.currency !== 'USD');
            const totalFilteredUsd = usdFiltered.reduce((s, i) => s + i.totalAmount, 0);
            const nonUsdByCurrency = nonUsdFiltered.reduce((acc, i) => {
              if (!acc[i.currency]) acc[i.currency] = 0;
              acc[i.currency]++;
              return acc;
            }, {} as Record<string, number>);
            const totalLabel = accountantInvoiceFilter === 'all'
              ? 'Total (USD)'
              : `${accountantInvoiceFilter.charAt(0).toUpperCase() + accountantInvoiceFilter.slice(1)} (USD)`;


            return (
              <div>
                {/* Filters */}
                <div className="bg-white rounded-lg shadow-md p-4 mb-4">
                  <div className="flex flex-col gap-3">
                    {/* Month pills */}
                    {invoiceMonths.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <button onClick={() => setInvoiceMonthPreset('')}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!invoiceMonthPreset ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                          All months
                        </button>
                        {invoiceMonths.map(ym => {
                          const [y, m] = ym.split('-');
                          const label = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                          const count = invoices.filter(i => i.periodEnd?.slice(0, 7) === ym).length;
                          return (
                            <button key={ym} onClick={() => setInvoiceMonthPreset(invoiceMonthPreset === ym ? '' : ym)}
                              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${invoiceMonthPreset === ym ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                              {label} <span className="opacity-70">({count})</span>
                            </button>
                          );
                        })}
                        {invoiceMonthPreset === invoiceMonths[0] && (
                          <span className="text-xs text-gray-400 ml-1">Loaded to latest period — select All months to see everything</span>
                        )}
                      </div>
                    )}
                    {/* Pay On Date quick pills */}
                    {payOnDates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className="text-xs font-medium text-blue-600 mr-1">Pay On:</span>
                        <button onClick={() => setInvoicePayOnPreset('')}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!invoicePayOnPreset ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                          All
                        </button>
                        {payOnDates.map(d => {
                          const label = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          const count = prePayOnFiltered.filter(i => i.payOnDate === d).length;
                          return (
                            <button key={d} onClick={() => setInvoicePayOnPreset(invoicePayOnPreset === d ? '' : d)}
                              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${invoicePayOnPreset === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-200 hover:border-blue-400'}`}>
                              {label} <span className="opacity-70">({count})</span>
                            </button>
                          );
                        })}
                        <button onClick={() => setInvoicePayOnPreset(invoicePayOnPreset === 'none' ? '' : 'none')}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${invoicePayOnPreset === 'none' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'}`}>
                          Not assigned <span className="opacity-70">({prePayOnFiltered.filter(i => !i.payOnDate).length})</span>
                        </button>
                      </div>
                    )}
                    {/* Status pills */}
                    <div className="flex flex-wrap gap-2">
                      {['all','submitted','approved','paid','rejected'].map(s => (
                        <button key={s} onClick={() => setAccountantInvoiceFilter(s)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${accountantInvoiceFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                          {s === 'all' ? `All (${preStatusFiltered.length})` : s.charAt(0).toUpperCase() + s.slice(1)}
                          {s !== 'all' && <span className="ml-1.5 text-xs">({preStatusFiltered.filter(i => i.status === s).length})</span>}
                        </button>
                      ))}
                    </div>
                    {/* Payment method pills */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-xs font-medium text-gray-600 mr-1">Method:</span>
                      <button onClick={() => setInvoicePaymentMethodPreset('')}
                        className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${!invoicePaymentMethodPreset ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'}`}>
                        All
                      </button>
                      {(['Intuit', 'Convera'] as const).map(m => {
                        const count = preStatusFiltered.filter(i => (accountantInvoiceFilter === 'all' || i.status === accountantInvoiceFilter) && paymentMethod(i) === m).length;
                        const active = invoicePaymentMethodPreset === m;
                        const activeColor = m === 'Intuit' ? 'bg-green-600 border-green-600 text-white' : 'bg-purple-600 border-purple-600 text-white';
                        const inactiveColor = m === 'Intuit' ? 'bg-white text-green-700 border-green-300 hover:border-green-500' : 'bg-white text-purple-700 border-purple-300 hover:border-purple-500';
                        return (
                          <button key={m} onClick={() => setInvoicePaymentMethodPreset(active ? '' : m)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${active ? activeColor : inactiveColor}`}>
                            {m} <span className="opacity-70">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Contractor picker */}
                    <div className="relative">
                      <button
                        onClick={() => setInvoiceUserDropdownOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <span className="text-gray-700">
                          {effectiveInvoiceUsers.length === invoiceUsers.length
                            ? 'All contractors'
                            : `${effectiveInvoiceUsers.length} of ${invoiceUsers.length} contractors`}
                        </span>
                        <svg className={`w-4 h-4 text-gray-500 transition-transform ${invoiceUserDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {invoiceUserDropdownOpen && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                          <div className="p-2 border-b border-gray-100">
                            <input
                              type="text"
                              value={invoiceUserSearch}
                              onChange={e => setInvoiceUserSearch(e.target.value)}
                              placeholder="Search contractors..."
                              className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                              autoFocus
                            />
                          </div>
                          <div className="flex gap-2 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
                            <button onClick={() => setInvoiceSelectedUsers(null)} className="text-xs text-indigo-600 hover:underline font-medium">Select all</button>
                            <span className="text-gray-300">|</span>
                            <button onClick={() => setInvoiceSelectedUsers([])} className="text-xs text-gray-500 hover:underline">Clear</button>
                          </div>
                          <div className="max-h-60 overflow-y-auto">
                            {invoiceUsers.filter(u => u.name.toLowerCase().includes(invoiceUserSearch.toLowerCase())).length === 0 ? (
                              <p className="text-sm text-gray-400 text-center py-4">No contractors match</p>
                            ) : invoiceUsers.filter(u => u.name.toLowerCase().includes(invoiceUserSearch.toLowerCase())).map(u => (
                              <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={effectiveInvoiceUsers.includes(u.id)}
                                  onChange={() => {
                                    const next = effectiveInvoiceUsers.includes(u.id)
                                      ? effectiveInvoiceUsers.filter(x => x !== u.id)
                                      : [...effectiveInvoiceUsers, u.id];
                                    setInvoiceSelectedUsers(next.length === invoiceUsers.length ? null : next);
                                  }}
                                  className="rounded text-indigo-600"
                                />
                                <span className="text-sm text-gray-700">{u.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <span className="block text-xs font-medium text-gray-500 mb-1">Period</span>
                        <div className="flex gap-1 items-center">
                          <input type="date" value={invoiceDateRange.start} onChange={e => setInvoiceDateRange({...invoiceDateRange, start: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                          <span className="text-gray-400 text-xs">–</span>
                          <input type="date" value={invoiceDateRange.end} onChange={e => setInvoiceDateRange({...invoiceDateRange, end: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                          {(invoiceDateRange.start || invoiceDateRange.end) && <button onClick={() => setInvoiceDateRange({start:'',end:''})} className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">✕</button>}
                        </div>
                      </div>
                      <div>
                        <span className="block text-xs font-medium text-blue-600 mb-1">Pay On Date (range)</span>
                        <div className="flex gap-1 items-center">
                          <input type="date" value={invoicePayDateRange.start} onChange={e => setInvoicePayDateRange({...invoicePayDateRange, start: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400" />
                          <span className="text-gray-400 text-xs">–</span>
                          <input type="date" value={invoicePayDateRange.end} onChange={e => setInvoicePayDateRange({...invoicePayDateRange, end: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400" />
                          {(invoicePayDateRange.start || invoicePayDateRange.end) && <button onClick={() => setInvoicePayDateRange({start:'',end:''})} className="text-xs text-blue-400 hover:text-blue-600 underline ml-1">✕</button>}
                        </div>
                      </div>
                      <div>
                        <span className="block text-xs font-medium text-green-700 mb-1">Paid Date</span>
                        <div className="flex gap-1 items-center">
                          <input type="date" value={invoicePaidDateRange.start} onChange={e => setInvoicePaidDateRange({...invoicePaidDateRange, start: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-green-200 rounded-lg text-sm focus:ring-2 focus:ring-green-400" />
                          <span className="text-gray-400 text-xs">–</span>
                          <input type="date" value={invoicePaidDateRange.end} onChange={e => setInvoicePaidDateRange({...invoicePaidDateRange, end: e.target.value})} className="flex-1 min-w-0 px-2 py-1.5 border border-green-200 rounded-lg text-sm focus:ring-2 focus:ring-green-400" />
                          {(invoicePaidDateRange.start || invoicePaidDateRange.end) && <button onClick={() => setInvoicePaidDateRange({start:'',end:''})} className="text-xs text-green-500 hover:text-green-700 underline ml-1">✕</button>}
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowConveraModal(true); loadConveraBeneficiaries(); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"><UploadCloud className="w-4 h-4" /> Import Convera PDF</button>
                      <button onClick={() => { setShowConveraMatchingModal(true); loadConveraBeneficiaries(); loadConveraLastPaymentDates(); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm"><Users className="w-4 h-4" /> Convera Matching</button>
                      <button onClick={() => exportInvoicesCSV(filtered)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
                    </div>
                  </div>
                </div>

                {/* KPI cards — reflect current filters */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="bg-white rounded-lg shadow-md p-4">
                    <div className="text-sm text-gray-500 mb-1">{totalLabel}</div>
                    <div className="text-2xl font-bold text-indigo-600">${totalFilteredUsd.toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                    <div className="text-xs text-gray-400 mt-1">{nonUsdFiltered.length > 0 ? `excl. ${nonUsdFiltered.length} non-USD` : 'USD only'}</div>
                  </div>
                  <div className="bg-white rounded-lg shadow-md p-4">
                    <div className="text-sm text-gray-500 mb-1">Pending Review</div>
                    <div className="text-2xl font-bold text-yellow-600">{filtered.filter(i => i.status === 'submitted').length}</div>
                    <div className="text-xs text-gray-400 mt-1">awaiting approval</div>
                  </div>
                  <div className="bg-white rounded-lg shadow-md p-4">
                    <div className="text-sm text-gray-500 mb-1">Approved</div>
                    <div className="text-2xl font-bold text-green-600">{filtered.filter(i => i.status === 'approved').length}</div>
                    <div className="text-xs text-gray-400 mt-1">ready to pay</div>
                  </div>
                  {nonUsdFiltered.length > 0 ? (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg shadow-md p-4">
                      <div className="text-sm text-amber-700 font-semibold mb-1">Non-USD Invoices</div>
                      <div className="text-2xl font-bold text-amber-600">{nonUsdFiltered.length}</div>
                      <div className="text-xs text-amber-600 mt-1">
                        {Object.entries(nonUsdByCurrency).map(([cur, cnt]) => `${cnt} ${cur}`).join(', ')} — USD amounts needed
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-lg shadow-md p-4">
                      <div className="text-sm text-gray-500 mb-1">Paid</div>
                      <div className="text-2xl font-bold text-blue-600">{filtered.filter(i => i.status === 'paid').length}</div>
                      <div className="text-xs text-gray-400 mt-1">invoices settled</div>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow-md p-6">
                  {/* Table */}
                  {filtered.length === 0 ? (
                    <div className="text-center py-12 text-gray-400"><Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No invoices match the current filter</p></div>
                  ) : (
                    <StickyScrollWrapper maxHeight="calc(100vh - 360px)">
                      {(() => {
                        // Build display groups once — shared by tbody and tfoot
                        const groupMap = new Map<string, Invoice[]>();
                        for (const inv of filtered) {
                          const key = inv.groupKey ? `grp:${inv.groupKey}` : `solo:${inv.id}`;
                          if (!groupMap.has(key)) groupMap.set(key, []);
                          groupMap.get(key)!.push(inv);
                        }
                        const displayGroups = Array.from(groupMap.values());
                        // Sort by contractor name; groups use their payment profile company name
                        displayGroups.sort((a, b) => {
                          const nameA = (a.length > 1 ? (a[0].paymentProfile?.companyName || a[0].userName) : a[0].userName).toLowerCase();
                          const nameB = (b.length > 1 ? (b[0].paymentProfile?.companyName || b[0].userName) : b[0].userName).toLowerCase();
                          return nameA.localeCompare(nameB);
                        });

                        const reconCell = (inv: Invoice, compact?: boolean) => {
                          if (inv.source !== 'imported') return <span className="text-gray-300 text-xs">—</span>;
                          const recon = reconcileInvoiceLive(inv, timesheets);
                          const tooltip = recon.timesheetHours == null
                            ? 'No timesheets found for period'
                            : `Timesheet: ${recon.timesheetHours}h · Invoice: ${inv.totalHours}h`;
                          const missingNote = recon.missingWeeks > 0 && recon.timesheetHours != null && recon.status !== 'matched'
                            ? `${recon.missingWeeks} week${recon.missingWeeks > 1 ? 's' : ''} with no TS` : null;
                          return (
                            <div className="flex flex-col items-center gap-0.5" title={tooltip}>
                              {recon.status === 'matched' ? (
                                <span className={`px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium`}>✓ Matched</span>
                              ) : recon.status === 'mismatch' ? (
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${recon.delta != null && recon.delta > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {recon.delta != null ? (recon.delta > 0 ? '▲ +' : '▽ ') + recon.delta + 'h' : '⚠ Mismatch'}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium">? —</span>
                              )}
                              {!compact && recon.timesheetHours != null && (
                                <span className="text-gray-400 text-xs">TS: {recon.timesheetHours}h</span>
                              )}
                              {missingNote && (
                                <span className="text-red-400 text-xs font-medium">{missingNote}</span>
                              )}
                            </div>
                          );
                        };

                        return (
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-indigo-600 text-white sticky top-0 z-20">
                          <tr>
                            <th className="border border-indigo-700 px-4 py-3 text-left sticky left-0 z-30 bg-indigo-600">Contractor</th>
                            <th className="border border-indigo-700 px-4 py-3 text-left bg-indigo-600">Period</th>
                            <th className="border border-indigo-700 px-4 py-3 text-left bg-indigo-600">Project</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Hours</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Rate</th>
                            <th className="border border-indigo-700 px-4 py-3 text-right bg-indigo-600">Amount</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Pay On Date</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Payment Method</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Paid Date</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Status</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Recon</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">PDF</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center bg-indigo-600">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {

                            let rowIdx = 0;
                            return displayGroups.map((group) => {
                              const isGroup = group.length > 1;

                              if (!isGroup) {
                                const inv = group[0];
                                const project = projects.find(p => p.id === inv.projectId);
                                const sym = currencySymbols[inv.currency] || '$';
                                const isEvenRow = rowIdx % 2 === 0;
                                const rowClass = isEvenRow ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50';
                                rowIdx++;
                                return (
                                  <tr key={inv.id} className={'cursor-pointer group ' + rowClass} onClick={() => { setSelectedInvoice(inv); setShowInvoiceModal(true); }}>
                                    <td className={`border border-gray-200 px-4 py-3 sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] group-hover:bg-blue-50 ${isEvenRow ? 'bg-white' : 'bg-gray-50'}`}>
                                      <div className="font-medium text-gray-800">{inv.userName}</div>
                                      <div className="font-mono text-xs text-gray-400 mt-0.5">#{inv.invoiceNumber}</div>
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 whitespace-nowrap">{parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                                    <td className="border border-gray-200 px-4 py-3 text-indigo-600 text-xs">{project?.name || '—'}</td>
                                    <td className="border border-gray-200 px-4 py-3 text-center">{inv.totalHours?.toFixed(2) ?? '—'}</td>
                                    <td className="border border-gray-200 px-4 py-3 text-center text-gray-500">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)}` : '—'}</td>
                                    <td className="border border-gray-200 px-4 py-3 text-right font-bold text-gray-800">
                                      {sym}{inv.totalAmount.toFixed(2)}
                                      {inv.source === 'imported' && inv.currency !== 'USD' && (
                                        <span className="ml-1 text-amber-500 text-xs font-semibold" title={`Extracted in ${inv.currency} — set USD rate in invoice detail`}>⚠ {inv.currency}</span>
                                      )}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                                      {inv.payOnDate
                                        ? <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{new Date(inv.payOnDate).toLocaleDateString()}</span>
                                        : <span className="text-gray-300 text-xs">—</span>}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                                      {(inv.paymentProfile || inv.paymentMethodOverride)
                                        ? <span className={`px-2 py-1 rounded text-xs font-medium ${paymentMethod(inv) === 'Intuit' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'}`}>{paymentMethod(inv)}</span>
                                        : <span className="text-gray-300 text-xs">—</span>}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                                      {inv.paidDate
                                        ? <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">{new Date(inv.paidDate).toLocaleDateString()}</span>
                                        : <span className="text-gray-300 text-xs">—</span>}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 text-center">
                                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                                      {inv.corrected && <span className="ml-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Corrected</span>}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 text-center">{reconCell(inv)}</td>
                                    <td className="border border-gray-200 px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                      {inv.attachmentPath ? (
                                        <button onClick={() => openAttachment(inv)} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 text-xs font-medium">
                                          <Paperclip className="w-3 h-3" /> PDF
                                        </button>
                                      ) : (
                                        <span className="text-gray-300 text-xs">—</span>
                                      )}
                                    </td>
                                    <td className="border border-gray-200 px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                      <div className="flex items-center justify-center gap-1">
                                        {inv.status === 'submitted' && (
                                          <>
                                            <button onClick={() => handleInvoiceAction(inv.id, 'approved')} className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium">Approve</button>
                                            <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium">Reject</button>
                                          </>
                                        )}
                                        {inv.status === 'approved' && (
                                          <button onClick={() => { setSelectedInvoice(inv); setPendingPayOnDate(''); setPendingPaidDate(''); setShowInvoiceModal(true); }} className="px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs font-medium">Mark Paid</button>
                                        )}
                                        {(inv.status === 'paid' || inv.status === 'rejected') && <span className="text-gray-400 text-xs">—</span>}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              // ── Multi-invoice group (e.g. Teal Crossroads) ──
                              rowIdx++;
                              const groupKey = group[0].invoiceNumber;
                              const groupPeriod = parseLocalDate(group[0].periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                              const groupTotalHours = group.reduce((s, i) => s + (i.totalHours ?? 0), 0);
                              const groupTotalAmount = group.reduce((s, i) => s + i.totalAmount, 0);
                              const groupSym = currencySymbols[group[0].currency] || '$';
                              const submittedInGroup = group.filter(i => i.status === 'submitted');
                              const anyAttachment = group.find(i => i.attachmentPath);
                              const sharedProfile = group[0].paymentProfile;
                              const allShareProfile = sharedProfile && group.every(i => i.paymentProfile?.id === sharedProfile.id);
                              const groupStatuses = [...new Set(group.map(i => i.status))];
                              const groupFirstPayOn = group.find(i => i.payOnDate)?.payOnDate;

                              const sortedGroup = [...group].sort((a, b) => a.userName.localeCompare(b.userName));
                              const companyName = group[0].paymentProfile?.companyName || group.map(i => i.userName).join(', ');
                              const groupRecons = group.filter(i => i.source === 'imported').map(i => reconcileInvoiceLive(i, timesheets));
                              const groupTsHours = groupRecons.every(r => r.timesheetHours != null)
                                ? groupRecons.reduce((s, r) => s + (r.timesheetHours ?? 0), 0) : null;
                              // Missing weeks at group level: weeks where no member has any hours
                              const groupMissingWeeks = (() => {
                                const inv0 = group.find(i => i.source === 'imported');
                                if (!inv0) return 0;
                                const { periodStart, periodEnd } = inv0;
                                const firstDay = new Date(periodStart + 'T12:00:00');
                                const firstDow = firstDay.getDay();
                                firstDay.setDate(firstDay.getDate() - (firstDow === 0 ? 6 : firstDow - 1));
                                const weeks: string[] = [];
                                const cur = new Date(firstDay.getTime());
                                while (cur.toISOString().slice(0, 10) <= periodEnd) {
                                  weeks.push(cur.toISOString().slice(0, 10));
                                  cur.setDate(cur.getDate() + 7);
                                }
                                const weeksWithAnyHours = new Set(
                                  groupRecons.flatMap(r => r.rows.filter(row => row.hoursInPeriod > 0).map(row => row.ts.weekStart))
                                );
                                return weeks.filter(w => !weeksWithAnyHours.has(w)).length;
                              })();
                              const groupReconDelta = groupTsHours != null ? Math.round((groupTotalHours - groupTsHours) * 100) / 100 : null;
                              const groupReconStatus = groupTsHours == null ? 'unknown'
                                : Math.abs(groupReconDelta!) < 0.01 ? 'matched' : 'mismatch';

                              return [
                                // Group header row
                                <tr key={`grp-hdr-${groupKey}`} className="bg-indigo-50 border-l-4 border-l-indigo-500 font-semibold">
                                  <td className="border border-indigo-200 px-4 py-2.5 sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] bg-indigo-50">
                                    <div className="font-medium text-indigo-900">{companyName}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <span className="font-mono text-xs text-gray-400">#{groupKey}</span>
                                      <span className="px-1.5 py-0.5 bg-indigo-200 text-indigo-700 rounded text-xs">Group · {group.length}</span>
                                      {group[0].groupKey && group.length < (fullGroupSizes.get(group[0].groupKey) ?? group.length) && (
                                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">Filtered</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-xs whitespace-nowrap text-indigo-700">{groupPeriod}</td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-xs text-gray-400">—</td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center text-indigo-800">{groupTotalHours.toFixed(2)}</td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center text-gray-400 text-xs">—</td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-right text-indigo-900 font-bold">{groupSym}{groupTotalAmount.toFixed(2)}</td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center whitespace-nowrap">
                                    {groupFirstPayOn
                                      ? <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{new Date(groupFirstPayOn).toLocaleDateString()}</span>
                                      : <span className="text-gray-300 text-xs">—</span>}
                                  </td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                    {allShareProfile && sharedProfile ? (
                                      <div className="flex flex-col items-center gap-1">
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${paymentMethod(group[0]) === 'Intuit' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'}`}>
                                          {paymentMethod(group[0])}
                                        </span>
                                        <button
                                          onClick={() => toggleCombinePayments(sharedProfile.id, sharedProfile.combinePayments)}
                                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${sharedProfile.combinePayments ? 'bg-teal-100 text-teal-700 border-teal-300 hover:bg-teal-200' : 'bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200'}`}
                                          title="Toggle whether all invoices to this payee are combined into one wire"
                                        >
                                          {sharedProfile.combinePayments ? '⊕ Combined' : '○ Separate'}
                                        </button>
                                      </div>
                                    ) : <span className="text-gray-300 text-xs">—</span>}
                                  </td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center text-gray-400 text-xs">—</td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center">
                                    <div className="flex flex-wrap justify-center gap-0.5">
                                      {groupStatuses.map(s => (
                                        <span key={s} className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${statusColors[s]}`}>
                                          {group.filter(i => i.status === s).length} {s}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center">
                                    <div className="flex flex-col items-center gap-0.5">
                                      {groupReconStatus === 'matched' ? (
                                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">✓ Matched</span>
                                      ) : groupReconStatus === 'mismatch' ? (
                                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${groupReconDelta != null && groupReconDelta > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                          {groupReconDelta != null ? (groupReconDelta > 0 ? '▲ +' : '▽ ') + groupReconDelta + 'h' : '⚠ Mismatch'}
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium">? —</span>
                                      )}
                                      {groupTsHours != null && (
                                        <span className="text-gray-400 text-xs">TS: {groupTsHours}h</span>
                                      )}
                                      {groupMissingWeeks > 0 && groupTsHours != null && groupReconStatus !== 'matched' && (
                                        <span className="text-red-400 text-xs font-medium">{groupMissingWeeks} wk{groupMissingWeeks > 1 ? 's' : ''} missing</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                    {anyAttachment ? (
                                      <button onClick={() => openAttachment(anyAttachment)} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 text-indigo-700 border border-indigo-300 rounded hover:bg-indigo-200 text-xs font-medium">
                                        <Paperclip className="w-3 h-3" /> PDF
                                      </button>
                                    ) : <span className="text-gray-300 text-xs">—</span>}
                                  </td>
                                  <td className="border border-indigo-200 px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                    {submittedInGroup.length > 0 && (
                                      <button
                                        onClick={async () => { for (const inv of submittedInGroup) await handleInvoiceAction(inv.id, 'approved'); }}
                                        className="px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium whitespace-nowrap"
                                      >
                                        Approve all ({submittedInGroup.length})
                                      </button>
                                    )}
                                    {submittedInGroup.length === 0 && <span className="text-gray-400 text-xs">—</span>}
                                  </td>
                                </tr>,
                                // Individual contractor rows within the group — sorted by name
                                ...sortedGroup.map((inv) => {
                                  const project = projects.find(p => p.id === inv.projectId);
                                  const sym = currencySymbols[inv.currency] || '$';
                                  return (
                                    <tr key={inv.id} className="bg-white border-l-4 border-l-indigo-200 hover:bg-indigo-50 cursor-pointer group" onClick={() => { setSelectedInvoice(inv); setShowInvoiceModal(true); }}>
                                      <td className="border border-gray-200 px-4 py-2 pl-7 sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] bg-white group-hover:bg-indigo-50">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-gray-300 text-xs">↳</span>
                                          <span className="font-medium text-gray-800 text-sm">{inv.userName}</span>
                                        </div>
                                        {inv.invoiceNumber && <div className="font-mono text-xs text-gray-400 mt-0.5 ml-4">#{inv.invoiceNumber}</div>}
                                      </td>
                                      <td className="border border-gray-200 px-4 py-2 text-gray-400 text-xs">—</td>
                                      <td className="border border-gray-200 px-4 py-2 text-indigo-600 text-xs">{project?.name || '—'}</td>
                                      <td className="border border-gray-200 px-4 py-2 text-center text-sm">{inv.totalHours?.toFixed(2) ?? '—'}</td>
                                      <td className="border border-gray-200 px-4 py-2 text-center text-gray-500 text-sm">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)}` : '—'}</td>
                                      <td className="border border-gray-200 px-4 py-2 text-right font-semibold text-gray-800 text-sm">
                                        {sym}{inv.totalAmount.toFixed(2)}
                                        {inv.source === 'imported' && inv.currency !== 'USD' && (
                                          <span className="ml-1 text-amber-500 text-xs" title={`Extracted in ${inv.currency}`}>⚠ {inv.currency}</span>
                                        )}
                                      </td>
                                      <td className="border border-gray-200 px-4 py-2 text-center whitespace-nowrap">
                                        {inv.payOnDate
                                          ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{new Date(inv.payOnDate).toLocaleDateString()}</span>
                                          : <span className="text-gray-300 text-xs">—</span>}
                                      </td>
                                      <td className="border border-gray-200 px-4 py-2 text-center text-gray-400 text-xs">—</td>
                                      <td className="border border-gray-200 px-4 py-2 text-center whitespace-nowrap">
                                        {inv.paidDate
                                          ? <span className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">{new Date(inv.paidDate).toLocaleDateString()}</span>
                                          : <span className="text-gray-300 text-xs">—</span>}
                                      </td>
                                      <td className="border border-gray-200 px-4 py-2 text-center">
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>
                                          {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                                        </span>
                                        {inv.corrected && <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">Corrected</span>}
                                      </td>
                                      <td className="border border-gray-200 px-4 py-2 text-center">{reconCell(inv, true)}</td>
                                      <td className="border border-gray-200 px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                                        {inv.attachmentPath ? (
                                          <button onClick={() => openAttachment(inv)} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-100 text-xs">
                                            <Paperclip className="w-3 h-3" /> PDF
                                          </button>
                                        ) : <span className="text-gray-300 text-xs">—</span>}
                                      </td>
                                      <td className="border border-gray-200 px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                                        <div className="flex items-center justify-center gap-1">
                                          {inv.status === 'submitted' && (
                                            <>
                                              <button onClick={() => handleInvoiceAction(inv.id, 'approved')} className="px-2 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200 text-xs font-medium">✓</button>
                                              <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="px-2 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200 text-xs font-medium">✕</button>
                                            </>
                                          )}
                                          {inv.status === 'approved' && (
                                            <button onClick={() => { setSelectedInvoice(inv); setPendingPayOnDate(''); setPendingPaidDate(''); setShowInvoiceModal(true); }} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-xs font-medium">Paid</button>
                                          )}
                                          {(inv.status === 'paid' || inv.status === 'rejected') && <span className="text-gray-400 text-xs">—</span>}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                }),
                              ];
                            });
                          })()}
                        </tbody>
                        <tfoot className="bg-gray-100 font-semibold">
                          <tr>
                            <td className="border border-gray-200 px-4 py-3 text-gray-700 sticky left-0 z-10 bg-gray-100" colSpan={4}>Filtered Total ({displayGroups.length} payee{displayGroups.length !== 1 ? 's' : ''}, {filtered.length} invoice{filtered.length !== 1 ? 's' : ''})</td>
                            <td className="border border-gray-200 px-4 py-3 text-center">{filtered.reduce((s, i) => s + (i.totalHours ?? 0), 0).toFixed(2)}</td>
                            <td className="border border-gray-200 px-4 py-3"></td>
                            <td className="border border-gray-200 px-4 py-3 text-right text-indigo-700">${filtered.reduce((s, i) => s + i.totalAmount, 0).toFixed(2)}</td>
                            <td className="border border-gray-200 px-4 py-3" colSpan={5}></td>
                          </tr>
                        </tfoot>
                      </table>
                        );
                      })()}
                    </StickyScrollWrapper>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Timesheet Only Tab */}
          {accountantTab === 'timesheet-only' && (() => {
            const tsOnlyUsers = users.filter(u => u.role === 'timesheetuser' && !u.invoiceEnabled);

            // Initialise selection to all users on first render
            const effectiveSelected = tsOnlySelectedUsers ?? tsOnlyUsers.map(u => u.id);

            const filteredTs = (() => {
              let list = timesheets.filter(t => effectiveSelected.includes(t.userId));
              if (tsOnlyApplied.start && tsOnlyApplied.end) {
                list = list.filter(t => t.weekStart >= tsOnlyApplied.start && t.weekStart <= tsOnlyApplied.end);
              }
              return list.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
            })();

            const exportTsOnlyCSV = () => {
              let csv = 'ID,Employee,Source,Week Start,Week Ending,Project,Mon,Tue,Wed,Thu,Fri,Sat,Sun,Total Hours,Status,Submitted\n';
              filteredTs.forEach(ts => {
                const user = users.find(u => u.id === ts.userId);
                const project = projects.find(p => p.id === (ts.projectId ?? user?.projectId));
                const weekDates = getWeekDates(parseLocalDate(ts.weekStart));
                const dailyHours = weekDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                const total = dailyHours.reduce((s, h) => s + h, 0);
                const fri = weekDates[4];
                const sourceLabel = ts.source === 'imported' ? 'Email' : ts.source === 'direct' ? 'Portal' : '';
                csv += `"#${ts.id}","${ts.userName}","${sourceLabel}","${ts.weekStart}","${formatDate(fri)}","${project ? project.name + ' (' + project.code + ')' : 'N/A'}",`;
                dailyHours.forEach(h => { csv += h + ','; });
                csv += `${total.toFixed(1)},"${ts.status}","${ts.submittedAt ? new Date(ts.submittedAt).toLocaleDateString() : ''}"
`;
            });
              triggerDownload(csv, `timesheet_only_users_${Date.now()}.csv`);
            };

            const searchedUsers = tsOnlyUsers.filter(u =>
              u.name.toLowerCase().includes(tsOnlySearch.toLowerCase())
            );
            const toggleUser = (id: string) => {
              const current = tsOnlySelectedUsers ?? tsOnlyUsers.map(u => u.id);
              setTsOnlySelectedUsers(current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
            };

            return (
              <div className="space-y-6">
                <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Users className="w-6 h-6 text-indigo-600" /> Timesheet-Only Users
                      </h2>
                      <p className="text-sm text-gray-500 mt-1">{tsOnlyUsers.length} user{tsOnlyUsers.length !== 1 ? 's' : ''} without invoice module</p>
                    </div>
                    <button
                      onClick={exportTsOnlyCSV}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                    >
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  </div>

                  {tsOnlyUsers.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">
                      <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>No users without invoice module.</p>
                    </div>
                  ) : (
                    <>
                      {/* User picker */}
                      <div className="mb-5 relative">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Filter Users</label>
                        <button
                          onClick={() => setTsOnlyDropdownOpen(o => !o)}
                          className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <span className="text-gray-700">
                            {effectiveSelected.length === tsOnlyUsers.length
                              ? 'All users selected'
                              : `${effectiveSelected.length} of ${tsOnlyUsers.length} users selected`}
                          </span>
                          <svg className={`w-4 h-4 text-gray-500 transition-transform ${tsOnlyDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>

                        {tsOnlyDropdownOpen && (
                          <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                            {/* Search */}
                            <div className="p-2 border-b border-gray-100">
                              <input
                                type="text"
                                value={tsOnlySearch}
                                onChange={e => setTsOnlySearch(e.target.value)}
                                placeholder="Search users..."
                                className="w-full px-3 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                autoFocus
                              />
                            </div>
                            {/* Select all / Clear */}
                            <div className="flex gap-2 px-3 py-1.5 border-b border-gray-100 bg-gray-50">
                              <button
                                onClick={() => setTsOnlySelectedUsers(tsOnlyUsers.map(u => u.id))}
                                className="text-xs text-indigo-600 hover:underline font-medium"
                              >Select all</button>
                              <span className="text-gray-300">|</span>
                              <button
                                onClick={() => setTsOnlySelectedUsers([])}
                                className="text-xs text-gray-500 hover:underline"
                              >Clear</button>
                            </div>
                            {/* User list */}
                            <div className="max-h-60 overflow-y-auto">
                              {searchedUsers.length === 0 ? (
                                <p className="text-sm text-gray-400 text-center py-4">No users match</p>
                              ) : (
                                searchedUsers.map(u => (
                                  <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={effectiveSelected.includes(u.id)}
                                      onChange={() => toggleUser(u.id)}
                                      className="w-4 h-4 rounded text-indigo-600"
                                    />
                                    <span className="text-sm text-gray-800">{u.name}</span>
                                    <span className="text-xs text-gray-400 ml-auto">{countryName(u.country)}</span>
                                  </label>
                                ))
                              )}
                            </div>
                            <div className="p-2 border-t border-gray-100 bg-gray-50 text-right">
                              <button
                                onClick={() => { setTsOnlyDropdownOpen(false); setTsOnlySearch(''); }}
                                className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700"
                              >Done</button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Quick select presets */}
                      {(() => {
                        const now = new Date();
                        const monthOpts = Array.from({ length: 6 }, (_, i) => {
                          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                          const start = formatDate(new Date(d.getFullYear(), d.getMonth(), 1));
                          const end   = formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
                          return { label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), start, end };
                        });
                        const todayMon = (() => { const d = new Date(); d.setHours(0,0,0,0); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d; })();
                        const biWeekEnd = new Date(todayMon); biWeekEnd.setDate(biWeekEnd.getDate() - 1);
                        const biWeekStart = new Date(todayMon); biWeekStart.setDate(biWeekStart.getDate() - 14);
                        const biWeekLabel = `${biWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${biWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                        const lastWeekStart = new Date(todayMon); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
                        const lastWeekEnd = new Date(todayMon); lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
                        const lastWeekLabel = `${lastWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${lastWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
                        const isActive = (s: string, e: string) => tsOnlyApplied.start === s && tsOnlyApplied.end === e;
                        return (
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-4">
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Bi-Weekly</label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => { const s = formatDate(lastWeekStart); const e = formatDate(lastWeekEnd); setTsOnlyRange({ start: s, end: e }); setTsOnlyApplied({ start: s, end: e }); }}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isActive(formatDate(lastWeekStart), formatDate(lastWeekEnd)) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'}`}
                                >Last Week ({lastWeekLabel})</button>
                                <button
                                  onClick={() => { const s = formatDate(biWeekStart); const e = formatDate(biWeekEnd); setTsOnlyRange({ start: s, end: e }); setTsOnlyApplied({ start: s, end: e }); }}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isActive(formatDate(biWeekStart), formatDate(biWeekEnd)) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'}`}
                                >Last 2 Weeks ({biWeekLabel})</button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Month</label>
                              <div className="flex flex-wrap gap-2">
                                {monthOpts.map(opt => (
                                  <button
                                    key={opt.start}
                                    onClick={() => { setTsOnlyRange({ start: opt.start, end: opt.end }); setTsOnlyApplied({ start: opt.start, end: opt.end }); }}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isActive(opt.start, opt.end) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'}`}
                                  >{opt.label}</button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Custom Range</label>
                              <div className="flex flex-wrap gap-3 items-end">
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">From</label>
                                  <input type="date" value={tsOnlyRange.start} onChange={e => setTsOnlyRange({...tsOnlyRange, start: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">To</label>
                                  <input type="date" value={tsOnlyRange.end} onChange={e => setTsOnlyRange({...tsOnlyRange, end: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" />
                                </div>
                                <button onClick={() => setTsOnlyApplied(tsOnlyRange)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">Apply</button>
                                <button onClick={() => { setTsOnlyRange({ start: '', end: '' }); setTsOnlyApplied({ start: '', end: '' }); }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">Clear All</button>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Timesheets table */}
                      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 360px)' }}>
                        <table className="w-full border-collapse text-sm">
                          <thead className="bg-indigo-600 text-white sticky top-0 z-20">
                            <tr>
                              <th className="border border-indigo-700 px-2 py-2 text-center text-xs bg-indigo-600">ID</th>
                              <th className="border border-indigo-700 px-3 py-2 text-left bg-indigo-600">Employee</th>
                              <th className="border border-indigo-700 px-3 py-2 text-left bg-indigo-600">Source</th>
                              <th className="border border-indigo-700 px-3 py-2 text-left bg-indigo-600">Week Ending</th>
                              <th className="border border-indigo-700 px-3 py-2 text-left bg-indigo-600">Project</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Mon</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Tue</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Wed</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Thu</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Fri</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Sat</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Sun</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Total</th>
                              <th className="border border-indigo-700 px-3 py-2 text-center bg-indigo-600">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTs.length === 0 ? (
                              <tr><td colSpan={14} className="text-center py-6 text-gray-400">No timesheets found for selected range</td></tr>
                            ) : (
                              filteredTs.map((ts, idx) => {
                                const user = users.find(u => u.id === ts.userId);
                                const project = projects.find(p => p.id === (ts.projectId ?? user?.projectId));
                                const weekDates = getWeekDates(parseLocalDate(ts.weekStart));
                                const dailyHours = weekDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                                const total = dailyHours.reduce((s, h) => s + h, 0);
                                const fri = weekDates[4];
                                return (
                                  <tr key={ts.id} className={'cursor-pointer ' + (idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50')} onClick={() => openTimesheetModal(ts)}>
                                    <td className="border border-gray-200 px-2 py-2 text-center text-xs text-gray-400 whitespace-nowrap">#{ts.id}</td>
                                    <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{ts.userName}</td>
                                    <td className="border border-gray-200 px-3 py-2">
                                      {ts.source === 'imported'
                                        ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">Email</span>
                                        : ts.source === 'direct'
                                        ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Portal</span>
                                        : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="border border-gray-200 px-3 py-2 text-gray-700 whitespace-nowrap">{fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                                    <td className="border border-gray-200 px-3 py-2 text-indigo-600 text-xs">{project ? `${project.name} (${project.code})` : '—'}</td>
                                    {dailyHours.map((h, i) => (
                                      <td key={i} className="border border-gray-200 px-3 py-2 text-center">{h > 0 ? h.toFixed(1) : <span className="text-gray-300">—</span>}</td>
                                    ))}
                                    <td className="border border-gray-200 px-3 py-2 text-center font-bold text-indigo-600">{total.toFixed(1)}</td>
                                    <td className="border border-gray-200 px-3 py-2 text-center">
                                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ts.status === 'approved' ? 'bg-green-100 text-green-800' : ts.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                        {ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {accountantTab === 'profiles' && (() => {
            const accountantManagedRoles = ['timesheetuser', 'vendormanager'];
            const isTestAccount = (name: string) => { const l = (name || '').toLowerCase().trim(); return l === 'test' || /\b(hotmail|yahoo)\b/.test(l); };
            const allManagedUsers = users
              .filter(u => accountantManagedRoles.includes(u.role))
              .filter(u => !profileTabExcludeTest || !isTestAccount(u.name));
            const groups = allManagedUsers.map(u => {
              const profs = paymentProfiles
                .filter(p => p.userId === u.id)
                .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.profileName.localeCompare(b.profileName));
              const lastUsedById = new Map<number, Invoice>();
              profs.forEach(p => {
                const used = invoices
                  .filter(i => i.userId === u.id && i.paymentProfile?.id === p.id)
                  .sort((a, b) => (b.periodStart || '').localeCompare(a.periodStart || ''))[0];
                if (used) lastUsedById.set(p.id, used);
              });
              return { user: u, profiles: profs, lastUsedById };
            });
            let displayed = groups;
            if (profileTabSearch) {
              const q = profileTabSearch.toLowerCase();
              displayed = displayed.filter(g => g.user.name.toLowerCase().includes(q));
            }
            if (profileTabFilter === 'multiple') displayed = displayed.filter(g => g.profiles.length > 1);
            else if (profileTabFilter === 'unmatched') displayed = displayed.filter(g => g.profiles.length === 0 || g.profiles.some(p => !p.converaBeneficiaryId));
            displayed = displayed.slice().sort((a, b) => a.user.name.localeCompare(b.user.name));
            const counts = {
              all: groups.length,
              multiple: groups.filter(g => g.profiles.length > 1).length,
              unmatched: groups.filter(g => g.profiles.length === 0 || g.profiles.some(p => !p.converaBeneficiaryId)).length,
            };
            return (
              <div className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={profileTabSearch}
                    onChange={e => setProfileTabSearch(e.target.value)}
                    placeholder="Search contractor..."
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 min-w-[200px] focus:ring-2 focus:ring-indigo-500"
                  />
                  {(['all','multiple','unmatched'] as const).map(f => (
                    <button key={f} onClick={() => setProfileTabFilter(f)}
                      className={'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ' + (profileTabFilter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400')}>
                      {f === 'all' ? 'All' : f === 'multiple' ? 'Multiple profiles' : 'Needs benef'}
                      <span className="opacity-70 ml-1">({counts[f]})</span>
                    </button>
                  ))}
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 ml-auto cursor-pointer select-none">
                    <input type="checkbox" checked={profileTabExcludeTest} onChange={e => setProfileTabExcludeTest(e.target.checked)} className="rounded" />
                    Exclude test accounts
                  </label>
                  <button onClick={() => setExpandedProfileUsers(new Set(allManagedUsers.map(u => u.id)))} className="text-xs text-indigo-600 hover:underline">Expand all</button>
                  <button onClick={() => setExpandedProfileUsers(new Set())} className="text-xs text-gray-500 hover:underline">Collapse all</button>
                </div>
                <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Contractor / Profile</th>
                        <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Bank / Acct</th>
                        <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Convera Benef</th>
                        <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-left font-semibold text-gray-600">Last Used</th>
                        <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-2 text-right font-semibold text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {displayed.map(g => {
                        const expanded = expandedProfileUsers.has(g.user.id) || g.profiles.length === 0;
                        const hasUnmatched = g.profiles.some(p => !p.converaBeneficiaryId); // true linkage check (FK), not benef-array lookup
                        return (
                          <Fragment key={g.user.id}>
                            <tr className="bg-indigo-50 hover:bg-indigo-100 cursor-pointer" onClick={() => {
                              const next = new Set(expandedProfileUsers);
                              if (next.has(g.user.id)) next.delete(g.user.id); else next.add(g.user.id);
                              setExpandedProfileUsers(next);
                            }}>
                              <td className="px-4 py-2 font-semibold text-indigo-900" colSpan={5}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                  <span>{g.user.name}</span>
                                  <span className="text-xs text-indigo-600 font-normal">({g.profiles.length})</span>
                                  {g.user.role === 'vendormanager' && (() => {
                                    const team = users.filter(u => u.vendorManagerId === g.user.id);
                                    return (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium uppercase tracking-wide" title={team.map(t => t.name).join(', ') || 'no contractors assigned'}>
                                        Vendor Mgr{team.length > 0 ? ` · ${team.length}` : ''}
                                      </span>
                                    );
                                  })()}
                                  {g.profiles.length === 0 && <span className="text-xs text-amber-700 font-normal ml-2">⚠ No profile</span>}
                                  {g.profiles.length > 0 && hasUnmatched && <span className="text-xs text-amber-700 font-normal ml-2">⚠ Needs benef</span>}
                                </div>
                              </td>
                            </tr>
                            {expanded && g.profiles.map(p => {
                              const isLinked = !!p.converaBeneficiaryId;
                              const benef = isLinked ? converaBeneficiaries.find(b => b.id === p.converaBeneficiaryId) : null;
                              const lastInv = g.lastUsedById.get(p.id);
                              const acctTail = p.iban ? `IBAN ····${p.iban.slice(-4)}` : (p.accountNumber ? `acct ····${p.accountNumber.slice(-4)}` : '—');
                              return (
                                <tr key={p.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 pl-10">
                                    {p.isDefault && <span className="text-amber-500 mr-1" title="Default">★</span>}
                                    <span className="font-medium text-gray-800">{p.profileName}</span>
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-700">
                                    <div className="text-gray-500">{p.bankName || '—'}</div>
                                    <div className="font-mono">{acctTail}</div>
                                  </td>
                                  <td className="px-4 py-2 text-xs">
                                    {!isLinked ? (
                                      <span className="text-amber-600">⚠ Needs benef</span>
                                    ) : benef ? (
                                      <span className="text-green-700">✓ {benef.shortName}</span>
                                    ) : (
                                      <span className="text-gray-500">✓ linked (#{p.converaBeneficiaryId})</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-xs text-gray-600">
                                    {lastInv ? (
                                      <button onClick={() => { setSelectedInvoice(lastInv); setShowInvoiceModal(true); }} className="hover:underline text-indigo-600">
                                        {new Date(lastInv.periodStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} (#{lastInv.id})
                                      </button>
                                    ) : '—'}
                                  </td>
                                  <td className="px-4 py-2 text-right whitespace-nowrap text-xs">
                                    <button onClick={() => {
                                      setEditingProfile(p);
                                      setProfileEditUserId(p.userId);
                                      setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride });
                                      setShowProfileModal(true);
                                    }} className="px-2 py-1 text-indigo-700 hover:underline">Edit</button>
                                    <button onClick={() => { setBeneficiaryOverrideProfileId(p.id); loadConveraBeneficiaries(); }} className="px-2 py-1 text-blue-600 hover:underline">Re-link</button>
                                    <button onClick={() => deletePaymentProfile(p.id, p.profileName)} className="px-2 py-1 text-red-600 hover:underline">Delete</button>
                                  </td>
                                </tr>
                              );
                            })}
                            {expanded && (
                              <tr className="bg-gray-50">
                                <td colSpan={5} className="px-4 py-2 pl-10">
                                  <button onClick={() => {
                                    setEditingProfile(null);
                                    setProfileEditUserId(g.user.id);
                                    setProfileForm(emptyProfileForm());
                                    setShowProfileModal(true);
                                  }} className="text-xs text-indigo-600 hover:underline">+ New profile for {g.user.name}</button>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      {displayed.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No contractors match the current filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

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

                  <div className="px-6 py-3 border-b border-gray-100">
                    <input type="text" value={converaMatchingSearch} onChange={e => setConveraMatchingSearch(e.target.value)}
                      placeholder="Search by contractor, profile name, short name, or IBAN…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>

                  <div className="overflow-y-auto flex-1">
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
                                  <div className="font-mono text-xs text-gray-400 mt-0.5">{profile.iban || profile.accountNumber || '—'}</div>
                                </td>
                                <td className="px-4 py-2.5">
                                  {benef
                                    ? <span className="font-mono text-xs text-gray-700">{benef.shortName}</span>
                                    : <span className="text-amber-600 text-xs font-medium">Not matched</span>}
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
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Payment Import Modal — Convera PDF + Intuit Emails */}
          {showConveraModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => { if (!converaParsing && !converaApplying) { setShowConveraModal(false); setConveraRows([]); setConveraFile(null); setIntuitText(''); setConveraError(''); } }}>
              <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-900">Import Payments</h2>
                    <button onClick={() => { setShowConveraModal(false); setConveraRows([]); setConveraFile(null); setIntuitText(''); setConveraError(''); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
                  </div>

                  {/* Source tabs */}
                  {converaRows.length === 0 && (
                    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-5 w-fit">
                      <button onClick={() => { setConveraTab('quickbooks'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'quickbooks' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>QuickBooks Export</button>
                      <button onClick={() => { setConveraTab('convera'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'convera' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Convera PDF</button>
                      <button onClick={() => { setConveraTab('intuit'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'intuit' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Intuit Emails</button>
                      <button onClick={() => { setConveraTab('beneficiaries'); setConveraError(''); }} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${converaTab === 'beneficiaries' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>Convera Beneficiaries</button>
                    </div>
                  )}

                  {/* Step 1: QuickBooks XLSX export */}
                  {converaRows.length === 0 && converaTab === 'quickbooks' && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Upload the QuickBooks <strong>Transaction Detail by Account</strong> export (.xlsx). Payments are matched by invoice number from the Memo field, falling back to company name + amount.</p>
                      <p className="text-xs text-gray-400 mb-4">In QuickBooks: Reports → Transaction Detail by Account → export to Excel</p>
                      <div className="border-2 border-dashed border-indigo-300 rounded-lg p-6 text-center mb-4">
                        {qbFile ? (
                          <div className="flex items-center justify-center gap-2 text-indigo-700">
                            <FileText className="w-5 h-5" />
                            <span className="text-sm font-medium">{qbFile.name}</span>
                            <button onClick={() => setQbFile(null)} className="text-gray-400 hover:text-red-500 ml-1"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <label className="cursor-pointer">
                            <UploadCloud className="w-10 h-10 text-indigo-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-600">Click to select .xlsx file</p>
                            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => setQbFile(e.target.files?.[0] ?? null)} />
                          </label>
                        )}
                      </div>
                      {converaError && <p className="text-red-600 text-sm mb-3">{converaError}</p>}
                      <div className="flex justify-end">
                        <button onClick={parseQbXlsx} disabled={!qbFile} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
                          <FileText className="w-4 h-4" /> Parse Export
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 1A: Convera PDF upload */}
                  {converaRows.length === 0 && converaTab === 'convera' && (
                    <div>
                      <p className="text-sm text-gray-600 mb-4">Upload the Convera outgoing payment confirmation PDF. Each payment is matched to an invoice by reference number (Re: Inv#).</p>
                      <div className="border-2 border-dashed border-indigo-300 rounded-lg p-6 text-center mb-4">
                        {converaFile ? (
                          <div className="flex items-center justify-center gap-2 text-indigo-700">
                            <FileText className="w-5 h-5" />
                            <span className="text-sm font-medium">{converaFile.name}</span>
                            <button onClick={() => setConveraFile(null)} className="text-gray-400 hover:text-red-500 ml-1"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <label className="cursor-pointer">
                            <UploadCloud className="w-10 h-10 text-indigo-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-600">Click to select PDF</p>
                            <input type="file" accept=".pdf" className="hidden" onChange={e => setConveraFile(e.target.files?.[0] ?? null)} />
                          </label>
                        )}
                      </div>
                      {converaError && <p className="text-red-600 text-sm mb-3">{converaError}</p>}
                      <div className="flex justify-end">
                        <button onClick={parseConveraPdf} disabled={!converaFile || converaParsing} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
                          {converaParsing ? <><Clock className="w-4 h-4 animate-spin" /> Parsing…</> : <><FileText className="w-4 h-4" /> Parse PDF</>}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 1B: Intuit email paste */}
                  {converaRows.length === 0 && converaTab === 'intuit' && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Paste one or more QuickBooks payment confirmation emails below. Payments are matched by company name and amount.</p>
                      <p className="text-xs text-gray-400 mb-3">Each email must include: <em>"payment of $X to COMPANY has been scheduled…paid on Month Nth"</em></p>
                      <textarea
                        value={intuitText}
                        onChange={e => setIntuitText(e.target.value)}
                        rows={10}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 font-mono resize-y"
                        placeholder="Paste QuickBooks payment emails here…"
                      />
                      {converaError && <p className="text-red-600 text-sm mt-2 mb-1">{converaError}</p>}
                      <div className="flex justify-end mt-3">
                        <button onClick={parseIntuitEmails} disabled={!intuitText.trim()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm">
                          <FileText className="w-4 h-4" /> Parse Emails
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Convera Beneficiaries import */}
                  {converaRows.length === 0 && converaTab === 'beneficiaries' && (
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Upload the Convera beneficiaries JSON export. Beneficiaries will be upserted and automatically matched to contractor payment profiles by IBAN (unique) or name prefix.</p>
                      <p className="text-xs text-gray-400 mb-4">In Convera: Beneficiaries &rarr; Export &rarr; JSON format. Re-import anytime to refresh.</p>
                      <div className="border-2 border-dashed border-indigo-300 rounded-lg p-6 text-center mb-4">
                        {beneficiaryImportFile ? (
                          <div className="flex items-center justify-center gap-2 text-indigo-700">
                            <FileText className="w-5 h-5" />
                            <span className="text-sm font-medium">{beneficiaryImportFile.name}</span>
                            <button onClick={() => setBeneficiaryImportFile(null)} className="text-gray-400 hover:text-red-500 ml-1"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <label className="cursor-pointer">
                            <UploadCloud className="w-10 h-10 text-indigo-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-600">Click to select beneficiaries JSON</p>
                            <input type="file" accept=".json" className="hidden" onChange={e => { setBeneficiaryImportFile(e.target.files?.[0] ?? null); setBeneficiaryImportResult(null); }} />
                          </label>
                        )}
                      </div>
                      {beneficiaryImportResult && (
                        <div className="mb-4">
                          <div className="flex gap-4 mb-3">
                            <span className="px-3 py-1 bg-green-100 text-green-800 rounded text-sm font-medium">{beneficiaryImportResult.imported} imported</span>
                            <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded text-sm font-medium">{beneficiaryImportResult.matched} profiles matched</span>
                            {beneficiaryImportResult.unmatched.length > 0 && (
                              <span className="px-3 py-1 bg-amber-100 text-amber-800 rounded text-sm font-medium">{beneficiaryImportResult.unmatched.length} unmatched</span>
                            )}
                          </div>
                          {beneficiaryImportResult.unmatched.length > 0 && (
                            <div className="border border-amber-200 rounded-lg divide-y divide-amber-100 max-h-60 overflow-y-auto">
                              {beneficiaryImportResult.unmatched.map(u => (
                                <div key={u.profileId} className="flex items-center justify-between px-3 py-2 bg-amber-50">
                                  <span className="text-sm text-gray-700">{u.userName}</span>
                                  <button
                                    onClick={() => setBeneficiaryOverrideProfileId(u.profileId)}
                                    className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                                  >Link manually</button>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Manual override picker */}
                          {beneficiaryOverrideProfileId && (() => {
                            const unmatchedEntry = beneficiaryImportResult.unmatched.find(u => u.profileId === beneficiaryOverrideProfileId);
                            const filtered = converaBeneficiaries.filter(b =>
                              beneficiaryOverrideSearch === '' ||
                              b.shortName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()) ||
                              b.beneficiaryName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase())
                            );
                            return (
                              <div className="mt-3 border border-indigo-200 rounded-lg p-3 bg-indigo-50">
                                <p className="text-sm font-medium text-indigo-800 mb-2">Link <strong>{unmatchedEntry?.userName}</strong> to a Convera beneficiary:</p>
                                <input
                                  type="text" value={beneficiaryOverrideSearch}
                                  onChange={e => setBeneficiaryOverrideSearch(e.target.value)}
                                  placeholder="Search by name..." autoFocus
                                  className="w-full px-3 py-1.5 border border-indigo-200 rounded text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                                <div className="max-h-40 overflow-y-auto divide-y divide-indigo-100">
                                  {filtered.slice(0, 20).map(b => (
                                    <button key={b.id} onClick={() => setConveraOverride(beneficiaryOverrideProfileId, b.id)}
                                      className="w-full text-left px-2 py-1.5 hover:bg-indigo-100 text-sm">
                                      <span className="font-mono text-xs text-indigo-600 mr-2">{b.shortName}</span>
                                      <span className="text-gray-600 text-xs">{b.bankAccount}</span>
                                    </button>
                                  ))}
                                </div>
                                <button onClick={() => { setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); }} className="mt-2 text-xs text-gray-500 hover:underline">Cancel</button>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      <div className="flex justify-end">
                        <button
                          onClick={() => beneficiaryImportFile && importConveraBeneficiaries(beneficiaryImportFile)}
                          disabled={!beneficiaryImportFile || beneficiaryImporting}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm"
                        >
                          {beneficiaryImporting ? <><Clock className="w-4 h-4 animate-spin" /> Importing&hellip;</> : <><UploadCloud className="w-4 h-4" /> Import &amp; Match</>}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Review and apply (shared for both sources) */}
                  {converaRows.length > 0 && (() => {
                    const matched      = converaRows.filter(r => r.matchedInvoice);
                    const alreadyPaid  = converaRows.filter(r => r.matchedInvoice?.status === 'paid');
                    const unmatched    = converaRows.filter(r => !r.matchedInvoice);
                    const selectedCount = converaRows.filter(r => r.selected).length;
                    const totalSelected = converaRows.filter(r => r.selected).reduce((s, r) => s + r.amount, 0);
                    const hasInvRefs   = converaRows.some(r => r.invoiceRef);
                    const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-600', submitted: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', paid: 'bg-blue-100 text-blue-700' };
                    return (
                      <div>
                        <div className="flex flex-wrap gap-2 mb-4">
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{converaRows.length} payments</span>
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">{matched.length} matched</span>
                          {alreadyPaid.length > 0 && <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">{alreadyPaid.length} already paid</span>}
                          {unmatched.length > 0 && <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs">{unmatched.length} no match</span>}
                        </div>

                        <div className="flex items-center gap-3 mb-4">
                          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Payment date:</label>
                          <input type="date" value={converaPaidDate} onChange={e => setConveraPaidDate(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400" />
                          {converaRows[0]?.source !== 'convera' && <span className="text-xs text-gray-400">Pre-filled from export</span>}
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
                          <table className="w-full text-sm border-collapse">
                            <thead className="bg-gray-50 text-gray-600">
                              <tr>
                                <th className="px-3 py-2 text-center w-8">
                                  <input type="checkbox"
                                    checked={converaRows.filter(r => r.matchedInvoice && r.matchedInvoice.status !== 'paid').every(r => r.selected)}
                                    onChange={e => setConveraRows(prev => prev.map(r =>
                                      r.matchedInvoice && r.matchedInvoice.status !== 'paid' ? { ...r, selected: e.target.checked } : r
                                    ))}
                                  />
                                </th>
                                <th className="px-3 py-2 text-left">Beneficiary (from payment)</th>
                                <th className="px-3 py-2 text-right">Amount</th>
                                {hasInvRefs && <th className="px-3 py-2 text-left">Inv Ref</th>}
                                <th className="px-3 py-2 text-left">Matched Invoice</th>
                                <th className="px-3 py-2 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {converaRows.map((row, idx) => {
                                const isPaid = row.matchedInvoice?.status === 'paid';
                                const rowBg = !row.matchedInvoice ? 'bg-red-50' : isPaid ? 'bg-blue-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                                return (
                                  <tr key={idx} className={rowBg}>
                                    <td className="px-3 py-2 text-center">
                                      {row.matchedInvoice && !isPaid
                                        ? <input type="checkbox" checked={row.selected} onChange={e => setConveraRows(prev => prev.map((r, i) => i === idx ? { ...r, selected: e.target.checked } : r))} />
                                        : <span className="text-gray-300">—</span>}
                                    </td>
                                    <td className="px-3 py-2 font-medium text-gray-800">{row.beneficiary}</td>
                                    <td className="px-3 py-2 text-right font-mono text-gray-700">${row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    {hasInvRefs && <td className="px-3 py-2 text-xs text-gray-500 font-mono">{row.invoiceRef || '—'}</td>}
                                    <td className="px-3 py-2 text-xs">
                                      {row.matchedInvoice
                                        ? <span className="text-gray-800">{row.matchedInvoice.invoiceNumber} <span className="text-gray-400">· {row.matchedInvoice.userName}</span></span>
                                        : <span className="text-red-500 italic">No match</span>}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      {row.matchedInvoice
                                        ? <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[row.matchedInvoice.status] || ''}`}>{row.matchedInvoice.status}</span>
                                        : <span className="text-gray-300 text-xs">—</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {converaError && <p className="text-red-600 text-sm mb-3">{converaError}</p>}

                        <div className="flex items-center justify-between">
                          <button onClick={() => { setConveraRows([]); setConveraFile(null); setQbFile(null); setIntuitText(''); setConveraError(''); }} className="text-sm text-gray-500 hover:text-gray-700">← Start over</button>
                          <div className="flex items-center gap-3">
                            {selectedCount > 0 && <span className="text-sm text-gray-600">{selectedCount} selected · ${totalSelected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                            <button onClick={applyConveraPayments} disabled={selectedCount === 0 || !converaPaidDate || converaApplying} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                              {converaApplying ? <><Clock className="w-4 h-4 animate-spin" /> Applying…</> : <><CheckCircle className="w-4 h-4" /> Mark {selectedCount} as Paid</>}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Invoice Detail Modal (shared, also used in accountant view) */}
          {showInvoiceModal && selectedInvoice && (() => {
            const inv = selectedInvoice;
            const project = projects.find(p => p.id === inv.projectId);
            const sym = ({ USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' } as Record<string, string>)[inv.currency] || '$';
            const recon = reconcileInvoiceLive(inv, timesheets);
            const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
            return (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={() => { setShowInvoiceModal(false);  }}>
                <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-start z-10">
                    <div>
                      <h2 className="text-xl font-bold text-gray-800 font-mono">{inv.invoiceNumber}</h2>
                      <p className="text-gray-600 text-sm">{inv.userName} · {parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                    </div>
                    <button onClick={() => { setShowInvoiceModal(false);  }} className="text-gray-500 hover:text-gray-700 p-1"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-5">
                      <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span>
                      {project && <span className="text-sm text-indigo-600 font-medium">{project.name} ({project.code})</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
                      <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Period</div><div className="font-medium">{parseLocalDate(inv.periodStart).toLocaleDateString()} – {parseLocalDate(inv.periodEnd).toLocaleDateString()}</div></div>
                      <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Rate</div><div className="font-medium">{inv.rate != null ? `${sym}${inv.rate.toFixed(2)} / hour (${inv.currency})` : `— (${inv.currency})`}</div></div>
                      <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Total Hours</div><div className="font-medium">{inv.totalHours != null ? inv.totalHours.toFixed(2) : recon.timesheetHours != null ? <span>{recon.timesheetHours.toFixed(2)} <span className="text-xs text-gray-400 font-normal">from TS</span></span> : '—'}</div></div>
                      <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Submitted</div><div className="font-medium">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : '—'}</div></div>
                      {inv.payOnDate && (
                        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><div className="text-blue-500 mb-0.5">Pay On Date</div><div className="font-medium text-blue-800">{new Date(inv.payOnDate).toLocaleDateString()}</div></div>
                      )}
                      {inv.paidDate && (
                        <div className="bg-green-50 rounded-lg p-3 border border-green-200"><div className="text-green-600 mb-0.5">Paid Date</div><div className="font-medium text-green-800">{new Date(inv.paidDate).toLocaleDateString()}</div></div>
                      )}
                      {inv.paymentProfile && (
                        <div className={`rounded-lg p-3 border col-span-2 ${paymentMethod(inv) === 'Intuit' ? 'bg-green-50 border-green-200' : 'bg-purple-50 border-purple-200'}`}>
                          <div className={`mb-0.5 text-xs ${paymentMethod(inv) === 'Intuit' ? 'text-green-600' : 'text-purple-600'}`}>Payment Method</div>
                          <div className={`font-bold text-lg ${paymentMethod(inv) === 'Intuit' ? 'text-green-800' : 'text-purple-800'}`}>{paymentMethod(inv)}</div>
                        </div>
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
                            <td className="px-4 py-2 border border-gray-200">W/E {parseLocalDate(line.weekEndingFri).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
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
                    {(() => {
                      const contractorProfiles = paymentProfiles.filter(p => p.userId === inv.userId);
                      const selectedId = inv.paymentProfile?.id ?? 0;
                      const snapshotMissingFromList = inv.paymentProfile && !contractorProfiles.find(p => p.id === selectedId);
                      const accent = inv.paymentProfile ? 'green' : 'amber';
                      const headerText = inv.paymentProfile
                        ? `💳 Payment Details — ${inv.paymentProfile.profileName}`
                        : (contractorProfiles.length > 0 ? '⚠ No payment profile attached — pick one' : '⚠ No payment profile and no saved options for this contractor');
                      return (
                        <div className={`mb-5 border border-${accent}-200 rounded-lg overflow-hidden`}>
                          <div className={`bg-${accent}-50 px-4 py-2 border-b border-${accent}-200`}>
                            <span className={`font-semibold text-${accent}-800 text-sm`}>{headerText}</span>
                          </div>
                          {contractorProfiles.length > 0 && (
                            <div className="px-4 py-3 bg-white border-b border-gray-100 flex items-center gap-2">
                              <label className="text-xs text-gray-600 whitespace-nowrap">Profile:</label>
                              <select
                                value={selectedId || ''}
                                onChange={e => {
                                  const p = contractorProfiles.find(pp => pp.id === Number(e.target.value));
                                  if (p) switchInvoicePaymentProfile(inv.id, p);
                                }}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                              >
                                {!inv.paymentProfile && <option value="">— pick a profile —</option>}
                                {snapshotMissingFromList && inv.paymentProfile && (
                                  <option value={selectedId}>(detached) {inv.paymentProfile.profileName}{inv.paymentProfile.iban ? ` · ···${inv.paymentProfile.iban.slice(-6)}` : ''}</option>
                                )}
                                {contractorProfiles.map(p => (
                                  <option key={p.id} value={p.id}>{p.profileName}{p.iban ? ` · ···${p.iban.slice(-6)}` : ''}</option>
                                ))}
                              </select>
                              {inv.paymentProfile && contractorProfiles.find(p => p.id === selectedId) && (
                                <button
                                  onClick={() => deletePaymentProfile(selectedId, inv.paymentProfile!.profileName)}
                                  className="text-xs px-2 py-1.5 border border-red-300 text-red-600 rounded hover:bg-red-50 whitespace-nowrap"
                                  title="Delete this payment profile from the contractor's list"
                                >Delete</button>
                              )}
                            </div>
                          )}
                          {inv.paymentProfile && (
                            <>
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                              {[['Company Name', inv.paymentProfile.companyName],['Company Address', inv.paymentProfile.companyAddress],['Country', inv.paymentProfile.country],['Bank Name', inv.paymentProfile.bankName],['Bank Address', inv.paymentProfile.bankAddress],['Bank Branch', inv.paymentProfile.bankBranch],['Account Number', inv.paymentProfile.accountNumber],['IBAN', inv.paymentProfile.iban],['SWIFT / BIC', inv.paymentProfile.swift],['Payment Email', inv.paymentProfile.paymentEmail]].filter(([,v]) => v).map(([label, value]) => (
                                <div key={label as string}><span className="text-gray-500">{label}: </span><span className="font-medium text-gray-800 font-mono">{value}</span></div>
                              ))}
                            </div>
                        {/* Convera match */}
                        {(() => {
                          const profile = paymentProfiles.find(p => p.id === inv.paymentProfile?.id);
                          if (!profile) return null;
                          const benef = converaBeneficiaries.find(b => b.id === profile.converaBeneficiaryId);
                          return (
                            <div className="px-4 pb-4">
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-xs font-medium text-gray-500 mb-0.5">Convera Beneficiary</p>
                                    {benef ? (
                                      <div>
                                        <p className="text-sm font-medium text-gray-800">{benef.shortName}</p>
                                        <p className="text-xs text-gray-500">{benef.beneficiaryName}</p>
                                        {profile.converaMatchOverride && <span className="text-xs text-amber-600">&#9889; Manual override</span>}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-amber-600">Not matched</p>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => { setBeneficiaryOverrideProfileId(profile.id); loadConveraBeneficiaries(); }}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
                                  >Change</button>
                                </div>
                                {beneficiaryOverrideProfileId === profile.id && (
                                  <div className="mt-2 border border-indigo-200 rounded-lg p-2 bg-indigo-50">
                                    <input
                                      type="text" value={beneficiaryOverrideSearch}
                                      onChange={e => setBeneficiaryOverrideSearch(e.target.value)}
                                      placeholder="Search beneficiary..." autoFocus
                                      className="w-full px-2 py-1 border border-indigo-200 rounded text-sm mb-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                    />
                                    <div className="max-h-36 overflow-y-auto divide-y divide-indigo-100">
                                      {converaBeneficiaries
                                        .filter(b => !beneficiaryOverrideSearch || b.shortName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()) || b.beneficiaryName.toLowerCase().includes(beneficiaryOverrideSearch.toLowerCase()))
                                        .slice(0, 15)
                                        .map(b => (
                                          <button key={b.id} onClick={() => setConveraOverride(profile.id, b.id)}
                                            className="w-full text-left px-2 py-1 hover:bg-indigo-100 text-xs">
                                            <span className="font-mono text-indigo-600 mr-2">{b.shortName}</span>
                                            <span className="text-gray-500">{b.bankAccount}</span>
                                          </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-1">
                                      {benef && <button onClick={() => setConveraOverride(profile.id, null)} className="text-xs text-red-500 hover:underline">Clear match</button>}
                                      <button onClick={() => { setBeneficiaryOverrideProfileId(null); setBeneficiaryOverrideSearch(''); }} className="text-xs text-gray-500 hover:underline ml-auto">Cancel</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                            </>
                          )}
                        </div>
                      );
                    })()}
                    {inv.notes && <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 mb-4"><span className="font-medium">Notes: </span>{inv.notes}</div>}
                    {inv.reviewedBy && <p className="text-sm text-gray-500 mb-4">Reviewed by {inv.reviewedBy} on {inv.reviewedAt ? new Date(inv.reviewedAt).toLocaleDateString() : '—'}</p>}

                    {/* USD rate override — only for non-USD imported invoices */}
                    {inv.source === 'imported' && inv.currency !== 'USD' && (() => {
                      const historicalRate = invoices
                        .filter(i => i.userId === inv.userId && i.currency === 'USD' && (i.rate ?? 0) > 0 && i.id !== inv.id)
                        .sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0]?.rate ?? null;
                      const rateVal = parseFloat(pendingUsdRate);
                      const previewAmt = rateVal > 0 ? Math.round((inv.totalHours ?? 0) * rateVal * 100) / 100 : null;
                      return (
                        <div className="mb-5 border border-amber-200 rounded-lg overflow-hidden">
                          <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-200">
                            <span className="font-semibold text-amber-800 text-sm">⚠ Invoice extracted in {inv.currency} — set USD rate to approve</span>
                          </div>
                          <div className="p-4 space-y-2">
                            <p className="text-sm text-gray-600">
                              Parsed rate: {inv.currency === 'EUR' ? '€' : inv.currency}{inv.rate?.toFixed(2) ?? '—'}/hr.
                              {historicalRate != null && <span className="ml-1 text-gray-500">Last known USD rate for this contractor: <strong>${historicalRate.toFixed(2)}/hr</strong>.</span>}
                            </p>
                            <div className="flex flex-wrap gap-2 items-center">
                              <span className="text-sm text-gray-600">USD Rate:</span>
                              <div className="flex items-center gap-1">
                                <span className="text-sm text-gray-500">$</span>
                                <input type="number" step="0.01" min="0"
                                  placeholder={historicalRate != null ? String(historicalRate) : 'e.g. 40.00'}
                                  value={pendingUsdRate}
                                  onChange={e => setPendingUsdRate(e.target.value)}
                                  className="w-28 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-400"
                                />
                                <span className="text-sm text-gray-500">/hr</span>
                              </div>
                              {previewAmt != null && <span className="text-sm font-medium text-gray-700">→ ${previewAmt.toFixed(2)} total</span>}
                              <button
                                disabled={!(rateVal > 0)}
                                onClick={() => applyUsdRate(inv, rateVal)}
                                className="px-3 py-1.5 bg-amber-500 text-white rounded text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
                              >Apply USD Rate</button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* PDF Attachment — accountant view (read-only open) */}
                    <div className="mb-5 border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center gap-2">
                        <Paperclip className="w-4 h-4 text-gray-500" />
                        <span className="font-semibold text-gray-700 text-sm">Attachment</span>
                      </div>
                      <div className="p-4">
                        {inv.attachmentPath ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-5 h-5 text-indigo-500 flex-shrink-0" />
                              <span className="text-sm text-gray-700 truncate">Inv# {inv.invoiceNumber}.{inv.attachmentPath!.split('.').pop()}</span>
                            </div>
                            <button onClick={() => openAttachment(inv)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 font-medium flex-shrink-0">
                              <ExternalLink className="w-3.5 h-3.5" /> Open PDF
                            </button>
                          </div>
                        ) : (
                          <div>
                            <p className="text-sm text-gray-400 mb-2">No attachment on file.</p>
                            <label className="flex items-center gap-2 cursor-pointer px-3 py-1.5 border border-dashed border-gray-300 rounded-lg hover:border-indigo-400 hover:bg-indigo-50 transition-colors w-fit">
                              <Paperclip className="w-4 h-4 text-gray-500" />
                              <span className="text-sm text-gray-600">{attachmentUploading ? 'Uploading…' : 'Upload PDF / DOCX'}</span>
                              <input type="file" accept=".pdf,.doc,.docx,.msg" className="hidden"
                                onChange={async e => {
                                  const file = e.target.files?.[0];
                                  if (file) await handleAttachmentUploadForExisting(inv, file);
                                  e.target.value = '';
                                }} />
                            </label>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* ── Timesheet reconciliation section ── */}
                    {(() => {
                      const statusBg: Record<string, string> = {
                        matched:      'bg-green-50 border-green-200',
                        mismatch:     'bg-red-50 border-red-200',
                        unverifiable: 'bg-gray-50 border-gray-200',
                      };
                      const statusText: Record<string, string> = {
                        matched:      'text-green-700',
                        mismatch:     'text-red-700',
                        unverifiable: 'text-gray-500',
                      };
                      const unverifiableLabel = recon.timesheetHours != null && inv.totalHours == null
                        ? '— Hours from timesheets'
                        : '— No timesheets found';
                      const statusLabel: Record<string, string> = {
                        matched:      '✓ Matched',
                        mismatch:     '⚠ Mismatch',
                        unverifiable: unverifiableLabel,
                      };
                      return (
                        <div className={`mb-5 border rounded-lg overflow-hidden ${statusBg[recon.status]}`}>
                          <div className={`px-4 py-2.5 border-b flex items-center justify-between ${statusBg[recon.status]}`} style={{borderColor: 'inherit'}}>
                            <span className={`font-semibold text-sm ${statusText[recon.status]}`}>
                              Timesheets · {statusLabel[recon.status]}
                            </span>
                            {recon.timesheetHours != null && (
                              <span className={`text-sm font-mono ${statusText[recon.status]}`}>
                                {inv.totalHours != null ? `Invoice ${inv.totalHours.toFixed(2)} h · TS ${recon.timesheetHours.toFixed(2)} h` : `TS ${recon.timesheetHours.toFixed(2)} h`}
                                {recon.delta != null && recon.delta !== 0 && (
                                  <span className="ml-2 font-semibold">
                                    ({recon.delta > 0 ? '+' : ''}{recon.delta.toFixed(2)} h)
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          <div className="p-3">
                            {recon.rows.length === 0 ? (
                              <p className="text-sm text-gray-400 py-1">
                                {inv.totalHours == null ? 'No timesheets found to derive hours from.' : `No approved or pending timesheets found for ${inv.userName} covering ${parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`}
                              </p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                                    <th className="text-left pb-1.5 pr-3 font-medium">Week</th>
                                    <th className="text-center pb-1.5 px-2 font-medium">Status</th>
                                    <th className="text-right pb-1.5 font-medium">Hrs in Period</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recon.rows.map(({ ts, hoursInPeriod, weekEnd }) => {
                                    const tsStatusColors: Record<string, string> = {
                                      approved: 'bg-green-100 text-green-700',
                                      pending:  'bg-yellow-100 text-yellow-700',
                                      rejected: 'bg-red-100 text-red-700',
                                    };
                                    return (
                                      <tr key={ts.id} className="border-b border-gray-100 last:border-0">
                                        <td className="py-1.5 pr-3 text-gray-700 font-mono text-xs">
                                          {parseLocalDate(ts.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{parseLocalDate(weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="py-1.5 px-2 text-center">
                                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tsStatusColors[ts.status] || 'bg-gray-100 text-gray-600'}`}>
                                            {ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}
                                          </span>
                                        </td>
                                        <td className={`py-1.5 text-right font-mono font-medium ${hoursInPeriod === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                                          {hoursInPeriod > 0 ? `${hoursInPeriod.toFixed(2)} h` : '—'}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {inv.status === 'submitted' && (
                      <div className="mt-5 space-y-3">
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
                            <select
                              value={pendingPaymentTerms}
                              onChange={e => {
                                setPendingPaymentTerms(e.target.value);
                                if (e.target.value) setPendingPayOnDate(calculatePayOn(inv.periodEnd, e.target.value));
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                            >
                              <option value="">— select —</option>
                              <option value="NET15">NET15</option>
                              <option value="NET30">NET30</option>
                              <option value="NET45">NET45</option>
                              <option value="NET60">NET60</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Pay On Date (optional)</label>
                            <input
                              type="date"
                              value={pendingPayOnDate}
                              onChange={e => setPendingPayOnDate(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                            <select
                              value={pendingPaymentMethod !== '' ? pendingPaymentMethod : paymentMethod(inv)}
                              onChange={async e => {
                                const v = e.target.value;
                                setPendingPaymentMethod(v);
                                // Auto-save so the change persists even if the accountant doesn't click Approve
                                await saveInvoiceEdits(inv.id, { paymentMethod: v });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                            >
                              <option value="Intuit">Intuit</option>
                              <option value="Convera">Convera</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <button onClick={() => handleInvoiceAction(inv.id, 'approved', pendingPayOnDate || undefined, undefined, pendingPaymentMethod || paymentMethod(inv), pendingPaymentTerms || undefined)} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"><CheckCircle className="w-5 h-5" /> Approve</button>
                          <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium"><XCircle className="w-5 h-5" /> Reject</button>
                        </div>
                      </div>
                    )}

                    {/* ── Approved: edit approval details + separate mark-paid panel ── */}
                    {inv.status === 'approved' && (() => {
                      const editPayOn = pendingPayOnDate !== '' ? pendingPayOnDate : (inv.payOnDate || '');
                      const editTerms = pendingPaymentTerms !== '' ? pendingPaymentTerms : (inv.paymentTerms || '');
                      return (
                        <div className="mt-5 space-y-4">
                          {/* Edit panel */}
                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                            <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit Approval Details</p>
                            <div>
                              <label className="block text-xs font-medium text-amber-700 mb-1">Payment Terms</label>
                              <select
                                value={editTerms}
                                onChange={e => {
                                  setPendingPaymentTerms(e.target.value);
                                  if (e.target.value && !editPayOn) setPendingPayOnDate(calculatePayOn(inv.periodEnd, e.target.value));
                                }}
                                className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white"
                              >
                                <option value="">— select —</option>
                                <option value="NET15">NET15</option>
                                <option value="NET30">NET30</option>
                                <option value="NET45">NET45</option>
                                <option value="NET60">NET60</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-amber-700 mb-1">Pay On Date (expected)</label>
                              <input
                                type="date"
                                value={editPayOn}
                                onChange={e => setPendingPayOnDate(e.target.value)}
                                className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-amber-700 mb-1">Payment Method</label>
                              <select
                                value={pendingPaymentMethod !== '' ? pendingPaymentMethod : paymentMethod(inv)}
                                onChange={e => setPendingPaymentMethod(e.target.value)}
                                className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-400 text-sm bg-white"
                              >
                                <option value="Intuit">Intuit</option>
                                <option value="Convera">Convera</option>
                              </select>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  await saveInvoiceEdits(inv.id, { payOnDate: editPayOn, paymentMethod: pendingPaymentMethod || paymentMethod(inv), paymentTerms: editTerms });
                                  setPendingPayOnDate('');
                                  setPendingPaymentMethod('');
                                  setPendingPaymentTerms('');
                                  alert('Changes saved.');
                                }}
                                className="flex-1 flex items-center justify-center gap-2 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium text-sm"
                              >
                                <Save className="w-4 h-4" /> Save Changes
                              </button>
                              <button
                                onClick={async () => {
                                  if (!window.confirm('Change this invoice back to Rejected?')) return;
                                  await saveInvoiceEdits(inv.id, { status: 'rejected' });
                                }}
                                className="flex items-center justify-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-sm border border-red-200"
                              >
                                <XCircle className="w-4 h-4" /> Reject
                              </button>
                            </div>
                          </div>

                          {/* Mark as Paid panel */}
                          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                            <p className="text-sm font-semibold text-blue-800 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Mark as Paid</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-blue-600 mb-1">Pay On Date (confirm)</label>
                                <input
                                  type="date"
                                  value={editPayOn}
                                  onChange={e => setPendingPayOnDate(e.target.value)}
                                  className="w-full px-3 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 text-sm bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-green-700 mb-1">Paid Date (actual) *</label>
                                <input
                                  type="date"
                                  value={pendingPaidDate}
                                  onChange={e => setPendingPaidDate(e.target.value)}
                                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-400 text-sm bg-white"
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                if (!pendingPaidDate) { alert('Please enter the actual Paid Date.'); return; }
                                handleInvoiceAction(inv.id, 'paid', editPayOn || undefined, pendingPaidDate);
                              }}
                              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                            >
                              <DollarSign className="w-4 h-4" /> Confirm Payment
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── Paid: summary only ── */}
                    {inv.status === 'paid' && (inv.payOnDate || inv.paidDate) && (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {inv.payOnDate && (
                          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800 flex items-center gap-2">
                            <Calendar className="w-4 h-4 flex-shrink-0" />
                            <div><div className="text-xs text-blue-500">Pay On Date</div><strong>{new Date(inv.payOnDate).toLocaleDateString()}</strong></div>
                          </div>
                        )}
                        {inv.paidDate && (
                          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            <div><div className="text-xs text-green-600">Paid Date</div><strong>{new Date(inv.paidDate).toLocaleDateString()}</strong></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
        <style>{`@media print { body * { visibility: hidden; } .bg-white.rounded-lg.shadow-md.p-6, .bg-white.rounded-lg.shadow-md.p-6 * { visibility: visible; } .bg-white.rounded-lg.shadow-md.p-6 { position: absolute; left: 0; top: 0; width: 100%; } button { display: none !important; } }`}</style>
        {showTimesheetModal && <TimesheetDetailModal />}
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
              const isDisabled = isUserInactive || currentTimesheet?.status === 'approved';
              return (
                <div key={dateKey} className={'p-4 rounded-lg ' + (entry.isHoliday ? 'bg-red-50 border-2 border-red-200' : 'bg-blue-50')}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-gray-800">{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                        {entry.isHoliday && <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Holiday: {entry.holidayName}</span>}
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
                const isDisabled = isUserInactive || currentTimesheet?.status === 'approved';
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
          ) : !currentTimesheet || currentTimesheet.status !== 'approved' ? (
            <div>
              <button onClick={submitTimesheet} className="w-full mt-6 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2">
                <CheckCircle className="w-5 h-5" /> Submit for Approval
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
          ) : (
            <div className="mt-6 p-4 bg-green-50 border-2 border-green-200 rounded-lg text-center">
              <p className="text-green-800 font-medium">This timesheet has been approved and cannot be modified.</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mt-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
            <h2 className="text-xl font-bold text-gray-800">Timesheet History</h2>
            <button onClick={() => exportTimesheetList(filteredUserTimesheets)} className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
          </div>

          {/* Filters */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5">
            {/* Month quick-select */}
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Quick Select — Month</label>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const now = new Date();
                  return Array.from({ length: 6 }, (_, i) => {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    const monthVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    const start = new Date(d.getFullYear(), d.getMonth(), 1);
                    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                    const isActive = dateRange.start === formatDate(start) && dateRange.end === formatDate(end);
                    return (
                      <button
                        key={monthVal}
                        onClick={() => setDateRange({ start: formatDate(start), end: formatDate(end) })}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${isActive ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'}`}
                      >
                        {label}
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Custom date range */}
            <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-gray-200">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              {(dateRange.start || dateRange.end) && (
                <button onClick={() => setDateRange({start: '', end: ''})} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 underline">Clear</button>
              )}
            </div>
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
                        <span className={'px-2 py-1 rounded-full text-xs font-medium ' + (ts.status === 'approved' ? 'bg-green-100 text-green-800' : ts.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')}>{ts.status.charAt(0).toUpperCase() + ts.status.slice(1)}</span>
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
                              onClick={e => { e.preventDefault(); setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride }); setShowProfileModal(true); }}
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
                                  ? <p className="text-xs font-semibold mt-1 text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1 inline-block">📅 Expected payment: {new Date(inv.payOnDate).toLocaleDateString()}</p>
                                  : <p className="text-xs text-amber-600 mt-0.5">📅 Payment date not yet scheduled</p>
                              )}
                              {inv.status !== 'approved' && inv.payOnDate && <p className="text-xs text-blue-600 mt-0.5 font-medium">📅 Pay on date: {new Date(inv.payOnDate).toLocaleDateString()}</p>}
                              {inv.paidDate && <p className="text-xs text-green-600 mt-0.5 font-medium">✅ Paid: {new Date(inv.paidDate).toLocaleDateString()}</p>}
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
                            onClick={() => { setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault, combinePayments: p.combinePayments, converaBeneficiaryId: p.converaBeneficiaryId, converaMatchOverride: p.converaMatchOverride }); setShowProfileModal(true); }}
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
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-200"><div className="text-blue-500 mb-0.5">Pay On Date</div><div className="font-medium text-blue-800">{new Date(inv.payOnDate).toLocaleDateString()}</div></div>
                    )}
                    {inv.paidDate && (
                      <div className="bg-green-50 rounded-lg p-3 border border-green-200"><div className="text-green-600 mb-0.5">Paid Date</div><div className="font-medium text-green-800">{new Date(inv.paidDate).toLocaleDateString()}</div></div>
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
                          <td className="px-4 py-2 border border-gray-200">W/E {parseLocalDate(line.weekEndingFri).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
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

        {showTimesheetModal && <TimesheetDetailModal />}

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

        {/* Payment Profile Modal */}
        {showProfileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }}>
            <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                <h3 className="text-lg font-bold text-gray-800">{editingProfile ? 'Edit Payment Profile' : 'New Payment Profile'}</h3>
                <button onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Profile Label *</label>
                  <input type="text" value={profileForm.profileName} onChange={e => setProfileForm({...profileForm, profileName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="e.g. My UK Account, US Corp Account" />
                  <p className="text-xs text-gray-400 mt-1">A short name to identify this profile</p>
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">Company Details (as per bank account)</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Full Company Name *</label>
                      <input type="text" value={profileForm.companyName} onChange={e => setProfileForm({...profileForm, companyName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="As per bank account" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Company Address</label>
                      <textarea value={profileForm.companyAddress} onChange={e => setProfileForm({...profileForm, companyAddress: e.target.value})} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="As per bank account" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                      <select
                        value={profileForm.country}
                        onChange={e => setProfileForm({...profileForm, country: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
                      >
                        <option value="">Select country…</option>
                        {WORLD_COUNTRIES.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3">Bank Details</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name *</label>
                      <input type="text" value={profileForm.bankName} onChange={e => setProfileForm({...profileForm, bankName: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="e.g. HSBC, Barclays" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Bank Address</label>
                      <input type="text" value={profileForm.bankAddress} onChange={e => setProfileForm({...profileForm, bankAddress: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Bank branch address" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Bank Branch</label>
                      <input type="text" value={profileForm.bankBranch} onChange={e => setProfileForm({...profileForm, bankBranch: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Branch name or sort code" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Account Number *</label>
                      <input type="text" value={profileForm.accountNumber} onChange={e => setProfileForm({...profileForm, accountNumber: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-mono" placeholder="Bank account number" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">IBAN</label>
                        <input type="text" value={profileForm.iban} onChange={e => setProfileForm({...profileForm, iban: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-mono" placeholder="e.g. GB29 NWBK..." />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">SWIFT / BIC *</label>
                        <input type="text" value={profileForm.swift} onChange={e => setProfileForm({...profileForm, swift: e.target.value.toUpperCase()})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm font-mono" placeholder="e.g. NWBKGB2L" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email Address for Payment Notification</label>
                      <input type="email" value={profileForm.paymentEmail} onChange={e => setProfileForm({...profileForm, paymentEmail: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="payments@yourcompany.com" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="isDefault" checked={profileForm.isDefault} onChange={e => setProfileForm({...profileForm, isDefault: e.target.checked})} className="accent-indigo-600 w-4 h-4" />
                  <label htmlFor="isDefault" className="text-sm text-gray-700 cursor-pointer">Set as default payment profile</label>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={savePaymentProfile} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"><Save className="w-4 h-4" /> Save Profile</button>
                  <button onClick={() => { setShowProfileModal(false); setProfileEditUserId(null); }} className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default TimesheetSystem;
