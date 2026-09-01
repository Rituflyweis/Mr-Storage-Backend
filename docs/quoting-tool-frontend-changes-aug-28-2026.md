# Quoting Tool — Frontend Integration Change List (Aug 28, 2026)

**For frontend dev handoff**  
**Production:** `https://mr-storage-backend-025k.onrender.com`  
**Branch deployed:** `shubham-changes-13-aug`  
**Latest commits:** `36e6d91` (extract-shipper 500 fix), `ce2afb3` (pricing clarity + SF meta)  
**Reference UI:** `SM-QuotingTool-API.html` (open locally or from repo — mirrors expected integration)

This doc covers **only the fixes from Aug 27–28** that frontend must wire up or display correctly. For the full August API surface, see [`quoting-tool-api-changes-aug-2026.md`](./quoting-tool-api-changes-aug-2026.md).

---

## Summary — what changed

| Area | Change | Frontend action |
|------|--------|-----------------|
| Shipper upload crash | `extract-shipper` no longer 500 when addons omitted | No request change; retry uploads without sending `concrete`/`insulation` |
| SF source | New `squareFootageMeta` on extract response | Show SF source + cover-sheet SF side-by-side |
| Pricing rows | `rate`/`notes`/`wt` fields clarified | Stop treating `"bucket"` as a rate; render formulas + notes |
| Material total | `matCost` is **after vendor blend** | Show subtotal + blend adjustment lines |
| Margin display | 30% rule = **markup**, not margin | Label as gross margin vs markup (see §5) |
| Rounding | Backend returns raw floats | Format currency to **2 decimals** in UI |
| Storage drawings | `drawingAttachments` on save/preview/PDF | Upload via file picker or drag-drop; send base64 array |
| Estimates list | `grandTotal` on list rows | Use `grandTotal` for history totals, not `totalSell` alone |

---

## 1. `POST /api/sales/estimates/extract-shipper`

### Request (unchanged shape — recommended defaults)

```json
{
  "fileBase64": "<base64>",
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
  "sellPerSf": 8.5
}
```

| Field | Notes |
|-------|-------|
| `squareFootage` / `sf` | Send **`0`** on fresh upload so backend derives SF from weight |
| `useManualSquareFootage` | Set **`true`** only when user manually locks SF in the UI |
| `concrete` / `insulation` | **Optional** — omit or send `{ "include": false }`; do not send `null` |

### Response — **NEW** `squareFootageMeta`

```json
{
  "success": true,
  "data": {
    "totalWeightLbs": 13547.18,
    "squareFootage": 1505,
    "squareFootageMeta": {
      "selected": 1505,
      "source": "weight_formula",
      "formula": "round(totalWeightLbs / 9)",
      "fromWeight": 1505,
      "coverDerivedSqft": 3000,
      "inputSf": 0
    },
    "parsedCategories": { "...": "..." },
    "pricing": { "...": "..." },
    "fullQuote": { "...": "..." }
  }
}
```

| Field | Meaning |
|-------|---------|
| `squareFootageMeta.selected` | SF used for pricing (same as `squareFootage`) |
| `squareFootageMeta.source` | `"weight_formula"` or `"manual"` |
| `squareFootageMeta.formula` | `"round(totalWeightLbs / 9)"` when auto-derived |
| `squareFootageMeta.fromWeight` | SF from weight formula |
| `squareFootageMeta.coverDerivedSqft` | SF from cover sheet width × length (reference only unless manual override) |
| `squareFootageMeta.inputSf` | SF sent in request |

**UI recommendation:**

```
SF: 1,505 (auto from weight: 13,547.18 lbs ÷ 9)
Cover sheet: 20 × 150 = 3,000 SF (reference)
```

When user edits SF field → send `useManualSquareFootage: true` and the new value on next `compute` / save.

---

## 2. `pricing.rows` — breakdown display (PEMB)

### Breaking change: `rate` no longer uses `"bucket"`

**Before:**

```json
{ "cat": "trim", "label": "Trim", "wt": 896.4, "rate": "bucket", "price": 2509.92, "notes": "" }
```

**After:**

```json
{
  "cat": "trim",
  "label": "Trim",
  "wt": 896.4,
  "rate": "max($2.80/lb, $0.65/SF)",
  "price": 2509.92,
  "notes": "Weight basis 2509.92 vs SF basis 978.25 (weight basis used)"
}
```

### Row rate strings (render as-is in Rate column)

| Category | `rate` value | How price is computed |
|----------|--------------|------------------------|
| Primary, HSS, Secondary, Opening, Angle, Plate | `$X.XX/lb` | `weight × rate` |
| Sheeting | `$X.XX/SF` or SS combo | `estSF × rate` where `estSF = round(sheetingWeight / 2.5)` |
| Trim | `max($2.80/lb, $0.65/SF)` | `max(weight×2.8, sf×0.65)` |
| Misc (cables/bracing) | `max($3.50/lb, $0.22/SF)` | `max(weight×3.5, sf×0.22)` |
| Accessories | `max($1.50/lb, $1.00/SF)` | `max(weight×1.5, sf×1.0)` |
| Fasteners | `$0.48/SF` | `sf × 0.48` (weight shown but not used for price) |

### Weight column

- **`wt` is always a number** (use `0` display for zero-weight SF-based rows, not `"—"`).
- Fasteners now includes tab weight in `wt` when present.

### Material total reconciliation (required for user trust)

Do **not** compare sum of row `price` directly to `pricing.matCost` without showing blend:

```javascript
const rowSubtotal = pricing.rows.reduce((s, r) => s + r.price, 0);
const blendAdjustment = rowSubtotal - pricing.matCost; // negative = savings
```

**Display three lines:**

