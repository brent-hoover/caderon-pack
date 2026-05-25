---
title: <Feature Name> — Problem Statement
type: problem
status: draft
owner: <username>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Feature Name> — Problem Statement

## Context

<What's the current situation? What's in place today, and what's prompting this work? One or two
paragraphs. Orient someone who's never seen this problem before.>

## Problem

<What specifically is wrong, missing, or needed? Be concrete. Avoid proposing solutions here —
that's the design doc's job.>

## Simplest possible solution

<Before considering complications, what's the most obvious, dumbest thing that would solve the
problem as stated? Not the elegant answer; the *simplest* answer. This section exists to catch
over-engineering at the source.>

## Complications considered

<For each complication, state: does it actually apply, and if so, what does it force? Mark
non-applicable ones "N/A: <why>" rather than skipping — silence is indistinguishable from
"we didn't think about it.">

- **Scale**: <grows non-linearly with users, data volume, or load? If not: "N/A — bounded by <thing>".>
- **Concurrency**: <multiple writers or race conditions? If not: "N/A — single-writer / serialized".>
- **Failure modes**: <what breaks if the simplest solution fails? If trivially handled: "N/A — fail-loud".>
- **Cross-cutting policies**: <PII, auth, secrets, audit, observability? If none: "N/A — touches none".>

## Constraints

<What are we operating under that constrains any solution?>

-
-

## Requirements

<The "must be true" statements. Prefer observable, checkable statements.>

-
-

## Non-goals

<What is explicitly OUT of scope?>

-
-

## Success criteria

<How will we know the work is done and the problem is solved?>

-
-

## Open questions

<Things that need answers before design can start.>

- [ ]

## Change log

- YYYY-MM-DD: Initial draft (<username>)
