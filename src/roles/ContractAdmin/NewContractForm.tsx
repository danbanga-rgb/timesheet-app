import { useEffect, useState } from 'react';
import { FileText, Loader2, Download, Eye, Send } from 'lucide-react';
// @ts-expect-error mammoth has no bundled types
import mammoth from 'mammoth/mammoth.browser';
import {
  listCounterparties,
  upsertCounterparty,
  generateContract,
  getSignedUrl,
  downloadFilledDocx,
  type Counterparty,
} from './api';

interface FormState {
  counterparty_id: string | 'new';
  vendor_short_name: string;
  vendor_full_name: string;
  vendor_country: string;
  vendor_address_block: string;
  agreement_date: string;
  effective_date: string;
  sow_start_date: string;
  sow_description: string;
  sow_price: string;
  sow_consultants_count: string;
  vendor_signer_name: string;
  vendor_signer_title: string;
  vendor_signer_email: string;
}

const EMPTY_FORM: FormState = {
  counterparty_id: 'new',
  vendor_short_name: '',
  vendor_full_name: '',
  vendor_country: 'US',
  vendor_address_block: '',
  agreement_date: new Date().toISOString().slice(0, 10),
  effective_date: '',
  sow_start_date: '',
  sow_description: '',
  sow_price: '',
  sow_consultants_count: '1',
  vendor_signer_name: '',
  vendor_signer_title: '',
  vendor_signer_email: '',
};

