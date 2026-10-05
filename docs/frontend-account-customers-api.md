# Account panel — Customers (Figma)

Base: **`/api/account/customers`**  
Auth: **`Authorization: Bearer <token>`** — roles **`account`** or **`admin`**.

Envelope: `{ "success": true, "message": "Success", "data": { ... } }`.

---

## Date filters (stats, list, detail sub-lists)

| Query | Description |
|--------|-------------|
| `period` | `today` \| `week` \| `month` (Monday–Sunday for week) |
| `startDate` | ISO date; overrides `period` when used with or without `endDate` |
| `endDate` | ISO date, inclusive end of day |

---

## 1. Customer stats (top cards)

### Request

```http
GET /api/account/customers/stats?period=month HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalCustomers": 126,
    "activeCustomers": 48,
    "newCustomersThisMonth": 15,
    "returningCustomers": 9
  }
}
```

| Figma card | Field |
|------------|--------|
| Total Customers | `totalCustomers` |
| Active Customers | `activeCustomers` |
| New Cust. (This Month) | `newCustomersThisMonth` (customers **created** in the selected period) |
| Returning Customers | `returningCustomers` (2+ PO-raised projects; scoped to customers in period when a date filter is active) |

---

## 2. Customer list

### Request

```http
GET /api/account/customers?period=month&search=john&page=1&limit=20 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

Search matches: `customerId`, name, email, phone, company.

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "customers": [
      {
        "_id": "67a1b2c3d4e5f6789012345a",
        "customerId": "CUS-00147",
        "customerName": "John Doe",
        "phone": "+1 6392459315",
        "email": "darlee@example.com",
        "status": "Active",
        "totalProjects": 3,
        "joinedDate": "2023-01-15T08:00:00.000Z"
      }
    ],
    "total": 126,
    "page": 1,
    "limit": 20
  }
}
```

| Table column | Field |
|--------------|--------|
| Customer ID | `customerId` |
| Customer Name | `customerName` |
| Phone No. | `phone` |
| Email | `email` |
| View detail | `GET /api/account/customers/:customerId` — use `_id` or `customerId` (`CUS-00147`) |

---

## 3. Customer detail (full screen)

### Request

```http
GET /api/account/customers/67a1b2c3d4e5f6789012345a HTTP/1.1
Authorization: Bearer <token>
```

Optional filters for **projects** and **invoices** sections only:

