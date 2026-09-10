# Frontend API Delta — 2026-09-10 (Quotation approval versions)

This is the integration contract for the quotation approval flow that is **live on backend**.

It is the same product flow as invoices (`docs/frontend-api-delta-2026-09-09-invoice-approval-versions.md`). Use this file for sales + admin quotation screens. Do not treat every `approval.history` row as a live request.

Related older doc (create/send/estimate conversion still apply; **edit-while-pending is superseded here**): `docs/quotation-approval-workflow-api-2026-09-02.md`.

---

## Product flow (what to build)

### Sales panel

1. Sales creates a quotation. It goes to admin as **Pending Approval**. Sales cannot send it to the customer yet.
2. If sales **edits that pending quotation**, the old approval request is **cancelled** and a **new pending request** is created for the updated version. Sales does **not** need to submit again.
3. Admin still sees that quotation as waiting for approval, but only the **new version** is waiting. The old version is cancelled.
4. If admin **rejects** it, sales can edit and then **submit again** for approval.
5. If admin **approves** it and sales later **edits** it, approval is cleared. Sales must **submit again** before it can be sent.
6. Only after admin approval can sales **send** the quotation to the customer.

### Admin panel

1. Admin sees quotations waiting for approval (**one row per quotation**, not one row per history event).
2. For a quotation that was edited while pending, quotation detail should show:
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
| Quotation workflow badge | `workflowStatus` | `draft`, `pending_approval`, `approved`, `rejected`, `sent` |
| Approval state | `approvalStatus` or `approval.status` | `not_submitted`, `pending_approval`, `approved`, `rejected` |
| Delivery state | `status` (model) | `draft`, `sent`, `accepted`, `rejected` |
| Versioned requests (admin detail) | `approvalRequests[]` | see below |

Labels:

- `pending_approval` → Pending Approval
- `approved` → Approved
- `rejected` → Rejected
- `cancelled` (request only) → Cancelled
- `not_submitted` / `draft` → Draft / needs resubmit

Quotation versions use `versionNumber` (same role as invoice `revision`). `approvalRequests[].revision` is an alias of `versionNumber` for UIs copied from invoice.

---

## Endpoints

Auth: sales + admin (common quotation routes). Sales aliases exist for create/get/edit/send.

| Action | Method | Path | Who |
|---|---|---|---|
| Create quotation | `POST` | `/api/quotations` | Sales / admin |
| Create from estimate | `POST` | `/api/quotations/from-estimate/:estimateId` | Sales / admin |
| Get quotation | `GET` | `/api/quotations/:quotationId` | Sales / admin |
| List by lead | `GET` | `/api/leads/:leadId/quotations` | Sales / admin |
| Sales list | `GET` | `/api/sales/quotations` | Sales |
| Edit quotation | `PUT` | `/api/quotations/:quotationId` | Sales / admin |
| Submit / resubmit | `POST` | `/api/quotations/:quotationId/submit-approval` | Sales / admin |
| Admin pending / filter list | `GET` | `/api/quotations/approval/pending` | Admin only |
| Approve | `PUT` | `/api/quotations/:quotationId/approve` | Admin only |
| Reject | `PUT` | `/api/quotations/:quotationId/reject` | Admin only |
| Send to customer | `POST` | `/api/quotations/:quotationId/send` | Sales / admin (must be approved) |
| Mark sent (external email) | `POST` | `/api/quotations/:quotationId/mark-sent` | Same approval rules as send |

Sales shortcuts (same handlers):

- `POST /api/sales/quotations`
- `GET /api/sales/quotations/:quotationId`
- `PUT /api/sales/quotations/:quotationId`
- `POST /api/sales/quotations/:quotationId/send`
- `POST /api/sales/quotations/:quotationId/mark-sent`

Submit / approve / reject stay on `/api/quotations/...` (not under `/api/sales`).

Waiting-for-admin queue:

`GET /api/quotations/approval/pending?approvalStatus=pending_approval`

(This route returns all quotations unless you pass `status` / `approvalStatus`. Filter to pending for the admin inbox.)

---

## Create

`POST /api/quotations`

```json
{
  "leadId": "66d7f...",
  "buildingType": "PEMB",
  "basePrice": 36417
}
```

- **Sales create** → auto submitted. Response has `approval.status = pending_approval`. Show **Pending Approval**. Do not call submit-approval again.
- **Admin create** → auto approved. Response has `approval.status = approved`. Send is allowed.

Same for `POST /api/quotations/from-estimate/:estimateId` unless that estimate already has a quotation.

---

## Edit (`PUT /api/quotations/:quotationId`)

Only `status = draft` quotations can be edited (not yet sent). `versionNumber` increments on every save.

### A) Quotation is pending approval

Do **not** call submit-approval after save.

After PUT:

- `approval.status` stays `pending_approval`
- `versionNumber` increments
- `approvalRequests` has cancelled old version + current pending version
- `approval.history` is **newest first**

Sales UI: keep showing **Pending Approval**. Optional toast: “Previous approval request cancelled. Updated quotation sent for approval.”

### B) Quotation is approved or rejected

After PUT:

- `approval.status` becomes `not_submitted`
- Send must stay disabled
- Show **Submit for approval**

Then call:

`POST /api/quotations/:quotationId/submit-approval`

```json
{ "note": "Please re-review the updated quotation." }
```

Optional. Then `approval.status` becomes `pending_approval` again.

---

## `approvalRequests` (use this in admin, not raw history)

Returned on quotation detail, pending list, lead list, and decorated quotation payloads.

```json
{
  "approvalStatus": "pending_approval",
  "workflowStatus": "pending_approval",
  "versionNumber": 2,
  "approval": {
    "status": "pending_approval",
    "rejectionReason": "",
    "history": []
  },
  "approvalRequests": [
    {
      "status": "pending_approval",
      "versionNumber": 2,
      "revision": 2,
      "submittedAt": "2026-09-10T10:20:00.000Z",
      "submittedBy": { "_id": "...", "name": "Sales User", "email": "sales@example.com", "role": "sales" },
      "note": "New approval request after edit (version 2)",
      "current": true
    },
    {
      "status": "cancelled",
      "versionNumber": 1,
      "revision": 1,
      "submittedAt": "2026-09-10T10:00:00.000Z",
      "submittedBy": { "_id": "...", "name": "Sales User", "email": "sales@example.com", "role": "sales" },
      "note": "Quotation submitted for admin approval on create",
      "closedAt": "2026-09-10T10:20:00.000Z",
      "closedNote": "Previous approval request cancelled after edit (version 1)",
      "current": false
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `status` | `pending_approval` \| `cancelled` \| `approved` \| `rejected` \| `sent` |
| `versionNumber` / `revision` | Quotation version for that request |
| `current` | `true` only for the live pending request |
| `closedAt` / `closedNote` | Set when that request was cancelled / closed |

Arrays are **newest first**.

**Do not** loop `approval.history` and show every `pending_approval` event as still waiting.

Admin pending **list** is still one quotation. Show version history on **detail**.

---

## Admin actions

Only when `approval.status === "pending_approval"`.

Approve:

`PUT /api/quotations/:quotationId/approve`

```json
{ "note": "Approved. Good to send." }
```

Reject (reason required):

`PUT /api/quotations/:quotationId/reject`

```json
{ "reason": "Update dimensions and resubmit." }
```

After reject, sales sees `approvalStatus = rejected` and `approval.rejectionReason`. Edit + `submit-approval` is required.

Disable Approve/Reject unless the request has `current: true` and `status: "pending_approval"`.

---

## Send button rules (sales)

Enable send / mark-sent only when:

- `approvalStatus === "approved"`
- and quotation `status` is not already `sent`

Disable when:

- `pending_approval`
- `rejected`
- `not_submitted` / draft after an approved quotation was edited

If sales edits an approved quotation, backend returns `not_submitted`. Show “Submit for approval” again. Send stays off until admin approves the new `versionNumber`.

Send still uses:

- `POST /api/quotations/:quotationId/send`
- `POST /api/quotations/:quotationId/mark-sent`

Same To / CC / message body as `docs/frontend-api-delta-2026-09-07-send-and-mark-sent.md`.

---

## Sales screen checklist

| `workflowStatus` | Badge | Edit | Submit for approval | Send |
|---|---|---|---|---|
| `pending_approval` | Pending Approval | Yes (auto new request) | Hide | Disabled |
| `approved` | Approved | Yes (clears approval) | Hide until they edit | Enabled |
| `rejected` | Rejected + reason | Yes | Show after edit | Disabled |
| `draft` / `not_submitted` | Draft / needs resubmit | Yes | Show | Disabled |
| `sent` | Sent | No | Hide | Hide |

After a **rejected** quotation is edited, status becomes `not_submitted`. Then show Submit.

---

## Admin screen checklist

Pending queue (`GET /api/quotations/approval/pending?approvalStatus=pending_approval`):

- One card/row per quotation
- Columns: quote number, project, amount, submitted by, submitted at, current `versionNumber`
- Open detail to see `approvalRequests`

Quotation detail:

- Timeline from `approvalRequests` (**newest first**)
- Approve / Reject only the current pending request
- Do not offer approve on a cancelled row

---

## Errors to handle

| Status | When |
|---|---|
| `400` Only pending approval quotations can be approved/rejected | Quotation is not currently pending |
| `400` Quotation must be approved by admin before sending | Send clicked too early |
| `400` Quotation was edited after approval. Please resubmit for admin approval. | Approved, then edited, then send without resubmit |
| `400` Only draft quotations can be edited | Quotation already sent |
| `403` Only admin can approve/reject / view pending | Sales hit an admin-only route |
| `400` Sent quotation cannot be submitted | Wrong lifecycle |
| `400` Rejection reason is required | Reject without `reason` |

---

## What did not change

- No `revoke-approval` endpoint. Cancelling the old pending request happens automatically on edit.
- Pending queue is still quotation-level, not request-level.
- Invoice approval is a separate flow. Editing a quotation does not cancel an invoice approval request.
- Sales create still auto-submits. Admin create still auto-approves.
- Send still requires `approval.status = approved` and `approvedVersionNumber === versionNumber`.
