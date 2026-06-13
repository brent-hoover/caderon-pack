---
description: Create a git worktree for a feature branch at .worktrees/<slug>.
argument-hint: <slug>
model: claude-sonnet-4-6
---

# worktree

`$ARGUMENTS` is the slug (kebab-case, e.g. `user-auth`). If empty, ask for it.

## Steps

1. **Validate the slug.** Must be non-empty, kebab-case, no slashes. If it doesn't look right,
   tell the user and stop.

2. **Create the worktree.**

```bash
repo_root=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
grep -qF '.worktrees' "$repo_root/.gitignore" 2>/dev/null \
  || printf '\n# git worktrees\n.worktrees/\n' >> "$repo_root/.gitignore"
base=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
base="${base:-main}"
git fetch origin "$base" --quiet || true
git worktree add -b "feat/<slug>" "$repo_root/.worktrees/feat-<slug>" "origin/$base"
```

3. **Verify.**

```bash
ls "$repo_root/.worktrees/feat-<slug>"
```

If this fails, report the error and stop.

4. **Report.** One line: the absolute worktree path and the branch name. Done.
