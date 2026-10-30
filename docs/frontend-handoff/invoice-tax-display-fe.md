# Invoice Tax — one number (line + summary)

**Status:** Backend fixed  
**Date:** 30 Oct 2026  
**Example:** `INV-0072`

---

## Bug

Admin invoice showed **two different taxes**:

| Place | Bound field (likely) | Value |
|-------|----------------------|--------|
| Line **Tax** column | `lineItems[].taxAmount` | **$3,259** (correct — 8% on materials) |
| Summary under Subtotal | `avalara.totalTax` | **$14,437.62** (AvaTax estimate) |
| **Total** | `totalAmount` | **$172,516** (= 169,257 + 3,259) |

So summary Tax did not match Total.

---

## Source of truth

| Field | Use |
|-------|-----|
| **`invoice.tax`** | Summary **Tax** row (charged / quote / line tax) |
| **`lineItems[].taxAmount`** | Line Tax column (should match `invoice.tax` when one line) |
| **`totalAmount`** | Grand total (`subtotal + tax` for this flow) |
| `avalara.estimatedTotalTax` | AvaTax estimate only (debug) — **not** for the Tax row |
| `avalara.totalTax` | After fix on estimates: same as `invoice.tax` so old FE bindings still work |

Correct for INV-0072:

```text
Subtotal   $169,257.00
Tax        $3,259.00
Total      $172,516.00
```

---

## FE checklist

- [ ] Summary **Tax** → `invoice.tax` (not `avalara.totalTax` / not a second calc)
- [ ] Line Tax → `lineItems[].taxAmount`
- [ ] Do not show AvaTax estimate as the invoice Tax unless `avalara.documentStatus === "Committed"`
- [ ] Refresh Admin invoice detail after deploy

---

## Related

Quote tax: 8% on materials & insulation only (`salesTax.amount` on estimate), not 8% of full subtotal.
