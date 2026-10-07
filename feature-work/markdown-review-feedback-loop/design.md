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

A new `wait-for-feedback.cjs` script, run by the agent with Bash `run_in_background`, waits until the
session's `events` file holds a burst of browser feedback that has gone quiet for 2s, atomically
claims it by renaming the file, prints the claimed events, and exits — which gives the idle agent a
new turn. The agent re-arms it at the end of every turn unless one is already running. Separately,
the server rings the agent's cmux surface when feedback arrives, if it runs under cmux. In the
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
                 │                                 (rename → events.claimed-<ms>)
                 └── re-arms at end of turn (run_in_background), if none running
```

**One watcher per session.** On start the watcher creates `state/watcher.pid` with exclusive-create
(`fs.openSync(…, 'wx')`). If the file exists and names a live process, the watcher prints
`{"type":"already-watching","pid":N}` and exits 4. A pid file naming a dead process is stale: it is
replaced. The watcher removes its pid file on every exit path. So that the agent does not even start
a duplicate (whose immediate exit would itself wake the agent), `--status` runs in the foreground and
prints `{"watching":true|false}` without waiting; the agent checks it before arming.

**Wait loop**, polling every 250ms:

1. If `state/events` is non-empty and was last modified ≥ `--quiet-ms` (default 2000) ago → claim
   (below), print, exit 0.
2. Else if `state/server-stopped` exists → claim and print any non-empty `events` regardless of the
   quiet window, then print `{"type":"server-stopped","reason":<reason from server-stopped>}`,
   exit 3. Claiming first means feedback sent just before a stop is never dropped.
3. Otherwise keep polling.

**Claim**: `rename(events, events.claimed-<Date.now()>)`; ENOENT means another process got there
first or the file was never created — keep polling. After a successful rename, wait 200ms (lets an
append that opened the old inode just before the rename finish), read the claimed file, write it to
stdout.

Why rename instead of the current read-then-truncate: `server.cjs` calls
`fs.appendFileSync(path.join(STATE_DIR, 'events'), …)` per event, which opens the file by path every
time, so after a rename the next event creates a fresh `events`. Nothing written between "read" and
"clear" can be lost, and events that arrive mid-turn wait in the new file until the re-armed watcher
claims them (problem criteria 2–4).

`--session-dir` is required: the agent always knows its own session dir, and a "newest session"
default would let one agent claim another agent's events.

**Timing budget** (problem criterion 2, ≤ 3s after the last event): quiet window 2000ms + poll
≤ 250ms + settle 200ms = ≤ 2450ms, leaving ~550ms for Claude Code to re-invoke the agent. Raising
`--quiet-ms` above 2000 breaks the criterion.

### 2. cmux ring — `server.cjs`

In `handleMessage`, after appending a `comment` / `approve` event, if `process.env.CMUX_SURFACE_ID`
is set, (re)start a 2s debounce timer; when it fires, run one notify for the burst:

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

**Comment markers** are keyed by view: `commented: path → view → Set(index)`, where index is
`blockIndex` for `rendered` / `gherkin` and `line` for `source`. Today's `path → Set(blockIndex)`
would light up the wrong elements when switching views.

**Titles** (`titleFor`): `.md` → first `# ` heading as today; `.feature` → the `Feature:` name;
otherwise → file name. The sidebar item and doc header get `title="<absolute path>"` so the full
path shows on hover.

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
  - `reason` is `signal` → it was stopped deliberately; do not restart.
  - To continue a review later, restart with the same `--project-dir`: this creates a **new**
    `session_dir` (`start-server.sh` makes `<pid>-<epoch>` per start). Re-add docs and arm the
    watcher with the new `session_dir` from the restart output — never the old one.
- **Exit 4** (`already-watching`): nothing to do; do not re-arm.
- The "truncate the events file" step is removed; the agent never edits `events`.
- Locating a comment: `line` when present, else `quote` (grep the source), else `blockIndex`.
- Note for multi-agent projects: only ever pass your own `session_dir`.

### 6. Docs that change with this

- `SKILL.md`: review loop (§5), event format (new fields), description (mention `.feature` /
  non-markdown files).
- `DESIGN.md` (skill): "Feedback events" and "Agent workflow" sections (truncate contract → claim
  contract), "Out of scope" (syntax highlighting stays out; Gherkin rendering now in).
