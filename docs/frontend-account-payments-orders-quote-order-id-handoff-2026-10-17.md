# Account — Add Order Payment: `quoteOrderId` handoff

**Date:** 2026-10-17  
**For:** Frontend (All Payments → Add order payment)  
**Prod base:** `https://mr-storage-backend-025k.onrender.com`  
**Path prefix:** `/api/account/payments`  
**Auth:** `Authorization: Bearer <token>` · roles **`account`** | **`admin`**

---

## TL;DR

| Question | Answer |
|----------|--------|
| What is `quoteOrderId`? | The lead’s **`jobId`** string (e.g. `PRO-042`, `Q-2025-1047`) — **not** quotation Mongo `_id` |
| Easiest for forms? | Call **`GET /orders/options`**, bind dropdown to **`leadId`** or **`quoteOrderId`**, POST the same value |
| Required on POST? | **One of** `leadId` **or** `quoteOrderId` |

---

## What `quoteOrderId` is **not**

- Quotation document `_id` (`6aadb2dc464b5c58eb1a08c4`)
- Invoice number
- Customer id
- WIP record id (that’s created **by** this POST)

It **is** the project’s display job code stored on **`Lead.jobId`**, set when the lead/project is created in CRM.

`POST /api/account/payments/orders` creates or updates a **WIP / order payment** row (`WIPProfit`) for that project.

---

## How the backend finds the project

```text
POST body
  ├─ leadId present?     → Lead.findById(leadId)
  └─ else quoteOrderId?  → Lead where jobId === quoteOrderId OR _id === quoteOrderId
  └─ else                → 400 "Project / quote not found"
```

**Recommendation:** use **`leadId`** from the options API when you have it; use **`quoteOrderId`** when the UI only shows the job code.

---

## Step 1 — Populate “Select order” (required for Add Payment)

```http
GET /api/account/payments/orders/options?search=&excludeWithWip=true&limit=50
Authorization: Bearer <token>
```

| Query | Purpose |
|-------|---------|
| `search` | Filter by project name, customer name, or job id |
| `excludeWithWip=true` | Only leads **without** an existing WIP row (first-time add) |
| `limit` | Max options (1–200) |

**Response:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "options": [
      {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "quoteOrderId": "PRO-042",
        "label": "PRO-042 — Adam Gilchrist — Adam Gilchrist",
        "projectName": "Adam Gilchrist",
        "customerName": "Adam Gilchrist",
        "location": "Texas",
        "quoteValue": 1690600,
        "lifecycleStatus": "po_received",
        "hasWipRecord": false,
        "wipId": null
      }
    ],
    "total": 1
  }
}
```

**UI wiring:**

- Dropdown **label** → `option.label`
- Dropdown **value** → `option.leadId` (preferred) **or** `option.quoteOrderId`
- Optional prefill → `quoteValue`, `location`, `customerName`

---

## Step 2 — Create order payment

```http
POST /api/account/payments/orders
Authorization: Bearer <token>
Content-Type: application/json
```

**Option A — `quoteOrderId` (job id from dropdown)**

```json
{
  "quoteOrderId": "PRO-042",
  "orderValue": 1690600,
  "currentCost": 800000,
  "depositPaid": 500000,
  "progressPaid": 0,
  "finalPaid": 0,
  "status": "in_progress",
  "notes": ""
}
```

**Option B — `leadId` (Mongo id from dropdown)**

```json
{
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "depositPaid": 500000,
  "status": "in_progress"
}
```

| Field | Required | Default / notes |
|-------|----------|-----------------|
| `leadId` **or** `quoteOrderId` | One required | See Step 1 |
| `orderValue` | No | `lead.quoteValue` |
| `currentCost` | No | Sum of active **Expense** on that lead |
| `depositPaid`, `progressPaid`, `finalPaid` | No | Numbers |
| `status` | No | `in_progress` — enum: `in_progress`, `started`, `completed`, `on_hold` |
| `notes` | No | String |

**Success:** `data` = same shape as `GET /api/account/payments/orders/:orderId` (order detail for modal).

---

## Other ways to get `quoteOrderId` / `leadId`

| Source | Fields |
|--------|--------|
| `GET /api/account/payments/orders` | Each row: `orderDetails.quoteOrderId`, `leadId` |
| `GET /api/account/projects/:projectId` | `jobId` → `quoteOrderId`; `_id` / `leadId` in payload |
| `GET /api/account/invoice-management/filters` | `projects[].jobId`, `projects[].leadId` |
| `GET /api/account/customers/:customerId` | Nested projects with job/lead ids |

---

## View / update existing WIP

```http
GET /api/account/payments/orders/:orderId
PUT /api/account/payments/orders/:orderId
```

**`:orderId`** may be:

- WIP Mongo `_id`
- Lead Mongo `_id`
- Lead **`jobId`** (same string as `quoteOrderId`)

PUT uses the same payment fields as POST; project is fixed from the existing WIP.

---

## Frontend checklist

- [ ] Add Payment screen loads **`GET .../orders/options?excludeWithWip=true`**
- [ ] Store **`leadId`** or **`quoteOrderId`** from selected option
- [ ] POST includes **one** of those fields (plus deposit/progress/final/status)
- [ ] Do **not** send quotation `_id` as `quoteOrderId`
- [ ] Edit flow uses **`GET .../orders/:orderId`** then **`PUT`** with same `:orderId` from list row (`wipId` or `quoteOrderId`)

---

## curl (prod)

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN="<account_jwt>"

curl -s "$BASE/api/account/payments/orders/options?limit=5&excludeWithWip=true" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.options[0]'

curl -s -X POST "$BASE/api/account/payments/orders" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"leadId":"6aadb0a0464b5c58eb1a042b","depositPaid":100,"status":"in_progress"}' \
  | jq '.success,.message'
```

---

**See also:** [`frontend-account-payments-api.md`](./frontend-account-payments-api.md) (full payments module)
