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
import { callClaude } from '../_shared/llm.ts';
import { currentBillRate, currentPayRate } from '../_shared/rates.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
- user.update_country_region: user is **changing an existing user's country** (verbs: "update country", "change country", "move to <country>", "<name> is now in <country>", "<name>'s country is <country>").
- user.get: user is **asking about ONE specific person** ("when does X start?", "what is X's project?", "is X still active?", "show X's details", "what is X's pay rate?", "X's payrate", "X's bill rate", "X's billrate", "how much does X make/bill", "X's hourly rate"). Rates + dates + project all live on this single profile card.
- user.list: user is **asking for MULTIPLE users matching a filter** — signals include: "who is on <project>?", "list <role>", "show users with <property>", "which <role> ended...?", "who reports to <name>?", "contractors for <name>", "team for <manager name>", "everyone in <country>". When you see "reports to <X>" or "contractors for <X>", extract that person as vendor_manager.
- user.count: user is **asking for an aggregate NUMBER, not a list of names** — signals: "how many <role>?", "count of <X>", "total number of <Y>", "just the counts", "just counts not names", "how many onshore + offshore". Uses the same filter fields as user.list. If a prior turn returned a long list and the user follows up with "just count" or "how many", classify as user.count.
- Delete / archive / reassign are NOT supported yet — return intent=null with a suggested_reply.
- If unclear, err on the side of intent=null. Do NOT force a match.

If the user's intent matches one of the available intents, return JSON:
{"intent": "<intent-name>", "fields": { ...extracted-field-values }}

If unclear or unmatched:
{"intent": null, "suggested_reply": "Short reply describing what you CAN do — create users, set/update start or end dates, look up a single user's details, or list users matching filters."}

Extract initial field values from the message for the classified intent:
- user.create: name, email, role, location_type, country, client, project, start_date, end_date, vendor_manager, role_title, pay_rate, bill_rate, payment_terms, invoice_enabled, send_invite
- user.set_start_date / user.set_end_date: target (name or email), start_date / end_date
- user.update_country_region: target (name or email), country (ISO code preferred, else full name), optional region
- user.get: target (name or email)
- user.list: role, project, country, location_type, vendor_manager (name/email), active (yes/no), missing_start_date (yes/no), role_title (job title like "Data Engineer", "QA", "Developer"), bill_rate_min, bill_rate_max, limit (number)
- user.count: same fields as user.list except no limit

For role_title: extract when the user says a JOB title (not an auth role) — "data engineers", "QA testers", "developers", "senior developers", "solutions architects", "PMs", "designers". Do NOT confuse with `role` (auth role — timesheetuser / manager / accountant / vendormanager / admin). Rule: if it names an occupation or seniority, it's role_title. If it names a permission role in the app, it's role.

For user.create when CA pastes an intake email (multi-line "Name: X / Position: Y / Client: Z / Pay rate: $A / Bill rate: $B / Payment terms: C"): capture EVERY field. role_title, pay_rate, bill_rate, payment_terms, client are all common. Do NOT ask for name/email separately if CA gave them in the paste.

Do NOT invent values. Only extract what's explicitly stated.
For role: timesheetuser, manager, accountant, vendormanager, admin, contract_admin. Synonyms: "contractors"/"consultants"/"people"=timesheetuser; "VMs"/"vendor managers"=vendormanager; "accountants"=accountant.
For location_type: onshore, offshore.
For dates: normalize to YYYY-MM-DD relative to TODAY as noted above.

