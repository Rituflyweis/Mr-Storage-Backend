# Construction panel — Add Delivery (API)

**Base URL:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `construction` | `admin`

Yes — **construction users can create deliveries** (including **delivery date**) from the “Add Delivery” modal. This creates a `Delivery` record in status **`scheduled`** (not a plant freight load with carriers/bids).

---

## Create delivery

```http
POST /api/construction/deliveries
Content-Type: application/json
```

### Request body (maps to UI)

| UI field | JSON field | Required | Backend storage |
|----------|------------|----------|-----------------|
| Title | `title` | Recommended | `loadDescription` |
| Project | `leadId` | **Yes** | `leadId` (Mongo `_id` of the lead/project) |
| Section/Location | `sectionLocation` | No | `deliveryLocation` (free text) |
| Delivery Date | `deliveryDate` | **Yes** | `deliveryDate` (ISO date string, e.g. `2026-05-19` or full ISO) |
| Description (optional) | `description` | No | `description` |
| Notes (optional) | `notes` | No | `additionalNotes` |
| Attachments (optional) | `attachments` | No | `attachments` — array of **HTTPS URLs** (see upload flow below) |

### Example

```json
{
  "title": "Primary Frame Steel",
  "leadId": "68f1a2b3c4d5e6f7a8b9c0d1",
  "sectionLocation": "Building A - Front Elevation",
  "deliveryDate": "2026-05-19",
  "description": "Structural steel delivery for phase 1",
  "notes": "Requires forklift for unloading",
  "attachments": [
    "https://your-bucket.s3.region.amazonaws.com/documents/uuid.jpg"
  ]
}
```

### Success (`201`)

```json
{
  "success": true,
  "message": "Delivery added",
  "data": {
    "delivery": {
      "_id": "…",
      "deliveryNumber": "DEL-2026-0001",
      "status": "scheduled",
      "leadId": "…",
      "loadDescription": "Primary Frame Steel",
      "description": "Structural steel delivery for phase 1",
      "deliveryLocation": "Building A - Front Elevation",
      "deliveryDate": "2026-05-19T00:00:00.000Z",
      "additionalNotes": "Requires forklift for unloading",
      "attachments": ["https://…"],
      "statusHistory": [{ "status": "scheduled", "changedAt": "…" }]
    }
  }
}
```

### Errors

| Code | When |
|------|------|
| `400` | Missing `leadId` or `deliveryDate` |
| `404` | Invalid `leadId` (project not found) |
| `401` | No/invalid token |

---

## Supporting APIs for the form

### Project dropdown

```http
GET /api/construction/projects?page=1&limit=50
```

Use each row’s **`leadId`** (`_id`) as `leadId` in the create body. Optional filters: `search`, `status`, `businessUnit`, `hasDelivery`.

### Section / location dropdown

There is **no dedicated “sections” API** for this modal. The backend accepts **any string** in `sectionLocation`.

Suggested FE options (client-side):

- Project **`location`** from `GET /api/construction/projects/:leadId` → `project.location`
- Building labels from plant data, e.g. `GET /api/construction/projects/:leadId/building-drawings` (building names if present)
- Or allow custom text entry (stored as-is in `deliveryLocation`)

### Attachments upload

Create delivery expects **URLs**, not multipart files on this endpoint.

1. Get presigned URL (construction role allowed):

```http
POST /api/upload/presigned-url
Content-Type: application/json

{ "fileName": "load-photo.jpg", "fileType": "image/jpeg", "folder": "documents" }
```

2. `PUT` the file to `uploadUrl` from the response.
3. Pass returned **`fileUrl`** in the `attachments` array when calling `POST /api/construction/deliveries`.

---

## List / detail after create

| Action | Method | Path |
|--------|--------|------|
| List deliveries | `GET` | `/api/construction/deliveries?leadId=&status=&page=&limit=` |
| Delivery detail | `GET` | `/api/construction/deliveries/:deliveryId` |
| Calendar (projects + deliveries) | `GET` | `/api/construction/projects/calendar?month=&year=` |

**List card shape:** `GET /deliveries` returns normalized **cards**. Notes from this create flow appear on the card as **`stagingArea`** (from `additionalNotes`). Title is not a separate card field — prefer **`description`** or read **`loadDescription`** from the raw `delivery` object on create; for list rows, show `description` or extend FE mapping when the API adds `title` to cards.

**Note:** Plant-created freight deliveries (carriers, bids, bundles) use **`/api/plant/deliveries`** and are a different workflow. Construction “Add Delivery” is the lightweight site schedule entry above.

---

## Admin equivalent (same payload)

Admin calendar modal uses the same fields:

```http
POST /api/admin/construction/projects-calendar/deliveries
```

(Same body except admin route does not accept `attachments` in the controller today — construction route does.)

---

## Implementation reference

- Route: `src/routes/construction/index.js` → `POST /deliveries`
- Handler: `src/controllers/construction/delivery.controller.js` → `createDelivery`
