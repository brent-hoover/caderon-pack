---
title: Markdown Review — doc history and change diffs — Design
type: design
status: approved
owner: Brent Hoover
created: 2026-10-30
updated: 2026-10-30
problem: ./problem.md
---

# Markdown Review — doc history and change diffs — Design

## Summary

The agent records revisions of a doc explicitly. `serve-doc.cjs` records revision 1, and a new
`revise.cjs` records each later revision when a round of edits is ready. Each revision is a full
copy, written under a per-doc lock, into `.revisions/<doc name>/` beside the doc, with an
append-only index. The server serves revisions instead of the working file, and pushes a notice
only when a new revision lands.

A new dual-loaded module, `revision-diff.cjs`, computes a structure-aware diff between any two
revisions. It diffs top-level blocks first, then list items, table rows and cells, code lines and
Gherkin steps, then words. The viewer renders the doc with additions in green and removals in red.
It adds a revision picker, a Full document / Show changes toggle, and a "Changes since approved"
shortcut. Comments and approvals record the revision they were made on. Earlier comments carry
forward onto later revisions, marked open or addressed.

## BDD Scenarios

| Feature file | Behavior proven |
|---|---|
| `scenarios/revise-records-revisions.feature` | `serve-doc` records revision 1 and `revise` records later revisions. Unchanged content is a no-op. Unserved and missing docs are rejected. |
| `scenarios/viewer-shows-revisions.feature` | The browser changes only on a revise. Unrevised edits are invisible. History survives a restart. Missing history gives a 404 rather than being silently re-created. |
| `scenarios/rich-diff.feature` | Inline word changes, added and removed blocks, a single list item, a single table cell, a single code line, a Gherkin step, a plain-text line, and identical revisions. |
| `scenarios/revision-navigation.feature` | Opens in diff view, switches to the full doc and back, compares any two revisions, shows changes since approval, handles a single revision, rejects an inverted range. |
| `scenarios/comments-carry-forward.feature` | Carried-forward comments are marked addressed, open, or addressed by removal. Events without a revision are treated as revision 1. A comment that can't be anchored is shown at doc level. |
| `scenarios/feedback-carries-revision.feature` | Approve and comment events carry `revision`. An approval goes stale after a revise. Approve is disabled on an older revision. |
| `scenarios/skill-instructions.feature` | `SKILL.md` documents the revise step, that unrevised edits are not visible, and the `revision` field. |

Run all scenarios:
`node --test plugins/core/skills/markdown-review/tests/ && plugins/core/skills/markdown-review/tests/browser/run.sh`

### Which seam proves each scenario

`node:test` can't drive the viewer DOM, so each scenario is proven at a named seam:

| Feature file | Seam | Runner |
|---|---|---|
| `revise-records-revisions` | `revise.cjs` / `serve-doc.cjs` processes against a temp dir | `node --test` |
| `viewer-shows-revisions` | `server.cjs` HTTP and WebSocket | `node --test` |
| `rich-diff` | **Diff tree** from `revision-diff.cjs`, one test per scenario: the paragraph is one `changed` node, its word runs are exactly `30` removed and `60` added, and so on. The rendering of each node kind is also checked in the browser. | `node --test` + browser |
| `comments-carry-forward` | **`mapForward`** result per scenario (state, revision, target index). The badge text and card placement are checked in the browser. | `node --test` + browser |
| `revision-navigation` | Viewer DOM | browser |
| `feedback-carries-revision` | Viewer DOM and the recorded events file. The `revision` field is set by the viewer, so only a browser can prove it. | browser |
| `skill-instructions` | Text checks over `SKILL.md` | `node --test` |

- **Naming.** Each `node:test` test is named exactly after its scenario. The browser runner
  `tests/browser/run.sh` drives `agent-browser` against a live server with fixture docs, and prints
  one `ok <scenario name>` or `not ok <scenario name>` line per scenario.
