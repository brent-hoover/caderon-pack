---
title: Markdown Review — agent wake-up, raw view, resizable sidebar — Design
type: design
status: approved
owner: Brent Hoover
created: 2026-10-07
updated: 2026-10-07
problem: ./problem.md
---

# Markdown Review — agent wake-up, raw view, resizable sidebar — Design

## Summary

Comments saved in the browser are recorded but do not wake the agent; the operator ends a batch
with **Submit comments** or **Approve**. A new `wait-for-feedback.cjs` script, run by the agent with
Bash `run_in_background`, waits until the session's `events` file holds an unread `submit` or
`approve` event, prints every unread event, advances a read cursor past them, and exits — which gives
the idle agent a new turn. The agent re-arms it at the end of every turn unless one is already running. Separately,
the server rings the agent's cmux surface on submit or approve, if it runs under cmux. Saved
comments stay visible in the viewer as cards marked pending or sent, rebuilt from `events` on load. In the
viewer, each doc is rendered by file type — markdown via `marked` (with a Source toggle), `.feature`
via a new line-based Gherkin renderer, anything else as numbered source lines — and the sidebar gets
a drag handle and full-path tooltips.

## Approach

### 1. Waking the agent — `scripts/wait-for-feedback.cjs`

```
browser ──ws──▶ server.cjs ──appendFileSync──▶ state/events
                    │                              │
                    └─▶ cmux notify (if in cmux)   │ poll 250ms
                                                   ▼
               agent ◀── exits, stdout = batch ── wait-for-feedback.cjs
                 │                                 (advances state/events.cursor)
                 └── re-arms at end of turn (run_in_background), if none running
```

**One watcher per session.** On start the watcher writes its pid to a private temp file and
hard-links it to `state/watcher.pid` (`link` fails if the file exists, and the file is never seen
without its pid). If `watcher.pid` names a live process, the watcher prints
`{"type":"already-watching","pid":N}` and exits 4. An empty pid file or one naming a dead process
can only be left by a killed watcher: it is replaced. The watcher removes its pid file on every exit path. So that the agent does not even start
a duplicate (whose immediate exit would itself wake the agent), `--status` runs in the foreground and
prints `{"watching":true|false}` without waiting; the agent checks it before arming.

**Read cursor.** `events` is append-only and is never moved, truncated or edited by the watcher or
the agent. `state/events.cursor` holds the byte offset up to which events have been delivered
(absent = 0). *Unread events* are the complete lines (terminated by `\n`) between the cursor and the
end of the file; a trailing partial line is left for the next read. If `events` is shorter than the
cursor (truncated by an agent following the pre-1.7 contract), the cursor resets to 0.

**Wait loop**, polling every 250ms:

1. If `state/` no longer exists — checked at the start of each poll, and on any ENOENT during one —
   → print `{"type":"server-stopped","reason":"session-removed"}`,
   exit 3. (`stop-server.sh` deletes `/tmp/md-review-*` session dirs; without this the watcher would
   poll forever.)
2. If the unread events include a `submit` or `approve` event → deliver the unread events up to and
   including the **last** trigger, exit 0. Comments saved after it belong to the next batch and keep
   waiting (roborev jobs 3866, 3867).
3. Else if `state/server-stopped` holds a complete JSON marker → deliver any unread events
   (even with no trigger among them), then print
   `{"type":"server-stopped","reason":<reason from server-stopped>}`, exit 3. The marker is checked
   *before* events are read (the server appends its last events before writing the marker), and a
   half-written marker counts as "not stopped yet", so feedback sent just before a stop is never
   dropped.
4. Otherwise keep polling.

**Deliver**: write the unread lines to stdout, then save the new offset by writing
`events.cursor.tmp` and renaming it over `events.cursor` (atomic). Printing before saving makes
delivery at-least-once: if the watcher dies between the two, the next watcher re-delivers that batch
rather than losing it.

Why a cursor rather than the current read-then-truncate, or claiming by renaming the file: truncation
loses anything appended between the read and the truncate; a rename loses an append that opened the
old file just before the rename but wrote after the claimed copy was read (no settle delay can bound
a stalled writer). With a cursor nothing is ever moved or cleared, so a late or partial write is
simply read on the next wake, and events that arrive mid-turn wait past the cursor until the re-armed
watcher delivers them (problem criteria 2–4).

