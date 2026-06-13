/**
 * Shipper quote extraction + comparison pipeline.
 *
 * Demo-safe / same-schema version.
 * VERSION: shipper-comparison-v4-bomitem-expected-rows
 *
 * What this version does:
 *   - Keeps the existing model schemas unchanged.
 *   - Uses deterministic parsers for Central States and Quicken Steel.
 *   - Uses Claude/Sonnet only as extraction fallback, not as final judge.
 *   - Compares vendor quote against ConsolidatedBOM using:
 *       normalized piece mark + piece length tolerance + qty
 *   - Normalizes incompatible vendor part codes into a canonical material key:
 *       C83516R       -> CEE|16GA|8|3.5|RED_OXIDE
 *       PC16-RO-8X3.5 -> CEE|16GA|8|3.5|RED_OXIDE
 *   - Stores canonical material details inside rawRow / expected / received Mixed fields
 *     so no schema migration is required.
 *
 * Public contract preserved:
 *   - processShipperComparisonJob(jobId)
 *   - compareShipperRequest(requestId)
 */

const Anthropic = require('@anthropic-ai/sdk')
const https = require('https')
const http = require('http')
const XLSX = require('xlsx')
const { PDFParse } = require('pdf-parse')
const { parse: parseCsv } = require('csv-parse/sync')

const env = require('../../config/env')
const ShipperRequest = require('../../models/ShipperRequest')
const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
const BOMItem = require('../../models/BOMItem')
const VendorQuoteLine = require('../../models/VendorQuoteLine')
const QuoteComparisonResult = require('../../models/QuoteComparisonResult')
const ShipperComparisonJob = require('../../models/ShipperComparisonJob')

/* =========================================================
 * Constants
 * ========================================================= */
const LENGTH_TOLERANCE_INCH = 0.5
const LENGTH_TOL_FEET = LENGTH_TOLERANCE_INCH / 12
const SERVICE_VERSION = 'shipper-comparison-v4.1-material-cleanup'
const DEFAULT_SONNET_MODEL = env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'

let anthropicClient = null
const getAnthropicClient = () => {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing for AI-assisted PDF extraction')
  }
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return anthropicClient
}

/* =========================================================
 * Primitives
 * ========================================================= */
const normMark = (v) => {
  if (v == null) return ''
  return String(v).trim().toUpperCase().replace(/\s+/g, '')
}

const normCode = (v) => {
  if (v == null) return ''
  return String(v)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9#+./-]/g, '')
}

const cleanStr = (v) => {
  if (v == null) return ''
  return String(v).replace(/^'+/, '').replace(/'+$/, '').trim()
}

const cleanMaterialDescription = (value) => {
  let s = cleanStr(value)
  if (!s) return ''

  // Vendor lines often append LF/UOM + unit price + amount at the end.
  // Example: "Wall Girt 42.9167 LF 3.0000 128.75"
  s = s.replace(
    /\s+\d+(?:\.\d+)?\s*(?:LF|FT|EA|LB|LOT)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*$/i,
    ''
  )
  s = s.replace(
    /\s+\d+(?:\.\d+)?\s*(?:LF|FT|EA|LB|LOT)\s+\d+(?:\.\d+)?\s*$/i,
    ''
  )

  return s.trim()
}

const toNum = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,%\s,]/g, '').trim())
  return Number.isFinite(n) ? n : null
}

const safe = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0)
const round = (n, d = 4) => Math.round(Number(n || 0) * 10 ** d) / 10 ** d
const fmtFt = (f) => (f == null ? 'n/a' : `${safe(f).toFixed(3)}ft`)
const uniq = (arr) => [...new Set((arr || []).filter((x) => x != null && x !== ''))]

