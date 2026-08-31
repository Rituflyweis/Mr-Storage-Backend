# Sales Panel AI Quote API - Full Documentation

**Date:** 2026-08-28  
**Module:** Sales Panel -> AI Quote  
**Production Base URL:** `https://mr-storage-backend-025k.onrender.com`  
**Primary Routes:** `/api/sales/estimates`, `/api/sales/pricing-rules`

---

## 1) Authentication

### Login
`POST /api/auth/login`

Request:
```json
{
  "email": "sales1@example.com",
  "password": "sales@1234"
}
```

Response:
```json
{
  "success": true,
  "message": "Success",
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": {
      "_id": "69e61375e2dc3d6e7468ca3d",
      "email": "sales1@example.com",
      "role": "sales",
      "name": "Sales One"
    }
  }
}
```

Use header for all quote APIs:
`Authorization: Bearer <accessToken>`

---

## 2) End-to-End Flow

### PEMB flow
1. `GET /api/sales/pricing-rules`
2. Optional: `POST /api/sales/estimates/extract-drawing`
3. `POST /api/sales/estimates/extract-shipper`
4. Recompute as user edits: `POST /api/sales/estimates/compute`
5. Save draft: `POST /api/sales/estimates`
6. Update draft: `PUT /api/sales/estimates/:estimateId`
7. Preview docs: `POST /api/sales/estimates/documents/preview`
8. Generate PDF: `POST /api/sales/estimates/documents/pdf`

### Storage flow
1. `POST /api/sales/estimates/extract-storage-cog`
2. Recompute: `POST /api/sales/estimates/compute-storage`
3. Save/update estimate
4. Preview/PDF generation

---

## 3) Pricing Rules APIs

### Get pricing rules
`GET /api/sales/pricing-rules`

Response:
```json
{
  "success": true,
  "data": {
    "pricingRules": {
      "steelRatesPerLb": {
        "primaryFrames": 1.71,
        "secondarySteel": 0.88,
        "hssBeams": 2.05,
        "angles": 1.04,
        "openingsJambs": 1.2,
        "platesClips": 1.2
      },
      "sheetingRatesPerSf": {
        "standardScrewDown": 1.3,
        "standingSeam": 1.7
      },
      "freight": {
        "ratePerLb": 0.13,
        "lbsPerTruck": 40000,
        "vendorDeltaPerLb": 0.1
      },
      "markup": {
        "pembMultiplier": 1.3,
        "storageMultiplier": 1.18
      },
      "install": {
        "pembEasy": { "cost": 5.5, "sell": 8.5 },
        "pembMedium": { "cost": 5.75, "sell": 9.0 },
        "pembHard": { "cost": 6.25, "sell": 9.25 },
        "pembTallHard": { "cost": 7.0, "sell": 11.0 }
      },
      "customTabRules": []
    }
  }
}
```

### Update pricing rules
`PUT /api/sales/pricing-rules`

