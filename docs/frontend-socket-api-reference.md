# Socket.io — full frontend reference

**Date:** 2026-09-28  
**Stack:** Socket.io v4 on the same host as REST (`server.js` mounts Socket.io on the HTTP server).

This document lists **every namespace**, **rooms**, **events the client should emit**, and **events the client should listen for**, with example payloads taken from the backend.

---

## 1. Quick map

| Namespace | Auth | Used by |
|-----------|------|---------|
| `/chat` | None at connect (validated on `join_lead`) | Customer portal / public chat widget |
| `/admin` | JWT access token in `handshake.auth.token` | Admin, Sales, Plant, Construction, Account staff panels |

**Base URL:** same origin as API (e.g. `https://api.example.com`). Paths: `/chat` and `/admin` are Socket.io namespaces, not REST paths.

```javascript
import { io } from 'socket.io-client'

const API_ORIGIN = 'https://your-api-host.com'

// Customer chat
const chatSocket = io(`${API_ORIGIN}/chat`, {
  transports: ['websocket'],
  withCredentials: true,
})

// Staff (admin, sales, plant, …)
const staffSocket = io(`${API_ORIGIN}/admin`, {
  transports: ['websocket'],
  withCredentials: true,
  auth: { token: accessToken }, // same JWT as Authorization: Bearer
})

staffSocket.on('connect_error', (err) => {
  // err.message examples:
  // 'Authentication required' | 'Invalid token' | 'Account deactivated'
})
```

On **`/admin` connect**, the server automatically joins:

| Room | Who |
|------|-----|
| `user:<mongoUserId>` | Every connected staff user |
| `admin_room` | Only `role === 'admin'` |

Additional rooms are joined via events below (`join_lead_chat`, `join_team_channel`, etc.).

---

## 2. Rooms reference

| Room pattern | Namespace | How to join |
|--------------|-----------|-------------|
| `lead:<leadId>` | `/chat` | Emit `join_lead` |
| `lead:<leadId>` | `/admin` | Emit `join_lead_chat` |
| `user:<userId>` | `/admin` | Automatic on connect (+ optional `join_user_room`) |
| `admin_room` | `/admin` | Automatic for admin role |
| `team_dept:<role>` | `/admin` | `join_team_channel` — `channelType: 'department'`, `channelId`: `admin` \| `sales` \| `construction` \| `plant` \| `account` |
| `team_direct:<directKey>` | `/admin` | `join_team_channel` — `channelType: 'direct'`, `channelId`: other user's Mongo `_id` |
| `team_group:<groupId>` | `/admin` | `join_team_channel` — `channelType: 'group'`, `channelId`: TeamGroup `_id` |
| `ai_script:<sessionId>` | `/admin` | Server joins you on `ai_script:start` / `ai_script:message` |

---

## 3. `/chat` — client → server (emit)

### `join_lead`

Join project chat room and register customer presence.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "customerId": "6a6b63cc63a85950372e1d00"
}
```

**Server may reply (same socket):** `chat_error` or `chat_status` (see §5).

---

### `leave_lead`

```json
{ "leadId": "6aba0c2179fdcce8878687b0" }
```

---

### `typing_start` / `typing_stop`

```json
{ "leadId": "6aba0c2179fdcce8878687b0" }
```

Ignored if chat is ended.

---

### `customer_message`

Starts AI flow (unless staff has taken over). Requires prior `join_lead`.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "customerId": "6a6b63cc63a85950372e1d00",
  "content": "I need a 40x60 storage building in Texas"
}
```

---

## 4. `/chat` — server → client (listen)

### `chat_status`

