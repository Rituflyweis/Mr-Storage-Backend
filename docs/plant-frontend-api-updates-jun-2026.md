# Plant panel — frontend API reference (June 2026 updates)

Reference for frontend integration of recent backend changes: SMDT export/KPIs, shipper file KPIs, delivery calendar filtering, packing list project context, delivery selection fixes, load-planning weight fields, and project list name fallback fields.

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
9. [Related docs](#9-related-docs)
10. [Frontend checklist](#10-frontend-checklist)

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

**Suggested home screen layout:** Four KPI tiles in shipper files section; list/table below from `GET /api/plant/shipper-requests/projects` (see [§8 Project lists — name fallback fields](#8-project-lists--name-fallback-fields) for `customerName`, `buildingType`, `location`).

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

## 9. Related docs

| Doc | Topic |
|-----|--------|
| [vendor-upload-resubmit-api.md](./vendor-upload-resubmit-api.md) | Vendor resubmit flow, public vendor upload routes |
| [plant-panel-api.md](./plant-panel-api.md) | Full plant API catalog |
| [plant-freight-load-details-api.md](./plant-freight-load-details-api.md) | Freight form, delivery detail, carrier bid — bundles & packing lists |
| [sales-invoice-shipper-comparison-updates-jun-2026.md](./sales-invoice-shipper-comparison-updates-jun-2026.md) | Invoice pass-through totals + shipper comparison tab stats |

---

## 10. Frontend checklist

### SMDT screen

- [ ] KPI row: `GET /api/smdt/stats` → Total items, Total item cost, Newly added
- [ ] Export button: `GET /api/smdt/export/excel` → download blob
- [ ] Table: existing `GET /api/smdt` with pagination/filters

### Shipper files home

- [ ] KPI row: `GET /api/plant/shipper-requests/stats`
- [ ] Project list: `GET /api/plant/shipper-requests/projects` — use `customerName`, `buildingType`, `location` when `projectName` is empty

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
| GET | `/api/plant/shipper-requests/stats` | Shipper file KPIs |
| GET | `/api/plant/bom/projects` | BOM project list + name fallback fields |
| GET | `/api/plant/shipper-files/projects` | Shipper project list + name fallback fields |
| GET | `/api/plant/load-planning/projects` | Load planning project list + name fallback fields |
| GET | `/api/plant/packing-lists/projects` | Packing list project list + name fallback fields |
| GET | `/api/plant/deliveries/calendar` | Calendar (confirmed only) |
| GET | `/api/plant/packing-list-plans/:id` | Truck plan + `project` |
| GET | `/api/plant/projects/:leadId/delivery` | Selected delivery detail |
| GET | `/api/plant/deliveries/project/:leadId` | All deliveries + `selectedDeliveryId` |
| GET | `/api/plant/projects/:projectId/load-planning` | Load + bundle summary |
| GET | `/api/plant/bundles/:bundleId` | Bundle items with weights |
