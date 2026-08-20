#!/usr/bin/env python3
"""
Scan recent Claude Code transcripts and auto-append missing read-only Bash
patterns to .claude/settings.json under permissions.allow.

Runs as a SessionStart hook. Deterministic, no LLM. Silent unless it adds
something (or errors).

Rules:
  - Only append. Never remove, reorder, or touch other fields.
  - Never modify .claude/settings.local.json.
  - Skip patterns already in either settings file.
  - Skip patterns auto-allowed by Claude Code (no permission entry needed).
  - Skip anything that mutates, deploys, installs, or runs arbitrary code.
  - Require >= MIN_COUNT observations to be worth an entry.
"""

import json
import os
import re
import shlex
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]  # .claude/scripts/perms-scan.py -> repo root
SETTINGS = REPO / ".claude" / "settings.json"
LOCAL_SETTINGS = REPO / ".claude" / "settings.local.json"

# Project transcripts dir (Claude Code sanitizes cwd by replacing / with -).
def project_transcript_dir():
    home = Path.home()
    slug = str(REPO).replace("/", "-")  # e.g. -Users-dbanga-timesheet-app
    return home / ".claude" / "projects" / slug

TRANSCRIPT_LIMIT = 50   # scan most-recent N sessions
MIN_COUNT = 3           # need at least this many hits to be worth an entry
MAX_NEW_ENTRIES = 15    # safety cap per run

# ---------------------------------------------------------------------------
# Categorical forbid lists (never wildcard-allowlist these)
# ---------------------------------------------------------------------------

FORBIDDEN_LEADING = {
    # interpreters
    "python", "python3", "node", "bun", "deno", "ruby", "perl", "php", "lua",
    # shells / eval
    "bash", "sh", "zsh", "fish", "eval", "exec", "ssh",
    # package runners
    "npx", "bunx", "uvx",
    # privileged
    "sudo",
    # generic curl (mixed methods) - safer to require narrower entries
    "curl",
}

# Mutating subcommands: allow read subcommands only.
MUTATING_SUBS = {
    "git": {"add", "commit", "push", "checkout", "merge", "pull", "fetch",
            "stash", "rebase", "reset", "restore", "cherry-pick", "revert",
            "tag", "clone", "init", "am", "apply", "mv", "rm", "clean"},
    "gh":  {"create", "merge", "close", "reopen", "delete", "edit", "comment",
            "review", "ready", "run"},  # gh run (rerun/cancel) is mutating
    "supabase": {"deploy", "push", "reset", "set", "link", "login"},
    "vercel": {"deploy", "rm", "remove", "add", "promote", "rollback",
               "alias", "env", "domains", "certs", "secrets"},
    "docker": {"run", "exec", "rm", "rmi", "kill", "stop", "start", "restart",
               "build", "push", "pull"},
    "kubectl": {"apply", "delete", "create", "patch", "edit", "exec", "rollout"},
    "npm": {"install", "i", "uninstall", "publish", "run"},  # npm run is script runner
    "pnpm": {"install", "i", "add", "remove", "publish", "run"},
    "yarn": {"install", "add", "remove", "publish", "run"},
    "make": {"*"},   # any make target may mutate
    "just": {"*"},
    "cargo": {"run", "publish", "install", "build"},
    "go": {"run", "install", "get", "build"},
}

