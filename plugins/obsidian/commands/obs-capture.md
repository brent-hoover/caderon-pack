---
name: obs-capture
description: Quick-capture content to Obsidian Inbox.md. Optionally include a source URL.
---

The user wants to capture something to their Obsidian inbox.

Parse the argument for content and an optional URL:
- If the argument contains a URL (starts with http/https), use it as the `source` parameter
- The remaining text is the `content`
- If no argument was given, ask what to capture

Call the `quick_capture` MCP tool with the content and optional source.
Confirm the capture was saved to Inbox.md.
