const CustomQuote = require('../../models/CustomQuote')
const Quotation = require('../../models/Quotation')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { computeCustomQuote } = require('../../services/quoting/customQuoteEngine')
const { generateCustomQuoteHtml } = require('../../services/quoting/customQuoteDocument')
const { renderHtmlToPdf } = require('../../services/quoting/htmlPdf')
const {
  buildEstimateConversionMeta,
  QUOTATION_LINK_SELECT,
} = require('../../utils/quotationConversionMeta')

const normalizeLines = (v) =>
  Array.isArray(v)
    ? v.filter((l) => String(l).trim())
    : String(v || '')
        .split('\n')
        .filter((l) => l.trim())

const buildDoc = (body, user) => {
  const c = computeCustomQuote(body)
  return {
    createdBy: user._id,
    leadId: body.leadId || null,
    customer: body.customer || '',
    location: body.location || '',
    size: body.size || '',
    scope: body.scope || 'both',
    expDays: Number(body.expDays) || 15,
    matCost: c.matCost,
    freight: c.freight,
    laborCost: c.laborCost,
    marginPct: c.marginPct,
    sellOverride: c.sellOverride,
    totalCost: c.totalCost,
    sell: c.sell,
    profit: c.profit,
    profPct: c.profPct,
    inclusions: normalizeLines(body.inclusions),
    exclusions: normalizeLines(body.exclusions),
    sow: {
      overview: body.sow?.overview || body.sow_overview || '',
      delivery: body.sow?.delivery || body.sow_delivery || '',
      terms: body.sow?.terms || body.sow_terms || '',
    },
    additional: body.additional || '',
    company: body.company || 'SM',
    status: body.status || 'Draft',
    employeeName: user.name || '',
    employeeRole: user.role || '',
  }
}

const findLinkedQuotation = async (customQuoteId) =>
  Quotation.findOne({ sourceCustomQuoteId: customQuoteId })
    .select(QUOTATION_LINK_SELECT)
    .sort({ createdAt: -1 })
    .lean()

const attachConversionByCustomQuoteId = async (docs) => {
  const rows = Array.isArray(docs) ? docs : [docs]
  const ids = rows.map((d) => d._id).filter(Boolean)
  if (!ids.length) return rows.map((d) => ({ ...d, conversion: buildEstimateConversionMeta(null) }))

  const quotations = await Quotation.find({ sourceCustomQuoteId: { $in: ids } })
    .select(QUOTATION_LINK_SELECT)
    .sort({ createdAt: -1 })
    .lean()
  const byCustomId = new Map()
  for (const q of quotations) {
    const key = String(q.sourceCustomQuoteId || '')
    if (!key || byCustomId.has(key)) continue
    byCustomId.set(key, q)
  }

  return rows.map((d) => {
    const conversion = buildEstimateConversionMeta(byCustomId.get(String(d._id)))
    return { ...d, conversion }
  })
}

/** PEMB-aligned GET payload for custom quote detail + approval UI */
const formatCustomQuoteResponse = (doc, conversion) => ({
  quoteKind: 'custom',
  customQuoteId: doc._id,
  ...doc,
  conversion,
  previewApi: `/api/sales/custom-quotes/${doc._id}/preview`,
  editApi: `/api/sales/custom-quotes/${doc._id}`,
  convertApi: `/api/quotations/from-custom-quote/${doc._id}`,
})

// POST /custom-quotes/preview — stateless math
exports.previewCustomQuote = asyncHandler(async (req, res) => {
  return success(res, computeCustomQuote(req.body), 'Custom quote preview')
})

// GET /custom-quotes
exports.listCustomQuotes = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.user.role === 'sales') filter.createdBy = req.user._id
  const items = await CustomQuote.find(filter).sort({ updatedAt: -1 }).lean()
  const enriched = await attachConversionByCustomQuoteId(items)
  return success(res, { items: enriched, count: enriched.length }, 'Custom quotes')
})

// POST /custom-quotes
exports.createCustomQuote = asyncHandler(async (req, res) => {
  const doc = await CustomQuote.create(buildDoc(req.body, req.user))
  const plain = doc.toObject()
  const conversion = buildEstimateConversionMeta(null)
  return created(res, formatCustomQuoteResponse(plain, conversion), 'Custom quote created')
})

const customQuoteAccessFilter = (user, id) => {
  const filter = { _id: id }
  if (user.role === 'sales') filter.createdBy = user._id
  return filter
}

// GET /custom-quotes/:id
exports.getCustomQuote = asyncHandler(async (req, res) => {
  const doc = await CustomQuote.findOne(customQuoteAccessFilter(req.user, req.params.id)).lean()
  if (!doc) return notFound(res, 'Custom quote not found')
  const quotation = await findLinkedQuotation(doc._id)
  const conversion = buildEstimateConversionMeta(quotation)
  return success(res, formatCustomQuoteResponse(doc, conversion), 'Custom quote')
})

// PUT /custom-quotes/:id
exports.updateCustomQuote = asyncHandler(async (req, res) => {
  const existing = await CustomQuote.findOne(customQuoteAccessFilter(req.user, req.params.id))
  if (!existing) return notFound(res, 'Custom quote not found')
  const merged = { ...existing.toObject(), ...req.body }
  const doc = buildDoc(merged, req.user)
  delete doc.createdBy
  Object.assign(existing, doc)
  await existing.save()
  const quotation = await findLinkedQuotation(existing._id)
  const conversion = buildEstimateConversionMeta(quotation)
  return success(res, formatCustomQuoteResponse(existing.toObject(), conversion), 'Custom quote updated')
})

// DELETE /custom-quotes/:id
exports.deleteCustomQuote = asyncHandler(async (req, res) => {
  const doc = await CustomQuote.findOneAndDelete(customQuoteAccessFilter(req.user, req.params.id))
  if (!doc) return notFound(res, 'Custom quote not found')
  return success(res, { deleted: true }, 'Custom quote deleted')
})

/** HTML preview — PEMB equivalent: GET /estimates/:id/documents/preview */
exports.previewCustomQuoteDocument = asyncHandler(async (req, res) => {
  let cq
  if (req.params.id) {
    cq = await CustomQuote.findOne(customQuoteAccessFilter(req.user, req.params.id)).lean()
    if (!cq) return notFound(res, 'Custom quote not found')
  } else {
    cq = req.body
  }
  const html = generateCustomQuoteHtml(cq, { company: req.body?.company || cq.company || 'SM' })
  return success(res, { html, quoteKind: 'custom', customQuoteId: cq._id || null }, 'Custom quote preview')
})

// POST /custom-quotes/:id/pdf  (or POST /custom-quotes/pdf with inline body)
exports.generateCustomQuotePdf = asyncHandler(async (req, res) => {
  let cq
  if (req.params.id) {
    cq = await CustomQuote.findOne(customQuoteAccessFilter(req.user, req.params.id)).lean()
    if (!cq) return notFound(res, 'Custom quote not found')
  } else {
    cq = req.body
  }
  const html = generateCustomQuoteHtml(cq, { company: req.body.company || cq.company || 'SM' })
  if (req.body.format === 'html') return success(res, { html }, 'Custom quote HTML')
  try {
    const pdf = await renderHtmlToPdf(html)
    return success(res, {
      fileName: `estimate-${(cq.customer || 'custom').replace(/[^\w.-]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      fileBase64: pdf.toString('base64'),
      sizeBytes: pdf.length,
    })
  } catch (err) {
    return badRequest(res, `PDF generation failed: ${err.message}`)
  }
})
