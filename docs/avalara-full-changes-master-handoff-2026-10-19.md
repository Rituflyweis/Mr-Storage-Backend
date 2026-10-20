# Avalara & tax — frontend master handoff (before → after, req/res)

**Date:** 2026-10-19  
**Audience:** Frontend (Account, Sales, Admin)  
**API base:** `https://mr-storage-backend-025k.onrender.com`  
**Auth:** `Authorization: Bearer <token>`

Single reference for **what to change in the UI/API client**: old behavior vs new, paths, and example **request/response** bodies.

**Also useful:**

| Doc | Use |
|-----|-----|
| [`frontend-handoff/account-tax/`](./frontend-handoff/account-tax/README.md) | Account tax bundle: Figma map, full API req/res, migration checklist |

---

## 1. Quick summary (frontend)

| Area | Before | After |
|------|--------|-------|
| Project address | `location` + loose city/state/pincode | **`installAddress`** structured object (required for reliable tax) |
| Invoice detail | `tax`, line `taxAmount` only | **`shipToAddress`**, **`taxableSales`**, **`taxCollected`**, **`avalara`** |
| Send / mark-sent | Status → sent; tax unchanged | Tax **committed** first; **`taxCollected`** set; may return **409** if tax fails |
| Account tax tables | Raw `status: "pending"`, `amount` | **`status: { code, label, tone }`**, split metrics, **`meta`** on lists |
| Pay Tax | Manual / file only | **`POST …/pay`** or **`POST …/approve`** + receipt |
| Sync Now | Cosmetic / stale KPIs | Rebuilds filing rows from **committed invoices** (or Avalara Returns when configured) |
| Invoice URLs | Some clients used `/api/invoices` | **`/api/invoices`** and **`/api/common/invoices`** are equivalent |
| Quote-only tax | Only quotation tax | Official tax on **customer invoice**; optional **`tax-preview`** for estimates |

---

## 2. Tax lifecycle (UI expectations)

| User action | Before | After |
|-------------|--------|-------|
| Create / edit draft invoice | Tax often typed on lines | Server recalculates; response includes **`avalara.documentStatus: "Saved"`** (or local estimate) |
| Send or mark-sent | Always succeeds if validation OK | May **409** with `taxStatus: "tax_pending"` — show message + `reason`; invoice stays unsent |
| After successful send | `status: "sent"` | Also **`taxCollected`**, **`avalara.documentStatus: "Committed"`** |
| Mark paid | Unchanged | **Do not** expect tax to change |
| Account Tax KPIs | Update when invoice saved | Update after **Sync Now** (committed invoices rolled into `Tax` rows) |

**409 on send/mark-sent (handle in UI):**

```json
{
  "success": false,
  "message": "Invoice not marked sent — tax could not be confirmed: …",
  "data": {
    "taxStatus": "tax_pending",
    "reason": "ship_to_incomplete",
    "correlationId": "TAX-…",
    "warnings": []
  }
}
```

| `data.reason` | Show user |
|---------------|-----------|
| `ship_to_incomplete` | Complete project install address before sending |
| `ship_from_incomplete` | Contact admin (origin address not configured) |
| `unapproved_tax_codes` | Tax codes pending approval (admin) |
| `tax_error` | Generic retry / support with `correlationId` |

---

## 3. Path conventions

Use either prefix (same handlers):

| Resource | Path A | Path B |
|----------|--------|--------|
| Invoice by id | `GET /api/invoices/:invoiceId` | `GET /api/common/invoices/:invoiceId` |
| Create invoice | `POST /api/leads/:leadId/invoices` | `POST /api/common/leads/:leadId/invoices` |
| Billing defaults | `GET /api/invoices/billing-defaults` | `GET /api/common/invoices/billing-defaults` |
| Tax preview | `POST /api/invoices/:id/tax-preview` | `POST /api/common/invoices/:id/tax-preview` |

Account billing defaults alias: `GET /api/account/invoices/billing-defaults`

---

## 4. Data shapes — before vs after

