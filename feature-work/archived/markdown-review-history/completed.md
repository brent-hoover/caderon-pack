---
title: Markdown Review — doc history and change diffs — Completion Record
type: notes
status: active
owner: Brent Hoover
created: 2026-11-03
updated: 2026-11-03
---

# Markdown Review — doc history and change diffs — Completion Record

Handoff manifest for everything shipped as part of this feature. Authoritative record of what
is now in the codebase as a result of this work.

## What shipped

The markdown-review skill now works in **revisions**:

- **Recording revisions.** The agent records a doc's content as a revision when a round of edits
  is ready: `serve-doc.cjs` records revision 1 and the new `revise.cjs` records each later one.
  The viewer shows only recorded revisions, so edits in progress stay invisible.
- **History on disk.** History is kept beside each doc as plain, committable files
  (`.revisions/<doc file name>/`) and survives server restarts. Because it can arrive from a
  checkout, it is treated as untrusted input.
- **Rich diff.** The viewer shows a structure-aware, GitHub-style rich diff between any two
  revisions. Changes are marked inside blocks, list items (including nested ones), table rows and
  cells, code lines, Gherkin steps and plain-text lines, down to the word.
- **Revision bar.** A revision picker, a Full document / Show changes toggle, and "Changes since
  approved".
- **Comments carry forward.** Comments from earlier revisions carry forward, badged *open* or
  *addressed in revision k*. An addressed badge opens the diff that addressed it.
- **Revision-tied feedback.** Comments and approvals record the revision, and its hash, they
  were made on. Approve is only possible on the latest revision once it is on screen.

Verified with 120 `node --test` tests and 41 browser checks: 40 named checks plus a smoke check (`tests/browser/run.cjs`). The
operator also dogfooded the viewer on this feature's `plan.md`: comments on revisions 1 and 2, then
approval of revision 3.

## New modules / files

All under `plugins/core/skills/markdown-review/`:

- `scripts/revisions.cjs` — reads and writes a doc's revision history (per-doc lock, atomic
  `NNNN.rev` writes, append-only `index.jsonl`, symlink and index-entry validation).
- `scripts/revise.cjs` — CLI that records the next revision of served docs.
- `scripts/revision-diff.cjs` — pure structure-aware diff between revisions (`diffMarkdown`,
  `diffGherkin`, `diffLines`, `groupHtmlContainers`) plus comment carry-forward (`carryForward`,
  `mapForward`, `resolveAnchor`); inlined into the page and `require()`d by tests.
- `tests/revisions.test.cjs`, `tests/revise.test.cjs`, `tests/revision-diff.test.cjs` — storage,
  CLI and diff/carry-forward tests.
- `tests/skill-docs.test.cjs` — checks `SKILL.md` and `DESIGN.md` say what agents need.
- `tests/scenario-coverage.test.cjs` — fails if any scenario in this feature (or its archived
  copy) has neither a node test nor a browser check of the same name.
- `tests/browser/run.cjs`, `tests/browser/scenarios.txt` — viewer checks driven through
  `agent-browser`, and the scenario names they cover.

## Modified files

- `scripts/server.cjs` — watches revision indexes instead of doc files, serves revisions
  (`/doc/<id>`, `/doc/<id>/rev/<n>`, `/revisions/<id>`) with hash checks, and announces new
  revisions by identity (revision + timestamp + hash). It also inlines `revision-diff.cjs`.
- `scripts/serve-doc.cjs` — records the doc's revision before adding it to the manifest.
- `scripts/viewer.js` — the main change:
  - one block per token, with HTML containers grouped;
  - diff rendering for every node kind, with a render check and fallback;
  - the revision bar and per-doc comparisons;
  - carried-forward comment cards and linked badges;
  - revision-keyed text cache and approvals;
  - render generations, so a superseded render is discarded;
  - comment drafts bound to the doc on screen.
- `scripts/viewer.html` — revision bar markup, diff and badge styles, `REVISION_DIFF_JS`
  placeholder.
- `tests/server.test.cjs` — existing doc tests now serve via revisions; new tests for revision
  serving, notices, restart, deleted/recreated history, unindexed or tampered revision files,
  stale hashes.
