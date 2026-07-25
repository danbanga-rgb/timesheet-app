# qbXML gotchas + decisions log

Running log of non-obvious decisions and open questions from Chunk 2 builder work.
Each session appends; nothing is removed.

## Session 1 — 2026-07-23 — BillQueryRq

### Decisions locked

- **qbXML spec version: 13.0** (`envelope.ts:QBXML_VERSION`).
  Rationale: 13.0 is the highest version Intuit shipped with QB Desktop Pro 2020 SDK. Higher versions (14.0+) target QB 2021+. Using the exact target version avoids "unrecognized element" errors from features QB 2020 doesn't understand.
  **UNVERIFIED — TODO: confirm against Intuit's compat matrix before Aug 9 live testing.** If QB 2020 accepts 14.0 gracefully we can bump to widen future capability, but 13.0 is the safe conservative pick.

- **BillQueryRq uses `RefNumberList` (repeatable), not `RefNumber` (single).**
  Multiple `<RefNumberList>` elements in the request → QB returns bills matching any of them. Confirmed from Consolibyte's schema.
  Alternative shape `RefNumberCaseSensitiveList` exists for case-sensitive matching — not needed today.

- **`IncludeLineItems=false`** on every query.
  We only need `RefNumber → TxnID` mapping. Line items are wasted bytes and QB CPU. If a future need arises (e.g. verifying bill amount before paying), flip this per-call rather than globally.

- **Empty `refNumbers` throws.**
  QB would accept an empty `BillQueryRq` and return every open bill — never what we want. Failing fast at the builder is safer than accidentally scanning the entire A/P ledger.

- **XML escape order matters: `&` first, then `<`, `>`, `"`, `'`.**
  Test-locked. If `&` isn't first, `<` becomes `&lt;` and then the `&` gets re-escaped to `&amp;lt;`. Classic bug; not making it.

- **Default envelope `onError="stopOnError"`.**
  If any request in a batch fails, subsequent ones are skipped. Safer default for our workflow where later requests often depend on earlier ones (query TxnID → apply payment). Override with `continueOnError` when we specifically want per-request independence (e.g. bulk bill query where partial success is useful).

- **`requestID` is optional but recommended when batching.**
  When we send multiple requests in one envelope, the response echoes each `requestID` back so we can pair them. Not needed for one-request envelopes.

### Open questions for Aug 9 accountant testing

1. **QB 2020 accepts qbXML 13.0?** Verify empirically on first live handshake.
2. **How does BillQueryRq treat trailing/leading whitespace in RefNumber?** Some of our historical invoice numbers came from Amazon-style extractors that may have stray spaces. If matching is exact, we may need to trim on our side. Test with a bill that has stray whitespace in QB and see if it matches.
3. **Case sensitivity in practice.** Assumed case-insensitive by default. If accountant has bills with mixed casing (e.g. `Inv 43` vs `INV 43`), verify matching behavior.
4. **What does QB return when RefNumber matches zero bills?**
   - Empty `<BillRet>` list with `statusCode="0"` (success, no matches)?
   - Non-zero statusCode ("no records found")?
   Parser (Session 3) needs to handle whichever it is. Assumption for now: empty list with statusCode=0.

### Non-obvious style choices

- **Builders return the element only**, not the full QBXML envelope. Envelope wrapping is separate (`wrapQbxmlRequests`) so the edge fn can batch. Test files exercise both.
- **Two-space indentation inside emitted XML.** Chosen for readability when a request is logged or dumped. QB doesn't care about whitespace.
- **File layout:** `types.ts` for input/output shapes, `envelope.ts` for shared wrapping + escaping, `builders.ts` for request builders. Parsers will land in a separate `parsers.ts` (Chunk 3).
- **Sessions committed independently** so each is reviewable in isolation.

## Session 2 — 2026-07-23 — BillAddRq

### Decisions locked

