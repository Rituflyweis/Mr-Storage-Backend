# Account Tax & Avalara — full API handoff (req/res)

**Date:** 2026-10-19  
**Audience:** Frontend (Account panel + any staff invoice flows that affect tax)  
**Prod base:** `https://mr-storage-backend-025k.onrender.com`  
**Account tax base path:** `/api/account/financial-extra`  
**Auth:** `Authorization: Bearer <token>` · roles **`account`**, **`admin`**

This document is the **single integration reference** after the tax/Avalara gap work: **what changed**, **every endpoint**, and **copy-paste request/response examples**.

**Figma screen map (same APIs, UI wiring):** [`frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md`](./frontend-account-tax-filing-figma-integration-handoff-2026-10-19.md)

---

## 1. What changed (frontend impact)

| Area | Before | Now |
|------|--------|-----|
| Pending/history rows | Raw `Tax` Mongo docs | **Enriched rows** with `status: { code, label, tone }`, `daysUntilDueLabel`, `salesTaxRateLabel` |
| State / project tables | Plain aggregates | **`status` object**, **`taxRecordId`** (state + project), `salesTaxRateLabel` (derived), `showPayTax` (project), **`meta` / `lastSynced`** on project list |
| Pay Tax / Pay Now | Not implemented | **`POST .../approve`** (Avalara) or **`POST .../pay`** (local) |
| Detail modal | N/A | **`GET .../detail`** with `breakdown`, `payNow`, `recentActivity` |
| Sync Now | No-op timestamp | **Rolls up committed invoices**; with Returns env → **Avalara filings** |
| List responses | No context | Optional **`meta`** (`provider`, `syncState`, `lastSyncedAt`) |
| Compliance empty state | N/A | **`GET /tax-compliance/status`** |
| Legacy `/api/account/tax` | Manual CRUD | Still exists; **do not use for Figma** — use `financial-extra` |
| Customer invoices (staff) | Tax from quote only | **`avalara`**, **`shipToAddress`**, **`taxCollected`** on invoice after **sent** |
| Leads / projects | `location` string only | **`installAddress`** `{ line1, city, state, postalCode, country }` for tax jurisdiction |

---

## 2. Conventions

### Envelope

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Error:

```json
{
  "success": false,
  "message": "Tax record not found"
}
```

### Status object (use for all pills/badges)

```json
{
  "code": "due_soon",
  "label": "Due Soon",
  "tone": "warning"
}
```

| `tone` | Suggested UI |
|--------|----------------|
| `warning` | Orange (Due Soon, Payment Due) |
| `neutral` | Blue-gray (Pending) |
| `success` | Green (No tax due, Filed) |
| `info` | Teal (Filed) |

### Amounts

Numbers in **USD** (server `number`). Format lakhs/currency in UI only.

---

## 3. Compliance & sync

### 3.1 Compliance status (onboarding / empty UI)

```http
GET /api/account/financial-extra/tax-compliance/status
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
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

| Field | UI |
|-------|-----|
| `syncState` | `not_configured` \| `empty` \| `synced` \| `error` |
| `lastSyncedAt` | “Last Synced: …” on State / Project Wise |
| `canSync` | Enable **Sync Now** |
| `message` | Banner when empty |

### 3.2 Sync Now (all three tax pages)

```http
POST /api/account/financial-extra/state-wise-tax/sync
Authorization: Bearer <token>
Content-Type: application/json
```

**Body:** none (or `{}`)

**Response 200 — invoice rollup (dev / no Returns)**

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

**Response 200 — Avalara Returns (when env configured)**

```json
{
  "success": true,
  "message": "Tax data synced successfully",
  "data": {
    "syncedAt": "2026-03-19T10:30:00.000Z",
    "regions": 8,
    "projects": 0,
    "provider": "avalara",
    "mode": "returns_graphql"
  }
}
```

**Frontend:** After sync, refetch stats + table on the active page.

---

## 4. Tax & Filling (main page)

### 4.1 KPI cards

```http
GET /api/account/financial-extra/tax-filing/stats?state=TX&projectId=6ac4e5e6570533c2c601ed40&clientId=
Authorization: Bearer <token>
```

| Query | Type | Notes |
|-------|------|--------|
| `state` | string | e.g. `TX` |
| `projectId` | MongoId | Lead id |
| `clientId` | MongoId | Customer id |
| `search` | string | Optional |

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalSalesTaxable": {
      "value": 1245600,
      "pctChangeFromLastMonth": 5.62
    },
    "totalSalesTaxCollected": {
      "value": 82500,
      "pctChangeFromLastMonth": 11.4
    },
    "taxPayableByStates": {
      "value": 14650
    },
    "fileVsUnfiledTax": {
      "filed": 300000,
      "unfiled": 14650
    }
  }
}
```

