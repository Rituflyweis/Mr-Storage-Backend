// /**
//  * Shipper quote extraction + comparison pipeline.
//  *
//  * Demo-safe / same-schema version.
//  * VERSION: shipper-comparison-v4.2-production-comparison-fixes
//  *
//  * What this version does:
//  *   - Keeps the existing model schemas unchanged.
//  *   - Uses deterministic parsers for Central States and Quicken Steel.
//  *   - Uses Claude/Sonnet only as extraction fallback, not as final judge.
//  *   - Compares vendor quote against ConsolidatedBOM using:
//  *       normalized piece mark + piece length tolerance + qty
//  *   - Normalizes incompatible vendor part codes into a canonical material key:
//  *       C83516R       -> CEE|16GA|8|3.5|RED_OXIDE
//  *       PC16-RO-8X3.5 -> CEE|16GA|8|3.5|RED_OXIDE
//  *   - Stores canonical material details inside rawRow / expected / received Mixed fields
//  *     so no schema migration is required.
//  *
//  * Public contract preserved:
//  *   - processShipperComparisonJob(jobId)
//  *   - compareShipperRequest(requestId)
//  */

// const Anthropic = require('@anthropic-ai/sdk')
// const https = require('https')
// const http = require('http')
// const XLSX = require('xlsx')
// const { PDFParse } = require('pdf-parse')
// const { parse: parseCsv } = require('csv-parse/sync')

// const env = require('../../config/env')
// const ShipperRequest = require('../../models/ShipperRequest')
// const ConsolidatedBOM = require('../../models/ConsolidatedBOM')
// const BOMItem = require('../../models/BOMItem')
// const VendorQuoteLine = require('../../models/VendorQuoteLine')
// const QuoteComparisonResult = require('../../models/QuoteComparisonResult')
// const ShipperComparisonJob = require('../../models/ShipperComparisonJob')

// /* =========================================================
//  * Constants
//  * ========================================================= */
// const LENGTH_TOLERANCE_INCH = 0.5
// const LENGTH_TOL_FEET = LENGTH_TOLERANCE_INCH / 12
// const SERVICE_VERSION = 'shipper-comparison-v4.3-anonymous-alpha-product-fixes'
// const DEFAULT_SONNET_MODEL = env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'

// let anthropicClient = null
// const getAnthropicClient = () => {
//   if (!env.ANTHROPIC_API_KEY) {
//     throw new Error('ANTHROPIC_API_KEY missing for AI-assisted PDF extraction')
//   }
//   if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
//   return anthropicClient
// }

// /* =========================================================
//  * Primitives
//  * ========================================================= */
// const normMark = (v) => {
//   if (v == null) return ''
//   return String(v)
//     .trim()
//     .toUpperCase()
//     .replace(/[，]/g, ',')
//     .replace(/,+$/g, '')
//     .replace(/\s+/g, '')
// }

// const normCode = (v) => {
//   if (v == null) return ''
//   return String(v)
//     .trim()
//     .toUpperCase()
//     .replace(/\s+/g, '')
//     .replace(/[^A-Z0-9#+./-]/g, '')
// }

// const cleanStr = (v) => {
//   if (v == null) return ''
//   return String(v).replace(/^'+/, '').replace(/'+$/, '').trim()
// }

// const cleanMaterialDescription = (value) => {
//   let s = cleanStr(value)
//   if (!s) return ''

//   // Vendor lines often append LF/UOM + unit price + amount at the end.
//   // Example: "Wall Girt 42.9167 LF 3.0000 128.75"
//   s = s.replace(
//     /\s+\d+(?:\.\d+)?\s*(?:LF|FT|EA|LB|LOT)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*$/i,
//     ''
//   )
//   s = s.replace(
//     /\s+\d+(?:\.\d+)?\s*(?:LF|FT|EA|LB|LOT)\s+\d+(?:\.\d+)?\s*$/i,
//     ''
//   )

//   return s.trim()
// }

// const cleanPartMarkText = (value) => {
//   let s = cleanStr(value)
//   if (!s) return ''

//   s = s.replace(/^Part\s+Mark\s*:\s*/i, '')
//   s = s.replace(/^Piece\s+Mark\s*:\s*/i, '')

//   // PDF text can merge the totals row onto the mark row:
//   // "DJ-1 195.4167 LF 3.0006 586.37" -> "DJ-1"
//   s = s.replace(
//     /\s+\d+(?:,\d{3})*(?:\.\d+)?\s+(?:LF|FT|EA|LB)\s+\d+(?:\.\d+)?\s+\d+(?:,\d{3})*(?:\.\d+)?\s*$/i,
//     ''
//   )

//   // Also handle a shorter accidental suffix after the real mark.
//   s = s.replace(/\s+(?:LF|FT|EA|LB)\b.*$/i, '')

//   return s.trim().replace(/,+$/g, '')
// }

// const toNum = (v) => {
//   if (v == null || v === '') return null
//   const n = Number(String(v).replace(/[$,%\s,]/g, '').trim())
//   return Number.isFinite(n) ? n : null
// }

// const safe = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0)
// const round = (n, d = 4) => Math.round(Number(n || 0) * 10 ** d) / 10 ** d
// const fmtFt = (f) => (f == null ? 'n/a' : `${safe(f).toFixed(3)}ft`)
// const uniq = (arr) => [...new Set((arr || []).filter((x) => x != null && x !== ''))]

// const downloadBuffer = (url) =>
//   new Promise((resolve, reject) => {
//     const lib = String(url || '').startsWith('https') ? https : http
//     lib
//       .get(url, (res) => {
//         if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
//           downloadBuffer(res.headers.location).then(resolve).catch(reject)
//           return
//         }
//         if (res.statusCode >= 400) {
//           reject(new Error(`Failed to download file: HTTP ${res.statusCode}`))
//           return
//         }
//         const chunks = []
//         res.on('data', (c) => chunks.push(c))
//         res.on('end', () => resolve(Buffer.concat(chunks)))
//         res.on('error', reject)
//       })
//       .on('error', reject)
//   })

// /* =========================================================
//  * Length normalization
//  * Supports:
//  *   6' 11.75''
//  *   6' 11-3/4"
//  *   15'11-12"    // sixteenths notation
//  *   1-04"        // inch-sixteenths notation
//  *   numeric strings as feet when no quote marks exist
//  * ========================================================= */
// const fractionishToNumber = (value) => {
//   if (value == null || value === '') return null
//   const s = String(value).trim()

//   const mixedHyphen = s.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/)
//   if (mixedHyphen) {
//     return Number(mixedHyphen[1]) + Number(mixedHyphen[2]) / Number(mixedHyphen[3])
//   }

//   const mixedSpace = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
//   if (mixedSpace) {
//     return Number(mixedSpace[1]) + Number(mixedSpace[2]) / Number(mixedSpace[3])
//   }

//   const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/)
//   if (frac) return Number(frac[1]) / Number(frac[2])

//   const n = Number(s)
//   return Number.isFinite(n) ? n : null
// }

// const lengthToFeet = (value) => {
//   if (value == null || value === '') return null
//   if (typeof value === 'number' && Number.isFinite(value)) return value

//   let s = String(value)
//     .replace(/[\u201C\u201D]/g, '"')
//     .replace(/[\u2018\u2019]/g, "'")
//     .replace(/[\u2010-\u2015]/g, '-')
//     .replace(/''/g, '"')
//     .replace(/″/g, '"')
//     .replace(/′/g, "'")
//     .replace(/\bFT\b/gi, "'")
//     .replace(/\bIN\b/gi, '"')
//     .trim()

//   if (!s) return null

//   // Pure numeric values in uploaded spreadsheets are normally feet.
//   if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s)

//   // MBS pattern: 15'11-12" where 12 means sixteenths.
//   const mbs = s.match(/^(\d+)\s*'\s*(\d{1,2})-(\d{1,2})"?$/)
//   if (mbs) {
//     return Number(mbs[1]) + (Number(mbs[2]) + Number(mbs[3]) / 16) / 12
//   }

//   // Inch-sixteenths only: 6-00", 1-04".
//   const mbsIn = s.match(/^(\d{1,2})-(\d{1,2})"$/)
//   if (mbsIn) {
//     return (Number(mbsIn[1]) + Number(mbsIn[2]) / 16) / 12
//   }

//   // Remove a wrapped trailing table value after the inch mark, if PDF text extraction appended it.
//   s = s.replace(/("?)\s+\d+(?:\.\d+)?\s*$/, '$1').trim()

//   let feet = 0
//   let inches = 0
//   let matched = false

//   const feetMatch = s.match(/(\d+(?:\.\d+)?)\s*'/)
//   if (feetMatch) {
//     feet = Number(feetMatch[1])
//     matched = true
//     s = s.slice(feetMatch.index + feetMatch[0].length)
//   }

//   s = s.replace(/"/g, '').trim()

//   if (s) {
//     // Examples: 11.75, 11-3/4, 11 3/4, 3/4
//     const inchNumber = fractionishToNumber(s)
//     if (inchNumber != null) {
//       inches += inchNumber
//       matched = true
//     } else {
//       const anyNum = s.match(/\d+(?:\.\d+)?/)
//       if (anyNum) {
//         inches += Number(anyNum[0])
//         matched = true
//       }
//     }
//   }

//   if (!matched) return null
//   return feet + inches / 12
// }

// const lengthBucketInches = (feet) => {
//   if (feet == null || !Number.isFinite(Number(feet))) return null
//   const inches = Number(feet) * 12
//   return Math.round(inches / LENGTH_TOLERANCE_INCH) * LENGTH_TOLERANCE_INCH
// }

// const lengthDiffInches = (aFeet, bFeet) => {
//   if (aFeet == null || bFeet == null) return null
//   return Math.abs(Number(aFeet) * 12 - Number(bFeet) * 12)
// }

// /* =========================================================
//  * Canonical material normalization
//  * Same schema is preserved by storing this under rawRow / expected / received.
//  * ========================================================= */
// const normalizeColor = (value) => {
//   const s = String(value || '').toUpperCase().trim()
//   if (!s) return null

//   if (/RED\s*OXIDE|\bRO\b|\bR\.O\.\b|\bPRIME\s*,?\s*R\b|OXIDE/.test(s)) return 'RED_OXIDE'
//   if (/GALV|GALVANIZED/.test(s)) return 'GALVANIZED'
//   if (/\bWH\b|WHITE/.test(s)) return 'WHITE'
//   if (/\bBLK\b|BLACK/.test(s)) return 'BLACK'

//   // Unknown colors must stay unknown. Returning normCode(value) here turns a
//   // whole description into a fake color and creates false material mismatches.
//   return null
// }

// const normalizeShape = (value) => {
//   const s = String(value || '').toUpperCase()
//   if (/\bCEE\b|\bCEES\b|\bC\s*PURLIN\b|\bC-PURLIN\b|\bPURLIN\b.*\bCEE\b/.test(s)) return 'CEE'
//   if (/\bZEE\b|\bZEES\b|\bZ\s*PURLIN\b|\bZ-PURLIN\b/.test(s)) return 'ZEE'
//   if (/CHANNEL/.test(s)) return 'CHANNEL'
//   if (/ANGLE/.test(s)) return 'ANGLE'
//   if (/TRIM|FLASHING/.test(s)) return 'TRIM'
//   return null
// }

// const parseDimensionValue = (value) => {
//   if (value == null) return null
//   const cleaned = String(value).replace(/"/g, '').trim()
//   return fractionishToNumber(cleaned)
// }

// const buildMaterialKey = ({ shape, gauge, depthInches, flangeInches, color }) => {
//   if (!shape || !gauge || !depthInches || !flangeInches) return null
//   return [
//     shape,
//     `${Number(gauge)}GA`,
//     round(depthInches, 3),
//     round(flangeInches, 3),
//     color || 'UNKNOWN_COLOR',
//   ].join('|')
// }

