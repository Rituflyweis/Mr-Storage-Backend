# Sales ↔ Admin ↔ Plant PO & Invoice Sync — Backend Changes

**Date:** June 2026  
**Scope:** PO visibility alignment, combined approve+assign, invoice email reliability, admin invoice data parity, admin Edit Leads / `quoteValue` guidance, **Sales Meetings API** (now mounted).

---

## Summary

| # | Problem | Fix |
|---|---------|-----|
| 1 | Sales PO list used `isRaisedToPO` (shows forever); Admin PO queue shows only `pending` | New `GET /api/sales/leads/with-po` keyed on `POOrder.status`; `Lead.poNumber` on raise |
| 2 | Admin approve and plant assign were two steps; plant stayed empty after approve only | New `PUT /api/admin/po-orders/:id/approve-and-assign` |
| 3 | Invoice email could fail silently; status marked `sent` anyway | Send awaits SMTP; fails with 502 if email fails |
| 4 | Admin invoice list omitted line items / markup; looked out of sync with Sales | Admin project invoices return full invoice payload |
| 5 | Admin Edit Leads UI missing price / project fields present on Add Leads | `quoteValue` and all project fields editable via `PUT /api/admin/leads/:leadId` — FE should mirror Add form |
| 6 | Sales Meetings routes existed but were not mounted | `router.use('/meetings', ...)` added — `/api/sales/meetings` now live |
| 7 | Sales Edit Lead, payment, PO gate clarity | Doc + mark-paid draft guard removed; building sync pending confirmation |

---

## Issue 1 — PO list alignment (Sales vs Admin)

### Root cause

- **Sales** treated any lead with `isRaisedToPO: true` as a PO order — including approved, rejected, and plant-released projects.
- **Admin PO request** queue typically calls `GET /api/admin/po-orders?status=pending` — only orders awaiting approval.

These answer different questions, so the two panels appeared out of sync.

### Changes

#### 1. New endpoint — Sales PO list by order status

```
GET /api/sales/leads/with-po
```

| Item | Detail |
|------|--------|
| **Auth** | JWT, role `sales` |
| **Scope** | PO orders raised by current user (`POOrder.raisedBy`) for leads assigned to them |

**Query parameters**

| Param | Type | Notes |
|-------|------|-------|
| `poStatus` | `pending` \| `approved` \| `rejected` | Filter by latest PO order status |
| `search` | string | Filters `projectName` (case-insensitive) |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `100` |
| `startDate` | ISO date | Filters `POOrder.createdAt` |
| `endDate` | ISO date | Filters `POOrder.createdAt` |

