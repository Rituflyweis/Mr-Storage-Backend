# Account panel — `quoteOrderId` on `POST /api/account/payments/orders`

**Audience:** Frontend / integrators (e.g. Add Order Payment, WIP payment forms)  
**Base:** `/api/account/payments`  
**Auth:** `Authorization: Bearer <token>` · roles **`admin`** | **`account`**

**Related:** [`frontend-account-payments-api.md`](./frontend-account-payments-api.md)  
**Share with frontend (dated handoff):** [`frontend-account-payments-orders-quote-order-id-handoff-2026-10-17.md`](./frontend-account-payments-orders-quote-order-id-handoff-2026-10-17.md)

---

## What is `quoteOrderId`?

On **`POST /api/account/payments/orders`**, `quoteOrderId` is **not**:

- A Quotation document Mongo `_id`
- An invoice number
- A customer id

It **is** the project’s **public job / order code** on the lead: the **`Lead.jobId`** field. The UI may label this “Quote/Order ID”, “Project ID”, or similar (examples: `Q-2025-1047`, `PRO-042`, `QUO-990-009`).

New leads get a generated `jobId` when created (see `Lead` model pre-save).

This POST creates or updates a **`WIPProfit`** (work-in-progress / order payment) row for that **project (lead)**.

---

## How the backend resolves the project

Send **at least one** of:

| Body field | Meaning |
|------------|---------|
| **`leadId`** | MongoDB `Lead._id` (recommended if you already have it from lists) |
| **`quoteOrderId`** | String equal to **`Lead.jobId`**, or in some cases the lead `_id` string |

Resolution logic:

1. If **`leadId`** is present → load lead by `_id`.
2. Else if **`quoteOrderId`** is present → find lead where `jobId === quoteOrderId` **or** `_id === quoteOrderId`.
3. Else → error: **`Project / quote not found`**.

You can use **`leadId` only** and omit `quoteOrderId` on POST.

---

## How to get `quoteOrderId` (and `leadId`)

### 1. Order dropdown — best for “Select order” on Add Payment

```http
GET /api/account/payments/orders/options?search=warehouse&excludeWithWip=true&limit=50
Authorization: Bearer <token>
```

| Query | Purpose |
|-------|---------|
| `search` | Project name, customer, or job id |
| `excludeWithWip=true` | Only projects **without** an existing WIP record (first-time add) |
| `limit` | Max options (default capped server-side) |

**Response `data.options[]` (typical):**

| Field | Use |
|-------|-----|
| **`quoteOrderId`** | Submit in POST body (same as `jobId`) |
| **`leadId`** | Alternative POST body field |
| `label` | Dropdown display (job id + customer + project) |
| `projectName`, `customerName`, `location`, `quoteValue` | Form prefill |
| `hasWipRecord`, `wipId` | Whether WIP already exists |

**Frontend:** bind the select to `quoteOrderId` or `leadId`; POST the same value.

---

### 2. All Payments table (existing WIP rows)

```http
GET /api/account/payments/orders?page=1&limit=20
Authorization: Bearer <token>
```

Each row includes **`quoteOrderId`** (from `lead.jobId`). Use for view/edit flows and **`PUT /api/account/payments/orders/:orderId`**.

---

### 3. Project / customer APIs

Any response that includes the lead:

- **`jobId`** → use as `quoteOrderId`
- **`leadId`** or lead **`_id`** → use as `leadId` on POST

Examples:

- `GET /api/account/projects/:projectId` → project header / financial context
- Analytics project-wise rows: **`projectId`** in JSON is **`jobId`** (display id); **`leadId`** is Mongo id
- `GET /api/account/customers/:customerId` → nested projects

Project detail `actionLinks` may include:

```text
/api/account/payments/orders/{leadId}
```

(`:orderId` on GET/PUT can be **WIP id**, **leadId**, or **jobId**.)

---

## POST — create / upsert order payment

```http
POST /api/account/payments/orders
Authorization: Bearer <token>
Content-Type: application/json
```

**Example A — using quote order id**

```json
{
  "quoteOrderId": "Q-2025-1047",
  "orderValue": 12500,
  "currentCost": 8000,
  "depositPaid": 5000,
  "progressPaid": 0,
  "finalPaid": 0,
  "status": "in_progress",
  "notes": ""
}
```

**Example B — using lead id (preferred when available)**

```json
{
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "orderValue": 12500,
  "depositPaid": 5000,
  "status": "in_progress"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `leadId` or `quoteOrderId` | One of two | See resolution above |
| `orderValue` | No | Defaults to `lead.quoteValue` |
| `currentCost` | No | Defaults to sum of active **Expense** on project |
| `depositPaid`, `progressPaid`, `finalPaid` | No | Numeric |
| `status` | No | WIP status enum (e.g. `in_progress`, `completed`) |
| `notes` | No | String |

**Success:** WIP saved; response includes mapped order detail (same shape as `GET .../orders/:orderId`).

---

## GET detail / PUT update

```http
GET /api/account/payments/orders/:orderId
PUT /api/account/payments/orders/:orderId
```

**`:orderId`** can be:

- WIP (`WIPProfit`) Mongo `_id`
- Lead Mongo `_id`
- Lead **`jobId`** (same as `quoteOrderId`)

PUT updates payments on the existing WIP; body fields are the same as POST (except project is taken from the resolved WIP lead).

---

## Quick reference

| Question | Answer |
|----------|--------|
| What do I put in `quoteOrderId`? | The lead’s **`jobId`** string from `GET .../orders/options` or list rows |
| Easier alternative? | Send **`leadId`** from the same options/list |
| Where does `jobId` come from? | Assigned when the lead/project is created in CRM |
| Is it the quotation `_id`? | **No** — use lead `jobId` or `leadId` |

---

## curl smoke test

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN="<account_jwt>"

curl -s "$BASE/api/account/payments/orders/options?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.options[0] | {leadId, quoteOrderId, label}'

QUOTE=$(curl -s "$BASE/api/account/payments/orders/options?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.options[0].quoteOrderId')

curl -s -X POST "$BASE/api/account/payments/orders" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"quoteOrderId\":\"$QUOTE\",\"depositPaid\":100,\"status\":\"in_progress\"}" \
  | jq '.success,.message,.data.orderDetails'
```

---

*Doc version: 2026-10-17 · Source: `accountPayments.service.js` (`resolveLeadForOrder`, `listOrderOptions`, `upsertOrder`)*