### 4.2 Filter dropdowns

```http
GET /api/account/financial-extra/tax-filing/filters
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "states": ["AZ", "CA", "TX"],
    "projects": [
      {
        "leadId": "6ac4e5e6570533c2c601ed40",
        "projectName": "Riverside A",
        "jobId": "PRO-042"
      }
    ],
    "clients": [
      {
        "customerId": "6aadb0a0464b5c58eb1a0420",
        "name": "Acme Industries"
      }
    ]
  }
}
```

### 4.3 Pending + Filing history (one call)

```http
GET /api/account/financial-extra/tax-filing?page=1&limit=10&state=&projectId=&clientId=&startDate=2025-03-24&endDate=2025-03-31&search=
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalTaxable": 1245600,
      "totalCollected": 82500,
      "taxPayableByStates": 3,
      "filed": 2,
      "unfiled": 3
    },
    "pendingFiling": [
      {
        "_id": "67f1a2b3c4d5e6f7a8b9c0d1",
        "state": "TX",
        "stateLabel": "TX",
        "salesTaxRateLabel": "6.25% Sales Tax",
        "filingPeriod": "May 1 – May 31 2025",
        "filingFrequency": "Monthly",
        "dueDate": "2025-06-20T00:00:00.000Z",
        "daysUntilDue": 32,
        "daysUntilDueLabel": "In 32 Days",
        "taxDue": 14650,
        "payable": 14650,
        "status": {
          "code": "due_soon",
          "label": "Due Soon",
          "tone": "warning"
        },
        "leadId": null,
        "projectName": "",
        "jobId": "",
        "customerName": ""
      }
    ],
    "filingHistory": [
      {
        "_id": "67f1a2b3c4d5e6f7a8b9c0d2",
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
        "status": {
          "code": "filed",
          "label": "Filed",
          "tone": "success"
        }
      }
    ],
    "page": 1,
    "limit": 10,
    "meta": {
      "provider": "local",
      "complianceStatus": "LOCAL_DEV",
      "lastSyncedAt": "2026-03-19T10:30:00.000Z",
      "syncState": "synced",
      "canSync": true,
      "message": ""
    }
  }
}
```

**Tabs:** bind **Pending** → `pendingFiling`; **Filing History** → `filingHistory`.

### 4.4 Export

```http
GET /api/account/financial-extra/tax-filing/export?startDate=2025-03-24&endDate=2025-03-31
Authorization: Bearer <token>
```

→ Excel file (blob), not JSON.

---

## 5. Modals — detail, prepare, pay, receipt

### 5.1 Review Details / Texas Tax Details modal

