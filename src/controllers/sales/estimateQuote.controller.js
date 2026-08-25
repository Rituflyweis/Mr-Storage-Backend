const PricingRules = require('../../models/PricingRules')
const EstimateQuote = require('../../models/EstimateQuote')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { buildPricingRates } = require('../../services/quoting/pricingRulesAdapter')
const { parseShipperBuffer, parseShipperCoverSheet } = require('../../services/quoting/shipperParser')
const { categoriesToWeightByCategory } = require('../../services/quoting/pricingEngine')
const { extractDrawingPdfBuffer } = require('../../services/quoting/drawingPdfExtractor')
const { parseStorageCogBuffer } = require('../../services/quoting/storageCogParser')
const { buildAndComputeFullPembQuote, computeFullPembQuote } = require('../../services/quoting/quotePricingOrchestrator')
const { computeStoragePricing } = require('../../services/quoting/storagePricingEngine')
const { previewCogsOverride } = require('../../services/quoting/cogsOverride')
const { previewMarginOverride } = require('../../services/quoting/marginOverride')
const { lookupSalesTaxByZip } = require('../../services/quoting/salesTaxLookup')
const {
  generateAssembledHtml,
  generateQuoteHtml,
  generateSowHtml,
  generateContractHtml,
  generateQuotePdf,
} = require('../../services/quoting/quoteDocumentGenerator')

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

const normalizeQuoteOptions = (body = {}) => {
  const scopeRaw = String(body.scope || 'both').toLowerCase()
  const scope = ['supply', 'install', 'both'].includes(scopeRaw) ? scopeRaw : 'both'
  return {
    jobType: body.jobType || 'PEMB',
    scope,
    roof: body.roof || body.roofType || 'screw-down',
    install: body.install || body.installLevel || 'medium',
    sf: Number(body.squareFootage || body.sf || body.buildingSf || 0) || 0,
    blendPct: body.blendPct !== undefined ? Number(body.blendPct) : 50,
    installCostPerSf: body.installCostPerSf !== undefined ? Number(body.installCostPerSf) : undefined,
    sellPerSf: body.sellPerSf !== undefined ? Number(body.sellPerSf) : undefined,
  }
}

const normalizeFullQuoteExtras = (body = {}) => ({
  concrete: body.concrete || body.concreteAddon || null,
  insulation: body.insulation || body.insulationAddon || null,
  salesTax: body.salesTax || null,
  cogsOverride: body.cogsOverride || null,
  marginOverride: body.marginOverride || null,
})

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
    extras.marginOverride?.applied

  let fullQuote = null
  let pricing

  if (hasExtras) {
    fullQuote = buildAndComputeFullPembQuote(categories, engineOptions, extras)
    pricing = fullQuote.pricing
  } else {
    const { priceJob } = require('../../services/quoting/pricingEngine')
    pricing = priceJob(categories, engineOptions)
  }

  const weightByCategory = categoriesToWeightByCategory(categories, pr)

  return {
    pricing,
    weightByCategory,
    parsedCategories: categories,
    fullQuote,
  }
}

const estimateToDocumentPayload = (estimate) => ({
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
  grandTotal: estimate.totalSell,
  fullQuote: estimate.fullQuoteResult || {
    pricing: estimate.pricingResult,
    concrete: estimate.concreteAddon,
    insulation: estimate.insulationAddon,
    salesTax: estimate.salesTax,
    grandTotal: estimate.totalSell,
    pricePerSf: estimate.pricePerSf,
  },
  concrete: estimate.concreteAddon,
  insulation: estimate.insulationAddon,
  salesTax: estimate.salesTax,
  contract: estimate.contractDetails,
  drawingAttachments: estimate.drawingAttachments,
  customer: {
    name: estimate.leadCompanyName,
    address: estimate.streetAddress,
    location: estimate.cityStateZip,
    email: estimate.customerEmail,
  },
})

const hasDocumentPricing = (payload = {}) =>
  Boolean(
    payload.pricingResult ||
      payload.fullQuote?.pricing ||
      payload.storagePricingResult ||
      payload.storagePricing ||
      payload.jobType === 'Storage'
  )

