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

const normalizeKey = (v) => (v == null ? '' : String(v).trim().toUpperCase().replace(/\s+/g, ''))
const cleanStr = (v) => (v == null ? '' : String(v).trim())
const toNum = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,%\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}
const close = (a, b, tolerance = 0.02) => Math.abs(Number(a || 0) - Number(b || 0)) <= tolerance

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

const col = (headers, aliases) => headers.findIndex((h) => aliases.includes(h))

const mapRowToVendorLine = ({ row, rowNumber, shipperRequestId, request, extractionMethod }) => {
  const headers = row.__headers
  const iQty = col(headers, ['QTY', 'QUANTITY'])
  const iPart = col(headers, ['PART', 'PARTCODE', 'PART CODE', 'ITEM'])
  const iDesc = col(headers, ['DESCRIPTION', 'DESC'])
  const iColor = col(headers, ['COLOR', 'COLOUR', 'FINISH'])
  const iLength = col(headers, ['LENGTH', 'LEN', 'LENGTH(FT)'])
  const iWeight = col(headers, ['WEIGHT', 'WT', 'WEIGHT(LBS)'])
  const iUnitPrice = col(headers, ['UNITPRICE', 'UNIT PRICE', 'PRICE', 'RATE'])
  const iAmount = col(headers, ['TOTAL', 'AMOUNT', 'LINE TOTAL', 'EXT AMOUNT'])
  const iMark = col(headers, ['MARK', 'MARKID', 'PIECEMARK'])

  const partCode = iPart >= 0 ? cleanStr(row[iPart]) : ''
  const color = iColor >= 0 ? cleanStr(row[iColor]) : ''
  const lengthText = iLength >= 0 ? cleanStr(row[iLength]) : ''

  return {
    shipperRequestId,
    leadId: request.leadId,
    consolidatedBOMId: request.consolidatedBOMId,
    vendorId: request.vendorId,
    rowNumber,
    qty: iQty >= 0 ? toNum(row[iQty]) : null,
    partCode: partCode || null,
    partCodeNormalized: normalizeKey(partCode),
    description: iDesc >= 0 ? cleanStr(row[iDesc]) : '',
    pieceMark: iMark >= 0 ? cleanStr(row[iMark]) : '',
    pieceMarkNormalized: iMark >= 0 ? normalizeKey(row[iMark]) : '',
    color: color || null,
    colorNormalized: normalizeKey(color) || null,
    lengthText: lengthText || null,
    lengthFeet: parseLengthToFeet(lengthText),
    weight: iWeight >= 0 ? toNum(row[iWeight]) : null,
    unitPrice: iUnitPrice >= 0 ? toNum(row[iUnitPrice]) : null,
    priceUnit: 'UNKNOWN',
    amount: iAmount >= 0 ? toNum(row[iAmount]) : null,
    extractionMethod,
    rawRow: row,
  }
}

const normalizeHeader = (h) => normalizeKey(h)

const parseSheetRows = (rows) => {
  if (!rows.length) return []
  const headerIdx = rows.findIndex((r) => (r || []).some((c) => {
    const n = normalizeHeader(c)
    return ['QTY', 'QUANTITY', 'PART', 'PARTCODE', 'PARTCODE', 'DESCRIPTION', 'ITEM'].includes(n)
  }))
  if (headerIdx < 0) return []

  const headers = (rows[headerIdx] || []).map(normalizeHeader)
  const out = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const joined = row.map((c) => cleanStr(c)).join(' ').toLowerCase()
    if (!joined || joined.startsWith('total')) continue
    row.__headers = headers
    out.push({ row, rowNumber: i + 1 })
  }
  return out
}

const extractExcelQuoteLines = async (buffer, request) => {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const docs = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false })
    const parsed = parseSheetRows(rows)
    for (const item of parsed) {
      docs.push(mapRowToVendorLine({
        row: item.row,
        rowNumber: item.rowNumber,
        shipperRequestId: request._id,
        request,
        extractionMethod: 'excel',
      }))
    }
  }
  return docs.filter((d) => d.partCodeNormalized || d.description || d.qty != null)
}

