# Account panel — Analytics project drill-down (income & expense detail)

**Audience:** Account panel · **Analytics → Income (project wise)** / **Expense (project wise)** → project detail (tabs, tables, modals)  
**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Prefix:** `/api/account/reports`  
**Auth:** `Authorization: Bearer <token>` · roles **`admin`** | **`account`**

**Related (list screens):** [`frontend-account-analytics-project-wise-spec.md`](./frontend-account-analytics-project-wise-spec.md)

Use Mongo **`leadId`** (or **`jobId`**) as `:leadId` — same resolution as `GET /api/account/projects/:projectId`.

---

## Response envelope

```json
{ "success": true, "message": "Success", "data": { } }
```

Amounts are **numbers in USD** (`round2`). Format lakhs/crores on the frontend.

---

## 1. Project-wise income detail

**Screen:** Row eye / project link from **Income (project wise)** → **Project Income Details**

### 1.1 Load page (header, KPIs, sidebar, table)

```http
GET /api/account/reports/project-wise-income/:leadId?tab=received&startDate=&endDate=&search=&page=1&limit=10
Authorization: Bearer <token>
```

| Query | Default | Description |
|-------|---------|-------------|
| `tab` | `received` | `received` \| `pending` \| `overdue` \| `all` — filters **Recent Income Transactions** |
| `startDate`, `endDate` | — | Filter on customer invoice **`date`** (same as portfolio income report) |
| `search` | — | Regex on invoice number, description, income type label |
| `page`, `limit` | `1`, `10` | Table pagination (max `limit` 100) |

**Invoice scope:** `invoiceType` not `vendor` / `freight_carrier`; `status` not `cancelled`.

#### Response `data`

| Field | Use on UI |
|-------|-----------|
| `project` | Header card (name, `projectId` = job id, location, quote, dates, status) |
| `summary` | Top KPI cards — **respects date filter** |
| `incomeSummarySidebar` | Right column — **all-time** for project (not date-filtered) |
| `transactions[]` | Table for active `tab` |
| `pagination` | Table footer |
| `incomeTypeOptions[]` | Dropdown in **Add Received Payment** modal |

**`project`**

| Field | Type | Notes |
|-------|------|--------|
| `leadId` | string | Mongo id |
| `projectName` | string | |
| `projectId` | string | `jobId` (e.g. `PRO-2025-1047`) |
| `status` | string | `lifecycleStatus` |
| `location` | string | |
| `quoteValue` | number | Contract / quote value |
| `startDate` | ISO date | Lead `createdAt` |
| `endDate` | ISO date \| null | Lead `endDate` |

**`summary`** (date-filtered invoices)

| Field | Rule |
|-------|------|
| `totalIncome` | Sum `totalAmount` |
| `receivedIncome` | `status === 'paid'` |
| `pendingIncome` | Unpaid, not overdue |
| `overdueIncome` | Unpaid, overdue (`dueDate` / `daysToPay`) |

**`incomeSummarySidebar`** (all invoices on project)

| Field | Rule |
|-------|------|
| `totalContractValue` | `lead.quoteValue` |
| `billedToDate` | Sum all qualifying invoice amounts |
| `totalIncome` | Same as billed to date |
| `receivedIncome` / `pendingIncome` / `overdueIncome` | All-time splits |
| `retentionAmount` | **Always `0`** until retention product exists |
| `retentionReleased` | **Always `0`** |
| `balanceToBeReceived` | `max(0, (quoteValue \|\| billedToDate) - receivedIncome)` |

**`transactions[]`**

| Field | Description |
|-------|-------------|
| `transactionId` | Invoice `_id` — use for view modal |
| `incomeType` | `milestone` \| `advance` \| `variation` \| `claims` \| `other` |
| `incomeTypeLabel` | Display (e.g. Milestone Income) |
| `date` | `paidAt` if paid, else invoice `date` |
| `description` | Invoice description |
| `invoiceNumber` | |
| `amount` | |
| `status` | `Received` \| `Pending` \| `Overdue` \| `Draft` |
| `invoiceStatus` | Raw DB status |
| `tab` | `received` \| `pending` \| `overdue` |

**Income type derivation (existing invoices):** `serviceCategory` if set to a known key; else payment schedule stage → milestone; else keyword heuristics on description.

---

### 1.2 View transaction (eye modal)

```http
GET /api/account/reports/project-wise-income/:leadId/transactions/:transactionId
Authorization: Bearer <token>
```

`:transactionId` = invoice Mongo id.

**`data`:** `{ transaction, incomeTypeLabel, project }` — `transaction` includes `lineItems`, `dueDate`, `paidAt`.

**PDF:** `GET /api/account/invoices/:transactionId/pdf`

---

### 1.3 Add Received Payment (modal)

```http
POST /api/account/reports/project-wise-income/:leadId/received
Authorization: Bearer <token>
Content-Type: application/json
```

**Body**