**Response**

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
        "isRaisedToPO": true,
        "poNumber": "PO-2026-001",
        "poStatus": "pending",
        "customerId": {
          "_id": "...",
          "firstName": "Jane",
          "lastName": "Doe",
          "email": "jane@example.com"
        },
        "po": {
          "_id": "...",
          "poNumber": "PO-2026-001",
          "status": "pending",
          "adminNotes": "",
          "assignedTo": null,
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

**Implementation:** `src/controllers/sales/lead.controller.js` → `getLeadsWithPo`  
**Route:** `src/routes/sales/lead.routes.js` (registered **before** `/:leadId` routes)

#### 2. `Lead.poNumber` schema field

**Model:** `src/models/Lead.js`

```js
poNumber: { type: String, default: null }
```

Set when sales raises a PO (copied from the latest invoice's `poNumber`).

#### 3. `raisePOOrder` updates

**Endpoint:** `POST /api/sales/leads/:leadId/po-order` (unchanged URL)

**Additional fields set on lead:**

| Field | Value |
|-------|-------|
| `isRaisedToPO` | `true` |
| `poNumber` | `latestInvoice.poNumber` |
| `poStatus` | `'pending'` |
| `lifecycleStatus` | `'converted_to_po'` |

**File:** `src/controllers/sales/lead.controller.js`

#### 4. Lifecycle guard — no manual PO conversion

**Endpoint:** `PUT /api/sales/leads/:leadId/lifecycle`

Setting `lifecycleStatus` to `converted_to_po` directly is now **rejected** with:

```
400 — Use POST /api/sales/leads/:leadId/po-order to convert a lead to PO
```

This prevents leads appearing as PO-raised in Sales without a `POOrder` record in Admin.

### Frontend migration (Sales PO page)

| Before | After |
|--------|-------|
| Filter leads by `isRaisedToPO === true` | `GET /api/sales/leads/with-po` |
| Show all POs forever | `?poStatus=pending` for active requests; `?poStatus=approved` for approved/released |

### Frontend (Admin PO request page)

Keep using:

```
GET /api/admin/po-orders?status=pending
```

For history / approved list:

```
GET /api/admin/po-orders?status=approved
```

---

## Issue 2 — Combined approve + assign to plant

### Root cause

Plant panel only shows projects where **both** are true on `POOrder`:

- `status === 'approved'`
- `assignedTo === <plant user id>`

Admin approve (`PUT .../status`) alone did not set `assignedTo`, so the plant panel stayed empty.

### New endpoint (preferred)

```
PUT /api/admin/po-orders/:poOrderId/approve-and-assign
```

| Item | Detail |
|------|--------|
| **Auth** | JWT, role `admin` |
| **Body** | `{ "assignedTo": "<plantUserMongoId>", "adminNotes": "optional string" }` |
| **Validation** | `assignedTo` required, valid MongoId; user must exist with role `plant` |

**Behavior**

1. If PO status is `pending` → sets `approved`, syncs `lead.poStatus`, sets `lead.lifecycleStatus = sent_to_admin`, appends lifecycle history, logs audit.
2. If PO is already `approved` → skips approve step (still assigns).
3. Sets `POOrder.assignedTo`.
4. Sets `lead.lifecycleStatus = released_to_plant`, appends lifecycle history.
5. Sets all project buildings to `drawing_pending`.
6. Emits socket `project_assigned` on `/admin` namespace to `user:{assignedTo}`.

**Rejected when:** PO status is `rejected`.

**Response message:** `PO Order approved and assigned to plant`

**Files:**

- `src/controllers/admin/po.controller.js` → `approveAndAssignPOOrder`
- `src/routes/admin/po.routes.js`

### Refactored shared helpers

`src/controllers/admin/po.controller.js` now uses:

| Helper | Purpose |
|--------|---------|
| `syncLeadOnPOStatus` | Sync lead on approve/reject |
| `releasePOToPlant` | Assign plant user, lifecycle, buildings, socket |

Used by `updatePOStatus`, `assignPOOrder`, and `approveAndAssignPOOrder`.

### Existing endpoints (unchanged, still supported)

| Endpoint | Use case |
|----------|----------|
| `PUT /api/admin/po-orders/:id/status` | Approve or reject only |
| `PUT /api/admin/po-orders/:id/assign` | Assign only (PO must already be `approved`) |

`assign` and `approve-and-assign` now validate `assignedTo` as a MongoId. `approve-and-assign` additionally requires role `plant`.

### Frontend migration (Admin)

Replace two-step flow:

```
PUT .../status   { status: "approved" }
PUT .../assign   { assignedTo: "..." }
```

With single call:

```
PUT .../approve-and-assign
{
  "assignedTo": "<plantUserId>",
  "adminNotes": "All checks passed"
}
```

Show a plant-user picker in the same modal as approve.

---

## Issue 3 — Invoice email delivery

### Root cause

Previously `POST /api/invoices/:invoiceId/send`:

1. Set invoice `status = sent` immediately.
2. Sent email in the background (fire-and-forget).
3. Returned success even when SMTP failed.

### Changes

**Endpoint:** `POST /api/invoices/:invoiceId/send`  
**File:** `src/controllers/common/invoice.controller.js`

**New flow**

1. Check SMTP configured → `400` if `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` missing.
2. Load invoice; enforce lead access for sales role.
3. Check customer exists and has `email` → `400` if missing.
4. **Await** `mailer.sendInvoice(...)`.
5. On SMTP error → `502` with message `Failed to send invoice email: ...`; invoice stays `draft`.
6. On success → set `status = sent`, `sentAt = now`, audit log, return success.

**New helper:** `mailer.isSmtpConfigured()` in `src/services/email/mailer.js`

### Markup in email

No template change required. Email already includes:

| Location | Field |
|----------|-------|
| Line items table | `lineItems[].markup` per row |
| Summary totals | `markupTotal` |

Template: `src/services/email/templates/invoice.html`  
Builder: `src/services/email/mailer.js` → `buildInvoiceLineItemsRows`, `buildInvoiceTotalsRows`

Markup appears in email when saved on the invoice document before send (`PUT /api/invoices/:id` while `status === draft`).

### Required environment variables

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your_app_password
MAIL_FROM="Construction AI <your@email.com>"
```

### Frontend handling

| Status | Meaning | UI action |
|--------|---------|-----------|
| `400` | SMTP not configured or customer has no email | Show config/data error |
| `502` | SMTP send failed | Show retry; invoice remains draft |
| `200` | Email delivered; invoice is `sent` | Success state |

---

## Issue 4 — Admin invoice data parity with Sales

### Root cause

`GET /api/admin/customers/:customerId/projects/:leadId/invoices` previously selected only summary fields:

`invoiceNumber`, `status`, `totalAmount`, `date`, `dueDate`, `daysToPay`, `paidAt`, `createdAt`

Sales detail views returned full invoices including `lineItems`, `markupTotal`, etc. — same DB record, different API shape.

### Changes

**Endpoint:** `GET /api/admin/customers/:customerId/projects/:leadId/invoices`  
**File:** `src/controllers/admin/customer.controller.js`

- Returns **full** invoice documents (no field stripping).
- Populates `createdBy` and `paidBy`.

**Mapper:** `src/utils/projectInvoiceMetrics.js` → `mapProjectInvoiceRow`

Each item in `payments[]` now includes:

| Field | Description |
|-------|-------------|
| `invoiceId` | Mongo `_id` |
| `invoiceNumber` | Display number |
| `date` | Paid date or due/date/created |
| `amount` | `totalAmount` |
| `status` | Display label (`Pending`, `Received`, `Overdue`, etc.) |
| `invoiceStatus` | Raw enum (`draft`, `sent`, `paid`, …) |
| `subtotal` | Subtotal |
| `markupTotal` | Markup total |
| `discount` | Discount |
| `depositAmount` | Deposit |
| `totalAmount` | Total |
| `lineItems` | Full line items array |
| `description` | Invoice description |
| `daysToPay` | Payment terms days |
| `dueDate` | Due date |
| `poNumber` | PO number |
| `invoice` | Full invoice object (same as DB) |

### Invoice access control (shared API)

**File:** `src/controllers/common/invoice.controller.js`

`GET /api/invoices/:invoiceId` and `POST /api/invoices/:invoiceId/send` now call `checkLeadAccess`:

- **Admin** — access to all invoices.
- **Sales** — only invoices for leads assigned to them.

---

## Invoice edit, global tax, and payment schedule (latest)

### Edit policy (Option B)

`PUT /api/invoices/:invoiceId` now allows editing invoice body fields when `status` is **`draft`** or **`sent`**.

| Status | Edit line items / tax / totals / `daysToPay` | Link `paymentScheduleStageId` | Send email |
|--------|-----------------------------------------------|----------------------------------|------------|
| `draft` | Yes | Yes | Yes |
| `sent` | Yes | Yes | Yes (resend) |
| `paid` | No | **Yes** | No |
| `cancelled` | No | No | No |

**Payment schedule stage on invoice** (`paymentScheduleStageId`) can be changed at any time except on `cancelled` invoices — including on `paid` invoices.

### Global tax field

Invoice model now includes top-level `tax` (flat amount) in addition to per-line `lineItems[].tax`.

| Field | Level | Notes |
|-------|-------|--------|
| `lineItems[].tax` | Per line | Shown in email line-items table |
| `tax` | Invoice | Shown in email summary totals row |

Create and edit accept `tax` in the body. Missing or `0` values display as `—` in email; send still succeeds.

### `daysToPay` validation fix

`daysToPay` accepts `null` and `""` (cleared payment terms). Previously `null` failed route validation silently from the UI.

**FE:** map “Payment terms” → `daysToPay` (number). Do not send `paymentTerms` (quotation-only field).

### Payment schedule update (new)

Previously only create + get existed. Schedules can now be edited anytime:

```
PUT /api/payment-schedules/lead/:leadId
```

**Body**

```json
{
  "totalAmount": 1917952,
  "stages": [
    {
      "_id": "665b...01",
      "stageName": "Deposit",
      "amount": 30,
      "amountType": "percentage",
      "dueDate": "2026-06-01T00:00:00.000Z"
    }
  ]
}
```

**Rules**

- No invoice-status lock — editable anytime.
- Existing stages matched by `_id` keep `status`, `invoiceId`, `paidAt`, `paidBy`.
- New stages (no `_id`) are added as `pending`.
- Cannot remove a stage that is linked to an invoice or has status `invoiced` / `paid` / `overdue`.
- Same percentage/fixed sum validation as create.

### Send email guards

`POST /api/invoices/:invoiceId/send` blocks `paid` and `cancelled` invoices. `draft` and `sent` can send/resend.

---

### Other admin paths (unchanged, already full)

These already returned complete invoice documents:

- `GET /api/admin/leads/:leadId/detail` → `payments.invoices[]`
- `GET /api/admin/customers/:customerId/projects/:leadId` → `invoices[]`
- `GET /api/invoices/:invoiceId` (shared)

---

## End-to-end PO flow (after changes)

```
Sales                                    Admin                              Plant
─────                                    ─────                              ─────

POST /api/leads/:leadId/invoices
  → draft invoice

PUT /api/invoices/:id
  → edit line items, markup

POST /api/invoices/:id/send
  → email customer (must succeed)

POST /api/sales/leads/:leadId/po-order
  → POOrder (pending)
  → lead.isRaisedToPO, poNumber, poStatus=pending

GET /api/sales/leads/with-po?poStatus=pending
  → sales sees pending PO

GET /api/admin/po-orders?status=pending
  → admin sees same pending PO

PUT /api/admin/po-orders/:id/approve-and-assign
  → approved + assignedTo plant user
  → lifecycle released_to_plant

GET /api/sales/leads/with-po?poStatus=approved
  → sales sees approved PO

GET /api/plant/projects
  → plant sees assigned project
```

---

## Files modified

| File | Changes |
|------|---------|
| `src/models/Lead.js` | Added `poNumber` |
| `src/controllers/sales/lead.controller.js` | `getLeadsWithPo`, `poNumber`/`poStatus` on raise, lifecycle guard |
| `src/routes/sales/lead.routes.js` | `GET /with-po` route + validators |
| `src/controllers/admin/po.controller.js` | Refactor helpers, `approveAndAssignPOOrder`, plant role validation |
| `src/routes/admin/po.routes.js` | `PUT /approve-and-assign`, stricter `assignedTo` validation |
| `src/controllers/common/invoice.controller.js` | Hardened send; mark-paid allows draft (blocks cancelled only) |
| `src/services/email/mailer.js` | `isSmtpConfigured()` |
| `src/utils/projectInvoiceMetrics.js` | Full invoice fields in `mapProjectInvoiceRow` |
| `src/controllers/admin/customer.controller.js` | Full invoice query for project invoices |
| `src/routes/sales/index.js` | Mount `/meetings` routes (sales meetings now live) |
| `src/routes/sales/meeting.routes.js` | Sales meetings route definitions (unchanged — now mounted) |
| `src/controllers/sales/meeting.controller.js` | Sales meetings handlers |
| `src/utils/leadCreateValidators.js` | Removed `phone`/`countryCode` from lead edit validators |
| `src/controllers/account/invoice.controller.js` | Mark-paid: allow `draft`; block only `cancelled` |
| `docs/admin-sales-backend-data-flow.md` | Updated PO and invoice flow notes |

---

## API quick reference

### New endpoints

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/sales/leads/with-po` | sales |
| `PUT` | `/api/admin/po-orders/:poOrderId/approve-and-assign` | admin |
| `GET` | `/api/sales/meetings` | sales |
| `POST` | `/api/sales/meetings` | sales |
| `PUT` | `/api/sales/meetings/:meetingId` | sales |
| `PUT` | `/api/sales/meetings/:meetingId/complete` | sales |

### Changed behavior (same URL)

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/api/sales/leads/:leadId/po-order` | Sets `lead.poNumber`, `lead.poStatus=pending` |
| `PUT` | `/api/sales/leads/:leadId/lifecycle` | Blocks `converted_to_po` |
| `POST` | `/api/invoices/:invoiceId/send` | Awaits email; 502 on failure; 400 if SMTP/customer email missing |
| `GET` | `/api/invoices/:invoiceId` | Sales access check added |
| `GET` | `/api/admin/customers/:customerId/projects/:leadId/invoices` | Returns full invoice + line items |
| `PUT` | `/api/invoices/:invoiceId/mark-paid` | Draft guard removed; only `cancelled` blocked |

---

## Frontend checklist

- [ ] **Sales PO page** → `GET /api/sales/leads/with-po` with `poStatus` filter
- [ ] **Admin PO approve** → `PUT .../approve-and-assign` with plant user picker
- [ ] **Invoice send** → handle `400` (config) and `502` (SMTP failure)
- [ ] **Admin invoice detail** → use updated project invoices response or `GET /api/invoices/:id`
- [ ] **Do not** set lifecycle to `converted_to_po` manually — use raise PO endpoint
- [ ] **Deploy** with SMTP env vars set in production
- [ ] **Admin Edit Leads** → include `quoteValue` and same project fields as Add Leads; save via `PUT /api/admin/leads/:leadId`
- [ ] **Sales Meetings** → use `/api/sales/meetings` CRUD; online mode requires `meetingLink`; edit/complete only for `createdBy`

---

## Testing suggestions

### PO flow

1. Sales raises PO → verify `GET /api/sales/leads/with-po?poStatus=pending` and `GET /api/admin/po-orders?status=pending` both return the order.
2. Admin calls `approve-and-assign` → verify plant user sees project in `GET /api/plant/projects`.
3. Sales calls `with-po?poStatus=approved` → verify PO appears with `po.status: approved`.

### Invoice flow

1. Create draft invoice with `lineItems[].markup` and `markupTotal`.
2. Call send → confirm customer receives email with markup column and markup total.
3. Confirm `502` when SMTP is misconfigured (invoice remains `draft`).
4. Edit invoice in Sales → confirm Admin project invoices shows same `lineItems` and totals.

---

## Admin — Edit Leads vs Add Leads (price / `quoteValue`)

### Problem

The Admin **Edit Leads** UI may show fewer fields than **Add Leads**. In particular, there is often no input to change **price**. The backend already supports editing price and other project fields — the gap is typically on the **frontend form**, not the API.

### How to edit price (lead pipeline value)

Lead/project price is stored as **`quoteValue`** on the `Lead` document.

```
PUT /api/admin/leads/:leadId
```

```json
{
  "quoteValue": 300000
}
```

Partial update — send only fields you want to change. At least **one** field is required.

**Example with multiple fields:**

```json
{
  "projectName": "Warehouse A",
  "buildingType": "Storage",
  "location": "Austin, TX",
  "quoteValue": 300000,
  "roofStyle": "Gable",
  "width": 50,
  "length": 100,
  "height": 20,
  "doors": 2,
  "windows": 4,
  "insulation": 1,
  "notes": "Updated price after negotiation"
}
```

| Item | Detail |
|------|--------|
| **Auth** | JWT, role `admin` |
| **Load current values** | `GET /api/admin/leads/:leadId/detail` → `lead.quoteValue` |
| **`quoteValue` null** | Sending `null` resets to `0` |

**Implementation:** `src/controllers/admin/lead.controller.js` → `editLead`  
**Validators:** `src/utils/leadCreateValidators.js` → `leadEditFieldValidators`  
**Field mapping:** `src/utils/leadPayload.js` → `applyLeadUpdateFromBody`

### Add vs Edit — backend field parity

| Field | Add (`POST /api/admin/leads`) | Edit (`PUT /api/admin/leads/:leadId`) |
|-------|-------------------------------|----------------------------------------|
| `customerId` | Required | Cannot change |
| `projectName` | Required | Yes |
| `buildingType` | Required | Yes |
| `location` | Required | Yes |
| **`quoteValue`** (price) | Yes | **Yes** |
| `roofStyle` | Yes | Yes |
| `width`, `length`, `height` | Yes | Yes |
| `doors`, `windows`, `insulation` | Yes | Yes (`door` / `window` aliases also accepted) |
| `source` | Yes | Yes (cannot be `null`) |
| `notes` | No on create | Yes |
| `lifecycleStatus` | No | Yes — prefer `PUT .../lifecycle` for status-only updates |
| `assignedSales` | Yes on create body | **Separate call** → `PUT /api/admin/leads/:leadId/assign` |

**Create-only alias:** `POST` accepts `estimatedValue` as an alias for `quoteValue`. On edit, use `quoteValue`.

### Three different “prices” in the system

Use the correct API depending on what you are changing:

| Meaning | Where it lives | How to edit |
|---------|----------------|-------------|
| **Lead / pipeline value** | `lead.quoteValue` | `PUT /api/admin/leads/:leadId` |
| **Formal quotation price** | `Quotation.finalPrice` (and related pricing fields) | `PUT /api/quotations/:quotationId` while `status === draft` |
| **Invoice / billing amount** | `Invoice.totalAmount`, `lineItems`, `markupTotal`, etc. | `PUT /api/invoices/:invoiceId` while `status === draft` |

Changing **`quoteValue`** does **not** automatically update an existing quotation or invoice. Those are separate documents.

### Related admin endpoints

| Action | Endpoint |
|--------|----------|
| Lead detail (read all fields) | `GET /api/admin/leads/:leadId/detail` |
| Edit lead / project fields | `PUT /api/admin/leads/:leadId` |
| Assign sales rep | `PUT /api/admin/leads/:leadId/assign` — `{ "employeeId": "<userId>" }` |
| Lifecycle only | `PUT /api/admin/leads/:leadId/lifecycle` — `{ "lifecycleStatus": "...", "note": "optional" }` |

Sales panel uses the same edit shape on `PUT /api/sales/leads/:leadId` (sales must own the lead via `assignedSales`).

### Frontend fix (Admin Edit Leads page)

1. Load `GET /api/admin/leads/:leadId/detail` when opening edit.
2. Bind the same inputs as **Add Leads**, including **`quoteValue`**.
3. On save, `PUT /api/admin/leads/:leadId` with changed fields.
4. Keep **Assign sales** on `PUT .../assign`, not on the general edit payload.

### API workaround (until UI is updated)

1. `GET /api/admin/leads/:leadId/detail` — read `lead.quoteValue`.
2. `PUT /api/admin/leads/:leadId` with `{ "quoteValue": <new amount> }`.

### Testing

1. Create lead with `quoteValue: 150000` via `POST /api/admin/leads`.
2. `PUT /api/admin/leads/:leadId` with `{ "quoteValue": 175000 }`.
3. Confirm `GET /api/admin/leads/:leadId/detail` returns `quoteValue: 175000`.
4. Confirm dashboard / pipeline aggregates reflect the new value.

---

## Sales Meetings API — Frontend integration guide

**Base path:** `/api/sales/meetings`  
**Auth:** `Authorization: Bearer <sales_jwt>` — role must be `sales`  
**Mounted in:** `src/routes/sales/index.js` → `router.use('/meetings', require('./meeting.routes'))`

### Standard response envelope

All endpoints return:

```json
{
  "success": true,
  "message": "Success",
  "data": { }
}
```

Errors:

```json
{
  "success": false,
  "message": "Human-readable error"
}
```

| HTTP | When |
|------|------|
| `400` | Validation failed, invalid status, missing meeting link for online mode |
| `401` | Missing / invalid JWT |
| `403` | Lead not assigned to you, or edit/complete on someone else's meeting |
| `404` | Meeting or lead not found |
| `201` | Meeting created (`POST`) |

### Meeting object shape

| Field | Type | Notes |
|-------|------|-------|
| `_id` | string | MongoId |
| `customerId` | ObjectId or populated Customer | Required on create |
| `leadId` | ObjectId, populated Lead, or `null` | Optional; must be **your** assigned lead |
| `title` | string | Required |
| `createdBy` | ObjectId | Set to current sales user on create |
| `meetingTime` | ISO date | Required |
| `duration` | number \| null | Minutes |
| `mode` | `online` \| `offline` | Required |
| `meetingLink` | string | **Required when `mode` is `online`** |
| `notes` | string | Optional |
| `status` | `scheduled` \| `completed` \| `cancelled` \| `rescheduled` | Default `scheduled` |
| `completedAt` | ISO date \| null | Set on complete |
| `createdAt` | ISO date | |
| `updatedAt` | ISO date | |

### Scope rules (sales)

| Rule | Detail |
|------|--------|
| **List** | Only meetings where `leadId` belongs to a lead with `assignedSales = current user` |
| **Create with `leadId`** | Lead must exist and be assigned to you |
| **Edit / complete** | Only meetings where `createdBy = current user` |
| **No GET by id** | Use list or store `_id` from create; filter client-side or use list `search` |

### Helper APIs (pickers)

Use when building the create-meeting form:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/customers?search=` | Customer dropdown (sales-scoped) |
| `GET` | `/api/leads?search=` | Lead/project dropdown (assigned leads only) |

Both require the same sales JWT under `/api`.

---

### 1. `GET /api/sales/meetings` — List meetings

**UI:** Meetings calendar / list / upcoming tab.

#### Query parameters

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `status` | string | No | `scheduled`, `completed`, `cancelled`, `rescheduled` |
| `search` | string | No | Case-insensitive match on `title` |

**Default (no `status`):** returns `scheduled` and `rescheduled` only — excludes `completed` and `cancelled`.

#### Request

No body.

#### Example requests

```http
GET /api/sales/meetings
GET /api/sales/meetings?status=scheduled
GET /api/sales/meetings?status=completed
GET /api/sales/meetings?search=site%20visit
```

#### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "meetings": [
      {
        "_id": "665a10000000000000000001",
        "customerId": {
          "_id": "665a00000000000000000001",
          "customerId": "CUS-00042",
          "firstName": "Jane",
          "lastName": "Doe",
          "email": "jane@example.com"
        },
        "leadId": {
          "_id": "665b2c3d4e5f67890123456",
          "jobId": "PRO-003",
          "projectName": "Warehouse Expansion",
          "buildingType": "Warehouse",
          "location": "Austin, TX",
          "lifecycleStatus": "negotiation"
        },
        "title": "Site visit — warehouse specs",
        "createdBy": "665900000000000000000003",
        "meetingTime": "2026-06-20T14:00:00.000Z",
        "duration": 60,
        "mode": "online",
        "meetingLink": "https://meet.google.com/abc-defg-hij",
        "notes": "Review final dimensions",
        "status": "scheduled",
        "completedAt": null,
        "createdAt": "2026-06-10T09:00:00.000Z",
        "updatedAt": "2026-06-10T09:00:00.000Z"
      }
    ]
  }
}
```

Sorted ascending by `meetingTime` (soonest first).

#### Frontend notes

- **Upcoming tab:** `GET /api/sales/meetings` (default filter).
- **History tab:** `GET /api/sales/meetings?status=completed` and/or `?status=cancelled`.
- Meetings with `leadId: null` are **not** included in the sales list (filter requires assigned leads).

---

### 2. `POST /api/sales/meetings` — Create meeting

**UI:** Schedule meeting modal / form.

#### Request body

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `customerId` | Yes | MongoId | |
| `leadId` | No | MongoId | If sent, lead must be assigned to current user |
| `title` | Yes | string | Non-empty |
| `meetingTime` | Yes | ISO 8601 | e.g. `2026-06-20T14:00:00.000Z` |
| `mode` | Yes | `online` \| `offline` | |
| `meetingLink` | Conditional | string | **Required when `mode` is `online`** |
| `duration` | No | number | Minutes |
| `notes` | No | string | |

#### Example — online meeting

```json
{
  "customerId": "665a00000000000000000001",
  "leadId": "665b2c3d4e5f67890123456",
  "title": "Quote review call",
  "meetingTime": "2026-06-20T14:00:00.000Z",
  "duration": 45,
  "mode": "online",
  "meetingLink": "https://meet.google.com/abc-defg-hij",
  "notes": "Walk through revised quotation"
}
```

#### Example — offline meeting

```json
{
  "customerId": "665a00000000000000000001",
  "leadId": "665b2c3d4e5f67890123456",
  "title": "On-site visit",
  "meetingTime": "2026-06-22T10:00:00.000Z",
  "duration": 90,
  "mode": "offline",
  "notes": "Customer plant location"
}
```

#### Response `201`

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "meeting": {
      "_id": "665a10000000000000000002",
      "customerId": "665a00000000000000000001",
      "leadId": "665b2c3d4e5f67890123456",
      "title": "Quote review call",
      "createdBy": "665900000000000000000003",
      "meetingTime": "2026-06-20T14:00:00.000Z",
      "duration": 45,
      "mode": "online",
      "meetingLink": "https://meet.google.com/abc-defg-hij",
      "notes": "Walk through revised quotation",
      "status": "scheduled",
      "completedAt": null,
      "createdAt": "2026-06-10T10:30:00.000Z",
      "updatedAt": "2026-06-10T10:30:00.000Z"
    }
  }
}
```