Sent after `join_lead` and when lifecycle changes (staff may also get this on `/admin`).

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "isChatEnded": false,
  "chatEndedAt": null,
  "chatEndedBy": null,
  "isStaffChatActive": false,
  "isHandedToSales": false,
  "isAiActive": true,
  "canCustomerSend": true,
  "canStaffSend": true,
  "isCustomerOnline": true,
  "leadOnlineAt": "2026-09-28T10:00:00.000Z",
  "leadLastSeenAt": "2026-09-28T10:05:00.000Z",
  "customerOnline": {
    "isOnline": true,
    "onlineAt": "2026-09-28T10:00:00.000Z",
    "lastSeenAt": "2026-09-28T10:05:00.000Z"
  }
}
```

`isAiActive` is derived: `!isChatEnded && !isStaffChatActive && !isHandedToSales`.

---

### `chat_error`

```json
{ "message": "This chat has been closed" }
```

Other messages: `"Invalid customer for this project"`, `"Project not found"`, `"Something went wrong. Please try again."`

---

### `new_message`

Customer, AI, or staff message in the lead room.

```json
{
  "_id": "6aba0c300000000000000001",
  "senderType": "ai",
  "senderId": null,
  "senderName": null,
  "content": "Thanks! What is your target budget?",
  "createdAt": "2026-09-28T10:01:00.000Z",
  "leadId": "6aba0c2179fdcce8878687b0"
}
```

`senderType`: `"customer"` | `"ai"` | `"sales"` | `"admin"`.

Staff messages include `senderId` and `senderName`.

---

### `ai_typing`

```json
{ "isTyping": true }
```

```json
{ "isTyping": false }
```

---

### `sales_typing`

```json
{ "isTyping": true, "name": "Jane Sales" }
```

```json
{ "isTyping": false }
```

---

### `customer_typing`

Broadcast in `lead:*` room (customer typing indicator for staff viewing same room on `/admin`).

```json
{ "isTyping": true }
```

---

### `staff_chat_active`

First staff message took over from AI.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "isChatEnded": false,
  "isStaffChatActive": true,
  "isHandedToSales": false,
  "isAiActive": false,
  "intervenedBy": "admin",
  "staffName": "Admin User",
  "canCustomerSend": true,
  "canStaffSend": true
}
```

---

### `chat_ended` / `chat_reopened`

Same shape as `chat_status` (full status object).

---

### `staff_online_status`

