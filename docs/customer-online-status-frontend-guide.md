# Customer Online Status — Frontend Integration Guide

Single reference for integrating **customer online/offline presence** in the chat widget (customer), admin panel, and sales panel.

**Backend service:** `src/services/socket/customerPresence.service.js`  
**Last updated:** 2026-06-15

---

## Overview

| Level | Field | Model | Meaning |
|-------|--------|--------|---------|
| **Account** | `Customer.isOnline` | Customer | Customer has ≥1 active `/chat` socket |
| **Project chat** | `Lead.isOnline` | Lead | Customer joined this lead’s room via `join_lead` |

Offline is detected **server-side** on Socket.io `disconnect` (tab close, network loss, crash). The frontend does **not** need to emit a custom offline event.

Multi-tab safe: one tab closing does not mark offline while another tab remains connected.

---

## Data model fields

### Customer

| Field | Type | Notes |
|-------|------|--------|
| `isOnline` | boolean | Default `false` |
| `onlineAt` | ISO date \| null | When they last went online |
| `lastSeenAt` | ISO date \| null | Last connect/disconnect activity |

### Lead

| Field | Type | Notes |
|-------|------|--------|
| `isOnline` | boolean | Default `false` — online **in this project’s chat** |
| `onlineAt` | ISO date \| null | When they last joined this lead chat |
| `lastSeenAt` | ISO date \| null | Last activity for this lead chat |

---

## REST API changes

All existing lead/customer responses that return full documents now include the fields above automatically (no new endpoints required).

### Chat status (staff)

**Admin**

```http
GET /api/admin/leads/:leadId/chat-status
Authorization: Bearer <admin_jwt>
```

**Sales** (lead must be assigned to you)

```http
GET /api/sales/leads/:leadId/chat-status
Authorization: Bearer <sales_jwt>
```

**Response `data`** (extended)

```json
{
  "leadId": "665a00000000000000001001",
  "isChatEnded": false,
  "chatEndedAt": null,
  "chatEndedBy": null,
  "isStaffChatActive": true,
  "isHandedToSales": true,
  "isAiActive": false,
  "canCustomerSend": true,
  "canStaffSend": true,
  "isCustomerOnline": true,
  "leadOnlineAt": "2026-06-15T10:30:00.000Z",
  "leadLastSeenAt": "2026-06-15T10:35:00.000Z",
  "customerOnline": {
    "isOnline": true,
    "onlineAt": "2026-06-15T10:30:00.000Z",
    "lastSeenAt": "2026-06-15T10:35:00.000Z"
  }
}
```

| Field | Use in UI |
|-------|-----------|
| `isCustomerOnline` | Green dot on **this lead’s chat** header |
| `customerOnline.isOnline` | Green dot on **customer account** (any project) |
| `leadOnlineAt` / `leadLastSeenAt` | “Active now” / “Last seen …” for this project |

### Lead detail

`GET /api/admin/leads/:leadId/detail` and `GET /api/sales/leads/:leadId/detail` include on the lead object:

```json
{
  "lead": {
    "_id": "...",
    "isOnline": true,
    "onlineAt": "2026-06-15T10:30:00.000Z",
    "lastSeenAt": "2026-06-15T10:35:00.000Z"
  },
  "customer": {
    "_id": "...",
    "isOnline": true,
    "onlineAt": "2026-06-15T10:30:00.000Z",
    "lastSeenAt": "2026-06-15T10:35:00.000Z"
  }
}
```

### Lead list / score rows

Admin score list and sales lead list rows may include:

```json
{
  "leadId": "...",
  "projectName": "ABC Warehouse",
  "isOnline": true,
  "lastSeenAt": "2026-06-15T10:35:00.000Z"
}
```

Sales `lead_list_updated` socket payload includes:

```json
{
  "lead": {
    "isOnline": true,
    "onlineAt": "...",
    "lastSeenAt": "...",
    "customerId": {
      "isOnline": true,
      "onlineAt": "...",
      "lastSeenAt": "..."
    }
  }
}
```

### Public chat init (unchanged shape, reference)

`POST /api/public/chat/init` does not set online status until the customer socket connects and emits `join_lead`.

---

## Socket.io — Customer (`/chat`)

**No auth.** Connect to `${API_BASE}/chat`.

### Connect

```javascript
import { io } from 'socket.io-client'

const chatSocket = io(`${API_BASE}/chat`, {
  transports: ['websocket', 'polling'],
})

chatSocket.on('connect', () => {
  chatSocket.emit('join_lead', { leadId, customerId })
})
```

