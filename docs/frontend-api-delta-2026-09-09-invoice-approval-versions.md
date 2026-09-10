# Frontend API Delta — 2026-09-09 (Invoice approval versions)

This is the integration contract for the invoice approval flow that is **live on backend**.

Use this file for sales + admin invoice screens. Do not treat every `approval.history` row as a live request.

---

## Product flow (what to build)

### Sales panel

1. Sales creates an invoice. It goes to admin as **Pending Approval**. Sales cannot send it to the customer yet.
2. If sales **edits that pending invoice**, the old approval request is **cancelled** and a **new pending request** is created for the updated version. Sales does **not** need to submit again.
3. Admin still sees that invoice as waiting for approval, but only the **new version** is waiting. The old version is cancelled.
4. If admin **rejects** it, sales can edit and then **submit again** for approval.
5. If admin **approves** it and sales later **edits** it, approval is cleared. Sales must **submit again** before it can be sent.
6. Only after admin approval can sales **send** the invoice to the customer.

### Admin panel

1. Admin sees invoices waiting for approval (**one row per invoice**, not one row per history event).
2. For an invoice that was edited while pending, invoice detail should show:
   - **Old version: Cancelled**
   - **New version: Pending approval**
3. Admin can **Approve** or **Reject** only the current pending version.
4. Approve → sales can send to the customer.
5. Reject → it goes back to sales to fix and resubmit.

### Simple rule

- Edit while waiting for approval = cancel old request + new pending request automatically.
- Edit after approval or rejection = sales must submit again.

---

## Which status to use in UI

| UI badge | Field | Values |
|---|---|---|
| Invoice workflow badge | `invoiceStatus` | `draft`, `pending_approval`, `approved`, `rejected`, `sent`, `paid`, `overdue`, `cancelled` |
| Approval state | `approvalStatus` or `approval.status` | `not_submitted`, `pending_approval`, `approved`, `rejected` |
| Delivery/payment state | `paymentStatus` or `status` | `draft`, `sent`, `paid`, `overdue`, `cancelled` |
| Versioned requests (admin detail) | `approvalRequests[]` | see below |

Labels:

- `pending_approval` → Pending Approval
- `approved` → Approved
- `rejected` → Rejected
- `cancelled` (request only) → Cancelled
- `not_submitted` → Draft / needs resubmit

---

## Endpoints

Auth: sales + admin (existing common invoice routes).

| Action | Method | Path | Who |
|---|---|---|---|
| Create invoice | `POST` | `/api/leads/:leadId/invoices` | Sales / admin |
| Get invoice | `GET` | `/api/invoices/:invoiceId` | Sales / admin |
| List invoices | `GET` | `/api/invoices` | Sales / admin |
| Edit invoice | `PUT` | `/api/invoices/:invoiceId` | Sales / admin |
| Submit / resubmit | `POST` | `/api/invoices/:invoiceId/submit-approval` | Sales / admin |
| Admin pending queue | `GET` | `/api/invoices/approval/pending` | Admin only |
| Approve | `PUT` | `/api/invoices/:invoiceId/approve` | Admin only |
| Reject | `PUT` | `/api/invoices/:invoiceId/reject` | Admin only |
| Send to customer | `POST` | `/api/invoices/:invoiceId/send` | Sales / admin (must be approved) |
| Mark sent (external email) | `POST` | `/api/invoices/:invoiceId/mark-sent` | Same approval rules as send |

List shortcut for pending: `GET /api/invoices?pending=true` (same pending-approval filter).

---

## Create

`POST /api/leads/:leadId/invoices`

- **Sales create** → auto submitted. Response has `approval.status = pending_approval`. Show **Pending Approval**. Do not call submit-approval again.
- **Admin create** → auto approved. Response has `approval.status = approved`. Send is allowed.

Tax: if body `tax` is missing or `0`, backend copies tax from the latest quote on that lead. If frontend sends `tax > 0`, that value is kept.