### 4.1 Lead / project (`installAddress`)

**Before:**

```json
{
  "location": "100 Industrial Blvd, Austin, TX 78701",
  "city": "Austin",
  "state": "TX",
  "pincode": "78701"
}
```

**After (additive — keep showing `location` if you already do):**

```json
{
  "location": "100 Industrial Blvd, Austin, TX 78701",
  "city": "Austin",
  "state": "TX",
  "pincode": "78701",
  "installAddress": {
    "companyName": "",
    "line1": "100 Industrial Blvd",
    "line2": "",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US",
    "lines": []
  }
}
```

**Forms:** collect line1, city, state, ZIP, country; send `installAddress` and/or flat `line1`, `city`, `state`, `pincode` on create/update lead.

### 4.2 Customer (`taxExemption`)

**Before:** not on customer.

**After (optional default for new invoices):**

```json
{
  "taxExemption": {
    "isExempt": false,
    "entityUseCode": "",
    "exemptionNo": "",
    "certificateRef": ""
  }
}
```

### 4.3 Invoice (tax-related fields)

**Before:**

```json
{
  "subtotal": 100000,
  "tax": 8250,
  "totalAmount": 108250,
  "lineItems": [{ "tax": 8250, "taxAmount": 8250, "total": 100000 }]
}
```

**After:**

```json
{
  "subtotal": 100000,
  "tax": 8250,
  "taxableSales": 100000,
  "taxCollected": 8250,
  "totalAmount": 108250,
  "shipToAddress": {
    "line1": "100 Industrial Blvd",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US"
  },
  "orderType": "SUPPLY_AND_INSTALL",
  "installationProvider": "OWN_CREW",
  "exemption": {
    "isExempt": false,
    "entityUseCode": "",
    "exemptionNo": ""
  },
  "avalara": {
    "provider": "avalara",
    "documentStatus": "Committed",
    "transactionCode": "INV-6ad57e384381c5b22a13652b-R1",
    "totalTaxable": 100000,
    "totalTax": 8250,
    "testOnly": false,
    "warnings": [],
    "committedAt": "2026-03-19T10:00:00.000Z"
  },
  "lineItems": [{ "tax": 8250, "taxAmount": 8250, "total": 100000 }]
}
```

| `avalara.documentStatus` | UI hint |
|---------------------------|---------|
| `Saved` | Draft tax calculated, not final |
| `Committed` | Final tax (invoice sent) |
| `Voided` | Cancelled in tax engine |

You usually **hide** `avalara` in customer-facing UI; use **`tax`**, **`taxCollected`** on staff/account views.

### 4.4 Account tax row (list/table)

**Before:**

```json
{
  "state": "TX",
  "amount": 14650,
  "status": "pending",
  "dueDate": "2025-06-20T00:00:00.000Z"
}
```

**After:**

```json
{
  "state": "TX",
  "taxDue": 14650,
  "payable": 14650,
  "taxCollected": 46013.25,
  "taxableSales": 520000,
  "salesTaxRateLabel": "8.25% Sales Tax",
  "filingPeriod": "May 1 – May 31 2025",
  "filingFrequency": "Monthly",
  "dueDate": "2025-06-20T00:00:00.000Z",
  "daysUntilDue": 32,
  "daysUntilDueLabel": "In 32 Days",
  "status": { "code": "due_soon", "label": "Due Soon", "tone": "warning" },
  "taxRecordId": "68f1a2b3c4d5e6f7a8b9c0d1"
}
```

**Bind pills:** `status.label` + map `status.tone` → color (`warning` | `success` | `info` | `neutral`).

**List wrapper (new):**

```json
{
  "pendingFiling": [ "…rows above…" ],
  "filingHistory": [ "…" ],
  "meta": {
    "provider": "local",
    "complianceStatus": "NOTYETFILING",
    "lastSyncedAt": "2026-03-19T10:30:00.000Z",
    "syncState": "synced",
    "canSync": true,
    "message": ""
  }
}
```

