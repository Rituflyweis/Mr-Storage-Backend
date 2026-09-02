# Invoice Approval Workflow API (Sales -> Admin -> Customer)

This document is for frontend integration of the new invoice approval workflow.

## Goal

- Sales can create invoices.
- Sales cannot send invoice to customer until admin approval.
- Admin can approve/reject.
- UI can show clear workflow states: `pending_approval`, `approved`, `rejected`, `sent`.

---

## Data Contract (invoice fields)

The invoice now includes:

- `revision` (number): increments when editable invoice body fields change.
- `approval` (object):
  - `status`: `not_submitted | pending_approval | approved | rejected`
  - `submittedBy`, `submittedAt`
  - `reviewedBy`, `reviewedAt`
  - `rejectionReason`
  - `approvedRevision`
  - `history[]`: ordered timeline events with `{ status, note, by, at }`
- `workflowStatus` (computed in API responses):
  - `sent` if invoice `status === sent`
  - otherwise mirrors approval flow (`pending_approval`, `approved`, `rejected`, `draft`)

---

## Endpoint Changes

Base routes are under:

- `/api/invoices/*` (with existing auth guard)

### 1) Submit for approval

`POST /api/invoices/:invoiceId/submit-approval`

Body (optional):

```json
{ "note": "Please review this invoice." }
```

Behavior:
- Allowed for scoped sales/admin users.
- Sets `approval.status = pending_approval`.

---

### 2) Approve invoice (admin only)

`PUT /api/invoices/:invoiceId/approve`

Body (optional):

```json
{ "note": "Approved. Good to send." }
```

Behavior:
- Admin only.
- Only works when `approval.status = pending_approval`.
- Sets `approval.status = approved`, `approvedRevision = revision`.

---

### 3) Reject invoice (admin only)

`PUT /api/invoices/:invoiceId/reject`

Body:

```json
{ "reason": "Line items need correction." }
```

Behavior:
- Admin only.
- Only works when `approval.status = pending_approval`.
- Sets `approval.status = rejected` with rejection reason.

---

### 4) Pending approval queue (admin only)

`GET /api/invoices/approval/pending`

Returns invoices currently awaiting admin action.

---

### 5) Send invoice (existing route, new guard)

`POST /api/invoices/:invoiceId/send`

New rule:
- blocked unless `approval.status = approved`
- blocked if invoice was edited after approval (`approvedRevision !== revision`)

---

## Create / Edit Rules

### Create invoice (`POST /api/leads/:leadId/invoices`)

- If created by **sales**: auto-submitted with `approval.status = pending_approval`.
- If created by **admin**: auto-approved with `approval.status = approved`.

### Update invoice (`PUT /api/invoices/:invoiceId`)

When editable fields are changed:
- `revision` increments.
- If approval is `pending_approval`, `approved`, or `rejected`, approval resets to `not_submitted`.
- Sales should submit again using `submit-approval`.

---

## Frontend Recommended UX

For sales:
1. Create invoice -> show `Pending Approval`.
2. Disable send button until status is `Approved`.
3. If status `Rejected`, show `rejectionReason`, allow edit + resubmit.

For admin:
1. Pending queue page from `GET /approval/pending`.
2. Invoice detail actions:
   - Approve
   - Reject (reason required)

---

## Status Mapping for UI Labels

- `draft` (workflowStatus)
- `pending_approval` -> "Pending Approval"
- `approved` -> "Approved"
- `rejected` -> "Rejected"
- `sent` -> "Sent"

---

## Notes

- Existing financial status (`draft/sent/paid/overdue/cancelled`) is preserved for backward compatibility.
- Approval flow is tracked in `approval.*` and `workflowStatus`.
