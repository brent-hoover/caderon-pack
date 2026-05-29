# Claude Asset Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repackage 21 personal skills into three versioned plugins in the `caderon-pack` marketplace, drive per-machine skill sets through chezmoi-templated `enabledPlugins`, and delete the duplicated/junk standalone skills and machine-state cruft.

**Architecture:** `caderon-pack` (GitHub marketplace) owns skills as plugins (`core`, `go`, `devops`). chezmoi manages config only: a templated `settings.json` selects which plugins are enabled per machine using the existing `is_personal_machine` data var (`devops` is work-only). Claude installs the enabled caderon-pack plugins from GitHub on launch.

**Tech Stack:** Claude Code plugins/marketplace JSON, chezmoi templates (Go text/template), git, jq, bash.

---

## File Structure

**caderon-pack repo** (`/Users/brent/Projects/personal/caderon-pack`):
- `.claude-plugin/marketplace.json` — add `core`, `go`, `devops` entries (modify)
- `plugins/core/.claude-plugin/plugin.json` — new
- `plugins/core/skills/<13 skills>/` — vendored copies
- `plugins/go/.claude-plugin/plugin.json` — new
- `plugins/go/skills/<4 skills>/` — vendored copies
- `plugins/devops/.claude-plugin/plugin.json` — new
- `plugins/devops/skills/<4 skills>/` — vendored copies

**chezmoi source** (`/Users/brent/.local/share/chezmoi`):
- `dot_claude/settings.json` → **rename to** `dot_claude/settings.json.tmpl` (templated enabledPlugins + github marketplace source), rebuilt from live state
- `.chezmoiignore` — add Claude machine-state paths (modify)
- Delete: `dot_claude/skills/**`, `dot_claude/plugins/private_installed_plugins.json`, `dot_claude/plugins/modify_known_marketplaces.json.tmpl`, `dot_claude/modify_dot_claude.json.tmpl`

**Live tree** (`/Users/brent/.claude`):
- `skills/` — delete 9 standalone dirs + 1 symlink after plugins verified

### Skill assignments
- **core (13):** `roborev-design-review`, `roborev-design-review-branch`, `roborev-fix`, `roborev-refine`, `roborev-respond`, `roborev-review`, `roborev-review-branch`, `explain-code`, `conventional-commit`, `codebase-visualizer`, `code-quality`, `git-master`, `vue-typescript`
- **go (4):** `go-backend-workflow`, `go-concurrency-patterns`, `go-error-handling`, `go-interfaces`
- **devops (4):** `helm-debugging`, `helm-values-management`, `k8s-manifest-generator`, `k8s-security-policies`
- **delete (10):** `agent-development`, `hook-development`, `mcp-integration`, `plugin-structure`, `frontend-design`, `skill-adapter`, `kubernetes-secrets-manager`, `template`, `git-advanced-workflows`, and the `find-skills` symlink

---

## Task 1: Scaffold the three plugins in caderon-pack

**Files:**
- Create: `plugins/core/.claude-plugin/plugin.json`, `plugins/go/.claude-plugin/plugin.json`, `plugins/devops/.claude-plugin/plugin.json`

- [ ] **Step 1: Create plugin directories**

```bash
cd /Users/brent/Projects/personal/caderon-pack
mkdir -p plugins/core/.claude-plugin plugins/core/skills \
         plugins/go/.claude-plugin plugins/go/skills \
         plugins/devops/.claude-plugin plugins/devops/skills
```

- [ ] **Step 2: Write `plugins/core/.claude-plugin/plugin.json`**

```json
{
  "name": "core",
  "version": "1.0.0",
  "description": "Brent's always-on skills: roborev review workflow, code explanation, conventional commits, codebase visualization, code quality, git, and Vue/TypeScript frontend work",
  "author": { "name": "Brent Hoover", "email": "brent@thebuddhalodge.com" },
  "homepage": "https://github.com/brent-hoover/caderon-pack",
  "repository": "https://github.com/brent-hoover/caderon-pack",
  "license": "MIT",
  "keywords": ["roborev", "code-review", "git", "conventional-commit", "vue", "typescript"]
}
```

