# Frontend — Create invoice API

Use this for **manual** and **quote-based** customer invoices on the sales/admin create-invoice screen.

Related:

- Quote prefill: `docs/frontend-invoice-tax-breakdown-2026-09-10.md`
- Invoice approval: `docs/frontend-api-delta-2026-09-09-invoice-approval-versions.md`

---

## Endpoint

`POST /api/leads/:leadId/invoices`

| | |
|---|---|
| Auth | Sales + admin (Bearer token) |
| `leadId` | MongoDB ObjectId in URL (not in body) |
| Required body field | `totalAmount` |

Same endpoint for both flows. There is no `source` flag — quote vs manual is only how the frontend builds the body.

---

## Enums

### Line item (validated on create)

| Field | Allowed values | Default |
|---|---|---|
| `lineItems[].markupType` | `percentage` \| `amount` | `amount` |
| `lineItems[].taxType` | `percentage` \| `amount` | `amount` |

**Do not send `fixed`** — request fails validation.

### Other invoice enums (usually not sent on create)

| Field | Allowed values | Default |
|---|---|---|
| `invoiceType` | `customer` \| `vendor` \| `freight_carrier` | `customer` |
| `category` | `product` \| `service` \| `other` | `null` |
| `paymentMethod` | `cash` \| `bank_transfer` \| `credit_card` \| `upi` \| `cheque` \| `other` | `null` |

`status`, `approval.status`, `sendMethod` are set by the server — do not send on create.

---

## Body fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `totalAmount` | **Yes** | number | Amount customer pays |
| `subtotal` | No | number | Footer subtotal = amount **before** markup |
| `markupTotal` | No | number | Footer markup in **dollars** |
| `tax` | No | number | Footer tax in **dollars** |
| `discount` | No | number | Default `0` |
| `depositAmount` | No | number | Default `0` |
| `quotationId` | No | ObjectId | Link to approved quote (recommended for quote invoice) |
| `date` | No | ISO 8601 date | e.g. `"2026-09-10"` |
| `daysToPay` | No | number | Used to compute due date |
| `description` | No | string | Invoice note |
| `paymentScheduleStageId` | No | ObjectId | Optional payment-schedule stage link |
| `lineItems` | No | array | See below |

### `lineItems[]`

| Field | Type | Notes |
|---|---|---|
| `description` | string | Line label |
| `rate` | number | Unit rate |
| `quantity` | number | Default `1` |
| `markup` | number | Per-line markup input |
| `markupType` | enum | `amount` \| `percentage` |
| `tax` | number | Per-line tax input |
| `taxType` | enum | `amount` \| `percentage` |
| `total` | number | Line total excluding footer tax |
| `items` | string[] | Optional sub-lines |
| `images` | string[] | Max 4 image URLs |

---

## Flow A — Quote-based invoice

### Step 1 — Prefill from approved quote

`GET /api/leads/:leadId/quotations/latest-approved-tax`

Example (`QUO-0010`):

```json
{
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
  "taxNote": "Tax on materials & insulation — labor not taxed"
}
```

Do **not** compute `subtotal * 7%` for tax. Use `tax` dollars from the API.

### Step 2 — Create invoice

`POST /api/leads/6aa14f4a6f7c6ed87523ff81/invoices`

```json
{
  "quotationId": "6aa1606ff485426a4984769b",
  "date": "2026-09-10",
  "daysToPay": 30,
  "description": "Invoice from QUO-0010",
  "subtotal": 170949.91,
  "markupTotal": 62228.09,
  "tax": 7846,
  "discount": 0,
  "depositAmount": 0,
  "totalAmount": 241024,
  "lineItems": [
    {
      "description": "Project Quote — QUO-0010",
      "rate": 170949.91,
      "quantity": 1,
      "markup": 0,
      "markupType": "amount",
      "tax": 0,
      "taxType": "amount",
      "total": 170949.91
    }
  ]
}
```

### Mapping (tax API → invoice body)

| Tax API field | Invoice body field |
|---|---|
| `quotationId` | `quotationId` |
| `amountWithoutMarkup` / `subtotalWithoutMarkup` | `subtotal` and line `rate` |
| `markup` | `markupTotal` |
| `subtotal` / `subtotalWithMarkup` | Display only — do **not** post as invoice `subtotal` |
| `tax` | `tax` |
| `total` | `totalAmount` |

