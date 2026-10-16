# Customer chat → Sales & Admin inbox — frontend handoff (Oct 2026)

**Backend branch:** `shubham-changes-13-aug` (commit `b882a9c` and later)  
**Prod base:** `https://mr-storage-backend-025k.onrender.com`

**Problem addressed:** Messages sent from the **customer panel** were saved but often **did not appear** in the assigned **sales** Global Communication → **Customers** list, and **admin** was not consistently notified in real time.

**Related docs:**

- [`frontend-global-chat-ui-staff-and-customer.md`](./frontend-global-chat-ui-staff-and-customer.md) — UI pattern (Customers vs Team tabs)
- [`frontend-customer-app-direct-chat-vs-plant-reply.md`](./frontend-customer-app-direct-chat-vs-plant-reply.md) — Customer direct vs project channel APIs
- [`frontend-flow-quotation-reject-and-employee-customer-chat.md`](./frontend-flow-quotation-reject-and-employee-customer-chat.md) — Lead/socket pre-sales chat

---

## 1. What changed (backend behavior)

When a **customer** sends a message, staff should now get:

| Channel | In-app notification | Socket (real-time) | Global **Customers** inbox list |
|--------|---------------------|--------------------|----------------------------------|
| **Direct chat** `POST /api/customer/chat/direct/messages` | Assigned sales + **all admins** | `customer_direct_message`, `customer_direct_chat_updated` | Yes (unchanged model) |
| **Project tabs** `POST /api/customer/chat/:channel/messages` | Assigned sales + **all admins** | `new_message`, `new_customer_message`, `customer_direct_chat_updated` | **Yes** — message **mirrored** into direct-chat thread |
| **Widget / socket** `customer_message` on `/chat` | Same as project tabs | Same + lead room | **Yes** — mirrored into direct-chat thread |

**Sales inbox filter:** `GET …/customer-direct-chat/conversations` for role **`sales`** only returns customers who have at least one **non-terminated lead** with `assignedSales` = logged-in user. **Admin** still sees all customers with direct-chat activity.

**Assignment:** If the customer’s lead has **`assignedSales: null`**, the **sales** conversation list stays empty for that customer until admin assigns the lead (`PUT /api/admin/leads/:leadId/assign`). **Admins** still receive notifications and see the thread in their Customers list.

---

## 2. Staff — REST (Global Communication → Customers)

Use the same paths as before; behavior is enriched, not renamed.

| Panel | Conversations list | Thread history | Send reply |
|-------|-------------------|----------------|------------|
| Admin | `GET /api/admin/customer-direct-chat/conversations` | `GET /api/admin/customer-direct-chat/:customerId/messages` | `POST /api/admin/customer-direct-chat/:customerId/messages` |
| Sales | `GET /api/sales/customer-direct-chat/conversations` | `GET /api/sales/customer-direct-chat/:customerId/messages` | `POST /api/sales/customer-direct-chat/:customerId/messages` |
| Plant | `GET /api/plant/customer-direct-chat/conversations` | … | … |

**Auth:** `Authorization: Bearer <staff_token>`

### 2.1 List conversations

```http
GET /api/sales/customer-direct-chat/conversations?search=daniel&page=1&limit=20
Authorization: Bearer <token>
```

**Response `data` (unchanged shape):**

```json
{
  "conversations": [
    {
      "customerId": "67a1b2c3d4e5f6789012345a",
      "customerName": "Daniel Vittori",
      "email": "daniel@example.com",
      "company": "",
      "unreadCount": 2,
      "lastMessage": "When is delivery?",
      "lastMessageAt": "2026-10-16T06:00:00.000Z",
      "lastSenderType": "customer"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

**Sales:** Row appears only if that `customerId` has a lead assigned to **this** sales user.  
**Admin:** All customers with at least one direct-chat row (including **mirrored** project/widget messages).

### 2.2 Load thread

```http
GET /api/sales/customer-direct-chat/67a1b2c3d4e5f6789012345a/messages?page=1&limit=50
Authorization: Bearer <token>
```

Mirrored project messages may be prefixed with `[Finance]` / `[Construction]` when sent from non-`project` channels. Content is otherwise the customer’s text.

**Optional socket fields** on `customer_direct_message` / `customer_direct_chat_updated` when mirrored from a project tab:

```json
{
  "mirroredFrom": "lead",
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "channel": "project"
}
```

Use `leadId` to deep-link to project detail if needed; thread UI can stay on direct-chat messages.

### 2.3 Reply

```http
POST /api/sales/customer-direct-chat/67a1b2c3d4e5f6789012345a/messages
Authorization: Bearer <token>
Content-Type: application/json

