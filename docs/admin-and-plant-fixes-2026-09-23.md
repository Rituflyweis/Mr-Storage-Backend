# Admin & Plant — Frontend integration (fixes & new APIs)

**Date:** 2026-09-23  
**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** Staff JWT — `Authorization: Bearer <access_token>` (except **§4** public packing list).

Use the same paths under **`/api/plant/...`** (plant role) and **`/api/admin/plant/...`** (admin plant panel) where noted.

### Conventions (all sections)

- **Request** = HTTP method, path, headers, query/body.
- **Response** = JSON unless noted as file download (`blob`).
- Standard wrapper: `{ "success": true, "message": "...", "data": { ... } }`.
- Errors: `{ "success": false, "message": "..." }` (validation may include `errors` array).

**Example headers (staff APIs):**

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

---

## 1. Plant project lifecycle — auto-fill stepper (13 steps)

**Goal:** “Update Step Status” advances one plant stage without the UI picking the next enum manually.

### 1.1 Load lifecycle (detail screen)

| Panel | Method | Path |
|--------|--------|------|
| Plant | `GET` | `/api/plant/projects/:leadId/detail` |
| Admin plant | `GET` | `/api/admin/plant/projects/:leadId/detail` |
| Admin lead | `GET` | `/api/admin/leads/:leadId/detail` |

**Request:**

```http
GET /api/admin/plant/projects/66f1a2b3c4d5e6f7a8b9c0d1/detail
Authorization: Bearer <token>
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lifecycleStatus": "released_to_plant",
    "projectLifecycle": {
      "steps": [
        {
          "stepNumber": 1,
          "key": "released_to_plant",
          "label": "Released to Plant",
          "status": "current",
          "date": "2026-09-19T00:00:00.000Z",
          "startedAt": "2026-09-19T00:00:00.000Z",
          "completedAt": null,
          "startedBy": "Sales One",
          "completedBy": "",
          "notes": ""
        }
      ],
      "totalSteps": 13,
      "currentStepNumber": 1,
      "currentStepKey": "released_to_plant",
      "currentStepLabel": "Released to Plant",
      "lifecycleStatus": "released_to_plant",
      "currentStep": {
        "key": "released_to_plant",
        "label": "Released to Plant",
        "stepNumber": 1,
        "totalSteps": 13,
        "plannedStartDate": "2026-09-19T00:00:00.000Z",
        "targetCompletion": null,
        "assignedPlanner": "Sales One",
        "assignedPlannerId": "66f1a2b3c4d5e6f7a8b9c0d2",
        "priority": "cold",
        "priorityLabel": "Cold",
        "nextStepKey": "drawings_received",
        "nextStepLabel": "Drawings Received",
        "notes": "",
        "completionPct": null
      },
      "nextStep": { "key": "drawings_received", "label": "Drawings Received" }
    },
    "lifecycleSteps": []
  }
}
```

- Bind the stepper to **`data.projectLifecycle`** (or `data.lifecycleSteps`).
- **`projectLifecycle` is only populated when the lead is in a plant pipeline stage** (admin lead detail).

### 1.2 Complete current step

| Panel | Method | Path |
|--------|--------|------|
| Plant | `PUT` | `/api/plant/projects/:leadId/lifecycle` |
| Admin plant | `PUT` | `/api/admin/plant/projects/:leadId/lifecycle` |
| Admin lead | `PUT` | `/api/admin/leads/:leadId/lifecycle` |

**Request (preferred):**

```http
PUT /api/admin/plant/projects/66f1a2b3c4d5e6f7a8b9c0d1/lifecycle
Authorization: Bearer <token>
Content-Type: application/json

{
  "completeCurrentStep": true,
  "note": "Optional note recorded on the step being completed"
}
```

**Request (legacy):**

```json
{
  "lifecycleStatus": "drawings_received",
  "note": "optional"
}
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "66f1a2b3c4d5e6f7a8b9c0d1",
    "lifecycleStatus": "drawings_received",
    "lifecycleHistory": [],
    "projectLifecycle": {},
    "lifecycleSteps": []
  }
}
```

After success, refresh from **`data.projectLifecycle`** or re-call **§1.1**.

---

## 2. Delivery reschedule — `POST` / flexible validation

**Issues fixed:** UI `POST` supported; flexible date/time; **reason is free text** from the FE dropdown (including **Others**).

| Panel | Method | Path |
|--------|--------|------|
| Admin plant | `POST` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId/reschedule` |
| Plant | `POST` or `PATCH` | `/api/plant/deliveries/:deliveryId/reschedule` |

**Request:**

```http
POST /api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/reschedule
Authorization: Bearer <token>
Content-Type: application/json

