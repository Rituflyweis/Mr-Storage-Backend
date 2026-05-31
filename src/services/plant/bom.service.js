const Anthropic = require('@anthropic-ai/sdk')
const https = require('https')
const http = require('http')
const ExcelJS = require('exceljs')
const XLSX = require('xlsx')
const env = require('../../config/env')
const SMDTCostVersion = require('../../models/SMDTCostVersion')
const SMDTItem = require('../../models/SMDTItem')
const SMDTColorAlias = require('../../models/SMDTColorAlias')
const SMDTPartAlias = require('../../models/SMDTPartAlias')
const BOMItem = require('../../models/BOMItem')
const BOMJob = require('../../models/BOMJob')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { normalizeCode } = require('./smdt.service')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
const INSERT_BATCH_SIZE = 500
const SKIP_SHEET_NAMES = new Set(['COVER_SHEET', 'Sheet1', 'Sheet2', 'Sheet3'])

const cleanStr = (val) => {
  if (val == null) return null
  const s = String(val).replace(/^'+/, '').replace(/'+$/, '').trim()
  return s || null
}

const toNum = (val, fallback = null) => {
  if (val == null || val === '') return fallback
  const n = Number(String(val).replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : fallback
}

const normalizeColor = (val) => normalizeCode(val)

const parseLengthToFeet = (value) => {
  if (!value) return null
  const str = String(value).replace(/[""]/g, '"').replace(/['']/g, "'").trim()
  let feet = 0
  let inches = 0
  const feetMatch = str.match(/(\d+(?:\.\d+)?)\s*'/)
  if (feetMatch) feet = Number(feetMatch[1])
  const afterFeet = str.includes("'") ? str.split("'").slice(1).join("'") : str
  const mixed = afterFeet.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/)
  if (mixed) inches += Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  else {
    const whole = afterFeet.match(/(\d+(?:\.\d+)?)(?=\s*"|\s|$)/)
    const frac = afterFeet.match(/(\d+)\s*\/\s*(\d+)/)
    if (whole && !afterFeet.includes('/')) inches += Number(whole[1])
    if (frac) inches += Number(frac[1]) / Number(frac[2])
  }
  if (!feetMatch && str.includes('"')) return inches / 12
  return feet + inches / 12
}

const calculateTotalCost = ({ costUnit, unitCost, quantity, lengthFeet, weight }) => {
  if (unitCost == null) return null
  if (costUnit === 'EA') return Number(quantity || 0) * unitCost
  if (costUnit === 'FT') return lengthFeet == null ? null : Number(quantity || 0) * Number(lengthFeet) * unitCost
  if (costUnit === 'LB') return Number(weight || 0) * unitCost
  return null
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

const inferFileFormat = (fileName, fileFormat) => {
  if (fileFormat) return fileFormat
  const ext = String(fileName || '').split('.').pop()?.toLowerCase()
  if (['ods', 'xlsx', 'xls'].includes(ext)) return ext
  return 'xlsx'
}

const sheetRowsFromXlsBuffer = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false })
    return { name, rows }
  })
}

const sheetRowsFromExcelJs = async (buffer, fileFormat) => {
  const workbook = new ExcelJS.Workbook()
  if (fileFormat === 'ods') await workbook.ods.load(buffer)
  else await workbook.xlsx.load(buffer)

  const sheets = []
  workbook.eachSheet((ws) => {
    const rows = []
    ws.eachRow((row) => {
      const vals = []
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cell.text || cell.value || null))
      rows.push(vals)
    })
    sheets.push({ name: ws.name, rows })
  })
  return sheets
}

const loadSheetRows = async (buffer, fileFormat) => {
  if (fileFormat === 'xls') return sheetRowsFromXlsBuffer(buffer)
  return sheetRowsFromExcelJs(buffer, fileFormat)
}

const findHeaderRow = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const r = (rows[i] || []).map((v) => normalizeCode(v))
    if (r.includes('QTY') && (r.includes('PART') || r.includes('DESCRIPTION') || r.includes('MBIP/N'))) {
      return i
    }
  }
  return -1
}

const col = (headers, aliases) => headers.findIndex((h) => aliases.includes(h))

