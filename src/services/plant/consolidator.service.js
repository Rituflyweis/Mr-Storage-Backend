const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { v4: uuidv4 } = require('uuid')
const ExcelJS = require('exceljs')

const env = require('../../config/env')
const BOMItem = require('../../models/BOMItem')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const safeNumber = (value) => {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

const formatNumber = (value, decimals = 2) => {
  if (value == null) return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toFixed(decimals)
}

const generateConsolidatedExcel = async (lead, buildingsWithJobs, allItems) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StoragePro'

  const buildingMap = {}
  buildingsWithJobs.forEach((b) => {
    buildingMap[String(b._id)] = b.buildingNumber
  })

  /**
   * Sheet 1: Summary
   */
  const summary = workbook.addWorksheet('Summary')

  const totalCost = allItems.reduce(
    (sum, item) => sum + safeNumber(item.finalTotalCost),
    0
  )

  const totalWeight = allItems.reduce(
    (sum, item) => sum + safeNumber(item.weight),
    0
  )

  const totalQty = allItems.reduce(
    (sum, item) => sum + safeNumber(item.quantity),
    0
  )

  const summaryRows = [
    ['Project Name', lead.projectName || ''],
    ['Job ID', lead.jobId || ''],
    ['Location', lead.location || ''],
    ['Buildings', buildingsWithJobs.length],
    ['Generated', new Date().toLocaleDateString()],
    ['Total BOM Lines', allItems.length],
    ['Total Qty', totalQty],
    ['Total Weight (lbs)', totalWeight],
    ['Total Cost', totalCost],
  ]

  summaryRows.forEach((row) => summary.addRow(row))
  summary.getColumn(1).width = 22
  summary.getColumn(2).width = 35

  /**
   * Sheet 2: BOM Items
   * This is line-level internal detail.
   */
  const itemSheet = workbook.addWorksheet('BOM Items')

  const itemHeaders = [
    'Building #',
    'Category',
    'Mark ID',
    'Description',
    'Part Code',
    'Color',
    'Qty',
    'Length (ft)',
    'Weight (lbs)',
    'Cost Unit',
    'Unit Cost',
    'Total Cost',
    'Match Status',
    'Notes',
  ]

  const itemHeaderRow = itemSheet.addRow(itemHeaders)
  itemHeaderRow.font = { bold: true }
  itemHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD3D3D3' },
  }

  let grandTotal = 0

  allItems.forEach((item) => {
    const lineTotal = safeNumber(item.finalTotalCost)
    grandTotal += lineTotal

    itemSheet.addRow([
      buildingMap[String(item.buildingId)] || '',
      item.category || '',
      item.markId || '',
      item.description || '',
      item.partCode || '',
      item.partColor || '',
      item.quantity ?? '',
      item.lengthFeet ?? '',
      item.weight ?? '',
      item.costUnit || '',
      item.finalUnitCost != null ? formatNumber(item.finalUnitCost, 4) : '',
      item.finalTotalCost != null ? formatNumber(item.finalTotalCost, 2) : '',
      item.matchStatus || '',
      item.isManuallyPriced ? 'Manual price' : '',
    ])
  })

  itemSheet.addRow([])

  const totalRow = itemSheet.addRow([
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'TOTAL',
    formatNumber(grandTotal, 2),
  ])

  totalRow.font = { bold: true }

  itemSheet.columns.forEach((col) => {
    col.width = Math.max(col.width || 8, 16)
  })

  /**
   * Sheet 3: Vendor Quote
   * Keep this line-level, not grouped.
   * Vendor should see every BOM line.
   */
  const vendorSheet = workbook.addWorksheet('Vendor Quote')

  const vendorHeaders = [
    'Building #',
    'Part Code',
    'Color',
    'Description',
    'Our Qty (EA)',
    'Our Length (ft)',
    'Our Weight (lbs)',
    'Cost Unit',
    'Vendor Unit Price',
    'Vendor Total',
    'Notes',
  ]

  const vendorHeaderRow = vendorSheet.addRow(vendorHeaders)
  vendorHeaderRow.font = { bold: true }
  vendorHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFCCE5FF' },
  }

  allItems.forEach((item) => {
    vendorSheet.addRow([
      buildingMap[String(item.buildingId)] || '',
      item.partCode || '',
      item.partColor || '',
      item.description || '',
      item.quantity || '',
      item.lengthFeet || '',
      item.weight || '',
      item.costUnit || '',
      '',
      '',
      '',
    ])
  })

  vendorSheet.columns.forEach((col) => {
    col.width = Math.max(col.width || 8, 18)
  })

  const buffer = await workbook.xlsx.writeBuffer()

  return {
    buffer,
    totalCost: grandTotal,
    itemCount: allItems.length,
  }
}

