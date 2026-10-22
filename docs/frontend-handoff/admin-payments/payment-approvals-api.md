# Payment Approvals — Admin & Account API handoff

**Date:** 2026-10-22  
**Figma:** Admin → Payments → **Payment Approvals** (filters, KPI cards, table, Export, review actions)

---

## Which base path to use

| Need | Base path | Role |
|------|-----------|------|
| **Full Figma (recommended)** | `/api/account/financial/payment-approvals` | `admin` or `account` |
| Admin-only alias | `/api/admin/financial-extra/payment-approvals` | `admin` |
| Legacy admin | `/api/admin/financials/payment-approvals` | `admin` |

Use **one base** in the Admin app; paths below show the **recommended** Account financial prefix.

```http
Authorization: Bearer <admin-or-account-token>
```

---

## Figma → API map

| UI | API |
|----|-----|
| **Request Date** filter | `startDate`, `endDate` (Account: filters **due date**; Admin-extra: **createdAt**) |
| **Category** | `category` or pick from `GET …/filters` |
| **Requested By** | `requestedBy` = user `_id` (Admin-extra filters) · Account filters use `payeeType` / `project` / `search` |
| **Status** | `status` |
| KPI: Total Requests | List `data.total` or stats (see below) |
| KPI: Pending / Approved / Rejected + amounts | Account: `GET …/stats` · Admin-extra: `data.stats` on list |
| Table rows | `GET …/payment-approvals` → `approvals[]` |
| **Export** | `GET …/payment-approvals/export?…` → Excel |
| Approve / Reject (actions) | `PUT …/payment-approvals/:approvalId/review` |
| Approval details sheet | `GET …/payment-approvals/:approvalId` (Account **or** Admin prefix) |
| Add remark (Reviews tab) | `POST …/payment-approvals/:approvalId/remarks` |
| Add attachment | `POST …/payment-approvals/:approvalId/attachments` |
| Download attachment | `GET …/payment-approvals/:approvalId/attachments/:index/download` |

---

## 1. Filter dropdowns

```http
GET /api/account/financial/payment-approvals/filters
```

**Response `data` (fragment):**

```json
{
  "projects": [
    { "leadId": "67a1…", "projectName": "Lucas project", "jobId": "PRO-002", "businessUnit": "steel" }
  ],
  "payeeTypes": [
    { "code": "carrier", "label": "Carrier" },
    { "code": "delivery_company", "label": "Delivery Company" },
    { "code": "vendor", "label": "Vendor" }
  ],
  "statuses": ["pending", "under_review", "approved", "disputed", "rejected"],
  "workflowStages": ["pending", "under_review", "approved", "paid", "disputed"]
}
```

**Admin-extra filters** (`/api/admin/financial-extra/payment-approvals/filters`):

```json
{
  "categories": ["vendor_payment", "shipper_payment", "equipment", "other_expenses"],
  "statuses": ["pending", "under_review", "approved", "disputed", "rejected"],
  "requestedBy": [{ "userId": "69e7…", "name": "Plant User" }]
}
```

---

## 2. KPI / stat cards

### Account (matches Figma counts by workflow)

```http
GET /api/account/financial/payment-approvals/stats?status=&project=&…
```

Same query params as list (filters scope stats).

```json
{
  "success": true,
  "data": {
    "pendingApproval": 2,
    "underReview": 1,
    "approved": 5,
    "disputed": 0
  }
}
```

### Admin-extra (amounts on list response)

`GET /api/admin/financial-extra/payment-approvals` includes:

```json
"stats": {
  "totalRequests": 8,
  "pendingApproval": 2,
  "pendingAmount": 9000,
  "approved": 5,
  "approvedAmount": 42000,
  "rejected": 1,
  "totalAmount": 51000
}
```

Map Figma cards:

| Card | Account | Admin-extra |
|------|---------|-------------|
| Total Requests | `GET …/stats` sum or list `total` | `stats.totalRequests` |
| Pending Approval | `pendingApproval` | `pendingApproval` + `pendingAmount` |
| Approved | `approved` | `approved` + `approvedAmount` |
| Rejected | count via list filter `status=rejected` | `rejected` |
| Total Amount | sum `approvals[].amount` or export | `stats.totalAmount` |

