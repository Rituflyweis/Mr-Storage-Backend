const ExcelJS = require('exceljs')
const https = require('https')
const http = require('http')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const SMDTItem = require('../../models/SMDTItem')

const cleanStr = (val) => {
  if (val == null) return null
  const s = String(val).replace(/^'+/, '').replace(/'+$/, '').trim()
  return s || null
}

const normalizeCode = (val) => {
  const s = cleanStr(val)
  if (!s) return null
  return s.toUpperCase().replace(/\s+/g, '')
}

const toNum = (val, fallback = null) => {
  if (val == null || val === '') return fallback
  const n = Number(String(val).replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

const isAnnotationRow = (partName) => {
  if (!partName) return true
  const lower = partName.toLowerCase()
  return ['need to', 'ft -', 'ea -', 'lb -', 'cost unit', 'added cost', 'color prefix'].some((p) => lower.startsWith(p))
}

const downloadBuffer = (url) => new Promise((resolve, reject) => {
  const lib = url.startsWith('https') ? https : http
  lib.get(url, (res) => {
    if (res.statusCode >= 400) {
      reject(new Error(`Failed to download file: HTTP ${res.statusCode}`))
      return
    }
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  }).on('error', reject)
})

const getActiveCostVersion = async () =>
  SMDTCostVersion.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()

const importSMDTFromUrl = async (fileUrl, uploadedBy, options = {}) => {
  const buffer = await downloadBuffer(fileUrl)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const version = await SMDTCostVersion.create({
    name: options.name || `SMDT Cost ${new Date().toISOString().slice(0, 10)}`,
    sourceFileName: options.fileName || '',
    sourceFileUrl: fileUrl,
    effectiveDate: options.effectiveDate || null,
    uploadedBy,
    isActive: false,
  })

  const stats = { inserted: 0, updated: 0, skippedRows: 0, duplicateRows: 0, totalItems: 0, sheets: [] }
  const skipSheets = ['Sheet1', 'Sheet2', 'Sheet3']
  const now = new Date()

  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name
    if (skipSheets.includes(sheetName)) continue

    const rows = []
    worksheet.eachRow((row) => {
      const vals = []
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cell.text || cell.value || null))
      rows.push(vals)
    })

    if (rows.length < 2) continue

    const isFrameSheet = sheetName === 'frames'
    const sheetStats = { name: sheetName, inserted: 0, updated: 0, skippedRows: 0 }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const partName = cleanStr(row[0])
      if (!partName || isAnnotationRow(partName)) {
        sheetStats.skippedRows++
        stats.skippedRows++
        continue
      }

      const partColor = isFrameSheet ? null : (cleanStr(row[1]) || '--')
      const costUnit = normalizeCode(isFrameSheet ? row[1] : row[2])
      const mbsCost = toNum(isFrameSheet ? row[2] : row[3])
      const currentMarketCost = toNum(isFrameSheet ? row[3] : row[4])

      if (!['FT', 'LB', 'EA'].includes(costUnit) || mbsCost == null) {
        sheetStats.skippedRows++
        stats.skippedRows++
        continue
      }

      const doc = {
        costVersionId: version._id,
        category: sheetName,
        partName,
        partNameNormalized: normalizeCode(partName),
        partColor,
        partColorNormalized: isFrameSheet ? null : normalizeCode(partColor),
        costUnit,
        mbsCost,
        currentMarketCost,
        isFrameType: isFrameSheet,
        isActive: true,
        rawRow: row,
        rowNumber: i + 1,
        lastImportedAt: now,
      }

      const existing = await SMDTItem.findOneAndUpdate(
        {
          costVersionId: version._id,
          category: sheetName,
          partNameNormalized: doc.partNameNormalized,
          partColorNormalized: doc.partColorNormalized,
        },
        { $set: doc },
        { upsert: true, new: false }
      )

      if (existing) {
        sheetStats.updated++
        stats.updated++
      } else {
        sheetStats.inserted++
        stats.inserted++
      }
      stats.totalItems++
    }
    stats.sheets.push(sheetStats)
  }

  version.stats = stats
  await version.save()

  const shouldActivate = options.activate !== false
  if (shouldActivate) {
    await SMDTCostVersion.updateMany({ _id: { $ne: version._id } }, { $set: { isActive: false } })
    version.isActive = true
    await version.save()
  }

  return { version, stats }
}

module.exports = {
  importSMDTFromUrl,
  getActiveCostVersion,
  cleanStr,
  normalizeCode,
}
