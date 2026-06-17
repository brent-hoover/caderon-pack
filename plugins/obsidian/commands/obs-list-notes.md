---
name: obs-list-notes
description: List notes in an Obsidian vault folder. Defaults to the vault root.
---

The user wants to list notes in their Obsidian vault.

The argument is an optional vault-relative folder path (e.g. `Projects`).
If no folder is given, list from the vault root.

Call the `list_notes` MCP tool with the folder (or empty string for root).
Display the list of notes, grouped by subfolder if there are many.