# Auto-allowed by Claude Code (no permission entry needed).
AUTO_ALLOWED_ANY_ARGS = {
    "cat", "head", "tail", "wc", "stat", "strings", "hexdump", "od", "nl",
    "id", "uname", "free", "df", "du", "basename", "dirname", "realpath",
    "cut", "paste", "tr", "column", "tac", "rev", "fold", "expand", "unexpand",
    "fmt", "comm", "cmp", "numfmt", "readlink", "diff", "true", "false",
    "sleep", "which", "type", "expr", "test", "getconf", "seq", "pr",
    "echo", "printf", "ls", "cd", "find", "cal", "uptime", "locale",
    "groups", "nproc", "tsort",
}
AUTO_ALLOWED_SAFE_FLAGS = {
    "grep", "egrep", "fgrep", "rg", "sort", "uniq", "sed", "xargs", "file",
    "jq", "awk", "date", "hostname", "ps", "pgrep", "lsof", "ss", "netstat",
    "tree", "fd", "fdfind", "sha256sum", "sha1sum", "md5sum", "base64",
    "man", "info", "history", "tput", "aki", "pyright", "ifconfig", "arch",
}
AUTO_ALLOWED_GIT_SUBS = {
    "status", "log", "diff", "show", "blame", "branch", "tag", "remote",
    "ls-files", "ls-remote", "rev-parse", "describe", "reflog", "shortlog",
    "cat-file", "for-each-ref", "worktree", "config",  # config --get only, but close enough
    "stash",  # ambiguous (list is safe, save mutates) - conservative: treat as auto-allowed only for `stash list`
}
AUTO_ALLOWED_GH_SUBS = {
    "pr", "issue", "run", "workflow", "repo", "release", "api", "auth",
}
AUTO_ALLOWED_DOCKER_SUBS = {"ps", "images", "logs", "inspect"}


# ---------------------------------------------------------------------------
# Command parsing
# ---------------------------------------------------------------------------

def split_compound(cmd):
    """Rough split on shell separators. Pipe not included (treated as one command)."""
    parts = re.split(r"(?:&&|\|\||;)", cmd)
    return [p.strip() for p in parts if p.strip()]


def leading_cmd(seg):
    """
    Given one shell segment, return (leading_cmd, first_positional_arg, full_stripped_seg).
    Returns None for junk (comments, empty, heredoc markers, etc.).
    """
    s = seg.strip()
    if not s or s.startswith("#") or s.startswith("<"):
        return None
    # Strip leading env-var assignments: FOO=bar BAZ=qux cmd ...
    while re.match(r"^[A-Za-z_][A-Za-z0-9_]*=\S+\s+", s):
        s = s.split(None, 1)[1]
    try:
        toks = shlex.split(s, posix=True)
    except Exception:
        toks = s.split()
    if not toks:
        return None
    i = 0
    while i < len(toks) and toks[i] in ("sudo", "time", "exec", "command", "nohup", "\\"):
        i += 1
    if i >= len(toks):
        return None
    if toks[i] == "timeout" and i + 2 < len(toks):
        i += 2
    cmd = toks[i]
    if cmd.startswith("#") or cmd.startswith("<") or cmd.startswith("$"):
        return None
    sub = ""
    for j in range(i + 1, len(toks)):
        if toks[j].startswith("-") or toks[j].startswith("$"):
            continue
        sub = toks[j]
        break
    return (cmd, sub, s)


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def is_auto_allowed(cmd, sub):
    if cmd in AUTO_ALLOWED_ANY_ARGS or cmd in AUTO_ALLOWED_SAFE_FLAGS:
        return True
    if cmd == "git" and sub in AUTO_ALLOWED_GIT_SUBS:
        return True
    if cmd == "gh" and sub in AUTO_ALLOWED_GH_SUBS:
        # Note: gh run rerun/cancel mutate but usage is rare enough to skip
        return True
    if cmd == "docker" and sub in AUTO_ALLOWED_DOCKER_SUBS:
        return True
    return False


def is_forbidden(cmd, sub):
    if cmd in FORBIDDEN_LEADING:
        return True
    mut = MUTATING_SUBS.get(cmd)
    if mut and (sub in mut or "*" in mut):
        return True
    return False


