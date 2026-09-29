# Construction panel — Plant manufacturing data (read-only)

**Date:** 2026-09-29  
**Audience:** Frontend (Construction mobile / web)  
**Base URL (UAT):** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <accessToken>`  
**Roles:** `construction` or `admin`

These endpoints expose the **same payloads** as the Plant panel for BOM, freight deliveries, building drawings, bundles, and packing lists. Construction uses them **read-only** (GET/HEAD only). Writes stay on Plant.

### Scope

Data is limited to projects in **plant/construction lifecycle stages** (same pool as `GET /api/construction/projects`), not plant PO assignment.

### Do not confuse with site workflows

| Topic | Manufacturing (this doc) | Construction site workflow |
|--------|-------------------------|----------------------------|
| Deliveries | `/api/construction/plant/deliveries/*` — freight loads, calendar, PDFs | `/api/construction/deliveries/*` — scan bundle, mark received |
| Drawings | `/api/construction/projects/:leadId/building-drawings` — per-building plant drawings | `/api/construction/drawings/*` — lead document drawings |
| Packing lists | `/api/construction/plant/packing-lists/*` | `/api/construction/packing-lists/*` — dispatch / loading |
| Bundles | `/api/construction/plant/bundles/:bundleId` | `/api/construction/bundles/:bundleId` — verify / stage / load |

### Plant path mapping

If you already integrated Plant, swap the base path:

| Plant | Construction |
|-------|----------------|
| `GET /api/plant/bom/...` | `GET /api/construction/bom/...` |
| `GET /api/plant/deliveries/...` | `GET /api/construction/plant/deliveries/...` |
| `GET /api/plant/packing-lists/...` | `GET /api/construction/plant/packing-lists/...` |
| `GET /api/plant/bundles/:bundleId` | `GET /api/construction/plant/bundles/:bundleId` |
| `GET /api/plant/bundle-plans/:id` | `GET /api/construction/plant/bundle-plans/:id` |
| `GET /api/plant/packing-list-plans/:id` | `GET /api/construction/plant/packing-list-plans/:id` |
| `GET /api/plant/projects/:leadId/drawings` | `GET /api/construction/projects/:leadId/building-drawings` |
| `GET /api/plant/projects/:leadId/bundle-plan` | `GET /api/construction/projects/:leadId/bundle-plan` |

Non-GET requests to construction BOM or `/construction/plant/*` return **403** with message `This endpoint is read-only for construction`.

---

## Quick map

| UI need | Method | Path |
|--------|--------|------|
| BOM dashboard stats | `GET` | `/api/construction/bom/stats` |
| BOM project list | `GET` | `/api/construction/bom/projects` |
| BOM job detail + line items | `GET` | `/api/construction/bom/:jobId` |
| Consolidated BOM file URL | `GET` | `/api/construction/bom/projects/:leadId/consolidated-url` |
| Job processing status | `GET` | `/api/construction/bom/job/:jobId/status` |
| Batch job statuses | `POST` | **Not allowed** — use per-job GET or poll from project list |
| Building drawings (manufacturing) | `GET` | `/api/construction/projects/:leadId/building-drawings` |
| Project bundle plan + bundle list | `GET` | `/api/construction/projects/:leadId/bundle-plan` |
| Freight / delivery lists & detail | `GET` | `/api/construction/plant/deliveries/...` (§4) |
| Packing list projects overview | `GET` | `/api/construction/plant/packing-lists/projects` |
| Packing list detail / PDF | `GET` | `/api/construction/plant/packing-lists/:packingListId` |
| Single manufacturing bundle | `GET` | `/api/construction/plant/bundles/:bundleId` |
| Bundle plan detail | `GET` | `/api/construction/plant/bundle-plans/:bundlePlanId` |
| Packing list plan | `GET` | `/api/construction/plant/packing-list-plans/:packingListPlanId` |

---

## 1. BOM

### 1.1 Stats

```http
GET /api/construction/bom/stats
Authorization: Bearer <token>
```

**Response `data`:**

```json
{
  "totalBomFilesUploaded": 12,
  "pendingUploads": 2,
  "readyForShipper": 5,
  "issuesDetected": 1
}
```

### 1.2 Project list (BOM jobs per project)

```http
GET /api/construction/bom/projects?page=1&limit=20
Authorization: Bearer <token>
```

Optional query: `projectId` (Mongo lead `_id`) to narrow to one project.

**Response `data`:** `{ projects[], total, page, limit }` — same shape as Plant BOM project list (project name, jobId, buildings, latest job status, costs where available).

### 1.3 Job detail

```http
GET /api/construction/bom/:jobId?filter=all&page=1&limit=50
Authorization: Bearer <token>
```

`filter` (optional): `all` | `unpriced` | `frames` | `matched` | `bom_priced` (same as Plant).

### 1.4 Consolidated BOM download URL

```http
GET /api/construction/bom/projects/:leadId/consolidated-url
Authorization: Bearer <token>
```

Returns presigned or stored URL for the consolidated BOM file when generated.

### 1.5 Job status

```http
GET /api/construction/bom/job/:jobId/status
Authorization: Bearer <token>
```

---

## 2. Building drawings (manufacturing)

Per-building drawing revisions from the Plant workflow (not `Lead.documents` construction drawings).

```http
GET /api/construction/projects/:leadId/building-drawings
Authorization: Bearer <token>
```

**Response `data`:**

```json
{
  "buildings": [
    {
      "buildingId": "…",
      "buildingNumber": 1,
      "drawings": [],
      "latestDrawingStatus": "approved"
    }
  ]
}
```

Each `drawings[]` entry matches Plant building drawing objects (fileUrl, status, revisions, etc.).

---

## 3. Bundle plan & bundle list (per project)

```http
GET /api/construction/projects/:leadId/bundle-plan
Authorization: Bearer <token>
```

**Response `data`:**

```json
{
  "bundlePlan": {
    "_id": "…",
    "leadId": "…",
    "planNumber": "…",
    "status": "confirmed",
    "totalBundles": 8,
    "totalWeight": 42000,
    "warnings": []
  },
  "bundles": [
    {
      "bundleId": "…",
      "bundleNo": "B-001",
      "bundleType": "panels",
      "totalWeight": 5200,
      "itemCount": 14
    }
  ],
  "summary": {}
}
```

**Single bundle detail** (line items, stacking, etc.):

```http
GET /api/construction/plant/bundles/:bundleId
Authorization: Bearer <token>
```

**Bundle plan by id** (when you only have `bundlePlanId`):

```http
GET /api/construction/plant/bundle-plans/:bundlePlanId
GET /api/construction/plant/bundle-plans/:bundlePlanId/coverage
```

---

## 4. Freight & deliveries (Plant freight module)

Base: `/api/construction/plant/deliveries`

### 4.1 Lists & stats

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | All deliveries (paginated) |
| `GET` | `/stats` | Aggregate stats |
| `GET` | `/freight` | Freight loads list |
| `GET` | `/freight/stats` | Freight stats |
| `GET` | `/awarded` | Awarded loads |
| `GET` | `/awarded/stats` | Awarded stats |
| `GET` | `/calendar` | Calendar view |
| `GET` | `/export` or `/export/csv` | CSV export |
| `GET` | `/export/excel` | Excel export |

**Common query params:** `page`, `limit`, `search`, `status`, `projectId` (job id string), `carrierId`, `customerId`, `fromDate`, `toDate` (ISO dates).

### 4.2 Per project

```http
GET /api/construction/plant/deliveries/project/:leadId
Authorization: Bearer <token>
```

### 4.3 Delivery detail & downloads

| Method | Path |
|--------|------|
| `GET` | `/:deliveryId/detail` |
| `GET` | `/:deliveryId/documents` |
| `GET` | `/:deliveryId/download` |
| `GET` | `/:deliveryId/download/instructions` |
| `GET` | `/:deliveryId/download/packing-list` |
| `GET` | `/:deliveryId/bids?sort=low_to_high` |

Response bodies match Plant `delivery.controller` (same `success` + `data` envelope).

---

## 5. Packing lists (manufacturing / truck loads)

Base: `/api/construction/plant/packing-lists`

### 5.1 Project overview (packing list plan per project)

```http
GET /api/construction/plant/packing-lists/projects
Authorization: Bearer <token>
```

**Response `data`:** `{ projects[], total }` — one row per project with latest `packingListPlanId`, counts, status.

### 5.2 Export

```http
GET /api/construction/plant/packing-lists/export
Authorization: Bearer <token>
```

Returns Excel (same as Plant).

### 5.3 Detail & PDF

```http
GET /api/construction/plant/packing-lists/:packingListId
GET /api/construction/plant/packing-lists/:packingListId/download-pdf
Authorization: Bearer <token>
```

### 5.4 Packing list plan

```http
GET /api/construction/plant/packing-list-plans/:packingListPlanId
Authorization: Bearer <token>
```

---

## 6. Suggested UI flows

### BOM screen

1. `GET /api/construction/bom/stats` — header KPIs  
2. `GET /api/construction/bom/projects` — table  
3. On row tap → `GET /api/construction/bom/:jobId`  
4. Optional consolidated file → `GET /api/construction/bom/projects/:leadId/consolidated-url`

### Drawings (manufacturing)

1. Pick project from `GET /api/construction/projects`  
2. `GET /api/construction/projects/:leadId/building-drawings`  
3. Render per-building drawing list / approval status

### Bundles & packing

1. `GET /api/construction/plant/packing-lists/projects` — landing list  
2. `GET /api/construction/projects/:leadId/bundle-plan` — bundles for that job  
3. `GET /api/construction/plant/bundles/:bundleId` — bundle detail  
4. `GET /api/construction/plant/packing-lists/:packingListId` — truck load detail  
5. PDF → `…/download-pdf`

### Freight / delivery tracking (manufacturing)

1. `GET /api/construction/plant/deliveries/freight` or `/awarded` or `/calendar`  
2. Detail → `GET /api/construction/plant/deliveries/:deliveryId/detail`  
3. Site receive flow → use **construction** `/api/construction/deliveries/*` (separate module)

---

## 7. Errors

| HTTP | Meaning |
|------|---------|
| 401 | Missing or invalid token |
| 403 | Project outside construction scope, or non-GET on read-only routes |
| 404 | Resource not found (or no access — some routes return 404 instead of 403) |

Standard envelope: `{ success: false, message: "…" }` or `{ success: true, data: { … } }`.

---

## 8. Checklist

- [ ] Use `/api/construction/plant/deliveries` for freight, not `/api/construction/deliveries`
- [ ] Use `building-drawings` for plant buildings, not `/api/construction/drawings/:leadId`
- [ ] Use `/api/construction/plant/packing-lists` for manufacturing truck lists
- [ ] Do not call Plant POST/PUT from construction token — use Plant role or expect 403
