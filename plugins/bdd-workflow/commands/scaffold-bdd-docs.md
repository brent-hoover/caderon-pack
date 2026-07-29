---
name: scaffold-bdd-docs
description: Copy the start-bdd-feature doc templates into feature-work/_templates and the flow README into feature-work/
allowed-tools: Bash, Read
---

Set up a project's `feature-work/` directory without running the full workflow: the flow `README.md`
at the root, the blank doc templates in `_templates/`.

## Steps

**1. Check what's already there:**

```bash
ls feature-work feature-work/_templates 2>/dev/null || echo "not present"
```

**2. Copy the README and templates** (the set includes `scope.md`, `stories.md`, and the
`story.feature` Gherkin starter):

```bash
TPL="${CLAUDE_PLUGIN_ROOT}/skills/start-bdd-feature/templates"
mkdir -p feature-work/_templates
cp -n "$TPL/README.md" feature-work/README.md
for f in "$TPL"/*.md "$TPL"/story.feature; do
  case "$(basename "$f")" in README.md) continue;; esac
  cp -n "$f" feature-work/_templates/
done
```

`README.md` describes the doc flow to humans, so it lands at `feature-work/README.md` — not inside
`_templates/`.

**3. Handle collisions.** `cp -n` never clobbers. If step 1 showed existing files, name the ones
that were skipped and ask the user whether to overwrite them. Only on an explicit yes, rerun the
same block with `cp` in place of `cp -n`.

**4. Report:**

```bash
ls -1 feature-work feature-work/_templates
```

Print the resulting file list, and name anything that was skipped as already-present.

Do not commit — leave the copies for the user to review.