Whether any admin/sales user is in `join_lead_chat` for this project.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "isOnline": true,
  "staffName": "Jane Sales",
  "staffRole": "sales",
  "lastSeenAt": "2026-09-28T10:02:00.000Z"
}
```

---

### `lead_handed_to_sales`

Customer notified that a sales rep was assigned.

```json
{ "assignedSales": "Jane Sales" }
```

---

### `drawing_status_updated`

```json
{
  "documentId": "6aba0c400000000000000002",
  "leadId": "6aba0c2179fdcce8878687b0",
  "status": "approved",
  "approvedAt": "2026-09-28T12:00:00.000Z"
}
```

---

### `drawing_comment_added`

```json
{
  "documentId": "6aba0c400000000000000002",
  "leadId": "6aba0c2179fdcce8878687b0",
  "comment": {
    "_id": "6aba0c500000000000000003",
    "text": "Please revise roof pitch",
    "commentedBy": "69e61375e2dc3d6e7468ca3d",
    "authorName": "Staff Name",
    "createdAt": "2026-09-28T11:00:00.000Z"
  }
}
```

---

## 5. `/admin` — client → server (emit)

### Lead chat (admin + sales)

| Event | Payload | Notes |
|-------|---------|--------|
| `join_lead_chat` | `{ "leadId": "<id>" }` | Join `lead:<id>`, receive `chat_status` |
| `leave_lead_chat` | `{ "leadId": "<id>" }` | |
| `end_lead_chat` | `{ "leadId": "<id>" }` | Sales: only assigned lead |
| `reopen_lead_chat` | `{ "leadId": "<id>" }` | |
| `sales_message` | `{ "leadId": "<id>", "content": "Hello" }` | Also emits to `/chat` as `new_message` |
| `mark_messages_read` | `{ "leadId": "<id>" }` | Marks customer messages read |
| `sales_typing_start` | `{ "leadId": "<id>" }` | |
| `sales_typing_stop` | `{ "leadId": "<id>" }` | |
| `join_user_room` | `{}` | Redundant — server already joins `user:<id>` on connect |

**Sales restriction:** for leads not assigned to the sales user, server emits `error`:

```json
{ "message": "This lead is not assigned to you" }
```

**Chat ended:** `sales_message` → `error`:

```json
{ "message": "Chat has ended" }
```

---

### AI script coach (sales + admin only)

| Event | Payload |
|-------|---------|
| `ai_script:list` | `{}` |
| `ai_script:start` | `{ "leadId": "<optional>", "sessionId": "<optional>" }` |
| `ai_script:message` | `{ "sessionId": "<optional>", "leadId": "<optional>", "content": "Draft a follow-up email" }` |
| `ai_script:end` | `{ "sessionId": "<id>" }` |

---

### Team chat (internal communication)

| Event | Payload |
|-------|---------|
| `join_team_channel` | `{ "channelType": "department" \| "direct" \| "group", "channelId": "<role or userId or groupId>" }` |
| `leave_team_channel` | Same as join |
| `team_typing_start` | `{ "channelType", "channelId" }` |
| `team_typing_stop` | `{ "channelType", "channelId" }` |
| `team_message` | `{ "channelType", "channelId", "content": "…", "attachments": [{ "url", "name", "type" }] }` |

`attachments` optional; max 10. Either `content` or attachments required.

---

## 6. `/admin` — server → client (listen)

### Generic errors

| Event | Payload |
|-------|---------|
| `error` | `{ "message": "…" }` — chat / assignment errors |
| `team_chat_error` | `{ "message": "Not a member of this group" }` |
| `auth:deactivated` | `{ "message": "Your account is deactivated. Please email to info@steelbuildingdepot.com" }` — socket disconnected |

---

### AI script (responses to client emits)

| Event | Example payload |
|-------|-----------------|
| `ai_script:sessions` | `{ "sessions": [ { "_id", "leadId", "messages", "updatedAt", … } ] }` |
| `ai_script:session` | `{ "sessionId": "…", "leadId": "…", "messages": [ { "role": "user" \| "assistant", "content": "…" } ] }` |
| `ai_script:typing` | `{ "sessionId": "…" }` |
| `ai_script:chunk` | `{ "sessionId": "…", "delta": "partial text" }` |
| `ai_script:done` | `{ "sessionId": "…", "reply": "full assistant text" }` |
| `ai_script:error` | `{ "message": "…", "sessionId": "…" }` |

---

### Team chat

| Event | Example payload |
|-------|-----------------|
| `new_team_message` | Full `TeamMessage` document (see REST team-chat APIs) |
| `team_typing` | `{ "isTyping": true, "name": "Jane" }` |
| `new_team_dm_notice` | `{ "fromUserId", "fromName", "content" }` — to `user:<recipientId>` when not in DM room |
| `new_team_group_message_notice` | `{ "groupId", "fromName", "content" }` |

> `new_team_message` can also be emitted when messages are sent via REST (`POST` team-chat APIs), not only socket.

---

### Lead list realtime (admin + assigned sales)

#### `lead_list_created`

**To:** `admin_room` + `user:<assignedSalesId>` if assigned.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "lead": { /* admin: full enrichLeadDocument row; sales: compact list row */ },
  "scoreRow": null,
  "meta": {
    "action": "created",
    "trigger": "created"
  }
}
```

#### `lead_list_updated`

**To:** `admin_room` + `user:<assignedSalesId>` when `notifySales` is true (default).

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "lead": { /* updated row */ },
  "scoreRow": { /* optional, mapLeadByScoreRow shape */ },
  "meta": {
    "action": "updated",
    "trigger": "lead_edited"
  }
}
```

**`meta.action` values (UI handling):**

| `action` | Typical UI |
|----------|------------|
| `updated` | Patch row in active lists |
| `created` | Prepend row (on `lead_list_created`) |
| `deleted` | Remove row from lists |
| `archived` | Remove row from **active** lists (still on archived screen via REST) |

**`meta.trigger` examples** (informational): `lead_edited`, `assigned`, `temperature`, `lifecycle`, `quote_ready`, `ai_scoring`, `staff_takeover`, `chat_lifecycle`, `terminated`, `archived`, `unarchived`, `deleted`, `po_raised`, `budget`, `customer_online_status`, `escalation_reassign`, …

When `action` is `archived` or `deleted`, `scoreRow` is usually omitted.

---

### Lead chat (also on `/admin` when in `lead:*` room)

Same events as customer chat where applicable: `chat_status`, `chat_ended`, `chat_reopened`, `new_message`, `customer_typing`, `staff_chat_active`, `drawing_status_updated`, `drawing_comment_added`.

---

### `customer_online_status`

**To:** `admin_room`, `user:<assignedSales>`, `lead:<leadId>`.

```json
{
  "customerId": "6a6b63cc63a85950372e1d00",
  "leadId": "6aba0c2179fdcce8878687b0",
  "isOnline": true,
  "scope": "lead",
  "lastSeenAt": "2026-09-28T10:00:00.000Z",
  "projectName": "Warehouse A",
  "jobId": "2026001",
  "customerIsOnline": true,
  "leadIsOnline": true
}
```

---

### `new_customer_message`

Lightweight ping when customer sends while staff chat is active (not always a full `new_message` to personal room).

**To:** `user:<assignedSales>` or `admin_room`.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "message": {
    "senderType": "customer",
    "content": "Are you there?",
    "createdAt": "2026-09-28T10:00:00.000Z"
  }
}
```

