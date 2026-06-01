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

<What specifically is wrong, missing, or needed? Be concrete. Keep solutions out entirely — no
"we should…", no "simplest approach". That's the design doc's job. State only what's true today and
what's required.>

## Complexity drivers

<What about this problem makes it non-trivial? State each as a **fact about the problem or a hard
requirement** — never as a solution. The design doc uses these to decide how far beyond the
simplest solution to go; here we only record what's true. Mark non-applicable ones "N/A — <why>" rather than skipping —
silence is indistinguishable from "we didn't think about it.">

- **Scale**: <does it grow non-linearly with users, data volume, or load? If not: "N/A — bounded by <thing>".>
- **Concurrency**: <are multiple writers or race conditions inherent to the problem? If not: "N/A — single-writer / serialized".>
- **Failure modes**: <what is the real-world consequence if this goes wrong? If minimal: "N/A — fail-loud, no data loss".>
- **Cross-cutting policies**: <does the data/context involve PII, auth, secrets, audit, observability obligations? If none: "N/A — touches none".>

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
