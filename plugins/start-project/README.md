# start-project Plugin

A Claude Code plugin for greenfield project planning: transforms a vision into a working repository with architecture tests (green) and BDD specs (red) in seven gated phases.

## The Seven Phases

1. **Vision** — Capture system shape, goals, and success criteria
2. **Stack** — Choose languages, frameworks, and key dependencies
3. **Architecture** — Define module boundaries, dependency rules, and architecture tests
4. **Data Models** — Design core entities and their relationships
5. **Stories** — Write acceptance criteria grounded in the data model
6. **Plan** — Slice stories into implementation phases
7. **Scaffold** — Generate language-specific skeleton and stamp the repo with generated architecture tests (green) and BDD specs (red)

## Resume Mode

Each phase document includes a frontmatter `status` field. Re-run `/start-project` in (or pointing at) the project directory at any time to resume — it scans docs/ for the first non-approved phase and continues there.

## Supported Scaffold Languages

- Python
- Go

## Design Rationale

See [docs/superpowers/specs/2026-07-16-start-project-plugin-design.md](docs/superpowers/specs/2026-07-16-start-project-plugin-design.md) for the full design, phase ordering rationale, and plugin architecture.