---

## 3. Payment requests table

```http
GET /api/account/financial/payment-approvals?page=1&limit=10&status=pending&category=vendor_payment&search=&project=&payeeType=&startDate=&endDate=
```

| Query | Description |
|-------|-------------|
| `page`, `limit` | Pagination (default limit 20 on Account) |
| `status` | `pending` · `under_review` · `approved` · `disputed` · `rejected` |
| `payeeType` | `vendor` · `carrier` · `delivery_company` · `shipper` · `department` |
| `project` | Lead `_id` |
| `search` | Payee name, invoice #, payment id, project name |
| `startDate` / `endDate` | **Due date** range (Account) |

**Admin-extra list query:** `status`, `category`, `department`, `requestedBy`, `startDate`, `endDate` (date = **request createdAt**), `page`, `limit`.

### Row shape (Account — use for Admin table)

| Figma column | Field |
|--------------|--------|
| Payment ID | `paymentId` on raw doc, or list `approvalId` (Mongo `_id`) — display **`paymentId`** from detail/export if shown as `PR-2026-00001` |
| Request Date | Use `createdAt` from detail or export; list row may expose via raw fetch |
| Payee / Vendor | `companyName` |
| Category | `category` (`vendor_payment`, `shipper_payment`, `equipment`, `other_expenses`) |
| Requested By | `requestedBy.name` (detail) |
| Amount | `amount` |
| Status | `statusLabel` / `status` |
| Actions | `PUT …/review` with `approvalId` |

**Example list item:**

```json
{
  "approvalId": "67a1b2c3d4e5f6789012345c",
  "companyName": "FastTruck Logistics",
  "invoiceNumber": "INV-2024-0345",
  "project": { "leadId": "67a1…", "projectName": "Lucas project", "jobId": "PRO-002" },
  "amount": 4500,
  "dueDate": "2026-08-30T00:00:00.000Z",
  "status": "pending",
  "statusLabel": "Pending",
  "category": "vendor_payment",
  "linkedTo": "Load: LD-0789"
}
```

Empty state (`No payment approval requests found`) = **`approvals: []`**, `total: 0`.

---

## 4. Approval details sheet (drawer)

```http
GET /api/admin/financial-extra/payment-approvals/{approvalId}
GET /api/account/financial/payment-approvals/{approvalId}
Authorization: Bearer <token>
```

**Response `data` (UI-oriented):**

| Block | Use |
|-------|-----|
| `paymentId` | Header `PR-2026-00013` |
| `statusLabel` | Badge only (e.g. **Approved**, **Pending**) — do not append `"Approval"` |
| `canReview` | Show footer **Approve/Reject** only when `true` |
| `header` | Summary grid: payee, `categoryLabel`, `requestedBy`, `requestedAt`, `invoiceNumber`, `dueDate`, `amount` |
| `details` | Details tab: `additionalNotes`, `invoiceDetails`, `costBreakdown`, `linkedTransaction`, `project` |
| `details.hasAdditionalDetails` | If false and no breakdown to show → “No additional details” |
| `reviews.remarks[]` | Reviews tab thread (`authorName`, `authorInitials`, `text`, `createdAt`, `isLatest`) |
| `attachments[]` | Attachments tab |
| `history[]` | History tab (`at`, `type`, `label`, `userName`) |

Legacy flat fields (`companyName`, `invoiceDetails`, …) remain for older clients.

**Example fragment:**

```json
{
  "paymentId": "PR-2026-00013",
  "status": "approved",
  "statusLabel": "Approved",
  "canReview": false,
  "header": {
    "payee": "nads",
    "category": "other_expenses",
    "categoryLabel": "Other Expenses",
    "requestedBy": { "_id": "…", "name": "Daniel Torres" },
    "requestedAt": "2026-10-22T10:29:59.000Z",
    "invoiceNumber": "FR-06DCD",
    "dueDate": null,
    "amount": 432523
  },
  "reviews": { "remarks": [] },
  "attachments": [],
  "history": [{ "at": "2026-10-22T10:30:00.000Z", "type": "review", "label": "Status changed to approved", "userName": "Admin User" }]
}
```

