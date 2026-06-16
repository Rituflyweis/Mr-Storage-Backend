const Building = require('../models/Building')
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
 * Ensure buildings numbered 1..targetCount exist for a lead.
 * Additive only — existing buildings are never deleted.
 * Updates lead.numberOfBuildings to max(targetCount, highest existing buildingNumber).
 */
const syncLeadBuildings = async (lead, options = {}) => {
  const {
    numberOfBuildings,
    createdBy: performedBy,
    quotationId: quotationIdOverride = null,
  } = options

  const targetCount = normalizeBuildingCount(numberOfBuildings ?? lead.numberOfBuildings, 1)

  const existing = await Building.find({ leadId: lead._id }).select('buildingNumber').lean()
  const existingNumbers = new Set(existing.map((b) => b.buildingNumber))
  const maxExisting = existing.reduce((max, b) => Math.max(max, b.buildingNumber), 0)

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

  const effectiveCount = Math.max(targetCount, maxExisting)
  if (lead.numberOfBuildings !== effectiveCount) {
    lead.numberOfBuildings = effectiveCount
    await Lead.findByIdAndUpdate(lead._id, { numberOfBuildings: effectiveCount })
  }

  const buildings = await Building.find({ leadId: lead._id }).sort({ buildingNumber: 1 })

  return {
    buildings,
    numberOfBuildings: effectiveCount,
    createdCount: created.length,
    createdBuildingNumbers: toInsert.map((row) => row.buildingNumber),
  }
}

module.exports = {
  syncLeadBuildings,
  normalizeBuildingCount,
}
