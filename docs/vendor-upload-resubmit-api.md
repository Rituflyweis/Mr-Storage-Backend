# Vendor upload & resubmit API (frontend guide)

Public endpoints used by the **vendor quote upload page** (`/vendor-upload/:token`).  
When plant requests a resubmit after comparison exceptions, the vendor opens a **new link** with a fresh token.

Base path: `/api/public`

---

## Flow overview

```
1. GET  /vendor-upload/:token              → bootstrap page (project info + exceptions if resubmit)
2. POST /vendor-upload/:token/presigned-url → S3 presign for PDF/XLSX
3. POST /vendor-upload/:token              → submit file URL + updated quoteValue
```

Plant side (after vendor resubmits):

```
POST /api/plant/shipper-requests/:requestId/compare
GET  /api/plant/shipper-requests/:requestId/comparison-summary
GET  /api/plant/shipper-requests/:requestId/comparison-results
POST /api/plant/shipper-requests/:requestId/request-resubmit
```

---

## 1. `GET /api/public/vendor-upload/:token`

Bootstrap the upload page.

### Allowed `status` values on the link

| Status | Vendor can upload? |
|--------|-------------------|
| `sent` | Yes (first submission) |
| `resubmit_requested` | Yes (revised quote) |
| `submitted` | Yes (replace before plant compares) |

Other statuses (`approved`, `rejected`, `comparison_processing`, etc.) return **400** — link not active.

### Response `data` — first submission (`status: "sent"`)

```json
{
  "requestId": "6a312b5bd51fc72a1f383d51",
  "status": "sent",
  "vendorName": "ABC Steel",
  "projectName": "Twin Creek Condos",
  "jobId": "PRO-016",
  "consolidatedBOMFileUrl": "https://bucket.s3.../consolidated/....xlsx",
  "submittedFileUrl": null,
  "submittedFileName": "",
  "submittedAt": null,
  "quoteValue": null,
  "isResubmit": false,
  "resubmitCount": 0,
  "resubmitRequestedAt": null,
  "resubmitNote": "",
  "priorQuoteValue": null,
  "requiresQuoteValue": true,
  "exceptionSummary": null,
  "submissionHistoryCount": 0
}
```

### Response `data` — resubmit (`status: "resubmit_requested"`)

Same fields; `isResubmit: true` and `exceptionSummary` is populated with comparison issues from the **previous** submission.

```json
{
  "requestId": "6a312b5bd51fc72a1f383d51",
  "status": "resubmit_requested",
  "vendorName": "ABC Steel",
  "projectName": "Dave Gas Stations",
  "jobId": "PRO-018",
  "consolidatedBOMFileUrl": "https://bucket.s3.../consolidated/....xlsx",
  "submittedFileUrl": null,
  "submittedFileName": "",
  "submittedAt": null,
  "quoteValue": null,
  "isResubmit": true,
  "resubmitCount": 1,
  "resubmitRequestedAt": "2026-06-16T12:00:00.000Z",
  "resubmitNote": "Please correct the following comparison issues and resubmit: 2 missing, 2 extra.",
  "priorQuoteValue": 41994.12,
  "requiresQuoteValue": true,
  "submissionHistoryCount": 1,
  "exceptionSummary": {
    "blockers": ["missing_items", "extra_items"],
    "canProceedToApproval": false,
    "comparisonSummary": {
      "expectedLines": 142,
      "vendorLines": 142,
      "matchedLines": 140,
      "missingItems": 2,
      "extraItems": 2,
      "qtyMismatches": 0,
      "lengthMismatches": 0,
      "weightMismatches": 0,
      "priceMismatches": 0,
      "partMismatches": 0,
      "ambiguousMatches": 0,
      "manualReviewRequired": 4
    },
    "exceptionCount": 4,
    "exceptions": [
      {
        "issueType": "missing",
        "severity": "critical",
        "reason": "Expected mark _ (0.000ft) not found in vendor quote.",
        "mark": "_"
      },
      {
        "issueType": "extra",
        "severity": "medium",
        "reason": "Vendor quoted mark n/a (n/a) not present in Consolidated BOM.",
        "mark": ""
      }
    ],
    "highlights": [
      {
        "issueType": "missing",
        "count": 2,
        "samples": [
          {
            "mark": "_",
            "severity": "critical",
            "reason": "Expected mark _ (0.000ft) not found in vendor quote.",
            "direction": null
          }
        ]
      },
      {
        "issueType": "extra",
        "count": 2,
        "samples": [
          {
            "mark": "",
            "severity": "medium",
            "reason": "Vendor quoted mark n/a (n/a) not present in Consolidated BOM.",
            "direction": null
          }
        ]
      }
    ],
    "priorQuoteValue": 41994.12,
    "priorSubmittedFileName": "Dave_Gas_Quote.pdf",
    "priorSubmittedAt": "2026-06-16T10:00:00.000Z"
  }
}
```

