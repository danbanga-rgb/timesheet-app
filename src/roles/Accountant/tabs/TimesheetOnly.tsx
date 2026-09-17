import { useState } from 'react';
import { Users, Download } from 'lucide-react';
import type { Project, Timesheet, UserProfile } from '../../../types';
import { formatDate, getWeekDates, parseLocalDate } from '../../../lib/dates';
import { triggerDownload } from '../../../lib/csv';
import MultiSelectDropdown from '../../../components/MultiSelectDropdown';
import MonthRangePicker, { buildMonthPresets } from '../../../components/MonthRangePicker';
import SourceBadge from '../../../components/SourceBadge';
import DayHourCells from '../../../components/DayHourCells';

// Accountant Timesheet-Only tab — lists timesheets for users who have
// invoiceEnabled=false. Read-only view with user filter + date-range
// filter + CSV export.
//
// Extracted from TimesheetSystem.tsx as Slice T4 of the accountant
// modularization arc (2026-09-17). Both tab-local hooks
// (tsOnlySelectedUsers, tsOnlyApplied) moved inside — self-sufficient
// tab principle.

export interface TimesheetOnlyTabProps {
  timesheets: Timesheet[];
  users: UserProfile[];
  projects: Project[];
  openTimesheetModal: (ts: Timesheet) => void;
  countryName: (code: string) => string;
}

export default function TimesheetOnlyTab({
  timesheets,
  users,
  projects,
  openTimesheetModal,
  countryName,
}: TimesheetOnlyTabProps) {
  const [tsOnlyApplied, setTsOnlyApplied] = useState({ start: '', end: '' });
  const [tsOnlySelectedUsers, setTsOnlySelectedUsers] = useState<string[] | null>(null);

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
            <div className="mb-5">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Filter Users</label>
              <MultiSelectDropdown
                options={tsOnlyUsers.map(u => ({ id: u.id, label: u.name, meta: countryName(u.country) }))}
                selected={effectiveSelected}
                onChange={setTsOnlySelectedUsers}
                itemNoun="users"
                searchPlaceholder="Search users..."
                emptyLabel="No users match"
              />
            </div>

            {/* Quick select presets */}
            {(() => {
              const todayMon = (() => { const d = new Date(); d.setHours(0,0,0,0); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); return d; })();
              const biWeekEnd = new Date(todayMon); biWeekEnd.setDate(biWeekEnd.getDate() - 1);
              const biWeekStart = new Date(todayMon); biWeekStart.setDate(biWeekStart.getDate() - 14);
              const biWeekLabel = `${biWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${biWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
              const lastWeekStart = new Date(todayMon); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
              const lastWeekEnd = new Date(todayMon); lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
              const lastWeekLabel = `${lastWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${lastWeekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
              return (
                <div className="mb-4">
                  <MonthRangePicker
                    value={tsOnlyApplied}
                    onChange={setTsOnlyApplied}
                    presets={[
                      {
                        group: 'Bi-Weekly',
                        options: [
                          { label: `Last Week (${lastWeekLabel})`, start: formatDate(lastWeekStart), end: formatDate(lastWeekEnd) },
                          { label: `Last 2 Weeks (${biWeekLabel})`, start: formatDate(biWeekStart), end: formatDate(biWeekEnd) },
                        ],
                      },
                      { group: 'Month', options: buildMonthPresets(6) },
                    ]}
                  />
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
                      const fri = weekDates[4];
                      return (
                        <tr key={ts.id} className={'cursor-pointer ' + (idx % 2 === 0 ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 hover:bg-blue-50')} onClick={() => openTimesheetModal(ts)}>
                          <td className="border border-gray-200 px-2 py-2 text-center text-xs text-gray-400 whitespace-nowrap">#{ts.id}</td>
                          <td className="border border-gray-200 px-3 py-2 font-medium text-gray-800">{ts.userName}</td>
                          <td className="border border-gray-200 px-3 py-2">
                            <SourceBadge source={ts.source} />
                          </td>
                          <td className="border border-gray-200 px-3 py-2 text-gray-700 whitespace-nowrap">{fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                          <td className="border border-gray-200 px-3 py-2 text-indigo-600 text-xs">{project ? `${project.name} (${project.code})` : '—'}</td>
                          <DayHourCells entries={ts.entries} weekStart={weekDates[0]} />
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
}
