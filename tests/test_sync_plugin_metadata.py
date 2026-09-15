from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync-plugin-metadata.py"


def run(command: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, check=False, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise AssertionError(
            f"{command} failed with {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class SyncPluginMetadataTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="sync-plugin-metadata-test-"))
        shutil.copy2(SYNC_SCRIPT, self.tmp / "sync-plugin-metadata.py")
        run(["git", "init", "-q"], self.tmp)
        run(["git", "config", "user.email", "test@example.com"], self.tmp)
        run(["git", "config", "user.name", "Test"], self.tmp)
        run(["git", "config", "commit.gpgsign", "false"], self.tmp)
        self.write_base_repo()
        run(["git", "add", "."], self.tmp)
        run(["git", "commit", "-q", "-m", "base"], self.tmp)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp)

    def write_base_repo(self) -> None:
        write_json(
            self.tmp / ".claude-plugin" / "marketplace.json",
            {
                "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
                "name": "caderon-pack",
                "version": "1.0.0",
                "description": "Personal plugin marketplace",
                "owner": {"name": "Brent Hoover"},
                "plugins": [
                    {
                        "name": "go",
                        "description": "Go plugin",
                        "source": "./plugins/go",
                        "category": "development",
                    }
                ],
            },
        )
        write_json(
            self.tmp / ".agents" / "plugins" / "marketplace.json",
            {
                "name": "caderon-pack",
                "interface": {"displayName": "Caderon Pack"},
                "plugins": [
                    {
                        "name": "go",
                        "source": {"source": "local", "path": "./plugins/go"},
                        "policy": {
                            "installation": "AVAILABLE",
                            "authentication": "ON_INSTALL",
                        },
                        "category": "Development",
                    }
                ],
            },
        )
        common = {
            "name": "go",
            "version": "1.0.0",
            "description": "Go development skills",
            "author": {"name": "Brent Hoover"},
            "homepage": "https://github.com/brent-hoover/caderon-pack",
            "repository": "https://github.com/brent-hoover/caderon-pack",
            "license": "MIT",
            "keywords": ["go"],
        }
        write_json(self.tmp / "plugins" / "go" / ".claude-plugin" / "plugin.json", common)
        codex = {
            **common,
            "skills": "./skills/",
            "interface": {
                "displayName": "Go",
                "shortDescription": "Go skills.",
                "longDescription": "Go skills.",
                "developerName": "Brent Hoover",
                "category": "Development",
                "capabilities": ["Interactive", "Write"],
                "defaultPrompt": ["Help me with Go."],
            },
        }
        write_json(self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json", codex)
        skill = self.tmp / "plugins" / "go" / "skills" / "go-backend-workflow" / "SKILL.md"
        skill.parent.mkdir(parents=True, exist_ok=True)
        skill.write_text(
            "---\nname: go-backend-workflow\ndescription: Go workflow.\n---\n",
            encoding="utf-8",
        )

    def sync(self) -> subprocess.CompletedProcess[str]:
        return run([sys.executable, "sync-plugin-metadata.py", "--base-ref", "HEAD"], self.tmp)

    def test_shared_field_deletion_on_claude_side_removes_codex_field(self) -> None:
        claude_path = self.tmp / "plugins" / "go" / ".claude-plugin" / "plugin.json"
        claude = read_json(claude_path)
        del claude["keywords"]
        write_json(claude_path, claude)

        self.sync()

        self.assertNotIn("keywords", read_json(claude_path))
        self.assertNotIn(
            "keywords",
            read_json(self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json"),
        )

    def test_shared_field_deletion_on_codex_side_removes_claude_field(self) -> None:
        codex_path = self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json"
        codex = read_json(codex_path)
        del codex["keywords"]
        write_json(codex_path, codex)

        self.sync()

        self.assertNotIn("keywords", read_json(codex_path))
        self.assertNotIn(
            "keywords",
            read_json(self.tmp / "plugins" / "go" / ".claude-plugin" / "plugin.json"),
        )

    def test_generated_short_description_does_not_split_a_word(self) -> None:
        # Truncating this at 96 characters lands inside "techniques".
        long_description = (
            "Core skills library for Claude Code: TDD, debugging, collaboration "
            "patterns, and proven techniques"
        )
        self.add_plugin_without_codex_manifest("superpowers", long_description)

        self.sync()

        interface = read_json(
            self.tmp / "plugins" / "superpowers" / ".codex-plugin" / "plugin.json"
        )["interface"]
        short = interface["shortDescription"]
        self.assertLessEqual(len(short), 96)
        self.assertTrue(
            long_description.startswith(short),
            f"{short!r} is not a prefix of the full description",
        )
        self.assertFalse(
            long_description[len(short)].isalnum(),
            f"{short!r} ends mid-word",
        )
        self.assertNotIn(
            short[-1], " ,;:-–—→>/&", f"{short!r} ends on a dangling separator"
        )

    def test_word_is_kept_when_the_clip_already_lands_on_a_boundary(self) -> None:
        # Character 96 is the comma after "browsing", so no word is split and
        # "browsing" must survive.
        long_description = (
            "Read and write your Obsidian vault from Claude Code - daily notes, "
            "quick capture, vault browsing, work logs, and Raindrop digest"
        )
        self.assertEqual(",", long_description[96])
        self.add_plugin_without_codex_manifest("obsidian", long_description)

        self.sync()

        short = read_json(
            self.tmp / "plugins" / "obsidian" / ".codex-plugin" / "plugin.json"
        )["interface"]["shortDescription"]
        self.assertTrue(short.endswith("browsing"), f"{short!r} dropped a whole word")

    def test_separator_at_the_limit_keeps_the_word_before_it(self) -> None:
        # Character 95 is the hyphen, so the clip lands between words, not inside
        # one: "browsing" must survive and only the hyphen is dropped.
        long_description = (
            "Read and write your Obsidian vault from Claude Code, daily notes, "
            "quick capture, vault browsing-work logs and more"
        )
        self.assertEqual("-", long_description[95])
        self.assertTrue(long_description[96].isalnum())
        self.add_plugin_without_codex_manifest("obsidian-hyphen", long_description)

        self.sync()

        short = read_json(
            self.tmp / "plugins" / "obsidian-hyphen" / ".codex-plugin" / "plugin.json"
        )["interface"]["shortDescription"]
        self.assertTrue(short.endswith("browsing"), f"{short!r} dropped a whole word")

    def test_short_description_left_alone_when_it_already_fits(self) -> None:
        description = "Go development skills"
        self.add_plugin_without_codex_manifest("tiny", description)

        self.sync()

        interface = read_json(
            self.tmp / "plugins" / "tiny" / ".codex-plugin" / "plugin.json"
        )["interface"]
        self.assertEqual(description, interface["shortDescription"])
        self.assertEqual(description, interface["longDescription"])

    def add_plugin_without_codex_manifest(self, name: str, description: str) -> None:
        marketplace_path = self.tmp / ".claude-plugin" / "marketplace.json"
        marketplace = read_json(marketplace_path)
        marketplace["plugins"].append(
            {
                "name": name,
                "description": description,
                "source": f"./plugins/{name}",
                "category": "workflow",
            }
        )
        write_json(marketplace_path, marketplace)
        write_json(
            self.tmp / "plugins" / name / ".claude-plugin" / "plugin.json",
            {
                "name": name,
                "version": "1.0.0",
                "description": description,
                "author": {"name": "Brent Hoover"},
                "license": "MIT",
            },
        )
        skill = self.tmp / "plugins" / name / "skills" / name / "SKILL.md"
        skill.parent.mkdir(parents=True, exist_ok=True)
        skill.write_text(
            f"---\nname: {name}\ndescription: {description}\n---\n", encoding="utf-8"
        )

    def test_codex_opt_out_skips_generating_the_codex_manifest(self) -> None:
        self.add_plugin_without_codex_manifest("claude-only", "Needs the claude CLI")
        self.exclude_from_codex("claude-only", "Shells out to `claude -p`.")

        self.sync()

        self.assertFalse(
            (self.tmp / "plugins" / "claude-only" / ".codex-plugin" / "plugin.json").exists()
        )

    def test_codex_opt_out_keeps_the_plugin_in_the_claude_marketplace(self) -> None:
        self.add_plugin_without_codex_manifest("claude-only", "Needs the claude CLI")
        self.exclude_from_codex("claude-only", "Shells out to `claude -p`.")

        self.sync()

        self.assertIn("claude-only", self.marketplace_names(self.claude_marketplace))
        self.assertNotIn("claude-only", self.marketplace_names(self.codex_marketplace))

    def test_codex_opt_out_removes_a_stale_codex_manifest(self) -> None:
        # "go" ships a Codex manifest in the base repo; opting it out must clean up.
        self.exclude_from_codex("go", "Test exclusion.")

        self.sync()

        self.assertFalse(
            (self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json").exists()
        )
        self.assertIn("go", self.marketplace_names(self.claude_marketplace))
        self.assertNotIn("go", self.marketplace_names(self.codex_marketplace))

    def test_codex_opt_out_settles_and_reports_in_sync(self) -> None:
        self.exclude_from_codex("go", "Test exclusion.")

        self.sync()
        second = self.sync()
        self.assertIn("already in sync", second.stdout)

        check = run(
            [sys.executable, "sync-plugin-metadata.py", "--base-ref", "HEAD", "--check"],
            self.tmp,
            check=False,
        )
        self.assertEqual(0, check.returncode, f"--check failed:\n{check.stdout}{check.stderr}")

    def test_codex_opt_out_preserves_claude_marketplace_order(self) -> None:
        self.add_plugin_without_codex_manifest("aaa-first", "First plugin")
        self.add_plugin_without_codex_manifest("zzz-last", "Last plugin")
        self.exclude_from_codex("go", "Test exclusion.")
        before = self.marketplace_names(self.claude_marketplace)

        self.sync()

        self.assertEqual(before, self.marketplace_names(self.claude_marketplace))

    def test_removing_the_marker_republishes_to_codex(self) -> None:
        self.exclude_from_codex("go", "Temporarily excluded.")
        self.sync()
        run(["git", "add", "-A"], self.tmp)
        run(["git", "commit", "-q", "-m", "exclude go from codex"], self.tmp)
        self.assertNotIn("go", self.marketplace_names(self.codex_marketplace))

        (self.tmp / "plugins" / "go" / ".no-codex-plugin").unlink()
        self.sync()

        self.assertIn("go", self.marketplace_names(self.codex_marketplace))
        self.assertTrue(
            (self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json").exists()
        )

    @property
    def claude_marketplace(self) -> Path:
        return self.tmp / ".claude-plugin" / "marketplace.json"

    @property
    def codex_marketplace(self) -> Path:
        return self.tmp / ".agents" / "plugins" / "marketplace.json"

    def marketplace_names(self, path: Path) -> list[str]:
        return [entry["name"] for entry in read_json(path)["plugins"]]

    def exclude_from_codex(self, name: str, reason: str) -> None:
        marker = self.tmp / "plugins" / name / ".no-codex-plugin"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(reason + "\n", encoding="utf-8")

    def test_codex_skills_field_is_preserved(self) -> None:
        codex_path = self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json"
        codex = read_json(codex_path)
        codex["skills"] = "./custom-skills/"
        write_json(codex_path, codex)

        self.sync()

        self.assertEqual("./custom-skills/", read_json(codex_path)["skills"])


if __name__ == "__main__":
    unittest.main()
