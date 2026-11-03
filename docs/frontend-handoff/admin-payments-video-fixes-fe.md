# Admin Payments — video issues (backend + FE notes)

**Date:** 2026-11-03

## 1. Main dashboard KPIs vs Expected Payments / Payment Status

**Fixed (backend):** `GET /api/admin/financials/payments-dashboard` now computes **Total Outstanding**, **Total Overdue**, and **Expected Payments** from the same customer receivable open-invoice set as Payment Status (`invoiceType` customer / legacy, `status` ∈ `sent`|`overdue`). PO/plant-only lead scoping no longer zeroes out AR on the main dashboard.

**FE:** Bind top Outstanding/Overdue cards to `data.stats.totalOutstanding` / `totalOverdue` after deploy. No field renames.

**Optional:** If the donut still shows 100% Paid while KPIs show outstanding, the date range may exclude open invoices from `statusDistribution` only — clear the date filter or show a footnote.

## 2. Payment Approvals crash

**Fixed (backend):** `GET /api/admin/financials/payment-approvals` (and `/api/admin/financial-extra/payment-approvals`) now uses the **Account** list handler: populated `leadId`, `project` object, `invoiceType`, `linkedTo`, etc.

**FE:** Prefer response shape from `docs/frontend-handoff/admin-payments/payment-approvals-api.md` (Account API). Do not assume `requestedBy.name` alone — use `companyName`, `project.projectName`, `statusLabel`.

Query params now accepted on admin route: `search`, `project`, `payeeType`, `paymentStatus` (same as Account).

## 3. State-wise / Project-wise tax (only 2 rows)

**Not a list bug:** rows come from **`Tax`** records created by **Sync Now** (`POST /api/admin/financials/state-wise-tax/sync` or `POST …/tax-filing/sync`), rolling up **Avalara-committed** customer invoices (`avalara.documentStatus === 'Committed'`).

**Action:** Run **Sync Now** on State-wise Tax after invoices are committed in AvaTax. More projects appear when they have committed tax on invoices with ship-to / lead state.

**FE:** Alignment of filters vs “Last Synced” is a layout fix on tax screens.

## 4. Date range on Payments dashboard

`startDate` / `endDate` filter **Total Payments** and **Total Received** by invoice `createdAt`. **Outstanding / Overdue / Expected aging** ignore the range (point-in-time AR). Documented in `docs/frontend-admin-payments-dashboard-api.md`.
