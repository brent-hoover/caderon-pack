# scenarios/comments-carry-forward.feature
# Maps to: plan.md Step TBD

Feature: Comments carry forward across revisions
  As the operator re-reviewing a revised doc
  I see my earlier comments on the new revision with their status so that I can check each was addressed

  Background:
    Given "plan.md" revision 1 has the paragraph "The cache expires after 30 seconds."
    And the operator commented "too short" on that paragraph in revision 1 and submitted it

  Scenario: A comment on changed text is shown as addressed
    Given revision 2 changes that paragraph to "The cache expires after 60 seconds."
    When the operator views revision 2
    Then the "too short" comment is shown on the "60 seconds" paragraph
    And it is marked "addressed in revision 2"

  Scenario: A comment on unchanged text is shown as still open
    Given revision 2 changes only a different paragraph
    When the operator views revision 2
    Then the "too short" comment is shown on the "30 seconds" paragraph
    And it is marked "open"

  Scenario: A comment on removed text is shown as addressed by removal
    Given revision 2 deletes that paragraph
    When the operator views revision 2
    Then the "too short" comment is shown at the position where the paragraph was
    And it is marked "addressed in revision 2 (text removed)"

  Scenario: A comment from an older viewer without a revision is treated as revision 1
    Given a recorded comment event for "plan.md" with no revision field
    When the operator views revision 2
    Then that comment is carried forward as if it were made on revision 1

  Scenario: A comment whose anchor cannot be found in its own revision is shown at doc level
    Given a recorded comment event for revision 1 whose quote matches no block in revision 1
    When the operator views revision 2
    Then that comment is shown in the doc-level comments
    And it is marked "anchor not found"