// const normalizeMaterial = ({ partCode, description, color, partColor }) => {
//   const rawPartCode = cleanStr(partCode)
//   const rawDescription = cleanStr(description)
//   const combined = `${rawPartCode} ${rawDescription} ${color || ''} ${partColor || ''}`.toUpperCase()

//   let shape = normalizeShape(combined)
//   let gauge = null
//   let depthInches = null
//   let flangeInches = null
//   let normalizedColor = normalizeColor(color || partColor) || normalizeColor(rawDescription) || normalizeColor(rawPartCode)
//   const warnings = []

//   const code = normCode(rawPartCode)

//   // Central States style: C83516R = CEE, 8 deep, 3.5 flange, 16ga, Red Oxide.
//   // Also supports Z82514R etc.
//   const central = code.match(/^([CZ])(\d{1,2})(\d{2})(\d{2})([A-Z]*)$/)
//   if (central) {
//     shape = central[1] === 'C' ? 'CEE' : 'ZEE'
//     depthInches = Number(central[2])
//     flangeInches = Number(central[3]) / 10
//     gauge = Number(central[4])
//     if (!normalizedColor && central[5].includes('R')) normalizedColor = 'RED_OXIDE'
//   }

//   // Quicken style: PC16-RO-8X3.5, PC12-RO-8X2.5
//   const quicken = code.match(/^(P?[CZ])?(\d{2})-?([A-Z]{1,3})?-?(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/)
//   if (quicken) {
//     if (!shape) shape = code.startsWith('PZ') || code.startsWith('Z') ? 'ZEE' : 'CEE'
//     gauge = Number(quicken[2])
//     if (!normalizedColor && quicken[3]) normalizedColor = normalizeColor(quicken[3])
//     depthInches = Number(quicken[4])
//     flangeInches = Number(quicken[5])
//   }

//   // Description fallback: 16Ga CEE Purlin Red Oxide 8 X 3-1/2"
//   if (!gauge) {
//     const gm = combined.match(/(\d{2})\s*GA\b|GAUGE\s*(\d{2})/)
//     if (gm) gauge = Number(gm[1] || gm[2])
//   }

//   if (!depthInches || !flangeInches) {
//     const dim = combined.match(/(\d+(?:\.\d+)?)\s*"?\s*X\s*(\d+(?:\.\d+)?|\d+\s*-\s*\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+)\s*"?/)
//     if (dim) {
//       depthInches = depthInches || Number(dim[1])
//       flangeInches = flangeInches || parseDimensionValue(dim[2])
//     }
//   }

//   const materialKey = buildMaterialKey({ shape, gauge, depthInches, flangeInches, color: normalizedColor })

//   let confidence = 0.3
//   if (materialKey) confidence = 0.95
//   else if (shape || gauge || depthInches || flangeInches) confidence = 0.6
//   else warnings.push('Unable to build canonical material key from part code/description')

//   return {
//     rawPartCode: rawPartCode || null,
//     rawDescription,
//     shape: shape || null,
//     gauge: gauge || null,
//     depthInches: depthInches || null,
//     flangeInches: flangeInches || null,
//     color: normalizedColor || null,
//     materialKey,
//     confidence,
//     warnings,
//   }
// }

// const materialCompatibility = (expectedMaterial, receivedMaterial) => {
//   const e = expectedMaterial || {}
//   const r = receivedMaterial || {}

//   if (e.materialKey && r.materialKey && e.materialKey === r.materialKey) {
//     return { compatible: true, confidence: 0.99, reason: 'Canonical material key matched.' }
//   }

//   const essentialFields = ['shape', 'gauge', 'depthInches', 'flangeInches']
//   const bothHaveEssentials = essentialFields.every((k) => e[k] != null && r[k] != null)
//   if (bothHaveEssentials) {
//     const sameEssentials =
//       e.shape === r.shape &&
//       Number(e.gauge) === Number(r.gauge) &&
//       Math.abs(Number(e.depthInches) - Number(r.depthInches)) < 0.01 &&
//       Math.abs(Number(e.flangeInches) - Number(r.flangeInches)) < 0.01

//     const colorCompatible = !e.color || !r.color || e.color === r.color

//     if (sameEssentials && colorCompatible) {
//       return { compatible: true, confidence: 0.93, reason: 'Canonical material dimensions matched.' }
//     }

//     return {
//       compatible: false,
//       confidence: 0.9,
//       reason: `Material mismatch: expected ${e.materialKey || 'partial material'}, received ${r.materialKey || 'partial material'}.`,
//     }
//   }

//   return {
//     compatible: null,
//     confidence: 0.55,
//     reason: 'Material could not be fully verified from available part code/description.',
//   }
// }

// /* =========================================================
//  * Deterministic vendor PDF parsers
//  * ========================================================= */
// const detectVendorFormat = (text) => {
//   const t = String(text || '').toUpperCase()
//   if (t.includes('CENTRAL STATES') || /\bPIECES?\s*@/i.test(text) || t.includes('PART MARK:')) {
//     return 'central_states'
//   }
//   if (t.includes('QUICKEN STEEL') || (t.includes('PIECE MARK:') && t.includes('SALES ORDER'))) {
//     return 'quicken_steel'
//   }
//   return 'generic_material_pdf'
// }

// const parseCentralStates = (text) => {
//   const lines = String(text).split('\n').map((l) => l.replace(/\r/g, ''))
//   const items = []
//   let cur = null
//   let pageNumber = 1

//   /**
//    * Defensive mark recovery for PDF line-merge failures.
//    *
//    * Central States PDFs structure each item as ~6 lines:
//    *   "1 C83516R Purlin,..."          <- head
//    *   "28 Pieces @ 6' 11.75''"        <- pieces
//    *   "Left Punch: PPEP"
//    *   "Right Punch: PPEP"
//    *   "Part Mark: DJ-1"               <- THIS line is the fragile one
//    *   "195.4167 LF 3.0006 586.37"     <- totals
//    *
//    * If the PDF renderer collapses lines (e.g. "Right Punch: PPEP Part Mark: DJ-1"
//    * or "Part Mark: DJ-1 195.4167 LF 3.0006 586.37"), the normal per-line regex
//    * misses the mark. flush() now scans rawText as a fallback so no mark is lost.
//    *
//    * The rawText fallback uses a permissive regex that handles:
//    *   - "Part Mark: DJ-1"            (normal)
//    *   - "Part Mark:DJ-1"             (no space)
//    *   - "PPEP Part Mark: DJ-1"       (merged with punch line)
//    *   - "Part Mark: DJ-1 195.4167"   (merged with totals line)
//    */
//   const recoverMarkFromRawText = (rawText) => {
//     const m = String(rawText || '').match(/Part\s+Mark\s*:\s*([^\n\r]+)/i)
//     return m ? cleanPartMarkText(m[1]) : null
//   }

//   const flush = () => {
//     if (cur && (cur.mark || cur.pieceQty != null || cur.product)) {
//       cur.rawText = (cur.rawParts || []).join('\n')
//       delete cur.rawParts

//       // Fallback: if pieceQty was parsed but mark was lost due to PDF line-merge,
//       // scan rawText for "Part Mark: X" before giving up.
//       if (!cur.mark && cur.pieceQty != null && cur.rawText) {
//         const recovered = recoverMarkFromRawText(cur.rawText)
//         if (recovered) {
//           cur.mark = recovered
//           cur.markRecovered = true // flag for debugging/audit
//         }
//       }

//       items.push(cur)
//     }
//     cur = null
//   }

//   for (const raw of lines) {
//     const line = raw.trim()
//     if (!line) continue

//     const pageM = line.match(/^Page:\s*(\d+)\s+of\s+\d+/i)
//     if (pageM) {
//       pageNumber = Number(pageM[1])
//       continue
//     }

//     if (/^Line\s+Product\s+Description/i.test(line)) continue

//     // totals row can appear after Part Mark in extracted text.
//     const totals = line.match(/^([\d,]+(?:\.\d+)?)\s+(LF|FT|EA|LB)\s+([\d.]+)\s+([\d,]+(?:\.\d{2})?)$/i)
//     if (totals && cur) {
//       cur.totalLinearFeet = Number(totals[1].replace(/,/g, ''))
//       cur.uom = totals[2].toUpperCase() === 'FT' ? 'LF' : totals[2].toUpperCase()
//       cur.unitPrice = Number(totals[3])
//       cur.amount = Number(totals[4].replace(/,/g, ''))
//       cur.rawParts.push(line)
//       continue
//     }

//     // New item line: "<lineNo> [<product>] <description...>".
//     //
//     // The product/catalog code is OPTIONAL. Rigid-frame members (RF Column,
//     // RF Rafter, etc.) ship with a BLANK product column, e.g. "1 RF Column".
//     // The previous regex required a >=3-char code token and silently discarded
//     // those lines (dropping real dollars from the comparison). We now accept any
//     // line that starts with a line number and decide product-vs-description by
//     // shape: a product code in this format always carries at least one digit
//     // (W8X10, C83516R, RLOC26, SP2, CL-100...), whereas a description-only line
//     // ("RF Column") does not.
//     const head = !/^\d+\s+Pieces?\b/i.test(line) && line.match(/^(\d+)\s+(.+)$/)
//     if (head) {
//       flush()
//       const rest = head[2].trim()
//       const firstTok = rest.split(/\s+/)[0]
//       // Product/catalog code can be numeric/mixed (W8X10, C83516R, RLOC26)
//       // OR alpha-only (BTL, MRS, POP, RLCLINGL, RLCLOUTG). Earlier versions only
//       // accepted tokens with digits, which broke anonymous/no-mark rows because
//       // vendor product became null while BOM expected had partCode MRS/BTL/POP.
//       const restAfterFirstToken = rest.slice(firstTok.length).trim()
//       const looksLikeNumericProduct =
//         /^[A-Z0-9][A-Z0-9./-]*$/i.test(firstTok) && /\d/.test(firstTok)
//       const looksLikeAlphaProduct =
//         /^[A-Z][A-Z0-9./-]*$/.test(firstTok) &&
//         firstTok.length >= 3 &&
//         restAfterFirstToken.length > 0
//       const knownDescriptionLead =
//         /^(RF|EW|EXT|WIND|DOOR|ROOF|WALL|RIGID|ENDWALL|ANCHOR|BOLTS?|WASHERS?|FASTENERS?|ACCESSORIES?|TRIM)$/i.test(firstTok)
//       const looksLikeProduct =
//         looksLikeNumericProduct || (looksLikeAlphaProduct && !knownDescriptionLead)
//       cur = {
//         lineNo: head[1],
//         product: looksLikeProduct ? firstTok : null,
//         description: looksLikeProduct ? restAfterFirstToken : rest,
//         pageNumber,
//         rawParts: [line],
//       }
//       continue
//     }

//     // Pieces line. The "@ <length>" suffix is OPTIONAL: count-only lines such as
//     // fasteners print "84 Pieces" with no length, and without this the qty was
//     // never captured (dropping those lines from qty-filtered consumers like the
//     // load planner).
//     const pcs = line.match(/^([\d,]+)\s+Pieces?\b\s*(?:@\s*(.+))?$/i)
//     if (pcs && cur) {
//       cur.pieceQty = Number(pcs[1].replace(/,/g, ''))
//       if (pcs[2]) {
//         cur.lengthText = pcs[2].trim()
//         cur.lengthFeet = lengthToFeet(cur.lengthText)
//       }
//       cur.rawParts.push(line)
//       continue
//     }

//     const lp = line.match(/^Left Punch:\s*(.*)$/i)
//     if (lp && cur) {
//       cur.leftPunch = lp[1].trim()
//       cur.rawParts.push(line)

