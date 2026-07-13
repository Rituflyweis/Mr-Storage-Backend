# Sales Panel API Changes — Step 2 (Leads + Follow-ups)

**Status:** Planned (not implemented)  
**Frontend guide:** [sales-panel-frontend-api-migration.md](./sales-panel-frontend-api-migration.md)  
**Scope:** Sales leads module + sales follow-ups module  
**Depends on:** [Step 1 — Dashboard + Customers](./sales-panel-api-changes-step1-dashboard-customers.md) (`Customer.address`, `photo`, dashboard `followUpPending` fix)

This document is the implementation spec for frontend and backend. Each section shows **current** vs **planned** request/response under the standard wrapper:

```json
{ "success": true, "message": "Success", "data": { ... } }
```

**Customer naming:** Display name = `firstName` only (`customerName` in scripts = `firstName`).  
**Project ID:** Always `jobId` on the lead (e.g. `PRO-003`), exposed as `projectId` in list/detail/script responses.

---

## Summary of affected endpoints

| # | Method | Endpoint | Change type |
|---|--------|----------|-------------|
| 1 | GET | `/api/sales/leads/stats` | Rename metrics; fix `followUpPending` date field |
| 2 | GET | `/api/sales/leads` | Extend list fields + quote value filters |
| 3 | POST | `/api/sales/leads/:leadId/escalate` | **No change** (exists) |
| 4 | GET | `/api/sales/leads/:leadId/detail` | Enhance response (assigned sales, agreement, overdue, customer fields) |
| 5 | GET | `/api/sales/leads/:leadId/activity` | **NEW** — paginated activity log |
| 6 | POST | `/api/sales/leads/:leadId/activity` | **No change** (exists) |
| 7 | GET | `/api/sales/leads/:leadId/followups` | **NEW** — lead follow-ups (upcoming / all) |
| 8 | POST | `/api/sales/followups` | Add ownership guard on `leadId` |
| 9 | PUT | `/api/sales/followups/:followUpId/complete` | **No change** (exists) |
| 10 | POST | `/api/upload/leads/:leadId/agreement` | **No change** (exists); detail must return `agreement` |
| 11 | POST | `/api/sales/leads/:leadId/po-order` | Set `Lead.poNumber` on raise |
| 12 | PUT | `/api/sales/leads/:leadId/lifecycle` | **No change** (exists) |
| 13 | GET | `/api/sales/followups/stats` | Optional: date filter on `followUpDate` when range set |
| 14 | GET | `/api/sales/followups/upcoming` | **No change** (exists); note overdue exclusion |
| 15 | GET | `/api/sales/followups/communication-timeline` | **No change** (exists) |
| 16 | GET | `/api/sales/leads/scored` | **No change** (exists) |
| 17 | GET | `/api/sales/followups/ai-script/generate` | **NEW** — AI scripts for rep’s follow-ups |
| 18 | GET | `/api/sales/followups/ai-script` | **No change** — chat session history |
| 19 | POST | `/api/sales/followups/ai-script` | **No change** — chat one-shot |
| 20 | GET | `/api/sales/leads/with-quotations` | **NEW** — lead list: projects with a quotation |
| 21 | GET | `/api/sales/leads/escalated` | **CHANGE** — lead list: projects this rep escalated |
| 22 | GET | `/api/sales/leads/with-po` | **NEW** — lead list: projects this rep raised PO for |
| 23 | GET | `/api/sales/profile` | **NEW** — sales person profile |
| 24 | PUT | `/api/sales/profile` | **NEW** — update sales person profile |
| 25 | GET | `/api/sales/invoices/stats` | **NEW** — invoice KPI amounts (sales portfolio) |
| 26 | GET | `/api/sales/invoices` | **NEW** — invoice list with filters + full document |

### Three list pages (lead-centric — same pattern)

All three sales UI sections are **project/lead lists**, not quotation rows or PO order rows.

| UI page | Purpose | Planned endpoint |
|---------|---------|------------------|
| **Quotes** | Every **project** (lead) where at least one **quotation has been created** | `GET /api/sales/leads/with-quotations` |
| **Escalations** | Every **lead** this salesperson **raised an escalation** on | `GET /api/sales/leads/escalated` |
| **PO** | Every **lead** this salesperson **raised a PO** on | `GET /api/sales/leads/with-po` |

**Scope (all three):** `Lead.assignedSales = req.user._id` (own portfolio). Nested `quotation` / `escalation` / `po` holds status and related ids.

**Not used for these pages:** `GET /api/sales/quotations` (quotation documents) and `GET /api/sales/po-orders` (PO order documents) — see §20–22 legacy note.

### Schema changes (planned)

| Model | Field | Purpose |
|-------|-------|---------|
| `Lead` | `poNumber` | `String`, default `null`. Set when PO is raised; FE uses `null` to show “can raise PO” |

---

## Part A — Leads

---

## 1. Lead stats

### `GET /api/sales/leads/stats`

**Auth:** JWT, role `sales`

#### Query parameters

