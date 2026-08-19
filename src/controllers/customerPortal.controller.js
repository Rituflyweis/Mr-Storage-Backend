const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { v4: uuidv4 } = require('uuid')
const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const Delivery = require('../models/Delivery')
const FreightBid = require('../models/FreightBid')
const FreightCarrier = require('../models/FreightCarrier')
const Quotation = require('../models/Quotation')
const QuoteSummary = require('../models/QuoteSummary')
const PaymentSchedule = require('../models/PaymentSchedule')
const DrawingDocument = require('../models/DrawingDocument')
const FollowUp = require('../models/FollowUp')
const Meeting = require('../models/Meeting')
const AuditLog = require('../models/AuditLog')
const User = require('../models/User')
const MaterialRequest = require('../models/MaterialRequest')
const OrderQuotation = require('../models/OrderQuotation')
const Message = require('../models/Message')
const Notification = require('../models/Notification')
const Milestone = require('../models/Milestone')
const Task = require('../models/Task')
const ProjectStepDetail = require('../models/ProjectStepDetail')
const Building = require('../models/Building')
const Bundle = require('../models/Bundle')
const { success, created, notFound, forbidden, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { loadFreightLoadDetailsByLeadId } = require('../services/plant/freightLoadDetails.service')
const { generateDeliveryInfoPdf, generatePackingListPdf, generateInstructionsPdf, generatePackingListDetailPdf } = require('../utils/exportDelivery')
const { generateDeliveryIcs, buildCalendarEventDetails } = require('../utils/generateIcs')
const { sendSms } = require('../services/sms/sms.service')
const { sendDeliveryConfirmationEmail, sendDeliveryCallbackRequestEmail } = require('../services/email/mailer')
const bcrypt = require('bcryptjs')
const env = require('../config/env')
const generateMaterialRequestId = require('../utils/generateMaterialRequestId')
const auditService = require('../services/audit.service')
const { syncLeadBuildings } = require('../services/leadBuilding.service')
const { AUDIT_ACTIONS } = require('../config/constants')
const { enrichLeadDocument } = require('../utils/leadProjectId')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const CLOSED_STAGES = ['payment_done', 'delivered']

// "Project Steps" stepper (Design -> Fabrication -> Dispatch -> Install -> Complete) shown on
// the Project Details / Dashboard screens. Maps the 21 granular sales+plant lifecycle stages
// down to these 5 customer-facing buckets. NOTE: nothing in the data model marks a project
// "Complete" beyond delivery — there is no separate installation/closure stage or flag today —
// so the Install bucket becomes "in_progress" once delivered and Complete stays "pending"
// until that gap is closed with a real signal.
const PROJECT_STEP_DEFS = [
  {
    key: 'design', label: 'Design',
    stages: [
      'initial_contact', 'requirements_gathered', 'proposal_sent', 'negotiation', 'deal_closed',
      'payment_done', 'converted_to_po', 'sent_to_admin',
      'released_to_plant', 'drawings_received', 'bom_received', 'bom_review',
    ],
  },
  { key: 'fabrication', label: 'Fabrication', stages: ['material_check', 'production_planning', 'fabrication_started', 'quality_inspection'] },
  { key: 'dispatch', label: 'Dispatch', stages: ['packing_bundling', 'shipper_prepared', 'ready_for_delivery', 'dispatched'] },
  { key: 'install', label: 'Install', stages: ['delivered'] },
  { key: 'complete', label: 'Complete', stages: [] },
]

// stepDetails: ProjectStepDetail[] for this lead — optional descriptive overlay
// (startedBy/completedBy/currentStage sub-label/completionPct/expectedCompletion/notes/attachments).
// Status/date always come from Lead.lifecycleStatus/lifecycleHistory — the overlay never overrides that.
const computeProjectSteps = (lead, stepDetails = []) => {
  const currentStage = lead.lifecycleStatus
  const history = lead.lifecycleHistory || []
  const foundIdx = PROJECT_STEP_DEFS.findIndex((b) => b.stages.includes(currentStage))
  const currentIdx = foundIdx === -1 ? 0 : foundIdx
  const detailByKey = new Map(stepDetails.map((d) => [d.stepKey, d]))

  const steps = PROJECT_STEP_DEFS.map((bucket, idx) => {
    const entries = history.filter((h) => bucket.stages.includes(h.stage)).sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt))
    const detail = detailByKey.get(bucket.key) || null

    let status, date
    if (idx < currentIdx) {
      status = 'completed'
      date = entries.length ? entries[entries.length - 1].changedAt : null
    } else if (idx === currentIdx) {
      status = 'in_progress'
      date = entries.length ? entries[0].changedAt : null
    } else {
      status = 'pending'
      date = null
    }

    return {
      key: bucket.key,
      label: bucket.label,
      status,
      date,
      startedBy: detail?.startedBy || '',
      startedAt: detail?.startedAt || (status !== 'pending' ? date : null),
      completedBy: detail?.completedBy || '',
      completedAt: detail?.completedAt || (status === 'completed' ? date : null),
      currentStage: detail?.currentStage || '',
      completionPct: detail?.completionPct ?? (status === 'completed' ? 100 : status === 'pending' ? 0 : null),
      expectedCompletion: detail?.expectedCompletion || null,
      notes: detail?.notes || '',
      attachments: detail?.attachments || [],
    }
  })

  const currentStepNumber = currentIdx + 1
  const totalSteps = PROJECT_STEP_DEFS.length

  return {
    steps,
    currentStepNumber,
    totalSteps,
    currentStepLabel: PROJECT_STEP_DEFS[currentIdx].label,
    overallProgressPct: Math.round((currentStepNumber / totalSteps) * 100),
  }
}

const { computeInvoiceDueDate } = require('../utils/invoiceDueDate')

const computeDueDate = (invoice) => {
  if (invoice.dueDate) return new Date(invoice.dueDate)
  return computeInvoiceDueDate(invoice.date, invoice.daysToPay)
}

/** DB PaymentSchedule uses `stages`; customer FE contract expects `payments`. */
const formatCustomerPaymentSchedule = (schedule) => {
  if (!schedule) return null
  const payments = (schedule.stages || []).map((stage) => ({
    _id: stage._id,
    name: stage.stageName,
    amount: stage.amount,
    amountType: stage.amountType,
    dueDate: stage.dueDate,
    status: stage.status,
    invoiceId: stage.invoiceId,
    paidAt: stage.paidAt,
  }))
  return {
    totalAmount: schedule.totalAmount,
    payments,
    stages: schedule.stages || [],
  }
}

const paymentScheduleForInvoice = (schedule, invoice) => {
  if (!schedule) return null
  const formatted = formatCustomerPaymentSchedule(schedule)
  if (invoice.paymentScheduleStageId) {
    const payment = formatted.payments.find(
      (p) => String(p._id) === String(invoice.paymentScheduleStageId)
    )
    if (payment) {
      return { totalAmount: schedule.totalAmount, payments: [payment] }
    }
  }
  const linked = formatted.payments.filter(
    (p) => p.invoiceId && String(p.invoiceId) === String(invoice._id)
  )
  if (linked.length) {
    return { totalAmount: schedule.totalAmount, payments: linked }
  }
  return null
}

const PROJECT_DETAIL_LEAD_FIELDS = [
  'customerId', 'jobId', 'projectName', 'buildingType', 'location', 'roofStyle', 'sqft',
  'width', 'length', 'notes', 'numberOfBuildings', 'lifecycleStatus', 'lifecycleHistory',
  'quoteValue', 'documents', 'assignedSales', 'createdAt', 'plannedStartDate', 'endDate',
  'isRaisedToPO', 'poNumber', 'source', 'isQuoteReady',
].join(' ')

// ── Profile ───────────────────────────────────────────────────────────────────

exports.getProfile = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer._id).select('-password').lean()
  if (!customer) return notFound(res, 'Customer not found')
  return success(res, { customer })
})

exports.updateProfile = asyncHandler(async (req, res) => {
  const { firstName, photo } = req.body
  if (!firstName && photo === undefined) {
    return badRequest(res, 'No updatable fields provided — send firstName or photo')
  }

  const customer = await Customer.findById(req.customer._id)
  if (!customer) return notFound(res, 'Customer not found')

  if (firstName !== undefined) customer.firstName = firstName
  if (photo !== undefined)     customer.photo = photo
  await customer.save()

  return success(res, { customer }, 'Profile updated successfully')
})

// ── Dashboard ─────────────────────────────────────────────────────────────────

