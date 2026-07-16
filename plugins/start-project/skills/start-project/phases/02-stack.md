# Phase 2: Stack

**[PHASE: STACK] (2/7)**

Context to read: the approved `docs/vision.md` — especially its System
shape section.

For each of the five dimensions below, **propose a recommendation first**
(grounded in the system shape from vision.md, plus anything the user
pre-named during the vision phase), with 1–2 alternatives and why not, then
ask "agree, or different choice?" One dimension per message, in order.
Wait for the user's decision on each dimension before presenting the next:

1. Language
2. Framework
3. Storage
4. Packaging & tooling
5. Deployment target

Verbatim notes to apply while running this flow:

```markdown
- If the language question is genuinely open ("Go or Python?"), treat it as
  an alternatives-considered discussion right here — never reorder phases.
- Scaffolding (phase 7) supports python and go. Any other language is
  allowed but scaffold stops at docs + rules file with a note.
- Set `language:` in stack.md frontmatter to the decided value — phase 7
  reads it.
- Defaults to prefer when the user has no opinion, per their profile:
  Python → uv, ruff, pytest, Pydantic V2, FastAPI for web APIs.
```

Draft `docs/stack.md` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/stack.md`, fully
populated from the five decisions above, `status: draft`, frontmatter
`language:` set to the lowercase enum value phase 7 dispatches on —
exactly `python`, `go`, or `other` (a decision of "Python 3.12" →
`python`; anything outside the enum → `other`).

Run the hub's **Review step** (reviewer: `start-project:stack-reviewer`).

Run the hub's **Present step**, asking: "Does this stack.md look right? Any
changes?"

Run the hub's **Approval gate**.
