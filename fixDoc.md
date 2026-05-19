Fix Document — CRM Sales & Admin Panel

Scope: Sales + Admin panel only. Apply all fixes below in order.

⸻

FIX 1 — Gap #1: PO approval doesn’t set lifecycleStatus = sent_to_admin

File: src/controllers/admin/po.controller.js → updatePOStatus

Find this line:

await Lead.findByIdAndUpdate(order.leadId, { poStatus: status })

Replace with:

const leadUpdate = { poStatus: status }
if (status === 'approved') {
  leadUpdate.lifecycleStatus = 'sent_to_admin'
  leadUpdate.$push = {
    lifecycleHistory: { stage: 'sent_to_admin', changedAt: new Date(), changedBy: req.user._id }
  }
}
await Lead.findByIdAndUpdate(order.leadId, leadUpdate)

⸻

FIX 2 — Gap #2: PO assignment doesn’t transition buildings or notify Plant

File: src/controllers/admin/po.controller.js → assignPOOrder

Add Building import at top of file:

const Building = require('../../models/Building')

Find the current function body which ends with:

order.assignedTo = assignedTo
await order.save()
return success(res, { order })

Replace with:

order.assignedTo = assignedTo
await order.save()
// Transition all buildings for this project to drawing_pending
await Building.updateMany({ leadId: order.leadId }, { status: 'drawing_pending' })
// Notify the assigned plant user via socket
if (global.io) {
  const lead = await Lead.findById(order.leadId).select('projectName').lean()
  global.io.of('/admin').to(`user:${assignedTo}`).emit('project_assigned', {
    leadId: order.leadId,
    poOrderId: order._id,
    projectName: lead?.projectName || '',
  })
}
return success(res, { order })

⸻

FIX 3 — Gap #3: Raising a PO doesn’t set lifecycleStatus = converted_to_po

File: src/controllers/sales/lead.controller.js → raisePOOrder

Find:

lead.isRaisedToPO = true
await lead.save()

Replace with:

lead.isRaisedToPO = true
lead.lifecycleStatus = 'converted_to_po'
lead.lifecycleHistory.push({ stage: 'converted_to_po', changedAt: new Date(), changedBy: req.user._id })
await lead.save()

⸻

FIX 4 — Gap #4: createBuildings accepts any quotationId without ownership check

File: src/controllers/sales/lead.controller.js → createBuildings

Add after the existing buildings count check:

// Verify quotationId belongs to this lead
if (quotationId) {
  const Quotation = require('../../models/Quotation')
  const quotation = await Quotation.findOne({ _id: quotationId, leadId }).lean()
  if (!quotation) return badRequest(res, 'quotationId does not belong to this lead')
}

⸻

FIX 5 — Customer portal activation gate (Decision 2B)

Portal is only accessible after 30% payment confirmed AND PO raised.

File: src/controllers/customerAuth.controller.js

In the login handler, after verifying credentials, add before issuing the token:

// Check if any of this customer's leads have reached 30% payment + PO raised
const leads = await Lead.find({ customerId: customer._id }).lean()
const hasActivatedProject = leads.some(l => l.isRaisedToPO === true)
// Check 30% payment: find any invoice for this customer that is paid
// and represents at least 30% of the quote value of its lead
let thirtyPctPaid = false
if (hasActivatedProject) {
  const Invoice = require('../models/Invoice')
  const paidInvoices = await Invoice.find({ customerId: customer._id, status: 'paid' }).lean()
  for (const inv of paidInvoices) {
    const relatedLead = leads.find(l => String(l._id) === String(inv.leadId))
    if (relatedLead && relatedLead.quoteValue > 0) {
      const pct = (inv.totalAmount / relatedLead.quoteValue) * 100
      if (pct >= 30) {
        thirtyPctPaid = true
        break
      }
    }
  }
}
if (!hasActivatedProject || !thirtyPctPaid) {
  return res.status(403).json({
    success: false,
    message: 'Your project portal is not yet active. It will be available after your 30% deposit is confirmed.',
  })
}

⸻

FIX 6 — Drawing rejected status (Decision 1B)

When customer rejects a drawing:

* Building.status → drawing_rejected
* stays there until Plant re-uploads

