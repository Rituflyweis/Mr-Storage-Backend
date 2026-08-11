# Customer portal & Accounts panel — API spec

**Purpose:** Canonical HTTP contract for the **customer portal** (logged-in end customer) and the **Accounts** financial shell (standalone Accounts app + Admin **`/accounts/*`**). Extracted from the lead module plan so **`backend-lead-module-api-db-plan.md`** stays focused on Sales/Admin CRM, leads, quotations, and shared core.

**Still authoritative in the lead plan:** **§9** Invoices, **§9.0.1** payment-plan linkage, **§8** Quotations (staff create; customer may read summaries via portal serializers), **§3** S3 presign (**§3.1** upload, **§3.2** download). **Customer auth** lives in **`backend-foundation-plan.md`** §6–7.

**Database:** **`expenses`** collection and fields — **`backend-lead-module-api-db-plan.md`** §20.15 and **Appendix A.7** (not duplicated here).

**Related:** Page-level mapping → **`customer-and-accounts-panel-api-by-page-matrix.md`**.

---

## 1. Customer portal API (Customer JWT)

### 1.1 `POST /api/v1/customer/me/projects`

Same as lead plan **§4.12** (`POST /api/v1/customers/:customerId/projects`) but `customerId` is taken from the access token. Body: optional initial project spec (`leadSource`, `status`, `displayLocation`, `buildingSpec`, `notes`, …). New project appears in **Admin/Sales** `/leads` list.

**Response:** `{ "data": { "leadId": "...", "leadNumber": "...", "customerId": "..." } }` + `201`.

### 1.2 Customer portal — reads

