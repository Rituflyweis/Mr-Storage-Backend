# Backend API updates — June 20, 2026

Frontend integration log for changes shipped in this session.

**Base URL:** `https://flyweistechnology.com/api`

**Auth:** Standard JWT (`Authorization: Bearer <token>`) unless noted as Public.

---

## Table of contents

1. [Freight bid resubmit — requested amount fix](#1-freight-bid-resubmit--requested-amount-fix)
2. [Sales building sync — increase & reduce](#2-sales-building-sync--increase--reduce)
3. [Admin escalations — response shape & user details](#3-admin-escalations--response-shape--user-details)
4. [Shipper files — BOM vs submitted amount comparison](#4-shipper-files--bom-vs-submitted-amount-comparison)
5. [Files changed](#5-files-changed)
6. [Frontend checklist](#6-frontend-checklist)

---

## 1. Freight bid resubmit — requested amount fix

### Problem

`POST /api/plant/freight-bids/:bidId/request-resubmit` accepted `bidAmount` but did **not** save it or include it in the carrier email. `requestedBidAmount` was always `null` and the email showed **N/A**.

### Fix

- `bidAmount` (or alias `requestedBidAmount`) is saved on the bid as `resubmitRequestedAmount`
- Carrier resubmit email includes **Requested bid amount**
- API response returns `requestedBidAmount`

### Endpoint

| Method | Path | Role |
|--------|------|------|
| POST | `/api/plant/freight-bids/:bidId/request-resubmit` | `plant` |

### Request body

```json
{
  "note": "Please revise — pickup window moved to next week.",
  "bidAmount": 6000
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `note` | Yes | Plant message to carrier |
| `bidAmount` | No | Target/counter-offer amount (USD). Alias: `requestedBidAmount` |

### Response `data`

```json
{
  "bidId": "6a328001a2982523aa1e91bd",
  "status": "resubmit_requested",
  "resubmitCount": 1,
  "resubmitRequestedAt": "2026-06-20T10:00:00.000Z",
  "note": "Please revise — pickup window moved to next week.",
  "resubmitNote": "Please revise — pickup window moved to next week.",
  "plantNote": "Please revise — pickup window moved to next week.",
  "priorQuotedAmount": 10000,
  "requestedBidAmount": 6000,
  "expiresAt": "2026-06-27T10:00:00.000Z",
  "emailFailures": []
}
```

### Carrier email

Template: `carrier-freight-bid-resubmit.html`

| Line | Example |
|------|---------|
| Previous bid amount | `10,000.00` |
| **Requested bid amount** | `6,000.00` (was N/A before fix) |

### Public carrier page

`GET /api/public/freight-bids/:token` returns `requestedBidAmount` while status is `resubmit_requested`.

### FE notes

- Send `bidAmount` from plant revision modal
- Show `requestedBidAmount` on bid row while waiting for carrier resubmit
- After carrier resubmits, `requestedBidAmount` is cleared and `quotedAmount` is updated

---

## 2. Sales building sync — increase & reduce

### Problem

`POST /api/sales/leads/:leadId/buildings` was **additive only**. Setting `numberOfBuildings` from 3 → 1 did not remove buildings 2 and 3.

### Fix

`syncLeadBuildings` now fully syncs building count:

| Action | Behavior |
|--------|----------|
| **Increase** (1 → 3) | Creates missing buildings 2, 3 |
| **Decrease** (3 → 1) | Deletes buildings with `buildingNumber > targetCount` |
| **On delete** | Cascade removes `BOMJob` + `BOMItem` for removed buildings |
| **Consolidated BOM** | If exists → `status` reset to `draft` (`consolidatedBomInvalidated: true`) |
| **Lead** | `numberOfBuildings` set to requested count (not `max` of old count) |

Also applies when `numberOfBuildings` is updated via `PUT /api/sales/leads/:leadId`.

### Endpoint (unchanged path)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/sales/leads/:leadId/buildings` | `sales` |

### Request

```json
{
  "numberOfBuildings": 1
}
```

### Response `data` — decrease example (3 → 1)

```json
{
  "buildings": [
    {
      "_id": "...",
      "leadId": "...",
      "buildingNumber": 1,
      "status": "bom_confirmed",
      "drawings": []
    }
  ],
  "numberOfBuildings": 1,
  "createdCount": 0,
  "createdBuildingNumbers": [],
  "removedCount": 2,
  "removedBuildingNumbers": [3, 2],
  "removedBomJobCount": 2,
  "consolidatedBomInvalidated": true
}
```

### Response `data` — increase example (1 → 3)

```json
{
  "buildings": [ ... ],
  "numberOfBuildings": 3,
  "createdCount": 2,
  "createdBuildingNumbers": [2, 3],
  "removedCount": 0,
  "removedBuildingNumbers": [],
  "removedBomJobCount": 0,
  "consolidatedBomInvalidated": false
}
```

### HTTP status

| Case | Status |
|------|--------|
| Only buildings added | `201 Created` |
| Buildings removed or no change | `200 OK` |

### After consolidated BOM + building change

| Scenario | What to do |
|----------|------------|
| Reduced buildings after consolidate | Regenerate: `POST /api/plant/projects/:leadId/consolidated-bom/generate` |
| Increased buildings | Upload + confirm BOM per new building, then regenerate consolidate |
| Consolidate gate | All **remaining** buildings must have confirmed latest BOM |

### FE notes

- Confirm modal before reduce: warns that extra buildings, BOM data, and consolidated BOM will be invalidated
- Re-use same `POST .../buildings` call for both increase and decrease
- No new plant-only building-count endpoint

---

## 3. Admin escalations — response shape & user details

### Problem

`GET /api/admin/escalations` was updated to return `data.leads[]` but was missing full customer details, escalated-by, and resolve/assign user objects.

### Fix

Shared mapper `src/utils/escalationLeadRow.js` now returns full lead-centric rows with populated user and customer objects. Resolve/assign endpoints return the same mapped shape.

### Endpoints

| Method | Path | Role |
|--------|------|------|
| GET | `/api/admin/escalations` | `admin` |
| PUT | `/api/admin/escalations/:escalationId/resolve` | `admin` |
| PUT | `/api/admin/escalations/:escalationId/assign` | `admin` |

### Query params (GET — unchanged)

| Param | Notes |
|-------|-------|
| `status` | `pending` \| `resolved` |
| `assignedSales` | Filter by lead’s assigned sales user id |
| `startDate` / `endDate` | Escalation `createdAt` range |
| `page` / `limit` | Pagination (default 1 / 20) |

### Breaking change

| Before | After |
|--------|-------|
| `data.escalations[]` | `data.leads[]` |
| Raw escalation docs | Mapped lead rows with nested `escalation` |

### GET response — pending row (full example)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "674abc111111111111111111",
        "projectId": "PRO-080",
        "jobId": "PRO-080",
        "projectName": "Anshika Warehouse LLC",
        "lifecycleStatus": "quotation_sent",
        "quoteValue": 125000,
        "customerName": "Jane Smith",
        "buildingType": "Warehouse",
        "location": "Dallas, TX",
        "customerId": {
          "_id": "674def222222222222222222",
          "customerId": "CUS-0042",
          "firstName": "Jane",
          "lastName": "Smith",
          "customerName": "Jane Smith",
          "email": "jane@example.com",
          "phone": {
            "number": "5551234567",
            "countryCode": "+1"
          },
          "company": "Acme LLC",
          "location": "Dallas, TX"
        },
        "assignedTo": {
          "_id": "674ghi333333333333333333",
          "name": "Sarah Sales",
          "firstName": "Sarah",
          "lastName": "Sales",
          "email": "sarah@company.com",
          "role": "sales"
        },
        "escalatedBy": {
          "_id": "674ghi333333333333333333",
          "name": "Sarah Sales",
          "firstName": "Sarah",
          "lastName": "Sales",
          "email": "sarah@company.com",
          "role": "sales"
        },
        "resolvedBy": null,
        "resolvedAssignedTo": null,
        "escalation": {
          "_id": "674jkl444444444444444444",
          "note": "Customer needs pricing revision before PO",
          "status": "pending",
          "createdAt": "2026-06-19T10:30:00.000Z",
          "resolvedAt": null,
          "escalatedBy": { "_id": "...", "name": "Sarah Sales", "email": "sarah@company.com", "role": "sales" },
          "resolvedBy": null,
          "resolvedAssignedTo": null
        }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### GET response — resolved row (key fields)

```json
{
  "resolvedBy": {
    "_id": "674adm666666666666666666",
    "name": "Admin User",
    "firstName": "Admin",
    "lastName": "User",
    "email": "admin@company.com",
    "role": "admin"
  },
  "resolvedAssignedTo": {
    "_id": "674mno555555555555555555",
    "name": "John Rep",
    "firstName": "John",
    "lastName": "Rep",
    "email": "john@company.com",
    "role": "sales"
  },
  "escalation": {
    "status": "resolved",
    "resolvedAt": "2026-06-19T14:15:00.000Z",
    "resolvedBy": { "...": "..." },
    "resolvedAssignedTo": { "...": "..." }
  }
}
```

### Resolve vs assign

| Endpoint | `resolvedBy` | `resolvedAssignedTo` |
|----------|--------------|----------------------|
| `PUT .../resolve` | Admin who resolved | Lead’s current `assignedSales` at resolve time |
| `PUT .../assign` | Admin who resolved | New `employeeId` (lead reassigned) |

### PUT resolve / assign response

```json
{
  "success": true,
  "message": "Escalation resolved",
  "data": {
    "lead": { }
  }
}
```

`data.lead` uses the **same shape** as one item in `GET data.leads[]`.

### Pending vs resolved

| Field | `pending` | `resolved` |
|-------|-----------|------------|
| `resolvedBy` | `null` | Admin user object |
| `resolvedAssignedTo` | `null` | Sales rep (see table above) |
| `escalatedBy` | Populated | Populated |
| `assignedTo` | Current lead owner | Current lead owner |

### Sales escalations

`GET /api/sales/leads/escalated` uses the **same mapper** — customer, `escalatedBy`, `assignedTo`, and resolve fields match admin row shape (scoped to sales user’s leads).

---

## 4. Shipper files — BOM vs submitted amount comparison

**Added:** June 20, 2026

Shipper **list** and **detail** responses now include `amountComparison`: consolidated BOM total cost vs vendor submitted quote amount, plus a mismatch flag.

This is a **header-level total comparison** (not line-item comparison). Line-item comparison still uses `POST /api/plant/shipper-requests/:requestId/compare`.

### Data sources

| Field | Source |
|-------|--------|
| `bomAmount` | `ConsolidatedBOM.totalCost` (via `ShipperRequest.consolidatedBOMId`) |
| `shipperSubmittedAmount` | `ShipperRequest.quoteValue` (vendor submitted on public upload) |

### `amountComparison` object

| Field | Type | Meaning |
|-------|------|---------|
| `bomAmount` | `number \| null` | Consolidated BOM total cost |
| `shipperSubmittedAmount` | `number \| null` | Vendor submitted quote |
| `difference` | `number \| null` | `shipperSubmittedAmount − bomAmount` |
| `isMismatch` | `boolean \| null` | `true` when both amounts exist and differ; `null` if cannot compare |
| `canCompare` | `boolean` | `false` when vendor has not submitted a quote yet |

### UI logic

```javascript
if (!row.amountComparison.canCompare) {
  // "Awaiting vendor quote"
} else if (row.amountComparison.isMismatch) {
  // Highlight — show bomAmount, shipperSubmittedAmount, difference
} else {
  // Amounts match
}
```

---

### 4A. `GET /api/plant/shipper-files/projects/:leadId/requests`

**Alias:** `GET /api/plant/shipper-requests/projects/:leadId/requests`  
**Role:** `plant`

#### Response `data` (example — mismatch + match + pending)

```json
{
  "leadId": "664c1a2b3d4e5f6789012001",
  "projectId": "PRO-080",
  "projectName": "Anshika Warehouse LLC",
  "stats": {
    "totalFiles": 3,
    "filesReceived": 2,
    "ordersSent": 3,
    "revisionsSent": 1
  },
  "shipperRequests": [
    {
      "requestId": "6a328001a2982523aa1e91bd",
      "vendorId": "665a00000000000000000010",
      "vendorName": "Ayesha LLC 1",
      "vendorCode": "VND-0029",
      "fileName": "Ayesha-Quote-Revised.pdf",
      "uploadedDate": "2026-06-20T10:15:00.000Z",
      "rates": 6000,
      "fileStatus": "submitted",
      "comparisonStatus": "idle",
      "resubmitCount": 1,
      "resubmitRequestedAt": "2026-06-19T14:00:00.000Z",
      "canRequestResubmit": true,
      "amountComparison": {
        "bomAmount": 10000,
        "shipperSubmittedAmount": 6000,
        "difference": -4000,
        "isMismatch": true,
        "canCompare": true
      }
    },
    {
      "requestId": "6a328001a2982523aa1e91be",
      "vendorId": "665a00000000000000000011",
      "vendorName": "SteelCo Logistics",
      "vendorCode": "VND-0011",
      "fileName": "SteelCo-Quote.pdf",
      "uploadedDate": "2026-06-18T09:30:00.000Z",
      "rates": 10000,
      "fileStatus": "comparison_completed",
      "comparisonStatus": "completed",
      "resubmitCount": 0,
      "resubmitRequestedAt": null,
      "canRequestResubmit": true,
      "amountComparison": {
        "bomAmount": 10000,
        "shipperSubmittedAmount": 10000,
        "difference": 0,
        "isMismatch": false,
        "canCompare": true
      }
    },
    {
      "requestId": "6a328001a2982523aa1e91bf",
      "vendorId": "665a00000000000000000012",
      "vendorName": "Metro Freight Supply",
      "vendorCode": "VND-0012",
      "fileName": "",
      "uploadedDate": null,
      "rates": null,
      "fileStatus": "sent",
      "comparisonStatus": "idle",
      "resubmitCount": 0,
      "resubmitRequestedAt": null,
      "canRequestResubmit": false,
      "amountComparison": {
        "bomAmount": 10000,
        "shipperSubmittedAmount": null,
        "difference": null,
        "isMismatch": null,
        "canCompare": false
      }
    }
  ],
  "total": 3
}
```

---

### 4B. `GET /api/plant/shipper-files/:requestId/document`

**Alias:** `GET /api/plant/shipper-requests/:requestId/document`  
**Role:** `plant`

#### Response `data` — mismatch example

```json
{
  "requestId": "6a328001a2982523aa1e91bd",
  "leadId": "664c1a2b3d4e5f6789012001",
  "projectId": "PRO-080",
  "projectName": "Anshika Warehouse LLC",
  "vendorId": "665a00000000000000000010",
  "vendorName": "Ayesha LLC 1",
  "vendorCode": "VND-0029",
  "fileName": "Ayesha-Quote-Revised.pdf",
  "fileUrl": "https://bucket.s3.amazonaws.com/vendor-uploads/abc123.pdf",
  "uploadedDate": "2026-06-20T10:15:00.000Z",
  "rates": 6000,
  "fileStatus": "submitted",
  "amountComparison": {
    "bomAmount": 10000,
    "shipperSubmittedAmount": 6000,
    "difference": -4000,
    "isMismatch": true,
    "canCompare": true
  }
}
```

#### Response `data` — amounts match

```json
{
  "requestId": "6a328001a2982523aa1e91be",
  "leadId": "664c1a2b3d4e5f6789012001",
  "projectId": "PRO-080",
  "projectName": "Anshika Warehouse LLC",
  "vendorId": "665a00000000000000000011",
  "vendorName": "SteelCo Logistics",
  "vendorCode": "VND-0011",
  "fileName": "SteelCo-Quote.pdf",
  "fileUrl": "https://bucket.s3.amazonaws.com/vendor-uploads/def456.pdf",
  "uploadedDate": "2026-06-18T09:30:00.000Z",
  "rates": 10000,
  "fileStatus": "comparison_completed",
  "amountComparison": {
    "bomAmount": 10000,
    "shipperSubmittedAmount": 10000,
    "difference": 0,
    "isMismatch": false,
    "canCompare": true
  }
}
```

---

### 4C. `GET /api/plant/projects/:leadId/shipper-files`

**Role:** `plant`

#### Response `data` (example)

```json
{
  "stats": {
    "totalFiles": 2,
    "filesReceived": 2,
    "ordersSent": 2,
    "revisionsSent": 1
  },
  "shipperFiles": [
    {
      "_id": "6a328001a2982523aa1e91bd",
      "vendorId": "665a00000000000000000010",
      "vendorName": "Ayesha LLC 1",
      "status": "submitted",
      "submittedFileUrl": "https://bucket.s3.amazonaws.com/vendor-uploads/abc123.pdf",
      "submittedFileName": "Ayesha-Quote-Revised.pdf",
      "submittedAt": "2026-06-20T10:15:00.000Z",
      "quoteValue": 6000,
      "sentAt": "2026-06-17T08:00:00.000Z",
      "amountComparison": {
        "bomAmount": 10000,
        "shipperSubmittedAmount": 6000,
        "difference": -4000,
        "isMismatch": true,
        "canCompare": true
      }
    },
    {
      "_id": "6a328001a2982523aa1e91be",
      "vendorId": "665a00000000000000000011",
      "vendorName": "SteelCo Logistics",
      "status": "comparison_completed",
      "submittedFileUrl": "https://bucket.s3.amazonaws.com/vendor-uploads/def456.pdf",
      "submittedFileName": "SteelCo-Quote.pdf",
      "submittedAt": "2026-06-18T09:30:00.000Z",
      "quoteValue": 10000,
      "sentAt": "2026-06-17T08:00:00.000Z",
      "amountComparison": {
        "bomAmount": 10000,
        "shipperSubmittedAmount": 10000,
        "difference": 0,
        "isMismatch": false,
        "canCompare": true
      }
    }
  ]
}
```

### Field name note (list endpoints)

| Endpoint | Shipper amount field | Row id field |
|----------|---------------------|--------------|
| `.../shipper-files/projects/:leadId/requests` | `rates` | `requestId` |
| `.../projects/:leadId/shipper-files` | `quoteValue` | `_id` |

Use **`amountComparison`** as the shared source for BOM vs shipper comparison on all three endpoints.

---

## 5. Files changed

| Area | Files |
|------|-------|
| Freight bid resubmit | `src/controllers/plant/freightBid.controller.js`, `src/routes/plant/freightBid.routes.js` |
| Building sync | `src/services/leadBuilding.service.js`, `src/controllers/sales/lead.controller.js`, `src/config/constants.js` |
| Admin escalations | `src/utils/escalationLeadRow.js`, `src/controllers/admin/escalation.controller.js` |
| Shipper amount comparison | `src/utils/shipperAmountComparison.js`, `src/controllers/plant/shipper.controller.js`, `src/controllers/plant/project.controller.js` |

---

## 6. Frontend checklist

### Plant — freight

- [ ] Revision modal sends `{ note, bidAmount }` to `POST /api/plant/freight-bids/:bidId/request-resubmit`
- [ ] Show `requestedBidAmount` on bid row when `status === 'resubmit_requested'`
- [ ] Verify carrier email shows requested amount after deploy

### Sales — buildings

- [ ] Use `POST /api/sales/leads/:leadId/buildings` for both increase and decrease
- [ ] Handle new fields: `removedCount`, `removedBuildingNumbers`, `consolidatedBomInvalidated`
- [ ] After reduce, prompt plant to regenerate consolidated BOM if needed

### Admin — escalations

- [ ] Switch list from `data.escalations` → `data.leads`
- [ ] Display `customerId`, `escalatedBy`, `assignedTo`, `resolvedBy`, `resolvedAssignedTo`
- [ ] Resolve/assign handlers read `data.lead` (not raw `data.escalation`)

### Plant — shipper amount comparison

- [ ] List: show BOM amount vs shipper amount from `amountComparison` on `GET .../shipper-files/projects/:leadId/requests`
- [ ] Detail: show same block on `GET .../shipper-requests/:requestId/document`
- [ ] Project tab: `GET /api/plant/projects/:leadId/shipper-files` — use `quoteValue` + `amountComparison`
- [ ] Highlight row when `amountComparison.isMismatch === true`
- [ ] When `canCompare === false`, show “Awaiting vendor quote” (not a mismatch)

---

## Related docs

- `docs/plant-freight-bid-socket-events.md` — carrier bid socket events (`freight_bid_submitted`, etc.)
- `docs/sales-panel-updates-jun-2026.md` — earlier sales escalation row fields
- `docs/plant-frontend-api-updates-jun-2026.md` — plant shipper KPIs, freight revision, project list fields
