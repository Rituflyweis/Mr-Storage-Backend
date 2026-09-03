# Estimate History to Quotation Redirect API (2026-09-03)

This document defines how frontend can detect whether an estimate has already been converted into a quotation, and how to redirect users directly to that quotation.

---

## Why this exists

In estimate history screens, users need to know:

- whether an estimate is already converted to a quotation
- which quotation it maps to
- what approval/send state that quotation is in

Without this contract, frontend has to run extra queries or infer state from preview data.

---

## Source of truth

Conversion linkage is resolved from:

- `Quotation.sourceEstimateId == EstimateQuote._id`

This is the canonical backend link used to provide redirect metadata.

---

## APIs that now include conversion metadata

### 1) Estimate list API

`GET /api/sales/estimates`

Each estimate row now includes:

```json
{
  "conversion": {
    "isConvertedToQuotation": true,
    "quotationId": "6a99444dad3c7fc83586da75",
    "quoteNumber": "QUO-0002",
    "quotationStatus": "draft",
    "approvalStatus": "pending_approval",
    "workflowStatus": "pending_approval",
    "convertedAt": "2026-09-03T09:56:29.429Z"
  }
}
```

When not converted:

```json
{
  "conversion": {
    "isConvertedToQuotation": false,
    "quotationId": null,
    "quoteNumber": null,
    "quotationStatus": null,
    "approvalStatus": null,
    "workflowStatus": null,
    "convertedAt": null
  }
}
```

---

### 2) Estimate detail API

`GET /api/sales/estimates/:estimateId`

Returns the same `estimate.conversion` object as list API.

---

## Conversion object contract

- `isConvertedToQuotation`: `boolean`
- `quotationId`: `string | null`
- `quoteNumber`: `string | null`
- `quotationStatus`: `draft | sent | accepted | rejected | null`
- `approvalStatus`: `not_submitted | pending_approval | approved | rejected | null`
- `workflowStatus`: `draft | pending_approval | approved | rejected | sent | null`
- `convertedAt`: ISO datetime string or `null`

---

## Frontend redirect behavior

- If `conversion.isConvertedToQuotation === true`:
  - show badge: `Converted to Quote`
  - redirect using `conversion.quotationId`
  - open quotation page and call:
    - `GET /api/quotations/:quotationId?includeEstimate=true&includeDocuments=true`

- If `conversion.isConvertedToQuotation === false`:
  - show action: `Convert to Quote`
  - call:
    - `POST /api/quotations/from-estimate/:estimateId`

---

## Status rendering guidance

Use `workflowStatus` for UI primary state:

- `draft` -> editable, can submit
- `pending_approval` -> waiting admin review
- `approved` -> ready to send
- `rejected` -> needs edits + resubmit
- `sent` -> already sent to customer

Use `quoteNumber` as secondary display text.

---

## Related endpoints this reflects

- `GET /api/sales/estimates`
- `GET /api/sales/estimates/:estimateId`
- `POST /api/quotations/from-estimate/:estimateId`
- `POST /api/quotations/:quotationId/submit-approval`
- `GET /api/quotations/:quotationId`

---

## Important note (preview vs conversion)

Estimate preview/document APIs can display customer/location/project fields from estimate payload, even if estimate is not linked to a lead or quotation yet.

Do not infer conversion from preview success.

Always use `estimate.conversion` metadata as conversion/redirect truth.
