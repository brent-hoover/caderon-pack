# Documentation Standard

## Philosophy

**Good documentation accelerates onboarding, reduces support burden, and improves code maintainability.**

Documentation should be:
- **Accurate** - Always up to date
- **Accessible** - Easy to find and read
- **Actionable** - Provides clear guidance
- **Appropriate** - Right level of detail

## Documentation Types

### 1. Inline Documentation

Code-level documentation using language-specific formats (JSDoc, docstrings, etc.).

### 2. README Files

High-level overview and quick-start guides for projects, features, or modules.

### 3. API Documentation

Detailed specifications for public APIs, endpoints, and interfaces.

### 4. Architecture Documentation

System design, decisions, and patterns used in the codebase.

## Inline Documentation

### When to Document Inline

- Public APIs and interfaces
- Complex algorithms
- Non-obvious code
- Function parameters and return values
- Important caveats or side effects

### JavaScript/TypeScript (JSDoc)

```javascript
/**
 * Calculates the shipping cost based on weight and destination.
 *
 * @param {number} weight - Package weight in kilograms
 * @param {string} destination - Destination country code (ISO 3166-1 alpha-2)
 * @param {Object} options - Additional shipping options
 * @param {boolean} [options.express=false] - Use express shipping
 * @param {boolean} [options.insurance=false] - Add insurance
 * @returns {Promise<number>} Shipping cost in cents
 * @throws {ValidationError} If weight is negative or destination is invalid
 * @example
 * const cost = await calculateShipping(2.5, 'US', { express: true });
 * // Returns: 1250 (12.50 USD)
 */
async function calculateShipping(weight, destination, options = {}) {
  // Implementation
}
```

### Python (Docstrings)

```python
def process_payment(amount, payment_method, customer_id):
    """
    Process a payment through the configured payment gateway.

    Args:
        amount (Decimal): The payment amount in the currency's smallest unit
        payment_method (str): Payment method ID from payment provider
        customer_id (str): Unique customer identifier

    Returns:
        dict: Payment result containing:
            - transaction_id (str): Unique transaction identifier
            - status (str): Payment status ('success', 'pending', 'failed')
            - timestamp (datetime): When the payment was processed

    Raises:
        PaymentError: If payment processing fails
        ValidationError: If amount is invalid or payment method not found

    Example:
        >>> result = process_payment(Decimal('99.99'), 'pm_123', 'cust_456')
        >>> print(result['status'])
        'success'
    """
    # Implementation
```

### Go

```go
// CalculateDiscount calculates the discount amount based on customer tier
// and order total.
//
// Parameters:
//   - total: Order total in cents
//   - customerTier: Customer tier level (1-5)
//
// Returns:
//   - Discount amount in cents
//
// Example:
//
//	discount := CalculateDiscount(10000, 3)  // Returns 1500 (15% of $100)
func CalculateDiscount(total int, customerTier int) int {
    // Implementation
}
```

## README Files

### Feature/Module README Template

```markdown
# Feature Name

## Overview
Brief description of what this feature does and why it exists.

## Features
- Feature 1: Description
- Feature 2: Description
- Feature 3: Description

## Usage

### Basic Example
\`\`\`javascript
// Simple usage example
const result = useFeature({
  option1: 'value',
  option2: true
});
\`\`\`

### Advanced Example
\`\`\`javascript
// More complex usage
const result = useFeature({
  option1: 'value',
  option2: true,
  callbacks: {
    onSuccess: () => console.log('Success'),
    onError: (err) => console.error(err)
  }
});
\`\`\`

## API Reference

### `functionName(param1, param2, options)`

Description of what this function does.

**Parameters:**
- `param1` (string): Description
- `param2` (number): Description
- `options` (Object): Optional parameters
  - `option1` (boolean): Description

**Returns:** (Promise<Object>) Description of return value

**Example:**
\`\`\`javascript
const result = await functionName('value', 42, { option1: true });
\`\`\`

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| option1 | string | 'default' | What this option does |
| option2 | number | 10 | What this option controls |

## Dependencies

- dependency1 (^1.0.0): Used for X
- dependency2 (^2.5.0): Used for Y

## Testing

\`\`\`bash
# Run tests
npm test features/feature-name

# Run with coverage
npm test features/feature-name -- --coverage
\`\`\`

## Known Issues

- Issue #123: Description and workaround
- Issue #456: Description and status

## Related Features

- [Feature A](../feature-a/README.md): How it relates
- [Feature B](../feature-b/README.md): How it relates
```

### Project README Template

