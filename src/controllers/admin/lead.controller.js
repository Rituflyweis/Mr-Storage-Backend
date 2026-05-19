const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Message = require('../../models/Message')
const Quotation = require('../../models/Quotation')
const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const AuditLog = require('../../models/AuditLog')
const User = require('../../models/User')
const Building = require('../../models/Building')
const ProjectBudget = require('../../models/ProjectBudget')
const Meeting = require('../../models/Meeting')
const FollowUp = require('../../models/FollowUp')
const auditService = require('../../services/audit.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES } = require('../../config/constants')
const { parse } = require('csv-parse/sync')
const bcrypt = require('bcryptjs')
const { startOfDay, endOfDay } = require('date-fns')

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeProjectName = (value = '') => value.trim()
const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

exports.getLeadStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query)

  const [total, assigned, unassigned, unread] = await Promise.all([
    Lead.countDocuments(dateFilter),
    Lead.countDocuments({ ...dateFilter, assignedSales: { $ne: null } }),
    Lead.countDocuments({ ...dateFilter, assignedSales: null }),
    Message.countDocuments({ isRead: false, senderType: 'customer' }),
  ])

  return success(res, { total, assigned, unassigned, unreadMessages: unread })
})

exports.getScoringToday = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, 'leadScoring.lastScoredAt')

  const filter = Object.keys(dateFilter).length
    ? dateFilter
    : { 'leadScoring.lastScoredAt': { $gte: startOfDay(new Date()), $lte: endOfDay(new Date()) } }

  const leads = await Lead.find(filter)
    .populate('customerId')
    .populate('assignedSales')
    .sort({ 'leadScoring.score': -1 })
    .lean()

  return success(res, { leads })
})

exports.getAllLeads = asyncHandler(async (req, res) => {
  const {
    search, buildingType, quoteValueMin, quoteValueMax,
    assignedSales, lifecycleStatus, source, isQuoteReady,
    isHandedToSales, isTerminated, page = 1, limit = 20,
  } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (assignedSales) filter.assignedSales = assignedSales
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (source) filter.source = source
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (isHandedToSales !== undefined) filter.isHandedToSales = isHandedToSales === 'true'
  if (isTerminated !== undefined) filter.isTerminated = isTerminated === 'true'
  if (quoteValueMin || quoteValueMax) {
    filter.quoteValue = {}
    if (quoteValueMin) filter.quoteValue.$gte = Number(quoteValueMin)
    if (quoteValueMax) filter.quoteValue.$lte = Number(quoteValueMax)
  }
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const matchingCustomerIds = await Customer.find({
      $or: [{ firstName: regex }, { email: regex }, { customerId: regex }],
    }).distinct('_id')
    filter.$or = [{ projectName: regex }, { customerId: { $in: matchingCustomerIds } }]
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate('customerId')
      .populate('assignedSales')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const leadIds = leads.map(l => l._id)
  const budgets = await ProjectBudget.find({ leadId: { $in: leadIds } }).lean()
  const budgetMap = new Map(budgets.map(b => [String(b.leadId), b]))

  const result = leads.map(l => ({
    ...l,
    budget: (() => {
      const b = budgetMap.get(String(l._id))
      if (!b) return null
      return { totalBudget: b.totalBudget, expectedProfit: (l.quoteValue || 0) - (b.totalBudget || 0) }
    })(),
  }))

  return success(res, { leads: result, total, page: parsedPage, limit: parsedLimit })
})

exports.getAiHandledLeads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = { isHandedToSales: false, assignedSales: null }
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: 'firstName email' })
      .select('_id customerId buildingType location lifecycleStatus leadScoring createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { leads, total })
})

exports.getSignedContracts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = { 'documents.type': 'contract' }
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: 'firstName' })
      .populate({ path: 'assignedSales', select: 'name' })
      .select('_id projectName customerId assignedSales documents lifecycleStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const contracts = leads.map(l => {
    const contractDoc = l.documents?.find(d => d.type === 'contract')
    return {
      _id: l._id,
      projectName: l.projectName || '',
      customerId: l.customerId,
      agreementUploadedAt: contractDoc?.uploadedAt || null,
      assignedSales: l.assignedSales,
      lifecycleStatus: l.lifecycleStatus,
    }
  })

  return success(res, { contracts, total })
})

exports.getTerminatedLeads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = { isTerminated: true }
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: 'firstName' })
      .populate({ path: 'assignedSales', select: 'name' })
      .select('_id projectName customerId assignedSales terminatedAt terminationReason lifecycleStatus')
      .sort({ terminatedAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { projects: leads, total })
})

