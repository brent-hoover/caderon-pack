# Feature docs

Every significant piece of work gets a directory here: `<slug>/`. The docs are written in order,
and each one is approved before the next is started. Gherkin scenarios are the definition of done —
they're written before the plan, not after.

All paths below are relative to this directory, whatever it's called in this project.

## The flow

| Phase | Doc | Purpose |
|-------|-----|---------|
| PROBLEM | `<slug>/problem.md` | Current situation, what's wrong, complexity drivers, constraints, out-of-scope, success criteria. **No solutions.** |
| DESIGN | `<slug>/scenarios/*.feature` | One file per behavior. Each needs a happy path, an edge case, and a failure case. **Hard gate — must be approved before planning.** |
| DESIGN | `<slug>/design.md` | Three solutions (simplest / complete / optimal), the chosen one, interfaces, data shapes, risks, and the scenario list. |
| DESIGN | `<slug>/scope.md` | Objective, allowlist of files the implementation may touch, non-goals — derived from the approved design. **Hard gate.** |
| PLAN | `<slug>/plan.md` | Ordered steps, each sized for one PR, each with what / why / verify. Every scenario is covered by at least one step. |
| — | `<slug>/deferred.md` | Running catalog of work punted during implementation. |
| CLOSE | `<slug>/completed.md` | What shipped, how it differed from the plan, what was verified. |

Implementation happens after `plan.md` is approved: the scenarios run red, then you make them green.

## Commands

- `/start-bdd-feature <slug>` — drives PROBLEM → DESIGN → PLAN interactively. The DESIGN phase will
  not advance until the scenarios and `scope.md` are approved. `problem.md`, `design.md`, and
  `plan.md` are each vetted by a reviewer subagent before you see them; scenarios and `scope.md` go
  straight to you. You give final approval either way.
- `/close-bdd-feature <slug>` — resolves `deferred.md` (do now / keep deferred / drop), writes
  `completed.md`, and moves the directory to `archived/<slug>/`.
- `/scaffold-bdd-docs` — drops the blank templates into `feature-work/_templates/`.

## Conventions

- **Slugs are kebab-case**: `user-auth`, `billing-export`.
- **Scenario files are named after the behavior they prove**: `user-login.feature`,
  `payment-refund.feature`.
- **Gherkin discipline**: `Given` is pre-existing state, `When` is the single action under test,
  `Then` asserts observable outcomes only — never implementation details. Steps use concrete inputs
  and outputs.
- **No `<placeholder>` text survives.** A doc is either filled in or not written yet.
- **Closed features move to `archived/`** rather than being deleted.
- If `_templates/` exists here, it holds the blank templates for hand-written docs;
  `/start-bdd-feature` reads them straight from the plugin either way.
