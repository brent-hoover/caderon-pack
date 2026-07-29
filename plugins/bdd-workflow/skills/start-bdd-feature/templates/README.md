# feature-work

Every significant piece of work gets a directory here: `feature-work/<slug>/`. The docs are written
in order, and each one is approved before the next is started. Gherkin scenarios are the definition
of done — they're written before the plan, not after.

## The flow

| Phase | Doc | Purpose |
|-------|-----|---------|
| PROBLEM | `problem.md` | Current situation, what's wrong, complexity drivers, constraints, out-of-scope, success criteria. **No solutions.** |
| DESIGN | `scenarios/*.feature` | One file per behavior. Each needs a happy path, an edge case, and a failure case. **Hard gate — must be approved before planning.** |
| DESIGN | `scope.md` | Objective, allowlist of files the implementation may touch, non-goals. **Hard gate.** |
| DESIGN | `design.md` | Three solutions (simplest / complete / optimal), the chosen one, interfaces, data shapes, risks, and the scenario list. |
| PLAN | `plan.md` | Ordered steps, each sized for one PR, each with what / why / verify. Every scenario is covered by at least one step. |
| — | `deferred.md` | Running catalog of work punted during implementation. |
| CLOSE | `completed.md` | What shipped, how it differed from the plan, what was verified. |

Implementation happens after `plan.md` is approved: the scenarios run red, then you make them green.

## Commands

- `/start-bdd-feature <slug>` — drives PROBLEM → DESIGN → PLAN interactively. The DESIGN phase will
  not advance until the scenarios and `scope.md` are approved. Each doc is vetted by a reviewer
  subagent before you see it; you give final approval.
- `/close-bdd-feature <slug>` — resolves `deferred.md` (do now / keep deferred / drop), writes
  `completed.md`, and moves the directory to `feature-work/archived/<slug>/`.
- `/scaffold-bdd-docs` — refreshes the blank templates in `_templates/`.

## Conventions

- **Slugs are kebab-case**: `user-auth`, `billing-export`.
- **Scenario files are named after the behavior they prove**: `user-login.feature`,
  `payment-refund.feature`.
- **Gherkin discipline**: `Given` is pre-existing state, `When` is the single action under test,
  `Then` asserts observable outcomes only — never implementation details. Steps use concrete inputs
  and outputs.
- **Blank templates live in `_templates/`.** Copy from there for hand-written docs;
  `/start-bdd-feature` reads them directly from the plugin.
- **No `<placeholder>` text survives.** A doc is either filled in or not written yet.
- **Closed features move to `archived/`** rather than being deleted.
