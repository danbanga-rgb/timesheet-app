// Chat conversation shell — thread + input + realtime subscription.
// Slice 3 delivers the visible surface; Slice 4 wires the LLM parse edge fn
// so bot responses land in the thread.

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send, LogOut } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import {
  getOrCreateActiveConversation,
  listMessages,
  sendUserMessage,
  triggerBotProcessing,
  signOutChat,
  type ChatConversation,
  type ChatMessage,
  type ChatProfile,
} from './api';

export default function ChatShell({ profile }: { profile: ChatProfile }) {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Bootstrap: get/create active conversation + load its message history.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const conv = await getOrCreateActiveConversation(profile.id);
        if (!mounted) return;
        setConversation(conv);
        const msgs = await listMessages(conv.id);
        if (!mounted) return;
        setMessages(msgs);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { mounted = false; };
  }, [profile.id]);

  // Realtime: subscribe to new messages for this conversation.
  // Bot's outbound replies land here.
  useEffect(() => {
    if (!conversation) return;
    const channel = supabase
      .channel(`chat-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversation]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!conversation || !input.trim() || sending) return;
    setSending(true);
    setError(null);
    const content = input.trim();
    setInput('');
    try {
      await sendUserMessage(conversation.id, content);
      // Fire bot processing (best-effort; bot writes back via realtime).
      triggerBotProcessing(conversation.id).catch(() => {
        // Non-blocking; bot may not be deployed yet. UI still shows user's msg.
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Restore input so user can retry
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Synergie Chat</h1>
          <p className="text-xs text-gray-500">{profile.name} · {profile.role}</p>
        </div>
        <button
          onClick={signOutChat}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
          title="Sign out"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign out
        </button>
      </header>

      <main className="flex-1 flex flex-col max-w-3xl w-full mx-auto p-4 min-h-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-3 pb-4"
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>

        {error && (
          <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            disabled={sending || !conversation}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || !conversation}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 flex items-center gap-2"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm">
      <p>Say hi to get started.</p>
      <p className="text-xs mt-1">Try: "Sarah Chen starts Monday as timesheetuser, sarah@example.com, US, APFM"</p>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.direction === 'in';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
          isUser
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
        }`}
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}
