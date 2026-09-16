import { useState, type ReactNode } from 'react';
import { LogOut, CheckCircle, FileText, BarChart2, Users, XCircle, Download } from 'lucide-react';
import { parseLocalDate, formatDate, getWeekDates } from '../../lib/dates';
import { triggerDownload } from '../../lib/csv';
import MonthRangePicker from '../../components/MonthRangePicker';
import ConsolidatedTable from '../../components/ConsolidatedTable';
import type { UserProfile, Timesheet, Project, TimeEntry } from '../../types';

// Manager dashboard view.
//
// Extracted from TimesheetSystem.tsx as Slice 3 of the modularization arc.
// Manager role is currently DORMANT (see memory [[manager-role-dormant]]) —
// auto-approvals + accountant flows bypass this UI in the current operating
// model. Refactoring here is the safest first role-file extraction target.

export interface ManagerViewProps {
  currentUser: UserProfile;
  timesheets: Timesheet[];
  users: UserProfile[];
  projects: Project[];

  // Shared filter state (also used by outer handlers)
  dateRange: { start: string; end: string };
  setDateRange: (r: { start: string; end: string }) => void;
  selectedTimesheetIds: number[];
  showTimesheetModal: boolean;
  timesheetDetailModal: ReactNode;

  // Handlers owned by parent
  onLogout: () => void;
  onApproval: (id: number, status: 'approved' | 'rejected') => Promise<void>;
  bulkApproveTimesheets: (status: 'approved' | 'rejected') => void;
  toggleSelectAll: (list: Timesheet[]) => void;
  toggleTimesheetSelection: (id: number) => void;
  openTimesheetModal: (ts: Timesheet) => void;
  exportTimesheetList: (list: Timesheet[]) => void;
  getFilteredTimesheets: () => Timesheet[];
  countryName: (code: string) => string;
}

export default function ManagerView({
  currentUser,
  timesheets,
  users,
  projects,
  dateRange,
  setDateRange,
  selectedTimesheetIds,
  showTimesheetModal,
  timesheetDetailModal,
  onLogout,
  onApproval,
  bulkApproveTimesheets,
  toggleSelectAll,
  toggleTimesheetSelection,
  openTimesheetModal,
  exportTimesheetList,
  getFilteredTimesheets,
  countryName,
}: ManagerViewProps) {
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'consolidated'>('cards');
  const [managerAppliedRange, setManagerAppliedRange] = useState({ start: '', end: '' });

  const pendingTimesheets = timesheets.filter(t => t.status === 'pending');
  const managedUsers = users.filter(u => u.managerId === currentUser.id);
  const filteredTimesheets = getFilteredTimesheets().filter(t => managedUsers.some(u => u.id === t.userId));

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
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Manager Dashboard</h1>
              <p className="text-gray-600">Welcome, {currentUser.name}</p>
              <p className="text-sm text-blue-600 font-medium">Role: Manager — {managedUsers.length} team member(s)</p>
            </div>
            <button onClick={onLogout} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"><LogOut className="w-4 h-4" /> Logout</button>
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
                          <button onClick={async () => { await onApproval(timesheet.id, 'approved'); alert('Approved!'); }} className="flex items-center gap-1 px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"><CheckCircle className="w-4 h-4" /> Approve</button>
                          <button onClick={async () => { await onApproval(timesheet.id, 'rejected'); alert('Rejected!'); }} className="flex items-center gap-1 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"><XCircle className="w-4 h-4" /> Reject</button>
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
        {showTimesheetModal && timesheetDetailModal}

        {viewMode === 'consolidated' && (
          <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
              <h2 className="text-xl font-bold text-gray-800">Team Consolidated Report</h2>
              {mgrReport && (
                <button onClick={downloadMgrCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              )}
            </div>

            <div className="mb-6">
              <MonthRangePicker value={managerAppliedRange} onChange={setManagerAppliedRange} />
            </div>

            {mgrReport
              ? <ConsolidatedTable report={mgrReport} parseLocalDate={parseLocalDate} />
              : (
                <div className="text-center py-12 text-gray-400">
                  <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-base">Select a month or custom date range to see the report.</p>
                  <p className="text-sm mt-1">Shows consolidated hours for your {managedUsers.length} team member(s).</p>
                </div>
              )
            }
          </div>
        )}
      </div>
    </div>
  );
}
