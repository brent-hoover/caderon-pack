---
title: Markdown Review — doc history and change diffs — Implementation Plan
type: plan
status: approved
owner: Brent Hoover
created: 2026-10-30
updated: 2026-10-30
design: ./design.md
---

# Markdown Review — doc history and change diffs — Implementation Plan

## Overview

The work goes bottom-up, along the design's layers:

1. Storage (`revisions.cjs`).
2. The CLIs that write it.
3. The server that reads it.
4. The pure diff module.
5. The viewer.
6. The skill docs.

Each lower layer is proven by `node --test` before anything depends on it. The viewer comes last
among the code steps. It consumes everything above and can only be verified in a browser, so it is
split into four steps:

- **Step 7:** show revisions, without changing behaviour.
- **Step 8:** diff rendering.
- **Step 9:** navigation.
- **Step 10:** feedback and carried-forward comments.

From step 3 on, the worktree viewer keeps working, because step 3 adds the `revision` message
handler alongside the server change. Every step is one reviewable commit, or a small group of
commits, and roborev reviews each one. Paths below are relative to
`plugins/core/skills/markdown-review/` unless they start with `feature-work/` or `plugins/`.

## Preconditions

- [x] `problem.md` approved (2026-10-30), and re-approved after reopening it for the Optimal option.
- [x] `design.md` approved (2026-10-30).
- [x] All 7 `.feature` files in `scenarios/` approved (2026-10-30). `revise-records-revisions` was
      re-approved after the `.rev` change.
- [x] `scope.md` approved (2026-10-30).
- [x] Baseline: `node --test tests/` passes 57 tests (2026-10-30).
- [x] `agent-browser` is available (`/opt/homebrew/bin/agent-browser`, 0.39.1).

### Verification convention

| Name | Command and what it checks |
|---|---|
| `T` | `node --test tests/` runs the full suite. Every step's Verify checks the total and `fail 0`. |
| `S "<names>"` | `node --test --test-name-pattern "^(<name 1>\|<name 2>…)$" tests/`. It passes when every listed name prints a `✔` line. `--test-name-pattern` must come **before** the path, because Node ignores it after the path (verified 2026-10-30). Counts are not used, because every file with no match also adds one passing entry. |
| `M` | `python3 scripts/sync-plugin-metadata.py --check`, the repo's CI check, run from the repo root. It exits 0. |

## Steps

### 1. History storage: `revisions.cjs`

**Status:** ☑

**What:** Add `scripts/revisions.cjs` exporting `recordRevision(docPath)`, `readIndex(docPath)`,
`readRevision(docPath, n)` and `revisionDir(docPath)`.

It follows design steps 1–6:

- **Lock:** `wx` on `lock` with the pid. Retry every 50ms, up to 5s, while the holder is alive.
  A lock held by a dead pid fails loudly; it is never taken over.
- **Repair and cleanup:** truncate a partial index tail, and remove leftover `*.tmp` files.
- **Change check:** compare the SHA-256 hash with the latest revision.
- **Write:** write a temp file, `fsync` it, then rename it to `NNNN.rev`.
- **Index:** append one line to the index.

Add `tests/revisions.test.cjs` with these tests:

- `concurrent revises record exactly one new revision`
- `a lock held by a dead pid fails with its path`
- `an interrupted index append is repaired`
- `a revision file only appears complete`
- `unchanged content returns the latest revision`
- `recording a missing doc throws with its path`

**Why:** Every other component reads or writes history through this module.

**Scenarios:** None directly. This is the foundation for `revise-records-revisions.feature`.

**Verify:**

- `S` with the 6 names above, plus the 5 untrusted-history tests added after the security review: all show `✔`.
- `T`: 68 pass, 0 fail.

### 2. Recording CLIs: `revise.cjs` and `serve-doc.cjs`

**Status:** ☑

**What:**

