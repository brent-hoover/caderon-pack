# caderon-pack

Personal Claude Code plugin marketplace. Skills, commands, and hooks for Brent's workflow,
organized into plugins that are enabled per machine.

## Plugins

| Plugin | Enabled on | Contents |
|--------|-----------|----------|
| `core` | all machines | roborev review workflow (7), `explain-code`, `conventional-commit`, `codebase-visualizer`, `code-quality`, `git-master`, `vue-typescript` |
| `go` | all machines | `go-backend-workflow`, `go-concurrency-patterns`, `go-error-handling`, `go-interfaces` |
| `devops` | work machines only | `helm-debugging`, `helm-values-management`, `k8s-manifest-generator`, `k8s-security-policies` |
| `doc-driven-development` | all machines | `start-feature` — `problem → design → plan` documentation workflow (`/start-feature [slug]`) |

## Installation

Skills are distributed as plugins from this GitHub marketplace and enabled declaratively in
`~/.claude/settings.json` (managed by chezmoi, templated per machine). On a fresh machine:

```bash
chezmoi apply               # writes settings.json with the caderon-pack marketplace + enabled plugins
# launch Claude Code, or install explicitly:
claude plugin marketplace add brent-hoover/caderon-pack
claude plugin install core@caderon-pack go@caderon-pack doc-driven-development@caderon-pack -s user
```

Claude resolves the marketplace from GitHub and installs the enabled plugins. Manual
installs are scoped to `user`.

## Machine profiles

The per-machine skill set is driven by the `is_personal_machine` chezmoi data var
(`~/.config/chezmoi/chezmoi.yaml`) and the templated `dot_claude/settings.json.tmpl` in the
chezmoi repo:

- **Personal machines** (`is_personal_machine: true`): `core`, `go`, `doc-driven-development`.
- **Work machines**: set `is_personal_machine: false` in `~/.config/chezmoi/chezmoi.yaml`
  before `chezmoi apply`; this additionally enables the `devops` plugin.

To add a skill to a machine class, move it into the appropriate plugin here, bump that
plugin's version, push, then `claude plugin marketplace update caderon-pack`.

> **Local development:** because the marketplace source is GitHub, edits to this repo only
> take effect after `git push`. To test local edits without pushing, add a directory-source
> override for `caderon-pack` in `~/.claude/settings.local.json` (untracked, machine-local).

## Doc conventions (doc-driven-development)

The `start-feature` skill auto-detects your project's doc root from `CLAUDE.md`:

- Projects with `feature-work/` convention → writes to `feature-work/<slug>/`
- All others → writes to `docs/<slug>/`

When a feature is complete, write `completed.md` then move the directory to
`<doc-root>/archived/<slug>/`.

## Design docs

- `docs/specs/2026-05-29-claude-asset-management-design.md`
- `docs/plans/2026-05-29-claude-asset-management.md`
