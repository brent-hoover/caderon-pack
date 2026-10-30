# scenarios/rich-diff.feature
# Maps to: plan.md Step TBD

Feature: Rich diff between two revisions
  As the operator re-reviewing a revised doc
  I see the rendered doc with changes marked in place so that I don't re-read unchanged parts

  Scenario: A changed word inside a paragraph is marked inline
    Given revision 1 has the paragraph "The cache expires after 30 seconds."
    And revision 2 has the paragraph "The cache expires after 60 seconds."
    When the operator views the diff from revision 1 to revision 2
    Then the paragraph is rendered once
    And "30" is shown as removed and "60" is shown as added
    And the rest of the paragraph has no change marking

  Scenario: A new section is shown as added
    Given revision 2 adds a "## Risks" heading and the paragraph "Polling may miss writes." after the last section of revision 1
    When the operator views the diff from revision 1 to revision 2
    Then the "Risks" heading and its paragraph are shown as added
    And every block from revision 1 is shown unchanged

  Scenario: A removed paragraph is still shown, marked as removed
    Given revision 1 has the paragraph "Legacy mode is supported."
    And revision 2 does not contain that paragraph
    When the operator views the diff from revision 1 to revision 2
    Then "Legacy mode is supported." is shown as removed at its old position

  Scenario: One changed list item is marked without marking its siblings
    Given revision 1 has the list "- alpha", "- beta", "- gamma"
    And revision 2 has the list "- alpha", "- beta two", "- gamma"
    When the operator views the diff from revision 1 to revision 2
    Then only the "beta" item shows a change, with "two" shown as added
    And "alpha" and "gamma" have no change marking

  Scenario: One changed table cell is marked without marking the rest of the table
    Given revision 1 has a table row "| retries | 3 |"
    And revision 2 has that row as "| retries | 5 |"
    When the operator views the diff from revision 1 to revision 2
    Then only that cell shows "3" removed and "5" added

  Scenario: A Gherkin step change is marked inside its scenario
    Given revision 1 of "login.feature" has the step "Then the user sees the dashboard"
    And revision 2 has that step as "Then the user sees the welcome page"
    When the operator views the diff from revision 1 to revision 2
    Then that scenario block shows "dashboard" removed and "welcome page" added
    And other scenarios have no change marking

  Scenario: A plain-text doc shows changed lines
    Given revision 1 of "notes.txt" has the line "port = 8080"
    And revision 2 has that line as "port = 9090"
    When the operator views the diff from revision 1 to revision 2
    Then that line shows "8080" removed and "9090" added

  Scenario: Identical revisions show no change marking
    Given revisions 1 and 2 of "plan.md" have identical content
    When the operator views the diff from revision 1 to revision 2
    Then no block has change marking
    And the header says there are no changes between the two revisions

  Scenario: A code fence change is marked per line
    Given revision 1 has a code fence with the lines "a = 1" and "b = 2"
    And revision 2 has that code fence with the lines "a = 1" and "b = 3"
    When the operator views the diff from revision 1 to revision 2
    Then only the "b" line shows a change
