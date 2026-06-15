# Plant Panel — Frontend API Reference

Frontend integration guide for the **Plant Panel** (`role: "plant"`).

> **Maintenance:** Add or update a section here whenever a plant panel endpoint is implemented or changed. Only document **completed** endpoints — no placeholders for work in progress.
>
> **Last updated:** 2026-06-05 — BOM/consolidated flow refresh, shipper comparison + resubmit loop, bundle plan + packing list plan APIs, full socket events.

---

## Base URL & auth

| Item | Value |
|------|--------|
| Base path | `/api/plant` |
| Required role | `plant` |
| Auth header | `Authorization: Bearer <access_token>` |

Plant users log in via the **shared** auth endpoint (same as admin/sales):

```http
POST /api/auth/login
Content-Type: application/json
```

**Request body**

```json
{
  "email": "plant.user@example.com",
  "password": "TempPass123"
}
```

**Response (`data`)**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "role": "plant",
  "user": {
    "_id": "665a00000000000000000001",
    "name": "Plant User",
    "email": "plant.user@example.com",
    "role": "plant"
  }
}
```

Use `accessToken` on all `/api/plant/*` requests. Refresh with `POST /api/auth/refresh` when expired.

---

## File uploads (S3)

Plant users upload files **directly to S3** using a presigned URL, then register the returned `fileUrl` on the relevant plant endpoint (drawings, BOM, etc.). The backend never receives file bytes.

### Step 1 — Get presigned URL

```http
POST /api/upload/presigned-url
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request body**

```json
{
  "fileName": "building1-v2.pdf",
  "fileType": "application/pdf",
  "folder": "drawings"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `fileName` | Yes | Original filename (used for extension) |
| `fileType` | Yes | MIME type sent with the S3 PUT |
| `folder` | No | Use `"drawings"` for building drawings. Also: `"bom"`, `"smdt"`, `"vendor-files"`, `"documents"` |

**Response `data`**

```json
{
  "uploadUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid.pdf?X-Amz-...",
  "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid.pdf",
  "key": "drawings/uuid.pdf"
}
```

### Step 2 — Upload file to S3

```http
PUT <uploadUrl>
Content-Type: <same fileType as step 1>

<binary file body>
```

Use the exact `uploadUrl` from step 1. Do **not** send the plant JWT on the S3 PUT unless your S3 setup requires it (default presigned flow does not).

### Step 3 — Register URL on backend

Call the backend endpoint for that feature — drawings: [§9](#9-post-apiplantprojectsleadiddrawings); BOM: [§11](#11-post-apiplantprojectsleadidbom); SMDT: [§30](#30-post-apismdtupload).

**Role:** `plant` users are allowed on `POST /api/upload/presigned-url` (same route as admin/sales).

---

## Response envelope

All endpoints return:

```json
// Success
{
  "success": true,
  "message": "Success",
  "data": { }
}

// Error
{
  "success": false,
  "message": "Human-readable error",
  "errors": []
}
```

`errors` is present only for validation failures (invalid query params, etc.).

---

## Project scope (all plant project APIs)

Every project endpoint only includes leads where:

1. A **PO order** exists with `status: "approved"`
2. That PO is **assigned to the logged-in plant user** (`assignedTo === user._id`)

Optional `startDate` / `endDate` filters apply to the PO order’s `createdAt` (not the lead’s).

---

## Shared enums

### `drawingStatus` (response + query filter)

| Value | Meaning |
|-------|---------|
| `none` | No drawings uploaded on any building |
| `pending` | At least one building’s latest drawing is `pending_review` |
| `rejected` | At least one building’s latest drawing is `rejected` (and none pending) |
| `all_approved` | Every building with drawings has latest version `approved` |

`bomStatus` is returned on each project row for display only (`none` \| `partial` \| `all_confirmed`) — it is **not** a query filter.

### Building `status` (per building, upload screen)

| Value | Meaning |
|-------|---------|
| `drawing_pending` | Awaiting first drawing (set when PO assigned to plant) |
| `drawing_uploaded` | Latest version uploaded, awaiting customer review |
| `drawing_approved` | Customer approved latest version |
| `drawing_rejected` | Customer rejected latest version — plant should re-upload |
| `bom_pending` … | Later BOM/production stages |

After each successful drawing upload, building `status` → `drawing_uploaded`.

### Plant `lifecycleStatus` (project detail + `PUT .../lifecycle`)

Ordered pipeline after admin assigns PO to plant:

`released_to_plant` → `drawings_received` → `bom_received` → `bom_review` → `material_check` → `production_planning` → `fabrication_started` → `quality_inspection` → `packing_bundling` → `shipper_prepared` → `ready_for_delivery` → `dispatched` → `delivered`

| Stage | Set by |
|-------|--------|
| `released_to_plant` | **Auto** when admin assigns approved PO to plant user |
| All others | Plant user via `PUT /api/plant/projects/:leadId/lifecycle` (forward-only) |

### Vendor `status`

`active` | `inactive`

### Vendor `vendorType`

`steel` | `insulation` | `panels` | `trim` | `hardware` | `other`

### Carrier `status`

`active` | `inactive`

### SMDT `costUnit`

`FT` | `LB` | `EA`

### SMDT `category` (Excel sheet names)

`Insulation` | `Joist` | `Panels` | `TRIM` | `Mastic` | `Screws` | `ABolts` | `CLIPS` | `Cable` | `Flange_Brace` | `Jambs` | `DCOL` | `ZGIRT` | `OPEN CHANNEL` | `EaveStruts` | `ACCESSORIES` | `SKTLIGHT` | `ANGL1` | `TS_PANEL` | `frames`

### `consolidatedBOM.status`

`draft` | `sent_to_vendor` | `vendor_submitted` | `approved`

### `shipperRequest.status`

`sent` | `submitted` | `comparison_processing` | `comparison_completed` | `comparison_failed` | `approved` | `rejected` | `resubmit_requested`

Vendor public upload link is active when status is `sent`, `resubmit_requested`, or `submitted`.

### `shipperRequest.comparisonStatus`

`idle` | `processing` | `completed` | `failed`

### `quoteComparisonResult.status` (filter on §21M)

`matched` | `missing_in_vendor_quote` | `extra_in_vendor_quote` | `qty_mismatch` | `length_mismatch` | `weight_mismatch` | `part_mismatch` | `price_mismatch` | `ambiguous_match`

### `bundlePlan.status` / `bundle.status`

Bundle plan: `draft` | `generated` | `confirmed` | `cancelled`

Bundle: `draft` | `confirmed` | `assigned_to_truck` | `loaded`

### `bundleType`

`panels` | `trim` | `framing` | `fasteners` | `accessories` | `mixed` | `custom`

---

## Index

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | GET | `/api/plant/projects/stats` | Project KPI counts |
| 2 | GET | `/api/plant/projects` | Paginated project list |
| 3 | GET | `/api/plant/projects/:leadId/detail` | Project detail + audit log |
| 4 | PUT | `/api/plant/projects/:leadId/lifecycle` | Update plant lifecycle stage |
| 5 | GET | `/api/plant/projects/:leadId/notes` | List project notes |
| 6 | POST | `/api/plant/projects/:leadId/notes` | Add project note |
| 7 | GET | `/api/plant/projects/:leadId/invoices` | Invoice summary list |
| 8 | GET | `/api/plant/projects/:leadId/buildings` | Buildings list (upload screen) |
| 9 | POST | `/api/plant/projects/:leadId/drawings` | Register drawing URL(s) after S3 upload |
| 10 | GET | `/api/plant/projects/:leadId/drawings` | Full drawing history by building |
| 11 | POST | `/api/plant/projects/:leadId/bom` | Register BOM file(s) after S3 upload |
| 12 | GET | `/api/plant/projects/:leadId/bom-files` | Latest BOM job per building |
| 13 | GET | `/api/plant/bom/job/:jobId/status` | Poll BOM extraction status |
| 14 | POST | `/api/plant/bom/jobs/status` | Batch poll multiple job statuses |
| 14A | GET | `/api/plant/bom/stats` | BOM dashboard stats |
| 14B | GET | `/api/plant/bom/projects` | BOM project list with status per latest upload |
| 15 | GET | `/api/plant/bom/:jobId` | BOM job detail + line items |
| 16 | PUT | `/api/plant/bom/items/:bomItemId/price` | Manual price + optional save to SMDT |
| 17 | POST | `/api/plant/bom/buildings/:buildingId/confirm` | Confirm building BOM (all priced) |
| 18 | POST | `/api/plant/projects/:leadId/consolidated-bom/generate` | Generate consolidated BOM Excel |
| 19 | GET | `/api/plant/projects/:leadId/consolidated-bom` | View consolidated BOM + grouped items |
| 19B | GET | `/api/plant/bom/projects/:leadId/consolidated-url` | Get consolidated BOM URL readiness |
| 19A | POST | `/api/plant/projects/:leadId/consolidated-bom/send` | Send consolidated BOM to selected vendors |
| 20 | GET | `/api/plant/projects/:leadId/delivery` | Confirmed delivery detail for project (404 if none awarded) |
| 21 | GET | `/api/plant/projects/:leadId/shipper-files` | Vendor shipper submissions |
| 21A | GET | `/api/public/vendor-upload/:token` | Public upload link details for vendor |
| 21B | POST | `/api/public/vendor-upload/:token/presigned-url` | Presigned URL for vendor quote file upload |
| 21C | POST | `/api/public/vendor-upload/:token` | Submit vendor quote file + quote amount |
| 21D | GET | `/api/plant/shipper-files/projects` | Projects with raised shipper requests + received status |
| 21E | GET | `/api/plant/shipper-files/projects/:leadId/requests` | Project-wise shipper request list |
| 21F | GET | `/api/plant/shipper-requests/:requestId/document` | Single shipper document details |
| 21G | POST | `/api/plant/shipper-requests/:requestId/compare` | Start async comparison job |
| 21H | GET | `/api/plant/shipper-requests/compare-jobs/:jobId/status` | Poll comparison job status |
| 21I | POST | `/api/plant/shipper-requests/compare-jobs/status` | Batch poll comparison job statuses |
| 21J | POST | `/api/plant/shipper-requests/:requestId/approve` | Approve selected vendor request and auto-reject others |
| 21K | POST | `/api/plant/shipper-requests/:requestId/request-resubmit` | Ask vendor to submit corrected quote |
| 21L | GET | `/api/plant/shipper-requests/:requestId/comparison-summary` | Summary + row-level items + `canProceedToApproval` |
| 21M | GET | `/api/plant/shipper-requests/:requestId/comparison-results` | Paginated row-level comparison results |
| 21N | POST | `/api/plant/shipper-requests/:requestId/bundle-plan/generate` | Generate bundle plan from approved vendor lines |
| 21O | GET | `/api/plant/projects/:leadId/bundle-plan` | Get latest non-cancelled bundle plan for project (legacy project route) |
| 21OA | GET | `/api/plant/projects/:projectId/load-planning` | **Primary FE endpoint**: unified load + truck planning snapshot |
| 21OB | PUT | `/api/plant/projects/:projectId/load-planning` | **Primary FE endpoint**: update bundle/truck notes + sequence |
| 21OC | GET | `/api/plant/projects/:projectId/load-planning/coverage` | **Primary FE endpoint**: coverage for bundle confirm gate |
| 21OD | POST | `/api/plant/projects/:projectId/load-planning/confirm-bundles` | **Primary FE endpoint**: confirm bundle plan |
| 21OE | POST | `/api/plant/projects/:projectId/load-planning/generate-truck-plan` | **Primary FE endpoint**: generate/regenerate truck plan |
| 21OF | GET | `/api/plant/projects/:projectId/load-planning/truck-plan` | **Primary FE endpoint**: truck plan detail + rows |
| 21OG | PUT | `/api/plant/projects/:projectId/load-planning/trucks/:packingListId` | **Primary FE endpoint**: edit one truck row |
| 21OH | POST | `/api/plant/projects/:projectId/load-planning/truck-plan/confirm` | **Primary FE endpoint**: confirm truck plan |
| 21P | GET | `/api/plant/bundle-plans/:bundlePlanId` | Legacy id-based: bundle plan detail with bundle summaries |
| 21Q | PUT | `/api/plant/bundle-plans/:bundlePlanId` | Legacy id-based: update bundle plan notes |
| 21R | GET | `/api/plant/bundle-plans/:bundlePlanId/coverage` | Legacy id-based: vendor-line assignment coverage |
| 21S | POST | `/api/plant/bundle-plans/:bundlePlanId/confirm` | Legacy id-based: confirm bundle plan |
| 21T | POST | `/api/plant/bundle-plans/:bundlePlanId/bundles` | Create manual/empty bundle |
| 21U | GET | `/api/plant/bundles/:bundleId` | Bundle detail + items (**public**) |
| 21V | PUT | `/api/plant/bundles/:bundleId` | Edit bundle items/stacking/metadata |
| 21W | DELETE | `/api/plant/bundles/:bundleId` | Delete editable unassigned bundle |
| 21X | POST | `/api/plant/bundle-plans/:bundlePlanId/packing-list-plan/generate` | Legacy id-based: generate packing list / truck load plan |
| 21Y | GET | `/api/plant/packing-list-plans/:packingListPlanId` | Legacy id-based: packing list plan detail + truck rows + bundles (**public**) |
| 21Z | POST | `/api/plant/packing-list-plans/:packingListPlanId/confirm` | Legacy id-based: confirm packing list plan |
| 21ZA | GET | `/api/plant/packing-lists/:packingListId` | Legacy id-based: single truck-wise packing list detail |
| 21ZB | PUT | `/api/plant/packing-lists/:packingListId` | Legacy id-based: edit truck assignment/layout/details |
| 21ZC | GET | `/api/plant/bundle-plans/:bundlePlanId/freight-autofill` | Legacy id-based: auto-fill fields for freight request form |
| 21ZD | POST | `/api/plant/deliveries` | Create freight request |
| 21ZE | GET | `/api/plant/deliveries/project/:leadId` | Freight request list for one project |
| 21ZEA | GET | `/api/plant/projects/:projectId/freight-autofill` | **Primary FE endpoint**: freight auto-fill by project |
| 21ZEB | POST | `/api/plant/projects/:projectId/freight/send-bids` | **Primary FE endpoint**: send bids for latest project delivery |
| 21ZEC | GET | `/api/plant/projects/:projectId/freight/bids` | **Primary FE endpoint**: freight bid detail by project |
| 21ZED | GET | `/api/plant/deliveries/freight/stats` | Freight loads stats (total/requested/pending/in-transit/delivered/spent) |
| 21ZEE | GET | `/api/plant/deliveries/freight` | Freight loads list with pagination/search/filter |
| 21ZEF | GET | `/api/plant/deliveries/awarded/stats` | Awarded loads stats |
| 21ZEG | GET | `/api/plant/deliveries/awarded` | Awarded loads list with carrier populated |
| 21ZEH | GET | `/api/plant/deliveries/calendar` | Delivery calendar grouped by delivery date |
| 21ZEI | GET | `/api/plant/deliveries/stats` | Delivery status counters |
| 21ZEJ | GET | `/api/plant/deliveries` | Delivery list with status/project/customer/carrier filters |
| 21ZEK2 | GET | `/api/plant/deliveries/:deliveryId/detail` | Full delivery detail card payload (project/customer/vendor/carrier/owner/history) |
| 21ZEK | PATCH | `/api/plant/deliveries/:deliveryId/status` | Update delivery status (`scheduled/confirmed/in_transit/delayed/delivered/cancelled`) |
| 21ZF | POST | `/api/plant/deliveries/:deliveryId/send-bids` | Legacy id-based: send bid requests to selected carriers |
| 21ZG | GET | `/api/plant/deliveries/:deliveryId/bids` | Legacy id-based: freight bid detail + stats + sorted bids |
| 21ZH | POST | `/api/plant/freight-bids/:bidId/select` | Award one freight bid and reject others |
| 21ZI | GET | `/api/public/freight-bids/:token` | Public freight bid link details |
| 21ZJ | POST | `/api/public/freight-bids/:token/submit` | Public carrier bid submit (deadline enforced) |
| 22 | GET | `/api/plant/vendors` | List vendors / shippers |
| 23 | POST | `/api/plant/vendors` | Add vendor / shipper |
| 24 | GET | `/api/plant/vendors/:vendorId` | Vendor detail + stats + order history |
| 25 | PUT | `/api/plant/vendors/:vendorId` | Update vendor |
| 26 | PATCH | `/api/plant/vendors/:vendorId/toggle-status` | Toggle active / inactive |
| 27 | GET | `/api/plant/carriers` | List freight carriers |
| 28 | POST | `/api/plant/carriers` | Add freight carrier |
| 29 | GET | `/api/plant/carriers/:carrierId` | Carrier detail + stats + freight history |
| 30 | PUT | `/api/plant/carriers/:carrierId` | Update carrier |
| 31 | PATCH | `/api/plant/carriers/:carrierId/toggle-status` | Toggle active / inactive |
| 32 | POST | `/api/smdt/upload` | Bulk SMDT Excel import (S3 URL) |
| 33 | GET | `/api/smdt` | List SMDT items (active cost version) |
| 34 | GET | `/api/smdt/:itemId` | Single SMDT item |
| 35 | POST | `/api/smdt` | Manually add SMDT item |
| 36 | PUT | `/api/smdt/:itemId` | Edit SMDT item |
| 37 | DELETE | `/api/smdt/:itemId` | Deactivate SMDT item |

> **SMDT paths** live at `/api/smdt/*` (not under `/api/plant`). Same routes for **`admin`** and **`plant`**.

---

## 1. `GET /api/plant/projects/stats`

Summary counts for the projects screen header / stat cards.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `startDate` | ISO 8601 date | No | Filter PO orders from this date |
| `endDate` | ISO 8601 date | No | Filter PO orders through end of this day |

### Example request

```http
GET /api/plant/projects/stats?startDate=2026-01-01&endDate=2026-05-31
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalProjects": 24,
    "activeProjects": 18,
    "pendingCustomerApproval": 4,
    "cancelledProjects": 2
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalProjects` | number | All assigned approved PO projects in range |
| `activeProjects` | number | Projects where `isTerminated === false` |
| `pendingCustomerApproval` | number | Projects with at least one drawing awaiting customer review |
| `cancelledProjects` | number | Projects where `isTerminated === true` |

### Errors

| HTTP | When |
|------|------|
| 401 | Missing or invalid token |
| 403 | User role is not `plant` |
| 422 | Invalid `startDate` / `endDate` format |

---

## 2. `GET /api/plant/projects`

Paginated list of assigned projects for the plant projects table.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `startDate` | ISO 8601 date | No | — | PO order date range (from) |
| `endDate` | ISO 8601 date | No | — | PO order date range (to) |
| `projectId` | MongoDB ObjectId | No | — | Filter by project (lead `_id`) |
| `customerId` | MongoDB ObjectId | No | — | Filter by customer |
| `buildingType` | string | No | — | Exact match on lead `buildingType` |
| `drawingStatus` | string | No | — | `all_approved` \| `pending` \| `rejected` \| `none` |
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |

Filters compose with **AND** logic.

### Example request

```http
GET /api/plant/projects?projectId=665a00000000000000000002&buildingType=Commercial&drawingStatus=pending&page=1&limit=20
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "665a00000000000000000002",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "location": "Texas, USA",
        "clientName": "John Smith",
        "customer": {
          "firstName": "John",
          "lastName": "Smith"
        },
        "buildingType": "Commercial",
        "numberOfBuildings": 3,
        "quoteValue": 125000,
        "drawingStatus": "pending",
        "bomStatus": "partial",
        "lifecycleStatus": "converted_to_po",
        "isTerminated": false,
        "createdAt": "2025-01-15T00:00:00.000Z"
      }
    ],
    "total": 24,
    "page": 1,
    "limit": 20
  }
}
```

### Project object fields

| Field | Type | UI usage |
|-------|------|----------|
| `_id` | string | Lead / project ID — use for detail navigation |
| `projectName` | string | Project name column |
| `jobId` | string | Job / project reference ID |
| `location` | string | Location column |
| `clientName` | string | Pre-formatted `"First Last"` for client column |
| `customer` | object | `{ firstName, lastName }` if you need separate fields |
| `buildingType` | string | Building type filter/display |
| `numberOfBuildings` | number | Buildings count column |
| `quoteValue` | number | Project value / quote amount |
| `drawingStatus` | string | Drawing workflow badge — see enum above |
| `bomStatus` | string | BOM workflow badge — see enum above |
| `lifecycleStatus` | string | Lead lifecycle stage (informational) |
| `isTerminated` | boolean | `true` = cancelled project |
| `createdAt` | ISO date | Sort / display created date |

### Pagination

| Field | Type | Notes |
|-------|------|-------|
| `total` | number | Total matching projects **after** all filters (including `drawingStatus`) |
| `page` | number | Current page |
| `limit` | number | Page size |

Use `total` and `limit` to compute total pages: `Math.ceil(total / limit)`.

### Errors

| HTTP | When |
|------|------|
| 401 | Missing or invalid token |
| 403 | User role is not `plant` |
| 422 | Invalid query param (bad date, invalid `projectId` / `customerId`, invalid `drawingStatus`) |

---

## 3. `GET /api/plant/projects/:leadId/detail`

Full project detail for the plant project screen.

| | |
|---|---|
| **Role** | `plant` |
| **Guard** | Approved `POOrder` with `assignedTo` = current user |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes — project / lead `_id` |

### Response `data` (summary)

| Block | Contents |
|-------|----------|
| `lead` | Full lead document (lean) |
| `projectName`, `jobId`, `buildingType`, `quoteValue`, `location`, `createdAt` | Top-level mirrors for UI |
| `lifecycleStatus` | Current stage |
| `lifecycleHistory` | Array with `stage`, `changedAt`, populated `changedBy` |
| `client` | `customerId`, `firstName`, `lastName`, `email`, `phone`, `address` |
| `assignedSales` | `{ _id, name, email, role }` |
| `agreement` | Contract doc `{ url, fileName, uploadedAt }` or `null` |
| `poOrder` | `{ _id, poNumber, status, createdAt }` |
| `leadNotes` | Same shape as sales/admin lead notes |
| `activityLog` | Audit entries with `displayMessage` (newest first, max 200) |

Tab data (invoices, drawings, BOM, delivery, shipper) use the dedicated endpoints below — not embedded in detail.

### Errors

| HTTP | When |
|------|---------|
| 403 | PO not assigned to you |
| 404 | Project not found |

---

## 4. `PUT /api/plant/projects/:leadId/lifecycle`

Update plant pipeline stage (forward-only within plant stages).

### Request body

```json
{
  "lifecycleStatus": "fabrication_started",
  "note": "Optional note (also creates a lead note)"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `lifecycleStatus` | Yes | One of plant lifecycle enum values |
| `note` | No | Appended to `leadNotes` + audit |

### Response `data`

```json
{
  "leadId": "...",
  "lifecycleStatus": "fabrication_started",
  "lifecycleHistory": []
}
```

---

## 5. `GET /api/plant/projects/:leadId/notes`

### Response `data`

```json
{
  "leadId": "...",
  "projectName": "Warehouse A",
  "jobId": "PRO-042",
  "notes": [{ "_id": "...", "note": "...", "addedAt": "...", "addedBy": {} }],
  "total": 1
}
```

---

## 6. `POST /api/plant/projects/:leadId/notes`

### Request body

```json
{ "note": "Waiting on vendor shipper file." }
```

### Response `data`

```json
{ "note": { "_id": "...", "note": "...", "addedAt": "...", "addedBy": {} } }
```

---

## 7. `GET /api/plant/projects/:leadId/invoices`

### Response `data`

```json
{
  "invoices": [
    {
      "_id": "...",
      "invoiceNumber": "INV-0001",
      "dueDate": "2026-06-26T00:00:00.000Z",
      "amount": 1917952,
      "status": "sent"
    }
  ]
}
```

---

## 8. `GET /api/plant/projects/:leadId/buildings`

Lightweight building list for **drawing + BOM upload screens**. Drawing history tab: [§10](#10-get-apiplantprojectsleadiddrawings).

| | |
|---|---|
| **Role** | `plant` |
| **Guard** | Approved `POOrder` with `assignedTo` = current user |

### Example request

```http
GET /api/plant/projects/665a00000000000000000002/buildings
Authorization: Bearer <access_token>
```

### Response `data`

```json
{
  "leadId": "665a00000000000000000002",
  "projectName": "ABC Warehouse",
  "numberOfBuildings": 3,
  "buildings": [
    {
      "buildingId": "665a00000000000000000011",
      "buildingNumber": 1,
      "status": "drawing_rejected",
      "latestDrawing": {
        "versionNumber": 2,
        "fileName": "building1-v2.pdf",
        "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid.pdf",
        "status": "rejected",
        "uploadedAt": "2026-05-20T10:00:00.000Z",
        "reviewedAt": "2026-05-21T08:00:00.000Z",
        "rejectionReason": "Column heights don't match spec"
      },
      "latestDrawingStatus": "rejected",
      "drawingCount": 2,
      "hasDrawing": true,
      "latestBomJob": {
        "bomJobId": "...",
        "status": "completed",
        "fileName": "bom-b1.ods",
        "fileUrl": "https://...",
        "totalItems": 320,
        "matchedItems": 285,
        "unmatchedItems": 35,
        "isConfirmed": false,
        "extractionMethod": "exceljs",
        "skippedSheets": [],
        "uploadedAt": "..."
      },
      "hasBomJob": true,
      "bomJobStatus": "completed"
    },
    {
      "buildingId": "665a00000000000000000012",
      "buildingNumber": 2,
      "status": "drawing_pending",
      "latestDrawing": null,
      "latestDrawingStatus": null,
      "drawingCount": 0,
      "hasDrawing": false
    }
  ]
}
```

| Field | Type | UI usage |
|-------|------|----------|
| `buildingId` | string | Send in upload request body |
| `buildingNumber` | number | Display label ("Building 1") |
| `status` | string | Building workflow badge — see enum above |
| `latestDrawing` | object \| null | Current file summary (highest `versionNumber`) |
| `latestDrawingStatus` | string \| null | `pending_review` \| `approved` \| `rejected` |
| `drawingCount` | number | Total versions uploaded |
| `hasDrawing` | boolean | `false` = never uploaded |
| `latestBomJob` | object \| null | Latest BOM extraction job for this building |
| `hasBomJob` | boolean | Whether a BOM file was ever uploaded |
| `bomJobStatus` | string \| null | `queued` \| `processing` \| `completed` \| `failed` |

**Prerequisite for BOM upload:** active SMDT cost version must exist ([§30](#30-post-apismdtupload)).

Buildings sorted by `buildingNumber` ascending.

### Errors

| HTTP | When |
|------|------|
| 403 | PO not assigned to you |
| 404 | Project not found |

---

## 9. `POST /api/plant/projects/:leadId/drawings`

Register one or more drawing URLs **after** S3 upload completes. Does not accept file bytes.

| | |
|---|---|
| **Role** | `plant` |
| **Guard** | Approved `POOrder` with `assignedTo` = current user |
| **HTTP status** | `201` on success |

### Frontend workflow (checklist)

1. `GET .../buildings` — load building rows and show upload slots.
2. For **each file** the user selects:
   - `POST /api/upload/presigned-url` with `folder: "drawings"`.
   - `PUT` file to `uploadUrl`.
   - Keep `fileUrl` from presigned response.
3. `POST .../drawings` with one object per building being updated (1 building = array length 1).
4. Refresh `GET .../buildings` and/or `GET .../drawings`.
5. Lifecycle (`drawings_received`, etc.) is **manual** via `PUT .../lifecycle` — not auto-set on upload.

### Request body

**Upload all buildings at once (3 buildings):**

```json
{
  "drawings": [
    {
      "buildingId": "665a00000000000000000011",
      "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid-b1.pdf",
      "fileName": "building1-v1.pdf"
    },
    {
      "buildingId": "665a00000000000000000012",
      "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid-b2.pdf",
      "fileName": "building2-v1.pdf"
    },
    {
      "buildingId": "665a00000000000000000013",
      "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid-b3.pdf",
      "fileName": "building3-v1.pdf"
    }
  ]
}
```

**Re-upload one building only (after rejection or correction):**

```json
{
  "drawings": [
    {
      "buildingId": "665a00000000000000000011",
      "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid-b1-v3.pdf",
      "fileName": "building1-v3.pdf"
    }
  ]
}
```

| Field | Required | Rules |
|-------|----------|--------|
| `drawings` | Yes | Array, min length **1** |
| `drawings[].buildingId` | Yes | MongoId; must belong to this project |
| `drawings[].fileUrl` | Yes | HTTPS URL from presigned-url `fileUrl` |
| `drawings[].fileName` | Yes | Display / download name |

**Validation rules**

- No duplicate `buildingId` in the same request.
- Unknown or wrong-project `buildingId` → entire request fails (**all-or-nothing**).
- Customer email / notification is **not** sent from this endpoint (customer panel handles review separately).

### Versioning

| Scenario | Server behavior |
|----------|-----------------|
| First upload for a building | Creates version **1**, status `pending_review` |
| Re-upload after customer rejected | Appends version **N+1**, status `pending_review` |
| Re-upload after approved | Appends new version, back to `pending_review` |
| Re-upload while still `pending_review` | **Allowed** — appends new version; customer reviews latest |
| Replace / delete old version | **Not supported** — append-only history |

Each success sets building `status` → `drawing_uploaded`.

### Response `data`

```json
{
  "leadId": "665a00000000000000000002",
  "uploaded": [
    {
      "buildingId": "665a00000000000000000011",
      "buildingNumber": 1,
      "drawing": {
        "versionNumber": 3,
        "fileUrl": "https://bucket.s3.region.amazonaws.com/drawings/uuid-b1-v3.pdf",
        "fileName": "building1-v3.pdf",
        "status": "pending_review",
        "uploadedAt": "2026-05-28T12:00:00.000Z",
        "uploadedBy": "665a00000000000000000001"
      },
      "buildingStatus": "drawing_uploaded"
    }
  ],
  "projectDrawingStatus": "pending"
}
```

| Field | Type | Notes |
|-------|------|--------|
| `uploaded` | array | One entry per item in request |
| `uploaded[].drawing.versionNumber` | number | New version number assigned |
| `projectDrawingStatus` | string | Project-level badge: `none` \| `pending` \| `rejected` \| `all_approved` (same as list filter) |

### Errors

| HTTP | When |
|------|------|
| 400 | Duplicate `buildingId`, or building not in this project |
| 403 | PO not assigned to you |
| 404 | Project not found |
| 422 | Missing/invalid body (`drawings` empty, bad MongoId, missing `fileUrl` / `fileName`) |

---

## 10. `GET /api/plant/projects/:leadId/drawings`

Full drawing **history** per building (Drawings tab). For upload UI state, prefer [§8](#8-get-apiplantprojectsleadidbuildings).

### Response `data`

```json
{
  "buildings": [
    {
      "buildingId": "...",
      "buildingNumber": 1,
      "drawings": [
        {
          "versionNumber": 1,
          "fileUrl": "https://...",
          "fileName": "b1-v1.pdf",
          "status": "pending_review",
          "uploadedAt": "...",
          "reviewedAt": null,
          "rejectionReason": ""
        }
      ],
      "latestDrawingStatus": "pending_review"
    }
  ]
}
```

---

## 11. `POST /api/plant/projects/:leadId/bom`

Register one or more BOM file URLs **after** S3 upload. Starts **async** extraction jobs (poll status — do not wait on this request).

| | |
|---|---|
| **Role** | `plant` |
| **Guard** | Approved `POOrder` with `assignedTo` = current user |
| **HTTP status** | `201` |

### Frontend workflow

1. `GET .../buildings` — show per-building BOM slots + current job status.
2. **Prerequisite:** active SMDT uploaded ([§30](#30-post-apismdtupload)).
3. For each file:
   - `POST /api/upload/presigned-url` with `folder: "bom"`.
   - `PUT` to S3.
4. `POST .../bom` with 1..N buildings.
5. Wait for job completion — either:
   - **Socket (preferred):** listen for `bom_extraction_complete` / `bom_extraction_failed` on `/admin` namespace ([Socket.io](#socketio-plant-panel)), or
   - **Poll:** `GET /api/plant/bom/job/:jobId/status` every ~2s until `completed` or `failed` (or batch [§14](#14-post-apiplantbomjobsstatus)).
6. Open pricing UI via [§15](#15-get-apiplantbomjobid).

### Request body

```json
{
  "bomFiles": [
    {
      "buildingId": "665a00000000000000000011",
      "fileUrl": "https://bucket.s3.region.amazonaws.com/bom/uuid-b1.ods",
      "fileName": "bom-building1.ods",
      "fileFormat": "ods"
    }
  ]
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `bomFiles` | Yes | Min 1; one entry per building in this request |
| `bomFiles[].buildingId` | Yes | Must belong to this project |
| `bomFiles[].fileUrl` | Yes | From presigned-url |
| `bomFiles[].fileName` | Yes | Used for format detection + display |
| `bomFiles[].fileFormat` | No | `ods` \| `xlsx` \| `xls` \| `out` \| `txt` — inferred from extension if omitted |

**Validation:** duplicate `buildingId` → 400; wrong building → 400 (all-or-nothing). **Re-upload** replaces previous job + items for that building.

**Extraction:** Spreadsheet uploads (`ods/xlsx/xls`) are parsed with SheetJS (`xlsx` package). If zero rows are extracted, **Claude fallback** runs automatically (requires `ANTHROPIC_API_KEY`). Fixed-width report files (`.out`, and `.txt` when it matches report format) are parsed by the server out-parser. Skipped sheets (no header row) are listed on the job as `skippedSheets`.

### Response `data`

```json
{
  "leadId": "...",
  "jobs": [
    {
      "buildingId": "...",
      "buildingNumber": 1,
      "bomJobId": "...",
      "status": "queued",
      "fileName": "bom-building1.ods"
    }
  ],
  "message": "BOM extraction started for 1 building(s). Poll job status until completed."
}
```

### Side effects

| Trigger | Audit action | Socket event |
|---------|--------------|--------------|
| Upload registered | `bom.job_started` | — |
| Extraction completed | `bom.job_completed` | `bom_extraction_complete` → `user:{uploadedBy}` |
| Extraction failed | `bom.job_failed` | `bom_extraction_failed` → `user:{uploadedBy}` |

---

## 12. `GET /api/plant/projects/:leadId/bom-files`

Latest BOM job per building (BOM tab).

### Response `data`

```json
{
  "bomFiles": [
    {
      "buildingId": "...",
      "buildingNumber": 1,
      "bomJobId": "...",
      "fileName": "bom-b1.ods",
      "fileUrl": "https://...",
      "fileFormat": "ods",
      "status": "completed",
      "uploadedAt": "...",
      "totalItems": 320,
      "matchedItems": 285,
      "unmatchedItems": 35,
      "frameItems": 8,
      "isConfirmed": false,
      "extractionMethod": "exceljs",
      "skippedSheets": [{ "name": "Notes", "reason": "Header row not found" }],
      "errorMessage": null
    }
  ]
}
```

---

## 13. `GET /api/plant/bom/job/:jobId/status`

Poll while `status` is `queued` or `processing`.

### Response `data`

```json
{
  "jobId": "...",
  "status": "completed",
  "buildingId": "...",
  "buildingNumber": 1,
  "fileName": "bom-b1.ods",
  "totalSheets": 29,
  "totalItems": 320,
  "matchedItems": 285,
  "unmatchedItems": 27,
  "frameItems": 8,
  "skippedRows": 12,
  "skippedSheets": [],
  "extractionMethod": "exceljs",
  "isConfirmed": false,
  "errorMessage": null,
  "processingStartedAt": "...",
  "processingEndedAt": "..."
}
```

---

## 14. `POST /api/plant/bom/jobs/status`

Batch poll after bulk upload.

### Request body

```json
{ "jobIds": ["...", "..."] }
```

### Response `data`

```json
{
  "jobs": [
    { "jobId": "...", "status": "completed", "buildingNumber": 1, "totalItems": 320, "matchedItems": 285, "unmatchedItems": 27 }
  ]
}
```

---

## 14A. `GET /api/plant/bom/stats`

BOM summary counters for BOM dashboard cards.

### Response `data`

```json
{
  "totalBomFilesUploaded": 12,
  "pendingUploads": 3,
  "readyForShipper": 4,
  "issuesDetected": 1
}
```

| Field | Meaning |
|-------|---------|
| `totalBomFilesUploaded` | Count of latest BOM uploads (latest job per building) across assigned projects |
| `pendingUploads` | Assigned buildings with no BOM upload yet |
| `readyForShipper` | Projects with consolidated BOM generated (`ConsolidatedBOM.fileUrl` present) |
| `issuesDetected` | Latest BOM jobs with `failed` status |

---

## 14B. `GET /api/plant/bom/projects`

List latest BOM row per building for assigned projects.

### Query params

| Param | Type | Default |
|-------|------|---------|
| `page` | integer | `1` |
| `limit` | integer (max 200) | `20` |

### Response `data`

```json
{
  "projects": [
    {
      "leadId": "...",
      "projectId": "PRO-001",
      "projectName": "ABC Warehouse",
      "buildingId": "...",
      "buildingNumber": 1,
      "uploadDate": "2026-06-03T05:20:00.000Z",
      "itemCount": 320,
      "fileStatus": "extracted",
      "bomJobId": "..."
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

`fileStatus` mapping:
- `uploaded` → job status `queued`
- `extracting` → job status `processing`
- `extracted` → job status `completed`
- `failed` → job status `failed`

---

## 15. `GET /api/plant/bom/:jobId`

BOM line items for pricing/review.

**Query:** `filter=all|unpriced|frames|matched|bom_priced`, `page`, `limit` (default 50, max 200)

### Response `data` (summary)

| Block | Contents |
|-------|----------|
| `bomJob` | Job metadata + counts |
| `itemsByCategory` | Paginated items grouped by sheet/category |
| `summary` | `totalItems`, `pricedItems`, `unpricedItems`, `bomPricedItems`, `frameItems`, `totalWeight`, `totalCost`, `isFullyPriced` |

---

## 16. `PUT /api/plant/bom/items/:bomItemId/price`

Manual price for unmatched/frame lines.

### Request body

```json
{ "manualUnitCost": 1.68, "saveToSMDT": true }
```

| Field | Notes |
|-------|--------|
| `manualUnitCost` | Required number |
| `saveToSMDT` | Optional — upserts price into active SMDT version when `true` |

Cost formulas: `EA` = qty × unit; `FT` = qty × lengthFeet × unit; `LB` = weight × unit.

---

## 17. `POST /api/plant/bom/buildings/:buildingId/confirm`

Confirm building BOM when **every** line item is priced.

**400** if any unpriced items — returns `errors.unpricedMarkIds`.

### Response `data` (200)

```json
{
  "buildingId": "...",
  "buildingNumber": 1,
  "isConfirmed": true,
  "totalCost": 4520.75
}
```

Sets building `status` → `bom_confirmed`. **Audit:** `bom.confirmed`

---

## 18. `POST /api/plant/projects/:leadId/consolidated-bom/generate`

Merge all confirmed building BOMs into one consolidated Excel + grouped item list. Re-generating replaces the previous consolidated BOM and resets status to `draft`.

| | |
|---|---|
| **Role** | `plant` |
| **Guard** | Approved PO assigned to current user |
| **HTTP status** | `200` |

### Prerequisites

Every building on the project must have a **completed + confirmed** BOM job (`BOMJob.isConfirmed = true`).

### Request body

None.

### Response `data`

```json
{
  "consolidatedBOM": {
    "_id": "...",
    "status": "draft",
    "fileUrl": "https://bucket.s3.region.amazonaws.com/consolidated/.../uuid.xlsx",
    "totalCost": 87450.25,
    "totalWeight": 36280.4,
    "totalPanelsArea": 12450.75,
    "itemCount": 48,
    "lineItemCount": 320
  }
}
```

`itemCount` = grouped part lines (by partCode + partColor), `lineItemCount` = raw priced BOM rows used in consolidation.
`totalPanelsArea` = sum of grouped `totalLengthFeet` for categories containing `panel`/`sheet` (sq ft approximation based on available BOM data).

### Errors

| Status | When |
|--------|------|
| `400` | No buildings, unconfirmed buildings (`errors.unconfirmedBuildings`), or no priced items |
| `503` | S3 not configured |

**Audit:** `consolidated_bom.generated`

---

## 19. `GET /api/plant/projects/:leadId/consolidated-bom`

View the consolidated BOM for the project (grouped items + vendor send history).

### Response `data`

```json
{
  "consolidatedBOM": {
    "_id": "...",
    "leadId": "...",
    "status": "draft",
    "fileUrl": "https://...",
    "totalCost": 87450.25,
    "totalWeight": 36280.4,
    "totalPanelsArea": 12450.75,
    "itemCount": 48,
    "items": [
      {
        "_id": "...",
        "partCode": "C62514",
        "partColor": "RO",
        "description": "CEE Stud",
        "category": "Panels",
        "costUnit": "FT",
        "totalQty": 45,
        "totalLengthFeet": 320.5,
        "totalWeight": 892.3,
        "totalCost": 795.64,
        "buildings": [1, 2],
        "markIds": ["S6-1", "S6-3"]
      }
    ],
    "sentToVendors": [],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**404** if not generated yet.

---

## 19B. `GET /api/plant/bom/projects/:leadId/consolidated-url`

Quick readiness endpoint for consolidated BOM URL by project.

### Response `data`

```json
{
  "leadId": "...",
  "isReady": true,
  "consolidatedBOMId": "...",
  "status": "draft",
  "fileUrl": "https://bucket.s3.../consolidated/...xlsx",
  "updatedAt": "2026-06-03T05:40:00.000Z"
}
```

If not ready:

```json
{
  "leadId": "...",
  "isReady": false,
  "consolidatedBOMId": null,
  "status": null,
  "fileUrl": null,
  "updatedAt": null
}
```

---

## 19A. `POST /api/plant/projects/:leadId/consolidated-bom/send`

Send consolidated BOM to one or more selected vendors/shippers.

| | |
|---|---|
| **Role** | `plant` |
| **Guard** | Approved PO assigned to current user |
| **HTTP status** | `200` |

### Request body

```json
{
  "vendorIds": ["665a00000000000000000010", "665a00000000000000000011"]
}
```

### Logic

1. Validates consolidated BOM exists for this lead.
2. Creates (or reuses) a `ShipperRequest` per vendor.
3. **Token policy:** existing token is reused (old links remain valid for same lead-vendor pair).
4. Emails each vendor with:
   - consolidated BOM file URL
   - public upload link: `{CLIENT_URL}/vendor-upload/{token}`
5. Marks consolidated BOM status `sent_to_vendor`.

### Response `data`

```json
{
  "message": "Sent to 2 vendor(s).",
  "shipperRequests": [
    {
      "_id": "...",
      "vendorId": "...",
      "vendorName": "ABC Steel",
      "status": "sent",
      "isNewRequest": false,
      "tokenReused": true
    }
  ],
  "failures": []
}
```

### Side effects

- Audit: `consolidated_bom.sent`
- Inserts/updates `ShipperRequest` rows.
- Updates `ConsolidatedBOM.sentToVendors`.

---

## Socket.io (plant panel)

Plant users connect to the **`/admin`** Socket.io namespace (same as admin/sales internal panels). JWT access token is required in the handshake — on connect the server auto-joins `user:{currentUserId}`.

### Connect

```javascript
import { io } from 'socket.io-client'

const socket = io('http://localhost:5000/admin', {
  auth: { token: accessToken },
})

socket.on('connect', () => {
  // Ready — personal room user:{userId} is joined automatically
})
```

Production: replace host with your API origin (same host as REST API).

### Events to listen for

| Event | Room | When | Payload |
|-------|------|------|---------|
| `project_assigned` | `user:{plantUserId}` | Admin assigns PO to plant user | See below |
| `bom_extraction_complete` | `user:{uploadedBy}` | BOM async job finished OK | See below |
| `bom_extraction_failed` | `user:{uploadedBy}` | BOM async job failed | See below |
| `shipper_file_submitted` | `user:{plantUserId}` | Vendor submits quote file for one request | See below |
| `all_shipper_files_submitted` | `user:{plantUserId}` | All requested vendors have submitted | See below |
| `shipper_comparison_complete` | `user:{triggeredBy}` | Comparison job completed | See below |
| `shipper_comparison_failed` | `user:{triggeredBy}` | Comparison job failed | See below |

**Payload examples**

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
```

### Example — BOM upload screen

```javascript
socket.on('bom_extraction_complete', (data) => {
  // data.jobId — refresh job status / open pricing for this building
})

socket.on('bom_extraction_failed', (data) => {
  // data.error — show failure toast; job row status is already "failed" in DB
})

socket.on('shipper_file_submitted', (data) => {
  // refresh shipper row for data.requestId / data.vendorId
})

socket.on('all_shipper_files_submitted', (data) => {
  // show "all vendor quotes submitted" alert on plant dashboard
})

socket.on('shipper_comparison_complete', (data) => {
  // data: { jobId, requestId, leadId, vendorId, summary }
  // refresh comparison-summary + enable approve if blockers empty
})

socket.on('shipper_comparison_failed', (data) => {
  // data: { jobId, requestId, leadId, vendorId, error }
})
```

Polling ([§13](#13-get-apiplantbomjobjobidstatus), [§14](#14-post-apiplantbomjobsstatus), [§21H](#21h-get-apiplantshipper-requestscompare-jobsjobidstatus)) remains a valid fallback when the socket is disconnected.

---

## 20. `GET /api/plant/projects/:leadId/delivery`

Returns the **latest confirmed delivery** for the project — i.e. a freight request with an awarded carrier (`selectedCarrierBidId` set, status not `draft`/`cancelled`).

Use **`GET /api/plant/deliveries/project/:leadId` (§21ZE)** for the freight request **list** view.

### Response `404`

When no delivery has been awarded yet (still draft, bidding, or cancelled only).

### Response `data`

Same shape as §21ZEK2, plus explicit `formDetails`, `shipperDetails`, and `selectedBid`:

```json
{
  "delivery": {
    "deliveryId": "...",
    "deliveryNumber": "DEL-0012",
    "status": "carrier_selected",
    "statusHistory": [
      { "status": "draft", "changedAt": "2026-06-10T09:10:00.000Z" },
      { "status": "bidding_sent", "changedAt": "2026-06-10T11:05:00.000Z" },
      { "status": "carrier_selected", "changedAt": "2026-06-11T08:30:00.000Z" }
    ],
    "project": {
      "leadId": "...",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-019"
    },
    "customer": {
      "customerId": "...",
      "customerName": "John Doe"
    },
    "formDetails": {
      "description": "",
      "loadDescription": "18 bundle shipment",
      "loadWeight": 62400,
      "dimensions": { "lengthFeet": 53, "widthFeet": 8.5, "heightFeet": 13.5 },
      "materialType": "framing, panels, trim",
      "packageCount": 2,
      "loadingEquipment": ["forklift", "crane"],
      "bidDeadline": "2026-06-10T18:00:00.000Z",
      "documentUrl": "https://...",
      "pickupLocation": "Plant Yard, Houston",
      "pickupLocationData": { "address": "Plant Yard, Houston", "coordinates": { "lat": 29.76, "lng": -95.36 } },
      "deliveryLocation": "ABC Site, Austin",
      "deliveryLocationData": { "address": "ABC Site, Austin", "coordinates": { "lat": 30.27, "lng": -97.74 } },
      "pickupDate": "2026-06-12T00:00:00.000Z",
      "pickupTime": "08:00",
      "deliveryDate": "2026-06-13T00:00:00.000Z",
      "deliveryTime": "14:00",
      "timings": "Mon-Fri 8AM-6PM",
      "receivingPoc": "John Doe",
      "pickupContactPhone": "+1-555-222-3344",
      "specialRequirements": "Gate code required",
      "additionalNotes": "Call 30 mins before arrival"
    },
    "shipperDetails": {
      "vendorId": "...",
      "vendorName": "Metro Steel",
      "personName": "Mike Johnson",
      "number": "5551234567",
      "email": "mike@metrosteel.com"
    },
    "deliveryCompanyDetails": {
      "carrierId": "...",
      "carrierName": "FastLine Logistics",
      "personName": "Alex King",
      "number": "5553219876",
      "email": "ops@fastline.com"
    },
    "selectedBid": {
      "bidId": "...",
      "carrierId": "...",
      "carrierName": "FastLine Logistics",
      "quotedAmount": 2300,
      "currency": "USD",
      "carrierNotes": "Rate valid for 24h",
      "submittedAt": "2026-06-09T11:20:00.000Z",
      "selectedAt": "2026-06-11T08:30:00.000Z",
      "status": "selected"
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
    "internalOwner": {
      "userId": "...",
      "name": "Plant Owner",
      "email": "plant@flyweis.com",
      "phone": "5551112222"
    },
    "siteCoordinationNotes": "Call 30 mins before arrival",
    "equipmentRequirement": ["forklift", "crane"],
    "deliveryTypeAndSize": {
      "bundleCount": 18,
      "packageCount": 2,
      "totalWeight": 62400
    },
    "receivingPocDetails": {
      "receivingPoc": "John Doe",
      "pickupContactPhone": "+1-555-222-3344"
    }
  }
}
```

---

## 21. `GET /api/plant/projects/:leadId/shipper-files`

Vendor shipper submissions for the project.

### Response `data`

```json
{
  "shipperFiles": [
    {
      "_id": "...",
      "vendorId": "...",
      "vendorName": "ABC Steel",
      "status": "submitted",
      "submittedFileUrl": "https://...",
      "submittedFileName": "shipper.xlsx",
      "submittedAt": "...",
      "quoteValue": 50000,
      "sentAt": "..."
    }
  ]
}
```

---

## 21A. `GET /api/public/vendor-upload/:token`

Public endpoint for vendor upload page bootstrap.

### Response `data`

```json
{
  "requestId": "...",
  "status": "sent",
  "vendorName": "ABC Steel",
  "projectName": "ABC Warehouse",
  "jobId": "PRO-001",
  "consolidatedBOMFileUrl": "https://...",
  "submittedFileUrl": null,
  "submittedFileName": "",
  "submittedAt": null,
  "quoteValue": null
}
```

---

## 21B. `POST /api/public/vendor-upload/:token/presigned-url`

Get presigned S3 URL for vendor quote file upload.

### Request body

```json
{
  "fileName": "ABC-Quote.pdf",
  "fileType": "application/pdf",
  "folder": "vendor-uploads"
}
```

### Response `data`

```json
{
  "uploadUrl": "https://...",
  "fileUrl": "https://bucket.s3.region.amazonaws.com/vendor-uploads/...pdf",
  "key": "vendor-uploads/...pdf"
}
```

---

## 21C. `POST /api/public/vendor-upload/:token`

Submit uploaded quote file URL + quote amount.

### Request body

```json
{
  "submittedFileUrl": "https://bucket.s3.region.amazonaws.com/vendor-uploads/...pdf",
  "submittedFileName": "ABC-Quote.pdf",
  "quoteValue": 2100
}
```

### Response `data`

```json
{
  "requestId": "...",
  "status": "submitted",
  "vendorName": "ABC Steel",
  "projectName": "ABC Warehouse",
  "jobId": "PRO-001",
  "consolidatedBOMFileUrl": "https://...",
  "submittedFileUrl": "https://...",
  "submittedFileName": "ABC-Quote.pdf",
  "submittedAt": "...",
  "quoteValue": 2100,
  "allVendorsSubmitted": true
}
```

### Completion logic (Option A)

`allVendorsSubmitted` is computed against **`ConsolidatedBOM.sentToVendors`** (source-of-truth for requested vendors), not against all historical shipper requests on the lead.

### Side effects

- Audit:
  - `shipper.file_submitted` on each submission
  - `shipper.all_submitted` when all requested vendors have submitted
- Socket:
  - `shipper_file_submitted`
  - `all_shipper_files_submitted` (when all complete)
- Consolidated BOM status auto-updates to `vendor_submitted` once all required vendors submit.

---

## 21D. `GET /api/plant/shipper-files/projects`

Project list for shipper module. Returns only projects where at least one shipper request exists for leads assigned to the current plant user.

### Response `data`

```json
{
  "projects": [
    {
      "leadId": "...",
      "projectId": "PRO-001",
      "jobId": "PRO-001",
      "projectName": "ABC Warehouse",
      "totalShipperFiles": 3,
      "receivedShipperFiles": 2,
      "fileReceivedStatus": "partial",
      "latestSubmittedAt": "2026-06-03T04:50:00.000Z"
    }
  ],
  "total": 1
}
```

`fileReceivedStatus`: `none | partial | all`

---

## 21E. `GET /api/plant/shipper-files/projects/:leadId/requests`

Project-wise shipper request rows (table view).

### Response `data`

```json
{
  "leadId": "...",
  "projectId": "PRO-001",
  "projectName": "ABC Warehouse",
  "shipperRequests": [
    {
      "requestId": "...",
      "vendorId": "...",
      "vendorName": "ABC Steel",
      "vendorCode": "VND-0001",
      "fileName": "ABC-Quote.pdf",
      "uploadedDate": "2026-06-03T04:50:00.000Z",
      "rates": 2100,
      "fileStatus": "submitted"
    }
  ],
  "total": 1
}
```

---

## 21F. `GET /api/plant/shipper-requests/:requestId/document`

Single shipper document payload for preview/download screen.

### Response `data`

```json
{
  "requestId": "...",
  "leadId": "...",
  "projectId": "PRO-001",
  "projectName": "ABC Warehouse",
  "vendorId": "...",
  "vendorName": "ABC Steel",
  "vendorCode": "VND-0001",
  "fileName": "ABC-Quote.pdf",
  "fileUrl": "https://bucket.s3.../vendor-uploads/...pdf",
  "uploadedDate": "2026-06-03T04:50:00.000Z",
  "rates": 2100,
  "fileStatus": "submitted"
}
```

---

## 21G. `POST /api/plant/shipper-requests/:requestId/compare`

Start async comparison between `ConsolidatedBOM.items` and vendor-submitted quote file.

### Request body

None.

### Response `data`

```json
{
  "requestId": "...",
  "compareJobId": "...",
  "status": "queued",
  "message": "Comparison started. Poll compare job status until completed."
}
```

### Processing behavior

- Job runs in background (no waiting in this API).
- If another queued/processing job already exists for same request, existing job id is returned.
- Comparison stores:
  - extracted vendor lines (`VendorQuoteLine`)
  - row-level result rows (`QuoteComparisonResult`)
  - summary + exceptions on `ShipperRequest`

### Internal status updates on `ShipperRequest`

- Start: `status = comparison_processing`, `comparisonStatus = processing`
- Success: `status = comparison_completed`, `comparisonStatus = completed`
- Failure: `status = comparison_failed`, `comparisonStatus = failed`, `comparisonError`

---

## 21H. `GET /api/plant/shipper-requests/compare-jobs/:jobId/status`

Poll a single comparison job.

### Response `data`

```json
{
  "compareJobId": "...",
  "requestId": "...",
  "leadId": "...",
  "vendorId": "...",
  "status": "completed",
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
  },
  "resultCount": 7,
  "errorMessage": null,
  "processingStartedAt": "...",
  "processingEndedAt": "..."
}
```

---

## 21I. `POST /api/plant/shipper-requests/compare-jobs/status`

Batch poll comparison jobs.

### Request body

```json
{ "jobIds": ["...", "..."] }
```

### Response `data`

```json
{
  "jobs": [
    {
      "compareJobId": "...",
      "requestId": "...",
      "status": "completed",
      "resultCount": 7,
      "errorMessage": null,
      "processingEndedAt": "..."
    }
  ]
}
```

---

## 21J. `POST /api/plant/shipper-requests/:requestId/approve`

Approve one shipper request for the project and auto-reject other vendor requests for the same consolidated BOM.

### Request body

None.

### Response `data`

```json
{
  "requestId": "...",
  "status": "approved",
  "reviewedAt": "2026-06-04T04:45:00.000Z",
  "approvedVendor": {
    "vendorId": "...",
    "vendorName": "ABC Steel"
  },
  "rejectedRequests": [
    {
      "requestId": "...",
      "vendorId": "...",
      "vendorName": "XYZ Metals",
      "status": "rejected"
    }
  ],
  "emailFailures": []
}
```

### Behavior

- Validates plant access for the request lead.
- Sets selected request status to `approved`.
- Sets all sibling requests under same `leadId + consolidatedBOMId` to `rejected`.
- Updates `ConsolidatedBOM.status = approved`.
- Sends approval email to selected vendor and rejection email to non-selected vendors.
- Logs audit events:
  - `shipper.request_approved`
  - `shipper.request_rejected` (for each rejected vendor request)

---

## 21K. `POST /api/plant/shipper-requests/:requestId/request-resubmit`

Request corrected quote from a vendor using the same public upload token/link.

### Request body

```json
{ "note": "Please correct qty mismatch on C62514." }
```

### Response `data`

```json
{
  "requestId": "...",
  "status": "resubmit_requested",
  "reviewedAt": "2026-06-04T04:50:00.000Z",
  "uploadUrl": "https://<client>/vendor-upload/<same-token>",
  "emailFailures": []
}
```

### Behavior

- Validates plant access for the request lead.
- Sets request status to `resubmit_requested`.
- Saves `manualReviewNote` with provided note.
- Sends vendor email with note and same upload link (`token` unchanged).
- Logs audit event `shipper.resubmit_requested`.
- Public vendor upload remains valid for statuses `sent`, `resubmit_requested`, and `submitted`.

---

## 21L. `GET /api/plant/shipper-requests/:requestId/comparison-summary`

Returns comparison status, aggregate summary, part-level comparison rows, and approval gate signal for frontend flow.

### Response `data`

```json
{
  "requestId": "...",
  "leadId": "...",
  "projectId": "PRO-001",
  "projectName": "ABC Warehouse",
  "vendorId": "...",
  "vendorName": "ABC Steel",
  "vendorCode": "VND-0001",
  "status": "comparison_completed",
  "comparisonStatus": "completed",
  "comparisonRanAt": "2026-06-04T05:10:00.000Z",
  "comparisonError": null,
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
  },
  "exceptionsCount": 4,
  "resultCount": 6,
  "results": [
    {
      "resultId": "...",
      "status": "missing_in_vendor_quote",
      "severity": "critical",
      "expected": {
        "partCode": "C62514",
        "partColor": "RO",
        "qty": 25,
        "lengthFeet": 6.9792,
        "weight": 621,
        "unitCost": 1.28
      },
      "received": null,
      "difference": {
        "qtyDiff": null,
        "lengthDiff": null,
        "weightDiff": null,
        "unitPriceDiff": null,
        "amountDiff": null
      },
      "matchMethod": "none",
      "matchConfidence": null,
      "reason": "Missing in vendor quote",
      "createdAt": "2026-06-04T05:10:01.000Z"
    }
  ],
  "canProceedToApproval": false,
  "blockers": ["missing_items", "qty_mismatch"]
}
```

### `canProceedToApproval` logic

`true` only when:

- `comparisonStatus = completed`
- and no blockers:
  - `missing_items`
  - `qty_mismatch`
  - `length_mismatch`
  - `weight_mismatch`
  - `ambiguous_match`

If comparison has not run yet, blockers includes `comparison_not_run`.

---

## 21M. `GET /api/plant/shipper-requests/:requestId/comparison-results`

Returns paginated row-level mismatch/match rows from `QuoteComparisonResult`.

### Query params

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |
| `status` | string | No | — | Filter by result status |
| `severity` | string | No | — | `low` \| `medium` \| `high` \| `critical` |

### Response `data`

```json
{
  "requestId": "...",
  "leadId": "...",
  "projectId": "PRO-001",
  "projectName": "ABC Warehouse",
  "vendorId": "...",
  "vendorName": "ABC Steel",
  "vendorCode": "VND-0001",
  "status": "comparison_completed",
  "comparisonStatus": "completed",
  "filters": { "status": "missing_in_vendor_quote", "severity": "critical" },
  "pagination": { "page": 1, "limit": 20, "total": 2, "pages": 1 },
  "results": [
    {
      "resultId": "...",
      "status": "missing_in_vendor_quote",
      "severity": "critical",
      "expected": {
        "partCode": "C62514",
        "partColor": "RO",
        "qty": 25,
        "lengthFeet": 6.9792,
        "weight": 621,
        "unitCost": 1.28
      },
      "received": null,
      "difference": {
        "qtyDiff": null,
        "lengthDiff": null,
        "weightDiff": null,
        "unitPriceDiff": null,
        "amountDiff": null
      },
      "matchMethod": "none",
      "matchConfidence": 0,
      "reason": "Expected item was not found in vendor quote",
      "createdAt": "2026-06-04T05:10:00.000Z"
    },
    {
      "resultId": "...",
      "status": "qty_mismatch",
      "severity": "critical",
      "expected": { "partCode": "PC16-RO", "qty": 28, "lengthFeet": 6.97 },
      "received": { "partCode": "PC16-RO", "qty": 24, "lengthFeet": 6.97, "unitPrice": 1.30 },
      "difference": { "qtyDiff": -4, "lengthDiff": 0, "weightDiff": -88, "unitPriceDiff": 0.02, "amountDiff": null },
      "matchMethod": "part_length_grouped",
      "matchConfidence": 0.9,
      "reason": "Vendor quantity does not match expected quantity",
      "createdAt": "2026-06-04T05:10:00.000Z"
    }
  ]
}
```

---

## 21N. `POST /api/plant/shipper-requests/:requestId/bundle-plan/generate`

Generate Bundle Plan rows from approved vendor quote lines.

### Preconditions

- `ShipperRequest.status = approved`
- `VendorQuoteLine` rows exist for this `shipperRequestId` (from comparison step)
- If existing bundle plan is already `confirmed`, generation is blocked
- If a non-cancelled `PackingListPlan` already exists for the bundle plan, regeneration is blocked

### Request body

None.

### Response `data` (201 on first generate, 200 on regenerate)

```json
{
  "bundlePlan": {
    "_id": "...",
    "planNumber": "BP-0001",
    "status": "generated",
    "totalSourceItems": 47,
    "totalBundles": 12,
    "totalWeight": 38400,
    "maxLengthFeet": 48,
    "missingWeightLineCount": 2,
    "hasWeightWarning": true,
    "warnings": [
      "2 vendor line(s) have missing/zero weight. Bundle weight and truck planning may be inaccurate."
    ]
  },
  "bundles": [
    {
      "_id": "...",
      "bundleNo": "B-001",
      "bundleType": "framing",
      "title": "FRAMING Bundle",
      "totalQty": 18,
      "totalWeight": 6200,
      "maxLengthFeet": 48,
      "itemCount": 6,
      "missingWeightItemCount": 0,
      "stacking": {
        "stackLevel": "bottom",
        "canStackOnTop": true,
        "canHaveItemsStackedOnIt": true,
        "isFragile": false,
        "mustStayFlat": false,
        "keepDry": false,
        "requiresEdgeProtection": false,
        "loadingPriority": 10,
        "unloadingPriority": 50
      },
      "loadSequence": null,
      "handlingInstruction": "",
      "warnings": [],
      "notes": ""
    }
  ]
}
```

### Behavior

- Validates plant access for request lead.
- Loads vendor lines from `VendorQuoteLine` (qty or pieceQty > 0).
- Runs deterministic bundling algorithm (`loadPlanning.service.generateBundlesFromVendorLines`).
- Creates `BundlePlan` + `Bundle` rows, or regenerates draft plan (deletes old bundles) when allowed.
- Saves stacking defaults, warnings, and per-bundle item snapshots.
- Logs audit event `bundle_plan.generated`.

### Errors

| HTTP | When |
|------|------|
| 400 | Request not approved, no vendor lines, no bundles generated, confirmed plan exists, or packing list plan blocks regen |
| 403 | Plant user not assigned to project PO |
| 404 | Shipper request not found |

---

## 21O. `GET /api/plant/projects/:leadId/bundle-plan`

Get latest non-cancelled bundle plan for project with bundle summary rows.

### Response `data`

```json
{
  "bundlePlan": {
    "_id": "...",
    "leadId": "...",
    "shipperRequestId": "...",
    "vendorId": "...",
    "planNumber": "BP-0001",
    "status": "generated",
    "totalSourceItems": 47,
    "totalBundles": 12,
    "totalWeight": 38400,
    "maxLengthFeet": 48,
    "warnings": [],
    "notes": "",
    "generatedBy": "...",
    "confirmedBy": null,
    "confirmedAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "bundles": [
    {
      "_id": "...",
      "bundleNo": "B-001",
      "bundleType": "framing",
      "title": "FRAMING Bundle",
      "totalQty": 18,
      "totalWeight": 6200,
      "maxLengthFeet": 48,
      "itemCount": 6,
      "warnings": [],
      "stacking": { "stackLevel": "bottom", "loadingPriority": 10, "unloadingPriority": 50 },
      "loadSequence": 1,
      "status": "draft"
    }
  ],
  "summary": {
    "totalBundles": 12,
    "totalWeight": 38400,
    "maxLengthFeet": 48,
    "warnings": []
  }
}
```

---

## 21P. `GET /api/plant/bundle-plans/:bundlePlanId`

Bundle plan detail by id (same structure as §21O, id-driven).

---

## 21OA. `GET /api/plant/projects/:projectId/load-planning`

**Primary frontend endpoint for load + truck planning state restore after refresh.**

`projectId` accepts:
- lead Mongo `_id` (example: `6a0b91cc8df24a04519ef306`)
- or project code `jobId` (example: `PRO-019`)

### Response `data`

```json
{
  "project": {
    "_id": "...",
    "projectId": "PRO-019",
    "projectName": "ABC Warehouse"
  },
  "bundlePlan": { "_id": "...", "status": "confirmed", "planNumber": "BP-0001" },
  "bundles": [{ "_id": "...", "bundleNo": "B-001", "status": "assigned_to_truck" }],
  "bundleSummary": { "totalBundles": 29, "totalWeight": 34216.45, "maxLengthFeet": 45, "warnings": [] },
  "packingListPlan": { "_id": "...", "status": "generated", "planNumber": "PLP-0001" },
  "packingLists": [{ "_id": "...", "packingListNo": "PL-001", "truckType": "SEMI_53", "status": "draft" }]
}
```

---

## 21OB. `PUT /api/plant/projects/:projectId/load-planning`

**Primary frontend endpoint for project-level edits** (without passing bundle-plan / truck-plan id as parent route param).

### Request body (all optional)

```json
{
  "bundlePlanNotes": "Reviewed by planner",
  "packingListPlanNotes": "Check loading order with site team",
  "bundleUpdates": [
    {
      "bundleId": "665a00000000000000000111",
      "loadSequence": 1,
      "notes": "Load first",
      "handlingInstruction": "Keep dry"
    }
  ],
  "packingListUpdates": [
    {
      "packingListId": "665a00000000000000000991",
      "notes": "Use forklift at dock 2",
      "loadingNotes": "Panels top layer only"
    }
  ]
}
```

### Response `data`

```json
{
  "bundlePlan": { "_id": "...", "notes": "Reviewed by planner" },
  "bundles": [{ "_id": "...", "bundleNo": "B-001", "loadSequence": 1 }],
  "packingListPlan": { "_id": "...", "notes": "Check loading order with site team" },
  "packingLists": [{ "_id": "...", "packingListNo": "PL-001" }]
}
```

---

## 21OC. `GET /api/plant/projects/:projectId/load-planning/coverage`

Project-id wrapper for coverage check (same response as §21R).

---

## 21OD. `POST /api/plant/projects/:projectId/load-planning/confirm-bundles`

Project-id wrapper for bundle confirm (same response as §21S).

---

## 21OE. `POST /api/plant/projects/:projectId/load-planning/generate-truck-plan`

Project-id wrapper for truck plan generate/regenerate (same response as §21X).

---

## 21OF. `GET /api/plant/projects/:projectId/load-planning/truck-plan`

Project-id wrapper for truck plan detail (same response as §21Y).

---

## 21OG. `PUT /api/plant/projects/:projectId/load-planning/trucks/:packingListId`

Project-id wrapper for truck row edit (same request/response behavior as §21ZB).

---

## 21OH. `POST /api/plant/projects/:projectId/load-planning/truck-plan/confirm`

Project-id wrapper for truck plan confirm (same response as §21Z).

---

## 21Q. `PUT /api/plant/bundle-plans/:bundlePlanId`

Update bundle plan metadata.

### Request body

```json
{ "notes": "Checked by plant manager." }
```

### Response `data`

```json
{
  "bundlePlan": {
    "_id": "...",
    "notes": "Checked by plant manager.",
    "updatedAt": "..."
  }
}
```

---

## 21R. `GET /api/plant/bundle-plans/:bundlePlanId/coverage`

Coverage validation before confirm. Compares vendor line qty vs assigned qty across all bundles.

### Response `data`

```json
{
  "rows": [
    {
      "vendorQuoteLineId": "...",
      "partCode": "PC16-RO-8X3.5",
      "description": "16Ga CEE Purlin Red Oxide",
      "expectedQty": 28,
      "assignedQty": 24,
      "diff": -4,
      "status": "unassigned"
    }
  ],
  "summary": {
    "totalVendorLines": 47,
    "exactCount": 45,
    "unassignedCount": 1,
    "overAssignedCount": 1,
    "canConfirm": false
  }
}
```

`status` in rows: `exact | unassigned | over_assigned`

---

## 21S. `POST /api/plant/bundle-plans/:bundlePlanId/confirm`

Confirm bundle plan only when every vendor line has exact assignment.

### Success response `data`

```json
{
  "bundlePlanId": "...",
  "status": "confirmed",
  "confirmedAt": "...",
  "summary": {
    "totalVendorLines": 47,
    "exactCount": 47,
    "unassignedCount": 0,
    "overAssignedCount": 0,
    "canConfirm": true
  }
}
```

### Validation failure

`400` with coverage summary when assignments are incomplete.

---

## 21T. `POST /api/plant/bundle-plans/:bundlePlanId/bundles`

Create manual/empty bundle (for manual regrouping).

### Request body

```json
{
  "bundleType": "custom",
  "title": "Manual split bundle",
  "notes": "Created for on-site sequence."
}
```

### Response `data`

```json
{
  "bundle": { "_id": "...", "bundleNo": "B-013", "bundleType": "custom", "title": "Manual split bundle" },
  "bundlePlanSummary": { "totalBundles": 13, "totalWeight": 38400, "maxLengthFeet": 48, "warnings": [] }
}
```

---

## 21U. `GET /api/plant/bundles/:bundleId`

Full bundle with all item rows.

Auth: **Public (no JWT required)**.

### Response `data`

```json
{
  "bundle": {
    "_id": "...",
    "bundlePlanId": "...",
    "bundleNo": "B-001",
    "bundleType": "framing",
    "title": "FRAMING Bundle",
    "totalQty": 18,
    "totalWeight": 6200,
    "maxLengthFeet": 48,
    "stacking": { "stackLevel": "bottom", "loadingPriority": 10 },
    "loadSequence": 1,
    "handlingInstruction": "",
    "warnings": [],
    "notes": ""
  },
  "items": [
    {
      "_id": "...",
      "vendorQuoteLineId": "...",
      "partCode": "PC16-RO",
      "description": "16Ga CEE",
      "qty": 4,
      "lengthFeet": 6.97,
      "weight": 89,
      "markIds": ["S6-1"],
      "sourceLineSnapshot": { "...": "..." }
    }
  ]
}
```

---

## 21V. `PUT /api/plant/bundles/:bundleId`

Edit bundle content and metadata.

### Editable fields

`items`, `bundleType`, `title`, `stacking`, `loadSequence`, `handlingInstruction`, `notes`

### Important behavior

- Recalculates bundle totals (`totalQty`, `totalWeight`, `maxLengthFeet`) and warnings.
- Recalculates bundle-plan summary (`totalBundles`, `totalWeight`, `maxLengthFeet`, `warnings`).
- Blocks edit when:
  - bundle plan already confirmed, or
  - non-cancelled packing-list plan exists.

### Response `data`

```json
{
  "bundle": { "_id": "...", "bundleNo": "B-001", "totalQty": 20, "totalWeight": 6400, "warnings": [] },
  "items": [{ "_id": "...", "vendorQuoteLineId": "...", "qty": 8 }],
  "bundlePlanSummary": { "totalBundles": 12, "totalWeight": 38600, "maxLengthFeet": 48, "warnings": [] }
}
```

---

## 21W. `DELETE /api/plant/bundles/:bundleId`

Delete a bundle (only if editable and not assigned to packing list).

### Response `data`

```json
{
  "deletedBundleId": "...",
  "bundlePlanSummary": { "totalBundles": 11, "totalWeight": 32200, "maxLengthFeet": 48, "warnings": [] }
}
```

---

## 21X. `POST /api/plant/bundle-plans/:bundlePlanId/packing-list-plan/generate`

Generate truck-wise packing list plan from confirmed bundles.

### Preconditions

- `BundlePlan.status = confirmed`
- confirmed bundle rows exist
- no confirmed packing-list plan already exists

### Response `data` (201 on first generate, 200 on regenerate)

```json
{
  "packingListPlan": {
    "_id": "...",
    "planNumber": "PLP-0001",
    "status": "generated",
    "totalPackingLists": 2,
    "totalBundles": 18,
    "totalWeight": 62400,
    "maxLengthFeet": 51,
    "truckSummary": { "semi53Count": 1, "hotshot40Count": 1, "totalTrucks": 2 },
    "missingWeightBundleCount": 1,
    "hasWeightWarning": true,
    "warnings": ["1 bundle(s) have missing/zero weight. Truck assignment and total load weight must be manually reviewed."]
  },
  "packingLists": [
    {
      "_id": "...",
      "packingListNo": "PL-001",
      "truckNo": "TRUCK-1",
      "truckType": "SEMI_53",
      "truckLabel": "53 ft Semi",
      "maxTruckWeight": 45000,
      "hardMaxTruckWeight": 48000,
      "maxTruckLengthFeet": 53,
      "totalWeight": 44200,
      "maxLengthFeet": 51,
      "totalBundles": 12,
      "totalItems": 68,
      "bundleIds": ["..."],
      "loadLayout": { "bottomLayerBundleIds": [], "middleLayerBundleIds": [], "topLayerBundleIds": [], "loadingNotes": "" },
      "hasWeightWarning": false,
      "warnings": [],
      "status": "draft"
    }
  ],
  "truckConfig": {
    "SEMI_53": { "truckType": "SEMI_53", "label": "53 ft Semi", "maxWeight": 45000, "hardMaxWeight": 48000, "maxLengthFeet": 53 },
    "HOTSHOT_40": { "truckType": "HOTSHOT_40", "label": "40 ft Hot Shot", "maxWeight": 18000, "hardMaxWeight": 18000, "maxLengthFeet": 40 }
  }
}
```

---

## 21Y. `GET /api/plant/packing-list-plans/:packingListPlanId`

Get generated packing-list plan + truck rows.

Auth: **Public (no JWT required)**.

### Response `data`

```json
{
  "packingListPlan": { "_id": "...", "status": "generated", "totalPackingLists": 2, "totalBundles": 18, "totalWeight": 62400 },
  "packingLists": [{ "_id": "...", "packingListNo": "PL-001", "truckType": "SEMI_53", "totalWeight": 44200 }],
  "bundles": [{ "_id": "...", "bundleNo": "B-001", "status": "assigned_to_truck", "packingListId": "...", "totalWeight": 6200 }],
  "summary": {
    "totalWeight": 62400,
    "totalBundles": 18,
    "totalPackingLists": 2,
    "truckSummary": { "semi53Count": 1, "hotshot40Count": 1, "totalTrucks": 2 },
    "warnings": []
  }
}
```

---

## 21Z. `POST /api/plant/packing-list-plans/:packingListPlanId/confirm`

Confirm packing-list plan with assignment and hard-limit validations.

### Validation before confirm

- each bundle in bundle plan assigned exactly once across packing lists
- each packing list has valid `truckType`
- no row exceeds hard weight/length limits

### Response `data`

```json
{
  "packingListPlanId": "...",
  "status": "confirmed",
  "confirmedAt": "...",
  "summary": {
    "totalWeight": 62400,
    "totalBundles": 18,
    "truckSummary": { "semi53Count": 1, "hotshot40Count": 1, "totalTrucks": 2 }
  }
}
```

---

## 21ZA. `GET /api/plant/packing-lists/:packingListId`

Get one truck-wise packing list with bundles and load layout.

### Response `data`

```json
{
  "packingList": { "_id": "...", "packingListNo": "PL-001", "truckType": "SEMI_53", "bundleIds": ["..."], "warnings": [] },
  "truckInfo": {
    "truckType": "SEMI_53",
    "truckLabel": "53 ft Semi",
    "totalWeight": 44200,
    "maxTruckWeight": 45000,
    "hardMaxTruckWeight": 48000,
    "maxTruckLengthFeet": 53
  },
  "bundles": [{ "_id": "...", "bundleNo": "B-001", "totalWeight": 6200 }],
  "loadLayout": { "bottomLayerBundleIds": [], "middleLayerBundleIds": [], "topLayerBundleIds": [], "loadingNotes": "" },
  "planStatus": "generated"
}
```

---

## 21ZB. `PUT /api/plant/packing-lists/:packingListId`

Edit truck-level assignment and layout.

### Editable fields

`truckType`, `bundleIds`, `loadLayout`, `loadingNotes`, `overrideReason`, `notes`

### Important behavior

- Recalculates row totals + warnings.
- Updates `Bundle.packingListId` assignments.
- Removes moved bundles from sibling packing lists.
- Recalculates parent packing-list-plan summary.
- Blocks edit if packing-list-plan already confirmed.

---

## 21ZC. `GET /api/plant/bundle-plans/:bundlePlanId/freight-autofill`

Returns only the FE auto-fill fields requested for freight request form.

### Response `data`

```json
{
  "loadDescription": "18 bundle(s) for bundle plan BP-0001",
  "weight": 62400,
  "dimensions": {
    "lengthFeet": 51,
    "widthFeet": 8.5,
    "heightFeet": 8
  },
  "metalType": "framing, panels, trim",
  "packageCount": 18
}
```

---

## 21ZEA. `GET /api/plant/projects/:projectId/freight-autofill`

**Primary frontend endpoint** for freight form auto-fill by project id.

Same response shape as §21ZC.

---

## 21ZD. `POST /api/plant/deliveries`

Create freight request (delivery) with editable freight fields.

### Request body (example)

```json
{
  "leadId": "665a00000000000000000001",
  "description": "Project outbound freight",
  "loadDescription": "18 bundle shipment",
  "weight": 62400,
  "dimensions": { "lengthFeet": 51, "widthFeet": 8.5, "heightFeet": 8 },
  "metalType": "framing, panels, trim",
  "packageCount": 18,
  "loadingEquipment": ["forklift", "crane"],
  "bidDeadline": "2026-06-10T18:00:00.000Z",
  "documentUrl": "https://bucket.s3.../freight/freight-sheet.pdf",
  "pickupLocation": "Plant Yard, Houston",
  "pickupLocationData": { "address": "Plant Yard, Houston", "coordinates": { "lat": 29.7604, "lng": -95.3698 } },
  "deliveryLocation": "ABC Site, Austin",
  "deliveryLocationData": { "address": "ABC Site, Austin", "coordinates": { "lat": 30.2672, "lng": -97.7431 } },
  "timings": "Mon-Fri 8AM-6PM",
  "pickupDate": "2026-06-12T00:00:00.000Z",
  "pickupTime": "09:00",
  "deliveryDate": "2026-06-13T00:00:00.000Z",
  "deliveryTime": "13:00",
  "receivingPoc": "John Doe",
  "pickupContactPhone": "+1-555-222-3344",
  "specialRequirements": "Do not stack top layer panels",
  "additionalNotes": "Call 30 mins before arrival"
}
```

### Response `data`

```json
{
  "delivery": {
    "_id": "...",
    "deliveryNumber": "DEL-0001",
    "leadId": "...",
    "status": "draft",
    "selectedCarrierBidId": null
  }
}
```

---

## 21ZE. `GET /api/plant/deliveries/project/:leadId`

Project freight request **list** (summary rows for table views).

For the single confirmed/awarded delivery card with full form + shipper + carrier + selected bid, use **`GET /api/plant/projects/:leadId/delivery` (§20)**.

### Response `data`

```json
{
  "requests": [
    {
      "requestId": "...",
      "projectName": "ABC Warehouse",
      "description": "18 bundle shipment",
      "pickupLocation": "Plant Yard, Houston",
      "deliveryLocation": "ABC Site, Austin",
      "pickupDate": "2026-06-12T00:00:00.000Z",
      "deliveryDate": "2026-06-13T00:00:00.000Z",
      "carrier": null,
      "averageBid": 2450,
      "status": "bidding_sent",
      "loadWeight": 62400
    }
  ],
  "total": 1
}
```

---

## 21ZEB. `POST /api/plant/projects/:projectId/freight/send-bids`

**Primary frontend endpoint** to send bid requests using project id.

Behavior:
- resolves latest project delivery internally
- applies same logic/response as §21ZF

### Request body

```json
{
  "carrierIds": ["665a0000000000000000c001", "665a0000000000000000c002"],
  "bidDeadline": "2026-06-10T18:00:00.000Z"
}
```

---

## 21ZEC. `GET /api/plant/projects/:projectId/freight/bids`

**Primary frontend endpoint** for freight bid detail by project id.

### Query params

| Param | Type | Default |
|---|---|---|
| `sort` | `low_to_high` \| `high_to_low` | `low_to_high` |

Same response shape as §21ZG.

---

## 21ZED. `GET /api/plant/deliveries/freight/stats`

Freight loads dashboard counters across all plant-assigned projects.

`draft` deliveries are excluded from this endpoint.

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

---

## 21ZEE. `GET /api/plant/deliveries/freight`

Freight loads list with pagination, global search, and filters.

By default this endpoint excludes `draft` deliveries (unsent loads).

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | number | `1` | Min `1` |
| `limit` | number | `20` | Min `1`, max `200` |
| `search` | string | — | Searches request/project/location/POC/equipment fields |
| `status` | string | — | Delivery status filter |
| `projectId` | string | — | Mongo lead `_id` |
| `customerId` | string | — | Mongo customer `_id` |
| `carrierId` | string | — | Mongo freight carrier `_id` (selected carrier) |
| `fromDate` | ISO date | — | Delivery date range start |
| `toDate` | ISO date | — | Delivery date range end |

### Response `data`

```json
{
  "requests": [
    {
      "_id": "66a100000000000000000301",
      "requestId": "66a100000000000000000301",
      "deliveryNumber": "DEL-0012",
      "status": "in_transit",
      "deliveryTime": "13:00",
      "project": {
        "_id": "665a00000000000000000001",
        "jobId": "PRO-012",
        "projectName": "ABC Warehouse"
      },
      "customer": {
        "_id": "665a00000000000000001001",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "shipperVendor": {
        "_id": "665a00000000000000002001",
        "vendorName": "Metro Steel",
        "vendorCode": "VND-0012"
      },
      "carrier": {
        "_id": "665a00000000000000003001",
        "carrierName": "FastLine Logistics"
      },
      "description": "18 bundle shipment",
      "pickupLocation": "Plant Yard, Houston",
      "deliveryLocation": "ABC Site, Austin",
      "awardedBidAmount": 2450,
      "loadSize": {
        "weight": 62400,
        "dimensions": { "lengthFeet": 51, "widthFeet": 8.5, "heightFeet": 8 },
        "packageCount": 18
      },
      "poc": {
        "receivingPoc": "John Doe",
        "pickupContactPhone": "+1-555-222-3344"
      },
      "equipment": ["forklift", "crane"],
      "pickupDate": "2026-06-12T00:00:00.000Z",
      "deliveryDate": "2026-06-13T00:00:00.000Z",
      "createdAt": "2026-06-10T10:00:00.000Z",
      "updatedAt": "2026-06-11T12:00:00.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

---

## 21ZEF. `GET /api/plant/deliveries/awarded/stats`

Counters only for deliveries with an awarded/selected carrier bid.

### Response `data`

```json
{
  "totalAwarded": 8,
  "inTransit": 3,
  "delivered": 4,
  "totalSpent": 15200
}
```

---

## 21ZEG. `GET /api/plant/deliveries/awarded`

Awarded-load list (same structure as §21ZEE) plus awarded carrier id.

### Query params

Same as §21ZEE.

### Response `data`

```json
{
  "requests": [
    {
      "_id": "66a100000000000000000302",
      "requestId": "66a100000000000000000302",
      "deliveryNumber": "DEL-0013",
      "status": "scheduled",
      "project": {
        "_id": "665a00000000000000000002",
        "jobId": "PRO-013",
        "projectName": "North Storage"
      },
      "carrier": {
        "_id": "665a00000000000000003002",
        "carrierName": "Metro Freight"
      },
      "awardedCarrierId": "665a00000000000000003002",
      "awardedBidAmount": 2300,
      "description": "Trim + accessories load",
      "pickupLocation": "Plant Yard, Houston",
      "deliveryLocation": "North Storage Site",
      "loadSize": {
        "weight": 38800,
        "dimensions": { "lengthFeet": 48, "widthFeet": 8.5, "heightFeet": 7.5 },
        "packageCount": 11
      }
    }
  ],
  "total": 8,
  "page": 1,
  "limit": 20
}
```

---

## 21ZEH. `GET /api/plant/deliveries/calendar`

Delivery calendar grouped by `deliveryDate`.

### Query params

| Param | Type | Default | Notes |
|---|---|---|---|
| `projectId` | string | — | Mongo lead `_id` |
| `customerId` | string | — | Mongo customer `_id` |
| `fromDate` | ISO date | — | Date range start |
| `toDate` | ISO date | — | Date range end |

### Response `data`

```json
{
  "dates": [
    {
      "date": "2026-06-13",
      "totalDeliveries": 2,
      "deliveries": [
        {
          "_id": "66a100000000000000000301",
          "requestId": "66a100000000000000000301",
          "status": "in_transit",
          "project": { "_id": "665a00000000000000000001", "jobId": "PRO-012", "projectName": "ABC Warehouse" },
          "customer": { "_id": "665a00000000000000001001", "name": "John Doe", "email": "john@example.com" },
          "carrier": { "_id": "665a00000000000000003001", "carrierName": "FastLine Logistics" },
          "description": "18 bundle shipment",
          "pickupLocation": "Plant Yard, Houston",
          "deliveryLocation": "ABC Site, Austin",
          "awardedBidAmount": 2450,
          "delivery": {
            "_id": "66a100000000000000000301",
            "deliveryNumber": "DEL-0012",
            "status": "in_transit"
          }
        }
      ]
    }
  ]
}
```

---

## 21ZEI. `GET /api/plant/deliveries/stats`

Master delivery status counters for plant panel.

### Response `data`

```json
{
  "totalCount": 18,
  "draftCount": 2,
  "scheduledCount": 4,
  "confirmedCount": 3,
  "inTransitCount": 3,
  "deliveredCount": 4,
  "delayedCount": 1,
  "cancelledCount": 1
}
```

---

## 21ZEJ. `GET /api/plant/deliveries`

General delivery list for operations table.

### Query params

Same as §21ZEE.

### Response `data`

```json
{
  "deliveries": [
    {
      "_id": "66a100000000000000000301",
      "requestId": "66a100000000000000000301",
      "deliveryNumber": "DEL-0012",
      "status": "in_transit",
      "deliveryTime": "13:00",
      "project": {
        "_id": "665a00000000000000000001",
        "jobId": "PRO-012",
        "projectName": "ABC Warehouse"
      },
      "customer": {
        "_id": "665a00000000000000001001",
        "name": "John Doe",
        "email": "john@example.com"
      },
      "shipperVendor": {
        "_id": "665a00000000000000002001",
        "vendorName": "Metro Steel",
        "vendorCode": "VND-0012"
      },
      "carrier": {
        "_id": "665a00000000000000003001",
        "carrierName": "FastLine Logistics"
      },
      "poc": {
        "receivingPoc": "John Doe",
        "pickupContactPhone": "+1-555-222-3344"
      },
      "equipment": ["forklift", "crane"]
    }
  ],
  "total": 18,
  "page": 1,
  "limit": 20
}
```

---

## 21ZEK2. `GET /api/plant/deliveries/:deliveryId/detail`

Detailed delivery payload for detail screen. Same response shape as §20 (including `formDetails`, `shipperDetails`, `selectedBid`).

### Response `data`

```json
{
  "delivery": {
    "deliveryId": "...",
    "deliveryNumber": "DEL-0012",
    "status": "confirmed",
    "statusHistory": [
      { "status": "draft", "changedAt": "2026-06-10T09:10:00.000Z" },
      { "status": "bidding_sent", "changedAt": "2026-06-10T11:05:00.000Z" },
      { "status": "carrier_selected", "changedAt": "2026-06-11T08:30:00.000Z" },
      { "status": "confirmed", "changedAt": "2026-06-11T10:00:00.000Z" }
    ],
    "project": {
      "leadId": "...",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-019"
    },
    "customer": {
      "customerId": "...",
      "customerName": "John Doe"
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
    "vendorDetails": {
      "vendorName": "Metro Steel",
      "personName": "Mike Johnson",
      "number": "5551234567",
      "email": "mike@metrosteel.com"
    },
    "deliveryCompanyDetails": {
      "carrierName": "FastLine Logistics",
      "personName": "Alex King",
      "number": "5553219876",
      "email": "ops@fastline.com"
    },
    "internalOwner": {
      "userId": "...",
      "name": "Plant Owner",
      "email": "plant@flyweis.com",
      "phone": "5551112222"
    },
    "siteCoordinationNotes": "Call 30 mins before arrival",
    "equipmentRequirement": ["forklift", "crane"],
    "deliveryTypeAndSize": {
      "bundleCount": 18,
      "packageCount": 2,
      "totalWeight": 62400
    },
    "receivingPocDetails": {
      "receivingPoc": "John Doe",
      "pickupContactPhone": "+1-555-222-3344"
    }
  }
}
```

---

## 21ZEK. `PATCH /api/plant/deliveries/:deliveryId/status`

Update delivery status in the operational lifecycle.

### Request body

```json
{
  "status": "confirmed"
}
```

Allowed target values:
- `scheduled`
- `confirmed`
- `in_transit`
- `delayed`
- `delivered`
- `cancelled`

### Response `data`

```json
{
  "delivery": {
    "_id": "66a100000000000000000301",
    "deliveryNumber": "DEL-0012",
    "status": "confirmed",
    "leadId": "665a00000000000000000001",
    "updatedAt": "2026-06-12T07:00:00.000Z"
  }
}
```

Invalid transition returns `400` with:
- `message`: transition error
- `errors.allowedTransitions`: allowed next statuses from current state

---

## 21ZF. `POST /api/plant/deliveries/:deliveryId/send-bids`

Send bid requests to selected active carriers.

### Request body

```json
{
  "carrierIds": ["665a0000000000000000c001", "665a0000000000000000c002"],
  "bidDeadline": "2026-06-10T18:00:00.000Z"
}
```

### Response `data`

```json
{
  "deliveryId": "...",
  "status": "bidding_sent",
  "bidDeadline": "2026-06-10T18:00:00.000Z",
  "sent": [
    { "bidId": "...", "carrierId": "...", "carrierName": "Metro Freight", "expiresAt": "2026-06-10T18:00:00.000Z" }
  ],
  "failures": []
}
```

Behavior:
- Creates or refreshes one `FreightBid` per carrier.
- Sends public bid link email.
- Sets `Delivery.status = bidding_sent`.

---

## 21ZG. `GET /api/plant/deliveries/:deliveryId/bids`

Freight bid detailed view.

### Query params

| Param | Type | Default |
|---|---|---|
| `sort` | `low_to_high` \| `high_to_low` | `low_to_high` |

### Response `data`

```json
{
  "requestId": "...",
  "projectName": "ABC Warehouse",
  "status": "bidding_sent",
  "stats": {
    "totalBids": 3,
    "awardedBid": null,
    "averageBid": 2410.33,
    "potentialSavings": null
  },
  "bidRange": {
    "lowestBid": { "bidId": "...", "amount": 2300, "carrierId": "...", "carrierName": "Metro Freight" },
    "highestBid": { "bidId": "...", "amount": 2550, "carrierId": "...", "carrierName": "FastLine Logistics" }
  },
  "sort": "low_to_high",
  "bids": [
    {
      "bidId": "...",
      "carrierId": "...",
      "carrierName": "Metro Freight",
      "submittedAt": "2026-06-09T11:20:00.000Z",
      "carrierNote": "Rate valid for 24h",
      "bidAmount": 2300,
      "status": "submitted",
      "isLowest": true
    }
  ]
}
```

---

## 21ZH. `POST /api/plant/freight-bids/:bidId/select`

Award one bid:
- selected bid -> `selected`
- all other bids for same delivery -> `rejected`
- delivery linked to awarded bid (`selectedCarrierBidId`)
- delivery status -> `carrier_selected`
- awarded carrier gets awarded email, others get rejection emails

### Response `data`

```json
{
  "deliveryId": "...",
  "status": "carrier_selected",
  "selectedBid": {
    "bidId": "...",
    "carrierId": "...",
    "quotedAmount": 2300,
    "selectedAt": "2026-06-09T13:15:00.000Z"
  },
  "rejectedBidIds": ["..."],
  "emailFailures": []
}
```

---

## 21ZI. `GET /api/public/freight-bids/:token`

Public carrier page bootstrap.

### Response `data`

```json
{
  "bidId": "...",
  "status": "sent",
  "carrierName": "Metro Freight",
  "projectName": "ABC Warehouse",
  "jobId": "PRO-001",
  "deliveryNumber": "DEL-0001",
  "description": "18 bundle shipment",
  "pickupLocation": "Plant Yard, Houston",
  "deliveryLocation": "ABC Site, Austin",
  "bidDeadline": "2026-06-10T18:00:00.000Z",
  "quotedAmount": null,
  "carrierNotes": ""
}
```

---

## 21ZJ. `POST /api/public/freight-bids/:token/submit`

Public bid submit.

### Request body

```json
{
  "quotedAmount": 2300,
  "carrierNotes": "Rate valid for 24h"
}
```

### Response `data`

```json
{
  "bidId": "...",
  "status": "submitted",
  "quotedAmount": 2300,
  "carrierNotes": "Rate valid for 24h",
  "submittedAt": "2026-06-09T11:20:00.000Z"
}
```

Deadline behavior:
- after `expiresAt` / bid deadline, submit is rejected with `400`.

---

## Admin side effect — PO assign

When admin calls `PUT /api/admin/po-orders/:poOrderId/assign`:

- Lead `lifecycleStatus` → `released_to_plant`
- `lifecycleHistory` entry pushed
- Buildings → `drawing_pending` (unchanged)
- Audit: `lead.released_to_plant`
- Socket: `project_assigned` to `user:{assignedTo}` on `/admin` namespace — see [Socket.io](#socketio-plant-panel)

---

## 14. `GET /api/plant/vendors`

List all material vendors / shippers.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `search` | string | No | — | Matches shipper name, contact name, or email |
| `materialType` | string | No | — | Filter vendors that include this material type |
| `status` | string | No | — | `active` \| `inactive` |
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |

### Example request

```http
GET /api/plant/vendors?search=steel&materialType=Panels&status=active&page=1&limit=20
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendors": [
      {
        "_id": "665a00000000000000000010",
        "vendorCode": "VND-0001",
        "vendorName": "ABC Steel",
        "contactName": "Mike Johnson",
        "email": "mike@abcsteel.com",
        "phone": "5551234567",
        "materialTypes": ["Steel", "Panels"],
        "vendorType": "steel",
        "status": "active",
        "pickupLocation": "Houston, TX",
        "activeOrders": 3,
        "totalOrders": 15
      }
    ],
    "total": 8,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `vendorName` | string | Shipper / vendor name |
| `contactName` | string | Primary contact |
| `email` | string | Contact email |
| `phone` | string | Contact phone |
| `materialTypes` | string[] | Materials supplied |
| `vendorType` | string | Vendor category |
| `status` | string | `active` or `inactive` |
| `pickupLocation` | string | Derived from address (`city, state`) |
| `activeOrders` | number | In-progress shipper requests |
| `totalOrders` | number | All shipper requests sent to this vendor |

---

## 15. `POST /api/plant/vendors`

Create a new vendor / shipper.

| | |
|---|---|
| **Role** | `plant` |

### Request body

```json
{
  "vendorName": "Metro Steel",
  "email": "orders@metrosteel.com",
  "phone": "5559876543",
  "contactName": "Sara Lee",
  "vendorCode": "VND-0009",
  "yearsWithCompany": 5,
  "serviceCategory": "Structural Steel Supply",
  "vendorType": "steel",
  "materialTypes": ["Steel", "Insulation"],
  "address": {
    "placeNumber": "120",
    "streetAddress": "Industrial Blvd",
    "landmark": "Near Port Gate 4",
    "city": "Houston",
    "state": "TX",
    "postalCode": "77001",
    "gpsCoordinates": { "lat": 29.7604, "lng": -95.3698 }
  },
  "documents": [
    { "name": "Insurance Certificate", "url": "https://bucket.s3.amazonaws.com/vendor-files/insurance.pdf" }
  ],
  "internalNotes": "Preferred vendor for Gulf Coast projects"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `vendorName` | Yes | Shipper name |
| `email` | Yes | Must be unique |
| `phone` | No | |
| `contactName` | No | |
| `vendorCode` | No | Auto-generated as `VND-0001`, `VND-0002`, … if omitted |
| `yearsWithCompany` | No | Number |
| `serviceCategory` | No | Free-text service description |
| `vendorType` | No | Default `other` |
| `materialTypes` | No | String array |
| `address` | No | Structured address object |
| `documents` | No | `{ name, url }[]` — upload files via presigned URL first |
| `internalNotes` | No | Internal-only notes |

### Response body

**HTTP status:** `201`

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "vendor": {
      "_id": "...",
      "vendorCode": "VND-0009",
      "vendorName": "Metro Steel",
      "email": "orders@metrosteel.com",
      "status": "active",
      "createdAt": "2026-05-28T10:00:00.000Z"
    }
  }
}
```

### Errors

| HTTP | When |
|------|------|
| 400 | Duplicate email or vendor code |
| 422 | Validation failure |

---

## 16. `GET /api/plant/vendors/:vendorId`

Full vendor detail with performance stats and approved order history.

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `vendorId` | MongoDB ObjectId | Yes |

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "665a00000000000000000010",
      "vendorCode": "VND-0001",
      "vendorName": "ABC Steel",
      "contactName": "Mike Johnson",
      "email": "mike@abcsteel.com",
      "phone": "5551234567",
      "yearsWithCompany": 8,
      "serviceCategory": "Steel & Panels",
      "vendorType": "steel",
      "materialTypes": ["Steel", "Panels"],
      "address": {
        "placeNumber": "45",
        "streetAddress": "Steel Ave",
        "landmark": "",
        "city": "Houston",
        "state": "TX",
        "postalCode": "77002",
        "gpsCoordinates": { "lat": 29.76, "lng": -95.37 }
      },
      "documents": [
        { "_id": "...", "name": "W9 Form", "url": "https://..." }
      ],
      "internalNotes": "Fast turnaround",
      "status": "active",
      "pickupLocation": "Houston, TX",
      "createdAt": "2025-06-01T00:00:00.000Z",
      "updatedAt": "2026-05-20T00:00:00.000Z"
    },
    "stats": {
      "totalOrders": 15,
      "completedDeliveries": 12,
      "activeOrders": 3,
      "bidsSubmitted": 14,
      "bidsSent": 15
    },
    "orderHistory": [
      {
        "_id": "...",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "quoteValue": 2100,
        "status": "approved",
        "submittedAt": "2025-02-22T00:00:00.000Z",
        "reviewedAt": "2025-02-24T00:00:00.000Z",
        "sentAt": "2025-02-20T00:00:00.000Z"
      }
    ]
  }
}
```

| Stats field | Meaning |
|-------------|---------|
| `totalOrders` | All shipper requests sent to this vendor |
| `completedDeliveries` | Approved shipper requests |
| `activeOrders` | In-progress requests (sent, submitted, under review, etc.) |
| `bidsSubmitted` | Requests where vendor uploaded a quote file |
| `bidsSent` | Same as total orders sent to vendor |

`orderHistory` includes **approved** shipper requests only.

---

## 17. `PUT /api/plant/vendors/:vendorId`

Update vendor fields. Send only fields to change. `vendorCode` is editable but must remain unique.

Same body fields as create (all optional on update).

**HTTP status:** `200` — returns `{ "vendor": { ...full updated document } }`

---

## 18. `PATCH /api/plant/vendors/:vendorId/toggle-status`

Toggle between `active` and `inactive`.

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "...",
      "status": "inactive"
    }
  }
}
```

---

## 19. `GET /api/plant/carriers`

List freight carriers.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `search` | string | No | — | Matches carrier name, contact name, or email |
| `serviceType` | string | No | — | Exact match |
| `serviceArea` | string | No | — | Exact match |
| `equipmentType` | string | No | — | Matches a fleet equipment name |
| `status` | string | No | — | `active` \| `inactive` |
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |

### Example request

```http
GET /api/plant/carriers?search=express&serviceType=Hotshot&serviceArea=Texas&equipmentType=Flatbed&status=active
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carriers": [
      {
        "_id": "665a00000000000000000020",
        "carrierCode": "CAR-0001",
        "carrierName": "Express Freight Co",
        "contactName": "Tom Reed",
        "email": "dispatch@expressfreight.com",
        "phone": "5554443333",
        "serviceType": "Hotshot",
        "serviceArea": "Texas",
        "equipmentTypes": ["Flatbed", "Semi Trailer"],
        "status": "active",
        "activeBids": 2,
        "totalBids": 18,
        "awardedBidCount": 7,
        "bidWinRate": 38.9,
        "avgBid": 2450.5
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `activeBids` | number | Bids in `sent` or `submitted` status |
| `totalBids` | number | All bid requests sent to this carrier |
| `awardedBidCount` | number | Bids with status `selected` |
| `bidWinRate` | number | `awardedBidCount / submitted bids × 100` (0 if none submitted) |
| `avgBid` | number | Average `quotedAmount` across all bids |
| `equipmentTypes` | string[] | Equipment names from `fleetEquipment` |

---

## 20. `POST /api/plant/carriers`

Create a freight carrier.

### Request body

```json
{
  "carrierName": "Express Freight Co",
  "email": "dispatch@expressfreight.com",
  "phone": "5554443333",
  "contactName": "Tom Reed",
  "carrierCode": "CAR-0005",
  "serviceType": "Hotshot",
  "serviceArea": "Texas, Oklahoma",
  "address": {
    "placeNumber": "88",
    "streetAddress": "Logistics Park Rd",
    "landmark": "Gate B",
    "city": "Dallas",
    "state": "TX",
    "postalCode": "75201",
    "gpsCoordinates": { "lat": 32.7767, "lng": -96.797 }
  },
  "fleetEquipment": [
    { "equipmentName": "Flatbed", "quantity": 4 },
    { "equipmentName": "Semi Trailer", "quantity": 2 }
  ],
  "fleetCapacity": {
    "totalVehicleCount": 6,
    "maximumLoadCapacity": 48000,
    "averageFleetAge": 4.5
  },
  "documents": [
    { "name": "Operating Authority", "url": "https://bucket.s3.amazonaws.com/carrier-files/authority.pdf" }
  ],
  "internalNotes": "Reliable for Gulf Coast hotshot runs"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `carrierName` | Yes | |
| `email` | Yes | Must be unique |
| `carrierCode` | No | Auto `CAR-0001`, `CAR-0002`, … if omitted |
| `fleetEquipment` | No | `{ equipmentName, quantity }[]` |
| `fleetCapacity` | No | `totalVehicleCount`, `maximumLoadCapacity`, `averageFleetAge` |
| `documents` | No | `{ name, url }[]` |

**HTTP status:** `201` — returns `{ "carrier": { ... } }`

---

## 21. `GET /api/plant/carriers/:carrierId`

Full carrier document + performance stats + freight history.

### Response (`data`)

```json
{
  "carrier": {
    "_id": "...",
    "carrierCode": "CAR-0001",
    "carrierName": "Express Freight Co",
    "contactName": "Tom Reed",
    "email": "dispatch@expressfreight.com",
    "phone": "5554443333",
    "serviceType": "Hotshot",
    "serviceArea": "Texas",
    "address": { },
    "fleetEquipment": [ { "equipmentName": "Flatbed", "quantity": 4 } ],
    "fleetCapacity": {
      "totalVehicleCount": 6,
      "maximumLoadCapacity": 48000,
      "averageFleetAge": 4.5
    },
    "documents": [ { "_id": "...", "name": "Insurance", "url": "https://..." } ],
    "internalNotes": "",
    "status": "active",
    "equipmentTypes": ["Flatbed"],
    "createdAt": "...",
    "updatedAt": "..."
  },
  "stats": {
    "totalBids": 18,
    "activeBids": 2,
    "awardedBidCount": 7,
    "bidWinRate": 38.9,
    "avgBid": 2450.5,
    "lastAwardedDate": "2026-05-20T14:00:00.000Z",
    "avgResponseTimeHours": 6.5,
    "assignedProjects": 7
  },
  "freightHistory": [
    {
      "_id": "...",
      "deliveryNumber": "DEL-00012",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-001",
      "status": "selected",
      "quotedAmount": 2200,
      "currency": "USD",
      "sentAt": "2026-05-18T10:00:00.000Z",
      "submittedAt": "2026-05-18T16:30:00.000Z",
      "selectedAt": "2026-05-20T14:00:00.000Z",
      "pickupLocation": "Houston, TX",
      "deliveryLocation": "Dallas, TX"
    }
  ]
}
```

| Stats field | Meaning |
|-------------|---------|
| `lastAwardedDate` | Most recent `selected` bid date |
| `avgResponseTimeHours` | Average hours from bid sent to carrier submission |
| `assignedProjects` | Distinct projects where this carrier won a bid |
| `freightHistory` | All bid records for this carrier |

---

## 22. `PUT /api/plant/carriers/:carrierId`

Update carrier — **all fields editable** (same body as create, all optional). `carrierCode` must stay unique.

**HTTP status:** `200` — returns `{ "carrier": { ...full document } }`

---

## 23. `PATCH /api/plant/carriers/:carrierId/toggle-status`

Toggle `active` ↔ `inactive`.

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrier": { "_id": "...", "status": "inactive" }
  }
}
```

---

## SMDT cost master (shared `/api/smdt`)

Material cost database used for BOM pricing. **Admin and plant** use the same endpoints.

All writes store `uploadedBy` / `addedBy` / `lastUpdatedBy` as the logged-in user's `_id` (no extra metadata).

### Bulk upload checklist

1. `POST /api/upload/presigned-url` with `folder: "smdt"` and Excel MIME type.
2. `PUT` file to `uploadUrl`.
3. `POST /api/smdt/upload` with `{ "fileUrl": "..." }`.
4. Wait for response — import is **synchronous** (~1,385 rows, 20 sheets).

---

## 24. `POST /api/smdt/upload`

Bulk import SMDT cost Excel after S3 upload.

| | |
|---|---|
| **Roles** | `admin`, `plant` |
| **HTTP status** | `200` on success |

### Request body

```json
{
  "fileUrl": "https://bucket.s3.region.amazonaws.com/smdt/uuid.xlsx",
  "fileName": "SMDT_March_2026.xlsx",
  "name": "SMDT Cost March 2026",
  "effectiveDate": "2026-03-01",
  "activate": true
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `fileUrl` | Yes | — | `fileUrl` from presigned-url response |
| `fileName` | No | `""` | Stored on cost version |
| `name` | No | Auto date name | Version display name |
| `effectiveDate` | No | `null` | ISO 8601 date |
| `activate` | No | `true` | New version active; older versions deactivated |

### Response `data`

```json
{
  "costVersionId": "...",
  "isActive": true,
  "inserted": 820,
  "updated": 565,
  "skipped": 48,
  "total": 1385,
  "sheets": [
    { "name": "TRIM", "inserted": 400, "updated": 155, "skippedRows": 12 }
  ]
}
```

Creates a new cost version and version-linked items. Each sheet name maps to `category`.

### Errors

| HTTP | When |
|------|------|
| 400 | Invalid/unreadable Excel URL or parse failure |
| 401 | Missing or invalid token |
| 403 | Role is not `admin` or `plant` |
| 422 | Missing `fileUrl` |

---

## 25. `GET /api/smdt`

Paginated list from the **active** cost version. Empty if no upload yet.

| | |
|---|---|
| **Roles** | `admin`, `plant` |

### Query parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `category` | string | — | Exact sheet name (`TRIM`, `frames`, …) |
| `isFrameType` | boolean string | — | `true` \| `false` |
| `search` | string | — | Part name or description |
| `isActive` | string | `true` | `false` = deactivated only; `all` = both |
| `page` | integer | `1` | Min `1` |
| `limit` | integer | `50` | Max `200` — TRIM alone has ~555 rows |

### Response `data`

```json
{
  "activeVersion": {
    "_id": "...",
    "name": "SMDT Cost March 2026",
    "effectiveDate": "2026-03-01T00:00:00.000Z",
    "uploadedAt": "2026-03-10T00:00:00.000Z",
    "isActive": true
  },
  "items": [
    {
      "_id": "...",
      "category": "TRIM",
      "partName": "RLGU6102",
      "partColor": "M ",
      "costUnit": "EA",
      "mbsCost": 26.19,
      "currentMarketCost": null,
      "laborCost": 0,
      "additionalCost": 0,
      "materialCost": 0,
      "description": "Standard Gutter",
      "isFrameType": false,
      "isActive": true,
      "addedBy": "...",
      "lastImportedAt": "2026-03-10T00:00:00.000Z",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 555,
  "page": 1,
  "limit": 50,
  "categories": ["Insulation", "Joist", "Panels", "TRIM", "..."]
}
```

---

## 26. `GET /api/smdt/:itemId`

Single item with populated `addedBy`, `lastUpdatedBy`, and `costVersionId` (`name`, `isActive`, `effectiveDate`).

| | |
|---|---|
| **Roles** | `admin`, `plant` |

**404** if item not found.

---

## 27. `POST /api/smdt`

Manually add one item to the **active** cost version.

| | |
|---|---|
| **Roles** | `admin`, `plant` |
| **HTTP status** | `201` |

**400** if no active cost version — upload Excel first.

### Request body

```json
{
  "category": "TRIM",
  "partName": "CUSTOM_PART_01",
  "partColor": "M ",
  "costUnit": "FT",
  "mbsCost": 3.50,
  "currentMarketCost": 4.20,
  "laborCost": 0,
  "additionalCost": 0,
  "materialCost": 0,
  "description": "Custom trim piece"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `category` | Yes | One of SMDT sheet names — see enum above |
| `partName` | Yes | |
| `partColor` | No | Omit/`null` for `frames`; else defaults to `"--"` |
| `costUnit` | Yes | `FT` \| `LB` \| `EA` |
| `mbsCost` | Yes | Number ≥ 0 |

Duplicate `{ category, partName, partColor }` in active version → **400**.

### Response `data`

```json
{ "item": { "_id": "...", "category": "TRIM", "partName": "CUSTOM_PART_01", "addedBy": "665a...", "isActive": true } }
```

---

## 28. `PUT /api/smdt/:itemId`

Update costs, description, or active flag.

| | |
|---|---|
| **Roles** | `admin`, `plant` |

### Immutable fields

`partName`, `partColor`, `category`, `costVersionId` — to change identity, deactivate and create a new item.

### Editable fields (all optional)

`mbsCost`, `currentMarketCost`, `costUnit`, `laborCost`, `additionalCost`, `materialCost`, `extraMinCost`, `extraMaxCost`, `description`, `isActive`

Sets `lastUpdatedBy` to current user `_id`.

### Response `data`

```json
{ "item": { "_id": "...", "mbsCost": 3.75, "lastUpdatedBy": "665a...", "updatedAt": "..." } }
```

---

## 29. `DELETE /api/smdt/:itemId`

Soft-deactivate — **never** hard-deletes SMDT data.

| | |
|---|---|
| **Roles** | `admin`, `plant` |

### Response `data`

```json
{ "message": "Item deactivated", "itemId": "..." }
```

---

## End-to-end integration flows

### Flow A — BOM → consolidated BOM → vendor send

```text
1. POST /api/plant/projects/:leadId/bom          (per building, after S3 upload)
2. Poll POST /api/plant/bom/jobs/status          (or socket bom_extraction_complete)
3. GET  /api/plant/bom/:jobId                    (price unmatched lines)
4. PUT  /api/plant/bom/items/:bomItemId/price    (optional manual pricing)
5. POST /api/plant/bom/buildings/:buildingId/confirm   (repeat per building)
6. POST /api/plant/projects/:leadId/consolidated-bom/generate
7. POST /api/plant/projects/:leadId/consolidated-bom/send   { vendorIds: [...] }
```

### Flow B — Vendor upload (public, no plant JWT)

```text
1. Vendor opens link from email: GET /api/public/vendor-upload/:token
2. POST /api/public/vendor-upload/:token/presigned-url   { fileName, fileType }
3. PUT  <uploadUrl>   (direct to S3)
4. POST /api/public/vendor-upload/:token   { submittedFileUrl, submittedFileName, quoteValue }
```

Plant listens for `shipper_file_submitted` / `all_shipper_files_submitted` on `/admin` socket.

### Flow C — Shipper comparison → approve/resubmit → unified load + truck planning

```text
1. GET  /api/plant/shipper-files/projects
2. GET  /api/plant/shipper-files/projects/:leadId/requests
3. POST /api/plant/shipper-requests/:requestId/compare
4. Poll GET /api/plant/shipper-requests/compare-jobs/:jobId/status
   (or socket shipper_comparison_complete)
5. GET  /api/plant/shipper-requests/:requestId/comparison-summary
6. GET  /api/plant/shipper-requests/:requestId/comparison-results?page=1&limit=20
7a. If blockers empty → POST /api/plant/shipper-requests/:requestId/approve
7b. If mismatches   → POST /api/plant/shipper-requests/:requestId/request-resubmit  { note }
    (vendor re-uploads via same token; then repeat from step 3)
8. POST /api/plant/shipper-requests/:requestId/bundle-plan/generate
9. GET  /api/plant/projects/:projectId/load-planning
10. GET /api/plant/projects/:projectId/load-planning/coverage
11. PUT /api/plant/projects/:projectId/load-planning
    (repeat as needed for bundle loadSequence/notes + truck notes updates)
12. POST /api/plant/projects/:projectId/load-planning/confirm-bundles
13. POST /api/plant/projects/:projectId/load-planning/generate-truck-plan
14. GET /api/plant/projects/:projectId/load-planning/truck-plan
15. PUT /api/plant/projects/:projectId/load-planning/trucks/:packingListId
    (optional detailed truck layout adjustment)
16. POST /api/plant/projects/:projectId/load-planning/truck-plan/confirm
```

Regenerate note:
- `POST /api/plant/bundle-plans/:bundlePlanId/packing-list-plan/generate` (and unified project variant) accepts bundles in statuses `confirmed`, `assigned_to_truck`, or `loaded`.
- This keeps regeneration working after prior truck assignment edits.

`canProceedToApproval` from step 5 gates the approve button. Blockers: `comparison_not_run`, `missing_items`, `qty_mismatch`, `length_mismatch`, `weight_mismatch`, `ambiguous_match`.

Frontend note:
- For **all load/truck planning screens**, use project-id endpoints (`/api/plant/projects/:projectId/load-planning...`) as primary integration.
- Keep id-based endpoints only as backward-compatible fallback.

---

### Flow D — Freight request → bidding → award

```text
1. GET  /api/plant/projects/:projectId/freight-autofill
2. POST /api/plant/deliveries
3. POST /api/plant/projects/:projectId/freight/send-bids   { carrierIds, bidDeadline }
4. Carrier opens: GET /api/public/freight-bids/:token
5. Carrier submits: POST /api/public/freight-bids/:token/submit   { quotedAmount, carrierNotes }
6. Plant views: GET /api/plant/projects/:projectId/freight/bids?sort=low_to_high
7. Plant awards: POST /api/plant/freight-bids/:bidId/select
```

Award behavior at step 7:
- selected bid becomes `selected`
- all other bids for same delivery become `rejected`
- `Delivery.selectedCarrierBidId` set to selected bid
- `Delivery.status` becomes `carrier_selected`
- awarded carrier gets award email and others get rejection email

Frontend note:
- For send-bids and bid-detail screens, use project-id endpoints:
  - `POST /api/plant/projects/:projectId/freight/send-bids`
  - `GET /api/plant/projects/:projectId/freight/bids`

---

## Not yet implemented (do not call from FE yet)

These prefixes are mounted under `/api/plant` but route files are **empty stubs**:

| Prefix | Planned use |
|--------|-------------|
| `/api/plant/dashboard` | Plant dashboard KPIs |

---

## Frontend quick reference

| Screen | Endpoint(s) |
|--------|-------------|
| Login | `POST /api/auth/login` → check `role === "plant"` |
| Socket connect | `io(origin + '/admin', { auth: { token } })` — see [Socket.io](#socketio-plant-panel) |
| Projects stat cards | `GET /api/plant/projects/stats` |
| Projects table | `GET /api/plant/projects` |
| Filter: date range | `startDate`, `endDate` on both endpoints |
| Filter: project | `projectId` on list (lead `_id` from row `_id`) |
| Filter: customer | `customerId` on list |
| Filter: building type | `buildingType` on list |
| Filter: drawing status | `drawingStatus` on list |
| Project detail | `GET /api/plant/projects/:leadId/detail` |
| Drawing upload screen | `GET /api/plant/projects/:leadId/buildings` |
| S3 presigned URL | `POST /api/upload/presigned-url` (`folder: "drawings"`) |
| Register drawing(s) | `POST /api/plant/projects/:leadId/drawings` |
| Drawings tab (history) | `GET /api/plant/projects/:leadId/drawings` |
| BOM upload | `POST /api/upload/presigned-url` (`folder: "bom"`) → `POST /api/plant/projects/:leadId/bom` |
| Poll BOM jobs | `GET /api/plant/bom/job/:jobId/status` or `POST /api/plant/bom/jobs/status` |
| BOM pricing | `GET /api/plant/bom/:jobId`, `PUT /api/plant/bom/items/:bomItemId/price` |
| Confirm building BOM | `POST /api/plant/bom/buildings/:buildingId/confirm` |
| BOM tab list | `GET /api/plant/projects/:leadId/bom-files` |
| Consolidated BOM | `POST .../consolidated-bom/generate`, `GET .../consolidated-bom` |
| Send BOM to vendors | `POST .../consolidated-bom/send` `{ vendorIds }` |
| Shipper projects list | `GET /api/plant/shipper-files/projects` |
| Shipper requests table | `GET /api/plant/shipper-files/projects/:leadId/requests` |
| Shipper file preview | `GET /api/plant/shipper-requests/:requestId/document` |
| Run comparison | `POST /api/plant/shipper-requests/:requestId/compare` |
| Poll comparison job | `GET .../compare-jobs/:jobId/status` or `POST .../compare-jobs/status` |
| Comparison summary | `GET .../comparison-summary` |
| Comparison result rows | `GET .../comparison-results?status=&severity=&page=&limit=` |
| Approve vendor | `POST .../approve` |
| Request resubmit | `POST .../request-resubmit` `{ note }` |
| Generate bundle plan | `POST .../bundle-plan/generate` |
| Bundle plan by project | `GET /api/plant/projects/:leadId/bundle-plan` |
| **Primary: unified load planning state** | `GET /api/plant/projects/:projectId/load-planning` |
| **Primary: unified load planning updates** | `PUT /api/plant/projects/:projectId/load-planning` |
| **Primary: coverage gate (project)** | `GET /api/plant/projects/:projectId/load-planning/coverage` |
| **Primary: confirm bundles (project)** | `POST /api/plant/projects/:projectId/load-planning/confirm-bundles` |
| **Primary: generate truck plan (project)** | `POST /api/plant/projects/:projectId/load-planning/generate-truck-plan` |
| **Primary: truck plan detail (project)** | `GET /api/plant/projects/:projectId/load-planning/truck-plan` |
| **Primary: edit truck row (project)** | `PUT /api/plant/projects/:projectId/load-planning/trucks/:packingListId` |
| **Primary: confirm truck plan (project)** | `POST /api/plant/projects/:projectId/load-planning/truck-plan/confirm` |
| Bundle plan by id | `GET /api/plant/bundle-plans/:bundlePlanId` |
| Bundle plan notes | `PUT /api/plant/bundle-plans/:bundlePlanId` |
| Bundle coverage check | `GET /api/plant/bundle-plans/:bundlePlanId/coverage` |
| Confirm bundle plan | `POST /api/plant/bundle-plans/:bundlePlanId/confirm` |
| Add manual bundle | `POST /api/plant/bundle-plans/:bundlePlanId/bundles` |
| Bundle detail/edit/delete | `GET/PUT/DELETE /api/plant/bundles/:bundleId` *(GET is public)* |
| Generate packing list plan | `POST /api/plant/bundle-plans/:bundlePlanId/packing-list-plan/generate` |
| Packing list plan detail | `GET /api/plant/packing-list-plans/:packingListPlanId` *(public; includes bundles)* |
| Confirm packing list plan | `POST /api/plant/packing-list-plans/:packingListPlanId/confirm` |
| Single packing list detail/edit | `GET/PUT /api/plant/packing-lists/:packingListId` |
| **Primary: freight auto-fill by project** | `GET /api/plant/projects/:projectId/freight-autofill` |
| Create freight request | `POST /api/plant/deliveries` |
| Freight requests list by project | `GET /api/plant/deliveries/project/:leadId` |
| Confirmed delivery detail by project | `GET /api/plant/projects/:leadId/delivery` |
| Freight loads stats | `GET /api/plant/deliveries/freight/stats` *(excludes draft)* |
| Freight loads list | `GET /api/plant/deliveries/freight` *(excludes draft by default)* |
| Awarded loads stats/list | `GET /api/plant/deliveries/awarded/stats`, `GET /api/plant/deliveries/awarded` |
| Delivery calendar | `GET /api/plant/deliveries/calendar` |
| Delivery dashboard stats/list | `GET /api/plant/deliveries/stats`, `GET /api/plant/deliveries` |
| Delivery detail card payload | `GET /api/plant/deliveries/:deliveryId/detail` |
| Update delivery status | `PATCH /api/plant/deliveries/:deliveryId/status` |
| **Primary: send bids by project** | `POST /api/plant/projects/:projectId/freight/send-bids` |
| **Primary: bids view by project** | `GET /api/plant/projects/:projectId/freight/bids?sort=low_to_high|high_to_low` |
| Send freight bid links | `POST /api/plant/deliveries/:deliveryId/send-bids` |
| Freight bid detail view | `GET /api/plant/deliveries/:deliveryId/bids?sort=low_to_high|high_to_low` |
| Award freight bid | `POST /api/plant/freight-bids/:bidId/select` |
| Public freight bid page | `GET /api/public/freight-bids/:token` |
| Public freight bid submit | `POST /api/public/freight-bids/:token/submit` |
| Vendor public upload page | `GET /api/public/vendor-upload/:token` |
| Vendor S3 presign | `POST /api/public/vendor-upload/:token/presigned-url` |
| Vendor submit quote | `POST /api/public/vendor-upload/:token` |
| Vendors table | `GET /api/plant/vendors` |
| Add vendor | `POST /api/plant/vendors` |
| Vendor detail | `GET /api/plant/vendors/:vendorId` |
| Edit vendor | `PUT /api/plant/vendors/:vendorId` |
| Toggle vendor status | `PATCH /api/plant/vendors/:vendorId/toggle-status` |
| Vendor search | `search` (name, contact, email) |
| Vendor material filter | `materialType` |
| Carriers table | `GET /api/plant/carriers` |
| Add carrier | `POST /api/plant/carriers` |
| Carrier detail | `GET /api/plant/carriers/:carrierId` |
| Edit carrier | `PUT /api/plant/carriers/:carrierId` |
| Toggle carrier status | `PATCH /api/plant/carriers/:carrierId/toggle-status` |
| Carrier search | `search` (name, contact, email) |
| Carrier filters | `serviceType`, `serviceArea`, `equipmentType` |
| SMDT bulk upload | `POST /api/upload/presigned-url` (`folder: "smdt"`) → `POST /api/smdt/upload` |
| SMDT list / search | `GET /api/smdt` (`category`, `search`, paginate) |
| SMDT add / edit | `POST /api/smdt`, `PUT /api/smdt/:itemId` |
| SMDT deactivate | `DELETE /api/smdt/:itemId` |

---

*Document now includes the updated BOM → consolidated BOM → vendor upload → compare/resubmit/approve → bundle plan → packing-list plan flow used by current code.*
