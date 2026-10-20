# Sales panel — Project Construction Tasks (read-only)

**Base URL:** `https://mr-storage-backend-025k.onrender.com/api/sales/construction`  
**Auth:** `Authorization: Bearer <sales_jwt>`  
**Role:** `sales`

Powers the **Project Construction Task** card row on **Sales** — including **Customer tab → project detail** (see [`frontend-sales-customer-project-construction-tasks-handoff-2026-10-19.md`](./frontend-sales-customer-project-construction-tasks-handoff-2026-10-19.md)). Same underlying **`Task`** records as Construction timeline tasks (`GET /api/construction/projects/:leadId/timeline-tasks` or `GET /api/construction/tasks?leadId=…`). **Not** the lifecycle **`/phases`** pipeline (Sales/Admin/Plant stages).

Empty list = no tasks created yet in Construction (`POST /api/construction/tasks`). See [`frontend-construction-timeline-tasks-api.md`](./frontend-construction-timeline-tasks-api.md).

Construction panel task CRUD remains under `/api/construction/tasks` (construction/admin roles).

Related: [Construction tasks GET](./frontend-construction-tasks-get-api.md) · [Sales construction calendar](./frontend-features-8-12-api.md#11-sales--construction-calendar-read-only)

---

## 1. Project detail — construction task cards (recommended)

```http
GET /api/sales/construction/projects/:leadId/construction-tasks
```

### Query parameters (optional)

| Param | Description |
|-------|-------------|
| `status` | `todo` · `in_progress` · `done` |
| `priority` | `low` · `medium` · `high` |
| `assignedTo` | User `_id` |
| `search` | Title or description (case-insensitive) |
| `startDate` | Filter **dueDate** ≥ (ISO date) |
| `endDate` | Filter **dueDate** ≤ (ISO date) |
| `page` | Default `1` |
| `limit` | Default `50`, max `100` |

### Example

```http
GET https://mr-storage-backend-025k.onrender.com/api/sales/construction/projects/68f1a2b3c4d5e6f7a8b9c0d1/construction-tasks
Authorization: Bearer <token>
```

### Example response (`200`)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
      "projectName": "Storage Namra",
      "jobId": "2026001"
    },
    "constructionTasks": [
      {
        "_id": "68f2a1b2c3d4e5f6a7b8c9d0",
        "title": "Site Preparation & Foundation",
        "description": "",
        "leadId": {
          "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
          "projectName": "Storage Namra",
          "jobId": "2026001"
        },
        "assignedTo": null,
        "createdBy": { "_id": "69e…", "name": "Site Lead", "email": "lead@example.com" },
        "priority": "medium",
        "status": "done",
        "dueDate": "2026-04-13T00:00:00.000Z",
        "completedAt": "2026-04-14T00:00:00.000Z",
        "startDate": "2026-04-12T08:00:00.000Z",
        "estimatedEndDate": "2026-04-13T00:00:00.000Z",
        "completedDate": "2026-04-14T00:00:00.000Z",
        "timelineBadge": { "label": "Under timeline", "tone": "success" },
        "createdAt": "2026-04-12T08:00:00.000Z",
        "updatedAt": "2026-04-14T18:00:00.000Z"
      }
    ],
    "total": 4,
    "stats": {
      "total": 4,
      "todo": 0,
      "inProgress": 1,
      "done": 2,
      "overdue": 1
    },
    "scope": "sales_assigned_construction"
  }
}
```

### Card field mapping (Figma)

| UI label | API field |
|----------|-----------|
| Task title | `title` |
| Start | `startDate` (from task `createdAt` until a dedicated start field exists) |
| Est End / Est | `estimatedEndDate` (same as `dueDate`) |
| Completed | `completedDate` (same as `completedAt`; omit when null) |
| Status badge | `timelineBadge.label` |
| Badge color | `timelineBadge.tone`: `success` · `info` · `danger` · `neutral` |

### `timelineBadge` rules

| Condition | Label | Tone |
|-----------|-------|------|
| `status === "done"`, completed on or before due date | `Under timeline` | `success` |
| `status === "done"`, completed after due date | `N Days Late` | `success` |
| `status === "in_progress"`, due date in the past | `Delayed` | `danger` |
| `status === "in_progress"`, due date not passed | `In Progress` | `info` |
| `status === "todo"`, overdue | `Delayed` | `danger` |
| Otherwise | `Pending` | `neutral` |

Sort order: **`createdAt` descending** (newest first). For a left-to-right timeline, sort ascending by `startDate` on the client.

---

## 2. List tasks (alternate)

Same payload shape without the `project` wrapper; **`leadId` query param is required**.

```http
GET /api/sales/construction/tasks?leadId=68f1a2b3c4d5e6f7a8b9c0d1&status=in_progress
```

Response: `data.constructionTasks`, `data.total`, `data.stats`, `data.scope`.

---

## 3. Single task (view icon / detail modal)

```http
GET /api/sales/construction/tasks/:taskId
```

Returns `data.task` with the same card enrichment as above.

---

## Errors

| HTTP | When |
|------|------|
| `400` | Missing `leadId` on `GET /tasks` |
| `401` | Invalid token |
| `403` | Lead not assigned to this sales user |
| `404` | Unknown lead/task, archived/terminated lead, or lead not in construction lifecycle |

---

## Construction panel parity

| Panel | List tasks | Card fields |
|-------|------------|-------------|
| Construction | `GET /api/construction/tasks?leadId=` | Map client-side from `dueDate`, `completedAt`, `createdAt`, `status`, or reuse the same badge rules |
| Sales | `GET /api/sales/construction/projects/:leadId/construction-tasks` | `timelineBadge` + `startDate` / `estimatedEndDate` / `completedDate` included |

Tasks are **created/updated only** via Construction or Admin APIs, not Sales.
