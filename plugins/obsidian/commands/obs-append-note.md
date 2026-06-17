---
name: append-note
description: Append content to an existing Obsidian note. Creates the note if it doesn't exist.
---

The user wants to append content to a note in their Obsidian vault.

The argument is the vault-relative path (e.g. `Projects/my-note.md`).
If no path was given, ask for it.
Then ask for the content to append if not provided in context.

Call the `append_to_note` MCP tool with the path and content.
Confirm what was appended and to which note.
