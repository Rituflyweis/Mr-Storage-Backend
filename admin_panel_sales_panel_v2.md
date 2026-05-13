# CRM Backend — API & Schema Plan v2.0

**Status markers used throughout:**
- `[NEW]` — Build from scratch. Does not exist.
- `[CHANGE]` — Exists but needs modifications.
- `[EXISTS]` — No changes needed.

---

## PART 1 — SCHEMA CHANGES

---

### 1.1 constants.js — Full Updated File

```js
const USER_ROLES = ['admin', 'sales', 'construction', 'plant', 'account']
const LEAD_SOURCES = ['chat', 'manual', 'import', 'customer_portal']

// CHANGED: requirements_collected → requirements_gathered
//          delivered replaced by converted_to_po + sent_to_admin
const LIFECYCLE_STAGES = [
  'initial_contact',
  'requirements_gathered',
  'proposal_sent',
  'negotiation',
  'deal_closed',
  'payment_done',
  'converted_to_po',
  'sent_to_admin',
]
const CLOSED_STAGES = ['deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin']

const PRIORITY_LEVELS    = ['low', 'medium', 'high', 'urgent']
const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected']
const INVOICE_STATUSES   = ['draft', 'sent', 'paid', 'overdue', 'cancelled']
const FOLLOW_UP_STATUSES = ['pending', 'completed']
const FOLLOW_UP_MODES    = ['call', 'email', 'meeting']          // NEW
const MEETING_MODES      = ['online', 'offline']
const MEETING_STATUSES   = ['scheduled', 'completed', 'cancelled', 'rescheduled']
const ESCALATION_STATUSES = ['pending', 'resolved']
const PO_STATUSES        = ['pending', 'approved', 'rejected']
const PAYMENT_AMOUNT_TYPES  = ['percentage', 'fixed']
const PAYMENT_STAGE_STATUSES = ['pending', 'invoiced', 'paid', 'overdue'] // CHANGED: added invoiced
const ASSIGN_METHODS     = ['auto', 'manual']

// NEW: added 'activity' type
const AUDIT_TYPES = [
  'lead', 'invoice', 'quotation', 'meeting',
  'followup', 'user', 'escalation', 'po', 'chat', 'activity',
]

// NEW actions added: ACTIVITY_LOGGED, LEAD_TERMINATED, BUILDINGS_CREATED,
//                    BUDGET_SET, CUSTOMER_CREATED, PAYMENT_STAGE_INVOICED, PAYMENT_STAGE_PAID
const AUDIT_ACTIONS = {
  LEAD_CREATED:            'lead.created',
  LEAD_ASSIGNED_AUTO:      'lead.assigned.auto',
  LEAD_ASSIGNED_MANUAL:    'lead.assigned.manual',
  LEAD_QUOTE_READY:        'lead.quote_ready',
  LEAD_HANDED_TO_SALES:    'lead.handed_to_sales',
  LEAD_LIFECYCLE_UPDATED:  'lead.lifecycle_updated',
  LEAD_ESCALATED:          'lead.escalated',
  LEAD_PO_RAISED:          'lead.po_raised',
  LEAD_PO_APPROVED:        'lead.po_approved',
  LEAD_PO_REJECTED:        'lead.po_rejected',
  LEAD_EDITED:             'lead.edited',
  LEAD_TERMINATED:         'lead.terminated',
  BUILDINGS_CREATED:       'lead.buildings_created',
  QUOTATION_CREATED:       'quotation.created',
  QUOTATION_SENT:          'quotation.sent',
  QUOTATION_ACCEPTED:      'quotation.accepted',
  QUOTATION_EDITED:        'quotation.edited',
  INVOICE_CREATED:         'invoice.created',
  INVOICE_SENT:            'invoice.sent',
  INVOICE_PAID:            'invoice.paid',
  INVOICE_EDITED:          'invoice.edited',
  PAYMENT_STAGE_INVOICED:  'payment.stage_invoiced',
  PAYMENT_STAGE_PAID:      'payment.stage_paid',
  MEETING_CREATED:         'meeting.created',
  MEETING_EDITED:          'meeting.edited',
  MEETING_COMPLETED:       'meeting.completed',
  FOLLOWUP_CREATED:        'followup.created',
  FOLLOWUP_COMPLETED:      'followup.completed',
  ESCALATION_CREATED:      'escalation.created',
  ESCALATION_RESOLVED:     'escalation.resolved',
  USER_CREATED:            'user.created',
  USER_UPDATED:            'user.updated',
  DOCUMENT_ADDED:          'lead.document_added',
  DOCUMENT_REMOVED:        'lead.document_removed',
  BUDGET_SET:              'lead.budget_set',
  CUSTOMER_CREATED:        'customer.created',
  CUSTOMER_PROJECT_CREATED:'customer.project_created',
  ACTIVITY_LOGGED:         'activity.logged',
}

const BUILDING_STATUSES = [  // NEW
  'pending', 'drawing_pending', 'drawing_uploaded',
  'drawing_approved', 'drawing_rejected',
  'bom_pending', 'bom_approved', 'completed',
]

module.exports = {
  USER_ROLES, LEAD_SOURCES, LIFECYCLE_STAGES, CLOSED_STAGES,
  PRIORITY_LEVELS, QUOTATION_STATUSES, INVOICE_STATUSES,
  FOLLOW_UP_STATUSES, FOLLOW_UP_MODES, MEETING_MODES, MEETING_STATUSES,
  ESCALATION_STATUSES, PO_STATUSES, PAYMENT_AMOUNT_TYPES,
  PAYMENT_STAGE_STATUSES, ASSIGN_METHODS, AUDIT_TYPES, AUDIT_ACTIONS,
  BUILDING_STATUSES,
}
```

