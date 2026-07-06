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
const { success, created, notFound, forbidden, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const bcrypt = require('bcryptjs')
const env = require('../config/env')
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

const { computeInvoiceDueDate } = require('../utils/invoiceDueDate')

const computeDueDate = (invoice) => {
  if (invoice.dueDate) return new Date(invoice.dueDate)
  return computeInvoiceDueDate(invoice.date, invoice.daysToPay)
}

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
    Lead.find({ customerId }).select('lifecycleStatus quoteValue documents jobId projectName').lean(),
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

  const nextDelivery = deliveries
    .filter(d => d.deliveryDate && new Date(d.deliveryDate) >= nowTs && d.status !== 'delivered')
    .sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate))[0] || null

  const shipmentBreakdown = {
    totalLoads: deliveries.length,
    totalBundles: null,
  }

  const projectTimeline = leads.reduce((min, l) => {
    if (!min) return null
    return min
  }, null)

  return success(res, {
    activeProjects,
    closedProjects,
    drawingsAndApprovals,
    projectTimeline: null,
    totalProjectValue,
    totalPaid,
    totalPending,
    upcomingInvoice,
    deliveryTracking,
    shipmentBreakdown,
    nextDelivery: nextDelivery ? {
      deliveryId: nextDelivery._id,
      deliveryNumber: nextDelivery.deliveryNumber,
      description: nextDelivery.loadDescription || nextDelivery.description || '',
      status: nextDelivery.status,
      deliveryDate: nextDelivery.deliveryDate,
      estimatedWeight: nextDelivery.loadWeight || null,
    } : null,
  })
})

// ── Projects ──────────────────────────────────────────────────────────────────

exports.getProjects = asyncHandler(async (req, res) => {
  const { lifecycleStatus, page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = { customerId: req.customer._id }
  if (lifecycleStatus) filter.lifecycleStatus = lifecycleStatus

  const [projects, total] = await Promise.all([
    Lead.find(filter)
      .select('jobId projectName buildingType location lifecycleStatus quoteValue isQuoteReady source documents assignedSales')
      .populate('assignedSales', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, {
    projects: projects.map(enrichLeadDocument),
    total,
    page: Number(page),
    limit: Number(limit),
  })
})

exports.getProject = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId)
    .select('customerId buildingType location lifecycleStatus quoteValue documents assignedSales')
    .populate('assignedSales', 'name email')
    .lean()

  if (!lead) return notFound(res, 'No project found with that ID')
  if (String(lead.customerId) !== String(req.customer._id)) {
    return forbidden(res, 'This project does not belong to your account')
  }

  const [quotation, invoices, paymentSchedules] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).select('-paidBy -createdBy -__v').sort({ createdAt: -1 }).lean(),
    PaymentSchedule.find({ leadId }).lean(),
  ])

  let quoteSummary = null
  if (quotation) {
    quoteSummary = await QuoteSummary.findOne({ quotationId: quotation._id })
      .select('summary generatedAt').lean()
  }

  // Strip internalNotes from quotation
  if (quotation) delete quotation.internalNotes

  // Attach paymentSchedule to each invoice, inject dueDate
  const invoicesWithSchedule = invoices.map(inv => {
    const schedule = paymentSchedules.find(ps => String(ps.invoiceId) === String(inv._id))
    return {
      ...inv,
      dueDate:         computeDueDate(inv),
      paymentSchedule: schedule ? { totalAmount: schedule.totalAmount, payments: schedule.payments } : null,
    }
  })

  // Expose only first payment schedule at top level (spec shows single paymentSchedule)
  const firstSchedule = paymentSchedules[0]
    ? { totalAmount: paymentSchedules[0].totalAmount, payments: paymentSchedules[0].payments }
    : null

  return success(res, {
    lead: enrichLeadDocument(lead),
    quotation,
    quoteSummary,
    invoices: invoicesWithSchedule,
    paymentSchedule: firstSchedule,
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
    .select('buildingType location lifecycleStatus documents')
    .lean()

  let totalDocuments = 0
  const projects = []

  for (const lead of leads) {
    let docs = lead.documents
    if (type) docs = docs.filter(d => d.type === type)
    if (docs.length === 0) continue

    totalDocuments += docs.length
    projects.push({
      lead: {
        _id:             lead._id,
        buildingType:    lead.buildingType,
        location:        lead.location,
        lifecycleStatus: lead.lifecycleStatus,
      },
      documents: docs,
      count:     docs.length,
    })
  }

  return success(res, { projects, totalDocuments })
})

