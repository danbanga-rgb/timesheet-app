# Chat Bot for TimesheetSystem Ops (living doc)

**Status:** Design phase. Started 2026-09-01.
**Owner:** Dan (product), Contract Admin + Lucien (accountant) + Dan as initial user cohort.
**Motivation:** Contract Admin's onboarding/offboarding tasks are low-frequency single-actor writes where opening the app + finding the form is slower than typing a sentence. Chat surface replaces form-fill for those.

---

## Locked decisions

### Surface + hosting
- **Standalone web chat inside TimesheetSystem** on a dedicated subdomain (e.g. `chat.mysynergie.net`).
- **Same repo, same Vercel project**, subdomain routing via middleware. One codebase, one deploy.
- **PWA manifest** so users can add to home screen — feels like a native app.
- WhatsApp / SMS deferred (see Discarded paths).

### Gate
- **Passkey (WebAuthn)** — biometric only, no passwords, no shared secrets.
- Separate auth flow — does NOT inherit main-app session (isolation-first).
- Lockout recovery: admin sets `chat_passkey_id = NULL` → user re-enrolls on next visit.

### Allowlist
- `profiles.chat_enabled boolean default false` — hard gate flipped manually by admin.
- `profiles.chat_passkey_id text` — stored credential ID.
- `profiles.chat_passkey_registered_at timestamptz`.
- `chat_allowlist_audit` table — every enable/disable/passkey-registered/revoked action logged.
- Per-request check on every message: session valid + chat_enabled=true + credential ID matches.

### Interaction philosophy
- **Conservative defaults.** Never guess. Ask for anything not explicitly stated. Confirm everything before executing.
- **Declarative field schema** — single source of truth per intent, so field type (buttons/text) and required-ness can be flipped by changing one property.
- **Fuzzy name match with confirmation** for update intents — bot shows full identity ("You mean James Wong?") before proceeding.
- **Interrupt policy**: if new intent detected mid-flow, prompt "cancel current or continue?" — do NOT auto-cancel.

### State machine
```
idle → parsing → collecting → awaiting_confirmation → executing → done → idle
                                       ↑ ↓
                                       edit
```
- Any state + `cancel` → idle.
- Timeout: **60min collecting, 30min awaiting_confirmation** → auto-cancel with "session expired" message.
- One active conversation per user at a time.

### Data model — three tables
- **`chat_conversations`** — one row per user, current phase + captured fields JSON + expires_at.
- **`chat_messages`** — every turn logged (direction in/out, content, parsed_intent JSON, action_taken).
- **`chat_actions`** — every executed action for audit + rollback (input, output, status).

### LLM
- **Groq Qwen 3.8-27b** — already have API key, free tier covers baseline volume trivially.
- Prompt gives LLM the intent schema + captured fields so far + the next field's expected type.
- Returns `{intent, entities}` OR `{intent: "unknown", suggested_rephrase}`.

### Executor identity model — LOCKED 2026-09-01: Option A
- Chat bot forwards the caller's Supabase JWT to executor edge fns.
- Existing RLS + role checks apply automatically. No parallel permission system.
- `auth.uid()` in RLS = the real actor; audit trail natural.
- Whatever a user can do in the app UI, they can do via chat — same permission surface. No divergence.
- Consequence: contract_admin role must already have the permissions in the main app for the intents they'll invoke via chat. If a chat intent needs a role capability that's not granted in the app, that gets granted in the app first (not worked around in chat).

### Granular RBAC — LOCKED 2026-09-01: full app-level refactor as Phase 1 foundation

Rationale: role-string checks scattered across edge fns don't support the granularity Dan wants (CA gets create+update user, Lucien gets update user only, both maybe extend to payment_profile). Refactor to a permission model app-wide, so chat + app UI share the same source of truth.

**Schema:**
```sql
CREATE TABLE role_permissions (
  role text NOT NULL,
  permission text NOT NULL,
  granted_by uuid REFERENCES profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  PRIMARY KEY (role, permission)
);

CREATE FUNCTION has_permission(uid uuid, perm text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_permissions rp
    JOIN profiles p ON p.role = rp.role
    WHERE p.id = uid AND (rp.permission = perm OR rp.permission = '*')
  );
$$;
```

**MVP permission catalog:**
| Permission | Admin | Contract Admin | Accountant | Vendor Manager |
|---|---|---|---|---|
| `user.create` | ✅ | ✅ | ❌ | ❌ |
| `user.update` | ✅ | ✅ | ✅ | ❌ |
| `user.set_end_date` | ✅ | ✅ | ✅ | ❌ |
| `payment_profile.create` | ✅ | ✅ (future) | ✅ (future) | ❌ |
| `payment_profile.update` | ✅ | ✅ (future) | ✅ (future) | ❌ |
| `invoice.approve` | ✅ | ❌ | ✅ | ❌ |
| `timesheet.approve` | ✅ | ❌ | ✅ | ✅ (their vendors) |

Wildcard `*` = all. Admin seeded with `*`; can be scoped down later.

