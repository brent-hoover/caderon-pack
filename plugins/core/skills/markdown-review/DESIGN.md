# markdown-review skill — design

2026-07-07. Status: approved (pending spec review). Updated 2026-10-07 for the
feedback watcher, per-file-type views and resizable sidebar — rationale in
`feature-work/archived/markdown-review-feedback-loop/design.md` at the repo root.
Updated 2026-10-30 for revisions, history and rich diffs — rationale in
`feature-work/markdown-review-history/design.md` (or its `archived/` copy).

## Purpose

When an agent authors markdown docs (plans, designs, reports) it wants the user
to read, it starts a local viewer server and the user's browser opens to a
rendered view. The user reads, attaches comments inline, and the agent picks
the comments up on its next turn. No digging into the worktree. When the agent
revises a doc, the user sees what changed as a rich diff instead of re-reading
it.

Forked from the superpowers brainstorming visual companion
(`superpowers/6.1.1/skills/brainstorming/scripts/server.cjs`), which already
solves auth, browser events, and lifecycle.

## Layout

```
~/.claude/skills/markdown-review/
  SKILL.md               # agent instructions
  DESIGN.md              # this doc
  scripts/
    server.cjs           # forked + adapted server
    start-server.sh      # launcher; prints startup JSON
    stop-server.sh
    serve-doc.cjs        # record revision 1, then register doc paths with a running session
    revise.cjs           # record a served doc's next revision
    revisions.cjs        # read and write a doc's revision history on disk
    revision-diff.cjs    # structure-aware diff between revisions; comment carry-forward
    wait-for-feedback.cjs # deliver a doc's comments when it is submitted or approved
    gherkin.cjs          # split .feature source into commentable blocks
    viewer.html          # full-page viewer: sidebar + revision bar + doc pane + comment UI
    viewer.js            # client logic (injected into viewer.html at serve time)
    marked.min.js        # vendored markdown renderer, served locally
  tests/
    *.test.cjs           # node --test suites
    browser/run.cjs      # viewer checks driven through agent-browser
```

## Core model: manifest of docs, revisions of each

The fork serves copies from a content dir. Here, docs stay where they live in
the worktree. The session keeps `<session_dir>/manifest.json` — a JSON array of
absolute file paths, maintained by `serve-doc.cjs` (append, dedupe). What the
user sees of a doc is its **revisions**, not the working file (see Revisions).
The server:

- watches the manifest (`fs.watchFile`, 1s poll) — add/remove docs at runtime
- watches each listed doc's revision index (`fs.watchFile`, 1s poll) — never
  the doc itself, so the agent's in-progress edits stay invisible
- serves **only** manifest docs' revisions and their assets (below) — nothing
  else on disk is reachable. This replaces the fork's "inside content dir"
  check.

Doc identity: index in the manifest array (`id`). Sidebar order = manifest
order. Sidebar title: first `# h1` in the doc, else the filename (derived
client-side).

## Revisions

A revision is a full copy of a doc that the agent declared ready for review.
`serve-doc.cjs` records revision 1 when it adds a doc (before writing the
manifest, so a listed doc always has one); `revise.cjs` records each later
one. Recording content identical to the latest revision is a no-op.

"Never recorded mid-write" rests on that protocol: revise reads the doc only
when the agent runs it, after its edits; the server never reads the working
file.

`recordRevision` (`revisions.cjs`) runs under a per-doc lock
(`.revisions/<name>/lock`, `wx`, holding the pid). A lock whose pid is dead
fails loudly ("stale revision lock … delete the lock file") instead of being
taken over: two writers recovering the same stale lock could delete each
other's fresh one. Under the lock it truncates a partial index line a dead
writer left, removes leftover temp files, compares the content hash with the
latest entry, writes `NNNN.rev` (temp file, fsync, rename), then appends the
index line.

## History storage

```
<doc dir>/.revisions/<doc file name>/
  index.jsonl      # {"revision","timestamp","sha256"} per line, append-only; authoritative
  0001.rev         # full content of revision 1
  lock             # present only while a revise runs
```

- `.rev`, not the doc's extension, so BDD runners, markdown linters and doc
  reviewers that glob `*.md` / `*.feature` never pick up old copies.
- Plain files, not gitignored: history survives server restarts, moves with
  the doc's directory, and is committed by `git add <dir>`. Deleted doc text
  stays in history; removing `.revisions/<doc file name>/` is the remedy.