### Events to **emit**

#### `join_lead` (required for presence + chat)

Marks customer online (account + this lead). Call on every connect/reconnect.

**Request payload**

```json
{
  "leadId": "665a00000000000000001001",
  "customerId": "665a00000000000000000501"
}
```

**Server behavior**

1. Validates `lead.customerId === customerId`
2. Joins room `lead:{leadId}`
3. Updates `Customer.isOnline` / `Lead.isOnline` if first socket for that scope
4. Emits `customer_online_status` to admin + assigned sales
5. Replies to customer with `chat_status`

**Error response** (listen on `chat_error`)

```json
{
  "message": "Invalid customer for this project"
}
```

#### `leave_lead` (optional — faster lead-level offline)

Use when customer navigates away from chat but keeps the socket open.

**Request payload**

```json
{
  "leadId": "665a00000000000000001001"
}
```

**Server behavior**

- Removes this socket from the lead’s presence count
- Sets `Lead.isOnline = false` when no other tab is in that lead
- Does **not** mark `Customer.isOnline = false` if the socket stays connected

#### Other customer emits (unchanged)

| Event | Payload |
|-------|---------|
| `customer_message` | `{ leadId, customerId, content }` |
| `typing_start` | `{ leadId }` |
| `typing_stop` | `{ leadId }` |

### Events to **listen** (customer)

| Event | When | Payload |
|-------|------|---------|
| `chat_status` | After `join_lead` | Extended chat status (see REST chat-status shape) |
| `chat_error` | Validation / errors | `{ message }` |
| `chat_ended` | Staff ended chat | Chat status object |
| `chat_reopened` | Staff reopened chat | Chat status object |
| `new_message` | New message | Message object |
| `sales_typing` | Staff typing | `{ isTyping, name }` |

**Customer does not receive `customer_online_status`** — that is staff-only on `/admin`.

### Offline (no FE action required)

When the tab closes or network drops, the server handles cleanup on `disconnect`. On reconnect, re-emit `join_lead`.

---

## Socket.io — Admin & Sales (`/admin`)

**Auth required:** `auth: { token: accessToken }`

```javascript
const adminSocket = io(`${API_BASE}/admin`, {
  auth: { token: accessToken },
})
```

On connect the server auto-joins `user:{userId}`. Admins also join `admin_room`.

When opening a lead chat:

```javascript
adminSocket.emit('join_lead_chat', { leadId })
```

### New event: `customer_online_status`

Fired when customer goes online or offline (account or lead scope).

**Listen**

```javascript
adminSocket.on('customer_online_status', (payload) => {
  // update lead row badge + chat header
})
```

**Payload**

```json
{
  "customerId": "665a00000000000000000501",
  "leadId": "665a00000000000000001001",
  "isOnline": true,
  "scope": "lead",
  "lastSeenAt": "2026-06-15T10:30:00.000Z",
  "projectName": "ABC Warehouse",
  "jobId": "PRO-019",
  "customerIsOnline": true,
  "leadIsOnline": true
}
```

| Field | Description |
|-------|-------------|
| `isOnline` | Status for the **`scope`** in this event |
| `scope` | `"customer"` = account-level change · `"lead"` = this project chat |
| `customerIsOnline` | Current `Customer.isOnline` after this change |
| `leadIsOnline` | Current `Lead.isOnline` after this change |
| `lastSeenAt` | ISO timestamp of this transition |

**Who receives it**

| Recipient | Condition |
|-----------|-----------|
| `admin_room` | Always (all connected admins) |
| `user:{assignedSalesId}` | When lead has `assignedSales` |
| `lead:{leadId}` | Staff already in that lead room (`join_lead_chat`) |

**Typical sequences**

First tab opens chat (one `join_lead`):

```text
1. customer_online_status { scope: "customer", isOnline: true,  customerIsOnline: true,  leadIsOnline: false }
2. customer_online_status { scope: "lead",     isOnline: true,  customerIsOnline: true,  leadIsOnline: true  }
```

Tab closed (server `disconnect`):

```text
1. customer_online_status { scope: "lead",     isOnline: false, customerIsOnline: true,  leadIsOnline: false }
2. customer_online_status { scope: "customer", isOnline: false, customerIsOnline: false, leadIsOnline: false }
```

Optional `leave_lead` (socket still open):

```text
1. customer_online_status { scope: "lead", isOnline: false, customerIsOnline: true, leadIsOnline: false }
```

