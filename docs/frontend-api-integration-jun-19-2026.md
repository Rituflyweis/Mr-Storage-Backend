# Frontend API integration guide — June 17, 2026

Integration reference for recent backend APIs across **Plant**, **Admin**, and **Sales** panels.

**Base URL (production):** `https://flyweistechnology.com`

**Response envelope (all endpoints):**

```json
{
  "success": true,
  "message": "...",
  "data": { ... }
}
```

---

## Table of contents

| # | Section | Panel |
|---|---------|-------|
| 1 | [Project shipper file KPIs](#1-project-shipper-file-kpis) | Plant |
| 2 | [Freight request KPIs](#2-freight-request-kpis) | Plant |
| 3 | [Freight request detail](#3-freight-request-detail) | Plant |
| 4 | [Carrier bid revision flow](#4-carrier-bid-revision-flow) | Plant + Public |
| 5 | [Award carrier + confirm delivery](#5-award-carrier--confirm-delivery) | Plant |
| 6 | [Payment schedule update (PUT)](#6-payment-schedule-update-put) | Admin / Sales |
| 7 | [Admin meetings — filter by lead](#7-admin-meetings--filter-by-lead) | Admin |
| 8 | [Escalations — admin vs sales](#8-escalations--admin-vs-sales) | Admin + Sales |
| 9 | [Frontend checklist](#9-frontend-checklist) | All |
| 10 | [Quick endpoint index](#10-quick-endpoint-index) | All |

---

## 1. Project shipper file KPIs

**Use on:** Project shipper files detail screen (four KPI tiles).

| Method | Path |
|--------|------|
| GET | `/api/plant/shipper-files/projects/:leadId/stats` |

**Alias:** `GET /api/plant/shipper-requests/projects/:leadId/stats`

**Auth:** Bearer + `plant` role. Plant user must be assigned to the project PO.

### Path params

| Param | Type | Notes |
|-------|------|-------|
| `leadId` | MongoId | Project / lead `_id` |

### Example

```
GET /api/plant/shipper-files/projects/674abc123def456789012345/stats
```

### Response `data`

```json
{
  "leadId": "674abc123def456789012345",
  "projectId": "PRO-029",
  "projectName": "Twin Creek Warehouse",
  "totalFiles": 3,
  "filesReceived": 2,
  "ordersSent": 3,
  "revisionsSent": 1
}
```

### KPI field mapping (UI tiles)

| API field | UI label (suggested) | Meaning |
|-----------|----------------------|---------|
| `totalFiles` | Total files | Shipper requests on this project |
| `filesReceived` | Files received | Requests with an uploaded vendor file |
| `ordersSent` | Orders sent | Requests sent to vendor (incl. pending comparison) |
| `revisionsSent` | Revisions sent | Sum of `resubmitCount` across requests |

**Related:** Same `stats` block is also returned on `GET /api/plant/shipper-files/projects/:leadId/requests` if you prefer one call for KPIs + table.

---

## 2. Freight request KPIs

**Use on:** Plant freight / delivery dashboard (summary counters).

| Method | Path |
|--------|------|
| GET | `/api/plant/deliveries/freight/stats` |

**Auth:** Bearer + `plant` role.

### Example

```
GET /api/plant/deliveries/freight/stats
```

### Response `data`

```json
{
  "totalLoads": 12,
  "requestedLoads": 10,
  "bidsPending": 4,
  "inTransit": 3,
  "delivered": 5,
  "totalSpent": 18450
}
```

### KPI field mapping

| API field | Meaning |
|-----------|---------|
| `totalLoads` | All non-`draft` deliveries on assigned projects |
| `requestedLoads` | Non-cancelled loads |
| `bidsPending` | Loads with sent/submitted bids but no selected carrier yet |
| `inTransit` | `status === "in_transit"` |
| `delivered` | `status === "delivered"` |
| `totalSpent` | Sum of awarded bid amounts (`selectedCarrierBidId.quotedAmount`) |

**Note:** `draft` deliveries are excluded from this endpoint.

---

## 3. Freight request detail

**Use on:** Freight request detail / card screen (full form, schedule, bundles, selected carrier).

### Primary — by delivery ID

| Method | Path |
|--------|------|
| GET | `/api/plant/deliveries/:deliveryId/detail` |

Works for **any** delivery status (`draft`, `bidding_sent`, `confirmed`, etc.).

### Alternate — by project (awarded only)

| Method | Path |
|--------|------|
| GET | `/api/plant/projects/:leadId/delivery` |

Only when `selectedCarrierBidId` is set and status is `carrier_selected`, `scheduled`, `confirmed`, `in_transit`, `delayed`, or `delivered`.

404 if still draft / bidding only: `"No selected/confirmed delivery found for this project"`.

### Example

```
GET /api/plant/deliveries/6a34f8ed126d38a3c68b3461/detail
```

### Response `data` (structure)

```json
{
  "delivery": {
    "deliveryId": "6a34f8ed126d38a3c68b3461",
    "deliveryNumber": "DEL-0012",
    "status": "bidding_sent",
    "statusHistory": [
      { "status": "draft", "changedAt": "2026-06-10T08:00:00.000Z" },
      { "status": "bidding_sent", "changedAt": "2026-06-11T09:00:00.000Z" }
    ],
    "project": {
      "leadId": "674abc...",
      "projectName": "Twin Creek",
      "jobId": "PRO-029"
    },
    "customer": {
      "customerId": "674def...",
      "customerName": "Jane Smith"
    },
    "formDetails": {
      "loadDescription": "18 bundle shipment",
      "loadWeight": 62400,
      "dimensions": { "lengthFeet": 51, "widthFeet": 8.5, "heightFeet": 8 },
      "materialType": "framing, panels, trim",
      "packageCount": 18,
      "loadingEquipment": ["forklift"],
      "bidDeadline": "2026-06-20T18:00:00.000Z",
      "pickupLocation": "Plant Yard, Houston",
      "pickupLocationData": { "address": "...", "coordinates": { "lat": 29.76, "lng": -95.36 } },
      "deliveryLocation": "ABC Site, Austin",
      "deliveryLocationData": { "address": "...", "coordinates": { "lat": 30.27, "lng": -97.74 } },
      "pickupDate": "2026-06-12T00:00:00.000Z",
      "pickupTime": "08:00",
      "deliveryDate": "2026-06-13T00:00:00.000Z",
      "deliveryTime": "13:00",
      "receivingPoc": "John Doe",
      "pickupContactPhone": "+1-555-222-3344",
      "specialRequirements": "",
      "additionalNotes": ""
    },
    "deliverySchedule": {
      "deliveryDate": "2026-06-13T00:00:00.000Z",
      "timeWindow": "Mon-Fri 8AM-6PM",
      "pickupAddress": "Plant Yard, Houston",
      "dropoffAddress": "ABC Site, Austin"
    },
    "deliveryInformation": {
      "description": "18 bundle shipment",
      "materialCategory": "framing, panels, trim",
      "pickupDate": "2026-06-12T00:00:00.000Z"
    },
    "shipperDetails": {
      "vendorId": "...",
      "vendorName": "Metro Steel",
      "personName": "Mike Vendor",
      "number": "+1-555-111-2222",
      "email": "vendor@example.com"
    },
    "deliveryCompanyDetails": null,
    "selectedBid": null,
    "internalOwner": {
      "userId": "...",
      "name": "Plant User",
      "email": "plant@company.com",
      "phone": "+1-555-000-0000"
    },
    "deliveryTypeAndSize": {
      "bundleCount": 41,
      "packageCount": 18,
      "totalWeight": 58475.4
    },
    "bundlePlan": { },
    "packingListPlan": { },
    "bundles": [ ],
    "packingLists": [ ],
    "receivingPocDetails": {
      "receivingPoc": "John Doe",
      "pickupContactPhone": "+1-555-222-3344"
    }
  }
}
```

After award, `selectedBid` and `deliveryCompanyDetails` are populated; `status` is `confirmed` (see §5).

**Bids table (separate call):** `GET /api/plant/projects/:projectId/freight/bids?sort=low_to_high`

---

## 4. Carrier bid revision flow

Full loop when plant asks a carrier to revise their bid amount.

### Flow diagram

```text
1. Plant lists bids
   GET /api/plant/projects/:projectId/freight/bids

2. Plant opens "Request revision" on a row where canRequestResubmit === true
   (bid status must be "submitted")

3. Plant submits revision request
   POST /api/plant/freight-bids/:bidId/request-resubmit
   Body: { note, bidAmount? }

4. Carrier receives email → opens public link

5. Carrier loads bid page
   GET /api/public/freight-bids/:token
   → shows resubmitNote, requestedBidAmount, prior context

6. Carrier submits new amount
   POST /api/public/freight-bids/:token/submit
   Body: { quotedAmount, carrierNotes? }

7. Plant refreshes bids table
   GET /api/plant/projects/:projectId/freight/bids
   → bid status back to "submitted", bidAmount restored
```

### 4A. List bids (plant)

| Method | Path |
|--------|------|
| GET | `/api/plant/projects/:projectId/freight/bids` |

Query: `sort=low_to_high` | `high_to_low`

**Bid row fields (revision-related):**

| Field | Use |
|-------|-----|
| `canRequestResubmit` | Show revision button when `true` |
| `bidAmount` | Carrier's current amount (`null` while `resubmit_requested`) |
| `requestedBidAmount` | Plant's target amount while waiting for resubmit |
| `resubmitNote` / `plantNote` | Last revision note sent to carrier |
| `resubmitCount` | Number of revision rounds |
| `status` | `submitted` → can request; `resubmit_requested` → waiting |

### 4B. Request revision (plant)

| Method | Path |
|--------|------|
| POST | `/api/plant/freight-bids/:bidId/request-resubmit` |

**Request body:**

```json
{
  "note": "Please revise — pickup window moved to next week.",
  "bidAmount": 2100
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `note` | **Yes** | Shown to carrier in email + public page |
| `bidAmount` | No | Plant's requested/target amount (counter-offer). Stored as `resubmitRequestedAmount` |

**Allowed when:** bid `status === "submitted"`; delivery not `cancelled`.

**Response `data`:**

```json
{
  "bidId": "6a34f8ed126d38a3c68b3461",
  "status": "resubmit_requested",
  "resubmitCount": 1,
  "resubmitRequestedAt": "2026-06-17T12:00:00.000Z",
  "note": "Please revise — pickup window moved to next week.",
  "resubmitNote": "Please revise — pickup window moved to next week.",
  "plantNote": "Please revise — pickup window moved to next week.",
  "priorQuotedAmount": 2300,
  "requestedBidAmount": 2100,
  "expiresAt": "2026-06-24T12:00:00.000Z",
  "emailFailures": []
}
```

### 4C. Carrier public page

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/public/freight-bids/:token` | None (token in URL) |
| POST | `/api/public/freight-bids/:token/submit` | None |

**GET** — when revision requested, includes:

```json
{
  "status": "resubmit_requested",
  "quotedAmount": null,
  "resubmitNote": "Please revise — pickup window moved to next week.",
  "plantNote": "Please revise — pickup window moved to next week.",
  "requestedBidAmount": 2100,
  "resubmitRequestedAt": "2026-06-17T12:00:00.000Z",
  "resubmitCount": 1
}
```

**POST submit body:**

```json
{
  "quotedAmount": 2150,
  "carrierNotes": "Rate valid 48h"
}
```

→ Bid status returns to `submitted`; `requestedBidAmount` cleared.

---

## 5. Award carrier + confirm delivery

**Breaking / behavior change:** Awarding a bid now **confirms the delivery in the same API call**. No separate confirm step needed for calendar visibility.

| Method | Path |
|--------|------|
| POST | `/api/plant/freight-bids/:bidId/select` |

**Auth:** Bearer + `plant` role.

### Example

```
POST /api/plant/freight-bids/6a34f8ed126d38a3c68b3461/select
```

No request body.

### What happens server-side

| Entity | Change |
|--------|--------|
| Selected bid | `status` → `selected` |
| Other bids (same delivery) | `status` → `rejected` |
| Delivery | `selectedCarrierBidId` set |
| Delivery status | → **`confirmed`** (award + confirm in one step) |
| `statusHistory` | Records `carrier_selected` then `confirmed` |
| Emails | Award email to winner; rejection emails to others |

### Response `data` (updated)

```json
{
  "deliveryId": "6a337c60edd83b0390b870c3",
  "status": "confirmed",
  "selectedBid": {
    "bidId": "6a34f8ed126d38a3c68b3461",
    "carrierId": "674carrier...",
    "quotedAmount": 2300,
    "selectedAt": "2026-06-17T14:30:00.000Z"
  },
  "rejectedBidIds": ["674bid2...", "674bid3..."],
  "emailFailures": []
}
```

**Message:** `"Freight bid selected and delivery confirmed"`

### FE after award

- Refresh bids table → awarded row `status: "selected"`
- Refresh delivery detail → `status: "confirmed"`, `selectedBid` populated
- Delivery appears on calendar: `GET /api/plant/deliveries/calendar` (includes `confirmed`)

---

## 6. Payment schedule update (PUT)

**Use on:** Edit payment schedule screen (admin or sales).

| Method | Path |
|--------|------|
| PUT | `/api/payment-schedules/lead/:leadId` |

**Auth:** Bearer + `admin` or `sales` (sales only for assigned leads).

**Full reference:** [payment-schedule-update-api.md](./payment-schedule-update-api.md)

### Request body

Send the **full** `stages[]` array on every save.

```json
{
  "totalAmount": 1917952,
  "stages": [
    {
      "_id": "665b1b2c3d4e5f6789012341",
      "stageName": "Deposit",
      "amount": 30,
      "amountType": "percentage",
      "dueDate": "2026-06-01T00:00:00.000Z"
    },
    {
      "_id": "665b1b2c3d4e5f6789012342",
      "stageName": "On delivery",
      "amount": 70,
      "amountType": "percentage",
      "dueDate": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `stages` | **Yes** | Min 1 stage |
| `totalAmount` | No | Required for `fixed` amount type validation |
| Stage `_id` | For existing rows | Omit for new stages |
| `amountType` | **Yes** | `percentage` or `fixed` — all stages must match |
| `amount` | **Yes** | % (sum = 100) or fixed (sum = `totalAmount`) |

**Do not send on update:** `status`, `invoiceId`, `paidAt`, `paidBy` — server preserves for matched `_id`.

### Recommended FE flow

```text
1. GET /api/payment-schedules/lead/:leadId   → load + stage _ids
2. User edits form
3. PUT /api/payment-schedules/lead/:leadId   → full stages[]
4. Refresh UI from response.data.schedule
```

### Success response `data`

```json
{
  "schedule": {
    "_id": "...",
    "leadId": "...",
    "totalAmount": 1917952,
    "stages": [
      {
        "_id": "...",
        "stageName": "Deposit",
        "amount": 30,
        "amountType": "percentage",
        "dueDate": "2026-06-01T00:00:00.000Z",
        "status": "pending",
        "invoiceId": null,
        "paidAt": null,
        "paidBy": null
      }
    ]
  }
}
```

---

## 7. Admin meetings — filter by lead

**Use on:** Admin project detail → meetings tab; lead-scoped meeting list.

| Method | Path |
|--------|------|
| GET | `/api/admin/meetings` |

**Auth:** Bearer + `admin` role.

### Query params

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `leadId` | MongoId | — | **Filter meetings for one project/lead** |
| `status` | string | upcoming | `scheduled`, `rescheduled`, `completed`, `cancelled` |
| `search` | string | — | Title search (case-insensitive) |

When `status` is omitted → returns **upcoming** only (excludes `completed`, `cancelled`).

### Examples

```
GET /api/admin/meetings?leadId=674abc123def456789012345
GET /api/admin/meetings?leadId=674abc...&status=completed
GET /api/admin/meetings?search=site%20visit
```

404 if `leadId` does not exist.

### Response `data`

```json
{
  "meetings": [
    {
      "_id": "675ghi...",
      "title": "Site visit",
      "meetingTime": "2026-06-18T14:00:00.000Z",
      "duration": 60,
      "mode": "offline",
      "meetingLink": "",
      "status": "scheduled",
      "notes": "",
      "leadId": {
        "_id": "674abc...",
        "projectName": "Twin Creek",
        "jobId": "PRO-029"
      },
      "customerId": {
        "_id": "674def...",
        "firstName": "Jane",
        "lastName": "Smith"
      },
      "createdBy": { "_id": "...", "name": "Admin User", "email": "..." },
      "createdAt": "2026-06-10T10:00:00.000Z"
    }
  ]
}
```

**Sales equivalent:** `GET /api/sales/meetings?leadId=` (scoped to sales user's assigned leads; 403 if lead not theirs).

---

## 8. Escalations — admin vs sales

### Important change for admin FE

`GET /api/admin/escalations` now returns **`data.leads[]`** — the same **lead row shape** as sales `GET /api/sales/leads/escalated`.

| Before (do not use) | After |
|---------------------|-------|
| `data.escalations[]` (raw escalation documents) | `data.leads[]` (project-centric rows) |

Both panels should render the **same row component**; only list scope and pagination metadata differ.

---

### 8A. Admin escalations

| Method | Path |
|--------|------|
| GET | `/api/admin/escalations` |

**Auth:** Bearer + `admin` role.

### Query params

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | string | — | `pending`, `resolved` |
| `assignedSales` | MongoId | — | Filter by sales rep assigned to lead |
| `page` | number | `1` | |
| `limit` | number | `20` | |
| `startDate` / `endDate` | date | — | Filter escalation `createdAt` |

### Example

```
GET /api/admin/escalations?status=pending&page=1&limit=100
```

### Response `data`

```json
{
  "leads": [
    {
      "_id": "674abc...",
      "projectId": "PRO-029",
      "jobId": "PRO-029",
      "projectName": "Twin Creek",
      "lifecycleStatus": "negotiation",
      "quoteValue": 500000,
      "customerName": "Jane Smith",
      "buildingType": "Warehouse",
      "location": "Dallas, TX",
      "customerId": {
        "_id": "674def...",
        "firstName": "Jane",
        "lastName": "Smith",
        "customerName": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedTo": {
        "_id": "674sales...",
        "firstName": "Ravi",
        "lastName": "Kumar",
        "email": "ravi@company.com"
      },
      "escalation": {
        "_id": "675esc...",
        "note": "Customer demanding 40% discount",
        "status": "pending",
        "createdAt": "2026-06-15T10:00:00.000Z"
      }
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 100
}
```

---

### 8B. Sales escalated leads

| Method | Path |
|--------|------|
| GET | `/api/sales/leads/escalated` |

**Auth:** Bearer + `sales` role.

**Scope:** Only leads where `assignedSales = current user` (sales rep's own portfolio).

### Query params

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | string | `pending` | Escalation status |
| `page` | number | `1` | |
| `limit` | number | `20` | |

### Example

```
GET /api/sales/leads/escalated?status=pending&page=1&limit=100
```

### Response `data`

```json
{
  "leads": [
    {
      "_id": "674abc...",
      "projectId": "PRO-029",
      "jobId": "PRO-029",
      "projectName": "",
      "lifecycleStatus": "quotation_sent",
      "quoteValue": 125000,
      "customerName": "Jane Smith",
      "buildingType": "Warehouse",
      "location": "Dallas, TX",
      "customerId": {
        "_id": "674def...",
        "firstName": "Jane",
        "lastName": "Smith",
        "customerName": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedTo": {
        "_id": "674sales...",
        "firstName": "John",
        "lastName": "Rep",
        "email": "john@company.com"
      },
      "escalation": {
        "_id": "675esc...",
        "note": "Customer needs pricing revision",
        "status": "pending",
        "createdAt": "2026-06-10T12:00:00.000Z"
      }
    }
  ],
  "total": 1
}
```

---

### 8C. Admin vs sales — comparison

| | Admin `GET /api/admin/escalations` | Sales `GET /api/sales/leads/escalated` |
|--|-------------------------------------|----------------------------------------|
| **Data key** | `data.leads[]` | `data.leads[]` |
| **Row shape** | Same shared mapper | Same shared mapper |
| **Scope** | All escalations | Own assigned leads only |
| **Pagination in response** | `total`, `page`, `limit` | `total` only (no `page`/`limit` echoed) |
| **Extra filters** | `assignedSales`, date range | `status` only |
| **Project title fallback** | `customerName`, `buildingType`, `location` when `projectName` empty | Same |

### Shared row fields (use one table component)

| Field | Notes |
|-------|-------|
| `_id` | Lead `_id` |
| `projectId` / `jobId` | e.g. `PRO-029` |
| `projectName` | May be empty — use fallback fields |
| `customerName` | Top-level display name |
| `buildingType`, `location` | Project title fallback |
| `customerId.customerName` | Customer block |
| `assignedTo` | Assigned sales rep |
| `escalation._id` | Escalation document id (for resolve/assign actions) |
| `escalation.note` | Escalation message |
| `escalation.status` | `pending` / `resolved` |
| `escalation.createdAt` | When raised |

**Project title helper:**

```javascript
const title = projectName?.trim()
  || [customerName, buildingType, location].filter(Boolean).join(' · ')
  || jobId
  || 'Unnamed project'
```

---

## 9. Frontend checklist

### Plant — shipper & freight

- [ ] Project shipper KPIs: `GET /api/plant/shipper-files/projects/:leadId/stats`
- [ ] Freight dashboard KPIs: `GET /api/plant/deliveries/freight/stats`
- [ ] Freight detail screen: `GET /api/plant/deliveries/:deliveryId/detail`
- [ ] Bids table: `GET /api/plant/projects/:projectId/freight/bids`
- [ ] Revision modal: `POST /api/plant/freight-bids/:bidId/request-resubmit` `{ note, bidAmount? }`
- [ ] Award + confirm: `POST /api/plant/freight-bids/:bidId/select` → expect `status: "confirmed"`
- [ ] Calendar after award: `GET /api/plant/deliveries/calendar`

### Admin / Sales — payment schedule

- [ ] Load: `GET /api/payment-schedules/lead/:leadId`
- [ ] Save: `PUT /api/payment-schedules/lead/:leadId` with full `stages[]`

### Admin — meetings & escalations

- [ ] Lead meetings tab: `GET /api/admin/meetings?leadId=`
- [ ] Escalations list: `GET /api/admin/escalations` → bind **`data.leads[]`** (not `escalations`)

### Sales — escalations

- [ ] Escalations page: `GET /api/sales/leads/escalated?status=pending`
- [ ] Reuse same lead row component as admin escalations
- [ ] Customer name + project fallback: `customerId.customerName`, `customerName`, `buildingType`, `location`

---

## 10. Quick endpoint index

| Method | Path | Panel |
|--------|------|-------|
| GET | `/api/plant/shipper-files/projects/:leadId/stats` | Plant |
| GET | `/api/plant/deliveries/freight/stats` | Plant |
| GET | `/api/plant/deliveries/:deliveryId/detail` | Plant |
| GET | `/api/plant/projects/:projectId/freight/bids` | Plant |
| POST | `/api/plant/freight-bids/:bidId/request-resubmit` | Plant |
| POST | `/api/plant/freight-bids/:bidId/select` | Plant |
| GET | `/api/public/freight-bids/:token` | Public |
| POST | `/api/public/freight-bids/:token/submit` | Public |
| PUT | `/api/payment-schedules/lead/:leadId` | Admin / Sales |
| GET | `/api/admin/meetings?leadId=` | Admin |
| GET | `/api/admin/escalations` | Admin |
| GET | `/api/sales/leads/escalated` | Sales |

---

## Related docs

| Doc | Topic |
|-----|-------|
| [plant-frontend-api-updates-jun-2026.md](./plant-frontend-api-updates-jun-2026.md) | Broader plant panel changes |
| [payment-schedule-update-api.md](./payment-schedule-update-api.md) | Payment schedule PUT details |
| [sales-panel-updates-jun-2026.md](./sales-panel-updates-jun-2026.md) | Sales escalations, PO quoteValue, meetings |
| [plant-freight-load-details-api.md](./plant-freight-load-details-api.md) | Bundle/packing list on freight detail |
