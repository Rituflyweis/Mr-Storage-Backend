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
const {
  parseOutFile,
  verifyAgainstReportTotals, // FIX #6: was imported but not used — wired in below
  parseOutLengthToFeet,      // FIX #7: needed for MBS sixteenths fix in parseLengthToFeet
} = require('./outparser.service')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const INSERT_BATCH_SIZE = 500

const SKIP_SHEET_NAMES = new Set([
  'COVER_SHEET',
  'Sheet1',
  'Sheet2',
  'Sheet3',
])

const cleanStr = (val) => {
  if (val == null) return null

  const s = String(val)
    .replace(/^'+/, '')
    .replace(/'+$/, '')
    .trim()

  return s || null
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

const normalizeColor = (val) => normalizeCode(val)

const cleanPartCode = (val) => {
  const cleaned = cleanStr(val)
  if (!cleaned) return null

  const normalized = normalizeCode(cleaned)

  if (
    [
      '<BLANK>',
      'BLANK',
      '-',
      'N/A',
      'NA',
      'NONE',
      'NULL',
    ].includes(normalized)
  ) {
    return null
  }

  return cleaned
}

const isExampleOrInstructionRow = (joinedText) => {
  const text = String(joinedText || '').toLowerCase()

  return (
    text.includes('<-example data') ||
    text.includes('example data') ||
    text.includes('sample data') ||
    text.includes('do not use') ||
    text.includes('for example')
  )
}

// ---------------------------------------------------------------------------
// FIX #4: Single source of truth for frame/buyout flags.
//
// Previously isFrameType had three different definitions depending on
// ingestion path:
//   - xlsx path: regex on sheet name -> flags all 29 frame items
//   - claude path: same regex on category -> same over-count
//   - out parser: "frames section AND no part code" -> correct 4 custom members
//
// Unified semantic: isFrameType = frame-category section AND no real part code
//   = custom-fabbed member that will never match SMDT.
// Applied centrally after all extraction paths so the count is consistent
// regardless of file format.
// ---------------------------------------------------------------------------
const FRAME_CATEGORY_RE = /frame|column|rafter|opening framing/i
const BUYOUT_PART_CODES = new Set(['BUYOUT', '-', 'N/A', 'NA', '<BLANK>', 'BLANK'])

const applyFrameFlags = (item) => {
  const category = item.category || item.sourceSheetName || ''
  const normalized = item.partCodeNormalized || normalizeCode(item.partCode)
  const hasRealPart = !!item.partCode && !BUYOUT_PART_CODES.has(normalized)

  item.isFrameType = FRAME_CATEGORY_RE.test(category) && !hasRealPart
  item.isBuyout = !hasRealPart && !item.isFrameType
  return item
}

/**
 * FIX #7: parseLengthToFeet — handle MBS sixteenths notation before generic parsing.
 *
 * MBS format: FF'II-SS" where SS is SIXTEENTHS of an inch (not hundredths).
 * Example: 40'02-12" = 40ft 2 and 12/16 inches = 40.2292ft.
 *
 * Without the MBS check, the generic parser strips the "-12" part
 * and silently returns 40.1667, corrupting FT-based SMDT pricing and
 * consolidation length keys for any MBS-style file reaching this parser
 * (e.g. via the Claude fallback path or Excel uploads that carry MBS strings).
 *
 * parseOutLengthToFeet handles MBS; we delegate to it first.
 * All legacy fraction/inch formats (22'-1 1/2", 3'-0", 11 1/2", 3") fall
 * through to the original logic unchanged.
 */
const parseLengthToFeet = (value) => {
  if (!value) return null

  const str = String(value)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .trim()

  if (!str) return null

  // FIX #7: delegate MBS sixteenths notation to the dedicated parser first.
  const mbsResult = parseOutLengthToFeet(str)
  if (mbsResult != null) return mbsResult

  let feet = 0
  let inches = 0

  const feetMatch = str.match(/(\d+(?:\.\d+)?)\s*'/)

  if (feetMatch) {
    feet = Number(feetMatch[1])
  }

  let afterFeet = feetMatch
    ? str.slice(feetMatch.index + feetMatch[0].length)
    : str

  afterFeet = afterFeet
    .replace(/^-/, '')
    .replace(/"/g, '')
    .trim()

  if (!afterFeet) return feet

  const mixed = afterFeet.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)/)

  if (mixed) {
    inches += Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  } else {
    const frac = afterFeet.match(/(\d+)\s*\/\s*(\d+)/)
    const whole = afterFeet.match(/(\d+(?:\.\d+)?)/)

    if (whole && !frac) {
      inches += Number(whole[1])
    }

    if (frac) {
      if (whole && whole.index < frac.index) {
        inches += Number(whole[1])
      }

      inches += Number(frac[1]) / Number(frac[2])
    }
  }

  return feet + inches / 12
}

const calculateTotalCost = ({ costUnit, unitCost, quantity, lengthFeet, weight }) => {
  if (unitCost == null) return null

  if (costUnit === 'EA') {
    return Number(quantity || 0) * unitCost
  }

  if (costUnit === 'FT') {
    if (lengthFeet == null) return null
    return Number(quantity || 0) * Number(lengthFeet) * unitCost
  }

  if (costUnit === 'LB') {
    if (weight == null) return null
    return Number(weight || 0) * unitCost
  }

  return null
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

const inferFileFormat = (fileName, fileFormat) => {
  if (fileFormat) return String(fileFormat).toLowerCase()

  const ext = String(fileName || '')
    .split('.')
    .pop()
    ?.toLowerCase()

  if (['ods', 'xlsx', 'xls', 'out', 'txt'].includes(ext)) return ext

  return 'xlsx'
}

const sheetRowsFromSheetJsBuffer = (buffer) => {
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]

    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false,
    })

    return { name, rows }
  })
}

