import StickyScrollWrapper from './StickyScrollWrapper';

// Consolidated employee-by-week hours table with a leading KPI grid.
// Used by both the accountant Consolidated tab and the Manager Consolidated
// view. Rendering-only — all filtering / summing / statuses come from the
// caller-provided `report` object.
//
// Extracted from TimesheetSystem.tsx as Slice C2 of the accountant
// modularization arc (2026-09-16). Depends on W1 (StickyScrollWrapper).

export interface ConsolidatedReport {
  weekEndings: string[];
  partialWeeks: Set<string>;
  employeeRows: {
    name: string;
    country: string;
    project: string;
    hours: Record<string, number | null>;
    statuses: Record<string, string>;
    rowTotal: number;
  }[];
  colTotals: Record<string, number>;
  grandTotal: number;
  sourceCounts?: { portal: number; email: number };
}

export interface ConsolidatedTableProps {
  report: ConsolidatedReport;
  parseLocalDate: (s: string) => Date;
  testAccounts?: string[];
}

export default function ConsolidatedTable({ report, parseLocalDate, testAccounts = [] }: ConsolidatedTableProps) {
  const { weekEndings, partialWeeks, employeeRows, colTotals, grandTotal, sourceCounts } = report;
  const allStatuses = employeeRows.flatMap(r => Object.values(r.statuses));
  const approvedCells  = allStatuses.filter(s => s === 'approved').length;
  const pendingCells   = allStatuses.filter(s => s === 'pending').length;
  const notSubCells    = allStatuses.filter(s => s === 'not submitted').length;
  const rejectedCells  = allStatuses.filter(s => s === 'rejected').length;
  return (
    <div>
      <div className={`grid grid-cols-2 ${sourceCounts ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4 mb-6`}>
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600">Weeks</div>
          <div className="text-2xl font-bold text-blue-600">{weekEndings.length}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Total Hours</div><div className="text-2xl font-bold text-green-600">{grandTotal.toFixed(1)}h</div></div>
        <div className="bg-purple-50 p-4 rounded-lg">
          <div className="text-sm text-gray-600 mb-1">Employees</div>
          <div className="text-2xl font-bold text-purple-600 mb-2">{employeeRows.length}</div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-green-700">Approved</span><span className="font-semibold text-green-700">{approvedCells}</span></div>
            {pendingCells  > 0 && <div className="flex justify-between"><span className="text-yellow-700">Pending</span><span className="font-semibold text-yellow-700">{pendingCells}</span></div>}
            {notSubCells   > 0 && <div className="flex justify-between"><span className="text-red-600">Not Submitted</span><span className="font-semibold text-red-600">{notSubCells}</span></div>}
            {rejectedCells > 0 && <div className="flex justify-between"><span className="text-gray-500">Rejected</span><span className="font-semibold text-gray-500">{rejectedCells}</span></div>}
          </div>
          {testAccounts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-purple-200">
              <div className="text-xs text-gray-400 mb-1">Test (excluded)</div>
              <div className="flex flex-wrap gap-1">
                {testAccounts.map(name => <span key={name} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-400 text-xs rounded">{name}</span>)}
              </div>
            </div>
          )}
        </div>
        <div className="bg-amber-50 p-4 rounded-lg"><div className="text-sm text-gray-600">Avg Hrs/Employee</div><div className="text-2xl font-bold text-amber-600">{employeeRows.length > 0 ? (grandTotal / employeeRows.length).toFixed(1) : 0}h</div></div>
        {sourceCounts && (() => {
          const total = sourceCounts.portal + sourceCounts.email;
          return (
            <div className="bg-indigo-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Submission Channels</div>
              <div className="text-2xl font-bold text-indigo-600 mb-3">{total} <span className="text-sm font-normal text-gray-400">submitted</span></div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-indigo-700">Portal</span>
                  <span className="font-semibold text-indigo-700">
                    {sourceCounts.portal}
                    {total > 0 && <span className="text-gray-400 font-normal ml-1">({Math.round(sourceCounts.portal / total * 100)}%)</span>}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-blue-700">Email</span>
                  <span className="font-semibold text-blue-700">
                    {sourceCounts.email}
                    {total > 0 && <span className="text-gray-400 font-normal ml-1">({Math.round(sourceCounts.email / total * 100)}%)</span>}
                  </span>
                </div>
                {total > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-blue-200 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round(sourceCounts.portal / total * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
      {partialWeeks.size > 0 && (
        <div className="flex items-center gap-2 mb-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="font-semibold">Partial</span> weeks include only the working days that fall within the selected date range.
        </div>
      )}
      <StickyScrollWrapper maxHeight="calc(100vh - 320px)">
        <table className="border-collapse text-sm w-full">
          <thead className="sticky top-0 z-20">
            <tr className="bg-green-600 text-white">
              <th className="border border-green-700 px-3 py-2 text-left sticky left-0 z-30 bg-green-600">Employee</th>
              <th className="border border-green-700 px-3 py-2 text-left bg-green-600">Country</th>
              <th className="border border-green-700 px-3 py-2 text-left bg-green-600">Project</th>
              {weekEndings.map((we: string) => {
                const isPartial = partialWeeks.has(we);
                const weekMon = parseLocalDate(we);
                const weekFri = new Date(weekMon); weekFri.setDate(weekMon.getDate() + 4); // Keep for label
                const weekSun = new Date(weekMon); weekSun.setDate(weekMon.getDate() + 6);
                return (
                  <th key={we} className={`border border-green-700 px-3 py-2 text-center whitespace-nowrap ${isPartial ? 'bg-amber-600' : 'bg-green-600'}`}>
                    <div className="text-xs opacity-80">{isPartial ? 'Partial' : 'W/E'}</div>
                    <div>{weekSun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  </th>
                );
              })}
              <th className="border border-green-700 px-3 py-2 text-center bg-green-700">Total</th>
            </tr>
          </thead>
          <tbody>
            {employeeRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className={`border border-gray-300 px-3 py-2 font-semibold sticky left-0 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] ${ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{row.name}</td>
                <td className="border border-gray-300 px-3 py-2 text-gray-500">{row.country}</td>
                <td className="border border-gray-300 px-3 py-2 text-indigo-600 text-xs">{row.project}</td>
                {weekEndings.map((we: string) => {
                  const h = row.hours[we];
                  const st = row.statuses[we];
                  const isPartial = partialWeeks.has(we);
                  return (
                    <td key={we} className={`border border-gray-300 px-3 py-2 text-center ${isPartial ? 'bg-amber-50' : ''}`}>
                      {h !== null ? <span className={h > 0 ? 'font-semibold text-gray-800' : 'text-gray-400'}>{h.toFixed(1)}</span> : <span className="text-gray-300">-</span>}
                      {h !== null && st !== 'approved' && st !== 'not submitted' && (
                        <div className={'text-xs ' + (st === 'rejected' ? 'text-red-500' : 'text-amber-500')}>{st === 'pending' ? 'pend' : 'rej'}</div>
                      )}
                    </td>
                  );
                })}
                <td className="border border-gray-300 px-3 py-2 text-center font-bold text-green-700 bg-green-50">{row.rowTotal.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="bg-green-600 text-white font-bold">
              <td className="border border-green-700 px-3 py-2 sticky left-0 z-10 bg-green-600" colSpan={3}>Total</td>
              {weekEndings.map((we: string) => (
                <td key={we} className={`border border-green-700 px-3 py-2 text-center ${partialWeeks.has(we) ? 'bg-amber-600' : ''}`}>{colTotals[we].toFixed(1)}</td>
              ))}
              <td className="border border-green-700 px-3 py-2 text-center bg-green-700">{grandTotal.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </StickyScrollWrapper>
    </div>
  );
}