### `exceptionSummary` field reference (vendor upload UI)

| Field | Type | UI usage |
|-------|------|----------|
| `blockers` | `string[]` | High-level badges: `missing_items`, `extra_items`, `qty_mismatch`, `length_mismatch`, `ambiguous_match`, `part_mismatch` |
| `canProceedToApproval` | `boolean` | Not used on vendor page (plant only) |
| `comparisonSummary` | object | Summary counts table |
| `exceptionCount` | number | Total exception rows |
| `exceptions` | array | **Main list to render** (up to 150 items) |
| `highlights` | array | Grouped counts + 5 samples per issue type |
| `priorQuoteValue` | number \| null | Show “Previous quote: $X” |
| `priorSubmittedFileName` | string | Previous file name |
| `priorSubmittedAt` | date \| null | Previous upload time |

### Exception item shape (`exceptions[]`)

```json
{
  "issueType": "missing",
  "severity": "critical",
  "reason": "Expected mark G-3 (24.125ft) not found in vendor quote.",
  "mark": "G-3",
  "direction": "over",
  "auditType": "row_preserved_line_audit"
}
```

| `issueType` | Display label |
|-------------|---------------|
| `missing` | Missing in your quote |
| `extra` | Extra in your quote (not in BOM) |
| `qty_mismatch` | Quantity mismatch |
| `length_mismatch` | Length mismatch |
| `ambiguous` | Ambiguous — review mark/qty |
| `part_mismatch` | Part code mismatch |

Optional fields: `direction` (`over` / `under`), `auditType` (internal row-preserved audit).

### Suggested vendor upload UI

1. If `isResubmit`:
   - Alert banner with `resubmitNote`
   - Show `priorQuoteValue` and prompt for **new** `quoteValue`
   - Table from `exceptionSummary.exceptions` (or group by `highlights`)
2. Always show link to `consolidatedBOMFileUrl` (reference BOM)
3. File input + **quote amount** input (`requiresQuoteValue: true`)
4. On submit → `POST /vendor-upload/:token` with new file + `quoteValue`

---

## 2. `POST /api/public/vendor-upload/:token/presigned-url`

### Request

```json
{
  "fileName": "revised-quote.pdf",
  "fileType": "application/pdf",
  "folder": "vendor-uploads"
}
```

### Response `data`

```json
{
  "uploadUrl": "https://bucket.s3...?X-Amz-...",
  "fileUrl": "https://bucket.s3.../vendor-uploads/.../revised-quote.pdf",
  "key": "vendor-uploads/.../revised-quote.pdf"
}
```

Upload file to `uploadUrl` with `PUT` and `Content-Type: application/pdf`, then use `fileUrl` in submit.

---

## 3. `POST /api/public/vendor-upload/:token`

Submit after S3 upload.

### Request

