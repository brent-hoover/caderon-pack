# superpowers

Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques.

## Provenance

Vendored from [obra/superpowers](https://github.com/obra/superpowers) v6.3.0 (MIT,
Copyright (c) 2025 Jesse Vincent — see `LICENSE`), so this workflow does not depend on
an external marketplace.

Kept: `skills/`, `hooks/`, `assets/superpowers-small.svg`, `.claude-plugin/plugin.json`,
`LICENSE`.

Dropped as not used by Claude Code at runtime: upstream `docs/`, `tests/`, top-level
`scripts/` (release tooling — the scripts the skills actually call live under
`skills/*/scripts/`), `assets/app-icon.png`, `RELEASE-NOTES.md`, and the per-harness
packaging directories for Codex, Cursor, Devin, Hermes, Kimi, Pi, OpenCode, and Gemini.

## Local modifications

This copy is **not** byte-identical to upstream v6.3.0. Re-copying from upstream will
drop the fixes below, so re-apply them after any update.

- `skills/writing-skills/render-graphs.js` → `render-graphs.mjs`. It uses ESM `import`
  but the plugin ships no `package.json` declaring `"type": "module"`. Node 22.7+
  auto-detects ESM so it runs there, but on Node 18 and 20 it is parsed as CommonJS and
  dies at the first `import`. The `.mjs` extension makes it version-independent.
  References in `skills/writing-skills/SKILL.md` and the script's own usage text updated.

- `skills/brainstorming/scripts/server.cjs` serves the brand logo from the bundled
  `assets/superpowers-small.svg` as a `data:` URI instead of fetching it from
  `primeradiant.com` on every render, which disclosed the viewer's IP, request timing
  and plugin version to a third party. `assets/superpowers-small.svg` is restored from
  upstream unmodified for this. The `?v=<version>` cache-buster — the telemetry signal —
  is gone; the existing `SUPERPOWERS_DISABLE_TELEMETRY` suppression is unchanged.

- `skills/brainstorming/SKILL.md` pointed agents at `skills/brainstorming/visual-companion.md`,
  which does not resolve from a consuming project's working directory. Now a
  skill-relative link.

- `skills/subagent-driven-development/scripts/sdd-workspace` keys the workspace on the
  plan's repo-relative path hash, not just its basename. Two plans both named `plan.md`
  in different directories previously shared one workspace and overwrote each other's
  briefs, review packages and `progress.md` — the exact failure the script's own header
  says plan-scoping exists to prevent. `task-brief` and `review-package` derive their
  paths from this script, so they inherit the fix; their doc comments are updated.
