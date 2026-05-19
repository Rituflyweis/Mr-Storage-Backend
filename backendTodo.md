# Backend TODO

---

## Part 1 — DB Schema Changes

### 1A — `Lead.js` — Add 4 Fields

```js
// After lifecycleStatus field:
lifecycleHistory: [
  {
    stage: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  }
],

// After height field:
numDoors: { type: Number, default: null },
numWindows: { type: Number, default: null },
numInsulation: { type: Number, default: null },
```

### 1B — `Customer.js` — Add `lastName`

```js
// After firstName:
lastName: { type: String, default: '' },
```

---

## Part 2 — Extend (Existing Files, Specific Fixes)

### E1 — `raisePOOrder` — Remove body, backend derives everything

**File:** `src/controllers/sales/lead.controller.js` → `raisePOOrder`

**Problem:** Still takes `{ poNumber, invoiceId, quotationId }` from frontend body.

Add imports at top of file if missing:

```js
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
```

Replace entire function body:

```js
exports.raisePOOrder = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  if (lead.isRaisedToPO) return badRequest(res, 'PO already raised for this lead')

  const latestInvoice = await Invoice.findOne({ leadId }).sort({ createdAt: -1 }).lean()
  if (!latestInvoice) return badRequest(res, 'No invoice found. Create an invoice first.')

  const latestQuotation = await Quotation.findOne({
    leadId, status: { $in: ['sent', 'accepted', 'draft'] }
  }).sort({ versionNumber: -1 }).lean()
  if (!latestQuotation) return badRequest(res, 'No quotation found. Create a quotation first.')

  const order = await POOrder.create({
    leadId,
    customerId: lead.customerId,
    raisedBy: req.user._id,
    invoiceId: latestInvoice._id,
    quotationId: latestQuotation._id,
    poNumber: latestInvoice.poNumber,
  })

  lead.isRaisedToPO = true
  lead.lifecycleStatus = 'converted_to_po'
  lead.lifecycleHistory.push({ stage: 'converted_to_po', changedAt: new Date(), changedBy: req.user._id })
  await lead.save()

  if (global.io) global.io.of('/admin').to('admin_room').emit('new_po_order', { order, leadId })

  await auditService.log({
    type: 'po', action: AUDIT_ACTIONS.LEAD_PO_RAISED,
    leadId, customerId: lead.customerId, performedBy: req.user._id,
    metadata: { poNumber: latestInvoice.poNumber }
  })

  return success(res, { order }, 'PO Order raised successfully')
})
```

Update route validator — remove all body validators for this route:

```js
// Remove: body('poNumber').notEmpty(), body('invoiceId').notEmpty(), body('quotationId').notEmpty()
// After: router.post('/:leadId/po-order', ctrl.raisePOOrder)
```

---

### E2 — `createBuildings` — Remove `quotationId` from body

**File:** `src/controllers/sales/lead.controller.js` → `createBuildings`

Replace:

```js
const { numberOfBuildings, quotationId } = req.body
```

With:

```js
const { numberOfBuildings } = req.body
const latestQuotation = await Quotation.findOne({ leadId }).sort({ versionNumber: -1, createdAt: -1 }).lean()
const quotationId = latestQuotation?._id || null
```

> Add `Quotation` import at top if missing.

---

### E3 — `updateLifecycle` — Push to `lifecycleHistory`

**File:** `src/controllers/sales/lead.controller.js` → `updateLifecycle`

Find:

```js
lead.lifecycleStatus = lifecycleStatus
await lead.save()
```

Replace:

```js
lead.lifecycleStatus = lifecycleStatus
lead.lifecycleHistory.push({ stage: lifecycleStatus, changedAt: new Date(), changedBy: req.user._id })
await lead.save()
```

---

### E4 — `createFollowUp` (sales) — Derive `customerId` from Lead

**File:** `src/controllers/sales/followup.controller.js` → `createFollowUp`

Add import:

```js
const Lead = require('../../models/Lead')
```

Replace:

```js
const { leadId, customerId, followUpDate, modeOfContact, notes, priority } = req.body
```

With:

```js
const { leadId, followUpDate, modeOfContact, notes, priority } = req.body
const lead = await Lead.findById(leadId).select('customerId').lean()
if (!lead) return notFound(res, 'Lead not found')
const customerId = lead.customerId
```

Remove `body('customerId').notEmpty()` from route validator.

---

### E5 — `createFollowUp` (admin) — Derive `customerId` from Lead

**File:** `src/controllers/admin/followup.controller.js` → `createFollowUp`

Same fix as E4. `customerId` → derive from `Lead.findById(leadId).customerId`. `assignedTo` → keep in body (admin specifies which employee).

Replace:

```js
const { leadId, customerId, assignedTo, followUpDate, notes, priority } = req.body
```

With:

```js
const { leadId, assignedTo, followUpDate, notes, priority } = req.body
const lead = await Lead.findById(leadId).select('customerId').lean()
if (!lead) return notFound(res, 'Lead not found')
const customerId = lead.customerId
```

Remove `body('customerId').notEmpty()` from route validator.

---

### E6 — `createQuotation` — Derive `customerId` from Lead

**File:** `src/controllers/common/quotation.controller.js` → `createQuotation`

After the lead access check (lead is already fetched), add:

```js
delete payload.customerId       // strip whatever frontend sent
payload.customerId = lead.customerId  // use the real one from DB
```

---

### E7 — `sendQuotation` — Push to `lifecycleHistory`

**File:** `src/controllers/common/quotation.controller.js` → `sendQuotation`

Find:

```js
await Lead.findByIdAndUpdate(quotation.leadId, { lifecycleStatus: 'proposal_sent' })
```

Replace:

```js
await Lead.findByIdAndUpdate(quotation.leadId, {
  lifecycleStatus: 'proposal_sent',
  $push: { lifecycleHistory: { stage: 'proposal_sent', changedAt: new Date(), changedBy: req.user._id } }
})
```

---

### E8 — `createPaymentSchedule` — `totalAmount` Optional

**File:** `src/controllers/common/payment.controller.js` → `createSchedule`

Replace:

```js
const { leadId, stages, totalAmount } = req.body
const lead = await Lead.findById(leadId)
if (!lead) return notFound(res, 'Lead not found')
```

With:

```js
const { leadId, stages } = req.body
const lead = await Lead.findById(leadId)
if (!lead) return notFound(res, 'Lead not found')
const totalAmount = (req.body.totalAmount != null) ? req.body.totalAmount : lead.quoteValue
```

---

### E9 — `updatePOStatus` (admin) — Set `lifecycleStatus` on Approval

**File:** `src/controllers/admin/po.controller.js` → `updatePOStatus`

Find:

```js
await Lead.findByIdAndUpdate(order.leadId, { poStatus: status })
```

Replace:

```js
const leadUpdate = { poStatus: status }
if (status === 'approved') {
  leadUpdate.lifecycleStatus = 'sent_to_admin'
  leadUpdate.$push = { lifecycleHistory: { stage: 'sent_to_admin', changedAt: new Date(), changedBy: req.user._id } }
}
await Lead.findByIdAndUpdate(order.leadId, leadUpdate)
```

---

### E10 — `assignPOOrder` (admin) — Transition Buildings + Socket

**File:** `src/controllers/admin/po.controller.js` → `assignPOOrder`

Add import at top:

```js
const Building = require('../../models/Building')
```

Find end of function:

```js
order.assignedTo = assignedTo
await order.save()
return success(res, { order })
```

Replace:

```js
order.assignedTo = assignedTo
await order.save()

await Building.updateMany({ leadId: order.leadId }, { status: 'drawing_pending' })

if (global.io) {
  const lead = await Lead.findById(order.leadId).select('projectName').lean()
  global.io.of('/admin').to(`user:${assignedTo}`).emit('project_assigned', {
    leadId: order.leadId, poOrderId: order._id, projectName: lead?.projectName || ''
  })
}

return success(res, { order })
```

---

### E11 — `createEmployee` — Auto-generate Password, Email Credentials

**File:** `src/controllers/admin/employee.controller.js` → `createEmployee`

