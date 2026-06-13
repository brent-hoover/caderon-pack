# STORY-XXX — <short description>
#
# Run with: pytest -v
#
# Structure (do not flatten):
#   Feature   -> top-level class TestFeature…
#   Scenario  -> nested class TestScenario… with a scope="class" fixture for arrange
#   Specification -> def test_… method — EXACTLY ONE assertion each
#
# Happy-path scenarios first and exhaustive.
# Sad-path scenarios at the bottom in their OWN nested classes.
#
# Replace ShoppingCart and domain calls with the real subject once specs are
# approved. The subject does not need to exist yet — these specs are the
# design and are expected to fail first.
import pytest

from myapp.cart import CartError, ShoppingCart


class TestFeatureACustomerBuildsAShoppingCart:
    """Feature: a customer builds a shopping cart"""

    # -----------------------------------------------------------------
    # HAPPY PATH — exhaustive success outcomes, first.
    # -----------------------------------------------------------------

    class TestScenarioAddingTwoDistinctItems:
        """Scenario: adding two distinct items"""

        @pytest.fixture(scope="class")
        def cart(self):
            c = ShoppingCart()
            c.add(sku="widget", unit_price=5, quantity=2)
            c.add(sku="gadget", unit_price=10, quantity=1)
            return c

        def test_holds_two_line_items(self, cart):
            assert len(cart.line_items) == 2

        def test_sums_the_widget_line(self, cart):
            assert cart.line_total("widget") == 10

        def test_sums_the_gadget_line(self, cart):
            assert cart.line_total("gadget") == 10

        def test_totals_the_whole_cart(self, cart):
            assert cart.total == 20

        def test_is_not_empty(self, cart):
            assert not cart.is_empty

    class TestScenarioAddingTheSameSKUTwiceMergesQuantities:
        """Scenario: adding the same SKU twice merges quantities"""

        @pytest.fixture(scope="class")
        def cart(self):
            c = ShoppingCart()
            c.add(sku="widget", unit_price=5, quantity=1)
            c.add(sku="widget", unit_price=5, quantity=3)
            return c

        def test_keeps_a_single_line_item(self, cart):
            assert len(cart.line_items) == 1

        def test_accumulates_the_quantity(self, cart):
            assert cart.quantity_of("widget") == 4

        def test_prices_the_merged_quantity(self, cart):
            assert cart.total == 20

    # -----------------------------------------------------------------
    # SAD PATH — segregated. Each failure mode is its own class.
    # -----------------------------------------------------------------

    class TestScenarioRejectingANonPositiveQuantity:
        """Scenario: rejecting a non-positive quantity (SAD)"""

        def test_raises_cart_error(self):
            c = ShoppingCart()
            with pytest.raises(CartError):
                c.add(sku="widget", unit_price=5, quantity=0)

    class TestScenarioRejectingANegativeUnitPrice:
        """Scenario: rejecting a negative unit price (SAD)"""

        def test_raises_cart_error(self):
            c = ShoppingCart()
            with pytest.raises(CartError):
                c.add(sku="widget", unit_price=-1, quantity=1)
