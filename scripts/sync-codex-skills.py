#!/usr/bin/env python3
"""Sync caderon-pack plugin skills into Codex's skills directory.

Codex and Claude Code share the same Agent Skills format (SKILL.md), but Codex does
not read Claude Code's plugin marketplace. This copies the skills from whichever
caderon-pack plugins Claude has *enabled on this machine* into ~/.codex/skills/, so
Codex stays in sync with the machine profile (e.g. devops only on work machines).

Source of truth is the installed Claude plugin cache, so no repo clone is needed and
the newest installed version of each plugin is used.

Idempotent. Only manages skills it installed (marked with a .caderon-synced file);
it never touches roborev's skills or any hand-made Codex skills. Re-running removes
caderon skills that are no longer enabled/present, then re-copies the current set.

Usage: ./scripts/sync-codex-skills.py [--dry-run]
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

MARKETPLACE = "caderon-pack"
MARKER = ".caderon-synced"

HOME = Path.home()
SETTINGS = HOME / ".claude" / "settings.json"
CACHE = HOME / ".claude" / "plugins" / "cache" / MARKETPLACE
CODEX_SKILLS = HOME / ".codex" / "skills"


def enabled_plugins() -> list[str]:
    """Names of caderon-pack plugins enabled in Claude settings on this machine."""
    settings = json.loads(SETTINGS.read_text())
    enabled = settings.get("enabledPlugins", {})
    names = []
    for key, on in enabled.items():
        if on and key.endswith(f"@{MARKETPLACE}"):
            names.append(key.removesuffix(f"@{MARKETPLACE}"))
    return names


def latest_version_dir(plugin: str) -> Path | None:
    """Newest installed version dir for a plugin, or None if not installed."""
    plugin_dir = CACHE / plugin
    if not plugin_dir.is_dir():
        return None
    versions = [p for p in plugin_dir.iterdir() if p.is_dir()]
    if not versions:
        return None
    return max(versions, key=lambda p: tuple(int(n) for n in p.name.split(".") if n.isdigit()))


def remove_synced(dry_run: bool) -> int:
    """Remove previously caderon-synced skill dirs from the Codex skills dir."""
    removed = 0
    if not CODEX_SKILLS.is_dir():
        return 0
    for d in CODEX_SKILLS.iterdir():
        if d.is_dir() and (d / MARKER).exists():
            print(f"  - remove stale {d.name}")
            if not dry_run:
                shutil.rmtree(d)
            removed += 1
    return removed


def sync(dry_run: bool) -> int:
    copied = 0
    for plugin in enabled_plugins():
        vdir = latest_version_dir(plugin)
        if vdir is None:
            continue
        skills_dir = vdir / "skills"
        if not skills_dir.is_dir():
            continue
        for skill in sorted(p for p in skills_dir.iterdir() if p.is_dir()):
            dest = CODEX_SKILLS / skill.name
            print(f"  + {skill.name}  ({plugin}@{vdir.name})")
            if not dry_run:
                shutil.copytree(skill, dest)
                (dest / MARKER).write_text(f"{plugin}@{vdir.name}\n")
            copied += 1
    return copied


def main() -> int:
    dry_run = "--dry-run" in sys.argv[1:]

    if not SETTINGS.exists():
        sys.exit(f"error: {SETTINGS} not found — is Claude Code set up on this machine?")
    if not (HOME / ".codex").is_dir():
        sys.exit("error: ~/.codex not found — Codex is not set up on this machine.")

    if not dry_run:
        CODEX_SKILLS.mkdir(parents=True, exist_ok=True)

    print(f"Syncing caderon-pack skills → {CODEX_SKILLS}" + (" (dry-run)" if dry_run else ""))
    remove_synced(dry_run)
    n = sync(dry_run)
    print(f"Done: {n} skill(s) synced from enabled plugins: {', '.join(enabled_plugins()) or '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
