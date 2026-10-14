# Frontend integration handoff — Oct 2026

**Prod base:** `https://mr-storage-backend-025k.onrender.com/api`  
**Auth:** Staff → `POST /api/auth/login` · Customer → `POST /api/customer/auth/login`  
**Envelope:** `{ "success": true, "message": "Success", "data": { … } }`

This doc ties together the main open integration threads: **customer quotation**, **deliveries (Construction + Sales Figma)**, **dashboard KPIs**, **media**, **chat**, and **known gaps**.

Deep dives (keep using these):

| Topic | Doc |
|--------|-----|
| Customer building quotation (full) | [`frontend-customer-app-quotation-api.md`](./frontend-customer-app-quotation-api.md) |
| Customer ↔ staff chat map | [`frontend-customer-project-communication-integration.md`](./frontend-customer-project-communication-integration.md) |
| Construction dashboard | [`frontend-construction-dashboard-api.md`](./frontend-construction-dashboard-api.md) |
| Lead photos/videos (all panels) | [`frontend-lead-photos-videos-api.md`](./frontend-lead-photos-videos-api.md) |
| Add delivery (construction) | [`frontend-construction-add-delivery-api.md`](./frontend-construction-add-delivery-api.md) |
| **Plant MR + Construction 3-step logistics + notifications** | [`frontend-plant-construction-logistics-notifications-api.md`](./frontend-plant-construction-logistics-notifications-api.md) |
| Customer quotation reject loop | [`frontend-customer-quotation-reject-flow-api.md`](./frontend-customer-quotation-reject-flow-api.md) |
| **Quotation reject + employee↔customer chat (plain-language flows)** | [`frontend-flow-quotation-reject-and-employee-customer-chat.md`](./frontend-flow-quotation-reject-and-employee-customer-chat.md) |
| **Global chat UI — staff browse (like Teams) + customer app screens** | [`frontend-global-chat-ui-staff-and-customer.md`](./frontend-global-chat-ui-staff-and-customer.md) |

---

## 1. Customer panel — building quotation

**Example project:** `6ac4e5e6570533c2c601ed40`

### GET quotation metadata

```http
GET /api/customer/projects/6ac4e5e6570533c2c601ed40/quotation
Authorization: Bearer {customerToken}
```

