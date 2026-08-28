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
const { syncLeadBuildings } = require('../../services/leadBuilding.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES, CLOSED_STAGES, LEAD_TEMPERATURES, PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES, PO_STATUSES } = require('../../config/constants')
const { buildLeadCreatePayload, applyLeadUpdateFromBody, escapeRegex } = require('../../utils/leadPayload')
const {
  buildSalesLeadFilter,
  buildSalesLeadsByScoreFilter,
  mapLeadByScoreRow,
} = require('../../utils/leadQueryFilter')
const { setLeadTemperatureManual } = require('../../utils/leadTemperature')
const { setLeadLifecycleStage } = require('../../utils/leadLifecycle.util')
const { enrichLeadDocument, withProjectIdFields } = require('../../utils/leadProjectId')
const {
  mapEscalationLeadRow,
  ESCALATION_LEAD_POPULATE,
} = require('../../utils/escalationLeadRow')
const { exportLeadsToExcelAndS3 } = require('../../services/leadExport.service')
const { formatLeadNotes, appendLeadNote } = require('../../services/leadNotes.service')
const leadListSocket = require('../../services/leadListSocket.service')
const { parse } = require('csv-parse/sync')
const bcrypt = require('bcryptjs')

const guardLead = async (leadId, salesId) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', status: 404 }
  if (String(lead.assignedSales) !== String(salesId)) return { error: 'Access denied', status: 403 }
  return { lead }
}

exports.exportLeadsExcel = asyncHandler(async (req, res) => {
  const filter = await buildSalesLeadFilter(req.query, req.user._id)
  const result = await exportLeadsToExcelAndS3({
    filter,
    s3KeyPrefix: `exports/sales/${req.user._id}`,
  })
  return success(res, result)
})

exports.getLeadsByScore = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const { filter, error } = await buildSalesLeadsByScoreFilter(req.query, req.user._id)
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

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const result = await setLeadTemperatureManual(lead, temperature, req.user._id)
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'temperature', includeScoreRow: true })
  return success(res, { lead: result })
})

exports.getLeads = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const filter = await buildSalesLeadFilter(req.query, req.user._id)

  const skip = (parsedPage - 1) * parsedLimit
  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .select('_id jobId projectName customerId lifecycleStatus quoteValue leadScoring buildingType location isRaisedToPO')
      .populate({ path: 'customerId', select: 'firstName email' })
      .sort({ 'assigningHistory.assignedAt': -1 })
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

  const normalizedLeads = leads.map(lead => withProjectIdFields({
    _id: lead._id,
    projectName: lead.projectName || '',
    customerId: lead.customerId ? { _id: lead.customerId._id, firstName: lead.customerId.firstName || '', email: lead.customerId.email || '' } : null,
    lifecycleStatus: lead.lifecycleStatus,
    quoteValue: lead.quoteValue || 0,
    leadScoring: { score: lead.leadScoring?.score || 0 },
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    isRaisedToPO: lead.isRaisedToPO === true,
    nextFollowUp: nextFollowUpByLeadId.get(String(lead._id)) || null,
  }, lead.jobId))

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
  const { customerId, leadStatus, notes } = req.body

  const customer = await Customer.findById(customerId).lean()
  if (!customer) return notFound(res, 'Customer not found')
  if (customer.isActive === false) return badRequest(res, 'Customer is inactive')

  const { payload: leadPayload, error: leadError } = buildLeadCreatePayload(req.body, {
    customerId,
    assignedBy: req.user._id,
    defaultSource: 'manual',
    acceptSource: true,
    forceAssignedSales: req.user._id,
  })
  if (leadError) return badRequest(res, leadError)

  if (leadPayload.projectName) {
    const existingLead = await Lead.findOne({
      customerId,
      isDeleted: { $ne: true },
      projectName: { $regex: new RegExp(`^${escapeRegex(leadPayload.projectName)}$`, 'i') },
    })
      .select('_id projectName')
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
    ...leadPayload,
    notes: notes ? String(notes).trim() : '',
    lifecycleHistory: [
      { stage: 'initial_contact', changedAt: new Date(), changedBy: req.user._id },
    ],
  })

  if (leadStatus && LIFECYCLE_STAGES.includes(leadStatus)) {
    lead.lifecycleStatus = leadStatus
    lead.lifecycleHistory.push({
      stage: leadStatus,
      changedAt: new Date(),
      changedBy: req.user._id,
    })
    await lead.save()
  }

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId,
    performedBy: req.user._id,
    metadata: { source: lead.source, projectName: lead.projectName },
  })
  await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'sales_create_lead' })

  await syncLeadBuildings(lead, { createdBy: req.user._id })

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

      const lead = await Lead.create({
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
      await syncLeadBuildings(lead, { createdBy: req.user._id })
      results.imported++
    } catch (err) {
      results.errors.push({ row: i + 2, reason: err.message })
    }
  }

  return success(res, results)
})

