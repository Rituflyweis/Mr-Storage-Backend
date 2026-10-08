# Construction panel — Tasks (GET APIs)

**Base URL:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `construction` | `admin`

Tasks are **planned work** on a project (assignee, due date, status). For daily site diary entries, use **work logs** → [`frontend-construction-work-logs-get-api.md`](./frontend-construction-work-logs-get-api.md).

---

## 1. List tasks

```http
GET /api/construction/tasks
```

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `leadId` | No | Filter by project Mongo `_id` |
| `status` | No | `todo` · `in_progress` · `done` |
| `priority` | No | `low` · `medium` · `high` |
| `assignedTo` | No | User `_id` assigned to the task |
| `search` | No | Case-insensitive **title** or **description** |
| `startDate` | No | **dueDate** ≥ start (ISO date) |
| `endDate` | No | **dueDate** ≤ end (ISO date) |
| `page` | No | Default `1` |
| `limit` | No | Default `50` |

### Example request

```http
GET https://mr-storage-backend-025k.onrender.com/api/construction/tasks?leadId=68f1a2b3c4d5e6f7a8b9c0d1&status=in_progress&page=1&limit=20
Authorization: Bearer <token>
```

### Example response (`200`)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "tasks": [
      {
        "_id": "68f2a1b2c3d4e5f6a7b8c9d0",
        "title": "Install wall panels",
        "description": "Level 1 east elevation",
        "leadId": {
          "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
          "projectName": "Storage Namra",
          "jobId": "2026001"
        },
        "assignedTo": {
          "_id": "68e79dc9e3d92b7f3e1df429",
          "name": "John Smith",
          "email": "john@example.com"
        },
        "createdBy": {
          "_id": "69e79dc9e3d92b7f3e1df429",
          "name": "Site Lead",
          "email": "lead@example.com"
        },
        "priority": "medium",
        "status": "in_progress",
        "dueDate": "2026-06-01T00:00:00.000Z",
        "completedAt": null,
        "notes": "",
        "attachments": [],
        "createdAt": "2026-05-10T08:00:00.000Z",
        "updatedAt": "2026-05-15T14:30:00.000Z"
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

### Behaviour

- Sort: **`createdAt` descending** (newest first).
- **`data.total`**: count for the **current filter** (pagination).
- **`data.stats`**: when `leadId` is sent, stats are for that project; otherwise all tasks.
- **`overdue`**: `dueDate` before now and `status` ≠ `done`.

---

## 2. Task stats (dashboard cards)

Global totals without loading the full task list.

```http
GET /api/construction/tasks/stats
```

No query parameters.

### Example response (`200`)

```json
{
  "success": true,
  "message": "Success",
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

| Field | Meaning |
|-------|---------|
| `completed` | Tasks with `status: "done"` |
| `inProgress` | Tasks with `status: "in_progress"` |
| `overdue` | Past due date, not `done` |

---

## 3. Related GET — project progress

Used on **Tasks & Progress** for one project (not under `/tasks` path):

```http
GET /api/construction/projects/:leadId/progress
```

Returns `taskProgress`, `milestones`, and `timeline` for that `leadId`.

---

## Errors

| HTTP | When |
|------|------|
| `401` | Missing or invalid token |
| `403` | Role not `construction` or `admin` |

---

## Write APIs (reference)

| Method | Path |
|--------|------|
| POST | `/api/construction/tasks` |
| PUT | `/api/construction/tasks/:taskId` |
| DELETE | `/api/construction/tasks/:taskId` |
