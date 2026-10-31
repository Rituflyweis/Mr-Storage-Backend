const PricingRules = require('../../models/PricingRules')
const EstimateQuote = require('../../models/EstimateQuote')
const Quotation = require('../../models/Quotation')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildPricingRates } = require('../../services/quoting/pricingRulesAdapter')
const { parseShipperBuffer, parseShipperCoverSheet } = require('../../services/quoting/shipperParser')
const { categoriesToWeightByCategory } = require('../../services/quoting/pricingEngine')
const { extractDrawingPdfBuffer } = require('../../services/quoting/drawingPdfExtractor')
const { parseStorageCogBuffer } = require('../../services/quoting/storageCogParser')
const { buildAndComputeFullPembQuote, computeFullPembQuote } = require('../../services/quoting/quotePricingOrchestrator')
const { computeStoragePricing } = require('../../services/quoting/storagePricingEngine')
const {
  previewCogsOverride,
  normalizeCogsOverrideInput,
} = require('../../services/quoting/cogsOverride')
const { previewMarginOverride } = require('../../services/quoting/marginOverride')
const { lookupSalesTaxByZip } = require('../../services/quoting/salesTaxLookup')
const {
  syncLinkedQuotationFromUpdatedEstimate,
  getWorkflowStatus,
} = require('../common/quotation.controller')
const {
  generateAssembledHtml,
  generateQuoteHtml,
  generateSowHtml,
  generateContractHtml,
  generateQuotePdf,
} = require('../../services/quoting/quoteDocumentGenerator')
const { rescalePaymentsForGrand } = require('../../services/quoting/changeOrderApply')

const roundMoney2 = (n) => Math.round((Number(n) || 0) * 100) / 100

/** Header fields from lead (+ customer) for estimateId-first create. */
const leadHeaderFromLead = async (lead) => {
  if (!lead) return {}
  let customerName = ''
  let customerEmail = ''
  if (lead.customerId) {
    const c = await Customer.findById(lead.customerId).select('name email').lean()
    customerName = c?.name || ''
    customerEmail = c?.email || ''
  }
  const install = lead.installAddress || {}
  const street =
    [install.line1, install.line2].filter(Boolean).join(', ') || lead.location || ''
  const cityStateZip = [
    lead.city || install.city,
    lead.state || install.state,
    lead.pincode || install.postalCode,
  ]
    .filter(Boolean)
    .join(', ')
  const sqftNum = Number(String(lead.sqft || '').replace(/,/g, '')) || 0
  return {
    leadCompanyName: customerName || lead.projectName || '',
    customerEmail,
    streetAddress: street,
    cityStateZip: cityStateZip || lead.location || '',
    jobNumber: lead.jobId || '',
    buildingSize: sqftNum > 0 ? `${sqftNum.toLocaleString()} SF` : lead.sqft || '',
    squareFootageHint: sqftNum > 0 ? sqftNum : undefined,
  }
}

const getOrCreatePricingRules = async (userId) => {
  let rules = await PricingRules.findOne({ ownerId: userId })
  if (!rules) rules = await PricingRules.create({ ownerId: userId })
  return rules
}

const decodeBase64File = (fileBase64) => {
  if (!fileBase64) return null
  const raw = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64
  return Buffer.from(raw, 'base64')
}

