---
title: <Feature Name> — Design
type: design
status: draft
owner: <username>
created: YYYY-MM-DD
updated: YYYY-MM-DD
problem: ./problem.md
---

# <Feature Name> — Design

<!-- THIS DOC ANSWERS: how we solve it — approach, interfaces, alternatives, scope.
     KEEP OUT: restating the problem (link problem.md instead) and ordered build steps (→ plan.md). -->

## Summary

<!-- ≤ 1 paragraph. The chosen approach in a nutshell — enough that someone reading only this knows
roughly what we're building. (Not the problem; not the step order — that's plan.md's Overview.) -->

## Approach

<!-- The chosen design, in enough detail to implement against. Cover only the components that matter —
their responsibilities and how they interact. Diagrams welcome. -->

## Interfaces

<!-- External-facing APIs, CLI surfaces, file formats, wire protocols. Changes to these are
expensive later, so pin them down now. -->

## Data model

<!-- If there's persistent state or structured data, describe its shape. Omit the section if none. -->

## Alternatives considered

<!-- Three solutions across the effort/investment spectrum, so the trade-off is explicit. ≤ 2-3
sentences each. If two of them genuinely coincide, say so rather than inventing a difference. -->

### Simplest

<!-- The dumbest thing that technically works — least mechanism, fewest moving parts, fastest to
ship. State its **drawbacks honestly**: limitations, tech debt incurred, what it punts on. -->

### Complete

<!-- The solution we'd be comfortable owning long-term: handles the relevant complexity drivers
properly and adds no notable tech debt, while staying within realistic time/cost. -->

### Optimal

<!-- How we'd solve it with no time or cost constraints — the ideal. Names what we trade away by not
doing this now; doubles as future direction. -->

### Decision

<!-- ≤ 1 para. Which solution (or a hybrid) we're choosing, and where it lands on the spectrum.
Justify both directions: which complexity drivers push us above Simplest, and which constraints keep
us below Optimal. -->

## Risks

<!-- What could go wrong? What assumptions, if invalidated, break this design? -->

-
-

## Out of scope

<!-- The single home for scope boundaries in this feature (problem.md and plan.md don't repeat them).
What this feature does NOT address, even though it might seem related. -->

-
-

## Open questions

<!-- Questions blocking *implementation* from starting. Must be resolved before plan.md executes. -->

- [ ]

## Change log

- YYYY-MM-DD: Initial draft (<username>)
