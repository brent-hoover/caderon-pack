---
name: close-bdd-feature
description: Wrap up a feature — revisit deferred work, write the completion record, and archive the docs
argument-hint: Optional feature slug (e.g. user-auth, billing-export)
---

Invoke the `bdd-workflow:close-bdd-feature` skill and follow it exactly:
REVISIT DEFERRED → COMPLETE → MUTATION TESTING → ARCHIVE.

ARCHIVE moves only the feature docs. It never moves or edits `.feature` files, step definitions,
or other tests, refuses to archive when anything outside the doc root references the doc dir, and
re-runs the suites against a pre-archive baseline.
