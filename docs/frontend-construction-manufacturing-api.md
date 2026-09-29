# Construction — Project detail manufacturing data

**Date:** 2026-09-29  
**Audience:** Frontend (Construction panel — **Project Details** screen)  
**Base URL:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>` · roles: `construction` | `admin`

Manufacturing data (BOM, plant freight, building drawings, bundles, truck packing) is **scoped to one project**. There are **no global list APIs** for construction for these features — open a project from **Projects & Calendar**, then use the buttons and the endpoints below.

All manufacturing routes are **read-only** (GET/HEAD).

---

## 1. Project detail (main screen)

Loads the header card, action buttons, and the **Upcoming Material Delivery** table.

```http
GET /api/construction/projects/:leadId
Authorization: Bearer <token>
```

### Response `data` (relevant fields)

```json
{
  "project": {
    "_id": "…",
    "projectName": "Project 1- ABC Warehouse",
    "jobId": "Q-2025-1047",
    "businessUnit": "steel",
    "businessUnitLabel": "Steel",
    "buildingType": "Workshop",
    "numberOfBuildings": 3,
    "lifecycleStatus": "in_progress",
    "location": "…",
    "createdAt": "2024-10-10T00:00:00.000Z",
    "customerId": { "firstName": "…", "lastName": "…", "email": "…" }
  },
  "upcomingMaterialDeliveries": [
    {
      "deliveryId": "…",
      "id": "DEL-1012",
      "deliveryNumber": "DEL-1012",
      "status": "scheduled",
      "deliveryDate": "2026-04-01T00:00:00.000Z",
      "timeWindowStart": "07:30",
      "timeWindowEnd": "11:30",
      "item": "Roofing Materials",
      "carrier": "Rapid Delivery Services",
      "poc": "John Site Manager",
      "pocPhone": "…",
      "pocEmail": "…"
    }
  ],
  "tasks": [],
  "manufacturing": {
    "bomFilesPath": "/api/construction/projects/{leadId}/bom-files",
    "consolidatedBomPath": "/api/construction/projects/{leadId}/consolidated-bom",
    "buildingDrawingsPath": "/api/construction/projects/{leadId}/building-drawings",
    "photosVideosPath": "/api/construction/projects/{leadId}/photos-videos",
    "materialDeliveriesPath": "/api/construction/projects/{leadId}/material-deliveries",
    "bundlePlanPath": "/api/construction/projects/{leadId}/bundle-plan",
    "truckPlanPath": "/api/construction/projects/{leadId}/truck-plan",
    "hasConsolidatedBom": true,
    "hasBundlePlan": true
  }
}
```

| UI control | Call on tap |
|------------|-------------|
| **View BOM** | `GET` `manufacturing.bomFilesPath` → optional job drill-down (§2) |
| **View Drawings & Photos** | `buildingDrawingsPath` + `photosVideosPath` (§3) |
| **Material Delivery** | `materialDeliveriesPath` (§4) |
| **Bundle Scan** | Existing construction flow: `POST /api/construction/deliveries/scan-bundle` (site workflow, not this doc) |
| **Upcoming Material Delivery table** | Use `upcomingMaterialDeliveries` from this same response (or refresh via §4) |

`siteDeliveries` is the older construction-site delivery list (same `Delivery` collection, filtered for on-site tracking). Prefer **`upcomingMaterialDeliveries`** for the freight-style table on the mock.

---

## 2. View BOM (this project only)

### BOM files per building

```http
GET /api/construction/projects/:leadId/bom-files
```

**Response `data`:** `{ bomFiles: [{ buildingId, buildingNumber, bomJobId, fileName, fileUrl, status, totalItems, … }] }`

### Open one BOM job (line items)

```http
GET /api/construction/projects/:leadId/bom/jobs/:jobId?page=1&limit=50&filter=all
```

`filter`: `all` | `unpriced` | `frames` | `matched` | `bom_priced`

### Consolidated BOM

```http
GET /api/construction/projects/:leadId/consolidated-bom
GET /api/construction/projects/:leadId/bom/consolidated-url
```

### Job status poll

```http
GET /api/construction/projects/:leadId/bom/jobs/:jobId/status
```

---

## 3. View Drawings & Photos

### Manufacturing drawings (per building)

```http
GET /api/construction/projects/:leadId/building-drawings
```

**Response `data`:** `{ buildings: [{ buildingId, buildingNumber, drawings[], latestDrawingStatus }] }`

### Photos & videos on the lead

```http
GET /api/construction/projects/:leadId/photos-videos
GET /api/construction/projects/:leadId/photos-videos?type=photo
```

Same payload as `GET /api/construction/media/:leadId`.

**Note:** `GET /api/construction/drawings/:leadId` is the **construction document** drawing workflow (upload/review), not plant building drawings.

---

## 4. Material delivery (plant freight — this project)

### Full list (Material Delivery screen)

```http
GET /api/construction/projects/:leadId/material-deliveries
```

**Response `data`:** `{ requests[], total, selectedDeliveryId }` — same shape as Plant `GET /api/plant/deliveries/project/:leadId`.

### Detail & PDFs

| Method | Path |
|--------|------|
| `GET` | `/api/construction/projects/:leadId/material-deliveries/:deliveryId/detail` |
| `GET` | `/api/construction/projects/:leadId/material-deliveries/:deliveryId/documents` |
| `GET` | `/api/construction/projects/:leadId/material-deliveries/:deliveryId/download` |
| `GET` | `/api/construction/projects/:leadId/material-deliveries/:deliveryId/download/instructions` |
| `GET` | `/api/construction/projects/:leadId/material-deliveries/:deliveryId/download/packing-list` |

---

## 5. Bundles & packing (this project)

### Bundle plan + bundle list

```http
GET /api/construction/projects/:leadId/bundle-plan
```

### One bundle (e.g. after scan lookup)

```http
GET /api/construction/projects/:leadId/bundles/:bundleId
```

### Truck / packing list plan (all trucks + bundles for the job)

```http
GET /api/construction/projects/:leadId/truck-plan
```

**Response `data`:** `{ project, packingListPlan, packingLists[], bundles[], summary }`

### One truck packing list

```http
GET /api/construction/projects/:leadId/packing-lists/:packingListId
GET /api/construction/projects/:leadId/packing-lists/:packingListId/download-pdf
```

---

## 6. Plant vs construction path cheat sheet

Use **project-scoped** construction paths only (left column):

| Feature | Construction (use this) | Plant (reference) |
|---------|-------------------------|---------------------|
| BOM files | `GET /api/construction/projects/:leadId/bom-files` | `GET /api/plant/projects/:leadId/bom-files` |
| BOM job | `GET /api/construction/projects/:leadId/bom/jobs/:jobId` | `GET /api/plant/bom/:jobId` |
| Drawings | `GET /api/construction/projects/:leadId/building-drawings` | `GET /api/plant/projects/:leadId/drawings` |
| Freight list | `GET /api/construction/projects/:leadId/material-deliveries` | `GET /api/plant/deliveries/project/:leadId` |
| Bundle plan | `GET /api/construction/projects/:leadId/bundle-plan` | `GET /api/plant/projects/:leadId/bundle-plan` |
| Truck plan | `GET /api/construction/projects/:leadId/truck-plan` | `GET /api/plant/projects/:projectId/load-planning/truck-plan` |

---

## 7. Errors

| HTTP | Meaning |
|------|---------|
| 403 | Not in construction project scope, or non-GET on manufacturing routes |
| 404 | Unknown project or resource |

---

## 8. FE checklist

- [ ] Project list: `GET /api/construction/projects` → navigate with `leadId`
- [ ] Detail: single `GET /api/construction/projects/:leadId` for card + delivery table
- [ ] BOM / Drawings / Material Delivery modals: only call `…/projects/:leadId/…` routes from §2–5
- [ ] Do not use removed global routes `/api/construction/bom/*` or `/api/construction/plant/*`