exports.getDashboard = asyncHandler(async (req, res) => {
  const customerId = req.customer._id

  const [leads, invoices] = await Promise.all([
    Lead.find({ customerId }).select('lifecycleStatus quoteValue documents jobId projectName location buildingType assignedSales updatedAt').lean(),
    Invoice.find({ customerId }).select('status totalAmount date daysToPay leadId').lean(),
  ])

  const activeProjects = leads.filter(l => !CLOSED_STAGES.includes(l.lifecycleStatus)).length
  const closedProjects = leads.filter(l => CLOSED_STAGES.includes(l.lifecycleStatus)).length

  const drawingsAndApprovals = leads.reduce((sum, l) =>
    sum + l.documents.filter(d => d.type === 'drawing' || d.type === 'approval').length, 0)

  const totalProjectValue = leads.reduce((sum, l) => sum + (l.quoteValue || 0), 0)
  const totalPaid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const totalPending = invoices.filter(i => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + i.totalAmount, 0)

  const now = new Date()
  const upcomingRaw = invoices
    .filter(i => i.status === 'sent')
    .map(i => ({ ...i, dueDate: computeDueDate(i) }))
    .filter(i => i.dueDate && i.dueDate >= now)
    .sort((a, b) => a.dueDate - b.dueDate)[0]

  let upcomingInvoice = null
  if (upcomingRaw) {
    const lead = leads.find(l => String(l._id) === String(upcomingRaw.leadId))
    upcomingInvoice = {
      invoiceNumber: upcomingRaw.invoiceNumber,
      totalAmount:   upcomingRaw.totalAmount,
      dueDate:       upcomingRaw.dueDate,
      leadId:        upcomingRaw.leadId,
      buildingType:  lead?.buildingType || '',
      location:      lead?.location || '',
    }
  }

  const leadIds = leads.map(l => l._id)
  const nowTs = new Date()
  const weekFromNow = new Date(nowTs.getTime() + 7 * 24 * 60 * 60 * 1000)

  const deliveries = leadIds.length
    ? await Delivery.find({
        leadId: { $in: leadIds },
        status: { $nin: ['draft', 'cancelled'] },
      }).select('status deliveryDate deliveryNumber description loadDescription leadId loadWeight').lean()
    : []

  const deliveryTracking = {
    inTransit:            deliveries.filter(d => d.status === 'in_transit').length,
    staged:               deliveries.filter(d => d.status === 'scheduled').length,
    ready:                deliveries.filter(d => d.status === 'confirmed').length,
    totalToday:           deliveries.filter(d => d.deliveryDate && new Date(d.deliveryDate).toDateString() === nowTs.toDateString()).length,
    upcomingDeliveries:   deliveries.filter(d => d.deliveryDate && new Date(d.deliveryDate) > nowTs).length,
    deliveriesThisWeek:   deliveries.filter(d => d.deliveryDate && new Date(d.deliveryDate) > nowTs && new Date(d.deliveryDate) <= weekFromNow).length,
    delayedDeliveries:    deliveries.filter(d => d.status === 'delayed').length,
    rescheduledDeliveries: deliveries.filter(d => d.status === 'rescheduled').length,
  }

  const nextDeliveryRaw = deliveries
    .filter(d => d.deliveryDate && new Date(d.deliveryDate) >= nowTs && d.status !== 'delivered')
    .sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate))[0] || null

  // Item 1: give the dashboard's nextDelivery the exact same shape as GET /deliveries/:deliveryId,
  // instead of the 5-field summary it had before.
  let nextDelivery = null
  if (nextDeliveryRaw) {
    const fullDelivery = await Delivery.findById(nextDeliveryRaw._id).lean()
    const nextDeliveryLead = leads.find(l => String(l._id) === String(fullDelivery.leadId))
    const [carrier, loadDetails] = await Promise.all([
      getDeliveryCarrier(fullDelivery),
      loadFreightLoadDetailsByLeadId(fullDelivery.leadId),
    ])
    nextDelivery = mapDeliveryRow(fullDelivery, nextDeliveryLead || { _id: fullDelivery.leadId }, carrier, loadDetails)
  }

  const totalBundles = leadIds.length ? await Bundle.countDocuments({ leadId: { $in: leadIds } }) : 0
  const shipmentBreakdown = {
    totalLoads: deliveries.length,
    totalBundles,
  }

  const nextMilestone = leadIds.length
    ? await Milestone.findOne({ leadId: { $in: leadIds }, status: { $ne: 'completed' }, targetDate: { $gte: nowTs } })
        .sort({ targetDate: 1 })
        .lean()
    : null
  const projectTimeline = nextMilestone
    ? Math.max(0, Math.ceil((new Date(nextMilestone.targetDate) - nowTs) / 86400000))
    : null

  // Item 2: "Active Project Overview" card — picks the most recently active non-closed project.
  const activeLead = leads
    .filter(l => !CLOSED_STAGES.includes(l.lifecycleStatus))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null

  let activeProjectOverview = null
  if (activeLead) {
    const [currentStep, leadNextMilestone, projectManager] = await Promise.all([
      ProjectStepDetail.findOne({ leadId: activeLead._id }).sort({ updatedAt: -1 }).lean(),
      Milestone.findOne({ leadId: activeLead._id, status: { $ne: 'completed' } }).sort({ targetDate: 1 }).lean(),
      activeLead.assignedSales ? User.findById(activeLead.assignedSales).select('name phone').lean() : null,
    ])

    activeProjectOverview = {
      leadId: activeLead._id,
      projectName: activeLead.projectName || '',
      projectCode: activeLead.jobId || '',
      siteLocation: activeLead.location || '',
      image: null,
      progressPct: currentStep?.completionPct ?? null,
      currentStage: currentStep?.currentStage || '',
      nextMilestone: leadNextMilestone ? { title: leadNextMilestone.title, targetDate: leadNextMilestone.targetDate } : null,
      projectManager: projectManager ? { name: projectManager.name, phone: projectManager.phone || '' } : null,
      note: 'image and a dedicated project-manager assignment do not exist in the data model yet — projectManager falls back to the lead\'s assigned sales rep, and image is always null.',
    }
  }

  // Item 3: "Drawings & Approvals" breakdown — replaces the flat count with real per-status data.
  const drawingStatusAgg = leadIds.length
    ? await DrawingDocument.aggregate([
        { $match: { leadId: { $in: leadIds } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
    : []
  const drawingStatusMap = Object.fromEntries(drawingStatusAgg.map(s => [s._id, s.count]))
  const revisionReceivedCount = leadIds.length
    ? await DrawingDocument.countDocuments({ leadId: { $in: leadIds }, revisionRequestedAt: { $ne: null } })
    : 0
  const latestPendingDrawing = leadIds.length
    ? await DrawingDocument.findOne({ leadId: { $in: leadIds }, status: { $in: ['pending', 'under_review'] } })
        .sort({ createdAt: -1 })
        .select('documentType buildingLabel')
        .lean()
    : null

  const drawingsApprovalsBreakdown = {
    pendingReview: (drawingStatusMap.pending || 0) + (drawingStatusMap.under_review || 0),
    pendingReviewSubtitle: latestPendingDrawing?.buildingLabel || latestPendingDrawing?.documentType || '',
    approved: drawingStatusMap.approved || 0,
    revisionReceived: revisionReceivedCount,
    itemsNeedingClarification: 0,
    note: 'There is no RFI / clarification-request data model in the backend yet, so itemsNeedingClarification is always 0 until that feature exists. revisionReceived is a best-effort proxy (count of drawings with a non-null revisionRequestedAt) — confirm this matches the intended definition.',
  }

  const [ordersList, notificationsFeed, recentMessages] = await Promise.all([
    leadIds.length
      ? MaterialRequest.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(5).lean()
      : [],
    Notification.find({ customerId }).sort({ createdAt: -1 }).limit(5).lean(),
    leadIds.length
      ? Message.find({ leadId: { $in: leadIds }, senderType: { $ne: 'customer' } }).sort({ createdAt: -1 }).limit(5).lean()
      : [],
  ])

  return success(res, {
    activeProjects,
    closedProjects,
    drawingsAndApprovals,
    drawingsApprovalsBreakdown,
    activeProjectOverview,
    projectTimeline,
    totalProjectValue,
    totalPaid,
    totalPending,
    upcomingInvoice,
    deliveryTracking,
    shipmentBreakdown,
    ordersList,
    notificationsFeed,
    recentMessages,
    nextDelivery,
  })
})

// ── Projects ──────────────────────────────────────────────────────────────────

// Figma "My Projects" tabs — Proposed/New Enquiry (pre-PO) vs Confirmed (PO raised), mirrors the
// isRaisedToPO flag already used to gate the Lead -> POOrder -> Invoice pipeline elsewhere.
exports.getProjects = asyncHandler(async (req, res) => {
  const { lifecycleStatus, tab, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const baseFilter = { customerId: req.customer._id }
  const filter = { ...baseFilter }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus
  if (tab === 'proposed') filter.isRaisedToPO = { $ne: true }
  if (tab === 'confirmed') filter.isRaisedToPO = true

  const ACTIVE_STAGES = [
    'released_to_plant', 'drawings_received', 'bom_received', 'bom_review',
    'material_check', 'production_planning', 'fabrication_started', 'quality_inspection',
    'packing_bundling', 'shipper_prepared', 'ready_for_delivery', 'dispatched',
  ]
  const WIP_STAGES = [
    'initial_contact', 'requirements_gathered', 'proposal_sent',
    'negotiation', 'deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin',
  ]

  const [projects, total, activeCount, wipCount, cancelledCount, proposedCount, confirmedCount] = await Promise.all([
    Lead.find(filter)
      .select('jobId projectName buildingType location lifecycleStatus quoteValue isQuoteReady isRaisedToPO source documents assignedSales plannedStartDate endDate')
      .populate('assignedSales', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Lead.countDocuments(filter),
    Lead.countDocuments({ ...baseFilter, lifecycleStatus: { $in: ACTIVE_STAGES } }),
    Lead.countDocuments({ ...baseFilter, lifecycleStatus: { $in: WIP_STAGES } }),
    Lead.countDocuments({ ...baseFilter, isTerminated: true }),
    Lead.countDocuments({ ...baseFilter, isRaisedToPO: { $ne: true } }),
    Lead.countDocuments({ ...baseFilter, isRaisedToPO: true }),
  ])

  const totalAll = await Lead.countDocuments(baseFilter)

  return success(res, {
    stats: {
      total: totalAll,
      active: activeCount,
      workInProgress: wipCount,
      cancelled: cancelledCount,
      proposed: proposedCount,
      confirmed: confirmedCount,
    },
    projects: projects.map(enrichLeadDocument),
    total,
    page: Number(page),
    limit: Number(limit),
  })
})

exports.getProject = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId)
    .select(PROJECT_DETAIL_LEAD_FIELDS)
    .populate('assignedSales', 'name email')
    .lean()

  if (!lead) return notFound(res, 'No project found with that ID')
  if (String(lead.customerId) !== String(req.customer._id)) {
    return forbidden(res, 'This project does not belong to your account')
  }

  const [quotation, invoices, paymentScheduleDoc, recentOrders, orderCounts, stepDetails, buildingsCount] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).select('-paidBy -createdBy -__v').sort({ createdAt: -1 }).lean(),
    PaymentSchedule.findOne({ leadId }).lean(),
    MaterialRequest.find({ leadId }).sort({ createdAt: -1 }).limit(5).lean(),
    orderCountsForLead(leadId),
    ProjectStepDetail.find({ leadId }).lean(),
    Building.countDocuments({ leadId }),
  ])

  let quoteSummary = null
  if (quotation) {
    quoteSummary = await QuoteSummary.findOne({ quotationId: quotation._id })
      .select('summary generatedAt').lean()
  }

  // Strip internalNotes from quotation
  if (quotation) delete quotation.internalNotes

  const formattedPaymentSchedule = formatCustomerPaymentSchedule(paymentScheduleDoc)

  // Attach paymentSchedule to each invoice when a stage is linked to that invoice
  const invoicesWithSchedule = invoices.map((inv) => ({
    ...inv,
    dueDate: computeDueDate(inv),
    paymentSchedule: paymentScheduleForInvoice(paymentScheduleDoc, inv),
  }))

  // Sibling projects (same order as the project list) for the prev/next nav button
  const siblings = await Lead.find({ customerId: req.customer._id })
    .select('jobId projectName')
    .sort({ createdAt: -1 })
    .lean()
  const idx = siblings.findIndex(l => String(l._id) === String(leadId))
  const prev = idx > 0 ? siblings[idx - 1] : null
  const next = idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null

  return success(res, {
    lead: { ...enrichLeadDocument(lead), buildingsCount },
    projectSteps: computeProjectSteps(lead, stepDetails),
    orders: { recent: recentOrders, counts: orderCounts },
    quotation,
    quoteSummary,
    invoices: invoicesWithSchedule,
    paymentSchedule: formattedPaymentSchedule,
    navigation: {
      previous: prev ? { _id: prev._id, jobId: prev.jobId, projectName: prev.projectName } : null,
      next:     next ? { _id: next._id, jobId: next.jobId, projectName: next.projectName } : null,
    },
  })
})

exports.createProject = asyncHandler(async (req, res) => {
  const { buildingType, location, roofStyle, sqft, width, length, description } = req.body

  const lead = await Lead.create({
    customerId:      req.customer._id,
    buildingType,
    location,
    roofStyle:       roofStyle  || '',
    sqft:            sqft       || '',
    width:           width      ?? null,
    length:          length     ?? null,
    notes:           description || '',
    source:          'customer_portal',
    lifecycleStatus: 'initial_contact',
    lifecycleHistory: [
      { stage: 'initial_contact', changedAt: new Date(), changedBy: null },
    ],
  })

  await auditService.log({
    type:       'lead',
    action:     AUDIT_ACTIONS.CUSTOMER_PROJECT_CREATED,
    leadId:     lead._id,
    customerId: req.customer._id,
    metadata:   { buildingType, location },
  })

  await syncLeadBuildings(lead, { createdBy: null })

  return created(res, {
    lead: {
      _id:             lead._id,
      buildingType:    lead.buildingType,
      location:        lead.location,
      roofStyle:       lead.roofStyle,
      sqft:            lead.sqft,
      width:           lead.width,
      length:          lead.length,
      notes:           lead.notes,
      source:          lead.source,
      lifecycleStatus: lead.lifecycleStatus,
      assignedSales:   null,
    },
  })
})

// ── Documents ─────────────────────────────────────────────────────────────────

exports.getDocuments = asyncHandler(async (req, res) => {
  const { type } = req.query

  const leads = await Lead.find({ customerId: req.customer._id })
    .select('buildingType location lifecycleStatus projectName jobId documents')
    .lean()

  if (!leads.length) return success(res, { projects: [], totalDocuments: 0 })

  const leadIds = leads.map(l => l._id)

  // Fetch DrawingDocuments from the separate collection
  const drawingFilter = { leadId: { $in: leadIds } }
  const [drawingDocs, plantBuildings] = await Promise.all([
    DrawingDocument.find(drawingFilter)
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .lean(),
    Building.find({ leadId: { $in: leadIds } }).select('leadId buildingNumber drawings uploadedBy').lean(),
  ])

  const drawingsByLead = {}
  for (const d of drawingDocs) {
    const key = String(d.leadId)
    if (!drawingsByLead[key]) drawingsByLead[key] = []
    drawingsByLead[key].push({
      _id:          d._id,
      name:         d.name,
      url:          d.fileUrl,
      type:         'drawing',
      documentType: d.documentType,
      status:       d.status,
      fileType:     d.fileType,
      fileSize:     d.fileSize,
      notes:        d.notes,
      revisionNote: d.revisionNote,
      uploadedBy:   d.uploadedBy,
      uploadedAt:   d.createdAt,
      source:       'drawing_document',
    })
  }

  for (const building of plantBuildings) {
    const key = String(building.leadId)
    if (!drawingsByLead[key]) drawingsByLead[key] = []
    for (const drawing of building.drawings || []) {
      drawingsByLead[key].push({
        _id: drawing._id,
        name: drawing.fileName,
        url: drawing.fileUrl,
        type: 'drawing',
        documentType: 'other',
        status: mapPlantDrawingStatus(drawing.status),
        uploadedAt: drawing.uploadedAt,
        source: 'plant_building',
      })
    }
  }

  let totalDocuments = 0
  const projects = []

  for (const lead of leads) {
    // Embedded lead.documents
    let embeddedDocs = (lead.documents || []).map(d => ({ ...d, source: 'lead' }))
    if (type) embeddedDocs = embeddedDocs.filter(d => d.type === type)

    // DrawingDocument collection (only include if type=drawing or no type filter)
    let drawings = drawingsByLead[String(lead._id)] || []
    if (type && type !== 'drawing') drawings = []

    const allDocs = [...drawings, ...embeddedDocs]
    if (allDocs.length === 0) continue

    totalDocuments += allDocs.length
    projects.push({
      lead: {
        _id:             lead._id,
        jobId:           lead.jobId,
        projectName:     lead.projectName,
        buildingType:    lead.buildingType,
        location:        lead.location,
        lifecycleStatus: lead.lifecycleStatus,
      },
      documents: allDocs,
      count:     allDocs.length,
    })
  }

  return success(res, { projects, totalDocuments })
})

// ── Payments ──────────────────────────────────────────────────────────────────

exports.getPayments = asyncHandler(async (req, res) => {
  const customerId = req.customer._id
  const { leadId } = req.query
  const invoiceFilter = { customerId, ...(leadId ? { leadId } : {}) }

  const [invoices, leads] = await Promise.all([
    Invoice.find(invoiceFilter).select('-paidBy -createdBy -__v').lean(),
    Lead.find({ customerId }).select('buildingType location').lean(),
  ])

  const leadMap = Object.fromEntries(leads.map(l => [String(l._id), l]))
  const now = new Date()

  const upcoming = []
  const overdue  = []
  const paid     = []

  for (const inv of invoices) {
    const lead = leadMap[String(inv.leadId)]
    const leadInfo = { buildingType: lead?.buildingType || '', location: lead?.location || '' }

    if (inv.status === 'paid') {
      paid.push({ ...inv, lead: leadInfo })
    } else if (inv.status === 'sent') {
      const dueDate = computeDueDate(inv)
      if (dueDate && dueDate < now) {
        overdue.push({ ...inv, dueDate, lead: leadInfo })
      } else {
        upcoming.push({ ...inv, dueDate, lead: leadInfo })
      }
    }
  }

  upcoming.sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0))

  return success(res, { upcoming, overdue, paid })
})

