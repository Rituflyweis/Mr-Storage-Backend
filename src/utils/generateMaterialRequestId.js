const MaterialRequest = require('../models/MaterialRequest')
const { allocateSequentialId, escapeRegExp } = require('./allocateSequentialId')

const generateMaterialRequestId = async () => {
  const year = new Date().getFullYear()
  const prefix = `MR-${year}-`
  return allocateSequentialId({
    model: MaterialRequest,
    field: 'requestId',
    parsePattern: new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`),
    format: (n) => `${prefix}${String(n).padStart(4, '0')}`,
  })
}

module.exports = generateMaterialRequestId
