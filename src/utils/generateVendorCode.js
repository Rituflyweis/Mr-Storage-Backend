const Vendor = require('../models/Vendor')
const { allocatePrefixedCode } = require('./allocateSequentialId')

const generateVendorCode = async () =>
  allocatePrefixedCode({
    model: Vendor,
    field: 'vendorCode',
    prefix: 'VND',
    pad: 4,
  })

module.exports = generateVendorCode
