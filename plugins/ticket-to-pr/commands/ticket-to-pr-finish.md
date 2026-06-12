---
name: ticket-to-pr-finish
description: After a ticket-to-pr PR is merged — open a docs PR and remove the worktree/branch
argument-hint: <source>:<id>  e.g. github:1234 or jig:jig-12
---

Post-merge wrap-up for ticket `$ARGUMENTS`. Run ONLY after the user confirms the PR merged.

1. **Resolve the ticket.** Split `$ARGUMENTS` on `:` into SRC and REF. Validate `SRC` is exactly
   `github` or `jig`, then (quoting all expansions) run
   `"${CLAUDE_PLUGIN_ROOT}/scripts/ticket.sh" show "$SRC" "$REF"` and extract the title and acceptance
   criteria (you pass these to `doc-writer`). The code PR is always on GitHub regardless of SRC.
2. **Find the merged PR + its branch.** Locate the PR for this work and confirm it is merged:
   ```bash
   gh pr list --state merged --search "<ticket ref or title keywords>" --json number,headRefName,mergedAt,title
   ```
   The list query returns only `title`/`number`/`headRefName` — to verify a ticket-ref match in the
   body, fetch each candidate's body with `gh pr view <number> --json number,headRefName,body,state`.
   Require **exactly one** PR that clearly references this ticket (prefer a PR number the user gave, or
   an exact ticket-ref match in the body/title). If zero or more than one match, STOP and ask the user
   to disambiguate — never guess, or you may delete the wrong worktree/branch. Capture into shell
   variables:
   ```bash
   NUMBER=<the PR number>
   BRANCH=<the headRefName, e.g. feat/the-slug>
   default=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')
   repo_root=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
   ```
3. **Update the default branch.** Run all git operations against the main checkout with
   `git -C "$repo_root" ...` (you may be running from inside the feature worktree). Check out `$default`
   and pull: `git -C "$repo_root" checkout "$default" && git -C "$repo_root" pull`.
4. **Get the merged diff** for `doc-writer`:
   ```bash
   gh pr diff "$NUMBER"                      # or, if the branch ref still exists locally:
   git log --oneline "$default..$BRANCH"
   ```
5. **Docs PR.** Use the Task tool to invoke the `doc-writer` agent, passing: the ticket REF, its
   acceptance criteria (from step 1), `$NUMBER`, the merged diff (from step 4), and the absolute
   `repo_root` — instruct it to run every git command from `repo_root` (`cd "$repo_root"` or
   `git -C "$repo_root"`) so the docs branch is created from the updated main checkout, not the feature
   worktree. Relay the docs PR URL it returns, or "no docs needed".
6. **Cleanup.** Remove the feature worktree and delete the local branch. `core:git-worktrees` names
   the directory after the branch with `/` replaced by `-` (`feat/<slug>` → `.worktrees/feat-<slug>`)
   under the repo root, so resolve the path from `$repo_root` + `$BRANCH` (not the current directory):
   ```bash
   git -C "$repo_root" worktree remove "$repo_root/.worktrees/${BRANCH//\//-}"   # --force only after confirming no wanted changes
   git -C "$repo_root" branch -d "$BRANCH"
   ```
   If `git worktree remove` reports uncommitted changes, STOP and confirm with the user before using
   `--force`. `git branch -d` will fail when the PR was squash- or rebase-merged (the local branch is
   not an ancestor of the updated default branch). Since you have already confirmed the PR is merged
   (step 2), ask the user to approve `git branch -D "$BRANCH"`, or report that the branch was retained.
7. **Report.** Summarize: docs PR (or none), worktree removed, branch deleted.
