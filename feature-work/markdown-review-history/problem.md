---
title: Markdown Review — doc history and change diffs — Problem Statement
type: problem
status: approved
owner: Brent Hoover
created: 2026-10-30
updated: 2026-10-30
---

# Markdown Review — doc history and change diffs — Problem Statement

## User Story

As the operator reviewing agent-authored docs in the markdown-review viewer,
I want to see exactly what changed between the versions the agent hands me, and whether my
comments were addressed,
so that I can re-review and approve a revised doc without re-reading all of it.

## Context

The `markdown-review` skill (`plugins/core/skills/markdown-review/`) serves agent-authored docs to
the operator's browser. `server.cjs` polls each doc in the session manifest with `fs.watchFile`
(1s interval) and, when its mtime or size changes, broadcasts `{"type":"reload","id":N}`. The
viewer (`viewer.js`) then re-fetches `GET /doc/<id>`, which the server reads from disk on every
request, and replaces what is on screen with the current file content. A sidebar dot marks a doc
as "updated since last viewed", and an approval clears when the doc's mtime moves past the
approval. Both of these states live in the browser, in in-memory maps in `viewer.js`.

A typical review runs several rounds. The operator comments and submits, and the agent edits the
docs in place. Roborev reviews add more rounds, and the agent edits again. Many of these edits are
never committed between rounds: roborev reviews commits, but the fixes it triggers sit in the
working tree until the next commit, and some docs are new, untracked files.

The agent usually changes a doc with several separate writes during one round. Today nothing marks
where a round of edits ends. The viewer reloads on each write, so the operator can't tell whether
what's on screen is finished.

Session state lives in `<project>/.md-review/<session>/` (or `/tmp` without `--project-dir`), which
SKILL.md asks users to gitignore. A server restart creates a new session dir.

## Problem

1. **The operator can't see what changed.** After a reload the viewer shows only the latest
   content. To work out what the agent changed, the operator has to re-read the whole doc and
   compare it against their memory of the previous version.
2. **No record of earlier versions exists.** The server keeps nothing between requests. Once a doc
   is overwritten, its previous content can't be seen in the viewer, and nothing survives a server
   restart.
3. **Git doesn't fill the gap.** Edits between commits, edits to untracked files, and docs outside
   a git repo leave no git history to diff against. Even when history exists, a raw `git diff` of
   markdown is hard to read compared with seeing the changed text in context.
4. **No signal says a revision is ready.** The agent has no way to say "this round of edits is done,
   review it". The operator has no fixed point to review or diff against, and may review or approve
   a doc that is half-revised.
5. **Re-approval and comment follow-up cost a full re-read.** An edit clears the approval. Comments
   are anchored by quote, line, or block index into the version the operator commented on, and
   after an edit those anchors may no longer point at the same text. The operator can't confirm
   that a comment was addressed, or that nothing else changed, without reading the whole doc again.

## Complexity drivers

- **Scale**: N/A — bounded by one reviewer, about 10 docs per session, docs of a few KB, and tens of
  review rounds per doc.
- **Concurrency**: The agent writes docs while the server is polling them. A non-atomic write can be
  observed half-written. The operator may be viewing or approving a doc while the agent is still
  editing it.
- **Failure modes**: A change shown wrongly or missed means the operator approves content they never
  saw. That is the real risk, because approval is the sign-off that moves the work forward. Losing
  history doesn't damage the docs themselves, since files on disk stay the source of truth.
- **Cross-cutting policies**: Doc content may contain anything the project holds, and history copies
  that content. Today's session dir is gitignored (`.md-review/`); history has to be committable,
  so it can't live only there. The viewer is session-key-gated and binds to localhost by default,
  though `--host` can bind beyond it. No PII, auth, or secrets handling is specific to this feature.
- **Existing Data or Systems**: Sessions already have an append-only `state/events` file. Its
  comment events carry no version identity: an event has `doc`, `view`, `blockIndex`, `line`,
  `quote`, `occurrence` and `timestamp`, but nothing ties it to a version of the doc. Viewers and
  agents in use today read that event format and the `reload` WebSocket message.

