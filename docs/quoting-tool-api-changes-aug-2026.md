# Quoting Tool API — Changed Endpoints Only

**For frontend dev handoff** · August 2026  
**Production:** `https://mr-storage-backend-025k.onrender.com`  
**Reference UI:** `SM-QuotingTool-API.html` (open in browser, paste JWT from login)  
**Full API reference:** [`ai-quoting-tool-api.md`](./ai-quoting-tool-api.md)

Only endpoints whose **request and/or response payloads changed** are listed below. Unlisted endpoints are unchanged.

---

## Defaults aligned with v5 (important)

| Setting | Old API HTML default | Current (v5 + API HTML) |
|---------|----------------------|---------------------------|
| PEMB `scope` | `both` | **`supply`** |
| PEMB `install` | `medium` | **`easy`** |
| Shipper SF on upload | sometimes stale client SF | **`squareFootage: 0`** + **`useManualSquareFootage: false`** |
| Storage markup (vendor COG) | 14% from vendor sheet | **25%** (v5 behavior) |
| Storage shipping (vendor COG) | vendor $14k row | **$12,000** default (v5 row-12 fallback) |
| Storage install sell / cost | — | **$3.25 / $2.50** per SF |

---

## 1. `POST /api/sales/estimates/extract-shipper`

**What changed:** SF derivation on fresh upload; tab parsing parity (numbered tabs → correct categories).

### Request — added / behavior change

```json
{
  "fileBase64": "<base64>",
  "fileName": "shipper_excel_quote_example.xlsx",
  "jobType": "PEMB",
  "scope": "supply",
  "roof": "screw-down",
  "install": "easy",
  "squareFootage": 0,
  "sf": 0,
  "useManualSquareFootage": false,
  "blendPct": 50,
  "installCostPerSf": 5.5,
  "sellPerSf": 8.5
}
```

| Field | Change |
|-------|--------|
| `useManualSquareFootage` | **New.** `false` on upload → backend derives SF from weight ÷ 9 |
| `squareFootage` / `sf` | Send **`0`** on upload so stale SF is not reused |

### Response — changed values (example: `shipper_excel_quote_example.xlsx`, supply/easy)

```json
{
  "success": true,
  "data": {
    "totalWeightLbs": 13547.18,
    "squareFootage": 1505,
    "sheetCount": 10,
    "parsedCategories": {
      "primary": { "weight": 2168.5 },
      "opening": { "weight": 1650.3 },
      "secondary": { "weight": 949.5 },
      "sheeting": { "weight": 6240.5 },
      "angle": { "weight": 753.1 },
      "trim": { "weight": 896.4 }
    },
    "pricing": {
      "matCost": 15233.7,
      "freight": 1732.33,
      "matSell": 19820.84,
      "instSell": 0,
      "totSell": 22056,
      "sf": 1505,
      "sfPrice": "14.65",
      "profPct": "23.1"
    }
  }
}
```

**Before (broken):** ~9,729 lbs · ~1,081 SF · missing primary/angle/trim · ~$9,641 COGS.  
**After:** 13,547 lbs · 1,505 SF · all categories · mat COGS ~$16,966 · supply sell **$22,056**.

---

## 2. `POST /api/sales/estimates/compute`

**What changed:** COGS/margin overrides apply when `applied: true`; SF manual lock; `fullQuote` bundle when addons/overrides active.

### Request — COGS override (apply to quote)

```json
{
  "parsedCategories": { "...from extract-shipper..." },
  "jobType": "PEMB",
  "scope": "supply",
  "squareFootage": 1505,
  "useManualSquareFootage": true,
  "blendPct": 50,
  "roof": "screw-down",
  "install": "easy",
  "installCostPerSf": 5.5,
  "sellPerSf": 8.5,
  "cogsOverride": {
    "applied": true,
    "costDollar": 18663,
    "marginPct": 25,
    "sellDollar": null,
    "costPctAdj": 10
  },
  "marginOverride": { "applied": false },
  "concrete": { "include": false },
  "insulation": { "include": false },
  "salesTax": { "rate": 0, "include": true }
}
```

