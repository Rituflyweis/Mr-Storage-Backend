const { getDocument } = require('pdfjs-dist/legacy/build/pdf.mjs')
const env = require('../../config/env')
const {
  extractPrelimWithClaude,
  mergeExtractedFields,
} = require('./drawingPdfClaudeExtractor')

const CLAUDE_FALLBACK_MIN_FIELDS = 5
const CLAUDE_FALLBACK_MIN_TEXT_ITEMS = 20

const buildLinesFromItems = (items) => {
  const lineMap = {}
  items.forEach((item) => {
    let yKey = null
    Object.keys(lineMap).forEach((k) => {
      if (Math.abs(parseInt(k, 10) - item.y) <= 4) yKey = k
    })
    if (yKey === null) yKey = String(item.y)
    if (!lineMap[yKey]) lineMap[yKey] = []
    lineMap[yKey].push(item)
  })

  const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a)
  return sortedYs
    .map((y) => {
      const row = lineMap[String(y)] || lineMap[Math.round(y).toString()] || []
      row.sort((a, b) => a.x - b.x)
      return row.map((i) => i.str).join(' ')
    })
    .filter((l) => l.trim())
}

const extractFromPrelim = (layoutText, flatText, tokens) => {
  const extracted = {}
  const t = flatText
  const lt = layoutText

  const set = (id, val) => {
    if (!val || !String(val).trim()) return
    extracted[id] = String(val).trim()
  }

  const afterLabel = (labelPattern, count = 1) => {
    for (let i = 0; i < tokens.length - count; i++) {
      if (labelPattern.test(tokens[i])) {
        const vals = []
        for (let j = i + 1; j < tokens.length && vals.length < count; j++) {
          const v = tokens[j].trim()
          if (v && v !== ':' && v !== '/' && v !== '_') vals.push(v)
        }
        if (vals.length) return vals.join(' ')
      }
    }
    return null
  }

  const findNum = (labelRx, src) => {
    const m = (src || t).match(labelRx)
    if (!m) return null
    const after = (src || t).slice(m.index + m[0].length, m.index + m[0].length + 60)
    const nm = after.match(/[\-]?\d+(?:\.\d+)?/)
    return nm ? nm[0] : null
  }

  const purch = afterLabel(/^PURCHASER$/i)
  if (purch && !/^CUSTOMER$/i.test(purch)) set('customer', purch)

  const proj = afterLabel(/^PROJECT$/i)
  if (proj && !/^PROJECT$/i.test(proj)) set('project', proj)

  let jobM = t.match(/JOB\s*(?:NUMBER|NO\.?|#)[:\s]*([\w\-_]{5,})/i)
  if (!jobM) {
    for (let i = 0; i < tokens.length; i++) {
      if (/\d{3,}_[A-Za-z]/.test(tokens[i])) {
        set('jobnumber', tokens[i])
        break
      }
    }
  } else set('jobnumber', jobM[1])

  let widthV = findNum(/WIDTH/i) || afterLabel(/^WIDTH[:\s]*$/i) || afterLabel(/^WIDTH$/i)
  if (!widthV) widthV = findNum(/WIDTH\s*[:_\s]/i)
  if (widthV && /^\d{2,3}$/.test(String(widthV).replace(/'/g, ''))) set('width', `${widthV}'`)

  let lenV = findNum(/LENGTH/i) || afterLabel(/^LENGTH$/i)
  if (lenV && /^\d{2,3}$/.test(String(lenV).replace(/'/g, ''))) set('length', `${lenV}'`)

  let htV = findNum(/HEIGHT/i) || afterLabel(/^HEIGHT$/i)
  if (!htV) htV = findNum(/\bHT\b/i)
  if (htV && /^\d{1,2}(?:\.\d)?$/.test(String(htV).replace(/'/g, ''))) set('eave', `${htV}'`)

  const dimM = t.match(/(\d{2,3})\s*[xX]\s*(\d{2,3})\s*[xX]\s*(\d{1,2})/)
  if (dimM) {
    set('width', `${dimM[1]}'`)
    set('length', `${dimM[2]}'`)
    set('eave', `${dimM[3]}'`)
  }

  if (extracted.width && extracted.length) {
    const wn = parseInt(extracted.width, 10)
    const ln = parseInt(extracted.length, 10)
    if (wn && ln) set('sqft', String(wn * ln))
  }

  const siteV = afterLabel(/^SITE$/i) || findNum(/SITE\s*CLASS/i)
  const scM = lt.match(/SITE\s*CLASS[:\s_]*([A-F])\b/i)
  if (siteV && /^[A-F]$/i.test(String(siteV).trim())) set('siteclass', siteV.trim().toUpperCase())
  else if (scM) set('siteclass', scM[1])

  const occM =
    t.match(/OCCUPANCY\s*CATEGORY[:\s_]*(I{1,3}V?|IV)[^\w]*/i) ||
    t.match(/OCCUPANCY[:\s]*(I{1,3}V?|IV)\b/i)
  if (occM) set('risk', `Category ${occM[1].toUpperCase()}`)

  let sdcM = t.match(/SEISMIC\s*DESIGN\s*CATEGORY[:\s_]*([A-F])\b/i)
  if (!sdcM) {
    for (let i = 0; i < tokens.length; i++) {
      if (/^SEISMIC$/i.test(tokens[i]) && /^DESIGN$/i.test(tokens[i + 1])) {
        for (let j = i + 2; j < Math.min(i + 8, tokens.length); j++) {
          if (/^[A-F]$/.test(tokens[j])) {
            sdcM = [null, tokens[j]]
            break
          }
        }
      }
    }
  }
  if (sdcM) set('seismiccat', sdcM[1].toUpperCase())

  const rdl = findNum(/ROOF\s*DEAD\s*LOAD/i)
  if (rdl) set('dead', `${rdl} psf`)

  const coll = findNum(/COLLATERAL\s*LOAD/i) || findNum(/COLLATERAL/i)
  if (coll) set('collateral', `${coll} psf`)

  const rll = findNum(/ROOF\s*LIVE\s*LOAD/i)
  if (rll) set('live', `${rll} psf`)

  const rsl = findNum(/ROOF\s*SNOW\s*LOAD/i)
  if (rsl) set('roofsnow', `${rsl} psf`)

  let gsl = findNum(/GROUND\s*SNOW\s*(?:LOAD)?/i) || findNum(/\bPg\b/i)
  if (gsl) set('snow', `${gsl} psf`)

  let bws = findNum(/BASIC\s*WIND\s*SPEED/i) || findNum(/WIND\s*SPEED/i)
  if (!bws) {
    const mphM = t.match(/(\d{2,3})\s*MPH/i)
    if (mphM) bws = mphM[1]
  }
  if (bws) set('wind', `${bws} mph`)

  let wexp = t.match(/WIND\s*EXPOSURE[:\s_]*([A-D])\b/i)
  if (!wexp) wexp = t.match(/WIND\s*EXP(?:OSURE)?[:\s]*([A-D])\b/i)
  if (!wexp) {
    for (let i = 0; i < tokens.length; i++) {
      if (/^WIND$/i.test(tokens[i]) && /^EXPOSURE$/i.test(tokens[i + 1])) {
        for (let j = i + 2; j < Math.min(i + 5, tokens.length); j++) {
          if (/^[A-D]$/i.test(tokens[j])) {
            wexp = [null, tokens[j]]
            break
          }
        }
      }
    }
  }
  if (wexp) set('exposure', `Exposure ${wexp[1].toUpperCase()}`)

  const sexp = findNum(/SNOW\s*EXPOSURE/i)
  if (sexp) set('snowexp', sexp)

  let ipcM = t.match(
    /INTERNAL\s*PRESSURE\s*COEFF?(?:E?ICIENT)?[:\s_]*([\d.\-]+\s*\/?\s*[\d.\-]*)/i
  )
  if (!ipcM) ipcM = t.match(/INT(?:ERNAL)?\s*PRESSURE[:\s_]*([\d.\-]+)/i)
  if (ipcM) set('ipc', ipcM[1].trim())

  const sds = findNum(/\bSds\b/i)
  if (sds) set('seismic', `Sds=${sds}`)

  const sd1 = findNum(/\bSd1\b/i)
  if (sd1) set('sd1', sd1)

  const s1 = findNum(/\bS1\b/i)
  if (s1) set('s1', s1)

  let szM = t.match(/SEISMIC\s*ZONE[:\s_]*([A-F])\b/i)
  if (!szM) {
    for (let i = 0; i < tokens.length; i++) {
      if (/^SEISMIC$/i.test(tokens[i]) && /^ZONE$/i.test(tokens[i + 1])) {
        for (let j = i + 2; j < Math.min(i + 5, tokens.length); j++) {
          if (/^[A-F]$/i.test(tokens[j])) {
            szM = [null, tokens[j]]
            break
          }
        }
      }
    }
  }
  if (szM) set('seismiczone', szM[1].toUpperCase())

  const tf = findNum(/THERMAL\s*FACTOR/i)
  if (tf) set('thermal', tf)

  let wif = t.match(/WIND\s*LOAD\s*(?:IMPORTANCE)?[:\s_]*([\d.]+)/i)
  if (!wif) {
    for (let i = 0; i < tokens.length - 2; i++) {
      if (/^WIND$/i.test(tokens[i]) && /^LOAD$/i.test(tokens[i + 1])) {
        for (let j = i + 2; j < Math.min(i + 6, tokens.length); j++) {
          if (/^\d+\.\d+$/.test(tokens[j])) {
            wif = [null, tokens[j]]
            break
          }
        }
        break
      }
    }
  }
  if (wif) set('windif', wif[1] || wif[0])

  const snif = t.match(/SNOW\s*LOAD\s*(?:IMPORTANCE)?[:\s_]*([\d.]+)/i)
  if (snif) set('snowif', snif[1])

  const longV = findNum(/LONGITUDINAL/i)
  if (longV) set('shearlong', `${longV} kips`)

  const transV = findNum(/TRANSVERSE/i)
  if (transV) set('sheartrans', `${transV} kips`)

  const frameM = t.match(/(?:CLEAR\s*SPAN|MULTI.SPAN|SINGLE\s*SLOPE|LEAN.TO|RIGID\s*FRAME)/i)
  if (frameM) set('frame', frameM[0].trim())

  const galvM = t.match(/Galvalume[^\s,\n]*/i)
  if (galvM) set('roofpanel', galvM[0].trim())
  else {
    const roofColorM = t.match(/COLOR[:\s]+([A-Za-z\s\-+0-9]+?)(?:\s{2,}|\n|yr|year)/i)
    if (roofColorM) set('roofpanel', roofColorM[1].trim())
  }

  const wpM = t.match(/WALL\s*PANELS?[:\s]+([A-Za-z\s\-]+?)(?:\s{2,}|\n)/i)
  if (wpM && wpM[1].trim().length > 2) set('wall', wpM[1].trim())

  const slopeM = t.match(/(\d(?:\.\d)?)\s*[:/]\s*12/)
  if (slopeM) set('slope', `${slopeM[1]}:12`)

  const codeM = t.match(/(IBC\s*\d{2,4}|ASCE\s*[\d.]+|AISC\s*[\d.]+)/i)
  if (codeM) set('code', codeM[1].trim())

  const dateM =
    t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/) ||
    t.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i)
  if (dateM) set('date', dateM[1])

  const locM = t.match(/([A-Za-z\s]{3,},\s*[A-Z]{2}\s*\d{5})/)
  if (locM) set('location', locM[1].trim())

  const filledCount = Object.keys(extracted).length
  return { extracted, filledCount }
}

const shouldUseClaudeFallback = (filledCount, textItemCount) => {
  if (!env.ANTHROPIC_API_KEY) return false
  return filledCount < CLAUDE_FALLBACK_MIN_FIELDS || textItemCount < CLAUDE_FALLBACK_MIN_TEXT_ITEMS
}

const buildNote = ({ textItemCount, filledCount, extractionMethod, claudeError }) => {
  if (claudeError) {
    return `Regex extraction only — Claude fallback failed: ${claudeError}. Review raw text and enter manually if needed.`
  }
  if (textItemCount === 0 && extractionMethod === 'claude') {
    return 'No selectable PDF text found — fields extracted via Claude vision from page 1. Please review before applying.'
  }
  if (extractionMethod === 'hybrid') {
    return 'Hybrid extraction (regex + Claude) from page 1 — please review all fields before applying.'
  }
  if (extractionMethod === 'claude') {
    return 'Fields extracted via Claude from page 1 — please review before applying.'
  }
  if (filledCount === 0) {
    return 'Text found but no fields auto-extracted — review raw text and enter manually.'
  }
  return 'Best-effort extraction from page 1 — labels vary between drawings, please review before applying.'
}

const toUint8Array = (buffer) => {
  if (buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)) return buffer
  return new Uint8Array(buffer)
}

const extractDrawingPdfBuffer = async (buffer, { fileName = '' } = {}) => {
  const data = toUint8Array(buffer)
  const pdf = await getDocument({ data, useSystemFonts: true }).promise
  const page = await pdf.getPage(1)
  const tc = await page.getTextContent()

  const items = tc.items
    .filter((item) => item.str && item.str.trim())
    .map((item) => ({
      str: item.str.trim(),
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
    }))

  const tokens = items.map((i) => i.str)
  const flatText = tokens.join(' ')
  const lines = buildLinesFromItems(items)
  const layoutText = lines.join('\n')

  const regexResult = extractFromPrelim(layoutText, flatText, tokens)
  let extracted = regexResult.extracted
  let filledCount = regexResult.filledCount
  let extractionMethod = 'regex'
  let claudeError = null

  if (shouldUseClaudeFallback(filledCount, items.length)) {
    try {
      const claudeResult = await extractPrelimWithClaude(buffer, { layoutText, fileName })
      extracted = mergeExtractedFields(extracted, claudeResult.extracted)
      filledCount = Object.keys(extracted).length
      extractionMethod =
        regexResult.filledCount > 0 && claudeResult.filledCount > 0 ? 'hybrid' : 'claude'
    } catch (err) {
      claudeError = err.message
      console.error('[drawingPdfExtractor] Claude fallback failed:', err.message)
    }
  }

  return {
    fileName,
    extracted,
    filledCount,
    textItemCount: items.length,
    extractionMethod,
    claudeUsed: extractionMethod === 'claude' || extractionMethod === 'hybrid',
    rawTextPreview: layoutText.substring(0, 4000),
    layoutTextPreview: layoutText.substring(0, 2000),
    note: buildNote({ textItemCount: items.length, filledCount, extractionMethod, claudeError }),
  }
}

module.exports = {
  extractDrawingPdfBuffer,
  extractFromPrelim,
  buildLinesFromItems,
  shouldUseClaudeFallback,
}
