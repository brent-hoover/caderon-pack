---
name: markdown-review
description: Use when you have authored markdown documents (plans, designs, reports, analyses) that the user should read and give feedback on. Serves rendered docs to the user's browser with a multi-doc sidebar, live reload on edits, per-block inline comments, and an Approve button — instead of making the user read raw markdown in the worktree. Trigger phrases include "show me the doc", "let me review the plan", "render the report", "open it in the browser".
---

# Markdown Review

Serve agent-authored markdown to the user's browser for reading and feedback.
Docs are served from their real paths — edit them in place and the browser
live-reloads. User feedback (inline comments, doc-level comments, approvals)
lands in a JSONL events file you read on your next turn.

Commands below use `$SKILL_DIR` for this skill's base directory (shown as
"Base directory for this skill" when the skill loads).

## Starting a session

Start the server ONCE per session:

```bash
"$SKILL_DIR"/scripts/start-server.sh --project-dir /path/to/project --open
# -> {"type":"server-started","url":"http://localhost:PORT/?key=…",
#     "session_dir":"/path/to/project/.md-review/12345-1706000000",
#     "manifest":"…/manifest.json","state_dir":"…/state", …}
```

Save `session_dir` and `state_dir`. Pass the **project root** as
`--project-dir` so the session persists in `<project>/.md-review/` and a
restart reuses the same port (an open tab reconnects by itself). Remind the
user to gitignore `.md-review/` if it isn't. `--open` auto-opens the browser
when the first doc is added.

**The URL contains the session key (`?key=…`).** Always give the user the
complete URL — never a bare `http://host:port`. Requests without the key are
rejected.

If launched in the background without captured stdout, read
`<state_dir>/server-info` for the URL.

## Adding docs

```bash
node "$SKILL_DIR"/scripts/serve-doc.cjs --session-dir <session_dir> path/to/doc.md
```

- Add each doc you want reviewed; the sidebar lists them in add-order and the
  browser shows the newest one.
- Relative image references in a doc (`![](diagrams/arch.png)`) are served
  automatically if the image lives in the doc's directory tree.
- To remove a doc, edit `<session_dir>/manifest.json` (a JSON array of
  absolute paths) — the server picks it up within a second.

## The review loop

1. Add or edit docs (edit in place — the browser live-reloads).
2. Tell the user what's ready, share the URL, ask them to review in the
   browser and reply in the terminal. End your turn.
3. Next turn: read `<state_dir>/events` (JSONL). Merge with the user's
   terminal message — the terminal is primary. Then **truncate the events
   file** (`: > events`) so the next read starts clean; the server never
   clears it.
4. Apply feedback by editing the docs in place; iterate.

### Event format

```jsonl
{"type":"comment","doc":"/abs/path/plan.md","blockIndex":12,"quote":"first ~120 chars of the block","selection":"selected text or null","comment":"…","timestamp":1706000101000}
{"type":"comment","doc":"/abs/path/plan.md","scope":"doc","comment":"overall feedback","timestamp":1706000102000}
{"type":"approve","doc":"/abs/path/plan.md","timestamp":1706000103000}
```

Locate inline comments by grepping the `quote` text in the doc source
(`blockIndex` is a fallback — it counts top-level rendered blocks).

An `approve` event means the user signed off on that doc — but only if you
have not edited the doc after the approval's timestamp and no comments on it
follow it. In that case proceed without re-asking. If you edited the doc
after approval, the approval is stale; ask again.

## Health check (before every URL mention or doc push)

The server may have idle-timed out (default 4h). Check:
`<state_dir>/server-info` exists AND `<state_dir>/server-stopped` does not.
If it's down, restart with the same `--project-dir` — same port, the user's
open tab reconnects on its own; no need to re-share the URL.

## Cleaning up

```bash
"$SKILL_DIR"/scripts/stop-server.sh <session_dir>
```

Project sessions persist on disk (only `/tmp` sessions are deleted).

## Remote / container environments

If localhost isn't reachable from the user's browser:

```bash
start-server.sh --project-dir <root> --host 0.0.0.0 --url-host <reachable-hostname>
```

If your environment reaps background processes, add `--foreground` and run
it with your platform's background execution mechanism.