- `server.cjs` comment above the `appendFileSync` in `handleMessage` ("the agent truncates it after
  reading") → points to the watcher's rename claim.

## Interfaces

**CLI** — `node scripts/wait-for-feedback.cjs --session-dir <dir> [--quiet-ms <n>] [--status]`

| Exit | stdout | Meaning |
|------|--------|---------|
| 0 | claimed events, JSONL | feedback batch |
| 0 (`--status`) | `{"watching":true\|false}` | watcher liveness, no waiting |
| 3 | claimed events (if any), then `{"type":"server-stopped","reason":…}` | session's server stopped |
| 4 | `{"type":"already-watching","pid":N}` | another live watcher owns this session |
| 1 | — (stderr names the failure and input, e.g. `--session-dir is required`, `not an md-review session: <dir>`) | usage error |

**Event JSONL** — existing fields unchanged; new optional fields on `comment` events:

| Field | Set when | Meaning |
|-------|----------|---------|
| `view` | always, by new viewers | `rendered`, `source` or `gherkin`; absent on old events — read as `rendered` |
| `line` | `view` is `source` (the clicked line) or `gherkin` (the block's `startLine`) | 1-based line number in the source file |
| `scenario` | `view` is `gherkin` and the block kind is `scenario` | text after the keyword, e.g. `Each corpse's record carries its own reason` |
| `blockIndex` | `view` is `rendered` or `gherkin` | index of the top-level rendered block (`rendered`) or of the Gherkin block (`gherkin`) |

```jsonl
{"type":"comment","doc":"/abs/a.feature","view":"gherkin","blockIndex":3,"line":28,"scenario":"Each corpse's record carries its own reason","quote":"Scenario: Each corpse's record…","selection":null,"comment":"…","timestamp":…}
{"type":"comment","doc":"/abs/plan.md","view":"source","line":42,"quote":"- step text","selection":null,"comment":"…","timestamp":…}
{"type":"comment","doc":"/abs/plan.md","view":"rendered","blockIndex":12,"quote":"…","selection":null,"comment":"…","timestamp":…}
```

**Environment** — `MDREVIEW_CMUX_BIN` (default `cmux`): binary used for the ring. `CMUX_SURFACE_ID`:
inherited; enables the ring.

HTTP routes and WebSocket messages: unchanged.

## Data model

- `state/events` — unclaimed events (JSONL).
- `state/events.claimed-<epoch-ms>` — one file per claimed batch. Never auto-deleted; they live and
  die with the session dir (project sessions persist until the operator deletes `.md-review/`;
  `/tmp` sessions are removed by `stop-server.sh`), so growth is bounded per session.
- `state/watcher.pid` — pid of the live watcher; absent when none.
- Browser `localStorage['mdreview-sidebar-width']` — integer px.
- Per-doc view choice — in-memory in the viewer; resets on reload.

## Alternatives considered

### Simplest

`SKILL.md` tells the agent to background `until [ -s events ]; do sleep 1; done`, keep the
read-then-truncate step, show non-`.md` in a `<pre>`, and add CSS `resize: horizontal` to the
sidebar. Drawbacks: wakes on the first click of a burst; events written between read and truncate
are lost; hangs forever if the server stops; `.feature` stays raw text with no per-scenario
comments; no way to anchor a comment to a line.

### Complete

The chosen design above: single claiming watcher with quiet-window debounce and server-stopped
handling; file-type renderers including a small Gherkin renderer; source view with line comments;
drag-resize sidebar; optional debounced cmux ring from the server.

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

- **Rename race** — an append that opened `events` just before the rename lands in the claimed file
  after the read. Mitigated by the 200ms settle. Tested by simulation: the test opens an fd on
  `events` (standing in for an in-flight `appendFileSync`), lets the watcher rename it, writes
  through the held fd within the settle window, and asserts the watcher's stdout includes that
  write.
- **Agent forgets to re-arm** — the next batch is not acted on until the operator types (today's
  behavior). Mitigated by making status-check-then-arm an explicit end-of-turn step in `SKILL.md`;
  the cmux ring still alerts the operator.
- **Stale pid file after a hard kill** — handled: a pid file naming a dead process is replaced.
  PID reuse by an unrelated live process would make the watcher wrongly report `already-watching`;
  accepted as unlikely within one review.
- **Assumption: server reopens `events` by path per append** — true of `appendFileSync(path)`
  today; a server test pins it (rename `events`, send an event, assert a new `events` file appears).
- **Assumption: `run_in_background` commands don't expire** — documented as "keeps running across
  turns"; not stated for long durations. Verified with a ≥10-minute run during implementation; if it
  expires, the watcher gets a `--max-wait` and the agent re-arms on timeout.
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
- Automatic cleanup of claimed event files

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