| Param | Before | After |
|-------|--------|-------|
| `startDate`, `endDate` | Leads/escalations on `createdAt`; follow-ups on `createdAt` (**bug**) | Leads/escalations on `createdAt`; follow-ups on **`followUpDate`** |

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
    "leadsInPipeline": 18,
    "leadsClosed": 5,
    "followUpPending": 7,
    "escalations": 1
  }
}
```

| Field | Meaning |
|-------|---------|
| `leadsInPipeline` | Assigned leads where `lifecycleStatus` ∉ `CLOSED_STAGES` and `isTerminated !== true`, optional date on `Lead.createdAt` |
| `leadsClosed` | `lifecycleStatus` ∈ `CLOSED_STAGES` |
| `followUpPending` | `FollowUp` with `status: 'pending'`, date range on **`followUpDate`** |
| `escalations` | `Escalation` with `status: 'pending'`, `raisedBy` = current user |

#### Frontend mapping

| UI label | API field |
|----------|-----------|
| Leads in pipeline | `leadsInPipeline` |
| Leads closed | `leadsClosed` |
| Follow-up pending | `followUpPending` |
| Escalations | `escalations` |

**Note:** Apply the same `followUpPending` date fix to `GET /api/sales/dashboard/stats` in Step 1.

---

## 2. Lead list

### `GET /api/sales/leads`

**Auth:** JWT, role `sales`

#### Query parameters

| Param | Before | After |
|-------|--------|-------|
| `startDate`, `endDate` | ✅ `Lead.createdAt` | unchanged |
| `buildingType` | ✅ regex | unchanged |
| `lifecycleStatus` | ✅ | unchanged |
| `search` | ✅ | unchanged |
| `page`, `limit` | ✅ | unchanged |
| `minQuoteValue` | ❌ | Optional number — `quoteValue >= minQuoteValue` |
| `maxQuoteValue` | ❌ | Optional number — `quoteValue <= maxQuoteValue` |
| `isQuoteReady` | ✅ filter only | Keep as filter; also return on each row |

#### Response — before

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectName": "Warehouse Expansion",
        "customerId": {
          "_id": "665a1b2c3d4e5f6789012345",
          "firstName": "Jane",
          "email": "jane@example.com"
        },
        "lifecycleStatus": "proposal_sent",
        "quoteValue": 120000,
        "leadScoring": { "score": 72 },
        "buildingType": "PEB",
        "location": "Austin, TX",
        "nextFollowUp": {
          "_id": "665c3d4e5f67890123457",
          "followUpDate": "2026-05-25T10:00:00.000Z",
          "notes": "Call back",
          "priority": "medium"
        }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectId": "PRO-003",
        "projectName": "Warehouse Expansion",
        "location": "Austin, TX",
        "lifecycleStatus": "proposal_sent",
        "quoteValue": 120000,
        "nextFollowUpDate": "2026-05-25T10:00:00.000Z",
        "quotationCreated": true,
        "isQuoteReady": true,
        "isRaisedToPO": false,
        "poNumber": null
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Source / rule |
|-------|----------------|
| `projectId` | `lead.jobId` |
| `nextFollowUpDate` | Earliest pending `FollowUp.followUpDate` for lead, or `null` |
| `quotationCreated` | `true` if any `Quotation` exists for `leadId` |
| `isQuoteReady` | `lead.isQuoteReady` |
| `isRaisedToPO` | `lead.isRaisedToPO` |
| `poNumber` | `lead.poNumber` (null until PO raised) |

`customerId` / `leadScoring` / nested `nextFollowUp` object removed from list shape to match FE table; add back only if product needs them.

---

## 3. Raise escalation

### `POST /api/sales/leads/:leadId/escalate`

**Status:** No change required.

#### Request

```json
{ "note": "Customer needs manager approval on pricing." }
```

#### Response — current & planned

```json
{
  "success": true,
  "message": "Lead escalated successfully",
  "data": {
    "escalation": {
      "_id": "...",
      "leadId": "...",
      "customerId": "...",
      "raisedBy": "...",
      "note": "Customer needs manager approval on pricing.",
      "status": "pending",
      "createdAt": "2026-05-22T12:00:00.000Z"
    }
  }
}
```

---

## 4. Lead / project detail

### `GET /api/sales/leads/:leadId/detail`

**Auth:** JWT, role `sales` — lead must be assigned to current user.

#### Response — before (abbreviated)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": {
      "_id": "...",
      "jobId": "PRO-003",
      "projectName": "Warehouse Expansion",
      "buildingType": "PEB",
      "quoteValue": 120000,
      "lifecycleStatus": "proposal_sent",
      "lifecycleHistory": [],
      "location": "Austin, TX",
      "assignedSales": "664c1a2b3d4e5f6789012001",
      "isQuoteReady": true,
      "isRaisedToPO": false,
      "notes": "",
      "documents": []
    },
    "customer": {
      "_id": "...",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "email": "jane@example.com",
      "phone": { "number": "9876543210", "countryCode": "+91" },
      "company": "",
      "location": ""
    },
    "quotations": [{ "_id": "...", "isLatest": true }],
    "auditLog": [],
    "activityLog": [],
    "followUps": [],
    "payments": {
      "invoices": [],
      "totalPaid": 0,
      "totalPending": 0,
      "totalInvoices": 0
    },
    "buildings": [],
    "budget": null,
    "recentMessages": [],
    "rfq": { "aiQuoteData": null, "aiContextSummary": "" },
    "shipments": []
  }
}
```

