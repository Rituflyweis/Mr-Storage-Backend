const XLSX = require('xlsx')

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const isVendorCogLayout = (cogData) => {
  const top = cogData.slice(0, 25).join(' ').toLowerCase()
  return top.includes('cost of goods') || top.includes('shipping+eng')
}

const extractStorageProject = (storData, cogData, quoteData = []) => {
  const p = {}
  if (storData[14]) p.customer = String(storData[14][5] || '').trim()
  if (storData[15]) p.location = String(storData[15][5] || '').trim()
  if (storData[14]) {
    const dc = String(storData[14][22] || '')
    const dm = dc.match(/\d{1,2}\/\d{1,2}\/\d{4}/)
    if (dm) p.date = dm[0]
  }
  if (!p.customer && cogData[6]) p.customer = String(cogData[6][0] || cogData[6][1] || '').trim()

  // Vendor quote sheets (Ben Olson / manufacturer export)
  for (let ri = 0; ri < Math.min(quoteData.length, 20); ri++) {
    const row = quoteData[ri] || []
    const label = String(row[0] || row[1] || '').toLowerCase().replace(/[#:]/g, '').trim()
    const val = String(row[4] || row[5] || '').trim()
    if (!val) continue
    if (label.startsWith('buyer') && !p.customer) p.customer = val
    if (label.startsWith('project id') && !p.projectName) p.projectName = val
    if (label.startsWith('site location') && !p.location) p.location = val
  }

  for (let ri = 0; ri < Math.min(storData.length, 20); ri++) {
    const row = storData[ri] || []
    const label = String(row[1] || row[0] || '').toLowerCase().replace(/[#:]/g, '').trim()
    const val = String(row[5] || row[6] || '').trim()
    if (!val) continue
    if (label === 'name' && ri >= 7 && ri <= 12) {
      const section = String(storData[7]?.[0] || storData[8]?.[0] || '').toLowerCase()
      if (section.includes('customer') && !p.customer) p.customer = val
      if (section.includes('project') && !p.projectName) p.projectName = val
    }
    if (label === 'city' && !p.location) p.location = val
    if (label === 'address' && !p.address) p.address = val
  }

  return p
}

const extractVendorCogMeta = (cogData) => {
  const meta = {
    markupPct: 25,
    shipping: 0,
    totalCogs: null,
    totalEstimate: null,
    isVendorFormat: isVendorCogLayout(cogData),
  }
  if (!meta.isVendorFormat) return meta

  for (let ri = 0; ri < Math.min(cogData.length, 40); ri++) {
    const row = cogData[ri] || []
    const label = String(row[11] || row[10] || row[8] || '').toLowerCase()
    const amount = num(row[12] ?? row[10] ?? row[9])

    if (label.includes('shipping+eng') || label.includes('shipping+eng.')) {
      meta.shipping = amount
    }
    if (label.includes('psf mark up') || label.includes('mark up %')) {
      const raw = num(row[12])
      meta.markupPct = raw > 0 && raw < 1 ? Math.round(raw * 1000) / 10 : raw
    }
    if (label === 'total cogs') meta.totalCogs = amount
    if (label === 'total estimate') meta.totalEstimate = amount
  }

  return meta
}

const extractVendorColumnExtras = (cogData, markupPct = 25) => {
  const out = []
  for (let ri = 0; ri < cogData.length; ri++) {
    const row = cogData[ri] || []
    const item = String(row[8] || '').trim()
    if (!item) continue
    const lower = item.toLowerCase()
    if (['insulation', 'gutters', 'standing seam', 'concrete', 'tariff', 'doors'].includes(lower)) {
      const rateNote = row[9] ? `$${num(row[9])}/SF` : ''
      const cogs = num(row[10]) || num(row[12])
      if (cogs <= 0) continue
      out.push({
        item,
        cogs,
        markup: markupPct,
        sale: Math.round(cogs * (1 + markupPct / 100)),
        note: rateNote,
        include: true,
      })
    }
  }
  return out
}

const extractStorageBuildings = (cogData, storData, markupPct = 25) => {
  let headerRow = -1
  for (let ri = 0; ri < Math.min(cogData.length, 25); ri++) {
    const rowStr = cogData[ri].join(' ').toLowerCase()
    if (rowStr.includes('width') && rowStr.includes('sqft') && rowStr.includes('cogs')) {
      headerRow = ri
      break
    }
  }
  if (headerRow < 0) headerRow = 5

  const h = cogData[headerRow] || []
  const C = { name: 0, width: -1, length: -1, loEave: -1, hiEave: -1, pitch: -1, slope: -1, sqft: -1, psf: -1, cogs: -1 }
  h.forEach((v, ci) => {
    const s = String(v || '').toLowerCase().trim()
    if (s === 'width') C.width = ci
    else if (s === 'length') C.length = ci
    else if (s.includes('low') && s.includes('eave')) C.loEave = ci
    else if (s.includes('high') && s.includes('eave')) C.hiEave = ci
    else if (s.includes('left') && s.includes('eave')) C.loEave = ci
    else if (s.includes('right') && s.includes('eave')) C.hiEave = ci
    else if (s === 'pitch') C.pitch = ci
    else if (s === 'slope') C.slope = ci
    else if (s === 'sqft') C.sqft = ci
    else if (s === 'psf') C.psf = ci
    else if (s === 'cogs') C.cogs = ci
  })

  const out = []
  for (let ri = headerRow + 1; ri < Math.min(cogData.length, headerRow + 40); ri++) {
    const row = cogData[ri]
    if (!row) continue
    const name = String(row[C.name] || row[0] || '').trim()
    if (!name) continue
    const nl = name.toLowerCase()
    if (nl === 'totals' || nl === 'total' || nl.includes('average') || nl.includes('door details')) break

    const w = C.width >= 0 ? num(row[C.width]) : 0
    const l = C.length >= 0 ? num(row[C.length]) : 0
    const loE = C.loEave >= 0 ? num(row[C.loEave]) : 0
    const hiE = C.hiEave >= 0 ? num(row[C.hiEave]) : loE
    const sqft = C.sqft >= 0 ? num(row[C.sqft]) || w * l : w * l
    const psf = C.sqft >= 0 ? num(row[C.psf]) : 0
    const cogs = C.cogs >= 0 ? num(row[C.cogs]) || psf * sqft : psf * sqft
    const pitch = C.pitch >= 0 ? String(row[C.pitch] || '') : ''
    const slope = C.slope >= 0 ? String(row[C.slope] || '').trim() : ''
    if (!w && !l && !cogs && !sqft) continue

    let wallPanel = ''
    let roofPanel = ''
    let doors = ''
    for (let si = 21; si <= 40; si++) {
      const sr = storData[si]
      if (!sr) continue
      const bnum = name.replace(/[^0-9]/g, '')
      if (bnum && String(sr[0] || '').trim() === bnum) {
        wallPanel = String(sr[14] || '').trim()
        roofPanel = String(sr[19] || '').trim()
        doors = String(sr[30] || '').replace(/\n/g, ' | ').trim()
        break
      }
    }

    out.push({
      name,
      width: w,
      length: l,
      loEave: loE,
      hiEave: hiE,
      pitch,
      slope,
      sqft,
      psf,
      cogs,
      markup: markupPct,
      wallPanel,
      roofPanel,
      doors,
    })
  }
  return out
}

const extractStorageDoors = (cogData) => {
  let doorHdr = -1
  for (let ri = 0; ri < cogData.length; ri++) {
    const rs = cogData[ri].join(' ').toLowerCase()
    if (rs.includes('width') && rs.includes('height') && rs.includes('cost') && rs.includes('qty')) {
      doorHdr = ri
      break
    }
  }
  if (doorHdr < 0) doorHdr = 22

  const out = []
  for (let ri = doorHdr + 1; ri < Math.min(cogData.length, doorHdr + 30); ri++) {
    const row = cogData[ri]
    if (!row) continue
    const name = String(row[0] || '').trim()
    if (name.toLowerCase() === 'total') break
    const w = String(row[1] || '').trim()
    const h2 = String(row[2] || '').trim()
    const unitCost = parseFloat(row[3]) || 0
    const qty = parseFloat(row[4]) || 0
    const cogsTot = parseFloat(row[5]) || unitCost * qty
    if (!w && !unitCost) continue
    out.push({
      type: name || 'Door',
      size: w && h2 ? `${w} x ${h2}` : w || h2 || '',
      unitCost,
      qty,
      cogs: cogsTot,
      markup: 25,
      sale: Math.round(cogsTot * 1.25),
    })
  }
  return out
}

const extractStorageExtras = (cogData) => {
  let extStart = -1
  for (let ri = 20; ri < cogData.length; ri++) {
    const c0 = String(cogData[ri][0] || '').toLowerCase()
    if (c0 === 'insulation' || c0 === 'concrete') {
      extStart = ri
      break
    }
  }
  if (extStart < 0) return []

  const out = []
  for (let ri = extStart; ri < Math.min(cogData.length, extStart + 50); ri++) {
    const row = cogData[ri]
    if (!row) continue
    const item = String(row[0] || '').trim()
    if (!item) continue
    const lower = item.toLowerCase()
    if (
      lower.includes('total hard') ||
      lower.includes('cost per') ||
      lower.includes('profit') ||
      lower.includes('sales tax')
    ) {
      break
    }
    const cogs = parseFloat(row[3]) || 0
    const profit = parseFloat(row[5]) || 0
    const sale = cogs + (profit > 0 ? profit : 0) || Math.round(cogs * 1.25)
    let markup = cogs > 0 ? Math.round(((sale - cogs) / cogs) * 100) : 25
    if (markup < 0) markup = 0
    out.push({ item, cogs, markup, sale: Math.round(sale || 0), note: '', include: cogs > 0 })
  }
  return out
}

const parseStorageCogBuffer = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  let cogSheet = null
  let storSheet = null
  let quoteSheet = null
  let cogName = null
  let storName = null
  let quoteName = null

  wb.SheetNames.forEach((n) => {
    const nl = n.toLowerCase()
    if (nl.includes('cog')) {
      cogSheet = wb.Sheets[n]
      cogName = n
    }
    if (nl.includes('storage')) {
      storSheet = wb.Sheets[n]
      storName = n
    }
    if (nl.includes('quote')) {
      quoteSheet = wb.Sheets[n]
      quoteName = n
    }
  })
  if (!cogSheet) {
    cogSheet = wb.Sheets[wb.SheetNames[0]]
    cogName = wb.SheetNames[0]
  }

  const cogData = XLSX.utils.sheet_to_json(cogSheet, { header: 1, defval: '' })
  const storData = storSheet
    ? XLSX.utils.sheet_to_json(storSheet, { header: 1, defval: '' })
    : wb.SheetNames.includes('Sheet1') && !storSheet
      ? XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, defval: '' })
      : []
  const quoteData = quoteSheet
    ? XLSX.utils.sheet_to_json(quoteSheet, { header: 1, defval: '' })
    : []

  const vendorMeta = extractVendorCogMeta(cogData)
  const markupPct = vendorMeta.markupPct

  const project = extractStorageProject(storData, cogData, quoteData)
  const buildings = extractStorageBuildings(cogData, storData, markupPct)
  const doors = extractStorageDoors(cogData).map((d) => ({ ...d, markup: markupPct }))

  let extras = extractStorageExtras(cogData)
  if (vendorMeta.isVendorFormat) {
    extras = extractVendorColumnExtras(cogData, markupPct)
    if (vendorMeta.shipping > 0) {
      extras.push({
        item: 'Shipping + Engineering Drawings',
        cogs: vendorMeta.shipping,
        markup: markupPct,
        sale: Math.round(vendorMeta.shipping * (1 + markupPct / 100)),
        note: 'From vendor COGS sheet',
        include: true,
      })
    }
  }

  const shipRow = cogData[12] || []
  const shippingDefault = vendorMeta.shipping || parseFloat(shipRow[12]) || 12000

  const totalSqft = buildings.reduce((a, b) => a + (b.sqft || 0), 0)
  const buildingSell = buildings.reduce((a, b) => a + Math.round((b.cogs || 0) * (1 + (b.markup || markupPct) / 100)), 0)
  const doorSell = doors.reduce((a, d) => a + Math.round(d.unitCost * d.qty * (1 + (d.markup || markupPct) / 100)), 0)
  const extrasSell = extras.reduce((a, x) => a + (x.include ? x.sale : 0), 0)

  return {
    sheetNames: wb.SheetNames,
    cogSheetName: cogName,
    storageSheetName: storName,
    quoteSheetName: quoteName,
    format: vendorMeta.isVendorFormat ? 'vendor_cog' : 'storage_cog',
    vendorMeta,
    project,
    buildings,
    doors,
    extras,
    shippingDefault,
    globalMarkupPct: markupPct,
    summary: {
      buildingCount: buildings.length,
      doorTypesWithQty: doors.filter((d) => d.qty > 0).length,
      totalSqft,
      buildingSell,
      doorSell,
      extrasSell,
      subtotalSell: buildingSell + doorSell + extrasSell,
      sheetTotalEstimate: vendorMeta.totalEstimate,
      sheetTotalCogs: vendorMeta.totalCogs,
    },
  }
}

module.exports = {
  parseStorageCogBuffer,
  extractStorageProject,
  extractStorageBuildings,
  extractStorageDoors,
  extractStorageExtras,
  extractVendorCogMeta,
  extractVendorColumnExtras,
  isVendorCogLayout,
}