const sheetRowsFromExcelJs = async (buffer, fileFormat) => {
  const workbook = new ExcelJS.Workbook()

  if (fileFormat === 'ods') {
    await workbook.ods.load(buffer)
  } else {
    await workbook.xlsx.load(buffer)
  }

  const sheets = []

  workbook.eachSheet((worksheet) => {
    const rows = []

    worksheet.eachRow((row) => {
      const vals = []

      row.eachCell({ includeEmpty: true }, (cell) => {
        vals.push(cell.text || cell.value || null)
      })

      rows.push(vals)
    })

    sheets.push({
      name: worksheet.name,
      rows,
    })
  })

  return sheets
}

const loadSheetRows = async (buffer) => {
  return sheetRowsFromSheetJsBuffer(buffer)
}

const findHeaderRow = (rows) => {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const normalizedRow = (rows[i] || []).map((v) => normalizeCode(v))

    const hasQty = normalizedRow.includes('QTY') || normalizedRow.includes('QUANTITY')
    const hasPart =
      normalizedRow.includes('PART') ||
      normalizedRow.includes('PARTCODE') ||
      normalizedRow.includes('MBIP/N') ||
      normalizedRow.includes('ITEM')
    const hasDescription =
      normalizedRow.includes('DESCRIPTION') ||
      normalizedRow.includes('DESC')

    if (hasQty && (hasPart || hasDescription)) {
      return i
    }
  }

  return -1
}

const col = (headers, aliases) => {
  return headers.findIndex((header) => aliases.includes(header))
}

const isTotalRow = (joined) => {
  const text = String(joined || '').toLowerCase().trim()

  return (
    text.startsWith('total') ||
    text.includes('total weight') ||
    text.includes('grand total') ||
    text.includes('subtotal')
  )
}

