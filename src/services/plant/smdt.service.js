const XLSX = require('xlsx')
const https = require('https')
const http = require('http')

const SMDTCostVersion = require('../../models/SMDTCostVersion')
const SMDTItem = require('../../models/SMDTItem')

/**
 * Cleans weird SMDT Excel strings:
 * "'MLOC26  '" -> "MLOC26"
 * "FT'"       -> "FT"
 * "B4214'"    -> "B4214"
 * "M "        -> "M"
 */
const cleanStr = (val) => {
  if (val == null) return null

  const s = String(val)
    .replace(/^'+/, '')
    .replace(/'+$/, '')
    .trim()

  return s || null
}

const normalizeCode = (val) => {
  const s = cleanStr(val)
  if (!s) return null

  return s
    .toUpperCase()
    .replace(/\s+/g, '')
}

const toNum = (val, fallback = null) => {
  if (val == null || val === '') return fallback

  const n = Number(
    String(val)
      .replace(/[$,]/g, '')
      .trim()
  )

  return Number.isFinite(n) ? n : fallback
}

const isAnnotationRow = (partName) => {
  if (!partName) return true

  const lower = String(partName).toLowerCase().trim()

  const annotationPrefixes = [
    'need to',
    'ft -',
    'ea -',
    'lb -',
    'cost unit',
    'added cost',
    'color prefix',
    '*c?',
    '*k?',
    '*t?',
    '*s?',
    '*m',
    '*o?',
  ]

  return annotationPrefixes.some((p) => lower.startsWith(p))
}

const downloadBuffer = (url) =>
  new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http

    lib
      .get(url, (res) => {
        if (res.statusCode >= 400) {
          reject(new Error(`Failed to download file: HTTP ${res.statusCode}`))
          return
        }

        const chunks = []

        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      .on('error', reject)
  })

const getActiveCostVersion = async () => {
  return SMDTCostVersion.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean()
}

/**
 * Actual SM_DT_COST_260224a.xlsx sheet handling.
 *
 * Standard sheets:
 * Part Name | Part Color | CostUnit | MBS Cost | Current Market Cost
 *
 * Cable:
 * Part Name | Part Color | CostUnit | MBS Cost | MBS labor Cost | Additional Cost | Current Market Cost
 *
 * Flange_Brace:
 * Part Name | Part Color | CostUnit | Matrl Cost | Labor Cost | Cost unit | Extra_Min Cost | Extra_Max Cost | Current Market Cost
 *
 * frames:
 * Part Name | Cost unit | MBS Cost | Current Market Cost
 */
const getSheetConfig = (sheetName) => {
  if (sheetName === 'frames') {
    return {
      isFrameSheet: true,
      partName: 0,
      partColor: null,
      costUnit: 1,
      mbsCost: 2,
      currentMarketCost: 3,
    }
  }

  if (sheetName === 'Cable') {
    return {
      isFrameSheet: false,
      partName: 0,
      partColor: 1,
      costUnit: 2,
      mbsCost: 3,
      laborCost: 4,
      additionalCost: 5,
      currentMarketCost: 6,
    }
  }

  if (sheetName === 'Flange_Brace') {
    return {
      isFrameSheet: false,
      partName: 0,
      partColor: 1,
      costUnit: 2,

      // In this sheet, Matrl Cost is the main material/base cost.
      mbsCost: 3,
      materialCost: 3,

      laborCost: 4,

      // row[5] is another "Cost unit" column, not needed for pricing.
      extraMinCost: 6,
      extraMaxCost: 7,
      currentMarketCost: 8,
    }
  }

  return {
    isFrameSheet: false,
    partName: 0,
    partColor: 1,
    costUnit: 2,
    mbsCost: 3,
    currentMarketCost: 4,
  }
}

const findHeaderIndex = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const firstCell = cleanStr(rows[i]?.[0])
    if (firstCell === 'Part Name') return i
  }

  // Uploaded file uses first row as header, so fallback is safe.
  return 0
}

const isValidCostUnit = (costUnit) => {
  return ['FT', 'LB', 'EA'].includes(costUnit)
}

