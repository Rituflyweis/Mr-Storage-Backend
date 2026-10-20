# Frontend change doc — Tax, Avalara, addresses & related APIs

**Date:** 2026-10-19  
**One place** for everything that changed in the backend gap fix (addresses, invoice tax, account tax UI, sync, pay/approve).  
**Auth:** `Bearer` token · **`account`** | **`admin`** (tax pages) · **`admin`** | **`sales`** (invoices)

**Prod:** `https://mr-storage-backend-025k.onrender.com`

---

## Summary (read this first)

| Theme | What frontend must do |
|--------|------------------------|
| **Addresses** | Read/write **`installAddress`** on leads/projects; invoices expose **`shipToAddress`**; tax needs complete ship-to |
| **Invoice tax** | Tax is calculated on invoice create/update; **committed when invoice is sent** (`mark-sent` / send)—not on paid |
| **Account tax UI** | Use **`/api/account/financial-extra/*`** only; rows now have **`status: { code, label, tone }`**; Pay → **`POST .../approve`** or **`.../pay`** |
| **Sync** | **Sync Now** → `POST .../state-wise-tax/sync` then refetch lists/KPIs |
| **Stop using** | Raw `/api/account/tax` CRUD for Figma tax screens; don’t bind filing KPIs to quote tax alone |

---

## 1. Address changes (leads, projects, customer portal)

### 1.1 Why

AvaTax needs **structured ship-to** (`line1`, `city`, `state`, `postalCode`, `country`). A single `location` string is no longer enough for accurate tax.

### 1.2 New / updated fields on **Lead** (project)

**Response shape (additive):**

```json
{
  "_id": "6ac4e5e6570533c2c601ed40",
  "projectName": "Riverside A",
  "jobId": "PRO-042",
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

| Field | Notes |
|-------|--------|
| `installAddress` | **Preferred** for tax; server fills from `line1` + city/state/pincode on create |
| `location` | Legacy display string; keep showing if UI already uses it |
| `pincode` | Still on lead root; maps to `installAddress.postalCode` |

**UI:** Project forms should collect **street, city, state, ZIP, country** and send either nested `installAddress` or flat fields below.

### 1.3 Customer portal — create project

**Unchanged path:** `POST /api/customer/projects`

**Body (existing fields still work; server now sets `installAddress`):**

```http
POST /api/customer/projects
Authorization: Bearer <customer-token>
Content-Type: application/json

