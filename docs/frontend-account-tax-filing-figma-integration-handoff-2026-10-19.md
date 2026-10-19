# Account Tax & Filing — Figma integration handoff

**Date:** 2026-10-19  
**Audience:** Frontend (Account panel)  
**Base path:** `/api/account/financial-extra`  
**Auth:** `Authorization: Bearer <token>` · roles **`account`**, **`admin`**

Maps **all shared Figma screens** for **Tax & Filling**, **State Wise Tax**, and **Project Wise Tax**, including **modals** (state detail, pay now, payment success, filing history).

**Prod base:** `https://mr-storage-backend-025k.onrender.com`

---

## Conventions

### Envelope

```json
{ "success": true, "message": "Success", "data": { } }
```

### Compliance / sync meta (many tax responses)

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

| `syncState` | UI hint |
|-------------|---------|
| `not_configured` | Show empty state + link to configure Avalara |
| `empty` | “Filings will appear after compliance review” |
| `synced` | Show **Last Synced** green badge |
| `error` | Show retry on **Sync Now** |

Dedicated status: `GET /tax-compliance/status`

### Status badges (Figma → API)

Backend returns `status: { code, label, tone }`:

| Figma label | `code` | `tone` |
|-------------|--------|--------|
| Due Soon | `due_soon` | `warning` |
| Pending | `pending` | `neutral` |
| Payment Due | `payment_due` | `warning` |
| No tax due | `no_tax_due` | `success` |
| Filed | `filed` | `info` / `success` |

**Days copy:** use `daysUntilDue` + `daysUntilDueLabel` (e.g. `"In 31 Days"`).

### Tax collected (source of truth)

1. Customer **invoices** → tax calculated on create/update → **committed when invoice is sent** (not on paid).  
2. Account user clicks **Sync Now** → filing rows updated from committed invoices (+ Avalara Returns when live).

---

## Screen map (Figma → routes)

| # | Figma | Primary APIs |
|---|--------|----------------|
| 1 | **Sales Tax & Filling** — KPIs, filters, Pending tab | `GET tax-filing/stats`, `GET tax-filing/filters`, `GET tax-filing` |
| 2 | **Review Details / Prepare Filing** | `GET tax-filing/:taxId/prepare`, `GET tax-filing/:taxId/detail` |
| 3 | **Texas Tax Details** modal — breakdown, Pay Now | `GET tax-filing/:taxId/detail` → `POST tax-filing/:taxId/pay` |
| 4 | **Payment submitted** modal | Response body of `POST .../pay` |
| 5 | **Filing History** tab | `GET tax-filing` → `filingHistory[]` |
| 6 | **View Filing / Receipt / Download** | `GET tax-filing/:taxId/receipt` (JSON) or `?format=pdf` / `Accept: application/pdf` |
| 6b | **Manage Notifications** (deadline banner) | `GET` / `PUT tax-filing/notification-settings` |
| 7 | **State Wise Tax** — KPIs + table + Sync | `GET state-wise-tax/stats`, `GET state-wise-tax`, `POST state-wise-tax/sync` |
| 8 | **State table — Pay Tax / View Details** | `taxRecordId` on row → `detail` + `pay` |
| 9 | **Upcoming Filing Deadlines** (state + project pages) | `GET state-wise-tax/upcoming-deadlines` |
| 10 | **Project Wise Tax** — KPIs + table + Sync | `GET project-wise-tax/stats`, `GET project-wise-tax`, same **Sync** |
| 11 | **Project row — Pay Tax / View Details** | `taxRecordId` on row (or upcoming deadline `taxRecordId`) |
| 12 | **Export** (all three pages) | `GET tax-filing/export`, `state-wise-tax/export`, `project-wise-tax/export` |

---

## Screen 1 — Sales Tax & Filling (main)

### KPI cards

```http
GET /api/account/financial-extra/tax-filing/stats?state=&projectId=&clientId=
Authorization: Bearer <token>
```

