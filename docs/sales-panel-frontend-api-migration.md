# Sales Panel — Frontend API Migration Guide

**Audience:** Frontend team (existing API integration)  
**Backend specs:** [Step 1 — Dashboard + Customers](./sales-panel-api-changes-step1-dashboard-customers.md) · [Step 2 — Leads, Follow-ups, Invoices](./sales-panel-api-changes-step2-leads-followups.md)  
**Status:** Backend changes are **planned** — coordinate rollout with backend deploy.

---

## 1. Conventions (unchanged)

- **Base path:** `/api/sales/*` (plus shared `/api/invoices`, `/api/upload`, `/api/auth`)
- **Auth:** `Authorization: Bearer <accessToken>` on all sales routes
- **Wrapper:**

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

- **Customer display name:** use `firstName` only — do **not** use `lastName` in the sales UI
- **Project ID in UI:** use `projectId` in API responses (= lead `jobId`, e.g. `PRO-003`). Use `_id` only for navigation/API paths (`:leadId`, `:customerId`)
- **Phone:** always `phone: { number, countryCode }` — not a flat string

---

## 2. Quick action list

### 2.1 New endpoints (wire these)

| Method | Endpoint | UI / page |
|--------|----------|-----------|
| PUT | `/api/sales/customers/:customerId` | Customer detail — edit customer |
| GET | `/api/sales/leads/with-quotations` | **Quotes section** (lead list) |
| GET | `/api/sales/leads/with-po` | **PO section** (lead list) |
| GET | `/api/sales/leads/:leadId/activity` | Lead detail — activity tab (paginated) |
| GET | `/api/sales/leads/:leadId/followups` | Lead detail — follow-ups tab (paginated) |
| GET | `/api/sales/followups/ai-script/generate` | Follow-ups — AI script generator |
| GET | `/api/sales/profile` | Settings / profile |
| PUT | `/api/sales/profile` | Settings / profile |
| GET | `/api/sales/invoices/stats` | Invoices page — stat cards |
| GET | `/api/sales/invoices` | Invoices page — table |

### 2.2 Stop using / migrate away

| Old integration | Replace with |
|-----------------|----------------|
| `GET /api/sales/quotations` for **Quotes page** | `GET /api/sales/leads/with-quotations` |
| `GET /api/sales/po-orders` for **PO page** | `GET /api/sales/leads/with-po` |
| Customer list field `enquiryFor` | **Remove** — not in API |
| Lead list `nextFollowUp` object | `nextFollowUpDate` (string or null) |
| Lead stats `totalLeads` | `leadsInPipeline` |
| Lead stats `escalationsPending` | `escalations` |
| `customer.location` for address on sales screens | `customer.address` |

### 2.3 Same URL, update parsing (breaking or behaviour)

See §4 per endpoint.

---

## 3. Global field mapping

| UI label | API field | Notes |
|----------|-----------|--------|
| Customer name | `firstName` | Not `customerName` except AI scripts (`customerName` there = `firstName`) |
| Project ID | `projectId` | Not `jobId` in UI (both may appear on detail; prefer `projectId`) |
| Customer status | `isActive` | Query `?isActive=true\|false` on customer list |
| Project status (customer projects) | `isActive` | `true` = not terminated |
| Invoice due date | `dueDate` on list row | `invoice.date + daysToPay` days |
| Raise PO button | `lead.poNumber == null` && `!isRaisedToPO` | After backend deploy |

---

## 4. Changes by page

---

### 4.1 Dashboard

#### `GET /api/sales/dashboard/stats`

| | |
|---|---|
| **Query** | `?startDate=&endDate=` (unchanged) |
| **Breaking** | No — same keys |
| **Behaviour** | `followUpPending` now counts by **follow-up due date**, not when the follow-up was created. Counts may change when a date range is set. |

**Response `data` (unchanged keys):**

```json
{
  "totalLeads": 24,
  "leadsClosed": 5,
  "followUpPending": 7,
  "escalationsPending": 1
}
```

---

### 4.2 Customers

#### `GET /api/sales/customers/stats`

