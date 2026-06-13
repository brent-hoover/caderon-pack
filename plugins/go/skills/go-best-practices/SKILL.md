---
name: go-best-practices
description: Go best practices for types, errors, nil, concurrency, and module layout. Use when writing Go code, reviewing .go files, or designing Go packages.
---

# Go Best Practices

The goal is code that is easy to change safely. These rules exist to keep the next diff small.

## Compiler / runtime settings

Pin the Go version in `go.mod`. Use `go 1.22` or later — generics and range-over-func are stable.

```
go 1.22

require (...)
```

Always commit `go.sum`. Run `go mod tidy` before committing new dependencies.

Vet and test flags to always use:

```bash
go vet ./...
go test -race ./...
```

## Type system & modeling

Prefer concrete types at construction, interfaces at boundaries.

```go
// Good: concrete in, interface out
func NewCache(size int) Cache { return &lruCache{size: size} }

type Cache interface {
    Get(key string) (any, bool)
    Set(key string, val any)
}
```

Use struct embedding for composition, not inheritance. Avoid embedding interfaces inside structs (it silently satisfies the interface with nil methods).

Branded/newtype pattern for domain primitives:

```go
type UserID string
type OrderID string

// Prevents passing a UserID where an OrderID is expected
func FindOrder(id OrderID) (*Order, error) { ... }
```

## Error handling

Errors are values. Always check them.

```go
// Wrap with context, never swallow
if err != nil {
    return fmt.Errorf("load config: %w", err)
}
```

Sentinel errors for callers that need to branch on type:

```go
var ErrNotFound = errors.New("not found")

// caller
if errors.Is(err, ErrNotFound) { ... }
```

Custom error types only when the caller needs to extract fields:

```go
type ValidationError struct {
    Field   string
    Message string
}
func (e *ValidationError) Error() string { return e.Field + ": " + e.Message }
```

Never `log.Fatal` or `os.Exit` outside of `main`. Propagate errors up.

## Nil / zero-value hygiene

Design so the zero value is useful or clearly invalid — not silently broken.

```go
// Good: zero value is valid (empty cache)
type Cache struct{ mu sync.Mutex; items map[string]any }
func (c *Cache) Get(k string) (any, bool) {
    c.mu.Lock(); defer c.mu.Unlock()
    v, ok := c.items[k]; return v, ok
}

// Bad: zero value panics
type Cache struct{ items map[string]any }  // nil map write panics
```

Never return a typed nil pointer as an interface — the interface itself is non-nil:

```go
// Bug: caller gets non-nil interface wrapping nil *MyError
func bad() error { var e *MyError; return e }  // DON'T

// Fix: return untyped nil
func good() error { return nil }
```

Accept pointers only when mutation or optional presence is required. Prefer value receivers for small structs.

## Async / concurrency rules

See the `go-concurrency-patterns` skill for full patterns. Core rules:

- Every goroutine needs an exit path — context cancellation, channel close, or WaitGroup.
- Pass `context.Context` as the first argument to any function that does I/O or blocks.
- Use `errgroup.Group` for fan-out work where you need to collect errors.
- Channels for ownership transfer; mutexes for shared state with fine-grained locking.
- Run tests with `-race`. Fix all races before shipping.

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return doWork(ctx) })
if err := g.Wait(); err != nil { ... }
```

## Module & file conventions

Standard layout for a service:

```
cmd/
  server/
    main.go          # thin: parse flags, wire deps, call Run()
internal/
  domain/            # pure business logic, no I/O
  service/           # orchestration, calls domain + adapters
  store/             # DB layer
  handler/           # HTTP/gRPC handlers
pkg/                 # importable by external packages (use sparingly)
```

One package per directory. Package name == directory name (no `_` or mixed case). Keep `internal/` for anything not meant to be imported externally.

File names: `snake_case.go`. One logical concern per file; split when a file exceeds ~300 lines.

## Testing conventions

Test files live alongside the code: `foo_test.go`.

Table-driven tests are the default shape:

```go
func TestAdd(t *testing.T) {
    cases := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive", 1, 2, 3},
        {"negative", -1, -2, -3},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            if got := Add(tc.a, tc.b); got != tc.expected {
                t.Errorf("Add(%d,%d) = %d, want %d", tc.a, tc.b, got, tc.expected)
            }
        })
    }
}
```

Use `testify/assert` and `testify/require` (require stops the test on failure; assert continues):

```go
require.NoError(t, err)
assert.Equal(t, expected, got)
```

Integration tests: tag with `//go:build integration` and skip in unit runs.

Mock external dependencies with interfaces — don't mock the DB itself, use a real test DB or in-memory store.

## Standard rules per function / type

- Every exported symbol has a doc comment starting with the symbol name.
- Every function that can fail returns `error` as the last return value.
- Constructors are named `New<Type>` and return the interface, not the concrete type.
- Methods that mutate state use pointer receivers. Read-only methods on small structs use value receivers.
- `defer` cleanup immediately after acquiring the resource.

```go
// Well-formed function
func NewUserService(db *sql.DB, logger *slog.Logger) UserService {
    return &userService{db: db, log: logger}
}

func (s *userService) Create(ctx context.Context, u User) (UserID, error) {
    if err := u.Validate(); err != nil {
        return "", fmt.Errorf("create user: %w", err)
    }
    // ...
}
```
