# Lead List Socket Events - Frontend Guide

This guide explains the new lead list realtime events for `/admin` namespace.

These events are for both admin and sales clients, and are meant to keep lead
tables updated without doing a full refetch after every backend mutation.

---

## 1) Namespace and Auth

- Namespace: `/admin`
- Auth required: JWT in `auth.token`

```js
const socket = io(`${API_BASE}/admin`, {
  transports: ['websocket'],
  auth: { token: accessToken },
})
```

---

## 2) New Events

### `lead_list_created`

Server emits when a new lead is created and should appear in list UIs.

Common triggers:
- `POST /api/public/chat/init` (new lead created)
- `POST /api/admin/leads`
- `POST /api/sales/leads`

---

### `lead_list_updated`

Server emits when an existing lead row should be refreshed.

Common triggers:
- AI scoring updates
- assignment (auto/manual/reassign)
- lifecycle changes
- lead edit
- quote-ready transitions
- temperature updates
- chat end/reopen
- PO raised
- budget updates
- terminate lead

---

## 3) Audience Routing

- Admin users receive updates in `admin_room`.
- Sales users receive updates in `user:{salesId}` room for assigned leads.

Notes:
- Unassigned leads are visible to admin via events, but not pushed to sales.
- Once assigned, sales starts receiving `lead_list_updated` for that lead.

---

## 4) Payload Contract

Both events share this envelope:

```ts
type LeadListSocketPayload = {
  leadId: string
  lead: Record<string, any>       // row object for that user type
  scoreRow?: Record<string, any> | null
  meta: {
    action: 'created' | 'updated'
    trigger: string               // mutation source
  }
}
```

### `meta.trigger` values currently used

- `chat_init`
- `admin_create_lead`
- `sales_create_lead`
- `admin_create_project`
- `ai_scoring`
- `quote_ready`
- `assigned`
- `escalation_reassign`
- `temperature`
- `lifecycle`
- `lead_edited`
- `po_raised`
- `budget`
- `terminated`
- `chat_lifecycle`

---

## 5) Lead Row Shape by Receiver

The backend sends a row shape that matches each side's list API format.

### 5.1 Admin receiver shape (`admin_room`)

Matches row style from `GET /api/admin/leads`:
- full lead document (`customerId`, `assignedSales`, lifecycle, score, etc.)
- `jobId` and `projectId`
- `budget` object included if available
- includes chat flags (`isChatEnded`, `chatEndedAt`, etc.)

### 5.2 Sales receiver shape (`user:{salesId}`)

Matches row style from `GET /api/sales/leads`:
- `_id`, `jobId`, `projectId`, `projectName`
- `customerId: { _id, firstName, email }`
- `lifecycleStatus`, `quoteValue`, `leadScoring.score`
- `buildingType`, `location`, `isRaisedToPO`
- `nextFollowUp` (pending earliest follow-up or `null`)

### 5.3 `scoreRow` (optional)

For score-specific UIs (`/leads/by-score`) the payload may include `scoreRow`
matching `mapLeadByScoreRow` structure. This is included on scoring-sensitive
updates (for example `ai_scoring`, `temperature`, `quote_ready`, `lifecycle`).

---

## 6) Frontend Integration Pattern

Use upsert-by-id for both created and updated events.

```ts
function upsertLeadRow(list: any[], row: any) {
  const idx = list.findIndex((x) => String(x._id) === String(row._id))
  if (idx === -1) return [row, ...list]
  const next = [...list]
  next[idx] = row
  return next
}
```

Recommended listeners:

```js
socket.on('lead_list_created', ({ lead, scoreRow, meta }) => {
  setLeads((prev) => upsertLeadRow(prev, lead))
  if (scoreRow) upsertScoreBoard(scoreRow)
})

socket.on('lead_list_updated', ({ lead, scoreRow, meta }) => {
  setLeads((prev) => upsertLeadRow(prev, lead))
  if (scoreRow) upsertScoreBoard(scoreRow)
})
```

---

## 7) Backward Compatibility

Legacy events such as `new_lead`, `lead_score_updated`, and `lead_assigned`
still exist for now in some flows, but frontend should migrate to:

- `lead_list_created`
- `lead_list_updated`

These two events are the stable source for list refresh behavior.

---

## 8) Reconnect Behavior

Socket events are incremental. On reconnect:
- re-subscribe normally (Socket.IO reconnect does this)
- refetch active list endpoint once (`GET /api/admin/leads` or `GET /api/sales/leads`)
- continue applying incremental socket updates

---

## 9) QA Checklist

- New chat lead appears in admin list without refresh.
- AI scoring changes update score in admin list and score board.
- When lead is assigned, assigned sales user receives row update.
- Sales lifecycle change updates both admin and assigned sales list rows.
- End/reopen chat updates `isChatEnded` state in list row.
- PO raise updates `isRaisedToPO` and lifecycle row values.

