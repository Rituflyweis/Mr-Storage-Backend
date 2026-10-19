/**
 * Avalara Managed Returns (GraphQL) — sandbox/production.
 * Auth: OAuth client_credentials (accountId + licenseKey).
 */

const {
  getAccountId,
  getLicenseKey,
  getReturnsCompanyId,
  isReturnsConfigured,
} = require('../../config/taxEngine')

const getAuthUrl = () =>
  process.env.AVALARA_AUTH_URL || 'https://ai-sbx.avlr.sh/connect/token'

const getGraphqlUrl = () =>
  process.env.AVALARA_RETURNS_API_URL || 'https://returns-api.sbx.avalara.com/graphql'

let cachedToken = null
let tokenExpiresAt = 0

const fetchAccessToken = async () => {
  const now = Date.now()
  if (cachedToken && tokenExpiresAt > now + 5000) return cachedToken

  const clientId =
    process.env.AVALARA_RETURNS_CLIENT_ID || getAccountId()
  const clientSecret =
    process.env.AVALARA_RETURNS_CLIENT_SECRET || getLicenseKey()
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetch(getAuthUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(json.error_description || json.error || 'Returns auth failed')
  }
  cachedToken = json.access_token
  tokenExpiresAt = now + (Number(json.expires_in) || 3600) * 1000
  return cachedToken
}

const graphql = async (query, variables = {}) => {
  const token = await fetchAccessToken()
  const res = await fetch(getGraphqlUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
  if (!res.ok) {
    throw new Error(json.message || `Returns GraphQL HTTP ${res.status}`)
  }
  return json.data
}

const APPROVE_FILINGS_MUTATION = `
  mutation ApproveFilings($input: ApproveFilingsInput!) {
    approveFilings(input: $input) {
      value {
        companyId
        month
        year
        filingRegions {
          filingId
          status
          region
          taxAmount
          salesAmount
          approveDate
          id
        }
      }
    }
  }
`

/**
 * Approve a regional return (Pay Tax / remittance via Avalara).
 * month/year = filing period (1–12).
 */
const approveFilings = async ({
  companyId,
  month,
  year,
  region,
  country = 'US',
  approve = true,
}) => {
  const input = {
    companyId: Number(companyId),
    month: Number(month),
    year: Number(year),
    country,
    region: String(region).toUpperCase(),
    approvalInput: { approve: Boolean(approve) },
  }
  const data = await graphql(APPROVE_FILINGS_MUTATION, { input })
  return data?.approveFilings?.value || null
}

/**
 * Best-effort filing pull — schema varies by Avalara Returns product tier.
 * Returns [] if query unsupported; caller should fall back to invoice rollup sync.
 */
const LIST_FILINGS_QUERY = `
  query ListFilings($companyId: Int!) {
    filings(companyId: $companyId) {
      filingId
      id
      region
      country
      status
      taxAmount
      salesAmount
      collectAmount
      dueDate
      startDate
      endDate
      month
      year
    }
  }
`

const listFilings = async (companyId) => {
  try {
    const data = await graphql(LIST_FILINGS_QUERY, { companyId: Number(companyId) })
    const rows = data?.filings
    return Array.isArray(rows) ? rows : []
  } catch (err) {
    console.warn('[avalara-returns] listFilings:', err.message)
    return null
  }
}

module.exports = {
  isReturnsConfigured,
  fetchAccessToken,
  graphql,
  approveFilings,
  listFilings,
}
