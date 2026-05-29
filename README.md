# caderon-pack

Personal Claude Code plugin marketplace. Skills, commands, and hooks for Brent's workflow,
organized into plugins that are enabled per machine.

## Plugins

| Plugin | Enabled on | Contents |
|--------|-----------|----------|
| `core` | all machines | `explain-code`, `conventional-commit`, `codebase-visualizer`, `code-quality`, `git-master`, `vue-typescript` |
| `go` | all machines | `go-backend-workflow`, `go-concurrency-patterns`, `go-error-handling`, `go-interfaces` |
| `devops` | work machines only | `helm-debugging`, `helm-values-management`, `k8s-manifest-generator`, `k8s-security-policies` |
| `doc-driven-development` | all machines | `start-feature` — `problem → design → plan` documentation workflow (`/start-feature [slug]`) |

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

## Codex

Codex shares the Agent Skills (`SKILL.md`) format but doesn't read Claude's plugin
marketplace. `scripts/sync-codex-skills.py` copies the skills from whichever caderon-pack
plugins are **enabled on this machine** (read from `~/.claude/settings.json`) into
`~/.codex/skills/`, using the newest installed version of each from Claude's plugin cache:

```bash
./scripts/sync-codex-skills.py            # or --dry-run to preview
```

It's idempotent and only manages skills it installed (marked with a `.caderon-synced` file) —
it never touches roborev's skills (roborev installs those to `~/.codex/skills/` itself) or
Codex internals. Re-run it after `claude plugin update` to refresh Codex. It respects the
machine profile automatically (e.g. `devops` skills sync only on work machines).

Other agents (Gemini, Cursor, OpenCode) use different conventions and are not synced.

## Doc conventions (doc-driven-development)

The `start-feature` skill auto-detects your project's doc root from `CLAUDE.md`:

- Projects with `feature-work/` convention → writes to `feature-work/<slug>/`
- All others → writes to `docs/<slug>/`

When a feature is complete, write `completed.md` then move the directory to
`<doc-root>/archived/<slug>/`.

## Design docs

- `docs/specs/2026-05-29-claude-asset-management-design.md`
- `docs/plans/2026-05-29-claude-asset-management.md`
