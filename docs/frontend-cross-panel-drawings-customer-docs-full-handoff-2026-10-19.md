# Cross-panel handoff — plant drawings, customer documents, project delivery, admin lead alerts

**Date:** 2026-10-19  
**Audience:** Frontend (admin, sales, account, plant, construction)  
**Base URL:** `/api`  
**Auth:** `Authorization: Bearer <staff JWT>` unless noted

**Replaces:** [`frontend-cross-panel-drawings-customer-docs-2026-10-17.md`](./frontend-cross-panel-drawings-customer-docs-2026-10-17.md) (that file had gaps: wrong customer doc category example, missing **sales** delivery routes).

**Deep dives:**

- Customer record documents + enums → [`frontend-customer-documents-full-api-handoff-2026-10-19.md`](./frontend-customer-documents-full-api-handoff-2026-10-19.md)
- Account project delivery (payments + delivery shape) → [`frontend-account-project-payments-delivery-api-2026-10-17.md`](./frontend-account-project-payments-delivery-api-2026-10-17.md)

---

## Conventions

```json
{ "success": true, "message": "Success", "data": { } }
```

Errors: `{ "success": false, "message": "..." }` (validation may include `errors[]`).

---

## 1. Plant drawings & documents (admin + sales)

Merged list = **plant building drawings** (`source: "plant"`) + **`DrawingDocument`** uploads (`source: "document"`). After plant re-upload per building, APIs return **only the latest version** for that building (`isLatest: true`).

### 1.1 Endpoints

| Panel | Flat list | Grouped by project |
|-------|-----------|-------------------|
| Admin | `GET /api/admin/project-drawings` | `GET /api/admin/project-drawings/by-project` |
| Sales | `GET /api/sales/project-drawings` | `GET /api/sales/project-drawings/by-project` |

**Sales scope:** leads where `assignedSales` = current user (and not terminated).

### 1.2 Query params (both list routes)

| Param | Notes |
|-------|--------|
| `page`, `limit` | Flat list only. Defaults `1`, `20`. Max `limit` 100 |
| `projectId` / `leadId` | Filter one project (Mongo lead `_id`) |
| `source` | `plant` \| `document` |
| `status`, `documentType`, `category`, `buildingLabel` | Optional filters (see enums §1.4) |

Grouped view: no server pagination; default `limit` 500 on internal slice.

### 1.3 Flat list — success `data`

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
      "documentType": "fabrication",
      "category": "drawing",
      "versionNumber": 3,
      "source": "plant",
      "projectName": "Acme Warehouse",
      "jobId": "JOB-1001",
      "isLatest": true,
      "updatedAt": "2026-10-15T12:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

### 1.4 Enums — merged drawings

**`source` (response only, filter on list)**

| Value | Meaning |
|-------|---------|
| `plant` | Latest drawing file on a plant `Building` |
| `document` | Row from `DrawingDocument` collection |

**`DrawingDocument` fields** (when `source: "document"`)

| Field | Allowed values |
|-------|----------------|
| `documentType` | `architectural`, `structural`, `fabrication`, `erection`, `specification`, `other` |
| `status` | `pending`, `approved`, `rejected`, `under_review` |
| `category` | `drawing`, `photo`, `document` |

**Plant drawing status mapping** (when `source: "plant"`): plant `pending_review` → `pending`; `approved` / `rejected` unchanged.

### 1.5 Legacy admin construction drawings (unchanged)

| Method | Path |
|--------|------|
| GET | `/api/admin/construction/drawings` — grouped by project |
| GET | `/api/admin/construction/drawings/:docId` — detail + comments |

---

## 2. Customer record documents (staff)

Staff-uploaded files on the **Customer** record (not project-scoped). **Customer portal does not expose these today.**

**Full spec + enums:** [`frontend-customer-documents-full-api-handoff-2026-10-19.md`](./frontend-customer-documents-full-api-handoff-2026-10-19.md)

| Action | Roles | Path |
|--------|-------|------|
| List | admin, sales, account, plant, construction | `GET /api/{panel}/customers/:customerId/documents` |
| Upload | admin, sales | `POST /api/admin|sales/customers/:customerId/documents` |
| Delete | admin, sales | `DELETE /api/admin|sales/customers/:customerId/documents/:docId` |

