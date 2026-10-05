const mongoose = require('mongoose')
const Delivery = require('../../models/Delivery')
const { RECEIPT_OUTCOMES } = require('../../models/Delivery')
const FreightBid = require('../../models/FreightBid')
const FreightCarrier = require('../../models/FreightCarrier')
const Bundle = require('../../models/Bundle')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { loadFreightLoadDetailsByLeadId } = require('../../services/plant/freightLoadDetails.service')
const { generatePackingListPdf, generateBillOfLadingPdf, generateMaterialReceiptPdf } = require('../../utils/exportDelivery')
const { DELIVERY_FULFILLMENT_STATUSES } = require('../../config/constants')
const { resolveLeadByProjectRef } = require('../../utils/projectRef')
const { escapeRegex } = require('../../utils/leadPayload')
const notificationService = require('../../services/notification.service')
const {
  PRE_ARRIVAL_STATUSES,
  ARRIVED_STATUSES,
  DELIVERY_TABS,
  TAB_FILTERS,
  OUTCOME_LABELS,
  canScanDelivery,
  isCompleted,
  buildTrackingCards,
  buildTimeline,
  getDeliveryBundles,
  buildMaterialSummary,
  buildWeightAndMaterial,
  buildDocuments,
  buildReceiptSummary,
} = require('../../services/construction/deliveryTracking.service')
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

// Per-tab counts for the "Deliveries" screen chips, within the same project/search/date filters.
const countDeliveryTabs = async (baseFilter) => {
  const tabs = DELIVERY_TABS.filter((t) => t !== 'all')
  const counts = await Promise.all([
    Delivery.countDocuments(baseFilter),
    ...tabs.map((t) => Delivery.countDocuments({ $and: [baseFilter, TAB_FILTERS[t]] })),
  ])
  return Object.fromEntries(['all', ...tabs].map((t, i) => [t, counts[i]]))
}

exports.getDeliveries = asyncHandler(async (req, res) => {
  const { status, leadId, materialType, search, startDate, endDate, tab = 'all', page = 1, limit = 20 } = req.query
  if (!DELIVERY_TABS.includes(tab)) return badRequest(res, `Invalid tab. Use: ${DELIVERY_TABS.join(', ')}`)

  const baseFilter = { status: { $ne: 'draft' } }
  if (status) baseFilter.status = status
  if (leadId) baseFilter.leadId = leadId
  if (materialType) baseFilter.materialType = materialType
  if (search?.trim()) {
    const regex = { $regex: escapeRegex(search.trim()), $options: 'i' }
    baseFilter.$or = [{ deliveryNumber: regex }, { materialType: regex }, { description: regex }, { loadDescription: regex }]
  }
  if (startDate || endDate) {
    baseFilter.deliveryDate = {}
    if (startDate) baseFilter.deliveryDate.$gte = new Date(startDate)
    if (endDate) baseFilter.deliveryDate.$lte = new Date(endDate)
  }
  const filter = tab === 'all' ? baseFilter : { $and: [baseFilter, TAB_FILTERS[tab]] }

  const skip = (Number(page) - 1) * Number(limit)
  const [deliveries, total, tabCounts] = await Promise.all([
    Delivery.find(filter)
      .populate('leadId', 'projectName jobId location')
      .sort({ deliveryDate: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Delivery.countDocuments(filter),
    countDeliveryTabs(baseFilter),
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

  const [cards, trackingCards] = await Promise.all([
    Promise.all(deliveries.map(buildDeliveryCard)),
    buildTrackingCards(deliveries),
  ])
  return success(res, {
    deliveries: cards.map((card, i) => ({ ...card, ...trackingCards[i] })),
    total,
    tab,
    tabCounts,
    stats,
  })
})

// Shared by the Delivery Details and Scan Result screens.
const buildDeliveryView = async (delivery) => {
  const [card, [tracking], { bundles, packingLists }] = await Promise.all([
    buildDeliveryCard(delivery),
    buildTrackingCards([delivery]),
    getDeliveryBundles(delivery),
  ])
  return {
    ...card,
    ...tracking,
    eta: tracking.arrivalAtSite,
    carrierRoute: {
      carrier: card.carrier?.name || '',
      finalDestination: delivery.deliveryLocation || delivery.leadId?.location || '',
      truck: delivery.vehicleNumber || packingLists[0]?.truckLabel || '',
      driver: tracking.driver,
    },
    timeline: buildTimeline(delivery),
    weightAndMaterial: buildWeightAndMaterial(delivery, bundles),
    materialSummary: buildMaterialSummary(delivery, bundles),
    bundles,
    documents: buildDocuments(delivery),
    specialInstructions: delivery.specialRequirements || '',
    receipt: buildReceiptSummary(delivery),
  }
}

exports.getDelivery = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.deliveryId)) return badRequest(res, 'Invalid deliveryId')
  const delivery = await Delivery.findById(req.params.deliveryId)
    .populate('leadId', 'projectName jobId location')
    .lean()
  if (!delivery) return notFound(res, 'Delivery not found')

  return success(res, { delivery: await buildDeliveryView(delivery) })
})

