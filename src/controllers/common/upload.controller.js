const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
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

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: env.AWS_S3_PRESIGNED_URL_EXPIRES })
  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`

  return success(res, { uploadUrl, fileUrl, key })
})

exports.addDocument = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const { url, name } = req.body
  if (!url || !name) return badRequest(res, 'url and name are required')

  const lead = await Lead.findById(leadId)
  if (!lead) return notFound(res, 'Lead not found')
  if (req.user.role === 'sales' && String(lead.assignedSales) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }

  lead.documents.push({ url, name, uploadedBy: req.user._id, uploadedAt: new Date() })
  await lead.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.DOCUMENT_ADDED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: { name, url },
  })

  return success(res, { documents: lead.documents })
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