{
  "date": "2026-09-25",
  "timeWindowStart": "03:44 PM",
  "timeWindowEnd": "05:44 PM",
  "rescheduleReason": "Customer Request",
  "additionalNotes": "optional"
}
```

| Field | Required | Notes |
|--------|----------|--------|
| `date` | Yes | ISO (`2026-09-25`), `DD/MM/YYYY`, or `deliveryDate` / `newDeliveryDate` alias |
| `timeWindowStart` | Yes | 24h (`08:00`) or 12h (`03:44 PM`); aliases: `startTime`, `timeWindow.start` |
| `timeWindowEnd` | No* | If omitted, backend defaults to **start + 2 hours** |
| `rescheduleReason` | Yes | Any non-empty string; alias: `reason` |
| `additionalNotes` | No | Aliases: `notes`, `otherReason` |

**Response `200`:**

```json
{
  "success": true,
  "message": "Delivery rescheduled",
  "data": {
    "deliveryId": "66f1a2b3c4d5e6f7a8b9c0d3",
    "deliveryNumber": "DEL-2026-0012",
    "status": "rescheduled",
    "deliveryDate": "2026-09-25T00:00:00.000Z",
    "timeWindowStart": "03:44 PM",
    "timeWindowEnd": "05:44 PM",
    "timings": "03:44 PM - 05:44 PM",
    "rescheduleReason": "Customer Request",
    "additionalNotes": "optional",
    "reschedule": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d4",
      "previousDate": "2026-09-20T00:00:00.000Z",
      "date": "2026-09-25T00:00:00.000Z",
      "timeWindowStart": "03:44 PM",
      "timeWindowEnd": "05:44 PM",
      "reason": "Customer Request",
      "additionalNotes": "optional",
      "rescheduledAt": "2026-09-23T10:00:00.000Z",
      "rescheduledBy": "66f1a2b3c4d5e6f7a8b9c0d5",
      "acknowledged": false
    },
    "rescheduleHistory": []
  }
}
```

---

## 3. Shipper quotation lists — search, filter, pagination

Applies to **admin** and **plant** (`/api/admin/plant/shipper-files/...` and `/api/plant/shipper-files/...`; alias `/shipper-requests/...`).

### 3.1 Project list (all projects with shipper activity)

**Request:**

```http
GET /api/admin/plant/shipper-files/projects?page=1&limit=20&search=warehouse&fileStatus=partial&status=submitted
Authorization: Bearer <token>
```

**Query parameters:**

| Param | Type | Description |
|--------|------|-------------|
| `page` | int | Default `1` |
| `limit` | int | Default `20`, max `200` |
| `search` | string | `projectName`, `jobId`, `customerName`, `buildingType`, `location` |
| `fileStatus` | enum | `none` \| `partial` \| `all` |
| `fileReceivedStatus` | enum | Same as `fileStatus` |
| `buildingType` | string | Substring match |
| `status` | enum | Shipper request status on **any** request for that project |
| `comparisonStatus` | enum | `idle` \| `processing` \| `completed` \| `failed` |
| `vendorId` | ObjectId | Project has a request for this vendor |
| `hasSubmittedFile` | `true` \| `false` | Vendor submitted file |

**Shipper request `status` enum:** `sent`, `submitted`, `comparison_processing`, `comparison_completed`, `comparison_failed`, `approved`, `rejected`, `resubmit_requested`.

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "customerName": "Jane Doe",
        "buildingType": "Warehouse",
        "location": "Austin, TX",
        "filesReceived": 2,
        "filesSent": 3
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

### 3.2 Per-project vendor quotes (shipper requests)

**Request:**

```http
GET /api/admin/plant/shipper-files/projects/66f1a2b3c4d5e6f7a8b9c0d1/requests?page=1&limit=10&search=steel&status=submitted
Authorization: Bearer <token>
```

**Query parameters:** `page`, `limit`, `search`, `status`, `comparisonStatus`, `vendorId`, `hasSubmittedFile` (same enums as §3.1).

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "66f1a2b3c4d5e6f7a8b9c0d1",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "stats": { "totalFiles": 3, "filesReceived": 2, "ordersSent": 3, "revisionsSent": 0 },
    "shipperRequests": [
      {
        "requestId": "66f1a2b3c4d5e6f7a8b9c0d6",
        "vendorId": "66f1a2b3c4d5e6f7a8b9c0d7",
        "vendorName": "ABC Steel",
        "vendorCode": "VND-0001",
        "fileName": "quote.pdf",
        "uploadedDate": "2026-06-03T04:50:00.000Z",
        "rates": 2100,
        "fileStatus": "submitted",
        "comparisonStatus": "completed",
        "resubmitCount": 0,
        "resubmitRequestedAt": null,
        "canRequestResubmit": true,
        "amountComparison": {}
      }
    ],
    "total": 3,
    "page": 1,
    "limit": 10
  }
}
```

