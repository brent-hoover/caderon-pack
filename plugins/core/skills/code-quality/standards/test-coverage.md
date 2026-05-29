# Test Coverage Standard

## Coverage Requirements

All code must meet minimum test coverage standards based on code type and criticality.

## Coverage Targets

| Code Type | Minimum Coverage | Target Coverage |
|-----------|-----------------|-----------------|
| Business Logic | 80% | 90-100% |
| Utilities/Helpers | 85% | 95-100% |
| Data Access Layer | 70% | 80-90% |
| API Controllers | 60% | 70-80% |
| UI Components | 40% | 60-70% |

## Coverage Metrics

Track all four coverage types:

1. **Line Coverage** - % of lines executed
2. **Branch Coverage** - % of code paths executed
3. **Function Coverage** - % of functions called
4. **Statement Coverage** - % of statements executed

**Branch coverage is the most important metric.**

## Enforcement

### Continuous Integration

All pull requests must meet coverage thresholds:

```json
{
  "coverageThreshold": {
    "global": {
      "branches": 70,
      "functions": 75,
      "lines": 75,
      "statements": 75
    }
  }
}
```

### New Code Coverage

New code should have higher coverage than legacy code:

- **New features**: Minimum 80% coverage
- **Bug fixes**: Include tests that catch the bug
- **Refactoring**: Maintain or improve coverage

## What to Test

### High Priority (Must Test)

- All business logic
- Data transformations
- Validation logic
- Calculations and algorithms
- Error handling
- Edge cases and boundaries

### Medium Priority (Should Test)

- API endpoints
- Database queries
- Service integrations
- Complex UI interactions

### Low Priority (Optional)

- Simple getters/setters
- Configuration
- Third-party library wrappers
- Generated code

## Coverage Tools

### JavaScript/TypeScript
```bash
# Jest with coverage
npm test -- --coverage

# View report
open coverage/lcov-report/index.html
```

### Python
```bash
# pytest with coverage
pytest --cov=src --cov-report=html

# View report
open htmlcov/index.html
```

### Go
```bash
# Run tests with coverage
go test -cover ./...

# Generate HTML report
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

## Coverage Analysis

### Identify Gaps

```bash
# Find untested files
npm test -- --coverage --collectCoverageFrom='src/**/*.js'
```

Review coverage report to find:
- Uncovered lines (red)
- Partially covered branches (yellow)
- Fully covered code (green)

### Focus Areas

Prioritize testing:
1. **Critical paths** - Core business functionality
2. **High-risk areas** - Complex algorithms, money/data handling
3. **Frequently changed code** - Areas with many bugs
4. **New features** - Recent additions

## Best Practices

### 1. Write Tests with Code

Don't leave testing for later:

```javascript
// Implementation
function calculateDiscount(price, customerType) {
  if (customerType === 'VIP') return price * 0.20;
  if (customerType === 'REGULAR') return price * 0.10;
  return 0;
}

// Tests (written immediately)
describe('calculateDiscount', () => {
  test('VIP customers get 20% discount', () => {
    expect(calculateDiscount(100, 'VIP')).toBe(20);
  });

  test('regular customers get 10% discount', () => {
    expect(calculateDiscount(100, 'REGULAR')).toBe(10);
  });

  test('unknown customer types get no discount', () => {
    expect(calculateDiscount(100, 'UNKNOWN')).toBe(0);
  });
});
```

### 2. Test Behavior, Not Implementation

```javascript
// Bad - testing implementation
test('uses cache.get method', () => {
  const spy = jest.spyOn(cache, 'get');
  service.getUser(1);
  expect(spy).toHaveBeenCalled();
});

// Good - testing behavior
test('returns user data', async () => {
  const user = await service.getUser(1);
  expect(user.id).toBe(1);
  expect(user.name).toBeDefined();
});
```

### 3. Cover Edge Cases

```javascript
describe('divide', () => {
  test('divides positive numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  test('handles negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
  });

  test('throws on division by zero', () => {
    expect(() => divide(10, 0)).toThrow();
  });

  test('handles decimals', () => {
    expect(divide(10, 3)).toBeCloseTo(3.33, 2);
  });
});
```

### 4. Maintain Coverage Over Time

```bash
# Fail CI if coverage drops
jest --coverage --coverageThreshold='{"global":{"lines":80}}'
```

## Common Anti-Patterns

### 1. Testing for Coverage Numbers

```javascript
// Bad - test with no assertions (meaningless coverage)
test('processes data', () => {
  processData([1, 2, 3]); // No assertion!
});

// Good - test with meaningful assertion
test('processes data and returns transformed result', () => {
  const result = processData([1, 2, 3]);
  expect(result).toEqual([2, 4, 6]);
});
```

### 2. Ignoring Branch Coverage

```javascript
// 100% line coverage but 50% branch coverage
function isValid(user) {
  return user && user.email && user.age >= 18;
}

// Bad - only one test
test('returns true for valid user', () => {
  expect(isValid({ email: 'test@example.com', age: 18 })).toBe(true);
});

// Good - test all branches
test('returns true for valid user', () => {
  expect(isValid({ email: 'test@example.com', age: 18 })).toBe(true);
});

test('returns false for null user', () => {
  expect(isValid(null)).toBe(false);
});

test('returns false for user without email', () => {
  expect(isValid({ age: 18 })).toBe(false);
});

test('returns false for underage user', () => {
  expect(isValid({ email: 'test@example.com', age: 17 })).toBe(false);
});
```

### 3. Chasing 100% Coverage

Don't waste time testing trivial code:

```javascript
// Don't test
class User {
  getName() {
    return this.name;
  }
}

// Don't test
const CONFIG = {
  apiUrl: 'https://api.example.com'
};
```

## Coverage Reports

### Reading Reports

```
File                | % Stmts | % Branch | % Funcs | % Lines | Uncovered Lines
--------------------|---------|----------|---------|---------|----------------
calculator.js       |     100 |      100 |     100 |     100 |
userService.js      |    85.5 |     78.2 |    90.1 |    85.5 | 45-47,89
orderService.js     |    72.3 |     65.4 |    80.2 |    72.3 | 23,67-72,105
```

**Focus on:**
- Low branch coverage (indicates untested paths)
- Uncovered lines in critical files
- Functions with 0% coverage

## Incremental Improvement

Don't try to reach 80% overnight:

1. **Measure current coverage**
2. **Set realistic target** (current + 5-10%)
3. **Focus on high-value tests** first
4. **Increase threshold gradually**
5. **Maintain momentum**

## Summary

Maintain minimum 70-80% test coverage across the codebase, with higher coverage (90%+) for business logic and utilities. Write tests alongside code, not after. Focus on branch coverage, not just line coverage. Test behavior and edge cases. Use coverage to identify gaps, not as a goal itself. Fail CI builds if coverage drops below thresholds. Gradually improve coverage over time.

For detailed testing guidelines, see the [testing-standards skill](../../testing-standards/SKILL.md).
