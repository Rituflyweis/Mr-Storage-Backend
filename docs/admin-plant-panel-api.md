# Admin Plant Panel — Frontend API Reference

Frontend integration guide for the **Admin Plant Panel** (`role: "admin"`).

> **Maintenance:** Add or update a section here whenever an admin plant panel endpoint is implemented or changed. Only document **completed** endpoints — no placeholders for work in progress.
>
> **Last updated:** 2026-06-24 — Added vendor, carrier, and SMDT costing management APIs (mirrors plant panel).

---

## Base URL & auth

| Item | Value |
|------|--------|
| Base path | `/api/admin/plant` |
| Required role | `admin` |
| Auth header | `Authorization: Bearer <access_token>` |
| Data scope | All **approved PO orders** (no plant-user `assignedTo` filter) |

Admin users log in via the shared auth endpoint:

```http
POST /api/auth/login
Content-Type: application/json
```

**Request body**

```json
{
  "email": "admin@example.com",
  "password": "TempPass123"
}
```

**Login response**

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "role": "admin",
    "user": {
      "_id": "665a00000000000000000001",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin"
    }
  }
}
```

**Note:** Admin page routes reuse the same plant controllers as `/api/plant/*`. Every example below shows the **exact HTTP envelope** the backend returns: `{ success, message, data }`. Field names and nesting match the controller return values. GET endpoints use the default top-level `"message": "Success"` unless noted; POST/PUT mutation endpoints use endpoint-specific messages (e.g. `"BOM upload registered"`, `"Bundle plan confirmed"`).

**Note:** These endpoints are **not read-only** — admin can upload BOM, approve shippers, confirm bundle plans, etc., via the same mutation endpoints as plant.

---

## Standard response envelopes

### Success (200 / 201)

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

`message` varies by endpoint (e.g. `"BOM upload registered"`, `"Packing list plan confirmed"`). `data` always holds the payload documented below.

### Error (4xx)

```json
{
  "success": false,
  "message": "Access denied"
}
```

Validation errors may include `errors`:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "vendorIds", "msg": "Invalid value" }]
}
```

Business-rule failures (e.g. unpriced BOM items) may attach extra fields on `errors`:

```json
{
  "success": false,
  "message": "3 items still need pricing",
  "errors": { "unpricedMarkIds": ["S6-1", "S6-2"] }
}
```

---

## Data scope filters (optional)

| Param | Type | Effect |
|-------|------|--------|
| `startDate` | ISO 8601 | Filter PO orders by `createdAt >= startDate` |
| `endDate` | ISO 8601 | Filter PO orders by `createdAt <= endDate` (end of day) |
| `assignedTo` | ObjectId | Further limit to PO orders assigned to that plant user |

When no approved POs match, list endpoints return empty arrays and stat counters return `0`.

---

# Dashboard APIs

Base: `/api/admin/plant/dashboard`

---

## 1. `GET /api/admin/plant/dashboard/order-progress-review`

**Query (optional):** `startDate`, `endDate`, `assignedTo`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "quotationsSent": 12,
    "uploadedBom": 45,
    "sentToShipper": 30,
    "loadsPlanned": 18,
    "shippedQuantity": 6
  }
}
```

---

## 2. `GET /api/admin/plant/dashboard/load-planning-status`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "loadsPlanning": 8,
    "plannedCount": 10,
    "readyToShip": 5,
    "dispatch": 3
  }
}
```

---

## 3. `GET /api/admin/plant/dashboard/shipper-quotation-summary`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "requested": 40,
    "quoted": 28,
    "pending": 12
  }
}
```

---

## 4. `GET /api/admin/plant/dashboard/packing-list-summary`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "generated": 15,
    "inProgress": 4,
    "pending": 6
  }
}
```

---

## 5. `GET /api/admin/plant/dashboard/qr-labels-summary`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "generated": 20,
    "inProgress": 3,
    "pending": 2
  }
}
```

---

## 6. `GET /api/admin/plant/dashboard/shippers-summary`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "activeShippers": 8,
    "ordersWithShippers": 22,
    "pendingAssignments": 5
  }
}
```

---

## 7. `GET /api/admin/plant/dashboard/deliveries-summary`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "scheduled": 4,
    "inTransit": 2,
    "delivered": 10
  }
}
```

---

## 8. `GET /api/admin/plant/dashboard/upcoming-shipments`

**Query:** `page` (default `1`), `limit` (default `20`, max `200`), `search`, `status`, `fromDate`, `toDate`, `startDate`, `endDate`, `assignedTo`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "shipments": [
      {
        "deliveryId": "6a35278dea2e91bb6f4aaf50",
        "orderId": "JOB-1024",
        "leadId": "6a337c60edd83b0390b870c3",
        "projectName": "ABC Warehouse",
        "shipper": {
          "vendorId": "674abc1234567890abcdef01",
          "vendorName": "Steel Co",
          "vendorCode": "VND-001"
        },
        "loadPlanId": "674def1234567890abcdef02",
        "loadPlanNumber": "BP-0008",
        "shipDate": "2026-06-28T00:00:00.000Z",
        "estDeliveryDate": "2026-06-30T00:00:00.000Z",
        "deliveryLocation": "123 Site Rd, Austin, TX",
        "status": "confirmed",
        "deliveryNumber": "DEL-0012"
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

`shipper` is `null` when no approved shipper vendor exists for the order.

---

# BOM page APIs

Base: `/api/admin/plant/bom` and `/api/admin/plant/projects/:leadId/...`

---

## `GET /api/admin/plant/bom/stats`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalBomFilesUploaded": 12,
    "pendingUploads": 3,
    "readyForShipper": 4,
    "issuesDetected": 1
  }
}
```

---

## `GET /api/admin/plant/bom/projects`

**Query:** `page` (default `1`), `limit` (default `20`, max `200`)

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "6a337c60edd83b0390b870c3",
        "projectId": "PRO-001",
        "projectName": "ABC Warehouse",
        "customerName": "John Smith",
        "buildingType": "Commercial",
        "location": "Austin, TX",
        "buildingId": "665a00000000000000000111",
        "buildingNumber": 1,
        "uploadDate": "2026-06-03T05:20:00.000Z",
        "itemCount": 320,
        "fileStatus": "extracted",
        "bomJobId": "665a00000000000000000222"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

`fileStatus`: `uploaded` | `extracting` | `extracted` | `failed`

---

## `GET /api/admin/plant/bom/projects/:leadId/consolidated-url`

**Response (ready)**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6a337c60edd83b0390b870c3",
    "isReady": true,
    "consolidatedBOMId": "665a00000000000000000333",
    "status": "draft",
    "fileUrl": "https://bucket.s3.region.amazonaws.com/consolidated/.../uuid.xlsx",
    "updatedAt": "2026-06-03T05:40:00.000Z"
  }
}
```

**Response (not ready)**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6a337c60edd83b0390b870c3",
    "isReady": false,
    "consolidatedBOMId": null,
    "status": null,
    "fileUrl": null,
    "updatedAt": null
  }
}
```

---

## `GET /api/admin/plant/bom/job/:jobId/status`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "jobId": "665a00000000000000000222",
    "status": "completed",
    "buildingId": "665a00000000000000000111",
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
    "processingStartedAt": "2026-06-03T05:20:01.000Z",
    "processingEndedAt": "2026-06-03T05:21:45.000Z",
    "parseSuspect": false,
    "parseAudit": null
  }
}
```

---

## `POST /api/admin/plant/bom/jobs/status`

**Request body**

```json
{
  "jobIds": ["665a00000000000000000222", "665a00000000000000000223"]
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "jobs": [
      {
        "jobId": "665a00000000000000000222",
        "status": "completed",
        "buildingId": "665a00000000000000000111",
        "buildingNumber": 1,
        "totalItems": 320,
        "matchedItems": 285,
        "unmatchedItems": 27,
        "errorMessage": null,
        "processingEndedAt": "2026-06-03T05:21:45.000Z",
        "parseSuspect": false
      },
      {
        "jobId": "665a00000000000000000223",
        "error": "Not found"
      }
    ]
  }
}
```

---

## `GET /api/admin/plant/bom/:jobId`

**Query:** `filter=all|unpriced|frames|matched|bom_priced`, `page`, `limit` (default `50`, max `200`)

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bomJob": {
      "_id": "665a00000000000000000222",
      "buildingId": "665a00000000000000000111",
      "buildingNumber": 1,
      "fileName": "bom-b1.ods",
      "status": "completed",
      "isConfirmed": false,
      "totalItems": 320,
      "matchedItems": 285,
      "unmatchedItems": 27,
      "frameItems": 8,
      "extractionMethod": "exceljs",
      "skippedSheets": [],
      "parseSuspect": false,
      "parseAudit": null
    },
    "itemsByCategory": {
      "Panels": [
        {
          "_id": "665a00000000000000000444",
          "bomJobId": "665a00000000000000000222",
          "buildingId": "665a00000000000000000111",
          "category": "Panels",
          "markId": "S6-1",
          "partCode": "C62514",
          "partColor": "RO",
          "description": "CEE Stud",
          "quantity": 25,
          "lengthFeet": 6.9792,
          "weight": 621,
          "costUnit": "FT",
          "isPriced": true,
          "isFrameType": false,
          "matchStatus": "matched",
          "priceSource": "smdt",
          "finalUnitCost": 1.28,
          "finalTotalCost": 223.36,
          "rowNumber": 12
        }
      ]
    },
    "summary": {
      "totalItems": 320,
      "pricedItems": 293,
      "unpricedItems": 27,
      "bomPricedItems": 12,
      "frameItems": 8,
      "totalWeight": 36280.4,
      "totalCost": 87450.25,
      "isFullyPriced": false
    },
    "total": 320,
    "page": 1,
    "limit": 50
  }
}
```

---

## `PUT /api/admin/plant/bom/items/:bomItemId/price`

**Request body**

```json
{
  "manualUnitCost": 1.68,
  "saveToSMDT": true
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bomItem": {
      "_id": "665a00000000000000000444",
      "partCode": "C62514",
      "isManuallyPriced": true,
      "manualUnitCost": 1.68,
      "manualTotalCost": 293.28,
      "isPriced": true,
      "finalUnitCost": 1.68,
      "finalTotalCost": 293.28,
      "manualPriceSavedToSMDT": true
    }
  }
}
```

---

## `POST /api/admin/plant/bom/buildings/:buildingId/confirm`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "buildingId": "665a00000000000000000111",
    "buildingNumber": 1,
    "isConfirmed": true,
    "totalCost": 4520.75
  }
}
```

---

## `GET /api/admin/plant/projects/:leadId/bom-files`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bomFiles": [
      {
        "buildingId": "665a00000000000000000111",
        "buildingNumber": 1,
        "bomJobId": "665a00000000000000000222",
        "fileName": "bom-b1.ods",
        "fileUrl": "https://bucket.s3.../bom/b1.ods",
        "fileFormat": "ods",
        "status": "completed",
        "uploadedAt": "2026-06-03T05:20:00.000Z",
        "totalItems": 320,
        "matchedItems": 285,
        "unmatchedItems": 27,
        "frameItems": 8,
        "isConfirmed": false,
        "extractionMethod": "exceljs",
        "skippedSheets": [],
        "errorMessage": null
      }
    ]
  }
}
```

---

## `POST /api/admin/plant/projects/:leadId/bom`

**Request body**

```json
{
  "bomFiles": [
    {
      "buildingId": "665a00000000000000000111",
      "fileUrl": "https://bucket.s3.../bom/b1.ods",
      "fileName": "bom-b1.ods",
      "fileFormat": "ods"
    }
  ]
}
```

**Response (201)**

```json
{
  "success": true,
  "message": "BOM upload registered",
  "data": {
    "leadId": "6a337c60edd83b0390b870c3",
    "jobs": [
      {
        "buildingId": "665a00000000000000000111",
        "buildingNumber": 1,
        "bomJobId": "665a00000000000000000222",
        "status": "queued",
        "fileName": "bom-b1.ods"
      }
    ],
    "message": "BOM extraction started for 1 building(s). Poll job status until completed."
  }
}
```

---

## `POST /api/admin/plant/projects/:leadId/consolidated-bom/generate`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "consolidatedBOM": {
      "_id": "665a00000000000000000333",
      "status": "draft",
      "fileUrl": "https://bucket.s3.region.amazonaws.com/consolidated/.../uuid.xlsx",
      "totalCost": 87450.25,
      "totalWeight": 36280.4,
      "totalPanelsArea": 12450.75,
      "itemCount": 48,
      "lineItemCount": 320
    }
  }
}
```

---

## `GET /api/admin/plant/projects/:leadId/consolidated-bom`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "consolidatedBOM": {
      "_id": "665a00000000000000000333",
      "leadId": "6a337c60edd83b0390b870c3",
      "status": "sent_to_vendor",
      "fileUrl": "https://bucket.s3.../consolidated/uuid.xlsx",
      "totalCost": 87450.25,
      "totalWeight": 36280.4,
      "totalPanelsArea": 12450.75,
      "itemCount": 48,
      "items": [
        {
          "_id": "665a00000000000000000555",
          "partCode": "C62514",
          "partColor": "RO",
          "description": "CEE Stud",
          "category": "Panels",
          "costUnit": "FT",
          "totalQty": 25,
          "totalLengthFeet": 174.48,
          "totalWeight": 621,
          "totalCost": 223.36,
          "buildings": [1],
          "markIds": ["S6-1"]
        }
      ],
      "sentToVendors": [
        {
          "_id": "665a00000000000000000666",
          "vendorId": "674abc1234567890abcdef01",
          "vendorName": "ABC Steel",
          "sentAt": "2026-06-03T06:00:00.000Z"
        }
      ],
      "createdAt": "2026-06-03T05:40:00.000Z",
      "updatedAt": "2026-06-03T06:00:00.000Z"
    }
  }
}
```

---

## `POST /api/admin/plant/projects/:leadId/consolidated-bom/send`

**Request body**

```json
{
  "vendorIds": ["674abc1234567890abcdef01", "674abc1234567890abcdef02"]
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Sent to 2 vendor(s).",
    "shipperRequests": [
      {
        "_id": "665a00000000000000000777",
        "vendorId": "674abc1234567890abcdef01",
        "vendorName": "ABC Steel",
        "status": "sent",
        "isNewRequest": true,
        "tokenReused": false
      },
      {
        "_id": "665a00000000000000000778",
        "vendorId": "674abc1234567890abcdef02",
        "vendorName": "XYZ Metals",
        "status": "sent",
        "isNewRequest": false,
        "tokenReused": true
      }
    ],
    "failures": []
  }
}
```

---

# Shipper quotation page APIs

Base: `/api/admin/plant/shipper-files` (alias: `/api/admin/plant/shipper-requests`)

---

## `GET /api/admin/plant/shipper-files/stats`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalFiles": 40,
    "filesReceived": 28,
    "ordersSent": 40,
    "revisionsSent": 3
  }
}
```

---

## `GET /api/admin/plant/shipper-files/projects`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "6a337c60edd83b0390b870c3",
        "projectId": "PRO-001",
        "jobId": "PRO-001",
        "projectName": "ABC Warehouse",
        "customerName": "John Smith",
        "buildingType": "Commercial",
        "location": "Austin, TX",
        "totalShipperFiles": 3,
        "receivedShipperFiles": 2,
        "fileReceivedStatus": "partial",
        "latestSubmittedAt": "2026-06-03T04:50:00.000Z"
      }
    ],
    "total": 1
  }
}
```

`fileReceivedStatus`: `none` | `partial` | `all`

---

## `GET /api/admin/plant/shipper-files/projects/:leadId/stats`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6a337c60edd83b0390b870c3",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "totalFiles": 3,
    "filesReceived": 2,
    "ordersSent": 3,
    "revisionsSent": 1
  }
}
```

---

## `GET /api/admin/plant/shipper-files/projects/:leadId/requests`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6a337c60edd83b0390b870c3",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "stats": {
      "totalFiles": 3,
      "filesReceived": 2,
      "ordersSent": 3,
      "revisionsSent": 1
    },
    "shipperRequests": [
      {
        "requestId": "665a00000000000000000777",
        "vendorId": "674abc1234567890abcdef01",
        "vendorName": "ABC Steel",
        "vendorCode": "VND-0001",
        "fileName": "ABC-Quote.pdf",
        "uploadedDate": "2026-06-03T04:50:00.000Z",
        "rates": 2100,
        "fileStatus": "submitted",
        "comparisonStatus": "completed",
        "resubmitCount": 0,
        "resubmitRequestedAt": null,
        "canRequestResubmit": true,
        "amountComparison": {
          "bomAmount": 87450.25,
          "shipperSubmittedAmount": 2100,
          "difference": -85350.25,
          "isMismatch": true,
          "canCompare": true
        }
      }
    ],
    "total": 1
  }
}
```

---

## `GET /api/admin/plant/shipper-files/:requestId/document`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "requestId": "665a00000000000000000777",
    "leadId": "6a337c60edd83b0390b870c3",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "vendorId": "674abc1234567890abcdef01",
    "vendorName": "ABC Steel",
    "vendorCode": "VND-0001",
    "fileName": "ABC-Quote.pdf",
    "fileUrl": "https://bucket.s3.../vendor-uploads/...pdf",
    "uploadedDate": "2026-06-03T04:50:00.000Z",
    "rates": 2100,
    "fileStatus": "submitted",
    "amountComparison": {
      "bomAmount": 87450.25,
      "shipperSubmittedAmount": 2100,
      "difference": -85350.25,
      "isMismatch": true,
      "canCompare": true
    }
  }
}
```

---

## `GET /api/admin/plant/projects/:leadId/shipper-files`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalFiles": 3,
      "filesReceived": 2,
      "ordersSent": 3,
      "revisionsSent": 1
    },
    "shipperFiles": [
      {
        "_id": "665a00000000000000000777",
        "vendorId": "674abc1234567890abcdef01",
        "vendorName": "ABC Steel",
        "status": "submitted",
        "submittedFileUrl": "https://bucket.s3.../vendor-uploads/...pdf",
        "submittedFileName": "ABC-Quote.pdf",
        "submittedAt": "2026-06-03T04:50:00.000Z",
        "quoteValue": 2100,
        "sentAt": "2026-06-03T04:00:00.000Z",
        "amountComparison": {
          "bomAmount": 87450.25,
          "shipperSubmittedAmount": 2100,
          "difference": -85350.25,
          "isMismatch": true,
          "canCompare": true
        }
      }
    ]
  }
}
```

---

## `POST /api/admin/plant/shipper-files/:requestId/compare`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Comparison job queued",
  "data": {
    "requestId": "665a00000000000000000777",
    "compareJobId": "665a00000000000000000888",
    "status": "queued",
    "message": "Comparison started. Poll compare job status until completed."
  }
}
```

---

## `GET /api/admin/plant/shipper-files/compare-jobs/:jobId/status`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "compareJobId": "665a00000000000000000888",
    "requestId": "665a00000000000000000777",
    "leadId": "6a337c60edd83b0390b870c3",
    "vendorId": "674abc1234567890abcdef01",
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
    "processingStartedAt": "2026-06-04T05:10:00.000Z",
    "processingEndedAt": "2026-06-04T05:10:45.000Z"
  }
}
```

---

## `POST /api/admin/plant/shipper-files/compare-jobs/status`

**Request body**

```json
{
  "jobIds": ["665a00000000000000000888"]
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "jobs": [
      {
        "compareJobId": "665a00000000000000000888",
        "requestId": "665a00000000000000000777",
        "status": "completed",
        "resultCount": 7,
        "errorMessage": null,
        "processingEndedAt": "2026-06-04T05:10:45.000Z"
      }
    ]
  }
}
```

---

## `GET /api/admin/plant/shipper-files/:requestId/comparison-summary`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "requestId": "665a00000000000000000777",
    "leadId": "6a337c60edd83b0390b870c3",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "vendorId": "674abc1234567890abcdef01",
    "vendorName": "ABC Steel",
    "vendorCode": "VND-0001",
    "status": "comparison_completed",
    "comparisonStatus": "completed",
    "comparisonRanAt": "2026-06-04T05:10:45.000Z",
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
    "stats": {
      "matched": { "count": 43 },
      "unmatched": { "count": 2 },
      "extra": { "count": 1 },
      "all": { "count": 46 },
      "unmatchedBreakdown": {
        "missing_in_vendor_quote": 2
      }
    },
    "exceptionsCount": 4,
    "resultCount": 6,
    "results": [
      {
        "resultId": "665a00000000000000000999",
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
    "blockers": ["missing_items", "qty_mismatch"],
    "resubmitAvailable": true,
    "resubmitCount": 0,
    "resubmitRequestedAt": null,
    "vendorExceptionSummary": null
  }
}
```

---

## `GET /api/admin/plant/shipper-files/:requestId/comparison-results`

**Query:** `page`, `limit`, `category=matched|unmatched|extra|all`, `status`, `severity`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "requestId": "665a00000000000000000777",
    "leadId": "6a337c60edd83b0390b870c3",
    "projectId": "PRO-001",
    "projectName": "ABC Warehouse",
    "vendorId": "674abc1234567890abcdef01",
    "vendorName": "ABC Steel",
    "vendorCode": "VND-0001",
    "status": "comparison_completed",
    "comparisonStatus": "completed",
    "category": "all",
    "filters": {
      "status": null,
      "severity": null,
      "category": "all"
    },
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 6,
      "pages": 1
    },
    "results": [
      {
        "resultId": "665a00000000000000000999",
        "status": "missing_in_vendor_quote",
        "severity": "critical",
        "expected": { "partCode": "C62514", "qty": 25 },
        "received": null,
        "difference": {},
        "matchMethod": "none",
        "reason": "Missing in vendor quote",
        "createdAt": "2026-06-04T05:10:01.000Z"
      }
    ]
  }
}
```

---

## `POST /api/admin/plant/shipper-files/:requestId/approve`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Vendor selection finalized",
  "data": {
    "requestId": "665a00000000000000000777",
    "status": "approved",
    "reviewedAt": "2026-06-04T04:45:00.000Z",
    "approvedVendor": {
      "vendorId": "674abc1234567890abcdef01",
      "vendorName": "ABC Steel"
    },
    "rejectedRequests": [
      {
        "requestId": "665a00000000000000000778",
        "vendorId": "674abc1234567890abcdef02",
        "vendorName": "XYZ Metals",
        "status": "rejected"
      }
    ],
    "emailFailures": []
  }
}
```

---

## `POST /api/admin/plant/shipper-files/:requestId/request-resubmit`

**Request body**

```json
{
  "note": "Please correct qty mismatch on C62514.",
  "includeComparisonExceptions": true
}
```

**Response**

```json
{
  "success": true,
  "message": "Resubmit requested with new upload link",
  "data": {
    "requestId": "665a00000000000000000777",
    "status": "resubmit_requested",
    "reviewedAt": "2026-06-04T04:50:00.000Z",
    "uploadUrl": "https://client.example.com/vendor-upload/abc123token",
    "priorToken": "abc123token",
    "token": "abc123token",
    "note": "Please correct qty mismatch on C62514.",
    "exceptionSummary": {
      "exceptionCount": 4,
      "blockers": ["missing_items"]
    },
    "emailFailures": []
  }
}
```

---

## `POST /api/admin/plant/shipper-files/:requestId/bundle-plan/generate`

**Request body:** none

**Response (201)**

```json
{
  "success": true,
  "message": "Bundle plan generated",
  "data": {
    "bundlePlan": {
      "_id": "674def1234567890abcdef02",
      "planNumber": "BP-0001",
      "status": "generated",
      "totalSourceItems": 47,
      "totalBundles": 12,
      "totalWeight": 38400,
      "maxLengthFeet": 48,
      "missingWeightItemCount": 0,
      "hasWeightWarning": false,
      "warnings": []
    },
    "bundles": [
      {
        "_id": "665a00000000000000001001",
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
}
```

---

# Load planning page APIs

Base: `/api/admin/plant/load-planning`, `/api/admin/plant/bundle-plans`, `/api/admin/plant/projects/:projectId/load-planning`

---

## `GET /api/admin/plant/load-planning/projects`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "6a337c60edd83b0390b870c3",
        "projectId": "PRO-019",
        "jobId": "PRO-019",
        "projectName": "ABC Warehouse",
        "customerName": "John Smith",
        "buildingType": "Commercial",
        "location": "Austin, TX",
        "bundlePlanId": "674def1234567890abcdef02",
        "fileReceivedAt": "2026-06-03T04:50:00.000Z",
        "totalBundles": 12,
        "totalLoads": 2,
        "status": "confirmed",
        "updatedAt": "2026-06-05T12:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

---

## `GET /api/admin/plant/bundle-plans/:bundlePlanId`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bundlePlan": {
      "_id": "674def1234567890abcdef02",
      "leadId": "6a337c60edd83b0390b870c3",
      "shipperRequestId": "665a00000000000000000777",
      "vendorId": "674abc1234567890abcdef01",
      "planNumber": "BP-0001",
      "status": "confirmed",
      "totalSourceItems": 47,
      "totalBundles": 12,
      "totalWeight": 38400,
      "maxLengthFeet": 48,
      "warnings": [],
      "notes": "",
      "generatedBy": "665a00000000000000000001",
      "confirmedBy": "665a00000000000000000001",
      "confirmedAt": "2026-06-05T11:00:00.000Z",
      "createdAt": "2026-06-05T10:00:00.000Z",
      "updatedAt": "2026-06-05T11:00:00.000Z"
    },
    "bundles": [
      {
        "_id": "665a00000000000000001001",
        "bundleNo": "B-001",
        "bundleType": "framing",
        "title": "FRAMING Bundle",
        "totalQty": 18,
        "totalWeight": 6200,
        "maxLengthFeet": 48,
        "itemCount": 6,
        "status": "assigned_to_truck",
        "packingListId": "665a00000000000000001101",
        "warnings": [],
        "loadSequence": 1
      }
    ],
    "summary": {
      "totalBundles": 12,
      "totalWeight": 38400,
      "maxLengthFeet": 48,
      "warnings": []
    }
  }
}
```

---

## `PUT /api/admin/plant/bundle-plans/:bundlePlanId`

**Request body**

```json
{
  "notes": "Checked by plant manager."
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "bundlePlan": {
      "_id": "674def1234567890abcdef02",
      "notes": "Checked by plant manager.",
      "updatedAt": "2026-06-05T12:30:00.000Z"
    }
  }
}
```

---

## `GET /api/admin/plant/bundle-plans/:bundlePlanId/coverage`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "rows": [
      {
        "vendorQuoteLineId": "665a00000000000000001201",
        "partCode": "PC16-RO-8X3.5",
        "description": "16Ga CEE Purlin Red Oxide",
        "expectedQty": 28,
        "assignedQty": 28,
        "diff": 0,
        "status": "exact"
      }
    ],
    "summary": {
      "totalVendorLines": 47,
      "exactCount": 47,
      "unassignedCount": 0,
      "overAssignedCount": 0,
      "canConfirm": true
    }
  }
}
```

---

## `POST /api/admin/plant/bundle-plans/:bundlePlanId/confirm`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Bundle plan confirmed",
  "data": {
    "bundlePlanId": "674def1234567890abcdef02",
    "status": "confirmed",
    "confirmedAt": "2026-06-05T11:00:00.000Z",
    "summary": {
      "totalVendorLines": 47,
      "exactCount": 47,
      "unassignedCount": 0,
      "overAssignedCount": 0,
      "canConfirm": true
    }
  }
}
```

---

## `POST /api/admin/plant/bundle-plans/:bundlePlanId/packing-list-plan/generate`

**Request body:** none

**Response (201)**

```json
{
  "success": true,
  "message": "Packing list plan generated",
  "data": {
    "packingListPlan": {
      "_id": "665a00000000000000001301",
      "planNumber": "PLP-0001",
      "status": "generated",
      "totalPackingLists": 2,
      "totalBundles": 18,
      "totalWeight": 62400,
      "maxLengthFeet": 51,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      },
      "missingWeightBundleCount": 0,
      "hasWeightWarning": false,
      "warnings": []
    },
    "packingLists": [
      {
        "_id": "665a00000000000000001101",
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
        "bundleIds": ["665a00000000000000001001"],
        "loadLayout": {
          "bottomLayerBundleIds": [],
          "middleLayerBundleIds": [],
          "topLayerBundleIds": [],
          "loadingNotes": ""
        },
        "hasWeightWarning": false,
        "warnings": [],
        "status": "draft"
      }
    ],
    "truckConfig": {
      "SEMI_53": {
        "truckType": "SEMI_53",
        "label": "53 ft Semi",
        "maxWeight": 45000,
        "hardMaxWeight": 48000,
        "maxLengthFeet": 53
      },
      "HOTSHOT_40": {
        "truckType": "HOTSHOT_40",
        "label": "40 ft Hot Shot",
        "maxWeight": 18000,
        "hardMaxWeight": 18000,
        "maxLengthFeet": 40
      }
    }
  }
}
```

---

## `GET /api/admin/plant/projects/:projectId/load-planning`

`projectId` = lead Mongo `_id` or `jobId` (e.g. `PRO-019`).

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "_id": "6a337c60edd83b0390b870c3",
      "projectId": "PRO-019",
      "projectName": "ABC Warehouse"
    },
    "bundlePlan": {
      "_id": "674def1234567890abcdef02",
      "planNumber": "BP-0001",
      "status": "confirmed"
    },
    "bundles": [
      {
        "_id": "665a00000000000000001001",
        "bundleNo": "B-001",
        "status": "assigned_to_truck",
        "loadSequence": 1
      }
    ],
    "bundleSummary": {
      "totalBundles": 12,
      "totalWeight": 38400,
      "maxLengthFeet": 48,
      "warnings": []
    },
    "packingListPlan": {
      "_id": "665a00000000000000001301",
      "planNumber": "PLP-0001",
      "status": "generated"
    },
    "packingLists": [
      {
        "_id": "665a00000000000000001101",
        "packingListNo": "PL-001",
        "truckType": "SEMI_53",
        "status": "draft"
      }
    ]
  }
}
```

---

## `PUT /api/admin/plant/projects/:projectId/load-planning`

**Request body (all optional)**

```json
{
  "bundlePlanNotes": "Reviewed by planner",
  "packingListPlanNotes": "Check loading order with site team",
  "bundleUpdates": [
    {
      "bundleId": "665a00000000000000001001",
      "loadSequence": 1,
      "notes": "Load first",
      "handlingInstruction": "Keep dry"
    }
  ],
  "packingListUpdates": [
    {
      "packingListId": "665a00000000000000001101",
      "notes": "Use forklift at dock 2",
      "loadingNotes": "Panels top layer only"
    }
  ]
}
```

**Response**

```json
{
  "success": true,
  "message": "Project load planning updated",
  "data": {
    "bundlePlan": {
      "_id": "674def1234567890abcdef02",
      "notes": "Reviewed by planner"
    },
    "bundles": [
      {
        "_id": "665a00000000000000001001",
        "bundleNo": "B-001",
        "loadSequence": 1
      }
    ],
    "packingListPlan": {
      "_id": "665a00000000000000001301",
      "notes": "Check loading order with site team"
    },
    "packingLists": [
      {
        "_id": "665a00000000000000001101",
        "packingListNo": "PL-001"
      }
    ]
  }
}
```

---

# Packing list page APIs

Base: `/api/admin/plant/packing-lists`, `/api/admin/plant/packing-list-plans`, `/api/admin/plant/projects/:projectId/load-planning/truck-plan`

---

## `GET /api/admin/plant/packing-lists/projects`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "6a337c60edd83b0390b870c3",
        "projectId": "PRO-019",
        "jobId": "PRO-019",
        "projectName": "ABC Warehouse",
        "customerName": "John Smith",
        "buildingType": "Commercial",
        "location": "Austin, TX",
        "packingListPlanId": "665a00000000000000001301",
        "listGeneratedAt": "2026-06-05T12:00:00.000Z",
        "totalPackingList": 2,
        "status": "generated",
        "updatedAt": "2026-06-05T12:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

---

## `GET /api/admin/plant/packing-list-plans/:packingListPlanId`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "_id": "6a337c60edd83b0390b870c3",
      "leadId": "6a337c60edd83b0390b870c3",
      "projectId": "PRO-019",
      "jobId": "PRO-019",
      "projectName": "ABC Warehouse",
      "buildingType": "Commercial",
      "location": "Austin, TX",
      "lifecycleStatus": "packing_bundling",
      "customer": {
        "_id": "665a00000000000000000010",
        "customerId": "CUST-001",
        "name": "John Smith",
        "email": "john@example.com"
      }
    },
    "packingListPlan": {
      "_id": "665a00000000000000001301",
      "leadId": "6a337c60edd83b0390b870c3",
      "bundlePlanId": "674def1234567890abcdef02",
      "planNumber": "PLP-0001",
      "status": "generated",
      "totalPackingLists": 2,
      "totalBundles": 18,
      "totalWeight": 62400,
      "maxLengthFeet": 51,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      },
      "warnings": []
    },
    "packingLists": [
      {
        "_id": "665a00000000000000001101",
        "packingListNo": "PL-001",
        "truckNo": "TRUCK-1",
        "truckType": "SEMI_53",
        "truckLabel": "53 ft Semi",
        "totalWeight": 44200,
        "totalBundles": 12,
        "status": "draft",
        "bundleIds": ["665a00000000000000001001"]
      }
    ],
    "bundles": [
      {
        "_id": "665a00000000000000001001",
        "bundleNo": "B-001",
        "bundleType": "framing",
        "title": "FRAMING Bundle",
        "status": "assigned_to_truck",
        "packingListId": "665a00000000000000001101",
        "totalQty": 18,
        "totalWeight": 6200,
        "maxLengthFeet": 48,
        "loadSequence": 1,
        "warnings": []
      }
    ],
    "summary": {
      "totalWeight": 62400,
      "totalBundles": 18,
      "totalPackingLists": 2,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      },
      "warnings": []
    }
  }
}
```

---

## `POST /api/admin/plant/packing-list-plans/:packingListPlanId/confirm`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Packing list plan confirmed",
  "data": {
    "packingListPlanId": "665a00000000000000001301",
    "status": "confirmed",
    "confirmedAt": "2026-06-05T14:00:00.000Z",
    "summary": {
      "totalWeight": 62400,
      "totalBundles": 18,
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      }
    }
  }
}
```

---

## `GET /api/admin/plant/packing-lists/:packingListId`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "packingList": {
      "_id": "665a00000000000000001101",
      "packingListPlanId": "665a00000000000000001301",
      "bundlePlanId": "674def1234567890abcdef02",
      "leadId": "6a337c60edd83b0390b870c3",
      "packingListNo": "PL-001",
      "truckNo": "TRUCK-1",
      "truckType": "SEMI_53",
      "truckLabel": "53 ft Semi",
      "totalBundles": 12,
      "totalItems": 68,
      "totalWeight": 44200,
      "maxLengthFeet": 51,
      "bundleIds": ["665a00000000000000001001"],
      "loadLayout": {
        "bottomLayerBundleIds": [],
        "middleLayerBundleIds": [],
        "topLayerBundleIds": [],
        "loadingNotes": ""
      },
      "warnings": [],
      "status": "draft",
      "notes": ""
    },
    "truckInfo": {
      "truckType": "SEMI_53",
      "truckLabel": "53 ft Semi",
      "totalWeight": 44200,
      "maxTruckWeight": 45000,
      "hardMaxTruckWeight": 48000,
      "maxTruckLengthFeet": 53
    },
    "bundles": [
      {
        "_id": "665a00000000000000001001",
        "bundleNo": "B-001",
        "bundleType": "framing",
        "title": "FRAMING Bundle",
        "totalQty": 18,
        "totalWeight": 6200,
        "maxLengthFeet": 48,
        "loadSequence": 1,
        "warnings": []
      }
    ],
    "loadLayout": {
      "bottomLayerBundleIds": [],
      "middleLayerBundleIds": [],
      "topLayerBundleIds": [],
      "loadingNotes": ""
    },
    "planStatus": "generated"
  }
}
```

---

## `PUT /api/admin/plant/packing-lists/:packingListId`

**Request body (all optional)**

```json
{
  "truckType": "SEMI_53",
  "bundleIds": ["665a00000000000000001001", "665a00000000000000001002"],
  "loadLayout": {
    "bottomLayerBundleIds": ["665a00000000000000001001"],
    "middleLayerBundleIds": [],
    "topLayerBundleIds": ["665a00000000000000001002"],
    "loadingNotes": "Panels on top only"
  },
  "loadingNotes": "Panels on top only",
  "overrideReason": "Site requires revised stack",
  "notes": "Call 30 mins before arrival"
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "packingList": {
      "_id": "665a00000000000000001101",
      "packingListPlanId": "665a00000000000000001301",
      "bundlePlanId": "674def1234567890abcdef02",
      "leadId": "6a337c60edd83b0390b870c3",
      "shipperRequestId": "665a00000000000000000777",
      "packingListNo": "PL-001",
      "truckNo": "TRUCK-1",
      "truckType": "SEMI_53",
      "truckLabel": "53 ft Semi",
      "maxTruckWeight": 45000,
      "hardMaxTruckWeight": 48000,
      "maxTruckLengthFeet": 53,
      "bundleIds": [
        "665a00000000000000001001",
        "665a00000000000000001002"
      ],
      "totalBundles": 2,
      "totalItems": 14,
      "totalWeight": 12400,
      "maxLengthFeet": 48,
      "loadLayout": {
        "bottomLayerBundleIds": ["665a00000000000000001001"],
        "middleLayerBundleIds": [],
        "topLayerBundleIds": ["665a00000000000000001002"],
        "loadingNotes": "Panels on top only"
      },
      "warnings": [],
      "overrideReason": "Site requires revised stack",
      "status": "draft",
      "notes": "Call 30 mins before arrival",
      "createdAt": "2026-06-05T10:00:00.000Z",
      "updatedAt": "2026-06-05T12:45:00.000Z"
    },
    "packingListPlanSummary": {
      "totalPackingLists": 2,
      "totalBundles": 18,
      "totalWeight": 62400,
      "maxLengthFeet": 51,
      "warnings": [],
      "truckSummary": {
        "semi53Count": 1,
        "hotshot40Count": 1,
        "totalTrucks": 2
      }
    }
  }
}
```

`packingList` is the full saved Mongo document (`.lean()`), including `createdAt` / `updatedAt`.

---

# Vendor (shipper) management APIs

Base: `/api/admin/plant/vendors`

Same handlers as `/api/plant/vendors`. Vendor master data is **global** (not scoped by assigned plant user).

---

## `GET /api/admin/plant/vendors`

**Query (optional):** `search`, `materialType`, `status` (`active` | `inactive`), `page` (default `1`), `limit` (default `20`, max `200`)

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendors": [
      {
        "_id": "674abc1234567890abcdef01",
        "vendorCode": "VND-001",
        "vendorName": "ABC Steel",
        "contactName": "Jane Doe",
        "email": "quotes@abcsteel.com",
        "phone": "+1-555-0100",
        "materialTypes": ["steel", "panels"],
        "vendorType": "steel",
        "status": "active",
        "pickupLocation": "Houston, TX",
        "activeOrders": 2,
        "totalOrders": 8
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

---

## `POST /api/admin/plant/vendors`

**Request body**

```json
{
  "vendorName": "ABC Steel",
  "email": "quotes@abcsteel.com",
  "phone": "+1-555-0100",
  "contactName": "Jane Doe",
  "vendorCode": "VND-001",
  "yearsWithCompany": 5,
  "serviceCategory": "Structural steel",
  "vendorType": "steel",
  "materialTypes": ["steel", "panels"],
  "address": {
    "placeNumber": "1200",
    "streetAddress": "Industrial Blvd",
    "city": "Houston",
    "state": "TX",
    "postalCode": "77001",
    "gpsCoordinates": { "lat": 29.7604, "lng": -95.3698 }
  },
  "documents": [
    { "name": "W9", "url": "https://bucket.s3.../vendors/w9.pdf" }
  ],
  "internalNotes": "Preferred for TX projects"
}
```

`vendorCode` is optional — auto-generated when omitted.

**Response (201)**

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "vendor": {
      "_id": "674abc1234567890abcdef01",
      "vendorCode": "VND-001",
      "vendorName": "ABC Steel",
      "contactName": "Jane Doe",
      "email": "quotes@abcsteel.com",
      "phone": "+1-555-0100",
      "yearsWithCompany": 5,
      "serviceCategory": "Structural steel",
      "vendorType": "steel",
      "materialTypes": ["steel", "panels"],
      "address": {
        "placeNumber": "1200",
        "streetAddress": "Industrial Blvd",
        "landmark": "",
        "city": "Houston",
        "state": "TX",
        "postalCode": "77001",
        "gpsCoordinates": { "lat": 29.7604, "lng": -95.3698 }
      },
      "documents": [
        { "name": "W9", "url": "https://bucket.s3.../vendors/w9.pdf" }
      ],
      "internalNotes": "Preferred for TX projects",
      "status": "active",
      "createdAt": "2026-06-24T10:00:00.000Z",
      "updatedAt": "2026-06-24T10:00:00.000Z"
    }
  }
}
```

---

## `GET /api/admin/plant/vendors/:vendorId`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "674abc1234567890abcdef01",
      "vendorCode": "VND-001",
      "vendorName": "ABC Steel",
      "contactName": "Jane Doe",
      "email": "quotes@abcsteel.com",
      "phone": "+1-555-0100",
      "yearsWithCompany": 5,
      "serviceCategory": "Structural steel",
      "vendorType": "steel",
      "materialTypes": ["steel", "panels"],
      "address": {
        "placeNumber": "1200",
        "streetAddress": "Industrial Blvd",
        "landmark": "",
        "city": "Houston",
        "state": "TX",
        "postalCode": "77001",
        "gpsCoordinates": { "lat": 29.7604, "lng": -95.3698 }
      },
      "documents": [],
      "internalNotes": "",
      "status": "active",
      "pickupLocation": "Houston, TX",
      "createdAt": "2026-06-01T08:00:00.000Z",
      "updatedAt": "2026-06-24T10:00:00.000Z"
    },
    "stats": {
      "totalOrders": 8,
      "completedDeliveries": 3,
      "activeOrders": 2,
      "bidsSubmitted": 6,
      "bidsSent": 8
    },
    "orderHistory": [
      {
        "_id": "665a00000000000000000777",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "quoteValue": 87450.25,
        "status": "approved",
        "submittedAt": "2026-06-03T04:50:00.000Z",
        "reviewedAt": "2026-06-04T04:45:00.000Z",
        "sentAt": "2026-06-03T04:00:00.000Z"
      }
    ]
  }
}
```

---

## `PUT /api/admin/plant/vendors/:vendorId`

**Request body (all optional except at least one field should be sent)**

```json
{
  "vendorName": "ABC Steel LLC",
  "email": "newquotes@abcsteel.com",
  "phone": "+1-555-0101",
  "contactName": "John Smith",
  "vendorCode": "VND-001",
  "yearsWithCompany": 6,
  "serviceCategory": "Steel & panels",
  "vendorType": "steel",
  "materialTypes": ["steel", "panels", "trim"],
  "address": {
    "city": "Dallas",
    "state": "TX"
  },
  "documents": [],
  "internalNotes": "Updated contact",
  "status": "active"
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "674abc1234567890abcdef01",
      "vendorCode": "VND-001",
      "vendorName": "ABC Steel LLC",
      "status": "active"
    }
  }
}
```

Returns the full updated `vendor` Mongo document.

---

## `PATCH /api/admin/plant/vendors/:vendorId/toggle-status`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "674abc1234567890abcdef01",
      "status": "inactive"
    }
  }
}
```

Toggles between `active` and `inactive`.

---

# Carrier management APIs

Base: `/api/admin/plant/carriers`

Same handlers as `/api/plant/carriers`. Carrier master data is **global**.

---

## `GET /api/admin/plant/carriers`

**Query (optional):** `search`, `serviceType`, `serviceArea`, `equipmentType`, `status` (`active` | `inactive`), `page`, `limit`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carriers": [
      {
        "_id": "674abc1234567890abcdef11",
        "carrierCode": "CAR-001",
        "carrierName": "FastFreight Logistics",
        "contactName": "Mike Carrier",
        "email": "dispatch@fastfreight.com",
        "phone": "+1-555-0200",
        "serviceType": "Flatbed",
        "serviceArea": "Southwest US",
        "equipmentTypes": ["53ft Flatbed", "Hotshot"],
        "status": "active",
        "activeBids": 1,
        "totalBids": 12,
        "awardedBidCount": 4,
        "bidWinRate": 33.3,
        "avgBid": 2850.5
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

---

## `POST /api/admin/plant/carriers`

**Request body**

```json
{
  "carrierName": "FastFreight Logistics",
  "email": "dispatch@fastfreight.com",
  "phone": "+1-555-0200",
  "contactName": "Mike Carrier",
  "carrierCode": "CAR-001",
  "serviceType": "Flatbed",
  "serviceArea": "Southwest US",
  "address": {
    "streetAddress": "500 Freight Way",
    "city": "Phoenix",
    "state": "AZ",
    "postalCode": "85001"
  },
  "fleetEquipment": [
    { "equipmentName": "53ft Flatbed", "quantity": 8 },
    { "equipmentName": "Hotshot", "quantity": 2 }
  ],
  "fleetCapacity": {
    "totalVehicleCount": 10,
    "maximumLoadCapacity": 48000,
    "averageFleetAge": 4.5
  },
  "documents": [],
  "internalNotes": ""
}
```

**Response (201)**

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "carrier": {
      "_id": "674abc1234567890abcdef11",
      "carrierCode": "CAR-001",
      "carrierName": "FastFreight Logistics",
      "contactName": "Mike Carrier",
      "email": "dispatch@fastfreight.com",
      "phone": "+1-555-0200",
      "serviceType": "Flatbed",
      "serviceArea": "Southwest US",
      "address": {
        "placeNumber": "",
        "streetAddress": "500 Freight Way",
        "landmark": "",
        "city": "Phoenix",
        "state": "AZ",
        "postalCode": "85001",
        "gpsCoordinates": { "lat": null, "lng": null }
      },
      "fleetEquipment": [
        { "equipmentName": "53ft Flatbed", "quantity": 8 },
        { "equipmentName": "Hotshot", "quantity": 2 }
      ],
      "fleetCapacity": {
        "totalVehicleCount": 10,
        "maximumLoadCapacity": 48000,
        "averageFleetAge": 4.5
      },
      "documents": [],
      "internalNotes": "",
      "status": "active",
      "createdAt": "2026-06-24T10:00:00.000Z",
      "updatedAt": "2026-06-24T10:00:00.000Z"
    }
  }
}
```

---

## `GET /api/admin/plant/carriers/:carrierId`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrier": {
      "_id": "674abc1234567890abcdef11",
      "carrierCode": "CAR-001",
      "carrierName": "FastFreight Logistics",
      "contactName": "Mike Carrier",
      "email": "dispatch@fastfreight.com",
      "phone": "+1-555-0200",
      "serviceType": "Flatbed",
      "serviceArea": "Southwest US",
      "fleetEquipment": [
        { "equipmentName": "53ft Flatbed", "quantity": 8 }
      ],
      "fleetCapacity": {
        "totalVehicleCount": 10,
        "maximumLoadCapacity": 48000,
        "averageFleetAge": 4.5
      },
      "equipmentTypes": ["53ft Flatbed"],
      "status": "active"
    },
    "stats": {
      "totalBids": 12,
      "activeBids": 1,
      "awardedBidCount": 4,
      "bidWinRate": 33.3,
      "avgBid": 2850.5,
      "lastAwardedDate": "2026-06-20T14:00:00.000Z",
      "avgResponseTimeHours": 18.5,
      "assignedProjects": 3
    },
    "freightHistory": [
      {
        "_id": "665a00000000000000002001",
        "deliveryNumber": "DEL-0012",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "status": "selected",
        "quotedAmount": 3200,
        "currency": "USD",
        "sentAt": "2026-06-18T09:00:00.000Z",
        "submittedAt": "2026-06-18T15:30:00.000Z",
        "selectedAt": "2026-06-20T14:00:00.000Z",
        "pickupLocation": "Plant Yard, Houston TX",
        "deliveryLocation": "123 Site Rd, Austin, TX"
      }
    ]
  }
}
```

---

## `PUT /api/admin/plant/carriers/:carrierId`

**Request body (all optional)**

```json
{
  "carrierName": "FastFreight Logistics Inc",
  "email": "ops@fastfreight.com",
  "serviceType": "Flatbed & Hotshot",
  "serviceArea": "US Southwest",
  "fleetEquipment": [
    { "equipmentName": "53ft Flatbed", "quantity": 10 }
  ],
  "status": "active"
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrier": {
      "_id": "674abc1234567890abcdef11",
      "carrierCode": "CAR-001",
      "carrierName": "FastFreight Logistics Inc",
      "status": "active"
    }
  }
}
```

Returns the full updated `carrier` Mongo document.

---

## `PATCH /api/admin/plant/carriers/:carrierId/toggle-status`

**Request body:** none

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrier": {
      "_id": "674abc1234567890abcdef11",
      "status": "inactive"
    }
  }
}
```

---

# Costing management (SMDT) APIs

Base: `/api/admin/plant/smdt`

Same handlers as `/api/smdt` (shared with plant). Operates on the **active** SMDT cost version. Global data — not scoped by plant assignment.

**Upload flow:** presign via `POST /api/upload/presigned-url` with `folder: "smdt"`, then `POST /api/admin/plant/smdt/upload`.

---

## `GET /api/admin/plant/smdt/stats`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "activeVersion": {
      "_id": "665a00000000000000003001",
      "name": "June 2026 Cost List",
      "effectiveDate": "2026-06-01T00:00:00.000Z",
      "uploadedAt": "2026-06-01T12:00:00.000Z",
      "isActive": true
    },
    "totalItems": 1240,
    "totalItemCost": 458920.75,
    "newlyAdded": 45,
    "lastImportInserted": 1200,
    "lastImportUpdated": 40
  }
}
```

When no active version exists, `activeVersion` is `null` and counts are `0`.

---

## `GET /api/admin/plant/smdt`

**Query (optional):** `category`, `isFrameType` (`true` | `false`), `isActive` (`true` | `false` | `all`, default active only), `search`, `page`, `limit`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "activeVersion": {
      "_id": "665a00000000000000003001",
      "name": "June 2026 Cost List",
      "effectiveDate": "2026-06-01T00:00:00.000Z",
      "uploadedAt": "2026-06-01T12:00:00.000Z",
      "isActive": true
    },
    "items": [
      {
        "_id": "665a00000000000000003101",
        "costVersionId": "665a00000000000000003001",
        "category": "Panels",
        "partName": "C62514",
        "partNameNormalized": "C62514",
        "partColor": "RO",
        "partColorNormalized": "RO",
        "costUnit": "FT",
        "mbsCost": 1.28,
        "currentMarketCost": null,
        "laborCost": 0,
        "additionalCost": 0,
        "materialCost": 0,
        "isFrameType": false,
        "isActive": true,
        "description": "",
        "createdAt": "2026-06-01T12:05:00.000Z",
        "updatedAt": "2026-06-01T12:05:00.000Z"
      }
    ],
    "total": 1240,
    "page": 1,
    "limit": 50,
    "categories": [
      "Insulation", "Joist", "Panels", "TRIM", "Mastic", "Screws",
      "ABolts", "CLIPS", "Cable", "Flange_Brace", "Jambs", "DCOL",
      "ZGIRT", "OPEN CHANNEL", "EaveStruts", "ACCESSORIES", "SKTLIGHT",
      "ANGL1", "TS_PANEL", "frames"
    ]
  }
}
```

---

## `GET /api/admin/plant/smdt/:itemId`

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "item": {
      "_id": "665a00000000000000003101",
      "costVersionId": {
        "_id": "665a00000000000000003001",
        "name": "June 2026 Cost List",
        "isActive": true,
        "effectiveDate": "2026-06-01T00:00:00.000Z"
      },
      "category": "Panels",
      "partName": "C62514",
      "partColor": "RO",
      "costUnit": "FT",
      "mbsCost": 1.28,
      "currentMarketCost": null,
      "laborCost": 0,
      "additionalCost": 0,
      "materialCost": 0,
      "isFrameType": false,
      "isActive": true,
      "description": "",
      "addedBy": {
        "_id": "665a00000000000000000001",
        "name": "Admin User",
        "email": "admin@example.com"
      },
      "lastUpdatedBy": null,
      "createdAt": "2026-06-01T12:05:00.000Z",
      "updatedAt": "2026-06-01T12:05:00.000Z"
    }
  }
}
```

---

## `POST /api/admin/plant/smdt/upload`

**Request body**

```json
{
  "fileUrl": "https://bucket.s3.../smdt/cost-list-june.xlsx",
  "fileName": "cost-list-june.xlsx",
  "name": "June 2026 Cost List",
  "effectiveDate": "2026-06-01T00:00:00.000Z",
  "activate": true
}
```

**Response**

```json
{
  "success": true,
  "message": "SMDT imported",
  "data": {
    "costVersionId": "665a00000000000000003001",
    "isActive": true,
    "inserted": 1200,
    "updated": 40,
    "skipped": 3,
    "total": 1240,
    "sheets": ["Panels", "TRIM", "Insulation"]
  }
}
```

---

## `POST /api/admin/plant/smdt`

Add a single item to the **active** cost version.

**Request body**

```json
{
  "category": "Panels",
  "partName": "C62514",
  "partColor": "RO",
  "costUnit": "FT",
  "mbsCost": 1.28,
  "currentMarketCost": 1.35,
  "laborCost": 0,
  "additionalCost": 0,
  "materialCost": 0,
  "description": "Red oxide purlin"
}
```

**Response (201)**

```json
{
  "success": true,
  "message": "SMDT item added",
  "data": {
    "item": {
      "_id": "665a00000000000000003101",
      "costVersionId": "665a00000000000000003001",
      "category": "Panels",
      "partName": "C62514",
      "partColor": "RO",
      "costUnit": "FT",
      "mbsCost": 1.28,
      "currentMarketCost": 1.35,
      "isFrameType": false,
      "isActive": true
    }
  }
}
```

---

## `PUT /api/admin/plant/smdt/:itemId`

**Request body (at least one field required)**

```json
{
  "mbsCost": 1.32,
  "currentMarketCost": 1.38,
  "costUnit": "FT",
  "laborCost": 0,
  "additionalCost": 0,
  "materialCost": 0,
  "extraMinCost": null,
  "extraMaxCost": null,
  "description": "Updated price",
  "isActive": true
}
```

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "item": {
      "_id": "665a00000000000000003101",
      "mbsCost": 1.32,
      "currentMarketCost": 1.38,
      "costUnit": "FT",
      "isActive": true
    }
  }
}
```

Returns the full updated `item` Mongo document.

---

## `DELETE /api/admin/plant/smdt/:itemId`

Soft-deactivates the item (`isActive: false`).

**Response**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Item deactivated",
    "itemId": "665a00000000000000003101"
  }
}
```

---

## `GET /api/admin/plant/smdt/export/excel`

**Query (optional):** same filters as list (`category`, `isFrameType`, `isActive`, `search`)

**Response:** binary Excel file (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, filename `smdt-cost-list.xlsx`). Not JSON.

---

## Screen → API mapping

| Admin screen | Primary APIs |
|--------------|--------------|
| Dashboard KPI cards | `GET /dashboard/order-progress-review`, `load-planning-status`, `shipper-quotation-summary`, etc. |
| Upcoming shipments table | `GET /dashboard/upcoming-shipments` |
| BOM list + stats | `GET /bom/stats`, `GET /bom/projects` |
| BOM detail / pricing | `GET /bom/:jobId`, `PUT /bom/items/:id/price`, `POST /bom/buildings/:id/confirm` |
| Consolidated BOM | `GET/POST /projects/:leadId/consolidated-bom/*` |
| Shipper list + stats | `GET /shipper-files/stats`, `GET /shipper-files/projects` |
| Shipper detail / compare | `GET /shipper-files/projects/:leadId/requests`, comparison + approve endpoints |
| Load planning list | `GET /load-planning/projects` |
| Load planning detail | `GET /projects/:projectId/load-planning`, `GET /bundle-plans/:id` |
| Packing list list | `GET /packing-lists/projects` |
| Packing list detail | `GET /packing-list-plans/:id`, `GET /packing-lists/:id`, confirm endpoints |
| Vendor management | `GET/POST/PUT/PATCH /vendors`, `GET /vendors/:id` |
| Carrier management | `GET/POST/PUT/PATCH /carriers`, `GET /carriers/:id` |
| Costing (SMDT) | `GET/POST/PUT/DELETE /smdt`, `POST /smdt/upload`, `GET /smdt/stats`, `GET /smdt/export/excel` |

---

## Implementation files

| Layer | Path |
|-------|------|
| Admin plant mount | `src/routes/admin/plant/index.js` |
| Dashboard KPIs | `src/routes/admin/plant/dashboard.routes.js` |
| Page routes | `src/routes/admin/plant/bom.routes.js`, `shipper.routes.js`, `loadPlanning.routes.js`, `bundlePlan.routes.js`, `packingList.routes.js`, `packingListPlan.routes.js`, `projectOps.routes.js`, `vendor.routes.js`, `carrier.routes.js`, `smdt.routes.js` |
| Shared controllers | `src/controllers/plant/*.controller.js`, `src/controllers/common/smdt.controller.js` |
| Dashboard service | `src/services/admin/plantDashboard.service.js` |
| Admin scope middleware | `src/middleware/adminPlantScope.js` |
| Scope helpers | `src/utils/plantAccessScope.js`, `src/utils/plantProjectAccess.js` |