---

### `lead_score_updated`

**To:** `admin_room`.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "score": 72,
  "temperature": "warm",
  "breakdown": { "projectSize": { "points": 20, "reason": "…" }, "…": "…" },
  "requirements": "…",
  "lifecycleStatus": "requirements_gathered"
}
```

---

### `lead_quote_ready`

**To:** `admin_room`.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "customerId": "6a6b63cc63a85950372e1d00"
}
```

---

### `lead_assigned`

**To:** `user:<newAssigneeId>`.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "lead": { /* populated Lead document */ }
}
```

---

### `lead_no_sales_available`

**To:** `admin_room` (round-robin had no active sales users).

```json
{ "leadId": "6aba0c2179fdcce8878687b0" }
```

---

### `new_escalation`

**To:** `admin_room`.

```json
{
  "escalation": { "_id", "leadId", "note", "status": "pending", "raisedBy", "…": "…" },
  "leadId": "6aba0c2179fdcce8878687b0",
  "raisedBy": "Jane Sales"
}
```

---

### `new_po_order`

**To:** `admin_room`.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "order": { "_id", "poNumber", "status": "pending", "leadId", "customerId", "…": "…" }
}
```

---

### `payment_proof_submitted`

**To:** `admin_room`.

```json
{
  "invoiceId": "6aba0c600000000000000004",
  "invoiceNumber": "INV-0012",
  "leadId": "6aba0c2179fdcce8878687b0"
}
```

---

### `followup:reminder`

**To:** `user:<assignedTo>` (scheduled job).

```json
{
  "_id": "6aba0c700000000000000005",
  "notificationId": "6aba0c800000000000000006",
  "type": "followup_reminder",
  "followUpId": "6aba0c700000000000000005",
  "leadId": "6aba0c2179fdcce8878687b0",
  "assignedTo": "69e61375e2dc3d6e7468ca3d",
  "followUpDate": "2026-09-28T14:30:00.000Z",
  "modeOfContact": "call",
  "reminderMinutes": 30,
  "message": "Follow-up due soon"
}
```

---

### Plant / BOM (to `user:<uploaderOrPlantUser>`)

#### `bom_extraction_complete`

```json
{
  "jobId": "6aba0c900000000000000007",
  "buildingNumber": 1,
  "totalItems": 120,
  "matchedItems": 115,
  "unmatchedItems": 3,
  "ambiguousItems": 2,
  "bomPricedItems": 110,
  "unpricedItems": 5,
  "frameItems": 40,
  "parseSuspect": false,
  "parseAudit": null
}
```

#### `bom_extraction_failed`

```json
{
  "jobId": "6aba0c900000000000000007",
  "buildingNumber": 1,
  "error": "PDF parse timeout"
}
```

#### `bom_review_complete`

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "buildingId": "6aba0ca00000000000000008",
  "buildingNumber": 1,
  "action": "approved",
  "note": ""
}
```

---

### Shipper vendor uploads (to plant users on approved PO)

Recipients: all `user:<id>` where user is `POOrder.assignedTo` for that `leadId` (approved PO).

#### `shipper_file_submitted`

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "requestId": "6aba0cb00000000000000009",
  "vendorId": "6aba0cc0000000000000000a",
  "vendorName": "Vendor Co",
  "submittedAt": "2026-09-28T15:00:00.000Z",
  "quoteValue": 12500
}
```

