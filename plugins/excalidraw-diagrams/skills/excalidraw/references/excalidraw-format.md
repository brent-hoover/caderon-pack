# Excalidraw JSON Format Reference

## File Structure

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "claude-generated",
  "elements": [],
  "appState": {
    "gridSize": 20,
    "gridStep": 5,
    "gridModeEnabled": true,
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

## Common Element Properties

Every element shares these base properties:

```json
{
  "id": "unique_string_id",
  "type": "rectangle",
  "x": 100,
  "y": 200,
  "width": 180,
  "height": 80,
  "angle": 0,
  "strokeColor": "#1e1e1e",
  "backgroundColor": "#ffffff",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "opacity": 100,
  "groupIds": [],
  "frameId": null,
  "index": "a0",
  "roundness": null,
  "seed": 1234567890,
  "version": 1,
  "versionNonce": 1234567890,
  "isDeleted": false,
  "boundElements": null,
  "updated": 1700000000000,
  "link": null,
  "locked": false
}
```

### Property Details

- **id**: Unique string. Use descriptive prefixes: `ns_prod`, `svc_api`, `pod_web`
- **seed**: Random integer for roughness rendering. Use any random number.
- **versionNonce**: Random integer. Use any random number.
- **index**: Fractional index for z-ordering. Use `"a0"`, `"a1"`, `"a2"`, etc. Lower = further back. Containers should have lower index than their contents.
- **roundness**: `null` for sharp corners, `{"type": 3}` for rounded corners
- **fillStyle**: `"solid"`, `"hachure"`, `"cross-hatch"`, `"dots"`
- **strokeStyle**: `"solid"`, `"dashed"`, `"dotted"`
- **boundElements**: Array of `{"id": "...", "type": "arrow"}` or `{"id": "...", "type": "text"}` for elements bound to this one

## Element Types

### Rectangle

```json
{
  "type": "rectangle",
  "x": 100,
  "y": 200,
  "width": 180,
  "height": 80,
  "roundness": null
}
```

For rounded rectangles: `"roundness": {"type": 3}`

### Ellipse

```json
{
  "type": "ellipse",
  "x": 100,
  "y": 200,
  "width": 120,
  "height": 80
}
```

### Diamond

```json
{
  "type": "diamond",
  "x": 100,
  "y": 200,
  "width": 120,
  "height": 120
}
```

### Text

Standalone text:

```json
{
  "type": "text",
  "x": 100,
  "y": 200,
  "width": 80,
  "height": 25,
  "text": "My Label",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": null,
  "originalText": "My Label",
  "autoResize": true,
  "lineHeight": 1.25
}
```

Text bound to a container (label inside a shape):

```json
{
  "type": "text",
  "text": "My Label",
  "fontSize": 20,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "parent_element_id",
  "originalText": "My Label",
  "autoResize": true,
  "lineHeight": 1.25
}
```

When binding text to a container, also add to the container's `boundElements`:
```json
"boundElements": [{"id": "text_element_id", "type": "text"}]
```

**Font families:**
- `1` — Virgil (hand-drawn, default)
- `2` — Helvetica (clean sans-serif)
- `3` — Cascadia (monospace)

### Arrow

```json
{
  "type": "arrow",
  "x": 280,
  "y": 240,
  "width": 120,
  "height": 0,
  "points": [[0, 0], [120, 0]],
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "startBinding": {
    "elementId": "source_element_id",
    "focus": 0,
    "gap": 4,
    "fixedPoint": null
  },
  "endBinding": {
    "elementId": "target_element_id",
    "focus": 0,
    "gap": 4,
    "fixedPoint": null
  },
  "roundness": {"type": 2}
}
```

**Arrowhead types:** `null` (none), `"arrow"`, `"dot"`, `"bar"`, `"triangle"`

**Binding:**
- `elementId`: ID of the element to bind to
- `focus`: -1 to 1, controls which side of the element the arrow connects to (0 = center)
- `gap`: pixel gap between arrow end and element border
- When an arrow binds to an element, add the arrow to that element's `boundElements` array

**Points:** Array of [x, y] offsets relative to the arrow's x, y position. First point is always [0, 0]. For a straight horizontal arrow 120px wide: `[[0, 0], [120, 0]]`. For bent arrows, add intermediate points.

### Line

```json
{
  "type": "line",
  "x": 100,
  "y": 200,
  "width": 200,
  "height": 0,
  "points": [[0, 0], [200, 0]],
  "startArrowhead": null,
  "endArrowhead": null
}
```

### Frame

Frames group elements visually (like Figma frames):

```json
{
  "type": "frame",
  "x": 50,
  "y": 50,
  "width": 500,
  "height": 400,
  "name": "Namespace: production"
}
```

Elements inside a frame set `"frameId": "frame_id"`.

## Grouping

Elements with the same group ID in their `groupIds` array move together:

```json
{
  "id": "rect1",
  "groupIds": ["group_abc"],
  ...
},
{
  "id": "text1",
  "groupIds": ["group_abc"],
  ...
}
```

Nested groups: `"groupIds": ["inner_group", "outer_group"]`

## Z-Ordering

Elements render in array order (first = bottom, last = top). Also controlled by `index` field:
- Containers/backgrounds: `"a0"`, `"a1"`
- Content elements: `"a2"`, `"a3"`
- Arrows/overlays: `"a4"`, `"a5"`

Place namespace/boundary rectangles before their contents in the elements array.

## Practical Tips

### Generating Seed Values

Use any random integer between 100000000 and 999999999. Each element needs its own unique seed.

### Calculating Text Width

Approximate: `text.length * fontSize * 0.6` for font family 1. Excalidraw will auto-resize on open if `autoResize: true`.

### Bound Text Positioning

When text has a `containerId`, Excalidraw auto-centers it. Set text `x` and `y` to the container center for best results, but Excalidraw recalculates on load.

### Container + Label Pattern

For a labeled rectangle:

1. Create the rectangle with `boundElements: [{"id": "lbl_id", "type": "text"}]`
2. Create the text with `containerId: "rect_id"`, `textAlign: "center"`, `verticalAlign: "middle"`
3. Group them if they should move together (optional — bound text follows container)
