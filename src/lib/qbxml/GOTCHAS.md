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
