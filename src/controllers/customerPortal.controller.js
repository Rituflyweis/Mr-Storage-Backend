const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const Quotation = require('../models/Quotation')
const QuoteSummary = require('../models/QuoteSummary')
const PaymentSchedule = require('../models/PaymentSchedule')
const { success, created, notFound, forbidden, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const bcrypt = require('bcryptjs')

const CLOSED_STAGES = ['payment_done', 'delivered']

const computeDueDate = (invoice) => {
  if (!invoice.daysToPay || !invoice.date) return null
  return new Date(new Date(invoice.date).getTime() + invoice.daysToPay * 24 * 60 * 60 * 1000)
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
    Lead.find({ customerId }).select('lifecycleStatus quoteValue documents').lean(),
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

  return success(res, {
    activeProjects,
    closedProjects,
    drawingsAndApprovals,
    totalProjectValue,
    totalPaid,
    totalPending,
    upcomingInvoice,
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
      .select('buildingType location lifecycleStatus quoteValue isQuoteReady source documents assignedSales')
      .populate('assignedSales', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { projects, total, page: Number(page), limit: Number(limit) })
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
    lead,
    quotation,
    quoteSummary,
    invoices: invoicesWithSchedule,
    paymentSchedule: firstSchedule,
  })
})

exports.createProject = asyncHandler(async (req, res) => {
  const { buildingType, location } = req.body
  if (!buildingType) return badRequest(res, 'buildingType is required to create a project')
  if (!location)     return badRequest(res, 'location is required to create a project')

  const lead = await Lead.create({
    customerId:    req.customer._id,
    buildingType,
    location,
    source:        'customer_portal',
    lifecycleStatus: 'initial_contact',
  })

  return created(res, {
    lead: {
      _id:             lead._id,
      buildingType:    lead.buildingType,
      location:        lead.location,
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