- **Coverage check.** `tests/scenario-coverage.test.cjs` reads the scenario names from
  `feature-work/markdown-review-history/scenarios/`, or from
  `feature-work/archived/markdown-review-history/scenarios/` once archived. It fails loudly if
  neither exists. It also fails if a scenario has neither a `node:test` test of that name nor an
  entry in the runner's scenario list (`tests/browser/scenarios.txt`).

## Approach

### Components

| Module | Purpose | Status |
|---|---|---|
| `scripts/revisions.cjs` | Reads and writes a doc's revision history on disk. | new |
| `scripts/revise.cjs` | CLI that records a new revision for served docs. | new |
| `scripts/serve-doc.cjs` | Records a revision through `revisions.cjs`, then adds the doc to the manifest. | changed |
| `scripts/server.cjs` | Serves revisions, watches revision indexes instead of doc files, and inlines `revision-diff.cjs` into the page. | changed |
| `scripts/revision-diff.cjs` | Diffs two parsed revisions into a diff tree, and maps anchors forward across diffs. | new, dual-loaded like `gherkin.cjs` |
| `scripts/viewer.html` | Adds a `<!-- REVISION_DIFF_JS -->` placeholder and the diff/revision CSS. | changed |
| `scripts/viewer.js` | Per-block rendering, diff rendering, revision controls, carried-forward comments, revision-tagged events. | changed |
| `SKILL.md`, `DESIGN.md` | Agent contract and skill design. | changed |

Layering: `revise.cjs`, `serve-doc.cjs` and `server.cjs` import `revisions.cjs`.
`revision-diff.cjs` imports nothing: it receives tokens, blocks or lines from its caller. In the
page its top-level functions become globals, the same as `gherkin.cjs`. Nothing imports the CLIs
or the server.

### Recording a revision (`revisions.cjs`)

`recordRevision(docPath)` does the whole check-and-write under one lock:

1. **Take the lock.** Create `.revisions/<name>/lock` with the `wx` flag and write our pid. On
   `EEXIST`, read the pid in it:
   - if that process is dead, remove the lock and retry;
   - otherwise retry every 50ms, for up to 5s, then throw "revision lock held by pid N on
     `<path>`".

   This is the same pattern as `wait-for-feedback`'s `watcher.pid`.
2. **Clean up.** Delete any `*.tmp` left in the dir. A temp file can only come from a writer that
   died, because we now hold the lock.
3. **Read the doc.** If it is missing, throw "no such file: `<path>`".
4. **Check for changes.** Hash the content (SHA-256). If the hash equals the latest index entry's,
   release the lock and return `{status: 'unchanged', revision: N}`.
5. **Write the file.** Write `NNNN.rev.tmp`, `fsync` it, and rename it to `NNNN.rev`. `N` is the
   last index revision + 1.
6. **Append the index.** Append one JSON line to `index.jsonl` in a single `appendFileSync` call.
   Release the lock and return `{status: 'revised', revision: N}`.

Only the lock holder writes, so numbers can't collide. If a writer crashes after step 5, it leaves
an unindexed `NNNN.rev`. The next writer reuses that number and its rename overwrites the file,
because the index decides the numbering. `readIndex(docPath)` parses only complete lines, so the
partial last line of an in-flight append is ignored. `recordedEvents()` already uses this rule.

### Serving revisions (`server.cjs`)

- **Watching.** `syncDocWatchers()` watches `<doc dir>/.revisions/<name>/index.jsonl` with
  `fs.watchFile` (1s) instead of the doc file. `watchFile` accepts a path that doesn't exist yet.
  When the index gains a line, the server broadcasts `{"type":"revision","id":N,"revision":R}`,
  which replaces `reload`. Writes to the doc itself trigger nothing.
- **`GET /doc/<id>`** returns the latest revision. When there's no index, or the index is empty,
  it returns `404` with the body `"<path> has no revisions — run serve-doc or revise"`. It never
  falls back to the working file.
- **`GET /doc/<id>/rev/<n>`** returns revision `n`. It is routed by a new pattern, because
  `docById` only accepts `^\d+$`. A non-integer `n`, an out-of-range `n`, or a missing file returns
  `404`.
