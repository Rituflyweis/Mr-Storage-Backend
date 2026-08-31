# Quoting Tool — Changes Summary (Shipper Parity Fix)

**Date:** August 2026  
**Deploy commit:** `597402e` on branch `shubham-changes-13-aug`  
**Production:** `https://mr-storage-backend-025k.onrender.com`

This document lists **only the changes made** to fix the mismatch between `SM-QuotingTool-v5 (31).html` and `SM-QuotingTool-API.html` / backend when uploading the same shipper file.

---

## Problem

Uploading `shipper_excel_quote_example.xlsx` to both tools produced different results.

| | Broken (API / old v5) | Correct (v5 with fixes) |
|---|---|---|
| SF | 1,081 | **1,505** |
| Parsed weight | 9,508 lbs | **13,547 lbs** |
| Missing categories | Rigid Frames, Angles, Trim | All 10 rows present |
| Material cost | ~$8,405 | **~$15,234** |

### Root causes

1. **Tab name matching** — Shipper tabs are named with numeric prefixes (`1. STUDS & TOP CHANNELS`, `6. ANGLES`, `7. TRIM`). v5's `getTabCat()` did not strip the prefix, so those tabs were skipped or miscategorized.

2. **Stale square footage** — API HTML sent a previously entered SF (e.g. 1,081) on shipper upload. Backend preferred client SF over weight-derived SF.

3. **Wrong pricing rule defaults** — `PricingRules` model had incorrect defaults for sheeting (`1.71` instead of `1.30`) and freight (`1.71` instead of `0.13`), affecting users with saved rules documents.

---

## Changes made

### 1. `SM-QuotingTool-v5 (31).html`

**File:** `getTabCat()` and `getCustomTabRule()`

- Added `normalizeTabName()` — strips leading `1. ` from tab names before matching.
- Extended primary matching: `stud`, `top channel`, `header`.
- Extended secondary matching: `(eave && !trim)`.
- Extended opening matching: `header`.

**Why:** v5 now parses numbered Xshipper tabs correctly without relying on localStorage custom rules.

---

### 2. `src/services/quoting/shipperParser.js`

Already had `normalizeTabName()` and correct tab mapping (this was the backend reference implementation). No logic change required in this session — confirmed parity with fixed v5.

**Tab → category map (unchanged, documented for reference):**

| Pattern | Category |
|---------|----------|
| stud, top channel, column, rafter | `primary` |
| jamb, header, opening | `opening` |
| purlin, girt, eave strut | `secondary` |
| sheeting | `sheeting` |
| angle | `angle` |
| plate, connection | `plate` |
| trim | `trim` |
| bracing, cable, sealant | `misc` |
| accessor | `accessories` |
| fastener | `fasteners` |

---

### 3. `src/controllers/sales/estimateQuote.controller.js`

**Endpoint:** `POST /api/sales/estimates/extract-shipper`

**Before:**
```javascript
const sf = options.sf || (parsed.totalWeightLbs > 0 ? Math.round(parsed.totalWeightLbs / 9) : 0)
```

**After:**
```javascript
const autoSf = parsed.totalWeightLbs > 0 ? Math.round(parsed.totalWeightLbs / 9) : 0
const sf =
  req.body.useManualSquareFootage && options.sf > 0
    ? options.sf
    : autoSf || options.sf || 0
```

**Why:** Fresh shipper uploads always derive SF from weight unless the client explicitly locks manual SF.

**New request field:**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `useManualSquareFootage` | boolean | `false` | Set `true` on `/compute` when user manually edited SF |

---

### 4. `SM-QuotingTool-API.html`

**Shipper upload (`uploadShipper`):**
- Resets `state.squareFootage = 0` and `state.manualSquareFootage = false` before upload.
- Sends explicit job options (does not spread stale `computeBody()` including old SF).
- Sends `squareFootage: 0`, `sf: 0` on upload.

**Manual SF edit:**
- Sets `state.manualSquareFootage = true` when user edits `#live-sf`.
- Passes `useManualSquareFootage` in `computeBody()` for `/compute`.

