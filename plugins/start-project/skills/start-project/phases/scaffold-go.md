# Scaffold: Go

Not a standalone phase — `phases/07-scaffold.md` directs reading this file at
its step 1, after determining `docs/stack.md` frontmatter `language: go`. It
contains only steps A–E, run from phase 7's step 3. Every step is guarded for
re-entry: check whether its output exists before creating it.

## A. Init

Two separate guards — a manifest can exist without the dependency installed:

- If `go.mod` does **not** exist, ask for the module path (default
  `example.com/<slug>` — a valid, collision-free placeholder the user
  replaces with their real host/org; do **not** synthesize one from `git
  config user.name`, which can contain spaces or capitals that make an
  invalid module path) and run `go mod init <module-path>`.
- **Always** ensure godog is present, even on resume: if `github.com/cucumber/godog`
  isn't already a require in `go.mod`, run `go get github.com/cucumber/godog`.

```bash
go mod init <module-path>          # only if go.mod is absent
go get github.com/cucumber/godog   # skip only if already required in go.mod
```

## B. Skeleton

For each module in `docs/arch-rules.yaml`, guard on `doc.go`, not the
directory — an interrupted run can leave an empty `internal/<module>/` that
`go list ./internal/...` chokes on. If `internal/<module>/doc.go` is missing
(whether or not the directory exists), create it:

```bash
mkdir -p internal/<module>
```

```go
// internal/<module>/doc.go
// Package <module> — <purpose from architecture.md>
package <module>
```

## C. Architecture test

If `architecture_test.go` already exists at the repo root, verify it matches
the current `arch-rules.yaml` module list and skip to step D.

Write `architecture_test.go` at the repo root, generated from
`arch-rules.yaml`. Dependency-free — it shells `go list -json ./internal/...`
and asserts each package's `Imports` (filtered to the module prefix) fall
within `may_import`, fails on any package whose module is **not** declared in
`arch-rules.yaml`, and fails if a declared module has no package. Adapt
`modulePrefix` and the `mayImport` map to the actual module path and module
list; the body is otherwise load-bearing as written:

```go
package main_test

// Generated from docs/arch-rules.yaml — regenerate, don't hand-edit.

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

const modulePrefix = "<module-path>/internal/"

var mayImport = map[string][]string{
	"domain":   {},
	"services": {"domain"},
	"adapters": {"domain", "services"},
}

func TestArchitecture(t *testing.T) {
	out, err := exec.Command("go", "list", "-json", "./internal/...").Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	seen := map[string]bool{}
	dec := json.NewDecoder(bytes.NewReader(out))
	for {
		var pkg struct {
			ImportPath string
			Imports    []string
		}
		if err := dec.Decode(&pkg); err != nil {
			break
		}
		mod := strings.SplitN(strings.TrimPrefix(pkg.ImportPath, modulePrefix), "/", 2)[0]
		seen[mod] = true
		allowedList, declared := mayImport[mod]
		if !declared {
			t.Errorf("undeclared module %q (%s) — not in arch-rules.yaml", mod, pkg.ImportPath)
			continue
		}
		allowed := map[string]bool{}
		for _, m := range allowedList {
			allowed[m] = true
		}
		for _, imp := range pkg.Imports {
			if !strings.HasPrefix(imp, modulePrefix) {
				continue
			}
			target := strings.SplitN(strings.TrimPrefix(imp, modulePrefix), "/", 2)[0]
			if target != mod && !allowed[target] {
				t.Errorf("%s imports %s — not in may_import[%q]", pkg.ImportPath, imp, mod)
			}
		}
	}
	for mod := range mayImport {
		if !seen[mod] {
			t.Errorf("declared module %q has no package under internal/", mod)
		}
	}
}
```

## D. BDD specs

Skip to step E only if **both** are already present: a
`features/<epic-slug>.feature` file for every epic in `docs/STORIES.md`
**and** the `bdd_test.go` harness at the repo root. If the feature files
exist but `bdd_test.go` is missing, generate it before skipping — without
the harness the scenarios never run, so the BDD specs would pass green
instead of the required red.

Write `features/<epic-slug>.feature` per epic — same STORIES.md mapping as
Python: `### Story:` → `Scenario:`; story title → scenario name; epic →
`Feature:`; Given/When/Then bullets → steps, where each `- Given …, When …,
Then …` bullet splits into three Gherkin step lines (`Given` / `When` /
`Then`). When a story has multiple bullets, subsequent bullets' steps
either use `And` under the corresponding keyword or repeat the keyword —
still one `Scenario:` per story regardless of bullet count.

Then, if not already present, one `bdd_test.go` at the repo root defining
`func TestFeatures(t *testing.T)` that runs godog over `features/` via
`godog.TestSuite` with `Options{Format: "pretty", Paths: []string{"features"},
TestingT: t, Strict: true}`, failing the test when `Run() != 0`.

No step definitions — undefined steps fail the run only because `Strict:
true` is set (godog's non-strict default passes on undefined steps); that
failure is the red state.

## E. Run & show output

Always rerun, even on re-entry — the exit gate needs current output, not a
stale run from an earlier session. Use `-count=1` on every `go test` here:
Go caches passing test results and would otherwise print a stale `(cached)`
green that hides a real regression.

```bash
go test -count=1 -run TestArchitecture ./...
```
Expect: PASS.

```bash
go test -count=1 -run TestFeatures ./...
```
Expect: FAIL (undefined/pending steps).

Paste both outputs into phase 7's exit gate.
