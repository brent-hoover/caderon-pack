---
name: python-best-practices
description: Python best practices for types, errors, models, async, and project layout. Use when writing Python code, reviewing .py files, or designing Python packages/services.
---

# Python Best Practices

The goal is code that is easy to change safely. These rules exist to keep the next diff small.

## Runtime & tooling settings

Package management: **uv only** (not pip, poetry, or pipenv).

```bash
uv init my-project
uv add fastapi pydantic
uv add --dev ruff pytest pytest-asyncio
```

Lint and format: **ruff** for both. One config block in `pyproject.toml`:

```toml
[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM"]
```

Type check with `mypy` or `pyright`. New code must pass with no errors.

Python version: pin in `.python-version` (managed by uv) and in `pyproject.toml`:

```toml
[project]
requires-python = ">=3.12"
```

## Type system & modeling

Type hints on all new code — parameters, return values, class attributes.

```python
def find_user(user_id: str) -> User | None: ...
def create_order(user: User, items: list[Item]) -> Order: ...
```

Use `TypeAlias` and `NewType` for domain primitives:

```python
from typing import NewType
UserID = NewType("UserID", str)
OrderID = NewType("OrderID", str)
```

**Pydantic V2** for all data models — validation, serialization, settings:

```python
from pydantic import BaseModel, Field

class User(BaseModel):
    id: UserID
    email: str
    role: Literal["admin", "member"] = "member"
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

Use `model_validate` (not `parse_obj`). Use `model_dump` (not `dict()`).

For settings, use `pydantic-settings`:

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    api_key: str

    model_config = SettingsConfigDict(env_file=".env")
```

## Error handling

Fail loudly. No bare `except`. No swallowed exceptions.

```python
# Good
try:
    result = call_external_api()
except httpx.HTTPStatusError as e:
    raise ServiceError(f"API call failed: {e.response.status_code}") from e

# Bad — never do this
try:
    result = call_external_api()
except Exception:
    pass
```

Define a domain error hierarchy rooted at one base class:

```python
class AppError(Exception):
    """All application errors inherit from this."""

class NotFoundError(AppError): ...
class ValidationError(AppError): ...
class AuthError(AppError): ...
```

Raise domain errors from the service layer; translate to HTTP responses at the handler boundary.

## None hygiene

Never accept or return `None` at a function boundary without declaring it:

```python
# Explicit optional
def find_user(user_id: UserID) -> User | None: ...

# Callers must handle None
user = find_user(uid)
if user is None:
    raise NotFoundError(f"user {uid} not found")
```

Use `Optional[X]` only for Pydantic fields (V2 convention). Prefer `X | None` elsewhere.

Avoid `None` as a sentinel for "not provided" — use `dataclasses.field(default=MISSING)` or a dedicated sentinel type.

## Async / concurrency rules

Async by default for any I/O-bound code (HTTP, DB, file, queue).

```python
import asyncio
import httpx

async def fetch_user(client: httpx.AsyncClient, user_id: str) -> User:
    response = await client.get(f"/users/{user_id}")
    response.raise_for_status()
    return User.model_validate(response.json())
```

Use `asyncio.gather` for concurrent fan-out:

```python
users = await asyncio.gather(*[fetch_user(client, uid) for uid in user_ids])
```

Use `asyncio.TaskGroup` (Python 3.11+) when you need structured concurrency with error propagation:

```python
async with asyncio.TaskGroup() as tg:
    task_a = tg.create_task(step_a())
    task_b = tg.create_task(step_b())
```

Never mix sync and async without an explicit bridge (`asyncio.run`, `loop.run_in_executor`).

FastAPI routes are `async def` by default. Use `def` only for CPU-bound routes (FastAPI runs them in a thread pool).

## Module & file conventions

```
src/
  myapp/
    __init__.py
    main.py          # FastAPI app factory
    settings.py      # pydantic-settings Settings class
    domain/          # pure business logic, no I/O
    services/        # orchestration layer
    routers/         # FastAPI routers, one file per resource
    models/          # Pydantic models
    db/              # database session, repositories
tests/
  unit/
  integration/
```

One module per concern. Split when a file exceeds ~300 lines.

Import order (enforced by ruff/isort): stdlib → third-party → local.

## Testing conventions

**pytest** with `pytest-asyncio` for async tests.

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

Parameterize instead of duplicating:

```python
@pytest.mark.parametrize("email,valid", [
    ("user@example.com", True),
    ("not-an-email", False),
])
def test_email_validation(email: str, valid: bool) -> None:
    if valid:
        User(email=email)
    else:
        with pytest.raises(ValidationError):
            User(email=email)
```

Use `pytest.fixture` with explicit scope. Prefer real dependencies (test DB, local server) over mocks at integration boundaries. Use `unittest.mock.patch` or `pytest-mock` only for external services you can't spin up locally.

FastAPI tests use `httpx.AsyncClient` with `ASGITransport`:

```python
@pytest.fixture
async def client(app: FastAPI) -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
```

## Claude / Anthropic API work

Use the `anthropic` SDK. Enable prompt caching on long system prompts and documents.

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    system=[{
        "type": "text",
        "text": long_system_prompt,
        "cache_control": {"type": "ephemeral"},
    }],
    messages=[{"role": "user", "content": user_message}],
)
```

Use `anthropic.AsyncAnthropic` in async contexts.

## Standard rules per function / class

- Every public function has a type-annotated signature.
- Every class has a docstring if its purpose isn't obvious from the name.
- Constructors (`__init__`) only assign attributes — no I/O, no side effects.
- `@classmethod` factory methods for complex construction: `User.from_dict(...)`.
- `__repr__` on every domain model (Pydantic provides this automatically).
- No global mutable state outside of settings.
