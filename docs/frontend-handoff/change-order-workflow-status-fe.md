# Change Order — workflow & status keys (FE handoff)

## Summary

**Change Order is gated on the COG estimate, not on quotation “sent”.**

`POST /api/sales/change-orders` succeeds only when:

```text
EstimateQuote.status === "final"
```

If the quotation was **sent** or **approved** but the estimate is still **`draft`**, the API returns:

```text
Change orders are only allowed after the estimate is final (client contract issued). Edit the draft quote to change price instead.
```

That is **intentional validation**, not a server bug.

**Update (auto-finalize):** Linked `EstimateQuote.status` becomes **`final`** when the quotation is **customer accepted**, **sent**, or **admin approved** (`approval.status === "approved"`). That runs on admin approve / send, customer accept, `GET /api/sales/estimates/:id`, and **`POST /api/sales/change-orders`** (sync before create).

---

## Two different “quotes”

| Layer | Model | Purpose |
|--------|--------|---------|
| **COG estimate** | `EstimateQuote` | Storage / PEMB quoting tool, pricing, COs |
| **Sales quotation** | `Quotation` | Convert, admin approval, email to customer |

They have **different** status fields. Do not use quotation `sent` alone to enable Change Order.

---

## Status keys (reference)

### Estimate (controls Change Order)

| Field | Where | Values | Use for CO UI? |
|--------|--------|--------|----------------|
| **`status`** | `EstimateQuote` | **`draft`**, **`final`** | **Yes — must be `final`** |

Load:

```http
GET /api/sales/estimates/:estimateId
```

```js
const canChangeOrder =
  estimate.status === 'final' ||
  estimate.conversion?.quotationStatus === 'accepted'
```

After accept (or GET estimate sync), **`estimate.status`** should be **`final`** — prefer that for the CO button and before `POST /change-orders`.

### Quotation (send / approval — not CO gate)

| Field | Where | Values | Use for CO UI? |
|--------|--------|--------|----------------|
| `status` | `Quotation` | `draft`, `sent`, `accepted`, `rejected` | No |
| `approval.status` | `Quotation.approval` | `not_submitted`, `pending_approval`, `approved`, `rejected`, `sent`, `cancelled` | No |

On estimate GET, linked quotation is exposed as **`estimate.conversion`**:

| Field | Meaning |
|--------|---------|
| `conversion.quotationStatus` | `Quotation.status` |
| `conversion.approvalStatus` | `Quotation.approval.status` |
| `conversion.workflowStatus` | Combined label for sales UI |
| `conversion.isConvertedToQuotation` | Whether a `Quotation` exists |

Use these for **send / approve / list badges** — **not** for enabling `POST /change-orders`.

---

## Product workflow

```text
1. Build quote          → estimate.status = "draft"     → edit price in quote tool (no CO)
2. Convert + send       → quotation.status = "sent"     → still NOT enough for CO
3. Customer accepts     → quotation.status = "accepted" → estimate auto-**final** (backend)
4. POST change-orders   → CO document + revised contract total on estimate
```

### Finalize estimate (manual fallback)

Usually **not needed** after customer **accept**. Use if quotation was accepted before auto-finalize shipped, or no linked quotation:

While estimate is still **`draft`**:

```http
POST /api/sales/estimates/:estimateId/finalize
Authorization: Bearer <token>
```

Or:

```http
PUT /api/sales/estimates/:estimateId
Content-Type: application/json

{ "status": "final" }
```

After `final`, the estimate is **no longer editable** via normal draft PUT (by design). Price changes go through **change orders**.

### Create change order (step 4)

```http
POST /api/sales/change-orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "estimateId": "<EstimateQuote _id>",
  "description": "Scope change …",
  "amount": 2000,
  "cost": 1500
}
```

Preview math only (no save):

```http
POST /api/sales/change-orders/preview
```

---

## FE checklist

- [ ] **Show / enable Change Order** when `estimate.status === 'final'`, not when `quotation.status === 'sent'`.
- [ ] On **“Contract issued” / “Client agreed”** (your product moment), call **`POST …/finalize`** (or PUT `status: "final"`), then allow CO.
- [ ] Pass **`estimateId`** on `POST /change-orders` (preferred). `parentQuoteRef` only hits quote library — no estimate price sync.
- [ ] On CO **400** with draft estimate, read `errors.finalize` (deploy **`8d97825`+**) for finalize path hints.
- [ ] **Print / PDF**: use `GET /api/sales/change-orders/:coId/document` — see `change-order-print-pdf-fe.md`.

---

## Quick answers for stakeholders

| Question | Answer |
|----------|--------|
| Quotation already **sent** — why CO fails? | Estimate is still **`draft`**. Finalize first. |
| Which **status key** for the button? | **`estimate.status === 'final'`** |
| Draft quote price change? | Edit estimate / recompute — **no** change order |
| After customer signs? | **Finalize** estimate → then change orders |

---

## Related docs

- `change-order-deposit-preview-fe.md` — CO math, deposit, milestones  
- `change-order-print-pdf-fe.md` — client-style CO HTML/PDF from API  
