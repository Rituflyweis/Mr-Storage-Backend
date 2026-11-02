const ChangeOrder = require('../../models/ChangeOrder')
const EstimateQuote = require('../../models/EstimateQuote')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { computeChangeOrder, nextChangeOrderContext } = require('../../services/quoting/changeOrderEngine')
const { generateChangeOrderHtml } = require('../../services/quoting/changeOrderDocument')
const { renderHtmlToPdf } = require('../../services/quoting/htmlPdf')
const {
  syncEstimateFromChangeOrders,
  estimateRevisionSummary,
} = require('../../services/quoting/changeOrderApply')

const parentFilter = (req) => {
  const { estimateId, parentQuoteRef } = { ...req.query, ...req.body, ...req.params }
  const filter = { createdBy: req.user._id }
  if (estimateId) filter.estimateQuoteId = estimateId
  else if (parentQuoteRef) filter.parentQuoteRef = String(parentQuoteRef)
  return filter
}

const baseQuoteTotal = async (estimateId) => {
  if (!estimateId) return 0
  const est = await EstimateQuote.findById(estimateId).lean()
  if (!est) return 0
  if (est.revisedContractTotal != null) return Math.round(Number(est.revisedContractTotal) || 0)
  if (est.originalContractValue != null) return Math.round(Number(est.originalContractValue) || 0)
  return (
    est.fullQuoteResult?.grandTotal ??
    est.totalSell ??
    est.pricingResult?.totSell ??
    est.storagePricingResult?.grandTotal ??
    0
  )
}

/** Change orders attach to a finalized contract — draft quotes should be edited instead. */
const loadEstimateForChangeOrder = async (estimateId) => {
  if (!estimateId) return { est: null }
  const est = await EstimateQuote.findById(estimateId)
  if (!est) return { error: 'Estimate not found', code: 404 }
  if (est.status !== 'final') {
    return {
      error:
        'Change orders are only allowed after the estimate is final (client contract issued). Edit the draft quote to change price instead.',
      code: 400,
      estimateStatus: est.status,
      estimateId: String(est._id),
    }
  }
  return { est }
}

const loadChangeOrderForDocument = async (coId, userId) => {
  const co = await ChangeOrder.findOne({ _id: coId, createdBy: userId }).lean()
  if (!co) return { error: 'Change order not found', code: 404 }
  const filter = { createdBy: userId, coNum: { $lte: co.coNum } }
  if (co.estimateQuoteId) filter.estimateQuoteId = co.estimateQuoteId
  else filter.parentQuoteRef = co.parentQuoteRef
  const priorCOs = await ChangeOrder.find(filter).sort({ coNum: 1 }).lean()
  const baseOrigVal =
    priorCOs.length && priorCOs[0].origVal != null
      ? Math.round(Number(priorCOs[0].origVal))
      : Math.round(Number(co.origVal) || 0)
  return { co, priorCOs, baseOrigVal }
}

const renderChangeOrderDocument = (co, { priorCOs, baseOrigVal, company }) =>
  generateChangeOrderHtml(co, {
    company: company || co.company || 'SM',
    priorCOs,
    baseOrigVal,
  })

// POST /change-orders/preview  — stateless math (no save)
exports.previewChangeOrder = asyncHandler(async (req, res) => {
  const result = computeChangeOrder(req.body)
  return success(res, result, 'Change order preview')
})

// GET /change-orders?estimateId=…  |  ?parentQuoteRef=…
exports.listChangeOrders = asyncHandler(async (req, res) => {
  const filter = parentFilter(req)
  const items = await ChangeOrder.find(filter).sort({ coNum: 1 }).lean()
  return success(res, { items, count: items.length }, 'Change orders')
})

// POST /change-orders
exports.createChangeOrder = asyncHandler(async (req, res) => {
  const { estimateId, parentQuoteRef } = req.body
  if (!estimateId && !parentQuoteRef) {
    return badRequest(res, 'estimateId or parentQuoteRef is required')
  }

  let linkedEstimate = null
  if (estimateId) {
    const loaded = await loadEstimateForChangeOrder(estimateId)
    if (loaded.error) {
      if (loaded.code === 404) return notFound(res, loaded.error)
      return badRequest(res, loaded.error, {
        estimateStatus: loaded.estimateStatus || 'draft',
        estimateId: loaded.estimateId || estimateId,
        finalize: {
          method: 'PUT',
          path: `/api/sales/estimates/${loaded.estimateId || estimateId}`,
          body: { status: 'final' },
          or: `POST /api/sales/estimates/${loaded.estimateId || estimateId}/finalize`,
        },
      })
    }
    linkedEstimate = loaded.est
  }

  const existing = await ChangeOrder.find(parentFilter(req)).sort({ coNum: 1 }).lean()
  const base = estimateId ? await baseQuoteTotal(estimateId) : Number(req.body.baseQuoteTotal) || 0
  const { coNum, origVal } = nextChangeOrderContext(existing, base)

  const math = computeChangeOrder({
    origVal: req.body.origVal != null ? req.body.origVal : origVal,
    amount: req.body.amount,
    cost: req.body.cost,
    markup: req.body.markup,
  })

  if (!req.body.description) return badRequest(res, 'description is required')
  if (!math.amount) return badRequest(res, 'amount is required')

  const co = await ChangeOrder.create({
    createdBy: req.user._id,
    estimateQuoteId: estimateId || null,
    parentQuoteRef: parentQuoteRef ? String(parentQuoteRef) : '',
    coNum,
    customer: req.body.customer || '',
    coDate: req.body.coDate || req.body.date || '',
    origDate: req.body.origDate || '',
    origVal: math.origVal,
    amount: math.amount,
    cost: math.cost,
    profit: math.profit,
    margin: math.margin,
    newTotal: math.newTotal,
    description: req.body.description || '',
    company: req.body.company || 'SM',
    employeeName: req.user.name || '',
    employeeRole: req.user.role || '',
  })

  let estimateSummary = null
  if (linkedEstimate) {
    await syncEstimateFromChangeOrders(linkedEstimate)
    estimateSummary = estimateRevisionSummary(linkedEstimate)
  }

  return created(
    res,
    { ...(co.toObject ? co.toObject() : co), estimate: estimateSummary },
    'Change order created',
  )
})

