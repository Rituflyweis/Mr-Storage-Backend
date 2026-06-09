# Sales ↔ Lead Chat — Frontend Integration Guide

Realtime chat between a customer (lead) and the assigned sales employee. Built on Socket.io with REST endpoints for bootstrap and history.

> **End / reopen chat:** See **[chat-end-lifecycle-frontend-guide.md](./chat-end-lifecycle-frontend-guide.md)** for `isChatEnded`, REST endpoints, and socket events (`chat_ended`, `chat_reopened`, etc.).

---

## 1. Architecture Overview

Two Socket.io namespaces on the backend:

| Namespace | Auth | Used by |
|---|---|---|
| `/chat` | none (public) | Customer browser/widget |
| `/admin` | JWT (handshake `auth.token`) | Sales employee panel, Admin panel |

Lifecycle:

1. Customer starts chat → talks to AI bot.
2. AI can be cut off in two ways:
   - **Admin intervention** — admin sends any message via `sales_message`. Sets `lead.isStaffChatActive = true`. AI stops immediately; admin manages the lead manually (assign sales when ready).
   - **Sales assignment** — admin assigns a sales user (`PUT /api/admin/leads/:leadId/assign`). Sets `lead.isHandedToSales = true`. AI stops; messages flow **customer ⇄ sales**.
3. From either cutoff point, AI no longer replies to customer messages.

Frontend integrators care about two surfaces:

- **Customer chat widget** → connects to `/chat`.
- **Sales/Admin chat panel** → connects to `/admin`.

---

## 2. Bootstrap (REST)

### 2.1 Customer chat init
`POST /api/public/chat/init`

Request:
```json
{
  "firstName": "John",
  "email": "john@example.com",
  "phone": "9876543210",
  "countryCode": "+91"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "customerId": "665f...",
    "leadId": "665f...",
    "customerName": "John",
    "isReturning": false,
    "isHandedToSales": false,
    "isStaffChatActive": false,
    "isQuoteReady": false,
    "isChatEnded": false
  }
}
```

Persist `customerId` + `leadId` in the widget; they are required for every socket event.

If `isChatEnded` is `true`, disable the message input until chat is reopened (see end-chat guide).

If `isStaffChatActive` or `isHandedToSales` is `true`, do not show AI typing indicators — a human is handling the chat.

### 2.2 Chat history (full transcript)
`GET /api/public/chat/history/:leadId`

Response:
```json
{
  "success": true,
  "data": {
    "isChatEnded": false,
    "chatEndedAt": null,
    "isStaffChatActive": false,
    "isHandedToSales": false,
    "isAiActive": true,
    "canCustomerSend": true,
    "messages": [
      { "senderType": "ai|customer|sales|admin", "content": "...", "createdAt": "...", "isRead": true, "senderName?": "..." }
    ]
  }
}
```

No pagination — sorted ascending by `createdAt`. Call once on chat-window open to hydrate prior messages, then rely on socket events for new ones.

### 2.3 Sales — load lead with recent messages
`GET /api/sales/leads/:leadId`

Returns lead detail including `recentMessages` (latest 20 ascending). Use this to prefill the chat pane when a sales user opens a lead.

For older messages on the sales side, fall back to the same `GET /api/public/chat/history/:leadId` endpoint (public but safe — only message text, no PII).

---

## 3. Socket.io — Customer Side (`/chat`)

### 3.1 Connect
```js
import { io } from 'socket.io-client'

const chatSocket = io(`${API_BASE}/chat`, {
  transports: ['websocket'],
})
```
No auth.

### 3.2 Join the lead room
Emit immediately after connect:
```js
chatSocket.emit('join_lead', { leadId, customerId })
```

### 3.3 Send a message
```js
chatSocket.emit('customer_message', {
  leadId,
  customerId,
  content: 'I need a 20x30 building',
})
```

### 3.4 Typing
```js
chatSocket.emit('typing_start', { leadId })
chatSocket.emit('typing_stop',  { leadId })
```

### 3.5 Events to listen on