exports.createLead = asyncHandler(async (req, res) => {
  const { customerId, projectName, buildingType, location, assignedSales, roofStyle, width, length, height } = req.body

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  const normalizedProjectName = projectName ? normalizeProjectName(projectName) : ''
  if (normalizedProjectName) {
    const existingLead = await Lead.findOne({
      customerId,
      projectName: { $regex: new RegExp(`^${escapeRegex(normalizedProjectName)}$`, 'i') },
    })
      .select('_id projectName lifecycleStatus assignedSales isTerminated')
      .lean()
    if (existingLead) {
      return badRequest(
        res,
        'A project with this name already exists for this customer. Please edit the existing lead instead.',
        { existingLead }
      )
    }
  }

  const lead = await Lead.create({
    customerId,
    projectName: normalizedProjectName,
    buildingType: buildingType ? buildingType.trim() : '',
    location: location ? location.trim() : '',
    roofStyle: roofStyle || '',
    width: toNumberOrNull(width),
    length: toNumberOrNull(length),
    height: toNumberOrNull(height),
    source: 'manual',
    assignedSales: assignedSales || null,
    isHandedToSales: !!assignedSales,
    assigningHistory: assignedSales
      ? [{ employeeId: assignedSales, method: 'manual', assignedBy: req.user._id, assignedAt: new Date() }]
      : [],
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId,
    performedBy: req.user._id,
    metadata: { source: 'manual', assignedSales },
  })

  return created(res, { lead })
})

exports.importLeads = asyncHandler(async (req, res) => {
  if (!req.body.csv) return badRequest(res, 'CSV data required in body.csv')

  let records
  try {
    records = parse(req.body.csv, { columns: true, skip_empty_lines: true, trim: true })
  } catch {
    return badRequest(res, 'Invalid CSV format')
  }

  const results = { created: 0, skipped: 0, errors: [] }

  for (const row of records) {
    try {
      const { name, email, phone, projectType } = row
      if (!email || !phone) { results.skipped++; continue }

      const normalized = email.toLowerCase().trim()
      let customer = await Customer.findOne({
        $or: [{ email: normalized }, { 'phone.number': phone.trim() }],
      })

      if (!customer) {
        const custId = await generateCustomerId()
        const hashed = await bcrypt.hash(phone.trim(), 12)
        customer = await Customer.create({
          customerId: custId,
          firstName: name?.trim() || 'Unknown',
          email: normalized,
          phone: { number: phone.trim(), countryCode: '' },
          password: hashed,
          source: 'import',
        })
      }

      await Lead.create({ customerId: customer._id, buildingType: projectType || '', source: 'import' })
      results.created++
    } catch (err) {
      results.errors.push({ row, error: err.message })
    }
  }

  return success(res, results, `Import complete: ${results.created} created, ${results.skipped} skipped`)
})

exports.editLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { buildingType, location, quoteValue, lifecycleStatus } = req.body

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')

  if (buildingType !== undefined) lead.buildingType = buildingType
  if (location !== undefined) lead.location = location
  if (quoteValue !== undefined) lead.quoteValue = quoteValue
  if (lifecycleStatus && LIFECYCLE_STAGES.includes(lifecycleStatus)) {
    lead.lifecycleStatus = lifecycleStatus
    lead.lifecycleHistory.push({
      stage: lifecycleStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
    })
  }

  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_EDITED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { buildingType, location, quoteValue, lifecycleStatus },
  })

  return success(res, { lead })
})

exports.assignLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { employeeId } = req.body

  const [lead, employee] = await Promise.all([Lead.findById(leadId), User.findById(employeeId)])
  if (!lead) return notFound(res, 'Lead not found')
  if (!employee) return notFound(res, 'Employee not found')

  lead.assignedSales = employeeId
  lead.isHandedToSales = true
  lead.assigningHistory.push({ employeeId, method: 'manual', assignedBy: req.user._id, assignedAt: new Date() })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_ASSIGNED_MANUAL,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { assignedTo: employeeId, employeeName: employee.name },
  })

  const fullLead = await Lead.findById(leadId).populate('customerId').populate('assignedSales').lean()

  if (global.io) {
    global.io.of('/admin').to(`user:${employeeId}`).emit('lead_assigned', { leadId, lead: fullLead })
  }

  return success(res, { lead: fullLead }, 'Lead assigned successfully')
})

