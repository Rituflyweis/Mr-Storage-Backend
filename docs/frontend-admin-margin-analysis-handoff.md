# Admin — Margin Analysis handoff (quotation extraction)

**Audience:** Admin panel · Financial Overview → **Margin Analysis**  
**Prod base:** `https://mr-storage-backend-025k.onrender.com`  
**API prefix:** `/api/admin/financials`  
**Auth:** `Authorization: Bearer <admin_access_token>`

**Not for account panel.** Account margin stays on `/api/account/financial/margin-analysis` (paid invoices + expenses).

All margin endpoints below return **`dataSource: "quotation"`** and **`audience: "admin"`** inside `data` (except where noted).

---

## Conventions

### Envelope

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

### Where numbers come from

Latest **quotation per project** (`leadId`), optionally enriched via **`sourceEstimateId`** → `EstimateQuote` (COG / spreadsheet extraction).

| UI label | Primary fields |
|----------|----------------|
| Sales / revenue | `finalPrice`, `basePrice`, estimate `totalSell`, `fullQuoteResult.grandTotal` |
| COGS | `totalCOGS`, `materialCost + freightCost`, estimate `totalCOGS`, `pricing.totCost` |
| Labour / install | estimate `installCost` → **`labourInstallCost`** on rows |
| Gross margin % | `quotation.margin`, `markupPercent`, estimate `marginPercent`, `grandMargin`, `profPct`, else computed |
| Markup | `markupPercent`, `markupValue` |

Date filtering uses quotation **`proposalDate`** (not invoice date).

### Shared query params

| Param | Used on |
|-------|---------|
| `startDate`, `endDate` | KPI, by-project, P&L table (ISO dates) |
| `projectId` or `leadId` | Scope to one project |
| `businessUnit` or `company` | Filter leads |
| `period` | KPI only when dates omitted: `monthly` \| `quarterly` \| `yearly` (invoice-style presets on date window) |

---

## 1. KPI cards (5 metrics)

```http
GET /api/admin/financials/margin-analysis?startDate=2026-01-01&endDate=2026-12-31
Authorization: Bearer <token>
```

Optional: `&projectId=6aadb0a0464b5c58eb1a042b&businessUnit=steel`

**Response `data`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "dataSource": "quotation",
    "audience": "admin",
    "grossMarginPct": 22.4,
    "operatingMarginPct": 22.4,
    "netProfitMarginPct": 22.4,
    "contributionMarginPct": 22.4,
    "avgSellingPrice": 845300,
    "period": {
      "startDate": "2026-01-01T00:00:00.000Z",
      "endDate": "2026-12-31T23:59:59.999Z"
    },
    "kpis": {
      "grossMarginPct": { "value": 22.4, "changePct": 3.2 },
      "operatingMarginPct": { "value": 22.4, "changePct": 3.2 },
      "netProfitMarginPct": { "value": 22.4, "changePct": 3.2 },
      "contributionMarginPct": { "value": 22.4, "changePct": 3.2 },
      "avgSellingPrice": { "value": 845300, "changePct": 8.1 }
    },
    "totals": {
      "revenue": 12420000,
      "cogs": 9638400,
      "grossProfit": 2781600,
      "operatingProfit": 2781600,
      "netProfit": 2781600,
      "quotationCount": 15
    }
  }
}
```

| Figma KPI | Bind to |
|-----------|---------|
| Gross Margin % | `kpis.grossMarginPct.value` · badge `changePct` |
| Operating Margin | `kpis.operatingMarginPct.value` |
| Net Profit Margin | `kpis.netProfitMarginPct.value` |
| Contribution Margin | `kpis.contributionMarginPct.value` |
| Avg Selling Price | `kpis.avgSellingPrice.value` |

---

## 2. Margin trend over time (line chart)

```http
GET /api/admin/financials/margin-analysis/trend?period=month
Authorization: Bearer <token>
```

| `period` | Buckets |
|----------|---------|
| `month` | Last 12 months by `YYYY-MM` |
| `quarter` | Last 8 quarters `YYYY-Qn` |
| `year` | Last 5 years |

Optional: `projectId`, `leadId`, `businessUnit`, `company`

**Response `data`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "period": "month",
    "dataSource": "quotation",
    "audience": "admin",
    "trend": [
      {
        "period": "2026-07",
        "label": "2026-07",
        "revenue": 70200,
        "expense": 54600,
        "cogs": 54600,
        "grossProfit": 15600,
        "grossMarginPct": 22.22,
        "operatingMarginPct": 22.22,
        "netProfitMarginPct": 22.22,
        "contributionMarginPct": 22.22
      },
      {
        "period": "2026-08",
        "label": "2026-08",
        "revenue": 12420000,
        "expense": 9638400,
        "cogs": 9638400,
        "grossProfit": 2781600,
        "grossMarginPct": 22.4,
        "operatingMarginPct": 22.4,
        "netProfitMarginPct": 22.4,
        "contributionMarginPct": 22.4
      }
    ]
  }
}
```

| Chart series | Field |
|--------------|--------|
| Revenue ($) | `revenue` |
| Expense ($) | `expense` or `cogs` |
| Gross Margin (%) | `grossMarginPct` |