**`category` enum:** `rendering`, `civil_drawing`, `site_plan`, `structural`, `other` (not `contract`).

---

## 3. Project delivery detail (Figma “Delivery Details”)

Shared formatter: `formatAccountDeliveryDetail` — sections: `overview`, `customer`, `deliveryInformation`, `receivingPoc`, `vendor`, `deliveryCompany`, `siteCoordination`, `documents`, `quickActions`, `statusHistory`, `freightLoadId`.

### 3.1 Which delivery is returned on “final” routes

**Query:** latest delivery for the project where:

- `selectedCarrierBidId` is set, and  
- `status` ∈ **`SELECTED_DELIVERY_STATUSES`**:

`carrier_selected`, `scheduled`, `confirmed`, `material_prepared`, `loaded`, `picked_up`, `in_transit`, `staged`, `dispatched_to_site`, `delayed`, `delivered`

Sorted by `updatedAt` descending.

**404** if no matching delivery.

### 3.2 Panel → API matrix (read-only detail)

Use the path for **your panel’s JWT**. Shapes match except where noted.

| Panel | Final delivery (project id only) | Detail by delivery id |
|-------|----------------------------------|------------------------|
| **Sales** | `GET /api/sales/construction/projects/:leadId/delivery` | `GET /api/sales/construction/projects/:leadId/deliveries/:deliveryId` |
| **Account** | `GET /api/account/projects/:projectId/delivery` | `GET /api/account/projects/:projectId/deliveries/:deliveryId` |
| **Construction** | `GET /api/construction/projects/:leadId/delivery` | `GET /api/construction/deliveries/:deliveryId` (+ legacy `card`) |
| **Admin** (construction module) | — | `GET /api/admin/construction/deliveries/:deliveryId` |
| **Plant** | `GET /api/plant/projects/:leadId/delivery` | Plant delivery module uses richer plant payload (see plant panel docs) |

**Sales access:** `assignedSales` = current user; project must be in plant/construction lifecycle (`CONSTRUCTION_STAGES` = full `PLANT_LIFECYCLE_STAGES`); not terminated/archived.

**Do not** call `/api/construction/...` from the **sales** app — construction routes reject the sales role.

### 3.3 Sales — final delivery

```http
GET /api/sales/construction/projects/6aadb0a0464b5c58eb1a042b/delivery
Authorization: Bearer <sales token>
```

**200 `data`:**

```json
{
  "isFinal": true,
  "delivery": {
    "deliveryId": "...",
    "deliveryNumber": "DEL-2026-0001",
    "title": "Primary frame steel",
    "status": "scheduled",
    "statusHistory": [],
    "project": { "leadId": "...", "projectName": "...", "jobId": "..." },
    "customer": { "customerId": "...", "customerName": "...", "email": "...", "phone": "..." },
    "overview": { "status": "scheduled", "projectName": "...", "customerName": "...", "deliveryDate": "...", "timeWindow": "...", "siteAddress": "..." },
    "deliveryInformation": { "description": "...", "materialCategory": "...", "pickupDate": "..." },
    "receivingPoc": { "name": "...", "phone": "...", "email": "..." },
    "vendor": { "company": "...", "contactName": "...", "phone": "...", "email": "..." },
    "deliveryCompany": { "company": "...", "contactName": "...", "phone": "...", "email": "..." },
    "siteCoordination": {
      "siteInstructions": "...",
      "requiredEquipment": "...",
      "equipmentConfirmationStatus": "Pending",
      "specialNotes": "..."
    },
    "documents": {
      "documentUrl": "https://...",
      "attachments": [],
      "items": [{ "name": "Delivery document", "type": "file", "url": "https://..." }]
    },
    "quickActions": { "viewDocuments": [] },
    "freightLoadId": null
  }
}
```

### 3.4 Sales — detail by id

```http
GET /api/sales/construction/projects/:leadId/deliveries/:deliveryId
```

**200 `data`:** `{ "delivery": { ...same enriched object... } }` (no `isFinal` wrapper).

### 3.5 Construction — detail by id (extra list card)

```http
GET /api/construction/deliveries/:deliveryId
```

