---
name: markdown-review
description: Use when you have authored documents (markdown plans, designs, reports, analyses; Gherkin .feature files; other text files) that the user should read and give feedback on. Serves them to the user's browser — markdown rendered, .feature files as Gherkin, anything else as numbered source — with a multi-doc sidebar, live reload on edits, inline comments, and an Approve button; browser feedback wakes you automatically. Use instead of making the user read raw files in the worktree. Trigger phrases include "show me the doc", "let me review the plan", "render the report", "open it in the browser".
---

# Markdown Review

Serve agent-authored docs to the user's browser for reading and feedback.
Docs are served from their real paths — edit them in place and the browser
live-reloads. User feedback (inline comments, doc-level comments, approvals)
lands in a JSONL events file; a background watcher wakes you when it arrives.

How each doc is shown, by extension:
- `.md` / `.markdown` — rendered; the user can toggle to Source.
- `.feature` — Gherkin blocks (Feature, Background, Rule, each Scenario); the
  user can toggle to Source.
- anything else — numbered source lines.

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
2. Tell the user what's ready and share the URL. Tell them to leave comments,
   then click **Submit comments** (or **Approve**) when done — saved comments
   alone don't reach you.
3. **Arm the watcher**, then end your turn:
   ```bash
   node "$SKILL_DIR"/scripts/wait-for-feedback.cjs --session-dir <session_dir> --status
   # {"watching":false} -> arm it; {"watching":true} -> one is already running, skip
   node "$SKILL_DIR"/scripts/wait-for-feedback.cjs --session-dir <session_dir>
   # ^ run this one with Bash run_in_background
   ```
   The watcher exits when the user clicks Submit comments or Approve, which
   gives you a new turn with no terminal input. If you run inside cmux, the
   server also rings your cmux pane at that moment.
4. When it exits, act on its output (below), merged with anything the user
   typed in the terminal — the terminal is primary. Apply feedback by editing
   docs in place.
5. **Before ending every turn while the review is open, repeat step 3**
   (status check, then arm if not watching).

Never edit or truncate `<state_dir>/events` or `events.cursor`: `events` is
the session's append-only feedback history and the watcher tracks what you
have already been given. To re-read past feedback, read `events` directly.

### Watcher exit codes

| Exit | Output | What to do |
|------|--------|------------|
| 0 | new events, JSONL — the comments plus the `submit`/`approve` that sent them | Act on them, then re-arm. |
| 3 | new events (if any, including comments never submitted), then `{"type":"server-stopped","reason":…}` | Act on the events. Do **not** restart or re-arm in response: `idle timeout` / `owner process exited` mean the review was abandoned (tell the user); `signal` / `session-removed` mean it was stopped on purpose. Restart later only if you need to show docs again (see Health check). |
| 4 | `{"type":"already-watching","pid":N}` | Nothing — a watcher is already running. |
| 1 | error on stderr | Fix the command (e.g. wrong `--session-dir`). |

Only ever pass your own `session_dir`; a watcher on another agent's session
consumes that agent's feedback. A restarted server gets a **new**
`session_dir` — arm the watcher with the one from the restart output.

### Event format

```jsonl
{"type":"comment","doc":"/abs/path/plan.md","view":"rendered","blockIndex":12,"quote":"first ~120 chars of the block","selection":"selected text or null","comment":"…","timestamp":1706000101000}
{"type":"comment","doc":"/abs/path/plan.md","view":"source","line":42,"quote":"text of that line","selection":null,"comment":"…","timestamp":1706000101500}
{"type":"comment","doc":"/abs/path/a.feature","view":"gherkin","blockIndex":3,"line":28,"scenario":"Scenario name","quote":"Scenario: Scenario name","selection":null,"comment":"…","timestamp":1706000101800}
{"type":"comment","doc":"/abs/path/plan.md","scope":"doc","comment":"overall feedback","timestamp":1706000102000}
{"type":"approve","doc":"/abs/path/plan.md","timestamp":1706000103000}
{"type":"submit","timestamp":1706000104000}
```

A `submit` carries no content: it means "the comments before me are a
finished batch".

Locate an inline comment by `line` when present (1-based source line; for
Gherkin, the scenario/block header line), else by grepping `quote` in the
source, else by `blockIndex` (top-level rendered block for `rendered`, Gherkin
block for `gherkin`). Events without `view` come from older viewers — treat
them as `rendered`. Delivery is at-least-once: rarely, an event may be
delivered twice.

An `approve` event means the user signed off on that doc — but only if you
have not edited the doc after the approval's timestamp and no comments on it
follow it. In that case proceed without re-asking. If you edited the doc
after approval, the approval is stale; ask again.

## Health check (before every URL mention or doc push)

The server may have idle-timed out (default 4h). Check:
`<state_dir>/server-info` exists AND `<state_dir>/server-stopped` does not.
If it's down, restart with the same `--project-dir` — same port, the user's
open tab reconnects on its own; no need to re-share the URL. The restart
creates a **new** `session_dir`: re-add the docs with `serve-doc.cjs` and arm
the watcher on the new `session_dir`.

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