exports.getLeadDetail = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId).lean()
  if (!lead) return notFound(res, 'Lead not found')

  const [
    customer, assignedSales, quotations, auditLogs, activityLogs, followUps,
    invoices, buildings, meetings, budget, recentMessages,
  ] = await Promise.all([
    Customer.findById(lead.customerId).lean(),
    lead.assignedSales ? User.findById(lead.assignedSales).lean() : null,
    Quotation.find({ leadId }).sort({ versionNumber: -1, createdAt: -1 }).lean(),
    AuditLog.find({ leadId, type: { $ne: 'activity' } }).sort({ createdAt: 1 }).lean(),
    AuditLog.find({ leadId, type: 'activity' }).sort({ createdAt: 1 }).lean(),
    FollowUp.find({ leadId }).sort({ followUpDate: 1 }).lean(),
    Invoice.find({ leadId }).populate('createdBy').populate('paidBy').sort({ createdAt: -1 }).lean(),
    Building.find({ leadId }).sort({ buildingNumber: 1 }).lean(),
    Meeting.find({ leadId }).sort({ meetingTime: 1 }).lean(),
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

  const agreementDoc = lead.documents?.find(d => d.type === 'contract')

  return success(res, {
    lead,
    customer,
    assignedSales,
    quotations: flaggedQuotations,
    auditLog: auditLogs,
    activityLog: activityLogs,
    followUps,
    payments: { invoices, totalPaid, totalPending, totalInvoices: invoices.length },
    buildings,
    meetings,
    agreement: agreementDoc?.url || null,
    budget: budgetOut,
    recentMessages,
    bom: [],
    drawings: [],
    shopperFiles: [],
    shipments: [],
  })
})

exports.getLeadTimeline = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const dateFilter = buildDateFilter(req.query, 'createdAt')

  const timeline = await AuditLog.find({ leadId, type: 'lead', ...dateFilter })
    .populate('performedBy')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { timeline })
})

exports.setLeadBudget = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { materialBudget = 0, logisticBudget = 0, productionBudget = 0, shipperBudget = 0, otherCost = 0 } = req.body

  const lead = await Lead.findById(leadId).lean()
  if (!lead) return notFound(res, 'Lead not found')

  const totalBudget = materialBudget + logisticBudget + productionBudget + shipperBudget + otherCost

  const budget = await ProjectBudget.findOneAndUpdate(
    { leadId },
    { leadId, materialBudget, logisticBudget, productionBudget, shipperBudget, otherCost, totalBudget, createdBy: req.user._id },
    { upsert: true, new: true }
  )

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.BUDGET_SET,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { totalBudget },
  })

  return success(res, { budget: { ...budget.toObject(), expectedProfit: (lead.quoteValue || 0) - totalBudget } })
})

exports.getLeadBudget = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId).lean()
  if (!lead) return notFound(res, 'Lead not found')

  const budget = await ProjectBudget.findOne({ leadId }).lean()
  if (!budget) return success(res, { budget: null })

  return success(res, {
    budget: {
      ...budget,
      expectedProfit: (lead.quoteValue || 0) - (budget.totalBudget || 0),
    },
  })
})

exports.terminateLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { reason } = req.body

  if (!reason || !reason.trim()) return badRequest(res, 'reason is required')

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')

  lead.isTerminated = true
  lead.terminationReason = reason.trim()
  lead.terminatedAt = new Date()
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_TERMINATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { reason },
  })

  return success(res, { lead })
})

exports.createProjectForCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const { projectName, buildingType, location, assignedSales, roofStyle, width, length, height } = req.body

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  if (!projectName || !buildingType || !location) {
    return badRequest(res, 'projectName, buildingType, location are required')
  }

  const normalizedProjectName = normalizeProjectName(projectName)
  const existingLead = await Lead.findOne({
    customerId,
    projectName: { $regex: new RegExp(`^${escapeRegex(normalizedProjectName)}$`, 'i') },
  })
    .select('_id projectName lifecycleStatus assignedSales isTerminated')
    .lean()
  if (existingLead) {
    return badRequest(
      res,
      'A project with this name already exists for this customer. Please edit the existing lead instead.',
      { existingLead }
    )
  }

  let salesEmployeeId = assignedSales || null
  if (!salesEmployeeId) {
    const lastLead = await Lead.findOne({ customerId }).sort({ createdAt: -1 }).lean()
    if (lastLead?.assignedSales) {
      const prevRep = await User.findById(lastLead.assignedSales).lean()
      if (prevRep && prevRep.isActive === true) salesEmployeeId = lastLead.assignedSales
    }
  }

  const lead = await Lead.create({
    customerId,
    projectName: normalizedProjectName,
    buildingType: buildingType.trim(),
    location: location.trim(),
    roofStyle: roofStyle || '',
    width: toNumberOrNull(width),
    length: toNumberOrNull(length),
    height: toNumberOrNull(height),
    source: 'manual',
    assignedSales: salesEmployeeId,
    isHandedToSales: !!salesEmployeeId,
    assigningHistory: salesEmployeeId
      ? [{ employeeId: salesEmployeeId, method: 'manual', assignedBy: req.user._id, assignedAt: new Date() }]
      : [],
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId,
    performedBy: req.user._id,
    metadata: { source: 'manual_for_customer', assignedSales: salesEmployeeId },
  })

  return created(res, { lead })
})