const toNumber = (value, fallback = 0) => {
  if (value == null) return fallback
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber()
  if (typeof value === 'object' && value._bsontype === 'Decimal128') {
    return parseFloat(String(value)) || fallback
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const isPlainObject = (value) =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const firstDefined = (...vals) => {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

/** Engineering Drawings $ — UI field; many FE aliases. Numeric `drawings` only (array = attachments). */
const pickPembDrawings = (body = {}, controls = {}) => {
  const drawingsAsAmount =
    typeof body.drawings === 'number' ||
    (typeof body.drawings === 'string' && body.drawings.trim() !== '' && !Number.isNaN(Number(body.drawings)))
      ? body.drawings
      : undefined
  const raw = firstDefined(
    body.pembDrawings,
    body.drawingsOverride,
    body.engineeringDrawings,
    body.engineeringDrawing,
    body.engineeringDrawingsCost,
    body.drawingCost,
    body.drawingsCost,
    body.drawingFee,
    drawingsAsAmount,
    controls.pembDrawings,
    controls.drawingsOverride,
    controls.engineeringDrawings,
    controls.engineeringDrawing,
    controls.drawings,
  )
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Finish type — Red Iron / Galvanized. */
const pickSteelFinish = (body = {}, controls = {}) => {
  if (body.galvanized === true || body.galvanized === 'true' || body.galvanized === 1) {
    return 'galvanized'
  }
  if (body.galvanized === false || body.galvanized === 'false' || body.galvanized === 0) {
    return 'red-iron'
  }
  const raw = String(
    firstDefined(
      body.steelFinish,
      body.finishType,
      body.finish,
      body.steel_finish,
      body.framingFinish,
      body.secondaryFinish,
      controls.steelFinish,
      controls.finishType,
      controls.finish,
      'red-iron',
    ),
  )
    .toLowerCase()
    .trim()
  if (
    raw === 'galvanized' ||
    raw === 'galv' ||
    raw.includes('galvan') ||
    raw === 'z' ||
    raw === 'zinc'
  ) {
    return 'galvanized'
  }
  return 'red-iron'
}

const normalizeQuoteOptions = (body = {}) => {
  const scopeRaw = String(body.scope || 'both').toLowerCase()
  const scope = ['supply', 'install', 'both'].includes(scopeRaw) ? scopeRaw : 'both'
  const controls = body.quoteControls || {}
  const steelFinish = pickSteelFinish(body, controls)

  let matMuOverride = null
  if (body.matMuOverride != null && body.matMuOverride !== '') {
    matMuOverride = Number(body.matMuOverride)
  } else if (body.matMuPct != null && body.matMuPct !== '') {
    matMuOverride = 1 + Number(body.matMuPct) / 100
  } else if (controls.matMuOverride != null) {
    matMuOverride = Number(controls.matMuOverride)
  }

  const freightRaw =
    body.freightOverride !== undefined
      ? body.freightOverride
      : controls.freightOverride
  const freightOverride =
    freightRaw !== undefined && freightRaw !== null && freightRaw !== ''
      ? Number(freightRaw)
      : null

  const deletedRowKeys = Array.isArray(body.deletedRowKeys)
    ? body.deletedRowKeys
    : Array.isArray(controls.deletedRowKeys)
      ? controls.deletedRowKeys
      : []

  // 0 from saved EstimateQuote must not override pricing-engine defaults (?? treats 0 as set).
  const positiveOrUndef = (v) => {
    if (v === undefined || v === null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  return {
    jobType: body.jobType || 'PEMB',
    scope,
    roof: body.roof || body.roofType || 'screw-down',
    install: body.install || body.installLevel || 'medium',
    sf: Number(body.squareFootage || body.sf || body.buildingSf || 0) || 0,
    blendPct: body.blendPct !== undefined ? Number(body.blendPct) : 50,
    installCostPerSf: positiveOrUndef(body.installCostPerSf),
    sellPerSf: positiveOrUndef(body.sellPerSf),
    matMuOverride,
    steelFinish,
    freightOverride,
    // Engineering Drawings $ — canonical pembDrawings (aliases via pickPembDrawings).
    pembDrawings: pickPembDrawings(body, controls),
    pembIncludeErection: Boolean(
      body.pembIncludeErection ?? controls.pembIncludeErection ?? false,
    ),
    deletedRowKeys,
  }
}

/** Patch drawings $ onto an existing pricing blob when full category recompute is unavailable. */
const applyPembDrawingsToPricing = (pricing, pembDrawings, steelFinish) => {
  if (!pricing || typeof pricing !== 'object') return pricing
  const old = Number(pricing.pembDrawings) || 0
  const neu = Number(pembDrawings) || 0
  const next = { ...pricing }
  if (steelFinish) next.steelFinish = steelFinish
  if (old === neu) return next
  const delta = neu - old
  next.pembDrawings = neu
  next.totSell = (Number(next.totSell) || 0) + delta
  next.totCost = (Number(next.totCost) || 0) + delta
  next.profit = (Number(next.totSell) || 0) - (Number(next.totCost) || 0)
  next.profPct =
    next.totSell > 0 ? ((next.profit / next.totSell) * 100).toFixed(1) : next.profPct
  if (Number(next.sf) > 0) next.sfPrice = (next.totSell / next.sf).toFixed(2)
  return next
}

// Mongo enum is Supply / Install / Both; pricing + FE often send lowercase.
const toStoredScope = (value) => {
  const key = String(value || 'both').toLowerCase()
  if (key === 'supply') return 'Supply'
  if (key === 'install') return 'Install'
  return 'Both'
}

const { normalizeConcreteConfig } = require('../../services/quoting/addonPricing')

const normalizeFullQuoteExtras = (body = {}, options = {}) => ({
  concrete: (() => {
    const raw = body.concrete || body.concreteAddon
    return raw ? normalizeConcreteConfig(raw) : undefined
  })(),
  insulation: body.insulation || body.insulationAddon || undefined,
  salesTax: body.salesTax || undefined,
  // Material Sell Override (ex-freight) → cogsOverride.materialSellOverride; auto-applies.
  cogsOverride: normalizeCogsOverrideInput(body.cogsOverride, body) || undefined,
  marginOverride: body.marginOverride || undefined,
  pembAddOns: body.pembAddOns || body.quoteControls?.pembAddOns || undefined,
  staircase: (() => {
    const s = body.staircase || body.quoteControls?.staircase || null
    const m = body.multiStory || null
    if (s && typeof s === 'object') {
      return {
        count: s.count != null ? s.count : s.staircaseCount,
        unitCost: s.unitCost != null ? s.unitCost : s.staircaseUnitCost,
        stories: s.stories,
      }
    }
    if (m && typeof m === 'object') {
      return {
        count: m.staircaseCount != null ? m.staircaseCount : m.count,
        unitCost: m.staircaseUnitCost != null ? m.staircaseUnitCost : m.unitCost,
        stories: m.stories,
      }
    }
    return undefined
  })(),
  scope: options.scope,
})

const extractFirstNumber = (value) => {
  const m = String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : 0
}

const deriveCoverSquareFootage = (cover = {}) => {
  const map = cover?.labelMap || {}
  const keys = Object.keys(map)
  const findByLabel = (patterns = []) => {
    for (const k of keys) {
      if (patterns.some((p) => p.test(k))) {
        const n = extractFirstNumber(map[k])
        if (n > 0) return n
      }
    }
    return 0
  }

  const directSqft = findByLabel([/sq\s*ft/i, /square\s*foot/i, /\bsf\b/i])
  if (directSqft > 0) return Math.round(directSqft)

  const width = findByLabel([/^width/i, /\bwidth\b/i])
  const length = findByLabel([/^length/i, /\blength\b/i])
  if (width > 0 && length > 0) return Math.round(width * length)
  return 0
}

const buildPricingPayload = async (userId, { categories, options, fullExtras }) => {
  const rulesDoc = await getOrCreatePricingRules(userId)
  const { pr } = buildPricingRates(rulesDoc)
  const engineOptions = { ...options, PR: pr }

  const extras = fullExtras || {}
  const hasExtras =
    extras.concrete ||
    extras.insulation ||
    extras.salesTax ||
    extras.cogsOverride?.applied ||
    extras.cogsOverride?.materialSellOverride ||
    extras.cogsOverride?.sellDollar ||
    extras.marginOverride?.applied ||
    (extras.pembAddOns && extras.pembAddOns.length > 0)

  let fullQuote = null
  let pricing

  const fullExtrasWithScope = { ...extras, scope: engineOptions.scope }

  if (hasExtras || (extras.pembAddOns && extras.pembAddOns.length)) {
    fullQuote = buildAndComputeFullPembQuote(categories, engineOptions, fullExtrasWithScope)
    pricing = fullQuote.pricing
  } else {
    const { priceJob } = require('../../services/quoting/pricingEngine')
    pricing = priceJob(categories, engineOptions)
    fullQuote = computeFullPembQuote(pricing, {
      ...fullExtrasWithScope,
      sf: engineOptions.sf,
    })
  }

  const weightByCategory = categoriesToWeightByCategory(categories, pr)

  return {
    pricing,
    weightByCategory,
    parsedCategories: categories,
    fullQuote,
  }
}

const estimateToDocumentPayload = (estimate) => {
  const grandTotal = resolveEstimateGrandTotal(estimate)
  const savedAddOns = Array.isArray(estimate.pembAddOns) ? estimate.pembAddOns : []
  const full = estimate.fullQuoteResult || null
  const fullAddOns = Array.isArray(full?.pembAddOns) ? full.pembAddOns : []
  const pembAddOns = fullAddOns.length ? fullAddOns : savedAddOns
  const pricing = estimate.pricingResult || full?.pricing || null
  const controls = estimate.quoteControls || {}
  return {
  estimateId: estimate._id,
  jobType: estimate.jobType,
  leadCompanyName: estimate.leadCompanyName,
  customerEmail: estimate.customerEmail,
  streetAddress: estimate.streetAddress,
  cityStateZip: estimate.cityStateZip,
  buildingSize: estimate.buildingSize,
  squareFootage: estimate.squareFootage,
  quoteDate: estimate.quoteDate,
  additionalInfo: estimate.additionalInfo,
  pricingResult: estimate.pricingResult,
  storageData: estimate.storageData,
  storagePricingResult: estimate.storagePricingResult,
  grandTotal,
  fullQuote: {
    ...(full || {
      pricing: estimate.pricingResult,
      concrete: estimate.concreteAddon,
      insulation: estimate.insulationAddon,
      salesTax: estimate.salesTax,
      grandTotal,
      pricePerSf: estimate.pricePerSf,
    }),
    // Always surface persisted add-ons (fullQuoteResult may have been computed before they were set)
    pembAddOns,
    pembAddOnTotals: full?.pembAddOnTotals,
  },
  pembAddOns,
  multiStory: estimate.multiStory || null,
  staircase: full?.staircase || estimate.multiStory || null,
  concrete: estimate.concreteAddon,
  insulation: estimate.insulationAddon,
  salesTax: estimate.salesTax,
  cogsOverride: estimate.cogsOverride || null,
  materialSellOverride:
    estimate.materialSellOverride ??
    estimate.cogsOverride?.materialSellOverride ??
    null,
  pembDrawings: firstDefined(
    pricing?.pembDrawings,
    controls.pembDrawings,
    controls.drawingsOverride,
    controls.engineeringDrawings,
  ),
  steelFinish: firstDefined(
    pricing?.steelFinish,
    controls.steelFinish,
    controls.finishType,
    controls.finish,
  ),
  depositTerms: estimate.depositTerms || null,
  milestoneSchedule: estimate.milestoneSchedule || [],
  milestoneNote: estimate.milestoneNote || '',
  milestones: estimate.milestoneSchedule || [],
  originalContractValue:
    estimate.originalContractValue != null ? Number(estimate.originalContractValue) : null,
  revisedContractTotal:
    estimate.revisedContractTotal != null ? Number(estimate.revisedContractTotal) : null,
  companyBrand: estimate.companyBrand || 'SM',
  company: estimate.companyBrand || 'SM',
  companyLogoUrl: estimate.companyLogoUrl || '',
  contract: estimate.contractDetails,
  drawingAttachments: estimate.drawingAttachments,
  customer: {
    name: estimate.leadCompanyName,
    address: estimate.streetAddress,
    location: estimate.cityStateZip,
    email: estimate.customerEmail,
  },
}
}

/** History / sparse clients often send only id — resolve from body, query, or path. */
const resolveEstimateIdFromReq = (req = {}) =>
  firstDefined(
    req.body?.estimateId,
    req.body?.id,
    req.query?.estimateId,
    req.query?.id,
    req.params?.estimateId,
  )

const bodyHasExplicitDrawings = (body = {}) =>
  firstDefined(
    body.pembDrawings,
    body.drawingsOverride,
    body.engineeringDrawings,
    body.engineeringDrawing,
    body.engineeringDrawingsCost,
    body.drawingCost,
    body.drawingsCost,
    body.drawingFee,
    typeof body.drawings === 'number' ? body.drawings : undefined,
    body.quoteControls?.pembDrawings,
    body.quoteControls?.drawingsOverride,
    body.quoteControls?.engineeringDrawings,
  ) !== undefined

const bodyHasExplicitFinish = (body = {}) =>
  firstDefined(
    body.steelFinish,
    body.finishType,
    body.finish,
    body.galvanized,
    body.steel_finish,
    body.framingFinish,
    body.secondaryFinish,
    body.quoteControls?.steelFinish,
    body.quoteControls?.finishType,
    body.quoteControls?.finish,
  ) !== undefined

const nonEmptyMilestoneRows = (...candidates) => {
  for (const rows of candidates) {
    if (Array.isArray(rows) && rows.length) return rows
  }
  return []
}

const hasDocumentPricing = (payload = {}) =>
  Boolean(
    payload.pricingResult ||
      payload.fullQuote?.pricing ||
      payload.storagePricingResult ||
      payload.storagePricing ||
      payload.jobType === 'Storage'
  )

const applyStorageEstimateTotals = (estimate, storagePricing) => {
  if (!storagePricing) return
  estimate.storagePricingResult = storagePricing
  estimate.totalSell = Math.round(storagePricing.grandTotal ?? 0)
  estimate.pricePerSf = storagePricing.pricePerSf ? Number(storagePricing.pricePerSf) : null
  estimate.profit = storagePricing.profit ?? 0
  estimate.marginPercent = Number(storagePricing.marginPercent) || 0
}

/** Quote total shown to customer (building + concrete + insulation + tax). */
const resolveEstimateGrandTotal = (estimate = {}) => {
  try {
    // After change orders on a final estimate, revised total is the customer contract value.
    if (estimate.revisedContractTotal != null && Number.isFinite(Number(estimate.revisedContractTotal))) {
      return Math.round(toNumber(estimate.revisedContractTotal))
    }
    if (estimate.jobType === 'Storage' && estimate.storagePricingResult?.grandTotal != null) {
      return Math.round(toNumber(estimate.storagePricingResult.grandTotal))
    }
    if (estimate.fullQuoteResult?.grandTotal != null) {
      return Math.round(toNumber(estimate.fullQuoteResult.grandTotal))
    }
    if (isPlainObject(estimate.pricingResult)) {
      const full = computeFullPembQuote(estimate.pricingResult, {
        concrete: estimate.concreteAddon,
        insulation: estimate.insulationAddon,
        salesTax: estimate.salesTax,
        cogsOverride: estimate.cogsOverride,
        marginOverride: estimate.marginOverride,
        pembAddOns: estimate.pembAddOns,
        scope: estimate.scope,
        sf: toNumber(estimate.squareFootage),
      })
      return Math.round(
        toNumber(full.grandTotal, toNumber(estimate.pricingResult.totSell, estimate.totalSell))
      )
    }
    return Math.round(toNumber(estimate.totalSell))
  } catch (err) {
    console.error('[resolveEstimateGrandTotal]', estimate._id, err.message)
    return Math.round(toNumber(estimate.totalSell))
  }
}

/** Building subtotal before concrete, insulation, and tax. */
const resolveEstimateBuildingSubtotal = (estimate = {}) => {
  try {
    if (estimate.jobType === 'Storage' && estimate.storagePricingResult) {
      const sp = estimate.storagePricingResult
      return Math.round(
        toNumber(sp.buildingSell) +
          toNumber(sp.doorSell) +
          toNumber(sp.extrasSell) +
          toNumber(sp.installSell) +
          toNumber(sp.shipping) +
          toNumber(sp.drawings)
      )
    }
    if (estimate.fullQuoteResult?.buildingSubtotal != null) {
      return Math.round(toNumber(estimate.fullQuoteResult.buildingSubtotal))
    }
    return Math.round(
      toNumber(estimate.pricingResult?.totSell, estimate.totalSell)
    )
  } catch (err) {
    console.error('[resolveEstimateBuildingSubtotal]', estimate._id, err.message)
    return Math.round(toNumber(estimate.totalSell))
  }
}

const withEstimateTotals = (estimate) => {
  const materialSellOverride =
    estimate?.cogsOverride?.materialSellOverride ??
    estimate?.materialSellOverride ??
    estimate?.quoteControls?.materialSellOverride ??
    null
  return {
    ...estimate,
    grandTotal: resolveEstimateGrandTotal(estimate),
    buildingSubtotal: resolveEstimateBuildingSubtotal(estimate),
    materialSellOverride,
    cogsOverride: estimate?.cogsOverride || null,
  }
}

const withEstimateListTotals = (estimate) => {
  const {
    drawingAttachments: _drawings,
    parsedCategories: _parsed,
    breakdownRows: _rows,
    tabSummary: _tabs,
    storageData: _storage,
    weightByCategory: _weights,
    ...rest
  } = estimate
  return {
    ...rest,
    grandTotal: resolveEstimateGrandTotal(estimate),
    buildingSubtotal: resolveEstimateBuildingSubtotal(estimate),
    drawingCount: Array.isArray(_drawings) ? _drawings.length : 0,
  }
}

const buildEstimateConversionMeta = (quotation) => {
  if (!quotation) {
    return {
      isConvertedToQuotation: false,
      quotationId: null,
      quoteNumber: null,
      quotationStatus: null,
      approvalStatus: null,
      workflowStatus: null,
      versionNumber: null,
      convertedAt: null,
    }
  }
  const approvalStatus = quotation.approval?.status || 'not_submitted'
  return {
    isConvertedToQuotation: true,
    quotationId: quotation._id,
    quoteNumber: quotation.quoteNumber || null,
    quotationStatus: quotation.status || 'draft',
    approvalStatus,
    workflowStatus: getWorkflowStatus(quotation),
    versionNumber: quotation.versionNumber || 1,
    convertedAt: quotation.createdAt || null,
  }
}

const applyEstimateTotals = (estimate, payload) => {
  const { pricing, fullQuote: incomingFullQuote } = payload
  if (!pricing) return

  estimate.pricingResult = pricing
  estimate.breakdownRows = pricing.rows || []
  estimate.totalWeightLbs = pricing.totWt ?? 0
  estimate.trucksRequired = pricing.trucks ?? 0
  estimate.materialCost = pricing.matCost ?? 0
  estimate.freightCost = pricing.freight ?? 0
  estimate.totalCOGS = pricing.totCost ?? 0
  estimate.installCost = pricing.instCost ?? 0
  estimate.profit = pricing.profit ?? 0
  estimate.marginPercent = Number(pricing.profPct) || 0
  estimate.vendorBlendSavings = pricing.vendorBlendSavings ?? 0

  const fullQuote =
    incomingFullQuote ||
    computeFullPembQuote(pricing, {
      concrete: estimate.concreteAddon,
      insulation: estimate.insulationAddon,
      salesTax: estimate.salesTax,
      cogsOverride: estimate.cogsOverride,
      marginOverride: estimate.marginOverride,
      pembAddOns: estimate.pembAddOns,
      scope: estimate.scope,
      sf: estimate.squareFootage,
    })

  estimate.fullQuoteResult = fullQuote
  estimate.concreteAddon = fullQuote.concrete
  estimate.insulationAddon = fullQuote.insulation
  estimate.salesTax = fullQuote.salesTax
  estimate.totalSell = fullQuote.grandTotal ?? pricing.totSell ?? 0
  estimate.pricePerSf = fullQuote.pricePerSf ? Number(fullQuote.pricePerSf) : null
  estimate.profit = fullQuote.totalProfit ?? estimate.profit
  estimate.marginPercent = fullQuote.grandMargin ?? estimate.marginPercent
}

const checkLeadAccess = async (leadId, user) => {
  if (!leadId) return {}
  const lead = await Lead.findById(leadId)
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (user.role === 'sales' && String(lead.assignedSales) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

const assertEstimateAccess = (estimate, user) => {
  if (!estimate) return { error: 'Estimate not found', code: 404 }
  if (user.role === 'sales' && String(estimate.createdBy) !== String(user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return {}
}

exports.extractDrawingPdf = asyncHandler(async (req, res) => {
  const buffer = decodeBase64File(req.body.fileBase64)
  if (!buffer?.length) return badRequest(res, 'fileBase64 required')

  const result = await extractDrawingPdfBuffer(buffer, { fileName: req.body.fileName || '' })
  return success(res, result)
})

/** Shared shipper parse + price (used by extract-shipper and from-shipper). */
const runShipperExtract = async (userId, body = {}) => {
  const buffer = decodeBase64File(body.fileBase64)
  if (!buffer?.length) {
    const err = new Error('fileBase64 required')
    err.statusCode = 400
    throw err
  }

  const options = normalizeQuoteOptions(body)
  const fullExtras = normalizeFullQuoteExtras(body, options)
  const rulesDoc = await getOrCreatePricingRules(userId)
  const { pr, customTabRules } = buildPricingRates(rulesDoc)

  const parsed = parseShipperBuffer(buffer, {
    sf: options.sf,
    customTabRules,
    PR: pr,
    steelFinish: options.steelFinish,
  })
  const cover = parseShipperCoverSheet(parsed.workbook)
  const coverSqft = deriveCoverSquareFootage(cover)

  // SF from weight must use full shipper weight:
  // category buckets + customItems (item rules e.g. Mullion) + unmapped tabs.
  const weightForSf = Number(
    parsed.detectedWeightLbs > 0
      ? parsed.detectedWeightLbs
      : parsed.totalWeightLbs || 0,
  )
  const autoSf = weightForSf > 0 ? Math.round(weightForSf / 9) : 0
  const manualSfEnabled = Boolean(body.useManualSquareFootage && options.sf > 0)
  const sf = manualSfEnabled ? options.sf : autoSf || options.sf || 0

  const payload = await buildPricingPayload(userId, {
    categories: parsed.categories,
    options: { ...options, sf },
    fullExtras,
  })

  return {
    fileName: body.fileName || '',
    sheetCount: parsed.sheetCount,
    tabSummary: parsed.tabSummary,
    totalWeightLbs: roundMoney2(parsed.totalWeightLbs),
    detectedWeightLbs: roundMoney2(parsed.detectedWeightLbs || parsed.totalWeightLbs),
    categoryWeightLbs: roundMoney2(parsed.categoryWeightLbs),
    customItemsWeightLbs: roundMoney2(parsed.customItemsWeightLbs),
    unmappedWeightLbs: roundMoney2(parsed.unmappedWeightLbs || 0),
    extractionCoveragePct: parsed.extractionCoveragePct ?? 100,
    unmappedTabs: parsed.unmappedTabs || [],
    squareFootage: sf,
    squareFootageMeta: {
      selected: sf,
      source: manualSfEnabled ? 'manual' : 'weight_formula',
      formula: 'round(detectedWeightLbs / 9)',
      weightLbsUsed: roundMoney2(weightForSf),
      mappedWeightLbs: roundMoney2(parsed.totalWeightLbs),
      categoryWeightLbs: roundMoney2(parsed.categoryWeightLbs),
      customItemsWeightLbs: roundMoney2(parsed.customItemsWeightLbs),
      fromWeight: autoSf,
      coverDerivedSqft: coverSqft,
      inputSf: options.sf || 0,
    },
    parsedCategories: parsed.categories,
    coverSheet: cover.coverName
      ? {
          coverName: cover.coverName,
          labelMap: cover.labelMap,
          preview: cover.allText.substring(0, 2000),
        }
      : null,
    weightByCategory: payload.weightByCategory,
    pricing: payload.pricing,
    fullQuote: payload.fullQuote,
    options: { ...options, sf },
    fullExtras,
    note: 'Parsed using Steel Building Depot quoting tool rules — review categories and pricing before saving.',
  }
}

const runStorageCogExtract = (body = {}) => {
  const buffer = decodeBase64File(body.fileBase64)
  if (!buffer?.length) {
    const err = new Error('fileBase64 required')
    err.statusCode = 400
    throw err
  }
  const options = normalizeQuoteOptions({ ...body, jobType: body.jobType || 'Storage' })
  const data = parseStorageCogBuffer(buffer)
  const storageData = {
    buildings: data.buildings,
    doors: data.doors,
    extras: data.extras,
    shipping: data.shippingDefault ?? 0,
    installSellPerSf: body.installSellPerSf ?? 3.25,
    installCostPerSf: body.installCostPerSf ?? 2.5,
  }
  const fullExtras = normalizeFullQuoteExtras(body, options)
  const storagePricing = computeStoragePricing(storageData, fullExtras)
  return {
    fileName: body.fileName || '',
    ...data,
    storageData,
    storagePricing,
    options: { ...options, jobType: 'Storage', sf: storagePricing.totalSqft || options.sf },
    fullExtras,
    note:
      data.format === 'vendor_cog'
        ? 'Vendor COG quote parsed (manufacturer + COGS tab) — review buildings, extras, and markup before saving.'
        : 'Storage COG sheet parsed — review buildings, doors, and extras before saving.',
  }
}

exports.extractShipperFile = asyncHandler(async (req, res) => {
  try {
    const extracted = await runShipperExtract(req.user._id, req.body)
    const { options: _o, fullExtras: _f, ...publicPayload } = extracted
    return success(res, publicPayload)
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message)
    throw err
  }
})

exports.extractStorageCog = asyncHandler(async (req, res) => {
  try {
    const extracted = runStorageCogExtract(req.body)
    const { options: _o, fullExtras: _f, storageData: _sd, ...publicPayload } = extracted
    return success(res, {
      ...publicPayload,
      storagePricing: extracted.storagePricing,
    })
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message)
    throw err
  }
})

/**
 * EstimateId-first: leadId + shipper file → draft EstimateQuote.
 * POST /estimates/from-shipper
 */
exports.createEstimateFromShipper = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  if (!leadId) return badRequest(res, 'leadId required')
  const access = await checkLeadAccess(leadId, req.user)
  if (access.error) {
    return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }

  let extracted
  try {
    extracted = await runShipperExtract(req.user._id, req.body)
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message)
    throw err
  }

  const header = await leadHeaderFromLead(access.lead)
  const options = extracted.options
  const fullExtras = extracted.fullExtras
  const pricing = extracted.pricing
  const fullQuote = extracted.fullQuote

  const estimate = await EstimateQuote.create({
    createdBy: req.user._id,
    leadId,
    jobType: options.jobType || 'PEMB',
    scope: toStoredScope(options.scope),
    roofType: options.roof,
    installLevel: options.install,
    blendPct: options.blendPct,
    leadCompanyName: req.body.leadCompanyName || header.leadCompanyName || '',
    customerEmail: req.body.customerEmail || header.customerEmail || '',
    streetAddress: req.body.streetAddress || header.streetAddress || '',
    cityStateZip: req.body.cityStateZip || header.cityStateZip || '',
    buildingSize:
      req.body.buildingSize ||
      header.buildingSize ||
      (extracted.squareFootage ? `${Number(extracted.squareFootage).toLocaleString()} SF` : ''),
    squareFootage: extracted.squareFootage || header.squareFootageHint || 0,
    jobNumber: req.body.jobNumber || header.jobNumber || '',
    quoteDate: req.body.quoteDate,
    installCostPerSf: options.installCostPerSf ?? req.body.installCostPerSf ?? 0,
    sellPerSf: options.sellPerSf ?? req.body.sellPerSf ?? 0,
    sourceFileName: req.body.fileName || req.body.sourceFileName || '',
    parsedCategories: extracted.parsedCategories,
    tabSummary: extracted.tabSummary || [],
    breakdownRows: pricing?.rows || [],
    pricingResult: pricing,
    concreteAddon: fullQuote?.concrete || null,
    insulationAddon: fullQuote?.insulation || null,
    salesTax: fullQuote?.salesTax || req.body.salesTax || null,
    cogsOverride: fullExtras.cogsOverride || null,
    marginOverride: req.body.marginOverride || null,
    pembAddOns: req.body.pembAddOns || [],
    quoteControls: {
      steelFinish: options.steelFinish,
      matMuOverride: options.matMuOverride,
      freightOverride: options.freightOverride,
      pembDrawings: options.pembDrawings,
      pembIncludeErection: options.pembIncludeErection,
      deletedRowKeys: options.deletedRowKeys,
    },
    fullQuoteResult: fullQuote,
    weightByCategory: extracted.weightByCategory || [],
    status: 'draft',
    companyBrand: req.body.companyBrand || req.body.company || 'SBD',
    companyLogoUrl: req.body.companyLogoUrl || '',
    employeeName: req.user.name || '',
    employeeRole: req.user.role || '',
  })

  applyEstimateTotals(estimate, {
    pricing:
      fullExtras.cogsOverride?.applied && fullQuote?.pricing ? fullQuote.pricing : pricing,
    fullQuote,
  })
  rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  await estimate.save()

  const estimateObj = withEstimateTotals(estimate.toObject())
  return created(
    res,
    {
      estimateId: estimate._id,
      estimate: estimateObj,
      squareFootage: extracted.squareFootage,
      squareFootageMeta: extracted.squareFootageMeta,
      parsedCategories: extracted.parsedCategories,
      weightByCategory: extracted.weightByCategory,
      pricing: extracted.pricing,
      fullQuote: extracted.fullQuote,
      tabSummary: extracted.tabSummary,
      totalWeightLbs: extracted.totalWeightLbs,
      detectedWeightLbs: extracted.detectedWeightLbs,
      note: 'Draft estimate created from shipper — use estimateId for compute, preview, and edits.',
    },
    'Estimate created from shipper',
  )
})

/**
 * EstimateId-first Storage: leadId + COG file → draft EstimateQuote.
 * POST /estimates/from-storage-cog
 */
exports.createEstimateFromStorageCog = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  if (!leadId) return badRequest(res, 'leadId required')
  const access = await checkLeadAccess(leadId, req.user)
  if (access.error) {
    return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }

  let extracted
  try {
    extracted = runStorageCogExtract(req.body)
  } catch (err) {
    if (err.statusCode === 400) return badRequest(res, err.message)
    throw err
  }

  const header = await leadHeaderFromLead(access.lead)
  const storageData = extracted.storageData
  const storagePricing = extracted.storagePricing
  const sf = storagePricing.totalSqft || 0

  const estimate = await EstimateQuote.create({
    createdBy: req.user._id,
    leadId,
    jobType: 'Storage',
    scope: toStoredScope(extracted.options.scope || 'both'),
    roofType: extracted.options.roof || 'screw-down',
    installLevel: extracted.options.install || 'medium',
    blendPct: extracted.options.blendPct,
    leadCompanyName: req.body.leadCompanyName || header.leadCompanyName || '',
    customerEmail: req.body.customerEmail || header.customerEmail || '',
    streetAddress: req.body.streetAddress || header.streetAddress || '',
    cityStateZip: req.body.cityStateZip || header.cityStateZip || '',
    buildingSize:
      req.body.buildingSize ||
      header.buildingSize ||
      (sf ? `${Number(sf).toLocaleString()} SF` : ''),
    squareFootage: sf || header.squareFootageHint || 0,
    jobNumber: req.body.jobNumber || header.jobNumber || '',
    quoteDate: req.body.quoteDate,
    sourceFileName: req.body.fileName || req.body.sourceFileName || '',
    storageData,
    storagePricingResult: storagePricing,
    salesTax: storagePricing.salesTax || req.body.salesTax || null,
    status: 'draft',
    companyBrand: req.body.companyBrand || req.body.company || 'SM',
    companyLogoUrl: req.body.companyLogoUrl || '',
    employeeName: req.user.name || '',
    employeeRole: req.user.role || '',
  })

  applyStorageEstimateTotals(estimate, storagePricing)
  rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  await estimate.save()

  return created(
    res,
    {
      estimateId: estimate._id,
      estimate: withEstimateTotals(estimate.toObject()),
      squareFootage: sf,
      storageData,
      storagePricing,
      format: extracted.format,
      note: 'Draft Storage estimate created from COG — use estimateId for compute-storage path, preview, and edits.',
    },
    'Estimate created from storage COG',
  )
})

/**
 * Recompute draft from stored categories/storageData + small options body.
 * POST /estimates/:estimateId/compute
 */
exports.computeEstimateById = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId)
  if (!estimate) return notFound(res, 'Estimate not found')
  const access = assertEstimateAccess(estimate, req.user)
  if (access.error) {
    return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  }
  if (estimate.status !== 'draft') {
    return badRequest(res, 'Only draft estimates can be recomputed')
  }

  const mergedBody = {
    ...estimate.toObject(),
    ...req.body,
    jobType: req.body.jobType || estimate.jobType,
    squareFootage:
      req.body.squareFootage ?? req.body.sf ?? estimate.squareFootage,
    scope: req.body.scope || estimate.scope,
    roof: req.body.roof || req.body.roofType || estimate.roofType,
    install: req.body.install || req.body.installLevel || estimate.installLevel,
    steelFinish:
      req.body.steelFinish ||
      estimate.quoteControls?.steelFinish ||
      'red-iron',
    quoteControls: {
      ...(estimate.quoteControls && typeof estimate.quoteControls.toObject === 'function'
        ? estimate.quoteControls.toObject()
        : estimate.quoteControls || {}),
      ...(req.body.quoteControls || {}),
    },
    concrete: req.body.concrete || req.body.concreteAddon || estimate.concreteAddon,
    insulation:
      req.body.insulation || req.body.insulationAddon || estimate.insulationAddon,
    salesTax: req.body.salesTax || estimate.salesTax,
    cogsOverride:
      req.body.cogsOverride !== undefined ? req.body.cogsOverride : estimate.cogsOverride,
    marginOverride:
      req.body.marginOverride !== undefined
        ? req.body.marginOverride
        : estimate.marginOverride,
    pembAddOns: req.body.pembAddOns || estimate.pembAddOns,
    materialSellOverride:
      req.body.materialSellOverride ??
      req.body.matSellOverride ??
      estimate.cogsOverride?.materialSellOverride,
  }

  const options = normalizeQuoteOptions(mergedBody)
  const fullExtras = normalizeFullQuoteExtras(mergedBody, options)

  // Persist option field updates from body
  if (req.body.scope !== undefined) estimate.scope = toStoredScope(req.body.scope)
  if (req.body.roof !== undefined || req.body.roofType !== undefined) {
    estimate.roofType = req.body.roof || req.body.roofType
  }
  if (req.body.install !== undefined || req.body.installLevel !== undefined) {
    estimate.installLevel = req.body.install || req.body.installLevel
  }
  if (req.body.blendPct !== undefined) estimate.blendPct = Number(req.body.blendPct)
  if (req.body.squareFootage != null || req.body.sf != null) {
    estimate.squareFootage = Number(req.body.squareFootage ?? req.body.sf) || 0
  }
  if (req.body.marginOverride !== undefined) estimate.marginOverride = req.body.marginOverride
  if (req.body.pembAddOns !== undefined) estimate.pembAddOns = req.body.pembAddOns
  if (req.body.salesTax !== undefined) estimate.salesTax = req.body.salesTax
  if (req.body.concrete !== undefined || req.body.concreteAddon !== undefined) {
    estimate.concreteAddon = req.body.concrete || req.body.concreteAddon
  }
  if (req.body.insulation !== undefined || req.body.insulationAddon !== undefined) {
    estimate.insulationAddon = req.body.insulation || req.body.insulationAddon
  }
  if (
    req.body.cogsOverride !== undefined ||
    req.body.materialSellOverride != null ||
    req.body.matSellOverride != null
  ) {
    estimate.cogsOverride = fullExtras.cogsOverride || null
  }
  estimate.quoteControls = {
    ...(estimate.quoteControls && typeof estimate.quoteControls.toObject === 'function'
      ? estimate.quoteControls.toObject()
      : estimate.quoteControls || {}),
    steelFinish: options.steelFinish,
    matMuOverride: options.matMuOverride,
    freightOverride: options.freightOverride,
    pembDrawings: options.pembDrawings,
    pembIncludeErection: options.pembIncludeErection,
    deletedRowKeys: options.deletedRowKeys,
  }

  const isStorage =
    estimate.jobType === 'Storage' || estimate.storageData?.buildings?.length

  if (isStorage) {
    const storageData = req.body.storageData || estimate.storageData
    if (!storageData?.buildings?.length) {
      return badRequest(res, 'storageData.buildings required on estimate')
    }
    if (req.body.storageData) estimate.storageData = req.body.storageData
    const priorSp = estimate.storagePricingResult || {}
    const storagePricing = computeStoragePricing(storageData, {
      ...fullExtras,
      shipping: req.body.shipping ?? storageData.shipping ?? priorSp.shipping,
      drawings: req.body.drawings ?? storageData.drawings ?? priorSp.drawings,
      installSellPerSf:
        req.body.installSellPerSf ??
        storageData.installSellPerSf ??
        priorSp.installSellPerSf,
      installCostPerSf:
        req.body.installCostPerSf ??
        storageData.installCostPerSf ??
        priorSp.installCostPerSf,
      salesTax: req.body.salesTax ?? estimate.salesTax ?? storageData.salesTax,
      concrete: estimate.concreteAddon || storageData.concrete,
      insulation: estimate.insulationAddon || storageData.insulation,
      totalSqft: estimate.squareFootage || priorSp.totalSqft,
    })
    applyStorageEstimateTotals(estimate, storagePricing)
    rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
    await estimate.save()
    return success(res, {
      estimateId: estimate._id,
      estimate: withEstimateTotals(estimate.toObject()),
      storagePricing,
    })
  }

  const cats = estimate.parsedCategories
  if (!cats) return badRequest(res, 'Estimate has no parsedCategories to recompute')

  const payload = await buildPricingPayload(req.user._id, {
    categories: cats,
    options,
    fullExtras,
  })
  estimate.weightByCategory = payload.weightByCategory
  applyEstimateTotals(estimate, payload)
  rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  await estimate.save()

  return success(res, {
    estimateId: estimate._id,
    estimate: withEstimateTotals(estimate.toObject()),
    weightByCategory: payload.weightByCategory,
    pricing: payload.pricing,
    fullQuote: payload.fullQuote,
    parsedCategories: payload.parsedCategories || cats,
  })
})

