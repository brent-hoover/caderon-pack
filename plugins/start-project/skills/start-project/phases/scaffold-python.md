# Scaffold: Python

Not a standalone phase — `phases/07-scaffold.md` directs reading this file at
its step 1, after determining `docs/stack.md` frontmatter `language: python`.
It contains only steps A–E, run from phase 7's step 3. Every step is guarded
for re-entry: check whether its output exists before creating it.

## A. Init

Two separate guards — the manifest can exist without the dev deps installed:

- If `pyproject.toml` does **not** exist, run `uv init` (`<root>` is the
  `root:` package name from `docs/arch-rules.yaml`); this creates
  `pyproject.toml` and `src/<root>/`.

  ```bash
  uv init --package --name <root> .
  ```

- **Always** ensure the dev deps are present, even on resume: if any of
  `pytest`, `archunitpython`, `pytest-bdd` is missing from `pyproject.toml`,
  run the `uv add` below (it's idempotent — deps already present are left
  as-is).

  ```bash
  uv add --dev pytest 'archunitpython>=1.3' pytest-bdd
  ```

The `>=1.3` floor guarantees the `project_layers` fluent API the canonical
architecture test (step C) uses — earlier releases lack it. If
`archunitpython` can't be installed or its API can't express the rules, use
`pytest-archon` instead — same test-file model.

## B. Skeleton

For each module in `docs/arch-rules.yaml`, guard on `__init__.py`, not the
directory — an interrupted run can leave a `src/<root>/<module>/` with no
`__init__.py`, an incomplete package. If `src/<root>/<module>/__init__.py`
is missing (whether or not the directory exists), create it:

```bash
mkdir -p src/<root>/<module> && touch src/<root>/<module>/__init__.py
```

## C. Architecture test

If `tests/test_architecture.py` already exists, verify it matches the
current `arch-rules.yaml` module list and skip to step D.

Before writing, verify the fluent API against the installed version — the
library is young, prefer its current idiom if it differs from the canonical
form below:

```bash
uv run python -c "import archunitpython as a; print([n for n in dir(a) if not n.startswith('_')])"
```

Write `tests/test_architecture.py`, generated from `arch-rules.yaml`.
Canonical form — adapt module names and `may_import` edges to the actual
module list, one test per module:

```python
"""Generated from docs/arch-rules.yaml — regenerate, don't hand-edit."""
import pathlib

from archunitpython import project_layers, assert_passes

# Declared modules, from arch-rules.yaml. Keep in sync when the YAML changes.
DECLARED_MODULES = {"domain", "services", "adapters"}


def test_no_undeclared_modules():
    """Every package dir under src/<root>/ must be a declared module —
    an undeclared module would otherwise pass with no import checks."""
    root = next(p for p in pathlib.Path("src").iterdir() if p.is_dir())
    actual = {
        p.name for p in root.iterdir()
        if p.is_dir() and not p.name.startswith(("_", "."))
    }
    assert actual == DECLARED_MODULES, (
        f"module dirs {actual} != declared {DECLARED_MODULES}"
    )


def _layers():
    return (
        project_layers("src/")
        .layer("domain").defined_by_folder("**/domain/**")
        .layer("services").defined_by_folder("**/services/**")
        .layer("adapters").defined_by_folder("**/adapters/**")
    )


# one test per module, from its may_import list
def test_domain_imports_no_sibling_modules():
    assert_passes(_layers().where_layer("domain").may_only_depend_on_layers())


def test_services_may_import_only_domain():
    assert_passes(_layers().where_layer("services").may_only_depend_on_layers("domain"))


def test_adapters_may_import_only_domain_and_services():
    assert_passes(_layers().where_layer("adapters").may_only_depend_on_layers("domain", "services"))
```

## D. BDD specs from STORIES.md

Skip to step E only if **both** are already present for every epic in
`docs/STORIES.md`: the `tests/features/<epic-slug>.feature` file **and** its
`tests/test_<epic-slug>.py` harness. If a feature file exists but its
harness is missing, generate the missing harness before skipping — a
scaffold with feature files but no `test_<epic>.py` never executes the
scenarios, so the BDD specs would pass green instead of the required red.

For each epic, write `tests/features/<epic-slug>.feature`:

- Each `### Story:` → `Scenario:`
- Its Given/When/Then bullets → steps: each `- Given …, When …, Then …`
  bullet splits into three Gherkin step lines (`Given` / `When` / `Then`).
  When a story has multiple bullets, subsequent bullets' steps either use
  `And` under the corresponding keyword or repeat the keyword — still one
  `Scenario:` per story regardless of bullet count.
- Story title → scenario name
- Epic → `Feature:`

Then, if not already present, one `tests/test_<epic-slug>.py` per feature
file, using the underscored form of the epic slug (it must be a valid
Python module name — the `.feature` filename may keep hyphens; slugify
once, consistently: lowercase, non-alphanumerics replaced by the separator
— `-` for the feature filename, `_` for the test filename), containing
only:

```python
from pytest_bdd import scenarios

scenarios("features/<epic-slug>.feature")
```

No step definitions — undefined steps are the red state.

## E. Run & show output

Always rerun, even on re-entry — the exit gate needs current output, not a
stale run from an earlier session.

```bash
uv run pytest tests/test_architecture.py -v
```
Expect: all PASS.

```bash
uv run pytest tests/ -v
```
Expect: architecture tests PASS, feature tests FAIL/ERROR (undefined steps).

Paste both outputs into phase 7's exit gate.
