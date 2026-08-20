# AI Quoting Tool — Backend API (Frontend Handoff)

Port of `SM-QuotingTool-v5 (31).html` logic to the backend. Same parsing + pricing engine as the standalone HTML tool.

**Base paths**
- Sales: `/api/sales/estimates` + `/api/sales/pricing-rules`
- Admin: `/api/admin/estimates` + `/api/admin/pricing-rules`

**Auth:** JWT `Authorization: Bearer <token>`

---

## Flow (PEMB quote)

```
1. GET  /pricing-rules              → load user's rates
2. POST /estimates/extract-drawing  → optional prelim PDF
3. POST /estimates/extract-shipper  → Xshipper .xlsx → categories + pricing
4. POST /estimates/compute          → re-price after slider/rule changes (optional)
5. POST /estimates                  → save draft
6. PUT  /estimates/:id              → update draft
```

Storage COG flow uses `POST /estimates/extract-storage-cog` instead of step 3.

---

## 1. Pricing rules

### `GET /api/sales/pricing-rules`

Returns per-user pricing document (auto-created with HTML tool defaults).

### `PUT /api/sales/pricing-rules`

Update rates. Supports **HTML-style custom rules**:

```json
{
  "steelRatesPerLb": {
    "primaryFrames": 1.71,
    "secondarySteel": 0.88,
    "hssBeams": 2.05,
    "angles": 1.04,
    "openingsJambs": 1.2,
    "platesClips": 1.2
  },
  "sheetingRatesPerSf": {
    "standardScrewDown": 1.30,
    "standingSeam": 1.70
  },
  "freight": {
    "ratePerLb": 0.13,
    "lbsPerTruck": 40000,
    "accessoriesAllowancePerSf": 0.10,
    "vendorDeltaPerLb": 0.10
  },
  "markup": {
    "pembMultiplier": 1.30,
    "storageMultiplier": 1.18
  },
  "install": {
    "pembEasy": { "cost": 5.5, "sell": 8.5 },
    "pembMedium": { "cost": 5.75, "sell": 9.0 }
  },
  "customTabRules": [
    {
      "matchType": "part_number",
      "match": "DK6",
      "cat": "trim",
      "method": "per_lf",
      "rate": 0.85,
      "note": "Jamb trim"
    }
  ]
}
```

**Custom rule methods:** `per_lb` | `per_lf` | `per_sf` | `flat_each` | `flat_total`  
**Match types:** `tab_name` | `part_number` | `description`

---

## 2. Extract prelim drawing (PDF)

### `POST /api/sales/estimates/extract-drawing`

Uses **pdf.js** (page 1, layout-aware) — same approach as HTML tool. Image-only or sparse prelims are handled automatically on the server.

**Request**
```json
{
  "fileBase64": "<base64 PDF>",
  "fileName": "prelim.pdf"
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "fileName": "prelim.pdf",
    "textItemCount": 842,
    "filledCount": 12,
    "extracted": {
      "customer": "ABC Storage LLC",
      "project": "Des Moines Self Storage",
      "jobnumber": "8098_Iowa_Fastener",
      "width": "200'",
      "length": "250'",
      "eave": "36'",
      "sqft": "50000",
      "snow": "45 psf",
      "wind": "110 mph",
      "exposure": "Exposure C",
      "slope": "1:12",
      "dead": "2.50 psf",
      "collateral": "5.00 psf"
    },
    "rawTextPreview": "...(line-by-line page 1 text)...",
    "note": "Best-effort extraction — review before applying."
  }
}
```

| Field | Notes |
|-------|-------|
| `extracted.*` | Keys match HTML `ex-*` fields: `customer`, `project`, `width`, `length`, `eave`, `sqft`, `dead`, `wind`, `snow`, `roofpanel`, `wall`, `shearlong`, etc. |

---

## 3. Extract shipper file (XLSX)

### `POST /api/sales/estimates/extract-shipper`

Parses all tabs, extracts **Total Weight** per tab, applies custom item rules, runs **priceJob** pricing engine.

