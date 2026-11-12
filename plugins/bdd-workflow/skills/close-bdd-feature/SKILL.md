---
name: close-bdd-feature
description: >
  Closes out a feature started with start-bdd-feature. Use when implementation is done and you're ready
  to wrap up. Revisits deferred.md (do now / keep deferred / permanently drop), writes completed.md
  summarizing what shipped, runs a reviewer over it, and archives the feature docs.
  Trigger phrases: "close a feature", "finish the feature", "wrap up", "/close-bdd-feature",
  "/close-bdd-feature <slug>".
version: 1.1.0
allowed-tools: Read, Write, Bash, Glob, Task
---

# close-bdd-feature

Two-phase wrap-up: REVISIT DEFERRED → COMPLETE → archive. Pairs with `start-bdd-feature`, which produces
`problem.md` / `design.md` / `plan.md`. This skill is the end of the lifecycle.

---

## Setup

**1. Find the feature.**

The doc root is `feature-work/` at the project root — the same root start-bdd-feature writes to.
If a slug argument was passed (`/close-bdd-feature my-feature`), use it. Otherwise list the
in-progress feature dirs (those with a
`plan.md` and **no** `completed.md`, excluding `archived/`). If exactly one, use it; if several, ask
which; if none, say so and stop.

Announce: `Closing <doc-root>/<slug>/`

**2. Get metadata:**

```bash
date +%Y-%m-%d        # today
git config user.name  # owner
```

**3. Establish the diff base.** The feature was built on a worktree/branch off the base branch.
Determine what shipped so the completion record is grounded in reality, not memory:

```bash
base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
base="${base:-main}"
git --no-pager log --oneline "$base"..HEAD
git --no-pager diff --stat "$base"...HEAD
```

**4. Read** `<doc-root>/<slug>/plan.md` (and `deferred.md` if present) plus the templates:

- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/deferred.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/completed.md`

---

## PHASE: REVISIT DEFERRED

Announce: **[PHASE: REVISIT DEFERRED]**

Skip this phase if there is no `deferred.md` (say "No deferred work to revisit.").

Walk the deferred items **one at a time** with the user. For each, agree on a resolution:

- **Do now** — small enough to finish as part of closing. With the user's OK, implement it now
  (small, self-contained changes only — anything large stays deferred). Set **Status: Done at close**.
- **Keep deferred** — still genuinely later. Update **Revisit when** and leave **Status: Kept
  deferred**.
- **Permanently dropped** — not going to happen. Leave a `TODO(<slug>): <what>` comment in the most
  relevant code location so it survives after the docs are archived, and record that location in
  **Tracked as**. Set **Status: Permanently dropped**.

Update `deferred.md` so every item has a resolved Status (none left as bare "Deferred"). Never
silently drop a **Critical**-impact item — if one is being dropped, confirm explicitly with the user.

---

## PHASE: COMPLETE

Announce: **[PHASE: COMPLETE]**

Draft `completed.md` from the template, grounded in the actual diff from Setup (not just the plan).
Fill every section: what shipped, new/modified files, dependencies, interface/config changes, known
issues/follow-ups. Link `deferred.md` under **Deferred work** (or "none"). Replace `<username>` /
`YYYY-MM-DD` / feature name throughout.

Write the draft to `<doc-root>/<slug>/completed.md`.

**Review step:** use the **Task** tool to invoke `bdd-workflow:completion-reviewer`, passing
the path to `completed.md`. It cross-checks the record against the real diff and verifies the
deferred resolutions. Apply its Critical and Should-fix items and re-write the doc.

Present the reviewed `completed.md` to the user with a 2–4 line summary of what the reviewer flagged
and what you changed. Ask: "Does this completed.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/completed.md` each time.

---

## PHASE: MUTATION TESTING

Announce: **[PHASE: MUTATION TESTING]**

