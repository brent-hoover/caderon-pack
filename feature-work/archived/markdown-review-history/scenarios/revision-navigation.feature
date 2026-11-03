# scenarios/revision-navigation.feature
# Maps to: plan.md Step 9

Feature: Navigating revisions and diffs in the viewer
  As the operator reviewing a doc over several rounds
  I choose what to compare and can read the clean revised doc so that I review exactly what I need

  Background:
    Given "plan.md" has revisions 1, 2 and 3 in the open review session

  Scenario: A newly revised doc opens in diff view against the previous revision
    Given the operator last viewed revision 2 of "plan.md"
    And the agent then revised "plan.md" to revision 3
    When the operator opens "plan.md"
    Then the viewer shows the diff from revision 2 to revision 3
    And the header shows "Revision 3 of 3"

  Scenario: The operator switches from the diff to the full revised doc
    Given the viewer shows the diff from revision 2 to revision 3
    When the operator clicks "Full document"
    Then the viewer shows revision 3 rendered with no change marking

  Scenario: The operator switches from the full revised doc back to the diff
    Given the viewer shows revision 3 as the full document after viewing the diff from revision 2
    When the operator clicks "Show changes"
    Then the viewer shows the diff from revision 2 to revision 3

  Scenario: The operator compares any two revisions
    When the operator chooses revision 1 as the base and revision 3 as the target
    Then the viewer shows the diff from revision 1 to revision 3

  Scenario: The operator views changes since their approval
    Given the operator approved revision 1 of "plan.md"
    When the operator clicks "Changes since approved"
    Then the viewer shows the diff from revision 1 to revision 3

  Scenario: A doc with only one revision has no diff
    Given "intro.md" has only revision 1
    When the operator opens "intro.md"
    Then the viewer shows revision 1 with no change marking
    And the "Show changes" control is disabled

  Scenario: Choosing a base revision newer than the target is rejected
    When the operator chooses revision 3 as the base and revision 1 as the target
    Then the viewer keeps the previous comparison
    And it shows the message "Base revision must be older than the target"
