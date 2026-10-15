/**
 * Hit a running local backend (default http://127.0.0.1:5001) against real MongoDB.
 * Run: node scripts/test-live-local-server.js
 * Optional: BASE_URL, LOGIN_EMAIL, LOGIN_PASSWORD
 */
require('dotenv').config()
const http = require('http')
const https = require('https')

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')
const EMAIL = process.env.LOGIN_EMAIL || 'account@flyweis.test'
const PASS = process.env.LOGIN_PASSWORD || 'Account@1234'

const assert = (c, m) => {
  if (!c) throw new Error(m)
}

const request = (method, path, { token, body } = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const lib = url.protocol === 'https:' ? https : http
    const payload = body ? JSON.stringify(body) : null
    const req = lib.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let json = null
          try {
            json = JSON.parse(data)
          } catch {
            json = { raw: data }
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })

async function main() {
  console.log(`[live] Base URL: ${BASE}`)

  const login = await request('POST', '/api/auth/login', {
    body: { email: EMAIL, password: PASS },
  })
  assert(login.status === 200, `login HTTP ${login.status}`)
  assert(login.json.success, `login failed: ${login.json.message}`)
  const token = login.json.data.accessToken
  console.log('[live] Login OK as', login.json.data.user?.email || EMAIL)

  const endpoints = [
    '/api/account/reports/project-wise-expense?page=1&limit=5',
    '/api/account/reports/project-wise-income?page=1&limit=5',
    '/api/account/reports/profit-loss?page=1&limit=5',
    '/api/account/financial/profit-loss/summary?period=monthly',
    '/api/account/customers?limit=2',
    '/api/account/costs/filters',
    '/api/account/costs/salary/summary',
    '/api/account/costs/manpower/summary',
    '/api/account/costs/miscellaneous/summary',
    '/api/account/costs/freight/summary',
    '/api/account/costs/freight/records?limit=3',
    '/api/account/costs/logistics/summary',
    '/api/account/costs/variance/summary',
    '/api/account/costs/variance/details?limit=3',
    '/api/account/costs/rent/summary',
    '/api/account/costs/item-list/summary',
    '/api/account/costs/item-list/categories',
    '/api/account/costs/item-list/records?limit=5&sort=latest',
    '/api/account/costs/future/summary',
    '/api/account/invoice-management/filters',
    '/api/account/invoice-management/project/summary',
    '/api/account/invoice-management/project/records?limit=3',
    '/api/account/invoice-management/vendor/summary',
    '/api/account/invoice-management/vendor/records?limit=3',
    '/api/account/invoice-management/carrier/summary',
    '/api/account/invoice-management/miscellaneous/summary',
    '/api/account/invoice-management/miscellaneous/records?limit=3',
    '/api/account/invoice-management/quotation-profit/summary',
    '/api/account/invoice-management/quotation-profit/records?limit=3',
  ]

  const projectPick = await request('GET', '/api/account/projects?limit=1', { token })
  const projectId =
    projectPick.json.data?.projects?.[0]?.leadId ||
    projectPick.json.data?.projects?.[0]?._id
  if (projectId) {
    endpoints.push(
      `/api/account/projects/${projectId}/invoices/summary`,
      `/api/account/projects/${projectId}/invoices/records?limit=3`,
      `/api/account/projects/${projectId}/payments/summary`,
      `/api/account/projects/${projectId}/payments/records?limit=3`,
      `/api/account/projects/${projectId}/deliveries?limit=3`,
      `/api/account/projects/${projectId}/quotations`,
      `/api/account/projects/${projectId}/bom`,
      `/api/account/projects/${projectId}/agreement`
    )
  }

  for (const path of endpoints) {
    const res = await request('GET', path, { token })
    assert(res.status === 200, `${path} HTTP ${res.status}`)
    assert(res.json.success !== false, `${path} success=false: ${res.json.message}`)
    console.log(`[live] OK ${path}`)
  }

  const expense = await request('GET', '/api/account/reports/project-wise-expense?page=1&limit=5', {
    token,
  })
  const d = expense.json.data
  assert(d.summary && typeof d.summary.totalExpense === 'number', 'expense summary.totalExpense')
  assert(Array.isArray(d.rows), 'expense rows array')
  assert(d.summary.sources, 'expense summary.sources')
  const src = d.summary.sources
  assert(
    typeof src.manualExpenses === 'number' &&
      typeof src.vendorMaterialFromEmailBids === 'number' &&
      typeof src.freightFromEmailBids === 'number',
    'expense source breakdown fields'
  )
  const recomposed =
    src.manualExpenses + src.vendorMaterialFromEmailBids + src.freightFromEmailBids
  assert(
    Math.abs(recomposed - d.summary.totalExpense) < 0.02 ||
      d.summary.totalExpense <= recomposed + 0.02,
    `portfolio totalExpense (${d.summary.totalExpense}) should align with sources sum (${recomposed})`
  )
  if (d.rows.length) {
    const row = d.rows[0]
    assert(row.sources, 'row.sources present')
    const rowSum =
      row.sources.manualExpenses +
      row.sources.vendorMaterialFromEmailBids +
      row.sources.freightFromEmailBids
    assert(
      Math.abs(rowSum - row.totalExpense) < 0.02,
      `row totalExpense ${row.totalExpense} vs sources ${rowSum}`
    )
    if (row.leadId) {
      const proj = await request('GET', `/api/account/projects/${row.leadId}`, { token })
      assert(proj.status === 200, `project detail HTTP ${proj.status}`)
      const totalCost = proj.json.data?.profitabilityOverview?.find((r) => r.key === 'totalCost')
      if (totalCost) {
        assert(
          Math.abs(totalCost.actual - row.totalExpense) < 0.02,
          `project detail totalCost ${totalCost.actual} vs report row ${row.totalExpense}`
        )
        console.log(
          `[live] Cross-check project ${row.projectName}: report totalExpense = detail totalCost = ${row.totalExpense}`
        )
      }
    }
  }

  console.log('\n[live] All local server checks passed (real DB).')
  console.log('[live] Expense portfolio summary:', {
    totalExpense: d.summary.totalExpense,
    sources: d.summary.sources,
    rowCount: d.rows.length,
  })
}

main().catch((e) => {
  console.error('\n[live] FAILED:', e.message)
  process.exit(1)
})
