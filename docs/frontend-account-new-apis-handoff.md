# Account panel — new APIs handoff (with examples)

**Base URL (prod):** `https://mr-storage-backend-025k.onrender.com`  
**Base path:** `/api/account`  
**Auth:** `Authorization: Bearer <token>` · roles **`account`** | **`admin`**

This document lists **account-panel routes only** (`/api/account/...`) with **copy-paste request/response examples**.

**Related docs (not duplicated here):**

| Topic | Document |
|-------|----------|
| Full account screen matrix & budget vs actual | [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) |
| **Payments — `quoteOrderId` on POST `/payments/orders`** | [`frontend-account-payments-orders-quote-order-id-handoff-2026-10-17.md`](./frontend-account-payments-orders-quote-order-id-handoff-2026-10-17.md) |
| Project sub-page field reference | [`frontend-account-project-detail-api.md`](./frontend-account-project-detail-api.md) |
| **Admin — set project budget & `customLines[]`** | [`frontend-admin-project-budget-custom-lines-api.md`](./frontend-admin-project-budget-custom-lines-api.md) |

---

## Conventions

### Response envelope

Successful JSON responses:

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Errors (typical):

```json
{
  "success": false,
  "message": "Project not found"
}
```

HTTP status follows the error (`404`, `400`, `401`, `403`, `500`).

### IDs used in examples

| Placeholder | Example value | Notes |
|-------------|---------------|--------|
| `:projectId` | `6aadb0a0464b5c58eb1a042b` | Mongo **`leadId`** or **`jobId`** (`PRO-042`) |
| `:deliveryId` | `6ac40e5994a6cf8feeec66f0` | Material delivery |
| `:quotationId` | `6aadb2dc464b5c58eb1a08c4` | Quotation |

### Export endpoints

`GET .../export` returns **Excel** (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) with the same query params as the matching `records` route. Handle as blob download, not JSON.

### Sensitive fields

Some routes still embed populated **`customerId`** (including legacy fields). **Do not render `password` or internal auth fields** in the UI even if present in JSON.

---

## 1. Project sub-pages (`GET`, read-only)

`:projectId` = Mongo **`leadId`** or **`jobId`**.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects/:projectId/invoices/summary` | Invoice KPIs |
| GET | `/projects/:projectId/invoices/records` | Invoice table |
| GET | `/projects/:projectId/payments/summary` | Payments KPIs |
| GET | `/projects/:projectId/payments/records` | Payments table |
| GET | `/projects/:projectId/deliveries` | Material delivery list |
| GET | `/projects/:projectId/deliveries/:deliveryId` | Delivery detail |
| GET | `/projects/:projectId/quotations` | Quotation list |
| GET | `/projects/:projectId/quotations/:quotationId` | Quotation detail |
| GET | `/projects/:projectId/bom/consolidated` | Consolidated BOM detail (summary + rows + downloads) |
| GET | `/projects/:projectId/agreement` | Signed agreement / contract |

**Overview:** `GET /projects/:projectId` includes **`actionLinks`** — all paths under `/api/account/projects/...` (no sales/admin/plant URLs for sub-pages).

### 1.1 Project overview + `actionLinks`

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b
Authorization: Bearer <token>
```

**Response `data` (abbreviated — full payload also includes `overview`, `contact`, `financialSummary`, `profitabilityOverview`, and a large `lead` object):**