#### Errors

| HTTP | Message |
|------|---------|
| `400` | `Meeting link is required for online meetings` |
| `403` | `This lead is not assigned to you` |
| `404` | `Lead not found` |

---

### 3. `PUT /api/sales/meetings/:meetingId` — Edit meeting

**UI:** Edit meeting drawer / reschedule / cancel / add link.

**Auth rule:** only the sales user who **created** the meeting (`createdBy`) can edit.

#### Path parameters

| Param | Required |
|-------|----------|
| `meetingId` | Yes (MongoId) |

#### Request body (partial update)

Send only fields to change.

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | |
| `meetingTime` | ISO 8601 | Reschedule |
| `duration` | number | Minutes |
| `mode` | `online` \| `offline` | If switching to `online`, ensure `meetingLink` is set |
| `meetingLink` | string | Required when effective mode is `online` |
| `notes` | string | |
| `status` | `scheduled` \| `completed` \| `cancelled` \| `rescheduled` | Use `cancelled` to cancel; prefer `/complete` for done |

#### Example — reschedule

```json
{
  "meetingTime": "2026-06-21T15:00:00.000Z",
  "status": "rescheduled",
  "notes": "Customer requested new slot"
}
```

#### Example — switch to online + add link

```json
{
  "mode": "online",
  "meetingLink": "https://zoom.us/j/123456789"
}
```

