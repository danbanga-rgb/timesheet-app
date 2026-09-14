// invoiceLines — pure logic for turning approved timesheets into invoice lines.
//
// Extracted from TimesheetSystem.tsx buildInvoiceLines() 2026-09-14 so the
// Manual Invoice modal can reuse the same partial-week splitting.
//
// Behavior:
// - Includes any week whose Mon–Sun window overlaps [periodStart, periodEnd].
// - For each week, sums only the day-cells that fall within the period.
// - Emits one InvoiceLine per week whose in-period hours > 0.
// - weekEndingFri is Monday + 4 (Friday) — the canonical invoice-line label
//   used by the accountant review modal and downstream reports.

export interface InvoiceLine {
  weekStart: string;         // YYYY-MM-DD (Monday)
  weekEndingFri: string;     // YYYY-MM-DD (Friday)
  hours: number | null;
  rate: number | null;
  amount: number;
  userId?: string;
  userName?: string;
}

interface TimesheetInput {
  userId: string;
  weekStart: string;
  status: string;
  entries: Record<string, { hours: string }>;
}

// Parses YYYY-MM-DD as a LOCAL date. Avoids the UTC-offset bug that
// `new Date('YYYY-MM-DD')` introduces. Matches parseLocalDate in TimesheetSystem.
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildInvoiceLines(
  timesheets: TimesheetInput[],
  userId: string,
  periodStart: string,
  periodEnd: string,
  rate: number,
): InvoiceLine[] {
  const startD = parseLocalDate(periodStart);
  const endD = parseLocalDate(periodEnd);
  const userTimesheets = timesheets.filter(t => {
    if (t.userId !== userId || t.status !== 'approved') return false;
    const weekMon = parseLocalDate(t.weekStart);
    const weekSun = new Date(weekMon);
    weekSun.setDate(weekMon.getDate() + 6);
    return weekMon <= endD && weekSun >= startD;
  });
  return userTimesheets
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map(ts => {
      const weekMon = parseLocalDate(ts.weekStart);
      const weekFri = new Date(weekMon);
      weekFri.setDate(weekMon.getDate() + 4);
      let hours = 0;
      Object.entries(ts.entries).forEach(([dateKey, entry]) => {
        const d = parseLocalDate(dateKey);
        if (d >= startD && d <= endD) {
          hours += parseFloat(entry?.hours || '0');
        }
      });
      return {
        weekStart: ts.weekStart,
        weekEndingFri: formatDate(weekFri),
        hours: parseFloat(hours.toFixed(2)),
        rate,
        amount: parseFloat((hours * rate).toFixed(2)),
      };
    })
    .filter(l => (l.hours ?? 0) > 0);
}
