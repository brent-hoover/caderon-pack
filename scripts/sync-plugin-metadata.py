#!/usr/bin/env python3
"""Bidirectionally sync Claude and Codex plugin metadata.

The shared skill source stays in plugins/<plugin>/skills/. This script only syncs
metadata that exists in both plugin formats, plus marketplace plugin entries.
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


COMMON_PLUGIN_FIELDS = (
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
)
DEFAULT_INSTALL_POLICY = "AVAILABLE"
DEFAULT_AUTH_POLICY = "ON_INSTALL"
CLAUDE_SCHEMA = "https://anthropic.com/claude-code/marketplace.schema.json"
MISSING = object()

CANONICAL_TO_CODEX_CATEGORY = {
    "workflow": "Productivity",
    "development": "Development",
    "devops": "DevOps",
}
CODEX_CATEGORY_TO_CANONICAL = {
    "productivity": "workflow",
    "development": "development",
    "devops": "devops",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-ref",
        default="HEAD",
        help="Git ref used to detect which side changed. Defaults to HEAD.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail if sync would change files instead of writing them.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def read_base_json(base_ref: str, path: Path) -> dict[str, Any] | None:
    result = subprocess.run(
        ["git", "show", f"{base_ref}:{path.as_posix()}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def get_field(payload: dict[str, Any] | None, field: str) -> Any:
    if payload is None:
        return MISSING
    value = payload.get(field, MISSING)
    if value is MISSING:
        return MISSING
    return copy.deepcopy(value)


def format_value(value: Any) -> str:
    if value is MISSING:
        return "<missing>"
    return json.dumps(value, sort_keys=True)


def resolve_value(
    *,
    label: str,
    left_name: str,
    right_name: str,
    left_value: Any,
    right_value: Any,
    base_left_value: Any,
    base_right_value: Any,
    conflicts: list[str],
) -> Any:
    if left_value == right_value:
        return left_value

    left_changed = left_value != base_left_value
    right_changed = right_value != base_right_value
    if left_value is MISSING and right_value is not MISSING:
        if left_changed and right_changed:
            conflicts.append(
                f"{label}: {left_name} deleted while {right_name} changed "
                f"({format_value(base_left_value)} -> <missing>, "
                f"{format_value(base_right_value)} -> {format_value(right_value)})"
            )
            return copy.deepcopy(right_value)
        if left_changed:
            return MISSING
        return copy.deepcopy(right_value)
    if right_value is MISSING and left_value is not MISSING:
        if left_changed and right_changed:
            conflicts.append(
                f"{label}: {right_name} deleted while {left_name} changed "
                f"({format_value(base_right_value)} -> <missing>, "
                f"{format_value(base_left_value)} -> {format_value(left_value)})"
            )
            return copy.deepcopy(left_value)
        if right_changed:
            return MISSING
        return copy.deepcopy(left_value)
    if left_changed and right_changed:
        conflicts.append(
            f"{label}: both {left_name} and {right_name} changed differently "
            f"({format_value(left_value)} != {format_value(right_value)})"
        )
        return copy.deepcopy(left_value)
    if left_changed:
        return copy.deepcopy(left_value)
    if right_changed:
        return copy.deepcopy(right_value)

    conflicts.append(
        f"{label}: existing {left_name}/{right_name} drift is ambiguous "
        f"({format_value(left_value)} != {format_value(right_value)})"
    )
    return copy.deepcopy(left_value)


def display_name(name: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[-_]+", name) if part)


def default_interface(plugin: dict[str, Any], plugin_name: str) -> dict[str, Any]:
    title = display_name(str(plugin.get("name") or plugin_name))
    description = str(plugin.get("description") or f"{title} plugin")
    return {
        "displayName": title,
        "shortDescription": description[:96],
        "longDescription": description,
        "developerName": plugin.get("author", {}).get("name", "Brent Hoover")
        if isinstance(plugin.get("author"), dict)
        else "Brent Hoover",
        "category": display_codex_category("workflow"),
        "capabilities": ["Interactive", "Write"],
        "defaultPrompt": [f"Help me use {title}."],
    }


def ensure_codex_interface(plugin: dict[str, Any], plugin_name: str) -> None:
    defaults = default_interface(plugin, plugin_name)
    interface = plugin.get("interface")
    if not isinstance(interface, dict):
        interface = {}
    for key, value in defaults.items():
        interface.setdefault(key, value)
    plugin["interface"] = interface


def plugin_names(
    repo: Path,
    claude_market: dict[str, Any] | None,
    codex_market: dict[str, Any] | None,
) -> set[str]:
    names: set[str] = set()
    plugins_dir = repo / "plugins"
    if plugins_dir.is_dir():
        for child in plugins_dir.iterdir():
            if child.is_dir() and (
                (child / ".claude-plugin" / "plugin.json").is_file()
                or (child / ".codex-plugin" / "plugin.json").is_file()
            ):
                names.add(child.name)
    for market in (claude_market, codex_market):
        if not isinstance(market, dict):
            continue
        for entry in market.get("plugins", []):
            if isinstance(entry, dict) and isinstance(entry.get("name"), str):
                names.add(entry["name"])
    return names


def sync_plugin_manifest(
    *,
    repo: Path,
    plugin_name: str,
    base_ref: str,
    conflicts: list[str],
) -> dict[Path, dict[str, Any]] | None:
    claude_path = repo / "plugins" / plugin_name / ".claude-plugin" / "plugin.json"
    codex_path = repo / "plugins" / plugin_name / ".codex-plugin" / "plugin.json"
    claude_current = read_json(claude_path)
    codex_current = read_json(codex_path)
    if claude_current is None and codex_current is None:
        return None

    claude_base = read_base_json(base_ref, claude_path.relative_to(repo))
    codex_base = read_base_json(base_ref, codex_path.relative_to(repo))

    claude_out = copy.deepcopy(claude_current or {})
    codex_out = copy.deepcopy(codex_current or {})

    for field in COMMON_PLUGIN_FIELDS:
        value = resolve_value(
            label=f"plugins/{plugin_name} field `{field}`",
            left_name="Claude",
            right_name="Codex",
            left_value=get_field(claude_current, field),
            right_value=get_field(codex_current, field),
            base_left_value=get_field(claude_base, field),
            base_right_value=get_field(codex_base, field),
            conflicts=conflicts,
        )
        if value is not MISSING:
            claude_out[field] = copy.deepcopy(value)
            codex_out[field] = copy.deepcopy(value)
        else:
            claude_out.pop(field, None)
            codex_out.pop(field, None)

    claude_out.setdefault("name", plugin_name)
    codex_out.setdefault("name", plugin_name)
    codex_out.setdefault("skills", "./skills/")
    ensure_codex_interface(codex_out, plugin_name)

    desired: dict[Path, dict[str, Any]] = {
        claude_path: claude_out,
        codex_path: codex_out,
    }
    return desired


def normalize_source_path(value: Any) -> Any:
    if value is MISSING or value is None:
        return MISSING
    if isinstance(value, dict):
        value = value.get("path", MISSING)
    if not isinstance(value, str) or not value.strip():
        return MISSING
    path = value.strip().rstrip("/")
    if not path.startswith("./"):
        path = f"./{path}"
    return path


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "productivity"


def canonical_claude_category(value: Any) -> Any:
    if value is MISSING or value is None:
        return MISSING
    if not isinstance(value, str) or not value.strip():
        return MISSING
    slug = slugify(value)
    return CODEX_CATEGORY_TO_CANONICAL.get(slug, slug)


def canonical_codex_category(value: Any) -> Any:
    if value is MISSING or value is None:
        return MISSING
    if not isinstance(value, str) or not value.strip():
        return MISSING
    slug = slugify(value)
    return CODEX_CATEGORY_TO_CANONICAL.get(slug, slug)


def display_codex_category(category: str) -> str:
    return CANONICAL_TO_CODEX_CATEGORY.get(
        category,
        " ".join(part.capitalize() for part in category.split("-")),
    )


def marketplace_entries(market: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    if not isinstance(market, dict):
        return entries
    for entry in market.get("plugins", []):
        if isinstance(entry, dict) and isinstance(entry.get("name"), str):
            entries[entry["name"]] = entry
    return entries


def marketplace_order(market: dict[str, Any] | None, present_names: set[str]) -> list[str]:
    if not isinstance(market, dict):
        return []
    order: list[str] = []
    for entry in market.get("plugins", []):
        if isinstance(entry, dict) and entry.get("name") in present_names:
            order.append(entry["name"])
    return order


def resolve_presence(
    *,
    name: str,
    left_present: bool,
    right_present: bool,
    base_left_present: bool,
    base_right_present: bool,
    conflicts: list[str],
) -> bool:
    if left_present == right_present:
        return left_present
    left_changed = left_present != base_left_present
    right_changed = right_present != base_right_present
    if left_changed and right_changed:
        conflicts.append(f"marketplace plugin `{name}`: added/removed differently on both sides")
        return left_present
    if left_changed:
        return left_present
    if right_changed:
        return right_present
    conflicts.append(f"marketplace plugin `{name}`: existing presence drift is ambiguous")
    return left_present


def resolve_order(
    *,
    left_order: list[str],
    right_order: list[str],
    base_left_order: list[str],
    base_right_order: list[str],
    present_names: set[str],
    conflicts: list[str],
) -> list[str]:
    if left_order == right_order:
        order = left_order
    elif not right_order:
        order = left_order
    elif not left_order:
        order = right_order
    else:
        left_changed = left_order != base_left_order
        right_changed = right_order != base_right_order
        if left_changed and right_changed:
            conflicts.append(
                "marketplace plugin order: both Claude and Codex changed differently "
                f"({left_order} != {right_order})"
            )
            order = left_order
        elif left_changed:
            order = left_order
        elif right_changed:
            order = right_order
        else:
            conflicts.append(
                "marketplace plugin order: existing Claude/Codex order drift is ambiguous"
            )
            order = left_order

    ordered = [name for name in order if name in present_names]
    for name in sorted(present_names):
        if name not in ordered:
            ordered.append(name)
    return ordered


def default_claude_marketplace(codex_market: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "$schema": CLAUDE_SCHEMA,
        "name": (codex_market or {}).get("name", "caderon-pack"),
        "version": "1.0.0",
        "description": "Personal plugin marketplace for Brent's workflow",
        "owner": {
            "name": "Brent Hoover",
            "email": "brent@thebuddhalodge.com",
        },
        "plugins": [],
    }


def default_codex_marketplace(claude_market: dict[str, Any] | None) -> dict[str, Any]:
    name = (claude_market or {}).get("name", "caderon-pack")
    return {
        "name": name,
        "interface": {
            "displayName": display_name(name),
        },
        "plugins": [],
    }


def plugin_description(plugin_manifests: dict[str, dict[str, Any]], name: str) -> str:
    description = plugin_manifests.get(name, {}).get("description")
    if isinstance(description, str) and description.strip():
        return description
    return f"{display_name(name)} plugin"


def sync_marketplaces(
    *,
    repo: Path,
    base_ref: str,
    plugin_manifests: dict[str, dict[str, Any]],
    conflicts: list[str],
) -> dict[Path, dict[str, Any]]:
    claude_path = repo / ".claude-plugin" / "marketplace.json"
    codex_path = repo / ".agents" / "plugins" / "marketplace.json"

    claude_current = read_json(claude_path)
    codex_current = read_json(codex_path)
    claude_base = read_base_json(base_ref, claude_path.relative_to(repo))
    codex_base = read_base_json(base_ref, codex_path.relative_to(repo))

    claude_out = copy.deepcopy(claude_current or default_claude_marketplace(codex_current))
    codex_out = copy.deepcopy(codex_current or default_codex_marketplace(claude_current))

    marketplace_name = resolve_value(
        label="marketplace field `name`",
        left_name="Claude",
        right_name="Codex",
        left_value=get_field(claude_current, "name"),
        right_value=get_field(codex_current, "name"),
        base_left_value=get_field(claude_base, "name"),
        base_right_value=get_field(codex_base, "name"),
        conflicts=conflicts,
    )
    if marketplace_name is not MISSING:
        claude_out["name"] = marketplace_name
        codex_out["name"] = marketplace_name

    if not isinstance(codex_out.get("interface"), dict):
        codex_out["interface"] = {
            "displayName": display_name(str(codex_out.get("name", "caderon-pack")))
        }
    codex_out["interface"].setdefault(
        "displayName",
        display_name(str(codex_out.get("name", "caderon-pack"))),
    )

    claude_entries = marketplace_entries(claude_current)
    codex_entries = marketplace_entries(codex_current)
    base_claude_entries = marketplace_entries(claude_base)
    base_codex_entries = marketplace_entries(codex_base)
    all_entry_names = (
        set(claude_entries)
        | set(codex_entries)
        | set(base_claude_entries)
        | set(base_codex_entries)
    )

    present_names: set[str] = set()
    for name in all_entry_names:
        if resolve_presence(
            name=name,
            left_present=name in claude_entries,
            right_present=name in codex_entries,
            base_left_present=name in base_claude_entries,
            base_right_present=name in base_codex_entries,
            conflicts=conflicts,
        ):
            present_names.add(name)

    order = resolve_order(
        left_order=marketplace_order(claude_current, present_names),
        right_order=marketplace_order(codex_current, present_names),
        base_left_order=marketplace_order(claude_base, present_names),
        base_right_order=marketplace_order(codex_base, present_names),
        present_names=present_names,
        conflicts=conflicts,
    )

    claude_plugins: list[dict[str, Any]] = []
    codex_plugins: list[dict[str, Any]] = []
    for name in order:
        claude_entry = copy.deepcopy(claude_entries.get(name, {"name": name}))
        codex_entry = copy.deepcopy(codex_entries.get(name, {"name": name}))
        base_claude_entry = base_claude_entries.get(name)
        base_codex_entry = base_codex_entries.get(name)

        source_path = resolve_value(
            label=f"marketplace plugin `{name}` source",
            left_name="Claude",
            right_name="Codex",
            left_value=normalize_source_path(claude_entry.get("source", MISSING)),
            right_value=normalize_source_path(codex_entry.get("source", MISSING)),
            base_left_value=normalize_source_path(
                base_claude_entry.get("source", MISSING) if base_claude_entry else MISSING
            ),
            base_right_value=normalize_source_path(
                base_codex_entry.get("source", MISSING) if base_codex_entry else MISSING
            ),
            conflicts=conflicts,
        )
        if source_path is MISSING:
            source_path = f"./plugins/{name}"

        category = resolve_value(
            label=f"marketplace plugin `{name}` category",
            left_name="Claude",
            right_name="Codex",
            left_value=canonical_claude_category(claude_entry.get("category", MISSING)),
            right_value=canonical_codex_category(codex_entry.get("category", MISSING)),
            base_left_value=canonical_claude_category(
                base_claude_entry.get("category", MISSING) if base_claude_entry else MISSING
            ),
            base_right_value=canonical_codex_category(
                base_codex_entry.get("category", MISSING) if base_codex_entry else MISSING
            ),
            conflicts=conflicts,
        )
        if category is MISSING:
            category = "workflow"

        claude_entry["name"] = name
        claude_entry.setdefault("description", plugin_description(plugin_manifests, name))
        claude_entry["source"] = source_path
        claude_entry["category"] = category
        claude_plugins.append(claude_entry)

        codex_entry["name"] = name
        source = codex_entry.get("source")
        if not isinstance(source, dict):
            source = {}
        source["source"] = source.get("source", "local")
        source["path"] = source_path
        codex_entry["source"] = source
        policy = codex_entry.get("policy")
        if not isinstance(policy, dict):
            policy = {}
        policy.setdefault("installation", DEFAULT_INSTALL_POLICY)
        policy.setdefault("authentication", DEFAULT_AUTH_POLICY)
        codex_entry["policy"] = policy
        codex_entry["category"] = display_codex_category(category)
        codex_plugins.append(codex_entry)

    claude_out["plugins"] = claude_plugins
    codex_out["plugins"] = codex_plugins
    return {
        claude_path: claude_out,
        codex_path: codex_out,
    }


def sync_all(repo: Path, base_ref: str) -> tuple[dict[Path, dict[str, Any]], list[str]]:
    conflicts: list[str] = []
    claude_market = read_json(repo / ".claude-plugin" / "marketplace.json")
    codex_market = read_json(repo / ".agents" / "plugins" / "marketplace.json")
    desired: dict[Path, dict[str, Any]] = {}
    manifests: dict[str, dict[str, Any]] = {}

    for name in sorted(plugin_names(repo, claude_market, codex_market)):
        synced = sync_plugin_manifest(
            repo=repo,
            plugin_name=name,
            base_ref=base_ref,
            conflicts=conflicts,
        )
        if synced is None:
            continue
        desired.update(synced)
        manifests[name] = desired[repo / "plugins" / name / ".claude-plugin" / "plugin.json"]

    desired.update(
        sync_marketplaces(
            repo=repo,
            base_ref=base_ref,
            plugin_manifests=manifests,
            conflicts=conflicts,
        )
    )
    return desired, conflicts


def validate_plugin_manifests(repo: Path, desired: dict[Path, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for path, payload in desired.items():
        if path.parts[-2:] != (".codex-plugin", "plugin.json"):
            continue
        for field in ("name", "version", "description", "author", "skills", "interface"):
            if field not in payload:
                errors.append(f"{path.relative_to(repo)} missing `{field}`")
        interface = payload.get("interface")
        if not isinstance(interface, dict):
            errors.append(f"{path.relative_to(repo)} field `interface` must be an object")
        else:
            for field in (
                "displayName",
                "shortDescription",
                "longDescription",
                "developerName",
                "category",
            ):
                if not isinstance(interface.get(field), str) or not interface[field].strip():
                    errors.append(f"{path.relative_to(repo)} missing `interface.{field}`")
            if not isinstance(interface.get("capabilities"), list):
                errors.append(f"{path.relative_to(repo)} field `interface.capabilities` must be an array")
            if "defaultPrompt" not in interface and "default_prompt" not in interface:
                errors.append(f"{path.relative_to(repo)} missing `interface.defaultPrompt`")
    return errors


def validate_skills(repo: Path) -> list[str]:
    errors: list[str] = []
    plugins_dir = repo / "plugins"
    if not plugins_dir.is_dir():
        return errors
    for skill in sorted(plugins_dir.glob("*/skills/*/SKILL.md")):
        contents = skill.read_text(encoding="utf-8")
        rel = skill.relative_to(repo)
        if not contents.startswith("---\n"):
            errors.append(f"{rel} must start with YAML frontmatter")
            continue
        if contents.find("\n---", 4) == -1:
            errors.append(f"{rel} frontmatter is not closed")
    return errors


def main() -> int:
    args = parse_args()
    repo = Path.cwd()
    desired, conflicts = sync_all(repo, args.base_ref)
    errors = conflicts + validate_plugin_manifests(repo, desired) + validate_skills(repo)
    if errors:
        print("Plugin metadata sync failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    changed_paths = [
        path for path, payload in desired.items() if read_json(path) != payload
    ]
    if args.check:
        if changed_paths:
            print("Plugin metadata is out of sync:")
            for path in sorted(changed_paths):
                print(f"- {path.relative_to(repo)}")
            return 1
        print("Plugin metadata is in sync.")
        return 0

    for path in sorted(changed_paths):
        write_json(path, desired[path])
        print(f"synced {path.relative_to(repo)}")
    if not changed_paths:
        print("Plugin metadata is already in sync.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
