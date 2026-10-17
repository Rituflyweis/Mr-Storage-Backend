# Account panel — Analytics (project-wise income, expense, related reports)

**Audience:** Account panel · sidebar **Analytics**  
**Base:** `https://mr-storage-backend-025k.onrender.com`  
**Prefix:** `/api/account/reports` (plus related `/api/account/financial/profit-loss/*`)  
**Auth:** `Authorization: Bearer <token>` · roles **`admin`** | **`account`**

**Companion (UI map):** [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) §8  
**Example payloads (shorter):** [`frontend-account-new-apis-handoff.md`](./frontend-account-new-apis-handoff.md) §4

---

## Response envelope

All successful JSON responses:

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Errors use the same envelope with `success: false` and HTTP 4xx/5xx (validation, auth).

**Amounts:** Numbers in **USD**, typically rounded to 2 decimals (`round2`). No currency field on these endpoints.

**IDs:**

| Field | Meaning |
|-------|---------|
| `leadId` | MongoDB `ObjectId` string — use for `GET /api/account/projects/:projectId` detail when your route expects lead id (see project routes doc) |
| `projectId` on table rows | Display job id from lead **`jobId`** (e.g. `"PRO-042"`) — **not** the Mongo id |

---

## Shared query parameters

Used on **`project-wise-income`** and **`project-wise-expense`** unless noted.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Table pagination (lead list), min 1 |
| `limit` | integer | `10` | Page size, clamped **1–100** |
| `search` | string | — | Case-insensitive regex on lead **`projectName`** or **`jobId`** |
| `startDate` | ISO 8601 date | — | Inclusive start (server sets time to start of day parsing) |
| `endDate` | ISO 8601 date | — | Inclusive end (**end of day** 23:59:59.999 applied server-side) |
| `months` | integer | `6` | Length of overview chart, clamped **1–12** (calendar months ending **current month**) |

**Lead scope (both endpoints):** Non-archived, non-terminated leads (`isArchived ≠ true`, `isTerminated ≠ true`). Table is **paginated over leads**, not over invoices/expense lines.

**Date filters — important:**

| Endpoint | What `startDate` / `endDate` filter |
|----------|--------------------------------------|
| **Project-wise income** | Customer **invoice `date`** only |
| **Project-wise expense** | **Manual** `Expense.date` only |

Email bid amounts (vendor/material `ShipperRequest`, selected `FreightBid`) and **`ProjectBudget`** totals in expense rollups are **not** clipped by `startDate`/`endDate`; only manual ledger rows are. Overview charts use calendar month buckets; each bucket applies the same rule (manual expenses by `date` in that month; bids unscoped by date).

---

## 1. Project-wise income

**Screen:** Analytics → **Income (Project wise)**

### Request

```http
GET /api/account/reports/project-wise-income?search=&startDate=2026-01-01&endDate=2026-12-31&page=1&limit=10&months=6
Authorization: Bearer <token>
```

No request body.

### Income data rules

- **Invoices included:** `invoiceType` **not** in `vendor`, `freight_carrier`; `status` **not** `cancelled`.
- **Portfolio summary & row totals:** Sum `totalAmount` per invoice in the date filter (if any).
- **Received:** `status === 'paid'`.
- **Overdue:** Unpaid and due date (explicit `dueDate` or computed from `date` + `daysToPay`) **before** now.
- **Pending:** Unpaid and **not** overdue.
- **`receivedPct` on row:** `(receivedIncome / totalIncome) * 100`, or `0` if `totalIncome === 0`.

### Response `data` — full shape

```json
{
  "summary": {
    "totalIncome": 1690600,
    "receivedIncome": 1200000,
    "pendingIncome": 390600,
    "overdueIncome": 100000
  },
  "incomeOverviewChart": [
    {
      "label": "May 2026",
      "totalIncome": 450000,
      "receivedIncome": 300000,
      "pendingIncome": 150000
    }
  ],
  "incomeByProjectThisMonth": {
    "total": 280000,
    "segments": [
      {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Adam Gilchrist",
        "amount": 180000,
        "pct": 64.29
      }
    ]
  },
  "rows": [
    {
      "leadId": "6aadb0a0464b5c58eb1a042b",
      "projectName": "Adam Gilchrist",
      "projectId": "PRO-042",
      "totalIncome": 1690600,
      "receivedIncome": 1690600,
      "pendingIncome": 0,
      "overdueIncome": 0,
      "receivedPct": 100
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 64,
    "totalPages": 7
  }
}
```

