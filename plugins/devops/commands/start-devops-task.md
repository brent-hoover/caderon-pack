---
name: start-devops-task
description: Lightweight test-first flow for a small infrastructure change — task.md, failing Gherkin plan scenarios, implement
argument-hint: Optional task slug (e.g. s3-audit-buckets)
---

Invoke the `devops:start-devops-task` skill: SETUP → TASK → RED → GREEN → CLOSE.

- One doc (`feature-work/<slug>/task.md`) and one `.feature` file — no problem/design/plan docs.
- Scenarios run with pytest-bdd against `tofu show -json` plan output and must fail before any
  `.tf` change is made.
- `devops:test-adequacy-reviewer` vets the tests before the user's single approval gate.
- If the work needs a design decision, the skill stops and recommends `/start-bdd-feature`.
