const { getDocument } = require('pdfjs-dist/legacy/build/pdf.mjs')

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

  const occM = t.match(/OCCUPANCY\s*CATEGORY[:\s_]*(I{1,3}V?|IV)[^\w]*/i) || t.match(/OCCUPANCY[:\s]*(I{1,3}V?|IV)\b/i)
  if (occM) set('risk', `Category ${occM[1].toUpperCase()}`)

  let sdcM = t.match(/SEISMIC\s*DESIGN\s*CATEGORY[:\s_]*([A-F])\b/i)
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
  if (wexp) set('exposure', `Exposure ${wexp[1].toUpperCase()}`)

  const sds = findNum(/\bSds\b/i)
  if (sds) set('seismic', `Sds=${sds}`)

  const slopeM = t.match(/(\d(?:\.\d)?)\s*[:/]\s*12/)
  if (slopeM) set('slope', `${slopeM[1]}:12`)

  const codeM = t.match(/(IBC\s*\d{4}|ASCE\s*[\d.]+|AISC\s*[\d.]+)/i)
  if (codeM) set('code', codeM[1].trim())

  const dateM = t.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/)
  if (dateM) set('date', dateM[1])

  const locM = t.match(/([A-Za-z\s]{3,},\s*[A-Z]{2}\s*\d{5})/)
  if (locM) set('location', locM[1].trim())

  const frameM = t.match(/(?:CLEAR\s*SPAN|MULTI.SPAN|SINGLE\s*SLOPE|LEAN.TO|RIGID\s*FRAME)/i)
  if (frameM) set('frame', frameM[0].trim())

  const filledCount = Object.keys(extracted).length
  return { extracted, filledCount }
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

  const { extracted, filledCount } = extractFromPrelim(layoutText, flatText, tokens)

  return {
    fileName,
    extracted,
    filledCount,
    textItemCount: items.length,
    rawTextPreview: layoutText.substring(0, 4000),
    layoutTextPreview: layoutText.substring(0, 2000),
    note:
      items.length === 0
        ? 'No text found in PDF — drawing may use outlined/vector text. Enter fields manually.'
        : filledCount === 0
          ? 'Text found but no fields auto-extracted — review raw text and enter manually.'
          : 'Best-effort extraction from page 1 — labels vary between drawings, please review before applying.',
  }
}

module.exports = {
  extractDrawingPdfBuffer,
  extractFromPrelim,
  buildLinesFromItems,
}
