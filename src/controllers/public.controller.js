const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { v4: uuidv4 } = require('uuid')
const bcrypt = require('bcryptjs')
const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Message = require('../models/Message')
const ShipperRequest = require('../models/ShipperRequest')
const ConsolidatedBOM = require('../models/ConsolidatedBOM')
const auditService = require('../services/audit.service')
const leadListSocket = require('../services/leadListSocket.service')
const { syncLeadBuildings } = require('../services/leadBuilding.service')
const mailer = require('../services/email/mailer')
const generateCustomerId = require('../utils/generateCustomerId')
const { success, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { notifyPlantUsersForLead } = require('../utils/notifyPlantUsers')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../config/constants')
const env = require('../config/env')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const VENDOR_UPLOAD_ALLOWED_STATUSES = new Set(['sent', 'resubmit_requested', 'submitted'])

const buildVendorUploadSummary = (request) => {
  const isResubmit = request.status === 'resubmit_requested'
  const exceptionSummary = isResubmit ? request.vendorExceptionSummary || null : null
  const priorQuoteValue = exceptionSummary?.priorQuoteValue ?? null

  return {
    requestId: request._id,
    status: request.status,
    vendorName: request.vendorId?.vendorName || '',
    projectName: request.leadId?.projectName || '',
    jobId: request.leadId?.jobId || '',
    consolidatedBOMFileUrl: request.ourFileUrl || '',
    submittedFileUrl: request.submittedFileUrl || null,
    submittedFileName: request.submittedFileName || '',
    submittedAt: request.submittedAt || null,
    quoteValue: request.quoteValue ?? null,
    isResubmit,
    resubmitCount: request.resubmitCount || 0,
    resubmitRequestedAt: request.resubmitRequestedAt || null,
    resubmitNote: isResubmit ? request.manualReviewNote || '' : '',
    priorQuoteValue: isResubmit ? priorQuoteValue : null,
    requiresQuoteValue: true,
    exceptionSummary,
    submissionHistoryCount: Array.isArray(request.submissionHistory) ? request.submissionHistory.length : 0,
  }
}

exports.chatInit = asyncHandler(async (req, res) => {
  const { firstName, email, phone } = req.body
  const countryCode = String(req.body.countryCode || '+1').trim() || '+1'

  const normalizedEmail = email.toLowerCase().trim()
  const normalizedPhone = phone.replace(/\D/g, '').trim() || phone.trim()

  // 1. Try to find existing customer by email or phone
  let customer = await Customer.findOne({
    $or: [
      { email: normalizedEmail },
      { 'phone.number': normalizedPhone },
    ],
  })

  let isNewCustomer = false

  if (!customer) {
    // 2. Create new customer
    const customerId = await generateCustomerId()
    const hashedPassword = await bcrypt.hash(normalizedPhone, 12)

    customer = await Customer.create({
      customerId,
      firstName: firstName.trim(),
      email: normalizedEmail,
      phone: { number: normalizedPhone, countryCode },
      password: hashedPassword,
      source: 'chat',
    })
    isNewCustomer = true

    if (mailer.isEnquiryNotificationConfigured()) {
      try {
        await mailer.sendNewCustomerEnquiryNotification({
          toEmail: 'info@steelbuildingdepot.com',
          customerName: firstName.trim(),
          customerEmail: normalizedEmail,
          customerPhone: normalizedPhone,
          countryCode,
        })
      } catch (err) {
        console.warn('[chatInit] Failed to send new customer enquiry notification:', err.message)
      }
    }
  }

  // 3. Check for any existing active (non-delivered) lead for this customer
  // This handles the case where a manually-added or imported lead matches
  const existingLead = await Lead.findOne({
    customerId: customer._id,
    lifecycleStatus: { $nin: CLOSED_STAGES },
  }).sort({ createdAt: -1 })

  let lead = existingLead

  if (!lead) {
    // 4. Create new lead
    lead = await Lead.create({
      customerId: customer._id,
      source: 'chat',
      lifecycleStatus: 'initial_contact',
      lifecycleHistory: [
        { stage: 'initial_contact', changedAt: new Date(), changedBy: null },
      ],
    })

    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_CREATED,
      leadId: lead._id,
      customerId: customer._id,
      performedBy: null,
      metadata: { source: 'chat', isNewCustomer },
    })

    await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'chat_init' })
    await syncLeadBuildings(lead, { createdBy: null })
  }

  return success(res, {
    customerId: customer._id,
    leadId: lead._id,
    customerName: customer.firstName,
    isReturning: !isNewCustomer,
    isHandedToSales: lead.isHandedToSales || false,
    isStaffChatActive: lead.isStaffChatActive || false,
    isQuoteReady: lead.isQuoteReady || false,
    isChatEnded: lead.isChatEnded || false,
  })
})

exports.getChatHistory = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId)
    .select('isChatEnded chatEndedAt isStaffChatActive isHandedToSales')
    .lean()
  if (!lead) return badRequest(res, 'Lead not found')

  const messages = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .populate('senderId', 'name')
    .select('senderType senderId content createdAt isRead')
    .lean()

  const rows = messages.map((m) => ({
    senderType: m.senderType,
    content: m.content,
    createdAt: m.createdAt,
    isRead: m.isRead,
    senderName: m.senderType === 'sales'
      ? m.senderId?.name || 'Sales'
      : m.senderType === 'admin'
        ? m.senderId?.name || 'Admin'
        : undefined,
  }))

  const isStaffChatActive = Boolean(lead.isStaffChatActive)
  const isHandedToSales = Boolean(lead.isHandedToSales)

  return success(res, {
    isChatEnded: lead.isChatEnded || false,
    chatEndedAt: lead.chatEndedAt || null,
    isStaffChatActive,
    isHandedToSales,
    isAiActive: !lead.isChatEnded && !isStaffChatActive && !isHandedToSales,
    canCustomerSend: !lead.isChatEnded,
    messages: rows,
  })
})

