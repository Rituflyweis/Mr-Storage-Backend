# Frontend — Invoice tax breakdown (from approved quote)

Use this on the **create / edit invoice** screen. Do not calculate tax in the UI.

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
    "subtotal": 233178,
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

`404` if the lead has no approved quotation.

---

## Fields to use (only these three money fields)

| Field | Put on invoice | QUO-0010 example |
|---|---|---|
| `subtotal` | Line rate, line total, footer Subtotal | `233178` |
| `tax` | Footer Tax **$** (fixed amount) | `7846` |
| `total` | Footer Total | `241024` |

Check: `subtotal + tax` must equal `total`.

`233178 + 7846 = 241024`

---

## How the form should look

```
Line: Project Quote
  Rate     233178
  Qty      1
  Tax      off / empty / $0 on the line
  Total    233178

Subtotal                   $233,178.00
Tax                        $7,846.00
Total (USD)                $241,024.00
```

Optional under Tax: show `taxNote`  
(`Tax on materials & insulation — labor not taxed`)

---

## What the code should do

1. Call `GET /api/leads/:leadId/quotations/latest-approved-tax`
2. Line rate = `data.subtotal`
3. Line qty = `1`
4. Line tax % = **0** (do not set “Tax 7%” on the line)
5. Footer subtotal = `data.subtotal`
6. Footer tax = `data.tax` (dollar amount)
7. Footer total = `data.total`  
   or `data.subtotal + data.tax` (must match `data.total`)

When posting create/update invoice:

```json
{
  "quotationId": "<data.quotationId>",
  "lineItems": [
    {
      "description": "Project Quote",
      "rate": 233178,
      "quantity": 1,
      "tax": 0,
      "total": 233178
    }
  ],
  "subtotal": 233178,
  "tax": 7846,
  "totalAmount": 241024
}
```

Use the API numbers. Do not recompute tax.

---

## What not to do

- Do not put `total` (`241024`) in the line rate
- Do not set line tax to **7%**
- Do not compute `subtotal * 7%` or `subtotal * 1.07`
- Do not use `taxRate` for invoice math

`taxRate` is **7% of `taxableBase` only** (materials + insulation). Labor is not taxed. That is why:

- `233178 × 7%` = `16322` ← wrong
- `233178 × 1.07` = `249500` ← wrong
- `taxableBase 112079 × 7%` = `7846` ← this is already `data.tax`

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