// ── Payments ──────────────────────────────────────────────────────────────────

exports.getPayments = asyncHandler(async (req, res) => {
  const customerId = req.customer._id

  const [invoices, leads] = await Promise.all([
    Invoice.find({ customerId }).select('-paidBy -createdBy -__v').lean(),
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
  const { status } = req.query
  const customerId = req.customer._id

  const invoiceFilter = { customerId }
  if (status) invoiceFilter.status = status

  const [invoices, leads] = await Promise.all([
    Invoice.find(invoiceFilter).select('-paidBy -createdBy -__v').sort({ createdAt: -1 }).lean(),
    Lead.find({ customerId }).select('buildingType location lifecycleStatus').lean(),
  ])

  const leadMap = Object.fromEntries(leads.map(l => [String(l._id), l]))

  // Group invoices by leadId
  const grouped = {}
  for (const inv of invoices) {
    const key = String(inv.leadId)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push({ ...inv, dueDate: computeDueDate(inv) })
  }

  const projects = Object.entries(grouped).map(([leadId, invs]) => {
    const lead = leadMap[leadId]
    const projectTotal   = invs.reduce((s, i) => s + i.totalAmount, 0)
    const projectPaid    = invs.filter(i => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
    const projectPending = invs.filter(i => i.status !== 'paid').reduce((s, i) => s + i.totalAmount, 0)

    return {
      lead: lead
        ? { _id: lead._id, buildingType: lead.buildingType, location: lead.location, lifecycleStatus: lead.lifecycleStatus }
        : { _id: leadId },
      invoices: invs,
      projectTotal,
      projectPaid,
      projectPending,
    }
  })

  return success(res, { projects })
})

// ── Delivery Schedule ─────────────────────────────────────────────────────────

exports.getDeliverySchedule = asyncHandler(async (req, res) => {
  const customerId = req.customer._id
  const { tab = 'upcoming' } = req.query

  const leads = await Lead.find({ customerId }).select('_id jobId projectName').lean()
  if (!leads.length) return success(res, { deliveries: [], total: 0 })

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

  const result = deliveries.map(d => {
    const lead = leadMap.get(String(d.leadId)) || {}
    const bid = d.selectedCarrierBidId ? bidMap.get(String(d.selectedCarrierBidId)) : null
    const carrier = bid?.carrierId || null

    return {
      deliveryId: d._id,
      deliveryNumber: d.deliveryNumber,
      status: d.status,
      description: d.loadDescription || d.description || '',
      deliveryDate: d.deliveryDate,
      timings: d.timings || '',
      pickupDate: d.pickupDate,
      estimatedWeight: d.loadWeight || null,
      loadingEquipment: d.loadingEquipment || [],
      siteInstructions: d.specialRequirements || '',
      specialNotes: d.additionalNotes || '',
      siteContact: {
        name: d.receivingPoc || '',
        phone: d.pickupContactPhone || '',
      },
      deliveryCompany: carrier ? {
        name: carrier.carrierName || '',
        driver: carrier.contactName || '',
        phone: carrier.phone || '',
        email: carrier.email || '',
      } : null,
      project: {
        leadId: lead._id || d.leadId,
        projectId: lead.jobId || '',
        projectName: lead.projectName || '',
      },
    }
  })

  const upcomingCount = await Delivery.countDocuments({ leadId: { $in: leadIds }, deliveryDate: { $gte: now }, status: { $nin: ['draft', 'cancelled', 'delivered'] } })
  const pastCount = await Delivery.countDocuments({ leadId: { $in: leadIds }, $or: [{ status: 'delivered' }, { deliveryDate: { $lt: now }, status: { $nin: ['draft', 'cancelled'] } }] })
  const rescheduledCount = await Delivery.countDocuments({ leadId: { $in: leadIds }, status: 'rescheduled' })

  return success(res, {
    deliveries: result,
    total: result.length,
    tabs: { upcoming: upcomingCount, past: pastCount, rescheduled: rescheduledCount },
  })
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
