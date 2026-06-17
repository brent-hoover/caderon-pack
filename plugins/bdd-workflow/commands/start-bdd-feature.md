---
name: start-bdd-feature
description: Guided problem → BDD scenarios → design → plan documentation workflow for a new feature
argument-hint: Optional feature slug (e.g. user-auth, billing-export)
---

Invoke the `bdd-workflow:start-bdd-feature` skill to run the full BDD-driven feature
workflow: PROBLEM → DESIGN (with mandatory BDD scenarios gate) → PLAN → DONE.

The DESIGN phase will not advance to PLAN until:
1. BDD scenarios (`.feature` files) are written and approved
2. `scope.md` is filled with objective, allowlist, and non-goals

Each doc is auto-reviewed by a dedicated Opus reviewer subagent before it reaches the user.

| Phase | Reviewer subagent |
|-------|-------------------|
| PROBLEM | `bdd-workflow:problem-reviewer` |
| DESIGN | `bdd-workflow:design-reviewer` |
| PLAN | `bdd-workflow:plan-reviewer` |
