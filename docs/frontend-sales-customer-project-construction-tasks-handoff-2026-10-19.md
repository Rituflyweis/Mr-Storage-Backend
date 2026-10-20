# Sales panel — Customer tab → Project detail → Project Construction Task

**Date:** 2026-10-19  
**Audience:** Frontend (Sales)  
**Auth:** `Authorization: Bearer <sales_jwt>` · role **`sales`**  
**Prod base:** `https://mr-storage-backend-025k.onrender.com`

Full field reference (badges, stats, errors): [`frontend-sales-construction-tasks-api.md`](./frontend-sales-construction-tasks-api.md)

---

## 1. Where this fits in the UI

| Screen | Existing APIs (unchanged) | New section |
|--------|---------------------------|-------------|
| **Customers** list | `GET /api/sales/customers` | — |
| **Customer** profile | `GET /api/sales/customers/:customerId` | — |
| **Customer → Projects** | `GET /api/sales/customers/:customerId/projects` → each row has **`leadId`** (project id) | — |
| **Project detail** (customer context) | `GET /api/sales/leads/:leadId/detail` (header, progress, notes, activity, etc.) | **Project Construction Task** card row |

Construction tasks are **not** embedded in lead detail — load them in a **second request** using the same `leadId` from the project row or route param.

**Important:** This endpoint returns **`Task`** records only — the same timed tasks Construction adds per project (`POST /api/construction/tasks`). It does **not** mirror **`GET /api/construction/projects/:leadId/phases`** (company-wide lifecycle across Sales/Admin/Plant). If **`constructionTasks`** is empty, Construction has not created timeline tasks yet; show empty state or prompt Construction to add tasks. See [`frontend-construction-timeline-tasks-api.md`](./frontend-construction-timeline-tasks-api.md).

**`tasksSource`** is always **`task_records`** when tasks exist.

---

## 2. Primary API — horizontal task cards

```http
GET /api/sales/construction/projects/:leadId/construction-tasks
Authorization: Bearer <token>
```

| Param | Location | Notes |
|-------|----------|--------|
| `leadId` | path | Mongo `_id` — same as `GET .../customers/:customerId/projects` → `leadId` and `GET /api/sales/leads/:leadId/detail` |

### Optional query (filters)

| Query | Values |
|-------|--------|
| `status` | `todo` · `in_progress` · `done` |
| `priority` | `low` · `medium` · `high` |
| `assignedTo` | User `_id` |
| `search` | Title / description |
| `startDate` / `endDate` | Filter on task **dueDate** (ISO date) |
| `page` | Default `1` |
| `limit` | Default `50`, max `100` |

### Example

```http
GET https://mr-storage-backend-025k.onrender.com/api/sales/construction/projects/68f1a2b3c4d5e6f7a8b9c0d1/construction-tasks
Authorization: Bearer eyJ...
```

### Success `200` — use `data.constructionTasks[]`

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
        "status": "done",
        "priority": "medium",
        "dueDate": "2026-04-13T00:00:00.000Z",
        "completedAt": "2026-04-14T00:00:00.000Z",
        "startDate": "2026-04-12T08:00:00.000Z",
        "estimatedEndDate": "2026-04-13T00:00:00.000Z",
        "completedDate": "2026-04-14T00:00:00.000Z",
        "timelineBadge": { "label": "2 Days Late", "tone": "success" },
        "assignedTo": null,
        "createdBy": { "_id": "69e…", "name": "Site Lead", "email": "lead@example.com" },
        "leadId": {
          "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
          "projectName": "Storage Namra",
          "jobId": "2026001"
        },
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
    "tasksSource": "task_records",
    "scope": "sales_assigned_construction"
  }
}
```

### Figma card mapping

| UI | API |
|----|-----|
| Task title | `title` |
| **Start** | `startDate` (display formatted, e.g. `12 April 2026`) |
| **Est End** | `estimatedEndDate` (= `dueDate`) |
| **Completed** | `completedDate` — hide row if `null` |
| Status pill text | `timelineBadge.label` (`Under timeline`, `2 Days Late`, `In Progress`, `Delayed`, …) |
| Pill color | `timelineBadge.tone`: `success` · `info` · `danger` · `neutral` |
| Eye / view | `GET /api/sales/construction/tasks/:taskId` (§3) |

**Sort for timeline (left → right):** client sort by `startDate` ascending. Default API order is `createdAt` descending.

---

## 3. Task detail (eye icon / modal)

```http
GET /api/sales/construction/tasks/:taskId
Authorization: Bearer <token>
```

Response: `data.task` — same enriched fields as each card (`startDate`, `estimatedEndDate`, `completedDate`, `timelineBadge`, populated `leadId`, `assignedTo`, `createdBy`).

---

## 4. Access rules (important for Customer → Project detail)

The server checks **before** returning tasks:

1. Lead exists; not **terminated** / **archived**
2. **`assignedSales`** = logged-in sales user
3. **`lifecycleStatus`** ∈ **`PLANT_LIFECYCLE_STAGES`** (plant / construction pipeline — from `released_to_plant` through `delivered`)

| HTTP | Meaning |
|------|---------|
| `403` | Lead not assigned to this sales user |
| `404` | Unknown lead, archived/terminated, or **not in plant/construction lifecycle** |

**UI suggestion:** On project detail, if `GET .../construction-tasks` returns **404**, hide the section or show “Construction tasks available after project is released to plant.” Early sales stages (`payment_done`, `deal_closed`, etc.) do **not** pass this guard even if Figma shows the section on a mock.

Lead detail (`GET /api/sales/leads/:leadId/detail`) uses a **broader** sales guard; construction tasks use the **stricter** rule above.

---

## 5. Alternate list endpoint

Same cards, no `project` wrapper; **`leadId` query required**:

```http
GET /api/sales/construction/tasks?leadId=68f1a2b3c4d5e6f7a8b9c0d1
```

Prefer **`GET .../projects/:leadId/construction-tasks`** on project detail (includes `project` summary + same `stats`).

---

## 6. Who creates tasks?

Sales is **read-only**. Tasks are created/updated in **Construction** or **Admin**:

| Action | API |
|--------|-----|
| List (construction role) | `GET /api/construction/tasks?leadId=` |
| CRUD | `POST/PUT/DELETE /api/construction/tasks` |
| Admin | `GET/POST/PUT/DELETE /api/admin/construction/tasks` |

---

## 7. Suggested frontend load sequence

```text
1. GET /api/sales/customers/:customerId/projects     → pick leadId
2. GET /api/sales/leads/:leadId/detail               → page header / progress / notes
3. GET /api/sales/construction/projects/:leadId/construction-tasks   → card row
4. (optional) GET /api/sales/construction/tasks/:taskId              → modal on eye click
```

Related on same project detail screen: final delivery → [`frontend-sales-project-delivery-detail-api-handoff-2026-10-19.md`](./frontend-sales-project-delivery-detail-api-handoff-2026-10-19.md).
