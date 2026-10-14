# Admin — Payments dashboard (Figma page only)

**Screen:** Admin Panel → **Payments** (main dashboard — KPI row, charts, stage progress, recent payments table, date range, Export).

**Not covered here:** Tax & Filing, State-wise Tax, Project-wise Tax, Payment Approvals, Payment Status (separate screens / docs).

---

## Auth & base URL

| Item | Value |
|------|--------|
| Role | `admin` |
| Header | `Authorization: Bearer <token>` |
| Response envelope | `{ "success", "message", "data" }` |
| Production host | `https://mr-storage-backend-025k.onrender.com` |
| API prefix | `/api/admin/financials` |

All KPIs and charts on this page use **customer receivables** (money from clients). Vendor and freight **payable** invoices are excluded.

---

## Single API for the whole page

Load everything with one call when the user opens the page or changes the date range.

```http
GET /api/admin/financials/payments-dashboard?startDate=2026-01-01&endDate=2026-12-31&page=1&limit=10 HTTP/1.1
Host: mr-storage-backend-025k.onrender.com
Authorization: Bearer <token>
```

### Query parameters

| Param | Required | Description |
|--------|----------|-------------|
| `startDate` | No | ISO date; with `endDate`, filters KPIs, status donut, and recent payments by invoice `createdAt`. |
| `endDate` | No | ISO date (inclusive end of day). |
| `page` | No | Recent payments table page (default `1`). |
| `limit` | No | Recent payments page size (default `10`, max `100`). |

**Date range behavior**

| UI area | Respects `startDate` / `endDate`? |
|---------|-----------------------------------|
| Top 5 KPI cards | Yes |
| Payment status distribution (donut) | Yes |
| Recent payments table | Yes |
| Revenue trend (bar chart) | No — always last **6 calendar months** (customer invoices) |
| Expected payments (aging list) | No — all open customer invoices |
| Stage-wise payment progress | No — all payment schedules |

---

## Figma layout → API mapping

```
┌─────────────────────────────────────────────────────────────────┐
│  [Date range]                              [Export]             │
├──────────┬──────────┬──────────┬──────────┬─────────────────────┤
│ Total    │ Total    │ Total    │ Total    │ Total Overdue (YTD) │
│ Payments │ Received │ Outstand.│ Overdue  │                     │
│ stats.*  │ stats.*  │ stats.*  │ stats.*  │ stats.*             │
├──────────────────┬──────────────────┬─────────────────────────────┤
│ Payment status   │ Revenue trend    │ Expected payments           │
│ distribution     │                  │ (0-30 … 90+ days)           │
│ statusDistrib.   │ revenueTrendChart│ expectedPayments            │
├──────────────────┴──────────────────┴─────────────────────────────┤
│ Stage-wise payment progress (Initial / Final gauges)            │
│ stageWise                                                       │
├─────────────────────────────────────────────────────────────────┤
│ Recent payments table                                           │
│ recentPayments + recentPaymentsPage/Limit/Total                 │
└─────────────────────────────────────────────────────────────────┘
```

**Optional KPI (amount still to collect from clients):** show `stats.totalToReceiveFromClients` in UI if product wants a sixth metric — combines open invoice balance plus unpaid schedule stages (`totalScheduledToReceiveFromClients`).

---

## 1. Top KPI cards (`data.stats`)

| Figma label | JSON field | Subtext suggestion |
|-------------|------------|-------------------|
| Total Payments | `totalPayments` | Total recorded |
| Total Received | `totalReceived` | Received amount |
| Total Outstanding | `totalOutstanding` | Outstanding amount |
| Total Overdue | `totalOverdue` | Overdue amount |
| Total Overdue (YTD) | `totalOverdueYTD` | Sub: `YTD: $…` use same field; badge `%` → `totalOverdueYTDPct` |

Additional fields (same object, use if needed):

| Field | Use |
|-------|-----|
| `totalInvoicedToClients` | Same basis as `totalPayments` (explicit naming) |
| `totalToReceiveFromClients` | Outstanding + unpaid payment-schedule stages |
| `totalScheduledToReceiveFromClients` | Unpaid stages only |
| `scheduledStageCount` | Count of unpaid schedule stages |
| `balanceDueOnInvoices` | `totalInvoicedToClients − totalReceived` |

**Definitions**

- **Total Payments:** Sum of customer invoice `totalAmount` in date range; excludes `draft` and `cancelled`.
- **Total Received:** Sum where `status === 'paid'`.
- **Total Outstanding:** Sum where `status` is `sent` or `overdue`.
- **Total Overdue:** Outstanding invoices whose due date is before now (`dueDate` or `date + daysToPay`).
- **Total Overdue (YTD):** Overdue amount with due date in the current calendar year; `totalOverdueYTDPct` = share of `totalPayments` in range.

---

## 2. Payment status distribution (donut)

**Field:** `data.statusDistribution[]`

