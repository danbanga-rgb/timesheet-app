# qbWrite executor — INVARIANTS

**READ THIS BEFORE TOUCHING ANY FILE IN THIS DIRECTORY.**

Every rule below was learned through a real bug in production. Regressions are real-money bugs.
Canonical memory copy: `~/.claude/projects/-Users-dbanga-timesheet-app/memory/project_qbwrite_invariants.md` — keep in sync.
Related: `src/lib/qbxml/GOTCHAS.md` (per-request-shape gotchas from Sessions 1-3).

## 36 invariants qbWrite + consumers MUST enforce

### Builder-layer (qbXML)

1. **ASCII only** — `assertAscii` all inputs. Xerces decodes Windows-1252; non-ASCII → malformed XML. Source: incident 2026-08-12.
2. **Element ordering strict per SDK 13 XSD** — BillAdd / BillPmtCheckAdd / CheckAdd / AppliedToTxnAdd have locked order tests. Do not reorder.
3. **Amounts via `fmtAmount` (`.toFixed(2)`)** — guards JS float noise; matches QB storage.
4. **Empty inputs throw or omit — never emit `<Memo></Memo>`** etc. QB parsers trip on empty tags.
5. **BillPaymentCheck RefNumber max 11 chars** — builder throws on longer input. Real Convera codes are 10.
6. **DiscountAmount requires DiscountAccountRef** — builder throws if amount without account.
7. **XML escape order: `&` first, then `<`/`>`/`"`/`'`**.
8. **BillQueryRq uses repeated `<RefNumber>`, NOT `<RefNumberList>`** — QB rejects the latter with 0x80040400.
9. **IncludeLineItems defaults false** — flip per-call for bill_pmt_query only.
10. **Unicode diacritics pass through untouched** — QB-side quirks are QB's problem.

### Domain / persistence

11. **Vendor-scoped TxnID resolution** — key by `(vendor, refNumber)`, never refNumber alone. Contractors share `INV 03/26`. Source: batch-15 wrong-vendor incident 2026-08-13.
12. **Reconciler requires refHit for `already_done` / `pay_existing_bill`** — amount-only matches fall to `create_bill_then_pay` (safe fallback).
13. **normalizeRef strips STACKED "INV" prefixes** — `Inv# INV-000046` and `INV 000046` collapse to `000046`. Regex `/^(INV[\s#\-]*)+/`. Source: Hover incident 2026-08-21.
14. **Payload contract via `job-payloads.ts::validatePayload`** — add required key HERE first, otherwise silent no-op. Source: 2026-08-14 incident.
15. **Umbrella-safe payment persistence via `convera_transaction_billpmts`** — `(convera_transaction_id, qb_vendor_name)` UNIQUE; `payment_amount NOT NULL`.
16. **Parsers strip sub-blocks before leaf extraction** — LinkedTxn / AppliedToTxnRet / VendorRef / APAccountRef / ItemLineRet MUST be stripped. Load-bearing tests exist.
17. **sessionProgress: WC drains FULL queue in ONE session** — ~44s / 29 jobs. Don't chunk artificially.
18. **Idempotency: `qb_ingest_events.status='posted'` skips re-post** — never push twice.
19. **`(source, source_ref)` UNIQUE blocks duplicate ingest**.

### Data invariants

20. **offshore = 100% Convera** — any offshore→Intuit is a data bug; fix in `profile.country`.
21. **Bimosoft always UK ALT profile** — legacy linkages caused money astray.
22. **`invoice.paymentProfile` is a JSONB SNAPSHOT** — fall back to live `payment_profiles` by `userId` for QB routing. Bit F.5 classifier (4e1c7da) AND Missing-Bills audit (9482b75).
23. **matcher_ignore cutoff** (invoices 2026-04-28 / transactions 2026-06-20) — pre-cutoff rows fenced.
24. **pre_our_system cutoff for source adapters** — 2026-06-01 for Intuit. Bump per accountant validation.

### Process

25. **Probe first, codify second** — new qbXML behavior gets a live probe THEN reduction into qbWrite.
26. **RLS on new tables — `CREATE POLICY` in every migration** — Supabase default-deny otherwise.
27. **State vs fresh fetch in orchestrators** — fetch dependencies fresh from Supabase inside orchestrators fired in the same tick as their load.
28. **Extract before write** — ≥30 lines new logic → pure primitive to `src/lib`, tested in isolation.
29. **Scan existing helpers first** — grep before writing.
30. **Verify beneficiary before unmatch** — check `payment_profiles.company_name` first.
31. **Two-copy qbxml/ drift** — `src/lib/qbxml/*.ts` and `supabase/functions/qb-web-connector/qbxml/*.ts` MUST stay in sync.
32. **QBWC smoke test at session start** — account_query round-trip verifies connectivity.

### qbWrite design constraints (locked)

33. **Atomic intents ONLY** — `pay_bill`, `create_bill`, `check_expense`. No compound intents. Chaining is scheduling (via `qb_sync_jobs.depends_on`), NOT intent shape.
34. **Multi-vendor writes = N intents** — one umbrella wire → N `pay_bill`s. Executor has no concept of "wire."
35. **One read (qb_mirror), one write (qbWrite), complexity in source adapters** — source-agnostic executor. Reconciler is per-source.
36. **Verify via mirror after every push** — job status=done + no mirror row after 30 min = silent-drop alert.

## Test-coverage rule

Every invariant SHOULD have at least one test asserting it in `src/lib/qbWrite/__tests__/`. Tests are load-bearing documentation. Deleting a test = deleting the rule.

## Consumer checklist

Before wiring a new consumer (Intuit push, Convera push, proactive create_bill flow, etc.) through qbWrite, verify:

- [ ] Reads qb_mirror for state (NOT the invoices table for "does bill exist")
- [ ] Emits ATOMIC intents, one per unit-of-write
- [ ] Payload passes `validatePayload(kind, payload)` at the top of build
- [ ] Uses live `payment_profiles` fallback for `qbVendorName` — not just the snapshot
- [ ] Respects pre_our_system cutoff (skip pre-cutoff events)
- [ ] Reconciler decisions honored — do not push events with `resolvedAction='held'` or `'pre_our_system'`
- [ ] Post-push polls qb_mirror; alerts on silent-drop after 30 min
- [ ] Idempotency: reject re-push on `status='posted'`
