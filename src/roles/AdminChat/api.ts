// Admin chat-activity API. Admin RLS on chat_actions / chat_messages /
// chat_conversations lets `role_permissions.manage` holders read everything;
// these helpers just wrap the queries + join actor names for display.

import { supabase } from '../../supabaseClient';

export interface ChatActionRow {
  id: string;
  conversation_id: string;
  actor_user_id: string;
  actor_name: string;
  actor_email: string;
  action_type: string;
  action_input: Record<string, unknown>;
  action_output: Record<string, unknown> | null;
  status: 'pending' | 'retrying' | 'success' | 'partial' | 'failed' | 'cancelled';
  attempted_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  parsed_intent: Record<string, unknown> | null;
  action_taken: Record<string, unknown> | null;
  created_at: string;
}

export async function listRecentChatActions(limit = 100): Promise<ChatActionRow[]> {
  const { data: actions, error } = await supabase
    .from('chat_actions')
    .select('id, conversation_id, actor_user_id, action_type, action_input, action_output, status, attempted_at, completed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load chat actions: ${error.message}`);
  const rows = (actions ?? []) as Array<Omit<ChatActionRow, 'actor_name' | 'actor_email'>>;
  if (rows.length === 0) return [];

  const actorIds = Array.from(new Set(rows.map((r) => r.actor_user_id)));
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email')
    .in('id', actorIds);
  const profileById = new Map<string, { name: string; email: string }>();
  for (const p of (profiles ?? []) as Array<{ id: string; name: string; email: string }>) {
    profileById.set(p.id, { name: p.name, email: p.email });
  }
  return rows.map((r) => ({
    ...r,
    actor_name: profileById.get(r.actor_user_id)?.name ?? '(unknown)',
    actor_email: profileById.get(r.actor_user_id)?.email ?? '',
  }));
}

export async function listMessagesForConversation(conversationId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, conversation_id, direction, content, parsed_intent, action_taken, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return (data ?? []) as ChatMessageRow[];
}