Use **`meta.lastSyncedAt`** for “Last synced”; disable Sync when **`canSync`** is false.

---

## 5. Sales / admin — invoice & lead APIs

Roles: **`admin`**, **`sales`** (unless noted).

### 5.1 POST create invoice

```http
POST /api/leads/:leadId/invoices
POST /api/common/leads/:leadId/invoices
Content-Type: application/json
```

**Request (new optional fields in bold):**

```json
{
  "subtotal": 100000,
  "lineItems": [
    {
      "description": "Structural steel",
      "category": "Structure",
      "quantity": 1,
      "rate": 100000,
      "total": 100000
    }
  ],
  "shipToAddress": {
    "line1": "100 Main St",
    "city": "Des Moines",
    "state": "IA",
    "postalCode": "50309",
    "country": "US"
  },
  "orderType": "SUPPLY_AND_INSTALL",
  "installationProvider": "OWN_CREW",
  "exemption": { "isExempt": false }
}
```

**Before response:** invoice without `avalara` / `shipToAddress`.

**After response fragment:**

```json
{
  "success": true,
  "data": {
    "invoice": {
      "_id": "6ad5f88b822bf58947aed7cc",
      "tax": 7000,
      "taxableSales": 100000,
      "taxCollected": 0,
      "shipToAddress": { "line1": "100 Main St", "city": "Des Moines", "state": "IA", "postalCode": "50309", "country": "US" },
      "avalara": {
        "provider": "avalara",
        "documentStatus": "Saved",
        "totalTax": 7000,
        "totalTaxable": 100000,
        "testOnly": false
      }
    }
  }
}
```

### 5.2 PUT update invoice

```http
PUT /api/invoices/:invoiceId
PUT /api/common/invoices/:invoiceId
```

Same body additions as create; tax recalculates on save for drafts.

### 5.3 GET invoice detail

```http
GET /api/invoices/:invoiceId
GET /api/common/invoices/:invoiceId
```

**Before:** no `avalara`, `taxCollected`, structured `shipToAddress`.

**After:** full §4.3 shape on `data.invoice` (or root invoice per your existing parser).

### 5.4 POST mark-sent / send

```http
POST /api/invoices/:invoiceId/mark-sent
POST /api/invoices/:invoiceId/send
```

(Same under `/api/common/invoices/...`.)

**Before success:** `status: "sent"`, tax unchanged.

**After success:**

```json
{
  "success": true,
  "data": {
    "invoice": {
      "status": "sent",
      "tax": 7000,
      "taxCollected": 7000,
      "taxableSales": 100000,
      "avalara": {
        "documentStatus": "Committed",
        "committedAt": "2026-10-19T10:00:00.000Z"
      }
    }
  }
}
```

### 5.5 POST tax-preview (estimate — does not save)

```http
POST /api/invoices/:invoiceId/tax-preview
POST /api/common/invoices/:invoiceId/tax-preview
Content-Type: application/json
```

**Request:** optional draft overrides (not persisted):

```json
{
  "lineItems": [{ "description": "Steel", "total": 1000, "quantity": 1, "category": "Structure" }],
  "shipToAddress": {
    "line1": "100 Main",
    "city": "Des Moines",
    "state": "IA",
    "postalCode": "50309",
    "country": "US"
  }
}
```

**Before:** no endpoint; used quote tax only.

**After — success:**

```json
{
  "success": true,
  "data": {
    "taxStatus": "estimate",
    "provider": "avalara",
    "preview": {
      "totalTax": 70,
      "totalTaxable": 1000,
      "documentStatus": "Saved",
      "testOnly": false,
      "warnings": [],
      "isEstimate": true,
      "committed": false
    }
  }
}
```

**After — unavailable (still 200):**

```json
{
  "success": true,
  "data": {
    "taxStatus": "unavailable",
    "reason": "ship_to_incomplete",
    "message": "Job-site / ship-to address is incomplete…",
    "preview": null
  }
}
```

### 5.6 POST tax-adjust