- **New `scripts/revise.cjs`:** it checks that the session is live and finds the default session
  dir, the same way `serve-doc` does. It then checks that the doc is in the manifest, calls
  `recordRevision`, and prints one `revised` or `unchanged` JSON line per path. Errors exit 1 with
  the stderr messages from the design's Interfaces section.
- **`serve-doc.cjs`:** it calls `recordRevision` for each path **before** it writes the manifest,
  and prints one result line per path before `docs-added`.
- **New `tests/revise.test.cjs`:** each test is named exactly after its scenario. It runs both CLIs
  as child processes against a temp project with a fake live session (a `state/server-info` file).

The session-liveness and discovery code is ~20 lines that `revise.cjs` duplicates from
`serve-doc.cjs`. See open question 1.

**Why:** It gives the agent the revise action, and makes every served doc start at revision 1.

**Scenarios:** `scenarios/revise-records-revisions.feature`, all 6:

- "Serving a doc for review records it as revision 1"
- "Revising changed content records the next revision"
- "Revising unchanged content records nothing"
- "Serving an already-served doc again does not add a revision"
- "Revising a doc that was never served is rejected"
- "Revising a missing file is rejected"

**Verify:**

- `S` with the 6 scenario names: all show `✔`.
- `T`: 74 pass, 0 fail.

### 3. Server serves revisions (with a viewer handler)

**Status:** ☑

**What:**

- **`scripts/server.cjs`:**
  - Watch `index.jsonl` instead of the doc, and broadcast `{"type":"revision",…}` when it grows.
  - If the index is deleted, `watchFile` fires with zeroed stats. That must neither broadcast nor
    crash.
  - `GET /doc/<id>` returns the latest revision, or the design's 404 message.
  - Add the routes `GET /doc/<id>/rev/<n>` and `GET /revisions/<id>`.
  - Entries in `GET /docs` gain `revision`.
- **`scripts/viewer.js`:** handle `revision` the way `reload` is handled today, by calling
  `onDocChanged(id)`. This keeps the worktree viewer live.
- **`tests/server.test.cjs`:**
  - `before()` starts the server first, then serves the docs via `serve-doc.cjs`, which needs
    `state/server-info`.
  - Update the existing tests `:97` (`/doc/<id> returns raw markdown`) and `:105`
    (`/docs lists …`).
  - Add the 4 scenario tests. A WebSocket client asserts the revision notice, and asserts that no
    notice arrives for an unrevised write.
  - The restart scenario stops the server and spawns a new one with a **new** `MDREVIEW_DIR`,
    serving the same doc path. History lives beside the doc, so the session dir doesn't matter.
  - Add a test: `deleting a revision index does not broadcast or crash`.

**Why:** After this step the operator only ever sees revised content.

**Scenarios:** `scenarios/viewer-shows-revisions.feature`, all 4:

- "A revise pushes the new revision to the browser"
- "Editing the file without revising changes nothing the operator sees"
- "History survives a server restart"
- "A doc whose history directory was deleted is reported, not silently re-created"

**Verify:**

- `S` with the 4 scenario names plus the deletion test: all show `✔`.
- `T`: 81 pass, 0 fail.

**Note:** This session reviews docs with the **installed** skill (core 1.7.0 in the plugin cache).
Worktree changes don't affect it.

### 4. Diff core for markdown: `revision-diff.cjs`

**Status:** ☑

**What:** Add `scripts/revision-diff.cjs`, dual-loaded like `gherkin.cjs`, with these functions:

- `diffSequence`
- `pairChanges`
- `isSameBlock`: rendered-HTML equality, using each revision's link definitions
- `diffWords`, which treats `strong`, `em`, `del`, `codespan`, `link` and `image` as atomic.
- `diffMarkdown`, which descends through list, table (rows via `diffSequence`), code and
  blockquote (nested `diffMarkdown`), and returns a diff tree with `isIdentical`.

