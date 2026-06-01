## How to read this doc

Every changed endpoint uses the same layout:

| Block | Meaning |
|-------|---------|
| **Previous request body** | What the API accepted before (or `N/A` if new endpoint) |
| **Current request body** | What to send now |
| **Previous response body** | Shape under `data` before (envelope unchanged) |
| **Current response body** | Shape under `data` now |

**Global envelope (all endpoints):**

```json
// Success
{ "success": true, "message": "Success", "data": { } }

// Error
{ "success": false, "message": "Human-readable error", "errors": [] }
```

`errors` is only present for validation failures (express-validator).

**Auth header (all endpoints below):**

```http
Authorization: Bearer <access_token>
```

---

## Shared enums & field maps

### `Lead.source` (when accepted)

`chat` | `manual` | `import` | `customer_portal`

### Invoice `status` (workflow — do not send on create)

`draft` | `sent` | `paid` | `overdue` | `cancelled`

Set by server: `draft` on create; `sent` after `POST .../send`; `paid` after `PUT .../mark-paid`.

### Payment schedule `amountType` (stage)

`percentage` | `fixed`

### Payment schedule stage `status`

`pending` | `invoiced` | `paid` | `overdue`

### PO `status` (query filter)

`pending` | `approved` | `rejected`

### `lifecycleStatus` (edit lead)

`initial_contact` | `requirements_gathered` | `proposal_sent` | `negotiation` | `deal_closed` | `payment_done` | `converted_to_po` | `sent_to_admin`

### Lead `temperature` (hot / warm / cold)

| Value | Meaning |
|-------|---------|
| `hot` | Score ≥ 70 (auto) or set manually |
| `warm` | Score 40–69 (auto) or set manually |
| `cold` | Score &lt; 40 (auto) or set manually |

Query filter `status` on `GET /api/admin/leads/by-score` and `GET /api/sales/leads/by-score` is an alias for **`temperature`** (not lifecycle status).

### Door / window / insulation (request → DB)

| Request keys | Stored as |
|--------------|-----------|
| `doors` or `door` | `Lead.numDoors` |
| `windows` or `window` | `Lead.numWindows` |
| `insulation` | `Lead.numInsulation` |

### When is `source` allowed in the body?

| Flow | Endpoint(s) | `source` in body? |
|------|-------------|-------------------|
| Create **project** (inside customer) | `POST .../customers/:id/leads`, `POST .../customers/:id/projects`, `POST /admin/customers` | **No** — server uses `manual` |
| Create **lead** (lead section modal) | `POST /admin/leads`, `POST /sales/leads` | **Yes** — optional |

### Panel → API map

| UI screen | Admin | Sales |
|-----------|-------|-------|
| Create customer + first project | `POST /api/admin/customers` | — |
| Customer detail → add project | `POST /api/admin/customers/:customerId/leads` | `POST /api/sales/customers/:customerId/projects` |
| Lead section → add lead | `POST /api/admin/leads` | `POST /api/sales/leads` |
| Lead section → list leads | `GET /api/admin/leads` | `GET /api/sales/leads` |
| Edit customer | `PUT /api/admin/customers/:customerId` | `PUT /api/sales/customers/:customerId` |
| Edit lead / project | `PUT /api/admin/leads/:leadId` | `PUT /api/sales/leads/:leadId` |
| Assign sales rep (admin only) | `PUT /api/admin/leads/:leadId/assign` | — (sales auto-assigned on create) |
| Export leads (Excel → S3 URL) | `GET /api/admin/leads/export/excel` | `GET /api/sales/leads/export/excel` |
| Leads by score | `GET /api/admin/leads/by-score` | `GET /api/sales/leads/by-score` |
| Set lead temperature | `PUT /api/admin/leads/:leadId/temperature` | `PUT /api/sales/leads/:leadId/temperature` |
| Employee audit / last activity | `GET /api/admin/employees/audit-log` | — |
| Employee assigned leads | `GET /api/admin/employees/:userId/assigned-leads` | — |
| Reports & analytics | `GET /api/admin/reports/analytics` | admin only |
| Create invoice (project in URL) | `POST /api/leads/:leadId/invoices` | `POST /api/leads/:leadId/invoices` |
| Get / edit / send / mark paid invoice | `GET/PUT/POST /api/invoices/:invoiceId` (+ actions) | same |
| Edit draft invoice (full body) | `PUT /api/invoices/:invoiceId` | same — body now matches create (§38) |
| List invoices for project | `GET /api/leads/:leadId/invoices` | same |
| **Global invoice stats** | `GET /api/invoices/stats` | **same URL** — admin sees all, sales sees assigned leads only |
| **Global invoice list** | `GET /api/invoices` | **same URL** — dynamic scope by JWT role |
| **Customer lookup (filters)** | `GET /api/customers` | **same URL** — admin all, sales customers on assigned leads |
| **Lead / project lookup (filters)** | `GET /api/leads` | **same URL** — admin all leads, sales assigned only |
| Payment schedule (per lead) | `POST/GET /api/payment-schedules` | same |

**Auth:** All common invoice + payment-schedule routes require JWT role **`admin`** or **`sales`**. Sales must own the lead (`assignedSales` = current user) for create, **update draft**, and mark-paid.

---

## Index

| # | Method | Endpoint | Role |
|---|--------|----------|------|
| 1 | GET | `/api/admin/po-orders` | admin |
| 1b | GET | `/api/admin/po-orders/:poOrderId` | admin |
| 2 | POST | `/api/admin/customers` | admin |
| 3 | PUT | `/api/admin/customers/:customerId` | admin |
| 4 | POST | `/api/admin/leads` | admin |
| 5 | PUT | `/api/admin/leads/:leadId` | admin |
| 6 | PATCH | `/api/admin/customers/:customerId/deactivate` | admin |
| 7 | GET | `/api/admin/customers/:customerId/invoices` | admin |
| 8 | POST | `/api/admin/customers/:customerId/leads` | admin |
| 9 | POST | `/api/sales/customers/:customerId/projects` | sales |
| 10 | POST | `/api/sales/leads` | sales |
| 11 | PUT | `/api/sales/leads/:leadId` | sales |
| 12 | PUT | `/api/sales/customers/:customerId` | sales |
| 13 | GET | `/api/admin/meetings` | admin |
| 14 | GET | `/api/admin/meetings/:meetingId` | admin |
| 15 | GET | `/api/admin/leads/export/excel` | admin |
| 16 | GET | `/api/sales/leads/export/excel` | sales |
| 17 | GET | `/api/admin/leads/by-score` | admin |
| 18 | PUT | `/api/admin/leads/:leadId/temperature` | admin |
| 19 | GET | `/api/admin/employees/audit-log` | admin |
| 28 | GET | `/api/admin/employees/:userId/assigned-leads` | admin |
| 29 | POST | `/api/leads/:leadId/invoices` | admin, sales |
| 30 | GET | `/api/invoices/:invoiceId` | admin, sales |
| 31 | PUT | `/api/invoices/:invoiceId` | admin, sales |
| 32 | POST | `/api/invoices/:invoiceId/send` | admin, sales |
| 33 | PUT | `/api/invoices/:invoiceId/mark-paid` | admin, sales |
| 34 | GET | `/api/leads/:leadId/invoices` | admin, sales |
| 37a | GET | `/api/invoices/stats` | admin, sales |
| 37b | GET | `/api/invoices` | admin, sales |
| 38 | PUT | `/api/invoices/:invoiceId` | admin, sales |
| 39a | GET | `/api/customers` | admin, sales |
| 39b | GET | `/api/leads` | admin, sales |
| 40 | GET | `/api/admin/reports/analytics` | admin |
| 35 | POST | `/api/payment-schedules` | admin, sales |
| 36 | GET | `/api/payment-schedules/lead/:leadId` | admin, sales |
| 24 | GET | `/api/sales/leads` | sales |
| 25 | GET | `/api/sales/leads/by-score` | sales |
| 26 | PUT | `/api/sales/leads/:leadId/temperature` | sales |

---

## 1. `GET /api/admin/po-orders`

| | |
|---|---|
| **Role** | `admin` |
| **Change** | Response only — new `invoicePayment`; slimmer `invoiceId` |

### Path parameters

None.

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|--------|
| `status` | string | No | — | `pending`, `approved`, `rejected` |
| `startDate` | ISO date string | No | — | Filter on `createdAt` |
| `endDate` | ISO date string | No | — | Filter on `createdAt` |

*Query params unchanged.*

### Request body

**Previous:** `N/A` (GET)

**Current:** `N/A` (GET)

### Response body

**HTTP status:** `200` (unchanged)

#### Previous (`data`)

```json
{
  "orders": [
    {
      "_id": "665a00000000000000000001",
      "leadId": { },
      "customerId": { },
      "raisedBy": { },
      "assignedTo": { },
      "invoiceId": {
        "_id": "...",
        "leadId": "...",
        "customerId": "...",
        "invoiceNumber": "INV-0001",
        "lineItems": [],
        "subtotal": 0,
        "totalAmount": 50000,
        "status": "paid",
        "poNumber": "PO-0042"
      },
      "quotationId": { },
      "poNumber": "PO-0042",
      "status": "approved",
      "adminNotes": "",
      "createdAt": "2026-05-20T10:00:00.000Z",
      "updatedAt": "2026-05-21T09:00:00.000Z"
    }
  ]
}
```

`invoiceId` was the **full** invoice document.

#### Current (`data`)

```json
{
  "orders": [
    {
      "_id": "665a00000000000000000001",
      "leadId": { },
      "customerId": { },
      "raisedBy": { },
      "assignedTo": {
        "name": "Plant User",
        "email": "plant@example.com",
        "role": "plant"
      },
      "invoiceId": {
        "_id": "...",
        "invoiceNumber": "INV-0001",
        "status": "paid",
        "poNumber": "PO-0042",
        "paidAt": "2026-05-20T10:00:00.000Z"
      },
      "quotationId": { },
      "poNumber": "PO-0042",
      "status": "approved",
      "adminNotes": "",
      "createdAt": "2026-05-20T10:00:00.000Z",
      "updatedAt": "2026-05-21T09:00:00.000Z",
      "invoicePayment": {
        "status": "paid",
        "isPaid": true
      }
    }
  ]
}
```

| New field | Type | Notes |
|-----------|------|--------|
| `invoicePayment` | object \| null | Use for paid/unpaid badge in list |
| `invoicePayment.status` | string | Invoice status |
| `invoicePayment.isPaid` | boolean | `true` only when `status === "paid"` |

### Errors

| HTTP | When |
|------|------|
| 401 | Missing/invalid token |
| 403 | Not admin role |

---

