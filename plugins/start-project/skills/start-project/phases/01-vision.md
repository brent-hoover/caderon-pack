# Phase 1: Vision

**[PHASE: VISION] (1/7)**

Context to read: none — this is the first phase.

Ask the following questions one at a time, in order. Wait for the user's
answer before asking the next one:

```markdown
1. "What's the product's name (human-readable) — and in one or two
   sentences, what is it?"
2. "Who uses it? What do they do today instead, and what's wrong with that?"
3. "System shape: how does it get delivered — CLI, web service, library,
   TUI, background worker? Monolith or distributed? Roughly what major
   components do you picture?"
4. "How will you know v1 is working — what are the success criteria?"
5. "What's explicitly out of scope for v1?"
```

**No technology in vision.md.** If the user names a language, framework, or
database, acknowledge it, note it for the stack phase, and keep vision.md
technology-free. The vision-reviewer rejects tech choices here.

Draft `docs/vision.md` from
`${CLAUDE_PLUGIN_ROOT}/skills/start-project/templates/vision.md`, fully
populated from the answers above, `status: draft`. The System shape answer
(question 3) is what phases 02 and 03 will read back.

Run the hub's **Review step** (reviewer: `start-project:vision-reviewer`).

Run the hub's **Present step**, asking: "Does this vision.md look right? Any
changes?"

Run the hub's **Approval gate**.
