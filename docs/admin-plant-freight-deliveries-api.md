# Admin & Plant — Freight deliveries API

**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** Staff JWT — `Authorization: Bearer <access_token>`

The same handlers run under both prefixes:

| Panel | Prefix |
|--------|--------|
| Admin plant | `/api/admin/plant/deliveries` |
| Plant | `/api/plant/deliveries` |

Admin plant requests use `adminPlantScope` (all approved PO projects). Plant requests are scoped to the user’s assigned projects.

**Response envelope (JSON):**

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Validation failures return HTTP **400** with `success: false` and an `errors` array from `express-validator`.

---

## Status enums (read this first)

There are **two different `status` concepts** in the freight UI. Using the wrong one (e.g. `submitted` on the deliveries list) returns empty results.

### Delivery status (`Delivery.status`)

Used by **`GET .../deliveries/freight`**, **`GET .../deliveries/awarded`**, and delivery row `status` in responses.

| Group | Values |
|--------|--------|
| Bidding / scheduling | `draft`, `bidding_sent`, `carrier_selected`, `scheduled`, `confirmed` |
| Fulfillment | `material_prepared`, `loaded`, `picked_up`, `in_transit`, `staged`, `dispatched_to_site`, `delivered` |
| Other | `partial_received`, `received`, `delayed`, `cancelled`, `rescheduled` |

**Canonical source:** `DELIVERY_STATUSES` in `src/config/constants.js`.

**Default list behavior:** if `status` is **omitted**, lists exclude `draft` (`status != draft`).

**Query validation:** `status` is only checked as a non-empty string (no server-side `isIn` on the query). The value must match a stored **delivery** status to return rows.

**“In transit” rollup** (used in stats cards): delivery status is one of  
`material_prepared`, `loaded`, `picked_up`, `in_transit`, `dispatched_to_site`.

### Freight bid status (`FreightBid.status`)

Used by **`GET .../freight-loads`** (under `extras`, see below), **not** by `GET .../deliveries/freight`.

| Value | Meaning (typical) |
|--------|-------------------|
| `sent` | Bid request sent to carrier |
| `submitted` | Carrier submitted a quote |
| `resubmit_requested` | Plant asked carrier to revise |
| `selected` | Winning bid |
| `rejected` | Not selected / rejected |
| `expired` | Bid window expired |

**Canonical source:** `FREIGHT_BID_STATUSES` in `src/config/constants.js`.

**Query validation:** `status` must be one of the values above (`isIn(FREIGHT_BID_STATUSES)`).

---

## 1. List freight loads (delivery-centric)

**`GET /api/admin/plant/deliveries/freight`**  
**`GET /api/plant/deliveries/freight`**

Paginated **delivery requests** in the freight workflow (one row per delivery), with project, optional selected carrier, and load details.

### Query parameters

| Parameter | Required | Validation | Filters on |
|-----------|----------|------------|------------|
| `page` | No | Integer ≥ 1 (default `1`) | Pagination |
| `limit` | No | Integer 1–200 (default `20`) | Pagination |
| `search` | No | String, trimmed | Case-insensitive match on delivery fields **or** lead `projectName` / `jobId` (see below) |
| `status` | No | String, trimmed | **`Delivery.status`** — use delivery enum above, **not** `submitted` |
| `projectId` | No | String, trimmed | **`Delivery.leadId`** if value is a valid MongoDB ObjectId; invalid IDs are ignored |
| `customerId` | No | MongoDB ObjectId | Lead’s **`customerId`** (post-lookup on lead) |
| `carrierId` | No | MongoDB ObjectId | **Selected** carrier only (`selectedCarrierBidId` → bid → carrier). Invalid ID → **400** `Invalid carrierId` |
| `fromDate` | No | ISO 8601 date | **`Delivery.deliveryDate`** ≥ start of that day (UTC-normalized) |
| `toDate` | No | ISO 8601 date | **`Delivery.deliveryDate`** ≤ end of that day |

### Search fields (when `search` is set)

Matches (regex, case-insensitive) any of:

- `deliveryNumber`, `description`, `loadDescription`, `pickupLocation`, `deliveryLocation`, `deliveryTime`, `receivingPoc`, `loadingEquipment`, `materialType`
- Lead `projectName`, `jobId`

### Response `data`

