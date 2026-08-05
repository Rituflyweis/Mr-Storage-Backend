# End Chat — Frontend Integration Guide

This document describes how to integrate **ending and reopening** a lead’s realtime chat across the **customer widget**, **sales panel**, and **admin panel**.

**Related:** [sales_lead_chat_integration.md](./sales_lead_chat_integration.md) (base chat setup).

---

## 1. What “end chat” means

When staff **ends** a chat for a lead:

| Who | Can send messages? | Can read history? |
|-----|-------------------|-------------------|
| Customer | No | Yes |
| Sales (assigned) | No | Yes |
| Admin | No | Yes |

- State is stored on the **Lead** document as `isChatEnded: true`.
- **Reopen** sets `isChatEnded: false` and restores sending for everyone.
- This is **independent** of `isTerminated` (project termination). A project can stay active while chat is closed.

Staff-only: customers cannot end chat themselves.

---

## 2. Data model (fields on Lead)

| Field | Type | When set |
|-------|------|----------|
| `isChatEnded` | `boolean` | `true` after end; `false` after reopen |
| `chatEndedAt` | ISO date or `null` | Timestamp when chat was last ended |
| `chatEndedBy` | User ObjectId or `null` | Admin/sales user who ended it |

These fields appear on:

- `GET /api/admin/leads/:leadId/detail` → `data.lead`
- `GET /api/sales/leads/:leadId/detail` → `data.lead`

You do **not** need a separate detail call if you already load lead detail; use dedicated chat-status endpoints when you only open the chat pane.

---

## 3. REST APIs

All staff endpoints require **JWT** (`Authorization: Bearer <accessToken>`).

### 3.1 Get chat status

**Admin**

```
GET /api/admin/leads/:leadId/chat-status
```

**Sales** (lead must be assigned to the logged-in sales user)

```
GET /api/sales/leads/:leadId/chat-status
```

**Success response** (`200`):

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "665f1a2b3c4d5e6f7a8b9c0d",
    "isChatEnded": false,
    "chatEndedAt": null,
    "chatEndedBy": null,
    "canCustomerSend": true,
    "canStaffSend": true
  }
}
```

When chat is ended:

```json
{
  "data": {
    "leadId": "665f1a2b3c4d5e6f7a8b9c0d",
    "isChatEnded": true,
    "chatEndedAt": "2026-05-26T10:30:00.000Z",
    "chatEndedBy": "665f00000000000000000001",
    "canCustomerSend": false,
    "canStaffSend": false
  }
}
```

**Errors**

| Status | When |
|--------|------|
| `404` | Lead not found |
| `403` | Sales user and lead not assigned to them |

---

### 3.2 End chat

**Admin**

```
PUT /api/admin/leads/:leadId/chat/end
```

**Sales**

```
PUT /api/sales/leads/:leadId/chat/end
```

- No request body required.
- **Idempotent:** calling again when already ended returns `200` with current status (no error).
- Triggers socket broadcasts (see §5).
- Writes audit log `chat.ended`.

**Success response** (`200`):

```json
{
  "success": true,
  "message": "Chat ended",
  "data": {
    "leadId": "665f1a2b3c4d5e6f7a8b9c0d",
    "isChatEnded": true,
    "chatEndedAt": "2026-05-26T10:30:00.000Z",
    "chatEndedBy": "665f00000000000000000001",
    "canCustomerSend": false,
    "canStaffSend": false
  }
}
```

---

### 3.3 Reopen chat

**Admin**

```
PUT /api/admin/leads/:leadId/chat/reopen
```

**Sales**

```
PUT /api/sales/leads/:leadId/chat/reopen
```

- No request body required.
- **Idempotent:** already open → `200` with `isChatEnded: false`.
- Triggers socket broadcasts (see §5).
- Writes audit log `chat.reopened`.

**Success response** (`200`):

```json
{
  "success": true,
  "message": "Chat reopened",
  "data": {
    "leadId": "665f1a2b3c4d5e6f7a8b9c0d",
    "isChatEnded": false,
    "chatEndedAt": null,
    "chatEndedBy": null,
    "canCustomerSend": true,
    "canStaffSend": true
  }
}
```

---

### 3.4 Public endpoints (customer widget)

#### `POST /api/public/chat/init`

New field on `data`:

```json
{
  "isChatEnded": false
}
```

Check this **before** enabling the message input on first load.

#### `GET /api/public/chat/history/:leadId`

Response shape **changed** — wrapper now includes chat state:

```json
{
  "success": true,
  "data": {
    "isChatEnded": false,
    "chatEndedAt": null,
    "canCustomerSend": true,
    "messages": [
      {
        "senderType": "customer",
        "content": "Hello",
        "createdAt": "2026-05-26T09:00:00.000Z",
        "isRead": true
      }
    ]
  }
}
```

If `isChatEnded === true`:

- Disable input and send button.
- Show a banner, e.g. “This conversation has been closed.”
- Still render `messages` (read-only transcript).

**Error:** `400` if `leadId` is invalid / lead not found.

---

## 4. UI rules (recommended)

### Customer widget

```ts
const canSend =
  !isChatEnded &&
  canCustomerSend !== false; // from init, history, or chat_status
