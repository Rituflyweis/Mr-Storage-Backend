const Vendor = require('../models/Vendor')

const generateVendorCode = async () => {
  const last = await Vendor.findOne({}, { vendorCode: 1 })
    .sort({ createdAt: -1 })
    .lean()

  if (!last?.vendorCode) return 'VND-0001'

  const num = parseInt(last.vendorCode.split('-')[1], 10)
  if (Number.isNaN(num)) return 'VND-0001'

  return `VND-${String(num + 1).padStart(4, '0')}`
}

module.exports = generateVendorCode
