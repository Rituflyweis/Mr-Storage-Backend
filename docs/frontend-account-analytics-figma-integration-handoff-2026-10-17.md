# Account Analytics — Figma screens integration handoff

**Date:** 2026-10-17  
**Audience:** Frontend developers  
**Prod base:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `account`, `admin`

This document maps **every Analytics sidebar screen** from the shared Figma (Income project-wise list + detail, Expense project-wise list + detail, Profit/Loss Analysis) to **live APIs** with copy-paste **request / response** examples.

---

## Conventions

### JSON envelope

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Errors: `{ "success": false, "message": "…" }` with HTTP `400` / `401` / `403` / `404`.

### IDs

| Field | Meaning |
|-------|---------|
| `leadId` | MongoDB `Lead._id` — **use for drill-down URLs** from table `rows[].leadId` |
| `projectId` on rows | Display job id = `Lead.jobId` (e.g. `PRO-2025-1047`, `PRO-042`) |

**Drill-down paths** accept **either** Mongo `leadId` **or** `jobId` string in `:leadId`.

### Amounts

Numbers in **USD**, usually 2 decimal places. Format lakhs/crores in UI only.

### Shared list query params

Used on **project-wise income** and **project-wise expense** list screens:

| Param | Default | Description |
|-------|---------|-------------|
| `page` | `1` | Table page |
| `limit` | `10` | 1–100 |
| `search` | — | Regex on `projectName` or `jobId` |
| `startDate`, `endDate` | — | ISO dates (inclusive; end = end of day) |
| `months` | `6` | Chart length 1–12 (calendar months ending current month) |

**Date filter rules:**

- **Income list:** filters customer **invoice `date`**
- **Expense list:** filters **manual** `Expense.date` only (email bids / budget rollups in summary are not date-clipped the same way — see field notes)

---

## Screen A — Income (Project wise) — portfolio list

**Figma:** Analytics → **Income (Project wise)** — KPI cards, chart, donut, project table, eye icon.

### Request

```http
GET /api/account/reports/project-wise-income?search=&startDate=2026-01-01&endDate=2026-12-31&page=1&limit=10&months=6
Authorization: Bearer <token>
```

### Response `data` (example)

