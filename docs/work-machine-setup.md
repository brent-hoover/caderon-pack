# Applying the Claude asset setup to a work machine

Runbook for migrating a second (work) machine onto the caderon-pack plugin + chezmoi-profile
setup created 2026-05-29. The end state: skills come from the `core`, `go`, `devops`, and
`doc-driven-development` plugins (devops is **work-only**), `~/.claude/skills/` is empty, and
`settings.json` is rendered from chezmoi with `is_personal_machine: false`.

See `docs/specs/2026-05-29-claude-asset-management-design.md` for the why.

## Before you start

- This assumes the work machine already has chezmoi initialized from `2f-dotfiles` and Claude
  Code installed.
- Do this when you can restart Claude Code afterward.
- ⚠️ **Shell gotcha on these machines:** `ls` is aliased to `eza` and zsh aborts a command
  when a glob matches nothing. Do **not** trust `ls`/`rm ./*` for the cleanup — use the
  `find`/absolute-path commands given below. (A glob-based `rm` can silently no-op.)

---

## Step 0 — Audit the work machine's existing skills FIRST (don't blind-delete)

The work machine likely has its own `~/.claude/skills/` set, which may include skills that are
**not** in caderon-pack yet (work-specific). Deleting blindly loses them.

```bash
# List what's there and where each came from (skillfish origin if present)
cd ~/.claude/skills
for d in */; do
  d="${d%/}"
  [ -L "$d" ] && { printf "%-30s SYMLINK -> %s\n" "$d" "$(readlink "$d")"; continue; }
  origin="(hand-made / no skillfish)"
  [ -f "$d/.skillfish.json" ] && origin="$(jq -r '"\(.owner)/\(.repo)/\(.path)"' "$d/.skillfish.json" 2>/dev/null)"
  printf "%-30s %s\n" "$d" "$origin"
done
```

Compare against what the plugins already provide:

| Plugin | Skills |
|--------|--------|
| `core` | roborev-design-review, roborev-design-review-branch, roborev-fix, roborev-refine, roborev-respond, roborev-review, roborev-review-branch, explain-code, conventional-commit, codebase-visualizer, code-quality, git-master, vue-typescript |
| `go` | go-backend-workflow, go-concurrency-patterns, go-error-handling, go-interfaces |
| `devops` | helm-debugging, helm-values-management, k8s-manifest-generator, k8s-security-policies |

For anything on the work machine **not** covered above and worth keeping:
- If it's generally useful → add it to `core`/`go`/`devops` (copy into `plugins/<p>/skills/`,
  strip `.skillfish.json`, bump that plugin's version, push — see "Adding a skill" below).
- If it's strictly work-only → consider a new `work` plugin in caderon-pack gated the same way
  as `devops` (`{{ if not .is_personal_machine }}`), or just leave it loose in
  `~/.claude/skills/` and skip it in Step 3's deletion.

**Do not proceed to deletion until every keep-worthy skill is captured in a plugin (and pushed).**

---

## Step 1 — Pull the latest config

```bash
# dotfiles (chezmoi source)
cd ~/.local/share/chezmoi
git stash -u 2>/dev/null   # if you have local uncommitted dotfile edits; otherwise skip
git pull
git stash pop 2>/dev/null  # restore local edits if you stashed

# caderon-pack (only needed if you keep a local clone; the marketplace pulls from GitHub anyway)
```

---

## Step 2 — Set the work profile

Edit `~/.config/chezmoi/chezmoi.yaml` and set the data var to false:

```yaml
data:
  is_personal_machine: false
```

Verify the template now includes devops:

```bash
cd ~/.local/share/chezmoi
chezmoi execute-template < dot_claude/settings.json.tmpl \
  | jq '.enabledPlugins | with_entries(select(.key|test("caderon-pack")))'
```
Expected: `core`, `go`, `devops`, and `doc-driven-development` all `true`.

---

## Step 3 — Review the settings diff and reconcile, THEN apply

⚠️ **Important:** `settings.json.tmpl` was authored from the personal machine. Its
`permissions.allow` list, `model`, and the official-plugin `enabledPlugins` reflect that
machine. Applying it will overwrite the work machine's `~/.claude/settings.json`. Review first:

```bash
cd ~/.local/share/chezmoi
chezmoi diff ~/.claude/settings.json
```

Walk the diff:
- **Keep from the template:** the caderon-pack entries (core/go/devops/doc-driven-development)
  and the GitHub marketplace source — that's the point.
