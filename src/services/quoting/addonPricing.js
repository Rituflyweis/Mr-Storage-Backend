/** Concrete & insulation add-on pricing — port of HTML concreteUpdate / insulationUpdate */

const marginSellFromCost = (costSF, marginPct) => {
  const m = Number(marginPct) / 100
  if (m >= 1) return costSF * 2
  if (m <= 0) return costSF
  return costSF / (1 - m)
}

const computeConcreteAddon = (config = {}, sf = 0) => {
  const include = Boolean(config.include)
  const thickness = Number(config.thickness || 6)
  const psi = Number(config.psi || 4000)
  const costSF = Number(config.costSF ?? config.costPerSf ?? 7.25)
  const marginPct = Number(config.marginPct ?? 25)

  if (!include || !sf) {
    return {
      include: false,
      thickness,
      psi,
      costSF,
      marginPct,
      sellSF: 0,
      cost: 0,
      sell: 0,
      appliedSell: 0,
      profit: 0,
      sowItems: config.sowItems || [],
      sowNotes: config.sowNotes || '',
    }
  }

  const sellSF = marginSellFromCost(costSF, marginPct)
  const cost = costSF * sf
  const sell = sellSF * sf

  return {
    include: true,
    thickness,
    psi,
    costSF,
    marginPct,
    sellSF,
    cost: Math.round(cost),
    sell: Math.round(sell),
    appliedSell: Math.round(sell),
    profit: Math.round(sell - cost),
    sowItems: config.sowItems || [
      'Pier excavation and placement',
      'Reinforced rebar system (tied)',
      '10mm vapor barrier',
      `${thickness}" thick ${psi} PSI concrete slab`,
      'Smooth finish (tolerance: ± 1/10 inch)',
      'All labor, equipment, and materials included',
    ],
    sowNotes: config.sowNotes || '',
  }
}

const computeInsulationAddon = (config = {}, sf = 0) => {
  const include = Boolean(config.include)
  const system = config.system || 'vinyl'
  const rRoof = config.rRoof || 'R19'
  const rWall = config.rWall || 'R13'
  const costSF = Number(config.costSF ?? config.costPerSf ?? 1.5)
  const marginPct = Number(config.marginPct ?? 30)

  const systemLabel =
    system === 'spray' ? 'Spray Foam' : system === 'double' ? 'Double-Layer' : 'Vinyl-Backed'

  if (!include || !sf) {
    return {
      include: false,
      system,
      systemLabel,
      rRoof,
      rWall,
      costSF,
      marginPct,
      sellSF: 0,
      cost: 0,
      sell: 0,
      appliedSell: 0,
      profit: 0,
    }
  }

  const sellSF = marginSellFromCost(costSF, marginPct)
  const cost = costSF * sf
  const sell = sellSF * sf

  return {
    include: true,
    system,
    systemLabel,
    rRoof,
    rWall,
    costSF,
    marginPct,
    sellSF,
    cost: Math.round(cost),
    sell: Math.round(sell),
    appliedSell: Math.round(sell),
    profit: Math.round(sell - cost),
  }
}

module.exports = {
  marginSellFromCost,
  computeConcreteAddon,
  computeInsulationAddon,
}
