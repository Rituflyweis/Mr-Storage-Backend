const Delivery = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Bundle = require('../../models/Bundle')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { loadFreightLoadDetailsByLeadId } = require('../../services/plant/freightLoadDetails.service')
const { generatePackingListPdf, generateBillOfLadingPdf } = require('../../utils/exportDelivery')
const { DELIVERY_FULFILLMENT_STATUSES } = require('../../config/constants')
const { resolveLeadByProjectRef } = require('../../utils/projectRef')
// Granular fulfillment steps still roll up into "inTransit" for this coarse dashboard stat.
const IN_TRANSIT_ROLLUP_STATUSES = DELIVERY_FULFILLMENT_STATUSES.filter((s) => s !== 'delivered')

const buildDeliveryCard = async (delivery) => {
  let carrier = null
  if (delivery.selectedCarrierBidId) {
    const bid = await FreightBid.findById(delivery.selectedCarrierBidId)
      .populate('carrierId', 'carrierName contactName phone email')
      .lean()
    if (bid?.carrierId) {
      carrier = {
        name: bid.carrierId.carrierName,
        contactName: bid.carrierId.contactName,
        phone: bid.carrierId.phone,
        email: bid.carrierId.email,
      }
    }
  }

  return {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    status: delivery.status,
    description: delivery.description,
    materialType: delivery.materialType,
    loadWeight: delivery.loadWeight,
    packageCount: delivery.packageCount,
    loadingEquipment: delivery.loadingEquipment,
    schedule: {
      pickupDate: delivery.pickupDate,
      pickupTime: delivery.pickupTime,
      deliveryDate: delivery.deliveryDate,
      deliveryTime: delivery.deliveryTime,
      timings: delivery.timings,
    },
    pickupLocation: delivery.pickupLocation,
    deliveryLocation: delivery.deliveryLocation,
    stagingArea: delivery.additionalNotes || '',
    notes: delivery.specialRequirements || '',
    receivingPoc: delivery.receivingPoc,
    pickupContactPhone: delivery.pickupContactPhone,
    siteContact: delivery.siteContact || null,
    carrier,
    statusHistory: delivery.statusHistory || [],
    project: {
      leadId: delivery.leadId?._id,
      projectName: delivery.leadId?.projectName,
      jobId: delivery.leadId?.jobId,
      location: delivery.leadId?.location,
    },
  }
}

exports.getDeliveries = asyncHandler(async (req, res) => {
  const { status, leadId, materialType, search, startDate, endDate, page = 1, limit = 20 } = req.query

  const filter = { status: { $ne: 'draft' } }
  if (status) filter.status = status
  if (leadId) filter.leadId = leadId
  if (materialType) filter.materialType = materialType
  if (search?.trim()) {
    const regex = { $regex: search.trim(), $options: 'i' }
    filter.$or = [{ deliveryNumber: regex }, { materialType: regex }, { description: regex }]
  }
  if (startDate || endDate) {
    filter.deliveryDate = {}
    if (startDate) filter.deliveryDate.$gte = new Date(startDate)
    if (endDate) filter.deliveryDate.$lte = new Date(endDate)
  }

  const skip = (Number(page) - 1) * Number(limit)
  const [deliveries, total] = await Promise.all([
    Delivery.find(filter)
      .populate('leadId', 'projectName jobId location')
      .sort({ deliveryDate: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Delivery.countDocuments(filter),
  ])

  const now = new Date()
  const stats = {
    inTransit: await Delivery.countDocuments({ status: { $in: IN_TRANSIT_ROLLUP_STATUSES } }),
    staged: await Delivery.countDocuments({ status: 'confirmed' }),
    ready: await Delivery.countDocuments({ status: 'scheduled' }),
    totalToday: await Delivery.countDocuments({
      status: { $ne: 'draft' },
      deliveryDate: {
        $gte: new Date(now.toDateString()),
        $lt: new Date(new Date(now.toDateString()).getTime() + 86400000),
      },
    }),
  }

  const cards = await Promise.all(deliveries.map(buildDeliveryCard))
  return success(res, { deliveries: cards, total, stats })
})

exports.getDelivery = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
    .populate('leadId', 'projectName jobId location')
    .lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  const card = await buildDeliveryCard(delivery)
  return success(res, { delivery: card })
})

// POST /deliveries — "Add Delivery" screen on the construction mobile app
exports.createDelivery = asyncHandler(async (req, res) => {
  const { title, leadId, sectionLocation, deliveryDate, description, notes, attachments } = req.body
  if (!leadId) return badRequest(res, 'leadId is required')
  if (!deliveryDate) return badRequest(res, 'deliveryDate is required')

  const lead = await Lead.findById(leadId).select('_id').lean()
  if (!lead) return notFound(res, 'Project not found')

  const count = await Delivery.countDocuments({})
  const delivery = await Delivery.create({
    leadId,
    deliveryNumber: `DEL-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`,
    status: 'scheduled',
    loadDescription: title || '',
    description: description || '',
    deliveryLocation: sectionLocation || '',
    deliveryDate,
    additionalNotes: notes || '',
    attachments: Array.isArray(attachments) ? attachments : [],
    statusHistory: [{ status: 'scheduled', changedAt: new Date() }],
  })

  return created(res, { delivery }, 'Delivery added')
})