---

### 1.2 Lead Model — Updated Schema
**File:** `src/models/Lead.js`
**Changes:** Added `projectName`, `numberOfBuildings`, `isTerminated`, `terminationReason`, `terminatedAt`

```js
// Fields added — paste into existing LeadSchema before closing brace:

projectName:       { type: String, default: '' },
numberOfBuildings: { type: Number, default: 1, min: 1 },
isTerminated:      { type: Boolean, default: false },
terminationReason: { type: String, default: '' },
terminatedAt:      { type: Date, default: null },

// Also update the enum on lifecycleStatus to use new LIFECYCLE_STAGES constant
// Also add index:
LeadSchema.index({ isTerminated: 1 })
```

---

### 1.3 Quotation Model — Updated Schema
**File:** `src/models/Quotation.js`
**Changes:** ~35 new fields added. All auto-calculated fields noted.

```js
// Add all fields below into existing QuotationSchema:

// Project header
quoteNumber:         { type: String, default: '' },         // AUTO: generateQuoteNumber() on create
proposalDate:        { type: Date, default: Date.now },
validity:            { type: String, default: '' },
preparedBy:          { type: String, default: '' },
assignedSalesperson: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
margin:              { type: Number, default: 0 },

// Detailed building specs
leftEaveHeight:  { type: Number, default: null },
rightEaveHeight: { type: Number, default: null },
roofSlope:       { type: String, default: '' },
totalArea:       { type: Number, default: null },    // AUTO: width × length

// Structure & engineering
frameType:   { type: String, default: '' },
endwallType: { type: String, default: '' },
girtType:    { type: String, default: '' },
purlinType:  { type: String, default: '' },
bracingType: { type: String, default: '' },

// Material specifications
roofPanel:     { type: String, default: '' },
wallPanelType: { type: String, default: '' },
roofColor:     { type: String, default: '' },
wallColor:     { type: String, default: '' },
trimColor:     { type: String, default: '' },
baseAngle:     { type: String, default: '' },

// Insulation
insulation: [{
  insulationType: { type: String, enum: ['roof', 'wall'], required: true },
  thickness:      { type: String, default: '' },
  material:       { type: String, default: '' },
}],

// Freight / shipping
shippingCost:     { type: Number, default: 0 },
deliveryType:     { type: String, default: '' },
shippingIncluded: { type: Boolean, default: false },

// COGS + pricing — ALL AUTO-CALCULATED server-side, never trust client
materialCost:  { type: Number, default: 0 },
freightCost:   { type: Number, default: 0 },
totalCOGS:     { type: Number, default: 0 },   // materialCost + freightCost
markupPercent: { type: Number, default: 0 },
markupValue:   { type: Number, default: 0 },   // totalCOGS × markupPercent / 100
finalPrice:    { type: Number, default: 0 },   // totalCOGS + markupValue
psf:           { type: Number, default: null }, // finalPrice / totalArea

// Doors
doors: [{
  doorCategory: { type: String, enum: ['rolling', 'personnel'], required: true },
  doorType:     { type: String, default: '' },
  size:         { type: String, default: '' },
  qty:          { type: Number, default: 1 },
  notes:        { type: String, default: '' },
}],

// Components & exclusions
includedComponents: { type: [String], default: [] },
exclusions:         { type: [String], default: [] },

// Notes
clientNotes: { type: String, default: '' },

// Versioning
versionNumber: { type: Number, default: 1 },
changeNote:    { type: String, default: '' },

// Add index:
QuotationSchema.index({ createdBy: 1 })
QuotationSchema.index({ status: 1 })
```

---

### 1.4 Invoice Model — Updated Schema
**File:** `src/models/Invoice.js`
**Changes:** Added `paymentScheduleStageId`

```js
// Add one field to existing InvoiceSchema:

paymentScheduleStageId: { type: mongoose.Schema.Types.ObjectId, default: null },
// Links this invoice to a specific stage in the project's PaymentSchedule.
// Null if invoice was not created against a payment schedule.
// When invoice is marked paid → that stage's status auto-updates to 'paid'.
```

---

### 1.5 PaymentSchedule Model — Restructured
**File:** `src/models/PaymentSchedule.js`
**Changes:** Breaking restructure — one schedule per project, stages replace payments array.

