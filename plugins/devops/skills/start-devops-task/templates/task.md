---
slug: <slug>
owner: <git user.name>
date: <YYYY-MM-DD>
status: draft            # draft → approved → red → green → done
kata: <issue id, or "none">
---

# <one-line task title>

## Goal

<1–3 sentences: what changes in the infrastructure and why it is needed now.>

## Acceptance

Each line is one scenario in `scenarios/<slug>.feature`. The scenario name matches the bullet.

- <Scenario name> — <what the plan must show>

## Changes

Files expected to change. Touching anything else means stop and update this list first.

- `<path>` — <what changes>

## Plan source

How the scenarios get plan JSON for this repo.

- Root module: `<path>`
- Plan command: `<tofu|terraform> plan -input=false -lock=false -out=<file>` (plus any `-var-file`)
- Credentials / backend: <what must be set, or "offline: init -backend=false">

## Verify

Commands that must pass before the task is done, in the order they run.

```bash
<tofu|terraform> fmt -check -recursive
<tofu|terraform> validate
uv run pytest tests/step_defs/test_<slug>.py
```

## Notes

<Anything deferred or surprising, added during implementation. Empty is fine.>