### Field reference — `summary`

| Field | Type | Description |
|-------|------|-------------|
| `totalIncome` | number | Sum of all qualifying invoice amounts (filtered by invoice date) |
| `receivedIncome` | number | Subset with status `paid` |
| `pendingIncome` | number | Unpaid, not overdue |
| `overdueIncome` | number | Unpaid, overdue |

### Field reference — `incomeOverviewChart[]`

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | e.g. `"Oct 2026"` (`en-US` short month + year) |
| `totalIncome` | number | Invoices with `date` in that calendar month |
| `receivedIncome` | number | Paid portion in that month |
| `pendingIncome` | number | Unpaid portion in that month (**includes overdue**; chart does not split overdue) |

Chart months: **`months`** rolling backward from **current** month. **Independent** of `startDate`/`endDate` (those only affect which invoices load into memory for summary/rows; chart still iterates last N calendar months from filtered invoice set).

### Field reference — `incomeByProjectThisMonth`

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Sum of invoice amounts in **current calendar month** |
| `segments[]` | array | Only projects with `amount > 0` on **current page of leads** |
| `segments[].leadId` | string | Lead id |
| `segments[].projectName` | string | |
| `segments[].amount` | number | Invoice total for that lead this month |
| `segments[].pct` | number | Share of `total` (0 if `total === 0`) |

**UI note:** Donut is built from **paginated** `rows` lead set, not all portfolio leads. For a portfolio-wide donut, either request a large `limit` or aggregate client-side from a dedicated export (not provided).

### Field reference — `rows[]`

| Field | Type | Description |
|-------|------|-------------|
| `leadId` | string | Mongo id |
| `projectName` | string | May be empty string |
| `projectId` | string | `jobId` |
| `totalIncome` | number | |
| `receivedIncome` | number | |
| `pendingIncome` | number | |
| `overdueIncome` | number | |
| `receivedPct` | number | 0–100, one decimal via `round2` |

### Field reference — `pagination`

| Field | Type |
|-------|------|
| `page` | number |
| `limit` | number |
| `total` | number | Total **leads** matching search |
| `totalPages` | number |

---

## 2. Project-wise expense

**Screen:** Analytics → **Expense (Project wise)**

### Request

```http
GET /api/account/reports/project-wise-expense?search=&startDate=2026-01-01&endDate=2026-12-31&page=1&limit=10&months=6
Authorization: Bearer <token>
```

### Expense data rules

**Total expense (per lead / portfolio):**

`manual Expense` (active) + **vendor/material** from email bids (`ShipperRequest` valued via `quoteValue` or sum of `VendorQuoteLine`) + **freight** from `FreightBid` where `status === 'selected'` on project deliveries.

| Bucket | Rule |
|--------|------|
| **Approved expense** | Manual: status `approved` or `paid` (or other non-pending → treated approved). Vendor: shipper `approved`. Freight: selected bids (counted approved). Plus `PaymentApproval` with status `approved`. |
| **Pending approval** | Manual: `pending` or missing status. Vendor: shipper in `submitted`, `comparison_completed`, `comparison_processing`, `resubmit_requested`. Plus payment approvals `pending`, `under_review`, `disputed`. |
| **Budgeted expense** | Sum of `ProjectBudget.totalBudget` per lead (via `resolveTotalBudget` on portfolio aggregate). **Not** date-filtered. |
| **Budget variance** | `totalExpense - budgetedExpense` |
| **variancePct** (row) | `((totalExpense - budgetedExpense) / budgetedExpense) * 100` if budget > 0, else `0` |

**Category cards (`expenseByCategoryThisMonth`, `topExpenseCategoriesThisMonth`):** Same keys; `topExpenseCategoriesThisMonth` is a duplicate array of category cards for the current month (manual categorization + material/freight rolled into categories).

Manual `Expense.category` → bucket mapping:

| Expense category (lowercase) | Chart key |
|------------------------------|-----------|
| `materials` | `materialCost` |
| `labour` | `manpowerCost` |
| `transport`, `logistics`, `equipment` | `logisticsCost` |
| `subcontractor`, `permits`, `site` | `siteCost` |
| `office`, `administrative`, `utilities` | `administrativeCost` |
| (else) | rolled into `administrativeCost` card as part of `administrativeCost + miscellaneous` |

