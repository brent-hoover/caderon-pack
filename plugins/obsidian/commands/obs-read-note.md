---
name: obs-read-note
description: Read a note from the Obsidian vault. Path is relative to vault root (e.g. Projects/my-note.md).
---

The user wants to read a note from their Obsidian vault.

The argument is the vault-relative path to the note (e.g. `Projects/my-note.md`).
If no path was given, ask for it.

Call the `read_note` MCP tool with the path.
Display the note content to the user.
