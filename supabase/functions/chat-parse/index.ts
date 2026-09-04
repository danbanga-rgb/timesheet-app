// chat-parse — main orchestrator for the Synergie chat bot.
//
// Invoked by the frontend after inserting a user message into chat_messages.
// This function:
//   1. Verifies caller is authenticated + chat_enabled
//   2. Loads conversation state + latest inbound message
//   3. Dispatches by phase:
//        idle                  → LLM classifies intent, then hands off to driveCollecting
//        collecting            → driveCollecting: single LLM pass extracts fields + writes reply
//        awaiting_confirmation → LLM interprets yes/no/edit
//   4. Writes bot response into chat_messages (frontend picks up via realtime)
//   5. Updates chat_conversations state
//
// LLM-driven refactor (2026-09-04, chat-improvements.md Pri 0):
//   Server owns intent schema, validation, phase progression, executor.
//   LLM owns understanding intent, phrasing, grouping questions, handling
//   edits mid-conversation. No more hard-coded per-field prompts.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { findIntent, intentCatalog, type IntentSpec } from './intents.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Groq production-tier model with 250k TPM cap (vs the ~1k OTPM on the
// deprecated preview qwen3.8-27b). Groq's own recommended migration target
// for llama-3.1-8b-instant (retired Aug 2026). Cheap, fast, JSON-friendly.
// TODO: migrate to Vercel AI Gateway for provider-agnostic routing —
// see MEMORY.md project_ai_gateway_migration.
const GROQ_MODEL = 'openai/gpt-oss-20b';

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

  // Rate limits (Slice 7). Admin gets 10x the base cap.
  // Message rate: 10/min baseline (100/min admin), 200/day baseline (2000/day admin).
  // Executor rate: 30/hr baseline (300/hr admin) — checked inside executeIntent.
  const isAdmin = profile.role === 'admin';
  const msgCapMin = isAdmin ? 100 : 10;
  const msgCapDay = isAdmin ? 2000 : 200;
  const { count: last1m } = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'in')
    .eq('conversation_id', conversation.id)
    .gte('created_at', new Date(Date.now() - 60 * 1000).toISOString());
  if ((last1m ?? 0) > msgCapMin) {
    await writeBot(admin, conversation.id,
      `Slow down — you've sent more than ${msgCapMin} messages in the last minute. Try again in a moment.`);
    return json(429, { error: 'rate_limit_min' });
  }
  const { count: last24h } = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'in')
    .eq('conversation_id', conversation.id)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  if ((last24h ?? 0) > msgCapDay) {
    await writeBot(admin, conversation.id,
      `Daily message cap reached (${msgCapDay}). Resets in a rolling 24-hour window.`);
    return json(429, { error: 'rate_limit_day' });
  }

  // ---- Dispatch by phase ----
  try {
    if (conversation.phase === 'idle' || !conversation.intent) {
      await handleIdle(admin, conversation, latest, profile.id);
    } else if (conversation.phase === 'collecting') {
      await driveCollecting(admin, conversation, latest);
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
  // Classify intent + extract fields in a single LLM pass. Filter the catalog
  // by the caller's permissions so the LLM never picks an intent they can't run.
  const catalog = intentCatalog();
  const permChecks = await Promise.all(
    catalog.map(async (i) => {
      const spec = findIntent(i.name)!;
      const { data } = await admin.rpc('has_permission', { uid: callerId, perm: spec.required_permission });
      return { name: i.name, allowed: data === true };
    }),
  );
  const allowedNames = new Set(permChecks.filter((p) => p.allowed).map((p) => p.name));
  const allowedIntents = catalog.filter((i) => allowedNames.has(i.name));

  // Fetch recent conversation history so the classifier can interpret
  // corrections and follow-ups ("no, I meant the regular Aleksandar", "show
  // just the offshore ones", etc.). Multi-turn context flows because we
  // reuse the same conversation after each success (see resetAfterSuccess).
  const history = await fetchRecentHistory(admin, conv.id, 6);

  const parsePrompt = `You classify the user's intent and extract structured data from their message.

TODAY IS ${todayIso()}. Use this as the reference for any relative dates
("monday", "tomorrow", "next friday", "in 2 weeks", etc.). Never invent a
date from an unknown reference year.

Available intents (only pick from these):
${allowedIntents.map((i) => `- "${i.name}": ${i.description}`).join('\n')}

${history.length > 0 ? `RECENT CONVERSATION (context for follow-ups and corrections):
${history.map((m) => `${m.direction === 'in' ? 'User' : 'Bot'}: ${m.content}`).join('\n')}

If the user's latest message is a correction or refinement of a previous read/query (e.g. "no I meant X", "the other one", "just the offshore ones"), pick the SAME intent as that previous query and extract the corrected filters/target. Prior extracted values do NOT carry over automatically — the corrected message should re-supply what changes.
` : ''}

STRICT CLASSIFICATION RULES:
- user.create: user is **providing information to create a new user**. Signals: "add", "create", "onboard", "starts as", "is joining", "new hire".
- user.set_start_date / user.set_end_date: user is **setting a date on an EXISTING person** (verbs: "set", "update", "change", "ends", "starts on"). If the person doesn't exist yet, fall back to user.create.
- user.get: user is **asking about ONE specific person** ("when does X start?", "what is X's project?", "is X still active?", "show X's details").
- user.list: user is **asking for MULTIPLE users matching a filter** — signals include: "who is on <project>?", "list <role>", "show users with <property>", "how many <role>?", "which <role> ended...?", "who reports to <name>?", "contractors for <name>", "team for <manager name>", "everyone in <country>". When you see "reports to <X>" or "contractors for <X>", extract that person as vendor_manager.
- Delete / archive / reassign are NOT supported yet — return intent=null with a suggested_reply.
- If unclear, err on the side of intent=null. Do NOT force a match.

If the user's intent matches one of the available intents, return JSON:
{"intent": "<intent-name>", "fields": { ...extracted-field-values }}

If unclear or unmatched:
{"intent": null, "suggested_reply": "Short reply describing what you CAN do — create users, set/update start or end dates, look up a single user's details, or list users matching filters."}

Extract initial field values from the message for the classified intent:
- user.create: name, email, role, location_type, country, project, start_date, end_date, vendor_manager, invoice_enabled, send_invite
- user.set_start_date / user.set_end_date: target (name or email), start_date / end_date
- user.get: target (name or email)
- user.list: role, project, country, location_type, vendor_manager (name/email), active (yes/no), missing_start_date (yes/no), limit (number)

Do NOT invent values. Only extract what's explicitly stated.
For role: timesheetuser, manager, accountant, vendormanager, admin, contract_admin.
For location_type: onshore, offshore.
For dates: normalize to YYYY-MM-DD relative to TODAY as noted above.

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

  // Guard: if the LLM classified user.create but a user with the extracted
  // name/email already exists, ask before creating a duplicate. Catches
  // "set start date for Test Contractor" misclassified as create.
  if (intent === 'user.create') {
    const nameCandidate = typeof captured.name === 'string' ? captured.name.trim() : '';
    const emailCandidate = typeof captured.email === 'string' ? captured.email.trim().toLowerCase() : '';
    if (nameCandidate || emailCandidate) {
      let query = admin.from('profiles').select('id, name, email').limit(1);
      if (emailCandidate) query = query.eq('email', emailCandidate);
      else query = query.ilike('name', nameCandidate);
      const { data: existing } = await query;
      if (existing && existing.length > 0) {
        const found = existing[0] as { name: string; email: string };
        await writeBot(admin, conv.id,
          `"${found.name}" (${found.email}) already exists. Did you mean one of:\n` +
          `  • Set start date: "set start date for ${found.name} to <date>"\n` +
          `  • Set end date: "${found.name} ends <date>"\n` +
          `Or type a different name to create a new user, or "cancel".`);
        // Stay in idle phase — user re-phrases and we re-classify.
        return;
      }
    }
  }

  await admin.from('chat_conversations').update({
    intent,
    captured,
    missing_field: null,
    phase: 'collecting',
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }).eq('id', conv.id);

  // Hand off to the LLM-driven collecting loop. It uses the same latest message
  // (redundant with classifier extraction, but idempotent + catches anything the
  // classifier missed) and generates the first natural reply.
  await driveCollecting(admin, { ...conv, intent, captured, phase: 'collecting' }, msg);
}

// LLM-driven collecting phase (2026-09-04 refactor):
// Single LLM call extracts any new field values from the user's latest message
// AND writes the next reply (grouped questions, natural phrasing). Server
// validates extracted fields (drops invented, enforces types/options), then
// decides phase: if all required fields captured → confirmation; else write
// LLM's reply and stay in collecting.
async function driveCollecting(
  admin: SupabaseClient,
  conv: Conversation,
  msg: Message,
): Promise<void> {
  const spec = findIntent(conv.intent!)!;
  const captured = { ...conv.captured };

  // Skip shortcut still supported explicitly for encouraged-field UX.
  // (LLM would eventually skip too, but explicit "skip" from user is a strong signal.)
  if (/^\s*skip\s*$/i.test(msg.content)) {
    // Mark the *next* encouraged field as skipped (null), if any.
    for (const f of spec.fields) {
      if (!f.encouraged) continue;
      if (f.applies_if && !f.applies_if(captured)) continue;
      if (captured[f.name] !== undefined) continue;
      captured[f.name] = null;
      break;
    }
    // Fall through to normal drive with the message stripped of "skip" semantics.
  }

  const history = await fetchRecentHistory(admin, conv.id, 8);
  const schemaDesc = describeFieldSchema(spec, captured);
  const missingRequired = computeMissingRequired(spec, captured);
  const missingEncouraged = computeMissingEncouraged(spec, captured);

  const drivePrompt = `You are a helpful ops assistant for a timesheet management system. Your job right now: ${spec.description.toLowerCase()}.

TODAY IS ${todayIso()}. Use this for any relative dates ("monday", "next friday", "in 2 weeks").

FIELD SCHEMA (what you need to collect):
${schemaDesc}

ALREADY CAPTURED:
${Object.keys(captured).length === 0 ? '(nothing yet)' : JSON.stringify(captured, null, 2)}

STILL MISSING (required): ${missingRequired.length === 0 ? '(none — ready to confirm)' : missingRequired.join(', ')}
NICE-TO-HAVE (encouraged): ${missingEncouraged.length === 0 ? '(none)' : missingEncouraged.join(', ')}

RECENT CONVERSATION:
${history.length === 0 ? '(no prior turns)' : history.map((m) => `${m.direction === 'in' ? 'User' : 'Bot'}: ${m.content}`).join('\n')}
User (latest): """${msg.content}"""

YOUR TASK:
1. Extract any NEW field values the user just provided. Only fields from the schema. Do NOT invent, do NOT repeat values already captured, do NOT extract for ask_only_if_mentioned fields unless the user explicitly mentions them.
2. Write a natural reply. Guidelines:
   - If required fields are still missing, ask for them. Group naturally — don't ask one at a time unless it feels awkward otherwise.
   - Encouraged fields: mention them briefly ("optional: project, start date — say skip to move on") but don't nag if user ignores.
   - If required is captured but encouraged aren't, ask once about encouraged then move on.
   - If everything required is captured, write a brief acknowledgment (e.g. "Got it, let me summarize"). Server will show a confirmation summary.
   - If the user asked a clarifying question about the process, answer it briefly then re-ask.
   - If the user's message is off-topic or unclear, gently redirect.
   - Keep it conversational and concise. No bullet-point walls unless truly needed.
   - Do NOT mention field internals like "ask_only_if_mentioned" or "encouraged".

Return JSON:
{
  "extracted": { "<field-name>": <value>, ... },
  "reply": "<your next reply to the user>"
}`;

  const parsed = await callGroq(drivePrompt);
  const rawExtracted = (parsed?.extracted as Record<string, unknown> | null) ?? {};
  const llmReply = ((parsed?.reply as string) ?? '').trim();

  // Server-side validation: drop invented, enforce types, coerce.
  const validated = validateExtracted(spec, rawExtracted);
  const merged = normalizeCaptured(spec, { ...captured, ...validated });

  // For intents that address an existing user, resolve the target NOW so the
  // confirmation summary shows the actual user + current values (not just a
  // fuzzy string). If none/multi, we ask before advancing.
  if (needsTargetResolution(spec.name) && merged.target && !targetAlreadyResolved(merged)) {
    const targetStr = String(merged.target).trim();
    const resolved = await resolveUser(admin, targetStr);
    if (resolved.kind === 'none') {
      delete merged.target;
      await admin.from('chat_conversations').update({
        captured: merged, last_activity_at: new Date().toISOString(),
      }).eq('id', conv.id);
      await writeBot(admin, conv.id,
        `No user found matching "${targetStr}". Try a different name, or use the email address.`);
      return;
    }
    if (resolved.kind === 'multi') {
      delete merged.target;
      const list = resolved.candidates.map((c, i) => `  ${i + 1}. ${c.name} (${c.email})`).join('\n');
      await admin.from('chat_conversations').update({
        captured: merged, last_activity_at: new Date().toISOString(),
      }).eq('id', conv.id);
      await writeBot(admin, conv.id,
        `Multiple matches for "${targetStr}":\n${list}\n\nWhich one? (send the email or a more specific name)`);
      return;
    }
    // Single match — canonicalize target to the email + attach resolved info
    // for the confirmation summary. Executor re-resolves so identity is safe.
    const u = resolved.user;
    merged.target = u.email;
    (merged as Record<string, unknown>)._target_resolved = {
      id: u.id, name: u.name, email: u.email,
      start_date: u.start_date, end_date: u.end_date,
    };
  }

  const stillMissingRequired = computeMissingRequired(spec, merged);

  if (stillMissingRequired.length === 0) {
    // All required captured. Read intents skip confirmation and execute
    // immediately (safe, no side effects). Write intents go to confirmation.
    if (spec.read_only) {
      await admin.from('chat_conversations').update({
        captured: merged,
        missing_field: null,
        phase: 'executing',
        last_activity_at: new Date().toISOString(),
      }).eq('id', conv.id);
      await executeReadIntent(admin, { ...conv, captured: merged }, spec);
      return;
    }
    await admin.from('chat_conversations').update({
      captured: merged,
      missing_field: null,
      phase: 'awaiting_confirmation',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      last_activity_at: new Date().toISOString(),
    }).eq('id', conv.id);
    await writeBot(admin, conv.id, formatConfirmationSummary(spec, merged));
    return;
  }

  // Still collecting → write LLM's reply, or fall back to a deterministic ask.
  const finalReply = llmReply || fallbackAsk(stillMissingRequired);
  await admin.from('chat_conversations').update({
    captured: merged,
    missing_field: null,
    last_activity_at: new Date().toISOString(),
  }).eq('id', conv.id);
  await writeBot(admin, conv.id, finalReply);
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
    // Validate the LLM's edits, merge, re-derive, then re-check completeness.
    // If still complete → re-show confirmation summary with the corrections.
    // If corrections nulled a required field → back to collecting.
    const validated = validateExtracted(spec, parsed.edits as Record<string, unknown>);
    const captured = normalizeCaptured(spec, { ...conv.captured, ...validated });
    const stillMissing = computeMissingRequired(spec, captured);
    if (stillMissing.length === 0) {
      await admin.from('chat_conversations').update({
        captured,
        last_activity_at: new Date().toISOString(),
      }).eq('id', conv.id);
      await writeBot(admin, conv.id, formatConfirmationSummary(spec, captured));
      return;
    }
    await admin.from('chat_conversations').update({
      captured,
      phase: 'collecting',
      last_activity_at: new Date().toISOString(),
    }).eq('id', conv.id);
    await driveCollecting(admin, { ...conv, captured, phase: 'collecting' }, msg);
    return;
  }
  await writeBot(admin, conv.id,
    'I didn\'t catch that. Reply YES to proceed, NO to cancel, or send corrections (e.g. "role: manager").');
}

// ─── Executor (Slice 6 — real edge fn calls under Option A JWT-forwarded) ─────

async function executeIntent(
  admin: SupabaseClient,
  conv: Conversation,
  spec: IntentSpec,
  jwt: string,
): Promise<void> {
  // Executor rate limit: 30/hr baseline (300/hr admin) — protects against
  // runaway loops or misuse from a compromised session.
  const { data: profileRow } = await admin.from('profiles').select('role').eq('id', conv.user_id).single();
  const isAdmin = profileRow?.role === 'admin';
  const execCap = isAdmin ? 300 : 30;
  const { count: lastHour } = await admin
    .from('chat_actions')
    .select('id', { count: 'exact', head: true })
    .eq('actor_user_id', conv.user_id)
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if ((lastHour ?? 0) >= execCap) {
    await writeBot(admin, conv.id,
      `Executor cap reached (${execCap}/hour). Try again in a bit.`);
    await setPhase(admin, conv.id, 'cancelled');
    return;
  }

  const { data: actionRow } = await admin.from('chat_actions').insert({
    conversation_id: conv.id,
    actor_user_id: conv.user_id,
    action_type: spec.name,
    action_input: conv.captured,
    status: 'pending',
    attempted_at: new Date().toISOString(),
  }).select('id').single();
  const actionId = actionRow?.id as string;

  try {
    if (spec.name === 'user.create') {
      await execUserCreate(admin, conv, jwt, actionId);
    } else if (spec.name === 'user.set_start_date' || spec.name === 'user.set_end_date') {
      await execUserSetDate(admin, conv, actionId, spec.name === 'user.set_start_date' ? 'start_date' : 'end_date');
    } else {
      throw new Error(`Executor for ${spec.name} not wired yet`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from('chat_actions').update({
      status: 'failed', completed_at: new Date().toISOString(),
      action_output: { error: msg },
    }).eq('id', actionId);
    await writeBot(admin, conv.id, `❌ Failed: ${msg}`);
    await setPhase(admin, conv.id, 'error');
  }
}

async function execUserCreate(
  admin: SupabaseClient,
  conv: Conversation,
  jwt: string,
  actionId: string,
): Promise<void> {
  const captured = conv.captured;

  // Resolve project name → project_id (LLM extracted a name; we need the ID)
  let project_id: number | null = null;
  if (captured.project) {
    const tok = String(captured.project).trim().toLowerCase();
    const { data: projects } = await admin.from('projects').select('id, name, code');
    const match = (projects ?? []).find((p) =>
      String(p.name).toLowerCase() === tok || String(p.code).toLowerCase() === tok);
    if (!match) throw new Error(`Project "${captured.project}" not found`);
    project_id = match.id as number;
  }

  // Resolve vendor manager name → user id (if role starts with vendor and value present)
  let vendor_manager_id: string | null = null;
  if (captured.vendor_manager) {
    const tok = String(captured.vendor_manager).trim().toLowerCase();
    const { data: vms } = await admin.from('profiles').select('id, name').eq('role', 'vendormanager');
    const match = (vms ?? []).find((v) => String(v.name).toLowerCase() === tok);
    if (!match) throw new Error(`Vendor manager "${captured.vendor_manager}" not found`);
    vendor_manager_id = match.id as string;
  }

  // Region: derive default from country if not provided
  const region = (captured.region as string | undefined) ?? deriveRegion(captured.country as string | undefined);

  // Random password — user never sees it; invite email lets them set their own
  const password = generatePassword();

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const createRes = await fetchWithRetry(`${supabaseUrl}/functions/v1/create-user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,  // Option A: caller's JWT forwarded
      'Content-Type': 'application/json',
      'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    },
    body: JSON.stringify({
      email: captured.email,
      password,
      name: captured.name,
      role: captured.role || 'timesheetuser',
      country: captured.country || 'US',
      region: region || '',
      project_id,
      vendor_manager_id,
      // Match admin UI: null when unset. send-reminder skips users without a
      // start_date, so a null-until-set user won't get spurious reminders for
      // weeks before their real start. Admin or chat user.set_start_date can
      // fill it in later.
      start_date: captured.start_date || null,
      end_date: captured.end_date || null,
      invoice_enabled: captured.invoice_enabled === true,
      reminders_enabled: true,
      location_type: captured.location_type || '',
    }),
  });

  const createBody = await createRes.text();
  if (!createRes.ok) throw new Error(`create-user ${createRes.status}: ${safeSlice(createBody)}`);

  const createResult = JSON.parse(createBody);
  const createdUserId = createResult?.user?.id ?? createResult?.id ?? null;

  // Invite send — default YES unless explicitly false in captured
  const sendInvite = captured.send_invite !== false;
  let inviteStatus = 'skipped';
  let inviteError: string | null = null;
  if (sendInvite) {
    try {
      const inviteRes = await fetchWithRetry(`${supabaseUrl}/functions/v1/send-reminder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({ action: 'invite', toEmail: captured.email, toName: captured.name }),
      });
      if (!inviteRes.ok) {
        inviteError = `send-reminder ${inviteRes.status}: ${safeSlice(await inviteRes.text())}`;
        inviteStatus = 'failed';
      } else {
        inviteStatus = 'sent';
      }
    } catch (e) {
      inviteError = e instanceof Error ? e.message : String(e);
      inviteStatus = 'failed';
    }
  }

  const overallStatus = inviteError ? 'partial' : 'success';
  await admin.from('chat_actions').update({
    status: overallStatus,
    completed_at: new Date().toISOString(),
    action_output: {
      created_user_id: createdUserId,
      invite_status: inviteStatus,
      invite_error: inviteError,
    },
  }).eq('id', actionId);

  let reply = `✅ Created ${captured.name} (${captured.email}).`;
  if (sendInvite && inviteStatus === 'sent') reply += ' Invite sent.';
  if (sendInvite && inviteStatus === 'failed') {
    reply += `\n⚠️ Invite failed to send: ${inviteError}. Retry via app UI or ask again ("resend invite ${captured.email}") once that intent is wired.`;
  }
  if (!sendInvite) reply += ' No invite sent.';

  await writeBot(admin, conv.id, reply);
  await resetAfterSuccess(admin, conv.id);
}

// ─── Update-date executor (shared by set_start_date + set_end_date) ────────

async function execUserSetDate(
  admin: SupabaseClient,
  conv: Conversation,
  actionId: string,
  column: 'start_date' | 'end_date',
): Promise<void> {
  const target = String(conv.captured.target ?? '').trim();
  const newDate = String(conv.captured[column] ?? '').trim();
  if (!target || !newDate) throw new Error(`Missing target or ${column}`);

  const resolved = await resolveUser(admin, target);
  if (resolved.kind === 'none') throw new Error(`No user found matching "${target}"`);
  if (resolved.kind === 'multi') {
    // Ambiguous — bot asks which one. Cancel this execution (user re-issues with more specific target).
    const list = resolved.candidates.map((c, i) => `  ${i + 1}. ${c.name} (${c.email})`).join('\n');
    await admin.from('chat_actions').update({
      status: 'cancelled', completed_at: new Date().toISOString(),
      action_output: { reason: 'ambiguous_target', candidates: resolved.candidates },
    }).eq('id', actionId);
    await writeBot(admin, conv.id,
      `Multiple matches for "${target}":\n${list}\n\nRe-send with a more specific name or use the email address.`);
    await setPhase(admin, conv.id, 'cancelled');
    return;
  }

  const user = resolved.user;
  const { error } = await admin.from('profiles').update({ [column]: newDate }).eq('id', user.id);
  if (error) throw new Error(`Update failed: ${error.message}`);

  await admin.from('chat_actions').update({
    status: 'success', completed_at: new Date().toISOString(),
    action_output: { user_id: user.id, email: user.email, [column]: newDate },
  }).eq('id', actionId);

  const humanCol = column === 'start_date' ? 'Start date' : 'End date';
  await writeBot(admin, conv.id, `✅ ${humanCol} for ${user.name} (${user.email}) set to ${newDate}.`);
  await resetAfterSuccess(admin, conv.id);
}

// ─── Read executors ────────────────────────────────────────────────

// Read intents skip the awaiting_confirmation phase and execute directly
// from driveCollecting once all required fields are captured. No chat_actions
// row is written (reads have no side effects worth auditing yet).
async function executeReadIntent(
  admin: SupabaseClient,
  conv: Conversation,
  spec: IntentSpec,
): Promise<void> {
  try {
    if (spec.name === 'user.get') {
      await execUserGet(admin, conv);
    } else if (spec.name === 'user.list') {
      await execUserList(admin, conv);
    } else {
      throw new Error(`Read executor for ${spec.name} not wired`);
    }
    await resetAfterSuccess(admin, conv.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeBot(admin, conv.id, `❌ Read failed: ${msg}`);
    await setPhase(admin, conv.id, 'error');
  }
}

async function execUserGet(admin: SupabaseClient, conv: Conversation): Promise<void> {
  const target = String(conv.captured.target ?? '').trim();
  if (!target) throw new Error('missing target');

  // Fetch the full profile in one shot so we can show a rich card.
  const t = target.toLowerCase();
  const cols = 'id, name, email, role, country, region, project_id, start_date, end_date, invoice_enabled, reminders_enabled, location_type, vendor_manager_id';
  let user: Record<string, unknown> | null = null;
  let assumptionNote = '';

  if (t.includes('@')) {
    const { data } = await admin.from('profiles').select(cols).ilike('email', t).limit(1).maybeSingle();
    user = data as Record<string, unknown> | null;
  } else {
    const { data: exact } = await admin.from('profiles').select(cols).ilike('name', target).limit(10);
    if (exact && exact.length === 1) {
      user = exact[0] as Record<string, unknown>;
    } else if (exact && exact.length > 1) {
      // Multiple exact-name matches: pick the first (alphabetical by fetch order),
      // state the assumption, list the alternatives so user can correct.
      user = exact[0] as Record<string, unknown>;
      const others = (exact as Array<{ name: string; email: string; role: string }>).slice(1);
      assumptionNote = formatAssumption((user as { name: string; email: string; role: string }), others);
    } else {
      const { data: fuzzy } = await admin.from('profiles').select(cols).ilike('name', `%${target}%`).limit(10);
      if (!fuzzy || fuzzy.length === 0) {
        await writeBot(admin, conv.id, `No user found matching "${target}".`);
        return;
      }
      if (fuzzy.length === 1) {
        user = fuzzy[0] as Record<string, unknown>;
      } else {
        // Multi fuzzy match: pick the first + state assumption.
        user = fuzzy[0] as Record<string, unknown>;
        const others = (fuzzy as Array<{ name: string; email: string; role: string }>).slice(1);
        assumptionNote = formatAssumption((user as { name: string; email: string; role: string }), others);
      }
    }
  }
  if (!user) {
    await writeBot(admin, conv.id, `No user found matching "${target}".`);
    return;
  }

  // Resolve project name if project_id set
  let projectName = '(none)';
  if (user.project_id) {
    const { data: proj } = await admin.from('projects').select('name, code').eq('id', user.project_id).maybeSingle();
    if (proj) projectName = `${proj.name} (${proj.code})`;
  }

  const today = todayIso();
  const endDate = (user.end_date as string | null) ?? null;
  const status = !endDate ? 'ACTIVE (no end date)' : endDate > today ? `ACTIVE (ends ${endDate})` : `ENDED ${endDate}`;

  const lines = [
    ...(assumptionNote ? [assumptionNote, ''] : []),
    `${user.name} (${user.email})`,
    `  Status: ${status}`,
    `  Role: ${user.role}`,
    `  Country: ${user.country ?? '(none)'}${user.location_type ? ` (${user.location_type})` : ''}`,
    `  Project: ${projectName}`,
    `  Started: ${user.start_date ?? '(not set — no reminders)'}`,
    `  Invoicing: ${user.invoice_enabled ? 'YES' : 'NO'}`,
    `  Reminders: ${user.reminders_enabled === false ? 'DISABLED' : 'enabled'}`,
  ];
  await writeBot(admin, conv.id, lines.join('\n'));
}

// Formats a "here's my assumption" preamble when reads had to pick between
// multiple candidate matches. Lists the alternatives so the user can correct.
function formatAssumption(
  picked: { name: string; email: string; role?: string },
  others: Array<{ name: string; email: string; role?: string }>,
): string {
  if (others.length === 0) return '';
  const pickedRole = picked.role ? ` the ${picked.role}` : '';
  const alt = others.slice(0, 3).map((o) => `${o.name}${o.role ? ` (${o.role})` : ''} — ${o.email}`).join('; ');
  const more = others.length > 3 ? ` (+${others.length - 3} more)` : '';
  return `Assuming you meant ${picked.name}${pickedRole} (${picked.email}). Say the full email to switch to: ${alt}${more}.`;
}

async function execUserList(admin: SupabaseClient, conv: Conversation): Promise<void> {
  const c = conv.captured;
  const HARD_CAP = 50;
  const requestedLimit = Number(c.limit) || 20;
  const limit = Math.min(HARD_CAP, Math.max(1, requestedLimit));

  let q = admin.from('profiles').select('id, name, email, role, country, project_id, start_date, end_date, location_type');

  if (c.role) q = q.eq('role', String(c.role));
  if (c.country) q = q.eq('country', String(c.country).toUpperCase());
  if (c.location_type) q = q.eq('location_type', String(c.location_type));
  if (c.missing_start_date === true) q = q.is('start_date', null);
  if (c.active === true) {
    // active = no end_date OR end_date in future
    q = q.or(`end_date.is.null,end_date.gt.${todayIso()}`);
  }
  if (c.active === false) {
    // terminated = end_date in the past
    q = q.lte('end_date', todayIso());
  }

  // Project filter: resolve project name/code → id first
  if (c.project) {
    const tok = String(c.project).trim().toLowerCase();
    const { data: projects } = await admin.from('projects').select('id, name, code');
    const match = (projects ?? []).find((p) =>
      String(p.name).toLowerCase() === tok || String(p.code).toLowerCase() === tok);
    if (!match) {
      await writeBot(admin, conv.id, `Project "${c.project}" not found. Try one of the exact project names.`);
      return;
    }
    q = q.eq('project_id', match.id);
  }

  // Vendor-manager filter: scope resolution to role=vendormanager so we don't
  // ambiguously match same-name profiles with other roles. On multi within
  // vendormanagers, pick the first + state the assumption (read-safe; user can
  // correct in a follow-up message).
  let vmAssumption = '';
  if (c.vendor_manager) {
    const resolved = await resolveUser(admin, String(c.vendor_manager), 'vendormanager');
    if (resolved.kind === 'none') {
      await writeBot(admin, conv.id, `No vendor manager matching "${c.vendor_manager}".`);
      return;
    }
    let vm: ResolvedUser;
    if (resolved.kind === 'single') {
      vm = resolved.user;
    } else {
      vm = resolved.candidates[0];
      const others = resolved.candidates.slice(1).map((o) => ({ name: o.name, email: o.email, role: 'vendormanager' }));
      vmAssumption = formatAssumption({ name: vm.name, email: vm.email, role: 'vendormanager' }, others);
    }
    q = q.eq('vendor_manager_id', vm.id);
  }

  // Get one extra to detect "there are more" and cap fetched rows.
  q = q.order('name', { ascending: true }).limit(limit + 1);

  const { data, error } = await q;
  if (error) throw new Error(`Query failed: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; name: string; email: string; role: string; country: string; project_id: number | null; start_date: string | null; end_date: string | null }>;
  if (rows.length === 0) {
    await writeBot(admin, conv.id, `No users match those filters.`);
    return;
  }

  // Resolve project ids to names (single query for all)
  const projIds = Array.from(new Set(rows.map((r) => r.project_id).filter((x): x is number => x != null)));
  const projMap = new Map<number, string>();
  if (projIds.length > 0) {
    const { data: projs } = await admin.from('projects').select('id, name').in('id', projIds);
    for (const p of (projs ?? []) as Array<{ id: number; name: string }>) projMap.set(p.id, p.name);
  }

  const truncated = rows.length > limit;
  const shown = truncated ? rows.slice(0, limit) : rows;
  const filterParts: string[] = [];
  if (c.role) filterParts.push(String(c.role));
  if (c.project) filterParts.push(`project=${c.project}`);
  if (c.country) filterParts.push(`country=${String(c.country).toUpperCase()}`);
  if (c.location_type) filterParts.push(String(c.location_type));
  if (c.vendor_manager) filterParts.push(`reports to ${c.vendor_manager}`);
  if (c.active === true) filterParts.push('active');
  if (c.active === false) filterParts.push('terminated');
  if (c.missing_start_date === true) filterParts.push('missing start_date');
  const filterDesc = filterParts.length > 0 ? ` matching ${filterParts.join(', ')}` : '';

  const header = truncated
    ? `Found more than ${limit} users${filterDesc}. Showing first ${limit}:`
    : `Found ${shown.length} user${shown.length === 1 ? '' : 's'}${filterDesc}:`;

  const lines = shown.map((r, i) => {
    const project = r.project_id ? (projMap.get(r.project_id) ?? '') : '';
    const bits: string[] = [];
    if (project) bits.push(project);
    if (r.country) bits.push(r.country);
    if (r.start_date) bits.push(`started ${r.start_date}`);
    else bits.push('(no start_date)');
    if (r.end_date) bits.push(`ended ${r.end_date}`);
    return `  ${i + 1}. ${r.name} (${r.email})${bits.length > 0 ? ' — ' + bits.join(', ') : ''}`;
  });

  const preamble = vmAssumption ? [vmAssumption, ''] : [];
  await writeBot(admin, conv.id, [...preamble, header, ...lines].join('\n'));
}

// Fuzzy-resolve a target string to a profiles row. Accepts:
//   - exact email match (case-insensitive)
//   - exact name match (case-insensitive)
//   - substring match on name (unique or ambiguous)
// Returns start_date/end_date so callers can show current values before
// confirming a change.
type ResolvedUser = { id: string; name: string; email: string; start_date: string | null; end_date: string | null };
type Resolved =
  | { kind: 'none' }
  | { kind: 'single'; user: ResolvedUser }
  | { kind: 'multi'; candidates: ResolvedUser[] };

const RESOLVE_COLS = 'id, name, email, start_date, end_date';

async function resolveUser(admin: SupabaseClient, target: string, roleFilter?: string): Promise<Resolved> {
  const t = target.trim().toLowerCase();
  if (!t) return { kind: 'none' };

  const withRole = <T>(q: T): T => (roleFilter ? (q as unknown as { eq: (c: string, v: string) => T }).eq('role', roleFilter) : q);

  // Exact email match first (highest confidence)
  if (t.includes('@')) {
    const { data } = await withRole(admin.from('profiles').select(RESOLVE_COLS).ilike('email', t)).limit(1).maybeSingle();
    if (data) return { kind: 'single', user: data as ResolvedUser };
    return { kind: 'none' };
  }

  // Name-based: exact case-insensitive first
  const { data: exact } = await withRole(admin.from('profiles').select(RESOLVE_COLS).ilike('name', t));
  if (exact && exact.length === 1) return { kind: 'single', user: exact[0] as ResolvedUser };
  if (exact && exact.length > 1) return { kind: 'multi', candidates: exact as ResolvedUser[] };

  // Substring match
  const { data: fuzzy } = await withRole(admin.from('profiles').select(RESOLVE_COLS).ilike('name', `%${t}%`)).limit(10);
  if (!fuzzy || fuzzy.length === 0) return { kind: 'none' };
  if (fuzzy.length === 1) return { kind: 'single', user: fuzzy[0] as ResolvedUser };
  return { kind: 'multi', candidates: fuzzy as ResolvedUser[] };
}

// ─── Executor helpers ──────────────────────────────────────────────

function generatePassword(): string {
  // 16-char random from url-safe alphabet. User never sees it — invite email
  // links them to a password-recovery flow where they set their own.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join('');
}

function deriveRegion(country: string | undefined): string {
  if (!country) return '';
  const defaults: Record<string, string> = {
    US: 'California', GB: 'England', HR: 'Zagreb County', RS: 'Central Serbia',
    BA: 'Federation of Bosnia and Herzegovina', MK: 'Skopje', CA: 'Ontario', SI: 'Central Slovenia',
  };
  return defaults[country] ?? '';
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  // Auto-retry once on transient errors (5xx, network) per Slice 4 spec.
  try {
    const res = await fetch(url, init);
    if (res.status >= 500 && res.status < 600) {
      await new Promise((r) => setTimeout(r, 500));
      return await fetch(url, init);
    }
    return res;
  } catch (e) {
    await new Promise((r) => setTimeout(r, 500));
    return await fetch(url, init);
  }
}

function safeSlice(s: string): string {
  return s.slice(0, 300);
}

// Groq / LLMs have no notion of "today" — their reference date is
// baked into training. Inject today's date into every prompt that
// touches date parsing so relative expressions ("monday", "next
// friday") normalize correctly.
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Field schema + missing-field helpers ──────────────────────────

// Render the field schema for the LLM. Each line is: name, requiredness,
// input type / options / validation, plus an optional hint from the spec.
// Skipped fields (captured as null) are marked so the LLM knows not to re-ask.
function describeFieldSchema(spec: IntentSpec, captured: Record<string, unknown>): string {
  return spec.fields
    .filter((f) => !f.applies_if || f.applies_if(captured))
    .map((f) => {
      const req = f.required ? '(required)' : f.encouraged ? '(encouraged)' : f.ask_only_if_mentioned ? '(only if user mentions)' : '(optional)';
      const opts = f.options ? ` [options: ${f.options.join(', ')}]` : '';
      const dyn = f.options_from === 'projects' ? ' [any active project name]' : f.options_from === 'vendor_managers' ? ' [any vendor manager name]' : '';
      const validate = f.validate === 'email' ? ' [email]' : f.validate === 'date' ? ' [date YYYY-MM-DD]' : '';
      const dflt = f.default !== undefined ? ` [default: ${JSON.stringify(f.default)}]` : '';
      const hint = f.hint ? ` — ${f.hint}` : '';
      const state = captured[f.name] === null ? ' [SKIPPED]' : captured[f.name] !== undefined ? ' [CAPTURED]' : '';
      return `- ${f.name} ${req}${opts}${dyn}${validate}${dflt}${state}${hint}`;
    })
    .join('\n');
}

function computeMissingRequired(spec: IntentSpec, captured: Record<string, unknown>): string[] {
  return spec.fields
    .filter((f) => f.required && (!f.applies_if || f.applies_if(captured)))
    .filter((f) => {
      const v = captured[f.name];
      return v === undefined || v === null || v === '';
    })
    .map((f) => f.name);
}

function computeMissingEncouraged(spec: IntentSpec, captured: Record<string, unknown>): string[] {
  return spec.fields
    .filter((f) => f.encouraged && (!f.applies_if || f.applies_if(captured)))
    .filter((f) => captured[f.name] === undefined)  // null = explicitly skipped
    .map((f) => f.name);
}

// Server-side validation of LLM-extracted values. Drops invented fields,
// enforces email/date format, filters options (except buttons+text like
// country which accepts free text for non-listed values).
function validateExtracted(spec: IntentSpec, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    const field = spec.fields.find((f) => f.name === k);
    if (!field) continue;  // drop invented
    if (typeof v === 'string' && v.trim() === '') continue;

    if (field.validate === 'email' && !isValidEmail(String(v))) continue;
    if (field.validate === 'date' && !isValidDate(String(v))) continue;

    // For strict-options fields (buttons only), require match. For buttons+text,
    // allow free-text values that aren't in the options list (e.g. country=GB).
    if (field.options && field.input_type === 'buttons' && !field.options.includes(String(v))) continue;

    out[k] = v;
  }
  return out;
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

// Deterministic fallback when the LLM's reply is empty/unparseable.
function fallbackAsk(missing: string[]): string {
  if (missing.length === 1) return `Still need: ${missing[0]}. Can you provide?`;
  return `Still need: ${missing.join(', ')}. Can you provide?`;
}

// Fetch the last N messages in the conversation (excluding the current inbound
// message, which is passed separately to the LLM prompt). Returned in
// chronological order (oldest → newest).
async function fetchRecentHistory(
  admin: SupabaseClient,
  convId: string,
  limit: number,
): Promise<Array<{ direction: string; content: string }>> {
  const { data } = await admin
    .from('chat_messages')
    .select('direction, content, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (!data || data.length === 0) return [];
  // Drop the newest (latest inbound msg — passed separately), reverse to chrono.
  const trimmed = data.slice(1).reverse();
  return trimmed as Array<{ direction: string; content: string }>;
}

function formatConfirmationSummary(spec: IntentSpec, captured: Record<string, unknown>): string {
  // Fill defaults for ask_only_if_mentioned fields so the summary shows them.
  const enriched: Record<string, unknown> = { ...captured };
  for (const field of spec.fields) {
    if (enriched[field.name] === undefined && field.default !== undefined) {
      enriched[field.name] = field.default;
    }
  }
  const resolved = enriched._target_resolved as
    | { name: string; email: string; start_date: string | null; end_date: string | null }
    | undefined;

  const lines = spec.fields
    .filter((f) => f.applies_if ? f.applies_if(enriched) : true)
    .map((f) => {
      const v = enriched[f.name];
      let displayValue: string;

      // For set_start_date / set_end_date, show the resolved user + the
      // current value → new value so the confirmer sees exactly what changes.
      if (resolved && f.name === 'target') {
        return `  User: ${resolved.name} (${resolved.email})`;
      }
      if (resolved && f.name === 'start_date' && spec.name === 'user.set_start_date') {
        const cur = resolved.start_date ?? '(not set)';
        return `  Start Date: ${cur} → ${String(v)}`;
      }
      if (resolved && f.name === 'end_date' && spec.name === 'user.set_end_date') {
        const cur = resolved.end_date ?? '(not set)';
        return `  End Date: ${cur} → ${String(v)}`;
      }

      if (v === null || v === undefined) {
        // Special case: start_date null gates the user out of reminders
        // (send-reminder skips users without a start_date). Flag it so the
        // confirmer sees the downstream consequence before hitting YES.
        if (spec.name === 'user.create' && f.name === 'start_date') {
          displayValue = '(not set — no reminders will fire until set)';
        } else {
          displayValue = '(not set)';
        }
      } else if (typeof v === 'boolean') {
        displayValue = v ? 'YES' : 'NO';
      } else {
        displayValue = String(v);
      }
      const humanLabel = f.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `  ${humanLabel}: ${displayValue}`;
    })
    .join('\n');
  return `Confirm — I'll ${spec.description.toLowerCase()} with these details:\n\n${lines}\n\nReply YES to proceed, NO to cancel, or send corrections.`;
}

function needsTargetResolution(intentName: string): boolean {
  return intentName === 'user.set_start_date' || intentName === 'user.set_end_date';
}

function targetAlreadyResolved(captured: Record<string, unknown>): boolean {
  const r = captured._target_resolved as { email?: string } | undefined;
  return Boolean(r && r.email && r.email === captured.target);
}

function normalizeCaptured(spec: IntentSpec, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined || v === '') continue;
    if (spec.fields.find((f) => f.name === k)) {
      out[k] = v;
    }
  }
  // Preserve internal (underscore-prefixed) fields like _target_resolved so
  // they survive normalize cycles.
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) out[k] = v;
  }
  if (spec.name === 'user.create') {
    // 'onshore' unambiguously implies US — infer country when user said onshore
    // without naming one. 'offshore' does NOT imply a specific country; still ask.
    if (out.location_type === 'onshore' && !out.country) {
      out.country = 'US';
    }
    // Country is authoritative for location_type (US=onshore, else=offshore).
    // Always re-derive — if user said "onshore croatia", we trust the country
    // and set location_type=offshore. User can override in confirmation.
    if (out.country) {
      out.location_type = out.country === 'US' ? 'onshore' : 'offshore';
    }
  }
  return out;
}