| Field | Change |
|-------|--------|
| `cogsOverride.applied` | **`true`** → adjusted `matCost`/`matSell`/`totSell`/`profit`/`profPct` in `pricing` |
| `useManualSquareFootage` | **`true`** after user edits SF field |
| `marginOverride.applied` | **`true`** + `laborSF` / `pct` / `sellFixed` locks sell |

### Response — when `cogsOverride.applied: true`

```json
{
  "success": true,
  "data": {
    "pricing": {
      "matCost": 16931,
      "freight": 1732,
      "matSell": 22152,
      "totSell": 24884,
      "totCost": 18663,
      "profit": 6221,
      "profPct": "25.0",
      "sfPrice": "16.53",
      "cogsOverrideApplied": true
    },
    "fullQuote": {
      "grandTotal": 24884,
      "pricePerSf": "16.53",
      "grandMargin": 25.0
    }
  }
}
```

---

## 3. `POST /api/sales/estimates/cogs/preview`

**What changed:** Documented for frontend; preview only (no persist). Same math as v5 COGS tab.

### Request

```json
{
  "pricingResult": { "...from compute or extract-shipper..." },
  "cogsOverride": {
    "costDollar": 18663,
    "marginPct": 25,
    "sellDollar": null,
    "applied": false
  }
}
```

### Response

```json
{
  "success": true,
  "data": {
    "preview": {
      "fromShipper": {
        "cost": 16966,
        "sell": 22056,
        "margin": 23.1,
        "sf": 1505
      },
      "adjusted": {
        "cost": 18663,
        "sell": 24884,
        "matMargin": 25.0,
        "grandSell": 24884,
        "grandCost": 18663,
        "profit": 6221,
        "totalMargin": 25.0,
        "sfPrice": "16.53",
        "costDiff": 1697,
        "sellDiff": 2828
      }
    }
  }
}
```

Apply via `/compute` with `"cogsOverride": { "applied": true, ... }`.

---

## 4. `POST /api/sales/estimates/extract-storage-cog`

**What changed:** Vendor COG Excel support (Ben Olson format); v5 pricing rules (25% markup, no vendor column extras).

### Request

```json
{
  "fileBase64": "<base64>",
  "fileName": "Ben olson Quote 2.10.26 (1).xls",
  "installSellPerSf": 3.25,
  "installCostPerSf": 2.5,
  "salesTax": { "rate": 0, "include": true }
}
```

| Field | Change |
|-------|--------|
| `installSellPerSf` | Optional; default **3.25** (v5 storage page) |
| `installCostPerSf` | Optional; default **2.5** |

### Response — vendor COG example

```json
{
  "success": true,
  "data": {
    "format": "vendor_cog",
    "vendorMeta": {
      "markupPct": 14,
      "shipping": 14000,
      "totalCogs": 149314.05,
      "totalEstimate": 170218.017,
      "isVendorFormat": true
    },
    "globalMarkupPct": 25,
    "shippingDefault": 12000,
    "project": { "customer": "ASHER CONSTURCTION,LLC" },
    "buildings": [
      { "name": "A", "sqft": 9000, "cogs": 85664.05, "markup": 25 }
    ],
    "doors": [],
    "extras": [],
    "summary": {
      "buildingCount": 1,
      "totalSqft": 9000,
      "buildingSell": 107080,
      "doorSell": 0,
      "subtotalSell": 107080,
      "sheetTotalEstimate": 170218.017
    },
    "storagePricing": {
      "grandTotal": 148330,
      "buildingSell": 107080,
      "buildingCogs": 85664,
      "installSell": 29250,
      "shipping": 12000,
      "profit": 21416,
      "marginPercent": "14.4"
    }
  }
}
```

