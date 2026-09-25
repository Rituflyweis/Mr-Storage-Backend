# Construction panel API — frontend integration (fixes)

**Date:** 2026-09-25  
**Audience:** Frontend (Construction Panel)  
**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth (all routes below unless noted):**

```http
Authorization: Bearer <accessToken>
```

**Roles:** `construction` or `admin`  
**Login:** `POST /api/auth/login` → use `data.accessToken`

**Standard JSON wrapper:**

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

**Error:**

```json
{
  "success": false,
  "message": "…"
}
```

This doc covers recent Construction Panel backend fixes:

1. **Dashboard** — full widget payload + filters  
2. **Projects & Calendar** — construction-scope only (no sales leads)  
3. **Material Requests Export** — Excel / CSV  

---

## Table of contents

1. [Auth](#1-auth)
2. [Dashboard filters](#2-dashboard-filters)
3. [Dashboard](#3-dashboard)
4. [Projects list](#4-projects-list)
5. [Project calendar](#5-project-calendar)
6. [Project detail](#6-project-detail)
7. [Material requests list + filters](#7-material-requests-list--filters)
8. [Material requests export](#8-material-requests-export)
9. [Construction lifecycle stages](#9-construction-lifecycle-stages)
10. [Frontend checklist](#10-frontend-checklist)

---

## 1. Auth

### Request

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "construction1@example.com",
  "password": "••••••••"
}
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "6a7f35a52eb0429684394d8a",
      "email": "construction1@example.com",
      "role": "construction",
      "name": "Construction User"
    }
  }
}
```

Use `data.accessToken` on every Construction Panel call.

---

## 2. Dashboard filters

Populates **All Projects / All Buildings / Status** dropdowns on the dashboard.

### Request

```http
GET /api/construction/dashboard/filters
Authorization: Bearer <accessToken>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "6a8b74b759a21ada11554f7f",
        "projectName": "Garage",
        "jobId": "PRO-015",
        "lifecycleStatus": "released_to_plant",
        "location": "Texas"
      },
      {
        "_id": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Adam Gilchrist",
        "jobId": "PRO-042",
        "lifecycleStatus": "delivered",
        "location": "Dallas, TX"
      }
    ],
    "buildings": [
      {
        "_id": "6a6b644963a85950372e1de5",
        "leadId": "6a8b74b759a21ada11554f7f",
        "buildingNumber": 1,
        "name": "Building 1",
        "status": "pending"
      }
    ],
    "statuses": [
      "released_to_plant",
      "drawings_received",
      "bom_received",
      "bom_review",
      "material_check",
      "production_planning",
      "fabrication_started",
      "quality_inspection",
      "packing_bundling",
      "shipper_prepared",
      "ready_for_delivery",
      "dispatched",
      "delivered"
    ]
  }
}
```

---

## 3. Dashboard

Powers KPI cards, delivery donut, material-request donut, active sites, deadlines, overall timeline, freight carriers, recent activity.

### Request

```http
GET /api/construction/dashboard
Authorization: Bearer <accessToken>
```

### Query params (all optional)

| Param | Alias | Description |
|--------|--------|-------------|
| `projectId` | `leadId` | Mongo id — one project |
| `buildingId` | — | Mongo id from filters; scopes to that building’s lead |
| `status` | `lifecycleStatus` | Construction stage key (see §9) |
| `fromDate` | `dateFrom` | ISO date — delivery/freight window start |
| `toDate` | `dateTo` | ISO date — delivery/freight window end |

**Default:** if `fromDate` / `toDate` omitted, **delivery overview + freight** use **today**.

### Example with filters

```http
GET /api/construction/dashboard?projectId=6aadb0a0464b5c58eb1a042b&fromDate=2026-03-24&toDate=2026-03-31
Authorization: Bearer <accessToken>
```

### Response `200` (full shape)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "filtersApplied": {
      "projectId": null,
      "buildingId": null,
      "status": null,
      "fromDate": null,
      "toDate": null
    },
    "projectStats": {
      "total": 10,
      "onTrack": 8,
      "delayed": 0,
      "completed": 2,
      "onTrackPct": 80,
      "delayedPct": 0,
      "completedPct": 20,
      "completionRate": 20,
      "upcomingDeadlines": 5,
      "totalChangePctVsYesterday": 15,
      "completionRateLabel": "Average Completion"
    },
    "deliveryOverview": {
      "scope": "today",
      "fromDate": "2026-09-24T18:30:00.000Z",
      "toDate": "2026-09-25T18:29:59.999Z",
      "delivered": 11,
      "inTransit": 10,
      "outForDelivery": 4,
      "delayed": 3,
      "total": 28,
      "deliveredPct": 39.3,
      "inTransitPct": 35.7,
      "outForDeliveryPct": 14.3,
      "delayedPct": 10.7
    },
    "materialRequestOverview": {
      "pendingApproval": 10,
      "approved": 5,
      "rejected": 3,
      "urgent": 6,
      "total": 24,
      "approvedPct": 20.8,
      "pendingApprovalPct": 41.7,
      "rejectedPct": 12.5
    },
    "taskOverview": {
      "total": 12,
      "todo": 4,
      "inProgress": 5,
      "done": 3,
      "overdue": 1
    },
    "activeSites": [
      {
        "leadId": "6a8b74b759a21ada11554f7f",
        "projectName": "Garage",
        "jobId": "PRO-015",
        "site": "Texas",
        "buildingType": "carports",
        "numberOfBuildings": 2,
        "progressPct": 65,
        "deadline": "2024-12-09T00:00:00.000Z",
        "deliveryStatus": "Delayed",
        "lifecycleStatus": "released_to_plant"
      },
      {
        "leadId": "6a7440f0fe7b954b5bd155ce",
        "projectName": "Dev Warehouse One",
        "jobId": "PRO-005",
        "site": "Austin, TX",
        "buildingType": "",
        "numberOfBuildings": 1,
        "progressPct": 48,
        "deadline": null,
        "deliveryStatus": "On Track",
        "lifecycleStatus": "material_check"
      }
    ],
    "upcomingDeadlines": [
      {
        "leadId": "6a8b74b759a21ada11554f7f",
        "projectName": "Downtown Office Complex",
        "jobId": "PRO-010",
        "location": "Site A",
        "site": "Site A",
        "endDate": "2025-05-25T00:00:00.000Z",
        "daysLeft": 8
      }
    ],
    "projectTimelineOverall": [
      {
        "key": "planning",
        "label": "Planning",
        "date": "2024-01-14T00:00:00.000Z",
        "status": "Completed"
      },
      {
        "key": "design",
        "label": "Design",
        "date": "2024-01-14T00:00:00.000Z",
        "status": "Completed"
      },
      {
        "key": "procurement",
        "label": "Procurement",
        "date": "2024-01-14T00:00:00.000Z",
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
    "freightCarriers": {
      "rows": [
        {
          "carrierId": "6a6b681963a85950372e2961",
          "carrierName": "Roadking Logistics",
          "loadsToday": 8,
          "onTime": 7,
          "delayed": 1,
          "priority": "Delayed"
        },
        {
          "carrierId": "6a75f1f1d36a67e7c85fd60d",
          "carrierName": "Swift Transport",
          "loadsToday": 6,
          "onTime": 6,
          "delayed": 0,
          "priority": "On Time"
        }
      ],
      "totals": {
        "totalLoadsToday": 34,
        "onTime": 29,
        "onTimePct": 85.3,
        "delayed": 5,
        "delayedPct": 14.7
      }
    },
    "recentActivity": [
      {
        "type": "shipper_file",
        "action": "shipper_file_submitted",
        "message": "New shipper file received for ABC Warehouse (Ayesha LLC)",
        "occurredAt": "2026-03-24T17:00:14.000Z",
        "leadId": "6a7440f0fe7b954b5bd155ce",
        "actorName": "Ayesha LLC",
        "refId": "6a8c9121f55a8a1d870039e6"
      },
      {
        "type": "audit",
        "action": "delivery.reminder_sent",
        "message": "delivery.reminder sent",
        "occurredAt": "2026-09-24T14:17:48.167Z",
        "leadId": "6a863a3b8dfb3433bbea4794",
        "actorName": "Admin",
        "refId": "6ab5310c00950c1fb696c962"
      },
      {
        "type": "production",
        "action": "production_target",
        "message": "Production target for today is 63%",
        "occurredAt": "2026-09-25T08:00:00.000Z",
        "leadId": null,
        "actorName": null,
        "refId": "6ab4e3cd565a7297151d46cb"
      }
    ],
    "recentDeliveries": [
      {
        "deliveryId": "6a7440f1fe7b954b5bd155f4",
        "deliveryNumber": "DEV-DEL-1786003697187-3",
        "status": "delivered",
        "deliveryDate": "2026-08-01T00:00:00.000Z",
        "project": {
          "leadId": "6a7440f0fe7b954b5bd155ce",
          "projectName": "Dev Warehouse One",
          "jobId": "PRO-005",
          "location": "Austin, TX"
        }
      }
    ]
  }
}
```

### UI → field map

| UI widget | Use |
|-----------|-----|
| Total Projects + “% by Yesterday” | `projectStats.total`, `projectStats.totalChangePctVsYesterday` |
| On Track / Delayed / Completed | `onTrack` / `delayed` / `completed` + `*Pct` |
| Completion Rate | `completionRate`, `completionRateLabel` |
| Upcoming Deadlines count | `projectStats.upcomingDeadlines` |
| Delivery Overview donut | `deliveryOverview` |
| Material Request Overview + Urgent | `materialRequestOverview` (`urgent` = high/critical priority) |
| Active Construction Sites | `activeSites[]` — `progressPct`, `deadline`, `deliveryStatus` |
| Upcoming deadlines list | `upcomingDeadlines[]` — `daysLeft` |
| Project Timeline (Overall) | `projectTimelineOverall[]` — status: `Completed` \| `Inprogress` \| `Upcoming` |
| Freight Carriers table | `freightCarriers.rows` + `freightCarriers.totals` |
| Recent Activity | `recentActivity[]` — `type`: `audit` \| `shipper_file` \| `production` |

### Error example

```http
GET /api/construction/dashboard?projectId=notanid
```

```json
{
  "success": false,
  "message": "Invalid projectId"
}
```

---

## 4. Projects list

**Projects & Calendar → Project tab.**

**Important:** list is **construction scope only** — plant lifecycle stages (`released_to_plant` → `delivered`).  
Sales stages (`initial_contact`, `proposal_sent`, etc.) are **excluded**.

### Request

```http
GET /api/construction/projects?page=1&limit=20
Authorization: Bearer <accessToken>
```

### Query params

| Param | Required | Description |
|--------|----------|-------------|
| `page` | No | Default `1` |
| `limit` | No | Default `20` |
| `status` | No | Must be a **construction** stage (see §9) |
| `priority` | No | e.g. `low`, `medium`, `high`, `urgent` |
| `search` | No | Matches `projectName` or `jobId` |
| `hasDelivery` | No | `true` / `1` — only projects that already have a non-draft delivery |

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Adam Gilchrist",
        "jobId": "PRO-042",
        "buildingType": "",
        "location": "Dallas, TX",
        "lifecycleStatus": "delivered",
        "priority": "medium",
        "endDate": null,
        "plannedStartDate": null,
        "createdAt": "2026-08-01T10:00:00.000Z",
        "customerId": {
          "_id": "6a7440f0fe7b954b5bd155cb",
          "firstName": "Adam",
          "lastName": "Gilchrist",
          "email": "adam@example.com"
        }
      },
      {
        "_id": "6a8b74b759a21ada11554f7f",
        "projectName": "Garage",
        "jobId": "PRO-015",
        "buildingType": "carports",
        "location": "Texas",
        "lifecycleStatus": "material_check",
        "priority": "low",
        "endDate": null,
        "plannedStartDate": null,
        "createdAt": "2026-07-15T08:00:00.000Z",
        "customerId": {
          "_id": "6a7440f0fe7b954b5bd155cb",
          "firstName": "Dev",
          "lastName": "Customer",
          "email": "dev@example.com"
        }
      }
    ],
    "total": 10,
    "page": 1,
    "limit": 20,
    "scope": "construction",
    "stages": [
      "released_to_plant",
      "drawings_received",
      "bom_received",
      "bom_review",
      "material_check",
      "production_planning",
      "fabrication_started",
      "quality_inspection",
      "packing_bundling",
      "shipper_prepared",
      "ready_for_delivery",
      "dispatched",
      "delivered"
    ]
  }
}
```

### Table binding

| Column | Field |
|--------|--------|
| PROJECT ID | `jobId` |
| PROJECT / SITE | `projectName` + `location` |
| STATUS | `lifecycleStatus` (format for display) |
| PRIORITY | `priority` |
| ACTIONS → View | navigate with `_id` (leadId) |

### Only projects with deliveries

```http
GET /api/construction/projects?hasDelivery=true&page=1&limit=20
Authorization: Bearer <accessToken>
```

### Rejected sales status

```http
GET /api/construction/projects?status=initial_contact
```

```json
{
  "success": false,
  "message": "status must be a construction stage: released_to_plant, drawings_received, …"
}
```

---

## 5. Project calendar

**Projects & Calendar → Calendar tab.**  
Only deliveries for **construction-scoped** projects.

### Request

```http
GET /api/construction/projects/calendar?month=9&year=2026
Authorization: Bearer <accessToken>
```

| Param | Description |
|--------|-------------|
| `month` | 1–12 (default: current) |
| `year` | e.g. `2026` |
| `leadId` | Optional — one project |

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "month": 9,
    "year": 2026,
    "totalDeliveries": 3,
    "calendar": {
      "2026-09-24": [
        {
          "deliveryId": "6a8c9121f55a8a1d870039e6",
          "deliveryNumber": "DEL-2026-0012",
          "status": "scheduled",
          "description": "Primary frame steel",
          "project": {
            "leadId": "6aadb0a0464b5c58eb1a042b",
            "projectName": "Adam Gilchrist",
            "jobId": "PRO-042",
            "location": "Dallas, TX",
            "lifecycleStatus": "material_check"
          }
        }
      ],
      "2026-09-25": []
    }
  }
}
```

