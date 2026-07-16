# Phase 3: Architecture

**[PHASE: ARCHITECTURE] (3/7)**

Context to read: the approved `docs/vision.md` (especially System shape) and
`docs/stack.md` (especially Language).

This phase produces **two** files together: `docs/architecture.md` and
`docs/arch-rules.yaml`.

1. Propose an architecture style fitting the system shape and language
   idioms — e.g. hexagonal for a service (`domain` / `services` /
   `adapters`), a simpler layered set for a CLI. Present the proposed module
   list as a table (name, purpose, may_import) and ask: "Do these
   boundaries look right? Merge, split, rename, or re-wire any of them."
   Wait for the user's answer before continuing.
2. Iterate on the module graph — apply the user's feedback, re-present the
   table, ask again — until the user is happy. Wait for an answer after
   each round before moving on. Module names become package directories at
   scaffold time (Python `src/<root>/<module>`, Go `internal/<module>`), so
   each name must be a valid package identifier in the chosen language:
   lowercase, no spaces, underscores not hyphens (`web_api`, never
   `web-api` or `user service`). Rename in step 1/2 rather than letting an
   invalid name reach the YAML.
3. Ask: "Any extra constraints beyond the import graph — e.g. banning
   cycles?" Wait for the answer. The `may_import` list is a **whitelist**:
   "don't let A import B" is already expressed by leaving B out of A's
   `may_import`, so there is no separate `forbid` rule — if the user asks to
   forbid a pair, remove that edge from `may_import` in step 1/2 instead.
   `no_cycles` is enforced by the **architecture-reviewer**, which checks the
   declared `may_import` graph is acyclic before approval; the generated
   tests don't do independent cycle detection — they keep the code within the
   (already-acyclic) declared graph via the allowlist, so no cycle can arise.
   Do **not** record anything neither the reviewer nor the tests can enforce
   (naming conventions, layer labels, file-size limits) — tell the user those
   belong in a lint config, not `arch-rules.yaml`, and leave them out.

Draft `docs/architecture.md` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/architecture.md`,
`status: draft`. Draft `docs/arch-rules.yaml` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/arch-rules.yaml`,
matching this schema exactly:

```yaml
version: 1
language: <from stack.md frontmatter — python | go | other>
root: <package name — ask if not obvious from the slug; python/go: a valid package/module identifier (underscores not hyphens for Python, lowercase for a Go module directory); other: a lowercase slug>
modules:
  - name: <module>                # valid package identifier — lowercase,
                                  # underscores not hyphens, no spaces
    may_import: [<module>, ...]   # [] means imports no sibling modules
rules:
  # `no_cycles` is the only supported rule — the architecture-reviewer checks
  # the declared may_import graph is acyclic (the generated tests don't do
  # independent cycle detection; the allowlist keeps code within that graph).
  # To forbid a dependency, omit it from may_import. No naming/label/size
  # rules — nothing enforces them.
  - no_cycles: true
```

Hard rule, verbatim in the file:

```markdown
**The .md and .yaml must agree exactly** — same module names, same
may_import lists. The architecture-reviewer diffs them. `may_import` is the
source of truth (a dependency you don't want is simply left out of it);
`rules:` holds only `no_cycles`.
```

Run the hub's **Review step** (reviewer: `start-project:architecture-reviewer`),
passing it both `docs/architecture.md` and `docs/arch-rules.yaml`.

Run the hub's **Present step**, asking: "Do architecture.md and
arch-rules.yaml look right? Any changes?"

Run the hub's **Approval gate**, committing both files together.