// GET /payments/stats
exports.getPaymentStats = asyncHandler(async (req, res) => {
  const customerId = req.customer._id

  const invoices = await Invoice.find({ customerId }).select('status totalAmount dueDate createdAt').lean()

  const totalInvoiced  = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0)
  const totalPaid      = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)
  const totalPending   = invoices.filter(i => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + (i.totalAmount || 0), 0)
  const totalOverdue   = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.totalAmount || 0), 0)
  const now = new Date()

  const overdueCount   = invoices.filter(i => i.status === 'overdue').length
  const upcomingCount  = invoices.filter(i => i.status === 'sent' && i.dueDate && new Date(i.dueDate) >= now).length
  const paidCount      = invoices.filter(i => i.status === 'paid').length

  // Next upcoming invoice
  const nextInvoice = invoices
    .filter(i => i.status === 'sent' && i.dueDate && new Date(i.dueDate) >= now)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] || null

  return success(res, {
    stats: {
      totalInvoiced,
      totalPaid,
      totalPending,
      totalOverdue,
      balance: totalInvoiced - totalPaid,
      paidPercent: totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0,
    },
    counts: {
      total:    invoices.length,
      paid:     paidCount,
      upcoming: upcomingCount,
      overdue:  overdueCount,
    },
    nextDueInvoice: nextInvoice ? {
      _id:         nextInvoice._id,
      totalAmount: nextInvoice.totalAmount,
      dueDate:     nextInvoice.dueDate,
    } : null,
  })
})

// ── Upload ────────────────────────────────────────────────────────────────────

exports.getPresignedUrl = asyncHandler(async (req, res) => {
  const { fileName, fileType, folder = 'customer-uploads' } = req.body
  if (!fileName || !fileType) return badRequest(res, 'fileName and fileType are required')

  const ext = fileName.split('.').pop()
  const key = `${folder}/${req.customer._id}/${uuidv4()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    ContentType: fileType,
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: env.AWS_S3_PRESIGNED_URL_EXPIRES })
  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`

  return success(res, { uploadUrl, fileUrl, key })
})

exports.getPaymentInvoices = asyncHandler(async (req, res) => {
  const { status, leadId } = req.query
  const customerId = req.customer._id

  const invoiceFilter = { customerId }
  if (status) invoiceFilter.status = status
  if (leadId) invoiceFilter.leadId = leadId

  const [invoices, leads] = await Promise.all([
    Invoice.find(invoiceFilter).select('-paidBy -createdBy -__v').sort({ createdAt: -1 }).lean(),
    Lead.find({ customerId }).select('projectName jobId buildingType location lifecycleStatus quoteValue').lean(),
  ])

  const leadMap = Object.fromEntries(leads.map(l => [String(l._id), l]))

  const grouped = {}
  for (const inv of invoices) {
    const key = String(inv.leadId)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push({ ...inv, dueDate: computeDueDate(inv) })
  }

  const now = new Date()
  const projects = Object.entries(grouped).map(([leadId, invs]) => {
    const lead = leadMap[leadId]
    const projectTotal   = invs.reduce((s, i) => s + (i.totalAmount || 0), 0)
    const projectPaid    = invs.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)
    const projectPending = invs.filter(i => ['sent', 'draft', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.totalAmount || 0), 0)
    const overdueAmount  = invs.filter(i => i.status === 'overdue' || (i.dueDate && new Date(i.dueDate) < now && i.status !== 'paid')).reduce((s, i) => s + (i.totalAmount || 0), 0)

    return {
      lead: lead ? {
        _id:             lead._id,
        jobId:           lead.jobId,
        projectName:     lead.projectName,
        buildingType:    lead.buildingType,
        location:        lead.location,
        lifecycleStatus: lead.lifecycleStatus,
        quoteValue:      lead.quoteValue,
      } : { _id: leadId },
      invoices: invs,
      summary: {
        projectTotal,
        projectPaid,
        projectPending,
        overdueAmount,
        paidPercent: projectTotal > 0 ? Math.round((projectPaid / projectTotal) * 100) : 0,
        invoiceCount: invs.length,
      },
    }
  })

  return success(res, { projects })
})

// GET /payments/invoices/:invoiceId — single invoice detail (customer-scoped equivalent of GET /api/invoices/:invoiceId)
exports.getPaymentInvoiceDetail = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
    .populate('createdBy', 'name')
    .populate('paidBy', 'name')
    .lean()
  if (!invoice) return notFound(res, 'Invoice not found')
  if (String(invoice.customerId) !== String(req.customer._id)) return forbidden(res, 'This invoice does not belong to your account')

  const [lead, paymentSchedule] = await Promise.all([
    Lead.findById(invoice.leadId).select('projectName jobId buildingType location').lean(),
    PaymentSchedule.findOne({ leadId: invoice.leadId }).lean(),
  ])

  return success(res, {
    invoice: { ...invoice, dueDate: computeDueDate(invoice), project: lead || null },
    paymentSchedule,
  })
})

// POST /payments/invoices/:invoiceId/payment-proof — customer uploads transaction receipt.
// Invoice stays unpaid (status untouched) until admin/sales verifies via the /verify endpoint.
exports.submitPaymentProof = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')
  if (String(invoice.customerId) !== String(req.customer._id)) return forbidden(res, 'This invoice does not belong to your account')
  if (invoice.status === 'paid') return badRequest(res, 'Invoice is already paid')

  const { files, transactionId, paymentDate, amount, notes } = req.body
  if (!Array.isArray(files) || !files.length) return badRequest(res, 'At least one receipt file is required')

  invoice.paymentProof = {
    status: 'pending_review',
    files: files.map(f => ({ url: f.url, name: f.name || '' })),
    transactionId: transactionId || '',
    paymentDate: paymentDate ? new Date(paymentDate) : null,
    amount: amount != null ? Number(amount) : null,
    notes: notes || '',
    submittedAt: new Date(),
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: '',
  }
  await invoice.save()

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.PAYMENT_PROOF_SUBMITTED,
    leadId: invoice.leadId,
    customerId: invoice.customerId,
    performedBy: req.customer._id,
    metadata: { invoiceId: invoice._id, transactionId },
  })

  if (global.io) {
    global.io.of('/admin').to('admin_room').emit('payment_proof_submitted', {
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      leadId: String(invoice.leadId),
    })
  }

  return success(res, { invoice }, 'Receipt submitted — pending review')
})

// GET /payments/invoice-stats  — Figma cards: Total Project Value, Pending Amount, Amount Paid, Upcoming Invoice Due
exports.getInvoiceStats = asyncHandler(async (req, res) => {
  const customerId = req.customer._id
  const now = new Date()

  const [invoices, leads] = await Promise.all([
    Invoice.find({ customerId }).select('status totalAmount dueDate date leadId').lean(),
    Lead.find({ customerId }).select('quoteValue projectName jobId').lean(),
  ])

  const totalProjectValue = leads.reduce((s, l) => s + (l.quoteValue || 0), 0)
  const amountPaid        = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)
  const pendingAmount     = invoices.filter(i => ['sent', 'draft', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.totalAmount || 0), 0)

  // Next upcoming due invoice
  const upcomingInvoice = invoices
    .filter(i => i.status === 'sent' && i.dueDate && new Date(i.dueDate) >= now)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0] || null

  // If no sent invoice, pick the nearest draft
  const nextDraft = !upcomingInvoice
    ? invoices.filter(i => i.status === 'draft').sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt))[0] || null
    : null

  const nextDue = upcomingInvoice || nextDraft

  return success(res, {
    totalProjectValue,
    pendingAmount,
    amountPaid,
    upcomingInvoiceDue: nextDue ? {
      _id:         nextDue._id,
      invoiceNumber: nextDue.invoiceNumber,
      totalAmount: nextDue.totalAmount,
      dueDate:     nextDue.dueDate,
      status:      nextDue.status,
    } : null,
    breakdown: {
      totalInvoiced: invoices.reduce((s, i) => s + (i.totalAmount || 0), 0),
      paid:     amountPaid,
      pending:  pendingAmount,
      overdue:  invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.totalAmount || 0), 0),
      invoiceCount: invoices.length,
    },
  })
})

// ── Delivery Schedule ─────────────────────────────────────────────────────────

const buildLoadAndBundleSummary = (delivery, loadDetails) => {
  const { bundlePlan, packingLists } = loadDetails || {}
  const truckNumber = (packingLists || [])
    .map(pl => pl.truckLabel || pl.truckNo)
    .filter(Boolean)
    .join(', ') || null

  return {
    loadId: bundlePlan?.planNumber || delivery.deliveryNumber || '',
    bundleCount: bundlePlan?.totalBundles ?? null,
    truckNumber,
    totalWeight: bundlePlan?.totalWeight ?? delivery.loadWeight ?? null,
  }
}

// "Packing List Summary" block in the Full Delivery Instructions dialog
const buildPackingListSummary = (delivery, loadDetails) => {
  const bundles = loadDetails?.bundles || []
  const totalParts = bundles.reduce((s, b) => s + (b.totalQty || 0), 0)
  const bundleTypes = new Set(bundles.map(b => b.bundleType).filter(Boolean)).size

  return {
    totalParts: totalParts || null,
    bundleTypes: bundleTypes || null,
    material: delivery.materialType || bundles[0]?.bundleType || '',
  }
}

const mapDeliveryRow = (d, lead, carrier, loadDetails) => {
  // Only one real "person at the site" contact exists on the Delivery model today —
  // it backs both the "Receiving POC" and "Site Contact" blocks in the Figma dialogs.
  const siteContact = {
    name: d.receivingPoc || '',
    phone: d.pickupContactPhone || '',
    email: d.receivingPocEmail || '',
  }
  const deliveryCompany = carrier ? {
    name: carrier.carrierName || '',
    driver: carrier.contactName || '',
    phone: carrier.phone || '',
    email: carrier.email || '',
  } : null

  const rescheduleHistory = d.rescheduleHistory || []
  const latest = rescheduleHistory.length ? rescheduleHistory[rescheduleHistory.length - 1] : null
  const loadAndBundle = buildLoadAndBundleSummary(d, loadDetails)

  return {
    deliveryId: d._id,
    deliveryNumber: d.deliveryNumber,
    status: d.status,
    description: d.loadDescription || d.description || '',
    truckNumber: loadAndBundle.truckNumber,
    deliveryDate: d.deliveryDate,
    timings: d.timings || '',
    pickupDate: d.pickupDate,
    deliveryLocation: d.deliveryLocation || '',
    estimatedWeight: d.loadWeight || null,
    loadingEquipment: d.loadingEquipment || [],
    siteInstructions: d.specialRequirements || '',
    specialNotes: d.additionalNotes || '',
    siteContact,
    receivingPoc: siteContact,
    deliveryCompany,
    deliveryTeam: deliveryCompany ? { company: deliveryCompany.name, driver: deliveryCompany.driver, phone: deliveryCompany.phone, email: deliveryCompany.email } : null,
    loadAndBundle,
    packingListSummary: buildPackingListSummary(d, loadDetails),
    siteReadiness: {
      siteReady: !!d.siteReadyConfirmation?.confirmed,
      equipmentReady: !!d.equipmentConfirmation?.confirmed,
    },
    confirmationEmailSent: !!d.confirmationEmailSent,
    confirmationEmailSentAt: d.confirmationEmailSentAt || null,
    reschedule: latest
      ? {
          _id: latest._id,
          previousDate: latest.previousDate,
          date: latest.date,
          reason: latest.reason,
          acknowledged: !!latest.acknowledged,
          acknowledgedAt: latest.acknowledgedAt || null,
        }
      : null,
    project: {
      leadId: lead._id || d.leadId,
      projectId: lead.jobId || '',
      projectName: lead.projectName || '',
    },
  }
}

// Resolves { deliveryId, lead, delivery } and asserts the lead belongs to this customer
const assertDeliveryOwner = async (req) => {
  const delivery = await Delivery.findById(req.params.deliveryId).lean()
  if (!delivery) return null
  const lead = await Lead.findById(delivery.leadId).select('customerId jobId projectName').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return null
  return { delivery, lead }
}

const getDeliveryCarrier = async (delivery) => {
  if (!delivery.selectedCarrierBidId) return null
  const bid = await FreightBid.findById(delivery.selectedCarrierBidId)
    .select('_id carrierId')
    .populate('carrierId', 'carrierName contactName phone email')
    .lean()
  return bid?.carrierId || null
}

