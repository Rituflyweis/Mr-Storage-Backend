# Account panel — Dashboard (Figma alignment)

Base URL example: `https://mr-storage-backend-025k.onrender.com`  
Base path: **`/api/account/dashboard`**  
Auth: **`Authorization: Bearer <accessToken>`** — roles **`account`** or **`admin`**.

Response envelope (all routes):

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Errors use the same shape with `"success": false` and an HTTP 4xx/5xx status.

---

## Shared query parameters

| Query | Used on | Description |
|--------|---------|-------------|
| `startDate` | KPI / list routes | ISO 8601 date, inclusive (e.g. `2025-03-24`) |
| `endDate` | KPI / list routes | ISO 8601 date, inclusive through end of day |
| `limit` | Several list routes | Max rows (defaults vary per route) |
| `daysAhead` | upcoming payments | Horizon in days (default `30`, max `90`) |

---

## 1. Dashboard overview (single load)

### Request

```http
GET /api/account/dashboard/overview?startDate=2025-03-24&endDate=2025-03-31&transactionsLimit=5&carriersLimit=5&vendorsLimit=5&budgetRowsLimit=6&daysAhead=30 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json
```

No request body.

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "financialOverview": {
      "totalRevenue": 485250,
      "totalExpenses": 298750,
      "netProfit": 186500,
      "outstanding": 67890,
      "outstandingPayments": 67890
    },
    "invoiceReport": {
      "total": 48,
      "totalInvoicesGenerated": 48,
      "paid": 32,
      "unpaid": 12,
      "overdue": 4,
      "totalPaid": 420000,
      "totalUnpaid": 52000,
      "overdueAmount": 13390,
      "totalSales": 485390
    },
    "deliveryFinance": {
      "freightSpend": 248500,
      "pendingCarrierPayments": 62300,
      "freightSavings": 37400
    },
    "orderVsPlantCosts": {
      "totalOrderValue": 1230000,
      "totalPlantCosts": 997000,
      "projectedProfit": 233000
    },
    "recentTransactions": [
      {
        "id": "67a1b2c3d4e5f6789012345a",
        "type": "invoice",
        "label": "Payment Received",
        "entityName": "ABC Industries",
        "date": "2025-03-28T14:22:00.000Z",
        "amount": 25000,
        "direction": "credit",
        "status": "Completed",
        "invoiceNumber": "INV-2025-0042"
      },
      {
        "id": "67a1b2c3d4e5f6789012345b",
        "type": "expense",
        "label": "Material Purchase",
        "entityName": "Steel Supplier Ltd",
        "date": "2025-03-27T00:00:00.000Z",
        "amount": 12500,
        "direction": "debit",
        "status": "Completed",
        "category": "materials"
      }
    ],
    "alerts": [
      {
        "id": "67a1b2c3d4e5f6789012345c",
        "type": "invoice_due",
        "message": "Payment due from ABC Corp — $15,000",
        "priority": "high",
        "dueDate": "2025-04-01T00:00:00.000Z",
        "amount": 15000
      },
      {
        "id": "67a1b2c3d4e5f6789012345d",
        "type": "tax_filing",
        "message": "Tax filing deadline (TX) in 5 days",
        "priority": "medium",
        "dueDate": "2025-04-05T00:00:00.000Z",
        "amount": 8200
      }
    ],
    "topCarriers": [
      {
        "carrierId": "67a1b2c3d4e5f6789012345e",
        "name": "FastFreight Logistics",
        "spend": 100000,
        "deliveries": 42
      },
      {
        "carrierId": "67a1b2c3d4e5f6789012345f",
        "name": "Regional Freight Co",
        "spend": 87500,
        "deliveries": 28
      }
    ],
    "topVendors": [
      {
        "vendorId": "67a1b2c3d4e5f67890123460",
        "name": "Olivia Harris Steel Supply",
        "contactName": "Olivia Harris",
        "amount": 145355,
        "status": "Active"
      },
      {
        "vendorId": null,
        "name": "David Anderson Welding",
        "contactName": "",
        "amount": 98200,
        "status": "Active"
      }
    ],
    "upcomingPayments": [
      {
        "_id": "67a1b2c3d4e5f67890123461",
        "invoiceNumber": "INV-2024-001",
        "totalAmount": 135000,
        "status": "sent",
        "description": "Progress Payment",
        "companyName": "ABC Industries",
        "paymentDescription": "Progress Payment",
        "amount": 135000,
        "dueDate": "2025-04-25T00:00:00.000Z",
        "salesRep": "John Doe",
        "priority": "medium",
        "leadId": {
          "_id": "67a1b2c3d4e5f67890123462",
          "projectName": "Downtown Office Complex",
          "assignedSales": { "_id": "67a1b2c3d4e5f67890123463", "name": "John Doe" }
        },
        "customerId": {
          "_id": "67a1b2c3d4e5f67890123464",
          "firstName": "Jane",
          "lastName": "Smith",
          "company": "ABC Industries"
        }
      }
    ],
    "projectBudgetVsActual": [
      {
        "leadId": "67a1b2c3d4e5f67890123465",
        "projectName": "Downtown Office Complex",
        "jobId": "2025001",
        "material": 450000,
        "estimated": 420000,
        "actual": 465000,
        "variance": 45000,
        "varianceDirection": "over",
        "date": "2025-01-15T10:00:00.000Z"
      },
      {
        "leadId": "67a1b2c3d4e5f67890123466",
        "projectName": "Residential Tower A",
        "jobId": "2025002",
        "material": 320000,
        "estimated": 340000,
        "actual": 315000,
        "variance": -25000,
        "varianceDirection": "under",
        "date": "2025-01-20T08:30:00.000Z"
      }
    ]
  }
}
```

---

## 2. Financial overview (top 4 cards)

### Request

```http
GET /api/account/dashboard/stats?startDate=2025-03-24&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalRevenue": 485250,
    "totalExpenses": 298750,
    "netProfit": 186500,
    "outstanding": 67890,
    "outstandingPayments": 67890
  }
}
```

| Figma label | Field |
|-------------|--------|
| Total Revenue | `totalRevenue` |
| Total Expenses | `totalExpenses` |
| Net Profit | `netProfit` |
| Outstanding Payments | `outstandingPayments` |

---

## 3. Invoice report row

### Request

```http
GET /api/account/dashboard/invoice-stats?startDate=2025-03-24&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "total": 48,
    "totalInvoicesGenerated": 48,
    "paid": 32,
    "unpaid": 12,
    "overdue": 4,
    "totalPaid": 420000,
    "totalUnpaid": 52000,
    "overdueAmount": 13390,
    "totalSales": 485390
  }
}
```

| Figma label | Field |
|-------------|--------|
| Total invoices generated | `totalInvoicesGenerated` |
| Total Paid ($) | `totalPaid` |
| Total Unpaid ($) | `totalUnpaid` |
| Overdue ($) | `overdueAmount` |
| Total Sales | `totalSales` |

---

## 4. Delivery finance row

### Request

```http
GET /api/account/dashboard/delivery-finance?startDate=2025-03-24&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

