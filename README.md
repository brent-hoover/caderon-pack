# caderon-pack

Personal Claude Code plugin marketplace. Skills, commands, and hooks for Brent's workflow,
organized into plugins that are enabled per machine.

## Plugins

| Plugin | Enabled on | Contents |
|--------|-----------|----------|
| `core` | all machines | `explain-code`, `conventional-commit`, `codebase-visualizer`, `code-quality`, `git-master`, `git-worktrees`, `vue-typescript`, `user-stories`, `bdd-specs`, `sqlite-dev`, `agent-teams`; `/quick-fix` command |
| `go` | all machines | `go-best-practices`, `go-backend-workflow`, `go-concurrency-patterns`, `go-error-handling`, `go-interfaces` |
| `python` | all machines | `python-best-practices` |
| `devops` | work machines only | `helm-debugging`, `helm-values-management`, `k8s-manifest-generator`, `k8s-security-policies`, `terraform-skill` |
| `doc-driven-development` | all machines | `start-feature` (`problem → design → plan`) + `close-feature` (revisit deferred → completed → archive) documentation lifecycle, with `problem-reviewer` / `design-reviewer` / `plan-reviewer` / `completion-reviewer` Opus agents vetting each doc |
| `ticket-to-pr` | all machines | `/ticket-to-pr` and `/ticket-to-pr-finish` commands; clarify → tests → implement → roborev → PR workflow |
| `excalidraw-diagrams` | all machines | `excalidraw` skill for generating `.excalidraw` architecture and K8s diagrams |

The **roborev** skills (`roborev-review`, `roborev-fix`, etc.) are intentionally **not** in any
plugin — they are owned by the `roborev` CLI, which installs them into `~/.claude/skills/` and
keeps them current. Install/refresh per machine with `roborev skills install` (and
`roborev update` / `roborev skills update` for updates). chezmoi ignores `.claude/skills/**`, so
it won't fight roborev over them.

## Installation

Skills are distributed as plugins from this GitHub marketplace and enabled declaratively in
`~/.claude/settings.json` (managed by chezmoi, templated per machine). On a fresh machine:

```bash
chezmoi apply               # writes settings.json with the caderon-pack marketplace + enabled plugins
# launch Claude Code, or install explicitly:
claude plugin marketplace add brent-hoover/caderon-pack
claude plugin install core@caderon-pack go@caderon-pack python@caderon-pack doc-driven-development@caderon-pack -s user
```

Claude resolves the marketplace from GitHub and installs the enabled plugins. Manual
installs are scoped to `user`.

## Machine profiles

The per-machine skill set is driven by the `is_personal_machine` chezmoi data var
(`~/.config/chezmoi/chezmoi.yaml`) and the templated `dot_claude/settings.json.tmpl` in the
chezmoi repo:

- **Personal machines** (`is_personal_machine: true`): `core`, `go`, `python`, `doc-driven-development`.
- **Work machines**: set `is_personal_machine: false` in `~/.config/chezmoi/chezmoi.yaml`
  before `chezmoi apply`; this additionally enables the `devops` plugin.

To add a skill to a machine class, move it into the appropriate plugin here, bump that
plugin's version, push, then `claude plugin marketplace update caderon-pack`.

> **Local development:** because the marketplace source is GitHub, edits to this repo only
> take effect after `git push`. To test local edits without pushing, add a directory-source
> override for `caderon-pack` in `~/.claude/settings.local.json` (untracked, machine-local).

## Codex

Codex can install the same Agent Skills (`SKILL.md`) from the repo-local Codex marketplace
at `.agents/plugins/marketplace.json`. From a local checkout:

```bash
codex plugin marketplace add /path/to/caderon-pack
codex plugin add core@caderon-pack go@caderon-pack python@caderon-pack doc-driven-development@caderon-pack
```

Install `devops@caderon-pack` on work machines. Codex packages the `skills/` directories;
Claude-specific `commands/` and `agents/` are not exposed through the Codex plugin metadata.

The older `scripts/sync-codex-skills.py` path is still available if you want to copy skills
directly into `~/.codex/skills/` from Claude's installed plugin cache.

Plugin metadata is kept in sync by the `Sync plugin metadata` GitHub Action. Edits to shared
fields in either `plugins/<plugin>/.claude-plugin/plugin.json` or
`plugins/<plugin>/.codex-plugin/plugin.json` are copied to the other side; conflicting edits to
the same field fail the workflow instead of overwriting.

Other agents (Gemini, Cursor, OpenCode) use different conventions and are not synced.

## Doc conventions (doc-driven-development)

The `start-feature` skill auto-detects your project's doc root from `CLAUDE.md`:

- Projects with `feature-work/` convention → writes to `feature-work/<slug>/`
- All others → writes to `docs/<slug>/`

During implementation, punted work is logged to `deferred.md`. When a feature is complete, run
`/close-feature`: it revisits `deferred.md` (do now / keep deferred / permanently drop), writes
`completed.md`, and moves the directory to `<doc-root>/archived/<slug>/`.

## Design docs

- `docs/specs/2026-05-29-claude-asset-management-design.md`
- `docs/plans/2026-05-29-claude-asset-management.md`
