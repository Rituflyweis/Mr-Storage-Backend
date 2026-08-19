const PackingListPlan = require('../models/PackingListPlan')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generatePackingListPlanNumber = async () =>
  allocatePrefixedCode({
    model: PackingListPlan,
    field: 'planNumber',
    prefix: 'PLP',
    pad: 4,
    filter: { planNumber: { $regex: /^PLP-\d+$/i } },
  })

module.exports = generatePackingListPlanNumber
