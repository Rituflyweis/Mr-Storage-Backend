const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const Message = require('../../models/Message')
const Quotation = require('../../models/Quotation')
const Invoice = require('../../models/Invoice')
const PaymentSchedule = require('../../models/PaymentSchedule')
const AuditLog = require('../../models/AuditLog')
const User = require('../../models/User')
const Building = require('../../models/Building')
const POOrder = require('../../models/POOrder')
const ProjectBudget = require('../../models/ProjectBudget')
const FollowUp = require('../../models/FollowUp')
const auditService = require('../../services/audit.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const {
  AUDIT_ACTIONS,
  LIFECYCLE_STAGES,
  LEAD_TEMPERATURES,
} = require('../../config/constants')
const {
  escapeRegex,
  normalizeProjectName,
  toNumberOrNull,
  buildLeadCreatePayload,
  applyLeadUpdateFromBody,
} = require('../../utils/leadPayload')
const { parse } = require('csv-parse/sync')
const bcrypt = require('bcryptjs')
const { startOfDay, endOfDay } = require('date-fns')
const {
  buildAdminLeadFilter,
  buildAdminLeadsByScoreFilter,
  mapLeadByScoreRow,
} = require('../../utils/leadQueryFilter')
const { setLeadTemperatureManual } = require('../../utils/leadTemperature')
const { formatLeadNotes, appendLeadNote } = require('../../services/leadNotes.service')
const { exportLeadsToExcelAndS3 } = require('../../services/leadExport.service')
const { enrichLeadDocument, withProjectIdFields } = require('../../utils/leadProjectId')
const leadListSocket = require('../../services/leadListSocket.service')

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

exports.getLeadsByScore = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const { filter, error } = await buildAdminLeadsByScoreFilter(req.query)
  if (error) return badRequest(res, error)

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: 'firstName email customerId' })
      .select('_id jobId projectName location lifecycleStatus lifecycleHistory quoteValue leadScoring updatedAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, {
    leads: leads.map(mapLeadByScoreRow),
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.updateLeadTemperature = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { temperature } = req.body

  if (!temperature || !LEAD_TEMPERATURES.includes(temperature)) {
    return badRequest(res, 'temperature is required and must be hot, warm, or cold')
  }

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')

  const result = await setLeadTemperatureManual(lead, temperature, req.user._id)
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'temperature', includeScoreRow: true })
  return success(res, { lead: result })
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

exports.exportLeadsExcel = asyncHandler(async (req, res) => {
  const filter = await buildAdminLeadFilter(req.query)
  const result = await exportLeadsToExcelAndS3({
    filter,
    s3KeyPrefix: `exports/admin/${req.user._id}`,
  })
  return success(res, result)
})

exports.getAllLeads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const filter = await buildAdminLeadFilter(req.query)

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

  const result = leads.map(l => enrichLeadDocument({
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
      .select('_id jobId customerId buildingType location lifecycleStatus leadScoring createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { leads: leads.map(enrichLeadDocument), total })
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
      .select('_id jobId projectName customerId assignedSales documents lifecycleStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const contracts = leads.map(l => {
    const contractDoc = l.documents?.find(d => d.type === 'contract')
    return withProjectIdFields({
      _id: l._id,
      projectName: l.projectName || '',
      customerId: l.customerId,
      agreementUploadedAt: contractDoc?.uploadedAt || null,
      assignedSales: l.assignedSales,
      lifecycleStatus: l.lifecycleStatus,
    }, l.jobId)
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
      .select('_id jobId projectName customerId assignedSales terminatedAt terminationReason lifecycleStatus')
      .sort({ terminatedAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { projects: leads.map(enrichLeadDocument), total })
})

exports.createLead = asyncHandler(async (req, res) => {
  const { customerId } = req.body

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  const { payload: leadPayload, error: leadError } = buildLeadCreatePayload(req.body, {
    customerId,
    assignedBy: req.user._id,
    defaultSource: 'manual',
    acceptSource: true,
  })
  if (leadError) return badRequest(res, leadError)

  if (leadPayload.projectName) {
    const existingLead = await Lead.findOne({
      customerId,
      projectName: { $regex: new RegExp(`^${escapeRegex(leadPayload.projectName)}$`, 'i') },
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

  const lead = await Lead.create(leadPayload)

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId,
    performedBy: req.user._id,
    metadata: { source: lead.source, projectName: lead.projectName, assignedSales: lead.assignedSales },
  })
  await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'admin_create_lead' })

  return created(res, { lead: enrichLeadDocument(lead) })
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

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')

  const { error: updateError, lifecycleStatus } = applyLeadUpdateFromBody(lead, req.body)
  if (updateError) return badRequest(res, updateError)

  if (req.body.projectName !== undefined && lead.projectName) {
    const duplicate = await Lead.findOne({
      customerId: lead.customerId,
      _id: { $ne: lead._id },
      projectName: { $regex: new RegExp(`^${escapeRegex(lead.projectName)}$`, 'i') },
    })
      .select('_id projectName')
      .lean()
    if (duplicate) {
      return badRequest(
        res,
        'A project with this name already exists for this customer. Please use a different project name.',
        { existingLead: duplicate }
      )
    }
  }

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
    metadata: req.body,
  })
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'lead_edited', includeScoreRow: true })

  return success(res, { lead: enrichLeadDocument(lead) })
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
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'assigned' })

  return success(res, { lead: enrichLeadDocument(fullLead) }, 'Lead assigned successfully')
})