const parseRowsToItems = (sheetName, rows, headerIdx) => {
  const items = []
  let skippedRows = 0
  const h = rows[headerIdx].map(normalizeCode)
  const iQty = col(h, ['QTY', 'QUANTITY'])
  const iMark = col(h, ['MARK', 'MARKID', 'PIECEMARK'])
  const iDesc = col(h, ['DESCRIPTION', 'DESC'])
  const iPart = col(h, ['PART', 'PARTCODE', 'MBIP/N', 'ITEM'])
  const iColor = col(h, ['COLOR', 'COLOUR', 'FINISH'])
  const iLength = col(h, ['LENGTH', 'LEN'])
  const iWeight = col(h, ['WEIGHT', 'WT'])
  const iGauge = col(h, ['THICK', 'GAUGE'])
  const iAngle = col(h, ['ANGLE'])
  const iType = col(h, ['TYPE'])

  if (iQty < 0) {
    return { items, skippedRows, error: 'Missing QTY column' }
  }

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const joined = row.map((v) => cleanStr(v) || '').join(' ').toLowerCase()
    if (!joined.trim() || joined.includes('total weight') || joined.startsWith('total')) {
      skippedRows++
      continue
    }

    const quantity = toNum(row[iQty])
    if (!quantity || quantity <= 0) {
      skippedRows++
      continue
    }

    const partCode = iPart >= 0 ? cleanStr(row[iPart]) : null
    const partColor = iColor >= 0 ? cleanStr(row[iColor]) : null
    const lengthRaw = iLength >= 0 ? cleanStr(row[iLength]) : null

    items.push({
      sourceSheetName: sheetName,
      category: sheetName,
      rowNumber: r + 1,
      quantity,
      markId: iMark >= 0 ? cleanStr(row[iMark]) || '' : '',
      description: iDesc >= 0 ? cleanStr(row[iDesc]) || '' : '',
      partCode,
      partCodeNormalized: normalizeCode(partCode),
      partColor,
      partColorNormalized: normalizeColor(partColor),
      lengthRaw,
      lengthFeet: parseLengthToFeet(lengthRaw),
      weight: iWeight >= 0 ? toNum(row[iWeight]) : null,
      gauge: iGauge >= 0 ? cleanStr(row[iGauge]) : null,
      angle: iAngle >= 0 ? cleanStr(row[iAngle]) : null,
      type: iType >= 0 ? cleanStr(row[iType]) : null,
      isFrameType: /frame|column|rafter|opening framing/i.test(sheetName),
      isBuyout: !partCode || ['BUYOUT', '-', 'N/A'].includes(normalizeCode(partCode)),
      rawRow: row,
    })
  }

  return { items, skippedRows }
}

const extractBOMItemsFromSheets = (sheets) => {
  const items = []
  let skippedRows = 0
  const skippedSheets = []

  for (const { name, rows } of sheets) {
    if (SKIP_SHEET_NAMES.has(name)) continue
    if (!rows || rows.length < 2) {
      skippedSheets.push({ name, reason: 'Sheet empty or too few rows' })
      continue
    }

    const headerIdx = findHeaderRow(rows)
    if (headerIdx < 0) {
      skippedSheets.push({ name, reason: 'Header row not found (expected QTY + PART/DESCRIPTION)' })
      continue
    }

    const parsed = parseRowsToItems(name, rows, headerIdx)
    if (parsed.error) {
      skippedSheets.push({ name, reason: parsed.error })
      continue
    }

    items.push(...parsed.items)
    skippedRows += parsed.skippedRows
  }

  return { items, skippedRows, skippedSheets }
}

const sheetsToText = (sheets, maxRowsPerSheet = 120) =>
  sheets
    .filter((s) => !SKIP_SHEET_NAMES.has(s.name))
    .map(({ name, rows }) => {
      const slice = (rows || []).slice(0, maxRowsPerSheet)
      const lines = slice.map((row) => (row || []).map((c) => cleanStr(c) ?? '').join('\t'))
      return `=== Sheet: ${name} ===\n${lines.join('\n')}`
    })
    .join('\n\n')

