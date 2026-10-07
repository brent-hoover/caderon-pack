# sample.feature
# Maps to: plan.md Step 4

@attribution
Feature: Every debit can be traced
  As the operator
  I want each debit recorded with its reasons

  Background:
    Given the routing table, version 3

  Rule: Stages are counted from 1

    # stage numbering is 1-based
    @smoke
    Scenario: Each record carries its own reason
      Given a node (crescendo, plain, 6)
      When the node's loss is debited
      Then each record reads:
        """
        # not a comment, a doc string line
        blamed stages: 6
        """
      And the debit names the routing table row
      * it lists the blamed axes

    Scenario Outline: Splits name the split
      Given reasons <reasons>
      Then the debit names <target>

      Examples:
        | reasons          | target |
        | DENIED, DETECTED | split  |

  this line matches no Gherkin keyword
