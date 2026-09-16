import { describe, it, expect } from 'vitest';
import { buildConsolidatedCsv } from './consolidatedCsv';
import type { BuildConsolidatedReportResult } from './consolidatedReport';

const REPORT: BuildConsolidatedReportResult = {
  weekEndings: ['2026-01-05'],
  partialWeeks: new Set<string>(),
  employeeRows: [
    { name: 'Ana', country: 'Croatia', project: 'ProjA (PA)', hours: { '2026-01-05': 12 }, statuses: { '2026-01-05': 'approved' }, rowTotal: 12 },
    { name: 'Bob', country: 'United States', project: 'Not Assigned', hours: { '2026-01-05': 6 }, statuses: { '2026-01-05': 'pending' }, rowTotal: 6 },
  ],
  colTotals: { '2026-01-05': 18 },
  grandTotal: 18,
};
const noop = (c: string) => c;

describe('buildConsolidatedCsv (C4)', () => {
  it('includes Status column and Total Hours', () => {
    const csv = buildConsolidatedCsv({ report: REPORT, countryName: noop, includeStatus: true });
    expect(csv).toContain('W/E Jan 9, 2026","Status"');
    expect(csv).toContain('Total Hours');
    expect(csv).toContain('"Ana","Croatia","ProjA (PA)","12.0","approved","12.0"');
    expect(csv).toContain('"TOTAL","","","18.0","","18.0"');
  });

  it('hours-only variant skips the Status column', () => {
    const csv = buildConsolidatedCsv({ report: REPORT, countryName: noop, includeStatus: false });
    expect(csv).toContain('W/E Jan 9, 2026"');
    expect(csv).not.toContain('"Status"');
    expect(csv).toContain('"Ana","Croatia","ProjA (PA)","12.0","12.0"');
    expect(csv).toContain('"TOTAL","","","18.0","18.0"');
  });

  it('labels partial weeks with the Partial prefix', () => {
    const rep: BuildConsolidatedReportResult = {
      ...REPORT,
      partialWeeks: new Set(['2026-01-05']),
    };
    const csv = buildConsolidatedCsv({ report: rep, countryName: noop });
    expect(csv).toContain('"Partial W/E Jan 9, 2026"');
  });
});