`calendar` keys are `YYYY-MM-DD`. Empty days may be omitted.

---

## 6. Project detail

### Request

```http
GET /api/construction/projects/6aadb0a0464b5c58eb1a042b
Authorization: Bearer <accessToken>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "_id": "6aadb0a0464b5c58eb1a042b",
      "projectName": "Adam Gilchrist",
      "jobId": "PRO-042",
      "buildingType": "",
      "location": "Dallas, TX",
      "lifecycleStatus": "delivered",
      "priority": "medium",
      "endDate": null,
      "plannedStartDate": null,
      "numberOfBuildings": 1,
      "description": "",
      "customerId": {
        "_id": "6a7440f0fe7b954b5bd155cb",
        "firstName": "Adam",
        "lastName": "Gilchrist",
        "email": "adam@example.com"
      }
    },
    "deliveries": [
      {
        "_id": "6a8c9121f55a8a1d870039e6",
        "deliveryNumber": "DEL-2026-0012",
        "status": "scheduled",
        "deliveryDate": "2026-09-25T00:00:00.000Z",
        "description": "Primary frame steel",
        "materialType": "Steel",
        "loadWeight": 12000
      }
    ],
    "tasks": [
      {
        "_id": "6ab4e3cd565a7297151d46cb",
        "title": "Site prep",
        "status": "in_progress",
        "priority": "high",
        "dueDate": "2026-09-30T00:00:00.000Z",
        "assignedTo": null
      }
    ]
  }
}
```