```http
GET /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/detail
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "detail": {
      "_id": "67f1a2b3c4d5e6f7a8b9c0d1",
      "state": "TX",
      "stateLabel": "TX Tax Details",
      "uiStatus": {
        "code": "payment_due",
        "label": "Payment Due",
        "tone": "warning"
      },
      "filingPeriod": "May 1 – May 31 2025",
      "filingPeriodRange": {
        "start": "2025-05-01T00:00:00.000Z",
        "end": "2025-05-31T00:00:00.000Z"
      },
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
        {
          "at": "2026-05-19T00:00:00.000Z",
          "type": "payment",
          "amount": 46013.25,
          "label": "46013.25 Paid"
        }
      ]
    },
    "avalara": {
      "filingId": "1416389",
      "returnsConfigured": true,
      "source": "avalara"
    }
  }
}
```

### 5.2 Prepare Filing

```http
GET /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/prepare
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "tax": {
      "_id": "67f1a2b3c4d5e6f7a8b9c0d1",
      "state": "TX",
      "status": "pending",
      "taxDue": 14650,
      "payable": 14650,
      "taxCollected": 46013.25,
      "taxableSales": 520000,
      "source": "sync"
    },
    "detail": { },
    "message": "Filing details ready for review"
  }
}
```

(`detail` same shape as §5.1.)

### 5.3 Pay Tax — production (Avalara approve)

```http
POST /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

**Response 200 — maps to “Payment Submitted Successfully” modal**

```json
{
  "success": true,
  "message": "Filing approved via Avalara",
  "data": {
    "payment": {
      "amountPaid": 14650,
      "filingPeriod": {
        "start": "2025-05-01T00:00:00.000Z",
        "end": "2025-05-31T00:00:00.000Z"
      },
      "paymentMethod": "ACH ending in 4851",
      "confirmationNumber": "Tx-TX-1416389",
      "status": "processing",
      "estimatedSettlement": "1-3 business days",
      "notificationEmail": "accounts@acmeindustries.com"
    },
    "tax": {
      "_id": "67f1a2b3c4d5e6f7a8b9c0d1",
      "status": "paid",
      "paymentStatus": "processing",
      "confirmationNumber": "Tx-TX-1416389",
      "providerMethod": "Avalara API"
    },
    "avalara": {
      "ok": true,
      "regionRow": {
        "filingId": 1416389,
        "status": "PREPARINGTOFILE",
        "region": "TX",
        "taxAmount": 14650
      }
    }
  }
}
```

If Returns env is **missing**, `approve` may return **400** with Avalara error; use **`/pay`** in staging.

### 5.4 Pay Now — local / staging (no Returns)

```http
POST /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/pay
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentMethod": "ACH ending in 4851",
  "notificationEmail": "accounts@acmeindustries.com"
}
```

**Response 200** — same `data.payment` shape as §5.3; `avalara` may be null.

### 5.5 Receipt / Download

```http
GET /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/receipt
Authorization: Bearer <token>
```

**JSON (default) — Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "confirmationNumber": "Tx-2025-0619-8421",
    "amountPaid": 14650,
    "paidAt": "2026-03-19T11:00:00.000Z",
    "state": "TX",
    "method": "Avalara API",
    "paymentMethod": "ACH ending in 4851",
    "receipt": {
      "confirmationNumber": "Tx-2025-0619-8421",
      "receiptDate": "2026-03-19T11:00:00.000Z"
    },
    "download": {
      "format": "pdf",
      "urlHint": "GET .../receipt?format=pdf"
    }
  }
}
```

**PDF**

```http
GET /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/receipt?format=pdf
```

Returns `application/pdf` attachment. Pay/approve also emails this PDF when `notificationEmail` or saved `recipientEmail` is set and SendGrid is configured.

### 5.5b Manage Notifications (Figma deadline banner)

```http
GET /api/account/financial-extra/tax-filing/notification-settings
PUT /api/account/financial-extra/tax-filing/notification-settings
```

**PUT body (all optional)**

```json
{
  "emailReminders": true,
  "deadlineAlerts": true,
  "daysBeforeDue": 7,
  "recipientEmail": "accounts@acmeindustries.com"
}
```

### 5.6 Legacy mark filed (no payment flow)