```http
POST /api/invoices/:invoiceId/tax-adjust
POST /api/common/invoices/:invoiceId/tax-adjust
Content-Type: application/json

{ "action": "adjust", "reason": "Line total corrected" }
```

| `action` | Before | After |
|----------|--------|-------|
| `adjust` | N/A | Recalc or AvaTax adjust; returns new totals in `snapshot` |
| `void` | N/A | Voids committed tax; `taxCollected` → 0 |

**Response:**

```json
{
  "success": true,
  "message": "Tax adjustment applied",
  "data": {
    "mode": "adjusted",
    "snapshot": {
      "totalTax": 56,
      "totalTaxable": 800,
      "documentStatus": "Committed"
    }
  }
}
```

### 5.7 GET invoice tax breakdown

```http
GET /api/invoices/:invoiceId/tax
GET /api/common/invoices/:invoiceId/tax
```

**Before:** infer from invoice lines only.

**After:**

```json
{
  "success": true,
  "data": {
    "tax": {
      "invoiceId": "6ad5f88b822bf58947aed7cc",
      "invoiceNumber": "INV-0066",
      "provider": "avalara",
      "documentStatus": "Committed",
      "transactionCode": "INV-6ad5f88b822bf58947aed7cc-R1",
      "totalTax": 70,
      "totalTaxable": 1000,
      "taxCollected": 70,
      "testOnly": false,
      "warnings": [],
      "lineCodes": [
        { "number": "1", "taxCode": "P0000000", "approved": true, "category": "Structure", "amount": 1000 }
      ],
      "committedAt": "2026-10-19T10:00:00.000Z"
    }
  }
}
```

### 5.8 GET billing defaults

```http
GET /api/invoices/billing-defaults
GET /api/common/invoices/billing-defaults
GET /api/account/invoices/billing-defaults
```

Roles: **admin**, **sales**, **account**.

**Before:** missing or 404 on some panels.

**After:**

```json
{
  "success": true,
  "data": {
    "billingAddress": {
      "companyName": "STEEL BUILDING DEPOT",
      "line1": "1851 Madison Ave Suite 300",
      "city": "Council Bluffs",
      "state": "IA",
      "postalCode": "51503",
      "country": "United States"
    },
    "bankDetails": {
      "bankName": "",
      "accountName": "",
      "accountNumber": "",
      "routingNumber": ""
    },
    "recipientAddress": {
      "companyName": "",
      "line1": "",
      "city": "",
      "state": "",
      "postalCode": "",
      "country": ""
    }
  }
}
```

### 5.9 Customer create project

```http
POST /api/customer/projects
```

**Before:** lead without `installAddress`.

**After:** `data.lead.installAddress` populated from `fullAddress`, `city`, `state`, `pincode`.

---

## 6. Account panel — `/api/account/financial-extra`

Roles: **`account`**, **`admin`**.

### 6.1 Endpoints — before vs after

| Figma / feature | Before | After |
|-----------------|--------|-------|
| Tax & Filing list | `GET /tax-filing` raw rows | Same path; **enriched rows** + **`meta`** |
| State / Project wise | Plain aggregates | **`status` object**, **`taxRecordId`** / **`showPayTax`** |
| Empty banner | Hard-coded | **`GET /tax-compliance/status`** |
| Review modal | Limited fields | **`GET /tax-filing/:taxId/detail`** |
| Pay Tax | `PUT …/file` only | **`POST …/approve`** (Avalara) or **`POST …/pay`** (manual) |
| Receipt | N/A | **`GET /tax-filing/:taxId/receipt`** when paid |
| Sync Now | No data change | **`POST /state-wise-tax/sync`** then refetch |

### 6.2 GET tax-compliance/status

```http
GET /api/account/financial-extra/tax-compliance/status
```

```json
{
  "success": true,
  "data": {
    "provider": "local",
    "complianceStatus": "NOTYETFILING",
    "lastSyncedAt": null,
    "syncState": "not_configured",
    "canSync": true,
    "message": "Configure Avalara Returns or use local tax engine for development."
  }
}
```