**Errors:**

```json
{
  "success": false,
  "message": "period must be month, quarter, or year"
}
```

---

## 3. Margin by projects (bar chart)

```http
GET /api/admin/financials/margin-analysis/by-project?limit=10&startDate=2026-01-01&endDate=2026-12-31
Authorization: Bearer <token>
```

**Response `data`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "dataSource": "quotation",
    "audience": "admin",
    "projects": [
      {
        "leadId": "6a6b644963a85950372e1dd9",
        "quotationId": "6aadb2dc464b5c58eb1a08c4",
        "projectName": "Lucas project",
        "jobId": "PRO-002",
        "category": "released_to_plant",
        "revenue": 12420000,
        "cogs": 9638400,
        "expenses": 9638400,
        "labourInstallCost": 120000,
        "grossProfit": 2781600,
        "grossMarginPct": 22.4,
        "markupPercent": 25,
        "marginFromQuotation": 22.4,
        "operatingMarginPct": 22.4,
        "netProfitMarginPct": 22.4,
        "contributionMarginPct": 22.4
      },
      {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "quotationId": "6aadb352464b5c58eb1a0a64",
        "projectName": "Adam Gilchrist",
        "jobId": "PRO-042",
        "category": "delivered",
        "revenue": 1690600,
        "cogs": 1312800,
        "expenses": 1312800,
        "labourInstallCost": 45000,
        "grossProfit": 377800,
        "grossMarginPct": 22.35,
        "markupPercent": 22,
        "marginFromQuotation": 22.35,
        "operatingMarginPct": 22.35,
        "netProfitMarginPct": 22.35,
        "contributionMarginPct": 22.35
      }
    ]
  }
}
```

| Bar series | Field |
|------------|--------|
| Revenue ($) | `revenue` |
| Expenses ($) | `expenses` / `cogs` |
| Gross Profit ($) | `grossProfit` |

---

## 4. Profit & Loss summary table

Admin route (not account `/profit-loss/summary`):

```http
GET /api/admin/financials/profit-loss/projects?page=1&limit=10&search=lucas
Authorization: Bearer <token>
```

Optional: `startDate`, `endDate`, `projectId`, `businessUnit`

**Response `data`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "dataSource": "quotation",
    "audience": "admin",
    "projects": [
      {
        "leadId": "6a6b644963a85950372e1dd9",
        "quotationId": "6aadb2dc464b5c58eb1a08c4",
        "projectName": "Lucas project",
        "jobId": "PRO-002",
        "category": "released_to_plant",
        "salesUSD": 12420000,
        "cogsUSD": 9638400,
        "grossProfitUSD": 2781600,
        "grossMarginPct": 22.4,
        "markupPercent": 25,
        "labourInstallCost": 120000
      }
    ],
    "rows": [],
    "total": 2,
    "page": 1,
    "limit": 10
  }
}
```

Use **`projects`** (same row objects as **`rows`** when present). Prefer **`projects`** for new UI.

| Table column | Field |
|--------------|--------|
| Project Name | `projectName` or `jobId` |
| Category | `category` |
| Sales (USD) | `salesUSD` |
| COGS (USD) | `cogsUSD` |
| Gross Profit (USD) | `grossProfitUSD` |
| Gross Margin | **`grossMarginPct`** (single column — do not duplicate header) |

---

## 5. Screen → API matrix

| Admin UI section | Request |
|------------------|---------|
| Top 5 KPI cards | `GET …/margin-analysis?startDate=&endDate=` |
| Margin Trend Over Time | `GET …/margin-analysis/trend?period=month` |
| Margin by Projects | `GET …/margin-analysis/by-project?limit=10` |
| Profit & Loss Summary table | `GET …/profit-loss/projects?page=1&limit=10` |
| Project / date filters | Pass `projectId`, `startDate`, `endDate` on all of the above |

---

## 6. Account panel (do not use for this screen)

| | Admin (this doc) | Account |
|--|------------------|---------|
| Prefix | `/api/admin/financials` | `/api/account/financial` |
| Data | Extracted quotation | Paid invoices + expenses |
| P&L table path | `/profit-loss/projects` | `/profit-loss/summary` |

---

## 7. Quick test (curl)

```bash
BASE=https://mr-storage-backend-025k.onrender.com
TOKEN="<admin_jwt>"

curl -s "$BASE/api/admin/financials/margin-analysis?startDate=2026-01-01&endDate=2026-12-31" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.dataSource,.data.totals'

curl -s "$BASE/api/admin/financials/margin-analysis/trend?period=month" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.trend[-1]'

curl -s "$BASE/api/admin/financials/profit-loss/projects?page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.projects[0]'
```

---

## 8. Related docs

- [`frontend-admin-margin-analysis-quotation-api.md`](./frontend-admin-margin-analysis-quotation-api.md) — short field mapping reference  
- [`admin-quotation-api.md`](./admin-quotation-api.md) — quotation CRUD / extraction  
- [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) §4 — account margin (different data source)

---

*Handoff version: 2026-10-16 · Backend: `adminQuotationMarginAnalysis.service.js` · Branch: `shubham-changes-13-aug` (commit `fcd1301`+)*