const applyEstimateTotals = (estimate, payload) => {
  const { pricing, fullQuote } = payload
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

  if (fullQuote) {
    estimate.fullQuoteResult = fullQuote
    estimate.concreteAddon = fullQuote.concrete
    estimate.insulationAddon = fullQuote.insulation
    estimate.salesTax = fullQuote.salesTax
    estimate.totalSell = fullQuote.grandTotal ?? pricing.totSell ?? 0
    estimate.pricePerSf = fullQuote.pricePerSf ? Number(fullQuote.pricePerSf) : null
    estimate.profit = fullQuote.totalProfit ?? estimate.profit
    estimate.marginPercent = fullQuote.grandMargin ?? estimate.marginPercent
  } else {
    estimate.totalSell = pricing.totSell ?? 0
    estimate.pricePerSf = pricing.sfPrice ? Number(pricing.sfPrice) : null
  }
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

exports.extractShipperFile = asyncHandler(async (req, res) => {
  const buffer = decodeBase64File(req.body.fileBase64)
  if (!buffer?.length) return badRequest(res, 'fileBase64 required')

  const options = normalizeQuoteOptions(req.body)
  const fullExtras = normalizeFullQuoteExtras(req.body)
  const rulesDoc = await getOrCreatePricingRules(req.user._id)
  const { customTabRules } = buildPricingRates(rulesDoc)

  const parsed = parseShipperBuffer(buffer, { sf: options.sf, customTabRules })
  const cover = parseShipperCoverSheet(parsed.workbook)

  const autoSf =
    parsed.totalWeightLbs > 0 ? Math.round(parsed.totalWeightLbs / 9) : 0
  // Fresh shipper upload: derive SF from weight unless client explicitly locked manual SF
  const sf =
    req.body.useManualSquareFootage && options.sf > 0
      ? options.sf
      : autoSf || options.sf || 0

  const payload = await buildPricingPayload(req.user._id, {
    categories: parsed.categories,
    options: { ...options, sf },
    fullExtras,
  })

  return success(res, {
    fileName: req.body.fileName || '',
    sheetCount: parsed.sheetCount,
    tabSummary: parsed.tabSummary,
    totalWeightLbs: Math.round(parsed.totalWeightLbs * 100) / 100,
    squareFootage: sf,
    parsedCategories: parsed.categories,
    coverSheet: cover.coverName
      ? { coverName: cover.coverName, labelMap: cover.labelMap, preview: cover.allText.substring(0, 2000) }
      : null,
    weightByCategory: payload.weightByCategory,
    pricing: payload.pricing,
    fullQuote: payload.fullQuote,
    note: 'Parsed using Storage Materials quoting tool rules — review categories and pricing before saving.',
  })
})

exports.extractStorageCog = asyncHandler(async (req, res) => {
  const buffer = decodeBase64File(req.body.fileBase64)
  if (!buffer?.length) return badRequest(res, 'fileBase64 required')

  const data = parseStorageCogBuffer(buffer)
  const storagePricing = computeStoragePricing(
    {
      buildings: data.buildings,
      doors: data.doors,
      extras: data.extras,
      shipping: data.shippingDefault ?? 12000,
      installSellPerSf: req.body.installSellPerSf ?? 3.25,
      installCostPerSf: req.body.installCostPerSf ?? 2.5,
    },
    normalizeFullQuoteExtras(req.body)
  )

  return success(res, {
    fileName: req.body.fileName || '',
    ...data,
    storagePricing,
    note:
      data.format === 'vendor_cog'
        ? 'Vendor COG quote parsed (manufacturer + COGS tab) — review buildings, extras, and markup before saving.'
        : 'Storage COG sheet parsed — review buildings, doors, and extras before saving.',
  })
})

exports.computeQuote = asyncHandler(async (req, res) => {
  const { parsedCategories, categories } = req.body
  const cats = parsedCategories || categories
  if (!cats) return badRequest(res, 'parsedCategories required')

  const options = normalizeQuoteOptions(req.body)
  const fullExtras = normalizeFullQuoteExtras(req.body)
  const payload = await buildPricingPayload(req.user._id, {
    categories: cats,
    options,
    fullExtras,
  })

  return success(res, {
    weightByCategory: payload.weightByCategory,
    pricing: payload.pricing,
    fullQuote: payload.fullQuote,
  })
})

exports.computeStorageQuote = asyncHandler(async (req, res) => {
  const storageData = req.body.storageData
  if (!storageData?.buildings?.length) {
    return badRequest(res, 'storageData.buildings required')
  }

  const fullExtras = normalizeFullQuoteExtras(req.body)
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

  const preview = previewCogsOverride(pricing, req.body.cogsOverride || req.body)
  return success(res, { preview })
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

exports.previewDocuments = asyncHandler(async (req, res) => {
  let payload = req.body

  if (req.body.estimateId) {
    const estimate = await EstimateQuote.findById(req.body.estimateId).lean()
    if (!estimate) return notFound(res, 'Estimate not found')
    const access = assertEstimateAccess(estimate, req.user)
    if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
    payload = estimateToDocumentPayload(estimate)
  }

  if (!hasDocumentPricing(payload)) {
    return badRequest(res, 'pricingResult, storagePricingResult, or fullQuote required')
  }

  const sections = req.body.sections || ['quote', 'sow', 'contract', 'drawings']
  return success(res, {
    quoteHtml: sections.includes('quote') ? generateQuoteHtml(payload) : null,
    sowHtml: sections.includes('sow') ? generateSowHtml(payload) : null,
    contractHtml: sections.includes('contract') ? generateContractHtml(payload) : null,
    assembledHtml: generateAssembledHtml({ ...payload, sections }),
  })
})

exports.generateQuotePdf = asyncHandler(async (req, res) => {
  let payload = req.body

  if (req.body.estimateId) {
    const estimate = await EstimateQuote.findById(req.body.estimateId).lean()
    if (!estimate) return notFound(res, 'Estimate not found')
    const access = assertEstimateAccess(estimate, req.user)
    if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
    payload = estimateToDocumentPayload(estimate)
  }

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
  const fullExtras = normalizeFullQuoteExtras(req.body)
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
  } else if (pricing && (fullExtras.concrete || fullExtras.insulation || fullExtras.salesTax)) {
    fullQuote = computeFullPembQuote(pricing, { ...fullExtras, sf: options.sf })
  }

  const estimateData = {
    createdBy: req.user._id,
    leadId: leadId || null,
    jobType: options.jobType,
    scope: options.scope === 'supply' ? 'Supply' : options.scope === 'install' ? 'Install' : 'Both',
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
    cogsOverride: req.body.cogsOverride || null,
    marginOverride: req.body.marginOverride || null,
    contractDetails: req.body.contractDetails || req.body.contract || null,
    drawingAttachments: req.body.drawingAttachments || req.body.drawings || [],
    additionalInfo: req.body.additionalInfo || '',
    fullQuoteResult: fullQuote,
    weightByCategory,
    statementOfWork: req.body.statementOfWork || [],
    exclusions: req.body.exclusions || [],
    status: req.body.status || 'draft',
  }

  const estimate = await EstimateQuote.create(estimateData)
  applyEstimateTotals(estimate, { pricing, fullQuote })
  await estimate.save()

  return created(res, { estimate })
})

exports.getEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId).lean()
  if (!estimate) return notFound(res, 'Estimate not found')
  const access = assertEstimateAccess(estimate, req.user)
  if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  return success(res, { estimate })
})