**Response `200` — ready (abbreviated)**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "availability": "ready",
    "quotation": {
      "_id": "67890abcdef1234567890abc",
      "quoteNumber": "QT-2026-0042",
      "status": "sent",
      "finalPrice": 125000,
      "sourceEstimate": { "grandTotal": 125000, "squareFootage": 5000 },
      "assignedSalesperson": { "name": "Jane Sales", "email": "jane@example.com" }
    },
    "quoteSummary": { "summary": "…", "generatedAt": "2026-09-16T14:35:00.000Z" },
    "preview": {
      "htmlUrl": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/preview?format=html",
      "pdfUrl": "/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation/pdf",
      "useGeneratorPreview": true
    },
    "documentMeta": { "source": "estimate", "hasPricingData": true },
    "message": null
  }
}
```

**`availability`:** `ready` | `pending` | (404 if no quotation row)

| Action | Method | Path |
|--------|--------|------|
| HTML preview | GET | `{base}{preview.htmlUrl}` + same Bearer token |
| PDF | GET | `{base}{preview.pdfUrl}` |
| Approve | POST | `/api/customer/projects/{leadId}/quotation/approve` body `{}` |
| Reject | POST | `/api/customer/projects/{leadId}/quotation/reject` body `{ "reason": "…" }` |

Sales must **send** quotation after admin approval (`POST /api/quotations/:id/send`) before customer sees `ready`.

---

## 2. Customer panel — project media

Same JSON shape as staff `/media/:leadId`:

```http
GET /api/customer/projects/6ac4e5e6570533c2c601ed40/media
Authorization: Bearer {customerToken}
```

Optional: `?type=photo` | `video`

**Response `200` (abbreviated)**

```json
{
  "success": true,
  "data": {
    "leadId": "6ac4e5e6570533c2c601ed40",
    "projectId": "PRO-023",
    "projectName": "ABC Warehouse",
    "documents": [
      {
        "_id": "…",
        "url": "https://…/site-photo.jpg",
        "name": "site-photo.jpg",
        "type": "photo",
        "uploadedAt": "2026-09-20T10:15:00.000Z",
        "requiresApproval": false,
        "uploadedBy": { "name": "Site Manager", "role": "construction" }
      }
    ],
    "photos": [],
    "videos": [],
    "total": 1,
    "photoCount": 1,
    "videoCount": 0
  }
}
```

Staff upload paths: [`frontend-lead-photos-videos-api.md`](./frontend-lead-photos-videos-api.md) (construction/admin/sales/plant). Customer is **view only** (no POST).

---

## 3. Customer panel — deliveries (schedule)

Customer app uses **`Delivery`** records for the logged-in customer’s projects (not construction panel list shape).

### All projects summary

```http
GET /api/customer/deliveries/summary
Authorization: Bearer {customerToken}
```

### Schedule (all projects or one)

```http
GET /api/customer/deliveries?tab=upcoming&leadId={optionalLeadId}
GET /api/customer/deliveries/{leadId}?tab=upcoming
```

`tab`: `upcoming` | `past` | `rescheduled`

### Detail

```http
GET /api/customer/deliveries/{deliveryId}
```

See [`frontend-customer-app-api-full.md`](./frontend-customer-app-api-full.md) § 2.8 for PDFs, contact driver, site ready, etc.

---

## 4. Construction panel — dashboard KPIs vs projects list

| Source | Field | Meaning |
|--------|--------|---------|
| `GET /api/construction/dashboard` → `data.projectStats.total` | **30** | **Active** projects only (`lifecycleStatus !== delivered`) |
| Same → `totalIncludingCompleted` | **32** | Includes **delivered** |
| `GET /api/construction/projects` → `data.total` | **18** | **Table row count** after list filters (`search`, `hasDelivery`, `priority`, …) |

**Do not** compare dashboard `projectStats.total` to projects `total`.

**Do compare:** dashboard `projectStats` ↔ projects response **`data.projectStats`** (same scope when only `businessUnit` / `status` are set).

Check projects response: `data.listFiltersApplied`, `data.listOnlyFilters` when numbers diverge.

### Dashboard export (Excel)

```http
GET /api/construction/dashboard/export
Authorization: Bearer {constructionOrAdminToken}
```

Same query params as `GET /api/construction/dashboard`. File: `construction-dashboard-export.xlsx`.

Details: [`frontend-construction-dashboard-api.md`](./frontend-construction-dashboard-api.md).

---

## 5. Construction panel — deliveries list (Figma logistics)

**Roles:** `construction` | `admin`  
**Not available to `sales` JWT** on this path (see §6).

### List

```http
GET /api/construction/deliveries?page=1&limit=20&sortBy=Latest&search=adam
Authorization: Bearer {token}
```

**Query params**

| Param | Notes |
|--------|--------|
| `page`, `limit` | Pagination |
| `sortBy` | `Latest`, `Oldest`, `DeliveryDate`, … |
| `search` | Delivery #, material, description, location, POC, **or projects/customers matching text** |
| `status` / `deliveryStatus` | e.g. `scheduled`, `confirmed`, `in_transit`, `delivered` |
| `leadId` / `projectId` | Scope to one project |
| `startDate`, `endDate` | Filter on `deliveryDate` |
| `materialType`, `siteDestination`, `transporter`, `driver` | Optional filters |

### Filters dropdown

```http
GET /api/construction/deliveries/filters
```

### Detail

```http
GET /api/construction/deliveries/{deliveryId}
```

### Export

```http
GET /api/construction/deliveries/export
```

### Example list response (current backend)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "deliveries": [
      {
        "deliveryId": "67a1b2c3d4e5f6789012345a",
        "deliveryNumber": "DEL-2024-1247",
        "status": "confirmed",
        "description": "Steel & Metal",
        "materialType": "Steel & Metal",
        "loadWeight": 24000,
        "schedule": {
          "deliveryDate": "2024-03-25T00:00:00.000Z",
          "deliveryTime": "09:00",
          "timings": "09:00 AM"
        },
        "deliveryLocation": "450 Market St, San Francisco, CA 94102",
        "receivingPoc": "John Site Manager",
        "carrier": {
          "name": "FastFreight Logistics",
          "contactName": "Mike Johnson",
          "phone": "(555) 234-5678",
          "email": "mike@fastfreight.com"
        },
        "project": {
          "leadId": "6ac4e5e6570533c2c601ed40",
          "projectName": "Downtown Office Tower - Phase 2",
          "jobId": "PRO-1021",
          "location": "San Francisco, CA"
        }
      }
    ],
    "total": 6,
    "stats": {
      "inTransit": 1,
      "staged": 7,
      "ready": 7,
      "totalToday": 1
    },
    "statsScope": "all",
    "page": 1,
    "limit": 20
  }
}
```

