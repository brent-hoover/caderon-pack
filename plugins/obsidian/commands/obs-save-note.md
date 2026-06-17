---
name: save-note
description: Create or overwrite a note in the Obsidian vault. Argument is the vault-relative path.
---

The user wants to save a note to their Obsidian vault.

The argument is the vault-relative path (e.g. `Projects/my-note.md`).
If no path was given, ask for it.
Then ask for the note content if not provided in context.

Call the `save_note` MCP tool with the path and content.
Confirm the note was saved.