#### Response — after (additions / changes highlighted)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": {
      "_id": "...",
      "projectId": "PRO-003",
      "jobId": "PRO-003",
      "projectName": "Warehouse Expansion",
      "buildingType": "PEB",
      "quoteValue": 120000,
      "lifecycleStatus": "proposal_sent",
      "lifecycleHistory": [
        { "stage": "initial_contact", "changedAt": "...", "changedBy": "..." }
      ],
      "location": "Austin, TX",
      "createdAt": "2026-04-15T08:00:00.000Z",
      "isQuoteReady": true,
      "isRaisedToPO": false,
      "poNumber": null,
      "notes": ""
    },
    "customer": {
      "_id": "...",
      "customerId": "CUS-00042",
      "firstName": "Jane",
      "email": "jane@example.com",
      "phone": { "number": "9876543210", "countryCode": "+91" },
      "photo": null,
      "address": "123 Main St, Austin, TX"
    },
    "assignedSales": {
      "_id": "664c1a2b3d4e5f6789012001",
      "name": "John Sales",
      "email": "john@company.com"
    },
    "agreement": "https://cdn.example.com/contracts/signed.pdf",
    "quotations": [{ "_id": "...", "isLatest": true }],
    "auditLog": [],
    "activityLog": [],
    "followUps": [],
    "payments": {
      "invoices": [],
      "totalPaid": 0,
      "totalPending": 0,
      "totalOverdue": 0,
      "totalInvoices": 0
    },
    "buildings": [],
    "budget": null,
    "recentMessages": [],
    "rfq": { "aiQuoteData": null, "aiContextSummary": "" },
    "shipments": []
  }
}
```

| Change | Detail |
|--------|--------|
| `lead.projectId` | Alias for `jobId` on response |
| `lead.poNumber` | From schema; `null` if PO not raised |
| `customer.photo`, `customer.address` | From Step 1 `Customer` fields |
| `assignedSales` | Populated user object (top-level; not only ObjectId on `lead`) |
| `agreement` | URL from `lead.documents` where `type === 'contract'`, else `null` |
| `payments.totalOverdue` | Sum of `totalAmount` for invoices where computed due date `< now` and `status` ∈ `sent`, `overdue` |

**Overdue due date rule:** `dueDate = invoice.date + (invoice.daysToPay × 24h)`. Same logic as customer portal / account dashboard.

**Priority:** Do not add a top-level `priority` field on detail; FE ignores `quotation.priorityLevel` unless needed later.

**Bundled sections unchanged:** `quotations`, `auditLog`, `buildings`, `budget`, `recentMessages`, `rfq`, `shipments`.

For large activity/follow-up lists, FE should use the new paginated endpoints below instead of relying only on the full arrays in detail.

---

## 5. Activity log — list (NEW)

### `GET /api/sales/leads/:leadId/activity`

**Auth:** JWT, role `sales` — same ownership guard as detail.

#### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `page` | No | Default `1` |
| `limit` | No | Default `20` |
| `startDate` | No | Filter `AuditLog.createdAt` |
| `endDate` | No | Filter `AuditLog.createdAt` |

#### Response — planned

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "entries": [
      {
        "_id": "...",
        "type": "activity",
        "action": "activity.logged",
        "metadata": {
          "activityType": "call",
          "notes": "Discussed timeline",
          "outcome": "positive"
        },
        "performedBy": {
          "_id": "...",
          "name": "John Sales"
        },
        "createdAt": "2026-05-20T15:30:00.000Z"
      }
    ],
    "total": 15,
    "page": 1,
    "limit": 20
  }
}
```

---

## 6. Activity log — add (exists)

### `POST /api/sales/leads/:leadId/activity`

**Status:** No change.

#### Request

```json
{
  "activityType": "call",
  "notes": "Discussed timeline",
  "outcome": "positive"
}
```

`activityType`: `call` \| `email` \| `meeting` \| `note`  
`outcome` (optional): `positive` \| `neutral` \| `negative` \| `no_response`

#### Response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "message": "Activity logged"
  }
}
```

---

## 7. Lead follow-ups — list (NEW)

### `GET /api/sales/leads/:leadId/followups`

**Auth:** JWT, role `sales`

#### Query parameters

| Param | Default | Description |
|-------|---------|-------------|
| `status` | all | `pending` \| `completed` \| omit for all |
| `upcomingOnly` | `false` | If `true`, only pending with `followUpDate >= now` |
| `page`, `limit` | 1, 20 | Pagination |

#### Response — planned

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "followUps": [
      {
        "_id": "...",
        "followUpDate": "2026-05-25T14:00:00.000Z",
        "modeOfContact": "call",
        "notes": "Second call",
        "priority": "medium",
        "status": "pending",
        "completedAt": null
      }
    ],
    "total": 3,
    "page": 1,
    "limit": 20
  }
}
```

Sorted by `followUpDate` ascending for upcoming context.

---

## 8. Follow-up — create (exists, guard added)

### `POST /api/sales/followups`