| | |
|---|---|
| **Query (NEW)** | `?startDate=&endDate=` optional — filters by customer `createdAt` |
| **Response** | Same keys: `total`, `active`, `newThisMonth`, `returning` |

When date range is sent, treat `newThisMonth` as **“new in selected period”** (consider relabelling in UI).

---

#### `GET /api/sales/customers`

| | |
|---|---|
| **Query (NEW)** | `?startDate=&endDate=` on `Customer.createdAt` |
| **Query (existing)** | `?search=`, `?isActive=true\|false`, `?page=`, `?limit=` |
| **Response** | Shape **unchanged** |

**Row (unchanged):**

```ts
{
  _id: string
  customerId: string      // CUS-00042
  firstName: string
  email: string
  phone: { number: string; countryCode: string }
  source: string
  isActive: boolean
  createdAt: string
  totalProjects: number
}
```

**FE:** Remove any `enquiryFor` column/filter.

---

#### `GET /api/sales/customers/:customerId`

| | |
|---|---|
| **Response `data.customer` (NEW fields)** | `photo`, `address` |

```diff
  customer: {
    ...
+   photo: string | null
+   address: string
  }
  financials: { totalPaid, pendingPayment, totalInvoices, revenueGenerated }  // unchanged
```

Use `address`, not `location`, on sales customer detail.

---

#### `PUT /api/sales/customers/:customerId` — **NEW**

**Request (all optional, ≥1 required):**

```json
{
  "firstName": "Jane",
  "email": "jane@example.com",
  "phone": { "number": "9876543210", "countryCode": "+91" },
  "photo": "https://...",
  "address": "123 Main St",
  "isActive": true
}
```

**Response `data`:**

```json
{ "customer": { /* full customer object incl. photo, address, updatedAt */ } }
```

---

#### `GET /api/sales/customers/:customerId/projects`

| | |
|---|---|
| **Response per project (NEW fields)** | `projectId`, `isActive` |

```diff
  projects: [{
    _id: string              // use for route to lead detail
+   projectId: string        // PRO-003 — show in "Project ID" column
    projectName: string
    numberOfBuildings: number
    lifecycleStatus: string
+   isActive: boolean        // true = project not terminated
    quoteValue: number
    budget: { totalBudget, expectedProfit } | null
    createdAt: string
  }]
```

---

#### `POST /api/sales/customers/:customerId/projects`

| | |
|---|---|
| **Request (NEW optional fields)** | `doors`, `windows`, `insulation` (numbers) |
| **Response** | `data.lead` includes `jobId`, `numDoors`, `numWindows`, `numInsulation` when sent |

---

### 4.3 Leads — main list & stats

#### `GET /api/sales/leads/stats`

| | |
|---|---|
| **Query** | `?startDate=&endDate=` |
| **Breaking** | **Yes — rename keys** |

| Old `data` key | New `data` key |
|----------------|----------------|
| `totalLeads` | `leadsInPipeline` |
| `leadsClosed` | `leadsClosed` (same) |
| `followUpPending` | `followUpPending` (same key; date logic fixed) |
| `escalationsPending` | `escalations` |

```json
{
  "leadsInPipeline": 18,
  "leadsClosed": 5,
  "followUpPending": 7,
  "escalations": 1
}
```

---

#### `GET /api/sales/leads`

| | |
|---|---|
| **Query (NEW)** | `?minQuoteValue=`, `?maxQuoteValue=` |
| **Query (existing)** | `?startDate=`, `?endDate=`, `?buildingType=`, `?lifecycleStatus=`, `?search=`, `?isQuoteReady=`, `?page=`, `?limit=` |
| **Breaking** | **Yes — row shape simplified** |

**Remove from list parsing:**

- `customerId` object on row  
- `leadScoring`  
- `nextFollowUp` nested object  

**New row shape `data.leads[]`:**

```ts
{
  _id: string
  projectId: string              // PRO-003
  projectName: string
  location: string
  lifecycleStatus: string
  quoteValue: number
  nextFollowUpDate: string | null   // was nextFollowUp.followUpDate
  quotationCreated: boolean
  isQuoteReady: boolean
  isRaisedToPO: boolean
  poNumber: string | null
}
```