### 4.1 Add remark (Reviews → “Add Remark”)

```http
POST /api/admin/financial-extra/payment-approvals/{approvalId}/remarks
Content-Type: application/json

{ "text": "Invoice and supporting documents verified." }
```

Returns updated detail payload (same shape as GET).

### 4.2 Attachments

```http
POST /api/admin/financial-extra/payment-approvals/{approvalId}/attachments
Content-Type: application/json

{ "name": "invoice.pdf", "url": "https://…", "fileSize": 120400 }
```

```http
GET /api/admin/financial-extra/payment-approvals/{approvalId}/attachments/0/download
```

→ Redirect to stored `url` (upload file via your existing S3/upload flow first).

---

## 5. Review / approve / reject

### Account (full workflow)

```http
PUT /api/account/financial/payment-approvals/{approvalId}/review
Content-Type: application/json

{
  "action": "approved",
  "reviewNotes": "Approved after freight docs verified"
}
```

| `action` | Effect |
|----------|--------|
| `under_review` | Status → under review |
| `approved` | Approved + sets `paidAt` now (UI may show **Paid**) |
| `disputed` | Disputed |
| `rejected` | Rejected |

### Admin-extra (limited)

```http
PUT /api/admin/financial-extra/payment-approvals/{approvalId}/review
{ "action": "approved" | "rejected", "reviewNotes": "…" }
```

Only from **`pending`**; only **`approved`** or **`rejected`**.

---

## 6. Export

```http
GET /api/account/financial/payment-approvals/export?status=pending&startDate=2026-08-01&endDate=2026-08-31
```

Response: **`payment-approvals.xlsx`** (same filters as list).

Admin-extra: `GET /api/admin/financial-extra/payment-approvals/export?…`

---

## 7. Create request (optional / plant flows)

```http
POST /api/admin/financial-extra/payment-approvals
Content-Type: application/json

{
  "payee": "ABC Vendor",
  "category": "vendor_payment",
  "amount": 1200,
  "payeeType": "vendor",
  "leadId": "67a1…",
  "notes": "Materials invoice"
}
```

Server assigns `paymentId` (`PR-YYYY-#####`) and `requestedBy` = current user.

---

## Data model reference

Collection: **`PaymentApproval`**

| Field | Notes |
|-------|--------|
| `paymentId` | Public id `PR-…` |
| `payee` | Vendor/carrier name |
| `payeeType` | `vendor` · `carrier` · `delivery_company` · … |
| `category` | `vendor_payment` · `shipper_payment` · `equipment` · `other_expenses` |
| `amount` | USD number |
| `status` | See statuses above |
| `requestedBy` | User ref (plant/sales/admin) |
| `leadId` | Optional project link |
| `linkedType` / `linkedId` | `delivery` or `freight_bid` when created from logistics |
| `invoiceNumber`, `dueDate` | Invoice management / approvals UI |

Many rows are **created automatically** when freight bids are awarded or logistics workflows run (see `accountCostsActions.service.js`).

---

## Empty UI / test data

If all KPIs are **0** and the table is empty, prod DB may have no `PaymentApproval` rows. Optional seed (dev/staging only):

```bash
node scripts/seedPaymentApprovalsMock.js
```

---

## Related docs

- [`../../frontend-account-panel-api.md`](../../frontend-account-panel-api.md) §3 Payment Approvals  
- [`../../frontend-account-payments-api.md`](../../frontend-account-payments-api.md) §B  
- [`../../frontend-account-costs-actions-handoff-2026-10-19.md`](../../frontend-account-costs-actions-handoff-2026-10-19.md) — freight/logistics ↔ approvals  
- [`../../vendor-freight-payables-flow-2026-09-24.md`](../../vendor-freight-payables-flow-2026-09-24.md) — prefer `/api/account/payables` for new vendor UI  

---

## Quick smoke (admin token)

```bash
BASE="https://mr-storage-backend-025k.onrender.com/api/account/financial/payment-approvals"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/filters" | head -c 400
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/stats"
curl -s -H "Authorization: Bearer $TOKEN" "$BASE?page=1&limit=10"
```
