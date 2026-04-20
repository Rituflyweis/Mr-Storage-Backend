# Customer portal & Accounts panel — API by page matrix

**Purpose:** Map **customer portal** and **Accounts** (Admin submodule + standalone app) UI routes to HTTP APIs. **Staff CRM** routes remain in **`api-by-page-matrix.md`**.

**API specs:** **`customer-and-accounts-panel-api.md`** (customer §1, expenses §2, Accounts shell §3) + **`backend-lead-module-api-db-plan.md`** (**§9** invoices, **§8** quotations, **§3** files) + **`backend-foundation-plan.md`** (customer **§6–7** auth).

**Route sources**

| App | File |
|-----|------|
| Customer portal | `Mr-Storage-Material-Customer-Panel-Frontend-main/src/routes.tsx` |
| Accounts (standalone) | `Mr-Storage-Material-Accounts-Panel-Frontend-main/src/routes.tsx` |
| Admin (Accounts submodule) | `Mr-Storage-Material-Admin-Panel-Frontend-master/src/routes/admin.routes.tsx` (under `/accounts/...`) |

---

## 1. Customer portal (customer JWT)

| UI / flow | HTTP API | Plan ref |
|-----------|----------|----------|
| Login / refresh / logout | `POST /api/v1/auth/customer/login`, `.../refresh`, `.../logout` | **Foundation §6–7** |
| Profile | `GET /api/v1/customer/me` | **`customer-and-accounts-panel-api.md` §1.2** |
| My projects list | `GET /api/v1/customer/me/projects` | **§1.2** |
| Project detail | `GET /api/v1/customer/me/projects/:projectId` | **§1.2** |
| Project files (metadata) | `GET .../projects/:projectId/files` → `POST /api/v1/files/presign-download` | **§1.2**, **Lead §3.2** |
| All invoices | `GET /api/v1/customer/me/invoices` | **§1.2** |
| New project | `POST /api/v1/customer/me/projects` | **§1.1** |

---

## 2. Admin — Financial Accounts submodule (`/accounts/...`)

Same APIs as standalone Accounts; paths live under Admin router.

| UI path | HTTP API | Plan ref |
|---------|----------|----------|
| `/accounts`, `/accounts/` (index) | **`GET /api/v1/invoices`** + **`GET /api/v1/expenses`** (client-side aggregate or optional **`GET .../accounts/dashboard-summary`**) | **`customer-and-accounts-panel-api.md` §3**, **Lead §9.4**, **CAP §2** |
| `/accounts/payment_overview` | **`GET /invoices`** + quotation **`paymentPlan[]`** join | **Lead §9.0.1**, **§8.4–8.5** |
| `/accounts/payments/new-invoice`, `.../invoice/preview` | **Lead §9.3–9.6**; **`quotationId`** + **`paymentPlanLineKey`** **§9.0.1** | **Lead §9** |
| `/accounts/order_payments` | **G9** + **`GET /invoices`** | **Gap** / **Lead §9.4** (see main **`api-by-page-matrix.md` §18**) |
| `/accounts/expenses` | **`GET/POST/PATCH/DELETE /api/v1/expenses`**; optional **`leadId`** | **CAP §2** |
| `/accounts/cogs_analysis`, `wip_profit`, `income`, `labor_expenses`, `reports`, `taxation` | **Out of scope** or future extensions | **Out of scope** |

---

## 3. Accounts panel — standalone app (`Mr-Storage-Material-Accounts-Panel-Frontend-main`)

| UI path | HTTP API | Plan ref |
|---------|----------|----------|
| `/dashboard` | **`GET /api/v1/invoices`** + **`GET /api/v1/expenses`** (+ optional **`GET .../quotations`**); **§3.3** metrics | **CAP §3**, **Lead §9.4**, **CAP §2** |
| `/payment_overview` | **§9.4** + **`paymentPlan[]`** + invoices **§9.0.1** | **Lead §9** |
| `/payments/new-invoice`, `/payments/invoice/preview` | **Lead §9.3–9.6** | **Lead §9** |
| `/order_payments` | **G9** + **§9.4** | **Gap** / **Lead §9** |
| `/expenses` | **`GET/POST/PATCH/DELETE /api/v1/expenses`** | **CAP §2** |
| `/cogs_analysis`, `/wip_profit`, `/income`, `/labor_expenses`, `/reports`, `/taxation` | **Out of scope** | **Out of scope** |
| `/communication`, `/notification` | **Gap** | Main matrix **G2** |
| `/settings`, `/profile` | **Gap** (staff **`/me`** not applicable to customer; Accounts staff user may use **`GET /me`**) | **Gap** |

---

*The main **`api-by-page-matrix.md`** §3, §13, and §16 are stubbed to point here — edit this file when customer or Accounts routes change.*
