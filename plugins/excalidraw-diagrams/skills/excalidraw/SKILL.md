---
name: excalidraw
description: This skill should be used when the user asks to "create a diagram", "draw an architecture diagram", "make an excalidraw diagram", "create a network topology", "draw a k8s diagram", "generate an excalidraw file", "update the diagram", "align elements", "move boxes", or mentions excalidraw, architecture diagrams, or infrastructure diagrams.
---

# Excalidraw Diagram Generator

Generate and iteratively edit Excalidraw (`.excalidraw`) JSON files for architecture, network topology, and Kubernetes infrastructure diagrams.

## Core Workflow

### Creating a New Diagram

1. Identify the diagram type (K8s architecture, network topology, general architecture)
2. Determine which components are needed — consult `references/k8s-elements.md` for K8s resources
3. Apply the company style guide from `references/style-guide.md` for colors and conventions
4. Plan the layout — group related elements, establish hierarchy, determine flow direction
5. Generate the `.excalidraw` JSON file using the format in `references/excalidraw-format.md`
6. Write the file and inform the user to open it in the Excalidraw desktop app

### Editing an Existing Diagram

1. Read the current `.excalidraw` file
2. Parse the elements array to understand current state
3. Apply the requested changes (move, recolor, add, remove, align)
4. Write the updated file — the Excalidraw app will reflect changes on reload

## Layout Principles

### Spacing and Grid

- Use a 20px base grid for all positioning
- Standard element sizes: small (120x60), medium (180x80), large (240x100)
- Minimum 40px gap between elements, 60px preferred
- Namespace/group containers: 40px padding inside borders

### Flow Direction

- **K8s diagrams**: Left-to-right (ingress → service → deployment → pod) or top-to-bottom
- **Network diagrams**: Top-to-bottom (internet → edge → core → workloads)
- **Architecture diagrams**: Follow data flow direction, typically left-to-right

### Alignment Commands

For precise alignment, calculate coordinates mathematically:

- **Center-align vertically**: Set all elements to the same `x + width/2` value
- **Center-align horizontally**: Set all elements to the same `y + height/2` value
- **Distribute evenly**: Calculate total span, divide by (n-1) gaps, set positions arithmetically
- **Snap to grid**: Round x/y to nearest multiple of 20

## Element ID Generation

Generate unique IDs for each element using random alphanumeric strings (10+ characters). Every element must have a unique `id`. Use a consistent prefix per diagram for readability (e.g., `ns_`, `pod_`, `svc_`).

## Arrow/Connection Rules

- Arrows connect elements via `startBinding` and `endBinding` referencing element IDs
- Add arrow IDs to the `boundElements` array of connected elements
- Use `"type": "arrow"` with appropriate `startArrowhead` and `endArrowhead`
- For labeled connections, add a text element bound to the arrow

## Grouping

- Group related elements using matching `groupIds` arrays
- Namespace containers should NOT group their children (children should be independently movable)
- K8s icon compound shapes (shape + label) SHOULD be grouped

## File Output

- Default output path: current working directory with descriptive filename (e.g., `k8s-architecture.excalidraw`)
- Always use `.excalidraw` extension
- Set `"type": "excalidraw"` and `"version": 2` in the file root
- Include `"appState"` with sensible defaults (grid enabled, white background)

## Templates

Check `assets/templates/` for reusable starting points. When a template matches the requested diagram type, start from the template rather than from scratch.

## Additional Resources

### Reference Files

- **`references/excalidraw-format.md`** — Complete Excalidraw JSON format specification with element types and properties
- **`references/k8s-elements.md`** — Kubernetes component shapes built from Excalidraw primitives with JSON snippets
- **`references/style-guide.md`** — Company color palette, typography, and visual conventions
- **`references/alignment.md`** — Detailed alignment and layout algorithms with examples

### Asset Files

- **`assets/templates/`** — Starter templates for common diagram types
