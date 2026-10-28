# Material Sell Override — FE wiring

The **Material Sell Override** input (hint: “Enter to override shipper price”) was not changing SELL PRICE when the value was only shown locally or sent without the apply flag / wrong field.

## Semantics

| Concept | Meaning |
|--------|---------|
| UI input | Material sell **excluding freight** (placeholder ≈ `matSell − freight`) |
| Engine `matSell` | Always **includes freight** |
| SELL PRICE (`totSell`) | `materialSellOverride + freight + installSell` (scope `both`) |

Example from a typical quote:

- Override entered: **$50,000**
- Freight: **$1,732.33**
- Install sell: **$27,000**
- **SELL PRICE → $78,732.33** (not $58,176)

## Request (preferred)

`POST /api/sales/estimates/compute` (same on create/update estimate):

```json
{
  "parsedCategories": { },
  "scope": "both",
  "squareFootage": 3000,
  "materialSellOverride": 50000
}
```

Aliases (any one works):

- `materialSellOverride`
- `matSellOverride`
- `quoteControls.materialSellOverride`
- `cogsOverride.materialSellOverride`

Auto-sets `cogsOverride.applied = true`.

## Alternative (COGS panel — sell includes freight)

```json
{
  "cogsOverride": {
    "applied": true,
    "sellDollar": 51732.33
  }
}
```

Here `sellDollar` is full **material+freight** sell (engine `matSell`).

To force `sellDollar` as ex-freight (HTML breakdown behavior):

```json
{
  "cogsOverride": {
    "applied": true,
    "sellDollar": 50000,
    "sellIncludesFreight": false
  }
}
```

## Clear override

Omit the field, or send `"materialSellOverride": null` / `"cogsOverride": { "applied": false }`, then recompute.

## Quote preview after Recompute

`POST /api/sales/estimates/documents/preview` **and** `documents/pdf` now:

1. **Merges** live `pricingResult` / `fullQuote` over a saved `estimateId` (live pricing wins; a stale body `grandTotal` is ignored when fresh `pricingResult` is present).
2. Prefers top-level `pricingResult` over nested stale `fullQuote.pricing`.
3. Can rebuild in one call when you send `parsedCategories` + overrides / live controls / `recompute: true`.
4. PDF uses the **same** live rebuild path as HTML (no more “only updates after save”).

**Recommended FE flow**

```text
1. POST /compute  { parsedCategories, materialSellOverride, ... }
2. POST /documents/preview {
     estimateId?,                    // optional — for customer/header fields
     pricingResult: data.pricing,    // from compute — required for live numbers
     fullQuote: data.fullQuote,      // from compute
     grandTotal: data.fullQuote.grandTotal,
     sections: ["quote","sow","contract"]
   }
```

Or one-shot: `POST /documents/preview` with `parsedCategories` + `materialSellOverride` (+ `recompute: true`).

## Response check

`pricing.matSell` ≈ override + freight  
`pricing.totSell` ≈ override + freight + installSell  
`pricing.materialSellOverrideApplied: true`  
`pricing.materialSellExFreight` ≈ the value you entered  

