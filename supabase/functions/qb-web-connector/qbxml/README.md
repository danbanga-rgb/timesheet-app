# qbxml/ — copy of `src/lib/qbxml/`

This directory contains a physical copy of the qbXML builder / parser code that
lives canonically in `src/lib/qbxml/`. The copy exists because Supabase edge
functions cannot reach outside their function directory except via the
`_shared/` convention, and we opted (as of Chunk 4) to keep the code intentionally
duplicated rather than restructure the module layout.

**Sync rule:** if you change ANY file here, apply the same change to the
corresponding file under `src/lib/qbxml/`. Vitest tests exercise the src/ copy.

Files:
- `envelope.ts` — QBXML envelope + xmlEscape
- `constants.ts` — DEFAULT_AP_ACCOUNT, DEFAULT_EXPENSE_ACCOUNT, bank account names
- `types.ts` — input/output type shapes
- `builders.ts` — BillQueryRq, BillAddRq, BillPaymentCheckAddRq
- `parsers.ts` — BillQueryRs, BillAddRs, BillPaymentCheckAddRs

Future refactor (not scheduled): consolidate to `supabase/functions/_shared/qbxml/`
and have src/ re-export or move the tests over.
