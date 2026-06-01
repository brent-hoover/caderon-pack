---
name: git-worktrees
description: Create, list, and remove git worktrees in a consistent, repeatable way. Use when the user asks to work on a branch in an isolated worktree, set up parallel work, spin up a worktree for an agent/PR, or clean up worktrees. Worktrees ALWAYS live in `.worktrees/` at the repository root (git ignored).
---

# Git Worktrees

Manage git worktrees deterministically so every agent and every session does the
exact same thing. Do not improvise locations or naming — follow the rules below.

## Assumptions

- The repository has a **non-bare main working tree**. The bare-repo + worktrees
  layout is not supported by this skill (there is no main working tree to anchor
  `.worktrees/` to); the resolve step below detects it and bails loudly.
- Commands assume a recent `git` (2.7+) and `bash`.

## Hard Rules

1. **Location is fixed.** Every worktree lives at `<repo-root>/.worktrees/<name>`.
   Never put a worktree anywhere else (no sibling dirs, no `/tmp`, no home dir).
2. **`<repo-root>` is the MAIN working tree's top level**, even when the command is
   run from inside another worktree (or a submodule). Resolve it explicitly (see
   below) — never assume the current directory is the root, and never use
   `--show-toplevel`.
3. **`.worktrees/` must be gitignored.** Ensure it is before creating the first
   worktree; add it if missing.
4. **Directory name is derived from the branch**, with `/` replaced by `-`
   (e.g. branch `feat/login` → `.worktrees/feat-login`). Keep the layout flat and
   predictable.
5. **Never create a worktree for a branch that is already checked out** in another
   worktree — git will refuse, and that's correct. List first if unsure.

## Resolve the Repository Root

Always compute the main working tree root first. The **first** entry of
`git worktree list --porcelain` is always the MAIN working tree, regardless of
whether you're in the main tree, a linked worktree, a submodule, or a
`--separate-git-dir` layout. Do **not** use `--show-toplevel` (returns the *current*
worktree's root) or `dirname` of the git dir (wrong for submodules/separate-git-dir,
where the git dir lives under `.git/modules/...`).

```bash
# First "worktree" line = the MAIN working tree, regardless of where we are.
repo_root=$(git worktree list --porcelain | sed -n '1s/^worktree //p')

# Refuse bare-repo layouts: a bare main worktree is annotated "bare" on line 2.
if git worktree list --porcelain | sed -n '2p' | grep -q '^bare'; then
  echo "Bare repository detected; this skill requires a non-bare main working tree." >&2
  exit 1
fi
```

All paths below are relative to `$repo_root`, but are always passed to git as the
absolute `"$repo_root/$dir"`.

## Ensure `.worktrees/` Is Ignored (run once)

This edits the project `.gitignore`, which dirties a tracked file — **report the
edit** to the user rather than making it silently.

```bash
# Substring match (no -x): also catches existing `.worktrees`, `.worktrees/**`, etc.
grep -qF '.worktrees' "$repo_root/.gitignore" 2>/dev/null \
  || printf '\n# git worktrees (managed locally)\n.worktrees/\n' >> "$repo_root/.gitignore"
```

If the project uses a non-standard ignore file (e.g. a global excludes file or
`info/exclude`), prefer matching the existing convention, but the project
`.gitignore` is the default.

## Create a Worktree

### From a new branch (most common)

Use this when starting fresh work. Branch off an up-to-date base. Works with or
without an `origin` remote (purely local repos fall back to a local base ref).

```bash
branch="feat/login"                 # provided by the user / task
dir=".worktrees/${branch//\//-}"

if git remote get-url origin >/dev/null 2>&1; then
  base="${1:-$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')}"
  base="${base:-main}"
  git fetch origin "$base" --quiet || true
  start="origin/$base"
else
  # No remote: base off a local ref (named base, else main, else current HEAD).
  base="${1:-main}"
  git rev-parse --verify --quiet "$base" >/dev/null || base=$(git symbolic-ref --short HEAD)
  start="$base"
fi

git worktree add -b "$branch" "$repo_root/$dir" "$start"
```

### From an existing branch

```bash
branch="feat/login"
dir=".worktrees/${branch//\//-}"
git fetch origin "$branch" --quiet 2>/dev/null || true
git worktree add "$repo_root/$dir" "$branch"
```

### After creating

- Report the absolute path of the new worktree to the user.
- Do **not** auto-run installs, copy env files, or open an editor unless the user
  asked or the project clearly expects it. If you do project setup, state exactly
  what you ran.
- When doing work for the user, `cd` into the worktree and operate there; leave the
  main working tree untouched.

## List Worktrees

```bash
git worktree list
```

Use this before creating or removing to avoid duplicate-branch errors and to find
the right path.

## Remove a Worktree

Removal is two parts: drop the worktree, then (optionally) delete the branch.

```bash
branch="feat/login"
dir=".worktrees/${branch//\//-}"

# Refuse to discard uncommitted work: do NOT use --force unless the user confirms.
git worktree remove "$repo_root/$dir"

# Optional: delete the branch once merged (use -d, which is safe; -D only on request).
git branch -d "$branch"
```

If `git worktree remove` reports the worktree is dirty or locked, stop and ask the
user before forcing. Only use `git worktree remove --force` / `git branch -D` when
the user explicitly accepts losing the changes.

## Prune Stale Entries

After manually deleting a worktree directory, or when git complains about stale
metadata:

```bash
git worktree prune
git worktree list   # verify
```

## Quick Reference

All paths assume `$repo_root` has been resolved as above and is passed absolutely.

| Goal | Command |
|------|---------|
| Find main repo root | `git worktree list --porcelain \| sed -n '1s/^worktree //p'` |
| List worktrees | `git worktree list` |
| New branch + worktree | `git worktree add -b <branch> "$repo_root/.worktrees/<name>" <start>` |
| Existing branch worktree | `git worktree add "$repo_root/.worktrees/<name>" <branch>` |
| Remove worktree | `git worktree remove "$repo_root/.worktrees/<name>"` |
| Delete merged branch | `git branch -d <branch>` |
| Clean stale metadata | `git worktree prune` |

## Anti-Patterns (do not do these)

- Creating worktrees outside `.worktrees/`.
- Computing the root via `--show-toplevel`, `dirname` of the git dir, or "current
  directory" while inside a worktree or submodule.
- Forcing removal of a dirty worktree without explicit user confirmation.
- Committing the `.worktrees/` directory (it must stay ignored).
- Editing `.gitignore` without telling the user.