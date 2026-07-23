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
