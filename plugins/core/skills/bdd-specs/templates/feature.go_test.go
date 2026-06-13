// STORY-XXX — <short description>
//
// Run with: go test -v ./...
// Race detector: go test -race ./...
//
// Structure (do not flatten):
//   Feature   -> top-level TestFeature… function
//   Scenario  -> t.Run("Scenario: …") — arranges ALL its data locally, then nests specs
//   Specification -> inner t.Run("…") — EXACTLY ONE assertion each
//
// Happy-path scenarios first and exhaustive.
// Sad-path scenarios at the bottom in their OWN t.Run blocks.
//
// Replace ShoppingCart and domain calls with the real subject once specs are
// approved. The subject does not need to exist yet — these specs are the
// design and are expected to fail first.
package cart_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"example.com/myapp/cart"
)

func TestFeatureACustomerBuildsAShoppingCart(t *testing.T) {
	// -----------------------------------------------------------------
	// HAPPY PATH — exhaustive success outcomes, first.
	// -----------------------------------------------------------------

	t.Run("Scenario: adding two distinct items", func(t *testing.T) {
		// Arrange everything this scenario needs.
		c := cart.New()
		require.NoError(t, c.Add(cart.Item{SKU: "widget", UnitPrice: 5, Quantity: 2}))
		require.NoError(t, c.Add(cart.Item{SKU: "gadget", UnitPrice: 10, Quantity: 1}))

		t.Run("holds two line items", func(t *testing.T) {
			assert.Len(t, c.LineItems(), 2)
		})

		t.Run("sums the widget line", func(t *testing.T) {
			assert.Equal(t, 10, c.LineTotal("widget"))
		})

		t.Run("sums the gadget line", func(t *testing.T) {
			assert.Equal(t, 10, c.LineTotal("gadget"))
		})

		t.Run("totals the whole cart", func(t *testing.T) {
			assert.Equal(t, 20, c.Total())
		})

		t.Run("is not empty", func(t *testing.T) {
			assert.False(t, c.IsEmpty())
		})
	})

	t.Run("Scenario: adding the same SKU twice merges quantities", func(t *testing.T) {
		c := cart.New()
		require.NoError(t, c.Add(cart.Item{SKU: "widget", UnitPrice: 5, Quantity: 1}))
		require.NoError(t, c.Add(cart.Item{SKU: "widget", UnitPrice: 5, Quantity: 3}))

		t.Run("keeps a single line item", func(t *testing.T) {
			assert.Len(t, c.LineItems(), 1)
		})

		t.Run("accumulates the quantity", func(t *testing.T) {
			assert.Equal(t, 4, c.QuantityOf("widget"))
		})

		t.Run("prices the merged quantity", func(t *testing.T) {
			assert.Equal(t, 20, c.Total())
		})
	})

	// -----------------------------------------------------------------
	// SAD PATH — segregated. Each failure mode is its own scenario.
	// -----------------------------------------------------------------

	t.Run("Scenario: rejecting a non-positive quantity", func(t *testing.T) {
		c := cart.New()
		err := c.Add(cart.Item{SKU: "widget", UnitPrice: 5, Quantity: 0})

		t.Run("returns a CartError", func(t *testing.T) {
			var cartErr *cart.CartError
			assert.ErrorAs(t, err, &cartErr)
		})
	})

	t.Run("Scenario: rejecting a negative unit price", func(t *testing.T) {
		c := cart.New()
		err := c.Add(cart.Item{SKU: "widget", UnitPrice: -1, Quantity: 1})

		t.Run("returns a CartError", func(t *testing.T) {
			var cartErr *cart.CartError
			assert.ErrorAs(t, err, &cartErr)
		})
	})
}