Add `tests/revision-diff.test.cjs`. It loads `marked.min.js` through `vm`. Each markdown scenario
is one test that asserts on the **diff tree**:

- The paragraph is a single `changed` node, with word runs of exactly `30` removed and `60` added.
- The new section is `added` after the last block.
- The removed paragraph is `removed` at its old position.
- Only the `beta` item changes.
- Only the one table cell changes.
- Only the `b` line changes.
- `isIdentical` is true for identical revisions.

Extra unit tests:

- `emphasis is diffed as one word`
- `a link is diffed as one word`
- `an inserted table row does not mark later rows`
- `a changed reference-link definition marks the paragraph`
- `a blockquote edit is diffed inside the quote`

**Why:** This is the core of the rich diff, and it can be tested without a browser.

**Scenarios:** `scenarios/rich-diff.feature`, at the diff-tree seam:

- "A changed word inside a paragraph is marked inline"
- "A new section is shown as added"
- "A removed paragraph is still shown, marked as removed"
- "One changed list item is marked without marking its siblings"
- "One changed table cell is marked without marking the rest of the table"
- "Identical revisions show no change marking"
- "A code fence change is marked per line"

**Verify:**

- `S` with the 7 scenario names and the 5 unit names: all show `✔`.
- `T`: 95 pass, 0 fail.

### 5. Diff for Gherkin and plain text

**Status:** ☑

**What:**

- Add `diffGherkin`, keyed by block kind + title. A key match with different lines becomes
  `changed`. A title changed in place pairs to `changed`.
- Add `diffLines`.
- Add the 2 scenario tests, plus `a renamed scenario pairs as changed`.

**Why:** This completes the diff for the other two doc types the viewer serves.

**Scenarios:** `scenarios/rich-diff.feature`:

- "A Gherkin step change is marked inside its scenario"
- "A plain-text doc shows changed lines"

**Verify:**

- `S` with those 3 names: all show `✔`.
- `T`: 98 pass, 0 fail.

### 6. Comment carry-forward logic

**Status:** ☑

**What:** Add these functions to `revision-diff.cjs`:

- **`mapForward(diffChain, index)`** returns `open`, `addressed` or `removed`, per the design.
- **`resolveAnchor(event, anchors)`** is moved out of today's `nearestMatchingAnchor`, together
  with the `commentView` / `anchorIndexOf` rules it needs for source lines (`viewer.js:283-294`).
  It returns `null` when the quote matches nothing.
- **`carryForward(event, anchorsByRevision, diffChainFor)`** combines the two. It chooses the
  starting revision as `event.revision ?? 1`, chooses the diff chain by the event's view, resolves
  the anchor in that revision, and maps it forward. When `resolveAnchor` returns `null`, it returns
  `{state: 'unanchored'}`.

Moving `resolveAnchor` into `revision-diff.cjs` widens that module slightly beyond the design's
Components table. That is recorded in this plan's change log.

Add the tests:

- 3 `mapForward` scenario tests: addressed in revision 2, open, and removed in revision 2 with
  `afterIndex`.
- 2 `carryForward` scenario tests: an event with no revision starts at revision 1, and an
  unanchorable quote gives `unanchored`.

**Why:** This is the logic behind "was my comment addressed", tested without a browser.

**Scenarios:** `scenarios/comments-carry-forward.feature`, all 5, at the logic seam:

- "A comment on changed text is shown as addressed"
- "A comment on unchanged text is shown as still open"
- "A comment on removed text is shown as addressed by removal"
- "A comment from an older viewer without a revision is treated as revision 1"
- "A comment whose anchor cannot be found in its own revision is shown at doc level"

**Verify:**

- `S` with the 5 scenario names: all show `✔`.
- `T`: 103 pass, 0 fail.

### 7. Viewer on revisions and per-block rendering (no behaviour change)

**Status:** ☐

**What:**