// Resolves a scanned/typed code to a delivery. Accepts a delivery _id or number, or a bundle
// _id or number (bundle numbers are only unique per project, so they resolve through the
// project's open deliveries and must be unambiguous).
const resolveScanTarget = async (code, deliveryId) => {
  const isObjectId = mongoose.Types.ObjectId.isValid(code) && /^[a-f0-9]{24}$/i.test(code)
  const populate = ['leadId', 'projectName jobId location']

  if (deliveryId) {
    const delivery = await Delivery.findById(deliveryId).populate(...populate).lean()
    if (!delivery) return { error: 'Delivery not found', code: 404 }
    if (!code || code === delivery.deliveryNumber || code === String(delivery._id)) return { delivery }

    const bundle = await Bundle.findOne({
      leadId: delivery.leadId._id,
      ...(isObjectId ? { _id: code } : { bundleNo: code }),
    }).select('_id').lean()
    if (!bundle) return { error: `Code "${code}" does not belong to delivery ${delivery.deliveryNumber}`, code: 400 }
    return { delivery, scannedBundleId: bundle._id }
  }

  const delivery = await Delivery.findOne(isObjectId ? { _id: code } : { deliveryNumber: code }).populate(...populate).lean()
  if (delivery) return { delivery }

  const bundles = await Bundle.find(isObjectId ? { _id: code } : { bundleNo: code }).select('_id leadId').lean()
  if (!bundles.length) return { error: `No delivery or bundle found for "${code}"`, code: 404 }

  const candidates = await Delivery.find({
    leadId: { $in: bundles.map((b) => b.leadId) },
    status: { $in: [...PRE_ARRIVAL_STATUSES, ...ARRIVED_STATUSES] },
    'receipt.confirmedAt': null,
  }).populate(...populate).lean()
  if (!candidates.length) return { error: `Bundle "${code}" has no open delivery to verify`, code: 404 }

  // Bundle numbers repeat across projects (every project has a BND-001), so when several open
  // deliveries match, the one physically at the site — arrived or already scanned — is the truck
  // being checked from the QR tab.
  const atSite = candidates.filter((d) => ARRIVED_STATUSES.includes(d.status) || d.receipt?.scannedAt)
  const matches = candidates.length === 1 ? candidates : atSite
  if (matches.length !== 1) {
    const listed = atSite.length ? atSite : candidates
    return {
      error: `Bundle "${code}" matches ${listed.length} open deliveries — scan from the delivery card or pass deliveryId`,
      code: 409,
      candidates: listed.map((d) => ({ deliveryId: d._id, deliveryNumber: d.deliveryNumber, projectName: d.leadId?.projectName })),
    }
  }
  const scannedBundle = bundles.find((b) => String(b.leadId) === String(matches[0].leadId._id))
  return { delivery: matches[0], scannedBundleId: scannedBundle._id }
}

// POST /deliveries/scan { code?, deliveryId? } — "Scan QR Code" / "Simulate QR Scan" → Scan Result
exports.scanDelivery = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim()
  const { deliveryId } = req.body
  if (!code && !deliveryId) return badRequest(res, 'code or deliveryId is required')
  if (deliveryId && !mongoose.Types.ObjectId.isValid(deliveryId)) return badRequest(res, 'Invalid deliveryId')

  const target = await resolveScanTarget(code, deliveryId)
  if (target.error) {
    return res.status(target.code).json({
      success: false,
      message: target.error,
      ...(target.candidates && { data: { candidates: target.candidates } }),
    })
  }

  let { delivery } = target
  if (['draft', 'bidding_sent', 'cancelled'].includes(delivery.status)) {
    return badRequest(res, `Delivery ${delivery.deliveryNumber} cannot be scanned while ${delivery.status}`)
  }

  // First scan moves the delivery into the "Verification" tab; re-scans keep the original time.
  // Already-received deliveries are returned read-only (alreadyReceived: true).
  if (canScanDelivery(delivery) && !delivery.receipt?.scannedAt) {
    await Delivery.updateOne(
      { _id: delivery._id, 'receipt.scannedAt': null },
      { $set: { 'receipt.scannedAt': new Date(), 'receipt.scannedBy': req.user._id } }
    )
    delivery = await Delivery.findById(delivery._id).populate('leadId', 'projectName jobId location').lean()
  }

  return success(res, {
    delivery: await buildDeliveryView(delivery),
    scannedBundleId: target.scannedBundleId || null,
    alreadyReceived: isCompleted(delivery),
  }, 'Scan successful')
})

