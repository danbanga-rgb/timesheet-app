import { useMemo, useState } from 'react';
import { Download, FileText, Printer } from 'lucide-react';
import type { Project, Timesheet, UserProfile } from '../../../types';
import { formatDate, getWeekDates, parseLocalDate } from '../../../lib/dates';
import { triggerDownload } from '../../../lib/csv';
import { isTestAccount } from '../../../lib/isTestAccount';
import StickyScrollWrapper from '../../../components/StickyScrollWrapper';
import SourceBadge from '../../../components/SourceBadge';
import StatusBadge from '../../../components/StatusBadge';

// Accountant Weekly tab — landing view showing the current week's
// approved / pending / not-submitted / rejected state per timesheetuser
// plus KPI cards + CSV / Print.
//
// Extracted from TimesheetSystem.tsx as Slice W3 of the accountant
// modularization arc (2026-09-16). All Weekly-scoped state + handlers
// moved inside (self-sufficient tab). generateReport wrapped in useMemo
// keyed on [timesheets, users, projects, reportWeek] per §1b F15 to
// eliminate the per-render recompute.

function getCurrentWeekStart(): Date {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(today.getFullYear(), today.getMonth(), diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
}

export interface WeeklyTabProps {
  timesheets: Timesheet[];
  users: UserProfile[];
  projects: Project[];
}

interface ReportRow {
  name: string;
  source: 'direct' | 'imported' | null;
  project: string;
  dailyHours: number[];
  total: number;
  status: string;
  timesheetId: number | null;
}

export default function WeeklyTab({ timesheets, users, projects }: WeeklyTabProps) {
  const [reportWeek, setReportWeek] = useState<Date>(getCurrentWeekStart());

  const changeReportWeek = (direction: number) => {
    const newWeek = new Date(reportWeek);
    newWeek.setDate(newWeek.getDate() + (direction * 7));
    setReportWeek(newWeek);
  };

  const reportData = useMemo<ReportRow[]>(() => {
    const weekKey = formatDate(reportWeek);
    const weekTimesheets = timesheets.filter(t => t.weekStart === weekKey);
    const weekEndKey = formatDate(new Date(parseLocalDate(weekKey).getTime() + 6 * 86400000));
    return users
      .filter(u => u.role === 'timesheetuser' && u.startDate && u.startDate <= weekEndKey && (!u.endDate || u.endDate >= weekKey) && !isTestAccount(u.name))
      .map(user => {
        const timesheet = weekTimesheets.find(t => t.userId === user.id);
        const entries = timesheet ? timesheet.entries : {};
        const project = projects.find(p => p.id === (timesheet?.projectId ?? user.projectId)) ?? null;
        const dailyHours = getWeekDates(reportWeek).map(date => parseFloat(entries[formatDate(date)]?.hours || '0'));
        return {
          name: user.name,
          source: timesheet?.source ?? null,
          project: project ? `${project.name} (${project.code})` : 'Not Assigned',
          dailyHours,
          total: dailyHours.reduce((s, h) => s + h, 0),
          status: timesheet ? timesheet.status : 'not submitted',
          timesheetId: timesheet?.id ?? null,
        };
      });
  }, [timesheets, users, projects, reportWeek]);

  const weekDates = useMemo(() => getWeekDates(reportWeek), [reportWeek]);
  const grandTotal = useMemo(() => reportData.reduce((s, r) => s + r.total, 0), [reportData]);

  const downloadCSV = () => {
    let csv = 'ID,Employee Name,Source,Project,';
    weekDates.forEach(d => { csv += `"${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}",`; });
    csv += 'Total Hours,Status\n';
    reportData.forEach(row => {
      const sourceLabel = row.source === 'imported' ? 'Email' : row.source === 'direct' ? 'Portal' : '';
      csv += `"${row.timesheetId ? '#' + row.timesheetId : ''}","${row.name}","${sourceLabel}","${row.project}",`;
      row.dailyHours.forEach(h => { csv += h + ','; });
      csv += `${row.total},"${row.status}"\n`;
    });
    csv += `\n"","Grand Total","","",`; weekDates.forEach(() => { csv += ','; }); csv += `${grandTotal},\n`;
    triggerDownload(csv, `timesheet_report_${formatDate(reportWeek)}.csv`);
  };

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
    <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><FileText className="w-6 h-6" /> Weekly Timesheet Report</h2>
        <div className="flex gap-2">
          <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"><Download className="w-4 h-4" /> CSV</button>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"><Printer className="w-4 h-4" /> Print</button>
        </div>
      </div>
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
                  <SourceBadge source={row.source} />
                </td>
                <td className="border border-gray-300 px-4 py-3 text-sm text-indigo-600">{row.project}</td>
                {row.dailyHours.map((h, i) => <td key={i} className="border border-gray-300 px-4 py-3 text-center"><span className={h > 0 ? 'font-semibold' : 'text-gray-400'}>{h > 0 ? h.toFixed(1) : '-'}</span></td>)}
                <td className="border border-gray-300 px-4 py-3 text-center font-bold text-indigo-600">{row.total.toFixed(1)}</td>
                <td className="border border-gray-300 px-4 py-3 text-center"><StatusBadge tone={row.status === 'approved' ? 'green' : row.status === 'rejected' ? 'red' : row.status === 'pending' ? 'yellow' : 'gray'} size="lg">{row.status === 'not submitted' ? 'Not Submitted' : row.status.charAt(0).toUpperCase() + row.status.slice(1)}</StatusBadge></td>
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
  );
}
