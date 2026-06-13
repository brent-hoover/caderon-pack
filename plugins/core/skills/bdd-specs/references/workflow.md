# Story -> Feature -> Scenario -> Specification, worked through

This is the mapping the skill applies. Read it before generating specs.

## The mapping

| Source artifact                         | Spec construct                         |
|-----------------------------------------|----------------------------------------|
| A user story / plan step                | One Feature file                       |
| An acceptance criterion of that story   | One Scenario block                     |
| The "then …" of a criterion             | One Specification with ONE assertion   |
| All "given …" state for a criterion     | The Scenario's setup (fixture/arrange) |
| A failure / edge "then"                 | A Specification in a *separate* sad-path Scenario |

## DDD doc -> story derivation

When `feature-work/<slug>/` docs exist:

| DDD doc section                   | Maps to                              |
|-----------------------------------|--------------------------------------|
| `plan.md` Steps (each with Verify)| One Feature per step                 |
| `problem.md` Success criteria     | Happy-path acceptance criteria        |
| `problem.md` Failure modes        | Sad-path Scenarios                   |
| `design.md` Domain model          | Invariants to enforce in sad-path specs |

## Worked example

Story (or derived from DDD plan step):

> **As a** customer
> **I want** to add items to a cart
> **So that** I can buy several things at once
>
> - Given an empty cart, when I add 2 widgets at $5, then the cart has 1
>   line item, the line totals $10, and the cart totals $10.
> - Given a cart with 1 widget, when I add 2 more widgets, then the cart
>   still has 1 line item and the quantity is 3.
> - Given an empty cart, when I add an item with quantity 0, then it is
>   rejected with a CartError.

Becomes:

- `Feature: a customer builds a shopping cart` (the story)
  - `Scenario: adding two widgets to an empty cart` (criterion 1)
    - setup: new cart, add 2 widgets at $5
    - spec: "has one line item" — 1 assertion
    - spec: "totals the line at $10" — 1 assertion
    - spec: "totals the cart at $10" — 1 assertion
  - `Scenario: adding more of an existing item` (criterion 2)
    - setup: cart with 1 widget, add 2 more
    - spec: "still has one line item" — 1 assertion
    - spec: "has quantity three" — 1 assertion
  - `Scenario: rejecting a zero quantity` (criterion 3 — SAD, separate block)
    - setup: capture the failing call
    - spec: "returns a CartError" — 1 assertion

One criterion with three "then" clauses becomes three specs, not one spec
with three assertions. That is the one-assertion rule.

## Go shape

```go
func TestFeatureACustomerBuildsAShoppingCart(t *testing.T) {
    t.Run("Scenario: adding two widgets to an empty cart", func(t *testing.T) {
        c := cart.New()
        require.NoError(t, c.Add(cart.Item{SKU: "widget", UnitPrice: 5, Quantity: 2}))

        t.Run("has one line item", func(t *testing.T) {
            assert.Len(t, c.LineItems(), 1)
        })
        t.Run("totals the line at 10", func(t *testing.T) {
            assert.Equal(t, 10, c.LineTotal("widget"))
        })
        t.Run("totals the cart at 10", func(t *testing.T) {
            assert.Equal(t, 10, c.Total())
        })
    })

    // SAD PATH
    t.Run("Scenario: rejecting a zero quantity", func(t *testing.T) {
        c := cart.New()
        err := c.Add(cart.Item{SKU: "widget", UnitPrice: 5, Quantity: 0})

        t.Run("returns a CartError", func(t *testing.T) {
            var cartErr *cart.CartError
            assert.ErrorAs(t, err, &cartErr)
        })
    })
}
```

## Python shape

```python
class TestFeatureACustomerBuildsAShoppingCart:

    class TestScenarioAddingTwoWidgetsToAnEmptyCart:
        @pytest.fixture(scope="class")
        def cart(self):
            c = ShoppingCart()
            c.add(sku="widget", unit_price=5, quantity=2)
            return c

        def test_has_one_line_item(self, cart):
            assert len(cart.line_items) == 1

        def test_totals_the_line_at_10(self, cart):
            assert cart.line_total("widget") == 10

        def test_totals_the_cart_at_10(self, cart):
            assert cart.total == 10

    # SAD PATH
    class TestScenarioRejectingAZeroQuantity:
        def test_raises_cart_error(self):
            c = ShoppingCart()
            with pytest.raises(CartError):
                c.add(sku="widget", unit_price=5, quantity=0)
```

## Exhaustiveness checklist (happy path)

Before declaring the happy path done, confirm a Scenario exists for:

- The nominal/typical case.
- Each boundary the domain model allows (empty, single, many, max).
- Each distinct success *outcome* the story's "so that" implies.
- Idempotent / repeated actions, if the domain supports them.
- Each query/derived value the feature exposes (one spec each).

## Sad-path checklist (segregated blocks)

A separate Scenario for each:

- Each invariant in the domain model that can be violated.
- Each validation rule (type, range, required, format).
- Each documented error / rejection in the story's failure cases.
- Conflict / not-found / unauthorized states, where applicable.

## Ordering rule

Within a Feature: every happy-path Scenario first, then every sad-path
Scenario. Never interleave. A reader scanning top-to-bottom should see
the intended behavior fully before seeing how it fails.

## Stop point

After generating the spec files, stop. Present them for review. Do not
write implementation code until the user approves the specs — the specs
are the design, and they are expected to fail first (red).