exports.markReceived = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')
  if (delivery.status === 'delivered') return badRequest(res, 'Already marked as delivered')

  delivery.status = 'delivered'
  delivery.statusHistory.push({ status: 'delivered', changedAt: new Date() })
  await delivery.save()

  return success(res, { deliveryId: delivery._id, status: 'delivered' }, 'Marked as received')
})

exports.markPartialReceived = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  delivery.status = 'partial_received'
  delivery.statusHistory.push({ status: 'partial_received', changedAt: new Date() })
  if (req.body.notes) delivery.additionalNotes = req.body.notes
  await delivery.save()

  return success(res, { deliveryId: delivery._id, status: 'partial_received' }, 'Marked as partial received')
})

exports.updateSiteContact = asyncHandler(async (req, res) => {
  const { contactName, contactTitle, phone, email, availableHours, notes } = req.body

  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  delivery.siteContact = {
    contactName: contactName ?? delivery.siteContact?.contactName ?? '',
    contactTitle: contactTitle ?? delivery.siteContact?.contactTitle ?? '',
    phone: phone ?? delivery.siteContact?.phone ?? '',
    email: email ?? delivery.siteContact?.email ?? '',
    availableHours: availableHours ?? delivery.siteContact?.availableHours ?? '',
    notes: notes ?? delivery.siteContact?.notes ?? '',
  }
  await delivery.save()

  return success(res, { deliveryId: delivery._id, siteContact: delivery.siteContact }, 'Site contact updated')
})

exports.scanBundle = asyncHandler(async (req, res) => {
  const { bundleId, project } = req.body
  if (!bundleId) return badRequest(res, 'bundleId is required')

  const isObjectId = /^[a-f0-9]{24}$/i.test(bundleId)

  // Human-readable bundle numbers (e.g. "BND-001") are only unique within a project, so a
  // project reference is required to scope the lookup — otherwise a scan could silently resolve
  // to the wrong project's bundle. The internal Mongo _id is already globally unique.
  let leadId = null
  if (!isObjectId) {
    if (!project) return badRequest(res, 'project is required when scanning by bundle number')
    const lead = await resolveLeadByProjectRef(project)
    if (!lead) return notFound(res, 'Project not found')
    leadId = lead._id
  }

  const bundle = await Bundle.findOne(
    isObjectId ? { _id: bundleId } : { bundleNo: bundleId, leadId }
  )
    .populate('bundlePlanId', 'leadId')
    .lean()

  if (!bundle) return notFound(res, 'Bundle not found')

  return success(res, {
    bundleId: bundle._id,
    bundleNo: bundle.bundleNo,
    bundleType: bundle.bundleType,
    title: bundle.title,
    totalQty: bundle.totalQty,
    totalWeight: bundle.totalWeight,
    maxLengthFeet: bundle.maxLengthFeet,
    status: bundle.status,
    packingListId: bundle.packingListId,
    items: bundle.items || [],
  })
})

const buildPdfContext = async (delivery) => {
  const card = await buildDeliveryCard(delivery)
  const loadDetails = await loadFreightLoadDetailsByLeadId(delivery.leadId?._id || delivery.leadId)
  const bundles = loadDetails?.bundles || []
  const packingLists = loadDetails?.packingLists || []

  const bundleTypes = new Set(bundles.map((b) => b.bundleType).filter(Boolean)).size
  const materials = [...new Set(bundles.flatMap((b) => (b.items || []).map((i) => i.category).filter(Boolean)))]

  const mapped = {
    deliveryNumber: card.deliveryNumber,
    deliveryDate: card.schedule?.deliveryDate,
    timings: card.schedule?.timings,
    deliveryLocation: card.deliveryLocation,
    siteInstructions: card.notes,
    specialNotes: card.stagingArea,
    deliveryCompany: card.carrier
      ? { name: card.carrier.name, driver: card.carrier.driverName, phone: card.carrier.phone, email: card.carrier.email }
      : null,
    loadAndBundle: {
      loadId: packingLists[0]?.packingListNo || '—',
      bundleCount: bundles.length,
      truckNumber: packingLists[0]?.truckNo || packingLists[0]?.truckLabel || '—',
      totalWeight: bundles.reduce((sum, b) => sum + Number(b.totalWeight || 0), 0) || card.loadWeight,
    },
    packingListSummary: {
      totalParts: bundles.reduce((sum, b) => sum + ((b.items || []).length), 0),
      bundleTypes,
      material: materials.join(', ') || '—',
    },
    project: {
      leadId: card.project?.leadId,
      projectId: card.project?.jobId,
      projectName: card.project?.projectName,
    },
  }

  return { mapped, bundles, packingLists }
}

exports.downloadDeliveryPackingList = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId).populate('leadId', 'projectName jobId location').lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  const { mapped, bundles, packingLists } = await buildPdfContext(delivery)
  const buffer = await generatePackingListPdf(mapped, bundles, packingLists)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}-packing-list.pdf"`)
  return res.send(buffer)
})

exports.downloadDeliveryBillOfLading = asyncHandler(async (req, res) => {
  const delivery = await Delivery.findById(req.params.deliveryId).populate('leadId', 'projectName jobId location').lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  const { mapped, bundles, packingLists } = await buildPdfContext(delivery)
  const buffer = await generateBillOfLadingPdf(mapped, bundles, packingLists)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}-bill-of-lading.pdf"`)
  return res.send(buffer)
})

// Reused by admin/employee.controller.js to render a construction employee's assigned
// deliveries with the same card shape as the construction panel itself.
module.exports.buildDeliveryCard = buildDeliveryCard
