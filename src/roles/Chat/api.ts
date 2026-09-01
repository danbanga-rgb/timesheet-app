// Chat surface API helpers. Keep narrow — one export per operation.

import { supabase } from '../../supabaseClient';

export interface ChatProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  chat_enabled: boolean;
}

// Returns the current user's chat profile (name, role, chat_enabled)
// or null if not authenticated.
export async function getChatProfile(): Promise<ChatProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, role, chat_enabled')
    .eq('id', user.id)
    .single();
  if (error || !data) return null;
  return data as ChatProfile;
}

// Signs the user out (returns to /chat which shows the login screen).
export async function signOutChat(): Promise<void> {
  await supabase.auth.signOut();
  window.location.href = '/chat';
}
