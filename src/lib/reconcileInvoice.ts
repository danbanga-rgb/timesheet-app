// Live invoice reconciliation (pure, no DB writes). Called on every render
// so it always reflects the latest loaded timesheets. Extracted from
// TimesheetSystem.tsx in Slice I6 (2026-09-17) so the InvoicesTab can
// import it without pulling from TS.tsx (E5).

import type { Invoice, Timesheet, ReconTimesheetRow } from '../types';

export interface InvoiceReconResult {
  status: 'matched' | 'mismatch' | 'unverifiable';
  delta: number | null;
  timesheetHours: number | null;
  rows: ReconTimesheetRow[];
  missingWeeks: number;
}

export function reconcileInvoiceLive(
  invoice: Invoice,
  allTimesheets: Timesheet[],
): InvoiceReconResult {
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

  // "Missing" = no timesheet submitted for that week, NOT "submitted with 0 hours".
  // A 0-hour approved timesheet is a valid submission (LOA, PTO, no work that week) and
  // should not inflate the missing count. Bojan Jun 1 example: he submitted approved 0h,
  // was showing as missing alongside the current unsubmitted week.
  const weeksWithSubmission = new Set(rows.map(r => r.ts.weekStart));
  const missingWeeks = expectedWeeks.filter(w => !weeksWithSubmission.has(w)).length;

  if (tsHours === 0) return { status: 'unverifiable', delta: null, timesheetHours: 0, rows, missingWeeks };
  if (totalHours == null) return { status: 'unverifiable', delta: null, timesheetHours: tsHours, rows, missingWeeks };

  const delta = Math.round((totalHours - tsHours) * 100) / 100;
  const matched = Math.abs(delta) < 0.01;
  return { status: matched ? 'matched' : 'mismatch', delta: matched ? 0 : delta, timesheetHours: tsHours, rows, missingWeeks };
}