const parseRowsToItems = (sheetName, rows, headerIdx) => {
  const items = []
  let skippedRows = 0

  const headers = rows[headerIdx].map(normalizeCode)

  const iQty = col(headers, ['QTY', 'QUANTITY'])
  const iMark = col(headers, ['MARK', 'MARKID', 'PIECEMARK', 'PIECE'])
  const iDesc = col(headers, ['DESCRIPTION', 'DESC'])
  const iPart = col(headers, ['PART', 'PARTCODE', 'MBIP/N', 'ITEM'])
  const iColor = col(headers, ['COLOR', 'COLOUR', 'FINISH'])
  const iLength = col(headers, ['LENGTH', 'LEN'])
  const iWeight = col(headers, ['WEIGHT', 'WT'])
  const iGauge = col(headers, ['THICK', 'GAUGE'])
  const iAngle = col(headers, ['ANGLE'])
  const iType = col(headers, ['TYPE'])
  const iUnitCost = col(headers, ['UNITCOST', 'UNITPRICE', 'PRICE/EA', 'COST/EA'])
  const iTotalCost = col(headers, ['TOTALCOST', 'TOTALPRICE', 'COST', 'TOTAL$'])

  if (iQty < 0) {
    return {
      items,
      skippedRows,
      error: 'Missing QTY column',
    }
  }

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []

    const joined = row
      .map((v) => cleanStr(v) || '')
      .join(' ')
      .toLowerCase()

    if (!joined.trim() || isTotalRow(joined) || isExampleOrInstructionRow(joined)) {
      skippedRows++
      continue
    }

    const quantity = toNum(row[iQty])

    if (!quantity || quantity <= 0) {
      skippedRows++
      continue
    }

    const partCode = iPart >= 0 ? cleanPartCode(row[iPart]) : null
    const partColor = iColor >= 0 ? cleanStr(row[iColor]) : null
    const lengthRaw = iLength >= 0 ? cleanStr(row[iLength]) : null
    const lengthFeet = parseLengthToFeet(lengthRaw)

    const partCodeNormalized = normalizeCode(partCode)
    const partColorNormalized = normalizeColor(partColor)

    const bomSourceUnitCost = iUnitCost >= 0 ? toNum(row[iUnitCost]) : null
    const bomSourceTotalCost = iTotalCost >= 0 ? toNum(row[iTotalCost]) : null

    items.push({
      sourceSheetName: sheetName,
      category: sheetName,
      rowNumber: r + 1,

      quantity,

      markId: iMark >= 0 ? cleanStr(row[iMark]) || '' : '',
      description: iDesc >= 0 ? cleanStr(row[iDesc]) || '' : '',

      partCode,
      partCodeNormalized,

      partColor,
      partColorNormalized,

      lengthRaw,
      lengthFeet,

      weight: iWeight >= 0 ? toNum(row[iWeight]) : null,
      gauge: iGauge >= 0 ? cleanStr(row[iGauge]) : null,
      angle: iAngle >= 0 ? cleanStr(row[iAngle]) : null,
      type: iType >= 0 ? cleanStr(row[iType]) : null,

      bomSourceUnitCost:
        bomSourceUnitCost != null
          ? bomSourceUnitCost
          : bomSourceTotalCost != null && quantity > 0
            ? bomSourceTotalCost / quantity
            : null,
      bomSourceTotalCost,

      // NOTE: isFrameType and isBuyout are intentionally NOT set here.
      // applyFrameFlags() is called centrally in processBOMJob after all
      // extraction paths, so the definition is consistent regardless of format.
      isFrameType: false,
      isBuyout: false,

      rawRow: row,
    })
  }

  return {
    items,
    skippedRows,
  }
}

const extractBOMItemsFromSheets = (sheets) => {
  const items = []
  let skippedRows = 0
  const skippedSheets = []

  for (const { name, rows } of sheets) {
    if (SKIP_SHEET_NAMES.has(name)) continue

    if (!rows || rows.length < 2) {
      skippedSheets.push({
        name,
        reason: 'Sheet empty or too few rows',
      })
      continue
    }

    const headerIdx = findHeaderRow(rows)

    if (headerIdx < 0) {
      skippedSheets.push({
        name,
        reason: 'Header row not found. Expected QTY + PART/DESCRIPTION.',
      })
      continue
    }

    const parsed = parseRowsToItems(name, rows, headerIdx)

    if (parsed.error) {
      skippedSheets.push({
        name,
        reason: parsed.error,
      })
      continue
    }

    items.push(...parsed.items)
    skippedRows += parsed.skippedRows
  }

  return {
    items,
    skippedRows,
    skippedSheets,
  }
}