// Shared by the unscoped /deliveries list and the project-scoped /deliveries/:leadId list
const buildDeliveryScheduleResponse = async (leads, tab) => {
  const leadIds = leads.map(l => l._id)
  const leadMap = new Map(leads.map(l => [String(l._id), l]))
  const now = new Date()

  const baseFilter = {
    leadId: { $in: leadIds },
    status: { $nin: ['draft', 'cancelled'] },
  }

  if (tab === 'upcoming') {
    baseFilter.deliveryDate = { $gte: now }
    baseFilter.status = { $nin: ['draft', 'cancelled', 'delivered'] }
  } else if (tab === 'past') {
    baseFilter.$or = [
      { status: 'delivered' },
      { deliveryDate: { $lt: now }, status: { $nin: ['draft', 'cancelled'] } },
    ]
    delete baseFilter.status
  } else if (tab === 'rescheduled') {
    baseFilter.status = 'rescheduled'
  }

  const deliveries = await Delivery.find(baseFilter)
    .sort({ deliveryDate: 1 })
    .lean()

  const selectedBidIds = deliveries.map(d => d.selectedCarrierBidId).filter(Boolean)
  const selectedBids = selectedBidIds.length
    ? await FreightBid.find({ _id: { $in: selectedBidIds } })
        .select('_id carrierId')
        .populate('carrierId', 'carrierName contactName phone email')
        .lean()
    : []
  const bidMap = new Map(selectedBids.map(b => [String(b._id), b]))

  const uniqueLeadIds = [...new Set(deliveries.map(d => String(d.leadId)))]
  const loadDetailsEntries = await Promise.all(
    uniqueLeadIds.map(async id => [id, await loadFreightLoadDetailsByLeadId(id)])
  )
  const loadDetailsByLead = new Map(loadDetailsEntries)

  const result = deliveries.map(d => {
    const lead = leadMap.get(String(d.leadId)) || {}
    const bid = d.selectedCarrierBidId ? bidMap.get(String(d.selectedCarrierBidId)) : null
    const carrier = bid?.carrierId || null
    const loadDetails = loadDetailsByLead.get(String(d.leadId))

    return mapDeliveryRow(d, lead, carrier, loadDetails)
  })

  const upcomingCount = await Delivery.countDocuments({ leadId: { $in: leadIds }, deliveryDate: { $gte: now }, status: { $nin: ['draft', 'cancelled', 'delivered'] } })
  const pastCount = await Delivery.countDocuments({ leadId: { $in: leadIds }, $or: [{ status: 'delivered' }, { deliveryDate: { $lt: now }, status: { $nin: ['draft', 'cancelled'] } }] })
  const rescheduledCount = await Delivery.countDocuments({ leadId: { $in: leadIds }, status: 'rescheduled' })

  return {
    deliveries: result,
    total: result.length,
    tabs: { upcoming: upcomingCount, past: pastCount, rescheduled: rescheduledCount },
  }
}

// GET /deliveries — unscoped, every project (kept for back-compat / dashboard-style usage)
exports.getDeliverySchedule = asyncHandler(async (req, res) => {
  const { tab = 'upcoming' } = req.query

  const leads = await Lead.find({ customerId: req.customer._id }).select('_id jobId projectName').lean()
  if (!leads.length) return success(res, { deliveries: [], total: 0, tabs: { upcoming: 0, past: 0, rescheduled: 0 } })

  return success(res, await buildDeliveryScheduleResponse(leads, tab))
})

// GET /deliveries/summary — per-project delivery counts, same shape as material-orders/summary & quotations/summary
exports.getDeliveriesSummary = asyncHandler(async (req, res) => {
  const leads = await Lead.find({ customerId: req.customer._id }).select('projectName jobId location').lean()
  const now = new Date()

  const rows = await Promise.all(leads.map(async (lead) => {
    const [upcoming, past, rescheduled] = await Promise.all([
      Delivery.countDocuments({ leadId: lead._id, deliveryDate: { $gte: now }, status: { $nin: ['draft', 'cancelled', 'delivered'] } }),
      Delivery.countDocuments({ leadId: lead._id, $or: [{ status: 'delivered' }, { deliveryDate: { $lt: now }, status: { $nin: ['draft', 'cancelled'] } }] }),
      Delivery.countDocuments({ leadId: lead._id, status: 'rescheduled' }),
    ])
    return { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location, upcoming, past, rescheduled }
  }))

  return success(res, { projects: rows })
})

// GET /deliveries/:id — smart dispatch: id is either a leadId (project-scoped schedule)
// or a deliveryId (single delivery detail), so the same path shape works for both the
// "My Delivery Schedule" project view and the existing delivery-detail deep link.
exports.getDeliveryScheduleOrDetail = asyncHandler(async (req, res, next) => {
  const { id } = req.params
  const { tab = 'upcoming' } = req.query

  let lead = null
  try {
    lead = await Lead.findOne({ _id: id, customerId: req.customer._id }).select('_id jobId projectName location').lean()
  } catch (_) {
    lead = null
  }

  if (lead) {
    const data = await buildDeliveryScheduleResponse([lead], tab)
    return success(res, {
      project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location },
      ...data,
    })
  }

  req.params.deliveryId = id
  return exports.getDeliveryDetail(req, res, next)
})

// GET /deliveries/:deliveryId
exports.getDeliveryDetail = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  const [carrier, loadDetails] = await Promise.all([
    getDeliveryCarrier(delivery),
    loadFreightLoadDetailsByLeadId(delivery.leadId),
  ])

  return success(res, { delivery: mapDeliveryRow(delivery, lead, carrier, loadDetails) })
})

// POST /deliveries/:deliveryId/contact-driver — "Contact Driver" dialog
exports.contactDeliveryDriver = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery } = owned

  const carrier = await getDeliveryCarrier(delivery)
  if (!carrier || !carrier.phone) return notFound(res, 'Driver contact not available yet')

  return success(res, {
    delivery: { title: delivery.loadDescription || delivery.description || '', deliveryNumber: delivery.deliveryNumber, status: delivery.status },
    driver: { name: carrier.contactName || '', phone: carrier.phone || '' },
    dispatcher: { name: carrier.carrierName || '', phone: carrier.phone || '' },
    siteContact: { name: delivery.receivingPoc || '', phone: delivery.pickupContactPhone || '' },
  })
})

// POST /deliveries/:deliveryId/contact-driver/sms — "Send SMS" in Contact Driver dialog
exports.sendDeliveryDriverSms = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  const carrier = await getDeliveryCarrier(delivery)
  if (!carrier || !carrier.phone) return notFound(res, 'Driver contact not available yet')

  const { message } = req.body
  const body = message?.trim() || `Regarding delivery ${delivery.deliveryNumber} for ${lead.projectName}: please contact the customer at your earliest convenience.`
  const result = await sendSms({ to: carrier.phone, body })

  await auditService.log({
    type: 'delivery',
    action: 'delivery.sms_sent',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { deliveryId: delivery._id, to: carrier.phone, target: 'driver' },
  })

  return success(res, { message: 'SMS sent to driver', sms: result })
})

// POST /deliveries/:deliveryId/contact-company — "Contact Delivery Company" dialog
exports.contactDeliveryCompany = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery } = owned

  const carrier = await getDeliveryCarrier(delivery)
  if (!carrier) return notFound(res, 'Delivery company not available yet')

  return success(res, {
    delivery: { title: delivery.loadDescription || delivery.description || '', deliveryNumber: delivery.deliveryNumber, status: delivery.status },
    managerName: carrier.contactName || '',
    managerPhone: carrier.phone || '',
    companyName: carrier.carrierName || '',
  })
})

// POST /deliveries/:deliveryId/contact-company/sms — "Send SMS" in Contact Delivery Company dialog
exports.sendDeliveryCompanySms = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  const carrier = await getDeliveryCarrier(delivery)
  if (!carrier || !carrier.phone) return notFound(res, 'Delivery company contact not available yet')

  const { message } = req.body
  const body = message?.trim() || `Regarding delivery ${delivery.deliveryNumber} for ${lead.projectName}: please contact the customer at your earliest convenience.`
  const result = await sendSms({ to: carrier.phone, body })

  await auditService.log({
    type: 'delivery',
    action: 'delivery.sms_sent',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { deliveryId: delivery._id, to: carrier.phone, target: 'delivery_company' },
  })

  return success(res, { message: 'SMS sent to delivery company', sms: result })
})

// POST /deliveries/:deliveryId/confirmation-email
exports.sendDeliveryConfirmation = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned
  const { toEmail } = req.body
  const customer = await Customer.findById(req.customer._id).select('firstName lastName email').lean()

  const recipient = toEmail?.trim() || req.customer.email

  await sendDeliveryConfirmationEmail({
    toEmail: recipient,
    customerName: customer ? `${customer.firstName} ${customer.lastName || ''}`.trim() : '',
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    deliveryNumber: delivery.deliveryNumber,
    deliveryDate: delivery.deliveryDate,
    timings: delivery.timings || '',
    deliveryLocation: delivery.deliveryLocation || '',
  })

  await Delivery.findByIdAndUpdate(delivery._id, { confirmationEmailSent: true, confirmationEmailSentAt: new Date() })

  await auditService.log({
    type: 'delivery',
    action: AUDIT_ACTIONS.DELIVERY_CONFIRMATION_SENT,
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { deliveryId: delivery._id, deliveryNumber: delivery.deliveryNumber, sentTo: recipient },
  })

  return success(res, { message: 'Confirmation email sent', sentTo: recipient, confirmationEmailSent: true })
})

// POST /deliveries/:deliveryId/acknowledge-reschedule — "Acknowledge" button on the Delivery Rescheduled banner
exports.acknowledgeDeliveryReschedule = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  if (!delivery.rescheduleHistory?.length) return badRequest(res, 'This delivery has no reschedule to acknowledge')

  const full = await Delivery.findById(delivery._id)
  const latest = full.rescheduleHistory[full.rescheduleHistory.length - 1]
  if (latest.acknowledged) return badRequest(res, 'Already acknowledged')

  latest.acknowledged = true
  latest.acknowledgedAt = new Date()
  await full.save()

  await auditService.log({
    type: 'delivery',
    action: 'delivery.reschedule_acknowledged',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { deliveryId: delivery._id, deliveryNumber: delivery.deliveryNumber, rescheduleId: latest._id },
  })

  return success(res, {
    deliveryId: delivery._id,
    reschedule: { _id: latest._id, previousDate: latest.previousDate, date: latest.date, reason: latest.reason, acknowledged: true, acknowledgedAt: latest.acknowledgedAt },
  }, 'Reschedule acknowledged')
})

// GET /deliveries/:deliveryId/calendar/details — "Add to Calendar" dialog content (Google/Outlook links, copy-to-clipboard text)
exports.getDeliveryCalendarDetails = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned
  if (!delivery.deliveryDate) return badRequest(res, 'Delivery does not have a scheduled date yet')

  const carrier = await getDeliveryCarrier(delivery)

  const eventDetails = buildCalendarEventDetails({
    deliveryNumber: delivery.deliveryNumber,
    deliveryDate: delivery.deliveryDate,
    timings: delivery.timings,
    deliveryLocation: delivery.deliveryLocation,
    projectName: lead.projectName,
    description: delivery.loadDescription || delivery.description || '',
    driverName: carrier?.contactName || '',
    driverPhone: carrier?.phone || '',
    deliveryCompanyName: carrier?.carrierName || '',
  })

  return success(res, {
    ...eventDetails,
    icsDownloadUrl: `/api/customer/deliveries/${delivery._id}/calendar`,
  })
})

// GET /deliveries/:deliveryId/calendar — "Add to Calendar" (.ics download)
exports.getDeliveryCalendar = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned
  if (!delivery.deliveryDate) return badRequest(res, 'Delivery does not have a scheduled date yet')

  const ics = generateDeliveryIcs({
    uid: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    deliveryDate: delivery.deliveryDate,
    timings: delivery.timings,
    deliveryLocation: delivery.deliveryLocation,
    projectName: lead.projectName,
    description: delivery.loadDescription || delivery.description || '',
  })

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}.ics"`)
  return res.send(ics)
})

const CALLBACK_PRIORITIES = ['low', 'medium', 'high', 'urgent']
const CALLBACK_ETA = {
  urgent: 'We will contact you within 1-2 hours',
  high: 'We will contact you within a few hours',
  medium: 'Our team will contact you within 1 business day',
  low: 'Our team will contact you within 2 business days',
}

// POST /deliveries/:deliveryId/request-callback
exports.requestDeliveryCallback = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned
  const { note, priority, reason } = req.body
  if (priority && !CALLBACK_PRIORITIES.includes(priority)) return badRequest(res, 'Invalid priority')

  const [fullLead, customer] = await Promise.all([
    Lead.findById(lead._id).select('assignedSales').populate('assignedSales', 'name email').lean(),
    Customer.findById(req.customer._id).select('firstName lastName email phone').lean(),
  ])
  const salesRep = fullLead?.assignedSales

  if (salesRep?.email) {
    await sendDeliveryCallbackRequestEmail({
      toEmail: salesRep.email,
      salesRepName: salesRep.name || '',
      customerName: customer ? `${customer.firstName} ${customer.lastName || ''}`.trim() : '',
      customerEmail: req.customer.email,
      customerPhone: customer?.phone || '',
      projectName: lead.projectName || '',
      jobId: lead.jobId || '',
      deliveryNumber: delivery.deliveryNumber,
      note: [reason ? `Reason: ${reason}` : '', priority ? `Priority: ${priority}` : '', note || ''].filter(Boolean).join(' | '),
    })
  }

  await auditService.log({
    type: 'delivery',
    action: AUDIT_ACTIONS.DELIVERY_CALLBACK_REQUESTED,
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { deliveryId: delivery._id, deliveryNumber: delivery.deliveryNumber, note: note || '', priority: priority || '', reason: reason || '' },
  })

  return success(res, {
    message: 'Call back requested.',
    eta: CALLBACK_ETA[priority] || CALLBACK_ETA.low,
  })
})

