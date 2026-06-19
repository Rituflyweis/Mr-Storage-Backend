# Plant panel — dashboard API integration

Frontend reference for the **plant home / dashboard** screen: KPI stat cards, module lists, calendar, and real-time alerts.

**Base URL:** `https://flyweistechnology.com/api` (or your API origin)

**Auth:** All REST endpoints below require:

```http
Authorization: Bearer <accessToken>
```

**Role:** `plant` (from `POST /api/auth/login`)

**Response envelope** (all endpoints):

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

---

## Important: no single dashboard endpoint yet

`GET /api/plant/dashboard/*` is **not implemented** (empty route stub).

Build the dashboard by calling the **module stats endpoints in parallel** (see [Recommended integration](#recommended-integration)) and optionally wiring **Socket.io alerts** for live notifications.

**Data scope:** All plant stats are limited to projects where the logged-in user has an **approved PO order** assigned (`POOrder.assignedTo = plantUserId`, `status = 'approved'`).

---

## Recommended integration

### Home screen layout

```
┌─────────────────────────────────────────────────────────────┐
│  Row 1 — Projects KPIs     GET /api/plant/projects/stats    │
├─────────────────────────────────────────────────────────────┤
│  Row 2 — BOM KPIs          GET /api/plant/bom/stats         │
├─────────────────────────────────────────────────────────────┤
│  Row 3 — Shipper KPIs      GET /api/plant/shipper-files/stats│
├─────────────────────────────────────────────────────────────┤
│  Row 4 — Freight KPIs      GET /api/plant/deliveries/freight/stats │
│            (or delivery)   GET /api/plant/deliveries/stats  │
├─────────────────────────────────────────────────────────────┤
│  Alerts panel              Socket.io /admin namespace       │
├─────────────────────────────────────────────────────────────┤
│  Recent projects table       GET /api/plant/projects          │
│  Delivery calendar (opt.)    GET /api/plant/deliveries/calendar │
└─────────────────────────────────────────────────────────────┘
```

### Parallel fetch example

```javascript
const headers = { Authorization: `Bearer ${accessToken}` }

const [projects, bom, shipper, freight, deliveries] = await Promise.all([
  fetch('/api/plant/projects/stats', { headers }).then((r) => r.json()),
  fetch('/api/plant/bom/stats', { headers }).then((r) => r.json()),
  fetch('/api/plant/shipper-files/stats', { headers }).then((r) => r.json()),
  fetch('/api/plant/deliveries/freight/stats', { headers }).then((r) => r.json()),
  fetch('/api/plant/deliveries/stats', { headers }).then((r) => r.json()),
])

// Use projects.data, bom.data, shipper.data, freight.data, deliveries.data
```

---

## 1. Projects dashboard

### `GET /api/plant/projects/stats`

Summary cards for the projects module.

#### Query parameters

| Param | Type | Notes |
|-------|------|-------|
| `startDate` | ISO 8601 | Optional — filters assigned PO orders from this date |
| `endDate` | ISO 8601 | Optional — filters assigned PO orders through end of day |

#### Response `data`

```json
{
  "totalProjects": 24,
  "activeProjects": 18,
  "pendingCustomerApproval": 4,
  "cancelledProjects": 2
}
```

| Field | UI label suggestion | Meaning |
|-------|---------------------|---------|
| `totalProjects` | Total projects | All assigned leads |
| `activeProjects` | Active | `isTerminated !== true` |
| `pendingCustomerApproval` | Pending customer approval | Projects with at least one drawing `pending_review` |
| `cancelledProjects` | Cancelled | `isTerminated === true` |

#### Companion list — `GET /api/plant/projects`

Paginated project table for dashboard “recent projects” or full projects screen.

| Query param | Type | Notes |
|-------------|------|-------|
| `page` | integer | Default `1` |
| `limit` | integer | Default `20`, max `200` |
| `startDate` | ISO 8601 | PO assignment date filter |
| `endDate` | ISO 8601 | PO assignment date filter |
| `projectId` | MongoId | Filter to one lead `_id` |
| `customerId` | MongoId | Filter by customer |
| `buildingType` | string | Exact match |
| `drawingStatus` | enum | `all_approved`, `pending`, `rejected`, `none` |

**Response `data`:**

```json
{
  "projects": [
    {
      "_id": "...",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-019",
      "projectId": "PRO-019",
      "location": "Houston, TX",
      "clientName": "John Doe",
      "customer": { "firstName": "John", "lastName": "Doe" },
      "buildingType": "warehouse",
      "numberOfBuildings": 2,
      "quoteValue": 125000,
      "drawingStatus": "all_approved",
      "bomStatus": "partial",
      "lifecycleStatus": "production",
      "isTerminated": false,
      "createdAt": "2026-06-01T10:00:00.000Z"
    }
  ],
  "total": 24,
  "page": 1,
  "limit": 20
}
```

---

## 2. BOM dashboard

### `GET /api/plant/bom/stats`

BOM module KPI cards.

#### Response `data`

```json
{
  "totalBomFilesUploaded": 12,
  "pendingUploads": 3,
  "readyForShipper": 4,
  "issuesDetected": 1
}
```

| Field | UI label suggestion | Meaning |
|-------|---------------------|---------|
| `totalBomFilesUploaded` | Total BOM files | Latest BOM job per building across assigned projects |
| `pendingUploads` | Pending upload | Buildings with no BOM uploaded yet |
| `readyForShipper` | Ready for shipper | Projects with consolidated BOM file generated (`ConsolidatedBOM.fileUrl` set) |
| `issuesDetected` | Issues detected | Latest BOM jobs with `status: 'failed'` |

#### Companion list — `GET /api/plant/bom/projects`

| Query param | Type | Default |
|-------------|------|---------|
| `page` | integer | `1` |
| `limit` | integer | `20` |

**Response `data`:** `{ projects[], total, page, limit }` — one row per building (latest BOM job), includes `customerName`, `buildingType`, `location` fallbacks when `projectName` is empty.

---

## 3. Shipper files dashboard

### `GET /api/plant/shipper-files/stats`

Global shipper KPIs across all assigned projects.

**Alias:** `GET /api/plant/shipper-requests/stats` (same handler)

#### Response `data`

```json
{
  "totalFiles": 15,
  "filesReceived": 9,
  "ordersSent": 12,
  "revisionsSent": 2
}
```

| Field | UI label suggestion | Meaning |
|-------|---------------------|---------|
| `totalFiles` | Total shipper files | Count of shipper requests raised |
| `filesReceived` | Files received | Requests with `submittedFileUrl` |
| `ordersSent` | Orders sent | Requests sent to vendors (`sentAt` + active status) |
| `revisionsSent` | Revisions sent | Sum of `resubmitCount` across requests |

#### Companion list — `GET /api/plant/shipper-files/projects`

**Alias:** `GET /api/plant/shipper-requests/projects`

**Response `data`:**

```json
{
  "projects": [
    {
      "leadId": "...",
      "projectId": "PRO-019",
      "jobId": "PRO-019",
      "projectName": "ABC Warehouse",
      "customerName": "John Doe",
      "buildingType": "warehouse",
      "location": "Houston, TX",
      "totalShipperFiles": 3,
      "receivedShipperFiles": 2,
      "fileReceivedStatus": "partial",
      "latestSubmittedAt": "2026-06-12T14:30:00.000Z"
    }
  ],
  "total": 5
}
```

`fileReceivedStatus`: `none` | `partial` | `all`

#### Project-scoped shipper KPIs — `GET /api/plant/shipper-files/projects/:leadId/stats`

Same four fields plus project context:

```json
{
  "leadId": "...",
  "projectId": "PRO-019",
  "projectName": "ABC Warehouse",
  "totalFiles": 3,
  "filesReceived": 2,
  "ordersSent": 3,
  "revisionsSent": 1
}
```

---

## 4. Load planning dashboard

There is **no dedicated load-planning stats endpoint**. Use the project list for the load-planning module home.

### `GET /api/plant/load-planning/projects`

Lists projects that have a non-cancelled bundle plan.

**Response `data`:**

```json
{
  "projects": [
    {
      "leadId": "...",
      "projectId": "PRO-019",
      "jobId": "PRO-019",
      "projectName": "ABC Warehouse",
      "customerName": "John Doe",
      "buildingType": "warehouse",
      "location": "Houston, TX",
      "bundlePlanId": "...",
      "fileReceivedAt": "2026-06-10T11:00:00.000Z",
      "totalLoadPlanning": 18,
      "status": "confirmed",
      "updatedAt": "2026-06-15T09:00:00.000Z"
    }
  ],
  "total": 3
}
```

| Field | Meaning |
|-------|---------|
| `totalLoadPlanning` | Bundle count on latest bundle plan |
| `status` | Bundle plan status (`draft`, `confirmed`, etc.) |

**Detail screen:** `GET /api/plant/projects/:projectId/load-planning`

---

## 5. Freight / delivery dashboard

Pick the stats endpoint that matches your UI module:

### Option A — Freight loads screen — `GET /api/plant/deliveries/freight/stats`

Excludes `draft` deliveries. Best for “freight requests / bidding” dashboard.

```json
{
  "totalLoads": 10,
  "requestedLoads": 9,
  "bidsPending": 3,
  "inTransit": 2,
  "delivered": 4,
  "totalSpent": 28500.5
}
```

| Field | Meaning |
|-------|---------|
| `totalLoads` | Non-draft deliveries |
| `requestedLoads` | Non-cancelled loads |
| `bidsPending` | Loads with bids sent/submitted but no carrier selected |
| `inTransit` | `status === 'in_transit'` |
| `delivered` | `status === 'delivered'` |
| `totalSpent` | Sum of awarded bid amounts (USD) |

**Companion list:** `GET /api/plant/deliveries/freight` — paginated freight loads (excludes draft by default).

---

### Option B — Awarded loads screen — `GET /api/plant/deliveries/awarded/stats`

Only deliveries with a selected carrier.

```json
{
  "totalAwarded": 6,
  "inTransit": 2,
  "delivered": 3,
  "totalSpent": 22000
}
```

**Companion list:** `GET /api/plant/deliveries/awarded`

---

### Option C — All deliveries breakdown — `GET /api/plant/deliveries/stats`

Status histogram across every delivery (including draft).

```json
{
  "totalCount": 12,
  "draftCount": 2,
  "scheduledCount": 1,
  "confirmedCount": 3,
  "inTransitCount": 2,
  "deliveredCount": 3,
  "delayedCount": 0,
  "cancelledCount": 1
}
```

Note: `confirmedCount` includes `carrier_selected` and `confirmed` statuses.

**Companion list:** `GET /api/plant/deliveries`

---

### Delivery calendar widget — `GET /api/plant/deliveries/calendar`

Grouped by delivery/pickup date. Only awarded / active statuses (`carrier_selected`, `scheduled`, `confirmed`, `in_transit`, `delayed`, `delivered`).

| Query param | Type | Notes |
|-------------|------|-------|
| `projectId` | string | Mongo `leadId` or `jobId` |
| `customerId` | MongoId | Filter by customer |
| `fromDate` | ISO 8601 | Date range start |
| `toDate` | ISO 8601 | Date range end |

**Response `data`:**

```json
{
  "dates": [
    {
      "date": "2026-06-15",
      "totalDeliveries": 2,
      "deliveries": [ ]
    }
  ]
}
```

---

## 6. Real-time alerts (Socket.io)

There is **no REST alerts feed**. Use Socket.io on the `/admin` namespace for dashboard toasts / notification badges.

### Connect

```javascript
import { io } from 'socket.io-client'

const socket = io(`${API_ORIGIN}/admin`, {
  auth: { token: accessToken },
})
```

On connect, the server auto-joins room `user:{plantUserId}`.

### Events to listen for

| Event | When | Suggested UI action |
|-------|------|---------------------|
| `project_assigned` | Admin assigns PO to plant user | Toast + refresh `GET /api/plant/projects/stats` |
| `bom_extraction_complete` | BOM async job finished | Toast + refresh BOM row / `bom/stats` |
| `bom_extraction_failed` | BOM job failed | Error toast + increment issues in BOM stats |
| `shipper_file_submitted` | Vendor uploaded quote | Refresh shipper list / stats |
| `all_shipper_files_submitted` | All vendors submitted for project | Alert banner — ready to compare |
| `shipper_comparison_complete` | Comparison job done | Enable approve / refresh comparison |
| `shipper_comparison_failed` | Comparison job failed | Error toast |
| `freight_bid_submitted` | Carrier submitted freight bid amount | Toast + refresh bids list / freight stats |
| `all_freight_bids_submitted` | All invited carriers responded for a delivery | Alert banner — ready to award carrier |

See **`docs/plant-freight-bid-socket-events.md`** for freight bid payload shapes and FE examples.

### Payload examples

```json
// project_assigned
{ "leadId": "...", "poOrderId": "...", "projectName": "ABC Warehouse" }

// bom_extraction_complete
{ "jobId": "...", "buildingNumber": 1, "totalItems": 13, "matchedItems": 13, "unmatchedItems": 0, "frameItems": 2 }

// bom_extraction_failed
{ "jobId": "...", "buildingNumber": 1, "error": "Failed to parse spreadsheet" }

// shipper_file_submitted
{ "leadId": "...", "requestId": "...", "vendorId": "...", "vendorName": "ABC Steel", "submittedAt": "...", "quoteValue": 2100 }

// all_shipper_files_submitted
{ "leadId": "...", "consolidatedBOMId": "...", "vendorCount": 3 }

// shipper_comparison_complete
{
  "jobId": "...",
  "requestId": "...",
  "leadId": "...",
  "vendorId": "...",
  "summary": {
    "expectedLines": 48,
    "vendorLines": 47,
    "matchedLines": 43,
    "missingItems": 2,
    "extraItems": 1,
    "qtyMismatches": 1,
    "lengthMismatches": 0,
    "weightMismatches": 0,
    "priceMismatches": 3,
    "ambiguousMatches": 0
  }
}

// shipper_comparison_failed
{ "jobId": "...", "requestId": "...", "leadId": "...", "vendorId": "...", "error": "Unsupported vendor quote file type" }

// freight_bid_submitted
{ "leadId": "...", "deliveryId": "...", "deliveryNumber": "DEL-0012", "bidId": "...", "carrierId": "...", "carrierName": "ABC Freight", "submittedAt": "...", "quotedAmount": 4200, "projectName": "ABC Warehouse", "jobId": "PRO-019" }

// all_freight_bids_submitted
{ "leadId": "...", "deliveryId": "...", "deliveryNumber": "DEL-0012", "bidCount": 3, "projectName": "ABC Warehouse", "jobId": "PRO-019" }
```

Polling fallbacks when socket is disconnected:

- BOM jobs: `GET /api/plant/bom/job/:jobId/status` or `POST /api/plant/bom/jobs/status`
- Comparison jobs: `GET /api/plant/shipper-requests/compare-jobs/:jobId/status`

---

## Quick reference — all dashboard endpoints

| Purpose | Method | Endpoint |
|---------|--------|----------|
| Projects KPIs | GET | `/api/plant/projects/stats` |
| Projects table | GET | `/api/plant/projects` |
| BOM KPIs | GET | `/api/plant/bom/stats` |
| BOM table | GET | `/api/plant/bom/projects` |
| Shipper KPIs | GET | `/api/plant/shipper-files/stats` |
| Shipper projects | GET | `/api/plant/shipper-files/projects` |
| Shipper KPIs (one project) | GET | `/api/plant/shipper-files/projects/:leadId/stats` |
| Load planning projects | GET | `/api/plant/load-planning/projects` |
| Freight load KPIs | GET | `/api/plant/deliveries/freight/stats` |
| Freight loads list | GET | `/api/plant/deliveries/freight` |
| Awarded load KPIs | GET | `/api/plant/deliveries/awarded/stats` |
| Awarded loads list | GET | `/api/plant/deliveries/awarded` |
| All delivery status KPIs | GET | `/api/plant/deliveries/stats` |
| All deliveries list | GET | `/api/plant/deliveries` |
| Delivery calendar | GET | `/api/plant/deliveries/calendar` |
| **Not implemented** | GET | `/api/plant/dashboard/*` |

---

## Frontend checklist

- [ ] Login via `POST /api/auth/login` — verify `role === "plant"`
- [ ] On dashboard mount, `Promise.all` the stats endpoints you need
- [ ] Optional `startDate` / `endDate` on `projects/stats` and `projects` list
- [ ] Connect Socket.io `/admin` for live alerts
- [ ] Map stat cards to `data.*` fields from each response (not nested under a single object)
- [ ] Drill-down tables use companion list endpoints in the same module
- [ ] Listen for `freight_bid_submitted` and `all_freight_bids_submitted` on freight screens (see `docs/plant-freight-bid-socket-events.md`)
- [ ] Do **not** call `GET /api/plant/dashboard` until backend implements it

---

## Related docs

- Full plant API: `docs/plant-panel-api.md`
- Recent FE changes: `docs/plant-frontend-api-updates-jun-2026.md`
- Freight load details: `docs/plant-freight-load-details-api.md`
- Freight bid socket events: `docs/plant-freight-bid-socket-events.md`