**Note:** `stats` reflects **all** requests on the project; `shipperRequests` is filtered/paginated.

### 3.3 Project tab shipper files

**Request:**

```http
GET /api/admin/plant/projects/66f1a2b3c4d5e6f7a8b9c0d1/shipper-files?page=1&limit=10
Authorization: Bearer <token>
```

Same query params as **§3.2**.

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "66f1a2b3c4d5e6f7a8b9c0d1",
    "shipperFiles": [
      {
        "requestId": "66f1a2b3c4d5e6f7a8b9c0d6",
        "vendorName": "ABC Steel",
        "vendorCode": "VND-0001",
        "fileStatus": "submitted",
        "comparisonStatus": "completed"
      }
    ],
    "total": 3,
    "page": 1,
    "limit": 10
  }
}
```

---

## 4. Public packing list (no JWT)

**Request:**

```http
GET /api/packing-lists/66f1a2b3c4d5e6f7a8b9c0d8
```

Aliases: `/api/packing-list/:id`, `/api/public/packing-lists/:id`, `/api/plant/packing-lists/:id`.

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "packingList": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d8",
      "packingListNo": "PL-001",
      "status": "ready",
      "truckType": "SEMI_53",
      "totalBundles": 12,
      "totalWeight": 45000,
      "deliveryLocation": "Site A",
      "bundles": []
    }
  }
}
```

**Response `404`:**

```json
{
  "success": false,
  "message": "Packing list not found"
}
```

---

## 5. Admin Plant Overview — mismatch widget, employee filter, export

**Base:** `/api/admin/plant/dashboard`  
**Scope:** Leads with **approved PO**; optional date range on PO `createdAt`; optional plant assignee on PO `assignedTo`.

### 5.1 Shared query parameters (all dashboard GETs below)

| Param | Type | Description |
|--------|------|-------------|
| `startDate` | ISO8601 | PO `createdAt >= startDate` |
| `endDate` | ISO8601 | PO `createdAt <= endDate` (end of day) |
| `assignedTo` | ObjectId | Plant user on PO |
| `employeeId` | ObjectId | **Alias** for `assignedTo` |
| `plantEmployeeId` | ObjectId | **Alias** for `assignedTo` |

**Example request (any widget):**

```http
GET /api/admin/plant/dashboard/order-progress-review?startDate=2026-09-01&endDate=2026-09-30&employeeId=66f1a2b3c4d5e6f7a8b9c0d9
Authorization: Bearer <token>
```

**Example response `200` (`order-progress-review`):**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "quotationsSent": 14,
    "uploadedBom": 11,
    "sentToShipper": 9,
    "loadsPlanned": 7,
    "shippedQuantity": 4
  }
}
```

Other widget paths (same query string):

| Path | Purpose |
|------|---------|
| `GET .../load-planning-status` | Load planning counts |
| `GET .../shipper-quotation-summary` | Shipper quote summary |
| `GET .../packing-list-summary` | Packing list summary |
| `GET .../qr-labels-summary` | QR labels summary |
| `GET .../shippers-summary` | Shippers summary |
| `GET .../deliveries-summary` | Deliveries summary |

Each returns `{ "success": true, "data": { ...widgetFields } }`.

### 5.2 Missing / mismatch summary

**Request:**

```http
GET /api/admin/plant/dashboard/mismatch-summary?startDate=2026-09-01&endDate=2026-09-30&employeeId=66f1a2b3c4d5e6f7a8b9c0d9
Authorization: Bearer <token>
```

Alias: `GET .../missing-mismatch-summary`.

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "missingItems": 12,
    "quantityMismatches": 3,
    "specificationMismatches": 5,
    "extraItems": 2,
    "missingItemsFromQuote": 12,
    "qtyMismatches": 3,
    "specMismatches": 5,
    "extraItemsInShipper": 2,
    "totalComparedLines": 450,
    "statusBreakdown": {
      "missing_in_vendor_quote": 12,
      "qty_mismatch": 3,
      "part_mismatch": 2
    }
  }
}
```

| UI label | Field |
|----------|--------|
| Missing Items from Quote vs Shipper | `missingItems` or `missingItemsFromQuote` |
| Quantity Mismatches | `quantityMismatches` or `qtyMismatches` |
| Specification Mismatches | `specificationMismatches` or `specMismatches` |
| Extra Items in Shipper | `extraItems` or `extraItemsInShipper` |

### 5.3 View Mismatch Report

**Request:**

```http
GET /api/admin/plant/dashboard/mismatch-report?page=1&limit=20&category=missing&search=Z82516&startDate=2026-09-01&endDate=2026-09-30
Authorization: Bearer <token>
```

