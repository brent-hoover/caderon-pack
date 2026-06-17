---
name: close-bdd-feature
description: Wrap up a feature — revisit deferred work, write the completion record, and archive the docs
argument-hint: Optional feature slug (e.g. user-auth, billing-export)
---

Two-phase wrap-up: REVISIT DEFERRED → COMPLETE → archive. Pairs with `/start-bdd-feature`, which produces
`problem.md` / `design.md` / `plan.md`. This is the end of the lifecycle.

---

## Setup

**1. Find the feature.**

If a slug argument was passed (`/close-bdd-feature my-feature`), use it. Otherwise detect the doc root by
reading the project `CLAUDE.md`: If the feature-work directory does not exists, create it. List the in-progress feature dirs (those with a `plan.md` and **no**`completed.md`, excluding `archived/`). If exactly one, use it; if several, ask which; if none, say
so and stop.

Announce: `Closing feature-work/<slug>/`

**2. Get metadata:**

```bash
date +%Y-%m-%d        # today
git config user.name  # owner
```

**3. Establish the diff base** so the completion record is grounded in what actually shipped:

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

Skip if there is no `deferred.md` ("No deferred work to revisit.").

Walk the deferred items **one at a time** with the user. For each, agree on a resolution:

- **Do now** — small enough to finish while closing. With the user's OK, implement it now (small,
  self-contained changes only — anything large stays deferred). Set **Status: Done at close**.
- **Keep deferred** — still genuinely later. Update **Revisit when**; leave **Status: Kept deferred**.
- **Permanently dropped** — not happening. Leave a `TODO(<slug>): <what>` comment in the most
  relevant code location so it survives the archive, and record that location in **Tracked as**. Set
  **Status: Permanently dropped**.

Update `deferred.md` so every item has a resolved Status. Never silently drop a **Critical** item —
confirm explicitly with the user first.

---

## PHASE: COMPLETE

Announce: **[PHASE: COMPLETE]**

Draft `completed.md` from the template, grounded in the actual diff from Setup. Fill every section:
what shipped, new/modified files, dependencies, interface/config changes, known issues/follow-ups.
Link `deferred.md` under **Deferred work** (or "none"). Replace `<username>` / `YYYY-MM-DD` / feature
name throughout.

Write the draft to `<doc-root>/<slug>/completed.md`.

**Review step:** use the **Task** tool to invoke `doc-driven-development:completion-reviewer`, passing
the path to `completed.md`. Apply its Critical and Should-fix items and re-write the doc.

Present the reviewed `completed.md` with a 2–4 line summary of what the reviewer flagged and what you
changed. Ask: "Does this completed.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/completed.md` each time.

---

## PHASE: ARCHIVE

Announce: **[PHASE: ARCHIVE]**

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
