const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Message = require('../../models/Message')
const Quotation = require('../../models/Quotation')
const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const FollowUp = require('../../models/FollowUp')
const Escalation = require('../../models/Escalation')
const POOrder = require('../../models/POOrder')
const AuditLog = require('../../models/AuditLog')
const Building = require('../../models/Building')
const ProjectBudget = require('../../models/ProjectBudget')
const auditService = require('../../services/audit.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES, CLOSED_STAGES } = require('../../config/constants')
const { parse } = require('csv-parse/sync')
const bcrypt = require('bcryptjs')

const guardLead = async (leadId, salesId) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', status: 404 }
  if (String(lead.assignedSales) !== String(salesId)) return { error: 'Access denied', status: 403 }
  return { lead }
}

exports.getLeads = asyncHandler(async (req, res) => {
  const { search, buildingType, lifecycleStatus, isQuoteReady, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const filter = { assignedSales: req.user._id, ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (search && search.trim()) {
    const term = search.trim()
    const regex = new RegExp(term, 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [{ firstName: regex }, { email: regex }, { customerId: regex }],
    }).distinct('_id')
    filter.$or = [
      { projectName: regex },
      { buildingType: regex },
      { location: regex },
      { customerId: { $in: matchingCustomerIds } },
    ]
  }

  const skip = (parsedPage - 1) * parsedLimit
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .select('_id projectName customerId lifecycleStatus quoteValue leadScoring buildingType location')
      .populate({ path: 'customerId', select: 'firstName email' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const leadIds = leads.map(l => l._id)
  const nextFollowUpByLeadId = new Map()
  if (leadIds.length > 0) {
    const pendingFollowUps = await FollowUp.find({ leadId: { $in: leadIds }, status: 'pending' })
      .select('_id leadId followUpDate notes priority')
      .sort({ followUpDate: 1 })
      .lean()
    for (const fu of pendingFollowUps) {
      const key = String(fu.leadId)
      if (!nextFollowUpByLeadId.has(key)) {
        nextFollowUpByLeadId.set(key, { _id: fu._id, followUpDate: fu.followUpDate, notes: fu.notes, priority: fu.priority })
      }
    }
  }

  const normalizedLeads = leads.map(lead => ({
    _id: lead._id,
    projectName: lead.projectName || '',
    customerId: lead.customerId ? { _id: lead.customerId._id, firstName: lead.customerId.firstName || '', email: lead.customerId.email || '' } : null,
    lifecycleStatus: lead.lifecycleStatus,
    quoteValue: lead.quoteValue || 0,
    leadScoring: { score: lead.leadScoring?.score || 0 },
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    nextFollowUp: nextFollowUpByLeadId.get(String(lead._id)) || null,
  }))

  return success(res, { leads: normalizedLeads, total, page: parsedPage, limit: parsedLimit })
})

exports.getLeadsStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const dateFilter = buildDateFilter(req.query)

  const [totalLeads, leadsClosed, followUpPending, escalationsPending] = await Promise.all([
    Lead.countDocuments({ assignedSales: salesId, ...dateFilter }),
    Lead.countDocuments({ assignedSales: salesId, lifecycleStatus: { $in: CLOSED_STAGES }, ...dateFilter }),
    FollowUp.countDocuments({ assignedTo: salesId, status: 'pending', ...dateFilter }),
    Escalation.countDocuments({ raisedBy: salesId, status: 'pending', ...dateFilter }),
  ])

  return success(res, { totalLeads, leadsClosed, followUpPending, escalationsPending })
})

exports.createLead = asyncHandler(async (req, res) => {
  const {
    projectName, customerEmail, buildingType, location,
    customerName, customerPhone, customerCountryCode,
    roofStyle, width, length, height,
  } = req.body

  if (!projectName || !customerEmail || !buildingType || !location) {
    return badRequest(res, 'projectName, customerEmail, buildingType, location are required')
  }

  let customer = await Customer.findOne({ email: customerEmail.toLowerCase().trim() })
  let isNewCustomer = false

  if (!customer) {
    if (!customerName || !customerPhone) {
      return badRequest(res, 'customerName and customerPhone required for new customer')
    }
    const custId = await generateCustomerId()
    const hashed = await bcrypt.hash(customerPhone.trim(), 12)
    customer = await Customer.create({
      customerId: custId,
      firstName: customerName.trim(),
      email: customerEmail.toLowerCase().trim(),
      phone: { number: customerPhone.trim(), countryCode: customerCountryCode || '' },
      password: hashed,
      source: 'manual',
    })
    isNewCustomer = true
    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.CUSTOMER_CREATED,
      customerId: customer._id,
      performedBy: req.user._id,
      metadata: { email: customer.email },
    })
  }

  const lead = await Lead.create({
    customerId: customer._id,
    projectName,
    buildingType,
    location,
    roofStyle: roofStyle || '',
    width: width || null,
    length: length || null,
    source: 'manual',
    assignedSales: req.user._id,
    isHandedToSales: true,
    assigningHistory: [{ employeeId: req.user._id, method: 'manual', assignedBy: req.user._id, assignedAt: new Date() }],
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { source: 'manual', projectName },
  })

  return created(res, { lead, customer, isNewCustomer })
})