const extractCsvQuoteLines = async (buffer, request) => {
  const records = parseCsv(buffer.toString('utf8'), { relax_column_count: true, skip_empty_lines: true })
  const parsed = parseSheetRows(records)
  return parsed.map((item) => mapRowToVendorLine({
    row: item.row,
    rowNumber: item.rowNumber,
    shipperRequestId: request._id,
    request,
    extractionMethod: 'excel',
  }))
}

const extractPdfQuoteLinesWithClaude = async (buffer, request) => {
  const parsedPdf = await pdfParse(buffer)
  const text = parsedPdf.text || ''
  if (!text.trim()) throw new Error('Unable to extract text from PDF')
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing for PDF parsing')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 12000,
    system: 'Extract vendor quote line items from text. Return strict JSON only.',
    messages: [{
      role: 'user',
      content: `Extract quote rows and return JSON only:
{
  "lines": [
    { "qty": 10, "partCode": "P100", "description": "Part", "color": "RO", "lengthText": "5' 6\\"", "weight": 10, "unitPrice": 2.5, "amount": 25, "pieceMark": "M1" }
  ]
}
Text:
${text.slice(0, 120000)}`,
    }],
  })

  const raw = response.content?.[0]?.text || ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Claude PDF extraction returned no JSON')
  const extracted = JSON.parse(jsonMatch[0])
  const lines = extracted.lines || []

  return lines.map((line, idx) => {
    const row = [
      line.qty, line.partCode, line.description, line.color,
      line.lengthText, line.weight, line.unitPrice, line.amount, line.pieceMark,
    ]
    row.__headers = ['QTY', 'PARTCODE', 'DESCRIPTION', 'COLOR', 'LENGTH', 'WEIGHT', 'UNIT PRICE', 'AMOUNT', 'MARK']
    return mapRowToVendorLine({
      row,
      rowNumber: idx + 1,
      shipperRequestId: request._id,
      request,
      extractionMethod: 'claude',
    })
  })
}

const extractVendorQuoteLines = async ({ fileUrl, fileName, request }) => {
  const ext = (fileName || '').split('.').pop().toLowerCase()
  const buffer = await downloadBuffer(fileUrl)

  if (['xlsx', 'xls'].includes(ext)) return extractExcelQuoteLines(buffer, request)
  if (ext === 'csv') return extractCsvQuoteLines(buffer, request)
  if (ext === 'pdf') return extractPdfQuoteLinesWithClaude(buffer, request)
  throw new Error('Unsupported vendor quote file type')
}

const normalizeExpectedBomItems = (items) => items.map((item) => ({
  consolidatedItemId: item._id,
  partCode: item.partCode || null,
  partCodeNormalized: normalizeKey(item.partCode),
  partColor: item.partColor || null,
  partColorNormalized: normalizeKey(item.partColor),
  description: item.description || '',
  qty: Number(item.totalQty || 0),
  lengthFeet: Number(item.totalLengthFeet || 0),
  weight: Number(item.totalWeight || 0),
  costUnit: item.costUnit || null,
  unitCost: item.unitCost || null,
  totalCost: item.totalCost || 0,
  markIds: item.markIds || [],
}))

const normalizeVendorQuoteLines = (lines) => lines.map((line) => ({
  vendorQuoteLineId: line._id,
  partCode: line.partCode || null,
  partCodeNormalized: normalizeKey(line.partCode),
  partColor: line.color || null,
  partColorNormalized: normalizeKey(line.color),
  description: line.description || '',
  qty: Number(line.qty || 0),
  lengthFeet: Number(line.lengthFeet || 0),
  weight: Number(line.weight || 0),
  priceUnit: line.priceUnit || 'UNKNOWN',
  unitPrice: line.unitPrice || null,
  amount: line.amount || null,
  pieceMark: line.pieceMark || '',
}))