// GET /deliveries/:deliveryId/download — "Delivery Details PDF"
exports.downloadDeliveryInfo = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  const [carrier, loadDetails] = await Promise.all([
    getDeliveryCarrier(delivery),
    loadFreightLoadDetailsByLeadId(delivery.leadId),
  ])

  const mapped = mapDeliveryRow(delivery, lead, carrier, loadDetails)
  const buffer = await generateDeliveryInfoPdf(mapped)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}-details.pdf"`)
  return res.send(buffer)
})

// GET /deliveries/:deliveryId/download/packing-list — "Packing List" PDF
exports.downloadDeliveryPackingList = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  const [carrier, loadDetails] = await Promise.all([
    getDeliveryCarrier(delivery),
    loadFreightLoadDetailsByLeadId(delivery.leadId),
  ])

  const mapped = mapDeliveryRow(delivery, lead, carrier, loadDetails)
  const buffer = await generatePackingListPdf(mapped, loadDetails?.bundles, loadDetails?.packingLists)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}-packing-list.pdf"`)
  return res.send(buffer)
})

// GET /deliveries/:deliveryId/download/instructions — "Instructions" PDF
exports.downloadDeliveryInstructions = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery, lead } = owned

  const [carrier, loadDetails] = await Promise.all([
    getDeliveryCarrier(delivery),
    loadFreightLoadDetailsByLeadId(delivery.leadId),
  ])

  const mapped = mapDeliveryRow(delivery, lead, carrier, loadDetails)
  const buffer = await generateInstructionsPdf(mapped)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}-instructions.pdf"`)
  return res.send(buffer)
})

// ── Tax Report ────────────────────────────────────────────────────────────────

exports.getTaxReport = asyncHandler(async (req, res) => {
  const customerId = req.customer._id

  const leads = await Lead.find({ customerId }).select('_id jobId projectName buildingType location').lean()
  if (!leads.length) return success(res, { rows: [], summary: { totalContractAmount: 0, totalTaxDue: 0 } })

  const leadIds = leads.map(l => l._id)
  const leadMap = new Map(leads.map(l => [String(l._id), l]))

  const invoices = await Invoice.find({ customerId, leadId: { $in: leadIds } })
    .select('leadId invoiceNumber totalAmount tax date status lineItems')
    .sort({ date: -1 })
    .lean()

  const rows = invoices
    .filter(inv => (inv.tax || 0) > 0 || (inv.lineItems || []).some(li => li.taxAmount > 0))
    .map(inv => {
      const lead = leadMap.get(String(inv.leadId)) || {}
      const lineTaxTotal = (inv.lineItems || []).reduce((s, li) => s + (li.taxAmount || 0), 0)
      const taxDue = lineTaxTotal || inv.tax || 0
      const taxRate = inv.totalAmount > 0 ? ((taxDue / inv.totalAmount) * 100).toFixed(2) : 0

      return {
        date: inv.date,
        invoiceNumber: inv.invoiceNumber,
        projectId: lead.jobId || '',
        projectName: lead.projectName || '',
        buildingType: lead.buildingType || '',
        location: lead.location || '',
        contractAmount: inv.totalAmount || 0,
        taxRate: Number(taxRate),
        taxDue,
        status: inv.status,
      }
    })

  const totalContractAmount = rows.reduce((s, r) => s + r.contractAmount, 0)
  const totalTaxDue = rows.reduce((s, r) => s + r.taxDue, 0)

  return success(res, { rows, summary: { totalContractAmount, totalTaxDue } })
})

// ── Project sub-routes ────────────────────────────────────────────────────────

const assertProjectOwner = async (req) => {
  const lead = await Lead.findById(req.params.leadId).select('customerId projectName jobId location').lean()
  if (!lead) return null
  if (String(lead.customerId) !== String(req.customer._id)) return null
  return lead
}

// GET /projects/:leadId/stats
exports.getProjectStats = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const leadId = req.params.leadId

  const [totalDeliveries, deliveredCount, inTransitCount, invoices, followUps, meetings, fullLead, stepDetails] = await Promise.all([
    Delivery.countDocuments({ leadId }),
    Delivery.countDocuments({ leadId, status: 'delivered' }),
    Delivery.countDocuments({ leadId, status: 'in_transit' }),
    Invoice.find({ leadId }).select('status totalAmount').lean(),
    FollowUp.countDocuments({ leadId }),
    Meeting.countDocuments({ leadId }),
    Lead.findById(leadId).select('lifecycleStatus lifecycleHistory').lean(),
    ProjectStepDetail.find({ leadId }).lean(),
  ])

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)
  const pendingInvoices = invoices.filter(i => ['draft', 'sent', 'overdue'].includes(i.status)).length

  return success(res, {
    projectSteps: computeProjectSteps(fullLead, stepDetails),
    deliveries: { total: totalDeliveries, delivered: deliveredCount, inTransit: inTransitCount },
    payments:   { totalInvoiced, totalPaid, pending: totalInvoiced - totalPaid, pendingInvoices },
    followUps,
    meetings,
  })
})

// GET /projects/:leadId/tracking — "Project Tracking" tab: task progress, timeline, milestones
exports.getProjectTracking = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const leadId = req.params.leadId
  const [fullLead, tasks, milestones, stepDetails] = await Promise.all([
    Lead.findById(leadId).select('projectName jobId endDate lifecycleStatus lifecycleHistory').lean(),
    Task.find({ leadId }).select('status').lean(),
    Milestone.find({ leadId }).sort({ order: 1, targetDate: 1 }).lean(),
    ProjectStepDetail.find({ leadId }).lean(),
  ])

  const completed = tasks.filter(t => t.status === 'done').length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const pending = tasks.filter(t => t.status === 'todo').length
  const total = tasks.length

  const now = new Date()
  const plannedCompletion = fullLead.endDate || null
  const timelineStatus = plannedCompletion && new Date(plannedCompletion) < now && completed < total ? 'Delayed' : 'On Track'

  return success(res, {
    project: { leadId: fullLead._id, projectName: fullLead.projectName, jobId: fullLead.jobId },
    projectSteps: computeProjectSteps(fullLead, stepDetails),
    taskProgress: {
      completed, inProgress, pending, total,
      completedFraction: `${completed}/${total}`,
      completedPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
    timeline: {
      plannedCompletion,
      status: plannedCompletion ? timelineStatus : 'Unscheduled',
    },
    milestones: milestones.map(m => ({
      milestoneId: m._id,
      title: m.title,
      status: m.status,
      targetDate: m.targetDate,
      completedAt: m.completedAt,
    })),
  })
})

// GET /projects/:leadId/payments/summary — Financial Summary card (payments tab)
exports.getProjectPaymentsSummary = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const invoices = await Invoice.find({ leadId: req.params.leadId }).select('status totalAmount').lean()

  const totalPayment = invoices.reduce((s, i) => s + (i.totalAmount || 0), 0)
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)

  return success(res, {
    totalPayment,
    totalPaid,
    outstandingBalance: totalPayment - totalPaid,
  })
})

const BUILDING_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const buildingLabelFromNumber = (buildingNumber) => {
  const index = Math.max(0, (buildingNumber || 1) - 1)
  return `Building ${BUILDING_LETTERS[index] || buildingNumber}`
}

const buildingNumberFromLabel = (label) => {
  const normalized = String(label || '').trim()
  const letterMatch = /^Building\s+([A-Z])$/i.exec(normalized)
  if (letterMatch) return letterMatch[1].toUpperCase().charCodeAt(0) - 64
  const numMatch = /^Building\s+(\d+)$/i.exec(normalized)
  if (numMatch) return parseInt(numMatch[1], 10)
  return null
}

const mapPlantDrawingStatus = (status) => {
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'rejected'
  if (status === 'pending_review') return 'under_review'
  return 'pending'
}

const mapBuildingDrawingToCustomer = (drawing, building, leadId) => ({
  _id: drawing._id,
  leadId,
  buildingLabel: buildingLabelFromNumber(building.buildingNumber),
  buildingNumber: building.buildingNumber,
  category: 'drawing',
  name: drawing.fileName,
  fileUrl: drawing.fileUrl,
  fileType: '',
  fileSize: 0,
  documentType: 'other',
  status: mapPlantDrawingStatus(drawing.status),
  uploadedBy: drawing.uploadedBy,
  approvedBy: null,
  approvedAt: drawing.reviewedAt,
  notes: drawing.rejectionReason || '',
  revisionNote: '',
  revisionRequestedAt: null,
  createdAt: drawing.uploadedAt,
  updatedAt: drawing.uploadedAt || drawing.reviewedAt,
  source: 'plant_building',
  versionNumber: drawing.versionNumber,
})

const populateDrawingUploaders = async (drawings) => {
  const ids = [...new Set(drawings.map((d) => d.uploadedBy).filter(Boolean).map(String))]
  if (!ids.length) return drawings
  const users = await User.find({ _id: { $in: ids } }).select('name').lean()
  const byId = Object.fromEntries(users.map((u) => [String(u._id), u]))
  return drawings.map((d) => ({
    ...d,
    uploadedBy: byId[String(d.uploadedBy)] || d.uploadedBy,
  }))
}

const fetchPlantBuildingDrawings = async (leadId, { buildingLabel } = {}) => {
  const targetNumber = buildingLabel ? buildingNumberFromLabel(buildingLabel) : null
  const buildings = await Building.find({ leadId }).select('buildingNumber drawings').sort({ buildingNumber: 1 }).lean()
  const rows = []
  for (const building of buildings) {
    if (targetNumber != null && building.buildingNumber !== targetNumber) continue
    for (const drawing of building.drawings || []) {
      rows.push(mapBuildingDrawingToCustomer(drawing, building, leadId))
    }
  }
  return populateDrawingUploaders(rows)
}

const findPlantBuildingDrawing = async (leadId, docId) => {
  const buildings = await Building.find({ leadId }).select('buildingNumber drawings')
  for (const building of buildings) {
    const drawing = (building.drawings || []).find((d) => String(d._id) === String(docId))
    if (drawing) return { building, drawing }
  }
  return null
}

const plantDrawingsMatchTypeFilter = (type) => !type || type === 'other'

const sortDrawingsNewestFirst = (rows) =>
  [...rows].sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0))

const buildingLabelsForLead = (lead) => {
  const count = lead.numberOfBuildings || 1
  return Array.from({ length: count }, (_, i) => `Building ${BUILDING_LETTERS[i] || i + 1}`)
}

// GET /projects/:leadId/drawings
exports.getProjectDrawings = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const { type } = req.query
  const filter = { leadId: req.params.leadId }
  if (type) filter.documentType = type

  const [drawings, plantDrawings, fullLead] = await Promise.all([
    DrawingDocument.find(filter)
      .populate('uploadedBy', 'name')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .lean(),
    plantDrawingsMatchTypeFilter(type)
      ? fetchPlantBuildingDrawings(req.params.leadId)
      : Promise.resolve([]),
    Lead.findById(req.params.leadId).select('documents').lean(),
  ])

  const mergedDrawings = sortDrawingsNewestFirst([...drawings, ...plantDrawings])
  const embeddedDocs = (fullLead?.documents || []).map(d => ({
    _id: d._id,
    name: d.name,
    fileUrl: d.url,
    documentType: d.type,
    status: 'approved',
    uploadedAt: d.uploadedAt,
  }))

  return success(res, {
    drawings: mergedDrawings,
    embeddedDocuments: embeddedDocs,
    total: mergedDrawings.length + embeddedDocs.length,
  })
})

// GET /drawings — cross-project landing page ("Project Drawings" — lists every project with its building/drawing counts)
exports.getAllProjectDrawings = asyncHandler(async (req, res) => {
  const leads = await Lead.find({ customerId: req.customer._id })
    .select('projectName jobId location buildingType numberOfBuildings')
    .lean()

  const leadIds = leads.map((l) => l._id)
  const [docs, plantBuildings] = await Promise.all([
    leadIds.length
      ? DrawingDocument.find({ leadId: { $in: leadIds } }).select('leadId category updatedAt').lean()
      : Promise.resolve([]),
    leadIds.length
      ? Building.find({ leadId: { $in: leadIds } }).select('leadId buildingNumber drawings').lean()
      : Promise.resolve([]),
  ])

  const projects = leads.map((lead) => {
    const forLead = docs.filter((d) => String(d.leadId) === String(lead._id))
    const plantRows = plantBuildings.filter((b) => String(b.leadId) === String(lead._id))
    const plantDrawingCount = plantRows.reduce((sum, b) => sum + (b.drawings || []).length, 0)
    const plantLastUpdate = plantRows.reduce((max, b) => {
      for (const drawing of b.drawings || []) {
        const ts = drawing.uploadedAt || drawing.reviewedAt
        if (ts && (!max || ts > max)) max = ts
      }
      return max
    }, null)
    const docLastUpdate = forLead.reduce((max, d) => (!max || d.updatedAt > max ? d.updatedAt : max), null)
    const lastUpdate = [docLastUpdate, plantLastUpdate].filter(Boolean).sort((a, b) => b - a)[0] || null

    return {
      leadId: lead._id,
      projectName: lead.projectName,
      jobId: lead.jobId,
      location: lead.location,
      numberOfBuildings: Math.max(lead.numberOfBuildings || 1, plantRows.length),
      totalDrawings: forLead.filter((d) => d.category !== 'document').length + plantDrawingCount,
      lastUpdate,
    }
  })

  return success(res, { projects })
})