```json
{
  "incomeType": "milestone",
  "invoiceNumber": "INV-0018",
  "description": "Site Extra Work claim #12",
  "amount": 5000,
  "date": "2026-04-12",
  "status": "received"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `amount` | yes | Positive number |
| `date` | no | ISO date; default now |
| `description` | no | Defaults to income type label |
| `invoiceNumber` | no | If omitted, server allocates next `INV-####` |
| `incomeType` | no | Default `milestone` — see `incomeTypeOptions` on GET |
| `status` | no | `received` (default) or `pending` — `received` creates **paid** invoice |

**Behaviour**

- Creates a **customer** invoice on the project (`invoiceType: customer`, one line item).
- Stores `incomeType` in `serviceCategory` for list labelling.
- If `invoiceNumber` matches an existing invoice **on this project** and `status` is `received`, marks that invoice paid instead of creating a duplicate.
- Requires `lead.customerId`.

**Response `201`:** `{ invoice, transaction }`

---

## 2. Project-wise expense detail

**Screen:** Row eye from **Expense (project wise)** → project expense breakdown

### 2.1 Load page

```http
GET /api/account/reports/project-wise-expense/:leadId?tab=approved&startDate=&endDate=&search=&page=1&limit=10
Authorization: Bearer <token>
```

| Query | Default | Description |
|-------|---------|-------------|
| `tab` | `approved` | `approved` \| `pending` \| `all` |
| `startDate`, `endDate` | — | Filter **manual** `Expense.date` only (same rule as portfolio expense report). Email bids / freight / payment approvals in the table are **not** date-clipped. |
| `search`, `page`, `limit` | | Table search & pagination |

**`summary`** matches one row of `GET /project-wise-expense` for this lead (combined manual + vendor/material bids + freight + approvals vs budget).

**`transactions[]`**

| Field | Description |
|-------|-------------|
| `recordId` | Stable id: `manual:<id>`, `shipper:<id>`, `freight:<id>`, `approval:<id>` |
| `source` | `manual_expense` \| `vendor_material_bid` \| `freight_bid` \| `payment_approval` |
| `expenseType` | Display category (Material Cost, Manpower, …) |
| `date` | Line date |
| `description` | |
| `reference` | Expense id / ref no. |
| `amount` | |
| `approvalStatus` | `Approved` \| `Pending Approval` |
| `tab` | `approved` \| `pending` |

---

### 2.2 View record (eye modal)

```http
GET /api/account/reports/project-wise-expense/:leadId/transactions/:source/:id
Authorization: Bearer <token>
```

| `:source` | `:id` |
|-----------|--------|
| `manual` | Expense `_id` |
| `shipper` | ShipperRequest `_id` |
| `freight` | FreightBid `_id` |
| `approval` | PaymentApproval `_id` |

**`data`:** `{ record, detail, project }` — `detail` is the raw source document when available.

---

## 3. Screen → endpoint map (drill-down)

| UI | Method | Path |
|----|--------|------|
| Income detail page | GET | `/api/account/reports/project-wise-income/:leadId` |
| Income Received / Pending tabs | GET | same + `tab=received` \| `pending` \| `overdue` |
| Income row view | GET | `.../project-wise-income/:leadId/transactions/:transactionId` |
| Add Received Payment | POST | `.../project-wise-income/:leadId/received` |
| Expense detail page | GET | `/api/account/reports/project-wise-expense/:leadId` |
| Expense Approved / Pending tabs | GET | same + `tab=approved` \| `pending` |
| Expense row view | GET | `.../project-wise-expense/:leadId/transactions/:source/:id` |

**List screens (unchanged):**

| UI | GET |
|----|-----|
| Income (project wise) portfolio | `/api/account/reports/project-wise-income` |
| Expense (project wise) portfolio | `/api/account/reports/project-wise-expense` |

---

## 4. curl smoke test

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN="<account_jwt>"
LEAD="<mongo_lead_id>"

curl -s "$BASE/api/account/reports/project-wise-income/$LEAD?tab=received&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.project,.data.summary,.data.transactions[0]'

curl -s -X POST "$BASE/api/account/reports/project-wise-income/$LEAD/received" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":100,"description":"Test receipt","status":"received","incomeType":"advance"}' \
  | jq '.data.transaction'

curl -s "$BASE/api/account/reports/project-wise-expense/$LEAD?tab=pending&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary,.data.transactions[0]'
```

---

## 5. Frontend notes

- Navigate to detail with **`rows[].leadId`** from the portfolio table (not display `projectId` alone, unless your router resolves job id — backend accepts both via `resolveLeadByProjectRef`).
- **Retention** fields are placeholders (`0`); hide or show “—” until backend retention is implemented.
- For income lines created outside this API, **`PUT /api/account/invoices/:invoiceId/mark-paid`** still works for pending invoices.

---

*Doc version: 2026-10-17 · Source: `accountAnalyticsProjectDetail.service.js`, `reports.routes.js`*