//       // Inline mark-merge recovery: "Left Punch: PPEP Part Mark: DJ-1"
//       if (!cur.mark) {
//         const inlineM = lp[1].match(/Part\s+Mark\s*:\s*([^\n\r]+)/i)
//         if (inlineM) cur.mark = cleanPartMarkText(inlineM[1])
//       }
//       continue
//     }

//     const rp = line.match(/^Right Punch:\s*(.*)$/i)
//     if (rp && cur) {
//       cur.rightPunch = rp[1].trim()
//       cur.rawParts.push(line)

//       // Inline mark-merge recovery: "Right Punch: PPEP Part Mark: DJ-1"
//       if (!cur.mark) {
//         const inlineM = rp[1].match(/Part\s+Mark\s*:\s*([^\n\r]+)/i)
//         if (inlineM) cur.mark = cleanPartMarkText(inlineM[1])
//       }
//       continue
//     }

//     const mk = line.match(/^Part Mark:\s*(.+)$/i)
//     if (mk && cur) {
//       cur.mark = cleanPartMarkText(mk[1])
//       cur.rawParts.push(line)
//       continue
//     }

//     // Description continuation: append to description only before pieces are set.
//     // Always push to rawParts so the rawText fallback in flush() can scan every
//     // line, including ones that appeared after pieceQty (e.g. a mark buried in
//     // a stray continuation line due to PDF table collapse).
//     if (cur && !/^Total\b/i.test(line)) {
//       if (!cur.pieceQty) {
//         cur.description = `${cur.description} ${line}`.trim()
//       }
//       cur.rawParts.push(line)
//     }
//   }

//   flush()
//   return { items, format: 'central_states' }
// }

// const parseQuicken = (text) => {
//   const lines = String(text).split('\n').map((l) => l.replace(/\r/g, ''))
//   const items = []
//   let cur = null
//   let pageNumber = 1

//   const flush = () => {
//     if (cur && (cur.mark || cur.pieceQty != null || cur.product)) {
//       cur.rawText = (cur.rawParts || []).join('\n')
//       delete cur.rawParts
//       items.push(cur)
//     }
//     cur = null
//   }

//   for (const raw of lines) {
//     const line = raw.trim()
//     if (!line) continue

//     const pageM = line.match(/Page\s+Number:\s*(\d+)/i) || line.match(/Page\s+(\d+)\s+of\s+\d+/i)
//     if (pageM) pageNumber = Number(pageM[1])

//     if (/^(Line\s+Item\s+Description|QUICKEN STEEL|SOLD TO|SHIP TO|Print Date|Document Ref)/i.test(line)) continue

//     /**
//      * Extracted text order in the sample Quicken PDF:
//      * 1 16Ga CEE Purlin Red Oxide 8 X 3-1/2" $2.53 / FT 28 $494.48 PC16-RO-8X3.5 6' 11-3/4" 621
//      */
//     const row = line.match(
//       /^(\d+)\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s*\/\s*([A-Z]+)\s+([\d,]+(?:\.\d+)?)\s+\$([\d,]+(?:\.\d{2})?)\s+([A-Z0-9][A-Z0-9./-]+)\s+(.+?)\s+([\d,]+(?:\.\d+)?)$/i
//     )

//     if (row) {
//       flush()
//       cur = {
//         lineNo: row[1],
//         description: cleanStr(row[2]),
//         unitPrice: Number(row[3].replace(/,/g, '')),
//         priceUnit: row[4].toUpperCase(),
//         pieceQty: Number(row[5].replace(/,/g, '')),
//         amount: Number(row[6].replace(/,/g, '')),
//         product: row[7],
//         lengthText: cleanStr(row[8]),
//         lengthFeet: lengthToFeet(row[8]),
//         weight: Number(row[9].replace(/,/g, '')),
//         pageNumber,
//         rawParts: [line],
//       }
//       continue
//     }

//     const punch = line.match(/^Punch:\s*(.+)$/i)
//     if (punch && cur) {
//       cur.punchInfo = punch[1].trim()
//       cur.rawParts.push(line)
//       continue
//     }

//     const mk = line.match(/^Piece Mark:\s*(.+)$/i)
//     if (mk && cur) {
//       cur.mark = cleanPartMarkText(mk[1])
//       cur.rawParts.push(line)
//       continue
//     }
//   }

//   flush()
//   return { items, format: 'quicken_steel' }
// }

// /* =========================================================
//  * LLM fallback for unknown / broken PDF text layouts
//  * ========================================================= */
// const extractPdfText = async (buffer) => {
//   const parser = new PDFParse({ data: buffer })
//   try {
//     const result = await parser.getText()
//     return result.text || ''
//   } finally {
//     await parser.destroy()
//   }
// }

// const safeJsonParseFromText = (raw) => {
//   const text = String(raw || '').replace(/```json|```/g, '').trim()
//   const match = text.match(/\{[\s\S]*\}/)
//   if (!match) throw new Error('AI extraction returned no JSON object')
//   return JSON.parse(match[0])
// }

// const extractPdfWithLlm = async (text) => {
//   const client = getAnthropicClient()

//   const prompt = `Extract vendor material line items from this quote PDF text.
// Return STRICT JSON only. No markdown. No commentary.

// Schema:
// {
//   "lines": [
//     {
//       "lineNo": "1",
//       "pieceQty": 10,
//       "product": "PC16-RO-8X3.5",
//       "description": "16Ga CEE Purlin Red Oxide 8 X 3-1/2",
//       "color": "Red Oxide",
//       "lengthText": "15' 11-3/4\"",
//       "totalLinearFeet": 159.79,
//       "uom": "LF",
//       "unitPrice": 2.53,
//       "priceUnit": "FT",
//       "amount": 404.25,
//       "weight": 621,
//       "pieceMark": "DJ-1",
//       "leftPunch": "CUSTOM",
//       "rightPunch": "PPEP",
//       "punchInfo": "Custom Punch",
//       "pageNumber": 1,
//       "rawText": "original row text here"
//     }
//   ]
// }

// Rules:
// - Extract actual material rows only.
// - Skip cover pages, signatures, summaries, totals, tax, freight, notes, terms, headers and footers.
// - pieceQty = physical piece count, not LF quantity.
// - lengthText = per-piece length, preserve original notation.
// - product = vendor product/part/item code when present.
// - Attach Piece Mark / Part Mark continuation lines to the material row above.
// - If unsure about a row, include it with low confidence fields missing rather than inventing values.
// - Do not compare against BOM. Extraction only.

// PDF text:
// ${String(text || '').slice(0, 120000)}`

//   const response = await client.messages.create({
//     model: DEFAULT_SONNET_MODEL,
//     max_tokens: 16000,
//     temperature: 0,
//     system: 'You extract steel vendor quote material rows into strict JSON. You never compare, summarize, or invent values.',
//     messages: [{ role: 'user', content: prompt }],
//   })

//   const raw = response.content?.[0]?.text || ''
//   const parsed = safeJsonParseFromText(raw)

//   const items = (parsed.lines || []).map((l, idx) => ({
//     lineNo: l.lineNo != null ? String(l.lineNo) : String(idx + 1),
//     product: cleanStr(l.product) || null,
//     description: cleanStr(l.description),
//     color: cleanStr(l.color) || null,
//     pieceQty: toNum(l.pieceQty),
//     lengthText: cleanStr(l.lengthText) || null,
//     lengthFeet: lengthToFeet(l.lengthText),
//     totalLinearFeet: toNum(l.totalLinearFeet),
//     uom: cleanStr(l.uom) || null,
//     unitPrice: toNum(l.unitPrice),
//     priceUnit: cleanStr(l.priceUnit) || 'UNKNOWN',
//     amount: toNum(l.amount),
//     weight: toNum(l.weight),
//     mark: cleanStr(l.pieceMark),
//     leftPunch: cleanStr(l.leftPunch),
//     rightPunch: cleanStr(l.rightPunch),
//     punchInfo: cleanStr(l.punchInfo),
//     pageNumber: toNum(l.pageNumber),
//     rawText: cleanStr(l.rawText),
//     warnings: l.warnings || [],
//   }))

//   return { items, format: 'generic_material_pdf' }
// }

// /* =========================================================
//  * Excel / CSV header-mapped parser
//  * ========================================================= */
// const col = (headers, aliases) => headers.findIndex((h) => aliases.includes(h))

// const parseTabular = (rows) => {
//   if (!rows.length) return []
//   const headerIdx = rows.findIndex((row) => {
//     const n = (row || []).map(normCode)
//     const hasQty = n.includes('QTY') || n.includes('QUANTITY') || n.includes('PIECES') || n.includes('PIECEQTY')
//     const hasMark = n.includes('MARK') || n.includes('PIECEMARK') || n.includes('PARTMARK') || n.includes('MARKID')
//     const hasDesc = n.includes('DESCRIPTION') || n.includes('DESC') || n.includes('ITEMDESCRIPTION')
//     return hasQty && (hasMark || hasDesc)
//   })
//   if (headerIdx < 0) return []

//   const headers = (rows[headerIdx] || []).map(normCode)
//   const iQty = col(headers, ['QTY', 'QUANTITY', 'PIECES', 'PIECEQTY'])
//   const iMark = col(headers, ['MARK', 'PIECEMARK', 'PARTMARK', 'MARKID'])
//   const iPart = col(headers, ['PART', 'PARTCODE', 'ITEM', 'PRODUCT', 'PRODUCTCODE', 'ITEMCODE'])
//   const iColor = col(headers, ['COLOR', 'COLOUR', 'CLR', 'FINISH'])
//   const iLen = col(headers, ['LENGTH', 'LEN', 'PIECELENGTH', 'CUTLENGTH'])
//   const iWeight = col(headers, ['WEIGHT', 'WT'])
//   const iDesc = col(headers, ['DESCRIPTION', 'DESC', 'ITEMDESCRIPTION'])
//   const iAmount = col(headers, ['AMOUNT', 'TOTAL', 'TOTALCOST'])
//   const iUnitPrice = col(headers, ['UNITPRICE', 'UNITCOST', 'PRICE'])

//   const out = []
//   for (let i = headerIdx + 1; i < rows.length; i++) {
//     const row = rows[i] || []
//     const joined = row.map((c) => cleanStr(c)).join(' ').toLowerCase()
//     if (!joined.trim() || joined.startsWith('total') || joined.includes('subtotal')) continue

//     const lengthText = iLen >= 0 ? cleanStr(row[iLen]) : ''
//     out.push({
//       lineNo: String(i + 1),
//       pieceQty: iQty >= 0 ? toNum(row[iQty]) : null,
//       mark: iMark >= 0 ? cleanStr(row[iMark]) : '',
//       product: iPart >= 0 ? cleanStr(row[iPart]) : null,
//       color: iColor >= 0 ? cleanStr(row[iColor]) : null,
//       description: iDesc >= 0 ? cleanStr(row[iDesc]) : '',
//       lengthText: lengthText || null,
//       lengthFeet: lengthToFeet(lengthText),
//       weight: iWeight >= 0 ? toNum(row[iWeight]) : null,
//       amount: iAmount >= 0 ? toNum(row[iAmount]) : null,
//       unitPrice: iUnitPrice >= 0 ? toNum(row[iUnitPrice]) : null,
//       rawRow: row,
//     })
//   }
//   return out
// }

// /* =========================================================
//  * Unified vendor extraction
//  * ========================================================= */
// const extractVendorItems = async ({ fileUrl, fileName }) => {
//   const ext = String(fileName || '').split('.').pop().toLowerCase()
//   const buffer = await downloadBuffer(fileUrl)

//   if (['xlsx', 'xls', 'ods'].includes(ext)) {
//     const wb = XLSX.read(buffer, { type: 'buffer', raw: false })
//     const items = []
//     for (const name of wb.SheetNames) {
//       const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: false })
//       items.push(...parseTabular(rows))
//     }
//     return { items, format: 'excel', extractionMethod: 'excel' }
//   }