exports.importLeads = asyncHandler(async (req, res) => {
  if (!req.body.csv) return badRequest(res, 'CSV data required in body.csv')

  let records
  try {
    records = parse(req.body.csv, { columns: true, skip_empty_lines: true, trim: true })
  } catch {
    return badRequest(res, 'Invalid CSV format')
  }

  const results = { imported: 0, skipped: 0, errors: [] }

  for (let i = 0; i < records.length; i++) {
    const row = records[i]
    try {
      const { projectName, customerName, customerEmail, customerPhone, buildingType, location, roofStyle, width, length, height } = row
      if (!projectName || !customerEmail || !buildingType || !location) {
        results.skipped++
        continue
      }

      let customer = await Customer.findOne({ email: customerEmail.toLowerCase().trim() })
      if (!customer) {
        if (!customerName || !customerPhone) { results.skipped++; continue }
        const custId = await generateCustomerId()
        const hashed = await bcrypt.hash(customerPhone.trim(), 12)
        customer = await Customer.create({
          customerId: custId,
          firstName: customerName.trim(),
          email: customerEmail.toLowerCase().trim(),
          phone: { number: customerPhone.trim(), countryCode: '' },
          password: hashed,
          source: 'import',
        })
      }

      await Lead.create({
        customerId: customer._id,
        projectName,
        buildingType,
        location,
        roofStyle: roofStyle || '',
        width: width ? Number(width) : null,
        length: length ? Number(length) : null,
        source: 'import',
        assignedSales: req.user._id,
        isHandedToSales: true,
        assigningHistory: [{ employeeId: req.user._id, method: 'manual', assignedBy: req.user._id, assignedAt: new Date() }],
      })
      results.imported++
    } catch (err) {
      results.errors.push({ row: i + 2, reason: err.message })
    }
  }

  return success(res, results)
})

exports.exportLeads = asyncHandler(async (req, res) => {
  const { search, lifecycleStatus, buildingType, isQuoteReady } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { assignedSales: req.user._id, ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const ids = await Customer.find({ $or: [{ firstName: regex }, { email: regex }] }).distinct('_id')
    filter.$or = [{ projectName: regex }, { customerId: { $in: ids } }]
  }

  const leads = await Lead.find(filter)
    .populate({ path: 'customerId', select: 'firstName email customerId' })
    .sort({ createdAt: -1 })
    .lean()

  const header = 'projectName,customerId,customerName,customerEmail,location,buildingType,lifecycleStatus,quoteValue,createdAt'
  const rows = leads.map(l => [
    `"${(l.projectName || '').replace(/"/g, '""')}"`,
    l.customerId?.customerId || '',
    `"${(l.customerId?.firstName || '').replace(/"/g, '""')}"`,
    l.customerId?.email || '',
    `"${(l.location || '').replace(/"/g, '""')}"`,
    l.buildingType || '',
    l.lifecycleStatus || '',
    l.quoteValue || 0,
    l.createdAt ? new Date(l.createdAt).toISOString() : '',
  ].join(','))

  const csv = [header, ...rows].join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"')
  return res.send(csv)
})

