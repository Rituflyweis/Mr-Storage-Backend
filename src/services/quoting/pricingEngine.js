/** Pricing engine — port of HTML tool priceJob() */

const priceJob = (cats, options = {}) => {
  const {
    jobType = 'PEMB',
    scope = 'Both',
    roof = 'screw-down',
    install = 'medium',
    sf = 0,
    blendPct = 50,
    PR,
    installCostPerSf,
    sellPerSf,
  } = options

  const isPEMB = jobType === 'PEMB'
  const isSS = roof === 'standing-seam'
  const mu = isPEMB ? PR.pembMu : PR.storMu
  const rows = []
  let matCost = 0
  let totWt = 0

  const add = (cat, label, wt, rate, price, tag, notes = '') => {
    rows.push({ cat, label, wt, rate, price, tag, notes })
    matCost += price
    if (wt) totWt += wt
  }

  if (cats.primary?.weight > 0) {
    const p = cats.primary.weight * PR.primary
    add('primary', 'Rigid Frames & Endwalls', cats.primary.weight, `$${PR.primary}/lb`, p, 'cat-primary')
  }
  if (cats.hss?.weight > 0) {
    const p = cats.hss.weight * PR.hss
    add('hss', 'HSS Beams', cats.hss.weight, `$${PR.hss}/lb`, p, 'cat-primary')
  }
  if (cats.secondary?.weight > 0) {
    const p = cats.secondary.weight * PR.secondary
    add('secondary', 'Purlins, Girts & Eave Struts', cats.secondary.weight, `$${PR.secondary}/lb`, p, 'cat-secondary')
  }
  if (cats.opening?.weight > 0) {
    const p = cats.opening.weight * PR.opening
    add('opening', 'Door Jambs & Headers', cats.opening.weight, `$${PR.opening}/lb`, p, 'cat-opening')
  }

  const shWt = cats.sheeting?.weight || 0
  if (shWt > 0 || sf > 0) {
    const estSF = shWt > 0 ? Math.round(shWt / 2.5) : sf * 1.8
    let shPrice
    let shRate
    if (isSS) {
      const rSF = Math.round(estSF * 0.55)
      const wSF = estSF - rSF
      shPrice = rSF * PR.ss + wSF * PR.sheet
      shRate = `SS $${PR.ss}+Wall $${PR.sheet}/SF`
    } else {
      shPrice = estSF * PR.sheet
      shRate = `$${PR.sheet}/SF`
    }
    add('sheeting', 'Roof & Wall Sheeting', shWt, shRate, shPrice, 'cat-sheeting', `~${estSF.toLocaleString()} SF`)
  }

  if (cats.angle?.weight > 0) {
    const p = cats.angle.weight * PR.angle
    add('angle', 'Angles', cats.angle.weight, `$${PR.angle}/lb`, p, 'cat-angle')
  }
  if (cats.plate?.weight > 0) {
    const p = cats.plate.weight * PR.plate
    add('plate', 'Connection Plates & Clips', cats.plate.weight, `$${PR.plate}/lb`, p, 'cat-angle')
  }

  const trimP = cats.trim?.weight > 0 ? Math.max(cats.trim.weight * 2.8, sf * 0.65) : sf * 0.65
  add('trim', 'Trim', cats.trim?.weight || null, 'bucket', trimP, 'cat-trim')
  const miscP = cats.misc?.weight > 0 ? Math.max(cats.misc.weight * 3.5, sf * 0.22) : sf * 0.22
  add('misc', 'Cables, Bracing & Sealant', cats.misc?.weight || null, 'bucket', miscP, 'cat-misc')
  const accP = cats.accessories?.weight > 0 ? Math.max(cats.accessories.weight * 1.5, sf * 1.0) : sf * 1.0
  add('accessories', 'Accessories', cats.accessories?.weight || null, 'bucket', accP, 'cat-misc')
  const fastP = sf * 0.48
  add('fasteners', 'Fasteners', null, 'per item (not $/lb)', fastP, 'cat-fastener', 'Priced per piece — screws, tape, sealant')

  if (cats.customItems?.length) {
    const tagMap = {
      primary: 'cat-primary',
      secondary: 'cat-secondary',
      sheeting: 'cat-sheeting',
      trim: 'cat-trim',
      misc: 'cat-misc',
      accessories: 'cat-misc',
      fasteners: 'cat-fastener',
      angle: 'cat-angle',
      plate: 'cat-angle',
      opening: 'cat-opening',
      hss: 'cat-primary',
    }
    cats.customItems.forEach((ci) => {
      if (ci.price > 0) {
        add(
          ci.cat || 'trim',
          ci.label || 'Custom item',
          ci.weight || null,
          ci.rateStr || 'custom',
          ci.price,
          tagMap[ci.cat || 'trim'] || 'cat-trim',
          ci.detail || ''
        )
      }
    })
  }

  matCost = rows.reduce((a, r) => a + r.price, 0)
  const freight = totWt * PR.freight
  const trucks = PR.truck > 0 ? Math.ceil(totWt / PR.truck) : 0

  const blend = Math.min(1, Math.max(0, Number(blendPct) / 100))
  const quickenSavings = totWt * PR.delta
  const blendedMatCost = matCost - quickenSavings * blend
  const blendedFreight = freight
  const blendLabel =
    blend === 0 ? '100% Central' : blend === 1 ? '100% Quicken' : `${Math.round(blend * 100)}% Quicken blend`

  let instCost = 0
  let instSell = 0
  const scopeKey = String(scope || 'both').toLowerCase()
  if (scopeKey === 'install' || scopeKey === 'both') {
    if (isPEMB) {
      const sell = sellPerSf ?? resolvePembInstallSell(install, PR)
      const cost = installCostPerSf ?? sell * 0.65
      instCost = sf * cost
      instSell = sf * sell
    } else {
      const sell = sellPerSf ?? PR.ses
      const cost = installCostPerSf ?? sell * 0.68
      instCost = sf * cost
      instSell = sf * sell
    }
  }

  const totCost = blendedMatCost + blendedFreight + instCost
  const matSell = (blendedMatCost + blendedFreight) * mu
  const totSell = scopeKey === 'supply' ? matSell : scopeKey === 'install' ? instSell : matSell + instSell
  const profit = totSell - totCost
  const profPct = totSell > 0 ? ((profit / totSell) * 100).toFixed(1) : '0'
  const sfPrice = sf > 0 ? (totSell / sf).toFixed(2) : '0'
  const quicken = quickenSavings * mu

  return {
    rows,
    matCost: blendedMatCost,
    totWt,
    freight: blendedFreight,
    trucks,
    instCost,
    instSell,
    totCost,
    matSell,
    totSell,
    profit,
    profPct,
    sfPrice,
    sf,
    quicken,
    jobType,
    scope,
    roof,
    install,
    isSS,
    blendPct: blend,
    blendLabel,
    vendorBlendSavings: Math.round(quickenSavings * blend),
  }
}

