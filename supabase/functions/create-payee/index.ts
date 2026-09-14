// create-payee — creates a role='external_payee' profile + default payment_profile
// in one call for Manual Invoice one-off payees.
//
// external_payee is a persona, not a login — no invite email, random password,
// filtered out of contractor lists / reminders / chat. Requires payee.create
// permission (granted to accountant + admin + contract_admin).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!token) return json(401, { error: 'missing_token' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: { user: caller } } = await admin.auth.getUser(token);
  if (!caller) return json(401, { error: 'invalid_token' });

  const { data: allowed } = await admin.rpc('has_permission', {
    uid: caller.id, perm: 'payee.create',
  });
  if (!allowed) return json(403, { error: 'missing_payee.create_permission' });

  let body: {
    name?: string; email?: string; iban?: string; swift?: string;
    bank_name?: string; country?: string; payment_method?: string;
    qb_vendor_name?: string; currency?: string;
  };
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }

  const name = (body.name ?? '').trim();
  if (!name) return json(400, { error: 'name required' });

  const paymentMethod = body.payment_method === 'Intuit' ? 'Intuit' : 'Convera';
  const iban = (body.iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (paymentMethod === 'Convera' && iban.length < 8) {
    return json(400, { error: 'iban required for Convera payees' });
  }

  // Auto-generate a placeholder email — the payee never signs in. Use a
  // reserved subdomain so it can't collide with real accounts.
  const providedEmail = (body.email ?? '').trim().toLowerCase();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'payee';
  const stampedEmail = providedEmail || `payee-${slug}-${Date.now()}@synergietechsolutions.internal`;

  // Random password — external payee cannot log in; hidden and unused.
  const password = crypto.randomUUID() + crypto.randomUUID();

  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email: stampedEmail,
    password,
    email_confirm: true,
    user_metadata: { name, external_payee: true },
  });
  if (authErr || !authUser?.user) return json(500, { error: authErr?.message || 'auth user create failed' });

  const userId = authUser.user.id;

  const { error: profileErr } = await admin.from('profiles').insert({
    id: userId,
    email: stampedEmail,
    username: stampedEmail,
    name,
    role: 'external_payee',
    country: (body.country ?? 'US').toUpperCase().slice(0, 2),
    region: '',
    invoice_enabled: false,
    reminders_enabled: false,
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: `profile: ${profileErr.message}` });
  }

  const { data: profileRow, error: ppErr } = await admin.from('payment_profiles').insert({
    user_id: userId,
    profile_name: name,
    company_name: name,
    iban: paymentMethod === 'Convera' ? iban : '',
    swift: (body.swift ?? '').trim().toUpperCase(),
    bank_name: (body.bank_name ?? '').trim(),
    qb_vendor_name: (body.qb_vendor_name ?? '').trim() || null,
    is_default: true,
  }).select('id').single();

  if (ppErr) {
    // Roll back profile + auth user so caller can retry without residue.
    await admin.from('profiles').delete().eq('id', userId);
    await admin.auth.admin.deleteUser(userId);
    return json(500, { error: `payment_profile: ${ppErr.message}` });
  }

  return json(200, {
    user_id: userId,
    payment_profile_id: (profileRow as { id: number }).id,
    payment_method: paymentMethod,
    currency: (body.currency ?? 'USD').toUpperCase(),
  });
});
