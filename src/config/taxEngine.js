const TAX_ENGINES = ['legacy', 'local', 'avalara']

/**
 * Credential accessors — spec (§10) uses AVALARA_* names; we keep the original
 * AVATAX_* names as fallback aliases so existing deploy config keeps working.
 */
const getAccountId = () => process.env.AVALARA_ACCOUNT_ID || process.env.AVATAX_ACCOUNT_ID || ''
const getLicenseKey = () => process.env.AVALARA_LICENSE_KEY || process.env.AVATAX_LICENSE_KEY || ''
const getCompanyCode = () =>
  process.env.AVALARA_COMPANY_CODE || process.env.AVATAX_COMPANY_CODE || ''
const getReturnsCompanyId = () =>
  process.env.AVALARA_COMPANY_ID || process.env.AVATAX_COMPANY_ID || ''

const getAvalaraEnv = () =>
  String(process.env.AVALARA_ENV || process.env.AVATAX_ENV || 'sandbox').trim().toLowerCase()

const isProductionEnv = () => getAvalaraEnv() === 'production'

/** Explicit AVALARA_BASE_URL wins; otherwise derive from the environment. */
const getBaseUrl = () => {
  const override = String(process.env.AVALARA_BASE_URL || '').trim().replace(/\/$/, '')
  if (override) return override
  return isProductionEnv()
    ? 'https://rest.avatax.com/api/v2'
    : 'https://sandbox-rest.avatax.com/api/v2'
}

const getTaxEngine = () => {
  const raw = String(process.env.TAX_ENGINE || 'local').trim().toLowerCase()
  if (TAX_ENGINES.includes(raw)) return raw
  return 'local'
}

const isAvalaraConfigured = () =>
  Boolean(getAccountId() && getLicenseKey() && getCompanyCode())

const getActiveTaxProvider = () => {
  const engine = getTaxEngine()
  if (engine === 'avalara' && isAvalaraConfigured()) return 'avalara'
  if (engine === 'legacy') return 'legacy'
  return 'local'
}

const isReturnsConfigured = () =>
  Boolean(getAccountId() && getLicenseKey() && getReturnsCompanyId())

/**
 * §9/§10 — finalization safety. When the active provider is Avalara, an invoice
 * must not be finalized on unconfirmed tax unless this is explicitly disabled.
 * local/legacy use an estimated engine and are never blocked.
 */
const shouldBlockOnTaxFailure = () =>
  getActiveTaxProvider() === 'avalara' &&
  String(process.env.TAX_BLOCK_ON_TAX_FAILURE || 'true').trim().toLowerCase() !== 'false'

module.exports = {
  TAX_ENGINES,
  getTaxEngine,
  getAccountId,
  getLicenseKey,
  getCompanyCode,
  getReturnsCompanyId,
  getAvalaraEnv,
  isProductionEnv,
  getBaseUrl,
  isAvalaraConfigured,
  isReturnsConfigured,
  getActiveTaxProvider,
  shouldBlockOnTaxFailure,
}
