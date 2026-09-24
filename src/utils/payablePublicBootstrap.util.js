const { loadFreightLoadDetailsByLeadId } = require('../services/plant/freightLoadDetails.service')
const { mapPublicFreightBidInfo } = require('./freightBidDisplay')

const SHIPPER_SECRET_KEYS = ['token', 'payableUploadToken']
const BID_SECRET_KEYS = ['token', 'payableUploadToken']

const redactKeys = (doc, keys) => {
  if (!doc || typeof doc !== 'object') return doc
  const out = { ...doc }
  for (const key of keys) delete out[key]
  return out
}

/** Vendor payable upload page — mirrors GET /api/public/vendor-upload/:token context + approval quote. */
const buildVendorPayablePublicBootstrap = (shipper) => {
  const vendor = shipper.vendorId || null
  const project = shipper.leadId || null
  const leadId = project?._id || shipper.leadId

  return {
    uploadKind: 'vendor',
    invoiceType: 'vendor',
    requiresAuth: false,
    alreadySubmitted: Boolean(shipper.payableInvoiceId),
    existingInvoiceId: shipper.payableInvoiceId || null,
    payeeName: vendor?.vendorName || '',
    projectName: project?.projectName || '',
    jobId: project?.jobId || '',
    leadId,
    suggestedAmount: shipper.quoteValue ?? null,
    shipperRequest: redactKeys(shipper, SHIPPER_SECRET_KEYS),
    vendor,
    project,
    approvedQuote: {
      status: shipper.status,
      quoteValue: shipper.quoteValue ?? null,
      submittedFileUrl: shipper.submittedFileUrl || null,
      submittedFileName: shipper.submittedFileName || '',
      submittedAt: shipper.submittedAt || null,
      reviewedAt: shipper.reviewedAt || null,
      consolidatedBOMFileUrl: shipper.ourFileUrl || '',
      consolidatedBOMId: shipper.consolidatedBOMId?._id || shipper.consolidatedBOMId || null,
    },
  }
}

/** Freight carrier payable upload — mirrors GET /api/public/freight-bids/:token load context. */
const buildFreightPayablePublicBootstrap = async (bid, delivery) => {
  const carrier = bid.carrierId || null
  const project = delivery.leadId || null
  const leadId = project?._id || delivery.leadId
  const loadDetails = leadId
    ? await loadFreightLoadDetailsByLeadId(leadId)
    : { bundlePlan: null, packingListPlan: null, bundles: [], packingLists: [] }

  return {
    uploadKind: 'freight_carrier',
    invoiceType: 'freight_carrier',
    requiresAuth: false,
    alreadySubmitted: Boolean(bid.payableInvoiceId),
    existingInvoiceId: bid.payableInvoiceId || null,
    payeeName: carrier?.carrierName || '',
    projectName: project?.projectName || '',
    jobId: project?.jobId || '',
    leadId,
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber || '',
    suggestedAmount: bid.quotedAmount ?? null,
    freightBid: redactKeys(
      { ...mapPublicFreightBidInfo(bid), ...bid, carrierId: carrier },
      BID_SECRET_KEYS
    ),
    carrier,
    project,
    delivery,
    awardedBid: {
      status: bid.status,
      quotedAmount: bid.quotedAmount ?? null,
      carrierNotes: bid.carrierNotes || '',
      submittedAt: bid.submittedAt || null,
      selectedAt: bid.selectedAt || null,
    },
    description: delivery.loadDescription || delivery.description || '',
    loadWeight: delivery.loadWeight ?? null,
    dimensions: delivery.dimensions || {},
    materialType: delivery.materialType || '',
    packageCount: delivery.packageCount ?? null,
    pickupLocation: delivery.pickupLocation || delivery.pickupLocationData?.address || '',
    deliveryLocation: delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
    documentUrl: delivery.documentUrl || '',
    attachments: delivery.attachments || [],
    bundlePlan: loadDetails.bundlePlan,
    packingListPlan: loadDetails.packingListPlan,
    bundles: loadDetails.bundles,
    packingLists: loadDetails.packingLists,
  }
}

module.exports = {
  buildVendorPayablePublicBootstrap,
  buildFreightPayablePublicBootstrap,
  redactPayableLinkedSecrets,
}

function redactPayableLinkedSecrets(invoice) {
  if (!invoice || typeof invoice !== 'object') return invoice
  const copy = { ...invoice }
  if (copy.payableWorkflow) {
    copy.payableWorkflow = { ...copy.payableWorkflow }
    if (copy.payableWorkflow.shipperRequestId && typeof copy.payableWorkflow.shipperRequestId === 'object') {
      copy.payableWorkflow.shipperRequestId = redactKeys(copy.payableWorkflow.shipperRequestId, SHIPPER_SECRET_KEYS)
    }
    if (copy.payableWorkflow.freightBidId && typeof copy.payableWorkflow.freightBidId === 'object') {
      copy.payableWorkflow.freightBidId = redactKeys(copy.payableWorkflow.freightBidId, BID_SECRET_KEYS)
    }
  }
  return copy
}
