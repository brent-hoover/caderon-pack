# Raindrop → Obsidian Digest

Automatically summarizes Raindrop bookmarks into Obsidian notes, triggered every 6 hours via launchd.

## How it works

1. A launchd agent runs `claude -p` with an inline digest prompt every 6 hours (the prompt is embedded in the plist — see "Setting up on a new machine" below; it mirrors the on-demand `/obs-raindrop-digest` command).
2. Claude finds all Raindrop bookmarks tagged `to-obsidian`.
3. For each bookmark: fetches the content, writes a bullet-point summary to `Clippings/<slug>.md` in the Obsidian vault, then removes the `to-obsidian` tag so it won't be reprocessed.

## Usage

Tag any Raindrop bookmark with `to-obsidian`. It will appear summarized in your vault within 6 hours, or immediately with:

```bash
launchctl start com.brent.raindrop-digest
tail -f ~/Library/Logs/raindrop-digest.log
```

The skill also works on demand: run `/obs-raindrop-digest` in Claude Code, or pass a custom tag:

```
/obs-raindrop-digest my-tag
```

## Components

| Component | Location |
|-----------|----------|
| Skill definition | `plugins/obsidian/commands/obs-raindrop-digest.md` |
| launchd plist | `~/Library/LaunchAgents/com.brent.raindrop-digest.plist` |
| Log | `~/Library/Logs/raindrop-digest.log` |
| Output folder | `Clippings/` in Obsidian vault |

## launchd management

```bash
# Load / enable
launchctl load ~/Library/LaunchAgents/com.brent.raindrop-digest.plist

# Unload / disable
launchctl unload ~/Library/LaunchAgents/com.brent.raindrop-digest.plist

# Reload after editing the plist
launchctl unload ~/Library/LaunchAgents/com.brent.raindrop-digest.plist
launchctl load ~/Library/LaunchAgents/com.brent.raindrop-digest.plist

# Check status (- = idle, PID = running)
launchctl list | grep raindrop
```

## Setting up on a new machine

1. Install the obsidian plugin from caderon-pack (provides the skill).
2. Confirm the Raindrop MCP is connected in Claude Code settings.
3. Confirm the Obsidian MCP is running and pointed at the correct vault.
4. Copy or recreate the launchd plist:

```bash
cat > ~/Library/LaunchAgents/com.brent.raindrop-digest.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.brent.raindrop-digest</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/brent/.local/bin/claude</string>
        <string>-p</string>
        <string>Find all Raindrop bookmarks tagged "to-obsidian". For each one: fetch its full content, write a concise 3-5 bullet-point summary as a markdown note to Obsidian at path Clippings/&lt;slugified-title&gt;.md (lowercase, spaces to hyphens, max 80 chars), including the title, source URL, today's date, original tags, and the summary. Then immediately remove the "to-obsidian" tag from that bookmark so it won't be reprocessed. Process bookmarks one at a time. If fetch returns no content, save a stub note and still remove the tag.</string>
        <string>--allowedTools</string>
        <string>mcp__raindrop__find_bookmarks,mcp__raindrop__fetch_bookmark_content,mcp__raindrop__update_bookmarks,mcp__plugin_obsidian_obsidian__save_note</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/Users/brent</string>
        <key>PATH</key>
        <string>/Users/brent/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Hour</key><integer>0</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
    </array>
    <key>StandardOutPath</key>
    <string>/Users/brent/Library/Logs/raindrop-digest.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/brent/Library/Logs/raindrop-digest.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/brent/Projects/personal/caderon-pack</string>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.brent.raindrop-digest.plist
```

5. Test: tag a bookmark `to-obsidian` in Raindrop, then `launchctl start com.brent.raindrop-digest` and watch the log.

## Notes

- The plist is **not** checked into this repo (it lives in `~/Library/LaunchAgents/`). The setup instructions above are the source of truth.
- The launchd agent runs with a minimal environment — if claude's PATH changes, update the plist and reload.
- If Obsidian Sync is in use, writes go to the local vault and Sync propagates them automatically. No git sync needed.