```markdown
# Project Name

Brief description of the project.

## Features

- Core feature 1
- Core feature 2
- Core feature 3

## Installation

\`\`\`bash
npm install package-name
\`\`\`

## Quick Start

\`\`\`javascript
import { Package } from 'package-name';

const instance = new Package({
  apiKey: 'your-api-key'
});

const result = await instance.doSomething();
\`\`\`

## Documentation

- [Getting Started Guide](./docs/getting-started.md)
- [API Reference](./docs/api-reference.md)
- [Examples](./docs/examples.md)

## Development

\`\`\`bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run linter
npm run lint
\`\`\`

## License

MIT
```

## API Documentation

### REST API Documentation

```markdown
# API Endpoint: Create User

Creates a new user account.

## Request

\`POST /api/users\`

### Headers
- \`Content-Type: application/json\`
- \`Authorization: Bearer <token>\`

### Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User email address |
| name | string | Yes | User's full name |
| role | string | No | User role (default: 'user') |

### Example Request

\`\`\`json
{
  "email": "user@example.com",
  "name": "John Doe",
  "role": "admin"
}
\`\`\`

## Response

### Success Response (201 Created)

\`\`\`json
{
  "id": "user-123",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "admin",
  "createdAt": "2024-01-15T10:30:00Z"
}
\`\`\`

### Error Responses

**400 Bad Request**
\`\`\`json
{
  "error": "Validation failed",
  "details": {
    "email": "Invalid email format"
  }
}
\`\`\`

**409 Conflict**
\`\`\`json
{
  "error": "User with this email already exists"
}
\`\`\`

## Rate Limiting

- 100 requests per minute per API key
- Returns \`429 Too Many Requests\` when exceeded
```

## Architecture Documentation

### Architecture Decision Records (ADRs)

```markdown
# ADR 001: Use PostgreSQL for Primary Database

## Status
Accepted

## Context
We need to choose a database for our application that handles:
- Relational data with complex queries
- ACID transactions
- High read/write volume
- JSON data for flexible schemas

## Decision
We will use PostgreSQL as our primary database.

## Consequences

### Positive
- ACID compliance ensures data integrity
- JSON support provides flexibility
- Strong ecosystem and tooling
- Proven scalability

### Negative
- More complex than NoSQL for simple key-value storage
- Requires more operational expertise
- Vertical scaling more expensive than horizontal

## Alternatives Considered
- MongoDB: Lacks ACID for multi-document transactions
- MySQL: Weaker JSON support
- DynamoDB: Higher costs, vendor lock-in
```

## Documentation Best Practices

### 1. Keep Documentation Close to Code

```
/features
  /user-authentication
    README.md           ← Feature documentation
    /api
      authController.js ← Inline API docs
    /domain
      authService.js    ← Business logic docs
```

### 2. Update Documentation with Code

Every PR that changes behavior should update docs:

```bash
# Good PR checklist
- [x] Code changes
- [x] Tests added/updated
- [x] README updated
- [x] API docs updated (if applicable)
- [x] Inline docs updated
```

### 3. Use Examples Liberally

```javascript
/**
 * Formats a date string according to locale.
 *
 * @example
 * formatDate('2024-01-15', 'en-US')
 * // Returns: "1/15/2024"
 *
 * @example
 * formatDate('2024-01-15', 'en-GB')
 * // Returns: "15/1/2024"
 */
function formatDate(date, locale) {
  // Implementation
}
```

### 4. Link Related Documentation

```markdown
## Related Documentation

- [Authentication Flow](../auth/README.md)
- [API Reference](../../docs/api.md#user-endpoints)
- [Database Schema](../../docs/schema.md#users-table)
```

### 5. Document "Why", Not Just "What"

```javascript
// Bad - what
/**
 * Sets cache TTL to 300 seconds
 */
const CACHE_TTL = 300;

// Good - why
/**
 * Cache TTL set to 5 minutes based on analysis showing:
 * - 95% of data changes happen in 5+ minute intervals
 * - Reduces database load by 70%
 * - Acceptable staleness for non-critical data
 */
const CACHE_TTL = 300;
```

## Documentation Tools

### Generation Tools
- **JSDoc**: JavaScript documentation
- **TypeDoc**: TypeScript documentation
- **Sphinx**: Python documentation
- **Swagger/OpenAPI**: REST API documentation
- **GraphQL Playground**: GraphQL API docs

### Hosting
- **GitHub Pages**: Free for public repos
- **Read the Docs**: Free for open source
- **Docusaurus**: React-based doc site generator

## Summary

Maintain three levels of documentation: inline (for code details), READMEs (for overview and quick start), and architecture docs (for decisions and design). Keep documentation close to code, update it with every change, use examples, and explain why, not just what. Use appropriate tools for generation and hosting. Remember: documentation is as important as code - maintain it with the same rigor.
