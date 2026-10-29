# Quotation — single status key for Sales + Admin FE

**Date:** 29 Oct 2026  
**Panels:** Sales Quoting + Admin quotation approval  
**Auth:** `Authorization: Bearer <token>`

---

## Single key (use globally)

**Use only: `quotation.workflowStatus`**

Do **not** drive badges / primary CTAs from:

- `quotation.status`
- `quotation.approval.status`
- `quotation.approvalStatus`

Those still exist on the API for storage / filters; **`workflowStatus` is the UI source of truth**.

---

## Enum (final)

```text
draft
pending_approval
approved
admin_rejected
sent
accepted
client_rejected
```

```ts
type QuotationWorkflowStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'admin_rejected'
  | 'sent'
  | 'accepted'
  | 'client_rejected'
```

| Value | Meaning | Typical CTA |
|-------|---------|-------------|
| `draft` | Not submitted, or reopened after edit | **Send for Approval** |
| `pending_approval` | Waiting on admin | View / wait |
| `approved` | **Admin** approved (OK to send to client) | Send to customer |
| `admin_rejected` | **Admin** rejected approval | Edit → Send for Approval |
| `sent` | Sent to customer | Wait for client |
| `accepted` | **Client** accepted | Next project steps |
| `client_rejected` | **Client** rejected | Revise / follow up → edit → Send for Approval |

**Important**

- `approved` ≠ `accepted` (admin vs client).
- `admin_rejected` ≠ `client_rejected` (separate enums — no shared `rejected` on `workflowStatus`).

---

## Example response shape

```json
{
  "success": true,
  "data": {
    "quotation": {
      "_id": "…",
      "quoteNumber": "QUO-0024",
      "status": "draft",
      "approval": { "status": "not_submitted" },
      "approvalStatus": "not_submitted",
      "workflowStatus": "draft",
      "versionNumber": 2
    },
    "requiresSubmitForApproval": true
  }
}
```

Bind badge + button to **`data.quotation.workflowStatus`**.

---

## End-to-end flow

```text
draft
  → POST …/submit-approval
pending_approval
  → Admin approve → approved  → send → sent → client accept → accepted
                                            → client reject → client_rejected
  → Admin reject  → admin_rejected → edit → draft → submit again
```

Any **estimate / milestones / deposit / quotation edit** (sales) resets approval → **`workflowStatus: "draft"`** again (must **Send for Approval** manually).

---

## Sales panel APIs

| Action | Method / path |
|--------|----------------|
| Create / from estimate | `POST /api/quotations`, `POST /api/quotations/from-estimate/:estimateId` |
| Get / update | `GET|PUT /api/quotations/:quotationId` |
| Submit for approval | `POST /api/quotations/:quotationId/submit-approval` |
| Send / mark sent | `POST …/send`, `POST …/mark-sent` (requires admin **approved**) |
| Stats | `GET /api/sales/quotations/stats` (or common stats) |

### Sales UI map

| `workflowStatus` | Badge | Primary button |
|------------------|-------|----------------|
| `draft` | Draft | **Send for Approval** |
| `pending_approval` | Pending Approval | View Quotation |
| `approved` | Approved | Send to customer |
| `admin_rejected` | Admin rejected | Edit → Send for Approval |
| `sent` | Sent | — |
| `accepted` | Accepted | Next steps |
| `client_rejected` | Client rejected | Edit → Send for Approval |

Submit body (optional):

```json
{ "note": "Updated milestones 40/30" }
```

### After milestones / deposit / estimate save

```json
"quotationSync": {
  "synced": true,
  "requiresSubmitForApproval": true,
  "approvalStatus": "not_submitted",
  "workflowStatus": "draft",
  "quotationId": "…"
}
```

`quotationSync.workflowStatus` uses the **same** mapper as `quotation.workflowStatus`.  
If `requiresSubmitForApproval` or `workflowStatus === "draft"` → show **Send for Approval**.

---

## Admin panel APIs

| Action | Method / path |
|--------|----------------|
| Approval inbox | `GET /api/quotations/approval/pending` (defaults to waiting items) |
| Approve | `PUT /api/quotations/:quotationId/approve` |
| Reject | `PUT /api/quotations/:quotationId/reject` |

Inbox rows: use **`workflowStatus`** when present (`pending_approval` while waiting).

After approve → Sales sees `approved`.  
After reject → Sales sees `admin_rejected`.

---

## Customer (for Sales/Admin badges)

| Action | Resulting `workflowStatus` |
|--------|----------------------------|
| Customer accepts quote | `accepted` |
| Customer rejects quote | `client_rejected` |

---

## Other keys (do not use for global UI)

| Key | What it is |
|-----|------------|
| `quotation.status` | Document: `draft` \| `sent` \| `accepted` \| `rejected` |
| `approval.status` / `approvalStatus` | Admin pipeline: `not_submitted` \| `pending_approval` \| `approved` \| `rejected` |

Backend already maps those → **`workflowStatus`**.

---

## FE checklist (Sales + Admin)

- [ ] One source of truth: **`workflowStatus`**
- [ ] Full enum including **`admin_rejected`**, **`client_rejected`**, **`accepted`**
- [ ] Replace “View Quotation” with **Send for Approval** when `draft`
- [ ] After edit/sync, re-read `workflowStatus` (expect `draft`)
- [ ] Admin inbox from `GET …/approval/pending`
- [ ] Do not conflate `approved` with `accepted`