---

#### `POST /api/sales/leads/:leadId/escalate` — no change

```json
// Request
{ "note": "string" }

// Response data
{ "escalation": { "_id", "note", "status", "createdAt", ... } }
```

---

#### `GET /api/sales/leads/:leadId/detail`

| | |
|---|---|
| **Breaking / additive** | Several new top-level and nested fields |

```diff
  data: {
    lead: {
+     projectId: string          // alias of jobId
+     poNumber: string | null
      jobId, projectName, buildingType, quoteValue, lifecycleStatus,
      lifecycleHistory, location, createdAt, isQuoteReady, isRaisedToPO, notes, ...
    }
    customer: {
+     photo: string | null
+     address: string
      firstName, email, phone, customerId, ...
    }
+   assignedSales: { _id, name, email }    // was only ObjectId on lead.assignedSales
+   agreement: string | null               // contract document URL
    quotations: [...]
    auditLog: [...]
    activityLog: [...]                     // still returned; prefer paginated GET for large lists
    followUps: [...]                       // still returned; prefer paginated GET for large lists
    payments: {
      invoices: [...]
      totalPaid: number
      totalPending: number
+     totalOverdue: number
      totalInvoices: number
    }
    buildings, budget, recentMessages, rfq, shipments  // unchanged
  }
```

**FE:** Do not rely on a top-level `priority` field. Ignore `quotation.priorityLevel` unless product needs it.

---

#### `GET /api/sales/leads/:leadId/activity` — **NEW**

**Query:** `?page=1&limit=20&startDate=&endDate=`

**Response `data`:**

```ts
{
  entries: Array<{
    _id: string
    type: 'activity'
    action: string
    metadata: { activityType, notes, outcome? }
    performedBy: { _id, name }
    createdAt: string
  }>
  total: number
  page: number
  limit: number
}
```

#### `POST /api/sales/leads/:leadId/activity` — no change

```json
{ "activityType": "call|email|meeting|note", "notes": "", "outcome": "positive|neutral|negative|no_response" }
```

---

#### `GET /api/sales/leads/:leadId/followups` — **NEW**

**Query:** `?status=pending|completed`, `?upcomingOnly=true`, `?page=`, `?limit=`

**Response `data`:**

```ts
{
  followUps: Array<{
    _id: string
    followUpDate: string      // ISO with time
    modeOfContact: 'call' | 'email' | 'meeting'
    notes: string
    priority: string
    status: 'pending' | 'completed'
    completedAt: string | null
  }>
  total, page, limit
}
```

#### `POST /api/sales/followups` — behaviour change

Same body. **New:** `403` if lead is not assigned to current user.

```json
{
  "leadId": "mongoLeadId",
  "followUpDate": "2026-05-25T14:00:00.000Z",
  "modeOfContact": "call",
  "notes": "",
  "priority": "medium"
}
```

#### `PUT /api/sales/followups/:followUpId/complete` — no change

---

#### `POST /api/upload/leads/:leadId/agreement` — no change

After upload, read agreement URL from `GET .../detail` → `data.agreement`.

#### `POST /api/sales/leads/:leadId/po-order` — response unchanged

After success, `lead.poNumber` and `isRaisedToPO` update on list/detail.

#### `PUT /api/sales/leads/:leadId/lifecycle` — no change

---

### 4.4 Three section pages (all return `data.leads[]`)

| Page | Endpoint | Nested status object |
|------|----------|----------------------|
| Quotes | `GET /api/sales/leads/with-quotations` | `quotation` |
| Escalations | `GET /api/sales/leads/escalated` | `escalation` |
| PO | `GET /api/sales/leads/with-po` | `po` |

**Shared query:** `?page=&limit=&startDate=&endDate=&search=`

**Shared lead fields:**

```ts
_id, projectId, projectName, location, lifecycleStatus, quoteValue,
customerId: { _id, firstName, email }
```

---

#### Quotes — `GET /api/sales/leads/with-quotations` **NEW**

**Optional query:** `?quotationStatus=draft|sent|accepted|rejected`