exports.computeQuote = asyncHandler(async (req, res) => {
  const { parsedCategories, categories } = req.body
  const cats = parsedCategories || categories
  if (!cats) return badRequest(res, 'parsedCategories required')

  const options = normalizeQuoteOptions(req.body)
  const fullExtras = normalizeFullQuoteExtras(req.body, options)
  const payload = await buildPricingPayload(req.user._id, {
    categories: cats,
    options,
    fullExtras,
  })

  return success(res, {
    weightByCategory: payload.weightByCategory,
    pricing: payload.pricing,
    fullQuote: payload.fullQuote,
    parsedCategories: payload.parsedCategories,
  })
})

exports.computeStorageQuote = asyncHandler(async (req, res) => {
  const storageData = req.body.storageData
  if (!storageData?.buildings?.length) {
    return badRequest(res, 'storageData.buildings required')
  }

  const options = normalizeQuoteOptions(req.body)
  const fullExtras = normalizeFullQuoteExtras(req.body, options)
  const storagePricing = computeStoragePricing(storageData, {
    ...fullExtras,
    shipping: req.body.shipping ?? storageData.shipping,
    drawings: req.body.drawings ?? storageData.drawings,
    installSellPerSf: req.body.installSellPerSf ?? storageData.installSellPerSf,
    installCostPerSf: req.body.installCostPerSf ?? storageData.installCostPerSf,
    totalSqft: req.body.squareFootage ?? req.body.sf,
  })

  return success(res, { storagePricing })
})

