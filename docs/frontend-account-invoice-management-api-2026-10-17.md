# Account — Invoice Management API (`/api/account/invoice-management`)

**Date:** 2026-10-17  
**Base URL:** `https://mr-storage-backend-025k.onrender.com` (or local)  
**Base path:** `/api/account/invoice-management`  
**Auth:** `Authorization: Bearer <token>`  
**Roles:** `account`, `admin`

Figma sidebar tabs: **Project Invoices**, **Vendor Invoices**, **Carrier Invoices**, **Miscellaneous Inv**, **Quotation-wise Profit / Loss**.

This doc is the **full spec for Invoice Management**. It includes complete examples for **Project Invoices** and **Carrier Invoices** (previously only summarized in [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) §10). Other tabs are included for one-stop integration.

**Related (actions outside this base path):**

| Action | Doc |
|--------|-----|
| Mark customer invoice paid, follow-up email | [`frontend-account-project-invoices-actions-api-2026-10-17.md`](./frontend-account-project-invoices-actions-api-2026-10-17.md) |
| Customer invoice PDF | `GET /api/account/invoices/:invoiceId/pdf` |
| Mark vendor/carrier payable paid | `PUT /api/account/payables/:invoiceId/mark-paid` (below) |
| Project-scoped invoice list (same row shape) | `GET /api/account/projects/:projectId/invoices/summary` & `…/records` |

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

Errors: `{ "success": false, "message": "…" }` with HTTP `400`, `401`, `403`, `404`.

### Shared query parameters

Used on **`summary`**, **`records`**, and **`export`** unless noted.

