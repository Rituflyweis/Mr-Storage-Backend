#!/usr/bin/env node
/**
 * Smoke + concurrency check for quoting APIs on UAT/prod.
 * Usage: BASE_URL=https://mr-storage-backend-025k.onrender.com node scripts/test-quoting-apis-live.js
 */
const BASE = process.env.BASE_URL || 'https://mr-storage-backend-025k.onrender.com'
const EMAIL = process.env.LOGIN_EMAIL || 'admin@construction.com'
const PASS = process.env.LOGIN_PASSWORD || 'Admin@123'
const PREFIX = process.env.API_PREFIX || '/api/admin'

const results = []

const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  const mark = pass ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function json(method, path, token, body) {
  const res = await fetch(`${BASE}${PREFIX}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { success: false, message: text.slice(0, 200), _http: res.status }
  }
  return { status: res.status, data }
}

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json())
  record('GET /health', health.status === 'ok', health.env || '')

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  }).then((r) => r.json())
  if (!login.success) {
    record('POST /api/auth/login', false, login.message)
    process.exit(1)
  }
  const token = login.data.accessToken
  record('POST /api/auth/login', true, login.data.role)

  const customPrev = await json('POST', '/custom-quotes/preview', token, {
    matCost: 50000,
    freight: 10000,
    laborCost: 20000,
    marginPct: 20,
  })
  const cx = customPrev.data.data || {}
  const csum = (cx.matSell || 0) + (cx.freightSell || 0) + (cx.laborSell || 0)
  record(
    'POST /custom-quotes/preview',
    customPrev.data.success && csum === cx.sell,
    `sell=${cx.sell}`,
  )

  const customHtml = await json('POST', '/custom-quotes/pdf', token, {
    format: 'html',
    matCost: 50000,
    freight: 10000,
    laborCost: 20000,
    marginPct: 20,
  })
  const html = customHtml.data.data?.html || ''
  record(
    'POST /custom-quotes/pdf (html)',
    customHtml.data.success && html.includes('Pricing Summary (Sell values)'),
  )

  const storageBody = {
    storageData: {
      buildings: [{ name: 'B1', cogs: 85664, markup: 25, sqft: 3000 }],
      doors: [],
      extras: [{ desc: 'addon', cogs: 50, markup: 25, include: true }],
    },
    pembAddOns: [{ item: 'addon', cost: 50, markup: 25, inQuote: true }],
    shipping: 14000,
    installSellPerSf: 9.75,
    squareFootage: 3000,
    salesTax: { rate: 8.25, include: true },
  }

  const storageCompute = await json('POST', '/estimates/compute-storage', token, storageBody)
  const sp = storageCompute.data.data?.storagePricing || {}
  record(
    'POST /estimates/compute-storage',
    storageCompute.data.success && sp.pembAddOnSellApplied === 0,
    `grand=${sp.grandTotal}`,
  )

  const docPrev = await json('POST', '/estimates/documents/preview', token, {
    jobType: 'Storage',
    ...storageBody,
  })
  const qhtml = String(docPrev.data.data?.quoteHtml || '')
  record(
    'POST /estimates/documents/preview',
    docPrev.data.success && !qhtml.includes('Manual add-on line items'),
  )

  const depPrev = await json('POST', '/estimates/deposit/preview', token, {
    grand: 100000,
    pct: 30,
  })
  record('POST /estimates/deposit/preview', depPrev.data.success)

  const milePrev = await json('POST', '/estimates/milestones/preview', token, {
    grand: 100000,
    rows: [{ label: 'Deposit', type: 'pct', pct: 30 }],
  })
  record('POST /estimates/milestones/preview', milePrev.data.success)

  const stairPrev = await json('POST', '/estimates/staircase/preview', token, {
    count: 2,
    unitCost: 35000,
    markup: 25,
  })
  record('POST /estimates/staircase/preview', stairPrev.data.success)

  const list = await json('GET', '/estimates?limit=5', token)
  record('GET /estimates', list.data.success)

  const rows = list.data.data?.estimates || list.data.data?.items || []
  const draftId =
    process.env.ESTIMATE_ID ||
    rows.find((e) => e.status === 'draft' && e.jobType === 'Storage')?._id ||
    '6ae82006923deaac9a0ec0c7'

  if (draftId) {
    const parallel = await Promise.all(
      Array.from({ length: 4 }, () =>
        json('POST', `/estimates/${draftId}/compute-storage`, token, {}),
      ),
    )
    const okCount = parallel.filter((r) => r.data.success).length
    const conflict = parallel.filter((r) => r.status === 409).length
    record(
      `POST /estimates/${draftId}/compute-storage x4 parallel`,
      okCount >= 3 && okCount + conflict === 4,
      `ok=${okCount} conflict409=${conflict}`,
    )
    record(
      'GET /health after concurrent compute',
      (await fetch(`${BASE}/health`).then((r) => r.json())).status === 'ok',
    )
  } else {
    record('parallel compute-storage (skip)', true, 'no draft Storage estimate in list')
  }

  const failed = results.filter((r) => !r.pass)
  console.log('\n---')
  console.log(`Total: ${results.length}, Failed: ${failed.length}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