//   if (ext === 'csv') {
//     const records = parseCsv(buffer.toString('utf8'), { relax_column_count: true, skip_empty_lines: true })
//     return { items: parseTabular(records), format: 'csv', extractionMethod: 'csv' }
//   }

//   if (ext === 'pdf') {
//     const text = await extractPdfText(buffer)
//     if (!text.trim()) throw new Error('Unable to extract text from PDF')

//     const fmt = detectVendorFormat(text)

//     if (fmt === 'central_states') {
//       const parsed = parseCentralStates(text)
//       if (parsed.items.length) return { ...parsed, extractionMethod: 'pdf_text' }
//     }

//     if (fmt === 'quicken_steel') {
//       const parsed = parseQuicken(text)
//       if (parsed.items.length) return { ...parsed, extractionMethod: 'pdf_text' }
//     }

//     // Unknown or parser failed. Sonnet extracts; backend still compares deterministically.
//     return { ...(await extractPdfWithLlm(text)), extractionMethod: 'claude' }
//   }

//   throw new Error('Unsupported vendor quote file type')
// }

// /* =========================================================
//  * Persistence mapping: vendor item -> VendorQuoteLine doc
//  * Schema unchanged. Canonical material goes into rawRow.
//  * ========================================================= */
// const toVendorQuoteLineDoc = (item, request, format, extractionMethod) => {
//   const cleanedDescriptionForMaterial = cleanMaterialDescription(item.description)
//   const material = normalizeMaterial({
//     partCode: item.product,
//     description: cleanedDescriptionForMaterial,
//     color: item.color,
//   })

//   const warnings = uniq([...(item.warnings || []), ...(material.warnings || [])])

//   return {
//     shipperRequestId: request._id,
//     leadId: request.leadId,
//     consolidatedBOMId: request.consolidatedBOMId,
//     vendorId: request.vendorId,

//     pageNumber: item.pageNumber ?? null,
//     rowNumber: toNum(item.lineNo),
//     vendorLineNo: item.lineNo || '',

//     qty: item.pieceQty ?? null,
//     pieceQty: item.pieceQty ?? null,
//     totalLinearFeet: item.totalLinearFeet ?? null,
//     uom: item.uom || null,

//     partCode: item.product || null,
//     partCodeNormalized: normCode(item.product) || null,
//     vendorProductCode: item.product || null,
//     vendorProductCodeNormalized: normCode(item.product) || null,

//     description: item.description || '',

//     pieceMark: item.mark || '',
//     pieceMarkNormalized: normMark(item.mark),

//     color: item.color || material.color || null,
//     colorNormalized: normCode(item.color || material.color) || null,

//     lengthText: item.lengthText || null,
//     lengthFeet: item.lengthFeet ?? null,

//     weight: item.weight ?? null,

//     unitPrice: item.unitPrice ?? null,
//     priceUnit: ['EA', 'FT', 'LF', 'LB', 'LOT'].includes(String(item.priceUnit || '').toUpperCase())
//       ? String(item.priceUnit).toUpperCase()
//       : 'UNKNOWN',
//     amount: item.amount ?? null,

//     punchInfo: item.punchInfo || '',
//     leftPunch: item.leftPunch || '',
//     rightPunch: item.rightPunch || '',

//     extractionMethod: extractionMethod || 'hybrid',
//     extractionFormat: format || 'generic_material_pdf',
//     extractionConfidence: material.confidence ?? null,

//     warnings,
//     rawText: item.rawText || '',
//     rawRow: {
//       original: item.rawRow || item,
//       canonicalMaterial: material,
//       lengthBucketInches: lengthBucketInches(item.lengthFeet),
//     },
//   }
// }

// /* =========================================================
//  * Expected side normalization from ConsolidatedBOM.items
//  * Important: totalLengthFeet is normally aggregate LF.
//  * For comparison we need piece length, so use totalLengthFeet / totalQty
//  * unless an explicit piece/cut length exists.
//  * ========================================================= */
// const firstDefined = (...values) => values.find((v) => v != null && v !== '')

// const expectedPieceLengthFeet = (item) => {
//   const explicit = firstDefined(
//     item.pieceLengthFeet,
//     item.lengthFeet,
//     item.cutLengthFeet,
//     item.unitLengthFeet,
//     item.length
//   )
//   if (explicit != null) return lengthToFeet(explicit)

//   const lengthText = firstDefined(item.lengthText, item.cutLengthText, item.sizeLength)
//   if (lengthText != null) return lengthToFeet(lengthText)

//   const totalLengthFeet = toNum(item.totalLengthFeet)
//   const totalQty = toNum(item.totalQty)

//   if (totalLengthFeet != null && totalQty != null && totalQty > 0) {
//     // totalLengthFeet = qty * pieceLength for Central/Quicken style materials.
//     return totalLengthFeet / totalQty
//   }

//   return totalLengthFeet
// }


// const splitMarkList = (value) => {
//   if (Array.isArray(value)) {
//     return uniq(value.flatMap((v) => splitMarkList(v)))
//   }

//   const s = cleanPartMarkText(value)
//   if (!s || ['-', 'NA', 'N/A', 'NULL', 'NONE'].includes(s.toUpperCase())) return []

//   return uniq(
//     s
//       .split(/[,;\n]+/)
//       .map((m) => cleanStr(m).replace(/,+$/g, ''))
//       .filter(Boolean)
//       .filter((m) => !/^\+?\d+\s+more$/i.test(m))
//   )
// }

// const effectiveMarkForKey = (mark) => {
//   const m = normMark(mark)
//   if (!m || m === '_' || m === '0' || m === 'NA' || m === 'N/A') return ''
//   return m
// }

// const anonymousMaterialKey = (row, material) => {
//   return (
//     material?.materialKey ||
//     normCode(row.partCode || row.product || row.vendorProductCode) ||
//     normCode(row.description) ||
//     '_'
//   )
// }

// /**
//  * Mirrors consolidatedBom.service groupItemsForShipper(), but returns comparable
//  * rows for the comparison engine. This is important because the Excel shipper
//  * file is generated from BOMItem grouping, while ConsolidatedBOM.items is a
//  * priced summary grouping. Comparing vendor quote against the priced summary
//  * creates false qty mismatches.
//  */
// const normalizeExpectedFromBomItemsForShipper = (bomItems) => {
//   const groups = new Map()

//   for (const item of bomItems || []) {
//     const parsedLengthFeet =
//       item.lengthFeet != null && Number.isFinite(Number(item.lengthFeet))
//         ? Number(item.lengthFeet)
//         : lengthToFeet(item.lengthRaw)

//     const identity =
//       item.partCodeNormalized ||
//       normCode(item.partCode) ||
//       `DESC:${normCode(item.description)}`

//     const colorKey = item.partColorNormalized || normCode(item.partColor) || '_'
//     const lengthKey =
//       parsedLengthFeet != null && Number.isFinite(Number(parsedLengthFeet))
//         ? Number(parsedLengthFeet).toFixed(4)
//         : '_'
//     const categoryKey = normCode(item.category || item.sourceSheetName) || '_'
//     const key = [categoryKey, identity || '_', colorKey, lengthKey].join('|')

//     if (!groups.has(key)) {
//       groups.set(key, {
//         _ids: [],
//         partCode: item.partCode || null,
//         partColor: item.partColor || null,
//         description: item.description || '',
//         descriptions: new Set(),
//         category: item.category || item.sourceSheetName || '',
//         lengthFeet: parsedLengthFeet ?? null,
//         totalQty: 0,
//         totalWeight: 0,
//         marks: new Set(),
//         material: normalizeMaterial({
//           partCode: item.partCode,
//           description: item.description,
//           color: item.partColor,
//           partColor: item.partColor,
//         }),
//         sourceLineCount: 0,
//       })
//     }

//     const group = groups.get(key)
//     group.totalQty += safe(item.quantity)
//     group.totalWeight += safe(item.weight)
//     group.sourceLineCount += 1
//     if (item._id) group._ids.push(item._id)
//     if (item.description) group.descriptions.add(item.description)

//     const marks = splitMarkList(item.markId)
//     for (const mark of marks) group.marks.add(mark)
//   }

//   const rows = []
//   for (const group of groups.values()) {
//     const marks = [...group.marks]
//     const description = [...group.descriptions].length
//       ? [...group.descriptions].join(' / ')
//       : group.description

//     if (marks.length) {
//       for (const mark of marks) {
//         rows.push({
//           _id: group._ids[0] || null,
//           bomItemIds: group._ids,
//           markId: mark,
//           partCode: group.partCode,
//           partColor: group.partColor,
//           description,
//           category: group.category,
//           lengthFeet: group.lengthFeet,
//           totalQty: group.totalQty,
//           totalWeight: group.totalWeight,
//           material: group.material,
//           sourceLineCount: group.sourceLineCount,
//           // When multiple marks are merged into one physical shipper row, the
//           // exact per-mark quantity is not reliable from the consolidated row.
//           // Comparison should match by mark/length but downgrade qty mismatch
//           // to ambiguous instead of creating a false critical mismatch.
//           qtyShared: marks.length > 1,
//           sharedMarkCount: marks.length,
//           sharedGroupQty: group.totalQty,
//           expectedSource: 'bom_items_shipper_group',
//         })
//       }
//     } else {
//       rows.push({
//         _id: group._ids[0] || null,
//         bomItemIds: group._ids,
//         markId: '_',
//         partCode: group.partCode,
//         partColor: group.partColor,
//         description,
//         category: group.category,
//         lengthFeet: group.lengthFeet,
//         totalQty: group.totalQty,
//         totalWeight: group.totalWeight,
//         material: group.material,
//         sourceLineCount: group.sourceLineCount,
//         qtyShared: false,
//         expectedSource: 'bom_items_shipper_group',
//       })
//     }
//   }

//   return rows
// }

// const buildExpectedRowsForComparison = async (consolidatedBOM) => {
//   const bomItemIds = uniq(
//     (consolidatedBOM.items || [])
//       .flatMap((item) => item.bomItemIds || [])
//       .map((id) => String(id))
//   )

//   if (bomItemIds.length) {
//     const bomItems = await BOMItem.find({ _id: { $in: bomItemIds } }).lean()
//     if (bomItems.length) {
//       return {
//         rows: normalizeExpectedFromBomItemsForShipper(bomItems),
//         meta: {
//           expectedSource: 'bom_items_shipper_group',
//           bomItemIdsFound: bomItemIds.length,
//           bomItemsLoaded: bomItems.length,
//         },
//       }
//     }
//   }

//   // Fallback for older records where bomItemIds were not saved.
//   return {
//     rows: normalizeExpected(consolidatedBOM.items || []),
//     meta: {
//       expectedSource: 'consolidated_items_fallback',
//       bomItemIdsFound: bomItemIds.length,
//       bomItemsLoaded: 0,
//     },
//   }
// }

// const normalizeExpected = (items) => {
//   const rows = []

//   for (const item of items || []) {
//     const marks = splitMarkList(item.markIds)
//     const totalQty = Number(item.totalQty || 0)
//     const lengthFeet = expectedPieceLengthFeet(item)
//     const material = normalizeMaterial({
//       partCode: item.partCode,
//       description: item.description,
//       color: item.color,
//       partColor: item.partColor,
//     })

//     const base = {
//       _id: item._id,
//       partCode: item.partCode || null,
//       partColor: item.partColor || null,
//       description: item.description || '',
//       category: item.category || '',
//       lengthFeet,
//       totalQty,
//       totalLengthFeet: toNum(item.totalLengthFeet),
//       material,
//       sourceLineCount: item.sourceLineCount || 0,
//     }

//     if (marks.length <= 1) {
//       rows.push({ ...base, markId: marks[0] || null, qtyShared: false })
//       continue
//     }