- [ ] **Step 3: Write `plugins/go/.claude-plugin/plugin.json`**

```json
{
  "name": "go",
  "version": "1.0.0",
  "description": "Go development skills: backend workflow, concurrency patterns, error handling, and interface design",
  "author": { "name": "Brent Hoover", "email": "brent@thebuddhalodge.com" },
  "homepage": "https://github.com/brent-hoover/caderon-pack",
  "repository": "https://github.com/brent-hoover/caderon-pack",
  "license": "MIT",
  "keywords": ["go", "golang", "concurrency", "interfaces", "backend"]
}
```

- [ ] **Step 4: Write `plugins/devops/.claude-plugin/plugin.json`**

```json
{
  "name": "devops",
  "version": "1.0.0",
  "description": "Kubernetes and Helm skills: manifest generation, security policies, Helm debugging, and values management",
  "author": { "name": "Brent Hoover", "email": "brent@thebuddhalodge.com" },
  "homepage": "https://github.com/brent-hoover/caderon-pack",
  "repository": "https://github.com/brent-hoover/caderon-pack",
  "license": "MIT",
  "keywords": ["kubernetes", "k8s", "helm", "devops", "manifests"]
}
```

- [ ] **Step 5: Verify all three parse as JSON**

Run:
```bash
cd /Users/brent/Projects/personal/caderon-pack
for p in core go devops; do jq -e .name plugins/$p/.claude-plugin/plugin.json; done
```
Expected: prints `"core"`, `"go"`, `"devops"` (exit 0 each).

---

## Task 2: Vendor the 13 core skills

**Files:**
- Create: `plugins/core/skills/<name>/` for each of the 13 core skills (copied from `~/.claude/skills/<name>`)

- [ ] **Step 1: Copy core skill directories**

```bash
cd /Users/brent/Projects/personal/caderon-pack
SRC=/Users/brent/.claude/skills
for s in roborev-design-review roborev-design-review-branch roborev-fix \
         roborev-refine roborev-respond roborev-review roborev-review-branch \
         explain-code conventional-commit codebase-visualizer code-quality \
         git-master vue-typescript; do
  cp -R "$SRC/$s" "plugins/core/skills/$s"
done
```

- [ ] **Step 2: Strip vendoring metadata from the copies**

```bash
find plugins/core/skills -name '.skillfish.json' -delete
```

- [ ] **Step 3: Verify each copied skill has a SKILL.md and no skillfish file**

Run:
```bash
cd /Users/brent/Projects/personal/caderon-pack
ls plugins/core/skills | wc -l        # expect 13
find plugins/core/skills -maxdepth 2 -name SKILL.md | wc -l   # expect 13
find plugins/core/skills -name '.skillfish.json' | wc -l      # expect 0
```
Expected: `13`, `13`, `0`.

- [ ] **Step 4: Commit**

```bash
cd /Users/brent/Projects/personal/caderon-pack
git add plugins/core
git commit -m "feat(core): add core plugin with 13 vendored skills"
```

---

## Task 3: Vendor the 4 go skills

**Files:**
- Create: `plugins/go/skills/<name>/` for each of the 4 go skills

- [ ] **Step 1: Copy go skill directories**

```bash
cd /Users/brent/Projects/personal/caderon-pack
SRC=/Users/brent/.claude/skills
for s in go-backend-workflow go-concurrency-patterns go-error-handling go-interfaces; do
  cp -R "$SRC/$s" "plugins/go/skills/$s"
done
find plugins/go/skills -name '.skillfish.json' -delete
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /Users/brent/Projects/personal/caderon-pack
ls plugins/go/skills | wc -l                                # expect 4
find plugins/go/skills -maxdepth 2 -name SKILL.md | wc -l   # expect 4
find plugins/go/skills -name '.skillfish.json' | wc -l      # expect 0
```
Expected: `4`, `4`, `0`.

