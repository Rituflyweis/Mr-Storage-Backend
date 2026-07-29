const Customer = require('../models/Customer')

const generateCustomerId = async () => {
  const last = await Customer.findOne({}, { customerId: 1 })
    .sort({ createdAt: -1 })
    .lean()

  if (!last || !last.customerId) return 'CUST-0001'

  const num = parseInt(last.customerId.split('-')[1], 10)
  const next = num + 1
  return `CUST-${String(next).padStart(4, '0')}`
}

module.exports = generateCustomerId