```ts
// data.leads[]
{
  ...sharedLeadFields,
  quotation: {
    _id: string
    quoteNumber: string
    versionNumber: number
    status: 'draft' | 'sent' | 'accepted' | 'rejected'
    finalPrice: number
    createdAt: string
    sentAt: string | null
  }
}
```

**Migrate from:** `GET /api/sales/quotations` (`data.quotations[]`).

---

#### Escalations — `GET /api/sales/leads/escalated` **CHANGED**

**Query:** `?status=pending|resolved`, `?page=`, `?limit=`, `?startDate=`, `?endDate=`, `?search=`

```diff
  data: {
    leads: [{
+     projectId: string
+     location: string
      projectName, lifecycleStatus, quoteValue, customerId,
      escalation: { _id, note, status, createdAt }
    }]
    total: number
+   page: number
+   limit: number
  }
```

One row per lead (latest escalation). Was missing `projectId` / pagination in response.

---

#### PO — `GET /api/sales/leads/with-po` **NEW**

**Query:** `?poStatus=pending|approved|rejected`, pagination, date range, `search`

```ts
// data.leads[]
{
  ...sharedLeadFields,
  poNumber: string,
  po: {
    _id: string
    poNumber: string
    status: 'pending' | 'approved' | 'rejected'
    adminNotes: string
    createdAt: string
  }
}
```

**Migrate from:** `GET /api/sales/po-orders` (`data.orders[]`).

---

### 4.5 Follow-ups module

#### `GET /api/sales/followups/stats`

| | |
|---|---|
| **Query** | With `startDate`/`endDate`, filters by **followUpDate** (not createdAt) |
| **Response** | Unchanged: `{ total, upcoming, completed, overdue }` |

#### `GET /api/sales/followups/upcoming` — no shape change

Note: **excludes overdue** (only `followUpDate >= now`). Use `stats.overdue` for overdue counts.

#### `GET /api/sales/followups/communication-timeline` — no change

#### `GET /api/sales/leads/scored` — no change

#### `GET /api/sales/followups/ai-script/generate` — **NEW**

**Query:** `?startDate=&endDate=` (default: today)

```ts
// data
{
  scripts: Array<{
    followUpId: string
    leadId: {
      _id: string
      projectName: string
      projectId: string      // PRO-003 only — no other lead fields
    }
    customerName: string     // firstName
    script: string
  }>
  message?: string           // when scripts empty
}
```

#### `GET /api/sales/followups/ai-script` — no change (chat sessions)

#### `POST /api/sales/followups/ai-script` — no change (chat)

---

### 4.6 Profile — **NEW**

#### `GET /api/sales/profile`

```ts
// data.user
{
  _id: string
  name: string
  email: string
  phone: string
  role: 'sales'
  isActive: boolean
  createdAt: string
  updatedAt: string
}
```

#### `PUT /api/sales/profile`

```json
// Request
{ "name": "John Sales", "phone": "+91 9876543210" }

// Response data
{ "user": { /* same as GET */ } }
```

Password: `PUT /api/auth/change-password` (unchanged).

---

### 4.7 Invoices — **NEW**

#### `GET /api/sales/invoices/stats`

**Query:** `?startDate=&endDate=` (filters on `invoice.date`)

```ts
// data
{
  totalAmount: number
  totalPaid: number
  totalUnpaid: number
  totalOverdue: number
}
```

Do **not** use `GET /api/account/dashboard/invoice-stats` on sales panel (wrong role + count-based).

---

#### `GET /api/sales/invoices`

**Query:**

| Param | Purpose |
|-------|---------|
| `startDate`, `endDate` | Invoice date range |
| `status` | `draft` \| `sent` \| `paid` \| `overdue` \| `cancelled` |
| `leadId` | Filter by project (Mongo lead `_id`) |
| `search` | Customer name, `customerId`, project name, `projectId` |
| `page`, `limit` | Pagination |

**Response `data.invoices[]` — table row + full document:**

