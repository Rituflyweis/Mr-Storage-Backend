# Shipper Weight → SF (1,458 vs ~1,481) — FE handoff

**Date:** 29 Oct 2026  
**Backend status:** Fixed & deployed (`41ac249` on `shubham-changes-13-aug`)  
**Issue:** Shipper Weight shows **13,325.61 lbs** but SF / mismatch UI shows **1,458** instead of **~1,481** (`13,325.61 ÷ 9`).

---

## Root cause

| Piece | Wrong | Correct |
|-------|--------|---------|
| SF math | Mapped category weight only (~13,122 lbs) ÷ 9 → **1,458** | Full shipper weight `detectedWeightLbs` (mapped + unmapped) ÷ 9 → **~1,481** |
| Subtitle label | `(from weight: 1,458.00 / 9)` i.e. **SF ÷ 9** | `(from weight: 13,325.61 lbs ÷ 9)` i.e. **lbs ÷ 9** |

Backend extract now uses full weight. If the UI still shows 1,458 after a **fresh re-upload**, FE is ignoring the new fields or locking an old SF.

---

## API (extract shipper)

Same endpoint as today (PEMB shipper extract / parse). Relevant response fields:

```json
{
  "success": true,
  "data": {
    "totalWeightLbs": 13122.0,
    "detectedWeightLbs": 13325.61,
    "unmappedWeightLbs": 203.61,
    "squareFootage": 1481,
    "squareFootageMeta": {
      "selected": 1481,
      "source": "weight_formula",
      "formula": "round(detectedWeightLbs / 9)",
      "weightLbsUsed": 13325.61,
      "mappedWeightLbs": 13122.0,
      "fromWeight": 1481,
      "coverDerivedSqft": 3000,
      "inputSf": 0
    }
  }
}
```

| Field | Use for |
|-------|---------|
| `detectedWeightLbs` | **Shipper Weight** card (same as today if already wired) |
| `squareFootage` | SF used for pricing after extract |
| `squareFootageMeta.fromWeight` | Auto SF from weight (`round(weight ÷ 9)`) |
| `squareFootageMeta.weightLbsUsed` | Lbs in the ÷9 formula — **use this in the subtitle** |
| `squareFootageMeta.mappedWeightLbs` | Mapped-only weight (debug / coverage; **not** for SF label) |
| `squareFootageMeta.coverDerivedSqft` | Cover sheet SF for mismatch banner |
| `squareFootageMeta.source` | `"weight_formula"` \| `"manual"` |

Formula: **`squareFootageMeta.fromWeight = round(detectedWeightLbs / 9)`**  
Example: `round(13325.61 / 9) = 1481`.

---

## Required FE changes

### 1. Fresh upload request

On **new shipper upload / re-extract**:

```json
{
  "squareFootage": 0,
  "sf": 0,
  "useManualSquareFootage": false
}
```

Do **not** send a previous `1458` (or any cached SF) unless the user explicitly edited SF.

### 2. After extract — bind UI from response

| UI | Bind to |
|----|---------|
| Shipper Weight card | `data.detectedWeightLbs` |
| $/SF card SF | `data.squareFootage` (or `squareFootageMeta.selected`) |
| Weight SF in mismatch banner | `data.squareFootageMeta.fromWeight` |
| Cover SF in mismatch banner | `data.squareFootageMeta.coverDerivedSqft` |
| Category subtitle | see §3 |

Do **not** recompute SF in the browser as `sum(category.weights) / 9`.

### 3. Fix the subtitle label (bug in screenshot)

**Wrong (current):**

```text
1,458.00 SF (from weight: 1,458.00 / 9) · cover sheet SF: 3,000.00 · 13,325.61 lbs
```

**Correct:**

```text
1,481.00 SF (from weight: 13,325.61 lbs ÷ 9) · cover sheet SF: 3,000.00 · 13,325.61 lbs
```

Template:

```text
{fromWeight} SF (from weight: {weightLbsUsed} lbs ÷ 9) · cover sheet SF: {coverDerivedSqft} · {detectedWeightLbs} lbs
```

Use `squareFootageMeta.weightLbsUsed` (or `detectedWeightLbs`), **never** put SF in the “÷ 9” slot.

### 4. Mismatch banner

```text
SF Mismatch Detected: Weight formula gives {fromWeight} SF while cover sheet gives {coverDerivedSqft} SF …
```

Buttons unchanged (`Use Weight SF` / `Use Cover SF` / `Keep Current`).

- **Use Weight SF** → set SF = `fromWeight`, `useManualSquareFootage: false` (or true only if product wants lock).
- **Use Cover SF** → set SF = `coverDerivedSqft`, `useManualSquareFootage: true`.
- **Keep Current** → keep `squareFootageMeta.selected`.

### 5. Manual SF edit

When user types SF in the field:

```json
{
  "sf": 1500,
  "squareFootage": 1500,
  "useManualSquareFootage": true
}
```

Then `squareFootageMeta.source` becomes `"manual"` on the next compute.

### 6. Re-test this file

1. Hard refresh / new session after deploy.  
2. Re-upload `#6959 Paris, TN expansion (Shipper) (1).xlsx`.  
3. Expect:
   - Shipper Weight ≈ **13,325.61 lbs**
   - Weight SF ≈ **1,481**
   - Subtitle shows **lbs ÷ 9**, not `1458 / 9`
4. If Network tab still returns `fromWeight: 1458`, share that JSON — backend issue.  
   If Network returns `1481` but UI shows `1458` — FE still overriding.

---

## Checklist

- [ ] Fresh extract sends `sf: 0` / no manual lock  
- [ ] SF card uses `data.squareFootage` / `fromWeight` (~1481)  
- [ ] Subtitle uses `weightLbsUsed` lbs ÷ 9 (not SF ÷ 9)  
- [ ] No client-side `mappedWeight / 9` for pricing SF  
- [ ] Manual edit sets `useManualSquareFootage: true`  
- [ ] Re-upload Paris TN shipper and confirm ~1481  

---

## Related

- Backend fix commit: `41ac249`  
- Broader quoting FE notes: [`../quoting-tool-frontend-changes-aug-28-2026.md`](../quoting-tool-frontend-changes-aug-28-2026.md)