exports.getVendorUploadInfo = asyncHandler(async (req, res) => {
  const { token } = req.params
  const request = await ShipperRequest.findOne({ token })
    .populate('vendorId', 'vendorName')
    .populate('leadId', 'projectName jobId')
    .lean()

  if (!request) return badRequest(res, 'Invalid or expired upload link')

  if (!VENDOR_UPLOAD_ALLOWED_STATUSES.has(request.status)) {
    return badRequest(res, `This upload link is not active (status: ${request.status})`)
  }

  return success(res, buildVendorUploadSummary(request))
})

exports.getVendorUploadPresignedUrl = asyncHandler(async (req, res) => {
  const { token } = req.params
  const { fileName, fileType, folder = 'vendor-uploads' } = req.body
  if (!fileName || !fileType) return badRequest(res, 'fileName and fileType are required')

  const request = await ShipperRequest.findOne({ token }).lean()
  if (!request) return badRequest(res, 'Invalid or expired upload link')
  if (!VENDOR_UPLOAD_ALLOWED_STATUSES.has(request.status)) {
    return badRequest(res, `This upload link is not active (status: ${request.status})`)
  }

  const ext = fileName.split('.').pop()
  const key = `${folder}/${request._id}/${uuidv4()}.${ext}`
  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    ContentType: fileType,
  })

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: env.AWS_S3_PRESIGNED_URL_EXPIRES })
  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`

  return success(res, { uploadUrl, fileUrl, key })
})

exports.submitVendorUpload = asyncHandler(async (req, res) => {
  const { token } = req.params
  const { submittedFileUrl, submittedFileName, quoteValue } = req.body

  const request = await ShipperRequest.findOne({ token })
    .populate('vendorId', 'vendorName')
    .populate('leadId', 'projectName jobId customerId')

  if (!request) return badRequest(res, 'Invalid or expired upload link')
  if (!VENDOR_UPLOAD_ALLOWED_STATUSES.has(request.status)) {
    return badRequest(res, `This upload link is not active (status: ${request.status})`)
  }

  request.submittedFileUrl = submittedFileUrl.trim()
  request.submittedFileName = submittedFileName.trim()
  request.quoteValue = Number(quoteValue)
  request.submittedAt = new Date()
  request.status = 'submitted'
  request.vendorExceptionSummary = null
  request.comparisonStatus = 'idle'
  request.comparisonSummary = null
  request.comparisonError = null
  request.comparisonRanAt = null
  request.exceptions = []
  await request.save()

  const consolidatedBOM = await ConsolidatedBOM.findById(request.consolidatedBOMId).lean()
  const requestedVendorIds = (consolidatedBOM?.sentToVendors || []).map((v) => String(v.vendorId))

  let allVendorsSubmitted = false
  if (requestedVendorIds.length > 0) {
    const submittedRequests = await ShipperRequest.find({
      leadId: request.leadId._id,
      consolidatedBOMId: request.consolidatedBOMId,
      vendorId: { $in: requestedVendorIds },
      submittedFileUrl: { $ne: null },
    }).select('vendorId').lean()

    const submittedVendorIds = new Set(submittedRequests.map((r) => String(r.vendorId)))
    allVendorsSubmitted = requestedVendorIds.every((id) => submittedVendorIds.has(id))
  }

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.SHIPPER_FILE_SUBMITTED,
    leadId: request.leadId._id,
    customerId: request.leadId.customerId,
    performedBy: null,
    metadata: {
      shipperRequestId: request._id,
      consolidatedBOMId: request.consolidatedBOMId,
      vendorId: request.vendorId._id,
      vendorName: request.vendorId.vendorName,
      submittedFileName: request.submittedFileName,
      quoteValue: request.quoteValue,
    },
  })

  await notifyPlantUsersForLead(request.leadId._id, 'shipper_file_submitted', {
    leadId: request.leadId._id,
    requestId: request._id,
    vendorId: request.vendorId._id,
    vendorName: request.vendorId.vendorName,
    submittedAt: request.submittedAt,
    quoteValue: request.quoteValue,
  })

  if (allVendorsSubmitted && consolidatedBOM && consolidatedBOM.status !== 'vendor_submitted') {
    await ConsolidatedBOM.findByIdAndUpdate(consolidatedBOM._id, { status: 'vendor_submitted' })

    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.ALL_SHIPPERS_SUBMITTED,
      leadId: request.leadId._id,
      customerId: request.leadId.customerId,
      performedBy: null,
      metadata: {
        consolidatedBOMId: consolidatedBOM._id,
        vendorCount: requestedVendorIds.length,
      },
    })

    await notifyPlantUsersForLead(request.leadId._id, 'all_shipper_files_submitted', {
      leadId: request.leadId._id,
      consolidatedBOMId: consolidatedBOM._id,
      vendorCount: requestedVendorIds.length,
    })
  }

  return success(res, {
    ...buildVendorUploadSummary(request),
    allVendorsSubmitted,
  }, 'Shipper file submitted')
})
