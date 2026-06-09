const Anthropic = require('@anthropic-ai/sdk')
const https = require('https')
const http = require('http')
const XLSX = require('xlsx')
const { PDFParse } = require('pdf-parse')
const { parse: parseCsv } = require('csv-parse/sync')

const env = require('../../config/env')
const ShipperRequest = require('../../models/ShipperRequest')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const VendorQuoteLine = require('../../models/VendorQuoteLine')
const QuoteComparisonResult = require('../../models/QuoteComparisonResult')
const ShipperComparisonJob = require('../../models/ShipperComparisonJob')
const { parseLengthToFeet } = require('./bom.service')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const normalizeKey = (value) => {
  if (value == null) return ''

  return String(value)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^\w#+./-]/g, '')
}

const cleanStr = (value) => {
  if (value == null) return ''

  return String(value)
    .replace(/^'+/, '')
    .replace(/'+$/, '')
    .trim()
}

const toNum = (value) => {
  if (value == null || value === '') return null

  const n = Number(
    String(value)
      .replace(/[$,%\s,]/g, '')
      .trim()
  )

  return Number.isFinite(n) ? n : null
}

const safeNum = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const close = (a, b, tolerance = 0.05) => {
  if (a == null || b == null) return false
  return Math.abs(Number(a) - Number(b)) <= tolerance
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

const col = (headers, aliases) => {
  return headers.findIndex((header) => aliases.includes(header))
}

const normalizeHeader = (header) => normalizeKey(header)

const parseMbsLengthToFeet = (value) => {
  if (value == null || value === '') return null

  const raw = String(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐-‒–—]/g, '-')
    .trim()

  if (!raw) return null

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Number(raw)
  }

  /**
   * MBS style:
   * 15'11-12" means 15 ft + 11 + 12/16 inches.
   * 16'02-04" means 16 ft + 2 + 4/16 inches.
   */
  const mbsFeet = raw.match(/^(\d+)'\s*(\d{1,2})-(\d{1,2})"?$/)
  if (mbsFeet) {
    const feet = Number(mbsFeet[1])
    const inches = Number(mbsFeet[2])
    const sixteenths = Number(mbsFeet[3]) / 16
    return feet + (inches + sixteenths) / 12
  }

  /**
   * Inch-only MBS style:
   * 6-00" = 6 inches
   * 1-04" = 1.25 inches
   * 0-14" = 0.875 inches
   */
  const mbsInches = raw.match(/^(\d+)-(\d{1,2})"?$/)
  if (mbsInches) {
    const inches = Number(mbsInches[1])
    const sixteenths = Number(mbsInches[2]) / 16
    return (inches + sixteenths) / 12
  }

  /**
   * Quicken style:
   * 6' 11-3/4"
   * 11' 3-7/8"
   */
  const feetDashFraction = raw.match(/^(\d+)'\s*(\d+)-(\d+)\/(\d+)"?$/)
  if (feetDashFraction) {
    const feet = Number(feetDashFraction[1])
    const inches = Number(feetDashFraction[2])
    const frac = Number(feetDashFraction[3]) / Number(feetDashFraction[4])
    return feet + (inches + frac) / 12
  }

  /**
   * Central States style:
   * 6' 11.75''
   * 13' 11.75''
   */
  const feetDecimalInches = raw.match(/^(\d+)'\s*(\d+(?:\.\d+)?)''?$/)
  if (feetDecimalInches) {
    const feet = Number(feetDecimalInches[1])
    const inches = Number(feetDecimalInches[2])
    return feet + inches / 12
  }

  const fallback = parseLengthToFeet(raw)
  return Number.isFinite(Number(fallback)) ? Number(fallback) : null
}

const normalizeComparableKey = ({ partCode, partColor, lengthFeet }) => {
  const part = normalizeKey(partCode)
  const color = normalizeKey(partColor)

  const length =
    lengthFeet != null && Number.isFinite(Number(lengthFeet))
      ? Number(lengthFeet).toFixed(4)
      : '_'

  return `${part || '_'}|${color || '_'}|${length}`
}

const detectPdfFormat = (text) => {
  const t = String(text || '').toUpperCase()

  if (
    t.includes('QUICKEN STEEL') ||
    t.includes('SALES ORDER') ||
    t.includes('PIECE MARK:')
  ) {
    return 'quicken_steel'
  }

  if (
    t.includes('CENTRAL STATES') ||
    t.includes('LINE PRODUCT DESCRIPTION QTY UOM UNIT COST TOTAL COST') ||
    t.includes('PIECES @') ||
    t.includes('PART MARK:')
  ) {
    return 'central_states'
  }

  if (
    t.includes('WEIGHT & COST SUMMARY') ||
    t.includes('TOTAL WEIGHT =') ||
    t.includes('QUAN MARK DESCRIPTION') ||
    t.includes('ROOF & WALL SHEETING')
  ) {
    return 'mbs_material_report'
  }

  return 'generic_material_pdf'
}

const buildPdfExtractionPrompt = (format, text) => {
  const baseShape = `Return JSON only in this exact structure:
{
  "lines": [
    {
      "lineNo": "1",
      "qty": 10,
      "pieceQty": 10,
      "totalLinearFeet": null,
      "uom": null,
      "partCode": "C42516",
      "vendorProductCode": "C42516",
      "description": "Stud",
      "color": "RO",
      "lengthText": "15'11-12\\"",
      "weight": 59.4,
      "unitPrice": null,
      "priceUnit": "UNKNOWN",
      "amount": 56.70,
      "pieceMark": "S-1",
      "punchInfo": "",
      "leftPunch": "",
      "rightPunch": "",
      "pageNumber": 1,
      "rawText": "original source row text",
      "confidence": 0.95,
      "warnings": []
    }
  ]
}`

  if (format === 'quicken_steel') {
    return `Extract shipper/vendor material line items from this Quicken Steel sales order PDF text.

This format has rows similar to:
Line Item Description Length Weight Unit Price Amount Qty
1 16Ga CEE Purlin Red Oxide 8 X 3-1/2" $2.53 / FT 28 $494.48 PC16-RO-8X3.5 6' 11-3/4" 621
Punch: Custom Punch
Piece Mark: DJ-1

Rules:
- Extract actual material line items only.
- Attach "Punch:" and "Piece Mark:" continuation lines to the item immediately above them.
- qty is the physical quantity/piece count.
- partCode and vendorProductCode should be the product code like PC16-RO-8X3.5.
- lengthText must preserve the original length.
- weight is the line weight.
- unitPrice is the numeric value from "$2.53 / FT"; priceUnit should be FT.
- amount is the line amount.
- Do not include headers, footers, totals, customer information, or signature pages.
- Do not invent missing values.

${baseShape}

PDF text:
${text.slice(0, 120000)}`
  }

  if (format === 'central_states') {
    return `Extract shipper/vendor material line items from this Central States quote PDF text.

This format has rows like:
1 C83516R Purlin,Prime,R,Cee,8,3.5,16
28 Pieces @ 6' 11.75''
Left Punch: PPEP
Right Punch: PPEP
Part Mark: DJ-1
195.4167 LF 3.0006 586.37

Rules:
- Extract actual material line items only.
- Product code like C83516R should be partCode and vendorProductCode.
- IMPORTANT: the Qty column is usually total linear feet, not physical piece count.
- pieceQty must come from "28 Pieces @ ...".
- qty must be the physical piece count when pieceQty is available.
- totalLinearFeet must come from the LF Qty value like 195.4167.
- uom should be LF when visible.
- lengthText must come from the "Pieces @ length" text, e.g. "6' 11.75''".
- Extract Part Mark as pieceMark.
- Extract Left Punch and Right Punch.
- unitPrice is Unit Cost.
- amount is Total Cost.
- Do not include page headers, totals, bill-to/ship-to info, or repeated table headers.
- Do not invent missing values.

${baseShape}

PDF text:
${text.slice(0, 120000)}`
  }

  if (format === 'mbs_material_report') {
    return `Extract shipper/material line items from this MBS-style material report PDF text.

This format has sections like:
Quan Mark Description Stock Length Weight Cost
2 S-1 Stud C42516 15'11-12" 59.4 56.70

And sheeting/trim sections may have:
Quan Mark Description Part Clr Pitch Length Weight Cost
4 ES-1 EW Sheet RLOC26 C1 16'00-00" 169.2 229.32

Rules:
- Extract only actual material line rows.
- Skip section headings, separator lines, totals, summaries, color legends, supplier discount summaries, and page labels.
- qty is the first number in the material row.
- pieceMark is the Mark value, e.g. S-1, DJ-1, P-1, G-1, ES-1, RS-1, MINICL, BASECL, RA, BA.
- partCode should be Stock/Part value, e.g. C42516, Z62516, RLOC26, PLOC+29, MINICLIP, BASECLIP, B4216, #12114MM.
- color should be extracted only when a visible color code exists, e.g. RO, GZ, M, C1, NC.
- lengthText must preserve original length, e.g. 15'11-12", 6-00", 1-04".
- weight is line weight.
- amount is line cost.
- unitPrice may be null unless explicitly visible.
- Do not invent missing values.

${baseShape}

PDF text:
${text.slice(0, 120000)}`
  }

  return `Extract shipper/vendor material line items from this PDF text.

Rules:
- Extract actual line items only.
- Skip headers, footers, totals, summaries, tax rows, notes, and page labels.
- Prefer physical quantity as qty.
- Extract part/product code, description, mark, color, length, weight, unit price, amount.
- Do not invent missing values.
- Include warnings when uncertain.

${baseShape}

PDF text:
${text.slice(0, 120000)}`
}

const isTotalOrInstructionRow = (joined) => {
  const text = String(joined || '').toLowerCase().trim()

  return (
    !text ||
    text.startsWith('total') ||
    text.includes('grand total') ||
    text.includes('subtotal') ||
    text.includes('example data') ||
    text.includes('<-example') ||
    text.includes('sample data')
  )
}

const mapRowToVendorLine = ({
  row,
  rowNumber,
  shipperRequestId,
  request,
  extractionMethod,
  extractionFormat = 'excel',
  pageNumber = null,
  rawText = '',
}) => {
  const headers = row.__headers || []

  const iQty = col(headers, ['QTY', 'QUANTITY', 'PIECEQTY'])
  const iPieceQty = col(headers, ['PIECEQTY', 'PIECES'])
  const iTotalLf = col(headers, ['TOTALLINEARFEET', 'TOTALFEET', 'LF', 'LINEARFEET'])
  const iUom = col(headers, ['UOM', 'UNIT'])
  const iPart = col(headers, ['PART', 'PARTCODE', 'ITEM', 'MBIPN', 'MBIP/N', 'PRODUCT', 'PRODUCTCODE'])
  const iVendorProduct = col(headers, ['VENDORPRODUCTCODE', 'PRODUCT', 'PRODUCTCODE'])
  const iDesc = col(headers, ['DESCRIPTION', 'DESC'])
  const iColor = col(headers, ['COLOR', 'COLOUR', 'FINISH', 'CLR'])
  const iLength = col(headers, ['LENGTH', 'LEN', 'LENGTHFT'])
  const iWeight = col(headers, ['WEIGHT', 'WT', 'WEIGHTLBS'])
  const iUnitPrice = col(headers, ['UNITPRICE', 'UNITCOST', 'PRICE', 'RATE'])
  const iPriceUnit = col(headers, ['PRICEUNIT'])
  const iAmount = col(headers, ['TOTAL', 'AMOUNT', 'LINETOTAL', 'EXTAMOUNT', 'TOTALCOST'])
  const iMark = col(headers, ['MARK', 'MARKID', 'PIECEMARK', 'PIECE', 'PARTMARK'])
  const iPunch = col(headers, ['PUNCH', 'PUNCHINFO'])
  const iLeftPunch = col(headers, ['LEFTPUNCH'])
  const iRightPunch = col(headers, ['RIGHTPUNCH'])
  const iLineNo = col(headers, ['LINENO', 'LINE'])

  const pieceQty = iPieceQty >= 0 ? toNum(row[iPieceQty]) : null
  const qtyRaw = iQty >= 0 ? toNum(row[iQty]) : null
  const totalLinearFeet = iTotalLf >= 0 ? toNum(row[iTotalLf]) : null

  const qty = pieceQty != null ? pieceQty : qtyRaw

  const partCode = iPart >= 0 ? cleanStr(row[iPart]) : ''
  const vendorProductCode = iVendorProduct >= 0 ? cleanStr(row[iVendorProduct]) : partCode
  const description = iDesc >= 0 ? cleanStr(row[iDesc]) : ''
  const color = iColor >= 0 ? cleanStr(row[iColor]) : ''
  const lengthText = iLength >= 0 ? cleanStr(row[iLength]) : ''
  const pieceMark = iMark >= 0 ? cleanStr(row[iMark]) : ''

  return {
    shipperRequestId,
    leadId: request.leadId,
    consolidatedBOMId: request.consolidatedBOMId,
    vendorId: request.vendorId,

    pageNumber,
    rowNumber,
    vendorLineNo: iLineNo >= 0 ? cleanStr(row[iLineNo]) : '',

    qty,
    pieceQty,
    totalLinearFeet,
    uom: iUom >= 0 ? cleanStr(row[iUom]) : null,

    partCode: partCode || null,
    partCodeNormalized: normalizeKey(partCode) || null,

    vendorProductCode: vendorProductCode || null,
    vendorProductCodeNormalized: normalizeKey(vendorProductCode) || null,

    description,

    pieceMark,
    pieceMarkNormalized: normalizeKey(pieceMark),

    color: color || null,
    colorNormalized: normalizeKey(color) || null,

    lengthText: lengthText || null,
    lengthFeet: parseMbsLengthToFeet(lengthText),

    weight: iWeight >= 0 ? toNum(row[iWeight]) : null,

    unitPrice: iUnitPrice >= 0 ? toNum(row[iUnitPrice]) : null,
    priceUnit: iPriceUnit >= 0 ? normalizeKey(row[iPriceUnit]) || 'UNKNOWN' : 'UNKNOWN',
    amount: iAmount >= 0 ? toNum(row[iAmount]) : null,

    punchInfo: iPunch >= 0 ? cleanStr(row[iPunch]) : '',
    leftPunch: iLeftPunch >= 0 ? cleanStr(row[iLeftPunch]) : '',
    rightPunch: iRightPunch >= 0 ? cleanStr(row[iRightPunch]) : '',

    bendInfo: '',
    notes: '',

    extractionMethod,
    extractionFormat,
    extractionConfidence: null,
    warnings: [],

    rawText,
    rawRow: row,
  }
}

const parseSheetRows = (rows) => {
  if (!rows.length) return []

  const headerIdx = rows.findIndex((row) => {
    const normalized = (row || []).map(normalizeHeader)

    const hasQty = normalized.includes('QTY') || normalized.includes('QUANTITY')

    const hasPart =
      normalized.includes('PART') ||
      normalized.includes('PARTCODE') ||
      normalized.includes('ITEM') ||
      normalized.includes('PRODUCT') ||
      normalized.includes('PRODUCTCODE') ||
      normalized.includes('MBIPN') ||
      normalized.includes('MBIP/N')

    const hasDescription =
      normalized.includes('DESCRIPTION') ||
      normalized.includes('DESC')

    return hasQty && (hasPart || hasDescription)
  })

  if (headerIdx < 0) return []

  const headers = (rows[headerIdx] || []).map(normalizeHeader)
  const parsedRows = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const joined = row.map((cell) => cleanStr(cell)).join(' ')

    if (isTotalOrInstructionRow(joined)) continue

    row.__headers = headers

    parsedRows.push({
      row,
      rowNumber: i + 1,
    })
  }

  return parsedRows
}

const extractExcelQuoteLines = async (buffer, request, extractionFormat = 'excel') => {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    raw: false,
  })

  const docs = []

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
    })

    const parsed = parseSheetRows(rows)

    for (const item of parsed) {
      const doc = mapRowToVendorLine({
        row: item.row,
        rowNumber: item.rowNumber,
        shipperRequestId: request._id,
        request,
        extractionMethod: 'excel',
        extractionFormat,
      })

      if (doc.partCodeNormalized || doc.description || doc.qty != null) {
        docs.push(doc)
      }
    }
  }

  return docs
}

