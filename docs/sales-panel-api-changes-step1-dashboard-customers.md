# Sales Panel API Changes — Step 1 (Dashboard + Customers)

**Status:** Planned (not implemented)  
**Frontend guide:** [sales-panel-frontend-api-migration.md](./sales-panel-frontend-api-migration.md)  
**Scope:** Dashboard stats + Sales customers module only  
**Out of scope (Step 2 — Leads / project detail):** `GET /api/sales/leads/:leadId/detail`, assigned sales populate, agreement URL, invoice `overdue` amount, priority removal  

This document is the implementation spec for frontend and backend. Each section shows **current** vs **planned** request/response under the standard wrapper:

```json
{ "success": true, "message": "Success", "data": { ... } }
```

**Customer naming:** Display name = `firstName` only. Do not use `lastName` in the sales UI.

---

## Summary of affected endpoints

| # | Method | Endpoint | Change type |
|---|--------|----------|-------------|
| 1 | GET | `/api/sales/dashboard/stats` | Fix `followUpPending` date field |
| 2 | GET | `/api/sales/customers/stats` | Add date range query |
| 3 | GET | `/api/sales/customers` | Add date range; confirm `phone` object + `isActive` filter |
| 4 | GET | `/api/sales/customers/:customerId` | Return `photo`, `address` |
| 5 | PUT | `/api/sales/customers/:customerId` | **NEW** — edit customer |
| 6 | GET | `/api/sales/customers/:customerId/projects` | `projectId` = `jobId`; add `isActive` status per project |
| 7 | POST | `/api/sales/customers/:customerId/projects` | Accept `doors`, `windows`, `insulation` |

### Schema & related create flows (not new routes in Step 1 doc, but required when implementing)

| Area | Change |
|------|--------|
| `Customer` model | Add `address` (string). Keep existing `location` unchanged. |
| `POST /api/sales/leads` | Accept optional `address` on new customer |
| `POST /api/admin/customers` | Accept optional `address` (align admin with schema) |
| Public / portal customer create | Accept `address` where customer is created (follow-up task when implementing schema) |

---

## 1. Dashboard stats

### `GET /api/sales/dashboard/stats`

**Auth:** JWT, role `sales`

#### Query parameters

| Param | Before | After |
|-------|--------|-------|
| `startDate` | Filters leads & escalations on `createdAt`; follow-ups also on `createdAt` (**bug**) | Same for leads & escalations; follow-ups use `followUpDate` |
| `endDate` | Same | Same |

#### Behaviour change (internal)

| Metric | Date field (before) | Date field (after) |
|--------|---------------------|-------------------|
| `totalLeads` | `Lead.createdAt` | unchanged |
| `leadsClosed` | `Lead.createdAt` | unchanged |
| `followUpPending` | `FollowUp.createdAt` | **`FollowUp.followUpDate`** |
| `escalationsPending` | `Escalation.createdAt` | unchanged |

Pending follow-ups are counted when **`followUpDate`** falls in the range, not when the follow-up record was created.

#### Response — before

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalLeads": 24,
    "leadsClosed": 5,
    "followUpPending": 3,
    "escalationsPending": 1
  }
}
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalLeads": 24,
    "leadsClosed": 5,
    "followUpPending": 7,
    "escalationsPending": 1
  }
}
```

Same field names and shape. **Only counts may change** when a date range is applied (especially `followUpPending`).

#### Frontend notes

- No response key renames.
- If the dashboard stat card looked wrong with `startDate`/`endDate`, it should match follow-ups due in that period after this fix.

#### Also duplicated at

`GET /api/sales/leads/stats` — same fix should be applied there for consistency (same controller pattern).

---

## 2. Customer stats

### `GET /api/sales/customers/stats`

**Auth:** JWT, role `sales`  
**Scope:** Customers linked to leads where `assignedSales = req.user._id`

#### Query parameters

| Param | Before | After |
|-------|--------|-------|
| `startDate` | — | Optional. ISO date. Filters customer metrics by `Customer.createdAt` |
| `endDate` | — | Optional. ISO date (inclusive end of day) |

When **both omitted**, behaviour stays as today (all-time totals; `newThisMonth` = current calendar month).

When **either provided**, all four metrics are computed only for customers with `createdAt` in range:

| Metric | Before (no range) | After (with range) |
|--------|-------------------|---------------------|
| `total` | All own customers | Own customers created in range |
| `active` | `isActive: true` among own | Active among those created in range |
| `newThisMonth` | Created this calendar month | Customers created in range (same window as `total`; label on FE may stay “new” for the selected period) |
| `returning` | Customers with >1 lead (all time) | Customers in range with >1 lead (assigned to this rep) |

#### Response — before

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "total": 42,
    "active": 38,
    "newThisMonth": 6,
    "returning": 9
  }
}
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "total": 12,
    "active": 11,
    "newThisMonth": 12,
    "returning": 3
  }
}
```

