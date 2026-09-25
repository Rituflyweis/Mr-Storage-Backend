# Construction dashboard — Frontend integration

> **Full Construction Panel fixes (dashboard + projects scope + material export) with complete request/response examples:**  
> **[`docs/frontend-construction-panel-fixes-api.md`](./frontend-construction-panel-fixes-api.md)**

**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <construction_or_admin_jwt>`  
**Role:** `construction` or `admin`

Powers the Construction Panel **Dashboard** (KPI cards, delivery/material donuts, active sites, deadlines, overall timeline, freight carriers, recent activity).

---

## 1. Filter lookups (dropdowns)

```http
GET /api/construction/dashboard/filters
Authorization: Bearer <token>
```

**Response `data`:**

| Field | Use |
|--------|-----|
| `projects[]` | `{ _id, projectName, jobId, lifecycleStatus, location }` — “All Projects” |
| `buildings[]` | `{ _id, leadId, buildingNumber, name, status }` — “All Buildings” |
| `statuses[]` | Plant lifecycle stage keys for status filter |

---

## 2. Dashboard (main payload)

```http
GET /api/construction/dashboard
Authorization: Bearer <token>
```

### Query params (all optional)

| Param | Aliases | Notes |
|--------|---------|--------|
| `projectId` | `leadId` | Mongo id of one project |
| `buildingId` | — | Mongo id from filters; scopes to that building’s lead |
| `status` | `lifecycleStatus` | e.g. `fabrication_started` |
| `fromDate` | `dateFrom` | ISO date — delivery/freight window start |
| `toDate` | `dateTo` | ISO date — delivery/freight window end |

**Default delivery scope:** if no `fromDate`/`toDate`, delivery overview + freight carriers use **today**.

### Example

```http
GET /api/construction/dashboard?projectId=66f1…&fromDate=2026-03-24&toDate=2026-03-31
```

---

## 3. Response map → UI widgets

| UI widget | Response path |
|-----------|----------------|
| Total Projects + “% by Yesterday” | `projectStats.total`, `projectStats.totalChangePctVsYesterday` |
| On Track / Delayed / Completed (+ %) | `projectStats.onTrack`, `.delayed`, `.completed` + `onTrackPct`, `delayedPct`, `completedPct` |
| Completion Rate | `projectStats.completionRate`, `completionRateLabel` |
| Upcoming Deadlines (count) | `projectStats.upcomingDeadlines` |
| Delivery Overview donut | `deliveryOverview` (`total`, statuses + `*Pct`; `scope` = `today` \| `range`) |
| Material Request Overview | `materialRequestOverview` (`pendingApproval`, `approved`, `rejected`, `urgent`, pcts) |
| Active Construction Sites | `activeSites[]` |
| Upcoming Project Deadlines list | `upcomingDeadlines[]` |
| Project Timeline (Overall) | `projectTimelineOverall[]` |
| Freight Carriers & Deliveries | `freightCarriers.rows` + `freightCarriers.totals` |
| Recent Activity | `recentActivity[]` |
| (legacy) Tasks rollup | `taskOverview` |
| (legacy) Recent deliveries | `recentDeliveries[]` |

### `projectStats`

```json
{
  "total": 18,
  "onTrack": 12,
  "delayed": 4,
  "completed": 2,
  "onTrackPct": 66.7,
  "delayedPct": 22.2,
  "completedPct": 11.1,
  "completionRate": 11,
  "upcomingDeadlines": 5,
  "totalChangePctVsYesterday": 15,
  "completionRateLabel": "Average Completion"
}
```

### `deliveryOverview`

```json
{
  "scope": "today",
  "fromDate": "...",
  "toDate": "...",
  "delivered": 11,
  "inTransit": 10,
  "outForDelivery": 4,
  "delayed": 3,
  "total": 28,
  "deliveredPct": 39.3,
  "inTransitPct": 35.7,
  "outForDeliveryPct": 14.3,
  "delayedPct": 10.7
}
```

### `materialRequestOverview`

```json
{
  "pendingApproval": 5,
  "approved": 6,
  "rejected": 2,
  "urgent": 6,
  "total": 14,
  "approvedPct": 42.9,
  "pendingApprovalPct": 35.7,
  "rejectedPct": 14.3
}
```

`urgent` = requests with `priority` `high` or `critical`.

### `activeSites[]`

| Field | UI |
|--------|-----|
| `projectName`, `site` | “Downtown office — Site A” |
| `progressPct` | Progress bar |
| `deadline` | Deadline date |
| `deliveryStatus` | `On Track` \| `In Transit` \| `Delayed` \| `Delivered` |

### `upcomingDeadlines[]`

`projectName`, `site` / `location`, `endDate`, `daysLeft`

### `projectTimelineOverall[]`

Five phases: **Planning → Design → Procurement → Execution → Handover**

```json
{
  "key": "planning",
  "label": "Planning",
  "date": "2024-01-14T00:00:00.000Z",
  "status": "Completed"
}
```

`status`: `Completed` | `Inprogress` | `Upcoming` (matches Figma labels).

### `freightCarriers`

```json
{
  "rows": [
    {
      "carrierId": "...",
      "carrierName": "Roadking Logistics",
      "loadsToday": 8,
      "onTime": 7,
      "delayed": 1,
      "priority": "Delayed"
    }
  ],
  "totals": {
    "totalLoadsToday": 34,
    "onTime": 29,
    "onTimePct": 85.3,
    "delayed": 5,
    "delayedPct": 14.7
  }
}
```

### `recentActivity[]`

```json
{
  "type": "shipper_file",
  "action": "shipper_file_submitted",
  "message": "New shipper file received for ABC Warehouse (...)",
  "occurredAt": "2026-03-24T17:00:14.000Z",
  "leadId": "...",
  "actorName": "...",
  "refId": "..."
}
```

`type`: `audit` | `shipper_file` | `production`

---

## 4. Checklist

- [ ] Load filters once → `GET .../dashboard/filters`
- [ ] Dashboard call with optional `projectId`, `buildingId`, `status`, date range
- [ ] KPI cards from `projectStats` (use `*Pct` and `totalChangePctVsYesterday`)
- [ ] Delivery donut from `deliveryOverview` (default = today)
- [ ] Material donut from `materialRequestOverview` (+ `urgent`)
- [ ] Sites table from `activeSites`
- [ ] Deadlines list from `upcomingDeadlines`
- [ ] Timeline from `projectTimelineOverall`
- [ ] Freight table + footer from `freightCarriers`
- [ ] Activity feed from `recentActivity`
