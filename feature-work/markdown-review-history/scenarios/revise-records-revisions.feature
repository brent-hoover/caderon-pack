# scenarios/revise-records-revisions.feature
# Maps to: plan.md Step 2

Feature: The agent records reviewable revisions of a doc
  As the agent authoring docs for review
  I record a revision when a round of edits is ready so that the operator reviews a fixed, complete version

  Background:
    Given a live review session
    And a doc "feature-work/demo/plan.md" containing "# Plan\n\nFirst draft.\n"

  Scenario: Serving a doc for review records it as revision 1
    When the agent runs serve-doc on "feature-work/demo/plan.md"
    Then "feature-work/demo/.revisions/plan.md/0001.rev" contains "# Plan\n\nFirst draft.\n"
    And "feature-work/demo/.revisions/plan.md/index.jsonl" has 1 line with revision 1 and the SHA-256 of that content

  Scenario: Revising changed content records the next revision
    Given "feature-work/demo/plan.md" has been served as revision 1
    And the agent has changed the doc to "# Plan\n\nSecond draft.\n"
    When the agent runs revise on "feature-work/demo/plan.md"
    Then "feature-work/demo/.revisions/plan.md/0002.rev" contains "# Plan\n\nSecond draft.\n"
    And revise prints a "revised" result with revision 2

  Scenario: Revising unchanged content records nothing
    Given "feature-work/demo/plan.md" has been served as revision 1
    When the agent runs revise on "feature-work/demo/plan.md" without changing it
    Then the index still has 1 line
    And revise prints an "unchanged" result with revision 1

  Scenario: Serving an already-served doc again does not add a revision
    Given "feature-work/demo/plan.md" has been served as revision 1
    When the agent runs serve-doc on "feature-work/demo/plan.md" again
    Then the index still has 1 line

  Scenario: Revising a doc that was never served is rejected
    Given "feature-work/demo/other.md" exists but is not in the session manifest
    When the agent runs revise on "feature-work/demo/other.md"
    Then revise exits with code 1
    And stderr names "other.md" and says to serve it with serve-doc first
    And no ".revisions/other.md" directory exists

  Scenario: Revising a missing file is rejected
    Given "feature-work/demo/plan.md" has been served as revision 1
    And the doc file has been deleted
    When the agent runs revise on "feature-work/demo/plan.md"
    Then revise exits with code 1
    And stderr names the missing path
    And the index still has 1 line
