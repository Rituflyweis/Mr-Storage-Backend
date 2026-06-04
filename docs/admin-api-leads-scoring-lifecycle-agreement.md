# Admin API — Lead scoring, lifecycle, notes, agreement, customers & employees

Standalone reference for frontend / email handoff.  
**Companion doc:** [api-changelog-edited-endpoints.md](./api-changelog-edited-endpoints.md) (full changelog).

**Base URL (production):** `https://flyweistechnology.com`  
**Base URL (local):** `http://localhost:<PORT>`

---

## Common conventions

| Item | Value |
|------|--------|
| **Auth** | `Authorization: Bearer <jwt_token>` |
| **Admin role** | `admin` required on all `/api/admin/*` routes below |
| **Success wrapper** | `{ "success": true, "message": "...", "data": { ... } }` |
| **Error wrapper** | `{ "success": false, "message": "..." }` |

### Lead temperature (hot / warm / cold)

| Value | Meaning |
|-------|---------|
| `hot` | Score ≥ 70 (auto) or set manually |
| `warm` | Score 40–69 (auto) or set manually |
| `cold` | Score &lt; 40 (auto) or set manually |

On **`GET .../by-score`**, query param `status` is an **alias for `temperature`** — not lifecycle status.

### Lifecycle stages (`lifecycleStatus`)

**Sales / pre-plant:**  
`initial_contact` · `requirements_gathered` · `proposal_sent` · `negotiation` · `deal_closed` · `payment_done` · `converted_to_po` · `sent_to_admin`

**Plant (after PO):**  
`released_to_plant` · `drawings_received` · `bom_received` · `bom_review` · `material_check` · `production_planning` · `fabrication_started` · `quality_inspection` · `packing_bundling` · `shipper_prepared` · `ready_for_delivery` · `dispatched` · `delivered`

### Closed lead stages (employee detail)

Used to split **`closedLeads`** vs **`activeLeads`** on employee detail:

`deal_closed` · `payment_done` · `converted_to_po` · `sent_to_admin` · `delivered`

**Active** = assigned to employee, not in closed stages, and `isTerminated` is not `true`.

### Customer panel — project scope (stats + drill-down lists)

Only customers with **at least one PO-raised project** (`Lead.isRaisedToPO: true`) appear in customer stats and lists.

| Scope | Meaning |
|-------|---------|
| **Total projects** | `isRaisedToPO: true` |
| **Active projects** | PO raised + `isTerminated: false` + `lifecycleStatus` ≠ `delivered` |
| **Completed projects** | PO raised + `lifecycleStatus: delivered` |
| **Not assigned projects** | PO raised + `assignedSales: null` + `isTerminated: false` |

Customer **`status`** in list responses is `"active"` / `"inactive"` from `Customer.isActive`.  
**`customerName`** is `Customer.firstName` only.

---

## Index

| # | Method | Endpoint | Purpose |
|---|--------|----------|---------|
| 1 | GET | `/api/admin/leads/by-score` | Lead score board + Hot/Warm/Cold filter |
| 2 | PUT | `/api/admin/leads/:leadId/lifecycle` | Update lifecycle status (+ optional note) |
| 3 | GET | `/api/admin/leads/:leadId/notes` | List lead notes |
| 4 | POST | `/api/admin/leads/:leadId/notes` | Add lead note |
| 5 | GET | `/api/admin/leads/:leadId/agreement` | Get signed agreement (lead context) |
| 6 | GET | `/api/admin/customers/:customerId/projects/:leadId/agreement` | Get signed agreement (project context) |
| 7 | POST | `/api/upload/leads/:leadId/agreement` | Upload agreement URL to lead |
| 8 | GET | `/api/admin/employees/:userId` | Employee detail — active/closed leads + KPIs |
| 9 | GET | `/api/admin/employees/:userId/assigned-leads` | Paginated assigned leads table |
| 10 | GET | `/api/admin/customers/stats` | Customer panel KPI cards |
| 11 | GET | `/api/admin/customers` | Paginated customer list (stats drill-down) |
| 12 | GET | `/api/admin/customers/projects` | Paginated project list (stats drill-down) |