- `SKILL.md`, `DESIGN.md` — rewritten for the revision loop, history storage, the rich diff and
  the event contract.
- `plugins/core/.claude-plugin/plugin.json`, `plugins/core/.codex-plugin/plugin.json` — core
  `1.7.0` → `1.8.0`.
- `.gitignore` — ignores `.md-review/` session dirs.

## Dependencies added

- None at runtime (Node only, vendored `marked` unchanged).
- The browser checks need `agent-browser` (0.39.1 at the time), which was already installed.
  `node --test` doesn't need it.

## Interface changes

- **New CLI:** `revise.cjs [--session-dir <dir>] <path>…`. It prints `{"type":"revised"|"unchanged","doc","revision"}`
  per path. It exits 1 on any failure, with the reason on stderr. Failures include:
  - a doc that isn't served;
  - a missing file;
  - no live session;
  - a usage error;
  - a held or stale revision lock;
  - untrusted history: a symlink, or an invalid index entry.
- **`serve-doc.cjs`** prints a `revised`/`unchanged` line per path before `docs-added`.
- **HTTP:**
  - `GET /doc/<id>` returns the latest revision. It returns 404 if there is none, and 409 if the
    revision's content no longer matches its hash. It never returns the working file.
  - `GET /doc/<id>/rev/<n>[?sha256=]` is new. It returns 404 for an unindexed revision and 409
    for a hash mismatch.
  - `GET /revisions/<id>` is new.
  - `/docs` entries gain `revision` and `sha256`.
- **WebSocket:** the server→client `reload` message is replaced by
  `{"type":"revision","id","revision"}`. An already-open tab from an older viewer needs one reload.
- **Events** (additive): comments carry `revision`. Approves carry `revision` and `sha256`; an
  approval counts only while both match the latest index entry. `wait-for-feedback.cjs` and its
  exit codes are unchanged.
- **Server log:** the stdout/`server.log` event `doc-updated` is replaced by
  `{"type":"doc-revised","file","revision"}`, emitted when a revision is recorded rather than when
  the file is saved.
- **On-disk format:** `<doc dir>/.revisions/<doc file name>/index.jsonl` + `NNNN.rev` + transient
  `lock`.

## Configuration changes

- None. History is not gitignored by design, so `git add <dir>` commits it. A repo that doesn't
  want history committed can gitignore `.revisions/`.

## Known issues / follow-ups

- **Flaky tests.** Two failures were seen once each and haven't reproduced since: one node test,
  output lost, and the browser check "A plain-text doc shows changed lines" timing out on its
  initial load. Tracked in kata `00xd`.
- **Feedback doesn't survive a restart.** Approvals and comments live in the session's events
  file, so they don't survive a server restart, although history does. The operator accepted this
  for now.
- **Stale locks need a manual delete.** A revise process that dies holding the lock leaves a
  stale lock, which the next revise reports with the path to delete. It is never taken over.
- **Whole-block comments.** Comments on a list or table attach to the whole block, not to a single
  item or row. That's unchanged from before this feature.
- **Duplicated session lookup.** About 20 lines of session discovery and liveness checking are
  duplicated between `revise.cjs` and `serve-doc.cjs`. This was accepted in plan open question 1.
- **Old copies in history.** Text deleted from a doc stays in `.revisions/` until that directory
  is removed.

## Deferred work

None — no `deferred.md` was needed. Teammate sharing of a doc over a tunnel was split out before
design and is tracked separately as kata `jf1t`.

## Next steps

- Push `feat/markdown-review-history` and open a PR to `develop`. The operator approved the push,
  and the PR waits on a passing roborev review of every commit.
- After merge, update the installed core plugin (1.8.0) so sessions use the new skill.
- kata `jf1t` (teammate sharing), then kata `00xd` (flakes), owned by Brent Hoover.

## Change log

- 2026-11-03: Completed (Brent Hoover)
- 2026-11-03: Applied completion-reviewer findings: added the server log event, the 409 on
  `GET /doc/<id>`, all `revise.cjs` exit causes and the duplicated session lookup. Browser count
  updated after `7411e65`, the loose task-item checkbox fix.
