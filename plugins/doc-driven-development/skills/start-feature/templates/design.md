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

## Summary

<One paragraph. What is the proposed approach? Someone reading only this section should know
roughly what we're going to build.>

## Approach

<The chosen design, in enough detail to implement against. Cover only the components that matter —
their responsibilities and how they interact. Diagrams welcome.>

## Interfaces

<External-facing APIs, CLI surfaces, file formats, wire protocols. Changes to these are
expensive later, so pin them down now.>

## Data model

<If there's persistent state or structured data, describe its shape. Skip if none.>

## Alternatives considered

<Three solutions across the effort/investment spectrum, so the trade-off is explicit. If two of
them genuinely coincide, say so rather than inventing a difference.>

### Simplest

<The dumbest thing that technically works — least mechanism, fewest moving parts, fastest to ship.
State its **drawbacks honestly**: limitations, tech debt incurred, what it punts on.>

### Complete

<The solution we'd be comfortable owning long-term: handles the relevant complexity drivers
properly and adds no notable tech debt, while staying within realistic time/cost.>

### Optimal

<How we'd solve it with no time or cost constraints — the ideal. Names what we trade away by not
doing this now; doubles as future direction.>

### Decision

<Which solution (or a hybrid) we're choosing, and where it lands on the spectrum. Justify both
directions: which complexity drivers push us above Simplest, and which constraints keep us below
Optimal.>

## Risks

<What could go wrong? What assumptions, if invalidated, break this design?>

-
-

## Out of scope

<What this design does NOT address, even though it might seem related.>

-
-

## Open questions

<Design-level questions still unresolved. Blocking questions must be answered before
implementation starts.>

- [ ]

## Change log

- YYYY-MM-DD: Initial draft (<username>)