const extractPdfText = async (buffer) => {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text || ''
  } finally {
    await parser.destroy()
  }
}

const extractCsvQuoteLines = async (buffer, request) => {
  const records = parseCsv(buffer.toString('utf8'), {
    relax_column_count: true,
    skip_empty_lines: true,
  })

  const parsed = parseSheetRows(records)

  return parsed
    .map((item) =>
      mapRowToVendorLine({
        row: item.row,
        rowNumber: item.rowNumber,
        shipperRequestId: request._id,
        request,
        extractionMethod: 'csv',
        extractionFormat: 'csv',
      })
    )
    .filter((doc) => doc.partCodeNormalized || doc.description || doc.qty != null)
}

const extractPdfQuoteLinesWithClaude = async (buffer, request) => {
  const text = await extractPdfText(buffer)

  if (!text.trim()) {
    throw new Error('Unable to extract text from PDF')
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing for PDF parsing')
  }

  const extractionFormat = detectPdfFormat(text)
  const prompt = buildPdfExtractionPrompt(extractionFormat, text)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system:
      'You extract shipper/vendor material line items from PDF text. Return strict JSON only. No markdown.',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const raw = response.content?.[0]?.text || ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)

  if (!jsonMatch) {
    throw new Error('Claude PDF extraction returned no JSON')
  }

  const extracted = JSON.parse(jsonMatch[0])
  const lines = extracted.lines || []

  return lines
    .map((line, index) => {
      const pieceQty = toNum(line.pieceQty)
      const qty = pieceQty != null ? pieceQty : toNum(line.qty)

      const row = [
        line.lineNo ?? '',
        qty,
        pieceQty,
        line.totalLinearFeet ?? null,
        line.uom ?? null,
        line.partCode ?? line.vendorProductCode ?? null,
        line.vendorProductCode ?? line.partCode ?? null,
        line.description ?? '',
        line.color ?? null,
        line.lengthText ?? null,
        line.weight ?? null,
        line.unitPrice ?? null,
        line.priceUnit ?? 'UNKNOWN',
        line.amount ?? null,
        line.pieceMark ?? '',
        line.punchInfo ?? '',
        line.leftPunch ?? '',
        line.rightPunch ?? '',
      ]

      row.__headers = [
        'LINE',
        'QTY',
        'PIECEQTY',
        'TOTALLINEARFEET',
        'UOM',
        'PARTCODE',
        'VENDORPRODUCTCODE',
        'DESCRIPTION',
        'COLOR',
        'LENGTH',
        'WEIGHT',
        'UNITPRICE',
        'PRICEUNIT',
        'AMOUNT',
        'MARK',
        'PUNCHINFO',
        'LEFTPUNCH',
        'RIGHTPUNCH',
      ]

      const doc = mapRowToVendorLine({
        row,
        rowNumber: index + 1,
        shipperRequestId: request._id,
        request,
        extractionMethod: 'claude',
        extractionFormat,
        pageNumber: line.pageNumber ?? null,
        rawText: line.rawText || '',
      })

      doc.extractionConfidence =
        typeof line.confidence === 'number' ? line.confidence : null

      doc.warnings = Array.isArray(line.warnings) ? line.warnings : []

      return doc
    })
    .filter((doc) => doc.partCodeNormalized || doc.description || doc.qty != null)
}