const sheetsToText = (sheets, maxRowsPerSheet = 120) => {
  return sheets
    .filter((sheet) => !SKIP_SHEET_NAMES.has(sheet.name))
    .map(({ name, rows }) => {
      const slice = (rows || []).slice(0, maxRowsPerSheet)

      const lines = slice.map((row) =>
        (row || [])
          .map((cell) => cleanStr(cell) ?? '')
          .join('\t')
      )

      return `=== Sheet: ${name} ===\n${lines.join('\n')}`
    })
    .join('\n\n')
}

const extractBOMItemsWithClaude = async (sheets) => {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      'No BOM rows extracted and ANTHROPIC_API_KEY is not configured for fallback parsing'
    )
  }

  const text = sheetsToText(sheets)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system:
      'You extract BOM line items from spreadsheet text. Return ONLY valid JSON. No markdown.',
    messages: [
      {
        role: 'user',
        content: `Extract BOM line items from these spreadsheet sheets.

Return JSON in this exact shape:
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
      "unitCost": null,
      "totalCost": null
    }
  ]
}

Rules:
- quantity must be > 0
- skip totals, headers, blank rows, and example rows
- skip rows containing "<-Example Data"
- treat <BLANK>, BLANK, N/A, NA, and "-" as missing partCode
- unitCost / totalCost only when the sheet has explicit price columns; otherwise null
- Include every valid data row.

Spreadsheet data:
${text.slice(0, 120000)}`,
      },
    ],
  })

  const raw = response.content?.[0]?.text || ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)

  if (!jsonMatch) {
    throw new Error('Claude fallback returned no JSON')
  }

  const parsed = JSON.parse(jsonMatch[0])

  return (parsed.items || [])
    .map((item) => {
      const partCode = cleanPartCode(item.partCode)
      const quantity = toNum(item.quantity)
      const bomSourceUnitCost = toNum(item.unitCost)
      const bomSourceTotalCost = toNum(item.totalCost)

      return {
        sourceSheetName: item.sourceSheetName || item.category || 'Unknown',
        category: item.category || item.sourceSheetName || 'Unknown',
        rowNumber: item.rowNumber ?? null,

        quantity,

        markId: cleanStr(item.markId) || '',
        description: cleanStr(item.description) || '',

        partCode,
        partCodeNormalized: normalizeCode(partCode),

        partColor: cleanStr(item.partColor),
        partColorNormalized: normalizeColor(item.partColor),

        lengthRaw: cleanStr(item.lengthRaw),
        lengthFeet: parseLengthToFeet(item.lengthRaw), // FIX #7 benefits here too

        weight: toNum(item.weight),
        gauge: cleanStr(item.gauge),
        angle: cleanStr(item.angle),
        type: cleanStr(item.type),

        bomSourceUnitCost:
          bomSourceUnitCost != null
            ? bomSourceUnitCost
            : bomSourceTotalCost != null && quantity > 0
              ? bomSourceTotalCost / quantity
              : null,
        bomSourceTotalCost,

        // NOTE: isFrameType and isBuyout NOT set here — applyFrameFlags() handles it.
        isFrameType: false,
        isBuyout: false,

        rawRow: item,
      }
    })
    .filter((item) => item.quantity && item.quantity > 0)
}

const looksLikeOutReport = (buffer) => {
  const head = buffer.slice(0, 4000).toString('utf8')
  return /={20,}/.test(head) && /\bQuan\b/.test(head) && /\bCost\b/.test(head)
}

