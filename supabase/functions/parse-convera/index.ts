// Supabase Edge Function: parse-convera
//
// Accepts a Convera outgoing payment confirmation PDF, calls Claude Haiku
// to extract individual payment line items, and returns structured JSON.
//
// Auth: user JWT (Authorization: Bearer <token>), role must be accountant or admin.
//
// Request: multipart/form-data with field `pdf` (PDF file)
// Response: { payments: Array<{ itemNumber, beneficiary, amount, currency, invoiceRef }> }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl  = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured in edge function secrets' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Verify JWT and role
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (!['accountant', 'admin'].includes(profile?.role ?? '')) {
    return new Response(JSON.stringify({ error: 'Forbidden: accountant or admin role required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Extract PDF bytes from multipart form data
  let pdfBase64: string;
  try {
    const form = await req.formData();
    const file = form.get('pdf') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'No PDF field in form data' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    pdfBase64 = btoa(binary);
  } catch (e) {
    return new Response(JSON.stringify({ error: `Failed to read PDF: ${e}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Call Claude Haiku with the PDF as a native document
  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      system: `You are a payment confirmation parser. Extract every individual payment line item from this Convera outgoing payment confirmation PDF.

For each payment entry extract:
- itemNumber: the OTR item reference (e.g. "OTR6575131-1")
- beneficiary: the recipient/contractor name exactly as shown
- amount: the payment amount as a plain number (no currency symbol, no commas, e.g. 2500.00)
- currency: currency code (e.g. "USD")
- invoiceRef: the invoice reference from the "Re:" or "Inv#" field — extract ONLY the invoice number/code, stripping prefixes like "Inv#", "Invoice", "Re:", "Invoice Number:", etc. Preserve the exact number/code including slashes, hyphens, and alphanumeric characters.

Return ONLY a valid JSON array — no markdown fences, no explanation, nothing else:
[{"itemNumber":"OTR...","beneficiary":"Name","amount":1234.56,"currency":"USD","invoiceRef":"2025-001"}]`,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: 'Extract all payment line items from this Convera payment confirmation PDF.' },
        ],
      }],
    }),
  });

  if (!claudeResp.ok) {
    const errText = await claudeResp.text();
    return new Response(JSON.stringify({ error: `Claude API error: ${errText}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const claude = await claudeResp.json();
  const raw = (claude.content?.[0]?.text ?? '').trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let payments: unknown[];
  try {
    payments = JSON.parse(cleaned);
    if (!Array.isArray(payments)) throw new Error('Not an array');
  } catch {
    return new Response(JSON.stringify({ error: 'Claude returned unparseable JSON', raw }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ payments }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
