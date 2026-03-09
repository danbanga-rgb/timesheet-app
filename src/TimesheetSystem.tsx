// ============================================================
// TimesheetSystem.tsx — Supabase-integrated version
// Phase 3 of the Production Deployment Guide
// ============================================================

const ConsolidatedTable = ({ report, parseLocalDate }: { report: { weekEndings: string[]; partialWeeks: Set<string>; employeeRows: { name: string; country: string; project: string; hours: Record<string, number | null>; statuses: Record<string, string>; rowTotal: number }[]; colTotals: Record<string, number>; grandTotal: number }; parseLocalDate: (s: string) => Date }) => {
  const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal } = report;
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Weeks</div><div className="text-2xl font-bold text-blue-600">{weekEndings.length}</div></div>
        <div className="bg-green-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Total Hours</div><div className="text-2xl font-bold text-green-600">{grandTotal.toFixed(1)}h</div></div>
        <div className="bg-purple-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Employees</div><div className="text-2xl font-bold text-purple-600">{employeeRows.length}</div></div>
        <div className="bg-amber-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Avg Hrs/Employee</div><div className="text-2xl font-bold text-amber-600">{employeeRows.length > 0 ? (grandTotal / employeeRows.length).toFixed(1) : 0}h</div></div>
      </div>
      {partialWeeks.size > 0 && (
        <div className="flex items-center gap-2 mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">Partial</span> weeks include only the working days that fall within the selected date range.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm w-full">
          <thead>
            <tr className="bg-green-600 text-white">
              <th className="border border-green-700 px-3 py-2 text-left">Employee</th>
              <th className="border border-green-700 px-3 py-2 text-left">Country</th>
              <th className="border border-green-700 px-3 py-2 text-left">Project</th>
              {weekEndings.map((we: string) => {
                const isPartial = partialWeeks.has(we);
                const weekMon = parseLocalDate(we);
                const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
                return (
                  <th key={we} className={`border border-green-700 px-3 py-2 text-center whitespace-nowrap ${isPartial ? 'bg-amber-600' : ''}`}>
                    <div className="text-xs opacity-80">{isPartial ? 'Partial' : 'W/E'}</div>
                    <div>{weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </th>
                );
              })}
              <th className="border border-green-700 px-3 py-2 text-center bg-green-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {employeeRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="border border-gray-300 px-3 py-2 font-semibold">{row.name}</td>
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
              <td className="border border-green-700 px-3 py-2" colSpan={3}>Total</td>
              {weekEndings.map((we: string) => (
                <td key={we} className={`border border-green-700 px-3 py-2 text-center ${partialWeeks.has(we) ? 'bg-amber-600' : ''}`}>{colTotals[we].toFixed(1)}</td>
              ))}
              <td className="border border-green-700 px-3 py-2 text-center bg-green-700">{grandTotal.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

import { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, CheckCircle, XCircle, LogOut, Users, Mail, FileText, Download, Printer, Plus, Edit2, Trash2, Save, X, Settings, MapPin, DollarSign, Receipt } from 'lucide-react';
import { supabase } from './supabaseClient';

// ─── TypeScript interfaces ────────────────────────────────────────────────────
interface UserProfile {
  id: string;
  username: string;
  name: string;
  role: 'timesheetuser' | 'manager' | 'accountant' | 'admin';
  managerId: string | null;
  email: string;
  country: string;
  region: string;
  projectId: number | null;
  startDate: string | null;
  endDate: string | null;
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
}

interface InvoiceLine {
  weekStart: string;
  weekEndingFri: string;
  hours: number;
  rate: number;
  amount: number;
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
  totalHours: number;
  rate: number;
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
  'CA-Ontario': 'America/Toronto', 'CA-Quebec': 'America/Toronto', 'CA-British Columbia': 'America/Vancouver'
};

const TimesheetSystem = () => {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const holidays2026 = {
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
    ]
  };

  const countries = [
    { code: 'US', name: 'United States', regions: ['California', 'New York', 'Texas', 'Florida'] },
    { code: 'GB', name: 'United Kingdom', regions: ['England', 'Scotland', 'Wales'] },
    { code: 'CA', name: 'Canada', regions: ['Ontario', 'Quebec', 'British Columbia'] }
  ];

  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const timesheetsRef = useRef<Timesheet[]>([]);
  const [accountantTab, setAccountantTab] = useState('weekly');
  const [consolidatedRange, setConsolidatedRange] = useState({ start: '', end: '' });
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [consolidatedMonthPreset, setConsolidatedMonthPreset] = useState('');
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekStart());
  const [timeEntries, setTimeEntries] = useState<Record<string, TimeEntry>>({});
  const [detectedLocation, setDetectedLocation] = useState<{ country: string; region: string; timezone: string } | null>(null);
  const [reminderEmails, setReminderEmails] = useState<ReminderEmail[]>([]);
  const [showReminderLog, setShowReminderLog] = useState(false);
  const [reportWeek, setReportWeek] = useState(getCurrentWeekStart());
  const [adminView, setAdminView] = useState('users');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [userForm, setUserForm] = useState<UserForm>({
    email: '', password: '', name: '', role: 'timesheetuser', manager_id: null, country: 'US', region: '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: ''
  });
  const [projectForm, setProjectForm] = useState<ProjectForm>({
    name: '', code: '', status: 'active', description: ''
  });
  const [viewMode, setViewMode] = useState('form');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedTimesheetForView, setSelectedTimesheetForView] = useState<Timesheet | null>(null);
  const [showTimesheetModal, setShowTimesheetModal] = useState(false);
  const [selectedTimesheetIds, setSelectedTimesheetIds] = useState<number[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentProfiles, setPaymentProfiles] = useState<PaymentProfile[]>([]);
  const [userTab, setUserTab] = useState<'timesheet' | 'invoices' | 'payment'>('timesheet');
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
  const [invoiceDateRange, setInvoiceDateRange] = useState({ start: '', end: '' });
  const [invoicePayDateRange, setInvoicePayDateRange] = useState({ start: '', end: '' });
  const [invoicePaidDateRange, setInvoicePaidDateRange] = useState({ start: '', end: '' });
  const [pendingPayOnDate, setPendingPayOnDate] = useState('');   // expected pay on date (set on approve or anytime)
  const [pendingPaidDate, setPendingPaidDate] = useState('');     // actual paid date (set when marking paid)
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PaymentProfile | null>(null);
  const emptyProfileForm = (): Omit<PaymentProfile, 'id' | 'userId'> => ({
    profileName: '', companyName: '', companyAddress: '', country: '', bankName: '',
    bankAddress: '', bankBranch: '', accountNumber: '', iban: '', swift: '', paymentEmail: '', isDefault: false,
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
        await loadProfileAndData(session.user.id);
      } else if (event === 'SIGNED_OUT') {
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

      if (normalisedProfile.role === 'timesheetuser') {
        loadTimesheetForWeek(normalisedProfile.id, getCurrentWeekStart(), timesheetsRef.current);
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    const { data } = await supabase.from('profiles').select('*').order('name');
    if (data) setUsers(data.map(normaliseProfile));
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
    };
  }

  function normaliseTimesheet(t: Record<string, unknown>): Timesheet {
    return {
      id: t.id as number,
      userId: t.user_id as string,
      userName: t.user_name as string,
      projectId: (t.project_id as number) || null,
      weekStart: (t.week_start as string).split('T')[0],
      entries: (t.entries as Record<string, TimeEntry>) || {},
      status: t.status as Timesheet['status'],
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

  function formatDate(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getWeekDates(startDate: Date): Date[] {
    // startDate is Monday; returns Mon–Fri working days
    const dates: Date[] = [];
    for (let i = 0; i < 5; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);
      dates.push(date);
    }
    return dates;
  }

  function detectUserLocation() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let detectedCountry = 'US', detectedRegion = '';
    if (timezone.includes('America/Los_Angeles')) { detectedCountry = 'US'; detectedRegion = 'California'; }
    else if (timezone.includes('America/New_York')) { detectedCountry = 'US'; detectedRegion = 'New York'; }
    else if (timezone.includes('Europe/London')) { detectedCountry = 'GB'; detectedRegion = 'England'; }
    else if (timezone.includes('America/Toronto')) { detectedCountry = 'CA'; detectedRegion = 'Ontario'; }
    setDetectedLocation({ country: detectedCountry, region: detectedRegion, timezone });
  }

  function getUserLocalTime(user: UserProfile): Date {
    const tz = tzMap[user.country + '-' + user.region] || 'America/New_York';
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
    return (holidays2026[country as keyof typeof holidays2026] || []).find((h: { date: string; name: string }) => h.date === dateStr);
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
    } else {
      const entries: Record<string, TimeEntry> = {};
      getWeekDates(weekStart).forEach(date => {
        const dateKey = formatDate(date);
        const holiday = user && isHoliday(date, user.country);
        const weekend = isWeekend(date);
        entries[dateKey] = {
          hours: (!holiday && !weekend) ? '8' : '0',
          isHoliday: holiday || undefined,
          holidayName: holiday?.name,
          isWeekend: weekend
        };
      });
      setTimeEntries(entries);
    }
  };

  const handleTimeEntry = (date: string, hours: string) => {
    setTimeEntries(prev => ({ ...prev, [date]: { ...prev[date], hours } }));
  };

  const updateUserProject = async (projectId: string) => {
    const pid = projectId ? parseInt(projectId) : null;
    await supabase.from('profiles').update({ project_id: pid }).eq('id', currentUser!.id);
    setCurrentUser({ ...currentUser!, projectId: pid });
    setUsers(users.map(u => u.id === currentUser!.id ? { ...u, projectId: pid } : u));
  };

  const submitTimesheet = async () => {
    if (!currentUser!.projectId) {
      alert('Please select a project before submitting your timesheet.');
      return;
    }
    const weekKey = formatDate(selectedWeek);
    const { error } = await supabase.from('timesheets').upsert({
      user_id: currentUser!.id,
      user_name: currentUser!.name,
      project_id: currentUser!.projectId,
      week_start: weekKey,
      entries: timeEntries,
      status: 'pending',
      submitted_at: new Date().toISOString(),
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
  const openUserModal = (user?: UserProfile) => {
    if (user) {
      setEditingUser(user ?? null);
      setUserForm({ email: user.email, password: '', name: user.name, role: user.role, manager_id: user.managerId, country: user.country, region: user.region, project_id: user.projectId, start_date: user.startDate || '', end_date: user.endDate || '' });
    } else {
      setEditingUser(null);
      setUserForm({ email: '', password: '', name: '', role: 'timesheetuser', manager_id: null, country: detectedLocation?.country || 'US', region: detectedLocation?.region || '', project_id: null, start_date: new Date().toISOString().split('T')[0], end_date: '' });
    }
    setShowUserModal(true);
  };

  const saveUser = async () => {
    if (!userForm.name || !userForm.email || !userForm.country) {
      alert('Please fill in all required fields'); return;
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
      };
      const { error } = await supabase.from('profiles').update(updates).eq('id', editingUser.id);
      if (error) { alert('Error updating user: ' + error.message); return; }
      await fetchUsers();
      setShowUserModal(false);
      setEditingUser(null);
    } else {
      // Create new user via signUp — works with anon key
      if (!userForm.password) { alert('Password is required for new users'); return; }
      if (userForm.password.length < 6) { alert('Password must be at least 6 characters'); return; }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: userForm.email,
        password: userForm.password,
        options: {
          data: { name: userForm.name } // stored in auth.users metadata
        }
      });

      if (signUpError) { alert('Error creating user: ' + signUpError.message); return; }
      if (!signUpData.user) { alert('User creation failed — no user returned.'); return; }

      // Insert profile row
      const { error: profileError } = await supabase.from('profiles').insert({
        id: signUpData.user.id,
        username: userForm.email.split('@')[0],
        name: userForm.name,
        role: userForm.role,
        email: userForm.email,
        country: userForm.country,
        region: userForm.region,
        manager_id: userForm.manager_id,
        project_id: userForm.project_id,
        start_date: userForm.start_date || null,
        end_date: userForm.end_date || null,
      });

      if (profileError) { alert('User auth created but profile failed: ' + profileError.message); return; }

      alert(`User "${userForm.name}" created successfully! They can now log in with their email and password.`);
      await fetchUsers();
      setShowUserModal(false);
      setEditingUser(null);
    }
  };

  const resetUserPassword = async (user: UserProfile) => {
    if (!window.confirm(`Send a password reset email to ${user.email}?`)) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: window.location.origin
    });
    if (error) { alert('Error sending reset email: ' + error.message); return; }
    alert(`Password reset email sent to ${user.email}`);
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
      totalHours: r.total_hours as number,
      rate: r.rate as number,
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
      const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
      return weekMon <= endD && weekFri >= startD;
    });
    return userTimesheets
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(ts => {
        const weekMon = parseLocalDate(ts.weekStart);
        const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
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

    const lines = buildInvoiceLines(currentUser!.id, invoiceMonth.start, invoiceMonth.end, rate);
    if (lines.length === 0) { alert('No approved timesheets found in this period.'); return; }

    const totalHours = lines.reduce((s, l) => s + l.hours, 0);
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

    const { error } = await supabase.from('invoices').insert(payload);
    if (error) { alert('Error submitting invoice: ' + error.message); return; }
    await fetchInvoices();
    setInvoiceView('list');
    setInvoiceRate('');
    setInvoiceNotes('');
    setInvoiceNumber('');
    setSelectedPaymentProfileId(null);
    alert('Invoice submitted successfully!');
  };

  const deleteInvoice = async (invoiceId: number) => {
    if (!window.confirm('Delete this rejected invoice? This cannot be undone.')) return;
    const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
    if (error) { alert('Error deleting invoice: ' + error.message); return; }
    await fetchInvoices();
  };

  const handleInvoiceAction = async (invoiceId: number, status: 'approved' | 'rejected' | 'paid', payOnDate?: string, paidDate?: string) => {
    const update: Record<string, unknown> = {
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: currentUser!.name,
    };
    if (payOnDate !== undefined) update.pay_on_date = payOnDate || null;
    if (status === 'paid' && paidDate) update.paid_date = paidDate;
    const { error } = await supabase.from('invoices').update(update).eq('id', invoiceId);
    if (error) { alert('Error updating invoice: ' + error.message); return; }
    await fetchInvoices();
    setShowInvoiceModal(false);
    setPendingPayOnDate('');
    setPendingPaidDate('');
  };

  const savePaymentProfile = async () => {
    if (!profileForm.profileName || !profileForm.companyName || !profileForm.bankName || !profileForm.accountNumber) {
      alert('Please fill in Profile Name, Company Name, Bank Name and Account Number.'); return;
    }
    const payload = {
      user_id: currentUser!.id,
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
    // If marked default, unset others
    if (profileForm.isDefault && editingProfile) {
      await supabase.from('payment_profiles').update({ is_default: false }).eq('user_id', currentUser!.id).neq('id', editingProfile.id);
    } else if (profileForm.isDefault) {
      const { data: last } = await supabase.from('payment_profiles').select('id').eq('user_id', currentUser!.id).order('id', { ascending: false }).limit(1);
      if (last && last[0]) await supabase.from('payment_profiles').update({ is_default: false }).eq('user_id', currentUser!.id).neq('id', last[0].id);
    }
    await fetchPaymentProfiles();
    setShowProfileModal(false);
    setEditingProfile(null);
    setProfileForm(emptyProfileForm());
  };

  const deletePaymentProfile = async (profileId: number) => {
    if (!window.confirm('Delete this payment profile?')) return;
    const { error } = await supabase.from('payment_profiles').delete().eq('id', profileId);
    if (error) { alert('Error: ' + error.message); return; }
    await fetchPaymentProfiles();
  };

  const exportInvoicesCSV = (list: Invoice[]) => {
    const headers = [
      'Invoice No','Employee','Project','Period Start','Period End',
      'Total Hours','Rate','Total Amount','Currency','Status','Submitted','Pay On Date','Paid Date',
      'Company Name','Company Address','Country',
      'Bank Name','Bank Address','Bank Branch',
      'Account Number','IBAN','SWIFT/BIC','Payment Email'
    ];
    let csv = headers.join(',') + '\n';
    list.forEach(inv => {
      const project = projects.find(p => p.id === inv.projectId);
      const pp = inv.paymentProfile;
      const row = [
        `"${inv.invoiceNumber}"`,
        `"${inv.userName}"`,
        `"${project?.name || 'N/A'}"`,
        `"${inv.periodStart}"`,
        `"${inv.periodEnd}"`,
        inv.totalHours.toFixed(2),
        inv.rate,
        inv.totalAmount.toFixed(2),
        `"${inv.currency}"`,
        `"${inv.status}"`,
        `"${inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : ''}"`,
        `"${inv.payOnDate ? new Date(inv.payOnDate).toLocaleDateString() : ''}"`,
        `"${inv.paidDate ? new Date(inv.paidDate).toLocaleDateString() : ''}"`,
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
    getWeekDates(selectedWeek).forEach((date, i) => {
      const curKey = formatDate(date);
      const prevKey = formatDate(getWeekDates(prevWeek)[i]);
      const e = prev.entries[prevKey];
      const holiday = isHoliday(date, currentUser!.country);
      const weekend = isWeekend(date);
      const raw = e ? (typeof e === 'object' ? e.hours : e) : '0';
      newEntries[curKey] = {
        hours: (holiday || weekend) ? '0' : String(raw != null ? raw : '0'),
        isHoliday: holiday || undefined,
        holidayName: holiday ? holiday.name : undefined,
        isWeekend: weekend
      };
    });
    setTimeEntries(newEntries);
    alert('Copied from week of ' + prevWeek.toLocaleDateString());
  };

  // ─── REPORT / CSV ─────────────────────────────────────────────────────────
  const generateReport = () => {
    const weekKey = formatDate(reportWeek);
    const weekTimesheets = timesheets.filter(t => t.weekStart === weekKey);
    return users.filter(u => u.role === 'timesheetuser').map(user => {
      const timesheet = weekTimesheets.find(t => t.userId === user.id);
      const entries = timesheet ? timesheet.entries : {};
      const project = timesheet ? projects.find(p => p.id === timesheet.projectId) : null;
      const dailyHours = getWeekDates(reportWeek).map(date => parseFloat(entries[formatDate(date)]?.hours || '0'));
      return { name: user.name, country: user.country, project: project ? `${project.name} (${project.code})` : 'Not Assigned', dailyHours, total: dailyHours.reduce((s, h) => s + h, 0), status: timesheet ? timesheet.status : 'not submitted' };
    });
  };

  const downloadCSV = () => {
    const reportData = generateReport();
    const weekDates = getWeekDates(reportWeek);
    let csv = 'Employee Name,Country,Project,';
    weekDates.forEach(d => { csv += `"${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}",`; });
    csv += 'Total Hours,Status\n';
    reportData.forEach(row => {
      csv += `"${row.name}","${row.country}","${row.project}",`;
      row.dailyHours.forEach(h => { csv += h + ','; });
      csv += `${row.total},"${row.status}"\n`;
    });
    const grandTotal = reportData.reduce((s, r) => s + r.total, 0);
    csv += `\n"Grand Total","","",`; weekDates.forEach(() => { csv += ','; }); csv += `${grandTotal},\n`;
    triggerDownload(csv, `timesheet_report_${formatDate(reportWeek)}.csv`);
  };

  const exportTimesheetList = (filtered: Timesheet[]) => {
    let csv = 'Employee Name,Week Start,Project,Mon,Tue,Wed,Thu,Fri,Total Hours,Status,Submitted Date\n';
    filtered.forEach(ts => {
      const project = projects.find(p => p.id === ts.projectId);
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
    const project = projects.find(p => p.id === selectedTimesheetForView.projectId);
    const user = users.find(u => u.id === selectedTimesheetForView.userId);
    const weekDates = getWeekDates(parseLocalDate(selectedTimesheetForView.weekStart));
    const dailyData = weekDates.map(date => {
      const dateKey = formatDate(date);
      const entry = selectedTimesheetForView.entries[dateKey];
      return { date, dateKey, dayName: date.toLocaleDateString('en-US', { weekday: 'long' }), hours: parseFloat(entry?.hours || '0'), holiday: entry?.isHoliday, holidayName: entry?.holidayName, weekend: entry?.isWeekend };
    });
    const totalHours = dailyData.reduce((s, d) => s + d.hours, 0);

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={closeTimesheetModal}>
        <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="sticky top-0 bg-white border-b p-6 z-10">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Timesheet Details</h2>
                <div className="mt-2 space-y-1">
                  <p className="text-gray-600"><span className="font-medium">Employee:</span> {selectedTimesheetForView.userName}</p>
                  <p className="text-gray-600"><span className="font-medium">Week:</span> {parseLocalDate(selectedTimesheetForView.weekStart).toLocaleDateString()} – {weekDates[4].toLocaleDateString()}</p>
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
            {currentUser?.role === 'manager' && selectedTimesheetForView.status === 'pending' && (
              <div className="mt-6 flex gap-3">
                <button onClick={async () => { await handleApproval(selectedTimesheetForView.id, 'approved'); closeTimesheetModal(); alert('Timesheet approved!'); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium">
                  <CheckCircle className="w-5 h-5" /> Approve Timesheet
                </button>
                <button onClick={async () => { await handleApproval(selectedTimesheetForView.id, 'rejected'); closeTimesheetModal(); alert('Timesheet rejected!'); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">
                  <XCircle className="w-5 h-5" /> Reject Timesheet
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
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center">
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
              <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Total Users</p><p className="text-2xl font-bold text-blue-600">{users.length}</p></div>
              <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Active Projects</p><p className="text-2xl font-bold text-green-600">{projects.filter(p => p.status === 'active').length}</p></div>
              <div className="bg-purple-50 p-4 rounded-lg"><p className="text-sm text-gray-600">Timesheets Submitted</p><p className="text-2xl font-bold text-purple-600">{timesheets.length}</p></div>
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
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">Users ({users.length})</h2>
                <button onClick={() => openUserModal()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Plus className="w-4 h-4" /> Add User</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Location</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Start Date</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">End Date</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Manager</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-800">{user.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={'px-2 py-1 rounded-full text-xs font-medium ' + (user.role === 'admin' ? 'bg-purple-100 text-purple-800' : user.role === 'manager' ? 'bg-blue-100 text-blue-800' : user.role === 'accountant' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800')}>
                            {user.role === 'timesheetuser' ? 'TimesheetUser' : user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600"><div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{user.country}{user.region ? ', ' + user.region : ''}</div></td>
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
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => openUserModal(user)} className="p-1 text-indigo-600 hover:text-indigo-800" title="Edit"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => resetUserPassword(user)} className="p-1 text-amber-600 hover:text-amber-800" title="Reset Password"><Mail className="w-4 h-4" /></button>
                            <button onClick={() => deleteUser(user.id)} className="p-1 text-red-600 hover:text-red-800" title="Delete"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {adminView === 'projects' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-6">
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
            const allProjects = projects;

            const exportAllocations = () => {
              let csv = 'Project,Project Code,Status,Employee Name,Email,Country,Region,Start Date,End Date,Active\n';
              allProjects.forEach(project => {
                const allocated = timesheetUsers.filter(u => u.projectId === project.id);
                if (allocated.length === 0) {
                  csv += `"${project.name}","${project.code}","${project.status}","(no users)","","","","","",""\n`;
                } else {
                  allocated.forEach(user => {
                    const isInactive = !!(user.endDate && new Date() > parseLocalDate(user.endDate));
                    csv += `"${project.name}","${project.code}","${project.status}","${user.name}","${user.email}","${user.country}","${user.region || ''}","${user.startDate || ''}","${user.endDate || ''}","${isInactive ? 'No' : 'Yes'}"\n`;
                  });
                }
              });
              // Unallocated users
              const unallocated = timesheetUsers.filter(u => !u.projectId);
              unallocated.forEach(user => {
                const isInactive = !!(user.endDate && new Date() > parseLocalDate(user.endDate));
                csv += `"(No Project)","","","${user.name}","${user.email}","${user.country}","${user.region || ''}","${user.startDate || ''}","${user.endDate || ''}","${isInactive ? 'No' : 'Yes'}"\n`;
              });
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = 'project_allocations_' + new Date().toISOString().split('T')[0] + '.csv';
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            };

            return (
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">Project Allocations</h2>
                    <p className="text-sm text-gray-500 mt-1">All timesheet users grouped by assigned project</p>
                  </div>
                  <button onClick={exportAllocations} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                </div>

                {allProjects.map(project => {
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
                                    <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{user.country}{user.region ? ', ' + user.region : ''}</div>
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

                {/* Unallocated users */}
                {(() => {
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
                                  <div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{user.country}{user.region ? ', ' + user.region : ''}</div>
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

          {/* User Modal */}
          {showUserModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-gray-800">{editingUser ? 'Edit User' : 'Add New User'}</h3>
                    <button onClick={() => setShowUserModal(false)} className="text-gray-500 hover:text-gray-700"><X className="w-6 h-6" /></button>
                  </div>
                  <div className="space-y-4">
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label><input type="text" value={userForm.name} onChange={e => setUserForm({...userForm, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="John Doe" /></div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label><input type="email" value={userForm.email} onChange={e => setUserForm({...userForm, email: e.target.value})} disabled={!!editingUser} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100" placeholder="john@company.com" /></div>
                    {!editingUser ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                        <input type="password" value={userForm.password} onChange={e => setUserForm({...userForm, password: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="Min. 6 characters" />
                      </div>
                    ) : (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-sm text-amber-800 font-medium mb-2">Password Reset</p>
                        <p className="text-xs text-amber-700 mb-3">Send a password reset link to the user's email address.</p>
                        <button
                          onClick={() => { setShowUserModal(false); resetUserPassword(editingUser!); }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm"
                        >
                          <Mail className="w-4 h-4" /> Send Password Reset Email
                        </button>
                      </div>
                    )}
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                      <select value={userForm.role} onChange={e => setUserForm({...userForm, role: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        <option value="timesheetuser">TimesheetUser</option><option value="manager">Manager</option><option value="accountant">Accountant</option><option value="admin">Admin</option>
                      </select>
                    </div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Country *</label>
                      <select value={userForm.country} onChange={e => setUserForm({...userForm, country: e.target.value, region: ''})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                    </div>
                    <div><label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
                      <select value={userForm.region} onChange={e => setUserForm({...userForm, region: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                        <option value="">Select Region</option>
                        {countries.find(c => c.code === userForm.country)?.regions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    {userForm.role === 'timesheetuser' && (
                      <>
                        <div><label className="block text-sm font-medium text-gray-700 mb-1">Manager</label>
                          <select value={userForm.manager_id || ''} onChange={e => setUserForm({...userForm, manager_id: e.target.value || null})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">Select Manager</option>
                            {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>
                        <div><label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
                          <select value={userForm.project_id || ''} onChange={e => setUserForm({...userForm, project_id: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500">
                            <option value="">Select Project</option>
                            {projects.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
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
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center">
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
              <button onClick={() => setViewMode('cards')} className={'flex-1 px-6 py-4 font-medium ' + (viewMode === 'cards' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>Pending Approvals ({pendingTimesheets.filter(t => managedUsers.some(u => u.id === t.userId)).length})</button>
              <button onClick={() => setViewMode('table')} className={'flex-1 px-6 py-4 font-medium ' + (viewMode === 'table' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>All Timesheets (Table View)</button>
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
                    const project = projects.find(p => p.id === timesheet.projectId);
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
          ) : (
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">All Team Timesheets</h2>
                <div className="flex gap-2">
                  {selectedTimesheetIds.length > 0 && (
                    <>
                      <button onClick={() => bulkApproveTimesheets('approved')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"><CheckCircle className="w-4 h-4" /> Approve Selected ({selectedTimesheetIds.length})</button>
                      <button onClick={() => bulkApproveTimesheets('rejected')} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"><XCircle className="w-4 h-4" /> Reject Selected ({selectedTimesheetIds.length})</button>
                    </>
                  )}
                  <button onClick={() => exportTimesheetList(filteredTimesheets)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Download className="w-4 h-4" /> Export CSV</button>
                </div>
              </div>
              <div className="mb-4 flex gap-4 items-end">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label><input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
                <button onClick={() => setDateRange({start: '', end: ''})} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Clear</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead className="bg-indigo-600 text-white">
                    <tr>
                      <th className="border border-indigo-700 px-4 py-3"><input type="checkbox" checked={selectedTimesheetIds.length > 0 && selectedTimesheetIds.length === filteredTimesheets.filter(t => t.status === 'pending').length} onChange={() => toggleSelectAll(filteredTimesheets)} className="w-4 h-4 cursor-pointer" /></th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Employee</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Week Start</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Project</th>
                      {['Mon','Tue','Wed','Thu','Fri'].map(d => <th key={d} className="border border-indigo-700 px-4 py-3 text-center">{d}</th>)}
                      <th className="border border-indigo-700 px-4 py-3 text-center">Total</th>
                      <th className="border border-indigo-700 px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTimesheets.length === 0 ? (
                      <tr><td colSpan={11} className="text-center py-8 text-gray-500">No timesheets found</td></tr>
                    ) : filteredTimesheets.map((ts, idx) => {
                      const project = projects.find(p => p.id === ts.projectId);
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
          )}
          {showTimesheetModal && <TimesheetDetailModal />}
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

      // Include any week (Mon–Fri) that overlaps the range
      const inRange = timesheets.filter(t => {
        const weekMon = parseLocalDate(t.weekStart);
        const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
        return weekMon <= endD && weekFri >= startD;
      });

      const weekEndings = [...new Set(inRange.map(t => t.weekStart))].sort();
      const partialWeeks = new Set<string>();

      // A week is partial if its Monday or Friday falls outside the range
      weekEndings.forEach(we => {
        const weekMon = parseLocalDate(we);
        const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
        if (weekMon < startD || weekFri > endD) partialWeeks.add(we);
      });

      const timesheetUsers = users.filter(u => u.role === 'timesheetuser');
      const employeeRows = timesheetUsers.map(user => {
        const hours: Record<string, number | null> = {}, statuses: Record<string, string> = {};
        let rowTotal = 0;
        weekEndings.forEach(we => {
          const ts = inRange.find(t => t.userId === user.id && t.weekStart === we);
          if (ts) {
            // Sum only the days that fall within the applied range
            let h = 0;
            Object.entries(ts.entries).forEach(([dateKey, entry]) => {
              const d = parseLocalDate(dateKey);
              if (d >= startD && d <= endD) h += parseFloat((entry as TimeEntry)?.hours || '0');
            });
            hours[we] = h; statuses[we] = ts.status; rowTotal += h;
          } else { hours[we] = null; statuses[we] = 'not submitted'; }
        });
        const project = projects.find(p => p.id === user.projectId);
        return { name: user.name, country: user.country, project: project ? `${project.name} (${project.code})` : 'Not Assigned', hours, statuses, rowTotal };
      });

      const colTotals: Record<string, number> = {};
      weekEndings.forEach(we => { colTotals[we] = employeeRows.reduce((s, r) => s + (r.hours[we] || 0), 0); });
      return { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal: employeeRows.reduce((s, r) => s + r.rowTotal, 0) };
    };

    const consolidatedReport = generateConsolidatedReport();

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center">
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
              <button onClick={() => setAccountantTab('weekly')} className={'flex-1 px-6 py-4 font-medium ' + (accountantTab === 'weekly' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>Weekly Report</button>
              <button onClick={() => setAccountantTab('consolidated')} className={'flex-1 px-6 py-4 font-medium ' + (accountantTab === 'consolidated' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>Consolidated Report</button>
              <button onClick={() => setAccountantTab('invoices')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (accountantTab === 'invoices' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
                <Receipt className="w-4 h-4" /> Invoices
                {invoices.filter(i => i.status === 'submitted').length > 0 && (
                  <span className="ml-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold">{invoices.filter(i => i.status === 'submitted').length}</span>
                )}
              </button>
            </div>
          </div>

          {accountantTab === 'weekly' && (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><FileText className="w-6 h-6" /> Weekly Timesheet Report</h2>
                <div className="flex gap-2">
                  <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"><Download className="w-4 h-4" /> Download CSV</button>
                  <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Printer className="w-4 h-4" /> Print</button>
                </div>
              </div>
              <div className="flex justify-between items-center mb-6 p-4 bg-gray-50 rounded-lg">
                <button onClick={() => changeReportWeek(-1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">← Previous Week</button>
                <div className="text-center">
                  <h3 className="text-lg font-semibold text-gray-800">Week of {reportWeek.toLocaleDateString()}</h3>
                  <p className="text-sm text-gray-600">{weekDates[0].toLocaleDateString()} – {weekDates[4].toLocaleDateString()}</p>
                </div>
                <button onClick={() => changeReportWeek(1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Next Week →</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-indigo-600 text-white">
                      <th className="border border-indigo-700 px-4 py-3 text-left">Employee</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Country</th>
                      <th className="border border-indigo-700 px-4 py-3 text-left">Project</th>
                      {weekDates.map((d, i) => <th key={i} className="border border-indigo-700 px-4 py-3 text-center"><div>{d.toLocaleDateString('en-US', { weekday: 'short' })}</div><div className="text-xs font-normal">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div></th>)}
                      <th className="border border-indigo-700 px-4 py-3 text-center">Total</th>
                      <th className="border border-indigo-700 px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="border border-gray-300 px-4 py-3 font-medium">{row.name}</td>
                        <td className="border border-gray-300 px-4 py-3 text-gray-600"><div className="flex items-center gap-1"><MapPin className="w-3 h-3" />{row.country}</div></td>
                        <td className="border border-gray-300 px-4 py-3 text-sm text-indigo-600">{row.project}</td>
                        {row.dailyHours.map((h, i) => <td key={i} className="border border-gray-300 px-4 py-3 text-center"><span className={h > 0 ? 'font-semibold' : 'text-gray-400'}>{h > 0 ? h.toFixed(1) : '-'}</span></td>)}
                        <td className="border border-gray-300 px-4 py-3 text-center font-bold text-indigo-600">{row.total.toFixed(1)}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center"><span className={'inline-block px-3 py-1 rounded-full text-xs font-medium ' + (row.status === 'approved' ? 'bg-green-100 text-green-800' : row.status === 'rejected' ? 'bg-red-100 text-red-800' : row.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600')}>{row.status === 'not submitted' ? 'Not Submitted' : row.status.charAt(0).toUpperCase() + row.status.slice(1)}</span></td>
                      </tr>
                    ))}
                    <tr className="bg-indigo-50 font-bold">
                      <td className="border border-gray-300 px-4 py-3 text-gray-800" colSpan={3}>TOTAL</td>
                      {weekDates.map((_, i) => <td key={i} className="border border-gray-300 px-4 py-3 text-center">{reportData.reduce((s, r) => s + r.dailyHours[i], 0).toFixed(1)}</td>)}
                      <td className="border border-gray-300 px-4 py-3 text-center text-indigo-600 text-lg">{grandTotal.toFixed(1)}</td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg"><div className="text-sm text-gray-600 mb-1">Total Employees</div><div className="text-2xl font-bold text-blue-600">{reportData.length}</div></div>
                <div className="bg-green-50 p-4 rounded-lg"><div className="text-sm text-gray-600 mb-1">Total Hours</div><div className="text-2xl font-bold text-green-600">{grandTotal.toFixed(1)}h</div></div>
                <div className="bg-purple-50 p-4 rounded-lg"><div className="text-sm text-gray-600 mb-1">Avg Hours/Employee</div><div className="text-2xl font-bold text-purple-600">{reportData.length > 0 ? (grandTotal / reportData.length).toFixed(1) : 0}h</div></div>
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

            const downloadConsolidatedCSV = () => {
              if (!consolidatedReport) return;
              const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal: gt } = consolidatedReport;
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
                csv += `"${row.name}","${row.country}","${row.project}"`;
                weekEndings.forEach(we => {
                  const h = row.hours[we];
                  const st = row.statuses[we];
                  csv += `,"${h !== null ? h.toFixed(1) : '-'}","${st}"`;
                });
                csv += `,"${row.rowTotal.toFixed(1)}"\n`;
              });
              csv += `"TOTAL","",""`;
              weekEndings.forEach(we => { csv += `,"${colTotals[we].toFixed(1)}",""` });
              csv += `,"${gt.toFixed(1)}"\n`;
              const rangeLabel = appliedRange.start && appliedRange.end
                ? `${appliedRange.start}_to_${appliedRange.end}`
                : 'consolidated';
              triggerDownload(csv, `consolidated_report_${rangeLabel}.csv`);
            };

            return (
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-5">
                  <h2 className="text-xl font-bold text-gray-800">Consolidated Report</h2>
                  {consolidatedReport && (
                    <button onClick={downloadConsolidatedCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <Download className="w-4 h-4" /> Export CSV
                    </button>
                  )}
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
                  ? <ConsolidatedTable report={consolidatedReport} parseLocalDate={parseLocalDate} />
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

            let filtered = invoices;
            if (accountantInvoiceFilter !== 'all') filtered = filtered.filter(i => i.status === accountantInvoiceFilter);
            if (invoiceDateRange.start && invoiceDateRange.end) {
              filtered = filtered.filter(i => i.periodStart >= invoiceDateRange.start && i.periodStart <= invoiceDateRange.end);
            }
            if (invoicePayDateRange.start && invoicePayDateRange.end) {
              filtered = filtered.filter(i => i.payOnDate && i.payOnDate >= invoicePayDateRange.start && i.payOnDate <= invoicePayDateRange.end);
            }
            if (invoicePaidDateRange.start && invoicePaidDateRange.end) {
              filtered = filtered.filter(i => i.paidDate && i.paidDate >= invoicePaidDateRange.start && i.paidDate <= invoicePaidDateRange.end);
            }
            filtered = [...filtered].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

            const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0);
            const totalApproved = invoices.filter(i => i.status === 'approved').reduce((s, i) => s + i.totalAmount, 0);

            return (
              <div>
                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white rounded-lg shadow-md p-4"><div className="text-sm text-gray-500">Pending Review</div><div className="text-2xl font-bold text-yellow-600">{invoices.filter(i => i.status === 'submitted').length}</div><div className="text-xs text-gray-400 mt-1">awaiting action</div></div>
                  <div className="bg-white rounded-lg shadow-md p-4"><div className="text-sm text-gray-500">Approved</div><div className="text-2xl font-bold text-green-600">{invoices.filter(i => i.status === 'approved').length}</div><div className="text-xs text-gray-400 mt-1">${totalApproved.toFixed(2)} to pay</div></div>
                  <div className="bg-white rounded-lg shadow-md p-4"><div className="text-sm text-gray-500">Paid</div><div className="text-2xl font-bold text-blue-600">{invoices.filter(i => i.status === 'paid').length}</div><div className="text-xs text-gray-400 mt-1">${totalPaid.toFixed(2)} total</div></div>
                  <div className="bg-white rounded-lg shadow-md p-4"><div className="text-sm text-gray-500">Total Invoices</div><div className="text-2xl font-bold text-indigo-600">{invoices.length}</div><div className="text-xs text-gray-400 mt-1">all time</div></div>
                </div>

                <div className="bg-white rounded-lg shadow-md p-6">
                  {/* Filters */}
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                    <div className="flex flex-wrap gap-2">
                      {['all','submitted','approved','paid','rejected'].map(s => (
                        <button key={s} onClick={() => setAccountantInvoiceFilter(s)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${accountantInvoiceFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}>
                          {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                          {s !== 'all' && <span className="ml-1.5 text-xs">({invoices.filter(i => i.status === s).length})</span>}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 items-center">
                        <span className="text-xs font-medium text-gray-500 w-20 text-right">Period:</span>
                        <input type="date" value={invoiceDateRange.start} onChange={e => setInvoiceDateRange({...invoiceDateRange, start: e.target.value})} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                        <span className="text-gray-400 text-sm">to</span>
                        <input type="date" value={invoiceDateRange.end} onChange={e => setInvoiceDateRange({...invoiceDateRange, end: e.target.value})} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                        {(invoiceDateRange.start || invoiceDateRange.end) && <button onClick={() => setInvoiceDateRange({start:'',end:''})} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>}
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="text-xs font-medium text-blue-600 w-20 text-right">Pay On Date:</span>
                        <input type="date" value={invoicePayDateRange.start} onChange={e => setInvoicePayDateRange({...invoicePayDateRange, start: e.target.value})} className="px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400" />
                        <span className="text-gray-400 text-sm">to</span>
                        <input type="date" value={invoicePayDateRange.end} onChange={e => setInvoicePayDateRange({...invoicePayDateRange, end: e.target.value})} className="px-2 py-1.5 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-400" />
                        {(invoicePayDateRange.start || invoicePayDateRange.end) && <button onClick={() => setInvoicePayDateRange({start:'',end:''})} className="text-xs text-blue-400 hover:text-blue-600 underline">Clear</button>}
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="text-xs font-medium text-green-700 w-20 text-right">Paid Date:</span>
                        <input type="date" value={invoicePaidDateRange.start} onChange={e => setInvoicePaidDateRange({...invoicePaidDateRange, start: e.target.value})} className="px-2 py-1.5 border border-green-200 rounded-lg text-sm focus:ring-2 focus:ring-green-400" />
                        <span className="text-gray-400 text-sm">to</span>
                        <input type="date" value={invoicePaidDateRange.end} onChange={e => setInvoicePaidDateRange({...invoicePaidDateRange, end: e.target.value})} className="px-2 py-1.5 border border-green-200 rounded-lg text-sm focus:ring-2 focus:ring-green-400" />
                        {(invoicePaidDateRange.start || invoicePaidDateRange.end) && <button onClick={() => setInvoicePaidDateRange({start:'',end:''})} className="text-xs text-green-500 hover:text-green-700 underline">Clear</button>}
                      </div>
                      <div className="flex justify-end">
                        <button onClick={() => exportInvoicesCSV(filtered)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> Export CSV</button>
                      </div>
                    </div>
                  </div>

                  {/* Table */}
                  {filtered.length === 0 ? (
                    <div className="text-center py-12 text-gray-400"><Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>No invoices match the current filter</p></div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-indigo-600 text-white">
                          <tr>
                            <th className="border border-indigo-700 px-4 py-3 text-left">Invoice No</th>
                            <th className="border border-indigo-700 px-4 py-3 text-left">Employee</th>
                            <th className="border border-indigo-700 px-4 py-3 text-left">Period</th>
                            <th className="border border-indigo-700 px-4 py-3 text-left">Project</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center">Hours</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center">Rate</th>
                            <th className="border border-indigo-700 px-4 py-3 text-right">Amount</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center">Pay On Date</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center">Paid Date</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center">Status</th>
                            <th className="border border-indigo-700 px-4 py-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((inv, idx) => {
                            const project = projects.find(p => p.id === inv.projectId);
                            const sym = currencySymbols[inv.currency] || '$';
                            return (
                              <tr key={inv.id} className={'cursor-pointer ' + (idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50')} onClick={() => { setSelectedInvoice(inv); setShowInvoiceModal(true); }}>
                                <td className="border border-gray-200 px-4 py-3 font-mono text-xs text-gray-700">{inv.invoiceNumber}</td>
                                <td className="border border-gray-200 px-4 py-3 font-medium text-gray-800">{inv.userName}</td>
                                <td className="border border-gray-200 px-4 py-3 whitespace-nowrap">{parseLocalDate(inv.periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</td>
                                <td className="border border-gray-200 px-4 py-3 text-indigo-600 text-xs">{project?.name || '—'}</td>
                                <td className="border border-gray-200 px-4 py-3 text-center">{inv.totalHours.toFixed(2)}</td>
                                <td className="border border-gray-200 px-4 py-3 text-center text-gray-500">{sym}{inv.rate.toFixed(2)}</td>
                                <td className="border border-gray-200 px-4 py-3 text-right font-bold text-gray-800">{sym}{inv.totalAmount.toFixed(2)}</td>
                                <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                                  {inv.payOnDate
                                    ? <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium">{new Date(inv.payOnDate).toLocaleDateString()}</span>
                                    : <span className="text-gray-300 text-xs">—</span>}
                                </td>
                                <td className="border border-gray-200 px-4 py-3 text-center whitespace-nowrap">
                                  {inv.paidDate
                                    ? <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium">{new Date(inv.paidDate).toLocaleDateString()}</span>
                                    : <span className="text-gray-300 text-xs">—</span>}
                                </td>
                                <td className="border border-gray-200 px-4 py-3 text-center"><span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[inv.status]}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span></td>
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
                          })}
                        </tbody>
                        <tfoot className="bg-gray-100 font-semibold">
                          <tr>
                            <td className="border border-gray-200 px-4 py-3 text-gray-700" colSpan={4}>Filtered Total ({filtered.length} invoices)</td>
                            <td className="border border-gray-200 px-4 py-3 text-center">{filtered.reduce((s, i) => s + i.totalHours, 0).toFixed(2)}</td>
                            <td className="border border-gray-200 px-4 py-3"></td>
                            <td className="border border-gray-200 px-4 py-3 text-right text-indigo-700">${filtered.reduce((s, i) => s + i.totalAmount, 0).toFixed(2)}</td>
                            <td className="border border-gray-200 px-4 py-3" colSpan={4}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Invoice Detail Modal (shared, also used in accountant view) */}
          {showInvoiceModal && selectedInvoice && (() => {
            const inv = selectedInvoice;
            const project = projects.find(p => p.id === inv.projectId);
            const sym = ({ USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$' } as Record<string, string>)[inv.currency] || '$';
            const statusColors: Record<string, string> = { draft: 'bg-gray-100 text-gray-700', submitted: 'bg-yellow-100 text-yellow-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-800', paid: 'bg-blue-100 text-blue-800' };
            return (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowInvoiceModal(false)}>
                <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                      <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Rate</div><div className="font-medium">{sym}{inv.rate.toFixed(2)} / hour ({inv.currency})</div></div>
                      <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Total Hours</div><div className="font-medium">{inv.totalHours.toFixed(2)}</div></div>
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
                            <td className="px-4 py-2 border border-gray-200 text-center">{line.hours.toFixed(2)}</td>
                            <td className="px-4 py-2 border border-gray-200 text-center text-gray-500">{sym}{line.rate.toFixed(2)}</td>
                            <td className="px-4 py-2 border border-gray-200 text-right font-medium">{sym}{line.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-indigo-600 text-white font-bold">
                        <tr>
                          <td className="px-4 py-3 border border-indigo-700">Total</td>
                          <td className="px-4 py-3 border border-indigo-700 text-center">{inv.totalHours.toFixed(2)} hrs</td>
                          <td className="px-4 py-3 border border-indigo-700"></td>
                          <td className="px-4 py-3 border border-indigo-700 text-right text-lg">{sym}{inv.totalAmount.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {inv.paymentProfile && (
                      <div className="mb-5 border border-green-200 rounded-lg overflow-hidden">
                        <div className="bg-green-50 px-4 py-2 border-b border-green-200"><span className="font-semibold text-green-800 text-sm">💳 Payment Details — {inv.paymentProfile.profileName}</span></div>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                          {[['Company Name', inv.paymentProfile.companyName],['Company Address', inv.paymentProfile.companyAddress],['Country', inv.paymentProfile.country],['Bank Name', inv.paymentProfile.bankName],['Bank Address', inv.paymentProfile.bankAddress],['Bank Branch', inv.paymentProfile.bankBranch],['Account Number', inv.paymentProfile.accountNumber],['IBAN', inv.paymentProfile.iban],['SWIFT / BIC', inv.paymentProfile.swift],['Payment Email', inv.paymentProfile.paymentEmail]].filter(([,v]) => v).map(([label, value]) => (
                            <div key={label as string}><span className="text-gray-500">{label}: </span><span className="font-medium text-gray-800 font-mono">{value}</span></div>
                          ))}
                        </div>
                      </div>
                    )}
                    {inv.notes && <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 mb-4"><span className="font-medium">Notes: </span>{inv.notes}</div>}
                    {inv.reviewedBy && <p className="text-sm text-gray-500 mb-4">Reviewed by {inv.reviewedBy} on {inv.reviewedAt ? new Date(inv.reviewedAt).toLocaleDateString() : '—'}</p>}
                    {inv.status === 'submitted' && (
                      <div className="mt-5 space-y-3">
                        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Pay On Date (optional — schedule expected payment)</label>
                          <input
                            type="date"
                            value={pendingPayOnDate}
                            onChange={e => setPendingPayOnDate(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm bg-white"
                          />
                        </div>
                        <div className="flex gap-3">
                          <button onClick={() => handleInvoiceAction(inv.id, 'approved', pendingPayOnDate || undefined)} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium"><CheckCircle className="w-5 h-5" /> Approve</button>
                          <button onClick={() => handleInvoiceAction(inv.id, 'rejected')} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium"><XCircle className="w-5 h-5" /> Reject</button>
                        </div>
                      </div>
                    )}
                    {inv.status === 'approved' && (
                      <div className="mt-5 p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                        <p className="text-sm font-semibold text-blue-800 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Mark as Paid</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-blue-700 mb-1">Pay On Date (expected)</label>
                            <input
                              type="date"
                              value={pendingPayOnDate || inv.payOnDate || ''}
                              onChange={e => setPendingPayOnDate(e.target.value)}
                              className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-400 text-sm bg-white"
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
                            handleInvoiceAction(inv.id, 'paid', pendingPayOnDate || inv.payOnDate || undefined, pendingPaidDate);
                          }}
                          className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                        >
                          <DollarSign className="w-4 h-4" /> Confirm Payment
                        </button>
                      </div>
                    )}
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
      </div>
    );
  }

  // ─── TIMESHEET USER VIEW ──────────────────────────────────────────────────
  const weekDates = getWeekDates(selectedWeek);
  const currentTimesheet = timesheets.find(t => t.userId === currentUser!.id && t.weekStart === formatDate(selectedWeek));
  const totalHours = Object.values(timeEntries).reduce((s, e) => s + parseFloat(e?.hours || '0'), 0);
  const activeProjects = projects.filter(p => p.status === 'active');
  const currentProject = projects.find(p => p.id === currentUser!.projectId);
  const userReminders = reminderEmails.filter(r => r.userId === currentUser!.id);
  const currentWeekKey = formatDate(selectedWeek);
  const hasPreviousWeekTimesheet = timesheetsRef.current.some(t => t.userId === currentUser!.id && t.weekStart < currentWeekKey);
  const filteredUserTimesheets = getFilteredTimesheets(currentUser!.id);
  const isUserInactive = !!(currentUser!.endDate && new Date() > parseLocalDate(currentUser!.endDate));

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex justify-between items-center">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800">My Timesheet</h1>
              <p className="text-gray-600">Welcome, {currentUser!.name}</p>
              <div className="flex items-center gap-2 mt-2 text-sm text-indigo-600">
                <MapPin className="w-4 h-4" />
                <span>{countries.find(c => c.code === currentUser!.country)?.name}{currentUser!.region ? ' – ' + currentUser!.region : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {userReminders.length > 0 && (
                <button onClick={() => setShowReminderLog(!showReminderLog)} className="relative flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 border border-amber-300">
                  <Mail className="w-4 h-4" /> Reminders ({userReminders.length})
                </button>
              )}
              <div className="text-right">
                <label className="block text-sm font-medium text-gray-700 mb-2">Current Project</label>
                <select value={currentUser!.projectId || ''} onChange={e => updateUserProject(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white min-w-[200px]">
                  <option value="">Select Project</option>
                  {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                </select>
                {currentProject && <p className="text-xs text-gray-500 mt-1">All hours logged to this project</p>}
              </div>
              <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
            </div>
          </div>
        </div>

        {showReminderLog && userReminders.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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

        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow-md mb-6">
          <div className="flex border-b">
            <button onClick={() => setUserTab('timesheet')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (userTab === 'timesheet' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
              <Clock className="w-5 h-5" /> My Timesheets
            </button>
            <button onClick={() => setUserTab('invoices')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (userTab === 'invoices' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
              <Receipt className="w-5 h-5" /> My Invoices
              {invoices.filter(i => i.userId === currentUser!.id && i.status === 'submitted').length > 0 && (
                <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-bold">{invoices.filter(i => i.userId === currentUser!.id && i.status === 'submitted').length}</span>
              )}
            </button>
            <button onClick={() => setUserTab('payment')} className={'flex-1 px-6 py-4 font-medium flex items-center justify-center gap-2 ' + (userTab === 'payment' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-gray-600 hover:bg-gray-50')}>
              <DollarSign className="w-5 h-5" /> Payment Profiles
              {paymentProfiles.filter(p => p.userId === currentUser!.id).length > 0 && (
                <span className="ml-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold">{paymentProfiles.filter(p => p.userId === currentUser!.id).length}</span>
              )}
            </button>
          </div>
        </div>

        {userTab === 'timesheet' && (<div>
          <div className="bg-white rounded-lg shadow-md p-6">
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
            <button onClick={() => changeWeek(-1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">← Previous Week</button>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-gray-800">Week of {selectedWeek.toLocaleDateString()}</h2>
              {currentTimesheet && (
                <span className={'inline-block mt-1 px-3 py-1 rounded-full text-sm font-medium ' + (currentTimesheet.status === 'approved' ? 'bg-green-100 text-green-800' : currentTimesheet.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')}>
                  {currentTimesheet.status.charAt(0).toUpperCase() + currentTimesheet.status.slice(1)}
                </span>
              )}
            </div>
            <button onClick={() => changeWeek(1)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Next Week →</button>
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
            {weekDates.map(date => {
              const dateKey = formatDate(date);
              const entry = timeEntries[dateKey] || { hours: '' };
              const isDisabled = isUserInactive || currentTimesheet?.status === 'approved';
              return (
                <div key={dateKey} className={'p-4 rounded-lg ' + (entry.isHoliday ? 'bg-red-50 border-2 border-red-200' : entry.isWeekend ? 'bg-gray-100' : 'bg-blue-50')}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-gray-800">{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                        {entry.isHoliday && <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Holiday: {entry.holidayName}</span>}
                        {entry.isWeekend && <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full font-medium">Weekend</span>}
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

        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-xl font-bold text-gray-800">Timesheet History</h2>
            <button onClick={() => exportTimesheetList(filteredUserTimesheets)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"><Download className="w-4 h-4" /> Export CSV</button>
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

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-indigo-600 text-white">
                <tr>
                  <th className="border border-indigo-700 px-4 py-3 text-left">W/E Date</th>
                  <th className="border border-indigo-700 px-4 py-3 text-left">Project</th>
                  {['Mon','Tue','Wed','Thu','Fri'].map(d => <th key={d} className="border border-indigo-700 px-4 py-3 text-center">{d}</th>)}
                  <th className="border border-indigo-700 px-4 py-3 text-center">Total</th>
                  <th className="border border-indigo-700 px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredUserTimesheets.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-gray-500">No timesheets found</td></tr>
                ) : filteredUserTimesheets.map((ts, idx) => {
                  const project = projects.find(p => p.id === ts.projectId);
                  const wDates = getWeekDates(parseLocalDate(ts.weekStart));
                  const weekFri = wDates[4]; // Friday is last working day
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
          const previewHours = previewLines.reduce((s, l) => s + l.hours, 0);

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
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Receipt className="w-6 h-6 text-indigo-600" /> My Invoices</h2>
                    <p className="text-sm text-gray-500 mt-1">Generate invoices from your approved timesheets</p>
                  </div>
                  <button
                    onClick={() => {
                      setInvoiceView(invoiceView === 'list' ? 'create' : 'list');
                      if (invoiceView === 'list') setInvoiceNumber('');
                    }}
                    className={'flex items-center gap-2 px-4 py-2 rounded-lg font-medium ' + (invoiceView === 'create' ? 'bg-gray-200 text-gray-700' : 'bg-indigo-600 text-white hover:bg-indigo-700')}
                  >
                    {invoiceView === 'create' ? (<><X className="w-4 h-4" /> Cancel</>) : (<><Plus className="w-4 h-4" /> Create Invoice</>)}
                  </button>
                </div>
              </div>

              {/* Create Invoice Form */}
              {invoiceView === 'create' && (
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2"><DollarSign className="w-5 h-5 text-indigo-600" /> New Invoice</h3>

                  {approvedTimesheets.length === 0 && (
                    <div className="mb-5 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-amber-800 text-sm font-medium">⚠️ No approved timesheets found. Your timesheets must be approved by your manager before you can invoice them.</p>
                    </div>
                  )}

                  {/* Invoice Number */}
                  <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Invoice Number * <span className="text-xs font-normal text-gray-500">(alphanumeric, must be unique across active invoices)</span></label>
                    <div className="flex gap-3 items-center">
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={e => setInvoiceNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, ''))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
                        placeholder="e.g. INV-2026-001"
                        maxLength={40}
                      />
                      {suggestedInvNum && !invoiceNumber && (
                        <button
                          onClick={() => setInvoiceNumber(suggestedInvNum)}
                          className="px-3 py-2 text-sm bg-white border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 whitespace-nowrap"
                        >
                          Use suggested: {suggestedInvNum}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Letters, numbers, hyphens and underscores only. Rejected invoice numbers can be reused.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Period Selection */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Billing Period *</label>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {monthOptions.map(opt => {
                          const hasApproved = approvedTimesheets.some(t => {
                            const weekFri = new Date(parseLocalDate(t.weekStart)); weekFri.setDate(weekFri.getDate() + 4);
                            return parseLocalDate(t.weekStart) <= parseLocalDate(opt.end) && weekFri >= parseLocalDate(opt.start);
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
                              onClick={e => { e.preventDefault(); setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault }); setShowProfileModal(true); }}
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
                              <td className="px-4 py-2 text-center font-medium">{line.hours.toFixed(2)}</td>
                              <td className="px-4 py-2 text-center text-gray-500">{sym}{line.rate.toFixed(2)}/hr</td>
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

                  <button
                    onClick={submitInvoice}
                    disabled={previewLines.length === 0 || !invoiceNumber.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Receipt className="w-5 h-5" /> Submit Invoice for Review
                  </button>
                </div>
              )}

              {/* Invoice List */}
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-5">
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
                              <p className="text-sm text-gray-500 mt-1">{inv.lines.length} week{inv.lines.length !== 1 ? 's' : ''} · {inv.totalHours.toFixed(1)} hrs · {sym2}{inv.rate}/hr</p>
                              {inv.paymentProfile && <p className="text-xs text-gray-400 mt-0.5">💳 {inv.paymentProfile.profileName} — {inv.paymentProfile.bankName}</p>}
                              {inv.payOnDate && <p className="text-xs text-blue-600 mt-0.5 font-medium">📅 Pay on date: {new Date(inv.payOnDate).toLocaleDateString()}</p>}
                              {inv.paidDate && <p className="text-xs text-green-600 mt-0.5 font-medium">✅ Paid: {new Date(inv.paidDate).toLocaleDateString()}</p>}
                            </div>
                            <div className="text-right ml-3 flex flex-col items-end gap-2">
                              <div className="text-2xl font-bold text-indigo-600">{sym2}{inv.totalAmount.toFixed(2)}</div>
                              <div className="text-xs text-gray-400">{inv.submittedAt ? new Date(inv.submittedAt).toLocaleDateString() : ''}</div>
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
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-6 h-6 text-indigo-600" /> Payment Profiles</h2>
                    <p className="text-sm text-gray-500 mt-1">Bank and company details attached to your invoices</p>
                  </div>
                  <button
                    onClick={() => { setEditingProfile(null); setProfileForm(emptyProfileForm()); setShowProfileModal(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
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
                            onClick={() => { setEditingProfile(p); setProfileForm({ profileName: p.profileName, companyName: p.companyName, companyAddress: p.companyAddress, country: p.country, bankName: p.bankName, bankAddress: p.bankAddress, bankBranch: p.bankBranch, accountNumber: p.accountNumber, iban: p.iban, swift: p.swift, paymentEmail: p.paymentEmail, isDefault: p.isDefault }); setShowProfileModal(true); }}
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
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowInvoiceModal(false)}>
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
                    <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Rate</div><div className="font-medium">{sym}{inv.rate.toFixed(2)} / hour ({inv.currency})</div></div>
                    <div className="bg-gray-50 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Total Hours</div><div className="font-medium">{inv.totalHours.toFixed(2)}</div></div>
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
                          <td className="px-4 py-2 border border-gray-200 text-center">{line.hours.toFixed(2)}</td>
                          <td className="px-4 py-2 border border-gray-200 text-center text-gray-500">{sym}{line.rate.toFixed(2)}</td>
                          <td className="px-4 py-2 border border-gray-200 text-right font-medium">{sym}{line.amount.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-indigo-600 text-white font-bold">
                      <tr>
                        <td className="px-4 py-3 border border-indigo-700">Total</td>
                        <td className="px-4 py-3 border border-indigo-700 text-center">{inv.totalHours.toFixed(2)} hrs</td>
                        <td className="px-4 py-3 border border-indigo-700"></td>
                        <td className="px-4 py-3 border border-indigo-700 text-right text-lg">{sym}{inv.totalAmount.toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  {inv.notes && <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 mb-4"><span className="font-medium">Notes: </span>{inv.notes}</div>}
                  {inv.reviewedBy && <p className="text-sm text-gray-500 mb-4">Reviewed by {inv.reviewedBy} on {inv.reviewedAt ? new Date(inv.reviewedAt).toLocaleDateString() : '—'}</p>}
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

        {/* Payment Profile Modal */}
        {showProfileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowProfileModal(false)}>
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center z-10">
                <h3 className="text-lg font-bold text-gray-800">{editingProfile ? 'Edit Payment Profile' : 'New Payment Profile'}</h3>
                <button onClick={() => setShowProfileModal(false)} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
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
                      <input type="text" value={profileForm.country} onChange={e => setProfileForm({...profileForm, country: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="e.g. United Kingdom" />
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
                        <label className="block text-xs font-medium text-gray-600 mb-1">SWIFT / BIC</label>
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
                  <button onClick={() => setShowProfileModal(false)} className="px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Cancel</button>
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
