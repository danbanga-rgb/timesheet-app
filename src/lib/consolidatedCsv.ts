import type { BuildConsolidatedReportResult } from './consolidatedReport';
import { parseLocalDate } from './dates';

// Consolidated report CSV builder. Shared between the Accountant Consolidated
// tab (two variants: with-status columns / hours-only) and the Manager
// Consolidated view (always with-status). Format:
//
//   Employee,Country,Project,W/E …,[Status,][…,]Total Hours
//   row 1 …
//   TOTAL,"","",colTotal1,[…,]grandTotal
//
// Partial weeks label as "Partial W/E …".
//
// countryName is re-applied to row.country in the CSV even though the report
// already contains a display-name string. Per §1b-D T95 this is preserved
// byte-for-byte (countryName fallback returns its input, so double-applying
// is idempotent for known countries).
//
// Extracted from two 90%-identical inline builders as Slice C4 of the
// accountant modularization arc (2026-09-16). Depends on C3.

export interface BuildConsolidatedCsvInput {
  report: BuildConsolidatedReportResult;
  countryName: (code: string) => string;
  /** When true, adds a Status column per week. Default true (Manager). */
  includeStatus?: boolean;
}

export function buildConsolidatedCsv({ report, countryName, includeStatus = true }: BuildConsolidatedCsvInput): string {
  const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal } = report;
  let csv = 'Employee,Country,Project';
  weekEndings.forEach(we => {
    const weekMon = parseLocalDate(we);
    const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4);
    const label = partialWeeks.has(we)
      ? `Partial W/E ${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : `W/E ${weekFri.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    csv += includeStatus ? `,"${label}","Status"` : `,"${label}"`;
  });
  csv += ',Total Hours\n';
  employeeRows.forEach(row => {
    csv += `"${row.name}","${countryName(row.country)}","${row.project}"`;
    weekEndings.forEach(we => {
      const h = row.hours[we];
      const st = row.statuses[we];
      csv += includeStatus
        ? `,"${h !== null ? h.toFixed(1) : '-'}","${st}"`
        : `,"${h !== null ? h.toFixed(1) : '-'}"`;
    });
    csv += `,"${row.rowTotal.toFixed(1)}"\n`;
  });
  csv += '"TOTAL","",""';
  weekEndings.forEach(we => {
    csv += includeStatus ? `,"${colTotals[we].toFixed(1)}",""` : `,"${colTotals[we].toFixed(1)}"`;
  });
  csv += `,"${grandTotal.toFixed(1)}"\n`;
  return csv;
}