**Request**
```json
{
  "fileBase64": "<base64 xlsx>",
  "fileName": "shipper.xlsx",
  "jobType": "PEMB",
  "scope": "both",
  "roof": "screw-down",
  "install": "medium",
  "squareFootage": 0,
  "blendPct": 50,
  "installCostPerSf": 5.85,
  "sellPerSf": 9.0
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `scope` | `both` | `supply` \| `install` \| `both` (lowercase, matches HTML) |
| `squareFootage` | `0` | If 0, estimated from total weight ÷ 9 |
| `blendPct` | `50` | Quicken/Central vendor blend 0–100 |
| `roof` | `screw-down` | or `standing-seam` |

**Response** (validated against `shipper_excel_quote_example.xlsx`)
```json
{
  "success": true,
  "data": {
    "fileName": "shipper_exlsx_quote_example.xlsx",
    "sheetCount": 10,
    "totalWeightLbs": 13547,
    "squareFootage": 1505,
    "tabSummary": [
      { "sheetName": "1. STUDS & TOP CHANNELS", "category": "primary", "weightLbs": 2168.5 },
      { "sheetName": "6. ANGLES", "category": "angle", "weightLbs": 753.1 }
    ],
    "parsedCategories": { "primary": { "weight": 2168.5 }, "..." : "..." },
    "coverSheet": {
      "coverName": "Cover ",
      "labelMap": { "customer": "...", "project": "..." }
    },
    "weightByCategory": [
      { "category": "Rigid Frames & Endwalls", "weightLbs": 2168.5, "rate": 1.71, "price": 3708.14 }
    ],
    "pricing": {
      "rows": [
        {
          "cat": "primary",
          "label": "Rigid Frames & Endwalls",
          "wt": 2168.5,
          "rate": "$1.71/lb",
          "price": 3708.14,
          "tag": "cat-primary",
          "notes": ""
        }
      ],
      "matCost": 15234,
      "totWt": 13326,
      "freight": 1732,
      "trucks": 1,
      "instCost": 8804,
      "instSell": 13545,
      "totCost": 25770,
      "matSell": 22041,
      "totSell": 35586,
      "profit": 9816,
      "profPct": "27.6",
      "sfPrice": "23.65",
      "blendLabel": "50% Quicken blend",
      "vendorBlendSavings": 666
    }
  }
}
```

---

## 4. Re-compute pricing (no re-upload)

### `POST /api/sales/estimates/compute`

Use when user changes scope, SF, blend slider, or install rates in UI.

**Request**
```json
{
  "parsedCategories": { "...from extract-shipper..." },
  "jobType": "PEMB",
  "scope": "supply",
  "squareFootage": 1505,
  "blendPct": 75,
  "roof": "screw-down",
  "install": "easy"
}
```

**Response:** `{ weightByCategory, pricing }`

---

## 5. Extract storage COG sheet

### `POST /api/sales/estimates/extract-storage-cog`

**Request:** `{ fileBase64, fileName }`

**Response**
```json
{
  "project": { "customer": "...", "location": "...", "date": "..." },
  "buildings": [
    {
      "name": "Bldg 1",
      "width": 50,
      "length": 150,
      "sqft": 7500,
      "psf": 5,
      "cogs": 37500,
      "markup": 25
    }
  ],
  "doors": [{ "type": "Trac-Rite", "size": "8' x 7'", "unitCost": 360, "qty": 2 }],
  "extras": [{ "item": "Insulation", "cogs": 12000, "markup": 25, "sale": 15000, "include": true }],
  "shippingDefault": 12000,
  "summary": {
    "buildingCount": 3,
    "totalSqft": 22500,
    "subtotalSell": 125000
  }
}
```

Save via `POST /estimates` with `jobType: "Storage"` and `storageData: { ... }`.

---

## 6. Save estimate

### `POST /api/sales/estimates`

```json
{
  "leadId": "665f...",
  "jobType": "PEMB",
  "scope": "both",
  "leadCompanyName": "ABC Storage",
  "customerEmail": "john@example.com",
  "buildingSize": "200x250x36",
  "squareFootage": 1505,
  "sourceFileName": "shipper.xlsx",
  "extractedDrawingFields": { "width": "200'", "snow": "45 psf" },
  "parsedCategories": { "...from extract-shipper..." },
  "tabSummary": [ "..." ],
  "pricingResult": { "...from extract-shipper or compute..." },
  "status": "draft"
}
```

Computed fields (`totalSell`, `profit`, `breakdownRows`, etc.) are persisted from `pricingResult`.

### Other CRUD

| Method | Path | Notes |
|--------|------|-------|
| GET | `/estimates` | List (sales: own only; admin: all) |
| GET | `/estimates/:id` | Detail |
| PUT | `/estimates/:id` | Draft only; re-runs pricing if `parsedCategories` sent |
| DELETE | `/estimates/:id` | |
| GET | `/estimates/history/summary` | Dashboard stats |

---

## 7. Frontend integration notes

### File upload helper
```javascript
async function fileToBase64(file) {
  const buf = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
```

### Match HTML tool behavior
- Customer message on shipper upload → append locally (not echoed by server)
- After PDF extract with 0 fields → show raw text + manual entry (same as HTML amber state)
- Persist `parsedCategories` + `pricingResult` so `/compute` can re-run on slider change
- Scope values: use lowercase `supply` | `install` | `both`

### Separate from formal `Quotation`
- **`EstimateQuote`** = AI quoting tool (shipper/weight-based) — this doc
- **`Quotation`** (`/api/quotations`) = manual proposal form + email send — different workflow

---

## 10. Storage COG pricing (`storageRecalcFull`)

### `POST /api/sales/estimates/compute-storage`

Re-price a Storage COG job (buildings, doors, extras, install, concrete, insulation, tax, grand total).

**Body:**
```json
{
  "storageData": {
    "buildings": [{ "name": "Bldg 1", "sqft": 5000, "cogs": 45000, "markup": 25 }],
    "doors": [{ "type": "OH", "unitCost": 1200, "qty": 2, "markup": 25 }],
    "extras": [{ "item": "Insulation", "cogs": 5000, "markup": 25, "include": true }],
    "shipping": 12000,
    "drawings": 2500,
    "installSellPerSf": 4.75,
    "installCostPerSf": 3.25
  },
  "concrete": { "include": true, "costSF": 7.25, "marginPct": 25 },
  "insulation": { "include": false },
  "salesTax": { "rate": 7.0, "include": true }
}
```

**Response:** `{ storagePricing }` with `grandTotal`, `profit`, `breakdown`, `salesTax`, etc.

Also returned from `POST /estimates/extract-storage-cog` when you pass the same addon/tax fields.

---

## 11. COGS override panel

### `POST /api/sales/estimates/cogs/preview`

Preview adjusted material cost/sell before applying.

```json
{
  "pricingResult": { "...from compute..." },
  "cogsOverride": {
    "costDollar": 28000,
    "marginPct": 22,
    "sellDollar": null,
    "applied": false
  }
}
```

Set `"applied": true` on `/compute` to lock adjusted values into `pricing`.

---

## 12. Margin override (lock sell price)

### `POST /api/sales/estimates/margin/preview`

```json
{
  "pricingResult": { "...from compute..." },
  "marginOverride": {
    "laborSF": 9.50,
    "pct": 28,
    "sellFixed": null,
    "applied": false
  }
}
```

Pass `"marginOverride": { "applied": true, "sellFixed": 42000 }` on `/compute` to lock total sell.

---

## 13. Concrete & insulation add-ons

Pass on `/compute`, `/extract-shipper`, or save on estimate:

```json
{
  "concrete": {
    "include": true,
    "thickness": 6,
    "psi": 4000,
    "costSF": 7.25,
    "marginPct": 25,
    "sowItems": ["Pier excavation", "6\" slab"],
    "sowNotes": "Optional note"
  },
  "insulation": {
    "include": true,
    "system": "vinyl",
    "rRoof": "R19",
    "rWall": "R13",
    "costSF": 1.50,
    "marginPct": 30
  }
}
```

Response includes `fullQuote` with `grandTotal` (building + concrete + insulation + tax).

---

## 14. Sales tax ZIP lookup

### `GET /api/sales/estimates/tax-lookup/:zip`

Example: `GET /api/sales/estimates/tax-lookup/51503`

```json
{
  "zip": "51503",
  "rate": 7.0,
  "label": "Council Bluffs, IA",
  "source": "zip_prefix",
  "message": "Council Bluffs, IA: 7%"
}
```

Uses embedded ZIP-prefix table (309 prefixes) + state averages via zippopotam.us fallback.

Pass resolved rate on compute:
```json
{ "salesTax": { "rate": 7.0, "include": true } }
```

PEMB: tax on `matSell + insulation`. Storage: tax on `buildings + doors + insulation` (labor not taxed).

---

## 15. Quote / SOW / contract PDF

### `POST /api/sales/estimates/documents/preview`

Returns HTML for quote + SOW + contract + drawings.

```json
{
  "leadCompanyName": "ABC Storage",
  "squareFootage": 1505,
  "pricingResult": { "..." },
  "fullQuote": { "..." },
  "drawingAttachments": [
    { "name": "prelim.pdf.png", "fileBase64": "data:image/png;base64,...", "includeInQuote": true }
  ],
  "sections": ["quote", "sow", "contract", "drawings"]
}
```

### `POST /api/sales/estimates/documents/pdf`

Same body; returns `{ fileName, mimeType, fileBase64, sizeBytes }`.

Or pass `{ "estimateId": "..." }` to generate from a saved estimate.

---

## 16. Extended estimate fields

New persisted fields on `EstimateQuote`:

| Field | Purpose |
|-------|---------|
| `concreteAddon` | Concrete config + computed sell |
| `insulationAddon` | Insulation config + computed sell |
| `salesTax` | Rate, amount, taxable base |
| `cogsOverride` | Applied COGS adjustments |
| `marginOverride` | Locked sell override |
| `storagePricingResult` | Full storage COG totals |
| `fullQuoteResult` | PEMB grand total bundle |
| `contractDetails` | Contract form fields |
| `drawingAttachments` | Base64 images for PDF appendix |
| `additionalInfo` | Extra quote paragraph |

---

## 17. Source files (updated)

| File | Purpose |
|------|---------|
| `src/services/quoting/storagePricingEngine.js` | Storage COG recalc |
| `src/services/quoting/addonPricing.js` | Concrete + insulation |
| `src/services/quoting/cogsOverride.js` | COGS panel |
| `src/services/quoting/marginOverride.js` | Margin lock |
| `src/services/quoting/salesTaxLookup.js` | ZIP tax lookup |
| `src/services/quoting/taxRates.js` | ZIP prefix + state rate tables |
| `src/services/quoting/quotePricingOrchestrator.js` | Full PEMB quote assembly |
| `src/services/quoting/quoteDocumentGenerator.js` | HTML + PDF output |
| `src/services/quoting/contractText.js` | Contract boilerplate |

---

## 8. Test script

```bash
node scripts/test-quoting-tool.js
```

Uses repo root example files:
- `pdf_quote_example.pdf`
- `shipper_excel_quote_example.xlsx`

---

## 9. Source files

| File | Purpose |
|------|---------|
| `src/services/quoting/shipperParser.js` | XLSX tab parse, weight extract |
| `src/services/quoting/drawingPdfExtractor.js` | PDF page-1 extract (pdf.js) |
| `src/services/quoting/pricingEngine.js` | priceJob pricing |
| `src/services/quoting/storageCogParser.js` | Storage COG Excel |
| `src/services/quoting/pricingRulesAdapter.js` | DB rules → PR object |
| `src/controllers/sales/estimateQuote.controller.js` | API handlers |
| `src/models/EstimateQuote.js` | Persisted estimate |
| `src/models/PricingRules.js` | Per-user rates + custom rules |
