const Building = require('../models/Building')
const BOMJob = require('../models/BOMJob')
const BOMItem = require('../models/BOMItem')
const ConsolidatedBOM = require('../models/ConsolidatedBOM')
const Lead = require('../models/Lead')
const User = require('../models/User')
const Quotation = require('../models/Quotation')

const normalizeBuildingCount = (value, fallback = 1) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

const resolveBuildingCreatedBy = async (lead, performedBy) => {
  if (performedBy) return performedBy
  if (lead.assignedSales) return lead.assignedSales
  const admin = await User.findOne({ role: 'admin', isActive: true }).select('_id').lean()
  if (admin) return admin._id
  throw new Error('No valid user for building createdBy')
}

const getLatestQuotationId = async (leadId) => {
  const quotation = await Quotation.findOne({ leadId })
    .sort({ versionNumber: -1, createdAt: -1 })
    .select('_id')
    .lean()
  return quotation?._id || null
}

/**
 * Sync buildings numbered 1..targetCount for a lead.
 * - Increase: creates missing buildings.
 * - Decrease: removes buildings with buildingNumber > targetCount (and their BOM jobs/items).
 * - Sets lead.numberOfBuildings to targetCount.
 */
const syncLeadBuildings = async (lead, options = {}) => {
  const {
    numberOfBuildings,
    createdBy: performedBy,
    quotationId: quotationIdOverride = null,
  } = options

  const targetCount = normalizeBuildingCount(numberOfBuildings ?? lead.numberOfBuildings, 1)

  const existing = await Building.find({ leadId: lead._id })
    .select('_id buildingNumber')
    .sort({ buildingNumber: 1 })
    .lean()

  const existingNumbers = new Set(existing.map((b) => b.buildingNumber))
  const toRemove = existing.filter((b) => b.buildingNumber > targetCount)
  const removedBuildingNumbers = toRemove
    .map((b) => b.buildingNumber)
    .sort((a, b) => b - a)

  let removedBomJobCount = 0
  let consolidatedBomInvalidated = false

  if (toRemove.length) {
    const removeIds = toRemove.map((b) => b._id)
    const bomDeleteResult = await BOMJob.deleteMany({ buildingId: { $in: removeIds } })
    removedBomJobCount = bomDeleteResult.deletedCount || 0
    await BOMItem.deleteMany({ buildingId: { $in: removeIds } })
    await Building.deleteMany({ _id: { $in: removeIds } })

    const consolidated = await ConsolidatedBOM.findOne({ leadId: lead._id }).select('_id').lean()
    if (consolidated) {
      await ConsolidatedBOM.findByIdAndUpdate(consolidated._id, { status: 'draft' })
      consolidatedBomInvalidated = true
    }
  }

  const createdBy = await resolveBuildingCreatedBy(lead, performedBy)
  const quotationId = quotationIdOverride ?? await getLatestQuotationId(lead._id)

  const toInsert = []
  for (let buildingNumber = 1; buildingNumber <= targetCount; buildingNumber += 1) {
    if (!existingNumbers.has(buildingNumber)) {
      toInsert.push({
        leadId: lead._id,
        customerId: lead.customerId,
        buildingNumber,
        quotationId,
        createdBy,
      })
    }
  }

  let created = []
  if (toInsert.length) {
    created = await Building.insertMany(toInsert)
  }

  if (lead.numberOfBuildings !== targetCount) {
    lead.numberOfBuildings = targetCount
    await Lead.findByIdAndUpdate(lead._id, { numberOfBuildings: targetCount })
  }

  const buildings = await Building.find({ leadId: lead._id }).sort({ buildingNumber: 1 })

  return {
    buildings,
    numberOfBuildings: targetCount,
    createdCount: created.length,
    createdBuildingNumbers: toInsert.map((row) => row.buildingNumber),
    removedCount: toRemove.length,
    removedBuildingNumbers,
    removedBomJobCount,
    consolidatedBomInvalidated,
  }
}

module.exports = {
  syncLeadBuildings,
  normalizeBuildingCount,
}
