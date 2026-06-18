const BOMJob = require('../../models/BOMJob')
const BOMItem = require('../../models/BOMItem')
const Building = require('../../models/Building')
const Lead = require('../../models/Lead')
const POOrder = require('../../models/POOrder')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const SMDTItem = require('../../models/SMDTItem')
const auditService = require('../../services/audit.service')
const { processBOMJob, calculateTotalCost, inferFileFormat } = require('../../services/plant/bom.service')
const { getActiveCostVersion, normalizeCode } = require('../../services/plant/smdt.service')
const { assertBomJobAccess } = require('../../utils/plantBomAccess')
const { assertPlantProjectAccess } = require('../../utils/plantProjectAccess')
const {
  mapProjectNameFallbackFields,
  LEAD_PROJECT_LIST_SELECT,
  LEAD_PROJECT_LIST_POPULATE,
} = require('../../utils/plantProjectListFields')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS, BOM_ITEM_FILTERS } = require('../../config/constants')

// FIX #5: round money values before sending to clients so float accumulation
// (e.g. 124175.16000000002) never leaks into API responses.
const roundMoney = (n) => (n == null ? 0 : Math.round(Number(n) * 100) / 100)

const buildItemFilter = (filter) => {
  switch (filter) {
    case 'unpriced':
      return { isPriced: false }
    case 'frames':
      return { isFrameType: true }
    case 'matched':
      return { matchStatus: 'matched' }
    case 'bom_priced':
      return { priceSource: 'bom' }
    default:
      return {}
  }
}

const mapJobStatusToFileStatus = (status) => {
  if (status === 'queued') return 'uploaded'
  if (status === 'processing') return 'extracting'
  if (status === 'completed') return 'extracted'
  if (status === 'failed') return 'failed'
  return status || 'uploaded'
}

const getAssignedLeadIds = async (plantUserId) =>
  POOrder.distinct('leadId', { assignedTo: plantUserId, status: 'approved' })