```

1. On init + history load → set `isChatEnded` from REST.
2. On socket `join_lead` → listen for `chat_status`.
3. On `chat_ended` → set `isChatEnded = true`, disable input.
4. On `chat_reopened` → set `isChatEnded = false`, enable input.
5. If user tries to send while ended → server emits `chat_error` with `"This chat has been closed"` (show toast).

### Sales / Admin chat panel

```ts
const canStaffSend =
  !isChatEnded &&
  canStaffSend !== false;
```

1. On open chat → `GET .../chat-status` **or** rely on `join_lead_chat` → `chat_status`.
2. **End chat** button → `PUT .../chat/end` **or** socket `end_lead_chat`.
3. **Reopen chat** button (optional UI) → `PUT .../chat/reopen` **or** socket `reopen_lead_chat`.
4. Disable composer when `!canStaffSend`.
5. `mark_messages_read` still works when chat is ended (read-only viewing).

**Sales assignment:** Same as sending messages — sales can only end/reopen leads assigned to them. Admin can end/reopen any lead.

---

## 5. Socket.io events

### 5.1 Customer namespace `/chat`

#### Emit (unchanged + guards)

| Event | Notes when chat ended |
|-------|----------------------|
| `join_lead` | Server replies with `chat_status` |
| `customer_message` | **Rejected** — server emits `chat_error` |
| `typing_start` / `typing_stop` | **Ignored** by server |

#### Listen (new / updated)

| Event | Payload | Action |
|-------|---------|--------|
| `chat_status` | See §5.3 | Sync UI state on join |
| `chat_ended` | Same as `chat_status` when ended | Disable input, show banner |
| `chat_reopened` | Same shape, `isChatEnded: false` | Enable input, hide banner |
| `chat_error` | `{ message: string }` | Toast if user tried to send while closed |

---

### 5.2 Staff namespace `/admin` (sales + admin, JWT)

#### Emit (new)

```js
// End chat (same effect as PUT .../chat/end)
adminSocket.emit('end_lead_chat', { leadId })

