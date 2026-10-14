# Construction & Plant — mismatch orders, project phases, logistics filters

**Prod base:** `https://mr-storage-backend-025k.onrender.com/api`  
**Auth:** `Authorization: Bearer {token}`  
**Envelope:** `{ "success": true, "message": "Success", "data": { … } }`

| Panel | Role |
|--------|------|
| Construction APIs | `construction`, `admin` |
| Plant project + mismatch APIs | `plant`, `admin` (admin path: `/api/admin/plant/...`) |

This document is the **single integration reference** for the Construction & Plant updates (bundle mismatch → plant inbox, project phases/steps, project-scoped logistics lists).

---

## 1. Construction — report bundle mismatch

Creates a **Plant Mismatch Order** (`MMO-####`) in addition to updating the bundle record.

```http
POST /api/construction/bundles/{bundleId}/report-mismatch
Authorization: Bearer {constructionToken}
Content-Type: application/json
```

### Request body

| Field | Required | Notes |
|--------|----------|--------|
| `leadId` | No | If sent, must match the bundle’s project |
| `bundleId` | No | If sent, must match URL `{bundleId}` |
| `reason` | No* | Short reason (*at least one of `reason` or `notes` required) |
| `notes` | No* | Detail notes |
| `items` | No | Line-level mismatch |
| `photos` | No | `{ name?, url }[]` |

**Item shape**

| Field | Type | Notes |
|--------|------|--------|
| `itemId` | ObjectId | Required when `items` is non-empty — bundle line `_id` |
| `expectedQty` | number | Alias: `qty` |
| `receivedQty` | number | |
| `partCode`, `description`, `status` | optional | `status` auto-derived if omitted |

### Example request

```json
{
  "leadId": "6ac4e5e6570533c2c601ed40",
  "bundleId": "67a1b2c3d4e5f6789012345a",
  "reason": "Short shipment",
  "notes": "Two purlin lines missing from bundle scan",
  "items": [
    {
      "itemId": "67a1b2c3d4e5f6789012345b",
      "expectedQty": 24,
      "receivedQty": 18,
      "partCode": "P-102",
      "description": "Z Purlin 8in"
    }
  ],
  "photos": [
    { "name": "dock-photo.jpg", "url": "https://cdn.example.com/dock-photo.jpg" }
  ]
}
```

### Example response `200`

```json
{
  "success": true,
  "message": "Mismatch reported",
  "data": {
    "bundleId": "67a1b2c3d4e5f6789012345a",
    "mismatchNotes": "Two purlin lines missing from bundle scan",
    "mismatchReportedAt": "2026-10-14T06:30:00.000Z",
    "mismatchItems": [
      {
        "itemId": "67a1b2c3d4e5f6789012345b",
        "partCode": "P-102",
        "description": "Z Purlin 8in",
        "qty": 24,
        "receivedQty": 18,
        "status": "Partially Received"
      }
    ],
    "mismatchOrder": {
      "mismatchId": "67c0abc1234567890abcdef",
      "mismatchOrderId": "MMO-0007",
      "status": "open",
      "leadId": "6ac4e5e6570533c2c601ed40",
      "bundleId": "67a1b2c3d4e5f6789012345a"
    }
  }
}
```

Plant users see this under **Project → Mismatch orders** (§4).

---

## 2. Construction — project phases & steps

### Option A — phases + steps (recommended for timeline UI)

```http
GET /api/construction/projects/{leadId}/phases
Authorization: Bearer {constructionToken}
```

