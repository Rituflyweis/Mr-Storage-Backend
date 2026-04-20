const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const Invoice = require('../../models/Invoice')
const Quotation = require('../../models/Quotation')
const QuoteSummary = require('../../models/QuoteSummary')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')

exports.getAllCustomers = asyncHandler(async (req, res) => {
  const { isActive, search, page = 1, limit = 20 } = req.query
  const dateFilter = buildDateFilter(req.query)

  const filter = { ...dateFilter }
  if (isActive !== undefined) filter.isActive = isActive === 'true'
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ]
  }

  const skip = (parseInt(page) - 1) * parseInt(limit)
  const [customers, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    Customer.countDocuments(filter),
  ])

  return success(res, { customers, total, page: parseInt(page), limit: parseInt(limit) })
})

exports.getCustomerDetail = asyncHandler(async (req, res) => {
  const { customerId } = req.params

  const customer = await Customer.findById(customerId).lean()
  if (!customer) return notFound(res, 'Customer not found')

  const [leads, invoices] = await Promise.all([
    Lead.find({ customerId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ customerId }).sort({ createdAt: -1 }).lean(),
  ])

  const totalPaid = invoices
    .filter(i => i.status === 'paid')
    .reduce((sum, i) => sum + (i.totalAmount || 0), 0)

  const totalPending = invoices
    .filter(i => ['sent', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + (i.totalAmount || 0), 0)

  return success(res, {
    customer,
    totalPaid,
    totalPending,
    totalInvoices: invoices.length,
    projects: leads,
    invoices,
  })
})

exports.getCustomerProject = asyncHandler(async (req, res) => {
  const { customerId, leadId } = req.params

  const lead = await Lead.findOne({ _id: leadId, customerId })
    .populate('assignedSales')
    .lean()
  if (!lead) return notFound(res, 'Project not found')

  const [quotation, invoices] = await Promise.all([
    Quotation.findOne({ leadId }).sort({ createdAt: -1 }).lean(),
    Invoice.find({ leadId }).sort({ createdAt: -1 }).lean(),
  ])

  let quoteSummary = null
  if (quotation) {
    quoteSummary = await QuoteSummary.findOne({ quotationId: quotation._id }).lean()
  }

  return success(res, { lead, quotation, quoteSummary, invoices })
})