**Breakdown table (`renderBreakdown`):**
- Added header: "Weight + Price by Category" + file/SF/weight subtitle.
- Added "Edit pricing rules" button.
- Added footer rows matching v5: Material total, Freight, Install cost, Total cost, Install sell, **SELL PRICE**.

---

### 5. `src/models/PricingRules.js`

Fixed incorrect schema defaults:

| Field | Before | After |
|-------|--------|-------|
| `sheetingRatesPerSf.standardScrewDown` | 1.71 | **1.30** |
| `sheetingRatesPerSf.standingSeam` | 1.04 | **1.70** |
| `freight.ratePerLb` | 1.71 | **0.13** |
| `steelRatesPerLb.hssBeams` | 0.88 | **2.05** |

---

### 6. `src/services/quoting/pricingRulesAdapter.js`

Added runtime repair for existing MongoDB documents with bad saved values:

```javascript
if (pr.sheet > 2) pr.sheet = DEFAULT_PR.sheet
if (pr.ss > 3) pr.ss = DEFAULT_PR.ss
if (pr.freight > 1) pr.freight = DEFAULT_PR.freight
```

**Why:** Users who already had pricing rules documents created with the wrong defaults get corrected rates at compute time without a manual DB migration.

---

## Verified result (`shipper_excel_quote_example.xlsx`)

Both v5 and API HTML now produce the same output with default settings (PEMB · both · medium · install 5.50/8.50 · 50% blend · SF auto):

| Metric | Value |
|--------|-------|
| Parsed total weight | 13,547 lbs |
| Priced weight (totWt) | 13,326 lbs |
| Square footage | 1,505 |
| Pricing rows | 10 |
| Material cost | $15,234 |
| Freight | $1,732 |
| Install cost / sell | $8,278 / $12,793 |
| **SELL PRICE** | **$34,848** ($23.16/SF) |
| Profit | $9,605 (27.6%) |

**Categories in breakdown:**
1. Rigid Frames & Endwalls  
2. Purlins, Girts & Eave Struts  
3. Door Jambs & Headers  
4. Roof & Wall Sheeting  
5. Angles  
6. Connection Plates & Clips  
7. Trim  
8. Cables, Bracing & Sealant  
9. Accessories  
10. Fasteners  

---

## Deploy

```text
Commit: 597402e
Branch: shubham-changes-13-aug
Pushed: origin/shubham-changes-13-aug
Render: mr-storage-backend-025k.onrender.com (auto-deploy)
```

**Files in deploy commit:**
- `src/controllers/sales/estimateQuote.controller.js`
- `src/models/PricingRules.js`
- `src/services/quoting/pricingEngine.js`
- `src/services/quoting/pricingRulesAdapter.js`
- `src/services/quoting/shipperParser.js`
- `SM-QuotingTool-API.html`
- `SM-QuotingTool-v5 (31).html`

---

## Frontend integration checklist

After these changes, client apps should:

1. Send `squareFootage: 0` and `useManualSquareFootage: false` on **shipper upload**.
2. Use returned `data.squareFootage` to update the SF field.
3. Send `useManualSquareFootage: true` on **`/compute`** only after the user manually edits SF.
4. Persist `parsedCategories` + `pricing` from extract response for re-compute.
5. Hard-refresh cached HTML files if testing locally.

---

## Test

```bash
node scripts/test-quoting-tool.js
```

Or hit production:

```http
POST /api/sales/estimates/extract-shipper
Authorization: Bearer <accessToken>

{
  "fileBase64": "<shipper_excel_quote_example.xlsx>",
  "fileName": "shipper_excel_quote_example.xlsx",
  "jobType": "PEMB",
  "scope": "both",
  "squareFootage": 0,
  "useManualSquareFootage": false
}
```

Expected: `totalWeightLbs: 13547.18`, `squareFootage: 1505`, 10 rows including Rigid Frames & Angles.

---

## Related docs

- Full API reference (updated): [`ai-quoting-tool-api.md`](./ai-quoting-tool-api.md)
- React integration flow (updated): [`quoting-tool-frontend-integration-flow.md`](./quoting-tool-frontend-integration-flow.md)