#### Response `200`

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "meeting": {
      "_id": "665a10000000000000000001",
      "customerId": "665a00000000000000000001",
      "leadId": "665b2c3d4e5f67890123456",
      "title": "Site visit — warehouse specs",
      "createdBy": "665900000000000000000003",
      "meetingTime": "2026-06-21T15:00:00.000Z",
      "duration": 60,
      "mode": "online",
      "meetingLink": "https://zoom.us/j/123456789",
      "notes": "Customer requested new slot",
      "status": "rescheduled",
      "completedAt": null,
      "createdAt": "2026-06-10T09:00:00.000Z",
      "updatedAt": "2026-06-10T11:00:00.000Z"
    }
  }
}
```

#### Errors

| HTTP | Message |
|------|---------|
| `403` | `You can only edit your own meetings` |
| `404` | `Meeting not found` |
| `400` | `Meeting link required for online meetings` |

---

### 4. `PUT /api/sales/meetings/:meetingId/complete` — Mark completed

**UI:** "Mark as done" / complete button.

**Auth rule:** only `createdBy` can complete.

#### Path parameters

| Param | Required |
|-------|----------|
| `meetingId` | Yes (MongoId) |

#### Request body

None.

#### Example

```http
PUT /api/sales/meetings/665a10000000000000000001/complete
```

#### Response `200`

```json
{
  "success": true,
  "message": "Meeting marked as completed",
  "data": {
    "meeting": {
      "_id": "665a10000000000000000001",
      "customerId": "665a00000000000000000001",
      "leadId": "665b2c3d4e5f67890123456",
      "title": "Site visit — warehouse specs",
      "createdBy": "665900000000000000000003",
      "meetingTime": "2026-06-20T14:00:00.000Z",
      "duration": 60,
      "mode": "online",
      "meetingLink": "https://meet.google.com/abc-defg-hij",
      "notes": "Review final dimensions",
      "status": "completed",
      "completedAt": "2026-06-20T15:30:00.000Z",
      "createdAt": "2026-06-10T09:00:00.000Z",
      "updatedAt": "2026-06-20T15:30:00.000Z"
    }
  }
}
```

#### Errors

| HTTP | Message |
|------|---------|
| `403` | `You can only complete your own meetings` |
| `404` | `Meeting not found` |

---

### Sales Meetings vs Follow-ups vs Activity log

| Feature | Endpoint | Use when |
|---------|----------|----------|
| **Full meeting record** | `/api/sales/meetings` | Calendar, links, duration, online/offline |
| **Follow-up reminder** | `POST /api/sales/followups` with `modeOfContact: "meeting"` | Simple dated reminder on a lead |
| **Activity log** | `POST /api/sales/leads/:leadId/activity` with `activityType: "meeting"` | Log that a meeting happened (audit trail only) |

Prefer **`/api/sales/meetings`** for the dedicated Meetings UI.

---

### Frontend integration checklist (Meetings)

- [ ] List upcoming: `GET /api/sales/meetings`
- [ ] List history: `GET /api/sales/meetings?status=completed`
- [ ] Create: `POST /api/sales/meetings` — validate link when `mode === 'online'`
- [ ] Edit own meetings only — hide edit if `createdBy !== currentUserId`
- [ ] Complete: `PUT /api/sales/meetings/:id/complete`
- [ ] Cancel: `PUT /api/sales/meetings/:id` with `{ "status": "cancelled" }`
- [ ] Customer/lead pickers: `GET /api/customers`, `GET /api/leads`
- [ ] Handle `403` when lead not in portfolio

### Suggested UI flow

```
1. Open Meetings page
   → GET /api/sales/meetings

