# Soft Delete Lead API — Frontend Handover

## Overview

Leads/projects can be **soft deleted**. The record stays in the database but is hidden from all normal list/detail APIs.

This is **not** the same as **Terminate Lead** (`PUT /terminate`), which marks a lead as terminated with a reason but still keeps it listable (e.g. terminated list).

---

## Endpoint

| Item | Value |
|------|--------|
| **Method** | `DELETE` |
| **URL** | `/api/admin/leads/:leadId` |
| **Auth** | Bearer access token (Admin only) |
| **Role** | `admin` |

### Path params

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `leadId` | MongoDB ObjectId | Yes | Lead / project ID |

### Request body

None.

### Example request

```http
DELETE /api/admin/leads/6a6b432a3d83e59de3d6edaa
Authorization: Bearer <admin_access_token>
```

---

## Success response

**Status:** `200 OK`

```json
{
  "success": true,
  "message": "Lead deleted successfully",
  "data": {
    "lead": {
      "_id": "6a6b432a3d83e59de3d6edaa",
      "jobId": "PRO-012",
      "projectId": "PRO-012",
      "projectName": "Example Project",
      "customerId": "...",
      "isDeleted": true,
      "deletedAt": "2026-08-01T13:45:00.000Z",
      "deletedBy": "64f1a2b3c4d5e6f789012345",
      "...": "other lead fields"
    }
  }
}
```

### Soft-delete fields on the lead

| Field | Type | Description |
|-------|------|-------------|
| `isDeleted` | `boolean` | `true` after delete |
| `deletedAt` | `ISO date` | When it was deleted |
| `deletedBy` | `ObjectId` | Admin user who deleted it |

---

## Error responses

| Status | When | Example message |
|--------|------|-----------------|
| `401` | Missing / invalid token | Unauthorized |
| `403` | Non-admin user | Forbidden |
| `404` | Lead does not exist **or** already soft-deleted | Lead not found |

```json
{
  "success": false,
  "message": "Lead not found"
}
```

---

## Frontend behaviour (required)

1. Call `DELETE /api/admin/leads/:leadId` from Admin panel only.
2. On **success**:
   - Remove the lead/project from the current list/table/UI state.
   - If the user is on that lead’s detail page, navigate away (e.g. back to leads list).
3. On **404**: treat as already gone — refresh list / show “Lead not found”.
4. Do **not** send a body or `reason` (unlike terminate).

### Suggested UX

- Confirm dialog: “Delete this project? This will hide it from all lists.”
- Prefer wording like **Delete** / **Remove**, not “Terminate” (terminate is a different API).

---

## What happens after delete

- Lead is **hidden** from:
  - Admin lead lists / stats / score lists
  - Sales lead lists
  - Plant project lists
  - Customer portal project lists
  - Lookups, dashboards, exports, etc.
- Lead **detail** (`GET .../leads/:leadId/detail`) returns **404**.
- Project name can be reused for a new lead on the same customer.
- Related data (invoices, quotes, etc.) is **not** hard-deleted; only the lead is soft-hidden.

---

## Realtime (Socket.IO)

Namespace: `/admin`

Event: `lead_list_updated`

Emitted to:
- `admin_room`
- Assigned sales user room (`user:<salesUserId>`), if the lead had an assignee

### Payload shape

```json
{
  "leadId": "6a6b432a3d83e59de3d6edaa",
  "lead": {
    "_id": "6a6b432a3d83e59de3d6edaa",
    "isDeleted": true,
    "projectName": "Example Project",
    "...": "..."
  },
  "scoreRow": null,
  "meta": {
    "action": "deleted",
    "trigger": "deleted"
  }
}
```

### Frontend socket handling

When `meta.action === 'deleted'` **or** `meta.trigger === 'deleted'` **or** `lead.isDeleted === true`:

- Remove that `leadId` from any open lead/project lists.
- Close detail view if it matches that lead.

---

## Difference vs Terminate

| | Soft delete | Terminate |
|--|-------------|-----------|
| **Endpoint** | `DELETE /api/admin/leads/:leadId` | `PUT /api/admin/leads/:leadId/terminate` |
| **Body** | None | `{ "reason": "..." }` (required) |
| **Still in lists?** | No | Yes (incl. terminated list) |
| **Detail accessible?** | No (404) | Yes |
| **Flag** | `isDeleted: true` | `isTerminated: true` |

---

## Notes for FE

- Existing leads without `isDeleted` in DB behave as **not deleted** (`false`).
- No restore/undelete API is available yet.
- Sales / Plant panels do **not** have a delete endpoint; Admin only.