**Auth:** All routes below require **customer** access token (`type: customer`, `sub` = **`customers._id`**). Never return another customer’s data.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/customer/me` | **Profile:** `fullName`, `email`, `phone`, `customerNumber`, `lifecycle`, `portalEnabled`, optional **`projectCount`** / **`activeProjectCount`**. No `passwordHash`. |
| GET | `/api/v1/customer/me/projects` | **My projects:** paginated `page`, `limit`; list **projects** where **`customerId` = `sub`**. Response shape aligned with **`GET /api/v1/leads`** list row (subset): `leadId`, `leadNumber`, `status`, `buildingSpec`, `displayLocation`, `estimatedValueCents`, `createdAt`, etc. — lead plan **Appendix A.2**. |
| GET | `/api/v1/customer/me/projects/:projectId` | **One project** if `customerId` matches. Reuse lead plan **§4.3** serializer with **customer-safe** field allow-list (hide internal staff notes; show **quotation** summaries / RFQ per product). |
| GET | `/api/v1/customer/me/projects/:projectId/files` | **Project documents (metadata only):** files the customer is allowed to see. Each item: `fileId`, `purpose`, `fileName`, `mimeType`, `createdAt`; client then calls **`POST /api/v1/files/presign-download`** with `fileKey` (**lead plan §3.2**). |
| GET | `/api/v1/customer/me/invoices` | **All my invoices:** server resolves **`sub` → all `leadId`s** for that customer; returns **invoices** where `leadId` ∈ that set. Query: optional `leadId`, `status`, `page`, `limit`. Shape **§9.1** / **Appendix A.4** (no staff-only internal fields). |

**Optional later:** `PATCH /api/v1/customer/me` (self-service phone); avatar upload via **§3.1** + `customer_profile_doc` — see **`api-by-page-matrix.md`** customer gaps.

**Zod:** Add query/body schemas in **`customerPortal.schemas.js`** (or equivalent) for **§1** routes.

---

## 2. Expenses (Accounts panel — basic CRUD)

**Not** inventory/COGS — a simple ledger for internal ops. **One** REST resource **`/api/v1/expenses`**: the standalone Accounts app and Admin **`/accounts/expenses`** are **different UI routes** calling the **same** five operations (do not fork the API per panel). **Project linkage:** optional **`leadId`** = **`projects` / `leads`** `_id` (same as **`GET /api/v1/leads/:leadId`** and **`invoice.leadId`**). UI may say “project”; API field stays **`leadId`**.

### 2.1 `GET /api/v1/expenses`

Query: `page`, `limit`, `dateFrom`, `dateTo`, `category`, optional **`leadId`**. **Response:** `{ "data": [ expense ] }` — each item includes **`leadId`** when set.

### 2.2 `POST /api/v1/expenses`

**Request:** `{ "amountCents", "category", "description?", "incurredAt", "vendor?", "receiptFileKey?", "leadId?" }`. **`leadId`** optional; if present, must reference an existing lead/project (**404** otherwise). **Response:** `{ "data": expense }`.

### 2.3 `GET /api/v1/expenses/:id`

### 2.4 `PATCH /api/v1/expenses/:id`

Partial update of the same fields, including **`leadId`** (valid id or **`null`**).

### 2.5 `DELETE /api/v1/expenses/:id`

Hard delete, or soft-delete via **`PATCH`** + `status: archived` — pick one in implementation.

**Collection:** **`expenses`** — **lead plan §20.15**.

---

## 3. Accounts panel — API architecture (invoices + expenses only)

**Audience:** Backend + Accounts frontend integrators.  
**Scope:** Standalone **Accounts** app and Admin **`/accounts/*`**. **In scope:** **§9** invoices, **§9.0.1** payment-plan line linkage, **§2** expenses API above, **§3** presign for expense receipts. **Out of scope:** COGS, WIP, labor costing, Income GL, tax engine, financial report builder, lead **§17**-style marketing analytics.

### 3.1 Design principles

1. **No new primary ledger** beyond **`invoices`** and **`expenses`** for v1.  
2. **Dashboard** = read-only views over those collections (optional **quotation** reads for **`paymentPlan[]`** per **§9.0.1**).  
3. **`accounts`** RBAC: full invoice + expense operations per **Lead §9** and **this doc §2**; optional read-only **`GET /api/v1/leads/:leadId`** + **`GET .../quotations`** for invoice context (middleware when implemented).

### 3.2 Core routes (reuse from lead plan)

| Need | HTTP | Lead plan |
|------|------|-----------|
| List / filter invoices | `GET /api/v1/invoices` | **§9.4** |
| Invoice detail | `GET /api/v1/invoices/:id` | **§9.4** |
| Create / edit | `POST`, `PATCH` | **§9.3**, **§9.5** |
| Send, mark paid, notify | `POST .../send`, `.../mark-paid`, `.../notify` | **§9.6–9.8** |
| From quotation | `POST .../leads/:leadId/invoices/from-quotation` | **§9.2** |
| Payment overview | Join **`GET /invoices`** + **`GET .../leads/:leadId/quotations`** for **`paymentPlan[]`** | **§9.0.1**, **§8.4–8.5** |
| Expenses | `GET/POST/PATCH/DELETE /api/v1/expenses` | **§2** (this doc) |
| Receipt upload | `POST /api/v1/files/presign-upload` → expense `receiptFileKey` | **§3.1** |

### 3.3 Dashboard metrics

**v1 default:** Accounts UI calls **`GET /api/v1/invoices`** and **`GET /api/v1/expenses`** with **`dateFrom` / `dateTo`** and aggregates client-side.

| Metric | Definition (USD cents) | Source |
|--------|-------------------------|--------|
| **Received** | Sum **`totalCents`** for **`status: paid`** where **`paidAt`** in period | **§9.1** |
| **Pending** | Sum **`totalCents`** for **`sent` / `unpaid` / `draft`** (exclude **`void`**) | **§9.1** |
| **Overdue** (optional) | **`sent`/`unpaid`** with inferred due before today | **§9.1** |
| **Expense total** | Sum **`amountCents`** for **`GET /expenses`** in period (optional **`leadId`**) | **§2** |
| **Expense trend** | Group by **`incurredAt`** | **§2** |
| **Collections trend** | Group paid invoices by **`paidAt`** | **§9** |
| **Payment schedule widget** | **`quotationId`** + **`paymentPlanLineKey`** vs **`paymentPlan[]`** | **§9.0.1**, **§8.1.8** |

**Optional v1.1:** `GET /api/v1/accounts/dashboard-summary?period=today|week|month`.

### 3.4 UI mapping (Accounts `Dashboard.tsx`)

| Area | Backend |
|------|---------|
| Stat cards | Received, Pending, Expense total, optional Overdue — **§3.3** |
| `FinanceStatsGrid` | **§9.4** invoice counts |
| Trend charts | Collections + expense series — **§3.3** |
| WIP / COGS blocks | **Out of scope** — hide or payment-plan snapshot |
| `UpcomingPayments` | **`GET /invoices`** near-due unpaid/sent |
| `ProjectDetailsTable` | **`GET /invoices?`**, **`GET /expenses?leadId=`**, optional **`GET /leads/:id`** read-only for labels |

### 3.5 Exclusions

COGS, WIP, labor modules, income statement, tax filing product, multi-currency; **G7**-style dedicated payment-split API (optional); lead **§17** on Accounts dashboard.

---

*Section numbers here (**§1–§3**) are **local** to this file. Cross-refs to the main lead plan use **“lead plan §…”**.*
