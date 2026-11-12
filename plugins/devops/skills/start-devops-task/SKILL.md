---
name: start-devops-task
description: >
  Lightweight test-first flow for small infrastructure changes (Terraform/OpenTofu): one task.md,
  Gherkin scenarios run by pytest-bdd against plan JSON, one test-adequacy review, then implement.
  Use for well-understood DevOps tasks that need tests but not a problem statement or design doc —
  e.g. "add two S3 buckets", "add a lifecycle rule", "tag these resources".
  Trigger phrases: "devops task", "/start-devops-task", "/start-devops-task <slug>".
  Escalates to start-bdd-feature when the work needs a design decision.
version: 1.0.0
allowed-tools: Read, Write, Edit, Bash, Glob, Task
---

# start-devops-task

Five steps: SETUP → TASK → RED → GREEN → CLOSE. One doc (`task.md`) and one `.feature` file.
The user approves once, after RED, when the task and its failing tests can be read together.

`task.md` is a work record and gets archived at CLOSE. The `.feature` file is a permanent
regression test, so it lives in the test tree (`scenarios/`), never under `feature-work/` —
archiving must not move a file that step definitions bind to.

This flow sits between `core:quick-fix` (no new tests) and `bdd-workflow:start-bdd-feature`
(problem → design → plan). It does not replace either.

---

## Fit check (before SETUP)

Use this flow only if **all** of these are true:

- The change is understood: the user can say what resources/attributes should exist afterward.
- No design choice is open: no "module vs inline", "which service", or "how should we structure
  this" question is unresolved.
- It touches one root module or one module, and no state migration (`moved`, `import`,
  `state mv`) is needed.

If any is false, stop and say which one failed. Recommend `/start-bdd-feature` and do not start
this flow. If the change needs no new tests (typo, comment, formatting), recommend `/quick-fix`.

---

## SETUP

Announce: **[SETUP]**

**1. Slug.** Use the argument if given. Otherwise ask for a kebab-case slug, e.g. `s3-audit-buckets`.

**2. Worktree.** Branch from the remote default branch, not local, and do not track it (a branch
created from `origin/<default>` would otherwise push to the default branch).

```bash
git fetch origin
default_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||')
repo_root=$(git rev-parse --show-toplevel)
git worktree add --no-track -b "task/<slug>" "$repo_root/.worktrees/task-<slug>" "origin/$default_branch"
```

If `.worktrees/` is not gitignored (`git check-ignore -q .worktrees` fails), add it to
`.gitignore` in the worktree's first commit. If the command fails, stop and report the error.
Report the absolute worktree path. All later commands run inside it.

**3. Doc dir.** `feature-work/<slug>/` at the repo root. Never `.claude/`, `superpowers/`, or `docs/`.

```bash
mkdir -p feature-work/<slug>
date +%Y-%m-%d
git config user.name
```

**4. Find the plan source.** Before writing anything, establish how this repo produces a plan:
which root module, `tofu` or `terraform` (check `.terraform-version`, `.opentofu-version`, CI
config, `Makefile`/`justfile`), var files, and whether `init` needs backend credentials. If a plan
cannot be produced on this machine, stop and ask the user — the RED step depends on it.

**5. Test harness.** Check for `pyproject.toml` with `pytest-bdd`, an existing `tests/step_defs/`,
and where feature files live. Use the repo-root `scenarios/` directory (the `bdd-workflow:pytest-bdd`
layout) unless the repo already keeps `.feature` files elsewhere outside `feature-work/` — then
use that location wherever this skill says `scenarios/`. If the harness is missing, tell the user what you would add (`uv add --dev
pytest pytest-bdd`, a `conftest.py` with the plan fixture below) and get approval before adding
dependencies. Load `bdd-workflow:pytest-bdd` for step-definition conventions if it is available.

---

## TASK

Announce: **[TASK]**

Write `feature-work/<slug>/task.md` from `${CLAUDE_PLUGIN_ROOT}/skills/start-devops-task/templates/task.md`.

- **Goal**: 1–3 sentences. No problem-statement essay.
- **Acceptance**: one bullet per scenario. Each names a checkable property of the plan
  ("bucket `x` has SSE-KMS with key `y`"), not an activity ("configure encryption").
- **Changes**: the `.tf` files you expect to touch.
- **Plan source / Verify**: filled from SETUP step 4. No `<placeholder>` text may remain.

If the user's request is ambiguous on a property that a scenario must pin (bucket names,
encryption type, versioning, region, tags), ask now. Do not invent values.

Do not show the doc to the user yet. Go to RED.

---

