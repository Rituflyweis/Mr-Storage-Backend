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

/* ------------------------------------------------------------------
 * SHIPPER-FORMAT CONSOLIDATED BOM (the deliverable file)
 *
 * The consolidated BOM file IS the shipper workbook: no prices.
 * Fine-split sheets matching the shipper's expected layout, with
 * same part+color+length merged across buildings (summed QTY/weight)
 * and a BLDG(S) column for traceability.
 *
 * Pricing is NOT in this file. Priced data is persisted separately
 * to the DB via groupItemsForConsolidation (kept below).
 * ------------------------------------------------------------------ */

const SHIPPER_SHEETS = [
  { id: 'FRAMES', title: 'FRAMES' },
  { id: 'STUDS', title: "STUD'S" },
  { id: 'TOP_CHANNEL', title: 'TOP CHANNEL' },
  { id: 'DOOR_JAMBS_AND_HEADERS', title: 'DOOR JAMBS & HEADERS' },
  { id: 'PURLINS_AND_GIRTS', title: "PURLIN'S & GIRTS" },
  { id: 'ROOF_AND_WALL_SHEETING', title: 'ROOF & WALL SHEETING' },
  { id: 'CONNECTION_PLATES', title: 'CONNECTION PLATES' },
  { id: 'ANGLES', title: 'ANGLES' },
  { id: 'TRIM', title: 'TRIM' },
  { id: 'CABLE_BRACING', title: 'CABLE BRACING' },
  { id: 'FASTENERS', title: 'FASTENERS' },
  { id: 'ACCESSORIES_AND_SEALANT', title: 'ACCESSORIES & SEALANT' },
  { id: 'MISC', title: 'MISC' },
]

/**
 * First matching rule wins. Description match is primary (most reliable
 * across formats), part-code pattern second, source category last.
 */
const SHIPPER_CLASSIFY_RULES = [
  { sheet: 'FRAMES', desc: /\b(rf|ew)\s+(column|rafter|int col)\b|wind column|ext beam|rigid frame/i },
  { sheet: 'FRAMES', part: /^(W\d+X\d+|P\d+X\d+|SP\d+)$/i, category: /frame/i },

  { sheet: 'STUDS', desc: /\bstud\b/i },
  { sheet: 'TOP_CHANNEL', desc: /top channel/i },

  { sheet: 'DOOR_JAMBS_AND_HEADERS', desc: /door (jamb|header|sill)|\bjamb\b|\bheader\b/i },

  { sheet: 'PURLINS_AND_GIRTS', desc: /purlin|girt|eave strut|\bstrut\b/i },
  { sheet: 'PURLINS_AND_GIRTS', part: /^Z\d/i },

  { sheet: 'ROOF_AND_WALL_SHEETING', desc: /sheet|liner|soffit|panel/i },
  { sheet: 'ROOF_AND_WALL_SHEETING', part: /^(RLOC|PLOC|CD\d|CL244)/i },

  { sheet: 'CONNECTION_PLATES', desc: /\bplt\b|plate/i },

  { sheet: 'ANGLES', desc: /flg brc|flange brace|angle|strapping|back up|rake suppor|float eave|sliding cli|gable channel/i },

  { sheet: 'TRIM', desc: /trim|gutter|downspout|rake|peak box|ridge|drip cap|corner|eave t|panel cap/i },
  { sheet: 'TRIM', category: /^trim$/i },

  { sheet: 'CABLE_BRACING', desc: /cable|cbl|\brod\b|rod@/i },
  { sheet: 'CABLE_BRACING', part: /^(CB\d|RD\d|CHW|RHW)/i },

  { sheet: 'FASTENERS', desc: /bolt|screw|driller|tek|rivet|washer|\blap\b|fastener/i },
  { sheet: 'FASTENERS', category: /fastener/i },

  { sheet: 'ACCESSORIES_AND_SEALANT', desc: /sealant|butyl|closure|\bclos\b|grayflex|\bjoi\b|roll-up|\bdoor\b|mastic|tape|metal roof s|tri bea/i },
  { sheet: 'ACCESSORIES_AND_SEALANT', category: /accessor|sealant/i },

  { sheet: 'FRAMES', category: /frame/i },
  { sheet: 'DOOR_JAMBS_AND_HEADERS', category: /jamb|header/i },
  { sheet: 'PURLINS_AND_GIRTS', category: /purlin|girt|strut/i },
  { sheet: 'ROOF_AND_WALL_SHEETING', category: /sheet/i },
  { sheet: 'CONNECTION_PLATES', category: /plate/i },
  { sheet: 'ANGLES', category: /angle|flange/i },
  { sheet: 'CABLE_BRACING', category: /bracing|cable/i },
]