**Note:** `vendorMeta.totalEstimate` (~$170k) is **informational only**. Quoted total uses v5 rules → **`grandTotal: 148330`**.

---

## 5. `POST /api/sales/estimates/compute-storage`

**What changed:** Accepts parsed vendor COG data; returns full `storagePricing` breakdown.

### Request

```json
{
  "storageData": {
    "buildings": [{ "name": "A", "sqft": 9000, "cogs": 85664, "markup": 25 }],
    "doors": [],
    "extras": [],
    "shipping": 12000,
    "drawings": 0,
    "installSellPerSf": 3.25,
    "installCostPerSf": 2.5
  },
  "concrete": { "include": false },
  "insulation": { "include": false },
  "salesTax": { "rate": 0, "include": true }
}
```

### Response

```json
{
  "success": true,
  "data": {
    "storagePricing": {
      "grandTotal": 148330,
      "buildingSell": 107080,
      "buildingCogs": 85664,
      "doorSell": 0,
      "installSell": 29250,
      "installCost": 22500,
      "shipping": 12000,
      "totalSqft": 9000,
      "profit": 21416,
      "marginPercent": "14.4"
    }
  }
}
```

---

## 6. `POST /api/sales/estimates/documents/preview`

**What changed:** Response now includes **`contractHtml`**; Storage quotes require **`storagePricingResult`**.

### Request — PEMB

```json
{
  "leadCompanyName": "ABC Storage",
  "squareFootage": 1505,
  "buildingSize": "60x120x16",
  "pricingResult": { "...from compute..." },
  "fullQuoteResult": { "...optional..." },
  "additionalInfo": "Optional paragraph on quote",
  "sections": ["quote", "sow", "contract"]
}
```

### Request — Storage (required for non-zero PDF)

```json
{
  "leadCompanyName": "ASHER CONSTURCTION,LLC",
  "jobType": "Storage",
  "storageData": { "buildings": [{ "name": "A", "sqft": 9000, "cogs": 85664, "markup": 25 }] },
  "storagePricingResult": { "...from extract-storage-cog or compute-storage..." },
  "sections": ["quote", "sow", "contract"]
}
```

| Field | Change |
|-------|--------|
| `storagePricingResult` | **Required** for Storage PDF/preview (fixes $0 totals bug) |
| `additionalInfo` | Optional quote footer text |

### Response — **new field**

```json
{
  "success": true,
  "data": {
    "quoteHtml": "<div>...</div>",
    "sowHtml": "<div>...</div>",
    "contractHtml": "<div id=\"contract-printable\">...</div>",
    "assembledHtml": "<div>...</div>"
  }
}
```

| Field | Change |
|-------|--------|
| `contractHtml` | **New.** Separate contract HTML (was only inside `assembledHtml` before) |

---

## 7. `POST /api/sales/estimates/documents/pdf`

**What changed:** Storage quotes must include `storagePricingResult` (same as preview).

### Request — Storage

```json
{
  "leadCompanyName": "ASHER CONSTURCTION,LLC",
  "jobType": "Storage",
  "storageData": { "buildings": [{ "name": "A", "sqft": 9000, "cogs": 85664, "markup": 25 }] },
  "storagePricingResult": {
    "grandTotal": 148330,
    "buildingSell": 107080,
    "installSell": 29250,
    "shipping": 12000
  },
  "sections": ["quote", "sow", "contract"]
}
```

### Response (unchanged shape)

```json
{
  "success": true,
  "data": {
    "fileName": "ASHER_CONSTURCTION_LLC-assembled.pdf",
    "mimeType": "application/pdf",
    "fileBase64": "JVBERi0x...",
    "sizeBytes": 84210
  }
}
```

**Before:** Storage PDF showed **$0** when only `storageData` was sent.  
**After:** Send **`storagePricingResult`** → correct **$148,330** total.

---

## 8. `POST /api/sales/estimates` and `PUT /api/sales/estimates/:id`