const extractBOMItemsWithClaude = async (sheets) => {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('No BOM rows extracted and ANTHROPIC_API_KEY is not configured for fallback parsing')
  }

  const text = sheetsToText(sheets)
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system: 'You extract BOM line items from spreadsheet text. Return ONLY valid JSON — no markdown.',
    messages: [{
      role: 'user',
      content: `Extract BOM line items from these spreadsheet sheets. Return JSON:
{
  "items": [
    {
      "sourceSheetName": "SHEET_NAME",
      "category": "SHEET_NAME",
      "rowNumber": 1,
      "quantity": 1,
      "markId": "",
      "description": "",
      "partCode": "PART123",
      "partColor": "RO",
      "lengthRaw": "5' 6\\"",
      "weight": 10.5,
      "gauge": "",
      "angle": "",
      "type": "",
      "isFrameType": false,
      "isBuyout": false
    }
  ]
}

Rules:
- quantity must be > 0
- Normalize colors by trimming; treat M and M (with space) as equivalent in partColor field
- isFrameType true when sheet name suggests frames/columns/rafters
- isBuyout true when part is missing or BUYOUT/N/A/-
- Include every valid data row; skip totals and headers

Spreadsheet data:
${text.slice(0, 120000)}`,
    }],
  })

  const raw = response.content?.[0]?.text || ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude fallback returned no JSON')

  const parsed = JSON.parse(jsonMatch[0])
  const items = (parsed.items || []).map((item) => ({
    sourceSheetName: item.sourceSheetName || item.category || 'Unknown',
    category: item.category || item.sourceSheetName || 'Unknown',
    rowNumber: item.rowNumber ?? null,
    quantity: toNum(item.quantity),
    markId: cleanStr(item.markId) || '',
    description: cleanStr(item.description) || '',
    partCode: cleanStr(item.partCode),
    partCodeNormalized: normalizeCode(item.partCode),
    partColor: cleanStr(item.partColor),
    partColorNormalized: normalizeColor(item.partColor),
    lengthRaw: cleanStr(item.lengthRaw),
    lengthFeet: parseLengthToFeet(item.lengthRaw),
    weight: toNum(item.weight),
    gauge: cleanStr(item.gauge),
    angle: cleanStr(item.angle),
    type: cleanStr(item.type),
    isFrameType: item.isFrameType === true || /frame|column|rafter|opening framing/i.test(item.category || ''),
    isBuyout: item.isBuyout === true || !item.partCode || ['BUYOUT', '-', 'N/A'].includes(normalizeCode(item.partCode)),
    rawRow: item,
  })).filter((item) => item.quantity && item.quantity > 0)

  return items
}

const extractBOMItemsFromWorkbook = async (buffer, fileName, fileFormat) => {
  const format = inferFileFormat(fileName, fileFormat)
  const sheets = await loadSheetRows(buffer, format)
  const result = extractBOMItemsFromSheets(sheets)

  if (result.items.length === 0) {
    const claudeItems = await extractBOMItemsWithClaude(sheets)
    return {
      items: claudeItems,
      skippedRows: result.skippedRows,
      skippedSheets: result.skippedSheets,
      extractionMethod: 'claude_fallback',
    }
  }

  return { ...result, extractionMethod: 'exceljs' }
}

const resolveColor = async (color) => {
  if (!color) return null
  const normalized = normalizeColor(color)
  const alias = await SMDTColorAlias.findOne({ inputColorNormalized: normalized, isActive: true }).lean()
  return alias ? alias.smdtColorNormalized : normalized
}

const resolvePart = async (item) => {
  if (!item.partCodeNormalized) return null
  const alias = await SMDTPartAlias.findOne({
    inputPartNormalized: item.partCodeNormalized,
    isActive: true,
    $or: [{ category: item.category }, { category: null }],
  }).lean()
  return alias ? alias.smdtPartNameNormalized : item.partCodeNormalized
}

const matchSingleBOMItemToSMDT = async (item, costVersionId) => {
  if (item.isFrameType || item.isBuyout || !item.partCodeNormalized) {
    return { matchStatus: 'unmatched', matchConfidence: 'none', matchReason: 'Manual pricing required' }
  }

  const part = await resolvePart(item)
  const color = await resolveColor(item.partColorNormalized)
  const base = { costVersionId, partNameNormalized: part, isActive: true }

  let match = color ? await SMDTItem.findOne({ ...base, partColorNormalized: color }).lean() : null
  let matchConfidence = match ? (part === item.partCodeNormalized ? 'exact' : 'part_alias') : 'none'
  let matchReason = match ? 'Matched by part and color' : ''

  if (!match) {
    match = await SMDTItem.findOne({ ...base, partColorNormalized: normalizeColor('--') }).lean()
    if (match) {
      matchConfidence = 'color_fallback'
      matchReason = 'Matched by part and -- color fallback'
    }
  }

  if (!match) {
    const candidates = await SMDTItem.find(base).limit(5).lean()
    if (candidates.length === 1) {
      match = candidates[0]
      matchConfidence = 'part_only'
      matchReason = 'Matched by part only'
    } else if (candidates.length > 1) {
      return {
        matchStatus: 'ambiguous',
        matchConfidence: 'none',
        matchReason: 'Multiple SMDT candidates found',
        matchCandidates: candidates,
      }
    }
  }

  if (!match) {
    return { matchStatus: 'unmatched', matchConfidence: 'none', matchReason: 'No SMDT match found' }
  }

  const unitCost = match.currentMarketCost != null ? match.currentMarketCost : match.mbsCost
  const total = calculateTotalCost({
    costUnit: match.costUnit,
    unitCost,
    quantity: item.quantity,
    lengthFeet: item.lengthFeet,
    weight: item.weight,
  })

  return {
    matchStatus: total == null ? 'unmatched' : 'matched',
    matchConfidence,
    matchReason: total == null ? `Matched but missing value required for ${match.costUnit}` : matchReason,
    smdtItemId: match._id,
    resolvedSmdtColor: match.partColor,
    costUnit: match.costUnit,
    smdtUnitCost: unitCost,
    smdtTotalCost: total,
  }
}