Request:
```json
{
  "steelRatesPerLb": { "primaryFrames": 1.71 },
  "markup": { "pembMultiplier": 1.3 },
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

---

## 4) Drawing Extraction API (PEMB helper)

### Extract prelim drawing
`POST /api/sales/estimates/extract-drawing`

Request:
```json
{
  "fileBase64": "<base64_pdf>",
  "fileName": "prelim.pdf"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "fileName": "prelim.pdf",
    "textItemCount": 842,
    "filledCount": 12,
    "extracted": {
      "customer": "ABC Storage LLC",
      "project": "Project Name",
      "width": "90'",
      "length": "225'",
      "eave": "20.5'",
      "sqft": "20250",
      "frame": "Rigid Frame",
      "wind": "110 mph",
      "snow": "20 psf"
    },
    "note": "Best-effort extraction - review before applying."
  }
}
```

---

## 5) Shipper Extraction API (PEMB)

### Extract shipper + first pricing pass
`POST /api/sales/estimates/extract-shipper`

Request:
```json
{
  "fileBase64": "<base64_xlsx>",
  "fileName": "#6959 Paris, TN expansion (Shipper).xlsx",
  "jobType": "PEMB",
  "scope": "supply",
  "roof": "screw-down",
  "install": "easy",
  "squareFootage": 0,
  "sf": 0,
  "useManualSquareFootage": false,
  "blendPct": 50,
  "installCostPerSf": 5.5,
  "sellPerSf": 8.5,
  "concrete": { "include": false },
  "insulation": { "include": false },
  "salesTax": { "rate": 0, "include": true }
}
```

Response (shape):
```json
{
  "success": true,
  "data": {
    "fileName": "#6959 Paris, TN expansion (Shipper).xlsx",
    "sheetCount": 10,
    "tabSummary": [],
    "totalWeightLbs": 13547.18,
    "detectedWeightLbs": 13547.18,
    "unmappedWeightLbs": 0,
    "extractionCoveragePct": 100,
    "unmappedTabs": [],
    "squareFootage": 1505,
    "squareFootageMeta": {
      "selected": 1505,
      "source": "weight_formula",
      "formula": "round(totalWeightLbs / 9)",
      "fromWeight": 1505,
      "coverDerivedSqft": 3000,
      "inputSf": 0
    },
    "parsedCategories": {},
    "coverSheet": {
      "coverName": "Cover",
      "labelMap": {},
      "preview": "..."
    },
    "weightByCategory": [],
    "pricing": {
      "rows": [],
      "rowSubtotalBeforeBlend": 15899.98,
      "vendorBlendAdjustment": -677.36,
      "vendorBlendSavingsExact": 677.36,
      "matCost": 15222.62,
      "freight": 1761.13,
      "totWt": 13547.18,
      "totSell": 22078.88,
      "profPct": "23.1",
      "sf": 1505,
      "sfPrice": "14.67",
      "blendLabel": "50% Quicken blend"
    },
    "fullQuote": {},
    "note": "Parsed using Storage Materials quoting tool rules - review categories and pricing before saving."
  }
}
```

---

## 6) Compute API (PEMB)

### Recompute quote from parsed categories
`POST /api/sales/estimates/compute`

Request:
```json
{
  "parsedCategories": {},
  "jobType": "PEMB",
  "scope": "both",
  "roof": "screw-down",
  "install": "easy",
  "squareFootage": 1505,
  "sf": 1505,
  "useManualSquareFootage": true,
  "blendPct": 50,
  "installCostPerSf": 5.5,
  "sellPerSf": 8.5,
  "concrete": {
    "include": true,
    "thickness": 6,
    "psi": 4000,
    "costSF": 7.25,
    "marginPct": 25
  },
  "insulation": {
    "include": true,
    "system": "vinyl",
    "rRoof": "R19",
    "rWall": "R13",
    "costSF": 1.5,
    "marginPct": 30
  },
  "salesTax": { "rate": 7, "include": true },
  "cogsOverride": { "applied": false },
  "marginOverride": { "applied": false }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "weightByCategory": [],
    "pricing": {},
    "fullQuote": {
      "pricing": {},
      "concrete": { "include": true, "appliedSell": 14548, "profit": 3637 },
      "insulation": { "include": true, "appliedSell": 3225, "profit": 967 },
      "salesTax": { "rate": 7, "amount": 1771, "include": true },
      "buildingSubtotal": 34871,
      "grandTotal": 54415,
      "pricePerSf": "36.16",
      "totalProfit": 14278,
      "grandMargin": 26.2
    }
  }
}
```

---

## 7) Storage COG Extraction API

### Extract storage COG workbook
`POST /api/sales/estimates/extract-storage-cog`

Request:
```json
{
  "fileBase64": "<base64_xls>",
  "fileName": "Ben olson Quote 2.10.26 (1).xls",
  "salesTax": { "rate": 7, "include": true }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "fileName": "Ben olson Quote 2.10.26 (1).xls",
    "project": { "customer": "Ben Olson", "location": "Council Bluffs, IA" },
    "buildings": [],
    "doors": [],
    "extras": [],
    "shippingDefault": 12000,
    "format": "vendor_cog",
    "summary": { "buildingCount": 3, "totalSqft": 9000 },
    "storagePricing": {
      "grandTotal": 155826,
      "pricePerSf": "17.31",
      "profit": 45642,
      "marginPercent": 29.3
    }
  }
}
```

---

## 8) Storage Compute API

### Recompute storage quote
`POST /api/sales/estimates/compute-storage`

Request:
```json
{
  "storageData": {
    "buildings": [],
    "doors": [],
    "extras": [],
    "shipping": 12000,
    "drawings": 0,
    "installSellPerSf": 3.25,
    "installCostPerSf": 2.5
  },
  "squareFootage": 9000,
  "concrete": { "include": false },
  "insulation": { "include": false },
  "salesTax": { "rate": 7, "include": true }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "storagePricing": {
      "buildings": [],
      "doors": [],
      "extras": [],
      "totalSqft": 9000,
      "buildingSell": 107080,
      "doorSell": 900,
      "extrasSell": 0,
      "shipping": 12000,
      "drawings": 0,
      "installSell": 29250,
      "salesTax": { "rate": 7, "amount": 7496, "include": true },
      "grandTotal": 155826,
      "pricePerSf": "17.31",
      "profit": 45642,
      "marginPercent": 29.3
    }
  }
}
```

---

## 9) COGS and Margin Preview APIs

### COGS Preview
`POST /api/sales/estimates/cogs/preview`

Request:
```json
{
  "pricingResult": {},
  "cogsOverride": {
    "costDollar": 18000,
    "marginPct": 25,
    "sellDollar": null,
    "applied": false
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "preview": {
      "fromShipper": { "cost": 16983.75, "sell": 22078.88, "margin": 23.08, "sf": 1505 },
      "adjusted": { "cost": 18000, "sell": 24000, "matMargin": 25, "grandSell": 36793, "totalMargin": 28.6 }
    }
  }
}
```

### Margin Preview
`POST /api/sales/estimates/margin/preview`

Request:
```json
{
  "pricingResult": {},
  "marginOverride": {
    "laborSF": 9.5,
    "pct": 28,
    "sellFixed": null,
    "applied": false
  }
}
```

---

## 10) Tax Lookup

### Lookup tax by ZIP
`GET /api/sales/estimates/tax-lookup/:zip`  
or  
`GET /api/sales/estimates/tax-lookup?zip=51503`

Response:
```json
{
  "success": true,
  "data": {
    "zip": "51503",
    "rate": 7,
    "label": "Council Bluffs, IA",
    "source": "zip_prefix",
    "message": "Council Bluffs, IA: 7%"
  }
}
```

---

## 11) Document APIs (Quote, SOW, Contract, Drawings)

### Preview assembled HTML
`POST /api/sales/estimates/documents/preview`

Request:
```json
{
  "jobType": "PEMB",
  "leadCompanyName": "Client Name",
  "squareFootage": 1505,
  "pricingResult": {},
  "fullQuote": {},
  "drawingAttachments": [
    {
      "name": "layout-plan.pdf",
      "fileBase64": "data:application/pdf;base64,...",
      "includeInQuote": true
    }
  ],
  "sections": ["quote", "sow", "contract", "drawings"]
}
```

Response:
```json
{
  "success": true,
  "data": {
    "quoteHtml": "<div>...</div>",
    "sowHtml": "<div>...</div>",
    "contractHtml": "<div>...</div>",
    "assembledHtml": "<html>...</html>"
  }
}
```

### Generate PDF
`POST /api/sales/estimates/documents/pdf`  
or  
`POST /api/sales/estimates/:estimateId/documents/pdf`

Response:
```json
{
  "success": true,
  "data": {
    "fileName": "Client_Name-assembled.pdf",
    "mimeType": "application/pdf",
    "fileBase64": "JVBERi0xLjcK...",
    "sizeBytes": 245678
  }
}
```

---

## 12) Estimate CRUD APIs

### Create estimate
`POST /api/sales/estimates`

Request (PEMB sample):
```json
{
  "leadId": "665f...",
  "jobType": "PEMB",
  "scope": "supply",
  "roof": "screw-down",
  "install": "easy",
  "blendPct": 50,
  "leadCompanyName": "Paris TN Expansion",
  "customerEmail": "client@example.com",
  "streetAddress": "123 Main St",
  "cityStateZip": "Paris, TN",
  "buildingSize": "20x150",
  "squareFootage": 1505,
  "sourceFileName": "#6959 Paris, TN expansion (Shipper).xlsx",
  "parsedCategories": {},
  "tabSummary": [],
  "pricingResult": {},
  "fullQuoteResult": {},
  "concreteAddon": { "include": false },
  "insulationAddon": { "include": false },
  "salesTax": { "rate": 0, "include": true },
  "cogsOverride": { "applied": false },
  "marginOverride": { "applied": false },
  "drawingAttachments": [],
  "additionalInfo": "",
  "status": "draft"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "estimate": {
      "_id": "66abc...",
      "jobType": "PEMB",
      "status": "draft",
      "squareFootage": 1505,
      "grandTotal": 22079,
      "buildingSubtotal": 22079
    }
  }
}
```

### List estimates
`GET /api/sales/estimates?limit=20&page=1&jobType=PEMB&status=draft&search=paris`

Response:
```json
{
  "success": true,
  "data": {
    "estimates": [
      {
        "_id": "66abc...",
        "leadCompanyName": "Paris TN Expansion",
        "jobType": "PEMB",
        "squareFootage": 1505,
        "totalSell": 22079,
        "grandTotal": 22079,
        "buildingSubtotal": 22079,
        "drawingCount": 0,
        "status": "draft"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### Get estimate detail
`GET /api/sales/estimates/:estimateId`

### Update estimate
`PUT /api/sales/estimates/:estimateId`

### Delete estimate
`DELETE /api/sales/estimates/:estimateId`

### History summary
`GET /api/sales/estimates/history/summary`

Response:
```json
{
  "success": true,
  "data": {
    "thisMonth": { "totalQuotes": 5, "totalValue": 450000, "totalProfit": 85000, "avgMargin": 24.2 },
    "thisQuarter": {},
    "ytd": {},
    "allTime": {},
    "profitByCategory": [
      { "jobType": "PEMB", "totalProfit": 120000, "count": 8 },
      { "jobType": "Storage", "totalProfit": 95000, "count": 4 }
    ]
  }
}
```

---

## 13) Key Logic Clarifications (important for frontend)

1. **Material subtotal mismatch handling**
   - `pricing.rowSubtotalBeforeBlend` = visible row sum
   - `pricing.vendorBlendAdjustment` = blend delta (signed)
   - `pricing.matCost` = after-blend material total

2. **Markup vs margin**
   - `pembMultiplier = 1.30` means **30% markup on cost**
   - Equivalent gross margin on sell is about **23.1%**

3. **Square footage**
   - Weight formula default: `round(totalWeightLbs / 9)`
   - Cover area provided via `squareFootageMeta.coverDerivedSqft`
   - Frontend now supports explicit switch between weight SF and cover SF

4. **Drawings**
   - Use `drawingAttachments[]` for image/PDF append in output package
   - Separate from numeric storage `drawings` fee

---

## 14) Recommended Frontend Integration Checklist

- Use `accessToken` from login for all calls.
- On shipper upload: send `squareFootage: 0`, `useManualSquareFootage: false`.
- Show SF source from `squareFootageMeta` and allow switch.
- Render `pricing.rows[].rate` and `notes` as-is (formula-friendly).
- Show before-blend subtotal + blend adjustment + after-blend material total.
- Use 2 decimals for money and weight in UI.
- Use `grandTotal` for quote history/list display.
- Send `concrete/insulation` as omitted or `{ "include": false }` (not `null`).
- For storage packages, send `drawingAttachments` and include `sections: ["drawings"]`.

---

## 15) Related Files

- `src/routes/sales/estimateQuote.routes.js`
- `src/controllers/sales/estimateQuote.controller.js`
- `src/services/quoting/shipperParser.js`
- `src/services/quoting/pricingEngine.js`
- `src/services/quoting/quotePricingOrchestrator.js`
- `src/services/quoting/storagePricingEngine.js`
- `src/services/quoting/quoteDocumentGenerator.js`
- `SM-QuotingTool-API.html`
- `SM-QuotingTool-v5 (31).html`

---

## 16) Validation with all `EXCEL EXAMPLES/`

### 16.1 Local parser validation

All files in `EXCEL EXAMPLES/` were run through local `extract-shipper` logic after parser hardening.

Reference report: `docs/excel-examples-extraction-check-2026-08-28.json`

| File | Sheets | Extracted Tabs | Total Weight (lbs) | SF (weight/9) | Coverage | Notes |
|------|--------|----------------|--------------------|---------------|----------|-------|
| `#2321 Choctaw Expansion Austin Building B (Shipper).ods` | 26 | 23 | 18,343.50 | 2,038 | 100% | ODS variant parsed correctly |
| `#2321 Choctaw Expansion Austin Building E (Shipper).ods` | 29 | 26 | 72,479.80 | 8,053 | 100% | ODS multi-tab variant parsed correctly |
| `#2321 Choctaw Expansion Austin Building F (Shipper).ods` | 31 | 28 | 59,994.20 | 6,666 | 100% | Includes `TOP_CHANNEL` and table-style panel tabs |
| `1215-USB_SHIPPER (3) (1) (2).xls` | 21 | 20 | 586,580.22 | 65,176 | 100% | Legacy `.xls` with `HARDWARE` tab parsed |
| `Bldg-D SHIPPER (2) (1).xlsx` | 11 | 10 | 20,965.15 | 2,329 | 100% | `Table 1..11` naming handled by content-based fallback |
| `_$#6959 Paris, TN expansion (Shipper) (1).xlsx` | 1 | 0 | 0.00 | 0 | 100% | Excel lock/temp file, not a real quote workbook |

### What this confirms

- Mixed formats are supported: `.ods`, `.xls`, `.xlsx`.
- Non-standard sheet names are supported (`Table N`, `TOP_CHANNEL`, `HARDWARE`).
- No weighted tabs were dropped in these fixtures (`unmappedWeightLbs = 0` across valid quote files).
- Pricing logic remains unchanged; only extraction/classification robustness was improved.

### 16.2 Production (Render) validation

Production URL tested: `https://mr-storage-backend-025k.onrender.com`  
Auth: sales JWT via `POST /api/auth/login`  
Endpoints tested per file:
- `POST /api/sales/estimates/extract-shipper`
- `POST /api/sales/estimates/compute`

Reference report: `docs/production-excel-examples-test-2026-08-28.json`

| File | Extract | Compute | Total Weight (lbs) | SF | Coverage | Unmapped Tabs |
|------|---------|---------|--------------------|----|----------|---------------|
| `#2321 Choctaw Expansion Austin Building B (Shipper).ods` | 200 PASS | 200 PASS | 18,343.50 | 2,038 | 100% | none |
| `#2321 Choctaw Expansion Austin Building E (Shipper).ods` | 200 PASS | 200 PASS | 72,479.80 | 8,053 | 100% | none |
| `#2321 Choctaw Expansion Austin Building F (Shipper).ods` | 200 PASS | 200 PASS | 59,994.20 | 6,666 | 100% | none |
| `1215-USB_SHIPPER (3) (1) (2).xls` | 200 PASS | 200 PASS | 586,580.22 | 65,176 | 100% | none |
| `Bldg-D SHIPPER (2) (1).xlsx` | 200 PASS | 200 PASS | 20,965.15 | 2,329 | 100% | none |
| `_$#6959 Paris, TN expansion (Shipper) (1).xlsx` | 200 PASS | 200 PASS | 0.00 | 0 | 100% | none (temp lock file) |

Production also returns the new pricing reconciliation keys:
- `pricing.rowSubtotalBeforeBlend`
- `pricing.vendorBlendAdjustment`
- `pricing.vendorBlendSavingsExact`

