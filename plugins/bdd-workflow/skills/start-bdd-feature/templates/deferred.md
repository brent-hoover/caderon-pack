---
title: <Feature Name> — Deferred Work
type: notes
status: active
owner: <username>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# <Feature Name> — Deferred Work

Living catalog of work deferred during implementation — nice-to-haves, edge cases, and anything
descoped to ship sooner. Append to it as you go. At `/close-bdd-feature` every item is resolved:
done now, kept deferred, or permanently dropped (left as a TODO in code).

## Deferred items

### <Item name>

**What:** <The work that was deferred. Concrete enough to act on later.>

**Why deferred:** <Specific reason — nice-to-have, blocked by X, descoped to ship sooner,
over-engineered for current needs.>

**Impact:** <Critical / nice-to-have / safe to drop?>

**Status:** Deferred
<!-- Resolved at close to one of: Done at close · Kept deferred · Permanently dropped -->

**Revisit when:** <Condition or date. "Never — permanently dropped" is valid.>

**Tracked as:** <If permanently dropped, the code TODO that now carries it — e.g.
`TODO(<slug>): …` in path/to/file. Otherwise "—".>

---

## Change log

- YYYY-MM-DD: Initial draft (<username>)
