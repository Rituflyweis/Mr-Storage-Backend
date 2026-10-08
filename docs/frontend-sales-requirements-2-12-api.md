# Sales panel requirements (#2–#12) — API index

**Audience:** Frontend (Sales + Admin where noted)  
**Base URL:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <accessToken>`  
**Envelope:** `{ "success": true, "message": "…", "data": { … } }`

This page maps each client requirement to **backend status**, **endpoints**, and **deeper docs**. Items **8–12** are detailed in [`frontend-features-8-12-api.md`](./frontend-features-8-12-api.md).

---

## Quick map

| # | Requirement | Backend | Primary doc |
|---|-------------|---------|-------------|
| 2 | Lead notes visible at top of Lead Details | **UI layout** (API unchanged) | This file §2 + [api-changelog §27](./api-changelog-edited-endpoints.md) |
| 3 | Edit quotation after sent | **Done** | [Quotation approval delta](./frontend-api-delta-2026-09-10-quotation-approval-versions.md) |
| 4 | Project company (Storage / Platform / Steel) | **Done** | [Business unit guide](./frontend-project-business-unit-api.md) |
| 5 | Year-based project ID | **Done** | This file §5 |
| 6 | Manual billing details on invoice | **Not done** (dedicated bill-to block) | [Invoice create](./frontend-invoice-create-api-2026-09-10.md) (lines/totals only) |
| 7 | Archive leads | **Done** | This file §7 |
| 8 | Final structural drawing (replace) | **Done** | [Features 8–12 §8](./frontend-features-8-12-api.md) |
| 9 | Customer documents | **Done** | [Features 8–12 §9](./frontend-features-8-12-api.md) |
| 10 | Lead under Steel / Storage Materials | **Done** (same as #4) | [Business unit guide](./frontend-project-business-unit-api.md) |
| 11 | Sales construction calendar | **Done** | [Features 8–12 §11](./frontend-features-8-12-api.md) |
| 12 | Edit/delete own notes | **Done** | [Features 8–12 §12](./frontend-features-8-12-api.md) |

**Smoke tests (8–12):** `node scripts/test-features-8-12-remote.js`

---

## 2 — Lead notes (Sales Lead Details)

**Product:** Move the **Notes** block to the **upper** part of Lead Details so users don’t scroll to see it.

| Layer | Status |
|-------|--------|
| Frontend | Layout / component order only |
| Backend | No change required |

**Data for the notes panel**

| Action | Sales | Admin |
|--------|-------|-------|
| List notes | `GET /api/sales/leads/:leadId/notes` | `GET /api/admin/leads/:leadId/notes` |
| Add note | `POST …/notes` body `{ "note": "…" }` | same |
| Lead detail (includes `leadNotes`) | `GET /api/sales/leads/:leadId/detail` | `GET /api/admin/leads/:leadId/detail` |

**Example — POST note**

```json
{ "note": "Customer asked for revised quote by Friday." }
```

**Example — GET `data.notes[]` item**

```json
{
  "_id": "68f…",
  "note": "Customer asked for revised quote by Friday.",
  "addedAt": "2026-05-28T10:00:00.000Z",
  "addedBy": { "_id": "68e…", "name": "Sales One", "email": "sales@…", "role": "sales" }
}
```

Edit/delete: see **§12**. Full model: [api-changelog §27](./api-changelog-edited-endpoints.md).

**Socket:** Archived/deleted leads drop off active list — [socket reference](./frontend-socket-api-reference.md).

---

## 3 — Edit quotation (including after send)

**Product:** Change quotation after customer feedback; save; send again after admin re-approval when required.

**Editable statuses:** `draft` **or** `sent` (`400` if `accepted` / terminal).

| Action | Method | Path |
|--------|--------|------|
| Get quotation | `GET` | `/api/quotations/:quotationId` or `/api/sales/quotations/:quotationId` |
| Edit | `PUT` | `/api/quotations/:quotationId` or `/api/sales/quotations/:quotationId` |
| Send (after approved) | `POST` | `/api/quotations/:quotationId/send` |
| Mark sent (external email) | `POST` | `/api/quotations/:quotationId/mark-sent` |

**Example — PUT (partial body)**

```json
{
  "buildingType": "PEMB",
  "basePrice": 385000,
  "finalPrice": 412000,
  "description": "Revised per customer email 2026-09-30"
}
```

**After edit on a sent quotation:** backend reopens workflow (`status` → `draft`, new **pending approval**). Sales does **not** call submit-approval again. UI: show **Pending Approval** until admin approves, then enable **Send**.

**Estimate path:** If the quote came from an estimate, `PUT /api/sales/estimates/:estimateId` can sync the linked quotation (same approval rules).

Full flow, badges, and errors: [frontend-api-delta-2026-09-10-quotation-approval-versions.md](./frontend-api-delta-2026-09-10-quotation-approval-versions.md).

---

## 4 & 10 — Project company / business unit

**Product:** Tag each project as **Storage Materials**, **Platform**, or **Steel Building Depot** (#10 is the same field; use a two-company dropdown in UI if product wants to hide `platform`).

| Field (request/response) | Values |
|--------------------------|--------|
| `businessUnit` | `storage_material` \| `platform` \| `steel` \| `null` |
| `businessUnitLabel` | `"Storage Materials"`, `"Steel Building Depot"`, `"Platform"`, or `""` |

**Create / edit (examples)**

| Action | Sales | Admin |
|--------|-------|-------|
| Create lead | `POST /api/sales/leads` | `POST /api/admin/leads` |
| Edit lead | `PUT /api/sales/leads/:leadId` | `PUT /api/admin/leads/:leadId` |
| List filter | `?businessUnit=steel` or `none` | same on admin lead lists |

```json
{
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "businessUnit": "steel"
}
```

Lists, exports, plant/construction filters: [frontend-project-business-unit-api.md](./frontend-project-business-unit-api.md) and [frontend-business-unit-api-changes.md](./frontend-business-unit-api-changes.md).

---

## 5 — Project naming format (year + sequence)

**Product:** Consistent automatic project IDs per calendar year.

**Behaviour (new leads only):**

- Format: **`YYYY` + 3-digit sequence** (resets each year in business timezone).
- Examples: `2026001`, `2026002`, … `2026123` (not `PRO-042`; legacy IDs unchanged).
- Assigned on create when `jobId` is omitted (`Lead` pre-save → `generateJobId()`).
- `projectId` in API responses is an **alias** of `jobId`.

**Optional env:** `PROJECT_ID_TIMEZONE` (default US Eastern for year rollover).

**Manual override:** If create payload includes `jobId`, that value is stored (admin/sales create validators permitting).

**FE:** Show `jobId` / `projectId` on lead detail, lists, PDFs, and filters (`search` matches `jobId` on many list APIs).

---

## 6 — Manual billing details on invoice

**Product:** Enter/edit **billing / bill-to** block before generating or sending an invoice.

| Status | Notes |
|--------|--------|
| **Gap** | No dedicated `billingAddress` / bill-to object on `Invoice` yet |
| **Available today** | Manual **invoice composition**: line items, subtotal, markup, tax, totals — [frontend-invoice-create-api-2026-09-10.md](./frontend-invoice-create-api-2026-09-10.md) |
| | Create: `POST /api/leads/:leadId/invoices` |
| | Update draft/sent: `PUT /api/invoices/:invoiceId` (see [invoice approval delta](./frontend-api-delta-2026-09-09-invoice-approval-versions.md)) |
| | Customer name/address today comes from **Customer** + **Lead**, not a per-invoice override |

**When #6 is built**, expect new optional body fields on create/update + PDF template fields — track in a follow-up doc.

---

## 7 — Lead archiving

**Product:** Remove non-viable leads from **active** lists; keep them retrievable.

| Action | Admin | Sales |
|--------|-------|-------|
| List archived | `GET /api/admin/leads/archived?page=1&limit=20` | `GET /api/sales/leads/archived` |
| Archive | `PUT /api/admin/leads/:leadId/archive` | `PUT /api/sales/leads/:leadId/archive` |
| Restore | `PUT /api/admin/leads/:leadId/unarchive` | `PUT /api/sales/leads/:leadId/unarchive` |
| Detail (still works) | `GET …/leads/:leadId/detail` | same |

**Archive body (optional)**

```json
{ "reason": "Lost to competitor — no follow-up" }
```

**Response fields on lead:** `isArchived`, `archiveReason`, `archivedAt`, `archivedBy`.

Active lead lists exclude `isArchived: true` (socket `action: "archived"` removes row from live list — [socket reference](./frontend-socket-api-reference.md)).

Query: `?businessUnit=…` supported on archived list (same as active lists).

---

## 8 — Structural drawing (latest only)

Replace-on-upload final structural file per project.

**Presign:** `POST /api/upload/presigned-url` body `{ "fileName": "…", "fileType": "…" }`

**Sales (assigned lead):**

```http
GET  /api/sales/leads/:leadId/structural-drawing
POST /api/sales/leads/:leadId/structural-drawing
```

**POST body**

```json
{
  "name": "final-structural.pdf",
  "fileUrl": "https://…",
  "fileType": "application/pdf",
  "fileSize": 1240000,
  "notes": "Rev 3 — issued for fabrication"
}
```

Admin, plant, construction paths: [frontend-features-8-12-api.md §8](./frontend-features-8-12-api.md).

---

## 9 — Customer documents

Dedicated **customer** record storage (renderings, civil, site plans, etc.).

| Method | Admin | Sales |
|--------|-------|-------|
| List | `GET /api/admin/customers/:customerId/documents` | `GET /api/sales/customers/:customerId/documents` |
| Add | `POST …/documents` | `POST …/documents` |
| Delete | `DELETE …/documents/:docId` | `DELETE …/documents/:docId` |

**POST body**

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

**Categories:** `rendering`, `civil_drawing`, `site_plan`, `structural`, `other`.

Details: [frontend-features-8-12-api.md §9](./frontend-features-8-12-api.md).

---

## 11 — Sales construction calendar

Read-only **Construction** tab for sales: upcoming **material deliveries** on assigned plant/construction-stage projects.

```http
GET /api/sales/construction/projects?page=1&limit=20&businessUnit=steel
GET /api/sales/construction/projects/calendar?month=9&year=2026&leadId=<optional>&businessUnit=steel
```

**Calendar `data` (shape)**

```json
{
  "month": 9,
  "year": 2026,
  "calendar": {
    "2026-09-15": [
      {
        "deliveryId": "68f…",
        "deliveryNumber": "DEL-2026-0012",
        "status": "scheduled",
        "description": "Primary frame",
        "project": { "leadId": "68e…", "projectName": "…", "jobId": "2026001" }
      }
    ]
  },
  "totalDeliveries": 4,
  "scope": "assigned_sales_plant_construction"
}
```

Details: [frontend-features-8-12-api.md §11](./frontend-features-8-12-api.md).

---

## 12 — Edit / delete own lead notes

| Action | Sales | Admin |
|--------|-------|-------|
| Update | `PUT /api/sales/leads/:leadId/notes/:noteId` | `PUT /api/admin/leads/:leadId/notes/:noteId` |
| Delete | `DELETE /api/sales/leads/:leadId/notes/:noteId` | `DELETE /api/admin/leads/:leadId/notes/:noteId` |

**PUT body**

```json
{ "note": "Updated: customer confirmed Friday deadline." }
```

**403** if sales user did not create the note. Admin can edit/delete any note.

Details: [frontend-features-8-12-api.md §12](./frontend-features-8-12-api.md).

---

## Related sales docs (broader panel)

| Topic | Doc |
|-------|-----|
| Leads + follow-ups (large reference) | [sales-panel-api-changes-step2-leads-followups.md](./sales-panel-api-changes-step2-leads-followups.md) |
| Quotations / estimates (Aug 2026) | [sales-quotation-api-2026-08-28.md](./sales-quotation-api-2026-08-28.md) |
| Invoices + tax prefill | [frontend-invoice-tax-breakdown-2026-09-10.md](./frontend-invoice-tax-breakdown-2026-09-10.md) |
| Full API changelog | [api-changelog-edited-endpoints.md](./api-changelog-edited-endpoints.md) |

---

## Implementation checklist (FE)

- [ ] **#2** — Move notes UI above fold on Lead Details; keep using `leadNotes` from detail or notes API.
- [ ] **#3** — “Edit quotation” → `PUT …/quotations/:id`; refresh badges from approval delta doc; re-send after approve.
- [ ] **#4 / #10** — Business unit select on create/edit; filter lists with `?businessUnit=`.
- [ ] **#5** — Display `jobId` (`2026001` style for new projects); don’t assume `PRO-###` only.
- [ ] **#6** — Wait for bill-to API or use customer/lead address until backend adds fields.
- [ ] **#7** — Archive action + “Archived leads” screen using `GET …/archived`.
- [ ] **#8–#12** — Follow [frontend-features-8-12-api.md](./frontend-features-8-12-api.md).
