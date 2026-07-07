---
name: obs-work-log
description: Write an end-of-day work log to Obsidian Work Logs, optionally under a project subfolder.
---

The user wants to save an end-of-day Obsidian work log.

Use the `work-log` skill to write the entry. If the user provided a project name, pass it as the `project`
argument to the `work_log` MCP tool. If they provided a date, pass it as `entry_date` in `YYYY-MM-DD` format.

The entry must include `Where We Left Off` and `Where To Start Tomorrow` sections.

Call the `work_log` MCP tool with the completed Markdown content. Confirm only the saved Obsidian path.