```ts
{
  invoiceNumber: string
  projectName: string
  projectId: string           // PRO-003
  customerId: string          // CUS-00042 display id
  customerName: string        // firstName
  dueDate: string | null
  amount: number              // totalAmount
  status: string
  invoice: {                  // FULL invoice document for drawer/detail
    _id: string
    invoiceNumber: string
    leadId: string
    customerId: string
    poNumber: string
    date: string
    daysToPay: number
    lineItems: []
    subtotal: number
    totalAmount: number
    status: string
    sentAt, paidAt, createdAt, updatedAt
    // ...all other invoice fields
  }
}
```

```ts
// data pagination
{ total: number, page: number, limit: number }
```

Use summary fields for the table; use `invoice` for edit/view without a second fetch (optional: still use `GET /api/invoices/:invoiceId` if payment schedule needed).

---

## 5. Endpoints with no contract change

Use as today; listed for completeness.

| Method | Endpoint |
|--------|----------|
| GET | `/api/sales/dashboard/conversion-funnel` |
| GET | `/api/sales/dashboard/performance-trend` |
| GET | `/api/sales/dashboard/today-tasks` |
| PUT | `/api/sales/leads/:leadId` |
| POST | `/api/sales/leads` |
| GET | `/api/sales/leads/:leadId/buildings` |
| POST | `/api/sales/leads/:leadId/buildings` |
| POST | `/api/invoices` |
| GET | `/api/invoices/:invoiceId` |
| PUT | `/api/invoices/:invoiceId/mark-paid` |
| POST | `/api/invoices/:invoiceId/send` |
| GET | `/api/leads/:leadId/invoices` |
| POST | `/api/upload/presigned-url` |

---

## 6. TypeScript-friendly diff summary

```ts
// ─── BREAKING RENAMES ───
// GET /api/sales/leads/stats
- data.totalLeads
+ data.leadsInPipeline
- data.escalationsPending
+ data.escalations

// ─── BREAKING LEAD LIST ROW ───
// GET /api/sales/leads
- lead.customerId, lead.leadScoring, lead.nextFollowUp
+ lead.projectId, lead.nextFollowUpDate, lead.quotationCreated,
+ lead.isQuoteReady, lead.isRaisedToPO, lead.poNumber

// ─── NEW ENDPOINTS (add API client methods) ───
+ GET  /api/sales/customers/:id        PUT body for edit
+ GET  /api/sales/leads/with-quotations
+ GET  /api/sales/leads/with-po
+ GET  /api/sales/leads/:leadId/activity
+ GET  /api/sales/leads/:leadId/followups
+ GET  /api/sales/followups/ai-script/generate
+ GET  /api/sales/profile
+ PUT  /api/sales/profile
+ GET  /api/sales/invoices/stats
+ GET  /api/sales/invoices

// ─── ADDITIVE (parse new fields, old code still works until you need them) ───
// GET /api/sales/customers/:id → customer.photo, customer.address
// GET /api/sales/customers/:id/projects → projectId, isActive
// GET /api/sales/leads/:id/detail → assignedSales, agreement, payments.totalOverdue, lead.poNumber, customer.photo|address
```

---

## 7. Suggested FE migration order

1. **Renames:** lead stats (`leadsInPipeline`, `escalations`), lead list row shape  
2. **Customer:** `address`/`photo`, edit customer `PUT`, projects `projectId`/`isActive`  
3. **Section pages:** switch Quotes / PO to `with-quotations` / `with-po`; refresh Escalated list  
4. **Lead detail:** `assignedSales`, `agreement`, `totalOverdue`, paginated activity/follow-ups  
5. **Invoices page:** new stats + list endpoints  
6. **Profile:** `GET`/`PUT /api/sales/profile`  
7. **AI scripts:** `GET /api/sales/followups/ai-script/generate`  

---

## 8. Questions for backend before release

Confirm with backend when deployed:

1. Are `GET /api/sales/quotations` and `GET /api/sales/po-orders` deprecated or kept for other screens?  
2. Lead list — will `customerId` / `leadScoring` remain available behind a query flag?  
3. Invoice list — is `includePaymentSchedule=true` supported on list rows?  

---

*Generated from Step 1 + Step 2 backend specs. Last updated: 2026-05-22.*