## Constraints

- Node only. No npm dependencies and no runtime downloads. Third-party browser code is vendored
  into `scripts/` (as `marked.min.js` is today).
- Must not require git or depend on git state.
- Covers every doc type the viewer serves: rendered markdown, Gherkin `.feature`, and plain source.
- The existing feedback contract stays compatible: event format, `events` append-only file,
  `wait-for-feedback.cjs` exit codes, approve semantics.
- History is stored as plain files that the operator can choose to commit to git.
- Tests run with `node --test tests/`, as the existing suite does.

## Success criteria

- The agent can **revise** a doc: record its current content as a revision that is ready for
  review. Each revision is recorded in the doc's history. History starts with the first draft the
  agent revises for approval.
- The viewer shows only recorded revisions. Edits on disk after a revise don't change what the
  operator sees until the agent's next revise.
- After the agent revises a doc, the operator sees a rich diff in the viewer: the rendered doc with
  added content highlighted in green and removed content shown in red, against the previous
  revision. The operator doesn't need to read unchanged parts to find the changes.
- From the diff, the operator can switch to the full revised doc without diff markup, and back.
- Comments made on an earlier revision still appear on later revisions, at the text they were
  made on. Each one shows whether that text changed in a later revision (addressed) or not
  (still open). A comment whose text was removed is still shown, marked as addressed by removal.
- Changes that were never committed to git are shown the same way as committed ones.
- The operator can browse a doc's earlier revisions and see the rich diff between any revision and
  the one before it.
- History survives a server restart and is stored as plain files in the project that can be
  committed to git.
- An approval is tied to a specific revision. After a later revision, the operator can see the diff
  against that approved revision.
- Content captured mid-write is never recorded as a revision.
- `SKILL.md` tells the agent when and how to revise a doc as part of the review loop, and
  `DESIGN.md` describes revisions, history storage, and the rich diff. An agent that follows
  only `SKILL.md` produces reviewable revisions without being told separately.
- `node --test tests/` is green, including new tests for revision capture and diffing.

## Open questions

- [x] **Diff presentation.** Rich diff only (operator, 2026-10-30).
- [x] **Baseline.** Diffs are against the previous revision. The agent revises a doc when its
      edits are complete and ready for review or re-review (operator, 2026-10-30).
- [x] **Lifetime.** History persists across restarts, as files that can be committed (operator,
      2026-10-30).
- [x] **In-progress edits.** The viewer doesn't update a doc until the agent's next revise
      (operator, 2026-10-30).
- [x] **First revision.** History starts with the first draft the agent revises for approval
      (operator, 2026-10-30).
- [x] **Name.** The agent's ready-for-review action is **revise**, distinct from the operator's
      Submit comments (operator, 2026-10-30).

## Change log

- 2026-10-30: Initial draft (Brent Hoover)
- 2026-10-30: Applied problem-reviewer findings: added approval-version and half-written-read
  criteria, removed the presentation decision from success criteria, restated cross-cutting
  policies as facts, and added a non-goal for unobserved intermediate writes.
- 2026-10-30: Resolved open questions per operator: rich diff only, agent-marked revisions as
  the diff baseline, and history persisted as committable files. Revised problems, criteria, and
  non-goals to match, and added two open questions about in-progress edits and unmarked docs.
- 2026-10-30: Resolved the last two open questions per operator: the viewer shows only submitted
  revisions, and history starts at the first submitted draft.
- 2026-10-30: Named the agent's ready-for-review action **revise**, so it doesn't collide with the
  operator's Submit comments.
- 2026-10-30: Added a success criterion for updating `SKILL.md` and `DESIGN.md` (operator).
- 2026-10-30: Reopened per operator when choosing the Optimal design. Comments now carry forward
  across revisions with addressed/open status, so the non-goal was narrowed to threading and
  manual resolution. Added a criterion for switching from the diff to the full revised doc.
- 2026-10-30: Applied roborev job 4516: added the User Story and the Existing Data or Systems driver.
  The non-goals moved to design.md Out of scope, per the doc contract. No requirement changed.
