#!/usr/bin/env python3
"""Create a git worktree for a new or existing branch.

Usage:
    python scripts/create_worktree.py PATH SLUG [BASE_BRANCH]

Arguments:
    PATH         Destination path for the worktree.
    SLUG         Branch name to create or reuse.
    BASE_BRANCH  Optional base branch for a new branch. Defaults to the repo's
                 configured default branch, or the current branch if no default
                 remote HEAD is configured.

Examples:
    python scripts/create_worktree.py .worktrees/my-feature my-feature
    python scripts/create_worktree.py ../wt/my-feature my-feature develop

Behavior:
    - Must be run from inside a git repository.
    - Fetches origin before checking whether the base branch exists.
    - If ``SLUG`` already exists as a local branch, the script reuses it.
    - Otherwise it creates ``SLUG`` from ``BASE_BRANCH``.
    - When ``BASE_BRANCH`` is omitted, the script uses the repository default
      branch and falls back to the current branch.
    - If PATH is inside the repo, adds its top-level directory to .gitignore.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


def run_git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        text=True,
        capture_output=True,
    )


def ensure_repo() -> Path:
    result = run_git("rev-parse", "--show-toplevel")
    if result.returncode != 0:
        print("error: current directory is not inside a git repository", file=sys.stderr)
        raise SystemExit(1)
    return Path(result.stdout.strip())


def branch_exists(branch: str) -> bool:
    result = run_git("show-ref", "--verify", "--quiet", f"refs/heads/{branch}")
    return result.returncode == 0


def ref_exists(ref: str) -> bool:
    result = run_git("rev-parse", "--verify", "--quiet", ref)
    return result.returncode == 0


def fetch_origin() -> None:
    _ = run_git("fetch", "origin", "--quiet")


def update_gitignore(repo_root: Path, worktree_path: Path) -> None:
    try:
        rel = worktree_path.relative_to(repo_root)
    except ValueError:
        return  # worktree is outside repo root, nothing to ignore
    top_dir = rel.parts[0]
    pattern = f"{top_dir}/"
    gitignore = repo_root / ".gitignore"
    existing = gitignore.read_text() if gitignore.exists() else ""
    if pattern in existing:
        return
    with gitignore.open("a") as f:
        f.write(f"\n# git worktrees\n{pattern}\n")


def default_base_branch() -> str:
    result = run_git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    if result.returncode == 0:
        return result.stdout.strip().removeprefix("origin/")

    result = run_git("branch", "--show-current")
    branch = result.stdout.strip()
    if branch:
        return branch

    print("error: could not determine a default base branch", file=sys.stderr)
    raise SystemExit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a git worktree at PATH for SLUG from an optional base branch."
    )
    parser.add_argument("path", help="Destination path for the worktree")
    parser.add_argument("slug", help="Branch name to create or reuse")
    parser.add_argument(
        "base_branch",
        nargs="?",
        default=None,
        help="Base branch to create the new branch from (default: repo default branch)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = ensure_repo()

    worktree_path = Path(args.path).expanduser().resolve()
    slug = args.slug.strip()

    if not slug:
        print("error: slug cannot be empty", file=sys.stderr)
        return 1

    if not re.fullmatch(r"[A-Za-z0-9._/-]+", slug):
        print("error: slug contains invalid characters", file=sys.stderr)
        return 1

    if worktree_path.exists():
        print(f"error: worktree path already exists: {worktree_path}", file=sys.stderr)
        return 1

    update_gitignore(repo_root, worktree_path)
    fetch_origin()

    base_branch = args.base_branch.strip() if args.base_branch else default_base_branch()

    if branch_exists(slug):
        cmd = ["git", "worktree", "add", str(worktree_path), slug]
    else:
        if not ref_exists(base_branch):
            print(f"error: base branch does not exist: {base_branch}", file=sys.stderr)
            return 1
        cmd = ["git", "worktree", "add", "-b", slug, str(worktree_path), base_branch]

    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        print(result.stderr.strip() or "error: git worktree add failed", file=sys.stderr)
        return result.returncode

    print(worktree_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
