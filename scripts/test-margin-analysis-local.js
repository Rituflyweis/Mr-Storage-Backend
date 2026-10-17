/**
 * Margin analysis — HTTP + MongoDB cross-check (local).
 * Run: node scripts/test-margin-analysis-local.js
 * Requires: server on BASE_URL (default http://127.0.0.1:5001), .env MONGO_URI
 */
require('dotenv').config()
const http = require('http')
const https = require('https')
const mongoose = require('mongoose')
const connectDB = require('../src/config/db')

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')
const ACCOUNT_EMAIL = process.env.LOGIN_EMAIL || 'account@flyweis.test'
const ACCOUNT_PASS = process.env.LOGIN_PASSWORD || 'Account@1234'
const ADMIN_EMAIL = process.env.ADMIN_LOGIN_EMAIL || 'admin@flyweis.test'
const ADMIN_PASS = process.env.ADMIN_LOGIN_PASSWORD || 'Admin@1234'

const assert = (c, m) => {
  if (!c) throw new Error(m)
}
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps

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
            json = { raw: data.slice(0, 500) }
          }
          resolve({ status: res.statusCode, json })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })

async function login(email, password) {
  const res = await request('POST', '/api/auth/login', { body: { email, password } })
  assert(res.status === 200 && res.json.success, `login ${email}: ${res.status} ${res.json.message}`)
  return res.json.data.accessToken
}

async function getJson(token, path) {
  const res = await request('GET', path, { token })
  return res
}

/** Independent DB rollup for account margin KPI (paid invoices + expenses in range). */
async function dbAccountPeriodTotals(startDate, endDate) {
  const { buildDateFilter } = require('../src/utils/dateRange')
  const { buildPeriodPL } = require('../src/utils/profitLossPeriod.util')
  const dateFilter = buildDateFilter({ startDate, endDate }, 'date')
  return buildPeriodPL({}, dateFilter)
}

/** Sample admin quotation rollup for one lead with latest quotation. */
async function dbAdminLeadQuotationFinancials(leadId) {
  const Quotation = require('../src/models/Quotation')
  const Lead = require('../src/models/Lead')
  const EstimateQuote = require('../src/models/EstimateQuote')
  const { resolveQuotationFinancials } = require('../src/utils/quotationMargin.util')

  const lead = await Lead.findById(leadId).lean()
  const q = await Quotation.findOne({ leadId }).sort({ proposalDate: -1, updatedAt: -1 }).lean()
  let estimate = null
  if (q?.sourceEstimateId) {
    estimate = await EstimateQuote.findById(q.sourceEstimateId).lean()
  }
  return { lead, quotation: q, estimate, financials: resolveQuotationFinancials(q, lead, estimate) }
}

