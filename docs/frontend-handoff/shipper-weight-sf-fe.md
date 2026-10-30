# Shipper Weight → SF (1,458 still wrong) — FE handoff

**Date:** 30 Oct 2026 (updated)  
**Backend status:** Fixed (`41ac249` + current `extract-shipper`)  
**Issue:** UI still shows **1,458 SF** / **13,122.98 lbs** for `#6959 Paris, TN expansion (Shipper)`.

---

## Correct numbers for Paris TN (re-verified 30 Oct 2026)

Fresh `POST /api/sales/estimates/extract-shipper` on `#6959 Paris, TN expansion (Shipper).xlsx`:

| Field | Correct | Wrong UI (screenshot) |
|-------|---------|------------------------|
| Shipper Weight (`detectedWeightLbs`) | **13,547.18 lbs** | 13,122.98 lbs |
| Weight SF (`fromWeight` = round(lbs÷9)) | **1,505** | 1,458 |
| Cover SF (`coverDerivedSqft` = 20×150) | **3,000** | 3,000 (OK) |

**Confirmed backend bug (fixed 30 Oct):** with pricing rules on, item rules moved **Mullion 424.2 lbs** into `customItems`, which were **excluded** from `totalWeightLbs` / `detectedWeightLbs` → API returned **13,122.98** / SF **1,458**. Parser now includes `customItemsWeightLbs` in those totals → **13,547.18** / SF **1,505**.

Weight SF **1,505 ≠ Cover 3,000** by design (lbs÷9 estimate vs building W×L). Use the mismatch banner **Use Cover SF** if pricing should use **3,000**.

---

## Root cause

| Piece | Wrong | Correct |
|-------|--------|---------|
| SF math | Client `sum(visible categories) / 9` or cached **1,458** | Server `round(detectedWeightLbs / 9)` → **1,505** for Paris TN |
| Shipper Weight card | Mapped / partial (~13,122) | `data.detectedWeightLbs` (**13,547.18**) |
| Subtitle | `(from weight: 1,458 / 9)` | `(from weight: 13,547.18 lbs ÷ 9)` |

If the UI still shows 1,458 after a **fresh re-upload** with `sf: 0`, FE is ignoring extract fields or locking old SF.

---

## API (extract shipper)

Same endpoint as today (PEMB shipper extract / parse). Relevant response fields:

```json
{
  "success": true,
  "data": {
    "totalWeightLbs": 13547.18,
    "detectedWeightLbs": 13547.18,
    "unmappedWeightLbs": 0,
    "squareFootage": 1505,
    "squareFootageMeta": {
      "selected": 1505,
      "source": "weight_formula",
      "formula": "round(detectedWeightLbs / 9)",
      "weightLbsUsed": 13547.18,
      "mappedWeightLbs": 13547.18,
      "fromWeight": 1505,
      "coverDerivedSqft": 3000,
      "inputSf": 0
    }
  }
}
```

| Field | Use for |
|-------|---------|
| `detectedWeightLbs` | **Shipper Weight** card |
| `squareFootage` | SF used for pricing after extract |
| `squareFootageMeta.fromWeight` | Auto SF from weight (`round(weight ÷ 9)`) |
| `squareFootageMeta.weightLbsUsed` | Lbs in the ÷9 formula — **use this in the subtitle** |
| `squareFootageMeta.mappedWeightLbs` | Mapped-only weight (debug; **not** for SF label) |
| `squareFootageMeta.coverDerivedSqft` | Cover sheet SF for mismatch banner |
| `squareFootageMeta.source` | `"weight_formula"` \| `"manual"` |

Formula: **`fromWeight = round(detectedWeightLbs / 9)`** → Paris TN: `round(13547.18 / 9) = 1505`.

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

**Wrong (still in screenshot 30 Oct):**

```text
1,458.00 SF (from weight: 13,122.98 lbs ÷ 9) · cover sheet SF: 3,000.00 · 13,122.98 lbs
```

**Correct (Paris TN after extract):**

```text
1,505.00 SF (from weight: 13,547.18 lbs ÷ 9) · cover sheet SF: 3,000.00 · 13,547.18 lbs
```

Template:

```text
{fromWeight} SF (from weight: {weightLbsUsed} lbs ÷ 9) · cover sheet SF: {coverDerivedSqft} · {detectedWeightLbs} lbs
```

Use `squareFootageMeta.weightLbsUsed` / `detectedWeightLbs` from **extract response** — never re-sum category rows in the browser for SF or Shipper Weight.

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

1. Hard refresh / new session.  
2. Re-upload `#6959 Paris, TN expansion (Shipper).xlsx` (not a stale local HTML).  
3. Expect extract JSON:
   - `detectedWeightLbs` ≈ **13547.18**
   - `squareFootage` / `fromWeight` = **1505**
   - `coverDerivedSqft` = **3000**
4. Triage:
   - Network returns `fromWeight: 1505` but UI shows `1458` → **FE** (ignore / lock / client recompute)
   - Network returns `fromWeight: 1458` with `detectedWeightLbs ≈ 13122` → share full JSON (wrong file or body sending locked SF)
   - Want **3000** for $/SF → click **Use Cover SF** (not a weight-formula bug)

---

## Checklist

- [ ] Fresh extract sends `sf: 0` / `useManualSquareFootage: false`  
- [ ] Shipper Weight card = `data.detectedWeightLbs` (**13547.18**, not 13122)  
- [ ] SF / $/SF = `data.squareFootage` (**1505**)  
- [ ] Subtitle uses `weightLbsUsed` lbs ÷ 9  
- [ ] No client-side category sum ÷ 9  
- [ ] Manual / Cover SF sets `useManualSquareFootage: true`  
- [ ] Re-upload Paris TN and confirm **1505** weight SF  

---

## Related

- Backend fix commit: `41ac249`  
- Parity expected SF **1505**: [`../quoting-tool-shipper-parity-changes.md`](../quoting-tool-shipper-parity-changes.md)  
- Broader quoting FE notes: [`../quoting-tool-frontend-changes-aug-28-2026.md`](../quoting-tool-frontend-changes-aug-28-2026.md)
