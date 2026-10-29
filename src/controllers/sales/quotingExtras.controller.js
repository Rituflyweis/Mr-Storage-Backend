const EstimateQuote = require('../../models/EstimateQuote')
const User = require('../../models/User')
const { success, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const {
  computeDeposit,
  computeMilestones,
  syncDepositIntoMilestoneRows,
  depositTermsToMilestoneRows,
} = require('../../services/quoting/depositMilestoneEngine')
const { computeStaircase } = require('../../services/quoting/staircase')
const {
  generateDepositReceiptHtml,
  generateMilestoneScheduleHtml,
} = require('../../services/quoting/depositMilestoneDocument')
const { renderHtmlToPdf } = require('../../services/quoting/htmlPdf')

const grandOf = (est = {}) =>
  est.revisedContractTotal ??
  est.fullQuoteResult?.grandTotal ??
  est.totalSell ??
  est.pricingResult?.totSell ??
  est.storagePricingResult?.grandTotal ??
  0

const quoteInfoOf = (est = {}) => ({
  id: est._id,
  customer: est.leadCompanyName || '',
  location: est.cityStateZip || est.streetAddress || '',
  buildingSize: est.buildingSize || '',
  jobNumber: est.jobNumber || '',
})

const resolveEstimateId = (req = {}) =>
  req.body?.estimateId ||
  req.body?.id ||
  req.query?.estimateId ||
  req.query?.id ||
  req.params?.estimateId ||
  null

const assertEstimateReadable = (est, user) => {
  if (!est) return { error: 'Estimate not found', code: 404 }
  const isOwner = String(est.createdBy) === String(user._id)
  const isAdmin = user.role === 'admin'
  if (!isOwner && !isAdmin) return { error: 'Forbidden', code: 403 }
  return {}
}

const loadOwnedEstimate = async (req) => {
  const est = await EstimateQuote.findById(req.params.estimateId)
  if (!est) return { error: 'Estimate not found', code: 404 }
  const access = assertEstimateReadable(est, req.user)
  if (access.error) return access
  return { est }
}

/** History page often has only estimateId — load grand + saved rows from DB. */
const hydrateFromEstimateId = async (req) => {
  const estimateId = resolveEstimateId(req)
  if (!estimateId) return { body: req.body }
  const est = await EstimateQuote.findById(estimateId).lean()
  const access = assertEstimateReadable(est, req.user)
  if (access.error) return access
  return {
    estimateId,
    est,
    body: {
      ...req.body,
      estimateId,
      grand: req.body.grand != null ? Number(req.body.grand) : grandOf(est),
      rows:
        (Array.isArray(req.body.rows) && req.body.rows.length
          ? req.body.rows
          : null) ||
        (Array.isArray(req.body.milestones) && req.body.milestones.length
          ? req.body.milestones
          : null) ||
        (Array.isArray(est.milestoneSchedule) && est.milestoneSchedule.length
          ? est.milestoneSchedule
          : null) ||
        depositTermsToMilestoneRows(est.depositTerms, grandOf(est)) ||
        [],
      milestones:
        (Array.isArray(req.body.milestones) && req.body.milestones.length
          ? req.body.milestones
          : null) ||
        (Array.isArray(req.body.rows) && req.body.rows.length
          ? req.body.rows
          : null) ||
        (Array.isArray(est.milestoneSchedule) && est.milestoneSchedule.length
          ? est.milestoneSchedule
          : null) ||
        depositTermsToMilestoneRows(est.depositTerms, grandOf(est)) ||
        [],
      pct: req.body.pct != null ? req.body.pct : est.depositTerms?.pct,
      flat: req.body.flat != null ? req.body.flat : est.depositTerms?.flat,
      note: req.body.note || req.body.milestoneNote || est.milestoneNote || '',
      stories: req.body.stories != null ? req.body.stories : est.multiStory?.stories,
      count:
        req.body.count != null
          ? req.body.count
          : req.body.staircaseCount != null
            ? req.body.staircaseCount
            : est.multiStory?.staircaseCount,
      unitCost:
        req.body.unitCost != null
          ? req.body.unitCost
          : est.multiStory?.staircaseUnitCost,
    },
  }
}

// ── Previews (stateless OR estimateId hydration for history) ─────────
exports.previewDeposit = asyncHandler(async (req, res) => {
  const hydrated = await hydrateFromEstimateId(req)
  if (hydrated.error) {
    return hydrated.code === 404 ? notFound(res, hydrated.error) : forbidden(res, hydrated.error)
  }
  return success(res, computeDeposit(hydrated.body), 'Deposit preview')
})

exports.previewMilestones = asyncHandler(async (req, res) => {
  const hydrated = await hydrateFromEstimateId(req)
  if (hydrated.error) {
    return hydrated.code === 404 ? notFound(res, hydrated.error) : forbidden(res, hydrated.error)
  }
  const computed = computeMilestones({
    grand: hydrated.body.grand,
    rows: hydrated.body.rows || hydrated.body.milestones || [],
  })
  return success(
    res,
    {
      ...computed,
      estimateId: hydrated.estimateId || null,
      milestoneNote: hydrated.body.note || '',
      milestoneSchedule: computed.rows,
    },
    'Milestone preview',
  )
})

exports.previewStaircase = asyncHandler(async (req, res) => {
  const hydrated = await hydrateFromEstimateId(req)
  if (hydrated.error) {
    return hydrated.code === 404 ? notFound(res, hydrated.error) : forbidden(res, hydrated.error)
  }
  return success(res, computeStaircase(hydrated.body), 'Staircase preview')
})

// ── Persistence on an estimate ───────────────────────────────────────
exports.updateEstimateDeposit = asyncHandler(async (req, res) => {
  const { est, error, code } = await loadOwnedEstimate(req)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)
  const grand = req.body.grand != null ? Number(req.body.grand) : grandOf(est)
  const d = computeDeposit({ grand, pct: req.body.pct, flat: req.body.flat })
  const flat =
    req.body.flat != null && Number(req.body.flat) > 0 ? Number(req.body.flat) : undefined
  est.depositTerms = { ...d, flat, note: req.body.note || '' }

  // Keep payment milestones + quote preview in sync when only Request Deposit is used.
  const syncedRows = syncDepositIntoMilestoneRows(est.milestoneSchedule || [], d, { flat })
  const m = computeMilestones({ grand, rows: syncedRows })
  est.milestoneSchedule = m.rows
  if (req.body.note) est.milestoneNote = req.body.note

  await est.save()
  // Keep legacy flat deposit fields (pct/deposit/…) for existing FE; also return milestones.
  return success(
    res,
    {
      ...est.depositTerms,
      depositTerms: est.depositTerms,
      milestoneSchedule: m.rows,
      milestones: m.rows,
      scheduled: m.scheduled,
      remaining: m.remaining,
      fullyScheduled: m.fullyScheduled,
    },
    'Deposit terms saved',
  )
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
  const estimateId = resolveEstimateId(req)
  if (estimateId) {
    const est = await EstimateQuote.findById(estimateId).lean()
    if (!est) return { error: 'Estimate not found' }
    const access = assertEstimateReadable(est, req.user)
    if (access.error) return access
    return {
      estimateId,
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
  if (resolved.error) {
    return resolved.code === 403 ? forbidden(res, resolved.error) : notFound(res, resolved.error)
  }
  const saved = resolved.depositTerms || null
  const html = generateDepositReceiptHtml({
    quote: resolved.quote,
    grand: resolved.grand,
    pct: req.body.pct != null ? req.body.pct : saved?.pct,
    flat: req.body.flat != null ? req.body.flat : saved?.flat,
    note: req.body.note || saved?.note || '',
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
  if (resolved.error) {
    return resolved.code === 403 ? forbidden(res, resolved.error) : notFound(res, resolved.error)
  }
  const rows =
    (Array.isArray(req.body.rows) && req.body.rows.length ? req.body.rows : null) ||
    (Array.isArray(req.body.milestones) && req.body.milestones.length
      ? req.body.milestones
      : null) ||
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
