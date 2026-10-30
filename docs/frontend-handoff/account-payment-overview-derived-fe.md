# Account — Payment Overview (derived from quotation + paid invoices)

**Status:** Ready  
**Date:** 29 Oct 2026  
**Auth:** `Authorization: Bearer <account|admin JWT>`  
**Base:** `/api/account/payments`

Response **shape is unchanged**. Calculation source changed: no more manual “Add Order Payment” / `WIPProfit` rows.

---

## 1. What changed

| Before | After |
|--------|--------|
| Manual WIP row (`orderValue`, deposit/progress/final typed in) | Auto from **quotation** + **paid customer invoices** |
| Only projects with a created WIP | All projects in **PO / plant financial scope** |
| Create/update WIP via POST/PUT | **Disabled** (400) — mark invoices paid instead |

---

## 2. Formulas (same field names)

Scope: leads with `isRaisedToPO` **or** lifecycle in PO/plant stages (same financial scope as other account finance screens).

| Field | Formula |
|-------|---------|
| **orderValue** | Latest quotation amount for the lead. Prefer linked estimate `revisedContractTotal` (after change orders), else `quotation.finalPrice` / `basePrice` / estimate grand total, else `lead.quoteValue` |
| **paymentBreakdown.deposit / progress / final** | Sum of **paid** customer invoices, bucketed by payment-schedule stage name (or invoice description): deposit / progress / final heuristics |
| **totalReceived** | `deposit + progress + final` (all paid customer invoices) |
| **outstanding** | `max(0, orderValue − totalReceived)` |
| **currentCost** | Σ active `Expense.amount` for lead; if 0, quotation/estimate COGS |
| **profit** (`totalWipProfit`) | `totalReceived − currentCost` |
| **marginPct** | `(profit / orderValue) × 100` |
| **status** | `Completed` if received & outstanding 0; `Started` if any received; else `In progress` |

Vendor / freight invoices are excluded. Cancelled invoices excluded. Only `status === 'paid'` counts as received.

---

## 3. Endpoints (unchanged paths)

| Use | Method | Path |
|-----|--------|------|
| KPI cards | `GET` | `/stats` or `/overview` |
| Table | `GET` | `/orders` |
| Detail | `GET` | `/orders/:orderId` — **`orderId` = `leadId`** (also accepts `jobId`) |
| Export | `GET` | `/orders/export` |
| Dropdown | `GET` | `/order-options` |
| Create / update | `POST`/`PUT` | `/orders` → **400** with explanation |

Query params still work: `search`, `status`, `period` / `startDate` / `endDate`, `page`, `limit`.

Date filter: scopes **Received** KPI to invoices paid in range (`paidAt`, else `date`). Order value / outstanding stay all-time for listed PO projects.

---

## 4. Response example (unchanged structure)

```json
{
  "success": true,
  "data": {
    "stats": {
      "totalOrderValue": 2604848,
      "totalReceived": 627100,
      "outstanding": 1977748,
      "totalWipProfit": 417100
    },
    "orders": [
      {
        "wipId": "<leadId>",
        "leadId": "<leadId>",
        "orderDetails": {
          "customerName": "Lucas1",
          "orderId": "PRO-002",
          "quoteOrderId": "PRO-002",
          "location": "…"
        },
        "orderValue": 614248,
        "currentCost": 0,
        "paymentBreakdown": { "deposit": 0, "progress": 30000, "final": 500000 },
        "outstanding": 84248,
        "profit": 530000,
        "marginPct": 86.28,
        "status": "Started",
        "statusCode": "started",
        "totalReceived": 530000
      }
    ],
    "total": 4,
    "page": 1,
    "limit": 20
  }
}
```

`wipId` is set to **`leadId`** for FE key stability (no separate WIP document).

Detail adds `payments[]` from paid invoices (`invoiceId`, `invoiceNumber`, `amount`, `paymentType`, `paidAt`).

---

## 5. FE checklist

- [ ] Keep binding the same keys (`stats.*`, `orders[]`, breakdown fields)
- [ ] Hide or disable **+ Add Order Payment** (POST returns 400)
- [ ] Open detail / edit with **`leadId`** (same as `wipId` in list)
- [ ] To change Received: mark customer invoices **paid** (or unpay) — overview refreshes from that
- [ ] Change orders update **orderValue** when estimate `revisedContractTotal` is synced (no manual order-value edit)

---

## 6. Why this vs Project-wise Income

| Screen | Source |
|--------|--------|
| **Payment Overview** | Quotation contract value + paid invoices (per PO project) |
| **Project-wise Income** | All customer invoice amounts (billed), paid/pending/overdue |

They can still differ (quotation vs sum of invoices; pending invoices count in Income Total but not in Payment Received).