### 6.3 POST sync (all three tax pages)

```http
POST /api/account/financial-extra/state-wise-tax/sync
```

**Body:** `{}` or empty.

**Before:** KPIs might not match tables.

**After:**

```json
{
  "success": true,
  "message": "Tax data synced successfully",
  "data": {
    "syncedAt": "2026-03-19T10:30:00.000Z",
    "regions": 5,
    "projects": 12,
    "provider": "local"
  }
}
```

When Returns integration is active, `provider` may be `"avalara"` and `mode: "returns_graphql"`.

**UI:** After success, refetch stats + table + read `meta.lastSyncedAt` on list endpoints.

### 6.4 GET tax-filing detail (modal)

```http
GET /api/account/financial-extra/tax-filing/:taxId/detail
```

**Before:** not available or raw `Tax` document.

**After:**

```json
{
  "success": true,
  "data": {
    "detail": {
      "stateLabel": "TX Tax Details",
      "uiStatus": { "code": "payment_due", "label": "Payment Due", "tone": "warning" },
      "filingPeriod": "May 1 – May 31 2025",
      "filingDueDate": "2025-06-20T00:00:00.000Z",
      "daysUntilDue": 32,
      "breakdown": {
        "taxCollected": 46013.25,
        "taxPaid": 46013.25,
        "penalty": 0,
        "interest": 0,
        "totalPayable": 14650
      },
      "payNow": {
        "enabled": true,
        "amount": 14650,
        "currency": "USD",
        "providerLabel": "Tax Partner: Avalara CERTIFIED PARTNER"
      },
      "recentActivity": []
    },
    "avalara": {
      "filingId": "1416389",
      "returnsConfigured": false,
      "source": "sync"
    }
  }
}
```

### 6.5 POST pay / approve

```http
POST /api/account/financial-extra/tax-filing/:taxId/pay
POST /api/account/financial-extra/tax-filing/:taxId/approve
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@example.com"
}
```

**Before:** manual mark filed only.

**After:**

```json
{
  "success": true,
  "message": "Payment submitted successfully",
  "data": {
    "payment": {
      "amountPaid": 14650,
      "confirmationNumber": "Tx-2025-0619-8421",
      "status": "processing",
      "paymentMethod": "ACH ending in 4851",
      "estimatedSettlement": "1-3 business days",
      "notificationEmail": "accounts@example.com"
    },
    "tax": { "status": "paid", "payable": 0 },
    "avalara": null
  }
}
```

Use **`approve`** when `detail.avalara.returnsConfigured` is true; otherwise **`pay`** for staging/manual.

### 6.6 GET receipt

```http
GET /api/account/financial-extra/tax-filing/:taxId/receipt
```

**Before:** N/A.

**After (when `tax.status === paid`):**

```json
{
  "success": true,
  "data": {
    "confirmationNumber": "CONF0987-2026",
    "amountPaid": 14650,
    "paidAt": "2026-05-18T12:00:00.000Z",
    "state": "TX",
    "method": "Avalara API",
    "paymentMethod": "ACH ending in 4851"
  }
}
```

### 6.7 Unchanged paths (response shape upgraded)

Still call these; bind new fields as in §4.4:

```
GET  /api/account/financial-extra/tax-filing/stats
GET  /api/account/financial-extra/tax-filing/filters
GET  /api/account/financial-extra/tax-filing
GET  /api/account/financial-extra/tax-filing/export
GET  /api/account/financial-extra/state-wise-tax
GET  /api/account/financial-extra/state-wise-tax/stats
GET  /api/account/financial-extra/state-wise-tax/export
GET  /api/account/financial-extra/state-wise-tax/upcoming-deadlines
GET  /api/account/financial-extra/project-wise-tax
GET  /api/account/financial-extra/project-wise-tax/stats
GET  /api/account/financial-extra/project-wise-tax/export
GET  /api/account/financial-extra/tax-filing/:taxId/prepare
PUT  /api/account/financial-extra/tax-filing/:taxId/file
```

