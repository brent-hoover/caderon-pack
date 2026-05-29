---
name: code-quality
description: Standards for maintaining high code quality including comments, test coverage, and documentation practices
---

# Code Quality Standards

This skill defines standards for maintaining high-quality, maintainable code through proper commenting, testing, and documentation practices.

## Core Philosophy

**Code quality is not optional - it's a fundamental requirement.**

Quality code is:
- **Readable** - Easy to understand
- **Maintainable** - Easy to modify
- **Tested** - Verified to work
- **Documented** - Purpose is clear

## When to Use This Skill

Use this skill when:
- Writing new code
- Reviewing code
- Establishing team standards
- Onboarding new developers
- Refactoring existing code

## Quality Standards

### 1. Code Comments

When and how to comment code effectively.

See [Code Comments Standard](./standards/code-comments.md) for detailed guidelines.

**Key Points:**
- Comment the "why", not the "what"
- Use self-documenting code over comments
- Update comments when code changes
- Remove outdated comments

### 2. Test Coverage

Requirements for test coverage across different code types.

See [Test Coverage Standard](./standards/test-coverage.md) for detailed guidelines.

**Key Points:**
- Business logic: 80-100% coverage
- Utilities: 90-100% coverage
- API layer: 60-80% coverage
- Write tests alongside code, not after

### 3. Documentation

Standards for inline docs, READMEs, and API documentation.

See [Documentation Standard](./standards/documentation.md) for detailed guidelines.

**Key Points:**
- Every feature has a README
- Public APIs are documented
- Complex algorithms explained
- Architecture decisions recorded

## Quality Checklist

Before committing code, verify:

- [ ] Code is self-documenting (clear names, simple logic)
- [ ] Complex logic has explanatory comments
- [ ] All public APIs have documentation
- [ ] Tests written and passing
- [ ] Test coverage meets standards
- [ ] No commented-out code
- [ ] No TODO comments (create issues instead)
- [ ] README updated if needed

## Code Quality Tools

### Linters
- **ESLint** (JavaScript/TypeScript)
- **Pylint** (Python)
- **RuboCop** (Ruby)
- **golangci-lint** (Go)

### Formatters
- **Prettier** (JavaScript/TypeScript)
- **Black** (Python)
- **gofmt** (Go)
- **rustfmt** (Rust)

### Type Checkers
- **TypeScript**
- **mypy** (Python)
- **Flow** (JavaScript)

### Coverage Tools
- **Jest** (JavaScript)
- **pytest-cov** (Python)
- **SimpleCov** (Ruby)
- **go test -cover** (Go)

## Best Practices

### 1. Prefer Self-Documenting Code

**Bad:**
```javascript
// Calculate total
const t = i.reduce((a, c) => a + c.p * c.q, 0);
```

**Good:**
```javascript
const total = items.reduce((sum, item) => {
  return sum + (item.price * item.quantity);
}, 0);
```

### 2. Write Meaningful Comments

**Bad:**
```javascript
// Increment counter
counter++;
```

**Good:**
```javascript
// Track failed login attempts for rate limiting
failedLoginAttempts++;
```

### 3. Document Public APIs

**Bad:**
```javascript
function processOrder(order) {
  // ...
}
```

**Good:**
```javascript
/**
 * Processes an order through the payment gateway and updates inventory.
 *
 * @param {Object} order - The order to process
 * @param {string} order.id - Unique order identifier
 * @param {Array} order.items - Items in the order
 * @param {number} order.total - Order total in cents
 * @returns {Promise<Object>} Processed order with payment confirmation
 * @throws {PaymentError} If payment processing fails
 */
function processOrder(order) {
  // ...
}
```

### 4. Keep Documentation Updated

Remove or update outdated docs immediately:

```javascript
// Bad - outdated comment
/**
 * Sends email via SMTP
 * Note: Currently using SendGrid API instead
 */
function sendEmail() {
  // Using SendGrid...
}

// Good - updated comment
/**
 * Sends email via SendGrid API
 */
function sendEmail() {
  // ...
}
```

## Integration with Other Principles

- **KISS**: Simple code needs fewer comments
- **DRY**: Document shared code once
- **YAGNI**: Don't document unused features
- **Testing Standards**: Coverage targets guide quality

## Quality Metrics

Track these metrics:
- Test coverage percentage
- Documentation coverage
- Linter warnings/errors
- Code review feedback
- Time to onboard new developers

## Code Review Standards

When reviewing code, check for:
1. **Readability** - Can you understand it?
2. **Tests** - Are there tests? Do they pass?
3. **Documentation** - Is complex logic explained?
4. **Standards** - Does it follow team conventions?
5. **Quality** - Would you be comfortable maintaining this?

## Common Anti-Patterns

### 1. Over-Commenting

```javascript
// Bad
// Create a new user
const user = new User();
// Set the name
user.name = 'John';
// Set the email
user.email = 'john@example.com';
// Save the user
user.save();
```

### 2. Commented-Out Code

```javascript
// Bad
function processPayment() {
  // const oldMethod = chargeCard();
  // return oldMethod;
  return newPaymentGateway.charge();
}

// Good - delete it, use version control
function processPayment() {
  return newPaymentGateway.charge();
}
```

### 3. Misleading Comments

```javascript
// Bad - comment doesn't match code
// Returns user by ID
function getUserByEmail(email) {
  return db.query('SELECT * FROM users WHERE email = ?', [email]);
}
```

### 4. No Tests for Complex Logic

```javascript
// Bad - complex logic without tests
function calculatePricing(items, discounts, taxes, shipping, loyalty) {
  // 50 lines of complex calculation
  // No tests!
}
```

## Summary

Maintain code quality through clear, self-documenting code, meaningful comments, comprehensive tests, and accurate documentation. Use tools to automate quality checks. Review code with quality in mind. Update documentation when code changes. Remember: code is read far more often than it's written, so optimize for readability and maintainability.