```json
{
  "actionLinks": {
    "overview": "/api/account/projects/6aadb0a0464b5c58eb1a042b",
    "invoices": "/api/account/projects/6aadb0a0464b5c58eb1a042b/invoices/summary",
    "invoiceRecords": "/api/account/projects/6aadb0a0464b5c58eb1a042b/invoices/records",
    "payments": "/api/account/projects/6aadb0a0464b5c58eb1a042b/payments/summary",
    "paymentRecords": "/api/account/projects/6aadb0a0464b5c58eb1a042b/payments/records",
    "deliveries": "/api/account/projects/6aadb0a0464b5c58eb1a042b/deliveries",
    "quotations": "/api/account/projects/6aadb0a0464b5c58eb1a042b/quotations",
    "bom": "/api/account/projects/6aadb0a0464b5c58eb1a042b/bom",
    "agreement": "/api/account/projects/6aadb0a0464b5c58eb1a042b/agreement",
    "projectInvoicesBreakdown": "/api/account/invoices/project/6aadb0a0464b5c58eb1a042b/breakdown",
    "legacy": {
      "invoicesQuery": "/api/account/invoices?leadId=6aadb0a0464b5c58eb1a042b",
      "paymentsOrder": "/api/account/payments/orders/6aadb0a0464b5c58eb1a042b"
    }
  }
}
```

### 1.2 Invoices summary

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/invoices/summary
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalInvoices": 1,
    "invoiceAmount": 1690600,
    "totalBilled": 1690600,
    "totalReceived": 1690600,
    "outstandingAmount": 0,
    "overdueAmount": 0
  }
}
```

### 1.3 Invoices records

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/invoices/records?page=1&limit=10&search=&paymentStatus=&sortBy=dueDate&sortOrder=desc
Authorization: Bearer <token>
```

| Query | Values |
|-------|--------|
| `paymentStatus` | `paid`, `pending`, `unpaid` (optional) |
| `sortBy` | `dueDate`, `amount`, `date` |
| `sortOrder` | `asc`, `desc` |

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "records": [
      {
        "invoiceId": "6aadb352464b5c58eb1a0a64",
        "invoiceNumber": "INV-0038",
        "customerName": "Adam Gilchrist",
        "customerId": "6aadb06d464b5c58eb1a040f",
        "project": "Adam Gilchrist",
        "projectName": "Adam Gilchrist",
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "invoiceType": "product",
        "invoiceTypeLabel": "Product",
        "amount": 1690600,
        "dueDate": null,
        "invoiceDate": "2026-09-19T00:00:00.000Z",
        "paymentStatus": "Paid",
        "invoiceStatus": "paid",
        "paid": 1690600,
        "amountDue": 0,
        "status": "Paid",
        "sentDate": "2026-09-19T00:00:00.000Z",
        "items": 1
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Adam Gilchrist"
  }
}
```

### 1.4 Payments summary

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/payments/summary
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalPaymentsReceived": 1691602,
    "paymentCompletionPct": 100.06,
    "pendingAmount": 0,
    "overdueAmount": 0,
    "totalInvoiced": 1690600
  }
}
```

### 1.5 Payments records

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/payments/records?page=1&limit=10
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "records": [
      {
        "paymentId": "6ab4d72000f413ad1cdb6e4c",
        "date": "2026-09-24T07:54:20.322Z",
        "amount": 1002,
        "relatedTo": "Vendor",
        "status": "Received",
        "invoiceNumber": "VINV-2026-1005",
        "invoiceId": "6ab4d72000f413ad1cdb6e4c",
        "source": "payable_invoice",
        "documentUrl": "https://example.com/t.pdf"
      },
      {
        "paymentId": "6aadb352464b5c58eb1a0a64",
        "date": "2026-09-18T21:57:53.322Z",
        "amount": 1690600,
        "relatedTo": "Customer",
        "status": "Received",
        "invoiceNumber": "INV-0038",
        "invoiceId": "6aadb352464b5c58eb1a0a64",
        "source": "customer_invoice"
      }
    ],
    "total": 2,
    "page": 1,
    "limit": 10,
    "leadId": "6aadb0a0464b5c58eb1a042b"
  }
}
```

### 1.6 Deliveries list

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/deliveries?page=1&limit=10
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "records": [
      {
        "deliveryId": "6ac40e5994a6cf8feeec66f0",
        "deliveryNumber": "DEL-2026-0041",
        "title": "hvc",
        "status": "scheduled",
        "deliveryDate": "2026-10-12T00:00:00.000Z",
        "pickupDate": null,
        "timeWindow": "",
        "siteAddress": "jgcut",
        "materialCategory": "",
        "priority": "normal"
      }
    ],
    "total": 2,
    "page": 1,
    "limit": 10,
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Adam Gilchrist"
  }
}
```