const classifyShipperSheet = (item) => {
  const desc = item.description || ''
  const part = item.partCode || ''
  const category = item.category || ''

  for (const rule of SHIPPER_CLASSIFY_RULES) {
    if (rule.desc && rule.desc.test(desc)) {
      if (rule.category && !rule.category.test(category)) continue
      return rule.sheet
    }
    if (rule.part && rule.part.test(part)) {
      if (rule.category && !rule.category.test(category)) continue
      return rule.sheet
    }
    if (!rule.desc && !rule.part && rule.category && rule.category.test(category)) {
      return rule.sheet
    }
  }

  return 'MISC'
}

const splitMarkIds = (value) => {
  if (value == null) return []

  const str = String(value).trim()
  if (!str) return []

  return str
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => !/^\+?\d+\s+more$/i.test(v))
}

const sortMarkIds = (marks) => {
  return [...marks].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  )
}

/**
 * Merge identical items across buildings: same part code, color, and length
 * become one row with summed QTY and weight. Items with no part code key on
 * description, so distinct custom members never wrongly merge.
 * buildingMap maps buildingId -> buildingNumber.
 */
const groupItemsForShipper = (items, buildingMap) => {
  const bySheet = new Map()

  items.forEach((item) => {
    const sheetId = classifyShipperSheet(item)

    if (!bySheet.has(sheetId)) bySheet.set(sheetId, new Map())
    const sheetMap = bySheet.get(sheetId)

    const lengthKey =
      item.lengthFeet != null ? Number(item.lengthFeet).toFixed(4) : item.lengthRaw || '_'

    const identity =
      item.partCodeNormalized ||
      item.partCode ||
      `DESC:${(item.description || '').toUpperCase()}`

    const colorKey = item.partColorNormalized || item.partColor || '_'

    const key = [identity, colorKey, lengthKey].join('|')

    if (!sheetMap.has(key)) {
      sheetMap.set(key, {
        quantity: 0,
        marks: new Set(),
        description: item.description || '',
        partCode: item.partCode || '',
        partColor: item.partColor || '',
        type: item.type || '',
        angle: item.angle || '',
        gauge: item.gauge || '',
        lengthRaw: item.lengthRaw || '',
        lengthFeet: item.lengthFeet,
        weight: 0,
        buildings: new Set(),
        sourceLineCount: 0,
      })
    }

    const group = sheetMap.get(key)

    group.quantity += safeNumber(item.quantity)
    group.weight += safeNumber(item.weight)
    group.sourceLineCount += 1

    for (const mark of splitMarkIds(item.markId)) {
      group.marks.add(mark)
    }

    // FIX #3: don't add a fallback 0 — if the buildingId isn't in the map,
    // skip rather than polluting buildings with a phantom building 0.
    const bNum = buildingMap[String(item.buildingId)]
    if (bNum != null) group.buildings.add(bNum)

    if (!group.description && item.description) group.description = item.description
    if (!group.gauge && item.gauge) group.gauge = item.gauge
    if (!group.type && item.type) group.type = item.type
    if (!group.angle && item.angle) group.angle = item.angle
  })

  const result = new Map()
  for (const [sheetId, sheetMap] of bySheet) {
    const rows = [...sheetMap.values()].sort((a, b) => {
      const p = (a.partCode || a.description).localeCompare(b.partCode || b.description)
      if (p !== 0) return p
      return (b.lengthFeet || 0) - (a.lengthFeet || 0)
    })
    result.set(sheetId, rows)
  }

  return result
}

const formatShipperMarks = (marks) => sortMarkIds(marks).join(', ')