- Because history can arrive from a checkout, it is untrusted input:
  `revisions.cjs` refuses symlinks anywhere in the history path (index, lock
  — read with `O_NOFOLLOW` and a bounded read — and revision files), accepts
  only index entries with a positive integer `revision` and a hex `sha256`,
  and builds file names only from validated numbers.
- A revision file without its index line (a revise that crashed between the
  rename and the append) is not a revision and is never served.

## HTTP surface

All routes behind the fork's session-key auth (`?key=` or cookie,
constant-time compare) and security headers, unchanged.

- `GET /?key=…` — bootstrap page (unchanged from fork)
- `GET /` — `viewer.html` with `viewer.js`, `marked.min.js`, `gherkin.cjs` and
  `revision-diff.cjs` inlined
- `GET /docs` — `[{ "id": 0, "path": "/abs/path/plan.md", "mtime": …, "revision": 2, "sha256": "…" }, …]`
  (`revision`/`sha256` of the latest revision, or `null`)
- `GET /doc/<id>` — the latest revision's content; 404 "`<path>` has no
  revisions — run serve-doc or revise" when there is none (never the working
  file)
- `GET /doc/<id>/rev/<n>[?sha256=<hex>]` — revision `n`. 404 unless `n` has an
  index entry; 409 if `sha256` is given and differs from the index (history
  was recreated under the viewer), or if the file's content no longer hashes
  to its index entry
- `GET /revisions/<id>` — the doc's index entries
- `GET /events` — the session's recorded events (complete lines of
  `state/events`) as a JSON array; the viewer rebuilds comment cards and
  approvals from it
- `GET /asset/<id>/<relpath>` — asset referenced by doc `id`; resolved against
  the doc's directory. Servable iff `realpath(asset)` is inside
  `realpath(dirname(doc))` (subdirs ok, symlink-escape rejected), regular file,
  extension in an image/asset allowlist (png, jpg, jpeg, gif, svg, webp).
- WebSocket — server→client `{"type":"revision","id":N,"revision":R}` (a new
  latest index entry, compared by revision + timestamp + hash so recreated
  history is announced) and `{"type":"manifest"}`; client→server comment
  events (below)

## Viewer UI

Single dark/light page (`prefers-color-scheme`), GitHub-ish typography.

- **Sidebar**: doc list; click to switch; a dot marks docs revised since last
  viewed. Newest-added doc auto-selected on first load and when a new doc
  appears while the user is on the waiting screen. Titles: first `# ` heading
  (markdown), `Feature:` name (`.feature`), else the file name; hover shows
  the absolute path. A check marks a doc whose latest revision is approved.
  Drag handle on the right edge resizes it (180px–50% of the window,
  remembered in `localStorage`).
- **Views by extension**: `.md`/`.markdown` → rendered (below); `.feature` →
  Gherkin blocks from `gherkin.cjs` (one commentable block per Feature,
  Background, Rule, Scenario); anything else → numbered source lines, one
  commentable row per line. Markdown and Gherkin docs have a Source toggle,
  which shows the selected revision's source without a diff. Comment markers
  are kept per view.
- **Doc pane (rendered view)**: one wrapper per block — a non-space top-level
  `marked` token, with HTML containers that span tokens (`<details>` around
  markdown) grouped into one — so wrapper *i* is block *i* in both the full
  and the diff view. Relative image `src`s are rewritten to
  `/asset/<id>/<relpath>`. Raw HTML in markdown renders as-is (agent-authored
  content, key-gated, localhost — not a sanitization boundary).
- **Revision bar** (under the header): "Revision N of M", base and target
  selects (a base not older than the target is rejected with a toast),
  **Show changes / Full document**, **Changes since approved (rev K)** when
  the approval is older than the latest, and the comparison summary. Text is
  fetched per revision with its hash (`?sha256=`); only successful loads are
  cached. Renders are generation-numbered: a superseded one is discarded, and
  what is drawn and what Approve would approve change together, after every
  load has finished.
- **Opening a doc**: with revisions newer than the last one viewed (kept per
  path in `localStorage`, every access in try/catch), it opens as the diff
  from that one; otherwise the latest revision in full. A revision arriving
  for the doc on screen re-renders as the diff from the revision shown.