- [ ] **Step 3: Commit**

```bash
cd /Users/brent/Projects/personal/caderon-pack
git add plugins/go
git commit -m "feat(go): add go plugin with 4 vendored skills"
```

---

## Task 4: Vendor the 4 devops skills

**Files:**
- Create: `plugins/devops/skills/<name>/` for each of the 4 devops skills

- [ ] **Step 1: Copy devops skill directories**

```bash
cd /Users/brent/Projects/personal/caderon-pack
SRC=/Users/brent/.claude/skills
for s in helm-debugging helm-values-management k8s-manifest-generator k8s-security-policies; do
  cp -R "$SRC/$s" "plugins/devops/skills/$s"
done
find plugins/devops/skills -name '.skillfish.json' -delete
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /Users/brent/Projects/personal/caderon-pack
ls plugins/devops/skills | wc -l                                # expect 4
find plugins/devops/skills -maxdepth 2 -name SKILL.md | wc -l   # expect 4
find plugins/devops/skills -name '.skillfish.json' | wc -l      # expect 0
```
Expected: `4`, `4`, `0`.

- [ ] **Step 3: Commit**

```bash
cd /Users/brent/Projects/personal/caderon-pack
git add plugins/devops
git commit -m "feat(devops): add devops plugin with 4 vendored skills"
```

---

## Task 5: Register the plugins in marketplace.json and push

**Files:**
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Replace the `plugins` array in `.claude-plugin/marketplace.json`**

The full file becomes:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "caderon-pack",
  "version": "1.0.0",
  "description": "Personal plugin marketplace for Brent's workflow — skills, commands, and hooks",
  "owner": {
    "name": "Brent Hoover",
    "email": "brent@thebuddhalodge.com"
  },
  "plugins": [
    {
      "name": "doc-driven-development",
      "description": "Guides Claude through problem → design → plan documentation workflow for new features",
      "source": "./plugins/doc-driven-development",
      "category": "workflow"
    },
    {
      "name": "core",
      "description": "Always-on skills: roborev review workflow, code explanation, conventional commits, codebase visualization, code quality, git, and Vue/TypeScript frontend work",
      "source": "./plugins/core",
      "category": "workflow"
    },
    {
      "name": "go",
      "description": "Go development skills: backend workflow, concurrency, error handling, interfaces",
      "source": "./plugins/go",
      "category": "development"
    },
    {
      "name": "devops",
      "description": "Kubernetes and Helm skills: manifest generation, security policies, Helm debugging, values management",
      "source": "./plugins/devops",
      "category": "devops"
    }
  ]
}
```

- [ ] **Step 2: Validate marketplace.json and that every `source` path exists**

Run:
```bash
cd /Users/brent/Projects/personal/caderon-pack
jq -e '.plugins | length == 4' .claude-plugin/marketplace.json
jq -r '.plugins[].source' .claude-plugin/marketplace.json | while read -r p; do
  test -f "$p/.claude-plugin/plugin.json" && echo "OK $p" || { echo "MISSING $p"; exit 1; }