- **`viewer.html`:** add the `<!-- REVISION_DIFF_JS -->` placeholder. `viewerPage()` in
  `server.cjs` inlines `revision-diff.cjs` there.
- **`viewer.js`:**
  - Key `textCache` by path + revision.
  - Render markdown **per block**: each non-space token goes in its own `div.block`.
  - Use the shared `resolveAnchor`.
- **`tests/server.test.cjs:84`:** extend it to assert the placeholder is replaced and the
  `revision-diff.cjs` content is inlined.
- **New `tests/browser/run.sh` and `tests/browser/scenarios.txt`:** `run.sh` drives `agent-browser`
  against a server on a temp project with fixture docs. In this step it runs only `--smoke`:
  1. Comment on a block and submit.
  2. The events file has the comment.
  3. Revise.
  4. The page shows the new text.

**Why:** The viewer moves to revisions and the new block identity while everything still works, so
steps 8–10 only add to it.

**Scenarios:** None new. Existing behaviour is kept.

**Verify:**

- `T`: 108 pass, 0 fail.
- `tests/browser/run.sh --smoke` prints `ok smoke` and exits 0.
- Manually, in the operator's browser: comments on an existing doc still attach to the right
  blocks.

### 8. Diff rendering

**Status:** ☐

**What:** In `viewer.js` and `viewer.html`:

- Render the diff tree following the design's rendering table:
  - equal blocks;
  - `d-added` and `d-removed` blocks;
  - changed paragraph, heading or blockquote via the rebuilt markdown;
  - list;
  - table;
  - code, Gherkin and plain-text lines as DOM.
- Apply the render-text check, with the whole-block fallback.
- Removed blocks are not commentable.
- Add the "No changes between revision A and revision B" header.
- Source view shows the selected revision's source, with no diff.
- On a `revision` message for the current doc, re-render the diff from the shown target to the new
  revision.

In this step the diff shown is always previous revision → latest. The controls come in step 9.

Extend `run.sh` with one browser check per `rich-diff` scenario, named after it. Each asserts the
`ins`/`del`/`d-added`/`d-removed` markup and the "No changes" header.

**Why:** This is the operator-visible rich diff.

**Scenarios:** `scenarios/rich-diff.feature`, all 9, at the browser seam:

- "A changed word inside a paragraph is marked inline"
- "A new section is shown as added"
- "A removed paragraph is still shown, marked as removed"
- "One changed list item is marked without marking its siblings"
- "One changed table cell is marked without marking the rest of the table"
- "A Gherkin step change is marked inside its scenario"
- "A plain-text doc shows changed lines"
- "Identical revisions show no change marking"
- "A code fence change is marked per line"

**Verify:**

- `tests/browser/run.sh` prints `ok <name>` for all 9 and `ok smoke`, and exits 0.
- `T`: 108 pass, 0 fail.

### 9. Revision navigation

**Status:** ☐

**What:** In `viewer.js` and `viewer.html`:

- **Revision header:** "Revision N of M".
- **Base and target selects:** a base ≥ the target is rejected with the message.
- **Show changes / Full document toggle:** disabled when M = 1.
- **Last viewed revision:** stored in `localStorage`, every access in try/catch. It is written
  when a revision is rendered as the target, and ignored if it is greater than the latest.
- **Opening a doc:** if it has unseen revisions, it opens in diff view.
- **`approved` map:** becomes path → revision, rebuilt from `approve` events on load. Moved here
  from step 10 so that "Changes since approved (rev K)" works now.

`run.sh` seeds "last viewed revision" through `agent-browser`'s eval of `localStorage.setItem`.
It seeds an approval by appending an `approve` event with a `revision` to the session's events
file before the page loads.

**Why:** The operator chooses what to compare, and can read the clean doc.

**Scenarios:** `scenarios/revision-navigation.feature`, all 7:

- "A newly revised doc opens in diff view against the previous revision"
- "The operator switches from the diff to the full revised doc"
- "The operator switches from the full revised doc back to the diff"
- "The operator compares any two revisions"
- "The operator views changes since their approval"
- "A doc with only one revision has no diff"
- "Choosing a base revision newer than the target is rejected"

**Verify:**

- `tests/browser/run.sh` prints `ok` for those 7 plus every earlier check, and exits 0.
- `T`: 108 pass, 0 fail.

### 10. Revision-aware feedback and carried-forward comments

**Status:** ☐

**What:** In `viewer.js`:

- **Approve:** sends `revision`. It is disabled, with the hint "Approve the latest revision", when
  the target is older than the latest.
- **Comments:** send `revision`. In diff view they take `quote`, `occurrence` and `blockIndex`
  from the target revision's unmarked block.
- **Stale approvals:** clear the sidebar check.
- **Carried-forward comment cards:**
  - Each card goes through `carryForward`. Its anchors come from rendering the comment's own
    revision off-screen. Its diff chain is chosen by view: rendered → `diffMarkdown`,
    gherkin → `diffGherkin`, source and plain text → `diffLines`.
  - Badges: "open", "addressed in revision k", or "addressed in revision k (text removed)".
  - `unanchored` comments go to the doc level, marked "anchor not found".

Extend `run.sh`:

- Every `feedback-carries-revision` scenario. For the two event scenarios, `run.sh` runs
  `wait-for-feedback.cjs` against the session and asserts on its output and exit code 0.
- The browser seam of every `comments-carry-forward` scenario: badge text and card placement.

**Why:** This closes the approval-safety loop and the "was my comment addressed" loop.

**Scenarios:**

- `scenarios/feedback-carries-revision.feature`, all 4:
  - "An approval records the revision it approves"
  - "A comment records the revision it was made on"
  - "An approval of an older revision is marked stale after a revise"
  - "Approving while viewing an older revision is not allowed"
- `scenarios/comments-carry-forward.feature`, all 5, at the browser seam.

**Verify:**

- `tests/browser/run.sh` prints `ok` for those 9 plus every earlier check, and exits 0.
- `T`: 108 pass, 0 fail.

### 11. Skill docs, version bump, traceability

**Status:** ☐

**What:**

- **`SKILL.md`:**
  - Add the revise step to the review loop, after edits and before arming the watcher, with the
    `revise.cjs` command line.
  - State that edits aren't visible until revise, and remove the "live-reloads on every edit"
    wording.
  - Add `revision` to the event examples, and state that an approval is current only if its
    revision is the latest.
  - Add a note on `.revisions/`: history is committable, and deleted text stays in it.
  - Add an upgrade note about reloading open tabs.
  - Add the stale-lock recovery step: confirm no revise is running, then delete the lock file.
- **`DESIGN.md`:** add sections on revisions, history storage and the rich diff, and update the
  layout list.
- **Version:** bump `version` to `1.8.0` in `plugins/core/.claude-plugin/plugin.json` and
  `plugins/core/.codex-plugin/plugin.json`.
- **`tests/skill-docs.test.cjs` (new):** the 3 `skill-instructions` scenarios, plus
  `DESIGN.md covers revisions, history storage and the rich diff`.
- **`tests/scenario-coverage.test.cjs` (new):** `every scenario has a test`, following the design.
  It reads the feature dir, or its archived path, and fails loudly if neither exists. It fails if
  any scenario is missing both a node test and a `scenarios.txt` entry.
- **Feature files:** fill the `# Maps to: plan.md Step TBD` header comment in each of the 7
  `.feature` files from the coverage table. This is a comment-only change and leaves the steps
  alone; the operator is told.

**Why:** This meets the criterion that an agent following only `SKILL.md` produces revisions, and
it makes scenario traceability a test.

**Scenarios:** `scenarios/skill-instructions.feature`, all 3:

