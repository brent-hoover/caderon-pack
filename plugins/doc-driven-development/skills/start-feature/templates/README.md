# feature-work

Every significant piece of work gets a directory here: `feature-work/<slug>/`. The docs are written
in order, and each one is approved before the next is started.

## The flow

| Phase | Doc | Purpose |
|-------|-----|---------|
| PROBLEM | `problem.md` | Current situation, what's wrong, complexity drivers, constraints, out-of-scope, success criteria. **No solutions.** |
| DESIGN | `design.md` | Three solutions (simplest / complete / optimal), the chosen one, interfaces, data shapes, risks. Skipped when the approach is obvious. |
| PLAN | `plan.md` | Ordered steps, each sized for one PR, each with what / why / verify. |
| — | `deferred.md` | Running catalog of work punted during implementation. |
| CLOSE | `completed.md` | What shipped, how it differed from the plan, what was verified. |

Implementation happens after `plan.md` is approved.

## Commands

- `/start-feature <slug>` — drives PROBLEM → DESIGN → PLAN interactively. Each doc is vetted by a
  reviewer subagent before you see it; you give final approval.
- `/close-feature <slug>` — resolves `deferred.md` (do now / keep deferred / drop), writes
  `completed.md`, and moves the directory to `feature-work/archived/<slug>/`.
- `/scaffold-docs` — refreshes the blank templates in `_templates/`.

## Conventions

- **Slugs are kebab-case**: `user-auth`, `billing-export`.
- **Blank templates live in `_templates/`.** Copy from there for hand-written docs; `/start-feature`
  reads them directly from the plugin.
- **No `<placeholder>` text survives.** A doc is either filled in or not written yet.
- **Ground docs in real code** — reference actual modules, symbols, and file paths.
- **Closed features move to `archived/`** rather than being deleted.
