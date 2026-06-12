# ticket-to-pr

Drive one already-scoped ticket (GitHub Issue or jig) through its execution lifecycle: clarify →
worktree → tests → test-adequacy loop → implement → roborev review-fix loop → PR, with a separate
post-merge docs PR + cleanup. Planning (problem/design/plan) is out of scope — the ticket must carry
acceptance criteria.

## Three zones

- **Zone A (command, human-gated):** resolve the ticket, ask clarifying questions, post answers back,
  detect verify commands, create the worktree.
- **Zone B (background Workflow, deterministic):** test-writer → adequacy reviewer loop → dev loop →
  roborev review-fix loop → commit on the worktree branch. **Never pushes.**
- **Zone C (command, human-gated):** present the result; on your approval, push + open the PR. After
  the PR merges, `/ticket-to-pr-finish` opens a docs PR and removes the worktree.

## Usage

```
/ticket-to-pr <source>:<id>          # e.g. /ticket-to-pr github:1234  or  /ticket-to-pr jig:jig-12
/ticket-to-pr-finish <source>:<id>   # after the PR is merged
```

## Prerequisites

- `gh` (authenticated) for GitHub Issues, and/or `jig` for jig projects.
- `roborev` with its daemon running (`roborev status`) — the review-fix loop depends on it.
- `bats-core` to run the adapter tests (`bats scripts/ticket.bats`).

## Loop caps

The workflow caps each loop (overridable via the command's `caps`): test-adequacy `3`, dev `3`,
roborev refine `10`. If a loop hits its cap without converging, the result says so explicitly and the
push/PR gate still requires your approval.

## Components

- `commands/` — `ticket-to-pr` (entry), `ticket-to-pr-finish` (post-merge).
- `skills/ticket-to-pr/` — the Zone A + Zone C orchestration procedure.
- `workflows/ticket-to-pr.mjs` — the Zone B deterministic loop.
- `scripts/ticket.sh` — ticket adapter (`show`/`comment`) for `github` and `jig`.
- `agents/` — `test-writer`, `test-adequacy-reviewer`, `dev`, `doc-writer`.
