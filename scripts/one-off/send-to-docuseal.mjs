#!/usr/bin/env node
// send-to-docuseal.mjs
//
// Thin-slice sender: pull a filled DOCX from Supabase Storage, run it
// through the local LibreOffice+DocuSeal pipeline, create a DocuSeal
// Submission with signer emails, print signing URLs.
//
// Usage:
//   node scripts/one-off/send-to-docuseal.mjs [<storage-path>] [--email=vendor@example.com]
//
// With no path: uses the newest previews/*/*.docx in Supabase Storage.
// With no --email: prompts, or defaults to test address for smoke testing.
//
// Prereqs (all local): Docker running, `docuseal` container up,
// linuxserver/libreoffice image available, scripts/poller/.env with
// SUPABASE_SERVICE_ROLE_KEY.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---- Load env ----
const envPath = new URL('../poller/.env', import.meta.url).pathname;
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

// ---- Args ----
const args = process.argv.slice(2);
let storagePath = args.find((a) => !a.startsWith('--')) ?? null;
let signerEmail = args.find((a) => a.startsWith('--email='))?.split('=')[1]
  ?? 'dbanga@synergietechsolutions.com';

// ---- Helpers ----
async function sb(path, opts = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
  }
  return res;
}

async function findLatestPreview() {
  // List previews/ subdirectories (counterparty IDs)
  const list1 = await (await sb(`/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: 'previews/', limit: 100 }),
  })).json();
  const dirs = list1.filter((e) => e.id === null).map((e) => e.name);
  let newest = null;
  for (const dir of dirs) {
    const files = await (await sb(`/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: `previews/${dir}/`, limit: 100 }),
    })).json();
    for (const f of files) {
      const ts = new Date(f.updated_at || f.created_at).getTime();
      if (!newest || ts > newest.ts) {
        newest = { path: `previews/${dir}/${f.name}`, ts };
      }
    }
  }
  if (!newest) throw new Error('No previews found in Supabase Storage');
  return newest.path;
}

async function downloadDocx(path, dest) {
  const res = await sb(`/storage/v1/object/${BUCKET}/${path}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buffer);
  return dest;
}

function dockerExec(container, cmd) {
  return execSync(`docker exec ${container} ${cmd}`, { encoding: 'utf8' });
}

function dockerCp(src, containerDest) {
  execSync(`docker cp ${src} ${containerDest}`);
}

// ---- Main ----
(async () => {
  console.log('==> Discovering DOCX');
  if (!storagePath) storagePath = await findLatestPreview();
  console.log(`    storage: ${storagePath}`);
  console.log(`    signer email: ${signerEmail}`);

  const work = join(tmpdir(), `contract-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const docxLocal = join(work, 'contract.docx');

  console.log('==> Downloading filled DOCX from Supabase Storage');
  await downloadDocx(storagePath, docxLocal);

  console.log('==> Converting DOCX -> PDF via linuxserver/libreoffice');
  execSync(
    `docker run --rm -v ${work}:/data --entrypoint soffice linuxserver/libreoffice:latest ` +
    `--headless --convert-to pdf --outdir /data /data/contract.docx > /dev/null`,
    { stdio: 'inherit' },
  );
  const pdfLocal = join(work, 'contract.pdf');

  console.log('==> Copying PDF into docuseal container');
  // Copy directly as upload.pdf (rename inside container hits perm issues since docker cp writes as root).
  dockerCp(pdfLocal, 'docuseal:/tmp/upload.pdf');

  console.log('==> Running injection script (extract sig/initials, create Template + Submission)');
  // Reuse the existing inject-template.rb but wrap with Submission creation
  const injectScript = readFileSync(new URL('./docuseal-template-upload/inject-template.rb', import.meta.url), 'utf8');

  // Build a wrapper Rails runner script that: (a) creates the Template from
  // the PDF (already-filled — sig/initials tags only), (b) creates a
  // Submission for a single Vendor signer, (c) prints signing URLs.
  const wrapper = `
require 'securerandom'
ENV['TEMPLATE_NAME'] ||= 'Contract ' + Time.now.strftime('%Y-%m-%d %H:%M:%S')

# inject-template.rb reads /tmp/upload.pdf. Values are already merged into
# the PDF; the only remaining {{tag}} patterns are sig/initials. The
# HexaPDF redaction step in inject-template.rb whitewashes only those tag
# regions, which is exactly what we want.
load '/tmp/inject-template.rb'

# After inject-template.rb finishes, the newest Template is what we just made
template = Template.order(id: :desc).first
puts "TEMPLATE_ID=#{template.id}"

# Create a Submission with a single Vendor signer
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

# Match by substring — submitters may be renamed via SUBMITTER_LABELS
# in inject-template.rb ("Vendor Signer", "Synergie Countersigner", etc.)
def find_sub(template, needle)
  template.submitters.find { |s| s['name'].downcase.include?(needle.downcase) }&.dig('uuid')
end

vendor_uuid = find_sub.call(template, 'vendor') rescue nil
gm_uuid = find_sub.call(template, 'synergie') || find_sub.call(template, 'general') rescue nil
ct_uuid = find_sub.call(template, 'contracts') rescue nil

# Ruby lambda syntax fix (find_sub as method not lambda)
vendor_uuid = template.submitters.find { |s| s['name'].downcase.include?('vendor') }&.dig('uuid')
gm_uuid = template.submitters.find { |s| s['name'].downcase.match?(/synergie|general/i) }&.dig('uuid')
ct_uuid = template.submitters.find { |s| s['name'].downcase.include?('contract') }&.dig('uuid')

[[ct_uuid, 'Contracts Team', ENV.fetch('SIGNER_EMAIL')],
 [gm_uuid, 'GM', 'dbanga@synergietechsolutions.com'],
 [vendor_uuid, 'Vendor Signer', ENV.fetch('SIGNER_EMAIL')]].each do |uuid, label, email|
  next unless uuid
  Submitter.create!(
    submission: submission, account: account, uuid: uuid,
    email: email, name: label,
    values: {}, sent_at: Time.current
  )
end

puts "SUBMISSION_ID=#{submission.id}"
puts "---SIGNING URLS---"
submission.submitters.each do |s|
  role_name = template.submitters.find { |ts| ts['uuid'] == s.uuid }['name']
  puts "  #{role_name}: http://localhost:3000/s/#{s.slug}"
end
`;

  const wrapperPath = join(work, 'run.rb');
  writeFileSync(wrapperPath, wrapper);
  writeFileSync(join(work, 'inject-template.rb'), injectScript);
  dockerCp(join(work, 'inject-template.rb'), 'docuseal:/tmp/inject-template.rb');
  dockerCp(wrapperPath, 'docuseal:/tmp/run.rb');

  const output = execSync(
    `docker exec -w /app -e TEMPLATE_NAME="Contract $(date +%Y%m%d-%H%M%S)" -e SIGNER_EMAIL="${signerEmail}" docuseal bin/rails runner /tmp/run.rb`,
    { encoding: 'utf8', stdio: 'pipe' },
  );

  console.log('');
  console.log('==> DONE');
  // Print only the interesting bits
  output.split('\n').forEach((line) => {
    if (line.match(/TEMPLATE_ID|SUBMISSION_ID|SIGNING|http|Fields:/)) {
      console.log(line);
    }
  });
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
