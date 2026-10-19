# Cross-panel: plant drawings, customer documents, construction delivery, admin lead alerts

> **Superseded (2026-10-19):** Use **[`frontend-cross-panel-drawings-customer-docs-full-handoff-2026-10-19.md`](./frontend-cross-panel-drawings-customer-docs-full-handoff-2026-10-19.md)** — includes **sales** delivery routes (`GET /api/sales/construction/projects/:leadId/delivery`), correct customer document enums, and full panel matrix. Customer documents detail: [`frontend-customer-documents-full-api-handoff-2026-10-19.md`](./frontend-customer-documents-full-api-handoff-2026-10-19.md).

**Date:** 2026-10-17  
**Base URL:** `/api`  
**Auth:** Bearer JWT (panel role as noted)

---

## 1. Plant drawings & documents (admin + sales)

Merged list includes **plant building drawings** (`source: "plant"`) and **DrawingDocument** uploads (`source: "document"`). After plant re-upload, only the **latest version per building** is returned.

### Admin — flat list (paginated)

`GET /api/admin/project-drawings`

| Query | Notes |
|-------|--------|
| `page`, `limit` | Default `1`, `20` |
| `projectId` / `leadId` | Filter one project |
| `source` | `plant` \| `document` |
| `status`, `documentType`, `category`, `buildingLabel` | Optional filters |

**Response `data`:**

```json
{
  "documents": [
    {
      "_id": "...",
      "leadId": "...",
      "buildingLabel": "Building A",
      "name": "fab-drawing.pdf",
      "fileUrl": "https://...",
      "status": "pending",
      "versionNumber": 3,
      "source": "plant",
      "projectName": "Acme Warehouse",
      "jobId": "JOB-1001",
      "isLatest": true
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

### Admin — grouped by project

`GET /api/admin/project-drawings/by-project`  
Same query params (no pagination on grouped view; use `limit` up to 500).

### Sales — same endpoints (scoped)

- `GET /api/sales/project-drawings`
- `GET /api/sales/project-drawings/by-project`

Sales only sees leads where `assignedSales` = current user.

### Legacy admin construction drawings (unchanged)

- `GET /api/admin/construction/drawings` — grouped by project  
- `GET /api/admin/construction/drawings/:docId` — detail + comments  

---

## 2. Customer documents

| Action | Role | Method & path |
|--------|------|----------------|
| **Upload** | Sales (admin also) | `POST /api/sales/customers/:customerId/documents` |
| **View** | Admin, sales, account, plant, construction | `GET …/customers/:customerId/documents` |

**Upload body:**

```json
{
  "name": "Signed PO",
  "fileUrl": "https://...",
  "fileType": "application/pdf",
  "fileSize": 120004,
  "category": "contract",
  "notes": ""
}
```

**View paths:**

- `GET /api/admin/customers/:customerId/documents`
- `GET /api/sales/customers/:customerId/documents`
- `GET /api/account/customers/:customerId/documents`
- `GET /api/plant/customers/:customerId/documents`
- `GET /api/construction/customers/:customerId/documents`

Account/plant/construction require at least one **Lead** linked to that customer. Upload/delete remain **sales + admin** only.

---

## 3. Construction delivery detail

### Final delivery for a project (same shape as account)

`GET /api/construction/projects/:leadId/delivery`

Returns confirmed/carrier-selected delivery with Figma-style sections (`overview`, `deliveryInformation`, `receivingPoc`, `vendor`, `deliveryCompany`, `siteCoordination`, `documents`, `quickActions`).

**404** if no confirmed delivery exists.

### Single delivery by id (enriched)

`GET /api/construction/deliveries/:deliveryId`

**Response `data`:**

```json
{
  "delivery": { "...": "formatAccountDeliveryDetail payload" },
  "card": { "...": "legacy list card (schedule, carrier, project)" }
}
```

Admin construction admin list detail:

`GET /api/admin/construction/deliveries/:deliveryId` — same enriched `delivery` object.

---

## 4. Admin notifications — new inbound lead

When a lead is created from **website chat** (`POST /api/public/chat/init`) or **material/quote forms** (`createFormLead` flows), every active **admin** user receives an in-app notification:

- `type`: `"lead"`
- `priority`: `"high"`
- `title`: `"New lead received"`
- `refModel`: `"Lead"`, `refId`: lead `_id`

No change to existing enquiry email; this is the **notification bell** feed for all admins.

---

## 5. Plant drawing version control (replace on upload)

`POST /api/plant/projects/:projectId/drawings` (and admin plant ops equivalent):

- Each building entry **replaces** previous drawings for that building.
- `versionNumber` still increments (audit trail in DB before replace was removed from active list).
- Merged drawing APIs expose **one row per building** — the current file is always the final one.

---

## Frontend checklist

- [ ] Admin/sales “All plant drawings” screens → `project-drawings` APIs  
- [ ] Customer profile documents tab on account/plant/construction → GET only  
- [ ] Construction project delivery tab → `GET /construction/projects/:leadId/delivery`  
- [ ] Construction delivery detail screen → enriched `GET /construction/deliveries/:deliveryId`  
- [ ] Admin notification handler for `type: lead` deep-link to lead detail  
- [ ] Do not show superseded plant drawing versions in UI (backend already filters)
