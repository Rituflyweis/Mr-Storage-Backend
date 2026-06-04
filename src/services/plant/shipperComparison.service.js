const Anthropic = require('@anthropic-ai/sdk')
const https = require('https')
const http = require('http')
const XLSX = require('xlsx')
const pdfParse = require('pdf-parse')
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

const close = (a, b, tolerance = 0.02) => {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance
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

const normalizeComparableKey = ({ partCode, partColor, lengthFeet }) => {
  const part = normalizeKey(partCode)
  const color = normalizeKey(partColor)

  const length =
    lengthFeet != null && Number.isFinite(Number(lengthFeet))
      ? Number(lengthFeet).toFixed(4)
      : '_'

  return `${part || '_'}|${color || '_'}|${length}`
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

/**
 * Maps one extracted spreadsheet/PDF row into VendorQuoteLine shape.
 * Headers passed here must already be normalized with normalizeKey().
 */
const mapRowToVendorLine = ({
  row,
  rowNumber,
  shipperRequestId,
  request,
  extractionMethod,
  pageNumber = null,
  rawText = '',
}) => {
  const headers = row.__headers || []

  const iQty = col(headers, ['QTY', 'QUANTITY'])
  const iPart = col(headers, ['PART', 'PARTCODE', 'ITEM', 'MBIPN', 'MBIP/N'])
  const iDesc = col(headers, ['DESCRIPTION', 'DESC'])
  const iColor = col(headers, ['COLOR', 'COLOUR', 'FINISH'])
  const iLength = col(headers, ['LENGTH', 'LEN', 'LENGTHFT'])
  const iWeight = col(headers, ['WEIGHT', 'WT', 'WEIGHTLBS'])
  const iUnitPrice = col(headers, ['UNITPRICE', 'PRICE', 'RATE'])
  const iAmount = col(headers, ['TOTAL', 'AMOUNT', 'LINETOTAL', 'EXTAMOUNT'])
  const iMark = col(headers, ['MARK', 'MARKID', 'PIECEMARK', 'PIECE'])

  const qty = iQty >= 0 ? toNum(row[iQty]) : null
  const partCode = iPart >= 0 ? cleanStr(row[iPart]) : ''
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
    vendorLineNo: '',

    qty,

    partCode: partCode || null,
    partCodeNormalized: normalizeKey(partCode) || null,

    description,

    pieceMark,
    pieceMarkNormalized: normalizeKey(pieceMark),

    color: color || null,
    colorNormalized: normalizeKey(color) || null,

    lengthText: lengthText || null,
    lengthFeet: parseLengthToFeet(lengthText),

    weight: iWeight >= 0 ? toNum(row[iWeight]) : null,

    unitPrice: iUnitPrice >= 0 ? toNum(row[iUnitPrice]) : null,
    priceUnit: 'UNKNOWN',
    amount: iAmount >= 0 ? toNum(row[iAmount]) : null,

    punchInfo: '',
    bendInfo: '',
    notes: '',

    extractionMethod,
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

const extractExcelQuoteLines = async (buffer, request) => {
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
      })

      if (doc.partCodeNormalized || doc.description || doc.qty != null) {
        docs.push(doc)
      }
    }
  }

  return docs
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
        extractionMethod: 'excel',
      })
    )
    .filter((doc) => doc.partCodeNormalized || doc.description || doc.qty != null)
}

