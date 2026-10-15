# Account panel — Project detail & sub-pages (Figma)

Base: **`/api/account/projects`**  
Auth: **`account`** | **`admin`** · `Authorization: Bearer <token>`

Use Mongo **`leadId`** or **`jobId`** as `:projectId` everywhere below.

---

## 1. Project overview (main screen)

```http
GET /api/account/projects/:projectId
```

Returns overview, contact, financial KPIs, progress stepper, profitability table, and **`actionLinks`** — all paths under **`/api/account/projects/...`** (no sales/admin/plant URLs).

**Example `actionLinks`:**

```json
{
  "overview": "/api/account/projects/67a1b2c3d4e5f6789012345a",
  "invoices": "/api/account/projects/67a1b2c3d4e5f6789012345a/invoices/summary",
  "invoiceRecords": "/api/account/projects/67a1b2c3d4e5f6789012345a/invoices/records",
  "payments": "/api/account/projects/67a1b2c3d4e5f6789012345a/payments/summary",
  "paymentRecords": "/api/account/projects/67a1b2c3d4e5f6789012345a/payments/records",
  "deliveries": "/api/account/projects/67a1b2c3d4e5f6789012345a/deliveries",
  "quotations": "/api/account/projects/67a1b2c3d4e5f6789012345a/quotations",
  "bom": "/api/account/projects/67a1b2c3d4e5f6789012345a/bom",
  "agreement": "/api/account/projects/67a1b2c3d4e5f6789012345a/agreement",
  "projectInvoicesBreakdown": "/api/account/invoices/project/67a1b2c3d4e5f6789012345a/breakdown"
}
```

| Figma button | Call |
|--------------|------|
| View Invoices | `invoices` + `invoiceRecords` |
| View Payments | `payments` + `paymentRecords` |
| Material Delivery | `deliveries` → detail `.../deliveries/:deliveryId` |
| View Quotation | `quotations` → `.../quotations/:quotationId` |
| View BOM | `bom` |
| View Agreement | `agreement` |

Mark customer invoice paid (account): `PUT /api/account/invoices/:invoiceId/mark-paid`

---

## 2. View Invoices (project sub-page)

### Summary KPIs

```http
GET /api/account/projects/:projectId/invoices/summary?startDate=&endDate=
```

**`data`:** `totalInvoices`, `invoiceAmount`, `totalBilled`, `totalReceived`, `outstandingAmount`, `overdueAmount`

### Table

```http
GET /api/account/projects/:projectId/invoices/records?page=1&limit=20&search=&paymentStatus=&sortBy=dueDate|amount|date&sortOrder=asc|desc
```

**Row fields:** `invoiceId`, `invoiceNumber`, `amount`, `sentDate`, `items` (line count), `status` (`Paid` | `Pending` | `Overdue`), `dueDate`, `invoiceStatus`, `amountDue`

---

## 3. View Payments (project sub-page)

### Summary KPIs

```http
GET /api/account/projects/:projectId/payments/summary
```

**`data`:** `totalPaymentsReceived`, `paymentCompletionPct`, `pendingAmount`, `overdueAmount`, `totalInvoiced`

Combines **customer invoices paid**, **approved payment approvals**, and **paid vendor/carrier payables** on the project.

### Table

```http
GET /api/account/projects/:projectId/payments/records?page=1&limit=20&search=&status=
```

**Row fields:** `paymentId`, `date`, `amount`, `relatedTo` (`Customer` | `Vendor` | `Carrier`), `status` (`Received`), `invoiceNumber`, `invoiceId`, `source` (`payment_approval` | `payable_invoice` | `customer_invoice`), optional `documentUrl`

WIP order payment (Add/Edit payment modal): `GET /api/account/payments/orders/:orderId` (existing; `:orderId` = WIP id or `leadId`)

---

## 4. Material Delivery

### List

```http
GET /api/account/projects/:projectId/deliveries?page=1&limit=20&status=
```

**Row fields:** `deliveryId`, `deliveryNumber`, `title`, `status`, `deliveryDate`, `pickupDate`, `timeWindow`, `siteAddress`, `materialCategory`, `priority`

### Detail (Figma delivery screen)

```http
GET /api/account/projects/:projectId/deliveries/:deliveryId
```

**`data.delivery`:** `overview`, `vendor`, `deliveryCompany`, `siteCoordination`, `receivingPoc`, `statusHistory`, `freightLoadId`

Read-only for account (status changes remain plant/construction APIs).

---

## 5. View Quotation

### List

```http
GET /api/account/projects/:projectId/quotations?status=
```

**`data.quotations[]`:** `quotationId`, `quotationNumber`, `status`, `approvalStatus`, `finalPrice`, `proposalDate`, `versionNumber`, `currency`

### Detail

```http
GET /api/account/projects/:projectId/quotations/:quotationId
```

**`data`:** full `quotation` document (read-only), `projectName`, `leadId`

PDF/HTML preview (same payload as sales): use sales/common only if account role is extended; otherwise render from `quotation` JSON on FE or request admin/sales proxy.

---

## 6. View BOM

```http
GET /api/account/projects/:projectId/bom
```

**`data`:**

- `bomFiles[]` — per-building uploads (`fileUrl`, `fileName`, `status`, `totalItems`, …)
- `consolidatedBOM` — generated consolidated file metadata (or `null`)
- `consolidatedUrlPath` — optional signed URL helper on plant BOM module (read-only)

Account cannot upload BOM (plant only).

---

## 7. View Agreement

```http
GET /api/account/projects/:projectId/agreement
```

**`data`:** same shape as admin `GET .../agreement`:

- `leadId`, `projectName`, `jobId`, `projectId`
- `agreement` — `{ url, fileName, name, uploadedAt, uploadedBy }`
- `agreementUploadedAt`

Replaces `GET /api/admin/customers/:customerId/projects/:leadId/agreement` for account UI.

---

## 8. Project list

```http
GET /api/account/projects?search=&status=&startDate=&endDate=
```

---

## Errors

| HTTP | When |
|------|------|
| `404` | Unknown `:projectId` or child id not on project |
| `401` / `403` | Missing token or wrong role |

---

*Updated: 2026-10-15 — Account-native sub-page routes; no sales/admin/plant links in `actionLinks`.*
