---
name: start-bdd-feature
description: >
  Guides through the full problem → BDD scenarios → design → plan documentation workflow for a new feature.
  Use when starting any new feature, initiative, or significant piece of work.
  Trigger phrases: "start a feature", "new feature", "/start-bdd-feature", "/start-bdd-feature <slug>".
  Claude drives content generation; user reviews and approves each doc before advancing.
  BDD scenarios and scope.md are mandatory gates before plan.md can be written.
version: 1.0.0
allowed-tools: Read, Write, Bash, Glob, Task
---

# start-bdd-feature

Four-phase state machine: PROBLEM → DESIGN → PLAN → DONE. Each phase produces a
fully-populated doc. No `<placeholder>` text is left for the user to fill in.

**The DESIGN phase has a hard gate**: BDD scenarios (`.feature` files) and a filled `scope.md`
must be written and approved by the user before `plan.md` can be drafted.

Each doc is auto-reviewed by a dedicated Opus reviewer subagent before it reaches the user — see
**Automated review** below.

---

## Setup

Before entering any phase:

**1. Get the feature slug.**

Check if an argument was passed (e.g., `/start-bdd-feature my-feature`). If yes, use it. If not,
ask: "What's the feature slug? Use kebab-case — e.g. `user-auth`, `billing-export`."

**2. Create the worktree.**

```bash
repo_root=$(git rev-parse --show-toplevel)
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/create_worktree.py" \
  "$repo_root/.worktrees/feat-<slug>" "feat/<slug>"
```

If this fails (non-zero exit), stop and report the error — do not proceed to step 3. Report the absolute worktree path to the user.

**3. Confirm or create the doc root.**

The doc root should be `$PROJECT_ROOT/feature-work/`. DO NOT WRITE TO superpower, .claude or any other directory.

If that directory does not exist, create it. ALL FEATURE WORK DOCS NEED TO GO IN THE `$DOC_ROOT`.

Announce: `Writing docs to <doc-root>/<slug>/`

```bash
mkdir -p <doc-root>/<slug>/scenarios
```

**4. Get metadata:**

```bash
date +%Y-%m-%d        # today
git config user.name  # owner
```

**5. Read the pipeline templates** (needed for reference throughout):

- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/problem.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/design.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/plan.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/story.feature`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/scope.md`

---

## Automated review (runs in every phase)

After writing a doc but **before** presenting it to the user, hand it to its reviewer subagent.
These ship with this plugin and run on Opus with read-only tools.

| Phase | Reviewer subagent |
|-------|-------------------|
| PROBLEM | `bdd-workflow:problem-reviewer` |
| DESIGN | `bdd-workflow:design-reviewer` |
| PLAN | `bdd-workflow:plan-reviewer` |

The **review step** referenced in each phase below means:

1. Use the **Task** tool to invoke the phase's reviewer. Pass the absolute path to the doc just
   written; the reviewer reads it (and any sibling docs it references) from disk.
2. When it returns, **apply every Critical and Should-fix item** yourself and re-write the doc.
   Note Suggestions but don't auto-apply them.
3. The review is **advisory** — it informs the doc before the human sees it; it does not gate
   progression. The user always gives final approval.

---

## PHASE: PROBLEM

Announce: **[PHASE: PROBLEM]**

If start-bdd-feature was launched after a discussion of the problem, then use that to fill out the problem
template yourself. If not then do these steps.

**Important** The problem doc is for stating the **problem**. It is not a solution, nor a design. No premature solutionizing.

Ask these questions **one at a time**. Wait for the complete answer before asking the next.

1. "What's the human-readable name for this feature?"
2. "What's the current situation? What's in place today that prompted this work?"
3. "What specifically is wrong, missing, or needed? Be concrete — no solutions yet."
4. "Which complexity drivers apply? For each, state it as a fact about the problem (not a solution),
   or mark N/A:
   - **Scale**: does it grow non-linearly with users/data/load?
   - **Concurrency**: are multiple writers or race conditions inherent to the problem?
   - **Failure modes**: what's the real-world consequence if this goes wrong?
   - **Cross-cutting policies**: does it involve PII, auth, secrets, observability?"
5. "What are the hard constraints? (performance, environment, integrations, timeline)"
6. "What's explicitly out of scope?"
7. "How will we know this is done? What does success look like?"

After collecting answers, read any related existing files (feature docs, source modules) to
ground the draft in real project context.

Draft `problem.md` from the template. Fill every section. Replace `<username>` with the git
owner, `YYYY-MM-DD` with today's date, and feature name throughout.

Write the draft to `<doc-root>/<slug>/problem.md`.

**Review step** (see *Automated review*): hand the file to `problem-reviewer`, apply its
Critical/Should-fix items, and re-write the doc.

Present the reviewed draft to the user along with a 2–4 line summary of what the reviewer flagged
and what you changed. Ask: "Does this problem.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/problem.md` each time.

---

## PHASE: DESIGN

Announce: **[PHASE: DESIGN]**

Read relevant project files — existing modules, patterns, anything the feature will touch —
to ground the design in real context before proposing approaches.

**Step 1: Explore the solution space**

Propose three solutions across the effort spectrum, so the trade-off is explicit:

- **Simplest** — the dumbest thing that technically works (least mechanism, fastest to ship). State
  its drawbacks: limitations, tech debt, what it punts on.