#### Request — before & after (same shape)

```json
{
  "leadId": "665b2c3d4e5f67890123456",
  "followUpDate": "2026-05-25T14:00:00.000Z",
  "modeOfContact": "call",
  "notes": "Second call",
  "priority": "medium"
}
```

| Field | Notes |
|-------|--------|
| `followUpDate` | ISO 8601 — **includes time** |
| `modeOfContact` | `call` \| `email` \| `meeting` |

#### Behaviour change

- **Before:** Only checks lead exists.
- **After:** `403` if `lead.assignedSales !== req.user._id`.

#### Response — unchanged

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "followUp": { "_id": "...", "leadId": "...", "status": "pending", ... }
  }
}
```

---

## 9. Follow-up — complete (exists)

### `PUT /api/sales/followups/:followUpId/complete`

**Status:** No change. Only assignee can complete.

#### Response

```json
{
  "success": true,
  "message": "Follow-up marked as completed",
  "data": {
    "followUp": {
      "_id": "...",
      "status": "completed",
      "completedAt": "2026-05-22T16:00:00.000Z"
    }
  }
}
```

---

## 10. Agreement upload (exists)

### `POST /api/upload/leads/:leadId/agreement`

Also available at `POST /api/uploads/leads/:leadId/agreement`.

**Auth:** JWT, `admin` \| `sales` (sales must own lead).

#### Request

```json
{
  "url": "https://bucket.s3.amazonaws.com/...",
  "name": "signed-contract.pdf"
}
```

Use `POST /api/upload/presigned-url` first to upload file to S3.

#### Response — current & planned

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "agreement": {
      "url": "https://bucket.s3.amazonaws.com/...",
      "name": "signed-contract.pdf",
      "type": "contract",
      "uploadedAt": "2026-05-22T12:00:00.000Z"
    },
    "agreementUploadedAt": "2026-05-22T12:00:00.000Z"
  }
}
```

After upload, `GET .../leads/:leadId/detail` returns the same URL on top-level `agreement`.

---

## 11. Convert to PO (exists, schema update)

### `POST /api/sales/leads/:leadId/po-order`

**Status:** Exists; persist `poNumber` on lead when raised.

#### Request

No body required.

#### Behaviour — after

1. Validates invoice + quotation exist (unchanged).
2. Creates `POOrder` with `poNumber` from latest invoice.
3. Sets `lead.isRaisedToPO = true`, `lead.poNumber = latestInvoice.poNumber`, lifecycle `converted_to_po`.

#### Response — before

```json
{
  "success": true,
  "message": "PO Order raised successfully",
  "data": {
    "order": {
      "_id": "...",
      "poNumber": "PO-2026-001",
      "status": "pending",
      "leadId": "...",
      "invoiceId": "...",
      "quotationId": "..."
    }
  }
}
```

#### Response — after

Same; `order` unchanged. Lead in DB now has `poNumber` for list/detail.

#### Frontend — can raise PO?

Show control when:

- `poNumber == null` (or `!isRaisedToPO`)
- Business rules still require invoice + quotation (API returns 400 if missing)

---

## 12. Update lifecycle (exists)

### `PUT /api/sales/leads/:leadId/lifecycle`

**Status:** No change.

#### Request

```json
{ "lifecycleStatus": "negotiation" }
```

#### Response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": {
      "_id": "...",
      "lifecycleStatus": "negotiation",
      "lifecycleHistory": []
    }
  }
}
```

---

## Part B — Follow-ups section

---

## 13. Follow-up stats

### `GET /api/sales/followups/stats`

**Auth:** JWT, role `sales`

#### Query parameters

| Param | Before | After |
|-------|--------|-------|
| `startDate`, `endDate` | Filter on `FollowUp.createdAt` | If range provided: filter on **`followUpDate`**; if omitted: all-time (unchanged behaviour) |

#### Response — before & after (same shape)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "total": 40,
    "upcoming": 12,
    "completed": 25,
    "overdue": 3
  }
}
```

| Field | Rule |
|-------|------|
| `total` | All follow-ups for user in scope |
| `upcoming` | `pending` and `followUpDate >= now` |
| `completed` | `status === 'completed'` |
| `overdue` | `pending` and `followUpDate < now` (computed, not stored) |

#### Frontend mapping

| UI label | API field |
|----------|-----------|
| Total follow-ups | `total` |
| Upcoming | `upcoming` |
| Completed | `completed` |
| Overdue | `overdue` |

---

## 14. Upcoming follow-ups

### `GET /api/sales/followups/upcoming`

**Status:** No response shape change.

**Behaviour note:** Only returns **pending** follow-ups with `followUpDate >= now` (overdue items are **not** included). Use `stats.overdue` or extend with `?includeOverdue=true` in a future iteration if the calendar must show past-due in the same list.

