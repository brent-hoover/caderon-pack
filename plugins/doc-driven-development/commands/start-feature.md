---
name: start-feature
description: Guided problem → design → plan documentation workflow for a new feature
argument-hint: Optional feature slug (e.g. user-auth, billing-export)
---

Four-phase state machine: PROBLEM → DESIGN (optional) → PLAN → DONE. Each phase produces a
fully-populated doc. No `<placeholder>` text is left for the user to fill in.

---

## Setup

Before entering any phase:

**1. Get the feature slug.**

Check if an argument was passed (e.g., `/start-feature my-feature`). If yes, use it. If not,
ask: "What's the feature slug? Use kebab-case — e.g. `user-auth`, `billing-export`."

**2. Detect doc convention** by reading the project's `CLAUDE.md` with the Read tool:

- Mentions `feature-work/` → doc root is `feature-work/`
- Otherwise → doc root is `docs/`

Announce: `Writing docs to <doc-root>/<slug>/`

Create the directory:

```bash
mkdir -p <doc-root>/<slug>
```

**3. Get metadata:**

```bash
date +%Y-%m-%d        # today
git config user.name  # owner
```

**4. Read the three pipeline templates:**

- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/problem.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/design.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/plan.md`

---

## PHASE: PROBLEM

Announce: **[PHASE: PROBLEM]**

Ask these questions **one at a time**. Wait for the complete answer before asking the next.

1. "What's the human-readable name for this feature?"
2. "What's the current situation? What's in place today that prompted this work?"
3. "What specifically is wrong, missing, or needed? Be concrete — no solutions yet."
4. "What's the simplest possible solution — the dumbest thing that would technically work?"
5. "Which complications apply? For each, say whether it applies and what it forces:
   - **Scale**: grows non-linearly with users/data/load?
   - **Concurrency**: multiple writers or race conditions?
   - **Failure modes**: what breaks if the simplest solution fails?
   - **Cross-cutting policies**: PII, auth, secrets, observability?"
6. "What are the hard constraints? (performance, environment, integrations, timeline)"
7. "What's explicitly out of scope?"
8. "How will we know this is done? What does success look like?"

After collecting answers, read any related existing files (feature docs, source modules) to
ground the draft in real project context.

Draft `problem.md` from the template. Fill every section. Replace `<username>` with the git
owner, `YYYY-MM-DD` with today's date, and feature name throughout.

Present the draft. Ask: "Does this problem.md look right? Any changes?"

Revise until approved. Write to `<doc-root>/<slug>/problem.md`.

**Transition question:**

> "Is this feature complex enough to warrant a design doc, or is the approach already obvious?
> (Trivial → we skip straight to the plan.)"

- Trivial → jump to **[PHASE: PLAN]**
- Not trivial → continue to **[PHASE: DESIGN]**

---

## PHASE: DESIGN

Announce: **[PHASE: DESIGN]**

Read relevant project files — existing modules, patterns, anything the feature will touch —
to ground the design in real context before proposing approaches.

**Propose 2–3 approaches.** For each:

- Name (one phrase)
- Description (2–3 sentences)
- Main trade-off
- Whether you recommend it and why

Ask: "Which approach would you like to go with?"

Then ask, one at a time:

1. "Any interfaces or APIs this design must expose or conform to?"
2. "Any data that needs to persist, and if so in what shape?"
3. "Any risks or assumptions to call out explicitly?"

Draft `design.md` from the template. The **Alternatives considered** section must include every
approach proposed above plus the chosen one with rationale. Set `problem: ./problem.md` in
frontmatter.

Present the draft. Ask: "Does this design.md look right? Any changes?"

Revise until approved. Write to `<doc-root>/<slug>/design.md`.

---

## PHASE: PLAN

Announce: **[PHASE: PLAN]**

Draft `plan.md` from the template. The plan must contain:

- **Overview**: what we're implementing, in what order, why that order (one paragraph)
- **Preconditions**: approved design, resolved open questions, dependencies available
- **Steps**: ordered, each sized for one PR or session, each with:
  - **What**: concrete change — files touched, behavior added/modified
  - **Why**: what this step unblocks or achieves
  - **Verify**: how to confirm it worked (tests, command, manual check)

Set frontmatter to `design: ./design.md` (or `design: ./problem.md` if design was skipped).

Present the draft. Ask: "Does this plan.md look right? Any changes?"

Revise until approved. Write to `<doc-root>/<slug>/plan.md`.

---

## PHASE: DONE

Announce: **[PHASE: DONE]**

```bash
git add <doc-root>/<slug>/
git commit -m "docs(<slug>): add problem/design/plan"
```

Print summary:

```
✓ <doc-root>/<slug>/problem.md
✓ <doc-root>/<slug>/design.md     (or "— skipped (trivial feature)")
✓ <doc-root>/<slug>/plan.md
Committed: docs(<slug>): add problem/design/plan
```

---

## Additional templates (outside the main pipeline)

**deferred.md** — write when a planned item is intentionally skipped during implementation.
Document what was skipped and the specific reason. Review at project close.

Read from: `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/deferred.md`

**completed.md** — write when the feature ships. The handoff manifest: new modules,
dependencies, interface changes, follow-ups.

Read from: `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/completed.md`

**Archiving**: once `completed.md` is written, move `<doc-root>/<slug>/` to
`<doc-root>/archived/<slug>/` so the doc root reflects only current in-progress work.
