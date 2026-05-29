# Plant Panel — Frontend API Reference

Frontend integration guide for the **Plant Panel** (`role: "plant"`).

> **Maintenance:** Add or update a section here whenever a plant panel endpoint is implemented or changed. Only document **completed** endpoints — no placeholders for work in progress.

---

## Base URL & auth

| Item | Value |
|------|--------|
| Base path | `/api/plant` |
| Required role | `plant` |
| Auth header | `Authorization: Bearer <access_token>` |

Plant users log in via the **shared** auth endpoint (same as admin/sales):

```http
POST /api/auth/login
Content-Type: application/json
```

**Request body**

```json
{
  "email": "plant.user@example.com",
  "password": "TempPass123"
}
```

**Response (`data`)**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "role": "plant",
  "user": {
    "_id": "665a00000000000000000001",
    "name": "Plant User",
    "email": "plant.user@example.com",
    "role": "plant"
  }
}
```

Use `accessToken` on all `/api/plant/*` requests. Refresh with `POST /api/auth/refresh` when expired.

---

## Response envelope

All endpoints return:

```json
// Success
{
  "success": true,
  "message": "Success",
  "data": { }
}

// Error
{
  "success": false,
  "message": "Human-readable error",
  "errors": []
}
```

`errors` is present only for validation failures (invalid query params, etc.).

---

## Project scope (all plant project APIs)

Every project endpoint only includes leads where:

1. A **PO order** exists with `status: "approved"`
2. That PO is **assigned to the logged-in plant user** (`assignedTo === user._id`)

Optional `startDate` / `endDate` filters apply to the PO order’s `createdAt` (not the lead’s).

---

## Shared enums

### `drawingStatus` (response + query filter)

| Value | Meaning |
|-------|---------|
| `none` | No drawings uploaded on any building |
| `pending` | At least one building’s latest drawing is `pending_review` |
| `rejected` | At least one building’s latest drawing is `rejected` (and none pending) |
| `all_approved` | Every building with drawings has latest version `approved` |

`bomStatus` is returned on each project row for display only (`none` \| `partial` \| `all_confirmed`) — it is **not** a query filter.

### Vendor `status`

`active` | `inactive`

### Vendor `vendorType`

`steel` | `insulation` | `panels` | `trim` | `hardware` | `other`

### Carrier `status`

`active` | `inactive`

---

## Index

| # | Method | Endpoint | Description |
|---|--------|----------|-------------|
| 1 | GET | `/api/plant/projects/stats` | Project KPI counts |
| 2 | GET | `/api/plant/projects` | Paginated project list |
| 3 | GET | `/api/plant/vendors` | List vendors / shippers |
| 4 | POST | `/api/plant/vendors` | Add vendor / shipper |
| 5 | GET | `/api/plant/vendors/:vendorId` | Vendor detail + stats + order history |
| 6 | PUT | `/api/plant/vendors/:vendorId` | Update vendor |
| 7 | PATCH | `/api/plant/vendors/:vendorId/toggle-status` | Toggle active / inactive |
| 8 | GET | `/api/plant/carriers` | List freight carriers |
| 9 | POST | `/api/plant/carriers` | Add freight carrier |
| 10 | GET | `/api/plant/carriers/:carrierId` | Carrier detail + stats + freight history |
| 11 | PUT | `/api/plant/carriers/:carrierId` | Update carrier |
| 12 | PATCH | `/api/plant/carriers/:carrierId/toggle-status` | Toggle active / inactive |

---

## 1. `GET /api/plant/projects/stats`

Summary counts for the projects screen header / stat cards.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `startDate` | ISO 8601 date | No | Filter PO orders from this date |
| `endDate` | ISO 8601 date | No | Filter PO orders through end of this day |

### Example request

```http
GET /api/plant/projects/stats?startDate=2026-01-01&endDate=2026-05-31
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalProjects": 24,
    "activeProjects": 18,
    "pendingCustomerApproval": 4,
    "cancelledProjects": 2
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `totalProjects` | number | All assigned approved PO projects in range |
| `activeProjects` | number | Projects where `isTerminated === false` |
| `pendingCustomerApproval` | number | Projects with at least one drawing awaiting customer review |
| `cancelledProjects` | number | Projects where `isTerminated === true` |

### Errors

| HTTP | When |
|------|------|
| 401 | Missing or invalid token |
| 403 | User role is not `plant` |
| 422 | Invalid `startDate` / `endDate` format |

---

## 2. `GET /api/plant/projects`

Paginated list of assigned projects for the plant projects table.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `startDate` | ISO 8601 date | No | — | PO order date range (from) |
| `endDate` | ISO 8601 date | No | — | PO order date range (to) |
| `projectId` | MongoDB ObjectId | No | — | Filter by project (lead `_id`) |
| `customerId` | MongoDB ObjectId | No | — | Filter by customer |
| `buildingType` | string | No | — | Exact match on lead `buildingType` |
| `drawingStatus` | string | No | — | `all_approved` \| `pending` \| `rejected` \| `none` |
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |

Filters compose with **AND** logic.

### Example request

```http
GET /api/plant/projects?projectId=665a00000000000000000002&buildingType=Commercial&drawingStatus=pending&page=1&limit=20
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "665a00000000000000000002",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "location": "Texas, USA",
        "clientName": "John Smith",
        "customer": {
          "firstName": "John",
          "lastName": "Smith"
        },
        "buildingType": "Commercial",
        "numberOfBuildings": 3,
        "quoteValue": 125000,
        "drawingStatus": "pending",
        "bomStatus": "partial",
        "lifecycleStatus": "converted_to_po",
        "isTerminated": false,
        "createdAt": "2025-01-15T00:00:00.000Z"
      }
    ],
    "total": 24,
    "page": 1,
    "limit": 20
  }
}
```

### Project object fields

| Field | Type | UI usage |
|-------|------|----------|
| `_id` | string | Lead / project ID — use for detail navigation |
| `projectName` | string | Project name column |
| `jobId` | string | Job / project reference ID |
| `location` | string | Location column |
| `clientName` | string | Pre-formatted `"First Last"` for client column |
| `customer` | object | `{ firstName, lastName }` if you need separate fields |
| `buildingType` | string | Building type filter/display |
| `numberOfBuildings` | number | Buildings count column |
| `quoteValue` | number | Project value / quote amount |
| `drawingStatus` | string | Drawing workflow badge — see enum above |
| `bomStatus` | string | BOM workflow badge — see enum above |
| `lifecycleStatus` | string | Lead lifecycle stage (informational) |
| `isTerminated` | boolean | `true` = cancelled project |
| `createdAt` | ISO date | Sort / display created date |

### Pagination

| Field | Type | Notes |
|-------|------|-------|
| `total` | number | Total matching projects **after** all filters (including `drawingStatus`) |
| `page` | number | Current page |
| `limit` | number | Page size |

Use `total` and `limit` to compute total pages: `Math.ceil(total / limit)`.

### Errors

| HTTP | When |
|------|------|
| 401 | Missing or invalid token |
| 403 | User role is not `plant` |
| 422 | Invalid query param (bad date, invalid `projectId` / `customerId`, invalid `drawingStatus`) |

---

## 3. `GET /api/plant/vendors`

List all material vendors / shippers.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `search` | string | No | — | Matches shipper name, contact name, or email |
| `materialType` | string | No | — | Filter vendors that include this material type |
| `status` | string | No | — | `active` \| `inactive` |
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |

### Example request

```http
GET /api/plant/vendors?search=steel&materialType=Panels&status=active&page=1&limit=20
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendors": [
      {
        "_id": "665a00000000000000000010",
        "vendorCode": "VND-0001",
        "vendorName": "ABC Steel",
        "contactName": "Mike Johnson",
        "email": "mike@abcsteel.com",
        "phone": "5551234567",
        "materialTypes": ["Steel", "Panels"],
        "vendorType": "steel",
        "status": "active",
        "pickupLocation": "Houston, TX",
        "activeOrders": 3,
        "totalOrders": 15
      }
    ],
    "total": 8,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `vendorName` | string | Shipper / vendor name |
| `contactName` | string | Primary contact |
| `email` | string | Contact email |
| `phone` | string | Contact phone |
| `materialTypes` | string[] | Materials supplied |
| `vendorType` | string | Vendor category |
| `status` | string | `active` or `inactive` |
| `pickupLocation` | string | Derived from address (`city, state`) |
| `activeOrders` | number | In-progress shipper requests |
| `totalOrders` | number | All shipper requests sent to this vendor |

---

## 4. `POST /api/plant/vendors`

Create a new vendor / shipper.

| | |
|---|---|
| **Role** | `plant` |

### Request body

```json
{
  "vendorName": "Metro Steel",
  "email": "orders@metrosteel.com",
  "phone": "5559876543",
  "contactName": "Sara Lee",
  "vendorCode": "VND-0009",
  "yearsWithCompany": 5,
  "serviceCategory": "Structural Steel Supply",
  "vendorType": "steel",
  "materialTypes": ["Steel", "Insulation"],
  "address": {
    "placeNumber": "120",
    "streetAddress": "Industrial Blvd",
    "landmark": "Near Port Gate 4",
    "city": "Houston",
    "state": "TX",
    "postalCode": "77001",
    "gpsCoordinates": { "lat": 29.7604, "lng": -95.3698 }
  },
  "documents": [
    { "name": "Insurance Certificate", "url": "https://bucket.s3.amazonaws.com/vendor-files/insurance.pdf" }
  ],
  "internalNotes": "Preferred vendor for Gulf Coast projects"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `vendorName` | Yes | Shipper name |
| `email` | Yes | Must be unique |
| `phone` | No | |
| `contactName` | No | |
| `vendorCode` | No | Auto-generated as `VND-0001`, `VND-0002`, … if omitted |
| `yearsWithCompany` | No | Number |
| `serviceCategory` | No | Free-text service description |
| `vendorType` | No | Default `other` |
| `materialTypes` | No | String array |
| `address` | No | Structured address object |
| `documents` | No | `{ name, url }[]` — upload files via presigned URL first |
| `internalNotes` | No | Internal-only notes |

### Response body

**HTTP status:** `201`

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "vendor": {
      "_id": "...",
      "vendorCode": "VND-0009",
      "vendorName": "Metro Steel",
      "email": "orders@metrosteel.com",
      "status": "active",
      "createdAt": "2026-05-28T10:00:00.000Z"
    }
  }
}
```

### Errors

| HTTP | When |
|------|------|
| 400 | Duplicate email or vendor code |
| 422 | Validation failure |

---

## 5. `GET /api/plant/vendors/:vendorId`

Full vendor detail with performance stats and approved order history.

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `vendorId` | MongoDB ObjectId | Yes |

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "665a00000000000000000010",
      "vendorCode": "VND-0001",
      "vendorName": "ABC Steel",
      "contactName": "Mike Johnson",
      "email": "mike@abcsteel.com",
      "phone": "5551234567",
      "yearsWithCompany": 8,
      "serviceCategory": "Steel & Panels",
      "vendorType": "steel",
      "materialTypes": ["Steel", "Panels"],
      "address": {
        "placeNumber": "45",
        "streetAddress": "Steel Ave",
        "landmark": "",
        "city": "Houston",
        "state": "TX",
        "postalCode": "77002",
        "gpsCoordinates": { "lat": 29.76, "lng": -95.37 }
      },
      "documents": [
        { "_id": "...", "name": "W9 Form", "url": "https://..." }
      ],
      "internalNotes": "Fast turnaround",
      "status": "active",
      "pickupLocation": "Houston, TX",
      "createdAt": "2025-06-01T00:00:00.000Z",
      "updatedAt": "2026-05-20T00:00:00.000Z"
    },
    "stats": {
      "totalOrders": 15,
      "completedDeliveries": 12,
      "activeOrders": 3,
      "bidsSubmitted": 14,
      "bidsSent": 15
    },
    "orderHistory": [
      {
        "_id": "...",
        "projectName": "ABC Warehouse",
        "jobId": "PRO-001",
        "quoteValue": 2100,
        "status": "approved",
        "submittedAt": "2025-02-22T00:00:00.000Z",
        "reviewedAt": "2025-02-24T00:00:00.000Z",
        "sentAt": "2025-02-20T00:00:00.000Z"
      }
    ]
  }
}
```

| Stats field | Meaning |
|-------------|---------|
| `totalOrders` | All shipper requests sent to this vendor |
| `completedDeliveries` | Approved shipper requests |
| `activeOrders` | In-progress requests (sent, submitted, under review, etc.) |
| `bidsSubmitted` | Requests where vendor uploaded a quote file |
| `bidsSent` | Same as total orders sent to vendor |

`orderHistory` includes **approved** shipper requests only.

---

## 6. `PUT /api/plant/vendors/:vendorId`

Update vendor fields. Send only fields to change. `vendorCode` is editable but must remain unique.

Same body fields as create (all optional on update).

**HTTP status:** `200` — returns `{ "vendor": { ...full updated document } }`

---

## 7. `PATCH /api/plant/vendors/:vendorId/toggle-status`

Toggle between `active` and `inactive`.

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendor": {
      "_id": "...",
      "status": "inactive"
    }
  }
}
```

---

## 8. `GET /api/plant/carriers`

List freight carriers.

| | |
|---|---|
| **Role** | `plant` |
| **Request body** | None (GET) |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `search` | string | No | — | Matches carrier name, contact name, or email |
| `serviceType` | string | No | — | Exact match |
| `serviceArea` | string | No | — | Exact match |
| `equipmentType` | string | No | — | Matches a fleet equipment name |
| `status` | string | No | — | `active` \| `inactive` |
| `page` | integer | No | `1` | Min `1` |
| `limit` | integer | No | `20` | Min `1`, max `200` |

### Example request

```http
GET /api/plant/carriers?search=express&serviceType=Hotshot&serviceArea=Texas&equipmentType=Flatbed&status=active
Authorization: Bearer <access_token>
```

### Response body

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carriers": [
      {
        "_id": "665a00000000000000000020",
        "carrierCode": "CAR-0001",
        "carrierName": "Express Freight Co",
        "contactName": "Tom Reed",
        "email": "dispatch@expressfreight.com",
        "phone": "5554443333",
        "serviceType": "Hotshot",
        "serviceArea": "Texas",
        "equipmentTypes": ["Flatbed", "Semi Trailer"],
        "status": "active",
        "activeBids": 2,
        "totalBids": 18,
        "awardedBidCount": 7,
        "bidWinRate": 38.9,
        "avgBid": 2450.5
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `activeBids` | number | Bids in `sent` or `submitted` status |
| `totalBids` | number | All bid requests sent to this carrier |
| `awardedBidCount` | number | Bids with status `selected` |
| `bidWinRate` | number | `awardedBidCount / submitted bids × 100` (0 if none submitted) |
| `avgBid` | number | Average `quotedAmount` across all bids |
| `equipmentTypes` | string[] | Equipment names from `fleetEquipment` |

---

## 9. `POST /api/plant/carriers`

Create a freight carrier.

### Request body

```json
{
  "carrierName": "Express Freight Co",
  "email": "dispatch@expressfreight.com",
  "phone": "5554443333",
  "contactName": "Tom Reed",
  "carrierCode": "CAR-0005",
  "serviceType": "Hotshot",
  "serviceArea": "Texas, Oklahoma",
  "address": {
    "placeNumber": "88",
    "streetAddress": "Logistics Park Rd",
    "landmark": "Gate B",
    "city": "Dallas",
    "state": "TX",
    "postalCode": "75201",
    "gpsCoordinates": { "lat": 32.7767, "lng": -96.797 }
  },
  "fleetEquipment": [
    { "equipmentName": "Flatbed", "quantity": 4 },
    { "equipmentName": "Semi Trailer", "quantity": 2 }
  ],
  "fleetCapacity": {
    "totalVehicleCount": 6,
    "maximumLoadCapacity": 48000,
    "averageFleetAge": 4.5
  },
  "documents": [
    { "name": "Operating Authority", "url": "https://bucket.s3.amazonaws.com/carrier-files/authority.pdf" }
  ],
  "internalNotes": "Reliable for Gulf Coast hotshot runs"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `carrierName` | Yes | |
| `email` | Yes | Must be unique |
| `carrierCode` | No | Auto `CAR-0001`, `CAR-0002`, … if omitted |
| `fleetEquipment` | No | `{ equipmentName, quantity }[]` |
| `fleetCapacity` | No | `totalVehicleCount`, `maximumLoadCapacity`, `averageFleetAge` |
| `documents` | No | `{ name, url }[]` |

**HTTP status:** `201` — returns `{ "carrier": { ... } }`

---

## 10. `GET /api/plant/carriers/:carrierId`

Full carrier document + performance stats + freight history.

### Response (`data`)

```json
{
  "carrier": {
    "_id": "...",
    "carrierCode": "CAR-0001",
    "carrierName": "Express Freight Co",
    "contactName": "Tom Reed",
    "email": "dispatch@expressfreight.com",
    "phone": "5554443333",
    "serviceType": "Hotshot",
    "serviceArea": "Texas",
    "address": { },
    "fleetEquipment": [ { "equipmentName": "Flatbed", "quantity": 4 } ],
    "fleetCapacity": {
      "totalVehicleCount": 6,
      "maximumLoadCapacity": 48000,
      "averageFleetAge": 4.5
    },
    "documents": [ { "_id": "...", "name": "Insurance", "url": "https://..." } ],
    "internalNotes": "",
    "status": "active",
    "equipmentTypes": ["Flatbed"],
    "createdAt": "...",
    "updatedAt": "..."
  },
  "stats": {
    "totalBids": 18,
    "activeBids": 2,
    "awardedBidCount": 7,
    "bidWinRate": 38.9,
    "avgBid": 2450.5,
    "lastAwardedDate": "2026-05-20T14:00:00.000Z",
    "avgResponseTimeHours": 6.5,
    "assignedProjects": 7
  },
  "freightHistory": [
    {
      "_id": "...",
      "deliveryNumber": "DEL-00012",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-001",
      "status": "selected",
      "quotedAmount": 2200,
      "currency": "USD",
      "sentAt": "2026-05-18T10:00:00.000Z",
      "submittedAt": "2026-05-18T16:30:00.000Z",
      "selectedAt": "2026-05-20T14:00:00.000Z",
      "pickupLocation": "Houston, TX",
      "deliveryLocation": "Dallas, TX"
    }
  ]
}
```

| Stats field | Meaning |
|-------------|---------|
| `lastAwardedDate` | Most recent `selected` bid date |
| `avgResponseTimeHours` | Average hours from bid sent to carrier submission |
| `assignedProjects` | Distinct projects where this carrier won a bid |
| `freightHistory` | All bid records for this carrier |

---

## 11. `PUT /api/plant/carriers/:carrierId`

Update carrier — **all fields editable** (same body as create, all optional). `carrierCode` must stay unique.

**HTTP status:** `200` — returns `{ "carrier": { ...full document } }`

---

## 12. `PATCH /api/plant/carriers/:carrierId/toggle-status`

Toggle `active` ↔ `inactive`.

**HTTP status:** `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carrier": { "_id": "...", "status": "inactive" }
  }
}
```

---

## Frontend quick reference

| Screen | Endpoint(s) |
|--------|-------------|
| Login | `POST /api/auth/login` → check `role === "plant"` |
| Projects stat cards | `GET /api/plant/projects/stats` |
| Projects table | `GET /api/plant/projects` |
| Filter: date range | `startDate`, `endDate` on both endpoints |
| Filter: project | `projectId` on list (lead `_id` from row `_id`) |
| Filter: customer | `customerId` on list |
| Filter: building type | `buildingType` on list |
| Filter: drawing status | `drawingStatus` on list |
| Vendors table | `GET /api/plant/vendors` |
| Add vendor | `POST /api/plant/vendors` |
| Vendor detail | `GET /api/plant/vendors/:vendorId` |
| Edit vendor | `PUT /api/plant/vendors/:vendorId` |
| Toggle vendor status | `PATCH /api/plant/vendors/:vendorId/toggle-status` |
| Vendor search | `search` (name, contact, email) |
| Vendor material filter | `materialType` |
| Carriers table | `GET /api/plant/carriers` |
| Add carrier | `POST /api/plant/carriers` |
| Carrier detail | `GET /api/plant/carriers/:carrierId` |
| Edit carrier | `PUT /api/plant/carriers/:carrierId` |
| Toggle carrier status | `PATCH /api/plant/carriers/:carrierId/toggle-status` |
| Carrier search | `search` (name, contact, email) |
| Carrier filters | `serviceType`, `serviceArea`, `equipmentType` |

---

*Last updated: Projects (2) + Vendors (5) + Carriers (5 endpoints).*
