---
name: start-project
description: >
  Guides planning a brand-new project through seven gated phases: vision →
  stack → architecture → data models → stories → plan → scaffold. Ends with
  a git repo where architecture tests pass green on the empty skeleton and
  BDD specs generated from the stories are red. Use when starting a new
  project/application from scratch. Trigger phrases: "start a project",
  "new project", "/start-project", "/start-project <slug>". Resumable:
  re-running it in a project with docs/vision.md picks up at the first
  unapproved phase.
version: 0.1.0
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
---

# start-project

Seven-phase state machine: vision → stack → architecture → data models →
stories → plan → scaffold. Each phase produces one fully-populated doc, gated
on explicit user approval before the next phase starts. The docs **are** the
state — there is no separate progress file. Frontmatter on each doc
(`status: draft` / `status: approved`) is what makes the workflow resumable.

---

## Phase table

The state machine. **Resume** scans this in order.

| # | Phase | Doc(s) | Phase file | Reviewer |
|---|-------|--------|------------|----------|
| 1 | vision | docs/vision.md | phases/01-vision.md | start-project:vision-reviewer |
| 2 | stack | docs/stack.md | phases/02-stack.md | start-project:stack-reviewer |
| 3 | architecture | docs/architecture.md (carries phase-3 status) + docs/arch-rules.yaml (schema-validated, no frontmatter) | phases/03-architecture.md | start-project:architecture-reviewer |
| 4 | data-models | docs/data-models.md | phases/04-data-models.md | start-project:data-models-reviewer |
| 5 | stories | docs/STORIES.md | phases/05-stories.md | start-project:stories-reviewer |
| 6 | plan | docs/PLAN.md | phases/06-plan.md | start-project:plan-reviewer |
| 7 | scaffold | repo skeleton + docs/scaffold.md | phases/07-scaffold.md | start-project:scaffold-reviewer |

---

## Setup

Before entering any phase:

1. **Determine mode.** If the current directory (or a directory the user
   names) contains `docs/vision.md`, this is **resume mode** — skip straight
   to **Resume**, below. Otherwise this is **new-project mode**.
2. **New-project mode:**
   - Get the slug from the command argument, or ask: "What's the project
     slug? Use kebab-case — e.g. `recipe-box`."
   - Ask for the target directory. Default: `~/Projects/<slug>`.
   - `mkdir -p` the target directory and `cd` into it.
   - Re-check: if `docs/vision.md` already exists in this directory, switch
     to resume mode instead — skip straight to **Resume**, below.
   - **Guard: the directory must otherwise be empty** (ignoring `.git`).
     Scaffold later runs `git add -A` here — starting inside existing work
     would commit unrelated files. If it isn't empty, stop and ask for an
     empty directory, or get explicit confirmation naming the files that
     will be swept into the new project's commits.
   - **Ensure this directory is its own git toplevel** — never inherit a
     parent repo, or the scaffold's `git add -A` would stage the parent's
     unrelated changes. Run `git -C . rev-parse --show-toplevel` (2>/dev/null):
     if it errors (no repo) run `git init` here; if it resolves to **this**
     directory, fine; if it resolves to a **parent** directory, stop and ask
     the user to confirm creating a nested repo — only then `git init` here
     to give this directory its own `.git`.
   - `mkdir -p docs`.
3. **Get metadata:** `date +%Y-%m-%d` (today) and `git config user.name`
   (owner).
4. **Announce:** `Starting project <slug> in <dir> — phase 1 of 7: vision.`

---

## Resume