exports.updateEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId)
  if (!estimate) return notFound(res, 'Estimate not found')
  const access = assertEstimateAccess(estimate, req.user)
  if (access.error) return access.code === 404 ? notFound(res, access.error) : forbidden(res, access.error)
  if (estimate.status !== 'draft') return badRequest(res, 'Only draft estimates can be edited')

  const options = normalizeQuoteOptions({ ...estimate.toObject(), ...req.body })
  const fullExtras = normalizeFullQuoteExtras(req.body)

  const EDITABLE = [
    'jobType', 'scope', 'roofType', 'installLevel', 'blendPct', 'leadCompanyName', 'customerEmail',
    'streetAddress', 'cityStateZip', 'buildingSize', 'squareFootage', 'jobNumber', 'quoteDate',
    'installCostPerSf', 'sellPerSf', 'sourceFileName', 'extractedDrawingFields', 'parsedCategories',
    'tabSummary', 'breakdownRows', 'pricingResult', 'storageData', 'storagePricingResult',
    'concreteAddon', 'insulationAddon', 'salesTax', 'cogsOverride', 'marginOverride',
    'contractDetails', 'drawingAttachments', 'additionalInfo', 'fullQuoteResult',
    'statementOfWork', 'exclusions', 'status',
  ]
  EDITABLE.forEach((k) => {
    if (req.body[k] !== undefined) estimate[k] = req.body[k]
  })

  if (req.body.roof !== undefined) estimate.roofType = req.body.roof
  if (req.body.install !== undefined) estimate.installLevel = req.body.install
  if (req.body.sf !== undefined) estimate.squareFootage = Number(req.body.sf) || 0
  if (req.body.contract !== undefined) estimate.contractDetails = req.body.contract
  if (req.body.drawings !== undefined) estimate.drawingAttachments = req.body.drawings

  const cats = req.body.parsedCategories || estimate.parsedCategories
  if (cats) {
    const payload = await buildPricingPayload(req.user._id, {
      categories: cats,
      options,
      fullExtras,
    })
    estimate.parsedCategories = cats
    estimate.weightByCategory = payload.weightByCategory
    applyEstimateTotals(estimate, payload)
  } else if (req.body.storageData) {
    estimate.storagePricingResult = computeStoragePricing(req.body.storageData, {
      ...fullExtras,
      shipping: req.body.shipping,
      drawings: req.body.drawings,
      installSellPerSf: req.body.installSellPerSf,
      installCostPerSf: req.body.installCostPerSf,
    })
    estimate.totalSell = estimate.storagePricingResult.grandTotal
    estimate.pricePerSf = Number(estimate.storagePricingResult.pricePerSf) || null
    estimate.profit = estimate.storagePricingResult.profit
    estimate.marginPercent = estimate.storagePricingResult.marginPercent
  }

  await estimate.save()
  return success(res, { estimate })
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
    EstimateQuote.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
    EstimateQuote.countDocuments(filter),
  ])

  return success(res, { estimates, total, page: parsedPage, limit: parsedLimit })
})

const rangeStats = async (userId, from) => {
  const filter = { ...(from ? { createdAt: { $gte: from } } : {}) }
  if (userId) filter.createdBy = userId
  const rows = await EstimateQuote.find(filter, { totalSell: 1, profit: 1, marginPercent: 1 }).lean()
  const totalQuotes = rows.length
  const totalValue = rows.reduce((s, r) => s + (r.totalSell || 0), 0)
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