## 1b. `GET /api/admin/po-orders/:poOrderId` — PO detail

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin PO detail / review screen |
| **Change** | **New** — full lead, quotation, customer, audit trail |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `poOrderId` | MongoId | Yes |

### Query parameters

None.

### Response `200` — `data`

```json
{
  "order": {
    "_id": "...",
    "leadId": "...",
    "customerId": "...",
    "raisedBy": { "name": "...", "email": "...", "role": "sales" },
    "assignedTo": { "name": "...", "email": "...", "role": "plant" },
    "invoiceId": { },
    "quotationId": "...",
    "poNumber": "PO-0042",
    "status": "pending",
    "adminNotes": "",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "lead": {
    "_id": "...",
    "customerId": {
      "_id": "...",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "email": "jane@example.com",
      "phone": { "number": "...", "countryCode": "+1" }
    },
    "assignedSales": { "name": "...", "email": "...", "role": "sales" },
    "projectName": "Warehouse A",
    "lifecycleStatus": "sent_to_admin",
    "quoteValue": 175000,
    "lineItems": [],
    "documents": []
  },
  "quotation": {
    "_id": "...",
    "quoteNumber": "QUO-0001",
    "leadId": "...",
    "lineItems": [],
    "createdBy": { "name": "...", "email": "..." },
    "assignedSalesperson": { "name": "...", "email": "..." }
  },
  "customer": { },
  "auditLog": [
    {
      "_id": "...",
      "type": "po",
      "action": "lead.po_approved",
      "leadId": "...",
      "performedBy": { "name": "Admin", "email": "..." },
      "metadata": {},
      "createdAt": "..."
    }
  ]
}
```

| Field | Notes |
|-------|--------|
| `lead` | Full lead document; `customerId` and `assignedSales` populated |
| `quotation` | Full quotation document; `createdBy` and `assignedSalesperson` populated |
| `customer` | Same object as `lead.customerId` (convenience for FE) |
| `auditLog` | All audit entries for the lead, oldest first |
| `order.invoiceId` | Full invoice document |

### Errors

| HTTP | When |
|------|------|
| 404 | PO order, lead, or quotation not found |

---

## 2. `POST /api/admin/customers`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Customer section — create customer + first project |
| **Change** | Request accepts full project fields; **`source` not accepted** |

### Path parameters

None.

### Query parameters

None.

### Request body

**HTTP status:** `201 Created`

#### Previous

```json
{
  "firstName": "Jane",
  "email": "jane@example.com",
  "phone": "9876543210",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "projectName": "Warehouse A"
}
```

Optional in practice but not validated: `countryCode`, `assignedSales`.  
Ignored if sent: `quoteValue`, `roofStyle`, `width`, `length`, `height`, `doors`, `windows`, `insulation`, `source`.

#### Current