const getLatestJobsForLeadIds = async (leadIds) => {
  if (!leadIds.length) return []
  return BOMJob.aggregate([
    { $match: { leadId: { $in: leadIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$buildingId', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
  ])
}

exports.getBOMStats = asyncHandler(async (req, res) => {
  const leadIds = await getAssignedLeadIds(req.user._id)
  if (!leadIds.length) {
    return success(res, {
      totalBomFilesUploaded: 0,
      pendingUploads: 0,
      readyForShipper: 0,
      issuesDetected: 0,
    })
  }

  const [totalBuildings, latestJobs, consolidatedCount] = await Promise.all([
    Building.countDocuments({ leadId: { $in: leadIds } }),
    getLatestJobsForLeadIds(leadIds),
    ConsolidatedBOM.countDocuments({ leadId: { $in: leadIds }, fileUrl: { $ne: null } }),
  ])

  const totalBomFilesUploaded = latestJobs.length
  const issuesDetected = latestJobs.filter((j) => j.status === 'failed').length
  const pendingUploads = Math.max(0, totalBuildings - totalBomFilesUploaded)

  return success(res, {
    totalBomFilesUploaded,
    pendingUploads,
    readyForShipper: consolidatedCount,
    issuesDetected,
  })
})

exports.getBOMProjectList = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const skip = (page - 1) * limit

  const leadIds = await getAssignedLeadIds(req.user._id)
  if (!leadIds.length) {
    return success(res, { projects: [], total: 0, page, limit })
  }

  const latestJobs = await getLatestJobsForLeadIds(leadIds)
  if (!latestJobs.length) {
    return success(res, { projects: [], total: 0, page, limit })
  }

  const leadIdSet = [...new Set(latestJobs.map((j) => String(j.leadId)))]
  const leads = await Lead.find({ _id: { $in: leadIdSet } })
    .select(`_id ${LEAD_PROJECT_LIST_SELECT}`)
    .populate(LEAD_PROJECT_LIST_POPULATE)
    .lean()
  const leadMap = new Map(leads.map((l) => [String(l._id), l]))

  const rows = latestJobs
    .map((job) => {
      const lead = leadMap.get(String(job.leadId))
      if (!lead) return null
      return {
        leadId: lead._id,
        projectId: lead.jobId || '',
        projectName: lead.projectName || '',
        ...mapProjectNameFallbackFields(lead),
        buildingId: job.buildingId,
        buildingNumber: job.buildingNumber,
        uploadDate: job.createdAt,
        itemCount: job.totalItems ?? 0,
        fileStatus: mapJobStatusToFileStatus(job.status),
        bomJobId: job._id,
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())

  const total = rows.length
  const projects = rows.slice(skip, skip + limit)
  return success(res, { projects, total, page, limit })
})

exports.getConsolidatedBOMUrl = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const access = await assertPlantProjectAccess(leadId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const consolidated = await ConsolidatedBOM.findOne({ leadId })
    .select('_id status fileUrl updatedAt')
    .lean()

  if (!consolidated || !consolidated.fileUrl) {
    return success(res, {
      leadId,
      isReady: false,
      consolidatedBOMId: consolidated?._id || null,
      status: consolidated?.status || null,
      fileUrl: null,
      updatedAt: consolidated?.updatedAt || null,
    })
  }

  return success(res, {
    leadId,
    isReady: true,
    consolidatedBOMId: consolidated._id,
    status: consolidated.status,
    fileUrl: consolidated.fileUrl,
    updatedAt: consolidated.updatedAt,
  })
})

exports.getJobStatus = asyncHandler(async (req, res) => {
  const result = await assertBomJobAccess(req.params.jobId, req.user._id)
  if (result.error) {
    if (result.code === 404) return notFound(res, result.error)
    return forbidden(res, result.error)
  }

  const { job } = result
  return success(res, {
    jobId: job._id,
    status: job.status,
    buildingId: job.buildingId,
    buildingNumber: job.buildingNumber,
    fileName: job.fileName,
    totalSheets: job.totalSheets ?? 0,
    totalItems: job.totalItems ?? 0,
    matchedItems: job.matchedItems ?? 0,
    unmatchedItems: job.unmatchedItems ?? 0,
    frameItems: job.frameItems ?? 0,
    skippedRows: job.skippedRows ?? 0,
    skippedSheets: job.skippedSheets || [],
    extractionMethod: job.extractionMethod || 'exceljs',
    isConfirmed: job.isConfirmed === true,
    errorMessage: job.errorMessage,
    processingStartedAt: job.processingStartedAt,
    processingEndedAt: job.processingEndedAt,
    // FIX #6: expose parse audit fields added to BOMJob schema
    parseSuspect: job.parseSuspect || false,
    parseAudit: job.parseAudit || null,
  })
})

exports.getJobsStatusBatch = asyncHandler(async (req, res) => {
  const { jobIds } = req.body
  if (!Array.isArray(jobIds) || !jobIds.length) {
    return badRequest(res, 'jobIds array is required')
  }

  const jobs = await BOMJob.find({ _id: { $in: jobIds } }).lean()
  const results = []

  for (const jobId of jobIds) {
    const job = jobs.find((j) => String(j._id) === String(jobId))
    if (!job) {
      results.push({ jobId, error: 'Not found' })
      continue
    }
    const access = await assertBomJobAccess(job._id, req.user._id)
    if (access.error) {
      results.push({ jobId, error: access.error })
      continue
    }
    results.push({
      jobId: job._id,
      status: job.status,
      buildingId: job.buildingId,
      buildingNumber: job.buildingNumber,
      totalItems: job.totalItems ?? 0,
      matchedItems: job.matchedItems ?? 0,
      unmatchedItems: job.unmatchedItems ?? 0,
      errorMessage: job.errorMessage,
      processingEndedAt: job.processingEndedAt,
      parseSuspect: job.parseSuspect || false, // FIX #6
    })
  }

  return success(res, { jobs: results })
})

exports.getBOMJob = asyncHandler(async (req, res) => {
  const result = await assertBomJobAccess(req.params.jobId, req.user._id)
  if (result.error) {
    if (result.code === 404) return notFound(res, result.error)
    return forbidden(res, result.error)
  }

  const { job } = result
  const filter = req.query.filter || 'all'
  if (!BOM_ITEM_FILTERS.includes(filter)) {
    return badRequest(res, `Invalid filter. Use one of: ${BOM_ITEM_FILTERS.join(', ')}`)
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
  const skip = (page - 1) * limit

  const itemFilter = { bomJobId: job._id, ...buildItemFilter(filter) }
  const [items, total] = await Promise.all([
    BOMItem.find(itemFilter).sort({ category: 1, rowNumber: 1 }).skip(skip).limit(limit).lean(),
    BOMItem.countDocuments(itemFilter),
  ])

  const allItems = await BOMItem.find({ bomJobId: job._id })
    .select('isPriced isFrameType finalTotalCost priceSource weight')
    .lean()

  const pricedItems = allItems.filter((i) => i.isPriced).length
  const bomPricedItems = allItems.filter((i) => i.priceSource === 'bom').length

  // FIX #5: round money sums at the boundary — never leak float noise to client.
  const totalCost = roundMoney(allItems.reduce((sum, i) => sum + (i.finalTotalCost || 0), 0))
  const totalWeight = roundMoney(allItems.reduce((sum, i) => sum + (Number(i.weight) || 0), 0))

  const itemsByCategory = items.reduce((acc, item) => {
    const key = item.category || 'Unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  return success(res, {
    bomJob: {
      _id: job._id,
      buildingId: job.buildingId,
      buildingNumber: job.buildingNumber,
      fileName: job.fileName,
      status: job.status,
      isConfirmed: job.isConfirmed === true,
      totalItems: job.totalItems ?? 0,
      matchedItems: job.matchedItems ?? 0,
      unmatchedItems: job.unmatchedItems ?? 0,
      frameItems: job.frameItems ?? 0,
      extractionMethod: job.extractionMethod,
      skippedSheets: job.skippedSheets || [],
      parseSuspect: job.parseSuspect || false, // FIX #6
      parseAudit: job.parseAudit || null,      // FIX #6
    },
    itemsByCategory,
    summary: {
      totalItems: allItems.length,
      pricedItems,
      unpricedItems: allItems.length - pricedItems,
      bomPricedItems,
      frameItems: allItems.filter((i) => i.isFrameType).length,
      totalWeight,   // FIX #5: rounded
      totalCost,     // FIX #5: rounded
      isFullyPriced: allItems.length > 0 && pricedItems === allItems.length,
    },
    total,
    page,
    limit,
  })
})

exports.priceBOMItem = asyncHandler(async (req, res) => {
  const item = await BOMItem.findById(req.params.bomItemId)
  if (!item) return notFound(res, 'BOM item not found')

  const access = await assertBomJobAccess(item.bomJobId, req.user._id)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }

  const { manualUnitCost, saveToSMDT } = req.body
  if (manualUnitCost == null || Number.isNaN(Number(manualUnitCost))) {
    return badRequest(res, 'manualUnitCost is required and must be numeric')
  }

  const unitCost = Number(manualUnitCost)
  const costUnit = item.costUnit || (item.isFrameType ? 'LB' : 'EA')

  const manualTotalCost = calculateTotalCost({
    costUnit,
    unitCost,
    quantity: item.quantity,
    lengthFeet: item.lengthFeet,
    weight: item.weight,
  })

  if (manualTotalCost == null) {
    return badRequest(res, `Cannot calculate total for cost unit ${costUnit} — missing length/weight/qty`)
  }

  item.isManuallyPriced = true
  item.manualUnitCost = unitCost
  item.manualTotalCost = manualTotalCost
  item.isPriced = true
  item.finalUnitCost = unitCost
  item.finalTotalCost = manualTotalCost
  item.costUnit = costUnit

  if (saveToSMDT === true && item.partCode && item.category) {
    const activeVersion = await getActiveCostVersion()
    if (activeVersion) {
      const partNameNormalized = normalizeCode(item.partCode)
      const partColorNormalized = item.partColor ? normalizeCode(item.partColor) : normalizeCode('--')
      await SMDTItem.findOneAndUpdate(
        {
          costVersionId: activeVersion._id,
          category: item.category,
          partNameNormalized,
          partColorNormalized,
        },
        {
          $set: {
            partName: item.partCode,
            partColor: item.partColor || '--',
            costUnit,
            mbsCost: unitCost,
            isActive: true,
            isFrameType: item.isFrameType === true,
            addedBy: req.user._id,
          },
          $setOnInsert: {
            costVersionId: activeVersion._id,
            category: item.category,
            partNameNormalized,
            partColorNormalized,
          },
        },
        { upsert: true }
      )
      item.manualPriceSavedToSMDT = true
    }
  }

  await item.save()

  return success(res, { bomItem: item })
})

exports.confirmBuildingBOM = asyncHandler(async (req, res) => {
  const { buildingId } = req.params
  const building = await Building.findById(buildingId)
  if (!building) return notFound(res, 'Building not found')

  const job = await BOMJob.findOne({ buildingId, leadId: building.leadId }).sort({ createdAt: -1 })
  if (!job) return notFound(res, 'No BOM job for this building')

  const jobAccess = await assertBomJobAccess(job._id, req.user._id)
  if (jobAccess.error) {
    if (jobAccess.code === 404) return notFound(res, jobAccess.error)
    return forbidden(res, jobAccess.error)
  }

  if (job.status !== 'completed') {
    return badRequest(res, 'BOM extraction must complete before confirmation')
  }

  const unpriced = await BOMItem.find({ bomJobId: job._id, isPriced: false }).select('markId').lean()
  if (unpriced.length) {
    return badRequest(
      res,
      `${unpriced.length} items still need pricing`,
      { unpricedMarkIds: unpriced.map((i) => i.markId).filter(Boolean) }
    )
  }

  const allItems = await BOMItem.find({ bomJobId: job._id }).select('finalTotalCost').lean()
  // FIX #5: round the confirmed total before storing/returning
  const totalCost = roundMoney(allItems.reduce((sum, i) => sum + (i.finalTotalCost || 0), 0))

  job.isConfirmed = true
  job.confirmedBy = req.user._id
  job.confirmedAt = new Date()
  await job.save()

  building.status = 'bom_confirmed'
  await building.save()

  await auditService.log({
    type: 'plant',
    action: AUDIT_ACTIONS.BOM_CONFIRMED,
    leadId: job.leadId,
    performedBy: req.user._id,
    metadata: { buildingId, buildingNumber: job.buildingNumber, totalCost },
  })

  return success(res, {
    buildingId: building._id,
    buildingNumber: job.buildingNumber,
    isConfirmed: true,
    totalCost,
  })
})