const OUTCOME_TO_DELIVERY_STATUS = {
  fully_received: 'received',
  partially_received: 'partial_received',
  received_with_issues: 'received',
  rejected: 'rejected',
}

const quantityStatusOf = (expected, received) => {
  if (received === expected) return 'matched'
  return received < expected ? 'short' : 'excess'
}

// POST /deliveries/:deliveryId/receipt — "Confirm Material Receipt"
// Body: { outcome, items: [{ bundleId, receivedQty }], notes? }
exports.confirmReceipt = asyncHandler(async (req, res) => {
  const { deliveryId } = req.params
  const { outcome, items, notes } = req.body
  if (!mongoose.Types.ObjectId.isValid(deliveryId)) return badRequest(res, 'Invalid deliveryId')
  if (!RECEIPT_OUTCOMES.includes(outcome)) return badRequest(res, `outcome must be one of: ${RECEIPT_OUTCOMES.join(', ')}`)
  if (items !== undefined && !Array.isArray(items)) return badRequest(res, 'items must be an array')

  const delivery = await Delivery.findById(deliveryId).populate('leadId', 'projectName jobId location')
  if (!delivery) return notFound(res, 'Delivery not found')
  if (delivery.receipt?.confirmedAt) return badRequest(res, 'Material receipt has already been confirmed for this delivery')
  if (!canScanDelivery(delivery)) return badRequest(res, `Cannot confirm receipt for a delivery that is ${delivery.status}`)

  const { bundles } = await getDeliveryBundles(delivery)
  const bundleById = new Map(bundles.map((b) => [String(b.bundleId), b]))
  const receivedById = new Map()
  for (const item of items || []) {
    const bundle = bundleById.get(String(item?.bundleId))
    if (!bundle) return badRequest(res, `Bundle ${item?.bundleId} is not part of delivery ${delivery.deliveryNumber}`)
    const qty = Number(item.receivedQty)
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      return badRequest(res, `receivedQty for ${bundle.bundleNo} must be a whole number ≥ 0`)
    }
    receivedById.set(String(bundle.bundleId), qty)
  }

  // A rejected load may skip counting; everything else must account for every bundle.
  const missing = bundles.filter((b) => !receivedById.has(String(b.bundleId)))
  if (outcome !== 'rejected' && missing.length) {
    return badRequest(res, `receivedQty is required for every bundle. Missing: ${missing.map((b) => b.bundleNo).join(', ')}`)
  }

  const receiptItems = bundles.map((b) => {
    const receivedQty = receivedById.get(String(b.bundleId)) ?? 0
    return {
      bundleId: b.bundleId,
      bundleNo: b.bundleNo,
      material: b.material,
      expectedQty: b.expectedUnits,
      receivedQty,
      quantityStatus: quantityStatusOf(b.expectedUnits, receivedQty),
    }
  })
  const totalExpected = receiptItems.reduce((sum, i) => sum + i.expectedQty, 0)
  const totalReceived = receiptItems.reduce((sum, i) => sum + i.receivedQty, 0)
  const shortQty = receiptItems.reduce((sum, i) => sum + Math.max(i.expectedQty - i.receivedQty, 0), 0)
  const excessQty = receiptItems.reduce((sum, i) => sum + Math.max(i.receivedQty - i.expectedQty, 0), 0)

  if (outcome === 'fully_received' && shortQty > 0) {
    return badRequest(res, `Cannot mark as fully received — ${shortQty} unit(s) are short. Use partially_received or received_with_issues.`)
  }

  const now = new Date()
  const newStatus = OUTCOME_TO_DELIVERY_STATUS[outcome]
  delivery.receipt = {
    scannedAt: delivery.receipt?.scannedAt || now,
    scannedBy: delivery.receipt?.scannedBy || req.user._id,
    outcome,
    notes: String(notes || '').trim(),
    items: receiptItems,
    totalExpected,
    totalReceived,
    shortQty,
    excessQty,
    confirmedAt: now,
    confirmedBy: req.user._id,
  }
  delivery.status = newStatus
  delivery.statusHistory.push({
    status: newStatus,
    changedAt: now,
    changedBy: req.user._id,
    description: `Site receipt: ${OUTCOME_LABELS[outcome]} (${totalReceived}/${totalExpected} units)`,
  })
  await delivery.save()

  const isIssue = outcome !== 'fully_received'
  await notificationService.notifyRole(['plant', 'admin'], {
    leadId: delivery.leadId._id,
    title: `Delivery ${delivery.deliveryNumber}: ${OUTCOME_LABELS[outcome]}`,
    body: `${delivery.leadId.projectName || 'Project'} — ${totalReceived}/${totalExpected} units received`
      + (shortQty ? `, ${shortQty} short` : '')
      + (excessQty ? `, ${excessQty} excess` : '')
      + (delivery.receipt.notes ? `. Notes: ${delivery.receipt.notes}` : ''),
    type: 'delivery',
    priority: isIssue ? 'high' : 'medium',
    refId: delivery._id,
    refModel: 'Delivery',
  })

  const saved = delivery.toObject()
  return success(res, {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    status: newStatus,
    statusLabel: OUTCOME_LABELS[outcome],
    receipt: buildReceiptSummary(saved),
    receiptUrl: buildDocuments(saved).find((d) => d.type === 'receipt').url,
  }, 'Material receipt recorded')
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

// Max length per "Update Site Contact" field; fields left out of the body keep their saved value.
const SITE_CONTACT_FIELDS = { contactName: 100, contactTitle: 100, phone: 20, email: 254, availableHours: 100, notes: 1000 }
const SITE_CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SITE_CONTACT_PHONE = /^\+?[0-9\s\-().]{7,20}$/

// PUT /deliveries/:deliveryId/site-contact — More → "Update Site Contact" → "Save Contact"
exports.updateSiteContact = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.deliveryId)) return badRequest(res, 'Invalid deliveryId')

  const updates = {}
  for (const [field, maxLength] of Object.entries(SITE_CONTACT_FIELDS)) {
    const value = req.body?.[field]
    if (value === undefined) continue
    if (value !== null && typeof value !== 'string') return badRequest(res, `${field} must be text`)
    const trimmed = (value || '').trim()
    if (trimmed.length > maxLength) return badRequest(res, `${field} must be at most ${maxLength} characters`)
    updates[field] = trimmed
  }
  if (!Object.keys(updates).length) {
    return badRequest(res, `Send at least one of: ${Object.keys(SITE_CONTACT_FIELDS).join(', ')}`)
  }
  if (updates.email) updates.email = updates.email.toLowerCase()
  if (updates.email && !SITE_CONTACT_EMAIL.test(updates.email)) return badRequest(res, 'Enter a valid email address')
  if (updates.phone && !SITE_CONTACT_PHONE.test(updates.phone)) return badRequest(res, 'Enter a valid phone number')

  const delivery = await Delivery.findById(req.params.deliveryId)
  if (!delivery) return notFound(res, 'Delivery not found')

  const current = delivery.siteContact?.toObject?.() || delivery.siteContact || {}
  const siteContact = Object.fromEntries(
    Object.keys(SITE_CONTACT_FIELDS).map((field) => [field, updates[field] ?? current[field] ?? ''])
  )
  if (!siteContact.contactName) return badRequest(res, 'contactName is required')

  delivery.siteContact = siteContact
  await delivery.save()

  return success(res, { deliveryId: delivery._id, deliveryNumber: delivery.deliveryNumber, siteContact }, 'Site contact updated')
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

// GET /deliveries/:deliveryId/download/receipt — "Receipt" button after Confirm Material Receipt
exports.downloadDeliveryReceipt = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.deliveryId)) return badRequest(res, 'Invalid deliveryId')
  const delivery = await Delivery.findById(req.params.deliveryId)
    .populate('leadId', 'projectName jobId location')
    .populate('receipt.confirmedBy', 'name')
    .lean()
  if (!delivery) return notFound(res, 'Delivery not found')
  const receipt = buildReceiptSummary(delivery)
  if (!receipt) return badRequest(res, 'Material receipt has not been confirmed for this delivery yet')

  const buffer = await generateMaterialReceiptPdf({
    deliveryNumber: delivery.deliveryNumber,
    project: { projectName: delivery.leadId?.projectName, projectId: delivery.leadId?.jobId },
    confirmedByName: delivery.receipt.confirmedBy?.name,
  }, receipt)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="delivery-${delivery.deliveryNumber || delivery._id}-receipt.pdf"`)
  return res.send(buffer)
})

// Reused by admin/employee.controller.js to render a construction employee's assigned
// deliveries with the same card shape as the construction panel itself.
module.exports.buildDeliveryCard = buildDeliveryCard
