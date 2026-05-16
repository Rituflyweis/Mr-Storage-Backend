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
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../../config/constants')
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
    { $match: { customerId: { $in: customerIds } } },
    { $group: { _id: '$customerId', count: { $sum: 1 } } },
  ])
  const countMap = new Map(projectCounts.map(p => [String(p._id), p.count]))

  const result = customers.map(c => ({ ...c, totalProjects: countMap.get(String(c._id)) || 0 }))
  return success(res, { customers: result, total, page: parsedPage, limit: parsedLimit })
})

exports.createCustomerWithLead = asyncHandler(async (req, res) => {
  const { firstName, email, phone, buildingType, location, projectName, countryCode, assignedSales } = req.body

  const existing = await Customer.findOne({ email: email.toLowerCase().trim() })
  if (existing) return badRequest(res, 'Customer with this email already exists')

  const custId = await generateCustomerId()
  const hashed = await bcrypt.hash(phone.trim(), 12)

  const customer = await Customer.create({
    customerId: custId,
    firstName: firstName.trim(),
    email: email.toLowerCase().trim(),
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
    customerId: customer._id,
    projectName: projectName || '',
    buildingType: buildingType || '',
    location: location || '',
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
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { source: 'manual', projectName },
  })

  return created(res, { customer, lead })
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

  const leads = await Lead.find({ customerId })
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

  const lead = await Lead.findOne({ _id: leadId, customerId }).populate('assignedSales').lean()
  if (!lead) return notFound(res, 'Project not found')

  const [quotation, invoices] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).sort({ createdAt: -1 }).lean(),
  ])

  return success(res, { lead, quotation, invoices })
})
