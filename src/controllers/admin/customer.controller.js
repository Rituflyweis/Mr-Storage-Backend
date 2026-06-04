const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const POOrder = require('../../models/POOrder')
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
const ProjectBudget = require('../../models/ProjectBudget')
const auditService = require('../../services/audit.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const bcrypt = require('bcryptjs')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, INVOICE_STATUSES } = require('../../config/constants')
const { withProjectIdFields, enrichLeadDocument } = require('../../utils/leadProjectId')
const { buildLeadCreatePayload } = require('../../utils/leadPayload')
const {
  PO_PROJECT_MATCH,
  getCustomerIdsWithRaisedPO,
} = require('../../utils/customerPoFilter')
const {
  computeProjectInvoiceStats,
  mapProjectInvoiceRow,
} = require('../../utils/projectInvoiceMetrics')
const {
  ACTIVE_PROJECT_MATCH,
  COMPLETED_PROJECT_MATCH,
  NOT_ASSIGNED_PROJECT_MATCH,
  getProjectScopeFilter,
  mapCustomerListRow,
  mapProjectListRow,
} = require('../../utils/customerProjectScope')

const loadCustomerProject = async (customerId, leadId) => {
  const customer = await Customer.findById(customerId).select('_id').lean()
  if (!customer) return { error: 'Customer not found', code: 404 }

  const lead = await Lead.findOne({ _id: leadId, customerId, ...PO_PROJECT_MATCH })
    .select('_id jobId projectName quoteValue customerId')
    .lean()
  if (!lead) return { error: 'Project not found', code: 404 }

  return { customer, lead }
}
exports.getCustomerStats = asyncHandler(async (req, res) => {
  const poCustomerIds = await getCustomerIdsWithRaisedPO()

  const [totalCustomers, activeCustomers, totalProjects, activeProjects, notAssigned, completed] = await Promise.all([
    Customer.countDocuments({ _id: { $in: poCustomerIds } }),
    Customer.countDocuments({ _id: { $in: poCustomerIds }, isActive: true }),
    Lead.countDocuments(PO_PROJECT_MATCH),
    Lead.countDocuments(ACTIVE_PROJECT_MATCH),
    Lead.countDocuments(NOT_ASSIGNED_PROJECT_MATCH),
    Lead.countDocuments(COMPLETED_PROJECT_MATCH),
  ])

  return success(res, {
    totalCustomers,
    activeCustomers,
    totalProjects,
    activeProjects,
    projectsNotAssigned: notAssigned,
    completedProjects: completed,
  })
})

exports.getAllCustomers = asyncHandler(async (req, res) => {
  const { scope, isActive, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (scope === 'active') filter.isActive = true
  else if (isActive !== undefined) filter.isActive = isActive === 'true'
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    filter.$or = [
      { firstName: regex },
      { email: regex },
      { customerId: regex },
    ]
  }

  const poCustomerIds = await getCustomerIdsWithRaisedPO()
  filter._id = { $in: poCustomerIds }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select('_id customerId firstName email phone isActive source createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Customer.countDocuments(filter),
  ])

  const customerIds = customers.map(c => c._id)
  const projectCounts = await Lead.aggregate([
    { $match: { customerId: { $in: customerIds }, ...PO_PROJECT_MATCH } },
    { $group: { _id: '$customerId', count: { $sum: 1 } } },
  ])
  const countMap = new Map(projectCounts.map(p => [String(p._id), p.count]))

  const result = customers.map(c => mapCustomerListRow(c, countMap.get(String(c._id)) || 0))
  return success(res, { customers: result, total, page: parsedPage, limit: parsedLimit })
})

