# Plant panel — freight load details (bundles & packing lists)

Frontend reference for bundle and packing list context on freight workflows: form auto-fill, delivery detail, carrier bid page, and freight bid request emails.

**Auth:** Plant endpoints require `Authorization: Bearer <accessToken>` and `plant` role. Carrier bid endpoints are **Public** (token in URL).

**Response envelope:**

```json
{
  "success": true,
  "message": "...",
  "data": { ... }
}
```

---

## Table of contents

1. [Shared load-details shape](#1-shared-load-details-shape)
2. [Freight form auto-fill](#2-freight-form-auto-fill)
3. [Delivery detail APIs](#3-delivery-detail-apis)
4. [Carrier bid page (public)](#4-carrier-bid-page-public)
5. [Freight bid request email](#5-freight-bid-request-email)
6. [Frontend checklist](#6-frontend-checklist)
7. [Quick endpoint index](#7-quick-endpoint-index)

---

## 1. Shared load-details shape

All endpoints below return the same four blocks when a non-cancelled bundle plan exists for the project:

| Block | When null | Contents |
|-------|-----------|----------|
| `bundlePlan` | No bundle plan | `_id`, `planNumber`, `status`, `totalBundles`, `totalWeight`, `maxLengthFeet` |
| `packingListPlan` | No truck plan yet | `_id`, `planNumber`, `status`, `totalPackingLists`, `totalBundles`, `totalWeight`, `maxLengthFeet`, `truckSummary` |
| `bundles` | Empty array | Per-bundle rows (sorted by load sequence) |
| `packingLists` | Empty array | Per-truck / packing list rows |

### `bundles[]` row

| Field | Type | Notes |
|-------|------|--------|
| `_id` | MongoId | Bundle id |
| `bundleNo` | string | e.g. `B-001` |
| `bundleType` | string | `panels`, `framing`, `trim`, etc. |
| `title` | string | Bundle title |
| `totalQty` | number | Total quantity in bundle |
| `totalWeight` | number | Total lbs |
| `maxLengthFeet` | number | Longest piece / bundle length |
| `estimatedWidthFeet` | number \| null | |
| `estimatedHeightFeet` | number \| null | |
| `itemCount` | number | Line items in bundle |
| `loadSequence` | number | Load order |
| `status` | string | Bundle status |
| `packingListId` | MongoId \| null | Assigned truck PL when truck plan exists |
| `warnings` | string[] | Planning warnings |

### `packingLists[]` row

| Field | Type | Notes |
|-------|------|--------|
| `_id` | MongoId | Packing list id |
| `packingListNo` | string | e.g. `PL-001` |
| `truckNo` | string | Truck sequence |
| `truckType` | string | `SEMI_53` or `HOTSHOT_40` |
| `truckLabel` | string | Display label |
| `totalBundles` | number | Bundles on this truck |
| `totalWeight` | number | Truck total lbs |
| `maxLengthFeet` | number | Longest bundle on truck |
| `maxTruckWeight` | number | Truck weight limit used |
| `maxTruckLengthFeet` | number | Truck length limit used |
| `bundleIds` | MongoId[] | Bundles assigned to this truck |
| `warnings` | number | Planning warnings |
| `status` | string | Packing list status |

### Example (abbreviated)

```json
{
  "bundlePlan": {
    "_id": "6a337c6fb2ec31ca10a8c37b",
    "planNumber": "BP-0004",
    "status": "confirmed",
    "totalBundles": 41,
    "totalWeight": 58475.4,
    "maxLengthFeet": 51
  },
  "packingListPlan": {
    "_id": "6a337c70b2ec31ca10a8c37c",
    "planNumber": "PLP-0001",
    "status": "confirmed",
    "totalPackingLists": 2,
    "totalBundles": 41,
    "totalWeight": 58475.4,
    "maxLengthFeet": 51,
    "truckSummary": {
      "semi53Count": 2,
      "hotshot40Count": 0,
      "totalTrucks": 2
    }
  },
  "bundles": [
    {
      "_id": "...",
      "bundleNo": "B-001",
      "bundleType": "framing",
      "title": "Wall framing bundle 1",
      "totalQty": 120,
      "totalWeight": 4200,
      "maxLengthFeet": 24,
      "itemCount": 8,
      "loadSequence": 1,
      "packingListId": "...",
      "warnings": []
    }
  ],
  "packingLists": [
    {
      "_id": "...",
      "packingListNo": "PL-001",
      "truckNo": "1",
      "truckType": "SEMI_53",
      "truckLabel": "Semi 53 #1",
      "totalBundles": 22,
      "totalWeight": 32000,
      "maxLengthFeet": 51,
      "bundleIds": ["...", "..."]
    }
  ]
}
```

**Note:** These payloads are **summaries** for freight/carrier context — not full bundle line items. Use `GET /api/plant/bundles/:bundleId` for item-level detail.

---

## 2. Freight form auto-fill

Use when opening the “create / edit freight request” form for a project.

### Primary — `GET /api/plant/projects/:projectId/freight-autofill`

`projectId` = Mongo `leadId` or `jobId` (e.g. `PRO-029`).

### Legacy — `GET /api/plant/bundle-plans/:bundlePlanId/freight-autofill`

Same response; scoped by bundle plan id.

### Response `data`

Includes existing auto-fill fields **plus** load-details blocks:

```json
{
  "loadDescription": "41 bundle(s) for bundle plan BP-0004",
  "weight": 58475.4,
  "dimensions": {
    "lengthFeet": 51,
    "widthFeet": 8.5,
    "heightFeet": 8
  },
  "metalType": "framing, panels, trim",
  "packageCount": 41,
  "bundlePlan": { ... },
  "packingListPlan": { ... },
  "bundles": [ ... ],
  "packingLists": [ ... ]
}
```

| Field | UI use |
|-------|--------|
| `loadDescription` | Default description field |
| `weight` | Total load weight (lbs) |
| `dimensions` | Max envelope from bundles |
| `metalType` | Material / bundle types summary |
| `packageCount` | Package / bundle count |
| `bundles`, `packingLists` | Expandable tables on freight form preview |

**UI:** Show truck breakdown (`packingLists`) and bundle list (`bundles`) below the summary fields so plant users can verify load before sending bids.

---

## 3. Delivery detail APIs

Load-details blocks appear on the nested `delivery` object.

### `GET /api/plant/deliveries/:deliveryId/detail`

### `GET /api/plant/projects/:leadId/delivery`

Selected / confirmed delivery for the project (404 if none).

### New fields on `data.delivery`

```json
{
  "delivery": {
    "deliveryId": "...",
    "deliveryNumber": "DEL-00012",
    "status": "carrier_selected",
    "formDetails": { ... },
    "deliveryTypeAndSize": {
      "bundleCount": 41,
      "packageCount": 2,
      "totalWeight": 58475.4
    },
    "bundlePlan": { ... },
    "packingListPlan": { ... },
    "bundles": [ ... ],
    "packingLists": [ ... ],
  }
}
```

**UI:** Freight detail / awarded load screens can show full truck and bundle breakdown without calling load-planning APIs separately.

---

## 4. Carrier bid page (public)

No JWT. Token comes from the email link (`/carrier/:token` on the client).

### `GET /api/public/freight-bids/:token`

Returns bid context for the carrier submission form.

### Response `data` (partial)

```json
{
  "bidId": "...",
  "status": "sent",
  "carrierName": "ABC Freight",
  "projectName": "Twin Creek",
  "jobId": "PRO-029",
  "deliveryNumber": "DEL-00012",
  "description": "41 bundle(s) for bundle plan BP-0004",
  "loadWeight": 58475.4,
  "dimensions": { "lengthFeet": 51, "widthFeet": 8.5, "heightFeet": 8 },
  "materialType": "framing, panels, trim",
  "packageCount": 41,
  "pickupLocation": "Plant Yard, Houston",
  "deliveryLocation": "Twin Creek Site, TX",
  "bidDeadline": "2026-06-18T18:00:00.000Z",
  "quotedAmount": null,
  "carrierNotes": "",
  "bundlePlan": { ... },
  "packingListPlan": { ... },
  "bundles": [ ... ],
  "packingLists": [ ... ]
}
```

### Submit bid — `POST /api/public/freight-bids/:token/submit`

```json
{
  "quotedAmount": 2450,
  "carrierNotes": "Can pickup Tuesday morning"
}
```

Load-details are **read-only** on GET; not required on submit.

**UI:** Carrier portal should render packing list / truck table and bundle table so carriers can price accurately.

---

## 5. Freight bid request email

When plant sends bids via:

- `POST /api/plant/deliveries/:deliveryId/send-bids`
- `POST /api/plant/projects/:projectId/freight/send-bids`

carriers receive an email that includes:

1. Project, job id, freight request #, load description, weight, pickup/delivery, deadline, bid link
2. **HTML tables** for packing lists/trucks and bundles (same columns as API summaries)
3. **Plain-text** bundle and packing list lines in the text body

No separate API call is needed for email content — it is generated server-side from the same load-details loader.

---

## 6. Frontend checklist

### Plant — freight request form

- [ ] Auto-fill: `GET /api/plant/projects/:projectId/freight-autofill`
- [ ] Display `packingLists` (trucks) and `bundles` tables on form preview
- [ ] Pre-fill `weight`, `dimensions`, `metalType`, `packageCount` from response

### Plant — delivery detail

- [ ] `GET /api/plant/projects/:leadId/delivery` or `GET /api/plant/deliveries/:id/detail`
- [ ] Show `bundles` / `packingLists` in freight detail panel

### Carrier portal

- [ ] `GET /api/public/freight-bids/:token` — render load tables for carrier
- [ ] `POST /api/public/freight-bids/:token/submit` — unchanged submit body

### Send bids

- [ ] `POST /api/plant/projects/:projectId/freight/send-bids` — email already includes load details

---

## 7. Quick endpoint index

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/plant/projects/:projectId/freight-autofill` | Plant | Freight form auto-fill + load details |
| GET | `/api/plant/bundle-plans/:bundlePlanId/freight-autofill` | Plant | Legacy auto-fill + load details |
| GET | `/api/plant/deliveries/:deliveryId/detail` | Plant | Delivery detail + load details |
| GET | `/api/plant/projects/:leadId/delivery` | Plant | Selected delivery + load details |
| GET | `/api/public/freight-bids/:token` | Public | Carrier bid page + load details |
| POST | `/api/public/freight-bids/:token/submit` | Public | Submit carrier bid |
| POST | `/api/plant/projects/:projectId/freight/send-bids` | Plant | Send bids (email includes tables) |
| POST | `/api/plant/deliveries/:deliveryId/send-bids` | Plant | Send bids by delivery id |

---

## Related docs

| Doc | Topic |
|-----|--------|
| [plant-frontend-api-updates-jun-2026.md](./plant-frontend-api-updates-jun-2026.md) | June 2026 plant panel batch updates |
| [plant-panel-api.md](./plant-panel-api.md) | Full plant API catalog (§21Z freight section) |