```js
const mongoose = require('mongoose')
const { PAYMENT_AMOUNT_TYPES, PAYMENT_STAGE_STATUSES } = require('../config/constants')

const StageSchema = new mongoose.Schema({
  stageName:  { type: String, required: true },
  amount:     { type: Number, required: true },
  amountType: { type: String, enum: PAYMENT_AMOUNT_TYPES, required: true },
  dueDate:    { type: Date, default: null },
  status:     { type: String, enum: PAYMENT_STAGE_STATUSES, default: 'pending' },
  invoiceId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  paidAt:     { type: Date, default: null },
  paidBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: true })

const PaymentScheduleSchema = new mongoose.Schema({
  leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
  customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  stages:      { type: [StageSchema], default: [] },
  totalAmount: { type: Number, required: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

PaymentScheduleSchema.index({ leadId: 1 })
PaymentScheduleSchema.index({ customerId: 1 })

module.exports = mongoose.model('PaymentSchedule', PaymentScheduleSchema)
```

---

### 1.6 FollowUp Model — Updated Schema
**File:** `src/models/FollowUp.js`
**Changes:** Added `modeOfContact`

```js
// Add one field to existing FollowUpSchema:
modeOfContact: { type: String, enum: ['call', 'email', 'meeting'], default: 'call' },
```

---

### 1.7 POOrder Model — Updated Schema
**File:** `src/models/POOrder.js`
**Changes:** Added `assignedTo` for Plant panel

```js
// Add one field to existing POOrderSchema:
assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
// Set by admin after approval. Plant panel reads this to pick up the order.

// Add index:
POOrderSchema.index({ assignedTo: 1 })
```

---

### 1.8 Building Model — New
**File:** `src/models/Building.js`

```js
const mongoose = require('mongoose')
const { BUILDING_STATUSES } = require('../config/constants')

const BuildingSchema = new mongoose.Schema({
  leadId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
  customerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  quotationId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
  buildingNumber: { type: Number, required: true },
  status:         { type: String, enum: BUILDING_STATUSES, default: 'pending' },
  createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

BuildingSchema.index({ leadId: 1, buildingNumber: 1 }, { unique: true })
BuildingSchema.index({ leadId: 1 })
BuildingSchema.index({ customerId: 1 })

module.exports = mongoose.model('Building', BuildingSchema)
```

---

### 1.9 ProjectBudget Model — New
**File:** `src/models/ProjectBudget.js`

```js
const mongoose = require('mongoose')

const ProjectBudgetSchema = new mongoose.Schema({
  leadId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true },
  materialBudget:   { type: Number, default: 0 },
  logisticBudget:   { type: Number, default: 0 },
  productionBudget: { type: Number, default: 0 },
  shipperBudget:    { type: Number, default: 0 },
  otherCost:        { type: Number, default: 0 },
  totalBudget:      { type: Number, default: 0 }, // AUTO: sum of all 5 fields
  createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

ProjectBudgetSchema.index({ leadId: 1 })
module.exports = mongoose.model('ProjectBudget', ProjectBudgetSchema)
```

---

### 1.10 AIScriptSession Model — New
**File:** `src/models/AIScriptSession.js`

```js
const mongoose = require('mongoose')

const AIScriptSessionSchema = new mongoose.Schema({
  salesEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leadId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  messages: [{
    role:      { type: String, enum: ['user', 'assistant'], required: true },
    content:   { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

AIScriptSessionSchema.index({ salesEmployeeId: 1, createdAt: -1 })
AIScriptSessionSchema.index({ leadId: 1 })
module.exports = mongoose.model('AIScriptSession', AIScriptSessionSchema)
```

---

### 1.11 New Utility — generateQuoteNumber.js
**File:** `src/utils/generateQuoteNumber.js`

```js
const Quotation = require('../models/Quotation')

const generateQuoteNumber = async () => {
  const last = await Quotation.findOne({}, { quoteNumber: 1 }).sort({ createdAt: -1 }).lean()
  if (!last?.quoteNumber) return 'QUO-0001'
  const next = parseInt(last.quoteNumber.split('-')[1], 10) + 1
  return `QUO-${String(next).padStart(4, '0')}`
}

module.exports = generateQuoteNumber
```

---

## PART 2 — SALES PANEL APIs

---

### Dashboard

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | GET | `/api/sales/dashboard/stats` | Returns `totalLeads, leadsClosed, followUpPending, escalationsPending`. Extend existing — add 3 new fields |
| `[NEW]` | GET | `/api/sales/dashboard/conversion-funnel` | Funnel counts per lifecycle stage group |
| `[NEW]` | GET | `/api/sales/dashboard/performance-trend` | Line graph — tabs: customers/revenue, range: 7d/30d/3m |
| `[NEW]` | GET | `/api/sales/dashboard/today-tasks` | Follow-ups due today + new leads today + pending escalations |

**All support:** `?startDate=&endDate=` scoped to `req.user._id`

`GET /api/sales/dashboard/stats`
```
Response: { totalLeads, leadsClosed, followUpPending, escalationsPending }
```

`GET /api/sales/dashboard/conversion-funnel`
```
Response: { newLeads, contacted, inPipeline, closedWon }
Stage mapping:
  newLeads  → initial_contact
  contacted → requirements_gathered
  inPipeline→ proposal_sent + negotiation
  closedWon → CLOSED_STAGES
```