**Problem:** Currently takes password from request body — admin shouldn't set the employee's password.

Replace:

```js
const { name, email, password, phone, role } = req.body
// ...
const hashed = await bcrypt.hash(password, 12)
```

With:

```js
const { name, email, phone, role } = req.body
const tempPassword = Math.random().toString(36).slice(-6) +
  Math.random().toString(36).slice(-4).toUpperCase()
const hashed = await bcrypt.hash(tempPassword, 12)
```

Then after `User.create(...)`, add:

```js
await mailer.sendEmployeeCredentials({
  toEmail: user.email, name: user.name, role: user.role, tempPassword
})
```

Add mailer import at top if missing:

```js
const mailer = require('../../services/email/mailer')
```

Remove `body('password').isLength({ min: 6 })` from route validator.

---

### E12 — `getAllEscalations` — Add Pagination + Employee Filter

**File:** `src/controllers/admin/escalation.controller.js` → `getAllEscalations`

Replace entire function:

```js
exports.getAllEscalations = asyncHandler(async (req, res) => {
  const { status, assignedSales, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const filter = { ...dateFilter }

  if (status) filter.status = status
  if (assignedSales) {
    const leadIds = await Lead.find({ assignedSales }).distinct('_id')
    filter.leadId = { $in: leadIds }
  }

  const [escalations, total] = await Promise.all([
    Escalation.find(filter)
      .populate('leadId', 'projectName lifecycleStatus')
      .populate('customerId', 'firstName lastName email')
      .populate('raisedBy', 'name email')
      .populate('resolvedAssignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit).limit(Number(limit)).lean(),
    Escalation.countDocuments(filter)
  ])

  return success(res, { escalations, total, page: Number(page), limit: Number(limit) })
})
```

---

### E13 — `getAllEmployees` — Add Search Filter

**File:** `src/controllers/admin/employee.controller.js` → `getAllEmployees`

Find:

```js
const filter = { ...dateFilter }
if (role) filter.role = role
if (isActive !== undefined) filter.isActive = isActive === 'true'
```

Add after:

```js
const { search } = req.query
if (search) {
  filter.$or = [
    { name: { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
  ]
}
```

---

### E14 — `createLead` (sales) — Strict Customer Check + New Fields

**File:** `src/controllers/sales/lead.controller.js` → `createLead`

**a) Replace the find-or-create customer block with strict check:**

```js
const existingByEmail = await Customer.findOne({ email: normalizedEmail }).lean()
if (existingByEmail) {
  return badRequest(res, 'A customer with this email already exists.', {
    existingCustomer: {
      _id: existingByEmail._id, customerId: existingByEmail.customerId,
      firstName: existingByEmail.firstName, lastName: existingByEmail.lastName || '',
      email: existingByEmail.email,
    }
  })
}

const incomingFirst = (req.body.firstName || normalizedCustomerName || '').trim()
const incomingLast = (req.body.lastName || '').trim()

if (incomingFirst && incomingLast) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existingByName = await Customer.findOne({
    firstName: { $regex: new RegExp(`^${esc(incomingFirst)}$`, 'i') },
    lastName:  { $regex: new RegExp(`^${esc(incomingLast)}$`, 'i') },
  }).lean()
  if (existingByName) {
    return badRequest(res, 'A customer with this name already exists.', {
      existingCustomer: {
        _id: existingByName._id, customerId: existingByName.customerId,
        firstName: existingByName.firstName, lastName: existingByName.lastName || '',
        email: existingByName.email,
      }
    })
  }
}

const custId = await generateCustomerId()
const hashed = await bcrypt.hash(normalizedCustomerPhone, 12)
const customer = await Customer.create({
  customerId: custId, firstName: incomingFirst, lastName: incomingLast,
  email: normalizedEmail,
  phone: { number: normalizedCustomerPhone, countryCode: normalizedCountryCode || '+1' },
  password: hashed, source: 'manual',
})
```

**b) Add new fields to `Lead.create()`:**