`--session-dir` is required: the agent always knows its own session dir, and a "newest session"
default would let one agent consume another agent's events.

**Timing budget** (problem criterion 2, ≤ 1s after submit/approve): poll ≤ 250ms, leaving ~750ms
for Claude Code to re-invoke the agent.

*Revised 2026-10-07 after the end-to-end run:* the first version woke the agent once events had
been quiet for 2s. Real review comments are 10–30s apart (each takes time to write), so it woke the
agent after every comment and the agent started editing mid-review. The operator now decides when a
batch is done.

### 2. cmux ring — `server.cjs`

In `handleMessage`, `comment` events are tallied (count and doc basenames) since the last ring. On a
`submit` or `approve` event, if `process.env.CMUX_SURFACE_ID` is set, the server rings once with the
tally and resets it:

```
cmux notify --surface $CMUX_SURFACE_ID --title "Review feedback" \
            --body "<N comments[, M approvals]> on <doc basenames, comma-separated>" --desktop false
```

`--desktop false` keeps the entry in cmux's Notifications panel, sidebar badge and pane ring without
a macOS banner (`cmux notify --help`). Verified 2026-10-07: the command exits 0 and returns
`{"id","surface_id","workspace_id"}` for this session's surface. Run via `child_process.execFile`
(no shell — the body contains user text). The binary is `process.env.MDREVIEW_CMUX_BIN || 'cmux'`,
a test seam in the style of the existing `MDREVIEW_OPEN_CMD`. A non-zero exit or spawn error is
logged to `server.log` as `{"type":"cmux-notify-failed","error":…}` and otherwise ignored — the ring
is optional (problem criterion 7). The server inherits `CMUX_SURFACE_ID` from the agent's shell via
`start-server.sh` (verified 2026-10-07 on a live server process's environment).

Tests: `tests/server.test.cjs` spawns the server with `{ ...process.env, … }`; it will delete
`CMUX_SURFACE_ID` from the child env unless a test sets it deliberately, so running the suite inside
cmux never rings the operator's surface.

### 3. Viewer — renderer by file type

`viewer.js` picks a renderer from the doc path's extension:

| Extension | Default view | Comment unit | Event `view` |
|-----------|--------------|--------------|--------------|
| `.md`, `.markdown` | rendered (`marked`); header button toggles **Source** | top-level block / line in Source | `rendered` / `source` |
| `.feature` | Gherkin; header button toggles **Source** | Gherkin block (below) / line in Source | `gherkin` / `source` |
| anything else | source | line | `source` |

**Source view**: a two-column table — line number, verbatim line text (`white-space: pre`,
monospace). Clicking a line opens the existing comment popover; the event carries `line` and uses
the line text as `quote`.

**Gherkin view**: `scripts/gherkin.cjs` exports one pure function,
`parseGherkinBlocks(source) → Block[]`, where
`Block = { kind, title, startLine, lines: Line[] }` and `Line = { kind, text, lineNo }`.

- Block kinds: `preamble` (anything before `Feature:`), `feature` (header + description),
  `background`, `rule`, `scenario` (covers `Scenario:`, `Example:`, `Scenario Outline:`,
  `Scenario Template:`; its `Examples:` sections and tables stay inside it).
- Line kinds by first token: `keyword` (block header), `step`
  (`Given/When/Then/And/But/*`), `table` (`|`), `docstring` (between `"""` or ```` ``` ```` fences —
  so `#` inside is not a comment), `tag` (`@`), `comment` (`#`), `text`, `blank`.
- Leading tags and comments attach to the following block. Lines matching no kind are `text` —
  nothing is dropped.

`viewer.js` renders each block as one commentable `.block`: header line bold, step keyword in accent
color, consecutive `table` lines as a real `<table>`, `comment` lines muted, tags as small chips.

`gherkin.cjs` is injected into the page like `viewer.js` (new `<!-- GHERKIN_JS -->` placeholder in
`viewer.html`, new split/join in `viewerPage()`) and is also `require`-able from Node tests; it ends
with a `typeof module !== 'undefined'` guarded `module.exports` so one file serves both.

**Comment markers** are per view: a comment made in Source marks a line, not the rendered block with
the same index (see *Comment cards* below, which now carry this).

**Titles** (`titleFor`): `.md` → first `# ` heading as today; `.feature` → the `Feature:` name;
otherwise → file name. The sidebar item and doc header get `title="<absolute path>"` so the full
path shows on hover.

**Submit comments**: a header button, `Submit comments (N)`, where N counts comments saved since the
last submit or approve (all docs). Disabled at 0. Click → `{"type":"submit"}` event; N resets.
Approve also marks pending comments as sent (the watcher delivers them with the approve).

**Comment cards**: every saved comment is shown as a card — inline right after the element it
comments on (block, source line, or Gherkin block; several cards stack), doc-level comments in a list
above the footer box. Each card shows the comment text, the selection if any, and a *pending* /
*sent* badge. A comment is *sent* iff a `submit` or `approve` event comes after it in `events`.
Cards render only in the view the comment was made in. A card attaches to the element whose text
still matches the comment's `quote` (preferring its original `blockIndex`/`line`), so cards follow
their text when the agent edits the doc; if no element matches any more, the card moves to the
doc-level list marked "Commented text has changed" (roborev job 3866).

On load the viewer fetches `GET /events` and rebuilds the cards and the pending count from it, so
they survive reloads and server restarts within a session. After that it updates them locally as
the operator comments or submits. The per-view comment-marker map (`commented`) is replaced by this
card list, which also drives the `commented` class.

### 4. Viewer — resizable sidebar

`body`'s first grid column becomes `var(--sidebar-w, 260px)`. A 6px drag handle on the sidebar's
right edge uses pointer events to set `--sidebar-w`, clamped to `[180px, 50vw]`. On release the
width is saved to `localStorage['mdreview-sidebar-width']` and restored on load; storage access is
wrapped in try/catch because it can be unavailable, and the default width is used then.

### 5. SKILL.md contract

- After sharing the URL: run `wait-for-feedback.cjs --session-dir <session_dir> --status`; if
  `watching` is false, start `wait-for-feedback.cjs --session-dir <session_dir>` with
  `run_in_background`, then end the turn.
- **Woken with exit 0**: stdout is the feedback batch — act on it (merged with any terminal
  message), then before ending the turn repeat the status-check-then-arm step while the review is
  open.
- **Exit 3**: act on any events printed before the `server-stopped` line. Then:
  - `reason` is `idle timeout` or `owner process exited` → the review was abandoned; do not restart
    or re-arm. Tell the operator.
  - `reason` is `signal` or `session-removed` → it was stopped deliberately; do not restart.
  - To continue a review later, restart with the same `--project-dir`: this creates a **new**
    `session_dir` (`start-server.sh` makes `<pid>-<epoch>` per start). Re-add docs and arm the
    watcher with the new `session_dir` from the restart output — never the old one.
- **Exit 4** (`already-watching`): nothing to do; do not re-arm.
- The "truncate the events file" step is removed; the agent never edits `events` or
  `events.cursor`. To re-read past feedback, read `events` directly.
- Locating a comment: `line` when present, else `quote` (grep the source), else `blockIndex`.
- Note for multi-agent projects: only ever pass your own `session_dir`.

### 6. Docs that change with this

- `SKILL.md`: review loop (§5), event format (new fields), description (mention `.feature` /
  non-markdown files).
- `DESIGN.md` (skill): "Feedback events" and "Agent workflow" sections (truncate contract → read
  cursor), "Out of scope" (syntax highlighting stays out; Gherkin rendering now in).
- `server.cjs` comment above the `appendFileSync` in `handleMessage` ("the agent truncates it after
  reading") → says `events` is append-only and the watcher tracks a read cursor.

## Interfaces

**CLI** — `node scripts/wait-for-feedback.cjs --session-dir <dir> [--status]`

| Exit | stdout | Meaning |
|------|--------|---------|
| 0 | unread events, JSONL (ends with a `submit` or `approve`) | feedback batch |
| 0 (`--status`) | `{"watching":true\|false}` | watcher liveness, no waiting |
| 3 | unread events (if any), then `{"type":"server-stopped","reason":…}` | session's server stopped, or its dir was removed (`reason: "session-removed"`) |
| 4 | `{"type":"already-watching","pid":N}` | another live watcher owns this session |
| 1 | — (stderr names the failure and input, e.g. `--session-dir is required`, `not an md-review session: <dir>`) | usage error |

**Event JSONL** — existing fields unchanged; new optional fields on `comment` events:

| Field | Set when | Meaning |
|-------|----------|---------|
| `view` | always, by new viewers | `rendered`, `source` or `gherkin`; absent on old events — read as `rendered` |
| `line` | `view` is `source` (the clicked line) or `gherkin` (the block's `startLine`) | 1-based line number in the source file |
| `scenario` | `view` is `gherkin` and the block kind is `scenario` | text after the keyword, e.g. `Each corpse's record carries its own reason` |
| `blockIndex` | `view` is `rendered` or `gherkin` | index of the top-level rendered block (`rendered`) or of the Gherkin block (`gherkin`) |

New event type, sent by the Submit button:

```jsonl
{"type":"submit","timestamp":…}
```

```jsonl
{"type":"comment","doc":"/abs/a.feature","view":"gherkin","blockIndex":3,"line":28,"scenario":"Each corpse's record carries its own reason","quote":"Scenario: Each corpse's record…","selection":null,"comment":"…","timestamp":…}
{"type":"comment","doc":"/abs/plan.md","view":"source","line":42,"quote":"- step text","selection":null,"comment":"…","timestamp":…}
{"type":"comment","doc":"/abs/plan.md","view":"rendered","blockIndex":12,"quote":"…","selection":null,"comment":"…","timestamp":…}
```

**Environment** — `MDREVIEW_CMUX_BIN` (default `cmux`): binary used for the ring. `CMUX_SURFACE_ID`:
inherited; enables the ring.

**HTTP** — new `GET /events` (same session-key auth as every route): the session's `events` file as
a JSON array of the parsed complete lines; `[]` if the file doesn't exist. Read-only. WebSocket
messages: unchanged.

## Data model

- `state/events` — every event of the session, append-only JSONL. Never cleared; it lives and dies
  with the session dir (project sessions persist until the operator deletes `.md-review/`; `/tmp`
  sessions are removed by `stop-server.sh`), so growth is bounded per session.
- `state/events.cursor` — decimal byte offset into `events` up to which events were delivered;
  absent = 0.
- `state/watcher.pid` — pid of the live watcher; absent when none.
- Browser `localStorage['mdreview-sidebar-width']` — integer px.
- Per-doc view choice — in-memory in the viewer; resets on reload.
- Comment cards and the pending count — derived from `GET /events`; no new storage.

## Alternatives considered

### Simplest

`SKILL.md` tells the agent to background `until [ -s events ]; do sleep 1; done`, keep the
read-then-truncate step, show non-`.md` in a `<pre>`, and add CSS `resize: horizontal` to the
sidebar. Drawbacks: wakes on the first click of a burst; events written between read and truncate
are lost; hangs forever if the server stops; `.feature` stays raw text with no per-scenario
comments; no way to anchor a comment to a line.

### Complete

The chosen design above: single watcher with a read cursor that wakes on submit/approve, with
server-stopped handling; comment cards rebuilt from `events`; file-type renderers including a small
Gherkin renderer; source view with line comments; drag-resize sidebar; optional cmux ring from the
server.

### Optimal

A native Claude Code push channel: the server delivers each feedback batch straight into the agent's
session as a new turn — no watcher process, no re-arm discipline, no polling. Not available: the
closest existing mechanism, the `Monitor` tool (WebSocket or command source), caps deadlines at
30 minutes so long reviews need constant re-arming, would put the session key in the Monitor URL,
delivers per click rather than per burst, and is a deferred tool not guaranteed in every
environment.

### Decision

Complete. The concurrency and failure-mode drivers — bursts, mid-turn arrivals, never re-firing on
read events, never dropping events — rule out Simplest, whose read-then-truncate gap and first-click
wake fail criteria 2–4. No native push channel exists, and `Monitor`'s 30-minute cap and per-click
delivery keep us below Optimal.

## Risks

- **Concurrent stale-lock recovery (accepted)** — two watchers started at the same instant, both
  finding the same dead pid, can both take the lock. The agent's `--status`-then-arm sequence never
  starts two at once. (roborev jobs 3853, 3856)
- **Duplicate delivery** — delivery is at-least-once: a watcher killed between printing and saving
  the cursor re-delivers that batch next time. The agent may see an event twice; it never misses one.
- **Partial writes** — a line still being written when the watcher reads has no trailing `\n` yet;
  it stays past the cursor and is delivered on the next wake. Tested by writing a line in two halves
  around a watcher run.
- **Throwaway sessions** — feedback not yet delivered when `stop-server.sh` deletes a `/tmp`
  session dir is lost with the dir; a deletion while the watcher is saving its cursor (after
  printing) exits 0 or 1 instead of 3. Accepted: `/tmp` sessions are throwaway, and this is a
  single-user tool — the operator accepts multi-process race edge cases (2026-10-07, roborev
  job 3858).
- **Unsubmitted comments** — comments the operator never submits (no Submit, no Approve) are not
  delivered while the server runs; they are delivered when it stops (exit 3) and stay visible as
  *pending* cards meanwhile.
- **`GET /events` exposes comment text** — to anyone holding the session key, who can already write
  events; no new exposure.
- **Agent forgets to re-arm** — the next batch is not acted on until the operator types (today's
  behavior). Mitigated by making status-check-then-arm an explicit end-of-turn step in `SKILL.md`;
  the cmux ring still alerts the operator.
- **Stale pid file after a hard kill** — handled: a pid file naming a dead process is replaced.
  PID reuse by an unrelated live process would make the watcher wrongly report `already-watching`;
  accepted as unlikely within one review.
- **Assumption: `run_in_background` commands don't expire** — documented as "keeps running across
  turns". Verified 2026-10-07: a 12-minute background command completed and re-invoked the session.
  Longer reviews are untested; if a watcher is ever killed, the agent's end-of-turn status check
  re-arms it at the next turn.
- **Gherkin edge cases** (`Scenario Outline`, `Rule`, `#` inside doc strings, comments between
  scenarios) — covered by `gherkin.cjs` unit tests on fixtures; unknown lines render as `text`.
- **Trust model** — comment text now starts agent turns without passing through the terminal
  (problem.md, cross-cutting). The existing session-key auth and WebSocket origin check are the gate
  and are unchanged; no new route is added.

## Out of scope

- Non-English Gherkin keywords (`# language:`), strict Gherkin parsing / validation
- Syntax highlighting for code or other languages
- Editing in the browser; comment threading / resolution
- Typing prompts into the operator's terminal (cmux doorbell / `cmux send`)
- Sidebar width syncing across browsers or machines
- Pushing events via `Monitor` (see Optimal)
- Automatic cleanup of `events` within a session

## Open questions

- [ ] None blocking implementation.

## Change log

- 2026-10-07: Initial draft (Brent Hoover)
- 2026-10-07: Design-reviewer pass — one-watcher-per-session (pid file, `--status`, exit 4);
  claim-before-stop ordering; exit-3 restart rules (new session dir, no restart on idle/owner
  exit); `MDREVIEW_CMUX_BIN` test seam and env scrubbing; verified cmux notify; event field table;
  per-view comment markers; `--session-dir` required (dropped shared resolver); timing budget;
  rename-race test described; docs-to-update list; Optimal reframed as native push.
- 2026-10-07: Plan-reviewer pass — parser file is `gherkin.cjs` (repo root `package.json` is
  `"type": "module"`, so a `.js` file would load as ESM in Node tests); ring body covers bursts
  spanning several docs.
- 2026-10-07: roborev (job 3848) — replaced the rename claim with an append-only `events` + read
  cursor (a stalled writer could lose an event after the 200ms settle); delivery is at-least-once;
  watcher exits 3 `session-removed` when a `/tmp` session dir is deleted. Approved by operator.
- 2026-10-07: roborev (jobs 3853, 3856) — lock published by hard link (no empty pid file; empty or
  dead-pid lock is replaced); stop marker checked before reading events and a partial marker means
  "not yet"; ENOENT mid-poll routes to `session-removed`. Concurrent stale-lock recovery accepted.
- 2026-10-07: End-to-end findings (operator decision) — wake on `submit`/`approve` only (quiet
  window and `--quiet-ms` removed; ring on submit/approve, no debounce); Submit comments button;
  comment cards with pending/sent, rebuilt from new `GET /events`.
- 2026-10-07: roborev (3863, 3865–3867) — deliver only through the last trigger; cards anchored by
  quote with an orphan fallback; Gherkin escapes parsed sequentially; sidebar re-clamped on resize
  and on cancelled drags.
