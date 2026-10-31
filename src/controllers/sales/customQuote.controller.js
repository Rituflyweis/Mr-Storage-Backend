const CustomQuote = require('../../models/CustomQuote')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { computeCustomQuote } = require('../../services/quoting/customQuoteEngine')
const { generateCustomQuoteHtml } = require('../../services/quoting/customQuoteDocument')
const { renderHtmlToPdf } = require('../../services/quoting/htmlPdf')

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

// POST /custom-quotes/preview — stateless math
exports.previewCustomQuote = asyncHandler(async (req, res) => {
  return success(res, computeCustomQuote(req.body), 'Custom quote preview')
})

// GET /custom-quotes
exports.listCustomQuotes = asyncHandler(async (req, res) => {
  const filter = {}
  if (req.user.role === 'sales') filter.createdBy = req.user._id
  const items = await CustomQuote.find(filter).sort({ updatedAt: -1 }).lean()
  return success(res, { items, count: items.length }, 'Custom quotes')
})

// POST /custom-quotes
exports.createCustomQuote = asyncHandler(async (req, res) => {
  const doc = await CustomQuote.create(buildDoc(req.body, req.user))
  return created(res, doc, 'Custom quote created')
})

// GET /custom-quotes/:id
exports.getCustomQuote = asyncHandler(async (req, res) => {
  const doc = await CustomQuote.findOne({ _id: req.params.id, createdBy: req.user._id }).lean()
  if (!doc) return notFound(res, 'Custom quote not found')
  return success(res, doc, 'Custom quote')
})

// PUT /custom-quotes/:id
exports.updateCustomQuote = asyncHandler(async (req, res) => {
  const existing = await CustomQuote.findOne({ _id: req.params.id, createdBy: req.user._id })
  if (!existing) return notFound(res, 'Custom quote not found')
  const merged = { ...existing.toObject(), ...req.body }
  const doc = buildDoc(merged, req.user)
  delete doc.createdBy
  Object.assign(existing, doc)
  await existing.save()
  return success(res, existing, 'Custom quote updated')
})

// DELETE /custom-quotes/:id
exports.deleteCustomQuote = asyncHandler(async (req, res) => {
  const doc = await CustomQuote.findOneAndDelete({ _id: req.params.id, createdBy: req.user._id })
  if (!doc) return notFound(res, 'Custom quote not found')
  return success(res, { deleted: true }, 'Custom quote deleted')
})

// POST /custom-quotes/:id/pdf  (or POST /custom-quotes/pdf with inline body)
exports.generateCustomQuotePdf = asyncHandler(async (req, res) => {
  let cq
  if (req.params.id) {
    cq = await CustomQuote.findOne({ _id: req.params.id, createdBy: req.user._id }).lean()
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