```js
numDoors: req.body.doors ? Number(req.body.doors) : null,
numWindows: req.body.windows ? Number(req.body.windows) : null,
numInsulation: req.body.insulation ? Number(req.body.insulation) : null,
lifecycleHistory: [{ stage: 'initial_contact', changedAt: new Date(), changedBy: req.user._id }],
```

**c) Update route validator:**

```js
body('lastName').optional({ checkFalsy: true }).trim(),
body('doors').optional().isNumeric(),
body('windows').optional().isNumeric(),
body('insulation').optional().isNumeric(),
```

---

## Part 3 — New (Build from Scratch)

### N1 — Resolve Escalation (without reassigning)

**File:** `src/controllers/admin/escalation.controller.js` — add function  
**File:** `src/routes/admin/escalation.routes.js` — add route

```js
// Controller:
exports.resolveEscalation = asyncHandler(async (req, res) => {
  const escalation = await Escalation.findById(req.params.escalationId)
  if (!escalation) return notFound(res, 'Escalation not found')

  escalation.status = 'resolved'
  escalation.resolvedBy = req.user._id
  escalation.resolvedAt = new Date()
  await escalation.save()

  await auditService.log({
    type: 'escalation', action: AUDIT_ACTIONS.ESCALATION_RESOLVED,
    leadId: escalation.leadId, performedBy: req.user._id,
    metadata: { escalationId: escalation._id, note: req.body.note || '' }
  })

  return success(res, { escalation }, 'Escalation resolved')
})

// Route:
router.put('/:escalationId/resolve', ctrl.resolveEscalation)
```

- **Request:** `PUT /api/admin/escalations/:id/resolve` — Body: `{ note: string }`
- **Response:** `{ escalation: { status: 'resolved', resolvedAt, resolvedBy } }`

---

### N2 — Admin Followups Full List (Paginated + Employee Filter)

**File:** `src/controllers/admin/followup.controller.js` — add function  
**File:** `src/routes/admin/followup.routes.js` — add route `GET /`

```js
exports.getAllFollowups = asyncHandler(async (req, res) => {
  const { employeeId, status, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const filter = { ...dateFilter }

  if (status === 'overdue') {
    filter.status = 'pending'
    filter.followUpDate = { $lt: new Date() }
  } else if (status) {
    filter.status = status
  }

  if (employeeId) filter.assignedTo = employeeId

  const [followups, total] = await Promise.all([
    FollowUp.find(filter)
      .populate('leadId', 'projectName')
      .populate('customerId', 'firstName lastName')
      .populate('assignedTo', 'name email')
      .sort({ followUpDate: 1 })
      .skip((page - 1) * limit).limit(Number(limit)).lean(),
    FollowUp.countDocuments(filter)
  ])

  const perEmployee = await FollowUp.aggregate([
    { $group: { _id: '$assignedTo', total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'emp' } },
    { $unwind: '$emp' },
    { $project: { employeeId: '$_id', name: '$emp.name', total: 1, completed: 1 } }
  ])

  return success(res, { followups, total, page: Number(page), limit: Number(limit), perEmployee })
})

// Route:
router.get('/', ctrl.getAllFollowups)
```

- **Request:** `GET /api/admin/followups?employeeId=&status=pending|completed|overdue&page=1&limit=20`
- **Response:**
```json
{
  "followups": [{ "_id": "...", "followUpDate": "...", "modeOfContact": "call",
    "leadId": { "projectName": "..." }, "customerId": { "firstName": "..." },
    "assignedTo": { "name": "John", "email": "..." } }],
  "total": 42, "page": 1, "limit": 20,
  "perEmployee": [{ "employeeId": "...", "name": "John", "total": 20, "completed": 15 }]
}
```

---

### N3 — Toggle Employee Status (Dedicated Endpoint)

**File:** `src/controllers/admin/employee.controller.js` — add function  
**File:** `src/routes/admin/employee.routes.js` — add route

```js
exports.toggleStatus = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.userId)
  if (!employee) return notFound(res, 'Employee not found')

  employee.isActive = !employee.isActive
  await employee.save()

  if (employee.role === 'sales') await roundRobinService.rebuildTracker()

  return success(res, { employee }, `Employee marked ${employee.isActive ? 'active' : 'inactive'}`)
})

// Route (add before /:userId):
router.patch('/:userId/toggle-status', ctrl.toggleStatus)
```