2. Click "Schedule meeting"
   → GET /api/customers + GET /api/leads (pickers)
   → POST /api/sales/meetings

3. Click meeting row (creator only)
   → PUT /api/sales/meetings/:id (reschedule / edit link / notes)

4. After meeting ends (creator only)
   → PUT /api/sales/meetings/:id/complete

5. History tab
   → GET /api/sales/meetings?status=completed
```

---

## Sales panel — Edit Lead, Invoice, PO gate & Payment (findings & plan)

Manager feedback items with **agreed decisions** and backend status.

---

### 1. Sales Edit Lead

**Decision:** Add Edit Lead in sales panel. **Do not accept phone/mobile** on lead edit — phone stays on Customer only via separate customer APIs if needed later.

#### API — load & save

| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Load lead | `GET` | `/api/sales/leads/:leadId/detail` | sales JWT |
| Save lead fields | `PUT` | `/api/sales/leads/:leadId` | sales JWT |

**Not accepted on `PUT /api/sales/leads/:leadId`:** `phone`, `countryCode`, `mobile` (removed from validators).

#### Editable fields (`PUT /api/sales/leads/:leadId`)

| Field | Type | Notes |
|-------|------|-------|
| `projectName` | string | |
| `location` | string | |
| `quoteValue` | number | `null` → `0` |
| `buildingType` | string | |
| `roofStyle` | string | |
| `width`, `length`, `height` | number \| null | `null` clears |
| `doors`, `windows`, `insulation` | number \| null | Maps to `numDoors`, `numWindows`, `numInsulation` |
| `numberOfBuildings` | integer ≥ 1 | See building sync section — **pending your choice** |
| `notes` | string | |
| `lifecycleStatus` | string | Prefer `PUT .../lifecycle` for status-only |
| `source` | string | `chat` \| `manual` \| `import` \| `customer_portal` |

**Example request:**

```json
{
  "projectName": "Warehouse Phase 2",
  "location": "Dallas, TX",
  "quoteValue": 175000,
  "numberOfBuildings": 3,
  "buildingType": "Warehouse",
  "width": 50,
  "length": 100,
  "height": 20
}
```

**Example response `200`:**

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "lead": {
      "_id": "...",
      "jobId": "PRO-042",
      "projectName": "Warehouse Phase 2",
      "location": "Dallas, TX",
      "quoteValue": 175000,
      "numberOfBuildings": 3,
      "lifecycleStatus": "negotiation"
    }
  }
}
```

