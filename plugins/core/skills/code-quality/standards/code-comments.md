# Code Comments Standard

## Philosophy

**Good code is self-documenting. Comments explain why, not what.**

Comments should add value that the code itself cannot provide. The best comment is no comment - achieved through clear, expressive code.

## When to Comment

### 1. Complex Business Logic

Explain the reasoning behind non-obvious decisions.

**Example:**
```javascript
// Apply progressive discount: 10% for first $100, 15% for next $200, 20% after that
// Business rule from Q3 2024 pricing strategy
function calculateDiscount(total) {
  if (total <= 100) return total * 0.10;
  if (total <= 300) return 10 + ((total - 100) * 0.15);
  return 10 + 30 + ((total - 300) * 0.20);
}
```

### 2. Workarounds and Hacks

Document why the workaround exists and when it can be removed.

**Example:**
```javascript
// WORKAROUND: Safari doesn't support lookbehind regex
// Remove this when Safari 16.4 becomes minimum supported version
// Issue: #1234
const regex = /(?<!\\)"/g; // Won't work in Safari < 16.4
```

### 3. Non-Obvious Algorithms

Explain the algorithm choice and its trade-offs.

**Example:**
```javascript
// Using quickselect algorithm (O(n) average) instead of full sort (O(n log n))
// for finding median. Benchmarks show 3x speed improvement for large datasets.
function findMedian(array) {
  return quickselect(array, Math.floor(array.length / 2));
}
```

### 4. Important Caveats or Side Effects

Warn about unexpected behavior or requirements.

**Example:**
```javascript
// IMPORTANT: This method modifies the array in place
// Call with a copy if you need to preserve the original
function sortInPlace(array) {
  // ...
}
```

### 5. External Dependencies or Requirements

Document integration points or external constraints.

**Example:**
```javascript
// Requires API key from config.STRIPE_KEY
// Rate limited to 100 requests/second per Stripe's docs
async function processPayment(amount) {
  // ...
}
```

## When NOT to Comment

### 1. Obvious Code

```javascript
// Bad
// Increment counter
counter++;

// Set name to John
name = 'John';

// Return true
return true;
```

### 2. Bad Code That Should Be Refactored

```javascript
// Bad - explaining bad code
// Loop through users and check if email matches
for (let i = 0; i < users.length; i++) {
  if (users[i].email === email) {
    return users[i];
  }
}

// Good - clear code needs no comment
return users.find(user => user.email === email);
```

### 3. What the Code Does

```javascript
// Bad - restating the code
// Add item to cart
cart.addItem(item);

// Get user by ID
const user = await getUserById(id);
```

## Comment Styles

### Single-Line Comments

For brief explanations:

```javascript
// Rate limit: 100 requests per minute
const RATE_LIMIT = 100;
```

### Multi-Line Comments

For longer explanations:

```javascript
/**
 * Calculate compound interest using the formula: A = P(1 + r/n)^(nt)
 * where:
 *   P = principal amount
 *   r = annual interest rate (decimal)
 *   n = number of times interest compounds per year
 *   t = number of years
 */
function calculateCompoundInterest(principal, rate, years, compoundsPerYear) {
  return principal * Math.pow(1 + rate / compoundsPerYear, compoundsPerYear * years);
}
```

### TODO Comments

Create issues instead of leaving TODO comments:

```javascript
// Bad
// TODO: Add error handling
function processData(data) {
  return transform(data);
}

// Good
// Track in issue tracker, reference in code if needed
// See issue #4567 for planned error handling improvements
function processData(data) {
  return transform(data);
}
```

## Comment Maintenance

### Update Comments with Code

```javascript
// Bad - outdated comment
// Returns array of active users
function getUsers() {
  return db.query('SELECT * FROM users'); // Returns all users now
}

// Good - accurate comment
// Returns array of all users (active and inactive)
function getUsers() {
  return db.query('SELECT * FROM users');
}
```

### Remove Obsolete Comments

```javascript
// Bad - obsolete comment
// Old implementation using REST API
// New implementation uses GraphQL
function fetchData() {
  return graphql.query(/* ... */);
}

// Good - remove old comment
function fetchData() {
  return graphql.query(/* ... */);
}
```

### Never Leave Commented-Out Code

```javascript
// Bad
function calculate() {
  // const oldWay = x * 2;
  // return oldWay + 10;
  return x * 2 + 10;
}

// Good - delete it, trust version control
function calculate() {
  return x * 2 + 10;
}
```

## Self-Documenting Code

Prefer code clarity over comments:

### Use Descriptive Names

```javascript
// Bad
// Get user's first purchase date
const d = u.orders[0].date;

// Good
const firstPurchaseDate = user.orders[0].date;
```

### Extract to Named Functions

```javascript
// Bad
// Check if user is eligible for premium features
if (user.accountAge > 30 && user.totalSpent > 1000 && user.verified) {
  enablePremiumFeatures();
}

// Good
function isEligibleForPremium(user) {
  return user.accountAge > 30 &&
         user.totalSpent > 1000 &&
         user.verified;
}

if (isEligibleForPremium(user)) {
  enablePremiumFeatures();
}
```

### Use Constants for Magic Numbers

```javascript
// Bad
// Session expires after 30 minutes
if (Date.now() - session.created > 1800000) {
  expireSession();
}

// Good
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
if (Date.now() - session.created > THIRTY_MINUTES_MS) {
  expireSession();
}
```

## Documentation Comments

For public APIs, use structured documentation:

### JavaScript/TypeScript (JSDoc)

```javascript
/**
 * Fetches user data from the database.
 *
 * @param {string} userId - The unique identifier for the user
 * @param {Object} options - Optional parameters
 * @param {boolean} options.includeOrders - Include user's order history
 * @returns {Promise<User>} The user object
 * @throws {NotFoundError} If user doesn't exist
 * @example
 * const user = await fetchUser('user-123', { includeOrders: true });
 */
async function fetchUser(userId, options = {}) {
  // ...
}
```

### Python (Docstrings)

```python
def calculate_tax(amount, rate):
    """
    Calculate tax on a given amount.

    Args:
        amount (float): The amount to calculate tax for
        rate (float): The tax rate as a decimal (e.g., 0.1 for 10%)

    Returns:
        float: The calculated tax amount

    Raises:
        ValueError: If amount is negative or rate is invalid
    """
    if amount < 0:
        raise ValueError("Amount cannot be negative")
    return amount * rate
```

## Best Practices Summary

✅ **Do:**
- Comment the "why" and "how", not the "what"
- Explain complex business logic
- Document workarounds and their reasons
- Use structured docs for public APIs
- Update comments when code changes
- Delete commented-out code

❌ **Don't:**
- Explain obvious code
- Restate what the code does
- Leave outdated comments
- Use comments to fix bad code
- Leave TODO comments (use issue tracker)
- Comment out code instead of deleting

## Summary

Write self-documenting code with clear names and simple logic. Add comments only when they provide value that code cannot: explaining why, documenting complex algorithms, noting caveats, or describing business rules. Keep comments accurate and up-to-date. Delete commented-out code and obsolete comments. For public APIs, use structured documentation formats.
