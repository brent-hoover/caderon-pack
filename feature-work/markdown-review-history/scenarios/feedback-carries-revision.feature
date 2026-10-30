# scenarios/feedback-carries-revision.feature
# Maps to: plan.md Step TBD

Feature: Operator feedback names the revision it applies to
  As the agent acting on review feedback
  I know which revision each comment and approval refers to so that I never treat a stale approval as current

  Background:
    Given a live review session where "plan.md" has revisions 1 and 2

  Scenario: An approval records the revision it approves
    Given the operator is viewing revision 2 of "plan.md"
    When the operator clicks Approve
    Then the events file gains an approve event for "plan.md" with "revision": 2
    And the watcher prints that event and exits 0

  Scenario: A comment records the revision it was made on
    Given the operator is viewing revision 2 of "plan.md"
    When the operator comments "clarify" on a paragraph and clicks Submit comments
    Then the delivered comment event has "revision": 2
    And it keeps the existing fields "view", "blockIndex", "quote" and "selection"

  Scenario: An approval of an older revision is marked stale after a revise
    Given the operator approved revision 2 of "plan.md"
    When the agent revises "plan.md" to revision 3
    Then the sidebar no longer shows "plan.md" as approved
    And the header offers "Changes since approved (rev 2)"

  Scenario: Approving while viewing an older revision is not allowed
    Given the operator is viewing revision 1 of "plan.md" while revision 2 is the latest
    When the operator looks at the Approve button
    Then the Approve button is disabled with the hint "Approve the latest revision"
