#!/usr/bin/env node
/**
 * Smoke-test Zoom meetings + DocuSign contract APIs on deployed Render.
 *
 * Usage:
 *   BASE_URL=https://mr-storage-backend-025k.onrender.com node scripts/test-zoom-docusign-render.js
 *
 * Env (optional):
 *   LOGIN_EMAIL, LOGIN_PASSWORD, LEAD_ID, SKIP_DOCUSIGN_SEND=true
 */
const BASE = (process.env.BASE_URL || 'https://mr-storage-backend-025k.onrender.com').replace(/\/$/, '')
const EMAIL = process.env.LOGIN_EMAIL || 'admin@construction.com'
const PASS = process.env.LOGIN_PASSWORD || 'Admin@123'
const SKIP_SEND = process.env.SKIP_DOCUSIGN_SEND === 'true'

const results = []
const pass = (name, detail = '') => {
  results.push({ name, ok: true, detail })
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
}
const fail = (name, detail = '') => {
  results.push({ name, ok: false, detail })
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { success: false, message: text.slice(0, 400), _status: res.status }
  }
  return { status: res.status, data, text }
}

async function main() {
  console.log(`\nBase: ${BASE}\nDeploy commit expected: 93bae51 (Zoom + DocuSign)\n`)

  const root = await fetchJson('/')
  if (root.status === 200) pass('GET / health', String(root.data?.message || root.status))
  else fail('GET / health', `status ${root.status}`)

  const login = await fetchJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })
  const token = login.data?.data?.accessToken
  if (!token) {
    fail('POST /api/auth/login', login.data?.message || `HTTP ${login.status}`)
    summarize()
    process.exit(1)
  }
  pass('POST /api/auth/login', login.data?.data?.role || 'admin')

  const auth = { Authorization: `Bearer ${token}` }

  let leadId = process.env.LEAD_ID
  let customerId
  if (!leadId) {
    const leads = await fetchJson('/api/admin/leads?limit=5&page=1', { headers: auth })
    const row = leads.data?.data?.leads?.[0] || leads.data?.data?.items?.[0]
    if (row?._id) {
      leadId = String(row._id)
      customerId = String(row.customerId?._id || row.customerId || '')
    }
  }
  if (!leadId) {
    fail('Resolve leadId for tests', 'No lead in list; set LEAD_ID')
    summarize()
    process.exit(1)
  }
  pass('Resolve test leadId', leadId)

  if (!customerId) {
    const detail = await fetchJson(`/api/admin/leads/${leadId}/detail`, { headers: auth })
    customerId = String(
      detail.data?.data?.lead?.customerId?._id
      || detail.data?.data?.customer?._id
      || detail.data?.data?.customerId
      || '',
    )
  }
  if (!customerId) {
    fail('Resolve customerId', 'Could not load from lead detail')
    summarize()
    process.exit(1)
  }

  // —— DocuSign read ——
  const contractGet = await fetchJson(`/api/admin/leads/${leadId}/contract`, { headers: auth })
  if (contractGet.status === 200 && contractGet.data?.success) {
    const sig = contractGet.data?.data?.signature
    pass('GET /api/admin/leads/:leadId/contract', `status=${sig?.status || '?'}`)
  } else {
    fail('GET /api/admin/leads/:leadId/contract', contractGet.data?.message || `HTTP ${contractGet.status}`)
  }

  const agreementGet = await fetchJson(`/api/admin/leads/${leadId}/agreement`, { headers: auth })
  if (agreementGet.status === 200 && agreementGet.data?.success && agreementGet.data?.data?.signature) {
    pass('GET /api/admin/leads/:leadId/agreement includes signature')
  } else if (agreementGet.status === 200) {
    pass('GET /api/admin/leads/:leadId/agreement', '200 (signature optional on old payloads)')
  } else {
    fail('GET /api/admin/leads/:leadId/agreement', agreementGet.data?.message || `HTTP ${agreementGet.status}`)
  }

  // —— DocuSign webhook auth ——
  const wh = await fetchJson('/api/docusign/webhook', {
    method: 'POST',
    body: JSON.stringify({ envelopeId: 'test' }),
  })
  if (wh.status === 401) pass('POST /api/docusign/webhook rejects unsigned', '401')
  else fail('POST /api/docusign/webhook rejects unsigned', `expected 401, got ${wh.status}`)

  let envelopeOpen = false
  const sig0 = contractGet.data?.data?.signature
  if (['sent', 'delivered', 'viewed'].includes(sig0?.status)) envelopeOpen = true

  if (!SKIP_SEND && sig0?.canSend) {
    const sendBody = {
      signerName: 'Render QA Signer',
      signerEmail: process.env.DOCUSIGN_TEST_SIGNER || 'depotsteelbuilding@gmail.com',
      message: 'Render API smoke test — safe to void.',
    }
    const send = await fetchJson(`/api/admin/leads/${leadId}/contract/send`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(sendBody),
    })
    if (send.status === 201 && send.data?.success) {
      pass('POST /api/admin/leads/:leadId/contract/send', send.data?.data?.signature?.status)
      envelopeOpen = true
    } else {
      fail('POST .../contract/send', send.data?.message || `HTTP ${send.status}`)
    }
  } else if (SKIP_SEND) {
    pass('POST .../contract/send', 'skipped (SKIP_DOCUSIGN_SEND)')
  } else if (envelopeOpen) {
    pass('POST .../contract/send', `skipped — envelope already ${sig0?.status}`)
  } else if (sig0?.status === 'completed') {
    pass('POST .../contract/send', 'skipped — already signed')
  }

  const contract2 = await fetchJson(`/api/admin/leads/${leadId}/contract`, { headers: auth })
  const sig = contract2.data?.data?.signature
  if (contract2.status === 200 && sig?.envelopeId) {
    pass('DocuSign JWT + envelope on server', `envelopeId=${sig.envelopeId.slice(0, 8)}…`)
  } else if (contract2.status === 200 && sig?.status === 'not_sent') {
    fail('DocuSign configured on Render', 'still not_sent after send attempt')
  }

  if (sig?.canRemind) {
    const rem = await fetchJson(`/api/admin/leads/${leadId}/contract/remind`, {
      method: 'POST',
      headers: auth,
    })
    if (rem.status === 200 && rem.data?.success) pass('POST .../contract/remind')
    else fail('POST .../contract/remind', rem.data?.message || `HTTP ${rem.status}`)
  } else {
    pass('POST .../contract/remind', 'skipped — nothing to remind')
  }

  if (sig?.canVoid || envelopeOpen) {
    const v = await fetchJson(`/api/admin/leads/${leadId}/contract/void`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ reason: 'Render API smoke test cleanup' }),
    })
    if (v.status === 200 && v.data?.success) pass('POST .../contract/void', v.data?.data?.signature?.status)
    else if (!sig?.canVoid && !envelopeOpen) pass('POST .../contract/void', 'skipped')
    else fail('POST .../contract/void', v.data?.message || `HTTP ${v.status}`)
  } else {
    pass('POST .../contract/void', 'skipped')
  }

  // —— Zoom meeting ——
  const meetingTime = new Date(Date.now() + 7 * 86400000).toISOString()
  const createM = await fetchJson('/api/admin/meetings', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      customerId,
      leadId,
      title: 'Render Zoom smoke test',
      meetingTime,
      duration: 30,
      mode: 'online',
    }),
  })
  const meeting = createM.data?.data?.meeting
  if (createM.status === 201 && meeting?.meetingLink?.includes('/j/')) {
    pass('POST /api/admin/meetings (online, auto Zoom)', meeting.meetingLink.slice(0, 48) + '…')
  } else {
    fail('POST /api/admin/meetings (online, auto Zoom)', createM.data?.message || `HTTP ${createM.status}`)
  }

  if (meeting?._id && meeting?.zoomMeetingId) {
    const editM = await fetchJson(`/api/admin/meetings/${meeting._id}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ title: 'Render Zoom smoke test (rescheduled)' }),
    })
    if (editM.status === 200) pass('PUT /api/admin/meetings/:id (Zoom sync update)')
    else fail('PUT /api/admin/meetings/:id', editM.data?.message || `HTTP ${editM.status}`)

    const cancelM = await fetchJson(`/api/admin/meetings/${meeting._id}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ status: 'cancelled' }),
    })
    if (cancelM.status === 200) pass('PUT /api/admin/meetings/:id cancel (Zoom delete)')
    else fail('PUT /api/admin/meetings/:id cancel', cancelM.data?.message || `HTTP ${cancelM.status}`)
  }

  const salesLogin = await fetchJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: process.env.SALES_EMAIL || EMAIL,
      password: process.env.SALES_PASSWORD || PASS,
    }),
  })
  const salesToken = salesLogin.data?.data?.accessToken
  if (salesToken && salesLogin.data?.data?.role === 'sales') {
    const sc = await fetchJson(`/api/sales/leads/${leadId}/contract`, {
      headers: { Authorization: `Bearer ${salesToken}` },
    })
    if (sc.status === 200) pass('GET /api/sales/leads/:leadId/contract')
    else fail('GET /api/sales/leads/:leadId/contract', sc.data?.message || `HTTP ${sc.status}`)
  } else {
    pass('GET /api/sales/leads/:leadId/contract', 'skipped — no sales login creds')
  }

  summarize()
  process.exit(results.some((r) => !r.ok) ? 1 : 0)
}

function summarize() {
  const ok = results.filter((r) => r.ok).length
  const bad = results.filter((r) => !r.ok).length
  console.log(`\n=== ${ok} passed, ${bad} failed ===\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})