// Reopen chat
adminSocket.emit('reopen_lead_chat', { leadId })
```

#### Emit (existing — blocked when ended)

| Event | When ended |
|-------|------------|
| `sales_message` | Server emits `error` `{ message: 'Chat has ended' }` |
| `sales_typing_start` / `sales_typing_stop` | No-op |

#### Listen (new)

| Event | When | Action |
|-------|------|--------|
| `chat_status` | After `join_lead_chat` | Initialize composer state |
| `chat_ended` | Anyone ended chat for this lead | Disable composer, show “Chat ended” |
| `chat_reopened` | Anyone reopened | Enable composer |

`chat_status`, `chat_ended`, and `chat_reopened` share the same payload shape (§5.3).

---

### 5.3 Shared payload shape

```ts
type ChatLifecyclePayload = {
  leadId: string
  isChatEnded: boolean
  chatEndedAt: string | null   // ISO date
  chatEndedBy: string | null   // User ObjectId
  canCustomerSend: boolean
  canStaffSend: boolean
}
```

Emitted on:

- `chat_status` (to the socket that joined, and to room `lead:{leadId}` on `/admin`)
- `chat_ended` (to `/admin` room + `/chat` room for that lead)
- `chat_reopened` (same rooms)

---

## 6. Implementation flow (sequence)

### End chat from sales panel

```
Sales UI                    REST / Socket              Customer widget
────────                    ─────────────              ───────────────
User clicks "End chat"
  PUT /api/sales/leads/:id/chat/end
  OR emit end_lead_chat  →  DB: isChatEnded=true
                         →  audit chat.ended
                         →  emit chat_ended to lead room
                                                    ←  chat_ended
                                                    disable input
                         ←  chat_ended on /admin
                         disable composer
```

### Customer returns later

```
Customer opens widget
  POST /api/public/chat/init     → isChatEnded: true
  GET  /api/public/chat/history  → isChatEnded: true, messages: [...]
  connect /chat, join_lead       → chat_status { isChatEnded: true }
  → input stays disabled
```

### Reopen

```
Admin clicks "Reopen"
  PUT /api/admin/leads/:id/chat/reopen
                         →  isChatEnded=false
                         →  chat_reopened to both namespaces
Both sides enable input again
```

---

## 7. Choosing REST vs Socket

| Approach | Use when |
|----------|----------|
| **REST** `PUT .../chat/end` | Button click, reliable even if socket disconnected; easy to show loading/error from HTTP status |
| **Socket** `end_lead_chat` | Already in chat view with live socket; instant broadcast without extra HTTP |

Both call the same backend logic. Pick one per action; you do not need both for a single click.

---

## 8. Error handling

| Scenario | Customer | Staff |
|----------|----------|-------|
| Send while ended | `chat_error`: "This chat has been closed" | `error`: "Chat has ended" |
| Sales ends unassigned lead | N/A | `403` REST / `error` socket: "This lead is not assigned to you" |
| Invalid leadId | `400` on history | `404` |
| Socket reconnect | Re-emit `join_lead` / `join_lead_chat` → receive `chat_status` again |

---

## 9. TypeScript helpers (optional)

```ts
export function isChatInputDisabled(status: {
  isChatEnded?: boolean
  canCustomerSend?: boolean
  canStaffSend?: boolean
}, role: 'customer' | 'staff') {
  if (status.isChatEnded) return true
  if (role === 'customer') return status.canCustomerSend === false
  return status.canStaffSend === false
}
```

---

## 10. Quick reference

| Role | End chat | Reopen | Get status |
|------|----------|--------|------------|
| Admin | `PUT /api/admin/leads/:leadId/chat/end` | `PUT .../chat/reopen` | `GET .../chat-status` |
| Sales | `PUT /api/sales/leads/:leadId/chat/end` | `PUT .../chat/reopen` | `GET .../chat-status` |
| Customer | — | — | `init` + `history` + socket `chat_status` |

| Socket emit (staff) | `end_lead_chat`, `reopen_lead_chat` |
| Socket listen (all) | `chat_status`, `chat_ended`, `chat_reopened` |

---

## 11. Changelog summary

| Area | Change |
|------|--------|
| Lead model | `isChatEnded`, `chatEndedAt`, `chatEndedBy` |
| Admin/Sales REST | `GET .../chat-status`, `PUT .../chat/end`, `PUT .../chat/reopen` |
| Public REST | `isChatEnded` on init; history wrapper includes chat flags |
| `/admin` socket | `end_lead_chat`, `reopen_lead_chat`, `chat_status`, `chat_ended`, `chat_reopened` |
| `/chat` socket | `chat_status` on join; block `customer_message` when ended |
| Audit | `chat.ended`, `chat.reopened` |

---

*Last updated: 2026-05-26*
