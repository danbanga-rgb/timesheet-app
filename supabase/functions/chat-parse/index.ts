// chat-parse — main orchestrator for the Synergie chat bot.
//
// Invoked by the frontend after inserting a user message into chat_messages.
// This function:
//   1. Verifies caller is authenticated + chat_enabled
//   2. Loads conversation state + latest inbound message
//   3. Dispatches by phase:
//        idle                  → LLM classifies intent + extracts fields
//        collecting            → LLM extracts value for the missing_field
//        awaiting_confirmation → LLM interprets yes/no/edit
//   4. Writes bot response into chat_messages (frontend picks up via realtime)
//   5. Updates chat_conversations state
//
// Executor invocation (Slice 6) uses caller's JWT (Option A locked); for
// Slice 4 the executor is stubbed and returns a fake success.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findIntent, intentCatalog, type IntentSpec, type FieldSpec } from './intents.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GROQ_MODEL = 'qwen/qwen3.8-27b';

interface Conversation {
  id: string;
  user_id: string;
  intent: string | null;
  captured: Record<string, unknown>;
  missing_field: string | null;
  phase: string;
}

interface Message {
  id: string;
  content: string;
  created_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ---- Auth ----
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'missing_token' });
  const { data: userRes } = await admin.auth.getUser(jwt);
  if (!userRes?.user) return json(401, { error: 'invalid_token' });

  const { data: profile } = await admin
    .from('profiles')
    .select('id, name, role, chat_enabled')
    .eq('id', userRes.user.id)
    .single();
  if (!profile || !profile.chat_enabled) return json(403, { error: 'chat_not_enabled' });

  // ---- Body ----
  let body: { conversation_id?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'invalid_json' }); }
  if (!body.conversation_id) return json(400, { error: 'missing conversation_id' });

  // ---- Load conversation + latest inbound message ----
  const { data: convo } = await admin
    .from('chat_conversations')
    .select('*')
    .eq('id', body.conversation_id)
    .eq('user_id', profile.id)  // enforce ownership even with service role
    .single();
  if (!convo) return json(404, { error: 'conversation_not_found' });
  const conversation = convo as Conversation;

  const { data: msgs } = await admin
    .from('chat_messages')
    .select('id, content, created_at')
    .eq('conversation_id', conversation.id)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1);
  const latest = (msgs?.[0] as Message | undefined);
  if (!latest) return json(400, { error: 'no_inbound_message' });

  // Universal 'cancel' shortcut
  if (/^\s*cancel\s*$/i.test(latest.content)) {
    await writeBot(admin, conversation.id, 'Cancelled. Nothing was done.');
    await setPhase(admin, conversation.id, 'cancelled');
    return json(200, { ok: true, phase: 'cancelled' });
  }

  // ---- Dispatch by phase ----
  try {
    if (conversation.phase === 'idle' || !conversation.intent) {
      await handleIdle(admin, conversation, latest, profile.id);
    } else if (conversation.phase === 'collecting') {
      await handleCollecting(admin, conversation, latest);
    } else if (conversation.phase === 'awaiting_confirmation') {
      await handleConfirmation(admin, conversation, latest, jwt);
    } else {
      await writeBot(admin, conversation.id,
        `I'm in state "${conversation.phase}" and not sure how to respond. Type "cancel" to reset.`);
    }
    return json(200, { ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[chat-parse] error:', msg);
    await writeBot(admin, conversation.id, `Something went wrong: ${msg}. Type "cancel" to reset.`);
    return json(500, { error: msg });
  }
});

// ─── Phase handlers ────────────────────────────────────────────────