#### Initial building create (separate from edit)

| Method | Endpoint | When |
|--------|----------|------|
| `POST` | `/api/sales/leads/:leadId/buildings` | **One-time only** — fails if buildings already exist |

```json
{ "numberOfBuildings": 3 }
```

Creates `Building` documents `buildingNumber` 1…N with `status: pending`.

---

#### Building sync when `numberOfBuildings` changes on edit — **needs your confirmation**

**Today:** `PUT .../leadId` only updates `lead.numberOfBuildings` on the Lead document. It does **not** add/remove `Building` rows. Plant/BOM/drawing flows depend on `Building` records.

| Scenario | Current behaviour | Risk if unchanged |
|----------|-------------------|-------------------|
| **Increase** (e.g. 2 → 4) | Lead says 4, only 2 `Building` docs exist | Plant panel missing buildings 3–4 |
| **Decrease** (e.g. 4 → 2) | Lead says 2, 4 `Building` docs remain | Orphan buildings; BOM/drawings on deleted numbers |
| **Set 0** | Validator rejects (`min: 1`) | Cannot send 0 today |

**Proposed options (pick one before we implement):**

| Option | Increase | Decrease | Set 0 |
|--------|----------|----------|-------|
| **A — Sync add only** | Create new buildings N+1…newCount | Reject with 400 if newCount < existing building count | Reject 400 |
| **B — Full sync** | Add missing buildings | Soft-delete or block if any building has drawings/BOM | Reject 400 |
| **C — Count-only** | Lead field only, no Building sync | Lead field only | Reject 400 |
| **D — Replace all** | Delete all buildings + recreate 1…N (only if none have drawings) | Same | Reject 400 |