done
```
Expected: `true`, then `OK ./plugins/doc-driven-development`, `OK ./plugins/core`, `OK ./plugins/go`, `OK ./plugins/devops`.

- [ ] **Step 3: Commit and push**

```bash
cd /Users/brent/Projects/personal/caderon-pack
git add .claude-plugin/marketplace.json
git commit -m "feat: register core, go, devops plugins in marketplace"
git push
```

(Push is required so the GitHub marketplace source resolves on every machine. Confirm before pushing per Brent's git rules.)

---

## Task 6: Convert chezmoi settings.json to a per-machine template

**Files:**
- Create: `dot_claude/settings.json.tmpl`
- Delete: `dot_claude/settings.json`

Rebuild from the **live** `~/.claude/settings.json` (the tracked source is stale). The only changes vs live: (a) add `core`/`go`/`devops` caderon-pack plugins to `enabledPlugins` with `devops` gated on a non-personal machine, (b) switch the `caderon-pack` marketplace to a GitHub source.

- [ ] **Step 1: Write `dot_claude/settings.json.tmpl`**

```json
{
  "permissions": {
    "allow": [
      "Read", "WebFetch", "WebSearch",
      "Bash(kubectl get *)", "Bash(kubectl describe *)", "Bash(kubectl logs *)",
      "Bash(kubectl explain *)", "Bash(kubectl config *)", "Bash(kubectl top *)",
      "Bash(kubectl api-resources *)", "Bash(kubectl api-versions *)",
      "Bash(kubectl auth can-i *)", "Bash(kubectl cluster-info *)", "Bash(kubectl diff *)",
      "Bash(kubectl version *)", "Bash(kubectl events *)", "Bash(k9s *)",
      "Bash(helm list *)", "Bash(helm status *)", "Bash(helm get *)", "Bash(helm show *)",
      "Bash(helm search *)", "Bash(helm history *)", "Bash(helm template *)",
      "Bash(helm repo list *)", "Bash(helm lint *)", "Bash(helm version *)", "Bash(helm env *)",
      "Bash(terraform plan *)", "Bash(terraform fmt *)", "Bash(terraform validate *)",
      "Bash(terraform output *)", "Bash(terraform state list *)", "Bash(terraform state show *)",
      "Bash(go build *)", "Bash(go test *)", "Bash(go vet *)", "Bash(go fmt *)", "Bash(go mod *)",
      "Bash(flux get *)", "Bash(flux logs *)", "Bash(flux tree *)",
      "Bash(grep)", "Bash(find *)", "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)",
      "Bash(wc *)", "Bash(file *)", "Bash(stat *)", "Bash(du *)", "Bash(df *)", "Bash(which *)",
      "Bash(whereis *)", "Bash(type *)", "Bash(tree *)", "Bash(diff *)", "Bash(sort *)",
      "Bash(uniq *)", "Bash(cut *)", "Bash(awk *)", "Bash(sed -n *)", "Bash(jq *)", "Bash(yq *)",
      "Bash(pwd)", "Bash(env)", "Bash(printenv *)", "Bash(uname *)", "Bash(id)", "Bash(whoami)",
      "Bash(date *)", "Bash(rg *)", "Bash(fd *)",
      "Bash(git status *)", "Bash(git log *)", "Bash(git diff *)", "Bash(git show *)",
      "Bash(git branch *)", "Bash(git tag *)", "Bash(git remote *)", "Bash(git stash list *)",
      "Bash(git shortlog *)", "Bash(git describe *)", "Bash(git rev-parse *)",
      "Bash(git rev-list *)", "Bash(git ls-files *)", "Bash(git ls-tree *)",
      "Bash(git cat-file *)", "Bash(git blame *)", "Bash(git config --list *)",
      "Bash(git config --get *)", "Bash(git reflog *)", "Bash(git cherry *)",
      "Bash(git worktree list *)"
    ],
    "deny": [
      "Bash(terraform apply *)",
      "Bash(terraform destroy *)"
    ],
    "defaultMode": "auto"
  },
  "model": "opus",
  "statusLine": {
    "type": "command",
    "command": "bash ~/.claude/statusline-command.sh"
  },
  "enabledPlugins": {
    "gopls-lsp@claude-plugins-official": true,
    "agent-sdk-dev@claude-plugins-official": true,
    "superpowers@claude-plugins-official": true,
    "huggingface-skills@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    "claude-md-management@claude-plugins-official": true,
    "claude-code-setup@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "code-review@claude-plugins-official": true,
    "github@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "commit-commands@claude-plugins-official": true,
    "security-guidance@claude-plugins-official": true,
    "pr-review-toolkit@claude-plugins-official": true,
    "plugin-dev@claude-plugins-official": true,
    "skill-creator@claude-plugins-official": true,
    "chrome-devtools-mcp@claude-plugins-official": true,
    "remember@claude-plugins-official": true,
    "hookify@claude-plugins-official": true,
    "greptile@claude-plugins-official": true,
    "semgrep@claude-plugins-official": false,
    "doc-driven-development@caderon-pack": true,
    "core@caderon-pack": true,
    "go@caderon-pack": true{{ if not .is_personal_machine }},
    "devops@caderon-pack": true{{ end }}
  },
  "extraKnownMarketplaces": {
    "caderon-pack": {
      "source": {
        "source": "github",
        "repo": "brent-hoover/caderon-pack"
      }
    }
  },
  "promptSuggestionEnabled": false,
  "skipDangerousModePermissionPrompt": true,
  "editorMode": "normal",
  "remoteControlAtStartup": true,
  "inputNeededNotifEnabled": true,
  "agentPushNotifEnabled": true,
  "skipAutoPermissionPrompt": true,
  "tui": "default"
}
```

- [ ] **Step 2: Delete the stale non-templated source**

```bash
cd /Users/brent/.local/share/chezmoi
git rm dot_claude/settings.json
```

- [ ] **Step 3: Verify the template renders valid JSON and the gate is correct**

Render with this machine's real data (personal → devops absent) and assert valid JSON:
```bash
cd /Users/brent/.local/share/chezmoi
chezmoi execute-template < dot_claude/settings.json.tmpl | jq -e '.enabledPlugins | (has("core@caderon-pack")) and (has("go@caderon-pack")) and (has("devops@caderon-pack")|not)'
```
Expected: `true` (valid JSON; core+go present, devops absent on this personal machine).

Prove the gate emits `devops` when the var is false (version-safe, no flags):
```bash
chezmoi execute-template '{{ if not .is_personal_machine }}devops-enabled{{ else }}devops-skipped{{ end }}'
chezmoi execute-template '{{ if not false }}devops-enabled{{ end }}'
```
Expected: first prints `devops-skipped` (this machine is personal); second prints `devops-enabled` (confirms the `not <false>` branch — i.e. a work machine — includes devops).

- [ ] **Step 4: Commit**

```bash
cd /Users/brent/.local/share/chezmoi
git add dot_claude/settings.json.tmpl
git commit -m "feat(claude): template settings.json — enable caderon-pack core/go always, devops on work machines"
```

---

## Task 7: Stop tracking Claude machine-state files

**Files:**
- Delete from source: `dot_claude/plugins/private_installed_plugins.json`, `dot_claude/plugins/modify_known_marketplaces.json.tmpl`, `dot_claude/modify_dot_claude.json.tmpl`
- Modify: `.chezmoiignore`

- [ ] **Step 1: Remove machine-state source files**

```bash
cd /Users/brent/.local/share/chezmoi
git rm dot_claude/plugins/private_installed_plugins.json \
       dot_claude/plugins/modify_known_marketplaces.json.tmpl \
       dot_claude/modify_dot_claude.json.tmpl