async function handleIdle(
  admin: SupabaseClient,
  conv: Conversation,
  msg: Message,
  callerId: string,
): Promise<void> {
  // Classify intent + extract fields in a single LLM pass.
  const catalog = intentCatalog();
  const permsRes = await admin.rpc('has_permission', { uid: callerId, perm: 'user.create' });
  const canCreate = permsRes.data === true;
  const allowedIntents = catalog.filter((i) => i.name !== 'user.create' || canCreate);

  const parsePrompt = `You classify the user's intent and extract structured data from their message.

Available intents (only pick from these):
${allowedIntents.map((i) => `- "${i.name}": ${i.description}`).join('\n')}

If the user's intent matches one of these, return JSON:
{"intent": "<intent-name>", "fields": { ...extracted-field-values }}

If unclear or unmatched:
{"intent": null, "suggested_reply": "Short question to clarify what they want to do"}

For user.create specifically, extract only these fields (all optional at this stage):
name, email, role, location_type, country, project, start_date, end_date,
vendor_manager, invoice_enabled, send_invite.
Do NOT invent values. Only extract what's explicitly stated.
For role: acceptable values are timesheetuser, manager, accountant, vendormanager, admin.
For location_type: onshore, offshore.
For dates: normalize to YYYY-MM-DD; interpret "monday", "next monday", "10/31", etc.

User's message: """${msg.content}"""`;

  const parsed = await callGroq(parsePrompt);
  const intent = (parsed?.intent as string | null) ?? null;

  if (!intent) {
    const reply = (parsed?.suggested_reply as string) ??
      "I'm not sure what you'd like to do. Try 'add Sarah Chen as timesheetuser starting Monday' for example.";
    await writeBot(admin, conv.id, reply);
    return;
  }

  const spec = findIntent(intent);
  if (!spec) {
    await writeBot(admin, conv.id, `Intent "${intent}" isn't wired up yet.`);
    return;
  }

  const captured = normalizeCaptured(spec, (parsed?.fields as Record<string, unknown>) ?? {});

  await admin.from('chat_conversations').update({
    intent,
    captured,
    phase: 'collecting',
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }).eq('id', conv.id);

  await askNextFieldOrConfirm(admin, { ...conv, intent, captured, phase: 'collecting' });
}

async function handleCollecting(
  admin: SupabaseClient,
  conv: Conversation,
  msg: Message,
): Promise<void> {
  const spec = findIntent(conv.intent!)!;
  const fieldName = conv.missing_field;
  if (!fieldName) {
    await askNextFieldOrConfirm(admin, conv);
    return;
  }
  const field = spec.fields.find((f) => f.name === fieldName);
  if (!field) throw new Error(`Field ${fieldName} not in intent spec`);

  // "skip" shortcut for encouraged fields
  if (field.encouraged && /^\s*skip\s*$/i.test(msg.content)) {
    const captured = { ...conv.captured, [fieldName]: null };
    await admin.from('chat_conversations').update({ captured, missing_field: null }).eq('id', conv.id);
    await askNextFieldOrConfirm(admin, { ...conv, captured, missing_field: null });
    return;
  }

  // LLM extraction for the single field
  const extractPrompt = `The user was asked: "${field.prompt}"
Field name: ${field.name}
Field type: ${field.input_type}
${field.options ? `Valid options: ${field.options.join(', ')}` : ''}
${field.validate === 'email' ? 'Must be a valid email format.' : ''}
${field.validate === 'date' || field.input_type === 'date' ? 'Return date in YYYY-MM-DD format. Interpret relative dates like "monday", "next friday", "10/31".' : ''}

User's answer: """${msg.content}"""

Return JSON:
{"value": <extracted-value-or-null>, "clarify": "<optional-clarifying-question-if-unclear>"}
Do not guess. If the answer doesn't match a valid option, set value to null and provide a clarify message.`;

  const parsed = await callGroq(extractPrompt);
  const value = parsed?.value ?? null;

  if (value === null || value === undefined) {
    const clarify = (parsed?.clarify as string) ??
      `I didn't catch that. ${field.prompt}${field.options ? ' Options: ' + field.options.join(', ') : ''}`;
    await writeBot(admin, conv.id, clarify);
    return;
  }

  const captured = { ...conv.captured, [fieldName]: value };
  await admin.from('chat_conversations').update({
    captured, missing_field: null, last_activity_at: new Date().toISOString(),
  }).eq('id', conv.id);
  await askNextFieldOrConfirm(admin, { ...conv, captured, missing_field: null });
}

async function handleConfirmation(
  admin: SupabaseClient,
  conv: Conversation,
  msg: Message,
  jwt: string,
): Promise<void> {
  const spec = findIntent(conv.intent!)!;
  const confirmPrompt = `The user was asked to confirm creating something with these values:
${JSON.stringify(conv.captured, null, 2)}

Their reply: """${msg.content}"""

Return JSON:
{"action": "yes" | "no" | "edit" | "unknown", "edits": {"field-name": "new-value", ...}}
- "yes": user confirmed / said YES / go ahead / proceed
- "no": user cancelled / declined
- "edit": user is correcting one or more field values (list them in "edits")
- "unknown": can't tell — bot will re-ask`;

  const parsed = await callGroq(confirmPrompt);
  const action = parsed?.action as string;

  if (action === 'yes') {
    await admin.from('chat_conversations').update({ phase: 'executing' }).eq('id', conv.id);
    await executeIntent(admin, conv, spec, jwt);
    return;
  }
  if (action === 'no') {
    await writeBot(admin, conv.id, 'Cancelled. Nothing was done.');
    await setPhase(admin, conv.id, 'cancelled');
    return;
  }
  if (action === 'edit' && parsed?.edits && typeof parsed.edits === 'object') {
    const edits = parsed.edits as Record<string, unknown>;
    const captured = { ...conv.captured, ...edits };
    await admin.from('chat_conversations').update({
      captured, last_activity_at: new Date().toISOString(),
    }).eq('id', conv.id);
    await askNextFieldOrConfirm(admin, { ...conv, captured });
    return;
  }
  await writeBot(admin, conv.id,
    'I didn\'t catch that. Reply YES to proceed, NO to cancel, or send corrections (e.g. "role: manager").');
}

