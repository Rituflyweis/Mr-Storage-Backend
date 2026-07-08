# Sales panel — escalations, PO orders, meetings (June 2026)

Frontend reference for three backend updates on the sales panel:

1. **Escalated leads** — customer name in `customerId` + project title fallback fields  
2. **PO orders list** — `quoteValue` from linked invoice total  
3. **Meetings** — filter meetings for a specific lead via `leadId` query param  

**Auth:** All endpoints require `Bearer` token + `sales` role.

**Response envelope:**

```json
{
  "success": true,
  "message": "...",
  "data": { ... }
}
```

---

## Table of contents

1. [Escalated leads — customer + project name fallback](#1-escalated-leads--customer--project-name-fallback)
2. [PO orders — quote value](#2-po-orders--quote-value)
3. [Meetings — filter by lead](#3-meetings--filter-by-lead)
4. [Frontend checklist](#4-frontend-checklist)
5. [Quick endpoint index](#5-quick-endpoint-index)

---

## 1. Escalated leads — customer + project name fallback

### Endpoint

| Method | Path |
|--------|------|
| GET | `/api/sales/leads/escalated` |

### Query params

| Param | Type | Default | Notes |
|-------|------|---------|--------|
| `status` | string | `pending` | Escalation status filter |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Page size |

**Example:**

```
GET /api/sales/leads/escalated?status=pending&page=1&limit=100
```

### What changed

| Area | Before | After |
|------|--------|-------|
| `customerId` | `_id`, `firstName`, `email` only | Also `lastName`, `customerName` (full display name) |
| Lead row | No title fallback fields | Top-level `customerName`, `buildingType`, `location` for UI when `projectName` is empty |

`customerName` on the row and inside `customerId` use the same formula: `firstName + lastName` trimmed.

### Response shape (`data`)

```json
{
  "leads": [
    {
      "_id": "674abc...",
      "projectId": "PRO-003",
      "jobId": "PRO-003",
      "projectName": "",
      "lifecycleStatus": "quotation_sent",
      "quoteValue": 125000,
      "customerName": "Jane Smith",
      "buildingType": "Warehouse",
      "location": "Dallas, TX",
      "customerId": {
        "_id": "674def...",
        "firstName": "Jane",
        "lastName": "Smith",
        "customerName": "Jane Smith",
        "email": "jane@example.com"
      },
      "assignedTo": {
        "_id": "674ghi...",
        "firstName": "John",
        "lastName": "Rep",
        "email": "john@company.com"
      },
      "escalation": {
        "_id": "674jkl...",
        "note": "Customer needs pricing revision",
        "status": "pending",
        "createdAt": "2026-06-10T12:00:00.000Z"
      }
    }
  ],
  "total": 1
}
```

### FE usage

- **Project title:** `projectName` if non-empty; otherwise build from `customerName`, `buildingType`, `location` (same pattern as plant project lists).
- **Customer details block:** use `customerId.customerName` (or row-level `customerName`).

**Note:** Admin escalations (`GET /api/admin/escalations`) use the same lead row mapper, so these fields appear there too.

---

## 2. PO orders — quote value

### Endpoint

| Method | Path |
|--------|------|
| GET | `/api/sales/po-orders` |

### Query params

| Param | Type | Default | Notes |
|-------|------|---------|--------|
| `status` | string | — | Optional PO status filter |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Page size |
| `startDate` / `endDate` | date | — | Optional date range (same as other sales lists) |

**Example:**

```
GET /api/sales/po-orders?page=1&limit=20
```

### What changed

| Field | Source | Notes |
|-------|--------|--------|
| `quoteValue` | `invoiceId.totalAmount` | **New** top-level field on each order |
| `invoiceId` | Populated object | `invoiceNumber`, `status`, `totalAmount` |

`quoteValue` is the invoice total amount linked to the PO (`POOrder.invoiceId`). If no invoice or no `totalAmount`, `quoteValue` is `null`.

### Response shape (`data`)

```json
{
  "orders": [
    {
      "_id": "675abc...",
      "leadId": {
        "_id": "674abc...",
        "jobId": "PRO-003",
        "projectName": "Dallas Warehouse"
      },
      "customerId": {
        "_id": "674def...",
        "firstName": "Jane",
        "lastName": "Smith"
      },
      "invoiceId": {
        "_id": "675def...",
        "invoiceNumber": "INV-2026-0042",
        "status": "sent",
        "totalAmount": 125000
      },
      "status": "pending",
      "jobId": "PRO-003",
      "quoteValue": 125000,
      "createdAt": "2026-06-12T09:00:00.000Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

### FE usage

- Display PO quote/value column from **`quoteValue`** (not `leadId.quoteValue`).
- For payment state, use `invoiceId.status` and `invoiceId.totalAmount` if needed.

**Related:** Lead-centric PO page may still use `GET /api/sales/leads/with-po` (`data.leads[]`). This update applies to the **order document** list at `/api/sales/po-orders`.

---

## 3. Meetings — filter by lead

### Endpoint

| Method | Path |
|--------|------|
| GET | `/api/sales/meetings` |

### Query params

| Param | Type | Default | Notes |
|-------|------|---------|--------|
| `leadId` | MongoId | — | **New** — meetings for one project/lead |
| `status` | string | — | `scheduled`, `rescheduled`, `completed`, `cancelled` |
| `search` | string | — | Title search (case-insensitive) |

When `status` is omitted, default filter is **upcoming** (`status` not `completed` or `cancelled`).

**Examples:**

```
GET /api/sales/meetings?leadId=674abc...
GET /api/sales/meetings?leadId=674abc...&status=completed
GET /api/sales/meetings?status=scheduled&search=site%20visit
```

### What changed

| Before | After |
|--------|--------|
| List always returned meetings for **all** leads assigned to the sales user | Optional `leadId` narrows to one lead’s meetings |
| — | `403` if `leadId` is not assigned to the current sales user |

Admin already supports the same filter: `GET /api/admin/meetings?leadId=...`.

### Response shape (`data`)

```json
{
  "meetings": [
    {
      "_id": "675ghi...",
      "title": "Site visit",
      "meetingTime": "2026-06-18T14:00:00.000Z",
      "duration": 60,
      "mode": "offline",
      "meetingLink": "",
      "status": "scheduled",
      "notes": "",
      "leadId": {
        "_id": "674abc...",
        "projectName": "Dallas Warehouse",
        "jobId": "PRO-003"
      },
      "customerId": {
        "_id": "674def...",
        "firstName": "Jane",
        "lastName": "Smith"
      },
      "createdBy": "674sales...",
      "createdAt": "2026-06-10T10:00:00.000Z"
    }
  ]
}
```

### FE usage

- **Lead detail / project meetings tab:** `GET /api/sales/meetings?leadId={leadId}`.
- **Global meetings calendar:** `GET /api/sales/meetings` (no `leadId`).
- **History on lead:** `GET /api/sales/meetings?leadId={leadId}&status=completed`.

Other meeting routes unchanged:

| Method | Path |
|--------|------|
| POST | `/api/sales/meetings` |
| PUT | `/api/sales/meetings/:meetingId` |
| PUT | `/api/sales/meetings/:meetingId/complete` |

---

## 4. Frontend checklist

- [ ] **Escalations list** — use `customerId.customerName` and row-level `customerName` / `buildingType` / `location` for empty `projectName`.
- [ ] **PO orders table** — bind value column to `quoteValue`; confirm `invoiceId` is present for invoice link/status.
- [ ] **Lead meetings** — call `GET /api/sales/meetings?leadId=` on project detail; handle `403` if lead not in portfolio.
- [ ] **Meetings history tab** — `?leadId=&status=completed` (and/or `cancelled`).

---

## 5. Quick endpoint index

| Method | Path | Change |
|--------|------|--------|
| GET | `/api/sales/leads/escalated` | `customerId` + project name fallback fields |
| GET | `/api/sales/po-orders` | `quoteValue` + populated `invoiceId` |
| GET | `/api/sales/meetings` | Optional `leadId` query filter |
| GET | `/api/admin/escalations` | Same escalation row shape as sales (shared mapper) |
| GET | `/api/admin/meetings?leadId=` | Already supported (admin) |

---

## Backend files

| File | Change |
|------|--------|
| `src/utils/escalationLeadRow.js` | Customer summary + `mapProjectNameFallbackFields` |
| `src/controllers/sales/lead.controller.js` | `getMyPOOrders` — invoice populate + `quoteValue` |
| `src/controllers/sales/meeting.controller.js` | `leadId` filter + ownership check |
| `src/routes/sales/meeting.routes.js` | `query('leadId').optional().isMongoId()` |
