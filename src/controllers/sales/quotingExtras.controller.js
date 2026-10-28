const EstimateQuote = require('../../models/EstimateQuote')
const User = require('../../models/User')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { computeDeposit, computeMilestones } = require('../../services/quoting/depositMilestoneEngine')
const { computeStaircase } = require('../../services/quoting/staircase')
const {
  generateDepositReceiptHtml,
  generateMilestoneScheduleHtml,
} = require('../../services/quoting/depositMilestoneDocument')
const { renderHtmlToPdf } = require('../../services/quoting/htmlPdf')

const grandOf = (est = {}) =>
  est.fullQuoteResult?.grandTotal ??
  est.totalSell ??
  est.pricingResult?.totSell ??
  0

const quoteInfoOf = (est = {}) => ({
  id: est._id,
  customer: est.leadCompanyName || '',
  location: est.cityStateZip || est.streetAddress || '',
  buildingSize: est.buildingSize || '',
  jobNumber: est.jobNumber || '',
})

const loadOwnedEstimate = async (req) => {
  const est = await EstimateQuote.findById(req.params.estimateId)
  if (!est) return { error: 'Estimate not found', code: 404 }
  const isOwner = String(est.createdBy) === String(req.user._id)
  const isAdmin = req.user.role === 'admin'
  if (!isOwner && !isAdmin) return { error: 'Forbidden', code: 403 }
  return { est }
}

// ── Stateless previews ───────────────────────────────────────────────
exports.previewDeposit = asyncHandler(async (req, res) =>
  success(res, computeDeposit(req.body), 'Deposit preview'),
)
exports.previewMilestones = asyncHandler(async (req, res) =>
  success(res, computeMilestones(req.body), 'Milestone preview'),
)
exports.previewStaircase = asyncHandler(async (req, res) =>
  success(res, computeStaircase(req.body), 'Staircase preview'),
)

// ── Persistence on an estimate ───────────────────────────────────────
exports.updateEstimateDeposit = asyncHandler(async (req, res) => {
  const { est, error, code } = await loadOwnedEstimate(req)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)
  const grand = req.body.grand != null ? Number(req.body.grand) : grandOf(est)
  const d = computeDeposit({ grand, pct: req.body.pct, flat: req.body.flat })
  est.depositTerms = { ...d, note: req.body.note || '' }
  await est.save()
  return success(res, est.depositTerms, 'Deposit terms saved')
})

exports.updateEstimateMilestones = asyncHandler(async (req, res) => {
  const { est, error, code } = await loadOwnedEstimate(req)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)
  const grand = req.body.grand != null ? Number(req.body.grand) : grandOf(est)
  const m = computeMilestones({ grand, rows: req.body.rows || req.body.milestones || [] })
  est.milestoneSchedule = m.rows
  est.milestoneNote = req.body.note || ''
  await est.save()
  return success(res, m, 'Milestone schedule saved')
})

exports.updateEstimateMultiStory = asyncHandler(async (req, res) => {
  const { est, error, code } = await loadOwnedEstimate(req)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)
  const s = computeStaircase(req.body)
  est.multiStory = {
    stories: s.stories,
    staircaseCount: s.count,
    staircaseUnitCost: s.unitCost,
    staircaseSell: s.staircaseSell,
  }
  await est.save()
  return success(res, est.multiStory, 'Multi-story settings saved')
})

// ── Document PDFs ────────────────────────────────────────────────────
const resolveDocQuote = async (req) => {
  if (req.body.estimateId) {
    const est = await EstimateQuote.findById(req.body.estimateId).lean()
    if (!est) return { error: 'Estimate not found' }
    return {
      quote: quoteInfoOf(est),
      grand: req.body.grand != null ? Number(req.body.grand) : grandOf(est),
      company: est.companyBrand,
      milestoneSchedule: est.milestoneSchedule || [],
      milestoneNote: est.milestoneNote || '',
      depositTerms: est.depositTerms || null,
    }
  }
  return { quote: req.body.quote || {}, grand: Number(req.body.grand) || 0, company: req.body.company }
}

exports.depositReceiptPdf = asyncHandler(async (req, res) => {
  const resolved = await resolveDocQuote(req)
  if (resolved.error) return notFound(res, resolved.error)
  const html = generateDepositReceiptHtml({
    quote: resolved.quote,
    grand: resolved.grand,
    pct: req.body.pct,
    flat: req.body.flat,
    note: req.body.note || '',
    company: req.body.company || resolved.company || 'SM',
  })
  if (req.body.format === 'html') return success(res, { html }, 'Deposit receipt HTML')
  try {
    const pdf = await renderHtmlToPdf(html)
    return success(res, {
      fileName: `deposit-${(resolved.quote.customer || 'invoice').replace(/[^\w.-]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      fileBase64: pdf.toString('base64'),
      sizeBytes: pdf.length,
    })
  } catch (err) {
    return badRequest(res, `PDF generation failed: ${err.message}`)
  }
})

exports.milestonesPdf = asyncHandler(async (req, res) => {
  const resolved = await resolveDocQuote(req)
  if (resolved.error) return notFound(res, resolved.error)
  const rows =
    req.body.rows ||
    req.body.milestones ||
    resolved.milestoneSchedule ||
    []
  const html = generateMilestoneScheduleHtml({
    quote: resolved.quote,
    grand: resolved.grand,
    rows,
    note: req.body.note || req.body.milestoneNote || resolved.milestoneNote || '',
    company: req.body.company || resolved.company || 'SM',
  })
  if (req.body.format === 'html') return success(res, { html }, 'Milestone schedule HTML')
  try {
    const pdf = await renderHtmlToPdf(html)
    return success(res, {
      fileName: `milestones-${(resolved.quote.customer || 'schedule').replace(/[^\w.-]+/g, '_')}.pdf`,
      mimeType: 'application/pdf',
      fileBase64: pdf.toString('base64'),
      sizeBytes: pdf.length,
    })
  } catch (err) {
    return badRequest(res, `PDF generation failed: ${err.message}`)
  }
})

// ── Users roster (for the MVP user-select / PIN screen) ───────────────
exports.listQuotingUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true })
    .select('_id name role email')
    .sort({ name: 1 })
    .lean()
  const roleLabel = (r) =>
    r === 'admin' ? 'Owner' : r === 'sales' ? 'Estimator' : r ? r[0].toUpperCase() + r.slice(1) : 'Estimator'
  const items = users.map((u) => ({
    id: u._id,
    name: u.name,
    email: u.email,
    role: u.role,
    displayRole: roleLabel(u.role),
    isManager: u.role === 'admin',
  }))
  return success(res, { items, count: items.length }, 'Quoting users')
})