- **Constants extracted to `constants.ts`.** `DEFAULT_AP_ACCOUNT`, `DEFAULT_EXPENSE_ACCOUNT`, plus payment-side accounts (`KEY_POINT_CHECKING`, `WU_HOLDING`, `BANK_SERVICE_CHARGES`, `CONVERA_PAYEE`) staged now so Session 3 doesn't need to re-derive them. Values mirror the existing IIF export exactly. Do not change without re-verifying against QB.

- **Element ordering is enforced by the builder AND locked in a test.**
  qbXML rejects requests where `<BillAdd>` children arrive out of spec order (schema validation error). Locked order:
  `VendorRef → APAccountRef → TxnDate → DueDate → RefNumber → Memo → ExpenseLineAdd+`
  Inside `ExpenseLineAdd`: `AccountRef → Amount → Memo`.
  Test `builders.test.ts:"emits elements in the strict qbXML spec order"` guards against accidental refactor breaking this.

- **`ExpenseLineAdd.Amount` is POSITIVE** (expense debit). QB derives the A/P credit internally. Differs from IIF where the caller wrote both sides explicitly.

- **Bill is per-group, not multi-group.** Each `BillAddRqInput` = ONE bill. Callers (job enqueue layer, later) do umbrella-vendor grouping and enqueue N `bill_add` jobs. Cleaner than accepting an array of groups here.

- **`Amount` always formatted `.toFixed(2)`.** Currency is USD-only for now; qbXML AMTTYPE tolerates more precision but 2dp matches QB storage + IIF + accountant expectations. Guards against JS float noise.

- **Optional elements omitted when not supplied.** `DueDate`, `Memo`, per-line `Memo` — all conditional. Sending empty `<DueDate></DueDate>` or `<Memo></Memo>` can trip QB parsers; omission is safer.

- **`TermsRef` explicitly NOT emitted.** Mixing `TermsRef` and `DueDate` in one request is ambiguous — QB's precedence behavior is undocumented. We compute `DueDate` ourselves (same policy as IIF: last-day-of-month + max NET terms across combined invoices) and send that. No `TermsRef`.

- **Unicode is passed through untouched.** Only the five XML special chars are escaped. Croatian/Serbian diacritics (`Đ Ž Č Ć Š`) survive the builder as-is. QB Desktop 2020's SDK has known encoding quirks with some codepoints (see project memory for `OBAI DRUŠTVO` history); that's a QB-side problem to solve when we see it — the builder shouldn't sanitize preemptively.

### Open questions for Aug 9 accountant testing

5. **`RefNumber` max length on `BillAdd`.** Consolibyte schema pins `BillPaymentCheckAddRq.RefNumber` at 11 chars — but Bill's may be higher (QB UI supports 20 chars in the Bill Ref No. field). Not verified. Long invoice numbers like `INVOICE_Synergie 05/01-31/2026` (30 chars) may need truncation OR may pass through if the actual QB limit is more generous. Test with a real long-refnumber bill on first live handshake.

6. **`ExpenseLineAdd` vs `ItemLineAdd`.** We use `ExpenseLineAdd` matching IIF. This loses hours/rate as structured fields (they only appear in memo strings). If the accountant wants hours×rate in QB reports (e.g. for cost-per-hour analytics), we'd need `ItemLineAdd` referencing a Service item per contractor. Not needed for MVP.

7. **How does QB respond when `VendorRef.FullName` doesn't match an existing vendor?** BillAddRq requires the vendor to pre-exist. Assumption: statusCode ≠ 0 with a "vendor not found" message. Parser (Session 3) must surface this cleanly so the caller can prompt the accountant to create the vendor in QB (or auto-create via VendorAddRq — future scope, tracked in main design memory).

8. **Multi-currency.** All amounts assumed USD. Combined bills across currencies would need `<CurrencyRef>` + `<ExchangeRate>` on the bill and probably per-line handling. Not implemented; not tested. Note in code comment where these would live.

### Non-obvious style choices

