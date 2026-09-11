const EmailSendJob = require('../../models/EmailSendJob')
const Quotation = require('../../models/Quotation')
const EstimateQuote = require('../../models/EstimateQuote')
const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const PaymentSchedule = require('../../models/PaymentSchedule')
const mailer = require('./mailer')
const auditService = require('../audit.service')
const quoteSummaryService = require('../ai/quoteSummary.service')
const {
  generateAssembledHtml,
  generateQuotePdf: generateAssembledQuotePdf,
} = require('../quoting/quoteDocumentGenerator')
const { mapQuotationToDocumentPayload } = require('../../utils/quotationDocumentPayload')
const { AUDIT_ACTIONS } = require('../../config/constants')

const ACTIVE_JOB_STATUSES = ['queued', 'processing']

const findActiveEmailSendJob = async ({ type, resourceId }) =>
  EmailSendJob.findOne({
    type,
    resourceId,
    status: { $in: ACTIVE_JOB_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean()

const loadPaymentScheduleForInvoice = async (invoice) => {
  const leadId = invoice.leadId?._id || invoice.leadId
  if (leadId) {
    const byLead = await PaymentSchedule.findOne({ leadId }).lean()
    if (byLead) return byLead
  }
  if (invoice.paymentScheduleId) {
    return PaymentSchedule.findById(invoice.paymentScheduleId).lean()
  }
  return null
}

const processQuotationEmailJob = async (job) => {
  const {
    toEmail,
    cc = [],
    customMessage = '',
    messageSourceKey = null,
    requestedSections = ['quote', 'sow', 'contract', 'drawings'],
  } = job.payload || {}

  const quotation = await Quotation.findById(job.resourceId)
  if (!quotation) throw new Error('Quotation not found')

  const customer = await Customer.findById(quotation.customerId)
  if (!customer) throw new Error('Customer not found')

  let sourceEstimate = null
  if (quotation.sourceEstimateId) {
    sourceEstimate = await EstimateQuote.findById(quotation.sourceEstimateId).lean()
  }

  const pdfPayload = mapQuotationToDocumentPayload(
    quotation.toObject(),
    customer.toObject(),
    sourceEstimate
  )
  const emailSections = requestedSections.filter((section) => section !== 'drawings')

  let pdfAttachment = null
  let pdfWarning = null
  let draftHtml = ''
  let draftHtmlIncluded = false

  try {
    draftHtml = generateAssembledHtml({
      ...pdfPayload,
      sections: emailSections.length ? emailSections : ['quote'],
    })
    draftHtmlIncluded = Boolean(String(draftHtml || '').trim())
  } catch (err) {
    console.warn('[EmailSendJob] Assembled quotation draft HTML skipped:', err.message)
  }

  try {
    const pdfBuffer = await generateAssembledQuotePdf({
      ...pdfPayload,
      sections: requestedSections,
    })
    pdfAttachment = {
      filename: `Quotation-${quotation.quoteNumber || quotation._id}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }
  } catch (err) {
    pdfWarning = err.message || 'Quotation PDF generation failed'
    console.warn('[EmailSendJob] PDF attachment skipped, sending quotation draft HTML email only:', pdfWarning)
  }

  const emailResult = await mailer.sendQuotation({
    toEmail,
    cc,
    customerName: customer.firstName,
    quotation,
    message: customMessage,
    draftHtml,
    pdfAttachment,
  })

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_SENT,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: job.triggeredBy,
    metadata: {
      quotationId: quotation._id,
      emailSendJobId: job._id,
      sendMethod: 'platform',
      sentTo: toEmail,
      sentCc: cc,
      provider: emailResult?.provider || 'unknown',
      customMessageIncluded: Boolean(customMessage),
      customMessageSourceKey: messageSourceKey,
      draftHtmlIncluded,
      pdfAttached: Boolean(pdfAttachment),
      pdfWarning: pdfWarning || null,
      deliveredAsync: true,
    },
  })

  quoteSummaryService
    .generateAndSave(quotation, quotation.leadId, quotation.customerId)
    .catch((err) => console.error('[QuoteSummary]', err.message))

  return {
    quotationId: quotation._id,
    emailProvider: emailResult?.provider || 'unknown',
    sendMethod: 'platform',
    sentTo: toEmail,
    sentCc: cc,
    messageIncluded: Boolean(customMessage),
    messageSourceKey,
    draftHtmlIncluded,
    pdfAttached: Boolean(pdfAttachment),
    pdfWarning: pdfWarning || null,
  }
}

const processInvoiceEmailJob = async (job) => {
  const {
    toEmail,
    cc = [],
    customMessage = '',
    messageSourceKey = null,
  } = job.payload || {}

  const invoice = await Invoice.findById(job.resourceId)
  if (!invoice) throw new Error('Invoice not found')

  const customer = await Customer.findById(invoice.customerId)
  if (!customer) throw new Error('Customer not found')

  const paymentSchedule = await loadPaymentScheduleForInvoice(invoice)
  const lead = await Lead.findById(invoice.leadId).select('location').lean()
  const customerAddressHtml = mailer.buildCustomerBillToAddressHtml({
    company: customer.company,
    location: customer.location || lead?.location || '',
  })

  const emailResult = await mailer.sendInvoice({
    toEmail,
    cc,
    customerName:
      `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.firstName,
    customerAddressHtml,
    invoice,
    paymentSchedule,
    message: customMessage,
  })

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.INVOICE_SENT,
    leadId: invoice.leadId,
    customerId: invoice.customerId,
    performedBy: job.triggeredBy,
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      emailSendJobId: job._id,
      sendMethod: 'platform',
      sentTo: toEmail,
      sentCc: cc,
      customMessageIncluded: Boolean(customMessage),
      customMessageSourceKey: messageSourceKey,
      pdfAttached: emailResult.pdfAttached,
      pdfError: emailResult.pdfError || null,
      paymentScheduleIncluded: emailResult.paymentScheduleIncluded,
      paymentScheduleStageCount: emailResult.paymentScheduleStageCount,
      deliveredAsync: true,
    },
  })

  return {
    invoiceId: invoice._id,
    sendMethod: 'platform',
    sentTo: toEmail,
    sentCc: cc,
    messageIncluded: Boolean(customMessage),
    messageSourceKey,
    pdfAttached: emailResult.pdfAttached,
    pdfWarning: emailResult.pdfError || null,
    paymentScheduleIncluded: emailResult.paymentScheduleIncluded,
    paymentScheduleStageCount: emailResult.paymentScheduleStageCount,
  }
}