exports.getAdminProjectList = asyncHandler(async (req, res) => {
  const { scope = 'total', search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...getProjectScopeFilter(scope), ...dateFilter }
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    const matchingCustomers = await Customer.find({
      $or: [{ firstName: regex }, { email: regex }, { customerId: regex }],
    }).select('_id').lean()
    filter.$or = [
      { projectName: regex },
      { jobId: regex },
      { customerId: { $in: matchingCustomers.map(c => c._id) } },
    ]
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .select('_id jobId projectName quoteValue lifecycleStatus customerId createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  const customerIds = [...new Set(leads.map(l => String(l.customerId)))]
  const customers = await Customer.find({ _id: { $in: customerIds } })
    .select('_id firstName')
    .lean()
  const customerMap = new Map(customers.map(c => [String(c._id), c]))

  let poRaisedMap = new Map()
  if (scope === 'not-assigned' && leads.length) {
    const poOrders = await POOrder.find({ leadId: { $in: leads.map(l => l._id) } })
      .select('leadId createdAt')
      .lean()
    poRaisedMap = new Map(poOrders.map(o => [String(o.leadId), o.createdAt]))
  }

  const includePoRaisedAt = scope === 'not-assigned'
  const projects = leads.map(lead => mapProjectListRow(
    lead,
    customerMap.get(String(lead.customerId)),
    {
      includePoRaisedAt,
      poRaisedAt: poRaisedMap.get(String(lead._id)) || null,
    }
  ))

  return success(res, { projects, total, page: parsedPage, limit: parsedLimit, scope })
})

exports.createCustomerWithLead = asyncHandler(async (req, res) => {
  const { firstName, email, phone, countryCode } = req.body
  const normalizedEmail = email.toLowerCase().trim()

  const existing = await Customer.findOne({ email: normalizedEmail })
  if (existing) return badRequest(res, 'Customer with this email already exists')

  const { payload: leadPayload, error: leadError } = buildLeadCreatePayload(req.body, {
    customerId: null,
    assignedBy: req.user._id,
    defaultSource: 'manual',
    acceptSource: false,
  })
  if (leadError) return badRequest(res, leadError)

  const custId = await generateCustomerId()
  const hashed = await bcrypt.hash(phone.trim(), 12)

  const customer = await Customer.create({
    customerId: custId,
    firstName: firstName.trim(),
    email: normalizedEmail,
    phone: { number: phone.trim(), countryCode: countryCode || '' },
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

  const lead = await Lead.create({
    ...leadPayload,
    customerId: customer._id,
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { source: lead.source, projectName: lead.projectName },
  })

  return created(res, { customer, lead: enrichLeadDocument(lead) })
})

exports.updateCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const { firstName, email, phone, countryCode } = req.body

  if (firstName === undefined && email === undefined && phone === undefined) {
    return badRequest(res, 'At least one of firstName, email, or phone is required')
  }

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  if (firstName !== undefined) {
    const trimmed = String(firstName).trim()
    if (!trimmed) return badRequest(res, 'firstName cannot be empty')
    customer.firstName = trimmed
  }

  if (email !== undefined) {
    const normalizedEmail = String(email).toLowerCase().trim()
    if (!normalizedEmail) return badRequest(res, 'email cannot be empty')
    const emailTaken = await Customer.findOne({
      email: normalizedEmail,
      _id: { $ne: customer._id },
    }).lean()
    if (emailTaken) return badRequest(res, 'Customer with this email already exists')
    customer.email = normalizedEmail
  }

  if (phone !== undefined) {
    const trimmedPhone = String(phone).trim()
    if (!trimmedPhone) return badRequest(res, 'phone cannot be empty')
    customer.phone = {
      number: trimmedPhone,
      countryCode: countryCode !== undefined ? String(countryCode).trim() : (customer.phone?.countryCode || ''),
    }
  } else if (countryCode !== undefined) {
    customer.phone = {
      number: customer.phone?.number || '',
      countryCode: String(countryCode).trim(),
    }
  }

  await customer.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { firstName: customer.firstName, email: customer.email },
  })

  const customerResponse = customer.toJSON()
  return success(res, { customer: customerResponse })
})

exports.deactivateCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const customer = await Customer.findById(customerId)
  if (!customer) return notFound(res, 'Customer not found')

  const activating = customer.isActive === false
  customer.isActive = activating
  await customer.save()

  await auditService.log({
    type: 'lead',
    action: activating ? AUDIT_ACTIONS.CUSTOMER_ACTIVATED : AUDIT_ACTIONS.CUSTOMER_DEACTIVATED,
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { email: customer.email },
  })

  const message = activating ? 'Customer activated' : 'Customer deactivated'
  return success(res, { customer: customer.toJSON() }, message)
})

