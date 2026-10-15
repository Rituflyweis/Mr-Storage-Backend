const ExcelJS = require('exceljs')
const SMDTItem = require('../models/SMDTItem')
const { SMDT_CATEGORIES } = require('../config/constants')
const { getActiveCostVersion, cleanStr, normalizeCode } = require('./plant/smdt.service')

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const mapPartRow = (item) => ({
  itemId: item._id,
  partName: item.partName,
  partColour: item.partColor && item.partColor !== '--' ? item.partColor : null,
  costUnit: item.costUnit,
  mbsCost: item.mbsCost,
  currentMarketCost: item.currentMarketCost ?? null,
  description: item.description || '',
  category: item.category,
  isActive: item.isActive,
  updatedAt: item.updatedAt,
  createdAt: item.createdAt,
})

const buildFilter = async (query = {}) => {
  const { search, category } = query
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) return { activeVersion: null, filter: null }

  const filter = { costVersionId: activeVersion._id, isActive: true }
  if (category && category !== 'All') filter.category = category
  if (search?.trim()) {
    const term = search.trim()
    filter.$or = [
      { partName: { $regex: term, $options: 'i' } },
      { description: { $regex: term, $options: 'i' } },
      { partNameNormalized: normalizeCode(term) },
    ]
  }
  return { activeVersion, filter }
}

const computeStats = async (activeVersion, filter) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [statsAgg, newAdded] = await Promise.all([
    SMDTItem.aggregate([
      { $match: filter },
      { $group: { _id: null, totalCost: { $sum: '$mbsCost' }, count: { $sum: 1 } } },
    ]),
    SMDTItem.countDocuments({
      costVersionId: activeVersion._id,
      isActive: true,
      createdAt: { $gte: weekAgo },
    }),
  ])
  const s = statsAgg[0] || {}
  return {
    totalItemCost: round2(s.totalCost || 0),
    totalItems: s.count || 0,
    newAdded,
  }
}

const resolveSort = (sort) => {
  if (sort === 'latest') return { createdAt: -1 }
  if (sort === 'mbsCostDesc') return { mbsCost: -1 }
  if (sort === 'mbsCostAsc') return { mbsCost: 1 }
  return { partName: 1 }
}

exports.getCategories = () => ({ categories: SMDT_CATEGORIES })

exports.getActiveVersionMeta = async () => {
  const v = await getActiveCostVersion()
  if (!v) return null
  return { costVersionId: v._id, name: v.name, activatedAt: v.updatedAt || v.createdAt }
}

exports.getSummary = async (query) => {
  const { activeVersion, filter } = await buildFilter(query)
  if (!activeVersion) {
    return {
      stats: { totalItemCost: 0, totalItems: 0, newAdded: 0 },
      costVersion: null,
    }
  }
  const stats = await computeStats(activeVersion, filter)
  return {
    stats,
    costVersion: { costVersionId: activeVersion._id, name: activeVersion.name },
  }
}

/** Figma "Part Cost List" — SMDT active version items. */
exports.getPartCostList = async (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20))
  const skip = (page - 1) * limit
  const sort = resolveSort(query.sort)

  const { activeVersion, filter } = await buildFilter(query)
  if (!activeVersion) {
    return {
      stats: { totalItemCost: 0, totalItems: 0, newAdded: 0 },
      rows: [],
      costVersion: null,
      pagination: { page, limit, total: 0, totalPages: 1 },
    }
  }

  const [items, total, stats] = await Promise.all([
    SMDTItem.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    SMDTItem.countDocuments(filter),
    computeStats(activeVersion, filter),
  ])

  return {
    stats,
    rows: items.map(mapPartRow),
    costVersion: { costVersionId: activeVersion._id, name: activeVersion.name },
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

exports.getPartCostById = async (itemId) => {
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) return null
  const item = await SMDTItem.findOne({
    _id: itemId,
    costVersionId: activeVersion._id,
    isActive: true,
  }).lean()
  return item ? mapPartRow(item) : null
}

