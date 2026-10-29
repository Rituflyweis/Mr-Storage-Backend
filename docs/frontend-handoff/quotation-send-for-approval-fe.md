# Quotation — Send for Approval (manual) + Admin inbox

## What was wrong

After editing milestones/estimate, Sales showed **Pending Approval** + **View Quotation**, but Admin had nothing to approve (or the wrong filter). Submit was auto-fired on create/edit, so there was no clear **Send for Approval** step after edit.

## Backend change (live after deploy)

| Event | Approval status | Sales CTA |
|-------|-----------------|-----------|
| Create quotation / from estimate (sales) | `not_submitted` | **Send for Approval** |
| Edit estimate / milestones / deposit / quotation | `not_submitted` (cancels prior pending) | **Send for Approval** again |
| `POST /api/quotations/:quotationId/submit-approval` | `pending_approval` | Waiting / View |
| Admin approve | `approved` | Send to customer |

Admin inbox:

```http
GET /api/quotations/approval/pending
```

Now **defaults** to `approval.status=pending_approval` (only waiting items).

Approve / reject unchanged:

- `PUT /api/quotations/:quotationId/approve`
- `PUT /api/quotations/:quotationId/reject`

## Sales UI mapping

| `workflowStatus` / `approvalStatus` | Badge | Primary button |
|-------------------------------------|-------|----------------|
| `draft` / `not_submitted` | Draft | **Send for Approval** → `POST .../submit-approval` |
| `pending_approval` | Pending Approval | View Quotation (wait for admin) |
| `approved` | Approved | Send to customer |
| `rejected` | Rejected | Edit → then **Send for Approval** |
| `sent` | Sent | — |

**Replace “View Quotation” with “Send for Approval”** whenever status is `not_submitted` / draft (including after milestone edit).

Submit body (optional):

```json
{ "note": "Updated milestones 40/30" }
```

Response includes updated `quotation.approval.status = pending_approval`.

After milestones save, response may include:

```json
"quotationSync": {
  "synced": true,
  "requiresSubmitForApproval": true,
  "approvalStatus": "not_submitted",
  "quotationId": "…"
}
```

Use that to show **Send for Approval** immediately.

## Admin UI

1. Call `GET /api/quotations/approval/pending` (no filter) for the approval queue.
2. Show QUO number, customer, version, submittedAt.
3. Approve / Reject from that list.

## Stuck quotes already showing Pending Approval

If an old quote is stuck `pending_approval` but Admin never saw it:

1. Sales: edit anything small **or** Admin list with `?approvalStatus=pending_approval`
2. Or Sales calls submit again (returns “already pending”)
3. Preferred: Admin uses default pending inbox after this deploy; Sales re-saves milestones → status becomes `not_submitted` → click **Send for Approval** → appears in Admin.