### Example response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "project": {
      "leadId": "6ac4e5e6570533c2c601ed40",
      "projectName": "ABC Warehouse",
      "jobId": "PRO-023"
    },
    "phases": [
      {
        "key": "planning",
        "label": "Planning",
        "status": "Completed",
        "date": "2026-08-01T10:00:00.000Z",
        "percentComplete": 100,
        "stepsCompleted": 2,
        "stepsTotal": 2,
        "stageKeys": ["released_to_plant", "drawings_received"]
      },
      {
        "key": "execution",
        "label": "Execution",
        "status": "Inprogress",
        "date": "2026-09-10T08:00:00.000Z",
        "percentComplete": 25,
        "stepsCompleted": 1,
        "stepsTotal": 4,
        "stageKeys": ["fabrication_started", "quality_inspection", "packing_bundling", "ready_for_delivery"]
      }
    ],
    "steps": [
      {
        "key": "released_to_plant",
        "stepKey": "released_to_plant",
        "label": "Released to Plant",
        "status": "completed",
        "completionPct": 100,
        "percentComplete": 100,
        "startedAt": "2026-08-01T10:00:00.000Z",
        "completedAt": "2026-08-02T12:00:00.000Z",
        "notes": "",
        "attachments": []
      }
    ],
    "overallProgressPct": 42,
    "currentStepNumber": 9,
    "totalSteps": 21,
    "currentStepLabel": "Fabrication Started"
  }
}
```

**Phase `status` values:** `Upcoming` | `Inprogress` | `Completed`  
**Step `status` values:** `pending` | `in_progress` | `completed`

### Option B — progress (tasks + milestones + phases/steps)

```http
GET /api/construction/projects/{leadId}/progress
```

Same `phases` / `steps` / `overallProgressPct` as above, plus `taskProgress`, `timeline`, and `milestones` (existing progress tracker fields).

---

## 3. Construction — update project step

```http
PUT /api/construction/projects/{leadId}/steps/{stepKey}
Authorization: Bearer {constructionToken}
Content-Type: application/json
```

`stepKey` is a lifecycle stage key (e.g. `fabrication_started`, `packing_bundling`). Full list matches customer **Project Steps** / plant lifecycle (21 stages).

### Request body (all optional)

| FE field | Stored as | Notes |
|----------|-----------|--------|
| `status` | `currentStage` | Sub-label text |
| `percentComplete` | `completionPct` | 0–100 |
| `completionPct` | `completionPct` | Alias |
| `startDate` | `startedAt` | ISO date |
| `endDate` | `completedAt` | ISO date |
| `startedAt`, `completedAt`, `startedBy`, `completedBy` | same | |
| `expectedCompletion` | same | |
| `notes` | same | |
| `attachments` | appended | `{ name?, url }[]` — merged into step attachments |

### Example request

```json
{
  "status": "Fabrication 80% complete",
  "percentComplete": 80,
  "startDate": "2026-09-01T00:00:00.000Z",
  "endDate": null,
  "notes": "Waiting on trim package",
  "attachments": [
    { "name": "site-progress.pdf", "url": "https://cdn.example.com/site-progress.pdf" }
  ]
}
```

### Example response `200`

```json
{
  "success": true,
  "message": "Project step updated",
  "data": {
    "stepDetail": {
      "leadId": "6ac4e5e6570533c2c601ed40",
      "stepKey": "fabrication_started",
      "completionPct": 80,
      "startedAt": "2026-09-01T00:00:00.000Z",
      "notes": "Waiting on trim package",
      "attachments": [
        { "name": "site-progress.pdf", "url": "https://cdn.example.com/site-progress.pdf" }
      ]
    }
  }
}
```

Add more files without replacing: `POST /api/construction/projects/{leadId}/steps/{stepKey}/attachments` with `{ "name", "url" }`.

---

## 4. Construction — project-scoped logistics lists

Use **`projectId`** or **`leadId`** (same Mongo project `_id`) on existing list endpoints.

### Bundle scan history

```http
GET /api/construction/bundle-scan?projectId={leadId}&page=1&limit=20
```

### Label printing list

```http
GET /api/construction/labels?projectId={leadId}&page=1&limit=20
```

Optional: `status`, `search`, `sortBy` (unchanged).

### Packing lists

```http
GET /api/construction/packing-lists?projectId={leadId}&page=1&limit=20
```

### 3-step navigation (unchanged)

For project-first drill-down (Projects → Loads → Bundles):

| Screen | Step 1 | Step 2 | Step 3 |
|--------|--------|--------|--------|
| Packing lists | `GET /api/construction/packing-lists/projects` | `GET .../projects/{leadId}/loads` | `GET .../loads/{packingListId}/bundles` |
| Labels | `GET /api/construction/labels/projects` | same | same |
| Bundle scan | `GET /api/construction/bundle-scan/projects` | same | same |

---

## 5. Plant — additional material requests (project tab)

Customer **Add New Order** requests (`MaterialRequest` with `source: "customer"`) for one project.

```http
GET /api/plant/projects/{leadId}/additional-material-requests?page=1&limit=20
Authorization: Bearer {plantToken}
```

Admin equivalent:

```http
GET /api/admin/plant/projects/{leadId}/additional-material-requests
```

### Example response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6ac4e5e6570533c2c601ed40",
    "additionalMaterialRequests": [
      {
        "requestId": "MR-2026-0042",
        "_id": "67d1...",
        "source": "customer",
        "project": {
          "leadId": "6ac4e5e6570533c2c601ed40",
          "projectName": "ABC Warehouse",
          "jobId": "PRO-023"
        },
        "requestedByCustomer": {
          "customerId": "665a...",
          "name": "Jane Customer",
          "email": "jane@example.com"
        },
        "requestedItems": [
          { "name": "26ga Panel", "quantity": 120, "unit": "ft", "deliveryStatus": "pending" }
        ],
        "status": "pending",
        "priority": "medium",
        "requestDate": "2026-10-10T12:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

Global plant MR inbox remains: `GET /api/plant/material-requests?...`.

---

## 6. Plant — mismatch orders (project tab)

Lists mismatch tickets created from construction **report-mismatch**.

```http
GET /api/plant/projects/{leadId}/mismatch-orders?page=1&limit=20&status=open
Authorization: Bearer {plantToken}
```

**Query:** `status` optional — `open` | `in_review` | `resolved` | `closed` | `cancelled`

### Example response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6ac4e5e6570533c2c601ed40",
    "projectName": "ABC Warehouse",
    "jobId": "PRO-023",
    "mismatchOrders": [
      {
        "mismatchId": "67c0abc1234567890abcdef",
        "mismatchOrderId": "MMO-0007",
        "status": "open",
        "reason": "Short shipment",
        "notes": "Two purlin lines missing",
        "actionNotes": "",
        "bundleId": "67a1b2c3d4e5f6789012345a",
        "bundleNo": "B-12",
        "items": [
          {
            "itemId": "67a1b2c3d4e5f6789012345b",
            "expectedQty": 24,
            "receivedQty": 18,
            "status": "Partially Received"
          }
        ],
        "photos": [{ "name": "dock-photo.jpg", "url": "https://cdn.example.com/dock-photo.jpg" }],
        "reportedBy": { "_id": "...", "name": "Site Lead", "email": "site@example.com" },
        "createdAt": "2026-10-14T06:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

---

## 7. Plant — update mismatch order status

```http
PUT /api/plant/mismatch-orders/{mismatchId}/status
Authorization: Bearer {plantToken}
Content-Type: application/json
```

Admin: `PUT /api/admin/plant/mismatch-orders/{mismatchId}/status`

### Request body

```json
{
  "status": "in_review",
  "actionNotes": "Requested photos from construction; checking plant inventory."
}
```

### Example response `200`

```json
{
  "success": true,
  "message": "Mismatch order updated",
  "data": {
    "mismatchOrder": {
      "mismatchId": "67c0abc1234567890abcdef",
      "mismatchOrderId": "MMO-0007",
      "status": "in_review",
      "actionNotes": "Requested photos from construction; checking plant inventory.",
      "resolvedAt": null
    }
  }
}
```

Setting `status` to `resolved` or `closed` sets `resolvedAt` and `reviewedBy`.

---

## 8. Quick cURL (prod)

```bash
# Phases
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/projects/LEAD_ID/phases" \
  -H "Authorization: Bearer TOKEN"

