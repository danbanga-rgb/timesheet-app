---
description: Scan recent transcripts, auto-add missing read-only Bash patterns to project settings.json
---

# /perms — auto-extend the read-only allowlist

Fire this at the start of a session. It scans recent transcripts, finds read-only Bash patterns that get used repeatedly, and appends the missing ones to `.claude/settings.json`.

**Behavior: auto-apply. No mid-run confirmation. Just write and report.**

## Steps

1. **Scan the 50 most-recent transcripts** for this project:
   `ls -1t ~/.claude/projects/-Users-dbanga-timesheet-app/*.jsonl | head -50`
   Extract every `assistant.message.content[]` entry with `type == "tool_use"`. For `Bash`, take `input.command`.

2. **Parse each Bash command** into `(leading_cmd, first_subcommand)` for every segment split on `&&`, `||`, `;`. Strip leading env-var assignments (`FOO=bar cmd ...`), `sudo`, `time`, `timeout N`.

3. **Filter to read-only, ≥3 occurrences.** Drop anything that writes, deletes, pushes, deploys, installs, mutates, or runs arbitrary code. Categorically forbidden as wildcard allowlist entries:
   - Interpreters: `python*`, `node`, `bun`, `deno`, `ruby`, `perl`, `php`, `npx`, `bunx`, `uvx`
   - Shells / eval: `bash`, `sh`, `zsh`, `eval`, `exec`, `ssh`, `sudo`
   - Task-runner wildcards: `npm run *`, `pnpm run *`, `yarn run *`, `make *`, `just *`, `cargo run *`, `go run *`
   - HTTP with mixed methods: `curl *` (only allow if narrowed to a specific host AND GET-only usage)
   - Package installers: `pip install *`, `npm install *`, `brew install *`
   - Git mutations: `git add/commit/push/checkout/merge/pull/fetch/stash/rebase`
   - Deploy/mutation subcommands: `gh pr create/merge`, `gh workflow run`, `gh run rerun`, `supabase functions deploy`, `supabase secrets set`, `supabase db push/reset`, `vercel deploy`, `vercel env add/rm`

4. **Skip anything Claude Code already auto-allows** (don't clutter settings):
   - Any-args: `cat`, `head`, `tail`, `wc`, `stat`, `strings`, `hexdump`, `od`, `nl`, `id`, `uname`, `free`, `df`, `du`, `basename`, `dirname`, `realpath`, `cut`, `paste`, `tr`, `column`, `tac`, `rev`, `fold`, `expand`, `unexpand`, `fmt`, `comm`, `cmp`, `numfmt`, `readlink`, `diff`, `true`, `false`, `sleep`, `which`, `type`, `expr`, `test`, `getconf`, `seq`, `pr`, `echo`, `printf`, `ls`, `cd`, `find`, `cal`, `uptime`, `locale`, `groups`, `nproc`
   - Safe-flags: `grep`, `egrep`, `fgrep`, `rg`, `sort`, `uniq`, `sed` (read-only exprs), `xargs`, `file`, `jq`, `awk` (read-only), `date`, `hostname`, `ps`, `pgrep`, `lsof`, `ss`, `netstat`, `tree`, `fd`, `sha256sum`, `sha1sum`, `md5sum`, `base64`, `man`, `info`, `history`, `tput`
   - All git read-only subcommands: `git status/log/diff/show/blame/branch/tag/remote/ls-files/ls-remote/rev-parse/describe/reflog/shortlog/cat-file/for-each-ref/worktree list/stash list`
   - All gh read-only subcommands: `gh pr view/list/diff/checks/status`, `gh issue view/list/status`, `gh run view/list`, `gh workflow view/list`, `gh repo view`, `gh release view/list`, `gh api` (GET), `gh auth status`
   - Docker read-only: `docker ps/images/logs/inspect`

5. **Skip anything already in `.claude/settings.json` OR `.claude/settings.local.json`.** Read both, dedupe against `permissions.allow` in each. Never modify `settings.local.json`.

6. **For anything left**, write it to `.claude/settings.json` under `permissions.allow`. Use the narrowest pattern that covers observed variants: `Bash(foo bar *)` (with the space before `*`), `Bash(foo bar)` for exact, or `Bash(foo bar-file*)` for path-prefix.

7. **Report** in a short table: rank, pattern, count, one-line note. Then a one-line summary: "Added N entries. Skipped X (auto-allowed), Y (already allowlisted), Z (mutating/unsafe)."

## Guardrails

- Do NOT touch `permissions.deny`, `permissions.ask`, `additionalDirectories`, or any non-permission field.
- Do NOT modify `.claude/settings.local.json` — that file is the user's personal working scratchpad.
- Preserve existing `permissions.allow` entries exactly; only append.
- If nothing new to add, say so in one line and exit. Do not write to the file.
- If you're unsure whether a pattern is safe, leave it out and mention it in the "skipped" line.
