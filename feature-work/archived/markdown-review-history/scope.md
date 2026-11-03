---
title: Markdown Review — doc history and change diffs — Scope
type: scope
status: approved
owner: Brent Hoover
created: 2026-10-30
design: ./design.md
---

# Markdown Review — doc history and change diffs — Scope

**Objective (one sentence):** The agent records reviewable revisions of each doc. The operator sees
only those revisions, as a structure-aware rich diff with a revision picker, a full-document toggle,
and comments that carry forward marked open or addressed.

## In scope

* `revisions.cjs`: on-disk history beside each doc (`.revisions/<name>/`, `NNNN.rev`, `index.jsonl`, lock)
* `revise.cjs` CLI; `serve-doc.cjs` records revision 1 before adding to the manifest
* Server: serve revisions (`/doc/<id>`, `/doc/<id>/rev/<n>`, `/revisions/<id>`), watch indexes, push `revision` notices, inline `revision-diff.cjs`
* `revision-diff.cjs`: structure-aware diff (blocks, list items, table rows/cells, code lines, Gherkin steps, words) and `mapForward`
* Viewer: per-block rendering, diff rendering, revision controls, carried-forward comment badges, `revision` on approve/comment events
* `SKILL.md` and `DESIGN.md` updates; core plugin version bump 1.7.0 → 1.8.0 (as the last markdown-review change did)
* Tests: `node:test` suites, browser scenario runner, scenario-coverage check

## Out of scope / non-goals

* Source (line) diff view for markdown
* Reverting or editing from the browser; automatic commits; git integration
* Comment threading, replies, manual resolve
* Keeping approvals/comments across server sessions
* History following a doc across rename or move
* Sharing a doc with a teammate over a tunnel (kata `jf1t`)
* Diffing images and other assets
* Sidebar showing file names (follow-up, if the operator wants it)

## Files/areas you MAY modify (allowlist)

* `plugins/core/skills/markdown-review/scripts/revisions.cjs` (new)
* `plugins/core/skills/markdown-review/scripts/revise.cjs` (new)
* `plugins/core/skills/markdown-review/scripts/revision-diff.cjs` (new)
* `plugins/core/skills/markdown-review/scripts/serve-doc.cjs`
* `plugins/core/skills/markdown-review/scripts/server.cjs`
* `plugins/core/skills/markdown-review/scripts/viewer.html`
* `plugins/core/skills/markdown-review/scripts/viewer.js`
* `plugins/core/skills/markdown-review/tests/**` (new and existing test files, fixtures, `tests/browser/`)
* `plugins/core/skills/markdown-review/SKILL.md`
* `plugins/core/skills/markdown-review/DESIGN.md`
* `plugins/core/.claude-plugin/plugin.json`, `plugins/core/.codex-plugin/plugin.json` (`version` field only)
* `feature-work/markdown-review-history/**`
* `.gitignore` (the `.md-review/` entry, already added)

## Files/areas you must NOT touch

* `plugins/core/skills/markdown-review/scripts/wait-for-feedback.cjs` (events pass through unchanged)
* `plugins/core/skills/markdown-review/scripts/gherkin.cjs` (consumed as-is)
* `plugins/core/skills/markdown-review/scripts/marked.min.js` (vendored)
* `plugins/core/skills/markdown-review/scripts/start-server.sh`, `stop-server.sh`
* Every other plugin and skill
* `feature-work/archived/**`
