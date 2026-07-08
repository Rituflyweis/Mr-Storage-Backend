# Sales — invoice line items & shipper comparison stats (June 2026)

Frontend reference for two backend updates:

1. **Invoice create/update** — pass-through totals with markup/tax type fields  
2. **Shipper comparison** — tab counts on summary + paginated lists by category  

**Auth:** Plant shipper endpoints require `Bearer` token + `plant` role. Invoice endpoints require `admin` or `sales`.

**Response envelope:**

```json
{
  "success": true,
  "message": "...",
  "data": { ... }
}
```

---

## Table of contents

1. [Invoice — FE-calculated totals (pass-through)](#1-invoice--fe-calculated-totals-pass-through)
2. [Shipper comparison — stats and category lists](#2-shipper-comparison--stats-and-category-lists)
3. [Frontend checklist](#3-frontend-checklist)
4. [Quick endpoint index](#4-quick-endpoint-index)

---

## 1. Invoice — FE-calculated totals (pass-through)

The backend **does not recalculate** invoice math. The frontend computes all amounts and sends them; the API stores them as-is.

Backend still auto-generates: `invoiceNumber`, `poNumber` (first invoice per lead), and `dueDate` (`date + daysToPay` on save).

### Endpoints

| Method | Path |
|--------|------|
| POST | `/api/leads/:leadId/invoices` |
| PUT | `/api/invoices/:invoiceId` |
| GET | `/api/invoices/:invoiceId` |

Roles: `admin`, `sales`

### FE calculation contract (reference)

| Function | Formula |
|----------|---------|
| Subtotal | Sum of `(rate + markup per unit) × quantity` per line — **tax excluded** |
| Tax | Sum of line tax amounts (from % or flat per line) |
| Total | `subtotal − discount + tax` |

### Line item fields

Send **input** values and **types**, plus **computed display fields** the UI already calculates.

| Field | Type | Notes |
|-------|------|--------|
| `rate` | number | Base unit rate |
| `quantity` | number | Default `1` |
| `markup` | number | Raw input (`10` = 10% or $10 depending on type) |
| `markupType` | string | `percentage` or `amount` (default `amount`) |
| `tax` | number | Raw input |
| `taxType` | string | `percentage` or `amount` (default `amount`) |
| `effectiveRate` | number | Rate after markup (e.g. $110) |
| `markupAmount` | number | Total markup $ for the line |
| `taxAmount` | number | Tax $ for the line |
| `total` | number | Line subtotal **ex tax** (e.g. $220) |

**Do not** put tax percentage in `tax` without `taxType: "percentage"`.

### Invoice-level fields (send computed values)

| Field | Notes |
|-------|--------|
| `subtotal` | Sum of line totals (ex tax) |
| `markupTotal` | Sum of line markup amounts |
| `tax` | Sum of line tax amounts |
| `discount` | Flat discount $ |
| `depositAmount` | Optional |
| `totalAmount` | **Required on create** — grand total |

### Example create body

```json
{
  "daysToPay": 30,
  "totalAmount": 222,
  "subtotal": 220,
  "tax": 22,
  "markupTotal": 20,
  "discount": 20,
  "lineItems": [
    {
      "items": ["Steel package"],
      "rate": 100,
      "quantity": 2,
      "markup": 10,
      "markupType": "percentage",
      "tax": 10,
      "taxType": "percentage",
      "effectiveRate": 110,
      "markupAmount": 20,
      "taxAmount": 22,
      "total": 220
    }
  ]
}
```

### Customer email / PDF (markup hidden)

Markup is stored on the invoice for internal/sales use but **not shown to the customer** in email or PDF.

| Column | Customer sees |
|--------|----------------|
| Rate | `effectiveRate` (final price per unit — markup already included) |
| Qty | `quantity` |
| Tax | `taxAmount` (dollar amount only) |
| Amount | Line `total` (ex tax) |

**Not shown:** markup column, base rate, markup %, or **Markup total** in summary.

Summary: Subtotal → Discount (−) → Tax → Deposit (if any) → Total due.

---

## 2. Shipper comparison — stats and category lists

Comparison UI tabs: **Matched**, **Unmatched**, **Extra**, **All**.

### Category mapping

| FE tab | `category` param | Included `status` values |
|--------|------------------|---------------------------|
| Matched | `matched` | `matched` |
| Unmatched | `unmatched` | `missing_in_vendor_quote`, `qty_mismatch`, `length_mismatch`, `weight_mismatch`, `part_mismatch`, `price_mismatch`, `ambiguous_match` |
| Extra | `extra` | `extra_in_vendor_quote` |
| All | `all` | Every comparison row |

**Unmatched** = missing BOM lines + all mismatch types (not extra vendor-only lines).

### 2A. Tab counts — `GET /api/plant/shipper-requests/:requestId/comparison-summary`

Also available at `/api/plant/shipper-files/:requestId/comparison-summary`.

**New:** `stats` object with per-tab counts (for tab badges).

**Kept:** Full `results[]` table and `resultCount` (backward compatible with existing comparison UI).

**Response `data` (partial):**

```json
{
  "requestId": "...",
  "comparisonStatus": "completed",
  "summary": {
    "expectedLines": 48,
    "vendorLines": 47,
    "matchedLines": 43,
    "missingItems": 2,
    "extraItems": 1
  },
  "stats": {
    "matched": { "count": 43 },
    "unmatched": { "count": 5 },
    "extra": { "count": 1 },
    "all": { "count": 49 },
    "unmatchedBreakdown": {
      "missing_in_vendor_quote": 2,
      "qty_mismatch": 1,
      "part_mismatch": 2
    }
  },
  "canProceedToApproval": false,
  "blockers": ["missing_items", "qty_mismatch"],
  "resultCount": 49,
  "results": [
    {
      "resultId": "...",
      "status": "missing_in_vendor_quote",
      "severity": "critical",
      "expected": { "partCode": "C62514", "qty": 25 },
      "received": null,
      "difference": { "qtyDiff": null },
      "matchMethod": "none",
      "matchConfidence": null,
      "reason": "Missing in vendor quote",
      "createdAt": "2026-06-04T05:10:01.000Z"
    }
  ]
}
```

Use `stats.*.count` for tab badges. `unmatchedBreakdown` is optional detail for sub-badges or tooltips.

### 2B. Tab lists — `GET /api/plant/shipper-requests/:requestId/comparison-results`

Also available at `/api/plant/shipper-files/:requestId/comparison-results`.

#### Query params

| Param | Default | Notes |
|-------|---------|--------|
| `category` | `all` | `matched` \| `unmatched` \| `extra` \| `all` |
| `page` | `1` | Min `1` |
| `limit` | `20` | Max `200` |
| `severity` | — | `low` \| `medium` \| `high` \| `critical` |
| `status` | — | Raw status filter (legacy). **Do not combine with `category`** |

#### Examples

```
GET /api/plant/shipper-requests/:requestId/comparison-results?category=matched&page=1&limit=50
GET /api/plant/shipper-requests/:requestId/comparison-results?category=unmatched&page=1&limit=50
GET /api/plant/shipper-requests/:requestId/comparison-results?category=extra
GET /api/plant/shipper-requests/:requestId/comparison-results?category=all
```

#### Response `data` (partial)

```json
{
  "requestId": "...",
  "comparisonStatus": "completed",
  "category": "unmatched",
  "filters": { "status": null, "severity": null, "category": "unmatched" },
  "pagination": { "page": 1, "limit": 50, "total": 5, "pages": 1 },
  "results": [
    {
      "resultId": "...",
      "status": "missing_in_vendor_quote",
      "severity": "critical",
      "expected": { "partCode": "C62514", "qty": 25, "lengthFeet": 6.98 },
      "received": null,
      "difference": { "qtyDiff": null },
      "matchMethod": "none",
      "matchConfidence": null,
      "reason": "Missing in vendor quote",
      "createdAt": "2026-06-04T05:10:01.000Z"
    }
  ]
}
```

If both `category` (other than `all`) and `status` are sent → `400`: use one filter only.

### FE workflow

1. Open comparison → `GET .../comparison-summary` → render tab counts from `stats`.
2. Active tab → `GET .../comparison-results?category=matched|unmatched|extra|all&page=&limit=`.
3. Approval gate → still `canProceedToApproval` + `blockers` from summary.

---

## 3. Frontend checklist

### Invoice

- [ ] Compute subtotal, tax, total on FE before save
- [ ] Send `markupType` / `taxType` with raw `markup` / `tax` inputs
- [ ] Send `effectiveRate`, `markupAmount`, `taxAmount`, line `total`
- [ ] Send invoice-level `subtotal`, `markupTotal`, `tax`, `discount`, `totalAmount`
- [ ] Preview/email: use stored computed fields from GET response

### Shipper comparison

- [ ] Tab badges: `GET .../comparison-summary` → `stats.*.count`
- [ ] Full table: same response `results[]` (or paginated `comparison-results?category=...` for large lists)
- [ ] Do not send `category` + `status` together on comparison-results

---

## 4. Quick endpoint index

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/leads/:leadId/invoices` | Create invoice (FE totals) |
| PUT | `/api/invoices/:invoiceId` | Update invoice (FE totals) |
| GET | `/api/invoices/:invoiceId` | Invoice detail |
| GET | `/api/plant/shipper-requests/:requestId/comparison-summary` | Comparison stats + approval gate |
| GET | `/api/plant/shipper-requests/:requestId/comparison-results` | Paginated list by `category` |

---

## Related docs

| Doc | Topic |
|-----|--------|
| [plant-panel-api.md](./plant-panel-api.md) | Full plant API (§21L / §21M) |
| [vendor-upload-resubmit-api.md](./vendor-upload-resubmit-api.md) | Vendor upload + comparison flow |
| [plant-frontend-api-updates-jun-2026.md](./plant-frontend-api-updates-jun-2026.md) | Other June 2026 plant FE updates |
