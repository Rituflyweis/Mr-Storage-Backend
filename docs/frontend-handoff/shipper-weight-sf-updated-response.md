# Extract-shipper — updated weight / SF response (FE)

**Endpoint:** `POST /api/sales/estimates/extract-shipper`  
**Auth:** `Authorization: Bearer <sales JWT>`  
**Base:** `https://mr-storage-backend-025k.onrender.com`

---

## Request (fresh upload)

```json
{
  "fileBase64": "<shipper xlsx>",
  "fileName": "#6959 Paris, TN expansion (Shipper).xlsx",
  "sf": 0,
  "squareFootage": 0,
  "useManualSquareFootage": false
}
```

Do **not** send a previous locked SF (e.g. `1458`) unless the user manually edited SF.

---

## What changed

| Field | Before (bug) | After (fix) |
|-------|----------------|---------------|
| `totalWeightLbs` | `13122.98` | **`13547.18`** |
| `detectedWeightLbs` | `13122.98` | **`13547.18`** |
| `squareFootage` | `1458` | **`1505`** |
| `squareFootageMeta.fromWeight` | `1458` | **`1505`** |

**Cause:** Mullion (**424.2 lbs**) was in `customItems` and excluded from weight totals.  
**Formula:** `round(detectedWeightLbs / 9)` → `round(13547.18 / 9) = 1505`.

Cover sheet SF is still **3000** (`20 × 150`) — mismatch banner unchanged.

---

## Updated response snippet (Paris TN)

```json
{
  "success": true,
  "data": {
    "totalWeightLbs": 13547.18,
    "detectedWeightLbs": 13547.18,
    "categoryWeightLbs": 13122.98,
    "customItemsWeightLbs": 424.2,
    "unmappedWeightLbs": 0,
    "squareFootage": 1505,
    "squareFootageMeta": {
      "selected": 1505,
      "source": "weight_formula",
      "formula": "round(detectedWeightLbs / 9)",
      "weightLbsUsed": 13547.18,
      "mappedWeightLbs": 13547.18,
      "categoryWeightLbs": 13122.98,
      "customItemsWeightLbs": 424.2,
      "fromWeight": 1505,
      "coverDerivedSqft": 3000,
      "inputSf": 0
    }
  }
}
```

---

## FE bind

| UI | Field |
|----|--------|
| Shipper Weight card | `data.detectedWeightLbs` |
| $/SF · weight SF | `data.squareFootage` or `squareFootageMeta.fromWeight` |
| Subtitle lbs ÷ 9 | `squareFootageMeta.weightLbsUsed` |
| Cover SF (mismatch) | `squareFootageMeta.coverDerivedSqft` |

Do **not** recompute SF in the browser as `sum(category weights) / 9`.

---

## Checklist

- [ ] Re-upload after deploy with `sf: 0`
- [ ] Expect **13547.18 lbs** and **1505 SF** for Paris TN
- [ ] For building SF **3000**, user clicks **Use Cover SF**
