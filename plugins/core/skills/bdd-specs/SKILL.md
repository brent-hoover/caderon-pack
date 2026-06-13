---
name: bdd-specs
description: >-
  Behavior-driven design: write executable specifications BEFORE any
  implementation code. Integrates with the doc-driven-development workflow —
  reads feature-work/<slug>/plan.md and problem.md when present, otherwise
  falls back to /docs/PLAN.md and /docs/STORIES.md. Generates spec files in
  nested Feature > Scenario > Specification blocks: each Scenario arranges its
  data in a setup block, every Specification makes exactly one assertion,
  happy-path specs come first and exhaustively, and sad-path specs live in
  their own separate blocks. Detects the language and runner automatically:
  Go (go.mod) or Python (pyproject.toml / .py files). Use when starting a
  new project or feature, when asked to "spec out", "write the tests first",
  do BDD/TDD, or turn a plan or user stories into a test suite.
---

# Behavior-Driven Design — Specifications First

Specifications are written **before** implementation. The spec is the
design artifact: it encodes the intended behavior from the plan and the
user stories, fails first, and is the definition of done. Do not write
implementation code under this skill until the specs exist and the user
has seen them.

## 🎯 Why: Design for Change

The goal of writing software is to be able to **change it safely**. Specs
are the safety net that makes change possible — without them, every edit
is a guess. One assertion per Specification means a failing spec names
exactly what broke; happy/sad-path separation means you can change one
behavior without re-reading the whole suite. The spec suite *is* the
change-budget for the codebase.

## The non-negotiable workflow

Run these gates **in order**. Do not skip ahead.

### 1. Locate the feature docs

Check two locations in order of preference:

**A. Doc-driven-development docs** (preferred — check first):

Look for `feature-work/` in the project root. If it exists, find the most
recent or relevant `<slug>/plan.md`. Also read `<slug>/problem.md` (for
success criteria and failure modes) and `<slug>/design.md` (for domain
model and technical boundaries) when they exist.

Derive features and acceptance criteria from these docs:
- Each plan **Step** with a **Verify** clause → candidate Feature
- Each **Success criterion** in `problem.md` → acceptance criterion (happy path)
- Each **Failure mode** or constraint in `problem.md` → sad-path Scenario
- The domain model in `design.md` → invariants to enforce

**B. Legacy docs** (fall back if no DDD docs):

Look for the build plan at `/docs/PLAN.md` (also accept `docs/PLAN.md`,
`PLAN.md`, or an obvious `docs/plan.*`) and user stories at
`/docs/STORIES.md` (also accept `docs/STORIES.md`, `STORIES.md`).

- **If the plan is missing:** stop. Ask the user to provide a plan. Offer
  to scaffold `templates/PLAN.md` or draft one from their description.
- **If stories are missing:** stop. Ask the user for the user stories.
  Offer to scaffold `templates/STORIES.md` or derive draft stories from
  the plan. Do not proceed without stories — they are the source of every
  Scenario.

### 2. Detect the language and test runner

Pick from the project — do not ask. Check in this order:

| Check | Runner | Output |
|-------|--------|--------|
| `go.mod` exists | **go test** | `*_test.go` files, testify assertions |
| `pyproject.toml`, `setup.py`, or `*.py` files | **pytest** | `test_*.py` files, class-based structure |

State which runner you detected and why before generating files.

### 3. Generate the specs

For every feature derived from the docs, produce a spec file built from
the matching language template. Map stories/steps to features 1:1, write
the files, then stop and let the user review before any implementation.

## The spec structure (mandatory shape — all languages)

Three nested levels, outer to inner: **Feature → Scenario → Specification**.

The surface syntax differs by language; the logical structure is identical.

### Go (`go test` + testify)

```go
// STORY-007 — Atomic create of user, order, entitlements
func TestFeatureAtomicCreateUserOrderEntitlements(t *testing.T) {
    // --- HAPPY PATH --- exhaustive, first

    t.Run("Scenario: creating a new user with an order", func(t *testing.T) {
        // Arrange all data this scenario needs
        svc := newTestService(t)
        result, err := svc.Create(ctx, validInput)
        require.NoError(t, err)

        t.Run("returns a non-empty user ID", func(t *testing.T) {
            assert.NotEmpty(t, result.UserID)
        })

        t.Run("persists the order", func(t *testing.T) {
            assert.NotEmpty(t, result.OrderID)
        })
    })

    // --- SAD PATH --- segregated, each failure is its own scenario

    t.Run("Scenario: rejecting a duplicate email", func(t *testing.T) {
        svc := newTestService(t)
        _, _ = svc.Create(ctx, validInput)      // seed
        _, err := svc.Create(ctx, validInput)   // duplicate

        t.Run("returns a conflict error", func(t *testing.T) {
            assert.ErrorIs(t, err, ErrConflict)
        })
    })
}
```

### Python (pytest)

```python
# STORY-007 — Atomic create of user, order, entitlements
class TestFeatureAtomicCreateUserOrderEntitlements:
    """Feature: atomic create of user, order, entitlements"""

    class TestScenarioCreatingANewUserWithAnOrder:
        """Scenario: creating a new user with an order (HAPPY)"""

        @pytest.fixture(scope="class")
        def result(self, service):
            return service.create(valid_input)

        def test_returns_a_non_empty_user_id(self, result):
            assert result.user_id

        def test_persists_the_order(self, result):
            assert result.order_id

    class TestScenarioRejectingADuplicateEmail:
        """Scenario: rejecting a duplicate email (SAD)"""

        def test_raises_conflict_error(self, service):
            service.create(valid_input)  # seed
            with pytest.raises(ConflictError):
                service.create(valid_input)
```

## Hard rules — every generated file must obey all of them

1. **Feature** is the outermost block, titled `Feature: …` — no story id
   in the title. One feature per file, sourced from a plan step or user
   story. File name is a readable slug without a story-id prefix. Put the
   story id in a comment at the top of the file.

2. **Scenario** arranges **all** of its required data in a setup block
   (`beforeAll` / `@pytest.fixture(scope="class")` / local arrange in the
   Go sub-test). No arrange logic inside the assertion block itself.

3. **Specification** (`it` / `def test_` / inner `t.Run`) contains
   **exactly one assertion**. Multiple observations → multiple specs.

4. **Happy path first, and exhaustive.** Cover every success outcome the
   story implies before any failure case.

5. **Sad path is segregated.** Error, validation, and edge-case specs go
   in their own separate Scenario block(s) — never interleaved.

6. **Language-appropriate types.** Go: typed structs, no `interface{}`.
   Python: type hints expected.

7. **At least one Scenario per Feature exercises the deployed entry
   point.** Import the production export — handler, route, service
   constructor — not an internal function. Drive side effects through fake
   adapters injected at the boundary (fake DB, fake email, fake storage).
   Unit-seam specs are fine *in addition*, but never *instead*.

## Templates

Copy the file that matches the detected runner and adapt it — do not
hand-write the scaffold:

- `templates/feature.go_test.go` — Go: `go test` + testify, Feature/Scenario/Specification shape
- `templates/feature.pytest.py` — Python: pytest class-based, happy + segregated sad paths
- `templates/PLAN.md` — build-plan scaffold for when no DDD docs exist
- `templates/STORIES.md` — user-story scaffold for when no DDD docs exist

See `references/workflow.md` for the story→feature→scenario mapping worked
through end to end in both languages, and the exhaustiveness checklist.