async function main() {
  console.log(`[margin-test] Base: ${BASE}`)

  let accountToken
  let adminToken
  try {
    accountToken = await login(ACCOUNT_EMAIL, ACCOUNT_PASS)
    console.log('[margin-test] Account login OK')
  } catch (e) {
    console.warn('[margin-test] Account login skipped:', e.message)
  }
  try {
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASS)
    console.log('[margin-test] Admin login OK')
  } catch (e) {
    console.warn('[margin-test] Admin login skipped:', e.message)
  }
  assert(accountToken || adminToken, 'Need at least one of account or admin login')

  await connectDB()
  console.log('[margin-test] MongoDB connected')

  const startDate = '2020-01-01'
  const endDate = '2030-12-31'
  const q = `startDate=${startDate}&endDate=${endDate}`

  if (accountToken) {
    const endpoints = [
      `/api/account/financial/margin-analysis/filters`,
      `/api/account/financial/margin-analysis?${q}`,
      `/api/account/financial/margin-analysis/trend?period=month`,
      `/api/account/financial/margin-analysis/by-project?${q}&limit=5`,
      `/api/account/financial/profit-loss/summary?${q}&page=1&limit=5`,
    ]
    for (const path of endpoints) {
      const res = await getJson(accountToken, path)
      assert(res.status === 200, `${path} HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`)
      assert(res.json.success !== false, `${path} failed: ${res.json.message}`)
      console.log(`[margin-test] OK account ${path.split('?')[0]}`)
    }

    const trendBad = await getJson(accountToken, '/api/account/financial/margin-analysis/trend?period=monthly')
    assert(
      trendBad.status === 400 || trendBad.json.success === false,
      'account trend should reject period=monthly (use month|quarter|year)'
    )
    console.log('[margin-test] OK account trend rejects invalid period=monthly')

    const kpi = await getJson(accountToken, `/api/account/financial/margin-analysis?${q}`)
    const data = kpi.json.data
    assert(typeof data.grossMarginPct === 'number', 'account grossMarginPct number')
    assert(data.totals && typeof data.totals.revenue === 'number', 'account totals.revenue')
    assert(data.dataSource !== 'quotation', 'account should not be quotation dataSource')

    const dbPl = await dbAccountPeriodTotals(startDate, endDate)
    assert(
      near(data.totals.revenue, dbPl.totalIncome),
      `account KPI revenue ${data.totals.revenue} vs DB buildPeriodPL ${dbPl.totalIncome}`
    )
    assert(
      near(data.totals.cogs, dbPl.cogs),
      `account KPI cogs ${data.totals.cogs} vs DB ${dbPl.cogs}`
    )
    console.log('[margin-test] OK account KPI totals match buildPeriodPL in DB', {
      revenue: data.totals.revenue,
      cogs: data.totals.cogs,
      grossMarginPct: data.grossMarginPct,
    })

    const byProject = await getJson(accountToken, `/api/account/financial/margin-analysis/by-project?${q}&limit=3`)
    const projects = byProject.json.data?.projects || []
    if (projects.length) {
      const p = projects[0]
      assert(p.leadId && typeof p.revenue === 'number', 'by-project row shape')
      console.log('[margin-test] Sample account by-project row:', {
        projectName: p.projectName,
        revenue: p.revenue,
        cogs: p.cogs,
        grossMarginPct: p.grossMarginPct,
      })
    }
  }

  if (adminToken) {
    const adminPaths = [
      `/api/admin/financials/margin-analysis?${q}`,
      `/api/admin/financials/margin-analysis/trend?period=month`,
      `/api/admin/financials/margin-analysis/by-project?${q}&limit=5`,
      `/api/admin/financials/profit-loss/projects?${q}&page=1&limit=5`,
    ]
    for (const path of adminPaths) {
      const res = await getJson(adminToken, path)
      assert(res.status === 200, `${path} HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`)
      assert(res.json.success !== false, `${path}: ${res.json.message}`)
      console.log(`[margin-test] OK admin ${path.split('?')[0]}`)
    }

    const adminKpi = (await getJson(adminToken, `/api/admin/financials/margin-analysis?${q}`)).json.data
    assert(adminKpi.dataSource === 'quotation', 'admin dataSource must be quotation')
    assert(adminKpi.audience === 'admin', 'admin audience')
    assert(typeof adminKpi.grossMarginPct === 'number', 'admin grossMarginPct')

    const Quotation = require('../src/models/Quotation')
    const sampleQ = await Quotation.findOne({})
      .sort({ proposalDate: -1 })
      .select('leadId finalPrice totalCOGS margin proposalDate')
      .lean()
    if (sampleQ?.leadId) {
      const { financials, quotation } = await dbAdminLeadQuotationFinancials(sampleQ.leadId)
      assert(quotation, 'sample quotation exists')
      console.log('[margin-test] DB sample quotation:', {
        leadId: String(sampleQ.leadId),
        projectName: financials ? undefined : null,
        revenue: financials.revenue,
        cogs: financials.cogs,
        grossMarginPct: financials.grossMarginPct,
        marginFromQuotation: financials.marginFromQuotation,
      })

      const byProj = (await getJson(adminToken, `/api/admin/financials/margin-analysis/by-project?${q}&limit=50`))
        .json.data
      const rows = byProj.projects || byProj.rows || []
      const match = rows.find((r) => String(r.leadId) === String(sampleQ.leadId))
      if (match) {
        assert(
          near(match.revenue || match.salesUSD, financials.revenue, 1),
          `admin by-project revenue ${match.revenue ?? match.salesUSD} vs DB ${financials.revenue}`
        )
        assert(
          near(match.cogs || match.cogsUSD, financials.cogs, 1),
          `admin by-project cogs vs DB quotation cogs`
        )
        console.log('[margin-test] OK admin by-project row matches DB quotation financials for sample lead')
      } else {
        console.log('[margin-test] Note: sample quotation lead not in top by-project page (date filter or limit)')
      }
    } else {
      console.log('[margin-test] No quotations in DB — admin quotation margin will be empty/zero')
    }

    const pl = (await getJson(adminToken, `/api/admin/financials/profit-loss/projects?${q}&limit=3`)).json.data
    const plRows = pl.projects || pl.rows || []
    assert(Array.isArray(plRows), 'admin P&L projects array')
    if (plRows[0]) {
      assert(typeof plRows[0].grossMarginPct === 'number', 'P&L grossMarginPct')
      console.log('[margin-test] Sample admin P&L row:', {
        projectName: plRows[0].projectName,
        salesUSD: plRows[0].salesUSD,
        cogsUSD: plRows[0].cogsUSD,
        grossMarginPct: plRows[0].grossMarginPct,
      })
    }
  }

  const qCount = await mongoose.connection.db.collection('quotations').countDocuments({})
  const invPaid = await mongoose.connection.db.collection('invoices').countDocuments({ status: 'paid' })
  console.log('\n[margin-test] DB counts:', { quotations: qCount, paidInvoices: invPaid })
  console.log('[margin-test] All margin analysis checks passed.')
  await mongoose.disconnect()
}

main().catch(async (e) => {
  console.error('\n[margin-test] FAILED:', e.message)
  try {
    await mongoose.disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
