// Supabase Edge Function: trigger-poller
//
// Called by pg_cron every hour to trigger the GitHub Actions workflow_dispatch
// for poll-timesheets.yml. Replaces the unreliable GitHub scheduled cron,
// which can lag 3-10+ hours on low-activity repositories.
//
// Auth: Supabase JWT verification (anon key) — same pattern as send-reminder.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const githubPat  = Deno.env.get('GITHUB_PAT');
  const githubRepo = Deno.env.get('GITHUB_REPO') || 'danbanga-rgb/timesheet-app';
  const workflow   = 'poll-timesheets.yml';

  if (!githubPat) {
    return new Response(JSON.stringify({ error: 'GITHUB_PAT not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = `https://api.github.com/repos/${githubRepo}/actions/workflows/${workflow}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `token ${githubPat}`,
      'Accept':        'application/vnd.github.v3+json',
      'Content-Type':  'application/json',
      'User-Agent':    'supabase-trigger-poller',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  // GitHub returns 204 No Content on success
  if (res.status === 204) {
    console.log(`✅ Triggered ${workflow} on ${githubRepo}`);
    return new Response(JSON.stringify({ ok: true, triggered: workflow }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await res.text();
  console.error(`❌ GitHub dispatch failed: ${res.status} ${body}`);
  return new Response(JSON.stringify({ ok: false, status: res.status, body }), {
    status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
