# Phase 7: Scaffold

**[PHASE: SCAFFOLD] (7/7)**

Context to read: the approved `docs/architecture.md`, `docs/arch-rules.yaml`,
`docs/STORIES.md`, and `docs/stack.md`.

This phase produces a scaffolded repo — architecture tests green on an empty
skeleton, BDD specs generated from `docs/STORIES.md` red — plus the
`docs/scaffold.md` stamp. It is the only phase that writes code.

**Every step below is guarded for re-entry.** The hub's Resume can land here
mid-scaffold (e.g. `docs/scaffold.md` exists with `status: draft`, or a prior
run got partway through the language steps). Before doing a step's work,
check whether its output already exists on disk. If it does, verify it
matches what this step would produce and continue to the next step — never
redo an init, never overwrite an existing skeleton file, never re-generate a
test file that's already there. Only step 4's exit gate always reruns, since
its evidence must reflect the current state of the repo, not a stale run.

1. Read `docs/stack.md` frontmatter `language:`.
   - `python` → also read
     `${CLAUDE_PLUGIN_ROOT}/skills/start-project/phases/scaffold-python.md`
   - `go` → also read
     `${CLAUDE_PLUGIN_ROOT}/skills/start-project/phases/scaffold-go.md`
   - anything else → fill `docs/scaffold.md` from
     `${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/scaffold.md`,
     noting "language <X> not supported for scaffolding; docs and
     arch-rules.yaml are complete" — same frontmatter contract as the
     language-supported case, with the test-command and skeleton-commit
     fields marked N/A. Run the hub's **Present step**, run the hub's
     **Approval gate**, and end the workflow here — do not attempt steps 2–4
     below.
2. Read `docs/arch-rules.yaml` (module list and `may_import` edges) and
   `docs/STORIES.md` (epics and stories) — both feed the language file's
   steps B–D. If you already read them for step 1's language check, don't
   re-read; just carry the module list and epic/story structure forward.
3. Run the language file's steps A–E in order (init, skeleton, arch test,
   BDD specs, run). Each of those steps is itself guarded — before creating
   a step's output (e.g. `pyproject.toml` / `go.mod` for step A, module
   directories for step B, `tests/test_architecture.py` /
   `architecture_test.go` for step C, `tests/features/*.feature` for step
   D), check whether it already exists and skip straight to verifying it if
   so.
4. Common finishing steps, below.

Common finishing steps, verbatim:

```markdown
- README.md stub: project name, one-liner from vision.md, "start with
  docs/PLAN.md slice 1", link to docs/. If README.md already exists with
  this content, skip.
- .gitignore appropriate to the language. It **must** also ignore the
  workflow's own scratch dirs — `.md-review/` and `.superpowers/` — which
  earlier phases may have created in this project (the Present step uses
  markdown-review); otherwise the `git add -A` below sweeps them into the
  scaffold commit. If a .gitignore is already present, ensure those two
  entries are in it (append if missing) rather than skipping outright.
- **Exit gate — evidence, not claims.** Run the language file's step E
  commands and paste real output: architecture tests GREEN, BDD specs
  RED/skipped. If arch tests are not green, fix the skeleton (not the
  rules) until they are — the rules were approved in phase 3. Always rerun
  this on re-entry; a stale pasted result from an earlier session is not
  evidence.
- Once the exit gate passes, commit the skeleton — but **exclude
  docs/scaffold.md** so a leftover draft stamp from an earlier resume pass
  isn't swept into the "skeleton" commit:
  `git add -A -- ':!docs/scaffold.md' && git commit -m "feat: scaffold skeleton"`.
  This is the commit docs/scaffold.md's "Skeleton commit" field
  references — capture its sha (`git rev-parse HEAD`) before moving on. If a
  skeleton commit already exists from an earlier pass and nothing but
  docs/scaffold.md is dirty (the code is unchanged), reuse its sha instead
  of committing again.
- Fill docs/scaffold.md from
  `${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/scaffold.md`
  (language, commands, counts, the skeleton commit sha captured above),
  status: draft. If it already exists
  with status: draft, update it with the fresh exit-gate output and sha
  rather than rewriting from scratch; if status: approved, this phase is
  already done — report that and stop.
- Run the hub's **Review step** with `start-project:scaffold-reviewer` (it
  has Bash; it re-runs the tests and checks the tree matches
  architecture.md and the generated tests derive from arch-rules.yaml /
  STORIES.md). Apply every Critical/Should-fix finding to the generated
  code. **If applying fixes changed any code**, the skeleton commit is now
  stale: rerun the exit gate, remake the skeleton commit so it includes the
  fixes (`git add -A -- ':!docs/scaffold.md' && git commit --amend
  --no-edit` if it's still HEAD, else a fresh `feat: scaffold skeleton`
  commit), capture the new sha, and update docs/scaffold.md's counts and
  Skeleton-commit sha before presenting. The recorded sha must point at the
  final, reviewed skeleton.
- Run the hub's **Present step**: docs/scaffold.md + the test output. Ask:
  "Scaffold complete — approve?"
- Run the hub's **Approval gate**: flip status, `git add -A && git commit -m
  "feat: scaffold — skeleton, arch tests green, bdd specs red"`. This
  second commit covers docs/scaffold.md itself — the skeleton commit above
  already covers the code, so the sha it recorded stays valid.
- Close: "Project planned and scaffolded. Implementation = make the red
  specs pass, slice by slice per docs/PLAN.md, using your feature-level
  workflow (e.g. /start-feature) inside this repo."
```
