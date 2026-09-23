# Admin & Plant — Frontend integration (fixes & new APIs)

**Date:** 2026-09-23  
**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** Staff JWT — `Authorization: Bearer <access_token>` (except **§4** public packing list).

Use the same paths under **`/api/plant/...`** (plant role) and **`/api/admin/plant/...`** (admin plant panel) where noted.

---

## 1. Plant project lifecycle — auto-fill stepper (13 steps)

**Goal:** “Update Step Status” should advance one plant stage and refresh dates / next step without the UI picking the next enum manually.

### 1.1 Load lifecycle (detail screen)

| Panel | Method | Path |
|--------|--------|------|
| Plant | `GET` | `/api/plant/projects/:leadId/detail` |
| Admin plant projects | `GET` | `/api/admin/plant/projects/:leadId/detail` |
| Admin lead (if using lead detail) | `GET` | `/api/admin/leads/:leadId/detail` |

**Response (additions on `data`):**

```json
{
  "success": true,
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
        "assignedPlannerId": "...",
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

- Bind the stepper UI to **`data.projectLifecycle`** (or `data.lifecycleSteps`, same array).
- **`projectLifecycle` is only populated when the lead is in a plant pipeline stage** (admin lead detail).

### 1.2 Complete current step

| Panel | Method | Path |
|--------|--------|------|
| Plant | `PUT` | `/api/plant/projects/:leadId/lifecycle` |
| Admin plant | `PUT` | `/api/admin/plant/projects/:leadId/lifecycle` |
| Admin lead | `PUT` | `/api/admin/leads/:leadId/lifecycle` |

**Request body (preferred):**

```json
{
  "completeCurrentStep": true,
  "note": "Optional note recorded on the step being completed"
}
```

**Legacy (still supported):**

```json
{
  "lifecycleStatus": "drawings_received",
  "note": "optional"
}
```

**Response `200` (plant project lifecycle):**

```json
{
  "success": true,
  "data": {
    "leadId": "...",
    "lifecycleStatus": "drawings_received",
    "lifecycleHistory": [],
    "projectLifecycle": { },
    "lifecycleSteps": []
  }
}
```

After success, refresh from **`data.projectLifecycle`** or re-call detail GET.

---

## 2. Delivery reschedule — `POST` / flexible validation

**Issues fixed:** UI used `POST` (now supported); strict ISO date and 24h times caused validation failures. **Reason is free text** from the frontend dropdown (hardcoded on FE, including **Others**).

| Panel | Method | Path |
|--------|--------|------|
| Admin plant | `POST` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId/reschedule` |
| Plant | `POST` or `PATCH` | `/api/plant/deliveries/:deliveryId/reschedule` |

**Request body (preferred):**

