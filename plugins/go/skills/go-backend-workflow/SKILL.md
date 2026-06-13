---
name: go-backend-workflow
description: Go backend build, test, and lint workflow. Use when building or running a Go project, executing tests, running golangci-lint, managing go modules, generating Swagger docs, or diagnosing CI failures on a Go backend.
---

# Go Backend Workflow

Standard workflow for building, testing, and linting Go backend projects.

## Project detection

Check in this order before running any command:

1. **Makefile targets** — if `make test`, `make lint`, `make build` exist, prefer them; they encode project-specific flags
2. **go.mod at root** — run `go` commands directly from the root
3. **Subdirectory** — if `backend/`, `server/`, or `api/` contains `go.mod`, run from there

## Build

```bash
go build ./...
```

For a specific binary:

```bash
go build -o bin/server ./cmd/server
```

Environment variable overrides:

| Variable | Purpose | Default |
|---|---|---|
| `GO_BACKEND_DIR` | backend root | auto-detected |
| `GO_MAIN_PATH` | path to main.go | `cmd/server/main.go` |
| `GO_BIN_NAME` | output binary name | `server` |

## Test

Run the full suite:

```bash
go test ./...
```

With race detection (always use in CI):

```bash
go test -race ./...
```

With coverage:

```bash
go test -cover -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html
```

Run a single package or test:

```bash
go test ./internal/auth/...
go test -run TestLoginHandler ./internal/auth/...
```

## Lint

```bash
golangci-lint run ./...
```

If `golangci-lint` is not installed:

```bash
brew install golangci-lint
# or
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

Recommended `.golangci.yml` for a backend project:

```yaml
linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gofmt
    - goimports

linters-settings:
  errcheck:
    check-type-assertions: true
```

## Module management

Tidy after any dependency change:

```bash
go mod tidy
```

Verify the module graph is consistent:

```bash
go mod verify
```

If `go mod tidy` fails with `GO111MODULE=off`:

```bash
export GO111MODULE=on
go mod tidy
```

## Swagger / OpenAPI generation

Install `swag` if not present:

```bash
go install github.com/swaggo/swag/cmd/swag@latest
```

Generate docs from annotations:

```bash
swag init -g cmd/server/main.go -o docs/
```

## Recommended workflow before committing

```
go build ./...          # confirm it compiles
go test -race ./...     # full suite with race detector
golangci-lint run ./... # static analysis
```

If the project has a Makefile with these targets, use `make build test lint` instead.
