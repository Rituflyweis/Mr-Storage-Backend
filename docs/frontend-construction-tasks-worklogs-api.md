# Construction panel — Tasks & Daily Work Logs (GET APIs)

**Base URL:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `construction` | `admin`

**How they relate:** **Tasks** = planned work (assignee, due date, status). **Work logs** = daily site diary (optional link to a task via `taskId`). Creating a work log does **not** update task status automatically.

---

# Section A — Tasks

## A1. List tasks

```http
GET /api/construction/tasks
```

### Query parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `leadId` | ObjectId | No | Filter one project |
| `status` | enum | No | `todo` · `in_progress` · `done` |
| `priority` | enum | No | `low` · `medium` · `high` |
| `assignedTo` | ObjectId | No | User assigned to the task |
| `search` | string | No | Case-insensitive match on **title** or **description** |
| `startDate` | ISO date | No | Filter **dueDate** ≥ start (use with `endDate`) |
| `endDate` | ISO date | No | Filter **dueDate** ≤ end |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `50` |

### Example

```http
GET /api/construction/tasks?leadId=68f1a2b3c4d5e6f7a8b9c0d1&status=in_progress&page=1&limit=20
```

### Success response (`200`)

```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "_id": "…",
        "title": "Install wall panels",
        "description": "…",
        "leadId": {
          "_id": "…",
          "projectName": "Storage Namra",
          "jobId": "2026001"
        },
        "assignedTo": {
          "_id": "…",
          "name": "John Smith",
          "email": "john@example.com"
        },
        "createdBy": {
          "_id": "…",
          "name": "…",
          "email": "…"
        },
        "priority": "medium",
        "status": "in_progress",
        "dueDate": "2026-06-01T00:00:00.000Z",
        "completedAt": null,
        "notes": "",
        "attachments": [],
        "createdAt": "…",
        "updatedAt": "…"
      }
    ],
    "total": 12,
    "stats": {
      "total": 12,
      "todo": 4,
      "inProgress": 5,
      "done": 3,
      "overdue": 1
    }
  }
}
```

**Notes for FE:**

- List is sorted **`createdAt` descending** (newest first).
- **`stats`** counts respect `leadId` when passed (project-scoped cards); **`total`** in pagination is the filtered list count.
- **`overdue`:** `dueDate` before now and `status` ≠ `done`.

---

## A2. Task stats (global dashboard cards)

Use when the screen shows **all projects** totals without loading the full task list.

```http
GET /api/construction/tasks/stats
```

No query parameters.

### Success response (`200`)

```json
{
  "success": true,
  "data": {
    "stats": {
      "total": 48,
      "completed": 20,
      "inProgress": 15,
      "overdue": 3
    }
  }
}
```

| Field | Maps to task `status` |
|-------|------------------------|
| `completed` | `done` |
| `inProgress` | `in_progress` |
| `overdue` | due date passed, not `done` |

---

## A3. Related GET — project progress (single project)

Not under `/tasks`, but used on **Tasks & Progress** for one project:

```http
GET /api/construction/projects/:leadId/progress
```

Returns task counts, milestones, and timeline for that project.

---

# Section B — Daily work logs

## B1. List work logs

```http
GET /api/construction/work-logs
```

### Query parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `leadId` | ObjectId | No | Filter one project (recommended on project detail) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20` |

There is **no** `search`, `status`, or date-range filter on this endpoint today.

### Example

```http
GET /api/construction/work-logs?leadId=68f1a2b3c4d5e6f7a8b9c0d1&page=1&limit=20
```

### Success response (`200`)

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "_id": "…",
        "leadId": {
          "_id": "…",
          "projectName": "Storage Namra",
          "jobId": "2026001"
        },
        "taskId": {
          "_id": "…",
          "title": "Install wall panels"
        },
        "loggedBy": {
          "_id": "…",
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        "date": "2026-05-19T00:00:00.000Z",
        "progress": 63,
        "description": "Completed foundation excavation according to plan",
        "photos": ["https://…/photo.jpg"],
        "issues": "Minor delay due to rain",
        "createdAt": "…",
        "updatedAt": "…"
      }
    ],
    "total": 5
  }
}
```

**Notes for FE:**

- Sorted by **`date` descending** (newest log date first).
- **`taskId`** may be `null` if the log was not tied to a task.
- **`progress`:** number `0–100` on the log entry only; does not sync to the linked task.

---

## B2. Create work log (reference)

```http
POST /api/construction/work-logs
Content-Type: application/json

{
  "leadId": "<required>",
  "date": "<required>",
  "taskId": "<optional Task _id>",
  "progress": 63,
  "description": "…",
  "photos": ["https://…"],
  "issues": "…"
}
```

---

## Quick comparison

| | **GET /tasks** | **GET /work-logs** |
|--|----------------|-------------------|
| Purpose | Task board / assignments | Daily work history |
| Scope filter | `leadId` + many filters | `leadId` only |
| Search | `search` on title/description | Not supported |
| Extra payload | Inline `stats` | — |
| Sort | Newest created | Newest log `date` |

---

## Errors

| Code | When |
|------|------|
| `401` | Missing or invalid token |
| `403` | Role not `construction` or `admin` |
