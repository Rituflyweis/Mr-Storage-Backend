# Admin & Sales — Material requests (incl. customer orders)

**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** staff JWT — **`admin`** or **`sales`**

Customer portal material orders are stored as `MaterialRequest` documents with `source: "customer"` and `requestedByCustomer`. They appear in the same list/detail APIs as construction-created requests (construction panel already showed all sources; admin and sales now use the same shared list mapper).

---

## Admin

| Method | Path |
|--------|------|
| GET | `/api/admin/construction/material-requests` |
| GET | `/api/admin/construction/material-requests/filters` |
| GET | `/api/admin/construction/material-requests/:requestId` |
| GET | `/api/admin/construction/material-requests/export` |
| PUT | `/api/admin/construction/material-requests/:requestId/review` |

Admin sees **all** projects. Optional query `source=customer` or `source=construction`.

---

## Sales

| Method | Path |
|--------|------|
| GET | `/api/sales/material-requests` |
| GET | `/api/sales/material-requests/filters` |
| GET | `/api/sales/material-requests/:requestId` |
| PUT | `/api/sales/material-requests/:requestId/review` |

Sales lists are scoped to leads where `assignedSales` is the logged-in user. Detail/review return **403** if the request’s project is not assigned to that rep.

---

## List query (optional)

Same as construction: `projectId` / `leadId`, `department`, `status`, `priority`, `buildingLabel`, `siteLocation`, `source`, `search` (request id), `startDate`/`endDate` or `dateFrom`/`dateTo`, `page`, `limit`.

### List row fields (customer vs construction)

| Field | Meaning |
|--------|---------|
| `source` | `"customer"` or `"construction"` |
| `requestedBy` | Staff user when construction-created; may be `null` for customer orders |
| `requestedByCustomer` | `{ customerId, name, email }` when `source === "customer"` |
| `requestedByLabel` | Display name — customer name or staff name |
| `preferredDeliveryDate` | Often set on customer orders |

### Example list `200` (abbreviated)

```json
{
  "success": true,
  "data": {
    "materialRequests": [
      {
        "_id": "…",
        "requestId": "MR-2026-0042",
        "source": "customer",
        "project": { "leadId": "…", "projectName": "…", "jobId": "PRO-012" },
        "requestedBy": null,
        "requestedByCustomer": { "customerId": "…", "name": "Jane Doe", "email": "jane@example.com" },
        "requestedByLabel": "Jane Doe",
        "status": "pending",
        "itemCount": 3
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "stats": {
      "total": 1,
      "pending": { "count": 1, "amount": 0 },
      "approved": { "count": 0, "amount": 0 },
      "rejected": { "count": 0, "amount": 0 },
      "fulfilled": { "count": 0, "amount": 0 },
      "urgent": 0,
      "totalRequests": 1
    }
  }
}
```

---

## Detail

```http
GET /api/admin/construction/material-requests/:requestId
GET /api/sales/material-requests/:requestId
```

`:requestId` = Mongo `_id` of the material request.

Response: `data.materialRequest` — same shape as construction detail (see `docs/frontend-construction-material-request-api.md`), including `source`, `requestedByCustomer`, and `requestedByLabel`.

---

## Approve / reject

```http
PUT /api/admin/construction/material-requests/:requestId/review
PUT /api/sales/material-requests/:requestId/review
Content-Type: application/json

{ "action": "approved", "reviewNotes": "optional" }
```

`action`: `"approved"` | `"rejected"`.

---

## Filters

`GET …/material-requests/filters` returns `statuses`, `priorities`, `sources` (`customer`, `construction`), `departments`, and staff `requestedBy` options (distinct requesters in scope).

---

## Customer create (reference)

```http
POST /api/customer/projects/:leadId/orders
```

Creates a material request visible to construction, admin, and assigned sales.