const extractVendorQuoteLines = async ({ fileUrl, fileName, request }) => {
  const ext = String(fileName || '')
    .split('.')
    .pop()
    .toLowerCase()

  const buffer = await downloadBuffer(fileUrl)

  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    return extractExcelQuoteLines(buffer, request, 'excel')
  }

  if (ext === 'csv') {
    return extractCsvQuoteLines(buffer, request)
  }

  if (ext === 'pdf') {
    return extractPdfQuoteLinesWithClaude(buffer, request)
  }

  throw new Error('Unsupported vendor quote file type')
}

const normalizeExpectedBomItems = (items) => {
  return items.map((item) => ({
    consolidatedItemId: item._id,

    partCode: item.partCode || null,
    partCodeNormalized: normalizeKey(item.partCode),

    partColor: item.partColor || null,
    partColorNormalized: normalizeKey(item.partColor),

    description: item.description || '',
    category: item.category || '',

    qty: Number(item.totalQty || 0),
    lengthFeet: Number(item.totalLengthFeet || 0),
    weight: Number(item.totalWeight || 0),

    costUnit: item.costUnit || null,
    unitCost: item.unitCost ?? null,
    totalCost: Number(item.totalCost || 0),

    markIds: item.markIds || [],
    bomItemIds: item.bomItemIds || [],
    sourceLineCount: item.sourceLineCount || 0,

    comparableKey: normalizeComparableKey({
      partCode: item.partCode,
      partColor: item.partColor,
      lengthFeet: item.totalLengthFeet,
    }),
  }))
}