exports.getLeadDetail = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId).lean()
  if (!lead) return notFound(res, 'Lead not found')

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

  const leadNotes = await formatLeadNotes(lead)

  return success(res, {
    lead: enrichLeadDocument(lead),
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
    leadNotes,
    shipments: [],
  })
})

exports.getLeadNotes = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId).select('leadNotes projectName jobId customerId').lean()
  if (!lead) return notFound(res, 'Lead not found')

  const notes = await formatLeadNotes(lead)

  return success(res, {
    leadId: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || null,
    notes,
    total: notes.length,
  })
})

exports.createLeadNote = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { note } = req.body

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')

  try {
    const entry = await appendLeadNote(lead, note, req.user._id)
    return success(res, { note: entry }, 'Note added')
  } catch (err) {
    if (err.code === 'NOTE_REQUIRED') return badRequest(res, err.message)
    throw err
  }
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

exports.getLeadDocuments = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { type } = req.query

  const lead = await Lead.findById(leadId)
    .select('jobId projectName documents')
    .lean()
  if (!lead) return notFound(res, 'Lead not found')

  let documents = lead.documents || []
  if (type) documents = documents.filter((d) => d.type === type)

  const uploaderIds = [
    ...new Set(documents.map((d) => d.uploadedBy).filter(Boolean).map(String)),
  ]
  const uploaders = uploaderIds.length
    ? await User.find({ _id: { $in: uploaderIds } }).select('_id name email role').lean()
    : []
  const uploaderMap = new Map(uploaders.map((u) => [String(u._id), u]))

  const formattedDocuments = [...documents]
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .map((doc) => ({
      _id: doc._id,
      url: doc.url,
      name: doc.name,
      type: doc.type,
      uploadedAt: doc.uploadedAt,
      uploadedBy: doc.uploadedBy
        ? uploaderMap.get(String(doc.uploadedBy)) || { _id: doc.uploadedBy }
        : null,
    }))

  return success(res, {
    project: {
      _id: lead._id,
      projectName: lead.projectName || '',
      jobId: lead.jobId,
    },
    documents: formattedDocuments,
    total: formattedDocuments.length,
  })
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
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'budget' })

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

exports.approveBOM = asyncHandler(async (req, res) => {
  const { leadId, buildingId } = req.params
  const { action, note } = req.body

  if (!['approved', 'rejected'].includes(action)) {
    return badRequest(res, 'action must be approved or rejected')
  }
  if (action === 'rejected' && !note) {
    return badRequest(res, 'note is required when rejecting')
  }

  const building = await Building.findOneAndUpdate(
    { _id: buildingId, leadId },
    { status: action === 'approved' ? 'bom_approved' : 'bom_pending' },
    { new: true }
  )
  if (!building) return notFound(res, 'Building not found')

  const po = await POOrder.findOne({ leadId, status: 'approved' }).select('assignedTo').lean()
  if (po?.assignedTo && global.io) {
    global.io.of('/admin').to(`user:${po.assignedTo}`).emit('bom_review_complete', {
      leadId,
      buildingId,
      buildingNumber: building.buildingNumber,
      action,
      note: note || '',
    })
  }

  await auditService.log({
    type: 'lead',
    action: action === 'approved' ? AUDIT_ACTIONS.BOM_APPROVED : AUDIT_ACTIONS.BOM_REJECTED,
    leadId,
    customerId: building.customerId,
    performedBy: req.user._id,
    metadata: { buildingId, buildingNumber: building.buildingNumber, note: note || '' },
  })

  return success(res, { building })
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
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'terminated' })

  return success(res, { lead: enrichLeadDocument(lead) })
})

exports.createProjectForCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  const { payload: leadPayload, error: leadError } = buildLeadCreatePayload(req.body, {
    customerId,
    assignedBy: req.user._id,
    defaultSource: 'manual',
    acceptSource: false,
  })
  if (leadError) return badRequest(res, leadError)

  if (leadPayload.projectName) {
    const existingLead = await Lead.findOne({
      customerId,
      projectName: { $regex: new RegExp(`^${escapeRegex(leadPayload.projectName)}$`, 'i') },
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

  let salesEmployeeId = leadPayload.assignedSales
  if (!salesEmployeeId) {
    const lastLead = await Lead.findOne({ customerId }).sort({ createdAt: -1 }).lean()
    if (lastLead?.assignedSales) {
      const prevRep = await User.findById(lastLead.assignedSales).lean()
      if (prevRep && prevRep.isActive === true) salesEmployeeId = lastLead.assignedSales
    }
  }

  const lead = await Lead.create({
    ...leadPayload,
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
    metadata: { source: lead.source, projectName: lead.projectName, assignedSales: salesEmployeeId },
  })
  await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'admin_create_project' })

  return created(res, { lead: enrichLeadDocument(lead) })
})
