---
name: obs-raindrop-digest
description: Fetch Raindrop bookmarks tagged for processing, summarize each, save to Obsidian, then remove the tag. Default tag is "to-obsidian".
---

The user wants to process Raindrop bookmarks into Obsidian summaries.

## Steps

1. **Determine the tag** — use the argument if provided, otherwise default to `to-obsidian`.

2. **Find bookmarks** — call `find_bookmarks` with `has_tags: [<tag>]`. If none are found, report that and stop.

3. **For each bookmark**, in sequence:

   a. **Fetch content** — call `fetch_bookmark_content` with the bookmark's id.

   b. **Summarize** — produce a concise summary of the content:
      - 3–5 bullet points capturing the key ideas
      - One sentence of overall context if helpful

   c. **Build the note** — format it as:
      ```
      # <bookmark title>

      **Source:** <url>
      **Saved:** <today's date YYYY-MM-DD>
      **Tags:** <original raindrop tags, comma-separated, excluding the processing tag>

      ## Summary

      <bullet-point summary>
      ```

   d. **Save to Obsidian** — call `save_note` with path `Clippings/<slugified-title>.md` (lowercase, spaces→hyphens, strip special chars). Overwrite is fine.

   e. **Remove the tag** — call `update_bookmarks` with `remove_tags: [<tag>]` for this bookmark's id only. Do NOT modify any other fields.

4. **Report** — after all bookmarks are processed, list what was saved and confirm the tag was removed from each.

## Notes
- Process bookmarks one at a time, not in batch — remove the tag immediately after saving so a failure mid-run doesn't reprocess earlier items.
- If `fetch_bookmark_content` returns no text (paywalled, PDF, etc.), write a note with just the title, URL, and a line: `_Content unavailable — review manually._` Still remove the tag.
- Keep the slug under 80 chars.
