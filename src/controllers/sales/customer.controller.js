const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const Invoice = require('../../models/Invoice')
const Building = require('../../models/Building')
const ProjectBudget = require('../../models/ProjectBudget')
const auditService = require('../../services/audit.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const bcrypt = require('bcryptjs')
const { success, created, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../../config/constants')
const { buildLeadCreatePayload, escapeRegex } = require('../../utils/leadPayload')
const {
  PO_PROJECT_MATCH,
  getSalesCustomerIdsWithRaisedPO,
} = require('../../utils/customerPoFilter')
const { startOfMonth, endOfMonth } = require('date-fns')

const getOwnCustomerIds = async (salesId) => {
  return Lead.find({ assignedSales: salesId }).distinct('customerId')
}

exports.getCustomerStats = asyncHandler(async (req, res) => {
  const salesId = req.user._id
  const now = new Date()
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)

  const ownCustomerIds = await getOwnCustomerIds(salesId)

  const [total, active, newThisMonth, returningAgg] = await Promise.all([
    Customer.countDocuments({ _id: { $in: ownCustomerIds } }),
    Customer.countDocuments({ _id: { $in: ownCustomerIds }, isActive: true }),
    Customer.countDocuments({ _id: { $in: ownCustomerIds }, createdAt: { $gte: monthStart, $lte: monthEnd } }),
    Lead.aggregate([
      { $match: { assignedSales: salesId } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'total' },
    ]),
  ])

  return success(res, {
    total,
    active,
    newThisMonth,
    returning: returningAgg[0]?.total || 0,
  })
})

exports.getCustomers = asyncHandler(async (req, res) => {
  const { search, isActive, page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)

  const poCustomerIds = await getSalesCustomerIdsWithRaisedPO(req.user._id)

  const filter = { _id: { $in: poCustomerIds } }
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), 'i')
    filter.$or = [{ firstName: regex }, { email: regex }, { customerId: regex }]
  }
  if (isActive === 'true') filter.isActive = true
  else if (isActive === 'false') filter.isActive = false

  const skip = (parsedPage - 1) * parsedLimit
  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select('_id customerId firstName email phone source isActive createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Customer.countDocuments(filter),
  ])

  const customerIds = customers.map(c => c._id)
  const projectCounts = await Lead.aggregate([
    { $match: { customerId: { $in: customerIds }, assignedSales: req.user._id, ...PO_PROJECT_MATCH } },
    { $group: { _id: '$customerId', count: { $sum: 1 } } },
  ])
  const countMap = new Map(projectCounts.map(p => [String(p._id), p.count]))

  const result = customers.map(c => ({ ...c, totalProjects: countMap.get(String(c._id)) || 0 }))
  return success(res, { customers: result, total })
})

exports.getCustomerDetail = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const ownCustomerIds = await getOwnCustomerIds(req.user._id)
  const isOwn = ownCustomerIds.some(id => String(id) === customerId)
  if (!isOwn) return forbidden(res, 'Access denied')

  const customer = await Customer.findById(customerId).select('_id customerId firstName email phone isActive source createdAt').lean()
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

exports.updateCustomer = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const { firstName, email, phone, countryCode } = req.body

  if (firstName === undefined && email === undefined && phone === undefined) {
    return badRequest(res, 'At least one of firstName, email, or phone is required')
  }

  const ownCustomerIds = await getOwnCustomerIds(req.user._id)
  const isOwn = ownCustomerIds.some(id => String(id) === customerId)
  if (!isOwn) return forbidden(res, 'Access denied')

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

  return success(res, { customer: customer.toJSON() })
})

exports.getCustomerProjects = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const poCustomerIds = await getSalesCustomerIdsWithRaisedPO(req.user._id)
  const isOwn = poCustomerIds.some(id => String(id) === customerId)
  if (!isOwn) return forbidden(res, 'Access denied')

  const leads = await Lead.find({ customerId, assignedSales: req.user._id, ...PO_PROJECT_MATCH })
    .sort({ createdAt: -1 })
    .lean()

  const leadIds = leads.map(l => l._id)
  const budgets = await ProjectBudget.find({ leadId: { $in: leadIds } }).lean()
  const budgetMap = new Map(budgets.map(b => [String(b.leadId), b]))

  const projects = leads.map(l => {
    const budget = budgetMap.get(String(l._id))
    return {
      _id: l._id,
      projectName: l.projectName || '',
      numberOfBuildings: l.numberOfBuildings,
      lifecycleStatus: l.lifecycleStatus,
      quoteValue: l.quoteValue || 0,
      budget: budget ? {
        totalBudget: budget.totalBudget,
        expectedProfit: (l.quoteValue || 0) - (budget.totalBudget || 0),
      } : null,
      createdAt: l.createdAt,
    }
  })

  return success(res, { projects, total: projects.length })
})

exports.createProject = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const customer = await Customer.findById(customerId).lean()
  if (!customer) return notFound(res, 'Customer not found')

  const ownCustomerIds = await getOwnCustomerIds(req.user._id)
  const isOwn = ownCustomerIds.some(id => String(id) === customerId)
  if (!isOwn) return forbidden(res, 'Access denied — customer not in your portfolio')

  const { payload: leadPayload, error: leadError } = buildLeadCreatePayload(req.body, {
    customerId,
    assignedBy: req.user._id,
    defaultSource: 'manual',
    acceptSource: false,
    forceAssignedSales: req.user._id,
  })
  if (leadError) return badRequest(res, leadError)

  if (leadPayload.projectName) {
    const existingLead = await Lead.findOne({
      customerId,
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
    lifecycleHistory: [
      { stage: 'initial_contact', changedAt: new Date(), changedBy: req.user._id },
    ],
  })

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId,
    performedBy: req.user._id,
    metadata: { source: lead.source, projectName: lead.projectName },
  })

  return created(res, { lead })
})