```json
{
  "summary": {
    "totalIncome": 13750000,
    "receivedIncome": 10550000,
    "pendingIncome": 2500000,
    "overdueIncome": 700000
  },
  "incomeOverviewChart": [
    {
      "label": "Nov 2025",
      "totalIncome": 2100000,
      "receivedIncome": 1800000,
      "pendingIncome": 300000
    },
    {
      "label": "Dec 2025",
      "totalIncome": 2400000,
      "receivedIncome": 2000000,
      "pendingIncome": 400000
    }
  ],
  "incomeByProjectThisMonth": {
    "total": 4860000,
    "segments": [
      {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Alpha Infra Project",
        "amount": 1800000,
        "pct": 37.04
      },
      {
        "leadId": "6aadb0b0464b5c58eb1a043c",
        "projectName": "Riverside Building",
        "amount": 1200000,
        "pct": 24.69
      }
    ]
  },
  "rows": [
    {
      "leadId": "6aadb0a0464b5c58eb1a042b",
      "projectName": "Alpha Infra Project",
      "projectId": "PRO-2025-1047",
      "totalIncome": 1250000,
      "receivedIncome": 1000000,
      "pendingIncome": 200000,
      "overdueIncome": 50000,
      "receivedPct": 80
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

### UI mapping

| Figma element | JSON path |
|---------------|-----------|
| Total / Received / Pending / Overdue KPIs | `summary.*` |
| Income overview chart | `incomeOverviewChart[]` |
| Donut “this month” | `incomeByProjectThisMonth` |
| Table rows | `rows[]` |
| Eye → project income detail | Navigate with `rows[].leadId` → **Screen B** |

---

## Screen B — Project-wise Income Details (drill-down)

**Figma:** Project header, KPI cards, **right sidebar** (contract / retention), **Received | Pending** tabs, transactions table, **+ Add Received Income**, eye on row.

### B1 — Load page (tab + table + sidebar)

```http
GET /api/account/reports/project-wise-income/6aadb0a0464b5c58eb1a042b?tab=received&startDate=2026-01-01&endDate=2026-12-31&search=&page=1&limit=10
Authorization: Bearer <token>
```

Alternate URL (job id):

```http
GET /api/account/reports/project-wise-income/PRO-2025-1047?tab=pending&page=1&limit=10
Authorization: Bearer <token>
```

| Query | Default | Values |
|-------|---------|--------|
| `tab` | `received` | `received`, `pending`, `overdue`, `all` |
| `startDate`, `endDate` | — | Filter invoice **`date`** (KPI cards `summary`) |
| `search` | — | Invoice #, description, income type label |
| `page`, `limit` | `1`, `10` | Table pagination |

#### Response `data` (example)

```json
{
  "project": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Alpha Infra Project",
    "projectId": "PRO-2025-1047",
    "status": "po_received",
    "location": "Pune, Maharashtra",
    "quoteValue": 12500,
    "startDate": "2024-10-10T00:00:00.000Z",
    "endDate": "2025-10-10T00:00:00.000Z"
  },
  "summary": {
    "totalIncome": 1250000,
    "receivedIncome": 1000000,
    "pendingIncome": 200000,
    "overdueIncome": 50000
  },
  "incomeSummarySidebar": {
    "totalContractValue": 12500,
    "billedToDate": 1250000,
    "totalIncome": 1250000,
    "receivedIncome": 1000000,
    "pendingIncome": 200000,
    "overdueIncome": 50000,
    "retentionAmount": 0,
    "retentionReleased": 0,
    "balanceToBeReceived": 3180000
  },
  "transactions": [
    {
      "transactionId": "6aadb352464b5c58eb1a0a64",
      "incomeType": "milestone",
      "incomeTypeLabel": "Milestone Income",
      "date": "2026-04-30T00:00:00.000Z",
      "description": "Structure Completion - Phase 3",
      "invoiceNumber": "INV-001",
      "amount": 2500000,
      "status": "Received",
      "invoiceStatus": "paid",
      "tab": "received"
    },
    {
      "transactionId": "6aadb352464b5c58eb1a0a65",
      "incomeType": "advance",
      "incomeTypeLabel": "Advance Received",
      "date": "2026-04-29T00:00:00.000Z",
      "description": "Advance on contract",
      "invoiceNumber": "INV-002",
      "amount": 2500000,
      "status": "Pending",
      "invoiceStatus": "sent",
      "tab": "pending"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 2,
    "totalPages": 1
  },
  "incomeTypeOptions": [
    { "key": "milestone", "label": "Milestone Income" },
    { "key": "advance", "label": "Advance Received" },
    { "key": "variation", "label": "Variation Order" },
    { "key": "claims", "label": "Claims & Adjustments" },
    { "key": "other", "label": "Other Income" }
  ]
}
```

| Figma | JSON |
|-------|------|
| Header (name, PRO id, location, quote, dates) | `project` |
| Top 4 KPI cards (date-filtered) | `summary` |
| Right sidebar (contract, billed, retention, balance) | `incomeSummarySidebar` |
| **Retention** rows | Always **`0`** until product adds retention |
| **Received** tab | `tab=received` |
| **Pending** tab | `tab=pending` (overdue lines use `tab=overdue` if you add a third tab) |
| Table columns | `transactions[]` |
| Add modal income type dropdown | `incomeTypeOptions[]` |

### B2 — View transaction (eye modal)

```http
GET /api/account/reports/project-wise-income/6aadb0a0464b5c58eb1a042b/transactions/6aadb352464b5c58eb1a0a64
Authorization: Bearer <token>
```

#### Response `data` (example)

```json
{
  "transaction": {
    "transactionId": "6aadb352464b5c58eb1a0a64",
    "incomeType": "milestone",
    "incomeTypeLabel": "Milestone Income",
    "date": "2026-04-30T00:00:00.000Z",
    "description": "Structure Completion - Phase 3",
    "invoiceNumber": "INV-001",
    "amount": 2500000,
    "status": "Received",
    "invoiceStatus": "paid",
    "tab": "received",
    "dueDate": "2026-05-15T00:00:00.000Z",
    "paidAt": "2026-04-30T12:00:00.000Z",
    "lineItems": [
      {
        "description": "Structure Completion - Phase 3",
        "quantity": 1,
        "rate": 2500000,
        "effectiveRate": 2500000,
        "total": 2500000
      }
    ],
    "subtotal": 2500000,
    "totalAmount": 2500000
  },
  "incomeTypeLabel": "Milestone Income",
  "project": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Alpha Infra Project",
    "projectId": "PRO-2025-1047",
    "status": "po_received",
    "location": "Pune, Maharashtra",
    "quoteValue": 12500,
    "startDate": "2024-10-10T00:00:00.000Z",
    "endDate": "2025-10-10T00:00:00.000Z"
  }
}
```

**Invoice PDF:** `GET /api/account/invoices/:transactionId/pdf`

### B3 — Add Received Payment (modal → Save)

```http
POST /api/account/reports/project-wise-income/6aadb0a0464b5c58eb1a042b/received
Authorization: Bearer <token>
Content-Type: application/json
```

#### Request body (matches Figma modal)

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
| `incomeType` | no | `milestone`, `advance`, `variation`, `claims`, `other` |
| `invoiceNumber` | no | Auto `INV-####` if omitted |
| `description` | no | Defaults to income type label |
| `date` | no | ISO date |
| `status` | no | `received` (default, creates **paid** invoice) or `pending` |