- **Request:** `PATCH /api/admin/employees/:userId/toggle-status` — No body
- **Response:** `{ employee: { isActive: false, ... } }`

---

### N4 — Reset Employee Password

**File:** `src/controllers/admin/employee.controller.js` — add function  
**File:** `src/routes/admin/employee.routes.js` — add route

```js
exports.resetPassword = asyncHandler(async (req, res) => {
  const employee = await User.findById(req.params.userId)
  if (!employee) return notFound(res, 'Employee not found')

  const tempPassword = Math.random().toString(36).slice(-6) +
    Math.random().toString(36).slice(-4).toUpperCase()
  employee.password = await bcrypt.hash(tempPassword, 12)
  await employee.save()

  await mailer.sendEmployeeCredentials({
    toEmail: employee.email, name: employee.name, role: employee.role, tempPassword
  })

  return success(res, {}, 'New credentials sent to employee email')
})

// Route:
router.post('/:userId/reset-password', ctrl.resetPassword)
```

- **Request:** `POST /api/admin/employees/:userId/reset-password` — No body
- **Response:** `{ message: 'New credentials sent to employee email' }`

---

### N5 — Financial Overview

**New file:** `src/controllers/admin/financial.controller.js`  
**New file:** `src/routes/admin/financial.routes.js`  
**Register in** `src/routes/admin/index.js`: `router.use('/financials', require('./financial.routes'))`

```js
const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const ProjectBudget = require('../../models/ProjectBudget')
const Customer = require('../../models/Customer')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')

exports.getOverview = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)
  const base = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}

  const [quotedAgg, invoicedAgg, paidAgg, budgetAgg] = await Promise.all([
    Lead.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$quoteValue' } } }]),
    Invoice.aggregate([{ $match: base }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Invoice.aggregate([{ $match: { ...base, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    ProjectBudget.aggregate([{ $group: { _id: null, material: { $sum: '$materialBudget' }, logistics: { $sum: '$logisticBudget' } } }]),
  ])

  const totalQuoted = quotedAgg[0]?.total || 0
  const totalInvoiced = invoicedAgg[0]?.total || 0
  const totalPaid = paidAgg[0]?.total || 0
  const totalMaterialCost = budgetAgg[0]?.material || 0
  const totalPending = totalInvoiced - totalPaid
  const overallMargin = totalPaid > 0 ? Math.round(((totalPaid - totalMaterialCost) / totalPaid) * 100) : 0

  return success(res, { totalQuoted, totalInvoiced, totalPaid, totalPending, totalMaterialCost, overallMargin })
})
```

- **Request:** `GET /api/admin/financials/overview?startDate=&endDate=`
- **Response:**
```json
{
  "totalQuoted": 1200000, "totalInvoiced": 850000,
  "totalPaid": 620000, "totalPending": 230000,
  "totalMaterialCost": 410000, "overallMargin": 34
}
```

---

### N6 — Financial Per-Project P&L

**Add to:** `src/controllers/admin/financial.controller.js`

```js
exports.getPerProject = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const base = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}

  const leads = await Lead.find({ ...base, quoteValue: { $gt: 0 } })
    .populate('customerId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(Number(limit)).lean()

  const projects = await Promise.all(leads.map(async (lead) => {
    const [invoiceAgg, budget] = await Promise.all([
      Invoice.aggregate([
        { $match: { leadId: lead._id } },
        { $group: { _id: null,
            totalInvoiced: { $sum: '$totalAmount' },
            totalPaid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$totalAmount', 0] } }
        }}
      ]),
      ProjectBudget.findOne({ leadId: lead._id }).lean()
    ])

    const totalInvoiced = invoiceAgg[0]?.totalInvoiced || 0
    const totalPaid = invoiceAgg[0]?.totalPaid || 0
    const materialBudget = budget?.materialBudget || 0
    const freightBudget = budget?.logisticBudget || 0
    const totalCost = materialBudget + freightBudget
    const netMargin = totalPaid - totalCost
    const marginPct = totalPaid > 0 ? Math.round((netMargin / totalPaid) * 100) : 0

    return {
      leadId: lead._id,
      projectName: lead.projectName,
      customerName: `${lead.customerId?.firstName || ''} ${lead.customerId?.lastName || ''}`.trim(),
      quoteValue: lead.quoteValue,
      totalInvoiced, totalPaid, materialBudget, freightBudget, totalCost, netMargin, marginPct
    }
  }))

  const total = await Lead.countDocuments({ ...base, quoteValue: { $gt: 0 } })
  return success(res, { projects, total, page: Number(page), limit: Number(limit) })
})
```