Same handler as `GET /api/account/financial/delivery-finance`.

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "freightSpend": 248500,
    "pendingCarrierPayments": 62300,
    "freightSavings": 37400
  }
}
```

---

## 5. Order value vs plant costs

### Request

```http
GET /api/account/dashboard/order-vs-plant-costs?startDate=2025-01-01&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

Alias: `GET /api/account/analytics/order-vs-plant-costs` (same query + response).

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalOrderValue": 1230000,
    "totalPlantCosts": 997000,
    "projectedProfit": 233000
  }
}
```

---

## 6. Recent transactions

### Request

```http
GET /api/account/dashboard/recent-transactions?limit=10&startDate=2025-03-01&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "transactions": [
      {
        "id": "67a1b2c3d4e5f6789012345a",
        "type": "invoice",
        "label": "Payment Received",
        "entityName": "ABC Corp",
        "date": "2025-03-28T14:22:00.000Z",
        "amount": 25000,
        "direction": "credit",
        "status": "Completed",
        "invoiceNumber": "INV-2025-0042",
        "raw": { }
      },
      {
        "id": "67a1b2c3d4e5f6789012345b",
        "type": "expense",
        "label": "Labour Payment",
        "entityName": "Downtown Office Complex",
        "date": "2025-03-26T00:00:00.000Z",
        "amount": 8500,
        "direction": "debit",
        "status": "Pending",
        "category": "labour",
        "raw": { }
      },
      {
        "id": "67a1b2c3d4e5f6789012345c",
        "type": "expense",
        "label": "Freight Payment",
        "entityName": "FastFreight Logistics",
        "date": "2025-03-25T00:00:00.000Z",
        "amount": 4200,
        "direction": "debit",
        "status": "Completed",
        "category": "transport",
        "raw": { }
      }
    ]
  }
}
```

UI: show `+` prefix when `direction === "credit"`; red/outflow styling when `direction === "debit"`. Optional full Mongo document is on `raw`.

---

## 7. Alerts & notifications

### Request

```http
GET /api/account/dashboard/alerts?limit=8 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "alerts": [
      {
        "id": "67a1b2c3d4e5f6789012345c",
        "type": "invoice_due",
        "message": "Payment due from ABC Corp — $15,000",
        "priority": "high",
        "dueDate": "2025-04-01T00:00:00.000Z",
        "amount": 15000
      },
      {
        "id": "67a1b2c3d4e5f67890123470",
        "type": "tax_filing",
        "message": "Tax filing deadline (CA) in 5 days",
        "priority": "medium",
        "dueDate": "2025-04-05T00:00:00.000Z",
        "amount": 12000
      },
      {
        "id": "67a1b2c3d4e5f67890123471",
        "type": "payment_dispute",
        "message": "Disputed payment: Steel Supplier Ltd — $8,500",
        "priority": "high",
        "dueDate": null,
        "amount": 8500
      }
    ]
  }
}
```

| `priority` | Suggested UI |
|------------|----------------|
| `high` | Red / “High Priority” |
| `medium` | Yellow / “Medium Priority” |
| `low` | Blue / “Low Priority” |

---

## 8. Top carriers by spend

### Request

```http
GET /api/account/dashboard/top-carriers?limit=5&startDate=2025-01-01&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "carriers": [
      {
        "carrierId": "67a1b2c3d4e5f6789012345e",
        "name": "FastFreight Logistics",
        "spend": 100000,
        "deliveries": 42
      },
      {
        "carrierId": "67a1b2c3d4e5f6789012345f",
        "name": "Regional Freight Co",
        "spend": 99999,
        "deliveries": 28
      },
      {
        "carrierId": "67a1b2c3d4e5f67890123472",
        "name": "QuickTransport Inc",
        "spend": 76500,
        "deliveries": 33
      }
    ]
  }
}
```

Table columns: **Customer** → `name`, **Spend** → `spend`, **Deliveries** → `deliveries`.

---

## 9. Top vendors

### Request

```http
GET /api/account/dashboard/top-vendors?limit=5&startDate=2025-01-01&endDate=2025-03-31 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "vendors": [
      {
        "vendorId": "67a1b2c3d4e5f67890123460",
        "name": "Olivia Harris Steel Supply",
        "contactName": "Olivia Harris",
        "amount": 145355,
        "status": "Active"
      },
      {
        "vendorId": "67a1b2c3d4e5f67890123473",
        "name": "David Anderson Welding",
        "contactName": "David Anderson",
        "amount": 89200,
        "status": "Expired"
      }
    ]
  }
}
```

`status`: **`Active`** | **`Expired`** (from vendor master `inactive` → Expired).

---

## 10. Upcoming payments (from sales)

### Request

```http
GET /api/account/dashboard/upcoming-payments?daysAhead=30 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "upcoming": [
      {
        "_id": "67a1b2c3d4e5f67890123461",
        "invoiceNumber": "INV-2024-001",
        "description": "Progress Payment — Phase 2",
        "status": "sent",
        "totalAmount": 135000,
        "date": "2025-03-01T00:00:00.000Z",
        "daysToPay": 30,
        "dueDate": "2025-04-25T00:00:00.000Z",
        "companyName": "ABC Industries",
        "paymentDescription": "Progress Payment — Phase 2",
        "amount": 135000,
        "salesRep": "John Doe",
        "priority": "medium",
        "leadId": {
          "_id": "67a1b2c3d4e5f67890123462",
          "projectName": "Downtown Office Complex",
          "assignedSales": {
            "_id": "67a1b2c3d4e5f67890123463",
            "name": "John Doe"
          }
        },
        "customerId": {
          "_id": "67a1b2c3d4e5f67890123464",
          "firstName": "Jane",
          "lastName": "Smith",
          "company": "ABC Industries"
        }
      }
    ]
  }
}
```

| Figma column | Field |
|--------------|--------|
| Company | `companyName` |
| Subtitle | `paymentDescription` |
| Amount | `amount` |
| Date | `dueDate` |
| Sales Rep | `salesRep` |
| Invoice link | `invoiceNumber` |
| Priority pill | `priority` (`high` \| `medium` \| `low`) |

---

## 11. Project budget vs actual

### Request

```http
GET /api/account/dashboard/project-budget-vs-actual?limit=10 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "67a1b2c3d4e5f67890123465",
        "projectName": "Downtown Office Complex",
        "jobId": "2025001",
        "material": 450000,
        "estimated": 420000,
        "actual": 465000,
        "variance": 45000,
        "varianceDirection": "over",
        "date": "2025-01-15T10:00:00.000Z"
      },
      {
        "leadId": "67a1b2c3d4e5f67890123466",
        "projectName": "Residential Tower A",
        "jobId": "2025002",
        "material": 320000,
        "estimated": 340000,
        "actual": 315000,
        "variance": -25000,
        "varianceDirection": "under",
        "date": "2025-01-20T08:30:00.000Z"
      },
      {
        "leadId": "67a1b2c3d4e5f67890123474",
        "projectName": "Shopping Mall Renovation",
        "jobId": "2025003",
        "material": 280000,
        "estimated": 275000,
        "actual": 285000,
        "variance": 10000,
        "varianceDirection": "over",
        "date": "2025-01-25T12:00:00.000Z"
      }
    ]
  }
}
```

| Column | Field | Notes |
|--------|--------|--------|
| Project | `projectName` | |
| Material | `material` | `ProjectBudget.materialBudget` |
| Estimated | `estimated` | `ProjectBudget.totalBudget` |
| Actual | `actual` | Sum of active expenses on lead |
| Variance | `variance` | `actual - estimated`; use `varianceDirection` for arrow/color (`over` = red up, `under` = green down) |
| Date | `date` | Budget record `updatedAt` |

---

## 12. Other dashboard routes (charts / legacy)

Same auth and envelope. Examples:

### Income vs expense

```http
GET /api/account/dashboard/income-vs-expense?period=monthly HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "period": "monthly",
    "points": [
      { "label": "Apr 2024", "income": 320000, "expense": 85000 },
      { "label": "May 2024", "income": 410000, "expense": 92000 }
    ]
  }
}
```

### Payment distribution

```http
GET /api/account/dashboard/payment-distribution?startDate=2025-01-01&endDate=2025-03-31 HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "paid": { "count": 32, "amount": 420000, "pct": 67 },
    "pending": { "count": 12, "amount": 52000, "pct": 25 },
    "overdue": { "count": 4, "amount": 13390, "pct": 8 },
    "totalAmount": 485390,
    "totalCount": 48
  }
}
```

### Revenue / expense trend

```http
GET /api/account/dashboard/revenue-trend HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "points": [
      { "month": "Apr 2024", "amount": 320000 },
      { "month": "May 2024", "amount": 410000 }
    ]
  }
}
```

```http
GET /api/account/dashboard/expense-trend HTTP/1.1
```

Same shape as revenue trend; `amount` is expense total per month.

---

## Frontend loading pattern

**Option A — one request (simplest):**

```text
GET /api/account/dashboard/overview?startDate=...&endDate=...
```

**Option B — parallel section calls** (use when lazy-loading below the fold):

```text
GET /api/account/dashboard/stats?startDate=...&endDate=...
GET /api/account/dashboard/invoice-stats?startDate=...&endDate=...
GET /api/account/dashboard/delivery-finance?startDate=...&endDate=...
GET /api/account/dashboard/order-vs-plant-costs?startDate=...&endDate=...
GET /api/account/dashboard/recent-transactions?limit=5
GET /api/account/dashboard/alerts?limit=8
GET /api/account/dashboard/top-carriers?limit=5
GET /api/account/dashboard/top-vendors?limit=5
GET /api/account/dashboard/upcoming-payments?daysAhead=30
GET /api/account/dashboard/project-budget-vs-actual?limit=6
```

Re-fetch all dashboard calls when the user changes the global date filter (`startDate` / `endDate`).
