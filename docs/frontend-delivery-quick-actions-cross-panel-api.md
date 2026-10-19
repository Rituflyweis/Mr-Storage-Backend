# Delivery quick actions — Cross-panel (Contact POC, Reminder, Download, Documents)

**Date:** 2026-10-17  
**Audience:** Frontend — same four action buttons on delivery detail across **Admin plant**, **Plant**, **Construction**, **Admin construction deliveries**, **Account**, and related list/calendar surfaces.

**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>` unless noted.

All actions target the shared **`Delivery`** model. Use Mongo **`_id`** as `:deliveryId` everywhere — **not** `deliveryNumber`.

**Plant-only deep dive (identical handlers, prefix swap):** [`frontend-delivery-quick-actions-api.md`](./frontend-delivery-quick-actions-api.md)

**Account delivery detail shape:** [`frontend-account-project-payments-delivery-api-2026-10-17.md`](./frontend-account-project-payments-delivery-api-2026-10-17.md)

**Construction project material delivery paths:** [`frontend-construction-manufacturing-api.md`](./frontend-construction-manufacturing-api.md) §4.4

---

## Response envelope (JSON routes)

```json
{ "success": true, "message": "Success", "data": { } }
```

PDF routes return raw bytes with `Content-Type: application/pdf`.

---

## 1. Which `deliveryId` to use

| Source | Field |
|--------|--------|
| Delivery detail API / route | `data.delivery.deliveryId` or `data.delivery._id` |
| Admin plant `GET .../all-deliveries` row | `_id` |
| Plant/admin plant calendar | `data.dates[].deliveries[]._id` |
| Construction list | `deliveryId` on row |
| Account project delivery | `data.delivery.deliveryId` |

Construction **project-scoped** PDF/document URLs also need **`leadId`** (project Mongo id): `data.delivery.project.leadId` or route param `:projectId` / `:leadId`.

---

## 2. Contact POC

**UI:** Quick action **Contact POC** (calendar-style icon in Figma).

**Backend:** There is **no** dedicated `POST /contact-poc` (or similar) for staff panels. Implement the modal or deep links from **delivery detail** contact fields.

| Field | Source on `Delivery` |
|-------|----------------------|
| Name | `receivingPoc` |
| Phone | `pickupContactPhone` |
| Email | `receivingPocEmail` (when set) |

### 2.1 Detail endpoints by panel

Load once when opening the detail screen; reuse for the Contact POC button (`tel:`, `mailto:`, copy, or in-app dialer).

| Panel | Method | Path | POC in response |
|--------|--------|------|-----------------|
| Admin plant | `GET` | `/api/admin/plant/deliveries/:deliveryId/detail` | `data.delivery.receivingPocDetails` → `{ receivingPoc, pickupContactPhone }` |
| Plant | `GET` | `/api/plant/deliveries/:deliveryId/detail` | Same |
| Construction (project) | `GET` | `/api/construction/projects/:leadId/material-deliveries/:deliveryId/detail` | Same payload family as plant detail |
| Construction (tracking) | `GET` | `/api/construction/deliveries/:deliveryId` | `data.delivery.receivingPoc` → `{ name, phone, email }` |
| Admin construction list UI | `GET` | `/api/admin/construction/deliveries/:deliveryId` | `data.delivery.receivingPoc` (account-style enriched object) |
| Account | `GET` | `/api/account/projects/:projectId/deliveries/:deliveryId` | `data.delivery.receivingPoc` |
| Account (default final delivery) | `GET` | `/api/account/projects/:projectId/delivery` | Same |

### 2.2 Optional: schedule a meeting (not POC-specific)

If the product opens “schedule call” instead of raw contact:

```http
POST /api/sales/meetings
POST /api/admin/meetings
```

Body includes `customerId`, optional `leadId`, `title`, `meetingTime`, `mode`, etc. — generic meetings API; not tied to `deliveryId`.

### 2.3 Customer app (reference only)

Customer delivery flows use driver/carrier contact APIs, not site POC:

- `POST /api/customer/deliveries/:deliveryId/contact-driver`
- `POST /api/customer/deliveries/:deliveryId/contact-company`

Staff **Contact POC** should **not** reuse those unless product explicitly maps POC to carrier/driver.

---

## 3. Send Reminder Now

**UI:** Quick action **Send Reminder Now**.

Sends customer **email** (if email on file), **SMS** (site/pickup/customer phone when Twilio configured), and **in-app** notification. Optional custom copy in body.

### 3.1 Request

```http
POST /api/admin/plant/deliveries/:deliveryId/send-reminder
POST /api/plant/deliveries/:deliveryId/send-reminder
Authorization: Bearer <staff_jwt>
Content-Type: application/json