| Event | Payload | When |
|---|---|---|
| `new_message` | `{ _id, senderType, content, createdAt, leadId, senderName? }` | New AI or sales message arrived. Render in transcript. |
| `ai_typing` | `{ isTyping: boolean }` | Show/hide AI typing dots. |
| `sales_typing` | `{ isTyping: boolean, name }` | Show "Rahul is typing…" |
| `lead_handed_to_sales` | `{ assignedSales: "Rahul" }` | Show banner: "You are now connected to Rahul." |
| `staff_chat_active` | `{ leadId, isAiActive: false, intervenedBy: "admin\|sales", staffName }` | Admin or sales took over — hide AI UI, show human support banner. |
| `chat_error` | `{ message }` | Render inline error/toast. |
| `chat_status` | `{ leadId, isChatEnded, isStaffChatActive, isHandedToSales, isAiActive, canCustomerSend, ... }` | Current chat open/closed + AI vs human mode (on `join_lead`). |
| `chat_ended` | same as `chat_status` | Staff ended chat — disable input. |
| `chat_reopened` | same shape, `isChatEnded: false` | Staff reopened chat — enable input. |

**Important:** the customer's own outgoing message is **not** echoed back. Append it locally in the UI as soon as you emit `customer_message`.

---

## 4. Socket.io — Sales/Admin Side (`/admin`)

### 4.1 Connect (JWT required)
```js
const adminSocket = io(`${API_BASE}/admin`, {
  transports: ['websocket'],
  auth: { token: accessToken },   // JWT from /api/auth/login
})

adminSocket.on('connect_error', (err) => {
  // err.message will be 'Authentication required' or 'Invalid token'
})
```

On connect the server auto-joins:
- `user:<userId>` — personal room (used for direct notifications).
- `admin_room` — only if `role === 'admin'`.

### 4.2 Open a specific lead's chat
```js
adminSocket.emit('join_lead_chat', { leadId })
// when closing the chat pane:
adminSocket.emit('leave_lead_chat', { leadId })
```

Server emits `chat_status` after join with `isChatEnded` / `canStaffSend`.

### 4.2b End / reopen chat (staff)
```js
adminSocket.emit('end_lead_chat', { leadId })
adminSocket.emit('reopen_lead_chat', { leadId })
```

REST equivalents: `PUT /api/admin/leads/:leadId/chat/end` and `.../chat/reopen` (sales: `/api/sales/...`). Full spec: [chat-end-lifecycle-frontend-guide.md](./chat-end-lifecycle-frontend-guide.md).

### 4.3 Send a message to the customer
```js
adminSocket.emit('sales_message', { leadId, content: 'Hi, I can help with that.' })
```

Server guards:
- If the connected user has `role === 'sales'`, the lead **must** be assigned to them (`lead.assignedSales`).
- Failure → server emits `error` event with `{ message: 'This lead is not assigned to you' }`.

Admins can post to any lead. **The first admin message on a lead cuts off AI** (`isStaffChatActive = true`). Sales assignment remains manual — use `PUT /api/admin/leads/:leadId/assign` when ready.

### 4.4 Typing
```js
adminSocket.emit('sales_typing_start', { leadId })
adminSocket.emit('sales_typing_stop',  { leadId })
```

### 4.5 Mark customer messages as read
Call when the sales user opens / scrolls to bottom of the chat:
```js
adminSocket.emit('mark_messages_read', { leadId })
```
This sets `isRead = true` on all `senderType === 'customer'` messages for that lead. No ack is emitted; assume success.

### 4.6 Events to listen on

| Event | Payload | Meaning |
|---|---|---|
| `new_message` | `{ _id, senderType, senderId?, senderName?, content, createdAt, leadId }` | Any new message on a lead room you joined. Use for live transcript. |
| `new_customer_message` | `{ leadId, message: { senderType, content, createdAt } }` | Fires on `user:<salesId>` when handed to sales, or on `admin_room` when admin intervened (`isStaffChatActive`) but no sales assigned yet. |
| `staff_chat_active` | `{ leadId, isAiActive, intervenedBy, staffName, ... }` | First staff message cut off AI — update UI to human-handled mode. |
| `lead_quote_ready` | `{ leadId, customerId }` | Admin-only (`admin_room`). AI extracted a quote — show notification "Quote ready, lead assigned". |
| `new_lead` | `{ leadId, customerId, customerName }` | Admin-only. Brand-new lead from chat init. |
| `customer_typing` | `{ isTyping }` | Customer is typing in the lead room. |
| `error` | `{ message }` | Server-side validation/guard failure. |
| `chat_status` | `{ leadId, isChatEnded, canStaffSend, ... }` | After `join_lead_chat`. |
| `chat_ended` | same | Chat closed — disable composer. |
| `chat_reopened` | same, `isChatEnded: false` | Chat reopened. |

