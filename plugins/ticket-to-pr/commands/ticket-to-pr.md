---
name: ticket-to-pr
description: Take one ticket (GitHub Issue or jig) through to a PR — clarify, test, implement, review-fix
argument-hint: <source>:<id>  e.g. github:1234 or jig:jig-12
---

Invoke the `ticket-to-pr` skill to drive the ticket `$ARGUMENTS` through its execution lifecycle.
Follow the skill exactly: Zone A (resolve, clarify, detect verify commands, create worktree, launch
the workflow), then Zone C (present result, gated push/PR) when the workflow returns.