#### `all_shipper_files_submitted`

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "consolidatedBOMId": "6aba0cd0000000000000000b",
  "vendorCount": 3
}
```

#### `shipper_comparison_complete`

**To:** `user:<job.triggeredBy>`.

```json
{
  "jobId": "6aba0ce0000000000000000c",
  "requestId": "6aba0cb00000000000000009",
  "leadId": "6aba0c2179fdcce8878687b0",
  "vendorId": "6aba0cc0000000000000000a",
  "summary": { /* comparison summary object */ }
}
```

#### `shipper_comparison_failed`

```json
{
  "jobId": "6aba0ce0000000000000000c",
  "requestId": "6aba0cb00000000000000009",
  "leadId": "6aba0c2179fdcce8878687b0",
  "vendorId": "6aba0cc0000000000000000a",
  "error": "Comparison engine error"
}
```

---

### Freight bids (to plant users on approved PO)

#### `freight_bid_submitted`

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "deliveryId": "6a327628a2982523aa1e91ac",
  "deliveryNumber": "DEL-0012",
  "bidId": "6a328001a2982523aa1e91bd",
  "carrierId": "6a310001a2982523aa1e9001",
  "carrierName": "ABC Freight LLC",
  "submittedAt": "2026-06-17T14:22:00.000Z",
  "quotedAmount": 4200,
  "projectName": "Warehouse A",
  "jobId": "2026001"
}
```

#### `all_freight_bids_submitted`

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "deliveryId": "6a327628a2982523aa1e91ac",
  "deliveryNumber": "DEL-0012",
  "bidCount": 4,
  "projectName": "Warehouse A",
  "jobId": "2026001"
}
```

---

### `project_assigned`

**To:** `user:<assignedTo>` when admin approves PO and assigns plant user.

```json
{
  "leadId": "6aba0c2179fdcce8878687b0",
  "poOrderId": "6aba0cf0000000000000000d",
  "projectName": "Warehouse A"
}
```

---

## 7. Event matrix (who listens)

| Event | Customer `/chat` | Sales `/admin` | Admin `/admin` | Plant `/admin` |
|-------|------------------|----------------|----------------|----------------|
| Lead chat messages | ✓ | ✓ (join lead) | ✓ | — |
| `lead_list_*` | — | ✓ (if assigned) | ✓ | — |
| `lead_assigned` | — | ✓ (personal room) | ✓ | — |
| `new_escalation` / `new_po_order` | — | optional | ✓ | — |
| `payment_proof_submitted` | — | — | ✓ | — |
| Team chat | — | ✓ | ✓ | ✓ |
| AI script | — | ✓ | ✓ | — |
| BOM / shipper / freight | — | — | optional | ✓ (personal + PO) |
| `auth:deactivated` | — | ✓ | ✓ | ✓ |

---

## 8. Reconnect checklist

1. Reconnect socket (client library retries by default).
2. **`/admin`:** pass fresh JWT in `auth.token` if token was refreshed.
3. Re-emit room joins:
   - Customer: `join_lead`
   - Staff chat: `join_lead_chat`
   - Team: `join_team_channel` for open channels
   - AI script: `ai_script:start` if session UI is open
4. Refetch list data over REST if you missed events while disconnected.

---

## 9. REST vs socket

| Prefer socket | Prefer REST |
|---------------|-------------|
| Live chat, typing, presence | Historical messages `GET …/messages` |
| Lead list row patch | Full list pagination, filters |
| Toasts / badges | Detail pages, exports |
| AI script streaming chunks | Session list can use `ai_script:list` or REST |

---

## 10. Related docs (deeper dives)

| Doc | Topic |
|-----|--------|
| [socket-chat-reference.md](./socket-chat-reference.md) | Chat modes, flows, edge cases |
| [sales_lead_chat_integration.md](./sales_lead_chat_integration.md) | Sales panel chat wiring |
| [ai_script_socket.md](./ai_script_socket.md) | AI script UI patterns |
| [internal-communication-socket-guide.md](./internal-communication-socket-guide.md) | Team chat |
| [plant-freight-bid-socket-events.md](./plant-freight-bid-socket-events.md) | Freight bids |
| [customer-online-status-frontend-guide.md](./customer-online-status-frontend-guide.md) | Online indicators |

**Canonical list:** this file (`frontend-socket-api-reference.md`) — update here when adding socket events in the backend.