exports.previewCogsOverride = asyncHandler(async (req, res) => {
  const pricing = req.body.pricingResult || req.body.pricing
  if (!pricing) return badRequest(res, 'pricingResult required')

  const override = normalizeCogsOverrideInput(
    req.body.cogsOverride || req.body,
    req.body
  )
  const preview = previewCogsOverride(pricing, override || {})
  return success(res, { preview, cogsOverride: override })
})

exports.previewMarginOverride = asyncHandler(async (req, res) => {
  const pricing = req.body.pricingResult || req.body.pricing
  if (!pricing) return badRequest(res, 'pricingResult required')

  const preview = previewMarginOverride(pricing, req.body.marginOverride || req.body)
  return success(res, { preview })
})

exports.lookupTaxRate = asyncHandler(async (req, res) => {
  const zip = req.params.zip || req.query.zip
  if (!zip) return badRequest(res, 'zip required')
  const result = await lookupSalesTaxByZip(zip)
  if (result.error) return badRequest(res, result.error)
  return success(res, result)
})

/** Merge saved estimate with live Recompute body so quote preview reflects latest pricing. */
const mergeLiveDocumentPayload = (savedPayload, body = {}) => {
  const livePricing = body.pricingResult || body.pricing || null
  const liveFull = body.fullQuote || body.fullQuoteResult || null
  const liveStorage = body.storagePricingResult || body.storagePricing || null

  const mergedFull = liveFull
    ? {
        ...(savedPayload.fullQuote || {}),
        ...liveFull,
        pricing: liveFull.pricing || livePricing || savedPayload.fullQuote?.pricing,
      }
    : livePricing
      ? {
          ...(savedPayload.fullQuote || {}),
          pricing: livePricing,
          grandTotal:
            body.grandTotal ??
            liveFull?.grandTotal ??
            savedPayload.fullQuote?.grandTotal,
        }
      : savedPayload.fullQuote

  return {
    ...savedPayload,
    ...body,
    estimateId: body.estimateId || savedPayload.estimateId,
    // Live recompute wins; fall back to saved estimate fields.
    pricingResult: livePricing || savedPayload.pricingResult,
    pricing: livePricing || body.pricing || savedPayload.pricingResult,
    fullQuote: mergedFull,
    fullQuoteResult: mergedFull,
    // Live pricing must not keep a stale body.grandTotal (that froze preview until save).
    // Change-order revised total always wins for final contracts.
    grandTotal: (() => {
      const revised = body.revisedContractTotal ?? savedPayload.revisedContractTotal
      if (revised != null && Number.isFinite(Number(revised))) {
        return Math.round(Number(revised))
      }
      if (liveFull?.grandTotal != null && Number.isFinite(Number(liveFull.grandTotal))) {
        return Math.round(Number(liveFull.grandTotal))
      }
      if (livePricing) return undefined
      if (body.grandTotal != null && Number.isFinite(Number(body.grandTotal))) {
        return Math.round(Number(body.grandTotal))
      }
      return savedPayload.grandTotal
    })(),
    originalContractValue:
      body.originalContractValue ?? savedPayload.originalContractValue ?? null,
    revisedContractTotal:
      body.revisedContractTotal ?? savedPayload.revisedContractTotal ?? null,
    storagePricingResult: liveStorage || savedPayload.storagePricingResult,
    storagePricing: liveStorage || savedPayload.storagePricing,
    pembAddOns: body.pembAddOns || savedPayload.pembAddOns,
    concrete: body.concrete || body.concreteAddon || savedPayload.concrete,
    insulation: body.insulation || body.insulationAddon || savedPayload.insulation,
    salesTax: body.salesTax || savedPayload.salesTax,
    staircase: body.staircase || body.multiStory || savedPayload.staircase,
    multiStory: body.multiStory || savedPayload.multiStory,
    // Prefer body override only when FE actually sends sell dollars / applied:true.
    // Empty `{ applied: false }` defaults must not wipe a saved material sell lock.
    cogsOverride: (() => {
      const bodyHasSellIntent =
        body.materialSellOverride != null ||
        body.matSellOverride != null ||
        body.matLockSell != null ||
        body.cogsOverride?.materialSellOverride != null ||
        body.cogsOverride?.sellDollar != null ||
        body.cogsOverride?.applied === true
      const bodyClearsOnly =
        body.cogsOverride &&
        body.cogsOverride.applied === false &&
        !bodyHasSellIntent
      if (bodyClearsOnly) return savedPayload.cogsOverride || null
      const sourceOverride = bodyHasSellIntent
        ? body.cogsOverride
        : body.cogsOverride !== undefined && body.cogsOverride !== null
          ? body.cogsOverride
          : savedPayload.cogsOverride
      return (
        normalizeCogsOverrideInput(sourceOverride, {
          ...savedPayload,
          ...body,
          materialSellOverride:
            body.materialSellOverride ??
            body.matSellOverride ??
            body.matLockSell ??
            savedPayload.materialSellOverride ??
            savedPayload.cogsOverride?.materialSellOverride,
        }) ||
        savedPayload.cogsOverride ||
        null
      )
    })(),
    materialSellOverride:
      body.materialSellOverride ??
      body.matSellOverride ??
      body.matLockSell ??
      savedPayload.materialSellOverride ??
      savedPayload.cogsOverride?.materialSellOverride ??
      null,
    pembDrawings: firstDefined(
      body.pembDrawings,
      body.engineeringDrawings,
      body.drawingsOverride,
      typeof body.drawings === 'number' ? body.drawings : undefined,
      savedPayload.pembDrawings,
    ),
    steelFinish: firstDefined(
      body.steelFinish,
      body.finishType,
      body.finish,
      savedPayload.steelFinish,
    ),
    milestoneSchedule: nonEmptyMilestoneRows(
      body.milestoneSchedule,
      body.milestones,
      savedPayload.milestoneSchedule,
      savedPayload.milestones,
    ),
    milestones: nonEmptyMilestoneRows(
      body.milestones,
      body.milestoneSchedule,
      savedPayload.milestones,
      savedPayload.milestoneSchedule,
    ),
    milestoneNote: body.milestoneNote ?? savedPayload.milestoneNote ?? '',
    depositTerms: body.depositTerms || savedPayload.depositTerms || null,
    companyBrand: firstDefined(
      body.companyBrand,
      body.company,
      body.brand,
      body.logoBrand,
      savedPayload.companyBrand,
      savedPayload.company,
    ),
    company: firstDefined(
      body.company,
      body.companyBrand,
      body.brand,
      body.logoBrand,
      savedPayload.company,
      savedPayload.companyBrand,
    ),
    companyLogoUrl: firstDefined(
      body.companyLogoUrl,
      body.logoUrl,
      body.logoSrc,
      savedPayload.companyLogoUrl,
    ),
    contract: body.contract || body.contractDetails || savedPayload.contract,
    sections: undefined,
  }
}