exports.exportLeads = asyncHandler(async (req, res) => {
  const filter = await buildSalesLeadFilter(req.query, req.user._id)

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
      .select('_id jobId projectName customerId lifecycleStatus quoteValue leadScoring')
      .populate({ path: 'customerId', select: 'firstName' })
      .sort({ 'leadScoring.score': -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const result = leads.map(l => withProjectIdFields({
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
  }, l.jobId))

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
      .populate(ESCALATION_LEAD_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Escalation.countDocuments(escalationFilter),
  ])

  const result = escalations.map(mapEscalationLeadRow)

  return success(res, { leads: result, total })
})


exports.getLeadDetail = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const { lead: guardedLead, error, status } = await guardLead(
    leadId,
    req.user._id
  )

  if (error) {
    return status === 404
      ? notFound(res, error)
      : forbidden(res, error)
  }

  const lead = await Lead.findById(leadId)
    .populate(
      'assignedSales',
      '_id firstName lastName email phone role'
    )
    .lean()

  const [
    customer,
    quotations,
    auditLogs,
    activityLogs,
    followUps,
    invoices,
    buildings,
    budget,
    recentMessages,
  ] = await Promise.all([
    Customer.findById(lead.customerId)
      .select('_id customerId firstName email phone company location')
      .lean(),

    Quotation.find({ leadId })
      .sort({ versionNumber: -1, createdAt: -1 })
      .lean(),

    AuditLog.find({
      leadId,
      type: { $ne: 'activity' },
    })
      .sort({ createdAt: 1 })
      .lean(),

    AuditLog.find({
      leadId,
      type: 'activity',
    })
      .sort({ createdAt: 1 })
      .lean(),

    FollowUp.find({ leadId })
      .sort({ followUpDate: 1 })
      .lean(),

    Invoice.find({ leadId })
      .populate('paidBy')
      .sort({ createdAt: -1 })
      .lean(),

    Building.find({ leadId })
      .sort({ buildingNumber: 1 })
      .lean(),

    ProjectBudget.findOne({ leadId }).lean(),

    Message.find({ leadId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .then((m) => m.reverse()),
  ])

  const flaggedQuotations = quotations.map((q, i) => ({
    ...q,
    isLatest: i === 0,
  }))

  const totalPaid = invoices
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + (i.totalAmount || 0), 0)

  const totalPending = invoices
    .filter((i) => ['sent', 'overdue'].includes(i.status))
    .reduce((s, i) => s + (i.totalAmount || 0), 0)

  const budgetOut = budget
    ? {
        materialBudget: budget.materialBudget,
        logisticBudget: budget.logisticBudget,
        productionBudget: budget.productionBudget,
        shipperBudget: budget.shipperBudget,
        otherCost: budget.otherCost,
        totalBudget: budget.totalBudget,
        expectedProfit:
          (lead.quoteValue || 0) - (budget.totalBudget || 0),
      }
    : null

  const leadNotes = await formatLeadNotes(lead)

  // Get latest assignment date
  const latestAssignment =
    lead.assigningHistory?.length > 0
      ? lead.assigningHistory[lead.assigningHistory.length - 1]
      : null

  const enrichedLead = enrichLeadDocument(lead)

  enrichedLead.assignedSales = lead.assignedSales
    ? {
        ...lead.assignedSales,
        assignedAt: latestAssignment?.assignedAt || null,
      }
    : null

  return success(res, {
    lead: enrichedLead,
    customer,
    rfq: {
      aiQuoteData: lead.aiQuoteData,
      aiContextSummary: lead.aiContextSummary,
    },
    quotations: flaggedQuotations,
    auditLog: auditLogs,
    activityLog: activityLogs,
    followUps,
    payments: {
      invoices,
      totalPaid,
      totalPending,
      totalInvoices: invoices.length,
    },
    buildings,
    budget: budgetOut,
    recentMessages,
    leadNotes,
    shipments: [],
  })
})

