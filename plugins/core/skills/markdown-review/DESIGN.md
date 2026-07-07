# markdown-review skill — design

2026-07-07. Status: approved (pending spec review).

## Purpose

When an agent authors markdown docs (plans, designs, reports) it wants the user
to read, it starts a local viewer server and the user's browser opens to a
rendered view. The user reads, attaches comments inline, and the agent picks
the comments up on its next turn. No digging into the worktree.

Forked from the superpowers brainstorming visual companion
(`superpowers/6.1.1/skills/brainstorming/scripts/server.cjs`), which already
solves auth, live-reload, browser events, and lifecycle.

## Layout

```
~/.claude/skills/markdown-review/
  SKILL.md               # agent instructions
  DESIGN.md              # this doc
  scripts/
    server.cjs           # forked + adapted server
    start-server.sh      # launcher; prints startup JSON
    stop-server.sh
    serve-doc.cjs        # register doc paths with a running session
    viewer.html          # full-page viewer: sidebar + doc pane + comment UI
    viewer.js            # client logic (injected into viewer.html at serve time)
    marked.min.js        # vendored markdown renderer, served locally
```

## Core model: manifest, not copies

The fork serves copies from a content dir. Here, docs stay where they live in
the worktree. The session keeps `<session_dir>/manifest.json` — a JSON array of
absolute file paths, maintained by `serve-doc.cjs` (append, dedupe). The server:

- watches the manifest (`fs.watchFile`, 1s poll) — add/remove docs at runtime
- watches each listed doc (`fs.watchFile`, 1s poll) — agent edits a doc in
  place, browser live-reloads it
- serves **only** manifest paths and their assets (below) — nothing else on
  disk is reachable. This replaces the fork's "inside content dir" check.

Doc identity: index in the manifest array (`id`). Sidebar order = manifest
order. Sidebar title: first `# h1` in the doc, else the filename (derived
client-side).

## HTTP surface

All routes behind the fork's session-key auth (`?key=` or cookie,
constant-time compare) and security headers, unchanged.

- `GET /?key=…` — bootstrap page (unchanged from fork)
- `GET /` — `viewer.html` with `viewer.js` + `marked.min.js` inlined
- `GET /docs` — `[{ "id": 0, "path": "/abs/path/plan.md", "mtime": … }, …]`
- `GET /doc/<id>` — raw markdown body of manifest entry `id`
- `GET /asset/<id>/<relpath>` — asset referenced by doc `id`; resolved against
  the doc's directory. Servable iff `realpath(asset)` is inside
  `realpath(dirname(doc))` (subdirs ok, symlink-escape rejected), regular file,
  extension in an image/asset allowlist (png, jpg, jpeg, gif, svg, webp).
- WebSocket — server→client `{"type":"reload","id":N}` and
  `{"type":"manifest"}`; client→server comment events (below)

## Viewer UI

Single dark/light page (`prefers-color-scheme`), GitHub-ish typography.

- **Sidebar**: doc list; click to switch; a dot marks docs updated since last
  viewed. Newest-added doc auto-selected on first load and when a new doc
  appears while the user is on the waiting screen.
- **Doc pane**: `marked.parse()` of the raw markdown. Relative image `src`s
  are rewritten to `/asset/<id>/<relpath>` before insertion. Raw HTML in
  markdown renders as-is (agent-authored content, key-gated, localhost — not
  a sanitization boundary).
- **Comments**: every top-level rendered block (headings, paragraphs, lists,
  code fences, tables, blockquotes) gets a stable index and a hover affordance;
  click → popover with textarea. If the user has text selected inside the
  block, the selection is captured in the event. Commented blocks keep a
  visible marker for the rest of the session. A fixed doc-level comment box
  sits at the bottom of the pane, next to an **Approve** button.
- **Approve**: per-doc button; click emits an approve event and marks the doc
  approved (checkmark in sidebar and pane header). Approval is per doc
  content — if the doc's mtime changes after approval, the mark clears and a
  fresh approve is required.
- Live reload preserves the currently selected doc and scroll position
  (best effort), and re-applies commented-block markers by block index.

## Feedback events

Appended by the server to `<state_dir>/events` (JSONL), same plumbing as the
fork, two differences: events are **not** cleared when docs change (the agent
truncates the file after reading), and events are keyed to docs by path so
they survive manifest reordering.

```jsonl
{"type":"comment","doc":"/abs/path/plan.md","blockIndex":12,"quote":"first ~120 chars of block text","selection":"exact selected text or null","comment":"…","timestamp":1234567890}
{"type":"comment","doc":"/abs/path/plan.md","scope":"doc","comment":"…","timestamp":1234567890}
{"type":"approve","doc":"/abs/path/plan.md","timestamp":1234567890}
```

An approve event only counts if no later edit touched the doc: the agent
treats a doc as approved iff an `approve` event exists with `timestamp` ≥ the
doc's current mtime-relevant edits (in practice: approve is the last event
for that doc and the agent hasn't edited it since).

`quote` is the primary anchor (agent greps it in the source file);
`blockIndex` is secondary.

## Lifecycle / CLI

Kept from the fork: backgrounding launcher, startup JSON on stdout +
`state_dir/server-info`, port+token persistence for same-port restart (open
tab reconnects), idle timeout (default 4h), owner-PID watchdog, `--open`
browser launch, `--host`/`--url-host`/`--foreground` escape hatches.
Stripped: superpowers branding, remote logo image, telemetry env handling,
frame-template/content-fragment machinery.

- `start-server.sh --project-dir <root> [--open] [--host H] [--url-host H]
  [--idle-timeout-minutes N] [--foreground]`
  Session dir: `<root>/.md-review/<pid>-<epoch>/` containing `manifest.json`
  and `state/`. Port/token files live at `<root>/.md-review/` so restarts
  reuse them. Prints `{"type":"server-started","url":…,"session_dir":…,
  "state_dir":…,"port":…}`.
- `serve-doc.cjs [--session-dir <dir>] <path>…`
  Resolves each path to absolute, appends to the manifest (dedupe, keep
  order). Default session dir: newest under `<cwd>/.md-review/`. Errors if no
  live session (checks `state/server-info` exists and `state/server-stopped`
  doesn't).
- `stop-server.sh <session_dir>` — signals the server; session dir persists
  (it's in the project; remind user to gitignore `.md-review/`).

## Agent workflow (SKILL.md contract)

1. Start server once per session with `--project-dir <project root> --open`.
2. `serve-doc.cjs <path>` for each doc to show. Share the full URL (with
   `?key=`) as fallback; browser auto-opens on the first doc.
3. Say what's on screen, ask for feedback, end turn.
4. Next turn: read `<state_dir>/events`, merge with the user's terminal
   message, **truncate the events file**, apply feedback by editing docs in
   place (live reload shows the new version). An `approve` event for a doc
   (with no comments after it and no edits since) means the user signed off —
   proceed without re-asking.
5. Before referencing the URL again, confirm the server is alive
   (`server-info` exists, `server-stopped` doesn't); restart with the same
   `--project-dir` if not.
6. `stop-server.sh` when the review session is done.

## Out of scope (v1)

- Editing markdown in the browser
- Comment threading / resolution UI
- Syntax highlighting, mermaid diagrams
- Non-image assets (video, fonts); non-sibling assets (absolute paths, URLs
  pass through untouched)

## Dependencies

Vendored `marked.min.js` (MIT, ~40KB) fetched once at build time and committed
into the skill. No runtime downloads, no npm, no CDN. Node (present via
Claude Code) is the only runtime requirement.
