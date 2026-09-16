#!/usr/bin/env python3
"""state-consumer-map.py — pre-flight check for every slice that relocates a
useState hook out of TimesheetSystem.tsx's pre-role section.

Usage:
  python3 .claude/scripts/state-consumer-map.py                # full table
  python3 .claude/scripts/state-consumer-map.py stagedMatches selectedBatchId   # only these

For each `const [x, setX] = useState(...)` it prints, per region of the file,
how many lines reference x or setX (excluding the declaration line).

RULE (see plan §1b-E): a hook may be moved INTO a tab file only when every
region other than that tab shows 0 — i.e. no pre-role handler, no other tab,
no modal, no other role reads or writes it. If any other region is non-zero,
the slice must EITHER move that consumer in the same slice OR keep the hook
at the wrapper and pass it down. Never "move and fix later".

Region boundaries are derived live from the role `if` blocks and the
`{accountantTab === '...' && (` markers, so they survive line drift.
"""
import re, sys, pathlib

src = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'TimesheetSystem.tsx'
lines = src.read_text().split('\n')
n = len(lines)

def find(pat, start=1):
    rx = re.compile(pat)
    for i in range(start, n + 1):
        if rx.search(lines[i - 1]):
            return i
    return None

comp_start = find(r'^const TimesheetSystem = \(\) => \{')
admin = find(r"^  if \(currentUser!\.role === 'admin'\)")
acct = find(r"^  if \(currentUser!\.role === 'accountant'\)")
tsu = find(r'^  // ─── TIMESHEET USER VIEW', acct)
tabs = {}
for key in ['weekly', 'consolidated', 'client-estimation', 'invoices', 'timesheet-only', 'payments', 'qb-automation', 'profiles']:
    tabs[key] = find(r"\{accountantTab === '" + key + r"' && \(", acct)
tab_order = sorted(tabs.items(), key=lambda kv: kv[1])
first_tab = tab_order[0][1]

regions = [('top', 1, comp_start - 1), ('prerole', comp_start, admin - 1), ('admin+auth', admin, acct - 1), ('acctWrap', acct, first_tab - 1)]
for idx, (key, start) in enumerate(tab_order):
    end = tab_order[idx + 1][1] - 1 if idx + 1 < len(tab_order) else None
    regions.append((f'tab:{key}', start, end))
# last tab ends where accountant-level modals begin: first line after last tab that closes the IIFE at 10-space indent
last_key, last_start = tab_order[-1]
modals_start = None
for i in range(last_start + 1, tsu):
    if lines[i - 1].startswith('          })()}'):
        modals_start = i + 1
        break
regions = [(nm, a, (modals_start - 1 if b is None else b)) for nm, a, b in regions]
regions.append(('acctModals', modals_start, tsu - 1))
regions.append(('tsUser', tsu, n))

def region(i):
    for nm, a, b in regions:
        if a <= i <= b:
            return nm
    return '?'

st = re.compile(r'const \[(\w+), (set\w+)\] = useState')
only = set(sys.argv[1:])
rows = []
for i, l in enumerate(lines, 1):
    m = st.search(l)
    if not m:
        continue
    v, s = m.groups()
    if only and v not in only:
        continue
    rx = re.compile(r'\b(' + re.escape(v) + '|' + re.escape(s) + r')\b')
    uses = {}
    for j, l2 in enumerate(lines, 1):
        if j != i and rx.search(l2):
            r = region(j); uses[r] = uses.get(r, 0) + 1
    rows.append((i, v, uses))

print('regions:', ', '.join(f'{nm}={a}-{b}' for nm, a, b in regions))
print()
for i, v, u in rows:
    print(f'{i:5d} {v:34s} ' + '  '.join(f'{k}:{c}' for k, c in sorted(u.items())))
