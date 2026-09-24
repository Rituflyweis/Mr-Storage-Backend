# Awarded freight loads — Frontend integration

**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <staff_jwt>`

Use **`/api/admin/plant/...`** for admin plant. Use **`/api/plant/...`** for plant role (same handlers).

This doc covers the **delivery-centric awarded list** (`.../deliveries/awarded`). For a **bid-centric** list, see **§6**.

---

## 1. Filter lookups (shared with freight loads)

Reuse the same dropdown API as the main freight screen:

```http
GET /api/admin/plant/freight-loads/filters
Authorization: Bearer <token>
```

| Field | Use on awarded list |
|--------|---------------------|
| `deliveryStatuses` | **`status` query** on `.../deliveries/awarded` (recommended for awarded UI) |
| `bidStatuses` / `statuses` | Optional on `.../deliveries/awarded` (see §3 — often empty for awarded rows) |
| `carriers` | `carrierId` (selected / awarded carrier) |
| `projects` | `projectId` |
| `customers` | `customerId` |

See **`docs/frontend-freight-loads-api.md`** for full filter response example and enum lists.

---

## 2. Delivery statuses (recommended for awarded `status` filter)

From `deliveryStatuses` in filter lookups (`draft` excluded):

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

**Typical awarded filters:** `scheduled`, `confirmed`, `in_transit`, `delivered`, `delayed`.

---

## 3. Main list — awarded deliveries

One row per **delivery** that already has a **selected carrier** (`selectedCarrierBidId` set).

```http
GET /api/admin/plant/deliveries/awarded?page=1&limit=20
Authorization: Bearer <token>
```

Plant:

```http
GET /api/plant/deliveries/awarded?page=1&limit=20
Authorization: Bearer <token>
```

### Query parameters

| Param | Type | Default | Description |
|--------|------|---------|-------------|
| `page` | int | `1` | Page (≥ 1) |
| `limit` | int | `20` | Page size (1–200) |
| **`status`** | string | — | **Optional.** Delivery and/or bid status filter (§4) |
| `search` | string | — | Delivery #, locations, project name, job id, etc. |
| `projectId` | ObjectId | — | Lead / project id |
| `customerId` | ObjectId | — | Customer (via lead) |
| `carrierId` | ObjectId | — | **Awarded (selected) carrier** only |
| `fromDate` | ISO8601 | — | `deliveryDate` ≥ start of day |
| `toDate` | ISO8601 | — | `deliveryDate` ≤ end of day |

There is **no** strict enum validation on `status` in the query string; invalid values simply return no matches.

### Base rule (always applied)

Only deliveries where a carrier has been **awarded**:

- `selectedCarrierBidId != null`

Non-awarded freight requests never appear on this endpoint (use `GET .../deliveries/freight` instead).

If `status` is **omitted**, results exclude **`draft`** deliveries (same as freight list).

---

## 4. How `status` works

Same logic as **`GET .../deliveries/freight`**.

| `status` value | Behavior |
|----------------|----------|
| **Delivery status** (e.g. `in_transit`, `delivered`, `scheduled`) | Filters **`Delivery.status`**. **Use this for the Awarded screen.** |
| **Bid status** (`sent`, `submitted`, `resubmit_requested`, `selected`, `rejected`, `expired`) | Deliveries that have **≥1 freight bid** with that status **and** pass the awarded rule above. |
| Omitted | All awarded, non-draft deliveries |

**Bid statuses for reference:**

```
sent
submitted
resubmit_requested
selected
rejected
expired
```

**FE note:** On an **awarded** list, `status=submitted` or `status=sent` often returns **zero rows** because those states usually apply to loads still in bidding. Prefer **`deliveryStatuses`** for tabs/filters (In transit, Delivered, etc.).

Row field **`requests[].status`** is always **delivery status**, not bid status.

---

## 5. Example requests & responses

### List — no status (all awarded)

```http
GET /api/admin/plant/deliveries/awarded?page=1&limit=20
Authorization: Bearer <token>
```

### List — delivery status filter

```http
GET /api/admin/plant/deliveries/awarded?page=1&limit=20&status=in_transit
Authorization: Bearer <token>
```

```http
GET /api/admin/plant/deliveries/awarded?page=1&limit=20&status=delivered&projectId=66f1a2b3c4d5e6f7a8b9c0d1
Authorization: Bearer <token>
```

### List — carrier + date range

```http
GET /api/admin/plant/deliveries/awarded?page=1&limit=20&carrierId=66f1a2b3c4d5e6f7a8b9c0d9&fromDate=2026-09-01&toDate=2026-09-30
Authorization: Bearer <token>
```

### Example response `200`

Same shape as `GET .../deliveries/freight`, plus **`awardedCarrierId`** on each row when a carrier is present.

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
        "status": "in_transit",
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
        "carrier": {
          "_id": "66f1a2b3c4d5e6f7a8b9c0d9",
          "carrierName": "ABC Freight"
        },
        "awardedCarrierId": "66f1a2b3c4d5e6f7a8b9c0d9",
        "awardedBidAmount": 4200,
        "pickupLocation": "Plant yard",
        "deliveryLocation": "Site A",
        "deliveryDate": "2026-09-25T00:00:00.000Z",
        "createdAt": "2026-09-20T10:00:00.000Z",
        "updatedAt": "2026-09-23T08:00:00.000Z"
      }
    ],
    "total": 18,
    "page": 1,
    "limit": 20
  }
}
```

