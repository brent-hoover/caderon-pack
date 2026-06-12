# ticket-to-pr — Design

**Date:** 2026-06-12
**Status:** Approved (design)

## Problem

There is a repeatable execution lifecycle for a single piece of work that today is driven by hand,
one ad-hoc prompt at a time: take a ticket with acceptance criteria, clarify it, write tests, get the
tests reviewed for adequacy, implement until they pass, run code review to convergence, open a PR, and
clean up after merge. Doc-driven-development covers the *planning* of work (problem → design → plan);
it does not cover *execution* of a single already-scoped ticket.

Driving this by prose instruction is unreliable: a skill *asks* the model to re-invoke a reviewer and
judge "good enough", and the model can shortcut the loop, skip the re-review, or declare victory
early. The iterative parts (test-adequacy, review-fix) need their loop structure *enforced*, not left
to model discretion — while the human-judgment parts (clarifying the ticket, approving a push, the
docs that follow a merge) still need a human in the loop.

## Goal

A single installable plugin, `ticket-to-pr`, that takes one ticket reference and drives it through to a
PR: clarify → worktree → tests → adequacy loop → implement → review-fix loop → PR, with a separate
post-merge step for documentation and cleanup. Deterministic where a loop must be enforced;
human-gated where judgment is required. Works across the user's repos (GitHub Issues and `jig`),
discovering project-specific verify commands rather than hardcoding them.

## Architecture — three zones

Control flows through three zones, with boundaries drawn exactly at the human-interaction points.
Everything that needs the user lives in a command zone; the bounded headless loops live in a Workflow.

```
ZONE A — COMMAND (main conversation, human-gated)
  /ticket-to-pr <source>:<id>           e.g. github:1234  |  jig:jig-12
   1. Resolve ticket via adapter (gh | jig) → title, body, acceptance criteria
   2. Review ticket; ask clarifying questions (AskUserQuestion)
   3. Post answers back to the ticket (ticket.sh comment)
   4. Detect verify commands (CLAUDE.md ## Commands → project-type heuristic → ask)
   5. Create worktree (core:git-worktrees), branch feat/<slug> off default branch
   6. Confirm go-ahead, then launch the Workflow
        │
        ▼
ZONE B — WORKFLOW (background, deterministic; agents run with cwd = worktree)
   7. test-writer → writes tests from acceptance criteria + ticket
   8. ⟳ test-adequacy-reviewer ⇄ test-writer   until {satisfied} or MAX_TEST_ITERS
   9. ⟳ dev                                     until tests pass + build clean or MAX_DEV_ITERS
  10. ⟳ roborev review-fix loop (our dev agent) until branch verdict passes or MAX_REFINE_ITERS
  11. commit on the worktree branch (NO push)
       → returns { testFiles, diffSummary, acMet[], roborevVerdict, commits[] }
        │
        ▼
ZONE C — COMMAND (main conversation, human-gated)
  12. Present structured summary; user approves → push + open PR
  13. /ticket-to-pr-finish <source>:<id>  (separate trigger, after merge confirmed):
        a. doc-writer → branch from default, update affected docs, open a separate docs PR
        b. remove worktree + delete local feature branch
```

Rationale: a background `Workflow` cannot pause to ask a question or block on an unbounded external
event, so clarifications (2–3), the push/PR decision (12), and "PR merged" (13) cannot live inside it.
The loop-heavy middle (7–11) is exactly what a Workflow enforces well. Neither a pure skill nor a pure
workflow fits; the work is two-phase with a deterministic middle.

## Components

Plugin at `caderon-pack/plugins/ticket-to-pr/`, following the established layout
(`.claude-plugin/plugin.json` + `commands/` + `skills/<name>/SKILL.md` + `agents/`).

| Component          | Path                                          | Role                                                                                 |
|--------------------|-----------------------------------------------|--------------------------------------------------------------------------------------|
| Manifest           | `.claude-plugin/plugin.json`                  | Plugin manifest; registered in `marketplace.json`                                    |
| Entry command      | `commands/ticket-to-pr.md`                    | Thin wrapper → invokes the skill with `$ARGUMENTS` (`github:1234` / `jig:jig-12`)    |
| Orchestration skill| `skills/ticket-to-pr/SKILL.md`                | Holds the Zone A + Zone C procedure; launches the workflow for Zone B                 |
| Finish command     | `commands/ticket-to-pr-finish.md`             | Separate post-merge trigger → docs PR + worktree/branch cleanup                       |
| Ticket adapter     | `scripts/ticket.sh`                           | One interface: `ticket.sh show <src> <id>` / `ticket.sh comment <src> <id>` (stdin)  |
| Workflow script    | `workflows/ticket-to-pr.mjs`                  | Zone B orchestration; launched via `scriptPath: ${CLAUDE_PLUGIN_ROOT}/...` + `args`  |
| Subagents          | `agents/{test-writer,test-adequacy-reviewer,dev,doc-writer}.md` | Purpose-built; invoked by the workflow (`agentType:`) and the finish command (Task)  |

Design notes:

- **Adapter as a script, not prose.** The command, skill, and doc agent all call `ticket.sh`; adding a
  third tracker later is one new `case`, not an orchestration change. It normalizes two backends of
  different richness behind one interface (see Ticket adapter below).
- **Workflow shipped as a plugin file** referenced by `scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflows/ticket-to-pr.mjs`
  keeps it versioned with the plugin and portable across repos — no per-project `.claude/workflows/`
  copy. Everything project-specific (ticket data, verify commands, worktree path, caps) passes through
  `args`.

## Ticket adapter (`ticket.sh`)

Two backends behind `show` and `comment`:

- **GitHub** (`gh`): `gh issue view <id> --json title,body,comments`; `gh issue comment <id> --body-file -`.
  Structured JSON output.
- **jig**: `jig issue show <ref>` (REF is `jig-N` or UUID) → human-readable text, no `--json`; AC parsed
  from the body. `jig issue comment <ref> --body-file -` writes via stdin.

Clarification text is always passed via **stdin / `--body-file -`**, never interpolated into a shell
string — review/ticket-derived content may contain shell metacharacters.

## Zone B workflow detail

Launched with `args = { ticket: {title, body, acceptanceCriteria[]}, verifyCmds: {build, lint, test},
worktreePath, branch, caps: {test, dev, refine} }`. All agents run with `cwd` = the worktree.

```js
phase('Tests')
let tests = await agent(writePrompt(ticket), {agentType:'test-writer', schema: TEST_FILES})
let verdict, i = 0
while (i++ < caps.test) {                              // adequacy loop — enforced, not model-judged
  verdict = await agent(reviewPrompt(tests, ticket.acceptanceCriteria),
                        {agentType:'test-adequacy-reviewer', schema: VERDICT})
  if (verdict.satisfied) break
  tests = await agent(revisePrompt(verdict.gaps), {agentType:'test-writer', schema: TEST_FILES})
}

phase('Dev')
let dev, j = 0
while (j++ < caps.dev) {                               // implement until green
  dev = await agent(implementPrompt(ticket, tests, verifyCmds),
                    {agentType:'dev', schema: DEV_RESULT})   // dev runs verifyCmds itself
  if (dev.testsPassing && dev.buildClean) break
}

phase('Refine')                                        // roborev review-fix loop, our dev agent fixes
let pass = false, k = 0
while (k++ < caps.refine && !pass) {
  // roborev review --branch --wait ; parse findings via list/show --json (panel: gate on parent)
  const review = await reviewBranch()                  // {passed, jobId, findings[]}
  if (review.passed) { pass = true; break }
  await agent(fixPrompt(review.findings, verifyCmds), {agentType:'dev', schema: DEV_RESULT})
  // run tests ; commit ; roborev comment + close jobId ; clean up hook review
}

phase('Commit')                                        // single state on worktree branch — NO push
return { testFiles: tests.files, diffSummary: dev.diffSummary, acMet: dev.acMet,
         roborevVerdict: pass ? 'pass' : 'cap-reached', commits }
```

Schemas (structured hand-offs between stages):

- `VERDICT = { satisfied: boolean, gaps: string[] }`
- `TEST_FILES = { files: string[], notes: string }`
- `DEV_RESULT = { testsPassing: boolean, buildClean: boolean, diffSummary: string, acMet: string[] }`

Caps default to **3** (test, dev) and **10** (refine, matching `roborev refine`), overridable via `args`.

**roborev loop is reimplemented with our `dev` agent** (not `roborev refine`, which would use the
configured `default_agent=codex`). The workflow drives roborev *primitives* — `roborev review --branch
--wait`, parse findings via `roborev list/show --json`, dispatch our Claude `dev` agent to fix in our
worktree, run tests, commit, `roborev comment`/`close`, re-review — porting the logic of the existing
`/roborev-refine` skill into the workflow's enforced loop. Panel reviews gate on the synthesis-parent
verdict; commit-scoped hook reviews are cleaned up each iteration.

## Human gates, git, PR, cleanup

- **Push/PR is never automated.** The workflow only commits to an isolated worktree branch
  (local-only, reversible). Push + PR happen in Zone C after explicit user approval, producing a PR
  with Problem/Fix, change summary, special-attention notes, a pre-merge checklist, and manual test
  steps (per the user's PR conventions).
- **Cleanup is its own command** (`/ticket-to-pr-finish`), not polling. "PR merged" is an external
  human event with no bounded timing — neither a workflow nor a long-lived command should block on it.
- **Doc agent opens a separate docs PR** from the default branch (never commits to it directly),
  reading the merged diff + ticket + the project's documentation conventions (from `CLAUDE.md`).

## Verify-command detection

Order: project `CLAUDE.md` `## Commands` block (most precise) → project-type heuristic
(`go.mod` → `go build/vet/test`; `pyproject.toml` → `pytest`/`ruff`; `package.json` → scripts) →
**ask the user** if neither yields confident commands. Pinned once at kickoff, passed into the
workflow via `args.verifyCmds`.

## Risks / verify during implementation

1. **roborev finding-parsing** — depend on `roborev list/show --json` for deterministic findings
   (severity/file/line); confirm `show --json` exposes findings, else fall back to documented output
   parsing. Handle panel synthesis-parent gating + hook-review cleanup as the `/roborev-refine` skill
   does. roborev daemon must be running (`roborev status --json`; start if needed).
2. **Workflow agent `cwd`** — confirm `agent()` honors a working directory so all Zone B agents
   operate inside the feature worktree, not the main checkout.
3. **Verify-command detection** — `CLAUDE.md` parsing is best-effort; the ask-fallback covers misses.
4. **`gh` vs `jig` AC extraction** — GitHub gives JSON; jig gives text. The skill must extract
   acceptance criteria robustly from a free-text body in both cases.

## Resolved during design

- **jig adapter** — `jig issue show <ref>` (text, no JSON) / `jig issue comment <ref> --body-file -`
  (stdin). axiom itself is not a jig project (uses GitHub Issues); jig serves the user's other repos.
- **roborev loop placement** — inside the workflow (Zone B), reimplemented with our `dev` agent rather
  than shelling out to `roborev refine`.
- **Doc agent output** — separate docs PR.
