/** Concrete & insulation add-on pricing — port of HTML concreteUpdate / insulationUpdate */

const marginSellFromCost = (costSF, marginPct) => {
  const m = Number(marginPct) / 100
  if (m >= 1) return costSF * 2
  if (m <= 0) return costSF
  return costSF / (1 - m)
}

/** Parse numeric fields; treat null / "" / "null" as missing (FE often sends thickness: null). */
const pickPositiveNumber = (cfg = {}, keys = [], fallback) => {
  for (const key of keys) {
    const raw = cfg[key]
    if (raw == null || raw === '') continue
    if (typeof raw === 'string' && /^null$/i.test(raw.trim())) continue
    const n = Number(String(raw).replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n) && n > 0) return n
  }
  return fallback
}

/**
 * Normalize concrete payload from FE / saved estimate.
 * Maps aliases (slabThickness, psiRating) and replaces null thickness/psi with defaults.
 */
const normalizeConcreteConfig = (config = {}) => {
  const cfg = config && typeof config === 'object' ? config : {}
  return {
    ...cfg,
    include: Boolean(cfg.include),
    thickness: pickPositiveNumber(cfg, ['thickness', 'slabThickness', 'slab'], 6),
    psi: pickPositiveNumber(cfg, ['psi', 'psiRating', 'strength'], 4000),
    costSF: pickPositiveNumber(cfg, ['costSF', 'costPerSf', 'installCostPerSf'], 7.25),
    marginPct: (() => {
      const n = pickPositiveNumber(cfg, ['marginPct', 'targetMarginPct'], 25)
      return n > 0 ? n : 25
    })(),
    sowItems: Array.isArray(cfg.sowItems) ? cfg.sowItems : [],
    sowNotes: cfg.sowNotes || '',
  }
}

/** Prefer non-null fields from primary; fill gaps from fallback (e.g. fullQuote.concrete). */
const coalesceConcrete = (primary, fallback) => {
  const p = primary && typeof primary === 'object' ? primary : {}
  const f = fallback && typeof fallback === 'object' ? fallback : {}
  const merged = { ...f }
  for (const [k, v] of Object.entries(p)) {
    if (v != null && v !== '' && !(typeof v === 'string' && /^null$/i.test(v.trim()))) {
      merged[k] = v
    }
  }
  // Keep include / money from primary when present even if thickness was null.
  if (Object.prototype.hasOwnProperty.call(p, 'include')) merged.include = p.include
  if (p.appliedSell != null) merged.appliedSell = p.appliedSell
  if (p.sell != null) merged.sell = p.sell
  if (p.cost != null) merged.cost = p.cost
  if (p.sellSF != null) merged.sellSF = p.sellSF
  if (p.profit != null) merged.profit = p.profit
  return normalizeConcreteConfig(merged)
}

const computeConcreteAddon = (config = {}, sf = 0) => {
  const cfg = normalizeConcreteConfig(config)
  const include = Boolean(cfg.include)
  const thickness = cfg.thickness
  const psi = cfg.psi
  const costSF = cfg.costSF
  const marginPct = cfg.marginPct

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
      sowItems: cfg.sowItems || [],
      sowNotes: cfg.sowNotes || '',
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
    sowItems: cfg.sowItems || [
      'Pier excavation and placement',
      'Reinforced rebar system (tied)',
      '10mm vapor barrier',
      `${thickness}" thick ${psi} PSI concrete slab`,
      'Smooth finish (tolerance: ± 1/10 inch)',
      'All labor, equipment, and materials included',
    ],
    sowNotes: cfg.sowNotes || '',
  }
}

const computeInsulationAddon = (config = {}, sf = 0) => {
  const cfg = config || {}
  const include = Boolean(cfg.include)
  const system = cfg.system || 'vinyl'
  const rRoof = cfg.rRoof || 'R19'
  const rWall = cfg.rWall || 'R13'
  const costSF = Number(cfg.costSF ?? cfg.costPerSf ?? 1.5)
  const marginPct = Number(cfg.marginPct ?? 30)

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
  pickPositiveNumber,
  normalizeConcreteConfig,
  coalesceConcrete,
  computeConcreteAddon,
  computeInsulationAddon,
}
