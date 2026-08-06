# Socket Chat — Complete Reference (Customer, Admin, Sales)

Realtime lead chat uses **two Socket.io namespaces** on the same server origin as REST.

| Namespace | Auth | Used by |
|---|---|---|
| `/chat` | None | Customer chat widget |
| `/admin` | JWT in `handshake.auth.token` | Admin panel **and** sales panel |

> Sales and admin share the `/admin` namespace. Role-based guards differ per event (documented below).

**Related docs**
- [sales_lead_chat_integration.md](./sales_lead_chat_integration.md) — integration walkthrough
- [chat-end-lifecycle-frontend-guide.md](./chat-end-lifecycle-frontend-guide.md) — end/reopen chat

---

## 1. Connection

### 1.1 Customer (`/chat`)

```js
import { io } from 'socket.io-client'

const chatSocket = io(`${API_BASE}/chat`, {
  transports: ['websocket'],
})
```

No authentication. Connect before enabling the message input.

### 1.2 Admin & Sales (`/admin`)

```js
const adminSocket = io(`${API_BASE}/admin`, {
  transports: ['websocket'],
  auth: { token: accessToken }, // JWT from POST /api/auth/login
})

adminSocket.on('connect_error', (err) => {
  // err.message: 'Authentication required' | 'Invalid token'
})
```

**On connect, server automatically joins:**

| Room | Who |
|---|---|
| `user:<userId>` | Every authenticated user (personal notifications) |
| `admin_room` | Only users with `role === 'admin'` |

JWT payload on socket: `{ _id, email, role, name }` → available as `socket.user` server-side; `senderName` on outbound messages uses `name`.

---

## 2. Chat modes

Three modes control whether AI replies:

| Mode | Condition on Lead | AI replies? | Who handles |
|---|---|---|---|
| **AI** | `isStaffChatActive === false` AND `isHandedToSales === false` | Yes | Claude AI |
| **Admin manual** | `isStaffChatActive === true` AND `isHandedToSales === false` | No | Admin (assign sales when ready) |
| **Sales** | `isHandedToSales === true` | No | Assigned sales rep |

**Triggers**

| Action | Effect |
|---|---|
| Admin/sales sends first `sales_message` | Sets `isStaffChatActive = true`, emits `staff_chat_active`, AI stops |
| Admin assigns sales (`PUT /api/admin/leads/:leadId/assign`) | Sets `isHandedToSales = true`, AI stops |
| Staff ends chat | `isChatEnded = true`, nobody can send |

Computed flag (not stored): `isAiActive = !isChatEnded && !isStaffChatActive && !isHandedToSales`

---

## 3. Rooms

| Room | Namespace | Joined by |
|---|---|---|
| `lead:<leadId>` | `/chat` | Customer via `join_lead` |
| `lead:<leadId>` | `/admin` | Staff via `join_lead_chat` |
| `user:<userId>` | `/admin` | Auto on connect |
| `admin_room` | `/admin` | Auto for `role === 'admin'` |

Messages and chat lifecycle events are broadcast to `lead:<leadId>` on both namespaces where applicable.

---

## 4. Shared types

### 4.1 `ChatStatus`

Emitted by `chat_status`, `chat_ended`, `chat_reopened`, and included in `staff_chat_active`.

```ts
type ChatStatus = {
  leadId: string
  isChatEnded: boolean
  chatEndedAt: string | null      // ISO date
  chatEndedBy: string | null      // User ObjectId
  isStaffChatActive: boolean
  isHandedToSales: boolean
  isAiActive: boolean
  canCustomerSend: boolean        // !isChatEnded
  canStaffSend: boolean           // !isChatEnded
}
```

### 4.2 `NewMessage` (socket payload)

```ts
type NewMessage = {
  _id: string
  leadId: string
  senderType: 'customer' | 'ai' | 'sales' | 'admin'
  content: string
  createdAt: string               // ISO date
  senderId?: string               // User ObjectId — present for sales/admin
  senderName?: string             // Present for sales/admin
}
```

