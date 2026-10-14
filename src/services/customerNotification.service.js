const Notification = require('../models/Notification')

const BUILDING_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const buildingLabelFromNumber = (buildingNumber) => {
  const index = Math.max(0, (buildingNumber || 1) - 1)
  return `Building ${BUILDING_LETTERS[index] || buildingNumber}`
}

const projectLabel = (lead) => lead?.jobId || lead?.projectName || 'your project'

/**
 * Persist a customer-panel notification. No-op when customerId is missing.
 */
const notifyCustomer = async ({
  customerId,
  leadId = null,
  title,
  body = '',
  type = 'system',
  priority = 'medium',
  refId = null,
  refModel = null,
}) => {
  if (!customerId || !title) return null
  return Notification.create({
    customerId,
    leadId,
    title,
    body,
    type,
    priority,
    refId,
    refModel,
  })
}

const notifyCustomerDrawingUploaded = async ({
  customerId,
  leadId,
  lead,
  fileName,
  buildingNumber,
  refId = null,
  refModel = 'Building',
}) => {
  const buildingLabel = buildingLabelFromNumber(buildingNumber)
  return notifyCustomer({
    customerId,
    leadId,
    title: 'New Drawing Uploaded',
    body: `${fileName} was uploaded for ${buildingLabel} on ${projectLabel(lead)}.`,
    type: 'drawing',
    priority: 'medium',
    refId,
    refModel,
  })
}

const notifyCustomerDrawingUploadedForLabel = async ({
  customerId,
  leadId,
  lead,
  fileName,
  buildingLabel = 'Building A',
  refId = null,
  refModel = 'DrawingDocument',
}) => notifyCustomer({
  customerId,
  leadId,
  title: 'New Drawing Uploaded',
  body: `${fileName} was uploaded for ${buildingLabel} on ${projectLabel(lead)}.`,
  type: 'drawing',
  priority: 'medium',
  refId,
  refModel,
})

const notifyCustomerQuotationSent = async ({ customerId, leadId, quoteNumber, refId }) =>
  notifyCustomer({
    customerId,
    leadId,
    title: 'Quotation ready',
    body: quoteNumber
      ? `Your quotation ${quoteNumber} is ready to review in the customer portal.`
      : 'A new quotation is ready to review in the customer portal.',
    type: 'quotation',
    priority: 'high',
    refId,
    refModel: 'Quotation',
  })

module.exports = {
  buildingLabelFromNumber,
  notifyCustomer,
  notifyCustomerDrawingUploaded,
  notifyCustomerDrawingUploadedForLabel,
  notifyCustomerQuotationSent,
}
