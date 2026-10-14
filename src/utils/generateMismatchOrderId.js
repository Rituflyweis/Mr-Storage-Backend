const BundleMismatchOrder = require('../models/BundleMismatchOrder')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateMismatchOrderId = async () =>
  allocatePrefixedCode({
    model: BundleMismatchOrder,
    field: 'mismatchOrderId',
    prefix: 'MMO',
    pad: 4,
  })

module.exports = generateMismatchOrderId
