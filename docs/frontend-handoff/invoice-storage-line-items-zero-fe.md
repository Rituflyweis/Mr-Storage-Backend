# Frontend handoff — Invoice $0 line / blank subtotal (Storage Materials quote)

**Symptom (Ankush LLC / Storage):** Invoice page shows **Payment Schedule** and **Request a Deposit** ($70,630, etc.) but:

- Line **Project Quote** → **RATE $0**, **TOTAL $0.00**
- **Subtotal / Markup / Discount** show **—** (empty)
- Schedule amounts look correct

**Cause:** Payment schedule and invoice **line/tax breakdown** come from the same API but FE often wires **only** schedule fields. Backend may also have pointed at the wrong estimate when a lead had **multiple** estimates (milestones on one row, Storage COG pricing on another).

**Backend fix (deploy):** `findEstimateForLeadPayment` prefers **latest priced** estimate (`storagePricingResult.grandTotal` / `fullQuoteResult.grandTotal` / `totalSell`) before milestone-only estimates; expanded estimate fields for Storage markup/COGS.

---

## 1. Single prefill API (required on invoice form load)

```http
GET /api/leads/:leadId/quotations/latest-approved-tax
```

Admin: same path under `/api/admin/leads/...` if your app uses admin routes.

Auth: sales or admin. Lead must have an **approved** quotation.

---

## 2. Map **all** money fields (not schedule only)

| UI | API field | Notes |
|----|-----------|--------|
| Line **Rate** | `amountWithoutMarkup` or `invoicePrefill.lineItems[0].rate` | Not `0` |
| Line **Total** | same as rate (qty 1) | |
| Footer **Subtotal** | `amountWithoutMarkup` / `subtotalWithoutMarkup` | |
| Footer **Markup** | `markup` → POST as `markupTotal` | Storage: from COG vs sell |
| Footer **Tax** | `tax` ($) | Do not use `subtotal * taxRate` |
| Footer **Total** | `total` → `totalAmount` | |
| **Payment Schedule** | `paymentScheduleStages` | Already wired in many builds |

**New (optional):** apply whole block from `invoicePrefill`:

```json
{
  "invoicePrefill": {
    "description": "Project Quote — QUO-…",
    "subtotal": 95000,
    "markupTotal": 12000,
    "tax": 3259,
    "discount": 0,
    "totalAmount": 110259,
    "lineItems": [
      {
        "description": "Project Quote — QUO-…",
        "rate": 95000,
        "quantity": 1,
        "markup": 12000,
        "markupType": "amount",
        "tax": 0,
        "taxType": "amount",
        "total": 95000
      }
    ]
  }
}
```

Line **tax %** stays **0**; footer carries **`tax`** dollars (see `docs/frontend-invoice-tax-breakdown-2026-09-10.md`).

---

## 3. Do not

- Leave default **Project Quote** row at **rate 0** after API success.
- Prefill **only** `paymentScheduleStages` and skip `total` / `amountWithoutMarkup`.
- Compute tax as `subtotal × 7%` on full invoice subtotal.

---

## 4. Flags to watch

| Field | Meaning |
|-------|---------|
| `quotationTotalStale: true` | `quotation.finalPrice` ≠ estimate grand — use `total` / `estimateGrandTotal` from API |
| `paymentScheduleExceedsInvoiceTotal: true` | Stale schedule on lead — refresh schedule or re-save milestones on quote |
| `paymentScheduleOutOfSync: true` | DB schedule ≠ current quote milestones |

---

## 5. Create invoice POST

`POST /api/leads/:leadId/invoices` — body should include values from prefill:

- `quotationId`, `subtotal`, `markupTotal`, `tax`, `totalAmount`, `lineItems` (from step 2)
- `depositAmount` / stage billing if billing one milestone

See `docs/frontend-invoice-create-api-2026-09-10.md`.

---

## 6. QA (Storage Materials)

- [ ] Approve Storage COG quote for lead → open invoice → line rate & subtotal **≠ 0**
- [ ] Markup footer matches API `markup`
- [ ] `total` matches quote **Total project investment**
- [ ] Payment schedule sum ≈ `total` (within $1 rounding)
- [ ] Sender brand **Storage Materials** does not change API mapping (same fields)

---

## 7. PM one-liner

**Payment schedule was seeded from the quote; line items stayed at UI defaults because the invoice form did not bind `latest-approved-tax` breakdown (or the backend picked a milestone-only estimate). Wire prefill fields or `invoicePrefill`; backend now prefers the priced Storage estimate.**