const normalizeVendorQuoteLines = (lines) => {
  return lines.map((line) => ({
    vendorQuoteLineId: line._id,

    partCode: line.partCode || null,
    partCodeNormalized: normalizeKey(line.partCode),

    vendorProductCode: line.vendorProductCode || null,
    vendorProductCodeNormalized: normalizeKey(line.vendorProductCode),

    partColor: line.color || null,
    partColorNormalized: normalizeKey(line.color),

    description: line.description || '',

    qty: line.pieceQty != null ? Number(line.pieceQty) : Number(line.qty || 0),
    pieceQty: line.pieceQty != null ? Number(line.pieceQty) : null,
    totalLinearFeet:
      line.totalLinearFeet != null ? Number(line.totalLinearFeet) : null,
    uom: line.uom || null,

    lengthFeet: line.lengthFeet != null ? Number(line.lengthFeet) : null,
    weight: line.weight != null ? Number(line.weight) : 0,

    priceUnit: line.priceUnit || 'UNKNOWN',
    unitPrice: line.unitPrice ?? null,
    amount: line.amount ?? null,

    pieceMark: line.pieceMark || '',
    extractionFormat: line.extractionFormat || 'generic_material_pdf',

    comparableKey: normalizeComparableKey({
      partCode: line.partCode,
      partColor: line.color,
      lengthFeet: line.lengthFeet,
    }),
  }))
}

