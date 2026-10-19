/**
 * Account tax gap fixes + Figma API smoke test (local server + real MongoDB).
 * Run: node scripts/test-tax-gap-fixes-local.js
 * Env: BASE_URL, LOGIN_EMAIL, LOGIN_PASSWORD (default admin@construction.com / Admin@123)
 */
require('dotenv').config()
const http = require('http')
const https = require('https')

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5001').replace(/\/$/, '')
const EMAIL = process.env.LOGIN_EMAIL || 'admin@construction.com'
const PASS = process.env.LOGIN_PASSWORD || 'Admin@123'

const assert = (c, m) => {
  if (!c) throw new Error(m)
}

const request = (method, path, { token, body, accept } = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, BASE)
    const lib = url.protocol === 'https:' ? https : http
    const payload = body ? JSON.stringify(body) : null
    const req = lib.request(
      url,
      {
        method,
        headers: {
          ...(accept ? { Accept: accept } : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload && !accept ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(payload && accept ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const ct = res.headers['content-type'] || ''
          if (ct.includes('application/pdf')) {
            return resolve({ status: res.statusCode, pdf: buf, contentType: ct })
          }
          let json = null
          try {
            json = JSON.parse(buf.toString('utf8'))
          } catch {
            json = { raw: buf.toString('utf8').slice(0, 200) }
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
  console.log('[gap-test] Base:', BASE)
  const login = await request('POST', '/api/auth/login', { body: { email: EMAIL, password: PASS } })
  assert(login.status === 200 && login.json.success, `Login: ${login.json?.message || login.status}`)
  const token = login.json.data.accessToken
  console.log('[gap-test] Login OK', login.json.data.user?.email)

  // ── Notification settings ──
  const notifGet = await request('GET', '/api/account/financial-extra/tax-filing/notification-settings', { token })
  assert(notifGet.status === 200 && notifGet.json.data?.settings, 'notification-settings GET')
  const notifPut = await request('PUT', '/api/account/financial-extra/tax-filing/notification-settings', {
    token,
    body: {
      emailReminders: true,
      deadlineAlerts: true,
      daysBeforeDue: 7,
      recipientEmail: 'tax-qa@internal-test.mrstorage.dev',
    },
  })
  assert(notifPut.status === 200 && notifPut.json.data?.settings?.recipientEmail, 'notification-settings PUT')
  console.log('[gap-test] Notification settings OK')

  // ── Tax filing hub ──
  for (const path of [
    '/api/account/financial-extra/tax-filing/stats',
    '/api/account/financial-extra/tax-filing/filters',
    '/api/account/financial-extra/tax-filing?limit=5',
    '/api/account/financial-extra/tax-compliance/status',
  ]) {
    const r = await request('GET', path, { token })
    assert(r.status === 200 && r.json.success, `${path} → ${r.status}`)
  }
  const filing = await request('GET', '/api/account/financial-extra/tax-filing?limit=5', { token })
  const pendingRow = filing.json.data?.pendingFiling?.[0]
  if (pendingRow) {
    assert(pendingRow.status?.code, 'pending row has status.code')
    assert(typeof pendingRow.salesTaxRateLabel === 'string', 'pending row salesTaxRateLabel')
    console.log('[gap-test] Pending row sample:', pendingRow.state, pendingRow.status?.code, pendingRow.salesTaxRateLabel)
  }
  console.log('[gap-test] Tax filing hub OK')

  // ── State / project wise + meta ──
  const stateList = await request('GET', '/api/account/financial-extra/state-wise-tax', { token })
  assert(stateList.status === 200 && stateList.json.data?.meta, 'state-wise meta')
  const stateRow = stateList.json.data?.stateOverview?.[0]
  if (stateRow) {
    assert('taxRecordId' in stateRow, 'state taxRecordId field')
    console.log('[gap-test] State row taxRecordId:', stateRow.taxRecordId || '(null)')
  }

  const projList = await request('GET', '/api/account/financial-extra/project-wise-tax?page=1&limit=5', { token })
  assert(projList.status === 200 && projList.json.data?.meta, 'project-wise meta')
  assert(projList.json.data?.lastSynced != null || projList.json.data?.meta?.lastSyncedAt != null, 'project-wise lastSynced')
  const projRow = projList.json.data?.projects?.[0]
  if (projRow) {
    assert('taxRecordId' in projRow, 'project taxRecordId')
    assert(typeof projRow.salesTaxRateLabel === 'string', 'project salesTaxRateLabel')
    console.log('[gap-test] Project row:', projRow.projectName, projRow.taxRecordId, projRow.salesTaxRateLabel)
  }

  for (const path of [
    '/api/account/financial-extra/state-wise-tax/stats',
    '/api/account/financial-extra/project-wise-tax/stats',
  ]) {
    const r = await request('GET', path, { token })
    assert(r.status === 200, path)
  }
  console.log('[gap-test] State/project wise OK')

  // ── Upcoming deadlines (scope) ──
  const dlState = await request('GET', '/api/account/financial-extra/state-wise-tax/upcoming-deadlines?limit=3&scope=state', {
    token,
  })
  assert(dlState.status === 200 && dlState.json.data?.meta, 'deadlines scope=state meta')
  const dlProject = await request('GET', '/api/account/financial-extra/state-wise-tax/upcoming-deadlines?limit=3&scope=project', {
    token,
  })
  assert(dlProject.status === 200, 'deadlines scope=project')
  const d0 = dlProject.json.data?.deadlines?.[0]
  if (d0) {
    assert(d0.taxRecordId, 'deadline taxRecordId')
    console.log('[gap-test] Project deadline:', d0.projectName || d0.state, d0.taxRecordId)
  }
  console.log('[gap-test] Upcoming deadlines OK')

  // ── Detail / prepare (if we have a tax id) ──
  const taxId =
    pendingRow?._id ||
    stateRow?.taxRecordId ||
    projRow?.taxRecordId ||
    d0?.taxRecordId
  if (taxId) {
    const detail = await request('GET', `/api/account/financial-extra/tax-filing/${taxId}/detail`, { token })
    assert(detail.status === 200 && detail.json.data?.detail, 'tax detail')
    assert(detail.json.data.detail.activityLog || detail.json.data.detail.recentActivity, 'detail activity')
    const prep = await request('GET', `/api/account/financial-extra/tax-filing/${taxId}/prepare`, { token })
    assert(prep.status === 200, 'tax prepare')
    console.log('[gap-test] Detail/prepare OK for', taxId)
  } else {
    console.warn('[gap-test] Skip detail — no tax id in DB')
  }

  // ── Receipt: find paid record or pay pending ──
  let paidTaxId = filing.json.data?.filingHistory?.[0]?._id
  if (!paidTaxId && taxId) {
    const pay = await request('POST', `/api/account/financial-extra/tax-filing/${taxId}/pay`, {
      token,
      body: {
        paymentMethod: 'QA test ACH',
        notificationEmail: '',
      },
    })
    if (pay.status === 200) {
      paidTaxId = pay.json.data?.tax?._id || taxId
      console.log('[gap-test] Paid pending tax for receipt test', paidTaxId)
    } else {
      console.warn('[gap-test] Pay skipped:', pay.status, pay.json?.message)
    }
  }

  if (paidTaxId) {
    const receiptJson = await request('GET', `/api/account/financial-extra/tax-filing/${paidTaxId}/receipt`, { token })
    assert(receiptJson.status === 200 && receiptJson.json.data?.amountPaid != null, 'receipt JSON')
    assert(receiptJson.json.data?.download?.format === 'pdf', 'receipt download hint')
    const receiptPdf = await request('GET', `/api/account/financial-extra/tax-filing/${paidTaxId}/receipt?format=pdf`, {
      token,
    })
    assert(receiptPdf.status === 200 && receiptPdf.pdf?.length > 500, 'receipt PDF bytes')
    assert(String(receiptPdf.contentType).includes('pdf'), 'receipt content-type')
    console.log('[gap-test] Receipt JSON + PDF OK', receiptPdf.pdf.length, 'bytes')
  } else {
    console.warn('[gap-test] Skip receipt — no paid tax')
  }

  // ── Sync ──
  const sync = await request('POST', '/api/account/financial-extra/state-wise-tax/sync', { token })
  assert(sync.status === 200 && sync.json.data?.syncedAt, 'sync')
  console.log('[gap-test] Sync OK', sync.json.data.regions, 'regions')

  // ── Staff invoice tax routes (/api/common/invoices) ──
  const invList = await request('GET', '/api/common/invoices?limit=1', { token })
  assert(invList.status === 200, 'common invoices list')
  const invRow = invList.json.data?.invoices?.[0]
  const invId = invRow?.invoice?._id || invRow?._id
  if (invId) {
    const getTax = await request('GET', `/api/common/invoices/${invId}/tax`, { token })
    assert(getTax.status === 200, `GET common invoice tax ${getTax.status}`)
    const preview = await request('POST', `/api/common/invoices/${invId}/tax-preview`, { token, body: {} })
    assert(preview.status === 200, `tax-preview ${preview.status}`)
    console.log('[gap-test] Common invoice tax routes OK', invId)
  } else {
    console.warn('[gap-test] Skip invoice tax routes — no invoice')
  }

  // ── Account role smoke (financial-extra must work for account) ──
  const acctLogin = await request('POST', '/api/auth/login', {
    body: { email: 'claude.qa.account@internal-test.mrstorage.dev', password: process.env.QA_ACCOUNT_PASSWORD || 'ClaudeQA@2026' },
  })
  if (acctLogin.status === 200 && acctLogin.json.success) {
    const acctToken = acctLogin.json.data.accessToken
    const acctStats = await request('GET', '/api/account/financial-extra/tax-filing/stats', { token: acctToken })
    assert(acctStats.status === 200, 'account role tax-filing/stats')
    console.log('[gap-test] Account role access OK')
  } else {
    console.warn('[gap-test] Account role login skipped (set QA_ACCOUNT_PASSWORD if needed)')
  }

  console.log('\n[gap-test] All gap-fix checks passed.')
}

main().catch((e) => {
  console.error('\n[gap-test] FAILED:', e.message)
  process.exit(1)
})
