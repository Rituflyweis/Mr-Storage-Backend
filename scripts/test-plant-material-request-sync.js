#!/usr/bin/env node
/**
 * Construction MR (source=construction) must appear on plant project tab.
 * Usage: BASE_URL=http://localhost:5001 node scripts/test-plant-material-request-sync.js
 */
const BASE = process.env.BASE_URL || 'http://localhost:5001'
const CONSTRUCTION_EMAIL = process.env.TEST_CONSTRUCTION_EMAIL || 'claude.qa.construction@internal-test.mrstorage.dev'
const PLANT_EMAIL = process.env.TEST_PLANT_EMAIL || 'claude.qa.plant@internal-test.mrstorage.dev'
const PASS = process.env.TEST_PASSWORD || 'ClaudeQA@2026'
const LEAD_ID = process.env.LEAD_ID || ''

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function login(email) {
  const { status, json } = await api(null, 'POST', '/api/auth/login', { email, password: PASS })
  if (status !== 200 || !json?.data?.accessToken) throw new Error(`Login failed ${email}: ${status} ${json?.message}`)
  return json.data.accessToken
}

async function main() {
  const constructionToken = await login(CONSTRUCTION_EMAIL)
  const plantToken = await login(PLANT_EMAIL)

  let leadId = LEAD_ID
  if (!leadId) {
    const list = await api(constructionToken, 'GET', '/api/construction/material-requests?page=1&limit=1')
    leadId = list.json?.data?.materialRequests?.[0]?.project?.leadId
      || list.json?.data?.materialRequests?.[0]?.leadId
  }
  if (!leadId) {
    const projects = await api(constructionToken, 'GET', '/api/construction/projects?page=1&limit=1')
    leadId = projects.json?.data?.projects?.[0]?._id
  }
  if (!leadId) throw new Error('No leadId — set LEAD_ID or seed data')

  const created = await api(constructionToken, 'POST', '/api/construction/material-requests', {
    leadId,
    siteLocation: 'Local sync test',
    department: 'Framing',
    requestedItems: [{ name: 'Sync test panel', quantity: 1, unit: 'EA' }],
    priority: 'medium',
  })
  const createOk = created.status === 201 || created.status === 200
  const mrId = created.json?.data?.materialRequest?._id || created.json?.data?.materialRequest?.id
  console.log('POST construction material-request:', createOk ? 'OK' : `FAIL ${created.status}`, mrId || '')

  const constructionList = await api(constructionToken, 'GET', `/api/construction/material-requests?leadId=${leadId}&page=1&limit=20`)
  const constructionTotal = constructionList.json?.data?.total ?? constructionList.json?.data?.materialRequests?.length ?? 0

  const plantTab = await api(plantToken, 'GET', `/api/plant/projects/${leadId}/additional-material-requests?page=1&limit=20`)
  const plantRows = plantTab.json?.data?.additionalMaterialRequests || []
  const plantTotal = plantTab.json?.data?.total ?? 0
  const hasConstruction = plantRows.some((r) => (r.source || 'construction') === 'construction')

  console.log('leadId:', leadId)
  console.log('construction list total:', constructionTotal)
  console.log('plant tab HTTP:', plantTab.status, 'total:', plantTotal, 'hasConstruction:', hasConstruction)

  if (plantTab.status === 403) {
    console.error('FAIL: plant scope — assign PO to plant user for this lead')
    process.exit(1)
  }
  if (plantTab.status !== 200) {
    console.error('FAIL: plant tab', plantTab.json?.message)
    process.exit(1)
  }
  if (plantTotal < 1 || !hasConstruction) {
    console.error('FAIL: construction MR not visible on plant additional-material-requests')
    process.exit(1)
  }
  console.log('PASS: plant project tab includes construction material requests')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
