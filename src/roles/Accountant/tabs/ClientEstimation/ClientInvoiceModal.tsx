import { createPortal } from 'react-dom';
import { Printer, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../../../supabaseClient';

export type EstimationClient = {
  id: number; name: string; payment_terms_days: number; retention_credit_pct: number;
  bill_to_name: string | null; bill_to_attn: string | null;
  address_line1: string | null; address_line2: string | null;
  city: string | null; state: string | null; zip: string | null;
  po_number: string | null; sales_tax_rate: number | null;
  invoice_format_type: string | null;
  show_investment_credit_running_total: boolean | null;
  retention_per_hour: number | null;
  investment_credit_running: number | null;
};

export type ClientInvoiceLine = {
  id: string;
  engagementId: number | null;
  contractorName: string;
  roleTitle: string;
  sowCode: string;
  hours: number;
  rate: number;
  amount: number;
  amountOverridden: boolean;
  periodStart: string;
  periodEnd: string;
};

export type ClientInvoiceMeta = {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  poNumber: string;
  billToName: string;
  billToAttn: string;
  addressLines: string[];
  memo: string;
};

export type ClientInvoiceModalState = {
  client: EstimationClient;
  projectName: string;
  projectCode: string;
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  meta: ClientInvoiceMeta;
  lines: ClientInvoiceLine[];
  retentionPerHour: number;
  investmentCreditPrior: number;
  salesTaxRate: number;
};

interface ClientInvoiceModalProps {
  state: ClientInvoiceModalState;
  setState: React.Dispatch<React.SetStateAction<ClientInvoiceModalState | null>>;
  onInvestmentCreditSaved: (clientId: number, newRunning: number) => void;
}

export default function ClientInvoiceModal({ state: S, setState, onInvestmentCreditSaved }: ClientInvoiceModalProps) {
  const setS = (updater: (prev: ClientInvoiceModalState) => ClientInvoiceModalState) =>
    setState(prev => prev ? updater(prev) : prev);

  const subtotalGross    = S.lines.reduce((a, l) => a + l.amount, 0);
  const totalHours       = S.lines.reduce((a, l) => a + l.hours, 0);
  const retentionAmount  = Math.round((S.retentionPerHour * totalHours) * 100) / 100;
  const netBeforeTax     = subtotalGross - retentionAmount;
  const salesTax         = Math.round(netBeforeTax * (S.salesTaxRate / 100) * 100) / 100;
  const total            = netBeforeTax + salesTax;
  const runningTotal     = S.investmentCreditPrior + retentionAmount;
  const isGenworth       = S.client.invoice_format_type === 'genworth';
  const isAETv           = S.client.invoice_format_type === 'ae_tv';
  const format           = S.client.invoice_format_type || 'apfm';
  const fmt$             = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate          = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

  const updateLine = (id: string, patch: Partial<ClientInvoiceLine>) => setS(p => ({
    ...p,
    lines: p.lines.map(l => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      if (('hours' in patch || 'rate' in patch) && !next.amountOverridden) {
        next.amount = Math.round(next.hours * next.rate * 100) / 100;
      }
      return next;
    }),
  }));
  const deleteLine = (id: string) => setS(p => ({ ...p, lines: p.lines.filter(l => l.id !== id) }));
  const addLine = () => setS(p => ({
    ...p,
    lines: [...p.lines, {
      id: `new-${Date.now()}`,
      engagementId: null,
      contractorName: '', roleTitle: '', sowCode: '',
      hours: 0, rate: 0, amount: 0, amountOverridden: false,
      periodStart: p.periodStart, periodEnd: p.periodEnd,
    }],
  }));
  const moveLine = (id: string, dir: -1 | 1) => setS(p => {
    const i = p.lines.findIndex(l => l.id === id);
    if (i < 0) return p;
    const j = i + dir;
    if (j < 0 || j >= p.lines.length) return p;
    const next = [...p.lines];
    [next[i], next[j]] = [next[j], next[i]];
    return { ...p, lines: next };
  });

  const handlePrint = async () => {
    if (isGenworth && retentionAmount > 0) {
      const newRunning = S.investmentCreditPrior + retentionAmount;
      const { error: upErr } = await supabase.from('clients').update({ investment_credit_running: newRunning }).eq('id', S.client.id);
      if (upErr) {
        alert(`Failed to update Investment Credit running total: ${upErr.message}\nPrint aborted.`);
        return;
      }
      onInvestmentCreditSaved(S.client.id, newRunning);
    }
    setTimeout(() => window.print(), 100);
  };

  const ACCENT = '#4f46e5';
  const MUTED  = '#64748b';
  const RULE   = '#e2e8f0';
  const SUBTLE = '#f1f5f9';

  const AccentBar = (
    <div style={{ height: 4, background: ACCENT, marginBottom: 24 }} />
  );

  const InvoiceHeader = (
    <div className="flex justify-between items-start" style={{ marginBottom: 28 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.3, color: '#0f172a' }}>SYNERGIE TECH SOLUTIONS, LLC</div>
        <div style={{ color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
          <div>11750 Dublin Blvd, Suite 207</div>
          <div>Dublin, CA 94568</div>
          <div style={{ marginTop: 6 }}>www.synergiecorp.com · 510-550-1400</div>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 6, color: ACCENT, textTransform: 'uppercase' }}>Invoice</div>
        <table style={{ marginTop: 10, marginLeft: 'auto', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ padding: '2px 0', color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.8, paddingRight: 12, textAlign: 'left' }}>Invoice #</td><td style={{ padding: '2px 0', fontWeight: 600, textAlign: 'right' }}>{S.meta.invoiceNumber || '(none)'}</td></tr>
            <tr><td style={{ padding: '2px 0', color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.8, paddingRight: 12, textAlign: 'left' }}>Date</td><td style={{ padding: '2px 0', textAlign: 'right' }}>{fmtDate(S.meta.invoiceDate)}</td></tr>
            <tr><td style={{ padding: '2px 0', color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.8, paddingRight: 12, textAlign: 'left' }}>Due</td><td style={{ padding: '2px 0', textAlign: 'right' }}>{fmtDate(S.meta.dueDate)}</td></tr>
            <tr><td style={{ padding: '2px 0', color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.8, paddingRight: 12, textAlign: 'left' }}>Terms</td><td style={{ padding: '2px 0', textAlign: 'right' }}>Net {S.client.payment_terms_days}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const BillToBlock = (
    <div style={{ width: '55%' }}>
      <div style={{ color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 1.2, fontWeight: 600, borderBottom: `1px solid ${RULE}`, paddingBottom: 4, marginBottom: 8 }}>Bill To</div>
      <div style={{ lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{S.meta.billToName}</div>
        {isAETv && S.meta.billToAttn && <div style={{ color: MUTED }}>Attn: {S.meta.billToAttn}</div>}
        {S.meta.addressLines.map((line, i) => <div key={i} style={{ color: MUTED }}>{line}</div>)}
      </div>
    </div>
  );

  const MetaBlock = (
    <div style={{ width: '40%', textAlign: 'right' }}>
      <div style={{ color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 1.2, fontWeight: 600, borderBottom: `1px solid ${RULE}`, paddingBottom: 4, marginBottom: 8 }}>P.O.</div>
      <div style={{ lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{S.meta.poNumber || '—'}</div>
      </div>
    </div>
  );

  const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', color: MUTED, textTransform: 'uppercase', fontSize: 10, letterSpacing: 1, fontWeight: 600, borderBottom: `1.5px solid #0f172a` };
  const thNum: React.CSSProperties  = { ...thStyle, textAlign: 'right' };
  const tdStyle: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'top', borderBottom: `1px solid ${RULE}` };
  const tdNum: React.CSSProperties   = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  const ApfmTable = (
    <table className="invoice-zebra" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24, marginBottom: 24 }}>
      <thead>
        <tr>
          <th style={thStyle}>Item</th>
          <th style={thStyle}>Description</th>
          <th style={thNum}>Hrs</th>
          <th style={thNum}>Rate</th>
          <th style={thStyle}>Category</th>
          <th style={thNum}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {S.lines.map(l => (
          <tr key={l.id}>
            <td style={tdStyle}>SW_Dev</td>
            <td style={tdStyle}>
              <div style={{ fontWeight: 600, color: '#0f172a' }}>Software Development Services</div>
              <div style={{ color: MUTED, marginTop: 2 }}>"{l.roleTitle}"</div>
              <div style={{ color: MUTED }}>Consultant: {l.contractorName}</div>
              <div style={{ color: MUTED }}>{fmtDate(l.periodStart)} – {fmtDate(l.periodEnd)}</div>
              {l.sowCode && <div style={{ color: MUTED }}>{l.sowCode}</div>}
            </td>
            <td style={tdNum}>{l.hours}</td>
            <td style={tdNum}>${l.rate.toFixed(2)}</td>
            <td style={tdStyle}>SW_Dev</td>
            <td style={{ ...tdNum, fontWeight: 600, color: '#0f172a' }}>{fmt$(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const AETvTable = (
    <table className="invoice-zebra" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24, marginBottom: 24 }}>
      <thead>
        <tr>
          <th style={thStyle}>Description</th>
          <th style={thNum}>Hrs</th>
          <th style={thNum}>Rate</th>
          <th style={thNum}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {S.lines.map(l => (
          <tr key={l.id}>
            <td style={tdStyle}>
              <div style={{ fontWeight: 600, color: '#0f172a' }}>{l.contractorName}</div>
              <div style={{ color: MUTED, marginTop: 2 }}>{l.roleTitle}{l.sowCode ? ` · ${l.sowCode}` : ''}</div>
              <div style={{ color: MUTED }}>{fmtDate(l.periodStart)} – {fmtDate(l.periodEnd)}</div>
            </td>
            <td style={tdNum}>{l.hours}</td>
            <td style={tdNum}>${l.rate.toFixed(2)}</td>
            <td style={{ ...tdNum, fontWeight: 600, color: '#0f172a' }}>{fmt$(l.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const GenworthTable = (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24, marginBottom: 24 }}>
      <thead>
        <tr>
          <th style={thStyle}>Description</th>
          <th style={thNum}>Hrs</th>
          <th style={thNum}>Rate</th>
          <th style={thNum}>Total</th>
          <th style={thNum}>Qty</th>
          <th style={thNum}>Unit</th>
          <th style={thNum}>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr style={{ background: SUBTLE }}>
          <td colSpan={4} style={{ ...tdStyle, fontWeight: 600, color: '#0f172a' }}>
            Synergie Tech Solutions — CAPITALIZED CareScout IT<br />
            <span style={{ fontWeight: 400, color: MUTED }}>Software Engineering Staff Augmentation for development of CareScout Platforms.</span>
          </td>
          <td style={tdNum}>{subtotalGross.toLocaleString()}</td>
          <td style={tdNum}>1.00</td>
          <td style={{ ...tdNum, fontWeight: 600 }}>{fmt$(subtotalGross)}</td>
        </tr>
        {S.lines.map(l => {
          const gwCell: React.CSSProperties = { padding: '3px 12px', verticalAlign: 'top', color: MUTED, borderBottom: 'none' };
          const gwNum: React.CSSProperties  = { ...gwCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
          return (
            <tr key={l.id}>
              <td style={{ ...gwCell, paddingLeft: 32 }}>{l.contractorName} — {l.roleTitle}</td>
              <td style={gwNum}>{l.hours}</td>
              <td style={gwNum}>${l.rate.toFixed(0)}</td>
              <td style={gwNum}>{fmt$(l.amount)}</td>
              <td style={gwCell}></td>
              <td style={gwCell}></td>
              <td style={gwCell}></td>
            </tr>
          );
        })}
        <tr style={{ background: SUBTLE }}>
          <td style={{ ...tdStyle, fontWeight: 600, textAlign: 'right' }}>Totals</td>
          <td style={{ ...tdNum, fontWeight: 600 }}>{totalHours}</td>
          <td style={tdStyle}></td>
          <td style={{ ...tdNum, fontWeight: 600 }}>{fmt$(subtotalGross)}</td>
          <td style={tdStyle}></td>
          <td style={tdStyle}></td>
          <td style={tdStyle}></td>
        </tr>
        {retentionAmount > 0 && (
          <tr>
            <td style={tdStyle}>Retention Investment Credit*</td>
            <td style={tdStyle}></td>
            <td style={tdStyle}></td>
            <td style={tdStyle}></td>
            <td style={tdNum}>{retentionAmount.toLocaleString()}</td>
            <td style={tdNum}>−1.00</td>
            <td style={{ ...tdNum, color: '#b91c1c', fontWeight: 600 }}>−{fmt$(retentionAmount)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );

  const totalsRow: React.CSSProperties = { padding: '6px 14px', fontVariantNumeric: 'tabular-nums' };
  const TotalsBox = (
    <table style={{ marginLeft: 'auto', minWidth: 320, borderCollapse: 'collapse' }}>
      <tbody>
        <tr><td style={{ ...totalsRow, color: MUTED }}>Subtotal</td><td style={{ ...totalsRow, textAlign: 'right' }}>{fmt$(netBeforeTax)}</td></tr>
        <tr><td style={{ ...totalsRow, color: MUTED }}>Sales Tax ({S.salesTaxRate}%)</td><td style={{ ...totalsRow, textAlign: 'right' }}>{fmt$(salesTax)}</td></tr>
        {isGenworth && (
          <tr><td style={{ ...totalsRow, color: MUTED }}>Retention Investment Credit*</td><td style={{ ...totalsRow, textAlign: 'right' }}>$0.00</td></tr>
        )}
        <tr><td colSpan={2} style={{ borderTop: `1px solid ${RULE}`, padding: 0 }}></td></tr>
        <tr>
          <td style={{ padding: '12px 14px', background: '#eef2ff', fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: 1, color: ACCENT }}>Balance Due</td>
          <td style={{ padding: '12px 14px', background: '#eef2ff', textAlign: 'right', fontWeight: 700, fontSize: 16, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>{fmt$(total)}</td>
        </tr>
      </tbody>
    </table>
  );

  const RunningFooter = isGenworth && S.client.show_investment_credit_running_total ? (
    <div style={{ marginTop: 16, paddingTop: 10, borderTop: `1px solid ${RULE}`, color: MUTED }}>
      Total Synergie Investment Credit (including this invoice):{' '}
      <span style={{ fontWeight: 600, color: '#0f172a' }}>{fmt$(runningTotal)}</span>
    </div>
  ) : null;

  return createPortal((
    <>
      <style>{`
        .invoice-print-root, .invoice-print-root * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        .invoice-zebra > tbody > tr:nth-child(even) > td { background: #f8fafc; }
        @media print {
          body { background: white !important; margin: 0 !important; }
          body > *:not([data-invoice-print]) { display: none !important; }
          body > [data-invoice-print] { display: block !important; position: static !important; background: white !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
          body > [data-invoice-print], body > [data-invoice-print] * { visibility: visible !important; }
          body > [data-invoice-print] .no-print { display: none !important; }
          body > [data-invoice-print] .invoice-modal-shell { position: static !important; background: white !important; padding: 0 !important; margin: 0 !important; max-width: none !important; box-shadow: none !important; border-radius: 0 !important; width: auto !important; }
          body > [data-invoice-print] .invoice-print-root { position: static !important; padding: 0 !important; width: auto !important; }
          .invoice-print-root thead { display: table-header-group; }
          .invoice-print-root tfoot { display: table-footer-group; }
          .invoice-print-root tr { page-break-inside: avoid; break-inside: avoid; }
          .invoice-totals-block, .invoice-footer-block { page-break-inside: avoid; break-inside: avoid; }
          @page {
            size: letter;
            margin: 0.5in 0.5in 0.7in 0.5in;
            @bottom-left  { content: "${(S.meta.invoiceNumber || 'Draft').replace(/"/g, '\\"')}  ·  ${S.client.name.replace(/"/g, '\\"')}"; font-family: 'Inter','Helvetica Neue',Helvetica,Arial,sans-serif; font-size: 9pt; color: #64748b; }
            @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: 'Inter','Helvetica Neue',Helvetica,Arial,sans-serif; font-size: 9pt; color: #64748b; }
          }
        }
      `}</style>

      <div
        data-invoice-print="true"
        className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-start justify-center p-4 overflow-y-auto"
        onClick={() => setState(null)}
      >
        <div className="invoice-modal-shell bg-white rounded-lg shadow-xl w-full max-w-5xl my-8" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b flex justify-between items-center no-print">
            <div>
              <h2 className="text-lg font-bold">{S.client.name} Invoice — {S.monthLabel}</h2>
              <p className="text-xs text-gray-500">Project: {S.projectName} · {S.projectCode}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm">
                <Printer className="w-4 h-4" /> Print / Save PDF
              </button>
              <button onClick={() => setState(null)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 text-sm">Close</button>
            </div>
          </div>

          <div className="p-4 bg-gray-50 border-b no-print">
            <div className="grid grid-cols-4 gap-3 text-sm">
              <div><label className="block text-xs font-semibold mb-1">Invoice #</label><input value={S.meta.invoiceNumber} onChange={e => setS(p => ({...p, meta: {...p.meta, invoiceNumber: e.target.value}}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
              <div><label className="block text-xs font-semibold mb-1">Date</label><input type="date" value={S.meta.invoiceDate} onChange={e => setS(p => ({...p, meta: {...p.meta, invoiceDate: e.target.value}}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
              <div><label className="block text-xs font-semibold mb-1">Due Date</label><input type="date" value={S.meta.dueDate} onChange={e => setS(p => ({...p, meta: {...p.meta, dueDate: e.target.value}}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
              <div><label className="block text-xs font-semibold mb-1">P.O. Number</label><input value={S.meta.poNumber} onChange={e => setS(p => ({...p, meta: {...p.meta, poNumber: e.target.value}}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm mt-3">
              <div><label className="block text-xs font-semibold mb-1">Bill To Name</label><input value={S.meta.billToName} onChange={e => setS(p => ({...p, meta: {...p.meta, billToName: e.target.value}}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
              {isAETv && (
                <div><label className="block text-xs font-semibold mb-1">Attn</label><input value={S.meta.billToAttn} onChange={e => setS(p => ({...p, meta: {...p.meta, billToAttn: e.target.value}}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
              )}
            </div>
            {isGenworth && (
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><label className="block text-xs font-semibold mb-1">Retention $ / hour</label><input type="number" step="0.01" value={S.retentionPerHour} onChange={e => setS(p => ({...p, retentionPerHour: Number(e.target.value)}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
                <div><label className="block text-xs font-semibold mb-1">Investment Credit — Prior (before this invoice)</label><input type="number" step="0.01" value={S.investmentCreditPrior} onChange={e => setS(p => ({...p, investmentCreditPrior: Number(e.target.value)}))} className="w-full px-2 py-1 border border-gray-300 rounded" /></div>
              </div>
            )}
          </div>

          <div className="p-4 no-print">
            <div className="text-xs font-semibold text-gray-500 mb-2">LINE ITEMS — edit inline; amount auto-computes from hours × rate</div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="p-1 text-left w-8"></th>
                  <th className="p-1 text-left">Contractor</th>
                  <th className="p-1 text-left">Role</th>
                  <th className="p-1 text-left">SOW</th>
                  <th className="p-1 text-right w-20">Hours</th>
                  <th className="p-1 text-right w-20">Rate</th>
                  <th className="p-1 text-right w-28">Amount</th>
                  <th className="p-1 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {S.lines.map((l, i) => (
                  <tr key={l.id} className="border-b border-gray-200">
                    <td className="p-1">
                      <button onClick={() => moveLine(l.id, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs">↑</button>
                      <button onClick={() => moveLine(l.id, 1)} disabled={i === S.lines.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs ml-0.5">↓</button>
                    </td>
                    <td className="p-1"><input value={l.contractorName} onChange={e => updateLine(l.id, {contractorName: e.target.value})} className="w-full px-1 py-0.5 border border-transparent focus:border-indigo-400 rounded" /></td>
                    <td className="p-1"><input value={l.roleTitle} onChange={e => updateLine(l.id, {roleTitle: e.target.value})} className="w-full px-1 py-0.5 border border-transparent focus:border-indigo-400 rounded" /></td>
                    <td className="p-1"><input value={l.sowCode} onChange={e => updateLine(l.id, {sowCode: e.target.value})} className="w-full px-1 py-0.5 border border-transparent focus:border-indigo-400 rounded" /></td>
                    <td className="p-1 text-right"><input type="number" step="0.01" value={l.hours} onChange={e => updateLine(l.id, {hours: Number(e.target.value)})} className="w-full px-1 py-0.5 border border-transparent focus:border-indigo-400 rounded text-right" /></td>
                    <td className="p-1 text-right"><input type="number" step="0.01" value={l.rate} onChange={e => updateLine(l.id, {rate: Number(e.target.value)})} className="w-full px-1 py-0.5 border border-transparent focus:border-indigo-400 rounded text-right" /></td>
                    <td className={`p-1 text-right ${l.amountOverridden ? 'bg-yellow-50' : ''}`}>
                      <div className="flex items-center gap-1 justify-end">
                        <input type="number" step="0.01" value={l.amount} onChange={e => updateLine(l.id, {amount: Number(e.target.value), amountOverridden: true})} className="w-20 px-1 py-0.5 border border-transparent focus:border-indigo-400 rounded text-right" />
                        {l.amountOverridden && (
                          <button
                            onClick={() => updateLine(l.id, {amount: Math.round(l.hours * l.rate * 100) / 100, amountOverridden: false})}
                            title="Reset to hours × rate"
                            className="text-indigo-600 hover:text-indigo-800 text-xs"
                          >↩</button>
                        )}
                      </div>
                    </td>
                    <td className="p-1 text-center"><button onClick={() => deleteLine(l.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3 inline" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between items-center mt-2">
              <button onClick={addLine} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"><Plus className="w-3 h-3" /> Add line</button>
              <div className="text-xs text-gray-600">
                {S.lines.length} lines · {totalHours}h · Gross {fmt$(subtotalGross)}
                {isGenworth && retentionAmount > 0 && <> · Retention <span className="text-red-600">-{fmt$(retentionAmount)}</span></>}
              </div>
            </div>
          </div>

          <div className="invoice-print-root" style={{ padding: '0.5in', color: '#0f172a', fontFamily: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif', fontSize: 12, lineHeight: 1.4, background: 'white' }}>
            {AccentBar}
            {InvoiceHeader}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              {BillToBlock}
              {MetaBlock}
            </div>
            {format === 'apfm' && ApfmTable}
            {format === 'ae_tv' && AETvTable}
            {format === 'genworth' && GenworthTable}
            <div className="invoice-totals-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 24 }}>
              <div style={{ minWidth: '45%' }}>
                {RunningFooter}
                {S.meta.memo && <div style={{ marginTop: 12, whiteSpace: 'pre-line', color: MUTED }}>{S.meta.memo}</div>}
              </div>
              {TotalsBox}
            </div>
            <div className="invoice-footer-block" style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${RULE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, color: MUTED, fontSize: 11 }}>
              <div>
                <div style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: 1.2, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>ACH Remittance</div>
                <div>Routing 321180515 · Account 527878220</div>
                <div>EIN 20-3985663</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: 1.2, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>Questions?</div>
                <div>accounting@synergiecorp.com</div>
                <div>+1 510-550-1400</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  ), document.body);
}
