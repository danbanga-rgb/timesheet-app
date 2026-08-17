// Diagnose + backfill profiles.country from Supabase auth.sessions IP geolocation.
//
// Motivation: detectUserLocation() in the app pre-fills the new-user form based on
// the ADMIN's browser timezone (src/TimesheetSystem.tsx:1571) — so admins in the US
// have historically created offshore contractors with country='US'. This mislabels
// downstream logic (timezone for reminders, and historically the payment-method
// default until b893df4 switched it to override-history).
//
// This script:
//   1. Pulls each timesheetuser's most recent N sessions (auth.sessions.ip) via
//      Supabase Management API.
//   2. Geolocates each IP via ip-api.com batch endpoint (free, 100 IPs/req, no auth).
//   3. Ignores Cloudflare-proxy IPs (WARP masks real country) and hosting IPs.
//   4. Picks the modal countryCode from the remaining samples per contractor.
//   5. Reports a proposed profiles.country update where detected != current.
//   6. With --apply, writes the update via service role key.
//
// SAFE by default (dry-run). --apply required to write.
//
// Only touches profiles.country. Does NOT touch region (leave to admin) or
// location_type (accountant-curated billing axis, may legitimately disagree
// with geography — Liya Haustova pattern).
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=<sr_key> SUPABASE_PAT=<pat> \
//     node scripts/one-off/backfill-profile-country-from-ip.cjs [--apply]

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://mimlatvdwxqtgxrgcins.supabase.co';
const PROJECT_REF = 'mimlatvdwxqtgxrgcins';
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAT = process.env.SUPABASE_PAT;
if (!SR_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
if (!PAT) { console.error('Set SUPABASE_PAT (Supabase Personal Access Token — required to query auth.sessions via Management API)'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const SAMPLES_PER_USER = 5;

const supabase = createClient(SUPABASE_URL, SR_KEY);

async function mgmtQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function geoLookup(ips) {
  if (ips.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < ips.length; i += 100) chunks.push(ips.slice(i, i + 100));
  const results = [];
  for (const chunk of chunks) {
    const res = await fetch('http://ip-api.com/batch?fields=query,countryCode,country,isp,mobile,proxy,hosting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`ip-api ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    results.push(...rows);
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 1500)); // stay under 45/min limit
  }
  return results;
}

function modalCountry(samples) {
  const counts = new Map();
  for (const s of samples) {
    if (!s.countryCode) continue;
    if (s.proxy || s.hosting) continue;
    counts.set(s.countryCode, (counts.get(s.countryCode) || 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

(async () => {
  console.log(`\n=== profiles.country backfill from auth.sessions IPs ===`);
  console.log(APPLY ? '*** APPLY MODE — will write changes ***' : 'Dry-run (pass --apply to write)\n');

  // Pull most recent N sessions per timesheetuser with a non-null IP.
  const sql = `
    WITH ranked AS (
      SELECT s.user_id, s.ip::text AS ip, s.refreshed_at,
             ROW_NUMBER() OVER (PARTITION BY s.user_id ORDER BY s.refreshed_at DESC NULLS LAST) AS rn
      FROM auth.sessions s
      WHERE s.ip IS NOT NULL
    )
    SELECT p.id, p.name, p.country, p.location_type, r.ip
    FROM ranked r
    JOIN public.profiles p ON p.id = r.user_id
    WHERE p.role = 'timesheetuser' AND r.rn <= ${SAMPLES_PER_USER}
    ORDER BY p.name, r.rn
  `;
  const rows = await mgmtQuery(sql);
  console.log(`Fetched ${rows.length} session rows across ${new Set(rows.map(r => r.id)).size} contractors\n`);

  // Group IPs per contractor (deduped, CIDR-stripped)
  const perUser = new Map();
  const ipSet = new Set();
  for (const r of rows) {
    const ip = r.ip.replace(/\/.*$/, '');
    if (!perUser.has(r.id)) perUser.set(r.id, { name: r.name, country: r.country, location_type: r.location_type, ips: [] });
    perUser.get(r.id).ips.push(ip);
    ipSet.add(ip);
  }
  const allIps = [...ipSet];
  console.log(`Looking up ${allIps.length} unique IPs...\n`);

  const geo = await geoLookup(allIps);
  const geoMap = new Map(geo.map(g => [g.query, g]));

  const proposals = [];
  const noSignal = [];
  const matches = [];
  for (const [id, u] of perUser.entries()) {
    const samples = u.ips.map(ip => geoMap.get(ip)).filter(Boolean);
    const detected = modalCountry(samples);
    const currentCC = (u.country || '').toUpperCase();
    if (!detected) {
      noSignal.push({ id, name: u.name, country: u.country, sample_isps: samples.map(s => s.isp).slice(0, 3) });
      continue;
    }
    if (detected === currentCC) {
      matches.push({ name: u.name, cc: detected });
      continue;
    }
    // US → United States canonicalisation. Profile may hold "United States" instead of "US".
    if ((u.country === 'United States' && detected === 'US') || (u.country === 'US' && detected === 'US')) {
      matches.push({ name: u.name, cc: detected });
      continue;
    }
    proposals.push({
      id, name: u.name, current: u.country || '(empty)', detected,
      location_type: u.location_type,
      isps: [...new Set(samples.map(s => s.isp))].slice(0, 3),
      sample_count: samples.length,
    });
  }

  console.log(`=== SUMMARY ===`);
  console.log(`Matches (no change needed):  ${matches.length}`);
  console.log(`Proposed changes:            ${proposals.length}`);
  console.log(`No signal (all proxied/empty): ${noSignal.length}\n`);

  if (proposals.length > 0) {
    console.log(`=== PROPOSED profiles.country UPDATES ===`);
    for (const p of proposals) {
      console.log(`  ${p.name.padEnd(30)}  ${String(p.current).padEnd(20)} → ${p.detected}  [location_type=${p.location_type || 'null'}, ${p.sample_count} samples, ${p.isps.join(', ')}]`);
    }
    console.log('');
  }

  if (noSignal.length > 0) {
    console.log(`=== NO SIGNAL (WARP/hosting proxies mask real IP) ===`);
    for (const n of noSignal) {
      console.log(`  ${n.name.padEnd(30)}  current=${n.country || '(empty)'}  ISPs=${n.sample_isps.join(', ')}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log(`(dry-run — no writes. Pass --apply to update ${proposals.length} profile(s))`);
    return;
  }

  console.log(`Applying ${proposals.length} updates...`);
  let ok = 0, fail = 0;
  for (const p of proposals) {
    const { error } = await supabase.from('profiles').update({ country: p.detected }).eq('id', p.id);
    if (error) { console.error(`  FAIL ${p.name}: ${error.message}`); fail++; }
    else { console.log(`  OK   ${p.name}: ${p.current} → ${p.detected}`); ok++; }
  }
  console.log(`\nDone. ${ok} updated, ${fail} failed.`);
})().catch(err => { console.error(err); process.exit(1); });
