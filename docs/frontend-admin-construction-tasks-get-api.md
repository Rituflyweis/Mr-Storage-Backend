# Admin panel — Construction tasks (GET APIs)

**Base URL:** `https://mr-storage-backend-025k.onrender.com/api/admin/construction`  
**Auth:** `Authorization: Bearer <admin-token>`  
**Role:** `admin` only

Same **Task** data as the construction app, but the admin list is shaped for a **Kanban board** (`board`) and uses **`projectId`** instead of `leadId`. There is **no** separate `GET /tasks/stats` on admin.

Work logs (admin): [`frontend-admin-construction-work-logs-get-api.md`](./frontend-admin-construction-work-logs-get-api.md)  
Construction app tasks: [`frontend-construction-tasks-get-api.md`](./frontend-construction-tasks-get-api.md)

---

## 1. List tasks (board + flat list)

```http
GET /api/admin/construction/tasks
```

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `projectId` | No | Project Mongo `_id` (same as `leadId` elsewhere) |
| `assignedTo` | No | User `_id` |
| `status` | No | `todo` · `in_progress` · `done` |
| `priority` | No | `low` · `medium` · `high` |
| `startDate` | No | **dueDate** ≥ start (ISO) |
| `endDate` | No | **dueDate** ≤ end (ISO) |

There is **no** `search`, `page`, or `limit` on this endpoint — all matching tasks are returned in one response.

### Example request

```http
GET https://mr-storage-backend-025k.onrender.com/api/admin/construction/tasks?projectId=68f1a2b3c4d5e6f7a8b9c0d1&status=in_progress
Authorization: Bearer <token>
```

### Example response (`200`)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "total": 12,
      "completed": 48,
      "inProgress": 15,
      "overdue": 3
    },
    "board": {
      "todo": [
        {
          "_id": "68f2a1b2c3d4e5f6a7b8c9d0",
          "title": "Site inspection",
          "description": "",
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
          "priority": "high",
          "status": "todo",
          "dueDate": "2026-06-15T00:00:00.000Z",
          "notes": "",
          "createdBy": "69e79dc9e3d92b7f3e1df429",
          "createdAt": "2026-05-10T08:00:00.000Z",
          "updatedAt": "2026-05-10T08:00:00.000Z"
        }
      ],
      "in_progress": [],
      "done": []
    },
    "tasks": []
  }
}
```

### Response fields

| Field | Purpose |
|-------|---------|
| `board.todo` / `board.in_progress` / `board.done` | Kanban columns (same task objects as in `tasks`) |
| `tasks` | Flat array of **all** tasks matching the filter (same rows as in `board`, combined) |
| `stats.total` | Count of tasks matching **current filter** |
| `stats.completed` / `stats.inProgress` | Global counts by status (not filtered by `projectId`) |
| `stats.overdue` | Global overdue count (due date passed, not `done`) |

Sort: **`createdAt` descending** on the underlying query.

---

## Admin vs construction (`GET /api/construction/tasks`)

| | **Admin** | **Construction** |
|--|-----------|------------------|
| Path | `/api/admin/construction/tasks` | `/api/construction/tasks` |
| Project filter | `projectId` | `leadId` |
| Pagination | No | `page`, `limit` (default 50) |
| Search | No | `search` on title/description |
| Extra shape | `board` + `tasks` | `tasks` + scoped `stats` |
| Stats endpoint | Included in list only | Optional `GET /tasks/stats` |

---

## Write APIs (reference)

| Method | Path |
|--------|------|
| POST | `/api/admin/construction/tasks` |
| PUT | `/api/admin/construction/tasks/:taskId` |
| DELETE | `/api/admin/construction/tasks/:taskId` |

**POST body (required: `title`, `leadId`)**

```json
{
  "title": "Steel Frame Installation",
  "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
  "description": "Install steel frame floors 1-5",
  "assignedTo": "68e79dc9e3d92b7f3e1df429",
  "priority": "high",
  "dueDate": "2026-02-15",
  "notes": ""
}
```

---

## Errors

| HTTP | When |
|------|------|
| `401` | Missing or invalid token |
| `403` | Not `admin` role |