`GET /api/sales/dashboard/performance-trend`
```
Query:    ?tab=customers|revenue  ?range=7d|30d|3m
Response: { data: [{ date, value }], percentageChange, rangeLabel }
  customers tab → new customers per day
  revenue tab   → paid invoice totals per day (paidAt)
percentageChange = ((currentPeriod - prevPeriod) / prevPeriod) × 100
```

`GET /api/sales/dashboard/today-tasks`
```
Response: {
  followUpsToday:    [{ _id, followUpDate, notes, priority, leadId:{projectName}, customerId:{firstName} }]
  newLeadsToday:     [{ _id, projectName, buildingType, lifecycleStatus, customerId:{firstName} }]
  pendingEscalations:[{ _id, note, status, createdAt, leadId:{projectName} }]
  summary:           { totalTasks, followUpsCount, newLeadsCount, escalationsCount }
}
```

---

### Leads — List Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | GET | `/api/sales/leads` | Add search, nextFollowUp, projectName to existing |
| `[NEW]` | POST | `/api/sales/leads` | Create new lead (find-or-create customer) |
| `[NEW]` | POST | `/api/sales/leads/import` | CSV import |
| `[NEW]` | GET | `/api/sales/leads/export` | CSV download |
| `[NEW]` | GET | `/api/sales/leads/stats` | Stat cards for leads page |
| `[NEW]` | GET | `/api/sales/leads/scored` | Leads sorted by AI score |
| `[NEW]` | GET | `/api/sales/leads/escalated` | Leads with active escalations |

> ⚠️ All static routes (`/stats`, `/scored`, `/export`, `/escalated`, `/import`) MUST be registered before `/:leadId` in the route file.

`GET /api/sales/leads`
```
Query:    ?search= ?lifecycleStatus= ?buildingType= ?isQuoteReady= ?startDate= ?endDate= ?page= ?limit=
Response: {
  leads: [{
    _id, projectName, customerId:{firstName,email},
    lifecycleStatus, quoteValue, leadScoring:{score},
    buildingType, location,
    nextFollowUp: { followUpDate, notes, priority } | null
  }],
  total, page, limit
}
Note: nextFollowUp = nearest pending FollowUp for each lead. Batch in Promise.all.
```

`GET /api/sales/leads/stats`
```
Response: { totalLeads, leadsClosed, followUpPending, escalationsPending }
```

`POST /api/sales/leads`
```
Body (required *): projectName*, customerEmail*, buildingType*, location*,
                   customerName, customerPhone, customerCountryCode, roofStyle, width, length, height
Logic: find Customer by email → if not found, create new Customer
Response: { lead, customer, isNewCustomer: Boolean }
```

`POST /api/sales/leads/import`
```
Body:     { csv: string }
CSV cols: projectName*, customerName*, customerEmail*, customerPhone*,
          buildingType*, location*, roofStyle, width, length, height
Response: { imported, skipped, errors: [{ row, reason }] }
Note: never abort on row failure — collect errors, continue batch
```

`GET /api/sales/leads/export`
```
Query:    same filters as GET /api/sales/leads
Response: CSV file download — Content-Disposition: attachment
Columns:  projectName, customerId, customerName, customerEmail,
          location, buildingType, lifecycleStatus, quoteValue, createdAt
```

`GET /api/sales/leads/scored`
```
Query:    ?page= ?limit=
Response: { leads: [{ _id, projectName, customerId:{firstName}, lifecycleStatus,
                       quoteValue, leadScoring:{score,projectSize,budgetSignals,
                       timeline,decisionMaker,projectClarity} }], total }
```

`GET /api/sales/leads/escalated`
```
Query:    ?status=pending|resolved  ?page= ?limit=
Response: { leads: [{ _id, projectName, lifecycleStatus, quoteValue,
                       customerId:{firstName,email},
                       escalation:{_id,note,status,createdAt} }], total }
```

---

### Lead — Detail Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | GET | `/api/sales/leads/:leadId/detail` | Single call, returns all sections |
| `[EXISTS]` | PUT | `/api/sales/leads/:leadId/lifecycle` | Update lifecycle stage |
| `[NEW]` | PUT | `/api/sales/leads/:leadId` | Edit basic lead fields |
| `[NEW]` | POST | `/api/sales/leads/:leadId/activity` | Add manual activity log |
| `[EXISTS]` | POST | `/api/sales/leads/:leadId/escalate` | Raise escalation |
| `[EXISTS]` | POST | `/api/sales/leads/:leadId/po-order` | Raise PO order |
| `[NEW]` | POST | `/api/sales/leads/:leadId/buildings` | Create N building documents |
| `[NEW]` | GET | `/api/sales/leads/:leadId/buildings` | List buildings for this lead |
| `[EXISTS]` | POST | `/api/invoices` | Create invoice |
| `[EXISTS]` | PUT | `/api/invoices/:invoiceId/mark-paid` | Mark invoice paid |
| `[EXISTS]` | POST | `/api/sales/followups` | Create follow-up |
| `[EXISTS]` | PUT | `/api/sales/followups/:followUpId/complete` | Complete follow-up |
| `[NEW]` | POST | `/api/uploads/leads/:leadId/agreement` | Upload agreement file |

