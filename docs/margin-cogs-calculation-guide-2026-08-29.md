# Margin and COGS Calculation Guide (PEMB + Storage)

This document explains how margin and COGS calculations work in the Sales Quoting APIs, including which fields are derived, which controls affect them, and how to interpret quote summary values.

---

## 1) Key Concepts

- **COGS (Cost of Goods Sold):** Internal cost base for materials/labor/freight.
- **Sell:** Customer-facing selling amount.
- **Markup Multiplier:** Cost-to-sell factor (for example, `1.30` means +30% markup on cost).
- **Margin % (Gross Margin):** Profit as a percentage of sell.

### Markup vs Margin (important)

- **Markup:** `(Sell - Cost) / Cost`
- **Margin:** `(Sell - Cost) / Sell`

For markup multiplier `1.30`:
- Sell = `Cost * 1.30`
- Implied margin = `1 - (1 / 1.30) = 23.1%`

---

## 2) PEMB Base Calculation Flow

PEMB quote pricing is computed in `pricingEngine`.

### Step A — Build material row subtotal

Each category row is priced and summed:

- Steel categories: `weight * ratePerLb`
- Sheeting: computed from sheeting SF rules
- Bucket categories:
  - `trim = max(weight * trim.perLb, sf * trim.perSf)`
  - `misc = max(weight * misc.perLb, sf * misc.perSf)`
  - `accessories = max(weight * accessories.perLb, sf * accessories.perSf)`
  - `fasteners = sf * fasteners.perSf`

Result:
- `rowSubtotalBeforeBlend`

### Step B — Apply vendor blend

- `blendSavings = totalWeightLbs * vendorDeltaPerLb * blendPct`
- `matCost = rowSubtotalBeforeBlend - blendSavings`
- `vendorBlendAdjustment = matCost - rowSubtotalBeforeBlend`

Interpretation:
- Negative `vendorBlendAdjustment` => savings (cost reduced)
- Positive `vendorBlendAdjustment` => uplift (cost increased)

### Step C — Freight and trucks

- `freight = totalWeightLbs * freight.ratePerLb`
- `trucks = ceil(totalWeightLbs / freight.lbsPerTruck)`

### Step D — Material sell and installation sell

- `matSell = (matCost + freight) * markup.pembMultiplier`
- If scope includes install:
  - `instCost = sf * installCostPerSf`
  - `instSell = sf * installSellPerSf`

### Step E — Totals and margin

- `totCost = matCost + freight + instCost`
- `totSell = matSell (+ instSell if scope includes install)`
- `profit = totSell - totCost`
- `profPct = (profit / totSell) * 100`

---

## 3) COGS Override Flow (PEMB)

COGS override lets users target a new material margin or sell.

### Computed Margin (current margin)

Calculated from current pricing before override:

- `computedCost = matCost + freight`
- `computedSell = matSell`
- `computedMargin = ((computedSell - computedCost) / computedSell) * 100`

### Target Margin (user-selected margin)

When user sets target margin `%`, adjusted material sell is:

- `adjustedSell = adjustedCost / (1 - targetMarginDecimal)`

Where:
- `targetMarginDecimal = targetMarginPct / 100`
- `adjustedCost` comes from user cost override or current computed cost

### Apply behavior

When `cogsOverride.applied = true`, pricing fields are updated:

- `matCost`
- `matSell`
- `totCost`
- `totSell`
- `profit`
- `profPct`
- `sfPrice`

### Important reconciliation rule

In current fixed behavior:

- `matSell` includes freight sell basis
- `Building Subtotal (Sell)` reconciles as:
  - `Building Subtotal (Sell) = Material Sell + Installation Sell` (for both scope)

---

## 4) Storage Calculation Flow

Storage quote pricing is computed in `storagePricingEngine`.

- Building sell per building:
  - `buildingSell = round(buildingCogs * (1 + buildingMarkupPct/100))`
- Similar sell logic for doors/extras where applicable
- `installSell = installSellPerSf * totalSqft`
- `grandTotal = buildingSell + doorSell + extrasSell + shipping + drawings + installSell + concreteSell + insulationSell + tax`
- `marginPercent = totalProfit / (totalSellBeforeTax + tax)`

### Storage shipping default behavior (latest)

From `extract-storage-cog`:
- Uses detected shipping/freight value from sheet/meta when available
- Falls back to `0` when not available
- No forced `12000` fallback

---

## 5) Quote Preview Display Semantics (Customer-facing)

Customer preview now uses sell-side summaries to avoid exposing internal cost lines.

PEMB summary line meanings:

- `Material (Sell, includes freight)` = `matSell`
- `Installation Sell` = `instSell` (if applicable)
- `Building Subtotal (Sell)` = `totSell` (pre-tax subtotal)
- `Sales Tax` = computed tax (materials + insulation taxable, labor not taxed)
- `Total` = subtotal + add-ons + tax

---

## 6) Primary Fields and What They Mean

- `rowSubtotalBeforeBlend`: Sum of visible category pricing rows before blend savings.
- `vendorBlendAdjustment`: Signed delta applied from blend logic.
- `vendorBlendSavingsExact`: Positive savings amount before rounding display.
- `matCost`: Material cost after blend adjustment (pre-markup).
- `freight`: Freight cost computed from weight.
- `matSell`: Material sell value (includes freight in PEMB flow).
- `instSell`: Installation sell value.
- `totSell`: Building subtotal sell (before tax/add-ons in full quote context).
- `profit`: Gross profit (`totSell - totCost`).
- `profPct`: Gross margin % on sell.
- `sfPrice`: Sell per square foot (`totSell / sf`).

---

## 7) Square Footage Source (PEMB)

When manual SF is not locked:

- `squareFootage = round(totalWeightLbs / 9)`

This is a legacy heuristic inherited from v5 logic.

Related metadata is returned in:
- `squareFootageMeta.source`
- `squareFootageMeta.formula`
- `squareFootageMeta.fromWeight`
- `squareFootageMeta.coverDerivedSqft`

---

## 8) What to Tell a Customer vs Internal Team

### Customer-safe explanation

"Pricing is generated from extracted material quantities, project scope (supply/install), freight, and applicable taxes. Final totals shown in the quote are sell-side amounts."

### Internal explanation

"Material COGS is computed from category rates, adjusted by vendor blend, freight is weight-based, sell is derived from rule multipliers or COGS override targets, and gross margin is computed from final sell vs total cost."

---

## 9) Quick Troubleshooting Checklist

If numbers look mismatched:

1. Confirm whether COGS override is applied (`cogsOverride.applied`).
2. Verify scope (`supply/install/both`) since `totSell` composition changes.
3. Check `squareFootageMeta` source (weight formula vs manual).
4. Check `vendorBlendAdjustment` sign and amount.
5. Confirm shipping source for storage extraction (`shippingDefault`).
6. Recompute after pricing rule changes.

