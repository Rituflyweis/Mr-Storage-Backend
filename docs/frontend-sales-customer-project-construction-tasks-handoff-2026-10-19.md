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

When the Construction panel has **not** created manual `Task` rows yet, the API **falls back** to **lifecycle steps** (same data as Construction **`GET /api/construction/projects/:leadId/phases`**). Check **`data.tasksSource`**:

| `tasksSource` | Meaning |
|---------------|---------|
| `task_records` | Rows from **`Task`** collection (created in Construction → Tasks) |
| `lifecycle_plant_pipeline` | **Default fallback** — 13 plant stages from *Released to Plant* → *Delivered* |
| `lifecycle_active_phase` | Only the current Figma phase bucket (e.g. Design → 3 steps) — query `?lifecycleScope=active_phase` |
| `lifecycle_full` | All 21 lifecycle steps — query `?lifecycleScope=full` |

**Construction vs Sales (same project):**

| Construction `…/phases` | Sales `…/construction-tasks` |
|---------------------------|------------------------------|
| `steps[]` — **21** items (sales funnel + plant) | `projectProgress.steps[]` — **same 21** when fallback runs |
| `phases[]` — **5** buckets (Planning → Handover) | `projectProgress.phases[]` — **same 5** |
| Full tracker UI | `constructionTasks[]` — **cards** for the horizontal row (default **13** plant steps, not 21) |

Cards from lifecycle include **`source: "lifecycle"`** and **`stepKey`** (not a Mongo task `_id`). If the response has **no** `tasksSource` / `projectProgress`, prod is on an **older backend** — redeploy `shubham-changes-13-aug`.

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
    "projectProgress": {
      "overallProgressPct": 57,
      "currentStepLabel": "BOM Review",
      "currentStepNumber": 12,
      "totalSteps": 21,
      "phases": []
    },
    "scope": "sales_assigned_construction"
  }
}
```

**Lifecycle fallback (default `tasksSource: "lifecycle_plant_pipeline"`)** — 13 plant cards for daniels-style projects. Use `?lifecycleScope=active_phase` for 3 cards or `full` for 21. Task detail by id applies only when **`tasksSource === "task_records"`**.

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