const SHIPPER_HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9D9D9' },
}

const SHIPPER_COLUMNS = [
  'QTY', 'MARK', 'DESCRIPTION', 'PART', 'COLOR', 'BLDG(S)',
  'TYPE', 'ANGLE', 'THICK', 'LENGTH', 'WEIGHT',
]

const addShipperHeaderBlock = (sheet, title, lead, generatedDate) => {
  sheet.getCell('C1').value = title
  sheet.getCell('C1').font = { name: 'Arial', bold: true, size: 14 }

  sheet.getCell('E1').value = 'Date:'
  sheet.getCell('F1').value = generatedDate
  sheet.getCell('E2').value = 'Job Id:'
  sheet.getCell('F2').value = lead.jobId || ''
  sheet.getCell('C3').value = 'Customer:'
  sheet.getCell('E3').value = lead.customerName || lead.projectName || ''
  sheet.getCell('C5').value = 'Project Name:'
  sheet.getCell('E5').value = lead.projectName || ''

  for (const addr of ['E1', 'E2', 'C3', 'C5']) {
    sheet.getCell(addr).font = { name: 'Arial', bold: true }
  }
}

/**
 * Generates the consolidated BOM = the shipper-format workbook (no prices).
 * Same signature/return shape callers already expect.
 */
const generateConsolidatedExcel = async (lead, buildingsWithJobs, allItems) => {
  const buildingMap = {}
  buildingsWithJobs.forEach((b) => {
    buildingMap[String(b._id)] = b.buildingNumber
  })

  const grouped = groupItemsForShipper(allItems, buildingMap)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StoragePro'

  const generatedDate = new Date().toLocaleDateString('en-US')

  /** COVER_SHEET: project info only */
  const cover = workbook.addWorksheet('COVER_SHEET')
  cover.getColumn(2).width = 28
  cover.getColumn(3).width = 45

  const coverLines = [
    ['', ''],
    ['', (lead.projectName || '').toUpperCase()],
    ['', lead.location || ''],
    ['', ''],
    ['', 'SHIPPING LIST'],
    ['', 'FOR'],
    ['', (lead.customerName || lead.projectName || '').toUpperCase()],
    ['', ''],
    ['', 'Job Id:', lead.jobId || ''],
    ['', 'Date:', generatedDate],
    ['', 'Buildings:', buildingsWithJobs.map((b) => `#${b.buildingNumber}`).join(', ')],
    ['', 'Total BOM Lines:', allItems.length],
  ]
  coverLines.forEach((row) => cover.addRow(row))
  cover.getCell('B2').font = { name: 'Arial', bold: true, size: 16 }
  cover.getCell('B5').font = { name: 'Arial', bold: true, size: 14 }
  cover.getCell('B7').font = { name: 'Arial', bold: true, size: 12 }

  let totalRows = 0

  for (const def of SHIPPER_SHEETS) {
    const rows = grouped.get(def.id)
    if (!rows || !rows.length) continue

    const sheet = workbook.addWorksheet(def.id.replace(/_/g, ' ').slice(0, 31))

    addShipperHeaderBlock(sheet, def.title, lead, generatedDate)

    const headerRowIdx = 7
    const headerRow = sheet.getRow(headerRowIdx)
    SHIPPER_COLUMNS.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1)
      cell.value = h
      cell.font = { name: 'Arial', bold: true }
      cell.fill = SHIPPER_HEADER_FILL
    })

    const firstDataRow = headerRowIdx + 1
    let r = firstDataRow

    for (const g of rows) {
      const row = sheet.getRow(r)
      row.getCell(1).value = g.quantity
      row.getCell(2).value = formatShipperMarks(g.marks)
      row.getCell(3).value = g.description
      row.getCell(4).value = g.partCode
      row.getCell(5).value = g.partColor
      row.getCell(6).value = [...g.buildings].sort((a, b) => a - b).join(', ')
      row.getCell(7).value = g.type
      row.getCell(8).value = g.angle
      row.getCell(9).value = g.gauge
      row.getCell(10).value = g.lengthRaw
      row.getCell(11).value = Number(g.weight.toFixed(2))
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' }
      r++
      totalRows++
    }

    const lastDataRow = r - 1
    const totalRow = sheet.getRow(r + 1)
    totalRow.getCell(1).value = { formula: `SUM(A${firstDataRow}:A${lastDataRow})` }
    totalRow.getCell(3).value = 'QTY TOTAL'
    totalRow.getCell(9).value = 'Total Weight (lbs):'
    totalRow.getCell(11).value = { formula: `SUM(K${firstDataRow}:K${lastDataRow})` }
    totalRow.font = { name: 'Arial', bold: true }

    const widths = [8, 50, 38, 14, 10, 10, 8, 8, 8, 14, 12]
    widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()

  return {
    buffer,
    sheetCount: workbook.worksheets.length,
    itemCount: allItems.length,
    rowCount: totalRows,
  }
}