When Plant re-uploads:

* Building.status → drawing_uploaded

Customer review

File: src/controllers/customerPortal.controller.js

When action = 'rejected':

building.status = 'drawing_rejected'

When action = 'approved':

building.status = 'drawing_approved'

Plant upload

File: src/controllers/plant/project.controller.js

After saving the new drawing version:

building.status = 'drawing_uploaded'
await building.save()

⸻

FIX 7 — Lead Model: Add lifecycleHistory, lastName for Customer, new lead fields

7A — Lead Model: Add lifecycleHistory

File: src/models/Lead.js

Add to LeadSchema after the existing lifecycleStatus field:

lifecycleHistory: [
  {
    stage: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // changedBy: null means system/AI triggered the change
  },
],

Also add:

numDoors: { type: Number, default: null },
numWindows: { type: Number, default: null },
numInsulation: { type: Number, default: null },

Migration note:

Existing documents will have an empty lifecycleHistory: [] — MongoDB handles this gracefully.

7B — Customer Model: Add lastName

File: src/models/Customer.js

Add after firstName:

lastName: { type: String, default: '' },

⸻

FIX 8 — Update all lifecycle transition points to push to lifecycleHistory

Every place lifecycleStatus is changed in the codebase, also push to lifecycleHistory.

8A — sendQuotation advances lifecycle to proposal_sent

File: src/controllers/common/quotation.controller.js → sendQuotation

Find:

if (targetIdx > currentIdx) {
  await Lead.findByIdAndUpdate(quotation.leadId, { lifecycleStatus: 'proposal_sent' })
}

Replace with:

if (targetIdx > currentIdx) {
  await Lead.findByIdAndUpdate(quotation.leadId, {
    lifecycleStatus: 'proposal_sent',
    $push: {
      lifecycleHistory: {
        stage: 'proposal_sent',
        changedAt: new Date(),
        changedBy: req.user._id,
      },
    },
  })
}

8B — Sales updateLifecycle

File: src/controllers/sales/lead.controller.js → updateLifecycle

Find:

lead.lifecycleStatus = lifecycleStatus
await lead.save()

Replace with:

lead.lifecycleStatus = lifecycleStatus
lead.lifecycleHistory.push({
  stage: lifecycleStatus,
  changedAt: new Date(),
  changedBy: req.user._id,
})
await lead.save()

8C — AI/public lead creation sets initial_contact

File: public lead creation flow (public.controller.js or similar)

After Lead.create(...):

await Lead.findByIdAndUpdate(lead._id, {
  $push: {
    lifecycleHistory: {
      stage: 'initial_contact',
      changedAt: new Date(),
      changedBy: null,
    },
  },
})

Or pass directly:

lifecycleHistory: [
  {
    stage: 'initial_contact',
    changedAt: new Date(),
    changedBy: null,
  },
]

8D — All other lifecycle changes

Run:

grep -r "lifecycleStatus" src/controllers --include="*.js" -l

Review each file and add matching lifecycleHistory pushes.

⸻

FIX 9 — Add Lead Form: Behaviour Change for Sales createLead

Based on Figma screenshot.

Use fields:

* First Name
* Last Name
* Email
* Phone
* Lead Source
* Lead Status
* Estimated Value
* Priority
* Notes
* Width
* Length
* Height
* Roof Style
* Building Type
* Doors (count)
* Windows (count)
* Insulation (count)

Exclude:

* Company Name
* Job Title

New behaviour

1. If a customer with the same email exists → return 400 with existing customer
2. If a customer with the same firstName + lastName exists → return 400 with existing customer
3. Otherwise → create new customer → create lead

File: src/controllers/sales/lead.controller.js → createLead

Replace current customer lookup block with:

// ── Strict customer check — Add Lead form does not reuse existing customers ──
const existingByEmail = await Customer.findOne({ email: normalizedEmail }).lean()
if (existingByEmail) {
  return badRequest(res, 'A customer with this email already exists.', {
    existingCustomer: {
      _id: existingByEmail._id,
      customerId: existingByEmail.customerId,
      firstName: existingByEmail.firstName,
      lastName: existingByEmail.lastName || '',
      email: existingByEmail.email,
    },
  })
}
const incomingFirstName = pickNonEmpty(req.body.firstName, normalizedCustomerName)
const incomingLastName = (req.body.lastName || '').trim()
if (incomingFirstName && incomingLastName) {
  const existingByName = await Customer.findOne({
    firstName: { $regex: new RegExp(`^${escapeRegex(incomingFirstName)}$`, 'i') },
    lastName: { $regex: new RegExp(`^${escapeRegex(incomingLastName)}$`, 'i') },
  }).lean()
  if (existingByName) {
    return badRequest(res, 'A customer with this name already exists.', {
      existingCustomer: {
        _id: existingByName._id,
        customerId: existingByName.customerId,
        firstName: existingByName.firstName,
        lastName: existingByName.lastName || '',
        email: existingByName.email,
      },
    })
  }
}
// ── Create new customer ──
if (!incomingFirstName || !normalizedCustomerPhone) {
  return badRequest(res, 'First name and phone number are required for new customer')
}
const custId = await generateCustomerId()
const hashed = await bcrypt.hash(normalizedCustomerPhone, 12)
const customer = await Customer.create({
  customerId: custId,
  firstName: incomingFirstName,
  lastName: incomingLastName || '',
  email: normalizedEmail,
  phone: {
    number: normalizedCustomerPhone,
    countryCode: normalizedCountryCode,
  },
  password: hashed,
  source: 'manual',
})
await auditService.log({
  type: 'lead',
  action: AUDIT_ACTIONS.CUSTOMER_CREATED,
  customerId: customer._id,
  performedBy: req.user._id,
  metadata: { email: customer.email },
})

Then update Lead.create(...):

const lead = await Lead.create({
  customerId: customer._id,
  projectName: normalizedProjectName,
  buildingType: normalizedBuildingType,
  location: normalizedLocation,
  roofStyle: roofStyle || '',
  width: toNumberOrNull(width),
  length: toNumberOrNull(length),
  height: toNumberOrNull(height),
  numDoors: toNumberOrNull(req.body.doors),
  numWindows: toNumberOrNull(req.body.windows),
  numInsulation: toNumberOrNull(req.body.insulation),
  notes: pickNonEmpty(notes),
  quoteValue: toNumberOrNull(estimatedValue) || 0,
  source: 'manual',
  assignedSales: req.user._id,
  isHandedToSales: true,
  lifecycleHistory: [
    {
      stage: 'initial_contact',
      changedAt: new Date(),
      changedBy: req.user._id,
    },
  ],
  assigningHistory: [
    {
      employeeId: req.user._id,
      method: 'manual',
      assignedBy: req.user._id,
      assignedAt: new Date(),
    },
  ],
})

Also add firstName and lastName to request body destructuring.

⸻

FIX 10 — Body validation: add lastName and new fields

File: src/routes/sales/lead.routes.js

Add validators:

body('lastName').optional({ checkFalsy: true }).trim(),
body('doors').optional({ checkFalsy: true }).isNumeric(),
body('windows').optional({ checkFalsy: true }).isNumeric(),
body('insulation').optional({ checkFalsy: true }).isNumeric(),

⸻

FIX 11 — Mailer: Quotation template — pass new pricing fields

Status:

* Nodemailer is configured correctly
* HTML templates exist for quotation, invoice, and OTP
* Quotation template uses {{PLACEHOLDER}} syntax

Update sendQuotation

File: src/services/email/mailer.js → sendQuotation

Replace fillTemplate values with:

const html = fillTemplate(template, {
  CUSTOMER_NAME: customerName,
  BUILDING_TYPE: quotation.buildingType,
  QUOTE_NUMBER: quotation.quoteNumber || '',
  BASE_PRICE: quotation.basePrice?.toLocaleString() || '',
  FINAL_PRICE: quotation.finalPrice?.toLocaleString() || '',
  TOTAL_COGS: quotation.totalCOGS?.toLocaleString() || '',
  MARKUP_PERCENT: quotation.markupPercent || '',
  MARKUP_VALUE: quotation.markupValue?.toLocaleString() || '',
  PSF: quotation.psf?.toFixed(2) || '',
  CURRENCY: quotation.currency || 'USD',
  LOCATION: quotation.location || '',
  VALID_TILL: quotation.validTill
    ? new Date(quotation.validTill).toDateString()
    : 'N/A',
  COMPANY_NAME: quotation.companyName || '',
  ESTIMATED_DELIVERY: quotation.estimatedDelivery || '',
  SPECIAL_NOTE: quotation.specialNote || '',
  CLIENT_NOTES: quotation.clientNotes || '',
  PAYMENT_TERMS: quotation.paymentTerms || '',
  PROPOSAL_DATE: quotation.proposalDate
    ? new Date(quotation.proposalDate).toDateString()
    : '',
  PREPARED_BY: quotation.preparedBy || '',
  WIDTH: quotation.width || '',
  LENGTH: quotation.length || '',
  HEIGHT: quotation.height || '',
  ROOF_STYLE: quotation.roofStyle || '',
})

Update quotation HTML template

File: src/services/email/templates/quotation.html

Add inside .body div after the existing detail table:

<div class="price-box">
  <div class="label">Quote Reference: {{QUOTE_NUMBER}}</div>
  <div class="price">{{CURRENCY}} {{FINAL_PRICE}}</div>
  <div style="font-size:12px;color:#888;margin-top:4px">
    Price per sq ft: {{PSF}} | Valid until: {{VALID_TILL}}
  </div>
</div>
<table class="detail-table">
  <tr><td>Building Type</td><td>{{BUILDING_TYPE}}</td></tr>
  <tr><td>Location</td><td>{{LOCATION}}</td></tr>
  <tr><td>Dimensions</td><td>{{WIDTH}} × {{LENGTH}} × {{HEIGHT}} ft</td></tr>
  <tr><td>Roof Style</td><td>{{ROOF_STYLE}}</td></tr>
  <tr><td>Material + Freight Cost</td><td>{{CURRENCY}} {{TOTAL_COGS}}</td></tr>
  <tr><td>Markup ({{MARKUP_PERCENT}}%)</td><td>{{CURRENCY}} {{MARKUP_VALUE}}</td></tr>
  <tr><td>Estimated Delivery</td><td>{{ESTIMATED_DELIVERY}}</td></tr>
  <tr><td>Payment Terms</td><td>{{PAYMENT_TERMS}}</td></tr>
</table>
{{CLIENT_NOTES}}
{{SPECIAL_NOTE}}

⸻

FIX 12 — Lead detail: expose lifecycleHistory in response

File: src/controllers/sales/lead.controller.js → getLeadDetail

No controller change needed.

Since Lead.findById(leadId).lean() already returns the full lead object, lifecycleHistory will automatically appear once added to the schema.

Same for admin getLeadDetail.

⸻

SUMMARY CHECKLIST

Fix	File	Changes
Fix 1	admin/po.controller.js	updatePOStatus → add lifecycleStatus + lifecycleHistory push
Fix 2	admin/po.controller.js	assignPOOrder → add Building.updateMany + socket
Fix 3	sales/lead.controller.js	raisePOOrder → add lifecycleStatus + lifecycleHistory push
Fix 4	sales/lead.controller.js	createBuildings → add quotationId ownership check
Fix 5	customerAuth.controller.js	Login gate: 30% payment + PO raised check
Fix 6	customerPortal.controller.js	drawing review → set building.status correctly
Fix 7A	models/Lead.js	Add lifecycleHistory, numDoors, numWindows, numInsulation
Fix 7B	models/Customer.js	Add lastName field
Fix 8A	common/quotation.controller.js	sendQuotation → push proposal_sent to lifecycleHistory
Fix 8B	sales/lead.controller.js	updateLifecycle → push to lifecycleHistory
Fix 8C	public.controller.js	lead creation → push initial_contact to lifecycleHistory
Fix 8D	All controllers	grep lifecycleStatus changes and add pushes
Fix 9	sales/lead.controller.js	strict customer check, lastName, no company info
Fix 10	sales/lead.routes.js	Add validator for lastName, doors, windows, insulation
Fix 11	services/email/mailer.js	sendQuotation → pass new pricing fields
Fix 11	services/email/templates/quotation.html	Add pricing section placeholders
Fix 12	No change needed	lifecycleHistory auto-included in lead response