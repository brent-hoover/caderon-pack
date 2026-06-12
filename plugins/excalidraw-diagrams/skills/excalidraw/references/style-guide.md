# Timonier Diagram Style Guide

## Color Palette

### Kubernetes Resources

| Resource Type | Fill Color | Stroke Color | Fill Style |
|---|---|---|---|
| Namespace | `#E8F0FE` (light blue) | `#4A90D9` (blue) | `hachure` |
| Pod | `#E6F4EA` (light green) | `#34A853` (green) | `solid` |
| Service | `#E8F0FE` (light blue) | `#4285F4` (blue) | `solid` |
| Deployment / StatefulSet / DaemonSet | `#F3E8FD` (light purple) | `#9B59B6` (purple) | `solid` |
| Ingress / Gateway | `#FEF3E2` (light orange) | `#F5A623` (orange) | `solid` |
| ConfigMap | `#F1F3F4` (light gray) | `#95A5A6` (gray) | `solid` |
| Secret | `#FDE8E8` (light red) | `#E74C3C` (red) | `cross-hatch` |
| PV / PVC | `#FFF8E1` (light amber) | `#D4A017` (amber) | `solid` |
| Node | `#F8F9FA` (near white) | `#5F6368` (dark gray) | `solid` |
| CronJob / Job | `#E0F2F1` (light teal) | `#1ABC9C` (teal) | `solid` |
| HPA | `#FCE4EC` (light pink) | `#E91E63` (pink) | `solid` |

### Infrastructure / Network

| Component | Fill Color | Stroke Color | Fill Style |
|---|---|---|---|
| Internet / External | `#FDE8E8` (light red) | `#E74C3C` (red) | `solid` |
| Load Balancer | `#E0F2F1` (light teal) | `#1ABC9C` (teal) | `solid` |
| Firewall | `#FDE8E8` (light red) | `#C0392B` (dark red) | `cross-hatch` |
| Database | `#E8F0FE` (light blue) | `#2C3E50` (navy) | `solid` |
| Cache (Redis, etc.) | `#FDE8E8` (light red) | `#E74C3C` (red) | `solid` |
| Queue (Kafka, RabbitMQ) | `#FEF3E2` (light orange) | `#E67E22` (dark orange) | `solid` |
| Cloud Provider | `#F1F3F4` (light gray) | `#5F6368` (dark gray) | `hachure` |
| VPC / Network | `#E8F0FE` (light blue) | `#4A90D9` (blue) | `hachure` |

### Semantic Colors for Arrows

| Arrow Purpose | Stroke Color |
|---|---|
| Data flow (default) | `#1e1e1e` (near black) |
| Network traffic | `#4285F4` (blue) |
| Error / alert path | `#E74C3C` (red) |
| Async / event | `#F5A623` (orange), dashed |
| Read path | `#34A853` (green) |
| Write path | `#9B59B6` (purple) |

## Typography

- **Labels**: Font size 20, font family 2 (Helvetica)
- **Titles / Headers**: Font size 28, font family 2
- **Small annotations**: Font size 16, font family 2
- **Technical labels** (ports, IPs): Font size 16, font family 3 (monospace / Cascadia)
- Text alignment: center for element labels, left for annotations

## Element Conventions

### Shapes

| Concept | Shape |
|---|---|
| Service / Process | Rectangle (rounded: no) |
| Database | Cylinder-like: rectangle with ellipse top (grouped) |
| Namespace / Boundary | Large rectangle, dashed stroke, strokeWidth 2 |
| Decision / Conditional | Diamond |
| External system | Rectangle with dashed stroke |
| User / Actor | Ellipse |
| Queue / Buffer | Rectangle with rounded appearance (roundness type 3) |

### Stroke Widths

- Default elements: `strokeWidth: 2`
- Containers / namespaces: `strokeWidth: 2`, `strokeStyle: "dashed"`
- Arrows: `strokeWidth: 2`
- Emphasis: `strokeWidth: 4`

### Roughness

- `roughness: 0` — Clean lines (standard for all diagrams)
- `roughness: 1` — Hand-drawn look (use only when explicitly requested)

## Layout Standards

- Base grid: 20px
- Element gap: 60px minimum between unrelated elements
- Group gap: 40px between elements within the same logical group
- Container padding: 40px inside namespace/boundary boxes
- Label offset: 10px below or inside element

## Diagram Titles

Place a title text element at top-left of the diagram:
- Font size 28
- Font family 1
- Color `#1e1e1e`
- Position: (40, 20) or top-left area
