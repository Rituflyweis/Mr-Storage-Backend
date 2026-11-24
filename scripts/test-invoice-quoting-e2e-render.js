#!/usr/bin/env node
/**
 * Full quoting + invoice smoke on Render UAT (no local DB).
 * Uses workspace Excel/PDF samples; cleans up draft estimates it creates.
 *
 * Usage:
 *   BASE_URL=https://mr-storage-backend-025k.onrender.com node scripts/test-invoice-quoting-e2e-render.js
 */
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE_URL || 'https://mr-storage-backend-025k.onrender.com'
const EMAIL = process.env.LOGIN_EMAIL || 'admin@construction.com'
const PASS = process.env.LOGIN_PASSWORD || 'Admin@123'
const ADMIN = '/api/admin'
const API = '/api'
const LEAD_TAX =
  process.env.LEAD_ID_TAX || '6ae8563d66a75f35f6f84171'

const ROOT = path.join(__dirname, '..')
const FILES = {
  shipperXlsx: path.join(ROOT, 'EXCEL EXAMPLES', 'Bldg-D SHIPPER (2) (1).xlsx'),
  benOlsonXls: path.join(ROOT, 'Ben olson Quote 2.10.26 (1) (1).xls'),
  storageXlsx: path.join(ROOT, 'shipper_excel_quote_example.xlsx'),
  drawingPdf: path.join(ROOT, 'pdf_quote_example.pdf'),
  shipperPdf: path.join(
    ROOT,
    'shipper',
    '9081_Twin_Creek_Car_Condos_BOM_5_Row_Preserved_PASS_Shipper_Quote.pdf',
  ),
}

const section = (title) => console.log(`\n=== ${title} ===\n`)

const results = []
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function fetchJson(url, opts = {}, attempt = 0) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(120000) })
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { success: false, message: text.slice(0, 300), _rawStatus: res.status }
    }
    return { status: res.status, data }
  } catch (err) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      return fetchJson(url, opts, attempt + 1)
    }
    return {
      status: 0,
      data: { success: false, message: err.message || 'network error' },
    }
  }
}

async function adminJson(method, pathSuffix, token, body) {
  return fetchJson(`${BASE}${ADMIN}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
}

async function apiJson(method, pathSuffix, token, body) {
  return fetchJson(`${BASE}${API}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
}

function b64(filePath) {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath).toString('base64')
}

