# Phase 6: Plan

**[PHASE: PLAN] (6/7)**

Context to read: the approved `docs/STORIES.md` and `docs/architecture.md`.

1. Propose ordered slices. Slice 1 is the thinnest end-to-end walking skeleton.
   Every `must` story lands in some slice; `could` stories may sit together
   in a final "later" slice. Each slice: its stories (titles only from
   STORIES.md — don't restate criteria), a why-now, and a Verify line — a
   runnable command or observable check proving the slice works. Ask:
   "Right slices, right order?" Wait for the user's answer before
   continuing.
2. Iterate on the user's feedback — apply it, re-present, ask again — until
   the user is happy. Wait for an answer after each round.

Draft `docs/PLAN.md` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/plan.md`, fully
populated from the slices above, `status: draft`.

Run the hub's **Review step** (reviewer: `start-project:plan-reviewer`).

Run the hub's **Present step**, asking: "Does PLAN.md look right? Any
changes?"

Run the hub's **Approval gate**.