Shape unchanged; values depend on `?startDate=&endDate=`.

#### Frontend notes

- Wire stat cards to `startDate` / `endDate` when the customers page has a date picker.
- `newThisMonth` with a custom range effectively means “new in selected period” — consider relabelling in UI if the range is not “this month”.

---

## 3. Customer list

### `GET /api/sales/customers`

#### Query parameters

| Param | Before | After |
|-------|--------|-------|
| `search` | `firstName`, `email`, `customerId` | unchanged |
| `isActive` | `true` / `false` → filters `Customer.isActive` | unchanged (**this is the status filter**) |
| `page`, `limit` | pagination | unchanged |
| `startDate` | — | Optional → `Customer.createdAt >= startDate` |
| `endDate` | — | Optional → `Customer.createdAt <= endDate` (end of day) |

There is **no** `enquiryFor` query or response field today and none will be added.

#### Response — before

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "customers": [
      {
        "_id": "665a1b2c3d4e5f6789012345",
        "customerId": "CUS-00042",
        "firstName": "Jane",
        "email": "jane@example.com",
        "phone": {
          "number": "9876543210",
          "countryCode": "+91"
        },
        "source": "manual",
        "isActive": true,
        "createdAt": "2026-05-01T10:00:00.000Z",
        "totalProjects": 2
      }
    ],
    "total": 1
  }
}
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "customers": [
      {
        "_id": "665a1b2c3d4e5f6789012345",
        "customerId": "CUS-00042",
        "firstName": "Jane",
        "email": "jane@example.com",
        "phone": {
          "number": "9876543210",
          "countryCode": "+91"
        },
        "source": "manual",
        "isActive": true,
        "createdAt": "2026-05-01T10:00:00.000Z",
        "totalProjects": 2
      }
    ],
    "total": 1
  }
}
```

**Shape unchanged.** `phone` remains an **object** (not a flattened string).

#### Frontend notes

| UI label | API field |
|----------|-----------|
| Customer name | `firstName` |
| Phone | `phone.number` (+ `phone.countryCode` if needed) |
| Status filter | Query `?isActive=true` or `?isActive=false` |
| Status display | `isActive` → Active / Inactive |
| Enquiry for | **Remove from UI** — not in API |

---

## 4. Customer detail

### `GET /api/sales/customers/:customerId`

**Guard:** Customer must belong to the salesperson’s portfolio (403 otherwise).

#### Response — before

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "customer": {
      "_id": "665a1b2c3d4e5f6789012345",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "email": "jane@example.com",
      "phone": {
        "number": "9876543210",
        "countryCode": "+91"
      },
      "isActive": true,
      "source": "manual",
      "createdAt": "2026-05-01T10:00:00.000Z"
    },
    "financials": {
      "totalPaid": 50000,
      "pendingPayment": 12000,
      "totalInvoices": 4,
      "revenueGenerated": 50000
    }
  }
}
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "customer": {
      "_id": "665a1b2c3d4e5f6789012345",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "email": "jane@example.com",
      "phone": {
        "number": "9876543210",
        "countryCode": "+91"
      },
      "photo": "https://cdn.example.com/photos/jane.jpg",
      "address": "123 Main St, Austin, TX",
      "isActive": true,
      "source": "manual",
      "createdAt": "2026-05-01T10:00:00.000Z"
    },
    "financials": {
      "totalPaid": 50000,
      "pendingPayment": 12000,
      "totalInvoices": 4,
      "revenueGenerated": 50000
    }
  }
}
```

