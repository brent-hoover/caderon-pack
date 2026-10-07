---
title: Markdown Review — agent wake-up, raw view, resizable sidebar — Implementation Plan
type: plan
status: approved
owner: Brent Hoover
created: 2026-10-07
updated: 2026-10-07
design: ./design.md
---

# Markdown Review — agent wake-up, raw view, resizable sidebar — Implementation Plan

## Overview

Server-side and watcher work comes first because it fixes the bug the operator hits most (feedback
never acted on) and is fully testable headless. The background-command lifetime check (1) needs no
code and starts first so its result is known before the watcher is built. Then: pin the server
behavior the watcher depends on and add the cmux ring (2), build the watcher on top of it (3), and
add `--max-wait` only if step 1 shows background commands expire (3b). Viewer work follows: the
Gherkin parser as a pure, unit-tested module (4) before the viewer code that renders it (5a–5c),
then the independent sidebar change (6). Docs and the version bump (7) come after behavior is final,
and an end-to-end run in cmux (8) closes it out. Server, watcher and parser steps are test-first
(failing test, then code); viewer steps are verified by hand in the cmux browser. Each code step is
one commit for roborev.

All paths below are relative to `plugins/core/skills/markdown-review/` unless they start with
`plugins/` or `scripts/sync-`. Tests run with `node --test tests/` (baseline 2026-10-07: 17 pass,
0 fail).

## Preconditions

- [x] problem.md and design.md approved by the operator (2026-10-07)
- [x] Worktree `.worktrees/markdown-review-feedback-loop` on `feat/markdown-review-feedback-loop`
- [x] Existing suite green: 17/17
- [x] roborev daemon running (v0.71.0)
- [x] Node ≥ 22 for the global `WebSocket` used by test helpers (local: v26.9.0)
- [x] Test framework: `node:test` (existing), with `Given … when … then …` scenario titles rather
  than a Gherkin runner — the skill is Node-only with no npm (problem.md constraints)

## Steps

### 1. Verify `run_in_background` lifetime

**Status:** ☐ (started 2026-10-07, 12-minute sleep running)

**What:** No code. A Bash `run_in_background` command sleeps 12 minutes then echoes; record whether
the session is re-invoked.

**Why:** Design risk "run_in_background commands don't expire" decides whether step 3b is needed.

**Verify:** Completion notification arrives after ≥ 12 min → step 3b skipped; result recorded in
design.md Risks. No notification / killed → do step 3b.

### 2. Server: pin append-by-path, add debounced cmux ring