{ "content": "We will confirm delivery Friday." }
```

Customer sees this on **`GET /api/customer/chat/direct/messages`** (not on project channel unless you also post there from staff UI).

---

## 3. Staff — Socket.IO (`/admin` namespace)

Connect with staff JWT (same as existing lead chat).

### 3.1 Rooms / joins (existing)

| Action | Event | When |
|--------|--------|------|
| Global customer thread | `join_customer_direct` `{ customerId }` | Opening Customers tab thread |
| Lead pre-sales thread | `join_lead_chat` `{ leadId }` | Lead detail chat panel |
| Auto | On connect, server joins `user:{userId}` | Required for per-user pushes |

### 3.2 Events to handle (Customers tab + badges)

| Event | Payload (summary) | UI action |
|-------|-------------------|-----------|
| `customer_direct_chat_updated` | `{ customerId, lastMessage, … }` | Refresh conversation list; bump row to top |
| `customer_direct_message` | Full message object | Append bubble if thread open |
| `new_customer_message` | `{ leadId, message }` | Toast / badge; refresh list or open lead chat |
| `new_message` | Message on `lead:{leadId}` room | Lead detail chat panel |
| `lead_list_updated` | `{ leadId, trigger: 'customer_message' }` | Refresh sales lead list / unread |

**Example `new_customer_message`:**

```json
{
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "message": {
    "_id": "68f…",
    "senderType": "customer",
    "content": "Hello",
    "createdAt": "2026-10-16T06:00:00.000Z",
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "channel": "project",
    "senderName": "Daniel"
  }
}
```

**Who receives:**

- **`admin_room`** — all admins connected on `/admin`
- **`user:{assignedSalesId}`** — assigned rep (when set)
- **`lead:{leadId}`** — anyone who joined lead chat

---

## 4. In-app notifications

New customer messages create notifications:

| Field | Value |
|-------|--------|
| `type` | `chat` |
| `title` | `New customer message` |
| `body` | Often `{projectName or jobId}: {preview}` |
| `leadId` | Present when tied to a project |

**Recipients:**

- Lead **`assignedSales`** (if set)
- **All active users with role `admin`**

Poll or subscribe: `GET /api/notifications?type=chat` (staff notifications API for your panel).

---

## 5. Customer app — send paths (unchanged URLs)

Frontend does **not** need new customer endpoints. Any of these now fan out to staff:

| Customer action | API |
|-----------------|-----|
| Direct message | `POST /api/customer/chat/direct/messages` `{ "content": "…" }` |
| Project / finance / construction tab | `POST /api/customer/chat/:channel/messages` `{ "leadId", "content" }` |
| Pre-sales widget | Socket `/chat` → `customer_message` `{ leadId, customerId, content }` |

Ensure **`leadId`** on project tabs matches the project the customer is viewing.

---

## 6. Frontend checklist

### Global Communication → **Customers** (sales + admin)

- [ ] On mount: `GET …/customer-direct-chat/conversations`
- [ ] Connect `/admin` socket; listen for **`customer_direct_chat_updated`** and refresh list
- [ ] On row click: `join_customer_direct` + `GET …/:customerId/messages`
- [ ] Show **`unreadCount`** badge from list API
- [ ] Optional: listen **`new_customer_message`** for toast when not on Customers tab

### Sales-only

- [ ] If list is empty after customer sent chat, verify lead **`assignedSales`** in admin (assign lead to that rep)
- [ ] Do not expect customers with **only** unassigned leads in the sales list

### Admin-only

- [ ] Customers list includes mirrored project/widget traffic even when sales is unassigned
- [ ] Notifications `type=chat` for all admins

### Lead detail chat (pre-sales / widget)

- [ ] Still use **`join_lead_chat`** + **`new_message`** for thread UI
- [ ] Customers tab may **also** show the same customer (mirrored line) — both UIs can stay in sync via sockets above

### Do **not** rely on

- Project channel **`Message`** REST alone for staff inbox — staff thread remains **`customer-direct-chat`** unless you build a separate project-channel staff API (not added in this change)

---

## 7. Quick QA script

1. **Admin:** Assign customer’s lead to sales user **Sales One** (`assignedSales` set, `isHandedToSales: true` recommended).
2. **Customer:** Send `POST /api/customer/chat/project/messages` with that `leadId`.
3. **Sales One:** `GET /api/sales/customer-direct-chat/conversations` → customer at top with unread.
4. **Admin:** Same list + notification `type=chat`.
5. **Both:** Socket receives `customer_direct_chat_updated` and/or `new_customer_message`.

Repeat with `POST /api/customer/chat/direct/messages` — same staff visibility (no mirror duplicate issue for single path).

---

## 8. Deployment note

Requires backend deploy including **`customerLeadChatStaff.service.js`** and updates to **`customerDirectChat.service.js`**, **`processCustomerMessage.js`**, **`customerPortal.controller.js`**.

If behavior matches old production (no mirror, no admin notify), confirm Render (or your host) built from **`shubham-changes-13-aug`** at or after commit **`b882a9c`**.

---

*Handoff version: 2026-10-16*