exports.getLeadNotes = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const lead = await Lead.findById(leadId).select('leadNotes projectName jobId').lean()
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

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  try {
    const entry = await appendLeadNote(lead, note, req.user._id)
    return success(res, { note: entry }, 'Note added')
  } catch (err) {
    if (err.code === 'NOTE_REQUIRED') return badRequest(res, err.message)
    throw err
  }
})

exports.editLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const { error: updateError, lifecycleStatus } = applyLeadUpdateFromBody(lead, req.body)
  if (updateError) return badRequest(res, updateError)

  if (req.body.projectName !== undefined && lead.projectName) {
    const duplicate = await Lead.findOne({
      customerId: lead.customerId,
      _id: { $ne: lead._id },
      isDeleted: { $ne: true },
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
    setLeadLifecycleStage(lead, lifecycleStatus, req.user._id)
  }

  await lead.save()

  if (req.body.numberOfBuildings !== undefined) {
    await syncLeadBuildings(lead, {
      numberOfBuildings: lead.numberOfBuildings,
      createdBy: req.user._id,
    })
  }

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
  const { numberOfBuildings } = req.body

  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  const num = parseInt(numberOfBuildings, 10)
  if (!num || num < 1) return badRequest(res, 'numberOfBuildings must be >= 1')

  const syncResult = await syncLeadBuildings(lead, {
    numberOfBuildings: num,
    createdBy: req.user._id,
  })

  const {
    buildings,
    numberOfBuildings: effectiveCount,
    createdCount,
    createdBuildingNumbers,
    removedCount,
    removedBuildingNumbers,
    removedBomJobCount,
    consolidatedBomInvalidated,
  } = syncResult

  if (createdCount > 0 || removedCount > 0) {
    await auditService.log({
      type: 'lead',
      action: removedCount > 0 ? AUDIT_ACTIONS.BUILDINGS_SYNCED : AUDIT_ACTIONS.BUILDINGS_CREATED,
      leadId,
      customerId: lead.customerId,
      performedBy: req.user._id,
      metadata: {
        numberOfBuildings: effectiveCount,
        createdCount,
        createdBuildingNumbers,
        removedCount,
        removedBuildingNumbers,
        removedBomJobCount,
        consolidatedBomInvalidated,
      },
    })
  }

  const payload = {
    buildings,
    numberOfBuildings: effectiveCount,
    createdCount,
    createdBuildingNumbers,
    removedCount,
    removedBuildingNumbers,
    removedBomJobCount,
    consolidatedBomInvalidated,
  }

  if (createdCount > 0 && removedCount === 0) {
    return created(res, payload)
  }

  return success(res, payload, removedCount > 0 ? 'Buildings synced' : 'No building changes')
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

  if (lifecycleStatus === 'converted_to_po') {
    return badRequest(res, 'Use POST /api/sales/leads/:leadId/po-order to convert a lead to PO')
  }

  setLeadLifecycleStage(lead, lifecycleStatus, req.user._id)
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_LIFECYCLE_UPDATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { lifecycleStatus },
  })
  // await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'lifecycle', includeScoreRow: true })
   await leadListSocket.emitLeadListUpdated(leadId, {
  trigger: 'lifecycle',
  includeScoreRow: true,
  notifySales: false,
})

  return success(res, { lead: enrichLeadDocument(lead) })
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
  const { lead, error, status } = await guardLead(leadId, req.user._id)
  if (error) return status === 404 ? notFound(res, error) : forbidden(res, error)

  if (lead.isRaisedToPO) return badRequest(res, 'PO already raised for this lead')

  const latestInvoice = await Invoice.findOne({ leadId }).sort({ createdAt: -1 }).lean()
  if (!latestInvoice) return badRequest(res, 'No invoice found. Create an invoice first.')

  if (latestInvoice.status !== 'paid') {
    return badRequest(res, 'Latest invoice must be marked as paid before raising a PO', {
      invoiceId: latestInvoice._id,
      invoiceStatus: latestInvoice.status,
    })
  }

  if (!PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES.includes(lead.lifecycleStatus)) {
    return badRequest(
      res,
      `Lead lifecycle must be one of: ${PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES.join(', ')}`
    )
  }

  const latestQuotation = await Quotation.findOne({ leadId })
    .sort({ versionNumber: -1, createdAt: -1 })
    .select('_id')
    .lean()

  const order = await POOrder.create({
    leadId,
    customerId: lead.customerId,
    raisedBy: req.user._id,
    invoiceId: latestInvoice._id,
    quotationId: latestQuotation?._id || null,
    poNumber: latestInvoice.poNumber,
  })

  lead.isRaisedToPO = true
  lead.poNumber = latestInvoice.poNumber
  lead.poStatus = 'pending'
  lead.lifecycleStatus = 'converted_to_po'
  lead.lifecycleHistory.push({ stage: 'converted_to_po', changedAt: new Date(), changedBy: req.user._id })
  await lead.save()
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'po_raised', includeScoreRow: true })

  if (global.io) global.io.of('/admin').to('admin_room').emit('new_po_order', { order, leadId })

  await auditService.log({
    type: 'po', action: AUDIT_ACTIONS.LEAD_PO_RAISED,
    leadId, customerId: lead.customerId, performedBy: req.user._id,
    metadata: { poNumber: latestInvoice.poNumber }
  })

  return success(res, { order }, 'PO Order raised successfully')
})

