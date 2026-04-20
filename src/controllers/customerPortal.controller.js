const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Invoice = require('../models/Invoice')
const { success, created, notFound, forbidden } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { LEAD_SOURCES } = require('../config/constants')

// Fields visible to the customer on their own leads
const LEAD_PUBLIC_FIELDS = '_id buildingType location lifecycleStatus quoteValue isQuoteReady source createdAt updatedAt'

exports.getProfile = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.customer._id).lean()
  if (!customer) return notFound(res, 'Customer not found')

  const projectCount = await Lead.countDocuments({ customerId: customer._id })

  return success(res, { customer: { ...customer, projectCount } })
})

exports.getProjects = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = { customerId: req.customer._id }

  const [projects, total] = await Promise.all([
    Lead.find(filter)
      .select(LEAD_PUBLIC_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Lead.countDocuments(filter),
  ])

  return success(res, { projects, total, page: Number(page), limit: Number(limit) })
})

exports.getProject = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.projectId)
    .select(LEAD_PUBLIC_FIELDS)
    .lean()

  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Access denied')

  return success(res, { project: lead })
})

exports.getProjectFiles = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.projectId)
    .select('customerId documents')
    .lean()

  if (!lead) return notFound(res, 'Project not found')
  if (String(lead.customerId) !== String(req.customer._id)) return forbidden(res, 'Access denied')

  const files = lead.documents.map(doc => ({
    fileId:     doc._id,
    fileName:   doc.name,
    url:        doc.url,
    uploadedAt: doc.uploadedAt,
  }))

  return success(res, { files })
})

exports.getInvoices = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, leadId } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter = { customerId: req.customer._id }
  if (status) filter.status = status
  if (leadId) filter.leadId = leadId

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .select('-__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Invoice.countDocuments(filter),
  ])

  return success(res, { invoices, total, page: Number(page), limit: Number(limit) })
})

exports.createProject = asyncHandler(async (req, res) => {
  const { buildingType, location, source } = req.body

  const leadData = { customerId: req.customer._id }
  if (buildingType) leadData.buildingType = buildingType
  if (location) leadData.location = location
  if (source && LEAD_SOURCES.includes(source)) leadData.source = source

  const lead = await Lead.create(leadData)

  return created(res, {
    leadId:     lead._id,
    customerId: lead.customerId,
  })
})