- **`GET /revisions/<id>`** returns the index as `[{revision, timestamp, sha256}, …]`.
- **`GET /docs`.** Entries gain `revision`: the latest revision, or `null`. `mtime` stays for
  compatibility, and the viewer stops using it.
- **`viewerPage()`** inlines `revision-diff.cjs` at `<!-- REVISION_DIFF_JS -->`, after
  `marked.min.js`.
- **Existing tests.** The server tests `/doc/<id> returns raw markdown` and
  `/docs lists … mtimes` (`tests/server.test.cjs:97,105`) are updated: they serve docs through
  `serve-doc.cjs`, so a revision exists.

### Block identity

There is one definition of a markdown **block index**: the position of a token among the
**non-`space`** top-level tokens from `marked.lexer`. Full view and diff view both render each
such token separately, with `marked.parser([token])`, into its own `<div class="block">` wrapper.
Wrapper *i* is block *i*, even for an `html` comment that renders nothing visible, or an HTML
token that renders several elements. Today the index is `pane.children` after `marked.parse`;
that changes to this wrapper index.

- **Gherkin.** A block is one entry from `parseGherkinBlocks`, as today.
- **Plain source.** A block is one line, as today.
- **Old events.** An event without `revision` is read as revision 1. Its `blockIndex` is only a
  tie-breaker after `quote` and `occurrence`, as today, so an index under the old scheme degrades
  to a nearest-match tie-break and never decides the anchor.

### Diffing (`revision-diff.cjs`)

The module is pure and doesn't touch the DOM. Node tests load `marked.min.js` through `vm`,
because a plain `require` returns nothing under the repo's `"type": "module"` (verified
2026-10-30). The tests then pass tokens in.

- **`diffSequence(a, b, isSame)`** — an LCS over two arrays. It returns
  `[{op: 'equal'|'removed'|'added', a?, b?}]`. O(n·m) is fine for a few KB.
- **`pairChanges(ops)`** — within a run of `removed` items directly followed by a run of `added`
  items, pairs them one-for-one in order into `changed`, when both have the same kind (same token
  type, or same Gherkin block kind). Anything left over stays `removed` or `added`.
- **Normalized raw** — `raw` with trailing whitespace trimmed on each line and `\r\n` turned into
  `\n`.
- **`diffMarkdown(tokensA, tokensB)`** — diffs the non-space top-level tokens by normalized raw,
  then pairs. A `changed` pair descends by token type:

  | Token type | Descends to |
  |---|---|
  | `list` | items via `diffSequence` on item raw, then a changed item's text to words |
  | `table` | the header cells by position, the rows via `diffSequence` on row text, then the cells of a changed row by position |
  | `code` | lines via `diffSequence`, then the words of a changed line |
  | `paragraph`, `heading`, `blockquote` | words |
  | anything else | a whole-block `removed` plus `added` |

- **`diffWords(inlineTokensA, inlineTokensB)`** — "words" are built from the block's inline tokens
  (`token.tokens` from the lexer). Plain `text` tokens split on whitespace. `strong`, `em`, `del`,
  `codespan`, `link` and `image` tokens are each one atomic word, so no tag ever lands inside an
  emphasis run or a link. A change inside `**30 seconds**` marks the whole bold phrase.
- **`diffGherkin(blocksA, blocksB)`** — diffs blocks by key (kind + title). Two blocks with the
  same key but different lines become `changed`, and descend to lines via `diffSequence` and then
  to words. A block whose title changed in place shows up as a `removed`+`added` of the same kind
  in the same spot, and `pairChanges` turns that into `changed`. Its comments are therefore
  "addressed", not "removed".
- **`diffLines(textA, textB)`** — lines via `diffSequence`, then the words of a changed line. It
  is used for plain-text docs, and for the Source view's anchor mapping (see carry-forward).

The output is a **diff tree**. Each node carries its op, its base and target block indexes (where
they exist), and its children or word runs. The tree also exposes `isIdentical`.

### Rendering the diff (viewer)

