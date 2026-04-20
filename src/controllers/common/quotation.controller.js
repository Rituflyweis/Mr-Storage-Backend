const Quotation = require('../../models/Quotation')
const QuoteSummary = require('../../models/QuoteSummary')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const mailer = require('../../services/email/mailer')
const quoteSummaryService = require('../../services/ai/quoteSummary.service')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildDateFilter } = require('../../utils/dateRange')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES } = require('../../config/constants')

// Sales can only act on their assigned leads
const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

exports.createQuotation = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  const { lead, error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const quotation = await Quotation.create({
    ...req.body,
    createdBy: req.user._id,
  })

  // Sync lead — mark quote ready and update quoteValue
  const leadUpdate = { isQuoteReady: true }
  if (quotation.basePrice) leadUpdate.quoteValue = quotation.basePrice
  await Lead.findByIdAndUpdate(leadId, leadUpdate)

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_CREATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id, basePrice: quotation.basePrice },
  })

  return created(res, { quotation })
})

exports.getQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId).lean()
  if (!quotation) return notFound(res, 'Quotation not found')
  return success(res, { quotation })
})

exports.updateQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId)
  if (!quotation) return notFound(res, 'Quotation not found')
  if (quotation.status !== 'draft') return badRequest(res, 'Only draft quotations can be edited')

  const ALLOWED = [
    'buildingType','basePrice','maxPrice','sqft','width','length','height',
    'currency','roofStyle','validTill','location','windLoad','snowLoad',
    'paymentTerms','companyName','estimatedDelivery','includedMaterials',
    'optionalAddOns','specialNote','internalNotes','priorityLevel',
  ]
  const prevBasePrice = quotation.basePrice
  ALLOWED.forEach(k => { if (req.body[k] !== undefined) quotation[k] = req.body[k] })
  await quotation.save()

  // Keep lead.quoteValue in sync when basePrice changes
  if (req.body.basePrice !== undefined && req.body.basePrice !== prevBasePrice) {
    await Lead.findByIdAndUpdate(quotation.leadId, { quoteValue: req.body.basePrice })
  }

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_EDITED,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id },
  })

  return success(res, { quotation })
})

exports.sendQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId)
  if (!quotation) return notFound(res, 'Quotation not found')

  const customer = await Customer.findById(quotation.customerId)
  if (!customer) return notFound(res, 'Customer not found')

  await mailer.sendQuotation({
    toEmail: customer.email,
    customerName: customer.firstName,
    quotation,
  })

  quotation.status = 'sent'
  quotation.sentAt = new Date()
  await quotation.save()

  // Only advance lifecycle — never regress a stage already reached
  const leadForStage = await Lead.findById(quotation.leadId).lean()
  if (leadForStage) {
    const targetIdx  = LIFECYCLE_STAGES.indexOf('proposal_sent')
    const currentIdx = LIFECYCLE_STAGES.indexOf(leadForStage.lifecycleStatus)
    if (targetIdx > currentIdx) {
      await Lead.findByIdAndUpdate(quotation.leadId, { lifecycleStatus: 'proposal_sent' })
    }
  }

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_SENT,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id, sentTo: customer.email },
  })

  // Fire-and-forget: generate AI summary
  quoteSummaryService.generateAndSave(quotation, quotation.leadId, quotation.customerId)
    .catch(err => console.error('[QuoteSummary]', err.message))

  return success(res, { quotation }, 'Quotation sent successfully')
})

exports.getQuoteSummary = asyncHandler(async (req, res) => {
  const summary = await QuoteSummary.findOne({ quotationId: req.params.quotationId }).lean()
  if (!summary) return notFound(res, 'Summary not generated yet')
  return success(res, { summary })
})

exports.getLeadQuotations = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const dateFilter = buildDateFilter(req.query)

  const quotations = await Quotation.find({ leadId, ...dateFilter })
    .populate('createdBy')
    .sort({ createdAt: -1 })
    .lean()

  return success(res, { quotations })
})