### 6.8 Deprecate for Figma tax screens

**Before:** some screens used `GET/POST/PUT /api/account/tax`.

**After:** use **`financial-extra`** only for Tax & Filing, State Wise, Project Wise.

---

## 7. Admin — tax category mapping (admin UI)

Base: **`/api/admin`** · role **`admin`**.

| Method | Path | Before | After |
|--------|------|--------|-------|
| GET | `/tax-codes?search=&limit=` | N/A | Search Avalara code catalog for picker |
| GET | `/tax-mappings` | N/A | 11 categories + approval summary |
| PUT | `/tax-mappings/:id` | N/A | Set code + `approval_status` |
| GET | `/tax-mappings/:id/audit` | N/A | Change history |

**GET /tax-mappings — response:**

```json
{
  "success": true,
  "data": {
    "mappings": [
      {
        "_id": "68f…",
        "backend_category": "Structure",
        "item_type": "PRODUCT",
        "avalara_tax_code": "P0000000",
        "approval_status": "APPROVED",
        "description": "Structural steel…",
        "keywords": ["frame", "beam"]
      }
    ],
    "summary": {
      "total": 11,
      "approved": 11,
      "pending": 0,
      "draft": 0,
      "unmapped": 0
    }
  }
}
```

**PUT /tax-mappings/:id — request:**

```json
{
  "avalara_tax_code": "P0000000",
  "approval_status": "APPROVED",
  "reason": "Accountant approved Q4 mapping"
}
```

---

## 8. TypeScript / client checklist

- [ ] `StructuredAddress`, `InstallAddress` on Lead
- [ ] `InvoiceAvalara`, `shipToAddress`, `taxCollected`, `taxableSales`
- [ ] `TaxStatusBadge` `{ code, label, tone }`
- [ ] `TaxFilingRow`, `TaxDetailModal`, `TaxPaymentResult`
- [ ] Handle **409** on send/mark-sent with `taxStatus`, `reason`
- [ ] Account: pills from `status.label` / `tone`; Pay from `detail.payNow`
- [ ] Sync button → `POST state-wise-tax/sync` → refetch
- [ ] Invoice URLs: support **`/api/common/invoices`** if client already uses it
- [ ] Stop using `/api/account/tax` for filing Figma

---

## 9. Full route index

### Account (`/api/account/financial-extra`)

```
GET    /tax-compliance/status
GET    /tax-filing/stats | /tax-filing/filters | /tax-filing | /tax-filing/export
GET    /tax-filing/:taxId/prepare | /tax-filing/:taxId/detail | /tax-filing/:taxId/receipt
POST   /tax-filing/:taxId/pay | /tax-filing/:taxId/approve
PUT    /tax-filing/:taxId/file
GET    /state-wise-tax | /state-wise-tax/stats | /state-wise-tax/export | /state-wise-tax/upcoming-deadlines
POST   /state-wise-tax/sync
GET    /project-wise-tax | /project-wise-tax/stats | /project-wise-tax/export
```

### Staff invoices (`/api/invoices` or `/api/common/invoices`)

```
GET    /
GET    /:invoiceId
PUT    /:invoiceId
GET    /billing-defaults
POST   /:invoiceId/mark-sent
POST   /:invoiceId/send
POST   /:invoiceId/tax-preview
POST   /:invoiceId/tax-adjust
GET    /:invoiceId/tax
POST   /api/leads/:leadId/invoices   (or /api/common/leads/...)
```

### Admin

```
GET    /api/admin/tax-codes
GET    /api/admin/tax-mappings
PUT    /api/admin/tax-mappings/:id
GET    /api/admin/tax-mappings/:id/audit
```

### Customer

```
POST   /api/customer/projects
```

---

**Give frontend this file** for before/after + req/res (Sales/Admin). Account tax Figma pages: [`frontend-handoff/account-tax/`](./frontend-handoff/account-tax/README.md).