const groupVendorLinesForComparison = (receivedItems) => {
  const map = new Map()

  for (const item of receivedItems) {
    const key = item.comparableKey

    if (!map.has(key)) {
      map.set(key, {
        vendorQuoteLineIds: [],

        partCode: item.partCode,
        partCodeNormalized: item.partCodeNormalized,

        vendorProductCode: item.vendorProductCode,
        vendorProductCodeNormalized: item.vendorProductCodeNormalized,

        partColor: item.partColor,
        partColorNormalized: item.partColorNormalized,

        description: item.description,

        qty: 0,
        pieceQty: 0,
        totalLinearFeet: 0,
        uom: item.uom,

        lengthFeet: item.lengthFeet || 0,
        weight: 0,

        priceUnit: item.priceUnit || 'UNKNOWN',
        unitPrice: item.unitPrice,
        amount: 0,

        pieceMarks: [],
        sourceLineCount: 0,
        extractionFormat: item.extractionFormat,

        comparableKey: key,
      })
    }

    const group = map.get(key)

    group.vendorQuoteLineIds.push(item.vendorQuoteLineId)
    group.qty += Number(item.qty || 0)

    if (item.pieceQty != null) {
      group.pieceQty += Number(item.pieceQty || 0)
    }

    if (item.totalLinearFeet != null) {
      group.totalLinearFeet += Number(item.totalLinearFeet || 0)
    }

    group.weight += Number(item.weight || 0)

    if (item.amount != null) {
      group.amount += Number(item.amount || 0)
    }

    if (item.pieceMark) {
      group.pieceMarks.push(item.pieceMark)
    }

    if (group.unitPrice == null && item.unitPrice != null) {
      group.unitPrice = item.unitPrice
    }

    group.sourceLineCount += 1
  }

  return Array.from(map.values())
}

const markOverlap = (expected, received) => {
  const expectedMarks = new Set(
    (expected.markIds || [])
      .map((mark) => normalizeKey(mark))
      .filter(Boolean)
  )

  const receivedMarks = [
    received.pieceMark,
    ...(received.pieceMarks || []),
  ]
    .map((mark) => normalizeKey(mark))
    .filter(Boolean)

  if (!expectedMarks.size || !receivedMarks.length) return false

  return receivedMarks.some((mark) => expectedMarks.has(mark))
}

