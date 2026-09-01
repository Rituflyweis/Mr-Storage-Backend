# Socket.io Events — Full Handoff Guide

Complete reference for frontend / mobile app developers integrating real-time features across all panels.

**Socket.io version:** v4  
**Server origin:** Same host as REST API (no separate socket host)  
**Transports:** `['websocket']` (polling also works as fallback)

---

## Table of contents

1. [Namespaces & connection](#1-namespaces--connection)
2. [Rooms](#2-rooms)
3. [Shared payload types](#3-shared-payload-types)
4. [Customer chat widget (`/chat`)](#4-customer-chat-widget-chat)
5. [Customer portal (`/chat`)](#5-customer-portal-chat)
6. [Admin panel (`/admin`)](#6-admin-panel-admin)
7. [Sales panel (`/admin`)](#7-sales-panel-admin)
8. [Plant panel (`/admin`)](#8-plant-panel-admin)
9. [Account panel (`/admin`)](#9-account-panel-admin)
10. [Construction panel (`/admin`)](#10-construction-panel-admin)
11. [Team chat (all staff roles)](#11-team-chat-all-staff-roles)
12. [AI follow-up script (admin & sales)](#12-ai-follow-up-script-admin--sales)
13. [Material panel](#13-material-panel)
14. [Reconnect & edge cases](#14-reconnect--edge-cases)
15. [Quick cheat sheets](#15-quick-cheat-sheets)

---

## 1. Namespaces & connection

| Namespace | Auth | Used by |
|-----------|------|---------|
| `/chat` | None | Customer chat widget, customer portal (realtime drawing status) |
| `/admin` | JWT in `handshake.auth.token` | Admin, sales, plant, account, construction |

### 1.1 Customer — `/chat`

```javascript
import { io } from 'socket.io-client'

const chatSocket = io(`${API_BASE}/chat`, {
  transports: ['websocket'],
})

chatSocket.on('connect', () => {
  chatSocket.emit('join_lead', { leadId, customerId })
})
```

Bootstrap lead/customer IDs via `POST /api/public/chat/init` before connecting.

### 1.2 Staff — `/admin`

```javascript
const adminSocket = io(`${API_BASE}/admin`, {
  transports: ['websocket'],
  auth: { token: accessToken }, // JWT from POST /api/auth/login
})

adminSocket.on('connect_error', (err) => {
  // err.message: 'Authentication required' | 'Invalid token'
})
```

**Auto-joined on connect:**

| Room | Who |
|------|-----|
| `user:<userId>` | Every authenticated user |
| `admin_room` | Only `role === 'admin'` |

JWT payload available server-side as `socket.user`: `{ _id, email, role, name }`.

---

## 2. Rooms

| Room | Namespace | Joined by |
|------|-----------|-----------|
| `lead:<leadId>` | `/chat` | Customer via `join_lead` |
| `lead:<leadId>` | `/admin` | Staff via `join_lead_chat` |
| `user:<userId>` | `/admin` | Auto on connect |
| `admin_room` | `/admin` | Auto for admin role |
| `team_dept:<department>` | `/admin` | Staff via `join_team_channel` (`channelType: 'department'`) |
| `team_direct:<sortedUserIdPair>` | `/admin` | Staff via `join_team_channel` (`channelType: 'direct'`) |
| `ai_script:<sessionId>` | `/admin` | Auto when `ai_script:start` / `ai_script:message` |

**Department keys for team chat:** `admin`, `sales`, `construction`, `plant`, `account`

---

## 3. Shared payload types

### 3.1 `ChatStatus`

Returned by `chat_status`, `chat_ended`, `chat_reopened`, and included in `staff_chat_active`.

```typescript
type ChatStatus = {
  leadId: string
  isChatEnded: boolean
  chatEndedAt: string | null       // ISO date
  chatEndedBy: string | null     // User ObjectId
  isStaffChatActive: boolean
  isHandedToSales: boolean
  isAiActive: boolean              // computed: !isChatEnded && !isStaffChatActive && !isHandedToSales
  canCustomerSend: boolean         // !isChatEnded
  canStaffSend: boolean            // !isChatEnded
  isCustomerOnline: boolean
  leadOnlineAt: string | null
  leadLastSeenAt: string | null
  customerOnline: {
    isOnline: boolean
    onlineAt: string | null
    lastSeenAt: string | null
  } | null
}
```

### 3.2 `NewMessage`

```typescript
type NewMessage = {
  _id: string
  leadId: string
  senderType: 'customer' | 'ai' | 'sales' | 'admin'
  content: string
  createdAt: string                // ISO date
  senderId?: string                // present for sales/admin
  senderName?: string              // present for sales/admin
}
```

### 3.3 `LeadListSocketPayload`

```typescript
type LeadListSocketPayload = {
  leadId: string
  lead: Record<string, any>        // row shape matches GET /api/admin/leads or GET /api/sales/leads
  scoreRow?: Record<string, any> | null
  meta: {
    action: 'created' | 'updated'
    trigger: string
  }
}
```

**Common `meta.trigger` values:** `chat_init`, `admin_create_lead`, `sales_create_lead`, `ai_scoring`, `quote_ready`, `assigned`, `escalation_reassign`, `staff_takeover`, `chat_lifecycle`, `lead_edited`, `po_raised`, `budget`, `terminated`, `customer_online_status`, `temperature`, `lifecycle`

---

## 4. Customer chat widget (`/chat`)

### 4.1 Client → Server (emit)

#### `join_lead`

Join lead room + register online presence. **Call on every connect/reconnect.**

```json
{
  "leadId": "665f00000000000000001001",
  "customerId": "665f00000000000000000501"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `leadId` | Yes | MongoDB ObjectId string |
| `customerId` | Yes | From `POST /api/public/chat/init` |

**Server responds:** `chat_status` to this socket.

**Errors (`chat_error`):**

```json
{ "message": "Invalid customer for this project" }
```

```json
{ "message": "Project not found" }
```

---

#### `leave_lead` (optional)

Use when navigating away from chat but keeping socket open.

```json
{ "leadId": "665f00000000000000001001" }
```

Marks lead-level offline without disconnecting account presence.

---

#### `customer_message`

```json
{
  "leadId": "665f00000000000000001001",
  "customerId": "665f00000000000000000501",
  "content": "I need a 40x60 warehouse"
}
```

> **Important:** Customer's own message is **not** echoed back. Append locally in UI immediately after emit.

| Mode | Server behavior |
|------|-----------------|
| AI active | Saves → Claude responds → `ai_typing` + `new_message` (AI) |
| Staff/sales active | Saves → notifies staff → **no AI reply** |
| Chat ended | `chat_error` |

---

#### `typing_start` / `typing_stop`

```json
{ "leadId": "665f00000000000000001001" }
```

No-op if chat ended. Staff in lead room receive `customer_typing` on `/admin`.

---

### 4.2 Server → Client (listen)

#### `chat_status`

Payload: `ChatStatus` (§3.1). Fired after `join_lead`.

---

#### `new_message`

Payload: `NewMessage` (§3.2).

| `senderType` | When |
|--------------|------|
| `ai` | AI replied (AI mode only) |
| `sales` | Assigned sales sent a message |
| `admin` | Admin sent a message |

---

#### `ai_typing`

```json
{ "isTyping": true }
```

```json
{ "isTyping": false }
```

Only relevant when `isAiActive === true`. Hide on `staff_chat_active`.

---

#### `sales_typing`

```json
{ "isTyping": true, "name": "Rahul Kumar" }
```

```json
{ "isTyping": false }
```

---

#### `staff_chat_active`

First staff message cuts off AI.

```json
{
  "leadId": "665f00000000000000001001",
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
|-------|--------|
| `intervenedBy` | `"admin"` \| `"sales"` |
| `staffName` | Display name of staff who took over |

---

#### `staff_online_status`

Staff joined/left this lead's chat room. Show "Team online" indicator.

```json
{
  "leadId": "665f00000000000000001001",
  "isOnline": true,
  "staffName": "Sarah Admin",
  "staffRole": "admin",
  "lastSeenAt": "2026-06-15T10:35:00.000Z"
}
```

When staff disconnects: `isOnline: false`, `staffName: null`, `staffRole: null`.

---

#### `lead_handed_to_sales`

Emitted when AI quote-ready flow auto-assigns sales (round-robin).

```json
{
  "assignedSales": "Rahul Kumar"
}
```

Show banner: "You've been connected with {assignedSales}".

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

### 4.3 Customer cheat sheet

| **Emit** | **Listen** |
|----------|------------|
| `join_lead` | `chat_status` |
| `leave_lead` | `new_message` |
| `customer_message` | `ai_typing` |
| `typing_start` | `sales_typing` |
| `typing_stop` | `staff_chat_active` |
| | `staff_online_status` |
| | `lead_handed_to_sales` |
| | `drawing_status_updated` *(portal)* |
| | `chat_error` |
| | `chat_ended` |
| | `chat_reopened` |

---

## 5. Customer portal (`/chat`)

Uses the same `/chat` namespace. Connect with `leadId` + `customerId` from portal auth.

### Listen only (no extra emits beyond chat widget)

#### `drawing_status_updated`

Fired when admin/construction approves a drawing document.

```json
{
  "documentId": "665f00000000000000002001",
  "leadId": "665f00000000000000001001",
  "status": "approved",
  "approvedAt": "2026-06-17T14:22:00.000Z"
}
```

**UI action:** Invalidate/refetch drawings query for this `leadId`.

Also received on `/admin` in `lead:<leadId>` room (staff viewing project).

---

## 6. Admin panel (`/admin`)

Role: `admin`. Receives all events on `admin_room` plus personal `user:<id>` room.

### 6.1 Lead chat — Client → Server (emit)

#### `join_lead_chat`

```json
{ "leadId": "665f00000000000000001001" }
```

Joins `lead:<leadId>`. Server responds with `chat_status`. Admin can join **any** lead.

---

#### `leave_lead_chat`

```json
{ "leadId": "665f00000000000000001001" }
```

---

#### `sales_message`

Send message to customer. **First message cuts off AI.**

```json
{
  "leadId": "665f00000000000000001001",
  "content": "Hi, I'll handle your project personally."
}
```

Stored as `senderType: "admin"`. Broadcasts `new_message` to customer + staff in room. May emit `staff_chat_active` on first staff message.

---

#### `sales_typing_start` / `sales_typing_stop`

```json
{ "leadId": "665f00000000000000001001" }
```

Customer receives `sales_typing` on `/chat`.

---

#### `mark_messages_read`

```json
{ "leadId": "665f00000000000000001001" }
```

Marks unread `senderType === 'customer'` messages as read. No ack emitted.

---

#### `end_lead_chat` / `reopen_lead_chat`

```json
{ "leadId": "665f00000000000000001001" }
```

REST equivalents:
- `PUT /api/admin/leads/:leadId/chat/end`
- `PUT /api/admin/leads/:leadId/chat/reopen`

Broadcasts `chat_ended` / `chat_reopened` to customer and staff.

---

#### `join_user_room` (optional/redundant)

```json
{}
```

Re-joins `user:<userId>`. Already done automatically on connect.

---

### 6.2 Lead chat — Server → Client (listen)

| Event | Payload | When |
|-------|---------|------|
| `chat_status` | `ChatStatus` | After `join_lead_chat` |
| `new_message` | `NewMessage` | Any message on joined lead |
| `customer_typing` | `{ isTyping: boolean }` | Customer typing |
| `customer_online_status` | See §6.4 | Customer online/offline |
| `staff_chat_active` | `ChatStatus` + `intervenedBy`, `staffName` | First staff takeover |
| `chat_ended` | `ChatStatus` | Staff ended chat |
| `chat_reopened` | `ChatStatus` | Staff reopened chat |
| `drawing_status_updated` | See §5 | Drawing approved |
| `error` | `{ message: string }` | Validation/guard failure |

**Common `error` messages:**

```json
{ "message": "This lead is not assigned to you" }
```

```json
{ "message": "Chat has ended" }
```

```json
{ "message": "Failed to end chat" }
```

---

### 6.3 Admin room events — Server → Client (listen)

No join required — auto-joined `admin_room` on connect.

#### `lead_list_created`

New lead created (chat init, manual create, etc.).

```json
{
  "leadId": "665f00000000000000001001",
  "lead": {
    "_id": "665f00000000000000001001",
    "projectName": "ABC Warehouse",
    "jobId": "PRO-019",
    "customerId": { "_id": "...", "firstName": "John", "email": "john@example.com" },
    "assignedSales": null,
    "lifecycleStatus": "new_lead",
    "leadScoring": { "score": 0, "temperature": "cold" },
    "isChatEnded": false,
    "isStaffChatActive": false,
    "isHandedToSales": false,
    "isQuoteReady": false
  },
  "scoreRow": null,
  "meta": { "action": "created", "trigger": "chat_init" }
}
```

---

#### `lead_list_updated`

Lead row changed (scoring, assignment, lifecycle, chat, PO, etc.).

```json
{
  "leadId": "665f00000000000000001001",
  "lead": { /* full admin list row — same shape as GET /api/admin/leads */ },
  "scoreRow": {
    "leadId": "665f00000000000000001001",
    "score": 72,
    "temperature": "hot",
    "projectName": "ABC Warehouse"
  },
  "meta": { "action": "updated", "trigger": "ai_scoring" }
}
```

---

#### `lead_quote_ready`

AI gathered enough info. **Does not auto-assign in all flows — admin should review.**

```json
{
  "leadId": "665f00000000000000001001",
  "customerId": "665f00000000000000000501"
}
```

Assign manually: `PUT /api/admin/leads/:leadId/assign`

---

#### `lead_score_updated`

After each AI reply (legacy — prefer `lead_list_updated` with `trigger: 'ai_scoring'`).

```json
{
  "leadId": "665f00000000000000001001",
  "score": 72,
  "temperature": "hot",
  "breakdown": {
    "projectSize":    { "points": 15, "reason": "40x60 warehouse mentioned" },
    "budgetSignals":  { "points": 20, "reason": "Budget range provided" },
    "timeline":       { "points": 10, "reason": "Timeline within 6 months" },
    "decisionMaker":  { "points": 12, "reason": "Owner/decision maker confirmed" },
    "projectClarity": { "points": 15, "reason": "Clear building requirements" }
  },
  "requirements": "Warehouse 40x60, Texas, steel frame",
  "lifecycleStatus": "requirements_gathered"
}
```

---

#### `new_customer_message`

Customer message while admin is managing (staff active, no sales assigned).

```json
{
  "leadId": "665f00000000000000001001",
  "message": {
    "senderType": "customer",
    "content": "What's the next step?",
    "createdAt": "2026-06-09T10:10:00.000Z"
  }
}
```

Use for unread badges when admin is not viewing that lead's chat.

---

#### `new_escalation`

Sales escalated a lead.

```json
{
  "escalation": {
    "_id": "665f00000000000000003001",
    "leadId": "665f00000000000000001001",
    "raisedBy": "665f00000000000000004001",
    "note": "Customer wants manager callback",
    "status": "pending",
    "createdAt": "2026-06-09T11:00:00.000Z"
  },
  "leadId": "665f00000000000000001001",
  "raisedBy": "Rahul Kumar"
}
```

---

#### `new_po_order`

Sales raised a PO order.

```json
{
  "order": {
    "_id": "665f00000000000000005001",
    "leadId": "665f00000000000000001001",
    "customerId": "665f00000000000000000501",
    "poNumber": "PO-2026-0042",
    "status": "pending",
    "raisedBy": "665f00000000000000004001",
    "invoiceId": "665f00000000000000006001",
    "createdAt": "2026-06-09T12:00:00.000Z"
  },
  "leadId": "665f00000000000000001001"
}
```

---

#### `payment_proof_submitted`

Customer uploaded payment receipt in customer portal.

```json
{
  "invoiceId": "665f00000000000000006001",
  "invoiceNumber": "INV-2026-0018",
  "leadId": "665f00000000000000001001"
}
```

---

#### `lead_no_sales_available`

Round-robin could not find active sales user.

```json
{ "leadId": "665f00000000000000001001" }
```

---

### 6.4 Presence — `customer_online_status`

```json
{
  "customerId": "665f00000000000000000501",
  "leadId": "665f00000000000000001001",
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
| `scope` | `"customer"` = account-level · `"lead"` = this project chat |
| `isOnline` | Status for the `scope` in this event |
| `customerIsOnline` | Current account online state |
| `leadIsOnline` | Current lead chat online state |

**Recipients:** `admin_room`, `user:<assignedSalesId>`, `lead:<leadId>`

Also triggers `lead_list_updated` with `trigger: 'customer_online_status'`.

---

### 6.5 Admin cheat sheet

| **Emit** | **Listen (lead room)** | **Listen (admin_room)** |
|----------|------------------------|-------------------------|
| `join_lead_chat` | `chat_status` | `lead_list_created` |
| `leave_lead_chat` | `new_message` | `lead_list_updated` |
| `sales_message` | `customer_typing` | `lead_quote_ready` |
| `sales_typing_start/stop` | `customer_online_status` | `lead_score_updated` |
| `mark_messages_read` | `staff_chat_active` | `new_customer_message` |
| `end_lead_chat` | `chat_ended` | `new_escalation` |
| `reopen_lead_chat` | `chat_reopened` | `new_po_order` |
| | `drawing_status_updated` | `payment_proof_submitted` |
| | `error` | `lead_no_sales_available` |

Plus [Team chat (§11)](#11-team-chat-all-staff-roles) and [AI script (§12)](#12-ai-follow-up-script-admin--sales).

---

## 7. Sales panel (`/admin`)

Role: `sales`. Same namespace and chat events as admin, with restrictions.

### 7.1 Restrictions

| Action | Rule |
|--------|------|
| `join_lead_chat` | Any lead (can read) |
| `sales_message` | Lead **must** be assigned to logged-in user |
| `end_lead_chat` / `reopen_lead_chat` | Lead must be assigned |
| `mark_messages_read` | No assignment guard |
| `sales_typing_*` | No assignment guard |
| `admin_room` events | **Not received** — no `lead_quote_ready`, `lead_list_*` on admin_room |

### 7.2 Personal room events — `user:<salesId>`

#### `lead_assigned`

Admin assigned this lead.

```json
{
  "leadId": "665f00000000000000001001",
  "lead": {
    "_id": "665f00000000000000001001",
    "projectName": "ABC Warehouse",
    "jobId": "PRO-019",
    "customerId": { "_id": "...", "firstName": "John", "email": "john@example.com" },
    "assignedSales": { "_id": "...", "name": "Rahul Kumar" },
    "aiQuoteData": { /* ... */ },
    "aiContextSummary": "...",
    "leadScoring": { "score": 72, "temperature": "hot" },
    "lifecycleStatus": "requirements_gathered",
    "quoteValue": 125000
  }
}
```

---

#### `new_customer_message`

Customer sent message on assigned lead.

```json
{
  "leadId": "665f00000000000000001001",
  "message": {
    "senderType": "customer",
    "content": "When can we meet?",
    "createdAt": "2026-06-09T10:15:00.000Z"
  }
}
```

---

#### `lead_list_created` / `lead_list_updated`

Same envelope as admin (§6.3), but **only for leads assigned to this sales user**.

```json
{
  "leadId": "665f00000000000000001001",
  "lead": {
    "_id": "665f00000000000000001001",
    "jobId": "PRO-019",
    "projectName": "ABC Warehouse",
    "customerId": { "_id": "...", "firstName": "John", "email": "john@example.com", "isOnline": true },
    "lifecycleStatus": "assigned",
    "quoteValue": 125000,
    "leadScoring": { "score": 72 },
    "buildingType": "warehouse",
    "location": "Houston, TX",
    "isRaisedToPO": false,
    "isOnline": true,
    "nextFollowUp": null
  },
  "scoreRow": null,
  "meta": { "action": "updated", "trigger": "assigned" }
}
```

---

#### `followup:reminder`

Scheduled follow-up due now.

```json
{
  "_id": "665f00000000000000007001",
  "notificationId": "665f00000000000000008001",
  "type": "followup_reminder",
  "followUpId": "665f00000000000000007001",
  "leadId": "665f00000000000000001001",
  "followUpDate": "2026-06-09T14:00:00.000Z",
  "modeOfContact": "call",
  "message": "Follow-up reminder!"
}
```

Also persisted as a `Notification` document — refetch notifications if socket missed.

---

#### `customer_online_status`

Same payload as §6.4, but only for **assigned** leads.

---

### 7.3 Sales cheat sheet

| **Emit** | **Listen (lead room)** | **Listen (user room)** |
|----------|------------------------|------------------------|
| `join_lead_chat` | `chat_status` | `lead_assigned` |
| `leave_lead_chat` | `new_message` | `new_customer_message` |
| `sales_message` | `customer_typing` | `lead_list_created` |
| `sales_typing_start/stop` | `customer_online_status` | `lead_list_updated` |
| `mark_messages_read` | `staff_chat_active` | `followup:reminder` |
| `end_lead_chat` | `chat_ended` | `customer_online_status` |
| `reopen_lead_chat` | `chat_reopened` | |
| | `error` | |

Plus [Team chat (§11)](#11-team-chat-all-staff-roles) and [AI script (§12)](#12-ai-follow-up-script-admin--sales).

---

## 8. Plant panel (`/admin`)

Role: `plant`. **Listen-only** for plant notifications (no plant-specific emits). Connect to `/admin` with plant JWT.

Auto-joined: `user:<plantUserId>`

### 8.1 Server → Client (listen)

All events delivered to `user:<plantUserId>` for projects where plant user has an **approved PO** assigned.

#### `project_assigned`

Admin assigned PO / released project to plant.

```json
{
  "leadId": "665f00000000000000001001",
  "poOrderId": "665f00000000000000005001",
  "projectName": "ABC Warehouse"
}
```

---

#### `bom_extraction_complete`

BOM async parsing job finished.

```json
{
  "jobId": "665f00000000000000009001",
  "buildingNumber": 1,
  "totalItems": 48,
  "matchedItems": 45,
  "unmatchedItems": 2,
  "ambiguousItems": 1,
  "bomPricedItems": 40,
  "unpricedItems": 5,
  "frameItems": 2,
  "parseSuspect": false,
  "parseAudit": null
}
```

---

#### `bom_extraction_failed`

```json
{
  "jobId": "665f00000000000000009001",
  "buildingNumber": 1,
  "error": "Failed to parse spreadsheet"
}
```

---

#### `bom_review_complete`

Admin approved/rejected BOM for a building.

```json
{
  "leadId": "665f00000000000000001001",
  "buildingId": "665f0000000000000000a001",
  "buildingNumber": 1,
  "action": "approved",
  "note": ""
}
```

`action`: `"approved"` | `"rejected"`

---

#### `shipper_file_submitted`

Vendor uploaded quote file.

```json
{
  "leadId": "665f00000000000000001001",
  "requestId": "665f0000000000000000b001",
  "vendorId": "665f0000000000000000c001",
  "vendorName": "ABC Steel",
  "submittedAt": "2026-06-17T14:22:00.000Z",
  "quoteValue": 2100
}
```

---

#### `all_shipper_files_submitted`

All invited vendors submitted for a consolidated BOM.

```json
{
  "leadId": "665f00000000000000001001",
  "consolidatedBOMId": "665f0000000000000000d001",
  "vendorCount": 3
}
```

---

#### `shipper_comparison_complete`

Vendor quote comparison job finished.

```json
{
  "jobId": "665f0000000000000000e001",
  "requestId": "665f0000000000000000b001",
  "leadId": "665f00000000000000001001",
  "vendorId": "665f0000000000000000c001",
  "summary": {
    "expectedLines": 48,
    "vendorLines": 47,
    "matchedLines": 43,
    "missingItems": 2,
    "extraItems": 1,
    "qtyMismatches": 1,
    "lengthMismatches": 0,
    "weightMismatches": 0,
    "priceMismatches": 3,
    "ambiguousMatches": 0
  }
}
```

---

#### `shipper_comparison_failed`

```json
{
  "jobId": "665f0000000000000000e001",
  "requestId": "665f0000000000000000b001",
  "leadId": "665f00000000000000001001",
  "vendorId": "665f0000000000000000c001",
  "error": "Unsupported vendor quote file type"
}
```

---

#### `freight_bid_submitted`

Carrier submitted freight bid.

```json
{
  "leadId": "665f00000000000000001001",
  "deliveryId": "665f0000000000000000f001",
  "deliveryNumber": "DEL-0012",
  "bidId": "665f00000000000000010001",
  "carrierId": "665f00000000000000011001",
  "carrierName": "ABC Freight LLC",
  "submittedAt": "2026-06-17T14:22:00.000Z",
  "quotedAmount": 4200,
  "projectName": "ABC Warehouse",
  "jobId": "PRO-019"
}
```

---

#### `all_freight_bids_submitted`

All invited carriers responded for a delivery.

```json
{
  "leadId": "665f00000000000000001001",
  "deliveryId": "665f0000000000000000f001",
  "deliveryNumber": "DEL-0012",
  "bidCount": 3,
  "projectName": "ABC Warehouse",
  "jobId": "PRO-019"
}
```

---

### 8.2 Plant cheat sheet

| **Emit** | **Listen** |
|----------|------------|
| *(none — plant-specific)* | `project_assigned` |
| | `bom_extraction_complete` / `bom_extraction_failed` |
| | `bom_review_complete` |
| | `shipper_file_submitted` / `all_shipper_files_submitted` |
| | `shipper_comparison_complete` / `shipper_comparison_failed` |
| | `freight_bid_submitted` / `all_freight_bids_submitted` |

Plus [Team chat (§11)](#11-team-chat-all-staff-roles) if using internal messaging.

---

## 9. Account panel (`/admin`)

Role: `account`. No account-specific socket notifications beyond shared staff features.

### Listen

- [Team chat (§11)](#11-team-chat-all-staff-roles) — department `account` channel and direct messages

### Does NOT receive

- `admin_room` events (payment proof, escalations, lead lists)
- Plant notifications
- Lead chat events (unless explicitly joining lead rooms — not typical for account role)

> **Note:** `payment_proof_submitted` goes to `admin_room` only. Account panel should use REST polling or a future dedicated event if needed.

---

## 10. Construction panel (`/admin`)

Role: `construction`. No construction-specific socket emits from the client.

### Listen

- [Team chat (§11)](#11-team-chat-all-staff-roles) — department `construction` channel
- `drawing_status_updated` — if joined to `lead:<leadId>` via `join_lead_chat` (same payload as §5)

### Server-side trigger

When construction/admin approves a drawing via REST, server emits `drawing_status_updated` to both `/chat` and `/admin` `lead:<leadId>` rooms. Construction panel does not need to emit this event.

---

## 11. Team chat (all staff roles)

Available to all roles on `/admin`: `admin`, `sales`, `plant`, `account`, `construction`.

Messages can also be sent via REST `POST /api/account/communication/...` which emits the same `new_team_message` event.

### 11.1 Client → Server (emit)

#### `join_team_channel`

```json
{
  "channelType": "department",
  "channelId": "sales"
}
```

Direct message:

```json
{
  "channelType": "direct",
  "channelId": "665f00000000000000004001"
}
```

`channelId` for direct = the **other user's** ObjectId.

---

#### `leave_team_channel`

```json
{
  "channelType": "department",
  "channelId": "sales"
}
```

---

#### `team_message`

```json
{
  "channelType": "department",
  "channelId": "sales",
  "content": "Team standup at 3pm"
}
```

Direct:

```json
{
  "channelType": "direct",
  "channelId": "665f00000000000000004001",
  "content": "Can you review this lead?"
}
```

---

#### `team_typing_start` / `team_typing_stop`

```json
{
  "channelType": "department",
  "channelId": "sales"
}
```

---

### 11.2 Server → Client (listen)

#### `new_team_message`

Full `TeamMessage` document:

```json
{
  "_id": "665f00000000000000012001",
  "channelType": "department",
  "department": "sales",
  "directKey": "",
  "participants": [],
  "senderId": "665f00000000000000004001",
  "senderName": "Rahul Kumar",
  "senderRole": "sales",
  "content": "Team standup at 3pm",
  "readBy": ["665f00000000000000004001"],
  "createdAt": "2026-06-09T15:00:00.000Z",
  "updatedAt": "2026-06-09T15:00:00.000Z"
}
```

Direct message example — `channelType: "direct"`, `directKey: "userA_userB"`, `participants: [userA, userB]`.

---

#### `new_team_dm_notice`

Lightweight notification when recipient is **not** in the direct channel room.

```json
{
  "fromUserId": "665f00000000000000004001",
  "fromName": "Rahul Kumar",
  "content": "Can you review this lead?"
}
```

Delivered to `user:<recipientId>`.

---

#### `team_typing`

```json
{ "isTyping": true, "name": "Rahul Kumar" }
```

```json
{ "isTyping": false }
```

---

#### `team_chat_error`

```json
{ "message": "Something went wrong. Please try again." }
```

---

### 11.3 Team chat cheat sheet

| **Emit** | **Listen** |
|----------|------------|
| `join_team_channel` | `new_team_message` |
| `leave_team_channel` | `new_team_dm_notice` |
| `team_message` | `team_typing` |
| `team_typing_start` | `team_chat_error` |
| `team_typing_stop` | |

---

## 12. AI follow-up script (admin & sales)

Streaming chatbot for the **AI Follow-Up Script Generator** screen. Same `/admin` connection.

**Allowed roles:** `sales`, `admin`

REST fallback: `POST /api/sales/followups/ai-script` (non-streaming)

### 12.1 Client → Server (emit)

#### `ai_script:list`

```json
{}
```

---

#### `ai_script:start`

```json
{
  "leadId": "665f00000000000000001001",
  "sessionId": null
}
```

| Field | Notes |
|-------|-------|
| `leadId` | Optional — attaches lead context to system prompt |
| `sessionId` | Optional — resume specific session (must be owned by user) |

Without `sessionId`, creates a **new** session. To resume, call `ai_script:list` first, then pass `sessionId`.

**Server responds:** `ai_script:session`

---

#### `ai_script:message`

```json
{
  "sessionId": "665f00000000000000013001",
  "leadId": "665f00000000000000001001",
  "content": "Write a follow-up for a customer who asked about timeline"
}
```

> Always pass `sessionId` from `ai_script:session`. Omitting it creates a new session per message.

**Server sequence:**
1. `ai_script:typing`
2. `ai_script:chunk` × N
3. `ai_script:done`

---

#### `ai_script:end`

```json
{ "sessionId": "665f00000000000000013001" }
```

Leaves session room. No response.

---

### 12.2 Server → Client (listen)

#### `ai_script:sessions`

```json
{
  "sessions": [
    {
      "_id": "665f00000000000000013001",
      "salesEmployeeId": "665f00000000000000004001",
      "leadId": { "_id": "665f00000000000000001001", "projectName": "ABC Warehouse" },
      "messages": [
        { "role": "user", "content": "Write a follow-up...", "timestamp": "2026-06-09T10:00:00.000Z" },
        { "role": "assistant", "content": "Hi John, ...", "timestamp": "2026-06-09T10:00:05.000Z" }
      ],
      "createdAt": "2026-06-09T09:00:00.000Z",
      "updatedAt": "2026-06-09T10:00:05.000Z"
    }
  ]
}
```

---

#### `ai_script:session`

```json
{
  "sessionId": "665f00000000000000013001",
  "leadId": "665f00000000000000001001",
  "messages": [
    { "role": "user", "content": "...", "timestamp": "..." },
    { "role": "assistant", "content": "...", "timestamp": "..." }
  ]
}
```

---

#### `ai_script:typing`

```json
{ "sessionId": "665f00000000000000013001" }
```

---

#### `ai_script:chunk`

```json
{
  "sessionId": "665f00000000000000013001",
  "delta": "Hi John, "
}
```

Append `delta` to current assistant bubble. **Sent to emitting socket only** (not broadcast across tabs).

---

#### `ai_script:done`

```json
{
  "sessionId": "665f00000000000000013001",
  "reply": "Hi John, I wanted to follow up on your warehouse project timeline..."
}
```

---

#### `ai_script:error`

```json
{
  "sessionId": "665f00000000000000013001",
  "message": "content is required"
}
```

---

### 12.3 AI script cheat sheet

| **Emit** | **Listen** |
|----------|------------|
| `ai_script:list` | `ai_script:sessions` |
| `ai_script:start` | `ai_script:session` |
| `ai_script:message` | `ai_script:typing` → `ai_script:chunk` × N → `ai_script:done` |
| `ai_script:end` | `ai_script:error` |

---

## 13. Material panel

**No Socket.io events.** Material/vendor workflows use REST APIs and public upload links only.

---

## 14. Reconnect & edge cases

| Scenario | Behavior |
|----------|----------|
| Reconnect | Re-emit `join_lead` (customer) or `join_lead_chat` / `join_team_channel` (staff) |
| Empty/whitespace `content` | Silently ignored (no error) |
| Customer sends before connect | Message lost — connect first |
| Admin messages while AI responding | AI reply discarded; `ai_typing: false` |
| Sales opens unassigned lead | Can join + read; `sales_message` → `error` |
| Chat ended | All sends blocked |
| Reopen chat | Does **not** reset `isStaffChatActive` or `isHandedToSales` — AI stays off |
| Server restart | All `isOnline` flags reset; customers go online again on reconnect |
| Multi-tab (customer) | Stays online until **all** tabs disconnect |
| AI script multi-tab | Only sending tab receives stream chunks |

### Reconnect pattern (staff lists)

```javascript
adminSocket.on('connect', () => {
  // Re-join active contexts
  activeLeadId && adminSocket.emit('join_lead_chat', { leadId: activeLeadId })
  activeTeamChannels.forEach(ch => adminSocket.emit('join_team_channel', ch))

  // Refetch lists once, then apply incremental socket updates
  refetchLeads()
})
```

---

## 15. Quick cheat sheets

### By namespace

| Namespace | Panels | Auth |
|-----------|--------|------|
| `/chat` | Customer widget, customer portal | None |
| `/admin` | Admin, sales, plant, account, construction | JWT |

### All client emit events (summary)

| Event | Namespace | Who |
|-------|-----------|-----|
| `join_lead` | `/chat` | Customer |
| `leave_lead` | `/chat` | Customer |
| `customer_message` | `/chat` | Customer |
| `typing_start` / `typing_stop` | `/chat` | Customer |
| `join_lead_chat` | `/admin` | Admin, sales |
| `leave_lead_chat` | `/admin` | Admin, sales |
| `sales_message` | `/admin` | Admin, sales |
| `sales_typing_start/stop` | `/admin` | Admin, sales |
| `mark_messages_read` | `/admin` | Admin, sales |
| `end_lead_chat` / `reopen_lead_chat` | `/admin` | Admin, sales |
| `join_user_room` | `/admin` | Any staff |
| `join_team_channel` / `leave_team_channel` | `/admin` | Any staff |
| `team_message` | `/admin` | Any staff |
| `team_typing_start/stop` | `/admin` | Any staff |
| `ai_script:list/start/message/end` | `/admin` | Admin, sales |

### All server listen events (summary)

| Event | Namespace | Primary audience |
|-------|-----------|------------------|
| `chat_status` | both | Lead room |
| `new_message` | both | Lead room |
| `ai_typing` | `/chat` | Customer |
| `sales_typing` | `/chat` | Customer |
| `customer_typing` | `/admin` | Staff in lead room |
| `staff_chat_active` | both | Lead room |
| `staff_online_status` | `/chat` | Customer |
| `customer_online_status` | `/admin` | Admin, assigned sales |
| `chat_error` | `/chat` | Customer |
| `chat_ended` / `chat_reopened` | both | Lead room |
| `error` | `/admin` | Emitting staff socket |
| `lead_handed_to_sales` | `/chat` | Customer |
| `drawing_status_updated` | both | Lead room |
| `lead_list_created/updated` | `/admin` | Admin room / assigned sales |
| `lead_quote_ready` | `/admin` | Admin room |
| `lead_score_updated` | `/admin` | Admin room |
| `new_customer_message` | `/admin` | Admin room / assigned sales |
| `lead_assigned` | `/admin` | Assigned sales |
| `new_escalation` | `/admin` | Admin room |
| `new_po_order` | `/admin` | Admin room |
| `payment_proof_submitted` | `/admin` | Admin room |
| `lead_no_sales_available` | `/admin` | Admin room |
| `followup:reminder` | `/admin` | Assigned sales |
| `project_assigned` | `/admin` | Plant user |
| `bom_extraction_complete/failed` | `/admin` | Plant uploader |
| `bom_review_complete` | `/admin` | Plant user |
| `shipper_file_submitted` | `/admin` | Plant users on project |
| `all_shipper_files_submitted` | `/admin` | Plant users on project |
| `shipper_comparison_complete/failed` | `/admin` | Job trigger user |
| `freight_bid_submitted` | `/admin` | Plant users on project |
| `all_freight_bids_submitted` | `/admin` | Plant users on project |
| `new_team_message` | `/admin` | Team channel room |
| `new_team_dm_notice` | `/admin` | DM recipient |
| `team_typing` | `/admin` | Team channel room |
| `team_chat_error` | `/admin` | Emitting socket |
| `ai_script:sessions/session/typing/chunk/done/error` | `/admin` | Admin, sales |

---

## Environment

```env
# Frontend — same host for REST and Socket.io
NEXT_PUBLIC_API_BASE=https://your-api.example.com
```

```
Customer socket:  ${API_BASE}/chat
Staff socket:     ${API_BASE}/admin
```

---

## Related docs

- `docs/socket-chat-reference.md` — detailed chat flows
- `docs/customer-online-status-frontend-guide.md` — presence integration
- `docs/lead-list-socket-frontend-guide.md` — lead table upsert pattern
- `docs/ai_script_socket.md` — AI script reference implementation
- `docs/plant-freight-bid-socket-events.md` — freight bid details
- `docs/plant-dashboard-api.md` — plant dashboard + socket alerts

---

*Generated from backend source: `src/services/socket/*`, controllers, and plant services. Last synced: 2026-08-17.*