const findBestVendorMatch = (expected, receivedItems, usedVendorIds) => {
  const candidates = receivedItems.filter((r) => !usedVendorIds.has(String(r.vendorQuoteLineId)))

  return candidates.find((r) =>
    r.partCodeNormalized === expected.partCodeNormalized &&
    r.partColorNormalized === expected.partColorNormalized &&
    close(r.lengthFeet, expected.lengthFeet)
  ) || candidates.find((r) =>
    r.partCodeNormalized === expected.partCodeNormalized &&
    close(r.lengthFeet, expected.lengthFeet)
  ) || candidates.find((r) =>
    r.partCodeNormalized === expected.partCodeNormalized
  ) || null
}

const detectMismatches = (expected, received) => {
  const issues = []

  if (Math.abs((expected.qty || 0) - (received.qty || 0)) > 0) {
    issues.push({ status: 'qty_mismatch', issueType: 'qty_mismatch', severity: 'critical', reason: 'Vendor quantity does not match expected quantity' })
  }
  if (!close(expected.lengthFeet, received.lengthFeet, 0.02)) {
    issues.push({ status: 'length_mismatch', issueType: 'length_mismatch', severity: 'high', reason: 'Vendor length does not match expected length' })
  }
  if (expected.weight && received.weight && Math.abs(expected.weight - received.weight) > 2) {
    issues.push({ status: 'weight_mismatch', issueType: 'weight_mismatch', severity: 'medium', reason: 'Vendor weight does not match expected weight' })
  }
  if (expected.unitCost != null && received.unitPrice != null && Math.abs(expected.unitCost - received.unitPrice) > 0.01) {
    issues.push({ status: 'price_mismatch', issueType: 'price_mismatch', severity: 'medium', reason: 'Vendor unit price differs from expected unit price' })
  }

  return issues
}

