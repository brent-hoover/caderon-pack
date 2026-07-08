#!/usr/bin/env python3
"""Extract a compact, analysis-ready digest from a Claude Code session transcript.

Claude Code stores each session as a JSONL file under
``~/.claude/projects/<mangled-cwd>/<session-id>.jsonl``. A live session can be
tens of thousands of lines once tool results and attachments are counted, far
too much to reason over directly. This script distills one transcript down to
the parts a retrospective actually needs: the human's prompts, Claude's visible
replies, a compact trace of tool calls, and any tool errors — in chronological
order, with a summary header.

Usage:
    extract_transcript.py                 # newest transcript for the current cwd
    extract_transcript.py --list          # list recent transcripts to choose from
    extract_transcript.py <path.jsonl>    # a specific transcript
    extract_transcript.py --session <id>  # by session id (filename stem)
    extract_transcript.py --include-thinking   # also emit assistant reasoning

The digest is written to stdout as Markdown.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

PROJECTS_DIR = Path.home() / ".claude" / "projects"

# Assistant text longer than this is truncated in the digest — enough to judge
# substance and tone without dragging the whole essay into context.
ASSISTANT_TEXT_LIMIT = 1500
USER_TEXT_LIMIT = 4000
THINKING_LIMIT = 800
TOOL_ERROR_LIMIT = 400
# Injected context (loaded skill bodies, slash-command expansions) is machinery,
# not the human speaking — keep just enough to see what fired.
CONTEXT_LIMIT = 300


def mangle_cwd(cwd: Path) -> str:
    """Reproduce Claude Code's project-dir naming: every non-alphanumeric char
    in the absolute path becomes a dash."""
    return re.sub(r"[^A-Za-z0-9]", "-", str(cwd))


def project_dir_for_cwd() -> Path:
    return PROJECTS_DIR / mangle_cwd(Path.cwd())


def newest_transcript() -> Path | None:
    """The current session is, in practice, the most recently modified
    transcript. Prefer this cwd's project dir; fall back to all projects."""
    candidates: list[Path] = []
    scoped = project_dir_for_cwd()
    if scoped.is_dir():
        candidates = list(scoped.glob("*.jsonl"))
    if not candidates and PROJECTS_DIR.is_dir():
        candidates = list(PROJECTS_DIR.glob("*/*.jsonl"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def first_user_prompt(path: Path) -> str:
    """A one-line preview of a transcript's opening human prompt, for --list."""
    for rec in iter_records(path):
        text = user_text(rec)
        if text:
            return text.strip().splitlines()[0][:100]
    return "(no user prompt found)"


def list_transcripts() -> None:
    scoped = project_dir_for_cwd()
    search = scoped if scoped.is_dir() else PROJECTS_DIR
    paths = sorted(
        search.glob("*.jsonl" if search is scoped else "*/*.jsonl"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not paths:
        print(f"No transcripts found under {search}", file=sys.stderr)
        return
    print(f"Recent transcripts under {search}:\n")
    for p in paths[:15]:
        print(f"  {p.stem}")
        print(f"    {first_user_prompt(p)}\n")


def iter_records(path: Path):
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + f"  …[+{len(text) - limit} chars]"


def is_injected(text: str) -> bool:
    """System reminders and slash-command scaffolding arrive as user-role text
    but aren't things the human typed. Exclude them from 'user said'."""
    head = text.lstrip()[:40]
    return head.startswith(("<system-reminder>", "<command-name>", "<local-command"))


def classify_user(rec: dict) -> tuple[str, str]:
    """Classify a user-role record and return (kind, text).

    Claude Code writes several things as user-role records; only some are the
    human speaking:
      - "human"   : a prompt the person actually typed. Stored as string content
                    (or as an array containing an image, i.e. multimodal input).
      - "context" : injected machinery — a loaded skill body or slash-command
                    expansion. Text-only array content with no tool result.
      - "tool"    : a tool_result being fed back (handled elsewhere for errors).
      - "skip"    : system reminders and command scaffolding — not the human.
    """
    if rec.get("type") != "user":
        return ("skip", "")
    content = rec.get("message", {}).get("content")

    if isinstance(content, str):
        return ("skip", "") if is_injected(content) else ("human", content)

    if not isinstance(content, list):
        return ("skip", "")

    has_image = any(isinstance(b, dict) and b.get("type") == "image" for b in content)
    has_tool_result = any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content)
    if has_tool_result:
        return ("tool", "")

    parts = [
        b["text"]
        for b in content
        if isinstance(b, dict) and b.get("type") == "text" and not is_injected(b.get("text", ""))
    ]
    text = "\n".join(p for p in parts if p.strip())
    if not text:
        return ("skip", "")
    # A text-only array is injected context; add an image and it's real input.
    return ("human", text) if has_image else ("context", text)


def user_text(rec: dict) -> str | None:
    """The genuine human utterance in a record, or None. Used by --list preview."""
    kind, text = classify_user(rec)
    return text if kind == "human" else None


def tool_target(name: str, tool_input: dict) -> str:
    """A short, human-readable summary of what a tool call acted on."""
    if not isinstance(tool_input, dict):
        return ""
    if name == "Bash":
        return truncate(str(tool_input.get("command", "")).splitlines()[0] if tool_input.get("command") else "", 100)
    for key in ("file_path", "path", "notebook_path"):
        if key in tool_input:
            return str(tool_input[key])
    if name == "Skill":
        return str(tool_input.get("skill", ""))
    if name == "Agent":
        return str(tool_input.get("description", ""))
    if name == "Task":
        return str(tool_input.get("description", ""))
    if name in ("Grep", "Glob"):
        return str(tool_input.get("pattern", ""))
    return ""


@dataclass
class Digest:
    session_id: str = ""
    path: str = ""
    cwd: str = ""
    git_branch: str = ""
    version: str = ""
    first_ts: str = ""
    last_ts: str = ""
    n_user: int = 0
    n_assistant: int = 0
    n_context: int = 0
    tool_counts: dict[str, int] = field(default_factory=dict)
    tool_errors: int = 0
    timeline: list[str] = field(default_factory=list)


def build_digest(path: Path, include_thinking: bool) -> Digest:
    d = Digest(session_id=path.stem, path=str(path))
    for rec in iter_records(path):
        ts = rec.get("timestamp")
        if ts:
            d.first_ts = d.first_ts or ts
            d.last_ts = ts
        if not d.cwd and rec.get("cwd"):
            d.cwd = rec["cwd"]
            d.git_branch = rec.get("gitBranch", "")
            d.version = rec.get("version", "")

        rtype = rec.get("type")
        if rtype == "user":
            _handle_user(rec, d)
        elif rtype == "assistant":
            _handle_assistant(rec, d, include_thinking)
    return d


def _handle_user(rec: dict, d: Digest) -> None:
    kind, text = classify_user(rec)
    if kind == "human":
        d.n_user += 1
        d.timeline.append(f"### 🧑 User\n{truncate(text, USER_TEXT_LIMIT)}")
        return
    if kind == "context":
        d.n_context += 1
        d.timeline.append(f"  📎 injected context: {truncate(text, CONTEXT_LIMIT)}")
        return
    # tool_result records aren't spoken turns, but errors are a key retro signal.
    content = rec.get("message", {}).get("content")
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result" and block.get("is_error"):
                body = block.get("content", "")
                if isinstance(body, list):
                    body = " ".join(b.get("text", "") for b in body if isinstance(b, dict))
                d.tool_errors += 1
                d.timeline.append(f"  ⚠️ tool error: {truncate(str(body), TOOL_ERROR_LIMIT)}")


def _handle_assistant(rec: dict, d: Digest, include_thinking: bool) -> None:
    content = rec.get("message", {}).get("content", [])
    if not isinstance(content, list):
        return
    counted = False
    for block in content:
        if not isinstance(block, dict):
            continue
        btype = block.get("type")
        if btype == "text" and block.get("text", "").strip():
            if not counted:
                d.n_assistant += 1
                counted = True
            d.timeline.append(f"### 🤖 Claude\n{truncate(block['text'], ASSISTANT_TEXT_LIMIT)}")
        elif btype == "thinking" and include_thinking and block.get("thinking", "").strip():
            d.timeline.append(f"  💭 _{truncate(block['thinking'], THINKING_LIMIT)}_")
        elif btype == "tool_use":
            name = block.get("name", "?")
            d.tool_counts[name] = d.tool_counts.get(name, 0) + 1
            target = tool_target(name, block.get("input", {}))
            d.timeline.append(f"  🔧 {name}({target})" if target else f"  🔧 {name}")


def render(d: Digest) -> str:
    tools = ", ".join(f"{n}×{c}" for n, c in sorted(d.tool_counts.items(), key=lambda kv: -kv[1]))
    lines = [
        "# Session transcript digest",
        "",
        f"- **Session:** `{d.session_id}`",
        f"- **Transcript:** `{d.path}`",
        f"- **CWD:** `{d.cwd}`  **Branch:** `{d.git_branch or 'n/a'}`  **CC version:** `{d.version or 'n/a'}`",
        f"- **Span:** {d.first_ts or '?'} → {d.last_ts or '?'}",
        f"- **Turns:** {d.n_user} user, {d.n_assistant} assistant"
        + (f", {d.n_context} injected-context" if d.n_context else ""),
        f"- **Tool calls:** {tools or 'none'}",
        f"- **Tool errors:** {d.tool_errors}",
        "",
        "---",
        "",
        "## Timeline",
        "",
    ]
    lines.extend(d.timeline)
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("transcript", nargs="?", help="Path to a transcript .jsonl (default: newest for cwd)")
    ap.add_argument("--list", action="store_true", help="List recent transcripts and exit")
    ap.add_argument("--session", help="Select a transcript by session id (filename stem)")
    ap.add_argument("--include-thinking", action="store_true", help="Include assistant reasoning blocks")
    args = ap.parse_args()

    if args.list:
        list_transcripts()
        return 0

    if args.transcript:
        path = Path(args.transcript).expanduser()
    elif args.session:
        scoped = project_dir_for_cwd()
        matches = list(scoped.glob(f"{args.session}.jsonl")) if scoped.is_dir() else []
        matches = matches or list(PROJECTS_DIR.glob(f"*/{args.session}.jsonl"))
        if not matches:
            print(f"No transcript with session id {args.session!r}", file=sys.stderr)
            return 1
        path = matches[0]
    else:
        found = newest_transcript()
        if found is None:
            print(f"No transcripts found under {PROJECTS_DIR}", file=sys.stderr)
            return 1
        path = found
        print(f"[extract_transcript] using newest transcript: {path}", file=sys.stderr)

    if not path.is_file():
        print(f"Transcript not found: {path}", file=sys.stderr)
        return 1

    print(render(build_digest(path, args.include_thinking)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
