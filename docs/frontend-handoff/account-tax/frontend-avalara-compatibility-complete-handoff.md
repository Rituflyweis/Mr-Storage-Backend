# Avalara compatibility — complete frontend handoff (explanation + all endpoints)

**Date:** 2026-10-22  
**Audience:** Frontend (Account, Admin, Sales, Customer where noted)  
**Prod:** `https://mr-storage-backend-025k.onrender.com`

This doc answers: **“Besides address, what else changed?”** and lists **every API** with pointers to **request/response examples**.

---

## Part A — What changed (plain English)

The gap doc [`frontend-gap-changes-tax-address-avalara-2026-10-19.md`](./frontend-gap-changes-tax-address-avalara-2026-10-19.md) is a migration checklist. Below is the **same work grouped by product area** so it is easier to assign to screens.

### 1. Structured addresses (you already know this one)

**Why:** AvaTax needs ship-to with street, city, state, ZIP, country — not only a single `location` string.

**Frontend work:**

- Project/lead forms: collect and save **`installAddress`** (or flat `line1`, `city`, `state`, `pincode`).
- Show **`installAddress`** on project detail; keep **`location`** for legacy display if needed.
- Customer **`POST /api/customer/projects`** unchanged path; response now includes **`installAddress`**.

Without a complete address, **invoice send** may fail with **`reason: ship_to_incomplete`** (see §2).

---

### 2. Invoice tax lifecycle (Sales / Admin — drives Account tax numbers)

**Before:** Tax was mostly manual on lines; sending an invoice did not “lock in” tax for filing.

**After:**

| Step | Behavior |
|------|----------|
| Create / edit **draft** | Server **recalculates** tax (`avalara.documentStatus: "Saved"` or local estimate). |
| **Send** or **mark-sent** | Tax is **committed**; set **`taxCollected`**; `documentStatus: "Committed"`. |
| **Paid** | Payment only — **do not** recalculate tax. |
| Send failure | HTTP **409** with `data.reason` — invoice may stay **not sent**. |

**New invoice fields:** `shipToAddress`, `taxableSales`, `taxCollected`, `avalara`, optional `orderType`, `installationProvider`, `exemption`.

**Frontend work:**

- Invoice create/edit: optional **`shipToAddress`**; default from lead **`installAddress`**.
- On send/mark-sent: handle **409** and show user-friendly copy from `reason` (`ship_to_incomplete`, `ship_from_incomplete`, `unapproved_tax_codes`, `tax_error`).
- Do **not** expect Account tax KPIs to update until someone runs **Sync Now** (§4).