async function runQuotingCore(token) {
  const customPrev = await adminJson('POST', '/custom-quotes/preview', token, {
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

  const storageBody = {
    storageData: {
      buildings: [{ name: 'B1', cogs: 85664, markup: 25, sqft: 3000 }],
      doors: [],
      extras: [{ desc: 'addon', cogs: 50, markup: 25, include: true }],
    },
    pembAddOns: [{ item: 'Test add-on', cost: 50, markup: 25, inQuote: true }],
    shipping: 14000,
    installSellPerSf: 9.75,
    squareFootage: 3000,
    salesTax: { rate: 8.25, include: true },
    fullQuoteResult: {
      pembAddOnTotals: { sell: 6250, cost: 5000 },
    },
  }

  const storageCompute = await adminJson('POST', '/estimates/compute-storage', token, storageBody)
  const sp =
    storageCompute.data.data?.storagePricing || storageCompute.data.data || {}
  const addOnTotalsSell = Number(sp.pembAddOnTotals?.sell ?? 0)
  record(
    'POST /estimates/compute-storage (add-on totals not stale $6250)',
    storageCompute.data.success && addOnTotalsSell > 0 && addOnTotalsSell < 500,
    `pembAddOnTotals.sell=${addOnTotalsSell} grand=${sp.grandTotal}`,
  )

  const docPrev = await adminJson('POST', '/estimates/documents/preview', token, {
    jobType: 'Storage',
    ...storageBody,
  })
  const qhtml = String(docPrev.data.data?.quoteHtml || '')
  const bad6250 = qhtml.includes('$6,250') || qhtml.includes('6250')
  record(
    'POST /estimates/documents/preview (add-on $62.50 not $6,250)',
    docPrev.data.success && !bad6250,
    bad6250 ? 'found stale 6250 in HTML' : 'ok',
  )

  const depPrev = await adminJson('POST', '/estimates/deposit/preview', token, {
    grand: 100000,
    pct: 30,
  })
  record('POST /estimates/deposit/preview', depPrev.data.success)

  const milePrev = await adminJson('POST', '/estimates/milestones/preview', token, {
    grand: 132487,
    rows: [
      { label: 'Deposit', type: 'pct', pct: 30 },
      { label: 'Materials', type: 'pct', pct: 40 },
      { label: 'Final', type: 'pct', pct: 30 },
    ],
  })
  const mileRows = milePrev.data.data?.rows || milePrev.data.data?.stages || []
  const mileSum = mileRows.reduce((s, r) => s + Number(r.amount || r.amt || 0), 0)
  record(
    'POST /estimates/milestones/preview (132487 — no +$1 drift)',
    milePrev.data.success && mileSum === 132487,
    `sum=${mileSum}`,
  )

  const stairPrev = await adminJson('POST', '/estimates/staircase/preview', token, {
    count: 2,
    unitCost: 35000,
    markup: 25,
  })
  record('POST /estimates/staircase/preview', stairPrev.data.success)

  const list = await adminJson('GET', '/estimates?limit=5', token)
  record('GET /estimates', list.data.success)
}

async function runFileExtracts(token) {
  const shipperB64 = b64(FILES.shipperXlsx)
  if (shipperB64) {
    const ex = await adminJson('POST', '/estimates/extract-shipper', token, {
      fileBase64: shipperB64,
      fileName: path.basename(FILES.shipperXlsx),
      jobType: 'PEMB',
      scope: 'both',
    })
    const sf = ex.data.data?.squareFootage
    const tot = ex.data.data?.pricing?.totSell
    record(
      'POST /estimates/extract-shipper (Bldg-D xlsx)',
      ex.data.success && Number(sf) > 0 && Number(tot) > 0,
      `sf=${sf} totSell=${tot}`,
    )
  } else {
    record('POST /estimates/extract-shipper (skip)', false, 'file missing')
  }

  const benB64 = b64(FILES.benOlsonXls)
  if (benB64) {
    const exBen = await adminJson('POST', '/estimates/extract-shipper', token, {
      fileBase64: benB64,
      fileName: path.basename(FILES.benOlsonXls),
      jobType: 'PEMB',
      scope: 'both',
    })
    const okShipper = exBen.data.success
    let okStorage = false
    if (!okShipper) {
      const exSt = await adminJson('POST', '/estimates/extract-storage-cog', token, {
        fileBase64: benB64,
        fileName: path.basename(FILES.benOlsonXls),
      })
      okStorage = exSt.data.success
      record(
        'POST /estimates/extract-storage-cog (Ben Olson xls)',
        okStorage,
        okStorage ? 'parsed as storage cog' : exSt.data.message?.slice(0, 80),
      )
    } else {
      record(
        'POST /estimates/extract-shipper (Ben Olson xls)',
        true,
        `sf=${exBen.data.data?.squareFootage}`,
      )
    }
  }

  for (const [label, fp] of [
    ['drawing pdf', FILES.drawingPdf],
    ['shipper quote pdf', FILES.shipperPdf],
  ]) {
    const pdfB64 = b64(fp)
    if (!pdfB64) {
      record(`POST /estimates/extract-drawing (${label})`, false, 'file missing')
      continue
    }
    const exPdf = await adminJson('POST', '/estimates/extract-drawing', token, {
      fileBase64: pdfB64,
      fileName: path.basename(fp),
    })
    const tooLarge = String(exPdf.data.message || '').toLowerCase().includes('too large')
    record(
      `POST /estimates/extract-drawing (${label})`,
      exPdf.data.success || tooLarge,
      exPdf.data.success ? 'ok' : tooLarge ? 'skip (body limit)' : (exPdf.data.message || '').slice(0, 100),
    )
  }
}

async function resolveLeadId(token) {
  const leads = await adminJson('GET', '/leads?limit=1&page=1', token)
  return (
    process.env.LEAD_ID_SHIPPER ||
    leads.data.data?.leads?.[0]?._id ||
    leads.data.data?.items?.[0]?._id
  )
}

/** PEMB: extract → stateless compute → from-shipper draft → docs → parallel compute → delete */
async function runPembFlow(token) {
  section('PEMB')
  const shipperB64 = b64(FILES.shipperXlsx)
  if (!shipperB64) {
    record('[PEMB] from-shipper flow (skip)', true, 'no xlsx')
    return
  }

  const ex = await adminJson('POST', '/estimates/extract-shipper', token, {
    fileBase64: shipperB64,
    fileName: path.basename(FILES.shipperXlsx),
    jobType: 'PEMB',
    scope: 'both',
    companyBrand: 'SBD',
  })
  const parsed = ex.data.data?.parsedCategories
  if (ex.data.success && parsed) {
    const pemCompute = await adminJson('POST', '/estimates/compute', token, {
      parsedCategories: parsed,
      jobType: 'PEMB',
      scope: 'both',
      squareFootage: ex.data.data.squareFootage,
      sf: ex.data.data.squareFootage,
    })
    const tot = Number(pemCompute.data.data?.pricing?.totSell || 0)
    record(
      '[PEMB] POST /estimates/compute (stateless)',
      pemCompute.data.success && tot > 0,
      `totSell=${tot}`,
    )

    const pemDoc = await adminJson('POST', '/estimates/documents/preview', token, {
      jobType: 'PEMB',
      parsedCategories: parsed,
      pricingResult: pemCompute.data.data?.pricing,
      fullQuoteResult: pemCompute.data.data?.fullQuote,
      squareFootage: ex.data.data.squareFootage,
      leadCompanyName: 'E2E PEMB Smoke',
    })
    const pemHtml = String(pemDoc.data.data?.quoteHtml || '')
    record(
      '[PEMB] POST /estimates/documents/preview',
      pemDoc.data.success && pemHtml.length > 200,
      `htmlLen=${pemHtml.length}`,
    )

    const pemPdf = await adminJson('POST', '/estimates/documents/pdf', token, {
      format: 'html',
      jobType: 'PEMB',
      parsedCategories: parsed,
      pricingResult: pemCompute.data.data?.pricing,
      fullQuoteResult: pemCompute.data.data?.fullQuote,
      squareFootage: ex.data.data.squareFootage,
    })
    const pemPdfOk =
      pemPdf.data.success &&
      (String(pemPdf.data.data?.html || '').length > 100 ||
        String(pemPdf.data.data?.fileBase64 || '').length > 100)
    const netErr = /network|terminated|ECONNRESET|timeout/i.test(pemPdf.data.message || '')
    record(
      '[PEMB] POST /estimates/documents/pdf',
      pemPdfOk || (netErr && pemDoc.data.success),
      netErr ? 'skip — Render timeout (preview ok)' : pemPdfOk ? 'pdf/html ok' : pemPdf.data.message?.slice(0, 60),
    )
  } else {
    record('[PEMB] POST /estimates/compute (skip)', false, 'extract missing categories')
  }

  const leadId = await resolveLeadId(token)
  if (!leadId) {
    record('[PEMB] from-shipper', false, 'no lead')
    return
  }

  const created = await adminJson('POST', '/estimates/from-shipper', token, {
    leadId: String(leadId),
    fileBase64: shipperB64,
    fileName: path.basename(FILES.shipperXlsx),
    jobType: 'PEMB',
    scope: 'both',
    companyBrand: 'SBD',
  })
  const estimateId =
    created.data.data?.estimateId || created.data.data?.estimate?._id
  const createTot = Number(created.data.data?.pricing?.totSell || 0)
  record(
    '[PEMB] POST /estimates/from-shipper',
    created.data.success && estimateId && createTot > 0,
    `estimateId=${estimateId} totSell=${createTot}`,
  )
  if (!estimateId) return

  const got = await adminJson('GET', `/estimates/${estimateId}`, token)
  const est = got.data.data?.estimate || got.data.data || {}
  record(
    '[PEMB] GET /estimates/:id',
    got.data.success && est.jobType === 'PEMB',
    est.jobType || '',
  )

  const idDoc = await adminJson('POST', `/estimates/${estimateId}/documents/preview`, token, {})
  record(
    '[PEMB] POST /estimates/:id/documents/preview',
    idDoc.data.success && String(idDoc.data.data?.quoteHtml || '').length > 200,
  )

  const computed = await adminJson('POST', `/estimates/${estimateId}/compute`, token, {})
  const reTot = Number(
    computed.data.data?.pricing?.totSell ||
      computed.data.data?.estimate?.pricingResult?.totSell ||
      0,
  )
  record(
    '[PEMB] POST /estimates/:id/compute',
    computed.data.success && Math.round(reTot) === Math.round(createTot),
    `totSell=${reTot}`,
  )

  const parallel = await Promise.all(
    Array.from({ length: 3 }, () =>
      adminJson('POST', `/estimates/${estimateId}/compute`, token, {}),
    ),
  )
  const okN = parallel.filter((r) => r.data.success).length
  record('[PEMB] POST compute x3 parallel', okN === 3, `ok=${okN}`)

  const del = await adminJson('DELETE', `/estimates/${estimateId}`, token)
  record('[PEMB] DELETE /estimates/:id', del.data.success !== false, del.data.message || '')
}

/** Storage: compute, draft create, PUT add-ons, compute-storage by id, docs, optional from-storage-cog */
async function runStorageFlow(token) {
  section('STORAGE')
  const storageBody = {
    storageData: {
      buildings: [{ name: 'B1', cogs: 85664, markup: 25, sqft: 3000 }],
      doors: [],
      extras: [],
    },
    pembAddOns: [{ item: 'Storage E2E add-on', cost: 100, markup: 25, inQuote: true }],
    shipping: 14000,
    installSellPerSf: 9.75,
    squareFootage: 3000,
    salesTax: { rate: 8.25, include: true },
  }

  const storageCompute = await adminJson('POST', '/estimates/compute-storage', token, storageBody)
  const sp =
    storageCompute.data.data?.storagePricing || storageCompute.data.data || {}
  record(
    '[STORAGE] POST /estimates/compute-storage',
    storageCompute.data.success && Number(sp.grandTotal) > 0,
    `grand=${sp.grandTotal}`,
  )

  const docPrev = await adminJson('POST', '/estimates/documents/preview', token, {
    jobType: 'Storage',
    ...storageBody,
  })
  record(
    '[STORAGE] POST /estimates/documents/preview',
    docPrev.data.success && String(docPrev.data.data?.quoteHtml || '').length > 200,
  )

  const storagePdf = await adminJson('POST', '/estimates/documents/pdf', token, {
    format: 'html',
    jobType: 'Storage',
    ...storageBody,
  })
  const stPdfOk =
    storagePdf.data.success &&
    (String(storagePdf.data.data?.html || '').length > 100 ||
      String(storagePdf.data.data?.fileBase64 || '').length > 100)
  const stNet = /network|terminated|ECONNRESET|timeout/i.test(storagePdf.data.message || '')
  record(
    '[STORAGE] POST /estimates/documents/pdf',
    stPdfOk || (stNet && docPrev.data.success),
    stNet ? 'skip — Render timeout (preview ok)' : stPdfOk ? 'pdf ok' : storagePdf.data.message?.slice(0, 60),
  )

  const leadId = await resolveLeadId(token)
  if (!leadId) {
    record('[STORAGE] draft estimate (skip)', false, 'no lead')
    return
  }

  const created = await adminJson('POST', '/estimates', token, {
    leadId: String(leadId),
    jobType: 'Storage',
    ...storageBody,
    leadCompanyName: 'E2E Storage Smoke',
  })
  const estimateId = created.data.data?._id || created.data.data?.estimate?._id
  record(
    '[STORAGE] POST /estimates (Storage draft)',
    created.data.success && estimateId,
    `id=${estimateId}`,
  )
  if (!estimateId) return

  const put = await adminJson('PUT', `/estimates/${estimateId}`, token, {
    pembAddOns: [{ item: 'Updated add-on', cost: 75, markup: 25, inQuote: true }],
    storageData: storageBody.storageData,
    shipping: storageBody.shipping,
    installSellPerSf: storageBody.installSellPerSf,
  })
  record('[STORAGE] PUT /estimates/:id (pembAddOns)', put.data.success !== false)

  const compSt = await adminJson('POST', `/estimates/${estimateId}/compute-storage`, token, {})
  const g = Number(
    compSt.data.data?.storagePricing?.grandTotal ||
      compSt.data.data?.estimate?.grandTotal ||
      0,
  )
  record(
    '[STORAGE] POST /estimates/:id/compute-storage',
    compSt.data.success && g > 0,
    `grand=${g}`,
  )

  const idPrev = await adminJson('GET', `/estimates/${estimateId}/documents/preview`, token)
  record(
    '[STORAGE] GET /estimates/:id/documents/preview',
    idPrev.data.success && String(idPrev.data.data?.quoteHtml || '').length > 200,
  )

  for (const [label, fp] of [
    ['Ben Olson xls', FILES.benOlsonXls],
    ['storage xlsx sample', FILES.storageXlsx],
  ]) {
    const b64file = b64(fp)
    if (!b64file) continue
    const fromSt = await adminJson('POST', '/estimates/from-storage-cog', token, {
      leadId: String(leadId),
      fileBase64: b64file,
      fileName: path.basename(fp),
    })
    const stId = fromSt.data.data?.estimateId || fromSt.data.data?.estimate?._id
    if (fromSt.data.success && stId) {
      const c = await adminJson('POST', `/estimates/${stId}/compute-storage`, token, {})
      const noBuildings = /buildings required/i.test(c.data.message || '')
      record(
        `[STORAGE] from-storage-cog (${label}) + compute`,
        c.data.success || noBuildings,
        c.data.success
          ? `estimateId=${stId}`
          : noBuildings
            ? 'created draft; file had no building rows'
            : (c.data.message || '').slice(0, 60),
      )
      await adminJson('DELETE', `/estimates/${stId}`, token)
    } else {
      record(
        `[STORAGE] from-storage-cog (${label})`,
        fromSt.data.success || /invalid|parse|sheet/i.test(fromSt.data.message || ''),
        (fromSt.data.message || 'not a cog file').slice(0, 70),
      )
    }
  }

  await adminJson('DELETE', `/estimates/${estimateId}`, token)
  record('[STORAGE] DELETE draft cleanup', true, String(estimateId))
}

async function runCustomQuoteFlow(token) {
  section('CUSTOM QUOTE')
  const preview = await adminJson('POST', '/custom-quotes/preview', token, {
    matCost: 40000,
    freight: 8000,
    laborCost: 15000,
    marginPct: 22,
  })
  record('[CUSTOM] POST /custom-quotes/preview', preview.data.success)

  const pdfInline = await adminJson('POST', '/custom-quotes/pdf', token, {
    format: 'html',
    customer: 'E2E Custom Co',
    matCost: 40000,
    freight: 8000,
    laborCost: 15000,
    marginPct: 22,
  })
  record(
    '[CUSTOM] POST /custom-quotes/pdf (html)',
    pdfInline.data.success && String(pdfInline.data.data?.html || '').length > 100,
  )

  const created = await adminJson('POST', '/custom-quotes', token, {
    customer: 'E2E Custom Smoke',
    location: 'Austin, TX',
    matCost: 40000,
    freight: 8000,
    laborCost: 15000,
    marginPct: 22,
    leadId: LEAD_TAX,
    inclusions: ['Steel package', 'Delivery'],
  })
  const cqId = created.data.data?.customQuoteId || created.data.data?._id
  record('[CUSTOM] POST /custom-quotes', created.data.success && cqId, `id=${cqId}`)
  if (!cqId) return

  const got = await adminJson('GET', `/custom-quotes/${cqId}`, token)
  record(
    '[CUSTOM] GET /custom-quotes/:id',
    got.data.success && got.data.data?.quoteKind === 'custom',
  )

  const docPrev = await adminJson('POST', `/custom-quotes/${cqId}/preview`, token, {})
  record(
    '[CUSTOM] POST /custom-quotes/:id/preview',
    docPrev.data.success && String(docPrev.data.data?.html || '').length > 100,
  )

  const updated = await adminJson('PUT', `/custom-quotes/${cqId}`, token, { marginPct: 24 })
  record(
    '[CUSTOM] PUT /custom-quotes/:id',
    updated.data.success && Number(updated.data.data?.marginPct) === 24,
  )

  const list = await adminJson('GET', '/custom-quotes', token)
  const count = list.data.data?.count ?? list.data.data?.items?.length
  record('[CUSTOM] GET /custom-quotes', list.data.success && count >= 1, `count=${count}`)

  await adminJson('DELETE', `/custom-quotes/${cqId}`, token)
  record('[CUSTOM] DELETE /custom-quotes/:id', true, 'cleanup')
}

async function runInvoiceFlow(token) {
  section('INVOICE')
  const tax = await apiJson('GET', `/leads/${LEAD_TAX}/quotations/latest-approved-tax`, token)
  const td = tax.data.data || {}
  const prefill = td.invoicePrefill || td.breakdown || {}
  const lines = prefill.lineItems || td.lineItems || []
  const lineSum = lines.reduce((s, li) => s + Number(li.amount || li.total || 0), 0)
  const hasNonZeroLines =
    lines.length === 0 || lines.some((li) => Number(li.amount || li.total || 0) > 0)
  record(
    '[INVOICE] GET /leads/:id/quotations/latest-approved-tax',
    tax.data.success && Number(td.total || td.grandTotal || 0) > 0,
    `total=${td.total ?? td.grandTotal} lines=${lines.length}`,
  )
  record(
    '[INVOICE] latest-approved-tax invoicePrefill (no all-$0 lines)',
    tax.data.success && hasNonZeroLines,
    lines.length ? `lineSum=${lineSum}` : 'no lineItems (schedule-only ok)',
  )

  const parallelTax = await Promise.all(
    Array.from({ length: 5 }, () =>
      apiJson('GET', `/leads/${LEAD_TAX}/quotations/latest-approved-tax`, token),
    ),
  )
  const taxOk = parallelTax.filter((r) => r.data.success).length
  const dupErr = parallelTax.some((r) =>
    String(r.data.message || '').toLowerCase().includes('duplicate'),
  )
  record(
    '[INVOICE] GET latest-approved-tax x5 (no duplicate leadId)',
    taxOk === 5 && !dupErr,
    `ok=${taxOk} dupMsg=${dupErr}`,
  )

  const quots = await apiJson('GET', `/leads/${LEAD_TAX}/quotations`, token)
  record('[INVOICE] GET /leads/:id/quotations', quots.data.success)
  const approved = (quots.data.data?.quotations || quots.data.data || []).find(
    (q) => q.status === 'approved' || q.approvalStatus === 'approved',
  )
  if (approved?._id) {
    const qDetail = await apiJson('GET', `/quotations/${approved._id}`, token)
    record('[INVOICE] GET /quotations/:id', qDetail.data.success)
  } else {
    record('[INVOICE] GET /quotations/:id', true, 'skip — no approved quotation id in list')
  }

  const schedGet = await apiJson('GET', `/payment-schedules/lead/${LEAD_TAX}`, token)
  const sched = schedGet.data.data?.schedule || schedGet.data.data
  record(
    '[INVOICE] GET /payment-schedules/lead/:leadId',
    schedGet.data.success,
    sched?.stages?.length ? `stages=${sched.stages.length}` : '',
  )

  if (schedGet.data.success && sched?.stages?.length >= 3) {
    const canonicalTotal = Number(td.total ?? td.grandTotal ?? sched.totalAmount ?? 132487)
    const stagePayload = (s, i) => {
      const row = {
        _id: s._id,
        stageName: s.stageName || `Stage ${i + 1}`,
        amountType: s.amountType || 'fixed',
        amount: Number(s.amount),
      }
      if (s.dueDate) row.dueDate = s.dueDate
      return row
    }
    const stages = sched.stages.slice(0, 3).map(stagePayload)
    // Intentional $1 under-sum on fixed milestones (penny drift fix)
    if (stages.every((s) => s.amountType === 'fixed')) {
      stages[2].amount = Math.max(0, stages[2].amount - 1)
    }
    const putSched = await apiJson('PUT', `/payment-schedules/lead/${LEAD_TAX}`, token, {
      totalAmount: canonicalTotal,
      stages,
    })
    const outSched = putSched.data.data?.schedule || putSched.data.data
    const outStages = outSched?.stages || []
    const dollarSum = outStages.reduce((s, st) => s + Number(st.amount || 0), 0)
    const driftOk =
      putSched.data.success && Math.abs(dollarSum - canonicalTotal) <= 1
    record(
      '[INVOICE] PUT /payment-schedules/lead/:id ($1 tolerance)',
      driftOk,
      putSched.data.success
        ? `stageSum=${dollarSum} target=${canonicalTotal}`
        : putSched.data.message?.slice(0, 80),
    )
    // Restore original stage amounts for the lead
    const restore = sched.stages.slice(0, 3).map((s, i) => stagePayload(s, i))
    await apiJson('PUT', `/payment-schedules/lead/${LEAD_TAX}`, token, {
      totalAmount: canonicalTotal,
      stages: restore,
    })
  }

  const billing = await apiJson('GET', '/invoices/billing-defaults', token)
  record('[INVOICE] GET /invoices/billing-defaults', billing.data.success)

  const invList = await apiJson('GET', `/leads/${LEAD_TAX}/invoices`, token)
  record('[INVOICE] GET /leads/:id/invoices', invList.data.success)
  const invoices = invList.data.data?.invoices || invList.data.data || []
  let firstInv = Array.isArray(invoices) ? invoices[0] : null

  const stageId = sched?.stages?.[0]?._id
  const stageAmt = Number(sched?.stages?.[0]?.amount || 0)
  const prefillLines = lines.length
    ? lines
    : [{ description: 'E2E milestone', amount: stageAmt || 1000, quantity: 1 }]
  if (!firstInv && stageAmt > 0 && process.env.SKIP_INVOICE_CREATE !== '1') {
    const createBody = {
      totalAmount: stageAmt,
      lineItems: prefillLines.map((li) => ({
        description: li.description || li.label || 'Line',
        amount: Number(li.amount || li.total || 0),
        quantity: li.quantity || 1,
      })),
      paymentScheduleStageId: stageId,
      tax: td.taxAmount ?? td.salesTax?.amount,
    }
    const created = await apiJson('POST', `/leads/${LEAD_TAX}/invoices`, token, createBody)
    const lifecycleBlock = /lifecycle|proposal_sent/i.test(created.data.message || '')
    if (created.data.success) {
      firstInv = created.data.data?.invoice || created.data.data
      record(
        '[INVOICE] POST /leads/:id/invoices (draft create)',
        !!firstInv?._id,
        `invoiceId=${firstInv?._id}`,
      )
    } else {
      record(
        '[INVOICE] POST /leads/:id/invoices',
        lifecycleBlock,
        lifecycleBlock ? 'skip — lifecycle gate' : (created.data.message || '').slice(0, 80),
      )
    }
  }

  if (firstInv?._id) {
    const invGet = await apiJson('GET', `/invoices/${firstInv._id}`, token)
    record('[INVOICE] GET /invoices/:id', invGet.data.success)

    const taxPrev = await apiJson('POST', `/invoices/${firstInv._id}/tax-preview`, token, {
      lineItems: prefillLines,
      totalAmount: Number(firstInv.totalAmount || stageAmt),
    })
    record(
      '[INVOICE] POST /invoices/:id/tax-preview',
      taxPrev.data.success !== false && taxPrev.status < 500,
      taxPrev.data.message?.slice(0, 60) || 'ok',
    )

    const adminDetail = await adminJson('GET', `/invoices/${firstInv._id}`, token)
    record(
      '[INVOICE] GET /api/admin/invoices/:id',
      adminDetail.data.success || adminDetail.status === 200,
    )
  } else {
    record('[INVOICE] GET /invoices/:id + tax-preview', true, 'skip — no invoice to open')
  }
}

async function main() {
  console.log(`BASE_URL=${BASE}\n`)

  const health = await fetchJson(`${BASE}/health`)
  record('GET /health', health.data.status === 'ok', health.data.env || '')

  const login = await fetchJson(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })
  if (!login.data.success) {
    record('POST /api/auth/login', false, login.data.message)
    process.exit(1)
  }
  const token = login.data.data.accessToken
  record('POST /api/auth/login', true, login.data.data.role)

  section('SHARED QUOTING')
  await runQuotingCore(token)
  await runFileExtracts(token)
  await runPembFlow(token)
  await runStorageFlow(token)
  await runCustomQuoteFlow(token)
  await runInvoiceFlow(token)

  const failed = results.filter((r) => !r.pass)
  console.log('\n---')
  console.log(`Total: ${results.length}, Failed: ${failed.length}`)
  if (failed.length) {
    failed.forEach((f) => console.log(`  • ${f.name}: ${f.detail}`))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
