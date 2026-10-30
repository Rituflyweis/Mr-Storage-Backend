# Construction Panel — backlog API handoff (§5)

**Source backlog map:** [`multi-panel-backlog-api.md`](./multi-panel-backlog-api.md) §5  
**Status:** Ready / Enhanced (as listed per item)  
**Date:** 29 Oct 2026  
**Base (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <accessToken>`  
**Roles:** `construction` | `admin`  
**Envelope:** `{ "success": true|false, "message": "…", "data": { } }`

This doc expands **Construction Panel backlog items 5.1–5.5** with endpoints, query params, and example request/response payloads.

---

## Index

| Backlog | Topic | Primary API |
|---------|--------|-------------|
| **5.1.1 / 5.1.2** | Dashboard — Upcoming Schedule + Project Timeline | `GET /api/construction/dashboard` |
| | Dashboard filter dropdowns | `GET /api/construction/dashboard/filters` |
| **5.2.1** | Bundle Scan — Projects search | `GET /api/construction/bundle-scan/projects?search=` |
| **5.3** | Bundle Scan — Loads (stats / search / sort / filter) | `GET /api/construction/bundle-scan/projects/:leadId/loads` |
| **5.4** | Bundle Scan — Load bundles (status + mismatch) | `GET /api/construction/bundle-scan/loads/:packingListId/bundles` |
| **5.5** | Bundle mismatch details + report | `GET /api/construction/bundles/:bundleId` · `POST …/report-mismatch` |

**Aliases (same handlers as bundle-scan nav):**

| Flow | Projects | Loads | Bundles |
|------|----------|-------|---------|
| Bundle scan | `/bundle-scan/projects` | `/bundle-scan/projects/:leadId/loads` | `/bundle-scan/loads/:packingListId/bundles` |
| Logistics | `/logistics/projects` | `/logistics/projects/:leadId/loads` | `/logistics/loads/:packingListId/bundles` |
| Packing lists | `/packing-lists/projects` | … | … |
| Labels | `/labels/projects` | … | … |

Use **`/bundle-scan/...`** for the Bundle Scan screen; other prefixes are identical payloads for their nav entry points.

---

## 5.1.1 / 5.1.2 — Dashboard (Upcoming Schedule + Project Timeline)

### Filters (dropdowns)

```http
GET /api/construction/dashboard/filters HTTP/1.1
Authorization: Bearer <token>
Accept: application/json
```

**Request body:** none.

**Response `data` (shape):** projects, buildings, statuses, business units — use for dashboard filter bar. Full examples also in [`../frontend-construction-panel-fixes-api.md`](../frontend-construction-panel-fixes-api.md) §2.

### Dashboard

```http
GET /api/construction/dashboard?projectId=&buildingId=&status=&businessUnit=&fromDate=&toDate= HTTP/1.1
Authorization: Bearer <token>
```

| Query | Type | Notes |
|-------|------|--------|
| `projectId` / `leadId` | ObjectId | Scope to one project |
| `buildingId` | ObjectId | Optional building |
| `status` | string | Project / lifecycle filter (see filters API) |
| `businessUnit` | string | Optional BU |
| `fromDate` / `toDate` | ISO8601 | Delivery / activity window |

#### Example request

```bash
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/dashboard?fromDate=2026-10-01&toDate=2026-10-31" \
  -H "Authorization: Bearer $TOKEN"
```

#### Example response (widgets relevant to backlog)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "filtersApplied": {
      "projectId": null,
      "buildingId": null,
      "status": null,
      "businessUnit": null,
      "fromDate": "2026-10-01T00:00:00.000Z",
      "toDate": "2026-10-31T23:59:59.999Z"
    },
    "projectStats": {
      "total": 12,
      "onTrack": 8,
      "delayed": 2,
      "completed": 2,
      "upcomingDeadlines": 3
    },
    "upcomingDeadlines": [
      {
        "leadId": "66f0aa11bb22cc33dd44ee55",
        "projectName": "Warehouse A",
        "jobId": "2026241",
        "location": "NY, NY 10001",
        "site": "NY, NY 10001",
        "endDate": "2026-11-15T00:00:00.000Z",
        "daysLeft": 17
      }
    ],
    "upcomingSchedule": [
      {
        "leadId": "66f0aa11bb22cc33dd44ee55",
        "projectName": "Warehouse A",
        "jobId": "2026241",
        "location": "NY, NY 10001",
        "site": "NY, NY 10001",
        "endDate": "2026-11-15T00:00:00.000Z",
        "daysLeft": 17
      }
    ],
    "projectTimelineOverall": [
      { "key": "planning", "label": "Planning", "date": "2026-08-01T10:00:00.000Z", "status": "Completed" },
      { "key": "design", "label": "Design", "date": "2026-08-20T10:00:00.000Z", "status": "Completed" },
      { "key": "procurement", "label": "Procurement", "date": "2026-09-10T10:00:00.000Z", "status": "Inprogress" },
      { "key": "execution", "label": "Execution", "date": null, "status": "Upcoming" },
      { "key": "handover", "label": "Handover", "date": null, "status": "Upcoming" }
    ],
    "activeSites": [],
    "deliveryOverview": {},
    "materialRequestOverview": {},
    "taskOverview": {},
    "freightCarriers": { "rows": [], "totals": {} },
    "recentActivity": [],
    "recentDeliveries": []
  }
}
```

### FE mapping

| Figma / UI | Field |
|------------|--------|
| **Upcoming Schedule** | Prefer `data.upcomingSchedule` (alias of `upcomingDeadlines` — same rows) |
| **Project Timeline (overall)** | `data.projectTimelineOverall[]` → `key`, `label`, `date`, `status` (`Completed` \| `Inprogress` \| `Upcoming`) |

Also: `GET /api/construction/dashboard/export` — Excel with same filters.

---

## 5.2.1 — Bundle Scan — Projects search

```http
GET /api/construction/bundle-scan/projects?search=Warehouse&page=1&limit=20 HTTP/1.1
Authorization: Bearer <token>
```

| Query | Type | Notes |
|-------|------|--------|
| `search` | string | Matches `projectName`, `jobId`, `location` |
| `page` | int | Default `1` |
| `limit` | int | Default `20` (max 200) |
| `status` / `businessUnit` / `projectId` | optional | Construction scope filters |

**Request body:** none.

#### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "66f0aa11bb22cc33dd44ee55",
        "projectId": "2026241",
        "jobId": "2026241",
        "projectName": "Warehouse A",
        "location": "NY, NY 10001",
        "lifecycleStatus": "packing_bundling",
        "totalLoads": 3,
        "totalBundles": 24,
        "labelsPending": 5,
        "lastLoadUpdate": "2026-10-28T18:00:00.000Z",
        "packingListPlanId": "670c…",
        "packingListPlanStatus": "confirmed"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

**FE:** bind search input → `search` (debounce). On row click → navigate with `leadId` to loads (§5.3).

---

## 5.3 — Bundle Scan — Loads (stats / search / sort / filter)

```http
GET /api/construction/bundle-scan/projects/:leadId/loads?page=1&limit=50&status=ready&search=PL-&sortBy=updatedAt&sortOrder=desc HTTP/1.1
Authorization: Bearer <token>
```

| Query | Type | Notes |
|-------|------|--------|
| `page` | int | Default `1` |
| `limit` | int | Default `50` (max 200) |
| `status` | string | Packing-list status, or omit / `all` |
| `search` | string | `packingListNo`, `truckLabel`, `truckType` |
| `sortBy` | enum | `updatedAt` \| `packingListNo` \| `status` \| `totalBundles` \| `totalWeight` |
| `sortOrder` | enum | `asc` \| `desc` (default `desc`) |

#### Example request

```bash
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/bundle-scan/projects/66f0aa11bb22cc33dd44ee55/loads?search=PL&sortBy=totalWeight&sortOrder=desc" \
  -H "Authorization: Bearer $TOKEN"
```

#### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "leadId": "66f0aa11bb22cc33dd44ee55",
      "projectId": "2026241",
      "jobId": "2026241",
      "projectName": "Warehouse A",
      "location": "NY, NY 10001",
      "lifecycleStatus": "packing_bundling"
    },
    "loads": [
      {
        "packingListId": "670d11223344556677889900",
        "packingListNo": "PL-2026-014",
        "truckLabel": "Truck 1",
        "truckType": "SEMI_53",
        "status": "ready",
        "totalBundles": 8,
        "totalWeight": 13326,
        "maxLengthFeet": 40,
        "mismatchCount": 1,
        "hasMismatch": true,
        "updatedAt": "2026-10-28T16:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 50,
    "stats": {
      "totalLoads": 3,
      "byStatus": [
        { "status": "draft", "count": 0 },
        { "status": "confirmed", "count": 1 },
        { "status": "ready", "count": 1 },
        { "status": "loading", "count": 0 },
        { "status": "delivery_created", "count": 1 },
        { "status": "dispatched", "count": 0 },
        { "status": "delivered", "count": 0 }
      ],
      "draft": 0,
      "confirmed": 1,
      "ready": 1,
      "loading": 0,
      "deliveryCreated": 1,
      "dispatched": 0,
      "delivered": 0,
      "withMismatch": 1
    },
    "filters": {
      "statuses": [
        "draft",
        "confirmed",
        "ready",
        "loading",
        "delivery_created",
        "dispatched",
        "delivered"
      ],
      "sortBy": ["updatedAt", "packingListNo", "status", "totalBundles", "totalWeight"]
    }
  }
}
```

**FE:** use `data.stats` for summary chips; `data.filters.statuses` / `sortBy` for controls; row → `packingListId` into §5.4.

---

## 5.4 — Bundle Scan — Load bundles (status + mismatch)

```http
GET /api/construction/bundle-scan/loads/:packingListId/bundles?status=staged&mismatch=true&labelPending=true HTTP/1.1
Authorization: Bearer <token>
```

| Query | Type | Notes |
|-------|------|--------|
| `status` | string | Bundle status filter, or omit / `all` |
| `mismatch` | `true` \| `1` | Only bundles with mismatch reported / items / notes |
| `labelPending` | `true` \| `1` | Only bundles where label not printed |

#### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "leadId": "66f0aa11bb22cc33dd44ee55",
      "projectId": "2026241",
      "jobId": "2026241",
      "projectName": "Warehouse A",
      "location": "NY, NY 10001",
      "lifecycleStatus": "packing_bundling"
    },
    "load": {
      "packingListId": "670d11223344556677889900",
      "packingListNo": "PL-2026-014",
      "truckLabel": "Truck 1",
      "status": "ready",
      "totalBundles": 8,
      "totalWeight": 13326
    },
    "bundles": [
      {
        "bundleId": "6710aa11bb22cc33dd44ee01",
        "bundleNo": "B-001",
        "bundleType": "structural",
        "title": "Columns",
        "totalWeight": 2100,
        "maxLengthFeet": 30,
        "status": "staged",
        "labelPrinted": true,
        "labelPrintedAt": "2026-10-27T12:00:00.000Z",
        "verified": false,
        "hasMismatch": true,
        "mismatchNotes": "Short 2 clips",
        "mismatchReportedAt": "2026-10-28T14:00:00.000Z",
        "mismatchItemCount": 1,
        "updatedAt": "2026-10-28T14:00:00.000Z"
      }
    ],
    "total": 1,
    "stats": {
      "total": 1,
      "withMismatch": 1,
      "verified": 0,
      "labelPending": 0
    }
  }
}
```

