# Customer App — direct chat (Plant / staff messages)

Reply handoff for mobile/backend: why Plant `POST /api/plant/customer-direct-chat/:customerId/messages` succeeds but messages may not appear in the Customer App, and what the app must call instead.

**Plant (staff):** `/api/plant/customer-direct-chat/:customerId/messages`  
**Customer App:** `/api/customer/chat/direct/*`  
**Same storage:** `CustomerDirectMessage` (one thread per **customer**, no `leadId`)

---

## Root cause (most common)

Plant writes to **customer direct chat**. The Customer App often still uses **per-project channel chat**:

| API | Model | Scope |
|-----|--------|--------|
| `GET/POST /api/customer/chat/direct/messages` | `CustomerDirectMessage` | One thread per logged-in customer |
| `GET/POST /api/customer/chat/:channel/messages?leadId=` | `Message` | Per project; channels: `project`, `finance`, `construction` |

If the app only loads **`/chat/project/messages?leadId=…`** (or finance/construction), **Plant direct messages will not show** — different collection and API.

**Also verify:** Plant `:customerId` must match the customer’s MongoDB `_id` for the account logged into the app.

---

## 1. REST — Customer App

**Base:** `{BASE_URL}/api/customer`  
**Auth:** Customer JWT from `POST /api/customer/auth/login`  
**Header:** `Authorization: Bearer <customer_access_token>`

| Action | Method | Path |
|--------|--------|------|
| Summary (unread + last message) | GET | `/api/customer/chat/direct` |
| History | GET | `/api/customer/chat/direct/messages?page=1&limit=50` |
| Send | POST | `/api/customer/chat/direct/messages` |

### cURL — history

```bash
curl -s "{BASE_URL}/api/customer/chat/direct/messages?page=1&limit=50" \
  -H "Authorization: Bearer CUSTOMER_JWT"
```

### cURL — send

```bash
curl -s -X POST "{BASE_URL}/api/customer/chat/direct/messages" \
  -H "Authorization: Bearer CUSTOMER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello from customer app"}'
```

### cURL — summary

```bash
curl -s "{BASE_URL}/api/customer/chat/direct" \
  -H "Authorization: Bearer CUSTOMER_JWT"
```

### Example message object (history / socket)

```json
{
  "messageId": "68f…",
  "customerId": "67a…",
  "senderType": "admin",
  "senderId": "66f…",
  "senderName": "Plant User",
  "content": "Your drawings are approved.",
  "isReadByCustomer": false,
  "isReadByStaff": true,
  "createdAt": "2026-10-09T12:00:00.000Z"
}
```

- **`senderType`:** `customer` | `admin` | `sales`
- Plant (and most non-sales staff) messages appear as **`senderType: "admin"`** (plant role is mapped to `admin` in direct chat).

GET history marks **staff** messages as read for the customer.

---

## 2. Socket — Customer App

| Item | Value |
|------|--------|
| **Namespace** | `/chat` (customer JWT — **not** `/admin`) |
| **Connect** | `auth: { token: "<customer_jwt>" }` — JWT must have `type: customer` |
| **Join room** | Emit **`join_customer_direct`** — **omit `customerId`** (server uses token) |
| **Join ack** | Listen **`customer_direct_joined`** → `{ customerId }` |
| **Send (optional)** | Emit **`customer_direct_message`** → `{ "content": "…" }` (REST POST is equivalent) |
| **Receive messages** | Listen **`customer_direct_message`** |
| **Staff typing** | Listen **`staff_direct_typing`** |
| **Customer typing** | Emit **`customer_direct_typing`** → `{ "isTyping": true \| false }` |
| **Errors** | Listen **`direct_chat_error`** |

Internal room name (do not hardcode for join): `customer_direct:<customerId>` — join only via **`join_customer_direct`**.

### Minimal client flow

```javascript
const socket = io(`${WS_ORIGIN}/chat`, { auth: { token: customerJwt } })

socket.emit('join_customer_direct', {})

socket.on('customer_direct_joined', ({ customerId }) => {
  // subscribed to live updates for this customer
})

socket.on('customer_direct_message', (msg) => {
  // same shape as REST message rows
})

// Always load initial thread via REST:
// GET /api/customer/chat/direct/messages?page=1&limit=50
```

When Plant (or admin/sales) sends via REST, the backend emits **`customer_direct_message`** to `/chat` and `/admin` for that room. The customer must **`join_customer_direct`** on `/chat` for live delivery; polling GET history also works.

---

## 3. Old project-channel chat (not Plant direct)

Use this only for **project / finance / construction** tabs tied to a **lead**:

| Action | Method | Path |
|--------|--------|------|
| Channels + unread | GET | `/api/customer/chat/channels?leadId=<leadId>` |
| Presence | GET | `/api/customer/chat/presence?leadId=<leadId>` |
| History | GET | `/api/customer/chat/:channel/messages?leadId=<leadId>&page=1&limit=50` |
| Send | POST | `/api/customer/chat/:channel/messages` body `{ "leadId", "content" }` |

**`:channel`:** `project` | `finance` | `construction`

These messages are **not** the same thread as Plant **`customer-direct-chat`**.

---

## 4. Staff side (reference)

| Role | History | Send |
|------|---------|------|
| Plant | `GET /api/plant/customer-direct-chat/:customerId/messages` | `POST /api/plant/customer-direct-chat/:customerId/messages` `{ "content" }` |
| Admin | `/api/admin/customer-direct-chat/...` | same |
| Sales | `/api/sales/customer-direct-chat/...` | same |

Plant socket on `/admin` for direct chat is limited to **admin/sales** roles; Plant should use **REST** for send (already working).

---

## 5. QA checklist

1. Log in as customer → confirm **`customerId`** (profile or token).
2. Plant sends: `POST /api/plant/customer-direct-chat/{customerId}/messages` with `{ "content": "test" }`.
3. Customer app: `GET /api/customer/chat/direct/messages` with that customer’s JWT → message **must** appear.
4. If step 3 fails, check whether the app UI only calls **`/chat/project/messages?leadId=`**.
5. For realtime: connect `/chat`, emit **`join_customer_direct`**, listen **`customer_direct_message`**.

---

## Related docs

- `docs/frontend-customer-direct-chat-api.md` — full direct-chat contract (customer + staff + sockets)
- `docs/plant-panel-changes-customerid-dashboard-chat-2026-10-08.md` — Plant `customerId` on projects + Plant chat wiring
- `docs/frontend-customer-app-api-full.md` — project-channel chat only (§ Communication); direct chat should be added to app integration when using Plant/staff direct thread
