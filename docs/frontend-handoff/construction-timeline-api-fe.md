# Construction Panel — Timeline & Upcoming Schedule API

**Audience:** Construction panel (mobile/web) — **Project Timeline (Overall)** and **Upcoming Schedule** widgets (same data model as Admin → Construction overview task cards).

| Item | Value |
|------|--------|
| **Prod base** | `https://mr-storage-backend-025k.onrender.com` |
| **Prefix** | `/api/construction` |
| **Auth** | `Authorization: Bearer <jwt>` |
| **Roles** | `construction`, `admin` |

Related: full dashboard payload → [`docs/frontend-construction-dashboard-api.md`](../frontend-construction-dashboard-api.md).

---

## 1. Overview

Two UI patterns from Figma:

| Widget | Data source |
|--------|-------------|
| **Project Timeline (Overall)** | 5 phases: Planning → Design → Procurement → Execution → Handover, derived from **plant lifecycle** + `lifecycleHistory` |
| **Upcoming Schedule** | Open **Task** rows with `dueDate` in the next N days (badges, start/est. end) — same as Admin `GET /api/admin/construction/overview` |

User-created dated tasks (Construction task UI) also live under **`GET …/timeline-tasks`**.

---

## 2. Dashboard (recommended — both widgets in one call)

```http
GET /api/construction/dashboard
Authorization: Bearer <token>
```

### Query (timeline-related)

| Param | Default | Notes |
|--------|---------|--------|
| `projectId` | — | Scope timeline + tasks to one lead |
| `leadId` | — | Alias of `projectId` |
| `buildingId` | — | Resolves to lead via building |
| `status` / `lifecycleStatus` | — | Plant stage filter |
| `businessUnit` | — | From dashboard filters |
| `taskDeadlineDays` | `30` | Upcoming task window (1–90) |
| `taskLimit` | `10` | Max schedule rows (1–50) |

### Response fields (timeline)

```json
{
  "success": true,
  "data": {
    "projectTimelineOverall": [
      {
        "key": "planning",
        "label": "Planning",
        "date": "2026-07-30T15:07:13.344Z",
        "status": "Completed"
      },
      {
        "key": "design",
        "label": "Design",
        "date": "2026-08-18T10:49:08.797Z",
        "status": "Completed"
      },
      {
        "key": "procurement",
        "label": "Procurement",
        "date": null,
        "status": "Inprogress"
      },
      {
        "key": "execution",
        "label": "Execution",
        "date": null,
        "status": "Upcoming"
      },
      {
        "key": "handover",
        "label": "Handover",
        "date": null,
        "status": "Upcoming"
      }
    ],
    "upcomingConstructionTasks": [
      {
        "taskId": "66f0aa11bb22cc33dd44ee55",
        "title": "Site prep inspection",
        "status": "in_progress",
        "priority": "high",
        "startDate": "2026-08-01T00:00:00.000Z",
        "estimatedEndDate": "2026-08-15T00:00:00.000Z",
        "completedDate": null,
        "timelineBadge": { "label": "In Progress", "tone": "info" },
        "timelineStatusLine": "In Progress",
        "onTimeStatus": "on_track",
        "daysLeft": 6,
        "assignedTo": { "_id": "...", "name": "Alex", "email": "alex@example.com" },
        "project": {
          "leadId": "...",
          "projectName": "Warehouse A",
          "jobId": "PRO-002",
          "location": "Austin, TX",
          "lifecycleStatus": "fabrication_started"
        }
      }
    ],
    "upcomingSchedule": [],
    "upcomingScheduleMeta": {
      "source": "timeline_tasks",
      "openTaskCount": 3,
      "taskDeadlineDays": 30
    },
    "upcomingDeadlines": []
  }
}
```

### FE mapping

| UI | Bind to |
|----|---------|
| **Project Timeline (Overall)** | `data.projectTimelineOverall[]` |
| Phase label | `label` |
| Date under phase | `date` (ISO or null) |
| Badge | `status`: **`Completed`** \| **`Inprogress`** \| **`Upcoming`** |
| **Upcoming Schedule** list | Prefer `data.upcomingSchedule` |
| If no tasks in window | `upcomingScheduleMeta.source` = `"project_end_dates"` → rows match `upcomingDeadlines` (project `endDate`, not task cards) |
| Task card badges | `timelineBadge`, `timelineStatusLine`, `daysLeft` |

