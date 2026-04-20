const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Message = require('../../models/Message')
const Quotation = require('../../models/Quotation')
const QuoteSummary = require('../../models/QuoteSummary')
const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const AuditLog = require('../../models/AuditLog')
const User = require('../../models/User')
const auditService = require('../../services/audit.service')
const roundRobinService = require('../../services/roundRobin.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES } = require('../../config/constants')
const { parse } = require('csv-parse/sync')
const bcrypt = require('bcryptjs')
const { startOfDay, endOfDay } = require('date-fns')

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

  // Default to today if no date range provided
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
  const { buildingType, quoteValueMin, quoteValueMax, assignedSales, lifecycleStatus, source, isQuoteReady, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (buildingType) filter.buildingType = { $regex: buildingType, $options: 'i' }
  if (assignedSales) filter.assignedSales = assignedSales
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (source) filter.source = source
  if (isQuoteReady !== undefined) filter.isQuoteReady = isQuoteReady === 'true'
  if (quoteValueMin || quoteValueMax) {
    filter.quoteValue = {}
    if (quoteValueMin) filter.quoteValue.$gte = Number(quoteValueMin)
    if (quoteValueMax) filter.quoteValue.$lte = Number(quoteValueMax)
  }

  const skip = (parseInt(page) - 1) * parseInt(limit)
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate('customerId')
      .populate('assignedSales')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { leads, total, page: parseInt(page), limit: parseInt(limit) })
})

exports.createLead = asyncHandler(async (req, res) => {
  const { customerId, buildingType, location, assignedSales } = req.body

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  const lead = await Lead.create({
    customerId,
    buildingType,
    location,
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
        const customerId = await generateCustomerId()
        const hashed = await bcrypt.hash(phone.trim(), 12)
        customer = await Customer.create({
          customerId,
          firstName: name?.trim() || 'Unknown',
          email: normalized,
          phone: { number: phone.trim(), countryCode: '' },
          password: hashed,
          source: 'import',
        })
      }

      await Lead.create({
        customerId: customer._id,
        buildingType: projectType || '',
        source: 'import',
      })
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
  if (lifecycleStatus && LIFECYCLE_STAGES.includes(lifecycleStatus)) lead.lifecycleStatus = lifecycleStatus

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

  const [lead, employee] = await Promise.all([
    Lead.findById(leadId),
    User.findById(employeeId),
  ])
  if (!lead) return notFound(res, 'Lead not found')
  if (!employee) return notFound(res, 'Employee not found')

  lead.assignedSales = employeeId
  lead.isHandedToSales = true
  lead.assigningHistory.push({
    employeeId,
    method: 'manual',
    assignedBy: req.user._id,
    assignedAt: new Date(),
  })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_ASSIGNED_MANUAL,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { assignedTo: employeeId, employeeName: employee.name },
  })

  // Load full lead for socket payload so sales employee has full context
  const fullLead = await Lead.findById(leadId).populate('customerId').populate('assignedSales').lean()

  if (global.io) {
    global.io.of('/admin').to(`user:${employeeId}`).emit('lead_assigned', {
      leadId,
      lead: fullLead,
    })
  }

  return success(res, { lead: fullLead }, 'Lead assigned successfully')
})

exports.getLeadDetail = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId)
    .populate('customerId')
    .populate('assignedSales')
    .lean()
  if (!lead) return notFound(res, 'Lead not found')

  const [quotation, invoices, messages] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId })
      .populate('createdBy')
      .populate('paidBy')
      .sort({ createdAt: -1 })
      .lean(),
    Message.find({ leadId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .then(msgs => msgs.reverse()),
  ])

  let quoteSummary = null
  let paymentSchedule = null
  if (quotation) {
    quoteSummary = await QuoteSummary.findOne({ quotationId: quotation._id }).lean()
  }
  if (invoices.length > 0) {
    paymentSchedule = await PaymentSchedule.findOne({ invoiceId: invoices[0]._id }).lean()
  }

  return success(res, {
    lead,
    quotation,
    quoteSummary,
    invoices,
    paymentSchedule,
    recentMessages: messages,
    documents: lead.documents || [],
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

exports.createProjectForCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const { buildingType, location, assignedSales } = req.body

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  // Default to previous sales employee from most recent lead — only if still active
  let salesEmployeeId = assignedSales || null
  if (!salesEmployeeId) {
    const lastLead = await Lead.findOne({ customerId }).sort({ createdAt: -1 }).lean()
    if (lastLead?.assignedSales) {
      const prevRep = await User.findById(lastLead.assignedSales).lean()
      if (prevRep && prevRep.isActive === true) {
        salesEmployeeId = lastLead.assignedSales
      }
      // If rep is inactive, leave unassigned — admin assigns manually
    }
  }

  const lead = await Lead.create({
    customerId,
    buildingType: buildingType || '',
    location: location || '',
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