### Map UI cards → API fields (Construction mobile / web)

| Figma / UI label | API |
|------------------|-----|
| Delivery ID | `deliveryNumber` |
| Status badge | `status` (map colors in FE; e.g. `confirmed`, `in_transit`, `scheduled`, `delivered`) |
| Customer • Project | Use `project.projectName` (+ populate customer on admin route §6) |
| Scheduled date/time | `schedule.deliveryDate` + `schedule.deliveryTime` or `schedule.timings` |
| Material / weight | `materialType` or `description`; `loadWeight` (lbs/kg as stored) |
| Delivery address | `deliveryLocation` |
| Carrier / driver / phone | `carrier.name`, `carrier.contactName`, `carrier.phone` |
| View details | `GET …/deliveries/{deliveryId}` |

### Top KPI chips on construction deliveries screen

Backend **`stats`** (same filter as list when deployed with latest code):

| API field | Backend meaning |
|-----------|-----------------|
| `inTransit` | Count in fulfillment rollup statuses (not `delivered`) |
| `staged` | `status === confirmed` |
| `ready` | `status === scheduled` |
| `totalToday` | `deliveryDate` is **today** |

These are **not** identical to Sales Figma labels (“Scheduled This Week”, “Completed”). For week/completed totals, use **`total`** + `status=delivered` or date-range queries (see §6).

### Empty list but non-zero `stats` (e.g. `search=adam`)

**Expected on latest backend:** list and stats share the **same Mongo filter**. If `deliveries: []` and `total: 0`, **`stats` should all be 0** and `statsScope: "filtered"`.

If you still see `total: 0` with large `stats` and **no `statsScope`**, prod may be on an **older build** — redeploy `shubham-changes-13-aug` (see `render.yaml`).

**Why `search=adam` returns zero rows:** search matches customer name / project name / delivery fields; there may be **no deliveries** linked to matching leads.

---

## 6. Sales panel — Customer Delivery Schedule (Figma read-only)

Figma: **Customer Delivery** tab — read-only, “contact Construction or Admin to change”.

### Gap

There is **no** `GET /api/sales/.../deliveries` today. Sales routes under `/api/sales/construction` only expose **projects** + **calendar**, not delivery cards.

| Need | Status |
|------|--------|
| Sales read-only delivery list scoped to **assigned leads** | **Backend gap** — recommend `GET /api/sales/deliveries` (filter `lead.assignedSales = me`) |
| Reuse construction list with sales JWT | **Blocked** — `/api/construction/deliveries` is `construction` \| `admin` only |

### Interim options

1. **Admin** users: `GET /api/admin/construction/deliveries` (includes richer `stats` + customer on populate):

```http
GET /api/admin/construction/deliveries?page=1&limit=20&search=adam
Authorization: Bearer {adminToken}
```

Example **`data.stats`** (admin):

```json
{
  "draft": 0,
  "total": 6,
  "scheduled": 3,
  "confirmed": 2,
  "inTransit": 1,
  "delivered": 1,
  "delayed": 0,
  "cancelled": 0
}
```

Map Sales Figma KPIs (approximate):

| Figma KPI | Admin API |
|-----------|-----------|
| Total Deliveries | `stats.total` (filtered) |
| In Transit Today | Use construction-style `totalToday` **not on admin stats** — use list + date filter or add backend field |
| Scheduled This Week | `stats.scheduled` + date range query |
| Completed | `stats.delivered` |

2. **Sales** (until new endpoint ships): show **calendar** only:

```http
GET /api/sales/construction/projects/calendar?month=3&year=2024
```

### Admin delivery row (for Sales-style card)

```json
{
  "deliveryId": "…",
  "deliveryNumber": "DEL-2024-1247",
  "project": {
    "leadId": "…",
    "projectName": "Downtown Office Tower - Phase 2",
    "jobId": "PRO-1021"
  },
  "material": "Steel & Metal",
  "deliveryDate": "2024-03-25T00:00:00.000Z",
  "timings": "09:00 AM",
  "transporter": "FastFreight Logistics",
  "driver": "Mike Johnson",
  "driverPhone": "(555) 234-5678",
  "siteContact": "John Site Manager",
  "status": "confirmed"
}
```

