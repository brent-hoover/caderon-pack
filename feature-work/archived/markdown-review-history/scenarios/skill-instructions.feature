# scenarios/skill-instructions.feature
# Maps to: plan.md Step 11

Feature: SKILL.md teaches the revise loop
  As an agent that only reads SKILL.md
  I revise docs at the right moments so that the operator gets reviewable revisions without extra instructions

  Scenario: SKILL.md documents the revise command in the review loop
    Given the markdown-review SKILL.md
    When it is checked for the revise step
    Then the review loop says to run revise.cjs after each round of edits and before arming the watcher
    And it gives the revise.cjs command line with --session-dir

  Scenario: SKILL.md states that unrevised edits are not shown
    Given the markdown-review SKILL.md
    When it is checked for live-reload wording
    Then it says edits are not visible to the operator until revise is run
    And it no longer says the browser live-reloads on every edit

  Scenario: SKILL.md documents the revision field on events
    Given the markdown-review SKILL.md
    When its event format section is read
    Then the approve and comment examples include a "revision" field
    And it says an approval is current only if its revision is the latest revision
