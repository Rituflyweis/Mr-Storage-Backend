const XLSX = require('xlsx')

const normalizeTabName = (name) =>
  String(name || '')
    .toLowerCase()
    .trim()
    .replace(/^\d+\.\s*/, '')

const parseLengthFt = (str) => {
  str = String(str || '').trim()
  const ftIn = str.match(/(\d+)['\u2019][- ]*(\d+)["\u201d]/)
  if (ftIn) return parseFloat(ftIn[1]) + parseFloat(ftIn[2]) / 12
  const ftOnly = str.match(/(\d+(?:\.\d+)?)['\u2019]/)
  if (ftOnly) return parseFloat(ftOnly[1])
  const inOnly = str.match(/(\d+(?:\.\d+)?)\s*["\u201d]/)
  if (inOnly) return parseFloat(inOnly[1]) / 12
  return 0
}

const extractWeight = (data) => {
  if (!data || data.length < 2) return 0

  for (let r = 0; r < data.length; r++) {
    const row = data[r]
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toLowerCase()
      if (
        cell === 'total weight:' ||
        cell === 'total weight' ||
        cell === 'total wt:' ||
        cell === 'totalweight:'
      ) {
        for (let nc = c + 1; nc < row.length; nc++) {
          const v = parseFloat(String(row[nc] || '').replace(/,/g, ''))
          if (!isNaN(v) && v > 0.1) return v
        }
        if (r + 1 < data.length) {
          const nr = data[r + 1]
          for (let nc = 0; nc < nr.length; nc++) {
            const v = parseFloat(String(nr[nc] || '').replace(/,/g, ''))
            if (!isNaN(v) && v > 0.1) return v
          }
        }
      }
    }
  }

  let wCol = -1
  let hRow = -1
  for (let r = 0; r < Math.min(data.length, 8); r++) {
    for (let c = 0; c < data[r].length; c++) {
      const h = String(data[r][c] || '').toLowerCase().trim()
      if (
        h === 'weight' ||
        h === 'wt' ||
        h === 'weight(lb)' ||
        h === 'weight (lb)' ||
        h === 'weight(lbs)' ||
        h === 'total weight'
      ) {
        wCol = c
        hRow = r
        break
      }
    }
    if (wCol >= 0) break
  }

  if (wCol >= 0) {
    for (let r = data.length - 1; r > hRow; r--) {
      const rs = data[r].map((c) => String(c || '')).join(' ').toLowerCase()
      if (rs.includes('total')) {
        const v = parseFloat(String(data[r][wCol] || '').replace(/,/g, ''))
        if (!isNaN(v) && v > 0) return v
      }
    }
    let sum = 0
    for (let r = hRow + 1; r < data.length; r++) {
      const rs = data[r].map((c) => String(c || '')).join(' ').toLowerCase()
      if (rs.includes('total') || rs.includes('recd') || rs.includes('unless')) continue
      const v = parseFloat(String(data[r][wCol] || '').replace(/,/g, ''))
      if (!isNaN(v) && v > 0) sum += v
    }
    if (sum > 0) return sum
  }

  for (let r = data.length - 1; r >= 0; r--) {
    const rs = data[r].map((c) => String(c || '')).join(' ').toLowerCase()
    if (rs.includes('total') && (rs.includes('weight') || rs.includes('wt'))) {
      for (let c = 0; c < data[r].length; c++) {
        const v = parseFloat(String(data[r][c] || '').replace(/,/g, ''))
        if (!isNaN(v) && v > 100) return v
      }
    }
  }

  return 0
}

const getTabCat = (name, customTabRules = []) => {
  const n = normalizeTabName(name)

  for (const r of customTabRules) {
    if (r.matchType === 'tab_name' && r.match && n.includes(String(r.match).toLowerCase().trim())) {
      return r.cat || 'trim'
    }
  }

  if (
    n === 'columns & rafters' ||
    n === 'columns and rafters' ||
    n.includes('column') ||
    n.includes('rafter') ||
    n.includes('rigid frame') ||
    n.includes('endwall frame') ||
    n.includes('wind bent') ||
    n.includes('stud') ||
    n.includes('top channel')
  ) {
    return 'primary'
  }
  if (
    n === 'opening framing' ||
    n.includes('opening') ||
    n.includes('jamb') ||
    n.includes('door jamb') ||
    n.includes('header')
  ) {
    return 'opening'
  }
  if (
    n.startsWith('purlins') ||
    n.includes('purlin') ||
    n.includes('girt') ||
    n.includes('eave strut') ||
    (n.includes('eave') && !n.includes('trim'))
  ) {
    return 'secondary'
  }
  if (n === 'sheeting' || n.includes('sheeting') || n.includes('wall sheeting') || n.includes('roof sheeting')) {
    return 'sheeting'
  }
  if (n === 'clips' || n.includes('clip') || n.includes('plate') || n.includes('connection')) return 'plate'
  if (n === 'angles' || n.startsWith('angle')) return 'angle'
  if (n === 'trim' || n.startsWith('trim')) return 'trim'
  if (n === 'bracing' || n.includes('brac') || n.includes('cable') || n.includes('sealant')) return 'misc'
  if (n === 'accessories' || n.includes('accessor')) return 'accessories'
  if (n === 'fasteners' || n.includes('fastener') || n.includes('screw') || n.includes('bolt')) return 'fasteners'
  if (n === 'cover' || n === 'index' || n === 'summary' || n === 'overview' || n.includes('total weight & area')) {
    return null
  }
  if (n.includes('hss')) return 'hss'
  return null
}

const getCustomTabRule = (name, customTabRules = []) => {
  const n = normalizeTabName(name)
  for (const r of customTabRules) {
    if (r.matchType === 'tab_name' && r.match && n.includes(String(r.match).toLowerCase().trim())) return r
  }
  return null
}

const applyItemRules = (data, sheetName, sf, customTabRules = []) => {
  const matched = []
  if (!customTabRules.length) return matched

  let hRow = -1
  const cols = {}
  for (let r = 0; r < Math.min(data.length, 8); r++) {
    const row = data[r]
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] || '').toLowerCase().trim()
      if (h === 'qty' || h === 'quantity') {
        cols.qty = c
        hRow = r
      }
      if (h === 'part' || h === 'part no' || h === 'part number' || h === 'part#') cols.part = c
      if (h === 'description' || h === 'desc') cols.desc = c
      if (h === 'length' || h === 'len') cols.len = c
      if (h === 'weight' || h === 'wt') cols.wt = c
      if (h === 'mark') cols.mark = c
    }
    if (hRow >= 0) break
  }
  if (hRow < 0 || cols.qty === undefined) return matched

  for (let r = hRow + 1; r < data.length; r++) {
    const row = data[r]
    const qty = parseFloat(row[cols.qty]) || 0
    if (!qty) continue
    const part = String(row[cols.part] || '').trim().toLowerCase()
    const desc = String(row[cols.desc] || '').trim().toLowerCase()
    const markVal = cols.mark !== undefined ? String(row[cols.mark] || '').trim().toLowerCase() : ''
    const lenStr = cols.len !== undefined ? String(row[cols.len] || '') : ''
    const wt = cols.wt !== undefined ? parseFloat(row[cols.wt]) || 0 : 0
    const lf = parseLengthFt(lenStr) * qty

    for (const cr of customTabRules) {
      if (!cr.match) continue
      const matchStr = String(cr.match).toLowerCase().trim()
      let hit = false
      if (cr.matchType === 'part_number' && (part.includes(matchStr) || markVal.includes(matchStr))) hit = true
      if (cr.matchType === 'description' && desc.includes(matchStr)) hit = true
      if (!hit) continue

      const method = cr.method || 'per_lb'
      let price = 0
      if (method === 'per_lb') price = wt * (cr.rate || 0)
      else if (method === 'per_lf') price = lf * (cr.rate || 0)
      else if (method === 'per_sf') price = sf * (cr.rate || 0)
      else if (method === 'flat_each') price = qty * (cr.rate || 0)
      else if (method === 'flat_total') price = cr.rate || 0

      if (price > 0) {
        matched.push({
          label: cr.note || (desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : cr.match),
          cat: cr.cat || 'trim',
          method,
          qty,
          lf,
          weight: wt,
          price,
          rateStr:
            method === 'per_lb'
              ? `$${cr.rate || 0}/lb`
              : method === 'per_lf'
                ? `$${cr.rate || 0}/LF`
                : method === 'per_sf'
                  ? `$${cr.rate || 0}/SF`
                  : method === 'flat_each'
                    ? `$${cr.rate || 0}/ea`
                    : `flat $${cr.rate || 0}`,
          detail: qty + (method === 'per_lf' ? ` pcs · ${lf.toFixed(0)} LF` : method === 'flat_each' ? ' ea' : ''),
        })
      }
      break
    }
  }
  return matched
}

const emptyCategories = () => ({
  primary: { label: 'Rigid Frames & Endwalls', weight: 0, tag: 'cat-primary' },
  hss: { label: 'HSS Beams', weight: 0, tag: 'cat-primary' },
  secondary: { label: 'Purlins, Girts & Eave Struts', weight: 0, tag: 'cat-secondary' },
  opening: { label: 'Door Jambs & Headers', weight: 0, tag: 'cat-opening' },
  sheeting: { label: 'Roof & Wall Sheeting', weight: 0, tag: 'cat-sheeting' },
  angle: { label: 'Angles', weight: 0, tag: 'cat-angle' },
  plate: { label: 'Connection Plates & Clips', weight: 0, tag: 'cat-angle' },
  trim: { label: 'Trim', weight: 0, tag: 'cat-trim' },
  misc: { label: 'Cables, Bracing & Sealant', weight: 0, tag: 'cat-misc' },
  accessories: { label: 'Accessories', weight: 0, tag: 'cat-misc' },
  fasteners: { label: 'Fasteners', weight: 0, tag: 'cat-fastener' },
  customItems: [],
})

const parseShipperWorkbook = (wb, { sf = 0, customTabRules = [] } = {}) => {
  const cats = emptyCategories()
  const tabSummary = []

  wb.SheetNames.forEach((sn) => {
    const cat = getTabCat(sn, customTabRules)
    if (!cat) {
      tabSummary.push({ sheetName: sn, skipped: true, weightLbs: 0 })
      return
    }

    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' })
    const w = extractWeight(data)
    const itemHits = applyItemRules(data, sn, sf || 0, customTabRules)

    if (itemHits.length > 0) {
      const claimedWt = itemHits.reduce((a, h) => a + (h.weight || 0), 0)
      itemHits.forEach((h) => cats.customItems.push(h))
      const remainWt = Math.max(0, w - claimedWt)
      if (remainWt > 0 && cats[cat]) cats[cat].weight += remainWt
    } else {
      const cr = getCustomTabRule(sn, customTabRules)
      if (cr && cr.method !== 'per_lb') {
        let price = 0
        let rateStr = ''
        if (cr.method === 'per_sf') {
          price = (sf || 0) * (cr.rate || 0)
          rateStr = `$${cr.rate}/SF`
        } else if (cr.method === 'flat_total') {
          price = cr.rate || 0
          rateStr = `flat $${cr.rate}`
        }
        cats.customItems.push({
          label: cr.note || sn,
          cat: cr.cat || cat,
          method: cr.method,
          weight: w,
          price,
          rateStr,
          detail: sn,
        })
      } else if (w > 0 && cats[cat]) {
        cats[cat].weight += w
      }
    }

    tabSummary.push({ sheetName: sn, category: cat, weightLbs: w })
  })

  const totalWeightLbs = Object.entries(cats)
    .filter(([k]) => k !== 'customItems')
    .reduce((sum, [, v]) => sum + (v.weight || 0), 0)

  return { categories: cats, tabSummary, totalWeightLbs, sheetCount: wb.SheetNames.length }
}

const parseShipperBuffer = (buffer, options = {}) => {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  return { workbook: wb, ...parseShipperWorkbook(wb, options) }
}

const parseShipperCoverSheet = (wb) => {
  let coverSheet = null
  let coverName = null

  wb.SheetNames.forEach((name) => {
    const n = name.toLowerCase().trim()
    if (n === 'cover' || n === 'index' || n === 'summary' || n.includes('cover')) {
      coverSheet = wb.Sheets[name]
      coverName = name
    }
  })

  if (!coverSheet) {
    wb.SheetNames.forEach((name) => {
      if (coverSheet) return
      const n = name.toLowerCase()
      if (
        !n.includes('column') &&
        !n.includes('purlin') &&
        !n.includes('rafter') &&
        !n.includes('sheeting') &&
        !n.includes('clip') &&
        !n.includes('angle') &&
        !n.includes('trim') &&
        !n.includes('brac') &&
        !n.includes('access') &&
        !n.includes('fastener') &&
        !n.includes('stud') &&
        !n.includes('jamb')
      ) {
        coverSheet = wb.Sheets[name]
        coverName = name
      }
    })
  }

  if (!coverSheet) return { coverName: null, labelMap: {}, allText: '' }

  const data = XLSX.utils.sheet_to_json(coverSheet, { header: 1, defval: '' })
  const labelMap = {}
  let allText = ''

  data.forEach((row) => {
    allText += row.map((c) => String(c || '')).join(' ') + '\n'
    for (let ci = 0; ci < row.length; ci++) {
      const label = String(row[ci] || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
      if (!label || label.length < 3 || label === '=') continue
      for (let vi = ci + 1; vi < row.length; vi++) {
        const val = String(row[vi] || '').trim()
        if (val === '' || val === '=' || val === '-') continue
        if (!labelMap[label]) labelMap[label] = val
        break
      }
    }
  })

  return { coverName, labelMap, allText, data }
}

module.exports = {
  parseShipperBuffer,
  parseShipperWorkbook,
  parseShipperCoverSheet,
  extractWeight,
  getTabCat,
  applyItemRules,
  parseLengthFt,
}