//     // Same schema cannot safely know qty-per-mark if multiple marks are merged.
//     // Keep rows comparable by mark+length, but treat qty mismatch as ambiguous.
//     for (const mark of marks) {
//       rows.push({
//         ...base,
//         markId: mark,
//         qtyShared: true,
//         sharedMarkCount: marks.length,
//       })
//     }
//   }

//   return rows
// }

// /* =========================================================
//  * Matching helpers
//  * ========================================================= */
// const keyOf = (mark, feet, anonKey = '_') => {
//   const m = effectiveMarkForKey(mark)
//   const identity = m || `_${anonKey || '_'}`
//   return `${identity}|${lengthBucketInches(feet) ?? '_'}`
// }

// const groupSide = (rows, { mark, len, qty, id, materialGetter }) => {
//   const map = new Map()

//   for (const r of rows) {
//     const material = materialGetter ? materialGetter(r) : r.material || null
//     const anonKey = anonymousMaterialKey(r, material)
//     const k = keyOf(r[mark], r[len], anonKey)
//     const normalizedMark = effectiveMarkForKey(r[mark])
//     if (!map.has(k)) {
//       map.set(k, {
//         key: k,
//         mark: r[mark] || '',
//         markNormalized: normalizedMark,
//         lengthFeet: r[len] ?? null,
//         lengthBucketInches: lengthBucketInches(r[len]),
//         totalQty: 0,
//         ids: [],
//         partCodes: new Set(),
//         descriptions: new Set(),
//         materials: [],
//         sampleDescription: r.description || '',
//         samplePartCode: r.partCode || r.product || '',
//         sourceLineCount: 0,
//         qtyShared: Boolean(r.qtyShared),
//       })
//       if (material) map.get(k).materials.push(material)
//     }

//     const g = map.get(k)
//     g.totalQty += Number(r[qty] || 0)
//     if (r[id] != null) g.ids.push(r[id])

//     const pc = normCode(r.partCode || r.product)
//     if (pc) g.partCodes.add(pc)
//     if (r.description) g.descriptions.add(r.description)
//     if (r.material) g.materials.push(r.material)
//     if (r.rawRow?.canonicalMaterial) g.materials.push(r.rawRow.canonicalMaterial)
//     if (r.qtyShared) g.qtyShared = true
//     g.sourceLineCount += 1
//   }

//   return map
// }

// const representativeMaterial = (materials) => {
//   const clean = (materials || []).filter(Boolean)
//   if (!clean.length) return null

//   const withKey = clean.find((m) => m.materialKey)
//   if (withKey) return withKey

//   return clean.sort((a, b) => safe(b.confidence) - safe(a.confidence))[0]
// }

// const snap = (g) => ({
//   mark: g.mark,
//   lengthFeet: g.lengthFeet,
//   lengthBucketInches: g.lengthBucketInches,
//   totalQty: g.totalQty,
//   partCodes: [...g.partCodes],
//   partCode: g.samplePartCode,
//   description: g.sampleDescription,
//   material: representativeMaterial(g.materials),
//   sourceLineCount: g.sourceLineCount,
//   qtyShared: g.qtyShared,
// })

// const buildResult = (request, extra) => ({
//   shipperRequestId: request._id,
//   leadId: request.leadId,
//   consolidatedBOMId: request.consolidatedBOMId,
//   vendorId: request.vendorId,
//   ...extra,
// })

// const frameMarkKey = (mark) => {
//   const normalized = normMark(mark).replace(/[^A-Z0-9]/g, '')
//   if (!normalized) return null
//   if (!/^(RF|EW)/.test(normalized)) return null
//   return normalized
// }

// const anonymousRowCompatible = (exp, rec) => {
//   if (exp.markNormalized || rec.markNormalized) return false

//   const expBucket = exp.lengthBucketInches
//   const recBucket = rec.lengthBucketInches
//   if (expBucket !== recBucket) return false

//   const expPartCodes = [...(exp.partCodes || [])].filter(Boolean)
//   const recPartCodes = [...(rec.partCodes || [])].filter(Boolean)

//   if (
//     expPartCodes.length &&
//     recPartCodes.length &&
//     expPartCodes.some((code) => recPartCodes.includes(code))
//   ) {
//     return true
//   }

//   const expMat = representativeMaterial(exp.materials)
//   const recMat = representativeMaterial(rec.materials)
//   const mat = materialCompatibility(expMat, recMat)
//   if (mat.compatible === true) return true

//   const expDesc = normCode(exp.sampleDescription)
//   const recDesc = normCode(rec.sampleDescription)
//   if (expDesc && recDesc && (expDesc.includes(recDesc) || recDesc.includes(expDesc))) {
//     return true
//   }

//   // Last safe fallback for alpha-only product-code extraction edge cases:
//   // if one side has MRS/BTL/POP/RLCLINGL as part code and the other side's
//   // description starts with that code, treat it as the same anonymous material.
//   if (expPartCodes.length && recDesc) {
//     return expPartCodes.some((code) => recDesc.startsWith(code) || recDesc.includes(code))
//   }
//   if (recPartCodes.length && expDesc) {
//     return recPartCodes.some((code) => expDesc.startsWith(code) || expDesc.includes(code))
//   }

//   return false
// }

// const findReceivedMatch = (exp, receivedMap, used) => {
//   const exact = receivedMap.get(exp.key)
//   if (exact && !used.has(exact.key)) {
//     return { type: 'exact', group: exact }
//   }

//   const sameMark = [...receivedMap.values()].filter(
//     (r) => !used.has(r.key) && r.markNormalized && r.markNormalized === exp.markNormalized
//   )

//   if (!sameMark.length) {
//     // Frame/no-part-code fallback:
//     // match only when RF/EW mark canonical forms are equal and length is within tolerance.
//     const expHasPartCode = Boolean(exp.samplePartCode && normCode(exp.samplePartCode))
//     const expFrameKey = !expHasPartCode ? frameMarkKey(exp.mark) : null

//     if (expFrameKey) {
//       const frameCandidates = [...receivedMap.values()].filter(
//         (r) => !used.has(r.key) && frameMarkKey(r.mark) === expFrameKey
//       )

//       const frameWithinTolerance = frameCandidates
//         .map((r) => ({ group: r, diff: lengthDiffInches(exp.lengthFeet, r.lengthFeet) }))
//         .filter((x) => x.diff != null && x.diff <= LENGTH_TOLERANCE_INCH)
//         .sort((a, b) => a.diff - b.diff)

//       if (frameWithinTolerance.length) {
//         return {
//           type: 'frame_mark_within_tolerance',
//           group: frameWithinTolerance[0].group,
//           diffInches: frameWithinTolerance[0].diff,
//         }
//       }
//     }

//     const anonymousCandidates = [...receivedMap.values()]
//       .filter((r) => !used.has(r.key) && anonymousRowCompatible(exp, r))
//       .sort((a, b) => {
//         const aPartHit = [...(exp.partCodes || [])].some((code) => (a.partCodes || new Set()).has(code)) ? 0 : 1
//         const bPartHit = [...(exp.partCodes || [])].some((code) => (b.partCodes || new Set()).has(code)) ? 0 : 1
//         return aPartHit - bPartHit
//       })

//     if (anonymousCandidates.length) {
//       return {
//         type: 'anonymous_material_length',
//         group: anonymousCandidates[0],
//       }
//     }

//     return { type: 'none', group: null }
//   }

//   const withinTolerance = sameMark
//     .map((r) => ({ group: r, diff: lengthDiffInches(exp.lengthFeet, r.lengthFeet) }))
//     .filter((x) => x.diff != null && x.diff <= LENGTH_TOLERANCE_INCH)
//     .sort((a, b) => a.diff - b.diff)

//   if (withinTolerance.length) {
//     return { type: 'within_tolerance', group: withinTolerance[0].group, diffInches: withinTolerance[0].diff }
//   }

//   const nearest = sameMark
//     .map((r) => ({ group: r, diff: lengthDiffInches(exp.lengthFeet, r.lengthFeet) }))
//     .sort((a, b) => safe(a.diff) - safe(b.diff))[0]

//   return { type: 'same_mark_length_mismatch', group: nearest?.group || sameMark[0], diffInches: nearest?.diff ?? null }
// }

// /* =========================================================
//  * Comparison engine
//  * No AI final judgement. Deterministic only.
//  * ========================================================= */
// const compareMaterials = (expectedRows, receivedRows, request) => {
//   const expected = groupSide(expectedRows, {
//     mark: 'markId',
//     len: 'lengthFeet',
//     qty: 'totalQty',
//     id: '_id',
//     materialGetter: (r) => r.material,
//   })

//   const received = groupSide(receivedRows, {
//     mark: 'pieceMark',
//     len: 'lengthFeet',
//     qty: 'pieceQty',
//     id: '_id',
//     materialGetter: (r) => r.rawRow?.canonicalMaterial,
//   })

//   const results = []
//   const exceptions = []
//   const used = new Set()

//   for (const exp of expected.values()) {
//     const match = findReceivedMatch(exp, received, used)
//     const rec = match.group

//     if (!rec) {
//       const reason = `Expected mark ${exp.mark || 'n/a'} (${fmtFt(exp.lengthFeet)}) not found in vendor quote.`
//       results.push(buildResult(request, {
//         consolidatedItemId: exp.ids[0] || null,
//         vendorQuoteLineIds: [],
//         vendorQuoteLineId: null,
//         status: 'missing_in_vendor_quote',
//         severity: 'critical',
//         matchMethod: 'none',
//         matchConfidence: 0,
//         reason,
//         expected: snap(exp),
//         received: null,
//         difference: { qtyDiff: -exp.totalQty },
//       }))
//       exceptions.push({ issueType: 'missing', severity: 'critical', reason, mark: exp.mark })
//       continue
//     }

//     used.add(rec.key)

//     if (match.type === 'same_mark_length_mismatch') {
//       const reason = `Mark ${exp.mark} found but length differs: expected ${fmtFt(exp.lengthFeet)}, vendor ${fmtFt(rec.lengthFeet)}.`
//       results.push(buildResult(request, {
//         consolidatedItemId: exp.ids[0] || null,
//         vendorQuoteLineIds: rec.ids,
//         vendorQuoteLineId: rec.ids[0] || null,
//         status: 'length_mismatch',
//         severity: 'high',
//         matchMethod: 'piece_mark',
//         matchConfidence: 0.7,
//         reason,
//         expected: snap(exp),
//         received: snap(rec),
//         difference: {
//           lengthDiffFeet: round(safe(rec.lengthFeet) - safe(exp.lengthFeet)),
//           lengthDiffInches: match.diffInches == null ? null : round(match.diffInches, 3),
//         },
//       }))
//       exceptions.push({ issueType: 'length_mismatch', severity: 'high', reason, mark: exp.mark })
//       continue
//     }

//     const expMat = representativeMaterial(exp.materials)
//     const recMat = representativeMaterial(rec.materials)
//     let matCheck = materialCompatibility(expMat, recMat)
//     const qtyDiff = rec.totalQty - exp.totalQty

//     const expectedPartCodes = [...exp.partCodes].filter(Boolean)
//     const receivedPartCodes = [...rec.partCodes].filter(Boolean)
//     const sameNormalizedPartCode =
//       expectedPartCodes.length > 0 &&
//       receivedPartCodes.length > 0 &&
//       expectedPartCodes.some((code) => receivedPartCodes.includes(code))

//     // If normalized part codes are already equal, do not fail as part mismatch.
//     if (sameNormalizedPartCode && matCheck.compatible === false) {
//       matCheck = {
//         compatible: true,
//         confidence: Math.max(0.9, Number(matCheck.confidence || 0)),
//         reason: 'Normalized part codes match; treating material as compatible.',
//       }
//     }