`GET /api/sales/leads/:leadId/detail`
```
Response: {
  lead:          all Lead fields
  customer:      { _id, customerId, firstName, email, phone, company, location }
  rfq:           { aiQuoteData, aiContextSummary }
  quotations:    [ all versions desc, latest has isLatest:true ]
  auditLog:      [ AuditLog where leadId, type ≠ 'activity', sorted asc ]
  activityLog:   [ AuditLog where leadId, type = 'activity', sorted asc ]
  followUps:     [ all FollowUps for lead, sorted followUpDate asc ]
  payments:      { invoices:[...], totalPaid, totalPending, totalInvoices }
  buildings:     [ Building docs sorted buildingNumber asc ]
  budget:        { materialBudget, logisticBudget, productionBudget, shipperBudget,
                   otherCost, totalBudget, expectedProfit } | null
  recentMessages:[ last 20 chat messages ]
  shipments:     []  ← placeholder, Plant panel fills later
}
Note: expectedProfit = lead.quoteValue - budget.totalBudget
```

`PUT /api/sales/leads/:leadId`
```
Guard:  lead.assignedSales must equal req.user._id
Body:   projectName, buildingType, location, roofStyle, width, length, height, notes
        (only these fields — no lifecycle, no assignedSales, no PO fields)
Response: { lead }
```

`POST /api/sales/leads/:leadId/activity`
```
Body:     { activityType: call|email|meeting|note, notes, outcome: positive|neutral|negative|no_response }
Action:   writes AuditLog entry with type='activity', action='activity.logged'
Response: { message: 'Activity logged' }
```

`POST /api/sales/leads/:leadId/buildings`
```
Body:   { numberOfBuildings: Number (min 1), quotationId }
Guard:  return 400 if buildings already exist for this lead
Action: update Lead.numberOfBuildings, create N Building documents
Response 201: { buildings, numberOfBuildings }
```

`GET /api/sales/leads/:leadId/buildings`
```
Response: { buildings: [{ _id, buildingNumber, status, quotationId, createdAt }], total }
```

---

### Quotation Form

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | POST | `/api/quotations` | Add all new fields + server-side auto-calculations |
| `[CHANGE]` | PUT | `/api/quotations/:quotationId` | Add new fields + auto-increment versionNumber |
| `[EXISTS]` | POST | `/api/quotations/:quotationId/send` | Send to customer |
| `[EXISTS]` | GET | `/api/leads/:leadId/quotations` | All versions for a lead |

`POST /api/quotations`
```
Body (new fields added):
  quoteNumber         ← NEVER accept from client — server generates via generateQuoteNumber()
  proposalDate, validity, preparedBy, assignedSalesperson, margin
  leftEaveHeight, rightEaveHeight, roofSlope
  frameType, endwallType, girtType, purlinType, bracingType
  roofPanel, wallPanelType, roofColor, wallColor, trimColor, baseAngle
  insulation: [{ insulationType, thickness, material }]
  shippingCost, deliveryType, shippingIncluded
  materialCost, freightCost, markupPercent
  doors: [{ doorCategory, doorType, size, qty, notes }]
  includedComponents: [string], exclusions: [string]
  clientNotes, changeNote

Server auto-calculates (never trust client values):
  totalArea   = width × length
  totalCOGS   = materialCost + freightCost
  markupValue = totalCOGS × markupPercent / 100
  finalPrice  = totalCOGS + markupValue
  psf         = finalPrice / totalArea
```

`PUT /api/quotations/:quotationId`
```
Same fields as POST (except quoteNumber — never editable)
Auto-increments versionNumber on every save
Re-runs all auto-calculations if width/length/materialCost/freightCost/markupPercent changed
```

---

### Follow-up Overview Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[EXISTS]` | GET | `/api/sales/followups/stats` | Total, upcoming, completed, overdue |
| `[EXISTS]` | GET | `/api/sales/followups/upcoming` | Calendar list |
| `[NEW]` | GET | `/api/sales/followups/trend` | Line graph — created vs completed |
| `[NEW]` | GET | `/api/sales/followups/response-rate` | Breakdown by platform |
| `[CHANGE]` | POST | `/api/sales/followups` | Add modeOfContact to body |
| `[EXISTS]` | PUT | `/api/sales/followups/:followUpId/complete` | Mark done |

`GET /api/sales/followups/trend`
```
Query:    ?range=7d|30d|3m
Response: { data: [{ date, created, completed }] }
```

`GET /api/sales/followups/response-rate`
```
Query:    ?startDate= ?endDate=
Response: { breakdown: [{ platform, total, responded, rate }] }
Source:   AuditLog type='activity', grouped by metadata.activityType
          responded = entries where metadata.outcome ≠ 'no_response'
```

`POST /api/sales/followups`
```
Body: { leadId*, customerId*, followUpDate*, modeOfContact: call|email|meeting*, notes, priority }
```

---

### Communication Timeline Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/sales/followups/communication-timeline` | All activity logs across own leads |

```
Query:    ?leadId= ?activityType= ?startDate= ?endDate= ?page= ?limit=
Response: { entries: [{ _id, type, action, leadId:{projectName},
                         customerId:{firstName}, performedBy:{name}|null,
                         metadata, createdAt }], total }
```