### 4.3 `NewCustomerMessage` (notification payload)

Fires on personal/admin rooms when customer sends while staff handles chat.

```ts
type NewCustomerMessage = {
  leadId: string
  message: {
    senderType: 'customer'
    content: string
    createdAt: string
  }
}
```

**Delivery rules**

| Scenario | Event | Room |
|---|---|---|
| Lead handed to sales | `new_customer_message` | `user:<assignedSalesId>` |
| Admin intervened, no sales assigned | `new_customer_message` | `admin_room` |
| Staff joined `lead:<leadId>` room | `new_message` | `lead:<leadId>` on `/admin` |

---

## 5. REST bootstrap (before sockets)

### 5.1 Customer init

`POST /api/public/chat/init`

**Request**
```json
{
  "firstName": "John",
  "email": "john@example.com",
  "phone": "9876543210",
  "countryCode": "+1"
}
```

**Response `data`**
```json
{
  "customerId": "665f...",
  "leadId": "665f...",
  "customerName": "John",
  "isReturning": false,
  "isHandedToSales": false,
  "isStaffChatActive": false,
  "isQuoteReady": false,
  "isChatEnded": false
}
```

Store `customerId` + `leadId` for all socket events.

### 5.2 Chat history

`GET /api/public/chat/history/:leadId`

**Response `data`**
```json
{
  "isChatEnded": false,
  "chatEndedAt": null,
  "isStaffChatActive": false,
  "isHandedToSales": false,
  "isAiActive": true,
  "canCustomerSend": true,
  "messages": [
    {
      "senderType": "ai",
      "content": "Hi John, what kind of building are you planning?",
      "createdAt": "2026-06-09T10:00:00.000Z",
      "isRead": true
    },
    {
      "senderType": "admin",
      "content": "I'll help you personally.",
      "createdAt": "2026-06-09T10:05:00.000Z",
      "isRead": false,
      "senderName": "Sarah Admin"
    }
  ]
}
```

### 5.3 Staff chat status (REST alternative to socket `chat_status`)

```
GET /api/admin/leads/:leadId/chat-status   (admin)
GET /api/sales/leads/:leadId/chat-status   (sales — lead must be assigned)
```

Returns same shape as `ChatStatus` in §4.1.

---

## 6. Customer namespace (`/chat`)

### 6.1 Events to **emit** (client → server)

#### `join_lead`

Join the lead room. Call immediately after connect (and again after reconnect).

```json
{ "leadId": "665f...", "customerId": "665f..." }
```

| Field | Required | Notes |
|---|---|---|
| `leadId` | Yes | MongoDB ObjectId string |
| `customerId` | Yes | From chat init |

**Server response:** `chat_status` (§4.1) to this socket only.

---

#### `customer_message`

Send a customer message.

```json
{
  "leadId": "665f...",
  "customerId": "665f...",
  "content": "I need a 40x60 warehouse"
}
```

| Field | Required | Notes |
|---|---|---|
| `leadId` | Yes | |
| `customerId` | Yes | |
| `content` | Yes | Trimmed; empty/whitespace ignored silently |

**Important:** The customer's own message is **not** echoed back. Append it locally in the UI immediately after emit.

**Server behavior by mode:**

| Mode | Server action |
|---|---|
| AI active | Saves message → Claude responds → `ai_typing` + `new_message` (AI) |
| Staff/sales active | Saves message → forwards to staff rooms → **no AI reply** |
| Chat ended | `chat_error` |

---

#### `typing_start` / `typing_stop`

```json
{ "leadId": "665f..." }
```

No-op if chat is ended. Staff in `lead:<leadId>` on `/admin` receive `customer_typing`.

---

### 6.2 Events to **listen** (server → client)

#### `chat_status`

Payload: `ChatStatus` (§4.1). Fired after `join_lead`.

---

#### `new_message`

Payload: `NewMessage` (§4.2).

| `senderType` | When |
|---|---|
| `ai` | AI replied (AI mode only) |
| `sales` | Assigned sales sent a message |
| `admin` | Admin sent a message (manual takeover) |