const extractPdfQuoteLinesWithClaude = async (buffer, request) => {
  const parsedPdf = await pdfParse(buffer)
  const text = parsedPdf.text || ''

  if (!text.trim()) {
    throw new Error('Unable to extract text from PDF')
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing for PDF parsing')
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 12000,
    system:
      'You extract vendor quote / shipper line items from PDF text. Return strict JSON only. No markdown.',
    messages: [
      {
        role: 'user',
        content: `Extract vendor quote rows from the text below.

Return JSON only in this exact structure:
{
  "lines": [
    {
      "qty": 10,
      "partCode": "P100",
      "description": "Part description",
      "color": "RO",
      "lengthText": "5' 6\\"",
      "weight": 10.5,
      "unitPrice": 2.5,
      "amount": 25,
      "pieceMark": "M1",
      "pageNumber": 1,
      "rawText": "original row text",
      "confidence": 0.9,
      "warnings": []
    }
  ]
}

Rules:
- Extract only actual line items.
- Skip totals, tax rows, headers, footers, notes, and page labels.
- qty must be a number when visible.
- partCode should be the actual item/part code if present.
- If part code is missing, keep partCode as null and preserve description.
- lengthText must preserve feet/inch format exactly when visible.
- weight must be numeric if visible.
- unitPrice and amount must be numeric if visible.
- Do not invent missing values.
- If uncertain, include warning in warnings[].

PDF text:
${text.slice(0, 120000)}`,
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
      const row = [
        line.qty,
        line.partCode,
        line.description,
        line.color,
        line.lengthText,
        line.weight,
        line.unitPrice,
        line.amount,
        line.pieceMark,
      ]

      row.__headers = [
        'QTY',
        'PARTCODE',
        'DESCRIPTION',
        'COLOR',
        'LENGTH',
        'WEIGHT',
        'UNITPRICE',
        'AMOUNT',
        'MARK',
      ]

      const doc = mapRowToVendorLine({
        row,
        rowNumber: index + 1,
        shipperRequestId: request._id,
        request,
        extractionMethod: 'claude',
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

  if (['xlsx', 'xls'].includes(ext)) {
    return extractExcelQuoteLines(buffer, request)
  }

  if (ext === 'csv') {
    return extractCsvQuoteLines(buffer, request)
  }

  if (ext === 'pdf') {
    return extractPdfQuoteLinesWithClaude(buffer, request)
  }

  throw new Error('Unsupported vendor quote file type')
}

/**
 * Expected rows come from updated ConsolidatedBOM.items[].
 * This assumes consolidated BOM was generated using the updated grouping key:
 * partCode + color + costUnit + category + description + length.
 */
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

    partColor: line.color || null,
    partColorNormalized: normalizeKey(line.color),

    description: line.description || '',

    qty: Number(line.qty || 0),
    lengthFeet: line.lengthFeet != null ? Number(line.lengthFeet) : null,
    weight: line.weight != null ? Number(line.weight) : 0,

    priceUnit: line.priceUnit || 'UNKNOWN',
    unitPrice: line.unitPrice ?? null,
    amount: line.amount ?? null,

    pieceMark: line.pieceMark || '',

    comparableKey: normalizeComparableKey({
      partCode: line.partCode,
      partColor: line.color,
      lengthFeet: line.lengthFeet,
    }),
  }))
}

/**
 * Groups vendor rows because vendors may split the same item into multiple rows.
 */
const groupVendorLinesForComparison = (receivedItems) => {
  const map = new Map()

  for (const item of receivedItems) {
    const key = item.comparableKey

    if (!map.has(key)) {
      map.set(key, {
        vendorQuoteLineIds: [],

        partCode: item.partCode,
        partCodeNormalized: item.partCodeNormalized,

        partColor: item.partColor,
        partColorNormalized: item.partColorNormalized,

        description: item.description,

        qty: 0,
        lengthFeet: item.lengthFeet || 0,
        weight: 0,

        priceUnit: item.priceUnit || 'UNKNOWN',
        unitPrice: item.unitPrice,
        amount: 0,

        pieceMarks: [],
        sourceLineCount: 0,

        comparableKey: key,
      })
    }

    const group = map.get(key)

    group.vendorQuoteLineIds.push(item.vendorQuoteLineId)
    group.qty += Number(item.qty || 0)
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

const findBestVendorMatch = (expected, groupedVendorItems, usedVendorKeys) => {
  const candidates = groupedVendorItems.filter(
    (candidate) => !usedVendorKeys.has(candidate.comparableKey)
  )

  // 1. Exact part + color + length
  let match = candidates.find(
    (candidate) =>
      candidate.partCodeNormalized === expected.partCodeNormalized &&
      candidate.partColorNormalized === expected.partColorNormalized &&
      close(candidate.lengthFeet, expected.lengthFeet, 0.02)
  )

  if (match) {
    return {
      match,
      matchMethod: 'exact_part_color_length',
      confidence: 0.98,
    }
  }

  // 2. Part + length, color ignored
  match = candidates.find(
    (candidate) =>
      candidate.partCodeNormalized === expected.partCodeNormalized &&
      close(candidate.lengthFeet, expected.lengthFeet, 0.02)
  )

  if (match) {
    return {
      match,
      matchMethod: 'part_length_grouped',
      confidence: 0.9,
    }
  }

  // 3. Part only
  match = candidates.find(
    (candidate) => candidate.partCodeNormalized === expected.partCodeNormalized
  )

  if (match) {
    return {
      match,
      matchMethod: 'part_only_grouped',
      confidence: 0.75,
    }
  }

  return null
}

const detectMismatches = (expected, received) => {
  const issues = []

  const expectedQty = Number(expected.qty || 0)
  const receivedQty = Number(received.qty || 0)

  if (Math.abs(expectedQty - receivedQty) > 0) {
    issues.push({
      status: 'qty_mismatch',
      issueType: 'qty_mismatch',
      severity: 'critical',
      reason: `Vendor quantity does not match expected quantity. Expected ${expectedQty}, received ${receivedQty}.`,
    })
  }

  if (!close(expected.lengthFeet, received.lengthFeet, 0.02)) {
    issues.push({
      status: 'length_mismatch',
      issueType: 'length_mismatch',
      severity: 'high',
      reason: `Vendor length does not match expected length. Expected ${expected.lengthFeet}, received ${received.lengthFeet}.`,
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
      severity: 'medium',
      reason: `Vendor unit price differs from internal expected cost. Expected ${expected.unitCost}, received ${received.unitPrice}.`,
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
  confidence = null
) => ({
  shipperRequestId: request._id,
  leadId: request.leadId,
  consolidatedBOMId: request.consolidatedBOMId,
  vendorId: request.vendorId,

  consolidatedItemId: expected?.consolidatedItemId || null,

  // Primary vendor line reference. Full list remains inside received.vendorQuoteLineIds.
  vendorQuoteLineId:
    received?.vendorQuoteLineId ||
    received?.vendorQuoteLineIds?.[0] ||
    null,

  status,
  severity,

  expected: expected || null,
  received: received || null,

  difference: {
    qtyDiff:
      received && expected
        ? Number(received.qty || 0) - Number(expected.qty || 0)
        : null,

    lengthDiff:
      received && expected
        ? Number(received.lengthFeet || 0) - Number(expected.lengthFeet || 0)
        : null,

    weightDiff:
      received && expected
        ? Number(received.weight || 0) - Number(expected.weight || 0)
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

  missingItems: results.filter((r) => r.status === 'missing_in_vendor_quote')
    .length,

  extraItems: results.filter((r) => r.status === 'extra_in_vendor_quote')
    .length,

  qtyMismatches: results.filter((r) => r.status === 'qty_mismatch').length,

  lengthMismatches: results.filter((r) => r.status === 'length_mismatch')
    .length,

  weightMismatches: results.filter((r) => r.status === 'weight_mismatch')
    .length,

  priceMismatches: results.filter((r) => r.status === 'price_mismatch')
    .length,

  ambiguousMatches: results.filter((r) => r.status === 'ambiguous_match')
    .length,
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

  // Useful for tests
  extractVendorQuoteLines,
  compareExpectedVsVendor,
  normalizeExpectedBomItems,
  normalizeVendorQuoteLines,
  groupVendorLinesForComparison,
}