import { MapPin, X, CheckCircle, XCircle } from 'lucide-react';
import { parseLocalDate, formatDate, getWeekDates, getWeekSunday, isWeekend } from '../lib/dates';
import type { UserProfile, Project, Timesheet } from '../types';

// Timesheet Details modal — shows day-by-day breakdown + status +
// approve/reject actions for managers and accountants.
//
// Extracted from TimesheetSystem.tsx as Slice 4 of the modularization
// arc. Consumed by Manager, Accountant, and TimesheetUser role views.

export interface TimesheetDetailModalProps {
  timesheet: Timesheet;
  users: UserProfile[];
  projects: Project[];
  currentUser: UserProfile;
  countries: { code: string; name: string }[];
  isHoliday: (date: Date, country: string) => { date: string; name: string } | undefined;
  onClose: () => void;
  onApproval: (id: number, status: 'approved' | 'rejected') => Promise<void>;
}

export default function TimesheetDetailModal({
  timesheet,
  users,
  projects,
  currentUser,
  countries,
  isHoliday,
  onClose,
  onApproval,
}: TimesheetDetailModalProps) {
  const user = users.find(u => u.id === timesheet.userId);
  const project = projects.find(p => p.id === (timesheet.projectId ?? user?.projectId));
  const weekDates = getWeekDates(parseLocalDate(timesheet.weekStart));
  const dailyData = weekDates.map(date => {
    const dateKey = formatDate(date);
    const entry = timesheet.entries[dateKey];
    const holiday = user ? isHoliday(date, user.country) : undefined;
    const weekend = isWeekend(date);
    return {
      date,
      dateKey,
      dayName: date.toLocaleDateString('en-US', { weekday: 'long' }),
      hours: parseFloat(entry?.hours || '0'),
      holiday: holiday || undefined,
      holidayName: holiday?.name,
      weekend,
    };
  });
  const totalHours = dailyData.reduce((s, d) => s + d.hours, 0);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-lg shadow-xl w-full sm:max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b p-6 z-10">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Timesheet Details</h2>
              <div className="mt-2 space-y-1">
                <p className="text-gray-600"><span className="font-medium">Employee:</span> {timesheet.userName}</p>
                <p className="text-gray-600"><span className="font-medium">Week:</span> {parseLocalDate(timesheet.weekStart).toLocaleDateString()} – {getWeekSunday(parseLocalDate(timesheet.weekStart)).toLocaleDateString()}</p>
                {project && <p className="text-indigo-600"><span className="font-medium">Project:</span> {project.name} ({project.code})</p>}
                {user && (
                  <p className="text-gray-600 flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    <span className="font-medium">Location:</span> {countries.find(c => c.code === user.country)?.name}{user.region ? ', ' + user.region : ''}
                  </p>
                )}
                <p className="text-gray-600"><span className="font-medium">Submitted:</span> {new Date(timesheet.submittedAt).toLocaleString()}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 p-1"><X className="w-6 h-6" /></button>
          </div>
        </div>
        <div className="p-6">
          <span className={'inline-block mb-4 px-4 py-2 rounded-full text-sm font-medium ' + (timesheet.status === 'approved' ? 'bg-green-100 text-green-800' : timesheet.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800')}>
            Status: {timesheet.status.charAt(0).toUpperCase() + timesheet.status.slice(1)}
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
          {(currentUser.role === 'manager' || currentUser.role === 'accountant') && timesheet.status !== 'rejected' && (
            <div className="mt-6 flex gap-3">
              {timesheet.status === 'pending' && (
                <button onClick={async () => { await onApproval(timesheet.id, 'approved'); onClose(); alert('Timesheet approved!'); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium">
                  <CheckCircle className="w-5 h-5" /> Approve Timesheet
                </button>
              )}
              <button onClick={async () => { if (!window.confirm('Reject this timesheet? The employee will need to resubmit.')) return; await onApproval(timesheet.id, 'rejected'); onClose(); alert('Timesheet rejected.'); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">
                <XCircle className="w-5 h-5" /> {timesheet.status === 'approved' ? 'Revoke & Reject' : 'Reject Timesheet'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