# remove the now-empty plugins source dir if nothing else remains
rmdir dot_claude/plugins 2>/dev/null || true
```

- [ ] **Step 2: Append Claude machine-state paths to `.chezmoiignore`**

Add to the end of `/Users/brent/.local/share/chezmoi/.chezmoiignore`:

```
# Claude Code machine-state — regenerated by Claude, never managed by chezmoi
.claude/plugins/installed_plugins.json
.claude/plugins/known_marketplaces.json
.claude/plugins/plugin-catalog-cache.json
.claude/plugins/blocklist.json
.claude/plugins/cache/**
.claude/plugins/marketplaces/**
.claude/plugins/data/**
# Skills now live in the caderon-pack marketplace, not chezmoi
.claude/skills/**
```

- [ ] **Step 3: Verify chezmoi no longer reports those paths as managed**

Run:
```bash
cd /Users/brent/.local/share/chezmoi
chezmoi managed | grep -E '\.claude/(skills|plugins/(installed_plugins|known_marketplaces|cache|marketplaces))' && echo "STILL MANAGED — FAIL" || echo "OK none managed"
```
Expected: `OK none managed`.

- [ ] **Step 4: Commit**

```bash
cd /Users/brent/.local/share/chezmoi
git add -A
git commit -m "chore(claude): stop tracking plugin machine-state; ignore regenerated files"
```

---

## Task 8: Remove vendored skills from chezmoi source

**Files:**
- Delete from source: `dot_claude/skills/**`

- [ ] **Step 1: Remove the skills tree from chezmoi source**

```bash
cd /Users/brent/.local/share/chezmoi
git rm -r dot_claude/skills
```

- [ ] **Step 2: Verify nothing under dot_claude/skills remains tracked**

Run:
```bash
cd /Users/brent/.local/share/chezmoi
git ls-files dot_claude/skills | wc -l
```
Expected: `0`.

- [ ] **Step 3: Commit**

```bash
cd /Users/brent/.local/share/chezmoi
git commit -m "chore(claude): remove vendored skills — now provided by caderon-pack plugins"
```

---

## Task 9: Apply config and verify caderon-pack plugins install

This applies the templated settings and confirms Claude picks up the new plugins **before** any standalone skills are deleted, so there is no window without the skills.

- [ ] **Step 1: Dry-run the apply to confirm only settings.json changes**

Run:
```bash
chezmoi diff ~/.claude/settings.json
```
Expected: a diff that adds `core@caderon-pack`/`go@caderon-pack`, switches the caderon-pack marketplace to a GitHub source, and removes any stale entries. No unexpected file changes.

- [ ] **Step 2: Apply**

```bash
chezmoi apply ~/.claude/settings.json
```

- [ ] **Step 3: Confirm the rendered live settings are correct**

Run:
```bash
jq '.enabledPlugins | {core: ."core@caderon-pack", go: ."go@caderon-pack", devops: ."devops@caderon-pack"}' ~/.claude/settings.json
jq '.extraKnownMarketplaces."caderon-pack".source' ~/.claude/settings.json
```
Expected: `core` and `go` are `true`, `devops` is `null` (personal machine); source is the GitHub `brent-hoover/caderon-pack`.

- [ ] **Step 4: Trigger plugin install and verify skills load**

Restart Claude Code (or start a new session) so it resolves the caderon-pack GitHub marketplace and installs the enabled plugins. Then verify:

```bash
ls ~/.claude/plugins/cache/caderon-pack/ 2>/dev/null
find ~/.claude/plugins/cache/caderon-pack/core -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l   # expect 13
find ~/.claude/plugins/cache/caderon-pack/go   -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l   # expect 4
```
Expected: `core` and `go` directories exist under the cache; `13` and `4` SKILL.md files. In-session, `/plugin` lists `core@caderon-pack` and `go@caderon-pack` as enabled, and the `core`/`go` skills appear in the available-skills list. **Do not proceed to Task 10 until this passes** — it is the safety gate.

---

## Task 10: Delete the standalone skills and the stray symlink

Only after Task 9 confirms the plugin-provided skills load.

**Files:**
- Delete: 9 skill dirs + 1 symlink under `/Users/brent/.claude/skills/`

- [ ] **Step 1: Snapshot what will be deleted (sanity check)**

Run:
```bash
cd /Users/brent/.claude/skills
for s in agent-development hook-development mcp-integration plugin-structure \
         frontend-design skill-adapter kubernetes-secrets-manager template \
         git-advanced-workflows find-skills; do
  if [ -e "$s" ] || [ -L "$s" ]; then echo "will delete: $s"; else echo "MISSING: $s"; fi
done
```
Expected: 10 `will delete:` lines, no `MISSING:`.

- [ ] **Step 2: Delete the duplicates, junk, and symlink**

```bash
cd /Users/brent/.claude/skills
rm -rf agent-development hook-development mcp-integration plugin-structure \
       frontend-design skill-adapter kubernetes-secrets-manager template \
       git-advanced-workflows
rm -f find-skills        # symlink
```

- [ ] **Step 3: Verify the remaining standalone skills are exactly the 21 now-vendored ones (they are duplicated by plugins but harmless to leave, or optionally remove)**

Run:
```bash
ls /Users/brent/.claude/skills | wc -l    # expect 21
ls /Users/brent/.claude/skills | grep -E '^(agent-development|hook-development|mcp-integration|plugin-structure|frontend-design|skill-adapter|kubernetes-secrets-manager|template|git-advanced-workflows|find-skills)$' && echo "LEFTOVER — FAIL" || echo "OK clean"
```
Expected: `21`, then `OK clean`.

- [ ] **Step 4 (optional): Remove the now-redundant local copies of the vendored skills**

The 21 remaining dirs are now served by the caderon-pack plugins, so the loose copies under `~/.claude/skills/` are redundant. Remove them to fully eliminate duplication:

```bash
cd /Users/brent/.claude/skills
rm -rf roborev-design-review roborev-design-review-branch roborev-fix roborev-refine \
       roborev-respond roborev-review roborev-review-branch explain-code \
       conventional-commit codebase-visualizer code-quality git-master vue-typescript \
       go-backend-workflow go-concurrency-patterns go-error-handling go-interfaces \
       helm-debugging helm-values-management k8s-manifest-generator k8s-security-policies
ls /Users/brent/.claude/skills | wc -l    # expect 0
```
Expected: `0`. Confirm in a new Claude session that the `core`/`go` skills still appear (now only from the plugin). **Defer this step until after a session restart confirms plugin skills load**, so you never lose access mid-flight.

---

## Task 11: Final verification

- [ ] **Step 1: Confirm per-machine behavior on this (personal) machine**

Run:
```bash
jq -r '.enabledPlugins | to_entries[] | select(.key|test("caderon-pack")) | "\(.key)=\(.value)"' ~/.claude/settings.json
```
Expected: `doc-driven-development@caderon-pack=true`, `core@caderon-pack=true`, `go@caderon-pack=true`; **no** `devops` line.

- [ ] **Step 2: Confirm chezmoi is clean**

Run:
```bash
cd /Users/brent/.local/share/chezmoi
git status --short
chezmoi managed | grep -c '.claude/skills' || true   # expect 0
```
Expected: clean working tree (all committed); `0`.

- [ ] **Step 3: Confirm caderon-pack is pushed and consistent**

Run:
```bash
cd /Users/brent/Projects/personal/caderon-pack
git status --short          # expect clean
git log --oneline -6
jq '.plugins|length' .claude-plugin/marketplace.json   # expect 4
```
Expected: clean tree; 4 plugins; commits for core/go/devops/marketplace present.

- [ ] **Step 4: Document the work-machine bootstrap (one line in caderon-pack README)**

Add to `caderon-pack/README.md` under a "Machine profiles" note:

> On a work machine, set `is_personal_machine: false` in `~/.config/chezmoi/chezmoi.yaml` before `chezmoi apply`; this enables the `devops` plugin in addition to `core` and `go`.

Commit:
```bash
cd /Users/brent/Projects/personal/caderon-pack
git add README.md
git commit -m "docs: note work-machine profile bootstrap"
git push
```

---

## Notes / decisions baked in
- **GitHub marketplace source** for caderon-pack (not the local directory) so any machine resolves it. On the dev machine, if you want live local edits picked up without pushing, add a directory-source override for `caderon-pack` in `~/.claude/settings.local.json` (untracked, machine-local).
- **`is_personal_machine`** is the existing chezmoi data var; `devops` is gated on `not .is_personal_machine`. No new var introduced.
- **`.mcp.json` per-machine templating** is intentionally out of scope (see spec).
- Skill deletion (Tasks 10) happens only after plugin install is verified (Task 9), so there is never a window without the skills.