// ─── Executor (STUB for Slice 4 — Slice 6 wires real edge fns) ─────

async function executeIntent(
  admin: SupabaseClient,
  conv: Conversation,
  spec: IntentSpec,
  _jwt: string,
): Promise<void> {
  // Log the action attempt (Slice 6 replaces this with a real chat_actions row).
  await admin.from('chat_actions').insert({
    conversation_id: conv.id,
    actor_user_id: conv.user_id,
    action_type: spec.name,
    action_input: conv.captured,
    status: 'success',
    attempted_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    action_output: { stubbed: true, note: 'Slice 4 executor stub — Slice 6 wires real edge fns' },
  });

  await writeBot(admin, conv.id,
    `✅ [STUB] Would have executed ${spec.name} with the values above. Slice 6 wires the real create-user call.`);
  await setPhase(admin, conv.id, 'done');
}

// ─── Field ordering + confirmation summary ─────────────────────────

async function askNextFieldOrConfirm(
  admin: SupabaseClient,
  conv: Conversation,
): Promise<void> {
  const spec = findIntent(conv.intent!)!;
  const captured = conv.captured;

  // Find the next un-captured field that applies.
  for (const field of spec.fields) {
    if (field.ask_only_if_mentioned) continue;  // never asked, only extracted
    if (field.applies_if && !field.applies_if(captured)) continue;
    if (captured[field.name] !== undefined) continue;  // already set (including null from skip)
    if (!field.required && !field.encouraged) continue;  // truly optional, don't ask

    // Ask for this field
    await admin.from('chat_conversations').update({
      missing_field: field.name, last_activity_at: new Date().toISOString(),
    }).eq('id', conv.id);
    await writeBot(admin, conv.id, formatFieldPrompt(field));
    return;
  }

  // All fields captured (or skipped/defaulted). Move to confirmation.
  await admin.from('chat_conversations').update({
    phase: 'awaiting_confirmation',
    missing_field: null,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }).eq('id', conv.id);
  await writeBot(admin, conv.id, formatConfirmationSummary(spec, captured));
}

function formatFieldPrompt(field: FieldSpec): string {
  const options = field.options ? `\n\nOptions: ${field.options.join(' / ')}` : '';
  const skipHint = field.encouraged ? ' (or type "skip" if unknown)' : '';
  return `${field.prompt}${options}${skipHint}`;
}

function formatConfirmationSummary(spec: IntentSpec, captured: Record<string, unknown>): string {
  // Fill defaults for ask_only_if_mentioned fields so the summary shows them.
  const enriched: Record<string, unknown> = { ...captured };
  for (const field of spec.fields) {
    if (enriched[field.name] === undefined && field.default !== undefined) {
      enriched[field.name] = field.default;
    }
  }
  const lines = spec.fields
    .filter((f) => f.applies_if ? f.applies_if(enriched) : true)
    .map((f) => {
      const v = enriched[f.name];
      const displayValue = v === null || v === undefined
        ? '(not set)'
        : typeof v === 'boolean' ? (v ? 'YES' : 'NO')
        : String(v);
      const humanLabel = f.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `  ${humanLabel}: ${displayValue}`;
    })
    .join('\n');
  return `Confirm — I'll ${spec.description.toLowerCase()} with these details:\n\n${lines}\n\nReply YES to proceed, NO to cancel, or send corrections.`;
}

function normalizeCaptured(spec: IntentSpec, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined || v === '') continue;
    if (spec.fields.find((f) => f.name === k)) {
      out[k] = v;
    }
  }
  return out;
}

// ─── LLM + helpers ──────────────────────────────────────────────────

async function callGroq(prompt: string): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: 'You extract structured data. Reply ONLY with valid JSON. No prose, no code blocks, no thinking tags outside the JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;
  // Strip Qwen thinking-mode tags if present
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function writeBot(admin: SupabaseClient, conversationId: string, content: string): Promise<void> {
  await admin.from('chat_messages').insert({
    conversation_id: conversationId,
    direction: 'out',
    content,
  });
}

async function setPhase(admin: SupabaseClient, conversationId: string, phase: string): Promise<void> {
  await admin.from('chat_conversations').update({
    phase,
    last_activity_at: new Date().toISOString(),
  }).eq('id', conversationId);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
