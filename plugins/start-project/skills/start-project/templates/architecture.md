---
phase: architecture
status: draft
approved: null
rules: ./arch-rules.yaml
date: <YYYY-MM-DD>
---
<!-- CONTRACT: Module boundaries and WHY they sit where they do. The
     machine-readable source of truth is arch-rules.yaml — this doc must
     agree with it exactly. Entity shapes live in data-models.md. -->

# <Product Name> — Architecture

## Style
<layered | hexagonal | pipeline | ... and why it fits the system shape from
vision.md.>

## Modules
| Module | Purpose | May import |
|--------|---------|------------|
| <name> | <one line> | <comma list or "nothing"> |

## Rationale
<Why these boundaries: what each protects, where change is expected,
what the dependency direction buys.>

## Enforcement
Rules are codified in [arch-rules.yaml](./arch-rules.yaml) and generated
into architecture tests at scaffold time (see docs/scaffold.md once
scaffolded). The YAML is the source of truth; regenerate tests rather than
hand-editing them.