| Param | Values |
|--------|--------|
| `page`, `limit` | Pagination |
| `search` | Reason / status text |
| `category` | `missing` \| `qty` \| `spec` \| `extra` (omit = all) |

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "items": [
      {
        "resultId": "66f1a2b3c4d5e6f7a8b9c0da",
        "shipperRequestId": "66f1a2b3c4d5e6f7a8b9c0d6",
        "leadId": "66f1a2b3c4d5e6f7a8b9c0d1",
        "projectName": "Lucas project",
        "jobId": "PRO-015",
        "vendorName": "Central States",
        "vendorCode": "VND-001",
        "fileName": "quote.xlsx",
        "status": "qty_mismatch",
        "severity": "high",
        "reason": "Qty mismatch on line 12",
        "expected": {},
        "received": {},
        "createdAt": "2026-09-18T00:00:00.000Z"
      }
    ],
    "total": 100,
    "page": 1,
    "limit": 20
  }
}
```

### 5.4 Export Plant Overview

**Request:**

```http
GET /api/admin/plant/dashboard/export?startDate=2026-09-01&endDate=2026-09-30&employeeId=66f1a2b3c4d5e6f7a8b9c0d9
Authorization: Bearer <token>
```

Alias: `GET .../overview/export`.

**Response:** Excel binary — `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, filename `plant-overview.xlsx`. Use `responseType: 'blob'`.

---

## 12. Drawing + payment receipt Approve / Reject (admin + plant)

### 12a. Project drawings (plant + admin plant)

| Action | Methods | Path |
|--------|---------|------|
| Approve | `POST` or `PUT` | `/api/plant/projects/:leadId/drawings/:docId/approve` |
| Revision / reject | `POST` | `/api/plant/projects/:leadId/drawings/:docId/request-revision` |
| Revision alias | `POST` | `/api/plant/projects/:leadId/drawings/:docId/reject` |
| Generic review | `PUT` or `POST` | `/api/plant/projects/:leadId/drawings/:docId/review` |

Use `/api/admin/plant/projects/...` for admin plant (same handler).

**Approve request:**

```http
POST /api/admin/plant/projects/66f1a2b3c4d5e6f7a8b9c0d1/drawings/66f1a2b3c4d5e6f7a8b9c0db/approve
Authorization: Bearer <token>
```

**Approve response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Drawing approved",
    "drawing": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0db",
      "name": "Floor Plan A1",
      "status": "approved",
      "source": "building"
    }
  }
}
```

**Reject / revision request:**

```json
{
  "note": "Revise column grid on sheet 2"
}
```

Aliases: `notes`, `reviewNotes`, `revisionNote`.

**Reject response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Revision requested",
    "drawing": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0db",
      "status": "rejected"
    }
  }
}
```

**Review request:**

```json
{
  "status": "approved"
}
```

or `{ "status": "rejected", "note": "..." }`.

### 12b. Admin construction drawings (legacy)

**Request:**

```http
PUT /api/admin/construction/drawings/66f1a2b3c4d5e6f7a8b9c0db/review
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "approved",
  "notes": "Looks good"
}
```

Aliases: `POST .../approve`, `POST .../reject`.

**Response `200`:** `{ "success": true, "data": { "drawing": { ... } } }`.

### 12c. Payment receipt (Project Payments modal)

| Context | Verify (approve) | Reject |
|---------|------------------|--------|
| Shared | `PUT` or `POST` `/api/invoices/:invoiceId/payment-proof/verify` | `PUT` or `POST` `/api/invoices/:invoiceId/payment-proof/reject` |
| Alias approve | `.../payment-proof/approve` | — |
| Admin → customer project | `/api/admin/customers/:customerId/projects/:leadId/invoices/:invoiceId/payment-proof/verify` (+ `/approve`, `/reject`) | same with `/reject` |
| Plant project | `/api/plant/projects/:leadId/invoices/:invoiceId/payment-proof/verify` (+ `/approve`, `/reject`) | same |

**Verify request:**

```http
PUT /api/invoices/66f1a2b3c4d5e6f7a8b9c0dc/payment-proof/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "reviewNotes": "Bank reference matched"
}
```

Body aliases: `notes`, `note`. Requires `paymentProof.status === "pending_review"`.

**Verify response `200`:**

```json
{
  "success": true,
  "message": "Payment receipt verified — invoice marked as paid",
  "data": {
    "invoice": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0dc",
      "status": "paid",
      "paymentProof": {
        "status": "verified",
        "reviewNotes": "Bank reference matched",
        "reviewedAt": "2026-09-23T12:00:00.000Z"
      }
    }
  }
}
```

**Reject response `200`:**

```json
{
  "success": true,
  "message": "Payment receipt rejected",
  "data": {
    "invoice": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0dc",
      "status": "sent",
      "paymentProof": {
        "status": "rejected",
        "reviewNotes": "Amount mismatch"
      }
    }
  }
}
```

---

## 17. All Deliveries — actions + export