User's message: """${msg.content}"""`;

  const parsed = await callClaude(parsePrompt);
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

  const parsed = await callClaude(drivePrompt);
  const rawExtracted = (parsed?.extracted as Record<string, unknown> | null) ?? {};
  const llmReply = ((parsed?.reply as string) ?? '').trim();

  // Server-side validation: drop invented, enforce types, coerce.
  const validated = validateExtracted(spec, rawExtracted);
  const merged = normalizeCaptured(spec, { ...captured, ...validated });

  // For user.create: resolve the project (from either `project` or `client` input)
  // before completing collection. When it matches multiple, ask CA to pick.
  if (spec.name === 'user.create') {
    const projectInput = (typeof merged.project === 'string' && merged.project.trim())
      || (typeof merged.client === 'string' && merged.client.trim())
      || null;
    const alreadyResolved = (merged as Record<string, unknown>)._project_resolved !== undefined;
    if (projectInput && !alreadyResolved) {
      const { data: allProjects } = await admin.from('projects').select('id, name, code');
      const projects = (allProjects ?? []) as Array<{ id: number; name: string; code: string }>;
      const tok = projectInput.toLowerCase();
      const matches = projects.filter((p) =>
        p.name.toLowerCase().includes(tok) || p.code.toLowerCase().includes(tok));
      if (matches.length === 0) {
        delete merged.project;
        delete merged.client;
        await admin.from('chat_conversations').update({
          captured: merged, last_activity_at: new Date().toISOString(),
        }).eq('id', conv.id);
        const available = projects.map((p) => p.name).join(', ');
        await writeBot(admin, conv.id,
          `No project matches "${projectInput}". Available: ${available}. Which one?`);
        return;
      }
      if (matches.length > 1) {
        delete merged.project;
        delete merged.client;
        await admin.from('chat_conversations').update({
          captured: merged, last_activity_at: new Date().toISOString(),
        }).eq('id', conv.id);
        const list = matches.map((p, i) => `  ${i + 1}. ${p.name} (${p.code})`).join('\n');
        await writeBot(admin, conv.id,
          `"${projectInput}" matches multiple projects:\n${list}\n\nWhich one? Note: different project codes land on separate invoices.`);
        return;
      }
      // Single match — pin project name to the resolved canonical and cache metadata.
      const one = matches[0];
      merged.project = one.name;
      (merged as Record<string, unknown>)._project_resolved = {
        id: one.id, name: one.name, code: one.code,
      };
      delete merged.client;  // consumed
    }
  }

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

  const parsed = await callClaude(confirmPrompt);
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
    } else if (spec.name === 'user.update_country_region') {
      await execUserUpdateCountry(admin, conv, actionId);
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

  // Resolve project: prefer the pre-resolved metadata attached during
  // driveCollecting (Slice 1b disambiguation). Fall back to name/code match
  // for any legacy flows that didn't run through resolution.
  const preResolved = (captured as Record<string, unknown>)._project_resolved as
    | { id: number; name: string; code: string } | undefined;
  let project_id: number | null = preResolved?.id ?? null;
  let projectName: string | null = preResolved?.name ?? null;
  if (project_id === null && captured.project) {
    const tok = String(captured.project).trim().toLowerCase();
    const { data: projects } = await admin.from('projects').select('id, name, code');
    const match = (projects ?? []).find((p) =>
      String(p.name).toLowerCase() === tok || String(p.code).toLowerCase() === tok);
    if (!match) throw new Error(`Project "${captured.project}" not found`);
    project_id = match.id as number;
    projectName = match.name as string;
  }

  // Derive client_id from project name via prefix match against clients.name.
  // "APFM" project → APFM client; "A&E Networks" project → A&E TV client via
  // first-token match. Used to populate client_engagements.client_id later.
  let client_id: number | null = null;
  if (projectName) {
    const { data: clients } = await admin.from('clients').select('id, name');
    const projLower = projectName.toLowerCase();
    const found = (clients ?? []).find((c: { name: string }) => {
      const cn = String(c.name).toLowerCase();
      if (projLower.startsWith(cn)) return true;
      const firstTok = cn.split(/[\s\/&]+/)[0];
      if (firstTok && firstTok.length >= 3 && projLower.startsWith(firstTok)) return true;
      return false;
    });
    client_id = (found as { id: number } | undefined)?.id ?? null;
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

  // Slice 1: extended writes. Payment terms → profiles. role_title/bill_rate → client_engagements.
  // pay_rate + bill_rate → rate_history. Non-fatal on failure — the user is created;
  // we surface warnings so CA can fix in admin UI. Full failure would strand the auth user.
  const warnings: string[] = [];
  const payTermsInput = typeof captured.payment_terms === 'string' ? captured.payment_terms.trim() : null;
  if (payTermsInput && createdUserId) {
    const { error } = await admin.from('profiles').update({ payment_terms: payTermsInput }).eq('id', createdUserId);
    if (error) warnings.push(`payment_terms: ${error.message}`);
  }

  const roleTitle = typeof captured.role_title === 'string' ? captured.role_title.trim() : null;
  const billRate = coerceRate(captured.bill_rate);
  const payRate = coerceRate(captured.pay_rate);
  const effectiveFrom = (captured.start_date as string | undefined) || todayIso();

  let engagementId: number | null = null;
  if (createdUserId && (roleTitle || billRate !== null || client_id !== null)) {
    if (client_id === null) {
      warnings.push(`client_engagements skipped: could not derive client_id from project "${projectName ?? '(none)'}"`);
    } else {
      const { data: eng, error } = await admin.from('client_engagements').insert({
        user_id: createdUserId,
        client_id,
        role_title: roleTitle,
        bill_rate: billRate,
        sow_reference: null,
        effective_from: effectiveFrom,
        effective_to: null,
      }).select('id').single();
      if (error) warnings.push(`client_engagements: ${error.message}`);
      else engagementId = (eng?.id as number) ?? null;
    }
  }

  if (createdUserId && payRate !== null) {
    const { error } = await admin.from('rate_history').insert({
      user_id: createdUserId,
      rate_kind: 'pay',
      rate: payRate,
      effective_from: effectiveFrom,
      effective_to: null,
      source: 'chat:user.create',
      created_by: conv.user_id,
    });
    if (error) warnings.push(`pay rate_history: ${error.message}`);
  }
  if (createdUserId && billRate !== null) {
    const { error } = await admin.from('rate_history').insert({
      user_id: createdUserId,
      rate_kind: 'bill',
      rate: billRate,
      effective_from: effectiveFrom,
      effective_to: null,
      client_engagement_id: engagementId,
      source: 'chat:user.create',
      created_by: conv.user_id,
    });
    if (error) warnings.push(`bill rate_history: ${error.message}`);
  }

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

  const overallStatus = (inviteError || warnings.length > 0) ? 'partial' : 'success';
  await admin.from('chat_actions').update({
    status: overallStatus,
    completed_at: new Date().toISOString(),
    action_output: {
      created_user_id: createdUserId,
      invite_status: inviteStatus,
      invite_error: inviteError,
      extended_writes_warnings: warnings.length > 0 ? warnings : undefined,
      wrote_client_engagement: engagementId,
      wrote_pay_rate: payRate,
      wrote_bill_rate: billRate,
      wrote_payment_terms: payTermsInput,
    },
  }).eq('id', actionId);

  let reply = `✅ Created ${captured.name} (${captured.email}).`;
  if (sendInvite && inviteStatus === 'sent') reply += ' Invite sent.';
  if (sendInvite && inviteStatus === 'failed') {
    reply += `\n⚠️ Invite failed to send: ${inviteError}. Retry via app UI or ask again ("resend invite ${captured.email}") once that intent is wired.`;
  }
  if (!sendInvite) reply += ' No invite sent.';
  if (warnings.length > 0) {
    reply += `\n⚠️ Extended fields had issues (user still created):\n${warnings.map((w) => `  • ${w}`).join('\n')}`;
  }

  await writeBot(admin, conv.id, reply);
  await resetAfterSuccess(admin, conv.id);
}

// coerceRate — accepts number, "23", "$23", "23.5" → number; anything else → null.
function coerceRate(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s]/g, '').replace(/\/hr$/i, '');
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
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

