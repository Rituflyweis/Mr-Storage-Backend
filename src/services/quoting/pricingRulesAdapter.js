/** Maps PricingRules document → HTML tool PR object + normalized custom rules */

const DEFAULT_PR = {
  primary: 1.71,
  secondary: 0.88,
  hss: 2.05,
  angle: 1.04,
  opening: 1.2,
  plate: 1.2,
  sheet: 1.3,
  ss: 1.7,
  freight: 0.13,
  truck: 40000,
  acc: 0.1,
  delta: 0.1,
  pec: 5.5,
  pes: 8.5,
  pmc: 5.75,
  pms: 9.0,
  phc: 6.25,
  phs: 9.25,
  ptc: 7.0,
  pts: 11.0,
  sec: 3.25,
  ses: 4.75,
  stc: 4.0,
  sts: 5.875,
  soc: 4.75,
  sos: 6.25,
  pembMu: 1.3,
  storMu: 1.18,
}

const MATCH_TYPE_MAP = {
  'Tab Name': 'tab_name',
  'Part #': 'part_number',
  Description: 'description',
  tab_name: 'tab_name',
  part_number: 'part_number',
  description: 'description',
}

const METHOD_MAP = {
  per_lb: 'per_lb',
  per_sf: 'per_sf',
  per_lf: 'per_lf',
  flat_each: 'flat_each',
  flat_total: 'flat_total',
  'per_lb': 'per_lb',
}

const toCustomRule = (rule) => {
  if (!rule) return null
  if (rule.matchType && rule.match) {
    return {
      matchType: rule.matchType,
      match: rule.match,
      cat: rule.cat || 'trim',
      method: rule.method || 'per_lb',
      rate: Number(rule.rate) || 0,
      note: rule.note || '',
    }
  }
  const matchAgainst = rule.matchAgainst || 'Part #'
  return {
    matchType: MATCH_TYPE_MAP[matchAgainst] || 'part_number',
    match: rule.valueToMatch || rule.label || '',
    cat: mapCategoryKey(rule.category || rule.label || 'trim'),
    method: METHOD_MAP[rule.pricingMethod] || 'per_lb',
    rate: Number(rule.rate) || 0,
    note: rule.label || rule.category || '',
  }
}

const mapCategoryKey = (cat) => {
  const c = String(cat || '').toLowerCase()
  const map = {
    primary: 'primary',
    'rigid frames & endwalls': 'primary',
    'primary frames': 'primary',
    hss: 'hss',
    'hss beams': 'hss',
    secondary: 'secondary',
    'purlins, girts & eave struts': 'secondary',
    opening: 'opening',
    'door jambs & headers': 'opening',
    sheeting: 'sheeting',
    'roof & wall sheeting': 'sheeting',
    angle: 'angle',
    angles: 'angle',
    plate: 'plate',
    'connection plates & clips': 'plate',
    trim: 'trim',
    misc: 'misc',
    'cables, bracing & sealant': 'misc',
    accessories: 'accessories',
    fasteners: 'fasteners',
  }
  return map[c] || c || 'trim'
}

const buildPricingRates = (rulesDoc) => {
  const pr = { ...DEFAULT_PR }
  if (!rulesDoc) return { pr, customTabRules: [] }

  const steel = rulesDoc.steelRatesPerLb || {}
  pr.primary = steel.primaryFrames ?? pr.primary
  pr.secondary = steel.secondarySteel ?? pr.secondary
  pr.hss = steel.hssBeams ?? pr.hss
  pr.angle = steel.angles ?? pr.angle
  pr.opening = steel.openingsJambs ?? pr.opening
  pr.plate = steel.platesClips ?? pr.plate

  const sheet = rulesDoc.sheetingRatesPerSf || {}
  pr.sheet = sheet.standardScrewDown ?? pr.sheet
  pr.ss = sheet.standingSeam ?? pr.ss
  // Repair legacy docs that copied steel $/lb defaults into sheeting/freight fields
  if (pr.sheet > 2) pr.sheet = DEFAULT_PR.sheet
  if (pr.ss > 3) pr.ss = DEFAULT_PR.ss

  const freight = rulesDoc.freight || {}
  pr.freight = freight.ratePerLb ?? pr.freight
  pr.truck = freight.lbsPerTruck ?? pr.truck
  pr.acc = freight.accessoriesAllowancePerSf ?? pr.acc
  pr.delta = freight.vendorDeltaPerLb ?? pr.delta
  if (pr.freight > 1) pr.freight = DEFAULT_PR.freight

  const markup = rulesDoc.markup || {}
  pr.pembMu = markup.pembMultiplier ?? pr.pembMu
  pr.storMu = markup.storageMultiplier ?? pr.storMu

  const install = rulesDoc.install || {}
  pr.pec = install.pembEasy?.cost ?? pr.pec
  pr.pes = install.pembEasy?.sell ?? pr.pes
  pr.pmc = install.pembMedium?.cost ?? pr.pmc
  pr.pms = install.pembMedium?.sell ?? pr.pms
  pr.phc = install.pembHard?.cost ?? pr.phc
  pr.phs = install.pembHard?.sell ?? pr.phs
  pr.ptc = install.pembTallHard?.cost ?? pr.ptc
  pr.pts = install.pembTallHard?.sell ?? pr.pts
  pr.sec = install.storageBasic?.cost ?? pr.sec
  pr.ses = install.storageBasic?.sell ?? pr.ses
  pr.stc = install.storageTall?.cost ?? pr.stc
  pr.sts = install.storageTall?.sell ?? pr.sts
  pr.soc = install.storageOverhang?.cost ?? pr.soc
  pr.sos = install.storageOverhang?.sell ?? pr.sos

  const customTabRules = (rulesDoc.customTabRules || [])
    .map(toCustomRule)
    .filter((r) => r && r.match && String(r.match).trim())

  return { pr, customTabRules }
}

module.exports = {
  DEFAULT_PR,
  buildPricingRates,
  toCustomRule,
  mapCategoryKey,
}