### Not in construction scope

```json
{
  "success": false,
  "message": "Project is not in construction scope (still in sales pipeline)"
}
```

HTTP **404**.

---

## 7. Material requests list + filters

### 7.1 Filters (dropdowns)

```http
GET /api/construction/material-requests/filters
Authorization: Bearer <accessToken>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "statuses": ["pending", "approved", "rejected", "fulfilled", "cancelled"],
    "priorities": ["low", "medium", "high", "critical"],
    "departments": ["Framing", "test"],
    "siteLocations": ["Construction Site A", "Construction Site B"],
    "projects": [
      {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Adam Gilchrist",
        "jobId": "PRO-042"
      }
    ]
  }
}
```

### 7.2 List

```http
GET /api/construction/material-requests?page=1&limit=20
Authorization: Bearer <accessToken>
```

**Query (all optional):**

| Param | Notes |
|--------|--------|
| `leadId` / `projectId` | Project filter |
| `department` | |
| `status` | `pending`, `approved`, … (ignore `All`) |
| `requestedBy` | User mongo id |
| `priority` | |
| `siteLocation` | |
| `search` | Matches `requestId` |
| `dateFrom` / `fromDate` | On `requestDate` |
| `dateTo` / `toDate` | On `requestDate` |
| `page`, `limit` | Pagination |

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalRequests": 24,
      "pending": 10,
      "approved": 5,
      "rejected": 3
    },
    "materialRequests": [
      {
        "_id": "6ab4d72100f413ad1cdb6e52",
        "requestId": "MR-2026-0023",
        "project": {
          "leadId": "6aadb0a0464b5c58eb1a042b",
          "projectName": "Adam Gilchrist",
          "jobId": "PRO-042",
          "location": "Dallas, TX"
        },
        "siteLocation": "Construction Site A",
        "department": "Framing",
        "requestedBy": {
          "userId": "6a7f35a52eb0429684394d8a",
          "name": "Construction User"
        },
        "requestedItems": [
          {
            "_id": "6ab4d72100f413ad1cdb6e53",
            "name": "Studs",
            "quantity": 40,
            "unit": "ea",
            "notes": "",
            "deliveryStatus": "pending"
          }
        ],
        "itemCount": 1,
        "requestDate": "2026-09-22T21:30:18.028Z",
        "requiredBy": "2026-09-24T00:00:00.000Z",
        "priority": "high",
        "status": "approved",
        "totalAmount": 0
      }
    ],
    "total": 24
  }
}
```

**Cards:** `stats.totalRequests`, `stats.pending`, `stats.approved`, `stats.rejected`  
**Table:** `materialRequests[]` + `total` for “Material Request (24)”

---

## 8. Material requests export

**Export button** — previously missing; now implemented.

### Request (Excel — default)

```http
GET /api/construction/material-requests/export
Authorization: Bearer <accessToken>
```

Aliases:

```http
GET /api/construction/material-requests/export/excel
GET /api/construction/material-requests/export/csv
GET /api/construction/material-requests/export?format=csv
```

**Same filter query string as the list** (`leadId`, `status`, `department`, `dateFrom`, `dateTo`, …).

### Response

| Format | Content-Type | Filename |
|--------|--------------|----------|
| Excel | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `material-requests.xlsx` |
| CSV | `text/csv; charset=utf-8` | `material-requests.csv` |

**Not JSON** — download as blob.

### Frontend example

```javascript
async function exportMaterialRequests(token, filters = {}) {
  const qs = new URLSearchParams(filters).toString()
  const res = await fetch(
    `${API_BASE}/api/construction/material-requests/export?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(await res.text())
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'material-requests.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}
```

### CSV sample (first lines)

```csv
"Request ID","Project / Site","Job ID","Department","Items","Item Count","Request Date","Required By","Status","Priority","Requested By","Total Amount"
"MR-2026-0023","Adam Gilchrist, Construction Site A","PRO-042","Framing","1 Item, Studs","1","2026-09-22T21:30:18.028Z","2026-09-24","approved","high","Construction User","0"
```

---

## 9. Construction lifecycle stages

Allowed for dashboard / projects `status` filters and projects list scope:

| Key | Typical label |
|-----|----------------|
| `released_to_plant` | Released To Plant |
| `drawings_received` | Drawings Received |
| `bom_received` | Bom Received |
| `bom_review` | Bom Review |
| `material_check` | Material Check |
| `production_planning` | Production Planning |
| `fabrication_started` | Fabrication Started |
| `quality_inspection` | Quality Inspection |
| `packing_bundling` | Packing Bundling |
| `shipper_prepared` | Shipper Prepared |
| `ready_for_delivery` | Ready For Delivery |
| `dispatched` | Dispatched |
| `delivered` | Delivered |

**Not in construction list:** `initial_contact`, `proposal_sent`, `negotiation`, etc.

**When a project appears:** after it is released into plant/construction (usually PO assign → `released_to_plant`), **not** only when a Delivery document exists. Use `?hasDelivery=true` if the UI should show only projects that already have deliveries.

---

## 10. Frontend checklist

### Dashboard

- [ ] `GET /dashboard/filters` for dropdowns  
- [ ] `GET /dashboard` with optional `projectId`, `buildingId`, `status`, date range  
- [ ] Bind KPIs, both donuts, sites, deadlines, timeline, freight, activity from one payload  

### Projects & Calendar

- [ ] `GET /projects` — expect only construction stages  
- [ ] Do **not** show sales statuses; if you filter by status, use §9 keys only  
- [ ] Optional `hasDelivery=true`  
- [ ] Calendar: `GET /projects/calendar?month=&year=`  
- [ ] View: `GET /projects/:leadId`  

### Material Requests

- [ ] List: `GET /material-requests` + `stats` for cards  
- [ ] Filters: `GET /material-requests/filters`  
- [ ] **Export:** `GET /material-requests/export` → blob download (Excel); or `/export/csv`  

---

## Related paths (unchanged, for navigation)

| Area | Path |
|------|------|
| Drawings | `GET /api/construction/drawings` |
| Deliveries | `GET /api/construction/deliveries` |
| Tasks | `GET /api/construction/tasks` |
| Packing lists | `GET /api/construction/packing-lists` |

---

**Note:** Deploy must include the commits that add dashboard enrichments, projects scoping, and material-request export before UAT matches this doc.
