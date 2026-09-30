const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS, CUSTOMER_DOCUMENT_CATEGORIES } = require('../../config/constants')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const assertCustomerAccess = async (customerId, user) => {
  const customer = await Customer.findById(customerId)
  if (!customer) return { error: 'Customer not found', code: 404 }

  if (user.role === 'admin') return { customer }

  if (user.role === 'sales') {
    const owns = await Lead.exists({ customerId, assignedSales: user._id })
    if (!owns) return { error: 'Access denied', code: 403 }
    return { customer }
  }

  return { error: 'Access denied', code: 403 }
}

const formatCustomerDocuments = (customer) =>
  (customer.documents || []).map((d) => ({
    _id: d._id,
    name: d.name,
    fileUrl: d.fileUrl,
    fileType: d.fileType || '',
    fileSize: d.fileSize || 0,
    category: d.category,
    notes: d.notes || '',
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt,
  }))

exports.listCustomerDocuments = asyncHandler(async (req, res) => {
  const access = await assertCustomerAccess(req.params.customerId, req.user)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const customer = await Customer.findById(access.customer._id)
    .populate('documents.uploadedBy', 'name email role')
    .lean()

  const documents = (customer.documents || []).sort(
    (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
  )

  return success(res, {
    customerId: customer._id,
    documents,
    total: documents.length,
    categories: CUSTOMER_DOCUMENT_CATEGORIES,
  })
})

exports.addCustomerDocument = asyncHandler(async (req, res) => {
  const { name, fileUrl, fileType, fileSize, category, notes } = req.body
  if (!name?.trim() || !fileUrl?.trim()) {
    return badRequest(res, 'name and fileUrl are required')
  }
  const cat = category || 'other'
  if (!CUSTOMER_DOCUMENT_CATEGORIES.includes(cat)) {
    return badRequest(res, `category must be one of: ${CUSTOMER_DOCUMENT_CATEGORIES.join(', ')}`)
  }

  const access = await assertCustomerAccess(req.params.customerId, req.user)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const customer = access.customer
  if (!customer.documents) customer.documents = []
  customer.documents.push({
    name: name.trim(),
    fileUrl: fileUrl.trim(),
    fileType: fileType || '',
    fileSize: Number(fileSize) || 0,
    category: cat,
    notes: notes || '',
    uploadedBy: req.user._id,
    uploadedAt: new Date(),
  })
  await customer.save()
  const saved = customer.documents[customer.documents.length - 1]

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.CUSTOMER_DOCUMENT_ADDED,
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { documentId: saved._id, name: saved.name, category: saved.category },
  })

  return success(res, { document: saved }, 'Document added')
})

exports.deleteCustomerDocument = asyncHandler(async (req, res) => {
  const access = await assertCustomerAccess(req.params.customerId, req.user)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const customer = access.customer
  const doc = customer.documents.id(req.params.docId)
  if (!doc) return notFound(res, 'Document not found')

  doc.deleteOne()
  await customer.save()

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.CUSTOMER_DOCUMENT_REMOVED,
    customerId: customer._id,
    performedBy: req.user._id,
    metadata: { documentId: req.params.docId },
  })

  return success(res, null, 'Document removed')
})
