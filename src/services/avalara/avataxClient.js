const {
  isAvalaraConfigured,
  getAccountId,
  getLicenseKey,
  getCompanyCode,
  getBaseUrl,
} = require('../../config/taxEngine')

const authHeader = () => {
  const token = Buffer.from(`${getAccountId()}:${getLicenseKey()}`).toString('base64')
  return `Basic ${token}`
}

/** Short correlation id for request tracing / error surfacing (§9, §10). */
const newCorrelationId = () =>
  `TAX-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const getMaxRetries = () => {
  const n = parseInt(process.env.AVALARA_MAX_RETRIES || '2', 10)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 5) : 2
}

/** Transient = worth retrying: network error, 429, or 5xx. 4xx are not retried. */
const isTransientStatus = (status) => status === 429 || (status >= 500 && status <= 599)

const avataxRequest = async (method, path, body, { correlationId } = {}) => {
  if (!isAvalaraConfigured()) {
    throw new Error('AvaTax is not configured (AVALARA_ACCOUNT_ID, AVALARA_LICENSE_KEY, AVALARA_COMPANY_CODE)')
  }
  const cid = correlationId || newCorrelationId()
  const url = `${getBaseUrl()}${path}`
  const maxRetries = getMaxRetries()

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let res
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Avalara-Client': 'MrStorageBackend; tax; nodejs',
          'X-Correlation-Id': cid,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (networkErr) {
      // Network/transport failure — retry with backoff, then surface.
      if (attempt < maxRetries) {
        await sleep(250 * 2 ** attempt)
        attempt += 1
        continue
      }
      const err = new Error(`AvaTax ${method} ${path} network error: ${networkErr.message}`)
      err.correlationId = cid
      err.transient = true
      throw err
    }

    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { raw: text }
    }

    if (!res.ok) {
      if (isTransientStatus(res.status) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt
        await sleep(waitMs)
        attempt += 1
        continue
      }
      const msg = json?.error?.message || json?.message || text || res.statusText
      const err = new Error(`AvaTax ${method} ${path} failed (${res.status}): ${msg}`)
      err.correlationId = cid
      err.status = res.status
      err.avataxError = json?.error || null
      err.transient = isTransientStatus(res.status)
      throw err
    }
    return json
  }
}

const COUNTRY_TO_ISO2 = {
  US: 'US',
  USA: 'US',
  'U.S.': 'US',
  'U.S.A.': 'US',
  'UNITED STATES': 'US',
  'UNITED STATES OF AMERICA': 'US',
  CA: 'CA',
  CANADA: 'CA',
  MX: 'MX',
  MEXICO: 'MX',
}

/** AvaTax expects ISO-3166 alpha-2 (e.g. US), not display names. */
const toIsoCountryCode = (input) => {
  const raw = String(input || 'US').trim()
  if (!raw) return 'US'
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase()
  const mapped = COUNTRY_TO_ISO2[raw.toUpperCase()]
  if (mapped) return mapped
  return 'US'
}

const toAvaAddress = (addr = {}) => ({
  line1: addr.line1 || '',
  line2: addr.line2 || '',
  city: addr.city || '',
  region: String(addr.state || '')
    .trim()
    .toUpperCase()
    .slice(0, 2),
  postalCode: addr.postalCode || '',
  country: toIsoCountryCode(addr.country),
})

const ping = () => avataxRequest('GET', '/utilities/ping')

const listCompanies = async ({ top = 10, activeOnly = true } = {}) => {
  const params = new URLSearchParams()
  if (activeOnly) params.set('$filter', 'isActive eq true')
  params.set('$top', String(top))
  const json = await avataxRequest('GET', `/companies?${params.toString()}`)
  return Array.isArray(json?.value) ? json.value : []
}

const createTransaction = (model, opts = {}) =>
  avataxRequest('POST', '/transactions/create', model, opts)

const commitTransaction = (companyCode, transactionCode, opts = {}) =>
  avataxRequest(
    'POST',
    `/companies/${encodeURIComponent(companyCode)}/transactions/${encodeURIComponent(transactionCode)}/commit`,
    { commit: true },
    opts
  )

const voidTransaction = (companyCode, transactionCode, code = 'DocVoided', opts = {}) =>
  avataxRequest(
    'POST',
    `/companies/${encodeURIComponent(companyCode)}/transactions/${encodeURIComponent(transactionCode)}/void`,
    { code },
    opts
  )

/**
 * Adjust a committed transaction (corrections). §9 cancellation/returns.
 * reason e.g. 'PriceAdjustment'; newModel is a full CreateTransactionModel.
 */
const adjustTransaction = (companyCode, transactionCode, { adjustmentReason = 'Other', adjustmentDescription = '', newTransaction }, opts = {}) =>
  avataxRequest(
    'POST',
    `/companies/${encodeURIComponent(companyCode)}/transactions/${encodeURIComponent(transactionCode)}/adjust`,
    { adjustmentReason, adjustmentDescription, newTransaction },
    opts
  )

/** Search Avalara tax-code definitions for the admin mapping UI (§7). */
const listTaxCodes = async (search = '', { top = 25 } = {}) => {
  const params = new URLSearchParams()
  params.set('$top', String(top))
  const term = String(search || '').trim().replace(/'/g, "''")
  if (term) {
    params.set('$filter', `taxCode contains '${term}' OR description contains '${term}'`)
  }
  const json = await avataxRequest('GET', `/definitions/taxcodes?${params.toString()}`)
  const rows = Array.isArray(json?.value) ? json.value : []
  return rows.map((r) => ({
    taxCode: r.taxCode,
    taxCodeTypeId: r.taxCodeTypeId,
    description: r.description,
  }))
}

module.exports = {
  ping,
  listCompanies,
  createTransaction,
  commitTransaction,
  voidTransaction,
  adjustTransaction,
  listTaxCodes,
  toAvaAddress,
  toIsoCountryCode,
  newCorrelationId,
}
