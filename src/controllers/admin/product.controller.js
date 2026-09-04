const Product = require('../../models/Product')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

exports.listProducts = asyncHandler(async (req, res) => {
  const { category, subcategory, pricingType, vendorShipper, status, search, page = 1, limit = 20 } = req.query
  const parsedPage  = Math.max(parseInt(page, 10) || 1, 1)
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100)

  const filter = {}
  if (category)     filter.category     = category
  if (subcategory)  filter.subcategory  = subcategory
  if (pricingType)  filter.pricingType  = pricingType
  if (vendorShipper) filter.vendorShipper = vendorShipper
  if (status)       filter.status       = status
  if (search)       filter.$text        = { $search: search }

  const [products, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((parsedPage - 1) * parsedLimit).limit(parsedLimit).lean(),
    Product.countDocuments(filter),
  ])

  return success(res, { products, total, page: parsedPage, limit: parsedLimit })
})

// totalCost is always derived server-side — never trust a client-supplied value for it.
const computeTotalCost = (src) => {
  const materialCost = Number(src.materialCost) || 0
  const laborCost    = Number(src.laborCost)    || 0
  const overheadCost = Number(src.overheadCost) || 0
  return Math.round((materialCost + laborCost + overheadCost) * 100) / 100
}

exports.createProduct = asyncHandler(async (req, res) => {
  const { totalCost: _ignoredClientTotalCost, ...payload } = req.body
  const product = await Product.create({
    ...payload,
    totalCost: computeTotalCost(payload),
    createdBy: req.user._id,
  })
  return created(res, { product })
})

exports.getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId).lean()
  if (!product) return notFound(res, 'Product not found')
  return success(res, { product })
})

exports.updateProduct = asyncHandler(async (req, res) => {
  const { totalCost: _ignoredClientTotalCost, ...payload } = req.body

  const existing = await Product.findById(req.params.productId).lean()
  if (!existing) return notFound(res, 'Product not found')

  const COST_KEYS = ['materialCost', 'laborCost', 'overheadCost']
  if (COST_KEYS.some(k => payload[k] !== undefined)) {
    payload.totalCost = computeTotalCost({ ...existing, ...payload })
  }

  const product = await Product.findByIdAndUpdate(req.params.productId, payload, { new: true, runValidators: true }).lean()
  return success(res, { product })
})

exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.productId, { status: 'inactive' }, { new: true }).lean()
  if (!product) return notFound(res, 'Product not found')
  return success(res, null, 'Product deactivated')
})

exports.getCategories = asyncHandler(async (req, res) => {
  const { PRODUCT_CATEGORIES } = require('../../models/Product')
  const subcategories = await Product.distinct('subcategory', { subcategory: { $ne: '' } })
  const vendors = await Product.distinct('vendorShipper', { vendorShipper: { $ne: '' } })
  return success(res, { categories: PRODUCT_CATEGORIES, subcategories, vendors })
})

exports.exportProducts = asyncHandler(async (req, res) => {
  const { category, subcategory, pricingType, vendorShipper, status, search } = req.query
  const filter = {}
  if (category)      filter.category      = category
  if (subcategory)   filter.subcategory   = subcategory
  if (pricingType)   filter.pricingType   = pricingType
  if (vendorShipper) filter.vendorShipper = vendorShipper
  if (status)         filter.status        = status
  else                filter.status        = 'active' // default to active-only when no explicit status filter is requested
  if (search)         filter.$text         = { $search: search }

  const products = await Product.find(filter).sort({ category: 1, name: 1 }).lean()

  const rows = [
    ['Product Name', 'Category', 'Subcategory', 'SKU/Part Code', 'Pricing Type', 'Unit', 'Base Cost (USD)', 'Default Margin %'],
    ...products.map(p => [p.name, p.category, p.subcategory, p.skuPartCode, p.pricingType, p.unit, p.baseCost, p.defaultMargin]),
  ]

  const csv = rows.map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="product-library.csv"')
  return res.send(csv)
})