/**
 * Apply live Recompute / drawings / finish onto a document payload.
 * Shared by HTML preview and PDF so both stay in sync before save.
 */
const applyLiveDocumentRebuild = async (userId, payload, body = {}) => {
  const cats = body.parsedCategories || body.categories || payload.parsedCategories
  const options = normalizeQuoteOptions({ ...payload, ...body })
  const livePricing = payload.pricingResult || payload.pricing || payload.fullQuote?.pricing
  const explicitDrawings = bodyHasExplicitDrawings(body)
  const explicitFinish = bodyHasExplicitFinish(body)
  const drawingsChanged =
    explicitDrawings &&
    options.pembDrawings !== (Number(livePricing?.pembDrawings) || 0)
  const finishChanged =
    explicitFinish &&
    Boolean(livePricing?.steelFinish) &&
    options.steelFinish !== livePricing.steelFinish
  const liveControlsTouched =
    body.installCostPerSf != null ||
    body.sellPerSf != null ||
    body.install != null ||
    body.installLevel != null ||
    body.scope != null ||
    body.roof != null ||
    body.roofType != null ||
    body.blendPct != null ||
    body.matMuOverride != null ||
    body.matMuPct != null ||
    body.freightOverride != null
  const savedCogs = normalizeCogsOverrideInput(payload.cogsOverride, payload)
  const wantsRecompute =
    body.recompute === true ||
    body.recompute === 'true' ||
    body.materialSellOverride != null ||
    body.matSellOverride != null ||
    body.matLockSell != null ||
    body.cogsOverride?.applied ||
    body.cogsOverride?.materialSellOverride != null ||
    body.cogsOverride?.sellDollar != null ||
    Boolean(savedCogs?.applied) ||
    drawingsChanged ||
    finishChanged ||
    liveControlsTouched ||
    (explicitDrawings && pickPembDrawings(body, body.quoteControls || {}) > 0) ||
    explicitFinish

  let next = payload
  if (cats && wantsRecompute) {
    const fullExtras = normalizeFullQuoteExtras({ ...payload, ...body }, options)
    const built = await buildPricingPayload(userId, {
      categories: cats,
      options,
      fullExtras,
    })
    next = {
      ...payload,
      pricingResult: built.pricing,
      pricing: built.pricing,
      fullQuote: built.fullQuote,
      fullQuoteResult: built.fullQuote,
      grandTotal: built.fullQuote?.grandTotal,
      salesTax: built.fullQuote?.salesTax ?? payload.salesTax,
      concrete: built.fullQuote?.concrete ?? payload.concrete,
      insulation: built.fullQuote?.insulation ?? payload.insulation,
      weightByCategory: built.weightByCategory,
      parsedCategories: built.parsedCategories,
      steelFinish: options.steelFinish,
      pembDrawings: options.pembDrawings,
    }
  } else if (livePricing && (drawingsChanged || finishChanged)) {
    const patched = applyPembDrawingsToPricing(
      livePricing,
      explicitDrawings
        ? options.pembDrawings
        : Number(livePricing.pembDrawings) || 0,
      explicitFinish ? options.steelFinish : livePricing.steelFinish,
    )
    const deltaGrand =
      (Number(patched.totSell) || 0) - (Number(livePricing.totSell) || 0)
    const nextFull = {
      ...(payload.fullQuote || {}),
      pricing: patched,
      grandTotal: Math.round(
        (Number(payload.grandTotal ?? payload.fullQuote?.grandTotal ?? livePricing.totSell) || 0) +
          deltaGrand,
      ),
    }
    next = {
      ...payload,
      pricingResult: patched,
      pricing: patched,
      fullQuote: nextFull,
      fullQuoteResult: nextFull,
      grandTotal: nextFull.grandTotal,
      steelFinish: patched.steelFinish || options.steelFinish,
      pembDrawings: Number(patched.pembDrawings) || options.pembDrawings,
    }
  }
  return next
}