**Extra staff routes (not in old gap doc §7):**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/invoices/:invoiceId/tax-preview` | Recalc/preview tax without saving (same as `/api/common/invoices/...`) |
| POST | `/api/invoices/:invoiceId/tax-adjust` | Manual tax adjust workflow when engine allows |
| GET | `/api/invoices/:invoiceId/tax` | Read last tax calc snapshot on invoice |
| GET | `/api/invoices/billing-defaults` or `/api/common/invoices/billing-defaults` | Billing address for forms (city/state/ZIP parsing fixed) |

Full req/res: [`../../avalara-full-changes-master-handoff-2026-10-19.md`](../../avalara-full-changes-master-handoff-2026-10-19.md) §5.

---

### 3. Account / Admin tax **screens** — new data shape (not legacy `/api/account/tax`)

**Before:** Lists returned raw Mongo `Tax` docs (`status: "pending"`, one `amount` field).

**After:**

- Use **`/api/account/financial-extra/*`** only for Figma tax pages (Admin: **`/api/admin/financial-extra/*`** — same handlers).
- **Stop** using **`GET/POST /api/account/tax`** for Tax & Filing / State / Project UI (legacy manual CRUD).
- Each row has **`status: { code, label, tone }`**, **`salesTaxRateLabel`**, **`daysUntilDueLabel`**, split amounts (`taxDue`, `payable`, `taxCollected`, …).
- **State & project tables:** **`taxRecordId`** → use for **`GET .../detail`** and **`POST .../pay|approve`**.
- **Project row:** also **`showPayTax`**, **`state`** / **`stateLabel`** (jurisdiction for detail modal).
- List responses often include **`meta`**: `provider`, `syncState`, `lastSyncedAt`, `canSync`.

**Frontend work:**

- Bind pills to **`status.label`** + **`status.tone`** (not string compare on `"pending"`).
- Pending / History tabs → **`pendingFiling`** / **`filingHistory`** on **`GET tax-filing`**.
- Wire Pay → **`POST /tax-filing/:taxId/approve`** (Avalara Returns) or **`/pay`** (local ledger).
- Wire modals → **`GET /tax-filing/:taxId/detail`** (and optional **`/prepare`**).

Examples: [`frontend-account-tax-full-api-handoff-2026-10-19.md`](./frontend-account-tax-full-api-handoff-2026-10-19.md).

---

### 4. Sync Now (connects invoices → filing tables)

**Before:** Sync could feel cosmetic; KPIs might not match sent invoices.

**After:** **`POST .../state-wise-tax/sync`** rolls up **committed** customer invoices into **`Tax`** filing rows (or pulls Avalara Returns when env is configured).

**Frontend work:**

- On all three tax pages, **Sync Now** → POST sync → refetch stats + table + read **`meta.lastSyncedAt`**.
- Empty onboarding → **`GET /tax-compliance/status`**.

---

### 5. Pay, receipt, notifications (new/modal flows)

| Figma | API |
|--------|-----|
| Texas / state detail modal | `GET /tax-filing/:taxId/detail` |
| Prepare filing | `GET /tax-filing/:taxId/prepare` |
| Pay Now | `POST /tax-filing/:taxId/approve` or `/pay` |
| Payment success modal | Response **`data.payment`** |
| Receipt link / download | `GET /tax-filing/:taxId/receipt` or `?format=pdf` |
| Manage notifications | `GET/PUT /tax-filing/notification-settings` |
| Legacy “mark filed” only | `PUT /tax-filing/:taxId/file` (prefer pay/approve for Figma) |

**Pay body (optional):**

```json
{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@example.com"
}
```

---

### 6. Customer exemption (optional, affects new invoices)

**New on Customer (optional):** **`taxExemption`** (`isExempt`, `entityUseCode`, …) can default exemption on new invoices.

See master handoff §4.2.

---

### 7. Environment / `meta.provider` (no keys in frontend)

Backend may run **`TAX_ENGINE=local`** on Render even when AvaTax keys exist. UI should:

- Show **`meta.provider`** / compliance banner from **`GET /tax-compliance/status`**.
- Not hard-code “Avalara live” until ops enables engine + Returns.

Ops checklist: gap doc §6.

---

## Part B — Which doc to open for copy-paste payloads

| Need | Document |
|------|----------|
| **Screen → route map (Figma)** | [`frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md`](./frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md) |
| **Every tax endpoint + example JSON** | [`frontend-account-tax-full-api-handoff-2026-10-19.md`](./frontend-account-tax-full-api-handoff-2026-10-19.md) |
| **Migration checklist (short)** | [`frontend-gap-changes-tax-address-avalara-2026-10-19.md`](./frontend-gap-changes-tax-address-avalara-2026-10-19.md) |
| **Invoice + lead before/after + 409** | [`../../avalara-full-changes-master-handoff-2026-10-19.md`](../../avalara-full-changes-master-handoff-2026-10-19.md) |
| **Admin same APIs** | [`../admin-tax/README.md`](../admin-tax/README.md) — prefix `/api/admin/financial-extra` |

---

## Part C — Complete endpoint index (Account + Admin)

Replace `{base}` with:

- Account: **`/api/account/financial-extra`**
- Admin: **`/api/admin/financial-extra`**

Auth: **`account`** or **`admin`**.  
Legacy admin alias: `/api/admin/financials/...` (same paths after prefix).

### Compliance & sync

| Method | Path |
|--------|------|
| GET | `{base}/tax-compliance/status` |
| POST | `{base}/state-wise-tax/sync` |

### Tax & Filing (Sales Tax & Filing page)

| Method | Path | Notes |
|--------|------|--------|
| GET | `{base}/tax-filing/stats` | KPI cards; query: `state`, `projectId`, `clientId`, `startDate`, `endDate`, `search` |
| GET | `{base}/tax-filing/filters` | State, project, client dropdowns |
| GET | `{base}/tax-filing` | `pendingFiling[]`, `filingHistory[]`, `meta`; query: `page`, `limit`, filters |
| GET | `{base}/tax-filing/export` | Excel |
| GET | `{base}/tax-filing/notification-settings` | Deadline email prefs |
| PUT | `{base}/tax-filing/notification-settings` | Body: `emailReminders`, `deadlineAlerts`, `daysBeforeDue`, `recipientEmail` |
| GET | `{base}/tax-filing/:taxId/prepare` | Prepare filing review |
| GET | `{base}/tax-filing/:taxId/detail` | Detail modal |
| POST | `{base}/tax-filing/:taxId/pay` | Local / staging pay |
| POST | `{base}/tax-filing/:taxId/approve` | Avalara approve (prod when Returns configured) |
| GET | `{base}/tax-filing/:taxId/receipt` | JSON or `?format=pdf` |
| PUT | `{base}/tax-filing/:taxId/file` | Legacy mark filed (no payment UI) |

### State Wise Tax

| Method | Path |
|--------|------|
| GET | `{base}/state-wise-tax/stats` |
| GET | `{base}/state-wise-tax` |
| GET | `{base}/state-wise-tax/export` |
| GET | `{base}/state-wise-tax/upcoming-deadlines` | Query: `projectId`, `limit`, `scope=state\|project` |

### Project Wise Tax

| Method | Path |
|--------|------|
| GET | `{base}/project-wise-tax/stats` |
| GET | `{base}/project-wise-tax` | Query: `page`, `limit`, `projectId`, dates |
| GET | `{base}/project-wise-tax/export` |

**Important:** Project detail/pay must use row **`taxRecordId`**, not `leadId`, for **`GET .../detail`**.

---

## Part D — Staff / customer routes (tax pipeline — not under `financial-extra`)

These are **required for Avalara compatibility** but live outside the tax folder docs.

### Customer

| Method | Path |
|--------|------|
| POST | `/api/customer/projects` | Sets `installAddress` from address fields |

### Lead / project (admin, sales, construction project APIs as applicable)

| Action | Notes |
|--------|--------|
| Create / update lead | Accept `installAddress`, `line1`, `city`, `state`, `pincode` |

### Invoices (admin, sales)

| Method | Path |
|--------|------|
| POST | `/api/leads/:leadId/invoices` or `/api/common/leads/:leadId/invoices` |
| GET | `/api/invoices/:invoiceId` or `/api/common/invoices/:invoiceId` |
| PUT | `/api/invoices/:invoiceId` |
| POST | `/api/invoices/:invoiceId/send` |
| POST | `/api/invoices/:invoiceId/mark-sent` |
| PUT | `/api/invoices/:invoiceId/mark-paid` |
| POST | `/api/invoices/:invoiceId/tax-preview` |
| POST | `/api/invoices/:invoiceId/tax-adjust` |
| GET | `/api/invoices/:invoiceId/tax` |
| GET | `/api/invoices/billing-defaults` or `/api/common/invoices/billing-defaults` |
| GET | `/api/account/invoices/billing-defaults` | Account alias |

### Legacy (do not use for Figma tax pages)

| Method | Path |
|--------|------|
| GET/POST | `/api/account/tax` | Old manual tax CRUD |

---

## Part E — TypeScript-friendly field cheat sheet

```ts
type TaxStatusBadge = { code: string; label: string; tone: 'warning' | 'success' | 'info' | 'neutral' }

type StructuredAddress = {
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}

type InvoiceAvalara = {
  provider: 'local' | 'avalara' | string
  documentStatus: 'Saved' | 'Committed' | 'Voided' | string
  transactionCode?: string
  totalTaxable?: number
  totalTax?: number
  committedAt?: string
}

type TaxListMeta = {
  provider: string
  complianceStatus?: string
  lastSyncedAt?: string | null
  syncState: 'not_configured' | 'empty' | 'synced' | 'error'
  canSync: boolean
  message?: string
}
```

---

## Part F — Frontend ownership matrix

| Team / app | Must implement |
|------------|----------------|
| **Account + Admin tax** | financial-extra routes, badges, sync, pay, detail, `taxRecordId`, notifications |
| **Sales / Admin invoice** | send 409 handling, `shipToAddress`, optional tax-preview |
| **Project / lead forms (all panels)** | `installAddress` on create/update |
| **Customer portal** | address fields on create project (already sent; display `installAddress`) |

---

## Part G — Gap doc vs this doc (what was “missing”)

The file **`frontend-gap-changes-tax-address-avalara-2026-10-19.md`** already lists most **financial-extra** routes in §7 but **does not** document in one place:

- Invoice **`tax-preview`**, **`tax-adjust`**, **`GET .../tax`**
- **`notification-settings`** GET/PUT (mentioned briefly in full-api only)
- **`409`** send/mark-sent error contract (master handoff §2)
- **`taxExemption`** on customer
- **Admin prefix** `/api/admin/financial-extra`
- **Project `taxRecordId`** resolution (use row id for detail — backend fix 2026-10-22)

Use **this file** for orientation + route index; use **full-api handoff** for literal JSON examples per endpoint.
