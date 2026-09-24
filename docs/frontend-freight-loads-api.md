# Freight loads — Frontend integration

**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <staff_jwt>`

Use **`/api/admin/plant/...`** for the admin plant panel. Use **`/api/plant/...`** for the plant role (same handlers).

---

## 1. Filter lookups (dropdowns)

Load once (or refresh when data changes):

```http
GET /api/admin/plant/freight-loads/filters
Authorization: Bearer <token>
```

### Response `data` fields

| Field | Use for |
|--------|---------|
| `statuses` | Bid status dropdown (alias of `bidStatuses`) |
| `bidStatuses` | Same as `statuses` |
| `deliveryStatuses` | Delivery pipeline status dropdown |
| `carriers` | `{ _id, carrierName }[]` |
| `projects` | `{ _id, projectName, jobId }[]` |
| `customers` | `{ _id, name }[]` |
| `materialTypes` | `string[]` |
| `siteLocations` | `string[]` |
| `note` | Unsupported Figma filters (vendor, priority, etc.) |

### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "statuses": ["sent", "submitted", "resubmit_requested", "selected", "rejected", "expired"],
    "bidStatuses": ["sent", "submitted", "resubmit_requested", "selected", "rejected", "expired"],
    "deliveryStatuses": [
      "bidding_sent",
      "carrier_selected",
      "scheduled",
      "confirmed",
      "material_prepared",
      "loaded",
      "picked_up",
      "in_transit",
      "staged",
      "dispatched_to_site",
      "delivered",
      "partial_received",
      "received",
      "delayed",
      "cancelled",
      "rescheduled"
    ],
    "carriers": [{ "_id": "...", "carrierName": "ABC Freight" }],
    "projects": [{ "_id": "...", "projectName": "Warehouse A", "jobId": "PRO-001" }],
    "customers": [{ "_id": "...", "name": "Jane Doe" }],
    "materialTypes": ["Structural"],
    "siteLocations": ["123 Site Rd"],
    "note": "vendor, priority, internalOwner, and channel filters are not yet supported — no backing data exists for them."
  }
}
```

---

## 2. Enums (reference)

### Bid statuses (`bidStatuses` / `statuses`)

Use with **`GET .../deliveries/freight?status=`** (bid mode) or **`GET .../freight-loads?status=`**.

```
sent
submitted
resubmit_requested
selected
rejected
expired
```

### Delivery statuses (`deliveryStatuses`)

Use with **`GET .../deliveries/freight?status=`** (delivery mode). `draft` is excluded from the filters API.

```
bidding_sent
carrier_selected
scheduled
confirmed
material_prepared
loaded
picked_up
in_transit
staged
dispatched_to_site
delivered
partial_received
received
delayed
cancelled
rescheduled
```

---

## 3. Main list — delivery rows (recommended table)

One row per **delivery request** (freight workflow).

```http
GET /api/admin/plant/deliveries/freight?page=1&limit=20&status=submitted
Authorization: Bearer <token>
```

### Query parameters

| Param | Type | Default | Description |
|--------|------|---------|-------------|
| `page` | int | `1` | Page number (≥ 1) |
| `limit` | int | `20` | Page size (1–200) |
| `search` | string | — | Delivery #, description, locations, POC, material; also project name / job id |
| `status` | string | — | **Bid status** or **delivery status** (see below) |
| `projectId` | ObjectId | — | Filter by lead / project |
| `customerId` | ObjectId | — | Filter by customer (via lead) |
| `carrierId` | ObjectId | — | **Selected** carrier only (after award) |
| `fromDate` | ISO8601 | — | `deliveryDate` ≥ start of day |
| `toDate` | ISO8601 | — | `deliveryDate` ≤ end of day |

### How `status` works on this endpoint

| `status` value | Behavior |
|----------------|----------|
| One of **bid statuses** (`submitted`, `sent`, …) | Deliveries that have **≥1 freight bid** with that status. `selected` also includes deliveries with `selectedCarrierBidId` set. |
| One of **delivery statuses** (`bidding_sent`, `in_transit`, …) | Filters **`Delivery.status`** exactly. |
| Omitted | All deliveries except `draft`. |

**Important:** Each item in `requests[].status` is always **delivery status**, not bid status.

### Example requests

Bid filter (typical — matches `freight-loads/filters` → `statuses`):

```http
GET /api/admin/plant/deliveries/freight?page=1&limit=20&status=submitted
```

Delivery pipeline filter:

```http
GET /api/admin/plant/deliveries/freight?page=1&limit=20&status=bidding_sent
```

With project + search:

```http
GET /api/admin/plant/deliveries/freight?page=1&limit=20&projectId=66f1a2b3c4d5e6f7a8b9c0d1&search=PRO-001
```

### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "requests": [
      {
        "_id": "66f1a2b3c4d5e6f7a8b9c0d3",
        "requestId": "66f1a2b3c4d5e6f7a8b9c0d3",
        "deliveryNumber": "DEL-2026-0012",
        "status": "bidding_sent",
        "deliveryTime": null,
        "project": {
          "_id": "66f1a2b3c4d5e6f7a8b9c0d1",
          "jobId": "PRO-001",
          "projectName": "ABC Warehouse"
        },
        "customer": {
          "_id": "...",
          "name": "Jane Doe",
          "email": "jane@example.com"
        },
        "shipperVendor": null,
        "carrier": null,
        "description": "Structural steel load",
        "pickupLocation": "Plant yard",
        "deliveryLocation": "Site A",
        "awardedBidAmount": null,
        "loadSize": {
          "weight": 8500,
          "dimensions": {},
          "packageCount": 12
        },
        "poc": {
          "receivingPoc": "Site foreman",
          "pickupContactPhone": "+15551234567"
        },
        "equipment": [],
        "pickupDate": "2026-09-24T00:00:00.000Z",
        "deliveryDate": "2026-09-25T00:00:00.000Z",
        "createdAt": "2026-09-20T10:00:00.000Z",
        "updatedAt": "2026-09-22T15:00:00.000Z"
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

### Stats (summary cards)

```http
GET /api/admin/plant/deliveries/freight/stats
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalLoads": 50,
    "requestedLoads": 48,
    "bidsPending": 6,
    "inTransit": 8,
    "delivered": 15,
    "totalSpent": 125000.5
  }
}
```

---

## 4. Alternate list — one row per freight bid

Use when the UI shows **bid token**, carrier quote, and **bid status** per row.

```http
GET /api/admin/plant/freight-loads?page=1&limit=20&status=submitted
Authorization: Bearer <token>
```

### Query parameters

| Param | Type | Description |
|--------|------|-------------|
| `page` | int | Default `1` |
| `limit` | int | Default `20`, max `200` |
| `status` | enum | **Bid statuses only** (validated server-side) |
| `carrierId` | ObjectId | Bid’s carrier |
| `projectId` | ObjectId | Delivery’s lead |
| `customerId` | ObjectId | Lead’s customer |
| `materialType` | string | Exact match on delivery |
| `siteLocation` | string | Exact match on `deliveryLocation` |
| `startDate`, `endDate` | ISO8601 | Bid `createdAt` range |
| `search` | string | Token, project, job id, carrier name |

### Example response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalAwarded": 10,
      "inTransit": 4,
      "delivered": 3,
      "totalSpent": 45000,
      "requestedLoads": 8,
      "bidsPending": 5
    },
    "loads": [],
    "total": 25,
    "page": 1,
    "limit": 20
  }
}
```

**Export:** `GET /api/admin/plant/freight-loads/export` — same query params, Excel file (blob).

---

## 5. Awarded loads

### Delivery-based (carrier selected on delivery)

```http
GET /api/admin/plant/deliveries/awarded?page=1&limit=20
Authorization: Bearer <token>
```

Same query params as **§3**. Only deliveries with `selectedCarrierBidId` set. Rows may include `awardedCarrierId`.

**Stats:** `GET /api/admin/plant/deliveries/awarded/stats`

### Bid-based (fixed `status=selected`)

```http
GET /api/admin/plant/awarded-loads?page=1&limit=20&carrierId=...
Authorization: Bearer <token>
```

Query: `page`, `limit`, `carrierId`, `projectId`, `customerId`, `startDate`, `endDate`, `search` (no `status` param).

**Export:** `GET /api/admin/plant/awarded-loads/export`

---

## 6. UI wiring cheat sheet

| Dropdown source | List endpoint | Query param |
|-----------------|---------------|-------------|
| `data.statuses` / `data.bidStatuses` from filters | `GET .../deliveries/freight` | `status=<bid enum>` |
| `data.deliveryStatuses` from filters | `GET .../deliveries/freight` | `status=<delivery enum>` |
| Bid-level table | `GET .../freight-loads` | `status=<bid enum>` only |
| Carrier (delivery list) | `GET .../deliveries/freight` | `carrierId` = **awarded** carrier |
| Carrier (bid list) | `GET .../freight-loads` | `carrierId` = bid carrier |
| Project | Both lists | `projectId` |
| Customer | Both lists | `customerId` |

---

## 7. Errors

Standard wrapper:

```json
{
  "success": false,
  "message": "Invalid carrierId"
}
```

Validation (e.g. invalid `status` on `freight-loads`):

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "param": "status", "msg": "Invalid value", "location": "query" }]
}
```

---

## Related backend docs

- `docs/admin-plant-freight-deliveries-api.md` — full backend reference
- `docs/admin-and-plant-fixes-2026-09-23.md` — broader admin/plant integration notes