| Node kind | How it's built |
|---|---|
| `equal` block | Rendered as in the full view. |
| `added` / `removed` block | Rendered as in the full view, in a wrapper with class `d-added` (green) or `d-removed` (red). Removed blocks are not commentable. |
| `changed` paragraph / heading / blockquote | The block's markdown is rebuilt from its words, with removed words wrapped in `<del class="d-del">` and added words in `<ins class="d-add">`, then passed through `marked.parser`. |
| `changed` list | A list element is built. Each item is equal, added or removed (rendered with `marked.parseInline`, plus a class), or changed (rebuilt from its words as above). |
| `changed` table | A table element is built from the tokens. A changed cell is rebuilt from its words with `marked.parseInline`. Added and removed rows get the row classes. |
| `changed` code, Gherkin lines, plain-text lines | DOM is built directly, the way `renderSource`/`renderGherkin` do today, with `<span class="d-add">`/`<span class="d-del">` per word run. Nothing goes through `marked`, so nothing gets escaped. |

**Render check.** After a rebuilt block renders:

- with `del` elements removed, its `textContent` must equal the target block's own rendered
  `textContent`;
- with `ins` elements removed, it must equal the base block's.

If either check fails, the block falls back to a whole-block `removed` plus `added`.

### Comment carry-forward

`mapForward(diffChain, index)` follows one anchor index from revision `r` through the diffs
`r→r+1→…→N`, using only the top-level ops at each step. It returns one of:

| Result | Meaning |
|---|---|
| `{state: 'open', index}` | The anchor is `equal` at every step. |
| `{state: 'addressed', revision: k, index}` | `k` is the first step where the anchor is `changed`. After that it keeps being followed to its index in revision N. |
| `{state: 'removed', revision: k, afterIndex}` | The anchor was dropped at step `k`. `afterIndex` is the nearest earlier surviving block in revision N, or -1. |

The diff chain is built for the view the comment was made in:

- `rendered` comments use `diffMarkdown` over the markdown blocks;
- `gherkin` comments use `diffGherkin`;
- `source` comments, and every comment on a plain-text doc, use `diffLines`, with the line as the
  index.

**Locating a comment in its own revision `r`.** The viewer uses today's quote, then occurrence,
then index anchoring against revision `r`'s own anchors. It computes them by rendering `r`
off-screen in a detached element. If the quote matches nothing, the comment goes to the doc-level
list, marked "anchor not found".

**Card badges:**

- "open";
- "addressed in revision k";
- "addressed in revision k (text removed)". In diff view this card sits on the removed block. In
  the full doc it sits after block `afterIndex`.

**Comments made in diff view.** They take `quote`, `occurrence` and `blockIndex` from the
**target revision's unmarked block**, the anchor list of the target's full render, found through
the node's target index. They never take them from the diff DOM, whose text mixes `<del>` and
`<ins>` words.

### Viewer state and controls

- **Text cache.** `textCache` is keyed by path plus revision, so `"<path>#<rev>"`.
- **Approvals.** `approved` becomes a map of path to approved revision. It is rebuilt from
  `approve` events on load; today it is set by click only and kept in memory. An approval is
  current while its revision is the latest.
- **Last viewed revision.** Stored per path in `localStorage`, with every access in try/catch,
  degrading to "none". It is written each time a revision is rendered as the target. If the
  stored value is greater than the latest (history deleted, then recreated), it is ignored.
- **Opening a doc.** If the last viewed revision is older than the latest, the doc opens in diff
  view from that revision to the latest. Otherwise it opens the latest revision in full.
- **Header controls:**
  - "Revision N of M";
  - base and target selects;
  - a **Show changes / Full document** toggle, disabled when M = 1;
  - **Changes since approved (rev K)**, shown when an approval exists and K < M.

  If the operator picks a base ≥ the target, the viewer keeps the previous comparison and flashes
  "Base revision must be older than the target". When the two revisions are identical, the
  header reads "No changes between revision A and revision B".
