# Frontend — Invoice tax + markup breakdown (from approved quote)

Use this on the **create / edit invoice** screen. Do not calculate tax or markup in the UI.

Related: `docs/frontend-api-delta-2026-09-09-invoice-approval-versions.md`

---

## API

`GET /api/leads/:leadId/quotations/latest-approved-tax`

Auth: sales + admin.

Returns the latest **admin-approved** quotation on that lead.

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6aa14f4a6f7c6ed87523ff81",
    "quotationId": "6aa1606ff485426a4984769b",
    "quoteNumber": "QUO-0010",
    "amountWithoutMarkup": 170949.91,
    "subtotalWithoutMarkup": 170949.91,
    "markup": 62228.09,
    "subtotal": 233178,
    "subtotalWithMarkup": 233178,
    "tax": 7846,
    "total": 241024,
    "taxRate": 7,
    "taxableBase": 112079,
    "taxNote": "Tax on materials & insulation — labor not taxed",
    "currency": "USD",
    "approvalStatus": "approved",
    "versionNumber": 1,
    "reviewedAt": "2026-09-09T13:51:50.691Z"
  }
}
```

These are the real QUO-0010 numbers. `subtotal` and `subtotalWithMarkup` are the same value. `amountWithoutMarkup` and `subtotalWithoutMarkup` are the same value.

`404` if the lead has no approved quotation.

---

## Money fields

| Field | Meaning | Invoice field |
|---|---|---|
| `amountWithoutMarkup` / `subtotalWithoutMarkup` | Pretax **before** markup | Line rate, footer Subtotal |
| `markup` | Quote markup **$** | Footer `markupTotal` |
| `subtotal` / `subtotalWithMarkup` | Pretax **after** markup | Display check only |
| `tax` | Tax **$** (not a %) | Footer Tax |
| `total` | Amount customer pays | Footer Total / `totalAmount` |

Checks:

- `subtotalWithoutMarkup + markup` = `subtotalWithMarkup`
- `subtotalWithMarkup + tax` = `total`

Do **not** compute `subtotal * taxRate`. Tax is 7% of `taxableBase` (materials + insulation) only.

---

## How the form should look

```
Line: Project Quote
  Rate     amountWithoutMarkup
  Qty      1
  Tax      off / empty / $0 on the line
  Total    amountWithoutMarkup

Subtotal                   $subtotalWithoutMarkup
Markup                     $markup
Subtotal with markup       $subtotalWithMarkup
Tax                        $tax
Total (USD)                $total
```

Optional under Tax: show `taxNote`.

---

## What the code should do

1. Call `GET /api/leads/:leadId/quotations/latest-approved-tax`
2. Line rate = `data.amountWithoutMarkup`
3. Line qty = `1`
4. Line tax % = **0**
5. Footer subtotal = `data.amountWithoutMarkup`
6. Footer markup = `data.markup`
7. Footer tax = `data.tax` (dollar amount)
8. Footer total = `data.total`

When posting create/update invoice:

```json
{
  "quotationId": "<data.quotationId>",
  "lineItems": [
    {
      "description": "Project Quote",
      "rate": 170949.91,
      "quantity": 1,
      "tax": 0,
      "total": 170949.91
    }
  ],
  "subtotal": 170949.91,
  "markupTotal": 62228.09,
  "tax": 7846,
  "totalAmount": 241024
}
```

Use the API numbers. Do not recompute tax.

If sales **adds extra invoice markup** on top of the quote markup, add it to `markupTotal` and set:

`totalAmount = amountWithoutMarkup + newMarkupTotal + tax`

Do **not** change `tax`.

If sales adds a discount:

`totalAmount = amountWithoutMarkup + markupTotal - discount + tax`

---

## What not to do

- Do not put `total` in the line rate
- Do not set line tax to **7%**
- Do not compute `subtotal * 7%` or `subtotal * 1.07`
- Do not use `taxRate` for invoice math
- Do not put quote markup in the line **and** in `markupTotal` (that double-counts)

`taxRate` is **7% of `taxableBase` only** (materials + insulation). Labor is not taxed.

---

## Other response fields (do not use for invoice amounts)

| Field | Meaning |
|---|---|
| `leadId` | Lead this quote belongs to |
| `quotationId` | Send this on invoice create |
| `quoteNumber` | Display only |
| `taxRate` | Display only (7). Not “7% of subtotal” |
| `taxableBase` | Amount the 7% was applied to. Display / debug |
| `taxNote` | Short explanation under Tax |
| `currency` | `USD` |
| `approvalStatus` | Quote is approved |
| `versionNumber` | Quote version |
| `reviewedAt` | When admin approved |

---

## Removed aliases (do not look for these)

`quoteValue`, `quoteAmountIncludingTax`, `quoteAmountMinusTax`, `quoteAmountExcludingTax`, `pretaxAmount`, `salesTax`, `taxIncludedInQuoteValue`
