const SMDTItem = require('../../models/SMDTItem')
const auditService = require('../../services/audit.service')
const {
  importSMDTFromUrl,
  getActiveCostVersion,
  cleanStr,
  normalizeCode,
} = require('../../services/plant/smdt.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const {
  AUDIT_ACTIONS,
  SMDT_CATEGORIES,
} = require('../../config/constants')

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const formatActiveVersion = (version) => {
  if (!version) return null
  return {
    _id: version._id,
    name: version.name,
    effectiveDate: version.effectiveDate || null,
    uploadedAt: version.createdAt,
    isActive: version.isActive === true,
  }
}

exports.uploadSMDT = asyncHandler(async (req, res) => {
  const { fileUrl, fileName, name, effectiveDate, activate } = req.body

  let result
  try {
    result = await importSMDTFromUrl(fileUrl, req.user._id, {
      fileName,
      name,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      activate: activate !== false,
    })
  } catch (err) {
    return badRequest(res, err.message || 'Failed to import SMDT file')
  }

  const { version, stats } = result

  await auditService.log({
    type: 'smdt',
    action: AUDIT_ACTIONS.SMDT_BULK_UPLOADED,
    performedBy: req.user._id,
    metadata: {
      costVersionId: version._id,
      inserted: stats.inserted,
      updated: stats.updated,
      skipped: stats.skippedRows,
      total: stats.totalItems,
    },
  })

  return success(res, {
    costVersionId: version._id,
    isActive: version.isActive === true,
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skippedRows,
    total: stats.totalItems,
    sheets: stats.sheets,
  }, 'SMDT imported')
})

exports.listSMDT = asyncHandler(async (req, res) => {
  const { category, isFrameType, search, page = 1, limit = 50 } = req.query
  const parsedPage = Math.max(1, parseInt(page, 10) || 1)
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50))
  const skip = (parsedPage - 1) * parsedLimit

  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) {
    return success(res, {
      activeVersion: null,
      items: [],
      total: 0,
      page: parsedPage,
      limit: parsedLimit,
      categories: SMDT_CATEGORIES,
    })
  }

  const filter = { costVersionId: activeVersion._id }

  if (req.query.isActive === 'false') {
    filter.isActive = false
  } else if (req.query.isActive !== 'all') {
    filter.isActive = true
  }

  if (category) filter.category = category
  if (isFrameType === 'true') filter.isFrameType = true
  if (isFrameType === 'false') filter.isFrameType = false

  if (search?.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i')
    filter.$or = [{ partName: regex }, { description: regex }]
  }

  const [items, total] = await Promise.all([
    SMDTItem.find(filter)
      .sort({ category: 1, partName: 1, partColor: 1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    SMDTItem.countDocuments(filter),
  ])

  return success(res, {
    activeVersion: formatActiveVersion(activeVersion),
    items,
    total,
    page: parsedPage,
    limit: parsedLimit,
    categories: SMDT_CATEGORIES,
  })
})

exports.getSMDTItem = asyncHandler(async (req, res) => {
  const item = await SMDTItem.findById(req.params.itemId)
    .populate('addedBy', '_id name email')
    .populate('lastUpdatedBy', '_id name email')
    .populate('costVersionId', '_id name isActive effectiveDate')
    .lean()

  if (!item) return notFound(res, 'SMDT item not found')

  return success(res, { item })
})

exports.addSMDTItem = asyncHandler(async (req, res) => {
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) {
    return badRequest(res, 'No active SMDT cost version. Upload Excel first.')
  }

  const {
    category,
    partName,
    partColor,
    costUnit,
    mbsCost,
    currentMarketCost,
    laborCost,
    additionalCost,
    materialCost,
    description,
  } = req.body

  if (!SMDT_CATEGORIES.includes(category)) {
    return badRequest(res, `Invalid category. Use one of: ${SMDT_CATEGORIES.join(', ')}`)
  }

  const isFrameType = category === 'frames'
  const cleanedPartName = cleanStr(partName)
  if (!cleanedPartName) return badRequest(res, 'partName is required')

  const cleanedColor = isFrameType ? null : (cleanStr(partColor) || '--')
  const partNameNormalized = normalizeCode(cleanedPartName)
  const partColorNormalized = isFrameType ? null : normalizeCode(cleanedColor)

  const duplicate = await SMDTItem.findOne({
    costVersionId: activeVersion._id,
    category,
    partNameNormalized,
    partColorNormalized,
  }).lean()

  if (duplicate) {
    return badRequest(res, 'An item with this category, part name, and color already exists')
  }

  const item = await SMDTItem.create({
    costVersionId: activeVersion._id,
    category,
    partName: cleanedPartName,
    partNameNormalized,
    partColor: cleanedColor,
    partColorNormalized,
    costUnit,
    mbsCost,
    currentMarketCost: currentMarketCost ?? null,
    laborCost: laborCost ?? 0,
    additionalCost: additionalCost ?? 0,
    materialCost: materialCost ?? 0,
    isFrameType,
    isActive: true,
    description: description || '',
    addedBy: req.user._id,
    lastImportedAt: null,
  })

  await auditService.log({
    type: 'smdt',
    action: AUDIT_ACTIONS.SMDT_ITEM_ADDED,
    performedBy: req.user._id,
    metadata: { itemId: item._id, category, partName: cleanedPartName },
  })

  return created(res, { item }, 'SMDT item added')
})

exports.updateSMDTItem = asyncHandler(async (req, res) => {
  const item = await SMDTItem.findById(req.params.itemId)
  if (!item) return notFound(res, 'SMDT item not found')

  const allowed = [
    'mbsCost',
    'currentMarketCost',
    'costUnit',
    'laborCost',
    'additionalCost',
    'materialCost',
    'extraMinCost',
    'extraMaxCost',
    'description',
    'isActive',
  ]

  let updated = false
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      item[field] = req.body[field]
      updated = true
    }
  }

  if (!updated) return badRequest(res, 'No valid fields to update')

  item.lastUpdatedBy = req.user._id
  await item.save()

  await auditService.log({
    type: 'smdt',
    action: AUDIT_ACTIONS.SMDT_ITEM_UPDATED,
    performedBy: req.user._id,
    metadata: { itemId: item._id },
  })

  return success(res, { item })
})

exports.deactivateSMDTItem = asyncHandler(async (req, res) => {
  const item = await SMDTItem.findById(req.params.itemId)
  if (!item) return notFound(res, 'SMDT item not found')

  item.isActive = false
  item.lastUpdatedBy = req.user._id
  await item.save()

  await auditService.log({
    type: 'smdt',
    action: AUDIT_ACTIONS.SMDT_ITEM_DELETED,
    performedBy: req.user._id,
    metadata: { itemId: item._id },
  })

  return success(res, {
    message: 'Item deactivated',
    itemId: item._id,
  })
})
