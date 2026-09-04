// Chat history drawer — right-side panel on desktop, full-screen on mobile.
// Lists a user's past conversations; click one to read its messages (read-only).
// Bypasses the /clear boundary — history shows everything so users can go back
// even after clearing the visible thread.

import { useEffect, useState } from 'react';
import { X, ChevronLeft, Loader2, MessageSquare } from 'lucide-react';
import {
  listConversationsForUser,
  listMessages,
  type ConversationSummary,
  type ChatMessage,
} from './api';

export default function HistoryDrawer({
  userId,
  onClose,
  currentConversationId,
}: {
  userId: string;
  onClose: () => void;
  currentConversationId: string | null;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMessages, setDetailMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listConversationsForUser(userId)
      .then((rows) => { if (mounted) setConversations(rows); })
      .catch((e) => { if (mounted) setError(e instanceof Error ? e.message : String(e)); });
    return () => { mounted = false; };
  }, [userId]);

  useEffect(() => {
    if (!selectedId) { setDetailMessages(null); return; }
    let mounted = true;
    setDetailMessages(null);
    listMessages(selectedId)
      .then((rows) => { if (mounted) setDetailMessages(rows); })
      .catch((e) => { if (mounted) setError(e instanceof Error ? e.message : String(e)); });
    return () => { mounted = false; };
  }, [selectedId]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-full md:w-[420px] bg-white shadow-2xl z-50 flex flex-col">
        <header className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {selectedId && (
              <button onClick={() => setSelectedId(null)} className="text-gray-500 hover:text-gray-800 -ml-1" title="Back to list">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <h2 className="text-base font-semibold text-gray-900 truncate">
              {selectedId ? 'Session' : 'History'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800" title="Close">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
          )}

          {!selectedId && conversations === null && (
            <div className="flex items-center justify-center h-full text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {!selectedId && conversations && conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm px-6 text-center">
              <MessageSquare className="w-8 h-8 mb-2" />
              <p>No past sessions yet.</p>
            </div>
          )}

          {!selectedId && conversations && conversations.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{formatDate(c.created_at)}</span>
                      {c.id === currentConversationId && (
                        <span className="text-[10px] uppercase tracking-wide text-indigo-600 font-semibold">Current</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 line-clamp-2">{c.preview}</p>
                    <p className="text-[11px] text-gray-400">{c.message_count} message{c.message_count === 1 ? '' : 's'}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedId && detailMessages === null && (
            <div className="flex items-center justify-center h-full text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {selectedId && detailMessages && (
            <div className="p-3 space-y-3">
              {detailMessages.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">(no messages)</p>
              ) : (
                detailMessages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.direction === 'in'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// Formats an ISO timestamp as "Today 3:42 PM", "Yesterday 9:15 AM", or "Aug 28 3:42 PM".
function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time;
}