- **Request:** `GET /api/admin/financials/per-project?startDate=&endDate=&page=1&limit=20`

---

### N7 — Invoice Aging (Overdue Invoices)

**Add to:** `src/controllers/admin/financial.controller.js`

```js
exports.getInvoiceAging = asyncHandler(async (req, res) => {
  const now = new Date()

  const overdue = await Invoice.aggregate([
    { $match: { status: { $in: ['sent', 'overdue'] } } },
    { $addFields: { dueDate: { $add: ['$date', { $multiply: ['$daysToPay', 86400000] }] } } },
    { $match: { dueDate: { $lt: now } } },
    { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
    { $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'customer' } },
    { $lookup: { from: 'users', localField: 'lead.assignedSales', foreignField: '_id', as: 'sales' } },
    { $unwind: '$lead' }, { $unwind: '$customer' },
    { $project: {
        invoiceNumber: 1, totalAmount: 1, dueDate: 1,
        daysOverdue: { $floor: { $divide: [{ $subtract: [now, '$dueDate'] }, 86400000] } },
        customerName: { $concat: ['$customer.firstName', ' ', '$customer.lastName'] },
        projectName: '$lead.projectName',
        assignedSales: { $arrayElemAt: ['$sales.name', 0] }
    }},
    { $sort: { daysOverdue: -1 } }
  ])

  const totalOverdueAmount = overdue.reduce((s, i) => s + i.totalAmount, 0)
  return success(res, { overdue, totalOverdueAmount })
})
```

- **Request:** `GET /api/admin/financials/invoice-aging`

**Routes file** `src/routes/admin/financial.routes.js`:

```js
const router = require('express').Router()
const ctrl = require('../../controllers/admin/financial.controller')

router.get('/overview', ctrl.getOverview)
router.get('/per-project', ctrl.getPerProject)
router.get('/invoice-aging', ctrl.getInvoiceAging)

module.exports = router
```

---

## Part 4 — Missing (Should Have Been There)

### M1 — Admin BOM Approval

**File:** `src/controllers/admin/lead.controller.js` — add `approveBOM`  
**File:** `src/routes/admin/lead.routes.js` — add route before `/:leadId`

```js
exports.approveBOM = asyncHandler(async (req, res) => {
  const { leadId, buildingId } = req.params
  const { action, note } = req.body

  if (!['approved', 'rejected'].includes(action))
    return badRequest(res, 'action must be approved or rejected')
  if (action === 'rejected' && !note)
    return badRequest(res, 'note is required when rejecting')

  const building = await Building.findOneAndUpdate(
    { _id: buildingId, leadId },
    { status: action === 'approved' ? 'bom_approved' : 'bom_pending' },
    { new: true }
  )
  if (!building) return notFound(res, 'Building not found')

  const po = await POOrder.findOne({ leadId, status: 'approved' }).select('assignedTo').lean()
  if (po?.assignedTo && global.io) {
    global.io.of('/admin').to(`user:${po.assignedTo}`).emit('bom_review_complete', {
      leadId, buildingId, buildingNumber: building.buildingNumber, action, note
    })
  }

  await auditService.log({
    type: 'lead', action: action === 'approved' ? 'bom.approved' : 'bom.rejected',
    leadId, performedBy: req.user._id,
    metadata: { buildingId, buildingNumber: building.buildingNumber, note }
  })

  return success(res, { building })
})

// Route (add before /:leadId routes):
router.put('/:leadId/buildings/:buildingId/approve-bom',
  [body('action').isIn(['approved', 'rejected'])], validate, ctrl.approveBOM)
```