//     if (qtyDiff !== 0 && (exp.qtyShared || rec.qtyShared)) {
//       const reason = `Mark ${exp.mark} matched, but BOM quantity is shared across multiple marks; per-mark quantity cannot be verified automatically (BOM total ${exp.totalQty}, vendor ${rec.totalQty}). Manual review required.`
//       results.push(buildResult(request, {
//         consolidatedItemId: exp.ids[0] || null,
//         vendorQuoteLineIds: rec.ids,
//         vendorQuoteLineId: rec.ids[0] || null,
//         status: 'ambiguous_match',
//         severity: 'medium',
//         matchMethod: 'piece_mark',
//         matchConfidence: 0.6,
//         reason,
//         expected: snap(exp),
//         received: snap(rec),
//         difference: { qtyDiff, qtyShared: true, materialCheck: matCheck },
//       }))
//       exceptions.push({ issueType: 'ambiguous', severity: 'medium', reason, mark: exp.mark })
//       continue
//     }

//     if (qtyDiff !== 0) {
//       const dir = qtyDiff < 0 ? 'short' : 'over'
//       const reason = `Quantity ${dir}: expected ${exp.totalQty}, vendor quoted ${rec.totalQty} (${dir === 'short' ? '' : '+'}${qtyDiff}).`
//       results.push(buildResult(request, {
//         consolidatedItemId: exp.ids[0] || null,
//         vendorQuoteLineIds: rec.ids,
//         vendorQuoteLineId: rec.ids[0] || null,
//         status: 'qty_mismatch',
//         severity: 'critical',
//         matchMethod: 'piece_mark',
//         matchConfidence: 0.97,
//         reason,
//         expected: snap(exp),
//         received: snap(rec),
//         difference: { qtyDiff, direction: dir, materialCheck: matCheck },
//       }))
//       exceptions.push({ issueType: 'qty_mismatch', severity: 'critical', reason, mark: exp.mark, direction: dir })
//       continue
//     }

//     if (matCheck.compatible === false) {
//       const reason = `${matCheck.reason} Mark and length matched, qty matched, but material is not equivalent.`
//       results.push(buildResult(request, {
//         consolidatedItemId: exp.ids[0] || null,
//         vendorQuoteLineIds: rec.ids,
//         vendorQuoteLineId: rec.ids[0] || null,
//         status: 'part_mismatch',
//         severity: 'high',
//         matchMethod: 'piece_mark',
//         matchConfidence: 0.75,
//         reason,
//         expected: snap(exp),
//         received: snap(rec),
//         difference: { qtyDiff: 0, materialCheck: matCheck },
//       }))
//       exceptions.push({ issueType: 'part_mismatch', severity: 'high', reason, mark: exp.mark })
//       continue
//     }

//     const materialNote = matCheck.compatible === true ? matCheck.reason : matCheck.reason
//     const confidence = matCheck.compatible === true ? 0.99 : 0.92
//     const reason = `Matched on piece mark, length and quantity. ${materialNote}`

//     results.push(buildResult(request, {
//       consolidatedItemId: exp.ids[0] || null,
//       vendorQuoteLineIds: rec.ids,
//       vendorQuoteLineId: rec.ids[0] || null,
//       status: 'matched',
//       severity: 'low',
//       matchMethod: 'piece_mark',
//       matchConfidence: confidence,
//       reason,
//       expected: snap(exp),
//       received: snap(rec),
//       difference: {
//         qtyDiff: 0,
//         lengthDiffFeet: round(safe(rec.lengthFeet) - safe(exp.lengthFeet)),
//         lengthDiffInches: lengthDiffInches(exp.lengthFeet, rec.lengthFeet),
//         materialCheck: matCheck,
//       },
//     }))
//   }

//   for (const rec of received.values()) {
//     if (used.has(rec.key)) continue

//     const reason = `Vendor quoted mark ${rec.mark || 'n/a'} (${fmtFt(rec.lengthFeet)}) not present in Consolidated BOM.`
//     results.push(buildResult(request, {
//       consolidatedItemId: null,
//       vendorQuoteLineIds: rec.ids,
//       vendorQuoteLineId: rec.ids[0] || null,
//       status: 'extra_in_vendor_quote',
//       severity: 'medium',
//       matchMethod: 'none',
//       matchConfidence: 0,
//       reason,
//       expected: null,
//       received: snap(rec),
//       difference: { qtyDiff: rec.totalQty },
//     }))
//     exceptions.push({ issueType: 'extra', severity: 'medium', reason, mark: rec.mark })
//   }

//   const count = (status) => results.filter((r) => r.status === status).length

//   const summary = {
//     expectedLines: expected.size,
//     vendorLines: received.size,
//     matchedLines: count('matched'),
//     missingItems: count('missing_in_vendor_quote'),
//     extraItems: count('extra_in_vendor_quote'),
//     qtyMismatches: count('qty_mismatch'),
//     lengthMismatches: count('length_mismatch'),
//     weightMismatches: 0,
//     priceMismatches: 0,
//     partMismatches: count('part_mismatch'),
//     ambiguousMatches: count('ambiguous_match'),
//     manualReviewRequired: results.filter((r) =>
//       ['ambiguous_match', 'missing_in_vendor_quote', 'extra_in_vendor_quote', 'part_mismatch', 'length_mismatch', 'qty_mismatch'].includes(r.status)
//     ).length,
//     extractionNote: `${SERVICE_VERSION}: compared against BOMItem shipper-style grouping, not priced ConsolidatedBOM item summary.`,
//   }

//   return { results, summary, exceptions }
// }

// const expandReceivedRows = (rows) => {
//   const expanded = []

//   for (const row of rows || []) {
//     const marks = splitMarkList(row.pieceMark)

//     if (!marks.length) {
//       expanded.push(row)
//       continue
//     }

//     for (const mark of marks) {
//       expanded.push({
//         ...row,
//         pieceMark: mark,
//         qtyShared: marks.length > 1,
//         sharedMarkCount: marks.length,
//         sharedGroupQty: row.pieceQty,
//       })
//     }
//   }

//   return expanded
// }

// /* =========================================================
//  * Public: run one comparison
//  * ========================================================= */
// const compareShipperRequest = async (requestId) => {
//   const request = await ShipperRequest.findById(requestId)
//   if (!request) throw new Error('Shipper request not found')
//   if (!request.submittedFileUrl) throw new Error('Vendor has not submitted a file yet')

//   await ShipperRequest.findByIdAndUpdate(requestId, {
//     status: 'comparison_processing',
//     comparisonStatus: 'processing',
//     comparisonError: null,
//   })

//   try {
//     const consolidatedBOM = await ConsolidatedBOM.findById(request.consolidatedBOMId).lean()
//     if (!consolidatedBOM) throw new Error('Consolidated BOM not found')

//     const { items: vendorItems, format, extractionMethod } = await extractVendorItems({
//       fileUrl: request.submittedFileUrl,
//       fileName: request.submittedFileName,
//     })

//     if (!vendorItems.length) {
//       throw new Error('No vendor line items could be extracted from the submitted file')
//     }

//     await VendorQuoteLine.deleteMany({ shipperRequestId: request._id })
//     await QuoteComparisonResult.deleteMany({ shipperRequestId: request._id })

//     const vendorDocs = await VendorQuoteLine.insertMany(
//       vendorItems.map((it) => toVendorQuoteLineDoc(it, request, format, extractionMethod)),
//       { ordered: false }
//     )

//     const { rows: expectedRows, meta: expectedMeta } = await buildExpectedRowsForComparison(consolidatedBOM)
//     const receivedRows = expandReceivedRows(vendorDocs.map((d) => ({
//       _id: d._id,
//       pieceMark: d.pieceMark,
//       lengthFeet: d.lengthFeet,
//       pieceQty: d.pieceQty != null ? d.pieceQty : d.qty,
//       description: d.description,
//       partCode: d.partCode,
//       rawRow: d.rawRow,
//     })))

//     const { results, summary, exceptions } = compareMaterials(expectedRows, receivedRows, request)

//     if (results.length) {
//       await QuoteComparisonResult.insertMany(results, { ordered: false })
//     }

//     await ShipperRequest.findByIdAndUpdate(requestId, {
//       status: 'comparison_completed',
//       comparisonStatus: 'completed',
//       comparisonSummary: {
//         ...summary,
//         ...expectedMeta,
//         serviceVersion: SERVICE_VERSION,
//         extractionFormat: format,
//         extractionMethod,
//         extractedVendorLines: vendorItems.length,
//       },
//       comparisonRanAt: new Date(),
//       comparisonError: null,
//       exceptions,
//     })

//     return {
//       summary: {
//         ...summary,
//         ...expectedMeta,
//         serviceVersion: SERVICE_VERSION,
//         extractionFormat: format,
//         extractionMethod,
//         extractedVendorLines: vendorItems.length,
//       },
//       exceptions,
//     }
//   } catch (err) {
//     await ShipperRequest.findByIdAndUpdate(requestId, {
//       status: 'comparison_failed',
//       comparisonStatus: 'failed',
//       comparisonError: err.message,
//     })
//     throw err
//   }
// }

// /* =========================================================
//  * Public: async job wrapper
//  * ========================================================= */
// const processShipperComparisonJob = async (jobId) => {
//   const job = await ShipperComparisonJob.findById(jobId).lean()
//   if (!job) return

//   await ShipperComparisonJob.findByIdAndUpdate(jobId, {
//     status: 'processing',
//     processingStartedAt: new Date(),
//     errorMessage: null,
//   })

//   try {
//     const { summary } = await compareShipperRequest(job.shipperRequestId)

//     const resultCount = await QuoteComparisonResult.countDocuments({
//       shipperRequestId: job.shipperRequestId,
//     })

//     await ShipperComparisonJob.findByIdAndUpdate(jobId, {
//       status: 'completed',
//       summary,
//       resultCount,
//       processingEndedAt: new Date(),
//       errorMessage: null,
//     })

//     if (global.io) {
//       global.io.of('/admin').to(`user:${job.triggeredBy}`).emit('shipper_comparison_complete', {
//         jobId,
//         requestId: job.shipperRequestId,
//         leadId: job.leadId,
//         vendorId: job.vendorId,
//         summary,
//       })
//     }
//   } catch (err) {
//     await ShipperComparisonJob.findByIdAndUpdate(jobId, {
//       status: 'failed',
//       errorMessage: err.message,
//       processingEndedAt: new Date(),
//     })

//     if (global.io) {
//       global.io.of('/admin').to(`user:${job.triggeredBy}`).emit('shipper_comparison_failed', {
//         jobId,
//         requestId: job.shipperRequestId,
//         leadId: job.leadId,
//         vendorId: job.vendorId,
//         error: err.message,
//       })
//     }
//   }
// }

// module.exports = {
//   compareShipperRequest,
//   processShipperComparisonJob,

//   // exposed for tests / reuse
//   extractVendorItems,
//   compareMaterials,
//   expandReceivedRows,
//   normalizeExpected,
//   normalizeMaterial,
//   materialCompatibility,
//   expectedPieceLengthFeet,
//   lengthToFeet,
//   lengthBucketInches,
//   detectVendorFormat,
//   parseCentralStates,
//   parseQuicken,
// }

