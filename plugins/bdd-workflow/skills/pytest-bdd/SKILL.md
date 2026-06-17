---
name: pytest-bdd
description: >
  Guide for implementing BDD scenarios in Python using pytest-bdd. Use when the project is Python
  and needs step definitions wired to Gherkin .feature files. Covers project layout, step
  definition patterns, fixture injection, scenario parametrization, and running scenarios.
version: 1.0.0
allowed-tools: Read, Write, Edit, Bash, Glob
---

# pytest-bdd implementation guide

## Project layout

```
project/
├── scenarios/               # .feature files (from start-bdd-feature workflow)
│   ├── user-login.feature
│   └── payment-refund.feature
├── tests/
│   └── step_defs/
│       ├── conftest.py      # shared fixtures
│       ├── test_user_login.py
│       └── test_payment_refund.py
└── pyproject.toml / setup.cfg
```

Feature files live in `scenarios/` (owned by the workflow). Step definition files live in
`tests/step_defs/` and are named `test_<feature-slug>.py`.

## Installation

```bash
uv add --dev pytest-bdd
# or: pip install pytest-bdd
```

## Step definition file structure

Each feature file gets a corresponding `test_<slug>.py`:

```python
from pytest_bdd import scenarios, given, when, then, parsers

# Bind all scenarios in this file to the feature file
scenarios("../../scenarios/user-login.feature")


@given("the accounts service is running", target_fixture="service")
def accounts_service(app_client):
    # app_client injected from conftest.py fixture
    return app_client


@given(parsers.parse("a token that expired {hours:d} hour(s) ago"), target_fixture="token")
def expired_token(hours):
    return generate_expired_token(hours_ago=hours)


@when(parsers.parse("the client calls {method} {path}"), target_fixture="response")
def call_endpoint(service, token, method, path):
    return service.request(method, path, headers={"Authorization": f"Bearer {token}"})


@then(parsers.parse("the response status is {status:d}"))
def check_status(response, status):
    assert response.status_code == status


@then(parsers.parse('the body contains "{text}"'))
def check_body(response, text):
    assert text in response.text
```

### Key decorator rules

- `@given` — set up state; use `target_fixture="name"` to expose a value to later steps
- `@when` — perform the action; use `target_fixture` for the result (e.g., `response`)
- `@then` — assert; no `target_fixture` needed
- `parsers.parse(...)` — captures typed variables from step text (`{name:d}` for int, `{name}` for string)
- `parsers.re(r"...")` — regex capture when parse isn't expressive enough

### Step sharing

Steps shared across multiple feature files belong in `tests/step_defs/conftest.py`:

```python
# tests/step_defs/conftest.py
import pytest
from pytest_bdd import given

@pytest.fixture
def app_client():
    # shared test client setup
    client = create_test_client()
    yield client
    client.close()

@given("the system is in a clean state")
def clean_state(db_session):
    db_session.rollback()
```

## pytest configuration

Add to `pyproject.toml` or `pytest.ini`:

```toml
[tool.pytest.ini_options]
bdd_features_base_dir = "scenarios/"
```

Or pass explicitly when running:

```bash
pytest tests/step_defs/ -v
```

## Running scenarios

```bash
# Run all scenarios
pytest tests/step_defs/ -v

# Run a single feature file
pytest tests/step_defs/test_user_login.py -v

# Run a specific scenario by name
pytest tests/step_defs/test_user_login.py -k "expired token is rejected" -v

# Show BDD-style output
pytest tests/step_defs/ -v --tb=short
```

## Scenario parametrization (Examples tables)

For `Scenario Outline` with an `Examples` table:

```gherkin
Scenario Outline: token expiry threshold
  Given a token that expired <hours> hour(s) ago
  When the client calls GET /accounts
  Then the response status is <status>

  Examples:
    | hours | status |
    | 0     | 200    |
    | 1     | 401    |
    | 24    | 401    |
```

pytest-bdd handles `Scenario Outline` automatically — each row becomes a separate test case.

## Step definition generation

To scaffold step definitions from an existing feature file:

```bash
pytest --generate-missing --feature scenarios/user-login.feature tests/step_defs/
```

This prints stub `@given`/`@when`/`@then` functions for any steps not yet defined.

## Common mistakes

| Mistake | Fix |
|---|---|
| Step text doesn't match exactly | Copy step text verbatim from feature file |
| `target_fixture` missing on `@given` | Add `target_fixture="name"` so later steps can inject it |
| Using `assert` on response inside `@when` | Move assertions to `@then` |
| Feature file path wrong in `scenarios(...)` | Use path relative to the step definition file |
| Fixture not found | Define it in `conftest.py` or the same file |