const processEmailSendJob = async (jobId) => {
  const job = await EmailSendJob.findById(jobId)
  if (!job || job.status !== 'queued') return

  await EmailSendJob.findByIdAndUpdate(jobId, {
    status: 'processing',
    processingStartedAt: new Date(),
    errorMessage: null,
  })

  try {
    const result =
      job.type === 'quotation'
        ? await processQuotationEmailJob(job)
        : await processInvoiceEmailJob(job)

    await EmailSendJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      result,
      processingEndedAt: new Date(),
      errorMessage: null,
    })
  } catch (err) {
    console.error('[EmailSendJob] Background processing error:', err.message)
    await EmailSendJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: err.message || 'Email send failed',
      processingEndedAt: new Date(),
    })
  }
}

const queueEmailSendJob = async ({
  type,
  resourceId,
  leadId,
  customerId,
  triggeredBy,
  payload,
}) => {
  const job = await EmailSendJob.create({
    type,
    resourceId,
    leadId,
    customerId,
    triggeredBy,
    payload,
    status: 'queued',
  })

  processEmailSendJob(job._id).catch((err) => {
    console.error('[EmailSendJob] Failed to start background processing:', err.message)
  })

  return job
}

module.exports = {
  findActiveEmailSendJob,
  queueEmailSendJob,
  processEmailSendJob,
}
