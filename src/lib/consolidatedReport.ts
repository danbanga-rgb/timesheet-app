import type { Project, Timesheet, TimeEntry, UserProfile } from '../types';
import type { ConsolidatedReport } from '../components/ConsolidatedTable';
import { parseLocalDate, formatDate } from './dates';
import { isTestAccount } from './isTestAccount';

// Consolidated employee-by-week report. Shared between the Accountant
// Consolidated tab (project + test-account filtering + source counts) and
// the Manager Consolidated view (managed-users filter, no test exclusion,
// no source counts). Every week (Mon-Sun) that overlaps the range is
// included; weeks partially outside the range are marked in `partialWeeks`.
//
// Extracted from two 90%-identical copies (TS.tsx generateConsolidatedReport
// + ManagerView.tsx generateMgrReport) as Slice C3 of the accountant
// modularization arc (2026-09-16). Corrective per reusability-lens: Slice 3
// (Manager extract) copy-pasted this logic instead of extracting it.

export interface BuildConsolidatedReportInput {
  timesheets: Timesheet[];
  users: UserProfile[];
  projects: Project[];
  range: { start: string; end: string };
  /** Country-code -> display-name mapping (caller-owned lookup). */
  countryName: (code: string) => string;
  /** Which users appear as rows. Default: all users the caller passes in. */
  userFilter?: (u: UserProfile) => boolean;
  /** When true, timesheetuser test accounts are filtered out and their
   *  names are returned in `excludedTestNames`. Accountant-only. */
  excludeTestAccounts?: boolean;
  /** When true, adds Portal/Email source counts (Accountant-only KPI card). */
  includeSourceCounts?: boolean;
}

export interface BuildConsolidatedReportResult extends ConsolidatedReport {
  /** Test accounts excluded from the report when excludeTestAccounts=true. */
  excludedTestNames?: string[];
}

export function buildConsolidatedReport(input: BuildConsolidatedReportInput): BuildConsolidatedReportResult | null {
  const { timesheets, users, projects, range, countryName, userFilter, excludeTestAccounts, includeSourceCounts } = input;
  if (!range.start || !range.end) return null;

  const startD = parseLocalDate(range.start);
  const endD = parseLocalDate(range.end);

  // Include any week (Mon–Sun) that overlaps the range.
  const inRange = timesheets.filter(t => {
    const weekMon = parseLocalDate(t.weekStart);
    const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
    return weekMon <= endD && weekSun >= startD;
  });

  const weekEndings = [...new Set(inRange.map(t => t.weekStart))].sort();
  const partialWeeks = new Set<string>();
  weekEndings.forEach(we => {
    const weekMon = parseLocalDate(we);
    const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
    if (weekMon < startD || weekSun > endD) partialWeeks.add(we);
  });

  const baseUsers = userFilter ? users.filter(userFilter) : users;
  const excludedTestNames = excludeTestAccounts ? baseUsers.filter(u => isTestAccount(u.name)).map(u => u.name) : [];
  const rowUsers = excludeTestAccounts ? baseUsers.filter(u => !isTestAccount(u.name)) : baseUsers;

  const employeeRows = rowUsers.map(user => {
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
      } else {
        hours[we] = null; statuses[we] = 'not submitted';
      }
    });
    const latestTs = inRange.filter(t => t.userId === user.id).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    const project = projects.find(p => p.id === (latestTs?.projectId ?? user.projectId));
    return {
      name: user.name,
      country: countryName(user.country),
      project: project ? `${project.name} (${project.code})` : 'Not Assigned',
      hours,
      statuses,
      rowTotal,
    };
  });

  const colTotals: Record<string, number> = {};
  weekEndings.forEach(we => { colTotals[we] = employeeRows.reduce((s, r) => s + (r.hours[we] || 0), 0); });

  const result: BuildConsolidatedReportResult = {
    weekEndings,
    partialWeeks,
    employeeRows,
    colTotals,
    grandTotal: employeeRows.reduce((s, r) => s + r.rowTotal, 0),
  };
  if (excludeTestAccounts) result.excludedTestNames = excludedTestNames;
  if (includeSourceCounts) {
    result.sourceCounts = {
      portal: inRange.filter(t => t.source === 'direct' && !isTestAccount(users.find(u => u.id === t.userId)?.name ?? '')).length,
      email:  inRange.filter(t => t.source === 'imported' && !isTestAccount(users.find(u => u.id === t.userId)?.name ?? '')).length,
    };
  }
  return result;
}
