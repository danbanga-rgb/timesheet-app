import { describe, it, expect } from 'vitest';
import { buildConsolidatedReport } from './consolidatedReport';
import type { Project, Timesheet, UserProfile } from '../types';

const U = (over: Partial<UserProfile>): UserProfile => ({
  id: 'u', username: '', name: '', role: 'timesheetuser', managerId: null,
  email: '', country: 'US', region: '', projectId: null, startDate: '2025-01-01',
  endDate: null, phone: null, emailApprovalsEnabled: false, invoiceEnabled: false,
  remindersEnabled: true, vendorManagerId: null, lastLogin: null, paymentTerms: null,
  locationType: null, ...over,
});
const P = (over: Partial<Project>): Project => ({ id: 1, name: 'X', code: 'X', status: 'active', description: '', ...over });
const TS = (over: Partial<Timesheet>): Timesheet => ({
  id: 1, userId: 'u', userName: '', projectId: null, weekStart: '2026-01-05',
  entries: {}, status: 'approved', source: 'direct', submittedAt: '2026-01-01',
  approvedAt: null, lockedDays: null, ...over,
});
const country = (c: string) => c === 'US' ? 'United States' : c === 'HR' ? 'Croatia' : c;

const USERS: UserProfile[] = [
  U({ id: 'ana',   name: 'Ana',      country: 'HR' }),
  U({ id: 'bob',   name: 'Bob',      country: 'US' }),
  U({ id: 'test',  name: 'test', country: 'US' }), // test account (matches isTestAccount by name)
];
const PROJECTS: Project[] = [P({ id: 1, name: 'ProjA', code: 'PA' })];

const TIMESHEETS: Timesheet[] = [
  TS({ id: 1, userId: 'ana', userName: 'Ana', weekStart: '2026-01-05', entries: { '2026-01-05': { hours: '8' }, '2026-01-06': { hours: '4' } }, status: 'approved', source: 'direct' }),
  TS({ id: 2, userId: 'bob', userName: 'Bob', weekStart: '2026-01-05', entries: { '2026-01-05': { hours: '6' } }, status: 'pending', source: 'imported' }),
  TS({ id: 3, userId: 'test', userName: 'test', weekStart: '2026-01-05', entries: { '2026-01-05': { hours: '10' } }, status: 'approved', source: 'direct' }),
];

const RANGE = { start: '2026-01-05', end: '2026-01-11' };

describe('buildConsolidatedReport (C3)', () => {
  it('returns null when range is missing', () => {
    expect(buildConsolidatedReport({ timesheets: [], users: [], projects: [], range: { start: '', end: '' }, countryName: country })).toBeNull();
  });

  it('Accountant mode: excludeTestAccounts + includeSourceCounts', () => {
    const r = buildConsolidatedReport({
      timesheets: TIMESHEETS, users: USERS, projects: PROJECTS, range: RANGE, countryName: country,
      userFilter: u => u.role === 'timesheetuser',
      excludeTestAccounts: true,
      includeSourceCounts: true,
    })!;
    expect(r.weekEndings).toEqual(['2026-01-05']);
    expect(r.partialWeeks.size).toBe(0);
    expect(r.employeeRows.map(row => row.name).sort()).toEqual(['Ana', 'Bob']);
    expect(r.excludedTestNames).toEqual(['test']);
    // sourceCounts also excludes test users' contribution
    expect(r.sourceCounts).toEqual({ portal: 1, email: 1 });
    expect(r.grandTotal).toBe(18); // Ana 12 + Bob 6
  });

  it('Manager mode: userFilter to managed users, no test exclusion, no source counts', () => {
    const managedIds = new Set(['ana']);
    const r = buildConsolidatedReport({
      timesheets: TIMESHEETS, users: USERS, projects: PROJECTS, range: RANGE, countryName: country,
      userFilter: u => managedIds.has(u.id),
    })!;
    expect(r.employeeRows.map(row => row.name)).toEqual(['Ana']);
    expect(r.excludedTestNames).toBeUndefined();
    expect(r.sourceCounts).toBeUndefined();
    expect(r.grandTotal).toBe(12);
  });

  it('marks partial weeks when range boundary splits a week', () => {
    // Range Wed 2026-01-07 -> Fri 2026-01-09 splits the Mon-Sun week 2026-01-05
    const r = buildConsolidatedReport({
      timesheets: TIMESHEETS, users: USERS, projects: PROJECTS, range: { start: '2026-01-07', end: '2026-01-09' },
      countryName: country,
      userFilter: u => u.role === 'timesheetuser', excludeTestAccounts: true,
    })!;
    expect(r.partialWeeks.has('2026-01-05')).toBe(true);
    // Ana's hours only include days within Wed-Fri (nothing entered → 0)
    const ana = r.employeeRows.find(x => x.name === 'Ana')!;
    expect(ana.hours['2026-01-05']).toBe(0);
    // Bob's Monday entry (2026-01-05) is outside Wed-Fri → 0
    const bob = r.employeeRows.find(x => x.name === 'Bob')!;
    expect(bob.hours['2026-01-05']).toBe(0);
  });

  it('marks n/a status for weeks before user start or after user end', () => {
    // User starts 2026-02-01, has no timesheet yet in the Jan 5 week —
    // status must be n/a (not 'not submitted') because their record didn't
    // exist during that week.
    const usersWithStart = [U({ id: 'late', name: 'Late', startDate: '2026-02-01' })];
    // Range must produce a weekEnding (needs some timesheet in-range from any user)
    const decoyTs = TS({ id: 5, userId: 'someone-else', weekStart: '2026-01-05', entries: {} });
    const r = buildConsolidatedReport({
      timesheets: [decoyTs],
      users: usersWithStart, projects: PROJECTS, range: RANGE, countryName: country,
    })!;
    expect(r.employeeRows[0].statuses['2026-01-05']).toBe('n/a');
  });

  it('resolves project via latest timesheet projectId, falling back to user.projectId', () => {
    const usersWithProject = [U({ id: 'ana', name: 'Ana', projectId: 1 })];
    const r = buildConsolidatedReport({
      timesheets: [TS({ id: 1, userId: 'ana', weekStart: '2026-01-05', entries: {}, projectId: 1 })],
      users: usersWithProject, projects: PROJECTS, range: RANGE, countryName: country,
    })!;
    expect(r.employeeRows[0].project).toBe('ProjA (PA)');
  });
});
