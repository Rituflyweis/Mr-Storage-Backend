# Plant Panel — Freight Loads & Awarded Loads filters (4.1.1)

**Status:** Ready  
**Date:** 29 Oct 2026  
**Auth:** `Authorization: Bearer <plant|admin JWT>`  
**Base (UAT):** `https://mr-storage-backend-025k.onrender.com`

Same handlers under Plant and Admin. Swap the prefix only.

| Role | Prefix |
|------|--------|
| Plant | `/api/plant` |
| Admin (Plant section) | `/api/admin/plant` |

---

## 1. What these endpoints are for

Populate **filter dropdowns** on:

- **Freight Loads** screen
- **Awarded Loads** screen

They return option lists only (no table rows). Call once on screen mount (and optionally after awarding / creating loads if dropdowns look stale).

**Awarded** uses the **same option set** as Freight — dedicated alias so FE can call a path that matches the screen name.

---

## 2. Endpoints

| Screen | Method | Path |
|--------|--------|------|
| Freight | `GET` | `{prefix}/freight-loads/filters` |
| Awarded | `GET` | `{prefix}/awarded-loads/filters` |

Both hit **`getFreightLoadFilters`** — identical JSON.

### Examples

```http
GET /api/plant/freight-loads/filters
Authorization: Bearer <token>
```

```http
GET /api/plant/awarded-loads/filters
Authorization: Bearer <token>
```

```http
GET /api/admin/plant/freight-loads/filters
Authorization: Bearer <token>
```

```http
GET /api/admin/plant/awarded-loads/filters
Authorization: Bearer <token>
```

```bash
BASE=https://mr-storage-backend-025k.onrender.com/api/plant
TOKEN=…

curl -s "$BASE/freight-loads/filters" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/awarded-loads/filters" -H "Authorization: Bearer $TOKEN"
```

No query params required. **No request body** (GET).

---

## 3. Example request & response (filters)

### 3.1 Freight — request

```http
GET /api/plant/freight-loads/filters HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

```bash
curl -s -X GET \
  "https://mr-storage-backend-025k.onrender.com/api/plant/freight-loads/filters" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json"
```

**Request payload:** none (no body, no query).

### 3.2 Awarded alias — request (identical response)

```http
GET /api/plant/awarded-loads/filters HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

Admin: replace `/api/plant` with `/api/admin/plant`.