exports.getLeadsWithPo = asyncHandler(async (req, res) => {
  const { poStatus, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  if (poStatus && !PO_STATUSES.includes(poStatus)) {
    return badRequest(res, `Invalid poStatus. Use: ${PO_STATUSES.join(', ')}`)
  }

  const orderFilter = { raisedBy: req.user._id, ...dateFilter }
  if (poStatus) orderFilter.status = poStatus

  const allOrders = await POOrder.find(orderFilter)
    .sort({ createdAt: -1 })
    .lean()

  const latestByLead = new Map()
  for (const order of allOrders) {
    const key = String(order.leadId)
    if (!latestByLead.has(key)) latestByLead.set(key, order)
  }

  let ordersList = [...latestByLead.values()]

  const leadIds = ordersList.map((o) => o.leadId)
  if (!leadIds.length) {
    return success(res, { leads: [], total: 0, page: parsedPage, limit: parsedLimit })
  }

  const leadFilter = { _id: { $in: leadIds }, assignedSales: req.user._id }
  if (search && search.trim()) {
    leadFilter.projectName = new RegExp(escapeRegex(search.trim()), 'i')
  }

  const leads = await Lead.find(leadFilter)
    .populate('customerId', 'firstName lastName email')
    .lean()

  const leadMap = new Map(leads.map((l) => [String(l._id), l]))

  const rows = ordersList
    .filter((o) => leadMap.has(String(o.leadId)))
    .map((o) => {
      const lead = enrichLeadDocument(leadMap.get(String(o.leadId)))
      return {
        _id: lead._id,
        projectId: lead.jobId || null,
        projectName: lead.projectName || '',
        location: lead.location || '',
        lifecycleStatus: lead.lifecycleStatus,
        quoteValue: lead.quoteValue || 0,
        isRaisedToPO: lead.isRaisedToPO === true,
        poNumber: lead.poNumber || o.poNumber,
        poStatus: lead.poStatus || o.status,
        customerId: lead.customerId,
        po: {
          _id: o._id,
          poNumber: o.poNumber,
          status: o.status,
          adminNotes: o.adminNotes || '',
          assignedTo: o.assignedTo || null,
          createdAt: o.createdAt,
        },
      }
    })
    .sort((a, b) => new Date(b.po.createdAt) - new Date(a.po.createdAt))

  const total = rows.length
  const skip = (parsedPage - 1) * parsedLimit
  const leadsPage = rows.slice(skip, skip + parsedLimit)

  return success(res, {
    leads: leadsPage,
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
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
      .populate({
        path: 'leadId',
        select: 'jobId projectName',
      })
      .populate({
        path: 'customerId',
        select: 'firstName lastName',
      })
      .populate({
        path: 'invoiceId',
        select: 'invoiceNumber status totalAmount',
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    POOrder.countDocuments(filter),
  ])

  const formattedOrders = orders.map((order) => ({
    ...order,
    jobId: order.leadId?.jobId || null,
    quoteValue: order.invoiceId?.totalAmount ?? null,
  }))

  return success(res, {
    orders: formattedOrders,
  total,
  page: parsedPage,
  limit: parsedLimit,
})
})
