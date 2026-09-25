# Chat MVP — improvements backlog

Consolidated from Dan + Contracts Admin (CA) feedback 2026-09-02 after first demo.

## Priority 0 — LLM-driven refactor (do NEXT session)

Current design is a rigid state machine: hard-coded field prompts, per-field ask loop, LLM only classifies intent. CA feedback exposed the seams ("why ask country then onshore?", "why prompt-by-prompt when I gave you everything?"). Item 1/2/4/5 patches masked the symptom but not the cause.

**Architecture** (locked with Dan 2026-09-02):

```
User → Our edge fn (context assembler + guardrails) → LLM → Our edge fn (validates, corrects, forces phase) → User
```

**Our side owns** (deterministic, source of truth):
- Intent schema (fields + constraints + defaults + derivations)
- Field validation (email format, date parse, permission RPC)
- Phase progression rules (can't confirm until required fields present)
- Executor invocation
- Guardrails: drop invented fields, force-ask forgotten required fields, refuse drift

**LLM owns** (natural language surface):
- Understanding user intent
- Reply phrasing (no hard-coded prompts)
- Grouping questions naturally
- Handling edits / rephrasing / clarifications

**Refactor plan:**
1. Delete `askNextFieldOrConfirm` + `formatFieldPrompt` + all hard-coded `prompt` field values.
2. `intents.ts` → keep field name/type/required/default/derivation. Drop `prompt`.
3. `handleCollecting` becomes `llmDriveConversation(context)`:
   - Assemble context: intent + schema + captured state + last N messages
   - Call LLM with system prompt: "you're a helpful ops assistant, here's the intent, here's what's known, here's what's missing, here's the user's latest — return {extracted_fields, next_reply, next_phase_hint}"
   - Post-LLM: server validates extracted_fields (drop invented, keep valid), decides real phase (LLM's hint is advisory), writes bot's next_reply
4. Confirmation summary stays deterministic (formatConfirmationSummary) — executor needs exact structure. But LLM writes the "here's what I'll do" sentence.
5. Cost: 3-5× tokens per turn. Groq Qwen is cheap; monitor via `chat_actions` and CLoudWatch equivalent.
6. Failure mode: if LLM output isn't parseable JSON, fall back to deterministic prompt for whatever the next required field is.

**Fold in as we go:**
- Item 4 (role default) → server sets default before LLM call, LLM never mentions it unless user does
- Item 5 (country → location_type) → derivation in normalize step, LLM doesn't see location_type at all
- Item 2 (bulk extract) → free because LLM sees whole message + captured state
- Country prompt tuning → moot, LLM phrases naturally

## Priority 0b — give the model tools + context (2026-09-25 CA review)

**Why:** 2026-09-23 the Contracts Admin asked "Mirza Hukic is finishing at the end of this week". The profile is "Mirza Hukić". The bot said "No user found" twice, then, stuck in the end-date form, told the CA it had "no access to a project roster" (it can list by project; the collecting prompt just doesn't know that). The session expired after 24h. Nothing was done and nobody was told. A person with the same context would have solved it in one step. The gap is wiring, not the model: the LLM only fills forms; code does lookups with canned replies; the LLM never sees data, can't search, can't retry.

**Step 1: SHIPPED 2026-09-25** (`fix/chat-accent-insensitive-search`, chat-parse v34 deployed):
`search_profiles` RPC (unaccent + pg_trgm tiers: exact / contains / tokens / similar), resolveUser uses it, "Did you mean" instead of a dead end, candidate lists show the project. user.get uses the same resolver.

**Step 2: tool-use loop for reads + resolution** (model: `claude-haiku-4-5`, the cheapest; Dan 2026-09-25: "this has been solved millions of times"):
- Replace "classify → fixed pipeline" for READS and target resolution with a Claude tool-use loop (Messages API `tools`, loop until `end_turn`, cap ~6 tool calls/turn).
- Read tools (server-implemented, role-scoped): `search_people(query, role?)` → search_profiles; `list_people(filters)` / `count_people(filters)` → existing execUserList/Count filters; `get_person(id|email)` → execUserGet card; `list_projects()`.
- Writes stay deterministic: the model calls `propose_action(intent, fields)` → the existing intents.ts schema validation → existing confirmation step (formatConfirmationSummary) → existing executors + chat_actions audit. The model never executes; the code decides what's allowed (RBAC via has_permission).
- Any phase: a side question mid-form ("is there a mirza hukic on any project?") goes through the same loop with the form state as context, so no more "I don't have access".
- Fallbacks: tool error or unparseable output → deterministic reply that names what failed; never a fabricated capability limit.

**Step 3: standing context, no silent failures, observability, evals:**
- System prompt carries standing context (like CLAUDE.md/memory for Claude Code): who the CA is and their usual tasks; project list (injected); conventions (names often carry diacritics; "end of this week" = that Friday as the last working day unless told otherwise; TODAY IS …); capability list generated from intents.ts so it can't drift.
- Unfinished writes: when a conversation with a write intent expires or is cancelled after a failure, notify admin (Brevo email, same pipe as reminders) and show it in Chat Activity.
- Persist every model output + tool call per message (chat_messages.parsed_intent / action_taken are NULL today for all CA messages). Chat Activity gets a "failed / abandoned" filter, not only successful writes.
- Replay evals: real CA transcripts become fixtures (input → expected tool calls / proposed action). Case #1: "Mirza Hukic is finishing at the end of this week" → search_people("Mirza Hukic") → propose user.set_end_date {target: mirza.hukic@pm.me, end_date: 2026-09-25}. Run on every prompt/tool change.

**Order:** Step 2 reads + resolution first (fixes the Mirza class end to end), then writes via propose_action, then Step 3. Discuss the step 2 design with Dan before building.

## Priority 1 — ship next (fundamental UX quality)

### 1. Intent classifier misfire on existing users
- **Symptom**: "set start date for Test Contractor" (existing user) routed to `user.create` flow instead of `user.set_start_date`.
- **Fix approach**: pre-classifier user-existence check. When intent involves a person + verb like "set/update", resolve the name FIRST. If user exists → force `user.set_*` intent path; only offer create when user doesn't exist AND verb is add/create.
- **Files**: `supabase/functions/chat-parse/index.ts` intent classifier prompt + resolver.

### 2. Bulk-extract from first message (not prompt-by-prompt)
- **Symptom (CA feedback)**: expected a regular chat conversation, not stepwise "what's the email? what's the country? what's..." Groq is fast enough to parse everything upfront.
- **Fix approach**: on first message, run intent classifier + extraction over the WHOLE message. Return `{intent, extracted_fields, missing_fields}`. Chat only asks for `missing_fields`. Confirmation dialog shows everything (extracted + defaults + user answers).
- **Files**: `supabase/functions/chat-parse/index.ts` — restructure `handleCollecting` to extract-all-fields-first, then ask only missing.

### 4. Role default to `timesheetuser`
- **Symptom**: CA sees "what role?" prompt for every user create.
- **Fix approach**: default `role='timesheetuser'` in create flow. Surface in confirmation summary — CA can override by editing before YES.
- **Files**: `supabase/functions/chat-parse/index.ts` field catalog for `user.create` intent — mark role as `{default: 'timesheetuser', ask_only_if_ambiguous: true}`.

### 5. Country → auto-derive onshore/offshore
- **Symptom**: chat asks country, then asks onshore/offshore. Onshore IS derivable (US = onshore, non-US = offshore).
- **Fix approach**: when country is set, compute `location_type = country === 'US' ? 'onshore' : 'offshore'`. Never ask separately. Show in confirmation.
- **Files**: same as #4 — field catalog derives location_type from country.

### 6. Persistent chat history in browser
- **Symptom (CA feedback)**: CA wants to scroll back to older messages across sessions/refreshes.
- **Fix approach**: chat_messages already persisted server-side. Frontend needs to fetch prior conversation on load (not just active/current). Add scroll-back UI. Add `/clear` slash-command that ends current conversation + starts fresh (server-side already supports terminal → new conversation via bootstrap).
- **Files**: `src/roles/Chat/ChatShell.tsx` — fetch full history for user, not just active conversation. `src/roles/Chat/api.ts` — extend query. Handle `/clear` message.

## Priority 2 — CA daily usage

### 3. Add read intents
- `user.get` (by name/email) — show start/end/project/country
- `user.list` (filter by role/project/status)
- Any other read intents CA needs — ask after Priority 1 ships

### 8. Direct chat link for CA
- Bookmarkable `/chat` URL — already works. Just needs to be shared with CA.
- Ideally subdomain `chat.mysynergie.net` (Slice 2b) but works today via preview URL.

## Priority 3 — surface polish

### 9. Chat button on other role dashboards
- accountant/manager/vendormanager should have header Chat button if `chat_enabled`.
- Mirror admin dashboard pattern in `src/TimesheetSystem.tsx:6617`.

### 10. contract_admin landing page
- Currently blank after login. Minimum: welcome page with big "Open Chat" button.
- Longer-term: dedicated ContractAdmin dashboard.

### 11. `profiles.chat_enabled` toggle in admin user-edit form
- SQL-only today. Add checkbox in user edit modal.

## Priority 4 — feature completeness (see project_chat_bot.md)

- 12. `user.update_project` intent
- 13. `user.update_country_region` intent
- 14. Audit UI — `chat_actions` viewer for admin
- 15. Passkey enrollment (Slice 2b)
- 16. Subdomain routing (chat.mysynergie.net)

## Notes for next session

- Chat MVP is on main as of 2026-09-02 (merged from feature/chat-mvp).
- Edge fns deployed: `chat-parse`, `create-user`, `impersonate-user` (verified current).
- CA account: contracts@synergietechsolutions.com, `chat_enabled=true`, role=contract_admin.
- Related memories: `project_chat_bot.md`, `project_contract_admin_identity.md`.
- Full design doc: `.claude/plans/chat-bot.md`.
