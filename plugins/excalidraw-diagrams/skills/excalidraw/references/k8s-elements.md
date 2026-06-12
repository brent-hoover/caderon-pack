# Kubernetes Excalidraw Elements

Compound shapes built from Excalidraw primitives to represent Kubernetes resources. Each element follows the Timonier style guide colors.

## Namespace

A large dashed rectangle containing other resources.

```json
{
  "id": "ns_production",
  "type": "rectangle",
  "x": 40,
  "y": 80,
  "width": 800,
  "height": 500,
  "strokeColor": "#4A90D9",
  "backgroundColor": "#E8F0FE",
  "fillStyle": "hachure",
  "strokeWidth": 2,
  "strokeStyle": "dashed",
  "roughness": 1,
  "opacity": 100,
  "roundness": {"type": 3},
  "boundElements": [{"id": "ns_production_label", "type": "text"}]
}
```

Namespace label (bound text, top-left positioning):

```json
{
  "id": "ns_production_label",
  "type": "text",
  "text": "namespace: production",
  "fontSize": 16,
  "fontFamily": 3,
  "textAlign": "left",
  "verticalAlign": "top",
  "containerId": "ns_production"
}
```

## Pod

Rounded rectangle in green with label.

```json
{
  "id": "pod_web_1",
  "type": "rectangle",
  "x": 500,
  "y": 300,
  "width": 120,
  "height": 60,
  "strokeColor": "#34A853",
  "backgroundColor": "#E6F4EA",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 1,
  "roundness": {"type": 3},
  "boundElements": [{"id": "pod_web_1_label", "type": "text"}]
}
```

```json
{
  "id": "pod_web_1_label",
  "type": "text",
  "text": "web-pod",
  "fontSize": 16,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "pod_web_1"
}
```

## Service

Rectangle in blue. For ClusterIP, NodePort, LoadBalancer — use label to distinguish.

```json
{
  "id": "svc_api",
  "type": "rectangle",
  "x": 300,
  "y": 200,
  "width": 140,
  "height": 70,
  "strokeColor": "#4285F4",
  "backgroundColor": "#E8F0FE",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roundness": null,
  "boundElements": [{"id": "svc_api_label", "type": "text"}]
}
```

```json
{
  "id": "svc_api_label",
  "type": "text",
  "text": "api-svc\n(ClusterIP)",
  "fontSize": 16,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "svc_api"
}
```

## Deployment / StatefulSet / DaemonSet

Purple rectangle. Use a small type indicator label above.

```json
{
  "id": "deploy_api",
  "type": "rectangle",
  "x": 300,
  "y": 280,
  "width": 160,
  "height": 80,
  "strokeColor": "#9B59B6",
  "backgroundColor": "#F3E8FD",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roundness": null,
  "boundElements": [{"id": "deploy_api_label", "type": "text"}]
}
```

```json
{
  "id": "deploy_api_label",
  "type": "text",
  "text": "Deployment\napi-server",
  "fontSize": 16,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "deploy_api"
}
```

For StatefulSet, use the same shape with label `"StatefulSet\ndb-cluster"`. For DaemonSet: `"DaemonSet\nlog-agent"`.

## Ingress / Gateway

Orange rectangle with distinctive shape.

```json
{
  "id": "ing_main",
  "type": "diamond",
  "x": 100,
  "y": 200,
  "width": 140,
  "height": 100,
  "strokeColor": "#F5A623",
  "backgroundColor": "#FEF3E2",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "boundElements": [{"id": "ing_main_label", "type": "text"}]
}
```

```json
{
  "id": "ing_main_label",
  "type": "text",
  "text": "Ingress\n*.example.com",
  "fontSize": 14,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": "ing_main"
}
```

## ConfigMap

Gray rectangle.

```json
{
  "id": "cm_app_config",
  "type": "rectangle",
  "x": 500,
  "y": 400,
  "width": 120,
  "height": 60,
  "strokeColor": "#95A5A6",
  "backgroundColor": "#F1F3F4",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roundness": {"type": 3},
  "boundElements": [{"id": "cm_app_config_label", "type": "text"}]
}
```

## Secret

Red cross-hatched rectangle — visually distinct to flag sensitive resources.

```json
{
  "id": "secret_db_creds",
  "type": "rectangle",
  "x": 500,
  "y": 480,
  "width": 120,
  "height": 60,
  "strokeColor": "#E74C3C",
  "backgroundColor": "#FDE8E8",
  "fillStyle": "cross-hatch",
  "strokeWidth": 2,
  "roundness": {"type": 3},
  "boundElements": [{"id": "secret_db_creds_label", "type": "text"}]
}
```

## PersistentVolume / PersistentVolumeClaim

Amber rectangle. Use PV for the volume, PVC for the claim.

```json
{
  "id": "pvc_data",
  "type": "rectangle",
  "x": 600,
  "y": 300,
  "width": 120,
  "height": 60,
  "strokeColor": "#D4A017",
  "backgroundColor": "#FFF8E1",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roundness": null,
  "boundElements": [{"id": "pvc_data_label", "type": "text"}]
}
```

## Node

Large rectangle with dark gray border representing a cluster node.

```json
{
  "id": "node_worker_1",
  "type": "rectangle",
  "x": 20,
  "y": 60,
  "width": 900,
  "height": 600,
  "strokeColor": "#5F6368",
  "backgroundColor": "#F8F9FA",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roundness": null,
  "boundElements": [{"id": "node_worker_1_label", "type": "text"}]
}
```

## HPA (Horizontal Pod Autoscaler)

Small pink element, typically connected to a deployment with a dashed arrow.

```json
{
  "id": "hpa_api",
  "type": "rectangle",
  "x": 480,
  "y": 270,
  "width": 100,
  "height": 50,
  "strokeColor": "#E91E63",
  "backgroundColor": "#FCE4EC",
  "fillStyle": "solid",
  "strokeWidth": 1,
  "roundness": {"type": 3},
  "boundElements": [{"id": "hpa_api_label", "type": "text"}]
}
```

Connect HPA to its target with a dashed arrow:
```json
{
  "strokeStyle": "dashed",
  "strokeColor": "#E91E63"
}
```

## CronJob / Job

Teal rectangle.

```json
{
  "id": "cj_backup",
  "type": "rectangle",
  "x": 600,
  "y": 400,
  "width": 140,
  "height": 60,
  "strokeColor": "#1ABC9C",
  "backgroundColor": "#E0F2F1",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "roundness": null,
  "boundElements": [{"id": "cj_backup_label", "type": "text"}]
}
```

## Common Patterns

### Deployment with ReplicaSet and Pods

Show the hierarchy: Deployment → contains replica pods. Arrange pods horizontally inside or below the deployment box.

### Service → Deployment → Pods Chain

Standard left-to-right flow:
1. Service (blue) with arrow to
2. Deployment (purple) containing
3. Pod replicas (green, arranged horizontally)

### Ingress → Service Fan-out

Diamond ingress element with arrows fanning to multiple services, representing path-based routing.

### Namespace Isolation

Two namespace boxes side by side. Services in different namespaces connected with labeled arrows showing cross-namespace DNS (`svc.namespace.svc.cluster.local`).

### Database Pattern (StatefulSet + PVC)

StatefulSet (purple, label "StatefulSet") with arrow to PVC (amber), pods inside or below the StatefulSet. Optionally add a Secret (red, cross-hatch) with dashed arrow to the pods.
