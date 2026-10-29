# Plant — Drawing approve / revision notifications + sockets

**Date:** 29 Oct 2026  
**Issue:** Customer approved / sent-for-revision on Project Drawings, but Plant Notifications → **Drawing** was empty and no real-time popup. Assign-to-plant toast was also unreliable (socket only, no inbox row).

---

## Root cause

Customer `approve` / `request-revision` only called `notifyLeadOwner` → **sales** user. Plant assignees never got a `Notification` row (`type: "drawing"`) and no socket was emitted to `user:{plantUserId}`.

---

## Backend fix (after deploy)

When customer approves or requests revision on a drawing/photo:

1. **In-app notification** created for every **plant user assigned** on that lead (`POOrder.assignedTo`, status `approved`), `type: "drawing"`.
2. Sales owner still notified (unchanged).
3. Socket emits on `/admin` → room `user:{plantUserId}`:

| Event | When |
|-------|------|
| `drawing_revision_requested` | Customer sent for revision |
| `drawing_approved` | Customer approved |
| `drawing_status_updated` | Both (same payload family) |
| `notification` / `new_notification` | Any staff in-app notify (including these) |

### Example — revision socket payload

```json
{
  "leadId": "66f0…",
  "documentId": "6710…",
  "status": "rejected",
  "revisionRequired": true,
  "name": "Screenshot 2026-10-29…",
  "note": "Please fix dimensions",
  "source": "plant_building",
  "buildingNumber": 1
}
```

Approve: `status: "approved"`, no `revisionRequired` / `note` required.

### Example — `notification` / `new_notification`

```json
{
  "_id": "…",
  "title": "Drawing revision requested",
  "body": "Customer requested a revision on Screenshot…: \"…\"",
  "type": "drawing",
  "priority": "high",
  "leadId": "66f0…",
  "refId": "6710…",
  "refModel": "DrawingDocument",
  "isRead": false,
  "createdAt": "…"
}
```

List API: `GET /api/notifications?type=drawing` (plant token) — rows now appear after customer action.

---

## Project assign popup

On PO assign / approve-and-assign:

- Still emits `project_assigned` to `user:{assignedTo}`.
- **Also** creates an in-app notification (`type: "system"`, priority `high`) and emits `notification` / `new_notification`.

```json
// project_assigned
{ "leadId": "…", "poOrderId": "…", "projectName": "Warehouse A", "jobId": "2026241" }
```

---

## FE wiring (Plant)

1. Connect Socket.IO to **`/admin`** with plant Bearer token (auto-joins `user:{id}`).
2. Listen:
   - `drawing_revision_requested` → toast “Revision required” + refresh drawings / open project
   - `drawing_approved` → toast “Drawing approved”
   - `project_assigned` → toast + refresh projects list/stats
   - `notification` or `new_notification` → bump bell badge / prepend inbox row
3. Notifications page **Drawing** filter: `GET /api/notifications?type=drawing`.

**Note:** Plant only receives alerts if the project has an **approved PO assigned** to that plant user. Unassigned projects will not notify plant.