### Math checks

```
subtotalWithoutMarkup + markup = subtotalWithMarkup
subtotalWithMarkup + tax       = total

170949.91 + 62228.09 = 233178
233178 + 7846        = 241024
```

Invoice post check:

```
subtotal + markupTotal + tax - discount = totalAmount
```

### Form layout (quote invoice)

```
Line: Project Quote
  Rate     amountWithoutMarkup
  Qty      1
  Tax      0 / off on line
  Total    amountWithoutMarkup

Subtotal (no markup)       $170,949.91
Markup                     $ 62,228.09
Subtotal with markup       $233,178.00   (display only)
Tax                        $  7,846.00
Total                      $241,024.00
```

Put quote markup in **`markupTotal`**, not on the line (`markup: 0`).

---

## Flow B — Manual invoice

No tax API. Frontend calculates everything.

`POST /api/leads/:leadId/invoices`

```json
{
  "date": "2026-09-10",
  "daysToPay": 30,
  "description": "Custom invoice",
  "subtotal": 50000,
  "markupTotal": 5000,
  "tax": 1200,
  "discount": 0,
  "depositAmount": 0,
  "totalAmount": 56200,
  "lineItems": [
    {
      "description": "Materials",
      "rate": 30000,
      "quantity": 1,
      "markup": 10,
      "markupType": "percentage",
      "tax": 0,
      "taxType": "amount",
      "total": 33000
    },
    {
      "description": "Labor",
      "rate": 20000,
      "quantity": 1,
      "markup": 0,
      "markupType": "amount",
      "tax": 1200,
      "taxType": "amount",
      "total": 21200
    }
  ]
}
```

No `quotationId` required.

---

## Optional adjustments (quote invoice)

**Extra markup on top of quote:**

```
totalAmount = subtotal + newMarkupTotal + tax - discount
```

Keep `tax` as the API dollar amount. Do not change tax when adding markup.

**Discount:**

```
totalAmount = subtotal + markupTotal - discount + tax
```

---

## Success response

```json
{
  "success": true,
  "data": {
    "invoice": {
      "_id": "...",
      "invoiceNumber": "INV-0018",
      "leadId": "6aa14f4a6f7c6ed87523ff81",
      "quotationId": "6aa1606ff485426a4984769b",
      "status": "draft",
      "subtotal": 170949.91,
      "markupTotal": 62228.09,
      "tax": 7846,
      "totalAmount": 241024,
      "approval": {
        "status": "pending_approval"
      },
      "approvalStatus": "pending_approval",
      "workflowStatus": "pending_approval"
    }
  }
}
```

| Who creates | `approval.status` after create |
|---|---|
| Sales | `pending_approval` |
| Admin | `approved` |

---

## Validation errors

| Error | Cause | Fix |
|---|---|---|
| `lineItems[0].markupType Invalid value` | Sent `fixed` | Use `amount` or `percentage` |
| `totalAmount` required | Missing total | Always send `totalAmount` |
| `Validation failed` on `taxType` | Invalid enum | Use `amount` or `percentage` |

---

## What not to do

- Do not send `markupType: "fixed"`
- Do not put `subtotalWithMarkup` (233178) in invoice `subtotal` **and** also send `markupTotal` (double markup)
- Do not compute quote tax as `subtotal * 7%`
- Do not put quote `total` in the line `rate` — line rate = amount **without** markup
- Do not set line tax to 7% on quote invoices — footer `tax` is the fixed dollar amount

---

## Related endpoints

| Action | Method | Path |
|---|---|---|
| List invoices for lead | `GET` | `/api/leads/:leadId/invoices` |
| Get one invoice | `GET` | `/api/invoices/:invoiceId` |
| Update invoice | `PUT` | `/api/invoices/:invoiceId` |
| Quote tax prefill | `GET` | `/api/leads/:leadId/quotations/latest-approved-tax` |
| Submit for approval | `POST` | `/api/invoices/:invoiceId/submit-approval` |
| Send | `POST` | `/api/invoices/:invoiceId/send` |