---

### AI Script Generator Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/sales/followups/ai-script` | Previous sessions for this salesperson |
| `[NEW]` | POST | `/api/sales/followups/ai-script` | Chat message — calls Anthropic, stores in AIScriptSession |

`GET /api/sales/followups/ai-script`
```
Response: { sessions: [{ _id, leadId:{projectName}, messages:[{role,content,timestamp}], createdAt }] }
```

`POST /api/sales/followups/ai-script`
```
Body:     { messages: [{ role: user|assistant, content }], leadId }
Action:   inject lead context into Anthropic system prompt
          call claude-sonnet-4-20250514
          upsert AIScriptSession (find by salesEmployeeId + leadId)
          append user message + AI reply to session.messages
Response: { reply: string, sessionId }
```

---

### Lead Scoring Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/sales/leads/scored` | Leads sorted by AI score desc |

*(defined in Leads section above)*

---

### My Quotations Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/sales/quotations` | All quotations by this salesperson |

```
Query:    ?status= ?startDate= ?endDate= ?search= ?page= ?limit=
Filter:   createdBy = req.user._id
Response: { quotations: [{ _id, quoteNumber, versionNumber, status, finalPrice,
                             leadId:{projectName}, customerId:{firstName,email},
                             createdAt, sentAt }], total, page, limit }
```

---

### My PO Orders Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | GET | `/api/sales/po-orders` | Renamed from `/leads/po-orders` |

```
Query:    ?status=pending|approved|rejected ?startDate= ?endDate= ?page= ?limit=
Filter:   raisedBy = req.user._id
Response: { orders: [{ _id, poNumber, status, adminNotes, leadId:{projectName},
                        customerId:{firstName}, quotationId, invoiceId, createdAt }], total }
```

---

### Customers — List Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/sales/customers/stats` | Stat cards scoped to own customers |
| `[NEW]` | GET | `/api/sales/customers` | List own customers with search |

`GET /api/sales/customers/stats`
```
Response: { total, active, newThisMonth, returning }
Scope:    customers from leads where assignedSales = req.user._id
```

`GET /api/sales/customers`
```
Query:    ?search= (firstName, email, customerId string)  ?page= ?limit=
Scope:    customers from own leads only
Response: { customers: [{ _id, customerId, firstName, email, phone,
                            source, isActive, totalProjects }], total }
```

---

### Customer — Detail Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/sales/customers/:customerId` | Customer info + financials |
| `[NEW]` | GET | `/api/sales/customers/:customerId/projects` | Projects list |
| `[NEW]` | POST | `/api/sales/customers/:customerId/projects` | Create new project |

`GET /api/sales/customers/:customerId`
```
Guard:    customerId must belong to own leads — 403 if not
Response: {
  customer:   { _id, customerId, firstName, email, phone, isActive, source, createdAt }
  financials: { totalPaid, pendingPayment, totalInvoices, revenueGenerated }
}
```

`GET /api/sales/customers/:customerId/projects`
```
Guard:    customerId must belong to own leads
Response: { projects: [{ _id, projectName, numberOfBuildings, lifecycleStatus,
                           quoteValue, budget:{totalBudget,expectedProfit}|null,
                           createdAt }], total }
```

`POST /api/sales/customers/:customerId/projects`
```
Body:   { projectName*, buildingType*, location*, roofStyle, width, length, height }
Action: Lead.create with assignedSales = req.user._id, source = 'manual'
        customerId auto-filled from URL param
Response 201: { lead }
```

---

## PART 3 — ADMIN PANEL APIs

---

### Customers — List Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[NEW]` | GET | `/api/admin/customers/stats` | System-wide customer + project stat cards |
| `[CHANGE]` | GET | `/api/admin/customers` | Add customerId to search, add totalProjects per row |
| `[NEW]` | POST | `/api/admin/customers` | Create customer + lead in one call |
| `[EXISTS]` | POST | `/api/admin/customers/:customerId/leads` | Create lead for existing customer |

`GET /api/admin/customers/stats`
```
Response: { totalCustomers, activeCustomers, totalProjects,
            projectsInExecution, projectsNotAssigned, completedProjects }
```

`GET /api/admin/customers`
```
Query:    ?search= (firstName, email, customerId string)  ?isActive=  ?page= ?limit=
Response: { customers: [{ _id, customerId, firstName, email, phone, isActive, totalProjects }], total }
Change:   add customerId to search $or array
```

`POST /api/admin/customers`
```
Body (required *): firstName*, email*, phone*, buildingType*, location*, projectName*
                   countryCode, assignedSales (optional)
Guard:  return 400 if email already exists
Action: create Customer (generateCustomerId) → create Lead linked to customer
Response 201: { customer, lead }
```

---

### Customer — Detail Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[EXISTS]` | GET | `/api/admin/customers/:customerId` | Customer info + financials |
| `[NEW]` | GET | `/api/admin/customers/:customerId/projects` | Projects list with budget |

`GET /api/admin/customers/:customerId/projects`
```
Response: { projects: [{ _id, projectName, numberOfBuildings, lifecycleStatus,
                           assignedSales:{name}, quoteValue, isTerminated,
                           budget:{totalBudget,expectedProfit}|null, createdAt }], total }
```

