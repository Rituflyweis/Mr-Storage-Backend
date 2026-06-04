const { withProjectIdFields } = require('./leadProjectId')

const findLatestContractDocument = (lead) => {
  const contracts = (lead?.documents || []).filter((d) => d.type === 'contract')
  if (!contracts.length) return null
  return [...contracts].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0]
}

const formatAgreementDocument = (contract, uploadedBy = null) => {
  if (!contract) return null
  return {
    _id: contract._id,
    url: contract.url || '',
    fileName: contract.name || '',
    name: contract.name || '',
    type: contract.type,
    uploadedAt: contract.uploadedAt || null,
    uploadedBy: uploadedBy || (contract.uploadedBy ? { _id: contract.uploadedBy } : null),
  }
}

const buildAgreementPayload = (lead, contract, uploadedBy = null) => {
  const agreement = formatAgreementDocument(contract, uploadedBy)
  return withProjectIdFields({
    leadId: lead._id,
    customerId: lead.customerId,
    projectName: lead.projectName || '',
    agreement,
    agreementUploadedAt: agreement?.uploadedAt || null,
  }, lead.jobId)
}

module.exports = {
  findLatestContractDocument,
  formatAgreementDocument,
  buildAgreementPayload,
}
