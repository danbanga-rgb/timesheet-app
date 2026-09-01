// Supabase queries + edge function calls for the ContractAdmin module.
// Kept narrow — one export per operation, no state, no UI concerns.

import { supabase } from '../../supabaseClient';

export interface Counterparty {
  id: string;
  vendor_short_name: string;
  vendor_full_name: string;
  country: string | null;
  address_block: string | null;
  default_signer_name: string | null;
  default_signer_email: string | null;
  default_signer_title: string | null;
}

export async function listCounterparties(): Promise<Counterparty[]> {
  const { data, error } = await supabase
    .from('counterparties')
    .select('id, vendor_short_name, vendor_full_name, country, address_block, default_signer_name, default_signer_email, default_signer_title')
    .order('vendor_short_name');
  if (error) throw error;
  return data ?? [];
}

export interface UpsertCounterpartyInput {
  id?: string;
  vendor_short_name: string;
  vendor_full_name: string;
  country: string | null;
  address_block: string | null;
  default_signer_name?: string | null;
  default_signer_email?: string | null;
  default_signer_title?: string | null;
}

export async function upsertCounterparty(input: UpsertCounterpartyInput): Promise<string> {
  if (input.id) {
    const { error } = await supabase
      .from('counterparties')
      .update({
        vendor_full_name: input.vendor_full_name,
        country: input.country,
        address_block: input.address_block,
        default_signer_name: input.default_signer_name ?? null,
        default_signer_email: input.default_signer_email ?? null,
        default_signer_title: input.default_signer_title ?? null,
      })
      .eq('id', input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await supabase
    .from('counterparties')
    .insert({
      vendor_short_name: input.vendor_short_name,
      vendor_full_name: input.vendor_full_name,
      country: input.country,
      address_block: input.address_block,
      default_signer_name: input.default_signer_name ?? null,
      default_signer_email: input.default_signer_email ?? null,
      default_signer_title: input.default_signer_title ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export interface GenerateContractInput {
  variables: Record<string, string>;
  output_path: string;
}

export async function generateContract(input: GenerateContractInput): Promise<{ path: string }> {
  const { data, error } = await supabase.functions.invoke('generate-contract', {
    body: input,
  });
  if (error) throw error;
  return data;
}

export async function getSignedUrl(path: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from('contract-documents')
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadFilledDocx(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage
    .from('contract-documents')
    .download(path);
  if (error) throw error;
  return await data.arrayBuffer();
}
