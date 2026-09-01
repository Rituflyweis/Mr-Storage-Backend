# SOW and Contract Preview API

**Date:** 2026-08-29  
**Module:** Sales Panel -> AI Quote  
**Base URL:** `https://mr-storage-backend-025k.onrender.com`

---

## Endpoint

`POST /api/sales/estimates/documents/preview`

This endpoint returns HTML previews for quote sections:
- `quoteHtml`
- `sowHtml`
- `contractHtml`
- `assembledHtml` (combined output with CSS included)

Use the `sections` array to control which previews are generated.

---

## Authentication

Header required:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

---

## 1) Preview SOW + Contract from saved estimate

### Request

```json
{
  "estimateId": "66abc123...",
  "sections": ["sow", "contract"]
}
```

### Response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "quoteHtml": null,
    "sowHtml": "<div class=\"quote-output\" id=\"sow-printable\">...</div>",
    "contractHtml": "<div class=\"quote-output\" style=\"font-family:Georgia,serif;...\">...</div>",
    "assembledHtml": "<!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>"
  }
}
```

---

## 2) Preview SOW + Contract using inline payload (without save)

### Request (PEMB example)

```json
{
  "jobType": "PEMB",
  "leadCompanyName": "Paris TN Expansion",
  "streetAddress": "123 Main St",
  "cityStateZip": "Paris, TN 38242",
  "customerEmail": "client@example.com",
  "buildingSize": "20x150",
  "squareFootage": 1505,
  "pricingResult": { "...": "compute pricing output" },
  "fullQuote": { "...": "compute fullQuote output" },
  "contract": {
    "customer": "Paris TN Expansion LLC",
    "address": "123 Main St",
    "city": "Paris, TN 38242",
    "email": "client@example.com",
    "date": "August 29, 2026",
    "deposit": "forty-percent (40%)",
    "type": "both",
    "value": "$54,415"
  },
  "sections": ["sow", "contract"]
}
```

### Response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "quoteHtml": null,
    "sowHtml": "<div ...>...</div>",
    "contractHtml": "<div ...>...</div>",
    "assembledHtml": "<!DOCTYPE html>..."
  }
}
```

---

## Sections options

Allowed values in `sections`:
- `"quote"`
- `"sow"`
- `"contract"`
- `"drawings"`

Examples:

```json
{ "estimateId": "66abc123...", "sections": ["sow"] }
```

```json
{ "estimateId": "66abc123...", "sections": ["contract"] }
```

```json
{ "estimateId": "66abc123...", "sections": ["sow", "contract"] }
```

---

## Styling behavior (important)

- `sowHtml` and `contractHtml` are HTML fragments.
- `assembledHtml` includes backend stylesheet (`QUOTE_STYLES`) and is ready to render directly.
- If rendering `sowHtml`/`contractHtml` alone, inject the quote stylesheet manually.

---

## Data requirements

The endpoint needs pricing context to build preview:

- PEMB: provide one of
  - `estimateId`, or
  - `pricingResult` / `fullQuote`

- Storage: provide one of
  - `estimateId`, or
  - `storagePricingResult`

If missing, API returns:

```json
{
  "success": false,
  "message": "pricingResult, storagePricingResult, or fullQuote required"
}
```

---

## Related endpoint: PDF output

To generate the PDF version (instead of preview HTML):

`POST /api/sales/estimates/documents/pdf`

Use the same payload structure (`estimateId` + `sections`, or inline payload + `sections`).

