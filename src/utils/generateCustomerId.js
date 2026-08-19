const Customer = require('../models/Customer')

const CUSTOMER_ID_PATTERN = /^CUS(T)?-(\d+)$/i

const parseCustomerIdNumber = (customerId) => {
  if (!customerId) return null
  const match = String(customerId).trim().match(CUSTOMER_ID_PATTERN)
  if (!match) return null
  const n = parseInt(match[2], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Next display id: CUS-00001, CUS-00002, …
 * Uses the highest numeric suffix across all CUS-/CUST- ids (not latest createdAt).
 */
const generateCustomerId = async () => {
  const rows = await Customer.find({
    customerId: { $exists: true, $nin: [null, ''] },
  })
    .select('customerId')
    .lean()

  let maxNum = 0
  for (const row of rows) {
    const n = parseCustomerIdNumber(row.customerId)
    if (n != null && n > maxNum) maxNum = n
  }

  for (let offset = 1; offset <= 20; offset++) {
    const candidate = `CUS-${String(maxNum + offset).padStart(5, '0')}`
    const taken = await Customer.exists({ customerId: candidate })
    if (!taken) return candidate
  }

  throw new Error('Unable to allocate a unique customerId')
}

module.exports = generateCustomerId
