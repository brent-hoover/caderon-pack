---
title: <Feature Name> — Problem Statement
type: problem
status: draft
owner: <username>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Feature Name> — Problem Statement

<!-- THIS DOC ANSWERS: what's wrong and why it matters to the user.
     KEEP OUT: solutions (→ design.md) and build steps (→ plan.md). State only what's true today. -->

## User Story (must fill out first)
As a: <!-- who is the user who is having a problem -->

I want to: <!-- What is the functionality that the user wants? -->

So that I can: <!-- If this problem was solved, what would the user be able to achieve -->


## Context

<!-- ≤ 2 paragraphs. What's the current situation? What's in place today, and what's prompting this
work? Orient someone who's never seen this problem before. -->

## Problem

<!-- ≤ 1 short paragraph. What specifically is wrong, missing, or needed? Be concrete. Keep solutions
out entirely — no "we should…", no "simplest approach". That's the design doc's job. State only
what's true today and what's required. -->

## Complexity drivers

<!-- What about this problem makes it non-trivial? State each as a **fact about the problem or a hard
requirement** — never as a solution. The design doc uses these to decide how far beyond the
simplest solution to go; here we only record what's true. Mark non-applicable ones "N/A — <why>" rather than skipping —
silence is indistinguishable from "we didn't think about it." -->

- **Scale**: <!-- does it grow non-linearly with users, data volume, or load? If not: "N/A — bounded by <thing>". -->
- **Concurrency**: <!-- are multiple writers or race conditions inherent to the problem? If not: "N/A — single-writer / serialized". -->
- **Failure modes**: <!-- what is the real-world consequence if this goes wrong? If minimal: "N/A — fail-loud, no data loss". -->
- **Cross-cutting policies**: <!-- does the data/context involve PII, auth, secrets, audit, observability obligations? If none: "N/A — touches none". -->
- **Existing Data or Systems**: Are there any existing data or systems that are relevant to this problem?

## Constraints

<!-- ≤ 1 para or a short list. What are we operating under that constrains any solution? Time, money,
access, personnel? -->


## Success criteria

<!-- ≤ 1 para or a short list. How will we know the work is done and the problem is solved? Make each
one observable. -->

## Open questions

<!-- Questions blocking *design* from starting. (Design-level questions go in design.md.) -->

- [ ]

## Change log

- YYYY-MM-DD: Initial draft (brent-hoover)