#### Response — current & planned

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "followups": [
      {
        "_id": "...",
        "followUpDate": "2026-05-25T10:00:00.000Z",
        "modeOfContact": "call",
        "notes": "",
        "status": "pending",
        "leadId": { "_id": "...", "projectName": "...", "jobId": "PRO-003" },
        "customerId": { "_id": "...", "firstName": "Jane" }
      }
    ]
  }
}
```

Optional enhancement: populate `leadId` with `projectId` (`jobId`) alias for consistency.

---

## 15. Communication timeline (exists)

### `GET /api/sales/followups/communication-timeline`

**Status:** No change. Sales-wide activity log with pagination.

#### Query

`?leadId=&activityType=&startDate=&endDate=&page=&limit=`

#### Response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "entries": [
      {
        "_id": "...",
        "leadId": { "projectName": "Warehouse Expansion" },
        "customerId": { "firstName": "Jane" },
        "performedBy": { "name": "John Sales" },
        "metadata": { "activityType": "call", "notes": "...", "outcome": "positive" },
        "createdAt": "2026-05-20T15:30:00.000Z"
      }
    ],
    "total": 42,
    "page": 1,
    "limit": 20
  }
}
```

---

## 16. Leads by AI score (exists)

### `GET /api/sales/leads/scored`

**Status:** No change required for this step.

#### Query

`?page=&limit=`

#### Response (abbreviated)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "...",
        "projectName": "Warehouse Expansion",
        "customerId": { "_id": "...", "firstName": "Jane" },
        "lifecycleStatus": "proposal_sent",
        "quoteValue": 120000,
        "leadScoring": {
          "score": 85,
          "projectSize": { "points": 20, "reason": "..." },
          "budgetSignals": { "points": 18, "reason": "..." },
          "timeline": { "points": 15, "reason": "..." },
          "decisionMaker": { "points": 17, "reason": "..." },
          "projectClarity": { "points": 15, "reason": "..." }
        }
      }
    ],
    "total": 10
  }
}
```

Sorted by `leadScoring.score` descending.

---

## 17. AI script generator (NEW)

### `GET /api/sales/followups/ai-script/generate`

**Auth:** JWT, role `sales`

Generates call scripts for the current salesperson’s pending follow-ups (default: **due today**, same window as admin). Uses existing `followupScript.service.js` pattern.

Does **not** replace:

- `GET /api/sales/followups/ai-script` — chat session list  
- `POST /api/sales/followups/ai-script` — interactive chat  
- Socket `ai_script:*` on `/admin` namespace — streaming chat  

#### Query parameters (planned)

| Param | Default | Description |
|-------|---------|-------------|
| `startDate` | Today start | Follow-up `followUpDate` range start |
| `endDate` | Today end | Follow-up `followUpDate` range end |

#### Response — before

**Endpoint does not exist** for sales structured scripts.

Admin reference (`GET /api/admin/followups/ai-script`):

```json
{
  "scripts": [
    {
      "followUpId": "...",
      "leadId": "...",
      "customerName": "Jane",
      "script": "Hi Jane, ..."
    }
  ]
}
```

(`leadId` is a plain ObjectId string.)

#### Response — after (sales)

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "scripts": [
      {
        "followUpId": "665c3d4e5f67890123457",
        "leadId": {
          "_id": "665b2c3d4e5f67890123456",
          "projectName": "Warehouse Expansion",
          "projectId": "PRO-003"
        },
        "customerName": "Jane",
        "script": "Hi Jane, I wanted to follow up on your warehouse project..."
      }
    ]
  }
}
```

| Field | Rule |
|-------|------|
| `followUpId` | Follow-up document `_id` |
| `leadId` | **Populated object only** — `_id`, `projectName`, `projectId` (`jobId`). No other lead fields. |
| `customerName` | `Customer.firstName` |
| `script` | AI-generated plain text |

Empty day:

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "scripts": [],
    "message": "No follow-ups scheduled for this period"
  }
}
```

**Scope:** Only follow-ups where `assignedTo = req.user._id` and `status = 'pending'`.

---

## 18–19. AI script chat (exists, unchanged)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/sales/followups/ai-script` | List past chat `sessions` |
| POST | `/api/sales/followups/ai-script` | Body `{ messages, leadId? }` → `{ reply, sessionId }` |

---

## Part C — Three section list pages (Quotes · Escalations · PO)

Each page returns **`leads[]`** (projects), one row per lead, with a nested object for that section’s status.

### Shared lead row (all three pages)

```json
{
  "_id": "665b2c3d4e5f67890123456",
  "projectId": "PRO-003",
  "projectName": "Warehouse Expansion",
  "location": "Austin, TX",
  "lifecycleStatus": "proposal_sent",
  "quoteValue": 120000,
  "customerId": {
    "_id": "...",
    "firstName": "Jane",
    "email": "jane@example.com"
  }
}
```

Plus **one** of: `quotation`, `escalation`, or `po` (see below).

**Shared query (all three):** `?page=` `?limit=` `?startDate=` `?endDate=` (on `Lead.createdAt` unless noted) `?search=` (project name, `projectId`, customer name/email).

---

### 20. Quotes section — projects with quotation created

#### `GET /api/sales/leads/with-quotations` (**NEW**)

**UI:** Quotes page — all **your projects** where a quote exists.

**Include lead when:** at least one `Quotation` for `leadId` (use **latest** quotation by `versionNumber` / `createdAt` for nested `quotation`).

**Filter:** `assignedSales = req.user._id`.

#### Before