- **Two-level indentation of ExpenseLineAdd** (4 spaces inside `<BillAdd>`, 6 spaces inside `<ExpenseLineAdd>`) — human-readable when logged; QB doesn't care.
- **Grouping semantic lives in the caller, not the builder.** Encouraged pattern: caller (edge fn job dispatcher) groups by `(qb_vendor_name, period_end month)` before enqueueing.
- **`fmtAmount` helper is private to `builders.ts`.** Not exported. Session 3 will need it too; will lift to a shared helper file if a second builder wants it.

## Session 3 — 2026-07-25 — BillPaymentCheckAddRq

### Decisions locked

- **One BillPaymentCheck = ONE payee.** The schema takes a single `PayeeEntityRef` for the whole payment, then N `AppliedToTxnAdd` blocks — but every application is against a bill owned by that ONE vendor. If a single Convera wire ever routes to multiple beneficiaries (rare — Convera transfers are per-beneficiary), the caller enqueues one job per (vendor, wire) pair with the same TxnDate + BankAccount + RefNumber. Documented in the type comment on `BillPaymentCheckAddRqInput` and the builder doc block.

- **RefNumber max 11 chars — enforced at builder input time.** `BillPaymentCheck.RefNumber` is capped at 11 in QB Desktop (documented in Consolibyte + confirmed in the QB UI). Longer values cause a schema validation error from QB. Builder throws immediately with a message pointing the caller at the wire confirmation code instead of the invoice number. Our real Convera codes ("OTR6607568", 10 chars) always fit.

- **Element ordering is enforced by the builder AND locked in TWO tests** (one for the outer `BillPaymentCheckAdd` children, one for the inner `AppliedToTxnAdd` children). qbXML rejects out-of-order children. Locked order:
  - **`BillPaymentCheckAdd`:** `PayeeEntityRef → APAccountRef → TxnDate → BankAccountRef → RefNumber → Memo → IsToBePrinted → AppliedToTxnAdd+`
  - **`AppliedToTxnAdd`:** `TxnID → PaymentAmount → DiscountAmount → DiscountAccountRef → DiscountClassRef → SetCredit*`
  - **`SetCredit`:** `CreditTxnID → AppliedAmount → Override?`

- **`PaymentAmount` always emitted with 2dp** via the private `fmtAmount` helper (same one BillAdd uses). Same rationale as Session 2: currency canonicalization + guards against JS float noise. `DiscountAmount` and `AppliedAmount` (in `SetCredit`) get the same treatment.

- **`DiscountAmount` requires `DiscountAccountRef` — builder throws if only the amount is set.** QB rejects the request server-side anyway (no account to book the discount to), but catching at the builder gives a cleaner error and prevents an SDK round-trip.

- **`IsToBePrinted` is omitted by default.** Convera wires and ACH are not printed checks, but a QB company file may default new payments to "to be printed". Caller can pass `false` explicitly to defensively override that default; omit for the common case. Builder emits `<IsToBePrinted>true</IsToBePrinted>` or `<IsToBePrinted>false</IsToBePrinted>` only when the caller supplied a value.

- **`SetCredit` support is built in even though the Convera MVP flow won't use it.** Cheaper to include the shape now than to retrofit later, and the type documentation flags it as a future accountant-triggered-payment feature. Zero cost to the current flow (empty array = no `<SetCredit>` blocks emitted).

- **`APAccountRef` defaults to `DEFAULT_AP_ACCOUNT`.** Same pattern and same constant as Session 2's BillAddRq.

- **`BankAccountRef` is required (no default).** Caller decides between `WU_HOLDING` (Convera wires) and `KEY_POINT_CHECKING` (direct disbursements). Both live in `constants.ts` from Session 2 for exactly this reason.

- **`fmtAmount` still private to `builders.ts`.** Third builder that would use it → lift to shared helper. For now, two callers (buildBillAddRq + buildBillPaymentCheckAddRq) in the same file is fine.

### Open questions for Aug 9 accountant testing

9. **`BillPaymentCheckAdd` responses on partial-application errors.** If the payment covers 3 bills and one TxnID is stale (bill was voided or edited between our query and our apply), does QB reject the whole payment or apply the good bills and warn on the bad one? Assumption for now: whole-payment rejection with `statusCode ≠ 0`. Parser (Chunk 3) needs to handle both shapes; verify empirically.