- **Comments**: every block gets a hover affordance; click → popover with
  textarea, bound to the doc it was opened on. If the user has text selected
  inside the block, the selection is captured. Every saved comment shows as a
  card after the element it comments on (doc-level ones above the footer
  box), badged *pending* or *sent*; cards are rebuilt from `GET /events` on
  load. Comments from earlier revisions are carried forward (see Rich diff)
  and also badged *open* or *addressed in revision k*. Comments don't wake the
  agent: **Submit comments (N)** in the header sends a `submit` event for the
  current doc's pending comments (per doc).
- **Approve**: per-doc button, enabled only while the latest revision is on
  screen ("Approve the latest revision" otherwise). Click emits an approve
  event for that revision (which also sends pending comments). The approval
  is current while its revision and hash are the doc's latest.

## Rich diff

`revision-diff.cjs` is pure (no DOM, no lexing): callers pass `marked` tokens,
Gherkin blocks or text, and a renderer. Inlined into the page and `require()`d
by the tests, like `gherkin.cjs`.

- **Sequence diff**: LCS over blocks, then `pairChanges` turns a removal run
  followed by an addition run into `changed` pairs — one-for-one of the same
  kind always; in longer runs, same-kind items sharing ≥30% of their words.
- **Equality is by rendered output** at every level (blocks, list items with
  their checkbox state, table rows as arrays of cells), on cloned tokens
  (`marked` mutates some while rendering). Changed reference-link
  definitions and hard breaks therefore count as changes.
- **Descent**: a changed list diffs its items, a table its rows then cells, a
  code fence its lines, a blockquote its blocks, a paragraph or heading its
  words. Words: whitespace-split text, with `strong`/`em`/`del`/`codespan`/
  `link`/`image` atomic so a marker never lands inside them. Gherkin blocks
  match by kind + title (a renamed block pairs as changed) and diff by line,
  then word; plain text by line, then word.
- **Rendering**: equal blocks as in the full view; added blocks green, removed
  red; changed paragraphs, headings, list items and cells rebuilt from word
  runs with `<ins class="d-add">`/`<del class="d-del">` and checked — without
  its `del`s the result must read as the target, without its `ins`s as the
  base — else shown as removed + added. Code, Gherkin and plain-text lines are
  built as DOM. A heading level change, a checkbox toggle and a dropped
  column show as removed + added.
- **Comment carry-forward**: a comment is located in its own revision
  (quote, occurrence, index) and followed through each adjacent diff to the
  target in its view's units: *open* if unchanged throughout, *addressed in
  revision k* at the first change, *addressed … (text removed)* if dropped —
  shown on the removed block when the diff on screen has it, else after the
  nearest surviving earlier block. A comment whose quote matches nothing in
  its own revision goes to doc level as "Anchor not found". Comments made in
  the diff view take their anchor from the target revision's unmarked block.

## Feedback events

Appended by the server to `<state_dir>/events` (JSONL), same plumbing as the
fork, two differences: the file is **append-only** — never cleared by the
server, the watcher, or the agent — and events are keyed to docs by path so
they survive manifest reordering.

`wait-for-feedback.cjs --session-dir <dir>` (run by the agent in the
background) keeps a byte offset in `state/events.cursor` (just past the last
trigger delivered), waits for a new `submit` or `approve` event, prints it with
the comments on its doc that no earlier trigger covered, advances the cursor,
and exits — waking the agent. Comments on other docs wait for their own
trigger. Comments alone never wake
it (a review produces one every 10–30s; the user decides when a batch is
done). One watcher per session
(`state/watcher.pid`; `--status` reports liveness; exit 4 if one is already
running). Exit 3 when the server stops or the session dir is removed, after
delivering anything pending, submitted or not. Delivery is at-least-once.

If `CMUX_SURFACE_ID` is set, the server also runs one
`cmux notify --surface … --desktop false` per submit or approve, summarising
that doc's comments since its last one
(`MDREVIEW_CMUX_BIN` overrides the binary for tests).