---

### Project — Detail Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | GET | `/api/admin/leads/:leadId/detail` | Extend: add auditLog, activityLog, buildings, budget, meetings |
| `[NEW]` | POST | `/api/admin/leads/:leadId/budget` | Create or update project budget |
| `[NEW]` | GET | `/api/admin/leads/:leadId/budget` | Get project budget |
| `[EXISTS]` | POST | `/api/admin/meetings` | Create meeting |
| `[EXISTS]` | PUT | `/api/admin/meetings/:meetingId/complete` | Mark complete |
| `[EXISTS]` | PUT | `/api/admin/meetings/:meetingId` | Edit / reschedule |
| `[NEW]` | PUT | `/api/admin/leads/:leadId/terminate` | Terminate project |

`GET /api/admin/leads/:leadId/detail`
```
Response: {
  lead:          all Lead fields including isTerminated
  customer:      Customer object
  assignedSales: full User object
  quotations:    [ all versions, latest flagged isLatest:true ]
  auditLog:      [ AuditLog where leadId, type ≠ 'activity', sorted asc ]
  activityLog:   [ AuditLog where leadId, type = 'activity', sorted asc ]
  followUps:     [ all FollowUps sorted asc ]
  payments:      { invoices:[...], totalPaid, totalPending, totalInvoices }
  buildings:     [ Building docs sorted buildingNumber asc ]
  meetings:      [ Meeting docs for this lead sorted meetingTime asc ]
  agreement:     document URL | null
  budget:        { materialBudget, logisticBudget, productionBudget, shipperBudget,
                   otherCost, totalBudget, expectedProfit } | null
  recentMessages:[ last 20 ]
  bom:           []  ← Plant panel
  drawings:      []  ← Plant panel
  shopperFiles:  []  ← Plant panel
  shipments:     []  ← Plant panel
}
```

`POST /api/admin/leads/:leadId/budget`
```
Body:     { materialBudget, logisticBudget, productionBudget, shipperBudget, otherCost }
Action:   findOneAndUpdate with upsert:true on { leadId }
          server calculates totalBudget = sum of all 5 fields
          expectedProfit = lead.quoteValue - totalBudget
Response: { budget: { ...all fields, totalBudget, expectedProfit } }
```

`GET /api/admin/leads/:leadId/budget`
```
Response: { budget: { ...all fields, totalBudget, expectedProfit } | null }
```

`PUT /api/admin/leads/:leadId/terminate`
```
Body:     { reason* }
Action:   lead.isTerminated=true, lead.terminationReason=reason, lead.terminatedAt=now
Response: { lead }
```

---

### Leads & Follow-ups Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[EXISTS]` | GET | `/api/admin/leads/stats` | System-wide lead stats |
| `[CHANGE]` | GET | `/api/admin/leads` | Add budget/expectedProfit to each lead row |
| `[NEW]` | GET | `/api/admin/leads/ai-handled` | Leads still with AI, not assigned |
| `[NEW]` | GET | `/api/admin/leads/signed-contracts` | Leads with agreement uploaded |
| `[NEW]` | GET | `/api/admin/leads/terminated` | All terminated projects |
| `[EXISTS]` | GET | `/api/admin/escalations` | All escalations |
| `[EXISTS]` | PUT | `/api/admin/leads/:leadId/assign` | Assign lead to employee |
| `[EXISTS]` | PUT | `/api/admin/escalations/:escalationId/assign` | Resolve + reassign |

`GET /api/admin/leads`
```
Query:    ?search= ?lifecycleStatus= ?assignedSales= ?isHandedToSales= ?isTerminated= ?page= ?limit=
Change:   add budget:{totalBudget,expectedProfit}|null to each lead in response
```

`GET /api/admin/leads/ai-handled`
```
Filter:   isHandedToSales:false, assignedSales:null
Response: { leads: [{ _id, customerId:{firstName,email}, buildingType,
                        location, lifecycleStatus, leadScoring:{score}, createdAt }], total }
```

`GET /api/admin/leads/signed-contracts`
```
Filter:   leads where documents array contains type='contract'
Response: { contracts: [{ _id, projectName, customerId:{firstName},
                           agreementUploadedAt, assignedSales:{name}, lifecycleStatus }], total }
```

`GET /api/admin/leads/terminated`
```
Filter:   isTerminated: true
Response: { projects: [{ _id, projectName, customerId:{firstName},
                          assignedSales:{name}, terminatedAt,
                          terminationReason, lifecycleStatus }], total }
```

---

### PO Orders Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[EXISTS]` | GET | `/api/admin/po-orders` | All PO orders |
| `[EXISTS]` | PUT | `/api/admin/po-orders/:poOrderId/status` | Approve or reject |
| `[NEW]` | PUT | `/api/admin/po-orders/:poOrderId/assign` | Assign to panel user after approval |

`PUT /api/admin/po-orders/:poOrderId/assign`
```
Guard:    order.status must be 'approved' — 400 if not
Body:     { assignedTo: userId }
Response: { order }
Note:     Plant panel reads POOrder.assignedTo to pick up approved orders
```

---