Mutation testing verifies the BDD scenarios have real teeth — that they actually catch bugs in the
changed code, not just run against it. The run is scoped to source files modified in this feature
branch, so it stays fast.

**1. Identify changed source files.**

```bash
base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
base="${base:-main}"
git diff --name-only "$base"...HEAD
```

Filter the output to non-test source files only (exclude `*test*`, `*spec*`, `conftest.py`).
If no source files changed (e.g. docs-only branch), skip this phase and say so.

**2. Detect language and run mutations.**

**Python (mutmut):**

```bash
# Comma-separated list of changed source files
mutmut run --paths-to-mutate <changed_files>
mutmut results
```

Parse the results to compute the mutation score:
```bash
killed=$(mutmut result-ids killed 2>/dev/null | wc -l | tr -d ' ')
survived=$(mutmut result-ids survived 2>/dev/null | wc -l | tr -d ' ')
total=$((killed + survived))
# score = killed / total * 100
```

**Go (gremlins):**

```bash
# Derive packages from changed .go files
git diff --name-only "$base"...HEAD | grep '\.go$' | grep -v '_test\.go' \
  | sed 's|/[^/]*\.go$||' | sort -u | sed 's|^|./|'

gremlins unleash <changed_packages>
```

gremlins prints the mutation score in its summary output.

**3. Apply the gate.**

The minimum acceptable mutation score is **80%**. This threshold can be raised in `scope.md`
Part D if the team wants stricter coverage.

- Score ≥ threshold → proceed to ARCHIVE.
- Score < threshold → **BLOCKED**. Do not archive. Report:
  - The mutation score and threshold
  - The surviving mutant IDs/locations (`mutmut show <id>` or gremlins output)
  - Which scenarios, if any, would catch these mutants if extended

Show the full mutation results output as evidence (paste it, don't summarize).

**Note:** If the mutation tool is not installed, stop and report BLOCKED with installation
instructions rather than skipping the gate. Do not treat a missing tool as a pass.

---

## PHASE: ARCHIVE

Announce: **[PHASE: ARCHIVE]**

Move the feature's **docs** out of the active doc root so it reflects only in-progress work. This
phase never moves, edits, or deletes `.feature` files, step definitions, or any other test file —
they are permanent tests and stay where they are (normally `scenarios/<slug>/` and `tests/`).

**1. Guard.** Archiving must not break anything that points into the doc dir. Run both checks:

```bash
fd -e feature . <doc-root>/<slug>
rg -l --fixed-strings "<doc-root>/<slug>/" --glob '!<doc-root>/**' .
```

If either prints anything, **stop — do not archive.** List the hits to the user. `.feature`
files inside the doc dir are the old layout: they need to move to `scenarios/<slug>/` with their
bindings updated, as a separate restructuring commit the user approves. A reference in a comment
is reported too — it goes stale on archive — but the user decides whether it blocks.

**2. Baseline.** Run the full scenario suite (the "Run all scenarios" command in `design.md`) and
the project's test suite. Record the exact commands and the passed / failed / errored counts in
the conversation. Any failure or error here stops the archive — report it.

**3. Archive and commit:**

```bash
mkdir -p <doc-root>/archived
git mv <doc-root>/<slug> <doc-root>/archived/<slug>
git add -A <doc-root>/archived/<slug>
git commit -m "docs(<slug>): complete and archive feature"
```

**4. Re-verify.** Re-run the exact baseline commands. The counts must match the baseline. A
difference means something still depended on the doc dir — report it, don't paper over it.

Print summary:

```
✓ deferred.md resolved   (N done at close · N kept deferred · N permanently dropped, or "— none")
✓ completed.md written and reviewed
✓ mutation score: N% (N killed / N total) — passed ≥80% gate
✓ archived to <doc-root>/archived/<slug>/   (scenarios and tests untouched)
✓ re-verified after archive: N scenarios, N tests passed — matches baseline
Committed: docs(<slug>): complete and archive feature
```