### Response `data` — full shape

```json
{
  "summary": {
    "totalExpense": 16372811,
    "approvedExpense": 16311315,
    "pendingApproval": 61496,
    "budgetedExpense": 160000,
    "budgetVariance": 16212811,
    "sources": {
      "manualExpenses": 17711,
      "vendorMaterialFromEmailBids": 11468368,
      "freightFromEmailBids": 4886732
    }
  },
  "expenseOverviewChart": [
    {
      "label": "Oct 2026",
      "totalExpense": 16355100,
      "approvedExpense": 16295104,
      "pendingApproval": 59996
    }
  ],
  "expenseByCategoryThisMonth": [
    {
      "key": "materialCost",
      "label": "Material Cost",
      "amount": 11468368,
      "color": "blue"
    },
    {
      "key": "manpowerCost",
      "label": "Manpower Cost",
      "amount": 12000,
      "color": "green"
    },
    {
      "key": "logisticsCost",
      "label": "Freight & Logistics",
      "amount": 4886732,
      "color": "orange"
    },
    {
      "key": "siteCost",
      "label": "Site/Project Expense",
      "amount": 0,
      "color": "purple"
    },
    {
      "key": "administrativeCost",
      "label": "Administrative Expense",
      "amount": 17711,
      "color": "pink"
    }
  ],
  "topExpenseCategoriesThisMonth": [],
  "rows": [
    {
      "leadId": "6a6b63cc63a85950372e1da6",
      "projectName": "Sample Project",
      "projectId": "PRO-001",
      "status": "payment_done",
      "totalExpense": 250000,
      "approvedExpense": 240000,
      "pendingApproval": 10000,
      "budgetedExpense": 200000,
      "budgetVariance": 50000,
      "variancePct": 25,
      "sources": {
        "manualExpenses": 5000,
        "vendorMaterialFromEmailBids": 200000,
        "freightFromEmailBids": 45000
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 64,
    "totalPages": 7
  }
}
```

### Field reference — `summary.sources`

| Field | Type | Description |
|-------|------|-------------|
| `manualExpenses` | number | Sum of active manual expense amounts (date-filtered when query dates set) |
| `vendorMaterialFromEmailBids` | number | Approved + pending shipper quote totals |
| `freightFromEmailBids` | number | Selected freight bids |

### Field reference — category card

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | `materialCost` \| `manpowerCost` \| `logisticsCost` \| `siteCost` \| `administrativeCost` |
| `label` | string | Display label |
| `amount` | number | Current **calendar month** (portfolio, all scoped leads) |
| `color` | string | UI hint: `blue`, `green`, `orange`, `purple`, `pink` |

### Field reference — `rows[]`

| Field | Type | Description |
|-------|------|-------------|
| `leadId` | string | |
| `projectName` | string | |
| `projectId` | string | `jobId` |
| `status` | string | Lead **`lifecycleStatus`** |
| `totalExpense` | number | |
| `approvedExpense` | number | |
| `pendingApproval` | number | |
| `budgetedExpense` | number | From project budget |
| `budgetVariance` | number | |
| `variancePct` | number | |
| `sources` | object | Same three keys as `summary.sources`, per lead |

---

## 3. Profit / Loss Analysis (reports route)

**Screen:** Analytics → **Profit/Loss Analysis** (legacy/alternate aggregate view)

Different from **Margin Breakdown → P&L table** (`/api/account/financial/profit-loss/summary`).

### Request