---

# Leads — scoring, lifecycle, notes & agreement

---

## 1. `GET /api/admin/leads/by-score`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Leads by score table; tabs **Hot** / **Warm** / **Cold** |

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `temperature` | string | No | `hot`, `warm`, or `cold` |
| `status` | string | No | **Alias** for `temperature` (same values) |
| `search` | string | No | Customer name / email / customer code / project name / job id |
| `startDate` | ISO date | No | Filters `Lead.updatedAt` (inclusive start) |
| `endDate` | ISO date | No | Filters `Lead.updatedAt` (inclusive end of day) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `200` |

### Request body

None.

### Example requests

```http
GET /api/admin/leads/by-score?page=1&limit=20
GET /api/admin/leads/by-score?temperature=hot&page=1&limit=20
GET /api/admin/leads/by-score?temperature=warm&page=1&limit=20
GET /api/admin/leads/by-score?temperature=cold&page=1&limit=20
GET /api/admin/leads/by-score?status=hot&page=1&limit=20
GET /api/admin/leads/by-score?startDate=2026-05-01&endDate=2026-05-26&page=1&limit=20
```

### Response `data`

```json
{
  "leads": [
    {
      "leadId": "665a1b2c3d4e5f6789012345",
      "jobId": "PRO-042",
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
| `projectId` | Same as `jobId` (e.g. `PRO-042`) |
| `status` | **Temperature** (hot / warm / cold) for UI badges — not lifecycle |
| `temperature` | Same value as `status` |
| `lifecycleStatus` | Pipeline stage |
| `lifecycleHistory` | Full array; `changedBy` is ObjectId (not populated) |
| `score` | `leadScoring.score` (0–100) |

Sorted by **`updatedAt` descending**.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `temperature` / `status` — use hot, warm, or cold |
| 400 | Invalid `startDate` / `endDate` |
| 401 | Unauthorized |

### Frontend — do not use on score board

| Wrong filter | Use instead |
|--------------|-------------|
| `lifecycleStatus=proposal_sent` | `temperature=hot` (etc.) |
| `isQuoteReady=true` on main lead list | `GET .../by-score?temperature=` |

---

## 2. `PUT /api/admin/leads/:leadId/lifecycle`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Lead / project → **Update status** |

Dedicated lifecycle update. Prefer this over `PUT /api/admin/leads/:leadId` when only changing pipeline status.

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Query parameters

None.

### Request body

**Status only:**

```json
{
  "lifecycleStatus": "negotiation"
}
```

**Status + optional note:**

```json
{
  "lifecycleStatus": "negotiation",
  "note": "Customer requested revised timeline."
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `lifecycleStatus` | Yes | Valid `LIFECYCLE_STAGES` value (see above) |
| `note` | No | Appends to `lead.leadNotes[]` (same as POST `.../notes`) |

### Response `data`

```json
{
  "lead": {
    "_id": "665a1b2c3d4e5f6789012345",
    "jobId": "PRO-042",
    "projectId": "PRO-042",
    "projectName": "Warehouse A",
    "lifecycleStatus": "negotiation",
    "lifecycleHistory": [
      {
        "stage": "negotiation",
        "changedAt": "2026-06-03T10:00:00.000Z",
        "changedBy": "664c1a2b3d4e5f6789012001"
      }
    ]
  },
  "note": {
    "_id": "665f00000000000000000001",
    "note": "Customer requested revised timeline.",
    "addedAt": "2026-06-03T10:00:00.000Z",
    "addedBy": {
      "_id": "664c1a2b3d4e5f6789012001",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin"
    }
  }
}
```

`note` is **omitted** when no `note` was sent in the request.

**Side effects:** Audit log `lead.lifecycle_updated`; socket `lead_list_updated` (if enabled).

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid or missing `lifecycleStatus` |
| 404 | Lead not found |
| 401 | Unauthorized |

---

## 3. `GET /api/admin/leads/:leadId/notes`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Lead detail → Notes tab / list |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Query parameters

None.

### Request body

None.

### Response `data`

```json
{
  "leadId": "665a1b2c3d4e5f6789012345",
  "projectName": "Warehouse A",
  "jobId": "PRO-042",
  "notes": [
    {
      "_id": "665f00000000000000000001",
      "note": "Customer asked for revised quote by Friday.",
      "addedAt": "2026-05-28T10:00:00.000Z",
      "addedBy": {
        "_id": "664c1a2b3d4e5f6789012001",
        "name": "Admin User",
        "email": "admin@example.com",
        "role": "admin"
      }
    }
  ],
  "total": 1
}
```

Notes are sorted **newest first**.

### Errors

| HTTP | Message |
|------|---------|
| 404 | Lead not found |

---

## 4. `POST /api/admin/leads/:leadId/notes`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Lead detail → Add note |

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Request body

```json
{
  "note": "Customer asked for revised quote by Friday."
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `note` | Yes | Non-empty trimmed string |

### Response `data`

```json
{
  "note": {
    "_id": "665f00000000000000000001",
    "note": "Customer asked for revised quote by Friday.",
    "addedAt": "2026-06-03T10:00:00.000Z",
    "addedBy": {
      "_id": "664c1a2b3d4e5f6789012001",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin"
    }
  }
}
```

**Message:** `Note added`

### Errors

| HTTP | Message |
|------|---------|
| 400 | Note text required |
| 404 | Lead not found |

---

## 5–6. Get signed agreement

Returns the latest **`lead.documents[]`** entry with `type: "contract"`. Same response shape on both admin URLs.

| Context | Admin endpoint |
|---------|----------------|
| Lead section | `GET /api/admin/leads/:leadId/agreement` |
| Customer → project | `GET /api/admin/customers/:customerId/projects/:leadId/agreement` |

**Sales (reference):**  
`GET /api/sales/leads/:leadId/agreement` · `GET /api/sales/customers/:customerId/projects/:leadId/agreement`  
(Sales: lead must be **assigned** to current user; project route also requires `isRaisedToPO: true`.)

### Path parameters

| Param | Lead URL | Project URL |
|-------|----------|-------------|
| `leadId` | Yes | Yes |
| `customerId` | — | Yes |

### Query parameters

None.

### Request body

None (GET).

### Response `data` — agreement present

```json
{
  "leadId": "665a00000000000000000001",
  "customerId": "664c00000000000000000001",
  "projectName": "Warehouse A",
  "jobId": "PRO-042",
  "projectId": "PRO-042",
  "agreement": {
    "_id": "665f00000000000000000001",
    "url": "https://cdn.example.com/contracts/signed.pdf",
    "fileName": "signed-contract.pdf",
    "name": "signed-contract.pdf",
    "type": "contract",
    "uploadedAt": "2026-05-22T12:00:00.000Z",
    "uploadedBy": {
      "_id": "665e00000000000000000001",
      "name": "Admin User",
      "email": "admin@example.com",
      "role": "admin"
    }
  },
  "agreementUploadedAt": "2026-05-22T12:00:00.000Z"
}
```

### Response `data` — no contract uploaded

```json
{
  "leadId": "665a00000000000000000001",
  "customerId": "664c00000000000000000001",
  "projectName": "Warehouse A",
  "jobId": "PRO-042",
  "projectId": "PRO-042",
  "agreement": null,
  "agreementUploadedAt": null
}
```

| Field | Notes |
|-------|--------|
| `agreement` | Newest contract document by `uploadedAt`; `null` if none |
| `agreementUploadedAt` | Same as `agreement.uploadedAt`, or `null` |
| `projectId` | Alias of `jobId` |

### Errors

| HTTP | Lead URL | Project URL |
|------|----------|-------------|
| 404 | Lead not found | Customer not found / project not found (wrong customer or not PO-raised) |

---

## 7. `POST /api/upload/leads/:leadId/agreement`

| | |
|---|---|
| **Role** | `admin` or `sales` |
| **UI** | Upload signed contract after S3 presigned upload |

Appends a `type: "contract"` document to `lead.documents[]`. Use **GET** agreement endpoints above to read it back.

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `leadId` | MongoId | Yes |

### Request body

```json
{
  "url": "https://bucket.s3.region.amazonaws.com/contracts/signed.pdf",
  "name": "signed-contract.pdf"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `url` | Yes | Public HTTPS URL of uploaded file |
| `name` | Yes | File display name |

### Response `data`

```json
{
  "agreement": {
    "_id": "665f00000000000000000001",
    "url": "https://bucket.s3.region.amazonaws.com/contracts/signed.pdf",
    "name": "signed-contract.pdf",
    "type": "contract",
    "uploadedBy": "664c1a2b3d4e5f6789012001",
    "uploadedAt": "2026-06-03T10:00:00.000Z"
  },
  "agreementUploadedAt": "2026-06-03T10:00:00.000Z"
}
```

**Typical flow:**  
1. `POST /api/upload/presigned-url` — get S3 upload URL  
2. Upload file to S3 from browser  
3. `POST /api/upload/leads/:leadId/agreement` — save URL on lead  
4. `GET /api/admin/leads/:leadId/agreement` — display/download

### Errors

| HTTP | Message |
|------|---------|
| 400 | `url` and `name` required |
| 404 | Lead not found |
| 403 | Sales — lead not assigned |

---

## Related lead endpoints (not detailed above)

| Method | Endpoint | Notes |
|--------|----------|--------|
| PUT | `/api/admin/leads/:leadId/temperature` | Manual hot / warm / cold override |
| PUT | `/api/admin/leads/:leadId` | Full lead edit (includes optional `lifecycleStatus`) |
| GET | `/api/admin/leads/:leadId/documents?type=contract` | List all contract documents |

---

# Customers — stats & drill-down lists

Admin → **Customers** panel: six KPI cards backed by **`GET .../stats`**. Clicking a card loads the matching list endpoint with the same scope rules (see **Customer panel — project scope** above).

### Stats card → list endpoint

| KPI card | List endpoint |
|----------|----------------|
| Total Customers | `GET /api/admin/customers?scope=total` |
| Active Customers | `GET /api/admin/customers?scope=active` |
| Total Projects | `GET /api/admin/customers/projects?scope=total` |
| Active Projects | `GET /api/admin/customers/projects?scope=active` |
| Completed Projects | `GET /api/admin/customers/projects?scope=completed` |
| Not Assigned Projects | `GET /api/admin/customers/projects?scope=not-assigned` |

---

## 10. `GET /api/admin/customers/stats`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Customers → KPI cards (counts only) |

### Path parameters

None.

### Query parameters

None.

### Request body

None.

### Response `data`

```json
{
  "totalCustomers": 120,
  "activeCustomers": 98,
  "totalProjects": 185,
  "activeProjects": 142,
  "projectsNotAssigned": 8,
  "completedProjects": 24
}
```

| Field | Notes |
|-------|--------|
| `totalCustomers` | Customers with ≥1 PO-raised project |
| `activeCustomers` | Same + `Customer.isActive: true` |
| `totalProjects` | All PO-raised leads |
| `activeProjects` | PO raised, not terminated, not `delivered` |
| `projectsNotAssigned` | PO raised, no `assignedSales`, not terminated |
| `completedProjects` | PO raised + `lifecycleStatus: delivered` |

### Breaking change (FE)

| Removed | Use instead |
|---------|-------------|
| `projectsInExecution` | `activeProjects` |

---

## 11. `GET /api/admin/customers`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Customers → Total / Active customer tables |

Returns customers who have at least one PO-raised project. Use **`scope`** to match the stats cards.

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `scope` | string | No | `total` (default) or `active` — `active` = `Customer.isActive: true` |
| `isActive` | string | No | `true` / `false` — extra filter when `scope` is not `active` |
| `search` | string | No | Customer first name, email, or customer code |
| `startDate` | ISO date | No | Filters `Customer.createdAt` |
| `endDate` | ISO date | No | Filters `Customer.createdAt` (inclusive end of day) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `100` |

### Request body

None.

### Example requests

```http
GET /api/admin/customers?scope=total&page=1&limit=20
GET /api/admin/customers?scope=active&page=1&limit=20
GET /api/admin/customers?search=jane&page=1&limit=20
```

### Response `data`

```json
{
  "customers": [
    {
      "_id": "664c00000000000000000001",
      "customerId": "CUS-00042",
      "customerName": "Jane",
      "email": "jane@example.com",
      "phone": {
        "number": "9876543210",
        "countryCode": "+1"
      },
      "totalProjects": 3,
      "status": "active"
    }
  ],
  "total": 120,
  "page": 1,
  "limit": 20
}
```

| Field | Notes |
|-------|--------|
| `customerName` | `Customer.firstName` only |
| `phone` | Nested `{ number, countryCode }` |
| `totalProjects` | Count of PO-raised projects for this customer |
| `status` | `"active"` or `"inactive"` from `Customer.isActive` |

Sorted by **`Customer.createdAt` descending**.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `scope` — use `total` or `active` |
| 400 | Invalid `isActive` — use `true` or `false` |
| 401 | Unauthorized |

---

## 12. `GET /api/admin/customers/projects`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Customers → Total / Active / Completed / Not assigned project tables |

Paginated PO-raised projects. Use **`scope`** to match the stats cards.

### Path parameters

None.

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `scope` | string | No | `total` (default), `active`, `completed`, or `not-assigned` |
| `search` | string | No | Project name, job id, customer name / email / customer code |
| `startDate` | ISO date | No | Filters `Lead.createdAt` |
| `endDate` | ISO date | No | Filters `Lead.createdAt` (inclusive end of day) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `100` |

### Request body

None.

### Example requests

```http
GET /api/admin/customers/projects?scope=total&page=1&limit=20
GET /api/admin/customers/projects?scope=active&page=1&limit=20
GET /api/admin/customers/projects?scope=completed&page=1&limit=20
GET /api/admin/customers/projects?scope=not-assigned&page=1&limit=20
GET /api/admin/customers/projects?scope=not-assigned&search=PRO-042
```

### Response `data` — `scope=total`, `active`, or `completed`

```json
{
  "projects": [
    {
      "leadId": "665a1b2c3d4e5f6789012345",
      "projectName": "Warehouse A",
      "jobId": "PRO-042",
      "customerId": "664c00000000000000000001",
      "customerName": "Jane",
      "quoteValue": 175000,
      "lifecycleStatus": "production_planning"
    }
  ],
  "total": 185,
  "page": 1,
  "limit": 20,
  "scope": "total"
}
```

### Response `data` — `scope=not-assigned` (includes `poRaisedAt`)

```json
{
  "projects": [
    {
      "leadId": "665a1b2c3d4e5f6789012345",
      "projectName": "Warehouse A",
      "jobId": "PRO-042",
      "customerId": "664c00000000000000000001",
      "customerName": "Jane",
      "quoteValue": 175000,
      "lifecycleStatus": "converted_to_po",
      "poRaisedAt": "2026-05-15T10:30:00.000Z"
    }
  ],
  "total": 8,
  "page": 1,
  "limit": 20,
  "scope": "not-assigned"
}
```

| Field | Notes |
|-------|--------|
| `leadId` | Lead / project Mongo `_id` |
| `jobId` | Project id (e.g. `PRO-042`) |
| `customerName` | `Customer.firstName` only |
| `quoteValue` | Lead quote value |
| `lifecycleStatus` | Current pipeline stage |
| `poRaisedAt` | **Only when `scope=not-assigned`** — `POOrder.createdAt` when PO was raised; `null` if no order record |

Sorted by **`Lead.createdAt` descending**.

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid `scope` — use total, active, completed, or not-assigned |
| 401 | Unauthorized |

### Related customer endpoints (reference)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/customers/:customerId` | Customer detail + financials |
| GET | `/api/admin/customers/:customerId/projects` | Projects for one customer |
| GET | `/api/admin/customers/:customerId/projects/:leadId` | Single project detail |
| GET | `/api/admin/customers/:customerId/projects/:leadId/agreement` | Signed agreement (§5–6) |
| POST | `/api/admin/customers` | Create customer + first lead |
| PUT | `/api/admin/customers/:customerId` | Update customer profile |
| PATCH | `/api/admin/customers/:customerId/deactivate` | Toggle customer active status |

---

# Employees

---

## 8. `GET /api/admin/employees/:userId`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Admin → Employees → employee detail |

Returns employee profile, **active** and **closed** assigned lead lists, and KPI **`stats`**.

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `userId` | MongoId | Yes — employee `User._id` |

### Query parameters

None.

### Request body

None.

### Response `data`

```json
{
  "employee": {
    "_id": "664c1a2b3d4e5f6789012001",
    "name": "Priya Sales",
    "email": "priya@example.com",
    "phone": "+1 555-0100",
    "role": "sales",
    "isActive": true,
    "createdAt": "2026-01-15T08:00:00.000Z",
    "updatedAt": "2026-05-20T10:00:00.000Z"
  },
  "activeLeads": [
    {
      "leadId": "665a1b2c3d4e5f6789012345",
      "clientName": "Jane",
      "jobId": "PRO-042",
      "projectId": "PRO-042",
      "projectName": "Warehouse A",
      "location": "Austin, TX",
      "lifecycleStatus": "negotiation",
      "quoteValue": 175000,
      "isTerminated": false,
      "createdAt": "2026-04-15T08:00:00.000Z",
      "lead": {
        "_id": "665a1b2c3d4e5f6789012345",
        "jobId": "PRO-042",
        "projectId": "PRO-042",
        "projectName": "Warehouse A",
        "lifecycleStatus": "negotiation",
        "quoteValue": 175000,
        "customerId": {
          "_id": "...",
          "firstName": "Jane",
          "lastName": "",
          "email": "jane@example.com",
          "customerId": "CUS-00042"
        },
        "assignedSales": "664c1a2b3d4e5f6789012001"
      }
    }
  ],
  "closedLeads": [
    {
      "leadId": "665a1b2c3d4e5f6789012999",
      "clientName": "Bob",
      "jobId": "PRO-010",
      "projectId": "PRO-010",
      "projectName": "Storage Unit B",
      "location": "Dallas, TX",
      "lifecycleStatus": "deal_closed",
      "quoteValue": 120000,
      "isTerminated": false,
      "createdAt": "2026-03-01T08:00:00.000Z",
      "lead": { }
    }
  ],
  "stats": {
    "totalLeads": 42,
    "activeLeadsCount": 28,
    "closedLeadsCount": 11,
    "conversionRate": 26,
    "followUpsTotal": 50,
    "followUpsCompleted": 35,
    "followUpsCompletedPercentage": 70,
    "quotationsCreated": 18,
    "escalationsRaised": 3,
    "revenueGenerated": 450000
  }
}
```

### Response fields

| Field | Notes |
|-------|--------|
| `activeLeads` | `assignedSales` = employee; not closed stage; not terminated |
| `closedLeads` | `assignedSales` = employee; `lifecycleStatus` in closed stages (see above) |
| `stats.totalLeads` | All assigned leads (active + closed + terminated non-closed) |
| `stats.activeLeadsCount` | Length of `activeLeads` |
| `stats.closedLeadsCount` | Length of `closedLeads` |
| `stats.conversionRate` | `closedLeadsCount / totalLeads` × 100 (rounded) |
| `stats.followUpsTotal` | Follow-ups where `assignedTo` = employee |
| `stats.followUpsCompleted` | Same, `status: completed` |
| `stats.followUpsCompletedPercentage` | `followUpsCompleted / followUpsTotal` × 100 (0 if no follow-ups) |
| `stats.quotationsCreated` | `Quotation` count where `createdBy` = employee |
| `stats.escalationsRaised` | `Escalation` count where `raisedBy` = employee |
| `stats.revenueGenerated` | Sum of **paid** invoices on leads assigned to this employee |

### Breaking change (FE)

| Removed | Use instead |
|---------|-------------|
| Top-level `leads` | `activeLeads` and `closedLeads` |
| `stats.followUpsCompleted` only (no %) | `followUpsCompletedPercentage` (+ `followUpsTotal`) |

Terminated leads that are not in a closed stage are **excluded** from both lists (still counted in `totalLeads`).

### Errors

| HTTP | Message |
|------|---------|
| 404 | Employee not found |

---

## 9. `GET /api/admin/employees/:userId/assigned-leads`

| | |
|---|---|
| **Role** | `admin` |
| **UI** | Employee detail → paginated assigned leads table |

Use when the UI needs **pagination** or date filtering. For full active/closed split + KPIs in one call, use **§8**.

### Path parameters

| Param | Type | Required |
|-------|------|----------|
| `userId` | MongoId | Yes |

### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|--------|
| `startDate` | ISO date | No | Filters `Lead.createdAt` |
| `endDate` | ISO date | No | Filters `Lead.createdAt` (inclusive end of day) |
| `page` | number | No | Default `1` |
| `limit` | number | No | Default `20`, max `200` |

### Request body

None.

### Response `data`

```json
{
  "employee": {
    "_id": "664c1a2b3d4e5f6789012001",
    "name": "Priya Sales",
    "email": "priya@example.com",
    "role": "sales",
    "isActive": true
  },
  "leads": [
    {
      "clientName": "Jane",
      "jobId": "PRO-042",
      "projectId": "PRO-042",
      "location": "Austin, TX",
      "status": "negotiation",
      "quoteValue": 175000,
      "lead": {
        "_id": "665a1b2c3d4e5f6789012345",
        "projectName": "Warehouse A",
        "lifecycleStatus": "negotiation",
        "customerId": { "firstName": "Jane", "email": "jane@example.com" }
      }
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

| Field | Notes |
|-------|--------|
| `status` | Lead `lifecycleStatus` (pipeline stage) |
| `lead` | Full enriched lead document |

Sorted by **`createdAt` descending**.

### Example

```http
GET /api/admin/employees/664c1a2b3d4e5f6789012001/assigned-leads?startDate=2026-05-01&endDate=2026-05-26&page=1&limit=20
```

### Errors

| HTTP | Message |
|------|---------|
| 400 | Invalid date query |
| 404 | Employee not found |

---

## Other employee endpoints (reference)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/admin/employees/stats` | Dashboard employee KPIs |
| GET | `/api/admin/employees/performance` | Sales conversion comparison |
| GET | `/api/admin/employees/audit-log` | Roster + last activity |
| GET | `/api/admin/employees` | Paginated employee list |
| POST | `/api/admin/employees` | Create + email credentials |
| PUT | `/api/admin/employees/:userId` | Update name / phone / role / active |
| GET | `/api/admin/employees/:userId/timeline` | Audit timeline |
| PATCH | `/api/admin/employees/:userId/toggle-status` | Flip `isActive` |
| POST | `/api/admin/employees/:userId/reset-password` | Email new temp password |

**Assign lead to sales rep:** `PUT /api/admin/leads/:leadId/assign` — `{ "employeeId": "<userId>" }`

---

**Last updated:** 2026-06-04