---

#### `ai_typing`

```json
{ "isTyping": true }
```

```json
{ "isTyping": false }
```

Only relevant when `isAiActive === true`. Hide indicator on `staff_chat_active`.

---

#### `sales_typing`

```json
{ "isTyping": true, "name": "Rahul Kumar" }
```

```json
{ "isTyping": false }
```

Fired when staff emits `sales_typing_start` / `sales_typing_stop` on `/admin`.

---

#### `staff_chat_active`

Fired when the **first** staff message cuts off AI.

```json
{
  "leadId": "665f...",
  "isChatEnded": false,
  "chatEndedAt": null,
  "chatEndedBy": null,
  "isStaffChatActive": true,
  "isHandedToSales": false,
  "isAiActive": false,
  "canCustomerSend": true,
  "canStaffSend": true,
  "intervenedBy": "admin",
  "staffName": "Sarah Admin"
}
```

| Field | Values |
|---|---|
| `intervenedBy` | `"admin"` \| `"sales"` |
| `staffName` | Display name of staff who took over |

**FE:** Hide AI typing UI; show human-support banner.

---

#### `chat_error`

```json
{ "message": "This chat has been closed" }
```

```json
{ "message": "Something went wrong. Please try again." }
```

---

#### `chat_ended`

Payload: `ChatStatus` with `isChatEnded: true`. Disable message input.

---

#### `chat_reopened`

Payload: `ChatStatus` with `isChatEnded: false`. Re-enable message input.

---

### 6.3 Customer quick reference

| Emit | Listen |
|---|---|
| `join_lead` | `chat_status` |
| `customer_message` | `new_message` |
| `typing_start` | `ai_typing` |
| `typing_stop` | `sales_typing` |
| | `staff_chat_active` |
| | `chat_error` |
| | `chat_ended` |
| | `chat_reopened` |

---

## 7. Admin namespace (`/admin`) — role: `admin`

Admin uses all staff events below. **No extra socket events** — same namespace as sales.

### 7.1 Chat room events — **emit**

#### `join_lead_chat`

```json
{ "leadId": "665f..." }
```

Joins `lead:<leadId>`. Server responds with `chat_status`.

Admin can join **any** lead.

---

#### `leave_lead_chat`

```json
{ "leadId": "665f..." }
```

---

#### `sales_message`

Send a message to the customer. **First message on a lead cuts off AI.**

```json
{
  "leadId": "665f...",
  "content": "Hi, I'll handle your project personally."
}
```

| Field | Required |
|---|---|
| `leadId` | Yes |
| `content` | Yes — trimmed; empty ignored |

**Stored as** `senderType: "admin"`.

**Server emits:**
- `new_message` → `/chat` room `lead:<leadId>` (customer sees it)
- `new_message` → `/admin` room `lead:<leadId>` (staff in room)
- `staff_chat_active` → both namespaces (first staff message only)

---

#### `sales_typing_start` / `sales_typing_stop`

```json
{ "leadId": "665f..." }
```

Customer receives `sales_typing` on `/chat`.

---

#### `mark_messages_read`

```json
{ "leadId": "665f..." }
```

Marks all unread `senderType === 'customer'` messages as read. No ack emitted.

---

#### `end_lead_chat` / `reopen_lead_chat`

```json
{ "leadId": "665f..." }
```

REST equivalents:
- `PUT /api/admin/leads/:leadId/chat/end`
- `PUT /api/admin/leads/:leadId/chat/reopen`

Broadcasts `chat_ended` / `chat_reopened` to customer and staff in the lead room.

---

### 7.2 Chat room events — **listen** (admin)

| Event | Payload | When |
|---|---|---|
| `chat_status` | `ChatStatus` | After `join_lead_chat` |
| `new_message` | `NewMessage` | Any message on joined lead room |
| `customer_typing` | `{ isTyping: boolean }` | Customer typing |
| `staff_chat_active` | `ChatStatus` + `intervenedBy`, `staffName` | First staff takeover |
| `chat_ended` | `ChatStatus` | Staff ended chat |
| `chat_reopened` | `ChatStatus` | Staff reopened chat |
| `error` | `{ message: string }` | Validation/guard failure |