/**
 * Shipper quote extraction + comparison pipeline.
 *
 * Demo-safe / same-schema version.
 * VERSION: shipper-comparison-v4.2-production-comparison-fixes
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

/**
 * Shipper quote extraction + comparison pipeline.
 *
 * Demo-safe / same-schema version.
 * VERSION: shipper-comparison-v4.2-production-comparison-fixes
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

/**
 * Shipper quote extraction + comparison pipeline.
 *
 * Demo-safe / same-schema version.
 * VERSION: shipper-comparison-v4.2-production-comparison-fixes
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

/**
 * Shipper quote extraction + comparison pipeline.
 *
 * Demo-safe / same-schema version.
 * VERSION: shipper-comparison-v4.2-production-comparison-fixes
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
const SERVICE_VERSION = 'shipper-comparison-v4.7-row-preserved-duplicate-qty-pairing'
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
  return String(v)
    .trim()
    .toUpperCase()
    .replace(/[，]/g, ',')
    .replace(/,+$/g, '')
    .replace(/\s+/g, '')
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

const cleanPartMarkText = (value) => {
  let s = cleanStr(value)
  if (!s) return ''

  s = s.replace(/^Part\s+Mark\s*:\s*/i, '')
  s = s.replace(/^Piece\s+Mark\s*:\s*/i, '')

  // PDF text can merge the totals row onto the mark row:
  // "DJ-1 195.4167 LF 3.0006 586.37" -> "DJ-1"
  s = s.replace(
    /\s+\d+(?:,\d{3})*(?:\.\d+)?\s+(?:LF|FT|EA|LB)\s+\d+(?:\.\d+)?\s+\d+(?:,\d{3})*(?:\.\d+)?\s*$/i,
    ''
  )

  // Also handle a shorter accidental suffix after the real mark.
  s = s.replace(/\s+(?:LF|FT|EA|LB)\b.*$/i, '')

  return s.trim().replace(/,+$/g, '')
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
  const s = String(value || '').toUpperCase().trim()
  if (!s) return null

  if (/RED\s*OXIDE|\bRO\b|\bR\.O\.\b|\bPRIME\s*,?\s*R\b|OXIDE/.test(s)) return 'RED_OXIDE'
  if (/GALV|GALVANIZED/.test(s)) return 'GALVANIZED'
  if (/\bWH\b|WHITE/.test(s)) return 'WHITE'
  if (/\bBLK\b|BLACK/.test(s)) return 'BLACK'

  // Unknown colors must stay unknown. Returning normCode(value) here turns a
  // whole description into a fake color and creates false material mismatches.
  return null
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
  let normalizedColor = normalizeColor(color || partColor) || normalizeColor(rawDescription) || normalizeColor(rawPartCode)
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
    const m = String(rawText || '').match(/Part\s+Mark\s*:\s*([^\n\r]+)/i)
    return m ? cleanPartMarkText(m[1]) : null
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

    // New item line: "<lineNo> [<product>] <description...>".
    //
    // The product/catalog code is OPTIONAL. Rigid-frame members (RF Column,
    // RF Rafter, etc.) ship with a BLANK product column, e.g. "1 RF Column".
    // The previous regex required a >=3-char code token and silently discarded
    // those lines (dropping real dollars from the comparison). We now accept any
    // line that starts with a line number and decide product-vs-description by
    // shape: a product code in this format always carries at least one digit
    // (W8X10, C83516R, RLOC26, SP2, CL-100...), whereas a description-only line
    // ("RF Column") does not.
    const head = !/^\d+\s+Pieces?\b/i.test(line) && line.match(/^(\d+)\s+(.+)$/)
    if (head) {
      flush()
      const rest = head[2].trim()
      const firstTok = rest.split(/\s+/)[0]
      // Product/catalog code can be numeric/mixed (W8X10, C83516R, RLOC26)
      // OR alpha-only (BTL, MRS, POP, RLCLINGL, RLCLOUTG). Earlier versions only
      // accepted tokens with digits, which broke anonymous/no-mark rows because
      // vendor product became null while BOM expected had partCode MRS/BTL/POP.
      const restAfterFirstToken = rest.slice(firstTok.length).trim()
      const looksLikeNumericProduct =
        /^[A-Z0-9][A-Z0-9./-]*$/i.test(firstTok) && /\d/.test(firstTok)
      const looksLikeAlphaProduct =
        /^[A-Z][A-Z0-9./-]*$/.test(firstTok) &&
        firstTok.length >= 3 &&
        restAfterFirstToken.length > 0
      const knownDescriptionLead =
        /^(RF|EW|EXT|WIND|DOOR|ROOF|WALL|RIGID|ENDWALL|ANCHOR|BOLTS?|WASHERS?|FASTENERS?|ACCESSORIES?|TRIM)$/i.test(firstTok)
      const looksLikeProduct =
        looksLikeNumericProduct || (looksLikeAlphaProduct && !knownDescriptionLead)
      cur = {
        lineNo: head[1],
        product: looksLikeProduct ? firstTok : null,
        description: looksLikeProduct ? restAfterFirstToken : rest,
        pageNumber,
        rawParts: [line],
      }
      continue
    }

    // Pieces line. The "@ <length>" suffix is OPTIONAL: count-only lines such as
    // fasteners print "84 Pieces" with no length, and without this the qty was
    // never captured (dropping those lines from qty-filtered consumers like the
    // load planner).
    const pcs = line.match(/^([\d,]+)\s+Pieces?\b\s*(?:@\s*(.+))?$/i)
    if (pcs && cur) {
      cur.pieceQty = Number(pcs[1].replace(/,/g, ''))
      if (pcs[2]) {
        cur.lengthText = pcs[2].trim()
        cur.lengthFeet = lengthToFeet(cur.lengthText)
      }
      cur.rawParts.push(line)
      continue
    }

    const lp = line.match(/^Left Punch:\s*(.*)$/i)
    if (lp && cur) {
      cur.leftPunch = lp[1].trim()
      cur.rawParts.push(line)

      // Inline mark-merge recovery: "Left Punch: PPEP Part Mark: DJ-1"
      if (!cur.mark) {
        const inlineM = lp[1].match(/Part\s+Mark\s*:\s*([^\n\r]+)/i)
        if (inlineM) cur.mark = cleanPartMarkText(inlineM[1])
      }
      continue
    }

    const rp = line.match(/^Right Punch:\s*(.*)$/i)
    if (rp && cur) {
      cur.rightPunch = rp[1].trim()
      cur.rawParts.push(line)

      // Inline mark-merge recovery: "Right Punch: PPEP Part Mark: DJ-1"
      if (!cur.mark) {
        const inlineM = rp[1].match(/Part\s+Mark\s*:\s*([^\n\r]+)/i)
        if (inlineM) cur.mark = cleanPartMarkText(inlineM[1])
      }
      continue
    }

    const mk = line.match(/^Part Mark:\s*(.+)$/i)
    if (mk && cur) {
      cur.mark = cleanPartMarkText(mk[1])
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
      cur.mark = cleanPartMarkText(mk[1])
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

  const s = cleanPartMarkText(value)
  if (!s || ['-', 'NA', 'N/A', 'NULL', 'NONE'].includes(s.toUpperCase())) return []

  return uniq(
    s
      .split(/[,;\n]+/)
      .map((m) => cleanStr(m).replace(/,+$/g, ''))
      .filter(Boolean)
      .filter((m) => !/^\+?\d+\s+more$/i.test(m))
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
    const parsedLengthFeet =
      item.lengthFeet != null && Number.isFinite(Number(item.lengthFeet))
        ? Number(item.lengthFeet)
        : lengthToFeet(item.lengthRaw)

    const identity =
      item.partCodeNormalized ||
      normCode(item.partCode) ||
      `DESC:${normCode(item.description)}`

    const colorKey = item.partColorNormalized || normCode(item.partColor) || '_'
    const lengthKey =
      parsedLengthFeet != null && Number.isFinite(Number(parsedLengthFeet))
        ? Number(parsedLengthFeet).toFixed(4)
        : '_'
    const categoryKey = normCode(item.category || item.sourceSheetName) || '_'
    const key = [categoryKey, identity || '_', colorKey, lengthKey].join('|')

    if (!groups.has(key)) {
      groups.set(key, {
        _ids: [],
        partCode: item.partCode || null,
        partColor: item.partColor || null,
        description: item.description || '',
        descriptions: new Set(),
        category: item.category || item.sourceSheetName || '',
        lengthFeet: parsedLengthFeet ?? null,
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
    if (item.description) group.descriptions.add(item.description)

    const marks = splitMarkList(item.markId)
    for (const mark of marks) group.marks.add(mark)
  }

  const rows = []
  for (const group of groups.values()) {
    const marks = [...group.marks]
    const description = [...group.descriptions].length
      ? [...group.descriptions].join(' / ')
      : group.description

    if (marks.length) {
      for (const mark of marks) {
        rows.push({
          _id: group._ids[0] || null,
          bomItemIds: group._ids,
          markId: mark,
          partCode: group.partCode,
          partColor: group.partColor,
          description,
          category: group.category,
          lengthFeet: group.lengthFeet,
          totalQty: group.totalQty,
          totalWeight: group.totalWeight,
          material: group.material,
          sourceLineCount: group.sourceLineCount,
          // When multiple marks are merged into one physical shipper row, the
          // exact per-mark quantity is not reliable from the consolidated row.
          // Comparison should match by mark/length but downgrade qty mismatch
          // to ambiguous instead of creating a false critical mismatch.
          qtyShared: marks.length > 1,
          sharedMarkCount: marks.length,
          sharedGroupQty: group.totalQty,
          expectedSource: 'bom_items_shipper_group_row_audited',
        })
      }
    } else {
      rows.push({
        _id: group._ids[0] || null,
        bomItemIds: group._ids,
        markId: '_',
        partCode: group.partCode,
        partColor: group.partColor,
        description,
        category: group.category,
        lengthFeet: group.lengthFeet,
        totalQty: group.totalQty,
        totalWeight: group.totalWeight,
        material: group.material,
        sourceLineCount: group.sourceLineCount,
        qtyShared: false,
        expectedSource: 'bom_items_shipper_group_row_audited',
      })
    }
  }

  return rows
}


const normalizeExpectedFromBomItemsRowPreserved = (bomItems) => {
  return (bomItems || []).map((item) => {
    const parsedLengthFeet =
      item.lengthFeet != null && Number.isFinite(Number(item.lengthFeet))
        ? Number(item.lengthFeet)
        : lengthToFeet(item.lengthRaw)

    const marks = splitMarkList(item.markId)
    const material = normalizeMaterial({
      partCode: item.partCode,
      description: item.description,
      color: item.partColor,
      partColor: item.partColor,
    })

    return {
      _id: item._id || null,
      bomItemIds: item._id ? [item._id] : [],
      markId: marks[0] || '_',
      partCode: item.partCode || null,
      partColor: item.partColor || null,
      description: item.description || '',
      category: item.category || item.sourceSheetName || '',
      lengthFeet: parsedLengthFeet ?? null,
      totalQty: safe(item.quantity),
      totalWeight: safe(item.weight),
      material,
      sourceLineCount: 1,
      qtyShared: false,
      expectedSource: 'bom_items_row_preserved',
    }
  })
}

const buildExpectedRowsForComparison = async (consolidatedBOM, options = {}) => {
  const bomItemIds = uniq(
    (consolidatedBOM.items || [])
      .flatMap((item) => item.bomItemIds || [])
      .map((id) => String(id))
  )

  if (bomItemIds.length) {
    const bomItems = await BOMItem.find({ _id: { $in: bomItemIds } }).lean()
    if (bomItems.length) {
      const rowPreserved = Boolean(options.rowPreserved)
      return {
        rows: rowPreserved
          ? normalizeExpectedFromBomItemsRowPreserved(bomItems)
          : normalizeExpectedFromBomItemsForShipper(bomItems),
        meta: {
          expectedSource: rowPreserved ? 'bom_items_row_preserved' : 'bom_items_shipper_group_row_audited',
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


const groupSideRowPreserved = (rows, { mark, len, qty, id, materialGetter }) => {
  const map = new Map()
  const occurrenceByBaseKey = new Map()

  for (const r of rows || []) {
    const material = materialGetter ? materialGetter(r) : r.material || null
    const anonKey = anonymousMaterialKey(r, material)
    const baseKey = keyOf(r[mark], r[len], anonKey)
    const occurrence = (occurrenceByBaseKey.get(baseKey) || 0) + 1
    occurrenceByBaseKey.set(baseKey, occurrence)
    const k = `${baseKey}|ROW:${occurrence}`
    const normalizedMark = effectiveMarkForKey(r[mark])

    const group = {
      key: k,
      baseKey,
      rowOccurrence: occurrence,
      mark: r[mark] || '',
      markNormalized: normalizedMark,
      lengthFeet: r[len] ?? null,
      lengthBucketInches: lengthBucketInches(r[len]),
      totalQty: Number(r[qty] || 0),
      ids: r[id] != null ? [r[id]] : [],
      partCodes: new Set(),
      descriptions: new Set(),
      materials: [],
      sampleDescription: r.description || '',
      samplePartCode: r.partCode || r.product || '',
      sourceLineCount: 1,
      qtyShared: Boolean(r.qtyShared),
    }

    const pc = normCode(r.partCode || r.product)
    if (pc) group.partCodes.add(pc)
    if (r.description) group.descriptions.add(r.description)
    if (material) group.materials.push(material)
    if (r.material) group.materials.push(r.material)
    if (r.rawRow?.canonicalMaterial) group.materials.push(r.rawRow.canonicalMaterial)

    map.set(k, group)
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

const anonymousRowCompatible = (exp, rec) => {
  if (exp.markNormalized || rec.markNormalized) return false

  const expBucket = exp.lengthBucketInches
  const recBucket = rec.lengthBucketInches
  if (expBucket !== recBucket) return false

  const expPartCodes = [...(exp.partCodes || [])].filter(Boolean)
  const recPartCodes = [...(rec.partCodes || [])].filter(Boolean)

  if (
    expPartCodes.length &&
    recPartCodes.length &&
    expPartCodes.some((code) => recPartCodes.includes(code))
  ) {
    return true
  }

  const expMat = representativeMaterial(exp.materials)
  const recMat = representativeMaterial(rec.materials)
  const mat = materialCompatibility(expMat, recMat)
  if (mat.compatible === true) return true

  const expDesc = normCode(exp.sampleDescription)
  const recDesc = normCode(rec.sampleDescription)
  if (expDesc && recDesc && (expDesc.includes(recDesc) || recDesc.includes(expDesc))) {
    return true
  }

  // Last safe fallback for alpha-only product-code extraction edge cases:
  // if one side has MRS/BTL/POP/RLCLINGL as part code and the other side's
  // description starts with that code, treat it as the same anonymous material.
  if (expPartCodes.length && recDesc) {
    return expPartCodes.some((code) => recDesc.startsWith(code) || recDesc.includes(code))
  }
  if (recPartCodes.length && expDesc) {
    return recPartCodes.some((code) => expDesc.startsWith(code) || expDesc.includes(code))
  }

  return false
}


const scoreRowPreservedCandidate = (exp, rec) => {
  // Lower score is better. In row-preserved mode, multiple rows can legitimately
  // share the same mark/length/material base key. Occurrence order from the BOM
  // and occurrence order from PDF extraction are not guaranteed to be identical,
  // so we pair duplicates by strongest business signal first: quantity.
  let score = 0

  const qtyDiff = Math.abs(Number(rec.totalQty || 0) - Number(exp.totalQty || 0))
  score += qtyDiff * 100000

  const expPartCodes = [...(exp.partCodes || [])].filter(Boolean)
  const recPartCodes = [...(rec.partCodes || [])].filter(Boolean)
  const partHit =
    expPartCodes.length > 0 &&
    recPartCodes.length > 0 &&
    expPartCodes.some((code) => recPartCodes.includes(code))

  if (partHit) score -= 1000
  else if (expPartCodes.length && recPartCodes.length) score += 1000

  const expMat = representativeMaterial(exp.materials)
  const recMat = representativeMaterial(rec.materials)
  const mat = materialCompatibility(expMat, recMat)
  if (mat.compatible === true) score -= 500
  if (mat.compatible === false) score += 500

  const expDesc = normCode(exp.sampleDescription)
  const recDesc = normCode(rec.sampleDescription)
  if (expDesc && recDesc) {
    if (expDesc === recDesc) score -= 250
    else if (expDesc.includes(recDesc) || recDesc.includes(expDesc)) score -= 100
  }

  const lengthDiff = lengthDiffInches(exp.lengthFeet, rec.lengthFeet)
  if (lengthDiff != null) score += lengthDiff * 10

  // Occurrence order is only a tie-breaker, never the primary matching signal.
  score += Math.abs(Number(exp.rowOccurrence || 0) - Number(rec.rowOccurrence || 0)) / 1000

  return score
}

const findReceivedMatchRowPreserved = (exp, receivedMap, used) => {
  // First, handle duplicate rows that share the same row-preserved base key.
  // This fixes cases like two 114MM screw rows where occurrence order is swapped
  // between BOM and PDF extraction. We should match 1250 to 1250 and 4750 to 4750,
  // not ROW:1 to ROW:1 blindly.
  if (exp.baseKey) {
    const sameBaseCandidates = [...receivedMap.values()].filter(
      (r) => !used.has(r.key) && r.baseKey && r.baseKey === exp.baseKey
    )

    if (sameBaseCandidates.length) {
      const ranked = sameBaseCandidates
        .map((group) => ({ group, score: scoreRowPreservedCandidate(exp, group) }))
        .sort((a, b) => a.score - b.score)

      return {
        type: ranked[0].group.key === exp.key ? 'exact' : 'row_preserved_best_occurrence',
        group: ranked[0].group,
        duplicatePairingScore: ranked[0].score,
      }
    }
  }

  // Fall back to the stable v4.3/v4.5 matcher for parser edge cases where the
  // base key differs due to vendor formatting but the row is still comparable.
  return findReceivedMatch(exp, receivedMap, used)
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

    const anonymousCandidates = [...receivedMap.values()]
      .filter((r) => !used.has(r.key) && anonymousRowCompatible(exp, r))
      .sort((a, b) => {
        const aPartHit = [...(exp.partCodes || [])].some((code) => (a.partCodes || new Set()).has(code)) ? 0 : 1
        const bPartHit = [...(exp.partCodes || [])].some((code) => (b.partCodes || new Set()).has(code)) ? 0 : 1
        return aPartHit - bPartHit
      })

    if (anonymousCandidates.length) {
      return {
        type: 'anonymous_material_length',
        group: anonymousCandidates[0],
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
const compareMaterials = (expectedRows, receivedRows, request, options = {}) => {
  const enforceRowPreservedAudit = Boolean(options.enforceRowPreservedAudit)
  const sideGrouper = enforceRowPreservedAudit ? groupSideRowPreserved : groupSide

  const expected = sideGrouper(expectedRows, {
    mark: 'markId',
    len: 'lengthFeet',
    qty: 'totalQty',
    id: '_id',
    materialGetter: (r) => r.material,
  })

  const received = sideGrouper(receivedRows, {
    mark: 'pieceMark',
    len: 'lengthFeet',
    qty: 'pieceQty',
    id: '_id',
    materialGetter: (r) => r.rawRow?.canonicalMaterial,
  })

  const expectedInputLineCount = Array.isArray(expectedRows) ? expectedRows.length : expected.size
  const vendorComparisonLineCount = received.size

  const results = []
  const exceptions = []
  const used = new Set()

  for (const exp of expected.values()) {
    const match = enforceRowPreservedAudit
      ? findReceivedMatchRowPreserved(exp, received, used)
      : findReceivedMatch(exp, received, used)
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

  // Row-preserved audit:
  // v4.3 intentionally grouped some comparison rows by mark+length to avoid false
  // material mismatches. That was useful for matching, but it hid cases where a
  // single-building consolidated BOM had 79 separate lines while the vendor quote
  // effectively represented only 76 comparable lines.
  //
  // In row-preserved mode, if multiple expected input rows collapsed into one
  // matched comparison group, we keep the robust match for the first line and add
  // synthetic missing rows for the hidden source lines. This makes the summary
  // fail correctly as 79 expected vs 76 vendor lines, without exploding into
  // false missing+extra pairs.
  if (enforceRowPreservedAudit && expectedInputLineCount > expected.size) {
    const auditRows = []

    for (const r of results) {
      if (r.status !== 'matched') continue

      const hiddenExpectedRows = Math.max(0, Number(r.expected?.sourceLineCount || 1) - 1)
      if (!hiddenExpectedRows) continue

      for (let i = 0; i < hiddenExpectedRows; i += 1) {
        const markLabel = r.expected?.mark || 'n/a'
        const reason = `Vendor quote collapsed multiple row-preserved BOM items into one comparable line for mark ${markLabel}. Separate vendor line missing for source BOM row ${i + 2} of ${hiddenExpectedRows + 1}.`

        auditRows.push(buildResult(request, {
          consolidatedItemId: r.consolidatedItemId || null,
          vendorQuoteLineIds: [],
          vendorQuoteLineId: null,
          status: 'missing_in_vendor_quote',
          severity: 'critical',
          matchMethod: 'row_preserved_line_audit',
          matchConfidence: 0,
          reason,
          expected: {
            ...(r.expected || {}),
            rowPreservedAudit: true,
            collapsedComparisonSourceLineCount: r.expected?.sourceLineCount || null,
          },
          received: null,
          difference: {
            qtyDiff: 0,
            rowPreservedMissingLine: true,
            hiddenExpectedRows,
          },
        }))

        exceptions.push({
          issueType: 'missing',
          severity: 'critical',
          reason,
          mark: markLabel,
          auditType: 'row_preserved_line_audit',
        })
      }
    }

    results.push(...auditRows)
  }

  const count = (status) => results.filter((r) => r.status === status).length

  const summary = {
    expectedLines: enforceRowPreservedAudit ? expectedInputLineCount : expected.size,
    vendorLines: vendorComparisonLineCount,
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
    extractionNote: `${SERVICE_VERSION}: row-preserved BOM matching with duplicate quantity-aware pairing. Single-building row-preserved BOMs pass only when vendor preserves separate comparable lines.`,
  }

  return { results, summary, exceptions }
}

const expandReceivedRows = (rows) => {
  const expanded = []

  for (const row of rows || []) {
    const marks = splitMarkList(row.pieceMark)

    if (!marks.length) {
      expanded.push(row)
      continue
    }

    for (const mark of marks) {
      expanded.push({
        ...row,
        pieceMark: mark,
        qtyShared: marks.length > 1,
        sharedMarkCount: marks.length,
        sharedGroupQty: row.pieceQty,
      })
    }
  }

  return expanded
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

    const consolidatedItems = consolidatedBOM.items || []
    const rowPreservedConsolidated =
      consolidatedItems.length > 0 &&
      consolidatedItems.every((item) => Number(item.sourceLineCount || 1) === 1 && (item.bomItemIds || []).length <= 1)

    const { rows: expectedRows, meta: expectedMeta } = await buildExpectedRowsForComparison(consolidatedBOM, {
      rowPreserved: rowPreservedConsolidated,
    })

    const receivedRows = expandReceivedRows(vendorDocs.map((d) => ({
      _id: d._id,
      pieceMark: d.pieceMark,
      lengthFeet: d.lengthFeet,
      pieceQty: d.pieceQty != null ? d.pieceQty : d.qty,
      description: d.description,
      partCode: d.partCode,
      rawRow: d.rawRow,
    })))

    const { results, summary, exceptions } = compareMaterials(expectedRows, receivedRows, request, {
      enforceRowPreservedAudit: rowPreservedConsolidated,
      consolidatedItemCount: consolidatedItems.length,
    })

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
  expandReceivedRows,
  normalizeExpected,
  normalizeExpectedFromBomItemsRowPreserved,
  groupSideRowPreserved,
  findReceivedMatchRowPreserved,
  scoreRowPreservedCandidate,
  normalizeMaterial,
  materialCompatibility,
  expectedPieceLengthFeet,
  lengthToFeet,
  lengthBucketInches,
  detectVendorFormat,
  parseCentralStates,
  parseQuicken,
}