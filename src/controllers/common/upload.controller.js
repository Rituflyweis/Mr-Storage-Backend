const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { v4: uuidv4 } = require('uuid')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const env = require('../../config/env')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const expiresIn = () => Number(env.AWS_S3_PRESIGNED_URL_EXPIRES) || 3600

const parseS3KeyFromUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== 'string') return null
  try {
    const u = new URL(fileUrl)
    const host = u.hostname || ''
    // Virtual-hosted–style: bucket.s3.region.amazonaws.com/key
    // Path-style: s3.region.amazonaws.com/bucket/key
    let pathname = decodeURIComponent(u.pathname.replace(/^\//, ''))
    if (host.startsWith('s3.') || host.startsWith('s3-')) {
      const parts = pathname.split('/')
      if (parts.length >= 2 && parts[0] === env.AWS_S3_BUCKET) {
        pathname = parts.slice(1).join('/')
      }
    }
    return pathname || null
  } catch {
    return null
  }
}

exports.getPresignedUrl = asyncHandler(async (req, res) => {
  const { fileName, fileType, folder = 'documents' } = req.body
  if (!fileName || !fileType) return badRequest(res, 'fileName and fileType are required')

  const ext = fileName.split('.').pop()
  const key = `${folder}/${uuidv4()}.${ext}`

  const command = new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    ContentType: fileType,
  })

  const ttl = expiresIn()
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: ttl })
  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`

  return success(res, { uploadUrl, fileUrl, key, expiresIn: ttl })
})

/** GET/POST download — short-lived GetObject URL for private bucket objects (drawings, shipper files). */
exports.getDownloadPresignedUrl = asyncHandler(async (req, res) => {
  const keyInput = req.body?.key || req.query?.key
  const fileUrl = req.body?.fileUrl || req.body?.url || req.query?.fileUrl || req.query?.url
  const objectKey = (keyInput && String(keyInput).trim()) || parseS3KeyFromUrl(fileUrl)
  if (!objectKey) {
    return badRequest(res, 'key or fileUrl is required')
  }

  const ttl = expiresIn()
  const command = new GetObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: objectKey,
  })
  const downloadUrl = await getSignedUrl(s3, command, { expiresIn: ttl })

  return success(res, {
    downloadUrl,
    key: objectKey,
    expiresIn: ttl,
  })
})

exports.addDocument = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { url, name, type } = req.body
  if (!url || !name) return badRequest(res, 'url and name are required')

  const { DOCUMENT_TYPES } = require('../../models/Lead')
  const docType = type && DOCUMENT_TYPES.includes(type) ? type : 'general'

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')
  if (req.user.role === 'sales' && String(lead.assignedSales) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }

  lead.documents.push({
    url,
    name,
    type: docType,
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.DOCUMENT_ADDED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { name, url, documentType: docType },
  })

  return success(res, { documents: lead.documents })
})

exports.uploadAgreement = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { url, name } = req.body
  if (!url || !name) return badRequest(res, 'url and name are required')

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')
  if (req.user.role === 'sales' && String(lead.assignedSales) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }

  const now = new Date()
  lead.documents.push({ url, name, type: 'contract', uploadedBy: req.user._id, uploadedAt: now })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.DOCUMENT_ADDED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { name, url, documentType: 'contract' },
  })

  const agreement = lead.documents[lead.documents.length - 1]
  return success(res, { agreement, agreementUploadedAt: agreement.uploadedAt })
})

exports.removeDocument = asyncHandler(async (req, res) => {
  const { leadId, docId } = req.params

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')
  if (req.user.role === 'sales' && String(lead.assignedSales) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }

  const doc = lead.documents.id(docId)
  if (!doc) return notFound(res, 'Document not found')

  const docName = doc.name
  lead.documents.pull(docId)
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.DOCUMENT_REMOVED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { docId, name: docName },
  })

  return success(res, { documents: lead.documents })
})