| Field | Before | After |
|-------|--------|-------|
| `customer.photo` | omitted | included (`null` if not set) |
| `customer.address` | omitted | included (`""` default) |

`customer.location` (legacy) may remain on the model but **`address` is the field the sales detail UI should use**.

---

## 5. Edit customer (NEW)

### `PUT /api/sales/customers/:customerId`

**Auth:** JWT, role `sales`  
**Guard:** Same portfolio check as GET detail.

#### Request body — planned

All fields optional; at least one required.

```json
{
  "firstName": "Jane",
  "email": "jane@example.com",
  "phone": {
    "number": "9876543210",
    "countryCode": "+91"
  },
  "photo": "https://cdn.example.com/photos/jane.jpg",
  "address": "123 Main St, Austin, TX",
  "isActive": true
}
```

| Field | Rules |
|-------|--------|
| `firstName` | Non-empty trim if sent |
| `email` | Valid email; unique among customers if changed |
| `phone` | `{ number, countryCode }` if sent |
| `photo` | URL string or `null` to clear |
| `address` | String |
| `isActive` | Boolean |

`lastName` is **not** accepted on this endpoint (sales uses `firstName` only).

#### Response — planned (200)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "customer": {
      "_id": "665a1b2c3d4e5f6789012345",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "email": "jane@example.com",
      "phone": {
        "number": "9876543210",
        "countryCode": "+91"
      },
      "photo": "https://cdn.example.com/photos/jane.jpg",
      "address": "123 Main St, Austin, TX",
      "isActive": true,
      "source": "manual",
      "createdAt": "2026-05-01T10:00:00.000Z",
      "updatedAt": "2026-05-22T14:30:00.000Z"
    }
  }
}
```

#### Audit

Log `customer.updated` (or reuse existing customer audit action if added to `constants.js`).

---

## 6. Customer projects list

### `GET /api/sales/customers/:customerId/projects`

Each row is a **Lead** (project) for that customer, assigned to the current salesperson.

#### Response — before

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectName": "Warehouse Expansion",
        "numberOfBuildings": 2,
        "lifecycleStatus": "proposal_sent",
        "quoteValue": 120000,
        "budget": {
          "totalBudget": 80000,
          "expectedProfit": 40000
        },
        "createdAt": "2026-04-15T08:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "projects": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectId": "PRO-003",
        "projectName": "Warehouse Expansion",
        "numberOfBuildings": 2,
        "lifecycleStatus": "proposal_sent",
        "isActive": true,
        "quoteValue": 120000,
        "budget": {
          "totalBudget": 80000,
          "expectedProfit": 40000
        },
        "createdAt": "2026-04-15T08:00:00.000Z"
      }
    ],
    "total": 1
  }
}
```

| Field | Before | After |
|-------|--------|-------|
| `projectId` | — | **`jobId`** from lead (e.g. `PRO-003`). FE “Project ID” column uses this. |
| `isActive` | — | **Boolean** — `true` when lead is not terminated (`!isTerminated`) |
| `_id` | Mongo lead id | unchanged (internal id for navigation to detail) |

#### Frontend notes

| UI column | API field |
|-----------|-----------|
| Project ID | `projectId` (not `_id`) |
| Status | `isActive` → Active (`true`) / Inactive (`false`) |
| Lifecycle | `lifecycleStatus` (unchanged) |

---

## 7. Create project (create lead for customer)

### `POST /api/sales/customers/:customerId/projects`

Creates a new lead; `assignedSales` = current user.

#### Request body — before

```json
{
  "projectName": "Warehouse Expansion",
  "buildingType": "PEB",
  "location": "Austin, TX",
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 18
}
```

Required: `projectName`, `buildingType`, `location`.

#### Request body — after

```json
{
  "projectName": "Warehouse Expansion",
  "buildingType": "PEB",
  "location": "Austin, TX",
  "roofStyle": "Gable",
  "width": 40,
  "length": 60,
  "height": 18,
  "doors": 2,
  "windows": 4,
  "insulation": 1
}
```