```json
{
  "firstName": "Jane",
  "email": "jane@example.com",
  "phone": "9876543210",
  "countryCode": "+91",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "quoteValue": 150000,
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "assignedSales": "665a00000000000000000003"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `firstName` | Yes | |
| `email` | Yes | Unique |
| `phone` | Yes | Also used as initial login password |
| `countryCode` | No | Default `""` |
| `projectName` | Yes | |
| `buildingType` | Yes | |
| `location` | Yes | On **Lead** |
| `quoteValue` | No | Default `0` |
| `roofStyle` | No | |
| `width`, `length`, `height` | No | Numbers |
| `doors`, `windows`, `insulation` | No | Numbers |
| `assignedSales` | No | MongoId |
| `source` | **Do not send** | Server sets `manual` |

### Response body

#### Previous (`data`)

```json
{
  "customer": {
    "_id": "...",
    "customerId": "CUS-00042",
    "firstName": "Jane",
    "email": "jane@example.com",
    "phone": { "number": "9876543210", "countryCode": "" },
    "isActive": true,
    "source": "manual",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "lead": {
    "_id": "...",
    "projectName": "Warehouse A",
    "buildingType": "Storage",
    "location": "Austin, TX",
    "source": "manual",
    "quoteValue": 0,
    "numDoors": null,
    "numWindows": null,
    "numInsulation": null
  }
}
```

Optional lead fields were **not saved** even if sent.

#### Current (`data`)

Same top-level keys `{ customer, lead }`. `lead` now includes all sent project fields (`quoteValue`, `roofStyle`, `width`, `numDoors`, etc.).  
`customer.password` is never returned.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Validation / duplicate email |
| 400 | `Customer with this email already exists` |

---

## 3. `PUT /api/admin/customers/:customerId`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Edit customer profile |
| **Change** | **New endpoint** |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `customerId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `200`

#### Previous

`N/A` — endpoint did not exist.

#### Current

At least **one** of `firstName`, `email`, `phone` required.

```json
{
  "firstName": "Jane Doe",
  "email": "jane.doe@example.com",
  "phone": "9876543211",
  "countryCode": "+91"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `firstName` | No* | Non-empty if sent |
| `email` | No* | Unique if changed |
| `phone` | No* | Non-empty if sent |
| `countryCode` | No | With `phone` or alone |

\*At least one of the three must be sent.

### Response body

#### Previous

`N/A`

#### Current (`data`)

```json
{
  "customer": {
    "_id": "...",
    "customerId": "CUS-00042",
    "firstName": "Jane Doe",
    "email": "jane.doe@example.com",
    "phone": {
      "number": "9876543211",
      "countryCode": "+91"
    },
    "isActive": true,
    "source": "manual",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### Errors

| HTTP | Message |
|------|---------|
| 400 | At least one field required |
| 400 | Empty field / email taken |
| 404 | Customer not found |

---

## 4. `POST /api/admin/leads`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Lead section — add lead (select customer) |
| **Change** | Full project body + **`source` allowed** |

### Path parameters

None.

### Query parameters

None.

### Request body

**HTTP status:** `201 Created`

#### Previous

```json
{
  "customerId": "665a00000000000000000001",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX"
}
```

Optional unvalidated: `roofStyle`, `width`, `length`, `height`, `assignedSales`.  
`source`, doors, `quoteValue` ignored.

#### Current

```json
{
  "customerId": "665a00000000000000000001",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "source": "manual",
  "quoteValue": 150000,
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "assignedSales": "665a00000000000000000003"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `customerId` | Yes | Existing customer |
| `projectName` | Yes | |
| `buildingType` | Yes | |
| `location` | Yes | |
| `source` | No | Optional; default `manual` |
| `quoteValue`, `roofStyle`, dimensions, doors/windows/insulation` | No | |
| `assignedSales` | No | MongoId |

### Response body

#### Previous (`data`)

```json
{
  "lead": {
    "_id": "...",
    "customerId": "...",
    "projectName": "Warehouse A",
    "buildingType": "Storage",
    "location": "Austin, TX",
    "source": "manual",
    "quoteValue": 0
  }
}
```

#### Current (`data`)

```json
{
  "lead": {
    "_id": "...",
    "customerId": "...",
    "projectName": "Warehouse A",
    "buildingType": "Storage",
    "location": "Austin, TX",
    "source": "manual",
    "quoteValue": 150000,
    "roofStyle": "Gable",
    "width": 40,
    "length": 60,
    "height": 12,
    "numDoors": 2,
    "numWindows": 4,
    "numInsulation": 1,
    "assignedSales": "...",
    "isHandedToSales": true
  }
}
```

Shape unchanged (`{ lead }`); persisted fields expanded.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `source` |
| 400 | Duplicate project name for customer |
| 404 | Customer not found |

---

## 5. `PUT /api/admin/leads/:leadId`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Edit lead / project |
| **Change** | Request body greatly expanded |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `200`

At least **one** field required.

#### Previous

```json
{
  "buildingType": "Cold Storage",
  "location": "Austin, TX",
  "quoteValue": 150000,
  "lifecycleStatus": "negotiation"
}
```

#### Current

```json
{
  "projectName": "Warehouse A - Phase 2",
  "buildingType": "Cold Storage",
  "location": "Dallas, TX",
  "source": "manual",
  "quoteValue": 175000,
  "roofStyle": "Flat",
  "width": 50,
  "length": 70,
  "height": 14,
  "doors": 3,
  "windows": 6,
  "insulation": 2,
  "notes": "Updated specs",
  "lifecycleStatus": "negotiation"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| All fields | No* | Partial update |
| `source` | No | Cannot be `null` |
| `width`, `length`, `height`, `doors`, `windows`, `insulation` | No | Send `null` to clear |
| `quoteValue` | No | `null` → `0` |
| `assignedSales` | **Do not send** | Use `PUT .../assign` |

\*At least one field required.

**Assign sales rep (unchanged separate call):**

```http
PUT /api/admin/leads/:leadId/assign
```

```json
{ "employeeId": "665a00000000000000000003" }
```

### Response body

#### Previous (`data`)

```json
{
  "lead": { }
}
```

Full lead document returned (Mongoose); only listed fields were updated.

#### Current (`data`)

```json
{
  "lead": { }
}
```

Same — full updated `lead` document.

### Errors

| HTTP | Message |
|------|---------|
| 400 | No fields / invalid source / duplicate project name |
| 404 | Lead not found |

---

## 6. `PATCH /api/admin/customers/:customerId/deactivate`

| | |
|---|---|
| **Role** | `admin` |
| **Change** | **Updated** — toggles active status (deactivate **or** reactivate) |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `customerId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `200`  
**Message:** `Customer deactivated` when turning off; `Customer activated` when turning on.

#### Previous

None (empty body). Endpoint only deactivated: set `isActive` to `false`. If already inactive → **400** `Customer is already inactive`. Audit action always `customer.deactivated`.

#### Current

None (empty body). **Toggle** `isActive`:

| Before call | After call | Top-level `message` | Audit `action` |
|-------------|------------|---------------------|----------------|
| `isActive: true` | `false` | `Customer deactivated` | `customer.deactivated` |
| `isActive: false` | `true` | `Customer activated` | `customer.activated` |

New audit constant: `CUSTOMER_ACTIVATED` → `customer.activated` (see §22). Shown in employee audit log / timeline via `displayMessage` (e.g. “Customer activated: Jane”).

### Response body

#### Previous (`data`)

Same shape; `customer.isActive` always `false` on success.

#### Current (`data`)

```json
{
  "customer": {
    "_id": "...",
    "customerId": "CUS-00042",
    "firstName": "Jane",
    "email": "jane@example.com",
    "phone": { "number": "9876543210", "countryCode": "+91" },
    "isActive": false,
    "source": "manual",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

`isActive` reflects the **new** state (`false` after deactivate, `true` after reactivate).

### Errors

| HTTP | Message |
|------|---------|
| 404 | Customer not found |

**Removed:** `400` — `Customer is already inactive` (inactive customers are reactivated instead).

---

## 7. `GET /api/admin/customers/:customerId/invoices`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Customer detail — invoices tab |
| **Change** | **New endpoint** |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `customerId` | MongoId | Yes |

### Query parameters

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|--------|
| `page` | number | No | `1` | |
| `limit` | number | No | `20` | |
| `status` | string | No | — | Invoice status enum |
| `startDate` | ISO date | No | — | Invoice `createdAt` |
| `endDate` | ISO date | No | — | Invoice `createdAt` |

#### Previous

`N/A` — endpoint did not exist.

#### Current

Same as table above.

### Request body

**Previous / Current:** `N/A` (GET)

### Response body

**HTTP status:** `200`

#### Previous

`N/A`

#### Current (`data`)

```json
{
  "customer": {
    "_id": "...",
    "customerId": "CUS-00042",
    "firstName": "Jane"
  },
  "invoices": [
    {
      "_id": "...",
      "invoiceNumber": "INV-0001",
      "status": "paid",
      "totalAmount": 50000,
      "poNumber": "PO-0042",
      "date": "2026-05-01T10:00:00.000Z",
      "paidAt": "2026-05-10T12:00:00.000Z",
      "leadId": {
        "_id": "...",
        "projectName": "Warehouse A",
        "jobId": "PRO-001",
        "lifecycleStatus": "deal_closed"
      },
      "createdBy": { "name": "Sales Rep", "email": "sales@example.com" },
      "paidBy": { "name": "Account User", "email": "account@example.com" }
    }
  ],
  "total": 15,
  "page": 1,
  "limit": 10
}
```

Sorted by `createdAt` descending.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `status` |
| 404 | Customer not found |

---

## 8. `POST /api/admin/customers/:customerId/leads`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Customer detail — add project |
| **Change** | Full project fields; **`source` not accepted** |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `customerId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `201 Created`

#### Previous

```json
{
  "projectName": "Warehouse B",
  "buildingType": "Storage",
  "location": "Dallas, TX"
}
```

Optional: `roofStyle`, `width`, `length`, `height`, `assignedSales`.  
No doors / quote / insulation.

#### Current

```json
{
  "projectName": "Warehouse B",
  "buildingType": "Storage",
  "location": "Dallas, TX",
  "quoteValue": 120000,
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "assignedSales": "665a00000000000000000003"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `projectName` | Yes | |
| `buildingType` | Yes | |
| `location` | Yes | |
| `quoteValue`, `roofStyle`, dimensions, doors/windows/insulation` | No | |
| `assignedSales` | No | Inherits last rep on customer if omitted |
| `source` | **Do not send** | Server sets `manual` |

### Response body

#### Previous (`data`)

```json
{
  "lead": {
    "_id": "...",
    "projectName": "Warehouse B",
    "buildingType": "Storage",
    "location": "Dallas, TX",
    "source": "manual",
    "quoteValue": 0
  }
}
```

#### Current (`data`)

```json
{
  "lead": {
    "_id": "...",
    "projectName": "Warehouse B",
    "buildingType": "Storage",
    "location": "Dallas, TX",
    "source": "manual",
    "quoteValue": 120000,
    "roofStyle": "Gable",
    "width": 40,
    "length": 60,
    "height": 12,
    "numDoors": 2,
    "numWindows": 4,
    "numInsulation": 1,
    "assignedSales": "..."
  }
}
```

### Errors

| HTTP | Message |
|------|---------|
| 400 | Duplicate project name |
| 404 | Customer not found |

---

## 9. `POST /api/sales/customers/:customerId/projects`

| | |
|---|---|
| **Role** | `sales` |
| **UI** | Customer detail — add project |
| **Change** | Full project fields; auto-assign rep; **`source` not accepted** |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `customerId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `201 Created`

#### Previous

```json
{
  "projectName": "Warehouse B",
  "buildingType": "Storage",
  "location": "Dallas, TX"
}
```

Optional: `roofStyle`, `width`, `length`, `height`.

#### Current

Same as admin §8 project body, but **no `assignedSales`**:

```json
{
  "projectName": "Warehouse B",
  "buildingType": "Storage",
  "location": "Dallas, TX",
  "quoteValue": 120000,
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "doors": 2,
  "windows": 4,
  "insulation": 1
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `projectName` | Yes | |
| `buildingType` | Yes | |
| `location` | Yes | |
| Other project fields | No | |
| `assignedSales` | **Do not send** | Set to logged-in user |
| `source` | **Do not send** | Server sets `manual` |

### Response body

#### Previous (`data`)

```json
{
  "lead": {
    "_id": "...",
    "assignedSales": "<logged-in user>",
    "source": "manual",
    "quoteValue": 0
  }
}
```

#### Current (`data`)

```json
{
  "lead": {
    "_id": "...",
    "assignedSales": "<logged-in user>",
    "source": "manual",
    "quoteValue": 120000,
    "numDoors": 2,
    "numWindows": 4,
    "numInsulation": 1
  }
}
```

### Errors

| HTTP | Message |
|------|---------|
| 403 | Customer not in portfolio |
| 404 | Customer not found |

---

## 10. `POST /api/sales/leads`

| | |
|---|---|
| **Role** | `sales` |
| **UI** | Lead section — add lead |
| **Change** | **Breaking** — no customer creation; requires `customerId` |

### Path parameters

None.

### Query parameters

None.

### Request body

**HTTP status:** `201 Created`

#### Previous (breaking)

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "email": "jane@example.com",
  "phone": "9876543210",
  "countryCode": "+91",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "projectName": "Warehouse A",
  "estimatedValue": 120000,
  "doors": 2,
  "windows": 4,
  "insulation": 1
}
```

Created a **new customer** if email was new.

#### Current

```json
{
  "customerId": "665a00000000000000000001",
  "projectName": "Warehouse B",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "source": "manual",
  "quoteValue": 120000,
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "notes": "Optional note",
  "leadStatus": "initial_contact"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `customerId` | Yes | Must exist |
| `projectName` | Yes | |
| `buildingType` | Yes | |
| `location` | Yes | |
| `source` | No | Optional |
| `quoteValue` | No | Was `estimatedValue` before — use `quoteValue` now |
| `notes`, `leadStatus` | No | `leadStatus` = lifecycle if valid |
| Customer fields | **Removed** | Do not send email/phone/name |

### Response body

#### Previous (`data`)

```json
{
  "lead": { },
  "customer": { },
  "isNewCustomer": true
}
```

#### Current (`data`)

```json
{
  "lead": {
    "_id": "...",
    "customerId": "...",
    "assignedSales": "<logged-in user>",
    "source": "manual",
    "quoteValue": 120000
  }
}
```

No `customer` or `isNewCustomer`.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid source / duplicate project name / inactive customer |
| 404 | Customer not found |

---

## 11. `PUT /api/sales/leads/:leadId`

| | |
|---|---|
| **Role** | `sales` |
| **UI** | Edit lead / project (own leads only) |
| **Change** | Aligned with admin §5 |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `200`

At least one field required. Same fields as admin §5.

#### Previous

```json
{
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 12,
  "notes": "Note text"
}
```

No `quoteValue`, `source`, doors, `lifecycleStatus`.

#### Current

```json
{
  "projectName": "Warehouse A - Updated",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "source": "manual",
  "quoteValue": 175000,
  "roofStyle": "Gable",
  "width": null,
  "doors": 3,
  "windows": 5,
  "insulation": 2,
  "notes": "Updated",
  "lifecycleStatus": "negotiation"
}
```

| Field | Notes |
|-------|--------|
| `assignedSales` | **Do not send** |
| Numerics | `null` clears |

### Response body

#### Previous / Current (`data`)

```json
{
  "lead": { }
}
```

Full lead document; shape unchanged.

### Errors

| HTTP | Message |
|------|---------|
| 403 | Not your lead |
| 404 | Lead not found |

---

## 12. `PUT /api/sales/customers/:customerId`

| | |
|---|---|
| **Role** | `sales` |
| **UI** | Edit customer (portfolio customers only) |
| **Change** | **New endpoint** — same as admin §3 |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `customerId` | MongoId | Yes |

### Query parameters

None.

### Request body

**HTTP status:** `200`

#### Previous

`N/A`

#### Current

Same as admin §3:

```json
{
  "firstName": "Jane Doe",
  "email": "jane.doe@example.com",
  "phone": "9876543211",
  "countryCode": "+91"
}
```

At least one of `firstName`, `email`, `phone` required.  
**Do not send:** `photo`, `address`, `isActive`, lead fields.

### Response body

#### Previous

`N/A`

#### Current (`data`)

```json
{
  "customer": {
    "_id": "...",
    "customerId": "CUS-00042",
    "firstName": "Jane Doe",
    "email": "jane.doe@example.com",
    "phone": { "number": "9876543211", "countryCode": "+91" },
    "isActive": true,
    "source": "manual",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### Errors

| HTTP | Message |
|------|---------|
| 403 | Not in portfolio |
| 400 | Validation / email taken |
| 404 | Customer not found |

---

## 13. `GET /api/admin/meetings`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Meetings list / calendar |
| **Change** | **Default list** excludes `completed` and `cancelled` (active/upcoming only); pass `?status=` for history; optional `search` on title; `leadId` populated |

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `status` | string | No | `scheduled`, `completed`, `cancelled`, or `rescheduled`. Omit for default (see **Current**). |
| `search` | string | No | Case-insensitive partial match on **meeting `title`** (e.g. `?search=Site`) |
| ~~`startDate`~~ | — | — | **Removed** — no longer filters `meetingTime` |
| ~~`endDate`~~ | — | — | **Removed** |

### Request body

None.

### Response body

#### Previous (`data`)

No `status` query → returned **all** meetings (including `completed` and `cancelled`). Same populated shape as below.

#### Current (`data`)

**Default (no `status`):** `status` is **`scheduled` or `rescheduled` only** (`completed` and `cancelled` excluded).

**Explicit `?status=`:** Returns only that status (e.g. `?status=completed` for history).

Sorted ascending by `meetingTime`. `customerId`, `leadId`, `assignedTo`, and `createdBy` are populated documents (or `leadId: null`).

```json
{
  "meetings": [
    {
      "_id": "...",
      "title": "Project discussion",
      "meetingTime": "2024-03-15T14:00:00.000Z",
      "duration": 60,
      "mode": "online",
      "meetingLink": "https://meet.google.com/abc",
      "notes": "Review warehouse specs",
      "status": "scheduled",
      "completedAt": null,
      "leadId": { "_id": "...", "jobId": "PRO-042", "projectName": "Warehouse A" },
      "customerId": { "_id": "...", "customerId": "CUS-00042", "firstName": "Jane", "email": "jane@example.com" },
      "assignedTo": { "_id": "...", "name": "Sales Rep", "email": "sales@example.com", "role": "sales" },
      "createdBy": { "_id": "...", "name": "Admin", "email": "admin@example.com", "role": "admin" },
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

**Examples**

| Request | Result |
|---------|--------|
| `GET /api/admin/meetings` | **Scheduled + rescheduled** only (default) |
| `GET /api/admin/meetings?status=scheduled` | Only scheduled |
| `GET /api/admin/meetings?status=completed` | Only completed (history) |
| `GET /api/admin/meetings?status=cancelled` | Only cancelled (history) |
| `GET /api/admin/meetings?search=Site` | Default status filter + title contains `Site` |
| `GET /api/admin/meetings?status=scheduled&search=visit` | Scheduled + title match |

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `status` value (validation) |

---

## 14. `GET /api/admin/meetings/:meetingId`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Meeting detail drawer / page |
| **Change** | **New endpoint** — single meeting with full populated relations |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `meetingId` | MongoId | Yes |

### Query parameters

None.

### Request body

None.

### Response body

#### Previous

`N/A` — endpoint did not exist. Frontend may have used list payload only.

#### Current (`data`)

```json
{
  "meeting": {
    "_id": "...",
    "title": "Project discussion",
    "meetingTime": "2024-03-15T14:00:00.000Z",
    "duration": 60,
    "mode": "online",
    "meetingLink": "https://meet.google.com/abc",
    "notes": "Review warehouse specs",
    "status": "scheduled",
    "completedAt": null,
    "customerId": {
      "_id": "...",
      "customerId": "CUS-00042",
      "firstName": "Jane Doe",
      "email": "jane.doe@example.com",
      "phone": { "number": "9876543210", "countryCode": "+1" },
      "isActive": true
    },
    "leadId": {
      "_id": "...",
      "leadId": "LEAD-00123",
      "projectName": "Warehouse A",
      "lifecycleStatus": "negotiation"
    },
    "assignedTo": {
      "_id": "...",
      "name": "Sales Rep",
      "email": "sales@example.com",
      "role": "sales",
      "isActive": true
    },
    "createdBy": {
      "_id": "...",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin",
      "isActive": true
    },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

`leadId` is `null` when the meeting is not tied to a project.

Populated fields: `customerId`, `leadId`, `assignedTo`, `createdBy` (full Mongoose documents; passwords omitted on nested users).

### Errors

| HTTP | Message |
|------|---------|
| 404 | Meeting not found |

---

## 15. `GET /api/admin/leads/export/excel`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Leads list → Export (download link from S3) |
| **Change** | **New endpoint** — builds `.xlsx` from all matching leads, uploads to S3, returns public file URL |

### Path parameters

None.

### Query parameters

Same filters as `GET /api/admin/leads` (list). Omit all to export every lead in the system.

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `search` | string | No | Project name or customer name / email / `customerId` |
| `buildingType` | string | No | Case-insensitive substring |
| `assignedSales` | MongoId | No | Filter by assigned rep |
| `lifecycleStatus` | string | No | See lifecycle enum above |
| `source` | string | No | `chat`, `manual`, `import`, `customer_portal` |
| `isQuoteReady` | boolean string | No | `true` / `false` |
| `isHandedToSales` | boolean string | No | `true` / `false` |
| `isTerminated` | boolean string | No | `true` / `false` |
| `quoteValueMin` | number | No | Min `quoteValue` |
| `quoteValueMax` | number | No | Max `quoteValue` |
| `startDate` | ISO date | No | Filter on lead `createdAt` |
| `endDate` | ISO date | No | Filter on lead `createdAt` |

No `page` / `limit` — export is not paginated.

### Request body

None.

### Response body

#### Previous

`N/A`

#### Current (`data`)

```json
{
  "fileUrl": "https://<bucket>.s3.<region>.amazonaws.com/exports/admin/<userId>/leads-1716729600000-<uuid>.xlsx",
  "key": "exports/admin/<userId>/leads-1716729600000-<uuid>.xlsx",
  "exportedCount": 128,
  "generatedAt": "2026-05-26T08:00:00.000Z"
}
```

| Field | Notes |
|-------|--------|
| `fileUrl` | Direct HTTPS URL to the uploaded workbook — open or download in browser |
| `key` | S3 object key (for support/debug) |
| `exportedCount` | Number of lead rows written |
| `generatedAt` | ISO timestamp when file was generated |

**Excel columns (one row per lead):** Lead ID, Job ID, Project Name, Building Type, Location, Roof Style, Width, Length, Height, Sqft, Doors, Windows, Insulation, Source, Quote Value, Lifecycle Status, Lead Score, Quote Ready, Handed To Sales, Raised To PO, PO Status, Terminated, Termination Reason, Terminated At, Buildings Count, Notes, Customer Code, Customer Name, Customer Email, Customer Phone, Customer Active, Assigned Sales, Assigned Sales Email, Document Count, Has Contract, Created At, Updated At.

### Errors

| HTTP | Message |
|------|---------|
| 503 | S3 is not configured (missing AWS env vars) |
| 401 | Unauthorized |

---

## 16. `GET /api/sales/leads/export/excel`

| | |
|---|---|
| **Role** | `sales` |
| **UI** | Leads list → Export (download link from S3) |
| **Change** | **New endpoint** — same as admin §15 but scoped to **current sales user’s assigned leads only** |

### Path parameters

None.

### Query parameters

Same filters as `GET /api/sales/leads` (list). Server always adds `assignedSales = current user`.

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `search` | string | No | Project / building / location / customer |
| `buildingType` | string | No | Case-insensitive substring |
| `lifecycleStatus` | string | No | See lifecycle enum above |
| `isQuoteReady` | boolean string | No | `true` / `false` |
| `startDate` | ISO date | No | Filter on lead `createdAt` |
| `endDate` | ISO date | No | Filter on lead `createdAt` |

No `page` / `limit`.

### Request body

None.

### Response body

#### Previous

`N/A`

#### Current (`data`)

Same shape as admin §15; S3 path uses `exports/sales/<userId>/...`:

```json
{
  "fileUrl": "https://<bucket>.s3.<region>.amazonaws.com/exports/sales/<userId>/leads-1716729600000-<uuid>.xlsx",
  "key": "exports/sales/<userId>/leads-1716729600000-<uuid>.xlsx",
  "exportedCount": 24,
  "generatedAt": "2026-05-26T08:00:00.000Z"
}
```

Excel column set is identical to §15.

### Errors

| HTTP | Message |
|------|---------|
| 503 | S3 is not configured |
| 401 | Unauthorized |

### Frontend notes

- Call export, then use `data.fileUrl` for download (new tab or `<a download>`). No file bytes in the JSON response.
- **Legacy:** `GET /api/sales/leads/export` still returns inline **CSV** in the response body (unchanged). Prefer `/export/excel` for full detail + S3 link.

---

## 17. `GET /api/admin/leads/by-score`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Leads by score table |
| **Change** | Paginated list by `updatedAt` desc; optional date range on `updatedAt`; each row includes full **`lifecycleHistory`** |

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `startDate` | ISO date | No | Filters `Lead.updatedAt` (inclusive start) |
| `endDate` | ISO date | No | Filters `Lead.updatedAt` (inclusive end of day) |
| `temperature` | string | No | `hot`, `warm`, or `cold` |
| `status` | string | No | **Alias** for `temperature` (same values) |
| `search` | string | No | Customer name / email / customer code / project name / job id |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `200` |

### Request body

None.

### Response body

#### Previous (`data`)

Rows did **not** include `lifecycleHistory` (only `lifecycleStatus`).

#### Current (`data`)

```json
{
  "leads": [
    {
      "leadId": "665a1b2c3d4e5f6789012345",
      "projectId": "PRO-042",
      "customerName": "Jane Doe",
      "projectName": "Warehouse A",
      "location": "Austin, TX",
      "lifecycleStatus": "negotiation",
      "lifecycleHistory": [
        {
          "stage": "initial_contact",
          "changedAt": "2026-04-15T08:00:00.000Z",
          "changedBy": "664c1a2b3d4e5f6789012001"
        },
        {
          "stage": "proposal_sent",
          "changedAt": "2026-05-20T14:30:00.000Z",
          "changedBy": "664c1a2b3d4e5f6789012002"
        }
      ],
      "status": "hot",
      "score": 78,
      "quoteValue": 175000,
      "temperature": "hot",
      "updatedAt": "2026-05-26T10:30:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

| Field | Notes |
|-------|--------|
| `projectId` | Auto-generated `jobId` (e.g. `PRO-042`) |
| `lifecycleStatus` | Current stage on the lead |
| `lifecycleHistory` | Full array from `Lead.lifecycleHistory` (`stage`, `changedAt`, `changedBy` as ObjectId — not populated) |
| `status` | Same as `temperature` (hot / warm / cold) for UI columns |
| `score` | AI score 0–100 from `leadScoring.score` |
| `quoteValue` | Project / quote value on the lead |

Sorted by **`updatedAt` descending** (most recently updated first).

**Example (date range + pagination only — no temperature / search):**

```http
GET /api/admin/leads/by-score?startDate=2026-05-01&endDate=2026-05-26&page=1&limit=20
```

`startDate` / `endDate` filter **`Lead.updatedAt`** (end date includes full calendar day). Either date may be omitted.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `temperature` / `status` |
| 400 | Invalid `startDate` / `endDate` (must be ISO 8601 when provided) |

---

## 18. `PUT /api/admin/leads/:leadId/temperature`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Override lead temperature on score board |
| **Change** | **New endpoint** — manual hot / warm / cold; persists until next AI re-score |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Query parameters

None.

### Request body

#### Previous

`N/A`

#### Current

```json
{
  "temperature": "warm"
}
```

Required. One of: `hot`, `warm`, `cold`.

### Response body

#### Previous

`N/A`

#### Current (`data`)

```json
{
  "lead": {
    "leadId": "665a1b2c3d4e5f6789012345",
    "projectId": "PRO-042",
    "temperature": "warm",
    "temperatureManual": true
  }
}
```

Manual temperature is kept on save. When **AI chat re-scores** the lead, temperature is recalculated from score and `temperatureManual` is cleared.

**Implementation:** Shared helper `setLeadTemperatureManual` in `src/utils/leadTemperature.js` (used by admin and sales).

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid or missing `temperature` |
| 404 | Lead not found |

---

## §26 — Sales manual lead temperature

### `PUT /api/sales/leads/:leadId/temperature`

Same contract as admin **§18**. Sales may only update leads **assigned to them** (`assignedSales` = current user).

**Auth:** Sales JWT.

**Request body:**

```json
{
  "temperature": "hot"
}
```

Required. One of: `hot`, `warm`, `cold`.

**Response `data`:** Same as §18:

```json
{
  "lead": {
    "leadId": "...",
    "projectId": "PRO-042",
    "temperature": "hot",
    "temperatureManual": true
  }
}
```

After update, `GET /api/sales/leads/by-score` reflects the new `temperature` / `status` on the row (filter by `?temperature=` also uses stored `leadScoring.temperature`).

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid or missing `temperature` |
| 403 | Lead not assigned to you |
| 404 | Lead not found |

---

## 19. `GET /api/admin/employees/audit-log`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Employees → audit / activity roster |
| **Change** | **New endpoint** — each employee with formatted last activity from `AuditLog` |

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `role` | string | No | `admin`, `sales`, `construction`, `plant`, `account` |
| `isActive` | boolean string | No | `true` / `false` |
| `search` | string | No | Name or email (case-insensitive) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20` |

### Request body

None.

### Response body

#### Previous

`N/A`

#### Current (`data`)

Sorted by **`lastActivityAt` descending** (employees with no activity last, then by name).

```json
{
  "employees": [
    {
      "userId": "...",
      "name": "Aadith",
      "email": "aadith@example.com",
      "role": "sales",
      "panel": "Sales",
      "status": "active",
      "isActive": true,
      "lastActivity": "Quotation created for Jane for Warehouse A",
      "lastActivityAt": "2026-05-26T14:22:00.000Z"
    },
    {
      "userId": "...",
      "name": "New Hire",
      "email": "new@example.com",
      "role": "plant",
      "panel": "Plant",
      "status": "active",
      "isActive": true,
      "lastActivity": null,
      "lastActivityAt": null
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

| Field | Notes |
|-------|--------|
| `panel` | Derived from `role` (Sales, Plant, Accounts, etc.) |
| `status` | `active` or `inactive` from `User.isActive` |
| `lastActivity` | Human-readable sentence from latest `AuditLog` where `performedBy` = this user |
| `lastActivityAt` | ISO timestamp of that log (separate field for date/time UI) |

**Also updated:** `GET /api/admin/employees/:userId/timeline` — each entry now includes `displayMessage` (same formatter).

### Errors

None specific (401 if unauthorized).

---

## §20 — Customer panel: PO-only visibility (admin + sales)

**Scope:** Customer **section** list and **projects inside a customer** only. Lead list endpoints (`GET /api/admin/leads`, `GET /api/sales/leads`, etc.) are unchanged.

### Rule

1. **Customer list** — A customer is returned only if they have **at least one** lead with `isRaisedToPO: true`.
2. **Customer → projects** — Only leads with `isRaisedToPO: true` are returned. `totalProjects` on the customer list counts PO-raised projects only.

### Affected endpoints

| Method | Endpoint | Change |
|--------|----------|--------|
| GET | `/api/admin/customers` | Filtered to customers with ≥1 PO-raised project; `totalProjects` = PO projects only |
| GET | `/api/admin/customers/:customerId/projects` | Only `isRaisedToPO: true` leads |
| GET | `/api/admin/customers/:customerId/projects/:leadId` | 404 unless that lead has `isRaisedToPO: true` |
| GET | `/api/sales/customers` | Same PO rule, scoped to `assignedSales` = current user |
| GET | `/api/sales/customers/:customerId/projects` | Only PO-raised leads assigned to current user |
| GET | `/api/admin/customers/stats` | All counts scoped to PO-raised projects / PO customers (aligned with list + projects) |
| GET | `/api/sales/customers/stats` | `total`, `active`, `newThisMonth`, `returning` — PO customers assigned to current user; `returning` = &gt;1 PO project per customer |

### Frontend impact

- Chat-only or pre-PO customers **will not** appear in the customer section until sales raises a PO (`POST /api/sales/leads/:leadId/po-order` sets `isRaisedToPO`).
- Pre-PO work stays in the **leads** section (and AI-handled where applicable).

---

## §21 — Admin lead documents list

### `GET /api/admin/leads/:leadId/documents`

Returns all documents attached to the lead (embedded `lead.documents`), with project context and uploader details.

**Auth:** Admin JWT.

**Query (optional):**

| Param | Type | Description |
|-------|------|-------------|
| `type` | string | Filter: `drawing`, `approval`, `general`, `contract`, `photo`, `other` |

**Response `data`:**

```json
{
  "project": {
    "_id": "<leadObjectId>",
    "projectName": "Warehouse Expansion",
    "jobId": "PRO-042"
  },
  "documents": [
    {
      "_id": "<docSubdocId>",
      "url": "https://bucket.s3.region.amazonaws.com/documents/uuid.pdf",
      "name": "site-plan.pdf",
      "type": "drawing",
      "uploadedAt": "2026-05-20T10:00:00.000Z",
      "uploadedBy": {
        "_id": "<userId>",
        "name": "Jane Sales",
        "email": "jane@example.com",
        "role": "sales"
      }
    }
  ],
  "total": 1
}
```

- Sorted newest `uploadedAt` first.
- `uploadedBy` is `null` when the document has no uploader (e.g. legacy rows).
- Upload/remove still uses `POST` / `DELETE` on `/api/upload/leads/:leadId/documents` (unchanged).

---

## §22 — Customer deactivate/activate toggle (admin)

**Endpoint:** `PATCH /api/admin/customers/:customerId/deactivate` (path unchanged; behavior is a toggle).

### Summary

- **Previous:** Deactivate only; `400` if already inactive.
- **Current:** Toggles `isActive`. Inactive → active on repeat call.
- **Audit:** `customer.deactivated` or `customer.activated` (`AUDIT_ACTIONS.CUSTOMER_ACTIVATED` in `src/config/constants.js`).
- **FE:** Use response `message` and `data.customer.isActive` to update UI label (Deactivate vs Activate). Do not treat `400` for “already inactive” anymore.

Full contract delta is in **§6** above.

---

## §23 — Admin follow-up activity log

### `GET /api/admin/followups/activity-log`

Paginated follow-up activity across **all employees** (not scoped to one rep).

**Auth:** Admin JWT.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `employeeId` | MongoId | Filter by `assignedTo` (sales user) |
| `type` | string | Contact mode: `call`, `email`, `meeting` (`modeOfContact`) |
| `status` | string | `pending`, `completed`, or `overdue` (computed: pending + `followUpDate` in the past) |
| `startDate` | ISO date | Filter on `followUpDate` (inclusive start of day) |
| `endDate` | ISO date | Filter on `followUpDate` (inclusive end of day) |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `200` |

**Response `data`:**

```json
{
  "activities": [
    {
      "_id": "<followUpId>",
      "leadId": "<leadId>",
      "projectName": "Warehouse Expansion",
      "jobId": "PRO-042",
      "clientName": "Jane Doe",
      "followUpDate": "2026-05-22T10:00:00.000Z",
      "type": "call",
      "followedBy": {
        "_id": "<userId>",
        "name": "Rahul Sales",
        "email": "rahul@example.com",
        "role": "sales"
      },
      "status": "overdue",
      "nextFollowUpDate": "2026-05-28T14:00:00.000Z",
      "notes": "Discuss quote revision",
      "priority": "high",
      "completedAt": null,
      "createdAt": "2026-05-20T09:00:00.000Z"
    }
  ],
  "total": 48,
  "page": 1,
  "limit": 20
}
```

- **`followedBy`** — assigned sales user (`assignedTo`).
- **`type`** — `modeOfContact` on the follow-up record.
- **`status`** — `completed`, `pending`, or `overdue` (display value; `overdue` is not stored in DB).
- **`nextFollowUpDate`** — earliest **pending** follow-up on the same lead with `followUpDate` after this row’s date; `null` if none.
- Sorted by `followUpDate` descending (newest first).

---

## §24 — Sales leads list: `isRaisedToPO` on each row

### `GET /api/sales/leads`

**Auth:** Sales JWT. Scoped to `assignedSales = current user` (unchanged).

**Change:** Each item in `data.leads` now includes **`isRaisedToPO`** (boolean).

#### Previous (`data.leads[]`)

```json
{
  "_id": "...",
  "projectName": "...",
  "customerId": { "_id": "...", "firstName": "...", "email": "..." },
  "lifecycleStatus": "initial_contact",
  "quoteValue": 0,
  "leadScoring": { "score": 0 },
  "buildingType": "",
  "location": "",
  "nextFollowUp": null
}
```

`isRaisedToPO` was **omitted** (not selected / not mapped in the response).

#### Current (`data.leads[]`)

Same fields as above, plus:

```json
{
  "isRaisedToPO": false
}
```

| Field | Type | Notes |
|-------|------|--------|
| `isRaisedToPO` | boolean | `true` after `POST /api/sales/leads/:leadId/po-order`; otherwise `false` |

**Query / pagination:** Unchanged (`page`, `limit`, plus existing list filters via `buildSalesLeadFilter`).

**Admin note:** `GET /api/admin/leads` already returned the full lead document (including `isRaisedToPO`); no admin list change required.

**FE:** Use `isRaisedToPO` on the sales lead table (e.g. PO badge, disable “Raise PO” when already `true`). Customer panel PO-only rules (§20) are separate from this list field.

---

## §25 — Sales leads by score (assigned leads only)

### `GET /api/sales/leads/by-score`

Same contract as admin **§17** (`GET /api/admin/leads/by-score`), but results are limited to leads where **`assignedSales` = logged-in sales user**.

**Auth:** Sales JWT.

**Query parameters:** Same as §17 — `startDate`, `endDate` (on `updatedAt`), `temperature`, `status` (alias for `temperature`), `search`, `page`, `limit`.

**Response `data`:** Same row shape as §17 (includes **`lifecycleHistory`**).

```json
{
  "leads": [
    {
      "leadId": "...",
      "projectId": "PRO-042",
      "customerName": "Jane",
      "projectName": "Warehouse A",
      "location": "Austin, TX",
      "lifecycleStatus": "negotiation",
      "lifecycleHistory": [
        { "stage": "initial_contact", "changedAt": "2026-04-15T08:00:00.000Z", "changedBy": "..." }
      ],
      "status": "hot",
      "score": 78,
      "quoteValue": 175000,
      "temperature": "hot",
      "updatedAt": "2026-05-26T10:30:00.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

Sorted by **`updatedAt` descending**.

**Example (date range + pagination only):**

```http
GET /api/sales/leads/by-score?startDate=2026-05-01&endDate=2026-05-26&page=1&limit=20
```

**Note:** `GET /api/sales/leads/scored` (existing) is a different endpoint — sorted by `leadScoring.score`, different response shape. Use `/by-score` for parity with the admin leads-by-score table.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `temperature` / `status` |
| 400 | Invalid `startDate` / `endDate` (ISO 8601) |

---

## Related unchanged endpoints (reference)

| Method | Endpoint | Notes |
|--------|----------|--------|
| GET | `/api/admin/leads` | Full lead objects — includes `isRaisedToPO` |
| PUT | `/api/admin/leads/:leadId/assign` | `{ "employeeId": "<userId>" }` — still the only way to change `assignedSales` on admin |
| PUT | `/api/sales/leads/:leadId/lifecycle` | Still works; `lifecycleStatus` can also be sent on `PUT /api/sales/leads/:leadId` now |
| GET | `/api/admin/customers/:customerId` | Customer detail + financial summary (not paginated invoices — use §7) |
| POST | `/api/admin/meetings` | Create meeting (unchanged) |
| PUT | `/api/admin/meetings/:meetingId` | Edit meeting (unchanged) |
| PUT | `/api/admin/meetings/:meetingId/complete` | Mark complete (unchanged) |
| GET | `/api/sales/leads/export` | Legacy CSV download in response body (not S3) |
| GET | `/api/invoices/stats` | Global invoice KPIs — **admin + sales** (§37a) |
| GET | `/api/invoices` | Global invoice list — **admin + sales** (§37b) |
| PUT | `/api/invoices/:invoiceId` | Edit draft — full body per §38 |
| GET | `/api/customers` | Common customer lookup — §39a |
| GET | `/api/leads` | Common lead lookup — §39b |
| GET | `/api/admin/reports/analytics` | Admin Sales Analytics — §40 |
| GET | `/api/account/invoices` | Account panel invoice list (role `account`) |
| PUT | `/api/account/invoices/:invoiceId/mark-paid` | Account mark paid (no payment-stage sync) |

---

## Maintenance

**Last updated:** 2026-05-26 — §42 jobId + projectId on all lead/project responses

---

## §28 — Admin employee assigned leads

### `GET /api/admin/employees/:userId/assigned-leads`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Employees → employee detail → assigned leads list |
| **Change** | **New endpoint** — paginated leads assigned to a specific employee |

### Path parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `userId` | MongoId | Yes | Employee / user `_id` (`assignedSales` on leads) |

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `startDate` | ISO date | No | Filters `Lead.createdAt` (inclusive start) |
| `endDate` | ISO date | No | Filters `Lead.createdAt` (inclusive end of day) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `200` |

### Request body

None.

### Response body

#### Previous

`N/A`

#### Current (`data`)

```json
{
  "employee": {
    "_id": "664c1a2b3d4e5f6789012001",
    "name": "Sales One",
    "email": "sales1@example.com",
    "role": "sales",
    "isActive": true
  },
  "leads": [
    {
      "clientName": "Jane Doe",
      "projectId": "PRO-042",
      "location": "Austin, TX",
      "status": "negotiation",
      "quoteValue": 175000,
      "lead": {
        "_id": "665a1b2c3d4e5f6789012345",
        "jobId": "PRO-042",
        "projectName": "Warehouse A",
        "location": "Austin, TX",
        "lifecycleStatus": "negotiation",
        "quoteValue": 175000,
        "customerId": {
          "_id": "...",
          "firstName": "Jane Doe",
          "lastName": "",
          "email": "jane@example.com",
          "customerId": "CUS-00042"
        },
        "assignedSales": "664c1a2b3d4e5f6789012001",
        "leadScoring": { "score": 78 },
        "isRaisedToPO": false,
        "createdAt": "2026-04-15T08:00:00.000Z",
        "updatedAt": "2026-05-26T10:30:00.000Z"
      }
    }
  ],
  "total": 12,
  "page": 1,
  "limit": 20
}
```

| Field | Notes |
|-------|--------|
| `clientName` | Customer `firstName` (from populated `customerId`) |
| `projectId` | Lead `jobId` (e.g. `PRO-042`) |
| `location` | Lead `location` |
| `status` | Lead `lifecycleStatus` (pipeline stage) |
| `quoteValue` | Lead `quoteValue` |
| `lead` | **Full** lead document (lean) with populated `customerId` |

Sorted by **`createdAt` descending**.

**Example (date range + pagination):**

```http
GET /api/admin/employees/664c1a2b3d4e5f6789012001/assigned-leads?startDate=2026-05-01&endDate=2026-05-26&page=1&limit=20
```

Omit `startDate` / `endDate` to return all assigned leads for that employee (still paginated).

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `startDate` / `endDate` (ISO 8601) |
| 404 | Employee not found |

---

## §27 — Lead notes log (admin + sales)

### Data model (`Lead.leadNotes[]`)

Each entry:

| Field | Type | Notes |
|-------|------|--------|
| `_id` | ObjectId | Subdocument id |
| `note` | string | Note text |
| `addedAt` | Date | Timestamp (ISO in API) |
| `addedBy` | ObjectId → User | Who added the note |

Legacy string field **`Lead.notes`** (single line on create/edit lead) is unchanged.

### Endpoints

| Method | Admin | Sales |
|--------|-------|-------|
| GET notes | `GET /api/admin/leads/:leadId/notes` | `GET /api/sales/leads/:leadId/notes` |
| POST note | `POST /api/admin/leads/:leadId/notes` | `POST /api/sales/leads/:leadId/notes` |

**Auth:** Admin JWT / Sales JWT. Sales: lead must be **assigned** to current user.

**POST body:**

```json
{
  "note": "Customer asked for revised quote by Friday."
}
```

**GET / POST response `data` (list):**

```json
{
  "leadId": "...",
  "projectName": "Warehouse A",
  "jobId": "PRO-042",
  "notes": [
    {
      "_id": "...",
      "note": "Customer asked for revised quote by Friday.",
      "addedAt": "2026-05-28T10:00:00.000Z",
      "addedBy": {
        "_id": "...",
        "name": "Sales One",
        "email": "sales1@example.com",
        "role": "sales"
      }
    }
  ],
  "total": 1
}
```

**POST success** also returns `data.note` (single new entry, same shape as one array item).

Sorted **newest `addedAt` first**.

**Also on lead detail:** `GET .../leads/:leadId/detail` includes `leadNotes` (same array shape) for admin and sales.

### Audit

- Action: `lead.note_added` (`AUDIT_ACTIONS.LEAD_NOTE_ADDED`)
- Shown in employee audit log / timeline as e.g. “Note added for Warehouse A: …”

---

## §29 — Common invoices (admin + sales)

Shared module: `/api/invoices` and `/api/leads/:leadId/invoices`.  
**Roles:** `admin`, `sales` (sales: lead access check on create / mark-paid).

### Server-owned fields (never send on create)

| Field | Set by |
|-------|--------|
| `leadId` | URL path `:leadId` on create |
| `customerId` | From lead |
| `quotationId` | Always `null` on create |
| `invoiceNumber` | Auto `INV-0001`, … |
| `poNumber` | Auto on **first** invoice per lead (`PO-0001`, …); reused on later invoices for same lead |
| `createdBy` | Logged-in user |
| `status` | `draft` on create |
| `sentAt`, `paidBy`, `paidAt` | Workflow endpoints only |
| `dueDate` | **Computed and stored:** `date + (daysToPay × 1 day)`. Do **not** send in body. Recomputed on save when `date` or `daysToPay` changes. |

### Line item shape (`lineItems[]`)

| Field | Type | Notes |
|-------|------|--------|
| `images` | string[] | S3 URLs; **max 4** per line |
| `items` | string[] | Catalog labels / item list selections |
| `rate` | number | Unit rate |
| `markup` | number | Per-line markup |
| `quantity` | number | Default `1` |
| `tax` | number | Tax amount for the line |
| `total` | number | Line total (FE sends calculated value) |

---

### 29a. `POST /api/leads/:leadId/invoices` — Create draft

| | |
|---|---|
| **Change** | **Create moved** from `POST /api/invoices` → path includes project. Body no longer accepts `leadId`, `customerId`, or `quotationId`. |

#### Previous

```http
POST /api/invoices
```

```json
{
  "leadId": "...",
  "customerId": "...",
  "quotationId": "...",
  "totalAmount": 280000
}
```

#### Current

```http
POST /api/leads/:leadId/invoices
```

**Path:** `leadId` = project Mongo `_id`.

**Request body**

| Field | Required | Notes |
|-------|----------|--------|
| `totalAmount` | Yes | Invoice grand total |
| `date` | No | ISO date; default now |
| `daysToPay` | No | Used with `date` → stored `dueDate` |
| `lineItems` | No | Array — see line item shape |
| `subtotal` | No | |
| `markupTotal` | No | Invoice-level markup total |
| `discount` | No | |
| `depositAmount` | No | |
| `paymentScheduleStageId` | No | Optional — links one payment stage (see §30) |

```json
{
  "date": "2026-05-27T00:00:00.000Z",
  "daysToPay": 30,
  "lineItems": [
    {
      "images": [],
      "items": ["Steel frame package"],
      "rate": 75000,
      "markup": 5000,
      "quantity": 1,
      "tax": 0,
      "total": 80000
    }
  ],
  "subtotal": 1917952,
  "markupTotal": 0,
  "discount": 0,
  "depositAmount": 0,
  "totalAmount": 1917952,
  "paymentScheduleStageId": "665b00000000000000000001"
}
```

**Response `201` — `data`**

```json
{
  "invoice": {
    "_id": "64f...",
    "invoiceNumber": "INV-0001",
    "poNumber": "PO-0001",
    "leadId": "665a...",
    "customerId": "664c...",
    "quotationId": null,
    "date": "2026-05-27T00:00:00.000Z",
    "daysToPay": 30,
    "dueDate": "2026-06-26T00:00:00.000Z",
    "paymentScheduleId": "665b...",
    "paymentScheduleStageId": "665b...01",
    "lineItems": [],
    "subtotal": 1917952,
    "markupTotal": 0,
    "discount": 0,
    "depositAmount": 0,
    "totalAmount": 1917952,
    "status": "draft",
    "sentAt": null,
    "paidBy": null,
    "paidAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Side effect:** If `paymentScheduleStageId` is set, that stage → `status: invoiced`, `invoiceId` set on the stage.

| HTTP | Message |
|------|---------|
| 400 | Validation / stage not found for this project |
| 403 | Sales — lead not assigned to you |
| 404 | Lead not found |

---

### 29b. `GET /api/invoices/:invoiceId` — Get one

**Request:** No body.

**Response `200` — `data`**

```json
{
  "invoice": {
    "_id": "64f...",
    "invoiceNumber": "INV-0001",
    "poNumber": "PO-0001",
    "leadId": "665a...",
    "customerId": "664c...",
    "date": "2026-05-27T00:00:00.000Z",
    "daysToPay": 30,
    "dueDate": "2026-06-26T00:00:00.000Z",
    "lineItems": [],
    "subtotal": 1917952,
    "markupTotal": 0,
    "discount": 0,
    "depositAmount": 0,
    "totalAmount": 1917952,
    "status": "draft",
    "paymentScheduleStageId": "665b...01",
    "createdBy": { "_id": "...", "name": "...", "email": "..." },
    "paidBy": null
  },
  "paymentSchedule": {
    "_id": "665b...",
    "leadId": "665a...",
    "customerId": "664c...",
    "totalAmount": 1917952,
    "stages": [
      {
        "_id": "665b...01",
        "stageName": "Deposit",
        "amount": 30,
        "amountType": "percentage",
        "dueDate": "2026-06-01T00:00:00.000Z",
        "status": "invoiced",
        "invoiceId": "64f..."
      }
    ]
  }
}
```

| Change | Notes |
|--------|--------|
| **Previous** | `paymentSchedule` often `null` (queried by wrong field) |
| **Current** | Schedule loaded by invoice’s **`leadId`** (one schedule per lead) |

`paymentSchedule` is `null` if no schedule exists for the lead.

---

### 29c. `PUT /api/invoices/:invoiceId` — Edit draft

See **§38** for the current request/response contract (body now matches create §29a, including `paymentScheduleStageId`).

---

### 29d. `POST /api/invoices/:invoiceId/send` — Email customer

**Request:** No body.

**Response `200`:** `{ "invoice": { ..., "status": "sent", "sentAt": "..." } }`

Sends Nodemailer email to customer. Audit: `invoice.sent`.

---

### 29e. `PUT /api/invoices/:invoiceId/mark-paid` — Mark paid

**Request:** No body.

**Rules**

| Current status | Allowed? |
|----------------|----------|
| `sent`, `overdue` | Yes |
| `draft`, `cancelled` | No — 400 |
| `paid` | No — 400 |

Sales: lead must be assigned to current user.

**Response `200`:** `{ "invoice": { ..., "status": "paid", "paidBy", "paidAt" } }`

**Side effect:** If `paymentScheduleStageId` is set, linked stage → `status: paid`, `paidAt`, `paidBy`. Audit: `invoice.paid` + `payment.stage_paid`.

---

### 29f. `GET /api/leads/:leadId/invoices` — List for project

**Query:** optional `startDate`, `endDate` (filters invoice **`createdAt`**).

**Response `200` — `data`**

```json
{
  "invoices": [
    {
      "_id": "64f...",
      "invoiceNumber": "INV-0001",
      "totalAmount": 1917952,
      "status": "draft",
      "dueDate": "2026-06-26T00:00:00.000Z",
      "createdBy": { "name": "..." },
      "paidBy": null
    }
  ]
}
```

Sorted **`createdAt` descending**. `createdBy` and `paidBy` populated.

---

## §30 — Common payment schedules (admin + sales)

**One `PaymentSchedule` document per lead** (`leadId` unique). Invoices link to **one stage** via `paymentScheduleStageId` (optional).

There is **no update** endpoint yet — create once per lead; stage status changes when invoices are created / marked paid.

---

### 30a. `POST /api/payment-schedules` — Create schedule

| | |
|---|---|
| **Change** | Documented current contract (`stages[]`, not legacy `payments[]`) |

**Request body**

| Field | Required | Notes |
|-------|----------|--------|
| `leadId` | Yes | Project |
| `stages` | Yes | Array, min 1 |
| `totalAmount` | No | Defaults to `lead.quoteValue` |

**Stage object**

| Field | Required | Notes |
|-------|----------|--------|
| `stageName` | Yes | e.g. `Deposit` |
| `amount` | Yes | Percentage value or fixed currency amount |
| `amountType` | Yes | `percentage` or `fixed` — **all stages must match** |
| `dueDate` | No | ISO date |

```json
{
  "leadId": "665a1b2c3d4e5f6789012345",
  "totalAmount": 1917952,
  "stages": [
    {
      "stageName": "Deposit",
      "amount": 30,
      "amountType": "percentage",
      "dueDate": "2026-06-01T00:00:00.000Z"
    },
    {
      "stageName": "On delivery",
      "amount": 70,
      "amountType": "percentage",
      "dueDate": "2026-07-01T00:00:00.000Z"
    }
  ]
}
```

**Validation**

| Rule | Error if failed |
|------|-----------------|
| No existing schedule for `leadId` | 400 — already exists |
| All `amountType` same | 400 — mixed types |
| Percentages sum to **100** | 400 |
| Fixed amounts sum to **`totalAmount`** | 400 |

**Response `201` — `data`**

```json
{
  "schedule": {
    "_id": "665b...",
    "leadId": "665a...",
    "customerId": "664c...",
    "totalAmount": 1917952,
    "createdBy": "664c...",
    "stages": [
      {
        "_id": "665b...01",
        "stageName": "Deposit",
        "amount": 30,
        "amountType": "percentage",
        "dueDate": "2026-06-01T00:00:00.000Z",
        "status": "pending",
        "invoiceId": null,
        "paidAt": null,
        "paidBy": null
      }
    ],
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

`customerId` and `createdBy` are set server-side from lead + user.

---

### 30b. `GET /api/payment-schedules/lead/:leadId` — Get by project

**Path:** `leadId`

**Response `200` — `data`**

```json
{
  "schedule": { /* same shape as create response */ }
}
```

Or `{ "schedule": null }` if none.

---

### Invoice ↔ payment schedule flow (FE)

1. `POST /api/payment-schedules` with `leadId` + `stages` → note each stage `_id`.
2. `POST /api/leads/:leadId/invoices` with optional `paymentScheduleStageId` = one stage `_id`.
3. `GET /api/invoices/:invoiceId` → invoice + full lead schedule.
4. `POST .../send` → customer email.
5. `PUT .../mark-paid` → invoice paid + linked stage paid.

---

### Removed / deprecated

| Endpoint | Notes |
|----------|--------|
| `POST /api/invoices` | **Removed** — use `POST /api/leads/:leadId/invoices` |
| `GET /api/payment-schedules/invoice/:invoiceId` | **Not implemented** — use `GET .../lead/:leadId` |

When the API changes again, update the matching section with **Previous** = last published contract, **Current** = new contract, and bump **Last updated**. New changes after a frontend handoff should be appended as the next section number (do not renumber sections already shared).

---

## §37 — Global invoice list & stats (admin + sales, single API)

**Admin panel and Sales panel use the same endpoints.** Scope is determined by JWT `role`:

| Role | Scope |
|------|--------|
| `admin` | All invoices |
| `sales` | Invoices for leads where `assignedSales` = current user |

Do **not** add `/api/admin/invoices` or `/api/sales/invoices`. Per-project tab list remains `GET /api/leads/:leadId/invoices` (§34).

---

### 37a. `GET /api/invoices/stats` — KPI totals

| | |
|---|---|
| **Roles** | `admin`, `sales` |
| **Change** | **New** — no query parameters |
| **UI** | Invoices dashboard header / summary cards |

**Query params:** none.

**Amount definitions** (sums of `totalAmount`, excluding `cancelled`):

| Field | Rule |
|-------|------|
| `totalAmount` | All in-scope invoices |
| `totalPaid` | `status === "paid"` |
| `totalUnpaid` | `status` is `draft` or `sent`, and **not** overdue |
| `overdue` | `status` is `sent` or `overdue`, and `dueDate < now` (uses stored `dueDate`, or `date` + `daysToPay`) |

**Response `200` — `data`**

```json
{
  "totalAmount": 500000,
  "totalPaid": 200000,
  "totalUnpaid": 150000,
  "overdue": 50000
}
```

---

### 37b. `GET /api/invoices` — Paginated list

| | |
|---|---|
| **Roles** | `admin`, `sales` (same scope rules as 37a) |
| **Change** | **New** |

**Query params**

| Param | Required | Notes |
|-------|----------|--------|
| `startDate` | No | Filters invoice `createdAt` (inclusive start) |
| `endDate` | No | Filters invoice `createdAt` (inclusive end of day) |
| `status` | No | `draft` \| `sent` \| `paid` \| `overdue` \| `cancelled` |
| `leadId` | No | Single project / lead |
| `search` | No | Case-insensitive: customer `firstName`, `lastName`, `email`, `customerId`, or lead `projectName` |
| `page` | No | Default `1` |
| `limit` | No | Default `20`, max `100` |

**Response `200` — `data`**

```json
{
  "invoices": [
    {
      "invoiceNumber": "INV-0001",
      "projectName": "Warehouse Phase 2",
      "dueDate": "2026-06-15T00:00:00.000Z",
      "amount": 45000,
      "status": "sent",
      "invoice": {
        "_id": "665a...",
        "leadId": "665b...",
        "customerId": "664c...",
        "invoiceNumber": "INV-0001",
        "totalAmount": 45000,
        "status": "sent",
        "dueDate": "2026-06-15T00:00:00.000Z",
        "lineItems": [],
        "createdBy": { "name": "Jane", "email": "jane@example.com" },
        "paidBy": null
      }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

| Row field | Notes |
|-----------|--------|
| `amount` | Same as `invoice.totalAmount` |
| `invoice` | Full invoice document (with `createdBy` / `paidBy` populated) |

Sorted by `createdAt` descending.

---

## §38 — `PUT /api/invoices/:invoiceId` — Edit draft invoice (body parity with create)

| | |
|---|---|
| **Roles** | `admin`, `sales` |
| **UI** | Invoice edit form (admin + sales panels) |
| **Change** | **Request body expanded** — update accepts the same fields as `POST /api/leads/:leadId/invoices` (§29a), including `paymentScheduleStageId`. Sales access check added on update. |

**Rules**

| Rule | Notes |
|------|--------|
| Draft only | Only `status === "draft"` can be edited |
| Sales scope | Sales user must own the lead (`assignedSales` = current user) |
| Partial update | Send any subset of fields; all body fields optional (unlike create, `totalAmount` is not required) |
| Payment stage | If `paymentScheduleStageId` is sent, stage is linked (`invoiced`, `invoiceId` set) — same side effect as create |

Do **not** send: `leadId`, `customerId`, `quotationId`, `status`, `dueDate`, `invoiceNumber`, `poNumber` (server-owned).

---

### Path parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `invoiceId` | MongoId | Yes | Invoice `_id` |

---

### Request body

#### Previous

Only these fields were applied on update (no `paymentScheduleStageId`, no route validators):

```json
{
  "date": "2026-05-27T00:00:00.000Z",
  "daysToPay": 30,
  "lineItems": [],
  "subtotal": 1917952,
  "markupTotal": 0,
  "discount": 0,
  "depositAmount": 0,
  "totalAmount": 1917952
}
```

`paymentScheduleStageId` in the body was **ignored**. No sales `assignedSales` check on update.

#### Current

Same shape as **create** (§29a). Any subset allowed:

```json
{
  "date": "2026-05-27T00:00:00.000Z",
  "daysToPay": 30,
  "lineItems": [
    {
      "images": [],
      "items": ["Steel frame package"],
      "rate": 75000,
      "markup": 5000,
      "quantity": 1,
      "tax": 0,
      "total": 80000
    }
  ],
  "subtotal": 1917952,
  "markupTotal": 0,
  "discount": 0,
  "depositAmount": 0,
  "totalAmount": 1917952,
  "paymentScheduleStageId": "665b00000000000000000001"
}
```

| Field | Required on update | Notes |
|-------|-------------------|--------|
| `date` | No | ISO date |
| `daysToPay` | No | Recalculates stored `dueDate` on save |
| `lineItems` | No | Same line-item shape as §29a |
| `subtotal` | No | |
| `markupTotal` | No | |
| `discount` | No | |
| `depositAmount` | No | |
| `totalAmount` | No | Optional (create still requires it) |
| `paymentScheduleStageId` | No | Links one payment schedule stage for this project |

**Route validation:** `totalAmount` optional numeric; `date` optional ISO; `daysToPay` optional numeric; `paymentScheduleStageId` optional MongoId.

---

### Response body

#### Previous

```json
{
  "invoice": { "_id": "...", "status": "draft", "totalAmount": 1917952 }
}
```

(Unchanged envelope — full invoice document returned.)

#### Current (`200` — `data`)

```json
{
  "invoice": {
    "_id": "64f...",
    "invoiceNumber": "INV-0001",
    "poNumber": "PO-0001",
    "leadId": "665a...",
    "customerId": "664c...",
    "date": "2026-05-27T00:00:00.000Z",
    "daysToPay": 30,
    "dueDate": "2026-06-26T00:00:00.000Z",
    "paymentScheduleId": "665b...",
    "paymentScheduleStageId": "665b...01",
    "lineItems": [],
    "subtotal": 1917952,
    "markupTotal": 0,
    "discount": 0,
    "depositAmount": 0,
    "totalAmount": 1917952,
    "status": "draft",
    "sentAt": null,
    "paidBy": null,
    "paidAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

### Errors

| HTTP | Message |
|------|---------|
| 400 | Only draft invoices can be edited |
| 400 | Payment schedule stage not found for this project |
| 400 | Validation failed (`totalAmount`, `date`, `daysToPay`, `paymentScheduleStageId`) |
| 403 | Sales — lead not assigned to you |
| 404 | Invoice / lead not found |

---

### FE notes

- Use the **same JSON payload** for create and edit; only the HTTP method and URL differ (`POST .../leads/:leadId/invoices` vs `PUT .../invoices/:invoiceId`).
- After save, `dueDate` is always derived from `date` + `daysToPay` — do not send `dueDate` in the body.

---

## §39 — Common customer & lead lookups (admin + sales, filter dropdowns)

Use these for **filter pickers** and autocomplete anywhere in admin or sales UI. Same URLs for both panels; scope follows JWT `role`.

| Role | `GET /api/customers` | `GET /api/leads` |
|------|----------------------|------------------|
| `admin` | All customers | All leads |
| `sales` | Customers on leads assigned to you | Leads where `assignedSales` = you |

Not a replacement for `GET /api/admin/customers` (PO-gated customer panel) or full lead list pages — lightweight paginated search only.

---

### 39a. `GET /api/customers` — Customer lookup

| | |
|---|---|
| **Roles** | `admin`, `sales` |
| **Change** | **New** |

**Query params**

| Param | Required | Notes |
|-------|----------|--------|
| `search` | No | Matches `firstName`, `lastName`, `email`, `customerId`, `phone.number` (case-insensitive) |
| `page` | No | Default `1` |
| `limit` | No | Default `20`, max `100` |

**Response `200` — `data`**

```json
{
  "customers": [
    {
      "_id": "664c...",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@example.com",
      "phone": { "number": "5551234567", "countryCode": "+1" },
      "isActive": true,
      "source": "manual",
      "company": "",
      "location": "Austin, TX",
      "createdAt": "2026-04-01T08:00:00.000Z",
      "updatedAt": "2026-05-20T10:00:00.000Z"
    }
  ],
  "total": 120,
  "page": 1,
  "limit": 20
}
```

Password is never returned. Sorted by `createdAt` descending.

---

### 39b. `GET /api/leads` — Lead / project lookup

| | |
|---|---|
| **Roles** | `admin`, `sales` |
| **Change** | **New** |

**Query params**

| Param | Required | Notes |
|-------|----------|--------|
| `search` | No | Matches lead `projectName`, `jobId`, `location`, `buildingType`, or linked customer `firstName`, `lastName`, `email`, `customerId`, `phone.number` |
| `page` | No | Default `1` |
| `limit` | No | Default `20`, max `100` |

**Response `200` — `data`**

```json
{
  "leads": [
    {
      "_id": "665a...",
      "customerId": {
        "_id": "664c...",
        "customerId": "CUS-00042",
        "firstName": "Jane",
        "lastName": "Doe",
        "email": "jane@example.com",
        "phone": { "number": "5551234567", "countryCode": "+1" }
      },
      "projectName": "Warehouse Phase 2",
      "jobId": "PRO-042",
      "location": "Austin, TX",
      "buildingType": "Warehouse",
      "lifecycleStatus": "negotiation",
      "quoteValue": 175000,
      "assignedSales": {
        "_id": "664c1a...",
        "name": "Sales One",
        "email": "sales1@example.com"
      },
      "isRaisedToPO": false,
      "createdAt": "2026-04-15T08:00:00.000Z",
      "updatedAt": "2026-05-26T10:30:00.000Z"
    }
  ],
  "total": 85,
  "page": 1,
  "limit": 20
}
```

Full lead document fields are returned (minus customer password). `customerId` and `assignedSales` are populated. Sorted by `createdAt` descending.

---

### FE notes

- **Admin and sales** use the same paths: `GET /api/customers` and `GET /api/leads`.
- For invoice filters, meeting filters, reports, etc., prefer these over role-specific list endpoints when you only need search + pagination.
- `GET /api/leads/:leadId/invoices` and other `:leadId` routes are unchanged — register lookups before those in the router (already done).

---

## §40 — Admin reports & analytics (`GET /api/admin/reports/analytics`)

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Reports & Analytics (Sales Analytics screen) |
| **Change** | **New** — single endpoint for Quick Overview + detailed monthly table |

### Query params

| Param | Required | Default | Notes |
|-------|----------|---------|--------|
| `lifecycleStatus` | No | `all` | Filter leads by `lifecycleStatus`; omit or `all` for every stage |
| `timeframe` | No | `monthly` | Only `monthly` supported |
| `months` | No | `6` | Number of calendar months in the table (1–24) |

### Metric definitions

| Metric | Rule |
|--------|------|
| **Revenue** | Sum of `Invoice.totalAmount` where `status === paid` and `paidAt` in the month, for leads matching the status filter |
| **New leads** | `Lead` count where `createdAt` in the month |
| **Conversions** | `Lead` count where `lifecycleStatus` is in closed stages (`deal_closed`, `payment_done`, `converted_to_po`, `sent_to_admin`, `delivered`) and `updatedAt` in the month |
| **Conversion rate** | `(conversions / new leads) × 100`, one decimal (e.g. `26.6`) |

### Response `200` — `data`

```json
{
  "quickOverview": {
    "revenue": 67000,
    "newLeads": 158,
    "conversions": 42,
    "conversionRate": 26.6
  },
  "detailedSummary": {
    "totalRevenue": 331000,
    "totalLeads": 828,
    "conversions": 205,
    "conversionRate": 24.8
  },
  "monthlyBreakdown": [
    {
      "month": "Jan",
      "monthKey": "2026-01",
      "revenue": 45000,
      "leads": 120,
      "conversions": 28,
      "conversionRate": 23.3
    }
  ],
  "filters": {
    "lifecycleStatus": "all",
    "timeframe": "monthly",
    "months": 6
  }
}
```

| Block | FE mapping |
|-------|------------|
| `quickOverview` | Top cards: This month Revenue, New Leads, Conversions, Conversion Rate |
| `detailedSummary` | Totals row: Total Revenue, Total Leads, Conversions |
| `monthlyBreakdown` | Table columns: MONTH, REVENUE, LEADS, CONVERSIONS, CONVERSION RATE |

### Example

```http
GET /api/admin/reports/analytics?lifecycleStatus=all&timeframe=monthly&months=6
GET /api/admin/reports/analytics?lifecycleStatus=negotiation&months=12
```

---

## §41 — Chat `senderType: "admin"` (Socket.io)

| | |
|---|---|
| **Change** | Staff messages from an **admin** user are stored and emitted with `senderType: "admin"` (was always `"sales"`). |

### What `senderType` means

| Value | Who sent it | Where it appears |
|-------|-------------|------------------|
| `customer` | Customer widget | Customer / staff transcript |
| `ai` | Claude (pre handoff) | Customer / staff transcript |
| `sales` | Sales user via `/admin` socket | Customer + admin/sales panels |
| `admin` | Admin user via `/admin` socket | Customer + admin/sales panels |

### Socket (unchanged event names)

Connect: `/admin` namespace with JWT in `handshake.auth.token`.

| Emit | Payload | Who |
|------|---------|-----|
| `join_lead_chat` | `{ leadId }` | admin, sales |
| `sales_message` | `{ leadId, content }` | **admin and sales** (same event) |
| `sales_typing_start` / `sales_typing_stop` | `{ leadId }` | admin, sales |

**Access:** Sales must own the lead (`assignedSales`). **Admin can message any lead** (no assignment check).

### `new_message` payload (staff → customer)

```json
{
  "_id": "...",
  "senderType": "admin",
  "senderId": "...",
  "senderName": "Admin User",
  "content": "Hello",
  "createdAt": "...",
  "leadId": "..."
}
```

When a **sales** user sends, `senderType` is `"sales"` (same shape).

### REST history

`GET /api/public/chat/:leadId/history` — `senderName` is set for `senderType` `sales` or `admin`.

### FE

- Render `admin` messages with a distinct label/avatar vs `sales`.
- Admin panel: still `emit('sales_message', …)` — no new socket event required.

---

## §42 — `jobId` + `projectId` on lead/project responses (backward compatible)

| | |
|---|---|
| **Change** | All lead/project list and detail APIs now return **both** `jobId` and `projectId` (same value, e.g. `PRO-042`). Existing FE using `projectId` is unchanged. |

| Field | Meaning |
|-------|---------|
| `jobId` | Stored on `Lead.jobId` |
| `projectId` | **Alias** of `jobId` for legacy FE |

**Applies to (non-exhaustive):** `GET /api/admin/leads`, `GET /api/sales/leads`, `GET .../detail`, `GET .../by-score`, customer `.../projects`, common `GET /api/leads`, plant projects, PO detail `lead`, assigned-leads rows, etc.

Full lead documents from `.lean()` also include both fields via `enrichLeadDocument`.