```jsonl
{"type":"comment","doc":"/abs/path/plan.md","revision":2,"view":"rendered","blockIndex":12,"quote":"first ~120 chars of block text","selection":"exact selected text or null","comment":"…","timestamp":1234567890}
{"type":"comment","doc":"/abs/path/plan.md","revision":2,"view":"source","line":42,"quote":"text of that line","selection":null,"comment":"…","timestamp":1234567890}
{"type":"comment","doc":"/abs/path/a.feature","revision":1,"view":"gherkin","blockIndex":3,"line":28,"scenario":"…","quote":"Scenario: …","selection":null,"comment":"…","timestamp":1234567890}
{"type":"comment","doc":"/abs/path/plan.md","revision":2,"scope":"doc","comment":"…","timestamp":1234567890}
{"type":"approve","doc":"/abs/path/plan.md","revision":2,"sha256":"…","timestamp":1234567890}
{"type":"submit","doc":"/abs/path/plan.md","timestamp":1234567890}
```

`revision` (added 2026-10-30; absent means revision 1) is the revision the
user was viewing; anchors refer to it. An approval counts only while its
`revision` is the doc's latest and no comment on the doc follows it.
Approvals without `revision` (older viewers) aren't tied to content and the
viewer ignores them.

`quote` is the primary anchor (agent greps it in that revision's source);
`blockIndex` is secondary.

## Lifecycle / CLI

Kept from the fork: backgrounding launcher, startup JSON on stdout +
`state_dir/server-info`, port+token persistence for same-port restart (open
tab reconnects), idle timeout (default 4h), owner-PID watchdog, `--open`
browser launch, `--host`/`--url-host`/`--foreground` escape hatches.
Stripped: superpowers branding, remote logo image, telemetry env handling,
frame-template/content-fragment machinery.

- `start-server.sh --project-dir <root> [--open] [--host H] [--url-host H]
  [--idle-timeout-minutes N] [--foreground | --background]`
  Session dir: `<root>/.md-review/<pid>-<epoch>/` containing `manifest.json`
  and `state/`. Port/token files live at `<root>/.md-review/` so restarts
  reuse them. Prints `{"type":"server-started","url":…,"session_dir":…,
  "state_dir":…,"port":…}`.
- `serve-doc.cjs [--session-dir <dir>] <path>…`
  Resolves each path to absolute, records its revision (`revised` /
  `unchanged` line per path), then appends to the manifest (dedupe, keep
  order). Default session dir: newest under `<cwd>/.md-review/`. Errors if no
  live session (checks `state/server-info` exists and `state/server-stopped`
  doesn't).
- `revise.cjs [--session-dir <dir>] <path>…` — same session lookup; each path
  must already be in the manifest. Prints a `revised` / `unchanged` line per
  path; exit 1 with the reason otherwise.
- `stop-server.sh <session_dir>` — signals the server; session dir persists
  (it's in the project; remind user to gitignore `.md-review/`).

## Agent workflow (SKILL.md contract)

1. Start server once per session with `--project-dir <project root> --open`.
2. `serve-doc.cjs <path>` for each doc once its first draft is ready. Share
   the full URL (with `?key=`) as fallback; browser auto-opens on the first
   doc.
3. Say what's on screen, ask for feedback, arm `wait-for-feedback.cjs` in
   the background (after a `--status` check), end turn.
4. When the watcher exits, act on the events it printed, merged with any
   terminal message; apply feedback by editing docs in place, then
   `revise.cjs` the docs changed — the user sees the new revision as a diff.
   Re-arm before ending each turn. An `approve` event for a doc's latest
   revision (with no comments after it) means the user signed off — proceed
   without re-asking.
5. Before referencing the URL again, confirm the server is alive
   (`server-info` exists, `server-stopped` doesn't); restart with the same
   `--project-dir` if not. History survives; approvals and comments stay with
   the old session.
6. `stop-server.sh` when the review session is done.

## Out of scope

- Editing markdown or reverting to a revision in the browser; committing
  history automatically; reading git history
- A line-based source diff for markdown (the diff is on the rendered doc)
- Comment threading, replies, manual resolve
- Keeping approvals and comments across server sessions
- History following a doc across a rename or move
- Diffing images and other assets
- Syntax highlighting, mermaid diagrams (Gherkin rendering is in since
  2026-10-07; non-English Gherkin keywords are not)
- Non-image assets (video, fonts); non-sibling assets (absolute paths, URLs
  pass through untouched)

## Dependencies

Vendored `marked.min.js` (MIT, ~40KB) fetched once at build time and committed
into the skill. No runtime downloads, no npm, no CDN. Node (present via
Claude Code) is the only runtime requirement; the browser checks also need
`agent-browser`.
