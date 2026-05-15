// Supabase Edge Function: parse-convera
//
// Accepts a Convera outgoing payment confirmation PDF, extracts text with
// pdf-parse, then regex-parses each OTR payment block. No Claude/AI calls.
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

// ─── Convera text parser ──────────────────────────────────────────────────────

interface Payment {
  itemNumber: string;
  beneficiary: string;
  amount: number;
  currency: string;
  invoiceRef: string;
}

function parseConveraText(text: string): Payment[] {
  const payments: Payment[] = [];

  // Split into per-payment blocks on OTR item references (e.g. OTR6575131-1)
  // The regex matches OTR followed by digits, a separator, and more digits.
  const otrRe = /OTR\d+[-–]\d+/g;
  const otrMatches = [...text.matchAll(otrRe)];

  for (let i = 0; i < otrMatches.length; i++) {
    const otrRef   = otrMatches[i][0];
    const start    = otrMatches[i].index ?? 0;
    const end      = i + 1 < otrMatches.length ? (otrMatches[i + 1].index ?? text.length) : text.length;
    const block    = text.slice(start, end);

    // Amount: "$1,234.56 USD" or "USD 1,234.56" or plain "1,234.56"
    const amountMatch = block.match(/\$\s*([\d,]+\.?\d*)\s*(USD|EUR)/i)
                     ?? block.match(/(USD|EUR)\s*([\d,]+\.?\d*)/i);
    let amount   = 0;
    let currency = 'USD';
    if (amountMatch) {
      const rawNum = amountMatch[1].startsWith('$') ? amountMatch[2] : amountMatch[1].includes(',') ? amountMatch[1] : amountMatch[2] ?? amountMatch[1];
      amount   = parseFloat((rawNum ?? amountMatch[1]).replace(/,/g, ''));
      currency = (amountMatch[2] ?? amountMatch[1]).toUpperCase() === 'EUR' ? 'EUR' : 'USD';
    }

    // Invoice ref: "Re: Inv# XXX" or "Invoice: XXX" or "Re: XXX"
    const invRefMatch = block.match(/Re:\s*(?:Inv#?\s*)?([A-Za-z0-9][\w\-\/\.]+)/i)
                     ?? block.match(/Invoice[:\s#]+([A-Za-z0-9][\w\-\/\.]+)/i);
    const invoiceRef = invRefMatch?.[1]?.trim() ?? '';

    // Beneficiary: first substantial line in the block after the OTR reference line
    const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 1);
    const otrLineIdx = lines.findIndex(l => l.includes(otrRef));
    let beneficiary = '';
    for (let j = otrLineIdx + 1; j < lines.length; j++) {
      const line = lines[j];
      // Skip lines that look like addresses, account numbers, SWIFTs, amounts, or "Re:"
      if (/^[A-Z]{2}\d{6,}/.test(line)) continue;       // IBAN-like
      if (/^[A-Z]{8,11}$/.test(line)) continue;          // SWIFT-like
      if (/\$|USD|EUR|\d{4,}/.test(line)) continue;      // amount/account line
      if (/^Re:|^Invoice|^Payment|^Item/.test(line)) break;
      if (line.length > 2 && /[a-zA-Z]/.test(line)) { beneficiary = line; break; }
    }

    if (invoiceRef || amount > 0) {
      payments.push({ itemNumber: otrRef, beneficiary, amount, currency, invoiceRef });
    }
  }

  return payments;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Extract PDF bytes
  let pdfBytes: Uint8Array;
  try {
    const form = await req.formData();
    const file = form.get('pdf') as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: 'No PDF field in form data' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    pdfBytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    return new Response(JSON.stringify({ error: `Failed to read PDF: ${e}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Extract text with pdf-parse (import the lib file directly to avoid fs test loading)
  let extractedText = '';
  try {
    // @ts-ignore — npm compat
    const pdfParse = (await import('npm:pdf-parse/lib/pdf-parse.js')).default;
    const result = await pdfParse(pdfBytes);
    extractedText = result.text ?? '';
  } catch (e) {
    return new Response(JSON.stringify({ error: `PDF text extraction failed: ${e}. Try pasting text instead.` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (extractedText.trim().length < 50) {
    return new Response(JSON.stringify({ error: 'Could not extract text from PDF (possibly a scanned image). Try pasting the text manually.' }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const payments = parseConveraText(extractedText);

  if (payments.length === 0) {
    return new Response(JSON.stringify({
      error: 'No OTR payment entries found. Make sure this is a Convera outgoing payment confirmation.',
      extractedTextPreview: extractedText.slice(0, 500),
    }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ payments }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