// PUT /change-orders/:coId
exports.updateChangeOrder = asyncHandler(async (req, res) => {
  const co = await ChangeOrder.findOne({ _id: req.params.coId, createdBy: req.user._id })
  if (!co) return notFound(res, 'Change order not found')

  if (co.estimateQuoteId) {
    const loaded = await loadEstimateForChangeOrder(co.estimateQuoteId)
    if (loaded.error) {
      return loaded.code === 404 ? notFound(res, loaded.error) : badRequest(res, loaded.error)
    }
  }

  const math = computeChangeOrder({
    origVal: req.body.origVal != null ? req.body.origVal : co.origVal,
    amount: req.body.amount != null ? req.body.amount : co.amount,
    cost: req.body.cost != null ? req.body.cost : co.cost,
    markup: req.body.markup,
  })

  Object.assign(co, {
    customer: req.body.customer ?? co.customer,
    coDate: req.body.coDate ?? co.coDate,
    origDate: req.body.origDate ?? co.origDate,
    description: req.body.description ?? co.description,
    company: req.body.company ?? co.company,
    origVal: math.origVal,
    amount: math.amount,
    cost: math.cost,
    profit: math.profit,
    margin: math.margin,
    newTotal: math.newTotal,
  })
  await co.save()

  let estimateSummary = null
  if (co.estimateQuoteId) {
    const est = await EstimateQuote.findById(co.estimateQuoteId)
    if (est) {
      await syncEstimateFromChangeOrders(est)
      estimateSummary = estimateRevisionSummary(est)
    }
  }

  return success(
    res,
    { ...(co.toObject ? co.toObject() : co), estimate: estimateSummary },
    'Change order updated',
  )
})

// DELETE /change-orders/:coId
exports.deleteChangeOrder = asyncHandler(async (req, res) => {
  const co = await ChangeOrder.findOneAndDelete({ _id: req.params.coId, createdBy: req.user._id })
  if (!co) return notFound(res, 'Change order not found')

  let estimateSummary = null
  if (co.estimateQuoteId) {
    const est = await EstimateQuote.findById(co.estimateQuoteId)
    if (est) {
      await syncEstimateFromChangeOrders(est)
      estimateSummary = estimateRevisionSummary(est)
    }
  }

  return success(res, { deleted: true, estimate: estimateSummary }, 'Change order deleted')
})

// GET /change-orders/:coId/document?format=html|pdf — client-style CO (SM-QuotingTool printCO)
exports.getChangeOrderDocument = asyncHandler(async (req, res) => {
  const loaded = await loadChangeOrderForDocument(req.params.coId, req.user._id)
  if (loaded.error) {
    return loaded.code === 404 ? notFound(res, loaded.error) : badRequest(res, loaded.error)
  }
  const { co, priorCOs, baseOrigVal } = loaded
  const html = renderChangeOrderDocument(co, {
    priorCOs,
    baseOrigVal,
    company: req.query.company || co.company,
  })
  const fileName = `CO-${String(co.coNum).padStart(3, '0')}-${(co.customer || 'change-order').replace(/[^\w.-]+/g, '_')}.pdf`

  if (req.query.format === 'pdf') {
    try {
      const pdf = await renderHtmlToPdf(html)
      return success(res, {
        html,
        fileName,
        mimeType: 'application/pdf',
        fileBase64: pdf.toString('base64'),
        sizeBytes: pdf.length,
      })
    } catch (err) {
      return badRequest(res, `PDF generation failed: ${err.message}`)
    }
  }

  return success(res, { html, fileName }, 'Change order document')
})

// POST /change-orders/:coId/pdf  (or POST /change-orders/pdf with inline `co`)
exports.generateChangeOrderPdf = asyncHandler(async (req, res) => {
  let co
  let priorCOs = []
  let baseOrigVal
  if (req.params.coId) {
    const loaded = await loadChangeOrderForDocument(req.params.coId, req.user._id)
    if (loaded.error) {
      return loaded.code === 404 ? notFound(res, loaded.error) : badRequest(res, loaded.error)
    }
    co = loaded.co
    priorCOs = loaded.priorCOs
    baseOrigVal = loaded.baseOrigVal
  } else {
    co = req.body.co || req.body
    priorCOs = req.body.priorCOs || []
    baseOrigVal =
      req.body.baseOrigVal != null
        ? req.body.baseOrigVal
        : priorCOs.length
          ? priorCOs[0].origVal
          : co.origVal
  }

  const html = renderChangeOrderDocument(co, {
    priorCOs,
    baseOrigVal,
    company: req.body.company || co.company || 'SM',
  })

  if (req.body.format === 'html') {
    return success(res, { html }, 'Change order HTML')
  }

  try {
    const pdf = await renderHtmlToPdf(html)
    return success(res, {
      fileName: `CO-${String(co.coNum).padStart(3, '0')}-${(co.customer || 'change-order').replace(/[^\w.-]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      fileBase64: pdf.toString('base64'),
      sizeBytes: pdf.length,
      html,
    })
  } catch (err) {
    return badRequest(res, `PDF generation failed: ${err.message}`)
  }
})
