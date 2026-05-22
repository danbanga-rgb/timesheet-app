import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: { user: caller }, error: callerErr } = await adminClient.auth.getUser(token);
  if (callerErr || !caller) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single();

  if (!callerProfile || callerProfile.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const {
    email, password, name, role,
    country, region, manager_id, project_id,
    start_date, end_date, phone,
    email_approvals_enabled, invoice_enabled,
    reminders_enabled, vendor_manager_id,
  } = body;

  if (!email || !password || !name) {
    return new Response(JSON.stringify({ error: 'email, password, and name are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const normalizedEmail = (email as string).toLowerCase().trim();

  const { data: existing } = await adminClient
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ error: `A user with email "${email}" already exists.` }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: authUser, error: authErr } = await adminClient.auth.admin.createUser({
    email: normalizedEmail,
    password: password as string,
    email_confirm: true,
    user_metadata: { name },
  });

  if (authErr || !authUser?.user) {
    return new Response(JSON.stringify({ error: authErr?.message || 'Failed to create auth user' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error: profileErr } = await adminClient.from('profiles').insert({
    id:                      authUser.user.id,
    email:                   normalizedEmail,
    username:                normalizedEmail,
    name:                    name as string,
    role:                    role || 'timesheetuser',
    country:                 country || 'US',
    region:                  region || '',
    manager_id:              manager_id || null,
    project_id:              project_id || null,
    start_date:              start_date || null,
    end_date:                end_date || null,
    phone:                   phone || null,
    email_approvals_enabled: email_approvals_enabled ?? false,
    invoice_enabled:         invoice_enabled ?? false,
    reminders_enabled:       reminders_enabled ?? true,
    vendor_manager_id:       vendor_manager_id || null,
  });

  if (profileErr) {
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    return new Response(JSON.stringify({ error: profileErr.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ userId: authUser.user.id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
