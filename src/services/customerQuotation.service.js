const Quotation = require('../models/Quotation')
const EstimateQuote = require('../models/EstimateQuote')
const Customer = require('../models/Customer')
const QuoteSummary = require('../models/QuoteSummary')
const {
  generateAssembledHtml,
  generateQuotePdf: generateAssembledQuotePdf,
} = require('./quoting/quoteDocumentGenerator')
const {
  mapQuotationToDocumentPayload,
  resolveEstimateGrandTotal,
  toNumber,
} = require('../utils/quotationDocumentPayload')

const CUSTOMER_VISIBLE_STATUSES = ['sent', 'accepted', 'rejected']
const DEFAULT_SECTIONS = ['quote', 'sow', 'contract', 'drawings']

const parsePdfSections = (sectionsRaw) => {
  if (!sectionsRaw) return DEFAULT_SECTIONS
  const values = String(sectionsRaw)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
  const unique = [...new Set(values)].filter((s) => DEFAULT_SECTIONS.includes(s))
  return unique.length ? unique : DEFAULT_SECTIONS
}

const mapEstimateSummary = (estimate) => {
  if (!estimate) return null
  return {
    _id: estimate._id,
    status: estimate.status || 'draft',
    jobType: estimate.jobType || '',
    squareFootage: toNumber(estimate.squareFootage, 0),
    grandTotal: resolveEstimateGrandTotal(estimate),
    updatedAt: estimate.updatedAt || estimate.createdAt || null,
  }
}

const sanitizeQuotationForCustomer = (quotation) => {
  if (!quotation) return null
  const row = { ...quotation }
  delete row.internalNotes
  if (row.approval) {
    row.approval = {
      status: row.approval.status || 'not_submitted',
      reviewedAt: row.approval.reviewedAt || null,
    }
  }
  return row
}

const buildCustomerPreviewPaths = (leadId) => {
  const base = `/api/customer/projects/${leadId}/quotation`
  return {
    previewPath: `${base}/preview`,
    pdfPath: `${base}/pdf`,
    htmlPreviewLink: `${base}/preview?format=html`,
    pdfLink: `${base}/pdf`,
    defaultSections: DEFAULT_SECTIONS,
  }
}

/** Latest quotation the customer may view (sent to customer via sales generator / send flow). */
exports.findCustomerVisibleQuotation = async (leadId, customerId) => {
  return Quotation.findOne({
    leadId,
    customerId,
    status: { $in: CUSTOMER_VISIBLE_STATUSES },
  })
    .sort({ versionNumber: -1, createdAt: -1 })
    .populate('assignedSalesperson', 'name email')
    .lean()
}

exports.findLatestQuotationAnyStatus = async (leadId, customerId) => {
  return Quotation.findOne({ leadId, customerId })
    .sort({ versionNumber: -1, createdAt: -1 })
    .populate('assignedSalesperson', 'name email')
    .lean()
}

exports.buildCustomerQuotationView = async (leadId, quotation) => {
  if (!quotation) {
    return {
      availability: 'none',
      quotation: null,
      quoteSummary: null,
      documentMeta: null,
      preview: null,
      message: 'No quotation found for this project',
    }
  }

  if (!CUSTOMER_VISIBLE_STATUSES.includes(quotation.status)) {
    return {
      availability: 'pending',
      quotation: null,
      quoteSummary: null,
      documentMeta: buildCustomerPreviewPaths(leadId),
      preview: null,
      message:
        'Your formal quotation is being prepared. You will see the full preview here once your sales representative sends it.',
    }
  }

  let sourceEstimate = null
  if (quotation.sourceEstimateId) {
    sourceEstimate = await EstimateQuote.findById(quotation.sourceEstimateId)
      .select(
        '_id status jobType squareFootage totalSell pricingResult fullQuoteResult storagePricingResult updatedAt createdAt'
      )
      .lean()
  }

  const quoteSummary = await QuoteSummary.findOne({ quotationId: quotation._id })
    .select('summary generatedAt')
    .lean()

  const paths = buildCustomerPreviewPaths(leadId)
  const hasPricingData = Boolean(
    sourceEstimate?.pricingResult ||
      sourceEstimate?.fullQuoteResult?.pricing ||
      sourceEstimate?.storagePricingResult
  )

  const sanitized = sanitizeQuotationForCustomer(quotation)
  sanitized.sourceEstimate = mapEstimateSummary(sourceEstimate)

  const documentMeta = {
    source: quotation.sourceEstimateId ? 'estimate' : 'quotation',
    sourceEstimateId: quotation.sourceEstimateId || null,
    hasPricingData,
    ...paths,
  }

  return {
    availability: 'ready',
    quotation: sanitized,
    quoteSummary: quoteSummary || null,
    documentMeta,
    preview: {
      htmlUrl: paths.htmlPreviewLink,
      pdfUrl: paths.pdfLink,
      defaultSections: DEFAULT_SECTIONS,
      /** Same assembled document as sales panel `GET /api/quotations/:id/pdf?format=html` */
      useGeneratorPreview: Boolean(quotation.sourceEstimateId || hasPricingData),
    },
    message: null,
  }
}

exports.renderCustomerQuotationDocument = async ({
  leadId,
  customerId,
  format = 'pdf',
  sectionsRaw,
}) => {
  const quotation = await exports.findCustomerVisibleQuotation(leadId, customerId)
  if (!quotation) {
    return { error: 'not_found', message: 'No quotation available to preview yet' }
  }

  const customer = await Customer.findById(quotation.customerId).lean()
  const sourceEstimate = quotation.sourceEstimateId
    ? await EstimateQuote.findById(quotation.sourceEstimateId).lean()
    : null
  const sections = parsePdfSections(sectionsRaw)
  const pdfPayload = mapQuotationToDocumentPayload(quotation, customer || {}, sourceEstimate)
  const docFormat = String(format || 'pdf').trim().toLowerCase()

  if (docFormat === 'html') {
    const assembledHtml = generateAssembledHtml({ ...pdfPayload, sections })
    return { contentType: 'text/html; charset=utf-8', body: assembledHtml, quotation }
  }

  const pdfBuffer = await generateAssembledQuotePdf({ ...pdfPayload, sections })
  const fileName = `Quotation-${quotation.quoteNumber || quotation._id}.pdf`.replace(/[^\w.-]+/g, '_')
  return {
    contentType: 'application/pdf',
    disposition: `inline; filename="${fileName}"`,
    body: pdfBuffer,
    quotation,
  }
}

exports.CUSTOMER_VISIBLE_STATUSES = CUSTOMER_VISIBLE_STATUSES