exports.previewDocuments = asyncHandler(async (req, res) => {
  let payload = req.body
  const estimateId = resolveEstimateIdFromReq(req)

  if (estimateId) {
    const estimate = await EstimateQuote.findById(estimateId).lean()
    if (!estimate) return notFound(res, 'Estimate not found')
    const access = assertEstimateAccess(estimate, req.user)
    if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
    const saved = estimateToDocumentPayload(estimate)
    // History often sends only { estimateId }; hydrate full quote + milestones from DB.
    // Live recompute fields in body still win when present.
    payload = mergeLiveDocumentPayload(saved, { ...req.body, estimateId })
  }

  payload = await applyLiveDocumentRebuild(req.user._id, payload, req.body)

  if (!hasDocumentPricing(payload)) {
    return badRequest(res, 'pricingResult, storagePricingResult, fullQuote, or estimateId required')
  }

  const sections = req.body.sections || ['quote', 'sow', 'contract', 'drawings']
  const milestoneSchedule = nonEmptyMilestoneRows(
    payload.milestoneSchedule,
    payload.milestones,
  )
  return success(res, {
    estimateId: payload.estimateId || estimateId || null,
    quoteHtml: sections.includes('quote') ? generateQuoteHtml(payload) : null,
    sowHtml: sections.includes('sow') ? generateSowHtml(payload) : null,
    contractHtml: sections.includes('contract') ? generateContractHtml(payload) : null,
    assembledHtml: generateAssembledHtml({ ...payload, sections }),
    pricing: payload.pricingResult || payload.pricing || payload.fullQuote?.pricing || null,
    fullQuote: payload.fullQuote || null,
    grandTotal: payload.grandTotal ?? payload.fullQuote?.grandTotal ?? null,
    originalContractValue: payload.originalContractValue ?? null,
    revisedContractTotal: payload.revisedContractTotal ?? null,
    milestoneSchedule,
    milestones: milestoneSchedule,
    milestoneNote: payload.milestoneNote || '',
    depositTerms: payload.depositTerms || null,
    companyBrand: payload.companyBrand || payload.company || null,
    company: payload.company || payload.companyBrand || null,
  })
})

