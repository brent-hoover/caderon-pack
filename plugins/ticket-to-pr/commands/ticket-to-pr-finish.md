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