#### Response `201` `data` (example)

```json
{
  "invoice": {
    "_id": "67f1a2b3c4d5e6f789012345",
    "invoiceNumber": "INV-0018",
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "totalAmount": 5000,
    "status": "paid",
    "serviceCategory": "milestone"
  },
  "transaction": {
    "transactionId": "67f1a2b3c4d5e6f789012345",
    "incomeType": "milestone",
    "incomeTypeLabel": "Milestone Income",
    "date": "2026-04-12T00:00:00.000Z",
    "description": "Site Extra Work claim #12",
    "invoiceNumber": "INV-0018",
    "amount": 5000,
    "status": "Received",
    "invoiceStatus": "paid",
    "tab": "received"
  }
}
```

After save, **refresh** GET detail with current `tab`.

---

## Screen C — Expense (Project wise) — portfolio list

**Figma:** KPI cards, expense overview chart, category donut, project table, eye icon, bottom category cards.

### Request

```http
GET /api/account/reports/project-wise-expense?search=&startDate=2026-01-01&endDate=2026-12-31&page=1&limit=10&months=6
Authorization: Bearer <token>
```

### Response `data` (example)

```json
{
  "summary": {
    "totalExpense": 36240000,
    "approvedExpense": 31580000,
    "pendingApproval": 4660000,
    "budgetedExpense": 37500000,
    "budgetVariance": -1260000,
    "sources": {
      "manualExpenses": 12000000,
      "vendorMaterialFromEmailBids": 18000000,
      "freightFromEmailBids": 6240000
    }
  },
  "expenseOverviewChart": [
    {
      "label": "Nov 2025",
      "totalExpense": 5200000,
      "approvedExpense": 4800000,
      "pendingApproval": 400000
    }
  ],
  "expenseByCategoryThisMonth": [
    { "key": "materialCost", "label": "Material Cost", "amount": 127000, "color": "blue" },
    { "key": "manpowerCost", "label": "Manpower Cost", "amount": 7389000, "color": "green" },
    { "key": "logisticsCost", "label": "Freight & Logistics", "amount": 5547000, "color": "orange" },
    { "key": "siteCost", "label": "Site/Project Expense", "amount": 3705000, "color": "purple" },
    { "key": "administrativeCost", "label": "Administrative Expense", "amount": 2855000, "color": "pink" }
  ],
  "topExpenseCategoriesThisMonth": [],
  "rows": [
    {
      "leadId": "6aadb0a0464b5c58eb1a042b",
      "projectName": "Alpha Infra project",
      "projectId": "PRO-2025-1047",
      "status": "in_production",
      "totalExpense": 12840000,
      "approvedExpense": 11200000,
      "pendingApproval": 1640000,
      "budgetedExpense": 700000,
      "budgetVariance": -660000,
      "variancePct": -4.89,
      "sources": {
        "manualExpenses": 4000000,
        "vendorMaterialFromEmailBids": 7000000,
        "freightFromEmailBids": 1840000
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 42,
    "totalPages": 5
  }
}
```