- "SKILL.md documents the revise command in the review loop"
- "SKILL.md states that unrevised edits are not shown"
- "SKILL.md documents the revision field on events"

**Verify:**

- `S` with the 3 scenario names, the `DESIGN.md` check and `every scenario has a test`: all show
  `✔`.
- `T`: 113 pass, 0 fail.
- `M` exits 0.

### 12. End-to-end dogfood

**Status:** ☐

**What:** Run the worktree copy of the skill (`plugins/core/skills/markdown-review/scripts/`)
against this feature's `plan.md`:

1. Serve it.
2. The operator comments.
3. Edit it and run `revise`.

The operator confirms the rich diff, the carried-forward comment badge, and Approve on the new
revision. Record the result in this plan's change log.

**Why:** This proves the problem's success criteria in the real loop, not just against fixtures.

**Scenarios:** All, end to end.

**Verify:**

- The operator confirms in the browser.
- `T` is green, `tests/browser/run.sh` is green, and `M` exits 0.

## Scenario coverage

| Feature file | Scenario | Covered by step |
|---|---|---|
| `revise-records-revisions.feature` | Serving a doc for review records it as revision 1 | 2 |
| `revise-records-revisions.feature` | Revising changed content records the next revision | 2 |
| `revise-records-revisions.feature` | Revising unchanged content records nothing | 2 |
| `revise-records-revisions.feature` | Serving an already-served doc again does not add a revision | 2 |
| `revise-records-revisions.feature` | Revising a doc that was never served is rejected | 2 |
| `revise-records-revisions.feature` | Revising a missing file is rejected | 2 |
| `viewer-shows-revisions.feature` | A revise pushes the new revision to the browser | 3 |
| `viewer-shows-revisions.feature` | Editing the file without revising changes nothing the operator sees | 3 |
| `viewer-shows-revisions.feature` | History survives a server restart | 3 |
| `viewer-shows-revisions.feature` | A doc whose history directory was deleted is reported, not silently re-created | 3 |
| `rich-diff.feature` | A changed word inside a paragraph is marked inline | 4, 8 |
| `rich-diff.feature` | A new section is shown as added | 4, 8 |
| `rich-diff.feature` | A removed paragraph is still shown, marked as removed | 4, 8 |
| `rich-diff.feature` | One changed list item is marked without marking its siblings | 4, 8 |
| `rich-diff.feature` | One changed table cell is marked without marking the rest of the table | 4, 8 |
| `rich-diff.feature` | A Gherkin step change is marked inside its scenario | 5, 8 |
| `rich-diff.feature` | A plain-text doc shows changed lines | 5, 8 |
| `rich-diff.feature` | Identical revisions show no change marking | 4, 8 |
| `rich-diff.feature` | A code fence change is marked per line | 4, 8 |
| `revision-navigation.feature` | A newly revised doc opens in diff view against the previous revision | 9 |
| `revision-navigation.feature` | The operator switches from the diff to the full revised doc | 9 |
| `revision-navigation.feature` | The operator switches from the full revised doc back to the diff | 9 |
| `revision-navigation.feature` | The operator compares any two revisions | 9 |
| `revision-navigation.feature` | The operator views changes since their approval | 9 |
| `revision-navigation.feature` | A doc with only one revision has no diff | 9 |
| `revision-navigation.feature` | Choosing a base revision newer than the target is rejected | 9 |
| `comments-carry-forward.feature` | A comment on changed text is shown as addressed | 6, 10 |
| `comments-carry-forward.feature` | A comment on unchanged text is shown as still open | 6, 10 |
| `comments-carry-forward.feature` | A comment on removed text is shown as addressed by removal | 6, 10 |
| `comments-carry-forward.feature` | A comment from an older viewer without a revision is treated as revision 1 | 6, 10 |
| `comments-carry-forward.feature` | A comment whose anchor cannot be found in its own revision is shown at doc level | 6, 10 |
| `feedback-carries-revision.feature` | An approval records the revision it approves | 10 |
| `feedback-carries-revision.feature` | A comment records the revision it was made on | 10 |
| `feedback-carries-revision.feature` | An approval of an older revision is marked stale after a revise | 10 |
| `feedback-carries-revision.feature` | Approving while viewing an older revision is not allowed | 10 |
| `skill-instructions.feature` | SKILL.md documents the revise command in the review loop | 11 |
| `skill-instructions.feature` | SKILL.md states that unrevised edits are not shown | 11 |
| `skill-instructions.feature` | SKILL.md documents the revision field on events | 11 |

