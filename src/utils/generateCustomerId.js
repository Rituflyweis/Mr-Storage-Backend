const Customer = require('../models/Customer')
const { allocateSequentialId } = require('./allocateSequentialId')

const CUSTOMER_ID_PATTERN = /^CUS(?:T)?-(\d+)$/i

/**
 * Next display id: CUS-00001, CUS-00002, …
 * Uses the highest numeric suffix across all CUS-/CUST- ids (not latest createdAt).
 */
const generateCustomerId = async () =>
  allocateSequentialId({
    model: Customer,
    field: 'customerId',
    parsePattern: CUSTOMER_ID_PATTERN,
    format: (n) => `CUS-${String(n).padStart(5, '0')}`,
  })

module.exports = generateCustomerId