```http
GET /api/account/customers/CUS-00147?search=INV&period=month HTTP/1.1
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "profile": {
      "_id": "67a1b2c3d4e5f6789012345a",
      "customerId": "CUS-00147",
      "customerName": "John Doe",
      "status": "Active",
      "joinedDate": "2023-01-15T08:00:00.000Z",
      "phone": "+1 6392459315",
      "email": "darlee@example.com",
      "address": "1861 Bayonne Ave, Manchester, NJ, 08759",
      "company": "ABC Industries",
      "photo": null
    },
    "summary": {
      "totalProjects": 12,
      "totalProjectValue": 48200000,
      "totalProjectCost": 31600000,
      "totalFreightCost": 2480000,
      "expectedMargin": 34.6,
      "actualMargin": 28.9,
      "totalExpenses": 31600000,
      "outstandingAmount": 4260000
    },
    "customerRevenue": {
      "totalQuotedValue": 49400000,
      "totalInvoiced": 46800000,
      "totalReceived": 42500000,
      "outstandingAmount": 4260000,
      "overdue": 1240000
    },
    "profitabilityOverview": [
      {
        "key": "revenue",
        "label": "Revenue",
        "expected": 48200000,
        "actual": 46800000,
        "variance": -1400000
      },
      {
        "key": "materialCost",
        "label": "Material Cost",
        "expected": 24200000,
        "actual": 25600000,
        "variance": 1400000
      },
      {
        "key": "freightCost",
        "label": "Freight Cost",
        "expected": 2100000,
        "actual": 2480000,
        "variance": 380000
      },
      {
        "key": "logisticsCost",
        "label": "Logistics Cost",
        "expected": 1600000,
        "actual": 1840000,
        "variance": 240000
      },
      {
        "key": "manpowerCost",
        "label": "Manpower Cost",
        "expected": 1800000,
        "actual": 1920000,
        "variance": 120000
      },
      {
        "key": "siteCost",
        "label": "Site Cost",
        "expected": 1200000,
        "actual": 1460000,
        "variance": 260000
      },
      {
        "key": "miscellaneous",
        "label": "Miscellaneous",
        "expected": 800000,
        "actual": 1020000,
        "variance": 220000
      },
      {
        "key": "totalCost",
        "label": "Total Cost",
        "expected": 29700000,
        "actual": 34300000,
        "variance": 4600000
      },
      {
        "key": "profit",
        "label": "Profit",
        "expected": 18500000,
        "actual": 12500000,
        "variance": -6000000
      },
      {
        "key": "marginPct",
        "label": "Margin",
        "expected": 38.4,
        "actual": 26.7,
        "variance": -11.7,
        "unit": "percent"
      }
    ],
    "projects": [
      {
        "leadId": "67a1b2c3d4e5f67890123470",
        "projectId": "2025001",
        "projectName": "ABC Building",
        "amount": 50000,
        "status": "Completed",
        "lifecycleStatus": "delivered",
        "startDate": "2024-04-02T00:00:00.000Z",
        "endDate": "2024-05-02T00:00:00.000Z"
      },
      {
        "leadId": "67a1b2c3d4e5f67890123471",
        "projectId": "2025002",
        "projectName": "Project 2",
        "amount": 75000,
        "status": "In progress",
        "lifecycleStatus": "in_production",
        "startDate": "2024-06-01T00:00:00.000Z",
        "endDate": null
      }
    ],
    "invoices": [
      {
        "invoiceId": "67a1b2c3d4e5f67890123480",
        "invoiceNumber": "INV001",
        "dueDate": "2024-12-24T00:00:00.000Z",
        "amount": 500,
        "paid": 500,
        "amountDue": 0,
        "status": "Paid",
        "invoiceStatus": "paid",
        "projectName": "ABC Building"
      },
      {
        "invoiceId": "67a1b2c3d4e5f67890123481",
        "invoiceNumber": "INV002",
        "dueDate": "2024-12-24T00:00:00.000Z",
        "amount": 1500,
        "paid": 0,
        "amountDue": 1500,
        "status": "Unpaid",
        "invoiceStatus": "sent",
        "projectName": "ABC Building"
      }
    ]
  }
}
```

### Section mapping

| UI block | `data` path |
|----------|-------------|
| Profile header | `profile` |
| 8 KPI cards (projects, value, cost, freight, margins, expenses, outstanding) | `summary` |
| Customer revenue row (5 cards) | `customerRevenue` |
| Profitability table (Expected / Actual / Variance) | `profitabilityOverview[]` |
| All projects table | `projects[]` |
| Invoice table | `invoices[]` |

### Invoice actions

- **View:** use `invoiceId` → existing invoice detail routes under `/api/account/invoices/:invoiceId` if wired.
- **Mark as paid:** `PUT /api/account/invoices/:invoiceId/mark-paid` (unchanged).

---

## Data rules (for QA)

- **Projects** included in financial rollups: leads with `isRaisedToPO: true` (same as admin customer projects).
- **Expected** costs: summed `ProjectBudget` per customer project; **expected revenue**: sum of `quoteValue`.
- **Actual** costs: expenses by category + selected freight bids on customer deliveries.
- **Actual revenue** (profitability row): paid customer invoice totals; falls back to all invoice totals if none paid.
- Amounts are raw numbers (USD); format Crores/Lakhs on the frontend if needed.

---

## Loading pattern

```text
GET /api/account/customers/stats?period=month
GET /api/account/customers?period=month&search=&page=1&limit=20
GET /api/account/customers/:id
```

Re-run stats + list when the user changes **Today / Week / Month** or custom dates.
