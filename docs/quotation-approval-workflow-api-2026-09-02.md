# Quotation Approval Workflow API (Before Client Send)

This document defines the quotation approval flow for frontend integration.

It applies to quotations created from your quoting process (including data extracted from XLSX/PDF flows) before the quotation is sent to the customer.

Related docs:

- `docs/estimate-to-quotation-conversion-api-2026-09-03.md`
- `docs/estimate-history-conversion-redirect-api-2026-09-03.md` (how estimate history knows converted quotation + redirect id)

## Objective

- Sales can create/edit quotations.
- Sales cannot send quotation to customer until admin approval.
- Admin can approve/reject quotations.
- If quotation changes after approval, it must be re-submitted.

---

## Enum Reference (Frontend)

- `quotation.status`: `draft | sent | accepted | rejected`
- `quotation.approval.status`: `not_submitted | pending_approval | approved | rejected`
- `quotation.workflowStatus` (computed): `draft | pending_approval | approved | rejected | sent`
- `quotation.approval.history[].status`: `not_submitted | pending_approval | approved | rejected | sent`
- `quotation.priorityLevel`: `low | medium | high | urgent`
- `quotation.insulation[].insulationType`: `roof | wall`
- `quotation.doors[].doorCategory`: `rolling | personnel`
- `send response data.emailProvider`: `sendgrid | smtp_fallback | smtp_fallback_alt_port`

---

## Quotation Fields Added

Quotation now includes:

- `approval.status`: `not_submitted | pending_approval | approved | rejected`
- `approval.submittedBy`, `approval.submittedAt`
- `approval.reviewedBy`, `approval.reviewedAt`
- `approval.rejectionReason`
- `approval.approvedVersionNumber`
- `approval.history[]` with `{ status, note, by, at }`
- `workflowStatus` (computed response field): `draft | pending_approval | approved | rejected | sent`

Existing `versionNumber` is used for stale-approval protection.

---

## Endpoint Summary

Base: `/api/quotations`

If your UI flow starts from estimate APIs (`/api/sales/estimates/*`), first convert estimate into a quotation record using:

`POST /api/quotations/from-estimate/:estimateId`

Then continue approval/send flow with the returned `quotationId`.

### Create quotation

`POST /api/quotations`

Behavior:
- Sales-created quotation -> auto `pending_approval`
- Admin-created quotation -> auto `approved`

---

### Submit for approval

`POST /api/quotations/:quotationId/submit-approval`

Body (optional):

```json
{
  "note": "Please review this quote",
  "estimateId": "66f1a9...",
  "leadId": "66f1b2..."
}
```

Shortcut behavior:

- If `:quotationId` is not found but matches an `EstimateQuote` id, backend auto-creates quotation from estimate and submits in same call.
- You can also pass `estimateId` in body for the same single-call behavior.
- If estimate has no `leadId`, pass `leadId` in body (or keep `estimate.jobNumber` equal to `Lead.jobId`) so conversion can resolve lead.

---

### Approve quotation (admin only)

`PUT /api/quotations/:quotationId/approve`

Body (optional):

```json
{ "note": "Approved for customer send" }
```

Rules:
- only when `approval.status = pending_approval`
- sets `approvedVersionNumber = versionNumber`

---

### Reject quotation (admin only)

`PUT /api/quotations/:quotationId/reject`

Body:

```json
{ "reason": "Update dimensions and resend" }
```

Rules:
- only when `approval.status = pending_approval`

---

### Pending approvals list (admin only)

`GET /api/quotations/approval/pending`

Optional query:
- `leadId`

---

### Send quotation (existing endpoint with new gate)

`POST /api/quotations/:quotationId/send`

Now blocked unless:
- `approval.status = approved`
- `approval.approvedVersionNumber === versionNumber`

If changed after approval, API returns error asking to re-submit.

On successful send, response includes:
- `data.emailProvider` -> `sendgrid` or `smtp_fallback` or `smtp_fallback_alt_port` (provider used for delivery attempt).

---

## Edit Behavior

`PUT /api/quotations/:quotationId`

When edited:
- `versionNumber` increments
- if approval was `pending_approval/approved/rejected`, it resets to `not_submitted`
- sales must submit again via `submit-approval`

---

## Response Behavior for Frontend

Use `workflowStatus` for UI badge and button state:

- `draft`: can edit and submit
- `pending_approval`: waiting for admin
- `approved`: send enabled
- `rejected`: show rejection reason; edit + resubmit
- `sent`: completed

Single quotation responses now also include:

- `approvalStatus` (alias of `approval.status`)
- `sourceEstimate` (when quotation was created from estimate)
- `documentMeta` (where to regenerate preview/PDF)

Use:

- `GET /api/quotations/:quotationId?includeEstimate=true&includeDocuments=true`

Approval user refs are populated on read/list endpoints:

- `approval.submittedBy` -> `{ _id, name, email, role }`
- `approval.reviewedBy` -> `{ _id, name, email, role }`
- `approval.history[].by` -> `{ _id, name, email, role }` (or `null`)

---

## Suggested UI Logic

- Disable **Send** button unless `workflowStatus === "approved"`.
- Show rejection message from `approval.rejectionReason` when rejected.
- Show timeline from `approval.history`.
- On edit success, if status changes to `not_submitted`, show CTA: **Submit for Approval**.

---

## Audit Trail

New audit actions:
- `quotation.submitted_for_approval`
- `quotation.approved`
- `quotation.approval_rejected`

These are in addition to existing quotation create/edit/send/delete actions.
