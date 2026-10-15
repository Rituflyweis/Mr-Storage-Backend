# Account panel — new APIs handoff

**Base URL (prod):** `https://mr-storage-backend-025k.onrender.com`  
**Base path:** `/api/account`  
**Auth:** `Authorization: Bearer <token>` · roles **`account`** | **`admin`**

This document lists **only routes added or introduced for the account panel** (not the full legacy account surface). For screen-by-screen payloads see [`frontend-account-panel-api.md`](./frontend-account-panel-api.md) and [`frontend-account-project-detail-api.md`](./frontend-account-project-detail-api.md).

---

## 1. Project sub-pages (`GET`, read-only)

`:projectId` = Mongo **`leadId`** or **`jobId`**.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects/:projectId/invoices/summary` | Invoice KPIs (total, billed, received, outstanding, overdue) |
| GET | `/projects/:projectId/invoices/records` | Invoice table (`page`, `limit`, `search`, `paymentStatus`, `sortBy`, `sortOrder`) |
| GET | `/projects/:projectId/payments/summary` | Payments KPIs (received, completion %, pending, overdue) |
| GET | `/projects/:projectId/payments/records` | Payments table (customer + vendor/carrier + approvals) |
| GET | `/projects/:projectId/deliveries` | Material delivery list |
| GET | `/projects/:projectId/deliveries/:deliveryId` | Delivery detail (vendor, carrier, site coordination, history) |
| GET | `/projects/:projectId/quotations` | Quotation list for project |
| GET | `/projects/:projectId/quotations/:quotationId` | Quotation detail (read-only) |
| GET | `/projects/:projectId/bom` | BOM files + consolidated BOM metadata |
| GET | `/projects/:projectId/agreement` | Signed agreement / contract (replaces admin URL for account UI) |

**Overview:** `GET /projects/:projectId` now returns **`actionLinks`** pointing only to the routes above (under `/api/account/projects/...`).

---

## 2. Invoice management

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/invoice-management/filters` | Projects + filter enums |
| GET | `/invoice-management/project/summary` | Project (customer AR) KPIs |
| GET | `/invoice-management/project/records` | Project invoice table |
| GET | `/invoice-management/project/export` | Excel export |
| GET | `/invoice-management/vendor/summary` | Vendor payable KPIs |
| GET | `/invoice-management/vendor/records` | Vendor invoice table |
| GET | `/invoice-management/vendor/export` | Excel export |
| GET | `/invoice-management/carrier/summary` | Carrier KPIs |
| GET | `/invoice-management/carrier/records` | Carrier table |
| GET | `/invoice-management/carrier/export` | Excel export |
| GET | `/invoice-management/miscellaneous/summary` | Misc invoice KPIs |
| GET | `/invoice-management/miscellaneous/records` | Misc table |
| GET | `/invoice-management/miscellaneous/export` | Excel export |
| POST | `/invoice-management/miscellaneous` | Create misc payable (body: `projectId`, `serviceProvider`, `amount`, `serviceCategory`, `dueDate`, `documentUrl`, …) |
| GET | `/invoice-management/quotation-profit/summary` | Quotation-wise P&L KPIs |
| GET | `/invoice-management/quotation-profit/records` | P&L table |
| GET | `/invoice-management/quotation-profit/export` | Excel export |
| GET | `/invoice-management/quotation-profit/:quotationId` | Row detail |
| POST | `/invoice-management/quotation-profit/upload` | Attach file / overrides (`quotationId`, `revenue`, `actualCost`, `status`, `documentUrl`) |

**Legacy (same data, still mounted):**  
`GET /financial/invoices/vendor` · `GET /financial/invoices/carrier`

---

## 3. Expenses submenu (`/costs`)

| Area | Summary | Records / other |
|------|---------|-----------------|
| Shared | `GET /costs/filters` | — |
| Salary | `GET /costs/salary/summary` | `GET/POST/PATCH/DELETE /costs/salary/records` … |
| Manpower | `GET /costs/manpower/summary` | `GET/POST/PUT/DELETE /costs/manpower/records` … |
| Miscellaneous | `GET /costs/miscellaneous/summary` | `overview-chart`, `by-category`, `by-project`, `records`, POST |
| Freight | `GET /costs/freight/summary` | `trend`, `carrier-distribution`, `records` |
| Logistics | `GET /costs/logistics/summary` | `records`, `delivery-lookup/:deliveryRef`, POST |
| Cost variation | `GET /costs/variance/summary` | `alerts`, `trend`, `details` |
| Rent | `GET /costs/rent/summary` | `records`, POST |
| Future income/expense | `GET /costs/future/summary` | `records`, POST |
| **SMDT item list** | `GET /costs/item-list/summary` or `/stats` | `categories`, `records`, `records/:itemId`, POST, PUT, `export` |

---

## 4. Analytics reports

| Method | Path |
|--------|------|
| GET | `/reports/project-wise-expense` |
| GET | `/reports/project-wise-income` |

(Existing `/reports/profit-loss` enhanced with combined expense sources.)

---

## 5. Dynamic project budget (admin set, account consumes)

Not under `/account`, but required for budget vs actual everywhere:

| Method | Path |
|--------|------|
| POST | `/api/admin/leads/:leadId/budget` |

**Body:** fixed fields + optional **`customLines[]`**: `{ key, label, amount, expenseCategories[] }`.

**Account read:** totals flow through `GET /financial/budget-vs-actual?leadId=`, dashboard `project-budget-vs-actual`, customer/project profitability.

---

## 6. Bugfix (no new route)

`GET /customers/:customerId` — fixed 500 (`totalExpenses` now uses combined expense rollup).

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

*Handoff version: 2026-10-15 · Branch: `shubham-changes-13-aug`*
