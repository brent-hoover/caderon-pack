# ticket-to-pr Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Ship a `ticket-to-pr` plugin in caderon-pack that drives one ticket (GitHub Issue or jig)
through clarify → worktree → tests → adequacy loop → implement → roborev review-fix loop → PR, with a
separate post-merge docs-PR + cleanup step.

**Architecture:** Three zones — a command (Zone A) handles ticket resolution, clarifying questions, and
worktree setup; a background Workflow (Zone B) runs the enforced loops with purpose-built subagents;
a command (Zone C) gates push/PR and a separate finish command handles the docs PR + cleanup. Pure
logic lives in `ticket.sh` (testable); orchestration lives in markdown (command/skill/agents) and one
JS workflow, verified by `node --check` + end-to-end smoke runs.

**Tech Stack:** Claude Code plugin (commands/skills/agents markdown), Bash (`ticket.sh`), JavaScript
(Workflow `.mjs`), `gh` CLI, `jig` CLI, `roborev` CLI, `bats-core` for shell tests.

---

## Design reference

Spec: `docs/specs/2026-06-12-ticket-to-pr-design.md`. Read it before starting.

## Working location & git

All work happens in the existing worktree `caderon-pack/.worktrees/ticket-to-pr-plugin`
(branch `feat/ticket-to-pr-plugin`, off `develop`). Commit after every task. Do NOT push without
explicit permission. caderon-pack's default branch is `develop`, not `main`.

## Key constraint — Zone B agent working directory

Workflow `agent()` takes **no `cwd`**. Zone B agents run in the harness cwd (the target project root).
Every Zone B agent prompt MUST start with:

```
All work happens in the git worktree at: {worktreePath}
Run `cd "{worktreePath}"` (or use `git -C "{worktreePath}"`) before ANY command. Never operate on the
main checkout.
```

The workflow passes `args.worktreePath` and interpolates it into each prompt. Task 6 verifies this.

## Test fixtures

Two fixtures, created once and reused (kept OUT of the plugin — under `/tmp`):

- **`/tmp/ttp-fixture-gh`** — not used for live `gh` calls in CI; GitHub paths are smoke-tested
  manually against a real scratch issue (documented per task). `ticket.sh` GitHub branch is unit-tested
  with a stubbed `gh` on `PATH` (see Task 3).
- **`/tmp/ttp-fixture-jig`** — a real local jig + Go project for offline end-to-end smoke:
  ```bash
  rm -rf /tmp/ttp-fixture-jig && mkdir -p /tmp/ttp-fixture-jig && cd /tmp/ttp-fixture-jig
  git init -q && go mod init ttpfixture
  jig init
  jig issue create --title "Add Sum(nums []int) int to calc package" \
    --body $'## Acceptance Criteria\n- `calc.Sum` returns the sum of a slice of ints\n- `calc.Sum(nil)` and `calc.Sum([]int{})` return 0\n- Has table-driven tests covering empty, single, and multi-element slices'
  # note the printed jig-N ref; approve it so it is OPEN
  ```
  (Exact `jig issue create` flags: confirm with `jig issue create --help` at execution; adjust if the
  `--body`/approve surface differs.)

---

## File structure

All paths under `plugins/ticket-to-pr/`:

```
.claude-plugin/plugin.json          # manifest
commands/ticket-to-pr.md            # Zone A+C entry (thin → invokes skill)
commands/ticket-to-pr-finish.md     # post-merge: docs PR + cleanup
skills/ticket-to-pr/SKILL.md        # Zone A + Zone C procedure; launches workflow
scripts/ticket.sh                   # ticket adapter (gh | jig) — show/comment
scripts/ticket.bats                 # bats tests for ticket.sh
workflows/ticket-to-pr.mjs          # Zone B orchestration
agents/test-writer.md
agents/test-adequacy-reviewer.md
agents/dev.md
agents/doc-writer.md
```

Plus a one-line edit to `.claude-plugin/marketplace.json` (repo root) registering the plugin.

---

## TRACER 0 — Scaffold + ticket adapter (independently demoable)

Outcome: plugin is recognized; `ticket.sh` reads/comments on real tickets.

### Task 1: Plugin manifest + marketplace registration

**Files:**
- Create: `plugins/ticket-to-pr/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json` (repo root) — add plugin entry

- [ ] **Step 1: Write the manifest**

`plugins/ticket-to-pr/.claude-plugin/plugin.json`:
```json
{
  "name": "ticket-to-pr",
  "version": "0.1.0",
  "description": "Drive one ticket (GitHub Issue or jig) through clarify → tests → implement → roborev review-fix → PR, with a post-merge docs PR and cleanup",
  "author": { "name": "Brent Hoover", "email": "brent@thebuddhalodge.com" },
  "homepage": "https://github.com/brent-hoover/caderon-pack",
  "repository": "https://github.com/brent-hoover/caderon-pack",
  "license": "MIT",
  "keywords": ["workflow", "tickets", "tdd", "pull-request", "roborev", "github", "jig"]
}
```

- [ ] **Step 2: Register in the marketplace manifest**

In `.claude-plugin/marketplace.json`, add to the `plugins` array:
```json
{
  "name": "ticket-to-pr",
  "description": "Ticket → PR execution workflow: clarify, test, implement, review-fix, PR, docs",
  "source": "./plugins/ticket-to-pr",
  "category": "workflow"
}
```