| Field | Maps to Lead model |
|-------|-------------------|
| `doors` | `numDoors` |
| `windows` | `numWindows` |
| `insulation` | `numInsulation` |

All three optional, numeric (same as `POST /api/sales/leads`).

#### Response — before

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "lead": {
      "_id": "665b2c3d4e5f67890123456",
      "customerId": "665a1b2c3d4e5f6789012345",
      "projectName": "Warehouse Expansion",
      "buildingType": "PEB",
      "location": "Austin, TX",
      "roofStyle": "Gable",
      "width": 40,
      "length": 60,
      "height": 18,
      "jobId": "PRO-004",
      "numDoors": null,
      "numWindows": null,
      "numInsulation": null,
      "assignedSales": "664c1a2b3d4e5f6789012001",
      "lifecycleStatus": "initial_contact",
      "createdAt": "2026-05-22T12:00:00.000Z"
    }
  }
}
```

#### Response — after

Same shape; `lead` includes populated numeric fields when sent:

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "lead": {
      "_id": "665b2c3d4e5f67890123456",
      "jobId": "PRO-004",
      "projectName": "Warehouse Expansion",
      "numDoors": 2,
      "numWindows": 4,
      "numInsulation": 1
    }
  }
}
```

(`jobId` is set on save via Lead pre-save hook.)

---

## 8. Schema: `Customer.address`

### Model change (planned)

```js
address: { type: String, default: '', trim: true }
```

Existing `location` on Customer is **not removed** (may still be used elsewhere). Sales UI should use **`address`** for the detail form.

### Create customer flows that should accept `address` when implementing

| Endpoint | Notes |
|----------|--------|
| `POST /api/sales/leads` | New customer branch — optional `address` in body |
| `POST /api/admin/customers` | Optional `address` in body |
| `PUT /api/sales/customers/:customerId` | See §5 |

---

## 9. Deferred to Step 2 (Leads / project detail)

Do **not** implement in Step 1. See **[Step 2 — Leads + Follow-ups](./sales-panel-api-changes-step2-leads-followups.md)** §4.

| Item | Endpoint (expected) |
|------|---------------------|
| Populate `assignedSales` on project detail | `GET /api/sales/leads/:leadId/detail` |
| Top-level `agreement` URL | Same |
| Remove / ignore `priority` on detail | Same |
| `payments.totalOverdue` (by invoice due / payment date rule) | Same |

---

## 10. Implementation checklist (backend)

- [ ] `dashboard.controller.js` — `followUpPending` uses `buildDateFilter(req.query, 'followUpDate')`
- [ ] `lead.controller.js` — same for `getLeadsStats` if kept in sync
- [ ] `customer.controller.js` — `getCustomerStats` + `getCustomers` date filters
- [ ] `Customer` model — add `address`
- [ ] `customer.controller.js` — `getCustomerDetail` select `photo`, `address`
- [ ] `customer.controller.js` — **new** `updateCustomer` + route `PUT /:customerId`
- [ ] `customer.controller.js` — `getCustomerProjects` add `projectId` (`jobId`), `isActive`
- [ ] `customer.controller.js` + `customer.routes.js` — `createProject` doors/windows/insulation
- [ ] `lead.controller.js` — `createLead` accept `address`
- [ ] `admin/customer.controller.js` — `createCustomerWithLead` accept `address` (optional alignment)
- [ ] Postman collection — update affected requests
- [ ] Constants — add `CUSTOMER_UPDATED` audit action if missing

---

## 11. Step index (full sales panel audit)

| Step | Pages | Doc |
|------|-------|-----|
| **1 (this file)** | Dashboard stats, Customers list/detail/projects/create | `sales-panel-api-changes-step1-dashboard-customers.md` |
| **2** | Leads list, Lead/project detail, Follow-ups, AI script generate | [step2](./sales-panel-api-changes-step2-leads-followups.md) |
| **3+** | Follow-ups, Quotations, PO, etc. | TBD |

---

*Last updated: 2026-05-22*