// GET /projects/:leadId/buildings — building breakdown ("Select a building" screen)
exports.getProjectBuildings = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId).select('customerId projectName jobId location numberOfBuildings').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return notFound(res, 'Project not found')

  const [docs, plantBuildings] = await Promise.all([
    DrawingDocument.find({ leadId: req.params.leadId }).select('buildingLabel category updatedAt').lean(),
    Building.find({ leadId: req.params.leadId }).select('buildingNumber drawings').lean(),
  ])

  const plantByLabel = {}
  for (const building of plantBuildings) {
    const label = buildingLabelFromNumber(building.buildingNumber)
    if (!plantByLabel[label]) plantByLabel[label] = []
    for (const drawing of building.drawings || []) {
      plantByLabel[label].push({
        category: 'drawing',
        updatedAt: drawing.uploadedAt || drawing.reviewedAt,
      })
    }
  }

  const labelsWithDocs = [...new Set(docs.map((d) => d.buildingLabel || 'Building A'))]
  const plantLabels = plantBuildings.map((b) => buildingLabelFromNumber(b.buildingNumber))
  const allLabels = [...new Set([...buildingLabelsForLead(lead), ...labelsWithDocs, ...plantLabels])]

  const buildings = allLabels.map((label) => {
    const forBuilding = docs.filter((d) => (d.buildingLabel || 'Building A') === label)
    const plantRows = plantByLabel[label] || []
    const combined = [...forBuilding, ...plantRows]
    const lastUpdate = combined.reduce((max, d) => {
      const ts = d.updatedAt
      return ts && (!max || ts > max) ? ts : max
    }, null)
    return {
      buildingLabel: label,
      totalDrawings: combined.filter((d) => d.category !== 'document').length,
      totalDocuments: combined.filter((d) => d.category === 'document').length,
      lastUpdate,
    }
  })

  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location },
    buildings,
  })
})

// GET /projects/:leadId/buildings/:buildingLabel — drawings + documents for one building
exports.getBuildingDrawings = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const buildingLabel = decodeURIComponent(req.params.buildingLabel)
  const [docs, plantDrawings] = await Promise.all([
    DrawingDocument.find({ leadId: req.params.leadId, buildingLabel })
      .populate('uploadedBy', 'name')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .lean(),
    fetchPlantBuildingDrawings(req.params.leadId, { buildingLabel }),
  ])

  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location },
    buildingLabel,
    drawings: sortDrawingsNewestFirst([
      ...docs.filter((d) => d.category === 'drawing' || d.category === 'photo'),
      ...plantDrawings,
    ]),
    documents: docs.filter((d) => d.category === 'document'),
  })
})

// GET /projects/:leadId/activity
exports.getProjectActivity = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const page  = Math.max(1, Number(req.query.page)  || 1)
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  const skip  = (page - 1) * limit

  const [logs, total] = await Promise.all([
    AuditLog.find({ leadId: req.params.leadId })
      .populate('performedBy', 'name role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments({ leadId: req.params.leadId }),
  ])

  return success(res, { activity: logs, total, page, limit })
})

// GET /projects/:leadId/notes
exports.getProjectNotes = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const fullLead = await Lead.findById(req.params.leadId)
    .select('leadNotes notes')
    .populate('leadNotes.addedBy', 'name role')
    .lean()

  return success(res, {
    notes: fullLead?.leadNotes || [],
    generalNotes: fullLead?.notes || '',
    total: (fullLead?.leadNotes || []).length,
  })
})

// GET /projects/:leadId/followups
exports.getProjectFollowUps = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const { status, page = 1, limit = 20 } = req.query
  const filter = { leadId: req.params.leadId }
  if (status) filter.status = status

  const skip = (Number(page) - 1) * Number(limit)

  const [followUps, total] = await Promise.all([
    FollowUp.find(filter)
      .populate('assignedTo', 'name email')
      .sort({ followUpDate: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    FollowUp.countDocuments(filter),
  ])

  const stats = {
    total,
    pending:   await FollowUp.countDocuments({ leadId: req.params.leadId, status: 'pending' }),
    completed: await FollowUp.countDocuments({ leadId: req.params.leadId, status: 'completed' }),
  }

  return success(res, { followUps, total, page: Number(page), limit: Number(limit), stats })
})

// GET /projects/:leadId/meetings
exports.getProjectMeetings = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const { status, page = 1, limit = 20 } = req.query
  const filter = { leadId: req.params.leadId }
  if (status) filter.status = status

  const skip = (Number(page) - 1) * Number(limit)

  const [meetings, total] = await Promise.all([
    Meeting.find(filter)
      .populate('createdBy', 'name email')
      .sort({ meetingTime: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Meeting.countDocuments(filter),
  ])

  const stats = {
    total,
    scheduled:  await Meeting.countDocuments({ leadId: req.params.leadId, status: 'scheduled' }),
    completed:  await Meeting.countDocuments({ leadId: req.params.leadId, status: 'completed' }),
    cancelled:  await Meeting.countDocuments({ leadId: req.params.leadId, status: 'cancelled' }),
  }

  return success(res, { meetings, total, page: Number(page), limit: Number(limit), stats })
})

// ── Cancel Project ────────────────────────────────────────────────────────────

// POST /projects/:leadId/cancel
exports.cancelProject = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId).select('customerId isTerminated lifecycleStatus projectName jobId')
  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Not your project')
  if (lead.isTerminated) return badRequest(res, 'Project is already cancelled')
  if (lead.lifecycleStatus === 'delivered') return badRequest(res, 'Cannot cancel a delivered project')

  const { reason } = req.body
  if (!reason || !reason.trim()) return badRequest(res, 'Cancellation reason is required')

  lead.isTerminated = true
  lead.terminationReason = reason.trim()
  lead.terminatedAt = new Date()
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CANCELLED || 'lead.cancelled',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { reason: reason.trim(), jobId: lead.jobId },
  })

  return success(res, { message: 'Project cancelled successfully', leadId: lead._id, jobId: lead.jobId })
})

// ── RFQ (Request for Quotation) ───────────────────────────────────────────────

// GET /projects/:leadId/rfq
exports.getProjectRFQ = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId)
    .select('customerId buildingType roofStyle sqft width length location description quoteValue isQuoteReady lifecycleStatus aiQuoteData aiContextSummary jobId projectName')
    .lean()
  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Not your project')

  const quotation = await Quotation.findOne({ leadId: req.params.leadId }).sort({ createdAt: -1 }).lean()

  return success(res, {
    rfq: {
      jobId: lead.jobId,
      projectName: lead.projectName,
      buildingType: lead.buildingType,
      roofStyle: lead.roofStyle,
      sqft: lead.sqft,
      width: lead.width,
      length: lead.length,
      location: lead.location,
      description: lead.description,
      quoteValue: lead.quoteValue,
      isQuoteReady: lead.isQuoteReady,
      lifecycleStatus: lead.lifecycleStatus,
      aiSummary: lead.aiContextSummary || null,
      aiQuoteData: lead.aiQuoteData || null,
    },
    quotation: quotation || null,
  })
})

// PUT /projects/:leadId/rfq  — customer updates building specs (only before deal_closed)
exports.updateProjectRFQ = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId).select('customerId lifecycleStatus isTerminated')
  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Not your project')
  if (lead.isTerminated) return badRequest(res, 'Cannot update a cancelled project')

  const LOCKED_STAGES = ['deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin', 'released_to_plant']
  if (LOCKED_STAGES.includes(lead.lifecycleStatus)) {
    return badRequest(res, 'Quote is already locked. Contact your sales rep to make changes.')
  }

  const allowed = ['buildingType', 'roofStyle', 'sqft', 'width', 'length', 'location', 'description']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }
  if (!Object.keys(updates).length) return badRequest(res, 'No valid fields to update')

  await Lead.updateOne({ _id: lead._id }, { $set: updates })

  return success(res, { message: 'RFQ updated successfully', updated: updates })
})

// ── Quotation (project detail -> quotation tab) ──────────────────────────────

// GET /projects/:leadId/quotation
exports.getProjectQuotation = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const quotation = await Quotation.findOne({ leadId: req.params.leadId })
    .sort({ createdAt: -1 })
    .populate('assignedSalesperson', 'name email')
    .lean()
  if (!quotation) return notFound(res, 'No quotation found for this project')

  return success(res, { quotation })
})

// POST /projects/:leadId/quotation/approve
exports.approveProjectQuotation = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const quotation = await Quotation.findOne({ leadId: req.params.leadId }).sort({ createdAt: -1 })
  if (!quotation) return notFound(res, 'No quotation found for this project')
  if (quotation.status === 'accepted') return badRequest(res, 'Quotation is already accepted')

  quotation.status = 'accepted'
  await quotation.save()

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_ACCEPTED,
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber },
  })

  return success(res, { message: 'Quotation accepted', quotation: { _id: quotation._id, status: quotation.status } })
})

// POST /projects/:leadId/quotation/reject
exports.rejectProjectQuotation = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const quotation = await Quotation.findOne({ leadId: req.params.leadId }).sort({ createdAt: -1 })
  if (!quotation) return notFound(res, 'No quotation found for this project')
  if (quotation.status === 'rejected') return badRequest(res, 'Quotation is already rejected')

  const { reason } = req.body
  quotation.status = 'rejected'
  quotation.clientNotes = reason || quotation.clientNotes
  await quotation.save()

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_REJECTED,
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber, reason: reason || '' },
  })

  return success(res, { message: 'Quotation rejected', quotation: { _id: quotation._id, status: quotation.status } })
})

// ── Drawing Approve / Request Revision ───────────────────────────────────────

// POST /projects/:leadId/drawings/:docId/approve
exports.approveDrawing = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId).select('customerId').lean()
  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Not your project')

  const doc = await DrawingDocument.findOne({ _id: req.params.docId, leadId: req.params.leadId })
  if (doc) {
    if (doc.status === 'approved') return badRequest(res, 'Drawing is already approved')

    doc.status = 'approved'
    doc.approvedAt = new Date()
    doc.revisionNote = ''
    await doc.save()

    await auditService.log({
      type: 'drawing',
      action: 'drawing.approved',
      leadId: lead._id,
      customerId: req.customer._id,
      performedBy: req.customer._id,
      metadata: { docId: doc._id, name: doc.name, source: 'drawing_document' },
    })

    return success(res, { message: 'Drawing approved', drawing: { _id: doc._id, name: doc.name, status: doc.status } })
  }

  const plantMatch = await findPlantBuildingDrawing(req.params.leadId, req.params.docId)
  if (!plantMatch) return notFound(res, 'Drawing not found')

  const { building, drawing } = plantMatch
  if (drawing.status === 'approved') return badRequest(res, 'Drawing is already approved')

  drawing.status = 'approved'
  drawing.reviewedAt = new Date()
  drawing.rejectionReason = ''
  await building.save()

  await auditService.log({
    type: 'drawing',
    action: 'drawing.approved',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: {
      docId: drawing._id,
      name: drawing.fileName,
      source: 'plant_building',
      buildingNumber: building.buildingNumber,
    },
  })

  return success(res, {
    message: 'Drawing approved',
    drawing: { _id: drawing._id, name: drawing.fileName, status: 'approved' },
  })
})

// POST /projects/:leadId/drawings/:docId/request-revision
exports.requestDrawingRevision = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.leadId).select('customerId').lean()
  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Not your project')

  const { note } = req.body
  if (!note || !note.trim()) return badRequest(res, 'Revision note is required')

  const doc = await DrawingDocument.findOne({ _id: req.params.docId, leadId: req.params.leadId })
  if (doc) {
    doc.status = 'under_review'
    doc.revisionNote = note.trim()
    doc.revisionRequestedAt = new Date()
    await doc.save()

    await auditService.log({
      type: 'drawing',
      action: 'drawing.revision_requested',
      leadId: lead._id,
      customerId: req.customer._id,
      performedBy: req.customer._id,
      metadata: { docId: doc._id, name: doc.name, note: note.trim(), source: 'drawing_document' },
    })

    return success(res, {
      message: 'Revision requested',
      drawing: { _id: doc._id, name: doc.name, status: doc.status, revisionNote: doc.revisionNote },
    })
  }

  const plantMatch = await findPlantBuildingDrawing(req.params.leadId, req.params.docId)
  if (!plantMatch) return notFound(res, 'Drawing not found')

  const { building, drawing } = plantMatch
  drawing.status = 'rejected'
  drawing.rejectionReason = note.trim()
  drawing.reviewedAt = new Date()
  await building.save()

  await auditService.log({
    type: 'drawing',
    action: 'drawing.revision_requested',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: {
      docId: drawing._id,
      name: drawing.fileName,
      note: note.trim(),
      source: 'plant_building',
      buildingNumber: building.buildingNumber,
    },
  })

  return success(res, {
    message: 'Revision requested',
    drawing: {
      _id: drawing._id,
      name: drawing.fileName,
      status: 'under_review',
      revisionNote: drawing.rejectionReason,
    },
  })
})

