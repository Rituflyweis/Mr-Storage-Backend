const PricingRules = require('../../models/PricingRules')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const ALLOWED_TOP = ['steelRatesPerLb', 'sheetingRatesPerSf', 'freight', 'install', 'markup', 'bucketRates', 'customTabRules']

exports.getPricingRules = asyncHandler(async (req, res) => {
  let rules = await PricingRules.findOne({ ownerId: req.user._id })
  if (!rules) rules = await PricingRules.create({ ownerId: req.user._id })
  return success(res, { pricingRules: rules })
})

exports.updatePricingRules = asyncHandler(async (req, res) => {
  let rules = await PricingRules.findOne({ ownerId: req.user._id })
  if (!rules) rules = new PricingRules({ ownerId: req.user._id })

  ALLOWED_TOP.forEach((key) => {
    if (req.body[key] !== undefined) rules[key] = req.body[key]
  })

  await rules.save()
  return success(res, { pricingRules: rules }, 'Pricing rules saved')
})