# Project-scoped labels
curl -s "https://mr-storage-backend-025k.onrender.com/api/construction/labels?projectId=LEAD_ID" \
  -H "Authorization: Bearer TOKEN"

# Plant mismatch list
curl -s "https://mr-storage-backend-025k.onrender.com/api/plant/projects/LEAD_ID/mismatch-orders" \
  -H "Authorization: Bearer TOKEN"
```

---

## 9. Error codes (common)

| HTTP | When |
|------|------|
| `400` | Validation (missing notes/reason, bad itemId, leadId mismatch) |
| `401` | Missing/invalid token |
| `403` | Plant project outside scoped leads |
| `404` | Unknown bundle, project, or mismatch order |

---

## 10. FE checklist

- [ ] Mismatch form → `POST .../report-mismatch` → show returned `mismatchOrderId`
- [ ] Plant project **Mismatch orders** tab → `GET .../mismatch-orders`
- [ ] Plant **Additional material requests** → `GET .../additional-material-requests`
- [ ] Construction timeline → `GET .../phases` or enriched `.../progress`
- [ ] Step editor → `PUT .../steps/{stepKey}` with `percentComplete` / dates
- [ ] Logistics tabs pass `projectId={leadId}` on flat lists or use `/projects` → `/loads` → `/bundles` flow