exports.getScoredLeads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const filter = { assignedSales: req.user._id }
  const skip = (parsedPage - 1) * parsedLimit

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .select('_id projectName customerId lifecycleStatus quoteValue leadScoring')
      .populate({ path: 'customerId', select: 'firstName' })
      .sort({ 'leadScoring.score': -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const result = leads.map(l => ({
    _id: l._id,
    projectName: l.projectName || '',
    customerId: l.customerId ? { _id: l.customerId._id, firstName: l.customerId.firstName } : null,
    lifecycleStatus: l.lifecycleStatus,
    quoteValue: l.quoteValue || 0,
    leadScoring: {
      score: l.leadScoring?.score || 0,
      projectSize: l.leadScoring?.scoreBreakdown?.projectSize || null,
      budgetSignals: l.leadScoring?.scoreBreakdown?.budgetSignals || null,
      timeline: l.leadScoring?.scoreBreakdown?.timeline || null,
      decisionMaker: l.leadScoring?.scoreBreakdown?.decisionMaker || null,
      projectClarity: l.leadScoring?.scoreBreakdown?.projectClarity || null,
    },
  }))

  return success(res, { leads: result, total })
})

exports.getEscalatedLeads = asyncHandler(async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const ownLeadIds = await Lead.find({ assignedSales: req.user._id }).distinct('_id')
  const skip = (parsedPage - 1) * parsedLimit

  const escalationFilter = { leadId: { $in: ownLeadIds } }
  if (status) escalationFilter.status = status

  const [escalations, total] = await Promise.all([
    Escalation.find(escalationFilter)
      .populate({ path: 'leadId', select: '_id projectName lifecycleStatus quoteValue customerId' })
      .populate({ path: 'customerId', select: 'firstName email' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Escalation.countDocuments(escalationFilter),
  ])

  const result = escalations.map(e => ({
    _id: e.leadId?._id,
    projectName: e.leadId?.projectName || '',
    lifecycleStatus: e.leadId?.lifecycleStatus || '',
    quoteValue: e.leadId?.quoteValue || 0,
    customerId: e.customerId ? { _id: e.customerId._id, firstName: e.customerId.firstName, email: e.customerId.email } : null,
    escalation: { _id: e._id, note: e.note, status: e.status, createdAt: e.createdAt },
  }))

  return success(res, { leads: result, total })
})

exports.getLeadDetail = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lead: guardedLead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const lead = await Lead.findById(leadId).lean()

  const [
    customer, quotations, auditLogs, activityLogs, followUps,
    invoices, buildings, budget, recentMessages,
  ] = await Promise.all([
    Customer.findById(lead.customerId).select('_id customerId firstName email phone company location').lean(),
    Quotation.find({ leadId }).sort({ versionNumber: -1, createdAt: -1 }).lean(),
    AuditLog.find({ leadId, type: { $ne: 'activity' } }).sort({ createdAt: 1 }).lean(),
    AuditLog.find({ leadId, type: 'activity' }).sort({ createdAt: 1 }).lean(),
    FollowUp.find({ leadId }).sort({ followUpDate: 1 }).lean(),
    Invoice.find({ leadId }).populate('paidBy').sort({ createdAt: -1 }).lean(),
    Building.find({ leadId }).sort({ buildingNumber: 1 }).lean(),
    ProjectBudget.findOne({ leadId }).lean(),
    Message.find({ leadId }).sort({ createdAt: -1 }).limit(20).lean().then(m => m.reverse()),
  ])

  const flaggedQuotations = quotations.map((q, i) => ({ ...q, isLatest: i === 0 }))
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)
  const totalPending = invoices.filter(i => ['sent', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.totalAmount || 0), 0)

  const budgetOut = budget ? {
    materialBudget: budget.materialBudget,
    logisticBudget: budget.logisticBudget,
    productionBudget: budget.productionBudget,
    shipperBudget: budget.shipperBudget,
    otherCost: budget.otherCost,
    totalBudget: budget.totalBudget,
    expectedProfit: (lead.quoteValue || 0) - (budget.totalBudget || 0),
  } : null

  return success(res, {
    lead,
    customer,
    rfq: { aiQuoteData: lead.aiQuoteData, aiContextSummary: lead.aiContextSummary },
    quotations: flaggedQuotations,
    auditLog: auditLogs,
    activityLog: activityLogs,
    followUps,
    payments: { invoices, totalPaid, totalPending, totalInvoices: invoices.length },
    buildings,
    budget: budgetOut,
    recentMessages,
    shipments: [],
  })
})

