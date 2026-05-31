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

const generateConsolidatedExcel = async (lead, buildingsWithJobs, allItems) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StoragePro'

  const summary = workbook.addWorksheet('Summary')
  const summaryRows = [
    ['Project Name', lead.projectName || ''],
    ['Job ID', lead.jobId || ''],
    ['Location', lead.location || ''],
    ['Buildings', buildingsWithJobs.length],
    ['Generated', new Date().toLocaleDateString()],
  ]
  summaryRows.forEach((r) => summary.addRow(r))
  summary.getColumn(1).width = 18
  summary.getColumn(2).width = 30

  const buildingMap = {}
  buildingsWithJobs.forEach((b) => { buildingMap[String(b._id)] = b.buildingNumber })

  const itemSheet = workbook.addWorksheet('BOM Items')
  const itemHeaders = [
    'Building #', 'Category', 'Mark ID', 'Description',
    'Part Code', 'Color', 'Qty', 'Length (ft)', 'Weight (lbs)',
    'Cost Unit', 'Unit Cost', 'Total Cost', 'Notes',
  ]
  const itemHeaderRow = itemSheet.addRow(itemHeaders)
  itemHeaderRow.font = { bold: true }
  itemHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }

  let grandTotal = 0
  allItems.forEach((item) => {
    itemSheet.addRow([
      buildingMap[String(item.buildingId)] || '',
      item.category,
      item.markId,
      item.description,
      item.partCode || '',
      item.partColor || '',
      item.quantity || '',
      item.lengthFeet || '',
      item.weight || '',
      item.costUnit || '',
      item.finalUnitCost != null ? item.finalUnitCost.toFixed(4) : '',
      item.finalTotalCost != null ? item.finalTotalCost.toFixed(2) : '',
      item.isManuallyPriced ? 'Manual price' : '',
    ])
    grandTotal += item.finalTotalCost || 0
  })

  itemSheet.addRow([])
  const totalRow = itemSheet.addRow(['', '', '', '', '', '', '', '', '', '', 'TOTAL', grandTotal.toFixed(2)])
  totalRow.font = { bold: true }
  itemSheet.columns.forEach((col) => { col.width = Math.max(col.width || 8, 14) })

  const vendorSheet = workbook.addWorksheet('Vendor Quote')
  const vendorHeaders = [
    'Part Code', 'Color', 'Description', 'Our Qty (EA)',
    'Our Length (ft)', 'Our Weight (lbs)', 'Cost Unit',
    'Vendor Unit Price', 'Vendor Total', 'Notes',
  ]
  const vendorHeaderRow = vendorSheet.addRow(vendorHeaders)
  vendorHeaderRow.font = { bold: true }
  vendorHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCE5FF' } }

  allItems.forEach((item) => {
    vendorSheet.addRow([
      item.partCode || '',
      item.partColor || '',
      item.description,
      item.quantity || '',
      item.lengthFeet || '',
      item.weight || '',
      item.costUnit || '',
      '',
      '',
      '',
    ])
  })
  vendorSheet.columns.forEach((col) => { col.width = Math.max(col.width || 8, 16) })

  const buffer = await workbook.xlsx.writeBuffer()
  return { buffer, totalCost: grandTotal, itemCount: allItems.length }
}

const groupItemsForConsolidation = (items, buildingMap) => {
  const map = new Map()

  items.forEach((item) => {
    const key = `${item.partCode || '_'}|${item.partColor || '_'}`
    if (!map.has(key)) {
      map.set(key, {
        partCode: item.partCode,
        partColor: item.partColor,
        description: item.description,
        category: item.category,
        costUnit: item.costUnit,
        totalQty: 0,
        totalLengthFeet: 0,
        totalWeight: 0,
        totalCost: 0,
        buildings: new Set(),
        markIds: [],
      })
    }
    const g = map.get(key)
    g.totalQty += item.quantity || 0
    g.totalLengthFeet += item.lengthFeet || 0
    g.totalWeight += item.weight || 0
    g.totalCost += item.finalTotalCost || 0
    g.buildings.add(buildingMap[String(item.buildingId)] || 0)
    if (item.markId) g.markIds.push(item.markId)
  })

  return Array.from(map.values()).map((g) => ({
    partCode: g.partCode,
    partColor: g.partColor,
    description: g.description,
    category: g.category,
    costUnit: g.costUnit,
    totalQty: g.totalQty,
    totalLengthFeet: g.totalLengthFeet,
    totalWeight: g.totalWeight,
    totalCost: g.totalCost,
    buildings: [...g.buildings].sort((a, b) => a - b),
    markIds: g.markIds,
  }))
}

const uploadConsolidatedExcelToS3 = async (buffer, leadId) => {
  if (!env.AWS_S3_BUCKET || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    const err = new Error('S3 is not configured. Set AWS_S3_BUCKET and credentials.')
    err.statusCode = 503
    throw err
  }

  const key = `consolidated/${leadId}/${Date.now()}-${uuidv4()}.xlsx`
  const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  await s3.send(new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    Body: Buffer.from(buffer),
    ContentType: contentType,
  }))

  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
  return { fileUrl, key }
}

const loadPricedBomItemsForBuildings = (buildingIds) =>
  BOMItem.find({
    buildingId: { $in: buildingIds },
    isPriced: true,
  }).sort({ category: 1, markId: 1 }).lean()

module.exports = {
  generateConsolidatedExcel,
  groupItemsForConsolidation,
  uploadConsolidatedExcelToS3,
  loadPricedBomItemsForBuildings,
}