// Format YYYY-MM-DD into DocuSeal date-format style ("September 1, 2026")
// so the merged DOCX reads naturally. Purely presentational; the DB stores the ISO date.
function fmtDateForMerge(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

export default function NewContractForm() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [generating, setGenerating] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCounterparties().then(setCounterparties).catch((e) => setError(e.message));
  }, []);

  // When counterparty selected from dropdown, prefill vendor fields
  useEffect(() => {
    if (form.counterparty_id === 'new') return;
    const cp = counterparties.find((c) => c.id === form.counterparty_id);
    if (!cp) return;
    setForm((f) => ({
      ...f,
      vendor_short_name: cp.vendor_short_name,
      vendor_full_name: cp.vendor_full_name,
      vendor_country: cp.country ?? 'US',
      vendor_address_block: cp.address_block ?? '',
      vendor_signer_name: cp.default_signer_name ?? f.vendor_signer_name,
      vendor_signer_email: cp.default_signer_email ?? f.vendor_signer_email,
      vendor_signer_title: cp.default_signer_title ?? f.vendor_signer_title,
    }));
  }, [form.counterparty_id, counterparties]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function handleGenerate() {
    setError(null);
    setPreviewHtml(null);
    setPreviewPath(null);
    setGenerating(true);
    try {
      // Upsert counterparty if new / update if existing
      const cpId = await upsertCounterparty({
        id: form.counterparty_id === 'new' ? undefined : form.counterparty_id,
        vendor_short_name: form.vendor_short_name,
        vendor_full_name: form.vendor_full_name || form.vendor_short_name,
        country: form.vendor_country || null,
        address_block: form.vendor_address_block || null,
        default_signer_name: form.vendor_signer_name || null,
        default_signer_email: form.vendor_signer_email || null,
        default_signer_title: form.vendor_signer_title || null,
      });
      if (form.counterparty_id === 'new') {
        // Refresh dropdown + select the new row
        const fresh = await listCounterparties();
        setCounterparties(fresh);
        setForm((f) => ({ ...f, counterparty_id: cpId }));
      }

      // Merge into DOCX
      const outputPath = `previews/${cpId}/${Date.now()}.docx`;
      await generateContract({
        variables: {
          agreement_date: fmtDateForMerge(form.agreement_date),
          vendor_name: form.vendor_full_name || form.vendor_short_name,
          vendor_country: form.vendor_country,
          vendor_address_block: form.vendor_address_block,
          effective_date: fmtDateForMerge(form.effective_date),
          vendor_signer_name: form.vendor_signer_name,
          vendor_signer_title: form.vendor_signer_title,
          sow_agreement_ref_date: fmtDateForMerge(form.agreement_date),
          sow_vendor_name: form.vendor_full_name || form.vendor_short_name,
          sow_description: form.sow_description,
          sow_start_date: fmtDateForMerge(form.sow_start_date),
          sow_consultants_count: form.sow_consultants_count,
          sow_price: form.sow_price,
        },
        output_path: outputPath,
      });

      // Download for inline preview via mammoth (browser DOCX→HTML)
      const buffer = await downloadFilledDocx(outputPath);
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
      setPreviewHtml(result.value);
      setPreviewPath(outputPath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload() {
    if (!previewPath) return;
    const url = await getSignedUrl(previewPath);
    window.open(url, '_blank');
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* ---- FORM ---- */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-6">New Contract</h2>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>
        )}

        {/* Vendor section */}
        <Section title="Vendor">
          <Row label="Counterparty">
            <select
              value={form.counterparty_id}
              onChange={(e) => update('counterparty_id', e.target.value as FormState['counterparty_id'])}
              className="input"
            >
              <option value="new">+ New counterparty</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>{c.vendor_short_name}</option>
              ))}
            </select>
          </Row>
          <Row label="Short name">
            <input value={form.vendor_short_name} onChange={(e) => update('vendor_short_name', e.target.value)} className="input" placeholder="e.g. TestCo" />
          </Row>
          <Row label="Full legal name">
            <input value={form.vendor_full_name} onChange={(e) => update('vendor_full_name', e.target.value)} className="input" placeholder="e.g. TestCo LLC" />
          </Row>
          <Row label="Country">
            <input value={form.vendor_country} onChange={(e) => update('vendor_country', e.target.value)} className="input" placeholder="US / North Macedonia / Bosnia and Herzegovina" />
          </Row>
          <Row label="Address block">
            <textarea value={form.vendor_address_block} onChange={(e) => update('vendor_address_block', e.target.value)} className="input" rows={2} placeholder="Street, City State Zip, Company ID: ..." />
          </Row>
        </Section>

        {/* Agreement section */}
        <Section title="Agreement">
          <Row label="Agreement date">
            <input type="date" value={form.agreement_date} onChange={(e) => update('agreement_date', e.target.value)} className="input" />
          </Row>
          <Row label="Effective date">
            <input type="date" value={form.effective_date} onChange={(e) => update('effective_date', e.target.value)} className="input" />
          </Row>
        </Section>

        {/* SOW section */}
        <Section title="Schedule of Work">
          <Row label="Start date">
            <input type="date" value={form.sow_start_date} onChange={(e) => update('sow_start_date', e.target.value)} className="input" />
          </Row>
          <Row label="Role description">
            <textarea value={form.sow_description} onChange={(e) => update('sow_description', e.target.value)} className="input" rows={4} placeholder={'Senior Software QA Engineer\n- Manual + Automation testing\n- Nightly regression suite'} />
          </Row>
          <Row label="Price">
            <input value={form.sow_price} onChange={(e) => update('sow_price', e.target.value)} className="input" placeholder="$85/hour" />
          </Row>
          <Row label="Consultants">
            <input value={form.sow_consultants_count} onChange={(e) => update('sow_consultants_count', e.target.value)} className="input w-24" />
          </Row>
        </Section>

        {/* Signer section */}
        <Section title="Vendor Signer">
          <Row label="Name">
            <input value={form.vendor_signer_name} onChange={(e) => update('vendor_signer_name', e.target.value)} className="input" />
          </Row>
          <Row label="Title">
            <input value={form.vendor_signer_title} onChange={(e) => update('vendor_signer_title', e.target.value)} className="input" placeholder="Managing Director" />
          </Row>
          <Row label="Email">
            <input type="email" value={form.vendor_signer_email} onChange={(e) => update('vendor_signer_email', e.target.value)} className="input" />
          </Row>
        </Section>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleGenerate}
            disabled={generating || !form.vendor_short_name || !form.agreement_date}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-300"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {generating ? 'Generating…' : 'Generate preview'}
          </button>
          <button disabled title="Coming in Slice 5" className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-500 rounded cursor-not-allowed">
            <Send className="w-4 h-4" /> Send for signing (Slice 5)
          </button>
        </div>
      </div>

      {/* ---- PREVIEW ---- */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Preview</h2>
          {previewPath && (
            <button onClick={handleDownload} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded">
              <Download className="w-4 h-4" /> Download DOCX
            </button>
          )}
        </div>
        {!previewHtml ? (
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-12 text-center text-gray-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Fill the form and click Generate to see the merged contract.</p>
            <p className="text-xs mt-2 text-gray-400">HTML preview via mammoth (approximate layout). Download DOCX for exact rendering.</p>
          </div>
        ) : (
          <div
            className="prose prose-sm max-w-none border border-gray-200 rounded p-4 overflow-y-auto"
            style={{ maxHeight: '80vh' }}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wide mb-3 border-b pb-1">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 sm:items-start">
      <span className="text-sm text-gray-700 pt-2">{label}</span>
      <span>{children}</span>
    </label>
  );
}
