# Alignment and Layout Algorithms

## Alignment Operations

All alignment operations work by computing target coordinates from a set of elements, then updating their `x` and `y` properties.

### Center-Align Vertically (align on vertical axis)

Align elements so their horizontal centers share the same x-coordinate.

```
target_x = reference_element.x + reference_element.width / 2

For each element:
  element.x = target_x - element.width / 2
```

If no reference element is specified, use the average center:

```
avg_center_x = mean(element.x + element.width / 2 for each element)

For each element:
  element.x = avg_center_x - element.width / 2
```

### Center-Align Horizontally (align on horizontal axis)

Align elements so their vertical centers share the same y-coordinate.

```
target_y = reference_element.y + reference_element.height / 2

For each element:
  element.y = target_y - element.height / 2
```

### Left-Align

```
target_x = min(element.x for each element)

For each element:
  element.x = target_x
```

### Right-Align

```
target_x = max(element.x + element.width for each element)

For each element:
  element.x = target_x - element.width
```

### Top-Align

```
target_y = min(element.y for each element)

For each element:
  element.y = target_y
```

### Bottom-Align

```
target_y = max(element.y + element.height for each element)

For each element:
  element.y = target_y - element.height
```

## Distribution Operations

### Distribute Horizontally (even spacing)

Space elements evenly along the x-axis.

```
Sort elements by x position.
total_element_width = sum(element.width for each element)
leftmost_x = first_element.x
rightmost_edge = last_element.x + last_element.width
available_space = rightmost_edge - leftmost_x - total_element_width
gap = available_space / (n - 1)

current_x = leftmost_x
For each element (sorted by x):
  element.x = current_x
  current_x += element.width + gap
```

### Distribute Vertically (even spacing)

Same algorithm on the y-axis.

```
Sort elements by y position.
total_element_height = sum(element.height for each element)
topmost_y = first_element.y
bottommost_edge = last_element.y + last_element.height
available_space = bottommost_edge - topmost_y - total_element_height
gap = available_space / (n - 1)

current_y = topmost_y
For each element (sorted by y):
  element.y = current_y
  current_y += element.height + gap
```

### Distribute with Fixed Gap

When a specific gap is requested:

```
Sort elements by position.
current_pos = first_element position

For each element (sorted):
  element.x = current_pos  (or .y for vertical)
  current_pos += element.width + requested_gap  (or .height)
```

## Snap to Grid

Round coordinates to the nearest grid multiple:

```
grid_size = 20  (default)

element.x = round(element.x / grid_size) * grid_size
element.y = round(element.y / grid_size) * grid_size
```

Optionally snap dimensions too:
```
element.width = round(element.width / grid_size) * grid_size
element.height = round(element.height / grid_size) * grid_size
```

## Layout Patterns

### Row Layout

Place elements in a horizontal row, centered vertically:

```
start_x = 100
start_y = 200
gap = 60

current_x = start_x
max_height = max(element.height for each element)

For each element:
  element.x = current_x
  element.y = start_y + (max_height - element.height) / 2  # vertical center
  current_x += element.width + gap
```

### Column Layout

Place elements in a vertical column, centered horizontally:

```
start_x = 200
start_y = 100
gap = 60

current_y = start_y
max_width = max(element.width for each element)

For each element:
  element.x = start_x + (max_width - element.width) / 2  # horizontal center
  element.y = current_y
  current_y += element.height + gap
```

### Grid Layout

Arrange elements in an n-column grid:

```
columns = 3
gap_x = 60
gap_y = 60
start_x = 100
start_y = 200

cell_width = max(element.width) + gap_x
cell_height = max(element.height) + gap_y

For each element at index i:
  col = i % columns
  row = i // columns
  element.x = start_x + col * cell_width + (cell_width - gap_x - element.width) / 2
  element.y = start_y + row * cell_height + (cell_height - gap_y - element.height) / 2
```

### Centered Inside Container

Place an element at the center of a container:

```
element.x = container.x + (container.width - element.width) / 2
element.y = container.y + (container.height - element.height) / 2
```

### Arrange Pods Inside Namespace

A common K8s pattern — row of pods inside a namespace container with padding:

```
padding = 40
pod_gap = 40
pods_start_x = namespace.x + padding
pods_y = namespace.y + 60  # offset for namespace label

current_x = pods_start_x
For each pod:
  pod.x = current_x
  pod.y = pods_y
  current_x += pod.width + pod_gap
```

## Moving Elements

When asked to move an element, compute the delta and apply to all related elements:

```
dx = new_x - element.x
dy = new_y - element.y

element.x = new_x
element.y = new_y

# Move grouped elements by same delta
For each element in same group:
  grouped.x += dx
  grouped.y += dy

# Move bound text by same delta
For each bound text:
  text.x += dx
  text.y += dy
```

Arrows with bindings auto-adjust in Excalidraw when the file is opened — no need to recalculate arrow points for bound arrows. For unbound arrows, update the start/end points manually.

## Arrow Routing

### Straight Arrows

For elements aligned on the same axis:
```
points: [[0, 0], [target_x - arrow_x, target_y - arrow_y]]
```

### L-Shaped Arrows

For elements on different axes, use a midpoint:
```
mid_x = (source_right_edge + target_left_edge) / 2
points: [[0, 0], [mid_x - arrow_x, 0], [mid_x - arrow_x, target_center_y - arrow_y], [target_x - arrow_x, target_center_y - arrow_y]]
```

### Avoiding Overlaps

When arrows would cross elements, add waypoints to route around them. Add intermediate points in the `points` array to create detours.