10. **`SetCredit.Override=true` behavior on over-application.** When we consume more credit than the vendor has available, does QB warn or block? Consolibyte notes say "warn"; not verified on QB Desktop 2020 Pro. Only matters if we ever wire SetCredit — deferrable.

11. **`IsToBePrinted` interaction with QB company file default.** Some QB companies default new BillPaymentChecks to "to be printed" (Edit → Preferences → Checking). Verify whether our omission uses the file default (expected) or a global qbXML default. If our omission causes wires to land in the "to be printed" queue, we'll need to always emit `false`.

12. **`PayeeEntityRef` mismatch with the bill's `VendorRef`.** If we accidentally supply a different payee than the bill's vendor, does QB reject with a helpful message or apply against A/P generically? Should never happen in practice (both come from `payment_profiles.qb_vendor_name`) but worth knowing.

13. **Multi-currency bill payments.** Same deferral as Session 2 — USD-only for MVP; test coverage does not include currency fields. If we ever wire Convera EUR/GBP invoices through QB, need `<CurrencyRef>` on the payment AND matching currency on the bank account.

### Non-obvious style choices

- **Two order-lock tests, not one.** Sessions 1 & 2 had a single order test per builder. This session adds a second because `AppliedToTxnAdd` has its own strict ordering that's independent of the outer element order. A refactor could break either without the other noticing.
- **Fixture in the test suite mirrors a real Convera wire.** `payeeVendorName = 'Bimosoft - Amar Pljevljak'`, `refNumber = 'OTR6607568'`, `bankAccount = WU_HOLDING`, real TxnID shape (`12006-1196864828`). Makes the emitted XML meaningful to spot-check by eye, and makes debugging against a real payment easier.
- **Boundary test on RefNumber length (exactly 11 chars accepted, 12+ rejected).** Belt-and-suspenders — the `<=` in the check would silently mis-bound if someone flipped it to `<`.
- **"Bare skeleton" test** verifies that ONLY the required elements appear when every optional field is omitted. Guards against accidental emit-of-empty tags — QB parsers can trip on `<Memo></Memo>` even when they accept omission.

## Chunk 3 · Session 1 — 2026-07-25 — response parsers

Chunk 3 opens with the response parsers (`parsers.ts`). Zero-dep, hand-rolled targeted extractors — matches the aesthetic of Sessions 1–3 and keeps the Deno edge fn lean. Alternative (fast-xml-parser) was considered and explicitly rejected in favor of the smaller surface area.

### Decisions locked

- **Targeted extractors, not a general XML parser.** Four private helpers do 95% of the work: `xmlUnescape`, `getLeafText` (first `<tag>text</tag>` occurrence), `getAttr` (attribute value from an opening tag string), `getAllBlocks` (all top-level `<tag>…</tag>` occurrences). Plus `getFirstElement` which returns opening-tag + inner content for the response's top-level element.

- **Sub-block stripping is the critical safety measure.** `BillRet` contains `<LinkedTxn>` sub-blocks with nested `<TxnID>` and `<RefNumber>` that refer to OTHER transactions (previous payments, credits). A naïve first-occurrence extractor would return LinkedTxn's TxnID/RefNumber for any bill with linked history. Solution: strip `LinkedTxn` (and other defensive candidates: `VendorRef`, `APAccountRef`, `CurrencyRef`, `TermsRef`, `SalesTaxCodeRef`, `ExpenseLineRet`, `ItemLineRet`, `CustomFieldRet`, `DataExtRet`) from the block before extracting leaves. `BillPaymentCheckRet` gets the same treatment against `AppliedToTxnRet` etc.

- **Load-bearing test:** `parseBillQueryRs` "IGNORES nested LinkedTxn TxnID/RefNumber". Realistic fixture with a bill that has payment history. Rejects both incorrect values by name. This test is the difference between the parser being correct in production and being subtly wrong on the first bill with a linked payment.