exports.generateQuotePdf = asyncHandler(async (req, res) => {
  let payload = req.body
  const estimateId = resolveEstimateIdFromReq(req)

  if (estimateId) {
    const estimate = await EstimateQuote.findById(estimateId).lean()
    if (!estimate) return notFound(res, 'Estimate not found')
    const access = assertEstimateAccess(estimate, req.user)
    if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
    payload = mergeLiveDocumentPayload(estimateToDocumentPayload(estimate), {
      ...req.body,
      estimateId,
    })
  }

  // Same live rebuild as HTML preview — PDF must not lag until save.
  payload = await applyLiveDocumentRebuild(req.user._id, payload, req.body)

  if (!hasDocumentPricing(payload)) {
    return badRequest(res, 'pricingResult, storagePricingResult, or estimateId required')
  }

  try {
    const pdfBuffer = await generateQuotePdf({
      ...payload,
      sections: req.body.sections || ['quote', 'sow', 'contract', 'drawings'],
    })
    return success(res, {
      fileName: `${payload.leadCompanyName || 'quote'}-assembled.pdf`.replace(/[^\w.-]+/g, '_'),
      mimeType: 'application/pdf',
      fileBase64: pdfBuffer.toString('base64'),
      sizeBytes: pdfBuffer.length,
    })
  } catch (err) {
    return badRequest(res, `PDF generation failed: ${err.message}`)
  }
})

exports.createEstimateQuote = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  const { error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const options = normalizeQuoteOptions(req.body)
  const fullExtras = normalizeFullQuoteExtras(req.body, options)
  let pricing = req.body.pricingResult || null
  let weightByCategory = req.body.weightByCategory || []
  let parsedCategories = req.body.parsedCategories || null
  let fullQuote = req.body.fullQuoteResult || req.body.fullQuote || null

  if (parsedCategories && !pricing) {
    const built = await buildPricingPayload(req.user._id, {
      categories: parsedCategories,
      options,
      fullExtras,
    })
    pricing = built.pricing
    weightByCategory = built.weightByCategory
    fullQuote = built.fullQuote
  } else if (pricing) {
    fullQuote =
      req.body.fullQuoteResult ||
      req.body.fullQuote ||
      computeFullPembQuote(pricing, { ...fullExtras, sf: options.sf })
  }

  const estimateData = {
    createdBy: req.user._id,
    leadId: leadId || null,
    jobType: options.jobType,
    scope: toStoredScope(options.scope),
    roofType: options.roof,
    installLevel: options.install,
    blendPct: options.blendPct,
    leadCompanyName: req.body.leadCompanyName || '',
    customerEmail: req.body.customerEmail || '',
    streetAddress: req.body.streetAddress || '',
    cityStateZip: req.body.cityStateZip || '',
    buildingSize: req.body.buildingSize || '',
    squareFootage: options.sf,
    jobNumber: req.body.jobNumber || '',
    quoteDate: req.body.quoteDate,
    installCostPerSf: options.installCostPerSf ?? req.body.installCostPerSf ?? 0,
    sellPerSf: options.sellPerSf ?? req.body.sellPerSf ?? 0,
    sourceFileName: req.body.sourceFileName || req.body.fileName || '',
    extractedDrawingFields: req.body.extractedDrawingFields || req.body.extracted || null,
    parsedCategories,
    tabSummary: req.body.tabSummary || [],
    breakdownRows: pricing?.rows || req.body.breakdownRows || [],
    pricingResult: pricing,
    storageData: req.body.storageData || null,
    storagePricingResult: req.body.storagePricingResult || req.body.storagePricing || null,
    concreteAddon: fullQuote?.concrete || req.body.concreteAddon || null,
    insulationAddon: fullQuote?.insulation || req.body.insulationAddon || null,
    salesTax: fullQuote?.salesTax || req.body.salesTax || null,
    // Always persist normalized override (top-level materialSellOverride alone must stick).
    cogsOverride: fullExtras.cogsOverride || null,
    marginOverride: req.body.marginOverride || null,
    pembAddOns: req.body.pembAddOns || [],
    quoteControls: (() => {
      const base = req.body.quoteControls || {
        steelFinish: options.steelFinish,
        matMuOverride: options.matMuOverride,
        freightOverride: options.freightOverride,
        pembDrawings: options.pembDrawings,
        pembIncludeErection: options.pembIncludeErection,
        deletedRowKeys: options.deletedRowKeys,
      }
      if (fullExtras.cogsOverride?.materialSellOverride != null) {
        return {
          ...base,
          materialSellOverride: fullExtras.cogsOverride.materialSellOverride,
        }
      }
      return base
    })(),
    contractDetails: req.body.contractDetails || req.body.contract || null,
    drawingAttachments: req.body.drawingAttachments || req.body.drawings || [],
    additionalInfo: req.body.additionalInfo || '',
    fullQuoteResult: fullQuote,
    weightByCategory,
    statementOfWork: req.body.statementOfWork || [],
    exclusions: req.body.exclusions || [],
    status: req.body.status || 'draft',
    depositTerms: req.body.depositTerms || null,
    milestoneSchedule: req.body.milestoneSchedule || req.body.milestones || [],
    milestoneNote: req.body.milestoneNote || '',
    multiStory:
      req.body.multiStory ||
      (fullQuote?.staircase?.include
        ? {
            stories: fullQuote.staircase.stories,
            staircaseCount: fullQuote.staircase.count,
            staircaseUnitCost: fullQuote.staircase.unitCost,
            staircaseSell: fullQuote.staircase.staircaseSell,
          }
        : null),
    companyBrand: req.body.companyBrand || req.body.company || 'SM',
    companyLogoUrl: req.body.companyLogoUrl || '',
    employeeName: req.user.name || '',
    employeeRole: req.user.role || '',
  }

  const estimate = await EstimateQuote.create(estimateData)
  if (estimate.jobType === 'Storage' || estimate.storageData?.buildings?.length) {
    const storageData = estimate.storageData
    const storagePricing =
      storageData?.buildings?.length
        ? computeStoragePricing(storageData, {
            ...fullExtras,
            shipping: req.body.shipping ?? storageData.shipping ?? estimate.storagePricingResult?.shipping,
            drawings: req.body.drawings ?? storageData.drawings ?? estimate.storagePricingResult?.drawings,
            installSellPerSf:
              req.body.installSellPerSf ??
              storageData.installSellPerSf ??
              estimate.storagePricingResult?.installSellPerSf,
            installCostPerSf:
              req.body.installCostPerSf ??
              storageData.installCostPerSf ??
              estimate.storagePricingResult?.installCostPerSf,
            salesTax: req.body.salesTax ?? estimate.salesTax ?? storageData.salesTax,
            concrete: estimate.concreteAddon || storageData.concrete,
            insulation: estimate.insulationAddon || storageData.insulation,
            totalSqft: estimate.squareFootage || estimate.storagePricingResult?.totalSqft,
          })
        : estimate.storagePricingResult
    if (storagePricing) applyStorageEstimateTotals(estimate, storagePricing)
  } else {
    // Prefer post-override pricing when Material Sell Override is applied.
    const pricingForSave =
      fullExtras.cogsOverride?.applied && fullQuote?.pricing ? fullQuote.pricing : pricing
    applyEstimateTotals(estimate, { pricing: pricingForSave, fullQuote })
  }
  rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  await estimate.save()

  return created(res, { estimate: withEstimateTotals(estimate.toObject()) })
})

exports.getEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId).lean()
  if (!estimate) return notFound(res, 'Estimate not found')
  const access = assertEstimateAccess(estimate, req.user)
  if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  const quotation = await Quotation.findOne({ sourceEstimateId: estimate._id })
    .select('_id quoteNumber status approval createdAt')
    .sort({ createdAt: -1 })
    .lean()
  return success(res, {
    estimate: {
      ...withEstimateTotals(estimate),
      conversion: buildEstimateConversionMeta(quotation),
    },
  })
})