const extractBOMItemsFromWorkbook = async (buffer, fileName, fileFormat) => {
  const format = inferFileFormat(fileName, fileFormat)

  // Fixed-width MBS-style .out cost reports
  if (format === 'out' || (format === 'txt' && looksLikeOutReport(buffer))) {
    const { items, sections, skippedRows } = parseOutFile(buffer)

    // FIX #6: cross-check parsed totals against the report's own section totals.
    // verifyAgainstReportTotals existed but was never called. Now it is.
    const parseAudit = verifyAgainstReportTotals(buffer, items)

    // costDelta threshold: per-section Total rows are rounded to cents, so a
    // few cents of drift is normal rounding noise (observed 0.09 on a clean
    // 428-line file). 0.50 catches a genuinely missed line (cheapest items
    // are anchor bolts at ~$2) without false alarms.
    const parseSuspect =
      parseAudit.costDelta > 0.5 || parseAudit.weightDelta > 2

    const normalized = items.map((item) => ({
      ...item,
      partCodeNormalized: normalizeCode(item.partCode),
      partColorNormalized: normalizeColor(item.partColor),
      gauge: null,
      angle: null,
      type: null,
      // isFrameType and isBuyout already set by outparser; applyFrameFlags()
      // in processBOMJob will re-apply unified logic over the top.
    }))

    return {
      items: normalized,
      skippedRows,
      skippedSheets: sections
        .filter((s) => s.items === 0)
        .map((s) => ({ name: s.name, reason: 'No line items in section' })),
      extractionMethod: 'out_parser',
      parseAudit,
      parseSuspect,
    }
  }

  const sheets = await loadSheetRows(buffer)

  const result = extractBOMItemsFromSheets(sheets)

  if (result.items.length === 0) {
    const claudeItems = await extractBOMItemsWithClaude(sheets)

    return {
      items: claudeItems,
      skippedRows: result.skippedRows,
      skippedSheets: result.skippedSheets,
      extractionMethod: 'claude_fallback',
      parseAudit: null,
      parseSuspect: false,
    }
  }

  return {
    ...result,
    extractionMethod: 'xlsx',
    parseAudit: null,
    parseSuspect: false,
  }
}

/**
 * Loads all SMDT items and aliases for the active cost version into memory
 * once per job, so matching is pure in-memory work instead of 3+ DB queries
 * per BOM line.
 */
const buildMatchContext = async (costVersionId) => {
  const [smdtItems, colorAliases, partAliases] = await Promise.all([
    SMDTItem.find({ costVersionId, isActive: true }).lean(),
    SMDTColorAlias.find({ isActive: true }).lean(),
    SMDTPartAlias.find({ isActive: true }).lean(),
  ])

  const byPartAndColor = new Map()
  const byPart = new Map()

  for (const item of smdtItems) {
    const colorKey = item.partColorNormalized || ''
    byPartAndColor.set(`${item.partNameNormalized}|${colorKey}`, item)

    if (!byPart.has(item.partNameNormalized)) {
      byPart.set(item.partNameNormalized, [])
    }
    byPart.get(item.partNameNormalized).push(item)
  }

  const colorAliasMap = new Map()
  for (const alias of colorAliases) {
    colorAliasMap.set(alias.inputColorNormalized, alias.smdtColorNormalized)
  }

  const partAliasMap = new Map()
  for (const alias of partAliases) {
    if (!partAliasMap.has(alias.inputPartNormalized)) {
      partAliasMap.set(alias.inputPartNormalized, [])
    }
    partAliasMap.get(alias.inputPartNormalized).push(alias)
  }

  return { byPartAndColor, byPart, colorAliasMap, partAliasMap, costVersionId }
}

const resolveColorInMemory = (ctx, colorNormalized) => {
  if (!colorNormalized) return null
  return ctx.colorAliasMap.get(colorNormalized) || colorNormalized
}

const resolvePartInMemory = (ctx, item) => {
  if (!item.partCodeNormalized) return null

  const aliases = ctx.partAliasMap.get(item.partCodeNormalized)
  if (!aliases || !aliases.length) return item.partCodeNormalized

  const categoryMatch = aliases.find((a) => a.category === item.category)
  if (categoryMatch) return categoryMatch.smdtPartNameNormalized

  const generic = aliases.find((a) => a.category == null)
  if (generic) return generic.smdtPartNameNormalized

  return item.partCodeNormalized
}