const samePart = (expected, candidate) => {
  if (!expected.partCodeNormalized) return false

  return (
    candidate.partCodeNormalized === expected.partCodeNormalized ||
    candidate.vendorProductCodeNormalized === expected.partCodeNormalized
  )
}

const findAmbiguousCandidates = (expected, candidates) => {
  const byMark = candidates.filter((candidate) => markOverlap(expected, candidate))

  if (byMark.length > 1) {
    return byMark
  }

  const byPart = candidates.filter((candidate) => samePart(expected, candidate))

  if (byPart.length > 1) {
    return byPart
  }

  return []
}

const findBestVendorMatch = (expected, groupedVendorItems, usedVendorKeys) => {
  const candidates = groupedVendorItems.filter(
    (candidate) => !usedVendorKeys.has(candidate.comparableKey)
  )

  const ambiguous = findAmbiguousCandidates(expected, candidates)
  if (ambiguous.length > 1) {
    const clearMatch = ambiguous.find(
      (candidate) =>
        markOverlap(expected, candidate) &&
        samePart(expected, candidate) &&
        close(candidate.lengthFeet, expected.lengthFeet, 0.05)
    )

    if (!clearMatch) {
      return {
        ambiguous: true,
        candidates: ambiguous.slice(0, 10),
        matchMethod: 'none',
        confidence: 0.4,
      }
    }
  }

  let match = candidates.find(
    (candidate) =>
      markOverlap(expected, candidate) &&
      samePart(expected, candidate) &&
      close(candidate.lengthFeet, expected.lengthFeet, 0.05)
  )

  if (match) {
    return {
      match,
      matchMethod: 'piece_mark',
      confidence: 0.99,
    }
  }

  match = candidates.find(
    (candidate) =>
      markOverlap(expected, candidate) &&
      close(candidate.lengthFeet, expected.lengthFeet, 0.05)
  )

  if (match) {
    return {
      match,
      matchMethod: 'piece_mark',
      confidence: 0.95,
    }
  }

  match = candidates.find(
    (candidate) =>
      markOverlap(expected, candidate) &&
      samePart(expected, candidate)
  )

  if (match) {
    return {
      match,
      matchMethod: 'piece_mark',
      confidence: 0.9,
    }
  }

  match = candidates.find(
    (candidate) =>
      samePart(expected, candidate) &&
      candidate.partColorNormalized === expected.partColorNormalized &&
      close(candidate.lengthFeet, expected.lengthFeet, 0.05)
  )

  if (match) {
    return {
      match,
      matchMethod: 'exact_part_color_length',
      confidence: 0.92,
    }
  }

  match = candidates.find(
    (candidate) =>
      samePart(expected, candidate) &&
      close(candidate.lengthFeet, expected.lengthFeet, 0.05)
  )

  if (match) {
    return {
      match,
      matchMethod: 'part_length_grouped',
      confidence: 0.85,
    }
  }

  match = candidates.find((candidate) => samePart(expected, candidate))

  if (match) {
    return {
      match,
      matchMethod: 'part_only_grouped',
      confidence: 0.6,
    }
  }

  return null
}

const getComparableReceivedQty = (received) => {
  if (received.pieceQty != null && Number(received.pieceQty) > 0) {
    return Number(received.pieceQty)
  }

  return Number(received.qty || 0)
}

const detectMismatches = (expected, received) => {
  const issues = []

  const expectedQty = Number(expected.qty || 0)
  const receivedQty = getComparableReceivedQty(received)

  if (Math.abs(expectedQty - receivedQty) > 0) {
    issues.push({
      status: 'qty_mismatch',
      issueType: 'qty_mismatch',
      severity: 'critical',
      reason: `Vendor quantity does not match expected quantity. Expected ${expectedQty}, received ${receivedQty}.`,
    })
  }

  if (!close(expected.lengthFeet, received.lengthFeet, 0.05)) {
    issues.push({
      status: 'length_mismatch',
      issueType: 'length_mismatch',
      severity: 'high',
      reason: `Vendor length does not match expected length. Expected ${expected.lengthFeet}, received ${received.lengthFeet}.`,
    })
  }

  if (
    expected.qty &&
    expected.lengthFeet &&
    received.totalLinearFeet &&
    Math.abs(Number(expected.qty) * Number(expected.lengthFeet) - Number(received.totalLinearFeet)) > 0.25
  ) {
    issues.push({
      status: 'length_mismatch',
      issueType: 'total_linear_feet_mismatch',
      severity: 'medium',
      reason: `Vendor total LF does not match expected Qty x Length. Expected ${(Number(expected.qty) * Number(expected.lengthFeet)).toFixed(4)}, received ${received.totalLinearFeet}.`,
    })
  }

  if (
    expected.weight &&
    received.weight &&
    Math.abs(Number(expected.weight) - Number(received.weight)) > 2
  ) {
    issues.push({
      status: 'weight_mismatch',
      issueType: 'weight_mismatch',
      severity: 'medium',
      reason: `Vendor weight does not match expected weight. Expected ${expected.weight}, received ${received.weight}.`,
    })
  }

  if (
    expected.unitCost != null &&
    received.unitPrice != null &&
    Math.abs(Number(expected.unitCost) - Number(received.unitPrice)) > 0.01
  ) {
    issues.push({
      status: 'price_mismatch',
      issueType: 'price_mismatch',
      severity: 'low',
      reason: `Vendor/internal unit price differs. Expected internal cost ${expected.unitCost}, received vendor unit price ${received.unitPrice}.`,
    })
  }

  return issues
}