def propose_pattern(cmd, sub):
    """
    Decide the narrowest allowlist pattern for a (cmd, sub) that's still useful.
    Returns None if we can't safely wildcard.
    """
    if not cmd:
        return None
    if is_auto_allowed(cmd, sub):
        return None
    if is_forbidden(cmd, sub):
        return None
    # Safe reads for specific tools/subs:
    #   vercel inspect/ls/logs, supabase functions list, gh api (GET), pandoc (writes files - skip)
    if cmd == "vercel" and sub in {"ls", "inspect", "logs", "whoami", "list"}:
        return f"Bash(vercel {sub} *)"
    if cmd == "supabase" and sub == "functions":
        # Only 'list' is read-only. Too risky to wildcard subs — skip.
        return None
    if cmd == "pdftotext":
        return "Bash(pdftotext *)"
    if cmd == "pdfinfo":
        return "Bash(pdfinfo *)"
    if cmd == "pdffonts":
        return "Bash(pdffonts *)"
    if cmd == "source":
        # Only allow specific env files; wildcard `source *` allows arbitrary shell.
        # sub is the file path.
        if sub and (".env" in sub or sub.endswith(".sh")):
            return f"Bash(source {sub}*)"
        return None
    if cmd == "tmutil" and sub in {"listbackups", "listmachines", "machinedirectory", "destinationinfo"}:
        return f"Bash(tmutil {sub} *)"
    if cmd == "diskutil" and sub in {"list", "info"}:
        return f"Bash(diskutil {sub} *)"
    # Anything else: too speculative to auto-add.
    return None


# ---------------------------------------------------------------------------
# Transcript scan
# ---------------------------------------------------------------------------

def scan_transcripts():
    tdir = project_transcript_dir()
    if not tdir.exists():
        return []
    files = sorted(tdir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    files = files[:TRANSCRIPT_LIMIT]
    cmds = []
    for f in files:
        try:
            with f.open() as fh:
                for line in fh:
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    msg = rec.get("message")
                    if not isinstance(msg, dict):
                        continue
                    content = msg.get("content")
                    if not isinstance(content, list):
                        continue
                    for item in content:
                        if not isinstance(item, dict):
                            continue
                        if item.get("type") != "tool_use":
                            continue
                        if item.get("name") != "Bash":
                            continue
                        inp = item.get("input") or {}
                        c = inp.get("command")
                        if isinstance(c, str):
                            cmds.append(c)
        except Exception:
            continue
    return cmds


# ---------------------------------------------------------------------------
# Existing allowlist
# ---------------------------------------------------------------------------

def load_json(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def existing_allow():
    entries = set()
    for p in (SETTINGS, LOCAL_SETTINGS):
        data = load_json(p)
        perms = data.get("permissions") or {}
        for e in perms.get("allow") or []:
            entries.add(e)
    return entries


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    cmds = scan_transcripts()
    if not cmds:
        return 0

    counter = Counter()
    for cmd in cmds:
        for seg in split_compound(cmd):
            parsed = leading_cmd(seg)
            if not parsed:
                continue
            c, s, _full = parsed
            counter[(c, s)] += 1

    existing = existing_allow()
    proposals = {}  # pattern -> count (max across (cmd,sub) that yield same pattern)
    for (c, s), count in counter.most_common():
        if count < MIN_COUNT:
            break  # counter is ordered desc
        pattern = propose_pattern(c, s)
        if not pattern:
            continue
        if pattern in existing:
            continue
        # Keep the highest observed count for each pattern
        if pattern not in proposals or count > proposals[pattern]:
            proposals[pattern] = count

    if not proposals:
        return 0

    # Cap additions per run
    ranked = sorted(proposals.items(), key=lambda kv: -kv[1])[:MAX_NEW_ENTRIES]

    # Merge into SETTINGS
    data = load_json(SETTINGS) or {}
    perms = data.setdefault("permissions", {})
    allow = perms.setdefault("allow", [])
    seen = set(allow)
    added = []
    for pat, count in ranked:
        if pat in seen:
            continue
        allow.append(pat)
        seen.add(pat)
        added.append((pat, count))

    if not added:
        return 0

    SETTINGS.write_text(json.dumps(data, indent=2) + "\n")

    # Print to stderr so it shows in the hook output area, not injected as context.
    print(f"[perms-scan] added {len(added)} read-only allowlist entries to .claude/settings.json:",
          file=sys.stderr)
    for pat, count in added:
        print(f"  + {pat}  ({count} hits)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
