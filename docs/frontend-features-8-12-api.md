# Features 8–12 — Frontend API guide

**Date:** 2026-09-30  
**Base URL:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>`

---

## 8. Final structural drawing (one file per project)

Upload replaces any previous structural drawing for that project.

**Flow:** presign → S3 PUT → register file

```http
POST /api/common/upload/presigned-url
POST …/structural-drawing   (see paths below)
```

| Role | GET current | POST upload (replace) |
|------|-------------|------------------------|
| Admin | `/api/admin/leads/:leadId/structural-drawing` | same |
| Admin construction | `/api/admin/construction/projects/:leadId/structural-drawing` | same |
| Sales (own lead) | `/api/sales/leads/:leadId/structural-drawing` | same |
| Plant | `/api/plant/projects/:leadId/structural-drawing` | same |
| Construction | `/api/construction/projects/:leadId/structural-drawing` | same |

**POST body:**

```json
{
  "name": "final-structural.pdf",
  "fileUrl": "https://…",
  "fileType": "application/pdf",
  "fileSize": 1240000,
  "notes": "Rev 3 — issued for fabrication"
}
```

**GET `data`:** `{ document, hasStructuralDrawing }` or `document: null`

Admin construction drawing upload with `documentType: "structural"` also replaces (same storage).

---

## 9. Customer documents (customer record)

Categories: `rendering`, `civil_drawing`, `site_plan`, `structural`, `other`

| Method | Admin | Sales (customers they serve) |
|--------|-------|------------------------------|
| List | `GET /api/admin/customers/:customerId/documents` | `GET /api/sales/customers/:customerId/documents` |
| Add | `POST …/documents` | `POST …/documents` |
| Delete | `DELETE …/documents/:docId` | `DELETE …/documents/:docId` |

**POST body:**

```json
{
  "name": "site-plan-v2.pdf",
  "fileUrl": "https://…",
  "fileType": "application/pdf",
  "fileSize": 890000,
  "category": "site_plan",
  "notes": ""
}
```

List response includes `categories` enum for dropdowns. Upload uses presigned URL (no small backend size cap).

---

## 10. Lead company / business unit

Already on leads — labels updated:

| `businessUnit` | `businessUnitLabel` |
|----------------|---------------------|
| `storage_material` | Storage Materials |
| `steel` | Steel Building Depot |
| `platform` | Platform |

Create/edit/filter: see `docs/frontend-project-business-unit-api.md`.

---

## 11. Sales — construction calendar (read-only)

Shipment / delivery dates for **assigned** projects in plant/construction lifecycle.

```http
GET /api/sales/construction/projects/calendar?month=9&year=2026&leadId=<optional>&businessUnit=steel
GET /api/sales/construction/projects
```

**Calendar `data`:** `{ month, year, calendar: { "2026-09-15": [ { deliveryId, deliveryNumber, status, description, project } ] }, totalDeliveries, scope }`

Same shape as construction panel calendar, scoped to `assignedSales`.

---

## 12. Sales — edit/delete own lead notes

```http
GET    /api/sales/leads/:leadId/notes
POST   /api/sales/leads/:leadId/notes        { "note": "…" }
PUT    /api/sales/leads/:leadId/notes/:noteId { "note": "…" }
DELETE /api/sales/leads/:leadId/notes/:noteId
```

**403** if the note was created by another user. **Admin** may edit/delete any note:

```http
PUT    /api/admin/leads/:leadId/notes/:noteId
DELETE /api/admin/leads/:leadId/notes/:noteId
```

**Sales lead documents (project files on lead):**

```http
GET /api/sales/leads/:leadId/documents?type=general
```
