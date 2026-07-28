const FreightCarrier = require('../models/FreightCarrier')

const generateCarrierCode = async () => {
  const last = await FreightCarrier.findOne({}, { carrierCode: 1 })
    .sort({ createdAt: -1 })
    .lean()

  if (!last?.carrierCode) return 'CAR-0001'

  const num = parseInt(last.carrierCode.split('-')[1], 10)
  if (Number.isNaN(num)) return 'CAR-0001'

  return `CAR-${String(num + 1).padStart(4, '0')}`
}

module.exports = generateCarrierCode
