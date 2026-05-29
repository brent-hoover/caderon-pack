# Claude Asset Management — Design

**Date:** 2026-05-29
**Status:** Approved (design)

## Problem

Claude Code assets (plugins, skills, config) are managed by three overlapping
systems that duplicate each other and snapshot machine-specific state:

1. **Plugins** — 24 installed, declarative via `settings.json`
   (`enabledPlugins` + `extraKnownMarketplaces`) and `plugins/installed_plugins.json`.
2. **Standalone skills** — 31 under `~/.claude/skills/`, vendored via `skillfish`
   (each carries a `.skillfish.json` origin record). Many duplicate skills that
   an installed plugin already provides.
3. **A stray symlink** — `find-skills -> ~/.agents/skills/find-skills`, a fourth
   location.

chezmoi snapshots all of it under `dot_claude/`, including machine-specific files
(`installed_plugins.json` with absolute paths, marketplace install locations).

Additional requirement: **different skill sets on different machines** — the
personal machine should not carry the DevOps/k8s skills; the work machine should.

## Goal

A reproducible, machine-aware setup: sit at any machine, and after a single
`chezmoi apply` + Claude launch, get exactly the plugins and skills appropriate
for that machine — with no vendored duplicates and no machine-state cruft in
version control.

## Architecture

Three layers, each with one responsibility:

1. **`caderon-pack` (GitHub marketplace, `brent-hoover/caderon-pack`)** — owns all
   personal skills/commands as plugins. New plugins sit alongside the existing
   `doc-driven-development`, using the established layout:
   `plugins/<name>/.claude-plugin/plugin.json` + `plugins/<name>/skills/<skill>/SKILL.md`.
   The marketplace manifest (`.claude-plugin/marketplace.json`) lists each plugin.

2. **`settings.json` (per machine, chezmoi-templated)** — the profile switch.
   `enabledPlugins` selects which caderon-pack plugins are active on this machine;
   `extraKnownMarketplaces` always includes caderon-pack.

3. **chezmoi** — manages *config files only*: `settings.json.tmpl`, `CLAUDE.md`,
   `.mcp.json`, statusline scripts, docs. It no longer tracks skills or
   machine-state files.

### Reproducibility flow (new machine)

1. `chezmoi init` — sets the machine profile data var.
2. `chezmoi apply` — writes `settings.json` with the caderon-pack marketplace and
   the correct `enabledPlugins` for the profile, plus `CLAUDE.md`, `.mcp.json`,
   statusline.
3. Launch Claude Code — it reads `enabledPlugins`, fetches caderon-pack from
   GitHub, and installs the enabled plugins.

No skillfish, no vendored copies, no manual install steps. Claude reconstructs
`installed_plugins.json` and the plugin `cache/` itself.

## Plugins to create in caderon-pack

Skills are **vendored into these plugins** (copied from the current
`~/.claude/skills/` sources), curated and pinned by us.

- **`core`** (all machines):
  `roborev-design-review`, `roborev-design-review-branch`, `roborev-fix`,
  `roborev-refine`, `roborev-respond`, `roborev-review`, `roborev-review-branch`,
  `explain-code`, `conventional-commit`, `codebase-visualizer`, `code-quality`,
  `git-master`, `vue-typescript`
- **`go`** (all machines):
  `go-backend-workflow`, `go-concurrency-patterns`, `go-error-handling`,
  `go-interfaces`
- **`devops`** (work machine only):
  `helm-debugging`, `helm-values-management`, `k8s-manifest-generator`,
  `k8s-security-policies`

Each gets a `.claude-plugin/plugin.json` (author/homepage/repository/license
matching `doc-driven-development`) and an entry in `marketplace.json`.

## Profiles

A chezmoi data var per machine (set at `chezmoi init`) drives the template. Use a
boolean `is_work` (default `false`) or an explicit `claude_profiles` list.
`settings.json.tmpl` renders `enabledPlugins` accordingly:

- **personal (and other non-work machines):** `core`, `go`
- **work:** `core`, `go`, `devops`

`core` and `go` are enabled everywhere; `devops` is the only profile-gated plugin
(work only).

`extraKnownMarketplaces` includes `caderon-pack` (GitHub source) on all machines.

## Deletions

**Standalone skills that duplicate an installed plugin (5)** — the plugin provides
them, so the vendored copies go:
`agent-development`, `hook-development`, `mcp-integration`, `plugin-structure`
(all from `plugin-dev`), `frontend-design` (from the `frontend-design` plugin).

**Junk / low-quality / off-stack (4):**
- `skill-adapter` — origin is a `backups/helm-chart-generator` folder; name does
  not match content.
- `kubernetes-secrets-manager` — auto-generated stub, low quality.
- `template` — empty skill stub; `skill-creator` plugin covers this.
- `git-advanced-workflows` — superseded by `git-master`.

**`find-skills` symlink** — drop (can be re-added to `core` later if missed).

**Remove from chezmoi tracking** (machine state Claude regenerates; add to
`.chezmoiignore`):
- `dot_claude/skills/**` (now lives in caderon-pack)
- `dot_claude/plugins/private_installed_plugins.json`
- `dot_claude/plugins/modify_known_marketplaces.json.tmpl`
- `dot_claude/modify_dot_claude.json.tmpl`

## Outcome

31 loose skills → **21 repackaged** into 3 versioned plugins, **10 deleted**,
machine selection via one templated `enabledPlugins` list.

## Out of scope

- Templating `.mcp.json` per machine (e.g. k8s MCP only on work) — left as-is for
  now; revisit if MCP servers diverge across machines.
- Migrating `doc-driven-development` — it already lives in caderon-pack, unchanged.

## Verification

- Personal profile: `core` + `go` skills (17) listed by Claude; no `devops`
  skills present.
- Work profile (`is_work = true`): all 21 skills present.
- `~/.claude/skills/` contains no vendored duplicates of plugin-provided skills.
- chezmoi diff shows no machine-state files tracked.
- caderon-pack `marketplace.json` validates and each new plugin loads.