// ─── LLM + helpers ──────────────────────────────────────────────────

async function callGroq(prompt: string): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  // Two-attempt call. First attempt uses json_object mode; if Groq rejects
  // with json_validate_failed (some gpt-oss outputs wrap in code fences the
  // validator refuses), retry without json_object and clean the response
  // ourselves.
  const baseBody = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: 'You extract structured data and write natural replies. Reply ONLY with a single valid JSON object — no prose, no code fences, no thinking tags. Keep the "reply" field concise (1-3 sentences).' },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    max_tokens: 1500,
  };

  let res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...baseBody, response_format: { type: 'json_object' } }),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 400 && errText.includes('json_validate_failed')) {
      // Retry without response_format and clean the output manually.
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody),
      });
      if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } else {
      throw new Error(`Groq ${res.status}: ${errText.slice(0, 300)}`);
    }
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;
  return parseLLMJson(raw);
}

// Robust JSON extraction from an LLM response. Strips thinking-mode tags,
// markdown code fences, and any prose before/after the JSON object.
function parseLLMJson(raw: string): Record<string, unknown> | null {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // If there's still surrounding prose, grab the first {...} block
  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    s = s.slice(start, end + 1);
  }
  try {
    return JSON.parse(s);
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

// Called after a successful executor run. Resets the conversation to 'idle'
// with cleared intent/captured so the SAME conversation can absorb the next
// message with full history context (assumption corrections, follow-up reads,
// etc.). chat_actions row is the audit source of truth; conversation state
// doesn't need to preserve the completed intent. 'cancelled' and 'error'
// phases stay terminal — user cancelled explicitly, or execution failed.
async function resetAfterSuccess(admin: SupabaseClient, conversationId: string): Promise<void> {
  await admin.from('chat_conversations').update({
    phase: 'idle',
    intent: null,
    captured: {},
    missing_field: null,
    last_activity_at: new Date().toISOString(),
  }).eq('id', conversationId);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