/**
 * Important:
 * Grouping includes lengthFeet.
 * Otherwise same part/color with different lengths can get wrongly merged.
 */
const groupItemsForConsolidation = (items, buildingMap) => {
  const map = new Map()

  items.forEach((item) => {
    const key = [
      item.partCode || '_',
      item.partColor || '_',
      item.costUnit || '_',
      item.category || '_',
      item.description || '_',
      item.lengthFeet != null ? Number(item.lengthFeet).toFixed(4) : '_',
    ].join('|')

    if (!map.has(key)) {
      map.set(key, {
        partCode: item.partCode,
        partColor: item.partColor,
        description: item.description,
        category: item.category,
        costUnit: item.costUnit,

        unitCost: item.finalUnitCost ?? null,

        totalQty: 0,
        totalLengthFeet: 0,
        totalWeight: 0,
        totalCost: 0,

        buildings: new Set(),
        markIds: [],
        bomItemIds: [],

        sourceLineCount: 0,
        isFullyPriced: true,
      })
    }

    const group = map.get(key)

    group.totalQty += safeNumber(item.quantity)
    group.totalLengthFeet += safeNumber(item.lengthFeet)
    group.totalWeight += safeNumber(item.weight)
    group.totalCost += safeNumber(item.finalTotalCost)

    group.buildings.add(buildingMap[String(item.buildingId)] || 0)

    if (item.markId) {
      group.markIds.push(item.markId)
    }

    if (item._id) {
      group.bomItemIds.push(item._id)
    }

    group.sourceLineCount += 1

    if (item.isPriced !== true) {
      group.isFullyPriced = false
    }
  })

  return Array.from(map.values()).map((group) => ({
    partCode: group.partCode,
    partColor: group.partColor,
    description: group.description,
    category: group.category,
    costUnit: group.costUnit,

    unitCost: group.unitCost,

    totalQty: group.totalQty,
    totalLengthFeet: group.totalLengthFeet,
    totalWeight: group.totalWeight,
    totalCost: group.totalCost,

    buildings: [...group.buildings].filter(Boolean).sort((a, b) => a - b),
    markIds: [...new Set(group.markIds)],
    bomItemIds: group.bomItemIds,

    sourceLineCount: group.sourceLineCount,
    isFullyPriced: group.isFullyPriced,
  }))
}

const uploadConsolidatedExcelToS3 = async (buffer, leadId) => {
  if (!env.AWS_S3_BUCKET || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    const err = new Error('S3 is not configured. Set AWS_S3_BUCKET and credentials.')
    err.statusCode = 503
    throw err
  }

  const key = `consolidated/${leadId}/${Date.now()}-${uuidv4()}.xlsx`

  const contentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  await s3.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: Buffer.from(buffer),
      ContentType: contentType,
    })
  )

  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`

  return {
    fileUrl,
    key,
  }
}

/**
 * Safer than loadPricedBomItemsForBuildings.
 * We load all BOM items, then controller validates if any are unpriced.
 */
const loadBomItemsForBuildings = (buildingIds) => {
  return BOMItem.find({
    buildingId: { $in: buildingIds },
  })
    .sort({ category: 1, markId: 1 })
    .lean()
}

module.exports = {
  generateConsolidatedExcel,
  groupItemsForConsolidation,
  uploadConsolidatedExcelToS3,
  loadBomItemsForBuildings,
}