| Field | Type | Description |
|--------|------|-------------|
| `requests` | array | Mapped delivery rows (newest `createdAt` first) |
| `total` | number | Total matching deliveries (after all pipeline filters) |
| `page` | number | Current page |
| `limit` | number | Page size |

Each item in `requests` (representative shape):

```json
{
  "_id": "...",
  "requestId": "...",
  "deliveryNumber": "DEL-...",
  "status": "bidding_sent",
  "deliveryTime": null,
  "project": { "_id": "...", "jobId": "...", "projectName": "..." },
  "customer": { "_id": "...", "name": "...", "email": "..." },
  "shipperVendor": { "_id": "...", "vendorName": "...", "vendorCode": "..." },
  "carrier": { "_id": "...", "carrierName": "..." },
  "description": "...",
  "pickupLocation": "...",
  "deliveryLocation": "...",
  "awardedBidAmount": null,
  "loadSize": { "weight": null, "dimensions": {}, "packageCount": null },
  "poc": { "receivingPoc": "", "pickupContactPhone": "" },
  "equipment": [],
  "pickupDate": null,
  "deliveryDate": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`customer` may be null if the lead has no populated customer. `carrier` is null until a carrier bid is selected on the delivery.

### Example

```http
GET /api/admin/plant/deliveries/freight?page=1&limit=20&status=bidding_sent
Authorization: Bearer <token>
```

---

## 2. Freight load stats (delivery-centric)

**`GET /api/admin/plant/deliveries/freight/stats`**  
**`GET /api/plant/deliveries/freight/stats`**

No query parameters.

Aggregates over non-draft deliveries for scoped lead IDs.

### Response `data`

| Field | Description |
|--------|-------------|
| `totalLoads` | Deliveries with `status != draft` |
| `requestedLoads` | Same set excluding `cancelled` |
| `bidsPending` | Deliveries with no `selected` bid but at least one bid `sent` or **`submitted`** (bid-level logic) |
| `inTransit` | Delivery status in in-transit rollup set |
| `delivered` | Delivery status `delivered` |
| `totalSpent` | Sum of `quotedAmount` on **selected** carrier bids (2 decimal places) |

---

## 3. List awarded loads (delivery-centric)

**`GET /api/admin/plant/deliveries/awarded`**  
**`GET /api/plant/deliveries/awarded`**

Same query parameters and response shape as **§1**, with these differences:

- Only deliveries with **`selectedCarrierBidId` set** (carrier awarded).
- Each row may include **`awardedCarrierId`** (same as `carrier._id` when present).

---

## 4. Awarded load stats (delivery-centric)

**`GET /api/admin/plant/deliveries/awarded/stats`**  
**`GET /api/plant/deliveries/awarded/stats`**

No query parameters.

### Response `data`

| Field | Description |
|--------|-------------|
| `totalAwarded` | Deliveries with a selected carrier bid |
| `inTransit` | In-transit rollup on those deliveries |
| `delivered` | Status `delivered` |
| `totalSpent` | Sum of selected bid `quotedAmount` |

---

## 5. Freight loads — bid-centric (extras)

Use these when filtering by **`submitted`**, **`sent`**, etc.

**Prefix:** `/api/admin/plant` or `/api/plant` (extras router mounted at plant root).

### 5.1 Filter lookups

**`GET /api/admin/plant/freight-loads/filters`**  
**`GET /api/plant/freight-loads/filters`**

No query parameters.

### Response `data`

| Field | Description |
|--------|-------------|
| `statuses` | `FREIGHT_BID_STATUSES` (bid enum table above) |
| `carriers` | `{ _id, carrierName }[]` |
| `projects` | `{ _id, projectName, jobId }[]` |
| `customers` | `{ _id, name }[]` |
| `materialTypes` | string[] from deliveries linked to bids |
| `siteLocations` | string[] (`deliveryLocation` on those deliveries) |
| `note` | Documents unsupported Figma filter dimensions |

### 5.2 List freight bids

**`GET /api/admin/plant/freight-loads`**  
**`GET /api/plant/freight-loads`**

| Parameter | Required | Validation | Filters on |
|-----------|----------|------------|------------|
| `page` | No | Integer ≥ 1 (default `1`) | Pagination (applied after in-memory filters) |
| `limit` | No | Integer 1–200 (default `20`) | Pagination |
| `status` | No | **`FREIGHT_BID_STATUSES`** | **`FreightBid.status`** |
| `carrierId` | No | MongoDB ObjectId | **`FreightBid.carrierId`** |
| `projectId` | No | MongoDB ObjectId | Delivery’s lead `_id` (in-memory) |
| `customerId` | No | MongoDB ObjectId | Lead’s `customerId` (in-memory) |
| `materialType` | No | String, trimmed | **`Delivery.materialType`** (in-memory, exact match) |
| `siteLocation` | No | String, trimmed | **`Delivery.deliveryLocation`** (in-memory, exact match) |
| `deliveryId` | No | *(not validated on route)* | **`FreightBid.deliveryId`** when provided in controller |
| `startDate` | No | ISO 8601 | **`FreightBid.createdAt`** ≥ start (via `buildDateFilter`) |
| `endDate` | No | ISO 8601 | **`FreightBid.createdAt`** ≤ end |
| `search` | No | String, trimmed | Token, project name, job ID, carrier name (in-memory, case-insensitive) |

Bids whose delivery or lead was deleted are excluded.

### Response `data`

| Field | Description |
|--------|-------------|
| `stats` | Card metrics: `totalAwarded`, `inTransit`, `delivered`, `totalSpent`, `requestedLoads`, `bidsPending` (bid status counts) |
| `loads` | Page of populated **`FreightBid`** documents |
| `total` | Count after filters |
| `page`, `limit` | Pagination |

### Example (submitted bids)

```http
GET /api/admin/plant/freight-loads?page=1&limit=20&status=submitted
Authorization: Bearer <token>
```

### 5.3 Export freight loads

**`GET /api/admin/plant/freight-loads/export`**  
**`GET /api/plant/freight-loads/export`**

Same query filters as **§5.2** (no `page` / `limit`). Returns **Excel** (`.xlsx`), not JSON.

---

## 6. Awarded loads — bid-centric (extras)

**`GET /api/admin/plant/awarded-loads`**  
**`GET /api/plant/awarded-loads`**

Always restricted to **`FreightBid.status === 'selected'`** (no `status` query param).

| Parameter | Required | Validation | Filters on |
|-----------|----------|------------|------------|
| `page` | No | Integer ≥ 1 (default `1`) | Pagination |
| `limit` | No | Integer 1–200 (default `20`) | Pagination |
| `carrierId` | No | MongoDB ObjectId | **`FreightBid.carrierId`** |
| `projectId` | No | MongoDB ObjectId | Lead on delivery (in-memory) |
| `customerId` | No | MongoDB ObjectId | Lead customer (in-memory) |
| `startDate` | No | ISO 8601 | **`FreightBid.createdAt`** |
| `endDate` | No | ISO 8601 | **`FreightBid.createdAt`** |
| `search` | No | String, trimmed | Token, project, job ID, carrier (in-memory) |

Response shape matches **§5.2** (`stats`, `loads`, `total`, `page`, `limit`).

**Export:** `GET .../awarded-loads/export` — Excel, same filters as above (no pagination).

---

## Quick mapping for frontend filters

| UI filter intent | Endpoint | Query param | Enum |
|------------------|----------|-------------|------|
| Delivery pipeline stage | `GET .../deliveries/freight` | `status` | **Delivery** statuses |
| Carrier submitted a bid | `GET .../freight-loads` | `status=submitted` | **Freight bid** statuses |
| Bids sent, awaiting quote | `GET .../freight-loads` | `status=sent` | **Freight bid** statuses |
| Only awarded deliveries | `GET .../deliveries/awarded` | `status` (optional delivery filter) | **Delivery** statuses |
| Only selected bids | `GET .../awarded-loads` | *(fixed `selected`)* | N/A |

---

## Related: manual delivery status update

**`PATCH /api/admin/plant/deliveries/:deliveryId/status`**  
**`PATCH /api/plant/deliveries/:deliveryId/status`**

Body:

```json
{ "status": "<delivery_status>" }
```

**Allowed body values** (`MANUALLY_SETTABLE_DELIVERY_STATUSES`): all `DELIVERY_STATUSES` except  
`draft`, `bidding_sent`, `carrier_selected` (those are set by bidding flows).

---

*Generated from route validators and controllers: `src/routes/admin/plant/delivery.routes.js`, `src/routes/plant/delivery.routes.js`, `src/controllers/plant/delivery.controller.js`, `src/routes/admin/plant/extras.routes.js`, `src/controllers/plant/extras.controller.js`, `src/config/constants.js`.*
