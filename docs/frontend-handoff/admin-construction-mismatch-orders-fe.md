# Admin Construction — Mismatch Orders

**Status:** Ready  
**Date:** 7 Nov 2026  
**UI route (example):** `/construction/mismatch-orders/`  
**Auth:** `Authorization: Bearer <admin JWT>`  
**Envelope:** `{ "success": true, "message": "…", "data": { … } }`

Mismatch rows come from **construction bundle scan** reports. Each report creates a `BundleMismatchOrder` with a human-readable id **`MMO-####`**.

**All projects (recommended):** `GET /api/admin/construction/mismatch-orders` — same handler as plant global list (see §3).

Per-project tab/detail can still use `GET /api/admin/plant/projects/{leadId}/mismatch-orders` (§2).

**Related docs:** [`../frontend-construction-plant-mismatch-phases-api.md`](../frontend-construction-plant-mismatch-phases-api.md) · [`construction-panel-backlog-fe.md`](./construction-panel-backlog-fe.md) (§5.5 report flow)

---

## 1. UI column mapping

| Admin table column | API source |
|--------------------|------------|
| Order ID | `mismatchOrderId` (e.g. `MMO-0007`) |
| Project | `projectName` (+ optional `jobId`) |
| Material Name | `items[].description` or `items[].partCode` (one table row per line item if expanded) |
| Quantity | `items[].expectedQty` |
| Received Quantity | `items[].receivedQty` |
| Order Date | `createdAt` |
| Status | `status` (`open`, `in_review`, `resolved`, `closed`, `cancelled`) |

**Empty state** (`No mismatch orders found`) = no `BundleMismatchOrder` documents yet, or list scoped to zero leads (see §3.2).

---

## 2. List — single project (recommended when “All Projects” is not selected)

Use when the user picks a project in the filter dropdown.

```http
GET /api/admin/plant/projects/{leadId}/mismatch-orders?page=1&limit=10&status=open
Authorization: Bearer <token>
```

### Query parameters

| Param | Required | Values |
|-------|----------|--------|
| `page` | No | Default `1` |
| `limit` | No | Default `20`, max `200` |
| `status` | No | `open` \| `in_review` \| `resolved` \| `closed` \| `cancelled` (omit = all statuses) |
| `search` | No | Not supported on this endpoint — filter client-side or use §3.2 |

### Example request

```http
GET /api/admin/plant/projects/6ac4e5e6570533c2c601ed40/mismatch-orders?page=1&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…
```

