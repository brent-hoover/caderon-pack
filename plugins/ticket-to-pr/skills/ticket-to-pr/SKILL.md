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
4. **Detect verify commands.** The workflow needs all three of `build`, `lint`, `test` defined and
   non-empty. In order: (a) read the project `CLAUDE.md` `## Commands` section; (b) else infer from
   project type — `go.mod` → `go build ./...` / `go vet ./...` / `go test ./...`; `pyproject.toml` →
   build `python -m build` (or `true` if the project isn't packaged) / lint `ruff check .` / test
   `pytest`; `package.json` → its `build`/`lint`/`test` scripts (use `true` for any the project
   doesn't define). **(c) For ANY of the three you cannot confidently infer, ASK the user — never
   launch the workflow with an empty or guessed command.** Confirm the final three with the user in
   one line before launching.
5. **Create the worktree.** Use the core:git-worktrees skill. Branch `feat/<slug>` (slug from the
   ticket title) off the project's default branch. Record the absolute worktree path.
6. **Confirm + launch.** Show the user: ticket title, the slug/branch, worktree path, and the three
   verify commands. On their go-ahead, launch the Workflow tool with
   `scriptPath: ${CLAUDE_PLUGIN_ROOT}/workflows/ticket-to-pr.mjs` and
   `args: { ticket:{title,body,acceptanceCriteria}, verifyCmds:{build,lint,test}, worktreePath,
   branch, caps:{test:3,dev:3,refine:10} }`. The workflow runs in the background; you will be notified
   when it completes.

## ZONE C — main conversation (human-gated), after the workflow returns

7. **Present the result.** Summarize the full workflow return — `status`, `testsPassing`,
   `buildClean`, `lintClean`, `adequacyVerdict`, `roborevVerdict`, the test files, the diff summary,
   and the acceptance criteria met. Call out explicitly any non-green signal: `status` other than
   `ok`, a `cap-reached` adequacy/roborev verdict, or any false among tests/build/lint.
8. **Push + PR (only on explicit approval).** Only offer to push/open the PR automatically when
   `status == "ok"`; for any other status, surface what's unresolved and let the user decide whether
   to proceed. Never push automatically. On the user's OK, push the
   branch (`git push -u origin <branch>` — never set the upstream to the default branch) and open a PR
   following the user's PR conventions: conventional-commit title; Problem/Fix section; change summary;
   special-attention notes; a pre-merge checklist; manual test steps. Reference the ticket in the PR
   body.
9. **Hand off cleanup.** Tell the user that after the PR is merged they should run
   `/ticket-to-pr-finish $SRC:$REF` to open the docs PR and remove the worktree.

## Notes

- The push/PR gate is deliberate — the workflow only commits to the isolated worktree branch.
- caps are overridable: if the user passes different limits, thread them into `args.caps`.