// ── Material Orders ───────────────────────────────────────────────────────────

// Order Details status stepper: new_order -> quotation_received -> quotation_approved -> order_confirmed -> completed
const computeOrderStage = (order, quotation) => {
  if (order.status === 'cancelled' || order.status === 'rejected') return order.status
  if (order.status === 'fulfilled') return 'completed'
  if (!quotation) return 'new_order'
  if (quotation.status === 'sent') return 'quotation_received'
  if (quotation.status === 'approved') return order.status === 'approved' ? 'order_confirmed' : 'quotation_approved'
  return 'new_order'
}

// Per-project tile counts for the Material Orders project list, driven by the same
// stage logic as the Order Details stepper (not raw MaterialRequest.status) so the
// numbers stay consistent between the list screen and the detail screen.
const orderCountsForLead = async (leadId) => {
  const orders = await MaterialRequest.find({ leadId, status: { $nin: ['cancelled', 'rejected'] } }).select('status').lean()
  if (!orders.length) return { newOrders: 0, pending: 0, completed: 0 }

  const quotations = await OrderQuotation.find({ orderId: { $in: orders.map((o) => o._id) } })
    .select('orderId status')
    .sort({ createdAt: -1 })
    .lean()
  const latestQuotationByOrder = new Map()
  for (const q of quotations) {
    const key = String(q.orderId)
    if (!latestQuotationByOrder.has(key)) latestQuotationByOrder.set(key, q)
  }

  const counts = { newOrders: 0, pending: 0, completed: 0 }
  for (const order of orders) {
    const stage = computeOrderStage(order, latestQuotationByOrder.get(String(order._id)))
    if (stage === 'new_order') counts.newOrders += 1
    else if (stage === 'completed') counts.completed += 1
    else counts.pending += 1
  }
  return counts
}

// GET /material-orders/summary — per-project order counts for the "Material Orders" project list
exports.getMaterialOrdersSummary = asyncHandler(async (req, res) => {
  const leads = await Lead.find({ customerId: req.customer._id }).select('projectName jobId location buildingType numberOfBuildings').lean()

  const rows = await Promise.all(leads.map(async (lead) => ({
    leadId: lead._id,
    projectName: lead.projectName,
    jobId: lead.jobId,
    location: lead.location,
    ...(await orderCountsForLead(lead._id)),
  })))

  return success(res, { projects: rows })
})

// GET /projects/:leadId/orders
exports.getProjectOrders = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const { status, page = 1, limit = 20 } = req.query
  const filter = { leadId: req.params.leadId }
  if (status) filter.status = status

  const skip = (Number(page) - 1) * Number(limit)
  const [orders, total] = await Promise.all([
    MaterialRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    MaterialRequest.countDocuments(filter),
  ])

  // Item 7: "Quantity" / "Total Length" columns on the orders table, plus the same computed
  // `stage` the detail stepper uses so the list's status badge (New Order/Quotation Received/
  // Pending/Delivered) is driven by the same logic instead of the raw MaterialRequest.status.
  const quotations = orders.length
    ? await OrderQuotation.find({ orderId: { $in: orders.map(o => o._id) } }).sort({ createdAt: -1 }).lean()
    : []
  const latestQuotationByOrder = new Map()
  for (const q of quotations) {
    const key = String(q.orderId)
    if (!latestQuotationByOrder.has(key)) latestQuotationByOrder.set(key, q)
  }

  const ordersWithTotals = orders.map(order => {
    const totalQuantity = order.requestedItems.reduce((sum, i) => sum + (i.quantity || 0), 0)
    const totalLength = order.requestedItems.reduce((sum, i) => sum + (i.quantity || 0) * (i.lengthFeet || 0), 0)
    return {
      ...order,
      totalQuantity,
      totalLength,
      stage: computeOrderStage(order, latestQuotationByOrder.get(String(order._id))),
    }
  })

  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location },
    orders: ordersWithTotals,
    total,
    counts: await orderCountsForLead(req.params.leadId),
  })
})

// POST /projects/:leadId/orders — "Add New Order" (coil-type/length/quantity line items)
exports.createProjectOrder = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const { buildingLabel, requiredBy, preferredDeliveryDate, priority, specialInstructions, attachments, items } = req.body
  if (!Array.isArray(items) || !items.length) return badRequest(res, 'At least one order line item is required')

  for (const item of items) {
    if (!item.name || item.quantity == null) return badRequest(res, 'Each item needs a coil type (name) and quantity')
  }

  const order = await MaterialRequest.create({
    requestId: await generateMaterialRequestId(),
    leadId: req.params.leadId,
    buildingLabel: buildingLabel || '',
    source: 'customer',
    requestedByCustomer: req.customer._id,
    requestedItems: items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit || 'ft',
      notes: i.notes || '',
      lengthFeet: i.lengthFeet ?? null,
      color: i.color || '',
    })),
    attachments: attachments || [],
    requiredBy: requiredBy || null,
    preferredDeliveryDate: preferredDeliveryDate || null,
    specialInstructions: specialInstructions || '',
    priority: priority || 'medium',
  })

  await auditService.log({
    type: 'lead',
    action: 'material_order.created',
    leadId: lead._id,
    customerId: req.customer._id,
    performedBy: req.customer._id,
    metadata: { requestId: order.requestId },
  })

  return created(res, { order }, 'Order request submitted')
})

// GET /projects/:leadId/orders/:orderId
exports.getProjectOrderDetail = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const order = await MaterialRequest.findOne({ _id: req.params.orderId, leadId: req.params.leadId })
    .populate('requestedByCustomer', 'firstName lastName')
    .populate('requestedBy', 'name')
    .lean()
  if (!order) return notFound(res, 'Order not found')

  const quotation = await OrderQuotation.findOne({ orderId: order._id }).sort({ createdAt: -1 }).lean()

  const createdByName = order.requestedByCustomer
    ? `${order.requestedByCustomer.firstName || ''} ${order.requestedByCustomer.lastName || ''}`.trim()
    : order.requestedBy?.name || ''

  const deliveredItems = order.requestedItems.filter((i) => i.deliveryStatus === 'delivered')
  const pendingItems = order.requestedItems.filter((i) => i.deliveryStatus !== 'delivered')
  const totalQuantity = order.requestedItems.reduce((sum, i) => sum + (i.quantity || 0), 0)
  const totalLength = order.requestedItems.reduce((sum, i) => sum + (i.quantity || 0) * (i.lengthFeet || 0), 0)

  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location },
    order: {
      ...order,
      stage: computeOrderStage(order, quotation),
      createdByName,
      deliveredItems,
      pendingItems,
      totalQuantity,
      totalLength,
    },
    quotation: quotation || null,
  })
})

// ── Order Quotations summary ────────────────────────────────────────────────────

// GET /quotations/summary — per-project quotation counts for the "Order Quotations" project list
// GET /quotations/summary — per-project ORDER quotation counts (coil-order quotes, not the whole-building RFQ Quotation)
exports.getQuotationsSummary = asyncHandler(async (req, res) => {
  const leads = await Lead.find({ customerId: req.customer._id }).select('projectName jobId location').lean()
  const leadIds = leads.map((l) => l._id)

  const quotations = leadIds.length
    ? await OrderQuotation.find({ leadId: { $in: leadIds } }).select('leadId status sentAt').lean()
    : []

  const rows = leads.map((lead) => {
    const forLead = quotations.filter((q) => String(q.leadId) === String(lead._id))
    return {
      leadId: lead._id,
      projectName: lead.projectName,
      jobId: lead.jobId,
      location: lead.location,
      newQuotation: forLead.filter((q) => q.status === 'sent' && new Date(q.sentAt) >= new Date(Date.now() - 7 * 86400000)).length,
      pendingApproval: forLead.filter((q) => q.status === 'sent').length,
      approved: forLead.filter((q) => q.status === 'approved').length,
    }
  })

  return success(res, { projects: rows })
})

// GET /projects/:leadId/order-quotations — "ABC Logistic Warehouse - All Quotations" table
exports.getProjectOrderQuotations = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const { buildingLabel, status, dateFrom, dateTo, page = 1, limit = 20 } = req.query
  const filter = { leadId: req.params.leadId }
  if (buildingLabel) filter.buildingLabel = buildingLabel
  if (status) filter.status = status
  if (dateFrom || dateTo) {
    filter.sentAt = {}
    if (dateFrom) filter.sentAt.$gte = new Date(dateFrom)
    if (dateTo) filter.sentAt.$lte = new Date(dateTo)
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [quotations, total] = await Promise.all([
    OrderQuotation.find(filter).populate('orderId', 'requestId requestDate').sort({ sentAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    OrderQuotation.countDocuments(filter),
  ])

  const rows = quotations.map((q) => ({
    orderId: q.orderId?.requestId || '',
    quotationId: q.quotationNumber,
    quotationRecordId: q._id,
    buildingLabel: q.buildingLabel,
    orderDate: q.orderId?.requestDate || q.createdAt,
    quotationReceived: q.sentAt,
    orderValue: q.totalValue,
    status: q.status,
  }))

  return success(res, {
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId, location: lead.location },
    quotations: rows,
    total,
  })
})

// GET /order-quotations/:quotationId — "Quotation Details" screen
exports.getOrderQuotationDetail = asyncHandler(async (req, res) => {
  const quotation = await OrderQuotation.findOne({ _id: req.params.quotationId, customerId: req.customer._id })
    .populate('orderId', 'requestId requestDate')
    .populate('leadId', 'projectName jobId location')
    .lean()
  if (!quotation) return notFound(res, 'Quotation not found')

  const totalCoilTypes = quotation.lineItems.length
  const totalLength = quotation.lineItems.reduce((s, i) => s + (i.lengthFeet || 0) * i.quantity, 0)
  const totalQuantity = quotation.lineItems.reduce((s, i) => s + i.quantity, 0)

  return success(res, {
    quotation: {
      ...quotation,
      orderRequestId: quotation.orderId?.requestId || '',
      summary: { totalCoilTypes, totalLength, totalQuantity },
    },
  })
})

// POST /order-quotations/:quotationId/approve
exports.approveOrderQuotation = asyncHandler(async (req, res) => {
  const quotation = await OrderQuotation.findOne({ _id: req.params.quotationId, customerId: req.customer._id })
  if (!quotation) return notFound(res, 'Quotation not found')
  if (quotation.status !== 'sent') return badRequest(res, `Quotation already ${quotation.status}`)

  quotation.status = 'approved'
  quotation.respondedAt = new Date()
  await quotation.save()

  await MaterialRequest.findByIdAndUpdate(quotation.orderId, { status: 'approved' })

  await auditService.log({
    type: 'lead', action: 'order_quotation.approved', leadId: quotation.leadId,
    customerId: req.customer._id, performedBy: req.customer._id,
    metadata: { quotationId: quotation._id, quotationNumber: quotation.quotationNumber },
  })

  return success(res, { message: 'Quotation Approved — Submitted Successfully', quotationId: quotation._id, status: quotation.status })
})

// POST /order-quotations/:quotationId/reject
exports.rejectOrderQuotation = asyncHandler(async (req, res) => {
  const quotation = await OrderQuotation.findOne({ _id: req.params.quotationId, customerId: req.customer._id })
  if (!quotation) return notFound(res, 'Quotation not found')
  if (quotation.status !== 'sent') return badRequest(res, `Quotation already ${quotation.status}`)

  quotation.status = 'rejected'
  quotation.respondedAt = new Date()
  quotation.rejectionReason = req.body.reason || ''
  await quotation.save()

  await MaterialRequest.findByIdAndUpdate(quotation.orderId, { status: 'rejected' })

  await auditService.log({
    type: 'lead', action: 'order_quotation.rejected', leadId: quotation.leadId,
    customerId: req.customer._id, performedBy: req.customer._id,
    metadata: { quotationId: quotation._id, quotationNumber: quotation.quotationNumber, reason: req.body.reason || '' },
  })

  return success(res, { message: 'Quotation rejected', quotationId: quotation._id, status: quotation.status })
})

// POST /projects/:leadId/orders/:orderId/cancel
exports.cancelProjectOrder = asyncHandler(async (req, res) => {
  const lead = await assertProjectOwner(req)
  if (!lead) return notFound(res, 'Project not found')

  const order = await MaterialRequest.findOne({ _id: req.params.orderId, leadId: req.params.leadId })
  if (!order) return notFound(res, 'Order not found')
  if (['fulfilled', 'cancelled'].includes(order.status)) return badRequest(res, `Order already ${order.status}`)

  order.status = 'cancelled'
  await order.save()

  return success(res, { orderId: order._id, status: order.status }, 'Order cancelled')
})

// ── Communication / Chat ────────────────────────────────────────────────────────

const CHAT_CHANNELS = [
  { key: 'project', label: 'Project Team' },
  { key: 'finance', label: 'Finance Team' },
  { key: 'construction', label: 'Construction Team' },
]