const getRowKey = ({ category, partNameNormalized, partColorNormalized }) => {
  return `${category}|${partNameNormalized || ''}|${partColorNormalized || ''}`
}

const importSMDTFromUrl = async (fileUrl, uploadedBy, options = {}) => {
  let version = null

  try {
    const buffer = await downloadBuffer(fileUrl)

    const workbook = XLSX.read(buffer, { type: 'buffer' })

    version = await SMDTCostVersion.create({
      name: options.name || `SMDT Cost ${new Date().toISOString().slice(0, 10)}`,
      sourceFileName: options.fileName || '',
      sourceFileUrl: fileUrl,
      effectiveDate: options.effectiveDate || null,
      uploadedBy,
      isActive: false,
    })

    const stats = {
      inserted: 0,
      updated: 0,
      skippedRows: 0,
      duplicateRows: 0,
      totalItems: 0,
      sheets: [],
    }

    const skipSheets = ['Sheet1', 'Sheet2', 'Sheet3']
    const now = new Date()

    for (const sheetName of workbook.SheetNames) {

      if (skipSheets.includes(sheetName)) continue

      const config = getSheetConfig(sheetName)
      const isFrameSheet = config.isFrameSheet

      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: false,
      })

      const sheetStats = {
        name: sheetName,
        inserted: 0,
        updated: 0,
        skippedRows: 0,
        duplicateRows: 0,
      }

      if (rows.length < 2) {
        stats.sheets.push(sheetStats)
        continue
      }

      const headerIndex = findHeaderIndex(rows)
      const seenKeysInSheet = new Set()

      for (let i = headerIndex + 1; i < rows.length; i++) {
        const row = rows[i]

        const partName = cleanStr(row[config.partName])

        if (!partName || isAnnotationRow(partName)) {
          sheetStats.skippedRows++
          stats.skippedRows++
          continue
        }

        const partColor =
          config.partColor == null
            ? null
            : cleanStr(row[config.partColor]) || '--'

        const costUnit = normalizeCode(row[config.costUnit])
        const mbsCost = toNum(row[config.mbsCost])
        const currentMarketCost = toNum(row[config.currentMarketCost])

        const laborCost = toNum(row[config.laborCost], 0)
        const additionalCost = toNum(row[config.additionalCost], 0)
        const materialCost = toNum(row[config.materialCost], 0)
        const extraMinCost = toNum(row[config.extraMinCost], 0)
        const extraMaxCost = toNum(row[config.extraMaxCost], 0)

        if (!isValidCostUnit(costUnit) || mbsCost == null) {
          sheetStats.skippedRows++
          stats.skippedRows++
          continue
        }

        const partNameNormalized = normalizeCode(partName)
        const partColorNormalized = isFrameSheet ? null : normalizeCode(partColor)

        const rowKey = getRowKey({
          category: sheetName,
          partNameNormalized,
          partColorNormalized,
        })

        if (seenKeysInSheet.has(rowKey)) {
          sheetStats.duplicateRows++
          stats.duplicateRows++
        }

        seenKeysInSheet.add(rowKey)

        const doc = {
          costVersionId: version._id,
          category: sheetName,

          partName,
          partNameNormalized,

          partColor,
          partColorNormalized,

          costUnit,
          mbsCost,
          currentMarketCost,

          laborCost,
          additionalCost,
          materialCost,
          extraMinCost,
          extraMaxCost,

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
            partNameNormalized,
            partColorNormalized,
          },
          { $set: doc },
          {
            upsert: true,
            new: false,
          }
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
      await SMDTCostVersion.updateMany(
        { _id: { $ne: version._id } },
        { $set: { isActive: false } }
      )

      version.isActive = true
      await version.save()
    }

    return {
      version,
      stats,
    }
  } catch (err) {
    // Prevent half-imported inactive versions from polluting DB.
    if (version?._id) {
      await SMDTItem.deleteMany({ costVersionId: version._id })
      await SMDTCostVersion.deleteOne({ _id: version._id })
    }

    throw err
  }
}

module.exports = {
  importSMDTFromUrl,
  getActiveCostVersion,
  cleanStr,
  normalizeCode,
  toNum,
  getSheetConfig,
}