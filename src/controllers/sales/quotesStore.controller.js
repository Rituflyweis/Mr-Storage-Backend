const SavedQuote = require('../../models/SavedQuote')
const { success, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

/**
 * Server-side mirror of the SM-QuotingTool v7 Firebase quote cache.
 * The quote library is a shared workspace (as it was in Firebase), so every
 * authenticated sales/admin user reads the same set.
 */

const toKeyed = (docs) => {
  const out = {}
  docs.forEach((d) => {
    out[d.recordId] = d.data || {}
  })
  return out
}

const denorm = (kind, record) => {
  if (kind === 'quote') {
    const sd = record.state_data || record
    return {
      employeeName: record.employee_name || sd.employee_name || '',
      customer: record.customer || sd.customer || '',
      grandTotal: record.grand_total || sd.grandTotal || sd.sell || 0,
      status: record.status || sd.status || 'Draft',
    }
  }
  return {
    customer: record.customer || '',
    grandTotal: record.new_total || record.newTotal || 0,
    status: 'CO',
  }
}

// GET /quotes-store/quotes  → keyed object { id: record }
exports.getQuotes = asyncHandler(async (req, res) => {
  const docs = await SavedQuote.find({ kind: 'quote' }).sort({ updatedAt: -1 }).lean()
  return res.json(toKeyed(docs))
})

// GET /quotes-store/change-orders → keyed object { id: record }
exports.getChangeOrders = asyncHandler(async (req, res) => {
  const docs = await SavedQuote.find({ kind: 'co' }).sort({ updatedAt: -1 }).lean()
  return res.json(toKeyed(docs))
})

// PUT /quotes-store/quotes/:id  (body = full record)
exports.putQuote = asyncHandler(async (req, res) => {
  const record = req.body || {}
  await SavedQuote.findOneAndUpdate(
    { kind: 'quote', recordId: req.params.id },
    { kind: 'quote', recordId: req.params.id, data: record, ownerId: req.user._id, ...denorm('quote', record) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return success(res, { ok: true, id: req.params.id }, 'Quote saved')
})

// DELETE /quotes-store/quotes/:id
exports.deleteQuote = asyncHandler(async (req, res) => {
  await SavedQuote.deleteOne({ kind: 'quote', recordId: req.params.id })
  return success(res, { ok: true, id: req.params.id }, 'Quote deleted')
})

// PUT /quotes-store/change-orders/:id
exports.putChangeOrder = asyncHandler(async (req, res) => {
  const record = req.body || {}
  await SavedQuote.findOneAndUpdate(
    { kind: 'co', recordId: req.params.id },
    { kind: 'co', recordId: req.params.id, data: record, ownerId: req.user._id, ...denorm('co', record) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return success(res, { ok: true, id: req.params.id }, 'Change order saved')
})

// DELETE /quotes-store/change-orders/:id
exports.deleteChangeOrder = asyncHandler(async (req, res) => {
  await SavedQuote.deleteOne({ kind: 'co', recordId: req.params.id })
  return success(res, { ok: true, id: req.params.id }, 'Change order deleted')
})
