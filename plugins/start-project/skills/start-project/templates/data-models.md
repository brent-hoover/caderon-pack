---
phase: data-models
status: draft
approved: null
date: <YYYY-MM-DD>
---
<!-- CONTRACT: Core entities — fields, types, invariants, relationships —
     shaped to translate directly into Pydantic V2 models or Go structs.
     Storage technology lives in stack.md; module boundaries in
     architecture.md (each entity is assigned to one of its modules). -->

# <Product Name> — Data models

## Entities

### <Entity>
- **Module:** <module from architecture.md>
- **Fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| <name> | <type> | <yes/no> | <constraints, defaults> |

- **Invariants:** <rules that must always hold, one line each>

## Relationships

```mermaid
erDiagram
    <ENTITY> ||--o{ <ENTITY> : <relation>
```