Note: `topExpenseCategoriesThisMonth` duplicates category cards in current API; bind either array.

### UI mapping

| Figma | JSON |
|-------|------|
| 5 KPI cards | `summary` |
| Expense overview chart | `expenseOverviewChart[]` |
| Expense by category donut | `expenseByCategoryThisMonth[]` |
| Project-wise expense list | `rows[]` |
| Top expense category cards (bottom) | Same category array |
| Eye → expense detail | `rows[].leadId` → **Screen D** |

---

## Screen D — Project-wise Expense Details (drill-down)

**Figma:** Project expense breakdown, **Approved | Pending** tabs, table, eye on row.

### D1 — Load page

```http
GET /api/account/reports/project-wise-expense/6aadb0a0464b5c58eb1a042b?tab=approved&startDate=2026-01-01&endDate=2026-12-31&search=&page=1&limit=10
Authorization: Bearer <token>
```

| Query | Default | Values |
|-------|---------|--------|
| `tab` | `approved` | `approved`, `pending`, `all` |

#### Response `data` (example)

```json
{
  "project": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Alpha Infra project",
    "projectId": "PRO-2025-1047",
    "status": "in_production",
    "location": "Pune, Maharashtra",
    "quoteValue": 12500,
    "startDate": "2024-10-10T00:00:00.000Z",
    "endDate": "2025-10-10T00:00:00.000Z"
  },
  "summary": {
    "totalExpense": 12840000,
    "approvedExpense": 11200000,
    "pendingApproval": 1640000,
    "budgetedExpense": 700000,
    "budgetVariance": -660000,
    "variancePct": -4.89,
    "sources": {
      "manualExpenses": 4000000,
      "vendorMaterialFromEmailBids": 7000000,
      "freightFromEmailBids": 1840000
    }
  },
  "transactions": [
    {
      "recordId": "manual:67a1b2c3d4e5f67890123481",
      "source": "manual_expense",
      "expenseType": "Material Cost",
      "category": "materials",
      "date": "2026-03-15T00:00:00.000Z",
      "description": "Steel procurement batch 2",
      "reference": "EXP-2026-0042",
      "amount": 450000,
      "approvalStatus": "Approved",
      "tab": "approved",
      "status": "approved"
    },
    {
      "recordId": "shipper:67a1b2c3d4e5f67890123482",
      "source": "vendor_material_bid",
      "expenseType": "Material Cost",
      "category": "materials",
      "date": "2026-03-10T00:00:00.000Z",
      "description": "Vendor / material quote (email bid)",
      "reference": "A1B2C3D4",
      "amount": 320000,
      "approvalStatus": "Pending Approval",
      "tab": "pending",
      "status": "submitted"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 2,
    "totalPages": 1
  }
}
```

### D2 — View record (eye modal)

