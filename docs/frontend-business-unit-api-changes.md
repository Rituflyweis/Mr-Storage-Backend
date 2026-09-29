# Business Unit — API changes (before / after)

**Date:** 2026-09-28  
**Audience:** Frontend (Admin, Sales, Plant, Construction, Accounts, Customer portal)  
**Auth:** unchanged — `Authorization: Bearer <accessToken>`  
**Envelope:** unchanged — every response is `{ "success": true, "message": "...", "data": { ... } }`

This document lists **every API affected** by the new project business unit (Storage Material / Platform / Steel), showing the request and response **before** and **after** the change. Only fields relevant to the change are shown; `…` means "all other existing fields, unchanged".

> Nothing was removed or renamed. All changes are **additive** — existing frontend code keeps working. The frontend only needs to start sending `businessUnit` and reading `businessUnit` / `businessUnitLabel`.

---

## 0. Quick reference

### New fields

| Field | Where | Type | Values |
|-------|-------|------|--------|
| `businessUnit` | request (create / edit) and response | `string \| null` | `"storage_material"`, `"platform"`, `"steel"`, or `null` |
| `businessUnitLabel` | response only | `string` | `"Storage Material"`, `"Platform"`, `"Steel"`, or `""` when not set |

### Rules

| Case | Behaviour |
|------|-----------|
| Create without `businessUnit` | Allowed for now — saved as `null` |
| Create/edit with `"Steel"`, `" STEEL "` | Accepted, stored lowercase: `"steel"` |
| Edit with `null` or `""` | Clears it → `null` |
| Edit without the key | Unchanged |
| Any other value | `400 Validation failed` |
| Existing projects (created before this change) | Return `businessUnit: null`, `businessUnitLabel: ""` → show **"Not set"** |

### New query param on list APIs

`?businessUnit=storage_material | platform | steel | none`

- `none` → only projects with no business unit.
- Omitted / empty → no filtering (same as before).
- Anything else → `400 Validation failed`.

### Validation error (new)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "type": "field",
      "value": "wood",
      "msg": "businessUnit must be one of: storage_material, platform, steel",
      "path": "businessUnit",
      "location": "body"
    }
  ]
}
```

For list filters the same shape is returned with `"location": "query"`.

### Dropdown options

```json
[
  { "value": "storage_material", "label": "Storage Material" },
  { "value": "platform", "label": "Platform" },
  { "value": "steel", "label": "Steel" }
]
```

Also returned by `GET /api/construction/dashboard/filters` → `data.businessUnits`.

---

## 1. Create APIs (request + response changed)

All five create endpoints accept the new optional body field `businessUnit` and return it on the created `lead`.

### 1.1 Admin — Add lead

`POST /api/admin/leads`

**Before — request**

```json
{
  "customerId": "6a6b63cc63a85950372e1d00",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "source": "manual",
  "assignedSales": "69e61375e2dc3d6e7468ca3d"
}
```

**After — request**

```json
{
  "customerId": "6a6b63cc63a85950372e1d00",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "source": "manual",
  "assignedSales": "69e61375e2dc3d6e7468ca3d",
  "businessUnit": "storage_material"
}
```

**Before — response `201`**

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "lead": {
      "_id": "6aba0c2179fdcce8878687a2",
      "jobId": "PRO-048",
      "projectId": "PRO-048",
      "projectName": "Warehouse A",
      "buildingType": "Storage",
      "location": "Austin, TX",
      "lifecycleStatus": "initial_contact",
      "…": "…"
    }
  }
}
```