All 38 scenarios are covered, with no gaps.

## Open questions

- [x] **1. Duplicated session code.** Resolved: duplicate, per the approved plan default (2026-10-30). `revise.cjs` needs the same session-liveness and discovery
      logic as `serve-doc.cjs`, about 20 lines. Should I duplicate it, which is what the default
      plan does, or extract it into a new `scripts/session.cjs`? Extracting adds a module that
      isn't on the scope allowlist, so `scope.md` would need re-approval.

## Rollback

- **Before merge:** each step is its own commit on `feat/markdown-review-history`, so reverting
  that commit undoes the step. The installed core 1.7.0 skill that reviews docs in this session
  isn't touched.
- **After merge:** revert the merge commit.
- **History on disk:** `.revisions/` directories written during dogfooding are plain files. Delete
  them if they aren't wanted; nothing else reads them.

## Change log

- 2026-10-30: Initial draft (Brent Hoover)
- 2026-10-30: Applied the plan-reviewer findings.
  - Verify now uses exact names, with the pattern flag before the path, which was checked against
    Node.
  - The restart test uses a new `MDREVIEW_DIR`.
  - Step 3 adds the viewer `revision` handler.
  - The old step 8 is split into rendering (8) and navigation (9). The approvals rebuild moved
    into 9, and all 9 rich-diff browser checks are listed.
  - `carryForward` chooses the starting revision and the diff chain by view.
  - Added steps for: source view, re-rendering on a `revision` message, `localStorage` seeding,
    and the watcher in `run.sh`.
  - Feature-file headers are filled in step 11.
  - Noted that `resolveAnchor` widens `revision-diff.cjs`.
- 2026-10-30: Applied roborev job 4516.
  - Added a **Status** field to each step.
  - Removed the scope section; the design's Out of scope is the single home for it.
  - Step 1 tests follow the fail-loud stale lock, the repair of an interrupted index append, and
    the expectation of one new revision under concurrency.
  - Step 4 uses rendered-HTML block equality, and adds link-definition and blockquote tests.
  - Totals updated.
- 2026-10-30: Step 1 gained 5 untrusted-history tests (symlinks, index validation) after the
  automated security review; totals shifted by 5.
- 2026-10-30: Totals from step 3 on shifted by 2: a symlinked-lock test (roborev job 4526) and a
  `/doc/<id>/rev/<n>` route test in step 3. Step 3 was also checked in a real browser: an unrevised
  write stayed hidden, and a revise updated the page.
- 2026-10-30: Totals from step 4 on shifted by 2, for the server tests added after roborev job
  4534 (recreated history is announced, unindexed revision files are not served). Viewer approvals
  now track the revision number, ahead of step 10.
- 2026-10-30: `mapForward` takes the starting revision as a third argument (it reports revision
  numbers), and `carryForward` converts 1-based Source-view lines to 0-based diff indexes.
- 2026-10-30: Totals from step 7 on shifted by 4, for the regression tests added after roborev jobs
  4539/4540: checkbox item, escaped-pipe row, history recreated within one poll, `sha256` in
  `/docs`. The viewer now fetches text by revision and approves the revision on screen, part of
  step 7's text-cache change, done early.
- 2026-10-30: Totals from step 7 on +1: the stale-hash 409 test (roborev job 4548).
