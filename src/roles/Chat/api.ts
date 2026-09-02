// Chat surface API helpers. Keep narrow — one export per operation.

import { supabase } from '../../supabaseClient';

export interface ChatProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  chat_enabled: boolean;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  parsed_intent: Record<string, unknown> | null;
  action_taken: Record<string, unknown> | null;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  user_id: string;
  intent: string | null;
  captured: Record<string, unknown>;
  missing_field: string | null;
  phase: 'idle' | 'parsing' | 'collecting' | 'awaiting_confirmation' | 'executing' | 'done' | 'cancelled' | 'error';
  started_at: string | null;
  last_activity_at: string;
  expires_at: string | null;
  created_at: string;
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

// Returns the user's active (non-terminal) conversation, or creates a new
// one if none exists. Non-terminal = phase not in ('done','cancelled','error').
export async function getOrCreateActiveConversation(userId: string): Promise<ChatConversation> {
  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('user_id', userId)
    .not('phase', 'in', '(done,cancelled,error)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as ChatConversation;

  const { data: created, error } = await supabase
    .from('chat_conversations')
    .insert({ user_id: userId, phase: 'idle' })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to create conversation: ${error.message}`);
  return created as ChatConversation;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return (data ?? []) as ChatMessage[];
}

// Persistent history: fetch the user's recent messages across ALL conversations
// so scrolling back shows prior turns after refresh / new-session bootstrap.
// Cap at 200 (rolling ~week for CA's expected volume). User can /clear to hide.
export async function listRecentMessagesForUser(userId: string, limit = 200): Promise<ChatMessage[]> {
  // Fetch conversation ids owned by this user, then messages joined by conv_id.
  const { data: convs } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  const convIds = (convs ?? []).map((c: { id: string }) => c.id);
  if (convIds.length === 0) return [];
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load history: ${error.message}`);
  // Return ascending for display (oldest → newest).
  return ((data ?? []) as ChatMessage[]).reverse();
}

// Send an inbound message from the user. Returns the created row.
export async function sendUserMessage(conversationId: string, content: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ conversation_id: conversationId, direction: 'in', content })
    .select('*')
    .single();
  if (error) throw new Error(`Failed to send message: ${error.message}`);
  // Bump conversation activity timestamp
  await supabase
    .from('chat_conversations')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', conversationId);
  return data as ChatMessage;
}

// Invoke the chat-parse edge fn to trigger bot processing of the latest message.
// Fire-and-forget from the UI's perspective — the bot response arrives via
// realtime subscription on chat_messages.
export async function triggerBotProcessing(conversationId: string): Promise<void> {
  await supabase.functions.invoke('chat-parse', {
    body: { conversation_id: conversationId },
  });
}