const downloadBuffer = (url) =>
  new Promise((resolve, reject) => {
    const lib = String(url || '').startsWith('https') ? https : http
    lib
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          downloadBuffer(res.headers.location).then(resolve).catch(reject)
          return
        }
        if (res.statusCode >= 400) {
          reject(new Error(`Failed to download file: HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      .on('error', reject)
  })

/* =========================================================
 * Length normalization
 * Supports:
 *   6' 11.75''
 *   6' 11-3/4"
 *   15'11-12"    // sixteenths notation
 *   1-04"        // inch-sixteenths notation
 *   numeric strings as feet when no quote marks exist
 * ========================================================= */
const fractionishToNumber = (value) => {
  if (value == null || value === '') return null
  const s = String(value).trim()

  const mixedHyphen = s.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/)
  if (mixedHyphen) {
    return Number(mixedHyphen[1]) + Number(mixedHyphen[2]) / Number(mixedHyphen[3])
  }

  const mixedSpace = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixedSpace) {
    return Number(mixedSpace[1]) + Number(mixedSpace[2]) / Number(mixedSpace[3])
  }

  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])

  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const lengthToFeet = (value) => {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value

  let s = String(value)
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/''/g, '"')
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/\bFT\b/gi, "'")
    .replace(/\bIN\b/gi, '"')
    .trim()

  if (!s) return null

  // Pure numeric values in uploaded spreadsheets are normally feet.
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s)

  // MBS pattern: 15'11-12" where 12 means sixteenths.
  const mbs = s.match(/^(\d+)\s*'\s*(\d{1,2})-(\d{1,2})"?$/)
  if (mbs) {
    return Number(mbs[1]) + (Number(mbs[2]) + Number(mbs[3]) / 16) / 12
  }

  // Inch-sixteenths only: 6-00", 1-04".
  const mbsIn = s.match(/^(\d{1,2})-(\d{1,2})"$/)
  if (mbsIn) {
    return (Number(mbsIn[1]) + Number(mbsIn[2]) / 16) / 12
  }

  // Remove a wrapped trailing table value after the inch mark, if PDF text extraction appended it.
  s = s.replace(/("?)\s+\d+(?:\.\d+)?\s*$/, '$1').trim()

  let feet = 0
  let inches = 0
  let matched = false

  const feetMatch = s.match(/(\d+(?:\.\d+)?)\s*'/)
  if (feetMatch) {
    feet = Number(feetMatch[1])
    matched = true
    s = s.slice(feetMatch.index + feetMatch[0].length)
  }

  s = s.replace(/"/g, '').trim()

  if (s) {
    // Examples: 11.75, 11-3/4, 11 3/4, 3/4
    const inchNumber = fractionishToNumber(s)
    if (inchNumber != null) {
      inches += inchNumber
      matched = true
    } else {
      const anyNum = s.match(/\d+(?:\.\d+)?/)
      if (anyNum) {
        inches += Number(anyNum[0])
        matched = true
      }
    }
  }

  if (!matched) return null
  return feet + inches / 12
}

const lengthBucketInches = (feet) => {
  if (feet == null || !Number.isFinite(Number(feet))) return null
  const inches = Number(feet) * 12
  return Math.round(inches / LENGTH_TOLERANCE_INCH) * LENGTH_TOLERANCE_INCH
}

const lengthDiffInches = (aFeet, bFeet) => {
  if (aFeet == null || bFeet == null) return null
  return Math.abs(Number(aFeet) * 12 - Number(bFeet) * 12)
}

/* =========================================================
 * Canonical material normalization
 * Same schema is preserved by storing this under rawRow / expected / received.
 * ========================================================= */
const normalizeColor = (value) => {
  const s = String(value || '').toUpperCase()
  if (!s) return null
  if (/RED\s*OXIDE|\bRO\b|\bR\.O\.\b|\bPRIME,R\b|,R,|OXIDE/.test(s)) return 'RED_OXIDE'
  if (/GALV|GALVANIZED|\bG\b/.test(s)) return 'GALVANIZED'
  if (/WHITE|\bWH\b/.test(s)) return 'WHITE'
  if (/BLACK|\bBLK\b/.test(s)) return 'BLACK'
  return normCode(value) || null
}

const normalizeShape = (value) => {
  const s = String(value || '').toUpperCase()
  if (/\bCEE\b|\bCEES\b|\bC\s*PURLIN\b|\bC-PURLIN\b|\bPURLIN\b.*\bCEE\b/.test(s)) return 'CEE'
  if (/\bZEE\b|\bZEES\b|\bZ\s*PURLIN\b|\bZ-PURLIN\b/.test(s)) return 'ZEE'
  if (/CHANNEL/.test(s)) return 'CHANNEL'
  if (/ANGLE/.test(s)) return 'ANGLE'
  if (/TRIM|FLASHING/.test(s)) return 'TRIM'
  return null
}

const parseDimensionValue = (value) => {
  if (value == null) return null
  const cleaned = String(value).replace(/"/g, '').trim()
  return fractionishToNumber(cleaned)
}

const buildMaterialKey = ({ shape, gauge, depthInches, flangeInches, color }) => {
  if (!shape || !gauge || !depthInches || !flangeInches) return null
  return [
    shape,
    `${Number(gauge)}GA`,
    round(depthInches, 3),
    round(flangeInches, 3),
    color || 'UNKNOWN_COLOR',
  ].join('|')
}

const normalizeMaterial = ({ partCode, description, color, partColor }) => {
  const rawPartCode = cleanStr(partCode)
  const rawDescription = cleanStr(description)
  const combined = `${rawPartCode} ${rawDescription} ${color || ''} ${partColor || ''}`.toUpperCase()

  let shape = normalizeShape(combined)
  let gauge = null
  let depthInches = null
  let flangeInches = null
  let normalizedColor = normalizeColor(color || partColor || combined)
  const warnings = []

  const code = normCode(rawPartCode)

  // Central States style: C83516R = CEE, 8 deep, 3.5 flange, 16ga, Red Oxide.
  // Also supports Z82514R etc.
  const central = code.match(/^([CZ])(\d{1,2})(\d{2})(\d{2})([A-Z]*)$/)
  if (central) {
    shape = central[1] === 'C' ? 'CEE' : 'ZEE'
    depthInches = Number(central[2])
    flangeInches = Number(central[3]) / 10
    gauge = Number(central[4])
    if (!normalizedColor && central[5].includes('R')) normalizedColor = 'RED_OXIDE'
  }

  // Quicken style: PC16-RO-8X3.5, PC12-RO-8X2.5
  const quicken = code.match(/^(P?[CZ])?(\d{2})-?([A-Z]{1,3})?-?(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/)
  if (quicken) {
    if (!shape) shape = code.startsWith('PZ') || code.startsWith('Z') ? 'ZEE' : 'CEE'
    gauge = Number(quicken[2])
    if (!normalizedColor && quicken[3]) normalizedColor = normalizeColor(quicken[3])
    depthInches = Number(quicken[4])
    flangeInches = Number(quicken[5])
  }

  // Description fallback: 16Ga CEE Purlin Red Oxide 8 X 3-1/2"
  if (!gauge) {
    const gm = combined.match(/(\d{2})\s*GA\b|GAUGE\s*(\d{2})/)
    if (gm) gauge = Number(gm[1] || gm[2])
  }

  if (!depthInches || !flangeInches) {
    const dim = combined.match(/(\d+(?:\.\d+)?)\s*"?\s*X\s*(\d+(?:\.\d+)?|\d+\s*-\s*\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+)\s*"?/)
    if (dim) {
      depthInches = depthInches || Number(dim[1])
      flangeInches = flangeInches || parseDimensionValue(dim[2])
    }
  }

  const materialKey = buildMaterialKey({ shape, gauge, depthInches, flangeInches, color: normalizedColor })

  let confidence = 0.3
  if (materialKey) confidence = 0.95
  else if (shape || gauge || depthInches || flangeInches) confidence = 0.6
  else warnings.push('Unable to build canonical material key from part code/description')

  return {
    rawPartCode: rawPartCode || null,
    rawDescription,
    shape: shape || null,
    gauge: gauge || null,
    depthInches: depthInches || null,
    flangeInches: flangeInches || null,
    color: normalizedColor || null,
    materialKey,
    confidence,
    warnings,
  }
}

const materialCompatibility = (expectedMaterial, receivedMaterial) => {
  const e = expectedMaterial || {}
  const r = receivedMaterial || {}

  if (e.materialKey && r.materialKey && e.materialKey === r.materialKey) {
    return { compatible: true, confidence: 0.99, reason: 'Canonical material key matched.' }
  }

  const essentialFields = ['shape', 'gauge', 'depthInches', 'flangeInches']
  const bothHaveEssentials = essentialFields.every((k) => e[k] != null && r[k] != null)
  if (bothHaveEssentials) {
    const sameEssentials =
      e.shape === r.shape &&
      Number(e.gauge) === Number(r.gauge) &&
      Math.abs(Number(e.depthInches) - Number(r.depthInches)) < 0.01 &&
      Math.abs(Number(e.flangeInches) - Number(r.flangeInches)) < 0.01

    const colorCompatible = !e.color || !r.color || e.color === r.color

    if (sameEssentials && colorCompatible) {
      return { compatible: true, confidence: 0.93, reason: 'Canonical material dimensions matched.' }
    }

    return {
      compatible: false,
      confidence: 0.9,
      reason: `Material mismatch: expected ${e.materialKey || 'partial material'}, received ${r.materialKey || 'partial material'}.`,
    }
  }

  return {
    compatible: null,
    confidence: 0.55,
    reason: 'Material could not be fully verified from available part code/description.',
  }
}

/* =========================================================
 * Deterministic vendor PDF parsers
 * ========================================================= */
const detectVendorFormat = (text) => {
  const t = String(text || '').toUpperCase()
  if (t.includes('CENTRAL STATES') || /\bPIECES?\s*@/i.test(text) || t.includes('PART MARK:')) {
    return 'central_states'
  }
  if (t.includes('QUICKEN STEEL') || (t.includes('PIECE MARK:') && t.includes('SALES ORDER'))) {
    return 'quicken_steel'
  }
  return 'generic_material_pdf'
}

const parseCentralStates = (text) => {
  const lines = String(text).split('\n').map((l) => l.replace(/\r/g, ''))
  const items = []
  let cur = null
  let pageNumber = 1

  /**
   * Defensive mark recovery for PDF line-merge failures.
   *
   * Central States PDFs structure each item as ~6 lines:
   *   "1 C83516R Purlin,..."          <- head
   *   "28 Pieces @ 6' 11.75''"        <- pieces
   *   "Left Punch: PPEP"
   *   "Right Punch: PPEP"
   *   "Part Mark: DJ-1"               <- THIS line is the fragile one
   *   "195.4167 LF 3.0006 586.37"     <- totals
   *
   * If the PDF renderer collapses lines (e.g. "Right Punch: PPEP Part Mark: DJ-1"
   * or "Part Mark: DJ-1 195.4167 LF 3.0006 586.37"), the normal per-line regex
   * misses the mark. flush() now scans rawText as a fallback so no mark is lost.
   *
   * The rawText fallback uses a permissive regex that handles:
   *   - "Part Mark: DJ-1"            (normal)
   *   - "Part Mark:DJ-1"             (no space)
   *   - "PPEP Part Mark: DJ-1"       (merged with punch line)
   *   - "Part Mark: DJ-1 195.4167"   (merged with totals line)
   */
  const recoverMarkFromRawText = (rawText) => {
    const m = rawText.match(/Part\s+Mark\s*:\s*([A-Z0-9][A-Z0-9\-./]*)/i)
    return m ? m[1].trim() : null
  }

  const flush = () => {
    if (cur && (cur.mark || cur.pieceQty != null || cur.product)) {
      cur.rawText = (cur.rawParts || []).join('\n')
      delete cur.rawParts

      // Fallback: if pieceQty was parsed but mark was lost due to PDF line-merge,
      // scan rawText for "Part Mark: X" before giving up.
      if (!cur.mark && cur.pieceQty != null && cur.rawText) {
        const recovered = recoverMarkFromRawText(cur.rawText)
        if (recovered) {
          cur.mark = recovered
          cur.markRecovered = true // flag for debugging/audit
        }
      }

      items.push(cur)
    }
    cur = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const pageM = line.match(/^Page:\s*(\d+)\s+of\s+\d+/i)
    if (pageM) {
      pageNumber = Number(pageM[1])
      continue
    }

    if (/^Line\s+Product\s+Description/i.test(line)) continue

    // totals row can appear after Part Mark in extracted text.
    const totals = line.match(/^([\d,]+(?:\.\d+)?)\s+(LF|FT|EA|LB)\s+([\d.]+)\s+([\d,]+(?:\.\d{2})?)$/i)
    if (totals && cur) {
      cur.totalLinearFeet = Number(totals[1].replace(/,/g, ''))
      cur.uom = totals[2].toUpperCase() === 'FT' ? 'LF' : totals[2].toUpperCase()
      cur.unitPrice = Number(totals[3])
      cur.amount = Number(totals[4].replace(/,/g, ''))
      cur.rawParts.push(line)
      continue
    }

    // New item starts as: 1 C83516R Purlin,Prime,R,Cee,8,3.5,16
    const head = line.match(/^(\d+)\s+([A-Z0-9][A-Z0-9./-]{2,})\s+(.+)$/)
    if (head && !/^\d+\s+Pieces?\b/i.test(line)) {
      flush()
      cur = {
        lineNo: head[1],
        product: head[2],
        description: head[3].trim(),
        pageNumber,
        rawParts: [line],
      }
      continue
    }

    const pcs = line.match(/^([\d,]+)\s+Pieces?\s*@\s*(.+)$/i)
    if (pcs && cur) {
      cur.pieceQty = Number(pcs[1].replace(/,/g, ''))
      cur.lengthText = pcs[2].trim()
      cur.lengthFeet = lengthToFeet(cur.lengthText)
      cur.rawParts.push(line)
      continue
    }

    const lp = line.match(/^Left Punch:\s*(.*)$/i)
    if (lp && cur) {
      cur.leftPunch = lp[1].trim()
      cur.rawParts.push(line)

      // Inline mark-merge recovery: "Left Punch: PPEP Part Mark: DJ-1"
      if (!cur.mark) {
        const inlineM = lp[1].match(/Part\s+Mark\s*:\s*([A-Z0-9][A-Z0-9\-./]*)/i)
        if (inlineM) cur.mark = inlineM[1].trim()
      }
      continue
    }

    const rp = line.match(/^Right Punch:\s*(.*)$/i)
    if (rp && cur) {
      cur.rightPunch = rp[1].trim()
      cur.rawParts.push(line)

      // Inline mark-merge recovery: "Right Punch: PPEP Part Mark: DJ-1"
      if (!cur.mark) {
        const inlineM = rp[1].match(/Part\s+Mark\s*:\s*([A-Z0-9][A-Z0-9\-./]*)/i)
        if (inlineM) cur.mark = inlineM[1].trim()
      }
      continue
    }

    const mk = line.match(/^Part Mark:\s*(.+)$/i)
    if (mk && cur) {
      // Strip trailing numeric junk if mark was merged with the totals line:
      // "DJ-1 195.4167 LF 3.0006 586.37" -> "DJ-1"
      const raw_mark = mk[1].trim()
      cur.mark = raw_mark.split(/\s+/)[0]
      cur.rawParts.push(line)
      continue
    }

    // Description continuation: append to description only before pieces are set.
    // Always push to rawParts so the rawText fallback in flush() can scan every
    // line, including ones that appeared after pieceQty (e.g. a mark buried in
    // a stray continuation line due to PDF table collapse).
    if (cur && !/^Total\b/i.test(line)) {
      if (!cur.pieceQty) {
        cur.description = `${cur.description} ${line}`.trim()
      }
      cur.rawParts.push(line)
    }
  }

  flush()
  return { items, format: 'central_states' }
}

const parseQuicken = (text) => {
  const lines = String(text).split('\n').map((l) => l.replace(/\r/g, ''))
  const items = []
  let cur = null
  let pageNumber = 1

  const flush = () => {
    if (cur && (cur.mark || cur.pieceQty != null || cur.product)) {
      cur.rawText = (cur.rawParts || []).join('\n')
      delete cur.rawParts
      items.push(cur)
    }
    cur = null
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const pageM = line.match(/Page\s+Number:\s*(\d+)/i) || line.match(/Page\s+(\d+)\s+of\s+\d+/i)
    if (pageM) pageNumber = Number(pageM[1])

    if (/^(Line\s+Item\s+Description|QUICKEN STEEL|SOLD TO|SHIP TO|Print Date|Document Ref)/i.test(line)) continue

    /**
     * Extracted text order in the sample Quicken PDF:
     * 1 16Ga CEE Purlin Red Oxide 8 X 3-1/2" $2.53 / FT 28 $494.48 PC16-RO-8X3.5 6' 11-3/4" 621
     */
    const row = line.match(
      /^(\d+)\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s*\/\s*([A-Z]+)\s+([\d,]+(?:\.\d+)?)\s+\$([\d,]+(?:\.\d{2})?)\s+([A-Z0-9][A-Z0-9./-]+)\s+(.+?)\s+([\d,]+(?:\.\d+)?)$/i
    )

    if (row) {
      flush()
      cur = {
        lineNo: row[1],
        description: cleanStr(row[2]),
        unitPrice: Number(row[3].replace(/,/g, '')),
        priceUnit: row[4].toUpperCase(),
        pieceQty: Number(row[5].replace(/,/g, '')),
        amount: Number(row[6].replace(/,/g, '')),
        product: row[7],
        lengthText: cleanStr(row[8]),
        lengthFeet: lengthToFeet(row[8]),
        weight: Number(row[9].replace(/,/g, '')),
        pageNumber,
        rawParts: [line],
      }
      continue
    }

    const punch = line.match(/^Punch:\s*(.+)$/i)
    if (punch && cur) {
      cur.punchInfo = punch[1].trim()
      cur.rawParts.push(line)
      continue
    }

    const mk = line.match(/^Piece Mark:\s*(.+)$/i)
    if (mk && cur) {
      cur.mark = mk[1].trim()
      cur.rawParts.push(line)
      continue
    }
  }

  flush()
  return { items, format: 'quicken_steel' }
}

/* =========================================================
 * LLM fallback for unknown / broken PDF text layouts
 * ========================================================= */
const extractPdfText = async (buffer) => {
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text || ''
  } finally {
    await parser.destroy()
  }
}

const safeJsonParseFromText = (raw) => {
  const text = String(raw || '').replace(/```json|```/g, '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('AI extraction returned no JSON object')
  return JSON.parse(match[0])
}

const extractPdfWithLlm = async (text) => {
  const client = getAnthropicClient()

  const prompt = `Extract vendor material line items from this quote PDF text.
Return STRICT JSON only. No markdown. No commentary.

Schema:
{
  "lines": [
    {
      "lineNo": "1",
      "pieceQty": 10,
      "product": "PC16-RO-8X3.5",
      "description": "16Ga CEE Purlin Red Oxide 8 X 3-1/2",
      "color": "Red Oxide",
      "lengthText": "15' 11-3/4\"",
      "totalLinearFeet": 159.79,
      "uom": "LF",
      "unitPrice": 2.53,
      "priceUnit": "FT",
      "amount": 404.25,
      "weight": 621,
      "pieceMark": "DJ-1",
      "leftPunch": "CUSTOM",
      "rightPunch": "PPEP",
      "punchInfo": "Custom Punch",
      "pageNumber": 1,
      "rawText": "original row text here"
    }
  ]
}

Rules:
- Extract actual material rows only.
- Skip cover pages, signatures, summaries, totals, tax, freight, notes, terms, headers and footers.
- pieceQty = physical piece count, not LF quantity.
- lengthText = per-piece length, preserve original notation.
- product = vendor product/part/item code when present.
- Attach Piece Mark / Part Mark continuation lines to the material row above.
- If unsure about a row, include it with low confidence fields missing rather than inventing values.
- Do not compare against BOM. Extraction only.

PDF text:
${String(text || '').slice(0, 120000)}`

  const response = await client.messages.create({
    model: DEFAULT_SONNET_MODEL,
    max_tokens: 16000,
    temperature: 0,
    system: 'You extract steel vendor quote material rows into strict JSON. You never compare, summarize, or invent values.',
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content?.[0]?.text || ''
  const parsed = safeJsonParseFromText(raw)

  const items = (parsed.lines || []).map((l, idx) => ({
    lineNo: l.lineNo != null ? String(l.lineNo) : String(idx + 1),
    product: cleanStr(l.product) || null,
    description: cleanStr(l.description),
    color: cleanStr(l.color) || null,
    pieceQty: toNum(l.pieceQty),
    lengthText: cleanStr(l.lengthText) || null,
    lengthFeet: lengthToFeet(l.lengthText),
    totalLinearFeet: toNum(l.totalLinearFeet),
    uom: cleanStr(l.uom) || null,
    unitPrice: toNum(l.unitPrice),
    priceUnit: cleanStr(l.priceUnit) || 'UNKNOWN',
    amount: toNum(l.amount),
    weight: toNum(l.weight),
    mark: cleanStr(l.pieceMark),
    leftPunch: cleanStr(l.leftPunch),
    rightPunch: cleanStr(l.rightPunch),
    punchInfo: cleanStr(l.punchInfo),
    pageNumber: toNum(l.pageNumber),
    rawText: cleanStr(l.rawText),
    warnings: l.warnings || [],
  }))

  return { items, format: 'generic_material_pdf' }
}

/* =========================================================
 * Excel / CSV header-mapped parser
 * ========================================================= */
const col = (headers, aliases) => headers.findIndex((h) => aliases.includes(h))

const parseTabular = (rows) => {
  if (!rows.length) return []
  const headerIdx = rows.findIndex((row) => {
    const n = (row || []).map(normCode)
    const hasQty = n.includes('QTY') || n.includes('QUANTITY') || n.includes('PIECES') || n.includes('PIECEQTY')
    const hasMark = n.includes('MARK') || n.includes('PIECEMARK') || n.includes('PARTMARK') || n.includes('MARKID')
    const hasDesc = n.includes('DESCRIPTION') || n.includes('DESC') || n.includes('ITEMDESCRIPTION')
    return hasQty && (hasMark || hasDesc)
  })
  if (headerIdx < 0) return []

  const headers = (rows[headerIdx] || []).map(normCode)
  const iQty = col(headers, ['QTY', 'QUANTITY', 'PIECES', 'PIECEQTY'])
  const iMark = col(headers, ['MARK', 'PIECEMARK', 'PARTMARK', 'MARKID'])
  const iPart = col(headers, ['PART', 'PARTCODE', 'ITEM', 'PRODUCT', 'PRODUCTCODE', 'ITEMCODE'])
  const iColor = col(headers, ['COLOR', 'COLOUR', 'CLR', 'FINISH'])
  const iLen = col(headers, ['LENGTH', 'LEN', 'PIECELENGTH', 'CUTLENGTH'])
  const iWeight = col(headers, ['WEIGHT', 'WT'])
  const iDesc = col(headers, ['DESCRIPTION', 'DESC', 'ITEMDESCRIPTION'])
  const iAmount = col(headers, ['AMOUNT', 'TOTAL', 'TOTALCOST'])
  const iUnitPrice = col(headers, ['UNITPRICE', 'UNITCOST', 'PRICE'])

  const out = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const joined = row.map((c) => cleanStr(c)).join(' ').toLowerCase()
    if (!joined.trim() || joined.startsWith('total') || joined.includes('subtotal')) continue

    const lengthText = iLen >= 0 ? cleanStr(row[iLen]) : ''
    out.push({
      lineNo: String(i + 1),
      pieceQty: iQty >= 0 ? toNum(row[iQty]) : null,
      mark: iMark >= 0 ? cleanStr(row[iMark]) : '',
      product: iPart >= 0 ? cleanStr(row[iPart]) : null,
      color: iColor >= 0 ? cleanStr(row[iColor]) : null,
      description: iDesc >= 0 ? cleanStr(row[iDesc]) : '',
      lengthText: lengthText || null,
      lengthFeet: lengthToFeet(lengthText),
      weight: iWeight >= 0 ? toNum(row[iWeight]) : null,
      amount: iAmount >= 0 ? toNum(row[iAmount]) : null,
      unitPrice: iUnitPrice >= 0 ? toNum(row[iUnitPrice]) : null,
      rawRow: row,
    })
  }
  return out
}

/* =========================================================
 * Unified vendor extraction
 * ========================================================= */
const extractVendorItems = async ({ fileUrl, fileName }) => {
  const ext = String(fileName || '').split('.').pop().toLowerCase()
  const buffer = await downloadBuffer(fileUrl)

  if (['xlsx', 'xls', 'ods'].includes(ext)) {
    const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
    const items = []
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false })
      items.push(...parseTabular(rows))
    }
    return { items, format: 'excel', extractionMethod: 'excel' }
  }

  if (ext === 'csv') {
    const records = parseCsv(buffer.toString('utf8'), { relax_column_count: true, skip_empty_lines: true })
    return { items: parseTabular(records), format: 'csv', extractionMethod: 'csv' }
  }

  if (ext === 'pdf') {
    const text = await extractPdfText(buffer)
    if (!text.trim()) throw new Error('Unable to extract text from PDF')

    const fmt = detectVendorFormat(text)

    if (fmt === 'central_states') {
      const parsed = parseCentralStates(text)
      if (parsed.items.length) return { ...parsed, extractionMethod: 'pdf_text' }
    }

    if (fmt === 'quicken_steel') {
      const parsed = parseQuicken(text)
      if (parsed.items.length) return { ...parsed, extractionMethod: 'pdf_text' }
    }

    // Unknown or parser failed. Sonnet extracts; backend still compares deterministically.
    return { ...(await extractPdfWithLlm(text)), extractionMethod: 'claude' }
  }

  throw new Error('Unsupported vendor quote file type')
}

/* =========================================================
 * Persistence mapping: vendor item -> VendorQuoteLine doc
 * Schema unchanged. Canonical material goes into rawRow.
 * ========================================================= */
const toVendorQuoteLineDoc = (item, request, format, extractionMethod) => {
  const cleanedDescriptionForMaterial = cleanMaterialDescription(item.description)
  const material = normalizeMaterial({
    partCode: item.product,
    description: cleanedDescriptionForMaterial,
    color: item.color,
  })

  const warnings = uniq([...(item.warnings || []), ...(material.warnings || [])])

  return {
    shipperRequestId: request._id,
    leadId: request.leadId,
    consolidatedBOMId: request.consolidatedBOMId,
    vendorId: request.vendorId,

    pageNumber: item.pageNumber ?? null,
    rowNumber: toNum(item.lineNo),
    vendorLineNo: item.lineNo || '',

    qty: item.pieceQty ?? null,
    pieceQty: item.pieceQty ?? null,
    totalLinearFeet: item.totalLinearFeet ?? null,
    uom: item.uom || null,

    partCode: item.product || null,
    partCodeNormalized: normCode(item.product) || null,
    vendorProductCode: item.product || null,
    vendorProductCodeNormalized: normCode(item.product) || null,

    description: item.description || '',

    pieceMark: item.mark || '',
    pieceMarkNormalized: normMark(item.mark),

    color: item.color || material.color || null,
    colorNormalized: normCode(item.color || material.color) || null,

    lengthText: item.lengthText || null,
    lengthFeet: item.lengthFeet ?? null,

    weight: item.weight ?? null,

    unitPrice: item.unitPrice ?? null,
    priceUnit: ['EA', 'FT', 'LF', 'LB', 'LOT'].includes(String(item.priceUnit || '').toUpperCase())
      ? String(item.priceUnit).toUpperCase()
      : 'UNKNOWN',
    amount: item.amount ?? null,

    punchInfo: item.punchInfo || '',
    leftPunch: item.leftPunch || '',
    rightPunch: item.rightPunch || '',

    extractionMethod: extractionMethod || 'hybrid',
    extractionFormat: format || 'generic_material_pdf',
    extractionConfidence: material.confidence ?? null,

    warnings,
    rawText: item.rawText || '',
    rawRow: {
      original: item.rawRow || item,
      canonicalMaterial: material,
      lengthBucketInches: lengthBucketInches(item.lengthFeet),
    },
  }
}

/* =========================================================
 * Expected side normalization from ConsolidatedBOM.items
 * Important: totalLengthFeet is normally aggregate LF.
 * For comparison we need piece length, so use totalLengthFeet / totalQty
 * unless an explicit piece/cut length exists.
 * ========================================================= */
const firstDefined = (...values) => values.find((v) => v != null && v !== '')

const expectedPieceLengthFeet = (item) => {
  const explicit = firstDefined(
    item.pieceLengthFeet,
    item.lengthFeet,
    item.cutLengthFeet,
    item.unitLengthFeet,
    item.length
  )
  if (explicit != null) return lengthToFeet(explicit)

  const lengthText = firstDefined(item.lengthText, item.cutLengthText, item.sizeLength)
  if (lengthText != null) return lengthToFeet(lengthText)

  const totalLengthFeet = toNum(item.totalLengthFeet)
  const totalQty = toNum(item.totalQty)

  if (totalLengthFeet != null && totalQty != null && totalQty > 0) {
    // totalLengthFeet = qty * pieceLength for Central/Quicken style materials.
    return totalLengthFeet / totalQty
  }

  return totalLengthFeet
}


const splitMarkList = (value) => {
  if (Array.isArray(value)) {
    return uniq(value.flatMap((v) => splitMarkList(v)))
  }

  const s = cleanStr(value)
  if (!s || ['-', 'NA', 'N/A', 'NULL', 'NONE'].includes(s.toUpperCase())) return []

  return uniq(
    s
      .split(',')
      .map((m) => cleanStr(m))
      .filter(Boolean)
  )
}

const effectiveMarkForKey = (mark) => {
  const m = normMark(mark)
  if (!m || m === '_' || m === '0' || m === 'NA' || m === 'N/A') return ''
  return m
}

const anonymousMaterialKey = (row, material) => {
  return (
    material?.materialKey ||
    normCode(row.partCode || row.product || row.vendorProductCode) ||
    normCode(row.description) ||
    '_'
  )
}

/**
 * Mirrors consolidatedBom.service groupItemsForShipper(), but returns comparable
 * rows for the comparison engine. This is important because the Excel shipper
 * file is generated from BOMItem grouping, while ConsolidatedBOM.items is a
 * priced summary grouping. Comparing vendor quote against the priced summary
 * creates false qty mismatches.
 */
const normalizeExpectedFromBomItemsForShipper = (bomItems) => {
  const groups = new Map()

  for (const item of bomItems || []) {
    const pieceLengthFeet = item.lengthFeet != null ? Number(item.lengthFeet) : lengthToFeet(item.lengthRaw)
    if (pieceLengthFeet == null || !Number.isFinite(pieceLengthFeet)) continue

    const identity =
      item.partCodeNormalized ||
      normCode(item.partCode) ||
      `DESC:${normCode(item.description)}`

    const colorKey = item.partColorNormalized || normCode(item.partColor) || '_'
    const lengthKey = Number(pieceLengthFeet).toFixed(4)
    const key = [identity || '_', colorKey, lengthKey].join('|')

    if (!groups.has(key)) {
      groups.set(key, {
        _ids: [],
        partCode: item.partCode || null,
        partColor: item.partColor || null,
        description: item.description || '',
        category: item.category || '',
        lengthFeet: pieceLengthFeet,
        totalQty: 0,
        totalWeight: 0,
        marks: new Set(),
        material: normalizeMaterial({
          partCode: item.partCode,
          description: item.description,
          color: item.partColor,
          partColor: item.partColor,
        }),
        sourceLineCount: 0,
      })
    }

    const group = groups.get(key)
    group.totalQty += safe(item.quantity)
    group.totalWeight += safe(item.weight)
    group.sourceLineCount += 1
    if (item._id) group._ids.push(item._id)

    const marks = splitMarkList(item.markId)
    for (const mark of marks) group.marks.add(mark)
  }

  const rows = []
  for (const group of groups.values()) {
    const marks = [...group.marks]

    // Match the generated shipper quote style: when a shipper row lists several
    // marks, each mark can appear as a separate quote line carrying the row qty.
    // This is demo-safe and consistent with the PDF test quote generated from
    // the consolidated workbook.
    if (marks.length) {
      for (const mark of marks) {
        rows.push({
          _id: group._ids[0] || null,
          bomItemIds: group._ids,
          markId: mark,
          partCode: group.partCode,
          partColor: group.partColor,
          description: group.description,
          category: group.category,
          lengthFeet: group.lengthFeet,
          totalQty: group.totalQty,
          totalWeight: group.totalWeight,
          material: group.material,
          sourceLineCount: group.sourceLineCount,
          qtyShared: false,
          expectedSource: 'bom_items_shipper_group',
        })
      }
    } else {
      rows.push({
        _id: group._ids[0] || null,
        bomItemIds: group._ids,
        markId: '_',
        partCode: group.partCode,
        partColor: group.partColor,
        description: group.description,
        category: group.category,
        lengthFeet: group.lengthFeet,
        totalQty: group.totalQty,
        totalWeight: group.totalWeight,
        material: group.material,
        sourceLineCount: group.sourceLineCount,
        qtyShared: false,
        expectedSource: 'bom_items_shipper_group',
      })
    }
  }

  return rows
}

const buildExpectedRowsForComparison = async (consolidatedBOM) => {
  const bomItemIds = uniq(
    (consolidatedBOM.items || [])
      .flatMap((item) => item.bomItemIds || [])
      .map((id) => String(id))
  )

  if (bomItemIds.length) {
    const bomItems = await BOMItem.find({ _id: { $in: bomItemIds } }).lean()
    if (bomItems.length) {
      return {
        rows: normalizeExpectedFromBomItemsForShipper(bomItems),
        meta: {
          expectedSource: 'bom_items_shipper_group',
          bomItemIdsFound: bomItemIds.length,
          bomItemsLoaded: bomItems.length,
        },
      }
    }
  }

  // Fallback for older records where bomItemIds were not saved.
  return {
    rows: normalizeExpected(consolidatedBOM.items || []),
    meta: {
      expectedSource: 'consolidated_items_fallback',
      bomItemIdsFound: bomItemIds.length,
      bomItemsLoaded: 0,
    },
  }
}

const normalizeExpected = (items) => {
  const rows = []

  for (const item of items || []) {
    const marks = splitMarkList(item.markIds)
    const totalQty = Number(item.totalQty || 0)
    const lengthFeet = expectedPieceLengthFeet(item)
    const material = normalizeMaterial({
      partCode: item.partCode,
      description: item.description,
      color: item.color,
      partColor: item.partColor,
    })

    const base = {
      _id: item._id,
      partCode: item.partCode || null,
      partColor: item.partColor || null,
      description: item.description || '',
      category: item.category || '',
      lengthFeet,
      totalQty,
      totalLengthFeet: toNum(item.totalLengthFeet),
      material,
      sourceLineCount: item.sourceLineCount || 0,
    }

    if (marks.length <= 1) {
      rows.push({ ...base, markId: marks[0] || null, qtyShared: false })
      continue
    }

    // Same schema cannot safely know qty-per-mark if multiple marks are merged.
    // Keep rows comparable by mark+length, but treat qty mismatch as ambiguous.
    for (const mark of marks) {
      rows.push({
        ...base,
        markId: mark,
        qtyShared: true,
        sharedMarkCount: marks.length,
      })
    }
  }

  return rows
}

/* =========================================================
 * Matching helpers
 * ========================================================= */
const keyOf = (mark, feet, anonKey = '_') => {
  const m = effectiveMarkForKey(mark)
  const identity = m || `_${anonKey || '_'}`
  return `${identity}|${lengthBucketInches(feet) ?? '_'}`
}

const groupSide = (rows, { mark, len, qty, id, materialGetter }) => {
  const map = new Map()

  for (const r of rows) {
    const material = materialGetter ? materialGetter(r) : r.material || null
    const anonKey = anonymousMaterialKey(r, material)
    const k = keyOf(r[mark], r[len], anonKey)
    const normalizedMark = effectiveMarkForKey(r[mark])
    if (!map.has(k)) {
      map.set(k, {
        key: k,
        mark: r[mark] || '',
        markNormalized: normalizedMark,
        lengthFeet: r[len] ?? null,
        lengthBucketInches: lengthBucketInches(r[len]),
        totalQty: 0,
        ids: [],
        partCodes: new Set(),
        descriptions: new Set(),
        materials: [],
        sampleDescription: r.description || '',
        samplePartCode: r.partCode || r.product || '',
        sourceLineCount: 0,
        qtyShared: Boolean(r.qtyShared),
      })
      if (material) map.get(k).materials.push(material)
    }

    const g = map.get(k)
    g.totalQty += Number(r[qty] || 0)
    if (r[id] != null) g.ids.push(r[id])

    const pc = normCode(r.partCode || r.product)
    if (pc) g.partCodes.add(pc)
    if (r.description) g.descriptions.add(r.description)
    if (r.material) g.materials.push(r.material)
    if (r.rawRow?.canonicalMaterial) g.materials.push(r.rawRow.canonicalMaterial)
    if (r.qtyShared) g.qtyShared = true
    g.sourceLineCount += 1
  }

  return map
}

const representativeMaterial = (materials) => {
  const clean = (materials || []).filter(Boolean)
  if (!clean.length) return null

  const withKey = clean.find((m) => m.materialKey)
  if (withKey) return withKey

  return clean.sort((a, b) => safe(b.confidence) - safe(a.confidence))[0]
}

const snap = (g) => ({
  mark: g.mark,
  lengthFeet: g.lengthFeet,
  lengthBucketInches: g.lengthBucketInches,
  totalQty: g.totalQty,
  partCodes: [...g.partCodes],
  partCode: g.samplePartCode,
  description: g.sampleDescription,
  material: representativeMaterial(g.materials),
  sourceLineCount: g.sourceLineCount,
  qtyShared: g.qtyShared,
})

const buildResult = (request, extra) => ({
  shipperRequestId: request._id,
  leadId: request.leadId,
  consolidatedBOMId: request.consolidatedBOMId,
  vendorId: request.vendorId,
  ...extra,
})

const frameMarkKey = (mark) => {
  const normalized = normMark(mark).replace(/[^A-Z0-9]/g, '')
  if (!normalized) return null
  if (!/^(RF|EW)/.test(normalized)) return null
  return normalized
}

const findReceivedMatch = (exp, receivedMap, used) => {
  const exact = receivedMap.get(exp.key)
  if (exact && !used.has(exact.key)) {
    return { type: 'exact', group: exact }
  }

  const sameMark = [...receivedMap.values()].filter(
    (r) => !used.has(r.key) && r.markNormalized && r.markNormalized === exp.markNormalized
  )

  if (!sameMark.length) {
    // Frame/no-part-code fallback:
    // match only when RF/EW mark canonical forms are equal and length is within tolerance.
    const expHasPartCode = Boolean(exp.samplePartCode && normCode(exp.samplePartCode))
    const expFrameKey = !expHasPartCode ? frameMarkKey(exp.mark) : null

    if (expFrameKey) {
      const frameCandidates = [...receivedMap.values()].filter(
        (r) => !used.has(r.key) && frameMarkKey(r.mark) === expFrameKey
      )

      const frameWithinTolerance = frameCandidates
        .map((r) => ({ group: r, diff: lengthDiffInches(exp.lengthFeet, r.lengthFeet) }))
        .filter((x) => x.diff != null && x.diff <= LENGTH_TOLERANCE_INCH)
        .sort((a, b) => a.diff - b.diff)

      if (frameWithinTolerance.length) {
        return {
          type: 'frame_mark_within_tolerance',
          group: frameWithinTolerance[0].group,
          diffInches: frameWithinTolerance[0].diff,
        }
      }
    }

    return { type: 'none', group: null }
  }

  const withinTolerance = sameMark
    .map((r) => ({ group: r, diff: lengthDiffInches(exp.lengthFeet, r.lengthFeet) }))
    .filter((x) => x.diff != null && x.diff <= LENGTH_TOLERANCE_INCH)
    .sort((a, b) => a.diff - b.diff)

  if (withinTolerance.length) {
    return { type: 'within_tolerance', group: withinTolerance[0].group, diffInches: withinTolerance[0].diff }
  }

  const nearest = sameMark
    .map((r) => ({ group: r, diff: lengthDiffInches(exp.lengthFeet, r.lengthFeet) }))
    .sort((a, b) => safe(a.diff) - safe(b.diff))[0]

  return { type: 'same_mark_length_mismatch', group: nearest?.group || sameMark[0], diffInches: nearest?.diff ?? null }
}

/* =========================================================
 * Comparison engine
 * No AI final judgement. Deterministic only.
 * ========================================================= */
const compareMaterials = (expectedRows, receivedRows, request) => {
  const expected = groupSide(expectedRows, {
    mark: 'markId',
    len: 'lengthFeet',
    qty: 'totalQty',
    id: '_id',
    materialGetter: (r) => r.material,
  })

  const received = groupSide(receivedRows, {
    mark: 'pieceMark',
    len: 'lengthFeet',
    qty: 'pieceQty',
    id: '_id',
    materialGetter: (r) => r.rawRow?.canonicalMaterial,
  })

  const results = []
  const exceptions = []
  const used = new Set()

  for (const exp of expected.values()) {
    const match = findReceivedMatch(exp, received, used)
    const rec = match.group

    if (!rec) {
      const reason = `Expected mark ${exp.mark || 'n/a'} (${fmtFt(exp.lengthFeet)}) not found in vendor quote.`
      results.push(buildResult(request, {
        consolidatedItemId: exp.ids[0] || null,
        vendorQuoteLineIds: [],
        vendorQuoteLineId: null,
        status: 'missing_in_vendor_quote',
        severity: 'critical',
        matchMethod: 'none',
        matchConfidence: 0,
        reason,
        expected: snap(exp),
        received: null,
        difference: { qtyDiff: -exp.totalQty },
      }))
      exceptions.push({ issueType: 'missing', severity: 'critical', reason, mark: exp.mark })
      continue
    }

    used.add(rec.key)

    if (match.type === 'same_mark_length_mismatch') {
      const reason = `Mark ${exp.mark} found but length differs: expected ${fmtFt(exp.lengthFeet)}, vendor ${fmtFt(rec.lengthFeet)}.`
      results.push(buildResult(request, {
        consolidatedItemId: exp.ids[0] || null,
        vendorQuoteLineIds: rec.ids,
        vendorQuoteLineId: rec.ids[0] || null,
        status: 'length_mismatch',
        severity: 'high',
        matchMethod: 'piece_mark',
        matchConfidence: 0.7,
        reason,
        expected: snap(exp),
        received: snap(rec),
        difference: {
          lengthDiffFeet: round(safe(rec.lengthFeet) - safe(exp.lengthFeet)),
          lengthDiffInches: match.diffInches == null ? null : round(match.diffInches, 3),
        },
      }))
      exceptions.push({ issueType: 'length_mismatch', severity: 'high', reason, mark: exp.mark })
      continue
    }

    const expMat = representativeMaterial(exp.materials)
    const recMat = representativeMaterial(rec.materials)
    let matCheck = materialCompatibility(expMat, recMat)
    const qtyDiff = rec.totalQty - exp.totalQty

    const expectedPartCodes = [...exp.partCodes].filter(Boolean)
    const receivedPartCodes = [...rec.partCodes].filter(Boolean)
    const sameNormalizedPartCode =
      expectedPartCodes.length > 0 &&
      receivedPartCodes.length > 0 &&
      expectedPartCodes.some((code) => receivedPartCodes.includes(code))

    // If normalized part codes are already equal, do not fail as part mismatch.
    if (sameNormalizedPartCode && matCheck.compatible === false) {
      matCheck = {
        compatible: true,
        confidence: Math.max(0.9, Number(matCheck.confidence || 0)),
        reason: 'Normalized part codes match; treating material as compatible.',
      }
    }

    if (qtyDiff !== 0 && (exp.qtyShared || rec.qtyShared)) {
      const reason = `Mark ${exp.mark} matched, but BOM quantity is shared across multiple marks; per-mark quantity cannot be verified automatically (BOM total ${exp.totalQty}, vendor ${rec.totalQty}). Manual review required.`
      results.push(buildResult(request, {
        consolidatedItemId: exp.ids[0] || null,
        vendorQuoteLineIds: rec.ids,
        vendorQuoteLineId: rec.ids[0] || null,
        status: 'ambiguous_match',
        severity: 'medium',
        matchMethod: 'piece_mark',
        matchConfidence: 0.6,
        reason,
        expected: snap(exp),
        received: snap(rec),
        difference: { qtyDiff, qtyShared: true, materialCheck: matCheck },
      }))
      exceptions.push({ issueType: 'ambiguous', severity: 'medium', reason, mark: exp.mark })
      continue
    }

    if (qtyDiff !== 0) {
      const dir = qtyDiff < 0 ? 'short' : 'over'
      const reason = `Quantity ${dir}: expected ${exp.totalQty}, vendor quoted ${rec.totalQty} (${dir === 'short' ? '' : '+'}${qtyDiff}).`
      results.push(buildResult(request, {
        consolidatedItemId: exp.ids[0] || null,
        vendorQuoteLineIds: rec.ids,
        vendorQuoteLineId: rec.ids[0] || null,
        status: 'qty_mismatch',
        severity: 'critical',
        matchMethod: 'piece_mark',
        matchConfidence: 0.97,
        reason,
        expected: snap(exp),
        received: snap(rec),
        difference: { qtyDiff, direction: dir, materialCheck: matCheck },
      }))
      exceptions.push({ issueType: 'qty_mismatch', severity: 'critical', reason, mark: exp.mark, direction: dir })
      continue
    }

    if (matCheck.compatible === false) {
      const reason = `${matCheck.reason} Mark and length matched, qty matched, but material is not equivalent.`
      results.push(buildResult(request, {
        consolidatedItemId: exp.ids[0] || null,
        vendorQuoteLineIds: rec.ids,
        vendorQuoteLineId: rec.ids[0] || null,
        status: 'part_mismatch',
        severity: 'high',
        matchMethod: 'piece_mark',
        matchConfidence: 0.75,
        reason,
        expected: snap(exp),
        received: snap(rec),
        difference: { qtyDiff: 0, materialCheck: matCheck },
      }))
      exceptions.push({ issueType: 'part_mismatch', severity: 'high', reason, mark: exp.mark })
      continue
    }

    const materialNote = matCheck.compatible === true ? matCheck.reason : matCheck.reason
    const confidence = matCheck.compatible === true ? 0.99 : 0.92
    const reason = `Matched on piece mark, length and quantity. ${materialNote}`

    results.push(buildResult(request, {
      consolidatedItemId: exp.ids[0] || null,
      vendorQuoteLineIds: rec.ids,
      vendorQuoteLineId: rec.ids[0] || null,
      status: 'matched',
      severity: 'low',
      matchMethod: 'piece_mark',
      matchConfidence: confidence,
      reason,
      expected: snap(exp),
      received: snap(rec),
      difference: {
        qtyDiff: 0,
        lengthDiffFeet: round(safe(rec.lengthFeet) - safe(exp.lengthFeet)),
        lengthDiffInches: lengthDiffInches(exp.lengthFeet, rec.lengthFeet),
        materialCheck: matCheck,
      },
    }))
  }

  for (const rec of received.values()) {
    if (used.has(rec.key)) continue

    const reason = `Vendor quoted mark ${rec.mark || 'n/a'} (${fmtFt(rec.lengthFeet)}) not present in Consolidated BOM.`
    results.push(buildResult(request, {
      consolidatedItemId: null,
      vendorQuoteLineIds: rec.ids,
      vendorQuoteLineId: rec.ids[0] || null,
      status: 'extra_in_vendor_quote',
      severity: 'medium',
      matchMethod: 'none',
      matchConfidence: 0,
      reason,
      expected: null,
      received: snap(rec),
      difference: { qtyDiff: rec.totalQty },
    }))
    exceptions.push({ issueType: 'extra', severity: 'medium', reason, mark: rec.mark })
  }

  const count = (status) => results.filter((r) => r.status === status).length

  const summary = {
    expectedLines: expected.size,
    vendorLines: received.size,
    matchedLines: count('matched'),
    missingItems: count('missing_in_vendor_quote'),
    extraItems: count('extra_in_vendor_quote'),
    qtyMismatches: count('qty_mismatch'),
    lengthMismatches: count('length_mismatch'),
    weightMismatches: 0,
    priceMismatches: 0,
    partMismatches: count('part_mismatch'),
    ambiguousMatches: count('ambiguous_match'),
    manualReviewRequired: results.filter((r) =>
      ['ambiguous_match', 'missing_in_vendor_quote', 'extra_in_vendor_quote', 'part_mismatch', 'length_mismatch', 'qty_mismatch'].includes(r.status)
    ).length,
    extractionNote: `${SERVICE_VERSION}: compared against BOMItem shipper-style grouping, not priced ConsolidatedBOM item summary.`,
  }

  return { results, summary, exceptions }
}

/* =========================================================
 * Public: run one comparison
 * ========================================================= */
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

    const { items: vendorItems, format, extractionMethod } = await extractVendorItems({
      fileUrl: request.submittedFileUrl,
      fileName: request.submittedFileName,
    })

    if (!vendorItems.length) {
      throw new Error('No vendor line items could be extracted from the submitted file')
    }

    await VendorQuoteLine.deleteMany({ shipperRequestId: request._id })
    await QuoteComparisonResult.deleteMany({ shipperRequestId: request._id })

    const vendorDocs = await VendorQuoteLine.insertMany(
      vendorItems.map((it) => toVendorQuoteLineDoc(it, request, format, extractionMethod)),
      { ordered: false }
    )

    const { rows: expectedRows, meta: expectedMeta } = await buildExpectedRowsForComparison(consolidatedBOM)
    const receivedRows = vendorDocs.map((d) => ({
      _id: d._id,
      pieceMark: d.pieceMark,
      lengthFeet: d.lengthFeet,
      pieceQty: d.pieceQty != null ? d.pieceQty : d.qty,
      description: d.description,
      partCode: d.partCode,
      rawRow: d.rawRow,
    }))

    const { results, summary, exceptions } = compareMaterials(expectedRows, receivedRows, request)

    if (results.length) {
      await QuoteComparisonResult.insertMany(results, { ordered: false })
    }

    await ShipperRequest.findByIdAndUpdate(requestId, {
      status: 'comparison_completed',
      comparisonStatus: 'completed',
      comparisonSummary: {
        ...summary,
        ...expectedMeta,
        serviceVersion: SERVICE_VERSION,
        extractionFormat: format,
        extractionMethod,
        extractedVendorLines: vendorItems.length,
      },
      comparisonRanAt: new Date(),
      comparisonError: null,
      exceptions,
    })

    return {
      summary: {
        ...summary,
        ...expectedMeta,
        serviceVersion: SERVICE_VERSION,
        extractionFormat: format,
        extractionMethod,
        extractedVendorLines: vendorItems.length,
      },
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

/* =========================================================
 * Public: async job wrapper
 * ========================================================= */
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

module.exports = {
  compareShipperRequest,
  processShipperComparisonJob,

  // exposed for tests / reuse
  extractVendorItems,
  compareMaterials,
  normalizeExpected,
  normalizeMaterial,
  materialCompatibility,
  expectedPieceLengthFeet,
  lengthToFeet,
  lengthBucketInches,
  detectVendorFormat,
  parseCentralStates,
  parseQuicken,
}