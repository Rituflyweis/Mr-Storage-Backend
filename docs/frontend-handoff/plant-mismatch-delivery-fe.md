# Plant mismatch dashboard — construction delivery mismatches (FE)

## What changed

Admin / Plant Overview **mismatch** widgets now include **construction site delivery mismatches** (`BundleMismatchOrder` / MMO-*), in addition to shipper quote-vs-BOM comparison lines.

## Summary

```http
GET /api/admin/plant/dashboard/mismatch-summary
```

(Alias: `…/missing-mismatch-summary`. Plant panel may mirror under `/api/plant/…` if routed.)

### New fields (additive)

| Field | Meaning |
|-------|---------|
| `deliveryMismatches` | Count of **open / in_review** construction mismatch orders |
| `constructionDeliveryMismatches` | Alias of `deliveryMismatches` |
| `deliveryMismatchItems` | Sum of line items across those orders |

Existing quote-compare fields unchanged: `missingItems`, `quantityMismatches`, `specificationMismatches`, `extraItems`, etc.

`statusBreakdown` may also include `delivery_mismatch` and `delivery_<reason>` (e.g. `delivery_qty_short`).

### FE card

Add a fifth KPI (or extend the mismatch strip):

**Delivery mismatches** → bind `deliveryMismatches` (or `constructionDeliveryMismatches`).

## Report

```http
GET /api/admin/plant/dashboard/mismatch-report?page=1&limit=10&category=delivery
```

| `category` | Includes |
|------------|----------|
| `delivery` or `construction` | Construction MMOs only |
| `qty` | Quote `qty_mismatch` **+** delivery orders whose reason looks like qty/short |
| `missing` / `spec` / `extra` | Quote-compare only (unchanged) |
| omit / `all` | Quote-compare **+** delivery MMOs |

### Delivery row shape (`source: "delivery_mismatch"`)

```json
{
  "resultId": "…",
  "source": "delivery_mismatch",
  "mismatchId": "…",
  "mismatchOrderId": "MMO-0005",
  "leadId": "…",
  "projectName": "BRANDON CUTTS",
  "jobId": "2026241",
  "bundleNo": "B-001",
  "status": "delivery_mismatch",
  "orderStatus": "open",
  "reason": "qty_short",
  "expected": { "qty": 9, "items": [/* … */] },
  "received": { "qty": 8, "items": [/* … */] },
  "items": [/* line items */],
  "photos": [],
  "reportedBy": { "_id": "…", "name": "…", "email": "…" },
  "createdAt": "…"
}
```

Quote-compare rows now include `"source": "quote_comparison"`.

## Checklist

- [ ] Overview: show **Delivery mismatches** from `deliveryMismatches`
- [ ] “View report” for that card → `category=delivery`
- [ ] All-mismatches list → no category (or `all`) so MMOs appear with quote lines
- [ ] Distinguish UI by `source` (`delivery_mismatch` vs `quote_comparison`)

## Note

Summary/report still scope to **approved PO** plant leads (same as other Overview widgets). Project tab `GET …/plant/projects/:leadId/mismatch-orders` remains the full per-project list.