**200 `data`:**

```json
{
  "delivery": { "...": "same formatAccountDeliveryDetail payload" },
  "card": {
    "deliveryId": "...",
    "deliveryNumber": "...",
    "status": "...",
    "schedule": { "pickupDate": "...", "deliveryDate": "...", "timings": "..." },
    "carrier": { "name": "...", "contactName": "...", "phone": "...", "email": "..." },
    "project": { "leadId": "...", "projectName": "...", "jobId": "...", "location": "..." }
  }
}
```

Construction **mutations** (list, create, mark received, exports): `/api/construction/deliveries*` — construction/admin roles only.

### 3.6 Delivery status enum (full model)

All `Delivery.status` values (`DELIVERY_STATUSES`):

`draft`, `bidding_sent`, `carrier_selected`, `scheduled`, `confirmed`,  
`material_prepared`, `loaded`, `picked_up`, `in_transit`, `staged`, `dispatched_to_site`, `delivered`,  
`partial_received`, `received`, `delayed`, `cancelled`, `rescheduled`

Only the **selected** subset in §3.1 qualifies for “final” GET routes.

### 3.7 Figma field map

| UI block | API fields |
|----------|------------|
| Header | `deliveryNumber`, `title`, `status` |
| Delivery overview | `overview.*`, `customer.customerName` |
| Delivery information | `deliveryInformation.*` |
| Receiving POC | `receivingPoc` |
| Vendor / carrier | `vendor`, `deliveryCompany` |
| Site coordination | `siteCoordination.*` |
| Status timeline | `statusHistory` |
| Documents | `documents.documentUrl`, `documents.items[]`, `quickActions.viewDocuments` |

### 3.8 Related sales APIs (calendar / project list)

| API | Purpose |
|-----|---------|
| `GET /api/sales/construction/projects/calendar?month=&year=&leadId=` | Delivery dates for assigned projects |
| `GET /api/sales/construction/projects?businessUnit=` | Assigned plant/construction projects |

Deep-link from calendar → use **§3.2 sales** delivery routes, not construction.

---

## 4. Admin notifications — new inbound lead

When a lead is created with **`inbound: true`** (website chat, material/quote forms, etc.), **`notifyAdminsOfNewLead`** runs:

| Field | Value |
|-------|--------|
| `type` | `lead` |
| `priority` | `high` |
| `title` | `New lead received` |
| `refModel` | `Lead` |
| `refId` | lead `_id` |
| `body` | Customer name + project label + source |

Recipients: all active **admin** users (notification bell). Enquiry email flows unchanged.

---

## 5. Plant drawing version control

`POST /api/plant/projects/:projectId/drawings` (and admin plant ops equivalent):

- Each building entry **replaces** previous drawings for that building in the active list.
- Merged drawing APIs expose **one row per building** — current file only.
- Do not show superseded versions in admin/sales “all drawings” UI.

---

## 6. Frontend checklist

- [ ] Admin/sales plant drawings → `project-drawings` APIs (§1)
- [ ] Customer profile documents → staff GET paths; categories from enum doc (§2)
- [ ] **Sales** project delivery tab → `GET /api/sales/construction/projects/:leadId/delivery` (§3.2)
- [ ] Construction delivery tab → `GET /api/construction/projects/:leadId/delivery`
- [ ] Account project delivery → `GET /api/account/projects/:projectId/delivery`
- [ ] Do not use construction URLs with a sales token
- [ ] Admin bell: `type: lead` → lead detail (`refId`)
- [ ] Hide superseded plant drawing versions (§5)

---

## 7. Backend references

| Area | Files |
|------|--------|
| Merged drawings | `mergedDrawings.controller.js`, `drawingSources.js` |
| Customer docs | `customerDocument.controller.js`, `constants.js` → `CUSTOMER_DOCUMENT_CATEGORIES` |
| Delivery detail shape | `accountDeliveryDetail.util.js`, `accountProjectSubpages.service.js` |
| Sales delivery routes | `sales/construction.routes.js`, `sales/construction.controller.js` |
| Construction delivery | `construction/delivery.controller.js` |
| Lead alert | `leadCreatedNotify.util.js` |