- **Belt-and-suspenders test on BillPaymentCheckRet** — same pattern, `AppliedToTxnRet` sub-blocks carry per-bill TxnIDs which must not surface as the payment's identity.

- **Case sensitivity: qbXML is always PascalCase.** Parser is case-sensitive by design. No inference; no normalization. If QB ever returns lowercase (it shouldn't), the parser will silently miss it — and that's the correct signal to investigate rather than paper over.

- **`getLeafText` uses `[^<]*` for content.** Deliberately does NOT support elements with child content — those are container blocks, and we strip them before extraction. Regex is tighter and mis-matches are impossible.

- **Attribute parsing supports both single and double quotes.** QB always double-quotes, but the parser doesn't care. Small robustness for zero cost.

- **`unwrapQbxmlResponses` returns whole-element strings**, one per `*Rs` element in `QBXMLMsgsRs`. Edge fn dispatches each to the appropriate parser by tag name. Regex `<([A-Za-z][A-Za-z0-9]*Rs)…</\1>` — one-off targeted match on the response-element naming convention.

- **Envelope-optional inputs.** All three top-level parsers accept EITHER a full QBXML envelope OR just the bare `*Rs` fragment. Simpler for tests and gives the edge fn one less thing to do.

- **Return shape uses `null` for missing result, empty array for zero matches.** `BillQuery` returns `results: []` on zero-match (valid successful state). `BillAdd` / `BillPaymentCheckAdd` return `result: null` on error (no Ret block emitted by QB). Type-checked callers can't confuse the two.

- **`result.refNumber` is optional on BillPaymentCheckAddResult**, matching the request where RefNumber is optional. If our caller didn't supply one, QB won't have one to echo back.

- **Missing required leaves skip the record, not throw.** If QB ever returns a BillRet without TxnID (never observed), that Ret is silently dropped rather than throwing and losing every other result in the batch. Defensive. Tested.

### Open questions for Aug 9 accountant testing

14. **What does QB return on "no records found" from BillQueryRq?** Consolibyte says statusCode=1 severity=Warn. Our parser treats it as "no matches"; if the actual behavior is statusCode=0 with an empty result set, both branches yield the same output. Verify on first empty query.

15. **`AppliedToTxnRet` shape on BillPaymentCheckAddRs when SetCredit is applied.** We strip the whole block, so we don't care about its inner shape — but if a future feature needs to surface applied-credit breakdowns back to the UI, we'll need to re-parse it. Confirm the shape on first payment involving credits.

16. **CDATA in responses.** Our stripper and leaf extractor don't specially handle `<![CDATA[…]]>` inside stripped blocks (safe — we're throwing them away). Inside a leaf field, CDATA content would be returned as literal `<![CDATA[…]]>` text. Never observed from QB but worth noting.

17. **`statusCode` value taxonomy.** We treat non-zero as "error or warning" without enumerating specific codes. QB Desktop 2020 Pro has a large statusCode table (3100+ for various errors); when we start writing user-visible error handling, we'll want a mapping — but for parser MVP, opaque strings are sufficient.

### Non-obvious style choices

- **Fixture builder in the test** (`buildBillRet` in `parseBillQueryRs` tests) — reduces boilerplate for the multi-record + LinkedTxn-stripping tests. NOT used elsewhere; kept local to that describe block to avoid over-abstracting.
- **`getFirstElement` returns `{openingTag, inner}`, not just `inner`.** Callers need the opening tag string to run `getAttr` for status attributes. One helper produces both cheaply; separating would double the regex work.
- **The stripped-tag list is a `const` array, not inlined.** Both to signal that "these are the container types we know about in BillRet" and to make future additions a one-line change (e.g. when qbXML 14.0 introduces a new container).
- **Tests use hand-crafted response fixtures**, not captured-from-QB responses. This is a MVP concession — we don't have live QB output yet. Aug 9 live testing will produce real fixtures we can bake into a `parsers.fixtures.ts` file for regression coverage.
