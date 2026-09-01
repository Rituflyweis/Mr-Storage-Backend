/** Storage COG pricing — port of HTML storageRecalc / storageGetProfit / storageGetGrandTotal */

const { computeConcreteAddon, computeInsulationAddon } = require('./addonPricing')
const { computeStorageSalesTax } = require('./salesTaxLookup')

const roundSell = (cogs, markupPct) => Math.round((cogs || 0) * (1 + (markupPct || 0) / 100))

const sumBuildings = (buildings = []) => {
  let buildingCogs = 0
  let buildingSell = 0
  let totalSqft = 0
  const rows = buildings.map((b) => {
    const cogs = Number(b.cogs) || Number(b.psf || 0) * Number(b.sqft || 0)
    const markup = Number(b.markup ?? 25)
    const sell = roundSell(cogs, markup)
    buildingCogs += cogs
    buildingSell += sell
    totalSqft += Number(b.sqft) || 0
    return { ...b, cogs, markup, sell, sfSell: b.sqft > 0 ? (sell / b.sqft).toFixed(2) : '0.00' }
  })
  return { rows, buildingCogs, buildingSell, totalSqft }
}

const sumDoors = (doors = []) => {
  let doorCogs = 0
  let doorSell = 0
  const rows = doors.map((d) => {
    const cogs = Number(d.unitCost || 0) * Number(d.qty || 0)
    const markup = Number(d.markup ?? 25)
    const sell = roundSell(cogs, markup)
    doorCogs += cogs
    doorSell += sell
    return { ...d, cogs, sale: sell, sell }
  })
  return { rows, doorCogs, doorSell }
}

const sumExtras = (extras = []) => {
  let extrasCogs = 0
  let extrasSell = 0
  const rows = extras.map((x) => {
    const cogs = Number(x.cogs || 0)
    const markup = Number(x.markup ?? 25)
    const sale = cogs > 0 ? roundSell(cogs, markup) : Number(x.sale || 0)
    if (x.include !== false && (x.include || cogs > 0)) {
      extrasCogs += cogs
      extrasSell += sale
    }
    return { ...x, sale, sell: sale }
  })
  return { rows, extrasCogs, extrasSell }
}

const computeStoragePricing = (storageData = {}, options = {}) => {
  const buildings = storageData.buildings || []
  const doors = storageData.doors || []
  const extras = storageData.extras || []

  const bld = sumBuildings(buildings)
  const door = sumDoors(doors)
  const ext = sumExtras(extras)

  const sf = options.totalSqft ?? bld.totalSqft
  const shipping = Number(options.shipping ?? storageData.shipping ?? 0)
  const drawings = Number(options.drawings ?? storageData.drawings ?? 0)
  const installSellPerSf = Number(options.installSellPerSf ?? storageData.installSellPerSf ?? 0)
  const installCostPerSf = Number(options.installCostPerSf ?? storageData.installCostPerSf ?? 0)

  const concrete = computeConcreteAddon(options.concrete || storageData.concrete, sf)
  const insulation = computeInsulationAddon(options.insulation || storageData.insulation, sf)

  const erectSell = installSellPerSf * sf
  const erectCost = installCostPerSf * sf

  const tax = computeStorageSalesTax(
    {
      buildingSell: bld.buildingSell,
      doorSell: door.doorSell,
      insulationSell: insulation.appliedSell,
    },
    options.salesTax || storageData.salesTax || {}
  )

  const grandTotal = Math.round(
    bld.buildingSell +
      door.doorSell +
      ext.extrasSell +
      shipping +
      drawings +
      erectSell +
      (concrete.include ? concrete.appliedSell : 0) +
      (insulation.include ? insulation.appliedSell : 0) +
      tax.amount
  )

  const bldProfit = bld.buildingSell - bld.buildingCogs
  const doorProfit = door.doorSell - door.doorCogs
  const erectProfit = erectSell - erectCost
  const concProfit = concrete.include ? concrete.profit : 0
  const insulProfit = insulation.include ? insulation.profit : 0
  const extrasProfit = ext.extrasSell - ext.extrasCogs

  const totalProfit = Math.round(
    bldProfit + doorProfit + erectProfit + concProfit + insulProfit + extrasProfit
  )
  const totalCogs = Math.round(
    bld.buildingCogs + door.doorCogs + erectCost + (concrete.include ? concrete.cost : 0) +
      (insulation.include ? insulation.cost : 0) + ext.extrasCogs
  )
  const totalSellBeforeTax =
    bld.buildingSell +
    door.doorSell +
    ext.extrasSell +
    erectSell +
    (concrete.include ? concrete.appliedSell : 0) +
    (insulation.include ? insulation.appliedSell : 0)
  const pct = totalSellBeforeTax + tax.amount > 0
    ? ((totalProfit / (totalSellBeforeTax + tax.amount)) * 100).toFixed(1)
    : '0'

  return {
    buildings: bld.rows,
    doors: door.rows,
    extras: ext.rows,
    totalSqft: sf,
    buildingSell: Math.round(bld.buildingSell),
    buildingCogs: Math.round(bld.buildingCogs),
    doorSell: Math.round(door.doorSell),
    doorCogs: Math.round(door.doorCogs),
    extrasSell: Math.round(ext.extrasSell),
    extrasCogs: Math.round(ext.extrasCogs),
    shipping: Math.round(shipping),
    drawings: Math.round(drawings),
    installSell: Math.round(erectSell),
    installCost: Math.round(erectCost),
    installSellPerSf,
    installCostPerSf,
    concrete,
    insulation,
    salesTax: tax,
    grandTotal,
    pricePerSf: sf > 0 ? (grandTotal / sf).toFixed(2) : '0',
    profit: totalProfit,
    totalCogs,
    marginPercent: Number(pct),
    breakdown: {
      buildings: { sell: Math.round(bld.buildingSell), cogs: Math.round(bld.buildingCogs), profit: Math.round(bldProfit) },
      doors: { sell: Math.round(door.doorSell), cogs: Math.round(door.doorCogs), profit: Math.round(doorProfit) },
      install: { sell: Math.round(erectSell), cogs: Math.round(erectCost), profit: Math.round(erectProfit) },
      concrete: { sell: concrete.appliedSell, cogs: concrete.cost, profit: concProfit },
      insulation: { sell: insulation.appliedSell, cogs: insulation.cost, profit: insulProfit },
      extras: { sell: Math.round(ext.extrasSell), cogs: Math.round(ext.extrasCogs), profit: Math.round(extrasProfit) },
    },
    subtotal: {
      materials: Math.round(bld.buildingSell + door.doorSell + ext.extrasSell),
      passThrough: Math.round(shipping + drawings),
    },
  }
}