### 3.3 Response payload (same for both)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "statuses": [
      "sent",
      "submitted",
      "resubmit_requested",
      "selected",
      "rejected",
      "expired"
    ],
    "bidStatuses": [
      "sent",
      "submitted",
      "resubmit_requested",
      "selected",
      "rejected",
      "expired"
    ],
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
    "carriers": [
      {
        "_id": "670a1b2c3d4e5f6789012345",
        "carrierName": "ABC Freight"
      },
      {
        "_id": "670a1b2c3d4e5f6789012346",
        "carrierName": "Swift Logistics"
      }
    ],
    "projects": [
      {
        "_id": "66f0aa11bb22cc33dd44ee55",
        "projectName": "Warehouse A",
        "jobId": "2026241"
      },
      {
        "_id": "66f0aa11bb22cc33dd44ee56",
        "projectName": "Retail Buildout",
        "jobId": "2026242"
      }
    ],
    "customers": [
      {
        "_id": "66e011223344556677889900",
        "name": "Jane Doe"
      },
      {
        "_id": "66e011223344556677889901",
        "name": "Brandon Cutts"
      }
    ],
    "materialTypes": ["Structural", "Panels"],
    "siteLocations": ["123 Site Rd, NY", "NY, NY 10001"],
    "note": "vendor, priority, internalOwner, and channel filters are not yet supported — no backing data exists for them."
  }
}
```

Empty DB (no bids yet) still returns enums; arrays for `carriers` / `projects` / `customers` / `materialTypes` / `siteLocations` are `[]`.

### Field reference

| Field | Type | UI control | Notes |
|-------|------|------------|-------|
| `statuses` | `string[]` | Bid status dropdown | Alias of `bidStatuses` (prefer either; same values) |
| `bidStatuses` | `string[]` | Bid status dropdown | Freight bid lifecycle |
| `deliveryStatuses` | `string[]` | Delivery status dropdown | `draft` intentionally omitted |
| `carriers` | `{ _id, carrierName }[]` | Carrier dropdown | Only carriers that already have ≥1 freight bid |
| `projects` | `{ _id, projectName, jobId }[]` | Project dropdown | Leads linked to deliveries that have bids; `_id` = **leadId** → pass as `projectId` |
| `customers` | `{ _id, name }[]` | Client dropdown | Customers on those projects |
| `materialTypes` | `string[]` | Material type dropdown | Distinct `Delivery.materialType` values |
| `siteLocations` | `string[]` | Site / delivery location dropdown | Distinct `Delivery.deliveryLocation` values |
| `note` | `string` | Dev / QA | Figma dims **not** backed yet (see §6) |

Options are derived from **existing FreightBid → Delivery → Lead → Customer** data, not the full catalog of every carrier/customer in the system.

---

## 4. Wire filters → list APIs

Call filters for dropdowns; apply selections as query params on the **list** (and export) endpoints.

### 4.1 Freight Loads

| Dropdown value from filters | Query param on list | Bid list | Delivery list (recommended table) |
|-----------------------------|---------------------|----------|-----------------------------------|
| `bidStatuses` / `statuses` item | `status` | `GET …/freight-loads?status=` | `GET …/deliveries/freight?status=` (bid mode when value is a bid status) |
| `deliveryStatuses` item | `status` | — | `GET …/deliveries/freight?status=` |
| `carriers[]._id` | `carrierId` | ✅ | ✅ |
| `projects[]._id` | `projectId` | ✅ | ✅ |
| `customers[]._id` | `customerId` | ✅ | ✅ |
| `materialTypes[]` item | `materialType` | ✅ (`…/freight-loads`) | check delivery freight list if exposed |
| `siteLocations[]` item | `siteLocation` | ✅ (`…/freight-loads`) | — |
| free text | `search` | ✅ client + project + existing fields | ✅ |
| date range | `startDate` / `endDate` (ISO8601) | bid `createdAt` on `…/freight-loads` | see delivery docs (`fromDate`/`toDate` where used) |

**Primary list endpoints:**

```http
GET /api/plant/freight-loads?page=1&limit=20&status=submitted&carrierId=…&projectId=…&customerId=…&materialType=…&siteLocation=…&search=…
GET /api/plant/deliveries/freight?page=1&limit=20&status=…&carrierId=…&projectId=…&customerId=…&search=…
GET /api/plant/freight-loads/export?...same filters…
```

#### Example — apply filter selections to freight list

**Request** (query only; no body):

```http
GET /api/plant/freight-loads?page=1&limit=20&status=submitted&carrierId=670a1b2c3d4e5f6789012345&projectId=66f0aa11bb22cc33dd44ee55&customerId=66e011223344556677889900&materialType=Structural&siteLocation=NY%2C%20NY%2010001&search=Jane&startDate=2026-01-01&endDate=2026-12-31 HTTP/1.1
Authorization: Bearer <token>
```

**Response** (shape abbreviated):

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalAwarded": 2,
      "inTransit": 1,
      "delivered": 0,
      "totalSpent": 4500,
      "requestedLoads": 5,
      "bidsPending": 3
    },
    "loads": [
      {
        "_id": "6710…",
        "status": "submitted",
        "quotedAmount": 1200,
        "carrierId": { "_id": "670a…", "carrierName": "ABC Freight" },
        "deliveryId": {
          "_id": "670d…",
          "materialType": "Structural",
          "deliveryLocation": "NY, NY 10001",
          "leadId": {
            "_id": "66f0…",
            "projectName": "Warehouse A",
            "jobId": "2026241",
            "customerId": { "_id": "66e0…", "firstName": "Jane", "lastName": "Doe" }
          }
        }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### 4.2 Awarded Loads

Awarded bid list is always `FreightBid.status = selected`. Do **not** drive the main awarded table with `bidStatuses` (except optionally showing that everything is already `selected`).

| Dropdown value from filters | Query param | Bid awarded list | Delivery awarded list (recommended) |
|-----------------------------|-------------|------------------|-------------------------------------|
| `deliveryStatuses` item | `status` | — | `GET …/deliveries/awarded?status=` |
| `carriers[]._id` | `carrierId` | ✅ | ✅ (selected / awarded carrier) |
| `projects[]._id` | `projectId` | ✅ | ✅ |
| `customers[]._id` | `customerId` | ✅ | ✅ |
| free text | `search` | ✅ | ✅ |
| date range | `startDate` / `endDate` | bid dates on `…/awarded-loads` | `fromDate` / `toDate` on delivery awarded (see awarded doc) |

```http
GET /api/plant/awarded-loads?page=1&limit=20&carrierId=…&projectId=…&customerId=…&search=…
GET /api/plant/deliveries/awarded?page=1&limit=20&status=in_transit&carrierId=…&projectId=…&customerId=…&search=…
GET /api/plant/awarded-loads/export?...same filters…
```

Typical awarded delivery statuses: `scheduled`, `confirmed`, `in_transit`, `delivered`, `delayed`.

---

## 5. Enums (copy for labels)

### Bid statuses → `status` on freight bid lists

| Value | Suggested label |
|-------|-----------------|
| `sent` | Sent |
| `submitted` | Submitted |
| `resubmit_requested` | Resubmit requested |
| `selected` | Selected / Awarded |
| `rejected` | Rejected |
| `expired` | Expired |

### Delivery statuses → `status` on delivery lists

| Value | Suggested label |
|-------|-----------------|
| `bidding_sent` | Bidding sent |
| `carrier_selected` | Carrier selected |
| `scheduled` | Scheduled |
| `confirmed` | Confirmed |
| `material_prepared` | Material prepared |
| `loaded` | Loaded |
| `picked_up` | Picked up |
| `in_transit` | In transit |
| `staged` | Staged |
| `dispatched_to_site` | Dispatched to site |
| `delivered` | Delivered |
| `partial_received` | Partial received |
| `received` | Received |
| `delayed` | Delayed |
| `cancelled` | Cancelled |
| `rescheduled` | Rescheduled |

`draft` is **not** returned by filters and is excluded from default freight/awarded delivery lists.

---

## 6. Not supported yet (Figma vs API)

`data.note` flags these. Do **not** send them on freight/awarded list queries expecting results:

| Figma filter | Status |
|--------------|--------|
| Vendor | No backing join on freight/awarded load rows |
| Priority | No field on Delivery / FreightBid |
| Internal owner | No field for this screen |
| Channel / colorBy | No backing data |

(All-deliveries advanced filters have separate lookups under `…/all-deliveries/filters/lookups` — different screen.)

---

## 7. FE wiring checklist

1. On Freight / Awarded mount → `GET …/freight-loads/filters` **or** `GET …/awarded-loads/filters` (either is fine; Awarded can use the alias for clarity).
2. Bind dropdowns to `data.carriers`, `projects`, `customers`, `materialTypes`, `siteLocations`, and the right status array for the screen.
3. On change → refetch list with matching query params; debounce `search` (~300ms).
4. Pass the **same** filter query string to export endpoints.
5. Clear a dropdown → omit that query param (do not send empty string).
6. `projects[]._id` is the **lead** id — always send as `projectId`.
7. Prefer delivery-centric lists (`…/deliveries/freight`, `…/deliveries/awarded`) for the main Plant tables; bid lists (`…/freight-loads`, `…/awarded-loads`) are available when the UI is bid-row based.

---

## 8. Related docs

| Doc | Contents |
|-----|----------|
| [`freight-awarded-loads-search-fe.md`](./freight-awarded-loads-search-fe.md) | `search` = client name + project name / job id |
| [`../frontend-freight-loads-api.md`](../frontend-freight-loads-api.md) | Full Freight Loads API (lists, stats, export) |
| [`../frontend-awarded-loads-api.md`](../frontend-awarded-loads-api.md) | Full Awarded Loads API |
| [`../admin-plant-freight-deliveries-api.md`](../admin-plant-freight-deliveries-api.md) | Admin plant delivery freight/awarded details |
