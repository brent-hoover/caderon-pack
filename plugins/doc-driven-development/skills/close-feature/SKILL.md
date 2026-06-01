---
name: close-feature
description: >
  Closes out a feature started with start-feature. Use when implementation is done and you're ready
  to wrap up. Revisits deferred.md (do now / keep deferred / permanently drop), writes completed.md
  summarizing what shipped, runs a reviewer over it, and archives the feature docs.
  Trigger phrases: "close a feature", "finish the feature", "wrap up", "/close-feature",
  "/close-feature <slug>".
version: 1.0.0
allowed-tools: Read, Write, Bash, Glob, Task
---

# close-feature

Two-phase wrap-up: REVISIT DEFERRED → COMPLETE → archive. Pairs with `start-feature`, which produces
`problem.md` / `design.md` / `plan.md`. This skill is the end of the lifecycle.

---

## Setup

**1. Find the feature.**

If a slug argument was passed (`/close-feature my-feature`), use it. Otherwise detect the doc root
the same way start-feature does — read the project `CLAUDE.md`: if it mentions `feature-work/` the
root is `feature-work/`, otherwise `docs/`. List the in-progress feature dirs (those with a
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

- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/deferred.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/completed.md`

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

**Review step:** use the **Task** tool to invoke `doc-driven-development:completion-reviewer`, passing
the path to `completed.md`. It cross-checks the record against the real diff and verifies the
deferred resolutions. Apply its Critical and Should-fix items and re-write the doc.

Present the reviewed `completed.md` to the user with a 2–4 line summary of what the reviewer flagged
and what you changed. Ask: "Does this completed.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/completed.md` each time.

---

## PHASE: ARCHIVE

Announce: **[PHASE: ARCHIVE]**

Move the feature dir out of the active doc root so it reflects only in-progress work, then commit:

```bash
mkdir -p <doc-root>/archived
git mv <doc-root>/<slug> <doc-root>/archived/<slug>
git add -A <doc-root>/archived/<slug>
git commit -m "docs(<slug>): complete and archive feature"
```

Print summary:

```
✓ deferred.md resolved   (N done at close · N kept deferred · N permanently dropped, or "— none")
✓ completed.md written and reviewed
✓ archived to <doc-root>/archived/<slug>/
Committed: docs(<slug>): complete and archive feature
```