### 1.7 Delivery detail

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/deliveries/6ac40e5994a6cf8feeec66f0
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "delivery": {
      "deliveryId": "6ac40e5994a6cf8feeec66f0",
      "deliveryNumber": "DEL-2026-0041",
      "status": "scheduled",
      "statusHistory": [],
      "project": {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Adam Gilchrist",
        "jobId": "PRO-042"
      },
      "overview": {
        "description": "",
        "materialCategory": "",
        "deliveryDate": "2026-10-12T00:00:00.000Z",
        "timeWindow": "",
        "siteAddress": "jgcut",
        "pickupDate": null
      },
      "vendor": {
        "name": "Namra Pvt Ltd",
        "contactName": "",
        "phone": "",
        "email": ""
      },
      "deliveryCompany": null,
      "siteCoordination": {
        "siteInstructions": "",
        "requiredEquipment": "",
        "equipmentConfirmationStatus": "Pending",
        "specialNotes": ""
      },
      "receivingPoc": "",
      "freightLoadId": null
    }
  }
}
```

(`vendor` / `deliveryCompany` may be `null` if not linked.)

### 1.8 Quotations list

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/quotations
Authorization: Bearer <token>
```

Optional query: `status` (quotation workflow status).

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "quotations": [
      {
        "quotationId": "6aadb2dc464b5c58eb1a08c4",
        "quotationNumber": "QUO-0021",
        "status": "draft",
        "approvalStatus": "approved",
        "finalPrice": 1690600,
        "proposalDate": "2026-09-18T21:53:17.940Z",
        "versionNumber": 1,
        "currency": "USD"
      }
    ],
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "total": 1
  }
}
```

### 1.9 Quotation detail

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/quotations/6aadb2dc464b5c58eb1a08c4
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Adam Gilchrist",
    "downloadPath": "/api/account/projects/6aadb0a0464b5c58eb1a042b/quotations/6aadb2dc464b5c58eb1a08c4/pdf",
    "quotation": {
      "_id": "6aadb2dc464b5c58eb1a08c4",
      "quoteNumber": "QUO-0021",
      "status": "draft",
      "finalPrice": 1690600,
      "currency": "USD",
      "customerId": {
        "firstName": "Adam Gilchrist",
        "email": "adam@gilchrist.com",
        "company": ""
      }
    }
  }
}
```

(`quotation` is the full Mongoose document shape — use list fields for tables; detail for read-only viewer.)

### 1.10 BOM (consolidated)