**Recommendation:** Option **A** for safest incremental behaviour — increase adds new empty buildings; decrease blocked if buildings already exist.

**Confirmed with product (Option B):** Full sync — add buildings on increase; **block decrease** if any existing building has drawings or BOM activity; reject `0`.

---

### 2. “Argile” on invoice creation

**Decision:** **Frontend only** — not in backend. No API field, no backend change. Remove from invoice create UI on the sales panel.

---

### 3. Invoice before proposal sent

**Decision:** **Do not add** a proposal-sent / quotation-sent check on `POST /api/leads/:leadId/invoices`. Invoice creation stays open regardless of quotation status.

#### Similar gate that **does** exist — Raise PO from sales

For comparison, PO raise **is** gated (`POST /api/sales/leads/:leadId/po-order`):

| Check | Rule | Error if fails |
|-------|------|----------------|
| Lead access | `assignedSales` = current user | 403 |
| Already raised | `isRaisedToPO` must be false | 400 |
| **Invoice exists** | At least one invoice on lead (any status, including `draft`) | 400 `No invoice found. Create an invoice first.` |
| **Lifecycle** | Must be one of: `proposal_sent`, `negotiation`, `deal_closed`, `payment_done` | 400 |
| Quotation | Loaded if exists but **not required** — `quotationId` can be null | — |

**There is no check** that quotation `status === 'sent'` for PO raise — only lifecycle stage and invoice existence.

**Sales PO list after raise:** `GET /api/sales/leads/with-po?poStatus=pending|approved|rejected`

---