## RED

Announce: **[RED]**

**1. Scenarios.** Write `scenarios/<slug>/<slug>.feature` (repo root, see SETUP step 5). One scenario per
Acceptance bullet, same name. Declarative steps about the plan:

```gherkin
Feature: Audit log buckets

  Scenario: Audit bucket is created with KMS encryption
    Given the plan for the "infra/prod" root module
    Then the plan creates "aws_s3_bucket.audit_logs"
    And "aws_s3_bucket_server_side_encryption_configuration.audit_logs" uses "aws:kms"
```

**2. Plan fixture.** A session-scoped fixture in `tests/step_defs/conftest.py` runs the plan once
and returns the parsed JSON. It runs `plan` only — never `apply` or `destroy` — with
`-lock=false` so tests never block or hold the shared state lock.

```python
@pytest.fixture(scope="session")
def plan_json(tmp_path_factory: pytest.TempPathFactory) -> dict:
    plan_file = tmp_path_factory.mktemp("plan") / "tfplan"
    run_tofu(ROOT_MODULE, "plan", "-input=false", "-lock=false", f"-out={plan_file}")
    shown = run_tofu(ROOT_MODULE, "show", "-json", str(plan_file))
    return json.loads(shown.stdout)
```

`run_tofu` must use `check=True` and include the module path and stderr in its error, so a broken
plan fails loudly instead of looking like a failed assertion.

**3. Steps.** `tests/step_defs/test_<slug_underscored>.py`, bound with
`scenarios("../../scenarios/<slug>/<slug>.feature")`. Steps assert on `resource_changes`
(for the planned action: `create`, `update`, `delete`) and on
`planned_values` / `resource_changes[].change.after` (for attributes). Never grep `.tf` source.

**4. Run red.** Run the Verify pytest command. Every scenario must **fail on an assertion**.
A collection error, fixture error, or plan error is not red — fix it and re-run.

**5. Review.** Use the **Task** tool to run `devops:test-adequacy-reviewer`. Pass the absolute
path to `task.md` and the red-run output. Apply every Critical and Should-fix item, re-run red.
Note Suggestions but don't auto-apply them.

**6. User gate.** Set `status: red` in `task.md`. Show `task.md` and the `.feature` file with the
`core:markdown-review` skill. Include a 2–4 line summary: red-run result (N failed, 0 errors)
and what the reviewer flagged. Revise until the user approves.

Commit the tests on approval:

```bash
git add feature-work/<slug>/ scenarios/<slug>/<slug>.feature tests/step_defs/ pyproject.toml uv.lock   # only paths you changed
git commit -m "test(<slug>): add failing plan scenarios"
```

Stage explicit paths — never `git commit -a`.

---

## GREEN

Announce: **[GREEN]**

1. Make the `.tf` changes. Touch only files in **Changes**. If another file needs changing, stop,
   update **Changes**, and tell the user why.
2. Run every command in **Verify**, in order, chained with `&&`. All scenarios pass.
3. If the repo has `tflint`, `trivy config`, or `checkov` configured (config file or CI step),
   run them too. Do not add new scanners without asking.
4. Read the full plan summary (`tofu show <planfile>` or the `resource_changes` actions). If it
   plans any `delete` or replace you did not intend, stop and tell the user.
5. Set `status: green` in `task.md`, and record anything deferred or surprising under **Notes**.

Commit:

```bash
git add <changed .tf files> feature-work/<slug>/task.md
git commit -m "feat(<slug>): <what the infrastructure change does>"
```

---

## CLOSE

Announce: **[CLOSE]**

1. **Roborev.** Wait for roborev reviews of the commits. Fix findings in new commits and close
   the reviews. Nothing merges without a roborev pass or an operator exception.
2. **Deferred items.** Each **Notes** item that is follow-up work becomes a kata issue. Put the
   issue id next to the note.
3. **Archive.** Set `status: done`, then move the task record. Only `task.md` moves; the
   `.feature` file and step definitions stay where they are.

   ```bash
   mkdir -p feature-work/archived
   git mv feature-work/<slug> feature-work/archived/<slug>
   git commit -m "docs(<slug>): archive task"
   ```

4. **Re-verify.** Run every command in **Verify** again (from the archived `task.md`), chained
   with `&&`. The pass count must match GREEN. A collection error here means a binding pointed
   into `feature-work/` — fix the binding, not the archive.
5. **Report.** List what changed (files), what was verified (commands + pass counts), and what
   was skipped. Ask before pushing or opening a PR.

`apply` is never part of this flow. Applying is the user's call, through their normal deploy path.
