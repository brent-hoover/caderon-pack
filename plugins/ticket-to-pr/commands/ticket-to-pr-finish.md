---
name: ticket-to-pr-finish
description: After a ticket-to-pr PR is merged — open a docs PR and remove the worktree/branch
argument-hint: <source>:<id>  e.g. github:1234 or jig:jig-12
---

Post-merge wrap-up for ticket `$ARGUMENTS`. Run ONLY after the user confirms the PR merged.

1. **Resolve the ticket.** Split `$ARGUMENTS` on `:` into SRC and REF. Run
   `${CLAUDE_PLUGIN_ROOT}/scripts/ticket.sh show $SRC $REF` and extract the title and acceptance
   criteria (you pass these to `doc-writer`). The code PR is always on GitHub regardless of SRC.
2. **Find the merged PR + its branch.** Locate the PR for this work and confirm it is merged:
   ```bash
   gh pr list --state merged --search "<ticket ref or title keywords>" --json number,headRefName,mergedAt,title
   ```
   If no merged PR matches, STOP and tell the user. Record `NUMBER` and `BRANCH` (`headRefName`, e.g.
   `feat/<slug>`). Derive `SLUG` = `BRANCH` with the leading `feat/` removed.
3. **Update the default branch.** Determine it
   (`git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@'`), check it out in the main
   checkout, and `git pull` so the merged change is present.
4. **Get the merged diff** for `doc-writer`: `gh pr diff NUMBER` (or `git log --oneline <default>..BRANCH`
   if the branch ref still exists locally).
5. **Docs PR.** Use the Task tool to invoke the `doc-writer` agent, passing: the ticket REF, its
   acceptance criteria (from step 1), the PR NUMBER, and the merged diff (from step 4). Relay the docs
   PR URL it returns, or "no docs needed".
6. **Cleanup.** Remove the feature worktree and delete the local branch. `core:git-worktrees` names
   the directory after the branch with `/` replaced by `-` (`feat/<slug>` → `.worktrees/feat-<slug>`),
   so derive the path from `BRANCH`, not `SLUG`:
   ```bash
   WORKTREE_DIR=".worktrees/${BRANCH//\//-}"
   git worktree remove "$WORKTREE_DIR"         # add --force only after confirming no wanted changes
   git branch -d "$BRANCH"
   ```
   If `git worktree remove` reports uncommitted changes, STOP and confirm with the user before using
   `--force`.
7. **Report.** Summarize: docs PR (or none), worktree removed, branch deleted.