```http
PUT /api/account/financial-extra/tax-filing/67f1a2b3c4d5e6f7a8b9c0d1/file
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Tax filed successfully",
  "data": {
    "tax": {
      "_id": "67f1a2b3c4d5e6f7a8b9c0d1",
      "status": "paid",
      "paidAt": "2026-03-19T11:05:00.000Z"
    }
  }
}
```

Prefer **`/approve`** or **`/pay`** for Figma Pay flows.

---

## 6. State Wise Tax

### 6.1 KPI row

```http
GET /api/account/financial-extra/state-wise-tax/stats?projectId=&startDate=2025-03-24&endDate=2025-03-31
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalTaxCollected": {
      "value": 1245600,
      "pctChangeFromLastMonth": 5.62
    },
    "totalPaid": {
      "value": 1500000,
      "pctChangeFromLastMonth": 11.4
    },
    "totalPayable": {
      "value": 14650,
      "pctChangeFromLastMonth": 8.52
    },
    "pendingFilingStates": {
      "count": 2,
      "label": "Requires Filing"
    },
    "nextFilingDue": {
      "date": "2025-06-20T00:00:00.000Z",
      "state": "TX"
    }
  }
}
```

### 6.2 Table

```http
GET /api/account/financial-extra/state-wise-tax?projectId=&startDate=2025-03-24&endDate=2025-03-31
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "stats": {
      "totalTaxCollected": 1245600,
      "totalPaid": 1500000,
      "totalPayable": 14650,
      "pendingFilingStates": 2,
      "nextFilingDue": "2025-06-20T00:00:00.000Z"
    },
    "stateOverview": [
      {
        "state": "TX",
        "stateLabel": "TX",
        "salesTaxRateLabel": "6.25% Sales Tax",
        "taxCollected": 450000,
        "taxableSales": 450000,
        "paidFiled": 435350,
        "payable": 14650,
        "dueDate": "2025-06-20T00:00:00.000Z",
        "status": {
          "code": "payment_due",
          "label": "Payment Due",
          "tone": "warning"
        },
        "taxRecordId": "67f1a2b3c4d5e6f7a8b9c0d1"
      }
    ],
    "lastSynced": "2026-03-19T10:30:00.000Z",
    "meta": {
      "provider": "local",
      "syncState": "synced",
      "canSync": true
    }
  }
}
```

| Action | API |
|--------|-----|
| Pay Tax | `POST .../tax-filing/{taxRecordId}/approve` |
| View Details | `GET .../tax-filing/{taxRecordId}/detail` |

### 6.3 Upcoming filing deadlines

```http
GET /api/account/financial-extra/state-wise-tax/upcoming-deadlines?projectId=&limit=6&scope=state
GET /api/account/financial-extra/state-wise-tax/upcoming-deadlines?scope=project&limit=6
Authorization: Bearer <token>
```

**Response 200** — includes `meta` (sync/compliance). Each deadline has `taxRecordId` (same as `_id`), and project-scoped rows include `projectName`, `leadId`, `jobId`, `location`, `payable`.

Use `taxRecordId` for detail/pay when opening from a deadline card.

### 6.4 Export

```http
GET /api/account/financial-extra/state-wise-tax/export?startDate=&endDate=
Authorization: Bearer <token>
```

→ Excel blob.

---

## 7. Project Wise Tax

### 7.1 KPI row

```http
GET /api/account/financial-extra/project-wise-tax/stats?projectId=&startDate=2025-03-24&endDate=2025-03-31
Authorization: Bearer <token>
```

**Response 200** — same five-card shape as state-wise (`totalTaxCollected`, `totalPaid`, `totalPayable`, `pendingFiling`, `nextFilingDue` with `location` instead of `state` on next due).

### 7.2 Table (paginated)

```http
GET /api/account/financial-extra/project-wise-tax?page=1&limit=10&projectId=&startDate=2025-03-24&endDate=2025-03-31
Authorization: Bearer <token>
```