| Query | Type | Description |
|-------|------|-------------|
| `page` | int | Records only; default `1` |
| `limit` | int | Records only; default `20`, max `100` |
| `search` | string | Tab-specific (invoice #, vendor/carrier name, customer name, etc.) |
| `startDate` | ISO date | Filters on invoice `date` (project/vendor/carrier/misc) or quotation `proposalDate` (P&L tab) |
| `endDate` | ISO date | Same field as `startDate` per tab |
| `projectId` | MongoId | Lead id — filter to one project |
| `leadId` | MongoId | Alias of `projectId` |
| `sortBy` | string | Per tab (see each section) |
| `sortOrder` | `asc` \| `desc` | Default `desc` |

### Export

`GET …/{tab}/export` returns **Excel** (not JSON):

- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="…"`
- Same query filters as `records` (up to 5000 rows server-side)

---

## Filters (all tabs)

```http
GET /api/account/invoice-management/filters
Authorization: Bearer <token>
```

**Response `data`:**

```json
{
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
```

Use `projects[]` for project dropdowns. Payable tabs map UI labels via query (see Vendor/Carrier).

---

## 1. Project Invoices (customer AR)

**Invoice type:** `customer` (`Invoice.invoiceType === 'customer'`).

### 1.1 Summary KPIs

```http
GET /api/account/invoice-management/project/summary?startDate=2026-01-01&endDate=2026-12-31&projectId=6aadb0a0464b5c58eb1a042b
Authorization: Bearer <token>
```

| Query | Notes |
|-------|--------|
| `projectId` / `leadId` | Optional — all projects if omitted |
| `startDate`, `endDate` | Filter on invoice **`date`** |

**Response `data`:**

```json
{
  "totalInvoices": 12,
  "invoiceAmount": 2500000,
  "totalBilled": 2500000,
  "totalReceived": 1800000,
  "outstandingAmount": 700000,
  "overdueAmount": 150000
}
```

| Field | Meaning |
|-------|---------|
| `totalInvoices` | Count in filter |
| `invoiceAmount` / `totalBilled` | Sum of `totalAmount` |
| `totalReceived` | Sum where `status === 'paid'` |
| `outstandingAmount` | Sum where `status` ∈ `sent`, `draft`, `overdue` |
| `overdueAmount` | Sum where `status === 'overdue'` |

### 1.2 Records table

```http
GET /api/account/invoice-management/project/records?page=1&limit=20&search=INV-&paymentStatus=pending&sortBy=dueDate&sortOrder=desc
Authorization: Bearer <token>
```

| Query | Values |
|-------|--------|
| `paymentStatus` | `paid` → paid only; `pending` or `unpaid` → not paid (`sent`, `draft`, `overdue`) |
| `sortBy` | `dueDate` (default), `amount`, `date` |
| `search` | Case-insensitive **`invoiceNumber`** |

**Response `data`:**

```json
{
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
      "dueDate": "2026-10-24T00:00:00.000Z",
      "invoiceDate": "2026-09-19T00:00:00.000Z",
      "paymentStatus": "Pending",
      "invoiceStatus": "sent",
      "paid": 0,
      "amountDue": 1690600,
      "documentUrl": "/api/account/invoices/6aadb352464b5c58eb1a0a64/pdf",
      "pdfUrl": "/api/account/invoices/6aadb352464b5c58eb1a0a64/pdf",
      "documentType": "generated_pdf"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

**Row fields (UI mapping):**

| Field | UI use |
|-------|--------|
| `paymentStatus` | `"Paid"` \| `"Pending"` (display) |
| `invoiceStatus` | Raw: `draft`, `sent`, `paid`, `overdue`, … |
| `amountDue` | Outstanding for row |
| `documentUrl` / `pdfUrl` | Open PDF — relative path; prefix with API host. If customer uploaded payment proof, `documentType` is `payment_proof` and `documentUrl` is the proof file |
| `invoiceTypeLabel` | Product / Service / etc. from `category` |

**Row actions (not under `/invoice-management`):**

| UI | Method | Path |
|----|--------|------|
| Mark as Paid | `PUT` | `/api/account/invoices/:invoiceId/mark-paid` |
| Follow up (overdue) | `POST` | `/api/account/invoices/:invoiceId/follow-up` |
| Download invoice | `GET` | `/api/account/invoices/:invoiceId/pdf` |

See [`frontend-account-project-invoices-actions-api-2026-10-17.md`](./frontend-account-project-invoices-actions-api-2026-10-17.md).

### 1.3 Export

```http
GET /api/account/invoice-management/project/export?projectId=6aadb0a0464b5c58eb1a042b
Authorization: Bearer <token>
```

**File:** `project-invoices.xlsx`  
**Columns:** Invoice Number, Customer, Project, Type, Amount, Due Date, Payment

---

## 2. Carrier Invoices (freight payables)

**Invoice type:** `freight_carrier`. Same payable workflow as vendor; rows emphasize **`carrierName`** / **`name`**.

### 2.1 Summary KPIs

```http
GET /api/account/invoice-management/carrier/summary?startDate=2026-01-01&endDate=2026-12-31
Authorization: Bearer <token>
```

**Response `data`:**

```json
{
  "totalInvoices": 4,
  "invoiceAmount": 28500,
  "pendingVerification": 1,
  "pendingPaymentCount": 2,
  "pendingPaymentAmount": 12000
}
```

| Field | Meaning |
|-------|---------|
| `pendingVerification` | Count with payable status `pending_admin_approval` or `rejected` |
| `pendingPaymentCount` | Count with status `approved_for_payment` or `unpaid` |
| `pendingPaymentAmount` | Sum of amounts in pending payment statuses |

### 2.2 Records table

```http
GET /api/account/invoice-management/carrier/records?page=1&limit=20&verificationStatus=Verified&paymentStatus=Pending&search=FC-
Authorization: Bearer <token>
```

| Query | Maps to payable workflow |
|-------|---------------------------|
| `verificationStatus` | `Verified` → approved path; `Pending` → awaiting admin |
| `paymentStatus` | `Completed` / `paid` → paid; `Pending` → not paid |
| `status` | Alias for verification filter on some UIs |
| `sortBy` | `dueDate` (default), `amount`, `date`, `invoiceDate` |
| `search` | `invoiceNumber`, `payeeName`, `serviceCategory` |

**Response `data`:**

```json
{
  "records": [
    {
      "invoiceId": "6ab4d72000f413ad1cdb6e4d",
      "invoiceNumber": "FCINV-2026-1002",
      "vendorName": "—",
      "carrierName": "FastFreight Logistics",
      "name": "FastFreight Logistics",
      "project": "ABC Warehouse",
      "projectName": "ABC Warehouse",
      "leadId": "6aadb0a0464b5c58eb1a042b",
      "amount": 4500,
      "dueDate": "2026-11-15T00:00:00.000Z",
      "verification": "Verified",
      "verificationStatus": "approved_for_payment",
      "payment": "Pending",
      "paymentStatus": "approved_for_payment",
      "payableStatus": "approved_for_payment",
      "documentUrl": "https://cdn.example.com/carrier-inv.pdf"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

**Display rules:**

- Prefer **`carrierName`** or **`name`** for the carrier column (both set for freight rows).
- **`verification`** / **`payment`** are human labels; use **`payableStatus`** for logic.

**Mark carrier invoice paid:**

```http
PUT /api/account/payables/6ab4d72000f413ad1cdb6e4d/mark-paid
Authorization: Bearer <token>
Content-Type: application/json

{ "paymentMethod": "ACH" }
```

- Allowed only when `payableWorkflow.status` is `approved_for_payment` or `unpaid`.
- **400** if still `pending_admin_approval` or `rejected`.

**Response:**

```json
{
  "success": true,
  "message": "Marked as paid",
  "data": {
    "invoice": { }
  }
}
```

(`invoice` is populated payable document — use list row formatter on frontend or refetch `carrier/records`.)

### 2.3 Export

```http
GET /api/account/invoice-management/carrier/export?paymentStatus=Pending
Authorization: Bearer <token>
```

**File:** `carrier-invoices.xlsx`  
**Columns:** Invoice Number, Carrier, Project, Amount, Due Date, Verification, Payment

### 2.4 Legacy alias

Same rows as carrier records:

```http
GET /api/account/financial/invoices/carrier?page=1&limit=20
Authorization: Bearer <token>
```

---

## 3. Vendor Invoices (brief)

Same pattern as **§2 Carrier**, but `invoiceType: vendor` and rows use **`vendorName`** / **`name`** (vendor).

| Endpoint |
|----------|
| `GET /vendor/summary` |
| `GET /vendor/records` |
| `GET /vendor/export` → `vendor-invoices.xlsx` |

Legacy: `GET /api/account/financial/invoices/vendor`.

Full vendor example: [`frontend-account-new-apis-handoff.md`](./frontend-account-new-apis-handoff.md) §2.3.

---

## 4. Miscellaneous Invoices (brief)

| Endpoint | Notes |
|----------|--------|
| `GET /miscellaneous/summary` | KPIs: `totalInvoices`, `totalInvoiceAmount`, `pendingPaymentAmount`, `overdueAmount` |
| `GET /miscellaneous/records` | Rows: `serviceProvider`, `category`, `approval`, `payment` |
| `POST /miscellaneous` | Create account misc payable (`payableWorkflow.source: account_misc`) |
| `GET /miscellaneous/export` | `miscellaneous-invoices.xlsx` |

**POST body (required):** `projectId` or `leadId`, `serviceProvider` or `payeeName`, `amount` or `totalAmount`.  
Optional: `serviceCategory`, `dueDate`, `documentUrl`, `documentFileName`, `invoiceNumber`, `description`, `paymentStatus`.

Full examples: handoff §2.4.

---

## 5. Quotation-wise Profit / Loss (brief)

| Endpoint | Notes |
|----------|--------|
| `GET /quotation-profit/summary` | `totalQuotations`, `quotedRevenue`, `actualRevenue`, `actualCost`, `actualProfit` |
| `GET /quotation-profit/records` | `status` filter: `Profitable`, `Low Margin`, `Loss`, `All` |
| `GET /quotation-profit/:quotationId` | `{ record, quotation }` |
| `POST /quotation-profit/upload` | Overrides on `quotation.profitAnalysis` |
| `GET /quotation-profit/export` | `quotation-profit-loss.xlsx` |

**Cost default:** If `actualCost` not overridden on upload, backend uses **combined project expenses** (manual + email vendor/material + selected freight).

Full examples: handoff §2.5.

---

## 6. Route index

| Method | Path |
|--------|------|
| GET | `/api/account/invoice-management/filters` |
| GET | `/api/account/invoice-management/project/summary` |
| GET | `/api/account/invoice-management/project/records` |
| GET | `/api/account/invoice-management/project/export` |
| GET | `/api/account/invoice-management/vendor/summary` |
| GET | `/api/account/invoice-management/vendor/records` |
| GET | `/api/account/invoice-management/vendor/export` |
| GET | `/api/account/invoice-management/carrier/summary` |
| GET | `/api/account/invoice-management/carrier/records` |
| GET | `/api/account/invoice-management/carrier/export` |
| GET | `/api/account/invoice-management/miscellaneous/summary` |
| GET | `/api/account/invoice-management/miscellaneous/records` |
| POST | `/api/account/invoice-management/miscellaneous` |
| GET | `/api/account/invoice-management/miscellaneous/export` |
| GET | `/api/account/invoice-management/quotation-profit/summary` |
| GET | `/api/account/invoice-management/quotation-profit/records` |
| GET | `/api/account/invoice-management/quotation-profit/export` |
| GET | `/api/account/invoice-management/quotation-profit/:quotationId` |
| POST | `/api/account/invoice-management/quotation-profit/upload` |
| PUT | `/api/account/payables/:invoiceId/mark-paid` |
| PUT | `/api/account/invoices/:invoiceId/mark-paid` |
| POST | `/api/account/invoices/:invoiceId/follow-up` |
| GET | `/api/account/invoices/:invoiceId/pdf` |

---

## 7. Frontend checklist — Project & Carrier tabs

**Project Invoices**

- [ ] Mount: `GET …/project/summary` + `GET …/project/records` with shared filters (`filters.projects`, dates, search).
- [ ] Table columns: invoice #, customer, project, type, amount, due date, payment status, document link (`pdfUrl`).
- [ ] Actions: mark paid / follow up / PDF per §1.2.
- [ ] Export button → `GET …/project/export` (blob).

**Carrier Invoices**

- [ ] Mount: `GET …/carrier/summary` + `GET …/carrier/records`.
- [ ] Filters: verification + payment from `filters.verificationStatuses` / `paymentStatuses`.
- [ ] Table: invoice #, **carrier** (`carrierName`), project, amount, due date, verification, payment.
- [ ] Mark paid → `PUT /api/account/payables/:invoiceId/mark-paid` when verification is Verified and payment Pending.
- [ ] Export → `GET …/carrier/export`.