- **Reconcile anything work-specific** the diff would remove (extra permissions, work-only
  plugins, a different `model`, work MCP). If the template would drop something you need on
  this machine, add it into `dot_claude/settings.json.tmpl` now and commit, so both machines
  stay correct. (If divergence is large, that's a signal to split the truly-shared bits from
  machine-specific bits in the template — a follow-up improvement, not required today.)

When the diff looks right:

```bash
chezmoi apply ~/.claude/settings.json
# if chezmoi complains the file changed since it last wrote it (Claude rewrites it at runtime),
# re-run with --force AFTER you've confirmed the diff:
chezmoi apply --force ~/.claude/settings.json
```

Confirm:
```bash
jq '.enabledPlugins | with_entries(select(.key|test("caderon-pack")))' ~/.claude/settings.json
jq -c '.extraKnownMarketplaces."caderon-pack".source' ~/.claude/settings.json
jq '.permissions.allow | length' ~/.claude/settings.json   # sanity-check nothing important was lost
```
Expected: all four caderon-pack plugins `true`; source is `{"source":"github","repo":"brent-hoover/caderon-pack"}`.

---

## Step 4 — Install the plugins (before deleting anything)

Do this as its own step so the plugin-provided skills are confirmed present **before** you
remove the loose copies.

```bash
claude plugin marketplace add brent-hoover/caderon-pack   # skip if already listed
claude plugin marketplace update caderon-pack
claude plugin install core@caderon-pack go@caderon-pack devops@caderon-pack doc-driven-development@caderon-pack -s user
```

Verify the skills landed in the plugin cache (note the version subdir — use a full `find`, not
`-maxdepth 2`):
```bash
find ~/.claude/plugins/cache/caderon-pack/core   -name SKILL.md | wc -l   # 13
find ~/.claude/plugins/cache/caderon-pack/go     -name SKILL.md | wc -l   # 4
find ~/.claude/plugins/cache/caderon-pack/devops -name SKILL.md | wc -l   # 4
```

**Gate:** do not continue until these counts are right.

---

## Step 5 — Clear the loose skills (safe commands)

Only after Step 4 passes and Step 0's keep-list is captured. Use absolute paths, not globs:

```bash
# Sanity-count first (find, not ls — ls is aliased to eza here)
find ~/.claude/skills -mindepth 1 -maxdepth 1 | wc -l

# If you decided to keep some loose work-only skills, move them aside first:
#   mkdir -p ~/.claude/skills-keep && mv ~/.claude/skills/<name> ~/.claude/skills-keep/

# Nuke and recreate empty
rm -rf ~/.claude/skills
mkdir -p ~/.claude/skills

# Confirm empty
find ~/.claude/skills -mindepth 1 | wc -l   # 0
```

If you stashed keepers in `~/.claude/skills-keep`, move them back into `~/.claude/skills/`
after this (or better, get them into a plugin and leave the dir empty).

---

## Step 6 — Restart and verify

Restart Claude Code (the running process holds previously-loaded skills; new sessions load
from plugins). Then:

```bash
claude plugin list | grep -i caderon
```
In-session, `/plugin` should list `core@caderon-pack`, `go@caderon-pack`, `devops@caderon-pack`,
`doc-driven-development@caderon-pack` as enabled, and the helm/k8s/go/roborev skills should
appear in the available-skills list (devops skills present here, unlike the personal machine).

---

## Rollback

- `settings.json`: `chezmoi` keeps the prior content in git; `cd ~/.local/share/chezmoi &&
  git log -- dot_claude/settings.json.tmpl`. To revert the live file, check out the old
  source and re-apply, or restore from `~/.claude/settings.json` backup if you made one.
- Deleted loose skills: they're all in caderon-pack (and its git history) for the packaged
  ones. Reinstall via `claude plugin install`. Work-only ones you moved to `skills-keep` are
  still there.

---

## Adding a skill later (either machine class)

```bash
cd ~/Projects/personal/caderon-pack            # local clone
cp -R <source-skill-dir> plugins/<core|go|devops>/skills/<name>
find plugins/<plugin>/skills/<name> -name .skillfish.json -delete
# bump "version" in plugins/<plugin>/.claude-plugin/plugin.json
git add -A && git commit -m "feat(<plugin>): add <name> skill" && git push
# on each machine:
claude plugin marketplace update caderon-pack
claude plugin install <plugin>@caderon-pack -s user
```