const matchBOMItemWithContext = (ctx, item) => {
  if (!item.partCodeNormalized) {
    return {
      matchStatus: 'unmatched',
      matchConfidence: 'none',
      matchReason: item.isFrameType
        ? 'Frame member without part code'
        : 'No part code on BOM line',
    }
  }

  const part = resolvePartInMemory(ctx, item)
  const color = resolveColorInMemory(ctx, item.partColorNormalized)
  const usedAlias = part !== item.partCodeNormalized

  let match = ctx.byPartAndColor.get(`${part}|${color || ''}`)
  let matchConfidence = match ? (usedAlias ? 'part_alias' : 'exact') : 'none'
  let matchReason = match ? 'Matched by part and color' : ''

  if (!match) {
    match = ctx.byPartAndColor.get(`${part}|${normalizeColor('--')}`)
    if (match) {
      matchConfidence = 'color_fallback'
      matchReason = 'Matched by part and -- color fallback'
    }
  }

  if (!match) {
    const candidates = ctx.byPart.get(part) || []

    if (candidates.length === 1) {
      match = candidates[0]
      matchConfidence = 'part_only'
      matchReason = 'Matched by part only'
    } else if (candidates.length > 1) {
      return {
        matchStatus: 'ambiguous',
        matchConfidence: 'none',
        matchReason: 'Multiple SMDT candidates found',
        matchCandidates: candidates.slice(0, 5),
      }
    }
  }

  if (!match) {
    return {
      matchStatus: 'unmatched',
      matchConfidence: 'none',
      matchReason: 'No SMDT match found',
    }
  }

  const unitCost =
    match.currentMarketCost != null ? match.currentMarketCost : match.mbsCost

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
    matchReason:
      total == null
        ? `Matched but missing value required for ${match.costUnit}`
        : matchReason,

    smdtItemId: match._id,
    resolvedSmdtColor: match.partColor,

    costUnit: match.costUnit,
    smdtUnitCost: unitCost,
    smdtTotalCost: total,
  }
}

/**
 * Pricing precedence:
 * 1. SMDT match           -> priceSource 'smdt'
 * 2. BOM file's own price -> priceSource 'bom' (fallback when SMDT has no usable match)
 * 3. Neither              -> unpriced, manual pricing required
 *
 * FIX #1: hasBomPrice previously used > 0, which treated legitimate $0.00 items
 * (e.g. anchor bolts included at no charge) as unpriced, blocking confirmation
 * and consolidation. Changed to != null — zero is a valid price.
 */
const resolveFinalPricing = (item, match) => {
  const smdtPriced = match.matchStatus === 'matched' && match.smdtTotalCost != null

  if (smdtPriced) {
    return {
      isPriced: true,
      priceSource: 'smdt',
      finalUnitCost: match.smdtUnitCost,
      finalTotalCost: match.smdtTotalCost,
    }
  }

  // FIX #1: was `item.bomSourceTotalCost > 0` — excluded valid $0.00 lines.
  const hasBomPrice = item.bomSourceTotalCost != null

  if (hasBomPrice) {
    return {
      isPriced: true,
      priceSource: 'bom',
      finalUnitCost: item.bomSourceUnitCost,
      finalTotalCost: item.bomSourceTotalCost,
    }
  }

  return {
    isPriced: false,
    priceSource: null,
    finalUnitCost: null,
    finalTotalCost: null,
  }
}

const insertBomItemsBatched = async (docs) => {
  for (let i = 0; i < docs.length; i += INSERT_BATCH_SIZE) {
    await BOMItem.insertMany(docs.slice(i, i + INSERT_BATCH_SIZE), {
      ordered: false,
    })
  }
}

