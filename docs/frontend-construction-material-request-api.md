# Construction panel — Material requests API

**Base:** `https://mr-storage-backend-025k.onrender.com/api/construction`  
**Auth:** `Authorization: Bearer <token>` · roles **`construction`** | **`admin`**

---

## Detail (Material Request Details modal)

```http
GET /api/construction/material-requests/:requestId
```

`:requestId` = Mongo `_id` of the material request (not always the same as display `requestId` like `MR-2025-0031` — use `_id` from list row or resolve via list `search` on `requestId`).

### Example response (`200`)

```json
{
  "success": true,
  "data": {
    "materialRequest": {
      "_id": "68f1a2b3c4d5e6f7a8b9c0d1",
      "requestId": "MR-2025-0031",
      "status": "pending",
      "priority": "high",
      "siteLocation": "Construction Site A",
      "department": "Site Engineering",
      "requestDate": "2025-05-19T16:30:00.000Z",
      "requiredBy": "2025-05-22T00:00:00.000Z",
      "preferredDeliveryDate": null,
      "project": {
        "leadId": "68f…",
        "projectName": "Downtown Office Complex",
        "jobId": "PRO-031",
        "location": "…"
      },
      "requestedBy": {
        "userId": "68e…",
        "name": "John Smith",
        "email": "john@example.com"
      },
      "requestedItems": [
        {
          "_id": "68f…",
          "name": "Steel Beams",
          "quantity": 5000,
          "unit": "kg",
          "notes": "For Ground Floor",
          "deliveryStatus": "pending"
        }
      ],
      "itemCount": 8,
      "attachments": [
        { "name": "Material_List.xlsx", "url": "https://…", "fileSize": 12000 },
        { "name": "Site_Drawing.pdf", "url": "https://…", "fileSize": 2400000 }
      ],
      "specialInstructions": "Additional materials required for columns and slab casting on ground floor.",
      "reviewNotes": "",
      "reviewedAt": null,
      "totalAmount": 0
    }
  }
}
```

**Customer orders:** When `source` is `"customer"`, use `requestedByCustomer` / `requestedByLabel` instead of `requestedBy`. Admin and sales use the same fields via `/api/admin/construction/material-requests` and `/api/sales/material-requests` (see `docs/frontend-admin-sales-material-requests-api.md`).

**Line items:** `requestedItems[].name` = description, `unit`, `quantity`, `notes` = remarks.

**Attachments:** download via `url` (upload files with `POST /api/upload/presigned-url` when creating the request).

---

## Cancel request (“Cancel Request” button)

There is **no** separate `/cancel` route. Use **status update** with `cancelled`.

```http
PUT /api/construction/material-requests/:requestId/status
Content-Type: application/json
```

### Request body

```json
{
  "status": "cancelled",
  "reviewNotes": "Optional reason for cancellation"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `status` | **Yes** | Must be `"cancelled"` for cancel |
| `reviewNotes` | No | Stored on the request (optional cancellation reason) |

### Success (`200`)

```json
{
  "success": true,
  "message": "Material request updated",
  "data": {
    "requestId": "68f1a2b3c4d5e6f7a8b9c0d1",
    "status": "cancelled"
  }
}
```

### Rules

- **Only `pending` requests** can be cancelled (approved / fulfilled / already cancelled → **400**).
- After cancel, status updates that change approval state are rejected.

### Errors

| HTTP | Message (typical) |
|------|-------------------|
| `400` | Only pending material requests can be cancelled |
| `404` | Material request not found |

---

## Other status values (same endpoint)

Construction can also set (where business rules allow):

| `status` | Typical use |
|----------|-------------|
| `approved` | Approve for procurement |
| `rejected` | Reject with `reviewNotes` |
| `fulfilled` | All items delivered |

Admin review (separate path): `PUT /api/admin/construction/material-requests/:requestId/review` with `{ "action": "approved" \| "rejected" }`.

---

## List & filters

```http
GET /api/construction/material-requests?page=1&limit=20&status=pending
GET /api/construction/material-requests/filters
POST /api/construction/material-requests
```

**Status enum (filters + UI):** `pending`, `approved`, `rejected`, `fulfilled`, `cancelled`  
**Priority enum:** `low`, `medium`, `high`, `critical`

---

## FE flow (cancel)

1. `GET /material-requests/:requestId` — load modal.
2. User taps **Cancel Request** → confirm dialog.
3. `PUT /material-requests/:requestId/status` with `{ "status": "cancelled", "reviewNotes": "…" }`.
4. Refresh list or patch local row `status: "cancelled"`.
