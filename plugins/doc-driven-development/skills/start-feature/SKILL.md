---
name: start-feature
description: >
  Guides through the full problem → design → plan documentation workflow for a new feature.
  Use when starting any new feature, initiative, or significant piece of work.
  Trigger phrases: "start a feature", "new feature", "/start-feature", "/start-feature <slug>".
  Claude drives content generation; user reviews and approves each doc before advancing.
version: 1.4.0
allowed-tools: Read, Write, Bash, Glob, Task
---

# start-feature

Four-phase state machine: PROBLEM → DESIGN → PLAN → IMPLEMENT → VERIFY → DONE. Each phase produces a
fully-populated doc. No `<placeholder>` text is left for the user to fill in.

Each doc is auto-reviewed by a dedicated Opus reviewer subagent before it reaches the user — see
**Automated review** below.

---

## Writing standard (applies to every doc)

Every doc you write in this workflow must be clear, concise, and grounded:

- **Ground it in real code.** Read the files the doc touches and refer to actual modules, symbols,
  and file paths. Don't assume behavior — if unsure, check. Any solution must be grounded in
  existing code where it exists.
- **Don't invent terminology.** Use the project's existing vocabulary (from code, docs, and sibling
  feature docs) rather than coining new terms. Define any jargon or acronym on first use.
- **Cut what you can.** After drafting, run the *delete test* on every sentence: if it can go
  without losing information, cut it. Delete filler ("it is important to note", "in order to",
  hedging like "perhaps" / "it might be worth"). One idea per sentence; plain words over long ones.
- **Be concrete.** Name the actual file, module, or symbol — not "the relevant component". The user
  rejects docs that aren't clear.
- **Stay in your lane.** Each doc has one job (stated in the contract header at the top of its
  template): problem = the *need*, design = the *solution shape* (and the sole home for scope
  boundaries), plan = the *ordered execution*. Don't restate a sibling doc — link it. Content that
  belongs elsewhere gets flagged by the reviewer.

---

## Setup

Before entering any phase:

**1. Get the feature slug.**

Check if an argument was passed (e.g., `/start-feature my-feature`). If yes, use it. If not,
ask: "What's the feature slug? Use kebab-case — e.g. `user-auth`, `billing-export`."

**2. Create the worktree.**

```bash
repo_root=$(git rev-parse --show-toplevel)
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/create_worktree.py" \
  "$repo_root/.worktrees/feat-<slug>" "feat/<slug>"
```

If this fails (non-zero exit), stop and report the error — do not proceed to step 3. Report the absolute worktree path to the user.

**3. Detect the doc root** by reading the project's `CLAUDE.md` with the Read tool:

- Mentions `feature-work/` → doc root is `feature-work/`
- Otherwise → doc root is `docs/`

DO NOT WRITE TO superpowers, .claude, or any directory outside the detected doc root. ALL FEATURE
WORK DOCS GO IN `<doc-root>/<slug>/`. If the directory does not exist, create it.

Announce: `Writing docs to <doc-root>/<slug>/`

```bash
mkdir -p <doc-root>/<slug>
```

**4. Get metadata:**

```bash
date +%Y-%m-%d        # today
git config user.name  # owner
```

**5. Read the three pipeline templates** (needed for reference throughout):

- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/problem.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/design.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/plan.md`
- `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/completed.md`
---

## Automated review (runs in every phase)

After writing a doc but **before** presenting it to the user, hand it to its reviewer subagent.
These ship with this plugin and run on Opus with read-only tools.

| Phase | Reviewer subagent |
|-------|-------------------|
| PROBLEM | `doc-driven-development:problem-reviewer` |
| DESIGN | `doc-driven-development:design-reviewer` |
| PLAN | `doc-driven-development:plan-reviewer` |

The **review step** referenced in each phase below means:

1. Use the **Task** tool to invoke the phase's reviewer. Pass the absolute path to the doc just
   written; the reviewer reads it (and any sibling docs it references) from disk.
2. When it returns, **apply every Critical and Should-fix item** yourself and re-write the doc.
   Note Suggestions but don't auto-apply them.
3. The review is **advisory** — it informs the doc before the human sees it; it does not gate
   progression. The user always gives final approval.

---

## Presenting docs for review (runs in every phase)

Each phase ends by presenting its doc for the user to approve. **If the `markdown-review` skill is
available**, prefer it over dumping raw markdown in the terminal — it renders the doc in the
browser with inline comments and an Approve button, and returns feedback in an events file.

- **Start the server once** per session, the first time you present a doc. Reuse it for all three
  docs — each phase adds its doc, so the sidebar accumulates problem → design → plan.
- On each present step: serve (or edit-in-place, it live-reloads) the doc, share the full URL, and
  ask in the terminal as described in the phase. Next turn, read the skill's events file for
  `comment`/`approve` events; **the terminal message is primary** — merge the two. An `approve`
  event with no later edits to that doc satisfies the approval gate without re-asking.
- **If `markdown-review` is not available**, fall back to presenting the doc inline in the terminal.

This is the **present step** referenced in each phase below. It does not replace the phase's
approval question — it's how the doc reaches the user.

---

## PHASE: PROBLEM
It is best if the operator directly fills this out for themselves so ask if they want to do that first
If so copy the template in and open the doc with `clearance <name-of-copied-in-template>`


Announce: **[PHASE: PROBLEM]**

If start-feature was launched after a discussion of the problem, then use that to fill out the problem
template yourself. If not then do these steps

**Important** The problem doc is for stating the **problem**. It is not for a solution, nor a design. No premature solutionizing

Apply the **Writing standard** (above). For the problem doc specifically, focus wherever possible
on the benefit to the user of solving the problem.

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
6. "How will we know this is done? What does success look like?"

(Scope boundaries — what's out of scope — are captured in the DESIGN phase, in design.md's
"Out of scope" section. Don't ask for them here.)

After collecting answers, read any related existing files (feature docs, source modules) to
ground the draft in real project context.

Draft `problem.md` from the template. Fill every section. Replace `<username>` with the git
owner, `YYYY-MM-DD` with today's date, and feature name throughout.

Write the draft to `<doc-root>/<slug>/problem.md`.

**Review step** (see *Automated review*): hand the file to `problem-reviewer`, apply its
Critical/Should-fix items, and re-write the doc.

Present the reviewed draft to the user (the **present step** — see *Presenting docs for review*),
along with a 2–4 line summary of what the reviewer flagged and what you changed. Ask: "Does this problem.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/problem.md` each time.

