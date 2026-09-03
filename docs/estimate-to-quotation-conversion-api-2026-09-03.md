# Estimate to Quotation Conversion API (2026-09-03)

Use this API when frontend generates/finalizes an estimate (`EstimateQuote`) and needs a real `Quotation` record for approval and send flow.

Related doc:

- `docs/estimate-history-conversion-redirect-api-2026-09-03.md` (history-table converted badge + redirect contract)

---

## Why this endpoint exists

`/api/sales/estimates/documents/pdf` and preview endpoints generate documents from estimate data, but they do not create a `Quotation` document automatically.

Approval endpoints (`/api/quotations/:quotationId/submit-approval`, approve/reject/send) require a real `quotationId`.

This endpoint bridges that gap.

---

## Endpoint

`POST /api/quotations/from-estimate/:estimateId`

Auth roles:

- `admin`
- `sales` (must have access to the estimate's lead)

Request body:

```json
{
  "leadId": "optional MongoId"
}
```

Body fields:

- `leadId` (optional): fallback lead link when estimate has no `leadId`.
  - Backend will use this lead to convert estimate to quotation.
  - If omitted, backend tries:
    1) `estimate.leadId`
    2) `estimate.jobNumber` -> `Lead.jobId`

---

## Response (success)

Status: `201`

```json
{
  "success": true,
  "message": "Quotation created from estimate",
  "data": {
    "quotation": {
      "_id": "6a990f2a58090fe0fc2ad2f8",
      "sourceEstimateId": "6a990f2958090fe0fc2ad2d2",
      "leadId": "6a990f2858090fe0fc2ad27d",
      "customerId": "6a990f2758090fe0fc2ad229",
      "quoteNumber": "QUO-0001",
      "buildingType": "PEMB",
      "sqft": "3000",
      "materialCost": 10000,
      "freightCost": 1500,
      "totalCOGS": 11500,
      "markupPercent": 30.43,
      "markupValue": 3500,
      "basePrice": 15000,
      "finalPrice": 15000,
      "approval": {
        "status": "pending_approval"
      },
      "workflowStatus": "pending_approval"
    },
    "sourceEstimate": {
      "_id": "6a990f2958090fe0fc2ad2d2",
      "status": "final",
      "leadId": "6a990f2858090fe0fc2ad27d"
    }
  }
}
```

Note:

- If creator role is `sales`, quotation is auto-submitted (`approval.status = pending_approval`).
- If creator role is `admin`, quotation is auto-approved (`approval.status = approved`).
- Quotation response also includes:
  - `approvalStatus`
  - `workflowStatus`
  - `sourceEstimate` (normalized estimate snapshot)
  - `documentMeta` (preview/PDF regeneration context)

---

## Error responses

`404 Estimate not found`

```json
{ "success": false, "message": "Estimate not found" }
```

`400 Estimate not linked to lead`

```json
{
  "success": false,
  "message": "Estimate is not linked to a lead. Provide body.leadId, or ensure estimate.jobNumber matches Lead.jobId."
}
```

`403 Sales access denied`

```json
{ "success": false, "message": "Access denied" }
```

---

## Estimate to Quotation field mapping

Backend maps estimate fields to quotation fields:

- `EstimateQuote._id` -> `Quotation.sourceEstimateId`
- `EstimateQuote.leadId` -> `Quotation.leadId`
- `lead.customerId` -> `Quotation.customerId`
- `EstimateQuote.jobType` -> `Quotation.buildingType`
- `EstimateQuote.squareFootage` -> `Quotation.sqft` and `Quotation.totalArea`
- `EstimateQuote.materialCost` -> `Quotation.materialCost`
- `EstimateQuote.freightCost` -> `Quotation.freightCost`
- `EstimateQuote.totalCOGS` -> `Quotation.totalCOGS`
- `estimate grand total` -> `Quotation.basePrice`, `Quotation.maxPrice`, `Quotation.finalPrice`
- `EstimateQuote.additionalInfo` -> `Quotation.specialNote`, `Quotation.clientNotes`
- `EstimateQuote.exclusions[]` -> `Quotation.exclusions[]`
- `EstimateQuote.weightByCategory[]` -> `Quotation.includedMaterials[]`
- `EstimateQuote.concreteAddon/insulationAddon` -> `Quotation.optionalAddOns[]`

Grand total source priority:

1. `storagePricingResult.grandTotal`
2. `fullQuoteResult.grandTotal`
3. `totalSell`
4. `pricingResult.totSell`

---

## Frontend flow (recommended)

1. Create/update estimate using `/api/sales/estimates/*`.
2. Generate preview/PDF via estimate document APIs if needed.
3. Call `POST /api/quotations/from-estimate/:estimateId`.
4. Use returned `data.quotation._id` for approval flow:
   - `POST /api/quotations/:quotationId/submit-approval` (when needed)
   - `PUT /api/quotations/:quotationId/approve`
   - `PUT /api/quotations/:quotationId/reject`
   - `POST /api/quotations/:quotationId/send`

---

## Estimate History Redirect Support

To show whether an estimate is already converted (and redirect to that quotation), estimate read/list APIs now include:

- `estimate.conversion.isConvertedToQuotation`
- `estimate.conversion.quotationId`
- `estimate.conversion.quoteNumber`
- `estimate.conversion.quotationStatus`
- `estimate.conversion.approvalStatus`
- `estimate.conversion.workflowStatus`
- `estimate.conversion.convertedAt`

Available on:

- `GET /api/sales/estimates`
- `GET /api/sales/estimates/:estimateId`

Frontend usage:

- If `isConvertedToQuotation=true`, show "Converted to Quote" badge.
- Redirect using `quotationId` to quotation detail/approval screen.

---

## One-call submit approval option (estimateId aware)

To reduce multi-button/concurrent-call risk, submit endpoint now supports estimate-first input:

`POST /api/quotations/:quotationId/submit-approval`

Two ways to use:

1. Standard:
   - `:quotationId` is an actual quotation id
2. Estimate shortcut:
   - pass `:quotationId` as the `estimateId` directly, OR
   - pass body `{ "estimateId": "<estimateId>" }`
   - optional fallback: add `{ "leadId": "<leadId>" }` if estimate has no direct lead link

Behavior:

- If quotation exists -> submit that quotation.
- If quotation does not exist but estimate is valid -> backend auto-creates quotation from estimate and submits in the same request.
- If already pending -> returns success with message `Quotation already pending approval`.

Example:

```json
POST /api/quotations/6a990f2958090fe0fc2ad2d2/submit-approval
{
  "note": "Please review"
}
```

---

## Quotation Read API (estimate + document context)

To load a full quotation detail page with estimate linkage and document actions:

`GET /api/quotations/:quotationId?includeEstimate=true&includeDocuments=true`

Defaults:

- `includeEstimate=true`
- `includeDocuments=true`

Response adds:

- `quotation.sourceEstimate`:
  - `_id`, `leadId`, `status`, `jobType`, `squareFootage`, `grandTotal`, `updatedAt`
- `quotation.documentMeta`:
  - `source`
  - `sourceEstimateId`
  - `hasPricingData`
  - `previewEndpoint`
  - `pdfEndpoint`
  - `defaultSections`

This allows frontend to regenerate quote/sow/contract PDF/preview from estimate-backed quotations.

---

## Enum reference used in this flow

- `quotation.approval.status`: `not_submitted | pending_approval | approved | rejected`
- `quotation.workflowStatus`: `draft | pending_approval | approved | rejected | sent`
- `quotation.status`: `draft | sent | accepted | rejected`