// ─── Country update executor ───────────────────────────────────────

async function execUserUpdateCountry(
  admin: SupabaseClient,
  conv: Conversation,
  actionId: string,
): Promise<void> {
  const target = String(conv.captured.target ?? '').trim();
  const countryRaw = String(conv.captured.country ?? '').trim();
  const regionInput = conv.captured.region ? String(conv.captured.region).trim() : '';
  if (!target || !countryRaw) throw new Error('Missing target or country');

  const country = normalizeCountry(countryRaw);
  if (!country) throw new Error(`Country "${countryRaw}" not recognized. Use an ISO 2-letter code or a known country name.`);

  const resolved = await resolveUser(admin, target);
  if (resolved.kind === 'none') throw new Error(`No user found matching "${target}"`);
  if (resolved.kind === 'multi') {
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
  const region = regionInput || deriveRegion(country);
  // location_type flows from country per [[country-location-type-derivation]].
  const location_type: 'onshore' | 'offshore' = country === 'US' ? 'onshore' : 'offshore';

  const { error } = await admin.from('profiles').update({
    country,
    region,
    location_type,
  }).eq('id', user.id);
  if (error) throw new Error(`Update failed: ${error.message}`);

  await admin.from('chat_actions').update({
    status: 'success', completed_at: new Date().toISOString(),
    action_output: { user_id: user.id, email: user.email, country, region, location_type },
  }).eq('id', actionId);

  await writeBot(admin, conv.id,
    `✅ ${user.name} (${user.email}) — country set to ${country}${region ? `, region ${region}` : ''} (${location_type}).`);
  await resetAfterSuccess(admin, conv.id);
}

// Normalize a country string to a 2-letter ISO code. Accepts already-ISO
// input and a small set of common full names covering our current profile
// countries. Returns null when the input is unrecognized (caller surfaces
// an error asking the user to be more specific).
function normalizeCountry(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const map: Record<string, string> = {
    'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US', 'america': 'US',
    'united kingdom': 'GB', 'great britain': 'GB', 'britain': 'GB', 'england': 'GB', 'u.k.': 'GB',
    'canada': 'CA',
    'croatia': 'HR', 'hrvatska': 'HR',
    'bosnia': 'BA', 'bosnia and herzegovina': 'BA', 'bosnia-herzegovina': 'BA', 'herzegovina': 'BA',
    'serbia': 'RS', 'srbija': 'RS',
    'macedonia': 'MK', 'north macedonia': 'MK', 'republic of macedonia': 'MK',
    'slovenia': 'SI', 'slovenija': 'SI',
    'india': 'IN', 'bharat': 'IN',
    'armenia': 'AM',
    'ukraine': 'UA',
  };
  return map[s.toLowerCase()] ?? null;
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
    } else if (spec.name === 'user.count') {
      await execUserCount(admin, conv);
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
  const cols = 'id, name, email, role, country, region, project_id, start_date, end_date, invoice_enabled, reminders_enabled, location_type, manager_id, vendor_manager_id';
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

  // Rate + reporting-line lookups fired in parallel to keep the card snappy.
  // Rates come from rate_history (single source of truth). client_engagement is
  // still consulted for role_title annotation. Invoice is consulted for
  // pay-rate provenance when the current rate came from the backfill.
  const managerId = (user.manager_id as string | null) ?? null;
  const vmId = (user.vendor_manager_id as string | null) ?? null;
  const [payRow, billRow, { data: eng }, { data: mgr }, { data: vm }] = await Promise.all([
    currentPayRate(admin, user.id as string),
    currentBillRate(admin, user.id as string),
    admin.from('client_engagements')
      .select('bill_rate, role_title, effective_from, effective_to')
      .eq('user_id', user.id)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false })
      .limit(1),
    managerId
      ? admin.from('profiles').select('name, email').eq('id', managerId).maybeSingle()
      : Promise.resolve({ data: null }),
    vmId
      ? admin.from('profiles').select('name, email').eq('id', vmId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const payRate = payRow?.rate ?? null;
  let payRateNote = '';
  if (payRow) {
    if (payRow.source.startsWith('backfill:invoices')) {
      const { data: lastInv } = await admin.from('invoices')
        .select('period_start, invoice_number')
        .eq('user_id', user.id)
        .not('rate', 'is', null)
        .order('period_start', { ascending: false })
        .limit(1);
      if (lastInv?.[0]) {
        payRateNote = ` (last invoice ${lastInv[0].invoice_number}, ${(lastInv[0].period_start as string).slice(0, 7)})`;
      }
    } else {
      payRateNote = ` (as of ${payRow.effective_from})`;
    }
  }
  const billRate = billRow?.rate ?? null;
  const billRateNote = eng?.[0]?.role_title ? ` (${eng[0].role_title})` : '';
  const managerName = mgr ? `${(mgr as { name: string }).name} (${(mgr as { email: string }).email})` : null;
  const vmName = vm ? `${(vm as { name: string }).name} (${(vm as { email: string }).email})` : null;

  const focus = String(conv.captured.focus ?? 'full');
  const displayName = `${user.name} (${user.email})`;
  const roleTitle = eng?.[0]?.role_title as string | null | undefined;

  // Scoped projections — surface only what CA asked about. Fallback to full
  // card when focus is unknown / open-ended.
  if (focus === 'title') {
    const line = roleTitle
      ? `${displayName} — ${roleTitle}`
      : `${displayName} — (no job title on file)`;
    await writeBot(admin, conv.id, [...(assumptionNote ? [assumptionNote, ''] : []), line].join('\n'));
    return;
  }
  if (focus === 'rate') {
    const bits: string[] = [];
    if (payRate != null) bits.push(`Pay $${payRate}/hr${payRateNote}`);
    else bits.push('Pay (not on file)');
    if (billRate != null) bits.push(`Bill $${billRate}/hr${roleTitle ? ` (${roleTitle})` : ''}`);
    else bits.push('Bill (not on file)');
    const line = `${displayName} — ${bits.join(', ')}`;
    await writeBot(admin, conv.id, [...(assumptionNote ? [assumptionNote, ''] : []), line].join('\n'));
    return;
  }
  if (focus === 'dates') {
    const bits: string[] = [];
    bits.push(user.start_date ? `started ${user.start_date}` : 'no start date');
    if (endDate) bits.push(endDate > today ? `ends ${endDate}` : `ended ${endDate}`);
    else bits.push('active');
    const line = `${displayName} — ${bits.join(', ')}`;
    await writeBot(admin, conv.id, [...(assumptionNote ? [assumptionNote, ''] : []), line].join('\n'));
    return;
  }
  if (focus === 'manager') {
    const parts: string[] = [];
    if (managerName) parts.push(`manager ${managerName}`);
    if (vmName) parts.push(`reports to ${vmName}`);
    if (parts.length === 0) parts.push('(no manager or vendor manager on file)');
    const line = `${displayName} — ${parts.join(', ')}`;
    await writeBot(admin, conv.id, [...(assumptionNote ? [assumptionNote, ''] : []), line].join('\n'));
    return;
  }
  if (focus === 'location') {
    const line = `${displayName} — ${user.country ?? '(no country)'}${user.location_type ? ` (${user.location_type})` : ''}${user.region ? `, ${user.region}` : ''}`;
    await writeBot(admin, conv.id, [...(assumptionNote ? [assumptionNote, ''] : []), line].join('\n'));
    return;
  }
  if (focus === 'project') {
    const line = `${displayName} — ${projectName}`;
    await writeBot(admin, conv.id, [...(assumptionNote ? [assumptionNote, ''] : []), line].join('\n'));
    return;
  }

  // focus === 'full' or anything else → default card
  const lines = [
    ...(assumptionNote ? [assumptionNote, ''] : []),
    displayName,
    `  Status: ${status}`,
    `  Role: ${user.role}`,
    `  Country: ${user.country ?? '(none)'}${user.location_type ? ` (${user.location_type})` : ''}`,
    `  Project: ${projectName}`,
    `  Started: ${user.start_date ?? '(not set — no reminders)'}`,
    `  Pay rate: ${payRate != null ? `$${payRate}/hr${payRateNote}` : '(not on file — no invoices yet)'}`,
    `  Bill rate: ${billRate != null ? `$${billRate}/hr${eng?.[0]?.role_title ? ` (${eng[0].role_title})` : ''}` : '(not on file — no client engagement)'}`,
    ...(managerName ? [`  Manager: ${managerName}`] : []),
    ...(vmName ? [`  Vendor manager: ${vmName}`] : []),
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

  // Client-engagement-scoped filters (role_title, bill_rate_min/max) — pre-query
  // matching user_ids then apply .in on profiles.
  const engFilterUserIds = await resolveEngagementFilterUserIds(admin, c);
  if (engFilterUserIds !== null) {
    if (engFilterUserIds.length === 0) {
      await writeBot(admin, conv.id, 'No users match those filters.');
      return;
    }
    q = q.in('id', engFilterUserIds);
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
  // vendormanagers, pick the first + state the assumption (read-safe; user
  // can correct in a follow-up). On no-match-as-VM but match-as-user, offer
  // a fallback suggestion so the user isn't dead-ended.
  let vmAssumption = '';
  let resolvedVm: ResolvedUser | null = null;
  if (c.vendor_manager) {
    const resolved = await resolveUser(admin, String(c.vendor_manager), 'vendormanager');
    if (resolved.kind === 'none') {
      // Check if the name matches ANY user — if yes, suggest the profile
      // lookup as an alternative (common correction path).
      const anyMatch = await resolveUser(admin, String(c.vendor_manager));
      if (anyMatch.kind === 'single') {
        await writeBot(admin, conv.id,
          `No vendor manager matching "${c.vendor_manager}". But ${anyMatch.user.name} (${anyMatch.user.email}) is a ${anyMatch.user.role || 'user'} — try "show ${anyMatch.user.name}" for their profile.`);
      } else if (anyMatch.kind === 'multi') {
        const list = anyMatch.candidates.slice(0, 5).map((u) => `${u.name} (${u.email})`).join(', ');
        await writeBot(admin, conv.id,
          `No vendor manager matching "${c.vendor_manager}". Found other users with that name — try "show <full name or email>" for a profile: ${list}.`);
      } else {
        await writeBot(admin, conv.id, `No user found matching "${c.vendor_manager}".`);
      }
      return;
    }
    if (resolved.kind === 'single') {
      resolvedVm = resolved.user;
    } else {
      resolvedVm = resolved.candidates[0];
      const others = resolved.candidates.slice(1).map((o) => ({ name: o.name, email: o.email, role: 'vendormanager' }));
      vmAssumption = formatAssumption({ name: resolvedVm.name, email: resolvedVm.email, role: 'vendormanager' }, others);
    }
    q = q.eq('vendor_manager_id', resolvedVm.id);
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

  // Slice 8: enrich rendered rows with role_title + bill_rate when the filter
  // was scoped to those attributes. Skipped otherwise so the default list
  // format stays unchanged.
  const showRoleTitle = Boolean(c.role_title);
  const showBillRate = c.bill_rate_min != null && c.bill_rate_min !== ''
    || c.bill_rate_max != null && c.bill_rate_max !== '';
  const engMap = new Map<string, { role_title: string | null; bill_rate: number | null }>();
  if ((showRoleTitle || showBillRate) && shown.length > 0) {
    const { data: engs } = await admin.from('client_engagements')
      .select('user_id, role_title, bill_rate, effective_from')
      .in('user_id', shown.map((r) => r.id))
      .is('effective_to', null)
      .order('effective_from', { ascending: false });
    for (const e of (engs ?? []) as Array<{ user_id: string; role_title: string | null; bill_rate: number | null }>) {
      if (!engMap.has(e.user_id)) engMap.set(e.user_id, { role_title: e.role_title, bill_rate: e.bill_rate });
    }
  }
  const filterParts: string[] = [];
  if (c.role) filterParts.push(String(c.role));
  if (c.project) filterParts.push(`project=${c.project}`);
  if (c.country) filterParts.push(`country=${String(c.country).toUpperCase()}`);
  if (c.location_type) filterParts.push(String(c.location_type));
  if (c.vendor_manager) {
    // Prefer the resolved VM's canonical identity so it's clear WHICH one
    // the bot picked (e.g. multiple Aleksandars).
    const label = resolvedVm ? `${resolvedVm.name} (${resolvedVm.email})` : String(c.vendor_manager);
    filterParts.push(`reports to ${label}`);
  }
  if (c.active === true) filterParts.push('active');
  if (c.active === false) filterParts.push('terminated');
  if (c.missing_start_date === true) filterParts.push('missing start_date');
  if (c.role_title) filterParts.push(`title~${c.role_title}`);
  if (c.bill_rate_min != null && c.bill_rate_min !== '') filterParts.push(`bill≥$${c.bill_rate_min}`);
  if (c.bill_rate_max != null && c.bill_rate_max !== '') filterParts.push(`bill≤$${c.bill_rate_max}`);
  const filterDesc = filterParts.length > 0 ? ` matching ${filterParts.join(', ')}` : '';

  const header = truncated
    ? `Found more than ${limit} users${filterDesc}. Showing first ${limit}:`
    : `Found ${shown.length} user${shown.length === 1 ? '' : 's'}${filterDesc}:`;

  const lines = shown.map((r, i) => {
    const project = r.project_id ? (projMap.get(r.project_id) ?? '') : '';
    const eng = engMap.get(r.id);
    const bits: string[] = [];
    if (showRoleTitle) {
      bits.push(eng?.role_title ? eng.role_title : '(no title)');
    }
    if (showBillRate) {
      bits.push(eng?.bill_rate != null ? `$${eng.bill_rate}/hr` : '(no bill rate)');
    }
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

// Count executor — returns matching total + small breakdown by location_type and active status.
// Reuses user.list's filter shape so the classifier can pick either intent from the same fields.
async function execUserCount(admin: SupabaseClient, conv: Conversation): Promise<void> {
  const c = conv.captured;

  // Build the same filter chain as execUserList so counts are consistent with lists.
  const applyFilters = (q: ReturnType<SupabaseClient['from']>) => {
    let out = q;
    if (c.role) out = out.eq('role', String(c.role));
    if (c.country) out = out.eq('country', String(c.country).toUpperCase());
    if (c.location_type) out = out.eq('location_type', String(c.location_type));
    if (c.missing_start_date === true) out = out.is('start_date', null);
    if (c.active === true) out = out.or(`end_date.is.null,end_date.gt.${todayIso()}`);
    if (c.active === false) out = out.lte('end_date', todayIso());
    return out;
  };

  // Project filter (resolve name/code → id)
  let projectId: number | null = null;
  if (c.project) {
    const tok = String(c.project).trim().toLowerCase();
    const { data: projects } = await admin.from('projects').select('id, name, code');
    const match = (projects ?? []).find((p) =>
      String(p.name).toLowerCase() === tok || String(p.code).toLowerCase() === tok);
    if (!match) {
      await writeBot(admin, conv.id, `Project "${c.project}" not found.`);
      return;
    }
    projectId = match.id as number;
  }

  // Vendor manager filter (resolve name/email → id, single-only for count — no picker preamble)
  let vmId: string | null = null;
  if (c.vendor_manager) {
    const resolved = await resolveUser(admin, String(c.vendor_manager), 'vendormanager');
    if (resolved.kind !== 'single') {
      await writeBot(admin, conv.id, `Vendor manager "${c.vendor_manager}" not uniquely resolvable. Try the full email.`);
      return;
    }
    vmId = resolved.user.id;
  }

  // Client-engagement-scoped filters (role_title, bill_rate_min/max).
  const engFilterUserIds = await resolveEngagementFilterUserIds(admin, c);
  if (engFilterUserIds !== null && engFilterUserIds.length === 0) {
    await writeBot(admin, conv.id, `Total${c.role_title || c.bill_rate_min || c.bill_rate_max ? ` matching those job filters` : ''}: 0`);
    return;
  }

  const baseQuery = () => {
    let q = admin.from('profiles').select('*', { count: 'exact', head: true });
    q = applyFilters(q);
    if (projectId != null) q = q.eq('project_id', projectId);
    if (vmId != null) q = q.eq('vendor_manager_id', vmId);
    if (engFilterUserIds !== null) q = q.in('id', engFilterUserIds);
    return q;
  };

  // Only compute breakdowns when the user did NOT already pin those dimensions.
  const wantLoc = !c.location_type;
  const wantActive = c.active === undefined;

  const [{ count: total }, onshoreRes, offshoreRes, activeRes, endedRes] = await Promise.all([
    baseQuery(),
    wantLoc ? baseQuery().eq('location_type', 'onshore') : Promise.resolve({ count: null }),
    wantLoc ? baseQuery().eq('location_type', 'offshore') : Promise.resolve({ count: null }),
    wantActive ? baseQuery().or(`end_date.is.null,end_date.gt.${todayIso()}`) : Promise.resolve({ count: null }),
    wantActive ? baseQuery().lte('end_date', todayIso()) : Promise.resolve({ count: null }),
  ]);

  const filterParts: string[] = [];
  if (c.role) filterParts.push(String(c.role));
  if (c.project) filterParts.push(`project=${c.project}`);
  if (c.country) filterParts.push(`country=${String(c.country).toUpperCase()}`);
  if (c.location_type) filterParts.push(String(c.location_type));
  if (c.vendor_manager) filterParts.push(`reports to ${c.vendor_manager}`);
  if (c.active === true) filterParts.push('active');
  if (c.active === false) filterParts.push('terminated');
  if (c.missing_start_date === true) filterParts.push('missing start_date');
  if (c.role_title) filterParts.push(`title~${c.role_title}`);
  if (c.bill_rate_min != null && c.bill_rate_min !== '') filterParts.push(`bill≥$${c.bill_rate_min}`);
  if (c.bill_rate_max != null && c.bill_rate_max !== '') filterParts.push(`bill≤$${c.bill_rate_max}`);
  const filterDesc = filterParts.length > 0 ? ` matching ${filterParts.join(', ')}` : '';

  const lines = [`Total${filterDesc}: ${total ?? 0}`];
  if (wantLoc && (onshoreRes.count != null || offshoreRes.count != null)) {
    lines.push(`  Onshore: ${onshoreRes.count ?? 0}`);
    lines.push(`  Offshore: ${offshoreRes.count ?? 0}`);
  }
  if (wantActive && (activeRes.count != null || endedRes.count != null)) {
    lines.push(`  Active: ${activeRes.count ?? 0}`);
    lines.push(`  Ended: ${endedRes.count ?? 0}`);
  }
  await writeBot(admin, conv.id, lines.join('\n'));
}

// Resolves user_ids that match client-engagement-scoped filters (role_title,
// bill_rate_min, bill_rate_max). Returns null when no such filter is set (i.e.
// caller should NOT apply an .in() restriction). Returns [] when filters are
// set but nothing matches (caller should short-circuit with a "no results"
// reply). Otherwise returns the deduped list of matching user_ids.
async function resolveEngagementFilterUserIds(
  admin: SupabaseClient,
  c: Record<string, unknown>,
): Promise<string[] | null> {
  const roleTitle = typeof c.role_title === 'string' ? c.role_title.trim() : '';
  const billMin = c.bill_rate_min != null && c.bill_rate_min !== '' ? Number(c.bill_rate_min) : null;
  const billMax = c.bill_rate_max != null && c.bill_rate_max !== '' ? Number(c.bill_rate_max) : null;
  if (!roleTitle && billMin === null && billMax === null) return null;

  // Current engagements only.
  let q = admin.from('client_engagements').select('user_id').is('effective_to', null);
  if (roleTitle) q = q.ilike('role_title', `%${roleTitle}%`);
  if (billMin !== null && Number.isFinite(billMin)) q = q.gte('bill_rate', billMin);
  if (billMax !== null && Number.isFinite(billMax)) q = q.lte('bill_rate', billMax);

  const { data, error } = await q;
  if (error) throw new Error(`client_engagements filter failed: ${error.message}`);
  const ids = Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id).filter(Boolean)));
  return ids;
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
  const projectResolved = enriched._project_resolved as
    | { id: number; name: string; code: string } | undefined;

  const lines = spec.fields
    .filter((f) => f.applies_if ? f.applies_if(enriched) : true)
    .filter((f) => {
      // Hide unused ask_only_if_mentioned fields with no default — they're
      // encouraged extras (role_title, rates, payment_terms) that should stay
      // silent when CA didn't provide them.
      if (!f.ask_only_if_mentioned) return true;
      if (f.default !== undefined) return true;
      return enriched[f.name] !== undefined && enriched[f.name] !== null && enriched[f.name] !== '';
    })
    // 'client' is consumed into 'project' during resolution; never show it.
    .filter((f) => f.name !== 'client')
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

      // Project: show code alongside name when we have a resolution.
      if (projectResolved && f.name === 'project') {
        return `  Project: ${projectResolved.name} (${projectResolved.code})`;
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
      } else if (f.name === 'bill_rate' || f.name === 'pay_rate') {
        // Money formatting.
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
        displayValue = Number.isFinite(n) ? `$${n}/hr` : String(v);
      } else {
        displayValue = String(v);
      }
      const labelMap: Record<string, string> = {
        role_title: 'Position',
        bill_rate: 'Bill Rate',
        pay_rate: 'Pay Rate',
        payment_terms: 'Payment Terms',
      };
      const humanLabel = labelMap[f.name] ??
        f.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return `  ${humanLabel}: ${displayValue}`;
    })
    .join('\n');
  return `Confirm — I'll ${spec.description.toLowerCase()} with these details:\n\n${lines}\n\nReply YES to proceed, NO to cancel, or send corrections.`;
}

function needsTargetResolution(intentName: string): boolean {
  return intentName === 'user.set_start_date'
    || intentName === 'user.set_end_date'
    || intentName === 'user.update_country_region';
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