No lead-centric endpoint. Closest today:

- `GET /api/sales/quotations` → array of **quotation** documents (`createdBy = req.user`), multiple rows per project if multiple versions.

#### After — response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectId": "PRO-003",
        "projectName": "Warehouse Expansion",
        "location": "Austin, TX",
        "lifecycleStatus": "proposal_sent",
        "quoteValue": 120000,
        "customerId": { "_id": "...", "firstName": "Jane", "email": "jane@example.com" },
        "quotation": {
          "_id": "...",
          "quoteNumber": "QT-001",
          "versionNumber": 2,
          "status": "sent",
          "finalPrice": 118500,
          "createdAt": "2026-05-10T08:00:00.000Z",
          "sentAt": "2026-05-11T09:00:00.000Z"
        }
      }
    ],
    "total": 8,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Meaning |
|-------|---------|
| `quotation.status` | `draft` \| `sent` \| `accepted` \| `rejected` |
| `quotation` | Latest quotation for that project |

**Optional query:** `?quotationStatus=sent` — filter by latest quotation status.

#### Legacy (do not use for this page)

`GET /api/sales/quotations` — keep only if another screen needs raw quotation rows; not the Quotes **section** list.

---

### 21. Escalations section — projects you escalated

#### `GET /api/sales/leads/escalated` (**CHANGE**)

**UI:** Escalations page — all **leads you raised an escalation** on (not every escalation in the system).

**Include lead when:** `Escalation.raisedBy = req.user._id` and `lead.assignedSales = req.user._id`.

**One row per lead:** use **latest** escalation per `leadId` (or only `status=pending` if query set).

#### Before

```json
{
  "leads": [
    {
      "_id": "leadId",
      "projectName": "Warehouse Expansion",
      "lifecycleStatus": "negotiation",
      "quoteValue": 120000,
      "customerId": { "_id": "...", "firstName": "Jane", "email": "..." },
      "escalation": {
        "_id": "...",
        "note": "Need pricing approval",
        "status": "pending",
        "createdAt": "..."
      }
    }
  ],
  "total": 5
}
```

Missing: `projectId`, `location`, `page` / `limit` in response; multiple rows if same lead escalated twice.

#### After — response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectId": "PRO-003",
        "projectName": "Warehouse Expansion",
        "location": "Austin, TX",
        "lifecycleStatus": "negotiation",
        "quoteValue": 120000,
        "customerId": { "_id": "...", "firstName": "Jane", "email": "jane@example.com" },
        "escalation": {
          "_id": "...",
          "note": "Need pricing approval",
          "status": "pending",
          "createdAt": "2026-05-18T14:00:00.000Z"
        }
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Meaning |
|-------|---------|
| `escalation.status` | `pending` \| `resolved` |

**Query:** `?status=pending|resolved` (filter escalation status), pagination, date range, `search`.

**Raise escalation (unchanged):** `POST /api/sales/leads/:leadId/escalate` with `{ "note": "..." }`.

---

### 22. PO section — projects you raised PO for

#### `GET /api/sales/leads/with-po` (**NEW**)

**UI:** PO page — all **leads you raised a PO** on.

**Include lead when:** `POOrder.raisedBy = req.user._id` and lead is in your portfolio (or `lead.isRaisedToPO === true` with matching order).

**One row per lead:** latest `POOrder` for that `leadId`.

#### Before

`GET /api/sales/po-orders` returns **`orders[]`**, not leads:

```json
{
  "orders": [
    {
      "_id": "poOrderId",
      "poNumber": "PO-2026-001",
      "status": "pending",
      "leadId": { "_id": "...", "projectName": "..." },
      "customerId": { "firstName": "Jane" }
    }
  ],
  "total": 3
}
```

#### After — response

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "leads": [
      {
        "_id": "665b2c3d4e5f67890123456",
        "projectId": "PRO-003",
        "projectName": "Warehouse Expansion",
        "location": "Austin, TX",
        "lifecycleStatus": "converted_to_po",
        "quoteValue": 120000,
        "poNumber": "PO-2026-001",
        "customerId": { "_id": "...", "firstName": "Jane", "email": "jane@example.com" },
        "po": {
          "_id": "...",
          "poNumber": "PO-2026-001",
          "status": "pending",
          "adminNotes": "",
          "createdAt": "2026-05-20T10:00:00.000Z"
        }
      }
    ],
    "total": 3,
    "page": 1,
    "limit": 20
  }
}
```

| Field | Meaning |
|-------|---------|
| `po.status` | `pending` \| `approved` \| `rejected` |
| `lead.poNumber` | Same value as Step 2 schema (nullable until raised) |

**Query:** `?poStatus=pending|approved|rejected`, pagination, date range, `search`.

**Raise PO (unchanged):** `POST /api/sales/leads/:leadId/po-order`.

#### Legacy (do not use for this page)

`GET /api/sales/po-orders` — optional keep for admin-style order table; PO **section** uses `with-po` only.

---

## Part D — Sales profile

### 23. Get profile (**NEW**)

#### `GET /api/sales/profile`

**Auth:** JWT, role `sales`.

#### Before

No sales profile route. Login returns minimal `user` in `POST /api/auth/login` only.

#### After

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "user": {
      "_id": "...",
      "name": "John Sales",
      "email": "john@company.com",
      "phone": "+91 9876543210",
      "role": "sales",
      "isActive": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

Password never returned.

---

### 24. Update profile (**NEW**)

#### `PUT /api/sales/profile`

**Body (all optional; at least one required):**

```json
{
  "name": "John Sales",
  "phone": "+91 9876543210"
}
```

Do not allow `role`, `isActive`, or `email` change via this route unless product adds email-change flow with uniqueness check.

#### After — response

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "_id": "...",
      "name": "John Sales",
      "email": "john@company.com",
      "phone": "+91 9876543210",
      "role": "sales",
      "isActive": true,
      "updatedAt": "..."
    }
  }
}
```