**FE:** badge when `hasMismatch`; open detail with `bundleId` (§5.5).

---

## 5.5 — Bundle mismatch details + report

### Get bundle detail

```http
GET /api/construction/bundles/:bundleId HTTP/1.1
Authorization: Bearer <token>
```

#### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bundle": {
      "bundleId": "6710aa11bb22cc33dd44ee01",
      "bundleNo": "B-001",
      "bundleType": "structural",
      "title": "Columns",
      "items": [],
      "totalQty": 10,
      "totalWeight": 2100,
      "maxLengthFeet": 30,
      "status": "staged",
      "labelPrinted": true,
      "verified": false,
      "mismatchNotes": "Short 2 clips",
      "mismatchReportedAt": "2026-10-28T14:00:00.000Z",
      "mismatchItems": [
        {
          "itemId": "670e99887766554433221100",
          "partCode": "CLP-01",
          "description": "Clip",
          "qty": 10,
          "receivedQty": 8,
          "status": "Partially Received"
        }
      ],
      "hasMismatch": true,
      "project": {
        "leadId": "66f0aa11bb22cc33dd44ee55",
        "projectName": "Warehouse A",
        "jobId": "2026241"
      },
      "packingList": {
        "_id": "670d11223344556677889900",
        "packingListNo": "PL-2026-014",
        "truckLabel": "Truck 1"
      }
    }
  }
}
```

### Report mismatch

```http
POST /api/construction/bundles/:bundleId/report-mismatch HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
```

#### Example request body

```json
{
  "notes": "Short 2 clips on open of truck",
  "reason": "qty_short",
  "leadId": "66f0aa11bb22cc33dd44ee55",
  "items": [
    {
      "itemId": "670e99887766554433221100",
      "partCode": "CLP-01",
      "description": "Clip",
      "qty": 10,
      "receivedQty": 8,
      "status": "Partially Received"
    }
  ],
  "photos": [
    { "name": "photo1.jpg", "url": "https://…" }
  ]
}
```

| Body field | Required | Notes |
|------------|----------|--------|
| `notes` or `reason` | **Yes** (one required) | Stored as mismatch notes |
| `leadId` | No | Must match bundle’s lead if sent |
| `items[]` | No | Each needs valid `itemId`; status auto-derived from qty if omitted |
| `photos[]` | No | `{ name, url }` |

Item `status` values: `Not Received` | `Partially Received` | `Received`.

#### Example response

```json
{
  "success": true,
  "message": "Mismatch reported",
  "data": {
    "bundleId": "6710aa11bb22cc33dd44ee01",
    "mismatchNotes": "Short 2 clips on open of truck",
    "mismatchReportedAt": "2026-10-29T11:30:00.000Z",
    "mismatchItems": [
      {
        "itemId": "670e99887766554433221100",
        "partCode": "CLP-01",
        "description": "Clip",
        "qty": 10,
        "receivedQty": 8,
        "status": "Partially Received"
      }
    ],
    "mismatchOrder": {
      "mismatchId": "6711…",
      "mismatchOrderId": "MO-2026-00012",
      "status": "open",
      "leadId": "66f0aa11bb22cc33dd44ee55",
      "bundleId": "6710aa11bb22cc33dd44ee01"
    }
  }
}
```

---

## FE checklist (Construction backlog)

1. Dashboard: render **Upcoming Schedule** from `upcomingSchedule` (fallback `upcomingDeadlines`); timeline from `projectTimelineOverall`.
2. Bundle scan step 1: `GET …/bundle-scan/projects?search=` → show counts (`totalLoads`, `totalBundles`, `labelsPending`).
3. Step 2: wire `stats`, `filters.statuses`, `search`, `sortBy` / `sortOrder`; show mismatch badge from `hasMismatch` / `mismatchCount`.
4. Step 3: support `mismatch=true` and `labelPending=true`; show `hasMismatch` on rows.
5. Detail: `GET …/bundles/:id` for `mismatchItems`; report via `POST …/report-mismatch`.

---

## Related docs

| Doc | Contents |
|-----|----------|
| [`multi-panel-backlog-api.md`](./multi-panel-backlog-api.md) | Full multi-panel backlog map |
| [`../frontend-construction-panel-fixes-api.md`](../frontend-construction-panel-fixes-api.md) | Dashboard + projects + material export (full examples) |
| [`../frontend-construction-dashboard-api.md`](../frontend-construction-dashboard-api.md) | Dashboard widgets deep dive |
| [`../frontend-handoff-construction-logistics.md`](../frontend-handoff-construction-logistics.md) | Deliveries / labels / packing / dispatch |
| [`../frontend-construction-panel-postman.md`](../frontend-construction-panel-postman.md) | Postman collection notes |
