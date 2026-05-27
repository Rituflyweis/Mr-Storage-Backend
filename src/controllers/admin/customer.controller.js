const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
const ProjectBudget = require('../../models/ProjectBudget')
const auditService = require('../../services/audit.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const bcrypt = require('bcryptjs')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, CLOSED_STAGES, INVOICE_STATUSES } = require('../../config/constants')
const { buildLeadCreatePayload } = require('../../utils/leadPayload')
const {
  PO_PROJECT_MATCH,
  getCustomerIdsWithRaisedPO,
} = require('../../utils/customerPoFilter')
const { startOfMonth, endOfMonth } = require('date-fns')

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const [totalCustomers, activeCustomers, totalProjects, inExecution, notAssigned, completed, returningAgg] = await Promise.all([
    Customer.countDocuments(),
    Customer.countDocuments({ isActive: true }),
    Lead.countDocuments(),
    Lead.countDocuments({ lifecycleStatus: { $nin: [...CLOSED_STAGES, 'initial_contact'] }, isTerminated: false }),
    Lead.countDocuments({ assignedSales: null, isTerminated: false }),
    Lead.countDocuments({ lifecycleStatus: { $in: CLOSED_STAGES } }),
    Lead.aggregate([
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'total' },
    ]),
  ])

  return success(res, {
    totalCustomers,
    activeCustomers,
    totalProjects,
    projectsInExecution: inExecution,
    projectsNotAssigned: notAssigned,
    completedProjects: completed,
  })
})

exports.getAllCustomers = asyncHandler(async (req, res) => {
  const { isActive, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (isActive !== undefined) filter.isActive = isActive === 'true'
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

  const result = customers.map(c => ({ ...c, totalProjects: countMap.get(String(c._id)) || 0 }))
  return success(res, { customers: result, total, page: parsedPage, limit: parsedLimit })
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

  return created(res, { customer, lead })
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
    return {
      _id: l._id,
      projectName: l.projectName || '',
      numberOfBuildings: l.numberOfBuildings,
      lifecycleStatus: l.lifecycleStatus,
      assignedSales: l.assignedSales,
      quoteValue: l.quoteValue || 0,
      isTerminated: l.isTerminated,
      budget: b ? { totalBudget: b.totalBudget, expectedProfit: (l.quoteValue || 0) - (b.totalBudget || 0) } : null,
      createdAt: l.createdAt,
    }
  })

  return success(res, { projects, total: projects.length })
})

exports.getCustomerProject = asyncHandler(async (req, res) => {
  const { customerId, leadId } = req.params

  const lead = await Lead.findOne({ _id: leadId, customerId, ...PO_PROJECT_MATCH }).populate('assignedSales').lean()
  if (!lead) return notFound(res, 'Project not found')

  const [quotation, invoices] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).sort({ createdAt: -1 }).lean(),
  ])

  return success(res, { lead, quotation, invoices })
})