---

### 7.3 Admin-only side events — **listen**

These fire on `admin_room` (auto-joined on connect). No join required.

#### `lead_list_created`

New lead from chat init or manual create.

```json
{
  "leadId": "665f...",
  "lead": { /* full admin list lead object */ },
  "meta": { "action": "created", "trigger": "chat_init" }
}
```

---

#### `lead_list_updated`

Lead changed (scoring, assignment, chat lifecycle, quote ready, etc.).

```json
{
  "leadId": "665f...",
  "lead": { /* full admin list lead object */ },
  "meta": { "action": "updated", "trigger": "staff_takeover" }
}
```

`trigger` examples: `chat_init`, `ai_scoring`, `quote_ready`, `assigned`, `staff_takeover`, `chat_lifecycle`, `lead_edited`

---

#### `lead_quote_ready`

AI gathered enough info for a quote. **Does not auto-assign sales.**

```json
{
  "leadId": "665f...",
  "customerId": "665f..."
}
```

Admin should review and manually assign via `PUT /api/admin/leads/:leadId/assign`.

---

#### `lead_score_updated`

After each AI reply, lead is re-scored.

```json
{
  "leadId": "665f...",
  "score": 72,
  "temperature": "hot",
  "breakdown": {
    "projectSize":    { "points": 15, "reason": "..." },
    "budgetSignals":  { "points": 20, "reason": "..." },
    "timeline":       { "points": 10, "reason": "..." },
    "decisionMaker":  { "points": 12, "reason": "..." },
    "projectClarity": { "points": 15, "reason": "..." }
  },
  "requirements": "Warehouse 40x60, Texas, ...",
  "lifecycleStatus": "requirements_gathered"
}
```

---

#### `new_customer_message`

Customer message while **admin is managing** (intervened, no sales assigned yet).

```json
{
  "leadId": "665f...",
  "message": {
    "senderType": "customer",
    "content": "What's the next step?",
    "createdAt": "2026-06-09T10:10:00.000Z"
  }
}
```

Use for unread badges when admin is not viewing that lead's chat pane.

---

#### `lead_no_sales_available`

Only if round-robin auto-assign is invoked and no active sales exist (legacy path).

```json
{ "leadId": "665f..." }
```

Current quote-ready flow does **not** auto-assign; admin assigns manually.

---

## 8. Sales namespace (`/admin`) — role: `sales`

Sales uses the **same socket connection and events** as admin, with these restrictions:

| Event / action | Sales rule |
|---|---|
| `join_lead_chat` | Any lead (no guard on join) |
| `sales_message` | Lead **must** be assigned to logged-in sales user |
| `end_lead_chat` / `reopen_lead_chat` | Lead must be assigned to them |
| `mark_messages_read` | No assignment guard (any leadId) |
| `sales_typing_*` | No assignment guard |
| `admin_room` events | **Not joined** — sales does not receive `lead_quote_ready`, `lead_list_*` on admin_room |

**Sales-only personal room events** (`user:<salesId>`, auto-joined):

#### `lead_assigned`

Admin assigned this lead to the sales user.

```json
{
  "leadId": "665f...",
  "lead": {
    /* full lead — populated customerId, assignedSales, aiQuoteData, aiContextSummary, leadScoring, etc. */
  }
}
```

Triggered by `PUT /api/admin/leads/:leadId/assign` (or escalation reassign).

---

#### `new_customer_message`

Customer sent a message on a lead **handed to this sales user**.

```json
{
  "leadId": "665f...",
  "message": {
    "senderType": "customer",
    "content": "When can we meet?",
    "createdAt": "2026-06-09T10:15:00.000Z"
  }
}
```

---

#### `lead_list_created` / `lead_list_updated`

Same shape as admin (§7.3), but only for leads **assigned to this sales user**.

