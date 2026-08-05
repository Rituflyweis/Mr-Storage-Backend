const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const User = require('../../models/User')
const { success, notFound, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { PO_PROJECT_MATCH } = require('../../utils/customerPoFilter')
const {
  findLatestContractDocument,
  buildAgreementPayload,
} = require('../../utils/leadAgreement')

const loadUploader = async (uploadedById) => {
  if (!uploadedById) return null
  return User.findById(uploadedById).select('_id name email role').lean()
}

const respondWithAgreement = async (res, lead) => {
  const contract = findLatestContractDocument(lead)
  const uploadedBy = await loadUploader(contract?.uploadedBy)
  return success(res, buildAgreementPayload(lead, contract, uploadedBy))
}

/** GET /api/admin|sales/leads/:leadId/agreement */
exports.getLeadAgreement = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const lead = await Lead.findById(leadId)
    .select('customerId projectName jobId documents assignedSales')
    .lean()
  if (!lead) return notFound(res, 'Lead not found')

  if (req.user.role === 'sales' && String(lead.assignedSales) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }

  return respondWithAgreement(res, lead)
})

/** GET .../customers/:customerId/projects/:leadId/agreement */
exports.getProjectAgreement = asyncHandler(async (req, res) => {
  const { customerId, leadId } = req.params

  const customer = await Customer.findById(customerId).select('_id').lean()
  if (!customer) return notFound(res, 'Customer not found')

  const leadFilter = {
    _id: leadId,
    customerId,
    ...PO_PROJECT_MATCH,
  }
  if (req.user.role === 'sales') {
    leadFilter.assignedSales = req.user._id
  }

  const lead = await Lead.findOne(leadFilter)
    .select('customerId projectName jobId documents assignedSales')
    .lean()
  if (!lead) return notFound(res, 'Project not found')

  return respondWithAgreement(res, lead)
})
