---
title: <Feature Name> — Implementation Plan
type: plan
status: draft
owner: <username>
created: YYYY-MM-DD
updated: YYYY-MM-DD
design: ./design.md
---

# <Feature Name> — Implementation Plan

## Overview

<One paragraph. What are we implementing, in what order, and why that order. This doc is
throwaway — it exists to coordinate the work, not to document the system.>

## Preconditions

<What must be true before we start? Approved design, approved scenarios, filled scope.md,
resolved open questions, dependencies.>

- [ ] `design.md` approved
- [ ] All `.feature` files in `scenarios/` approved
- [ ] `scope.md` filled with objective, allowlist, and non-goals
- [ ]

## Steps

<Ordered list. Each step should be small enough to fit in one PR or one session. Every step must
name the scenarios that pass when it completes — implementation is done when all scenarios pass.>

### 1. <Step name>

**What:** <Concrete change — files touched, behavior added/modified.>

**Why:** <What this step unblocks or achieves.>

**Scenarios:** `scenarios/<file>.feature` — "<Scenario name(s)>"

**Verify:** `<pytest scenarios/<file>.feature -k "<scenario>" OR godog ./scenarios/<file>.feature>`
Expected: exit 0, N scenario(s) passed

### 2. <Step name>

**What:**

**Why:**

**Scenarios:** `scenarios/<file>.feature` — "<Scenario name(s)>"

**Verify:**

## Scenario coverage

<Confirm every scenario in `scenarios/` is addressed by at least one step above. Flag any gap.>

| Feature file | Scenario | Covered by step |
|---|---|---|
| `scenarios/<file>.feature` | `<Scenario name>` | Step N |

## Rollback

<If this goes sideways mid-way, how do we get back to a safe state?>

## Out of scope for this plan

<Things we explicitly are NOT doing as part of this work.>

-
-

## Change log

- YYYY-MM-DD: Initial draft (<username>)