- **Complete** — the solution you'd be comfortable owning long-term: handles the complexity drivers
  properly, adds no notable tech debt, realistic on time/cost.
- **Optimal** — how you'd solve it with no time or cost constraints; the ideal. Name what it trades
  away to ship now.

For each, give a one-phrase name, a 2–3 sentence description, and the main trade-off. Then
recommend where on the spectrum to land — what drivers push above Simplest, what constraints keep
us below Optimal.

Ask: "Which solution would you like to go with?"

Then ask, one at a time:

1. "Any interfaces or APIs this design must expose or conform to?"
2. "Any data that needs to persist, and if so in what shape?"
3. "Any risks or assumptions to call out explicitly?"

---

**Step 2: Write BDD scenarios (MANDATORY GATE — must be approved before plan.md is written)**

For each distinct behavior identified in `problem.md`'s requirements and success criteria, write a
`.feature` file. Use the template at `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/story.feature`.

Save feature files to `<doc-root>/<slug>/scenarios/<behavior-slug>.feature`.
Name files after the behavior they prove (e.g. `user-login.feature`, `payment-refund.feature`).

Each `.feature` file **must** contain:
- **At least one happy-path scenario** — the main success flow
- **At least one edge-case scenario** — boundary condition or alternate flow
- **At least one failure/rejection scenario** — error path or guard condition

Rules for good Gherkin:
- `Given` sets up pre-existing state (never an action)
- `When` is the single action under test
- `Then` asserts the observable outcome — never implementation details
- Scenario names are full sentences stating the expected behavior
- Steps are concrete: specific inputs, specific outputs (no "some data", "correct response")
- No `And` chains longer than 3 lines; break into a new scenario if needed

After writing all scenario files, present them to the user and ask:
> "Do these scenarios capture all the critical behaviors for this feature?
> Are there missing scenarios, edge cases, or failure modes that should be added?"

Revise and re-write scenario files per the user's feedback.

**Do not proceed to Step 3 until the user explicitly approves the scenarios.**

---

**Step 3: Write scope.md**

Write `<doc-root>/<slug>/scope.md` from the template. By this point the design and scenarios are
settled, so all three fields can be filled concretely:

- **Objective**: one sentence distilling what this feature delivers (from the problem + chosen solution).
- **Allowlist**: paths and globs of every file/module the implementation will touch, derived from
  the design's Approach and Interfaces sections. Be specific — this is the guard against scope creep.
- **Non-goals**: anything explicitly out of scope (pull from design's Out of scope section).

---

**Step 4: Draft design.md**

Draft `design.md` from the template. The **BDD Scenarios** section must list every `.feature` file
written, with a one-line description of the behavior it proves. The **Alternatives considered**
section must include all three solutions. Set `problem: ./problem.md` in frontmatter.

Write the draft to `<doc-root>/<slug>/design.md`.

**Review step** (see *Automated review*): hand the design.md path to `design-reviewer`. The
reviewer will also read the `scenarios/` directory — pass the absolute path to the slug directory.
Apply its Critical/Should-fix items and re-write.

Present the reviewed draft to the user along with a 2–4 line summary of what the reviewer flagged
and what you changed. Ask: "Does this design.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/design.md` each time.

---

## PHASE: PLAN

Announce: **[PHASE: PLAN]**

Draft `plan.md` from the template. The plan must contain:

- **Overview**: what we're implementing, in what order, why that order (one paragraph)
- **Preconditions**: approved design, approved scenarios, filled scope.md, resolved open questions
- **Steps**: ordered, each sized for one PR or session, each with:
  - **What**: concrete change — files touched, behavior added/modified
  - **Why**: what this step unblocks or achieves
  - **Scenarios**: which `.feature` file(s) pass when this step is complete
  - **Verify**: BDD test run command + expected pass count

Every scenario in `scenarios/` must be covered by at least one plan step.
Flag any scenario not reachable by the steps as a gap.

Set frontmatter to `design: ./design.md`.

Write the draft to `<doc-root>/<slug>/plan.md`.

**Review step** (see *Automated review*): hand the file to `plan-reviewer`, apply its
Critical/Should-fix items, and re-write the doc.

Present the reviewed draft to the user along with a 2–4 line summary of what the reviewer flagged
and what you changed. Ask: "Does this plan.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/plan.md` each time.

---

## PHASE: DONE

Announce: **[PHASE: DONE]**

```bash
git add <doc-root>/<slug>/
git commit -m "docs(<slug>): add problem/design/scenarios/scope/plan"
```

Print summary:

```
✓ <doc-root>/<slug>/problem.md
✓ <doc-root>/<slug>/scenarios/<n> feature files
✓ <doc-root>/<slug>/scope.md
✓ <doc-root>/<slug>/design.md
✓ <doc-root>/<slug>/plan.md
Committed: docs(<slug>): add problem/design/scenarios/scope/plan
```

---

## After planning

Implementation happens after this workflow. Two things carry through it:

- **`deferred.md`** — as you punt nice-to-haves, edge cases, or anything descoped to ship sooner,
  append an item to `<doc-root>/<slug>/deferred.md` (create it on first use from
  `${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates/deferred.md`). It's just a running catalog;
  it gets resolved later.
- **When the work is done, run `/close-bdd-feature`** — it revisits `deferred.md` (do now / keep
  deferred / permanently drop), writes `completed.md`, and archives the feature dir.