**Password:** continue using `PUT /api/auth/change-password`.

---

## Part E — Invoices page (sales panel)

**Scope:** Only invoices for leads where `Lead.assignedSales = req.user._id`.  
**Due date rule:** `dueDate = invoice.date + (invoice.daysToPay × 24h)` when both set; else `null`.  
**Overdue (amount + row flag):** `dueDate < now` and `status` ∉ `paid`, `cancelled` — or `status === 'overdue'`.

**Existing common routes (not a sales list):**

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/invoices` | Create (sales allowed) |
| GET | `/api/invoices/:invoiceId` | Single invoice + payment schedule |
| GET | `/api/leads/:leadId/invoices` | All invoices for one lead (no global list) |
| PUT | `/api/invoices/:invoiceId/mark-paid` | Mark paid |

There is **no** `GET /api/invoices` list today. Account panel has `GET /api/account/dashboard/invoice-stats` (counts, not sales-scoped amounts).

---

### 25. Invoice stats

#### `GET /api/sales/invoices/stats` (**NEW**)

**UI:** Invoices page stat cards.

#### Query parameters

| Param | Description |
|-------|-------------|
| `startDate`, `endDate` | Optional — filter invoices by `invoice.date` (inclusive end of day) |

#### Response — before

Endpoint does not exist for sales.

Account reference (`GET /api/account/dashboard/invoice-stats`) returns **counts**, not amount totals:

```json
{ "total": 40, "paid": 25, "unpaid": 10, "overdue": 5, "totalSales": 500000 }
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalAmount": 850000,
    "totalPaid": 520000,
    "totalUnpaid": 280000,
    "totalOverdue": 45000
  }
}
```

| Field | Calculation (assigned leads only) |
|-------|-----------------------------------|
| `totalAmount` | Sum of `totalAmount` for all invoices in scope (exclude `cancelled` optional — default **exclude cancelled**) |
| `totalPaid` | Sum where `status === 'paid'` |
| `totalUnpaid` | Sum where `status` ∈ `draft`, `sent`, `overdue` (not yet paid) |
| `totalOverdue` | Sum where not paid/cancelled and (`status === 'overdue'` **or** computed `dueDate < now`) |

---

### 26. Invoice list

#### `GET /api/sales/invoices` (**NEW**)

**UI:** Invoices table — summary columns + full document for detail drawer.

#### Query parameters

| Param | Description |
|-------|-------------|
| `startDate`, `endDate` | Filter on `invoice.date` |
| `status` | `draft` \| `sent` \| `paid` \| `overdue` \| `cancelled` |
| `leadId` | **Project filter** — Mongo lead `_id` |
| `search` | Case-insensitive match on: customer `firstName`, `customerId` string, lead `projectName`, lead `jobId` (`projectId`) |
| `page`, `limit` | Pagination (default `1`, `20`) |

#### Response — before

No sales invoice list endpoint.

Per-lead only:

```json
GET /api/leads/:leadId/invoices
{ "invoices": [ /* full documents */ ] }
```

#### Response — after

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "invoices": [
      {
        "invoiceNumber": "INV-2026-0042",
        "projectName": "Warehouse Expansion",
        "projectId": "PRO-003",
        "customerId": "CUS-00042",
        "customerName": "Jane",
        "dueDate": "2026-06-15T00:00:00.000Z",
        "amount": 125000,
        "status": "sent",
        "invoice": {
          "_id": "...",
          "invoiceNumber": "INV-2026-0042",
          "leadId": "...",
          "customerId": "...",
          "poNumber": "PO-2026-001",
          "date": "2026-05-01T00:00:00.000Z",
          "daysToPay": 45,
          "lineItems": [],
          "subtotal": 120000,
          "totalAmount": 125000,
          "status": "sent",
          "sentAt": "...",
          "paidAt": null,
          "createdAt": "...",
          "updatedAt": "..."
        }
      }
    ],
    "total": 24,
    "page": 1,
    "limit": 20
  }
}
```

| List field | Source |
|------------|--------|
| `invoiceNumber` | `invoice.invoiceNumber` |
| `projectName` | `lead.projectName` |
| `projectId` | `lead.jobId` |
| `customerId` | `customer.customerId` (display id string) |
| `customerName` | `customer.firstName` |
| `dueDate` | Computed from `date` + `daysToPay` |
| `amount` | `invoice.totalAmount` |
| `status` | `invoice.status` |
| `invoice` | **Full** invoice Mongoose document (same as DB / `GET /api/invoices/:invoiceId` without schedule, or include schedule if FE needs it) |