{
  "message": "Optional custom text for email/SMS/in-app"
}
```

| Body field | Required | Notes |
|------------|----------|--------|
| `message` | No | Preferred custom copy |
| `note` | No | Alias for `message` |

### 3.2 Response `200`

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

### 3.3 Errors

| HTTP | When |
|------|------|
| `400` | Cancelled delivery, already delivered, or no channel available |
| `403` | Plant user without approved PO access to the project |
| `404` | Unknown `deliveryId` |

### 3.4 Cross-panel availability

| Panel | Send reminder |
|--------|----------------|
| Admin plant | `POST /api/admin/plant/deliveries/:deliveryId/send-reminder` |
| Plant | `POST /api/plant/deliveries/:deliveryId/send-reminder` |
| Construction | **Not mounted** — project material-delivery routes are read-only (`GET`/`HEAD` only) |
| Account | **Not mounted** |
| Admin user on construction deliveries screen | Use **admin plant** path above (same `deliveryId`) |

Use the **same** `:deliveryId` on detail, All Deliveries row menu, and calendar events in plant/admin plant.

---

## 4. Download Details (PDF)

**UI:** Quick action **Download Details** — single PDF without opening the documents modal.

```http
GET {prefix}/:deliveryId/download
Authorization: Bearer <token>
```

### 4.1 Response `200`

- **Content-Type:** `application/pdf`
- **Content-Disposition:** `attachment; filename="delivery-{deliveryNumber}-details.pdf"`
- **Body:** raw PDF bytes

### 4.2 Frontend pattern

```javascript
const res = await fetch(`${API_BASE}${prefix}/${deliveryId}/download`, {
  headers: { Authorization: `Bearer ${token}` },
})
if (!res.ok) throw new Error(await res.text())
const blob = await res.blob()
// trigger browser download; parse filename from Content-Disposition
```

### 4.3 Prefix by panel

| Panel | Path |
|--------|------|
| Admin plant | `GET /api/admin/plant/deliveries/:deliveryId/download` |
| Plant | `GET /api/plant/deliveries/:deliveryId/download` |
| Construction (project) | `GET /api/construction/projects/:leadId/material-deliveries/:deliveryId/download` |
| Customer app | `GET /api/customer/deliveries/:deliveryId/download` |
| Account | **Gap** — no account-scoped route; use plant/admin plant if role allows, or add backend mirror |
| Admin on construction deliveries UI | `GET /api/admin/plant/deliveries/:deliveryId/download` |

---

## 5. View Documents

**UI:** Quick action **View Documents** — modal listing files; user opens or downloads each.

### 5.1 List documents

```http
GET {prefix}/:deliveryId/documents
Authorization: Bearer <token>
```

### 5.2 Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "documents": [
      {
        "name": "Delivery Details PDF",
        "type": "pdf",
        "url": "/api/admin/plant/deliveries/66f1…/download"
      },
      {
        "name": "Packing List PDF",
        "type": "pdf",
        "url": "/api/admin/plant/deliveries/66f1…/download/packing-list"
      },
      {
        "name": "Instructions PDF",
        "type": "pdf",
        "url": "/api/admin/plant/deliveries/66f1…/download/instructions"
      },
      {
        "name": "Uploaded delivery document",
        "type": "file",
        "url": "https://..."
      }
    ]
  }
}
```

| Field | Meaning |
|--------|---------|
| `type: "pdf"` | Generated PDF — `url` is a **relative API path**; prepend `API_BASE` and send `Authorization` on `GET` |
| `type: "file"` | Stored URL (`documentUrl` or `attachments[]`) — open in new tab or presign if required |

PDF `url` values match the logged-in prefix (`/api/admin/plant/...` vs `/api/plant/...` vs construction project prefix).

### 5.3 List prefix by panel

