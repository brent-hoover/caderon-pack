---
title: Markdown Review — agent wake-up, raw view, resizable sidebar — Problem Statement
type: problem
status: approved
owner: Brent Hoover
created: 2026-10-07
updated: 2026-10-07
---

# Markdown Review — agent wake-up, raw view, resizable sidebar — Problem Statement

## User Story (must fill out first)
As a: operator reviewing agent-authored docs (markdown feature docs and Gherkin `.feature` scenarios) in the markdown-review browser viewer

I want to: read every doc legibly, find it in the sidebar, and have my browser Approve / comments acted on without returning to the terminal

So that I can: complete a review entirely in the browser and have the agent pick up my feedback immediately

## Context

The `markdown-review` skill (caderon-pack `plugins/core/skills/markdown-review/`, core v1.6.0) serves
agent-authored docs to a browser viewer. The server is Node-only; the viewer (`viewer.html` +
`viewer.js`) renders every doc with the vendored `marked` library, lists docs in a fixed 260px
sidebar, and sends comment / approve events over a WebSocket. The server appends those events to
`<state_dir>/events` (JSONL). Per `SKILL.md`, the agent reads that file on its next turn and then
truncates it — and the next turn only happens when the operator types something in the terminal.

The operator reviews both `.md` feature docs and Gherkin `.feature` scenario files with it, in the
cmux built-in browser. On 2026-10-07 a browser Approve was verified to land in
`<state_dir>/events` of the live session (`.../feat-attribution/.md-review/66899-1791396019`); the
agent did not react.

## Problem

1. **Feedback is not acted on.** A browser Approve or comment is recorded but the agent gets no new
   turn, so from the operator's seat the buttons do nothing until they switch to the terminal and
   type.
2. **Non-markdown files are unreadable.** Every file is parsed as markdown. In `.feature` files,
   Gherkin `#` comment lines become `<h1>` headings and consecutive Gherkin lines collapse into
   paragraphs (screenshot of `scenarios/debit-traceability.feature`, 2026-10-07).
3. **Sidebar titles are wrong and truncated.** The title is the first line matching `^#\s+(.+)$`;
   in `.feature` files that is a Gherkin comment (e.g. `# scenarios/labelled-dataset.feature`). The
   sidebar width is fixed at 260px and titles are cut with an ellipsis; the full title and path are
   not visible anywhere in the viewer.
4. **Markdown source can't be seen.** The viewer shows only rendered markdown, so the operator can't
   see the exact source text a comment refers to — the text the agent will grep and edit — or check
   markup that rendered unexpectedly.
5. **Saved comments vanish.** After a comment is saved, only a colored border remains (inline) or
   the box simply clears (doc-level); the operator can't see what they wrote. Found in the
   2026-10-07 end-to-end run.

## Complexity drivers

- **Scale**: N/A — bounded by one reviewer and ~10 docs per session.
- **Concurrency**: Events can arrive while the agent is mid-turn, or while the agent is not
  listening for them. A review often produces a burst of events (several comments then an approve)
  within seconds. Each server session has its own `state_dir` and is started by one agent session;
  several server sessions can coexist under one project's `.md-review/`.
- **Failure modes**: A missed notification leaves feedback unread (today's behavior). A notification
  that fires repeatedly for already-read events makes the agent loop and burn turns.
- **Cross-cutting policies**: Today all browser feedback reaches the agent only after the operator
  acts in the terminal. Once feedback triggers agent turns directly, comment text becomes agent input
  with no human relay, and the session key (`?key=` / cookie) plus the WebSocket origin check become
  the only gate on starting agent turns. That gate must not weaken. No PII or secrets involved.
- **Existing Data or Systems**: The `events` JSONL format and the "agent truncates after reading"
  contract documented in `SKILL.md`; existing tests `tests/server.test.cjs` and
  `tests/serve-doc.test.cjs`; live sessions persisted under `<project>/.md-review/`.

## Constraints

- Node is the only runtime. No npm install, no CDN — any library must be vendored like
  `marked.min.js`.
- Must work in the cmux built-in browser (WebKit) as well as Chromium.
- Agent notification must rely on Claude Code mechanisms only — no dependency on cmux. When the
  agent runs inside cmux (`CMUX_SURFACE_ID` set), the operator wants cmux's notification ring as
  well; outside cmux nothing changes.
- The `events` file format stays backward-compatible.
- Core plugin version is bumped.

## Success criteria

1. The operator can read every doc's full title and full path from the viewer, and can give the
   sidebar more room when titles are long; that layout choice survives a page reload in the same
   browser.
2. While the agent is idle, a browser Approve or an explicit submit of comments gives it a new
   turn with no terminal input, within 1s. Saving a comment alone never gives the agent a turn — the
   operator decides when a batch of comments is finished. (Revised 2026-10-07 after the end-to-end
   run: comments are typically 10–30s apart, so a quiet-window debounce woke the agent per comment.)
3. Events that arrive while the agent is mid-turn are acted on in that turn or the next, and are
   never dropped.
4. Events the agent has already read never cause another agent turn.
5. A `.feature` file is readable: Feature / Rule / Background / Scenario headers, step keywords
   styled distinctly from step text, tables rendered as tables, tags, doc strings, and comments in a
   muted style distinct from steps. Its sidebar title is the `Feature:` name. The operator can
   comment on an individual scenario.
6. Any other non-`.md` file shows its source verbatim and the operator can comment on a specific
   part of it. A `.md` doc can be switched to its source and back.
7. When the agent's session runs in cmux, a submit or approve rings that agent's cmux
   surface (notification + attention ring). Outside cmux, or if the cmux CLI fails, review works
   exactly as without it.
8. Every comment the operator saved stays visible next to what it comments on, marked as pending
   or sent, including after a page reload.
9. Existing tests pass; new automated tests cover the notification path and any server changes;
   each viewer change is checked by hand in the cmux browser.

## Open questions

- [x] Can Claude Code give an idle session a new turn from an external event? — Yes: the Bash tool's
  `run_in_background` mode documents that a background command "re-invokes you when it exits"
  (Claude Code Bash tool description, 2026-10-07). Confirmed with a live test in this session before
  design (see change log).

## Change log

- 2026-10-07: Initial draft (Brent Hoover)
- 2026-10-07: Problem-reviewer pass — added trust-model fact, mid-turn criterion, concrete timings,
  why-it-matters for problem 4; moved mechanics out of criteria; resolved idle-wake open question.
- 2026-10-07: Idle-wake verified live — a 20s `run_in_background` command exited at 11:12:42 and
  re-invoked the idle session with no terminal input.
- 2026-10-07: Added optional cmux notification ring on feedback receipt (operator request); doorbell
  stays out of scope.
- 2026-10-07: Moved Out of scope to design.md (template: design.md is its single home).
- 2026-10-07: End-to-end findings — criterion 2 now "wake on submit/approve only"; new problem 5 and
  criterion 8 (saved comments must stay visible). Operator decision.