### 17.1 List + filter lookups

**List request:**

```http
GET /api/admin/plant/all-deliveries?page=1&limit=10&search=DEL-2026&deliveryStatus=scheduled&projectId=66f1a2b3c4d5e6f7a8b9c0d1
Authorization: Bearer <token>
```

Plant: `/api/plant/all-deliveries`. Query params include `page`, `limit`, `search`, `projectId`, `customerId`, `carrierId`, `vendorId`, `internalOwner`, `deliveryStatus`, date filters, etc.

**List response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "draft": 2,
      "total": 45,
      "scheduled": 10,
      "confirmed": 5,
      "inTransit": 8,
      "delivered": 15,
      "delayed": 1,
      "cancelled": 4
    },
    "deliveries": [
      {
        "_id": "66f1a2b3c4d5e6f7a8b9c0d3",
        "deliveryNumber": "DEL-2026-0012",
        "status": "scheduled",
        "deliveryDate": "2026-09-25T00:00:00.000Z",
        "leadId": {
          "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
          "projectName": "ABC Warehouse",
          "jobId": "PRO-001",
          "customerId": { "firstName": "Jane", "lastName": "Doe" }
        },
        "vendorName": "ABC Steel",
        "internalOwnerName": "Plant User One"
      }
    ],
    "total": 45,
    "page": 1,
    "limit": 10
  }
}
```

**Filter dropdowns:**

```http
GET /api/admin/plant/all-deliveries/filters/lookups
Authorization: Bearer <token>
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendors": [{ "_id": "...", "vendorName": "ABC Steel" }],
    "internalOwners": [{ "_id": "...", "name": "Plant User One" }],
    "materialCategories": ["Structural", "Roofing"]
  }
}
```

### 17.2 Row actions

**Frontend (quick actions only):** see **`docs/frontend-delivery-quick-actions-api.md`** — Send reminder, Download details, View documents (detail + All Deliveries + Calendar).

| UI action | Method | Path |
|-----------|--------|------|
| **View** | `GET` | `/api/admin/plant/deliveries/:deliveryId/detail` |
| **Edit** | `PUT` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId` |
| **Reschedule** | `POST` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId/reschedule` |
| **Update status** | `PATCH` | `/api/admin/plant/deliveries/:deliveryId/status` |
| **Mark delivered** | `POST` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId/mark-delivered` |
| **Send reminder** | `POST` | `/api/admin/plant/deliveries/:deliveryId/send-reminder` |
| **Download details (PDF)** | `GET` | `/api/admin/plant/deliveries/:deliveryId/download` |
| **View documents (list)** | `GET` | `/api/admin/plant/deliveries/:deliveryId/documents` |

Same paths under `/api/plant/...` for plant role.

**Unified quick actions (Delivery detail, All Deliveries row menu, Calendar event):** use the same `:deliveryId` everywhere — list/calendar rows expose Mongo `_id` as `deliveryId` / `_id`. Wire **Send reminder**, **Download details**, and **View documents** to the paths above on every surface (no separate list-only or calendar-only URLs).

**Download details** returns `application/pdf` (attachment). **View documents** returns JSON with PDF download URLs (details, packing list, instructions) plus any uploaded `documentUrl` / `attachments` on the delivery.

```http
GET /api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/documents
Authorization: Bearer <token>
```

**Documents response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "documents": [
      { "name": "Delivery Details PDF", "type": "pdf", "url": "/api/admin/plant/deliveries/66f1…/download" },
      { "name": "Packing List PDF", "type": "pdf", "url": "/api/admin/plant/deliveries/66f1…/download/packing-list" },
      { "name": "Instructions PDF", "type": "pdf", "url": "/api/admin/plant/deliveries/66f1…/download/instructions" }
    ]
  }
}
```

Optional sub-downloads (same auth as main download):

| Document | Path suffix |
|----------|-------------|
| Packing list PDF | `.../download/packing-list` |
| Instructions PDF | `.../download/instructions` |

**Update status request:**

```http
PATCH /api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "material_prepared"
}
```

**Update status response `200`:**

```json
{
  "success": true,
  "message": "Delivery status updated",
  "data": {
    "delivery": {
      "_id": "66f1a2b3c4d5e6f7a8b9c0d3",
      "deliveryNumber": "DEL-2026-0012",
      "status": "material_prepared",
      "statusHistory": []
    }
  }
}
```

Allowed `status` values (body): all delivery statuses **except** `draft`, `bidding_sent`, `carrier_selected`. Transitions validated server-side.

**Send reminder request:**

```http
POST /api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/send-reminder
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Please confirm site access for tomorrow"
}
```

**Send reminder response `200`:**

```json
{
  "success": true,
  "message": "Delivery reminder sent",
  "data": {
    "deliveryId": "66f1a2b3c4d5e6f7a8b9c0d3",
    "channels": { "email": true, "sms": false, "inApp": true }
  }
}
```

### 17.3 Export

Pass the **same filter query string** as the list.

| Format | Path |
|--------|------|
| CSV | `GET .../all-deliveries/export` or `.../all-deliveries/export/csv` |
| Excel | `GET .../all-deliveries/export/excel` |
| CSV (alias) | `GET .../deliveries/export` or `.../deliveries/export/excel` |

**Response:** file download (`blob`), not JSON.

---

## 18. Notification History — filter + export

**Filter lookups request:**

```http
GET /api/admin/plant/notification-details/filters/lookups
Authorization: Bearer <token>
```

**Filter lookups response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "deliveryStatuses": ["Sent", "Pending", "Delivered", "Failed", "Scheduled", "Rescheduled"],
    "channels": ["Email", "SMS"],
    "recipientTypes": ["Customer", "Internal Staff"],
    "projects": [
      { "leadId": "66f1a2b3c4d5e6f7a8b9c0d1", "projectId": "PRO-001", "projectName": "ABC Warehouse" }
    ]
  }
}
```

