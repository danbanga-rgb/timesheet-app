#!/usr/bin/env node
// docuseal-sender-server.mjs — local HTTP service that wraps the DOCX→PDF→DocuSeal
// pipeline behind a POST /submit endpoint. Used by the frontend's "Send" button
// in the New Contract form for the demo. Not for production.
//
// Usage:
//   node scripts/one-off/docuseal-sender-server.mjs
//
// Prereqs:
//   - Docker running with `docuseal` container up
//   - linuxserver/libreoffice image pulled
//   - scripts/poller/.env has SUPABASE_SERVICE_ROLE_KEY
//   - scripts/one-off/docuseal-template-upload/inject-template.rb exists
//
// Endpoints:
//   GET  /health          → { ok: true }
//   POST /submit          → { submission_id, signing_urls: [{role, url}] }
//     body: {
//       preview_path: string,           // Supabase Storage key, e.g. "previews/xxx/123.docx"
//       vendor_signer_email: string,
//       vendor_signer_name: string,
//       gm_email?: string,              // defaults to dbanga@synergietechsolutions.com
//       gm_name?: string,               // defaults to "Danish Banga"
//       contracts_team_email?: string,  // defaults to contracts@synergietechsolutions.com
//     }

import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 4000;

// ---- Env ----
const envPath = join(__dirname, '..', 'poller', '.env');
if (!existsSync(envPath)) throw new Error(`Missing ${envPath}`);
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const eq = l.indexOf('=');
      return [l.slice(0, eq), l.slice(eq + 1)];
    }),
);
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from scripts/poller/.env');
const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const BUCKET = 'contract-documents';

const INJECT_RB_PATH = join(__dirname, 'docuseal-template-upload', 'inject-template.rb');
if (!existsSync(INJECT_RB_PATH)) throw new Error(`Missing ${INJECT_RB_PATH}`);

// ---- Helpers ----
async function downloadDocx(storagePath, dest) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
  });
  if (!res.ok) throw new Error(`Download ${storagePath} → ${res.status} ${await res.text()}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function dockerCp(src, containerDest) {
  execSync(`docker cp ${src} ${containerDest}`);
}

async function runPipeline({
  preview_path,
  vendor_signer_email,
  vendor_signer_name,
  gm_email,
  gm_name,
  contracts_team_email,
}) {
  const work = join(tmpdir(), `contract-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const docxLocal = join(work, 'contract.docx');

  console.log(`[submit] downloading ${preview_path}`);
  await downloadDocx(preview_path, docxLocal);

  console.log('[submit] DOCX → PDF via linuxserver/libreoffice');
  execSync(
    `docker run --rm -v ${work}:/data --entrypoint soffice linuxserver/libreoffice:latest ` +
      `--headless --convert-to pdf --outdir /data /data/contract.docx > /dev/null`,
    { stdio: 'inherit' },
  );
  const pdfLocal = join(work, 'contract.pdf');

  console.log('[submit] docker cp PDF + inject-template.rb + wrapper into docuseal');
  dockerCp(pdfLocal, 'docuseal:/tmp/upload.pdf');
  dockerCp(INJECT_RB_PATH, 'docuseal:/tmp/inject-template.rb');

  // Wrapper Rails runner: loads inject-template.rb (creates Template from
  // /tmp/upload.pdf), then creates a Submission with 3 signers ordered
  // Contracts Team → Vendor → GM. Prints submission ID + signing URLs.
  const wrapper = `
load '/tmp/inject-template.rb'
template = Template.order(id: :desc).first
puts "TEMPLATE_ID=#{template.id}"

user = User.first
account = user.account

submission = Submission.create!(
  template: template,
  template_submitters: template.submitters,
  created_by_user: user,
  account: account,
  source: 'link',
  submitters_order: 'preserved'
)

vendor_uuid = template.submitters.find { |s| s['name'].downcase.include?('vendor') }&.dig('uuid')
gm_uuid = template.submitters.find { |s| s['name'].downcase.match?(/synergie|general/i) }&.dig('uuid')
ct_uuid = template.submitters.find { |s| s['name'].downcase.include?('contract') }&.dig('uuid')

signers = [
  [ct_uuid, 'Contracts Team', ENV.fetch('CT_EMAIL')],
  [vendor_uuid, ENV.fetch('VENDOR_NAME'), ENV.fetch('VENDOR_EMAIL')],
  [gm_uuid, ENV.fetch('GM_NAME'), ENV.fetch('GM_EMAIL')]
]

signers.each do |uuid, label, email|
  next unless uuid
  Submitter.create!(
    submission: submission, account: account, uuid: uuid,
    email: email, name: label,
    values: {}, sent_at: Time.current
  )
end

puts "SUBMISSION_ID=#{submission.id}"
submission.submitters.each do |s|
  role_name = template.submitters.find { |ts| ts['uuid'] == s.uuid }['name']
  puts "URL|#{role_name}|http://localhost:3000/s/#{s.slug}"
end
`;

  const wrapperPath = join(work, 'run.rb');
  writeFileSync(wrapperPath, wrapper);
  dockerCp(wrapperPath, 'docuseal:/tmp/run.rb');

  console.log('[submit] rails runner /tmp/run.rb');
  const envFlags = [
    `-e TEMPLATE_NAME="Contract ${new Date().toISOString().slice(0, 19)}"`,
    `-e CT_EMAIL="${contracts_team_email}"`,
    `-e VENDOR_NAME="${vendor_signer_name.replace(/"/g, '')}"`,
    `-e VENDOR_EMAIL="${vendor_signer_email}"`,
    `-e GM_NAME="${gm_name.replace(/"/g, '')}"`,
    `-e GM_EMAIL="${gm_email}"`,
  ].join(' ');

  const output = execSync(
    `docker exec -w /app ${envFlags} docuseal bin/rails runner /tmp/run.rb`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const submissionMatch = output.match(/SUBMISSION_ID=(\d+)/);
  const submissionId = submissionMatch?.[1];

  const signingUrls = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^URL\|(.+?)\|(.+)$/);
    if (m) signingUrls.push({ role: m[1], url: m[2] });
  }

  if (!submissionId || signingUrls.length === 0) {
    throw new Error(`Pipeline succeeded but no submission_id/URLs parsed. Raw output:\n${output}`);
  }

  return { submission_id: submissionId, signing_urls: signingUrls };
}

// ---- HTTP server ----
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/submit') {
    res.writeHead(404, CORS_HEADERS);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      const input = JSON.parse(body);
      const required = ['preview_path', 'vendor_signer_email', 'vendor_signer_name'];
      for (const key of required) {
        if (!input[key]) throw new Error(`Missing required field: ${key}`);
      }
      const result = await runPipeline({
        preview_path: input.preview_path,
        vendor_signer_email: input.vendor_signer_email,
        vendor_signer_name: input.vendor_signer_name,
        gm_email: input.gm_email || 'dbanga@synergietechsolutions.com',
        gm_name: input.gm_name || 'Danish Banga',
        contracts_team_email: input.contracts_team_email || 'contracts@synergietechsolutions.com',
      });
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[submit] FAILED:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`docuseal-sender listening on http://localhost:${PORT}`);
  console.log(`  POST /submit  → run DOCX→PDF→DocuSeal pipeline`);
  console.log(`  GET  /health  → { ok: true }`);
});
