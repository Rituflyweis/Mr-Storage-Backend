# Customer ↔ Admin direct chat (no lead)

One thread per **customer** — not tied to `leadId`. Separate from lead/AI sales chat and from customer app **project/finance/construction** channels.

Base URLs:
- Customer: **`/api/customer/chat/direct`**
- Admin: **`/api/admin/customer-direct-chat`**
- Sales: **`/api/sales/customer-direct-chat`**
- Plant: **`/api/plant/customer-direct-chat`**
- Sales (same API): **`/api/sales/customer-direct-chat`**

Auth: customer JWT (`type: customer`) or staff JWT (`admin` / `sales`).

---

## Customer app

### Summary (unread + last message)

```http
GET /api/customer/chat/direct
Authorization: Bearer <customer-token>
```

```json
{
  "success": true,
  "data": {
    "customerId": "67a…",
    "unreadCount": 2,
    "lastMessage": { "messageId": "…", "content": "…", "senderType": "admin", "createdAt": "…" }
  }
}
```

### Messages

```http
GET /api/customer/chat/direct/messages?page=1&limit=50
POST /api/customer/chat/direct/messages
Content-Type: application/json

{ "content": "I need help with my account." }
```

GET marks **staff** messages as read for the customer.

---

## Admin / sales panel

### Inbox (customers with direct chat activity)

```http
GET /api/admin/customer-direct-chat/conversations?search=adam&page=1&limit=20
Authorization: Bearer <admin-token>
```

```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "customerId": "67a…",
        "customerName": "Adam Gilchrist",
        "email": "adam@gilchrist.com",
        "company": "",
        "unreadCount": 1,
        "lastMessage": "I need help with my account.",
        "lastMessageAt": "2026-10-07T07:00:00.000Z",
        "lastSenderType": "customer"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

### Thread with one customer

```http
GET /api/admin/customer-direct-chat/:customerId/messages?page=1&limit=50
POST /api/admin/customer-direct-chat/:customerId/messages

{ "content": "Hi Adam, how can we help?" }
```

GET marks **customer** messages as read for staff.

---

## Sockets (real-time)

Connect with **`auth: { token: <jwt> }`** (customer token on `/chat`, staff token on `/admin`).

| Event | Namespace | Who | Payload |
|--------|-----------|-----|---------|
| `join_customer_direct` | `/chat` or `/admin` | Customer: no `customerId` (uses token). Staff: `{ customerId }` | |
| `leave_customer_direct` | either | `{ customerId }` optional | |
| `customer_direct_message` | either | `{ content }` — staff also `{ customerId }` | |
| `customer_direct_typing` | either | `{ customerId?, isTyping }` | |
| **Listen** `customer_direct_message` | either | Full message object | |
| **Listen** `customer_direct_chat_updated` | `/admin` | Inbox refresh hint `{ customerId, … }` | |
| **Listen** `staff_direct_typing` | `/chat` | Staff typing indicator | |
| **Listen** `customer_direct_typing` | `/admin` | Customer typing indicator | |

Room: `customer_direct:<customerId>` (internal; join via `join_customer_direct`).

---

## Message shape

```json
{
  "messageId": "68f…",
  "customerId": "67a…",
  "senderType": "customer",
  "senderId": null,
  "senderName": "Adam Gilchrist",
  "content": "Hello",
  "isReadByCustomer": true,
  "isReadByStaff": false,
  "createdAt": "2026-10-07T07:00:00.000Z"
}
```

`senderType`: `customer` | `admin` | `sales`