exports.editLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const ALLOWED = ['projectName', 'buildingType', 'location', 'roofStyle', 'width', 'length', 'height', 'notes']
  ALLOWED.forEach(k => { if (req.body[k] !== undefined) lead[k] = req.body[k] })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_EDITED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: req.body,
  })

  return success(res, { lead })
})

exports.logActivity = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { activityType, notes, outcome } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const VALID_TYPES = ['call', 'email', 'meeting', 'note']
  const VALID_OUTCOMES = ['positive', 'neutral', 'negative', 'no_response']
  if (!VALID_TYPES.includes(activityType)) return badRequest(res, 'Invalid activityType')
  if (outcome && !VALID_OUTCOMES.includes(outcome)) return badRequest(res, 'Invalid outcome')

  await auditService.log({
    type: 'activity',
    action: AUDIT_ACTIONS.ACTIVITY_LOGGED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { activityType, notes: notes || '', outcome: outcome || null },
  })

  return success(res, { message: 'Activity logged' })
})

exports.createBuildings = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { numberOfBuildings, quotationId } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const num = parseInt(numberOfBuildings, 10)
  if (!num || num < 1) return badRequest(res, 'numberOfBuildings must be >= 1')

  const existingCount = await Building.countDocuments({ leadId })
  if (existingCount > 0) return badRequest(res, 'Buildings already exist for this lead')

  const buildingDocs = []
  for (let i = 1; i <= num; i++) {
    buildingDocs.push({
      leadId,
      customerId: lead.customerId,
      buildingNumber: i,
      quotationId: quotationId || null,
      createdBy: req.user._id,
    })
  }

  const buildings = await Building.insertMany(buildingDocs)

  lead.numberOfBuildings = num
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.BUILDINGS_CREATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { numberOfBuildings: num },
  })

  return created(res, { buildings, numberOfBuildings: num })
})

exports.getBuildings = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const buildings = await Building.find({ leadId }).sort({ buildingNumber: 1 }).lean()
  return success(res, { buildings, total: buildings.length })
})

exports.updateLifecycle = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lifecycleStatus } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  if (!LIFECYCLE_STAGES.includes(lifecycleStatus)) return badRequest(res, 'Invalid lifecycle status')

  lead.lifecycleStatus = lifecycleStatus
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_LIFECYCLE_UPDATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { lifecycleStatus },
  })

  return success(res, { lead })
})

exports.escalateLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { note } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const escalation = await Escalation.create({
    leadId,
    customerId: lead.customerId,
    raisedBy: req.user._id,
    note,
  })

  await auditService.log({
    type: 'escalation',
    action: AUDIT_ACTIONS.LEAD_ESCALATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { note },
  })

  if (global.io) {
    global.io.of('/admin').to('admin_room').emit('new_escalation', { escalation, leadId, raisedBy: req.user.name })
  }

  return success(res, { escalation }, 'Lead escalated successfully')
})

exports.raisePOOrder = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { poNumber, invoiceId, quotationId } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const order = await POOrder.create({
    leadId,
    customerId: lead.customerId,
    raisedBy: req.user._id,
    invoiceId,
    quotationId,
    poNumber,
  })

  lead.isRaisedToPO = true
  await lead.save()

  await auditService.log({
    type: 'po',
    action: AUDIT_ACTIONS.LEAD_PO_RAISED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { poNumber },
  })

  if (global.io) {
    global.io.of('/admin').to('admin_room').emit('new_po_order', { order, leadId })
  }

  return success(res, { order }, 'PO Order raised successfully')
})

exports.getMyPOOrders = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const filter = { raisedBy: req.user._id, ...dateFilter }
  if (status) filter.status = status

  const skip = (parsedPage - 1) * parsedLimit
  const [orders, total] = await Promise.all([
    POOrder.find(filter)
      .populate({ path: 'leadId', select: 'projectName' })
      .populate({ path: 'customerId', select: 'firstName' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    POOrder.countDocuments(filter),
  ])

  return success(res, { orders, total, page: parsedPage, limit: parsedLimit })
})