**Query (optional):** `state`, `projectId` (Mongo lead id), `clientId`, `search`

**Example `data`:**

```json
{
  "totalSalesTaxable": { "value": 1245600, "pctChangeFromLastMonth": 5.62 },
  "totalSalesTaxCollected": { "value": 1500000, "pctChangeFromLastMonth": 11.4 },
  "taxPayableByStates": { "value": 2200000 },
  "fileVsUnfiledTax": { "filed": 300000, "unfiled": 300000 }
}
```

| Figma card | Field |
|------------|--------|
| Total Sales (Taxable) | `totalSalesTaxable.value` + `pctChangeFromLastMonth` |
| Total Sales Tax Collected | `totalSalesTaxCollected` |
| Tax Payable by States | `taxPayableByStates.value` |
| File vs Unfiled | `fileVsUnfiledTax.filed` / `.unfiled` |

### Filter dropdowns

```http
GET /api/account/financial-extra/tax-filing/filters
```

```json
{
  "states": ["TX", "CA"],
  "projects": [{ "leadId": "…", "projectName": "Riverside A", "jobId": "PRO-042" }],
  "clients": [{ "customerId": "…", "name": "Acme Industries" }]
}
```

| Figma filter | Query param |
|--------------|-------------|
| State | `state` |
| Project | `projectId` |
| Client | `clientId` |
| Date range | `startDate`, `endDate` (ISO) on list + stats where supported |
| Table search | `search` |

### Pending Filing tab (table)

```http
GET /api/account/financial-extra/tax-filing?status=pending&page=1&limit=10&state=&projectId=&clientId=&startDate=&endDate=&search=
```

**Note:** Omit `status` to get both sections in one payload; UI tabs can filter client-side or pass logic: pending rows = `pendingFiling`, history = `filingHistory`.

**Example row (`pendingFiling[]`):**

```json
{
  "_id": "67abc…",
  "state": "TX",
  "stateLabel": "TX",
  "salesTaxRateLabel": "6.25% Sales Tax",
  "filingPeriod": "May 2025",
  "filingFrequency": "Monthly",
  "dueDate": "2024-01-14T00:00:00.000Z",
  "daysUntilDue": 31,
  "daysUntilDueLabel": "In 31 Days",
  "taxDue": 450000,
  "payable": 450000,
  "status": { "code": "due_soon", "label": "Due Soon", "tone": "warning" },
  "projectName": "",
  "jobId": ""
}
```

| Figma column | Field |
|--------------|--------|
| State + rate | `state`, `salesTaxRateLabel` |
| Filing period | `filingPeriod`, `filingFrequency` |
| Due date | `dueDate`, `daysUntilDueLabel` |
| Tax due | `taxDue` or `payable` |
| Status pill | `status.label` / `status.tone` |
| Review Details | Open modal → `GET .../tax-filing/:taxId/detail` |
| Prepare Filing | `GET .../tax-filing/:taxId/prepare` (same detail + `tax` raw) |

### Export

```http
GET /api/account/financial-extra/tax-filing/export?state=&projectId=&clientId=&startDate=&endDate=
```

→ Excel blob.

---

## Screen 2–4 — State detail modal, Pay Now, Payment success

### Detail modal (Texas Tax Details)

```http
GET /api/account/financial-extra/tax-filing/:taxId/detail
```

**Example `data.detail`:**

```json
{
  "_id": "67abc…",
  "state": "TX",
  "stateLabel": "TX Tax Details",
  "uiStatus": { "code": "payment_due", "label": "Payment Due", "tone": "warning" },
  "filingPeriod": "May 1 – May 31 2025",
  "filingPeriodRange": { "start": "2025-05-01T00:00:00.000Z", "end": "2025-05-31T00:00:00.000Z" },
  "filingFrequency": "Monthly",
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
    "provider": "avalara",
    "providerLabel": "Tax Partner: Avalara CERTIFIED PARTNER"
  },
  "recentActivity": [
    { "at": "2026-05-19T00:00:00.000Z", "type": "payment", "amount": 46013.25, "label": "46013.25 Paid" }
  ]
}
```