```markdown
Scan the phase table in order. For each phase, read its doc's frontmatter:
- Doc missing → enter this phase from the top of its phase file. Stop scanning.
- `status: draft` → enter this phase at its **Review step** (skip its
  questions; the draft already exists — user feedback edits it, never
  regenerates it). Stop scanning.
- `status: approved` → next phase.
All seven approved → report "all phases complete" and exit. Never re-ask
slug/directory in resume mode.
For phase 7 half-done states, phases/07-scaffold.md guards each step
individually — re-entry continues, never re-inits.
Exception: phase 7 in any non-approved state (doc missing or `status:
draft`) is always entered from the top of phases/07-scaffold.md, not at its
Review step — the per-step guards inside it skip completed work, and the
exit gate always reruns regardless. This overrides the generic draft →
Review-step rule above for phase 7 only.
For phase 3, both docs must exist and be approved together. If
arch-rules.yaml is missing while architecture.md exists, do NOT reconstruct
it from architecture.md's Modules table — that table lacks `root`,
`language`, and the `rules` choice. Instead re-enter phase 3 at its
arch-rules.yaml drafting step: read `language` from stack.md, take the
module names + may_import edges from the existing architecture.md table,
ask for `root` if not obvious from the slug, set `rules` to `[no_cycles:
true]`, then run the Review step over both docs.
```

---

## Writing standard (applies to every doc)

Every doc you write in this workflow must be clear, concise, and grounded:

- **Ground it in the approved earlier docs.** No code exists until phase 7,
  so earlier docs are the only source of truth — read them and refer to
  their actual content (module names, entities, decisions), not what you
  assume they say.
- **Don't invent terminology.** Use vocabulary already established in
  earlier docs rather than coining new terms. Define any jargon or acronym
  on first use.
- **Cut what you can.** After drafting, run the *delete test* on every
  sentence: if it can go without losing information, cut it. Delete filler
  ("it is important to note", "in order to"), hedging ("perhaps", "it might
  be worth"). One idea per sentence; plain words over long ones.
- **Be concrete.** Name the actual module, entity, or file — not "the
  relevant component". The user rejects docs that aren't clear.
- **Stay in your lane.** Each doc's job is stated in the CONTRACT comment at
  the top of its template. Link a sibling doc for content that belongs
  there — don't restate it. Content that belongs elsewhere gets flagged by
  the reviewer.

---

## Review step (runs in every phase)

After writing a doc but **before** presenting it to the user, hand it to its
reviewer subagent (see the phase table):

1. Use the **Task** tool to invoke the phase's reviewer, passing the
   absolute path to the doc(s) just written. The reviewer reads them (and
   any sibling docs they reference) from disk.
2. When it returns, **apply every Critical and Should-fix item** yourself
   and re-write the doc. Note Suggestions but don't auto-apply them.
3. The review is **advisory** — it informs the doc before the human sees it;
   it does not gate progression. The user always gives final approval.

---

## Present step (runs in every phase)

Each phase ends by presenting its doc for the user to approve.

- **If the `markdown-review` skill is available**, prefer it over dumping
  raw markdown in the terminal. Start its server **once** per session, the
  first time you present a doc, and reuse it for every later phase — each
  phase adds its doc, so the sidebar accumulates vision → stack →
  architecture → ... Share the full URL. Next turn, read the skill's events
  file for `comment`/`approve` events. The **terminal message is primary**
  — merge the two. An `approve` event with no later edits to that doc
  satisfies the approval gate without re-asking.
- **Otherwise**, present the doc inline in the terminal.

Then ask the phase's approval question (each phase file states its own).

---

## Approval gate

On explicit user approval:

```bash
# flip frontmatter in the doc(s): status: approved, approved: <today>
git add docs/<doc> && git commit -m "docs(<phase>): approve <doc-basename>"
```

Then announce the next phase and read its phase file. Never flip status or
commit without explicit approval.

---

## Phase dispatch

To run a phase, read `${CLAUDE_PLUGIN_ROOT}/skills/start-project/phases/<file>`
and follow it. Do not read phase files ahead of the current phase.

---

## After the workflow

Implementation happens outside this workflow. Once phase 7 is approved, the
new repo has a passing architecture-test suite on an empty skeleton and a
red/skipped BDD spec suite generated from `docs/STORIES.md`. Work through
`docs/PLAN.md` slice by slice, using a feature-level workflow (e.g.
`doc-driven-development:start-feature` or `bdd-workflow`) inside the new
repo for each slice — the red specs are the backlog made executable.