const buildResult = (
  status,
  severity,
  expected,
  received,
  request,
  reason,
  matchMethod = 'none',
  confidence = null,
  matchCandidates = []
) => ({
  shipperRequestId: request._id,
  leadId: request.leadId,
  consolidatedBOMId: request.consolidatedBOMId,
  vendorId: request.vendorId,

  consolidatedItemId: expected?.consolidatedItemId || null,

  vendorQuoteLineId:
    received?.vendorQuoteLineId ||
    received?.vendorQuoteLineIds?.[0] ||
    null,

  vendorQuoteLineIds: received?.vendorQuoteLineIds || [],

  status,
  severity,

  expected: expected || null,
  received: received || null,
  matchCandidates,

  difference: {
    qtyDiff:
      received && expected
        ? getComparableReceivedQty(received) - Number(expected.qty || 0)
        : null,

    lengthDiff:
      received && expected
        ? safeNum(received.lengthFeet) - safeNum(expected.lengthFeet)
        : null,

    totalLinearFeetDiff:
      received &&
      expected &&
      received.totalLinearFeet != null &&
      expected.qty != null &&
      expected.lengthFeet != null
        ? Number(received.totalLinearFeet) -
          Number(expected.qty) * Number(expected.lengthFeet)
        : null,

    weightDiff:
      received && expected
        ? safeNum(received.weight) - safeNum(expected.weight)
        : null,

    unitPriceDiff:
      received &&
      expected &&
      received.unitPrice != null &&
      expected.unitCost != null
        ? Number(received.unitPrice) - Number(expected.unitCost)
        : null,

    amountDiff:
      received &&
      expected &&
      received.amount != null &&
      expected.totalCost != null
        ? Number(received.amount) - Number(expected.totalCost)
        : null,
  },

  matchMethod,
  matchConfidence: confidence,
  reason,
})

const buildException = (issueType, severity, expected, received, reason) => ({
  partCode: expected?.partCode || received?.partCode || '',
  description: expected?.description || received?.description || '',
  expected: expected || null,
  received: received || null,
  issueType,
  severity,
  reason,
  source: 'auto_compare',
})

const buildSummary = (expectedItems, groupedVendorItems, results) => ({
  expectedLines: expectedItems.length,
  vendorLines: groupedVendorItems.length,

  matchedLines: results.filter((r) => r.status === 'matched').length,

  missingItems: results.filter((r) => r.status === 'missing_in_vendor_quote').length,

  extraItems: results.filter((r) => r.status === 'extra_in_vendor_quote').length,

  qtyMismatches: results.filter((r) => r.status === 'qty_mismatch').length,

  lengthMismatches: results.filter((r) => r.status === 'length_mismatch').length,

  weightMismatches: results.filter((r) => r.status === 'weight_mismatch').length,

  priceMismatches: results.filter((r) => r.status === 'price_mismatch').length,

  ambiguousMatches: results.filter((r) => r.status === 'ambiguous_match').length,

  manualReviewRequired: results.filter((r) =>
    ['ambiguous_match', 'missing_in_vendor_quote', 'extra_in_vendor_quote'].includes(r.status)
  ).length,
})

const compareExpectedVsVendor = (expectedItems, receivedItems, request) => {
  const results = []
  const exceptions = []

  const groupedVendorItems = groupVendorLinesForComparison(receivedItems)
  const usedVendorKeys = new Set()

  for (const expected of expectedItems) {
    const matchedResult = findBestVendorMatch(
      expected,
      groupedVendorItems,
      usedVendorKeys
    )

    if (!matchedResult) {
      results.push(
        buildResult(
          'missing_in_vendor_quote',
          'critical',
          expected,
          null,
          request,
          'Expected item was not found in vendor quote',
          'none',
          0
        )
      )

      exceptions.push(
        buildException(
          'missing',
          'critical',
          expected,
          null,
          'Expected item was not found in vendor quote'
        )
      )

      continue
    }

    if (matchedResult.ambiguous) {
      results.push(
        buildResult(
          'ambiguous_match',
          'high',
          expected,
          null,
          request,
          'Multiple possible shipper matches found. Manual review required.',
          'none',
          matchedResult.confidence,
          matchedResult.candidates
        )
      )

      exceptions.push(
        buildException(
          'ambiguous',
          'high',
          expected,
          { candidates: matchedResult.candidates },
          'Multiple possible shipper matches found. Manual review required.'
        )
      )

      continue
    }

    const { match, matchMethod, confidence } = matchedResult
    usedVendorKeys.add(match.comparableKey)

    const mismatches = detectMismatches(expected, match)

    if (!mismatches.length) {
      results.push(
        buildResult(
          'matched',
          'low',
          expected,
          match,
          request,
          'Matched successfully',
          matchMethod,
          confidence
        )
      )

      continue
    }

    for (const mismatch of mismatches) {
      results.push(
        buildResult(
          mismatch.status,
          mismatch.severity,
          expected,
          match,
          request,
          mismatch.reason,
          matchMethod,
          confidence
        )
      )

      exceptions.push(
        buildException(
          mismatch.issueType,
          mismatch.severity,
          expected,
          match,
          mismatch.reason
        )
      )
    }
  }

  for (const received of groupedVendorItems) {
    if (!usedVendorKeys.has(received.comparableKey)) {
      results.push(
        buildResult(
          'extra_in_vendor_quote',
          'medium',
          null,
          received,
          request,
          'Vendor quoted an extra item not present in Consolidated BOM',
          'none',
          0
        )
      )

      exceptions.push(
        buildException(
          'extra',
          'medium',
          null,
          received,
          'Vendor quoted an extra item not present in Consolidated BOM'
        )
      )
    }
  }

  const summary = buildSummary(expectedItems, groupedVendorItems, results)

  return {
    results,
    summary,
    exceptions,
  }
}

