# Frontend API Delta (2026-09-04)

This document includes **only** the latest API changes requested for frontend integration.

---

## 1) Invoices list: pending approval filter added

### Endpoint
- `GET /api/invoices`

### Request changes (query params)
- New: `pending` (optional boolean-like string)
  - Accepted values: `true`, `false`, `1`, `0`, `yes`, `no`, `y`, `n`
- Also supported as alias:
  - `status=pending` (maps to `approval.status = pending_approval`)
  - `approvalStatus=pending` (maps to `pending_approval`)

### Behavior
- When `pending=true`, API returns only approval-pending invoices and excludes final states:
  - excludes `sent`, `paid`, `cancelled`
  - includes `approvalStatus = pending_approval`

### Example request
```http
GET /api/invoices?pending=true&page=1&limit=20
```

### Response payload impact
- No structural break.
- Existing status fields remain:
  - `approvalStatus`
  - `workflowStatus`
  - `invoiceStatus`
  - `paymentStatus`

---

## 2) Follow-up activity: transition data when date range selected

### Endpoint
- `GET /api/followups/activity`

### Request usage
- Transition data is attached when one of these is present:
  - `startDate`
  - `endDate`
  - `transitionState`

### Response payload changes
- `view=summary`: unchanged from recent update (lead rows can include `transition`).
- `view=detail`: now `lead.transition` is also included (same transition object), in addition to root-level `transition`.

### Example request
```http
GET /api/followups/activity?kind=manual&view=detail&leadId=<leadId>&startDate=2026-09-01&endDate=2026-09-30
```

### Example response (detail shape)
```json
{
  "success": true,
  "data": {
    "kind": "manual",
    "view": "detail",
    "lead": {
      "_id": "leadId",
      "jobId": "JOB-1001",
      "customerName": "John",
      "location": "Austin, TX",
      "quoteValue": 120000,
      "transition": {
        "transitionState": "warm_to_hot",
        "transitionFrom": "warm",
        "transitionTo": "hot",
        "transitionAt": "2026-09-03T10:00:00.000Z",
        "transitionSource": "ai_scoring",
        "scoreBefore": 62,
        "scoreAfter": 79,
        "scoreDelta": 17,
        "transitionReason": "latest model update"
      }
    },
    "transition": {
      "transitionState": "warm_to_hot",
      "transitionFrom": "warm",
      "transitionTo": "hot",
      "transitionAt": "2026-09-03T10:00:00.000Z",
      "transitionSource": "ai_scoring",
      "scoreBefore": 62,
      "scoreAfter": 79,
      "scoreDelta": 17,
      "transitionReason": "latest model update"
    }
  }
}
```

---

## 3) Admin quotations list endpoint: common filters + latest sort

### Endpoint
- `GET /api/quotations/approval/pending`

### Request changes (query params)
- `status` (optional):
  - `draft`, `pending`, `pending_approval`, `approved`, `rejected`, `sent`, `accepted`
- `approvalStatus` (optional):
  - `not_submitted`, `pending_approval`, `approved`, `rejected`
- `sort` (optional):
  - `latest` (default), `oldest`
- Also supported:
  - `leadId`, `search`, `buildingType`, `startDate`, `endDate`, `page`, `limit`

### Behavior
- Endpoint now acts as a common admin quotations list with status-based filtering.
- Default order is latest first (`createdAt DESC`) unless `sort=oldest`.

### Example request
```http
GET /api/quotations/approval/pending?status=approved&sort=latest&page=1&limit=20
```

### Response payload changes
- Adds:
  - `pagination`
  - `filters`
- Each row includes:
  - `approvalStatus`
  - `workflowStatus`
  - `pdfLink` (see section 4)

---

## 4) Quotation PDF link in admin list and detail

### Endpoints impacted
- `GET /api/quotations/approval/pending`
- `GET /api/quotations/:quotationId`

### Response payload changes
- New field: `pdfLink`
  - Current value rule:
    - If quotation is estimate-backed (`sourceEstimateId` exists), link is:
      - `/api/sales/estimates/:estimateId/documents/pdf`
    - Otherwise: `null`

### Example response snippet (quotation row/detail)
```json
{
  "_id": "quotationId",
  "quoteNumber": "Q-10021",
  "approvalStatus": "approved",
  "workflowStatus": "approved",
  "pdfLink": "/api/sales/estimates/66d7f.../documents/pdf"
}
```

---

## Frontend action summary

- Use `pending=true` on `/api/invoices` for pending approvals list behavior.
- For follow-up detail screens with date filters, read transition from `lead.transition` (or root `transition` for backward compatibility).
- Use `/api/quotations/approval/pending` as common admin quotations list with `status` + `sort`.
- Render `pdfLink` when present in quotation list/detail responses.