**What changed:** Persist COGS/margin/additional info for reload.

### Request — added fields

```json
{
  "jobType": "PEMB",
  "scope": "supply",
  "additionalInfo": "Customer-specific notes",
  "cogsOverride": {
    "applied": true,
    "costDollar": 18663,
    "marginPct": 25,
    "sellDollar": null,
    "costPctAdj": 10
  },
  "marginOverride": { "applied": false },
  "storagePricingResult": { "...for Storage jobType..." }
}
```

### Response — `GET /estimates/:id` returns same fields on reload

---

## 9. `POST /api/sales/estimates/extract-drawing`

**No request shape change.** Response includes **`frame`** (building frame type) alongside panel fields.

### Response — building type & panels (example)

```json
{
  "success": true,
  "data": {
    "filledCount": 37,
    "textItemCount": 2,
    "extracted": {
      "width": "90'",
      "length": "225'",
      "sqft": "20250",
      "wind": "110 mph",
      "code": "IBC 18",
      "frame": "Rigid Frame",
      "roofpanel": "26 Ga. RL - Galvalume Plus 25-yr",
      "wall": "Need SMP Lifetime Color",
      "notes": "Mapped Spectral Response Acc shown..."
    }
  }
}
```

| `extracted` key | UI field (v5 / API HTML) | Notes |
|-----------------|--------------------------|-------|
| `frame` | Frame Type (`ex-frame`) | Clear Span, Rigid Frame, Multi-Span, etc. |
| `roofpanel` | Roof Panel / Color | |
| `wall` | Wall Panel | |
| `notes` | Additional Notes | |

Persist on save as **`extractedDrawingFields.frame`** (maps to SOW `frameType` in v5).

---

## 10. `GET /api/sales/estimates` (list / history)

**What changed:** Each estimate now includes **`grandTotal`** — the full quote total the customer sees (building + concrete + insulation + tax). Use this on the history page instead of **`totalSell`**.

### Response — per estimate row

```json
{
  "success": true,
  "data": {
    "estimates": [
      {
        "_id": "...",
        "leadCompanyName": "ABC Storage",
        "jobType": "PEMB",
        "status": "draft",
        "totalSell": 51693,
        "grandTotal": 51693,
        "buildingSubtotal": 34848,
        "profit": 12000,
        "marginPercent": 23.2
      }
    ],
    "total": 12,
    "page": 1,
    "limit": 40
  }
}
```

| Field | Meaning | Use on history UI |
|-------|---------|-------------------|
| **`grandTotal`** | Full quote total incl. concrete, insulation, tax | **Display this** |
| `buildingSubtotal` | Material + install (PEMB) or storage subtotal before tax | Optional subtitle |
| `totalSell` | Same as `grandTotal` after save (legacy field) | Prefer `grandTotal` |

**Before:** `totalSell` could equal `pricingResult.totSell` only (~$22k supply) while the quote PDF showed ~$51k with concrete + tax.  
**After:** `grandTotal` is computed from `fullQuoteResult.grandTotal` or `storagePricingResult.grandTotal`, including all components.

`GET /api/sales/estimates/history/summary` **`totalValue`** also uses `grandTotal` now.

---

```bash
# Parity check (shipper + Ben Olson + PDF)
node scripts/compare-v5-api-all-fixtures.js
```

---

## Frontend checklist

- [ ] Default PEMB scope **`supply`**, install **`easy`**
- [ ] On shipper upload: `squareFootage: 0`, `useManualSquareFootage: false`
- [ ] On SF edit: `/compute` with `useManualSquareFootage: true`
- [ ] COGS apply: `/compute` with `cogsOverride.applied: true`
- [ ] Storage PDF/preview: always send **`storagePricingResult`**
- [ ] Use **`contractHtml`** from preview for Contract tab
- [ ] Open **`SM-QuotingTool-API.html`** against production URL as living reference