---

## Edit (`PUT /api/invoices/:invoiceId`)

Body fields that count as an invoice edit (these bump `revision`):

`date`, `daysToPay`, `lineItems`, `description`, `subtotal`, `markupTotal`, `tax`, `discount`, `depositAmount`, `totalAmount`

### A) Invoice is pending approval

Do **not** call submit-approval after save.

After PUT:

- `approval.status` stays `pending_approval`
- `revision` increments
- `approvalRequests` has cancelled old version + current pending version

Sales UI: keep showing **Pending Approval**. Optional toast: “Previous approval request cancelled. Updated invoice sent for approval.”

### B) Invoice is approved or rejected

After PUT:

- `approval.status` becomes `not_submitted`
- Send must stay disabled
- Show **Submit for approval**

Then call:

`POST /api/invoices/:invoiceId/submit-approval`

```json
{ "note": "Please re-review the updated invoice." }
```

Optional. Then `approval.status` becomes `pending_approval` again.

---

## `approvalRequests` (use this in admin, not raw history)

Returned on invoice detail, pending queue, and decorated invoice payloads.

```json
{
  "approvalStatus": "pending_approval",
  "invoiceStatus": "pending_approval",
  "revision": 2,
  "approval": {
    "status": "pending_approval",
    "rejectionReason": "",
    "history": []
  },
  "approvalRequests": [
    {
      "status": "cancelled",
      "revision": 1,
      "submittedAt": "2026-09-09T10:00:00.000Z",
      "submittedBy": { "_id": "...", "name": "Sales User", "email": "sales@example.com", "role": "sales" },
      "note": "Invoice submitted for admin approval on create",
      "closedAt": "2026-09-09T10:20:00.000Z",
      "closedNote": "Previous approval request cancelled after edit (revision 1)",
      "current": false
    },
    {
      "status": "pending_approval",
      "revision": 2,
      "submittedAt": "2026-09-09T10:20:00.000Z",
      "submittedBy": { "_id": "...", "name": "Sales User", "email": "sales@example.com", "role": "sales" },
      "note": "New approval request after edit (revision 2)",
      "current": true
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `status` | `pending_approval` \| `cancelled` \| `approved` \| `rejected` \| `sent` |
| `revision` | Invoice version for that request |
| `current` | `true` only for the live pending request |
| `closedAt` / `closedNote` | Set when that request was cancelled / closed |

**Do not** loop `approval.history` and show every `pending_approval` event as still waiting. That is why admin previously saw two live requests.

Admin pending **list** is still one invoice. Show version history on **detail**.

---

## Admin actions

Only when `approval.status === "pending_approval"`.

Approve:

`PUT /api/invoices/:invoiceId/approve`

```json
{ "note": "Approved. Good to send." }
```

Reject (reason recommended):

`PUT /api/invoices/:invoiceId/reject`

```json
{ "reason": "Line items need correction." }
```

After reject, sales sees `approvalStatus = rejected` and `approval.rejectionReason`. Edit + `submit-approval` is required.

Disable Approve/Reject unless the request has `current: true` and `status: "pending_approval"`.

---

## Send button rules (sales)

Enable send / mark-sent only when:

- `approvalStatus === "approved"`
- and `invoiceStatus` is not `paid` / `cancelled`

Disable when:

- `pending_approval`
- `rejected`
- `not_submitted` / draft after an approved invoice was edited

If sales edits an approved invoice, backend returns `not_submitted`. Show “Submit for approval” again. Send stays off until admin approves the new revision.

Send still uses:

- `POST /api/invoices/:invoiceId/send`
- `POST /api/invoices/:invoiceId/mark-sent`

Same To / CC / message body as 2026-09-07 send delta.

---

## Sales screen checklist

| `invoiceStatus` | Badge | Edit | Submit for approval | Send |
|---|---|---|---|---|
| `pending_approval` | Pending Approval | Yes (auto new request) | Hide | Disabled |
| `approved` | Approved | Yes (clears approval) | Hide until they edit | Enabled |
| `rejected` | Rejected + reason | Yes | Show after edit | Disabled |
| `draft` / `not_submitted` | Draft / needs resubmit | Yes | Show | Disabled |
| `sent` | Sent | Limited | Hide | Hide |

After a **rejected** invoice is edited, status becomes `not_submitted`. Then show Submit.

---

## Admin screen checklist

Pending queue (`GET /api/invoices/approval/pending`):

- One card/row per invoice
- Columns: invoice number, project, amount, submitted by, submitted at, current revision
- Open detail to see `approvalRequests`

Invoice detail:

- Timeline from `approvalRequests` (newest current pending on top or bottom is fine, as long as cancelled vs pending is obvious)
- Approve / Reject only the current pending request
- Do not offer approve on a cancelled row

---

## Errors to handle

| Status | When |
|---|---|
| `400` Only pending approval invoices can be approved/rejected | Invoice is not currently pending |
| `400` Invoice must be approved by admin before sending | Send clicked too early |
| `400` Invoice was edited after approval. Please resubmit for admin approval. | Approved, then edited, then send without resubmit |
| `403` Only admin can approve/reject / view pending | Sales hit an admin-only route |
| `400` Sent/paid/cancelled invoice cannot be submitted | Wrong lifecycle |

---

## Prefill invoice tax from latest approved quote

`GET /api/leads/:leadId/quotations/latest-approved-tax`

Sales + admin. Use this on the create-invoice screen to prefill tax and quote value.

Latest = most recently **admin-approved** quotation on that lead (`approval.status = approved`).

```json
{
  "success": true,
  "data": {
    "leadId": "66d7f...",
    "quotationId": "66d8a...",
    "quoteNumber": "QUO-0010",
    "quoteValue": 241024,
    "quoteAmountIncludingTax": 241024,
    "quoteAmountMinusTax": 233178,
    "quoteAmountExcludingTax": 233178,
    "subtotal": 233178,
    "pretaxAmount": 233178,
    "tax": 7846,
    "taxRate": 7,
    "taxableBase": 112079,
    "taxNote": "Tax on materials & insulation — labor not taxed",
    "salesTax": { "amount": 7846, "rate": 7, "taxableBase": 112079, "note": "Tax on materials & insulation — labor not taxed" },
    "taxIncludedInQuoteValue": true,
    "currency": "USD",
    "approvalStatus": "approved",
    "versionNumber": 1,
    "reviewedAt": "2026-09-09T10:00:00.000Z"
  }
}
```

- `quoteValue` / `quoteAmountIncludingTax` → **tax-inclusive** quote total (what the customer was quoted)
- `quoteAmountMinusTax` / `quoteAmountExcludingTax` / `subtotal` / `pretaxAmount` → **quote amount − tax** (use this as the invoice line/subtotal)
- `tax` / `salesTax.amount` → invoice `tax` field. **Do not** compute `pretaxAmount * taxRate / 100`. Quote tax is 7% of `taxableBase` (materials + insulation), not 7% of the full pretax total. Labor is not taxed.
- `taxableBase` → amount the 7% was applied to
- `pretaxAmount + tax` === `quoteValue` (this is the check that must match)
- `taxIncludedInQuoteValue` → `true` when tax is already inside `quoteValue`
- Create invoice: if frontend sends the quote total as the line amount and `tax` is `0`/omitted, backend peels tax out of that amount instead of adding it on top. Invoice total stays the quoted amount.
- `404` if the lead has no approved quotation

---

## What did not change

- No `revoke-approval` endpoint. Cancelling the old pending request happens automatically on edit.
- Pending queue is still invoice-level, not request-level.
- Quotation approval is a separate flow. Editing an invoice does not cancel a quotation approval request.