```json
{
  "submittedFileUrl": "https://bucket.s3.../vendor-uploads/.../revised-quote.pdf",
  "submittedFileName": "revised-quote.pdf",
  "quoteValue": 42500
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `submittedFileUrl` | Yes | Final S3 URL |
| `submittedFileName` | Yes | Display name |
| `quoteValue` | Yes | **Updated total quote amount** (numeric) |

### Response `data`

Same shape as GET bootstrap, with `status: "submitted"`, `quoteValue` set, `exceptionSummary: null`.

---

## Plant: request resubmit (triggers new vendor link)

`POST /api/plant/shipper-requests/:requestId/request-resubmit`

### Request

```json
{
  "note": "Please fix CHW250 / CL-21A cable hardware lines.",
  "includeComparisonExceptions": true
}
```

| Field | Required | Default |
|-------|----------|---------|
| `note` | Optional if comparison exceptions exist | — |
| `includeComparisonExceptions` | No | `true` |

### Response `data`

```json
{
  "requestId": "...",
  "status": "resubmit_requested",
  "reviewedAt": "2026-06-16T12:00:00.000Z",
  "resubmitCount": 1,
  "uploadUrl": "https://app.example.com/vendor-upload/NEW_TOKEN_HERE",
  "priorToken": "old_token_invalid_after_resubmit",
  "token": "NEW_TOKEN_HERE",
  "note": "Please correct...",
  "exceptionSummary": { "... same shape as vendor GET ..." },
  "emailFailures": []
}
```

**Important:** Each resubmit rotates the token. Email includes summary counts + exception table (up to 25 rows).

---

## Plant: comparison summary (plant panel)

`GET /api/plant/shipper-requests/:requestId/comparison-summary`

Use on plant side for full comparison UI (richer than vendor `exceptionSummary`).

### Response `data` (partial)

```json
{
  "requestId": "...",
  "status": "comparison_completed",
  "comparisonStatus": "completed",
  "summary": {
    "expectedLines": 142,
    "vendorLines": 142,
    "matchedLines": 140,
    "missingItems": 2,
    "extraItems": 2,
    "qtyMismatches": 0
  },
  "exceptionsCount": 4,
  "resultCount": 144,
  "results": [
    {
      "resultId": "...",
      "status": "missing_in_vendor_quote",
      "severity": "critical",
      "expected": {
        "mark": "_",
        "partCode": "CHW250",
        "description": "CBL Hardware",
        "totalQty": 1,
        "lengthFeet": 0
      },
      "received": null,
      "difference": { "qtyDiff": -1 },
      "matchMethod": "none",
      "matchConfidence": 0,
      "reason": "Expected mark _ (0.000ft) not found in vendor quote."
    }
  ],
  "canProceedToApproval": false,
  "blockers": ["missing_items", "extra_items"],
  "resubmitAvailable": true,
  "resubmitCount": 0,
  "vendorExceptionSummary": null
}
```

### Plant result `status` → vendor `issueType` mapping

| Plant `results[].status` | Vendor `exceptions[].issueType` |
|--------------------------|----------------------------------|
| `missing_in_vendor_quote` | `missing` |
| `extra_in_vendor_quote` | `extra` |
| `qty_mismatch` | `qty_mismatch` |
| `length_mismatch` | `length_mismatch` |
| `ambiguous_match` | `ambiguous` |
| `part_mismatch` | `part_mismatch` |
| `matched` | (not an exception) |

Paginated detail: `GET /api/plant/shipper-requests/:requestId/comparison-results?status=missing_in_vendor_quote&page=1&limit=50`

---

## Error responses

```json
{
  "success": false,
  "message": "This upload link is not active (status: approved)"
}
```

Invalid/expired token:

```json
{
  "success": false,
  "message": "Invalid or expired upload link"
}
```

---

## Frontend checklist

- [ ] Parse token from route `/vendor-upload/:token`
- [ ] `GET` bootstrap on page load
- [ ] If `isResubmit`, render `resubmitNote`, `priorQuoteValue`, and `exceptionSummary.exceptions`
- [ ] Require numeric `quoteValue` on submit (updated amount)
- [ ] Presign → PUT to S3 → POST submit
- [ ] After resubmit, old token links stop working (plant issues new URL)
