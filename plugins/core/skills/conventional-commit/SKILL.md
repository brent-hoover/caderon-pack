---
name: conventional-commit
description: Create commit messages following conventional commit conventions. Use when committing code changes, writing commit messages, or formatting git history. Follows conventional commits with issue references.
---

# Commit Messages

Follow these conventions when creating commits for Python projects.

## Prerequisites

Before committing, ensure you're working on a feature branch, not the main branch.

```bash
# Check current branch
git branch --show-current
```

If you're on `main` or `master`, create a new branch first:

```bash
# Create and switch to a new branch
git checkout -b <type>/<short-description>
```

Branch naming should follow the pattern: `<type>/<short-description>` where type matches the commit type (e.g., `feat/add-user-auth`, `fix/null-pointer-error`, `ref/extract-validation`).

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

The header is required. Scope is optional. All lines must stay under 100 characters.

## Commit Types

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `ref` | Refactoring (no behavior change) |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `test` | Test additions or corrections |
| `build` | Build system or dependencies |
| `ci` | CI configuration |
| `chore` | Maintenance tasks |
| `style` | Code formatting (no logic change) |
| `meta` | Repository metadata |
| `license` | License changes |

## Subject Line Rules

- Use imperative, present tense: "Add feature" not "Added feature"
- Capitalize the first letter
- No period at the end
- Maximum 70 characters

## Body Guidelines

- Explain **what** and **why**, not how
- Use imperative mood and present tense
- Include motivation for the change
- Contrast with previous behavior when relevant

## Footer: Issue References

Reference issues in the footer using these patterns:

```
Fixes GH-1234
Fixes #1234
Refs #1234
```

- `Fixes` closes the issue when merged
- `Refs` links without closing


### Feature with scope

```
feat(alerts): Add Slack thread replies for alert updates

When an alert is updated or resolved, post a reply to the original
Slack thread instead of creating a new message. This keeps related
notifications grouped together.

Refs GH-1234
```

### Refactor

```
ref: Extract common validation logic to shared module

Move duplicate validation code from three endpoints into a shared
validator class. No behavior change.
```

### Breaking change

```
feat(api)!: Remove deprecated v1 endpoints

Remove all v1 API endpoints that were deprecated in version 2.0.
Clients should migrate to v2 endpoints.

BREAKING CHANGE: v1 endpoints no longer available
Fixes #9999
```

## Revert Format

```
revert: feat(api): Add new endpoint

This reverts commit abc123def456.

Reason: Caused performance regression in production.
```

## Principles

- Each commit should be a single, stable change
- Commits should be independently reviewable
- The repository should be in a working state after each commit

## References

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Angular Reference for Types](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#type)

