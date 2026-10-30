# Admin Construction Overview — Upcoming Project Deadlines (tasks)

**Status:** Ready  
**Date:** 29 Oct 2026  
**Auth:** `Authorization: Bearer <admin JWT>`  
**Endpoint:** `GET /api/admin/construction/overview`

Bind the Figma **Upcoming Project Deadlines** / **Upcoming Schedule** widgets to **construction timeline tasks** (same Task records as Construction Panel), not Lead `expectedCloseDate`.

---

## 1. Why this changed

Previously the overview only returned project close dates (`Lead.expectedCloseDate`). That often yielded **0** rows even when Construction Panel had tasks with estimated / completed times.

Overview now returns open tasks with:

| Field | Source |
|-------|--------|
| Start | `startDate` (fallback `createdAt`) |
| Estimated end | `dueDate` → `estimatedEndDate` |
| Completed | `completedAt` → `completedDate` (null while open) |
| Badge / status line | Same enricher as Construction Panel cards |

---

## 2. Query params (new, optional)

Existing filters still apply (`projectId`, `status`, `startDate`, `endDate`, `buildingLabel`).

| Param | Default | Max | Meaning |
|-------|---------|-----|---------|
| `taskDeadlineDays` | `30` | `90` | Include open tasks whose **estimated end** is on/before now + N days (**overdue included**) |
| `taskLimit` | `10` | `50` | Max rows in the task list |

Example:

```http
GET /api/admin/construction/overview?taskDeadlineDays=30&taskLimit=10
Authorization: Bearer <token>
```

With project filter:

```http
GET /api/admin/construction/overview?projectId=<leadId>&taskDeadlineDays=30
```

---

## 3. What to bind (FE)

### Prefer these keys

| UI | Response key |
|----|----------------|
| Deadline list / schedule rows | **`upcomingConstructionTasks`** |
| Same rows (Figma “Upcoming Schedule” alias) | **`upcomingSchedule`** (task-shaped; see below) |
| Top KPI “upcoming deadlines” count | **`stats.upcomingDeadlinesCount`** |

### Do not use for this widget

| Key | Meaning |
|-----|---------|
| `upcomingDeadlines` | Legacy Lead `expectedCloseDate` list (project close, not tasks) |
| `upcomingProjectCloseDates` | Same as `upcomingDeadlines` (explicit alias) |

---

## 4. Response shape (task rows)

```json
{
  "success": true,
  "data": {
    "stats": {
      "totalProjects": 12,
      "onTrack": 8,
      "delayed": 2,
      "completed": 2,
      "completionRate": 17,
      "upcomingDeadlinesCount": 4,
      "taskDeadlineDays": 30
    },
    "upcomingConstructionTasks": [
      {
        "taskId": "672a…",
        "title": "Foundation pour",
        "status": "in_progress",
        "priority": "high",
        "startDate": "2026-10-20T00:00:00.000Z",
        "estimatedEndDate": "2026-10-28T00:00:00.000Z",
        "completedDate": null,
        "timelineBadge": { "label": "Delayed", "tone": "danger" },
        "timelineStatusLine": "2 Days Delayed",
        "onTimeStatus": "overdue",
        "daysLeft": -2,
        "assignedTo": {
          "_id": "…",
          "name": "Jane Doe",
          "email": "jane@…"
        },
        "project": {
          "leadId": "…",
          "projectName": "Acme Warehouse",
          "jobId": "JOB-1042",
          "location": "Dallas, TX",
          "lifecycleStatus": "fabrication_started"
        }
      }
    ],
    "upcomingSchedule": [
      {
        "taskId": "672a…",
        "title": "Foundation pour",
        "projectName": "Acme Warehouse",
        "location": "Dallas, TX",
        "startDate": "2026-10-20T00:00:00.000Z",
        "estimatedEndDate": "2026-10-28T00:00:00.000Z",
        "completedDate": null,
        "endDate": "2026-10-28T00:00:00.000Z",
        "expectedCloseDate": "2026-10-28T00:00:00.000Z",
        "timelineBadge": { "label": "Delayed", "tone": "danger" },
        "timelineStatusLine": "2 Days Delayed",
        "daysLeft": -2,
        "status": "in_progress",
        "assignedTo": { "_id": "…", "name": "Jane Doe", "email": "jane@…" },
        "project": { "leadId": "…", "projectName": "Acme Warehouse", "jobId": "JOB-1042", "location": "Dallas, TX", "lifecycleStatus": "fabrication_started" }
      }
    ],
    "upcomingDeadlines": [],
    "upcomingProjectCloseDates": []
  }
}
```

`upcomingSchedule` mirrors `upcomingConstructionTasks` with flat `projectName` / `location` and `endDate` / `expectedCloseDate` set to **estimated end** so older schedule bindings keep working after switching to tasks.

---

## 5. Field reference (row)

| Field | Type | Notes |
|-------|------|--------|
| `taskId` | ObjectId | Task `_id` |
| `title` | string | Task title |
| `status` | `todo` \| `in_progress` \| `done` | Open tasks only (`done` excluded) |
| `priority` | `low` \| `medium` \| `high` | |
| `startDate` | ISO \| null | Planned start |
| `estimatedEndDate` | ISO \| null | Planned end (`dueDate`) |
| `completedDate` | ISO \| null | Always null here (open tasks) |
| `timelineBadge` | `{ label, tone }` | Same as Construction Panel |
| `timelineStatusLine` | string \| null | e.g. `"2 Days Delayed"`, `"In Progress"` |
| `onTimeStatus` | string | `pending` \| `in_progress` \| `overdue` \| … |
| `daysLeft` | number \| null | Calendar days until estimated end; **negative = overdue** |
| `assignedTo` | object \| null | `{ _id, name, email }` |
| `project.*` | object | Parent lead / job context |

### Suggested row UI

- **Title:** `title`
- **Project:** `project.projectName` (+ `jobId` if needed)
- **Start / Est. end / Completed:** `startDate` · `estimatedEndDate` · `completedDate`
- **Chip:** `timelineBadge.label` (tone → color)
- **Subline:** `timelineStatusLine` or `daysLeft` (“Due in 3 days” / “2 days overdue”)

---

## 6. Inclusion rules

A task is counted / listed when **all** are true:

1. `status` ≠ `done`
2. `dueDate` is set
3. `dueDate` ≤ now + `taskDeadlineDays` (**overdue tasks are included**)
4. Parent lead matches overview filters when `projectId` / `status` / date range are passed

Sorted by `estimatedEndDate` ascending (soonest / most overdue first).

Empty list + `upcomingDeadlinesCount: 0` is valid when no open tasks have due dates in the window.

---

## 7. FE checklist

- [ ] Point **Upcoming Project Deadlines** at `data.upcomingConstructionTasks` (or `upcomingSchedule`)
- [ ] Point KPI number at `data.stats.upcomingDeadlinesCount`
- [ ] Render start / estimated end / completed (+ badge) like Construction Panel cards
- [ ] Stop treating `upcomingDeadlines[].expectedCloseDate` as the deadline widget source
- [ ] Optional: pass `taskLimit` / `taskDeadlineDays` if the widget needs more than 10 / 30 days
- [ ] Optional deep-link: open Construction Panel / project using `project.leadId` + `taskId`

---

## 8. Related APIs

| Surface | Path |
|---------|------|
| Construction Panel timeline tasks | `GET /api/construction/projects/:leadId/timeline-tasks` (or sales equivalent) |
| Admin overview filters | `GET /api/admin/construction/overview/filters` |