**Edge fn pattern:** `if (!await hasPermission(callerId, 'user.create')) return 403`.
**RLS policies:** switch `role = 'admin'` checks to `has_permission(auth.uid(), 'X')` where relevant.
**App UI:** role-gated buttons/forms open up to whichever role now has the permission (widening access, not narrowing — regression-safe).
**Chat intent schema:** each intent declares `required_permission`. Bot filters intent visibility per user — denied intents don't appear, don't 403.

**Effort:** ~4-6 hrs one-time refactor + ~10 edge fns to touch. Ongoing: one line per new feature.

**Modularization tie-in (LOCKED 2026-09-01 — bundled opportunistically):**
When the RBAC refactor touches a UI role gate that today lives inline in `TimesheetSystem.tsx` (5300 lines), extract it into the correct `src/roles/{RoleName}/` module as part of the same change. Doesn't force full decomposition, but every gate we touch lands in the right place. Applies [[extract-before-write]] rule: 30+ lines of gate + supporting logic = extract pure primitive to `src/roles/`. See [[modularization-backlog]] for the broader plan.

## Phase 1 scope

### Writes only (5 intents)
1. `user.create` — full profile creation
2. `user.set_end_date` — offboarding
3. `user.set_start_date` — start-date shift
4. `user.update_project` — reassignment
5. `user.update_country_region` — location change

**All writes gated by confirmation.** No exceptions in Phase 1.

### Read intents deferred to Phase 2
"Where is Sarah?" / "Who's ending this month?" / "List active on APFM" etc. — Contract Admin can still use the app for these.

### `user.create` field requirements (locked)

