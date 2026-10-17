const Customer = require('../models/Customer')
const ShipperRequest = require('../models/ShipperRequest')

const SELECTED_DELIVERY_STATUSES = [
  'carrier_selected',
  'scheduled',
  'confirmed',
  'material_prepared',
  'loaded',
  'picked_up',
  'in_transit',
  'staged',
  'dispatched_to_site',
  'delayed',
  'delivered',
]

exports.SELECTED_DELIVERY_STATUSES = SELECTED_DELIVERY_STATUSES

const formatPoc = (delivery) => {
  const name = delivery.receivingPoc || delivery.siteContact || ''
  const phone = delivery.pickupContactPhone || delivery.siteContactPhone || ''
  const email = delivery.receivingPocEmail || ''
  if (!name && !phone && !email) return null
  return { name, phone, email }
}

exports.formatAccountDeliveryDetail = async (delivery, lead) => {
  const customer =
    lead.customerId && typeof lead.customerId === 'object'
      ? lead.customerId
      : await Customer.findById(lead.customerId)
          .select('firstName lastName company email phone')
          .lean()

  const customerName = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
      customer.company ||
      ''
    : ''

  const latestShipper = await ShipperRequest.findOne({ leadId: lead._id, status: 'approved' })
    .sort({ updatedAt: -1 })
    .populate('vendorId', 'vendorName contactName phone email')
    .lean()

  const vendor = latestShipper?.vendorId
  const carrier = delivery.selectedCarrierBidId?.carrierId

  const documents = [
    ...(delivery.documentUrl
      ? [{ name: 'Delivery document', type: 'file', url: delivery.documentUrl }]
      : []),
    ...(delivery.attachments || []).map((url, i) => ({
      name: `Attachment ${i + 1}`,
      type: 'file',
      url,
    })),
  ]

  return {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    title: delivery.loadDescription || delivery.description || delivery.deliveryNumber,
    status: delivery.status,
    statusHistory: delivery.statusHistory || [],
    project: {
      leadId: lead._id,
      projectName: lead.projectName || '',
      jobId: lead.jobId || '',
    },
    customer: customer
      ? {
          customerId: customer._id,
          customerName,
          email: customer.email || '',
          phone: customer.phone || '',
        }
      : null,
    overview: {
      status: delivery.status,
      projectName: lead.projectName || '',
      customerName,
      deliveryDate: delivery.deliveryDate,
      timeWindow: delivery.timings || delivery.deliveryTime || '',
      siteAddress:
        delivery.deliveryLocation || delivery.deliveryLocationData?.address || '',
    },
    deliveryInformation: {
      description: delivery.loadDescription || delivery.description || '',
      materialCategory: delivery.materialType || delivery.metalType || '',
      pickupDate: delivery.pickupDate,
    },
    receivingPoc: formatPoc(delivery),
    vendor: vendor
      ? {
          company: vendor.vendorName || '',
          contactName: vendor.contactName || '',
          phone: vendor.phone || '',
          email: vendor.email || '',
        }
      : null,
    deliveryCompany: carrier
      ? {
          company: carrier.carrierName || '',
          contactName: carrier.contactName || '',
          phone: carrier.phone || '',
          email: carrier.email || '',
        }
      : null,
    siteCoordination: {
      siteInstructions: delivery.additionalNotes || delivery.specialRequirements || '',
      requiredEquipment: Array.isArray(delivery.loadingEquipment)
        ? delivery.loadingEquipment.join(', ')
        : delivery.loadingEquipment || '',
      equipmentConfirmationStatus: delivery.equipmentConfirmed ? 'Confirmed' : 'Pending',
      specialNotes: delivery.specialRequirements || '',
    },
    documents: {
      documentUrl: delivery.documentUrl || '',
      attachments: delivery.attachments || [],
      items: documents,
    },
    quickActions: {
      viewDocuments: documents,
    },
    freightLoadId: delivery.freightLoadId || delivery.freightReference || null,
  }
}