**List request:**

```http
GET /api/admin/plant/notification-details?page=1&limit=20&status=Sent&channel=Email&leadId=66f1a2b3c4d5e6f7a8b9c0d1&startDate=2026-09-01&endDate=2026-09-30
Authorization: Bearer <token>
```

Plant: `/api/plant/notification-details`.

| Param | Notes |
|--------|--------|
| `page`, `limit` | Pagination (list only) |
| `search` | Recipient, type, channel, delivery #, project, contact |
| `leadId` or `projectId` | Project filter |
| `deliveryId` | Single delivery |
| `status` / `deliveryStatus` | `Sent`, `Pending`, `Delivered`, `Failed`, `Scheduled`, `Rescheduled` |
| `channel` / `channelType` | `Email`, `SMS` |
| `recipientType` | `Customer`, `Internal Staff` |
| `startDate`, `endDate` | Filter by **sent** time (`sentAt`), ISO dates |

**List response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "notifications": [
      {
        "notificationId": "NOT-001",
        "deliveryId": "66f1a2b3c4d5e6f7a8b9c0d3",
        "deliveryNumber": "DEL-2026-0012",
        "notificationType": "Delivery Scheduled",
        "channel": "Email",
        "recipient": "Jane Doe",
        "recipientContact": "jane@example.com",
        "recipientType": "Customer",
        "deliveryStatus": "Pending",
        "deliveryStatusLabel": "Scheduled",
        "rawDeliveryStatus": "scheduled",
        "hasReschedule": false,
        "sentAt": "2026-09-20T14:30:00.000Z",
        "project": "ABC Warehouse",
        "leadId": "66f1a2b3c4d5e6f7a8b9c0d1",
        "materialType": "Structural",
        "deliveryDate": "2026-09-25T00:00:00.000Z",
        "timeWindowStart": "08:00 AM",
        "timeWindowEnd": "10:00 AM"
      }
    ],
    "total": 128,
    "page": 1,
    "limit": 20,
    "stats": {
      "total": 128,
      "sent": 40,
      "delivered": 25,
      "pending": 50,
      "failed": 13
    }
  }
}
```

**Export** (same query string as list, `blob`):

| Format | Path |
|--------|------|
| Excel | `GET .../notification-details/export` or `.../export/excel` |
| CSV | `GET .../notification-details/export/csv` |

---

## 19. Admin Audit Log (all panels & staff)

**Purpose:** Single admin-only feed of **every captured activity** — actions by **multiple admins**, **sales**, **plant**, **construction**, **accounts**, plus **customer portal** and **public** where logged. Includes:

- Explicit business events (`auditService.log`, e.g. lifecycle, invoice, delivery).
- Automatic capture on mutating HTTP calls (`POST`/`PUT`/`PATCH`/`DELETE`) on `/api/*` routes (except skipped paths like login, export, webhooks).

**Auth:** Admin role only (`/api/admin/audit-logs`).

### 19.1 List audit logs

**Request:**

```http
GET /api/admin/audit-logs?page=1&limit=50&panel=plant&type=plant&action=delivery.rescheduled&from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.999Z&search=delivery
Authorization: Bearer <admin_token>
```

**Query parameters:**

| Param | Validation | Description |
|--------|------------|-------------|
| `page` | int ≥ 1 (default `1`) | Page number |
| `limit` | int 1–200 (default **50**) | Page size |
| `panel` | enum (see below) | Which panel the request was made from |
| `type` | enum (see **§19.3**) | High-level audit category |
| `action` | string | **Exact** match on stored action code (e.g. `lead.lifecycle_updated`) |
| `actorId` | MongoId | Staff/customer actor id (legacy field) |
| `performedBy` | MongoId | Staff user who performed the action |
| `leadId` | MongoId | Filter by project/lead |
| `customerId` | MongoId | Filter by customer |
| `from` | ISO8601 | `createdAt >= from` |
| `to` | ISO8601 | `createdAt <= to` |
| `search` | string | Case-insensitive regex on `action`, `path`, `panel`, `entityType` |

**`panel` enum:** `admin`, `sales`, `construction`, `plant`, `account`, `customer`, `public`.

**UI tips:**

- **All staff activity:** omit `panel`, optionally filter `performedBy` to one user.
- **One admin only:** `panel=admin&performedBy=<adminUserId>`.
- **Plant team:** `panel=plant` or filter `type=plant`.
- **Customer actions:** `panel=customer` or filter by `customerId`.

**Response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "logs": [
      {
        "_id": "66f1a2b3c4d5e6f7a8b9c0e1",
        "type": "plant",
        "action": "delivery.rescheduled",
        "leadId": "66f1a2b3c4d5e6f7a8b9c0d1",
        "customerId": "66f1a2b3c4d5e6f7a8b9c0e2",
        "performedBy": "66f1a2b3c4d5e6f7a8b9c0d5",
        "actorType": "staff",
        "actorId": "66f1a2b3c4d5e6f7a8b9c0d5",
        "panel": "plant",
        "entityType": "Delivery",
        "entityId": "66f1a2b3c4d5e6f7a8b9c0d3",
        "httpMethod": "POST",
        "path": "/api/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/reschedule",
        "metadata": {
          "deliveryId": "66f1a2b3c4d5e6f7a8b9c0d3",
          "deliveryNumber": "DEL-2026-0012"
        },
        "createdAt": "2026-09-23T10:15:00.000Z",
        "message": "Delivery rescheduled for ABC Warehouse",
        "actor": {
          "type": "staff",
          "_id": "66f1a2b3c4d5e6f7a8b9c0d5",
          "name": "Plant User One",
          "email": "plant1@example.com",
          "role": "plant"
        }
      },
      {
        "_id": "66f1a2b3c4d5e6f7a8b9c0e3",
        "type": "user",
        "action": "admin.updated",
        "performedBy": "66f1a2b3c4d5e6f7a8b9c0e4",
        "panel": "admin",
        "metadata": { "targetUserId": "66f1a2b3c4d5e6f7a8b9c0e5" },
        "createdAt": "2026-09-23T09:00:00.000Z",
        "message": "Admin user updated",
        "actor": {
          "type": "staff",
          "_id": "66f1a2b3c4d5e6f7a8b9c0e4",
          "name": "Super Admin",
          "email": "admin@example.com",
          "role": "admin"
        }
      }
    ],
    "total": 1240,
    "page": 1,
    "limit": 50,
    "pages": 25
  }
}
```

Each row includes:

- Raw **`AuditLog`** fields (`type`, `action`, `metadata`, HTTP context, etc.).
- **`message`** — human-readable line for the UI (from `formatAuditActivityMessage`).
- **`actor`** — resolved staff (`name`, `email`, `role`) or customer, or `{ "type": "anonymous" }`.

**Response `400` (invalid query):**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "msg": "Invalid value", "param": "panel", "location": "query" }
  ]
}
```

There is **no separate export endpoint** for audit logs today; paginate with `page` / `limit` or add export in a follow-up if needed.

### 19.2 Suggested Admin Audit Log UI filters

| Dropdown | Query param | Values |
|----------|-------------|--------|
| Panel | `panel` | All, Admin, Sales, Plant, Construction, Accounts, Customer, Public |
| Category | `type` | See §19.3 |
| Action | `action` | Pick from §19.4 or free-text exact match |
| Employee | `performedBy` | User `_id` from admin/employee directory |
| Project | `leadId` | Lead `_id` |
| Customer | `customerId` | Customer `_id` |
| Date range | `from`, `to` | ISO datetimes |

### 19.3 Audit `type` enum (`AUDIT_TYPES`)

`lead`, `invoice`, `quotation`, `meeting`, `followup`, `user`, `escalation`, `po`, `chat`, `activity`, `plant`, `smdt`, `payment`, `auth`, `construction`, `customer`.

### 19.4 Audit `action` codes (`AUDIT_ACTIONS`)

Use **`action`** query for exact filter. Stored values include (grouped):

**Lead & project:** `lead.created`, `lead.assigned.auto`, `lead.assigned.manual`, `lead.quote_ready`, `lead.handed_to_sales`, `lead.lifecycle_updated`, `lead.released_to_plant`, `lead.escalated`, `lead.po_raised`, `lead.po_approved`, `lead.po_rejected`, `lead.edited`, `lead.temperature_updated`, `lead.terminated`, `lead.deleted`, `lead.note_added`, `lead.buildings_created`, `lead.buildings_synced`, `lead.document_added`, `lead.document_removed`, `lead.budget_set`.

**Drawings & BOM:** `drawing.uploaded`, `drawing.reviewed`, `bom.approved`, `bom.rejected`, `bom.job_started`, `bom.job_completed`, `bom.job_failed`, `bom.confirmed`, `consolidated_bom.generated`, `consolidated_bom.sent`.

**Shipper:** `shipper.file_submitted`, `shipper.all_submitted`, `shipper.request_approved`, `shipper.request_rejected`, `shipper.resubmit_requested`.

**Quotation & invoice:** `quotation.created`, `quotation.sent`, `quotation.accepted`, `quotation.rejected`, `quotation.edited`, `quotation.deleted`, `quotation.submitted_for_approval`, `quotation.approved`, `quotation.approval_rejected`, `invoice.created`, `invoice.submitted_for_approval`, `invoice.approved`, `invoice.rejected`, `invoice.sent`, `invoice.paid`, `invoice.edited`, `invoice.payment_proof_submitted`, `invoice.payment_proof_verified`, `invoice.payment_proof_rejected`.

**Payments:** `payment.stage_invoiced`, `payment.stage_paid`, `payment.schedule_updated`.

**Meetings & follow-ups:** `meeting.created`, `meeting.edited`, `meeting.completed`, `followup.created`, `followup.completed`, `followup.config_updated`, `followup.auto_sent`, `followup.auto_failed`, `followup.template_created`, `followup.template_updated`, `followup.template_deleted`.

**Escalations & chat:** `escalation.created`, `escalation.resolved`, `chat.ended`, `chat.reopened`, `chat.staff_takeover`, `activity.logged`.

**Users & admins:** `user.created`, `user.updated`, `user.password_reset`, `user.deleted`, `admin.main_assigned`, `admin.created`, `admin.updated`, `admin.status_toggled`, `admin.deleted`.

**Customers:** `customer.created`, `customer.updated`, `customer.deactivated`, `customer.activated`, `customer.project_created`, `customer.login.success`, `customer.login.failed`, `customer.profile.updated`.

**Plant / logistics:** `vendor.created`, `vendor.updated`, `carrier.created`, `carrier.updated`, `delivery.created`, `delivery.edited`, `delivery.rescheduled`, `delivery.reminder_sent`, `delivery.marked_delivered`, `delivery.callback_requested`, `delivery.confirmation_sent`, `freight_bids.sent`, `freight_bid.submitted`, `freight_bids.all_submitted`, `freight_bid.selected`, `freight_bid.resubmit_requested`, `bundle_plan.generated`.

**SMDT:** `smdt.bulk_uploaded`, `smdt.item_added`, `smdt.item_updated`, `smdt.item_deleted`.

**Auth:** `auth.login.success`, `auth.login.failed`, `auth.logout`, `auth.password.changed`, `auth.profile.updated`.

**Construction:** `construction.task.created`, `construction.task.updated`, `construction.task.deleted`, `construction.work_log.created`, `construction.milestone.created`, `construction.milestone.updated`, `construction.project_step.updated`, `construction.delivery.created`, `construction.material_request.created`.

**Generic HTTP mutations:** `entity.created`, `entity.updated`, `entity.deleted` (when auto-logged from API middleware).

Additional one-off actions may appear in `metadata` or as custom `action` strings from new features; **`search`** helps discover them.

---

## Frontend checklist

- [ ] **Lifecycle:** Stepper from `projectLifecycle`; “Update Step Status” → `PUT .../lifecycle` with `{ "completeCurrentStep": true }`.
- [ ] **Reschedule:** `POST`/`PATCH` `.../deliveries/:deliveryId/reschedule` with required body fields.
- [ ] **Shipper lists:** `page`, `limit`, `search`, filters on project list and `.../projects/:leadId/requests`.
- [ ] **Packing list public URL:** `/api/packing-lists/:id` (no auth).
- [ ] **Plant Overview:** `mismatch-summary`; `employeeId` on **all** dashboard GETs; export → `dashboard/export`.
- [ ] **Mismatch report:** `mismatch-report` with `category` + pagination.
- [ ] **Deliveries:** Status → `PATCH .../deliveries/:id/status`; reminder → `POST .../send-reminder`.
- [ ] **Notification history:** `notification-details` + shared filters with export.
- [ ] **Audit log (admin):** `GET /api/admin/audit-logs` with `panel`, `type`, `action`, `performedBy`, dates; display `message` + `actor`.

---

## Related docs

- Freight deliveries filters & enums: `docs/admin-plant-freight-deliveries-api.md`
- Full admin plant API: `docs/admin-plant-panel-api.md`
- Plant panel: `docs/plant-panel-api.md`
