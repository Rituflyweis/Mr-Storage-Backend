# Construction AI — API Reference

## Table of Contents

- [Base URL & Auth](#base-url--auth)
- [Standard Response](#standard-response)
- [Errors & Status Codes](#errors--status-codes)
- [Authentication](#authentication)
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

---

## Base URL & Auth

```
http://localhost:5001        — development
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
const socket = io('http://localhost:5001/chat')

// Admin / Sales panel — JWT required
const socket = io('http://localhost:5001/admin', {
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
