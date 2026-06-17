# features/<behavior-slug>.feature
# Maps to: plan.md Step N  ·  contract.md Part C row N
# Scenario names below are copied verbatim into contract.md and plan.md.
#
# Gherkin rules:
#   Given  — pre-existing state (never an action)
#   When   — the single action under test
#   Then   — observable outcome (never implementation details)
#   And    — continuation of the previous Given/When/Then (use sparingly)
#
# Each feature file must have: one happy path, one edge case, one failure case.

Feature: <behavior description>
  As <role>
  I <goal> so that <benefit>

  Background:
    Given <precondition that applies to all scenarios in this file>

  Scenario: <happy path — full success flow>
    Given <specific state>
    When <specific action>
    Then <specific observable outcome>
    And <additional assertion if needed>

  Scenario: <edge case — boundary or alternate flow>
    Given <specific state>
    When <specific action at a boundary>
    Then <specific outcome>

  Scenario: <failure case — rejection or error path>
    Given <specific state>
    When <action that should fail>
    Then <specific rejection or error observable>