/** Pricing-summary rows for storage quote HTML — line items always reconcile to grandTotal. */
const getStoragePricingSummaryLines = (sp = {}, options = {}) => {
  const grandTotal = Math.round(options.grandTotal ?? sp.grandTotal ?? 0)
  const buildings = sp.buildings || []
  const concrete = sp.concrete || {}
  const insulation = sp.insulation || {}
  const concSell = concrete.include ? Math.round(concrete.appliedSell || 0) : 0
  const insulSell = insulation.include ? Math.round(insulation.appliedSell || 0) : 0
  const taxRate = sp.salesTax?.rate || 0
  const taxAmt = Math.round(sp.salesTax?.amount || 0)

  let installSell = Math.round(sp.installSell ?? sp.breakdown?.install?.sell ?? 0)

  const rows = []
  const push = (label, amount, key, extra = {}) => {
    const amt = Math.round(Number(amount) || 0)
    if (key === 'buildings' || amt > 0) rows.push({ label, amount: amt, key, ...extra })
  }

  push(`Buildings (${buildings.length || sp.buildingCount || 1})`, sp.buildingSell || 0, 'buildings')
  push('Doors & Hardware', sp.doorSell || 0, 'doors')
  push('Erection / Installation', installSell, 'install')
  push('Options & Add-ons', sp.extrasSell || 0, 'extras')
  push('Shipping & Freight', sp.shipping || 0, 'shipping')
  push('Engineering Drawings', sp.drawings || 0, 'drawings')
  if (concSell) {
    const concLabel =
      concrete.thickness && concrete.psi
        ? `Concrete (${concrete.thickness}" · ${concrete.psi} PSI)`
        : 'Concrete'
    push(concLabel, concSell, 'concrete')
  }
  if (insulSell) push('Insulation', insulSell, 'insulation')
  if (taxAmt) push(`Sales Tax (${taxRate}%)`, taxAmt, 'tax', { taxStyle: true })

  let lineSum = rows.reduce((a, r) => a + r.amount, 0)
  if (grandTotal > lineSum) {
    const gap = grandTotal - lineSum
    let installRow = rows.find((r) => r.key === 'install')
    if (!installRow) {
      installRow = { label: 'Erection / Installation', amount: 0, key: 'install' }
      const shipIdx = rows.findIndex((r) => r.key === 'shipping')
      rows.splice(shipIdx >= 0 ? shipIdx : rows.length, 0, installRow)
    }
    installRow.amount += gap
    lineSum += gap
  }

  return { rows, grandTotal, lineSum, balanced: lineSum === grandTotal }
}

module.exports = {
  computeStoragePricing,
  getStoragePricingSummaryLines,
}