### Stats (summary cards)

No query filters — all awarded deliveries in scope.

```http
GET /api/admin/plant/deliveries/awarded/stats
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalAwarded": 18,
    "inTransit": 6,
    "delivered": 9,
    "totalSpent": 87500.25
  }
}
```

| Field | Meaning |
|--------|---------|
| `totalAwarded` | Deliveries with selected carrier bid |
| `inTransit` | Delivery status in in-transit rollup |
| `delivered` | `status === delivered` |
| `totalSpent` | Sum of selected bid `quotedAmount` |

---

## 6. Alternate API — bid rows (`awarded-loads`)

Different path, different model. Use only if the UI is **one row per winning bid**, not per delivery.

```http
GET /api/admin/plant/awarded-loads?page=1&limit=20
Authorization: Bearer <token>
```

| | `deliveries/awarded` | `awarded-loads` |
|--|----------------------|-----------------|
| Row | Delivery | Freight bid |
| Award rule | `selectedCarrierBidId` on delivery | `FreightBid.status === 'selected'` only |
| **`status` query** | **Yes** (§4) | **No** |
| Response key | `requests` | `loads` (+ `stats`) |

**Export:** `GET /api/admin/plant/awarded-loads/export` (Excel, blob).

Query on `awarded-loads`: `page`, `limit`, `carrierId`, `projectId`, `customerId`, `startDate`, `endDate`, `search`.

---

## 7. UI wiring cheat sheet

| UI need | Endpoint | Filter param |
|---------|----------|--------------|
| Awarded table (delivery rows) | `GET .../deliveries/awarded` | `status` = `deliveryStatuses` |
| In transit / delivered tabs | `GET .../deliveries/awarded?status=in_transit` | delivery enum |
| Filter by winning carrier | `GET .../deliveries/awarded?carrierId=` | selected carrier |
| Summary cards | `GET .../deliveries/awarded/stats` | — |
| Dropdown data | `GET .../freight-loads/filters` | use `deliveryStatuses`, `carriers`, … |
| Bid-level awarded grid | `GET .../awarded-loads` | no `status`; fixed selected bids |

---

## 8. Errors

```json
{
  "success": false,
  "message": "Invalid carrierId"
}
```

Invalid `carrierId` on list → **400**.

---

## Related docs

- `docs/frontend-freight-loads-api.md` — freight list + filter enums
- `docs/admin-plant-freight-deliveries-api.md` — backend reference
- `docs/admin-and-plant-fixes-2026-09-23.md` — broader admin/plant notes
