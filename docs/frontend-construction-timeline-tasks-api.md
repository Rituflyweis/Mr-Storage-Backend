# Construction panel — Project Construction Task (timeline)

**Base:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** Bearer · roles **`construction`**, **`admin`**

This doc matches the **Project Construction Task** block on **Project Details** (horizontal cards, **+ Add**, eye detail modal, **Mark Complete**).

## Figma → API map

| UI | API |
|----|-----|
| **+ Add** modal — Step | `POST /tasks` → `title` |
| Start Date | `startDate` (ISO) |
| EST End Date | `estimatedEndDate` or `dueDate` |
| Work Description | `description` or `workDescription` |
| Upload Photos | Upload via `POST /media/:leadId`, then pass URL strings in `attachments[]` |
| Card row | `GET /projects/:leadId/timeline-tasks` → `timelineTasks` (sort client-side by `startDate` asc) |
| Start / Est End / Completed lines | `startDate`, `estimatedEndDate`, `completedDate` (format dates in UI) |
| Status pill on card | `timelineBadge.label` + `timelineBadge.tone` |
| **Mark Complete** (card or modal) | `PUT /tasks/:taskId/complete` (optional `completedAt`; default now) |
| Eye → detail modal | `GET /tasks/:taskId` |
| Modal header status (red text) | `timelineStatusLine` (e.g. `2 Days Delayed`) |
| **Mark as Completed** (modal) | Same `PUT .../complete` |
| **Remove Task** | `DELETE /tasks/:taskId` |

### Status pill labels (server-computed)

| `timelineBadge.label` | When |
|------------------------|------|
| **Under timeline** | Done, on/before est. end **or** exactly **1** calendar day late (Figma card 1) |
| **N Days Late** | Done, **2+** calendar days after est. end (Figma card 2) |
| **Delayed** | Not done, today past est. end |
| **In Progress** | `status: in_progress`, still within est. end |
| **Pending** | `todo`, not past due yet |

| `timelineBadge.tone` | Typical UI color |
|----------------------|------------------|
| `success` | Green (Under timeline, N Days Late on card) |
| `danger` | Red (Delayed) |
| `info` | Blue (In Progress) |

Show **Mark Complete** when `canMarkComplete === true` (`status !== done`).

---

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
        "completedDate": null,
        "onTimeStatus": "in_progress",
        "onTime": null,
        "daysLateOrEarly": 0,
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

## Create timeline task (with expected end date)

```http
POST /api/construction/tasks
Content-Type: application/json
```

| Field | Required | Maps to |
|-------|----------|---------|
| `title` | Yes | Task title |
| `leadId` | Yes | Project id |
| `startDate` | No | Planned start (defaults to **now**) |
| `dueDate` or `estimatedEndDate` | No | **Expected end** → `estimatedEndDate` on cards |
| `assignedTo`, `priority`, `description`, `status` | No | `todo` / `in_progress` / `done` |

```json
{
  "title": "Site Preparation & Foundation",
  "leadId": "6ac589d8cac1607a9f248d82",
  "startDate": "2026-04-12T00:00:00.000Z",
  "estimatedEndDate": "2026-04-13T00:00:00.000Z",
  "description": "Work completed on site prep…",
  "attachments": ["https://…/photo1.jpg"],
  "status": "in_progress"
}
```

**Response `200`:** `data.task` includes card fields (`startDate`, `estimatedEndDate`, `timelineBadge`, …).

---

## Task detail (eye icon)

```http
GET /api/construction/tasks/{taskId}
```

Returns `data.task` with the same card fields as the list (`description`, `attachments`, `timelineStatusLine`, …).

---

## Mark complete (actual completion date)

```http
PUT /api/construction/tasks/{taskId}/complete
Content-Type: application/json

{
  "completedAt": "2026-04-14T00:00:00.000Z",
  "workDescription": "Optional update to work description",
  "attachments": ["https://…/photo2.jpg"]
}
```

Alias: **`completedDate`** instead of `completedAt`. If omitted, server uses **now**.

Sets `status: done` and stores **`completedAt`** → shown as **`completedDate`** on timeline cards.

Alternative: `PUT /api/construction/tasks/:taskId` with `{ "status": "done", "completedAt": "…" }`.

---

## On-time vs late (read from list/detail)

Each enriched task includes:

| Field | Values | UI |
|-------|--------|-----|
| `onTimeStatus` | `pending` · `in_progress` · `overdue` · `on_time` · `early` · `late` · `unknown` | Primary logic |
| `onTime` | `true` · `false` · `null` | Simple boolean when done / overdue |
| `daysLateOrEarly` | number | Calendar days **after** est. end if late (positive), **before** if early (negative) |
| `timelineBadge.label` | Figma pills above | Pill on card |
| `timelineStatusLine` | Detail modal status row | e.g. `2 Days Delayed` while open & overdue |
| `daysPastDue` | — | Calendar days past est. end (not done) |
| `canMarkComplete` | Show Mark Complete button | `true` when not `done` |

Comparison uses **calendar days** between `estimatedEndDate` (`dueDate`) and `completedDate` (`completedAt`) for finished tasks; `daysPastDue` uses est. end → today for open tasks.

---

## Update / delete

```http
PUT    /api/construction/tasks/:taskId
DELETE /api/construction/tasks/:taskId
```

See also [`frontend-construction-tasks-get-api.md`](./frontend-construction-tasks-get-api.md).

---

## Lifecycle phases (optional — plant-only steps)

To hide sales-funnel steps in the **lifecycle** view:

```http
GET /api/construction/projects/{leadId}/phases?stepsScope=plant
```

Returns only **plant** lifecycle stages (`released_to_plant` → `delivered`), not `initial_contact`, `proposal_sent`, etc.