| Panel | List path |
|--------|-----------|
| Admin plant | `GET /api/admin/plant/deliveries/:deliveryId/documents` |
| Plant | `GET /api/plant/deliveries/:deliveryId/documents` |
| Construction (project) | `GET /api/construction/projects/:leadId/material-deliveries/:deliveryId/documents` |
| Customer | `GET /api/customer/deliveries/:deliveryId/documents` |
| Account | **Uploads only** on detail: `data.delivery.documents.documentUrl`, `documents.items[]` — no generated PDF list unless you call plant/construction document APIs |

### 5.4 Download individual PDFs from modal

| Document | Method | Path suffix |
|----------|--------|-------------|
| Delivery details | `GET` | `.../download` |
| Packing list | `GET` | `.../download/packing-list` |
| Instructions | `GET` | `.../download/instructions` |

### 5.5 Construction tracking (alternate PDFs)

On **`/api/construction/deliveries/:deliveryId`** (site tracking, not plant prefix), additional downloads exist:

| Document | Path |
|----------|------|
| Packing list | `GET /api/construction/deliveries/:deliveryId/download/packing-list` |
| Bill of lading | `GET /api/construction/deliveries/:deliveryId/download/bill-of-lading` |

These do **not** replace the plant three-PDF set (details / packing / instructions) used by **View Documents** on plant-style screens.

---

## 6. Cross-panel matrix (copy-paste)

Same UI labels; pick row for logged-in panel. **`deliveryId`** = Mongo `_id` everywhere.

| UI label | Admin plant / Plant | Construction (+ `leadId`) | Account | Admin construction deliveries page |
|----------|---------------------|---------------------------|---------|----------------------------------|
| **Contact POC** | Detail → `receivingPocDetails` | Detail → `receivingPoc` | Detail → `receivingPoc` | `GET /api/admin/construction/deliveries/:deliveryId` |
| **Send Reminder Now** | `POST …/deliveries/:deliveryId/send-reminder` | Not on construction API | Not on account API | `POST /api/admin/plant/deliveries/:deliveryId/send-reminder` |
| **Download Details** | `GET …/deliveries/:deliveryId/download` | `GET …/material-deliveries/:deliveryId/download` | Gap | `GET /api/admin/plant/deliveries/:deliveryId/download` |
| **View Documents** | `GET …/deliveries/:deliveryId/documents` | `GET …/material-deliveries/:deliveryId/documents` | Detail uploads only | `GET /api/admin/plant/deliveries/:deliveryId/documents` |

Plant `{prefix}`:

- Admin plant: `/api/admin/plant/deliveries`
- Plant role: `/api/plant/deliveries`

Construction project `{prefix}`:

- `/api/construction/projects/:leadId/material-deliveries`

---

## 7. Access rules (plant freight actions)

Shared by reminder, PDF, and document list on plant routes:

- **Admin plant scope:** any delivery on a lead with an **approved** PO.
- **Plant role:** delivery’s lead must have an approved PO **assigned to that plant user**; otherwise **`403 Access denied`**.
- **Construction project mirror routes:** read-only; access via construction plant scope (lead in plant lifecycle stages).

Same checks as `GET …/detail` on plant paths.

---

## 8. Frontend checklist

- [ ] Resolve **`deliveryId`** from detail, list, or calendar — one id for all four buttons.
- [ ] **Contact POC:** no POST; bind modal to `receivingPoc` / `receivingPocDetails` from panel detail GET.
- [ ] **Send reminder:** plant/admin plant only; toast from `data.channels`; handle `400`/`403`.
- [ ] **Download Details:** blob + `Content-Disposition` filename.
- [ ] **View Documents:** list then fetch PDFs with Bearer; open `type: "file"` URLs directly.
- [ ] **Construction:** keep **`leadId`** in route/state for material-delivery PDF/document URLs.
- [ ] **Account:** implement reminder/download/documents via new account routes or document product gap (uploads on detail today).

---

## 9. Backend gaps (if product requires parity)

| Need | Status |
|------|--------|
| Account `GET …/deliveries/:id/documents` + PDF downloads | Not implemented |
| Account `POST …/deliveries/:id/send-reminder` | Not implemented |
| Construction `POST …/send-reminder` | Not implemented (construction plant mirror is GET-only) |
| Sales read-only delivery list | See [`frontend-integration-handoff-2026-10.md`](./frontend-integration-handoff-2026-10.md) §6 |

---

*Handlers: `src/controllers/plant/delivery.controller.js` (`sendDeliveryReminder`, `getDeliveryDocuments`, PDF exports); account shape: `src/utils/accountDeliveryDetail.util.js`.*
