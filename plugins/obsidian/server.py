import os
from datetime import date
from pathlib import Path

from mcp.server.fastmcp import FastMCP

import config

mcp = FastMCP("Obsidian Vault")

VAULT = Path(config.OBSIDIAN_VAULT_PATH).expanduser()


def _safe_path(relative_path: str) -> Path:
    """Resolve a vault-relative path, rejecting traversal outside the vault."""
    vault_root = VAULT.resolve()
    resolved = (VAULT / relative_path).resolve()
    try:
        resolved.relative_to(vault_root)
    except ValueError:
        raise ValueError(f"Path outside vault: {relative_path}")
    return resolved


@mcp.tool(description="Read a note from the Obsidian vault. Path is relative to vault root (e.g. 'Projects/my-note.md').")
async def read_note(path: str) -> str:
    p = _safe_path(path)
    if not p.exists():
        return f"Note not found: {path}"
    return p.read_text()


@mcp.tool(description="Save (create or overwrite) a note. Path is relative to vault root. Creates parent folders as needed.")
async def save_note(path: str, content: str) -> str:
    p = _safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return f"Saved: {path}"


@mcp.tool(description="Append content to an existing note. Creates the note if it doesn't exist.")
async def append_to_note(path: str, content: str) -> str:
    p = _safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a") as f:
        f.write(f"\n\n{content}")
    return f"Appended to: {path}"


@mcp.tool(description="Append content to today's daily note in the Journal folder. Creates it if it doesn't exist.")
async def daily_note(content: str) -> str:
    today = date.today().strftime(config.DAILY_NOTE_FORMAT)
    folder = config.DAILY_NOTES_FOLDER
    path = f"{folder}/{today}.md" if folder else f"{today}.md"
    p = _safe_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    if not p.exists():
        p.write_text(f"# {today}\n\n{content}")
    else:
        with open(p, "a") as f:
            f.write(f"\n\n{content}")
    return f"Added to daily note: {path}"


@mcp.tool(description="Dump raw content to the inbox note for later processing. Optionally include a source URL.")
async def quick_capture(content: str, source: str = "") -> str:
    p = _safe_path(config.INBOX_NOTE)
    p.parent.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    entry = f"\n- [{today}] {content}"
    if source:
        entry += f"\n  Source: {source}"
    with open(p, "a") as f:
        f.write(entry)
    return f"Captured to {config.INBOX_NOTE}"


@mcp.tool(description="List notes in a vault folder. Defaults to vault root. Returns paths relative to vault root.")
async def list_notes(folder: str = "") -> list[str]:
    base = _safe_path(folder) if folder else VAULT
    if not base.exists():
        return []
    return [
        str(p.relative_to(VAULT))
        for p in sorted(base.rglob("*.md"))
        if not any(ex in p.parts for ex in config.EXCLUDE_DIRS)
    ]


# --- RAG tools (disabled — requires Ollama running locally) ---
# To re-enable: uncomment the imports and registrations below,
# then add chromadb, ollama, tqdm, markdown-it-py back to pyproject.toml.
#
# from tools.indexer import index_collection
# from tools.retriever import search
#
# @mcp.tool(description="Rebuild the semantic search index from the Obsidian vault")
# async def index_vault():
#     return index_collection()
#
# @mcp.tool(description="Search the Obsidian vault using natural language")
# async def search_vault(query: str):
#     return search(query)


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    if transport == "sse":
        mcp.settings.host = os.environ.get("MCP_HOST", "127.0.0.1")
        mcp.settings.port = int(os.environ.get("MCP_OBSIDIAN_PORT", "8104"))
        mcp.run(transport="sse")
    else:
        mcp.run()


if __name__ == "__main__":
    main()
