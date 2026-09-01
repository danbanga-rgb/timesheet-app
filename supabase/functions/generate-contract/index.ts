// generate-contract — Supabase edge function
//
// Fill-then-sign step 1: download the template DOCX from Storage, substitute
// {{tag}} placeholders with typed values from the caller, upload the filled
// DOCX back to Storage. Only signature/initials tags remain in the output
// (they carry DocuSeal syntax and get consumed by the next slice).
//
// Auth: caller must have role in ('admin', 'contract_admin').
//
// Body:  { variables: Record<string, string>, output_path: string }
// Reply: { path: string } on success

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3.10.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BUCKET = 'contract-documents';
const ALLOWED_ROLES = new Set(['admin', 'contract_admin']);

// DOCX parts that can carry {{tag}} placeholders. Headers/footers must be
// scanned for the footer-based Initials placeholder even though signature
// tags themselves live only in document.xml.
const XML_PARTS_TO_MERGE = [
  'word/document.xml',
  'word/header1.xml',
  'word/header2.xml',
  'word/header3.xml',
  'word/footer1.xml',
  'word/footer2.xml',
  'word/footer3.xml',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ---- Auth: JWT → role check ----
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'missing_token' });

  const { data: userRes, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(401, { error: 'invalid_token' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userRes.user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.has(profile.role)) {
    return json(403, { error: 'forbidden' });
  }

  // ---- Body validation ----
  let body: { variables?: Record<string, string>; output_path?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }
  const variables = body.variables;
  const outputPath = body.output_path;
  if (!variables || typeof variables !== 'object' || !outputPath) {
    return json(400, { error: 'missing_params', required: ['variables', 'output_path'] });
  }

  // ---- Fetch template path from tenant_config ----
  const { data: cfg } = await supabase
    .from('tenant_config')
    .select('docuseal_contract_template_id')
    .single();
  const templatePath = cfg?.docuseal_contract_template_id;
  if (!templatePath) return json(500, { error: 'template_path_not_configured' });

  // ---- Download template DOCX ----
  const { data: templateBlob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(templatePath);
  if (dlErr || !templateBlob) {
    return json(500, { error: 'template_download_failed', detail: dlErr?.message });
  }

  // ---- Merge tags into DOCX ----
  const zip = await JSZip.loadAsync(await templateBlob.arrayBuffer());
  for (const xmlPath of XML_PARTS_TO_MERGE) {
    const file = zip.file(xmlPath);
    if (!file) continue;
    let xml = await file.async('string');
    for (const [name, rawValue] of Object.entries(variables)) {
      const pattern = new RegExp(`\\{\\{${escapeRegExp(name)}\\}\\}`, 'g');
      xml = xml.replace(pattern, escapeXml(String(rawValue ?? '')));
    }
    zip.file(xmlPath, xml);
  }
  const filled = await zip.generateAsync({ type: 'arraybuffer' });

  // ---- Upload filled DOCX ----
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(outputPath, filled, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
  if (upErr) return json(500, { error: 'upload_failed', detail: upErr.message });

  return json(200, { path: outputPath });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// XML-escape a value for insertion inside a Word <w:t> text element.
// Newlines become <w:br/> so multi-line values render as line breaks
// within the same paragraph.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '</w:t><w:br/><w:t>');
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