```json
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
| `rescheduleReason` | Yes | Any non-empty string (e.g. `Customer Request`, `Others`); alias: `reason` |
| `additionalNotes` | No | Optional; aliases: `notes`, `otherReason` |

\*Still send `timeWindowEnd` from the UI when the user picks an end time.

---

## 3. Shipper quotation lists — search, filter, pagination

Applies to **admin** and **plant** (`/api/admin/plant/shipper-files/...` and `/api/plant/shipper-files/...`; alias `/shipper-requests/...`).

### 3.1 Project list (all projects with shipper activity)

```http
GET /api/admin/plant/shipper-files/projects?page=1&limit=20
```

**Query parameters:**

| Param | Type | Description |
|--------|------|-------------|
| `page` | int | Default `1` |
| `limit` | int | Default `20`, max `200` |
| `search` | string | Matches `projectName`, `jobId`, `customerName`, `buildingType`, `location` |
| `fileStatus` | enum | `none` \| `partial` \| `all` (files received vs sent) |
| `fileReceivedStatus` | enum | Same as `fileStatus` |
| `buildingType` | string | Substring match |
| `status` | enum | Shipper request status on **any** request for that project (see below) |
| `comparisonStatus` | enum | `idle` \| `processing` \| `completed` \| `failed` |
| `vendorId` | ObjectId | Project has a request for this vendor |
| `hasSubmittedFile` | `true` \| `false` | Vendor submitted file |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "projects": [],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

### 3.2 Per-project vendor quotes (shipper requests)

```http
GET /api/admin/plant/shipper-files/projects/:leadId/requests?page=1&limit=10&search=steel
```

**Query parameters:**

| Param | Type | Description |
|--------|------|-------------|
| `page`, `limit` | int | Pagination (defaults `1`, `20`) |
| `search` | string | Vendor name/code, file name, status text |
| `status` | enum | `sent`, `submitted`, `comparison_processing`, `comparison_completed`, `comparison_failed`, `approved`, `rejected`, `resubmit_requested` |
| `comparisonStatus` | enum | `idle`, `processing`, `completed`, `failed` |
| `vendorId` | ObjectId | Filter by vendor |
| `hasSubmittedFile` | `true` \| `false` | |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "leadId": "...",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "stats": { "totalFiles": 3, "filesReceived": 2, "ordersSent": 3, "revisionsSent": 0 },
    "shipperRequests": [
      {
        "requestId": "...",
        "vendorId": "...",
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
        "amountComparison": { }
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

```http
GET /api/admin/plant/projects/:leadId/shipper-files?page=1&limit=10
```

Same query params as **§3.2**. Response uses **`shipperFiles`** array (includes `vendorCode`, `comparisonStatus`) plus `total`, `page`, `limit`.

---

## 4. Public packing list (no JWT)

For share links / QR / customer views.

```http
GET /api/packing-lists/:packingListId
GET /api/packing-list/:packingListId
GET /api/public/packing-lists/:packingListId
GET /api/plant/packing-lists/:packingListId
```

**Response `200`:** Standard success wrapper with packing list detail (`data.packingList`, bundles, truck info, etc.).

**404:** Invalid id or not found — `{ "success": false, "message": "Packing list not found" }`.

---

## 5. Admin Plant Overview — mismatch widget, employee filter, export

**Base:** `/api/admin/plant/dashboard`  
**Scope:** All widgets filter to leads with **approved PO** (`POOrder.status = approved`), optional date range on PO `createdAt`, optional plant assignee on PO `assignedTo`.

### 5.1 Shared query parameters (all dashboard GETs below)

| Param | Type | Description |
|--------|------|-------------|
| `startDate` | ISO8601 | PO `createdAt >= startDate` |
| `endDate` | ISO8601 | PO `createdAt <= endDate` (end of day) |
| `assignedTo` | ObjectId | Plant user assigned on PO |
| `employeeId` | ObjectId | **Alias** for `assignedTo` (use for “All Employees” dropdown) |
| `plantEmployeeId` | ObjectId | **Alias** for `assignedTo` |

Pass the **same query string** on every dashboard call when the user changes date range or employee.

Existing widgets (unchanged paths, now honor `employeeId`):

- `GET .../order-progress-review`
- `GET .../load-planning-status`
- `GET .../shipper-quotation-summary`
- `GET .../packing-list-summary`
- `GET .../qr-labels-summary`
- `GET .../shippers-summary`
- `GET .../deliveries-summary`

### 5.2 Missing / mismatch summary (new)

**Wire the four dashboard rows to this endpoint** (previously no API → UI showed `-`).

```http
GET /api/admin/plant/dashboard/mismatch-summary?startDate=...&endDate=...&employeeId=...
```

Alias: `GET .../missing-mismatch-summary` (same handler).

**Response `200`:**

```json
{
  "success": true,
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

| UI label | Field to use |
|----------|----------------|
| Missing Items from Quote vs Shipper | `missingItems` or `missingItemsFromQuote` |
| Quantity Mismatches | `quantityMismatches` or `qtyMismatches` |
| Specification Mismatches | `specificationMismatches` or `specMismatches` |
| Extra Items in Shipper | `extraItems` or `extraItemsInShipper` |

Counts come from **`QuoteComparisonResult`** for shipper requests with **`comparisonStatus: completed`** in scoped projects. If no comparisons yet, values are **`0`**.

### 5.3 View Mismatch Report (new)

```http
GET /api/admin/plant/dashboard/mismatch-report?page=1&limit=20&category=missing&search=Z82516
```

**Query:** Same date/employee params as §5.1, plus:

| Param | Values |
|--------|--------|
| `page`, `limit` | Pagination |
| `search` | Reason / status text |
| `category` | `missing` \| `qty` \| `spec` \| `extra` (omit = all mismatch types) |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "resultId": "...",
        "shipperRequestId": "...",
        "leadId": "...",
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

### 5.4 Export Plant Overview (new)

```http
GET /api/admin/plant/dashboard/export?startDate=...&endDate=...&employeeId=...
```

Alias: `GET .../overview/export`

**Response:** Excel file (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, filename `plant-overview.xlsx`). Use blob download in browser; same query params as dashboard filters.

---

## 12. Drawing + payment receipt Approve / Reject (admin + plant)

### 12a. Project drawings (plant + admin plant — same paths under `/api/admin/plant/projects/...`)

| Action | Methods | Path |
|--------|---------|------|
| Approve | `POST` or `PUT` | `/api/plant/projects/:leadId/drawings/:docId/approve` |
| Revision / reject | `POST` | `/api/plant/projects/:leadId/drawings/:docId/request-revision` |
| Revision / reject alias | `POST` | `/api/plant/projects/:leadId/drawings/:docId/reject` |
| Generic review | `PUT` or `POST` | `/api/plant/projects/:leadId/drawings/:docId/review` |

**Reject / revision body:** `{ "note": "..." }` (aliases: `notes`, `reviewNotes`, `revisionNote`).

**Review body:** `{ "status": "approved" }` or `{ "status": "rejected", "note": "..." }`.

Works for both `DrawingDocument` and plant `Building.drawings` (`docId` from merged drawings list).

### 12b. Admin construction drawings (legacy)

`PUT` or `POST` `/api/admin/construction/drawings/:docId/review` with `{ "status": "approved" \| "rejected", "notes": "..." }`.

Aliases: `POST .../approve`, `POST .../reject`.

### 12c. Payment receipt (Project Payments modal)

| Context | Approve (verify) | Reject |
|---------|------------------|--------|
| Shared | `PUT` or `POST` `/api/invoices/:invoiceId/payment-proof/verify` | `PUT` or `POST` `/api/invoices/:invoiceId/payment-proof/reject` |
| Alias approve | `.../payment-proof/approve` | — |
| Admin → customer project | `PUT` or `POST` `/api/admin/customers/:customerId/projects/:leadId/invoices/:invoiceId/payment-proof/verify` (and `/approve`, `/reject`) | same with `/reject` |
| Plant project | `PUT` or `POST` `/api/plant/projects/:leadId/invoices/:invoiceId/payment-proof/verify` (and `/approve`, `/reject`) | same |

**Body (optional):** `{ "reviewNotes": "..." }` (aliases: `notes`, `note`).

Requires `paymentProof.status === "pending_review"` on the invoice.

---

## 17. All Deliveries — actions + export

**List (filters):** `GET /api/admin/plant/all-deliveries` (plant: `/api/plant/all-deliveries`) — same query params as shipper §3 (`page`, `limit`, `search`, `projectId`, `customerId`, `carrierId`, `vendorId`, `internalOwner`, `deliveryStatus`, dates, etc.).

**Filter dropdowns:** `GET .../all-deliveries/filters/lookups`

| UI action | Method | Path |
|-----------|--------|------|
| **View** | `GET` | `/api/admin/plant/deliveries/:deliveryId/detail` |
| **Edit** | `PUT` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId` |
| **Reschedule** | `POST` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId/reschedule` |
| **Mark delivered** | `POST` or `PATCH` | `/api/admin/plant/deliveries/:deliveryId/mark-delivered` (or `PATCH .../status` with `{ "status": "delivered" }`) |
| **Send reminder** | `POST` | `/api/admin/plant/deliveries/:deliveryId/send-reminder` — optional body `{ "message": "..." }` |

Use the same paths under `/api/plant/...` for the plant role.

**Export** (pass the **same filter query string** as the list):

| Format | Path |
|--------|------|
| CSV | `GET .../all-deliveries/export` or `.../all-deliveries/export/csv` |
| Excel | `GET .../all-deliveries/export/excel` |
| CSV (alias) | `GET .../deliveries/export` or `.../deliveries/export/excel` |

Download as blob (`responseType: 'blob'`); do not expect JSON.

---

## 18. Notification History — filter + export

**List:** `GET /api/admin/plant/notification-details` (plant: `/api/plant/notification-details`)

**Filter dropdowns:** `GET .../notification-details/filters/lookups`

**Query params (list + export use the same set):**

| Param | Notes |
|--------|--------|
| `page`, `limit` | Pagination (list only) |
| `search` | Recipient, type, channel, delivery #, project, contact |
| `leadId` or `projectId` | Project filter |
| `deliveryId` | Single delivery |
| `status` / `deliveryStatus` | `Sent`, `Pending`, `Delivered`, `Failed`, `Scheduled`, `Rescheduled` (case-insensitive) |
| `channel` / `channelType` | `Email`, `SMS` (partial match ok, e.g. "Email Confirmation") |
| `recipientType` | `Customer`, `Internal Staff` |
| `startDate`, `endDate` | Filter by **sent** time (`sentAt`), ISO dates |

**Export** (blob download, pass same query string as list):

| Format | Path |
|--------|------|
| Excel | `GET .../notification-details/export` or `.../export/excel` |
| CSV | `GET .../notification-details/export/csv` |

Response list includes `deliveryStatusLabel` (e.g. Scheduled, Rescheduled) plus rollup `deliveryStatus` for stats cards.

---

## Frontend checklist

- [ ] **Lifecycle:** Stepper from `projectLifecycle`; “Update Step Status” → `PUT .../lifecycle` with `{ "completeCurrentStep": true }`.
- [ ] **Reschedule:** Use `POST` (or `PATCH`) on `.../deliveries/:deliveryId/reschedule` with required body fields.
- [ ] **Shipper lists:** Pass `page`, `limit`, `search`, filters on project list and `.../projects/:leadId/requests`.
- [ ] **Packing list public URL:** Use `/api/packing-lists/:id` or `/api/packing-list/:id` (no auth).
- [ ] **Plant Overview:** Call `mismatch-summary` for the mismatch card; pass `employeeId` (or `assignedTo`) on **all** dashboard GETs; Export → `dashboard/export`.
- [ ] **Mismatch report button:** Navigate or modal using `mismatch-report`.

---

## Related docs

- Full admin plant API: `docs/admin-plant-panel-api.md`
- Plant panel: `docs/plant-panel-api.md`
