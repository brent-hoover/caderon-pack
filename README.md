# caderon-pack

Personal Claude Code plugin pack. Skills, commands, and hooks for Brent's workflow.

## Skills

### start-feature

Guides Claude through the full `problem → design → plan` documentation workflow for a new
feature. Four-phase state machine with approval gates. Claude generates content from targeted
questions; you review and approve each doc before advancing.

**Trigger:** Say "start a feature", "new feature", or `/start-feature [slug]`.

**Output:** `problem.md`, `design.md` (unless trivial), `plan.md` in your project's doc
directory.

**Templates included:** problem, design, plan, deferred, completed.

## Installation

### Local install (any machine)

```bash
git clone https://github.com/brent-hoover/caderon-pack ~/path/to/caderon-pack
claude plugins marketplace add ~/path/to/caderon-pack
claude plugins install caderon-pack
```

Restart Claude Code to activate.

### Via chezmoi (optional — for cross-machine sync)

Add to `~/.local/share/chezmoi/.chezmoiexternal.toml`:

```toml
[".claude/plugins/caderon-pack"]
  type = "git-repo"
  url = "https://github.com/brent-hoover/caderon-pack.git"
  refreshPeriod = "168h"
```

Then register and install once per machine:

```bash
chezmoi apply
claude plugins marketplace add ~/.claude/plugins/caderon-pack
claude plugins install caderon-pack
```

## Doc conventions

The `start-feature` skill auto-detects your project's doc root from `CLAUDE.md`:

- Projects with `feature-work/` convention → writes to `feature-work/<slug>/`
- All others → writes to `docs/<slug>/`

When a feature is complete, write `completed.md` then move the directory to
`<doc-root>/archived/<slug>/`.

## Future

- npm publishing (`npm install -g caderon-pack`)
- Additional skills and commands as needed
