const ExcelJS = require('exceljs')
const { PDFParse } = require('pdf-parse')
const EstimateQuote = require('../../models/EstimateQuote')
const PricingRules = require('../../models/PricingRules')
const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

// Best-effort "TITLE BLOCK" / "BUILDING DIMENSIONS" etc field extraction from a preliminary
// drawing PDF (page 1 only). Labels vary a lot between vendors' drawings, so this is a
// starting point for the user to review/edit before applying — never auto-trusted.
const DRAWING_FIELD_PATTERNS = {
  purchaserCustomer: /purchaser\s*\/?\s*customer\s*[:\-]?\s*(.+)/i,
  projectName:       /project\s*name\s*[:\-]?\s*(.+)/i,
  jobNumber:         /job\s*number\s*[:\-]?\s*(.+)/i,
  locationCityState: /location\s*\/?\s*city\s*,?\s*state\s*[:\-]?\s*(.+)/i,
  date:              /^date\s*[:\-]?\s*(.+)/im,
  width:             /width\s*[:\-]?\s*([\d.']+)/i,
  length:            /length\s*[:\-]?\s*([\d.']+)/i,
  eaveHeight:        /eave\s*height\s*[:\-]?\s*([\d.']+)/i,
  sqFootage:         /sq\.?\s*footage\s*[:\-]?\s*([\d,.']+)/i,
  baySpacing:        /bay\s*spacing\s*[:\-]?\s*(.+)/i,
  roofSlope:         /roof\s*slope\s*[:\-]?\s*([\d./:]+)/i,
  roofDeadLoad:      /roof\s*dead\s*load\s*[:\-]?\s*([\d.]+\s*psf)/i,
  collateralLoad:    /collateral\s*load\s*[:\-]?\s*([\d.]+\s*psf)/i,
  roofLiveLoad:      /roof\s*live\s*load\s*[:\-]?\s*([\d.]+\s*psf)/i,
  roofSnowLoad:      /roof\s*snow\s*load\s*[:\-]?\s*([\d.]+\s*psf)/i,
  groundSnowLoad:    /ground\s*snow\s*load\s*(?:\(pg\))?\s*[:\-]?\s*([\d.]+\s*psf)/i,
  basicWindSpeed:    /basic\s*wind\s*speed\s*[:\-]?\s*([\d.]+\s*mph)/i,
  windExposure:      /wind\s*exposure\s*[:\-]?\s*(exposure\s*[a-c])/i,
  seismicDesignCat:  /seismic\s*design\s*cat\.?\s*[:\-]?\s*(.+)/i,
  buildingCode:      /building\s*code\s*[:\-]?\s*(.+)/i,
}

// Keyword -> canonical weight-by-category bucket, used when no custom tab rule matches.
const DEFAULT_CATEGORY_KEYWORDS = [
  { match: /purlin|girt|eave/i,              category: 'Purlins, Girts & Eave Structs', rateKey: 'secondarySteel' },
  { match: /door|jamb|header/i,              category: 'Door Jambs & Headers',           rateKey: 'openingsJambs' },
  { match: /roof.*sheet|wall.*sheet|panel/i, category: 'Roof & Wall Sheeting',            rateKey: null, sheeting: true },
  { match: /connection|plate|clip/i,         category: 'Connection Plates & Clips',       rateKey: 'platesClips' },
  { match: /trim|flash/i,                    category: 'Trim',                            rateKey: null, bucket: true },
  { match: /cable|brac|sealant/i,            category: 'Cables, Bracing & Sealant',       rateKey: null, bucket: true },
  { match: /rigid frame|primary/i,           category: 'Primary Frames',                  rateKey: 'primaryFrames' },
  { match: /hss|beam/i,                      category: 'HSS Beams',                       rateKey: 'hssBeams' },
  { match: /angle/i,                         category: 'Angles',                          rateKey: 'angles' },
]

const getOrCreatePricingRules = async (userId) => {
  let rules = await PricingRules.findOne({ ownerId: userId })
  if (!rules) rules = await PricingRules.create({ ownerId: userId })
  return rules
}

exports.extractDrawingPdf = asyncHandler(async (req, res) => {
  const { fileBase64, fileName } = req.body
  if (!fileBase64) return badRequest(res, 'fileBase64 required')

  const buffer = Buffer.from(fileBase64, 'base64')
  const parser = new PDFParse({ data: buffer })
  const result = await parser.getText({ first: 1, last: 1 }).catch(() => null)
  await parser.destroy?.()

  const rawText = result?.text || ''
  const extracted = {}
  for (const [field, pattern] of Object.entries(DRAWING_FIELD_PATTERNS)) {
    const m = rawText.match(pattern)
    if (m) extracted[field] = m[1].trim()
  }

  return success(res, {
    fileName: fileName || '',
    extracted,
    rawTextPreview: rawText.slice(0, 4000),
    note: 'Best-effort extraction from page 1 text only — labels vary between drawings, please review before applying.',
  })
})

exports.extractShipperFile = asyncHandler(async (req, res) => {
  const { fileBase64, fileName } = req.body
  if (!fileBase64) return badRequest(res, 'fileBase64 required')

  const rules = await getOrCreatePricingRules(req.user._id)
  const buffer = Buffer.from(fileBase64, 'base64')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const byCategory = {}
  let totalWeight = 0

  const resolveCategory = (tabName, partNo, description) => {
    for (const rule of rules.customTabRules) {
      const haystack = rule.matchAgainst === 'Tab Name' ? tabName
        : rule.matchAgainst === 'Part #' ? partNo : description
      if (rule.valueToMatch && haystack && haystack.toLowerCase().includes(rule.valueToMatch.toLowerCase())) {
        return { category: rule.category || rule.label, rate: rule.rate }
      }
    }
    const text = `${tabName} ${partNo} ${description}`
    for (const kw of DEFAULT_CATEGORY_KEYWORDS) {
      if (kw.match.test(text)) {
        const rate = kw.rateKey ? rules.steelRatesPerLb[kw.rateKey]
          : kw.sheeting ? rules.sheetingRatesPerSf.standardScrewDown
          : rules.freight.accessoriesAllowancePerSf
        return { category: kw.category, rate }
      }
    }
    return { category: 'Misc', rate: rules.steelRatesPerLb.primaryFrames }
  }

  workbook.eachSheet((sheet) => {
    const headerRow = Array.from(sheet.getRow(1).values, v => String(v || '').toLowerCase())
    const weightCol = headerRow.findIndex(h => h.includes('weight') || h.includes('lbs'))
    const partCol   = headerRow.findIndex(h => h.includes('part'))
    const descCol   = headerRow.findIndex(h => h.includes('description') || h.includes('desc'))
    if (weightCol < 1) return

    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return
      const weight = Number(row.getCell(weightCol).value) || 0
      if (!weight) return
      const partNo = partCol > 0 ? String(row.getCell(partCol).value || '') : ''
      const desc = descCol > 0 ? String(row.getCell(descCol).value || '') : ''

      const { category, rate } = resolveCategory(sheet.name, partNo, desc)
      if (!byCategory[category]) byCategory[category] = { category, weightLbs: 0, rate, price: 0, notes: '' }
      byCategory[category].weightLbs += weight
      totalWeight += weight
    })
  })

  const weightByCategory = Object.values(byCategory).map(c => ({
    ...c,
    price: Math.round(c.weightLbs * c.rate * 100) / 100,
  }))

  return success(res, {
    fileName: fileName || '',
    tabs: workbook.worksheets.length,
    totalWeightLbs: Math.round(totalWeight * 100) / 100,
    weightByCategory,
    note: 'Best-effort category classification via pricing-rules custom tab rules + keyword fallback — please review before applying.',
  })
})

const computeEstimate = (payload, rules) => {
  const weightByCategory = (Array.isArray(payload.weightByCategory) ? payload.weightByCategory : []).map(c => ({
    category: c.category,
    weightLbs: Number(c.weightLbs) || 0,
    rate: Number(c.rate) || 0,
    price: Math.round((Number(c.weightLbs) || 0) * (Number(c.rate) || 0) * 100) / 100,
    notes: c.notes || '',
  }))
  const totalWeightLbs = weightByCategory.reduce((s, c) => s + c.weightLbs, 0)
  const materialCost = weightByCategory.reduce((s, c) => s + c.price, 0)

  const trucksRequired = rules.freight.lbsPerTruck > 0 ? Math.ceil(totalWeightLbs / rules.freight.lbsPerTruck) : 0
  const freightCost = totalWeightLbs * rules.freight.ratePerLb

  const totalCOGS = materialCost + freightCost
  const squareFootage = Number(payload.squareFootage) || 0
  const installCost = squareFootage * (Number(payload.installCostPerSf) || 0)

  const markupMultiplier = payload.jobType === 'Storage' ? rules.markup.storageMultiplier : rules.markup.pembMultiplier
  const materialSell = materialCost * markupMultiplier
  const installSell = squareFootage * (Number(payload.sellPerSf) || 0)
  const totalSell = materialSell + freightCost + installSell

  const profit = totalSell - totalCOGS - installCost
  const marginPercent = totalSell > 0 ? (profit / totalSell) * 100 : 0
  const pricePerSf = squareFootage > 0 ? totalSell / squareFootage : null

  return {
    weightByCategory, totalWeightLbs: Math.round(totalWeightLbs * 100) / 100, trucksRequired,
    materialCost: Math.round(materialCost * 100) / 100,
    freightCost: Math.round(freightCost * 100) / 100,
    totalCOGS: Math.round(totalCOGS * 100) / 100,
    installCost: Math.round(installCost * 100) / 100,
    totalSell: Math.round(totalSell * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    marginPercent: Math.round(marginPercent * 100) / 100,
    pricePerSf: pricePerSf !== null ? Math.round(pricePerSf * 100) / 100 : null,
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

exports.createEstimateQuote = asyncHandler(async (req, res) => {
  const { leadId } = req.body
  const { error, code } = await checkLeadAccess(leadId, req.user)
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error)

  const rules = await getOrCreatePricingRules(req.user._id)
  const computed = computeEstimate(req.body, rules)

  const estimate = await EstimateQuote.create({
    createdBy: req.user._id,
    leadId: leadId || null,
    jobType: req.body.jobType,
    scope: req.body.scope,
    roofType: req.body.roofType,
    leadCompanyName: req.body.leadCompanyName,
    customerEmail: req.body.customerEmail,
    streetAddress: req.body.streetAddress,
    cityStateZip: req.body.cityStateZip,
    buildingSize: req.body.buildingSize,
    squareFootage: req.body.squareFootage,
    jobNumber: req.body.jobNumber,
    quoteDate: req.body.quoteDate,
    installCostPerSf: req.body.installCostPerSf,
    sellPerSf: req.body.sellPerSf,
    sourceFileName: req.body.sourceFileName || '',
    extractedDrawingFields: req.body.extractedDrawingFields || null,
    statementOfWork: req.body.statementOfWork || [],
    exclusions: req.body.exclusions || [],
    ...computed,
  })

  return created(res, { estimate })
})

exports.getEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId).lean()
  if (!estimate) return notFound(res, 'Estimate not found')
  if (req.user.role === 'sales' && String(estimate.createdBy) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }
  return success(res, { estimate })
})

exports.updateEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId)
  if (!estimate) return notFound(res, 'Estimate not found')
  if (req.user.role === 'sales' && String(estimate.createdBy) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }
  if (estimate.status !== 'draft') return badRequest(res, 'Only draft estimates can be edited')

  const rules = await getOrCreatePricingRules(req.user._id)
  const merged = { ...estimate.toObject(), ...req.body }
  const computed = computeEstimate(merged, rules)

  const EDITABLE = [
    'jobType', 'scope', 'roofType', 'leadCompanyName', 'customerEmail', 'streetAddress',
    'cityStateZip', 'buildingSize', 'squareFootage', 'jobNumber', 'quoteDate',
    'installCostPerSf', 'sellPerSf', 'sourceFileName', 'extractedDrawingFields',
    'statementOfWork', 'exclusions', 'status',
  ]
  EDITABLE.forEach((k) => { if (req.body[k] !== undefined) estimate[k] = req.body[k] })
  Object.assign(estimate, computed)

  await estimate.save()
  return success(res, { estimate })
})

exports.deleteEstimateQuote = asyncHandler(async (req, res) => {
  const estimate = await EstimateQuote.findById(req.params.estimateId)
  if (!estimate) return notFound(res, 'Estimate not found')
  if (req.user.role === 'sales' && String(estimate.createdBy) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }
  await EstimateQuote.findByIdAndDelete(req.params.estimateId)
  return success(res, {}, 'Estimate deleted')
})

exports.listEstimateQuotes = asyncHandler(async (req, res) => {
  const { jobType, status, search, page = 1, limit = 20 } = req.query
  const filter = { createdBy: req.user._id }
  if (jobType) filter.jobType = jobType
  if (status) filter.status = status
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
  const filter = { createdBy: userId, ...(from ? { createdAt: { $gte: from } } : {}) }
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
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const [thisMonth, thisQuarter, ytd, allTime] = await Promise.all([
    rangeStats(req.user._id, startOfMonth),
    rangeStats(req.user._id, startOfQuarter),
    rangeStats(req.user._id, startOfYear),
    rangeStats(req.user._id, null),
  ])

  const mongoose = require('mongoose')
  const byJobType = await EstimateQuote.aggregate([
    { $match: { createdBy: new mongoose.Types.ObjectId(req.user._id) } },
    { $group: { _id: '$jobType', totalProfit: { $sum: '$profit' }, count: { $sum: 1 } } },
  ])
  const profitByCategory = byJobType.map(r => ({
    jobType: r._id, totalProfit: Math.round(r.totalProfit * 100) / 100, count: r.count,
  }))

  return success(res, { thisMonth, thisQuarter, ytd, allTime, profitByCategory })
})