exports.getCustomerInvoices = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const { status, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const customer = await Customer.findById(customerId).select('_id customerId firstName').lean()
  if (!customer) return notFound(res, 'Customer not found')

  const filter = { customerId: customer._id, ...dateFilter }
  if (status) {
    if (!INVOICE_STATUSES.includes(status)) {
      return badRequest(res, 'Invalid invoice status')
    }
    filter.status = status
  }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .populate({ path: 'leadId', select: 'projectName jobId lifecycleStatus' })
      .populate({ path: 'createdBy', select: 'name email' })
      .populate({ path: 'paidBy', select: 'name email' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Invoice.countDocuments(filter),
  ])

  return success(res, {
    customer: {
      _id: customer._id,
      customerId: customer.customerId,
      firstName: customer.firstName,
    },
    invoices,
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

exports.getCustomerDetail = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const customer = await Customer.findById(customerId)
    .select('_id customerId firstName email phone isActive source createdAt')
    .lean()
  if (!customer) return notFound(res, 'Customer not found')

  const invoices = await Invoice.find({ customerId }).lean()
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalAmount || 0), 0)
  const pendingPayment = invoices.filter(i => ['sent', 'overdue'].includes(i.status)).reduce((s, i) => s + (i.totalAmount || 0), 0)
  const revenueGenerated = totalPaid

  return success(res, {
    customer,
    financials: { totalPaid, pendingPayment, totalInvoices: invoices.length, revenueGenerated },
  })
})

exports.getCustomerProjects = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const customer = await Customer.findById(customerId).lean()
  if (!customer) return notFound(res, 'Customer not found')

  const leads = await Lead.find({ customerId, ...PO_PROJECT_MATCH })
    .populate({ path: 'assignedSales', select: 'name' })
    .sort({ createdAt: -1 })
    .lean()

  const leadIds = leads.map(l => l._id)
  const budgets = await ProjectBudget.find({ leadId: { $in: leadIds } }).lean()
  const budgetMap = new Map(budgets.map(b => [String(b.leadId), b]))

  const projects = leads.map(l => {
    const b = budgetMap.get(String(l._id))
    return withProjectIdFields({
      _id: l._id,
      projectName: l.projectName || '',
      numberOfBuildings: l.numberOfBuildings,
      lifecycleStatus: l.lifecycleStatus,
      assignedSales: l.assignedSales,
      quoteValue: l.quoteValue || 0,
      isTerminated: l.isTerminated,
      budget: b ? { totalBudget: b.totalBudget, expectedProfit: (l.quoteValue || 0) - (b.totalBudget || 0) } : null,
      createdAt: l.createdAt,
    }, l.jobId)
  })

  return success(res, { projects, total: projects.length })
})

exports.getProjectInvoiceStats = asyncHandler(async (req, res) => {
  const { customerId, leadId } = req.params
  const loaded = await loadCustomerProject(customerId, leadId)
  if (loaded.error) return notFound(res, loaded.error)

  const invoices = await Invoice.find({ leadId, status: { $ne: 'cancelled' } })
    .select('status totalAmount dueDate date daysToPay paidAt')
    .lean()

  const stats = computeProjectInvoiceStats(invoices)

  return success(res, {
    leadId,
    customerId,
    projectName: loaded.lead.projectName || '',
    jobId: loaded.lead.jobId || '',
    projectId: loaded.lead.jobId || '',
    ...stats,
  })
})

exports.getProjectInvoices = asyncHandler(async (req, res) => {
  const { customerId, leadId } = req.params
  const loaded = await loadCustomerProject(customerId, leadId)
  if (loaded.error) return notFound(res, loaded.error)

  const dateFilter = buildDateFilter(req.query, 'createdAt')
  const { status } = req.query
  if (status && !INVOICE_STATUSES.includes(status)) {
    return badRequest(res, 'Invalid invoice status')
  }

  const filter = { leadId, ...dateFilter }
  if (status) filter.status = status

  const invoices = await Invoice.find(filter)
    .select('invoiceNumber status totalAmount date dueDate daysToPay paidAt createdAt')
    .sort({ createdAt: -1 })
    .lean()

  const now = new Date()
  const payments = invoices.map(inv => mapProjectInvoiceRow(inv, now))

  return success(res, {
    leadId,
    customerId,
    projectName: loaded.lead.projectName || '',
    jobId: loaded.lead.jobId || '',
    projectId: loaded.lead.jobId || '',
    payments,
    total: payments.length,
  })
})

exports.getCustomerProject = asyncHandler(async (req, res) => {
  const { customerId, leadId } = req.params

  const lead = await Lead.findOne({ _id: leadId, customerId, ...PO_PROJECT_MATCH }).populate('assignedSales').lean()
  if (!lead) return notFound(res, 'Project not found')

  const [quotation, invoices] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).sort({ createdAt: -1 }).lean(),
  ])

  return success(res, { lead: enrichLeadDocument(lead), quotation, invoices })
})
