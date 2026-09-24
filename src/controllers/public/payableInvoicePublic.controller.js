const ShipperRequest = require('../../models/ShipperRequest')
const FreightBid = require('../../models/FreightBid')
const Delivery = require('../../models/Delivery')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { v4: uuidv4 } = require('uuid')
const env = require('../../config/env')
const asyncHandler = require('../../utils/asyncHandler')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const { createPayableInvoice } = require('../../utils/payableInvoice.util')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const resolveTokenContext = async (token) => {
  const shipper = await ShipperRequest.findOne({ payableUploadToken: token })
    .populate('vendorId', 'vendorName')
    .populate('leadId', 'projectName jobId')
  if (shipper) {
    if (shipper.status !== 'approved') {
      return { error: 'Quote must be approved before uploading an invoice' }
    }
    return { kind: 'vendor', shipper }
  }

  const bid = await FreightBid.findOne({ payableUploadToken: token })
    .populate('carrierId', 'carrierName')
  if (bid) {
    if (bid.status !== 'selected') {
      return { error: 'Bid must be awarded before uploading an invoice' }
    }
    const delivery = await Delivery.findById(bid.deliveryId).populate('leadId', 'projectName jobId')
    if (!delivery) return { error: 'Delivery not found' }
    return { kind: 'freight_carrier', bid, delivery }
  }

  return null
}

exports.getPayableUploadInfo = asyncHandler(async (req, res) => {
  const ctx = await resolveTokenContext(req.params.token)
  if (!ctx) return notFound(res, 'Invalid or expired upload link')
  if (ctx.error) return badRequest(res, ctx.error)

  if (ctx.kind === 'vendor') {
    const { shipper } = ctx
    return success(res, {
      invoiceType: 'vendor',
      projectName: shipper.leadId?.projectName || '',
      jobId: shipper.leadId?.jobId || '',
      payeeName: shipper.vendorId?.vendorName || '',
      suggestedAmount: shipper.quoteValue,
      existingInvoiceId: shipper.payableInvoiceId || null,
      alreadySubmitted: Boolean(shipper.payableInvoiceId),
    })
  }

  const { bid, delivery } = ctx
  return success(res, {
    invoiceType: 'freight_carrier',
    projectName: delivery.leadId?.projectName || '',
    jobId: delivery.leadId?.jobId || '',
    payeeName: bid.carrierId?.carrierName || '',
    deliveryNumber: delivery.deliveryNumber,
    suggestedAmount: bid.quotedAmount,
    existingInvoiceId: bid.payableInvoiceId || null,
    alreadySubmitted: Boolean(bid.payableInvoiceId),
  })
})

exports.getPayableUploadPresignedUrl = asyncHandler(async (req, res) => {
  const ctx = await resolveTokenContext(req.params.token)
  if (!ctx) return notFound(res, 'Invalid upload link')
  if (ctx.error) return badRequest(res, ctx.error)

  const { fileName, fileType, folder = 'payable-invoices' } = req.body
  if (!fileName || !fileType) return badRequest(res, 'fileName and fileType are required')

  const ext = fileName.split('.').pop()
  const ownerId = ctx.kind === 'vendor' ? ctx.shipper._id : ctx.bid._id
  const key = `${folder}/${ownerId}/${uuidv4()}.${ext}`
  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    ContentType: fileType,
  })
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: env.AWS_S3_PRESIGNED_URL_EXPIRES })
  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`

  return success(res, { uploadUrl, fileUrl, key })
})

exports.submitPayableUpload = asyncHandler(async (req, res) => {
  const ctx = await resolveTokenContext(req.params.token)
  if (!ctx) return notFound(res, 'Invalid upload link')
  if (ctx.error) return badRequest(res, ctx.error)

  const {
    documentUrl,
    documentFileName,
    totalAmount,
    description,
    daysToPay,
    vendorInvoiceNumber,
  } = req.body

  if (!documentUrl?.trim()) return badRequest(res, 'documentUrl is required')
  if (totalAmount == null || Number.isNaN(Number(totalAmount))) {
    return badRequest(res, 'totalAmount is required')
  }

  if (ctx.kind === 'vendor') {
    const { shipper } = ctx
    if (shipper.payableInvoiceId) {
      return badRequest(res, 'An invoice was already submitted for this approval')
    }

    const invoice = await createPayableInvoice({
      invoiceType: 'vendor',
      leadId: shipper.leadId._id || shipper.leadId,
      vendorId: shipper.vendorId._id || shipper.vendorId,
      payeeName: shipper.vendorId?.vendorName,
      totalAmount,
      description: description || vendorInvoiceNumber || 'Vendor invoice via acceptance upload',
      daysToPay,
      documentUrl,
      documentFileName,
      source: 'acceptance_upload',
      createdBy: shipper.reviewedBy,
      shipperRequestId: shipper._id,
      initialPayableStatus: 'pending_admin_approval',
    })

    shipper.payableInvoiceId = invoice._id
    await shipper.save()

    return created(res, {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      payableStatus: invoice.payableWorkflow?.status,
    }, 'Invoice submitted for admin approval')
  }

  const { bid, delivery } = ctx
  if (bid.payableInvoiceId) {
    return badRequest(res, 'An invoice was already submitted for this award')
  }

  const invoice = await createPayableInvoice({
    invoiceType: 'freight_carrier',
    leadId: delivery.leadId._id || delivery.leadId,
    carrierId: bid.carrierId._id || bid.carrierId,
    payeeName: bid.carrierId?.carrierName,
    totalAmount,
    description: description || vendorInvoiceNumber || 'Carrier invoice via acceptance upload',
    daysToPay,
    documentUrl,
    documentFileName,
    source: 'acceptance_upload',
    createdBy: null,
    freightBidId: bid._id,
    deliveryId: delivery._id,
    initialPayableStatus: 'pending_admin_approval',
  })

  bid.payableInvoiceId = invoice._id
  await bid.save()

  return created(res, {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    payableStatus: invoice.payableWorkflow?.status,
  }, 'Invoice submitted for admin approval')
})
