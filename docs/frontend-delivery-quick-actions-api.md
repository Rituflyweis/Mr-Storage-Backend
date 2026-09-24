# Delivery quick actions — Frontend integration

**Screens:** Delivery detail, **All Deliveries** row menu, **Deliveries Calendar** event actions (same APIs on each).

**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <staff_jwt>` (admin plant panel or plant role)

| Panel | Base prefix |
|--------|-------------|
| Admin plant | `/api/admin/plant/deliveries` |
| Plant | `/api/plant/deliveries` |

Replace `{prefix}` below with the row that matches your logged-in role. Handlers are identical; only the path prefix differs.

---

## 1. Which `deliveryId` to use

Use the delivery Mongo **`_id`** everywhere. Do **not** use `deliveryNumber` in the path.

| Source | Field |
|--------|--------|
| Delivery detail route / detail API | `data.delivery._id` or URL param |
| `GET .../all-deliveries` row | `_id` (also duplicated as `requestId`) |
| `GET .../deliveries/calendar` | `data.dates[].deliveries[]._id` |

**Related list/calendar (unchanged):**

```http
GET /api/admin/plant/all-deliveries?page=1&limit=10
GET /api/admin/plant/deliveries/calendar
GET /api/admin/plant/deliveries/:deliveryId/detail
```

Plant: same paths under `/api/plant/...`.

---

## 2. Send reminder now

**UI:** Quick action **Send Reminder Now** (detail, list, calendar).

```http
POST {prefix}/:deliveryId/send-reminder
Authorization: Bearer <token>
Content-Type: application/json

{
  "message": "Optional custom text for email/SMS/in-app"
}
```

| Body field | Required | Notes |
|------------|----------|--------|
| `message` | No | Preferred custom copy |
| `note` | No | Alias for `message` |

### Response `200`

```json
{
  "success": true,
  "message": "Delivery reminder sent",
  "data": {
    "deliveryId": "66f1a2b3c4d5e6f7a8b9c0d3",
    "channels": {
      "email": true,
      "sms": false,
      "inApp": true
    }
  }
}
```

`channels` indicates which paths succeeded (customer email, SMS if Twilio configured, customer in-app notification).

### Errors

| HTTP | When |
|------|------|
| `400` | Cancelled delivery, already delivered, or no channel available |
| `403` | Plant user without approved PO access to the project |
| `404` | Unknown `deliveryId` or project not found |

---

## 3. Download details (PDF)

**UI:** Quick action **Download Details** — download a single PDF without opening the documents modal.

```http
GET {prefix}/:deliveryId/download
Authorization: Bearer <token>
```

### Response `200`

- **Content-Type:** `application/pdf`
- **Content-Disposition:** `attachment; filename="delivery-{deliveryNumber}-details.pdf"`
- **Body:** raw PDF bytes (not JSON)

### Frontend pattern

```javascript
const res = await fetch(`${API_BASE}${prefix}/${deliveryId}/download`, {
  headers: { Authorization: `Bearer ${token}` },
})
if (!res.ok) throw new Error(await res.text())
const blob = await res.blob()
// trigger browser download or save blob
```

### Errors

JSON error body (same wrapper as other APIs): `404` not found, `403` access denied.

---

## 4. View documents (list + downloads)

**UI:** Quick action **View Documents** — modal or drawer listing all files; user picks one to open/download.

### 4.1 List documents

```http
GET {prefix}/:deliveryId/documents
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "documents": [
      {
        "name": "Delivery Details PDF",
        "type": "pdf",
        "url": "/api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/download"
      },
      {
        "name": "Packing List PDF",
        "type": "pdf",
        "url": "/api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/download/packing-list"
      },
      {
        "name": "Instructions PDF",
        "type": "pdf",
        "url": "/api/admin/plant/deliveries/66f1a2b3c4d5e6f7a8b9c0d3/download/instructions"
      },
      {
        "name": "Uploaded delivery document",
        "type": "file",
        "url": "https://..."
      },
      {
        "name": "Attachment 1",
        "type": "file",
        "url": "https://..."
      }
    ]
  }
}
```

| Field | Meaning |
|--------|---------|
| `type: "pdf"` | Generated PDF — `url` is a **relative API path**; prepend `API_BASE` and send `Authorization` on GET |
| `type: "file"` | Stored URL (`documentUrl` or `attachments[]`) — usually absolute; open in new tab or presign if your bucket requires it |

PDF `url` values match the logged-in prefix (`/api/admin/plant/...` vs `/api/plant/...`).

### 4.2 Download individual PDFs from the list

Same auth as §3:

| Document | Method | Path |
|----------|--------|------|
| Delivery details | `GET` | `{prefix}/:deliveryId/download` |
| Packing list | `GET` | `{prefix}/:deliveryId/download/packing-list` |
| Instructions | `GET` | `{prefix}/:deliveryId/download/instructions` |

All return `application/pdf` attachments.

---

## 5. Endpoint matrix (copy-paste)

Admin plant (`{prefix}` = `/api/admin/plant/deliveries`):

| UI label | Method | Path |
|----------|--------|------|
| Send Reminder Now | `POST` | `/api/admin/plant/deliveries/:deliveryId/send-reminder` |
| Download Details | `GET` | `/api/admin/plant/deliveries/:deliveryId/download` |
| View Documents (list) | `GET` | `/api/admin/plant/deliveries/:deliveryId/documents` |
| Packing list (from modal) | `GET` | `/api/admin/plant/deliveries/:deliveryId/download/packing-list` |
| Instructions (from modal) | `GET` | `/api/admin/plant/deliveries/:deliveryId/download/instructions` |

Plant role: replace `/api/admin/plant/` with `/api/plant/`.

---

## 6. Access rules

- **Admin plant:** any delivery on a lead with an **approved** PO (admin plant scope).
- **Plant:** delivery’s lead must have an approved PO **assigned to that plant user**; otherwise PDF/document/reminder calls return **`403 Access denied`**.

Reminder and PDF endpoints share the same access check as `GET .../detail`.

---

## 7. Checklist

- [ ] Use `_id` from detail, **All Deliveries**, or **Calendar** — one set of URLs for all three screens.
- [ ] **Download Details:** `GET .../download` → blob + filename from `Content-Disposition`.
- [ ] **View Documents:** `GET .../documents` → for each `type: "pdf"`, fetch with Bearer token; for `type: "file"`, use stored URL.
- [ ] **Send reminder:** `POST .../send-reminder` with optional `message`; show toast from `data.channels`.
- [ ] Handle `403` on plant panel when user is not assigned to the project PO.

---

## 8. Deploy note

Shipped in commit **`50a6a67`** on branch `shubham-changes-13-aug`. Requires UAT deploy after that commit for PDF/document routes; **Send reminder** existed earlier on the same paths.