const resolvePembInstallSell = (install, PR) => {
  const key = String(install || 'medium').toLowerCase()
  if (key === 'easy') return PR.pes
  if (key === 'hard') return PR.phs
  if (key === 'tall' || key === 'tall-hard') return PR.pts
  return PR.pms
}

const categoriesToWeightByCategory = (cats, PR) => {
  const map = [
    ['primary', 'Rigid Frames & Endwalls', PR.primary],
    ['hss', 'HSS Beams', PR.hss],
    ['secondary', 'Purlins, Girts & Eave Struts', PR.secondary],
    ['opening', 'Door Jambs & Headers', PR.opening],
    ['sheeting', 'Roof & Wall Sheeting', PR.sheet],
    ['angle', 'Angles', PR.angle],
    ['plate', 'Connection Plates & Clips', PR.plate],
    ['trim', 'Trim', null],
    ['misc', 'Cables, Bracing & Sealant', null],
    ['accessories', 'Accessories', null],
    ['fasteners', 'Fasteners', null],
  ]

  return map
    .filter(([key]) => (cats[key]?.weight || 0) > 0)
    .map(([key, label, rate]) => ({
      category: label,
      weightLbs: Math.round((cats[key].weight || 0) * 100) / 100,
      rate: rate || 0,
      price: rate ? Math.round(cats[key].weight * rate * 100) / 100 : 0,
      notes: '',
    }))
}

module.exports = {
  priceJob,
  categoriesToWeightByCategory,
  resolvePembInstallSell,
}