const processBOMJob = async (
  jobId,
  fileUrl,
  fileName,
  fileFormat,
  leadId,
  buildingId,
  buildingNumber,
  uploadedBy
) => {
  await BOMJob.findByIdAndUpdate(jobId, {
    status: 'processing',
    processingStartedAt: new Date(),
  })

  try {
    const buffer = await downloadBuffer(fileUrl)

    const activeVersion = await SMDTCostVersion.findOne({ isActive: true })
      .sort({ createdAt: -1 })
      .lean()

    if (!activeVersion) {
      throw new Error('No active SMDT cost version found')
    }

    const {
      items: rawItems,
      skippedRows,
      skippedSheets,
      extractionMethod,
      parseAudit,   // FIX #6
      parseSuspect, // FIX #6
    } = await extractBOMItemsFromWorkbook(buffer, fileName, fileFormat)

    if (!rawItems.length) {
      throw new Error('No BOM line items could be extracted from file')
    }

    const ctx = await buildMatchContext(activeVersion._id)

    const docs = rawItems.map((item) => {
      // FIX #4: apply unified frame/buyout flags after extraction,
      // regardless of which parser produced the item.
      applyFrameFlags(item)

      const match = matchBOMItemWithContext(ctx, item)
      const pricing = resolveFinalPricing(item, match)

      return {
        leadId,
        buildingId,
        bomJobId: jobId,
        smdtCostVersionId: activeVersion._id,

        ...item,
        ...match,
        ...pricing,
      }
    })

    await BOMItem.deleteMany({ bomJobId: jobId })

    if (docs.length) {
      await insertBomItemsBatched(docs)
    }

    const totalItems = docs.length
    const frameItems = docs.filter((item) => item.isFrameType).length
    const matchedItems = docs.filter((item) => item.matchStatus === 'matched').length
    const unmatchedItems = docs.filter((item) => item.matchStatus === 'unmatched').length
    const ambiguousItems = docs.filter((item) => item.matchStatus === 'ambiguous').length
    const bomPricedItems = docs.filter((item) => item.priceSource === 'bom').length
    const unpricedItems = docs.filter((item) => !item.isPriced).length
    const totalSheets = new Set(docs.map((item) => item.sourceSheetName)).size

    await BOMJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      extractionMethod: extractionMethod || 'xlsx',
      skippedSheets: skippedSheets || [],

      totalSheets,
      totalItems,
      matchedItems,
      unmatchedItems,
      ambiguousItems,
      bomPricedItems,
      unpricedItems,
      frameItems,
      skippedRows,

      // FIX #6: persist parse audit so suspicious parses surface in the UI.
      // Requires parseAudit: Mixed and parseSuspect: Boolean on BOMJob schema.
      parseAudit: parseAudit || null,
      parseSuspect: parseSuspect || false,

      processingEndedAt: new Date(),
      errorMessage: null,
    })

    if (auditService?.log && AUDIT_ACTIONS?.BOM_JOB_COMPLETED) {
      await auditService.log({
        type: 'plant',
        action: AUDIT_ACTIONS.BOM_JOB_COMPLETED,
        leadId,
        performedBy: uploadedBy,
        metadata: {
          jobId,
          buildingId,
          buildingNumber,
          totalItems,
          matchedItems,
          unmatchedItems,
          ambiguousItems,
          bomPricedItems,
          unpricedItems,
          parseSuspect: parseSuspect || false,
        },
      })
    }

    if (global.io) {
      global.io.of('/admin').to(`user:${uploadedBy}`).emit('bom_extraction_complete', {
        jobId,
        buildingNumber,
        totalItems,
        matchedItems,
        unmatchedItems,
        ambiguousItems,
        bomPricedItems,
        unpricedItems,
        frameItems,
        // FIX #6: surface parse suspect flag in real-time so UI can warn.
        parseSuspect: parseSuspect || false,
        parseAudit: parseAudit || null,
      })
    }
  } catch (err) {
    await BOMJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: err.message,
      processingEndedAt: new Date(),
    })

    if (auditService?.log && AUDIT_ACTIONS?.BOM_JOB_FAILED) {
      await auditService.log({
        type: 'plant',
        action: AUDIT_ACTIONS.BOM_JOB_FAILED,
        leadId,
        performedBy: uploadedBy,
        metadata: {
          jobId,
          buildingId,
          buildingNumber,
          error: err.message,
        },
      })
    }

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
  extractBOMItemsFromSheets,
  buildMatchContext,
  matchBOMItemWithContext,
  resolveFinalPricing,
  parseLengthToFeet,
  calculateTotalCost,
  inferFileFormat,
  applyFrameFlags,
}