Parse `recordId` as `source` + `id`, or call:

```http
GET /api/account/reports/project-wise-expense/6aadb0a0464b5c58eb1a042b/transactions/manual/67a1b2c3d4e5f67890123481
Authorization: Bearer <token>
```

| `:source` | Meaning |
|-----------|---------|
| `manual` | Manual expense ledger |
| `shipper` | Vendor/material email bid |
| `freight` | Selected freight bid |
| `approval` | Payment approval row |

#### Response `data` (example)

```json
{
  "record": {
    "recordId": "manual:67a1b2c3d4e5f67890123481",
    "source": "manual_expense",
    "expenseType": "Material Cost",
    "category": "materials",
    "date": "2026-03-15T00:00:00.000Z",
    "description": "Steel procurement batch 2",
    "reference": "EXP-2026-0042",
    "amount": 450000,
    "approvalStatus": "Approved",
    "tab": "approved",
    "status": "approved"
  },
  "detail": {
    "_id": "67a1b2c3d4e5f67890123481",
    "expenseId": "EXP-2026-0042",
    "category": "materials",
    "amount": 450000,
    "description": "Steel procurement batch 2",
    "status": "approved"
  },
  "project": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Alpha Infra project",
    "projectId": "PRO-2025-1047"
  }
}
```

There is **no POST** on expense detail in v1 — expenses come from ledger, bids, and approvals elsewhere.

---

## Screen E — Profit/Loss Analysis (Analytics sidebar)

**Figma:** KPI cards (revenue, expenses, gross/net profit, margin), P&L summary table, income vs expense trend, expense breakdown donut, **Project-wise Profit & Loss** table.

### Primary API (Analytics menu)

```http
GET /api/account/reports/profit-loss?startDate=2026-05-01&endDate=2026-05-31&page=1&limit=20
Authorization: Bearer <token>
```

Optional: `leadId=<mongo>` to filter invoice rows to one project.

#### Response `data` (example)

```json
{
  "rows": [
    {
      "orderId": "6aadb352464b5c58eb1a0a64",
      "invoiceNumber": "INV-0038",
      "projectName": "Downtown Office Complex",
      "projectId": "PRJ-001",
      "revenue": 845300,
      "expense": 620000,
      "netProfit": 225300,
      "margin": 26.7,
      "status": "paid",
      "date": "2026-09-15T10:00:00.000Z"
    },
    {
      "orderId": "6aadb352464b5c58eb1a0a70",
      "invoiceNumber": "INV-0040",
      "projectName": "Residential Tower A",
      "projectId": "PRJ-002",
      "revenue": 1200000,
      "expense": 980000,
      "netProfit": 220000,
      "margin": 18.3,
      "status": "sent",
      "date": "2026-08-01T10:00:00.000Z"
    }
  ],
  "total": 42,
  "summary": {
    "totalRevenue": 12500000,
    "totalExpense": 8950000,
    "netProfit": 3550000,
    "avgMargin": 28.4
  },
  "expenseByCategory": {
    "materials": 4200000,
    "labour": 2100000,
    "transport": 800000
  },
  "monthlyTrend": [
    { "label": "Jan", "revenue": 900000, "expense": 700000, "profit": 200000 },
    { "label": "Feb", "revenue": 1100000, "expense": 850000, "profit": 250000 }
  ]
}
```

### UI mapping

| Figma | JSON |
|-------|------|
| Top KPI cards | `summary` (map labels: totalRevenue → Total Revenue, totalExpense → Total Expenses, netProfit → Net Profit, avgMargin → Net Profit Margin %) |
| P&L line table (particulars / periods) | **Not 1:1** — use **Margin** APIs below for full statement, or build partial UI from `summary` + `expenseByCategory` |
| Income vs Expense trend | `monthlyTrend[]` (6 months) |
| Expense breakdown donut | Normalize `expenseByCategory` object to segments |
| Project-wise P&L table | `rows[]` (`projectId` = job id, `orderId` = invoice id) |

