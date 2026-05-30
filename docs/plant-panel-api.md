# Plant Panel — Frontend API Reference

Frontend integration guide for the **Plant Panel** (`role: "plant"`).

> **Maintenance:** Add or update a section here whenever a plant panel endpoint is implemented or changed. Only document **completed** endpoints — no placeholders for work in progress.
>
> **Last updated:** 2026-05-28 — Building list + drawing upload (S3 URL registration), plant presigned URL access.

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

Call the plant endpoint for that feature (e.g. `POST /api/plant/projects/:leadId/drawings` with `fileUrl` + `fileName` + `buildingId`). See [§9 Upload drawings](#9-post-apiplantprojectsleadiddrawings).

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
| 11 | GET | `/api/plant/projects/:leadId/bom-files` | BOM upload jobs (when model exists) |
| 12 | GET | `/api/plant/projects/:leadId/delivery` | Deliveries for project |
| 13 | GET | `/api/plant/projects/:leadId/shipper-files` | Vendor shipper submissions |
| 14 | GET | `/api/plant/vendors` | List vendors / shippers |
| 15 | POST | `/api/plant/vendors` | Add vendor / shipper |
| 16 | GET | `/api/plant/vendors/:vendorId` | Vendor detail + stats + order history |
| 17 | PUT | `/api/plant/vendors/:vendorId` | Update vendor |
| 18 | PATCH | `/api/plant/vendors/:vendorId/toggle-status` | Toggle active / inactive |
| 19 | GET | `/api/plant/carriers` | List freight carriers |
| 20 | POST | `/api/plant/carriers` | Add freight carrier |
| 21 | GET | `/api/plant/carriers/:carrierId` | Carrier detail + stats + freight history |
| 22 | PUT | `/api/plant/carriers/:carrierId` | Update carrier |
| 23 | PATCH | `/api/plant/carriers/:carrierId/toggle-status` | Toggle active / inactive |

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

Lightweight building list for the **drawing upload screen**. Does not include full version history — use [§10](#10-get-apiplantprojectsleadiddrawings) for the Drawings tab.

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
      "hasDrawing": true
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

## 11. `GET /api/plant/projects/:leadId/bom-files`

Returns BOM job rows when `BOMJob` model is available; otherwise `{ "bomFiles": [] }`.

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
      "status": "completed",
      "uploadedAt": "...",
      "totalItems": 120,
      "isConfirmed": false
    }
  ]
}
```

---

## 12. `GET /api/plant/projects/:leadId/delivery`

### Response `data`

```json
{
  "deliveries": [
    {
      "_id": "...",
      "deliveryNumber": "DEL-0001",
      "status": "draft",
      "pickupLocation": "",
      "deliveryLocation": "",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## 13. `GET /api/plant/projects/:leadId/shipper-files`

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

## Admin side effect — PO assign

When admin calls `PUT /api/admin/po-orders/:poOrderId/assign`:

- Lead `lifecycleStatus` → `released_to_plant`
- `lifecycleHistory` entry pushed
- Buildings → `drawing_pending` (unchanged)
- Audit: `lead.released_to_plant`
- Socket: `project_assigned` to plant user

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

## Frontend quick reference

| Screen | Endpoint(s) |
|--------|-------------|
| Login | `POST /api/auth/login` → check `role === "plant"` |
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

---

*Last updated: Projects (13) + Vendors (5) + Carriers (5 endpoints).*
