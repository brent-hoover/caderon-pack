# superpowers

Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques.

## Provenance

Vendored from [obra/superpowers](https://github.com/obra/superpowers) v6.3.0 (MIT,
Copyright (c) 2025 Jesse Vincent — see `LICENSE`), so this workflow does not depend on
an external marketplace.

Kept: `skills/`, `hooks/`, `.claude-plugin/plugin.json`, `LICENSE`.

Dropped as not used by Claude Code at runtime: upstream `docs/`, `tests/`, top-level
`scripts/` (release tooling — the scripts the skills actually call live under
`skills/*/scripts/`), `assets/`, `RELEASE-NOTES.md`, and the per-harness packaging
directories for Codex, Cursor, Devin, Hermes, Kimi, Pi, OpenCode, and Gemini.

Updating means re-copying from upstream; there is no merge path back.
