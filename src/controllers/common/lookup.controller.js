const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const { success } = require('../../utils/apiResponse')
const { enrichLeadDocument } = require('../../utils/leadProjectId')
const asyncHandler = require('../../utils/asyncHandler')

const buildCustomerSearchFilter = (search) => {
  if (!search || !search.trim()) return {}
  const regex = new RegExp(search.trim(), 'i')
  return {
    $or: [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { customerId: regex },
      { 'phone.number': regex },
    ],
  }
}

const buildLeadSearchFilter = async (search) => {
  if (!search || !search.trim()) return {}
  const regex = new RegExp(search.trim(), 'i')
  const matchingCustomerIds = await Customer.find({
    $or: [
      { firstName: regex },
      { lastName: regex },
      { email: regex },
      { customerId: regex },
      { 'phone.number': regex },
    ],
  }).distinct('_id')

  return {
    $or: [
      { projectName: regex },
      { jobId: regex },
      { location: regex },
      { buildingType: regex },
      { customerId: { $in: matchingCustomerIds } },
    ],
  }
}

exports.listCustomers = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(1, Number(page) || 1)
  const parsedLimit = Math.min(Math.max(1, Number(limit) || 20), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = buildCustomerSearchFilter(search)

  if (req.user.role === 'sales') {
    const customerIds = await Lead.distinct('customerId', { assignedSales: req.user._id })
    if (!customerIds.length) {
      return success(res, { customers: [], total: 0, page: parsedPage, limit: parsedLimit })
    }
    filter._id = { $in: customerIds }
  }

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Customer.countDocuments(filter),
  ])

  return success(res, { customers, total, page: parsedPage, limit: parsedLimit })
})

exports.listLeads = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query
  const parsedPage = Math.max(1, Number(page) || 1)
  const parsedLimit = Math.min(Math.max(1, Number(limit) || 20), 100)
  const skip = (parsedPage - 1) * parsedLimit

  const filter = {}
  if (req.user.role === 'sales') {
    filter.assignedSales = req.user._id
  }

  const searchFilter = await buildLeadSearchFilter(search)
  if (Object.keys(searchFilter).length) {
    Object.assign(filter, searchFilter)
  }

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate({ path: 'customerId', select: '-password' })
      .populate({ path: 'assignedSales', select: 'name email' })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, {
    leads: leads.map(enrichLeadDocument),
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})
