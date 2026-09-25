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

## Priority 0b — Chat as the CA's primary interface (design locked 2026-09-25)

> **Cold start: read this section top to bottom, then do "Start here" (bottom of the section).** It is self-contained: no separate resume prompt is needed.

### 0. Why

The Contracts Admin (contracts@synergietechsolutions.com, role `contract_admin`, he/him) uses chat as **their main way into the system**:
- **onboarding:** pastes the client's onboarding email → create the user with project, dates, rates, role, payment terms
- **lifecycle changes:** start/end dates, project moves, country/region, pay and bill rates
- **open-ended questions** about people, projects, roles, rates and counts

Trigger (2026-09-23): "Mirza Hukic is finishing at the end of this week". The profile is "Mirza Hukić".
- The accent-sensitive lookup said "No user found" twice.
- While stuck in the end-date form, the bot claimed it had "no access to a project roster".
- The session expired after 24h. Nothing was done, nobody was told, and every CA message had NULL `parsed_intent`/`action_taken`.

Dan's framing: *"I've given you enough context that you'd know what to do. Why can't the LLM we pay for?"* The answer is **wiring, not the model**:
- the LLM only fills forms
- code does lookups and sends canned replies
- the LLM never sees data and can't clarify
- every new question type needs a new intent with bolted-on filters (`user.list` already has ~12)

**Don't design from the latest incident** (Dan pushed back on a Mirza-only framing). Design from the whole transcript history. Also note: many early messages come from while the bot was being built and patched, so they test the *types* of request, not the bot's past quality.

### 1. Hard constraints (Dan)

- **Running cost ≈ zero.** Dan: "even ~$1/week is too much."
  - Anthropic spend caps: **notify at $2/month, stop at $4/month.** Dan believes these already exist; **verify in the Anthropic Console** before shipping.
  - Real volume: 88 inbound messages in launch week (2026-08-31), then 20, 12, 6 per week.
- **Cheapest model: `claude-haiku-4-5`** ($1/$5 per MTok; cached input ~$0.10/MTok). It's already the model in `supabase/functions/_shared/llm.ts` (`CLAUDE_MODEL`).
- **The chatbot is the way the CA changes data.** Don't make CA-requested data fixes by hand or by SQL (Dan, 2026-09-25: "No, you will not make that change. That's what the chatbot is for.").
- **Writes always need an explicit confirmation**, checked by our code (RBAC via `has_permission`, schema validation, `chat_actions` audit). The model proposes; code decides.

### 2. Current system (as of 2026-09-25)