exports.createPartCost = async (body, userId) => {
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) return { error: 'No active SMDT cost version. Upload SMDT Excel via plant/admin first.' }

  const { category, partName, partColor, costUnit, mbsCost, currentMarketCost, description } = body
  if (!SMDT_CATEGORIES.includes(category)) {
    return { error: `Invalid category. Use: ${SMDT_CATEGORIES.join(', ')}` }
  }

  const isFrameType = category === 'frames'
  const cleanedPartName = cleanStr(partName)
  if (!cleanedPartName) return { error: 'partName is required' }
  if (mbsCost == null || Number.isNaN(Number(mbsCost))) return { error: 'mbsCost is required' }
  if (!costUnit) return { error: 'costUnit is required' }

  const cleanedColor = isFrameType ? null : cleanStr(partColor) || '--'
  const partNameNormalized = normalizeCode(cleanedPartName)
  const partColorNormalized = isFrameType ? null : normalizeCode(cleanedColor)

  const duplicate = await SMDTItem.findOne({
    costVersionId: activeVersion._id,
    category,
    partNameNormalized,
    partColorNormalized,
  }).lean()
  if (duplicate) return { error: 'Item already exists for this category, part name, and colour' }

  const item = await SMDTItem.create({
    costVersionId: activeVersion._id,
    category,
    partName: cleanedPartName,
    partNameNormalized,
    partColor: cleanedColor,
    partColorNormalized,
    costUnit,
    mbsCost: Number(mbsCost),
    currentMarketCost: currentMarketCost != null ? Number(currentMarketCost) : null,
    isFrameType,
    isActive: true,
    description: description || '',
    addedBy: userId,
  })

  return { row: mapPartRow(item.toObject()) }
}

exports.updatePartCost = async (itemId, body, userId) => {
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) return { error: 'No active SMDT cost version' }

  const item = await SMDTItem.findOne({ _id: itemId, costVersionId: activeVersion._id })
  if (!item) return { error: 'Item not found' }

  const { partName, partColor, costUnit, mbsCost, currentMarketCost, description, isActive } = body
  if (partName !== undefined) {
    item.partName = cleanStr(partName)
    item.partNameNormalized = normalizeCode(item.partName)
  }
  if (partColor !== undefined && !item.isFrameType) {
    item.partColor = cleanStr(partColor) || '--'
    item.partColorNormalized = normalizeCode(item.partColor)
  }
  if (costUnit !== undefined) item.costUnit = costUnit
  if (mbsCost !== undefined) item.mbsCost = Number(mbsCost)
  if (currentMarketCost !== undefined) item.currentMarketCost = currentMarketCost == null ? null : Number(currentMarketCost)
  if (description !== undefined) item.description = description
  if (isActive !== undefined) item.isActive = Boolean(isActive)
  item.lastUpdatedBy = userId
  await item.save()
  return { row: mapPartRow(item.toObject()) }
}

exports.exportPartCostExcel = async (query = {}) => {
  const { activeVersion, filter } = await buildFilter(query)
  if (!activeVersion) {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Part Cost List')
    return wb.xlsx.writeBuffer()
  }

  const items = await SMDTItem.find(filter).sort(resolveSort(query.sort)).lean()
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Part Cost List')
  sheet.columns = [
    { header: 'Part Name', key: 'partName', width: 25 },
    { header: 'Part Colour', key: 'partColor', width: 16 },
    { header: 'Cost Unit', key: 'costUnit', width: 12 },
    { header: 'MBS Cost', key: 'mbsCost', width: 14 },
    { header: 'Current Market Cost', key: 'currentMarketCost', width: 18 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Category', key: 'category', width: 16 },
  ]
  for (const item of items) {
    sheet.addRow({
      partName: item.partName || '—',
      partColor: item.partColor || '—',
      costUnit: item.costUnit || '—',
      mbsCost: item.mbsCost || 0,
      currentMarketCost: item.currentMarketCost ?? '—',
      description: item.description || '',
      category: item.category || '',
    })
  }
  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}
