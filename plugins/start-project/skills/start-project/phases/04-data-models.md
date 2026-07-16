# Phase 4: Data models

**[PHASE: DATA MODELS] (4/7)**

Context to read: the approved `docs/vision.md`, `docs/architecture.md`, and
`docs/arch-rules.yaml`.

1. Propose the core entity list derived from the vision (nouns in the
   problem statement) — for each: proposed module assignment, key fields,
   invariants. Ask: "Right entities? Anything missing or overmodeled?"
   Wait for the user's answer before continuing.
2. Iterate on the user's feedback — apply it, re-present, ask again — until
   the user is happy. Wait for an answer after each round. Keep YAGNI
   pressure — verbatim note: "Model what v1 stories will touch; a field no
   story reads gets cut."
3. Every entity must be assigned to a module that exists in
   `arch-rules.yaml`. Include a Mermaid `erDiagram` capturing entity
   relationships.

Draft `docs/data-models.md` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/data-models.md`, fully
populated from the entities above, `status: draft`.

Run the hub's **Review step** (reviewer: `start-project:data-models-reviewer`).

Run the hub's **Present step**, asking: "Does data-models.md look right? Any
changes?"

Run the hub's **Approval gate**.
