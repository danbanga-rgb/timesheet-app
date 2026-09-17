import { useEffect, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, FileText, Download, UploadCloud, ArrowUpDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from '../../../../supabaseClient';
import type { Project, Timesheet, UserProfile } from '../../../../types';
import ClientInvoiceModal, {
  type EstimationClient,
  type ClientInvoiceLine,
  type ClientInvoiceModalState,
} from './ClientInvoiceModal';

// Accountant Client Estimation tab (Path B "as-is" encapsulation).
//
// Extracted from TimesheetSystem.tsx as Slice CEP2 of the accountant
// modularization arc (2026-09-17). Ten tab-local hooks moved inside:
// estimationMonth, estimationClients, estimationEngagements,
// estimationLoading, estimationError, estimationSort, estimationOverrides,
// estimationImportPreview, estimationImportApplying, invoiceModal.
// On-tab-open estimation load effect moved inside too (accountantTab gate
// dropped -- tab is conditionally mounted, so the effect only runs when
// mounted). ClientInvoiceModal split into sibling file; portal mount
// preserved per Q4.4.

export interface ClientEstimationTabProps {
  users: UserProfile[];
  projects: Project[];
  timesheets: Timesheet[];
  currentUser: UserProfile;
}

type EstimationEngagement = {
  id: number; client_id: number; user_id: string;
  role_title: string; sow_reference: string | null; bill_rate: number;
};

type EstimationImportPreview = {
  clientId: number; clientName: string;
  diffs: Array<{ engagementId: number; contractorName: string; weekLabel: string; weekStart: string; currentHours: number; newHours: number }>;
};

export default function ClientEstimationTab({ users, projects, timesheets, currentUser }: ClientEstimationTabProps) {
  const [estimationMonth, setEstimationMonth] = useState(() => {
    const d = new Date();
    d.setDate(1); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [estimationClients, setEstimationClients] = useState<EstimationClient[]>([]);
  const [estimationEngagements, setEstimationEngagements] = useState<EstimationEngagement[]>([]);
  const [estimationLoading, setEstimationLoading] = useState(false);
  const [estimationError, setEstimationError] = useState<string | null>(null);
  const [estimationSort, setEstimationSort] = useState<{col: 'name' | 'rate' | 'hours' | 'amount', dir: 'asc' | 'desc'}>({col: 'name', dir: 'asc'});
  const [estimationOverrides, setEstimationOverrides] = useState<Map<number, Map<string, number>>>(new Map());
  const [estimationImportPreview, setEstimationImportPreview] = useState<EstimationImportPreview | null>(null);
  const [estimationImportApplying, setEstimationImportApplying] = useState(false);
  const [invoiceModal, setInvoiceModal] = useState<ClientInvoiceModalState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEstimationLoading(true);
      setEstimationError(null);
      try {
        const [yr, mo] = estimationMonth.split('-').map(Number);
        const mStart = `${estimationMonth}-01`;
        const lastD = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
        const mEnd = `${estimationMonth}-${String(lastD).padStart(2, '0')}`;
        const walker0 = new Date(mStart + 'T12:00:00Z');
        const dow0 = walker0.getUTCDay();
        walker0.setUTCDate(walker0.getUTCDate() - (dow0 === 0 ? 6 : dow0 - 1));
        const firstMonday = walker0.toISOString().slice(0, 10);

        const [cRes, eRes, oRes] = await Promise.all([
          supabase.from('clients').select('id,name,payment_terms_days,retention_credit_pct,bill_to_name,bill_to_attn,address_line1,address_line2,city,state,zip,po_number,sales_tax_rate,invoice_format_type,show_investment_credit_running_total,retention_per_hour,investment_credit_running').order('name'),
          supabase.from('client_engagements').select('id,client_id,user_id,role_title,sow_reference,bill_rate'),
          supabase.from('hour_overrides').select('engagement_id,week_start,hours_override')
            .gte('week_start', firstMonday).lte('week_start', mEnd),
        ]);
        if (cancelled) return;
        if (cRes.error) throw new Error(`clients: ${cRes.error.message}`);
        if (eRes.error) throw new Error(`engagements: ${eRes.error.message}`);
        if (oRes.error) throw new Error(`overrides: ${oRes.error.message}`);
        setEstimationClients(cRes.data || []);
        setEstimationEngagements(eRes.data || []);
        const oMap = new Map<number, Map<string, number>>();
        for (const o of (oRes.data || [])) {
          if (!oMap.has(o.engagement_id)) oMap.set(o.engagement_id, new Map());
          oMap.get(o.engagement_id)!.set(o.week_start, Number(o.hours_override));
        }
        setEstimationOverrides(oMap);
      } catch (e) {
        if (!cancelled) setEstimationError(String((e as Error).message || e));
      } finally {
        if (!cancelled) setEstimationLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [estimationMonth]);

  const [year, monthN] = estimationMonth.split('-').map(Number);
  const monthStart = `${estimationMonth}-01`;
  const lastDay = new Date(Date.UTC(year, monthN, 0)).getUTCDate();
  const monthEnd = `${estimationMonth}-${String(lastDay).padStart(2, '0')}`;
  const monthLabel = new Date(Date.UTC(year, monthN - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const perDayHours = (userId: string): Record<string, number> => {
    const days: Record<string, number> = {};
    for (const ts of timesheets) {
      if (ts.userId !== userId) continue;
      for (const [d, v] of Object.entries(ts.entries || {})) {
        if (d < monthStart || d > monthEnd) continue;
        let n = 0;
        if (typeof v === 'number') n = v;
        else if (v && typeof v === 'object') {
          const raw = (v as { hours?: string | number }).hours;
          n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? 0));
        }
        if (isFinite(n) && n > 0) days[d] = (days[d] || 0) + n;
      }
    }
    return days;
  };

  type WeekBucket = { label: string; days: string[]; weekStart: string };
  const weeks: WeekBucket[] = [];
  const walker = new Date(monthStart + 'T12:00:00Z');
  const wDow = walker.getUTCDay();
  walker.setUTCDate(walker.getUTCDate() - (wDow === 0 ? 6 : wDow - 1));
  while (walker.toISOString().slice(0, 10) <= monthEnd) {
    const start = new Date(walker);
    const wDays: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cur = new Date(start);
      cur.setUTCDate(start.getUTCDate() + i);
      const cs = cur.toISOString().slice(0, 10);
      if (cs >= monthStart && cs <= monthEnd) wDays.push(cs);
    }
    if (wDays.length > 0) {
      const wkEnd = new Date(start); wkEnd.setUTCDate(start.getUTCDate() + 6);
      weeks.push({
        label: `${start.getUTCDate()}–${wkEnd.getUTCDate() > lastDay ? lastDay : wkEnd.getUTCDate()}`,
        weekStart: start.toISOString().slice(0, 10),
        days: wDays,
      });
    }
    walker.setUTCDate(walker.getUTCDate() + 7);
  }

  type CellSource = 'actual' | 'estimated' | 'outside' | 'override';
  type Cell = { hours: number; source: CellSource };
  const cellFor = (userId: string, day: string, actuals: Record<string, number>): Cell => {
    const profile = users.find(u => u.id === userId);
    const start = profile?.startDate;
    const end   = profile?.endDate;
    if ((start && day < start) || (end && day > end)) return { hours: 0, source: 'outside' };
    const h = actuals[day];
    if (h != null && h > 0) return { hours: h, source: 'actual' };
    const days = Object.values(actuals);
    const monthlyMax = days.length ? Math.max(...days) : 0;
    return { hours: Math.max(8, monthlyMax || 0), source: 'estimated' };
  };

  const userById = new Map(users.map(u => [u.id, u]));

  const engagementsByProject = new Map<number, EstimationEngagement[]>();
  for (const e of estimationEngagements) {
    const user = userById.get(e.user_id);
    const pid = user?.projectId;
    if (pid) {
      if (!engagementsByProject.has(pid)) engagementsByProject.set(pid, []);
      engagementsByProject.get(pid)!.push(e);
    }
  }
  const projectsWithEngagements = projects
    .filter(p => (engagementsByProject.get(p.id) || []).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const cellColor = (source: CellSource) => (
    source === 'actual' ? 'bg-green-50 text-green-800'
    : source === 'estimated' ? 'bg-yellow-50 text-yellow-800'
    : source === 'override' ? 'bg-blue-50 text-blue-800'
    : 'bg-gray-100 text-gray-400'
  );

  const currencyFmt = (n: number) => n.toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits: 0 });

  return (
    <div className="bg-white rounded-lg shadow-md p-3 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <Building2 className="w-6 h-6" /> Client Estimation — {monthLabel}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(Date.UTC(year, monthN - 2, 1));
              setEstimationMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
            }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 border border-gray-300"
            title="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="month"
            value={estimationMonth}
            onChange={(e) => e.target.value && setEstimationMonth(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-32"
          />
          <button
            onClick={() => {
              const d = new Date(Date.UTC(year, monthN, 1));
              setEstimationMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
            }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600 border border-gray-300"
            title="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(1); d.setMonth(d.getMonth() - 1);
              setEstimationMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
            }}
            className="ml-2 px-2 py-1 rounded text-xs text-indigo-600 hover:bg-indigo-50 border border-indigo-200"
            title="Jump to previous month"
          >
            Previous
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-4">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-green-50 border border-green-300 rounded" /> actual</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-yellow-50 border border-yellow-300 rounded" /> estimated (max(8, monthly max))</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-gray-100 border border-gray-300 rounded" /> outside start/end</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 bg-blue-50 border border-blue-300 rounded" /> override (imported)</span>
      </div>

      {estimationLoading && <div className="text-gray-500">Loading client engagement data…</div>}

      {estimationError && !estimationLoading && (
        <div className="text-red-700 bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm">
          Error loading data: {estimationError}
        </div>
      )}

      {!estimationLoading && !estimationError && projectsWithEngagements.length === 0 && (
        <div className="text-gray-500 italic">No projects with engagements yet.</div>
      )}

      {!estimationLoading && projectsWithEngagements.map(project => {
        const engs = engagementsByProject.get(project.id) || [];
        if (engs.length === 0) return null;
        const clientIdForProject = engs[0].client_id;
        const client = estimationClients.find(c => c.id === clientIdForProject);
        if (!client) return null;
        let clientTotalHours = 0;
        let clientTotalAmount = 0;

        const rowsWithTotals = engs.map(e => {
          const profile = userById.get(e.user_id);
          const actuals = profile ? perDayHours(e.user_id) : {};
          const engOverrides = estimationOverrides.get(e.id);
          const weekTotals = weeks.map(w => {
            const override = engOverrides?.get(w.weekStart);
            if (override !== undefined) return { hours: override, source: 'override' as CellSource };
            let sum = 0;
            const cells = w.days.map(d => cellFor(e.user_id, d, actuals));
            for (const c of cells) if (c.source !== 'outside') sum += c.hours;
            const dominant: CellSource = cells.some(c => c.source === 'actual') ? 'actual'
              : cells.some(c => c.source === 'estimated') ? 'estimated' : 'outside';
            return { hours: sum, source: dominant };
          });
          const totalH = weekTotals.reduce((a, b) => a + b.hours, 0);
          const amount = totalH * Number(e.bill_rate);
          return { eng: e, profile, actuals, weekTotals, totalH, amount };
        }).filter(r => r.profile);

        const sortMult = estimationSort.dir === 'asc' ? 1 : -1;
        rowsWithTotals.sort((a, b) => {
          if (estimationSort.col === 'name')   return a.profile!.name.localeCompare(b.profile!.name) * sortMult;
          if (estimationSort.col === 'rate')   return (Number(a.eng.bill_rate) - Number(b.eng.bill_rate)) * sortMult;
          if (estimationSort.col === 'hours')  return (a.totalH - b.totalH) * sortMult;
          if (estimationSort.col === 'amount') return (a.amount - b.amount) * sortMult;
          return 0;
        });

        const cycleSort = (col: 'name' | 'rate' | 'hours' | 'amount') => {
          if (estimationSort.col === col) setEstimationSort({col, dir: estimationSort.dir === 'asc' ? 'desc' : 'asc'});
          else setEstimationSort({col, dir: col === 'name' ? 'asc' : 'desc'});
        };
        const sortIcon = (col: 'name' | 'rate' | 'hours' | 'amount') => {
          if (estimationSort.col !== col) return <ArrowUpDown className="w-3 h-3 inline-block opacity-30 ml-1" />;
          return estimationSort.dir === 'asc'
            ? <span className="ml-1 text-indigo-600">↑</span>
            : <span className="ml-1 text-indigo-600">↓</span>;
        };

        return (
          <div key={project.id} className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-indigo-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
              <div>
                <div className="font-semibold text-indigo-900">{project.name} <span className="text-indigo-600 font-normal text-sm">· {project.code}</span></div>
                <div className="text-xs text-indigo-700">Client: {client.name}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-xs text-indigo-700">
                  NET {client.payment_terms_days}
                  {client.retention_credit_pct > 0 && <span className="ml-2">· {client.retention_credit_pct}% retention</span>}
                  <span className="ml-3">{engs.length} contractor{engs.length !== 1 ? 's' : ''}</span>
                </div>
                <button
                  onClick={() => {
                    const invDate = new Date().toISOString().slice(0, 10);
                    const terms = client.payment_terms_days || 30;
                    const due = new Date(); due.setDate(due.getDate() + terms);
                    const dueStr = due.toISOString().slice(0, 10);
                    const addr = [client.address_line1, client.address_line2, [client.city, client.state, client.zip].filter(Boolean).join(', ')].filter((s): s is string => !!s && s.length > 0);
                    const perStart = `${estimationMonth}-01`;
                    const [ey, em] = estimationMonth.split('-').map(Number);
                    const perEnd = new Date(Date.UTC(ey, em, 0)).toISOString().slice(0, 10);
                    const lines: ClientInvoiceLine[] = rowsWithTotals.map(({ eng, profile, weekTotals, totalH }) => {
                      const rate = Number(eng.bill_rate);
                      const hoursActual = weekTotals.reduce((a, b) => a + b.hours, 0);
                      return {
                        id: `eng-${eng.id}`,
                        engagementId: eng.id,
                        contractorName: profile!.name,
                        roleTitle: eng.role_title || '',
                        sowCode: eng.sow_reference || '',
                        hours: Math.round(hoursActual * 100) / 100,
                        rate,
                        amount: Math.round(totalH * rate * 100) / 100,
                        amountOverridden: false,
                        periodStart: perStart,
                        periodEnd: perEnd,
                      };
                    });
                    setInvoiceModal({
                      client,
                      projectName: project.name,
                      projectCode: project.code,
                      monthLabel,
                      periodStart: perStart,
                      periodEnd: perEnd,
                      meta: {
                        invoiceNumber: '',
                        invoiceDate: invDate,
                        dueDate: dueStr,
                        poNumber: client.po_number || '',
                        billToName: client.bill_to_name || client.name,
                        billToAttn: client.bill_to_attn || '',
                        addressLines: addr,
                        memo: '',
                      },
                      lines,
                      retentionPerHour: Number(client.retention_per_hour || 0),
                      investmentCreditPrior: Number(client.investment_credit_running || 0),
                      salesTaxRate: Number(client.sales_tax_rate || 0),
                    });
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-700"
                  title="Open a printable invoice for this client and month"
                >
                  <FileText className="w-3 h-3" /> Generate Invoice
                </button>
                <button
                  onClick={() => {
                    const wb = XLSX.utils.book_new();
                    const rows = [
                      ['Client', client.name],
                      ['Month', monthLabel],
                      ['Generated', new Date().toISOString().slice(0, 10)],
                      [],
                      ['engagement_id', 'user_id', 'Contractor', 'SOW', 'Rate ($/h)', ...weeks.map(w => `Wk ${w.label}`), 'Total Hours', 'Amount ($)'],
                      ['', '', '', '', '', ...weeks.map(w => w.weekStart), '', ''],
                      ...rowsWithTotals.map(({eng, profile, weekTotals, totalH, amount}) => [
                        eng.id,
                        eng.user_id,
                        profile!.name,
                        eng.sow_reference || '',
                        Number(eng.bill_rate),
                        ...weekTotals.map(wt => wt.hours),
                        totalH,
                        Math.round(amount * 100) / 100,
                      ]),
                      [],
                      ['', '', 'Client Total:', '', '', ...weeks.map(() => ''), clientTotalHours, Math.round(clientTotalAmount * 100) / 100],
                    ];
                    const ws = XLSX.utils.aoa_to_sheet(rows);
                    ws['!cols'] = [{ hidden: true }, { hidden: true }, { wch: 26 }, { wch: 8 }, { wch: 10 }, ...weeks.map(() => ({ wch: 10 })), { wch: 12 }, { wch: 14 }];
                    ws['!rows'] = [undefined, undefined, undefined, undefined, undefined, { hpx: 0 }] as NonNullable<typeof ws['!rows']>;
                    XLSX.utils.book_append_sheet(wb, ws, client.name.slice(0, 30).replace(/[/\\?*[\]]/g, '_'));
                    const fname = `${client.name.replace(/[^\w-]/g, '_')}_estimation_${estimationMonth}.xlsx`;
                    XLSX.writeFile(wb, fname);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100"
                  title="Download this client's grid as XLSX"
                >
                  <Download className="w-3 h-3" /> Export XLSX
                </button>
                <label className="cursor-pointer flex items-center gap-1 px-2 py-1 rounded text-xs bg-white border border-green-300 text-green-700 hover:bg-green-50">
                  <UploadCloud className="w-3 h-3" /> Import corrected
                  <input type="file" accept=".xlsx" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = '';
                    try {
                      const buf = await file.arrayBuffer();
                      const wb2 = XLSX.read(new Uint8Array(buf), { type: 'array' });
                      const ws2 = wb2.Sheets[wb2.SheetNames[0]];
                      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws2, { header: 1, defval: '' });
                      const fileMonth = String((aoa[1] as unknown[])?.[1] ?? '');
                      if (fileMonth !== monthLabel) {
                        alert(`This file is for "${fileMonth}", but you're viewing ${monthLabel}. Please import the correct file.`);
                        return;
                      }
                      if ((aoa[4] as unknown[])?.[0] !== 'engagement_id') {
                        alert('Unrecognized file format — please export a fresh copy and try again.');
                        return;
                      }
                      const weekStartRow = (aoa[5] as string[]) || [];
                      const weekStartsByCol = new Map<number, string>();
                      for (let c = 5; c < weekStartRow.length - 2; c++) {
                        if (weekStartRow[c]) weekStartsByCol.set(c, String(weekStartRow[c]));
                      }
                      if (weekStartsByCol.size === 0) {
                        alert('This file was exported before the import feature was added. Please export a fresh copy.');
                        return;
                      }
                      const currentTotals = new Map<number, Map<string, { hours: number; label: string }>>();
                      for (const { eng: re, weekTotals: rwt } of rowsWithTotals) {
                        const wm = new Map<string, { hours: number; label: string }>();
                        for (let i = 0; i < weeks.length; i++) {
                          wm.set(weeks[i].weekStart, { hours: rwt[i].hours, label: weeks[i].label });
                        }
                        currentTotals.set(re.id, wm);
                      }
                      const diffs: EstimationImportPreview['diffs'] = [];
                      for (let r = 6; r < aoa.length; r++) {
                        const row = aoa[r] as unknown[];
                        const engId = Number(row[0]);
                        if (!engId) break;
                        const engRow = rowsWithTotals.find(rr => rr.eng.id === engId);
                        if (!engRow) continue;
                        weekStartsByCol.forEach((weekStart, col) => {
                          const importedH = Number(row[col]);
                          const cur = currentTotals.get(engId)?.get(weekStart);
                          if (!cur || Math.abs(importedH - cur.hours) < 0.01) return;
                          diffs.push({ engagementId: engId, contractorName: engRow.profile!.name, weekLabel: cur.label, weekStart, currentHours: cur.hours, newHours: importedH });
                        });
                      }
                      if (diffs.length === 0) {
                        alert('No changes detected — the imported file matches the current values.');
                        return;
                      }
                      setEstimationImportPreview({ clientId: client.id, clientName: client.name, diffs });
                    } catch (err) {
                      alert(`Failed to read file: ${(err as Error).message}`);
                    }
                  }} />
                </label>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 cursor-pointer select-none hover:bg-gray-100" onClick={() => cycleSort('name')}>
                      Contractor{sortIcon('name')}
                    </th>
                    <th className="text-left px-2 py-2">SOW</th>
                    <th className="text-right px-2 py-2 cursor-pointer select-none hover:bg-gray-100" onClick={() => cycleSort('rate')}>
                      Rate{sortIcon('rate')}
                    </th>
                    {weeks.map(w => (
                      <th key={w.label} className="text-right px-2 py-2 whitespace-nowrap">Wk {w.label}</th>
                    ))}
                    <th className="text-right px-2 py-2 border-l border-gray-300 cursor-pointer select-none hover:bg-gray-100" onClick={() => cycleSort('hours')}>
                      Hours{sortIcon('hours')}
                    </th>
                    <th className="text-right px-2 py-2 cursor-pointer select-none hover:bg-gray-100" onClick={() => cycleSort('amount')}>
                      Amount{sortIcon('amount')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rowsWithTotals.map(({eng: e, profile, weekTotals, totalH, amount}) => {
                    clientTotalHours += totalH;
                    clientTotalAmount += amount;
                    return (
                      <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1 sticky left-0 bg-white font-medium">{profile!.name}</td>
                        <td className="px-2 py-1 text-gray-600">{e.sow_reference || '—'}</td>
                        <td className="px-2 py-1 text-right">${Number(e.bill_rate).toFixed(0)}</td>
                        {weeks.map((_w, i) => (
                          <td key={i} className={`px-2 py-1 text-right ${cellColor(weekTotals[i].source)}`}>
                            {weekTotals[i].hours > 0 ? weekTotals[i].hours.toFixed(0) : '·'}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-semibold border-l border-gray-300">{totalH.toFixed(0)}</td>
                        <td className="px-2 py-1 text-right font-semibold">{currencyFmt(amount)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-indigo-50 font-bold border-t-2 border-indigo-200">
                    <td colSpan={3 + weeks.length} className="px-3 py-2 text-right text-indigo-900">Client Total:</td>
                    <td className="px-2 py-2 text-right text-indigo-900 border-l border-indigo-300">{clientTotalHours.toFixed(0)}</td>
                    <td className="px-2 py-2 text-right text-indigo-900">{currencyFmt(clientTotalAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {estimationImportPreview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-900">Import corrected hours — {estimationImportPreview.clientName}</div>
                <div className="text-xs text-gray-500 mt-0.5">{estimationImportPreview.diffs.length} change{estimationImportPreview.diffs.length !== 1 ? 's' : ''} detected</div>
              </div>
              <button onClick={() => setEstimationImportPreview(null)} className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none">×</button>
            </div>
            <div className="overflow-y-auto max-h-96">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-700">Contractor</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-700">Week</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-700">Current</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-700">Imported</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-700">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {estimationImportPreview.diffs.map((d, i) => {
                    const delta = d.newHours - d.currentHours;
                    return (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-4 py-2">{d.contractorName}</td>
                        <td className="px-4 py-2 text-gray-600">Wk {d.weekLabel}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{d.currentHours}h</td>
                        <td className="px-4 py-2 text-right font-medium">{d.newHours}h</td>
                        <td className={`px-4 py-2 text-right font-semibold ${delta > 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {delta > 0 ? '+' : ''}{delta}h
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setEstimationImportPreview(null)} className="px-4 py-2 rounded text-sm border border-gray-300 text-gray-700 hover:bg-gray-50" disabled={estimationImportApplying}>
                Cancel
              </button>
              <button
                onClick={async () => {
                  setEstimationImportApplying(true);
                  try {
                    const rows = estimationImportPreview.diffs.map(d => ({
                      engagement_id: d.engagementId,
                      week_start: d.weekStart,
                      hours_override: d.newHours,
                      edited_by: currentUser.id,
                    }));
                    const { error } = await supabase.from('hour_overrides').upsert(rows, { onConflict: 'engagement_id,week_start' });
                    if (error) throw error;
                    const updated = new Map(estimationOverrides);
                    for (const d of estimationImportPreview.diffs) {
                      if (!updated.has(d.engagementId)) updated.set(d.engagementId, new Map());
                      updated.get(d.engagementId)!.set(d.weekStart, d.newHours);
                    }
                    setEstimationOverrides(updated);
                    setEstimationImportPreview(null);
                  } catch (err) {
                    alert(`Failed to save: ${(err as Error).message}`);
                  } finally {
                    setEstimationImportApplying(false);
                  }
                }}
                className="px-4 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={estimationImportApplying}
              >
                {estimationImportApplying ? 'Saving…' : 'Apply overrides'}
              </button>
            </div>
          </div>
        </div>
      )}

      {invoiceModal && (
        <ClientInvoiceModal
          state={invoiceModal}
          setState={setInvoiceModal}
          onInvestmentCreditSaved={(clientId, newRunning) => {
            setEstimationClients(cs => cs.map(c => c.id === clientId ? { ...c, investment_credit_running: newRunning } : c));
          }}
        />
      )}
    </div>
  );
}
