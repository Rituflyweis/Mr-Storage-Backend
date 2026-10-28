/**
 * Company / brand info for generated quoting documents.
 * Port of SM-QuotingTool v7 getCompanyInfo().
 * Two brands: 'SM' (Storage Materials) and 'SBD' (Steel Building Depot).
 * Values can be overridden per-request via `company` / `companyBrand` / logo URL fields.
 */

const COMPANIES = {
  SM: {
    key: 'SM',
    name: 'Storage Materials',
    shortName: 'Storage Materials',
    tagline: 'METAL AND DOORS',
    address: '1851 Madison Ave Suite 300, Council Bluffs, IA 51503',
    phone: '(888) 968-1222',
    email: 'travis@storagematerials.com',
    website: 'www.storagematerials.com',
    legalName: 'Steel Investments DBA Storage Materials',
    taxId: '99-4515145',
    signerName: 'Travis Overhue',
    signerTitle: 'Owner',
    accentColor: '#1e3a8a',
    logoLeft: 'STORAGE',
    logoRight: 'MATERIALS',
  },
  SBD: {
    key: 'SBD',
    name: 'Steel Building Depot',
    shortName: 'Steel Building Depot',
    tagline: 'METAL BUILDINGS, ROOFING & COMPONENTS',
    address: '1851 Madison Ave Suite 300, Council Bluffs, IA 51503',
    phone: '(888) 968-1222',
    email: 'info@steelbuildingdepot.com',
    website: 'www.steelbuildingdepot.com',
    legalName: 'Steel Building Depot',
    taxId: '99-4515145',
    signerName: 'Travis Overhue',
    signerTitle: 'Owner',
    accentColor: '#b45309',
    logoLeft: 'STEEL BUILDING',
    logoRight: 'DEPOT',
  },
}

/**
 * Normalize FE / API aliases → SM | SBD.
 * Job type alone does NOT force a brand — logo toggle is independent.
 */
const resolveCompanyKey = (input) => {
  if (input == null || input === '') return null
  if (typeof input === 'object') {
    return resolveCompanyKey(
      input.key ||
        input.companyBrand ||
        input.company ||
        input.brand ||
        input.logoBrand ||
        input.logoCompany,
    )
  }
  const raw = String(input).trim().toLowerCase()
  if (!raw) return null
  if (
    raw === 'sm' ||
    raw === 'storage' ||
    raw === 'storage materials' ||
    raw === 'storage-materials' ||
    raw === 'storage_material' ||
    raw === 'storage material' ||
    raw === 'storagematerials'
  ) {
    return 'SM'
  }
  if (
    raw === 'sbd' ||
    raw === 'steel' ||
    raw === 'steel building' ||
    raw === 'steel-building' ||
    raw === 'steel building depot' ||
    raw === 'steelbuildingdepot' ||
    raw === 'depot'
  ) {
    return 'SBD'
  }
  const upper = String(input).trim().toUpperCase()
  if (COMPANIES[upper]) return upper
  return null
}

/**
 * Pick brand from quote payload / estimate fields.
 * Defaults to SBD (matches current PEMB preview wordmark) when unset.
 */
const pickCompanyKeyFromPayload = (payload = {}) => {
  const explicit = resolveCompanyKey(
    payload.companyBrand ??
      payload.company ??
      payload.brand ??
      payload.logoBrand ??
      payload.logoCompany ??
      payload.quoteControls?.companyBrand ??
      payload.quoteControls?.company,
  )
  if (explicit) return explicit
  // Soft default by job type only when brand was never set.
  const job = String(payload.jobType || '').toLowerCase()
  if (job === 'storage') return 'SM'
  return 'SBD'
}

/**
 * @param {object|string} [override] company key ('SM'|'SBD'), quote payload, or override object
 */
const getCompanyInfo = (override) => {
  let key = 'SBD'
  let overrides = {}

  if (typeof override === 'string') {
    key = resolveCompanyKey(override) || 'SBD'
  } else if (override && typeof override === 'object') {
    key = pickCompanyKeyFromPayload(override)
    const logoSrc = override.logoSrc || override.logoUrl || override.companyLogoUrl
    if (logoSrc) {
      overrides.logoSrc = logoSrc
      overrides.logoUrl = logoSrc
      overrides.companyLogoUrl = logoSrc
    }
  }

  const base = COMPANIES[key] || COMPANIES.SBD
  return { ...base, ...overrides, key: base.key }
}

/** Logo <img> if a URL/data-URI is supplied, else CSS wordmark (SM / SBD). */
const getLogoHtml = (infoOrPayload = {}) => {
  const info =
    infoOrPayload.key && infoOrPayload.logoLeft
      ? infoOrPayload
      : getCompanyInfo(infoOrPayload)
  const src = info.logoSrc || info.logoUrl || info.companyLogoUrl
  if (src) {
    return `<img src="${src}" style="height:40px;width:auto;display:block;max-width:240px;" alt="${info.name || ''}">`
  }
  const left = info.logoLeft || info.name || 'STEEL BUILDING'
  const right = info.logoRight || ''
  if (right) {
    return `<span class="q-logo-sm">${left}</span><span class="q-logo-mat">${right}</span>`
  }
  return `<div style="font-size:22px;font-weight:800;color:${info.accentColor || '#1e3a8a'};letter-spacing:-.5px;">${info.name || 'Storage Materials'}</div>`
}

const companySubline = (info, { short = false } = {}) => {
  if (short) {
    return `${info.tagline} · Council Bluffs, IA · ${info.phone}`
  }
  return `${info.tagline} · ${info.address}<br>${info.phone} · ${info.email} · ${info.website}`
}

module.exports = {
  COMPANIES,
  resolveCompanyKey,
  pickCompanyKeyFromPayload,
  getCompanyInfo,
  getLogoHtml,
  companySubline,
}