```json
{
  "leadId": "665f...",
  "lead": { /* sales list row */ },
  "scoreRow": null,
  "meta": { "action": "updated", "trigger": "assigned" }
}
```

---

### 8.1 Sales `error` responses

```json
{ "message": "This lead is not assigned to you" }
```

```json
{ "message": "Chat has ended" }
```

---

### 8.2 Sales quick reference

| Emit | Listen (lead room) | Listen (personal `user:<id>`) |
|---|---|---|
| `join_lead_chat` | `chat_status` | `lead_assigned` |
| `leave_lead_chat` | `new_message` | `new_customer_message` |
| `sales_message` | `customer_typing` | `lead_list_created` |
| `sales_typing_start` | `staff_chat_active` | `lead_list_updated` |
| `sales_typing_stop` | `chat_ended` | |
| `mark_messages_read` | `chat_reopened` | |
| `end_lead_chat` | `error` | |
| `reopen_lead_chat` | | |

---

## 9. End-to-end flows

### 9.1 AI chat (default)

```
Customer                    Server                         Admin (optional monitor)
────────                    ──────                         ────────────────────
POST /api/public/chat/init
connect /chat
emit join_lead           →  join lead:<id>
                         ←  chat_status { isAiActive: true }
emit customer_message    →  save, call Claude
                         ←  ai_typing { true }
                         ←  ai_typing { false }
                         ←  new_message { senderType: 'ai' }
                                                    ←  new_message (if joined lead room)
                                                    ←  lead_score_updated (admin_room)
```

### 9.2 Admin intervention

```
Admin                       Server                         Customer
─────                       ──────                         ────────
emit join_lead_chat      →  join lead:<id>
emit sales_message       →  save (senderType: admin)
                         →  isStaffChatActive = true
                         ←  new_message (admin room)
                         →  staff_chat_active  ──────────→  staff_chat_active
                         →  new_message      ──────────→  new_message

emit customer_message    →  save, AI skipped
                         ←  new_message (admin room)
                         ←  new_customer_message (admin_room)
```

### 9.3 Sales assignment + chat

```
Admin (REST)                Server                         Sales + Customer
────────────                ──────                         ────────────────
PUT .../assign           →  isHandedToSales = true
                         →  lead_assigned ──────────────→  user:<salesId>
Sales emit join_lead_chat
Sales emit sales_message →  new_message ─────────────────→  customer new_message
Customer emit message    →  AI skipped
                         →  new_customer_message ──────→  user:<salesId>
```

---

## 10. Message rendering guide

| `senderType` | Customer UI | Staff UI |
|---|---|---|
| `customer` | Right-aligned (outgoing) | Left-aligned (incoming) |
| `ai` | Left, label "Assistant" | Left, label "AI" |
| `sales` | Left, `senderName` or "Support" | Right if own message, else left |
| `admin` | Left, `senderName` or "Support" | Right if own message, else left |

---

## 11. Edge cases

| Scenario | Behavior |
|---|---|
| Empty/whitespace `content` | Silently ignored (no error) |
| Customer sends before socket connect | Message lost — connect first |
| Admin messages while AI is responding | AI reply discarded; `ai_typing false` |
| Reconnect | Re-emit `join_lead` or `join_lead_chat` |
| Sales opens unassigned lead chat | Can join room and read; `sales_message` → `error` |
| Chat ended | All sends blocked; `chat_error` / `error` |
| Reopen chat | Does **not** reset `isStaffChatActive` or `isHandedToSales` — AI stays off |

---

## 12. Deprecated / not emitted

These appear in older docs but are **not** emitted by the current backend:

| Event | Replacement |
|---|---|
| `lead_handed_to_sales` | Customer sees `new_message` from sales, or `staff_chat_active` |
| `new_lead` | `lead_list_created` on `admin_room` |

---

## 13. Environment

```env
# Frontend — same host for REST and Socket.io
NEXT_PUBLIC_API_BASE=https://your-api.example.com
```

Socket URL = `${API_BASE}/chat` or `${API_BASE}/admin` (no separate socket host).
