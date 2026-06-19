# Plant panel — frontend API reference (June 2026 updates)

Reference for frontend integration of recent backend changes: SMDT export/KPIs, shipper file KPIs (dashboard + per project), freight request detail, carrier bid revision, payment schedule edit, delivery calendar filtering, packing list project context, delivery selection fixes, load-planning weight fields, and project list name fallback fields.

**Auth:** All plant endpoints require `Authorization: Bearer <accessToken>` and `plant` role unless marked **Public**.

**Response envelope:**

```json
{
  "success": true,
  "message": "...",
  "data": { ... }
}
```

Errors: `success: false`, `message` string, optional `data` with validation details.

---

## Table of contents

1. [SMDT cost list — export & KPIs](#1-smdt-cost-list--export--kpis)
2. [Shipper files — dashboard KPIs](#2-shipper-files--dashboard-kpis)
3. [Delivery calendar — confirmed only](#3-delivery-calendar--confirmed-only)
4. [Packing list plan — project details](#4-packing-list-plan--project-details)
5. [Deliveries — project selection fixes](#5-deliveries--project-selection-fixes)
6. [Load planning — bundle weights](#6-load-planning--bundle-weights)
7. [Truck plan confirm — length limit note](#7-truck-plan-confirm--length-limit-note)
8. [Project lists — name fallback fields](#8-project-lists--name-fallback-fields)
9. [Freight — request detail, bids & revision](#9-freight--request-detail-bids--revision)
10. [Payment schedule — edit (admin / sales)](#10-payment-schedule--edit-admin--sales)
11. [Related docs](#11-related-docs)
12. [Frontend checklist](#12-frontend-checklist)

---

## 1. SMDT cost list — export & KPIs

Base path: `/api/smdt`  
Roles: `admin`, `plant`

### 1A. KPI cards — `GET /api/smdt/stats`

Use on SMDT / cost list home screen for summary cards.

**Response `data`:**

```json
{
  "activeVersion": {
    "_id": "6a337c6fb2ec31ca10a8c37b",
    "name": "Local test SMDT",
    "effectiveDate": "2026-06-01T00:00:00.000Z",
    "uploadedAt": "2026-06-10T12:00:00.000Z",
    "isActive": true
  },
  "totalItems": 1842,
  "totalItemCost": 125430.55,
  "newlyAdded": 48,
  "lastImportInserted": 45,
  "lastImportUpdated": 3
}
```

| Field | UI label suggestion | Meaning |
|--------|---------------------|---------|
| `totalItems` | Total items | Active rows in current SMDT version |
| `totalItemCost` | Total item cost | Sum of `currentMarketCost ?? mbsCost` per active row |
| `newlyAdded` | Newly added | Items created since active version was uploaded |
| `lastImportInserted` | Last import (new) | Rows inserted on last Excel import |
| `lastImportUpdated` | Last import (updated) | Rows updated on last Excel import |

If no active version, counts are `0` and `activeVersion` is `null`.

### 1B. Export Excel — `GET /api/smdt/export/excel`

Downloads file directly (not JSON). Use for “Export SMD list” button.

**Query params (optional, same as list):**

| Param | Values |
|-------|--------|
| `category` | SMDT category enum (e.g. `Panels`, `TRIM`, `frames`) |
| `isFrameType` | `true` \| `false` |
| `isActive` | `true` \| `false` \| `all` (default active only) |
| `search` | Free text (part name / description) |

**Frontend handling:**

```javascript
const res = await fetch(`/api/smdt/export/excel?${params}`, {
  headers: { Authorization: `Bearer ${token}` },
})
const blob = await res.blob()
// save as smdt-cost-list.xlsx
```

**Response headers:**

- `Content-Type`: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition`: `attachment; filename="smdt-cost-list.xlsx"`

**Excel columns:** Category, Part Name, Part Color, Cost Unit, MBS Cost, Current Market Cost, Labor Cost, Additional Cost, Material Cost, Frame Type, Active, Description.

### 1C. Existing list (unchanged path)

`GET /api/smdt` — paginated table; pair with `/stats` for KPI row above the table.

---

## 2. Shipper files — dashboard KPIs

**Endpoints (same handler):**

- `GET /api/plant/shipper-requests/stats`
- `GET /api/plant/shipper-files/stats`

**Single project (same KPI fields):**

- `GET /api/plant/shipper-files/projects/:leadId/stats`
- `GET /api/plant/shipper-requests/projects/:leadId/stats`
- `stats` block also on `GET /api/plant/shipper-files/projects/:leadId/requests` and `GET /api/plant/projects/:leadId/shipper-files`

Scoped to projects assigned to the logged-in plant user (approved PO).

**Response `data`:**

```json
{
  "totalFiles": 24,
  "filesReceived": 18,
  "ordersSent": 22,
  "revisionsSent": 5
}
```

| Field | UI label suggestion | Meaning |
|--------|---------------------|---------|
| `totalFiles` | Total files | All shipper requests across assigned projects |
| `filesReceived` | Files received | Vendor submitted a quote file (`submittedFileUrl` set) |
| `ordersSent` | Orders sent | Request sent to vendor (`sentAt` + valid status) |
| `revisionsSent` | Revisions sent | Sum of `resubmitCount` (total resubmit rounds requested) |

**Single-project KPI response** (`GET .../projects/:leadId/stats`):

```json
{
  "leadId": "6a337c4fedd83b0390b87007",
  "projectId": "PRO-029",
  "projectName": "Twin Creek Load",
  "totalFiles": 3,
  "filesReceived": 2,
  "ordersSent": 3,
  "revisionsSent": 1
}
```

Alternatively, read `stats` from `GET /api/plant/shipper-files/projects/:leadId/requests` or `GET /api/plant/projects/:leadId/shipper-files` without a second KPI call.

**Suggested home screen layout:** Four KPI tiles in shipper files section; list/table below from `GET /api/plant/shipper-requests/projects` (see [§8 Project lists — name fallback fields](#8-project-lists--name-fallback-fields) for `customerName`, `buildingType`, `location`).

**Project detail screen:** Four KPI tiles from `GET /api/plant/shipper-files/projects/:leadId/stats`; requests table from `GET .../projects/:leadId/requests`.

---

## 3. Delivery calendar — confirmed only

### `GET /api/plant/deliveries/calendar`

**Behavior change:** Calendar now returns **only** deliveries with `status === "confirmed"`.  
Previously included `draft`, `bidding_sent`, etc. — remove those from calendar UI expectations.

**Query params:**

| Param | Type | Notes |
|-------|------|-------|
| `fromDate` | ISO date | Filter `deliveryDate` range start |
| `toDate` | ISO date | Filter `deliveryDate` range end |
| `projectId` | string | Mongo `leadId` or `jobId` (e.g. `PRO-029`) |
| `customerId` | MongoId | Filter by customer |

**Example:**

```
GET /api/plant/deliveries/calendar?fromDate=2026-06-18&toDate=2026-06-18
```

**Response `data`:**

```json
{
  "dates": [
    {
      "date": "2026-06-18",
      "totalDeliveries": 2,
      "deliveries": [
        {
          "_id": "...",
          "requestId": "...",
          "deliveryNumber": "DEL-00012",
          "status": "confirmed",
          "project": { "_id": "...", "jobId": "PRO-029", "projectName": "Twin Creek" },
          "customer": { "_id": "...", "name": "John Doe", "email": "..." },
          "deliveryDate": "2026-06-18T00:00:00.000Z",
          "delivery": { /* full delivery document */ }
        }
      ]
    }
  ]
}
```

**UI notes:**

- Only show **confirmed** deliveries on calendar; use freight/delivery list APIs for bidding/draft states.
- If you need `scheduled` or `carrier_selected` on calendar later, coordinate with backend — current contract is **confirmed only**.

---

## 4. Packing list plan — project details

### `GET /api/plant/packing-list-plans/:packingListPlanId`

**New top-level field:** `project` (same on public endpoint below).

**Response `data` (partial):**

```json
{
  "project": {
    "_id": "6a337c4fedd83b0390b87007",
    "leadId": "6a337c4fedd83b0390b87007",
    "projectId": "PRO-029",
    "jobId": "PRO-029",
    "projectName": "Twin Creek Load",
    "buildingType": "commercial",
    "location": "Twin Creek",
    "lifecycleStatus": "released_to_plant",
    "customer": {
      "_id": "...",
      "customerId": "CUS-0012",
      "name": "Jane Smith",
      "email": "jane@example.com"
    }
  },
  "packingListPlan": { ... },
  "packingLists": [ ... ],
  "bundles": [ ... ],
  "summary": {
    "totalWeight": 58475.4,
    "totalBundles": 41,
    "totalPackingLists": 2,
    "truckSummary": { ... },
    "warnings": [ ... ]
  }
}
```

### Public read — `GET /api/plant/packing-list-plans/:packingListPlanId` (no JWT)

Same `project` block; `packingLists` include nested `bundles` per truck.

**UI:** Show project name, job ID, customer, and location in packing list / truck plan header without a separate project fetch.

---

## 5. Deliveries — project selection fixes

### Problem (fixed)

When a project had multiple deliveries, `GET .../delivery` could return a `bidding_sent` row instead of the **selected** carrier delivery.

### `GET /api/plant/projects/:leadId/delivery`

Returns the **selected** delivery for the project:

- Requires `selectedCarrierBidId` set
- Status must be one of: `carrier_selected`, `scheduled`, `confirmed`, `in_transit`, `delayed`, `delivered`
- **Excludes** `bidding_sent`, `draft`, `cancelled`

404 if no matching delivery: `"No selected/confirmed delivery found for this project"`.

Use this for project delivery detail / summary screens (not the raw list).

### `GET /api/plant/deliveries/project/:leadId`

List all deliveries for a project. **New fields:**

```json
{
  "requests": [
    {
      "requestId": "...",
      "deliveryId": "...",
      "status": "carrier_selected",
      "isSelected": true,
      "hasSelectedCarrier": true,
      "carrier": "ABC Freight",
      ...
    },
    {
      "requestId": "...",
      "status": "bidding_sent",
      "isSelected": false,
      "hasSelectedCarrier": false,
      ...
    }
  ],
  "total": 2,
  "selectedDeliveryId": "6a337c60edd83b0390b870c3"
}
```

| Field | Use |
|-------|-----|
| `selectedDeliveryId` | Highlight / default selection in delivery picker |
| `isSelected` / `hasSelectedCarrier` | Row badge “Selected carrier” |

**Delivery detail shipper vendor:** Prefers **approved** shipper vendor for the project, not the latest open/bidding request.

---

## 6. Load planning — bundle weights

### Bundle item fields (Mongo + bundle detail APIs)

Each `Bundle.items[]` row now includes explicit weight fields:

| Field | Type | Meaning |
|-------|------|---------|
| `weight` | number | **Total line weight (lbs)** — backward compatible |
| `totalWeight` | number | Same as `weight` (total line lbs) |
| `unitWeight` | number | Per-piece / per-unit lbs (`totalWeight / qty` when BOM-matched) |
| `weightBasis` | string | e.g. `BOM_MATCHED_TOTAL_WEIGHT`, `MISSING`, `PRICE_OR_COST_DETECTED` |
| `weightSource` | string | e.g. `bom_matched`, `bom_direct_fallback` |

**Where exposed:**

- `GET /api/plant/bundles/:bundleId` — `items[]` via `mapBundleItemRow`
- `GET /api/plant/bundles/:bundleId` (public) — full bundle with items
- Stored Mongo documents after bundle plan generate

**UI:**

- Show **total line weight** from `totalWeight` or `weight`
- Show **unit weight** from `unitWeight` (not derived from vendor quote dollars)
- Bundle plan `totalWeight` should match BOM total when compare is 79/79 matched

### Bundle plan generate

`POST /api/plant/shipper-requests/:requestId/bundle-plan/generate`

- Uses BOM-matched weights from comparison (`QuoteComparisonResult` → `BOMItem.weight`)
- **Fails without saving** if total weight is 0 or all lines missing weight (`400` with hint in `data`)
- Response includes `missingWeightItemCount`, `hasWeightWarning`

**Regenerate** after compare completes if an old plan shows ~0 or wrong total weight.

### Load planning snapshot

`GET /api/plant/projects/:projectId/load-planning`

- `bundlePlan.totalWeight` — plan total (lbs)
- `bundleSummary.totalWeight` — sum of bundles
- Per-bundle rows may omit `items[]`; use bundle detail endpoint for line-level weights

---

## 7. Truck plan confirm — length limit note

### Symptom

`400` on confirm: `Packing list PL-001 exceeds truck length limit`

### Cause

A bundle longer than the assigned truck (e.g. ~51 ft bundle on 40 ft hotshot).

### Backend fixes

- New truck plans assign bundles **> 40 ft** to **SEMI_53** (53 ft)
- On confirm, legacy plans may auto-upgrade to SEMI_53 when length ≤ 53 ft

### Frontend

- Show `packingListPlan.warnings` and per-truck `maxLengthFeet` vs `maxTruckLengthFeet`
- If confirm fails with length error, prompt user to **regenerate truck plan** from confirmed bundles

---

## 8. Project lists — name fallback fields

Several plant **project list** endpoints now include `customerName`, `buildingType`, and `location` on each row so the UI can build a display title when `projectName` is empty.

### Endpoints (each returns `data.projects[]`)

| Endpoint | Notes |
|----------|--------|
| `GET /api/plant/bom/projects` | Paginated (`page`, `limit`); one row per building (latest BOM job) |
| `GET /api/plant/shipper-files/projects` | Same handler as `GET /api/plant/shipper-requests/projects` |
| `GET /api/plant/load-planning/projects` | Latest non-cancelled bundle plan per project |
| `GET /api/plant/packing-lists/projects` | Latest non-cancelled packing list plan per project |

Scoped to projects assigned to the logged-in plant user (approved PO), same as other plant project lists.

### New fields on each `projects[]` row

| Field | Type | Meaning |
|-------|------|---------|
| `customerName` | string | Customer display name (`firstName` + `lastName`) |
| `buildingType` | string | Lead `buildingType` (e.g. `warehouse`, `garage`) |
| `location` | string | Lead `location` |

Existing fields (`leadId`, `projectId`, `jobId`, `projectName`, status counts, etc.) are unchanged.

### Example row (shipper / load-planning / packing-lists shape)

```json
{
  "leadId": "6a337c4fedd83b0390b87007",
  "projectId": "PRO-029",
  "jobId": "PRO-029",
  "projectName": "",
  "customerName": "Jane Smith",
  "buildingType": "commercial",
  "location": "Twin Creek, TX",
  "totalShipperFiles": 3,
  "receivedShipperFiles": 2,
  "fileReceivedStatus": "partial",
  "latestSubmittedAt": "2026-06-10T12:00:00.000Z"
}
```

### Example row (BOM projects — includes building fields)

```json
{
  "leadId": "6a337c4fedd83b0390b87007",
  "projectId": "PRO-029",
  "projectName": "",
  "customerName": "Jane Smith",
  "buildingType": "commercial",
  "location": "Twin Creek, TX",
  "buildingId": "...",
  "buildingNumber": 1,
  "uploadDate": "2026-06-03T05:20:00.000Z",
  "itemCount": 320,
  "fileStatus": "extracted",
  "bomJobId": "..."
}
```

### Suggested display fallback (frontend)

When `projectName` is missing or blank, build the list title from available fields:

```javascript
function projectDisplayName(row) {
  if (row.projectName?.trim()) return row.projectName.trim()
  const parts = [
    row.customerName?.trim(),
    row.buildingType?.trim(),
    row.location?.trim(),
  ].filter(Boolean)
  if (parts.length) return parts.join(' · ')
  return row.jobId || row.projectId || 'Unnamed project'
}
```

Optional subtitle: always show `jobId` / `projectId` when the primary title uses the fallback.

**UI:** Apply the same helper on BOM, shipper files, load planning, and packing lists project pickers / sidebars for consistent naming.

---

## 9. Freight — request detail, bids & revision

Full freight load breakdown (bundles / packing lists on form, email, and detail): [plant-freight-load-details-api.md](./plant-freight-load-details-api.md).

### 9A. Freight request detail (full card)

#### `GET /api/plant/deliveries/:deliveryId/detail` — **primary**

Use when you have `deliveryId`. Works for **any** status (`draft`, `bidding_sent`, `carrier_selected`, `confirmed`, etc.).

**Response `data` (partial):**

```json
{
  "delivery": {
    "deliveryId": "...",
    "deliveryNumber": "DEL-0012",
    "status": "bidding_sent",
    "statusHistory": [ { "status": "draft", "changedAt": "..." } ],
    "project": { "leadId": "...", "projectName": "Twin Creek", "jobId": "PRO-029" },
    "customer": { "customerId": "...", "customerName": "Jane Smith" },
    "formDetails": {
      "loadDescription": "18 bundle shipment",
      "loadWeight": 62400,
      "dimensions": { "lengthFeet": 51, "widthFeet": 8.5, "heightFeet": 8 },
      "materialType": "framing, panels, trim",
      "packageCount": 2,
      "loadingEquipment": ["forklift"],
      "bidDeadline": "2026-06-20T18:00:00.000Z",
      "pickupLocation": "Plant Yard, Houston",
      "pickupLocationData": { "address": "...", "coordinates": { "lat": 29.76, "lng": -95.36 } },
      "deliveryLocation": "ABC Site, Austin",
      "deliveryLocationData": { ... },
      "pickupDate": "2026-06-12T00:00:00.000Z",
      "deliveryDate": "2026-06-13T00:00:00.000Z",
      "receivingPoc": "John Doe",
      "pickupContactPhone": "+1-555-222-3344",
      "specialRequirements": "",
      "additionalNotes": ""
    },
    "deliverySchedule": {
      "deliveryDate": "...",
      "timeWindow": "Mon-Fri 8AM-6PM",
      "pickupAddress": "...",
      "dropoffAddress": "..."
    },
    "deliveryInformation": {
      "description": "18 bundle shipment",
      "materialCategory": "framing, panels, trim",
      "pickupDate": "..."
    },
    "shipperDetails": { "vendorName": "...", "personName": "...", "number": "...", "email": "..." },
    "deliveryCompanyDetails": null,
    "selectedBid": null,
    "internalOwner": { "userId": "...", "name": "...", "email": "...", "phone": "..." },
    "deliveryTypeAndSize": { "bundleCount": 41, "packageCount": 2, "totalWeight": 58475.4 },
    "bundlePlan": { ... },
    "packingListPlan": { ... },
    "bundles": [ ... ],
    "packingLists": [ ... ],
    "receivingPocDetails": { "receivingPoc": "...", "pickupContactPhone": "..." }
  }
}
```

#### `GET /api/plant/projects/:leadId/delivery` — awarded / in-progress only

Same response shape as above, but only when a carrier has been **selected** (`selectedCarrierBidId` set) and status is `carrier_selected`, `scheduled`, `confirmed`, `in_transit`, `delayed`, or `delivered`.

404: `"No selected/confirmed delivery found for this project"` if still draft / bidding only.

See also [§5 Deliveries — project selection fixes](#5-deliveries--project-selection-fixes) for list vs detail picker behavior.

### 9B. Freight request list (summary)

`GET /api/plant/deliveries/project/:leadId` — summary rows + `selectedDeliveryId`. Not full form fields; use **9A** for detail screen.

### 9C. Carrier bids (bidding screen)

`GET /api/plant/projects/:projectId/freight/bids?sort=low_to_high|high_to_low`

**Response `data` (partial):**

```json
{
  "requestId": "...",
  "projectName": "Twin Creek",
  "status": "bidding_sent",
  "stats": { "totalBids": 3, "averageBid": 2450, "awardedBid": null, "potentialSavings": 300 },
  "bidRange": { "lowestBid": { ... }, "highestBid": { ... } },
  "bids": [
    {
      "bidId": "...",
      "carrierId": "...",
      "carrierName": "Metro Freight",
      "submittedAt": "2026-06-09T11:20:00.000Z",
      "carrierNote": "Rate valid 24h",
      "bidAmount": 2300,
      "status": "submitted",
      "isLowest": true,
      "resubmitCount": 0,
      "resubmitRequestedAt": null,
      "resubmitNote": "",
      "plantNote": "",
      "canRequestResubmit": true
    }
  ]
}
```

| Field | Use |
|-------|-----|
| `resubmitNote` | Last plant revision note sent to carrier |
| `plantNote` | Same as `resubmitNote` (alias for FE parity with shipper resubmit) |
| `canRequestResubmit` | Show “Request revision” when `true` (bid status `submitted`) |
| `resubmitCount` | Revision rounds for this carrier bid |

Legacy path: `GET /api/plant/deliveries/:deliveryId/bids` (same shape).

### 9D. Request carrier bid revision

`POST /api/plant/freight-bids/:bidId/request-resubmit`

Ask one carrier to submit a **new bid amount** after they already submitted (mirrors vendor shipper `request-resubmit`, but amount only).

**Request body:**

```json
{
  "note": "Please revise — pickup window moved to next week."
}
```

- `note` — **required**

**Allowed when:** bid status is `submitted`; delivery not `cancelled`.

**Behavior:**

- Prior bid saved to history; `quotedAmount` cleared
- Status → `resubmit_requested`
- Email to carrier with note + same bid link
- If deadline passed, extends `expiresAt` by 7 days

**Response `data`:**

```json
{
  "bidId": "...",
  "status": "resubmit_requested",
  "resubmitCount": 1,
  "resubmitRequestedAt": "2026-06-17T12:00:00.000Z",
  "note": "Please revise — pickup window moved to next week.",
  "resubmitNote": "Please revise — pickup window moved to next week.",
  "plantNote": "Please revise — pickup window moved to next week.",
  "priorQuotedAmount": 2300,
  "expiresAt": "2026-06-24T12:00:00.000Z",
  "emailFailures": []
}
```

Carrier resubmits via public `POST /api/public/freight-bids/:token/submit` → status back to `submitted`.

### 9E. Other freight endpoints (quick ref)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plant/projects/:projectId/freight-autofill` | Pre-fill create form (weight, dimensions, bundles) |
| POST | `/api/plant/deliveries` | Create freight request |
| POST | `/api/plant/projects/:projectId/freight/send-bids` | Send bid links to carriers |
| POST | `/api/plant/freight-bids/:bidId/select` | Award bid |
| GET | `/api/public/freight-bids/:token` | Carrier bid page (includes `resubmitNote` when revision requested) |

---

## 10. Payment schedule — edit (admin / sales)

One payment schedule per project (`leadId`). **Roles:** `admin`, `sales` (sales only for assigned leads).  
Full reference: [payment-schedule-update-api.md](./payment-schedule-update-api.md).

| Action | Method | Path |
|--------|--------|------|
| Create | `POST` | `/api/payment-schedules` |
| **Update** | **`PUT`** | **`/api/payment-schedules/lead/:leadId`** |
| Get | `GET` | `/api/payment-schedules/lead/:leadId` |

### `PUT /api/payment-schedules/lead/:leadId`

Edit stages after initial create. Send the **full** `stages[]` array on every save.

**Request body:**

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
|-------|----------|--------|
| `stages` | Yes | Min 1 row |
| `stages[]._id` | No | Include for existing stages (from GET); omit for new stages |
| `stages[].stageName` | Yes | e.g. `Deposit` |
| `stages[].amount` | Yes | Percentage or fixed amount |
| `stages[].amountType` | Yes | `percentage` or `fixed` — **all stages must match** |
| `stages[].dueDate` | No | ISO 8601 |
| `totalAmount` | No | Keeps existing if omitted; required for `fixed` sum validation |

**Validation:**

| Rule | Error |
|------|--------|
| Percentages sum to **100** | 400 |
| Fixed amounts sum to **`totalAmount`** | 400 |
| Cannot remove stage linked to invoice or `invoiced` / `paid` / `overdue` | 400 |
| No schedule for lead | 404 |

**Merge behavior:**

- Existing stage (matched by `_id`): keeps `status`, `invoiceId`, `paidAt`, `paidBy`
- New stage (no `_id`): added as `pending`
- Removed stage: only if still `pending` and not invoiced

**Response `200` — `data`:**

```json
{
  "schedule": {
    "_id": "665b...",
    "leadId": "665a...",
    "customerId": "664c...",
    "totalAmount": 1917952,
    "stages": [
      {
        "_id": "665b...01",
        "stageName": "Deposit",
        "amount": 30,
        "amountType": "percentage",
        "dueDate": "2026-06-01T00:00:00.000Z",
        "status": "pending",
        "invoiceId": null,
        "paidAt": null,
        "paidBy": null
      }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**FE flow:**

```text
1. GET /api/payment-schedules/lead/:leadId
2. User edits form
3. PUT /api/payment-schedules/lead/:leadId  (full stages[] with _ids)
4. Refresh UI from response.data.schedule
```

**Create (first time only):** `POST /api/payment-schedules` with `leadId` + `stages` → `201`. Returns `400` if schedule already exists.

**Invoice link:** `POST /api/leads/:leadId/invoices` optional `paymentScheduleStageId` = stage `_id`.

---

## 11. Related docs

| Doc | Topic |
|-----|--------|
| [vendor-upload-resubmit-api.md](./vendor-upload-resubmit-api.md) | Vendor resubmit flow, public vendor upload routes |
| [plant-panel-api.md](./plant-panel-api.md) | Full plant API catalog |
| [plant-freight-load-details-api.md](./plant-freight-load-details-api.md) | Freight form, delivery detail, carrier bid — bundles & packing lists |
| [payment-schedule-update-api.md](./payment-schedule-update-api.md) | Payment schedule create + PUT edit |
| [sales-invoice-shipper-comparison-updates-jun-2026.md](./sales-invoice-shipper-comparison-updates-jun-2026.md) | Invoice pass-through totals + shipper comparison tab stats |

---

## 12. Frontend checklist

### SMDT screen

- [ ] KPI row: `GET /api/smdt/stats` → Total items, Total item cost, Newly added
- [ ] Export button: `GET /api/smdt/export/excel` → download blob
- [ ] Table: existing `GET /api/smdt` with pagination/filters

### Shipper files home

- [ ] KPI row: `GET /api/plant/shipper-requests/stats`
- [ ] Project list: `GET /api/plant/shipper-requests/projects` — use `customerName`, `buildingType`, `location` when `projectName` is empty

### Shipper project detail

- [ ] KPI row: `GET /api/plant/shipper-files/projects/:leadId/stats` (or `stats` on `.../requests`)
- [ ] Requests table: `GET /api/plant/shipper-files/projects/:leadId/requests`

### Project lists (name fallback)

- [ ] BOM: `GET /api/plant/bom/projects` — fallback title fields on each row
- [ ] Shipper files: `GET /api/plant/shipper-files/projects` (or `shipper-requests/projects`)
- [ ] Load planning: `GET /api/plant/load-planning/projects`
- [ ] Packing lists: `GET /api/plant/packing-lists/projects`
- [ ] Shared helper: `projectName` → `customerName · buildingType · location` → `jobId`

### Delivery calendar

- [ ] Only render `status === "confirmed"` entries from calendar API
- [ ] Do not expect `bidding_sent` / `draft` on calendar response

### Packing list / truck plan

- [ ] Header: use `project` from `GET /api/plant/packing-list-plans/:id`
- [ ] Show `summary.totalWeight` aligned with BOM where possible

### Project delivery

- [ ] Detail: `GET /api/plant/projects/:leadId/delivery` (selected carrier only)
- [ ] List/picker: `GET /api/plant/deliveries/project/:leadId` + `selectedDeliveryId`
- [ ] Highlight row where `isSelected === true`

### Freight request & bidding

- [ ] Full detail (any status): `GET /api/plant/deliveries/:deliveryId/detail`
- [ ] Bids table: `GET /api/plant/projects/:projectId/freight/bids`
- [ ] Request revision modal → `POST /api/plant/freight-bids/:bidId/request-resubmit` `{ note }`
- [ ] Show `canRequestResubmit` on bid rows; refresh after resubmit request
- [ ] Create form autofill: `GET /api/plant/projects/:projectId/freight-autofill`
- [ ] Send bids: `POST /api/plant/projects/:projectId/freight/send-bids`
- [ ] Award: `POST /api/plant/freight-bids/:bidId/select`

### Payment schedule (admin / sales)

- [ ] Load: `GET /api/payment-schedules/lead/:leadId`
- [ ] First create: `POST /api/payment-schedules` `{ leadId, stages, totalAmount? }`
- [ ] Edit save: `PUT /api/payment-schedules/lead/:leadId` — full `stages[]` with `_id` on existing rows
- [ ] Validate % sum = 100 or fixed sum = `totalAmount` before submit
- [ ] Do not remove invoiced / paid stages from array

### Load planning / bundles

- [ ] Bundle detail: show `unitWeight`, `totalWeight`, `weightBasis`
- [ ] Regenerate bundle plan if weights are 0 on old data
- [ ] Truck confirm: handle length-limit error → regenerate truck plan

---

## Quick endpoint index

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/smdt/stats` | SMDT KPIs |
| GET | `/api/smdt/export/excel` | Download SMDT Excel |
| GET | `/api/plant/shipper-requests/stats` | Shipper file KPIs (all projects) |
| GET | `/api/plant/shipper-files/projects/:leadId/stats` | Shipper KPIs (single project) |
| GET | `/api/plant/bom/projects` | BOM project list + name fallback fields |
| GET | `/api/plant/shipper-files/projects` | Shipper project list + name fallback fields |
| GET | `/api/plant/load-planning/projects` | Load planning project list + name fallback fields |
| GET | `/api/plant/packing-lists/projects` | Packing list project list + name fallback fields |
| GET | `/api/plant/deliveries/calendar` | Calendar (confirmed only) |
| GET | `/api/plant/packing-list-plans/:id` | Truck plan + `project` |
| GET | `/api/plant/projects/:leadId/delivery` | Selected delivery detail |
| GET | `/api/plant/deliveries/:deliveryId/detail` | Full freight request detail (any status) |
| GET | `/api/plant/deliveries/project/:leadId` | All deliveries + `selectedDeliveryId` |
| GET | `/api/plant/projects/:projectId/freight/bids` | Carrier bids + `canRequestResubmit` |
| POST | `/api/plant/freight-bids/:bidId/request-resubmit` | Request carrier bid revision `{ note }` |
| GET | `/api/plant/projects/:projectId/freight-autofill` | Freight form autofill |
| POST | `/api/plant/projects/:projectId/freight/send-bids` | Send bid links to carriers |
| POST | `/api/plant/freight-bids/:bidId/select` | Award freight bid |
| GET | `/api/payment-schedules/lead/:leadId` | Get payment schedule |
| PUT | `/api/payment-schedules/lead/:leadId` | Edit payment schedule |
| POST | `/api/payment-schedules` | Create payment schedule |
| GET | `/api/plant/projects/:projectId/load-planning` | Load + bundle summary |
| GET | `/api/plant/bundles/:bundleId` | Bundle items with weights |
