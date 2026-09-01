const BundlePlan = require('../models/BundlePlan')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateBundlePlanNumber = async () =>
  allocatePrefixedCode({
    model: BundlePlan,
    field: 'planNumber',
    prefix: 'BP',
    pad: 4,
    filter: { planNumber: { $regex: /^BP-\d+$/i } },
  })

module.exports = generateBundlePlanNumber