**After — response `201`**

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "lead": {
      "_id": "6aba0c2179fdcce8878687a2",
      "jobId": "PRO-048",
      "projectId": "PRO-048",
      "projectName": "Warehouse A",
      "businessUnit": "storage_material",
      "businessUnitLabel": "Storage Material",
      "buildingType": "Storage",
      "location": "Austin, TX",
      "lifecycleStatus": "initial_contact",
      "…": "…"
    }
  }
}
```

### 1.2 Admin — Add customer + first project

`POST /api/admin/customers`

**Before — request**

```json
{
  "firstName": "John",
  "email": "john@acme.com",
  "phone": "5125550100",
  "countryCode": "+1",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "assignedSales": "69e61375e2dc3d6e7468ca3d"
}
```

**After — request** (same + `businessUnit`)

```json
{
  "firstName": "John",
  "email": "john@acme.com",
  "phone": "5125550100",
  "countryCode": "+1",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "assignedSales": "69e61375e2dc3d6e7468ca3d",
  "businessUnit": "platform"
}
```

**Before — response `201`**

```json
{
  "data": {
    "customer": { "_id": "…", "customerId": "CUS-00035", "firstName": "John", "…": "…" },
    "lead": { "_id": "…", "jobId": "PRO-047", "projectId": "PRO-047", "projectName": "Warehouse A", "…": "…" }
  }
}
```

**After — response `201`**

```json
{
  "data": {
    "customer": { "_id": "…", "customerId": "CUS-00035", "firstName": "John", "…": "…" },
    "lead": {
      "_id": "…",
      "jobId": "PRO-047",
      "projectId": "PRO-047",
      "projectName": "Warehouse A",
      "businessUnit": "platform",
      "businessUnitLabel": "Platform",
      "…": "…"
    }
  }
}
```

### 1.3 Admin — Add project for existing customer

`POST /api/admin/customers/:customerId/leads`

**Before — request**

```json
{ "projectName": "Mezzanine B", "buildingType": "Storage", "assignedSales": "69e61375e2dc3d6e7468ca3d" }
```

**After — request**

```json
{ "projectName": "Mezzanine B", "buildingType": "Storage", "assignedSales": "69e61375e2dc3d6e7468ca3d", "businessUnit": "steel" }
```

**Response `201`** — same change as 1.1: `data.lead` gains `businessUnit` + `businessUnitLabel`.

### 1.4 Sales — Add lead

`POST /api/sales/leads`

**Before — request**

```json
{
  "customerId": "6a6b63cc63a85950372e1d00",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "notes": "Wants quote by Friday"
}
```

**After — request**

```json
{
  "customerId": "6a6b63cc63a85950372e1d00",
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "notes": "Wants quote by Friday",
  "businessUnit": "steel"
}
```

**Response `201`** — same change as 1.1: `data.lead` gains `businessUnit` + `businessUnitLabel`.

### 1.5 Sales — Add project for customer

`POST /api/sales/customers/:customerId/projects`

**Before — request**

```json
{ "projectName": "Mezzanine B", "buildingType": "Storage" }
```

**After — request**

```json
{ "projectName": "Mezzanine B", "buildingType": "Storage", "businessUnit": "storage_material" }
```

**Response `201`** — same change as 1.1: `data.lead` gains `businessUnit` + `businessUnitLabel`.

### 1.6 CSV import (admin + sales)

Body shape unchanged (`{ "csv": "<csv text>" }`); the CSV accepts a new optional **`businessUnit`** column. Blank or unrecognised values import as `null` (the row is **not** rejected). Response shape unchanged.

`POST /api/admin/leads/import`

**Before — CSV**

```csv
name,email,phone,projectType
John,john@acme.com,5125550100,Storage
```

**After — CSV**

```csv
name,email,phone,projectType,businessUnit
John,john@acme.com,5125550100,Storage,platform
```

`POST /api/sales/leads/import`

**Before — CSV**

```csv
projectName,customerEmail,customerName,customerPhone,buildingType,location
Warehouse A,john@acme.com,John,5125550100,Storage,Austin
```

**After — CSV**

```csv
projectName,customerEmail,customerName,customerPhone,buildingType,location,businessUnit
Warehouse A,john@acme.com,John,5125550100,Storage,Austin,steel
```

---

## 2. Edit APIs (request + response changed)

### 2.1 Admin — Edit lead

`PUT /api/admin/leads/:leadId`

### 2.2 Sales — Edit lead

`PUT /api/sales/leads/:leadId`

Both behave the same.

**Before — request** (partial update)

```json
{ "projectName": "Warehouse A (revised)", "location": "Dallas, TX" }
```

**After — request examples**

```json
{ "businessUnit": "steel" }
```

```json
{ "projectName": "Warehouse A (revised)", "businessUnit": "platform" }
```

```json
{ "businessUnit": null }
```

| Body | Result |
|------|--------|
| `"businessUnit": "steel"` | set to steel |
| `"businessUnit": null` or `""` | cleared → `null` |
| key omitted | unchanged |
| `"businessUnit": "wood"` | `400 Validation failed` |

**Before — response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": { "_id": "…", "jobId": "PRO-048", "projectId": "PRO-048", "projectName": "Warehouse A (revised)", "…": "…" }
  }
}
```

