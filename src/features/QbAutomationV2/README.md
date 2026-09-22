# QB Automation v2

Ground-up rebuild of the QB Automation tab. Role-agnostic module — any role can import and mount it. Currently mounted in the admin dashboard only; accountant continues to see v1 until the V12 cutover.

**Design intent:** category cards (Ready · Needs Mapping · Skipped · Pushed today) with one-line rows, hover-expand for detail, `pp_id`-primary vendor mapping, 3-tier smart mapping (exact → history → LLM Haiku), inline discrepancy flags, plain-English copy throughout.

**Plan doc:** `.claude/plans/qb-automation-v2.md` — twelve slices (V1–V12). Origin memory: `qb-automation-v2-pivot`.

**Do not:**
- Touch v1's QB Automation tab render inside `TimesheetSystem.tsx`.
- Add role imports into this module — roles mount it, not the other way around.
