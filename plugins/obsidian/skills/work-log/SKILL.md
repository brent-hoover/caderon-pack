---
name: work-log
description: Write an end-of-day engineering work log to the user's Obsidian vault. Use when the user asks for a work log, end-of-day log, daily work summary, or when a substantive work session is ending and the agent should preserve what changed, what was verified, and what remains. Calls the Obsidian MCP `work_log` tool.
---

# Work Log

Write a concise Markdown session entry, then append it to the day's Obsidian work log with the MCP `work_log` tool.

## Workflow

1. Reconstruct what actually happened from the conversation and disk state.
2. Prefer concrete artifacts: files changed, commands run, checks observed, branches, PRs, error text, and decisions.
3. Omit routine tool chatter unless it changed the outcome.
4. Write one session entry in Markdown with this structure:

```markdown
## <short session title>

### Focus
- <one to three bullets naming the main work>

### Where We Left Off
- <the exact current state of the work>
- <what is done vs. mid-flight>
- <important paths, branches, PRs, commands, or failing checks needed to resume>

### Where To Start Tomorrow
- <the first concrete action to take next>
- <the second/third action only if needed>
- <what to verify before moving on>

### Changed
- <specific files, systems, or behavior changed>

### Verified
- <commands run and observed results>

### Remaining
- <open work, skipped checks, or follow-up>
```

Keep bullets factual and short. Do not invent future plans; include only known next steps or explicitly skipped verification.
The two most important sections are `Where We Left Off` and `Where To Start Tomorrow`; spend the most care there.

## Saving

Call `work_log` with:

- `content`: one complete Markdown session entry. Do not include the top-level daily heading; the tool creates it once.
- `project`: optional. Use it when the work clearly belongs to a project or the user provides one. It creates a subfolder under `Work Logs`.
- `entry_date`: optional `YYYY-MM-DD`. Leave blank for today unless the user asks to backfill a different date.

The tool appends to `Work Logs[/project]/YYYY-MM-DD.md`, creating the daily file if needed. Report only the saved Obsidian path after the tool succeeds.