---

## 5. Message Shape

From `Message` collection. Sample:
```json
{
  "_id": "665f...",
  "leadId": "665f...",
  "customerId": "665f...",
  "senderType": "customer | ai | sales",
  "senderId": "665f... | null",     // user._id when senderType === 'sales'
  "content": "Hello",
  "isRead": false,
  "createdAt": "2026-05-19T14:22:11.000Z",
  "updatedAt": "2026-05-19T14:22:11.000Z"
}
```

Render rules:
- `senderType === 'customer'` → right-aligned (in sales UI) / left-aligned (in customer widget).
- `senderType === 'ai'` → labeled "Assistant" or bot avatar.
- `senderType === 'sales'` → labeled with `senderName` if provided; fall back to "Support".
- `senderType === 'admin'` → labeled with `senderName` if provided; fall back to "Support".

---

## 6. End-to-end Flow (Happy Path)

```
Customer widget                Backend                     Sales panel
──────────────                 ───────                     ───────────
POST /api/public/chat/init  →  creates Customer + Lead
                               returns {leadId, customerId}
connect /chat
emit join_lead              →  joins lead:<id> room
emit customer_message       →  saves msg, calls Claude
                            ←  emits new_message (senderType=ai)
                               (AI may emit ai_typing true/false around the call)
... a few turns ...
                               AI returns QUOTE_DATA
                               → lead.isQuoteReady = true
                               → round-robin picks sales user S
                               → lead.assignedSales = S
                               → lead.isHandedToSales = true
                            ←  emits lead_handed_to_sales {assignedSales:"Rahul"}
                                                        ←  emits lead_quote_ready to admin_room
                                                           (sales user S sees the new assignment)
                                                          connect /admin with JWT
                                                          emit join_lead_chat {leadId}
                                                          emit mark_messages_read
emit customer_message       →  saves, AI silent
                            ←  emits new_message to /chat
                                                        ←  emits new_message to /admin lead room
                                                        ←  emits new_customer_message to user:S
                                                          emit sales_message {leadId, content}
                            ←  emits new_message (senderType=sales)
```

---

## 7. Error & Edge Handling

| Scenario | Symptom | FE handling |
|---|---|---|
| Socket disconnect mid-chat | `disconnect` event | Auto-reconnect (`socket.io-client` does this); on `connect` re-emit `join_lead` / `join_lead_chat`. |
| Empty / whitespace `content` | Backend ignores silently | Validate before emit, disable Send button. |
| Sales user opens a lead not assigned to them | `error` event with message | Toast it; do not allow further sends. |
| No active sales user available at handoff | Admin gets `assignedSales: null` socket signal; lead remains AI-silent | Admin UI must allow manual assignment via REST. |
| Lead history > 20 in sales detail | `recentMessages` capped | Use `GET /api/public/chat/history/:leadId` to lazy-load full. |
| Customer sends before connecting socket | Message lost | Connect socket *before* enabling input field. |

---

## 8. Required Env / Config on FE

```env
NEXT_PUBLIC_API_BASE=https://mr-storage-backend.vercel.app/
```

Socket URL = same origin as REST (no separate host).

---

## 9. Quick Reference

**Customer events (emit):** `join_lead`, `customer_message`, `typing_start`, `typing_stop`
**Customer events (listen):** `new_message`, `ai_typing`, `sales_typing`, `lead_handed_to_sales`, `staff_chat_active`, `chat_error`, `chat_status`, `chat_ended`, `chat_reopened`

**Sales events (emit):** `join_lead_chat`, `leave_lead_chat`, `sales_message`, `sales_typing_start`, `sales_typing_stop`, `mark_messages_read`, `end_lead_chat`, `reopen_lead_chat`
**Sales events (listen):** `new_message`, `new_customer_message`, `staff_chat_active`, `lead_quote_ready` (admin), `new_lead` (admin), `customer_typing`, `error`, `chat_status`, `chat_ended`, `chat_reopened`

**REST:**
- `POST /api/public/chat/init`
- `GET /api/public/chat/history/:leadId`
- `GET /api/sales/leads/:leadId` (sales panel, includes `recentMessages`)