### Employee Management Page

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[EXISTS]` | GET | `/api/admin/employees/stats` | Stat cards |
| `[EXISTS]` | GET | `/api/admin/employees` | All employees with performance summary |
| `[EXISTS]` | POST | `/api/admin/employees` | Create employee |
| `[EXISTS]` | GET | `/api/admin/employees/:userId` | Detail + stats + leads |
| `[EXISTS]` | PUT | `/api/admin/employees/:userId` | Edit / deactivate |
| `[EXISTS]` | GET | `/api/admin/employees/:userId/timeline` | Activity timeline from AuditLog |

---

### Admin Dashboard

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[EXISTS]` | GET | `/api/admin/dashboard/lead-stats` | System-wide lead stats |
| `[EXISTS]` | GET | `/api/admin/dashboard/customer-stats` | System-wide customer stats |
| `[EXISTS]` | GET | `/api/admin/dashboard/ai-vs-human` | AI vs human handled leads |
| `[NEW]` | GET | `/api/admin/dashboard/performance-trend` | Same as sales trend but system-wide |

---

## PART 4 — COMMON APIs

### Invoices

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | POST | `/api/invoices` | Add paymentScheduleStageId — auto-updates stage on create |
| `[EXISTS]` | GET | `/api/invoices/:invoiceId` | Get invoice + payment schedule |
| `[EXISTS]` | PUT | `/api/invoices/:invoiceId` | Edit (draft only) |
| `[EXISTS]` | POST | `/api/invoices/:invoiceId/send` | Email to customer |
| `[CHANGE]` | PUT | `/api/invoices/:invoiceId/mark-paid` | Auto-updates linked payment schedule stage |
| `[EXISTS]` | GET | `/api/leads/:leadId/invoices` | All invoices for a lead |

`POST /api/invoices`
```
Body (new field): paymentScheduleStageId (optional)
Logic change:
  if paymentScheduleStageId provided:
    find PaymentSchedule where stages._id = paymentScheduleStageId
    update that stage: invoiceId = invoice._id, status = 'invoiced'
    set invoice.paymentScheduleStageId on the saved invoice
```

`PUT /api/invoices/:invoiceId/mark-paid`
```
Logic change:
  after marking invoice paid:
  if invoice.paymentScheduleStageId exists:
    find PaymentSchedule where stages._id = invoice.paymentScheduleStageId
    update that stage: status='paid', paidAt=now, paidBy=req.user._id
```

---

### Payment Schedules

| Status | Method | Endpoint | Description |
|---|---|---|---|
| `[CHANGE]` | POST | `/api/payment-schedules` | Now project-scoped — takes leadId + stages[] |
| `[CHANGE]` | GET | `/api/payment-schedules/lead/:leadId` | Get by leadId (was `/invoice/:invoiceId`) |
| `[REMOVED]` | ~~PUT~~ | ~~`/api/payment-schedules/:id/payments/:pid`~~ | Removed — marking handled via invoice |

`POST /api/payment-schedules`
```
Body:
  leadId*
  stages*: [{ stageName*, amount*, amountType: percentage|fixed*, dueDate }]
  totalAmount*
Validation:
  all percentage → must sum to 100
  all fixed      → must sum to totalAmount
  mixed types    → return 400
Response: { schedule }
```

`GET /api/payment-schedules/lead/:leadId`
```
Response: { schedule: { leadId, customerId, stages:[...], totalAmount } | null }
```

---

## PART 5 — BREAKING CHANGES (communicate to frontend team)

| # | Change | Old | New |
|---|---|---|---|
| 1 | Lifecycle stage renamed | `requirements_collected` | `requirements_gathered` |
| 2 | Lifecycle stage replaced | `delivered` | `converted_to_po` + `sent_to_admin` |
| 3 | Sales PO orders route | `GET /api/sales/leads/po-orders` | `GET /api/sales/po-orders` |
| 4 | Lead detail response | single `activityLog` array | separate `auditLog[]` + `activityLog[]` |
| 5 | Lead detail response | no budget field | `budget: {..., expectedProfit} | null` |
| 6 | Lead detail response | no buildings array | `buildings: [...]` |
| 7 | Payment schedule endpoint | `POST` takes `invoiceId` | `POST` takes `leadId` |
| 8 | Payment schedule GET | `/invoice/:invoiceId` | `/lead/:leadId` |
| 9 | Payment item marking | dedicated endpoint | automatic via invoice mark-paid |

---

## PART 6 — FUTURE PLAN (do not implement now)

The following are empty arrays returned as placeholders in lead detail responses.
When these panels are built, fill them in:

| Placeholder | Filled by | Panel |
|---|---|---|
| `shipments: []` | Shipment docs | Plant Panel |
| `bom: []` | BOM documents | Plant Panel |
| `drawings: []` | Drawing documents | Plant Panel |
| `shopperFiles: []` | Shipper validation files | Plant Panel |
| `Building.status` beyond `pending` | Plant panel drives transitions | Plant Panel |
| `POOrder.assignedTo` | Already stored — Plant reads it | Plant Panel |
| Additional lifecycle stages after `sent_to_admin` | New stages | Construction/Plant Panel |