| JSON field | Donut UI |
|------------|----------|
| `statusLabel` | Segment label (`Paid`, `Pending`, `Overdue`, …) |
| `paymentCount` | Count in center or legend (“N Total Payments”) |
| `amount` | Dollar value per segment |
| `percent` | Segment size (0–100) |
| `clientCount` | Distinct clients (legend “X clients” if shown) |

Example segment:

```json
{
  "status": "paid",
  "statusLabel": "Paid",
  "clientCount": 2,
  "paymentCount": 2,
  "amount": 12490200,
  "percent": 100,
  "countSharePct": 100
}
```

---

## 3. Revenue trend (bar chart)

**Field:** `data.revenueTrendChart[]`

| JSON field | Bar series |
|------------|------------|
| `label` | X-axis (e.g. `"Jul 26"`, `"Aug 26"`) |
| `received` | **Blue** — paid invoice totals in that month |
| `projected` | **Purple** — non-paid, non-cancelled customer invoice totals in that month |

Do not use `revenueTrend` in UI (raw aggregation); use `revenueTrendChart` only.

---

## 4. Expected payments (aging buckets)

**Field:** `data.expectedPayments[]`

Fixed order: `0-30`, `31-60`, `61-90`, `90+` (days until due on open customer invoices).

| JSON field | UI |
|------------|-----|
| `bucket` | Row label |
| `amount` | Dollar amount |
| `percent` | Progress bar width (sums to 100 across buckets) |

---

## 5. Stage-wise payment progress (two gauges)

**Field:** `data.stageWise[]` — always two entries:

| Index | `_id` | `key` | Gauge |
|-------|-------|-------|--------|
| 0 | Initial Payment | `initial` | First stage of each project payment schedule |
| 1 | Final Payment | `final` | Last stage of each schedule |

| JSON field | UI |
|------------|-----|
| `progressPct` | Circular gauge % |
| `clientCount` | Clients with that stage paid |
| `amount` | Dollar amount collected on that stage (paid stages only) |

---

## 6. Recent payments table

**Field:** `data.recentPayments[]`

| Figma column | JSON field |
|--------------|------------|
| DATE | `date` (ISO — format in local TZ) |
| CLIENT / PROJECT | `clientProjectLabel` or `clientName` + `projectName` |
| INVOICE / REFERENCE | `invoiceNumber` |
| AMOUNT | `amount` |
| RECEIVED | `received` (`totalAmount` if paid; else approved proof amount or `0`) |
| PAYMENT MODE | `paymentMode` (`"N/A"` when null) |
| STATUS | `statusLabel` (badge color from `status`: `paid`, `sent`, `overdue`, …) |

Pagination:

| Field | Meaning |
|-------|---------|
| `recentPaymentsPage` | Current page |
| `recentPaymentsLimit` | Page size |
| `recentPaymentsTotal` | Total rows |

Row example:

```json
{
  "id": "67a1b2c3d4e5f6789012345a",
  "date": "2026-08-07T00:00:00.000Z",
  "clientName": "Jacob",
  "projectName": "Customer",
  "clientProjectLabel": "Jacob, Customer",
  "invoiceNumber": "INV-0002",
  "amount": 6245100,
  "received": 6245100,
  "paymentMode": "N/A",
  "status": "paid",
  "statusLabel": "Paid"
}
```

---

## 7. Export button

Same filters as the dashboard date range (recent list uses dashboard logic; export includes summary + recent sheet).

```http
GET /api/admin/financials/payments-dashboard/export?startDate=2026-01-01&endDate=2026-12-31 HTTP/1.1
Authorization: Bearer <token>
```

**Response:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`  
**Filename:** `payments-dashboard.xlsx` (Summary + Recent Payments worksheets).

---

## 8. Full response example

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalPayments": 12490200,
      "totalInvoicedToClients": 12490200,
      "totalReceived": 12490200,
      "totalOutstanding": 0,
      "totalOverdue": 0,
      "totalOverdueYTD": 0,
      "totalOverdueYTDPct": 0,
      "totalToReceiveFromClients": 200000,
      "totalScheduledToReceiveFromClients": 200000,
      "scheduledStageCount": 4,
      "balanceDueOnInvoices": 0
    },
    "statusDistribution": [],
    "revenueTrendChart": [],
    "revenueTrend": [],
    "expectedPayments": [],
    "stageWise": [],
    "recentPayments": [],
    "recentPaymentsPage": 1,
    "recentPaymentsLimit": 10,
    "recentPaymentsTotal": 0
  }
}
```

---

## 9. Errors

| HTTP | When |
|------|------|
| `401` | Missing or invalid token |
| `403` | User is not `admin` |

Standard error body matches other admin APIs.

---

## 10. Postman

Collection: `admin-panel.postman_collection.json`  
Folder: **Financials → Payments dashboard**  
Requests: `GET …/payments-dashboard`, `GET …/payments-dashboard/export`
