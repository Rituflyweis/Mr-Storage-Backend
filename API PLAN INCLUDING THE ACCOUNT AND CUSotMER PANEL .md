# Construction AI — API Reference

## Table of Contents

- [End-to-End Flows](#end-to-end-flows)
  - [Flow 1 — Customer chat to lead assignment](#flow-1--customer-chat-to-lead-assignment)
  - [Flow 2 — Quotation draft, review, and send](#flow-2--quotation-draft-review-and-send)
  - [Flow 3 — Invoice, PO number, and payment](#flow-3--invoice-po-number-and-payment)
  - [Flow 4 — Lead escalation and reassignment](#flow-4--lead-escalation-and-reassignment)
  - [Flow 5 — PO order approval](#flow-5--po-order-approval)
- [Base URL & Auth](#base-url--auth)
- [Standard Response](#standard-response)
- [Errors & Status Codes](#errors--status-codes)
- [Authentication](#authentication)
  - [Forgot Password (OTP Reset)](#forgot-password-otp-reset--staffadminsalesaccounts)
- [Public — Chat Init](#public--chat-init)
- [Admin — Dashboard](#admin--dashboard)
- [Admin — Customers](#admin--customers)
- [Admin — Leads](#admin--leads)
- [Admin — Meetings](#admin--meetings)
- [Admin — Follow-ups](#admin--follow-ups)
- [Admin — Employees](#admin--employees)
- [Admin — Escalations](#admin--escalations)
- [Admin — PO Orders](#admin--po-orders)
- [Sales — Dashboard](#sales--dashboard)
- [Sales — Leads](#sales--leads)
- [Sales — Follow-ups](#sales--follow-ups)
- [Sales — Projects & PO Orders](#sales--projects--po-orders)
- [Common — Quotations](#common--quotations)
- [Common — Invoices](#common--invoices)
- [Common — Payment Schedules](#common--payment-schedules)
- [Common — Documents & Uploads](#common--documents--uploads)
- [Socket.io Events](#socketio-events)
- [Account Panel](#account-panel)
- [Customer Panel](#customer-panel)
  - [Customer Auth](#customer-auth)
  - [Customer Dashboard](#customer-dashboard)
  - [Customer Projects](#customer-projects)
  - [Customer Documents](#customer-documents)
  - [Customer Payments](#customer-payments)
  - [Customer Profile](#customer-profile)
  - [Account — Dashboard](#account--dashboard)
  - [Account — Projects](#account--projects)
  - [Account — Invoices](#account--invoices)
  - [Account — Expenses](#account--expenses)
  - [Account — Tax](#account--tax)


## End-to-End Flows

These flows describe how endpoints connect into complete features. Read these before building any screen — they explain sequencing, side effects, and things that happen automatically server-side.

---

### Flow 1 — Customer chat to lead assignment

This is the full lifecycle from a customer landing on the site to a sales employee receiving the lead.

**Step 1 — Customer fills the contact form**

Call `POST /api/public/chat/init` with `firstName`, `email`, `phone`, `countryCode`. The server either creates a new customer and lead or matches to an existing one.

Response gives you `customerId` and `leadId`. Store both client-side — you need them for every subsequent socket emit.

**Step 2 — Connect to the chat socket**

```js
const socket = io('http://localhost:5000/chat')
socket.on('connect', () => {
  socket.emit('join_lead', { leadId, customerId })
})
```

Emit `join_lead` immediately on connect. This puts the socket into the correct room so it receives events scoped to this lead.

**Step 3 — Customer sends messages**

```js
socket.emit('customer_message', { leadId, customerId, content: 'I need a 5000 sqft warehouse' })
```

The server routes the message to Claude AI (while `isHandedToSales = false`). While Claude is generating, you receive `ai_typing: { isTyping: true }`. When done, you receive `new_message` with `senderType: "ai"`.

Simultaneously, the server runs two fire-and-forget jobs after every message:
- Updates the AI context summary on the lead
- Re-scores the lead and emits `lead_score_updated` to the admin room

**Step 4 — AI detects enough info and marks the lead quote-ready**

When Claude has gathered sufficient detail, it outputs a `QUOTE_DATA:{...}` block in its response. The server detects this automatically and:

1. Stores the extracted data as `lead.aiQuoteData`
2. Sets `lead.isQuoteReady = true`
3. Emits `lead_quote_ready` to the admin room
4. Runs the round-robin assignment — picks the next active sales employee
5. Sets `lead.assignedSales`, `lead.isHandedToSales = true`
6. Emits `lead_assigned` to `user:{salesId}` room with the full populated lead
7. Emits `lead_handed_to_sales` to the customer's chat room

**Step 5 — Customer receives handoff notice**

```js
socket.on('lead_handed_to_sales', ({ assignedSales }) => {
  // Show: "You've been connected to Ravi Kumar"
})
```

**Step 6 — Sales employee receives the lead**

On the admin panel socket:

```js
socket.on('lead_assigned', ({ leadId, lead }) => {
  // lead contains full context: aiQuoteData, aiContextSummary,
  // leadScoring, customerId, assignedSales
  // Open the lead detail view immediately
})
```

The `lead` payload in `lead_assigned` is fully populated — no need for an extra API call to understand the lead. The sales employee can immediately see what the customer needs, the AI's price estimate, and the conversation summary.

**Step 7 — Sales joins the chat room and takes over**

```js
socket.emit('join_lead_chat', { leadId })
socket.emit('sales_message', { leadId, content: 'Hi Arjun, I'll be handling your project.' })
```

From this point on, `customer_message` events route to the sales employee instead of Claude.

> **What if no active sales employees exist?**
> Round-robin emits `lead_no_sales_available` to `admin_room`. Admin must manually assign via `PUT /api/admin/leads/:leadId/assign`. That endpoint also emits `lead_assigned` with full lead context to the newly assigned employee.

---

### Flow 2 — Quotation draft, review, and send

Sales creates a quotation manually using the AI-extracted data as a reference.

**Step 1 — Open lead detail to read AI quote data**

```
GET /api/admin/leads/:leadId/detail
   or
GET /api/sales/leads/:leadId/detail
```

The response includes `lead.aiQuoteData`:

```json
{
  "aiQuoteData": {
    "priceMin": 250000,
    "priceMax": 300000,
    "complexity": 3,
    "basis": "Standard commercial 5000sqft warehouse",
    "details": { "sqft": "5000", "roofType": "Gable", "region": "Southeast" }
  }
}
```

Use this to pre-fill the quotation form on the frontend. The sales employee reviews and adjusts before saving.

**Step 2 — Save as draft**

```
POST /api/quotations
```

Send all fields with `status: "draft"` (or omit `status` — draft is the default). Nothing is emailed. The quotation is saved and you get back the full document with its `_id`.

```json
{ "data": { "quotation": { "_id": "64f...", "status": "draft", ... } } }
```

**Step 3 — View and edit the draft**

At any point before sending:

```
GET /api/quotations/:quotationId      — view current state
PUT /api/quotations/:quotationId      — edit any fields
```

Editing is only allowed while `status = draft`. Calling `PUT` after sending returns **400**. There is no undo after send.

You can call `PUT` as many times as needed — each call returns the updated document.

**Step 4 — Send**

```
POST /api/quotations/:quotationId/send
```

No request body. This single call does everything:

- Sends Nodemailer email to the customer with the quotation details
- Sets `status = sent`, `sentAt = now`
- Updates `lead.lifecycleStatus` to `proposal_sent`
- Generates an AI plain-text summary of the quotation (fire-and-forget, available via `GET /api/quotations/:quotationId/summary`)
- AuditLogs the action

After this the quotation is locked. To revise it, create a new quotation on the same lead — `GET /api/leads/:leadId/quotations` returns all of them sorted newest first. Filter client-side by `status` to show only the active one.

---

### Flow 3 — Invoice, PO number, and payment

**Step 1 — Create invoice**

```
POST /api/invoices
```

Send `leadId`, `totalAmount`, and any line items. Do **not** send `invoiceNumber` or `poNumber` — both are auto-generated:

- `invoiceNumber` — always new (INV-0001, INV-0002…)
- `poNumber` — **only generated on the first invoice for this lead** (PO-0001, PO-0002…). Every subsequent invoice on the same lead automatically carries forward the same PO number. The frontend never needs to manage PO numbers.

Response:
```json
{ "data": { "invoice": { "invoiceNumber": "INV-0001", "poNumber": "PO-0001", "status": "draft" } } }
```

**Step 2 — Optionally create a payment schedule**

If the deal has staged payments, create a schedule linked to this invoice:

```
POST /api/payment-schedules
```

Rules:
- All payment items must use the same `amountType` (`percentage` or `fixed`)
- Percentage items must sum to exactly **100**
- Fixed items must sum to exactly the invoice `totalAmount`

**Step 3 — Send invoice**

```
POST /api/invoices/:invoiceId/send
```

No body. Emails the customer, sets `status = sent`, `sentAt = now`.

**Step 4a — Mark full invoice as paid**

```
PUT /api/invoices/:invoiceId/mark-paid
```

No body. Sets `status = paid`, records `paidBy` (logged-in user `_id`) and `paidAt`. Only works on invoices with status `sent` or `overdue`.

**Step 4b — Or mark individual payment schedule items as paid**

```
PUT /api/payment-schedules/:scheduleId/payments/:paymentId
```

No body. Marks that specific payment item as paid. Use this when customers pay in stages. Each call records `paidAt` and `paidBy` on the individual payment item.

> **Note:** Steps 4a and 4b are independent. If you use a payment schedule, track payments via the schedule. If it's a single payment, use `mark-paid` on the invoice directly.

---

### Flow 4 — Lead escalation and reassignment

When a sales employee can't resolve something on their own (pricing authority, difficult customer, etc.).

**Step 1 — Sales raises escalation**

```
POST /api/sales/leads/:leadId/escalate
{ "note": "Customer demanding 40% discount — outside my authority." }
```

Server creates an `Escalation` document and emits `new_escalation` to `admin_room`:

```json
{ "escalation": { "_id": "64f...", "note": "...", "status": "pending" }, "leadId": "64f...", "raisedBy": "Ravi Kumar" }
```

**Step 2 — Admin sees the escalation**

Admin panel receives `new_escalation` via socket and can also fetch the full list via `GET /api/admin/escalations?status=pending`.

**Step 3 — Admin resolves and reassigns**

```
PUT /api/admin/escalations/:escalationId/assign
{ "employeeId": "64f..." }
```

Server does everything in one call:
- Sets `escalation.status = resolved`, `resolvedAt = now`, `resolvedAssignedTo = employeeId`
- Updates `lead.assignedSales` to the new employee
- Pushes to `lead.assigningHistory` with `method: "manual"`
- AuditLogs the action
- Emits `lead_assigned` to `user:{newEmployeeId}` with the full populated lead

**Step 4 — New employee receives the lead**

Same `lead_assigned` socket event as the initial assignment — full lead context, ready to act.

---

### Flow 5 — PO order approval

Sales raises a PO order once a deal is confirmed and invoiced. Admin approves or rejects it.

**Step 1 — Sales raises the PO order**

```
POST /api/sales/leads/:leadId/po-order
{
  "poNumber":    "PO-0001",
  "invoiceId":   "64f...",
  "quotationId": "64f..."
}
```

Get `poNumber` from the invoice (`invoice.poNumber` — auto-generated at invoice creation).

Server creates a `POOrder` document, sets `lead.isRaisedToPO = true`, and emits `new_po_order` to `admin_room`.

**Step 2 — Admin sees the PO order**

Admin receives `new_po_order` via socket. Can also fetch the list via `GET /api/admin/po-orders?status=pending`.

The `invoiceId` and `quotationId` are fully populated in the response so admin has the full financial context without extra calls.

**Step 3 — Admin approves or rejects**

```
PUT /api/admin/po-orders/:poOrderId/status
{ "status": "approved", "adminNotes": "All checks passed" }
```

`status` must be `approved` or `rejected`. Server updates `order.status` and syncs `lead.poStatus` to match.

**Step 4 — Sales checks status**

```
GET /api/sales/po-orders
```

Returns all PO orders raised by this employee including the updated `status` and any `adminNotes`.

---

---

## Base URL & Auth

```
http://localhost:5000        — development
https://api.yourdomain.com   — production
```

All protected endpoints require a Bearer token in the `Authorization` header. Obtain it from `POST /api/auth/login`. Access tokens expire in **15 minutes** — use the refresh token to rotate.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Role guards**

| Prefix | Roles allowed |
|--------|--------------|
| `/api/admin/*` | `admin` |
| `/api/sales/*` | `sales` |
| `/api/quotations/*`, `/api/invoices/*`, `/api/payment-schedules/*`, `/api/upload/*` | `admin`, `sales` |
| `/api/public/*`, `/api/auth/*` | public (no token) |

**Date range filter** — every list and stats endpoint accepts `?startDate=` and `?endDate=` as ISO 8601. endDate is inclusive (server sets 23:59:59.999).

```
GET /api/admin/leads?startDate=2024-01-01&endDate=2024-03-31
```

**Pagination** — pass `?page=1&limit=20`. Response always includes `total`, `page`, `limit`.

---

## Standard Response

```json
{
  "success": true,
  "message": "Success",
  "data": { ... }
}
```

---

## Errors & Status Codes

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "msg": "email is required", "path": "email", "location": "body" }]
}
```

| Status | When | Example |
|--------|------|---------|
| 400 | Invalid body, bad ObjectId, business rule violation | `Only draft invoices can be edited` |
| 401 | Missing, expired, or invalid token | `Token expired` |
| 403 | Valid token, wrong role, or sales accessing another employee's lead | `Access denied. Requires role: admin` |
| 404 | Document not found | `Lead not found` |
| 409 | Duplicate unique field | `Duplicate value for email` |
| 429 | Rate limit exceeded (300 req/15min global; 20 req/15min on /chat/init) | `Too many requests` |
| 500 | Unexpected server error | `Internal server error` |

---

## Authentication

### `POST /api/auth/login`
Login for all employee roles. No auth required.

**Request body**
```json
{ "email": "admin@company.com", "password": "Admin@123" }
```

**Response 200**
```json
{
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "role": "admin",
    "user": { "_id": "64f...", "name": "Admin User", "email": "admin@co.com", "role": "admin" }
  }
}
```

---

### `POST /api/auth/refresh`
Get a new access token using the refresh token.

**Request body**
```json
{ "refreshToken": "eyJhbGci..." }
```

**Response 200**
```json
{ "data": { "accessToken": "eyJhbGci..." } }
```

---

### `POST /api/auth/logout`
No body required. Client should delete both tokens from storage.

---

### `PUT /api/auth/change-password`
Works for any authenticated role.

**Request body**
```json
{ "currentPassword": "OldPass@123", "newPassword": "NewPass@456" }
```

---

### Forgot Password (OTP Reset) — Staff/Admin/Sales/Accounts

Three-step flow. No auth required on any of these endpoints.

**Step 1 — Request OTP**

### `POST /api/auth/forgot-password`

**Request body**
```json
{ "email": "admin@company.com" }
```

**Response 200**
```json
{ "message": "If that email exists, an OTP has been sent" }
```

A 6-digit numeric OTP is emailed to the address. Valid for **10 minutes**. Always returns 200 regardless of whether the email exists (prevents enumeration).

---

**Step 2 — Verify OTP**

### `POST /api/auth/verify-otp`

**Request body**
```json
{ "email": "admin@company.com", "otp": "483920" }
```

**Response 200**
```json
{ "message": "OTP verified successfully", "data": { "resetToken": "eyJhbGci..." } }
```

`resetToken` is a short-lived JWT (5 minutes). Pass it to Step 3. OTP is invalidated immediately after verification — single use.

Errors: `400 — Invalid OTP` | `400 — OTP has expired. Please request a new one`

---

**Step 3 — Reset Password**

### `POST /api/auth/reset-password`

**Request body**
```json
{ "resetToken": "eyJhbGci...", "newPassword": "NewPass@456" }
```

**Response 200**
```json
{ "message": "Password reset successfully" }
```

Errors: `400 — Invalid or expired reset token` | `400 — OTP not verified. Please start over`

---

## Public — Chat Init

### `POST /api/public/chat/init`
Start a customer chat session. No auth. Rate-limited to **20 req/IP/15 min**.

Matches an existing customer by email OR phone. If matched to a manually-imported lead, returns that `leadId` so the chat continues on the same lead.

**Request body**

| Field | Type | Required |
|-------|------|----------|
| firstName | string | ✓ |
| email | string | ✓ |
| phone | string | ✓ — digits only e.g. `9876543210` |
| countryCode | string | ✓ — e.g. `+91` |

**Response 200**
```json
{
  "data": {
    "customerId": "64f...",
    "leadId": "64f...",
    "customerName": "Arjun",
    "isReturning": false
  }
}
```

> Use `leadId` to join the socket room after connecting.

---

### `GET /api/public/chat/history/:leadId`
Load chat history on page reload.

**Response 200**
```json
{
  "data": {
    "messages": [
      { "_id": "64f...", "senderType": "customer", "content": "I need a warehouse", "isRead": true, "createdAt": "2024-01-15T10:00:00.000Z" },
      { "_id": "64f...", "senderType": "ai",       "content": "Hi! What region?",   "isRead": true, "createdAt": "2024-01-15T10:00:05.000Z" }
    ]
  }
}
```

`senderType` is one of `customer`, `ai`, `sales`.

---

## Admin — Dashboard

> 🔒 Requires role: `admin`

All three endpoints accept `?startDate=&endDate=`.

### `GET /api/admin/dashboard/lead-stats`
```json
{
  "data": {
    "totalLeads": 142,
    "confirmedLeads": 38,
    "pipelineValue": 4850000,
    "monthlyRevenue": 320000,
    "unreadMessages": 12
  }
}
```

> `monthlyRevenue` always reflects the **current calendar month** regardless of `startDate/endDate`.

---

### `GET /api/admin/dashboard/customer-stats`
```json
{
  "data": {
    "total": 98,
    "active": 85,
    "newThisMonth": 14,
    "returning": 23
  }
}
```

> `returning` = customers with more than 1 lead total.

---

### `GET /api/admin/dashboard/ai-vs-human`
```json
{
  "data": {
    "withAi": 24,
    "withSales": 118
  }
}
```

---

## Admin — Customers

> 🔒 Requires role: `admin`

### `GET /api/admin/customers`
All customers, paginated.

**Query params:** `isActive`, `search`, `page` (default 1), `limit` (default 20), `startDate`, `endDate`

**Response 200**
```json
{
  "data": {
    "customers": [{
      "_id": "64f...",
      "customerId": "CUST-0001",
      "firstName": "Arjun",
      "email": "arjun@example.com",
      "phone": { "number": "9876543210", "countryCode": "+91" },
      "photo": null,
      "isActive": true,
      "source": "chat",
      "createdAt": "2024-01-15T10:00:00.000Z"
    }],
    "total": 98, "page": 1, "limit": 20
  }
}
```

---

### `GET /api/admin/customers/:customerId`
Customer detail with all projects and invoice totals.

```json
{
  "data": {
    "customer": { "...full customer document..." },
    "totalPaid": 250000,
    "totalPending": 80000,
    "totalInvoices": 4,
    "projects": [{ "_id": "64f...", "buildingType": "Warehouse", "location": "Chennai", "lifecycleStatus": "deal_closed", "quoteValue": 280000 }],
    "invoices":  [{ "_id": "64f...", "invoiceNumber": "INV-0001", "totalAmount": 280000, "status": "paid" }]
  }
}
```

---

### `GET /api/admin/customers/:customerId/projects/:leadId`
Single project detail.

```json
{
  "data": {
    "lead":         { "...full lead document with assignedSales populated..." },
    "quotation":    { "...full quotation document..." },
    "quoteSummary": { "_id": "64f...", "summary": "5000 sqft warehouse...", "generatedAt": "..." },
    "invoices":     ["...array of full invoice documents..."]
  }
}
```

---

### `POST /api/admin/customers/:customerId/leads`
Create a new project for an existing customer.

> If `assignedSales` is not provided, defaults to the same employee from the customer's most recent lead.

**Request body**
```json
{
  "buildingType": "Office",
  "location": "Bangalore",
  "assignedSales": "64f..."
}
```

---

## Admin — Leads

> 🔒 Requires role: `admin`

### `GET /api/admin/leads/stats`
```json
{ "data": { "total": 142, "assigned": 118, "unassigned": 24, "unreadMessages": 7 } }
```

---

### `GET /api/admin/leads`
All leads with filters.

**Query params:** `buildingType`, `quoteValueMin`, `quoteValueMax`, `assignedSales`, `lifecycleStatus`, `source` (`chat|manual|import`), `isQuoteReady`, `page`, `limit`, `startDate`, `endDate`

**Response 200**
```json
{
  "data": {
    "leads": [{
      "_id": "64f...",
      "buildingType": "Warehouse",
      "location": "Chennai",
      "source": "chat",
      "lifecycleStatus": "proposal_sent",
      "quoteValue": 280000,
      "isQuoteReady": true,
      "isHandedToSales": true,
      "isRaisedToPO": false,
      "poStatus": null,
      "aiQuoteData": {
        "priceMin": 250000,
        "priceMax": 300000,
        "complexity": 3,
        "basis": "Standard commercial 5000sqft",
        "details": { "sqft": "5000", "roofType": "Gable", "region": "Southeast" }
      },
      "leadScoring": {
        "score": 72,
        "requirements": "5000 sqft warehouse Chennai",
        "lastScoredAt": "2024-03-01T09:00:00.000Z"
      },
      "customerId":    { "...full customer document..." },
      "assignedSales": { "...full user document..." },
      "createdAt": "2024-01-15T10:00:00.000Z"
    }],
    "total": 142, "page": 1, "limit": 20
  }
}
```

---

### `GET /api/admin/leads/:leadId/detail`
Full single-lead view — all related data in one call.

```json
{
  "data": {
    "lead": {
      "...all lead fields...",
      "aiQuoteData": { "priceMin": 250000, "priceMax": 300000, "details": { "..." } },
      "aiContextSummary": "Customer wants 5000 sqft warehouse in Chennai...",
      "leadScoring": {
        "score": 72,
        "scoreBreakdown": {
          "projectSize":    { "points": 25, "reason": "Large commercial build" },
          "budgetSignals":  { "points": 15, "reason": "Mentioned budget range" },
          "timeline":       { "points": 15, "reason": "3-month timeline stated" },
          "decisionMaker":  { "points": 8,  "reason": "Likely influencer" },
          "projectClarity": { "points": 9,  "reason": "Most details provided" }
        }
      },
      "assigningHistory": [{ "employeeId": "64f...", "method": "auto", "assignedAt": "...", "assignedBy": null }],
      "documents": [{ "_id": "64f...", "url": "https://s3.../file.pdf", "name": "site-plan.pdf" }],
      "customerId":    { "...full customer document..." },
      "assignedSales": { "...full user document..." }
    },
    "quotation":       { "...full quotation document..." },
    "quoteSummary":    { "_id": "64f...", "summary": "...", "generatedAt": "..." },
    "invoices":        ["...full invoice documents..."],
    "paymentSchedule": {
      "_id": "64f...", "totalAmount": 280000,
      "payments": [
        { "_id": "64f...", "name": "Deposit",     "amount": 30, "amountType": "percentage", "status": "paid"    },
        { "_id": "64f...", "name": "On delivery", "amount": 70, "amountType": "percentage", "status": "pending" }
      ]
    },
    "recentMessages": [
      { "senderType": "customer", "content": "I need 5000 sqft", "createdAt": "..." },
      { "senderType": "ai",       "content": "Great — what location?", "createdAt": "..." }
    ]
  }
}
```

---

### `POST /api/admin/leads`
Manually create a lead.

**Request body**

| Field | Required |
|-------|----------|
| customerId | ✓ |
| buildingType | optional |
| location | optional |
| assignedSales | optional |

---

### `POST /api/admin/leads/import`
Bulk import from CSV string.

**Request body**
```json
{ "csv": "name,email,phone,projectType\nArjun,a@ex.com,9876543210,Warehouse" }
```

**Response 200**
```json
{ "message": "Import complete: 2 created, 0 skipped", "data": { "created": 2, "skipped": 0, "errors": [] } }
```

---

### `PUT /api/admin/leads/:leadId`
Edit basic lead details. Any subset of fields.

```json
{ "buildingType": "Office", "location": "Bangalore", "quoteValue": 300000, "lifecycleStatus": "negotiation" }
```

---

### `PUT /api/admin/leads/:leadId/assign`
Manually assign a sales employee.

> Emits `lead_assigned` socket event to the assigned employee with full lead context including `aiQuoteData`.

**Request body**
```json
{ "employeeId": "64f..." }
```

---

### `GET /api/admin/leads/:leadId/timeline`
All audit log entries for this lead, sorted descending.

```json
{
  "data": {
    "timeline": [{
      "_id": "64f...", "type": "lead", "action": "lead.assigned.auto",
      "performedBy": null,
      "metadata": { "assignedTo": "64f..." },
      "leadId":    { "...full lead document..." },
      "customerId": { "...full customer document..." },
      "createdAt": "2024-01-15T10:05:00.000Z"
    }]
  }
}
```

> `performedBy` is `null` when the action was triggered by AI (auto-assign, score update, quote ready).

---

### `GET /api/admin/leads/scoring/today`
Leads scored today, sorted by score descending. Accepts `?startDate=&endDate=` to change the scoring window.

---

## Admin — Meetings

> 🔒 Requires role: `admin`

### `GET /api/admin/meetings`
All meetings where `status ≠ completed`. Accepts `startDate/endDate` to filter `meetingTime`.

**Response 200**
```json
{
  "data": {
    "meetings": [{
      "_id": "64f...", "title": "Project discussion",
      "meetingTime": "2024-03-15T14:00:00.000Z",
      "duration": 60, "mode": "online",
      "meetingLink": "https://meet.google.com/abc",
      "notes": "Review warehouse specs", "status": "scheduled",
      "customerId": { "...full customer document..." },
      "assignedTo": { "...full user document..." },
      "createdBy":  { "...full user document..." },
      "leadId": "64f..."
    }]
  }
}
```

---

### `POST /api/admin/meetings`

| Field | Type | Required |
|-------|------|----------|
| customerId | ObjectId | ✓ |
| leadId | ObjectId | optional |
| title | string | ✓ |
| meetingTime | ISO date | ✓ |
| duration | number (minutes) | optional |
| mode | `online\|offline` | ✓ |
| meetingLink | string | required when `mode = online` |
| notes | string | optional |
| assignedTo | ObjectId | ✓ |

---

### `PUT /api/admin/meetings/:meetingId`
Edit any subset of meeting fields.

---

### `PUT /api/admin/meetings/:meetingId/complete`
No body. Sets `status = completed`, `completedAt = now`. AuditLogged.

---

## Admin — Follow-ups

> 🔒 Requires role: `admin`

> **Overdue** is computed at query time — `followUpDate < now AND status = pending`. It is not stored as a separate status.

### `GET /api/admin/followups/stats`
```json
{ "data": { "total": 85, "upcoming": 34, "completed": 41, "overdue": 10 } }
```

---

### `GET /api/admin/followups/upcoming`
```json
{
  "data": {
    "followups": [{
      "_id": "64f...", "followUpDate": "2024-03-20T10:00:00.000Z",
      "notes": "Check on quote decision", "priority": "high", "status": "pending",
      "leadId":     { "...full lead document..." },
      "customerId": { "...full customer document..." },
      "assignedTo": { "...full user document..." },
      "createdBy":  { "...full user document..." }
    }]
  }
}
```

---

### `POST /api/admin/followups`

| Field | Type | Required |
|-------|------|----------|
| leadId | ObjectId | ✓ |
| customerId | ObjectId | ✓ |
| assignedTo | ObjectId | ✓ |
| followUpDate | ISO date | ✓ |
| notes | string | optional |
| priority | `low\|medium\|high\|urgent` | default `medium` |

---

### `PUT /api/admin/followups/:followUpId/complete` ⭐ NEW
No body. Sets `status = completed`, `completedAt = now`. AuditLogged.

```json
{ "message": "Follow-up marked as completed", "data": { "followUp": { "...full document..." } } }
```

---

### `GET /api/admin/followups/ai-script`
Claude-generated call scripts for today's pending follow-ups.

```json
{
  "data": {
    "scripts": [{
      "followUpId": "64f...", "leadId": "64f...", "customerName": "Arjun",
      "script": "Hi Arjun, this is Ravi from Construction Co. We sent you a quote last week for your 5000 sqft warehouse in Chennai. I wanted to check if you had a chance to review it..."
    }]
  }
}
```

---

### `GET /api/admin/followups/kpi`
KPI stats (placeholder — real aggregation coming in a future release).

```json
{ "data": { "weeklyCount": 0, "responseRate": 0, "conversionRate": 0, "avgResponseTimeHours": 0 } }
```

---

## Admin — Employees

> 🔒 Requires role: `admin`
>
> Creating or updating a sales employee automatically rebuilds the round-robin assignment tracker.

### `GET /api/admin/employees/stats`
```json
{
  "data": {
    "total": 8, "active": 6,
    "byRole": [{ "_id": "sales", "count": 4 }, { "_id": "construction", "count": 2 }],
    "topPerformer": null
  }
}
```

---

### `GET /api/admin/employees/performance`
```json
{
  "data": {
    "performance": [{
      "employee": { "...full user document..." },
      "totalLeads": 18, "closedLeads": 7, "conversionRate": 39
    }]
  }
}
```

---

### `GET /api/admin/employees`
All employees with assigned lead counts.

```json
{
  "data": {
    "employees": [{
      "_id": "64f...", "name": "Ravi Kumar", "email": "ravi@co.com",
      "role": "sales", "phone": "9876543210", "isActive": true,
      "assignedLeadCount": 18
    }],
    "total": 8
  }
}
```

---

### `POST /api/admin/employees`
Create an employee account.

| Field | Type | Required |
|-------|------|----------|
| name | string | ✓ |
| email | string | ✓ |
| password | string (min 6) | ✓ |
| phone | string | optional |
| role | `admin\|sales\|construction\|plant\|account` | ✓ |

---

### `GET /api/admin/employees/:userId`
Employee detail with performance stats and all assigned leads.

```json
{
  "data": {
    "employee": { "...full user document..." },
    "leads": ["...all assigned leads with customerId populated..."],
    "stats": {
      "totalLeads": 18, "closedLeads": 7, "conversionRate": 39,
      "followUpsCompleted": 45, "revenueGenerated": 1850000
    }
  }
}
```

---

### `GET /api/admin/employees/:userId/timeline` ⭐ NEW
All AuditLog entries where `performedBy = this employee`. Accepts `?startDate=&endDate=`.

```json
{
  "data": {
    "employee": { "...full user document..." },
    "timeline": [
      {
        "_id": "64f...", "type": "lead", "action": "lead.assigned.manual",
        "performedBy": "64f...",
        "metadata": { "assignedTo": "64f...", "employeeName": "Priya" },
        "leadId":     { "...full lead document..." },
        "customerId": { "...full customer document..." },
        "createdAt":  "2024-03-10T10:00:00.000Z"
      },
      {
        "_id": "64f...", "type": "invoice", "action": "invoice.sent",
        "metadata": { "invoiceNumber": "INV-0003", "sentTo": "client@email.com" },
        "createdAt": "2024-03-08T14:00:00.000Z"
      }
    ]
  }
}
```

---

### `PUT /api/admin/employees/:userId`
Update any subset of `name`, `phone`, `role`, `isActive`.

> RoundRobinTracker is automatically rebuilt if `isActive` or `role` changes.

---

## Admin — Escalations

> 🔒 Requires role: `admin`

### `GET /api/admin/escalations`
**Query params:** `status` (`pending|resolved`), `startDate`, `endDate`

```json
{
  "data": {
    "escalations": [{
      "_id": "64f...",
      "note": "Customer demanding 40% discount — outside authority",
      "status": "pending", "resolvedAt": null,
      "leadId":             { "...full lead document..." },
      "customerId":         { "...full customer document..." },
      "raisedBy":           { "...full user document..." },
      "resolvedBy":         null,
      "resolvedAssignedTo": null
    }]
  }
}
```

---

### `PUT /api/admin/escalations/:escalationId/assign`
Resolve escalation and reassign the lead to a different employee.

> Emits `lead_assigned` socket event to the new employee with full lead context.

**Request body**
```json
{ "employeeId": "64f..." }
```

---

## Admin — PO Orders

> 🔒 Requires role: `admin`

### `GET /api/admin/po-orders`
**Query params:** `status` (`pending|approved|rejected`), `startDate`, `endDate`

```json
{
  "data": {
    "orders": [{
      "_id": "64f...", "poNumber": "PO-0001", "status": "pending", "adminNotes": "",
      "leadId":      { "...full lead document..." },
      "customerId":  { "...full customer document..." },
      "raisedBy":    { "...full user document..." },
      "invoiceId":   { "...full invoice document..." },
      "quotationId": { "...full quotation document..." }
    }]
  }
}
```

---

### `PUT /api/admin/po-orders/:poOrderId/status`
```json
{ "status": "approved", "adminNotes": "All checks passed" }
```

`status` must be `approved` or `rejected`.

---

## Sales — Dashboard

> 🔒 Requires role: `sales`
>
> Same structure as Admin Dashboard. All data scoped to the logged-in sales employee.

### `GET /api/sales/dashboard/lead-stats`
```json
{ "data": { "totalLeads": 18, "confirmedLeads": 6, "pipelineValue": 980000, "unreadMessages": 3 } }
```

### `GET /api/sales/dashboard/customer-stats`
```json
{ "data": { "total": 15, "active": 12, "newThisMonth": 4 } }
```

---

## Sales — Leads

> 🔒 Requires role: `sales`
>
> All endpoints scoped to leads assigned to this user. Accessing another employee's lead returns **403**.

### `GET /api/sales/leads`
Same query params and response shape as `GET /api/admin/leads`. Automatically filtered to `assignedSales = current user`.

### `GET /api/sales/leads/:leadId/detail`
Identical response to `GET /api/admin/leads/:leadId/detail`.

---

### `PUT /api/sales/leads/:leadId/lifecycle`
```json
{ "lifecycleStatus": "negotiation" }
```

Valid values: `initial_contact`, `requirements_collected`, `proposal_sent`, `negotiation`, `deal_closed`, `payment_done`, `delivered`

---

### `POST /api/sales/leads/:leadId/escalate`
Escalate lead to admin.

> Emits `new_escalation` socket event to `admin_room`.

```json
{ "note": "Customer demanding 40% discount — outside my authority." }
```

---

### `POST /api/sales/leads/:leadId/po-order`
Raise a PO order.

> PO number is auto-generated when the first invoice is created. Retrieve it from the invoice and pass it here.

```json
{ "poNumber": "PO-0001", "invoiceId": "64f...", "quotationId": "64f..." }
```

---

## Sales — Follow-ups

> 🔒 Requires role: `sales`
>
> `assignedTo` is always auto-set to the logged-in user.

### `GET /api/sales/followups/stats`
```json
{ "data": { "total": 22, "upcoming": 9, "completed": 11, "overdue": 2 } }
```

### `GET /api/sales/followups/upcoming`
Same response shape as admin upcoming. Filtered to this user.

---

### `POST /api/sales/followups`

| Field | Required |
|-------|----------|
| leadId | ✓ |
| customerId | ✓ |
| followUpDate | ✓ |
| notes | optional |
| priority | optional, default `medium` |

---

### `PUT /api/sales/followups/:followUpId/complete`
No body. Guards: follow-up must belong to this sales user.

### `GET /api/sales/followups/kpi`
Placeholder — same shape as admin KPI.

---

## Sales — Projects & PO Orders

> 🔒 Requires role: `sales`

### `GET /api/sales/projects`
Leads where `lifecycleStatus` is `deal_closed`, `payment_done`, or `delivered`.

### `GET /api/sales/po-orders`
PO orders raised by this user.

---

## Common — Quotations

> 🔒 Requires role: `admin` or `sales` (sales scoped to their own leads)
>
> Quotations are **always created manually** by a sales employee after reviewing `lead.aiQuoteData`. The AI never creates a quotation directly.

### `POST /api/quotations`

| Field | Type | Required |
|-------|------|----------|
| leadId | ObjectId | ✓ |
| customerId | ObjectId | ✓ |
| buildingType | string | optional |
| basePrice | number | optional |
| maxPrice | number | optional |
| sqft | string | optional |
| width / length / height | number | optional |
| currency | string | default `USD` |
| roofStyle | string | optional |
| validTill | ISO date | optional |
| location | string | optional |
| windLoad / snowLoad | string | optional |
| paymentTerms | string | optional |
| companyName | string | optional |
| estimatedDelivery | string | optional |
| includedMaterials | array | optional — `[{name, description, quantity}]` |
| optionalAddOns | array | optional — `[{name, description, price}]` |
| specialNote | string | optional — shown on customer email |
| internalNotes | string | optional — **not** sent to customer |
| priorityLevel | `low\|medium\|high\|urgent` | default `medium` |
| status | `draft\|sent` | default `draft` |

---

### `PUT /api/quotations/:quotationId`
Edit any subset of fields. Only `draft` status can be edited.

### `GET /api/quotations/:quotationId`
Returns full quotation document with `createdBy` populated.

---

### `POST /api/quotations/:quotationId/send`
No body. Sends Nodemailer email. Sets `status = sent`. Updates `lead.lifecycleStatus = proposal_sent`. Generates `QuoteSummary` fire-and-forget. AuditLogged.

---

### `GET /api/quotations/:quotationId/summary`
AI-generated plain-text summary of the quotation.

```json
{
  "data": {
    "summary": {
      "_id": "64f...",
      "summary": "This quotation covers a 5000 sqft warehouse in Chennai with a gable roof. Price range USD 250,000–300,000, delivery 12–16 weeks. Payment terms 30% upfront and 70% on delivery, valid until April 30 2024.",
      "generatedAt": "2024-03-01T10:07:00.000Z"
    }
  }
}
```

---

### `GET /api/leads/:leadId/quotations`
All quotations for a lead, sorted descending.

---

## Common — Invoices

> 🔒 Requires role: `admin` or `sales`
>
> **PO number** is auto-generated on the **first invoice per lead** (PO-0001, PO-0002…). All subsequent invoices on the same lead carry it forward automatically. Never send `invoiceNumber` or `poNumber` in the request body.

### `POST /api/invoices`

| Field | Type | Required |
|-------|------|----------|
| leadId | ObjectId | ✓ |
| quotationId | ObjectId | optional |
| date | ISO date | default now |
| daysToPay | number | optional |
| lineItems | array | optional |
| subtotal | number | optional |
| markupTotal | number | optional |
| discount | number | optional |
| depositAmount | number | optional |
| totalAmount | number | ✓ |

**lineItem shape**
```json
{
  "images": ["https://s3.../img.jpg"],
  "items": ["Steel frame", "Install"],
  "rate": 50000, "markup": 5000,
  "quantity": 1, "tax": 9000, "total": 64000
}
```

**Response 201**
```json
{
  "data": {
    "invoice": {
      "_id": "64f...",
      "invoiceNumber": "INV-0001",
      "poNumber": "PO-0001",
      "totalAmount": 280000,
      "status": "draft",
      "paidBy": null, "paidAt": null
    }
  }
}
```

---

### `GET /api/invoices/:invoiceId`
Returns invoice with its payment schedule.

---

### `PUT /api/invoices/:invoiceId`
Edit any subset of fields. Only `draft` invoices can be edited.

---

### `POST /api/invoices/:invoiceId/send`
No body. Sends Nodemailer email. Sets `status = sent`, `sentAt = now`. AuditLogged.

---

### `PUT /api/invoices/:invoiceId/mark-paid`
No body. Sets `status = paid`, `paidBy = logged-in user _id`, `paidAt = now`. AuditLogged. Only works on invoices with status `sent` or `overdue`.

```json
{
  "data": {
    "invoice": {
      "_id": "64f...", "invoiceNumber": "INV-0001",
      "status": "paid",
      "paidBy": "64f...",
      "paidAt": "2024-04-01T09:00:00.000Z"
    }
  }
}
```

---

### `GET /api/leads/:leadId/invoices`
All invoices for a lead, sorted descending. `createdBy` and `paidBy` fully populated.

---

## Common — Payment Schedules

> 🔒 Requires role: `admin` or `sales`
>
> One schedule per invoice. All items must use the same `amountType`. Percentage items must sum to 100. Fixed items must sum to the invoice `totalAmount`.

### `POST /api/payment-schedules`

**Request body**
```json
{
  "customerId": "64f...",
  "leadId": "64f...",
  "invoiceId": "64f...",
  "totalAmount": 280000,
  "payments": [
    { "name": "Deposit",     "amount": 30, "amountType": "percentage", "dueDate": "2024-03-20T00:00:00.000Z" },
    { "name": "On delivery", "amount": 70, "amountType": "percentage" }
  ]
}
```

`amountType` is `percentage` or `fixed`.

---

### `GET /api/payment-schedules/invoice/:invoiceId`
Get the schedule for an invoice.

---

### `PUT /api/payment-schedules/:scheduleId/payments/:paymentId`
Mark an individual payment as paid. No body. Sets `status = paid`, `paidAt = now`, `paidBy = logged-in user`. AuditLogged.

---

## Common — Documents & Uploads

> 🔒 Requires role: `admin` or `sales`
>
> Files go directly to S3. Backend only stores the URL. **Two-step flow:**

### `POST /api/upload/presigned-url`
Step 1 — get a signed upload URL from S3.

**Request body**
```json
{ "fileName": "site-plan.pdf", "fileType": "application/pdf", "folder": "documents" }
```

**Response 200**
```json
{
  "data": {
    "uploadUrl": "https://bucket.s3.amazonaws.com/documents/uuid.pdf?X-Amz-Signature=...",
    "fileUrl":   "https://bucket.s3.amazonaws.com/documents/uuid.pdf",
    "key":       "documents/uuid.pdf"
  }
}
```

1. `PUT` the binary file bytes directly to `uploadUrl`
   - Header: `Content-Type: application/pdf`
   - Body: raw bytes (**not** `multipart/form-data`)
2. On S3 HTTP 200 → call Step 2 with `fileUrl`

---

### `POST /api/upload/leads/:leadId/documents`
Step 2 — save the S3 URL to the lead.

**Request body**
```json
{ "url": "https://bucket.s3.../uuid.pdf", "name": "site-plan.pdf" }
```

**Response 200**
```json
{
  "data": {
    "documents": [{ "_id": "64f...", "url": "https://...", "name": "site-plan.pdf", "uploadedBy": "64f...", "uploadedAt": "..." }]
  }
}
```

---

### `DELETE /api/upload/leads/:leadId/documents/:docId`
Removes from `lead.documents` only. Does **not** delete the S3 file.

---

## Socket.io Events

### Connecting

```js
// Customer (landing page) — no auth
const socket = io('http://localhost:5000/chat')

// Admin / Sales panel — JWT required
const socket = io('http://localhost:5000/admin', {
  auth: { token: localStorage.getItem('accessToken') }
})
```

---

### /chat namespace — customer-facing, no auth

| Direction | Event | Payload |
|-----------|-------|---------|
| **emit** | `join_lead` | `{ leadId, customerId }` |
| **emit** | `customer_message` | `{ leadId, customerId, content }` |
| **emit** | `typing_start` | `{ leadId }` |
| **emit** | `typing_stop` | `{ leadId }` |
| **receive** | `new_message` | `{ _id, senderType, senderName, content, createdAt, leadId }` |
| **receive** | `ai_typing` | `{ isTyping: true }` |
| **receive** | `sales_typing` | `{ isTyping: true, name: "Ravi Kumar" }` |
| **receive** | `lead_handed_to_sales` | `{ assignedSales: "Ravi Kumar" }` |
| **receive** | `customer_typing` | `{ isTyping: true }` |
| **receive** | `chat_error` | `{ message: "Something went wrong. Please try again." }` |

**`new_message` note:** `senderType` is `ai`, `sales`, or `customer`. `senderName` is only present when `senderType = sales`.

**`lead_handed_to_sales`** — AI has gathered enough info. Show a handoff notice to the customer. After this event the sales rep will start responding via the same `new_message` event.

---

### /admin namespace — requires JWT in `handshake.auth.token`

| Direction | Event | Payload | Room |
|-----------|-------|---------|------|
| **emit** | `join_lead_chat` | `{ leadId }` | — |
| **emit** | `sales_message` | `{ leadId, content }` | — |
| **emit** | `mark_messages_read` | `{ leadId }` | — |
| **emit** | `sales_typing_start` | `{ leadId }` | — |
| **emit** | `sales_typing_stop` | `{ leadId }` | — |
| **receive** | `lead_assigned` | see below | `user:{salesId}` only |
| **receive** | `new_message` | `{ _id, senderType, content, createdAt, leadId }` | lead room |
| **receive** | `lead_quote_ready` | `{ leadId, customerId }` | `admin_room` |
| **receive** | `lead_score_updated` | see below | `admin_room` |
| **receive** | `new_lead` | `{ leadId, customerId, customerName }` | `admin_room` |
| **receive** | `new_escalation` | `{ escalation, leadId, raisedBy }` | `admin_room` |
| **receive** | `new_po_order` | `{ order, leadId }` | `admin_room` |
| **receive** | `lead_no_sales_available` | `{ leadId }` | `admin_room` |

---

**`lead_assigned` payload**

Emitted to `user:{salesId}` only (not broadcast). Contains full lead context so the sales employee can immediately understand the situation.

```json
{
  "leadId": "64f...",
  "lead": {
    "_id": "64f...", "buildingType": "Warehouse",
    "location": "Chennai", "lifecycleStatus": "initial_contact",
    "aiQuoteData": {
      "priceMin": 250000, "priceMax": 300000, "complexity": 3,
      "details": { "sqft": "5000", "roofType": "Gable", "region": "Southeast" }
    },
    "aiContextSummary": "Customer wants 5000 sqft warehouse in Chennai...",
    "leadScoring": { "score": 72, "requirements": "5000 sqft warehouse" },
    "customerId":    { "...full customer document..." },
    "assignedSales": { "...full user document..." }
  }
}
```

---

**`lead_score_updated` payload**

```json
{
  "leadId": "64f...", "score": 72,
  "requirements": "5000 sqft warehouse Chennai",
  "breakdown": {
    "projectSize":    { "points": 25, "reason": "Large commercial build" },
    "budgetSignals":  { "points": 15, "reason": "Mentioned budget range" },
    "timeline":       { "points": 15, "reason": "3-month timeline stated" },
    "decisionMaker":  { "points": 8,  "reason": "Likely influencer" },
    "projectClarity": { "points": 9,  "reason": "Most details provided" }
  }
}
```

---

**`lead_no_sales_available`** — Round-robin failed, no active sales employees. Admin must manually assign via `PUT /api/admin/leads/:leadId/assign`.


---

## Account Panel

> 🔒 Requires role: **account** or **admin**

All routes under `/api/account/*`.

> **Invoice mark-paid note for frontend devs:** `PUT /api/account/invoices/:invoiceId/mark-paid` is the account panel's version of this action. It is functionally identical to the common `PUT /api/invoices/:invoiceId/mark-paid` endpoint. Both are available — use the account-prefixed one from the account panel to keep routing consistent.

---

### Account — Dashboard

All dashboard endpoints accept `?startDate=&endDate=` (ISO 8601).

### `GET /api/account/dashboard/stats`
Top-level financial KPIs.

```json
{
  "data": {
    "totalRevenue": 1850000,
    "totalExpenses": 420000,
    "netProfit": 1430000,
    "outstanding": 280000
  }
}
```

> `totalRevenue` = sum of all paid invoice amounts. `outstanding` = sum of all sent/draft invoice amounts.

---

### `GET /api/account/dashboard/invoice-stats`
Invoice counts and totals.

```json
{
  "data": {
    "total": 48,
    "paid": 32,
    "unpaid": 12,
    "overdue": 4,
    "totalSales": 1850000
  }
}
```

---

### `GET /api/account/dashboard/income-vs-expense`
Graph data for the income vs expense chart.

**Query params:** `?period=weekly|monthly|yearly`
- `weekly` — last 8 weeks
- `monthly` — last 12 months (default)
- `yearly` — last 3 years

```json
{
  "data": {
    "period": "monthly",
    "points": [
      { "label": "May 2024", "income": 320000, "expense": 85000 },
      { "label": "Jun 2024", "income": 410000, "expense": 92000 }
    ]
  }
}
```

---

### `GET /api/account/dashboard/recent-transactions`
Recent paid invoices and expenses merged, sorted by date descending.

**Query params:** `?limit=10` (default 10)

```json
{
  "data": {
    "transactions": [
      { "type": "invoice", "date": "2024-04-01T09:00:00.000Z", "amount": 280000, "invoiceNumber": "INV-0001", "...full invoice fields..." },
      { "type": "expense", "date": "2024-03-30T00:00:00.000Z", "amount": 15000, "category": "materials", "description": "Steel order", "...full expense fields..." }
    ]
  }
}
```

> The `type` field is always present — use it to determine how to render each row.

---

### `GET /api/account/dashboard/upcoming-payments`
Invoices due within the next 10 days. Returns fully populated.

```json
{
  "data": {
    "upcoming": [
      {
        "_id": "64f...", "invoiceNumber": "INV-0005",
        "totalAmount": 95000, "status": "sent",
        "dueDate": "2024-04-22T00:00:00.000Z",
        "leadId": { "...full lead document..." }
      }
    ]
  }
}
```

> `dueDate` is computed as `invoice.date + invoice.daysToPay` and injected into each result. Not a stored field.

---

### `GET /api/account/dashboard/payment-distribution`
Invoice breakdown by payment status — counts, amounts, and percentages.

```json
{
  "data": {
    "paid":    { "count": 32, "amount": 1850000, "pct": 67 },
    "pending": { "count": 12, "amount": 280000,  "pct": 25 },
    "overdue": { "count": 4,  "amount": 120000,  "pct": 8  },
    "totalAmount": 2250000,
    "totalCount": 48
  }
}
```

---

### `GET /api/account/dashboard/revenue-trend`
Monthly revenue for the last 12 months.

```json
{ "data": { "points": [ { "month": "May 2024", "amount": 320000 } ] } }
```

---

### `GET /api/account/dashboard/expense-trend`
Monthly expense total for the last 12 months.

```json
{ "data": { "points": [ { "month": "May 2024", "amount": 85000 } ] } }
```

---

### Account — Projects

### `GET /api/account/projects`
Leads where `lifecycleStatus` is `payment_done` or `delivered`. Accepts `?startDate=&endDate=`.

```json
{
  "data": {
    "projects": [
      {
        "_id": "64f...", "buildingType": "Warehouse", "location": "Chennai",
        "lifecycleStatus": "delivered", "quoteValue": 280000,
        "customerId": { "...full customer document..." },
        "assignedSales": { "...full user document..." }
      }
    ]
  }
}
```

---

### Account — Invoices

### `GET /api/account/invoices`
All invoices grouped by project. Filter: `?status=paid|sent|draft|overdue`, `?startDate=`, `?endDate=`.

```json
{
  "data": {
    "projects": [
      {
        "lead": { "...full lead document..." },
        "invoices": [
          {
            "_id": "64f...", "invoiceNumber": "INV-0001",
            "poNumber": "PO-0001", "totalAmount": 280000,
            "status": "paid", "paidAt": "2024-04-01T09:00:00.000Z",
            "createdBy": { "...full user document..." },
            "paidBy": { "...full user document..." }
          }
        ]
      }
    ]
  }
}
```

---

### `PUT /api/account/invoices/:invoiceId/mark-paid`
Mark invoice as paid. Sets `status = paid`, `paidAt = now`, `paidBy = logged-in user`. AuditLogged. Only works on invoices with status `sent` or `overdue`.

No request body required.

```json
{
  "message": "Invoice marked as paid",
  "data": {
    "invoice": {
      "_id": "64f...", "invoiceNumber": "INV-0001",
      "status": "paid",
      "paidBy": "64f...",
      "paidAt": "2024-04-01T09:00:00.000Z"
    }
  }
}
```

---

### `GET /api/account/invoices/analytics`
Invoice analytics: averages and on-time payment ratio. Accepts `?startDate=&endDate=`.

```json
{
  "data": {
    "avgInvoiceValue": 87500,
    "avgDaysToPay": 18,
    "onTimeCount": 28,
    "lateCount": 4,
    "onTimePct": 88,
    "totalInvoices": 32,
    "totalRevenue": 1850000
  }
}
```

---

### `GET /api/account/invoices/project/:leadId/breakdown`
Full payment picture for a single project — lead, all invoices, and each invoice's payment schedule.

```json
{
  "data": {
    "lead": { "...full lead document with customer and sales populated..." },
    "invoices": [
      {
        "_id": "64f...", "invoiceNumber": "INV-0001", "totalAmount": 280000, "status": "paid",
        "paymentSchedule": {
          "_id": "64f...",
          "payments": [
            { "name": "Deposit", "amount": 30, "amountType": "percentage", "status": "paid" },
            { "name": "On delivery", "amount": 70, "amountType": "percentage", "status": "paid" }
          ]
        }
      }
    ],
    "totalBilled": 280000,
    "totalPaid": 280000,
    "totalPending": 0
  }
}
```

---

### Account — Expenses

### `GET /api/account/expenses/stats`
Expense stats with category breakdown. Accepts `?startDate=&endDate=`.

```json
{
  "data": {
    "totalAmount": 420000,
    "totalCount": 38,
    "byCategory": [
      { "category": "materials", "total": 180000, "count": 12 },
      { "category": "labour",    "total": 95000,  "count": 8  }
    ],
    "thisMonth": 42000,
    "lastMonth": 38000
  }
}
```

---

### `GET /api/account/expenses`
All expenses. Filter: `?category=`, `?leadId=`, `?startDate=`, `?endDate=`, `?page=`, `?limit=` (default 20).

```json
{
  "data": {
    "expenses": [
      {
        "_id": "64f...",
        "expenseId": "EXP-2024-001",
        "category": "materials",
        "date": "2024-03-15T00:00:00.000Z",
        "amount": 45000,
        "description": "Steel frame order",
        "leadId": { "...full lead document..." },
        "isActive": true,
        "createdBy": { "...full user document..." }
      }
    ],
    "total": 38, "page": 1, "limit": 20
  }
}
```

Valid categories: `materials`, `labour`, `equipment`, `transport`, `utilities`, `permits`, `subcontractor`, `office`, `maintenance`, `other`

---

### `POST /api/account/expenses`
Create expense.

| Field | Type | Required |
|-------|------|----------|
| expenseId | string | ✓ — your own reference ID, must be unique |
| category | string | ✓ — must be one of the valid categories above |
| date | ISO date | ✓ |
| amount | number | ✓ |
| description | string | optional |
| leadId | ObjectId | optional — links expense to a project |

```json
{ "data": { "expense": { "...full expense document..." } } }
```

---

### `PUT /api/account/expenses/:expenseId/deactivate`
Soft-delete an expense. Sets `isActive = false`. AuditLogged. The expense is no longer included in any stats or lists.

No request body required.

```json
{ "message": "Expense deactivated", "data": { "expense": { "_id": "64f...", "isActive": false } } }
```

---

### `GET /api/account/expenses/project/:leadId`
All active expenses linked to a specific project.

```json
{
  "data": {
    "lead": { "...full lead document..." },
    "expenses": [ { "...full expense documents..." } ],
    "total": 85000
  }
}
```

---

### Account — Tax

### `GET /api/account/tax/stats`
Tax filing summary.

```json
{
  "data": {
    "totalPayable": 125000,
    "totalPaid": 84000,
    "pendingCount": 3,
    "overdueCount": 1,
    "paidCount": 6
  }
}
```

> `totalPayable` = sum of all pending tax amounts (including overdue). `overdueCount` = entries where `dueDate < now AND status = pending`.

---

### `GET /api/account/tax`
All tax entries. Filter: `?status=pending|paid|overdue`, `?startDate=`, `?endDate=` (filters `dueDate`).

```json
{
  "data": {
    "taxes": [
      {
        "_id": "64f...",
        "state": "Tamil Nadu",
        "dueDate": "2024-04-30T00:00:00.000Z",
        "amount": 32000,
        "websiteLink": "https://tnvat.gov.in",
        "status": "pending",
        "isOverdue": false,
        "createdBy": { "...full user document..." },
        "paidBy": null, "paidAt": null
      }
    ]
  }
}
```

> `isOverdue` is computed and injected into each result — it is not stored in the database.

---

### `POST /api/account/tax`
Create a tax entry.

| Field | Type | Required |
|-------|------|----------|
| state | string | ✓ |
| dueDate | ISO date | ✓ |
| amount | number | ✓ |
| websiteLink | string | optional |

`createdBy` is auto-set from the JWT token.

```json
{ "data": { "tax": { "...full tax document..." } } }
```

---

### `PUT /api/account/tax/:taxId/mark-paid`
Mark a tax entry as paid. Sets `status = paid`, `paidBy = logged-in user`, `paidAt = now`. AuditLogged.

No request body required.

```json
{
  "message": "Tax marked as paid",
  "data": {
    "tax": {
      "_id": "64f...", "state": "Tamil Nadu",
      "status": "paid",
      "paidBy": "64f...",
      "paidAt": "2024-04-28T09:00:00.000Z"
    }
  }
}
```


---

## Customer Panel

> 🔒 Customer auth — uses `POST /api/customer/auth/login` (separate from employee login). Returns a JWT with `type: 'customer'` in payload. All protected routes require this token as `Authorization: Bearer <token>`.

> ⚠️ Employee tokens cannot be used on customer routes and vice versa.

All routes under `/api/customer/*`.

---

### Customer Auth

### `POST /api/customer/auth/login`
No auth required.

**Default password** = the customer's phone number without country code (set automatically when customer was created via chat, import, or admin). Frontend should detect `passwordChangedAt: null` and prompt first-time password change.

```json
// Request
{ "email": "arjun@example.com", "password": "9876543210" }

// Response 200
{
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "customer": {
      "_id": "64f...", "firstName": "Arjun",
      "email": "arjun@example.com",
      "customerId": "CUST-0001", "photo": null
    }
  }
}
```

Errors: `400 — Email and password are required` | `401 — No account found with that email address` | `401 — Incorrect password` | `401 — This account has been deactivated`

---

### `POST /api/customer/auth/refresh`
No auth required.

```json
// Request
{ "refreshToken": "eyJhbGci..." }

// Response 200
{ "data": { "accessToken": "eyJhbGci..." } }
```

---

### `PUT /api/customer/auth/change-password`
Requires customer JWT.

```json
// Request
{ "currentPassword": "9876543210", "newPassword": "MyNewPass@123" }

// Response 200
{ "message": "Password updated successfully" }
```

Errors: `400 — Both currentPassword and newPassword are required` | `400 — Current password is incorrect`

---

### Forgot Password (OTP Reset) — Customer

Same three-step pattern as staff. No auth required.

**Step 1 — Request OTP**

### `POST /api/customer/auth/forgot-password`

**Request body**
```json
{ "email": "arjun@example.com" }
```

**Response 200**
```json
{ "message": "If that email exists, an OTP has been sent" }
```

6-digit OTP emailed to the address. Valid for **10 minutes**. Always returns 200.

---

**Step 2 — Verify OTP**

### `POST /api/customer/auth/verify-otp`

**Request body**
```json
{ "email": "arjun@example.com", "otp": "483920" }
```

**Response 200**
```json
{ "message": "OTP verified successfully", "data": { "resetToken": "eyJhbGci..." } }
```

`resetToken` valid for 5 minutes. Single use.

Errors: `400 — Invalid OTP` | `400 — OTP has expired. Please request a new one`

---

**Step 3 — Reset Password**

### `POST /api/customer/auth/reset-password`

**Request body**
```json
{ "resetToken": "eyJhbGci...", "newPassword": "MyNewPass@123" }
```

**Response 200**
```json
{ "message": "Password reset successfully" }
```

Errors: `400 — Invalid or expired reset token` | `400 — OTP not verified. Please start over`

---

### Customer Dashboard

### `GET /api/customer/dashboard`
Dashboard stats and financial overview in one call. Requires customer JWT.

```json
{
  "data": {
    "activeProjects": 3,
    "closedProjects": 5,
    "drawingsAndApprovals": 7,
    "totalProjectValue": 840000,
    "totalPaid": 560000,
    "totalPending": 280000,
    "upcomingInvoice": {
      "invoiceNumber": "INV-0005",
      "totalAmount": 95000,
      "dueDate": "2024-04-22T00:00:00.000Z",
      "leadId": "64f...",
      "buildingType": "Warehouse",
      "location": "Chennai"
    }
  }
}
```

> `drawingsAndApprovals` counts documents across all leads where `type` is `drawing` or `approval`. `upcomingInvoice` is `null` if no upcoming invoices exist. `dueDate` is computed as `invoice.date + invoice.daysToPay`.

---

### Customer Projects

### `GET /api/customer/projects`
All projects (leads) for this customer. Requires customer JWT.

**Query params:** `?lifecycleStatus=&page=&limit=`

```json
{
  "data": {
    "projects": [{
      "_id": "64f...", "buildingType": "Warehouse",
      "location": "Chennai", "lifecycleStatus": "proposal_sent",
      "quoteValue": 280000, "isQuoteReady": true, "source": "chat",
      "assignedSales": { "name": "Ravi Kumar", "email": "ravi@co.com" },
      "documents": [{ "url": "...", "name": "blueprint.pdf", "type": "drawing" }]
    }],
    "total": 8, "page": 1, "limit": 20
  }
}
```

---

### `GET /api/customer/projects/:leadId`
Full project detail — lead, quotation, AI summary, invoices, payment schedule in one call.

```json
{
  "data": {
    "lead": {
      "_id": "64f...", "buildingType": "Warehouse", "location": "Chennai",
      "lifecycleStatus": "proposal_sent", "quoteValue": 280000,
      "documents": [{ "url": "...", "name": "site-plan.pdf", "type": "drawing" }],
      "assignedSales": { "name": "Ravi Kumar", "email": "ravi@co.com" }
    },
    "quotation": {
      "buildingType": "Warehouse", "basePrice": 250000, "maxPrice": 300000,
      "roofStyle": "Gable", "validTill": "2024-05-30T00:00:00.000Z",
      "status": "sent", "includedMaterials": [], "optionalAddOns": [],
      "specialNote": "Price locked for 30 days"
    },
    "quoteSummary": {
      "summary": "This quotation covers a 5000 sqft warehouse...",
      "generatedAt": "2024-03-01T10:07:00.000Z"
    },
    "invoices": [{
      "_id": "64f...", "invoiceNumber": "INV-0001", "poNumber": "PO-0001",
      "totalAmount": 280000, "status": "sent",
      "date": "2024-03-15T00:00:00.000Z", "daysToPay": 30, "lineItems": []
    }],
    "paymentSchedule": {
      "totalAmount": 280000,
      "payments": [
        { "name": "Deposit", "amount": 30, "amountType": "percentage", "status": "paid", "paidAt": "..." },
        { "name": "On delivery", "amount": 70, "amountType": "percentage", "status": "pending" }
      ]
    }
  }
}
```

> `internalNotes` is stripped from quotation. `paidBy` and `createdBy` are stripped from invoices.

Errors: `403 — This project does not belong to your account` | `404 — No project found with that ID`

---

### `POST /api/customer/projects`
Customer creates a new project request from the portal.

| Field | Type | Required |
|-------|------|----------|
| buildingType | string | ✓ |
| location | string | ✓ |
| roofStyle | string | optional |
| sqft | string | optional |
| width / length | number | optional |
| description | string | optional — stored as context for sales |

```json
{
  "data": {
    "lead": {
      "_id": "64f...", "buildingType": "Office", "location": "Bangalore",
      "source": "customer_portal", "lifecycleStatus": "initial_contact",
      "assignedSales": null
    }
  }
}
```

> Creates lead with `source = customer_portal`, `assignedSales = null`. Admin assigns from their panel. AuditLogged with `customer.project_created`.

Errors: `400 — buildingType is required to create a project` | `400 — location is required to create a project`

---

### Customer Documents

### `GET /api/customer/documents`
All documents across all projects, grouped by project. Requires customer JWT.

**Query params:** `?type=drawing|approval|general|contract|photo|other`

```json
{
  "data": {
    "projects": [{
      "lead": {
        "_id": "64f...", "buildingType": "Warehouse",
        "location": "Chennai", "lifecycleStatus": "proposal_sent"
      },
      "documents": [{
        "_id": "64f...", "url": "https://s3.../blueprint.pdf",
        "name": "blueprint.pdf", "type": "drawing",
        "uploadedBy": "64f...",
        "uploadedAt": "2024-02-01T00:00:00.000Z"
      }],
      "count": 3
    }],
    "totalDocuments": 11
  }
}
```

> Only projects that have at least one document (after type filter) are returned.

---

### Customer Payments

### `GET /api/customer/payments`
All invoices grouped as upcoming / overdue / paid. Requires customer JWT.

```json
{
  "data": {
    "upcoming": [{
      "_id": "64f...", "invoiceNumber": "INV-0003",
      "totalAmount": 95000, "status": "sent",
      "dueDate": "2024-04-22T00:00:00.000Z",
      "lead": { "buildingType": "Warehouse", "location": "Chennai" }
    }],
    "overdue": [{
      "_id": "64f...", "invoiceNumber": "INV-0002",
      "totalAmount": 45000, "status": "sent",
      "dueDate": "2024-03-01T00:00:00.000Z",
      "lead": { "buildingType": "Office", "location": "Bangalore" }
    }],
    "paid": [{
      "_id": "64f...", "invoiceNumber": "INV-0001",
      "totalAmount": 280000, "status": "paid",
      "paidAt": "2024-03-20T09:00:00.000Z",
      "lead": { "buildingType": "Warehouse", "location": "Chennai" }
    }]
  }
}
```

> `upcoming` = sent invoices where computed `dueDate >= now`. `overdue` = sent invoices where `dueDate < now`. `paid` = invoices with `status = paid`. All three arrays always present even if empty. `paidBy` is never exposed.

---

### `GET /api/customer/payments/invoices`
All invoices grouped by project, with totals per project. Requires customer JWT.

**Query params:** `?status=sent|paid|overdue`

```json
{
  "data": {
    "projects": [{
      "lead": {
        "_id": "64f...", "buildingType": "Warehouse",
        "location": "Chennai", "lifecycleStatus": "payment_done"
      },
      "invoices": [{
        "_id": "64f...", "invoiceNumber": "INV-0001", "poNumber": "PO-0001",
        "totalAmount": 280000, "status": "paid",
        "date": "2024-03-15T00:00:00.000Z", "daysToPay": 30,
        "dueDate": "2024-04-14T00:00:00.000Z"
      }],
      "projectTotal": 280000,
      "projectPaid": 280000,
      "projectPending": 0
    }]
  }
}
```

> `dueDate` is computed and injected into each invoice. Projects with no invoices are excluded.

---

### Customer Profile

### `GET /api/customer/profile`
Current customer's profile. Requires customer JWT.

```json
{
  "data": {
    "customer": {
      "_id": "64f...", "customerId": "CUST-0001",
      "firstName": "Arjun", "email": "arjun@example.com",
      "phone": { "number": "9876543210", "countryCode": "+91" },
      "photo": null, "isActive": true, "source": "chat",
      "passwordChangedAt": null
    }
  }
}
```

> `password` is never returned. `passwordChangedAt: null` means customer is still on the default phone-number password.

---

### `PUT /api/customer/profile`
Update own profile. Only `firstName` and `photo` are editable. Requires customer JWT.

```json
// Request
{ "firstName": "Arjun K", "photo": "https://s3.../photo.jpg" }

// Response 200
{ "message": "Profile updated successfully", "data": { "customer": { "..." } } }
```

> Email and phone are not editable here — those require a verification flow. Do not build an email change form against this endpoint.

Errors: `400 — No updatable fields provided — send firstName or photo`