- **New revision.** On a `revision` message, if the doc is current, the viewer re-renders the diff
  from the shown target to the new revision. Otherwise it sets the sidebar dot. A stale approval
  removes the sidebar check and shows "Changes since approved".
- **Approve.** It sends the target's `revision`. It is disabled, with the hint "Approve the latest
  revision", when the target is not the latest.
- **Comments.** They carry the target's `revision`.
- **Source view.** It shows the selected revision's source, without a diff.

## Interfaces

**CLI**

```bash
node revise.cjs [--session-dir <dir>] <path>…
# one JSON line per path on stdout:
# {"type":"revised","doc":"/abs/plan.md","revision":2}
# {"type":"unchanged","doc":"/abs/plan.md","revision":2}
# exit 1, stderr "revise: <path> is not served in <session_dir> — add it with serve-doc.cjs first"
# exit 1, stderr "revise: no such file: <path>"
# exit 1 when no live session (same check and message style as serve-doc)
```

`serve-doc.cjs` records the revision **before** it writes the manifest, so a served doc always has
a revision when the viewer first fetches it. It prints a `revised` or `unchanged` line per path,
then its existing `docs-added` line.

**HTTP** (all behind the existing session-key auth)

| Route | Change |
|---|---|
| `GET /docs` | entries gain `revision` |
| `GET /doc/<id>` | latest revision, or 404 `"<path> has no revisions — run serve-doc or revise"` |
| `GET /doc/<id>/rev/<n>` | new |
| `GET /revisions/<id>` | new |
| WebSocket | server→client `reload` is replaced by `{"type":"revision","id":N,"revision":R}` |

**Events** (additive)

```jsonl
{"type":"comment","doc":"/abs/plan.md","revision":2,"view":"rendered","blockIndex":4,"quote":"…","selection":null,"comment":"…","timestamp":…}
{"type":"approve","doc":"/abs/plan.md","revision":2,"timestamp":…}
```

`submit` is unchanged. `wait-for-feedback.cjs` passes events through untouched, so its behavior
and exit codes don't change.

## Data model

```
<doc dir>/.revisions/<doc file name>/
  index.jsonl      # one line per revision, append-only; authoritative
  0001.rev         # full content of revision 1
  0002.rev
  lock             # present only while a revise runs
```

```jsonl
{"revision":1,"timestamp":1793384000000,"sha256":"<hex>"}
```

- **File names.** Revision files use `.rev`, an extension no tool claims, so BDD runners,
  markdown linters, roborev and `rg -g '*.md'` don't pick up old copies. The doc type comes from
  the doc's path, which the directory name holds.
- **Numbering.** Revisions are numbered from 1 and the file names are zero-padded to 4 digits.
  Wider numbers stay valid, because file names are derived from the index.
- **Git.** History is not gitignored. `git add feature-work/<slug>/` includes it, and the
  `close-bdd-feature` archive move carries it along.

## Alternatives considered

### Simplest

A whole-block LCS diff against the previous revision only. A changed block shows as a full removed
block plus a full added block. There is no picker, no "changes since approved", and no comment
carry-forward.

**Drawbacks:** a single changed word in a long paragraph still means comparing two paragraphs by
eye. History can't be browsed in the viewer.

### Complete

A block diff plus a word-level diff, a revision picker that diffs against the previous revision,
approvals tied to revisions with "changes since approved", and all three views.

**Drawbacks:** a changed list item or table cell marks the whole list or table. Comments aren't
carried forward, so checking that a comment was addressed stays manual.

### Optimal

Complete, plus a structure-aware diff (list items, table rows and cells, code lines, Gherkin
steps), any two revisions compared, and comments carried forward with addressed/open status.

**Trades away:** about twice the viewer work of Complete. It required reopening the problem's
non-goal on resolution tracking.

### Decision

**Optimal** (operator, 2026-10-30), with history beside the doc, `serve-doc` recording revision 1,
and revise as a CLI.

- **Why above Simplest and Complete:** the failure-mode driver. The real risk is that the operator
  approves content they never saw. Marking changes at item, cell and word level, and having
  comments show whether they were addressed, guards against that most directly.