Sort default: `invoice.date` descending (or `createdAt` desc — pick one in implementation; document as `date` desc).

#### Optional query (implementation)

`?includePaymentSchedule=true` — attach `paymentSchedule` on each row’s `invoice` object (mirror `GET /api/invoices/:invoiceId`).

---

## Part F — Missing endpoints summary

| Endpoint | Status | Notes |
|----------|--------|-------|
| `GET /api/sales/leads/with-quotations` | **NEW** | Quotes **section** — leads with quotation |
| `GET /api/sales/leads/escalated` | **CHANGE** | Escalations **section** — leads you escalated |
| `GET /api/sales/leads/with-po` | **NEW** | PO **section** — leads you raised PO for |
| `GET /api/sales/profile` | **NEW** | Sales person profile |
| `PUT /api/sales/profile` | **NEW** | Update name / phone |
| `GET /api/sales/leads/:leadId/activity` | **NEW** | Paginated activity for lead detail tab |
| `GET /api/sales/leads/:leadId/followups` | **NEW** | Paginated / filtered follow-ups for lead detail tab |
| `GET /api/sales/followups/ai-script/generate` | **NEW** | Structured scripts; populated `leadId` |
| `GET /api/sales/invoices/stats` | **NEW** | Amount KPIs for sales portfolio |
| `GET /api/sales/invoices` | **NEW** | Filtered list + nested full `invoice` |

All other routes in this doc already exist and only need response or guard updates.

---

## Part G — Schema: `Lead.poNumber`

```js
poNumber: { type: String, default: null }
```

| When | Value |
|------|--------|
| Lead created | `null` |
| `POST .../po-order` succeeds | Copy from `latestInvoice.poNumber` |
| FE “Raise PO” visibility | `poNumber == null` && `!isRaisedToPO` (plus API validation) |

---

## Part H — Implementation checklist (backend)

- [ ] `Lead` model — add `poNumber`
- [ ] `lead.controller.js` — `getLeadsStats` pipeline metric + `followUpDate` filter
- [ ] `dashboard.controller.js` — `followUpPending` on `followUpDate` (Step 1 alignment)
- [ ] `lead.controller.js` — `getLeads` extended fields + `minQuoteValue` / `maxQuoteValue`
- [ ] `lead.controller.js` — `getLeadDetail` assignedSales, agreement, totalOverdue, customer photo/address, `projectId`
- [ ] `lead.controller.js` — **new** `getLeadActivity`, `getLeadFollowups`
- [ ] `lead.routes.js` — register new GET routes before `/:leadId/detail` if needed (use distinct paths: `/:leadId/activity`, `/:leadId/followups`)
- [ ] `lead.controller.js` — `raisePOOrder` set `lead.poNumber`
- [ ] `followup.controller.js` — `createFollowUp` ownership guard
- [ ] `followup.controller.js` — `getStats` date field when range provided
- [ ] `followup.controller.js` — **new** `generateAiScript` + route `GET /ai-script/generate`
- [ ] Reuse / extend `followupScript.service.js` — return populated `leadId` shape for sales
- [ ] Postman — new requests + updated examples
- [ ] Step 1 customer fields on lead detail `customer` select
- [ ] `lead.controller.js` — **new** `getLeadsWithQuotations`, `getLeadsWithPo`
- [ ] `lead.controller.js` — **change** `getEscalatedLeads` (one row per lead, `projectId`, pagination)
- [ ] `lead.routes.js` — register `GET /with-quotations`, `GET /with-po` before `/:leadId`
- [ ] `sales/profile` — **new** controller + routes `GET` / `PUT /api/sales/profile`
- [ ] Document FE: Quotes / Escalations / PO pages use `leads[]` endpoints only
- [ ] `sales/invoice.controller.js` + `sales/invoice.routes.js` — **new** `getInvoiceStats`, `getInvoices`
- [ ] Mount `router.use('/invoices', require('./invoice.routes'))` on sales index
- [ ] Shared helper `computeInvoiceDueDate(invoice)` (reuse portal/account pattern)
- [ ] Postman — Sales Invoices folder

---

## Part I — Step index (full sales panel audit)

| Step | Pages | Doc |
|------|-------|-----|
| 1 | Dashboard, Customers | [step1](./sales-panel-api-changes-step1-dashboard-customers.md) |
| **2 (this file)** | Leads, Follow-ups, Quotes/Escalation/PO, Profile, **Invoices** | `sales-panel-api-changes-step2-leads-followups.md` |
| 3+ | Quotation form, Payment schedules UI, etc. | TBD |

---

## Part J — Cross-reference: Step 1 deferred items (now in Step 2)

| Item | Section |
|------|---------|
| Populate `assignedSales` | §4 |
| Top-level `agreement` | §4, §10 |
| `payments.totalOverdue` | §4 |
| No top-level `priority` on detail | §4 |
| `Customer.address` / `photo` on detail | §4 |

---

*Last updated: 2026-05-22 (Invoices stats + list added for sales panel)*
