# Engineering Drawings $ & Finish Type — FE wiring

## Engineering Drawings $

Send on **`POST /api/sales/estimates/compute`** (and create/update / documents/preview):

| Preferred | Also accepted |
|-----------|----------------|
| `pembDrawings: 5000` | `engineeringDrawings`, `engineeringDrawing`, `drawingsOverride`, `drawingCost`, `drawingsCost`, `drawingFee` |
| | numeric `drawings: 5000` (array `drawings` still means file attachments) |
| | `quoteControls.pembDrawings` |

Adds **$5,000** into `pricing.totSell` / `totCost` and shows **Engineering Drawings** on quote + SOW.

## Finish type (Red Iron / Galvanized)

| Preferred | Also accepted |
|-----------|----------------|
| `steelFinish: "red-iron"` \| `"galvanized"` | `finishType`, `finish`, `steel_finish`, `framingFinish` |
| | `galvanized: true` |
| | `quoteControls.steelFinish` |

Affects:
- Reprice of cold-formed / structural finish line items in `parsedCategories.customItems`
- Quote header **Finish Type**
- SOW finish sentence (`red iron (red oxide primer)` vs `galvanized`)

**Important:** Recompute with the same **`parsedCategories`** from extract-shipper (must include `customItems` for finish $ impact).

## Recommended Recompute body

```json
{
  "parsedCategories": { },
  "scope": "both",
  "squareFootage": 3000,
  "pembDrawings": 5000,
  "steelFinish": "galvanized",
  "materialSellOverride": null
}
```

Then preview:

```json
{
  "estimateId": optional,
  "pricingResult": "<from compute.data.pricing>",
  "fullQuote": "<from compute.data.fullQuote>",
  "pembDrawings": 5000,
  "steelFinish": "galvanized",
  "sections": ["quote", "sow", "contract"]
}
```

Or one-shot preview with `parsedCategories` + `pembDrawings` + `steelFinish` (server rebuilds).
