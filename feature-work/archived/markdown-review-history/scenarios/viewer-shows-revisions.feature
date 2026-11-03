# scenarios/viewer-shows-revisions.feature
# Maps to: plan.md Step 3

Feature: The viewer shows only revised content
  As the operator reviewing docs
  I see a doc change only when the agent revises it so that I never review a half-edited doc

  Background:
    Given a live review session
    And "plan.md" has been served as revision 1 with content "# Plan\n\nFirst draft.\n"
    And the operator's browser is connected

  Scenario: A revise pushes the new revision to the browser
    Given the agent has changed "plan.md" to "# Plan\n\nSecond draft.\n"
    When the agent runs revise on "plan.md"
    Then the browser receives a revision notice for "plan.md" with revision 2 within 2 seconds
    And GET /doc for "plan.md" returns "# Plan\n\nSecond draft.\n"

  Scenario: Editing the file without revising changes nothing the operator sees
    When the agent writes "# Plan\n\nHalf-done edit" to "plan.md" without revising
    Then the browser receives no notice for "plan.md" within 3 seconds
    And GET /doc for "plan.md" still returns "# Plan\n\nFirst draft.\n"

  Scenario: History survives a server restart
    Given "plan.md" has revisions 1 and 2
    When the server is stopped and started again with the same project dir
    And the agent serves "plan.md" in the new session
    Then GET /revisions for "plan.md" lists revisions 1 and 2
    And no revision 3 is recorded

  Scenario: A doc whose history directory was deleted is reported, not silently re-created
    Given "plan.md" has revisions 1 and 2
    And the operator deletes ".revisions/plan.md/" while the server runs
    When the browser requests GET /doc for "plan.md"
    Then the response is 404 with a message that names "plan.md" and says it has no revisions