**Response 200**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "leadId": "6ac4e5e6570533c2c601ed40",
        "projectName": "Riverside A",
        "jobId": "PRO-042",
        "location": "Texas",
        "customerName": "Jane Doe",
        "taxCollected": 450000,
        "taxableSales": 450000,
        "paidFiled": 435350,
        "payable": 14650,
        "dueDate": "2025-06-20T00:00:00.000Z",
        "status": {
          "code": "payment_due",
          "label": "Payment Due",
          "tone": "warning"
        },
        "salesTaxRateLabel": "6.25% Sales Tax",
        "taxRecordId": "67f1a2b3c4d5e6f7a8b9c0d1",
        "showPayTax": true
      }
    ],
    "total": 15,
    "page": 1,
    "limit": 10,
    "lastSynced": "2026-03-19T10:30:00.000Z",
    "meta": { "lastSyncedAt": "2026-03-19T10:30:00.000Z", "provider": "local" }
  }
}
```

**Pay / Details:** use `taxRecordId` on the row (fallback: `GET tax-filing?projectId={leadId}&limit=1`).

**Sync:** same as §3.2 (`POST state-wise-tax/sync`).

### 7.3 Export

```http
GET /api/account/financial-extra/project-wise-tax/export
Authorization: Bearer <token>
```

---

## 8. Related API changes (not on tax pages)

These affect **tax collected** numbers after sync.

### 8.1 Lead / project — install address (tax jurisdiction)

**Customer create project** — already sends `fullAddress`, `city`, `state`, `pincode`; server stores **`installAddress`**.

**Lead create/update (admin/sales)** — optional body:

```json
{
  "installAddress": {
    "line1": "100 Industrial Blvd",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US"
  }
}
```

Or: `line1`, `city`, `state`, `pincode` on lead payload.

**Project GET** — include when present:

```json
{
  "installAddress": {
    "line1": "100 Industrial Blvd",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701",
    "country": "US"
  }
}
```

Incomplete address → invoice tax calc may skip or return zero until fixed.

### 8.2 Invoice (staff) — after send

When invoice moves to **`sent`**, response may include:

```json
{
  "invoice": {
    "_id": "6ad57e384381c5b22a13652b",
    "status": "sent",
    "tax": 8250,
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
      "totalTax": 8250,
      "totalTaxable": 100000,
      "committedAt": "2026-03-19T10:00:00.000Z"
    }
  }
}
```

**Account panel:** tax KPIs update after **Sync Now**, not immediately on send (unless you call sync in background).

---

## 9. Frontend migration checklist

- [ ] Replace raw `tax.status === 'pending'` pills with **`row.status.label`** / **`tone`**
- [ ] Pending tab → **`pendingFiling`**; History → **`filingHistory`**
- [ ] Pay buttons → **`POST .../approve`** (prod) or **`.../pay`** (staging)
- [ ] Success modal → bind **`data.payment`**
- [ ] State Pay Tax → use **`taxRecordId`**
- [ ] Project Pay Tax → resolve **`taxId`** via **`tax-filing?projectId=`**
- [ ] Sync strip → **`POST state-wise-tax/sync`** then refetch
- [ ] Empty state → **`GET tax-compliance/status`**
- [ ] Show **`meta.lastSyncedAt`** when present
- [ ] Stop using **`/api/account/tax`** for Figma tax pages
- [ ] Export buttons → blob download (Excel)

---

## 10. Route index

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

---

## 11. Errors (common)

| HTTP | `message` | UI |
|------|-----------|-----|
| 401 | Unauthorized | Re-login |
| 403 | Forbidden | Wrong role |
| 404 | Tax record not found | Stale id after sync |
| 400 | Tax filing already paid | Disable Pay |
| 400 | Avalara approve failed | Show error; retry or use support |