**Transition question:**

> "Is this feature complex enough to warrant a design doc, or is the approach already obvious?
> (Trivial → we skip straight to the plan.)"

- Trivial → jump to **[PHASE: PLAN]**
- Not trivial → continue to **[PHASE: DESIGN]**

---

## PHASE: DESIGN

Announce: **[PHASE: DESIGN]**

Read relevant project files — existing modules, patterns, anything the feature will touch —
to ground the design in real context before proposing approaches. Every solution you propose
**must** be grounded in existing code where it exists — don't assume; if unsure, double-check.

**Propose three solutions across the effort spectrum**, so the trade-off is explicit:

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
4. "What's explicitly out of scope for this feature?" (feeds design.md's "Out of scope" — the single
   home for scope boundaries across all three docs)

Draft `design.md` from the template. The **Alternatives considered** section must include all three
solutions (Simplest, Complete, Optimal) and end with the decision and rationale. Set
`problem: ./problem.md` in frontmatter.

Apply the **Writing standard** (above) before writing the draft to
`<doc-root>/<slug>/design.md`.

**Review step** (see *Automated review*): hand the file to `design-reviewer`, apply its
Critical/Should-fix items, and re-write the doc.

Present the reviewed draft to the user (the **present step** — see *Presenting docs for review*),
along with a 2–4 line summary of what the reviewer flagged and what you changed. Ask: "Does this design.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/design.md` each time.

---

## PHASE: PLAN

Announce: **[PHASE: PLAN]**

Draft `plan.md` from the template. The plan must contain:

- **Overview**: what we're implementing, in what order, why that order (one paragraph)
- **Preconditions**: approved design, resolved open questions, dependencies available
- **Steps**: ordered, each sized for one PR or session, each with:
  - **Status**: `☐` at draft time — implementation flips it to `☑` when Verify passes
  - **What**: concrete change — files touched, behavior added/modified
  - **Tasks** (optional): sub-tasks for multi-part steps; omit for single-action steps
  - **Why**: what this step unblocks or achieves
  - **Verify**: how to confirm it worked (tests, command, manual check)

Set frontmatter to `design: ./design.md` (or `design: ./problem.md` if design was skipped).

Apply the **Writing standard** (above) before writing the draft to
`<doc-root>/<slug>/plan.md`.

**Review step** (see *Automated review*): hand the file to `plan-reviewer`, apply its
Critical/Should-fix items, and re-write the doc.

Present the reviewed draft to the user (the **present step** — see *Presenting docs for review*),
along with a 2–4 line summary of what the reviewer flagged and what you changed. Ask: "Does this plan.md look right? Any changes?"

Revise per the user's feedback until approved, re-writing `<doc-root>/<slug>/plan.md` each time.

---

## PHASE: COMPLETED

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

## After planning

Implementation happens after this workflow. Two things carry through it:

- **`deferred.md`** — as you punt nice-to-haves, edge cases, or anything descoped to ship sooner,
  append an item to `<doc-root>/<slug>/deferred.md` (create it on first use from
  `${CLAUDE_PLUGIN_ROOT}/skills/start-feature/templates/deferred.md`). It's just a running catalog;
  it gets resolved later.
- **When the work is done, run `/close-feature`** — it revisits `deferred.md` (do now / keep
  deferred / permanently drop), writes `completed.md`, and archives the feature dir.