- **What stops it going further:**
  - No vendored diff library. A new dependency needs approval, and an LCS over a few KB doesn't
    need one.
  - No inline diff finer than atomic inline tokens.
  - No re-anchoring of the operator's selected text.

## Risks

- **Inline tag injection breaks markdown.** This is mitigated by:
  - atomic inline tokens (emphasis, code, links, images), so a tag never lands inside them;
  - the render check against the unmarked base and target text;
  - falling back to a whole-block diff when the check fails.

  Rich-diff tests use emphasis and link fixtures.
- **Pairing mispairs blocks.** When a section is both reordered and edited, unrelated blocks can
  be paired and show a confusing word diff. Nothing is hidden, so the diff stays complete. A
  comment may be reported "addressed" when its block really moved. Accepted.
- **Approvals and comments don't survive a server restart.** They live in
  `<session>/state/events`, and a restart creates a new session dir. History survives, but after a
  restart "Changes since approved" and carried-forward comments start empty. This is a stated
  limitation: the problem requires history to survive a restart, not feedback. Keeping events
  across sessions is out of scope.
- **Deleted text stays in history.** Text the agent removes from a doc stays in `.revisions/`,
  for example a pasted secret or an internal hostname, and `git add <dir>` commits it. The
  mitigation is to delete that revision's directory, or to gitignore `.revisions/` in repos where
  this matters. `SKILL.md` says so.
- **The agent forgets to revise.** The operator then sees stale content. That's intended: it's
  the in-progress rule. `SKILL.md` makes revise a step of the loop, before arming the watcher.
- **Change from `reload` to `revision` over the WebSocket.** An already-open tab running the old
  viewer JS ignores `revision` messages until the page reloads. That happens on its own after a
  restart longer than the 15s tombstone (`viewer.js:83-91`). After a quicker restart the operator
  has to reload the tab by hand. `SKILL.md`'s upgrade note says so.

## Out of scope

- A source (line) diff view for markdown.
- Reverting or editing from the browser; automatic commits; git integration.
- Comment threading, replies, or manual resolve.
- Keeping events (approvals and comments) across server sessions.
- History following a doc across a rename or move. A moved doc starts new history.
- Sharing a doc with a teammate over a tunnel. That's a separate feature, kata `jf1t`.
- Diffing images and other assets.

## Additional tests (beyond the scenarios)

- **Concurrent revises.** Two `recordRevision` processes started together on a changed doc produce
  revisions 1 and 2. Both files match their index hashes, and the index has no duplicate lines.
- **Stale lock.** A lock held by a dead pid is taken over. A leftover `.tmp` is removed, and the
  revise succeeds.
- **No half-written revision.** A revision file only exists under its final name after its
  content is complete. This covers the criterion "content captured mid-write is never recorded".
- **`DESIGN.md` covers the feature.** It has sections on revisions, history storage and the rich
  diff (checked in the same test file as the `skill-instructions` scenarios).

## Open questions

- [x] Restart limitation accepted for now (operator, 2026-10-30): approvals and comments start empty
      after a restart. Revision files use `.rev` (operator, 2026-10-30).

## Change log

- 2026-10-30: Options draft for choosing an approach (Brent Hoover)
- 2026-10-30: Full design for the Optimal option. History lives beside the doc, `serve-doc`
  records revision 1, revise is a CLI, and there is a Full document toggle (operator decisions).
- 2026-10-30: Applied design-reviewer findings. A per-doc lock now covers the whole revise.
  Diff-view comments take their anchor from the target's unmarked block. Defined a single block
  index with per-token rendering. Added the Gherkin `changed` rule, rendering for each node kind,
  the render-text check with atomic inline tokens, and source-view carry-forward. `serve-doc`
  records before adding to the manifest. Added a seam-per-scenario test map, an archive-proof
  coverage check, `.rev` file names, and the restart and deleted-text risks. Added tests for
  concurrency and `DESIGN.md`.