### Richer P&L (optional — closer to full statement Figma)

If you need **project-wise P&L rows** with COGS / gross margin (second table in Figma):

```http
GET /api/account/financial/profit-loss/summary?search=&page=1&limit=10&startDate=2026-05-01&endDate=2026-05-31
Authorization: Bearer <token>
```

Example row:

```json
{
  "rows": [
    {
      "leadId": "6aadb0a0464b5c58eb1a042b",
      "projectName": "Downtown Office Complex",
      "jobId": "PRJ-001",
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

Detail + export: `GET /api/account/financial/profit-loss`, `GET /api/account/financial/profit-loss/export`.

---

## Master endpoint index

| # | Figma screen | Method | Path |
|---|--------------|--------|------|
| A | Income (project wise) list | GET | `/api/account/reports/project-wise-income` |
| B1 | Income project detail | GET | `/api/account/reports/project-wise-income/:leadId` |
| B2 | Income view modal | GET | `/api/account/reports/project-wise-income/:leadId/transactions/:transactionId` |
| B3 | Add Received Payment | POST | `/api/account/reports/project-wise-income/:leadId/received` |
| C | Expense (project wise) list | GET | `/api/account/reports/project-wise-expense` |
| D1 | Expense project detail | GET | `/api/account/reports/project-wise-expense/:leadId` |
| D2 | Expense view modal | GET | `/api/account/reports/project-wise-expense/:leadId/transactions/:source/:id` |
| E | Profit/Loss Analysis | GET | `/api/account/reports/profit-loss` |
| E+ | Project-wise P&L table (alt) | GET | `/api/account/financial/profit-loss/summary` |

---

## Navigation flow (frontend)

```text
Income list (A)
  └─ eye / row → Income detail (B1) ?tab=received|pending
        ├─ eye → transaction GET (B2) → optional invoice PDF
        └─ Add Received → POST (B3) → reload B1

Expense list (C)
  └─ eye → Expense detail (D1) ?tab=approved|pending
        └─ eye → record GET (D2)

Sidebar → Profit/Loss (E) [+ optional financial profit-loss/summary]
```

Always pass **`rows[].leadId`** from list screens into detail `:leadId` (or `projectId` job string).

---

## Integration checklist

- [ ] Account JWT on all `/api/account/reports/*` calls
- [ ] List screens: wire KPIs, charts, table, pagination from **A** / **C**
- [ ] Drill-down: use **`leadId`**, not only display `projectId`
- [ ] Income tabs: refetch detail when `tab` changes
- [ ] Add Received modal: POST **B3**, then refetch **B1**
- [ ] Income type dropdown: `incomeTypeOptions` from **B1**
- [ ] Expense tabs: `approved` / `pending` query on **D1**
- [ ] Expense modal: split `recordId` or use **D2** URL pattern
- [ ] Retention UI: show `0` or “—” until backend retention exists
- [ ] P&L: start with **E**; add **financial/profit-loss/summary** if Figma needs COGS columns

---

## curl smoke test

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN="<account_jwt>"

curl -s "$BASE/api/account/reports/project-wise-income?page=1&limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary,.data.rows[0].leadId'

LEAD=$(curl -s "$BASE/api/account/reports/project-wise-income?page=1&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.rows[0].leadId')

curl -s "$BASE/api/account/reports/project-wise-income/$LEAD?tab=received&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.project,.data.transactions[0]'

curl -s "$BASE/api/account/reports/project-wise-expense?page=1&limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary'

curl -s "$BASE/api/account/reports/profit-loss?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.summary,.data.rows[0]'
```

---

*Deploy branch: `shubham-changes-13-aug` · Detail field reference also in [`frontend-account-analytics-project-detail-api.md`](./frontend-account-analytics-project-detail-api.md)*
