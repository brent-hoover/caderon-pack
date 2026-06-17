---
name: godog
description: >
  Guide for implementing BDD scenarios in Go using godog (Cucumber for Go). Use when the project
  is Go and needs step definitions wired to Gherkin .feature files. Covers project layout, step
  registration patterns, TestMain wiring, table-driven scenarios, and running scenarios.
version: 1.0.0
allowed-tools: Read, Write, Edit, Bash, Glob
---

# godog implementation guide

## Project layout

```
project/
├── scenarios/               # .feature files (from start-bdd-feature workflow)
│   ├── user-login.feature
│   └── payment-refund.feature
├── internal/
│   └── ...                  # production code
└── features_test.go         # godog TestMain + step definitions
    # or split into:
    # features_test.go       (TestMain only)
    # step_defs_test.go      (step definitions)
```

Feature files live in `scenarios/`. Step definitions live in `*_test.go` files at the package
level that owns the behavior being tested.

## Installation

```bash
go get github.com/cucumber/godog/cmd/godog@latest
go get github.com/cucumber/godog@latest
```

## TestMain wiring

Every package using godog needs a `TestMain` that bootstraps the suite:

```go
package mypackage_test

import (
    "os"
    "testing"

    "github.com/cucumber/godog"
)

func TestMain(m *testing.M) {
    opts := godog.Options{
        Format:   "pretty",
        Paths:    []string{"../scenarios"},
        TestingT: nil, // set below
    }

    status := godog.TestSuite{
        Name:                "feature suite",
        ScenarioInitializer: InitializeScenario,
        Options:             &opts,
    }.Run()

    if st := m.Run(); st != 0 {
        status = st
    }
    os.Exit(status)
}
```

## Step registration

All step definitions are registered in `InitializeScenario`:

```go
func InitializeScenario(sc *godog.ScenarioContext) {
    s := &testState{}

    sc.Step(`^the accounts service is running$`, s.theAccountsServiceIsRunning)
    sc.Step(`^a token that expired (\d+) hour(?:s)? ago$`, s.aTokenExpiredHoursAgo)
    sc.Step(`^the client calls (GET|POST|PUT|DELETE) (.+)$`, s.theClientCalls)
    sc.Step(`^the response status is (\d+)$`, s.theResponseStatusIs)
    sc.Step(`^the body contains "([^"]*)"$`, s.theBodyContains)

    sc.Before(func(ctx context.Context, sc *godog.Scenario) (context.Context, error) {
        s.reset()
        return ctx, nil
    })
}
```

### Step function signatures

```go
type testState struct {
    service  *httptest.Server
    response *http.Response
    token    string
}

// No arguments — matches literal step text
func (s *testState) theAccountsServiceIsRunning() error {
    s.service = startTestServer()
    return nil
}

// Captured group → Go argument (godog auto-converts string/int)
func (s *testState) aTokenExpiredHoursAgo(hours int) error {
    s.token = generateExpiredToken(time.Duration(hours) * time.Hour)
    return nil
}

func (s *testState) theClientCalls(method, path string) error {
    req, _ := http.NewRequest(method, s.service.URL+path, nil)
    req.Header.Set("Authorization", "Bearer "+s.token)
    resp, err := http.DefaultClient.Do(req)
    s.response = resp
    return err
}

func (s *testState) theResponseStatusIs(expected int) error {
    if s.response.StatusCode != expected {
        return fmt.Errorf("expected status %d, got %d", expected, s.response.StatusCode)
    }
    return nil
}
```

### Return conventions

- Return `nil` → step passes
- Return `error` → step fails with the error message
- Return `godog.ErrPending` → marks step as pending (not yet implemented)

## Running scenarios

```bash
# Run all scenarios via go test
go test ./... -v

# Run a single feature file (using godog CLI)
godog scenarios/user-login.feature

# Run with pretty output
go test ./... -v -godog.format=pretty

# Run a specific scenario by name (regex)
go test ./... -run TestFeatures/expired_token_is_rejected
```

### Running via godog CLI directly

```bash
# Install CLI
go install github.com/cucumber/godog/cmd/godog@latest

# Run feature files
godog scenarios/
godog scenarios/user-login.feature
```

## Table-driven scenarios (Scenario Outline)

```gherkin
Scenario Outline: token expiry threshold
  Given a token that expired <hours> hour(s) ago
  When the client calls GET /accounts
  Then the response status is <status>

  Examples:
    | hours | status |
    | 0     | 200    |
    | 1     | 401    |
```

godog runs each Examples row as a separate scenario automatically.

## Context passing (godog v0.12+)

For sharing state across steps without a struct, use context:

```go
type contextKey string

func InitializeScenario(sc *godog.ScenarioContext) {
    sc.Step(`^a token that expired (\d+) hour(?:s)? ago$`, aTokenExpiredHoursAgo)
    sc.Step(`^the response status is (\d+)$`, theResponseStatusIs)
}

func aTokenExpiredHoursAgo(ctx context.Context, hours int) (context.Context, error) {
    token := generateExpiredToken(time.Duration(hours) * time.Hour)
    return context.WithValue(ctx, contextKey("token"), token), nil
}

func theResponseStatusIs(ctx context.Context, expected int) error {
    resp := ctx.Value(contextKey("response")).(*http.Response)
    if resp.StatusCode != expected {
        return fmt.Errorf("expected %d got %d", expected, resp.StatusCode)
    }
    return nil
}
```

## Common mistakes

| Mistake | Fix |
|---|---|
| Step regex doesn't match | Print step text; check spacing and punctuation exactly |
| Captured group type mismatch | godog converts string→int for `(\d+)`; use `string` for quoted captures |
| `sc.Step` in wrong function | All registrations must be inside `InitializeScenario` |
| Shared state across scenarios | Use `sc.Before` to reset state, or use context-passing pattern |
| Feature file path wrong in `Paths` | Path is relative to where `go test` runs (package root) |
| `TestMain` not in `_test.go` file | Must be in a `*_test.go` file in the package being tested |