| Figma modal field | API |
|-------------------|-----|
| Filing period | `filingPeriod` / `filingPeriodRange` |
| Filing frequency | `filingFrequency` |
| Filing due date + “32 days left” | `filingDueDate`, `daysUntilDue` |
| Tax collected / paid / penalty / interest | `breakdown.*` |
| **Pay $X Now** | `payNow.amount`, disabled if `!payNow.enabled` |
| Avalara partner badge | `payNow.providerLabel` |
| Recent activity | `recentActivity[]` |

### Pay Now → success modal

**Preferred for Figma “Pay Tax” / Avalara remittance** (calls Managed Returns `approveFilings` when env is configured):

```http
POST /api/account/financial-extra/tax-filing/:taxId/approve
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

**Local / dev without Returns** (updates DB only, same success modal shape):

```http
POST /api/account/financial-extra/tax-filing/:taxId/pay
```

Same body for both:

```json
{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

**Example `data` (maps to green success modal):**

```json
{
  "payment": {
    "amountPaid": 14550,
    "filingPeriod": { "start": "2025-05-01T00:00:00.000Z", "end": "2025-05-31T00:00:00.000Z" },
    "paymentMethod": "ACH ending in 4851",
    "confirmationNumber": "Tx-2025-0619-8421",
    "status": "processing",
    "estimatedSettlement": "1-3 business days",
    "notificationEmail": "accounts@acmeindustries.com"
  },
  "tax": { "status": "paid", "confirmationNumber": "Tx-2025-0619-8421" }
}
```

| Figma success field | Field |
|---------------------|--------|
| Amount paid | `payment.amountPaid` |
| Filing period | format `payment.filingPeriod` |
| Payment method | `payment.paymentMethod` |
| Confirmation # | `payment.confirmationNumber` |
| Status Processing | `payment.status` |
| 1–3 business days | `payment.estimatedSettlement` |
| Download receipt | `GET .../tax-filing/:taxId/receipt?format=pdf` (email after pay includes PDF when SendGrid configured) |
| Back to dashboard | Navigate to Tax & Filling route |

**Production:** Use **`POST .../approve`** — backend calls Avalara **`approveFilings`** when `AVATAX_*` + `AVALARA_COMPANY_ID` are set. Use **`POST .../pay`** only for local/staging without Returns credentials.

---

## Screen 5–6 — Filing History tab

Same list endpoint — use **`filingHistory[]`** (paid records).

**Example history row:**

```json
{
  "state": "FL",
  "salesTaxRateLabel": "6.25% Sales Tax",
  "filingPeriod": "May 2025",
  "filedDate": "2024-01-14T10:42:00.000Z",
  "taxPaid": 450000,
  "method": "Avalara API",
  "receipt": {
    "confirmationNumber": "CONF0987-2026",
    "receiptDate": "2026-05-18T00:00:00.000Z"
  },
  "status": { "code": "filed", "label": "Filed", "tone": "success" }
}
```

| Figma column | Field |
|--------------|--------|
| Filed date | `filedDate` |
| Tax paid | `taxPaid` |
| Method | `method` |
| Receipt | `receipt.confirmationNumber`, `receipt.receiptDate` |
| View Filing | `GET .../detail` |
| Download | `GET .../receipt?format=pdf` |

Legacy **mark filed** (no payment): `PUT /api/account/financial-extra/tax-filing/:taxId/file`

---

## Screen 7–9 — State Wise Tax

### KPI row

```http
GET /api/account/financial-extra/state-wise-tax/stats?projectId=&startDate=&endDate=
```

Same five-card shape as Figma: `totalTaxCollected`, `totalPaid`, `totalPayable`, `pendingFilingStates`, `nextFilingDue`.

### Table + sync strip

```http
GET /api/account/financial-extra/state-wise-tax?projectId=&startDate=&endDate=
POST /api/account/financial-extra/state-wise-tax/sync
```

**Sync response:**

```json
{ "syncedAt": "2026-03-19T10:30:00.000Z", "regions": 5, "projects": 12, "provider": "local" }
```

**State row (`stateOverview[]`):**

```json
{
  "state": "TX",
  "salesTaxRateLabel": "6.25% Sales Tax",
  "taxCollected": 450000,
  "taxableSales": 450000,
  "paidFiled": 450000,
  "payable": 450000,
  "dueDate": "2024-01-14T00:00:00.000Z",
  "status": { "code": "payment_due", "label": "Payment Due", "tone": "warning" },
  "taxRecordId": "67abc…"
}
```

| Action | Call |
|--------|------|
| Pay Tax | `POST .../tax-filing/{taxRecordId}/pay` |
| View Details | `GET .../tax-filing/{taxRecordId}/detail` |

### Upcoming filing deadlines (cards)

```http
GET /api/account/financial-extra/state-wise-tax/upcoming-deadlines?projectId=&limit=6&scope=state
GET /api/account/financial-extra/state-wise-tax/upcoming-deadlines?projectId=&limit=6&scope=project
```

**Query:** `scope=state` (state-only rows, `leadId` null) | `scope=project` (project-linked rows) | omit for all (respect `projectId` filter).

```json
{
  "deadlines": [
    {
      "_id": "67abc…",
      "taxRecordId": "67abc…",
      "state": "TX",
      "leadId": "6ac4…",
      "projectName": "Riverside A",
      "jobId": "PRO-042",
      "location": "Texas",
      "filingType": "Monthly Return",
      "dueDate": "2026-05-29T00:00:00.000Z",
      "daysLeft": 32,
      "payable": 450000
    }
  ],
  "total": 6,
  "meta": { "lastSyncedAt": "2026-03-19T10:30:00.000Z", "provider": "local" }
}
```

**Figma “Never miss a deadline” / Manage Notifications:**

```http
GET /api/account/financial-extra/tax-filing/notification-settings
PUT /api/account/financial-extra/tax-filing/notification-settings
```

```json
{
  "settings": {
    "emailReminders": true,
    "deadlineAlerts": true,
    "daysBeforeDue": 7,
    "recipientEmail": "accounts@acmeindustries.com"
  }
}
```

Pay/approve `notificationEmail` in body overrides `recipientEmail` for that payment; confirmation email sends when `emailReminders` is true and SendGrid is configured.

**`salesTaxRateLabel`:** derived from `taxCollected ÷ taxableSales` (stored on sync as `salesTaxRate`); shows `—` when unknown — not a fixed placeholder rate.

---

## Screen 10–11 — Project Wise Tax

### KPIs

```http
GET /api/account/financial-extra/project-wise-tax/stats?projectId=&startDate=&endDate=
```

### Table (paginated)

```http
GET /api/account/financial-extra/project-wise-tax?projectId=&startDate=&endDate=&page=1&limit=10
```

**Row:**

```json
{
  "leadId": "6ac4…",
  "projectName": "Riverside A",
  "jobId": "PRO-042",
  "location": "Texas",
  "taxCollected": 450000,
  "taxableSales": 450000,
  "paidFiled": 450000,
  "payable": 450000,
  "dueDate": "2024-01-14T00:00:00.000Z",
  "status": { "code": "payment_due", "label": "Payment Due", "tone": "warning" },
  "salesTaxRateLabel": "6.25% Sales Tax",
  "taxRecordId": "67abc…",
  "showPayTax": true
}
```

List response also includes **`meta`** (compliance/sync) and **`lastSynced`** like state-wise.

| Figma | API |
|-------|-----|
| Project thumbnail | Use project image from `GET /api/account/projects/:leadId` if available; table has no image URL today |
| Pay Tax | `POST .../tax-filing/{taxRecordId}/pay` |
| View Details | `GET .../tax-filing/{taxRecordId}/detail` |
| Sync Now | Same `POST state-wise-tax/sync` (updates state + project rollups) |

### Upcoming deadlines on project page

Use **`GET state-wise-tax/upcoming-deadlines?scope=project&projectId=`** (optional `projectId` narrows to one lead).

---

## Onboarding / empty state

```http
GET /api/account/financial-extra/tax-compliance/status
```

```json
{
  "provider": "local",
  "complianceStatus": "NOTYETFILING",
  "lastSyncedAt": null,
  "syncState": "not_configured",
  "canSync": true,
  "message": "Configure Avalara Returns or use local tax engine for development."
}
```

Show **`message`** when `syncState` is `not_configured` or `empty`.

---

## Frontend checklist

| Page | On mount | Filters | Actions |
|------|----------|---------|---------|
| Tax & Filling | `tax-filing/stats`, `tax-filing/filters`, `tax-filing` | state, projectId, clientId, dates, search | Export, Prepare, Review → detail, Sync (optional) |
| Detail modal | `tax-filing/:id/detail` | — | Pay → POST pay → success UI → receipt |
| Filing history | `tax-filing` → `filingHistory` | same filters | View, Download receipt |
| State wise | `state-wise-tax/stats`, `state-wise-tax`, `upcoming-deadlines` | projectId, dates | Sync, Pay, View, Export |
| Project wise | `project-wise-tax/stats`, `project-wise-tax`, deadlines | projectId, dates | Sync, Pay, View, Export |

---

## Avalara keys (ops — not in chat)

Set on Render when ready:

- `TAX_ENGINE=avalara`
- `AVATAX_ACCOUNT_ID`, `AVATAX_LICENSE_KEY`, `AVATAX_COMPANY_CODE`, `AVATAX_ENV=sandbox`
- **Returns (Pay Tax + real sync):** `AVALARA_COMPANY_ID` (numeric), optional `AVALARA_RETURNS_API_URL`, `AVALARA_AUTH_URL`

Until then: `TAX_ENGINE=local` + **Sync Now** after invoices are **sent** (tax committed).

---

## Route index

| Method | Path |
|--------|------|
| GET | `/api/account/financial-extra/tax-compliance/status` |
| GET | `/api/account/financial-extra/tax-filing/stats` |
| GET | `/api/account/financial-extra/tax-filing/filters` |
| GET | `/api/account/financial-extra/tax-filing` |
| GET | `/api/account/financial-extra/tax-filing/export` |
| GET | `/api/account/financial-extra/tax-filing/notification-settings` |
| PUT | `/api/account/financial-extra/tax-filing/notification-settings` |
| GET | `/api/account/financial-extra/tax-filing/:taxId/prepare` |
| GET | `/api/account/financial-extra/tax-filing/:taxId/detail` |
| POST | `/api/account/financial-extra/tax-filing/:taxId/pay` |
| POST | `/api/account/financial-extra/tax-filing/:taxId/approve` |
| GET | `/api/account/financial-extra/tax-filing/:taxId/receipt` |
| PUT | `/api/account/financial-extra/tax-filing/:taxId/file` |
| GET | `/api/account/financial-extra/state-wise-tax` |
| GET | `/api/account/financial-extra/state-wise-tax/stats` |
| GET | `/api/account/financial-extra/state-wise-tax/export` |
| GET | `/api/account/financial-extra/state-wise-tax/upcoming-deadlines` |
| POST | `/api/account/financial-extra/state-wise-tax/sync` |
| GET | `/api/account/financial-extra/project-wise-tax` |
| GET | `/api/account/financial-extra/project-wise-tax/stats` |
| GET | `/api/account/financial-extra/project-wise-tax/export` |

Legacy manual CRUD (avoid for Figma): `/api/account/tax/*`
