const ExcelJS = require('exceljs')
const SMDTItem = require('../../models/SMDTItem')
const { getActiveCostVersion } = require('./smdt.service')

const buildSMDTExportFilter = ({
  category,
  isFrameType,
  isActive,
  search,
  activeVersionId,
}) => {
  const filter = { costVersionId: activeVersionId }

  if (isActive === 'false') {
    filter.isActive = false
  } else if (isActive !== 'all') {
    filter.isActive = true
  }

  if (category) filter.category = category
  if (isFrameType === 'true') filter.isFrameType = true
  if (isFrameType === 'false') filter.isFrameType = false

  if (search?.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ partName: regex }, { description: regex }]
  }

  return filter
}

const buildSMDTStats = async (activeVersion, filters = {}) => {
  if (!activeVersion) {
    return {
      totalItems: 0,
      totalItemCost: 0,
      newAdded: 0,
      newlyAdded: 0,
    }
  }

  const baseFilter = buildSMDTExportFilter({ ...filters, activeVersionId: activeVersion._id })
  const items = await SMDTItem.find(baseFilter)
    .select('mbsCost currentMarketCost createdAt')
    .lean()

  const totalItemCost = items.reduce((sum, row) => {
    const cost = Number(row.currentMarketCost ?? row.mbsCost ?? 0)
    return sum + (Number.isFinite(cost) ? cost : 0)
  }, 0)

  const versionCreatedAt = activeVersion.createdAt ? new Date(activeVersion.createdAt) : null
  const newAdded = versionCreatedAt
    ? items.filter((row) => new Date(row.createdAt).getTime() >= versionCreatedAt.getTime()).length
    : 0

  return {
    totalItems: items.length,
    totalItemCost: Math.round(totalItemCost * 100) / 100,
    newAdded,
    newlyAdded: newAdded,
    lastImportInserted: activeVersion.stats?.inserted ?? 0,
    lastImportUpdated: activeVersion.stats?.updated ?? 0,
  }
}

const buildSMDTExportWorkbook = async (items = []) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('SMDT')

  sheet.columns = [
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Part Name', key: 'partName', width: 24 },
    { header: 'Part Color', key: 'partColor', width: 14 },
    { header: 'Cost Unit', key: 'costUnit', width: 10 },
    { header: 'MBS Cost', key: 'mbsCost', width: 12 },
    { header: 'Current Market Cost', key: 'currentMarketCost', width: 16 },
    { header: 'Labor Cost', key: 'laborCost', width: 12 },
    { header: 'Additional Cost', key: 'additionalCost', width: 14 },
    { header: 'Material Cost', key: 'materialCost', width: 14 },
    { header: 'Frame Type', key: 'isFrameType', width: 10 },
    { header: 'Active', key: 'isActive', width: 8 },
    { header: 'Description', key: 'description', width: 32 },
  ]

  for (const item of items) {
    sheet.addRow({
      category: item.category || '',
      partName: item.partName || '',
      partColor: item.partColor || '',
      costUnit: item.costUnit || '',
      mbsCost: item.mbsCost ?? '',
      currentMarketCost: item.currentMarketCost ?? '',
      laborCost: item.laborCost ?? '',
      additionalCost: item.additionalCost ?? '',
      materialCost: item.materialCost ?? '',
      isFrameType: item.isFrameType ? 'Yes' : 'No',
      isActive: item.isActive ? 'Yes' : 'No',
      description: item.description || '',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook
}

const exportActiveSMDTToExcelBuffer = async (query = {}) => {
  const activeVersion = await getActiveCostVersion()
  if (!activeVersion) {
    const workbook = await buildSMDTExportWorkbook([])
    return workbook.xlsx.writeBuffer()
  }

  const filter = buildSMDTExportFilter({
    ...query,
    activeVersionId: activeVersion._id,
  })

  const items = await SMDTItem.find(filter)
    .sort({ category: 1, partName: 1, partColor: 1 })
    .lean()

  const workbook = await buildSMDTExportWorkbook(items)
  return workbook.xlsx.writeBuffer()
}

const getActiveSMDTStats = async (filters = {}) => {
  const activeVersion = await getActiveCostVersion()
  const stats = await buildSMDTStats(activeVersion, filters)

  return {
    activeVersion: activeVersion
      ? {
          _id: activeVersion._id,
          name: activeVersion.name,
          effectiveDate: activeVersion.effectiveDate || null,
          uploadedAt: activeVersion.createdAt,
          isActive: activeVersion.isActive === true,
        }
      : null,
    ...stats,
  }
}

module.exports = {
  buildSMDTExportFilter,
  buildSMDTStats,
  exportActiveSMDTToExcelBuffer,
  getActiveSMDTStats,
}