**Status:** ☑ (3c5fbda; 21/21 tests; no ring on the operator's surface from the suite)

**What:** `scripts/server.cjs`, `tests/server.test.cjs`.

**Tasks:**

- [ ] Test helper `spawnServer(extraEnv)`: builds the child env from `process.env`, deletes
  `CMUX_SURFACE_ID` unless `extraEnv` sets it; both existing spawns (`before`, and the SIGTERM test)
  move onto it, so the existing suite never rings the operator's surface.
- [ ] Test helper `sendReviewEvent(event)`: opens Node's global `WebSocket` to the server with the
  session-key cookie and an allowed `Origin`, sends one JSON text frame, closes.
- [ ] Test: given `events` was renamed away, when a comment event is sent, then a new
  `state/events` file is created containing it.
- [ ] Test: given `CMUX_SURFACE_ID=test-surface` and `MDREVIEW_CMUX_BIN` = a stub script that
  appends its argv to a file, when three comments on `a.md` and an approve on `b.md` arrive < 2s
  apart, then the stub is called exactly once, between 1.8s and 3s after the last send, with
  `notify --surface test-surface --title "Review feedback" --body "3 comments, 1 approval on a.md,
  b.md" --desktop false`.
- [ ] Test: given `CMUX_SURFACE_ID` unset, when an event arrives, then the stub is not called within
  3s.
- [ ] Test: given the stub exits 1, when an event arrives, then `server.log` has a
  `cmux-notify-failed` line and the event is still in `events`.
- [ ] Implement in `handleMessage` per design §2 (`execFile`, no shell; `MDREVIEW_CMUX_BIN`).

**Why:** The ring is independent of the watcher and the smallest piece to land first. (The
append-by-path test was written for the earlier rename design; it stays as a harmless regression
check.)

**Verify:** `node --test tests/` — old and new tests pass; run inside cmux with no ring observed on
the operator's surface.

### 3. `wait-for-feedback.cjs`

**Status:** ☐

**What:** new `scripts/wait-for-feedback.cjs` (purpose: deliver a session's unread review events to
the agent once they settle), new `tests/wait-for-feedback.test.cjs`. Tests drive the script as a
child process against a temp session dir with hand-written `events` / `server-stopped` files; no
server needed.

**Tasks:**

- [ ] Tests (each `Given … when … then …`):
  - [ ] no `--session-dir` → exit 1, stderr names the missing flag
  - [ ] `--session-dir` without `state/` → exit 1, stderr names the dir
  - [ ] events written, quiet 2s → exit 0, stdout = those events, `events` unchanged,
    `events.cursor` = its byte length
  - [ ] second run after more events → stdout = only the new events
  - [ ] cursor already at end, no new events → still running after 3s (never re-delivers)
  - [ ] `events` shorter than the cursor (truncated) → cursor resets, all lines delivered
  - [ ] `--quiet-ms 500`, events written → exit 0 between 0.5s and 1.2s after the write
  - [ ] events written every 500ms for 3s → no exit until ≥ 2s after the last; one batch with all
  - [ ] empty / missing `events` → still running after 3s
  - [ ] `server-stopped` with `reason`, pending events inside the quiet window → exit 3, stdout =
    events then `{"type":"server-stopped","reason":…}`
  - [ ] `server-stopped`, no events → exit 3, only the stopped line
  - [ ] session `state/` dir deleted while waiting → exit 3,
    `{"type":"server-stopped","reason":"session-removed"}`
  - [ ] live watcher running → second one exits 4 with `already-watching` and the first's pid, and
    `watcher.pid` still names the first watcher
  - [ ] `watcher.pid` naming a dead pid → watcher starts normally and rewrites it
  - [ ] `--status` → `{"watching":true}` / `{"watching":false}` immediately
  - [ ] watcher exits 0, exits 3, or receives SIGTERM → `watcher.pid` removed
  - [ ] partial write: first half of a line (no `\n`) plus one complete line → only the complete
    line delivered, cursor stops before the partial one; after the rest is written, the next run
    delivers it
- [ ] Implement per design §1.

**Why:** Fixes problem 1 (feedback not acted on) — the core of the feature.

**Verify:** `node --test tests/` green; manual: in a scratch session, arm with `run_in_background`,
click Approve in a browser, the agent is re-invoked with the event in the output.

### 3b. (Conditional on step 1) `--max-wait`

**Status:** ☐ — only if step 1 shows background commands expire

**What:** `--max-wait <ms>` on the watcher: when it elapses with nothing claimed, print
`{"type":"max-wait"}`, remove `watcher.pid`, exit 5. Test in `tests/wait-for-feedback.test.cjs`.
Step 7's SKILL.md contract then adds "exit 5 → re-arm" and design.md's Interfaces table gains exit 5.

**Why:** Keeps the watcher's lifetime under whatever limit step 1 finds.

**Verify:** Test `--max-wait 500`, no events → exit 5 within 1s, pid file removed.

### 4. `gherkin.cjs` parser

**Status:** ☐

**What:** new `scripts/gherkin.cjs` (purpose: split Gherkin source into commentable blocks of typed
lines), new `tests/gherkin.test.cjs`, fixture `tests/fixtures/sample.feature`: preamble comments
before `Feature:`, feature description, tags, Background, Rule, Scenario, Scenario Outline with an
Examples table, a doc string containing `#`, comments between scenarios, one unrecognized line.

**Tasks:**

- [ ] Tests:
  - [ ] block kinds in order `preamble, feature, background, rule, scenario…`, with correct
    `startLine`s
  - [ ] `scenario` titles (text after the keyword), for Scenario and Scenario Outline
  - [ ] `Examples:` and its table lines stay inside the outline's block
  - [ ] tags and comments directly before a scenario attach to that scenario's block
  - [ ] line kinds: header line `keyword`, `Given/When/Then/And/But/*` lines `step`, `|` lines
    `table`, `@` lines `tag`, `#` lines `comment`, empty lines `blank`, `#` inside the doc string
    `docstring`, the unrecognized line `text`
  - [ ] joining every block's line texts with `\n` reproduces the source exactly
- [ ] Implement `parseGherkinBlocks` with guarded `module.exports`.

**Why:** Pure and testable in Node; the viewer only renders its output.

**Verify:** `node --test tests/` green.

### 5a. Viewer: renderer dispatch and Source view

**Status:** ☐

**What:** `scripts/viewer.js`, `scripts/viewer.html`.

**Tasks:**

- [ ] Renderer dispatch by extension (design §3 table); `.feature` uses Source until 5b.
- [ ] Source toggle button in the header for `.md` / `.feature`.
- [ ] Source view: numbered lines, per-line comment popover, events `view:"source"`, `line`,
  `quote` = line text.
- [ ] Rendered-view events gain `view:"rendered"`.
- [ ] `commented` keyed `path → view → Set`.

**Why:** Fixes problem 4 and makes non-markdown files readable as source.

**Verify:** `node --test tests/` green. Manual in the cmux browser, a session serving this feature's
`problem.md` and a `.txt`: `.txt` shows numbered source; `.md` toggles Source ↔ Rendered; one
comment per view lands in `events` with the fields in design's event table; markers stay on the
right element after toggling.

### 5b. Viewer: Gherkin view

**Status:** ☐

**What:** `scripts/viewer.html` (`<!-- GHERKIN_JS -->` placeholder, Gherkin styles),
`scripts/server.cjs` (`viewerPage()` injects `gherkin.cjs` text), `scripts/viewer.js` (render
blocks), `tests/server.test.cjs`.

**Tasks:**

- [ ] Test (server): `GET /` matches `parseGherkinBlocks` and does not match `<!-- GHERKIN_JS -->`
  (same pattern as the existing `MARKED_JS` / `VIEWER_JS` test).
- [ ] Render blocks per design §3; events `view:"gherkin"`, `blockIndex`, `line` (= `startLine`),
  `scenario`.

**Why:** Fixes problem 2 (`.feature` unreadable).

**Verify:** `node --test tests/` green. Manual in the cmux browser with `tests/fixtures/sample.feature`
and a copy of the operator's `debit-traceability.feature`: headers bold, step keywords accented,
tables as tables, comments muted, tags as chips; a scenario comment lands in `events` with
`scenario` and `line`; Source toggle round-trips.

### 5c. Viewer: titles and path tooltips

**Status:** ☐

**What:** `scripts/viewer.js` (`titleFor`, `title` attributes).

**Why:** Fixes problem 3's wrong titles and invisible full path.

**Verify:** Manual: the `.feature` sidebar title is its `Feature:` name; a `.txt` shows its file
name; hovering a sidebar item and the doc header shows the absolute path.

### 6. Viewer: resizable sidebar

**Status:** ☐

**What:** `scripts/viewer.html` (grid column var, handle element, styles), `scripts/viewer.js`
(pointer drag, clamp, `localStorage` with try/catch).

**Why:** Fixes problem 3's truncation.

**Verify:** Manual in the cmux browser: dragging below 180px or past 50% clamps; reload keeps the
width. Storage unavailable: in Chromium via Playwright, run
`Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked') } })` through an
init script, reload — the page loads at 260px with no console error from the viewer.

### 7. Docs and version

**Status:** ☐

**What:** `SKILL.md` (review loop per design §5 — plus exit 5 if step 3b ran — event fields,
description mentions `.feature` / non-markdown), skill `DESIGN.md` (feedback events, agent workflow,
out of scope), `server.cjs` comment in `handleMessage`, version 1.6.0 → 1.7.0 in
`plugins/core/.claude-plugin/plugin.json` and `plugins/core/.codex-plugin/plugin.json`.

**Why:** The agent-facing contract changed (no truncation; arm/re-arm; exit codes).

**Verify:**
- Read `SKILL.md` and skill `DESIGN.md` end to end for consistency with design.md;
  `rg -n truncat` in the skill dir returns only historical notes.
- `python3 scripts/sync-plugin-metadata.py --check --base-ref develop` (repo root) exits 0.
- `node --test tests/` green.

### 8. End-to-end in cmux

**Status:** ☐

**What:** No code. In a fresh Claude Code session in cmux with the plugin loaded from the worktree:
start a review of this feature's docs, let the agent arm the watcher, then from the browser:
(a) one Approve; (b) three comments within 2s; (c) a comment while the agent is mid-turn;
(d) `stop-server.sh` right after a comment.

**Why:** Problem criteria 2, 3, 4, 7 can only be observed end to end.

**Verify:** (a) agent turn starts ≤ 3s after the click and the pane rings; (b) exactly one agent
turn with all three; (c) acted on in the next turn, nothing lost (`state/events` matches what
was sent and `events.cursor` equals its size); (d) the agent receives the comment and the stopped reason, and does not
restart. Results recorded in this step.

## Rollback

Each code step is its own commit on `feat/markdown-review-feedback-loop`; nothing ships until merged
and the plugin version is bumped. To back out mid-way, revert the step commits on the branch.
Already running review servers are unaffected (they loaded the old scripts at start). If a released
version misbehaves, revert the merge and publish 1.7.1 with the 1.6.0 scripts; old events files
remain readable since all new fields are optional.

## Change log

- 2026-10-07: Initial draft (Brent Hoover)
- 2026-10-07: Plan-reviewer pass — `gherkin.cjs` (repo is ESM by default); lifetime check moved to
  step 1; conditional step 3b; WS sender + env-scrub helpers; timing tolerances; pid-file, SIGTERM
  and `--quiet-ms` tests; step 5 split into 5a–5c; exact sync-script check and codex manifest;
  storage-blocked check method; multi-doc ring body.
- 2026-10-07: Step 3 tests reworked for the read-cursor design (roborev job 3848).