- **Request:** `PUT /api/admin/leads/:leadId/buildings/:buildingId/approve-bom`
- **Body:** `{ action: "approved" | "rejected", note: "string (required if rejected)" }`
- **Response:** `{ building: { status: "bom_approved", buildingNumber: 2 } }`

---

## Part 5 — Mailer: Add `sendEmployeeCredentials`

**File:** `src/services/email/mailer.js` — add function:

```js
exports.sendEmployeeCredentials = async ({ toEmail, name, role, tempPassword }) => {
  const template = loadTemplate('employee-credentials')
  const html = fillTemplate(template, {
    EMPLOYEE_NAME: name,
    ROLE: role.charAt(0).toUpperCase() + role.slice(1),
    EMAIL: toEmail,
    TEMP_PASSWORD: tempPassword,
    LOGIN_URL: process.env.APP_URL + '/login',
  })

  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
    to: toEmail,
    subject: 'Your CRM Login Credentials',
    html,
  })
}
```

**New file:** `src/services/email/templates/employee-credentials.html`  
Copy structure of any existing template. Key placeholders: `{{EMPLOYEE_NAME}}`, `{{ROLE}}`, `{{EMAIL}}`, `{{TEMP_PASSWORD}}`, `{{LOGIN_URL}}`.

---

## Summary Table

| # | Type | File | What |
|---|------|------|------|
| 1A | DB | `models/Lead.js` | Add `lifecycleHistory[]`, `numDoors`, `numWindows`, `numInsulation` |
| 1B | DB | `models/Customer.js` | Add `lastName` |
| E1 | EXTEND | `sales/lead.controller.js` | `raisePOOrder` — remove body, derive from DB |
| E2 | EXTEND | `sales/lead.controller.js` | `createBuildings` — remove `quotationId` from body |
| E3 | EXTEND | `sales/lead.controller.js` | `updateLifecycle` — push `lifecycleHistory` |
| E4 | EXTEND | `sales/followup.controller.js` | `createFollowUp` — derive `customerId` |
| E5 | EXTEND | `admin/followup.controller.js` | `createFollowUp` — derive `customerId` |
| E6 | EXTEND | `common/quotation.controller.js` | `createQuotation` — derive `customerId` |
| E7 | EXTEND | `common/quotation.controller.js` | `sendQuotation` — push `lifecycleHistory` |
| E8 | EXTEND | `common/payment.controller.js` | `createSchedule` — `totalAmount` optional |
| E9 | EXTEND | `admin/po.controller.js` | `updatePOStatus` — set `lifecycleStatus` |
| E10 | EXTEND | `admin/po.controller.js` | `assignPOOrder` — `Building.updateMany` + socket |
| E11 | EXTEND | `admin/employee.controller.js` | `createEmployee` — auto-generate + email password |
| E12 | EXTEND | `admin/escalation.controller.js` | `getAllEscalations` — add pagination + filter |
| E13 | EXTEND | `admin/employee.controller.js` | `getAllEmployees` — add search filter |
| E14 | EXTEND | `sales/lead.controller.js` | `createLead` — strict customer check + new fields |
| N1 | NEW | `admin/escalation.controller.js` | `resolveEscalation` (standalone) |
| N2 | NEW | `admin/followup.controller.js` | `getAllFollowups` (paginated + employee filter) |
| N3 | NEW | `admin/employee.controller.js` | `toggleStatus` (dedicated endpoint) |
| N4 | NEW | `admin/employee.controller.js` | `resetPassword` |
| N5 | NEW | `admin/financial.controller.js` | `getOverview` |
| N6 | NEW | `admin/financial.controller.js` | `getPerProject` |
| N7 | NEW | `admin/financial.controller.js` | `getInvoiceAging` |
| M1 | MISSING | `admin/lead.controller.js` | `approveBOM` |
| — | MAILER | `services/email/mailer.js` | `sendEmployeeCredentials` + HTML template |