exports.updateEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId)
  if (!estimate) return notFound(res, 'Estimate not found')
  const access = assertEstimateAccess(estimate, req.user)
  if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  if (estimate.status !== 'draft') return badRequest(res, 'Only draft estimates can be edited')

  const options = normalizeQuoteOptions({ ...estimate.toObject(), ...req.body })
  // Merge saved override into normalize so top-level materialSellOverride alone still applies.
  const fullExtras = normalizeFullQuoteExtras(
    {
      ...estimate.toObject(),
      ...req.body,
      materialSellOverride:
        req.body.materialSellOverride ??
        req.body.matSellOverride ??
        req.body.matLockSell ??
        estimate.cogsOverride?.materialSellOverride,
      cogsOverride:
        req.body.cogsOverride !== undefined ? req.body.cogsOverride : estimate.cogsOverride,
    },
    options,
  )

  const EDITABLE = [
    'jobType', 'scope', 'roofType', 'installLevel', 'blendPct', 'leadCompanyName', 'customerEmail',
    'streetAddress', 'cityStateZip', 'buildingSize', 'squareFootage', 'jobNumber', 'quoteDate',
    'installCostPerSf', 'sellPerSf', 'sourceFileName', 'extractedDrawingFields', 'parsedCategories',
    'tabSummary', 'breakdownRows', 'pricingResult', 'storageData', 'storagePricingResult',
    'concreteAddon', 'insulationAddon', 'salesTax', 'marginOverride',
    'pembAddOns', 'quoteControls',
    'contractDetails', 'drawingAttachments', 'additionalInfo', 'fullQuoteResult',
    'statementOfWork', 'exclusions', 'status',
    'depositTerms', 'milestoneSchedule', 'milestoneNote', 'multiStory',
    'companyBrand', 'companyLogoUrl',
  ]
  EDITABLE.forEach((k) => {
    if (k === 'scope') return
    if (req.body[k] !== undefined) estimate[k] = req.body[k]
  })
  if (req.body.scope !== undefined) estimate.scope = toStoredScope(req.body.scope)
  else estimate.scope = toStoredScope(estimate.scope)

  if (req.body.roof !== undefined) estimate.roofType = req.body.roof
  if (req.body.install !== undefined) estimate.installLevel = req.body.install
  if (req.body.sf !== undefined) estimate.squareFootage = Number(req.body.sf) || 0
  if (req.body.contract !== undefined) estimate.contractDetails = req.body.contract
  if (req.body.drawings !== undefined) estimate.drawingAttachments = req.body.drawings

  // Persist normalized Material Sell / COGS override (do not store raw body-only blob).
  if (
    req.body.cogsOverride !== undefined ||
    req.body.materialSellOverride != null ||
    req.body.matSellOverride != null ||
    req.body.matLockSell != null
  ) {
    estimate.cogsOverride = fullExtras.cogsOverride || null
    if (estimate.cogsOverride?.materialSellOverride != null) {
      estimate.quoteControls = {
        ...(estimate.quoteControls && typeof estimate.quoteControls === 'object'
          ? estimate.quoteControls.toObject
            ? estimate.quoteControls.toObject()
            : estimate.quoteControls
          : {}),
        materialSellOverride: estimate.cogsOverride.materialSellOverride,
      }
    }
  }

  const jobType = req.body.jobType || estimate.jobType
  const isStorageJob =
    jobType === 'Storage' ||
    !!(req.body.storageData?.buildings?.length || estimate.storageData?.buildings?.length)
  const cats = req.body.parsedCategories || estimate.parsedCategories

  // Storage: always recompute from storageData when present (same as PEMB from categories).
  if (isStorageJob && (req.body.storageData || estimate.storageData || req.body.storagePricingResult)) {
    const storageData = req.body.storageData || estimate.storageData
    const priorSp = estimate.storagePricingResult || {}
    let storagePricing
    if (storageData?.buildings?.length) {
      storagePricing = computeStoragePricing(storageData, {
        ...fullExtras,
        shipping:
          req.body.shipping ??
          storageData.shipping ??
          priorSp.shipping,
        drawings:
          req.body.drawings ??
          storageData.drawings ??
          priorSp.drawings,
        installSellPerSf:
          req.body.installSellPerSf ??
          storageData.installSellPerSf ??
          priorSp.installSellPerSf,
        installCostPerSf:
          req.body.installCostPerSf ??
          storageData.installCostPerSf ??
          priorSp.installCostPerSf,
        salesTax: req.body.salesTax ?? estimate.salesTax ?? storageData.salesTax,
        concrete:
          req.body.concrete ||
          req.body.concreteAddon ||
          estimate.concreteAddon ||
          storageData.concrete,
        insulation:
          req.body.insulation ||
          req.body.insulationAddon ||
          estimate.insulationAddon ||
          storageData.insulation,
        totalSqft:
          req.body.squareFootage ??
          req.body.sf ??
          estimate.squareFootage ??
          priorSp.totalSqft,
      })
    } else {
      storagePricing = req.body.storagePricingResult || estimate.storagePricingResult
    }
    // Explicit FE-computed snapshot wins only when no buildings payload to reprice.
    if (req.body.storagePricingResult && !storageData?.buildings?.length) {
      storagePricing = req.body.storagePricingResult
    }
    applyStorageEstimateTotals(estimate, storagePricing)
    rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  } else if (cats) {
    const payload = await buildPricingPayload(req.user._id, {
      categories: cats,
      options,
      fullExtras,
    })
    estimate.parsedCategories = cats
    estimate.weightByCategory = payload.weightByCategory
    applyEstimateTotals(estimate, payload)
    rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  } else if (req.body.pricingResult) {
    const fullQuote =
      req.body.fullQuoteResult ||
      computeFullPembQuote(req.body.pricingResult, {
        ...fullExtras,
        sf: options.sf,
      })
    const pricingForSave =
      fullExtras.cogsOverride?.applied && fullQuote?.pricing
        ? fullQuote.pricing
        : req.body.pricingResult
    applyEstimateTotals(estimate, { pricing: pricingForSave, fullQuote })
    rescalePaymentsForGrand(estimate, resolveEstimateGrandTotal(estimate))
  }

  await estimate.save()
  const quotationSync = await syncLinkedQuotationFromUpdatedEstimate({
    estimate,
    user: req.user,
  })
  const linkedQuotation = quotationSync.quotation
    ? quotationSync.quotation.toObject
      ? quotationSync.quotation.toObject()
      : quotationSync.quotation
    : null
  return success(res, {
    estimate: {
      ...withEstimateTotals(estimate.toObject()),
      conversion: buildEstimateConversionMeta(linkedQuotation),
    },
    quotationSync: {
      synced: Boolean(quotationSync.synced),
      skippedReason: quotationSync.skippedReason || null,
      quotationStatus: linkedQuotation?.status || null,
      approvalStatus: quotationSync.approvalStatus || linkedQuotation?.approval?.status || null,
      workflowStatus: quotationSync.workflowStatus || null,
      versionNumber: linkedQuotation?.versionNumber || null,
      reopenedFromSent: Boolean(quotationSync.reopenedFromSent),
      requiresSubmitForApproval: Boolean(quotationSync.requiresSubmitForApproval),
      quotationId: linkedQuotation?._id || null,
    },
  })
})

exports.deleteEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId)
  if (!estimate) return notFound(res, 'Estimate not found')
  const access = assertEstimateAccess(estimate, req.user)
  if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  await EstimateQuote.findByIdAndDelete(req.params.estimateId)
  return success(res, {}, 'Estimate deleted')
})

exports.listEstimateQuotes = asyncHandler(async (req, res) => {
  const { jobType, status, search, leadId, page = 1, limit = 20 } = req.query
  const filter = {}
  if (req.user.role === 'sales') filter.createdBy = req.user._id
  if (jobType) filter.jobType = jobType
  if (status) filter.status = status
  if (leadId) filter.leadId = leadId
  if (search) filter.leadCompanyName = { $regex: search, $options: 'i' }

  const parsedPage = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1)
  const skip = (parsedPage - 1) * parsedLimit

  const [estimates, total] = await Promise.all([
    EstimateQuote.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .select('-drawingAttachments -parsedCategories -breakdownRows -tabSummary -storageData -weightByCategory')
      .lean(),
    EstimateQuote.countDocuments(filter),
  ])

  const estimateIds = estimates.map((row) => row._id)
  const quotations = estimateIds.length
    ? await Quotation.find({ sourceEstimateId: { $in: estimateIds } })
        .select('_id sourceEstimateId quoteNumber status approval createdAt')
        .sort({ createdAt: -1 })
        .lean()
    : []
  const quotationByEstimateId = new Map()
  for (const row of quotations) {
    const key = String(row.sourceEstimateId || '')
    if (!key || quotationByEstimateId.has(key)) continue
    quotationByEstimateId.set(key, row)
  }

  return success(res, {
    estimates: estimates.map((estimate) => ({
      ...withEstimateListTotals(estimate),
      conversion: buildEstimateConversionMeta(
        quotationByEstimateId.get(String(estimate._id))
      ),
    })),
    total,
    page: parsedPage,
    limit: parsedLimit,
  })
})

const rangeStats = async (userId, from) => {
  const filter = { ...(from ? { createdAt: { $gte: from } } : {}) }
  if (userId) filter.createdBy = userId
  const rows = await EstimateQuote.find(filter).lean()
  const totalQuotes = rows.length
  const totalValue = rows.reduce((s, r) => s + toNumber(resolveEstimateGrandTotal(r)), 0)
  const totalProfit = rows.reduce((s, r) => s + (r.profit || 0), 0)
  const avgMargin = totalQuotes > 0 ? rows.reduce((s, r) => s + (r.marginPercent || 0), 0) / totalQuotes : 0
  return {
    totalQuotes,
    totalValue: Math.round(totalValue * 100) / 100,
    totalProfit: Math.round(totalProfit * 100) / 100,
    avgMargin: Math.round(avgMargin * 100) / 100,
  }
}

exports.getQuoteHistorySummary = asyncHandler(async (req, res) => {
  const now = new Date()
  const userFilter = req.user.role === 'sales' ? req.user._id : null
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const [thisMonth, thisQuarter, ytd, allTime] = await Promise.all([
    rangeStats(userFilter, startOfMonth),
    rangeStats(userFilter, startOfQuarter),
    rangeStats(userFilter, startOfYear),
    rangeStats(userFilter, null),
  ])

  const mongoose = require('mongoose')
  const match = userFilter ? { createdBy: new mongoose.Types.ObjectId(userFilter) } : {}
  const byJobType = await EstimateQuote.aggregate([
    { $match: match },
    { $group: { _id: '$jobType', totalProfit: { $sum: '$profit' }, count: { $sum: 1 } } },
  ])
  const profitByCategory = byJobType.map((r) => ({
    jobType: r._id,
    totalProfit: Math.round(r.totalProfit * 100) / 100,
    count: r.count,
  }))

  return success(res, { thisMonth, thisQuarter, ytd, allTime, profitByCategory })
})