### Related event: `lead_list_updated`

Also fired on online status change with:

```json
{
  "meta": {
    "action": "updated",
    "trigger": "customer_online_status"
  }
}
```

You can refresh the full lead row from `payload.lead` (includes `isOnline`).

### Extended `chat_status` (staff)

After `join_lead_chat`, `chat_status` includes the same online fields as the REST chat-status endpoint:

```json
{
  "leadId": "...",
  "isChatEnded": false,
  "isCustomerOnline": true,
  "leadOnlineAt": "2026-06-15T10:30:00.000Z",
  "leadLastSeenAt": "2026-06-15T10:35:00.000Z",
  "customerOnline": {
    "isOnline": true,
    "onlineAt": "2026-06-15T10:30:00.000Z",
    "lastSeenAt": "2026-06-15T10:35:00.000Z"
  }
}
```

---

## Frontend integration checklist

### Customer chat widget

- [ ] On `connect` / reconnect → `emit('join_lead', { leadId, customerId })`
- [ ] Do **not** emit offline on `beforeunload` (server handles it)
- [ ] Optional: `emit('leave_lead', { leadId })` when leaving chat route
- [ ] Listen for `chat_status` on join (includes online fields for debugging if needed)

### Admin panel

- [ ] Listen `customer_online_status` on `/admin` socket
- [ ] Update lead list row: use `payload.leadIsOnline` when `scope === 'lead'`
- [ ] Update customer profile chip: use `payload.customerIsOnline` when `scope === 'customer'`
- [ ] On open chat: `GET .../chat-status` or `join_lead_chat` → `chat_status` for initial state
- [ ] Handle `lead_list_updated` with `trigger: 'customer_online_status'`

### Sales panel

- [ ] Same as admin, but only receives events for **assigned** leads (`user:{salesId}` room)
- [ ] Use `GET /api/sales/leads/:leadId/chat-status` for initial state

---

## UI recommendations

| UI location | Recommended field |
|-------------|-------------------|
| Lead list row green dot | `lead.isOnline` or `payload.leadIsOnline` |
| Chat header “Customer online” | `isCustomerOnline` / `lead.isOnline` |
| Customer profile (all projects) | `customer.isOnline` / `payload.customerIsOnline` |
| “Last seen” label | `leadLastSeenAt` or `customerOnline.lastSeenAt` |

Use **`lead.isOnline`** for “online in this chat” and **`customer.isOnline`** for “online anywhere on the site”.

---

## Edge cases

| Case | Behavior |
|------|----------|
| Multiple tabs | Stays online until **all** tabs disconnect |
| Reconnect | Re-emit `join_lead` → online again |
| Server restart | All `isOnline` reset to `false` on boot; customers go online again on reconnect |
| Invalid `customerId` for lead | `join_lead` rejected with `chat_error`; presence not updated |
| Sales not assigned | Sales user does not get `customer_online_status` for that lead (admin still does) |

---

## Quick reference

| Action | Customer `/chat` | Staff `/admin` |
|--------|------------------|----------------|
| Go online | `emit join_lead` | — |
| Go offline | automatic on disconnect | — |
| Lead-only offline | optional `emit leave_lead` | — |
| Listen for changes | — | `on customer_online_status` |
| Initial state | `chat_status` after join | `GET .../chat-status` or `chat_status` after `join_lead_chat` |

---

## Example: staff handler

```javascript
const onlineByLead = new Map()

adminSocket.on('customer_online_status', ({ leadId, scope, isOnline, customerIsOnline, leadIsOnline }) => {
  if (scope === 'lead') {
    onlineByLead.set(leadId, leadIsOnline)
  }
  updateLeadRowBadge(leadId, onlineByLead.get(leadId) ?? leadIsOnline)
  if (scope === 'customer') {
    updateCustomerGlobalBadge(customerIsOnline)
  }
})

adminSocket.on('connect', () => {
  activeLeadId && adminSocket.emit('join_lead_chat', { leadId: activeLeadId })
})
```

---

## Example: customer widget

```javascript
function connectChat({ leadId, customerId }) {
  const socket = io(`${API_BASE}/chat`)

  socket.on('connect', () => {
    socket.emit('join_lead', { leadId, customerId })
  })

  socket.on('chat_status', (status) => {
    applyChatComposerState(status)
  })

  socket.on('chat_error', ({ message }) => {
    showError(message)
  })

  return socket
}
```