### Example response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6ac4e5e6570533c2c601ed40",
    "projectName": "ABC Warehouse",
    "jobId": "PRO-023",
    "mismatchOrders": [
      {
        "mismatchId": "67c0abc1234567890abcdef",
        "mismatchOrderId": "MMO-0007",
        "status": "open",
        "reason": "Short shipment",
        "notes": "Two purlin lines missing from bundle scan",
        "actionNotes": "",
        "bundleId": "67a1b2c3d4e5f6789012345a",
        "bundleNo": "B-12",
        "leadId": "6ac4e5e6570533c2c601ed40",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-023",
        "items": [
          {
            "itemId": "67a1b2c3d4e5f6789012345b",
            "partCode": "P-102",
            "description": "Z Purlin 8in",
            "expectedQty": 24,
            "receivedQty": 18,
            "status": "Partially Received"
          },
          {
            "itemId": "67a1b2c3d4e5f6789012345c",
            "partCode": "CL-440",
            "description": "Wall clip",
            "expectedQty": 120,
            "receivedQty": 120,
            "status": "Received"
          }
        ],
        "photos": [
          {
            "name": "dock-photo.jpg",
            "url": "https://cdn.example.com/dock-photo.jpg"
          }
        ],
        "reportedBy": {
          "_id": "664a1b2c3d4e5f6789012345d",
          "name": "Site Lead",
          "email": "site@example.com"
        },
        "reviewedBy": null,
        "resolvedAt": null,
        "createdAt": "2026-10-14T06:30:00.000Z",
        "updatedAt": "2026-10-14T06:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

### Example response — no rows

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6ac4e5e6570533c2c601ed40",
    "projectName": "ABC Warehouse",
    "jobId": "PRO-023",
    "mismatchOrders": [],
    "total": 0,
    "page": 1,
    "limit": 10
  }
}
```

**FE note:** To match the flat table (one row per material line), expand each `mismatchOrders[]` entry into `items.length` rows; repeat `mismatchOrderId`, `projectName`, `createdAt`, and `status` on each line.

---

## 3. List — all projects (cross-project inbox) — **use this for the table**

```http
GET /api/admin/construction/mismatch-orders?page=1&limit=10&status=open&leadId=&search=&startDate=&endDate=
Authorization: Bearer <admin token>
```

**Aliases (same handler):**

| Panel | Path |
|--------|------|
| Admin → Construction | `GET /api/admin/construction/mismatch-orders` |
| Construction app | `GET /api/construction/mismatch-orders` |
| Admin / Plant | `GET /api/admin/plant/mismatch-orders` |
| Plant | `GET /api/plant/mismatch-orders` |

### Query parameters

| Param | Notes |
|-------|--------|
| `page`, `limit` | Pagination (`limit` max `200`) |
| `status` | `open` \| `in_review` \| `resolved` \| `closed` \| `cancelled` (omit or `All` = every status) |
| `leadId` / `projectId` | Optional — filter one project (dropdown) |
| `search` | `mismatchOrderId`, reason, notes, `bundleNo`, or lead `projectName` / `jobId` |
| `startDate`, `endDate` | Filter on mismatch order **`createdAt`** (order date) |

### Example request

```http
GET /api/admin/construction/mismatch-orders?page=1&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…
```

### Example response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "mismatchOrders": [
      {
        "mismatchId": "67c0abc1234567890abcdef",
        "mismatchOrderId": "MMO-0007",
        "status": "open",
        "reason": "Short shipment",
        "notes": "Two purlin lines missing from bundle scan",
        "actionNotes": "",
        "bundleId": "67a1b2c3d4e5f6789012345a",
        "bundleNo": "B-12",
        "leadId": "6ac4e5e6570533c2c601ed40",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-023",
        "items": [
          {
            "itemId": "67a1b2c3d4e5f6789012345b",
            "partCode": "P-102",
            "description": "Z Purlin 8in",
            "expectedQty": 24,
            "receivedQty": 18,
            "status": "Partially Received"
          }
        ],
        "photos": [],
        "reportedBy": { "_id": "664a…", "name": "Site Lead", "email": "site@example.com" },
        "reviewedBy": null,
        "resolvedAt": null,
        "createdAt": "2026-10-14T06:30:00.000Z",
        "updatedAt": "2026-10-14T06:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

**Scope:** Admin Construction list is **not** limited to approved-PO plant scope (same idea as `GET /api/admin/construction/material-requests`). Plant panel users only see mismatches on their assigned plant projects.

---

### 3.1 Legacy — plant dashboard mismatch report (optional KPI / mixed report)

Aggregates **construction delivery** mismatches (`source: "delivery_mismatch"`) with optional shipper quote-compare rows when `category` is omitted.

```http
GET /api/admin/plant/dashboard/mismatch-report?page=1&limit=10&search=purlin&startDate=2026-09-01&endDate=2026-10-31
Authorization: Bearer <token>
```

| Param | Notes |
|-------|--------|
| `page`, `limit` | Pagination (`limit` max `200`) |
| `search` | Matches reason, notes, `mismatchOrderId`, `bundleNo` on delivery rows |
| `startDate`, `endDate` | Scope **approved PO** leads by PO `createdAt`, not mismatch order date |
| `category` | Validated values: `missing` \| `qty` \| `spec` \| `extra`. **Omit** to include delivery MMOs + quote lines. For construction-only rows, keep rows where `source === "delivery_mismatch"`. |

**Limitation:** Delivery rows in this report only include mismatches in status **`open`** or **`in_review`**. Resolved / closed tickets still appear on §2 per-project list.

### Example request

```http
GET /api/admin/plant/dashboard/mismatch-report?page=1&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…
```

### Example response `200` (construction row only)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "items": [
      {
        "resultId": "67c0abc1234567890abcdef",
        "source": "delivery_mismatch",
        "mismatchId": "67c0abc1234567890abcdef",
        "mismatchOrderId": "MMO-0007",
        "leadId": "6ac4e5e6570533c2c601ed40",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-023",
        "vendorName": "",
        "vendorCode": "",
        "fileName": "",
        "bundleId": "67a1b2c3d4e5f6789012345a",
        "bundleNo": "B-12",
        "status": "delivery_mismatch",
        "orderStatus": "open",
        "severity": "high",
        "reason": "Short shipment",
        "expected": {
          "qty": 144,
          "items": [
            {
              "partCode": "P-102",
              "description": "Z Purlin 8in",
              "expectedQty": 24,
              "receivedQty": 18,
              "status": "Partially Received"
            }
          ]
        },
        "received": {
          "qty": 138,
          "items": [
            {
              "partCode": "P-102",
              "description": "Z Purlin 8in",
              "expectedQty": 24,
              "receivedQty": 18,
              "status": "Partially Received"
            }
          ]
        },
        "items": [
          {
            "partCode": "P-102",
            "description": "Z Purlin 8in",
            "expectedQty": 24,
            "receivedQty": 18,
            "status": "Partially Received"
          }
        ],
        "photos": [],
        "reportedBy": {
          "_id": "664a1b2c3d4e5f6789012345d",
          "name": "Site Lead",
          "email": "site@example.com"
        },
        "createdAt": "2026-10-14T06:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

### Summary KPI (optional header widgets)

```http
GET /api/admin/plant/dashboard/mismatch-summary
Authorization: Bearer <token>
```

Use `deliveryMismatches` / `constructionDeliveryMismatches` for open construction ticket count. See [`plant-mismatch-delivery-fe.md`](./plant-mismatch-delivery-fe.md).

---

## 4. Create mismatch (Construction panel — source of data)

Admin list stays empty until Construction reports a bundle mismatch.

```http
POST /api/construction/bundles/{bundleId}/report-mismatch
Authorization: Bearer <construction token>
Content-Type: application/json
```

Construction and admin users with construction access may call the same route when wired from Admin.

### Example request

```json
{
  "leadId": "6ac4e5e6570533c2c601ed40",
  "reason": "Short shipment",
  "notes": "Two purlin lines missing from bundle scan",
  "items": [
    {
      "itemId": "67a1b2c3d4e5f6789012345b",
      "expectedQty": 24,
      "receivedQty": 18,
      "partCode": "P-102",
      "description": "Z Purlin 8in"
    }
  ],
  "photos": [
    { "name": "dock-photo.jpg", "url": "https://cdn.example.com/dock-photo.jpg" }
  ]
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `notes` or `reason` | Yes (one of) | Stored as mismatch detail |
| `items` | No | Each line needs valid bundle line `itemId` |
| `expectedQty` | No | Alias: `qty` |

### Example response `200`

```json
{
  "success": true,
  "message": "Mismatch reported",
  "data": {
    "bundleId": "67a1b2c3d4e5f6789012345a",
    "mismatchNotes": "Two purlin lines missing from bundle scan",
    "mismatchReportedAt": "2026-10-14T06:30:00.000Z",
    "mismatchItems": [
      {
        "itemId": "67a1b2c3d4e5f6789012345b",
        "partCode": "P-102",
        "description": "Z Purlin 8in",
        "qty": 24,
        "receivedQty": 18,
        "status": "Partially Received"
      }
    ],
    "mismatchOrder": {
      "mismatchId": "67c0abc1234567890abcdef",
      "mismatchOrderId": "MMO-0007",
      "status": "open",
      "leadId": "6ac4e5e6570533c2c601ed40",
      "bundleId": "67a1b2c3d4e5f6789012345a"
    }
  }
}
```

---

## 5. Update status (Plant / Admin action)

```http
PUT /api/admin/plant/mismatch-orders/{mismatchId}/status
Authorization: Bearer <token>
Content-Type: application/json
```

`mismatchId` = Mongo `_id` from `mismatchId` / `resultId` field (not `MMO-####`).

### Example request

```json
{
  "status": "in_review",
  "actionNotes": "Requested photos from construction; checking plant inventory."
}
```

### Example response `200`

```json
{
  "success": true,
  "message": "Mismatch order updated",
  "data": {
    "mismatchOrder": {
      "mismatchId": "67c0abc1234567890abcdef",
      "mismatchOrderId": "MMO-0007",
      "status": "in_review",
      "reason": "Short shipment",
      "notes": "Two purlin lines missing from bundle scan",
      "actionNotes": "Requested photos from construction; checking plant inventory.",
      "bundleId": "67a1b2c3d4e5f6789012345a",
      "bundleNo": "B-12",
      "leadId": "6ac4e5e6570533c2c601ed40",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-023",
      "items": [
        {
          "itemId": "67a1b2c3d4e5f6789012345b",
          "partCode": "P-102",
          "description": "Z Purlin 8in",
          "expectedQty": 24,
          "receivedQty": 18,
          "status": "Partially Received"
        }
      ],
      "photos": [],
      "reportedBy": {
        "_id": "664a1b2c3d4e5f6789012345d",
        "name": "Site Lead",
        "email": "site@example.com"
      },
      "reviewedBy": null,
      "resolvedAt": null,
      "createdAt": "2026-10-14T06:30:00.000Z",
      "updatedAt": "2026-10-15T09:12:00.000Z"
    }
  }
}
```

Setting `status` to `resolved` or `closed` sets `resolvedAt` and `reviewedBy` to the current user.

---

## 6. Errors (common)

| HTTP | When |
|------|------|
| `400` | Report: missing `notes`/`reason`, invalid `itemId`, `leadId` ≠ bundle project |
| `401` | Missing or invalid token |
| `403` | Project outside plant scope (rare for admin) |
| `404` | Unknown `leadId`, `bundleId`, or `mismatchId` |

---

## 7. FE checklist

- [ ] **All projects table** → `GET /api/admin/construction/mismatch-orders` (§3)
- [ ] Project filter → add `leadId` or `projectId` on §3, or use §2 per-project endpoint
- [ ] Table rows → expand `items[]` for Material Name / Quantity / Received Quantity
- [ ] Detail / workflow → `PUT /api/admin/plant/mismatch-orders/{mismatchId}/status`
- [ ] Data entry path documented for QA → Construction `POST …/report-mismatch`

---

## 8. cURL (replace host, token, ids)

```bash
# All projects (Construction admin page)
curl -s "https://mr-storage-backend-025k.onrender.com/api/admin/construction/mismatch-orders?page=1&limit=10" \
  -H "Authorization: Bearer TOKEN"

# One project
curl -s "https://mr-storage-backend-025k.onrender.com/api/admin/plant/projects/LEAD_ID/mismatch-orders?page=1&limit=10" \
  -H "Authorization: Bearer TOKEN"

# Update status
curl -s -X PUT "https://mr-storage-backend-025k.onrender.com/api/admin/plant/mismatch-orders/MISMATCH_MONGO_ID/status" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"resolved","actionNotes":"Replenishment scheduled."}'
```