{
  "projectName": "New Building",
  "buildingType": "PEMB",
  "expectedStartDate": "2026-06-01T00:00:00.000Z",
  "targetCompletionDate": "2026-12-01T00:00:00.000Z",
  "fullAddress": "100 Industrial Blvd",
  "city": "Austin",
  "state": "TX",
  "pincode": "78701"
}
```

**Response `data.lead`:** includes `installAddress` (same shape as §1.2).

### 1.4 Admin / sales — create or update lead

**Create:** existing lead create routes + body fields:

```json
{
  "projectName": "Test Project",
  "customerId": "6aadb0a0464b5c58eb1a0420",
  "line1": "100 Industrial Blvd",
  "city": "Austin",
  "state": "TX",
  "pincode": "78701",
  "installAddress": {
    "line1": "100 Industrial Blvd",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US"
  }
}
```

**Update:** `PUT` lead endpoints now accept **`city`**, **`state`**, **`pincode`**, **`installAddress`**, **`line1`** (previously many lead edits ignored city/state/pincode).

**Frontend:** Project edit screens must send these fields when user changes address.

### 1.5 Estimate quote (sales)

**Model:** `EstimateQuote.shipToAddress` added (optional on GET/PUT estimate).

Quote tax preview will eventually use ship-to; **filing-grade tax** still comes from **sent invoices**. No new account-panel route required unless sales UI edits estimates.

---

## 2. Invoice changes (staff — affects account tax after sync)

### 2.1 Policy

| Event | Tax behavior |
|--------|----------------|
| Create / edit **draft** invoice | Recalculate tax (local engine or AvaTax when configured) |
| **Send** / **mark-sent** | **Commit** tax (`avalara.documentStatus: "Committed"`) |
| **Paid** | No tax recalculation |
| Cancel / void (future) | Void in AvaTax when wired |

Invoices are **only created in-app** (your confirmed flow)—commit hooks run on send.

### 2.2 New fields on **Invoice** (responses)

```json
{
  "_id": "6ad57e384381c5b22a13652b",
  "invoiceNumber": "INV-0066",
  "status": "sent",
  "subtotal": 100000,
  "tax": 8250,
  "totalAmount": 108250,
  "taxableSales": 100000,
  "taxCollected": 8250,
  "shipToAddress": {
    "line1": "100 Industrial Blvd",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US"
  },
  "avalara": {
    "provider": "local",
    "transactionCode": "INV-6ad57e384381c5b22a13652b-R1",
    "documentStatus": "Committed",
    "totalTaxable": 100000,
    "totalTax": 8250,
    "lastCalculatedAt": "2026-03-19T09:00:00.000Z",
    "committedAt": "2026-03-19T10:00:00.000Z"
  }
}
```

| Field | When set |
|-------|----------|
| `shipToAddress` | Create; from lead `installAddress` if not in body |
| `taxableSales`, `taxCollected` | After commit (sent) |
| `avalara.documentStatus` | `Saved` on draft calc, **`Committed`** after sent |

**Account panel:** You do **not** need to show `avalara` on invoice UI unless you want a debug badge; **Tax & Filing** KPIs update after **Sync Now**.

### 2.3 Staff routes (unchanged paths, new behavior)

| Action | Route (example) |
|--------|------------------|
| Create invoice | `POST /api/leads/:leadId/invoices` |
| Update draft | `PUT /api/invoices/:invoiceId` |
| Mark sent (no email) | `POST /api/invoices/:invoiceId/mark-sent` |
| Send with email | `POST /api/invoices/:invoiceId/send` |

**Example — after mark-sent (fragment):**

```json
{
  "success": true,
  "message": "Invoice marked as sent",
  "data": {
    "invoice": {
      "status": "sent",
      "tax": 8250,
      "taxCollected": 8250,
      "avalara": { "documentStatus": "Committed" }
    }
  }
}
```

---

## 3. Account tax & filing UI (`/api/account/financial-extra`)

Base: **`/api/account/financial-extra`**

### 3.1 What changed in responses

**Before:** `pendingFiling` / `filingHistory` were raw DB documents (`amount`, `status: "pending"`).

**After:**

```json
{
  "state": "TX",
  "salesTaxRateLabel": "6.25% Sales Tax",
  "filingPeriod": "May 1 – May 31 2025",
  "filingFrequency": "Monthly",
  "dueDate": "2025-06-20T00:00:00.000Z",
  "daysUntilDue": 32,
  "daysUntilDueLabel": "In 32 Days",
  "taxDue": 14650,
  "payable": 14650,
  "status": { "code": "due_soon", "label": "Due Soon", "tone": "warning" }
}
```

**History rows add:**

```json
{
  "filedDate": "2024-01-14T10:42:00.000Z",
  "taxPaid": 450000,
  "method": "Avalara API",
  "receipt": {
    "confirmationNumber": "CONF0987-2026",
    "receiptDate": "2026-05-18T00:00:00.000Z"
  }
}
```

**State table rows add:** `taxRecordId` → use for Pay / Details.

**Project table rows add:** `status` object, `showPayTax`; resolve `taxId` via `GET tax-filing?projectId={leadId}&limit=1`.

**Many list responses add:**

```json
"meta": {
  "provider": "local",
  "complianceStatus": "NOTYETFILING",
  "lastSyncedAt": "2026-03-19T10:30:00.000Z",
  "syncState": "synced",
  "canSync": true,
  "message": ""
}
```

### 3.2 New endpoints (modals & pay)

| Figma | Method | Path |
|--------|--------|------|
| Review Details / Texas modal | GET | `/tax-filing/:taxId/detail` |
| Prepare Filing | GET | `/tax-filing/:taxId/prepare` |
| Pay Tax (prod / Avalara) | POST | `/tax-filing/:taxId/approve` |
| Pay (staging / no Returns) | POST | `/tax-filing/:taxId/pay` |
| Download receipt | GET | `/tax-filing/:taxId/receipt` |
| Empty / onboarding banner | GET | `/tax-compliance/status` |

**Detail modal — GET `/tax-filing/:taxId/detail` — example `data`:**

```json
{
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
```

**Pay — POST `/tax-filing/:taxId/approve` or `/pay` — body:**

```json
{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

**Success modal — example `data.payment`:**

```json
{
  "amountPaid": 14650,
  "filingPeriod": { "start": "2025-05-01T00:00:00.000Z", "end": "2025-05-31T00:00:00.000Z" },
  "paymentMethod": "ACH ending in 4851",
  "confirmationNumber": "Tx-2025-0619-8421",
  "status": "processing",
  "estimatedSettlement": "1-3 business days",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

### 3.3 Sync Now (all three tax pages)

```http
POST /api/account/financial-extra/state-wise-tax/sync
Authorization: Bearer <token>
```

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

Then refetch: active page stats + table + `meta.lastSyncedAt`.

### 3.4 Unchanged paths (still use these)

| Page | KPIs | Table | Export |
|------|------|-------|--------|
| Tax & Filling | `GET tax-filing/stats` | `GET tax-filing` | `GET tax-filing/export` |
| State Wise | `GET state-wise-tax/stats` | `GET state-wise-tax` | `GET state-wise-tax/export` |
| Project Wise | `GET project-wise-tax/stats` | `GET project-wise-tax` | `GET project-wise-tax/export` |
| Deadlines | | `GET state-wise-tax/upcoming-deadlines` | |
| Filters (Tax & Filling) | | `GET tax-filing/filters` | |

**KPI example — `GET tax-filing/stats`:**

```json
{
  "totalSalesTaxable": { "value": 1245600, "pctChangeFromLastMonth": 5.62 },
  "totalSalesTaxCollected": { "value": 82500, "pctChangeFromLastMonth": 11.4 },
  "taxPayableByStates": { "value": 14650 },
  "fileVsUnfiledTax": { "filed": 300000, "unfiled": 14650 }
}
```

---

## 4. Tax record model (for TypeScript / mocks)

`Tax` documents (underlying filing rows) now include:

| Field | Meaning |
|-------|---------|
| `taxableSales`, `taxCollected`, `taxDue`, `paidFiled`, `payable` | Split metrics (don’t use `amount` alone for everything) |
| `amount` | Legacy; still present ≈ `taxDue` |
| `source` | `manual` \| `sync` \| `avalara` |
| `periodStart`, `periodEnd`, `periodKey` | Filing period |
| `confirmationNumber`, `paymentMethod`, `paymentStatus` | After pay |
| `providerMethod` | e.g. `"Avalara API"` |
| `activityLog[]` | `{ at, type, amount, label }` |
| `avalaraFilingId` | When synced from Returns |

---

## 5. Frontend migration checklist (single pass)

### Types / API client

- [ ] Add `StructuredAddress`, `TaxStatusBadge`, `TaxFilingRow`, `TaxDetailModal`, `TaxPaymentResult`
- [ ] Add `Invoice.avalara`, `Invoice.shipToAddress`, `Lead.installAddress`

### Account app

- [ ] Tax pages: bind pills to `row.status.label` + `tone`
- [ ] Pending / History tabs → `pendingFiling` / `filingHistory`
- [ ] Pay → `POST .../approve` (prod) or `.../pay` (dev)
- [ ] Modals → `GET .../detail`; success UI → `data.payment`
- [ ] Sync button → `POST state-wise-tax/sync` + refetch
- [ ] Empty state → `GET tax-compliance/status`
- [ ] Remove dependency on `/api/account/tax` for Figma screens

### Project / lead UI (any panel)

- [ ] Forms: street, city, state, ZIP, country → `installAddress` or flat fields
- [ ] Project GET: display `installAddress`; validate before invoice if you warn users

### Staff invoice UI (if account sees invoices)

- [ ] After send, expect `taxCollected` / `avalara.documentStatus: Committed`
- [ ] Do not expect tax KPIs to update until account runs Sync

---

## 6. Environment (ops — not in frontend code)

Backend reads (Render):

- `TAX_ENGINE=local` | `avalara` | `legacy`
- AvaTax: `AVATAX_ACCOUNT_ID`, `AVATAX_LICENSE_KEY`, `AVATAX_COMPANY_CODE`, `AVATAX_ENV`
- Ship-from (origin for CreateTransaction): **required for `TAX_ENGINE=avalara`** unless invoice `billingAddress` has full city/state/ZIP — set `AVATAX_SHIP_FROM_LINE1`, `_CITY`, `_STATE`, `_POSTAL`, optional `_COUNTRY` (ISO `US`). If ship-from is incomplete, tax calc returns `skipped` + `reason: ship_from_incomplete` (invoice is not silently zero-taxed). Fallback: parsed company address from `INVOICE_COMPANY_ADDRESS` pipe-separated lines (same shape as default Steel Building Depot address).
- Returns: `AVALARA_COMPANY_ID`, optional `AVALARA_RETURNS_API_URL`, `AVALARA_AUTH_URL`, optional dedicated OAuth `AVALARA_RETURNS_CLIENT_ID` / `AVALARA_RETURNS_CLIENT_SECRET` (falls back to AvaTax account + license if unset)

Frontend: no keys; only **`meta.provider`** / empty states.

**Recommended go-live order (ops):**

1. Set AvaTax keys + `AVATAX_COMPANY_CODE`; keep `TAX_ENGINE=local`.
2. Set `AVATAX_ENV=sandbox`; optional `AVATAX_SHIP_FROM_*` if nexus ≠ company address.
3. Create/send a test customer invoice; confirm ship-from `ready`, tax non-zero for a known taxable ZIP.
4. Point `AVATAX_ENV=production` and flip `TAX_ENGINE=avalara` last.

Install/project addresses: prefer 2-letter US state codes; backend maps full names (e.g. `Texas` → `TX`) in `normalizeStructuredAddress`.

---

## 7. Route index (everything touched)

### Account

```
GET    /api/account/financial-extra/tax-compliance/status
GET    /api/account/financial-extra/tax-filing/stats
GET    /api/account/financial-extra/tax-filing/filters
GET    /api/account/financial-extra/tax-filing
GET    /api/account/financial-extra/tax-filing/export
GET    /api/account/financial-extra/tax-filing/:taxId/prepare
GET    /api/account/financial-extra/tax-filing/:taxId/detail
POST   /api/account/financial-extra/tax-filing/:taxId/pay
POST   /api/account/financial-extra/tax-filing/:taxId/approve
GET    /api/account/financial-extra/tax-filing/:taxId/receipt
PUT    /api/account/financial-extra/tax-filing/:taxId/file
GET    /api/account/financial-extra/state-wise-tax
GET    /api/account/financial-extra/state-wise-tax/stats
GET    /api/account/financial-extra/state-wise-tax/export
GET    /api/account/financial-extra/state-wise-tax/upcoming-deadlines
POST   /api/account/financial-extra/state-wise-tax/sync
GET    /api/account/financial-extra/project-wise-tax
GET    /api/account/financial-extra/project-wise-tax/stats
GET    /api/account/financial-extra/project-wise-tax/export
```

### Customer

```
POST   /api/customer/projects          → sets installAddress
```

### Staff (invoice tax lifecycle)

```
POST   /api/leads/:leadId/invoices
PUT    /api/invoices/:invoiceId
POST   /api/invoices/:invoiceId/mark-sent
POST   /api/invoices/:invoiceId/send
```

### Lead (address)

```
POST/PUT  lead create/update routes     → installAddress, city, state, pincode, line1
```

---

## 8. Related docs (optional depth)

| Doc | Use when |
|-----|----------|
| This file | **Default — all changes in one place** |
| [`frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md`](./frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md) | Figma screen → route map |
| [`frontend-account-tax-full-api-handoff-2026-10-19.md`](./frontend-account-tax-full-api-handoff-2026-10-19.md) | Extra copy-paste examples per endpoint |

**Give frontend this file first:** `frontend-gap-changes-tax-address-avalara-2026-10-19.md`

**Complete before/after + req/res (all APIs):** [`avalara-full-changes-master-handoff-2026-10-19.md`](../../avalara-full-changes-master-handoff-2026-10-19.md)