```http
GET /api/account/reports/profit-loss?leadId=&page=1&limit=20&startDate=&endDate=
Authorization: Bearer <token>
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `leadId` | MongoId | — | Filter invoice list to one project |
| `page` | number | `1` | Paginates **invoice rows** |
| `limit` | number | `20` | |
| `startDate`, `endDate` | ISO | — | Invoice filter on **`createdAt`**; expense side for summary uses **`Expense.date`** |

### Response `data`

```json
{
  "rows": [
    {
      "orderId": "68f0123456789abcdef01234",
      "invoiceNumber": "INV-2026-001",
      "projectName": "Adam Gilchrist",
      "projectId": "PRO-042",
      "revenue": 845300,
      "expense": 620000,
      "netProfit": 225300,
      "margin": 26.7,
      "status": "paid",
      "date": "2026-09-15T10:00:00.000Z"
    }
  ],
  "total": 42,
  "summary": {
    "totalRevenue": 5000000,
    "totalExpense": 3800000,
    "netProfit": 1200000,
    "avgMargin": 24
  },
  "expenseByCategory": {
    "materials": 2000000,
    "labour": 800000
  },
  "monthlyTrend": [
    {
      "label": "May",
      "revenue": 400000,
      "expense": 300000,
      "profit": 100000
    }
  ]
}
```

| Field | Notes |
|-------|--------|
| `rows[].orderId` | Invoice `_id` |
| `rows[].expense` | **Combined** project expense for that lead (`aggregateProjectExpensesByLeadMap` **totalExpense**, **no** date filter on expense side per row) |
| `rows[].margin` | `(netProfit / revenue) * 100`, one decimal |
| `summary.totalExpense` | All active expenses (date on `date`) **plus** email bid totals for all non-terminated leads |
| `monthlyTrend` | Fixed **6** months; invoice `createdAt`, expense `date`; **does not** include bid freight in monthly expense loop (manual expenses only in trend) |

---

## 4. Cash flow (reports)

**Optional analytics screen / export**

```http
GET /api/account/reports/cash-flow?startDate=&endDate=
Authorization: Bearer <token>
```

`startDate`/`endDate` on query are passed to `buildDateFilter(..., 'createdAt')` but the handler **ignores** them for the 12-month loop (implementation builds last **12** calendar months from “now”).

### Response `data`

```json
{
  "points": [
    {
      "label": "Nov 2025",
      "inflow": 120000,
      "outflow": 80000,
      "net": 40000
    }
  ],
  "summary": {
    "totalInflow": 1500000,
    "totalOutflow": 1100000,
    "netCashFlow": 400000
  }
}
```

| Field | Rule |
|-------|------|
| `inflow` | Invoices `status === 'paid'` with `paidAt` in month |
| `outflow` | Active expenses with `date` in month |

---

## 5. Profit & Loss summary table (financial — Margin Breakdown tab)

**Screen:** Payments → **Margin Breakdown** → Profit & Loss Summary table (not the same as §3)

```http
GET /api/account/financial/profit-loss/summary?search=&page=1&limit=10&startDate=&endDate=&projectId=&leadId=&businessUnit=&company=&period=
Authorization: Bearer <token>
```

**Validation:** `projectId` / `leadId` must be MongoId; `page` ≥ 1; `limit` 1–100; `period` optional `monthly` \| `quarterly` \| `yearly` when dates omitted.

**Lead filter:** `quoteValue > 0`, not terminated; optional search on name/jobId; optional business unit.

**Date filter:** Applied to P&L builder on **`date`** field inside `buildPeriodPL` (paid invoice / expense logic for margin service).

### Response `data`

```json
{
  "rows": [
    {
      "leadId": "67a1b2c3d4e5f6789012345b",
      "projectName": "Project A",
      "jobId": "2025001",
      "category": "steel",
      "salesUSD": 1245360,
      "cogsUSD": 1012180,
      "grossProfitUSD": 233180,
      "grossMarginPct": 18.72
    }
  ],
  "total": 15,
  "page": 1,
  "limit": 10
}
```

Use **`jobId`** here (not `projectId`) for the job column.

---

## 6. Screen → endpoint map

| Figma / sidebar | Primary API |
|-----------------|-------------|
| Income (project wise) | `GET /api/account/reports/project-wise-income` |
| Expense (project wise) | `GET /api/account/reports/project-wise-expense` |
| Profit/Loss Analysis (analytics) | `GET /api/account/reports/profit-loss` |
| Margin Breakdown → P&L table | `GET /api/account/financial/profit-loss/summary` |
| Margin Breakdown → P&L detail / export | `GET /api/account/financial/profit-loss`, `…/export` |
| Row “eye” → project financial detail | `GET /api/account/projects/:id` (lead id) |

---

## 7. curl smoke test

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN="<account_or_admin_jwt>"

curl -s "$BASE/api/account/reports/project-wise-income?page=1&limit=5&months=6" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary,.data.rows[0],.data.pagination'

curl -s "$BASE/api/account/reports/project-wise-expense?page=1&limit=5&months=6" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary,.data.rows[0].sources'
```

---

*Spec version: 2026-10-16 · Source: `accountAnalyticsReports.service.js`, `reports.controller.js`, `projectExpenseAggregate.util.js`*
