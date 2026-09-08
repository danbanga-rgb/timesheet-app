// Admin surface: read-only view of chat actions + full conversation transcripts.
// Data is captured on every chat turn (chat_messages) and every write execution
// (chat_actions). This panel surfaces the write-side audit trail with a
// click-to-expand transcript for context.

import { useEffect, useState, type ReactElement } from 'react';
import { MessageSquare, RefreshCw, ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import {
  listRecentChatActions,
  listMessagesForConversation,
  type ChatActionRow,
  type ChatMessageRow,
} from './api';

type StatusFilter = 'all' | 'success' | 'failed' | 'pending';

const STATUS_ICON: Record<ChatActionRow['status'], ReactElement> = {
  pending: <Clock className="w-4 h-4 text-amber-600" />,
  retrying: <Clock className="w-4 h-4 text-amber-600" />,
  success: <CheckCircle className="w-4 h-4 text-green-600" />,
  partial: <AlertTriangle className="w-4 h-4 text-amber-600" />,
  failed: <XCircle className="w-4 h-4 text-red-600" />,
  cancelled: <XCircle className="w-4 h-4 text-gray-400" />,
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function summarizeInput(actionType: string, input: Record<string, unknown>): string {
  const parts: string[] = [];
  const target = input.target ?? input.name ?? input.email;
  if (typeof target === 'string') parts.push(target);
  const dateField = actionType.endsWith('set_start_date')
    ? input.start_date
    : actionType.endsWith('set_end_date')
      ? input.end_date
      : undefined;
  if (typeof dateField === 'string') parts.push(`→ ${dateField}`);
  if (actionType === 'user.update_country_region') {
    const country = input.country;
    const region = input.region;
    if (typeof country === 'string') parts.push(`→ ${country}${typeof region === 'string' ? `/${region}` : ''}`);
  }
  if (actionType === 'user.create') {
    if (typeof input.role === 'string') parts.push(`role=${input.role}`);
    if (typeof input.project === 'string') parts.push(`project=${input.project}`);
  }
  return parts.join(' ');
}

function TranscriptPanel({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<ChatMessageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    listMessagesForConversation(conversationId)
      .then((rows) => { if (!cancelled) setMessages(rows); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [conversationId]);

  if (error) return <div className="text-sm text-red-600">Failed to load transcript: {error}</div>;
  if (!messages) return <div className="text-sm text-gray-500">Loading transcript…</div>;
  if (messages.length === 0) return <div className="text-sm text-gray-500">(no messages)</div>;

  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex ${m.direction === 'in' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-2xl px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
              m.direction === 'in'
                ? 'bg-indigo-50 text-indigo-900 border border-indigo-100'
                : 'bg-gray-100 text-gray-800 border border-gray-200'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
              {m.direction === 'in' ? 'user' : 'bot'} · {formatWhen(m.created_at)}
            </div>
            <div>{m.content}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminChatActivity() {
  const [rows, setRows] = useState<ChatActionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listRecentChatActions(200)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const filtered = (rows ?? []).filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (actionFilter !== 'all' && r.action_type !== actionFilter) return false;
    return true;
  });

  const actionTypes = Array.from(new Set((rows ?? []).map((r) => r.action_type))).sort();

  const counts = {
    total: rows?.length ?? 0,
    success: rows?.filter((r) => r.status === 'success').length ?? 0,
    failed: rows?.filter((r) => r.status === 'failed').length ?? 0,
    pending: rows?.filter((r) => r.status === 'pending' || r.status === 'retrying').length ?? 0,
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" /> Chat Activity
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Every write triggered through the chat surface, newest first. Click a row to view the full conversation transcript.
          </p>
        </div>
        <button
          onClick={() => setRefreshTick((t) => t + 1)}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {(['all', 'success', 'pending', 'failed'] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full font-medium ${
              statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {s === 'all' ? `All (${counts.total})` :
              s === 'success' ? `Success (${counts.success})` :
              s === 'pending' ? `Pending (${counts.pending})` :
              `Failed (${counts.failed})`}
          </button>
        ))}
        {actionTypes.length > 0 && (
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="ml-2 px-3 py-1 rounded-full border border-gray-300 bg-white text-gray-700"
          >
            <option value="all">All intents</option>
            {actionTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="p-3 mb-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          {error}
        </div>
      )}

      {!rows && !error && (
        <div className="text-sm text-gray-500 py-8 text-center">Loading…</div>
      )}

      {rows && filtered.length === 0 && (
        <div className="text-sm text-gray-500 py-8 text-center">No chat actions match the current filters.</div>
      )}

      {filtered.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-8"></th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">When</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Actor</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Intent</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((r) => {
                const isOpen = expandedId === r.id;
                return (
                  <>
                    <tr
                      key={r.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpandedId(isOpen ? null : r.id)}
                    >
                      <td className="px-2">
                        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatWhen(r.created_at)}</td>
                      <td className="px-3 py-2 text-gray-700">
                        <div>{r.actor_name}</div>
                        <div className="text-xs text-gray-400">{r.actor_email}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.action_type}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {STATUS_ICON[r.status]}
                          <span className="text-xs text-gray-700">{r.status}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{summarizeInput(r.action_type, r.action_input)}</td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + '-expand'} className="bg-gray-50">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Input</div>
                              <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto">
{JSON.stringify(r.action_input, null, 2)}
                              </pre>
                              {r.action_output && (
                                <>
                                  <div className="text-xs uppercase tracking-wide text-gray-500 mt-3 mb-1">Output</div>
                                  <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto">
{JSON.stringify(r.action_output, null, 2)}
                                  </pre>
                                </>
                              )}
                            </div>
                            <div>
                              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Transcript</div>
                              <div className="bg-white border border-gray-200 rounded p-3 max-h-96 overflow-y-auto">
                                <TranscriptPanel conversationId={r.conversation_id} />
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