Detail: `GET /api/admin/construction/deliveries/{deliveryId}`

---

## 7. Construction — other Figma items (backend notes)

| Figma / product | Backend today |
|-----------------|---------------|
| Material requests visible on **Plant** | **Gap** — no `/api/plant/material-requests`; shared `MaterialRequest` model used by construction/admin/sales/customer orders |
| Label print / bundle scan **3-step** (Projects → loads → bundles) | Flat lists + `?leadId=` on `/api/construction/labels`, `/bundle-scan`, `/bundles/:id`. Plant has `GET /api/plant/packing-lists/projects` for project-first nav — mirror for construction if required |
| Packing lists multi-step | `GET /api/construction/packing-lists?leadId=` + detail/PDF/actions |
| Bundle mismatch | `POST /api/construction/bundles/:bundleId/report-mismatch` |
| Partial received | `POST /api/construction/deliveries/:deliveryId/mark-partial` |
| Editable construction timeline | Dashboard `projectTimelineOverall` read-only; edit via `PUT /api/construction/projects/:leadId/steps/:stepKey` |

---

## 8. Employee ↔ customer chat

Panel **Communication** UI mostly uses **staff-only** APIs (`/api/construction/chat/departments/*`, `/api/team-chat/*`).

**Working customer path today:** **customer direct chat** — `GET/POST /api/{admin|sales|plant}/customer-direct-chat/:customerId/messages` with `customerId` from project row.

Per-project customer channels (`/api/customer/chat/project|finance|construction/...`) have **no staff REST reply** yet.

Full map: [`frontend-customer-project-communication-integration.md`](./frontend-customer-project-communication-integration.md).

---

## 9. Media API matrix (staff + customer)

| Panel | GET one project’s photos/videos |
|--------|----------------------------------|
| Construction | `GET /api/construction/media/:leadId` |
| Admin | `GET /api/admin/leads/:leadId/media` |
| Sales | `GET /api/sales/leads/:leadId/media` |
| Plant | `GET /api/plant/projects/:leadId/media` |
| Admin plant | `GET /api/admin/plant/projects/:leadId/media` |
| **Customer app** | `GET /api/customer/projects/:leadId/media` |

Upload: staff POST on same path prefix (see lead photos doc). Customer: view only.

---

## 10. Admin — payments & financials (pointers)

Admin financial routes live under **`/api/admin/financials/*`** (not customer, not account):

| Area | Examples |
|------|-----------|
| Payments dashboard (Figma page) | **`docs/frontend-admin-payments-dashboard-api.md`** — `GET /payments-dashboard`, export |
| Payment approvals | `GET /payment-approvals`, `PUT /payment-approvals/:id/review` |
| Payment status | `GET /payment-status`, export |
| Financial overview | `GET /financial-overview`, export |
| Customer payment proof | `POST …/payment-proof/approve|reject` on admin customer project invoices |

Account panel overlap: [`frontend-account-payments-api.md`](./frontend-account-payments-api.md), [`frontend-account-dashboard-api.md`](./frontend-account-dashboard-api.md).

---

## 11. Global — notifications

Central writer: `notification.service.js` — **not** wired for every business event yet (many quotation, chat, MR create, delivery updates have **no** notify).

Customer bell: `/api/customer/notifications*`. Staff: common notifications route per panel.

Treat “notify on all important updates” as a **follow-up backend epic**.

---

## 12. Recommended engineering order

1. **Sales read-only deliveries** API (Figma Customer Delivery Schedule).  
2. **Plant material requests** list (shared service).  
3. **Staff project-channel chat** REST + sockets.  
4. **Notification matrix** by event type.  
5. Construction **project-first** endpoints for labels/packing if FE won’t group client-side.

---

## 13. Quick cURL (prod)

```bash
# Customer quotation
curl -s "https://mr-storage-backend-025k.onrender.com/api/customer/projects/6ac4e5e6570533c2c601ed40/quotation" \
  -H "Authorization: Bearer CUSTOMER_JWT"

# Construction deliveries
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/deliveries?page=1&limit=20" \
  -H "Authorization: Bearer STAFF_JWT"

# Construction dashboard export
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/dashboard/export" \
  -H "Authorization: Bearer STAFF_JWT" -o dashboard.xlsx
```
