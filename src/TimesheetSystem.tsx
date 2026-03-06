// ============================================================
// TimesheetSystem.tsx — Supabase-integrated version
// Phase 3 of the Production Deployment Guide
// ============================================================

const ConsolidatedTable = ({ report, parseLocalDate }: { report: { weekEndings: string[]; employeeRows: { name: string; country: string; project: string; hours: Record<string, number | null>; statuses: Record<string, string>; rowTotal: number }[]; colTotals: Record<string, number>; grandTotal: number }; parseLocalDate: (s: string) => Date }) => {
  const { weekEndings, employeeRows, colTotals, grandTotal } = report;
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Weeks</div><div className="text-2xl font-bold text-blue-600">{weekEndings.length}</div></div>
        <div className="bg-green-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Total Hours</div><div className="text-2xl font-bold text-green-600">{grandTotal.toFixed(1)}h</div></div>
        <div className="bg-purple-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Employees</div><div className="text-2xl font-bold text-purple-600">{employeeRows.length}</div></div>
        <div className="bg-amber-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Avg Hrs/Employee</div><div className="text-2xl font-bold text-amber-600">{employeeRows.length > 0 ? (grandTotal / employeeRows.length).toFixed(1) : 0}h</div></div>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-sm w-full">
          <thead>
            <tr className="bg-green-600 text-white">
              <th className="border border-green-700 px-3 py-2 text-left">Employee</th>
              <th className="border border-green-700 px-3 py-2 text-left">Country</th>
              <th className="border border-green-700 px-3 py-2 text-left">Project</th>
              {weekEndings.map((we: string) => (
                <th key={we} className="border border-green-700 px-3 py-2 text-center whitespace-nowrap">
                  <div className="text-xs opacity-80">W/E</div>
                  <div>{parseLocalDate(we).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </th>
              ))}
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
                  return (
                    <td key={we} className="border border-gray-300 px-3 py-2 text-center">
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
                <td key={we} className="border border-green-700 px-3 py-2 text-center">{colTotals[we].toFixed(1)}</td>
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
import { Calendar, Clock, CheckCircle, XCircle, LogOut, Users, Mail, FileText, Download, Printer, Plus, Edit2, Trash2, Save, X, Settings, MapPin } from 'lucide-react';
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
    email: '', password: '', name: '', role: 'timesheetuser', manager_id: null, country: 'US', region: '', project_id: null, start_date: new Date().toISOString().split('T')[0]
  });
  const [projectForm, setProjectForm] = useState<ProjectForm>({
    name: '', code: '', status: 'active', description: ''
  });
  const [viewMode, setViewMode] = useState('form');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedTimesheetForView, setSelectedTimesheetForView] = useState<Timesheet | null>(null);
  const [showTimesheetModal, setShowTimesheetModal] = useState(false);
  const [selectedTimesheetIds, setSelectedTimesheetIds] = useState<number[]>([]);
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

      await Promise.all([fetchUsers(), fetchProjects(), fetchTimesheets()]);

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
    };
  }

  function normaliseTimesheet(t: Record<string, unknown>): Timesheet {
    return {
      id: t.id as number,
      userId: t.user_id as string,
      userName: t.user_name as string,
      projectId: (t.project_id as number) || null,
      weekStart: t.week_start as string,
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
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const weekStart = new Date(today.getFullYear(), today.getMonth(), diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  function parseLocalDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDate(date: Date): string {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getWeekDates(startDate: Date): Date[] {
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

  function getMissingWeeksSince(startDate: string, timesheets: Timesheet[], userId: string): string[] {
    const start = parseLocalDate(startDate);
    // Align to Monday
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisWeekStart = getCurrentWeekStart();

    const missing: string[] = [];
    const cursor = new Date(start);

    while (cursor < thisWeekStart) {
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
      const userLocalTime = getUserLocalTime(user);
      const dayOfWeek = userLocalTime.getDay();
      const hour = userLocalTime.getHours();

      // Only trigger on Sunday 5 PM or Monday 12 PM local time
      const isTriggerTime = (dayOfWeek === 0 && hour === 17) || (dayOfWeek === 1 && hour === 12);
      if (!isTriggerTime) return;

      const missingWeeks = getMissingWeeksSince(user.startDate!, allTimesheets, user.id);
      if (missingWeeks.length === 0) return;

      const isUrgent = dayOfWeek === 1; // Monday = urgent
      const weekList = missingWeeks
        .map(w => `  • Week of ${parseLocalDate(w).toLocaleDateString()}`)
        .join('\n');

      const subject = isUrgent
        ? `URGENT: ${missingWeeks.length} Timesheet(s) Overdue`
        : `Reminder: ${missingWeeks.length} Timesheet(s) Need Submission`;

      const body = isUrgent
        ? `Hi ${user.name},\n\nYou have ${missingWeeks.length} timesheet(s) that have not been submitted:\n\n${weekList}\n\nPlease log in and submit them as soon as possible.`
        : `Hi ${user.name},\n\nThis is a reminder that the following timesheet(s) are missing:\n\n${weekList}\n\nPlease submit them by end of day Monday.`;

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
      setUserForm({ email: user.email, password: '', name: user.name, role: user.role, manager_id: user.managerId, country: user.country, region: user.region, project_id: user.projectId, start_date: user.startDate || '' });
    } else {
      setEditingUser(null);
      setUserForm({ email: '', password: '', name: '', role: 'timesheetuser', manager_id: null, country: detectedLocation?.country || 'US', region: detectedLocation?.region || '', project_id: null, start_date: new Date().toISOString().split('T')[0] });
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
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="text-gray-400 font-normal">(used for timesheet reminders)</span></label>
                      <input type="date" value={userForm.start_date} onChange={e => setUserForm({...userForm, start_date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                      <p className="text-xs text-gray-500 mt-1">Reminders will flag any missing timesheets from this date onward</p>
                    </div>
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
      if (!consolidatedRange.start || !consolidatedRange.end) return null;
      const startD = parseLocalDate(consolidatedRange.start), endD = parseLocalDate(consolidatedRange.end);
      const inRange = timesheets.filter(t => { const d = parseLocalDate(t.weekStart); return d >= startD && d <= endD; });
      const weekEndings = [...new Set(inRange.map(t => t.weekStart))].sort();
      const timesheetUsers = users.filter(u => u.role === 'timesheetuser');
      const employeeRows = timesheetUsers.map(user => {
        const hours: Record<string, number | null> = {}, statuses: Record<string, string> = {};
        let rowTotal = 0;
        weekEndings.forEach(we => {
          const ts = inRange.find(t => t.userId === user.id && t.weekStart === we);
          if (ts) {
            const h = Object.values(ts.entries).reduce((s, e) => s + parseFloat((e as TimeEntry)?.hours || '0'), 0);
            hours[we] = h; statuses[we] = ts.status; rowTotal += h;
          } else { hours[we] = null; statuses[we] = 'not submitted'; }
        });
        const project = projects.find(p => p.id === user.projectId);
        return { name: user.name, country: user.country, project: project ? `${project.name} (${project.code})` : 'Not Assigned', hours, statuses, rowTotal };
      });
      const colTotals: Record<string, number> = {};
      weekEndings.forEach(we => { colTotals[we] = employeeRows.reduce((s, r) => s + (r.hours[we] || 0), 0); });
      return { weekEndings, employeeRows, colTotals, grandTotal: employeeRows.reduce((s, r) => s + r.rowTotal, 0) };
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

          {accountantTab === 'consolidated' && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-4">Consolidated Report (Multi-Week)</h2>
              <div className="flex gap-4 items-end mb-6">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label><input type="date" value={consolidatedRange.start} onChange={e => setConsolidatedRange({...consolidatedRange, start: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><input type="date" value={consolidatedRange.end} onChange={e => setConsolidatedRange({...consolidatedRange, end: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
              </div>
              {consolidatedReport ? <ConsolidatedTable report={consolidatedReport} parseLocalDate={parseLocalDate} /> : <p className="text-gray-500 text-center py-8">Select a date range to generate the consolidated report.</p>}
            </div>
          )}
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

        <div className="bg-white rounded-lg shadow-md p-6">
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
              const isDisabled = currentTimesheet?.status === 'approved';
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

          {!currentTimesheet || currentTimesheet.status !== 'approved' ? (
            <div>
              <button onClick={submitTimesheet} className="w-full mt-6 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 font-medium flex items-center justify-center gap-2">
                <CheckCircle className="w-5 h-5" /> Submit for Approval
              </button>
              {(() => {
                const missing = currentUser!.startDate
                  ? getMissingWeeksSince(currentUser!.startDate, timesheets, currentUser!.id)
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
                <p className="text-sm text-blue-800"><strong>Reminder Schedule:</strong> Automated reminders are sent Sunday at 5 PM and Monday at 12 PM (your local time) for any missing timesheets.</p>
              </div>
            </div>
          ) : (
            <div className="mt-6 p-4 bg-green-50 border-2 border-green-200 rounded-lg text-center">
              <p className="text-green-800 font-medium">This timesheet has been approved and cannot be modified.</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mt-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-gray-800">Timesheet History</h2>
            <button onClick={() => exportTimesheetList(filteredUserTimesheets)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"><Download className="w-4 h-4" /> Export CSV</button>
          </div>
          <div className="mb-4 flex gap-4 items-end">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label><input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">End Date</label><input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="px-3 py-2 border border-gray-300 rounded-lg" /></div>
            <button onClick={() => setDateRange({start: '', end: ''})} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">Clear Filter</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-indigo-600 text-white">
                <tr>
                  <th className="border border-indigo-700 px-4 py-3 text-left">Week Start</th>
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
                  const dailyHours = wDates.map(d => parseFloat(ts.entries[formatDate(d)]?.hours || '0'));
                  const total = dailyHours.reduce((s, h) => s + h, 0);
                  return (
                    <tr key={ts.id} className={'cursor-pointer ' + (idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50')} onClick={() => openTimesheetModal(ts)}>
                      <td className="border border-gray-300 px-4 py-2 text-indigo-600 font-medium">{parseLocalDate(ts.weekStart).toLocaleDateString()}</td>
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

        {showTimesheetModal && <TimesheetDetailModal />}
      </div>
    </div>
  );
};

export default TimesheetSystem;