See [`frontend-account-project-bom-consolidated-api-2026-10-17.md`](./frontend-account-project-bom-consolidated-api-2026-10-17.md).

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/bom/consolidated
Authorization: Bearer <token>
```

Returns **`summary`**, **`rows[]`**, **`downloads`** — not per-building `bomFiles[]`. `GET .../bom` is an alias.

### 1.11 Agreement

```http
GET /api/account/projects/6aadb0a0464b5c58eb1a042b/agreement
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "projectName": "Adam Gilchrist",
    "jobId": "PRO-042",
    "projectId": "PRO-042",
    "agreement": null,
    "agreementUploadedAt": null,
    "customerId": {
      "_id": "6aadb06d464b5c58eb1a040f",
      "customerId": "CUS-00030",
      "firstName": "Adam Gilchrist",
      "email": "adam@gilchrist.com",
      "phone": { "number": "2255222552", "countryCode": "+1" }
    }
  }
}
```

When signed, `agreement` is typically `{ url, fileName, signedOn, ... }` (same shape as project overview `agreement` block).

---

## 2. Invoice management

**Dedicated spec (Project + Carrier tabs, full route index):** [`frontend-account-invoice-management-api-2026-10-17.md`](./frontend-account-invoice-management-api-2026-10-17.md)

Base: `/api/account/invoice-management`

### Shared list query (summary / records / export)

| Query | Used on |
|-------|---------|
| `page`, `limit` | All `records` |
| `search` | Tables (invoice #, vendor, etc.) |
| `startDate`, `endDate` | Date-scoped tabs |
| `projectId` or `leadId` | Filter to one project |
| `paymentStatus` | Project tab: `paid`, `pending`, `unpaid` |
| `verificationStatus`, `paymentStatus` | Vendor/carrier UI labels |
| `status` | Quotation P&L: `Profitable`, `Low Margin`, `Loss`, or `All` |
| `sortBy`, `sortOrder` | Per-tab (`dueDate`, `amount`, `revenue`, `margin`, …) |

### 2.1 Filters

```http
GET /api/account/invoice-management/filters
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "projectId": "6aadb0a0464b5c58eb1a042b",
        "projectName": "Adam Gilchrist",
        "jobId": "PRO-042"
      }
    ],
    "verificationStatuses": ["Verified", "Pending"],
    "paymentStatuses": ["Completed", "Pending"],
    "miscCategories": ["Maintenance", "Software", "Security", "Professional", "Utilities", "Other"],
    "quotationProfitStatuses": ["Profitable", "Low Margin", "Loss"]
  }
}
```

### 2.2 Project tab (customer AR)

**Summary**

```http
GET /api/account/invoice-management/project/summary?projectId=6aadb0a0464b5c58eb1a042b
Authorization: Bearer <token>
```

Same KPI shape as §1.2 (`totalInvoices`, `invoiceAmount`, `totalBilled`, `totalReceived`, `outstandingAmount`, `overdueAmount`).

**Records** — same row shape as §1.3 (`records`, `total`, `page`, `limit`).

### 2.3 Vendor tab (payables)

**Summary**

```http
GET /api/account/invoice-management/vendor/summary
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalInvoices": 1,
    "invoiceAmount": 1002,
    "pendingVerification": 0,
    "pendingPaymentCount": 0,
    "pendingPaymentAmount": 0
  }
}
```

**Records**

```http
GET /api/account/invoice-management/vendor/records?page=1&limit=10
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "records": [
      {
        "invoiceId": "6ab4d72000f413ad1cdb6e4c",
        "invoiceNumber": "VINV-2026-1005",
        "vendorName": "Namra Pvt Ltd",
        "carrierName": "—",
        "name": "Namra Pvt Ltd",
        "project": "Adam Gilchrist",
        "projectName": "Adam Gilchrist",
        "leadId": "6aadb0a0464b5c58eb1a042b",
        "amount": 1002,
        "dueDate": "2026-10-24T07:54:08.189Z",
        "verification": "Verified",
        "verificationStatus": "paid",
        "payment": "Completed",
        "paymentStatus": "paid",
        "payableStatus": "paid",
        "documentUrl": "https://example.com/t.pdf"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10
  }
}
```

**Carrier tab** — same summary/record pattern; rows use `carrierName` instead of `vendorName`.  
**Legacy:** `GET /api/account/financial/invoices/vendor` and `.../carrier` return the same payable rows.

### 2.4 Miscellaneous tab

**Summary** — KPIs: total count/amount, pending payment, overdue (same query params as vendor).

**Records** — row shape:

```json
{
  "invoiceId": "...",
  "invoiceNumber": "MINV-...",
  "serviceProvider": "Acme Services",
  "category": "Maintenance",
  "amount": 500,
  "invoiceDate": "2026-10-01T00:00:00.000Z",
  "dueDate": "2026-10-31T00:00:00.000Z",
  "approval": "Pending",
  "payment": "Pending",
  "payableStatus": "pending_admin_approval",
  "projectName": "Adam Gilchrist",
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "documentUrl": ""
}
```

**Create misc payable**

```http
POST /api/account/invoice-management/miscellaneous
Authorization: Bearer <token>
Content-Type: application/json
```

**Request body:**

```json
{
  "projectId": "6aadb0a0464b5c58eb1a042b",
  "serviceProvider": "Acme Facility Co",
  "amount": 1250,
  "serviceCategory": "Maintenance",
  "dueDate": "2026-11-30T00:00:00.000Z",
  "documentUrl": "https://cdn.example.com/invoices/misc-001.pdf",
  "documentFileName": "misc-001.pdf",
  "description": "Quarterly HVAC",
  "invoiceNumber": "MINV-2026-0099",
  "paymentStatus": "unpaid"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `projectId` or `leadId` | Yes | Lead Mongo id |
| `serviceProvider` or `payeeName` | Yes | |
| `amount` or `totalAmount` | Yes | Positive number |
| `serviceCategory` | No | Defaults to `Other`; use `miscCategories` from filters |
| `dueDate`, `documentUrl`, `description`, `invoiceNumber` | No | |

**Response `data`:**

```json
{
  "record": {
    "invoiceId": "67...",
    "invoiceNumber": "MINV-2026-0099",
    "serviceProvider": "Acme Facility Co",
    "category": "Maintenance",
    "amount": 1250,
    "invoiceDate": "2026-10-15T12:00:00.000Z",
    "dueDate": "2026-11-30T00:00:00.000Z",
    "approval": "Pending",
    "payment": "Pending",
    "payableStatus": "pending_admin_approval",
    "projectName": "Adam Gilchrist",
    "leadId": "6aadb0a0464b5c58eb1a042b",
    "documentUrl": "https://cdn.example.com/invoices/misc-001.pdf"
  }
}
```

### 2.5 Quotation-wise P&L

**Summary**

```http
GET /api/account/invoice-management/quotation-profit/summary
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalQuotations": 23,
    "quotedRevenue": 17375513,
    "actualRevenue": 17375513,
    "actualCost": 422800,
    "actualProfit": 16952713
  }
}
```

**Records row shape**

```json
{
  "quotationId": "6aadb2dc464b5c58eb1a08c4",
  "quotationNumber": "QUO-0021",
  "customerName": "Adam Gilchrist",
  "customerId": "6aadb06d464b5c58eb1a040f",
  "project": "Adam Gilchrist",
  "projectName": "Adam Gilchrist",
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "revenue": 1690600,
  "actualCost": 68000,
  "profitLoss": 1622600,
  "profitLossLabel": "+$1,622,600",
  "marginPct": 95.98,
  "status": "Profitable",
  "statusCode": "P",
  "documentUrl": "",
  "proposalDate": "2026-09-18T21:53:17.940Z"
}
```

**Detail**

```http
GET /api/account/invoice-management/quotation-profit/6aadb2dc464b5c58eb1a08c4
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "record": { },
    "quotation": { }
  }
}
```

(`record` = row above; `quotation` = populated quotation document.)

**Upload / override**

```http
POST /api/account/invoice-management/quotation-profit/upload
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "quotationId": "6aadb2dc464b5c58eb1a08c4",
  "documentUrl": "https://cdn.example.com/pl/quo-0021-analysis.xlsx",
  "documentFileName": "quo-0021-analysis.xlsx",
  "revenue": 1690600,
  "actualCost": 72000,
  "status": "Profitable"
}
```

| Field | Notes |
|-------|--------|
| `quotationId` or `leadId` | One required (`leadId` uses latest quotation) |
| `status` | `Profitable`, `Low Margin`, `Loss` |
| `revenue`, `actualCost` | Optional overrides stored on `quotation.profitAnalysis` |

**Response `data`:** `{ "record": { ...same row shape... } }`

---

## 3. Expenses submenu (`/costs`)

Base: `/api/account/costs`

### 3.1 Filters

```http
GET /api/account/costs/filters
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      { "leadId": "6aadb0a0464b5c58eb1a042b", "projectName": "Adam Gilchrist", "jobId": "PRO-042" }
    ],
    "vendors": [{ "vendorId": "...", "label": "Namra Pvt Ltd", "code": "" }],
    "employees": [
      {
        "userId": "...",
        "name": "Sales One",
        "email": "sales1@example.com",
        "employeeId": "EMP-CA3D",
        "designation": "sales"
      }
    ],
    "designations": ["salary", "labour"],
    "paymentStatuses": ["pending", "approved", "paid", "rejected"]
  }
}
```

### 3.2 Salary (example)

**Summary**

```http
GET /api/account/costs/salary/summary
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalSalaryCost": 0,
    "netSalaryPaid": 0,
    "pendingSalary": 0,
    "trends": {
      "totalSalaryCost": 0,
      "netSalaryPaid": 0,
      "pendingSalary": 0
    }
  }
}
```

**List**

```http
GET /api/account/costs/salary/records?page=1&limit=10
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "rows": [
      {
        "id": "...",
        "expenseId": "EXP-001",
        "employeeName": "Jane Doe",
        "employeeId": "EMP-1001",
        "designation": "account",
        "netSalary": 4500,
        "status": "Unpaid",
        "adminApproval": "Pending",
        "date": "2026-10-01T00:00:00.000Z",
        "paymentStatus": "pending"
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 0, "totalPages": 1 }
  }
}
```

**Create**

```http
POST /api/account/costs/salary/records
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "date": "2026-10-01T00:00:00.000Z",
  "netSalary": 4500,
  "employeeName": "Jane Doe",
  "employeeId": "EMP-1001",
  "employeeUserId": "69e61375e2dc3d6e7468ca3d",
  "designation": "account",
  "leadId": null,
  "paymentStatus": "pending",
  "adminApproval": "Pending"
}
```

(`date` required; `amount` accepted instead of `netSalary`.)

**Response `data`:** single salary row object (same shape as list item).

**Other salary routes**

| Method | Path |
|--------|------|
| PATCH | `/costs/salary/records/:id/mark-paid` |
| DELETE | `/costs/salary/records/:id` |

### 3.3 Manpower

| GET | `/costs/manpower/summary`, `/costs/manpower/records` |
| POST | `/costs/manpower/records` — body: `{ "date": "<ISO>", "leadId?": "...", ...metadata fields }` |
| PUT | `/costs/manpower/records/:id` |
| DELETE | `/costs/manpower/records/:id` |

### 3.4 Miscellaneous costs

| GET | `/summary`, `/overview-chart`, `/by-category`, `/by-project`, `/records` |
| POST | `/miscellaneous/records` |

```json
{
  "amount": 350,
  "date": "2026-10-10T00:00:00.000Z",
  "expenseName": "Office supplies",
  "expenseCategory": "other",
  "leadId": "6aadb0a0464b5c58eb1a042b",
  "vendorPayee": "Staples",
  "paymentStatus": "Paid",
  "receiptFile": "https://..."
}
```

### 3.5 Freight & logistics

| GET | `/freight/summary`, `/freight/trend`, `/freight/carrier-distribution`, `/freight/records` |
| GET | `/logistics/summary`, `/logistics/records` |
| GET | `/logistics/delivery-lookup/:deliveryRef` |
| POST | `/logistics/records` |

```json
{
  "deliveryId": "6ac40e5994a6cf8feeec66f0",
  "finalAmount": 48000,
  "amount": 48000
}
```

### 3.6 Variance, rent, future

| Area | GET endpoints |
|------|----------------|
| Cost variation | `/variance/summary`, `/variance/alerts`, `/variance/trend`, `/variance/details` |
| Rent | `/rent/summary`, `/rent/records` · POST `{ "amount", "date" }` |
| Future income/expense | `/future/summary`, `/future/records` · POST `{ "amount", "date", "flowType": "income"|"expense" }` |

### 3.7 SMDT item list

| GET | `/item-list/summary`, `/stats`, `/categories`, `/records`, `/records/:itemId`, `/export` |
| POST | `/item-list/records` |

```json
{
  "category": "Primary Framing",
  "partName": "W12x26",
  "costUnit": "LF",
  "mbsCost": 12.45
}
```

| PUT | `/item-list/records/:itemId` |

---

## 4. Analytics reports

**Full API spec (all keys, types, date-filter rules, related P&L routes):** [`frontend-account-analytics-project-wise-spec.md`](./frontend-account-analytics-project-wise-spec.md)

**Project drill-down (income / expense detail pages, tabs, Add Received modal):** [`frontend-account-analytics-project-detail-api.md`](./frontend-account-analytics-project-detail-api.md)

Base: `/api/account/reports`

Shared query: `page`, `limit`, `search`, `startDate`, `endDate`, `months` (chart length, default 6).

### 4.1 Project-wise expense

```http
GET /api/account/reports/project-wise-expense?page=1&limit=10&months=6
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
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
      { "key": "materialCost", "label": "Material Cost", "amount": 11468368, "color": "blue" }
    ],
    "topExpenseCategoriesThisMonth": [
      { "key": "materialCost", "label": "Material Cost", "amount": 11468368, "color": "blue" }
    ],
    "rows": [
      {
        "leadId": "6a6b63cc63a85950372e1da6",
        "projectName": "",
        "projectId": "PRO-001",
        "status": "initial_contact",
        "totalExpense": 0,
        "approvedExpense": 0,
        "pendingApproval": 0,
        "budgetedExpense": 0,
        "budgetVariance": 0,
        "variancePct": 0,
        "sources": {
          "manualExpenses": 0,
          "vendorMaterialFromEmailBids": 0,
          "freightFromEmailBids": 0
        }
      }
    ],
    "pagination": { "page": 1, "limit": 10, "total": 64, "totalPages": 7 }
  }
}
```

### 4.2 Project-wise income

```http
GET /api/account/reports/project-wise-income?page=1&limit=10&months=6
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "summary": {
      "totalIncome": 0,
      "receivedIncome": 0,
      "pendingIncome": 0,
      "overdueIncome": 0
    },
    "incomeOverviewChart": [
      { "label": "Oct 2026", "totalIncome": 0, "receivedIncome": 0, "pendingIncome": 0 }
    ],
    "incomeByProjectThisMonth": {
      "total": 0,
      "segments": [{ "leadId": "...", "projectName": "Adam Gilchrist", "amount": 0, "pct": 0 }]
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
    "pagination": { "page": 1, "limit": 10, "total": 64, "totalPages": 7 }
  }
}
```

(`GET /reports/profit-loss` — existing route; expense side now includes combined project expense sources.)

---

## 5. Custom budget lines (account read only)

Admins set budgets on **`POST /api/admin/leads/:leadId/budget`** — see [`frontend-admin-project-budget-custom-lines-api.md`](./frontend-admin-project-budget-custom-lines-api.md). Account UI only **reads** the result:

| Route | Use |
|-------|-----|
| `GET /api/account/financial/budget-vs-actual?leadId=` | Detail table; `costHeads[]` includes `isCustom: true` rows |
| `GET /api/account/dashboard/project-budget-vs-actual` | Dashboard teaser |
| `GET /api/account/projects/:projectId` | `profitabilityOverview` / rollup totals include custom budget in variance math |
| `GET /api/account/reports/project-wise-expense` | `budgetedExpense`, `budgetVariance` per row |

Full response shapes: [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) §5 Budget vs actual.

---

## 6. Customer detail fix (no new route)

`GET /api/account/customers/:customerId` — `totalExpenses` now uses combined expense rollup (fixes prior 500).

Example fragment in `data.financialSummary`:

```json
{
  "totalExpenses": 68000,
  "totalRevenue": 1690600
}
```

---

## 7. Quick verification

```bash
# Local (real DB)
PORT=5001 node server.js
BASE_URL=http://127.0.0.1:5001 npm run test:live-server

# Production
BASE_URL=https://mr-storage-backend-025k.onrender.com npm run test:live-server
```

---

*Handoff version: 2026-10-15 · Examples captured against local Mongo (`6aadb0a0464b5c58eb1a042b`, etc.)*