**After — response `200`**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": {
      "_id": "…",
      "jobId": "PRO-048",
      "projectId": "PRO-048",
      "projectName": "Warehouse A (revised)",
      "businessUnit": "steel",
      "businessUnitLabel": "Steel",
      "…": "…"
    }
  }
}
```

The change is also recorded in the lead's audit log / timeline (`metadata.previousBusinessUnit` → `metadata.businessUnit`).

---

## 3. List & detail APIs (response changed, new `?businessUnit=` filter)

For every endpoint below:

- **Request before:** `GET <path>?page=1&limit=20&…`
- **Request after:** `GET <path>?page=1&limit=20&…&businessUnit=steel` (optional — only where "Filter" = ✅)
- **Response:** each project/lead object gains `businessUnit` + `businessUnitLabel`.

### 3.1 Admin — Leads

#### `GET /api/admin/leads` — Filter ✅

**Before — response**

```json
{
  "data": {
    "leads": [
      {
        "_id": "…",
        "jobId": "PRO-012",
        "projectId": "PRO-012",
        "projectName": "Warehouse A",
        "customerId": { "_id": "…", "firstName": "John", "…": "…" },
        "assignedSales": { "_id": "…", "name": "Sales 1", "…": "…" },
        "lifecycleStatus": "quote_sent",
        "budget": null,
        "…": "…"
      }
    ],
    "total": 44,
    "page": 1,
    "limit": 20
  }
}
```

**After — response**

```json
{
  "data": {
    "leads": [
      {
        "_id": "…",
        "jobId": "PRO-012",
        "projectId": "PRO-012",
        "projectName": "Warehouse A",
        "businessUnit": "storage_material",
        "businessUnitLabel": "Storage Material",
        "customerId": { "_id": "…", "firstName": "John", "…": "…" },
        "assignedSales": { "_id": "…", "name": "Sales 1", "…": "…" },
        "lifecycleStatus": "quote_sent",
        "budget": null,
        "…": "…"
      }
    ],
    "total": 44,
    "page": 1,
    "limit": 20
  }
}
```

#### `GET /api/admin/leads/:leadId/detail` — Filter ❌

**Before:** `data.lead = { _id, jobId, projectId, projectName, …}`  
**After:** `data.lead = { _id, jobId, projectId, projectName, businessUnit, businessUnitLabel, … }`

#### `GET /api/admin/leads/by-score` — Filter ✅

**Before — row**

```json
{
  "leadId": "…",
  "jobId": "PRO-012",
  "projectId": "PRO-012",
  "customerName": "John",
  "projectName": "Warehouse A",
  "location": "Austin, TX",
  "lifecycleStatus": "quote_sent",
  "status": "warm",
  "score": 62,
  "quoteValue": 18000,
  "temperature": "warm",
  "updatedAt": "…"
}
```

**After — row**

```json
{
  "leadId": "…",
  "jobId": "PRO-012",
  "projectId": "PRO-012",
  "customerName": "John",
  "projectName": "Warehouse A",
  "businessUnit": "platform",
  "businessUnitLabel": "Platform",
  "location": "Austin, TX",
  "lifecycleStatus": "quote_sent",
  "status": "warm",
  "score": 62,
  "quoteValue": 18000,
  "temperature": "warm",
  "updatedAt": "…"
}
```

Response wrapper unchanged: `{ leads: [row], total, page, limit }`.

#### `GET /api/admin/leads/ai-handled` — Filter ✅

**Before — row:** `{ _id, jobId, projectId, customerId: { firstName, email }, buildingType, location, lifecycleStatus, leadScoring, createdAt }`  
**After — row:** same + `businessUnit`, `businessUnitLabel`  
Wrapper unchanged: `{ leads: [row], total }`.

#### `GET /api/admin/leads/signed-contracts` — Filter ✅

**Before — row**

```json
{ "_id": "…", "projectId": "PRO-020", "jobId": "PRO-020", "projectName": "Yard C", "customerId": { "firstName": "Ann" }, "agreementUploadedAt": "…", "assignedSales": { "name": "Sales 1" }, "lifecycleStatus": "contract_signed" }
```

**After — row**

```json
{ "_id": "…", "projectId": "PRO-020", "jobId": "PRO-020", "projectName": "Yard C", "businessUnit": "steel", "businessUnitLabel": "Steel", "customerId": { "firstName": "Ann" }, "agreementUploadedAt": "…", "assignedSales": { "name": "Sales 1" }, "lifecycleStatus": "contract_signed" }
```

Wrapper unchanged: `{ contracts: [row], total }`.

#### `GET /api/admin/leads/terminated` — Filter ✅

**Before — row:** `{ _id, jobId, projectId, projectName, customerId, assignedSales, terminatedAt, terminationReason, lifecycleStatus }`  
**After — row:** same + `businessUnit`, `businessUnitLabel`  
Wrapper unchanged: `{ projects: [row], total }`.

#### `GET /api/admin/escalations` — Filter ❌

Also: `PUT /api/admin/escalations/:escalationId/resolve` (and resolve-and-reassign) responses — `data.lead` uses the same row shape.

**Before — row**

```json
{
  "_id": "…",
  "jobId": "PRO-031",
  "projectId": "PRO-031",
  "projectName": "Warehouse A",
  "lifecycleStatus": "quote_sent",
  "quoteValue": 0,
  "customerId": { "…": "…" },
  "customerName": "John",
  "buildingType": "Storage",
  "location": "Austin",
  "escalation": { "_id": "…", "note": "…", "status": "pending", "…": "…" }
}
```

**After — row:** same + `"businessUnit": "steel", "businessUnitLabel": "Steel"`.

### 3.2 Admin / Sales — Customer projects

These lists only include projects **raised to PO** (unchanged behaviour).

#### `GET /api/admin/customers/:customerId/projects` — Filter ✅
#### `GET /api/sales/customers/:customerId/projects` — Filter ✅

**Before — response**

```json
{
  "data": {
    "projects": [
      {
        "_id": "…",
        "projectId": "PRO-012",
        "jobId": "PRO-012",
        "projectName": "Warehouse A",
        "numberOfBuildings": 1,
        "lifecycleStatus": "po_raised",
        "quoteValue": 18000,
        "budget": null,
        "createdAt": "…"
      }
    ],
    "total": 1
  }
}
```

**After — response**

```json
{
  "data": {
    "projects": [
      {
        "_id": "…",
        "projectId": "PRO-012",
        "jobId": "PRO-012",
        "projectName": "Warehouse A",
        "businessUnit": "steel",
        "businessUnitLabel": "Steel",
        "numberOfBuildings": 1,
        "lifecycleStatus": "po_raised",
        "quoteValue": 18000,
        "budget": null,
        "createdAt": "…"
      }
    ],
    "total": 1
  }
}
```

Admin rows also include `assignedSales` and `isTerminated` (unchanged).

#### `GET /api/admin/customers/:customerId/projects/:leadId` — Filter ❌

**Before:** `data = { lead: { …, projectName }, quotation, invoices }`  
**After:** `data.lead` gains `businessUnit`, `businessUnitLabel`.

### 3.3 Sales — Leads

#### `GET /api/sales/leads` — Filter ✅

**Before — row**

```json
{
  "_id": "…",
  "jobId": "PRO-012",
  "projectId": "PRO-012",
  "projectName": "Warehouse A",
  "customerId": { "_id": "…", "firstName": "John", "email": "john@acme.com" },
  "lifecycleStatus": "quote_sent",
  "quoteValue": 18000,
  "leadScoring": { "score": 62 },
  "buildingType": "Storage",
  "location": "Austin, TX",
  "isRaisedToPO": false,
  "nextFollowUp": null
}
```

**After — row**

```json
{
  "_id": "…",
  "jobId": "PRO-012",
  "projectId": "PRO-012",
  "projectName": "Warehouse A",
  "businessUnit": "storage_material",
  "businessUnitLabel": "Storage Material",
  "customerId": { "_id": "…", "firstName": "John", "email": "john@acme.com" },
  "lifecycleStatus": "quote_sent",
  "quoteValue": 18000,
  "leadScoring": { "score": 62 },
  "buildingType": "Storage",
  "location": "Austin, TX",
  "isRaisedToPO": false,
  "nextFollowUp": null
}
```

Wrapper unchanged: `{ leads: [row], total, page, limit }`.

#### `GET /api/sales/leads/:leadId/detail` — Filter ❌

**Before:** `data.lead = { …, projectName }`  
**After:** `data.lead` gains `businessUnit`, `businessUnitLabel`.

#### `GET /api/sales/leads/by-score` — Filter ✅

Same row change as admin by-score (3.1).

#### `GET /api/sales/leads/scored` — Filter ✅

**Before — row:** `{ _id, jobId, projectId, projectName, customerId: { _id, firstName }, lifecycleStatus, quoteValue, leadScoring: { score, projectSize, … } }`  
**After — row:** same + `businessUnit`, `businessUnitLabel`  
Wrapper unchanged: `{ leads: [row], total }`.

#### `GET /api/sales/leads/with-po` — Filter ✅

**Before — row**

```json
{
  "_id": "…",
  "projectId": "PRO-015",
  "projectName": "Yard C",
  "location": "Austin",
  "lifecycleStatus": "po_raised",
  "quoteValue": 22000,
  "isRaisedToPO": true,
  "poNumber": "PO-0007",
  "poStatus": "pending",
  "customerId": { "…": "…" },
  "po": { "_id": "…", "poNumber": "PO-0007", "status": "pending", "…": "…" }
}
```

**After — row:** same + `"businessUnit": "platform", "businessUnitLabel": "Platform"`.

#### `GET /api/sales/leads/escalated` — Filter ❌

Same row change as admin escalations (3.1).

### 3.4 Shared lookups

#### `GET /api/leads` — Filter ✅ (project dropdowns, all staff panels)

**Before:** `data = { leads: [{ _id, jobId, projectId, projectName, customerId, assignedSales, … }], total, … }`  
**After:** each lead gains `businessUnit`, `businessUnitLabel`.

Example: `GET /api/leads?search=ware&businessUnit=steel`

### 3.5 Plant panel (also `/api/admin/plant/...`)

#### `GET /api/plant/projects` — Filter ✅

**Before — row**

```json
{
  "_id": "…",
  "projectName": "Warehouse A",
  "jobId": "PRO-012",
  "projectId": "PRO-012",
  "location": "Austin",
  "clientName": "John Smith",
  "customer": { "firstName": "John", "lastName": "Smith" },
  "buildingType": "Storage",
  "numberOfBuildings": 2,
  "quoteValue": 18000,
  "drawingStatus": "approved",
  "bomStatus": "pending",
  "lifecycleStatus": "in_production",
  "isTerminated": false,
  "createdAt": "…"
}
```

**After — row:** same + `"businessUnit": "steel", "businessUnitLabel": "Steel"`.  
Wrapper unchanged: `{ projects: [row], total, page, limit }`.

#### `GET /api/plant/projects/stats` — Filter ✅

Request gains `?businessUnit=`; response shape **unchanged** (counts are just filtered).

#### `GET /api/plant/projects/:leadId/detail` — Filter ❌

**Before**

```json
{
  "data": {
    "lead": { "…": "…" },
    "projectName": "Warehouse A",
    "jobId": "PRO-012",
    "projectId": "PRO-012",
    "buildingType": "Storage",
    "…": "…"
  }
}
```

**After**

```json
{
  "data": {
    "lead": { "…": "…", "businessUnit": "steel", "businessUnitLabel": "Steel" },
    "projectName": "Warehouse A",
    "businessUnit": "steel",
    "businessUnitLabel": "Steel",
    "jobId": "PRO-012",
    "projectId": "PRO-012",
    "buildingType": "Storage",
    "…": "…"
  }
}
```

#### Plant project lists (response only) — Filter ❌

| Endpoint |
|----------|
| `GET /api/plant/bom/projects` |
| `GET /api/admin/plant/bom/consolidated` |
| `GET /api/plant/shipper-files/projects` (also `/shipper-requests/projects`) |
| `GET /api/plant/load-planning/projects` |
| `GET /api/plant/packing-lists/projects` |

Each project row already had `customerName`, `buildingType`, `location` (name fallback fields).

**Before — row fragment:** `{ …, "customerName": "John Smith", "buildingType": "Storage", "location": "Austin" }`  
**After — row fragment:** `{ …, "customerName": "John Smith", "buildingType": "Storage", "location": "Austin", "businessUnit": "steel", "businessUnitLabel": "Steel" }`

#### Packing list plan — `data.project` changed

`GET /api/plant/packing-list-plans/:packingListPlanId` and public `GET /api/plant/packing-list-plans/:packingListPlanId` (QR page)

**Before:** `data.project = { leadId, projectId, jobId, projectName, buildingType, location, lifecycleStatus, customer }`  
**After:** `data.project` gains `businessUnit`, `businessUnitLabel`.

### 3.6 Construction panel

#### `GET /api/construction/projects` — Filter ✅

**Before — row**

```json
{
  "_id": "…",
  "projectName": "Warehouse A",
  "jobId": "PRO-012",
  "buildingType": "Storage",
  "location": "Austin",
  "lifecycleStatus": "in_production",
  "priority": "medium",
  "endDate": null,
  "plannedStartDate": null,
  "customerId": { "firstName": "John", "lastName": "Smith", "email": "…" },
  "createdAt": "…"
}
```

**After — row:** same + `"businessUnit": "platform", "businessUnitLabel": "Platform"`.  
Wrapper unchanged: `{ projects: [row], total, page, limit, scope: "construction" }`.

#### `GET /api/construction/projects/:leadId` — Filter ❌

**Before:** `data = { project: { …, projectName }, deliveries, tasks }`  
**After:** `data.project` gains `businessUnit`, `businessUnitLabel`.

#### `GET /api/construction/projects/calendar` — Filter ✅

**Before — entry `project`:** `{ leadId, projectName, jobId, location, lifecycleStatus }`  
**After — entry `project`:** same + `businessUnit`, `businessUnitLabel`.

#### `GET /api/construction/dashboard` — Filter ✅

**Before — `data.filtersApplied`**

```json
{ "projectId": null, "buildingId": null, "status": null, "fromDate": null, "toDate": null }
```

**After — `data.filtersApplied`**

```json
{ "projectId": null, "buildingId": null, "status": null, "businessUnit": "steel", "fromDate": null, "toDate": null }
```

(`businessUnit` is `null` when not filtering; `null` is also returned for `?businessUnit=none`.)

**Before — `data.activeSites[]` row:** `{ leadId, projectName, jobId, site, buildingType, numberOfBuildings, progressPct, deadline, deliveryStatus, lifecycleStatus }`  
**After — row:** same + `businessUnit`, `businessUnitLabel`.

#### `GET /api/construction/dashboard/filters` — Filter ❌

**Before**

```json
{
  "data": {
    "projects": [{ "_id": "…", "projectName": "Warehouse A", "jobId": "PRO-012", "lifecycleStatus": "in_production", "location": "Austin" }],
    "buildings": [{ "…": "…" }],
    "statuses": ["…"]
  }
}
```

**After**

```json
{
  "data": {
    "projects": [{ "_id": "…", "projectName": "Warehouse A", "jobId": "PRO-012", "businessUnit": "steel", "businessUnitLabel": "Steel", "lifecycleStatus": "in_production", "location": "Austin" }],
    "buildings": [{ "…": "…" }],
    "statuses": ["…"],
    "businessUnits": [
      { "value": "storage_material", "label": "Storage Material" },
      { "value": "platform", "label": "Platform" },
      { "value": "steel", "label": "Steel" }
    ]
  }
}
```

#### `GET /api/admin/construction/overview` — Filter ❌

**Before — `data.liveSiteConstruction[]` row:** `{ leadId, projectName, jobId, location, progressPct, tasks, workersOnSite, equipmentInUse, currentPhase }`  
**After — row:** same + `businessUnit`, `businessUnitLabel`.

### 3.7 Accounts panel

#### `GET /api/account/projects` — Filter ✅

**Before:** `data = { projects: [{ _id, jobId, projectId, projectName, customerId, assignedSales, … }] }`  
**After:** each project gains `businessUnit`, `businessUnitLabel`.

### 3.8 Admin — Employee profile

#### `GET /api/admin/employees/:userId/profile` — Filter ❌

For **sales** and **plant** employees, `assignedWork.items[]` rows gain `businessUnit`, `businessUnitLabel`.

**Before — sales item:** `{ …, jobId, projectId, projectName, buildingType, location, status, statusLabel, … }`  
**After — sales item:** same + `businessUnit`, `businessUnitLabel`.

**Before — plant item:** `{ leadId, projectName, jobId, projectId, buildingType, location, … }`  
**After — plant item:** same + `businessUnit`, `businessUnitLabel`.

### 3.9 Customer portal (customer token)

#### `GET /api/customer/projects` — Filter ❌

**Before — `data.projects[]`:** `{ _id, jobId, projectId, projectName, buildingType, location, lifecycleStatus, quoteValue, … }`  
**After:** same + `businessUnit`, `businessUnitLabel`.

#### `GET /api/customer/projects/:leadId` — Filter ❌

**Before:** `data.lead = { …, projectName, buildingsCount }`  
**After:** `data.lead` gains `businessUnit`, `businessUnitLabel`.

> Customers **cannot** set the business unit. `POST /api/customer/projects` is unchanged and creates projects with `businessUnit: null`; staff set it afterwards via Edit lead.

---

## 4. Real-time (Socket.IO `/admin` namespace)

Events `lead_list_created` and `lead_list_updated` — the lead row payloads (admin row, sales row, and score row) now include `businessUnit` + `businessUnitLabel`, matching the list APIs above. Event names and wrapper payload unchanged.

---

## 5. Exports

| Endpoint | Filter | Before | After |
|----------|--------|--------|-------|
| `GET /api/admin/leads/export/excel` | ✅ | `.xlsx` columns: Lead ID, Job ID, Project Name, Building Type, … | New column **"Business Unit"** (label, e.g. `Steel`) after Project Name |
| `GET /api/sales/leads/export/excel` | ✅ | same | same |
| `GET /api/sales/leads/export` (CSV) | ✅ | header `projectName,customerId,customerName,customerEmail,location,buildingType,lifecycleStatus,quoteValue,createdAt` | `…,createdAt,businessUnit` (raw value, e.g. `steel`) appended as last column |

Excel endpoints' JSON response is unchanged: `{ fileUrl, key, exportedCount, generatedAt }`.

---

## 6. Not affected

- Quotations, invoices, SOW, contracts, POs — requests, responses, PDFs and emails are unchanged. Read the business unit from the project/lead.
- Stats endpoints (except plant `projects/stats` gaining the optional filter) — unchanged.
- Customer portal create project, public/chat lead creation — unchanged (`businessUnit` stays `null`).

---

## 7. Frontend checklist

- [ ] Add a **Business Unit** select (Storage Material / Platform / Steel) to: Add Lead (admin + sales), Add Customer + Project (admin), Add Project for Customer (admin + sales), Edit Lead (admin + sales).
- [ ] Send `businessUnit` in those request bodies; send `null` to clear on edit.
- [ ] Show `businessUnitLabel` (or "Not set" when empty) on lead/project lists, detail headers, escalations, plant and construction screens.
- [ ] Add a Business Unit filter to list screens and pass `?businessUnit=` (`none` = "Not set").
- [ ] Construction dashboard: use `dashboard/filters` → `businessUnits` for the dropdown; read `filtersApplied.businessUnit`.
- [ ] CSV import templates: add optional `businessUnit` column.
- [ ] Handle the new `400 Validation failed` error on `businessUnit`.
