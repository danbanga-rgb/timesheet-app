import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import type { Project, Timesheet, UserProfile } from '../../../types';
import { parseLocalDate } from '../../../lib/dates';
import { triggerDownload } from '../../../lib/csv';
import { buildConsolidatedReport } from '../../../lib/consolidatedReport';
import { buildConsolidatedCsv } from '../../../lib/consolidatedCsv';
import MonthRangePicker from '../../../components/MonthRangePicker';
import ConsolidatedTable from '../../../components/ConsolidatedTable';

// Accountant Consolidated tab. Renders an employee-by-week hours matrix
// filtered by date range + project + test-account exclusion, with 2 CSV
// exports (with-status / hours-only).
//
// Extracted from TimesheetSystem.tsx as Slice C5 of the accountant
// modularization arc (2026-09-16). All tab-local state moved inside
// (appliedRange, consolidatedProjectFilter, excludeTestAccounts,
// showConsolidatedExportMenu) — self-sufficient tab principle.

export interface ConsolidatedTabProps {
  timesheets: Timesheet[];
  users: UserProfile[];
  projects: Project[];
  countryName: (code: string) => string;
}

export default function ConsolidatedTab({ timesheets, users, projects, countryName }: ConsolidatedTabProps) {
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  const [consolidatedProjectFilter, setConsolidatedProjectFilter] = useState('all');
  const [excludeTestAccounts, setExcludeTestAccounts] = useState(true);
  const [showConsolidatedExportMenu, setShowConsolidatedExportMenu] = useState(false);

  const consolidatedReport = buildConsolidatedReport({
    timesheets, users, projects,
    range: appliedRange,
    countryName,
    userFilter: (u) => {
      if (u.role !== 'timesheetuser') return false;
      if (consolidatedProjectFilter === 'all') return true;
      if (consolidatedProjectFilter === 'unassigned') return !u.projectId;
      return String(u.projectId) === consolidatedProjectFilter;
    },
    excludeTestAccounts,
    includeSourceCounts: true,
  });

  const downloadConsolidatedCSV = (includeStatus: boolean) => {
    if (!consolidatedReport) return;
    const csv = buildConsolidatedCsv({ report: consolidatedReport, countryName, includeStatus });
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
      <div className="mb-6">
        <MonthRangePicker value={appliedRange} onChange={setAppliedRange} />
      </div>

      {consolidatedReport
        ? <ConsolidatedTable report={consolidatedReport} parseLocalDate={parseLocalDate} testAccounts={consolidatedReport.excludedTestNames} />
        : (
          <div className="text-center py-12 text-gray-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-base">Select a month or custom date range to see the report.</p>
          </div>
        )
      }
    </div>
  );
}
