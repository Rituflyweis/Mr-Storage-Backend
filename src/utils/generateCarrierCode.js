const FreightCarrier = require('../models/FreightCarrier')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateCarrierCode = async () =>
  allocatePrefixedCode({
    model: FreightCarrier,
    field: 'carrierCode',
    prefix: 'CAR',
    pad: 4,
  })

module.exports = generateCarrierCode