1. **Category subtotal (before blend):** `rowSubtotal` → e.g. `$15,899.98`
2. **Vendor blend adjustment:** `-blendAdjustment` → e.g. `-$677.36` (label: `pricing.blendLabel`, e.g. `"50% Quicken blend"`)
3. **Material total (after blend):** `pricing.matCost` → e.g. `$15,222.62`

Then add freight, install, sell as today.

---

## 3. `POST /api/sales/estimates/compute`

Same `pricing.rows` shape as extract-shipper. No new request fields.

When user changes SF manually:

```json
{
  "parsedCategories": { "...from extract..." },
  "squareFootage": 3000,
  "sf": 3000,
  "useManualSquareFootage": true,
  "scope": "supply",
  "install": "easy",
  "blendPct": 50
}
```

Response `pricing.sf` reflects the sent SF.

---

## 4. Formatting rules (frontend)

| Value | Display |
|-------|---------|
| Currency (`matCost`, `totSell`, row `price`, etc.) | **2 decimals** — e.g. `$15,222.62` |
| Weight (`wt`, `totalWeightLbs`) | **2 decimals** — e.g. `13,547.18 lbs` |
| Percentages | **1 decimal** — e.g. `23.1%` |
| `sfPrice` | **2 decimals** — e.g. `$14.67/SF` |

Backend returns full-precision floats; rounding is a **UI concern**.

---

## 5. Margin vs markup (PEMB + Storage)

Pricing rules **PEMB material multiplier** (`pembMu`, typically **1.3**) means:

- **Markup on cost** = `(mu - 1) × 100` → **30% markup**
- **Gross margin on sell** = `(sell - cost) / sell × 100` → **~23.1%** for supply-only PEMB

Example (Paris shipper, supply scope):

| Metric | Value |
|--------|-------|
| Material cost (after blend) + freight | $16,983.75 |
| Material sell (`matSell`) | $22,078.88 |
| Markup on cost | **30.0%** |
| Gross margin on sell | **23.1%** |

**Frontend labels:**

- COGS panel “Computed margin” → prefer **“Gross margin”**
- Optionally show both: `23.1% margin (30.0% markup on cost)`

Storage COG uses building **markup %** per row (default 25%) — that is markup on COGS, not margin on sell. Same distinction applies.

---

## 6. Storage drawings (`drawingAttachments`)

Separate from the numeric **Engineering Drawings $** fee field.

### On save / preview / PDF

```json
{
  "drawingAttachments": [
    {
      "name": "layout-plan.pdf",
      "fileBase64": "<base64 or data URL>",
      "includeInQuote": true
    }
  ],
  "sections": ["quote", "sow", "contract", "drawings"]
}
```

| Field | Notes |
|-------|-------|
| `drawingAttachments[].name` | Filename for PDF appendix |
| `drawingAttachments[].fileBase64` | Image or PDF; data-URL prefix OK |
| `drawingAttachments[].includeInQuote` | `false` to exclude from package |
| `sections` | Include `"drawings"` to append checked files to PDF |

Reference implementation: Storage **Drawings** tab in `SM-QuotingTool-API.html` (`storageDrawingAttachmentsForApi()`).

---

## 7. `GET /api/sales/estimates` (list)

Use **`grandTotal`** for history/list cards (includes addons/tax when saved):

```json
{
  "success": true,
  "data": {
    "estimates": [
      {
        "_id": "...",
        "leadCompanyName": "...",
        "grandTotal": 22079,
        "buildingSubtotal": 22079,
        "totalSell": 22079,
        "squareFootage": 1505
      }
    ]
  }
}
```

Full detail (`GET /estimates/:id`) still returns `parsedCategories`, `pricingResult`, `drawingAttachments`, etc.

---

## 8. Production smoke test (Paris shipper file)

Verified on Render after `ce2afb3`:

```bash
# Login
POST /api/auth/login
{ "email": "sales1@example.com", "password": "sales@1234" }

# Extract
POST /api/sales/estimates/extract-shipper
Authorization: Bearer <accessToken>
```

Expected for `#6959 Paris, TN expansion (Shipper).xlsx`:

| Check | Expected |
|-------|----------|
| HTTP status | 200 |
| `squareFootage` | 1505 |
| `squareFootageMeta.coverDerivedSqft` | 3000 |
| Row subtotal (sum of `pricing.rows[].price`) | ~15899.98 |
| `pricing.matCost` (after blend) | ~15222.62 |
| `pricing.totSell` (supply) | ~22078.88 |
| Trim row `rate` | `max($2.80/lb, $0.65/SF)` |
| No `"bucket"` in any row `rate` | true |

---

## 9. Frontend checklist

- [ ] On shipper upload, send `squareFootage: 0` and `useManualSquareFootage: false`
- [ ] Read and display `squareFootageMeta` (weight SF vs cover SF)
- [ ] Render `pricing.rows[].rate` and `notes` literally; remove hard-coded `"bucket"` handling
- [ ] Show **subtotal → blend adjustment → material total** before freight/sell
- [ ] Format money/weight to 2 decimals
- [ ] Label margin as gross margin; show markup separately where COGS panel is used
- [ ] Storage: wire `drawingAttachments` + `sections: ["drawings"]` for PDF package
- [ ] Estimates list: display `grandTotal`
- [ ] Do not send `concrete: null` or `insulation: null` — omit or use `{ include: false }`

---

## Related docs

- Full August endpoint list: [`quoting-tool-api-changes-aug-2026.md`](./quoting-tool-api-changes-aug-2026.md)
- End-to-end flow: [`quoting-tool-frontend-integration-flow.md`](./quoting-tool-frontend-integration-flow.md)
- Complete API reference: [`ai-quoting-tool-api.md`](./ai-quoting-tool-api.md)