const compareShipperRequest = async (requestId) => {
  const request = await ShipperRequest.findById(requestId)

  if (!request) {
    throw new Error('Shipper request not found')
  }

  if (!request.submittedFileUrl) {
    throw new Error('Vendor has not submitted a file yet')
  }

  await ShipperRequest.findByIdAndUpdate(requestId, {
    status: 'comparison_processing',
    comparisonStatus: 'processing',
    comparisonError: null,
  })

  try {
    const consolidatedBOM = await ConsolidatedBOM.findById(
      request.consolidatedBOMId
    ).lean()

    if (!consolidatedBOM) {
      throw new Error('Consolidated BOM not found')
    }

    const vendorLines = await extractVendorQuoteLines({
      fileUrl: request.submittedFileUrl,
      fileName: request.submittedFileName,
      request,
    })

    await VendorQuoteLine.deleteMany({
      shipperRequestId: request._id,
    })

    await QuoteComparisonResult.deleteMany({
      shipperRequestId: request._id,
    })

    const vendorDocs = vendorLines.length
      ? await VendorQuoteLine.insertMany(vendorLines, { ordered: false })
      : []

    const expectedItems = normalizeExpectedBomItems(consolidatedBOM.items || [])
    const receivedItems = normalizeVendorQuoteLines(vendorDocs)

    const { results, summary, exceptions } = compareExpectedVsVendor(
      expectedItems,
      receivedItems,
      request
    )

    if (results.length) {
      await QuoteComparisonResult.insertMany(results, { ordered: false })
    }

    await ShipperRequest.findByIdAndUpdate(requestId, {
      status: 'comparison_completed',
      comparisonStatus: 'completed',
      comparisonSummary: summary,
      comparisonRanAt: new Date(),
      comparisonError: null,
      exceptions,
    })

    return {
      summary,
      exceptions,
    }
  } catch (err) {
    await ShipperRequest.findByIdAndUpdate(requestId, {
      status: 'comparison_failed',
      comparisonStatus: 'failed',
      comparisonError: err.message,
    })

    throw err
  }
}

const processShipperComparisonJob = async (jobId) => {
  const job = await ShipperComparisonJob.findById(jobId).lean()

  if (!job) return

  await ShipperComparisonJob.findByIdAndUpdate(jobId, {
    status: 'processing',
    processingStartedAt: new Date(),
    errorMessage: null,
  })

  try {
    const { summary } = await compareShipperRequest(job.shipperRequestId)

    const resultCount = await QuoteComparisonResult.countDocuments({
      shipperRequestId: job.shipperRequestId,
    })

    await ShipperComparisonJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      summary,
      resultCount,
      processingEndedAt: new Date(),
      errorMessage: null,
    })

    if (global.io) {
      global.io
        .of('/admin')
        .to(`user:${job.triggeredBy}`)
        .emit('shipper_comparison_complete', {
          jobId,
          requestId: job.shipperRequestId,
          leadId: job.leadId,
          vendorId: job.vendorId,
          summary,
        })
    }
  } catch (err) {
    await ShipperComparisonJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: err.message,
      processingEndedAt: new Date(),
    })

    if (global.io) {
      global.io
        .of('/admin')
        .to(`user:${job.triggeredBy}`)
        .emit('shipper_comparison_failed', {
          jobId,
          requestId: job.shipperRequestId,
          leadId: job.leadId,
          vendorId: job.vendorId,
          error: err.message,
        })
    }
  }
}

module.exports = {
  compareShipperRequest,
  processShipperComparisonJob,

  extractVendorQuoteLines,
  compareExpectedVsVendor,
  normalizeExpectedBomItems,
  normalizeVendorQuoteLines,
  groupVendorLinesForComparison,

  detectPdfFormat,
  parseMbsLengthToFeet,
}