const buildResult = (status, severity, expected, received, request, reason, matchMethod = 'none', confidence = null) => ({
  shipperRequestId: request._id,
  leadId: request.leadId,
  consolidatedBOMId: request.consolidatedBOMId,
  vendorId: request.vendorId,
  consolidatedItemId: expected?.consolidatedItemId || null,
  vendorQuoteLineId: received?.vendorQuoteLineId || null,
  status,
  severity,
  expected: expected || {},
  received: received || {},
  difference: {
    qtyDiff: received && expected ? (received.qty || 0) - (expected.qty || 0) : null,
    lengthDiff: received && expected ? (received.lengthFeet || 0) - (expected.lengthFeet || 0) : null,
    weightDiff: received && expected ? (received.weight || 0) - (expected.weight || 0) : null,
    unitPriceDiff: received && expected && received.unitPrice != null && expected.unitCost != null ? received.unitPrice - expected.unitCost : null,
    amountDiff: received && expected && received.amount != null && expected.totalCost != null ? received.amount - expected.totalCost : null,
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

const buildSummary = (expectedItems, receivedItems, results) => ({
  expectedLines: expectedItems.length,
  vendorLines: receivedItems.length,
  matchedLines: results.filter((r) => r.status === 'matched').length,
  missingItems: results.filter((r) => r.status === 'missing_in_vendor_quote').length,
  extraItems: results.filter((r) => r.status === 'extra_in_vendor_quote').length,
  qtyMismatches: results.filter((r) => r.status === 'qty_mismatch').length,
  lengthMismatches: results.filter((r) => r.status === 'length_mismatch').length,
  weightMismatches: results.filter((r) => r.status === 'weight_mismatch').length,
  priceMismatches: results.filter((r) => r.status === 'price_mismatch').length,
  ambiguousMatches: results.filter((r) => r.status === 'ambiguous_match').length,
})

const compareExpectedVsVendor = (expectedItems, receivedItems, request) => {
  const results = []
  const exceptions = []
  const usedVendorIds = new Set()

  for (const expected of expectedItems) {
    const match = findBestVendorMatch(expected, receivedItems, usedVendorIds)
    if (!match) {
      results.push(buildResult('missing_in_vendor_quote', 'critical', expected, null, request, 'Expected item was not found in vendor quote'))
      exceptions.push(buildException('missing', 'critical', expected, null, 'Expected item was not found in vendor quote'))
      continue
    }

    usedVendorIds.add(String(match.vendorQuoteLineId))
    const mismatches = detectMismatches(expected, match)
    if (!mismatches.length) {
      results.push(buildResult('matched', 'low', expected, match, request, 'Matched successfully', 'part_length_grouped', 0.9))
      continue
    }

    for (const mm of mismatches) {
      results.push(buildResult(mm.status, mm.severity, expected, match, request, mm.reason, 'part_length_grouped', 0.8))
      exceptions.push(buildException(mm.issueType, mm.severity, expected, match, mm.reason))
    }
  }

  for (const received of receivedItems) {
    if (!usedVendorIds.has(String(received.vendorQuoteLineId))) {
      results.push(buildResult('extra_in_vendor_quote', 'medium', null, received, request, 'Vendor quoted an extra item not present in Consolidated BOM'))
      exceptions.push(buildException('extra', 'medium', null, received, 'Vendor quoted an extra item not present in Consolidated BOM'))
    }
  }

  const summary = buildSummary(expectedItems, receivedItems, results)
  return { results, summary, exceptions }
}

const compareShipperRequest = async (requestId) => {
  const request = await ShipperRequest.findById(requestId)
  if (!request) throw new Error('Shipper request not found')
  if (!request.submittedFileUrl) throw new Error('Vendor has not submitted a file yet')

  await ShipperRequest.findByIdAndUpdate(requestId, {
    status: 'comparison_processing',
    comparisonStatus: 'processing',
    comparisonError: null,
  })

  try {
    const consolidatedBOM = await ConsolidatedBOM.findById(request.consolidatedBOMId).lean()
    if (!consolidatedBOM) throw new Error('Consolidated BOM not found')

    const vendorLines = await extractVendorQuoteLines({
      fileUrl: request.submittedFileUrl,
      fileName: request.submittedFileName,
      request,
    })

    await VendorQuoteLine.deleteMany({ shipperRequestId: request._id })
    await QuoteComparisonResult.deleteMany({ shipperRequestId: request._id })

    const vendorDocs = vendorLines.length ? await VendorQuoteLine.insertMany(vendorLines, { ordered: false }) : []

    const expectedItems = normalizeExpectedBomItems(consolidatedBOM.items || [])
    const receivedItems = normalizeVendorQuoteLines(vendorDocs)
    const { results, summary, exceptions } = compareExpectedVsVendor(expectedItems, receivedItems, request)

    if (results.length) await QuoteComparisonResult.insertMany(results, { ordered: false })

    await ShipperRequest.findByIdAndUpdate(requestId, {
      status: 'comparison_completed',
      comparisonStatus: 'completed',
      comparisonSummary: summary,
      comparisonRanAt: new Date(),
      comparisonError: null,
      exceptions,
    })

    return { summary, exceptions }
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
    const resultCount = await QuoteComparisonResult.countDocuments({ shipperRequestId: job.shipperRequestId })

    await ShipperComparisonJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      summary,
      resultCount,
      processingEndedAt: new Date(),
      errorMessage: null,
    })

    if (global.io) {
      global.io.of('/admin').to(`user:${job.triggeredBy}`).emit('shipper_comparison_complete', {
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
      global.io.of('/admin').to(`user:${job.triggeredBy}`).emit('shipper_comparison_failed', {
        jobId,
        requestId: job.shipperRequestId,
        leadId: job.leadId,
        vendorId: job.vendorId,
        error: err.message,
      })
    }
  }
}

module.exports = { compareShipperRequest, processShipperComparisonJob }