**Must have (bot won't proceed without):**
- `name` — free text
- `email` — free text, format-validated
- `role` — buttons (timesheetuser / manager / accountant / vendormanager / admin)
- `location_type` — buttons (onshore / offshore) — drives rate math

**Highly encouraged (bot asks, user can defer):**
- `country` — buttons for 8 supported (US/GB/HR/RS/BA/MK/CA/SI) + "other" free text
- `project` — buttons from projects table
- `start_date` — free text or quick picks (today / next Monday / custom)

**Auto / derived:**
- `region` — default to country's most common if not stated
- `reminders_enabled` — always true default, no ask

**Conditional:**
- `vendor_manager_id` — **optional**. If role starts with "vendor" AND value not provided in original message, bot asks with picker + skip option. If provided, no ask. If skipped, null. (Locked 2026-09-01.)
- `invoice_enabled` — default OFF, asked only if user explicitly mentions invoicing

**Optional (skip unless volunteered):**
- `end_date`

### Post-create step
Invite send **defaults YES** — auto-fires after create. User overrides by editing the confirmation summary (e.g. "don't send invite"). Bot reports "Invite sent" in success message. (Locked 2026-09-01.)

### Button UX
- Standalone web chat = full render control; buttons trivial.
- `input: 'buttons+text'` — buttons visible AND user can type free-text; LLM fuzzy-maps text to the closest valid option.

## Discarded paths (with reasons)

- **WhatsApp Business API** — 1-3 day Meta approval, per-tenant SIM/number needed for productization, third-party dependency, template policy risk. Standalone web chat preserves full control + zero external dep. Reconsider only if in-app adoption falls short.
- **SMS OTP gate** — costs $ per session start, weakest MFA (SIM swap), and passkey achieves better security AND better UX. No reason to pay for the weaker option.
- **Main-app SSO chat inheritance** — sharing session weakens the "own security" gate; a compromised main-app session = compromised chat write authority. Separate gate is cheap insurance.
- **Auto-execute low-risk intents in Phase 1** — reliability graduation is a Phase 2 concept; ship with confirmation-on-everything first.

## Open questions (in-order)

1. ~~**Confirmation summary style**~~ **LOCKED 2026-09-01: A — verbose all-fields**, "for now." Bot re-lists every field on every confirmation, even after single-field edits. May revisit if operators complain of noise.
2. ~~**Bot copy/tone**~~ **LOCKED 2026-09-01: middle register + status-only emoji (✅ ⚠️ ❌).** Field labels human-cased ("Start date," not "start_date"). One register works for both ops + future contractor audience — no role-based tone forking.
3. ~~**Error handling philosophy**~~ **LOCKED 2026-09-01: best-effort with detailed reporting + auto-retry-once on transient errors + no undo intent in Phase 1.** Every step tried, bot reports success/failure per step with actionable next step. Transient errors (5xx, timeout) retried once with brief backoff before surfacing. Undo/fix goes through app UI in Phase 1.
4. ~~**Modularization scope in Phase 1**~~ **LOCKED 2026-09-01 (re-confirmed): keep opportunistic modularization in Phase 1.** Do it right the first time around. Every touched role gate extracts to `src/roles/{RoleName}/` per [[extract-before-write]] rule.
5. ~~**Vendor manager handling**~~ **LOCKED 2026-09-01: optional field.** If role starts with "vendor" and vendor_manager not provided in original message, bot asks with picker + skip option. If provided upfront, use it. If skipped, stored as null.
6. ~~**Rate limiting**~~ **LOCKED 2026-09-01: defaults.** Per-user message rate: 10/min, 200/day. Per-user executor call rate: 30/hr. Enforcement: message rate in chat webhook middleware (pre-LLM), executor rate in each executor edge fn (pre-work). 429 responses with polite "slow down" message. Admin role gets ~10x limits for debugging.
7. ~~**Production rollout**~~ **LOCKED 2026-09-01:**
   - **Rollout order:** soft-launch with Dan alone for 1-2 weeks (self-testing in real ops) → then launch with CA at same time as Dan continues. Lucien joins later. She's the primary user, her feedback shapes iteration.
   - **First-touch onboarding for CA:** Dan does in-person demo + first passkey enrollment together. Bot has a friendly first-message guide for subsequent visits (option 3 — bot introduces itself + shows example intents).
   - **Passkey failure support:** admin (Dan) runs a one-line SQL to clear `chat_passkey_id` for lockout recovery. Documented in a `chat-admin-runbook.md` alongside the plan doc.
   - **Feature flag / silent deploy:** the `profiles.chat_enabled` per-user flag IS the feature gate. No separate global env var. Deploy to prod → only enabled users see anything.
   - **Comm plan:** in-person for CA. No formal announcement.
2. Bot copy/tone conventions — friendly? terse? emoji? title-case field names?
3. Reliability graduation criteria for Phase 2 (per-user trust score? intent-specific? auto-execute list?)
4. Read intent design for Phase 2 (which lookups, output formatting)
5. Lucien's accountant intents (Phase 2) — likely more complex (invoice queue, targeted pings, early-fire reports)
6. Exact input-type choice per field (locking button vs text per field, using the declarative schema — deferred to build phase)
7. Error handling deep-dive: partial failures (user created but invite send failed), retry policy for transient errors, executor idempotency
8. Rate limiting on executor endpoints — prevent LLM misfires from spamming create-user
9. Bot handling of ambiguous vendor manager (multiple managers per vendor company) — expose picker or pick primary
10. Production rollout — how does user (CA) know to try the chat? Do we tell them or wait for them to reach for it?

## Contractor-facing evolution (baked into MVP architecture)

Even though Phase 1 = ops only (CA, Lucien, Dan), architecture must accommodate contractor-facing at Phase 4+ without a rewrite. Bake these in Day 1:

1. **Intent schema is role-scoped** — every intent has `allowed_roles: []`. Bot filters intent set by user role. Adding contractor intents later = append + set allowed_roles.
2. **Executor authorization** — every executor edge fn re-checks (a) caller's role for the intent, (b) ownership of the target entity. Contractor can only touch their own records.
3. **Per-user rate limiting on Day 1** — cheap now, mandatory at 65-contractor scale.
4. **Groq usage monitoring on Day 1** — per [[spend-monitoring-first-class]]. Free-tier caps may bite when contractor volume kicks in.
5. **`chat_enabled` bulk-flippable by role** — schema supports it; admin can enable all `role=timesheetuser` in one SQL update at Phase 4.
6. **Single tone works across audiences** — no role-based copy variants.

## Cross-cutting topics (separate discussion needed, notes-only for now)

- **Invite default in admin view** — Dan flagged 2026-09-01: currently create-user in admin UI does NOT auto-send invite (separate action via send-reminder). Chat bot now defaults YES for invite; considering aligning admin UI to also default YES. Deferred discussion.

## Related memory
- [[dont-nag-about-shelved]] — chat is a new arc, don't get distracted by the shelved contracts branch
- [[persist-evening-decisions]] — this doc is the direct application of that rule
- [[small-chunks-in-design]] — one question at a time in the discussion, this doc bundles them
- [[stop-on-first-pro-gate]] — same rule if any new external service (LLM host, MFA provider) turns out to be a paywall trap

## Slices (in progress — building 2026-09-01)

- **Slice 0: RBAC refactor** — ✅ SHIPPED (commit `8f3b1c5` on `feature/chat-mvp`). `role_permissions` table + `has_permission()` fn + seed + refactored create-user + impersonate-user. contract_admin can now call user.create via API.
- **Slice 1: chat schema migrations** — ✅ MIGRATION SHIPPED. 4 tables (chat_conversations, chat_messages, chat_actions, chat_allowlist_audit) + profiles.chat_enabled/chat_passkey_id columns. All with RLS.
  - **UI toggle for chat_enabled deferred** — SQL enables users for MVP (5-10 lifetime flips; UI toggle would touch 6-8 sites in TimesheetSystem.tsx for a low-value polish). SQL pattern: `UPDATE profiles SET chat_enabled = true WHERE email = 'x@x.com';`
- Slice 2: subdomain routing + passkey enrollment page
- Slice 3: chat UI shell + message send/receive
- Slice 4: LLM parser + intent schema (declarative, permission-gated) + declarative field engine
- Slice 5: state machine + conversation persistence + timeout sweep
- Slice 6: executor wiring for the 5 Phase 1 intents (calls existing edge fns via caller's JWT)
- Slice 7: audit tables + review UI (small admin panel showing chat_actions)