- [ ] **Step 3: Verify JSON validity**

Run: `python3 -m json.tool plugins/ticket-to-pr/.claude-plugin/plugin.json >/dev/null && python3 -m json.tool .claude-plugin/marketplace.json >/dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**
```bash
git add plugins/ticket-to-pr/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat(ticket-to-pr): scaffold plugin manifest + marketplace entry"
```

### Task 2: ticket.sh — failing bats test for the dispatcher + usage

**Files:**
- Create: `plugins/ticket-to-pr/scripts/ticket.bats`
- Create: `plugins/ticket-to-pr/scripts/ticket.sh`

- [ ] **Step 1: Write the failing test**

`plugins/ticket-to-pr/scripts/ticket.bats`:
```bash
#!/usr/bin/env bats

setup() {
  SCRIPT="${BATS_TEST_DIRNAME}/ticket.sh"
}

@test "no args prints usage and exits non-zero" {
  run bash "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"usage:"* ]]
}

@test "unknown source exits non-zero" {
  run bash "$SCRIPT" show bitbucket 123
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown source"* ]]
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `bats plugins/ticket-to-pr/scripts/ticket.bats`
Expected: FAIL (`ticket.sh` does not exist / no usage output)

- [ ] **Step 3: Minimal implementation**

`plugins/ticket-to-pr/scripts/ticket.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: ticket.sh <command> <source> <ref> [args]
  commands: show | comment
  sources:  github | jig
  show:     ticket.sh show <source> <ref>
  comment:  ticket.sh comment <source> <ref>   (body read from stdin)
EOF
  exit 2
}

main() {
  [ "$#" -ge 3 ] || usage
  local cmd="$1" src="$2" ref="$3"
  case "$src" in
    github|jig) ;;
    *) echo "unknown source: $src" >&2; exit 2 ;;
  esac
  case "$cmd" in
    show)    "show_${src}" "$ref" ;;
    comment) "comment_${src}" "$ref" ;;
    *) echo "unknown command: $cmd" >&2; usage ;;
  esac
}

main "$@"
```
(`show_github` etc. are added in Task 3; this step only needs the dispatcher + usage to pass the two
tests. The `case` on `$cmd` calls functions defined next task — running `show`/`comment` now would
error, but the two tests only exercise usage + unknown-source paths.)

- [ ] **Step 4: Run to verify pass**

Run: `chmod +x plugins/ticket-to-pr/scripts/ticket.sh && bats plugins/ticket-to-pr/scripts/ticket.bats`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**
```bash
git add plugins/ticket-to-pr/scripts/ticket.sh plugins/ticket-to-pr/scripts/ticket.bats
git commit -m "feat(ticket-to-pr): ticket.sh dispatcher + usage"
```

### Task 3: ticket.sh — gh + jig show/comment

**Files:**
- Modify: `plugins/ticket-to-pr/scripts/ticket.sh`
- Modify: `plugins/ticket-to-pr/scripts/ticket.bats`

- [ ] **Step 1: Write failing tests with stubbed CLIs**

Append to `ticket.bats`:
```bash
@test "show github calls gh issue view with json fields" {
  stubdir="$(mktemp -d)"
  cat >"$stubdir/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >>"$STUB_LOG"
echo '{"title":"T","body":"B","comments":[]}'
STUB
  chmod +x "$stubdir/gh"
  STUB_LOG="$stubdir/log" PATH="$stubdir:$PATH" run bash "$SCRIPT" show github 42
  [ "$status" -eq 0 ]
  [[ "$output" == *'"title":"T"'* ]]
  grep -q 'gh issue view 42 --json title,body,comments' "$stubdir/log"
}

@test "comment jig pipes stdin to --body-file -" {
  stubdir="$(mktemp -d)"
  cat >"$stubdir/jig" <<'STUB'
#!/usr/bin/env bash
echo "jig $*" >>"$STUB_LOG"
cat >"$STUB_LOG.body"
STUB
  chmod +x "$stubdir/jig"
  STUB_LOG="$stubdir/log" PATH="$stubdir:$PATH" run bash -c "echo 'hello clarif' | bash '$SCRIPT' comment jig jig-7"
  [ "$status" -eq 0 ]
  grep -q 'jig issue comment jig-7 --body-file -' "$stubdir/log"
  grep -q 'hello clarif' "$stubdir/log.body"
}
```

- [ ] **Step 2: Run to verify fail**

Run: `bats plugins/ticket-to-pr/scripts/ticket.bats`
Expected: the two new tests FAIL (functions undefined)

- [ ] **Step 3: Implement the backend functions**

Insert before `main()` in `ticket.sh`:
```bash
show_github()   { gh issue view "$1" --json title,body,comments; }
comment_github(){ gh issue comment "$1" --body-file -; }
show_jig()      { jig issue show "$1"; }
comment_jig()   { jig issue comment "$1" --body-file -; }
```

- [ ] **Step 4: Run to verify pass**

Run: `bats plugins/ticket-to-pr/scripts/ticket.bats`
Expected: all 4 tests PASS

- [ ] **Step 5: Smoke against a real ticket (manual, documented)**

GitHub: `plugins/ticket-to-pr/scripts/ticket.sh show github <real-issue-#>` in a repo with `gh` auth →
prints JSON with title/body. jig: from `/tmp/ttp-fixture-jig`,
`<plugin>/scripts/ticket.sh show jig <jig-N>` → prints the issue text incl. the Acceptance Criteria.

- [ ] **Step 6: Commit**
```bash
git add plugins/ticket-to-pr/scripts/ticket.sh plugins/ticket-to-pr/scripts/ticket.bats
git commit -m "feat(ticket-to-pr): gh + jig show/comment backends"
```

---

## TRACER 1 — Thin end-to-end (minimal workflow → committed branch)

Outcome: `/ticket-to-pr jig:<ref>` on the fixture produces a worktree branch with a passing test +
implementation, committed. No adequacy loop, no roborev, no push yet.

### Task 4: test-writer agent

**Files:**
- Create: `plugins/ticket-to-pr/agents/test-writer.md`

- [ ] **Step 1: Write the agent**

`plugins/ticket-to-pr/agents/test-writer.md`:
```markdown
---
name: test-writer
description: Writes failing tests for a ticket's acceptance criteria, in the project's test framework. Invoked by the ticket-to-pr workflow.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
color: blue
---

You write tests FIRST, before any implementation exists. You are dispatched by the ticket-to-pr
workflow with a ticket and its acceptance criteria.

All work happens in the git worktree path given in your prompt. `cd` there before ANY command. Never
touch the main checkout.

## Your job

1. Read the acceptance criteria and the ticket body.
2. Inspect the project to learn its test framework and conventions (test file locations, naming,
   table-driven vs xUnit, assertion style). Match what exists.
3. Write tests that encode EACH acceptance criterion as one or more concrete, executable test cases.
   Cover the stated edge cases. Do not write implementation code — only tests.
4. The tests MUST fail right now (the feature does not exist yet) — that is correct and expected.
5. Use the verify (test) command given in your prompt to confirm the tests at least compile/collect
   and fail for the right reason (missing symbol/behavior), not a syntax error in the test itself.

## Output (StructuredOutput)

Return: `{ "files": [<relative test file paths you created/edited>], "notes": "<what each AC maps to,
and any AC you could not turn into a test and why>" }`.

Do not commit. The workflow commits.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import sys,yaml; yaml.safe_load(open('plugins/ticket-to-pr/agents/test-writer.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**
```bash
git add plugins/ticket-to-pr/agents/test-writer.md
git commit -m "feat(ticket-to-pr): test-writer agent"
```

### Task 5: dev agent

**Files:**
- Create: `plugins/ticket-to-pr/agents/dev.md`

- [ ] **Step 1: Write the agent**

`plugins/ticket-to-pr/agents/dev.md`:
```markdown
---
name: dev
description: Implements code to make the ticket-to-pr tests pass and satisfy acceptance criteria, and addresses roborev review findings. Invoked by the ticket-to-pr workflow.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
color: green
---

You implement code. You are dispatched by the ticket-to-pr workflow in one of two modes, stated in
your prompt: IMPLEMENT (make the failing tests pass + satisfy acceptance criteria) or FIX (address
specific roborev review findings).

All work happens in the git worktree path given in your prompt. `cd` there before ANY command. Never
touch the main checkout.

## IMPLEMENT mode

1. Read the tests already written and the acceptance criteria.
2. Write the minimal implementation that makes ALL tests pass and satisfies every acceptance criterion.
3. Run the build and test commands given in your prompt until both are clean. Do not weaken or delete
   tests to make them pass; if a test looks wrong, say so in `notes` rather than gutting it.

## FIX mode

1. You are given the roborev review text (findings as prose, with severities). Parse out each issue.
2. Fix them, highest severity first. If a finding is a false positive or intentional, do NOT change
   code for it — record it in `notes` for the review comment.
3. Re-run build + tests; keep them green.

## Output (StructuredOutput)

Return: `{ "testsPassing": <bool>, "buildClean": <bool>, "diffSummary": "<1-3 sentences>",
"acMet": [<acceptance criteria you believe are now satisfied>] }`.

Do not commit. The workflow commits.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import sys,yaml; yaml.safe_load(open('plugins/ticket-to-pr/agents/dev.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**
```bash
git add plugins/ticket-to-pr/agents/dev.md
git commit -m "feat(ticket-to-pr): dev agent"
```

### Task 6: Minimal workflow (test-writer → dev → commit) + cwd verification

**Files:**
- Create: `plugins/ticket-to-pr/workflows/ticket-to-pr.mjs`

- [ ] **Step 1: Write the minimal workflow**

`plugins/ticket-to-pr/workflows/ticket-to-pr.mjs`:
```javascript
export const meta = {
  name: 'ticket-to-pr',
  description: 'Zone B: write tests, implement, (later) review-fix, commit on the worktree branch',
  phases: [
    { title: 'Tests' },
    { title: 'Dev' },
    { title: 'Commit' },
  ],
}

// args = { ticket:{title,body,acceptanceCriteria[]}, verifyCmds:{build,lint,test},
//          worktreePath, branch, caps:{test,dev,refine} }
const { ticket, verifyCmds, worktreePath, caps } = args
const WT = `All work happens in the git worktree at: ${worktreePath}\n` +
  `Run \`cd "${worktreePath}"\` before ANY command. Never operate on the main checkout.\n\n`
const ac = ticket.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')

const TEST_FILES = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['files', 'notes'],
}
const DEV_RESULT = {
  type: 'object',
  properties: {
    testsPassing: { type: 'boolean' }, buildClean: { type: 'boolean' },
    diffSummary: { type: 'string' }, acMet: { type: 'array', items: { type: 'string' } },
  },
  required: ['testsPassing', 'buildClean', 'diffSummary', 'acMet'],
}

phase('Tests')
const tests = await agent(
  `${WT}Write failing tests for this ticket.\n\nTITLE: ${ticket.title}\n\nBODY:\n${ticket.body}\n\n` +
  `ACCEPTANCE CRITERIA:\n${ac}\n\nTest command: ${verifyCmds.test}`,
  { agentType: 'test-writer', schema: TEST_FILES })

phase('Dev')
let dev = null
for (let j = 0; j < (caps?.dev ?? 3); j++) {
  dev = await agent(
    `${WT}IMPLEMENT mode.\n\nACCEPTANCE CRITERIA:\n${ac}\n\nTests already written: ` +
    `${(tests?.files ?? []).join(', ')}\n\nBuild: ${verifyCmds.build}\nTest: ${verifyCmds.test}`,
    { agentType: 'dev', schema: DEV_RESULT })
  if (dev?.testsPassing && dev?.buildClean) break
}

phase('Commit')
const commitAgent = await agent(
  `${WT}Stage all changes and create ONE commit. Message (conventional): ` +
  `"feat: ${ticket.title}". Then output the commit SHA on the last line.`,
  { agentType: 'dev' })

return {
  testFiles: tests?.files ?? [], diffSummary: dev?.diffSummary ?? '',
  acMet: dev?.acMet ?? [], testsPassing: !!dev?.testsPassing, buildClean: !!dev?.buildClean,
  commitInfo: commitAgent,
}
```

- [ ] **Step 2: Syntax check**

Run (workflow scripts use top-level `return`/`await` — check as a harness-wrapped async fn, NOT a bare
module): `node --check <(printf 'async function __wf(){\n'; sed 's/^export const meta =/const meta =/' plugins/ticket-to-pr/workflows/ticket-to-pr.mjs; printf '\n}\n')`
Expected: exits 0 (no output)

- [ ] **Step 3: Live cwd + end-to-end smoke (manual)**

From `/tmp/ttp-fixture-jig`, create a worktree and launch the workflow via the Workflow tool with
`scriptPath` pointing at the file and `args` filled from the fixture ticket (verifyCmds:
`{build:"go build ./...", lint:"go vet ./...", test:"go test ./..."}`, worktreePath = the new
worktree, caps `{test:3,dev:3,refine:10}`).
Expected: the worktree branch ends with `calc/calc_test.go` + `calc/calc.go`, `go test ./...` passes,
and a commit exists **on the worktree branch only** (main checkout untouched — this confirms the cwd
contract). If agents wrote to the main checkout, the `cd` instruction is not being honored — fix the
prompt before proceeding.

- [ ] **Step 4: Commit**
```bash
git add plugins/ticket-to-pr/workflows/ticket-to-pr.mjs
git commit -m "feat(ticket-to-pr): minimal Zone B workflow (tests → dev → commit)"
```

### Task 7: Orchestration skill (Zone A + launch + Zone C summary)

**Files:**
- Create: `plugins/ticket-to-pr/skills/ticket-to-pr/SKILL.md`

- [ ] **Step 1: Write the skill**

`plugins/ticket-to-pr/skills/ticket-to-pr/SKILL.md`:
```markdown
---
name: ticket-to-pr
description: Drive one ticket (github:<id> or jig:<ref>) through clarify → worktree → tests → adequacy loop → implement → roborev review-fix → PR. Use when the user runs /ticket-to-pr or asks to take a ticket to a PR.
---

# ticket-to-pr

Execution lifecycle for ONE already-scoped ticket. Planning (problem/design/plan) is out of scope —
this assumes the ticket carries acceptance criteria.

Argument: `<source>:<id>` where source is `github` or `jig` (e.g. `github:1234`, `jig:jig-12`).
The adapter and workflow ship in this plugin; reference them by absolute path:
`${CLAUDE_PLUGIN_ROOT}/scripts/ticket.sh` and `${CLAUDE_PLUGIN_ROOT}/workflows/ticket-to-pr.mjs`.

## ZONE A — main conversation (human-gated)

1. **Resolve the ticket.** Split the argument on `:` into SRC and REF. Run
   `${CLAUDE_PLUGIN_ROOT}/scripts/ticket.sh show $SRC $REF`. Parse title, body, and the acceptance
   criteria. GitHub returns JSON (`.title`, `.body`); jig returns text — read the Acceptance Criteria
   from the body. If you cannot find explicit acceptance criteria, STOP and tell the user the ticket
   has none.
2. **Review + clarify.** Read the ticket critically. If anything is ambiguous or under-specified, ask
   the user with AskUserQuestion (one focused round). If everything is clear, say so and skip.
3. **Record clarifications.** For each answered question, post it back to the ticket via stdin:
   `printf '%s' "$TEXT" | ${CLAUDE_PLUGIN_ROOT}/scripts/ticket.sh comment $SRC $REF`. Use a single
   comment summarizing Q&A.
4. **Detect verify commands.** In order: (a) read the project `CLAUDE.md` `## Commands` section for
   build/lint/test; (b) else infer from project type — `go.mod` → `go build ./...` / `go vet ./...` /
   `go test ./...`; `pyproject.toml` → `ruff check .` / `pytest`; `package.json` → its `build`/`lint`/
   `test` scripts; (c) else ASK the user. Confirm the three commands with the user in one line.
5. **Create the worktree.** Use the core:git-worktrees skill. Branch `feat/<slug>` (slug from the
   ticket title) off the project's default branch. Record the absolute worktree path.
6. **Confirm + launch.** Show the user: ticket title, the slug/branch, worktree path, and the three
   verify commands. On their go-ahead, launch the Workflow tool with
   `scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflows/ticket-to-pr.mjs` and
   `args: { ticket:{title,body,acceptanceCriteria}, verifyCmds:{build,lint,test}, worktreePath,
   branch, caps:{test:3,dev:3,refine:10} }`. The workflow runs in the background; you will be notified
   when it completes.

## ZONE C — main conversation (human-gated), after the workflow returns

7. **Present the result.** Summarize the workflow return: test files, diff summary, acceptance
   criteria met, roborev verdict, and whether build/tests are green. If roborev hit its cap without
   passing, say so explicitly.
8. **Push + PR (only on explicit approval).** Never push automatically. On the user's OK, push the
   branch and open a PR following the user's PR conventions: conventional-commit title; Problem/Fix
   section; change summary; special-attention notes; a pre-merge checklist; manual test steps.
   Reference the ticket in the PR body.
9. **Hand off cleanup.** Tell the user that after the PR is merged they should run
   `/ticket-to-pr-finish $SRC:$REF` to open the docs PR and remove the worktree.

## Notes

- The push/PR gate is deliberate — the workflow only commits to the isolated worktree branch.
- caps are overridable: if the user passes different limits, thread them into `args.caps`.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('plugins/ticket-to-pr/skills/ticket-to-pr/SKILL.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**
```bash
git add plugins/ticket-to-pr/skills/ticket-to-pr/SKILL.md
git commit -m "feat(ticket-to-pr): orchestration skill (Zone A + Zone C)"
```

### Task 8: Entry command

**Files:**
- Create: `plugins/ticket-to-pr/commands/ticket-to-pr.md`

- [ ] **Step 1: Write the command**

`plugins/ticket-to-pr/commands/ticket-to-pr.md`:
```markdown
---
name: ticket-to-pr
description: Take one ticket (GitHub Issue or jig) through to a PR — clarify, test, implement, review-fix
argument-hint: <source>:<id>  e.g. github:1234 or jig:jig-12
---

Invoke the `ticket-to-pr` skill to drive the ticket `$ARGUMENTS` through its execution lifecycle.
Follow the skill exactly: Zone A (resolve, clarify, detect verify commands, create worktree, launch
the workflow), then Zone C (present result, gated push/PR) when the workflow returns.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('plugins/ticket-to-pr/commands/ticket-to-pr.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: End-to-end smoke (manual)**

Reload plugins (restart Claude Code or re-enable the plugin). Run `/ticket-to-pr jig:<fixture-ref>`
from `/tmp/ttp-fixture-jig`. Walk Zone A → workflow → Zone C summary. Confirm: clarifications posted
to the jig issue (`jig issue show <ref>` shows the comment), worktree branch has passing Go tests +
impl, and the skill stops at the push gate without pushing.

- [ ] **Step 4: Commit**
```bash
git add plugins/ticket-to-pr/commands/ticket-to-pr.md
git commit -m "feat(ticket-to-pr): entry command"
```

---

## TRACER 2 — Test-adequacy loop

Outcome: tests are reviewed for AC coverage and revised before dev runs.

### Task 9: test-adequacy-reviewer agent

**Files:**
- Create: `plugins/ticket-to-pr/agents/test-adequacy-reviewer.md`

- [ ] **Step 1: Write the agent**

`plugins/ticket-to-pr/agents/test-adequacy-reviewer.md`:
```markdown
---
name: test-adequacy-reviewer
description: Reviews tests for coverage and completeness against a ticket's acceptance criteria, returning a binary satisfied verdict plus gaps. Invoked by the ticket-to-pr workflow.
tools: Read, Bash, Grep, Glob
model: opus
color: yellow
---

You judge whether a set of tests adequately covers a ticket's acceptance criteria. You do NOT write
tests or implementation. Read-only except for running the test command to observe behavior.

All inspection happens in the git worktree path given in your prompt. `cd` there before ANY command.

## Rubric

- **AC coverage:** every acceptance criterion maps to at least one concrete, executable test case.
  Flag any AC with no test.
- **Edge cases:** stated edge cases (empty/nil/boundary/error paths) are exercised.
- **Test quality:** tests assert behavior, not implementation detail; they would actually fail if the
  behavior were wrong (no vacuous/always-true assertions); names describe the behavior.
- **Failing-for-the-right-reason:** with no implementation, the tests fail on missing
  behavior/symbol, not on a compile error in the test.

Be strict but bounded — only block on gaps that matter for the acceptance criteria. Do not invent
requirements the ticket did not state.

## Output (StructuredOutput)

Return: `{ "satisfied": <bool>, "gaps": [<specific, actionable gap descriptions — each names the AC or
edge case missed and what test to add>] }`. If satisfied, `gaps` is empty.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('plugins/ticket-to-pr/agents/test-adequacy-reviewer.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**
```bash
git add plugins/ticket-to-pr/agents/test-adequacy-reviewer.md
git commit -m "feat(ticket-to-pr): test-adequacy-reviewer agent"
```

### Task 10: Wire the adequacy loop into the workflow

**Files:**
- Modify: `plugins/ticket-to-pr/workflows/ticket-to-pr.mjs`

- [ ] **Step 1: Add the VERDICT schema**

After the `TEST_FILES` definition, add:
```javascript
const VERDICT = {
  type: 'object',
  properties: { satisfied: { type: 'boolean' }, gaps: { type: 'array', items: { type: 'string' } } },
  required: ['satisfied', 'gaps'],
}
```

- [ ] **Step 2: Replace the single test-writer call with the loop**

Replace the `phase('Tests')` block from Task 6 with:
```javascript
phase('Tests')
let tests = await agent(
  `${WT}Write failing tests for this ticket.\n\nTITLE: ${ticket.title}\n\nBODY:\n${ticket.body}\n\n` +
  `ACCEPTANCE CRITERIA:\n${ac}\n\nTest command: ${verifyCmds.test}`,
  { agentType: 'test-writer', schema: TEST_FILES })

let verdict = null
for (let i = 0; i < (caps?.test ?? 3); i++) {
  verdict = await agent(
    `${WT}Review these tests for coverage of the acceptance criteria.\n\nACCEPTANCE CRITERIA:\n${ac}` +
    `\n\nTest files: ${(tests?.files ?? []).join(', ')}\n\nTest command: ${verifyCmds.test}`,
    { agentType: 'test-adequacy-reviewer', schema: VERDICT })
  if (verdict?.satisfied) break
  tests = await agent(
    `${WT}Revise the tests to close these gaps:\n${(verdict?.gaps ?? []).map(g => `- ${g}`).join('\n')}` +
    `\n\nACCEPTANCE CRITERIA:\n${ac}\n\nTest command: ${verifyCmds.test}`,
    { agentType: 'test-writer', schema: TEST_FILES })
}
```

- [ ] **Step 3: Thread the verdict into the return**

In the `return { ... }`, add: `adequacyVerdict: verdict?.satisfied ? 'satisfied' : 'cap-reached',`

- [ ] **Step 4: Syntax check + smoke**

Run (workflow scripts use top-level `return`/`await`, so check as a harness-wrapped async fn, NOT a
bare module): `node --check <(printf 'async function __wf(){\n'; sed 's/^export const meta =/const meta =/' plugins/ticket-to-pr/workflows/ticket-to-pr.mjs; printf '\n}\n') && echo OK` → `OK`
Smoke: re-run the fixture end-to-end (Task 8 procedure). Confirm in /workflows progress that the
adequacy loop runs and either reaches `satisfied` or the cap, and the final tests still drive a passing
implementation.

- [ ] **Step 5: Commit**
```bash
git add plugins/ticket-to-pr/workflows/ticket-to-pr.mjs
git commit -m "feat(ticket-to-pr): test-adequacy loop in workflow"
```

---

## TRACER 3 — roborev review-fix loop

Outcome: after dev, the workflow reviews the branch with roborev and has the dev agent fix findings
until the branch verdict passes or the cap is hit.

### Task 11: roborev review helper in the workflow

**Files:**
- Modify: `plugins/ticket-to-pr/workflows/ticket-to-pr.mjs`

- [ ] **Step 1: roborev JSON surface (CONFIRMED 2026-06-12)**

Verified against job 1034 on this branch. `roborev show <id> --json` returns:
- `verdict_bool` (int, 1 = Pass / 0 = Fail) and `job.verdict` ("P"/"F") — use for the pass/fail gate.
- `output` (string) — the review findings as **free text** (e.g. "No issues found. Summary: ...").
  There is NO structured findings array. The dev fix agent receives this `output` text verbatim.
- `job.status` ("done"/"running"/"failed"). `roborev review --branch --base <default> --wait` is
  async; `--wait` may return before completion, so poll `roborev list --json` for the job's
  `status == done` before reading `show --json`.
Daemon must be running: `roborev status --json` → `.running == true` (start with `roborev daemon
start`). The repo auto-registers on first `roborev review`; no explicit `roborev init` needed.

- [ ] **Step 2: Add a reviewBranch() helper + roborev loop**

The helper runs via a small `dev`-less bash-capable agent OR (preferred) inline through a dedicated
`roborev-runner` step. Implement it as an `agent()` that ONLY runs roborev commands and returns parsed
JSON, so parsing stays in a controlled place:

Add the schema (findings are free text in `output`, not a structured array — see Step 1):
```javascript
const REVIEW = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' }, jobId: { type: 'string' }, reviewText: { type: 'string' },
  },
  required: ['passed', 'jobId', 'reviewText'],
}
```

Add after the `phase('Dev')` loop, before `phase('Commit')`:
```javascript
phase('Refine')
// commit current state first so roborev has commits to review
await agent(`${WT}Stage all changes and commit (conventional): "feat: ${ticket.title}".`,
  { agentType: 'dev' })

let refinePass = false
for (let k = 0; k < (caps?.refine ?? 10); k++) {
  const review = await agent(
    `${WT}Run roborev on this branch and report the verdict + review text as JSON.\n` +
    `1. Run: roborev review --branch --wait  (it exits 1 on Fail — expected; capture output).\n` +
    `2. Extract the job id from the "Enqueued job <id>" line. For a panel, use the synthesis PARENT job.\n` +
    `3. Poll: roborev list --json until that job's status == "done".\n` +
    `4. Run: roborev show <jobId> --json. passed = (verdict_bool == 1). reviewText = the "output" field.\n` +
    `Return passed, jobId (as string), and reviewText. Do NOT fix anything.`,
    { agentType: 'dev', schema: REVIEW })
  if (review?.passed) { refinePass = true; break }
  await agent(
    `${WT}FIX mode. Address the findings in this roborev review, highest severity first:\n\n` +
    review.reviewText +
    `\n\nAfter fixing, run ${verifyCmds.test} (keep green), then commit (conventional). ` +
    `Then comment a concise summary on the review and close it. Pass the comment via a heredoc ` +
    `(never interpolate review text into the shell):\n` +
    `  roborev comment --commenter ticket-to-pr --job ${review.jobId} -m "$(cat <<'TTP_C'\n` +
    `<your summary of fixes + any dismissed findings>\nTTP_C\n)"\n` +
    `  roborev close ${review.jobId}\n` +
    `(Confirm the exact comment flag with \`roborev comment --help\`; the refine skill uses -m.) ` +
    `If a commit-scoped hook review appears (roborev wait), close it too.`,
    { agentType: 'dev', schema: DEV_RESULT })
}
```

- [ ] **Step 3: Thread roborev verdict into the return**

In `return { ... }`, add: `roborevVerdict: refinePass ? 'pass' : 'cap-reached',`
Remove the now-redundant standalone `phase('Commit')` commit from Task 6 if the Refine block already
commits the final state (the loop commits each iteration; ensure at least one commit exists even when
the first review passes — the pre-loop commit covers that).

- [ ] **Step 4: Syntax check + smoke**

Run (workflow scripts use top-level `return`/`await`, so check as a harness-wrapped async fn, NOT a
bare module): `node --check <(printf 'async function __wf(){\n'; sed 's/^export const meta =/const meta =/' plugins/ticket-to-pr/workflows/ticket-to-pr.mjs; printf '\n}\n') && echo OK` → `OK`
Smoke: re-run the fixture end-to-end. Confirm the Refine phase runs `roborev review --branch --wait`,
that findings (if any) get fixed by the dev agent in the worktree, reviews are closed, and the loop
ends on Pass or cap. Verify on the branch that tests still pass.

- [ ] **Step 5: Commit**
```bash
git add plugins/ticket-to-pr/workflows/ticket-to-pr.mjs
git commit -m "feat(ticket-to-pr): roborev review-fix loop in workflow"
```

---

## TRACER 4 — Zone C push/PR gate

Outcome: after approval, the skill pushes and opens a PR. (Skill text from Task 7 step 8 already
specifies this; this tracer hardens it and smoke-tests against a real remote.)

### Task 12: PR creation smoke + skill hardening

**Files:**
- Modify: `plugins/ticket-to-pr/skills/ticket-to-pr/SKILL.md` (only if smoke reveals gaps)

- [ ] **Step 1: Smoke the push/PR path (manual, real remote)**

On a scratch GitHub repo with a real issue, run `/ticket-to-pr github:<#>` through to Zone C. Approve
the push. Confirm: branch pushed (with upstream set via `git push -u origin <branch>`, NOT to a
main-tracking upstream), PR opened with conventional title, Problem/Fix, summary, special-attention,
checklist, manual test steps, and the issue referenced. Confirm nothing was pushed before approval.

- [ ] **Step 2: Fix any gaps in the skill's Zone C instructions**

If the PR body or push behavior was wrong, tighten the Zone C section. (No code change otherwise.)

- [ ] **Step 3: Commit (if changed)**
```bash
git add plugins/ticket-to-pr/skills/ticket-to-pr/SKILL.md
git commit -m "fix(ticket-to-pr): harden Zone C push/PR instructions"
```

---

## TRACER 5 — Finish command: docs PR + cleanup

Outcome: after merge, `/ticket-to-pr-finish <src>:<id>` opens a docs PR and removes the worktree.

### Task 13: doc-writer agent

**Files:**
- Create: `plugins/ticket-to-pr/agents/doc-writer.md`

- [ ] **Step 1: Write the agent**

`plugins/ticket-to-pr/agents/doc-writer.md`:
```markdown
---
name: doc-writer
description: After a ticket-to-pr PR merges, updates affected project documentation on a fresh branch and opens a separate docs PR. Invoked by /ticket-to-pr-finish.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
color: purple
---

You update documentation to reflect a change that just merged. You run on the project's DEFAULT branch
(already checked out and up to date). You never commit to the default branch directly — you branch,
commit, and open a docs PR.

## Inputs (from your prompt)

- The merged PR number / the ticket reference and its acceptance criteria.
- The merge commit range or PR diff.

## Your job

1. Read the project's documentation conventions from `CLAUDE.md` (where docs live, structure,
   wrap width, frontmatter rules). Follow them exactly.
2. From the merged diff + ticket, determine which docs are now stale or missing: architecture/system
   docs, reference docs, runbooks, READMEs. If nothing needs updating, say so and STOP without opening
   a PR.
3. Create a branch `docs/<slug>` off the default branch. Make the doc edits. Commit (conventional:
   `docs(<slug>): ...`).
4. Push and open a docs PR that explains what changed and why, and links the original PR/ticket.

## Output

Report the docs PR URL, or state that no documentation changes were needed.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('plugins/ticket-to-pr/agents/doc-writer.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**
```bash
git add plugins/ticket-to-pr/agents/doc-writer.md
git commit -m "feat(ticket-to-pr): doc-writer agent"
```

### Task 14: Finish command

**Files:**
- Create: `plugins/ticket-to-pr/commands/ticket-to-pr-finish.md`

- [ ] **Step 1: Write the command**

`plugins/ticket-to-pr/commands/ticket-to-pr-finish.md`:
```markdown
---
name: ticket-to-pr-finish
description: After a ticket-to-pr PR is merged — open a docs PR and remove the worktree/branch
argument-hint: <source>:<id>  e.g. github:1234 or jig:jig-12
---

Post-merge wrap-up for ticket `$ARGUMENTS`. Run ONLY after the user confirms the PR merged.

1. **Confirm merge.** Verify the PR for this ticket is merged (GitHub: `gh pr list --search` /
   `gh pr view`). If not merged, STOP and tell the user.
2. **Update the default branch.** Check out the project default branch and pull so the merged change
   is present.
3. **Docs PR.** Use the Task tool to invoke the `doc-writer` agent, passing the ticket reference, its
   acceptance criteria, and the merged PR diff/range. Relay the docs PR URL (or "no docs needed").
4. **Cleanup.** Remove the feature worktree and delete the local feature branch:
   `git worktree remove .worktrees/<slug>` then `git branch -d feat/<slug>`. Confirm with the user
   before deleting if the worktree has uncommitted changes.
5. **Report.** Summarize: docs PR (or none), worktree removed, branch deleted.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('plugins/ticket-to-pr/commands/ticket-to-pr-finish.md').read().split('---')[1])" && echo OK`
Expected: `OK`

- [ ] **Step 3: End-to-end smoke (manual)**

After Tracer 4's PR is merged on the scratch repo, run `/ticket-to-pr-finish github:<#>`. Confirm: a
docs PR opens (or "no docs needed" is reported with reasoning), the worktree is removed
(`git worktree list`), and the local feature branch is gone.

- [ ] **Step 4: Commit**
```bash
git add plugins/ticket-to-pr/commands/ticket-to-pr-finish.md
git commit -m "feat(ticket-to-pr): finish command (docs PR + cleanup)"
```

---

## Final validation

### Task 15: Plugin validation + README

**Files:**
- Create: `plugins/ticket-to-pr/README.md`
- (validation only) all plugin files

- [ ] **Step 1: Validate the plugin structure**

Use the `plugin-dev:plugin-validator` agent (Task tool) against `plugins/ticket-to-pr/`. Address any
Critical/Should-fix findings.

- [ ] **Step 2: Write a short README**

`plugins/ticket-to-pr/README.md`: what it does, the three zones, usage (`/ticket-to-pr <src>:<id>`,
`/ticket-to-pr-finish <src>:<id>`), prerequisites (`gh`/`jig` as needed, `roborev` daemon running,
`bats` for tests), and the caps.

- [ ] **Step 3: Full bats run**

Run: `bats plugins/ticket-to-pr/scripts/ticket.bats`
Expected: all PASS

- [ ] **Step 4: Commit**
```bash
git add plugins/ticket-to-pr/README.md
git commit -m "docs(ticket-to-pr): README + plugin validation"
```

---

## Self-review notes (spec coverage)

- §Architecture three zones → Tracers 1–5 (Zone A skill Task 7; Zone B workflow Tasks 6/10/11; Zone C
  Tasks 7/12; finish Tasks 13–14). ✓
- §Components table → Task 1 (manifest), Task 7 (skill), Task 8 (command), Task 14 (finish), Tasks 2–3
  (ticket.sh), Task 6 (workflow), Tasks 4/5/9/13 (four agents). ✓
- §Ticket adapter (gh JSON + jig text + stdin) → Tasks 2–3. ✓
- §Zone B detail (test-writer, adequacy loop, dev loop, roborev loop, schemas, caps) → Tasks 6, 10, 11.
  ✓
- §Human gates (clarify, push/PR, separate cleanup) → Task 7 (Zone A/C), Task 12, Task 14. ✓
- §Verify-command detection (CLAUDE.md → heuristic → ask) → Task 7 step 4. ✓
- §Risks: #1 roborev JSON → Task 11 step 1; #2 cwd → Task 6 step 3; #3 detection → Task 7; #4 AC
  extraction → Task 7 step 1. ✓
- §Doc agent (docs PR, CLAUDE.md conventions) → Task 13. ✓
```