const insertBomItemsBatched = async (docs) => {
  for (let i = 0; i < docs.length; i += INSERT_BATCH_SIZE) {
    await BOMItem.insertMany(docs.slice(i, i + INSERT_BATCH_SIZE), { ordered: false })
  }
}

const processBOMJob = async (jobId, fileUrl, fileName, fileFormat, leadId, buildingId, buildingNumber, uploadedBy) => {
  await BOMJob.findByIdAndUpdate(jobId, { status: 'processing', processingStartedAt: new Date() })

  try {
    const buffer = await downloadBuffer(fileUrl)
    const activeVersion = await SMDTCostVersion.findOne({ isActive: true }).sort({ createdAt: -1 }).lean()
    if (!activeVersion) throw new Error('No active SMDT cost version found')

    const {
      items: rawItems,
      skippedRows,
      skippedSheets,
      extractionMethod,
    } = await extractBOMItemsFromWorkbook(buffer, fileName, fileFormat)

    if (!rawItems.length) {
      throw new Error('No BOM line items could be extracted from file')
    }

    const docs = []
    for (const item of rawItems) {
      const match = await matchSingleBOMItemToSMDT(item, activeVersion._id)
      const isPriced = match.matchStatus === 'matched' && match.smdtTotalCost != null
      docs.push({
        leadId,
        buildingId,
        bomJobId: jobId,
        smdtCostVersionId: activeVersion._id,
        ...item,
        ...match,
        isPriced,
        finalUnitCost: isPriced ? match.smdtUnitCost : null,
        finalTotalCost: isPriced ? match.smdtTotalCost : null,
      })
    }

    await BOMItem.deleteMany({ bomJobId: jobId })
    if (docs.length) await insertBomItemsBatched(docs)

    const totalItems = docs.length
    const frameItems = docs.filter((i) => i.isFrameType).length
    const matchedItems = docs.filter((i) => i.matchStatus === 'matched').length
    const unmatchedItems = docs.filter((i) => i.matchStatus === 'unmatched').length
    const totalSheets = new Set(docs.map((i) => i.sourceSheetName)).size

    await BOMJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      extractionMethod: extractionMethod || 'exceljs',
      skippedSheets: skippedSheets || [],
      totalSheets,
      totalItems,
      matchedItems,
      unmatchedItems,
      frameItems,
      skippedRows,
      processingEndedAt: new Date(),
      errorMessage: null,
    })

    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.BOM_JOB_COMPLETED,
      leadId,
      performedBy: uploadedBy,
      metadata: { jobId, buildingId, buildingNumber, totalItems, matchedItems, unmatchedItems },
    })

    if (global.io) {
      global.io.of('/admin').to(`user:${uploadedBy}`).emit('bom_extraction_complete', {
        jobId,
        buildingNumber,
        totalItems,
        matchedItems,
        unmatchedItems,
        frameItems,
      })
    }
  } catch (err) {
    await BOMJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: err.message,
      processingEndedAt: new Date(),
    })

    await auditService.log({
      type: 'plant',
      action: AUDIT_ACTIONS.BOM_JOB_FAILED,
      leadId,
      performedBy: uploadedBy,
      metadata: { jobId, buildingId, buildingNumber, error: err.message },
    })

    if (global.io) {
      global.io.of('/admin').to(`user:${uploadedBy}`).emit('bom_extraction_failed', {
        jobId,
        buildingNumber,
        error: err.message,
      })
    }
  }
}

module.exports = {
  processBOMJob,
  extractBOMItemsFromWorkbook,
  matchSingleBOMItemToSMDT,
  parseLengthToFeet,
  calculateTotalCost,
  inferFileFormat,
}
