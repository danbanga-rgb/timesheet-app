// Manual Invoice — Supabase-facing helpers for payee creation + invoice write.

import { supabase } from '../../supabaseClient';
import type { OneOffPayeeDraft } from './types';

interface CreatePayeeResult {
  userId: string;
  paymentProfileId?: number;
  paymentMethod?: string;
  currency?: string;
  error?: string;
}

export async function createOneOffPayee(draft: OneOffPayeeDraft): Promise<CreatePayeeResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { userId: '', error: 'no active session' };

  const url = `${(supabase as unknown as { supabaseUrl: string }).supabaseUrl}/functions/v1/create-payee`;
  const anonKey = (supabase as unknown as { supabaseKey: string }).supabaseKey;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey,
    },
    body: JSON.stringify({
      name: draft.name,
      email: draft.email || undefined,
      iban: draft.iban,
      swift: draft.swift,
      bank_name: draft.bankName,
      country: draft.countryCode,
      payment_method: draft.paymentMethod,
      qb_vendor_name: draft.qbVendorName,
      currency: draft.currency,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try { msg = (JSON.parse(body) as { error?: string }).error ?? body; } catch { /* keep raw */ }
    return { userId: '', error: msg };
  }

  const body = await res.json() as { user_id: string; payment_profile_id: number; payment_method: string; currency: string };
  return {
    userId: body.user_id,
    paymentProfileId: body.payment_profile_id,
    paymentMethod: body.payment_method,
    currency: body.currency,
  };
}
