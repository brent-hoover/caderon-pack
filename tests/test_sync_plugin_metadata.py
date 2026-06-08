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

    def test_codex_skills_field_is_preserved(self) -> None:
        codex_path = self.tmp / "plugins" / "go" / ".codex-plugin" / "plugin.json"
        codex = read_json(codex_path)
        codex["skills"] = "./custom-skills/"
        write_json(codex_path, codex)

        self.sync()

        self.assertEqual("./custom-skills/", read_json(codex_path)["skills"])


if __name__ == "__main__":
    unittest.main()
