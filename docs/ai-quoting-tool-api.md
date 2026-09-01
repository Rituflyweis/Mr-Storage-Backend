# AI Quoting Tool — Backend API

Backend port of `SM-QuotingTool-v5 (31).html`. Same shipper parsing, pricing engine, tax lookup, and document generation as the standalone HTML tool.

**Last updated:** August 2026 · Deploy branch: `shubham-changes-13-aug`

---

## Environments

| Environment | Base URL |
|-------------|----------|
| **Production (Render)** | `https://mr-storage-backend-025k.onrender.com` |
| **Local** | `http://localhost:5001` |

**API prefixes**
- Sales: `/api/sales/estimates` + `/api/sales/pricing-rules`
- Admin: `/api/admin/estimates` + `/api/admin/pricing-rules` (same handlers; admin sees all quotes)

**Reference frontend:** `SM-QuotingTool-API.html` (API-connected) · `SM-QuotingTool-v5 (31).html` (standalone source of truth)

---

## Authentication

All sales/admin quoting endpoints require:

```
Authorization: Bearer <accessToken>
```

### `POST /api/auth/login`

```json
{
  "email": "sales1@example.com",
  "password": "your-password"
}
```

**Response**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "user": { "_id": "...", "email": "...", "role": "sales" }
  }
}
```

Use `data.accessToken` (not `token`) on all subsequent requests.

---

## PEMB quote flow

```
1. GET  /pricing-rules              → load user's rates + customTabRules
2. POST /estimates/extract-drawing  → optional prelim PDF
3. POST /estimates/extract-shipper  → Xshipper .xlsx → categories + pricing
4. POST /estimates/compute          → re-price after slider/rule changes
5. POST /estimates                  → save draft
6. PUT  /estimates/:id              → update draft
7. POST /estimates/documents/pdf    → download quote PDF
```

Storage COG flow uses `POST /estimates/extract-storage-cog` instead of step 3.

---

## 1. Pricing rules

### `GET /api/sales/pricing-rules`

Returns per-user pricing document (auto-created with HTML tool defaults on first access).

### `PUT /api/sales/pricing-rules`

Update rates. Supports **HTML-style custom rules** (applied automatically on `extract-shipper` for that user — do not re-send rules in the upload body).

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
    "pembMedium": { "cost": 5.75, "sell": 9.0 },
    "pembHard": { "cost": 6.25, "sell": 9.25 },
    "pembTallHard": { "cost": 7.0, "sell": 11.0 }
  },
  "customTabRules": [
    {
      "matchType": "tab_name",
      "match": "stud",
      "cat": "primary",
      "method": "per_lb",
      "rate": 0,
      "note": "Studs tab override (optional — built-in parser handles this)"
    },
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

| Custom rule field | Values |
|-------------------|--------|
| `matchType` | `tab_name` \| `part_number` \| `description` |
| `method` | `per_lb` \| `per_lf` \| `per_sf` \| `flat_each` \| `flat_total` |
| `cat` | `primary` \| `secondary` \| `opening` \| `sheeting` \| `angle` \| `plate` \| `trim` \| `misc` \| `accessories` \| `fasteners` \| `hss` |

**Legacy pricing docs:** if sheeting or freight were saved with wrong defaults (e.g. `1.71` copied from steel rates), the adapter auto-repairs values `freight > 1` and `sheet > 2` back to HTML tool defaults at compute time.

---

## 2. Extract prelim drawing (PDF)

### `POST /api/sales/estimates/extract-drawing`

Uses **pdf.js** (page 1, layout-aware). Image-only or sparse prelims may return `filledCount: 0`.

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

Parses all material tabs, extracts **Total Weight** per tab, applies per-user `customTabRules`, runs **priceJob** pricing engine, returns full breakdown.

**Tab name handling:** leading numbers are stripped before category matching — e.g. `"1. STUDS & TOP CHANNELS"` → `primary`, `"6. ANGLES"` → `angle`, `"7. TRIM"` → `trim`. This matches the fixed v5 HTML tool behavior.

**Built-in tab → category map**

| Tab name patterns | Category key | Display label |
|-------------------|--------------|---------------|
| stud, top channel, column, rafter, rigid frame | `primary` | Rigid Frames & Endwalls |
| jamb, header, opening | `opening` | Door Jambs & Headers |
| purlin, girt, eave strut | `secondary` | Purlins, Girts & Eave Struts |
| sheeting | `sheeting` | Roof & Wall Sheeting |
| angle | `angle` | Angles |
| plate, connection | `plate` | Connection Plates & Clips |
| trim | `trim` | Trim |
| bracing, cable, sealant | `misc` | Cables, Bracing & Sealant |
| accessor | `accessories` | Accessories |
| fastener, screw, bolt | `fasteners` | Fasteners |
| hss | `hss` | HSS Beams |
| cover, index, summary | *(skipped)* | — |

**Request**

```json
{
  "fileBase64": "<base64 xlsx>",
  "fileName": "shipper_excel_quote_example.xlsx",
  "jobType": "PEMB",
  "scope": "both",
  "roof": "screw-down",
  "install": "medium",
  "squareFootage": 0,
  "sf": 0,
  "blendPct": 50,
  "installCostPerSf": 5.5,
  "sellPerSf": 8.5,
  "useManualSquareFootage": false
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `scope` | `both` | `supply` \| `install` \| `both` (lowercase) |
| `squareFootage` / `sf` | `0` | On upload, backend **derives SF from weight ÷ 9** unless `useManualSquareFootage: true` |
| `useManualSquareFootage` | `false` | Set `true` when user manually typed SF (send on `/compute` after edit) |
| `blendPct` | `50` | Quicken/Central vendor blend 0–100 |
| `roof` | `screw-down` | or `standing-seam` |
| `install` | `medium` | `easy` \| `medium` \| `hard` \| `tall-hard` |
| `installCostPerSf` | from rules | Optional override (HTML install cost slider) |
| `sellPerSf` | from rules | Optional override (HTML install sell slider) |

**Square footage rules**

| Scenario | Behavior |
|----------|----------|
| Fresh shipper upload (`useManualSquareFootage: false`) | `squareFootage = round(totalWeightLbs / 9)` |
| User edits SF field | Send `useManualSquareFootage: true` + `squareFootage` on `/compute` |
| No weight detected | Uses client `squareFootage` if provided, else `0` |

**Frontend tip:** on shipper upload, send `squareFootage: 0` and `useManualSquareFootage: false` so stale SF from a prior quote is not reused.

**Response** — validated against `shipper_excel_quote_example.xlsx` (PEMB, both, medium, SF auto=1505, install 5.50/8.50, 50% blend):

```json
{
  "success": true,
  "data": {
    "fileName": "shipper_excel_quote_example.xlsx",
    "sheetCount": 10,
    "totalWeightLbs": 13547.18,
    "squareFootage": 1505,
    "tabSummary": [
      { "sheetName": "Cover ", "skipped": true, "weightLbs": 0 },
      { "sheetName": "1. STUDS & TOP CHANNELS", "category": "primary", "weightLbs": 2168.5 },
      { "sheetName": "2. DOOR JAMBS & HEADERS", "category": "opening", "weightLbs": 1650.3 },
      { "sheetName": "3. PURLINS, EAVE STRUTS, WALL G", "category": "secondary", "weightLbs": 949.5 },
      { "sheetName": "4. ROOF & WALL SHEETING", "category": "sheeting", "weightLbs": 6240.5 },
      { "sheetName": "5. CONNECTION PLATES", "category": "plate", "weightLbs": 232.9 },
      { "sheetName": "6. ANGLES", "category": "angle", "weightLbs": 753.1 },
      { "sheetName": "7. TRIM", "category": "trim", "weightLbs": 896.4 },
      { "sheetName": "8.ACCESSORIES", "category": "accessories", "weightLbs": 434.41 },
      { "sheetName": "9.FASTENERS", "category": "fasteners", "weightLbs": 221.57 }
    ],
    "parsedCategories": {
      "primary": { "label": "Rigid Frames & Endwalls", "weight": 2168.5, "tag": "cat-primary" },
      "secondary": { "label": "Purlins, Girts & Eave Struts", "weight": 949.5, "tag": "cat-secondary" },
      "opening": { "label": "Door Jambs & Headers", "weight": 1650.3, "tag": "cat-opening" },
      "sheeting": { "label": "Roof & Wall Sheeting", "weight": 6240.5, "tag": "cat-sheeting" },
      "angle": { "label": "Angles", "weight": 753.1, "tag": "cat-angle" },
      "plate": { "label": "Connection Plates & Clips", "weight": 232.9, "tag": "cat-angle" },
      "trim": { "label": "Trim", "weight": 896.4, "tag": "cat-trim" },
      "misc": { "label": "Cables, Bracing & Sealant", "weight": 0, "tag": "cat-misc" },
      "accessories": { "label": "Accessories", "weight": 434.41, "tag": "cat-misc" },
      "fasteners": { "label": "Fasteners", "weight": 221.57, "tag": "cat-fastener" },
      "customItems": []
    },
    "coverSheet": {
      "coverName": "Cover ",
      "labelMap": { "customer": "...", "project": "..." },
      "preview": "...(first 2000 chars)..."
    },
    "weightByCategory": [
      { "category": "Rigid Frames & Endwalls", "weightLbs": 2168.5, "rate": 1.71, "price": 3708.14 }
    ],
    "pricing": {
      "rows": [
        { "cat": "primary", "label": "Rigid Frames & Endwalls", "wt": 2168.5, "rate": "$1.71/lb", "price": 3708.14, "tag": "cat-primary", "notes": "" },
        { "cat": "secondary", "label": "Purlins, Girts & Eave Struts", "wt": 949.5, "rate": "$0.88/lb", "price": 835.56, "tag": "cat-secondary", "notes": "" },
        { "cat": "opening", "label": "Door Jambs & Headers", "wt": 1650.3, "rate": "$1.2/lb", "price": 1980.36, "tag": "cat-opening", "notes": "" },
        { "cat": "sheeting", "label": "Roof & Wall Sheeting", "wt": 6240.5, "rate": "$1.3/SF", "price": 3244.8, "tag": "cat-sheeting", "notes": "~2,496 SF" },
        { "cat": "angle", "label": "Angles", "wt": 753.1, "rate": "$1.04/lb", "price": 783.22, "tag": "cat-angle", "notes": "" },
        { "cat": "plate", "label": "Connection Plates & Clips", "wt": 232.9, "rate": "$1.2/lb", "price": 279.48, "tag": "cat-angle", "notes": "" },
        { "cat": "trim", "label": "Trim", "wt": 896.4, "rate": "bucket", "price": 2509.92, "tag": "cat-trim", "notes": "" },
        { "cat": "misc", "label": "Cables, Bracing & Sealant", "wt": null, "rate": "bucket", "price": 331.1, "tag": "cat-misc", "notes": "" },
        { "cat": "accessories", "label": "Accessories", "wt": 434.41, "rate": "bucket", "price": 1505, "tag": "cat-misc", "notes": "" },
        { "cat": "fasteners", "label": "Fasteners", "wt": null, "rate": "per item (not $/lb)", "price": 722.4, "tag": "cat-fastener", "notes": "Priced per piece — screws, tape, sealant" }
      ],
      "matCost": 15233.7,
      "totWt": 13326,
      "freight": 1732.33,
      "trucks": 1,
      "instCost": 8277.5,
      "instSell": 12792.5,
      "totCost": 25243.53,
      "matSell": 19820.84,
      "totSell": 34848.34,
      "profit": 9604.81,
      "profPct": "27.6",
      "sfPrice": "23.16",
      "sf": 1505,
      "blendLabel": "50% Quicken blend",
      "vendorBlendSavings": 666
    },
    "fullQuote": null,
    "note": "Parsed using Storage Materials quoting tool rules — review categories and pricing before saving."
  }
}
```

**Breakdown table columns (match v5 HTML):** Category · Weight (lbs) · Rate · Price · Notes, plus footer rows: Material total, Freight, Install cost, Total cost, Install sell, **SELL PRICE**.

---

## 4. Re-compute pricing (no re-upload)

### `POST /api/sales/estimates/compute`

Use when user changes scope, SF, blend slider, install rates, addons, tax, or overrides.

**Request**

```json
{
  "parsedCategories": { "...from extract-shipper..." },
  "jobType": "PEMB",
  "scope": "both",
  "squareFootage": 1505,
  "useManualSquareFootage": true,
  "blendPct": 50,
  "roof": "screw-down",
  "install": "medium",
  "installCostPerSf": 5.5,
  "sellPerSf": 8.5,
  "concrete": { "include": false },
  "insulation": { "include": false },
  "salesTax": { "rate": 7, "include": true },
  "cogsOverride": { "applied": false },
  "marginOverride": { "applied": false }
}
```

**Response**

```json
{
  "success": true,
  "data": {
    "weightByCategory": [ "..." ],
    "pricing": { "...same shape as extract-shipper..." },
    "fullQuote": {
      "grandTotal": 51693,
      "pricePerSf": "34.35",
      "concrete": { "appliedSell": 14548 },
      "insulation": { "appliedSell": 0 },
      "salesTax": { "rate": 7, "amount": 1544 },
      "totalProfit": 12000,
      "grandMargin": 23.2
    }
  }
}
```

`fullQuote` is populated when any of `concrete`, `insulation`, `salesTax`, `cogsOverride.applied`, or `marginOverride.applied` is sent.

---

## 5. Extract storage COG sheet

### `POST /api/sales/estimates/extract-storage-cog`

**Request:** `{ "fileBase64": "...", "fileName": "cog.xlsx" }`

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
  "format": "vendor_cog",
  "storagePricing": { "grandTotal": 125000, "profit": 35000, "marginPercent": 28 },
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
  "buildingSize": "60x120x16",
  "squareFootage": 1505,
  "sourceFileName": "shipper_excel_quote_example.xlsx",
  "extractedDrawingFields": { "width": "60'", "sqft": "1505" },
  "parsedCategories": { "...from extract-shipper..." },
  "tabSummary": [ "..." ],
  "pricingResult": { "...from extract-shipper or compute..." },
  "fullQuoteResult": { "...from compute when addons/tax included..." },
  "concreteAddon": { "include": true, "costSF": 7.25, "marginPct": 25 },
  "insulationAddon": { "include": false },
  "salesTax": { "rate": 7, "include": true, "amount": 1544 },
  "status": "draft"
}
```

Computed totals (`totalSell`, `profit`, `breakdownRows`, etc.) are persisted from `pricingResult` / `fullQuoteResult`.

### CRUD

| Method | Path | Notes |
|--------|------|-------|
| GET | `/estimates` | List (sales: own only; admin: all) |
| GET | `/estimates/:id` | Detail |
| PUT | `/estimates/:id` | Draft only; re-runs pricing if `parsedCategories` sent |
| DELETE | `/estimates/:id` | |
| GET | `/estimates/history/summary` | Dashboard stats |

---

## 7. Storage COG re-compute

### `POST /api/sales/estimates/compute-storage`

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

---

## 8. COGS override panel

### `POST /api/sales/estimates/cogs/preview`

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

Set `"applied": true` on `/compute` to lock adjusted values into pricing.

---

## 9. Margin override (lock sell price)

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

## 10. Concrete & insulation add-ons

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

## 11. Sales tax ZIP lookup

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

Pass resolved rate on compute:

```json
{ "salesTax": { "rate": 7.0, "include": true } }
```

**Tax base:** PEMB — tax on `matSell + insulation`. Storage — tax on `buildings + doors + insulation` (labor not taxed).

---

## 12. Quote / SOW / contract PDF

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

**Render note:** Chrome is installed at build time (`npx puppeteer browsers install chrome`) for PDF generation in production.

---

## 13. Frontend integration

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

### Shipper upload (recommended)

```javascript
async function uploadShipper(file, token) {
  const res = await fetch(`${API_BASE}/api/sales/estimates/extract-shipper`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fileBase64: await fileToBase64(file),
      fileName: file.name,
      jobType: 'PEMB',
      scope: 'both',
      roof: 'screw-down',
      install: 'medium',
      squareFootage: 0,           // force weight-derived SF
      useManualSquareFootage: false,
      blendPct: 50,
      installCostPerSf: 5.5,
      sellPerSf: 8.5,
    }),
  })
  const { data } = await res.json()
  return data // parsedCategories, pricing, squareFootage, tabSummary
}
```

### Re-compute after SF edit

```javascript
await fetch(`${API_BASE}/api/sales/estimates/compute`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    parsedCategories,
    jobType: 'PEMB',
    scope: 'both',
    squareFootage: userEnteredSf,
    useManualSquareFootage: true,
    blendPct: 50,
    installCostPerSf: 5.5,
    sellPerSf: 8.5,
  }),
})
```

### Match HTML tool behavior

- Customer message on shipper upload → append locally (not echoed by server)
- After PDF extract with 0 fields → show raw text + manual entry (amber state)
- Persist `parsedCategories` + `pricingResult` so `/compute` can re-run on slider change
- Scope values: lowercase `supply` | `install` | `both`
- Render breakdown footer rows: Material total → Freight → Install cost → Total cost → Install sell → **SELL PRICE**

### Separate from formal `Quotation`

| Model | Route | Purpose |
|-------|-------|---------|
| **EstimateQuote** | `/api/sales/estimates` | AI quoting tool (shipper/weight-based) — this doc |
| **Quotation** | `/api/quotations` | Manual proposal form + email send — different workflow |

---

## 14. Extended estimate fields

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
| `parsedCategories` | Raw shipper category weights |
| `tabSummary` | Per-sheet parse log |

---

## 15. Test script

```bash
node scripts/test-quoting-tool.js
```

Uses repo root example files:
- `pdf_quote_example.pdf`
- `shipper_excel_quote_example.xlsx`

Expected shipper baseline: **13,547 lbs parsed · 1,505 SF · 10 pricing rows · ~$15,234 material cost · ~$34,848 sell** (PEMB/both, install 5.50/8.50, 50% blend).

---

## 16. Source files

| File | Purpose |
|------|---------|
| `src/services/quoting/shipperParser.js` | XLSX tab parse, `normalizeTabName`, weight extract |
| `src/services/quoting/drawingPdfExtractor.js` | PDF page-1 extract (pdf.js) |
| `src/services/quoting/pricingEngine.js` | `priceJob` pricing |
| `src/services/quoting/pricingRulesAdapter.js` | DB rules → PR object + legacy repair |
| `src/services/quoting/storageCogParser.js` | Storage COG Excel |
| `src/services/quoting/storagePricingEngine.js` | Storage COG recalc |
| `src/services/quoting/addonPricing.js` | Concrete + insulation |
| `src/services/quoting/cogsOverride.js` | COGS panel |
| `src/services/quoting/marginOverride.js` | Margin lock |
| `src/services/quoting/salesTaxLookup.js` | ZIP tax lookup |
| `src/services/quoting/quotePricingOrchestrator.js` | Full PEMB quote assembly |
| `src/services/quoting/quoteDocumentGenerator.js` | HTML + PDF output |
| `src/controllers/sales/estimateQuote.controller.js` | API handlers |
| `src/models/EstimateQuote.js` | Persisted estimate |
| `src/models/PricingRules.js` | Per-user rates + custom rules |
| `SM-QuotingTool-API.html` | Reference API-connected frontend |
| `SM-QuotingTool-v5 (31).html` | Standalone reference tool |

**React integration flow:** see [`quoting-tool-frontend-integration-flow.md`](./quoting-tool-frontend-integration-flow.md)
