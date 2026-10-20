# Construction panel — Timeline tasks (per project)

**Base:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** Bearer · roles **`construction`**, **`admin`**

## What this is (vs lifecycle `/phases`)

| API | Data | Use in UI |
|-----|------|-----------|
| **`GET /projects/:leadId/timeline-tasks`** | **`Task`** documents — dates, assignee, status | **Construction timeline** section — tasks **added by Construction** for this project |
| **`GET /projects/:leadId/phases`** | Lead **lifecycle** (sales + plant stages) | **Pipeline / phase tracker** — not the same as timeline tasks |
| **`GET /tasks?leadId=`** | Same `Task` rows as timeline-tasks | List/board; timeline-tasks adds **card** fields (`timelineBadge`, `startDate`, …) |

Sales read-only mirror: **`GET /api/sales/construction/projects/:leadId/construction-tasks`** (same `Task` data).

Until Construction creates tasks (`POST /api/construction/tasks`), timeline responses are **`[]`** — that is expected.

---

## GET timeline tasks (recommended for timeline UI)

```http
GET /api/construction/projects/{leadId}/timeline-tasks
Authorization: Bearer <token>
```

Optional query: same as **`GET /tasks`** — `status`, `priority`, `assignedTo`, `search`, `startDate`, `endDate`, `page`, `limit`.

### Example `200`

```json
{
  "success": true,
  "data": {
    "project": {
      "leadId": "6ac589d8cac1607a9f248d82",
      "projectName": "daniels Project",
      "jobId": "2026018"
    },
    "timelineTasks": [
      {
        "_id": "68f2…",
        "title": "Foundation prep",
        "status": "in_progress",
        "startDate": "2026-10-12T08:00:00.000Z",
        "estimatedEndDate": "2026-10-20T00:00:00.000Z",
        "timelineBadge": { "label": "In Progress", "tone": "info" }
      }
    ],
    "total": 1,
    "stats": { "total": 1, "todo": 0, "inProgress": 1, "done": 0, "overdue": 0 },
    "dataSource": "task_records"
  }
}
```

---

## Create / update tasks

```http
POST /api/construction/tasks
PUT  /api/construction/tasks/:taskId
```

Body: `title`, `leadId`, `assignedTo`, `priority`, `status`, `dueDate`, … — see [`frontend-construction-tasks-get-api.md`](./frontend-construction-tasks-get-api.md).

---

## Lifecycle phases (optional — plant-only steps)

To hide sales-funnel steps in the **lifecycle** view:

```http
GET /api/construction/projects/{leadId}/phases?stepsScope=plant
```

Returns only **plant** lifecycle stages (`released_to_plant` → `delivered`), not `initial_contact`, `proposal_sent`, etc.
