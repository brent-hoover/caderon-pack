# Phase 5: Stories

**[PHASE: STORIES] (5/7)**

Context to read: the approved `docs/vision.md` (success criteria drive
must-haves) and `docs/data-models.md` (criteria reference real entities and
fields).

1. Propose 3–6 epics, drawn from the vision's major components / user
   goals. Ask: "Right epics? Anything missing or overscoped?" Wait for the
   user's answer before continuing.
2. Per epic, draft stories with Given/When/Then acceptance criteria and a
   must/should/could priority. Present one epic at a time; apply feedback,
   re-present, ask again — until the user is happy — before moving to the
   next epic. Wait for an answer after each round.

Format rules, verbatim in the file:

```markdown
- Exactly the template shape: `## Epic:` / `### Story:` / "As a … I want
  … so that …" / `**Acceptance criteria:**` Given/When/Then bullets /
  `**Priority:**`. The scaffold phase parses these headings to generate
  .feature files — a story that breaks the shape breaks scaffolding.
- Criteria name real entities and fields from data-models.md.
- Every vision success criterion must be covered by at least one `must`
  story (the stories-reviewer checks this).
```

Draft `docs/STORIES.md` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/stories.md`, fully
populated from the epics and stories above, `status: draft`.

Run the hub's **Review step** (reviewer: `start-project:stories-reviewer`).

Run the hub's **Present step**, asking: "Does STORIES.md look right? Any
changes?"

Run the hub's **Approval gate**.