### 4. Payment — mark as paid

**Decision:** Payment complete = invoice `status` becomes **`paid`** only. No separate `"Payment Done"` status string. No lifecycle auto-update to `payment_done` required.

#### Mark paid endpoint (sales + admin)

| Method | Endpoint | Auth | Body |
|--------|----------|------|------|
| `PUT` | `/api/invoices/:invoiceId/mark-paid` | JWT `admin` or `sales` | None |

Mounted under `/api/invoices` (`src/routes/common/invoice.routes.js`).

**Account panel** (separate mount): `PUT /api/account/invoices/:invoiceId/mark-paid`

#### Guards (updated)

| Guard | Status |
|-------|--------|
| Already `paid` | 400 — still blocked |
| `cancelled` | 400 — still blocked |
| ~~Must be `sent` before paid~~ | **Removed** — `draft` invoices can now be marked paid |
| Sales access | Lead must be assigned to sales user | 403 |

#### Example

```http
PUT /api/invoices/665a20000000000000000001/mark-paid
Authorization: Bearer <token>
```

**Response `200`:**

```json
{
  "success": true,
  "message": "Invoice marked as paid",
  "data": {
    "invoice": {
      "_id": "665a20000000000000000001",
      "invoiceNumber": "INV-0042",
      "status": "paid",
      "paidAt": "2026-06-15T10:00:00.000Z",
      "paidBy": "665900000000000000000003",
      "totalAmount": 280000
    }
  }
}
```

**Side effects when `paymentScheduleStageId` is set:** linked payment schedule stage → `status: paid`.

**Frontend:** After success, read `invoice.status === 'paid'` (not `"Payment Done"`).

#### Related invoice endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/leads/:leadId/invoices` | Create draft invoice |
| `GET` | `/api/leads/:leadId/invoices` | List invoices for lead |
| `GET` | `/api/invoices/:invoiceId` | Invoice detail |
| `PUT` | `/api/invoices/:invoiceId` | Edit draft only |
| `POST` | `/api/invoices/:invoiceId/send` | Email customer; sets `sent` |
| `PUT` | `/api/invoices/:invoiceId/mark-paid` | Sets `paid` |
| `GET` | `/api/invoices` | Global list (role-scoped) |
| `GET` | `/api/invoices/stats` | Stats |

---

### Enum reference (`src/config/constants.js`)

Use these exact values in requests and when reading API responses.

#### Invoice

| Constant | Values |
|----------|--------|
| `INVOICE_STATUSES` | `draft`, `sent`, `paid`, `overdue`, `cancelled` |

**Payment complete in UI** = `paid`.

#### Quotation

| Constant | Values |
|----------|--------|
| `QUOTATION_STATUSES` | `draft`, `sent`, `accepted`, `rejected` |

#### PO order

| Constant | Values |
|----------|--------|
| `PO_STATUSES` | `pending`, `approved`, `rejected` |

#### Lead lifecycle (sales stages)

| Constant | Values |
|----------|--------|
| `SALES_LIFECYCLE_STAGES` | `initial_contact`, `requirements_gathered`, `proposal_sent`, `negotiation`, `deal_closed`, `payment_done`, `converted_to_po`, `sent_to_admin` |
| `PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES` | `proposal_sent`, `negotiation`, `deal_closed`, `payment_done` |

#### Payment schedule stage

| Constant | Values |
|----------|--------|
| `PAYMENT_STAGE_STATUSES` | `pending`, `invoiced`, `paid`, `overdue` |
| `PAYMENT_AMOUNT_TYPES` | `percentage`, `fixed` |

#### Building

| Constant | Values |
|----------|--------|
| `BUILDING_STATUSES` | `pending`, `drawing_pending`, `drawing_uploaded`, `drawing_approved`, `drawing_rejected`, `bom_pending`, `bom_approved`, `bom_confirmed`, `completed` |
| `DRAWING_STATUSES` | `pending_review`, `approved`, `rejected` |

#### Meeting

| Constant | Values |
|----------|--------|
| `MEETING_MODES` | `online`, `offline` |
| `MEETING_STATUSES` | `scheduled`, `completed`, `cancelled`, `rescheduled` |

#### Follow-up

| Constant | Values |
|----------|--------|
| `FOLLOW_UP_STATUSES` | `pending`, `completed` |
| `FOLLOW_UP_MODES` | `call`, `email`, `meeting` |

#### Other

| Constant | Values |
|----------|--------|
| `LEAD_SOURCES` | `chat`, `manual`, `import`, `customer_portal` |
| `LEAD_TEMPERATURES` | `hot`, `warm`, `cold` |
| `PRIORITY_LEVELS` | `low`, `medium`, `high`, `urgent` |
| `ESCALATION_STATUSES` | `pending`, `resolved` |
| `USER_ROLES` | `admin`, `sales`, `construction`, `plant`, `account` |

#### Display labels vs DB (admin project invoices)

`mapProjectInvoiceRow` maps DB → UI label:

| DB `invoice.status` | Display `status` |
|---------------------|------------------|
| `paid` | `Received` |
| `sent` | `Pending` |
| `draft` | `Draft` |
| overdue (computed) | `Overdue` |
| `cancelled` | `Cancelled` |

`GET /api/invoices` list returns raw `status` (`paid`) in row — not the display label. Frontend should use `invoice.status` or `invoiceStatus` from project payments API consistently.

---

### Implementation status

| Item | Status |
|------|--------|
| Remove phone from lead edit validators | Done |
| Remove draft guard on mark-paid | Done (`common` + `account` controllers) |
| Building sync on edit | **Option B confirmed** — implement next |
| Sales Edit Lead FE screen | Frontend |
| Remove Argile from invoice form | Frontend |
| Proposal-before-invoice gate | **Not implementing** (per decision) |
| PO raise gate | Already exists — documented above |