/**
 * Groups BOM items for DB persistence in ConsolidatedBOM.items.
 *
 * FIX #2: The old key included raw `category` and `description`, which broke
 * cross-building merges when buildings had files from different sources
 * (e.g. one .out and one .xlsx). The same Z82516 purlin from two buildings
 * would produce two ConsolidatedBOM rows instead of one because:
 *   - .out category: "PURLINS, EAVE STRUTS, WALL GIRTS"
 *   - .xlsx sheetname: "Purlins" (or any other name the customer uses)
 *
 * Fix: use classifyShipperSheet() result (the normalized shipper sheet ID)
 * as the category key. This is the same bucketing the Excel file uses, so
 * the DB and the file are always consistent, and cross-format merges work.
 *
 * description is also removed from the key — it varies per-mark for frame
 * members and is not stable enough to key on. The partCode + color + length
 * tuple already uniquely identifies a stockable item; for no-part-code items
 * the description is used as the identity (see `identity` below).
 *
 * FIX #3: buildings tracking — removed `|| 0` fallback that added a phantom
 * building 0 when buildingId wasn't in buildingMap.
 */
const groupItemsForConsolidation = (items, buildingMap) => {
  const map = new Map()

  items.forEach((item) => {
    // FIX #2: normalize category to shipper sheet ID so cross-building,
    // cross-format merges work correctly.
    const normalizedCategory = classifyShipperSheet(item)

    // Identity: for items with a part code, key on that.
    // For no-part-code items (custom frames, buyouts), key on description
    // so distinct members don't wrongly merge.
    const identity =
      item.partCode ||
      `DESC:${(item.description || '').toUpperCase().trim()}`

    const key = [
      identity,
      item.partColor || '_',
      item.costUnit || '_',
      normalizedCategory,
      item.lengthFeet != null ? Number(item.lengthFeet).toFixed(4) : '_',
    ].join('|')

    if (!map.has(key)) {
      map.set(key, {
        partCode: item.partCode,
        partColor: item.partColor,
        description: item.description,
        // FIX #2: store the normalized category so the DB record matches the Excel sheet.
        category: normalizedCategory,
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

    const qty = safeNumber(item.quantity)
    const pieceLengthFeet = safeNumber(item.lengthFeet)

    group.totalQty += qty
    // Store TOTAL linear feet, not single-piece length.
    // Shipper reconciliation derives piece length as totalLengthFeet / totalQty.
    group.totalLengthFeet += qty * pieceLengthFeet
    group.totalWeight += safeNumber(item.weight)
    group.totalCost += safeNumber(item.finalTotalCost)

    if (group.unitCost == null && item.finalUnitCost != null) {
      group.unitCost = item.finalUnitCost
    }

    // FIX #3: only add building number if it's actually in the map.
    // The old `|| 0` fallback added a phantom building 0 when lookup failed.
    const bNum = buildingMap[String(item.buildingId)]
    if (bNum != null) {
      group.buildings.add(bNum)
    }

    for (const mark of splitMarkIds(item.markId)) {
      group.markIds.push(mark)
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

    buildings: [...group.buildings].filter((b) => b != null).sort((a, b) => a - b),
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

  // Shipper-format helpers (the file is shipper format; these support it)
  groupItemsForShipper,
  classifyShipperSheet,
  splitMarkIds,
  SHIPPER_SHEETS,
}