- **Edge fn `supabase/functions/chat-parse/index.ts`** (~2,030 lines, deployed `--no-verify-jwt`; it checks the JWT and `chat_enabled` itself). Live version **v34**, deployed from branch `fix/chat-accent-insensitive-search` (PR #16 → main, open).
- **Phases:** `idle` → `collecting` → `confirming` → execute → back to `idle`. `cancelled`/`error` are terminal. A 24h timeout sweep runs (`20260901020000_chat_timeout_sweep.sql`).
  - `handleIdle` classifies the intent (last 6 messages as context).
  - `driveCollecting` is an LLM form-filler (last 8 messages, field schema).
  - `handleConfirmation` → `executeIntent`.
- **Intents** (`chat-parse/intents.ts`):
  - reads: `user.get`, `user.list`, `user.count`
  - writes: `user.create`, `user.set_start_date`, `user.set_end_date`, `user.update_project`, `user.update_country_region`, `user.update_pay_rate`, `user.update_bill_rate`
- **Name resolution:** `resolveUser()` → RPC **`search_profiles(q, role_filter, max_results)`** (migration `20260925010000`: `unaccent` + `pg_trgm`; tiers exact / contains / tokens / similar; returns `project_name`; `service_role` only). "Did you mean" for similar-only matches. **Shipped 2026-09-25 (step 1).**
- **Tables:**
  - `chat_conversations` (intent, captured, phase, expires_at)
  - `chat_messages` (content, `parsed_intent` + `action_taken`: currently NOT populated)
  - `chat_actions` (writes only, audit)
  - `chat_allowlist_audit`
- **Frontend:** `src/roles/Chat/` (ChatShell, api.ts), CA landing `src/roles/ContractAdmin/`, admin audit `src/roles/AdminChat/AdminChatActivity.tsx` (lists `chat_actions` = successful/failed writes only; reads and abandoned conversations are invisible).
- **Data the CA asks about:**
  - `profiles`: name, email, role, country, region, location_type, project_id, start_date, end_date, manager_id, vendor_manager_id, payment_terms, invoice_enabled, reminders_enabled
  - `projects`: id, name, **code** e.g. `APFM-061`, `APFM-116`, `GNW-104`, `AnE-087`; status
  - `clients` (name, …)
  - `client_engagements`: user_id, client_id, role_title, bill_rate, sow_reference, effective_from/to
  - `rate_history`: user_id, rate_kind (pay/bill), rate, effective_from/to, client_engagement_id
- **Related memories:** `project_chat_bot.md` (history + this decision), `project_contract_admin_identity.md`, `project_bill_vs_pay_rate.md`, `project_country_location_type_derivation.md` (country always derives location_type, never the reverse), `project_projects_no_client_id.md`, `feedback_llm_needs_today_date.md`, `feedback_ca_pronouns.md`.

### 3. Target design (chosen by Dan 2026-09-25, stress-tested below)

```
CA message
  │
  ├─ A. Code-only handler ($0) ── YES/NO/cancel/skip, "1"/"2" picks, exact email,
  │                                explicit dates, simple field answers ("croatia", "onshore")
  │
  ├─ B. Write request ── code pre-fetches context (name matches via search_profiles,
  │      projects+codes, clients, this week's calendar) → ONE Haiku call fills the
  │      intent schema → code validates → confirmation → existing executor → chat_actions
  │
  ├─ C. Question ── ONE Haiku call emits a STRUCTURED QUERY (JSON, never SQL)
  │      → code resolves names/projects inside it → validates against allowlisted
  │      read-only views → runs with row limit → CODE renders the table/answer
  │      (the model only writes a one-line lead-in, or nothing)
  │
  └─ D. Doesn't fit / ambiguous ── bounded loop (≤ 3 model calls) using the same
         read tools, or a clarifying question. Never a made-up capability limit.
```

**Router:** A is pure code, tried first. Otherwise one Haiku call returns `{kind: write|question|chat, intent?, fields?, query?, reply?}`. B and C are then the *same single call*, so most messages cost **exactly one model call**.

**Escalation:** if Haiku's output fails validation twice, retry once on a stronger model (Sonnet). This should be rare, and it's logged.

#### 3.1 Structured query (C)

The shape the model emits (validated by code; unknown fields/ops are rejected with a clarifying reply):
```json
{
  "entity": "people",
  "filters": [
    {"field": "project", "op": "eq", "value": "APFM"},
    {"field": "role_title", "op": "ilike", "value": "data engineer"},
    {"field": "bill_rate", "op": "gt", "value": 60},
    {"field": "status", "op": "eq", "value": "active"}
  ],
  "fields": ["name", "email", "project", "role_title", "bill_rate"],
  "group_by": "vendor_manager",
  "aggregate": "list | count",
  "sort": {"field": "end_date", "dir": "desc"},
  "limit": 25,
  "refines_previous": false
}
```
- **Views (read-only, allowlisted), built as SQL views with `security_invoker = true`** (see memory `project_supabase_view_security_invoker`):
  - `chat_v_people`: profile + project name/code + current role_title/bill_rate (current `client_engagements` row) + current pay rate (`rate_history`) + manager/vendor-manager names + derived status (active / ended / not started)
  - `chat_v_projects`: project + head counts
  - later, if asked: `chat_v_invoices_summary`
- **Name/project resolution inside filters:** person values go through `search_profiles`; project values match name, code (`APFM-061`) or id (`2`). Several matches → "Which Aleksandar? 1. … 2. …" (and code handles the reply "1").
- **Data dictionary** (part of the cached system prompt, **generated from the view definitions and intents.ts** so it can't drift): every field, meaning, allowed ops, synonyms ("contractors" = timesheetuser, "VMs" = vendormanager), and date rules.

#### 3.2 Standing context (cached system prompt)

- **Who the CA is** and what they usually do. Tone: short, plain.
- **Conventions:**
  - names often carry Balkan diacritics (ć č š ž đ)
  - onshore/offshore derives from country, never the reverse
  - "contractor" = timesheetuser
  - project codes look like `APFM-061`
- **Data dictionary** (3.1) + a **capability list generated from intents.ts + views**. "Can you change a pay rate?" is answered from it, never guessed.
- **"Not tracked" rule:** if a question needs data that isn't in the dictionary (e.g. discounts), say so plainly.
- **Contradiction rule:** if the fields disagree (e.g. country=IN with location_type=onshore), show both, flag it, and offer the fix (a write proposal).
- **Volatile part, after the cache breakpoint:** `TODAY IS 2026-…` plus **this week's calendar**, Mon–Sun with dates. "End of this week" = **Friday**, as the last working day, unless the CA says otherwise. Timesheet weeks end on Sunday; don't confuse the two. The deterministic date parser (§3.3) handles the common phrases before the model sees them.

#### 3.3 Code-only handler (A)

- confirmations: yes/y/ok/confirm, no/n/cancel, skip
- numbered picks ("1", "the second one")
- exact email → resolve directly
- field answers while collecting: country names/ISO (existing `normalizeCountry`), onshore/offshore, role synonyms, send-invite yes/no
- **date parser:** today, tomorrow, yesterday, (next|this) <weekday>, end of (this|next) week/month, `M/D`, `M/D/YYYY`, ISO. If it's ambiguous, fall through to the model.

### 4. Stress test (all 103 CA inbound messages, 2026-09-02 → 09-25)

| Share | Kind | Real examples | Path |
|---|---|---|---|
| ~35% | Short replies | YES/NO/skip, "croatia", "onshore", an email, "next monday", "HR" | A ($0) |
| ~30% | Writes | "add Sarah Chen sarah@example.com onshore APFM starting monday", Tharun's pasted block (Name/Position/Client/SOW/Start/Location/Pay/Payment terms/Bill), "harun ends today", "he should be assigned to client APFM", "sivakumar is onshore not in india", "Change send invite to No", "I have contractor whose pay rate is increasing" | B |
| ~35% | Questions | see below | C (D rarely) |

Questions, and what each one requires:

| Real question | Req |
|---|---|
| "who all are on APFM?", "give me all offshore people", "who all do we have as data engineers", "do we have any contractors in india? who are they?" | filters (base) |
| "when did harun start?", "is harun hasic still working", "what is liya's bill rate?", "what is senad role/title?", "is Tharunkumar offshore or onshore" | one person + fields (base) |
| "how many total onshore + offshore", "just give me the counts not the names", "total number of active contractors across all projects" | **R1 counts grouped by a field** |
| "who are vendor managers and who are their contractors?" | **R2 grouping** |
| "who reports to Aleksandar?" (failed **6×** on 2026-09-04; the worst experience in the log) | **R3 names inside filters resolved, with "which X?"** |
| "which ones of these are onshore" | **R4 refine the previous result** (store last query in `chat_conversations`; model emits a patch) |
| "who all are on 2?", "can you show me all people on APFM-061 / APFM-116" | **R5 project by code / name / number** |
| "who was the last person that finished and on what date", "recent offboardings" | **R6 date + recency semantics** |
| "do you have bill rates of contractors", "can you query people's role/title?", "if i want to increase someone's payrate, are you able…" | **R7 capability answers from the generated list** |
| "do we offer any discounts on the bill rate?" | **R8 honest "not tracked in the system"** |
| "how can sivakumar be onshore and also IN?" | **R9 contradictions shown + flagged + fix offered** |

**Verdict:** all 103 fit the design once R1–R9 are in. No question needed free-form SQL.

Real data issue found by the CA: **Sivakumar Gnanathilagam has country=IN but location_type=onshore.** He should fix it through chat once R9 lands (or via the admin UI; Dan's call).

### 5. Cost model

| Path | Model calls | Tokens (in / out) | $ per message |
|---|---|---|---|
| A code-only | 0 | – | $0 |
| B write | 1 | ~6–10K (mostly cached) / ~200–400 | ~$0.004–0.008 (pasted onboarding email ≈ $0.01) |
| C question | 1 | ~6–10K (mostly cached) / ~100–200 (code renders the table) | ~$0.004–0.006 |
| D loop | ≤3 | – | ≤ ~$0.02, rare |

- **Now (6–20 msgs/week):** ~$0.03–0.10/week.
- **If chat truly becomes the main interface (100+/week):** ~$0.50–0.80/week, still under the $2 alert.
- **Rules:**
  - Keep the fixed block (instructions + dictionary + capability list) byte-stable and first, with the cache breakpoint after it. Verify `usage.cache_read_input_tokens > 0`.
  - **Check that Haiku's minimum cacheable prefix is met.** If the block is below it, caching silently does nothing; either grow it with useful dictionary detail or accept uncached.
  - History: last 4 turns plus the stored last query (R4), not more.
  - Output: JSON only, `max_tokens` ~400. Tables are rendered by code.

### 6. Observability + safety nets

- **Persist per inbound message:** the model's raw JSON (`chat_messages.parsed_intent`), what code did (`action_taken`: path A/B/C/D, validation errors, rows returned) and `response.usage` (tokens → cost).
- **Chat Activity (admin):**
  - add a conversations view with filters: failed / abandoned / clarification loops
  - show reads, not just writes
  - weekly token + $ total vs the $2/$4 caps
- **Unfinished writes:** when a conversation with a write intent expires or is cancelled after a failure, email Dan via Brevo (same pipe as reminders): "CA's request 'Mirza Hukic is finishing…' ended without completing."

### 7. Evals (replay tests)

- Fixtures file `supabase/functions/chat-parse/evals/cases.json`, built from the 103 real messages (grouped into conversations where follow-ups matter).
- Each case: input (+ prior turns) → **expected path + intent/query** (e.g. case 1: "Mirza Hukic is finishing at the end of this week" on 2026-09-23 → path B, `user.set_end_date {target: mirza.hukic@pm.me, end_date: 2026-09-25}`).
- **Runner script** (Node, calls the chat pipeline's pure core with a fake DB and fixed "today"). Grading is deterministic: path, intent and normalized fields/query compared.
- A full run is ~60 LLM calls ≈ **$0.30–0.50**. Run it before every deploy of prompt/tool/view changes. Record pass rate in this plan.

### 8. Build slices (each in a FRESH Claude Code session: this plan is the brief)

| Slice | Scope | Effort | Claude Code usage (rough) |
|---|---|---|---|
| **S1 — Foundations** | Code-only handler + date parser (A); persist parsed/action/usage (§6 first half); calendar in prompt; capture the 103-message eval fixtures | ~2h | ~40–60 tool calls |
| **S2 — Questions** | `chat_v_people` / `chat_v_projects` views; structured query schema + validator + executor + table renderer; R1–R9 resolution; generated data dictionary + capability list; route questions through C (replaces user.list/count/get internals) | ~3–4h | ~70–100 tool calls |
| **S3 — Writes** | Single-call write extraction with pre-fetched context (B); keep the confirm/executor path; pasted onboarding email end to end; Sivakumar-style correction writes | ~2–3h | ~50–70 tool calls |
| **S4 — Safety nets** | Bounded loop (D) + clarifying questions; stronger-model escalation; unfinished-write email; Chat Activity conversations view + cost panel; eval runner wired in | ~2–3h | ~50–70 tool calls |

Order: **S1 → S2 → S3 → S4.** S2 fixes the worst real pain ("who reports to Aleksandar?"). Each slice: branch off `main`; deploy `chat-parse` with `--no-verify-jwt`; typecheck with `npx -y deno@2 check index.ts` (**9 pre-existing errors = baseline**); run evals; PR to main; ask the CA to try the real phrasing.

### 9. Decisions log

- 2026-09-25: step 1 (accent-insensitive search + did-you-mean) shipped. Mirza's end date was then set **through chat by the CA**; the model first proposed 9/28 for "end of this week", and the CA corrected it to 9/25. That's why the calendar and date parser are in S1.
- 2026-09-25: **structured query over curated views, not model-written SQL** (Dan: my recommendation; stress-tested → holds).
- 2026-09-25: **near-zero running cost** is a hard constraint; one Haiku call per non-trivial message; caps notify $2 / stop $4 per month.
- 2026-09-25: rejected **free tiers (Gemini/Groq)**: contractor PII, may train on data, rate limits; we already moved off Groq. Rejected **self-hosting** (no cheap place to run it).

### 10. Open questions (ask Dan when relevant; don't block on them)

- Unfinished-write alerts: email Dan only, or also the CA?
- Should the CA see rates (bill/pay) for everyone, or only for people they manage? Today they see all. Confirm before building `chat_v_people`.
- Proactive digests (e.g. "3 contractors end this week", "2 starters without a project"): code-only, no model cost. Wanted? (Not in S1–S4.)

### Start here (cold start)

1. `git fetch && git log origin/main --oneline -5`. Check whether PR #16 (`fix/chat-accent-insensitive-search`) is merged. If not, ask Dan to merge it first (chat-parse v34 already runs from it).
2. Read memory `project_chat_bot.md` (2026-09-25 sections) and this section.
3. Read-only sanity check: chat-parse is deployed and `search_profiles('Mirza Hukic')` returns an exact match.
4. Tell Dan in two lines where things stand, then start **S1** on a new branch off `main` (the plan is approved; no need to re-ask about the design). Discuss only the §10 open questions if a slice touches them.

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
