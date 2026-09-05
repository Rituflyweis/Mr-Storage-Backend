# Frontend Handoff - API Delta (2026-09-05)

This document contains only the latest backend changes requested in the current cycle, so frontend can align UI and payload handling.

---

## 1) New Feature: Follow-Up Chat Template CRUD

### Base Path
- `/api/followups/templates`

### Auth / Role
- Protected
- Allowed roles: `admin`, `sales`

### Endpoints

#### `GET /api/followups/templates`
List templates with optional filters.

Query params:
- `search` (string, optional)
- `isActive` (boolean, optional)
- `includeDeleted` (boolean, optional, default `false`)
- `page` (number, optional, default `1`)
- `limit` (number, optional, default `50`, max `200`)

Response:
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "templates": [
      {
        "_id": "66dc...",
        "title": "Pricing Estimate",
        "message": "Hello! We have preliminary pricing benchmarks...",
        "category": "general",
        "sortOrder": 0,
        "isActive": true,
        "isDeleted": false,
        "createdAt": "2026-09-05T...",
        "updatedAt": "2026-09-05T..."
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 1,
      "pages": 1
    }
  }
}
```

#### `GET /api/followups/templates/:templateId`
Get one template.

#### `POST /api/followups/templates`
Create a template.

Request body:
```json
{
  "title": "Quote Details Pending",
  "message": "Hi, just checking in. Share pending details and we can finalize.",
  "category": "general",
  "sortOrder": 1,
  "isActive": true
}
```

Validation:
- `title` required
- `message` required
- duplicate `title + message` not allowed

#### `PUT /api/followups/templates/:templateId`
Update template fields partially.

Request body (example):
```json
{
  "title": "Pricing Estimate (Updated)",
  "message": "Hello! We have revised pricing benchmarks...",
  "isActive": true,
  "sortOrder": 2
}
```

#### `DELETE /api/followups/templates/:templateId`
Soft-delete template (`isDeleted=true`).

---

## 2) Quotation Send - Message Key Compatibility Fix

### Endpoint
- `POST /api/quotations/:quotationId/send`

Backend now accepts message text from **any** of these keys:
- `message` (primary)
- `note`
- `emailMessage`
- `coverNote`

### Request example
```json
{
  "emailMessage": "Hi Vishu, please review the attached quote and let us know your feedback.",
  "sections": ["quote", "sow", "contract", "drawings"]
}
```

### Response additions
`data` now includes:
- `messageIncluded` (boolean)
- `messageSourceKey` (string|null) -> which request key was used

Example:
```json
{
  "success": true,
  "message": "Quotation sent successfully",
  "data": {
    "quotation": { "...": "..." },
    "emailProvider": "smtp",
    "messageIncluded": true,
    "messageSourceKey": "emailMessage",
    "pdfAttached": true,
    "pdfWarning": null
  }
}
```

---

## 3) Auto Follow-Up Config Validation Tightened

### Endpoint
- `PUT /api/followup-automation/config`

### New validation behavior

For these fields:
- `chatDropOff.attemptIntervalsMinutes`
- `invoiceReminder.intervalsHours`
- `leadFollowUp.warm.intervalsDays`
- `leadFollowUp.cold.intervalsDays`

Rules:
1. `maxAttempts` must be integer `1..4`
2. intervals must contain positive numbers only
3. if intervals are explicitly provided by frontend, `intervals.length` must **exactly equal** `maxAttempts`
4. interval field also accepts comma-separated string (legacy UI mode), e.g. `"1,3,7,14"`

### Failure example
If `maxAttempts=4` and intervals has 5 entries:
```json
{
  "success": false,
  "message": "leadFollowUp.cold.intervalsDays intervals count (5) must exactly match maxAttempts (4)"
}
```

---

## 4) Branding / Domain Fallback Updates (Backend-rendered content)

Backend-side text and fallback links were updated from Storage Materials to Steel Building Depot in:
- quote/sow/contract generated HTML
- follow-up email sign-off
- follow-up email subject
- estimate extraction note text
- login URL fallbacks used in employee credential emails
- invoice company fallback email/website

### Important for frontend
- Replace any remaining hardcoded `storagematerials` labels/logos in admin/sales UI with Steel Building Depot assets/text.
- Ensure frontend domains/links used in UI match:
  - `https://admin.steelbuildingdepot.com/sign-in/`
  - `https://sales.steelbuildingdepot.com/sign-in/`
  - `https://plant.steelbuildingdepot.com/login`

---

## 5) Frontend Action Checklist

- Integrate new template CRUD into "Send Follow-Up" modal:
  - Add template button -> `POST`
  - Delete template button -> `DELETE`
  - List templates from `GET /api/followups/templates`
- In quotation send flow, send one of supported message keys (`message` preferred).
- Update auto follow-up config form validation:
  - custom interval count must equal max attempts before submit
  - keep backend message handling for safety
- Complete remaining branding/logo text updates in all panels.