---

## 3. Timeline only (lightweight)

```http
GET /api/construction/timeline/overall?projectId=<leadId>
Authorization: Bearer <token>
```

Same filter params as dashboard (`projectId`, `buildingId`, `status`, `businessUnit`).

**Response `data`:**

```json
{
  "filtersApplied": {
    "projectId": null,
    "buildingId": null,
    "status": null,
    "businessUnit": null
  },
  "projectCount": 12,
  "projectTimelineOverall": []
}
```

Use when the screen only needs the 5-phase strip without full dashboard KPIs.

---

## 4. Single project — 5-phase + granular steps

```http
GET /api/construction/projects/:leadId/timeline
Authorization: Bearer <token>
```

Project must be in **construction scope** (plant lifecycle stages). Otherwise **400**.

**Response `data` (abbreviated):**

```json
{
  "project": {
    "leadId": "...",
    "projectName": "Lucas project",
    "jobId": "PRO-002",
    "location": "Austin, TX",
    "lifecycleStatus": "fabrication_started"
  },
  "projectTimelineOverall": [],
  "timeline": [],
  "steps": [],
  "overallProgressPct": 45,
  "currentStepLabel": "Fabrication Started",
  "timelineTasksEndpoint": "/api/construction/projects/<leadId>/timeline-tasks"
}
```

| Field | Use |
|--------|-----|
| `timeline` / `projectTimelineOverall` | Same 5-phase array as dashboard |
| `steps` | Granular lifecycle steps (optional detail drawer) |
| `timelineTasksEndpoint` | Link to user-added **Task** timeline |

---

## 5. User-added timeline tasks (Task collection)

```http
GET /api/construction/projects/:leadId/timeline-tasks?page=1&limit=20
Authorization: Bearer <token>
```

Dated construction tasks created in the panel (not the 5-phase lifecycle rollup).

**Response `data`:**

```json
{
  "project": { "leadId": "...", "projectName": "...", "jobId": "..." },
  "timelineTasks": [],
  "total": 0,
  "stats": {},
  "dataSource": "task_records"
}
```

Create/update tasks via existing `POST/PUT /api/construction/tasks`.

---

## 6. Admin parity

| Admin | Construction |
|--------|----------------|
| `GET /api/admin/construction/overview` | `GET /api/construction/dashboard` |
| `upcomingConstructionTasks` / `upcomingSchedule` | `upcomingConstructionTasks` / `upcomingSchedule` |
| Task query: `taskDeadlineDays`, `taskLimit` on overview | Same on construction dashboard |

Admin **live site** cards use a wider lifecycle mapping; construction **timeline** uses **plant-only** phase buckets (matches construction dashboard Figma).

---

## 7. Phase keys (enum for UI)

| `key` | `label` |
|--------|---------|
| `planning` | Planning |
| `design` | Design |
| `procurement` | Procurement |
| `execution` | Execution |
| `handover` | Handover |

Timeline phase **`status`** (display only): `Completed` | `Inprogress` | `Upcoming`.

Task **`status`** (Task model): `todo` | `in_progress` | `done`.

---

## 8. cURL smoke tests

```bash
BASE="https://mr-storage-backend-025k.onrender.com"
TOKEN="<construction_jwt>"

curl -s "$BASE/api/construction/dashboard?taskDeadlineDays=30&taskLimit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.projectTimelineOverall, .data.upcomingScheduleMeta'

curl -s "$BASE/api/construction/timeline/overall" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.projectTimelineOverall'

curl -s "$BASE/api/construction/projects/<leadId>/timeline" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.timeline'
```

---

## 9. Checklist

- [ ] Dashboard loads `projectTimelineOverall` for timeline strip
- [ ] Upcoming Schedule uses `upcomingSchedule`; handle empty state + `upcomingScheduleMeta.source`
- [ ] Project detail uses `GET …/projects/:leadId/timeline` when filtered to one job
- [ ] Optional: `GET …/timeline-tasks` for editable task list
- [ ] Pass `taskDeadlineDays` / `taskLimit` to match admin behavior
