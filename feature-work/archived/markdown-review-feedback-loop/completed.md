---
title: Markdown Review — agent wake-up, raw view, resizable sidebar — Completion Record
type: notes
status: active
owner: Brent Hoover
created: 2026-10-08
updated: 2026-10-08
---

# Markdown Review — agent wake-up, raw view, resizable sidebar — Completion Record

Handoff manifest for everything shipped as part of this feature. Authoritative record of what
is now in the codebase as a result of this work.

## What shipped

The markdown-review skill (caderon-pack `core` 1.6.0 → 1.7.0, merged as PR #10, merge commit
`88c88fa` on `develop`) now wakes the agent when the operator acts in the browser:
- The agent arms `wait-for-feedback.cjs` with `run_in_background`.
- The watcher exits when the operator clicks **Submit comments** or **Approve** on a doc, and prints
  that doc's undelivered comments plus the trigger.
- Saving a comment alone never wakes the agent.
- Submit is per doc.

Inside cmux, the server also rings the agent's pane on each submit or approve.

Saved comments stay visible as *pending*/*sent* cards. The cards are rebuilt from `GET /events`.

Docs are rendered by extension:
- `.md` is rendered, with a Source toggle.
- `.feature` is shown as Gherkin blocks, with a Source toggle.
- Anything else is shown as numbered source with per-line comments.

The sidebar is drag-resizable. Titles come from the `Feature:` name or the file name, and the full
path shows as a tooltip.

## New modules / files

All under `plugins/core/skills/markdown-review/` unless noted.

- `scripts/wait-for-feedback.cjs`: background watcher that delivers a session's submitted feedback
  to the agent.
  - Reads the append-only `state/events` past `state/events.cursor`.
  - Holds one watcher per session through `watcher.pid`.
  - Has a `--status` flag.
  - Exit codes: 0 delivered, 3 server stopped, 4 already watching, 1 usage error.
- `scripts/gherkin.cjs`: `parseGherkinBlocks(source)` splits Gherkin into commentable blocks of
  typed lines. It is `.cjs` because the repo root `package.json` is `"type": "module"`.
- `tests/wait-for-feedback.test.cjs`: watcher tests.
- `tests/gherkin.test.cjs`: parser tests.
- `tests/fixtures/sample.feature`: Gherkin fixture used by the parser tests.
- `feature-work/README.md` (repo root): doc-flow README.
- `feature-work/markdown-review-feedback-loop/{problem,design,plan}.md`: this feature's docs.

## Modified files

- `scripts/server.cjs`:
  - Records `submit` events, which carry `doc`.
  - Adds `GET /events` (session key required; returns complete lines only).
  - Runs `cmux notify` on submit/approve, with per-doc comment tallies.
  - Injects `gherkin.cjs` into the viewer page.
- `scripts/viewer.js`, `scripts/viewer.html`:
  - Renderer dispatch: rendered, source and gherkin views.
  - View toggle.
  - Per-doc **Submit comments (N)** button. The doc-level button is relabelled "Add comment".
  - Comment cards, re-anchored occurrence-first, then nearest position. Cards that can't be placed
    go in the doc-level list.
  - Open drafts survive re-renders.
  - Drag-resizable sidebar, clamped to 180px–50vw and stored in `localStorage`.
  - `titleFor` uses the `Feature:` name and adds path tooltips.
- `tests/server.test.cjs`:
  - `spawnServer` scrubs `CMUX_SURFACE_ID`.
  - `sendReviewEvent` sends events over WebSocket.
  - New tests for `/events`, the ring and the gherkin injection.
- `SKILL.md`:
  - Arm/re-arm contract and watcher exit-code table.
  - Rule never to edit or truncate `events` / `events.cursor`.
  - Event format with `view`, `line`, `scenario` and `occurrence`, and `submit` with `doc`.
- `DESIGN.md` (skill): feedback events and agent workflow updated to match.
- `plugins/core/.claude-plugin/plugin.json`, `plugins/core/.codex-plugin/plugin.json`: version 1.7.0.

## Dependencies added

- None. The skill still uses only Node built-ins, plus the vendored `marked`. The tests use Node's
  global `WebSocket` (Node ≥ 22).

## Interface changes

- **Agent contract (SKILL.md):**
  - The agent must arm the watcher, after checking `--status`, before ending every turn while a
    review is open.
  - The agent must never truncate `state/events`. Before this change, the agent was told to read and
    truncate `state/events`.
- **Event format:**
  - Comment events gain optional `view` (`rendered`/`source`/`gherkin`), `line`, `scenario` and
    `occurrence`.
  - New `{"type":"submit","doc":…}` event.
  - Events without `view` are treated as `rendered`, so old events files stay readable.
  - If an agent still on the old contract truncates `events` below the cursor, the watcher resets
    the cursor to 0 (`effectiveCursor()`).
- **New state files**, both created with mode 0600:
  - `state/events.cursor`: byte offset of what has been delivered.
  - `state/watcher.pid`.
- **HTTP:** `GET /events` returns the session's events as a JSON array. Like every other route, it
  needs the session key or the session cookie.
- **Watcher CLI:** `wait-for-feedback.cjs --session-dir <dir> [--status]`.
  - `--status` prints `{"watching":true|false}` and exits 0.
  - Exit 0: prints the submitted docs' comments plus the `submit`/`approve` event as JSONL.
  - Exit 3: prints any undelivered events, then `{"type":"server-stopped","reason":…}`. The reason
    is `idle timeout`, `owner process exited`, `signal` or `session-removed`.
  - Exit 4: prints `{"type":"already-watching","pid":N}`.
  - Exit 1: prints a usage error on stderr.

## Configuration changes

- `CMUX_SURFACE_ID` is read from the server's environment, where cmux sets it. When it is unset, the
  server doesn't ring anything.
- `MDREVIEW_CMUX_BIN` (default `cmux`) overrides the notify binary. It is a test seam.

## Known issues / follow-ups

Limitations the operator accepted on 2026-10-07 for a single-user tool (details in `design.md`
Risks):
- **Concurrent stale-lock recovery:** two watchers started at the same instant on a dead pid can
  both take the lock.
- **`/tmp` sessions:** if `stop-server.sh` deletes a `/tmp` session, feedback not yet delivered is
  lost. A delete mid-delivery can exit 0 or 1 instead of 3.
- **Repeated quotes:** card placement for identical text is a heuristic. Editing or deleting an
  earlier identical copy moves the card to the next copy.

Other known behavior:
- **Duplicate delivery:** delivery is at-least-once, so an event can be delivered twice if the
  watcher is killed between printing and saving the cursor.
- **Unsubmitted comments:** comments that are never submitted reach the agent only when the server
  stops (exit 3).
- **`run_in_background` lifetime:** verified to 12 minutes. Longer runs are untested, and the
  end-of-turn `--status` check re-arms a lost watcher.
- **Cancel bug:** a Cancel bug the operator saw earlier could not be reproduced and was dropped at
  their call.

## Deferred work

none

## Next steps

- No owned follow-up work.

## Change log

- 2026-10-07: Merged as PR #10. Codex synced to core 1.7.0 with
  `codex plugin marketplace upgrade caderon-pack`.
- 2026-10-08: Skill `DESIGN.md` file-tree line for the watcher corrected (it still said events are
  delivered "once they settle").
- 2026-10-08: Completed (Brent Hoover)
