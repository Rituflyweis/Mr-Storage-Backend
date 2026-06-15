/**
 * Parser for MBS-style fixed-width ".out" BOM cost reports.
 *
 * File structure:
 *   - Sections delimited by "====" lines.
 *   - Each section: title line ("<project> N.SECTION NAME:  <date>"),
 *     column header line ("Quan Mark Description ... Length Weight Cost"),
 *     data rows, optional continuation lines (Web=, Loc=, A=, punch data),
 *     a Colors legend, and a Total row.
 *   - Ends with "Summary Reports" + optional cost warnings.
 *
 * Strategy:
 *   - Column positions vary per section, so we locate column start indices
 *     from the header line and slice left-aligned text columns (Part, Color).
 *   - Numeric columns (Quan / Length / Weight / Cost) are parsed by token
 *     position: Quan = leading integer, Cost = last token, Weight = second
 *     last, Length = third-last token when it looks like a length.
 *   - Data rows are identified by an integer quantity starting within the
 *     first few characters of the line. Continuation/punch lines are deeply
 *     indented and therefore excluded.
 */

const SECTION_TITLE_RE = /^\s*.*?(\d+)\.([A-Z][A-Z0-9 &,'/()-]+):/
const LENGTH_TOKEN_RE = /^(?:\d+')?(?:\d+)?(?:-\d+)?"$|^\d+'\d{2}-\d{2}"$|^\d+-\d{2}"$/
const DATA_ROW_RE = /^\s{0,8}(\d+)\s+\S/

const KNOWN_COLOR_CODES_MAX_LEN = 2

const cleanLine = (line) => line.replace(/\r/g, '').replace(/\f/g, '')

const isSeparator = (line) => /^=+\s*$/.test(line.trim()) || /^-+\s*$/.test(line.trim())

const looksLikeLength = (token) => {
  if (!token) return false
  // 11'11-09"  |  1-04"  |  0-00"  |  300'00-00"  |  9-00"
  return /^(\d+')?\d{1,2}-\d{2}"$/.test(token) || /^\d+'\d{2}-\d{2}"$/.test(token)
}

const parseOutLengthToFeet = (token) => {
  if (!token) return null
  const m = String(token).match(/^(?:(\d+)')?(\d{1,2})-(\d{2})"$/)
  if (!m) return null
  const feet = Number(m[1] || 0)
  const inches = Number(m[2] || 0)
  const sixteenths = Number(m[3] || 0)
  // MBS format: FF'II-SS" where SS is sixteenths of an inch
  return feet + (inches + sixteenths / 16) / 12
}

const toNum = (val) => {
  if (val == null || val === '') return null
  const n = Number(String(val).replace(/[$,]/g, '').trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Find column header line within a section. It is the line containing
 * "Quan" and "Cost" (and usually "Description").
 */
const isHeaderLine = (line) =>
  /\bQuan\b/.test(line) && /\bCost\b/.test(line) && /\bDescription\b/.test(line)

/**
 * Build column slice map from the header line.
 * Left-aligned text columns (Mark, Description, Part) are sliced
 * [labelStart, nextLabelStart). Color column label varies:
 * "Clr", "Color", "Punch/Color" (two-line header), "Width/Color", "Type/Color".
 */
const buildColumnMap = (headerLine, prevLine) => {
  const cols = {}
  const find = (label) => {
    const idx = headerLine.indexOf(label)
    return idx >= 0 ? idx : null
  }

  cols.mark = find('Mark')
  cols.description = find('Description')
  cols.part = find('Part')

  // Color column: "Clr" or "Color" on header line, or "Color" appearing
  // under a stacked label (e.g. "Punch/" on prevLine, "Color" on headerLine).
  let colorIdx = headerLine.indexOf('Clr')
  if (colorIdx < 0) colorIdx = headerLine.indexOf('Color')
  cols.color = colorIdx >= 0 ? colorIdx : null

  cols.length = find('Length')
  cols.weight = find('Weight')
  cols.cost = headerLine.lastIndexOf('Cost')

  return cols
}

const sliceCol = (line, start, end) => {
  if (start == null || start < 0) return null
  // Fixed-width reports occasionally misalign data by a character or two
  // relative to the header label. If we land mid-token, walk left to its start.
  let s = start
  while (s > 0 && line[s] && line[s] !== ' ' && line[s - 1] && line[s - 1] !== ' ') {
    s--
  }
  const out = line.slice(s, end == null ? undefined : end).trim()
  return out || null
}

/**
 * Locate the first whitespace-delimited token at or after a header column index.
 *
 * Fixed-width .out reports frequently print the Part/Clr DATA shifted several
 * characters to the RIGHT of the header label (observed: Angles & Trim sections
 * are offset ~9 chars). The old fixed-window slice [colStart, colStart+N] then
 * landed in whitespace and silently dropped the value. This scans rightward to
 * the actual token instead.
 *
 * `tailStartIdx` is the column where the trailing numeric block (length/weight/
 * cost) begins. A token that starts inside that block is NOT a text-column value
 * (e.g. a frame member with a blank Part column), so we return null in that case.
 */
const findColumnToken = (line, startIdx, tailStartIdx) => {
  if (startIdx == null || startIdx < 0) return null

  let s = startIdx
  // If the header label sits a char or two to the right of the data and we land
  // mid-token, walk left to the token start.
  while (s > 0 && line[s] && line[s] !== ' ' && line[s - 1] && line[s - 1] !== ' ') {
    s--
  }
  // Skip whitespace rightward to the first real token at/after the column.
  while (s < line.length && line[s] === ' ') s++
  if (s >= line.length) return null
  // Only the numeric tail lives here => this column is empty on this row.
  if (tailStartIdx != null && s >= tailStartIdx) return null

  let e = s
  while (e < line.length && line[e] !== ' ') e++
  return { token: line.slice(s, e), start: s, end: e }
}

/**
 * Parse one data row using the column map plus right-anchored numeric parsing.
 */
const parseDataRow = (line, cols, sectionName, rowNumber) => {
  const m = line.match(DATA_ROW_RE)
  if (!m) return null

  const quantity = toNum(m[1])
  if (!quantity || quantity <= 0) return null

  // Right-anchored numeric columns. Tokenize and walk from the end.
  const tokens = line.trim().split(/\s+/)
  if (tokens.length < 3) return null

  const cost = toNum(tokens[tokens.length - 1])
  const weight = toNum(tokens[tokens.length - 2])
  if (cost == null || weight == null) return null

  let lengthRaw = null
  const maybeLength = tokens[tokens.length - 3]
  if (looksLikeLength(maybeLength)) {
    lengthRaw = maybeLength
  }

  // Index-aware token spans on the RAW line so we can bound text-column scans
  // by the start of the trailing numeric block and never mistake a length/
  // weight/cost token for a Part or Color value.
  const spans = []
  {
    const re = /\S+/g
    let mm
    while ((mm = re.exec(line)) !== null) spans.push({ tok: mm[0], start: mm.index })
  }

  let tailStartIdx = null
  if (spans.length >= 3) {
    const weightSpan = spans[spans.length - 2]
    const thirdSpan = spans[spans.length - 3]
    tailStartIdx =
      lengthRaw && thirdSpan && thirdSpan.tok === lengthRaw
        ? thirdSpan.start
        : weightSpan.start
  }

  // Left-aligned text columns: Mark and Description are reliably positioned, so
  // slice them by header index as before.
  const markId = sliceCol(line, cols.mark, cols.description ?? undefined)
  const description = sliceCol(line, cols.description, cols.part ?? undefined)

  // Part: scan rightward from the Part header index to the first real token,
  // bounded by the numeric tail. Handles data shifted right of the label and
  // correctly yields null when the Part column is genuinely blank (frame members).
  const partTok = findColumnToken(line, cols.part, tailStartIdx)
  let partCode = partTok ? partTok.token : null

  // Color: the token immediately following the Part token, validated as a short
  // legend code ("RO", "SO", "M", "CQ", "--"). Taking the whole token (instead of
  // a fixed 4-char window) fixes truncation like "CQ" -> "C".
  let partColor = null
  if (cols.color != null && partTok) {
    const re2 = /\S+/g
    re2.lastIndex = partTok.end
    const cm = re2.exec(line)
    if (cm && (tailStartIdx == null || cm.index < tailStartIdx)) {
      const candidate = cm[0]
      if (/^(--|[A-Z]{1,2})$/.test(candidate)) {
        partColor = candidate
      }
    }
  }

  if (partCode) {
    partCode = partCode.split(/\s+/)[0]

    // Guard against junk if the Part column is empty on a row:
    // - length fragments like 11' or 11'11-09"
    // - pure numeric pitch/dia values like 3.00 / 0.625
    const isLengthFragment =
      /['"]/.test(partCode) || (lengthRaw && lengthRaw.startsWith(partCode))
    const isNumericJunk = /^-?[\d.]+$/.test(partCode)

    if (isLengthFragment || isNumericJunk) {
      partCode = null
    }
  }

  return {
    sourceSheetName: sectionName,
    category: sectionName,
    rowNumber,

    quantity,
    markId: markId || '',
    description: description || '',

    partCode: partCode || null,
    partColor,

    lengthRaw,
    lengthFeet: parseOutLengthToFeet(lengthRaw),

    weight,

    // Cost column in .out files is the TOTAL cost for the line.
    bomSourceTotalCost: cost,
    bomSourceUnitCost: quantity > 0 ? cost / quantity : null,
  }
}

const isNoiseLine = (line) => {
  const t = line.trim()
  if (!t) return true
  if (t.startsWith('Total:')) return true
  if (/^Colors$/i.test(t)) return true
  if (/^-{3,}$/.test(t)) return true
  if (/^[A-Z-]{1,2}\s+-\s/.test(t)) return true // color legend entries: "RO - Red Oxide"
  if (/^(Web|Loc|Web Hole|[A-G])\s*=/.test(t)) return true
  return false
}

/**
 * Parse a full .out report buffer/string into BOM line items.
 */
const parseOutFile = (content) => {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content)
  const lines = text.split('\n').map(cleanLine)

  const items = []
  const sections = []
  let skippedRows = 0

  let sectionName = null
  let cols = null
  let inSummary = false
  let sectionItemCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/Summary Reports/i.test(line)) {
      inSummary = true
      if (sectionName) {
        sections.push({ name: sectionName, items: sectionItemCount })
      }
      sectionName = null
      cols = null
      continue
    }

    if (inSummary) continue

    // Section title line
    const titleMatch = line.match(SECTION_TITLE_RE)
    if (titleMatch && !isHeaderLine(line)) {
      if (sectionName) {
        sections.push({ name: sectionName, items: sectionItemCount })
      }
      sectionName = titleMatch[2].trim()
      sectionItemCount = 0
      cols = null
      continue
    }

    // Column header line
    if (isHeaderLine(line)) {
      cols = buildColumnMap(line, lines[i - 1] || '')
      continue
    }

    if (!sectionName || !cols) continue
    if (isSeparator(line) || isNoiseLine(line)) continue

    const item = parseDataRow(line, cols, sectionName, i + 1)

    if (item) {
      // RF columns/rafters in the frames section carry no part code —
      // these are custom-fabbed frame members.
      item.isFrameType = /frame/i.test(sectionName) && !item.partCode
      // No part code anywhere else = buyout-style manual line
      item.isBuyout = !item.partCode && !item.isFrameType
      items.push(item)
      sectionItemCount++
    } else if (line.trim() && DATA_ROW_RE.test(line)) {
      skippedRows++
    }
  }

  if (sectionName) {
    sections.push({ name: sectionName, items: sectionItemCount })
  }

  return { items, sections, skippedRows }
}

/**
 * Cross-check parsed totals against the report's own per-section totals.
 * Returns mismatches so callers can flag suspicious parses.
 */
const verifyAgainstReportTotals = (content, items) => {
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content)
  const reported = []

  const totalRe = /Total:\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)/g
  let m
  while ((m = totalRe.exec(text)) !== null) {
    reported.push({ weight: toNum(m[1]), cost: toNum(m[2]) }
    )
  }

  const parsedCost = items.reduce((s, it) => s + (it.bomSourceTotalCost || 0), 0)
  const parsedWeight = items.reduce((s, it) => s + (it.weight || 0), 0)
  const reportedCost = reported.reduce((s, r) => s + (r.cost || 0), 0)
  const reportedWeight = reported.reduce((s, r) => s + (r.weight || 0), 0)

  return {
    parsedCost: Number(parsedCost.toFixed(2)),
    reportedCost: Number(reportedCost.toFixed(2)),
    parsedWeight: Number(parsedWeight.toFixed(1)),
    reportedWeight: Number(reportedWeight.toFixed(1)),
    costDelta: Number(Math.abs(parsedCost - reportedCost).toFixed(2)),
    weightDelta: Number(Math.abs(parsedWeight - reportedWeight).toFixed(1)),
  }
}

module.exports = {
  parseOutFile,
  verifyAgainstReportTotals,
  parseOutLengthToFeet,
}