// GET /chat/channels — per-project channel list with unread counts
// GET /chat/presence?leadId= — initial online/offline state for both sides (sockets only push
// updates after connecting; this covers the state on first page load).
exports.getChatPresence = asyncHandler(async (req, res) => {
  const { leadId } = req.query
  if (!leadId) return badRequest(res, 'leadId is required')

  const lead = await Lead.findById(leadId).select('customerId isOnline').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return notFound(res, 'Project not found')

  const staffPresence = require('../services/socket/staffPresence.service')
  return success(res, {
    leadId,
    customerIsOnline: Boolean(lead.isOnline),
    staffIsOnline: staffPresence.isLeadStaffOnline(leadId),
  })
})

exports.getChatChannels = asyncHandler(async (req, res) => {
  const { leadId } = req.query
  if (!leadId) return badRequest(res, 'leadId is required')

  const lead = await Lead.findById(leadId).select('customerId').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return notFound(res, 'Project not found')

  const channels = await Promise.all(CHAT_CHANNELS.map(async (c) => ({
    ...c,
    unreadCount: await Message.countDocuments({ leadId, channel: c.key, senderType: { $ne: 'customer' }, isRead: false }),
  })))

  return success(res, { channels })
})

// GET /chat/:channel/messages?leadId=
exports.getChatMessages = asyncHandler(async (req, res) => {
  const { leadId, page = 1, limit = 50 } = req.query
  const { channel } = req.params
  if (!leadId) return badRequest(res, 'leadId is required')
  if (!CHAT_CHANNELS.some((c) => c.key === channel)) return badRequest(res, 'Invalid channel')

  const lead = await Lead.findById(leadId).select('customerId').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return notFound(res, 'Project not found')

  const skip = (Number(page) - 1) * Number(limit)
  const [messages, total] = await Promise.all([
    Message.find({ leadId, channel }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Message.countDocuments({ leadId, channel }),
  ])

  await Message.updateMany({ leadId, channel, senderType: { $ne: 'customer' }, isRead: false }, { isRead: true })

  return success(res, { messages: messages.reverse(), total })
})

// POST /chat/:channel/messages { leadId, content }
exports.sendChatMessage = asyncHandler(async (req, res) => {
  const { leadId, content } = req.body
  const { channel } = req.params
  if (!leadId || !content?.trim()) return badRequest(res, 'leadId and content are required')
  if (!CHAT_CHANNELS.some((c) => c.key === channel)) return badRequest(res, 'Invalid channel')

  const lead = await Lead.findById(leadId).select('customerId').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return notFound(res, 'Project not found')

  const message = await Message.create({
    leadId,
    customerId: req.customer._id,
    channel,
    senderType: 'customer',
    senderName: req.customer.firstName || 'Customer',
    content: content.trim(),
  })

  return created(res, { message }, 'Message sent')
})

// ── Notifications ────────────────────────────────────────────────────────────────

const NOTIFICATION_CATEGORY_MAP = {
  drawings: ['drawing'],
  finance: ['payment'],
  meetings: ['meeting'],
}

// GET /notifications?filter=all|unread|drawings|finance|meetings
exports.getCustomerNotifications = asyncHandler(async (req, res) => {
  const customerId = req.customer._id
  const { filter = 'all', page = 1, limit = 20 } = req.query

  const baseFilter = { customerId }
  if (filter === 'unread') baseFilter.isRead = false
  else if (NOTIFICATION_CATEGORY_MAP[filter]) baseFilter.type = { $in: NOTIFICATION_CATEGORY_MAP[filter] }

  const skip = (Number(page) - 1) * Number(limit)
  const [notifications, total] = await Promise.all([
    Notification.find(baseFilter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
    Notification.countDocuments(baseFilter),
  ])

  const now = new Date()
  const stats = {
    total: await Notification.countDocuments({ customerId }),
    unread: await Notification.countDocuments({ customerId, isRead: false }),
    highPriority: await Notification.countDocuments({ customerId, priority: 'high' }),
    today: await Notification.countDocuments({ customerId, createdAt: { $gte: new Date(now.toDateString()) } }),
  }

  return success(res, { notifications, total, stats })
})

// PUT /notifications/:id/read
exports.markCustomerNotificationRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, customerId: req.customer._id })
  if (!notification) return notFound(res, 'Notification not found')

  notification.isRead = true
  await notification.save()

  return success(res, { notificationId: notification._id, isRead: true }, 'Notification marked read')
})

// PUT /notifications/read-all
exports.markAllCustomerNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ customerId: req.customer._id, isRead: false }, { isRead: true })
  return success(res, {}, 'All notifications marked read')
})

// ── Delivery: Site Ready / Equipment confirmation ─────────────────────────────────

// POST /deliveries/:deliveryId/confirm-site-ready
exports.confirmDeliverySiteReady = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery } = owned

  const { siteCleared, accessRouteAvailable, safetyMeasuresInPlace, personnelReady, confirmedBy } = req.body

  const full = await Delivery.findById(delivery._id)
  full.siteReadyConfirmation = {
    confirmed: true,
    confirmedAt: new Date(),
    confirmedBy: confirmedBy || req.customer.firstName || 'Customer',
    checklist: {
      siteCleared: !!siteCleared,
      accessRouteAvailable: !!accessRouteAvailable,
      safetyMeasuresInPlace: !!safetyMeasuresInPlace,
      personnelReady: !!personnelReady,
    },
  }
  await full.save()

  return success(res, { deliveryId: full._id, siteReadyConfirmation: full.siteReadyConfirmation }, 'Site ready confirmed')
})

// POST /deliveries/:deliveryId/confirm-equipment
exports.confirmDeliveryEquipment = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery } = owned

  const { forkliftAvailable, craneOrHeavyMachineryAvailable, storageAreaReady, toolsAndAccessoriesOnSite } = req.body

  const full = await Delivery.findById(delivery._id)
  full.equipmentConfirmation = {
    confirmed: true,
    confirmedAt: new Date(),
    checklist: {
      forkliftAvailable: !!forkliftAvailable,
      craneOrHeavyMachineryAvailable: !!craneOrHeavyMachineryAvailable,
      storageAreaReady: !!storageAreaReady,
      toolsAndAccessoriesOnSite: !!toolsAndAccessoriesOnSite,
    },
  }
  await full.save()

  return success(res, { deliveryId: full._id, equipmentConfirmation: full.equipmentConfirmation }, 'Equipment confirmed')
})

// GET /deliveries/:deliveryId/documents — combined "Delivery Documents" list (Details/Packing List/Instructions)
exports.getDeliveryDocuments = asyncHandler(async (req, res) => {
  const owned = await assertDeliveryOwner(req)
  if (!owned) return notFound(res, 'Delivery not found')
  const { delivery } = owned

  const base = `/api/customer/deliveries/${delivery._id}/download`
  return success(res, {
    documents: [
      { name: 'Delivery Details PDF', type: 'pdf', url: `${base}` },
      { name: 'Packing List', type: 'pdf', url: `${base}/packing-list` },
      { name: 'Instructions', type: 'pdf', url: `${base}/instructions` },
    ],
  })
})

// ── Bundle Scan (QR) ────────────────────────────────────────────────────────────

const assertBundleOwner = async (req, bundleId) => {
  const bundle = await Bundle.findOne({ $or: [{ _id: bundleId.length === 24 ? bundleId : null }, { bundleNo: bundleId }] })
    .populate('packingListId', 'packingListNo truckLabel truckType deliveryLocation')
    .lean()
  if (!bundle) return null
  const lead = await Lead.findById(bundle.leadId).select('customerId projectName jobId location').lean()
  if (!lead || String(lead.customerId) !== String(req.customer._id)) return null
  return { bundle, lead }
}

const buildBundleScanCard = async ({ bundle, lead }) => {
  const delivery = await Delivery.findOne({ leadId: lead._id, status: { $nin: ['draft', 'cancelled'] } })
    .sort({ updatedAt: -1 })
    .select('deliveryNumber status deliveryLocation')
    .lean()

  return {
    bundleId: bundle._id,
    bundleNo: bundle.bundleNo,
    bundleType: bundle.bundleType,
    title: bundle.title,
    totalQty: bundle.totalQty,
    totalWeight: bundle.totalWeight,
    maxLengthFeet: bundle.maxLengthFeet,
    status: bundle.status,
    items: bundle.items || [],
    project: { leadId: lead._id, projectName: lead.projectName, jobId: lead.jobId },
    truck: bundle.packingListId ? { packingListNo: bundle.packingListId.packingListNo, truck: bundle.packingListId.truckLabel || bundle.packingListId.truckType } : null,
    deliveryReference: delivery
      ? { deliveryNumber: delivery.deliveryNumber, destination: delivery.deliveryLocation || lead.location, status: delivery.status }
      : null,
  }
}

// POST /bundles/scan { bundleId } — QR scan / manual bundle-ID entry
exports.scanCustomerBundle = asyncHandler(async (req, res) => {
  const { bundleId } = req.body
  if (!bundleId) return badRequest(res, 'bundleId is required')

  const owned = await assertBundleOwner(req, bundleId)
  if (!owned) return notFound(res, 'Bundle not found')

  return success(res, { bundle: await buildBundleScanCard(owned) })
})

// GET /bundles/:bundleId
exports.getCustomerBundleDetail = asyncHandler(async (req, res) => {
  const owned = await assertBundleOwner(req, req.params.bundleId)
  if (!owned) return notFound(res, 'Bundle not found')

  return success(res, { bundle: await buildBundleScanCard(owned) })
})

// POST /bundles/:bundleId/report-issue { issue }
exports.reportCustomerBundleIssue = asyncHandler(async (req, res) => {
  const { issue } = req.body
  if (!issue?.trim()) return badRequest(res, 'issue is required')

  const owned = await assertBundleOwner(req, req.params.bundleId)
  if (!owned) return notFound(res, 'Bundle not found')

  await Bundle.findByIdAndUpdate(owned.bundle._id, { mismatchNotes: issue.trim(), mismatchReportedAt: new Date() })

  await auditService.log({
    type: 'lead', action: 'bundle.issue_reported', leadId: owned.lead._id,
    customerId: req.customer._id, performedBy: req.customer._id,
    metadata: { bundleId: owned.bundle._id, bundleNo: owned.bundle.bundleNo, issue: issue.trim() },
  })

  return success(res, { bundleId: owned.bundle._id }, 'Issue reported — our team will follow up')
})

// POST /bundles/:bundleId/contact-support { message }
exports.contactSupportForBundle = asyncHandler(async (req, res) => {
  const owned = await assertBundleOwner(req, req.params.bundleId)
  if (!owned) return notFound(res, 'Bundle not found')

  const fullLead = await Lead.findById(owned.lead._id).select('assignedSales').populate('assignedSales', 'name email').lean()
  if (fullLead?.assignedSales?.email) {
    await sendDeliveryCallbackRequestEmail({
      toEmail: fullLead.assignedSales.email,
      salesRepName: fullLead.assignedSales.name || '',
      customerName: `${req.customer.firstName || ''} ${req.customer.lastName || ''}`.trim(),
      customerEmail: req.customer.email,
      customerPhone: req.customer.phone?.number || '',
      projectName: owned.lead.projectName || '',
      jobId: owned.lead.jobId || '',
      deliveryNumber: owned.bundle.bundleNo,
      note: `Bundle support request (${owned.bundle.bundleNo}): ${req.body.message || 'Customer needs help with this bundle'}`,
    })
  }

  return success(res, { bundleId: owned.bundle._id }, 'Support has been notified')
})

// GET /bundles/:bundleId/download — bundle contents PDF
exports.downloadBundleContents = asyncHandler(async (req, res) => {
  const owned = await assertBundleOwner(req, req.params.bundleId)
  if (!owned) return notFound(res, 'Bundle not found')

  const buffer = await generatePackingListDetailPdf(
    { packingListNo: owned.bundle.bundleNo, truck: '', destination: owned.lead.location, totalBundles: 1, totalWeight: owned.bundle.totalWeight, status: owned.bundle.status, project: { projectName: owned.lead.projectName, jobId: owned.lead.jobId } },
    [owned.bundle]
  )

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="bundle-${owned.bundle.bundleNo}-contents.pdf"`)
  return res.send(buffer)
})

// GET /bundles/:bundleId/download/packing-list — packing list PDF for the bundle's truck load
exports.downloadBundlePackingList = asyncHandler(async (req, res) => {
  const owned = await assertBundleOwner(req, req.params.bundleId)
  if (!owned) return notFound(res, 'Bundle not found')

  const siblingBundles = owned.bundle.packingListId
    ? await Bundle.find({ packingListId: owned.bundle.packingListId._id }).select('bundleNo bundleType totalQty totalWeight status').lean()
    : [owned.bundle]

  const buffer = await generatePackingListDetailPdf(
    {
      packingListNo: owned.bundle.packingListId?.packingListNo || owned.bundle.bundleNo,
      truck: owned.bundle.packingListId?.truckLabel || owned.bundle.packingListId?.truckType || '',
      destination: owned.bundle.packingListId?.deliveryLocation || owned.lead.location,
      totalBundles: siblingBundles.length,
      totalWeight: siblingBundles.reduce((s, b) => s + (b.totalWeight || 0), 0),
      status: owned.bundle.status,
      project: { projectName: owned.lead.projectName, jobId: owned.lead.jobId },
    },
    siblingBundles
  )

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="bundle-${owned.bundle.bundleNo}-packing-list.pdf"`)
  return res.send(buffer)
})
